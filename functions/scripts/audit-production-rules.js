#!/usr/bin/env node
'use strict';

/**
 * Read-only production rules audit.
 *
 * Scans:
 *   users/{uid}/rules/*
 * and enriches with:
 *   users/{uid}/config/main
 *
 * Auth:
 *   Reuses Firebase CLI token from:
 *   C:/Users/<user>/.config/configstore/firebase-tools.json
 *
 * Output:
 *   JSON summary to stdout
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const fetch = global.fetch;
const { validateRuleActionForUser } = require('../lib/services/automation-rule-action-service');
const { normalizeWeekdays } = require('../lib/automation-conditions');

if (typeof fetch !== 'function') {
  throw new Error('Global fetch is not available in this runtime.');
}

const PROJECT_ID = process.env.FIREBASE_PROJECT || 'inverter-automation-firebase';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TOKEN_FILE = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');

function decodeValue(v) {
  if (!v || typeof v !== 'object') return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return Number(v.doubleValue);
  if (v.booleanValue !== undefined) return !!v.booleanValue;
  if (v.nullValue !== undefined) return null;
  if (v.timestampValue !== undefined) return v.timestampValue;

  if (v.arrayValue !== undefined) {
    const arr = v.arrayValue.values || [];
    return arr.map(decodeValue);
  }

  if (v.mapValue !== undefined) {
    const out = {};
    const fields = (v.mapValue && v.mapValue.fields) || {};
    for (const [k, vv] of Object.entries(fields)) out[k] = decodeValue(vv);
    return out;
  }

  return null;
}

function decodeDoc(doc) {
  const out = {};
  const fields = doc && doc.fields ? doc.fields : {};
  for (const [k, v] of Object.entries(fields)) out[k] = decodeValue(v);
  return out;
}

function idFromDocName(name) {
  if (!name) return '';
  const parts = String(name).split('/');
  return parts[parts.length - 1] || '';
}

function toHHMMMinutes(s) {
  if (typeof s !== 'string' || !/^\d{1,2}:\d{2}$/.test(s)) return null;
  const [hRaw, mRaw] = s.split(':');
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return h * 60 + m;
}

function shortId(uid) {
  if (!uid) return uid;
  if (uid.length <= 10) return uid;
  return `${uid.slice(0, 4)}...${uid.slice(-4)}`;
}

function parseToken() {
  const raw = fs.readFileSync(TOKEN_FILE, 'utf8');
  const data = JSON.parse(raw);
  const token = data && data.tokens ? data.tokens.access_token : '';
  if (!token) throw new Error(`No Firebase CLI access token found in ${TOKEN_FILE}`);
  return token;
}

async function fetchJson(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status} for ${url}: ${txt.slice(0, 240)}`);
  }
  return res.json();
}

async function listDocuments(pathName, token, pageSize = 200) {
  const docs = [];
  let pageToken = null;

  do {
    const qs = new URLSearchParams();
    qs.set('pageSize', String(pageSize));
    if (pageToken) qs.set('pageToken', pageToken);
    const url = `${BASE}/${pathName}?${qs.toString()}`;
    const data = await fetchJson(url, token);
    if (Array.isArray(data.documents)) docs.push(...data.documents);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return docs;
}

async function getDocument(pathName, token) {
  const url = `${BASE}/${pathName}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status} for ${url}: ${txt.slice(0, 240)}`);
  }
  return res.json();
}

function listIssuesForRule({ userId, ruleId, rule, userConfig }) {
  const issues = [];
  const enabled = rule && rule.enabled !== false;
  const action = (rule && rule.action) || {};
  const conditions = (rule && rule.conditions) || {};
  const ruleName = (rule && rule.name) || ruleId;

  const add = (severity, code, message, detail = {}) => {
    issues.push({ severity, code, message, userId, ruleId, ruleName, enabled, ...detail });
  };

  const actionErr = validateRuleActionForUser(action, userConfig || {});
  if (actionErr) add(enabled ? 'high' : 'medium', 'invalid_action', actionErr);

  const priority = Number(rule && rule.priority);
  if (!Number.isFinite(priority)) {
    add(enabled ? 'medium' : 'low', 'missing_priority', 'priority is missing or non-numeric');
  } else {
    if (priority < 1 || priority > 99) {
      add(enabled ? 'medium' : 'low', 'priority_out_of_range', `priority ${priority} is outside recommended 1-99`);
    }
    if (!Number.isInteger(priority)) {
      add('low', 'priority_non_integer', `priority ${priority} is non-integer`);
    }
  }

  const cooldown = Number(rule && rule.cooldownMinutes);
  if (!Number.isFinite(cooldown)) {
    add(enabled ? 'medium' : 'low', 'missing_cooldown', 'cooldownMinutes missing/non-numeric');
  } else if (!Number.isInteger(cooldown) || cooldown < 1 || cooldown > 1440) {
    add(enabled ? 'high' : 'medium', 'invalid_cooldown', `cooldownMinutes ${cooldown} must be integer 1-1440`);
  }

  const enabledConditions = Object.entries(conditions).filter(([, c]) => c && typeof c === 'object' && c.enabled === true);
  if (enabled && enabledConditions.length === 0) {
    add('high', 'no_enabled_conditions', 'enabled rule has zero enabled conditions and will never trigger');
  }

  const checkBetween = (condKey, cond) => {
    const op = cond && (cond.op || cond.operator);
    if (op === 'between' && (cond.value2 === undefined || cond.value2 === null || cond.value2 === '')) {
      add(enabled ? 'high' : 'medium', 'between_missing_value2', `${condKey} uses operator=between but value2 is missing`);
    }
  };

  const numericCondKeys = ['soc', 'feedInPrice', 'buyPrice', 'price', 'solarRadiation', 'cloudCover', 'forecastPrice', 'temperature', 'temp'];
  for (const key of numericCondKeys) {
    const cond = conditions[key];
    if (!cond || typeof cond !== 'object' || cond.enabled !== true) continue;
    checkBetween(key, cond);

    if (cond.value !== undefined && cond.value !== null && cond.value !== '' && !Number.isFinite(Number(cond.value))) {
      add(enabled ? 'medium' : 'low', 'non_numeric_value', `${key}.value is non-numeric (${String(cond.value)})`);
    }
    if (cond.value2 !== undefined && cond.value2 !== null && cond.value2 !== '' && !Number.isFinite(Number(cond.value2))) {
      add(enabled ? 'medium' : 'low', 'non_numeric_value2', `${key}.value2 is non-numeric (${String(cond.value2)})`);
    }
  }

  const soc = conditions.soc;
  if (soc && typeof soc === 'object' && soc.enabled === true) {
    const v1 = Number(soc.value);
    const v2 = soc.value2 !== undefined && soc.value2 !== null ? Number(soc.value2) : null;
    if (Number.isFinite(v1) && (v1 < 0 || v1 > 100)) add(enabled ? 'high' : 'medium', 'soc_out_of_range', `soc.value ${v1} outside 0-100`);
    if (Number.isFinite(v2) && (v2 < 0 || v2 > 100)) add(enabled ? 'high' : 'medium', 'soc_value2_out_of_range', `soc.value2 ${v2} outside 0-100`);
  }

  const time = conditions.time || conditions.timeWindow;
  if (time && typeof time === 'object' && time.enabled === true) {
    const start = time.startTime || time.start;
    const end = time.endTime || time.end;
    const startMin = toHHMMMinutes(start);
    const endMin = toHHMMMinutes(end);
    if (startMin === null) add(enabled ? 'high' : 'medium', 'invalid_time_start', `invalid time start '${start}'`);
    if (endMin === null) add(enabled ? 'high' : 'medium', 'invalid_time_end', `invalid time end '${end}'`);
    if (startMin !== null && endMin !== null && startMin === endMin) {
      add(enabled ? 'high' : 'medium', 'time_window_zero_length', 'time window start equals end, so condition is never true');
    }
    if (Array.isArray(time.days) && time.days.length > 0) {
      const normalized = normalizeWeekdays(time.days);
      if (normalized.length === 0) {
        add(enabled ? 'high' : 'medium', 'invalid_time_days', 'time.days provided but all values are invalid');
      }
    }
  }

  const workMode = action.workMode || 'SelfUse';
  const fdPwr = Number(action.fdPwr);
  if ((workMode === 'SelfUse' || workMode === 'Backup') && Number.isFinite(fdPwr) && fdPwr > 0) {
    add('low', 'possibly_unused_power', `${workMode} has fdPwr=${fdPwr}W (likely ignored by this mode)`);
  }

  const minSocOnGrid = action.minSocOnGrid;
  const fdSoc = action.fdSoc;
  const maxSoc = action.maxSoc;

  if (minSocOnGrid !== undefined && minSocOnGrid !== null && Number.isFinite(Number(minSocOnGrid))) {
    const v = Number(minSocOnGrid);
    if (v < 0 || v > 100) add(enabled ? 'high' : 'medium', 'min_soc_on_grid_out_of_range', `minSocOnGrid ${v} outside 0-100`);
  }
  if (fdSoc !== undefined && fdSoc !== null && Number.isFinite(Number(fdSoc))) {
    const v = Number(fdSoc);
    if (v < 0 || v > 100) add(enabled ? 'high' : 'medium', 'fd_soc_out_of_range', `fdSoc ${v} outside 0-100`);
  }
  if (maxSoc !== undefined && maxSoc !== null && Number.isFinite(Number(maxSoc))) {
    const v = Number(maxSoc);
    if (v < 0 || v > 100) add(enabled ? 'high' : 'medium', 'max_soc_out_of_range', `maxSoc ${v} outside 0-100`);
  }
  if (Number.isFinite(Number(minSocOnGrid)) && Number.isFinite(Number(maxSoc)) && Number(minSocOnGrid) > Number(maxSoc)) {
    add(enabled ? 'high' : 'medium', 'soc_bounds_inverted', `minSocOnGrid ${Number(minSocOnGrid)} > maxSoc ${Number(maxSoc)}`);
  }

  const duration = Number(action.durationMinutes);
  if (Number.isFinite(duration) && duration > 360) {
    add('low', 'long_duration', `durationMinutes ${duration} is long and may reduce responsiveness`);
  }

  return issues;
}

async function main() {
  const startedAt = new Date().toISOString();
  const token = parseToken();

  const userDocs = await listDocuments('users', token, 500);

  let totalRules = 0;
  let enabledRules = 0;
  let usersWithRules = 0;
  const issues = [];

  for (const userDoc of userDocs) {
    const userId = idFromDocName(userDoc.name);

    let userConfig = {};
    try {
      const configDoc = await getDocument(`users/${userId}/config/main`, token);
      if (configDoc) userConfig = decodeDoc(configDoc);
    } catch (err) {
      issues.push({
        severity: 'low',
        code: 'config_read_error',
        message: `failed reading config/main: ${err.message}`,
        userId,
        ruleId: null,
        ruleName: null,
        enabled: null
      });
    }

    let ruleDocs = [];
    try {
      ruleDocs = await listDocuments(`users/${userId}/rules`, token, 200);
    } catch (err) {
      issues.push({
        severity: 'medium',
        code: 'rules_read_error',
        message: `failed reading rules: ${err.message}`,
        userId,
        ruleId: null,
        ruleName: null,
        enabled: null
      });
      continue;
    }

    if (ruleDocs.length > 0) usersWithRules += 1;

    const enabledByPriority = new Map();

    for (const ruleDoc of ruleDocs) {
      totalRules += 1;
      const ruleId = idFromDocName(ruleDoc.name);
      const rule = decodeDoc(ruleDoc);
      const enabled = rule && rule.enabled !== false;
      if (enabled) enabledRules += 1;

      const priority = Number(rule && rule.priority);
      if (enabled && Number.isFinite(priority)) {
        if (!enabledByPriority.has(priority)) enabledByPriority.set(priority, []);
        enabledByPriority.get(priority).push({ ruleId, ruleName: (rule && rule.name) || ruleId });
      }

      issues.push(...listIssuesForRule({ userId, ruleId, rule, userConfig }));
    }

    for (const [priority, list] of enabledByPriority.entries()) {
      if (list.length > 1) {
        issues.push({
          severity: 'medium',
          code: 'duplicate_enabled_priority',
          message: `multiple enabled rules share priority ${priority}: ${list.map((r) => r.ruleId).join(', ')}`,
          userId,
          ruleId: null,
          ruleName: null,
          enabled: true,
          duplicatePriority: priority,
          duplicateRules: list
        });
      }
    }
  }

  const severityRank = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => {
    const diff = (severityRank[a.severity] ?? 99) - (severityRank[b.severity] ?? 99);
    if (diff !== 0) return diff;
    return String(a.code).localeCompare(String(b.code));
  });

  const countsBySeverity = issues.reduce((acc, issue) => {
    acc[issue.severity] = (acc[issue.severity] || 0) + 1;
    return acc;
  }, {});

  const countsByCode = issues.reduce((acc, issue) => {
    acc[issue.code] = (acc[issue.code] || 0) + 1;
    return acc;
  }, {});

  const topIssueCodes = Object.entries(countsByCode)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([code, count]) => ({ code, count }));

  const sampleFindings = issues.slice(0, 40).map((issue) => ({
    severity: issue.severity,
    code: issue.code,
    userId: shortId(issue.userId),
    ruleId: issue.ruleId,
    ruleName: issue.ruleName,
    message: issue.message
  }));

  const report = {
    projectId: PROJECT_ID,
    startedAt,
    finishedAt: new Date().toISOString(),
    totals: {
      usersScanned: userDocs.length,
      usersWithRules,
      totalRules,
      enabledRules,
      disabledRules: totalRules - enabledRules,
      totalIssues: issues.length,
      countsBySeverity
    },
    topIssueCodes,
    sampleFindings
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error('[audit-production-rules] fatal:', err && err.message ? err.message : err);
  process.exit(1);
});
