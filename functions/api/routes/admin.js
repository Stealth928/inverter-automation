'use strict';

function registerAdminRoutes(app, deps = {}) {
  const { buildSchedulerSoakSummary } = require('../../lib/services/scheduler-soak-summary');
  const { AEMO_SUPPORTED_REGIONS } = require('../aemo');
  const authenticateUser = deps.authenticateUser;
  const requireAdmin = deps.requireAdmin;
  const googleApis = deps.googleApis;
  const getRuntimeProjectId = deps.getRuntimeProjectId;
  const listMonitoringTimeSeries = deps.listMonitoringTimeSeries;
  const normalizeMetricErrorMessage = deps.normalizeMetricErrorMessage;
  const fetchCloudBillingCost = deps.fetchCloudBillingCost;
  const sumSeriesValues = deps.sumSeriesValues;
  const estimateFirestoreCostFromUsage = deps.estimateFirestoreCostFromUsage;
  const buildFirestoreQuotaSummary = deps.buildFirestoreQuotaSummary;
  const db = deps.db;
  const admin = deps.admin;
  const serverTimestamp = deps.serverTimestamp;
  const deleteUserDataTree = deps.deleteUserDataTree;
  const deleteCollectionDocs = deps.deleteCollectionDocs;
  const normalizeCouplingValue = deps.normalizeCouplingValue;
  const isAdmin = deps.isAdmin;
  const getCacheMetricsSnapshot = typeof deps.getCacheMetricsSnapshot === 'function'
    ? deps.getCacheMetricsSnapshot
    : null;
  const getAutomationCycleHandler = typeof deps.getAutomationCycleHandler === 'function'
    ? deps.getAutomationCycleHandler
    : null;
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
  if (typeof buildFirestoreQuotaSummary !== 'function') {
    throw new Error('registerAdminRoutes requires buildFirestoreQuotaSummary()');
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
  const alphaessObservability = Object.freeze({
    enabled: true,
    version: '2026-03-25',
    liveRealtimeLogging: 'suspicious-only',
    manualDiagnosticsLogging: 'always',
    extraProviderCallsPerRequest: 0,
    extraFirestoreWritesPerRequest: 0,
    extraStorageWritesPerRequest: 0,
    notes: [
      'Diagnostics are computed in-memory from existing AlphaESS responses.',
      'GET /api/inverter/real-time only emits logs when anomalies are detected.',
      'POST /api/inverter/all-data always emits a diagnostic log because it is an explicit manual deep-diagnostics action.'
    ],
    watchWhen: [
      'Immediately after deploying AlphaESS normalization, battery-sign, or topology changes.',
      'After onboarding a new AlphaESS user or changing AlphaESS credentials.',
      'When support reports negative house load, impossible export, or missing temperature sensors.',
      'After running a manual live diagnostics scan to confirm whether the issue is transient or reproducible.'
    ],
    anomalyCodes: [
      {
        code: 'negative-load-power',
        title: 'Negative house load',
        lookFor: 'loadPower is below zero; treat the load channel as semantically suspect for that reading.'
      },
      {
        code: 'small-feed-in-value-may-be-watts',
        title: 'Tiny export value',
        lookFor: 'feedInPower is a small positive integer and may be watts rather than kilowatts.'
      },
      {
        code: 'small-grid-import-value-may-be-watts',
        title: 'Tiny import value',
        lookFor: 'gridPower is a small positive integer and may be watts rather than kilowatts.'
      },
      {
        code: 'power-unit-normalization-ambiguity',
        title: 'Unit ambiguity',
        lookFor: 'strict watt-to-kW conversion and heuristic conversion disagree materially; compare selectedKw vs heuristic values.'
      },
      {
        code: 'energy-flow-imbalance',
        title: 'Energy flow mismatch',
        lookFor: 'selected flow balance residual stays materially non-zero after the chosen battery sign is applied.'
      },
      {
        code: 'temperature-sensors-not-reporting',
        title: 'No temperature telemetry',
        lookFor: 'battery and ambient temperatures are both zero; expected on AlphaESS when sensors are absent or not exposed.'
      }
    ],
    rollback: {
      summary: 'Reversal is code-only. Remove the AlphaESS diagnostics helper wiring from the realtime and diagnostics routes, remove the admin panel, then redeploy functions and hosting. No data migration or cleanup job is required.',
      docsPath: 'docs/ALPHAESS_OBSERVABILITY_RUNBOOK_MAR26.md'
    }
  });
  const githubDispatchCooldownMs = parseBoundedPositiveInt(githubDataworks.dispatchCooldownMs, 90000, 3600000);
  let dataworksOpsCache = null;
  let dataworksOpsCacheExpiresAtMs = 0;
  let lastDataworksDispatchAtMs = 0;
  const aemoSnapshotScheduleDefaults = Object.freeze({
    cadenceMinutes: 5,
    lagMinutes: 1,
    timeZone: 'Australia/Brisbane',
    jobName: 'refreshAemoLiveSnapshots',
    source: 'scheduler',
    mode: 'scheduler-only'
  });

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

  const ANNOUNCEMENT_SEVERITIES = new Set(['info', 'success', 'warning', 'danger']);
  const ANNOUNCEMENT_DEFAULTS = Object.freeze({
    enabled: false,
    id: null,
    title: '',
    body: '',
    severity: 'info',
    showOnce: true,
    audience: {
      requireTourComplete: true,
      requireSetupComplete: true,
      requireAutomationEnabled: false,
      minAccountAgeDays: null,
      onlyIncludeUids: [],
      includeUids: [],
      excludeUids: []
    }
  });

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

  const normalizeAnnouncementId = (value) => {
    const raw = trimString(value);
    if (!raw) return null;
    const normalized = raw
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    return normalized || null;
  };

  const normalizeAnnouncementText = (value, maxLength = 4000) => {
    if (value === undefined || value === null) return '';
    return String(value)
      .replace(/\r\n/g, '\n')
      .trim()
      .slice(0, maxLength);
  };

  const normalizeUidList = (value, maxItems = 200) => {
    const items = Array.isArray(value)
      ? value
      : String(value || '').split(/[\n,]+/);
    const seen = new Set();
    const normalized = [];

    items.forEach((item) => {
      const uid = trimString(item);
      if (!uid || seen.has(uid)) return;
      seen.add(uid);
      normalized.push(uid);
    });

    return normalized.slice(0, maxItems);
  };

  const normalizeAnnouncementAudience = (value) => {
    const source = value && typeof value === 'object' ? value : {};
    const parsedAge = Number(source.minAccountAgeDays);
    const minAccountAgeDays = Number.isFinite(parsedAge)
      ? Math.max(0, Math.min(3650, Math.round(parsedAge)))
      : null;

    return {
      requireTourComplete: source.requireTourComplete !== false,
      requireSetupComplete: source.requireSetupComplete !== false,
      requireAutomationEnabled: source.requireAutomationEnabled === true,
      minAccountAgeDays: minAccountAgeDays > 0 ? minAccountAgeDays : null,
      onlyIncludeUids: normalizeUidList(source.onlyIncludeUids),
      includeUids: normalizeUidList(source.includeUids),
      excludeUids: normalizeUidList(source.excludeUids)
    };
  };

  const normalizeAnnouncementConfig = (value) => {
    const source = value && typeof value === 'object' ? value : {};
    const severity = trimString(source.severity);

    return {
      enabled: source.enabled === true,
      id: normalizeAnnouncementId(source.id),
      title: normalizeAnnouncementText(source.title, 160),
      body: normalizeAnnouncementText(source.body, 4000),
      severity: ANNOUNCEMENT_SEVERITIES.has(severity) ? severity : ANNOUNCEMENT_DEFAULTS.severity,
      showOnce: source.showOnce !== false,
      audience: normalizeAnnouncementAudience(source.audience)
    };
  };

  const resolveAnnouncementAudienceIdentifiers = async (value, fieldLabel) => {
    const identifiers = normalizeUidList(value);
    if (!identifiers.length) return [];

    const authApi = admin.auth();
    const resolved = await Promise.all(identifiers.map(async (identifier) => {
      if (!identifier.includes('@')) return identifier;

      const email = identifier.toLowerCase();
      try {
        const userRecord = await authApi.getUserByEmail(email);
        return trimString(userRecord?.uid);
      } catch (error) {
        if (error?.code === 'auth/user-not-found') {
          const resolutionError = new Error(`No user found for ${fieldLabel}: ${email}`);
          resolutionError.statusCode = 400;
          throw resolutionError;
        }
        throw error;
      }
    }));

    return normalizeUidList(resolved);
  };

  const resolveAnnouncementAudience = async (value) => {
    const audience = normalizeAnnouncementAudience(value);
    return {
      ...audience,
      onlyIncludeUids: await resolveAnnouncementAudienceIdentifiers(audience.onlyIncludeUids, 'only include'),
      includeUids: await resolveAnnouncementAudienceIdentifiers(audience.includeUids, 'always include'),
      excludeUids: await resolveAnnouncementAudienceIdentifiers(audience.excludeUids, 'always exclude')
    };
  };

  const resolveAnnouncementConfig = async (value) => {
    const announcement = normalizeAnnouncementConfig(value);
    return {
      ...announcement,
      audience: await resolveAnnouncementAudience(announcement.audience)
    };
  };

  const buildAnnouncementResponse = (value) => {
    const normalized = normalizeAnnouncementConfig(value);
    const source = value && typeof value === 'object' ? value : {};
    return {
      ...normalized,
      updatedAt: source.updatedAt || null,
      updatedByUid: trimString(source.updatedByUid),
      updatedByEmail: trimString(source.updatedByEmail)
    };
  };

  const readAnnouncementConfigDoc = async () => {
    const sharedDoc = await db.collection('shared').doc('serverConfig').get();
    if (!sharedDoc.exists) {
      return { announcement: buildAnnouncementResponse(null), exists: false };
    }
    const data = sharedDoc.data() || {};
    return {
      announcement: buildAnnouncementResponse(data.announcement),
      exists: true
    };
  };

  const validateAnnouncementConfig = (announcement) => {
    if (!announcement || typeof announcement !== 'object') {
      return 'Announcement payload is required';
    }
    if (announcement.enabled !== true) return null;
    if (!announcement.title && !announcement.body) {
      return 'Enabled announcements need a title or body';
    }
    if (announcement.showOnce && !announcement.id) {
      return 'Show-once announcements require an ID';
    }
    return null;
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

  function buildAemoLiveSnapshotRegionSummary(regionId, snapshotDoc, nowMs) {
    const regionMeta = AEMO_SUPPORTED_REGIONS[regionId] || {};
    const source = snapshotDoc && typeof snapshotDoc === 'object' ? snapshotDoc : {};
    const metadata = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
    const schedule = source.schedule && typeof source.schedule === 'object' ? source.schedule : {};
    const rows = Array.isArray(source.data) ? source.data : [];
    const cadenceMinutes = Number.isFinite(Number(schedule.cadenceMinutes))
      ? Math.max(1, Math.round(Number(schedule.cadenceMinutes)))
      : aemoSnapshotScheduleDefaults.cadenceMinutes;
    const lagMinutes = Number.isFinite(Number(schedule.lagMinutes))
      ? Math.max(0, Math.round(Number(schedule.lagMinutes)))
      : aemoSnapshotScheduleDefaults.lagMinutes;
    const freshThresholdMinutes = Math.max(12, cadenceMinutes + lagMinutes + 4);
    const staleThresholdMinutes = Math.max(20, cadenceMinutes * 4);
    const asOf = trimString(metadata.asOf);
    const asOfMs = toMs(asOf);
    const storedAtIso = trimString(source.storedAtIso);
    const storedAtMs = toMs(storedAtIso) || toMs(source.storedAt);
    const forecastHorizonMinutes = Number.isFinite(Number(metadata.forecastHorizonMinutes))
      ? Math.max(0, Math.round(Number(metadata.forecastHorizonMinutes)))
      : 0;
    const asOfAgeMinutes = Number.isFinite(asOfMs)
      ? Math.max(0, Math.round(((nowMs - asOfMs) / 60000) * 10) / 10)
      : null;
    const storedAgeMinutes = Number.isFinite(storedAtMs)
      ? Math.max(0, Math.round(((nowMs - storedAtMs) / 60000) * 10) / 10)
      : null;
    const currentRowCount = rows.filter((row) => row && row.type === 'CurrentInterval').length;
    const forecastRowCount = rows.filter((row) => row && row.type === 'ForecastInterval').length;

    let status = 'missing';
    let statusLabel = 'Missing';
    let statusLevel = 'warn';
    if (rows.length > 0 && Number.isFinite(asOfAgeMinutes)) {
      if (asOfAgeMinutes <= freshThresholdMinutes) {
        status = 'fresh';
        statusLabel = 'Fresh';
        statusLevel = 'good';
      } else if (asOfAgeMinutes <= staleThresholdMinutes) {
        status = 'watch';
        statusLabel = 'Watch';
        statusLevel = 'warn';
      } else {
        status = 'stale';
        statusLabel = 'Stale';
        statusLevel = 'bad';
      }
    }

    return {
      regionId,
      regionCode: trimString(regionMeta.code) || regionId.replace(/\d+$/g, ''),
      regionName: trimString(regionMeta.label) || regionId,
      asOf,
      asOfAgeMinutes,
      storedAt: storedAtIso || (Number.isFinite(storedAtMs) ? new Date(storedAtMs).toISOString() : null),
      storedAgeMinutes,
      rowCount: rows.length,
      currentRowCount,
      forecastRowCount,
      forecastHorizonMinutes,
      isForecastComplete: metadata.isForecastComplete === true,
      schedule: {
        cadenceMinutes,
        lagMinutes,
        source: trimString(schedule.source) || aemoSnapshotScheduleDefaults.source
      },
      status,
      statusLabel,
      statusLevel
    };
  }

  async function loadAemoLiveSnapshotSummary() {
    const nowMs = Date.now();
    const expectedRegions = Object.keys(AEMO_SUPPORTED_REGIONS);

    if (!db || typeof db.collection !== 'function') {
      return {
        available: false,
        status: {
          level: 'warn',
          label: 'Unavailable',
          reasons: ['Firestore db unavailable for AEMO snapshot health']
        },
        expectedRegionCount: expectedRegions.length,
        regions: [],
        schedule: aemoSnapshotScheduleDefaults,
        source: 'firestore:aemoSnapshots',
        queryOk: false
      };
    }

    try {
      const collectionRef = db.collection('aemoSnapshots');
      if (!collectionRef || typeof collectionRef.get !== 'function') {
        return {
          available: false,
          status: {
            level: 'warn',
            label: 'Unavailable',
            reasons: ['AEMO snapshot diagnostics not supported by this Firestore adapter']
          },
          expectedRegionCount: expectedRegions.length,
          regions: [],
          schedule: aemoSnapshotScheduleDefaults,
          source: 'firestore:aemoSnapshots',
          queryOk: false
        };
      }

      const snapshot = await collectionRef.get();
      const docMap = new Map();
      const docs = Array.isArray(snapshot?.docs) ? snapshot.docs : [];
      docs.forEach((doc) => {
        const regionId = trimString(doc?.id);
        if (!regionId || !expectedRegions.includes(regionId) || typeof doc?.data !== 'function') return;
        docMap.set(regionId, doc.data() || {});
      });

      const regions = expectedRegions
        .map((regionId) => buildAemoLiveSnapshotRegionSummary(regionId, docMap.get(regionId) || null, nowMs))
        .sort((left, right) => String(left.regionCode || left.regionId).localeCompare(String(right.regionCode || right.regionId)));

      const freshRegions = regions.filter((row) => row.status === 'fresh').length;
      const watchRegions = regions.filter((row) => row.status === 'watch').length;
      const staleRegions = regions.filter((row) => row.status === 'stale').length;
      const missingRegions = regions.filter((row) => row.status === 'missing').length;
      const forecastCompleteRegions = regions.filter((row) => row.isForecastComplete === true).length;
      const availableAsOfRows = regions.filter((row) => Number.isFinite(row.asOfAgeMinutes));
      const availableStoredRows = regions.filter((row) => Number.isFinite(row.storedAgeMinutes));
      const latestAsOfRow = availableAsOfRows
        .slice()
        .sort((left, right) => toMs(right.asOf) - toMs(left.asOf))[0] || null;
      const oldestAsOfRow = availableAsOfRows
        .slice()
        .sort((left, right) => toFiniteNumber(right.asOfAgeMinutes, -1) - toFiniteNumber(left.asOfAgeMinutes, -1))[0] || null;
      const latestStoredRow = availableStoredRows
        .slice()
        .sort((left, right) => toMs(right.storedAt) - toMs(left.storedAt))[0] || null;
      const horizonValues = regions
        .map((row) => Number(row.forecastHorizonMinutes))
        .filter((value) => Number.isFinite(value) && value > 0);
      const totalRows = regions.reduce((sum, row) => sum + toFiniteNumber(row.rowCount, 0), 0);
      const reasons = [];
      let level = 'good';
      let label = 'Healthy';

      if (missingRegions > 0) {
        reasons.push(`${missingRegions} of ${expectedRegions.length} live region snapshot${missingRegions === 1 ? ' is' : 's are'} missing`);
      }
      if (staleRegions > 0) {
        reasons.push(`${staleRegions} live region snapshot${staleRegions === 1 ? ' is' : 's are'} stale`);
      }
      if (watchRegions > 0) {
        reasons.push(`${watchRegions} live region snapshot${watchRegions === 1 ? ' is' : 's are'} aging`);
      }
      if (oldestAsOfRow && Number.isFinite(oldestAsOfRow.asOfAgeMinutes)) {
        reasons.push(`oldest live interval is ${Math.round(oldestAsOfRow.asOfAgeMinutes)}m old`);
      }

      if (staleRegions > 0 || missingRegions >= 2) {
        level = 'bad';
        label = 'Stale';
      } else if (missingRegions > 0 || watchRegions > 0) {
        level = 'warn';
        label = 'Watch';
      }

      return {
        available: true,
        status: {
          level,
          label,
          reasons
        },
        expectedRegionCount: expectedRegions.length,
        freshRegions,
        watchRegions,
        staleRegions,
        missingRegions,
        forecastCompleteRegions,
        totalRows,
        latestAsOf: latestAsOfRow?.asOf || null,
        latestStoredAt: latestStoredRow?.storedAt || null,
        oldestAsOfAgeMinutes: oldestAsOfRow?.asOfAgeMinutes ?? null,
        minForecastHorizonMinutes: horizonValues.length ? Math.min(...horizonValues) : 0,
        maxForecastHorizonMinutes: horizonValues.length ? Math.max(...horizonValues) : 0,
        regions,
        schedule: aemoSnapshotScheduleDefaults,
        source: 'firestore:aemoSnapshots',
        queryOk: true
      };
    } catch (error) {
      return {
        available: false,
        status: {
          level: 'warn',
          label: 'Unavailable',
          reasons: [error?.message || 'Failed to load AEMO live snapshot health']
        },
        expectedRegionCount: expectedRegions.length,
        regions: [],
        schedule: aemoSnapshotScheduleDefaults,
        source: 'firestore:aemoSnapshots',
        queryOk: false,
        error: error?.message || String(error)
      };
    }
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

    const [liveRelease, targetRef, liveAemo] = await Promise.all([
      fetchHostedReleaseManifest(),
      resolveGithubRefCommit(githubRef),
      loadAemoLiveSnapshotSummary()
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
      liveAemo,
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

  app.get('/api/admin/announcement', authenticateUser, requireAdmin, async (req, res) => {
    try {
      const { announcement } = await readAnnouncementConfigDoc();
      res.json({ errno: 0, result: { announcement } });
    } catch (error) {
      console.error('[Admin] Failed to load announcement config:', error?.message || error);
      res.status(500).json({ errno: 500, error: error?.message || 'Failed to load announcement config' });
    }
  });

  app.post('/api/admin/announcement', authenticateUser, requireAdmin, async (req, res) => {
    try {
      const announcementInput = req.body?.announcement && typeof req.body.announcement === 'object'
        ? req.body.announcement
        : req.body;
      const announcement = await resolveAnnouncementConfig(announcementInput);
      const validationError = validateAnnouncementConfig(announcement);
      if (validationError) {
        return res.status(400).json({ errno: 400, error: validationError });
      }

      await db.collection('shared').doc('serverConfig').set({
        announcement: {
          ...announcement,
          updatedAt: serverTimestamp(),
          updatedByUid: req.user.uid,
          updatedByEmail: req.user.email || ''
        }
      }, { merge: true });

      const { announcement: savedAnnouncement } = await readAnnouncementConfigDoc();
      return res.json({ errno: 0, result: { announcement: savedAnnouncement } });
    } catch (error) {
      if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500) {
        return res.status(error.statusCode).json({ errno: error.statusCode, error: error.message });
      }
      console.error('[Admin] Failed to save announcement config:', error?.message || error);
      return res.status(500).json({ errno: 500, error: error?.message || 'Failed to save announcement config' });
    }
  });

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

  const ADMIN_BEHAVIOR_CACHE_TTL_MS = 5 * 60 * 1000;
  const ADMIN_BEHAVIOR_PROPERTY_ENV_NAMES = [
    'GA4_PROPERTY_ID',
    'GOOGLE_ANALYTICS_PROPERTY_ID',
    'ANALYTICS_PROPERTY_ID'
  ];
  const ADMIN_BEHAVIOR_MEASUREMENT_ENV_NAMES = [
    'GA4_MEASUREMENT_ID',
    'GOOGLE_ANALYTICS_MEASUREMENT_ID',
    'ANALYTICS_MEASUREMENT_ID'
  ];
  const DEFAULT_GA4_MEASUREMENT_ID = 'G-MWF4ZBMREE';
  const ADMIN_BEHAVIOR_MAX_PROPERTY_SCAN_COUNT = 25;
  const ADMIN_BEHAVIOR_MAIN_PAGES = [
    {
      key: 'app',
      label: 'Dashboard',
      buildFilter: () => ({
        orGroup: {
          expressions: [
            {
              filter: {
                fieldName: 'pagePath',
                stringFilter: { matchType: 'EXACT', value: '/' }
              }
            },
            {
              filter: {
                fieldName: 'pagePath',
                stringFilter: { matchType: 'EXACT', value: '/app' }
              }
            },
            {
              filter: {
                fieldName: 'pagePath',
                stringFilter: { matchType: 'BEGINS_WITH', value: '/app' }
              }
            }
          ]
        }
      })
    },
    {
      key: 'control',
      label: 'Control',
      buildFilter: () => ({
        filter: {
          fieldName: 'pagePath',
          stringFilter: { matchType: 'BEGINS_WITH', value: '/control' }
        }
      })
    },
    {
      key: 'history',
      label: 'History',
      buildFilter: () => ({
        filter: {
          fieldName: 'pagePath',
          stringFilter: { matchType: 'BEGINS_WITH', value: '/history' }
        }
      })
    },
    {
      key: 'settings',
      label: 'Settings',
      buildFilter: () => ({
        filter: {
          fieldName: 'pagePath',
          stringFilter: { matchType: 'BEGINS_WITH', value: '/settings' }
        }
      })
    },
    {
      key: 'admin',
      label: 'Admin',
      buildFilter: () => ({
        filter: {
          fieldName: 'pagePath',
          stringFilter: { matchType: 'BEGINS_WITH', value: '/admin' }
        }
      })
    }
  ];
  let adminBehaviorMetricsCache = {
    key: '',
    data: null,
    expiresAtMs: 0,
    pending: null
  };
  let adminBehaviorProjectAnalyticsCache = {
    projectId: '',
    data: null,
    expiresAtMs: 0,
    pending: null
  };
  let adminBehaviorPropertyDiscoveryCache = {
    measurementId: '',
    propertyId: null,
    expiresAtMs: 0,
    pending: null
  };
  const ADMIN_API_HEALTH_CACHE_TTL_MS = 5 * 60 * 1000;
  const ADMIN_API_HEALTH_PROVIDER_LABELS = Object.freeze({
    foxess: 'FoxESS',
    sungrow: 'Sungrow',
    sigenergy: 'SigenEnergy',
    alphaess: 'AlphaESS',
    amber: 'Amber',
    weather: 'Weather',
    ev: 'Tesla EV'
  });
  const ADMIN_API_HEALTH_PROVIDER_KEYS = Object.keys(ADMIN_API_HEALTH_PROVIDER_LABELS);
  let adminApiHealthCache = {
    key: '',
    data: null,
    expiresAtMs: 0,
    pending: null
  };

  const getAdminMetricsDateKey = (date = new Date(), timeZone = 'Australia/Sydney') =>
    date.toLocaleDateString('en-CA', { timeZone });

  const toCounter = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.round(parsed);
  };

  const getTeslaFleetRoot = (metricsDoc = {}) => {
    if (!metricsDoc || typeof metricsDoc !== 'object') return null;
    return metricsDoc.teslaFleet || metricsDoc.teslafleet || null;
  };

  const readNestedCounter = (root, path = []) => {
    if (!root || typeof root !== 'object' || !Array.isArray(path) || !path.length) return 0;
    let cursor = root;
    for (const segment of path) {
      if (!cursor || typeof cursor !== 'object') return 0;
      cursor = cursor[segment];
    }
    return toCounter(cursor);
  };

  const readFlatCounter = (root, key) => {
    if (!root || typeof root !== 'object' || !key) return 0;
    return toCounter(root[key]);
  };

  const buildEvBreakdown = (metricsDoc = {}) => {
    const teslaFleetRoot = getTeslaFleetRoot(metricsDoc);
    const byCategory = teslaFleetRoot && teslaFleetRoot.calls && typeof teslaFleetRoot.calls.byCategory === 'object'
      ? teslaFleetRoot.calls.byCategory
      : null;

    const breakdown = {};
    if (byCategory) {
      Object.entries(byCategory).forEach(([key, value]) => {
        const normalized = String(key || '').trim();
        if (!normalized) return;
        breakdown[normalized] = toCounter(value);
      });
    }

    Object.entries(metricsDoc).forEach(([key, value]) => {
      const match = /^teslaFleet\.calls\.byCategory\.(.+)$/.exec(String(key || ''));
      if (!match) return;
      const normalized = String(match[1] || '').trim();
      if (!normalized) return;
      breakdown[normalized] = toCounter(value);
    });

    return breakdown;
  };

  const resolveEvCounter = (metricsDoc = {}) => {
    const explicitEv = toCounter(metricsDoc.ev);
    if (explicitEv) return explicitEv;

    const explicitTesla = toCounter(metricsDoc.tesla);
    if (explicitTesla) return explicitTesla;

    const teslaFleetRoot = getTeslaFleetRoot(metricsDoc);
    const billable = readNestedCounter(teslaFleetRoot, ['calls', 'billable']);
    if (billable) return billable;

    const flatBillable = readFlatCounter(metricsDoc, 'teslaFleet.calls.billable');
    if (flatBillable) return flatBillable;

    const total = readNestedCounter(teslaFleetRoot, ['calls', 'total']);
    if (total) return total;

    const flatTotal = readFlatCounter(metricsDoc, 'teslaFleet.calls.total');
    if (flatTotal) return flatTotal;

    const byCategory = teslaFleetRoot && teslaFleetRoot.calls && typeof teslaFleetRoot.calls.byCategory === 'object'
      ? teslaFleetRoot.calls.byCategory
      : null;
    const nestedTotal = byCategory
      ? Object.values(byCategory).reduce((sum, value) => sum + toCounter(value), 0)
      : 0;
    if (nestedTotal) return nestedTotal;

    return Object.entries(metricsDoc).reduce((sum, [key, value]) => {
      if (!/^teslaFleet\.calls\.byCategory\./.test(String(key || ''))) return sum;
      return sum + toCounter(value);
    }, 0);
  };

  const buildApiHealthMetricsEnvelope = (rawDoc = {}) => {
    const metricsDoc = rawDoc && typeof rawDoc === 'object' ? rawDoc : {};
    const evBreakdown = buildEvBreakdown(metricsDoc);
    const providers = {
      foxess: toCounter(metricsDoc.foxess),
      sungrow: toCounter(metricsDoc.sungrow),
      sigenergy: toCounter(metricsDoc.sigenergy),
      alphaess: toCounter(metricsDoc.alphaess),
      amber: toCounter(metricsDoc.amber),
      weather: toCounter(metricsDoc.weather),
      ev: resolveEvCounter(metricsDoc)
    };
    const inverterCalls = providers.foxess + providers.sungrow + providers.sigenergy + providers.alphaess;
    const totalCalls = inverterCalls + providers.amber + providers.weather + providers.ev;

    return {
      totalCalls,
      providers,
      categories: {
        inverter: inverterCalls,
        amber: providers.amber,
        weather: providers.weather,
        ev: providers.ev
      },
      evBreakdown
    };
  };

  const sumArray = (values = []) => values.reduce((sum, value) => sum + (Number(value) || 0), 0);

  const averageArray = (values = []) => {
    if (!Array.isArray(values) || !values.length) return 0;
    return sumArray(values) / values.length;
  };

  const pctChange = (currentValue, previousValue) => {
    const current = Number(currentValue || 0);
    const previous = Number(previousValue || 0);
    if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
    if (previous <= 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  };

  const getWindowRows = (rows, count, offset = 0) => {
    const safeRows = Array.isArray(rows) ? rows : [];
    const safeCount = Math.max(0, Math.floor(count || 0));
    const safeOffset = Math.max(0, Math.floor(offset || 0));
    if (!safeCount) return [];
    const endIndex = safeRows.length - safeOffset;
    const startIndex = Math.max(0, endIndex - safeCount);
    return safeRows.slice(startIndex, endIndex);
  };

  const sumRows = (rows, accessor) => {
    if (!Array.isArray(rows) || typeof accessor !== 'function') return 0;
    return rows.reduce((sum, row) => sum + (Number(accessor(row)) || 0), 0);
  };

  const averageRows = (rows, accessor) => {
    if (!Array.isArray(rows) || !rows.length || typeof accessor !== 'function') return 0;
    return sumRows(rows, accessor) / rows.length;
  };

  const computeStdDev = (values = []) => {
    if (!Array.isArray(values) || !values.length) return 0;
    const mean = averageArray(values);
    const variance = values.reduce((sum, value) => {
      const numeric = Number(value || 0);
      return sum + ((numeric - mean) ** 2);
    }, 0) / values.length;
    return Math.sqrt(Math.max(variance, 0));
  };

  const formatAlertDetailNumber = (value) => {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return '0';
    return numeric.toLocaleString('en-AU');
  };

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

  const normalizeDeadLetterErrorKey = (value) => {
    const text = String(value || '').trim();
    if (!text) return 'unknown_error';
    return text.toLowerCase().replace(/\s+/g, ' ').slice(0, 160);
  };

  const createMockResponseCollector = () => {
    let statusCode = 200;
    let payload = null;
    return {
      response: {
        status(code) {
          statusCode = Number(code) || 200;
          return this;
        },
        json(body) {
          payload = body;
          return this;
        }
      },
      getResult() {
        return {
          payload,
          statusCode
        };
      }
    };
  };

  const invokeAutomationCycleForAdminRetry = async ({ cycleKey, userId }) => {
    const automationCycleHandler = getAutomationCycleHandler ? getAutomationCycleHandler() : null;
    if (typeof automationCycleHandler !== 'function') {
      throw new Error('Automation cycle handler unavailable');
    }

    const collector = createMockResponseCollector();
    const headers = { 'x-automation-cycle-key': cycleKey };
    const mockReq = {
      user: { uid: userId },
      body: { cycleKey },
      headers,
      get: (name) => headers[String(name || '').toLowerCase()] || null
    };

    await automationCycleHandler(mockReq, collector.response);
    return collector.getResult();
  };

  async function getCachedAdminApiHealth(cacheKey, loadHealth, { forceRefresh = false } = {}) {
    const now = Date.now();
    const hasFreshValue = !forceRefresh
      && adminApiHealthCache.key === cacheKey
      && adminApiHealthCache.data
      && adminApiHealthCache.expiresAtMs > now;

    if (hasFreshValue) {
      return { ...adminApiHealthCache.data, cache: { hit: true, ttlMs: ADMIN_API_HEALTH_CACHE_TTL_MS } };
    }

    if (!forceRefresh && adminApiHealthCache.key === cacheKey && adminApiHealthCache.pending) {
      return adminApiHealthCache.pending;
    }

    const pending = Promise.resolve()
      .then(loadHealth)
      .then((data) => {
        adminApiHealthCache = {
          key: cacheKey,
          data,
          expiresAtMs: Date.now() + ADMIN_API_HEALTH_CACHE_TTL_MS,
          pending: null
        };
        return { ...data, cache: { hit: false, ttlMs: ADMIN_API_HEALTH_CACHE_TTL_MS } };
      })
      .catch((error) => {
        adminApiHealthCache.pending = null;
        throw error;
      });

    adminApiHealthCache = {
      key: cacheKey,
      data: adminApiHealthCache.key === cacheKey ? adminApiHealthCache.data : null,
      expiresAtMs: adminApiHealthCache.key === cacheKey ? adminApiHealthCache.expiresAtMs : 0,
      pending
    };

    return pending;
  }

  const normalizeGa4PropertyId = (value) => {
    const raw = trimString(value);
    if (!raw) return null;
    const normalized = raw.replace(/^properties\//i, '');
    return /^\d+$/.test(normalized) ? normalized : null;
  };

  const normalizeGa4MeasurementId = (value) => {
    const raw = trimString(value);
    if (!raw) return null;
    return /^G-[A-Z0-9]+$/i.test(raw) ? raw.toUpperCase() : null;
  };

  const resolveGa4PropertyId = () => {
    for (const envName of ADMIN_BEHAVIOR_PROPERTY_ENV_NAMES) {
      const propertyId = normalizeGa4PropertyId(process.env[envName]);
      if (propertyId) return propertyId;
    }
    return null;
  };

  const resolveGa4MeasurementId = () => {
    for (const envName of ADMIN_BEHAVIOR_MEASUREMENT_ENV_NAMES) {
      const measurementId = normalizeGa4MeasurementId(process.env[envName]);
      if (measurementId) return measurementId;
    }
    return normalizeGa4MeasurementId(DEFAULT_GA4_MEASUREMENT_ID);
  };

  const normalizeGa4Date = (value) => {
    const raw = trimString(value);
    if (!raw || !/^\d{8}$/.test(raw)) return null;
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  };

  const getGa4HeaderIndex = (headers, name) => Array.isArray(headers)
    ? headers.findIndex((header) => header && header.name === name)
    : -1;

  const parseGa4DimensionValue = (row, headers, name) => {
    const index = getGa4HeaderIndex(headers, name);
    if (index < 0) return null;
    return trimString(row?.dimensionValues?.[index]?.value);
  };

  const parseGa4MetricValue = (row, headers, name) => {
    const index = getGa4HeaderIndex(headers, name);
    if (index < 0) return 0;
    const numeric = Number(row?.metricValues?.[index]?.value || 0);
    return Number.isFinite(numeric) ? numeric : 0;
  };

  const buildBehaviorPageSeriesTemplate = (dates = []) => dates.map((date) => ({
    date,
    activeUsers: 0,
    pageViews: 0,
    eventCount: 0
  }));

  const buildGa4ApiErrorMessage = (error) => {
    const message = String(error?.message || error || 'Unable to load GA4 behavior metrics');
    if (/firebase\.googleapis\.com/i.test(message)) {
      return 'Firebase Management API is not enabled for this project. Enable firebase.googleapis.com and retry.';
    }
    if (/analyticsadmin\.googleapis\.com/i.test(message)) {
      return 'GA4 Admin API is not enabled for this project. Enable analyticsadmin.googleapis.com and retry.';
    }
    if (/analyticsdata\.googleapis\.com|SERVICE_DISABLED|has not been used/i.test(message)) {
      return 'GA4 Data API is not enabled for this project. Enable analyticsdata.googleapis.com and retry.';
    }
    if (/firebase/i.test(message) && /PERMISSION_DENIED|permission|access denied|insufficient/i.test(message)) {
      return 'Firebase project analytics lookup denied. Grant the Cloud Functions service account Firebase Viewer access or set GA4_PROPERTY_ID explicitly.';
    }
    if (/PERMISSION_DENIED|permission|access denied|insufficient/i.test(message)) {
      return 'GA4 Data API access denied. Grant the Cloud Functions service account Viewer or Analyst access to the configured GA4 property.';
    }
    if (/not found|404/i.test(message)) {
      return 'Configured GA4 property id was not found. Set GA4_PROPERTY_ID to the numeric GA4 property id and retry.';
    }
    return message;
  };

  async function resolveGa4PropertyFromFirebaseProject(projectId, preferredMeasurementId) {
    const normalizedProjectId = trimString(projectId);
    const normalizedPreferredMeasurementId = normalizeGa4MeasurementId(preferredMeasurementId);
    if (!normalizedProjectId || !googleApis || typeof googleApis.firebase !== 'function') {
      return { propertyId: null, measurementId: null, warning: null };
    }

    const now = Date.now();
    const hasFreshValue = adminBehaviorProjectAnalyticsCache.projectId === normalizedProjectId
      && adminBehaviorProjectAnalyticsCache.data
      && adminBehaviorProjectAnalyticsCache.expiresAtMs > now;

    if (hasFreshValue) {
      const cachedMeasurementIds = Array.isArray(adminBehaviorProjectAnalyticsCache.data.measurementIds)
        ? adminBehaviorProjectAnalyticsCache.data.measurementIds
        : [];
      const cachedMeasurementId = normalizedPreferredMeasurementId && cachedMeasurementIds.includes(normalizedPreferredMeasurementId)
        ? normalizedPreferredMeasurementId
        : (cachedMeasurementIds[0] || null);
      return {
        propertyId: adminBehaviorProjectAnalyticsCache.data.propertyId,
        measurementId: cachedMeasurementId,
        warning: adminBehaviorProjectAnalyticsCache.data.warning || null
      };
    }

    if (adminBehaviorProjectAnalyticsCache.projectId === normalizedProjectId && adminBehaviorProjectAnalyticsCache.pending) {
      return adminBehaviorProjectAnalyticsCache.pending;
    }

    const pending = (async () => {
      try {
        const auth = new googleApis.auth.GoogleAuth({
          scopes: ['https://www.googleapis.com/auth/firebase.readonly']
        });
        const firebaseManagement = googleApis.firebase({ version: 'v1beta1', auth });
        const response = await firebaseManagement.projects.getAnalyticsDetails({
          name: `projects/${normalizedProjectId}/analyticsDetails`
        });
        const propertyId = normalizeGa4PropertyId(response?.data?.analyticsProperty?.id);
        const measurementIds = Array.isArray(response?.data?.streamMappings)
          ? response.data.streamMappings
            .map((mapping) => normalizeGa4MeasurementId(mapping?.measurementId))
            .filter(Boolean)
          : [];
        const data = {
          propertyId,
          measurementIds,
          warning: null
        };
        adminBehaviorProjectAnalyticsCache = {
          projectId: normalizedProjectId,
          data,
          expiresAtMs: Date.now() + ADMIN_BEHAVIOR_CACHE_TTL_MS,
          pending: null
        };
        return {
          propertyId,
          measurementId: normalizedPreferredMeasurementId && measurementIds.includes(normalizedPreferredMeasurementId)
            ? normalizedPreferredMeasurementId
            : (measurementIds[0] || null),
          warning: null
        };
      } catch (error) {
        const message = String(error?.message || error || '');
        const isNotFound = /NOT_FOUND|not found|404/i.test(message);
        const warning = isNotFound ? null : buildGa4ApiErrorMessage(error);
        const data = {
          propertyId: null,
          measurementIds: [],
          warning
        };
        adminBehaviorProjectAnalyticsCache = {
          projectId: normalizedProjectId,
          data,
          expiresAtMs: Date.now() + (warning ? 60 * 1000 : ADMIN_BEHAVIOR_CACHE_TTL_MS),
          pending: null
        };
        return { propertyId: null, measurementId: null, warning };
      }
    })().catch((error) => {
      adminBehaviorProjectAnalyticsCache.pending = null;
      throw error;
    });

    adminBehaviorProjectAnalyticsCache = {
      projectId: normalizedProjectId,
      data: null,
      expiresAtMs: 0,
      pending
    };

    return pending;
  }

  async function discoverGa4PropertyIdFromMeasurementId(measurementId) {
    const normalizedMeasurementId = normalizeGa4MeasurementId(measurementId);
    if (!normalizedMeasurementId) return null;
    if (!googleApis) return null;

    const now = Date.now();
    const hasFreshDiscovery = adminBehaviorPropertyDiscoveryCache.measurementId === normalizedMeasurementId
      && adminBehaviorPropertyDiscoveryCache.propertyId
      && adminBehaviorPropertyDiscoveryCache.expiresAtMs > now;
    if (hasFreshDiscovery) {
      return adminBehaviorPropertyDiscoveryCache.propertyId;
    }

    if (adminBehaviorPropertyDiscoveryCache.measurementId === normalizedMeasurementId
      && adminBehaviorPropertyDiscoveryCache.pending) {
      return adminBehaviorPropertyDiscoveryCache.pending;
    }

    const pending = (async () => {
      const auth = new googleApis.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/analytics.readonly']
      });
      const analyticsadmin = googleApis.analyticsadmin({ version: 'v1beta', auth });

      const summariesResponse = await analyticsadmin.accountSummaries.list({ pageSize: 50 });
      const accountSummaries = Array.isArray(summariesResponse?.data?.accountSummaries)
        ? summariesResponse.data.accountSummaries
        : [];
      let scannedPropertyCount = 0;

      for (const summary of accountSummaries) {
        const propertySummaries = Array.isArray(summary?.propertySummaries)
          ? summary.propertySummaries
          : [];

        for (const propertySummary of propertySummaries) {
          if (scannedPropertyCount >= ADMIN_BEHAVIOR_MAX_PROPERTY_SCAN_COUNT) {
            adminBehaviorPropertyDiscoveryCache = {
              measurementId: normalizedMeasurementId,
              propertyId: null,
              expiresAtMs: Date.now() + 60 * 1000,
              pending: null
            };
            return null;
          }
          const propertyName = trimString(propertySummary?.property);
          const propertyId = normalizeGa4PropertyId(propertyName);
          if (!propertyName || !propertyId) continue;
          scannedPropertyCount += 1;

          const streamsResponse = await analyticsadmin.properties.dataStreams.list({
            parent: propertyName,
            pageSize: 50
          });
          const dataStreams = Array.isArray(streamsResponse?.data?.dataStreams)
            ? streamsResponse.data.dataStreams
            : [];

          const matchingStream = dataStreams.find((stream) => {
            const candidateMeasurementId = normalizeGa4MeasurementId(stream?.webStreamData?.measurementId);
            return candidateMeasurementId === normalizedMeasurementId;
          });

          if (matchingStream) {
            adminBehaviorPropertyDiscoveryCache = {
              measurementId: normalizedMeasurementId,
              propertyId,
              expiresAtMs: Date.now() + ADMIN_BEHAVIOR_CACHE_TTL_MS,
              pending: null
            };
            return propertyId;
          }
        }
      }

      adminBehaviorPropertyDiscoveryCache = {
        measurementId: normalizedMeasurementId,
        propertyId: null,
        expiresAtMs: Date.now() + 60 * 1000,
        pending: null
      };
      return null;
    })().catch((error) => {
      adminBehaviorPropertyDiscoveryCache.pending = null;
      throw error;
    });

    adminBehaviorPropertyDiscoveryCache = {
      measurementId: normalizedMeasurementId,
      propertyId: null,
      expiresAtMs: 0,
      pending
    };

    return pending;
  }

  async function getCachedAdminBehaviorMetrics(cacheKey, loadMetrics, { forceRefresh = false } = {}) {
    const now = Date.now();
    const hasFreshValue = !forceRefresh
      && adminBehaviorMetricsCache.key === cacheKey
      && adminBehaviorMetricsCache.data
      && adminBehaviorMetricsCache.expiresAtMs > now;

    if (hasFreshValue) {
      return { ...adminBehaviorMetricsCache.data, cache: { hit: true, ttlMs: ADMIN_BEHAVIOR_CACHE_TTL_MS } };
    }

    if (!forceRefresh && adminBehaviorMetricsCache.key === cacheKey && adminBehaviorMetricsCache.pending) {
      return adminBehaviorMetricsCache.pending;
    }

    const pending = Promise.resolve()
      .then(loadMetrics)
      .then((data) => {
        adminBehaviorMetricsCache = {
          key: cacheKey,
          data,
          expiresAtMs: Date.now() + ADMIN_BEHAVIOR_CACHE_TTL_MS,
          pending: null
        };
        return { ...data, cache: { hit: false, ttlMs: ADMIN_BEHAVIOR_CACHE_TTL_MS } };
      })
      .catch((error) => {
        adminBehaviorMetricsCache.pending = null;
        throw error;
      });

    adminBehaviorMetricsCache = {
      key: cacheKey,
      data: adminBehaviorMetricsCache.key === cacheKey ? adminBehaviorMetricsCache.data : null,
      expiresAtMs: adminBehaviorMetricsCache.key === cacheKey ? adminBehaviorMetricsCache.expiresAtMs : 0,
      pending
    };

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
    const quota = buildFirestoreQuotaSummary({
      deletesMtd,
      deletesSeries,
      nowDate: now,
      readsMtd,
      readsSeries,
      writesMtd,
      writesSeries
    });
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
    const cache = getCacheMetricsSnapshot ? getCacheMetricsSnapshot() : null;

    for (const alert of quota.alerts || []) {
      warnings.push(alert.message);
    }

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
          quota,
          estimatedDocOpsCostUsd: firestoreDocOpsCostUsd,
          estimatedDocOpsBreakdown: firestoreDocOpsBreakdown
        },
        cache,
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
 * GET /api/admin/behavior-metrics - Pull aggregated GA4 behavior metrics for admin UI.
 * Query: ?days=30&limit=8&refresh=1
 */
app.get('/api/admin/behavior-metrics', authenticateUser, requireAdmin, async (req, res) => {
  try {
    if (!googleApis) {
      return res.status(503).json({ errno: 503, error: 'googleapis dependency not available on server' });
    }

    const projectId = getRuntimeProjectId();
    const preferredMeasurementId = resolveGa4MeasurementId();
    const configuredPropertyId = resolveGa4PropertyId();
    const firebaseProjectAnalytics = configuredPropertyId
      ? { propertyId: null, measurementId: null, warning: null }
      : await resolveGa4PropertyFromFirebaseProject(projectId, preferredMeasurementId);
    const measurementId = firebaseProjectAnalytics.measurementId || preferredMeasurementId;
    const propertyId = configuredPropertyId
      || firebaseProjectAnalytics.propertyId
      || await discoverGa4PropertyIdFromMeasurementId(measurementId);
    const daysRaw = Number(req.query?.days);
    const limitRaw = Number(req.query?.limit);
    const days = Number.isFinite(daysRaw) ? Math.max(7, Math.min(90, Math.floor(daysRaw))) : 30;
    const limit = Number.isFinite(limitRaw) ? Math.max(5, Math.min(20, Math.floor(limitRaw))) : 8;
    const forceRefresh = String(req.query?.refresh || req.query?.force || '').trim() === '1';
    const resolutionWarnings = [];
    if (firebaseProjectAnalytics.warning) {
      resolutionWarnings.push(firebaseProjectAnalytics.warning);
    }

    if (!propertyId) {
      return res.json({
        errno: 0,
        result: {
          configured: false,
          source: 'ga4-data-api',
          updatedAt: new Date().toISOString(),
          window: { days, startDate: `${days}daysAgo`, endDate: 'today' },
          summary: null,
          pageSeries: [],
          topPages: [],
          topEvents: [],
          warnings: ['GA4 property id could not be resolved on server', ...resolutionWarnings],
          setup: {
            requiredEnv: 'GA4_PROPERTY_ID',
            acceptedEnvNames: ADMIN_BEHAVIOR_PROPERTY_ENV_NAMES,
            projectId,
            measurementId,
            acceptedMeasurementEnvNames: ADMIN_BEHAVIOR_MEASUREMENT_ENV_NAMES,
            message: measurementId
              ? `Unable to resolve a GA4 property for Firebase project ${projectId || 'unknown-project'} from measurement id ${measurementId}. Set GA4_PROPERTY_ID explicitly, or grant the Functions service account Firebase project analytics read access and GA4 Admin/Data API access.`
              : 'Set GA4_PROPERTY_ID to the numeric Google Analytics 4 property id for your web property to enable the Behaviour tab.'
          }
        }
      });
    }

    const cacheKey = `${propertyId}:${days}:${limit}`;
    const loadMetrics = async () => {
      const auth = new googleApis.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/analytics.readonly']
      });
      const analyticsdata = googleApis.analyticsdata({ version: 'v1beta', auth });
      const property = `properties/${propertyId}`;
      const dateRanges = [{ startDate: `${days}daysAgo`, endDate: 'today' }];

      const [summaryResponse, dailyResponse, topPagesResponse, topEventsResponse, mainPagesResponse] = await Promise.all([
        analyticsdata.properties.runReport({
          property,
          requestBody: {
            dateRanges,
            metrics: [
              { name: 'activeUsers' },
              { name: 'screenPageViews' },
              { name: 'eventCount' },
              { name: 'userEngagementDuration' }
            ],
            limit: '1'
          }
        }),
        analyticsdata.properties.runReport({
          property,
          requestBody: {
            dateRanges,
            dimensions: [{ name: 'date' }],
            metrics: [
              { name: 'activeUsers' },
              { name: 'screenPageViews' },
              { name: 'eventCount' }
            ],
            orderBys: [{ dimension: { dimensionName: 'date' } }],
            limit: String(Math.max(days, 31))
          }
        }),
        analyticsdata.properties.runReport({
          property,
          requestBody: {
            dateRanges,
            dimensions: [
              { name: 'pagePath' },
              { name: 'pageTitle' }
            ],
            metrics: [
              { name: 'screenPageViews' },
              { name: 'activeUsers' },
              { name: 'userEngagementDuration' }
            ],
            orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
            limit: String(limit)
          }
        }),
        analyticsdata.properties.runReport({
          property,
          requestBody: {
            dateRanges,
            dimensions: [{ name: 'eventName' }],
            metrics: [
              { name: 'eventCount' },
              { name: 'activeUsers' }
            ],
            orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
            limit: '50'
          }
        }),
        analyticsdata.properties.batchRunReports({
          property,
          requestBody: {
            requests: ADMIN_BEHAVIOR_MAIN_PAGES.map((page) => ({
              dateRanges,
              dimensions: [{ name: 'date' }],
              metrics: [
                { name: 'activeUsers' },
                { name: 'screenPageViews' }
              ],
              dimensionFilter: page.buildFilter(),
              orderBys: [{ dimension: { dimensionName: 'date' } }],
              limit: String(Math.max(days, 31))
            }))
          }
        })
      ]);

      const summaryData = summaryResponse?.data || {};
      const summaryHeaders = summaryData.metricHeaders || [];
      const summaryRow = Array.isArray(summaryData.rows) ? summaryData.rows[0] : null;

      const dailyData = dailyResponse?.data || {};
      const dailyDimensionHeaders = dailyData.dimensionHeaders || [];
      const dailyMetricHeaders = dailyData.metricHeaders || [];
      const pageSeries = Array.isArray(dailyData.rows)
        ? dailyData.rows.map((row) => ({
          date: normalizeGa4Date(parseGa4DimensionValue(row, dailyDimensionHeaders, 'date')),
          activeUsers: Math.round(parseGa4MetricValue(row, dailyMetricHeaders, 'activeUsers')),
          pageViews: Math.round(parseGa4MetricValue(row, dailyMetricHeaders, 'screenPageViews')),
          eventCount: Math.round(parseGa4MetricValue(row, dailyMetricHeaders, 'eventCount'))
        })).filter((entry) => !!entry.date)
        : [];

      const topPagesData = topPagesResponse?.data || {};
      const topPagesDimensionHeaders = topPagesData.dimensionHeaders || [];
      const topPagesMetricHeaders = topPagesData.metricHeaders || [];
      const topPages = Array.isArray(topPagesData.rows)
        ? topPagesData.rows.map((row) => {
          const path = parseGa4DimensionValue(row, topPagesDimensionHeaders, 'pagePath');
          const title = parseGa4DimensionValue(row, topPagesDimensionHeaders, 'pageTitle');
          const pageViews = Math.round(parseGa4MetricValue(row, topPagesMetricHeaders, 'screenPageViews'));
          const activeUsers = Math.round(parseGa4MetricValue(row, topPagesMetricHeaders, 'activeUsers'));
          const engagementDurationSeconds = parseGa4MetricValue(row, topPagesMetricHeaders, 'userEngagementDuration');
          return {
            path: path || '/',
            title: title || path || 'Untitled',
            pageViews,
            activeUsers,
            avgEngagementSeconds: activeUsers > 0
              ? Math.round((engagementDurationSeconds / activeUsers) * 10) / 10
              : 0
          };
        }).filter((entry) => entry.pageViews > 0)
        : [];

      const genericEventNames = new Set([
        'page_view',
        'user_engagement',
        'session_start',
        'first_visit',
        'scroll',
        'click',
        'form_start',
        'form_submit',
        'view_search_results',
        'file_download'
      ]);
      const topEventsData = topEventsResponse?.data || {};
      const topEventsDimensionHeaders = topEventsData.dimensionHeaders || [];
      const topEventsMetricHeaders = topEventsData.metricHeaders || [];
      const topEvents = Array.isArray(topEventsData.rows)
        ? topEventsData.rows.map((row) => ({
          eventName: parseGa4DimensionValue(row, topEventsDimensionHeaders, 'eventName') || 'unknown_event',
          eventCount: Math.round(parseGa4MetricValue(row, topEventsMetricHeaders, 'eventCount')),
          activeUsers: Math.round(parseGa4MetricValue(row, topEventsMetricHeaders, 'activeUsers'))
        }))
          .filter((entry) => entry.eventCount > 0 && !genericEventNames.has(entry.eventName))
          .slice(0, limit)
        : [];

      const seriesDates = pageSeries.map((entry) => entry.date);
      const mainPageSeriesAll = Object.fromEntries(
        ADMIN_BEHAVIOR_MAIN_PAGES.map((page) => [page.key, buildBehaviorPageSeriesTemplate(seriesDates)])
      );
      const mainPagesReports = Array.isArray(mainPagesResponse?.data?.reports)
        ? mainPagesResponse.data.reports
        : [];
      for (const [pageIndex, page] of ADMIN_BEHAVIOR_MAIN_PAGES.entries()) {
        const report = mainPagesReports[pageIndex] || {};
        const dimensionHeaders = report.dimensionHeaders || [];
        const metricHeaders = report.metricHeaders || [];
        const seriesDateIndex = new Map(seriesDates.map((date, index) => [date, index]));
        if (!Array.isArray(report.rows)) continue;
        for (const row of report.rows) {
          const date = normalizeGa4Date(parseGa4DimensionValue(row, dimensionHeaders, 'date'));
          if (!date) continue;
          let targetIndex = seriesDateIndex.get(date);
          if (typeof targetIndex !== 'number') continue;
          const target = mainPageSeriesAll[page.key][targetIndex];
          target.activeUsers = Math.round(parseGa4MetricValue(row, metricHeaders, 'activeUsers'));
          target.pageViews = Math.round(parseGa4MetricValue(row, metricHeaders, 'screenPageViews'));
        }
      }

      const mainPageOptions = ADMIN_BEHAVIOR_MAIN_PAGES
        .map((page) => {
          const series = mainPageSeriesAll[page.key] || [];
          const totalPageViews = series.reduce((sum, entry) => sum + Number(entry.pageViews || 0), 0);
          return totalPageViews > 0
            ? { key: page.key, label: page.label, series }
            : null;
        })
        .filter(Boolean);
      const pageSeriesByKey = Object.fromEntries(mainPageOptions.map((page) => [page.key, page.series]));

      const activeUsers = Math.round(parseGa4MetricValue(summaryRow, summaryHeaders, 'activeUsers'));
      const pageViews = Math.round(parseGa4MetricValue(summaryRow, summaryHeaders, 'screenPageViews'));
      const eventCount = Math.round(parseGa4MetricValue(summaryRow, summaryHeaders, 'eventCount'));
      const engagementDurationSeconds = parseGa4MetricValue(summaryRow, summaryHeaders, 'userEngagementDuration');
      const warnings = [];
      if (!pageSeries.length) warnings.push('No GA4 daily activity data returned for the selected window');
      if (!topPages.length) warnings.push('No page-view data returned by GA4 yet');
      if (!topEvents.length) warnings.push('No custom engagement events found yet. Add data-analytics-event markers to key UI actions to enrich this view.');

      return {
        configured: true,
        source: 'ga4-data-api',
        propertyId,
        measurementId,
        propertySource: configuredPropertyId
          ? 'env'
          : (firebaseProjectAnalytics.propertyId ? 'firebase-project-analytics' : 'measurement-id-discovery'),
        updatedAt: new Date().toISOString(),
        window: { days, startDate: `${days}daysAgo`, endDate: 'today' },
        summary: {
          activeUsers,
          pageViews,
          eventCount,
          avgEngagementSecondsPerUser: activeUsers > 0
            ? Math.round((engagementDurationSeconds / activeUsers) * 10) / 10
            : 0,
          avgEventsPerUser: activeUsers > 0
            ? Math.round((eventCount / activeUsers) * 10) / 10
            : 0,
          trackedPageCount: Number(topPagesData.rowCount || topPages.length || 0),
          customEventTypes: topEvents.length
        },
        pageSeries,
        mainPageOptions: mainPageOptions.map((page) => ({ key: page.key, label: page.label })),
        pageSeriesByKey,
        topPages,
        topEvents,
        warnings: warnings.concat(resolutionWarnings)
      };
    };

    const result = await getCachedAdminBehaviorMetrics(cacheKey, loadMetrics, { forceRefresh });
    res.json({ errno: 0, result });
  } catch (error) {
    const message = buildGa4ApiErrorMessage(error);
    console.error('[Admin] Error fetching behavior metrics:', error);
    res.status(502).json({ errno: 502, error: message });
  }
});

/**
 * GET /api/admin/api-health - Lightweight API/provider usage and request health rollup
 * Query: ?days=30&refresh=1
 */
app.get('/api/admin/api-health', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const daysRaw = Number(req.query?.days);
    const days = Number.isFinite(daysRaw) ? Math.max(7, Math.min(60, Math.floor(daysRaw))) : 30;
    const forceRefresh = String(req.query?.refresh || req.query?.force || '').trim() === '1';
    const cacheKey = String(days);

    const loadHealth = async () => {
      const warnings = [];
      const now = new Date();
      const dateKeys = Array.from({ length: days }, (_value, index) => {
        const date = new Date(now.getTime() - ((days - 1 - index) * 24 * 60 * 60 * 1000));
        return getAdminMetricsDateKey(date);
      });

      const daily = await Promise.all(dateKeys.map(async (dateKey) => {
        try {
          const snapshot = await db.collection('metrics').doc(dateKey).get();
          const envelope = buildApiHealthMetricsEnvelope(snapshot.exists ? (snapshot.data() || {}) : {});
          return {
            date: dateKey,
            totalCalls: envelope.totalCalls,
            providers: envelope.providers,
            categories: envelope.categories,
            evBreakdown: envelope.evBreakdown,
            requestExecutions: null,
            errorExecutions: null,
            errorRatePct: null
          };
        } catch (error) {
          warnings.push(`Metrics doc ${dateKey} unavailable: ${error?.message || error}`);
          return {
            date: dateKey,
            totalCalls: 0,
            providers: Object.fromEntries(ADMIN_API_HEALTH_PROVIDER_KEYS.map((providerKey) => [providerKey, 0])),
            categories: { inverter: 0, amber: 0, weather: 0, ev: 0 },
            evBreakdown: {},
            requestExecutions: null,
            errorExecutions: null,
            errorRatePct: null
          };
        }
      }));

      const providerTotals = Object.fromEntries(ADMIN_API_HEALTH_PROVIDER_KEYS.map((providerKey) => [providerKey, 0]));
      daily.forEach((row) => {
        ADMIN_API_HEALTH_PROVIDER_KEYS.forEach((providerKey) => {
          providerTotals[providerKey] += Number(row.providers?.[providerKey] || 0);
        });
      });

      const totalCalls = Object.values(providerTotals).reduce((sum, value) => sum + value, 0);
      const activeProviders = ADMIN_API_HEALTH_PROVIDER_KEYS.filter((providerKey) => providerTotals[providerKey] > 0);
      const providerRows = ADMIN_API_HEALTH_PROVIDER_KEYS
        .map((providerKey) => {
          const last7Rows = getWindowRows(daily, Math.min(7, daily.length), 0);
          const previous7Rows = getWindowRows(daily, Math.min(7, Math.max(daily.length - Math.min(7, daily.length), 0)), Math.min(7, daily.length));
          const last7Avg = averageRows(last7Rows, (row) => row.providers?.[providerKey] || 0);
          const previous7Avg = averageRows(previous7Rows, (row) => row.providers?.[providerKey] || 0);
          const trendPct = pctChange(last7Avg, previous7Avg);
          const providerTotal = providerTotals[providerKey] || 0;
          return {
            key: providerKey,
            label: ADMIN_API_HEALTH_PROVIDER_LABELS[providerKey] || providerKey,
            totalCalls: providerTotal,
            sharePct: totalCalls > 0 ? (providerTotal / totalCalls) * 100 : 0,
            lastDayCalls: Number(daily[daily.length - 1]?.providers?.[providerKey] || 0),
            avgDailyCalls7d: last7Avg,
            avgDailyCallsPrev7d: previous7Avg,
            trendPct
          };
        })
        .filter((row) => row.totalCalls > 0)
        .sort((a, b) => b.totalCalls - a.totalCalls || a.label.localeCompare(b.label));

      const dominantProvider = providerRows[0]
        ? {
          key: providerRows[0].key,
          label: providerRows[0].label,
          totalCalls: providerRows[0].totalCalls,
          sharePct: providerRows[0].sharePct
        }
        : null;

      const monitoringSummary = {
        available: false,
        source: null,
        requestExecutionsTotal: null,
        errorExecutionsTotal: null,
        errorRatePct: null
      };

      if (googleApis) {
        const projectId = getRuntimeProjectId();
        if (!projectId) {
          warnings.push('Unable to resolve GCP project id for API execution health overlay.');
        } else {
          const auth = new googleApis.auth.GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/monitoring.read']
          });
          const monitoring = googleApis.monitoring({ version: 'v3', auth });
          const start = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));

          const loadMonitoringSeriesSafe = async ({ label, filters }) => {
            const filterList = Array.isArray(filters) ? filters : [filters];
            for (const filter of filterList) {
              try {
                const series = await listMonitoringTimeSeries({
                  monitoring,
                  projectId,
                  filter,
                  startTime: start,
                  endTime: now,
                  aligner: 'ALIGN_DELTA',
                  alignmentPeriod: '86400s'
                });
                return { series, filter };
              } catch (error) {
                const msg = String(error?.message || error || 'unknown error');
                const unavailable = msg.includes('Cannot find metric(s) that match type') || msg.includes('not found');
                if (!unavailable) {
                  warnings.push(`${label} metric query failed: ${normalizeMetricErrorMessage(error)}`);
                  return { series: [], filter: null };
                }
              }
            }
            return { series: [], filter: null };
          };

          const totalMetricResult = await loadMonitoringSeriesSafe({
            label: 'API execution total',
            filters: [
              'metric.type="cloudfunctions.googleapis.com/function/execution_count" AND resource.labels.function_name="api"',
              'metric.type="run.googleapis.com/request_count" AND resource.labels.service_name="api"'
            ]
          });
          const errorMetricResult = await loadMonitoringSeriesSafe({
            label: 'API execution errors',
            filters: [
              'metric.type="cloudfunctions.googleapis.com/function/execution_count" AND resource.labels.function_name="api" AND metric.labels.status!="ok"',
              'metric.type="cloudfunctions.googleapis.com/function/execution_count" AND resource.labels.function_name="api" AND metric.labels.status="error"',
              'metric.type="run.googleapis.com/request_count" AND resource.labels.service_name="api" AND metric.labels.response_code_class="5xx"'
            ]
          });

          const requestExecutionsTotal = Math.round(sumSeriesValues(totalMetricResult.series || []));
          const errorExecutionsTotal = errorMetricResult.filter
            ? Math.round(sumSeriesValues(errorMetricResult.series || []))
            : null;

          if (requestExecutionsTotal > 0) {
            monitoringSummary.available = true;
            monitoringSummary.source = String(totalMetricResult.filter || '').includes('run.googleapis.com')
              ? 'cloud-run-monitoring'
              : 'cloud-functions-monitoring';
            monitoringSummary.requestExecutionsTotal = requestExecutionsTotal;
            monitoringSummary.errorExecutionsTotal = errorExecutionsTotal;
            monitoringSummary.errorRatePct = Number.isFinite(errorExecutionsTotal)
              ? ((errorExecutionsTotal / requestExecutionsTotal) * 100)
              : null;

            const requestByDate = new Map();
            const errorByDate = new Map();
            (totalMetricResult.series || []).forEach((point) => {
              const key = getAdminMetricsDateKey(new Date(point.timestamp));
              requestByDate.set(key, (requestByDate.get(key) || 0) + Number(point.value || 0));
            });
            (errorMetricResult.series || []).forEach((point) => {
              const key = getAdminMetricsDateKey(new Date(point.timestamp));
              errorByDate.set(key, (errorByDate.get(key) || 0) + Number(point.value || 0));
            });

            daily.forEach((row) => {
              const requestExecutions = requestByDate.has(row.date)
                ? Math.round(requestByDate.get(row.date) || 0)
                : 0;
              const errorExecutions = errorMetricResult.filter
                ? Math.round(errorByDate.get(row.date) || 0)
                : null;
              row.requestExecutions = requestExecutions;
              row.errorExecutions = errorExecutions;
              row.errorRatePct = Number.isFinite(errorExecutions) && requestExecutions > 0
                ? ((errorExecutions / requestExecutions) * 100)
                : null;
            });
          } else {
            warnings.push('API execution metrics unavailable from Cloud Monitoring; showing provider rollups only.');
          }
        }
      } else {
        warnings.push('googleapis dependency unavailable; Cloud Monitoring API health overlay disabled.');
      }

      const lastDay = daily[daily.length - 1] || { totalCalls: 0 };
      const previousDay = daily[daily.length - 2] || { totalCalls: 0 };
      const last7Rows = getWindowRows(daily, Math.min(7, daily.length), 0);
      const previous7Rows = getWindowRows(daily, Math.min(7, Math.max(daily.length - Math.min(7, daily.length), 0)), Math.min(7, daily.length));
      const last7Avg = averageRows(last7Rows, (row) => row.totalCalls || 0);
      const previous7Avg = averageRows(previous7Rows, (row) => row.totalCalls || 0);
      const volatilityPct = totalCalls > 0
        ? (computeStdDev(daily.map((row) => Number(row.totalCalls || 0))) / Math.max(averageRows(daily, (row) => row.totalCalls || 0), 1)) * 100
        : 0;
      const busiestDay = daily.reduce((best, row) => {
        if (!best || Number(row.totalCalls || 0) > Number(best.totalCalls || 0)) return row;
        return best;
      }, null);

      const weekdayTotals = new Map();
      let weekendCalls = 0;
      daily.forEach((row) => {
        const date = new Date(`${row.date}T00:00:00.000Z`);
        const weekday = date.toLocaleDateString('en-AU', { weekday: 'short', timeZone: 'UTC' });
        weekdayTotals.set(weekday, (weekdayTotals.get(weekday) || 0) + Number(row.totalCalls || 0));
        if (weekday === 'Sat' || weekday === 'Sun') {
          weekendCalls += Number(row.totalCalls || 0);
        }
      });
      const busiestWeekdayEntry = Array.from(weekdayTotals.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null;

      const alerts = [];
      const pushAlert = (level, code, title, detail) => {
        alerts.push({ level, code, title, detail });
      };

      if (monitoringSummary.available && Number.isFinite(monitoringSummary.errorRatePct)) {
        if (monitoringSummary.errorRatePct >= 5) {
          pushAlert(
            'bad',
            'error_rate_breach',
            'Execution failures elevated',
            `Cloud Monitoring shows ${monitoringSummary.errorRatePct.toFixed(2)}% failed executions over the last ${days} days.`
          );
        } else if (monitoringSummary.errorRatePct >= 2) {
          pushAlert(
            'warn',
            'error_rate_watch',
            'Execution failures need attention',
            `Cloud Monitoring shows ${monitoringSummary.errorRatePct.toFixed(2)}% failed executions over the last ${days} days.`
          );
        }
      }

      if (lastDay.totalCalls >= Math.max(200, last7Avg * 1.75)) {
        pushAlert(
          'warn',
          'traffic_spike',
          'Recent provider traffic spike',
          `${formatAlertDetailNumber(lastDay.totalCalls)} provider calls landed on ${lastDay.date}, versus a 7-day average of ${formatAlertDetailNumber(Math.round(last7Avg))}.`
        );
      }

      if (previous7Avg >= 50 && last7Avg >= previous7Avg * 1.4) {
        pushAlert(
          'info',
          'sustained_growth',
          'Sustained API usage growth',
          `The latest 7-day average is ${formatAlertDetailNumber(Math.round(last7Avg))} calls/day, up ${(pctChange(last7Avg, previous7Avg) || 0).toFixed(1)}% versus the prior 7-day window.`
        );
      }

      if (dominantProvider && dominantProvider.sharePct >= 70 && dominantProvider.totalCalls >= 200) {
        pushAlert(
          'warn',
          'provider_concentration',
          'Provider concentration risk',
          `${dominantProvider.label} accounts for ${dominantProvider.sharePct.toFixed(1)}% of tracked provider calls in this window.`
        );
      }

      providerRows
        .filter((row) => row.avgDailyCallsPrev7d >= 20 && row.avgDailyCalls7d >= row.avgDailyCallsPrev7d * 1.8)
        .slice(0, 2)
        .forEach((row) => {
          pushAlert(
            'warn',
            `potential_overage_${row.key}`,
            `${row.label} usage acceleration`,
            `Latest 7-day average is ${formatAlertDetailNumber(Math.round(row.avgDailyCalls7d))}/day, up ${(row.trendPct || 0).toFixed(1)}% versus the prior week. Treat this as a potential overage or rate-limit risk if that provider has tight quotas.`
          );
        });

      const recentTwoDayTotal = sumRows(getWindowRows(daily, Math.min(2, daily.length), 0), (row) => row.totalCalls || 0);
      const priorWeekTotal = sumRows(getWindowRows(daily, Math.min(7, Math.max(daily.length - Math.min(2, daily.length), 0)), Math.min(2, daily.length)), (row) => row.totalCalls || 0);
      if (recentTwoDayTotal === 0 && priorWeekTotal >= 100) {
        pushAlert(
          'bad',
          'traffic_drop',
          'Tracked provider traffic dropped to zero',
          'The last 2 days show no provider calls despite meaningful activity in the preceding week.'
        );
      }

      const healthStatus = (() => {
        if (alerts.some((alert) => alert.level === 'bad')) return 'bad';
        if (alerts.some((alert) => alert.level === 'warn')) return 'warn';
        return 'good';
      })();

      return {
        source: monitoringSummary.available
          ? `metrics-rollups+${monitoringSummary.source}`
          : 'metrics-rollups',
        updatedAt: now.toISOString(),
        window: { days },
        summary: {
          totalCalls,
          avgDailyCalls: averageRows(daily, (row) => row.totalCalls || 0),
          lastDayCalls: Number(lastDay.totalCalls || 0),
          dayOverDayPct: pctChange(lastDay.totalCalls || 0, previousDay.totalCalls || 0),
          callsAvg7d: last7Avg,
          callsAvgPrev7d: previous7Avg,
          callsPerExecution: monitoringSummary.requestExecutionsTotal > 0
            ? (totalCalls / monitoringSummary.requestExecutionsTotal)
            : null,
          activeProviders: activeProviders.length,
          dominantProvider,
          volatilityPct,
          busiestDay: busiestDay
            ? { date: busiestDay.date, totalCalls: Number(busiestDay.totalCalls || 0) }
            : null,
          busiestWeekday: busiestWeekdayEntry
            ? { label: busiestWeekdayEntry[0], totalCalls: busiestWeekdayEntry[1] }
            : null,
          weekendSharePct: totalCalls > 0 ? ((weekendCalls / totalCalls) * 100) : 0,
          healthStatus
        },
        monitoring: monitoringSummary,
        providers: providerRows,
        daily,
        alerts,
        warnings,
        observability: {
          alphaess: alphaessObservability
        }
      };
    };

    const result = await getCachedAdminApiHealth(cacheKey, loadHealth, { forceRefresh });
    res.json({ errno: 0, result });
  } catch (error) {
    console.error('[Admin] Error loading API health:', error);
    res.status(500).json({ errno: 500, error: error?.message || 'Failed to load API health' });
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
 *   - ?runLimit=20 (default 20, min 1, max 2000; only used when includeRuns=true)
 */
app.get('/api/admin/scheduler-metrics', authenticateUser, requireAdmin, async (req, res) => {
  try {
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

    const buildRunWindowSummary = (runs = [], windowStartMs = NaN) => {
      const safeRuns = Array.isArray(runs)
        ? runs.filter((run) => !Number.isFinite(windowStartMs) || toFiniteNumber(run.startedAtMs, 0) >= windowStartMs)
        : [];

      const summary = {
        runs: 0,
        totalEnabledUsers: 0,
        cycleCandidates: 0,
        cyclesRun: 0,
        deadLetters: 0,
        errors: 0,
        retries: 0,
        maxQueueLagMs: 0,
        p95QueueLagMs: 0,
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
        telemetryPauseReasons: {},
        latestRunStartedAtMs: 0,
        latestRunId: null
      };

      let avgQueueLagWeightedTotalMs = 0;
      let avgQueueLagSamples = 0;
      let avgCycleDurationWeightedTotalMs = 0;
      let avgCycleDurationSamples = 0;

      safeRuns.forEach((run) => {
        summary.runs += 1;
        summary.totalEnabledUsers += toFiniteNumber(run.totalEnabledUsers, 0);
        summary.cycleCandidates += toFiniteNumber(run.cycleCandidates, 0);
        summary.cyclesRun += toFiniteNumber(run.cyclesRun, 0);
        summary.deadLetters += toFiniteNumber(run.deadLetters, 0);
        summary.errors += toFiniteNumber(run.errors, 0);
        summary.retries += toFiniteNumber(run.retries, 0);
        summary.maxQueueLagMs = Math.max(summary.maxQueueLagMs, toFiniteNumber(run.queueLagMs?.maxMs, 0));
        summary.p95QueueLagMs = Math.max(summary.p95QueueLagMs, toFiniteNumber(run.queueLagMs?.p95Ms, 0));
        summary.maxCycleDurationMs = Math.max(summary.maxCycleDurationMs, toFiniteNumber(run.cycleDurationMs?.maxMs, 0));
        summary.maxTelemetryAgeMs = Math.max(summary.maxTelemetryAgeMs, toFiniteNumber(run.telemetryAgeMs?.maxMs, 0));
        summary.p95CycleDurationMs = Math.max(summary.p95CycleDurationMs, toFiniteNumber(run.cycleDurationMs?.p95Ms, 0));
        summary.p99CycleDurationMs = Math.max(summary.p99CycleDurationMs, toFiniteNumber(run.cycleDurationMs?.p99Ms, 0));

        const queueLagAvgMs = toFiniteNumber(run.queueLagMs?.avgMs, 0);
        const queueLagCount = toFiniteNumber(run.queueLagMs?.count, 0);
        avgQueueLagWeightedTotalMs += queueLagAvgMs * queueLagCount;
        avgQueueLagSamples += queueLagCount;

        const cycleDurationAvgMs = toFiniteNumber(run.cycleDurationMs?.avgMs, 0);
        const cycleDurationCount = toFiniteNumber(run.cycleDurationMs?.count, 0);
        avgCycleDurationWeightedTotalMs += cycleDurationAvgMs * cycleDurationCount;
        avgCycleDurationSamples += cycleDurationCount;

        for (const phaseKey of phaseTimingKeys) {
          summary.phaseTimingsMaxMs[phaseKey] = Math.max(
            toFiniteNumber(summary.phaseTimingsMaxMs[phaseKey], 0),
            toFiniteNumber(run.phaseTimingsMs?.[phaseKey]?.maxMs, 0)
          );
        }

        summary.skipped.disabledOrBlackout += toFiniteNumber(run.skipped?.disabledOrBlackout, 0);
        summary.skipped.idempotent += toFiniteNumber(run.skipped?.idempotent, 0);
        summary.skipped.locked += toFiniteNumber(run.skipped?.locked, 0);
        summary.skipped.tooSoon += toFiniteNumber(run.skipped?.tooSoon, 0);
        summary.failureByType = mergeFailureByType(summary.failureByType, sanitizeFailureByType(run.failureByType));
        summary.telemetryPauseReasons = mergeFailureByType(
          summary.telemetryPauseReasons,
          sanitizeFailureByType(run.telemetryPauseReasons)
        );

        const runStartedAtMs = toFiniteNumber(run.startedAtMs, 0);
        if (runStartedAtMs > summary.latestRunStartedAtMs) {
          summary.latestRunStartedAtMs = runStartedAtMs;
          summary.latestRunId = run.runId || null;
        }
      });

      summary.avgQueueLagMs = avgQueueLagSamples > 0
        ? Math.round(avgQueueLagWeightedTotalMs / avgQueueLagSamples)
        : 0;
      summary.avgCycleDurationMs = avgCycleDurationSamples > 0
        ? Math.round(avgCycleDurationWeightedTotalMs / avgCycleDurationSamples)
        : 0;
      summary.errorRatePct = summary.cyclesRun > 0
        ? Number(((summary.errors / summary.cyclesRun) * 100).toFixed(2))
        : 0;
      summary.deadLetterRatePct = summary.cyclesRun > 0
        ? Number(((summary.deadLetters / summary.cyclesRun) * 100).toFixed(2))
        : 0;

      return summary;
    };

    const buildCurrentSnapshot = (run, currentAlertValue) => {
      if (!run || typeof run !== 'object') {
        return null;
      }

      const cyclesRun = toFiniteNumber(run.cyclesRun, 0);
      const errors = toFiniteNumber(run.errors, 0);
      const deadLetters = toFiniteNumber(run.deadLetters, 0);
      const errorRatePct = cyclesRun > 0 ? Number(((errors / cyclesRun) * 100).toFixed(2)) : 0;
      const deadLetterRatePct = cyclesRun > 0 ? Number(((deadLetters / cyclesRun) * 100).toFixed(2)) : 0;
      const alertMatchesRun = currentAlertValue && currentAlertValue.runId === run.runId;

      return {
        runId: run.runId || null,
        dayKey: run.dayKey || null,
        schedulerId: run.schedulerId || null,
        workerId: run.workerId || null,
        startedAtMs: toFiniteNumber(run.startedAtMs, 0),
        completedAtMs: toFiniteNumber(run.completedAtMs, 0),
        durationMs: toFiniteNumber(run.durationMs, 0),
        cycleCandidates: toFiniteNumber(run.cycleCandidates, 0),
        cyclesRun,
        errors,
        deadLetters,
        retries: toFiniteNumber(run.retries, 0),
        errorRatePct,
        deadLetterRatePct,
        avgQueueLagMs: toFiniteNumber(run.queueLagMs?.avgMs, 0),
        maxQueueLagMs: toFiniteNumber(run.queueLagMs?.maxMs, 0),
        avgCycleDurationMs: toFiniteNumber(run.cycleDurationMs?.avgMs, 0),
        maxCycleDurationMs: toFiniteNumber(run.cycleDurationMs?.maxMs, 0),
        maxTelemetryAgeMs: toFiniteNumber(run.telemetryAgeMs?.maxMs, 0),
        p95CycleDurationMs: toFiniteNumber(run.cycleDurationMs?.p95Ms, 0),
        p99CycleDurationMs: toFiniteNumber(run.cycleDurationMs?.p99Ms, 0),
        phaseTimingsMaxMs: sanitizePhaseTimingMaxMs(extractPhaseTimingRunMaxMs(run.phaseTimingsMs)),
        skipped: {
          disabledOrBlackout: toFiniteNumber(run.skipped?.disabledOrBlackout, 0),
          idempotent: toFiniteNumber(run.skipped?.idempotent, 0),
          locked: toFiniteNumber(run.skipped?.locked, 0),
          tooSoon: toFiniteNumber(run.skipped?.tooSoon, 0)
        },
        failureByType: sanitizeFailureByType(run.failureByType),
        telemetryPauseReasons: sanitizeFailureByType(run.telemetryPauseReasons),
        likelyCauses: buildLikelyCauseTags(run),
        slo: {
          status: alertMatchesRun
            ? sanitizeSloSnapshot({ status: currentAlertValue.status }).status
            : sanitizeSloSnapshot(run.slo).status,
          breachedMetrics: alertMatchesRun
            ? (Array.isArray(currentAlertValue.breachedMetrics) ? currentAlertValue.breachedMetrics : [])
            : sanitizeSloSnapshot(run.slo).breachedMetrics,
          watchMetrics: alertMatchesRun
            ? (Array.isArray(currentAlertValue.watchMetrics) ? currentAlertValue.watchMetrics : [])
            : sanitizeSloSnapshot(run.slo).watchMetrics
        }
      };
    };

    const days = parseBoundedInt(req.query?.days, 14, 1, 90);
    const includeRunsRaw = String(req.query?.includeRuns || '').toLowerCase();
    const includeRuns = ['1', 'true', 'yes', 'y'].includes(includeRunsRaw);
    const runLimit = parseBoundedInt(req.query?.runLimit, 20, 1, 2000);

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
        p95QueueLagMs: toFiniteNumber(data.p95QueueLagMs, toFiniteNumber(data.maxQueueLagMs, 0)),
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
      p95QueueLagMs: 0,
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
      summary.p95QueueLagMs = Math.max(summary.p95QueueLagMs, day.p95QueueLagMs);
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
    const last24hWindowStartMs = Date.now() - (24 * 60 * 60 * 1000);
    const last24hRuns = recentRuns.filter((run) => toFiniteNumber(run.startedAtMs, 0) >= last24hWindowStartMs);
    const last24hSummary = buildRunWindowSummary(recentRuns, last24hWindowStartMs);
    const last24hTailLatency = buildTailLatencyFromRuns(last24hRuns, tailThresholdMs, tailWindowMinutes, tailMinRuns);
    const currentSnapshot = buildCurrentSnapshot(latestRun, currentAlert);

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
        last24hSummary,
        currentSnapshot,
        soak,
        daily: dailyDesc.slice().reverse(),
        recentRuns,
        currentAlert,
        diagnostics: {
          tailLatency,
          last24hTailLatency,
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
app.get('/api/admin/dead-letters', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const days = parseBoundedInt(req.query?.days, 7, 1, 30);
    const limit = parseBoundedInt(req.query?.limit, 50, 1, 200);
    const retryReadyAfterMinutes = parseBoundedInt(req.query?.retryReadyAfterMinutes, 15, 1, 180);
    const nowMs = Date.now();
    const windowStartMs = nowMs - (days * 24 * 60 * 60 * 1000);

    if (typeof db.collectionGroup !== 'function') {
      return res.json({
        errno: 0,
        result: {
          days,
          total: 0,
          retryReadyCount: 0,
          oldestAgeMs: 0,
          topErrors: [],
          items: []
        }
      });
    }

    const snapshot = await db.collectionGroup('automation_dead_letters')
      .where('createdAt', '>=', windowStartMs)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    const items = [];
    const errorCounts = new Map();
    let retryReadyCount = 0;
    let oldestAgeMs = 0;

    snapshot.forEach((doc) => {
      const data = doc.data() || {};
      const pathSegments = String(doc.ref?.path || '').split('/');
      const userId = pathSegments.length >= 2 ? pathSegments[1] : null;
      const createdAt = toFiniteNumber(data.createdAt, 0);
      const ageMs = createdAt > 0 ? Math.max(0, nowMs - createdAt) : 0;
      const retryReady = ageMs >= retryReadyAfterMinutes * 60 * 1000;
      const errorKey = normalizeDeadLetterErrorKey(data.error);
      errorCounts.set(errorKey, (errorCounts.get(errorKey) || 0) + 1);
      oldestAgeMs = Math.max(oldestAgeMs, ageMs);
      if (retryReady) {
        retryReadyCount += 1;
      }

      items.push({
        id: doc.id,
        userId,
        cycleKey: data.cycleKey ? String(data.cycleKey) : null,
        attempts: Math.max(1, toFiniteNumber(data.attempts, 1)),
        createdAt,
        expiresAt: toFiniteNumber(data.expiresAt, 0),
        ageMs,
        retryReady,
        error: String(data.error || 'Unknown scheduler error').slice(0, 300)
      });
    });

    const topErrors = Array.from(errorCounts.entries())
      .map(([error, count]) => ({ error, count }))
      .sort((a, b) => b.count - a.count || a.error.localeCompare(b.error))
      .slice(0, 10);

    return res.json({
      errno: 0,
      result: {
        days,
        total: items.length,
        retryReadyCount,
        oldestAgeMs,
        topErrors,
        items
      }
    });
  } catch (error) {
    console.error('[Admin] Error fetching dead letters:', error);
    return res.status(500).json({ errno: 500, error: error.message || String(error) });
  }
});

app.post('/api/admin/dead-letters/:userId/:deadLetterId/retry', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const userId = String(req.params?.userId || '').trim();
    const deadLetterId = String(req.params?.deadLetterId || '').trim();
    if (!userId || !deadLetterId) {
      return res.status(400).json({ errno: 400, error: 'userId and deadLetterId are required' });
    }

    const deadLetterRef = db.collection('users').doc(userId).collection('automation_dead_letters').doc(deadLetterId);
    const deadLetterSnap = await deadLetterRef.get();
    if (!deadLetterSnap.exists) {
      return res.status(404).json({ errno: 404, error: 'Dead-letter item not found' });
    }

    const deadLetter = deadLetterSnap.data() || {};
    const cycleKey = String(deadLetter.cycleKey || '').trim();
    if (!cycleKey) {
      return res.status(400).json({ errno: 400, error: 'Dead-letter item is missing cycleKey' });
    }

    const retryResult = await invokeAutomationCycleForAdminRetry({ cycleKey, userId });
    const payload = retryResult && retryResult.payload && typeof retryResult.payload === 'object'
      ? retryResult.payload
      : null;
    const retrySucceeded = retryResult.statusCode === 200 && payload && Number(payload.errno) === 0;
    const incrementField = admin && admin.firestore && admin.firestore.FieldValue
      && typeof admin.firestore.FieldValue.increment === 'function'
      ? admin.firestore.FieldValue.increment(1)
      : 1;

    if (retrySucceeded) {
      await deadLetterRef.delete();
    } else {
      await deadLetterRef.set({
        lastManualRetryAt: Date.now(),
        lastManualRetryBy: req.user.uid,
        lastManualRetryError: String(payload?.error || payload?.msg || `HTTP ${retryResult.statusCode}`),
        manualRetryAttempts: incrementField
      }, { merge: true });
    }

    await db.collection('admin_audit').add({
      action: 'retry_dead_letter',
      adminUid: req.user.uid,
      adminEmail: req.user.email,
      targetUid: userId,
      deadLetterId,
      cycleKey,
      success: retrySucceeded,
      statusCode: retryResult.statusCode,
      timestamp: serverTimestamp()
    });

    return res.status(retrySucceeded ? 200 : 502).json({
      errno: retrySucceeded ? 0 : 502,
      result: {
        deadLetterId,
        userId,
        cycleKey,
        retried: retrySucceeded,
        cycleResponse: payload || null
      },
      error: retrySucceeded ? undefined : String(payload?.error || payload?.msg || 'Manual retry failed')
    });
  } catch (error) {
    console.error('[Admin] Error retrying dead letter:', error);
    return res.status(500).json({ errno: 500, error: error.message || String(error) });
  }
});

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
