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
  const fetchImpl = deps.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const githubDataworks = deps.githubDataworks && typeof deps.githubDataworks === 'object'
    ? deps.githubDataworks
    : {};
  const githubOwner = String(githubDataworks.owner || '').trim() || 'Stealth928';
  const githubRepo = String(githubDataworks.repo || '').trim() || 'inverter-automation';
  const githubWorkflowId = String(githubDataworks.workflowId || '').trim() || 'aemo-market-insights-delta.yml';
  const githubRef = String(githubDataworks.ref || '').trim() || 'main';
  const githubDispatchToken = String(githubDataworks.dispatchToken || '').trim();
  const githubUserAgent = String(githubDataworks.userAgent || '').trim() || 'SoCrates-Admin-DataWorks';
  const githubHostingOrigins = Array.from(new Set([
    String(githubDataworks.hostingOrigin || '').trim(),
    'https://inverter-automation-firebase.web.app',
    'https://inverter-automation-firebase.firebaseapp.com'
  ].filter(Boolean)));

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

  const parseBoundedPositiveInt = (value, fallback, max = Number.MAX_SAFE_INTEGER) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(max, Math.floor(parsed)));
  };
  const githubDiagnosticsCacheTtlMs = parseBoundedPositiveInt(githubDataworks.cacheTtlMs, 300000, 3600000);
  const githubDispatchCooldownMs = parseBoundedPositiveInt(githubDataworks.dispatchCooldownMs, 90000, 3600000);
  let dataworksOpsCache = null;
  let dataworksOpsCacheExpiresAtMs = 0;
  let lastDataworksDispatchAtMs = 0;

  const toMs = (value) => {
    if (!value) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? null : parsed;
    }
    if (typeof value.toDate === 'function') {
      const date = value.toDate();
      return date && typeof date.getTime === 'function' ? date.getTime() : null;
    }
    if (Number.isFinite(value._seconds)) return value._seconds * 1000;
    if (Number.isFinite(value.seconds)) return value.seconds * 1000;
    return null;
  };

  const inferUserRole = (profileRole, email) => {
    if (profileRole) return profileRole;
    return String(email || '').toLowerCase() === SEED_ADMIN_EMAIL ? 'admin' : 'user';
  };

  const isConfiguredUserConfig = (config = {}) => (
    !!(config.setupComplete || config.deviceSn || config.foxessToken || config.amberApiKey)
  );

  const readHeader = (headers, key) => {
    if (!headers || !key) return null;
    if (typeof headers.get === 'function') return headers.get(key);
    const expected = String(key).toLowerCase();
    for (const headerKey of Object.keys(headers)) {
      if (String(headerKey).toLowerCase() === expected) {
        return headers[headerKey];
      }
    }
    return null;
  };

  const parseGithubRateLimit = (headers) => {
    const limit = Number(readHeader(headers, 'x-ratelimit-limit'));
    const remaining = Number(readHeader(headers, 'x-ratelimit-remaining'));
    const resetSeconds = Number(readHeader(headers, 'x-ratelimit-reset'));
    return {
      limit: Number.isFinite(limit) ? limit : null,
      remaining: Number.isFinite(remaining) ? remaining : null,
      resetAt: Number.isFinite(resetSeconds) ? new Date(resetSeconds * 1000).toISOString() : null
    };
  };

  const normalizeGithubRun = (run) => {
    if (!run || typeof run !== 'object') return null;
    const createdAtMs = toMs(run.created_at);
    const updatedAtMs = toMs(run.updated_at);
    return {
      id: run.id || null,
      number: run.run_number || null,
      status: run.status || null,
      conclusion: run.conclusion || null,
      event: run.event || null,
      createdAt: run.created_at || null,
      updatedAt: run.updated_at || null,
      createdAtMs,
      updatedAtMs,
      durationMs: Number.isFinite(createdAtMs) && Number.isFinite(updatedAtMs)
        ? Math.max(updatedAtMs - createdAtMs, 0)
        : null,
      htmlUrl: run.html_url || null,
      jobsUrl: run.jobs_url || null
    };
  };

  const normalizeGithubJob = (job) => {
    if (!job || typeof job !== 'object') return null;
    return {
      id: job.id || null,
      name: job.name || null,
      status: job.status || null,
      conclusion: job.conclusion || null,
      startedAt: job.started_at || null,
      completedAt: job.completed_at || null,
      steps: Array.isArray(job.steps)
        ? job.steps.map((step) => ({
          number: step.number || null,
          name: step.name || null,
          status: step.status || null,
          conclusion: step.conclusion || null,
          startedAt: step.started_at || null,
          completedAt: step.completed_at || null
        }))
        : []
    };
  };

  const trimString = (value) => {
    const text = String(value || '').trim();
    return text || null;
  };

  const normalizeGithubBranch = (value) => {
    const raw = trimString(value);
    if (!raw) return null;
    return raw
      .replace(/^refs\/heads\//i, '')
      .replace(/^origin\//i, '');
  };

  const shortenCommit = (value) => {
    const text = trimString(value);
    return text ? text.slice(0, 7) : null;
  };

  const normalizeHostedReleaseManifest = (manifest) => {
    const source = manifest && typeof manifest === 'object' ? manifest : {};
    const git = source.git && typeof source.git === 'object' ? source.git : {};
    const commit = trimString(git.commit);
    const branch = normalizeGithubBranch(git.branch || git.ref);
    const ref = trimString(git.ref) || (branch ? `refs/heads/${branch}` : null);

    return {
      generatedAt: trimString(source.generatedAt),
      git: {
        commit,
        shortCommit: trimString(git.shortCommit) || shortenCommit(commit),
        branch,
        ref
      }
    };
  };

  async function callGithubApi(url, options = {}) {
    if (typeof fetchImpl !== 'function') {
      const error = new Error('fetch implementation not available on server');
      error.statusCode = 503;
      throw error;
    }

    const response = await fetchImpl(url, {
      method: options.method || 'GET',
      headers: {
        'User-Agent': githubUserAgent,
        'Accept': 'application/vnd.github+json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const rateLimit = parseGithubRateLimit(response.headers);
    if (options.expectStatus && response.status === options.expectStatus) {
      return { data: null, rateLimit };
    }

    let text = '';
    let data = null;
    if (typeof response.text === 'function') {
      text = await response.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (_parseError) {
          data = null;
        }
      }
    }

    if (!response.ok) {
      const error = new Error(data?.message || text || `GitHub API request failed with ${response.status}`);
      error.statusCode = response.status;
      throw error;
    }

    return { data, rateLimit };
  }

  async function fetchHostedReleaseManifest() {
    if (typeof fetchImpl !== 'function') {
      return {
        manifest: null,
        sourceUrl: null,
        error: 'fetch implementation not available on server'
      };
    }

    let lastError = null;
    for (const origin of githubHostingOrigins) {
      const baseUrl = String(origin || '').replace(/\/+$/, '');
      if (!baseUrl) continue;

      const releaseUrl = `${baseUrl}/data/release-manifest.json?ts=${Date.now()}`;
      try {
        const response = await fetchImpl(releaseUrl, {
          method: 'GET',
          headers: {
            'Cache-Control': 'no-cache'
          }
        });
        const text = typeof response?.text === 'function' ? await response.text() : '';

        if (!response?.ok) {
          lastError = `HTTP ${response?.status || 500}`;
          continue;
        }

        const manifest = text ? JSON.parse(text) : {};
        return {
          manifest: normalizeHostedReleaseManifest(manifest),
          sourceUrl: releaseUrl,
          error: null
        };
      } catch (error) {
        lastError = error?.message || String(error);
      }
    }

    return {
      manifest: null,
      sourceUrl: null,
      error: lastError || 'hosted release manifest unavailable'
    };
  }

  async function resolveGithubRefCommit(ref) {
    const normalizedRef = trimString(ref);
    if (!normalizedRef) {
      return {
        ref: null,
        commit: null,
        shortCommit: null,
        error: 'workflow ref is not configured'
      };
    }

    try {
      const commitUrl = `https://api.github.com/repos/${encodeURIComponent(githubOwner)}/${encodeURIComponent(githubRepo)}/commits/${encodeURIComponent(normalizedRef)}`;
      const { data } = await callGithubApi(commitUrl);
      const commit = trimString(data?.sha);
      return {
        ref: normalizedRef,
        commit,
        shortCommit: shortenCommit(commit),
        error: commit ? null : 'unable to resolve workflow ref commit'
      };
    } catch (error) {
      return {
        ref: normalizedRef,
        commit: null,
        shortCommit: null,
        error: error?.message || String(error)
      };
    }
  }

  function buildReleaseAlignmentSummary({ liveRelease, targetRef }) {
    const liveManifest = liveRelease && liveRelease.manifest ? liveRelease.manifest : null;
    const liveCommit = trimString(liveManifest?.git?.commit);
    const liveBranch = normalizeGithubBranch(liveManifest?.git?.branch || liveManifest?.git?.ref);
    const targetCommit = trimString(targetRef?.commit);

    if (!liveManifest || !liveCommit) {
      return {
        status: 'manifest-missing',
        matches: null,
        liveCommit: null,
        liveShortCommit: null,
        liveBranch: null,
        targetCommit,
        targetShortCommit: shortenCommit(targetCommit),
        targetRef: targetRef?.ref || githubRef,
        sourceUrl: liveRelease?.sourceUrl || null,
        reason: liveRelease?.error || 'hosted release manifest unavailable'
      };
    }

    if (!targetCommit) {
      return {
        status: 'target-unresolved',
        matches: null,
        liveCommit,
        liveShortCommit: shortenCommit(liveCommit),
        liveBranch,
        targetCommit: null,
        targetShortCommit: null,
        targetRef: targetRef?.ref || githubRef,
        sourceUrl: liveRelease?.sourceUrl || null,
        reason: targetRef?.error || 'unable to resolve workflow ref commit'
      };
    }

    if (liveCommit !== targetCommit) {
      return {
        status: 'mismatch',
        matches: false,
        liveCommit,
        liveShortCommit: shortenCommit(liveCommit),
        liveBranch,
        targetCommit,
        targetShortCommit: shortenCommit(targetCommit),
        targetRef: targetRef?.ref || githubRef,
        sourceUrl: liveRelease?.sourceUrl || null,
        reason: `Live hosting is on ${liveBranch || 'unknown'} @ ${shortenCommit(liveCommit) || 'unknown'}, but ref ${targetRef?.ref || githubRef} resolves to ${shortenCommit(targetCommit) || 'unknown'}. Deploy the current release first.`
      };
    }

    return {
      status: 'aligned',
      matches: true,
      liveCommit,
      liveShortCommit: shortenCommit(liveCommit),
      liveBranch,
      targetCommit,
      targetShortCommit: shortenCommit(targetCommit),
      targetRef: targetRef?.ref || githubRef,
      sourceUrl: liveRelease?.sourceUrl || null,
      reason: null
    };
  }

  async function loadGithubWorkflowOps(forceRefresh = false) {
    const nowMs = Date.now();
    if (!forceRefresh && dataworksOpsCache && nowMs < dataworksOpsCacheExpiresAtMs) {
      return {
        ...dataworksOpsCache,
        cache: {
          hit: true,
          fetchedAt: dataworksOpsCache.cache?.fetchedAt || new Date(nowMs).toISOString(),
          fetchedAtMs: dataworksOpsCache.cache?.fetchedAtMs || nowMs,
          ageMs: nowMs - (dataworksOpsCache.cache?.fetchedAtMs || nowMs),
          ttlMs: githubDiagnosticsCacheTtlMs
        }
      };
    }

    const workflowUrl = `https://api.github.com/repos/${encodeURIComponent(githubOwner)}/${encodeURIComponent(githubRepo)}/actions/workflows/${encodeURIComponent(githubWorkflowId)}`;
    const runsUrl = `${workflowUrl}/runs?per_page=5`;
    const { data: workflowData, rateLimit: workflowRateLimit } = await callGithubApi(workflowUrl);
    const { data: runsData, rateLimit: runsRateLimit } = await callGithubApi(runsUrl);
    const recentRuns = Array.isArray(runsData?.workflow_runs)
      ? runsData.workflow_runs.map(normalizeGithubRun).filter(Boolean)
      : [];
    const latestRun = recentRuns[0] || null;
    const lastSuccessfulRun = recentRuns.find((run) => run?.conclusion === 'success') || null;

    let latestJob = null;
    let latestJobsRateLimit = null;
    if (latestRun?.jobsUrl) {
      const { data: jobsData, rateLimit } = await callGithubApi(latestRun.jobsUrl);
      latestJobsRateLimit = rateLimit;
      const jobs = Array.isArray(jobsData?.jobs) ? jobsData.jobs : [];
      latestJob = normalizeGithubJob(jobs[0] || null);
    }

    const [liveRelease, targetRef] = await Promise.all([
      fetchHostedReleaseManifest(),
      resolveGithubRefCommit(githubRef)
    ]);
    const releaseAlignment = buildReleaseAlignmentSummary({ liveRelease, targetRef });
    const workflowActive = String(workflowData?.state || '').toLowerCase() === 'active';
    let dispatchEnabled = !!githubDispatchToken && workflowActive;
    let dispatchReason = githubDispatchToken
      ? (workflowActive ? null : 'workflow is not active')
      : 'dispatch token not configured on the API runtime';

    if (dispatchEnabled && releaseAlignment.status === 'mismatch') {
      dispatchEnabled = false;
      dispatchReason = releaseAlignment.reason;
    }
    if (dispatchEnabled && releaseAlignment.status === 'target-unresolved') {
      dispatchEnabled = false;
      dispatchReason = releaseAlignment.reason;
    }

    const fetchedAtMs = Date.now();
    const result = {
      workflow: {
        owner: githubOwner,
        repo: githubRepo,
        workflowId: githubWorkflowId,
        ref: githubRef,
        state: workflowData?.state || null,
        path: workflowData?.path || null,
        htmlUrl: workflowData?.html_url || null
      },
      dispatch: {
        enabled: dispatchEnabled,
        configured: !!githubDispatchToken,
        ref: githubRef,
        cooldownMs: githubDispatchCooldownMs,
        reason: dispatchReason
      },
      releaseAlignment,
      latestRun,
      lastSuccessfulRun,
      latestJob,
      recentRuns,
      rateLimit: latestJobsRateLimit || runsRateLimit || workflowRateLimit || {
        limit: null,
        remaining: null,
        resetAt: null
      },
      cache: {
        hit: false,
        fetchedAt: new Date(fetchedAtMs).toISOString(),
        fetchedAtMs,
        ageMs: 0,
        ttlMs: githubDiagnosticsCacheTtlMs
      }
    };

    dataworksOpsCache = result;
    dataworksOpsCacheExpiresAtMs = fetchedAtMs + githubDiagnosticsCacheTtlMs;
    return result;
  }

  async function loadUserLifecycleSnapshot(uid, options = {}) {
    const profile = options.profile && typeof options.profile === 'object' ? options.profile : {};
    const profileExists = options.profileExists === true;
    const authUser = options.authUser && typeof options.authUser === 'object' ? options.authUser : null;
    const authMetadata = authUser && authUser.metadata ? authUser.metadata : null;
    const email = profile.email || (authUser?.email || '');
    const role = inferUserRole(profile.role, email);
    const joinedAtMs = toMs(authMetadata?.creationTime) || toMs(profile.createdAt);
    const lastSignInMs = toMs(authMetadata?.lastSignInTime) || null;

    let configured = false;
    let configuredAtMs = null;
    let firstRuleAtMs = null;
    let hasRules = false;

    if (profileExists) {
      const userRef = db.collection('users').doc(uid);

      try {
        const cfgDoc = await userRef.collection('config').doc('main').get();
        if (cfgDoc.exists) {
          const cfg = cfgDoc.data() || {};
          configured = isConfiguredUserConfig(cfg);
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
      } catch (_cfgErr) {
        // Keep admin endpoints resilient for per-user lookup failures.
      }

      try {
        let firstRuleSnap = await userRef
          .collection('rules')
          .orderBy('createdAt', 'asc')
          .limit(1)
          .get();

        if (firstRuleSnap.empty) {
          firstRuleSnap = await userRef
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
      } catch (_ruleErr) {
        // Keep admin endpoints resilient for per-user lookup failures.
      }
    }

    return {
      uid,
      email,
      role,
      automationEnabled: !!profile.automationEnabled,
      joinedAtMs,
      lastSignInMs,
      configured,
      configuredAtMs,
      hasRules,
      firstRuleAtMs
    };
  }

  const buildDeletionAuditSnapshot = (lifecycle = {}) => ({
    role: lifecycle.role || 'user',
    automationEnabled: lifecycle.automationEnabled === true,
    joinedAtMs: Number.isFinite(lifecycle.joinedAtMs) ? lifecycle.joinedAtMs : null,
    lastSignInMs: Number.isFinite(lifecycle.lastSignInMs) ? lifecycle.lastSignInMs : null,
    configured: lifecycle.configured === true,
    configuredAtMs: Number.isFinite(lifecycle.configuredAtMs) ? lifecycle.configuredAtMs : null,
    hasRules: lifecycle.hasRules === true,
    firstRuleAtMs: Number.isFinite(lifecycle.firstRuleAtMs) ? lifecycle.firstRuleAtMs : null
  });

  function parseDeletionAuditSnapshot(snapshotValue, deletedAtMs) {
    const snapshot = snapshotValue && typeof snapshotValue === 'object' ? snapshotValue : null;
    const joinedAtMs = toMs(snapshot?.joinedAtMs || snapshot?.joinedAt || snapshot?.createdAt);
    const configuredAtMs = toMs(snapshot?.configuredAtMs || snapshot?.firstConfiguredAt || snapshot?.setupCompletedAt);
    const firstRuleAtMs = toMs(snapshot?.firstRuleAtMs || snapshot?.ruleCreatedAt);

    if (!snapshot || !Number.isFinite(deletedAtMs) || !Number.isFinite(joinedAtMs)) {
      return null;
    }

    return {
      uid: snapshot.uid || null,
      role: snapshot.role || 'user',
      automationEnabled: snapshot.automationEnabled === true,
      joinedAtMs,
      configured: snapshot.configured === true || Number.isFinite(configuredAtMs),
      configuredAtMs: Number.isFinite(configuredAtMs) ? configuredAtMs : null,
      hasRules: snapshot.hasRules === true || Number.isFinite(firstRuleAtMs),
      firstRuleAtMs: Number.isFinite(firstRuleAtMs) ? firstRuleAtMs : null,
      deletedAtMs
    };
  }

  async function mapWithConcurrency(items, maxConcurrency, iterator) {
    const safeItems = Array.isArray(items) ? items : [];
    const concurrency = Math.max(1, Math.min(maxConcurrency || 1, safeItems.length || 1));
    const results = new Array(safeItems.length);
    let nextIndex = 0;

    const workers = Array.from({ length: concurrency }, async () => {
      while (nextIndex < safeItems.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await iterator(safeItems[currentIndex], currentIndex);
      }
    });

    await Promise.all(workers);
    return results;
  }

  const ADMIN_USERS_SCAN_MAX_CONCURRENCY = parseBoundedPositiveInt(
    process.env.ADMIN_USERS_SCAN_MAX_CONCURRENCY,
    8,
    50
  );
  const ADMIN_USERS_SUMMARY_CACHE_TTL_MS = parseBoundedPositiveInt(
    process.env.ADMIN_USERS_SUMMARY_CACHE_TTL_MS,
    2 * 60 * 1000,
    15 * 60 * 1000
  );
  let adminUsersSummaryCache = {
    summary: null,
    expiresAtMs: 0,
    pending: null
  };

  function invalidateAdminUsersSummaryCache() {
    adminUsersSummaryCache = {
      summary: null,
      expiresAtMs: 0,
      pending: null
    };
  }

  async function getCachedAdminUsersSummary(loadSummary, { forceRefresh = false } = {}) {
    const now = Date.now();
    const hasFreshSummary = !forceRefresh
      && adminUsersSummaryCache.summary
      && adminUsersSummaryCache.expiresAtMs > now;
    if (hasFreshSummary) {
      return adminUsersSummaryCache.summary;
    }

    if (!forceRefresh && adminUsersSummaryCache.pending) {
      return adminUsersSummaryCache.pending;
    }

    const pending = Promise.resolve()
      .then(loadSummary)
      .then((summary) => {
        adminUsersSummaryCache = {
          summary,
          expiresAtMs: Date.now() + ADMIN_USERS_SUMMARY_CACHE_TTL_MS,
          pending: null
        };
        return summary;
      })
      .catch((error) => {
        adminUsersSummaryCache.pending = null;
        throw error;
      });

    adminUsersSummaryCache.pending = pending;
    return pending;
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
    const PROVIDER_KEYS = ['foxess', 'sungrow', 'sigenergy', 'alphaess'];
    const providerLabelMap = {
      foxess: 'FoxESS',
      sungrow: 'Sungrow',
      sigenergy: 'Sigenergy',
      alphaess: 'AlphaESS'
    };

    const toPercent = (count, total) => {
      if (!Number.isFinite(count) || !Number.isFinite(total) || total <= 0) return 0;
      return Math.round((count / total) * 100);
    };

    const normalizeProvider = (providerRaw, config = null) => {
      const provider = String(providerRaw || '').toLowerCase().trim();
      if (provider) return provider;
      if (config && typeof config === 'object') {
        if (config.sungrowUsername || config.sungrowDeviceSn) return 'sungrow';
        if (config.sigenUsername || config.sigenStationId || config.sigenDeviceSn) return 'sigenergy';
        if (config.alphaessSystemSn || config.alphaessSysSn || config.alphaessAppId || config.alphaessAppSecret) return 'alphaess';
      }
      return 'foxess';
    };

    const buildProviderFlags = (config = {}, secrets = {}) => {
      const provider = normalizeProvider(config.deviceProvider, config);
      return {
        provider,
        hasDeviceSn: !!config.deviceSn,
        hasFoxessToken: !!config.foxessToken,
        hasAmberApiKey: !!config.amberApiKey,
        hasAlphaEssSystemSn: !!(config.alphaessSystemSn || config.alphaessSysSn),
        hasAlphaEssAppId: !!config.alphaessAppId,
        hasAlphaEssAppSecret: !!(config.alphaessAppSecret || secrets.alphaessAppSecret),
        hasSungrowUsername: !!config.sungrowUsername,
        hasSungrowDeviceSn: !!(config.sungrowDeviceSn || (provider === 'sungrow' && config.deviceSn)),
        hasSigenUsername: !!config.sigenUsername,
        hasSigenDeviceSn: !!(config.sigenDeviceSn || config.sigenStationId || (provider === 'sigenergy' && config.deviceSn)),
        hasSigenStationId: !!config.sigenStationId
      };
    };

    const isProviderConfigured = (provider, flags) => {
      switch (provider) {
      case 'sungrow':
        return !!(flags.hasSungrowDeviceSn && flags.hasSungrowUsername);
      case 'sigenergy':
        return !!flags.hasSigenUsername;
      case 'alphaess':
        return !!(flags.hasAlphaEssSystemSn && flags.hasAlphaEssAppId && flags.hasAlphaEssAppSecret);
      case 'foxess':
      default:
        return !!(flags.hasDeviceSn && flags.hasFoxessToken);
      }
    };

    const hasAnyProviderConfigured = (flags) =>
      PROVIDER_KEYS.some((providerKey) => isProviderConfigured(providerKey, flags));

    const resolveCoupling = (config = {}) => {
      const rawSystemTopology = config.systemTopology || config.topology || null;
      let resolvedCoupling = normalizeCouplingValue(
        rawSystemTopology?.coupling ||
        config.coupling ||
        config.systemCoupling ||
        config.topologyCoupling
      );

      const legacyAcHint =
        (typeof rawSystemTopology?.isLikelyAcCoupled === 'boolean')
          ? rawSystemTopology.isLikelyAcCoupled
          : ((typeof config.isLikelyAcCoupled === 'boolean') ? config.isLikelyAcCoupled : null);

      if (resolvedCoupling === 'unknown' && legacyAcHint !== null) {
        resolvedCoupling = legacyAcHint ? 'ac' : 'dc';
      }

      return resolvedCoupling || 'unknown';
    };

    const normalizeLocation = (value) => String(value || '').replace(/\s+/g, ' ').trim();

    const formatInverterSizeLabel = (capacityW) => {
      const roundedKw = Math.round((Number(capacityW) / 1000) * 10) / 10;
      return `${Number.isInteger(roundedKw) ? roundedKw.toFixed(0) : roundedKw.toFixed(1)} kW`;
    };

    const formatBatterySizeLabel = (capacityKWh) => {
      const roundedKWh = Math.round(Number(capacityKWh) * 10) / 10;
      return `${Number.isInteger(roundedKWh) ? roundedKWh.toFixed(0) : roundedKWh.toFixed(1)} kWh`;
    };

    const incrementCount = (map, key) => {
      if (!key) return;
      map.set(key, (map.get(key) || 0) + 1);
    };

    const incrementNamedCount = (map, key, label) => {
      if (!key || !label) return;
      const existing = map.get(key) || { key, label, count: 0 };
      existing.count += 1;
      map.set(key, existing);
    };

    const mapCountsToRows = (map, labelResolver = null) => Array.from(map.entries())
      .map(([key, count]) => ({
        key,
        label: typeof labelResolver === 'function' ? labelResolver(key) : key,
        count
      }))
      .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)));

    const mapNamedCountsToRows = (map) => Array.from(map.values())
      .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)));

    const parseBooleanQuery = (value, defaultValue = false) => {
      if (value === undefined || value === null || value === '') return defaultValue;
      const normalized = String(value).trim().toLowerCase();
      return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'all';
    };

    const buildAdminUserRoster = async () => {
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
      const roster = Array.from(allUids).map((uid) => {
        const data = profileByUid.get(uid) || {};
        const authUser = authByUid.get(uid) || null;
        const authMetadata = authUser && authUser.metadata ? authUser.metadata : null;
        const email = data.email || (authUser && authUser.email ? authUser.email : '');
        const joinedAt = (authMetadata && authMetadata.creationTime) ? authMetadata.creationTime : (data.createdAt || null);
        const lastSignedInAt = (authMetadata && authMetadata.lastSignInTime) ? authMetadata.lastSignInTime : null;

        return {
          uid,
          data,
          authUser,
          authMetadata,
          email,
          joinedAt,
          lastSignedInAt,
          lastSignedInAtMs: toMs(lastSignedInAt),
          joinedAtMs: toMs(joinedAt),
          profileExists: profileByUid.has(uid)
        };
      }).sort((a, b) => {
        if (b.lastSignedInAtMs !== a.lastSignedInAtMs) return b.lastSignedInAtMs - a.lastSignedInAtMs;
        if (b.joinedAtMs !== a.joinedAtMs) return b.joinedAtMs - a.joinedAtMs;
        const emailCmp = String(a.email || '').localeCompare(String(b.email || ''));
        if (emailCmp !== 0) return emailCmp;
        return String(a.uid).localeCompare(String(b.uid));
      });

      return {
        roster,
        totalUsers: roster.length
      };
    };

    const loadDetailedUser = async (rosterEntry, options = {}) => {
      const {
        summaryCollectors = null,
        includeEvProbe = false
      } = options;
      const shouldCollectSummary = !!summaryCollectors;
      const shouldLoadEvStatus = shouldCollectSummary || includeEvProbe;
      const { uid, data, email, joinedAt, lastSignedInAt, profileExists } = rosterEntry;
      const emailLc = String(email || '').toLowerCase();
      const isSeedAdmin = emailLc === SEED_ADMIN_EMAIL;

      try {
        let rulesCount = 0;
        let configMain = null;
        let hasEVConfigured = false;
        const userRef = db.collection('users').doc(uid);

        try {
          const vehiclesCollectionRef = shouldLoadEvStatus ? userRef.collection('vehicles') : null;
          const vehiclesGet = shouldLoadEvStatus
            ? ((vehiclesCollectionRef && typeof vehiclesCollectionRef.limit === 'function')
              ? vehiclesCollectionRef.limit(1).get()
              : vehiclesCollectionRef.get())
            : Promise.resolve(null);

          const [rulesSnap, configDoc, vehiclesSnap] = await Promise.all([
            userRef.collection('rules').get(),
            userRef.collection('config').doc('main').get(),
            vehiclesGet
          ]);
          rulesCount = rulesSnap.size;
          configMain = configDoc.exists ? (configDoc.data() || {}) : null;
          hasEVConfigured = !!(vehiclesSnap && ((typeof vehiclesSnap.size === 'number' && vehiclesSnap.size > 0)
            || (Array.isArray(vehiclesSnap.docs) && vehiclesSnap.docs.length > 0)
            || vehiclesSnap.empty === false));
        } catch (e) {
          // Ignore per-user failures and keep endpoint resilient
        }

        let secrets = {};
        if (configMain) {
          const provider = normalizeProvider(configMain.deviceProvider, configMain);
          const needsAlphaEssSecret = provider === 'alphaess'
            && !!(configMain.alphaessSystemSn || configMain.alphaessSysSn || configMain.alphaessAppId)
            && !configMain.alphaessAppSecret;

          if (needsAlphaEssSecret) {
            try {
              const secretsDoc = await userRef.collection('secrets').doc('credentials').get();
              secrets = secretsDoc.exists ? (secretsDoc.data() || {}) : {};
            } catch (e) {
              // Ignore private-secret lookup failures and keep endpoint resilient.
            }
          }
        }

        const hasDeviceSn = !!configMain?.deviceSn;
        const hasFoxessToken = !!configMain?.foxessToken;
        const hasAmberApiKey = !!configMain?.amberApiKey;
        const providerFlags = buildProviderFlags(configMain || {}, secrets);
        const configured = !!(configMain?.setupComplete === true || isProviderConfigured(providerFlags.provider, providerFlags) || hasAnyProviderConfigured(providerFlags));
        const deviceProvider = providerFlags.provider;
        const inverterCapacityW = Number.isFinite(Number(configMain?.inverterCapacityW)) ? Number(configMain.inverterCapacityW) : null;
        const batteryCapacityKWh = Number.isFinite(Number(configMain?.batteryCapacityKWh)) ? Number(configMain.batteryCapacityKWh) : null;
        const coupling = resolveCoupling(configMain || {});
        const location = normalizeLocation(configMain?.location);

        if (shouldCollectSummary) {
          incrementCount(summaryCollectors.providerCounts, deviceProvider || 'unknown');
          incrementCount(summaryCollectors.couplingCounts, coupling || 'unknown');
          const tourStatus = configMain === null ? 'no_config' : (configMain.tourComplete ? 'watched' : 'not_watched');
          incrementCount(summaryCollectors.tourStatusCounts, tourStatus);
          if (location) {
            incrementNamedCount(summaryCollectors.locationCounts, location.toLowerCase(), location);
          }
          if (inverterCapacityW) {
            incrementCount(summaryCollectors.inverterSizeCounts, formatInverterSizeLabel(inverterCapacityW));
          }
          if (batteryCapacityKWh) {
            incrementCount(summaryCollectors.batterySizeCounts, formatBatterySizeLabel(batteryCapacityKWh));
          }
        }

        return {
          uid,
          email,
          role: data.role || (isSeedAdmin ? 'admin' : 'user'),
          configured,
          hasDeviceSn,
          hasFoxessToken,
          hasAmberApiKey,
          inverterCapacityW,
          batteryCapacityKWh,
          automationEnabled: !!data.automationEnabled,
          hasEVConfigured,
          createdAt: data.createdAt || null,
          joinedAt,
          lastSignedInAt,
          rulesCount,
          profileInitialized: profileExists,
          lastUpdated: data.lastUpdated || null
        };
      } catch (error) {
        console.warn(`[Admin] Failed loading user details for uid=${uid}:`, error);
        return {
          uid,
          email,
          role: data.role || (isSeedAdmin ? 'admin' : 'user'),
          configured: false,
          hasDeviceSn: false,
          hasFoxessToken: false,
          hasAmberApiKey: false,
          inverterCapacityW: null,
          batteryCapacityKWh: null,
          automationEnabled: false,
          hasEVConfigured: false,
          createdAt: data.createdAt || null,
          joinedAt,
          lastSignedInAt,
          rulesCount: 0,
          profileInitialized: profileExists,
          lastUpdated: data.lastUpdated || null
        };
      }
    };

    const createSummaryCollectors = () => ({
      providerCounts: new Map(),
      locationCounts: new Map(),
      inverterSizeCounts: new Map(),
      batterySizeCounts: new Map(),
      couplingCounts: new Map(),
      tourStatusCounts: new Map()
    });

    const buildUsersSummaryFromDetailedUsers = (allDetailedUsers, summaryCollectors, totalUsers) => {
      const configuredUsers = allDetailedUsers.filter((user) => user.configured).length;
      const automationActiveUsers = allDetailedUsers.filter((user) => user.automationEnabled).length;
      const amberConfiguredUsers = allDetailedUsers.filter((user) => user.hasAmberApiKey).length;
      const evConfiguredUsers = allDetailedUsers.filter((user) => user.hasEVConfigured).length;

      return {
        totalUsers,
        configured: {
          count: configuredUsers,
          percentage: toPercent(configuredUsers, totalUsers)
        },
        automationActive: {
          count: automationActiveUsers,
          percentage: toPercent(automationActiveUsers, totalUsers)
        },
        amberConfigured: {
          count: amberConfiguredUsers,
          percentage: toPercent(amberConfiguredUsers, totalUsers)
        },
        evConfigured: {
          available: true,
          count: evConfiguredUsers,
          percentage: toPercent(evConfiguredUsers, totalUsers),
          note: 'Computed with a single-document existence probe per user from the vehicles subcollection.'
        },
        providerBreakdown: mapCountsToRows(summaryCollectors.providerCounts, (key) => providerLabelMap[key] || String(key || 'Unknown')),
        topLocations: mapNamedCountsToRows(summaryCollectors.locationCounts).slice(0, 5),
        inverterSizeDistribution: mapCountsToRows(summaryCollectors.inverterSizeCounts),
        batterySizeDistribution: mapCountsToRows(summaryCollectors.batterySizeCounts),
        couplingBreakdown: mapCountsToRows(summaryCollectors.couplingCounts, (key) => {
          if (key === 'ac') return 'AC Coupled';
          if (key === 'dc') return 'DC Coupled';
          return 'Unknown';
        }),
        tourStatusBreakdown: mapCountsToRows(summaryCollectors.tourStatusCounts, (key) => {
          if (key === 'watched') return 'Watched';
          if (key === 'not_watched') return 'Not watched';
          if (key === 'no_config') return 'No config';
          return 'Unknown';
        }),
        notes: [
          'Computed from the existing admin user scan with no extra aggregate query.',
          'EV-linked percentage uses a single-document existence probe per user rather than a full vehicle scan.'
        ]
      };
    };

    const buildUsersSummary = async (roster) => {
      const summaryCollectors = createSummaryCollectors();
      const allDetailedUsers = await mapWithConcurrency(
        roster,
        ADMIN_USERS_SCAN_MAX_CONCURRENCY,
        (rosterEntry) => loadDetailedUser(rosterEntry, { summaryCollectors })
      );
      return buildUsersSummaryFromDetailedUsers(allDetailedUsers, summaryCollectors, roster.length);
    };

    const requestedPageSizeRaw = Number(req.query?.limit);
    const requestedPageRaw = Number(req.query?.page);
    const showAll = parseBooleanQuery(req.query?.all, false);
    const includeSummary = parseBooleanQuery(req.query?.includeSummary, true);
    const refreshSummary = parseBooleanQuery(req.query?.refreshSummary, false) || parseBooleanQuery(req.query?.refresh, false);

    const { roster, totalUsers } = await buildAdminUserRoster();
    const forceSummaryRefresh = refreshSummary
      || !!(adminUsersSummaryCache.summary && adminUsersSummaryCache.summary.totalUsers !== totalUsers);

    const pageSize = showAll
      ? Math.max(1, totalUsers)
      : (Number.isFinite(requestedPageSizeRaw)
        ? Math.max(1, Math.min(100, Math.floor(requestedPageSizeRaw)))
        : 50);
    const totalPages = showAll ? 1 : Math.max(1, Math.ceil(totalUsers / pageSize));
    const requestedPage = Number.isFinite(requestedPageRaw) ? Math.max(1, Math.floor(requestedPageRaw)) : 1;
    const page = showAll ? 1 : Math.min(requestedPage, totalPages);
    const pageStart = showAll ? 0 : ((page - 1) * pageSize);
    const selectedRoster = showAll ? roster : roster.slice(pageStart, pageStart + pageSize);
    let users = [];
    let summary = null;

    if (includeSummary) {
      const hasFreshCachedSummary = !forceSummaryRefresh
        && adminUsersSummaryCache.summary
        && adminUsersSummaryCache.expiresAtMs > Date.now();

      if (hasFreshCachedSummary || (!forceSummaryRefresh && adminUsersSummaryCache.pending)) {
        const usersPromise = mapWithConcurrency(
          selectedRoster,
          ADMIN_USERS_SCAN_MAX_CONCURRENCY,
          (rosterEntry) => loadDetailedUser(rosterEntry, { includeEvProbe: true })
        );
        const summaryPromise = getCachedAdminUsersSummary(
          () => buildUsersSummary(roster),
          { forceRefresh: false }
        );
        [users, summary] = await Promise.all([usersPromise, summaryPromise]);
      } else {
        const summaryCollectors = createSummaryCollectors();
        const allDetailedUsers = await mapWithConcurrency(
          roster,
          ADMIN_USERS_SCAN_MAX_CONCURRENCY,
          (rosterEntry) => loadDetailedUser(rosterEntry, { summaryCollectors })
        );
        summary = buildUsersSummaryFromDetailedUsers(allDetailedUsers, summaryCollectors, totalUsers);
        adminUsersSummaryCache = {
          summary,
          expiresAtMs: Date.now() + ADMIN_USERS_SUMMARY_CACHE_TTL_MS,
          pending: null
        };
        users = showAll ? allDetailedUsers : allDetailedUsers.slice(pageStart, pageStart + pageSize);
      }
    } else {
      users = await mapWithConcurrency(
        selectedRoster,
        ADMIN_USERS_SCAN_MAX_CONCURRENCY,
        (rosterEntry) => loadDetailedUser(rosterEntry)
      );
    }

    res.json({
      errno: 0,
      result: {
        users,
        summary,
        pagination: {
          page,
          pageSize,
          totalUsers,
          totalPages,
          showAll,
          sortBase: 'lastSignedInAt',
          sortingScope: showAll ? 'all-loaded' : 'current-page'
        }
      }
    });
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
    const warnings = [];

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

    const users = await Promise.all(Array.from(allUids).map((uid) => loadUserLifecycleSnapshot(uid, {
      profile: profileByUid.get(uid) || {},
      profileExists: profileByUid.has(uid),
      authUser: authByUid.get(uid) || null
    })));

    const deletionSeries = [];
    const deletedUserSnapshots = [];
    let missingDeletionSnapshots = 0;
    try {
      const auditSnap = await db.collection('admin_audit')
        .where('action', '==', 'delete_user')
        .get();
      auditSnap.forEach((doc) => {
        const auditData = doc.data() || {};
        const deletedAtMs = toMs(auditData.timestamp);
        if (Number.isFinite(deletedAtMs)) {
          deletionSeries.push(deletedAtMs);
        }
        const deletedUser = parseDeletionAuditSnapshot(auditData.snapshot, deletedAtMs);
        if (deletedUser) {
          deletedUserSnapshots.push({
            ...deletedUser,
            uid: auditData.targetUid || deletedUser.uid || `deleted-${doc.id}`
          });
        } else if (Number.isFinite(deletedAtMs)) {
          missingDeletionSnapshots += 1;
        }
      });
      deletionSeries.sort((a, b) => a - b);
    } catch (auditErr) {
      console.warn('[Admin] platform-stats: could not load deletion audit log:', auditErr.message || auditErr);
    }
    if (missingDeletionSnapshots > 0) {
      warnings.push(
        `${missingDeletionSnapshots} deleted user lifecycle snapshot${missingDeletionSnapshots === 1 ? '' : 's'} missing; earlier days may be understated.`
      );
    }

    const activeUserHistory = [
      ...users.map((user) => ({ ...user, deletedAtMs: null })),
      ...deletedUserSnapshots
    ];

    const addLifecycleEvent = (events, atMs, delta) => {
      if (!Number.isFinite(atMs) || !Number.isFinite(delta) || delta === 0) return;
      events.push({ atMs, delta });
    };

    const totalEvents = [];
    const configuredEvents = [];
    const rulesEvents = [];
    activeUserHistory.forEach((user) => {
      if (!Number.isFinite(user.joinedAtMs)) return;

      addLifecycleEvent(totalEvents, user.joinedAtMs, 1);
      if (Number.isFinite(user.deletedAtMs) && user.deletedAtMs >= user.joinedAtMs) {
        addLifecycleEvent(totalEvents, user.deletedAtMs, -1);
      }

      if (Number.isFinite(user.configuredAtMs) && (!Number.isFinite(user.deletedAtMs) || user.configuredAtMs <= user.deletedAtMs)) {
        addLifecycleEvent(configuredEvents, user.configuredAtMs, 1);
        if (Number.isFinite(user.deletedAtMs)) {
          addLifecycleEvent(configuredEvents, user.deletedAtMs, -1);
        }
      }

      if (Number.isFinite(user.firstRuleAtMs) && (!Number.isFinite(user.deletedAtMs) || user.firstRuleAtMs <= user.deletedAtMs)) {
        addLifecycleEvent(rulesEvents, user.firstRuleAtMs, 1);
        if (Number.isFinite(user.deletedAtMs)) {
          addLifecycleEvent(rulesEvents, user.deletedAtMs, -1);
        }
      }
    });

    const sortEvents = (events) => events.sort((a, b) => a.atMs - b.atMs || a.delta - b.delta);
    sortEvents(totalEvents);
    sortEvents(configuredEvents);
    sortEvents(rulesEvents);

    let totalIdx = 0;
    let configuredIdx = 0;
    let rulesIdx = 0;
    let deletionIdx = 0;
    let totalUsers = 0;
    let configuredUsers = 0;
    let usersWithRules = 0;
    let deletedUsers = 0;

    const trend = dateBuckets.map((bucket) => {
      while (totalIdx < totalEvents.length && totalEvents[totalIdx].atMs <= bucket.dayEndMs) {
        totalUsers += totalEvents[totalIdx].delta;
        totalIdx += 1;
      }
      while (configuredIdx < configuredEvents.length && configuredEvents[configuredIdx].atMs <= bucket.dayEndMs) {
        configuredUsers += configuredEvents[configuredIdx].delta;
        configuredIdx += 1;
      }
      while (rulesIdx < rulesEvents.length && rulesEvents[rulesIdx].atMs <= bucket.dayEndMs) {
        usersWithRules += rulesEvents[rulesIdx].delta;
        rulesIdx += 1;
      }
      while (deletionIdx < deletionSeries.length && deletionSeries[deletionIdx] <= bucket.dayEndMs) {
        deletedUsers += 1;
        deletionIdx += 1;
      }
      return {
        date: bucket.key,
        totalUsers: Math.max(0, totalUsers),
        configuredUsers: Math.max(0, configuredUsers),
        usersWithRules: Math.max(0, usersWithRules),
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

    res.json({ errno: 0, result: { summary, trend, days, warnings } });
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
          maxTelemetryAgeMs: toFiniteNumber(source.thresholds?.maxTelemetryAgeMs, 0),
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
          maxTelemetryAgeMs: toFiniteNumber(source.measurements?.maxTelemetryAgeMs, 0),
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

    const sanitizeOutlierRunSnapshot = (value) => {
      const source = value && typeof value === 'object' ? value : {};
      const runId = source.runId != null ? String(source.runId) : null;
      const maxCycleDurationMs = Math.max(0, toFiniteNumber(source.maxCycleDurationMs, 0));
      if (!runId && maxCycleDurationMs <= 0) {
        return null;
      }
      return {
        dayKey: source.dayKey != null ? String(source.dayKey) : null,
        runId,
        schedulerId: source.schedulerId != null ? String(source.schedulerId) : null,
        workerId: source.workerId != null ? String(source.workerId) : null,
        startedAtMs: Math.max(0, toFiniteNumber(source.startedAtMs, 0)),
        startedAtIso: source.startedAtMs ? new Date(toFiniteNumber(source.startedAtMs, 0)).toISOString() : null,
        completedAtMs: Math.max(0, toFiniteNumber(source.completedAtMs, 0)),
        maxCycleDurationMs,
        avgCycleDurationMs: Math.max(0, toFiniteNumber(source.avgCycleDurationMs, 0)),
        p95CycleDurationMs: Math.max(0, toFiniteNumber(source.p95CycleDurationMs, 0)),
        p99CycleDurationMs: Math.max(0, toFiniteNumber(source.p99CycleDurationMs, 0)),
        queueLagAvgMs: Math.max(0, toFiniteNumber(source.queueLagAvgMs, 0)),
        queueLagMaxMs: Math.max(0, toFiniteNumber(source.queueLagMaxMs, 0)),
        retries: Math.max(0, toFiniteNumber(source.retries, 0)),
        errors: Math.max(0, toFiniteNumber(source.errors, 0)),
        deadLetters: Math.max(0, toFiniteNumber(source.deadLetters, 0)),
        skipped: {
          disabledOrBlackout: toFiniteNumber(source.skipped?.disabledOrBlackout, 0),
          idempotent: toFiniteNumber(source.skipped?.idempotent, 0),
          locked: toFiniteNumber(source.skipped?.locked, 0),
          tooSoon: toFiniteNumber(source.skipped?.tooSoon, 0)
        },
        failureByType: sanitizeFailureByType(source.failureByType),
        telemetryPauseReasons: sanitizeFailureByType(source.telemetryPauseReasons),
        phaseTimingsMaxMs: sanitizePhaseTimingMaxMs(source.phaseTimingsMaxMs),
        slowestCycle: source.slowestCycle && typeof source.slowestCycle === 'object'
          ? {
              userId: source.slowestCycle.userId != null ? String(source.slowestCycle.userId) : null,
              cycleKey: source.slowestCycle.cycleKey != null ? String(source.slowestCycle.cycleKey) : null,
              durationMs: Math.max(0, toFiniteNumber(source.slowestCycle.durationMs, 0)),
              queueLagMs: Math.max(0, toFiniteNumber(source.slowestCycle.queueLagMs, 0)),
              retriesUsed: Math.max(0, toFiniteNumber(source.slowestCycle.retriesUsed, 0)),
              failureType: source.slowestCycle.failureType ? String(source.slowestCycle.failureType) : null,
              startedAtMs: Math.max(0, toFiniteNumber(source.slowestCycle.startedAtMs, 0)),
              completedAtMs: Math.max(0, toFiniteNumber(source.slowestCycle.completedAtMs, 0))
            }
          : null
      };
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

    const parseDayKeyStartMs = (dayKey) => {
      const text = String(dayKey || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return NaN;
      }
      return Date.parse(`${text}T00:00:00.000Z`);
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
      const queueLagMaxMs = Math.max(
        toFiniteNumber(run.queueLagMs?.maxMs, 0),
        toFiniteNumber(run.queueLagMaxMs, 0)
      );

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
      const avgCycleDurationSamples = toFiniteNumber(data.avgCycleDurationSamples, 0);
      const avgQueueLagSamples = toFiniteNumber(data.avgQueueLagSamples, 0);
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
        maxTelemetryAgeMs: toFiniteNumber(data.maxTelemetryAgeMs, 0),
        p95CycleDurationMs: toFiniteNumber(data.p95CycleDurationMs, 0),
        p99CycleDurationMs: toFiniteNumber(data.p99CycleDurationMs, 0),
        avgCycleDurationMs: avgCycleDurationSamples > 0
          ? toFiniteNumber(data.avgCycleDurationTotalMs, 0) / toFiniteNumber(data.avgCycleDurationSamples, 1)
          : 0,
        avgCycleDurationTotalMs: toFiniteNumber(data.avgCycleDurationTotalMs, 0),
        avgCycleDurationSamples,
        avgQueueLagMs: avgQueueLagSamples > 0
          ? toFiniteNumber(data.avgQueueLagTotalMs, 0) / toFiniteNumber(data.avgQueueLagSamples, 1)
          : 0,
        avgQueueLagTotalMs: toFiniteNumber(data.avgQueueLagTotalMs, 0),
        avgQueueLagSamples,
        phaseTimingsMaxMs: sanitizePhaseTimingMaxMs(data.phaseTimingsMaxMs),
        skipped: {
          disabledOrBlackout: toFiniteNumber(data.skipped?.disabledOrBlackout, 0),
          idempotent: toFiniteNumber(data.skipped?.idempotent, 0),
          locked: toFiniteNumber(data.skipped?.locked, 0),
          tooSoon: toFiniteNumber(data.skipped?.tooSoon, 0)
        },
        failureByType: sanitizeFailureByType(data.failureByType),
        telemetryPauseReasons: sanitizeFailureByType(data.telemetryPauseReasons),
        slo: sanitizeSloSnapshot(data.slo),
        outlierRun: sanitizeOutlierRunSnapshot(data.outlierRun),
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
      maxTelemetryAgeMs: 0,
      p95CycleDurationMs: 0,
      p99CycleDurationMs: 0,
      avgQueueLagMs: 0,
      avgCycleDurationMs: 0,
      phaseTimingsMaxMs: sanitizePhaseTimingMaxMs(null),
      skipped: {
        disabledOrBlackout: 0,
        idempotent: 0,
        locked: 0,
        tooSoon: 0
      },
      failureByType: {},
      telemetryPauseReasons: {}
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
      summary.maxTelemetryAgeMs = Math.max(summary.maxTelemetryAgeMs, day.maxTelemetryAgeMs);
      summary.p95CycleDurationMs = Math.max(summary.p95CycleDurationMs, day.p95CycleDurationMs);
      summary.p99CycleDurationMs = Math.max(summary.p99CycleDurationMs, day.p99CycleDurationMs);
      summary.avgQueueLagMs += day.avgQueueLagTotalMs;
      summary.avgCycleDurationMs += day.avgCycleDurationTotalMs;
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
      summary.telemetryPauseReasons = mergeFailureByType(
        summary.telemetryPauseReasons,
        day.telemetryPauseReasons
      );
    }

    const avgQueueLagSamples = dailyDesc.reduce(
      (sum, day) => sum + toFiniteNumber(day.avgQueueLagSamples, 0),
      0
    );
    const avgCycleDurationSamples = dailyDesc.reduce(
      (sum, day) => sum + toFiniteNumber(day.avgCycleDurationSamples, 0),
      0
    );
    summary.avgQueueLagMs = avgQueueLagSamples > 0 ? summary.avgQueueLagMs / avgQueueLagSamples : 0;
    summary.avgCycleDurationMs = avgCycleDurationSamples > 0
      ? summary.avgCycleDurationMs / avgCycleDurationSamples
      : 0;
    summary.avgQueueLagMs = Math.round(summary.avgQueueLagMs);
    summary.avgCycleDurationMs = Math.round(summary.avgCycleDurationMs);

    const soak = buildSchedulerSoakSummary({
      dailyDesc,
      daysRequested: days
    });

    const errorRatePct = summary.cyclesRun > 0
      ? Number(((summary.errors / summary.cyclesRun) * 100).toFixed(2))
      : 0;

    let recentRuns = [];
    if (includeRuns) {
      const oldestDayInWindow = dailyDesc.length > 0 ? dailyDesc[dailyDesc.length - 1] : null;
      const windowStartMs = oldestDayInWindow ? parseDayKeyStartMs(oldestDayInWindow.dayKey) : NaN;
      const runsCollection = metricsRootRef.collection('runs');
      const runQuery = Number.isFinite(windowStartMs)
        ? runsCollection.where('startedAtMs', '>=', windowStartMs)
        : runsCollection;
      const runSnapshot = await runQuery
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
          telemetryAgeMs: sanitizeDurationStats(data.telemetryAgeMs),
          phaseTimingsMs: sanitizePhaseTimingStats(data.phaseTimingsMs),
          skipped: {
            disabledOrBlackout: toFiniteNumber(data.skipped?.disabledOrBlackout, 0),
            idempotent: toFiniteNumber(data.skipped?.idempotent, 0),
            locked: toFiniteNumber(data.skipped?.locked, 0),
            tooSoon: toFiniteNumber(data.skipped?.tooSoon, 0)
          },
          failureByType: sanitizeFailureByType(data.failureByType),
          telemetryPauseReasons: sanitizeFailureByType(data.telemetryPauseReasons),
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
    if (dailyDesc.length > 0) {
      outlierRun = dailyDesc
        .slice()
        .map((day) => sanitizeOutlierRunSnapshot(day.outlierRun))
        .filter(Boolean)
        .sort((a, b) => {
          const durationDiff = toFiniteNumber(b?.maxCycleDurationMs, 0) - toFiniteNumber(a?.maxCycleDurationMs, 0);
          if (durationDiff !== 0) {
            return durationDiff;
          }
          return toFiniteNumber(b?.startedAtMs, 0) - toFiniteNumber(a?.startedAtMs, 0);
        })[0] || null;
    }
    if (!outlierRun && recentRuns.length > 0) {
      const fallbackOutlier = recentRuns
        .slice()
        .sort((a, b) => toFiniteNumber(b.cycleDurationMs?.maxMs, 0) - toFiniteNumber(a.cycleDurationMs?.maxMs, 0))[0] || null;
      if (fallbackOutlier) {
        const slowestCycle = Array.isArray(fallbackOutlier.slowCycleSamples) && fallbackOutlier.slowCycleSamples.length
          ? fallbackOutlier.slowCycleSamples[0]
          : null;
        outlierRun = sanitizeOutlierRunSnapshot({
          dayKey: fallbackOutlier.dayKey,
          runId: fallbackOutlier.runId,
          schedulerId: fallbackOutlier.schedulerId,
          workerId: fallbackOutlier.workerId || null,
          startedAtMs: fallbackOutlier.startedAtMs,
          completedAtMs: fallbackOutlier.completedAtMs,
          maxCycleDurationMs: toFiniteNumber(fallbackOutlier.cycleDurationMs?.maxMs, 0),
          avgCycleDurationMs: toFiniteNumber(fallbackOutlier.cycleDurationMs?.avgMs, 0),
          p95CycleDurationMs: toFiniteNumber(fallbackOutlier.cycleDurationMs?.p95Ms, 0),
          p99CycleDurationMs: toFiniteNumber(fallbackOutlier.cycleDurationMs?.p99Ms, 0),
          queueLagAvgMs: toFiniteNumber(fallbackOutlier.queueLagMs?.avgMs, 0),
          queueLagMaxMs: toFiniteNumber(fallbackOutlier.queueLagMs?.maxMs, 0),
          retries: toFiniteNumber(fallbackOutlier.retries, 0),
          errors: toFiniteNumber(fallbackOutlier.errors, 0),
          deadLetters: toFiniteNumber(fallbackOutlier.deadLetters, 0),
          skipped: fallbackOutlier.skipped,
          failureByType: fallbackOutlier.failureByType,
          telemetryPauseReasons: fallbackOutlier.telemetryPauseReasons,
          phaseTimingsMaxMs: sanitizePhaseTimingMaxMs(extractPhaseTimingRunMaxMs(fallbackOutlier.phaseTimingsMs)),
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
        });
      }
    }
    if (outlierRun) {
      outlierRun = {
        ...outlierRun,
        likelyCauses: buildLikelyCauseTags(outlierRun)
      };
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
            maxTelemetryAgeMs: toFiniteNumber(alertData.thresholds?.maxTelemetryAgeMs, 0),
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
            maxTelemetryAgeMs: toFiniteNumber(alertData.measurements?.maxTelemetryAgeMs, 0),
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
          telemetryPauseReasons: summary.telemetryPauseReasons,
          phaseTimings: {
            latestRunStartedAtMs: toFiniteNumber(latestRun?.startedAtMs, 0),
            latestRunMaxMs: latestRunPhaseTimingsMaxMs,
            outlierRunStartedAtMs: toFiniteNumber(outlierRun?.startedAtMs, 0),
            outlierRunMaxMs: sanitizePhaseTimingMaxMs(outlierRun?.phaseTimingsMaxMs),
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
 * GET /api/admin/dataworks/ops - Lightweight GitHub workflow diagnostics for DataWorks
 */
app.get('/api/admin/dataworks/ops', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const forceRefresh = String(req.query.force || '').trim() === '1';
    const result = await loadGithubWorkflowOps(forceRefresh);
    return res.json({ errno: 0, result });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 502;
    console.error('[Admin] dataworks ops diagnostics failed:', error?.message || error);
    return res.status(statusCode).json({
      errno: statusCode,
      error: error?.message || 'Failed to load DataWorks workflow diagnostics'
    });
  }
});

/**
 * POST /api/admin/dataworks/dispatch - Manually dispatch the DataWorks GitHub workflow
 */
app.post('/api/admin/dataworks/dispatch', authenticateUser, requireAdmin, async (req, res) => {
  try {
    if (!githubDispatchToken) {
      return res.status(503).json({
        errno: 503,
        error: 'DataWorks manual dispatch is not configured on the API runtime'
      });
    }

    const nowMs = Date.now();
    if (nowMs - lastDataworksDispatchAtMs < githubDispatchCooldownMs) {
      return res.status(429).json({
        errno: 429,
        error: `DataWorks workflow was already dispatched recently. Try again in ${Math.ceil((githubDispatchCooldownMs - (nowMs - lastDataworksDispatchAtMs)) / 1000)}s.`
      });
    }

    const latestOps = await loadGithubWorkflowOps(true);
    if (latestOps?.dispatch?.enabled === false) {
      return res.status(409).json({
        errno: 409,
        error: latestOps?.dispatch?.reason || 'DataWorks manual dispatch is currently blocked',
        result: {
          releaseAlignment: latestOps?.releaseAlignment || null
        }
      });
    }
    if (latestOps?.latestRun?.status && latestOps.latestRun.status !== 'completed') {
      return res.status(409).json({
        errno: 409,
        error: 'A DataWorks workflow run is already in progress',
        result: {
          latestRun: latestOps.latestRun
        }
      });
    }

    const dispatchUrl = `https://api.github.com/repos/${encodeURIComponent(githubOwner)}/${encodeURIComponent(githubRepo)}/actions/workflows/${encodeURIComponent(githubWorkflowId)}/dispatches`;
    await callGithubApi(dispatchUrl, {
      method: 'POST',
      token: githubDispatchToken,
      body: { ref: githubRef },
      expectStatus: 204
    });

    lastDataworksDispatchAtMs = Date.now();
    dataworksOpsCache = null;
    dataworksOpsCacheExpiresAtMs = 0;

    await db.collection('admin_audit').add({
      action: 'dataworks_dispatch',
      adminUid: req.user.uid,
      adminEmail: req.user.email || '',
      workflowOwner: githubOwner,
      workflowRepo: githubRepo,
      workflowId: githubWorkflowId,
      ref: githubRef,
      timestamp: serverTimestamp()
    });

    return res.status(202).json({
      errno: 0,
      result: {
        accepted: true,
        workflowOwner: githubOwner,
        workflowRepo: githubRepo,
        workflowId: githubWorkflowId,
        ref: githubRef,
        requestedAtMs: lastDataworksDispatchAtMs,
        recommendedPollAfterMs: 15000
      }
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 502;
    console.error('[Admin] dataworks workflow dispatch failed:', error?.message || error);
    return res.status(statusCode).json({
      errno: statusCode,
      error: error?.message || 'Failed to dispatch DataWorks workflow'
    });
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

    invalidateAdminUsersSummaryCache();
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

    let lifecycleSnapshot = null;
    try {
      const profileDoc = await db.collection('users').doc(uid).get();
      lifecycleSnapshot = await loadUserLifecycleSnapshot(uid, {
        profile: profileDoc.exists ? (profileDoc.data() || {}) : {},
        profileExists: profileDoc.exists,
        authUser: targetUser
      });
    } catch (snapshotErr) {
      console.warn('[AdminDelete] Failed to capture lifecycle snapshot:', snapshotErr.message || snapshotErr);
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
      snapshot: buildDeletionAuditSnapshot(lifecycleSnapshot || {}),
      timestamp: serverTimestamp()
    });

    invalidateAdminUsersSummaryCache();
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
    const KNOWN_INVERTER_METRIC_KEYS = new Set(['foxess', 'sungrow', 'sigenergy', 'alphaess']);
    const KNOWN_NON_INVERTER_METRIC_KEYS = new Set(['amber', 'weather', 'ev', 'tesla', 'teslafleet', 'updatedat']);
    const PROVIDER_KEYS = ['foxess', 'sungrow', 'sigenergy', 'alphaess'];

    const toCounter = (value) => {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return 0;
      return Math.round(n);
    };
    const getTeslaFleetRoot = (metricsDoc = {}) => {
      if (!metricsDoc || typeof metricsDoc !== 'object') return null;
      return metricsDoc.teslaFleet || metricsDoc.teslafleet || null;
    };
    const readNestedCounter = (root, path = []) => {
      if (!root || typeof root !== 'object' || !Array.isArray(path) || path.length === 0) return 0;
      let cursor = root;
      for (const segment of path) {
        if (!cursor || typeof cursor !== 'object') return 0;
        cursor = cursor[segment];
      }
      return toCounter(cursor);
    };
    const resolveEvCounter = (metricsDoc = {}) => {
      const explicitEv = toCounter(metricsDoc.ev);
      if (explicitEv) return explicitEv;

      const explicitTesla = toCounter(metricsDoc.tesla);
      if (explicitTesla) return explicitTesla;

      const teslaFleetRoot = getTeslaFleetRoot(metricsDoc);
      const teslaFleetBillable = readNestedCounter(teslaFleetRoot, ['calls', 'billable']);
      if (teslaFleetBillable) return teslaFleetBillable;

      const teslaFleetTotal = readNestedCounter(teslaFleetRoot, ['calls', 'total']);
      if (teslaFleetTotal) return teslaFleetTotal;

      const byCategory = (teslaFleetRoot && teslaFleetRoot.calls && teslaFleetRoot.calls.byCategory)
        ? teslaFleetRoot.calls.byCategory
        : null;
      if (byCategory && typeof byCategory === 'object') {
        const sum = Object.values(byCategory).reduce((acc, value) => acc + toCounter(value), 0);
        if (sum) return sum;
      }

      return 0;
    };

    const normalizeProvider = (providerRaw, config = null) => {
      const provider = String(providerRaw || '').toLowerCase().trim();
      if (provider) return provider;
      if (config && typeof config === 'object') {
        if (config.sungrowUsername || config.sungrowDeviceSn) return 'sungrow';
        if (config.sigenUsername || config.sigenStationId || config.sigenDeviceSn) return 'sigenergy';
        if (config.alphaessSystemSn || config.alphaessSysSn || config.alphaessAppId || config.alphaessAppSecret) return 'alphaess';
      }
      return 'foxess';
    };

    const buildProviderFlags = (config = {}, secrets = {}) => {
      const provider = normalizeProvider(config.deviceProvider, config);
      const hasAlphaEssAppSecret = !!(config.alphaessAppSecret || secrets.alphaessAppSecret);
      return {
        provider,
        hasDeviceSn: !!config.deviceSn,
        hasFoxessToken: !!config.foxessToken,
        hasAmberApiKey: !!config.amberApiKey,
        hasAlphaEssSystemSn: !!(config.alphaessSystemSn || config.alphaessSysSn),
        hasAlphaEssAppId: !!config.alphaessAppId,
        hasAlphaEssAppSecret,
        hasSungrowUsername: !!config.sungrowUsername,
        hasSungrowDeviceSn: !!(config.sungrowDeviceSn || (provider === 'sungrow' && config.deviceSn)),
        hasSigenUsername: !!config.sigenUsername,
        hasSigenDeviceSn: !!(config.sigenDeviceSn || config.sigenStationId || (provider === 'sigenergy' && config.deviceSn)),
        hasSigenStationId: !!config.sigenStationId
      };
    };

    const isProviderConfigured = (provider, flags) => {
      switch (provider) {
      case 'sungrow':
        return !!(flags.hasSungrowDeviceSn && flags.hasSungrowUsername);
      case 'sigenergy':
        return !!flags.hasSigenUsername;
      case 'alphaess':
        return !!(flags.hasAlphaEssSystemSn && flags.hasAlphaEssAppId && flags.hasAlphaEssAppSecret);
      case 'foxess':
      default:
        return !!(flags.hasDeviceSn && flags.hasFoxessToken);
      }
    };

    const hasAnyProviderConfigured = (flags) =>
      PROVIDER_KEYS.some((providerKey) => isProviderConfigured(providerKey, flags));

    const buildProviderAccessSummary = (provider, flags) => {
      switch (provider) {
      case 'sungrow':
        return {
          identifierLabel: 'Device SN',
          hasIdentifier: !!flags.hasSungrowDeviceSn,
          credentialLabel: 'iSolarCloud Login',
          hasCredential: !!flags.hasSungrowUsername
        };
      case 'sigenergy':
        return {
          identifierLabel: 'Station / Device ID',
          hasIdentifier: !!(flags.hasSigenStationId || flags.hasSigenDeviceSn),
          credentialLabel: 'Account Login',
          hasCredential: !!flags.hasSigenUsername
        };
      case 'alphaess':
        return {
          identifierLabel: 'System SN',
          hasIdentifier: !!flags.hasAlphaEssSystemSn,
          credentialLabel: 'App Credentials',
          hasCredential: !!(flags.hasAlphaEssAppId && flags.hasAlphaEssAppSecret)
        };
      case 'foxess':
      default:
        return {
          identifierLabel: 'Device SN',
          hasIdentifier: !!flags.hasDeviceSn,
          credentialLabel: 'API Token',
          hasCredential: !!flags.hasFoxessToken
        };
      }
    };

    // 1. Gather last 30 days of per-user API metrics
    const metricsSnap = await db.collection('users').doc(uid)
      .collection('metrics').orderBy('updatedAt', 'desc').limit(30).get();
    const metrics = {};
    metricsSnap.forEach(doc => {
      const rawMetrics = doc.data() || {};
      const inverterByProvider = {};
      let inverterTotal = 0;

      for (const providerKey of PROVIDER_KEYS) {
        inverterByProvider[providerKey] = toCounter(rawMetrics[providerKey]);
      }

      const aggregateInverterCounter = toCounter(rawMetrics.inverter);
      if (aggregateInverterCounter) {
        inverterTotal = aggregateInverterCounter;
      } else {
        Object.entries(rawMetrics).forEach(([metricKey, metricValue]) => {
          const normalizedMetricKey = String(metricKey || '').toLowerCase().trim();
          if (normalizedMetricKey === 'inverter' || KNOWN_NON_INVERTER_METRIC_KEYS.has(normalizedMetricKey)) return;
          const counter = toCounter(metricValue);
          if (!counter) return;

          if (KNOWN_INVERTER_METRIC_KEYS.has(normalizedMetricKey)) {
            inverterTotal += counter;
            return;
          }

          // Future provider counters should roll into inverter totals automatically.
          inverterTotal += counter;
        });
      }

      metrics[doc.id] = {
        inverter: inverterTotal,
        inverterByProvider,
        amber: toCounter(rawMetrics.amber),
        weather: toCounter(rawMetrics.weather),
        ev: resolveEvCounter(rawMetrics),
        // Legacy keys retained for compatibility with older admin clients.
        foxess: inverterByProvider.foxess,
        sungrow: inverterByProvider.sungrow,
        sigenergy: inverterByProvider.sigenergy,
        alphaess: inverterByProvider.alphaess
      };
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
      const [configDoc, secretsDoc] = await Promise.all([
        db.collection('users').doc(uid).collection('config').doc('main').get(),
        db.collection('users').doc(uid).collection('secrets').doc('credentials').get().catch(() => ({
          exists: false,
          data: () => ({})
        }))
      ]);
      if (configDoc.exists) {
        const c = configDoc.data();
        const secrets = secretsDoc.exists ? (secretsDoc.data() || {}) : {};
        const providerFlags = buildProviderFlags(c, secrets);
        const provider = providerFlags.provider;
        const providerAccess = buildProviderAccessSummary(provider, providerFlags);

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
          configured: !!(c.setupComplete === true || isProviderConfigured(provider, providerFlags) || hasAnyProviderConfigured(providerFlags)),
          deviceProvider: provider,
          providerAccess,
          hasDeviceSn: providerFlags.hasDeviceSn,
          hasFoxessToken: providerFlags.hasFoxessToken,
          hasAmberApiKey: providerFlags.hasAmberApiKey,
          hasAlphaEssSystemSn: providerFlags.hasAlphaEssSystemSn,
          hasAlphaEssAppId: providerFlags.hasAlphaEssAppId,
          hasAlphaEssAppSecret: providerFlags.hasAlphaEssAppSecret,
          hasSungrowUsername: providerFlags.hasSungrowUsername,
          hasSungrowDeviceSn: providerFlags.hasSungrowDeviceSn,
          hasSigenUsername: providerFlags.hasSigenUsername,
          hasSigenDeviceSn: providerFlags.hasSigenDeviceSn,
          hasSigenStationId: providerFlags.hasSigenStationId,
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
