'use strict';

const crypto = require('crypto');

const RUN_STATUSES = Object.freeze({
  queued: 'queued',
  running: 'running',
  completed: 'completed',
  failed: 'failed'
});

const DEFAULT_LIMITS = Object.freeze({
  maxActiveRuns: 2,
  runTtlMs: 30 * 24 * 60 * 60 * 1000
});

function toFiniteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildRequestHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value || {})).digest('hex').slice(0, 16);
}

function cloneSnapshot(snapshot = {}) {
  return {
    source: String(snapshot.source || 'optimization'),
    name: String(snapshot.name || ''),
    rules: deepClone(snapshot.rules || {})
  };
}

function optimizationRunsCollection(db, userId) {
  return db.collection('users').doc(userId).collection('optimizations').doc('runs').collection('items');
}

function rankVariant(goal, summary = {}) {
  const bill = toFiniteNumber(summary.totalBillAud, 0) || 0;
  const throughput = toFiniteNumber(summary.throughputKWh, 0) || 0;
  const importKWh = toFiniteNumber(summary.importKWh, 0) || 0;
  const exportKWh = toFiniteNumber(summary.exportKWh, 0) || 0;
  switch (goal) {
    case 'protect_battery':
      return [throughput, bill, importKWh];
    case 'reduce_import':
      return [importKWh, bill, throughput];
    case 'increase_export':
      return [-exportKWh, bill, throughput];
    case 'balanced':
      return [bill, throughput, importKWh];
    case 'maximize_roi':
    default:
      return [bill, throughput, importKWh];
  }
}

function compareRanks(left = [], right = []) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] || 0) - (right[index] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function mutateNumericVariants(sourceScenario = {}) {
  const snapshot = cloneSnapshot(sourceScenario.ruleSetSnapshot);
  const variants = [];
  Object.entries(snapshot.rules || {}).forEach(([ruleId, rule]) => {
    const conditions = rule.conditions || {};
    Object.entries(conditions).forEach(([conditionKey, condition]) => {
      if (!condition || condition.enabled !== true) return;
      const step = conditionKey === 'solarRadiation'
        ? 50
        : conditionKey === 'cloudCover' || conditionKey === 'soc'
          ? 5
          : conditionKey === 'forecastPrice' || conditionKey === 'feedInPrice' || conditionKey === 'buyPrice' || conditionKey === 'price'
            ? 5
            : ((conditionKey === 'temperature' || conditionKey === 'temp') ? 2 : null);
      if (!step || !Number.isFinite(Number(condition.value))) return;
      [-2, -1, 1, 2].forEach((multiplier) => {
        const nextSnapshot = cloneSnapshot(sourceScenario.ruleSetSnapshot);
        nextSnapshot.rules[ruleId].conditions[conditionKey].value = Number(condition.value) + (step * multiplier);
        variants.push({
          id: `${ruleId}-${conditionKey}-${multiplier}`,
          name: `${rule.name || ruleId}: tune ${conditionKey}`,
          kind: 'threshold',
          diffSummary: [`${rule.name || ruleId}: ${conditionKey} ${condition.value} -> ${nextSnapshot.rules[ruleId].conditions[conditionKey].value}`],
          snapshot: nextSnapshot
        });
      });
    });
  });
  return variants;
}

function mutateTimeVariants(sourceScenario = {}) {
  const variants = [];
  Object.entries(sourceScenario.ruleSetSnapshot?.rules || {}).forEach(([ruleId, rule]) => {
    const timeCondition = rule?.conditions?.time || rule?.conditions?.timeWindow;
    if (!timeCondition?.enabled) return;
    const start = String(timeCondition.startTime || timeCondition.start || '00:00');
    const end = String(timeCondition.endTime || timeCondition.end || '23:59');
    const [startHour, startMinute] = start.split(':').map(Number);
    const [endHour, endMinute] = end.split(':').map(Number);
    const startTotal = (startHour * 60) + startMinute;
    const endTotal = (endHour * 60) + endMinute;
    [-60, -30, 30, 60].forEach((shift) => {
      const nextSnapshot = cloneSnapshot(sourceScenario.ruleSetSnapshot);
      const nextCondition = nextSnapshot.rules[ruleId].conditions.time || nextSnapshot.rules[ruleId].conditions.timeWindow;
      const nextStart = ((startTotal + shift + (24 * 60)) % (24 * 60));
      const nextEnd = ((endTotal + shift + (24 * 60)) % (24 * 60));
      nextCondition.startTime = `${String(Math.floor(nextStart / 60)).padStart(2, '0')}:${String(nextStart % 60).padStart(2, '0')}`;
      nextCondition.endTime = `${String(Math.floor(nextEnd / 60)).padStart(2, '0')}:${String(nextEnd % 60).padStart(2, '0')}`;
      variants.push({
        id: `${ruleId}-time-${shift}`,
        name: `${rule.name || ruleId}: shift time window`,
        kind: 'time',
        diffSummary: [`${rule.name || ruleId}: ${start}-${end} -> ${nextCondition.startTime}-${nextCondition.endTime}`],
        snapshot: nextSnapshot
      });
    });
  });
  return variants;
}

function mutatePriorityVariants(sourceScenario = {}) {
  const entries = Object.entries(sourceScenario.ruleSetSnapshot?.rules || {})
    .sort((left, right) => (toFiniteNumber(left[1]?.priority, 999) || 999) - (toFiniteNumber(right[1]?.priority, 999) || 999));
  const variants = [];
  for (let index = 0; index < entries.length - 1; index += 1) {
    const [leftId, leftRule] = entries[index];
    const [rightId, rightRule] = entries[index + 1];
    const nextSnapshot = cloneSnapshot(sourceScenario.ruleSetSnapshot);
    const leftPriority = toFiniteNumber(leftRule.priority, 999) || 999;
    const rightPriority = toFiniteNumber(rightRule.priority, 999) || 999;
    nextSnapshot.rules[leftId].priority = rightPriority;
    nextSnapshot.rules[rightId].priority = leftPriority;
    variants.push({
      id: `${leftId}-${rightId}-swap`,
      name: `Swap ${leftRule.name || leftId} / ${rightRule.name || rightId}`,
      kind: 'priority',
      diffSummary: [`Swap priorities: ${leftRule.name || leftId} <-> ${rightRule.name || rightId}`],
      snapshot: nextSnapshot
    });
  }
  return variants;
}

function simplifyZeroTriggerVariants(sourceScenario = {}, sourceSummary = {}) {
  const triggeredRuleIds = new Set((Array.isArray(sourceSummary.winningRuleMix) ? sourceSummary.winningRuleMix : []).map((entry) => String(entry.ruleId || '')));
  const removableRuleIds = Object.keys(sourceScenario.ruleSetSnapshot?.rules || {}).filter((ruleId) => !triggeredRuleIds.has(ruleId));
  if (removableRuleIds.length === 0) return [];
  const nextSnapshot = cloneSnapshot(sourceScenario.ruleSetSnapshot);
  removableRuleIds.forEach((ruleId) => {
    delete nextSnapshot.rules[ruleId];
  });
  return [{
    id: `remove-${removableRuleIds.length}`,
    name: 'Remove inactive rules',
    kind: 'simplify',
    diffSummary: [`Removed ${removableRuleIds.length} rules that did not trigger in the source backtest`],
    snapshot: nextSnapshot
  }];
}

function pickBalancedVariants(scored = []) {
  const selected = [];
  scored.forEach((entry) => {
    const dominated = selected.some((picked) => {
      const a = picked.summary || {};
      const b = entry.summary || {};
      return (a.totalBillAud <= b.totalBillAud) && (a.throughputKWh <= b.throughputKWh) && (a.importKWh <= b.importKWh)
        && ((a.totalBillAud < b.totalBillAud) || (a.throughputKWh < b.throughputKWh) || (a.importKWh < b.importKWh));
    });
    if (!dominated) selected.push(entry);
  });
  return selected.slice(0, 3);
}

function createOptimizationService(deps = {}) {
  const backtestService = deps.backtestService;
  const db = deps.db;
  const getConfig = deps.getConfig;
  const getUserRules = deps.getUserRules;
  const setUserRule = deps.setUserRule;
  const deleteUserRule = deps.deleteUserRule;

  if (!backtestService || typeof backtestService.getRun !== 'function' || typeof backtestService.runBacktestAnalysis !== 'function') {
    throw new Error('createOptimizationService requires backtestService');
  }
  if (!db || typeof db.collection !== 'function') throw new Error('createOptimizationService requires db');
  if (typeof getConfig !== 'function') throw new Error('createOptimizationService requires getConfig()');
  if (typeof getUserRules !== 'function') throw new Error('createOptimizationService requires getUserRules()');
  if (typeof setUserRule !== 'function') throw new Error('createOptimizationService requires setUserRule()');
  if (typeof deleteUserRule !== 'function') throw new Error('createOptimizationService requires deleteUserRule()');

  function getLimits() {
    const runtime = getConfig()?.automation?.optimizer || {};
    return {
      maxActiveRuns: Math.max(1, Math.round(toFiniteNumber(runtime.maxActiveRuns, DEFAULT_LIMITS.maxActiveRuns) || DEFAULT_LIMITS.maxActiveRuns)),
      runTtlMs: Math.max(60 * 60 * 1000, Math.round(toFiniteNumber(runtime.runTtlMs, DEFAULT_LIMITS.runTtlMs) || DEFAULT_LIMITS.runTtlMs))
    };
  }

  async function listRuns(userId, limit = 20) {
    const snapshot = await optimizationRunsCollection(db, userId).orderBy('requestedAtMs', 'desc').limit(Math.max(1, Math.min(50, Math.round(toFiniteNumber(limit, 20) || 20)))).get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
  }

  async function getRun(userId, runId) {
    const snapshot = await optimizationRunsCollection(db, userId).doc(runId).get();
    return snapshot.exists ? { id: snapshot.id, ...(snapshot.data() || {}) } : null;
  }

  async function countActiveRuns(userId) {
    const snapshot = await optimizationRunsCollection(db, userId).where('status', 'in', [RUN_STATUSES.queued, RUN_STATUSES.running]).get();
    return snapshot.size;
  }

  async function createRun(userId, request = {}) {
    const limits = getLimits();
    if ((await countActiveRuns(userId)) >= limits.maxActiveRuns) {
      throw new Error(`You can only have ${limits.maxActiveRuns} queued or running optimisation runs at once`);
    }
    const stored = {
      type: 'optimizationRun',
      status: RUN_STATUSES.queued,
      requestedAtMs: Date.now(),
      startedAtMs: null,
      completedAtMs: null,
      expiresAtMs: Date.now() + limits.runTtlMs,
      request: {
        backtestRunId: String(request.backtestRunId || ''),
        goal: String(request.goal || 'maximize_roi'),
        sourceScenarioId: request.sourceScenarioId ? String(request.sourceScenarioId) : null,
        requestHash: buildRequestHash(request)
      },
      error: null
    };
    if (!stored.request.backtestRunId) throw new Error('Optimization requires a completed backtestRunId');
    const docRef = optimizationRunsCollection(db, userId).doc();
    await docRef.set(stored);
    return { id: docRef.id, ...stored };
  }

  async function processRun(userId, runId) {
    const runRef = optimizationRunsCollection(db, userId).doc(runId);
    let claimed = null;
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(runRef);
      if (!snapshot.exists) throw new Error('Optimization run not found');
      const data = snapshot.data() || {};
      if (data.status !== RUN_STATUSES.queued) return;
      claimed = { id: snapshot.id, ...data };
      transaction.update(runRef, { status: RUN_STATUSES.running, startedAtMs: Date.now(), error: null });
    });
    if (!claimed) return getRun(userId, runId);

    try {
      const backtestRun = await backtestService.getRun(userId, claimed.request.backtestRunId);
      if (!backtestRun || backtestRun.status !== 'completed' || !backtestRun.result) {
        throw new Error('Optimization requires a completed backtest run');
      }
      const sourceScenarioId = claimed.request.sourceScenarioId
        || (backtestRun.request?.scenarios || []).find((scenario) => scenario.id !== 'baseline')?.id
        || backtestRun.request?.scenarios?.[0]?.id;
      const sourceScenario = (backtestRun.request?.scenarios || []).find((scenario) => scenario.id === sourceScenarioId) || backtestRun.request?.scenarios?.[0];
      if (!sourceScenario) throw new Error('Optimization could not find a source scenario');
      const sourceSummary = (backtestRun.result?.summaries || []).find((summary) => summary.scenarioId === sourceScenario.id) || null;

      const candidateVariants = []
        .concat(mutateNumericVariants(sourceScenario))
        .concat(mutateTimeVariants(sourceScenario))
        .concat(mutatePriorityVariants(sourceScenario))
        .concat(simplifyZeroTriggerVariants(sourceScenario, sourceSummary || {}));

      const deduped = [];
      const seenHashes = new Set();
      candidateVariants.forEach((variant) => {
        const hash = buildRequestHash(variant.snapshot.rules);
        if (seenHashes.has(hash)) return;
        seenHashes.add(hash);
        deduped.push(variant);
      });

      const scored = [];
      for (const variant of deduped.slice(0, 24)) {
        const analysis = await backtestService.runBacktestAnalysis(userId, {
          period: backtestRun.request.period,
          includeBaseline: true,
          comparisonMode: 'optimizer',
          scenarios: [
            sourceScenario,
            {
              id: variant.id,
              name: variant.name,
              ruleSetSnapshot: variant.snapshot,
              tariff: sourceScenario.tariff || null
            }
          ],
          timezone: backtestRun.request.timezone
        });
        const summary = (analysis.summaries || []).find((entry) => entry.scenarioId === variant.id);
        if (!summary) continue;
        scored.push({
          ...variant,
          summary,
          rank: rankVariant(claimed.request.goal, summary)
        });
      }

      scored.sort((left, right) => compareRanks(left.rank, right.rank));
      const selected = claimed.request.goal === 'balanced' ? pickBalancedVariants(scored) : scored.slice(0, 3);
      const sourceBill = toFiniteNumber(sourceSummary?.totalBillAud, null);
      const variants = selected.map((entry, index) => ({
        id: entry.id,
        name: entry.name || `Variant ${index + 1}`,
        kind: entry.kind,
        diffSummary: entry.diffSummary || [],
        summary: entry.summary,
        billImprovementAud: Number.isFinite(sourceBill) ? Number((sourceBill - (toFiniteNumber(entry.summary?.totalBillAud, 0) || 0)).toFixed(2)) : null,
        tradeOffs: {
          throughputKWh: Number((toFiniteNumber(entry.summary?.throughputKWh, 0) - (toFiniteNumber(sourceSummary?.throughputKWh, 0) || 0)).toFixed(3)),
          importKWh: Number((toFiniteNumber(entry.summary?.importKWh, 0) - (toFiniteNumber(sourceSummary?.importKWh, 0) || 0)).toFixed(3)),
          exportKWh: Number((toFiniteNumber(entry.summary?.exportKWh, 0) - (toFiniteNumber(sourceSummary?.exportKWh, 0) || 0)).toFixed(3))
        },
        snapshot: entry.snapshot
      }));

      await runRef.set({
        status: RUN_STATUSES.completed,
        completedAtMs: Date.now(),
        result: {
          goal: claimed.request.goal,
          sourceScenarioId: sourceScenario.id,
          sourceScenarioName: sourceScenario.name,
          sourceSummary,
          variants
        },
        error: null
      }, { merge: true });
    } catch (error) {
      await runRef.set({
        status: RUN_STATUSES.failed,
        completedAtMs: Date.now(),
        error: error?.message || String(error)
      }, { merge: true });
      throw error;
    }
    return getRun(userId, runId);
  }

  async function applyVariant(userId, runId, variantId, confirm = false) {
    if (confirm !== true) throw new Error('Applying an optimisation variant requires confirm=true');
    const runRef = optimizationRunsCollection(db, userId).doc(runId);
    const run = await getRun(userId, runId);
    if (!run || run.status !== RUN_STATUSES.completed) throw new Error('Optimization run is not complete');
    const variant = (run.result?.variants || []).find((entry) => entry.id === variantId);
    if (!variant) throw new Error('Optimization variant not found');

    const currentRules = await getUserRules(userId);
    const nextRules = variant.snapshot?.rules || {};
    const currentRuleIds = new Set(Object.keys(currentRules || {}));
    const nextRuleIds = new Set(Object.keys(nextRules || {}));

    for (const [ruleId, rule] of Object.entries(nextRules)) {
      await setUserRule(userId, ruleId, rule);
    }
    for (const ruleId of currentRuleIds) {
      if (!nextRuleIds.has(ruleId)) await deleteUserRule(userId, ruleId);
    }

    await runRef.set({
      appliedAtMs: Date.now(),
      appliedVariantId: variantId,
      rollbackSnapshot: { rules: currentRules }
    }, { merge: true });
    return { appliedVariantId: variantId };
  }

  return {
    RUN_STATUSES,
    applyVariant,
    createRun,
    getRun,
    listRuns,
    processRun
  };
}

module.exports = {
  RUN_STATUSES,
  createOptimizationService
};
