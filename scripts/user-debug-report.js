#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_PROJECT_ID = 'inverter-automation-firebase';
const DEFAULT_MAX_DOCS_PER_COLLECTION = 1000;
const OAUTH_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';

function printUsage() {
  console.log(
    [
      'Usage:',
      '  node scripts/user-debug-report.js --email <user@email> [options]',
      '',
      'Options:',
      `  --project <id>            Firebase project id (default: ${DEFAULT_PROJECT_ID})`,
      `  --max-docs <n>            Max docs pulled per subcollection (default: ${DEFAULT_MAX_DOCS_PER_COLLECTION})`,
      '  --out <path>              Output JSON path (default: tmp-user-debug-<email>-<timestamp>.json)',
      '  --include-secrets         Do not redact sensitive fields in output',
      '  --help                    Show this help',
      '',
      'Prerequisites:',
      '  - firebase CLI logged in (firebase login)',
      '  - Access to the target Firebase project'
    ].join('\n')
  );
}

function parseArgs(argv) {
  const out = {
    projectId: DEFAULT_PROJECT_ID,
    maxDocsPerCollection: DEFAULT_MAX_DOCS_PER_COLLECTION,
    includeSecrets: false,
    email: null,
    outputPath: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    if (arg === '--include-secrets') {
      out.includeSecrets = true;
      continue;
    }
    if (arg === '--email') {
      out.email = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (arg === '--project') {
      out.projectId = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (arg === '--max-docs') {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        out.maxDocsPerCollection = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
    if (arg === '--out') {
      out.outputPath = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
  }

  return out;
}

function defaultOutputPath(email) {
  const safeEmail = String(email || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `tmp-user-debug-${safeEmail}-${ts}.json`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveFirebaseToolsConfigPath() {
  const candidates = [
    path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'),
    path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json')
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function refreshAccessToken(refreshToken, clientId) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId || OAUTH_CLIENT_ID
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`Failed to refresh Firebase CLI token: ${JSON.stringify(data)}`);
  }

  return {
    accessToken: data.access_token,
    expiresAtMs: Date.now() + (Number(data.expires_in || 3600) * 1000)
  };
}

async function getGoogleAccessToken() {
  const configPath = resolveFirebaseToolsConfigPath();
  if (!configPath) {
    throw new Error('firebase-tools.json not found. Run `firebase login` first.');
  }

  const cfg = readJson(configPath);
  const tokens = cfg.tokens || {};
  const now = Date.now();
  const expiresAt = Number(tokens.expires_at || 0);
  const accessToken = String(tokens.access_token || '').trim();
  const refreshToken = String(tokens.refresh_token || '').trim();
  const clientId = String((cfg.user && cfg.user.aud) || OAUTH_CLIENT_ID);

  if (accessToken && expiresAt > now + 60 * 1000) {
    return accessToken;
  }

  if (!refreshToken) {
    throw new Error('Firebase CLI refresh token not found. Run `firebase login` again.');
  }

  const refreshed = await refreshAccessToken(refreshToken, clientId);
  return refreshed.accessToken;
}

function decodeFirestoreValue(v) {
  if (v === null || typeof v !== 'object') return v;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return Boolean(v.booleanValue);
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('timestampValue' in v) return v.timestampValue;
  if ('stringValue' in v) return v.stringValue;
  if ('bytesValue' in v) return v.bytesValue;
  if ('referenceValue' in v) return v.referenceValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeFirestoreValue);
  if ('mapValue' in v) {
    const out = {};
    const fields = (v.mapValue && v.mapValue.fields) || {};
    for (const [k, vv] of Object.entries(fields)) {
      out[k] = decodeFirestoreValue(vv);
    }
    return out;
  }
  return v;
}

function decodeFirestoreDocument(doc) {
  const fields = doc.fields || {};
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = decodeFirestoreValue(v);
  }
  out.__name = doc.name;
  out.__createTime = doc.createTime;
  out.__updateTime = doc.updateTime;
  return out;
}

async function httpJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch (e) {
    body = { raw: text };
  }

  if (!response.ok) {
    const err = new Error(`HTTP ${response.status} ${response.statusText} ${url}`);
    err.response = body;
    throw err;
  }

  return body;
}

function authHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };
}

function firestoreBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

function docUrl(projectId, ...parts) {
  return `${firestoreBase(projectId)}/${parts.map(encodeURIComponent).join('/')}`;
}

async function findAuthUsersByEmail(accessToken, projectId, email) {
  const normalized = String(email || '').toLowerCase();
  let nextPageToken = null;
  const matches = [];
  let scannedUsers = 0;

  do {
    const payload = {
      targetProjectId: projectId,
      maxResults: 1000
    };
    if (nextPageToken) payload.nextPageToken = nextPageToken;

    const page = await httpJson('https://www.googleapis.com/identitytoolkit/v3/relyingparty/downloadAccount', {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload)
    });

    const users = Array.isArray(page.users) ? page.users : [];
    scannedUsers += users.length;

    for (const user of users) {
      const userEmail = String(user.email || '').toLowerCase();
      if (userEmail && userEmail === normalized) matches.push(user);
    }

    nextPageToken = page.nextPageToken || null;
  } while (nextPageToken);

  return { matches, scannedUsers };
}

async function getDocument(accessToken, projectId, ...parts) {
  try {
    const data = await httpJson(docUrl(projectId, ...parts), {
      headers: authHeaders(accessToken)
    });
    return { exists: true, data: decodeFirestoreDocument(data) };
  } catch (e) {
    if (e.response && (e.response.error?.status === 'NOT_FOUND' || e.response.error?.code === 404)) {
      return { exists: false, data: null };
    }
    throw e;
  }
}

async function listCollectionIds(accessToken, projectId, ...documentPathParts) {
  const response = await httpJson(`${docUrl(projectId, ...documentPathParts)}:listCollectionIds`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ pageSize: 200 })
  });
  return Array.isArray(response.collectionIds) ? response.collectionIds : [];
}

async function listCollectionDocuments(accessToken, projectId, pathParts, maxDocs) {
  const documents = [];
  let nextPageToken = null;
  let truncated = false;

  do {
    const base = docUrl(projectId, ...pathParts);
    const url = new URL(base);
    url.searchParams.set('pageSize', String(Math.min(1000, Math.max(1, maxDocs - documents.length))));
    if (nextPageToken) url.searchParams.set('pageToken', nextPageToken);

    const page = await httpJson(url.toString(), { headers: authHeaders(accessToken) });
    const pageDocs = Array.isArray(page.documents) ? page.documents : [];
    for (const doc of pageDocs) {
      if (documents.length >= maxDocs) {
        truncated = true;
        break;
      }
      documents.push(decodeFirestoreDocument(doc));
    }

    if (documents.length >= maxDocs) {
      truncated = !!(page.nextPageToken || (pageDocs.length > 0));
      break;
    }

    nextPageToken = page.nextPageToken || null;
  } while (nextPageToken);

  return { documents, truncated };
}

async function runFirestoreQuery(accessToken, projectId, structuredQuery) {
  const data = await httpJson(`${firestoreBase(projectId)}:runQuery`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ structuredQuery })
  });
  return (Array.isArray(data) ? data : [])
    .filter((row) => row && row.document)
    .map((row) => decodeFirestoreDocument(row.document));
}

function toEpochMs(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && String(Math.trunc(numeric)).length >= 10) return numeric;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === 'object' && Number.isFinite(Number(value.seconds))) {
    return Number(value.seconds) * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1e6);
  }
  return null;
}

function getDocumentIdFromName(docName) {
  const parts = String(docName || '').split('/');
  return parts.length ? parts[parts.length - 1] : null;
}

function redactSensitive(value, includeSecrets, pathKey = '') {
  if (includeSecrets) return value;

  const secretKeyPattern = /(token|secret|api.?key|password|credential|siteid|appid|systemsn|devicesn)/i;

  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((entry, idx) => redactSensitive(entry, includeSecrets, `${pathKey}[${idx}]`));
  }
  if (typeof value !== 'object') {
    if (secretKeyPattern.test(pathKey)) return '[REDACTED]';
    return value;
  }

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const nextPath = pathKey ? `${pathKey}.${k}` : k;
    if (secretKeyPattern.test(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redactSensitive(v, includeSecrets, nextPath);
    }
  }
  return out;
}

function getCollectionDocs(result, collectionId) {
  return (result.collections && result.collections[collectionId] && result.collections[collectionId].documents) || [];
}

function summarizeMetrics(metricsDocs) {
  const totals = {};

  for (const doc of metricsDocs) {
    for (const [k, v] of Object.entries(doc)) {
      if (k.startsWith('__')) continue;
      if (k === 'updatedAt') continue;
      if (!Number.isFinite(Number(v))) continue;
      totals[k] = (totals[k] || 0) + Number(v);
    }
  }

  const docIds = metricsDocs
    .map((doc) => getDocumentIdFromName(doc.__name))
    .filter(Boolean)
    .sort();

  return {
    docs: metricsDocs.length,
    totals,
    latestDocId: docIds.length ? docIds[docIds.length - 1] : null
  };
}

function stageFromSummary(summary) {
  const hasUserDoc = !!summary.profile?.profileInitialized;
  const configured = !!summary.config?.setupComplete;
  const ruleCount = Number(summary.rules?.count || 0);
  const automationEnabled = !!summary.automation?.enabled;
  const auditCount = Number(summary.automationAudit?.count || 0);

  if (!hasUserDoc) return 'auth_only';
  if (!configured) return 'setup_incomplete';
  if (ruleCount === 0) return 'configured_no_rules';
  if (!automationEnabled) return 'rules_created_automation_disabled';
  if (auditCount === 0) return 'automation_enabled_no_cycles';
  return 'automation_active_with_cycles';
}

function buildTimeline(summary, raw) {
  const events = [];
  const push = (type, at, meta) => {
    const ms = toEpochMs(at);
    if (!Number.isFinite(ms)) return;
    events.push({
      type,
      at: new Date(ms).toISOString(),
      epochMs: ms,
      ...(meta || {})
    });
  };

  push('auth_created', raw.authUser?.createdAt, { source: 'firebase_auth' });
  push('auth_last_sign_in', raw.authUser?.lastSignedInAt, { source: 'firebase_auth' });
  push('user_doc_created', raw.userDoc?.__createTime, { source: 'firestore.users' });
  push('user_doc_updated', raw.userDoc?.__updateTime, { source: 'firestore.users' });

  const configDoc = getCollectionDocs(raw, 'config').find((doc) => getDocumentIdFromName(doc.__name) === 'main') || null;
  if (configDoc) {
    push('config_updated', configDoc.updatedAt || configDoc.__updateTime, { source: 'firestore.users.config/main' });
  }

  const automationState = getCollectionDocs(raw, 'automation').find((doc) => getDocumentIdFromName(doc.__name) === 'state') || null;
  if (automationState) {
    push('automation_state_updated', automationState.updatedAt || automationState.__updateTime, { source: 'firestore.users.automation/state' });
  }

  const metrics = getCollectionDocs(raw, 'metrics');
  if (metrics.length) {
    const sorted = [...metrics].sort((a, b) => (toEpochMs(a.updatedAt || a.__updateTime) || 0) - (toEpochMs(b.updatedAt || b.__updateTime) || 0));
    const latest = sorted[sorted.length - 1];
    push('latest_metrics_update', latest.updatedAt || latest.__updateTime, {
      source: 'firestore.users.metrics',
      docId: getDocumentIdFromName(latest.__name)
    });
  }

  const history = getCollectionDocs(raw, 'history');
  if (history.length) {
    const sorted = [...history].sort((a, b) => (toEpochMs(a.timestamp) || 0) - (toEpochMs(b.timestamp) || 0));
    push('history_first_event', sorted[0].timestamp || sorted[0].__createTime, { source: 'firestore.users.history' });
    push('history_latest_event', sorted[sorted.length - 1].timestamp || sorted[sorted.length - 1].__createTime, {
      source: 'firestore.users.history',
      eventType: sorted[sorted.length - 1].type || null
    });
  }

  const audit = getCollectionDocs(raw, 'automationAudit');
  if (audit.length) {
    const sorted = [...audit].sort((a, b) => (toEpochMs(a.epochMs || a.timestamp) || 0) - (toEpochMs(b.epochMs || b.timestamp) || 0));
    push('automation_audit_first_event', sorted[0].epochMs || sorted[0].timestamp || sorted[0].__createTime, {
      source: 'firestore.users.automationAudit'
    });
    push('automation_audit_latest_event', sorted[sorted.length - 1].epochMs || sorted[sorted.length - 1].timestamp || sorted[sorted.length - 1].__createTime, {
      source: 'firestore.users.automationAudit',
      triggered: !!sorted[sorted.length - 1].triggered
    });
  }

  return events.sort((a, b) => a.epochMs - b.epochMs);
}

function buildSummary(scan) {
  const collections = scan.collections || {};
  const configDocs = getCollectionDocs(scan, 'config');
  const configMain = configDocs.find((doc) => getDocumentIdFromName(doc.__name) === 'main') || null;
  const rulesDocs = getCollectionDocs(scan, 'rules');
  const historyDocs = getCollectionDocs(scan, 'history');
  const auditDocs = getCollectionDocs(scan, 'automationAudit');
  const metricsDocs = getCollectionDocs(scan, 'metrics');
  const automationDocs = getCollectionDocs(scan, 'automation');
  const automationState = automationDocs.find((doc) => getDocumentIdFromName(doc.__name) === 'state') || null;

  const historyByType = {};
  for (const item of historyDocs) {
    const type = String(item.type || 'unknown');
    historyByType[type] = (historyByType[type] || 0) + 1;
  }

  const auditTimes = auditDocs
    .map((item) => toEpochMs(item.epochMs || item.timestamp || item.__createTime))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const triggeredCount = auditDocs.filter((item) => !!item.triggered).length;
  const auditErrors = auditDocs.filter((item) => item.error !== null && item.error !== undefined).length;

  const rulesNames = rulesDocs
    .map((doc) => getDocumentIdFromName(doc.__name))
    .filter(Boolean)
    .sort();

  const profile = {
    profileInitialized: !!scan.userDoc,
    role: scan.userDoc?.role || 'user',
    automationEnabled: !!scan.userDoc?.automationEnabled,
    createdAt: scan.userDoc?.createdAt || null,
    lastUpdated: scan.userDoc?.lastUpdated || null,
    firestoreDocCreateTime: scan.userDoc?.__createTime || null,
    firestoreDocUpdateTime: scan.userDoc?.__updateTime || null
  };

  const config = configMain
    ? {
        setupComplete: !!configMain.setupComplete,
        deviceProvider: configMain.deviceProvider || null,
        hasDeviceSn: !!configMain.deviceSn,
        hasFoxessToken: !!configMain.foxessToken,
        hasSungrowToken: !!configMain.sungrowToken,
        hasAlphaEssToken: !!configMain.alphaessAppId || !!configMain.alphaessSystemSn || !!configMain.alphaEssToken,
        hasAmberApiKey: !!configMain.amberApiKey,
        amberSiteIdPresent: !!configMain.amberSiteId,
        batteryCapacityKWh: Number.isFinite(Number(configMain.batteryCapacityKWh)) ? Number(configMain.batteryCapacityKWh) : null,
        inverterCapacityW: Number.isFinite(Number(configMain.inverterCapacityW)) ? Number(configMain.inverterCapacityW) : null,
        location: configMain.location || null,
        timezone: configMain.timezone || null,
        systemTopology: configMain.systemTopology || null,
        updatedAt: configMain.updatedAt || configMain.__updateTime || null
      }
    : null;

  const secretsDocs = getCollectionDocs(scan, 'secrets');
  const secretsKeys = new Set();
  for (const doc of secretsDocs) {
    Object.keys(doc || {})
      .filter((k) => !k.startsWith('__'))
      .forEach((k) => secretsKeys.add(k));
  }

  const collectionsSummary = {};
  for (const [collectionId, payload] of Object.entries(collections)) {
    collectionsSummary[collectionId] = {
      count: Number(payload.count || 0),
      truncated: !!payload.truncated,
      error: payload.error || null
    };
  }

  const summary = {
    auth: scan.authUser
      ? {
          uid: scan.authUser.localId,
          email: scan.authUser.email || null,
          emailVerified: !!scan.authUser.emailVerified,
          createdAt: scan.authUser.createdAt || null,
          lastSignedInAt: scan.authUser.lastSignedInAt || null,
          providers: Array.isArray(scan.authUser.providerUserInfo)
            ? scan.authUser.providerUserInfo.map((entry) => entry.providerId).filter(Boolean)
            : []
        }
      : null,
    profile,
    config,
    rules: {
      count: rulesDocs.length,
      names: rulesNames
    },
    automation: {
      enabled: !!automationState?.enabled,
      activeRule: automationState?.activeRule || null,
      lastCheck: automationState?.lastCheck || null,
      lastTriggered: automationState?.lastTriggered || null,
      updatedAt: automationState?.updatedAt || automationState?.__updateTime || null
    },
    history: {
      count: historyDocs.length,
      byType: historyByType
    },
    automationAudit: {
      count: auditDocs.length,
      triggeredCount,
      errorCount: auditErrors,
      firstEventAt: auditTimes.length ? new Date(auditTimes[0]).toISOString() : null,
      lastEventAt: auditTimes.length ? new Date(auditTimes[auditTimes.length - 1]).toISOString() : null
    },
    metrics: summarizeMetrics(metricsDocs),
    secrets: {
      docs: secretsDocs.length,
      keysPresent: Array.from(secretsKeys).sort()
    },
    adminAuditReferences: {
      targetUidRefs: Array.isArray(scan.adminAuditTarget) ? scan.adminAuditTarget.length : 0,
      adminUidRefs: Array.isArray(scan.adminAuditAdmin) ? scan.adminAuditAdmin.length : 0
    },
    collections: collectionsSummary
  };

  summary.stage = stageFromSummary(summary);
  summary.timeline = buildTimeline(summary, scan);

  return summary;
}

async function buildUserScan({
  accessToken,
  projectId,
  email,
  maxDocsPerCollection,
  includeSecrets
}) {
  const authLookup = await findAuthUsersByEmail(accessToken, projectId, email);
  if (!authLookup.matches.length) {
    return {
      generatedAt: new Date().toISOString(),
      projectId,
      query: { email },
      authUsersScanned: authLookup.scannedUsers,
      found: false,
      error: `User not found in Firebase Auth for email: ${email}`
    };
  }

  const authUser = authLookup.matches[0];
  const uid = authUser.localId;

  const scan = {
    generatedAt: new Date().toISOString(),
    projectId,
    query: { email },
    authUsersScanned: authLookup.scannedUsers,
    found: true,
    authUser,
    uid,
    userDoc: null,
    collectionIds: [],
    collections: {},
    adminAuditTarget: [],
    adminAuditAdmin: []
  };

  const userDoc = await getDocument(accessToken, projectId, 'users', uid);
  scan.userDoc = userDoc.exists ? userDoc.data : null;

  try {
    scan.collectionIds = await listCollectionIds(accessToken, projectId, 'users', uid);
  } catch (e) {
    scan.collectionIds = [];
    scan.collectionIdsError = {
      message: e.message,
      details: e.response || null
    };
  }

  for (const collectionId of scan.collectionIds) {
    try {
      const listed = await listCollectionDocuments(
        accessToken,
        projectId,
        ['users', uid, collectionId],
        maxDocsPerCollection
      );

      scan.collections[collectionId] = {
        count: listed.documents.length,
        truncated: listed.truncated,
        documents: listed.documents.map((doc) => redactSensitive(doc, includeSecrets))
      };
    } catch (e) {
      scan.collections[collectionId] = {
        count: 0,
        truncated: false,
        error: e.message,
        details: e.response || null,
        documents: []
      };
    }
  }

  try {
    scan.adminAuditTarget = await runFirestoreQuery(accessToken, projectId, {
      from: [{ collectionId: 'admin_audit' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'targetUid' },
          op: 'EQUAL',
          value: { stringValue: uid }
        }
      },
      limit: 200
    });
  } catch (e) {
    scan.adminAuditTarget = [];
    scan.adminAuditTargetError = { message: e.message, details: e.response || null };
  }

  try {
    scan.adminAuditAdmin = await runFirestoreQuery(accessToken, projectId, {
      from: [{ collectionId: 'admin_audit' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'adminUid' },
          op: 'EQUAL',
          value: { stringValue: uid }
        }
      },
      limit: 200
    });
  } catch (e) {
    scan.adminAuditAdmin = [];
    scan.adminAuditAdminError = { message: e.message, details: e.response || null };
  }

  scan.authUser = redactSensitive(scan.authUser, includeSecrets);
  scan.userDoc = redactSensitive(scan.userDoc, includeSecrets);
  scan.adminAuditTarget = redactSensitive(scan.adminAuditTarget, includeSecrets);
  scan.adminAuditAdmin = redactSensitive(scan.adminAuditAdmin, includeSecrets);

  scan.summary = buildSummary(scan);
  return scan;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  if (!args.email) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const outputPath = args.outputPath || defaultOutputPath(args.email);
  const accessToken = await getGoogleAccessToken();
  const report = await buildUserScan({
    accessToken,
    projectId: args.projectId,
    email: args.email,
    maxDocsPerCollection: args.maxDocsPerCollection,
    includeSecrets: args.includeSecrets
  });

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  if (!report.found) {
    console.log(`User not found. Wrote: ${outputPath}`);
    return;
  }

  const summary = report.summary || {};
  console.log(`Wrote: ${outputPath}`);
  console.log(JSON.stringify({
    email: args.email,
    uid: report.uid,
    stage: summary.stage || null,
    automationEnabled: summary.profile?.automationEnabled || false,
    setupComplete: summary.config?.setupComplete || false,
    rulesCount: summary.rules?.count || 0,
    historyCount: summary.history?.count || 0,
    auditCount: summary.automationAudit?.count || 0,
    metricTotals: summary.metrics?.totals || {}
  }, null, 2));
}

main().catch((error) => {
  console.error('[user-debug-report] Failed:', error && error.message ? error.message : error);
  if (error && error.response) {
    console.error('[user-debug-report] Response:', JSON.stringify(error.response, null, 2));
  }
  process.exitCode = 1;
});
