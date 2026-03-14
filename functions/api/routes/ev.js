'use strict';

/**
 * EV (Electric Vehicle) Routes
 *
 * Endpoints for EV vehicle management, status retrieval, and OAuth flows.
 *
 *   GET    /api/ev/vehicles                           — list registered vehicles
 *   POST   /api/ev/vehicles                           — register a vehicle
 *   DELETE /api/ev/vehicles/:vehicleId                — remove a vehicle
 *   GET    /api/ev/vehicles/:vehicleId/status         — current vehicle status
 *   GET    /api/ev/vehicles/:vehicleId/command-readiness — current command readiness
 *   POST   /api/ev/vehicles/:vehicleId/command        — issue charging commands
 *   GET    /api/ev/oauth/start                        — begin OAuth2 flow
 *   POST   /api/ev/oauth/callback                     — exchange auth code for tokens
 */

const { createEvUsageControlService } = require('../../lib/services/ev-usage-control-service');
const {
  buildTeslaAuthUrl,
  createTeslaHttpClient,
  exchangeTeslaAuthCode,
  normalizeTeslaVin
} = require('../../lib/adapters/tesla-fleet-adapter');

function registerEVRoutes(app, deps = {}) {
  const authenticateUser = deps.authenticateUser;
  const vehiclesRepo = deps.vehiclesRepo;
  const adapterRegistry = deps.adapterRegistry;
  const teslaHttpClient = deps.teslaHttpClient || deps.httpClient || null;
  const getUserConfig = typeof deps.getUserConfig === 'function' ? deps.getUserConfig : null;
  const getConfig = typeof deps.getConfig === 'function' ? deps.getConfig : null;
  const incrementApiCount = typeof deps.incrementApiCount === 'function' ? deps.incrementApiCount : null;
  const logger = deps.logger || console;
  const evUsageControl = deps.evUsageControl || createEvUsageControlService({
    admin: deps.admin || null,
    db: deps.db || null,
    logger
  });

  if (!app || typeof app.get !== 'function') {
    throw new Error('registerEVRoutes requires an Express app');
  }
  if (typeof authenticateUser !== 'function') {
    throw new Error('registerEVRoutes requires authenticateUser()');
  }
  if (!vehiclesRepo || typeof vehiclesRepo.listVehicles !== 'function') {
    throw new Error('registerEVRoutes requires a valid vehiclesRepo');
  }
  if (!adapterRegistry || typeof adapterRegistry.getEVProvider !== 'function') {
    throw new Error('registerEVRoutes requires an adapterRegistry with EV provider support');
  }

  function toPublicVehicleShape(vehicle = {}) {
    const publicFields = { ...(vehicle || {}) };
    publicFields.hasCredentials = Boolean(
      String(vehicle?.credentials?.accessToken || '').trim()
    );
    delete publicFields.credentials;
    delete publicFields.credentialsUpdatedAt;
    return publicFields;
  }

  function buildPersistCredentialsFn({ uid, vehicleId, vehicle, credentials }) {
    return async (nextCredentials = {}) => {
      const merged = {
        ...(credentials || {}),
        ...(nextCredentials || {})
      };
      await vehiclesRepo.setVehicleCredentials(uid, vehicleId, {
        ...merged,
        provider: merged.provider || vehicle?.provider || 'tesla',
        region: merged.region || vehicle?.region || 'na',
        storedAtIso: new Date().toISOString()
      });
    };
  }

  function isTeslaReconnectError(error) {
    const status = extractErrorStatus(error);
    if (status === 401 || status === 403) return true;
    const message = extractErrorMessage(error);
    if (!message) return false;
    if (status === 400 && /invalid.?grant|invalid.?token/.test(message)) return true;
    return /unauthor|forbidden|invalid.?token|expired|access denied/.test(message);
  }

  function isTeslaRateLimitError(error) {
    const status = extractErrorStatus(error);
    if (status === 429) return true;
    const message = extractErrorMessage(error);
    return /rate.?limit|too many requests/.test(message);
  }

  function isTeslaVehicleLookupError(error) {
    const status = extractErrorStatus(error);
    if (status === 404) return true;
    const message = extractErrorMessage(error);
    return /not found|unknown vehicle/.test(message);
  }

  function isTeslaVehicleOfflineError(error) {
    const status = extractErrorStatus(error);
    if (status === 408) return true;
    const message = extractErrorMessage(error);
    return /vehicle.*(offline|asleep|unavailable)|\boffline\b|\basleep\b/.test(message);
  }

  function isTeslaUpstreamServiceError(error) {
    const status = extractErrorStatus(error);
    if (status >= 500 && status < 600) return true;
    const message = extractErrorMessage(error);
    return /timeout|timed out|network|enotfound|econnreset|ehostunreach|gateway|service unavailable|http\s*5\d\d/.test(message);
  }

  function isTeslaProxyFailureError(error) {
    if (error?.isProxyFailure === true) return true;
    const status = extractErrorStatus(error);
    const message = extractErrorMessage(error);
    return status === 502 || /proxy|signed command proxy|not_a_json_request|signed_command_proxy/.test(message);
  }

  function isTeslaVirtualKeyMissingError(error) {
    if (error?.isVirtualKeyMissing === true) return true;
    const message = extractErrorMessage(error);
    return /missing_key|public key has not been paired|key has not been paired|no private key available/.test(message);
  }

  function isTeslaCommandConflictError(error) {
    const status = extractErrorStatus(error);
    const message = extractErrorMessage(error);
    return status === 409 || /\bis_charging\b|\bnot_charging\b|\balready_set\b|\bdisconnected\b|\bno_power\b|\bcomplete\b|\brequested\b/.test(message);
  }

  function normalizeTeslaCommandReasonCode(error) {
    const explicit = String(error?.reasonCode || '').trim();
    if (explicit) return explicit;
    const message = extractErrorMessage(error);
    if (!message) return 'tesla_command_failed';
    if (/is charging/.test(message)) return 'is_charging';
    if (/not charging/.test(message)) return 'not_charging';
    if (/already set/.test(message)) return 'already_set';
    if (/disconnected/.test(message)) return 'disconnected';
    if (/no power/.test(message)) return 'no_power';
    if (/complete/.test(message)) return 'complete';
    if (/requested/.test(message)) return 'requested';
    return message.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'tesla_command_failed';
  }

  function extractErrorStatus(error) {
    const candidates = [
      error?.status,
      error?.statusCode,
      error?.response?.status,
      error?.cause?.status,
      error?.cause?.statusCode,
      error?.cause?.response?.status
    ];
    for (const candidate of candidates) {
      const status = Number(candidate);
      if (Number.isFinite(status) && status > 0) {
        return status;
      }
    }

    const messageCandidates = [
      String(error?.message || ''),
      String(error?.cause?.message || '')
    ];
    for (const message of messageCandidates) {
      const match = message.match(/(?:http|status)\s*[:=]?\s*(\d{3})/i);
      if (!match) continue;
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }

    return 0;
  }

  function extractErrorMessage(error) {
    const candidates = [
      error?.message,
      error?.response?.data?.error?.message,
      error?.response?.data?.error,
      error?.cause?.message,
      error?.cause?.response?.data?.error?.message,
      error?.cause?.response?.data?.error
    ];
    for (const candidate of candidates) {
      const text = String(candidate || '').trim();
      if (text) return text.toLowerCase();
    }
    return '';
  }

  const EV_STATUS_CACHE_MAX_AGE_MS = Math.max(0, Number(process.env.EV_STATUS_CACHE_MAX_AGE_MS || 120000));
  const EV_TESLA_STATUS_CACHE_MIN_AGE_MS = 120000;
  const EV_TESLA_STATUS_CACHE_MAX_AGE_MS = 10000000;
  const EV_TESLA_STATUS_CACHE_DEFAULT_AGE_MS = 600000;
  const EV_TESLA_COMMAND_COOLDOWN_MS = Math.max(1000, Number(process.env.EV_TESLA_COMMAND_COOLDOWN_MS || 5000));
  const EV_TESLA_COMMAND_DEDUP_TTL_MS = Math.max(EV_TESLA_COMMAND_COOLDOWN_MS, Number(process.env.EV_TESLA_COMMAND_DEDUP_TTL_MS || 60000));
  const recentTeslaCommandAttempts = new Map();
  const recentTeslaCommandResults = new Map();

  function normalizeTeslaStatusCacheTtlMs(value, fallbackMs = EV_TESLA_STATUS_CACHE_DEFAULT_AGE_MS) {
    const parsedFallback = Number(fallbackMs);
    const boundedFallback = Number.isFinite(parsedFallback)
      ? Math.min(EV_TESLA_STATUS_CACHE_MAX_AGE_MS, Math.max(EV_TESLA_STATUS_CACHE_MIN_AGE_MS, Math.round(parsedFallback)))
      : EV_TESLA_STATUS_CACHE_DEFAULT_AGE_MS;
    const parsedValue = Number(value);
    if (!Number.isFinite(parsedValue)) return boundedFallback;
    return Math.min(EV_TESLA_STATUS_CACHE_MAX_AGE_MS, Math.max(EV_TESLA_STATUS_CACHE_MIN_AGE_MS, Math.round(parsedValue)));
  }

  const EV_TESLA_STATUS_CACHE_DEFAULT_FROM_CONFIG_MS = (() => {
    if (!getConfig) return EV_TESLA_STATUS_CACHE_DEFAULT_AGE_MS;
    try {
      const serverConfig = getConfig();
      return normalizeTeslaStatusCacheTtlMs(
        serverConfig?.automation?.cacheTtl?.teslaStatus,
        EV_TESLA_STATUS_CACHE_DEFAULT_AGE_MS
      );
    } catch {
      return EV_TESLA_STATUS_CACHE_DEFAULT_AGE_MS;
    }
  })();

  function resolveTeslaStatusCacheMaxAgeMs(userConfig = null) {
    return normalizeTeslaStatusCacheTtlMs(
      userConfig?.cache?.teslaStatus,
      EV_TESLA_STATUS_CACHE_DEFAULT_FROM_CONFIG_MS
    );
  }

  function parseMillis(value) {
    if (!value) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value instanceof Date) {
      const ms = value.getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value?.toDate === 'function') {
      const ms = value.toDate().getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value?._seconds === 'number') {
      const ms = (Number(value._seconds) * 1000) + Math.floor(Number(value._nanoseconds || 0) / 1000000);
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function isFreshVehicleStatus(cachedState = {}, maxAgeMs = EV_STATUS_CACHE_MAX_AGE_MS) {
    if (!cachedState || maxAgeMs <= 0) return false;
    const observedMs =
      parseMillis(cachedState.savedAt) ||
      parseMillis(cachedState.asOfIso);
    if (!Number.isFinite(observedMs)) return false;
    return (Date.now() - observedMs) <= maxAgeMs;
  }

  function buildVehicleStatusCacheAudit(cachedState = null, maxAgeMs = EV_STATUS_CACHE_MAX_AGE_MS, requestedLive = false) {
    const observedMs = cachedState
      ? (parseMillis(cachedState.savedAt) || parseMillis(cachedState.asOfIso))
      : null;
    const ageMs = Number.isFinite(observedMs) ? Math.max(0, Date.now() - observedMs) : null;
    return {
      requestedLive: Boolean(requestedLive),
      cacheConfigured: maxAgeMs > 0,
      cacheMaxAgeMs: Number(maxAgeMs) > 0 ? Number(maxAgeMs) : 0,
      cacheAgeMs: Number.isFinite(ageMs) ? ageMs : null,
      cacheFresh: Boolean(cachedState) && Number.isFinite(ageMs) && maxAgeMs > 0 && ageMs <= maxAgeMs
    };
  }

  function resolveTeslaVehicleContext(vehicleId, vehicle = {}, credentials = {}) {
    const vehicleVin = normalizeTeslaVin(
      vehicle?.vin ||
      credentials?.vin ||
      vehicleId
    );
    const teslaVehicleId = String(
      vehicle?.teslaVehicleId ||
      credentials?.teslaVehicleId ||
      vehicleId ||
      ''
    ).trim();

    return {
      vehicleVin,
      teslaVehicleId
    };
  }

  function parseBooleanQueryFlag(value) {
    return value === '1' || value === 'true' || value === 1 || value === true;
  }

  function normalizeCommandId(value) {
    const normalized = String(value || '').trim();
    return normalized || '';
  }

  function getTeslaCommandCooldownKey(uid, vehicleId, command) {
    return `${String(uid || '').trim()}::${String(vehicleId || '').trim()}::${String(command || '').trim()}`;
  }

  function getTeslaCommandDedupKey(uid, vehicleId, commandId) {
    return `${String(uid || '').trim()}::${String(vehicleId || '').trim()}::${String(commandId || '').trim()}`;
  }

  function pruneRecentTeslaCommandState() {
    const nowMs = Date.now();
    for (const [key, timestamp] of recentTeslaCommandAttempts.entries()) {
      if ((nowMs - Number(timestamp || 0)) > EV_TESLA_COMMAND_COOLDOWN_MS) {
        recentTeslaCommandAttempts.delete(key);
      }
    }
    for (const [key, entry] of recentTeslaCommandResults.entries()) {
      if ((nowMs - Number(entry?.savedAtMs || 0)) > EV_TESLA_COMMAND_DEDUP_TTL_MS) {
        recentTeslaCommandResults.delete(key);
      }
    }
  }

  function claimTeslaCommandExecution(uid, vehicleId, command) {
    pruneRecentTeslaCommandState();
    const key = getTeslaCommandCooldownKey(uid, vehicleId, command);
    const lastAttemptMs = Number(recentTeslaCommandAttempts.get(key) || 0);
    const nowMs = Date.now();
    const remainingMs = EV_TESLA_COMMAND_COOLDOWN_MS - (nowMs - lastAttemptMs);
    if (remainingMs > 0) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000))
      };
    }
    recentTeslaCommandAttempts.set(key, nowMs);
    return {
      allowed: true,
      retryAfterSeconds: 0
    };
  }

  function getCachedTeslaCommandResult(uid, vehicleId, commandId) {
    const normalizedCommandId = normalizeCommandId(commandId);
    if (!normalizedCommandId) return null;
    pruneRecentTeslaCommandState();
    const entry = recentTeslaCommandResults.get(getTeslaCommandDedupKey(uid, vehicleId, normalizedCommandId)) || null;
    return entry && entry.result ? entry.result : null;
  }

  function storeTeslaCommandResult(uid, vehicleId, commandId, result) {
    const normalizedCommandId = normalizeCommandId(commandId);
    if (!normalizedCommandId) return;
    recentTeslaCommandResults.set(getTeslaCommandDedupKey(uid, vehicleId, normalizedCommandId), {
      savedAtMs: Date.now(),
      result
    });
  }

  function parseRequiredInteger(value, fieldName) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error(`${fieldName} must be a number`);
    }
    return Math.round(numeric);
  }

  function validateTeslaCommandPayload(body = {}) {
    const allowedCommands = new Set(['startCharging', 'stopCharging', 'setChargeLimit', 'setChargingAmps']);
    const command = String(body?.command || '').trim();
    if (!allowedCommands.has(command)) {
      throw new Error('command must be one of: startCharging, stopCharging, setChargeLimit, setChargingAmps');
    }

    const commandId = normalizeCommandId(body?.commandId);
    const validated = { command, commandId };

    if (command === 'setChargeLimit') {
      const targetSocPct = parseRequiredInteger(body?.targetSocPct, 'targetSocPct');
      if (targetSocPct < 50 || targetSocPct > 100) {
        throw new Error('targetSocPct must be between 50 and 100');
      }
      validated.targetSocPct = targetSocPct;
    } else if (body?.targetSocPct !== undefined) {
      throw new Error('targetSocPct is only valid for setChargeLimit');
    }

    if (command === 'setChargingAmps') {
      const chargingAmps = parseRequiredInteger(body?.chargingAmps, 'chargingAmps');
      if (chargingAmps < 1 || chargingAmps > 48) {
        throw new Error('chargingAmps must be between 1 and 48');
      }
      validated.chargingAmps = chargingAmps;
    } else if (body?.chargingAmps !== undefined) {
      throw new Error('chargingAmps is only valid for setChargingAmps');
    }

    return validated;
  }

  function createTeslaApiAuditTracker({ uid, vehicleId, routeName }) {
    const normalizedUid = String(uid || '').trim();
    const normalizedVehicleId = String(vehicleId || '').trim();
    const normalizedRouteName = String(routeName || '').trim() || 'unknown_route';

    let totalApiCalls = 0;
    let billableApiCalls = 0;
    let genericEvCounterIncremented = false;
    const categories = {};

    const snapshot = () => ({
      routeName: normalizedRouteName,
      teslaApiCalls: totalApiCalls,
      teslaBillableApiCalls: billableApiCalls,
      teslaApiCallsByCategory: { ...categories }
    });

    if (!normalizedUid || !normalizedVehicleId) {
      return {
        recordTeslaApiCall: null,
        snapshot
      };
    }

    const recordTeslaApiCall = async (event = {}) => {
      totalApiCalls += 1;
      const category = String(event?.category || 'other').trim().toLowerCase() || 'other';
      categories[category] = Number(categories[category] || 0) + 1;
      if (event?.billable === true) {
        billableApiCalls += 1;
      }

      if (evUsageControl && typeof evUsageControl.recordTeslaApiCall === 'function') {
        await evUsageControl.recordTeslaApiCall({
          uid: normalizedUid,
          vehicleId: normalizedVehicleId,
          routeName: normalizedRouteName,
          ...event
        });
      }

      // Keep the generic EV counter aligned to billable upstream Tesla activity,
      // but increment it at most once per route request.
      if (incrementApiCount && event?.billable === true && !genericEvCounterIncremented) {
        genericEvCounterIncremented = true;
        await incrementApiCount(normalizedUid, 'ev');
      }
    };

    return {
      recordTeslaApiCall,
      snapshot
    };
  }

  function createTeslaUsageGuardMiddleware(resolveAction) {
    return async (req, res, next) => {
      const uid = String(req?.user?.uid || '').trim();
      const vehicleId = String(req?.params?.vehicleId || '').trim();
      if (!uid || !vehicleId) return next();

      try {
        const vehicle = await vehiclesRepo.getVehicle(uid, vehicleId);
        if (vehicle) {
          req.evVehicle = vehicle;
        }
        if (!vehicle || String(vehicle.provider || '').toLowerCase().trim() !== 'tesla') {
          return next();
        }

        const action = typeof resolveAction === 'function'
          ? String(resolveAction(req, vehicle) || '').trim()
          : '';
        if (!action) return next();

        if (!evUsageControl || typeof evUsageControl.assessRouteRequest !== 'function') {
          return next();
        }

        const decision = await evUsageControl.assessRouteRequest({
          uid,
          vehicleId,
          action,
          provider: 'tesla'
        });
        req.evUsageDecision = decision || null;

        if (decision && decision.blocked) {
          if (Number(decision.retryAfterSeconds) > 0) {
            res.set('Retry-After', String(Math.max(1, Math.floor(Number(decision.retryAfterSeconds)))));
          }
          return res.status(Number(decision.statusCode) || 429).json({
            errno: Number(decision.errno) || 429,
            error: String(decision.error || 'EV request blocked by Tesla usage guard'),
            result: {
              reasonCode: String(decision.reasonCode || 'usage_guard_blocked'),
              retryAfterSeconds: Number(decision.retryAfterSeconds) || 0
            }
          });
        }
      } catch (error) {
        logger.warn?.('EVRoutes', `Tesla usage guard failed open for ${vehicleId}: ${error.message || error}`);
      }

      return next();
    };
  }

  // ── Vehicle CRUD ──────────────────────────────────────────────────────────

  /**
   * GET /api/ev/vehicles
   * List all registered vehicles for the authenticated user.
   */
  app.get('/api/ev/vehicles', authenticateUser, async (req, res) => {
    const uid = req.user.uid;
    try {
      const vehicles = await vehiclesRepo.listVehicles(uid);
      return res.json({ errno: 0, result: vehicles.map(toPublicVehicleShape) });
    } catch (err) {
      return res.status(500).json({ errno: 500, error: err.message });
    }
  });

  /**
   * POST /api/ev/vehicles
   * Register a new vehicle.
   * Body: { vehicleId, provider, displayName?, region? }
   */
  app.post('/api/ev/vehicles', authenticateUser, async (req, res) => {
    const uid = req.user.uid;
    const {
      vehicleId,
      vin,
      teslaVehicleId,
      provider,
      displayName,
      region
    } = req.body || {};

    if (!provider || typeof provider !== 'string') {
      return res.status(400).json({ errno: 400, error: 'provider is required' });
    }

    const normalizedProvider = String(provider || '').trim().toLowerCase();
    const normalizedVin = normalizeTeslaVin(vin || (normalizedProvider === 'tesla' ? vehicleId : ''));
    const normalizedVehicleId = String(vehicleId || '').trim();

    if (normalizedProvider === 'tesla') {
      if (!normalizedVin && !normalizedVehicleId) {
        return res.status(400).json({ errno: 400, error: 'vin (preferred) or vehicleId is required for tesla' });
      }
    } else if (!normalizedVehicleId) {
      return res.status(400).json({ errno: 400, error: 'vehicleId is required' });
    }

    try {
      const canonicalVehicleId = normalizedProvider === 'tesla'
        ? (normalizedVin || normalizedVehicleId)
        : normalizedVehicleId;
      const vehicle = {
        vehicleId: canonicalVehicleId,
        provider: normalizedProvider,
        displayName: displayName || canonicalVehicleId,
        region: region || 'na',
        ...(normalizedProvider === 'tesla' && normalizedVin ? { vin: normalizedVin } : {}),
        ...(normalizedProvider === 'tesla' && String(teslaVehicleId || '').trim()
          ? { teslaVehicleId: String(teslaVehicleId).trim() }
          : {}),
        registeredAtIso: new Date().toISOString()
      };
      await vehiclesRepo.setVehicle(uid, canonicalVehicleId, vehicle);
      return res.status(201).json({ errno: 0, result: vehicle });
    } catch (err) {
      return res.status(500).json({ errno: 500, error: err.message });
    }
  });

  /**
   * DELETE /api/ev/vehicles/:vehicleId
   * Deregister a vehicle.
   */
  app.delete('/api/ev/vehicles/:vehicleId', authenticateUser, async (req, res) => {
    const uid = req.user.uid;
    const { vehicleId } = req.params;

    try {
      await vehiclesRepo.deleteVehicle(uid, vehicleId);
      return res.json({ errno: 0, result: { deleted: true } });
    } catch (err) {
      return res.status(500).json({ errno: 500, error: err.message });
    }
  });

  // ── Vehicle Status ────────────────────────────────────────────────────────

  /**
   * GET /api/ev/vehicles/:vehicleId/status
   * Fetch the current (live or cached) status for a vehicle.
   * Query: ?live=1 to bypass the state cache.
   */
  app.get(
    '/api/ev/vehicles/:vehicleId/status',
    authenticateUser,
    createTeslaUsageGuardMiddleware((req) => (parseBooleanQueryFlag(req?.query?.live) ? 'status_live' : '')),
    async (req, res) => {
      const uid = req.user.uid;
      const { vehicleId } = req.params;
      const live = parseBooleanQueryFlag(req?.query?.live);
      let vehicle = null;

      try {
        vehicle = req.evVehicle || await vehiclesRepo.getVehicle(uid, vehicleId);
        if (!vehicle) {
          return res.status(404).json({ errno: 404, error: 'Vehicle not found' });
        }

        let statusCacheMaxAgeMs = EV_STATUS_CACHE_MAX_AGE_MS;
        if (!live && String(vehicle?.provider || '').toLowerCase().trim() === 'tesla') {
          let userConfig = null;
          if (getUserConfig) {
            try {
              userConfig = await getUserConfig(uid);
            } catch (configError) {
              logger.warn?.('EVRoutes', `Failed to read user Tesla cache TTL for ${uid}: ${configError.message || configError}`);
            }
          }
          statusCacheMaxAgeMs = resolveTeslaStatusCacheMaxAgeMs(userConfig);
        }

        const cached = await vehiclesRepo.getVehicleState(uid, vehicleId);
        const cacheAudit = buildVehicleStatusCacheAudit(cached, statusCacheMaxAgeMs, live);
        if (!live && cached && isFreshVehicleStatus(cached, statusCacheMaxAgeMs)) {
          return res.json({
            errno: 0,
            result: cached,
            source: 'cache',
            audit: {
              ...cacheAudit,
              routeName: 'status_cached',
              teslaApiCalls: 0,
              teslaBillableApiCalls: 0,
              teslaApiCallsByCategory: {}
            }
          });
        }

        let usageDecision = req.evUsageDecision || null;
        if (!usageDecision && vehicle.provider === 'tesla' && typeof evUsageControl?.assessRouteRequest === 'function') {
          usageDecision = await evUsageControl.assessRouteRequest({
            uid,
            vehicleId,
            action: 'status_live',
            provider: 'tesla'
          });
        }

        if (usageDecision?.blocked) {
          if (cached) {
            return res.json({
              errno: 0,
              result: cached,
              source: 'cache_guarded',
              guarded: true,
              reasonCode: usageDecision.reasonCode || 'usage_guard_blocked'
            });
          }
          if (Number(usageDecision.retryAfterSeconds) > 0) {
            res.set('Retry-After', String(Math.max(1, Math.floor(Number(usageDecision.retryAfterSeconds)))));
          }
          return res.status(Number(usageDecision.statusCode) || 429).json({
            errno: Number(usageDecision.errno) || 429,
            error: String(usageDecision.error || 'Tesla status request blocked by usage guard'),
            result: {
              reasonCode: usageDecision.reasonCode || 'usage_guard_blocked',
              retryAfterSeconds: Number(usageDecision.retryAfterSeconds) || 0
            }
          });
        }

        if (usageDecision?.degraded) {
          if (cached) {
            return res.json({
              errno: 0,
              result: cached,
              source: 'cache_degraded',
              degraded: true,
              reasonCode: usageDecision.reasonCode || 'degraded_mode'
            });
          }
          return res.status(503).json({
            errno: 503,
            error: 'Tesla live status is temporarily paused to protect API budget',
            result: {
              degraded: true,
              reasonCode: usageDecision.reasonCode || 'degraded_mode'
            }
          });
        }

        const evAdapter = adapterRegistry.getEVProvider(vehicle.provider);
        if (!evAdapter) {
          return res.status(400).json({ errno: 400, error: `No EV provider registered for '${vehicle.provider}'` });
        }

        const credentials = await vehiclesRepo.getVehicleCredentials(uid, vehicleId);
        if (!credentials || !credentials.accessToken) {
          return res.status(400).json({ errno: 400, error: 'Vehicle credentials not configured' });
        }
        const teslaVehicleContext = resolveTeslaVehicleContext(vehicleId, vehicle, credentials);
        const teslaApiAudit = createTeslaApiAuditTracker({
          uid,
          vehicleId,
          routeName: live ? 'status_live' : 'status_cached'
        });

        const status = await evAdapter.getVehicleStatus(vehicleId, {
          credentials,
          userId: uid,
          vehicleId,
          recordTeslaApiCall: teslaApiAudit.recordTeslaApiCall,
          region: vehicle.region || credentials.region || 'na',
          vehicleVin: teslaVehicleContext.vehicleVin,
          teslaVehicleId: teslaVehicleContext.teslaVehicleId,
          persistCredentials: buildPersistCredentialsFn({
            uid,
            vehicleId,
            vehicle,
            credentials
          })
        });

        // Persist the fresh status
        await vehiclesRepo.saveVehicleState(uid, vehicleId, status);

        return res.json({
          errno: 0,
          result: status,
          source: 'live',
          audit: {
            ...cacheAudit,
            ...teslaApiAudit.snapshot()
          }
        });
      } catch (err) {
        if (String(vehicle?.provider || '').toLowerCase().trim() === 'tesla') {
          const cachedFallback = await vehiclesRepo.getVehicleState(uid, vehicleId).catch(() => null);

          if (isTeslaRateLimitError(err)) {
            const retryAfterSeconds = Number(err?.retryAfterMs) > 0
              ? Math.max(1, Math.ceil(Number(err.retryAfterMs) / 1000))
              : 30;
            if (retryAfterSeconds > 0) {
              res.set('Retry-After', String(retryAfterSeconds));
            }
            if (cachedFallback) {
              return res.json({
                errno: 0,
                result: cachedFallback,
                source: 'cache_guarded',
                guarded: true,
                reasonCode: 'provider_rate_limited'
              });
            }
            return res.status(429).json({
              errno: 429,
              error: 'Tesla API rate limit reached. Please retry shortly.',
              result: {
                reasonCode: 'provider_rate_limited',
                retryAfterSeconds
              }
            });
          }

          if (isTeslaVehicleOfflineError(err)) {
            if (cachedFallback) {
              return res.json({
                errno: 0,
                result: cachedFallback,
                source: 'cache_vehicle_offline',
                reasonCode: 'vehicle_offline'
              });
            }
            return res.json({
              errno: 0,
              result: {
                socPct: null,
                chargingState: 'unknown',
                chargeLimitPct: null,
                isPluggedIn: null,
                isHome: null,
                rangeKm: null,
                asOfIso: new Date().toISOString(),
                reasonCode: 'vehicle_offline'
              },
              source: 'synthesized',
              reasonCode: 'vehicle_offline'
            });
          }

          if (isTeslaReconnectError(err)) {
            if (cachedFallback) {
              return res.json({
                errno: 0,
                result: cachedFallback,
                source: 'cache_auth_stale',
                actionRequired: true,
                reasonCode: 'tesla_reconnect_required'
              });
            }
            return res.status(400).json({
              errno: 400,
              error: 'Tesla authorization expired for this vehicle. Reconnect Tesla in Settings.',
              result: {
                reasonCode: 'tesla_reconnect_required'
              }
            });
          }

          if (isTeslaVehicleLookupError(err)) {
            if (cachedFallback) {
              return res.json({
                errno: 0,
                result: cachedFallback,
                source: 'cache_vehicle_mismatch',
                actionRequired: true,
                reasonCode: 'tesla_vehicle_lookup_failed'
              });
            }
            return res.status(400).json({
              errno: 400,
              error: 'Tesla vehicle lookup failed. Verify VIN/region and reconnect in Settings.',
              result: {
                reasonCode: 'tesla_vehicle_lookup_failed'
              }
            });
          }

          if (isTeslaUpstreamServiceError(err)) {
            const retryAfterSeconds = Number(err?.retryAfterMs) > 0
              ? Math.max(1, Math.ceil(Number(err.retryAfterMs) / 1000))
              : 30;
            if (retryAfterSeconds > 0) {
              res.set('Retry-After', String(retryAfterSeconds));
            }
            if (cachedFallback) {
              return res.json({
                errno: 0,
                result: cachedFallback,
                source: 'cache_upstream_unavailable',
                degraded: true,
                reasonCode: 'tesla_upstream_unavailable'
              });
            }
            return res.status(503).json({
              errno: 503,
              error: 'Tesla live status is temporarily unavailable. Showing updates may be delayed.',
              result: {
                degraded: true,
                reasonCode: 'tesla_upstream_unavailable',
                retryAfterSeconds
              }
            });
          }
        }

        return res.status(500).json({ errno: 500, error: err.message });
      }
    }
  );

  app.get(
    '/api/ev/vehicles/:vehicleId/command-readiness',
    authenticateUser,
    async (req, res) => {
      const uid = req.user.uid;
      const { vehicleId } = req.params;

      try {
        const vehicle = await vehiclesRepo.getVehicle(uid, vehicleId);
        if (!vehicle) {
          return res.status(404).json({ errno: 404, error: 'Vehicle not found' });
        }

        const evAdapter = adapterRegistry.getEVProvider(vehicle.provider);
        if (!evAdapter) {
          return res.status(400).json({ errno: 400, error: `No EV provider registered for '${vehicle.provider}'` });
        }

        const credentials = await vehiclesRepo.getVehicleCredentials(uid, vehicleId);
        if (!credentials || !credentials.accessToken) {
          return res.json({
            errno: 0,
            result: {
              state: 'setup_required',
              transport: 'none',
              source: 'missing_credentials',
              vehicleCommandProtocolRequired: null,
              reasonCode: 'vehicle_credentials_not_configured'
            }
          });
        }

        if (typeof evAdapter.getCommandReadiness !== 'function') {
          return res.json({
            errno: 0,
            result: {
              state: 'read_only',
              transport: 'none',
              source: 'adapter_does_not_expose_command_readiness',
              vehicleCommandProtocolRequired: null,
              reasonCode: 'command_readiness_not_supported'
            }
          });
        }

        const teslaVehicleContext = resolveTeslaVehicleContext(vehicleId, vehicle, credentials);
        const readinessAudit = createTeslaApiAuditTracker({
          uid,
          vehicleId,
          routeName: 'command_readiness'
        });
        const readiness = await evAdapter.getCommandReadiness(vehicleId, {
          credentials,
          userId: uid,
          vehicleId,
          recordTeslaApiCall: readinessAudit.recordTeslaApiCall,
          region: vehicle.region || credentials.region || 'na',
          vehicleVin: teslaVehicleContext.vehicleVin,
          teslaVehicleId: teslaVehicleContext.teslaVehicleId,
          persistCredentials: buildPersistCredentialsFn({
            uid,
            vehicleId,
            vehicle,
            credentials
          })
        });

        return res.json({
          errno: 0,
          result: readiness,
          audit: readinessAudit.snapshot()
        });
      } catch (err) {
        if (isTeslaReconnectError(err)) {
          return res.status(400).json({
            errno: 400,
            error: 'Tesla authorization expired for this vehicle. Reconnect Tesla in Settings.',
            result: {
              reasonCode: 'tesla_reconnect_required'
            }
          });
        }
        return res.status(500).json({ errno: 500, error: err.message });
      }
    }
  );

  // ── Vehicle Commands ──────────────────────────────────────────────────────

  app.post(
    '/api/ev/vehicles/:vehicleId/command',
    authenticateUser,
    createTeslaUsageGuardMiddleware(() => 'command'),
    async (req, res) => {
      const uid = req.user.uid;
      const { vehicleId } = req.params;
      let vehicle = null;

      try {
        const payload = validateTeslaCommandPayload(req.body || {});
        const cachedResult = getCachedTeslaCommandResult(uid, vehicleId, payload.commandId);
        if (cachedResult) {
          return res.json({ errno: 0, result: { ...cachedResult, duplicate: true } });
        }

        vehicle = req.evVehicle || await vehiclesRepo.getVehicle(uid, vehicleId);
        if (!vehicle) {
          return res.status(404).json({ errno: 404, error: 'Vehicle not found' });
        }

        const evAdapter = adapterRegistry.getEVProvider(vehicle.provider);
        if (!evAdapter) {
          return res.status(400).json({ errno: 400, error: `No EV provider registered for '${vehicle.provider}'` });
        }
        if (typeof evAdapter.supportsChargingCommands === 'function' && evAdapter.supportsChargingCommands() !== true) {
          return res.status(501).json({ errno: 501, error: 'Charging commands are not supported for this EV provider' });
        }

        const credentials = await vehiclesRepo.getVehicleCredentials(uid, vehicleId);
        if (!credentials || !credentials.accessToken) {
          return res.status(400).json({ errno: 400, error: 'Vehicle credentials not configured' });
        }

        const cooldown = claimTeslaCommandExecution(uid, vehicleId, payload.command);
        if (!cooldown.allowed) {
          res.set('Retry-After', String(cooldown.retryAfterSeconds));
          return res.status(429).json({
            errno: 429,
            error: 'Tesla command cooldown in effect. Retry shortly.',
            result: {
              reasonCode: 'command_cooldown_active',
              retryAfterSeconds: cooldown.retryAfterSeconds
            }
          });
        }

        const teslaVehicleContext = resolveTeslaVehicleContext(vehicleId, vehicle, credentials);
        const teslaApiAudit = createTeslaApiAuditTracker({
          uid,
          vehicleId,
          routeName: `command_${payload.command}`
        });
        const baseContext = {
          credentials,
          userId: uid,
          vehicleId,
          recordTeslaApiCall: teslaApiAudit.recordTeslaApiCall,
          region: vehicle.region || credentials.region || 'na',
          vehicleVin: teslaVehicleContext.vehicleVin,
          teslaVehicleId: teslaVehicleContext.teslaVehicleId,
          persistCredentials: buildPersistCredentialsFn({
            uid,
            vehicleId,
            vehicle,
            credentials
          })
        };

        const readiness = typeof evAdapter.getCommandReadiness === 'function'
          ? await evAdapter.getCommandReadiness(vehicleId, baseContext)
          : {
            state: 'ready_direct',
            transport: 'direct',
            source: 'assumed',
            vehicleCommandProtocolRequired: null
          };

        if (readiness?.state === 'proxy_unavailable') {
          return res.status(503).json({
            errno: 503,
            error: 'Tesla vehicle requires signed commands, but the signed-command proxy is not configured.',
            result: {
              reasonCode: readiness.reasonCode || 'signed_command_proxy_unavailable',
              readiness
            }
          });
        }

        const commandContext = {
          ...baseContext,
          commandReadiness: readiness
        };

        let adapterResult;
        if (payload.command === 'startCharging') {
          adapterResult = await evAdapter.startCharging(vehicleId, commandContext);
        } else if (payload.command === 'stopCharging') {
          adapterResult = await evAdapter.stopCharging(vehicleId, commandContext);
        } else if (payload.command === 'setChargeLimit') {
          adapterResult = await evAdapter.setChargeLimit(vehicleId, payload.targetSocPct, commandContext);
        } else {
          adapterResult = await evAdapter.setChargingAmps(vehicleId, payload.chargingAmps, commandContext);
        }

        const result = {
          accepted: adapterResult?.accepted !== false,
          command: payload.command,
          provider: 'tesla',
          vehicleId,
          commandId: payload.commandId || undefined,
          transport: adapterResult?.transport || readiness?.transport || 'direct',
          status: adapterResult?.status || 'confirmed',
          noop: adapterResult?.noop === true,
          readiness,
          ...(payload.command === 'setChargeLimit' ? { targetSocPct: payload.targetSocPct } : {}),
          ...(payload.command === 'setChargingAmps' ? { chargingAmps: payload.chargingAmps } : {}),
          asOfIso: adapterResult?.asOfIso || new Date().toISOString()
        };

        storeTeslaCommandResult(uid, vehicleId, payload.commandId, result);

        return res.json({
          errno: 0,
          result,
          audit: teslaApiAudit.snapshot()
        });
      } catch (err) {
        if (String(vehicle?.provider || '').toLowerCase().trim() === 'tesla') {
          if (isTeslaRateLimitError(err)) {
            const retryAfterSeconds = Number(err?.retryAfterMs) > 0
              ? Math.max(1, Math.ceil(Number(err.retryAfterMs) / 1000))
              : 30;
            res.set('Retry-After', String(retryAfterSeconds));
            return res.status(429).json({
              errno: 429,
              error: 'Tesla command rate limit reached. Please retry shortly.',
              result: {
                reasonCode: normalizeTeslaCommandReasonCode(err),
                retryAfterSeconds
              }
            });
          }

          if (isTeslaReconnectError(err)) {
            return res.status(400).json({
              errno: 400,
              error: 'Tesla authorization expired for this vehicle. Reconnect Tesla in Settings.',
              result: {
                reasonCode: 'tesla_reconnect_required'
              }
            });
          }

          if (isTeslaVirtualKeyMissingError(err)) {
            return res.status(409).json({
              errno: 409,
              error: 'Tesla virtual key pairing is required before charging commands can be used.',
              result: {
                reasonCode: 'missing_virtual_key'
              }
            });
          }

          if (isTeslaProxyFailureError(err)) {
            return res.status(Number(extractErrorStatus(err) || 502)).json({
              errno: Number(extractErrorStatus(err) || 502),
              error: 'Tesla signed-command proxy is unavailable or rejected the request.',
              result: {
                reasonCode: normalizeTeslaCommandReasonCode(err)
              }
            });
          }

          if (isTeslaCommandConflictError(err)) {
            return res.status(409).json({
              errno: 409,
              error: String(err?.message || 'Tesla command could not be applied in the current vehicle state'),
              result: {
                reasonCode: normalizeTeslaCommandReasonCode(err)
              }
            });
          }

          if (isTeslaVehicleOfflineError(err)) {
            return res.status(408).json({
              errno: 408,
              error: 'Tesla vehicle is offline or asleep. Wake the vehicle and retry.',
              result: {
                reasonCode: 'vehicle_offline'
              }
            });
          }

          if (isTeslaUpstreamServiceError(err)) {
            const retryAfterSeconds = Number(err?.retryAfterMs) > 0
              ? Math.max(1, Math.ceil(Number(err.retryAfterMs) / 1000))
              : 30;
            res.set('Retry-After', String(retryAfterSeconds));
            return res.status(503).json({
              errno: 503,
              error: 'Tesla command service is temporarily unavailable.',
              result: {
                reasonCode: normalizeTeslaCommandReasonCode(err),
                retryAfterSeconds
              }
            });
          }
        }

        const message = String(err?.message || 'Invalid Tesla command request');
        if (/must be one of|only valid|required|must be between|must be a number/i.test(message)) {
          return res.status(400).json({ errno: 400, error: message });
        }
        return res.status(500).json({ errno: 500, error: message });
      }
    }
  );

  // ── OAuth2 ────────────────────────────────────────────────────────────────

  /**
   * GET /api/ev/oauth/start
   * Begin Tesla OAuth2 PKCE flow.
   * Query: { clientId, redirectUri, codeChallenge, region?, state? }
   */
  app.get('/api/ev/oauth/start', authenticateUser, (req, res) => {
    const { clientId, redirectUri, codeChallenge, region, state } = req.query;
    if (!clientId || !redirectUri || !codeChallenge) {
      return res.status(400).json({ errno: 400, error: 'clientId, redirectUri, and codeChallenge are required' });
    }
    try {
      const url = buildTeslaAuthUrl({ clientId, redirectUri, codeChallenge, state: String(state || '') }, region || 'na');
      return res.json({ errno: 0, result: { url } });
    } catch (err) {
      return res.status(500).json({ errno: 500, error: err.message });
    }
  });

  /**
   * POST /api/ev/oauth/callback
   * Exchange an authorization code for Tesla tokens and store credentials.
   * Body: { vehicleId|vin, clientId, redirectUri, code, codeVerifier, clientSecret?, region?, teslaVehicleId? }
   */
  app.post('/api/ev/oauth/callback', authenticateUser, async (req, res) => {
    const uid = req.user.uid;
    const {
      vehicleId,
      vin,
      teslaVehicleId,
      clientId,
      clientSecret,
      redirectUri,
      code,
      codeVerifier,
      region
    } = req.body || {};
    const requestedVin = normalizeTeslaVin(vin || vehicleId);
    const requestedVehicleKey = String(vehicleId || '').trim();

    if ((!requestedVehicleKey && !requestedVin) || !clientId || !redirectUri || !code || !codeVerifier) {
      return res.status(400).json({ errno: 400, error: 'vehicleId (or vin), clientId, redirectUri, code, and codeVerifier are required' });
    }

    try {
      let vehicle = null;
      let resolvedVehicleId = '';
      if (requestedVin) {
        vehicle = await vehiclesRepo.getVehicle(uid, requestedVin);
        resolvedVehicleId = vehicle ? requestedVin : '';
      }
      if (!vehicle && requestedVehicleKey) {
        vehicle = await vehiclesRepo.getVehicle(uid, requestedVehicleKey);
        resolvedVehicleId = vehicle ? requestedVehicleKey : resolvedVehicleId;
      }
      if (!vehicle) {
        return res.status(404).json({ errno: 404, error: 'Vehicle not found' });
      }

      const provider = String(vehicle.provider || '').toLowerCase().trim();
      if (provider !== 'tesla') {
        return res.status(400).json({ errno: 400, error: `OAuth callback currently supports tesla provider only (got '${provider || 'unknown'}')` });
      }

      const authCallRecorder = createTeslaApiAuditTracker({
        uid,
        vehicleId: resolvedVehicleId || requestedVin || requestedVehicleKey,
        routeName: 'oauth_callback'
      });
      let tokens;
      try {
        tokens = await exchangeTeslaAuthCode(
          {
            clientId,
            clientSecret,
            redirectUri,
            code,
            codeVerifier,
            region: region || vehicle.region || 'na'
          },
          teslaHttpClient || createTeslaHttpClient()
        );
        if (authCallRecorder.recordTeslaApiCall) {
          await authCallRecorder.recordTeslaApiCall({
            category: 'auth',
            status: 200,
            billable: false
          });
        }
      } catch (exchangeError) {
        if (authCallRecorder.recordTeslaApiCall) {
          await authCallRecorder.recordTeslaApiCall({
            category: 'auth',
            status: Number(exchangeError?.status) || 500,
            billable: false,
            error: String(exchangeError?.message || exchangeError || 'token_exchange_failed')
          });
        }
        throw exchangeError;
      }

      // Store credentials against the vehicle
      const resolvedVin = normalizeTeslaVin(requestedVin || vehicle.vin || '');
      await vehiclesRepo.setVehicleCredentials(uid, resolvedVehicleId, {
        provider: 'tesla',
        region: region || vehicle.region || 'na',
        ...(resolvedVin ? { vin: resolvedVin } : {}),
        ...(String(teslaVehicleId || vehicle.teslaVehicleId || '').trim()
          ? { teslaVehicleId: String(teslaVehicleId || vehicle.teslaVehicleId).trim() }
          : {}),
        clientId,
        ...(clientSecret ? { clientSecret } : {}),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenType: tokens.tokenType || 'Bearer',
        scope: tokens.scope || '',
        expiresAtMs: tokens.expiresAtMs,
        storedAtIso: new Date().toISOString()
      });
      if (resolvedVin && typeof vehiclesRepo.updateVehicle === 'function') {
        await vehiclesRepo.updateVehicle(uid, resolvedVehicleId, { vin: resolvedVin });
      }
      return res.json({
        errno: 0,
        result: {
          stored: true,
          vehicleId: resolvedVehicleId,
          ...(resolvedVin ? { vin: resolvedVin } : {})
        }
      });
    } catch (err) {
      return res.status(500).json({ errno: 500, error: err.message });
    }
  });
}

module.exports = { registerEVRoutes };
