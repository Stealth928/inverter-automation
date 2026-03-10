'use strict';

function registerAdminRoutes(app, deps = {}) {
  const { buildSchedulerSoakSummary } = require('../../lib/services/scheduler-soak-summary');
  const authenticateUser = deps.authenticateUser;
  const requireAdmin = deps.requireAdmin;
  const googleApis = deps.googleApis;
  const getRuntimeProjectId = deps.getRuntimeProjectId;
  const listMonitoringTimeSeries = deps.listMonitoringTimeSeries;
  const normalizeMetricErrorMessage = deps.normalizeMetricErrorMessage;
  const fetchCloudBillingCost = deps.fetchCloudBillingCost;
  const sumSeriesValues = deps.sumSeriesValues;
  const estimateFirestoreCostFromUsage = deps.estimateFirestoreCostFromUsage;
  const db = deps.db;
  const admin = deps.admin;
  const serverTimestamp = deps.serverTimestamp;
  const deleteUserDataTree = deps.deleteUserDataTree;
  const deleteCollectionDocs = deps.deleteCollectionDocs;
  const normalizeCouplingValue = deps.normalizeCouplingValue;
  const isAdmin = deps.isAdmin;
  const SEED_ADMIN_EMAIL = deps.SEED_ADMIN_EMAIL;

  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function') {
    throw new Error('registerAdminRoutes requires an Express app');
  }
  if (typeof authenticateUser !== 'function') {
    throw new Error('registerAdminRoutes requires authenticateUser middleware');
  }
  if (typeof requireAdmin !== 'function') {
    throw new Error('registerAdminRoutes requires requireAdmin middleware');
  }
  if (typeof getRuntimeProjectId !== 'function') {
    throw new Error('registerAdminRoutes requires getRuntimeProjectId()');
  }
  if (typeof listMonitoringTimeSeries !== 'function') {
    throw new Error('registerAdminRoutes requires listMonitoringTimeSeries()');
  }
  if (typeof normalizeMetricErrorMessage !== 'function') {
    throw new Error('registerAdminRoutes requires normalizeMetricErrorMessage()');
  }
  if (typeof fetchCloudBillingCost !== 'function') {
    throw new Error('registerAdminRoutes requires fetchCloudBillingCost()');
  }
  if (typeof sumSeriesValues !== 'function') {
    throw new Error('registerAdminRoutes requires sumSeriesValues()');
  }
  if (typeof estimateFirestoreCostFromUsage !== 'function') {
    throw new Error('registerAdminRoutes requires estimateFirestoreCostFromUsage()');
  }
  if (!db || typeof db.collection !== 'function') {
    throw new Error('registerAdminRoutes requires Firestore db');
  }
  if (!admin || typeof admin.auth !== 'function') {
    throw new Error('registerAdminRoutes requires Firebase admin.auth()');
  }
  if (typeof serverTimestamp !== 'function') {
    throw new Error('registerAdminRoutes requires serverTimestamp()');
  }
  if (typeof deleteUserDataTree !== 'function') {
    throw new Error('registerAdminRoutes requires deleteUserDataTree()');
  }
  if (typeof deleteCollectionDocs !== 'function') {
    throw new Error('registerAdminRoutes requires deleteCollectionDocs()');
  }
  if (typeof normalizeCouplingValue !== 'function') {
    throw new Error('registerAdminRoutes requires normalizeCouplingValue()');
  }
  if (typeof isAdmin !== 'function') {
    throw new Error('registerAdminRoutes requires isAdmin()');
  }
/**
 * GET /api/admin/firestore-metrics - Pull Firestore usage + billing signals from GCP Monitoring
 * Query: ?hours=36 (default 36, min 6, max 168)
 */
app.get('/api/admin/firestore-metrics', authenticateUser, requireAdmin, async (req, res) => {
  const warnings = [];
  try {
    if (!googleApis) {
      return res.status(503).json({ errno: 503, error: 'googleapis dependency not available on server' });
    }

    const projectId = getRuntimeProjectId();
    if (!projectId) {
      return res.status(500).json({ errno: 500, error: 'Unable to resolve GCP project id' });
    }

    const hoursRaw = Number(req.query?.hours);
    const hours = Number.isFinite(hoursRaw) ? Math.max(6, Math.min(168, Math.floor(hoursRaw))) : 36;

    const now = new Date();
    const start = new Date(now.getTime() - (hours * 60 * 60 * 1000));
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));

    const auth = new googleApis.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/monitoring.read']
    });
    const monitoring = googleApis.monitoring({ version: 'v3', auth });

    const metricFilters = {
      reads: 'metric.type="firestore.googleapis.com/document/read_count"',
      writes: 'metric.type="firestore.googleapis.com/document/write_count"',
      deletes: 'metric.type="firestore.googleapis.com/document/delete_count"',
      storageCandidates: [
        'metric.type="firestore.googleapis.com/storage/bytes_used"',
        'metric.type="firestore.googleapis.com/database/storage/total_bytes"',
        'metric.type="firestore.googleapis.com/storage/total_bytes"'
      ],
      billingCostCandidates: [
        'metric.type="billing.googleapis.com/billing/account/total_cost"',
        'metric.type="billing.googleapis.com/billing_account/cost"',
        'metric.type="billing.googleapis.com/billing/account/cost"'
      ]
    };

    const loadMetricSeriesSafe = async ({
      label,
      filters,
      startTime,
      endTime,
      aligner,
      alignmentPeriod
    }) => {
      const filterList = Array.isArray(filters) ? filters : [filters];
      for (const filter of filterList) {
        try {
          const series = await listMonitoringTimeSeries({
            monitoring,
            projectId,
            filter,
            startTime,
            endTime,
            aligner,
            alignmentPeriod
          });
          return series;
        } catch (error) {
          const msg = String(error?.message || error || 'unknown error');
          const unavailable = msg.includes('Cannot find metric(s) that match type') || msg.includes('not found');
          if (!unavailable) {
            warnings.push(`${label} metric query failed: ${normalizeMetricErrorMessage(error)}`);
            return [];
          }
        }
      }
      warnings.push(`${label} metric unavailable for this project/region`);
      return [];
    };

    const [readsSeries, writesSeries, deletesSeries, readsMtdSeries, writesMtdSeries, deletesMtdSeries, storageSeries] = await Promise.all([
      loadMetricSeriesSafe({
        label: 'Firestore reads',
        filters: metricFilters.reads,
        startTime: start,
        endTime: now,
        aligner: 'ALIGN_DELTA',
        alignmentPeriod: '3600s'
      }),
      loadMetricSeriesSafe({
        label: 'Firestore writes',
        filters: metricFilters.writes,
        startTime: start,
        endTime: now,
        aligner: 'ALIGN_DELTA',
        alignmentPeriod: '3600s'
      }),
      loadMetricSeriesSafe({
        label: 'Firestore deletes',
        filters: metricFilters.deletes,
        startTime: start,
        endTime: now,
        aligner: 'ALIGN_DELTA',
        alignmentPeriod: '3600s'
      }),
      loadMetricSeriesSafe({
        label: 'Firestore reads (MTD)',
        filters: metricFilters.reads,
        startTime: monthStart,
        endTime: now,
        aligner: 'ALIGN_DELTA',
        alignmentPeriod: '86400s'
      }),
      loadMetricSeriesSafe({
        label: 'Firestore writes (MTD)',
        filters: metricFilters.writes,
        startTime: monthStart,
        endTime: now,
        aligner: 'ALIGN_DELTA',
        alignmentPeriod: '86400s'
      }),
      loadMetricSeriesSafe({
        label: 'Firestore deletes (MTD)',
        filters: metricFilters.deletes,
        startTime: monthStart,
        endTime: now,
        aligner: 'ALIGN_DELTA',
        alignmentPeriod: '86400s'
      }),
      loadMetricSeriesSafe({
        label: 'Firestore storage',
        filters: metricFilters.storageCandidates,
        startTime: start,
        endTime: now,
        aligner: 'ALIGN_MEAN',
        alignmentPeriod: '3600s'
      })
    ]);

    const readsMtd = Math.round(sumSeriesValues(readsMtdSeries));
    const writesMtd = Math.round(sumSeriesValues(writesMtdSeries));
    const deletesMtd = Math.round(sumSeriesValues(deletesMtdSeries));
    const firestoreUsageEstimate = estimateFirestoreCostFromUsage(readsMtd, writesMtd, deletesMtd, now);
    const firestoreDocOpsCostUsd = Number.isFinite(Number(firestoreUsageEstimate?.totalUsd))
      ? Number(firestoreUsageEstimate.totalUsd)
      : null;
    const firestoreDocOpsBreakdown = Array.isArray(firestoreUsageEstimate?.services)
      ? firestoreUsageEstimate.services
      : [];

    // Fetch real project billing cost per service from Cloud Billing API
    let projectBillingData = null;
    let usedMonitoringBillingFallback = false;
    try {
      projectBillingData = await fetchCloudBillingCost(projectId);
      if (projectBillingData && !projectBillingData.source) {
        projectBillingData.source = 'cloud-billing';
      }
      const total = Number(projectBillingData?.totalUsd || 0);
      const serviceCount = Array.isArray(projectBillingData?.services) ? projectBillingData.services.length : 0;
      console.log(`[Admin] Cloud Billing cost fetched: $${total.toFixed(2)} across ${serviceCount} services`);
    } catch (billingErr) {
      if (billingErr.isBillingIamError) {
        warnings.push(billingErr.message);
        projectBillingData = {
          services: null,
          totalUsd: firestoreDocOpsCostUsd,
          accountId: null,
          raw: null,
          isEstimate: true,
          source: Number.isFinite(firestoreDocOpsCostUsd) ? 'firestore-doc-ops-estimate' : 'unavailable'
        };
        warnings.push(
          'Project-level billing unavailable. Showing Firestore doc-op estimate only for reads/writes/deletes.'
        );
      } else if (billingErr.isBillingReportsUnavailable) {
        // Fallback 1: Cloud Monitoring billing metrics
        const billingMtdSeries = await loadMetricSeriesSafe({
          label: 'Billing cost (Monitoring fallback)',
          filters: metricFilters.billingCostCandidates,
          startTime: monthStart,
          endTime: now,
          aligner: 'ALIGN_SUM',
          alignmentPeriod: '86400s'
        });

        const fallbackTotal = billingMtdSeries.length ? sumSeriesValues(billingMtdSeries) : null;
        if (Number.isFinite(fallbackTotal) && fallbackTotal > 0) {
          projectBillingData = {
            services: null,
            totalUsd: fallbackTotal,
            accountId: null,
            raw: null,
            isEstimate: true,
            source: 'monitoring-billing-fallback'
          };
          usedMonitoringBillingFallback = true;
          warnings.push('Billing service breakdown unavailable; using Monitoring total-cost fallback.');
        } else {
          // Fallback 2: no project-level billing data available
          projectBillingData = {
            services: null,
            totalUsd: firestoreDocOpsCostUsd,
            accountId: null,
            raw: null,
            isEstimate: true,
            source: Number.isFinite(firestoreDocOpsCostUsd) ? 'firestore-doc-ops-estimate' : 'unavailable'
          };
          warnings.push(
            'Project-level billing unavailable. Showing Firestore doc-op estimate only for reads/writes/deletes.'
          );
        }
      } else {
        warnings.push(`Billing cost unavailable: ${normalizeMetricErrorMessage(billingErr)}`);
        console.warn('[Admin] fetchCloudBillingCost error:', billingErr.message);
      }
    }

    const trendMap = new Map();
    for (const point of readsSeries) {
      const existing = trendMap.get(point.timestamp) || { timestamp: point.timestamp, reads: 0, writes: 0, deletes: 0 };
      existing.reads = Number(point.value || 0);
      trendMap.set(point.timestamp, existing);
    }
    for (const point of writesSeries) {
      const existing = trendMap.get(point.timestamp) || { timestamp: point.timestamp, reads: 0, writes: 0, deletes: 0 };
      existing.writes = Number(point.value || 0);
      trendMap.set(point.timestamp, existing);
    }
    for (const point of deletesSeries) {
      const existing = trendMap.get(point.timestamp) || { timestamp: point.timestamp, reads: 0, writes: 0, deletes: 0 };
      existing.deletes = Number(point.value || 0);
      trendMap.set(point.timestamp, existing);
    }

    const trend = Array.from(trendMap.values())
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const latestStorageBytes = storageSeries.length
      ? Number(storageSeries[storageSeries.length - 1].value || 0)
      : null;
    const storageGb = Number.isFinite(latestStorageBytes) ? (latestStorageBytes / (1024 * 1024 * 1024)) : null;

    res.json({
      errno: 0,
      result: {
        source: (() => {
          if (!projectBillingData) return 'gcp-monitoring';
          if (usedMonitoringBillingFallback) return 'gcp-monitoring+monitoring-billing-fallback';
          if (projectBillingData.isEstimate) return 'gcp-monitoring+usage-estimate';
          return 'gcp-monitoring+cloud-billing';
        })(),
        projectId,
        updatedAt: now.toISOString(),
        windowHours: hours,
        firestore: {
          readsMtd,
          writesMtd,
          deletesMtd,
          storageGb,
          estimatedDocOpsCostUsd: firestoreDocOpsCostUsd,
          estimatedDocOpsBreakdown: firestoreDocOpsBreakdown
        },
        billing: {
          // Preferred explicit fields
          projectMtdCostUsd: projectBillingData ? projectBillingData.totalUsd : null,
          projectServices: projectBillingData ? projectBillingData.services : null,
          projectBillingAccountId: projectBillingData ? projectBillingData.accountId : null,
          projectCostIsEstimate: projectBillingData ? (projectBillingData.isEstimate === true) : false,
          projectCostSource: projectBillingData ? (projectBillingData.source || 'unknown') : null,
          // Backward-compatible fields
          estimatedMtdCostUsd: projectBillingData ? projectBillingData.totalUsd : null,
          services: projectBillingData ? projectBillingData.services : null,
          billingAccountId: projectBillingData ? projectBillingData.accountId : null,
          isEstimate: projectBillingData ? (projectBillingData.isEstimate === true) : false,
          costSource: projectBillingData ? (projectBillingData.source || 'unknown') : null
        },
        trend,
        warnings
      }
    });
  } catch (error) {
    console.error('[Admin] Error loading Firestore metrics:', error);
    res.status(500).json({ errno: 500, error: error.message || String(error), result: { warnings } });
  }
});

/**
 * GET /api/admin/users - List all registered users with basic info
 */
app.get('/api/admin/users', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const usersSnap = await db.collection('users').get();
    const profileByUid = new Map();
    usersSnap.docs.forEach((doc) => {
      profileByUid.set(doc.id, doc.data() || {});
    });

    // Include users that authenticated but never completed onboarding/profile init.
    // Those users exist in Firebase Auth but may be missing users/{uid} docs.
    const authByUid = new Map();
    try {
      let pageToken;
      do {
        const page = await admin.auth().listUsers(1000, pageToken);
        (page.users || []).forEach((userRecord) => {
          authByUid.set(userRecord.uid, userRecord);
        });
        pageToken = page.pageToken;
      } while (pageToken);
    } catch (authListErr) {
      console.warn('[Admin] listUsers failed; falling back to Firestore-only users:', authListErr.message || authListErr);
    }

    const allUids = new Set([...profileByUid.keys(), ...authByUid.keys()]);

    const users = await Promise.all(Array.from(allUids).map(async (uid) => {
      const data = profileByUid.get(uid) || {};
      const authUser = authByUid.get(uid) || null;
      const authMetadata = authUser && authUser.metadata ? authUser.metadata : null;

      let rulesCount = 0;
      let configMain = null;
      try {
        const [rulesSnap, configDoc] = await Promise.all([
          db.collection('users').doc(uid).collection('rules').get(),
          db.collection('users').doc(uid).collection('config').doc('main').get()
        ]);
        rulesCount = rulesSnap.size;
        configMain = configDoc.exists ? (configDoc.data() || {}) : null;
      } catch (e) {
        // Ignore per-user failures and keep endpoint resilient
      }

      // Joined date: prefer Firebase Auth creation time (source of truth),
      // then fall back to Firestore createdAt for backward compatibility.
      const joinedAt = (authMetadata && authMetadata.creationTime) ? authMetadata.creationTime : (data.createdAt || null);
      const email = data.email || (authUser && authUser.email ? authUser.email : '');
      const emailLc = String(email || '').toLowerCase();
      const isSeedAdmin = emailLc === SEED_ADMIN_EMAIL;

      const hasDeviceSn = !!configMain?.deviceSn;
      const hasFoxessToken = !!configMain?.foxessToken;
      const hasAmberApiKey = !!configMain?.amberApiKey;
      const configured = !!(configMain?.setupComplete === true || (hasDeviceSn && hasFoxessToken));

      return {
        uid,
        email,
        role: data.role || (isSeedAdmin ? 'admin' : 'user'),
        configured,
        hasDeviceSn,
        hasFoxessToken,
        hasAmberApiKey,
        inverterCapacityW: Number.isFinite(Number(configMain?.inverterCapacityW)) ? Number(configMain.inverterCapacityW) : null,
        batteryCapacityKWh: Number.isFinite(Number(configMain?.batteryCapacityKWh)) ? Number(configMain.batteryCapacityKWh) : null,
        automationEnabled: !!data.automationEnabled,
        createdAt: data.createdAt || null,
        joinedAt,
        lastSignedInAt: (authMetadata && authMetadata.lastSignInTime) ? authMetadata.lastSignInTime : null,
        rulesCount,
        profileInitialized: profileByUid.has(uid),
        lastUpdated: data.lastUpdated || null
      };
    }));

    res.json({ errno: 0, result: { users } });
  } catch (error) {
    console.error('[Admin] Error listing users:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

/**
 * GET /api/admin/platform-stats - Compact platform KPIs + trend data
 * Query: ?days=90 (default 90, min 7, max 365)
 */
app.get('/api/admin/platform-stats', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const daysRaw = Number(req.query?.days);
    const days = Number.isFinite(daysRaw) ? Math.max(7, Math.min(365, Math.floor(daysRaw))) : 90;

    const toMs = (value) => {
      if (!value) return null;
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : parsed;
      }
      if (typeof value.toDate === 'function') {
        const d = value.toDate();
        return d && d.getTime ? d.getTime() : null;
      }
      if (Number.isFinite(value._seconds)) return value._seconds * 1000;
      if (Number.isFinite(value.seconds)) return value.seconds * 1000;
      return null;
    };

    // Build date window in UTC date keys (YYYY-MM-DD)
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const startUtc = todayUtc - (days - 1) * 24 * 60 * 60 * 1000;

    const dateBuckets = [];
    for (let i = 0; i < days; i++) {
      const dayMs = startUtc + i * 24 * 60 * 60 * 1000;
      const date = new Date(dayMs);
      const key = date.toISOString().slice(0, 10);
      dateBuckets.push({ key, dayStartMs: dayMs, dayEndMs: dayMs + (24 * 60 * 60 * 1000) - 1 });
    }

    // Load Firestore user profiles
    const usersSnap = await db.collection('users').get();
    const profileByUid = new Map();
    usersSnap.docs.forEach((doc) => {
      profileByUid.set(doc.id, doc.data() || {});
    });

    // Load Firebase Auth users (captures onboarding-only users)
    const authByUid = new Map();
    try {
      let pageToken;
      do {
        const page = await admin.auth().listUsers(1000, pageToken);
        (page.users || []).forEach((userRecord) => authByUid.set(userRecord.uid, userRecord));
        pageToken = page.pageToken;
      } while (pageToken);
    } catch (authErr) {
      console.warn('[Admin] platform-stats listUsers failed:', authErr.message || authErr);
    }

    const allUids = new Set([...profileByUid.keys(), ...authByUid.keys()]);

    const users = await Promise.all(Array.from(allUids).map(async (uid) => {
      const profile = profileByUid.get(uid) || {};
      const authUser = authByUid.get(uid) || null;
      const authMetadata = authUser && authUser.metadata ? authUser.metadata : null;

      const email = profile.email || (authUser?.email || '');
      const emailLc = String(email || '').toLowerCase();
      const role = profile.role || (emailLc === SEED_ADMIN_EMAIL ? 'admin' : 'user');

      const joinedAtMs = toMs(authMetadata?.creationTime) || toMs(profile.createdAt);
      const lastSignInMs = toMs(authMetadata?.lastSignInTime) || null;

      let configured = false;
      let configuredAtMs = null;
      let firstRuleAtMs = null;
      let hasRules = false;
      if (profileByUid.has(uid)) {
        try {
          const cfgDoc = await db.collection('users').doc(uid).collection('config').doc('main').get();
          if (cfgDoc.exists) {
            const cfg = cfgDoc.data() || {};
            configured = !!(cfg.setupComplete || cfg.deviceSn || cfg.foxessToken || cfg.amberApiKey);
            if (configured) {
              configuredAtMs =
                toMs(cfg.setupCompletedAt) ||
                toMs(cfg.firstConfiguredAt) ||
                toMs(cfg.updatedAt) ||
                toMs(cfg.createdAt) ||
                toMs(profile.lastUpdated) ||
                joinedAtMs;
            }
          }
        } catch (cfgErr) {
          // Keep endpoint resilient for per-user errors
        }

        try {
          let firstRuleSnap = await db.collection('users').doc(uid)
            .collection('rules')
            .orderBy('createdAt', 'asc')
            .limit(1)
            .get();

          // Fallback for legacy rules missing createdAt
          if (firstRuleSnap.empty) {
            firstRuleSnap = await db.collection('users').doc(uid)
              .collection('rules')
              .limit(1)
              .get();
          }

          if (!firstRuleSnap.empty) {
            hasRules = true;
            const firstRule = firstRuleSnap.docs[0].data() || {};
            firstRuleAtMs =
              toMs(firstRule.createdAt) ||
              toMs(firstRule.updatedAt) ||
              configuredAtMs ||
              toMs(profile.lastUpdated) ||
              joinedAtMs;
          }
        } catch (ruleErr) {
          // Keep endpoint resilient for per-user errors
        }
      }

      return {
        uid,
        role,
        automationEnabled: !!profile.automationEnabled,
        joinedAtMs,
        lastSignInMs,
        configured,
        configuredAtMs,
        hasRules,
        firstRuleAtMs
      };
    }));

    const joinedSeries = users
      .map((u) => u.joinedAtMs)
      .filter((ms) => Number.isFinite(ms))
      .sort((a, b) => a - b);

    const configuredSeries = users
      .map((u) => u.configuredAtMs)
      .filter((ms) => Number.isFinite(ms))
      .sort((a, b) => a - b);

    const rulesSeries = users
      .map((u) => u.firstRuleAtMs)
      .filter((ms) => Number.isFinite(ms))
      .sort((a, b) => a - b);

    // Load deletion timestamps from admin_audit
    const deletionSeries = [];
    try {
      const auditSnap = await db.collection('admin_audit')
        .where('action', '==', 'delete_user')
        .get();
      auditSnap.forEach((doc) => {
        const ts = toMs(doc.data().timestamp);
        if (Number.isFinite(ts)) deletionSeries.push(ts);
      });
      deletionSeries.sort((a, b) => a - b);
    } catch (auditErr) {
      console.warn('[Admin] platform-stats: could not load deletion audit log:', auditErr.message || auditErr);
    }

    let joinedIdx = 0;
    let configuredIdx = 0;
    let rulesIdx = 0;
    let deletionIdx = 0;
    let totalUsers = 0;
    let configuredUsers = 0;
    let usersWithRules = 0;
    let deletedUsers = 0;

    const trend = dateBuckets.map((bucket) => {
      while (joinedIdx < joinedSeries.length && joinedSeries[joinedIdx] <= bucket.dayEndMs) {
        totalUsers += 1;
        joinedIdx += 1;
      }
      while (configuredIdx < configuredSeries.length && configuredSeries[configuredIdx] <= bucket.dayEndMs) {
        configuredUsers += 1;
        configuredIdx += 1;
      }
      while (rulesIdx < rulesSeries.length && rulesSeries[rulesIdx] <= bucket.dayEndMs) {
        usersWithRules += 1;
        rulesIdx += 1;
      }
      while (deletionIdx < deletionSeries.length && deletionSeries[deletionIdx] <= bucket.dayEndMs) {
        deletedUsers += 1;
        deletionIdx += 1;
      }
      return {
        date: bucket.key,
        totalUsers,
        configuredUsers,
        usersWithRules,
        deletedUsers
      };
    });

    // MAU = users who signed in at least once in the current calendar month (UTC)
    const monthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const summary = {
      totalUsers: users.length,
      configuredUsers: users.filter((u) => u.configured).length,
      usersWithRules: users.filter((u) => u.hasRules).length,
      admins: users.filter((u) => u.role === 'admin').length,
      mau: users.filter((u) => u.lastSignInMs !== null && u.lastSignInMs >= monthStartMs).length,
      automationActive: users.filter((u) => u.automationEnabled).length
    };

    res.json({ errno: 0, result: { summary, trend, days } });
  } catch (error) {
    console.error('[Admin] Error loading platform stats:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

/**
 * GET /api/admin/scheduler-metrics - Scheduler dashboard read model
 * Query:
 *   - ?days=14 (default 14, min 1, max 90)
 *   - ?includeRuns=1 (optional)
 *   - ?runLimit=20 (default 20, min 1, max 100; only used when includeRuns=true)
 */
app.get('/api/admin/scheduler-metrics', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const parseBoundedInt = (value, fallback, min, max) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      const normalized = Math.floor(parsed);
      return Math.max(min, Math.min(max, normalized));
    };

    const toFiniteNumber = (value, fallback = 0) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const phaseTimingKeys = ['dataFetchMs', 'ruleEvalMs', 'actionApplyMs', 'curtailmentMs'];

    const sanitizeDurationStats = (value) => {
      const source = value && typeof value === 'object' ? value : {};
      return {
        avgMs: Math.max(0, toFiniteNumber(source.avgMs, 0)),
        count: Math.max(0, toFiniteNumber(source.count, 0)),
        maxMs: Math.max(0, toFiniteNumber(source.maxMs, 0)),
        minMs: Math.max(0, toFiniteNumber(source.minMs, 0)),
        p95Ms: Math.max(0, toFiniteNumber(source.p95Ms, 0)),
        p99Ms: Math.max(0, toFiniteNumber(source.p99Ms, 0))
      };
    };

    const sanitizePhaseTimingStats = (value) => {
      const source = value && typeof value === 'object' ? value : {};
      const out = {};
      for (const phaseKey of phaseTimingKeys) {
        out[phaseKey] = sanitizeDurationStats(source[phaseKey]);
      }
      return out;
    };

    const sanitizePhaseTimingMaxMs = (value) => {
      const source = value && typeof value === 'object' ? value : {};
      const out = {};
      for (const phaseKey of phaseTimingKeys) {
        out[phaseKey] = Math.max(0, toFiniteNumber(source[phaseKey], 0));
      }
      return out;
    };

    const extractPhaseTimingRunMaxMs = (phaseTimingStats) => {
      const source = phaseTimingStats && typeof phaseTimingStats === 'object' ? phaseTimingStats : {};
      const out = {};
      for (const phaseKey of phaseTimingKeys) {
        out[phaseKey] = Math.max(0, toFiniteNumber(source[phaseKey]?.maxMs, 0));
      }
      return out;
    };

    const sanitizeFailureByType = (value) => {
      const out = {};
      const source = value && typeof value === 'object' ? value : {};
      for (const [key, count] of Object.entries(source)) {
        const normalizedKey = String(key || '').trim();
        if (!normalizedKey) continue;
        const normalizedCount = toFiniteNumber(count, 0);
        if (normalizedCount > 0) {
          out[normalizedKey] = normalizedCount;
        }
      }
      return out;
    };

    const sanitizeSloSnapshot = (value) => {
      const source = value && typeof value === 'object' ? value : {};
      const statusRaw = String(source.status || '').trim().toLowerCase();
      const status = ['healthy', 'watch', 'breach'].includes(statusRaw) ? statusRaw : 'healthy';
      const sanitizeMetricList = (listValue) => (
        Array.isArray(listValue)
          ? listValue.map((entry) => String(entry || '').trim()).filter(Boolean)
          : []
      );
      return {
        status,
        monitoredAtMs: toFiniteNumber(source.monitoredAtMs, 0),
        thresholds: {
          errorRatePct: toFiniteNumber(source.thresholds?.errorRatePct, 0),
          deadLetterRatePct: toFiniteNumber(source.thresholds?.deadLetterRatePct, 0),
          maxQueueLagMs: toFiniteNumber(source.thresholds?.maxQueueLagMs, 0),
          maxCycleDurationMs: toFiniteNumber(source.thresholds?.maxCycleDurationMs, 0),
          p99CycleDurationMs: toFiniteNumber(source.thresholds?.p99CycleDurationMs, 0),
          tailP99CycleDurationMs: toFiniteNumber(source.thresholds?.tailP99CycleDurationMs, 0),
          tailWindowMinutes: toFiniteNumber(source.thresholds?.tailWindowMinutes, 0),
          tailMinRuns: toFiniteNumber(source.thresholds?.tailMinRuns, 0)
        },
        measurements: {
          cyclesRun: toFiniteNumber(source.measurements?.cyclesRun, 0),
          errors: toFiniteNumber(source.measurements?.errors, 0),
          deadLetters: toFiniteNumber(source.measurements?.deadLetters, 0),
          errorRatePct: toFiniteNumber(source.measurements?.errorRatePct, 0),
          deadLetterRatePct: toFiniteNumber(source.measurements?.deadLetterRatePct, 0),
          maxQueueLagMs: toFiniteNumber(source.measurements?.maxQueueLagMs, 0),
          maxCycleDurationMs: toFiniteNumber(source.measurements?.maxCycleDurationMs, 0),
          p95CycleDurationMs: toFiniteNumber(source.measurements?.p95CycleDurationMs, 0),
          p99CycleDurationMs: toFiniteNumber(source.measurements?.p99CycleDurationMs, 0),
          latestRunP99CycleDurationMs: toFiniteNumber(source.measurements?.latestRunP99CycleDurationMs, 0)
        },
        breachedMetrics: sanitizeMetricList(source.breachedMetrics),
        watchMetrics: sanitizeMetricList(source.watchMetrics)
      };
    };

    const sanitizeSlowCycleSamples = (value) => {
      return (Array.isArray(value) ? value : [])
        .map((entry, index) => {
          const source = entry && typeof entry === 'object' ? entry : {};
          return {
            rank: Math.max(1, Math.floor(toFiniteNumber(source.rank, index + 1))),
            userId: source.userId != null ? String(source.userId) : null,
            cycleKey: source.cycleKey != null ? String(source.cycleKey) : null,
            success: source.success === true,
            failureType: source.failureType ? String(source.failureType) : null,
            queueLagMs: Math.max(0, toFiniteNumber(source.queueLagMs, 0)),
            cycleDurationMs: Math.max(0, toFiniteNumber(source.cycleDurationMs, 0)),
            retriesUsed: Math.max(0, toFiniteNumber(source.retriesUsed, 0)),
            startedAtMs: Math.max(0, toFiniteNumber(source.startedAtMs, 0)),
            completedAtMs: Math.max(0, toFiniteNumber(source.completedAtMs, 0))
          };
        })
        .filter((entry) => entry.cycleDurationMs > 0)
        .sort((a, b) => b.cycleDurationMs - a.cycleDurationMs)
        .slice(0, 3)
        .map((entry, index) => ({ ...entry, rank: index + 1 }));
    };

    const sanitizeTailLatency = (value) => {
      const source = value && typeof value === 'object' ? value : {};
      const statusRaw = String(source.status || '').trim().toLowerCase();
      const status = ['healthy', 'watch', 'breach'].includes(statusRaw) ? statusRaw : 'healthy';
      return {
        metric: String(source.metric || 'sustainedP99CycleDurationMs'),
        status,
        thresholdMs: Math.max(0, toFiniteNumber(source.thresholdMs, 0)),
        windowMinutes: Math.max(0, toFiniteNumber(source.windowMinutes, 0)),
        minRuns: Math.max(0, toFiniteNumber(source.minRuns, 0)),
        observedRuns: Math.max(0, toFiniteNumber(source.observedRuns, 0)),
        runsAboveThreshold: Math.max(0, toFiniteNumber(source.runsAboveThreshold, 0)),
        ratioAboveThreshold: Math.max(0, toFiniteNumber(source.ratioAboveThreshold, 0)),
        latestP99Ms: Math.max(0, toFiniteNumber(source.latestP99Ms, 0)),
        minObservedP99Ms: Math.max(0, toFiniteNumber(source.minObservedP99Ms, 0)),
        maxObservedP99Ms: Math.max(0, toFiniteNumber(source.maxObservedP99Ms, 0)),
        windowStartMs: Math.max(0, toFiniteNumber(source.windowStartMs, 0)),
        windowEndMs: Math.max(0, toFiniteNumber(source.windowEndMs, 0))
      };
    };

    const mergeFailureByType = (target, source) => {
      const merged = { ...(target && typeof target === 'object' ? target : {}) };
      for (const [key, count] of Object.entries(source || {})) {
        merged[key] = toFiniteNumber(merged[key], 0) + toFiniteNumber(count, 0);
      }
      return merged;
    };

    const buildLikelyCauseTags = (run) => {
      const failureByType = run && typeof run.failureByType === 'object' ? run.failureByType : {};
      const skipped = run && typeof run.skipped === 'object' ? run.skipped : {};
      const tags = [];
      const apiFailureCount =
        toFiniteNumber(failureByType.api_timeout, 0) +
        toFiniteNumber(failureByType.api_rate_limit, 0) +
        toFiniteNumber(failureByType.network_error, 0) +
        toFiniteNumber(failureByType.service_unavailable, 0) +
        toFiniteNumber(failureByType.server_error, 0);
      const dbFailureCount =
        toFiniteNumber(failureByType.firestore_contention, 0) +
        toFiniteNumber(failureByType.conflict, 0);
      const lockSkips = toFiniteNumber(skipped.locked, 0);
      const idempotentSkips = toFiniteNumber(skipped.idempotent, 0);
      const retries = toFiniteNumber(run.retries, 0);
      const queueLagMaxMs = toFiniteNumber(run.queueLagMs?.maxMs, 0);

      if (apiFailureCount > 0 || retries > 0) {
        tags.push('external_api_slowness_or_retries');
      }
      if (dbFailureCount > 0) {
        tags.push('firestore_contention_or_conflicts');
      }
      if (lockSkips > 0) {
        tags.push('lock_contention');
      }
      if (idempotentSkips > 0) {
        tags.push('overlapping_scheduler_invocations');
      }
      if (queueLagMaxMs >= 10000) {
        tags.push('possible_cold_start_or_invocation_backlog');
      }

      if (!tags.length) {
        tags.push('no_clear_cause_from_scheduler_metrics');
      }
      return tags;
    };

    const buildTailLatencyFromRuns = (runs = [], thresholdMs = 10000, windowMinutes = 15, minRuns = 10) => {
      const nowMs = Date.now();
      const windowStartMs = nowMs - (Math.max(1, windowMinutes) * 60 * 1000);
      const inWindowRuns = (Array.isArray(runs) ? runs : []).filter(
        (run) => toFiniteNumber(run.startedAtMs, 0) >= windowStartMs
      );
      const p99Values = inWindowRuns
        .map((run) => toFiniteNumber(run.cycleDurationMs?.p99Ms, toFiniteNumber(run.cycleDurationMs?.maxMs, 0)))
        .filter((value) => Number.isFinite(value) && value >= 0);
      const runsAboveThreshold = thresholdMs > 0
        ? p99Values.filter((value) => value > thresholdMs).length
        : 0;
      const ratioAboveThreshold = p99Values.length > 0
        ? Number((runsAboveThreshold / p99Values.length).toFixed(4))
        : 0;
      let status = 'healthy';
      if (p99Values.length >= minRuns && thresholdMs > 0) {
        if (runsAboveThreshold === p99Values.length) {
          status = 'breach';
        } else if (ratioAboveThreshold >= 0.8) {
          status = 'watch';
        }
      }

      return {
        metric: 'sustainedP99CycleDurationMs',
        status,
        thresholdMs,
        windowMinutes,
        minRuns,
        observedRuns: p99Values.length,
        runsAboveThreshold,
        ratioAboveThreshold,
        latestP99Ms: p99Values.length > 0 ? p99Values[0] : 0,
        minObservedP99Ms: p99Values.length > 0 ? Math.min(...p99Values) : 0,
        maxObservedP99Ms: p99Values.length > 0 ? Math.max(...p99Values) : 0,
        windowStartMs,
        windowEndMs: nowMs
      };
    };

    const days = parseBoundedInt(req.query?.days, 14, 1, 90);
    const includeRunsRaw = String(req.query?.includeRuns || '').toLowerCase();
    const includeRuns = ['1', 'true', 'yes', 'y'].includes(includeRunsRaw);
    const runLimit = parseBoundedInt(req.query?.runLimit, 20, 1, 100);

    const metricsRootRef = db.collection('metrics').doc('automationScheduler');
    const dailySnapshot = await metricsRootRef
      .collection('daily')
      .orderBy('dayKey', 'desc')
      .limit(days)
      .get();

    const dailyDesc = [];
    dailySnapshot.forEach((doc) => {
      const data = doc.data() || {};
      dailyDesc.push({
        dayKey: data.dayKey || doc.id,
        runs: toFiniteNumber(data.runs, 0),
        totalEnabledUsers: toFiniteNumber(data.totalEnabledUsers, 0),
        cycleCandidates: toFiniteNumber(data.cycleCandidates, 0),
        cyclesRun: toFiniteNumber(data.cyclesRun, 0),
        deadLetters: toFiniteNumber(data.deadLetters, 0),
        errors: toFiniteNumber(data.errors, 0),
        retries: toFiniteNumber(data.retries, 0),
        maxQueueLagMs: toFiniteNumber(data.maxQueueLagMs, 0),
        maxCycleDurationMs: toFiniteNumber(data.maxCycleDurationMs, 0),
        p95CycleDurationMs: toFiniteNumber(data.p95CycleDurationMs, 0),
        p99CycleDurationMs: toFiniteNumber(data.p99CycleDurationMs, 0),
        avgCycleDurationMs: data.avgCycleDurationSamples > 0
          ? toFiniteNumber(data.avgCycleDurationTotalMs, 0) / toFiniteNumber(data.avgCycleDurationSamples, 1)
          : 0,
        phaseTimingsMaxMs: sanitizePhaseTimingMaxMs(data.phaseTimingsMaxMs),
        skipped: {
          disabledOrBlackout: toFiniteNumber(data.skipped?.disabledOrBlackout, 0),
          idempotent: toFiniteNumber(data.skipped?.idempotent, 0),
          locked: toFiniteNumber(data.skipped?.locked, 0),
          tooSoon: toFiniteNumber(data.skipped?.tooSoon, 0)
        },
        failureByType: sanitizeFailureByType(data.failureByType),
        slo: sanitizeSloSnapshot(data.slo),
        updatedAtMs: toFiniteNumber(data.lastRunAtMs, 0)
      });
    });

    const summary = {
      runs: 0,
      totalEnabledUsers: 0,
      cycleCandidates: 0,
      cyclesRun: 0,
      deadLetters: 0,
      errors: 0,
      retries: 0,
      maxQueueLagMs: 0,
      maxCycleDurationMs: 0,
      p95CycleDurationMs: 0,
      p99CycleDurationMs: 0,
      phaseTimingsMaxMs: sanitizePhaseTimingMaxMs(null),
      skipped: {
        disabledOrBlackout: 0,
        idempotent: 0,
        locked: 0,
        tooSoon: 0
      },
      failureByType: {}
    };

    for (const day of dailyDesc) {
      summary.runs += day.runs;
      summary.totalEnabledUsers += day.totalEnabledUsers;
      summary.cycleCandidates += day.cycleCandidates;
      summary.cyclesRun += day.cyclesRun;
      summary.deadLetters += day.deadLetters;
      summary.errors += day.errors;
      summary.retries += day.retries;
      summary.maxQueueLagMs = Math.max(summary.maxQueueLagMs, day.maxQueueLagMs);
      summary.maxCycleDurationMs = Math.max(summary.maxCycleDurationMs, day.maxCycleDurationMs);
      summary.p95CycleDurationMs = Math.max(summary.p95CycleDurationMs, day.p95CycleDurationMs);
      summary.p99CycleDurationMs = Math.max(summary.p99CycleDurationMs, day.p99CycleDurationMs);
      for (const phaseKey of phaseTimingKeys) {
        summary.phaseTimingsMaxMs[phaseKey] = Math.max(
          toFiniteNumber(summary.phaseTimingsMaxMs[phaseKey], 0),
          toFiniteNumber(day.phaseTimingsMaxMs?.[phaseKey], 0)
        );
      }
      summary.skipped.disabledOrBlackout += day.skipped.disabledOrBlackout;
      summary.skipped.idempotent += day.skipped.idempotent;
      summary.skipped.locked += day.skipped.locked;
      summary.skipped.tooSoon += day.skipped.tooSoon;
      summary.failureByType = mergeFailureByType(summary.failureByType, day.failureByType);
    }

    const soak = buildSchedulerSoakSummary({
      dailyDesc,
      daysRequested: days
    });

    const errorRatePct = summary.cyclesRun > 0
      ? Number(((summary.errors / summary.cyclesRun) * 100).toFixed(2))
      : 0;

    let recentRuns = [];
    if (includeRuns) {
      const runSnapshot = await metricsRootRef
        .collection('runs')
        .orderBy('startedAtMs', 'desc')
        .limit(runLimit)
        .get();

      recentRuns = [];
      runSnapshot.forEach((doc) => {
        const data = doc.data() || {};
        recentRuns.push({
          runId: data.runId || doc.id,
          schedulerId: data.schedulerId || null,
          workerId: data.workerId || null,
          dayKey: data.dayKey || null,
          startedAtMs: toFiniteNumber(data.startedAtMs, 0),
          completedAtMs: toFiniteNumber(data.completedAtMs, 0),
          durationMs: toFiniteNumber(data.durationMs, 0),
          totalEnabledUsers: toFiniteNumber(data.totalEnabledUsers, 0),
          cycleCandidates: toFiniteNumber(data.cycleCandidates, 0),
          cyclesRun: toFiniteNumber(data.cyclesRun, 0),
          deadLetters: toFiniteNumber(data.deadLetters, 0),
          errors: toFiniteNumber(data.errors, 0),
          retries: toFiniteNumber(data.retries, 0),
          queueLagMs: sanitizeDurationStats(data.queueLagMs),
          cycleDurationMs: sanitizeDurationStats(data.cycleDurationMs),
          phaseTimingsMs: sanitizePhaseTimingStats(data.phaseTimingsMs),
          skipped: {
            disabledOrBlackout: toFiniteNumber(data.skipped?.disabledOrBlackout, 0),
            idempotent: toFiniteNumber(data.skipped?.idempotent, 0),
            locked: toFiniteNumber(data.skipped?.locked, 0),
            tooSoon: toFiniteNumber(data.skipped?.tooSoon, 0)
          },
          failureByType: sanitizeFailureByType(data.failureByType),
          slo: sanitizeSloSnapshot(data.slo),
          slowCycleSamples: sanitizeSlowCycleSamples(data.slowCycleSamples)
        });
      });
    }

    const latestRun = recentRuns.length > 0 ? recentRuns[0] : null;
    const latestRunPhaseTimingsMaxMs = latestRun
      ? sanitizePhaseTimingMaxMs(extractPhaseTimingRunMaxMs(latestRun.phaseTimingsMs))
      : sanitizePhaseTimingMaxMs(null);

    let outlierRun = null;
    if (recentRuns.length > 0) {
      outlierRun = recentRuns
        .slice()
        .sort((a, b) => toFiniteNumber(b.cycleDurationMs?.maxMs, 0) - toFiniteNumber(a.cycleDurationMs?.maxMs, 0))[0] || null;
      if (outlierRun) {
        const slowestCycle = Array.isArray(outlierRun.slowCycleSamples) && outlierRun.slowCycleSamples.length
          ? outlierRun.slowCycleSamples[0]
          : null;
        outlierRun = {
          runId: outlierRun.runId,
          schedulerId: outlierRun.schedulerId,
          workerId: outlierRun.workerId || null,
          startedAtMs: outlierRun.startedAtMs,
          startedAtIso: outlierRun.startedAtMs ? new Date(outlierRun.startedAtMs).toISOString() : null,
          maxCycleDurationMs: toFiniteNumber(outlierRun.cycleDurationMs?.maxMs, 0),
          p95CycleDurationMs: toFiniteNumber(outlierRun.cycleDurationMs?.p95Ms, 0),
          p99CycleDurationMs: toFiniteNumber(outlierRun.cycleDurationMs?.p99Ms, 0),
          queueLagMaxMs: toFiniteNumber(outlierRun.queueLagMs?.maxMs, 0),
          retries: toFiniteNumber(outlierRun.retries, 0),
          errors: toFiniteNumber(outlierRun.errors, 0),
          deadLetters: toFiniteNumber(outlierRun.deadLetters, 0),
          skipped: outlierRun.skipped,
          failureByType: outlierRun.failureByType,
          likelyCauses: buildLikelyCauseTags(outlierRun),
          slowestCycle: slowestCycle
            ? {
                userId: slowestCycle.userId,
                cycleKey: slowestCycle.cycleKey,
                durationMs: slowestCycle.cycleDurationMs,
                queueLagMs: slowestCycle.queueLagMs,
                retriesUsed: slowestCycle.retriesUsed,
                failureType: slowestCycle.failureType,
                startedAtMs: slowestCycle.startedAtMs,
                completedAtMs: slowestCycle.completedAtMs
              }
            : null
        };
      }
    }

    let currentAlert = null;
    try {
      const currentAlertSnapshot = await metricsRootRef.collection('alerts').doc('current').get();
      if (currentAlertSnapshot.exists) {
        const alertData = currentAlertSnapshot.data() || {};
        currentAlert = {
          dayKey: alertData.dayKey || null,
          runId: alertData.runId || null,
          schedulerId: alertData.schedulerId || null,
          workerId: alertData.workerId || null,
          status: sanitizeSloSnapshot({ status: alertData.status }).status,
          breachedMetrics: Array.isArray(alertData.breachedMetrics)
            ? alertData.breachedMetrics.map((entry) => String(entry || '').trim()).filter(Boolean)
            : [],
          watchMetrics: Array.isArray(alertData.watchMetrics)
            ? alertData.watchMetrics.map((entry) => String(entry || '').trim()).filter(Boolean)
            : [],
          monitoredAtMs: toFiniteNumber(alertData.monitoredAtMs, 0),
          thresholds: {
            errorRatePct: toFiniteNumber(alertData.thresholds?.errorRatePct, 0),
            deadLetterRatePct: toFiniteNumber(alertData.thresholds?.deadLetterRatePct, 0),
            maxQueueLagMs: toFiniteNumber(alertData.thresholds?.maxQueueLagMs, 0),
            maxCycleDurationMs: toFiniteNumber(alertData.thresholds?.maxCycleDurationMs, 0),
            p99CycleDurationMs: toFiniteNumber(alertData.thresholds?.p99CycleDurationMs, 0),
            tailP99CycleDurationMs: toFiniteNumber(alertData.thresholds?.tailP99CycleDurationMs, 0),
            tailWindowMinutes: toFiniteNumber(alertData.thresholds?.tailWindowMinutes, 0),
            tailMinRuns: toFiniteNumber(alertData.thresholds?.tailMinRuns, 0)
          },
          measurements: {
            cyclesRun: toFiniteNumber(alertData.measurements?.cyclesRun, 0),
            errors: toFiniteNumber(alertData.measurements?.errors, 0),
            deadLetters: toFiniteNumber(alertData.measurements?.deadLetters, 0),
            errorRatePct: toFiniteNumber(alertData.measurements?.errorRatePct, 0),
            deadLetterRatePct: toFiniteNumber(alertData.measurements?.deadLetterRatePct, 0),
            maxQueueLagMs: toFiniteNumber(alertData.measurements?.maxQueueLagMs, 0),
            maxCycleDurationMs: toFiniteNumber(alertData.measurements?.maxCycleDurationMs, 0),
            p95CycleDurationMs: toFiniteNumber(alertData.measurements?.p95CycleDurationMs, 0),
            p99CycleDurationMs: toFiniteNumber(alertData.measurements?.p99CycleDurationMs, 0),
            latestRunP99CycleDurationMs: toFiniteNumber(alertData.measurements?.latestRunP99CycleDurationMs, 0)
          },
          tailLatency: sanitizeTailLatency(alertData.tailLatency)
        };
      }
    } catch (alertError) {
      console.warn('[Admin] scheduler-metrics current alert lookup failed:', alertError.message || alertError);
    }

    const tailThresholdMs = toFiniteNumber(
      currentAlert?.thresholds?.tailP99CycleDurationMs,
      toFiniteNumber(currentAlert?.thresholds?.p99CycleDurationMs, 10000)
    );
    const tailWindowMinutes = Math.max(1, toFiniteNumber(currentAlert?.thresholds?.tailWindowMinutes, 15));
    const tailMinRuns = Math.max(1, toFiniteNumber(currentAlert?.thresholds?.tailMinRuns, 10));
    const tailLatency = currentAlert && currentAlert.tailLatency
      ? currentAlert.tailLatency
      : buildTailLatencyFromRuns(recentRuns, tailThresholdMs, tailWindowMinutes, tailMinRuns);

    res.json({
      errno: 0,
      result: {
        days,
        includeRuns,
        runLimit: includeRuns ? runLimit : 0,
        summary: {
          ...summary,
          errorRatePct
        },
        soak,
        daily: dailyDesc.slice().reverse(),
        recentRuns,
        currentAlert,
        diagnostics: {
          tailLatency,
          outlierRun,
          phaseTimings: {
            latestRunStartedAtMs: toFiniteNumber(latestRun?.startedAtMs, 0),
            latestRunMaxMs: latestRunPhaseTimingsMaxMs,
            windowMaxMs: sanitizePhaseTimingMaxMs(summary.phaseTimingsMaxMs)
          }
        },
        updatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[Admin] Error loading scheduler metrics:', error);
    res.status(500).json({ errno: 500, error: error.message || String(error) });
  }
});
/**
 * POST /api/admin/users/:uid/role - Update a user's role
 * Body: { role: 'admin' | 'user' }
 */
app.post('/api/admin/users/:uid/role', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    const { role } = req.body;
    if (!uid) {
      return res.status(400).json({ errno: 400, error: 'uid is required' });
    }
    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ errno: 400, error: 'Role must be "admin" or "user"' });
    }
    // Prevent removing your own admin role
    if (uid === req.user.uid && role !== 'admin') {
      return res.status(400).json({ errno: 400, error: 'Cannot remove your own admin role' });
    }

    let authUser;
    try {
      authUser = await admin.auth().getUser(uid);
    } catch (authErr) {
      if (authErr && authErr.code === 'auth/user-not-found') {
        return res.status(404).json({ errno: 404, error: 'User not found' });
      }
      throw authErr;
    }

    const currentClaims = (authUser && authUser.customClaims && typeof authUser.customClaims === 'object')
      ? authUser.customClaims
      : {};
    const updatedClaims = { ...currentClaims };
    if (role === 'admin') {
      updatedClaims.admin = true;
    } else {
      delete updatedClaims.admin;
    }

    await admin.auth().setCustomUserClaims(uid, updatedClaims);
    try {
      await db.collection('users').doc(uid).set({ role, lastUpdated: serverTimestamp() }, { merge: true });
    } catch (firestoreErr) {
      // Best-effort rollback: avoid leaving auth claims out of sync if Firestore update fails.
      await admin.auth().setCustomUserClaims(uid, currentClaims).catch((rollbackErr) => {
        console.error('[Admin] Failed to rollback custom claims after Firestore role update error:', rollbackErr);
      });
      throw firestoreErr;
    }

    res.json({ errno: 0, result: { uid, role, customClaimsUpdated: true } });
  } catch (error) {
    console.error('[Admin] Error setting role:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

/**
 * POST /api/admin/users/:uid/delete - Delete user account and all Firestore data
 * Body: { confirmText: 'DELETE' }
 */
app.post('/api/admin/users/:uid/delete', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    const confirmText = String(req.body?.confirmText || '').trim();

    if (!uid) {
      return res.status(400).json({ errno: 400, error: 'uid is required' });
    }
    if (confirmText !== 'DELETE') {
      return res.status(400).json({ errno: 400, error: 'Confirmation text must be DELETE' });
    }
    if (uid === req.user.uid) {
      return res.status(400).json({ errno: 400, error: 'Cannot delete your own admin account from this endpoint' });
    }

    let targetUser;
    try {
      targetUser = await admin.auth().getUser(uid);
    } catch (e) {
      return res.status(404).json({ errno: 404, error: 'User not found' });
    }

    await deleteUserDataTree(uid);

    try {
      await deleteCollectionDocs(db.collection('admin_audit').where('adminUid', '==', uid));
      await deleteCollectionDocs(db.collection('admin_audit').where('targetUid', '==', uid));
    } catch (auditError) {
      console.warn('[AdminDelete] Failed to clean admin_audit references:', auditError.message || auditError);
    }

    try {
      await admin.auth().deleteUser(uid);
    } catch (authErr) {
      if (!authErr || authErr.code !== 'auth/user-not-found') {
        throw authErr;
      }
    }

    await db.collection('admin_audit').add({
      action: 'delete_user',
      adminUid: req.user.uid,
      adminEmail: req.user.email,
      targetUid: uid,
      targetEmail: targetUser.email || '',
      timestamp: serverTimestamp()
    });

    res.json({ errno: 0, result: { deleted: true, uid, email: targetUser.email || '' } });
  } catch (error) {
    console.error('[Admin] Error deleting user:', error);
    res.status(500).json({ errno: 500, error: error.message || String(error) });
  }
});

/**
 * GET /api/admin/users/:uid/stats - Get utilization stats for a specific user
 * Returns last 30 days of per-user API metrics, automation state, rule count, and config summary
 */
app.get('/api/admin/users/:uid/stats', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    
    // 1. Gather last 30 days of per-user API metrics
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const metricsSnap = await db.collection('users').doc(uid)
      .collection('metrics').orderBy('updatedAt', 'desc').limit(30).get();
    const metrics = {};
    metricsSnap.forEach(doc => {
      metrics[doc.id] = { foxess: doc.data().foxess || 0, amber: doc.data().amber || 0, weather: doc.data().weather || 0 };
    });

    // 2. Automation state
    let automationState = null;
    try {
      const stateDoc = await db.collection('users').doc(uid).collection('automation').doc('state').get();
      automationState = stateDoc.exists ? stateDoc.data() : null;
    } catch (e) { /* ignore */ }

    // 3. Rule count
    let ruleCount = 0;
    try {
      const rulesSnap = await db.collection('users').doc(uid).collection('rules').get();
      ruleCount = rulesSnap.size;
    } catch (e) { /* ignore */ }

    // 4. Config summary (no secrets)
    let configSummary = {};
    try {
      const configDoc = await db.collection('users').doc(uid).collection('config').doc('main').get();
      if (configDoc.exists) {
        const c = configDoc.data();

        const rawSystemTopology = c.systemTopology || c.topology || null;
        let resolvedCoupling = normalizeCouplingValue(
          rawSystemTopology?.coupling ||
          c.coupling ||
          c.systemCoupling ||
          c.topologyCoupling
        );

        // Legacy compatibility: older payloads may only have boolean hints.
        const legacyAcHint =
          (typeof rawSystemTopology?.isLikelyAcCoupled === 'boolean')
            ? rawSystemTopology.isLikelyAcCoupled
            : ((typeof c.isLikelyAcCoupled === 'boolean') ? c.isLikelyAcCoupled : null);

        if (resolvedCoupling === 'unknown' && legacyAcHint !== null) {
          resolvedCoupling = legacyAcHint ? 'ac' : 'dc';
        }

        const normalizedSystemTopology = {
          ...(rawSystemTopology || {}),
          coupling: resolvedCoupling,
          source: rawSystemTopology?.source || (legacyAcHint !== null ? 'legacy' : 'unknown')
        };

        configSummary = {
          configured: !!(c.setupComplete === true || (c.deviceSn && c.foxessToken)),
          hasDeviceSn: !!c.deviceSn,
          hasFoxessToken: !!c.foxessToken,
          hasAmberApiKey: !!c.amberApiKey,
          inverterCapacityW: Number.isFinite(Number(c.inverterCapacityW)) ? Number(c.inverterCapacityW) : null,
          batteryCapacityKWh: Number.isFinite(Number(c.batteryCapacityKWh)) ? Number(c.batteryCapacityKWh) : null,
          location: c.location || null,
          timezone: c.timezone || null,
          tourComplete: !!c.tourComplete,
          tourCompletedAt: c.tourCompletedAt || null,
          systemTopology: normalizedSystemTopology
        };
      }
    } catch (e) { /* ignore */ }

    res.json({ errno: 0, result: { uid, metrics, automationState, ruleCount, configSummary } });
  } catch (error) {
    console.error('[Admin] Error getting user stats:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

/**
 * POST /api/admin/impersonate - Generate a custom token for the target user
 * Body: { uid: 'target-user-uid' }
 * Returns a custom Firebase Auth token the admin can use to sign in as that user.
 */
app.post('/api/admin/impersonate', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const { uid } = req.body;
    if (!uid) {
      return res.status(400).json({ errno: 400, error: 'uid is required' });
    }
    // Verify the target user exists
    let targetUser;
    try {
      targetUser = await admin.auth().getUser(uid);
    } catch (e) {
      return res.status(404).json({ errno: 404, error: 'User not found' });
    }
    // Strict mode: only custom-token impersonation is allowed to ensure
    // the UI/API experience matches the target user exactly.
    let customToken = null;
    const mode = 'customToken';
    try {
      customToken = await admin.auth().createCustomToken(uid, { impersonatedBy: req.user.uid });
    } catch (tokenErr) {
      const msg = tokenErr && tokenErr.message ? tokenErr.message : String(tokenErr);
      const isSignBlobDenied = msg.includes('iam.serviceAccounts.signBlob') || msg.includes('Permission iam.serviceAccounts.signBlob denied');
      if (isSignBlobDenied) {
        return res.status(503).json({
          errno: 503,
          error: 'Impersonation is unavailable until IAM token signing is enabled. Grant roles/iam.serviceAccountTokenCreator to the Cloud Functions service account on the runtime service account.'
        });
      }
      throw tokenErr;
    }
    
    // Audit log
    await db.collection('admin_audit').add({
      action: 'impersonate',
      mode,
      adminUid: req.user.uid,
      adminEmail: req.user.email,
      targetUid: uid,
      targetEmail: targetUser.email || '',
      timestamp: serverTimestamp()
    });

    return res.json({
      errno: 0,
      result: {
        mode,
        customToken,
        targetUid: uid,
        targetEmail: targetUser.email || ''
      }
    });
  } catch (error) {
    console.error('[Admin] Error impersonating user:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

/**
 * GET /api/admin/check - Check if the current user is an admin
 * Used by the frontend to decide whether to show the admin nav link
 */
app.get('/api/admin/check', authenticateUser, async (req, res) => {
  const adminStatus = await isAdmin(req);
  res.json({ errno: 0, result: { isAdmin: adminStatus } });
});
}

module.exports = {
  registerAdminRoutes
};

