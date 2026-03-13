'use strict';

/**
 * AlphaESS OpenAPI Client Module
 * Handles communication with https://openapi.alphaess.com
 *
 * Auth model:
 *   headers.appId     = developer app id
 *   headers.timeStamp = unix timestamp (seconds)
 *   headers.sign      = SHA512(appId + appSecret + timeStamp)
 *
 * Error ranges:
 *   3500 - generic AlphaESS error
 *   3501 - token/sign validation failed
 *   3502 - authentication/credential error
 *   3503 - rate limited
 *   3504 - upstream server error
 *   3505 - request timeout
 */

const crypto = require('crypto');

let _db = null;
let logger = null;
let getConfig = null;
let incrementApiCount = null;

const DEFAULT_BASE_URL = 'https://openapi.alphaess.com';

function maskSensitiveValue(value) {
  if (value === null || value === undefined) return value;
  const str = String(value);
  if (str.length <= 6) return '***';
  return `${str.slice(0, 3)}***${str.slice(-3)}`;
}

function sanitizeParams(params) {
  if (!params || typeof params !== 'object') return params;
  const sanitized = {};
  for (const [key, value] of Object.entries(params)) {
    const lower = String(key).toLowerCase();
    if (
      lower.includes('secret') ||
      lower.includes('token') ||
      lower.includes('password') ||
      lower.includes('sign')
    ) {
      sanitized[key] = '***';
    } else if (lower.includes('sn')) {
      sanitized[key] = maskSensitiveValue(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function summarizeUpstreamPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    code: Number(raw.code),
    msg: raw.msg || raw.info || raw.message || null,
    success: raw.success === true
  };
}

function toSafeString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function generateAlphaEssSign(appId, appSecret, timestampSec) {
  return crypto
    .createHash('sha512')
    .update(`${toSafeString(appId)}${toSafeString(appSecret)}${toSafeString(timestampSec)}`)
    .digest('hex');
}

function normalizeAlphaEssResponse(raw, httpStatus) {
  if (!raw || typeof raw !== 'object') {
    return { errno: 3500, error: 'Empty or non-JSON response from AlphaESS API', raw };
  }

  const code = Number(raw.code);
  const msg = raw.msg || raw.info || raw.message || '';
  const lowerMsg = String(msg).toLowerCase();

  const success = (httpStatus >= 200 && httpStatus < 300) && (code === 200 || code === 0 || raw.success === true);
  if (success) {
    return {
      errno: 0,
      result: raw.data !== undefined ? raw.data : raw.result,
      raw
    };
  }

  if (httpStatus === 429 || lowerMsg.includes('rate') || lowerMsg.includes('too many')) {
    return { errno: 3503, error: msg || 'AlphaESS API rate limited', raw };
  }
  if (httpStatus >= 500) {
    return { errno: 3504, error: msg || 'AlphaESS upstream server error', raw };
  }
  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    lowerMsg.includes('token') ||
    lowerMsg.includes('timestamp') ||
    lowerMsg.includes('sign')
  ) {
    return { errno: 3501, error: msg || 'AlphaESS signature validation failed', raw };
  }
  if (
    lowerMsg.includes('appid') ||
    lowerMsg.includes('secret') ||
    lowerMsg.includes('auth') ||
    lowerMsg.includes('forbidden') ||
    lowerMsg.includes('permission')
  ) {
    return { errno: 3502, error: msg || 'AlphaESS authentication failed', raw };
  }

  return {
    errno: 3500,
    error: msg || `AlphaESS API error (HTTP ${httpStatus || 'unknown'}, code ${Number.isFinite(code) ? code : 'unknown'})`,
    raw
  };
}

function normalizeSystemList(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.list)) return payload.list;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (payload.sysSn) return [payload];
  return [];
}

function resolveRuntimeCredentials(userConfig = {}) {
  const cfg = typeof getConfig === 'function' ? (getConfig() || {}) : {};
  const alphaCfg = cfg.alphaess || {};

  const appId = toSafeString(
    userConfig.alphaessAppId ||
    alphaCfg.appId ||
    process.env.ALPHAESS_APP_ID
  );
  const appSecret = toSafeString(
    userConfig.alphaessAppSecret ||
    alphaCfg.appSecret ||
    process.env.ALPHAESS_APP_SECRET
  );
  const baseUrl = toSafeString(
    alphaCfg.baseUrl ||
    process.env.ALPHAESS_BASE_URL ||
    DEFAULT_BASE_URL
  );

  return { appId, appSecret, baseUrl: baseUrl || DEFAULT_BASE_URL };
}

function init(deps) {
  _db = deps.db;
  logger = deps.logger || console;
  getConfig = deps.getConfig;
  incrementApiCount = deps.incrementApiCount;

  logger.info('[AlphaESSAPI] Module initialized');

  return {
    generateAlphaEssSign,
    callAlphaESSAPI,
    listSystems
  };
}

async function callAlphaESSAPI(path, method = 'GET', params = null, userConfig = {}, userId = null) {
  const runtime = resolveRuntimeCredentials(userConfig);
  const appId = runtime.appId;
  const appSecret = runtime.appSecret;
  const baseUrl = runtime.baseUrl;

  if (!appId || !appSecret) {
    return {
      errno: 3502,
      error: 'AlphaESS app credentials not configured (alphaess.appId / alphaess.appSecret)'
    };
  }

  const isEmulator = !!(process.env.FUNCTIONS_EMULATOR || process.env.FIRESTORE_EMULATOR_HOST);
  if (isEmulator) {
    logger.info('[AlphaESSAPI] Emulator mode: returning mock response for path=' + path);
    return { errno: 0, result: { _emulated: true, path }, raw: null };
  }

  const normalizedPath = String(path || '').startsWith('/') ? String(path) : `/${String(path || '')}`;
  const httpMethod = String(method || 'GET').toUpperCase();
  const traceId = `alphaess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAtMs = Date.now();
  const timeStamp = Math.floor(Date.now() / 1000);
  const sign = generateAlphaEssSign(appId, appSecret, timeStamp);

  const headers = {
    appId,
    timeStamp: String(timeStamp),
    sign,
    'Content-Type': 'application/json'
  };

  let url = `${baseUrl}${normalizedPath}`;
  let body;

  if (httpMethod === 'GET' && params && typeof params === 'object') {
    const query = new URLSearchParams(
      Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
        .map(([key, value]) => [key, String(value)])
    );
    const qs = query.toString();
    if (qs) url += `?${qs}`;
  } else if ((httpMethod === 'POST' || httpMethod === 'PUT') && params && typeof params === 'object') {
    body = JSON.stringify(params);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  logger.info(
    `[AlphaESSAPI] trace=${traceId} request ${httpMethod} ${normalizedPath} user=${userId || 'unknown'} params=${JSON.stringify(sanitizeParams(params))}`
  );

  try {
    const response = await fetch(url, {
      method: httpMethod,
      headers,
      body,
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      logger.error('[AlphaESSAPI] Invalid JSON response for path=' + normalizedPath);
      return { errno: 3500, error: 'AlphaESS returned an unreadable response', raw: text };
    }

    const normalized = normalizeAlphaEssResponse(parsed, response.status);
    if (normalized.errno !== 3503 && userId && typeof incrementApiCount === 'function') {
      await incrementApiCount(userId, 'alphaess');
    }

    const elapsedMs = Date.now() - startedAtMs;
    const upstream = summarizeUpstreamPayload(parsed);
    if (normalized.errno === 0) {
      logger.info(
        `[AlphaESSAPI] trace=${traceId} success ${httpMethod} ${normalizedPath} http=${response.status} errno=${normalized.errno} elapsedMs=${elapsedMs} upstream=${JSON.stringify(upstream)}`,
        true
      );
    } else {
      logger.warn(
        `[AlphaESSAPI] trace=${traceId} failure ${httpMethod} ${normalizedPath} http=${response.status} errno=${normalized.errno} elapsedMs=${elapsedMs} upstream=${JSON.stringify(upstream)} params=${JSON.stringify(sanitizeParams(params))}`
      );
    }
    return normalized;
  } catch (error) {
    clearTimeout(timeoutId);
    const elapsedMs = Date.now() - startedAtMs;
    if (error && error.name === 'AbortError') {
      logger.warn(
        `[AlphaESSAPI] trace=${traceId} timeout ${httpMethod} ${normalizedPath} elapsedMs=${elapsedMs} params=${JSON.stringify(sanitizeParams(params))}`
      );
      return { errno: 3505, error: 'AlphaESS request timed out' };
    }
    logger.error(
      `[AlphaESSAPI] trace=${traceId} exception ${httpMethod} ${normalizedPath} elapsedMs=${elapsedMs} error=${error && error.message ? error.message : 'unknown'}`
    );
    return { errno: 3500, error: error && error.message ? error.message : 'AlphaESS API call failed' };
  }
}

async function listSystems(userConfig = {}, userId = null) {
  const result = await callAlphaESSAPI('/api/getEssList', 'GET', null, userConfig, userId);
  if (result.errno !== 0) {
    return result;
  }

  return {
    errno: 0,
    result: normalizeSystemList(result.result),
    raw: result.raw
  };
}

module.exports = {
  init,
  generateAlphaEssSign
};

