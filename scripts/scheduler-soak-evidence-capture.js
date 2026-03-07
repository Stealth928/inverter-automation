#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function printUsage() {
  console.log(`
Usage:
  node scripts/scheduler-soak-evidence-capture.js [options]

Options:
  --input <path>          Read scheduler metrics payload JSON from file.
  --url <url>             Fetch scheduler metrics from API endpoint.
  --token <token>         Bearer token for --url mode (or env SCHEDULER_METRICS_BEARER_TOKEN).
  --days <n>              Day window query param (default: 14).
  --run-limit <n>         Recent run query param (default: 20).
  --include-runs <0|1>    Include recent runs query param (default: 1).
  --out-dir <path>        Output directory (default: docs/evidence/scheduler-soak).
  --label <text>          Optional source label stored in evidence.
  --require-ready         Exit non-zero when soak readiness is not met.
  --help                  Show this help text.

Environment:
  SCHEDULER_METRICS_URL
  SCHEDULER_METRICS_BEARER_TOKEN
`.trim());
}

function parseBooleanFlag(value, fallback) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseArgs(argv) {
  const options = {
    days: 14,
    includeRuns: true,
    label: null,
    outDir: path.join('docs', 'evidence', 'scheduler-soak'),
    requireReady: false,
    runLimit: 20
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--require-ready') {
      options.requireReady = true;
      continue;
    }

    const nextValue = argv[i + 1];
    const consumeNext = () => {
      i += 1;
      return nextValue;
    };

    if (arg === '--input') {
      options.inputPath = consumeNext();
      continue;
    }
    if (arg === '--url') {
      options.url = consumeNext();
      continue;
    }
    if (arg === '--token') {
      options.token = consumeNext();
      continue;
    }
    if (arg === '--days') {
      options.days = Number(consumeNext());
      continue;
    }
    if (arg === '--run-limit') {
      options.runLimit = Number(consumeNext());
      continue;
    }
    if (arg === '--include-runs') {
      options.includeRuns = parseBooleanFlag(consumeNext(), true);
      continue;
    }
    if (arg === '--out-dir') {
      options.outDir = consumeNext();
      continue;
    }
    if (arg === '--label') {
      options.label = consumeNext();
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(options.days) || options.days < 1) {
    throw new Error('--days must be a positive integer');
  }
  options.days = Math.floor(options.days);

  if (!Number.isFinite(options.runLimit) || options.runLimit < 1) {
    throw new Error('--run-limit must be a positive integer');
  }
  options.runLimit = Math.floor(options.runLimit);

  return options;
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeText(value, fallback = '') {
  const text = String(value == null ? '' : value).trim();
  return text || fallback;
}

function stripBom(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/^\uFEFF/, '');
}

function buildTimestampStamp(isoString) {
  return sanitizeText(isoString)
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', '_Z');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensurePayloadShape(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload must be a JSON object');
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'errno')) {
    if (toFiniteNumber(payload.errno, -1) !== 0) {
      throw new Error(`Payload errno is non-zero: ${payload.errno}`);
    }
    if (!payload.result || typeof payload.result !== 'object') {
      throw new Error('Payload result is missing');
    }
    return payload.result;
  }

  if (payload.result && typeof payload.result === 'object') {
    return payload.result;
  }

  return payload;
}

async function loadPayloadFromUrl(options) {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is unavailable; use --input mode');
  }

  const endpoint = sanitizeText(options.url || process.env.SCHEDULER_METRICS_URL);
  if (!endpoint) {
    throw new Error('Missing --url and SCHEDULER_METRICS_URL');
  }

  const token = sanitizeText(options.token || process.env.SCHEDULER_METRICS_BEARER_TOKEN);
  const url = new URL(endpoint);
  url.searchParams.set('days', String(options.days));
  url.searchParams.set('includeRuns', options.includeRuns ? '1' : '0');
  url.searchParams.set('runLimit', String(options.runLimit));

  const headers = { Accept: 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers, method: 'GET' });
  const bodyText = stripBom(await response.text());
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${bodyText.slice(0, 300)}`);
  }

  let parsed;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : {};
  } catch (error) {
    throw new Error(`Invalid JSON from API response: ${error.message}`);
  }

  return {
    endpoint: url.toString(),
    payload: parsed
  };
}

function loadPayloadFromFile(filePath) {
  const resolved = path.resolve(filePath);
  const raw = stripBom(fs.readFileSync(resolved, 'utf8'));
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in input file: ${error.message}`);
  }
  return {
    endpoint: null,
    payload: parsed,
    resolvedPath: resolved
  };
}

function buildEvidenceSnapshot(options, source, result) {
  const capturedAt = new Date().toISOString();
  const summary = result.summary && typeof result.summary === 'object' ? result.summary : {};
  const soak = result.soak && typeof result.soak === 'object' ? result.soak : {};
  const readiness = soak.readiness && typeof soak.readiness === 'object' ? soak.readiness : {};
  const daily = Array.isArray(result.daily) ? result.daily : [];
  const recentRuns = Array.isArray(result.recentRuns) ? result.recentRuns : [];

  return {
    schemaVersion: 1,
    capturedAt,
    source: {
      mode: source.mode,
      label: options.label || null,
      inputPath: source.inputPath || null,
      endpoint: source.endpoint || null
    },
    window: {
      requestedDays: options.days,
      responseDays: toFiniteNumber(result.days, 0),
      daysWithData: daily.length,
      includeRuns: Boolean(result.includeRuns),
      runLimit: toFiniteNumber(result.runLimit, 0),
      recentRunRows: recentRuns.length
    },
    summary: {
      runs: toFiniteNumber(summary.runs, 0),
      cyclesRun: toFiniteNumber(summary.cyclesRun, 0),
      errors: toFiniteNumber(summary.errors, 0),
      deadLetters: toFiniteNumber(summary.deadLetters, 0),
      retries: toFiniteNumber(summary.retries, 0),
      errorRatePct: toFiniteNumber(summary.errorRatePct, 0),
      maxQueueLagMs: toFiniteNumber(summary.maxQueueLagMs, 0),
      maxCycleDurationMs: toFiniteNumber(summary.maxCycleDurationMs, 0),
      lockedSkips: toFiniteNumber(summary.skipped && summary.skipped.locked, 0),
      idempotentSkips: toFiniteNumber(summary.skipped && summary.skipped.idempotent, 0)
    },
    soak: {
      status: sanitizeText(soak.status, 'unknown'),
      daysRequested: toFiniteNumber(soak.daysRequested, 0),
      daysWithData: toFiniteNumber(soak.daysWithData, 0),
      healthyDays: toFiniteNumber(soak.healthyDays, 0),
      watchDays: toFiniteNumber(soak.watchDays, 0),
      breachDays: toFiniteNumber(soak.breachDays, 0),
      unknownDays: toFiniteNumber(soak.unknownDays, 0),
      healthyDayRatioPct: toFiniteNumber(soak.healthyDayRatioPct, 0),
      nonHealthyDayRatioPct: toFiniteNumber(soak.nonHealthyDayRatioPct, 0),
      latestDayKey: soak.latestDayKey || null,
      latestStatus: sanitizeText(soak.latestStatus, 'unknown'),
      consecutiveHealthyDays: toFiniteNumber(soak.consecutiveHealthyDays, 0),
      consecutiveNonHealthyDays: toFiniteNumber(soak.consecutiveNonHealthyDays, 0),
      readiness: {
        minDaysRequired: toFiniteNumber(readiness.minDaysRequired, 0),
        minHealthyRatioPct: toFiniteNumber(readiness.minHealthyRatioPct, 0),
        hasMinimumDays: Boolean(readiness.hasMinimumDays),
        hasNoBreachDays: Boolean(readiness.hasNoBreachDays),
        latestStatusIsHealthy: Boolean(readiness.latestStatusIsHealthy),
        healthyRatioSatisfactory: Boolean(readiness.healthyRatioSatisfactory),
        readyForCloseout: Boolean(readiness.readyForCloseout)
      }
    },
    currentAlert: result.currentAlert && typeof result.currentAlert === 'object' ? result.currentAlert : null,
    updatedAt: result.updatedAt || null
  };
}

function toMarkdown(snapshot, jsonFileName) {
  const readiness = snapshot.soak.readiness || {};
  const readinessChecks = [
    ['Has Minimum Days', readiness.hasMinimumDays],
    ['Has No Breach Days', readiness.hasNoBreachDays],
    ['Latest Status Healthy', readiness.latestStatusIsHealthy],
    ['Healthy Ratio Satisfactory', readiness.healthyRatioSatisfactory],
    ['Ready For Closeout', readiness.readyForCloseout]
  ];

  const readinessRows = readinessChecks
    .map(([label, value]) => `| ${label} | ${value ? 'Yes' : 'No'} |`)
    .join('\n');

  return [
    '# Scheduler Soak Evidence Snapshot',
    '',
    `- Captured At: ${snapshot.capturedAt}`,
    `- Source Mode: ${snapshot.source.mode}`,
    `- Source Label: ${snapshot.source.label || '-'}`,
    `- Source Endpoint: ${snapshot.source.endpoint || '-'}`,
    `- Source Input Path: ${snapshot.source.inputPath || '-'}`,
    `- JSON Artifact: \`${jsonFileName}\``,
    '',
    '## Window',
    '',
    `- Requested Days: ${snapshot.window.requestedDays}`,
    `- Response Days: ${snapshot.window.responseDays}`,
    `- Days With Data: ${snapshot.window.daysWithData}`,
    `- Include Runs: ${snapshot.window.includeRuns ? 'Yes' : 'No'}`,
    `- Run Limit: ${snapshot.window.runLimit}`,
    `- Recent Run Rows: ${snapshot.window.recentRunRows}`,
    '',
    '## Summary',
    '',
    `- Runs: ${snapshot.summary.runs}`,
    `- Cycles Run: ${snapshot.summary.cyclesRun}`,
    `- Errors: ${snapshot.summary.errors}`,
    `- Dead Letters: ${snapshot.summary.deadLetters}`,
    `- Retries: ${snapshot.summary.retries}`,
    `- Error Rate: ${snapshot.summary.errorRatePct.toFixed(2)}%`,
    `- Max Queue Lag: ${snapshot.summary.maxQueueLagMs} ms`,
    `- Max Cycle Duration: ${snapshot.summary.maxCycleDurationMs} ms`,
    `- Lock / Idempotent Skips: ${snapshot.summary.lockedSkips} / ${snapshot.summary.idempotentSkips}`,
    '',
    '## Soak Status',
    '',
    `- Status: ${snapshot.soak.status}`,
    `- Latest Day: ${snapshot.soak.latestDayKey || '-'} (${snapshot.soak.latestStatus})`,
    `- Healthy / Watch / Breach / Unknown Days: ${snapshot.soak.healthyDays} / ${snapshot.soak.watchDays} / ${snapshot.soak.breachDays} / ${snapshot.soak.unknownDays}`,
    `- Healthy Ratio: ${snapshot.soak.healthyDayRatioPct.toFixed(2)}%`,
    `- Non-Healthy Ratio: ${snapshot.soak.nonHealthyDayRatioPct.toFixed(2)}%`,
    `- Consecutive Healthy Days: ${snapshot.soak.consecutiveHealthyDays}`,
    `- Consecutive Non-Healthy Days: ${snapshot.soak.consecutiveNonHealthyDays}`,
    '',
    '## Readiness Checks',
    '',
    '| Check | Met |',
    '|---|---|',
    readinessRows,
    '',
    '## Raw Pointers',
    '',
    `- Updated At (from API): ${snapshot.updatedAt || '-'}`,
    `- Current Alert Present: ${snapshot.currentAlert ? 'Yes' : 'No'}`
  ].join('\n');
}

function ensureIndexFile(indexPath) {
  if (fs.existsSync(indexPath)) return;
  const header = [
    '# Scheduler Soak Evidence Index',
    '',
    '| Captured At | Status | Ready | Days With Data | Healthy/Watch/Breach | JSON | Markdown |',
    '|---|---|---:|---:|---|---|---|',
    ''
  ].join('\n');
  fs.writeFileSync(indexPath, header, 'utf8');
}

function appendIndexRow(indexPath, snapshot, jsonFileName, markdownFileName) {
  const row = `| ${snapshot.capturedAt} | ${snapshot.soak.status} | ${snapshot.soak.readiness.readyForCloseout ? 'Yes' : 'No'} | ${snapshot.soak.daysWithData} | ${snapshot.soak.healthyDays}/${snapshot.soak.watchDays}/${snapshot.soak.breachDays} | ${jsonFileName} | ${markdownFileName} |`;
  fs.appendFileSync(indexPath, `${row}\n`, 'utf8');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    process.exit(0);
  }

  let source;
  if (options.inputPath) {
    const fromFile = loadPayloadFromFile(options.inputPath);
    source = {
      mode: 'file',
      inputPath: fromFile.resolvedPath,
      endpoint: null,
      payload: fromFile.payload
    };
  } else {
    const fromUrl = await loadPayloadFromUrl(options);
    source = {
      mode: 'url',
      inputPath: null,
      endpoint: fromUrl.endpoint,
      payload: fromUrl.payload
    };
  }

  const result = ensurePayloadShape(source.payload);
  const snapshot = buildEvidenceSnapshot(options, source, result);
  const timestampStamp = buildTimestampStamp(snapshot.capturedAt);
  const jsonFileName = `scheduler-soak-${timestampStamp}.json`;
  const markdownFileName = `scheduler-soak-${timestampStamp}.md`;
  const outDir = path.resolve(options.outDir);
  const jsonPath = path.join(outDir, jsonFileName);
  const markdownPath = path.join(outDir, markdownFileName);
  const indexPath = path.join(outDir, 'INDEX.md');

  ensureDir(outDir);
  fs.writeFileSync(jsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, `${toMarkdown(snapshot, jsonFileName)}\n`, 'utf8');
  ensureIndexFile(indexPath);
  appendIndexRow(indexPath, snapshot, jsonFileName, markdownFileName);

  console.log('[SchedulerSoakCapture] Evidence captured');
  console.log(`  - JSON: ${jsonPath}`);
  console.log(`  - Markdown: ${markdownPath}`);
  console.log(`  - Index: ${indexPath}`);
  console.log(`  - Soak status: ${snapshot.soak.status}`);
  console.log(`  - Ready for closeout: ${snapshot.soak.readiness.readyForCloseout ? 'YES' : 'NO'}`);

  if (options.requireReady && !snapshot.soak.readiness.readyForCloseout) {
    console.error('[SchedulerSoakCapture] --require-ready set but readiness criteria are not met');
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(`[SchedulerSoakCapture] Failed: ${error.message}`);
  process.exit(1);
});
