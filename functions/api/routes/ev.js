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
 *   POST   /api/ev/vehicles/:vehicleId/wake           — manually wake a sleeping vehicle
 *   POST   /api/ev/vehicles/:vehicleId/command        — issue charging commands
 *   GET    /api/ev/oauth/start                        — begin OAuth2 flow
 *   POST   /api/ev/oauth/callback                     — exchange auth code for tokens
 */

const { createEvUsageControlService } = require('../../lib/services/ev-usage-control-service');
const {
  buildTeslaAuthUrl,
  createTeslaHttpClient,
  exchangeTeslaAuthCode,
  getTeslaPartnerDomainPublicKey,
  normalizeTeslaVin,
  registerTeslaPartnerDomain
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
  const db = deps.db || null;
  const deleteField = typeof deps.deleteField === 'function' ? deps.deleteField : null;
  const requireAdmin = typeof deps.requireAdmin === 'function' ? deps.requireAdmin : null;
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

  function mergeTeslaVehicleCredentials({ vehicle = {}, baseCredentials = {}, nextCredentials = {} }) {
    const merged = {
      ...(baseCredentials || {}),
      ...(nextCredentials || {})
    };
    return {
      ...merged,
      provider: merged.provider || vehicle?.provider || 'tesla',
      region: merged.region || vehicle?.region || 'na',
      storedAtIso: merged.storedAtIso || new Date().toISOString()
    };
  }

  function extractSharedTeslaCredentialFields(credentials = {}, vehicle = {}) {
    const merged = mergeTeslaVehicleCredentials({
      vehicle,
      baseCredentials: {},
      nextCredentials: credentials
    });
    const shared = {
      provider: merged.provider,
      region: merged.region,
      storedAtIso: merged.storedAtIso
    };
    if (merged.clientId) shared.clientId = merged.clientId;
    if (merged.clientSecret) shared.clientSecret = merged.clientSecret;
    if (merged.accessToken) shared.accessToken = merged.accessToken;
    if (merged.refreshToken) shared.refreshToken = merged.refreshToken;
    if (merged.tokenType) shared.tokenType = merged.tokenType;
    if (merged.scope !== undefined) shared.scope = merged.scope;
    if (Number.isFinite(Number(merged.expiresAtMs))) {
      shared.expiresAtMs = Number(merged.expiresAtMs);
    }
    return shared;
  }

  function buildTeslaCredentialGroupMatcher(credentials = {}, vehicle = {}) {
    const provider = String(credentials?.provider || vehicle?.provider || '').trim().toLowerCase();
    if (provider !== 'tesla') return null;

    const clientId = String(credentials?.clientId || '').trim();
    const region = String(credentials?.region || vehicle?.region || 'na').trim().toLowerCase();
    const refreshToken = String(credentials?.refreshToken || '').trim();
    const accessToken = String(credentials?.accessToken || '').trim();

    if (!clientId) return null;
    if (!refreshToken && !accessToken) return null;

    return {
      clientId,
      region,
      refreshToken,
      accessToken
    };
  }

  function matchesTeslaCredentialGroup(candidateCredentials = {}, vehicle = {}, matcher = null) {
    if (!matcher) return false;

    const provider = String(candidateCredentials?.provider || vehicle?.provider || '').trim().toLowerCase();
    if (provider !== 'tesla') return false;

    const candidateClientId = String(candidateCredentials?.clientId || '').trim();
    const candidateRegion = String(candidateCredentials?.region || vehicle?.region || 'na').trim().toLowerCase();
    if (candidateClientId !== matcher.clientId || candidateRegion !== matcher.region) {
      return false;
    }

    const candidateRefreshToken = String(candidateCredentials?.refreshToken || '').trim();
    if (matcher.refreshToken) {
      return candidateRefreshToken === matcher.refreshToken;
    }

    const candidateAccessToken = String(candidateCredentials?.accessToken || '').trim();
    return Boolean(matcher.accessToken) && candidateAccessToken === matcher.accessToken;
  }

  async function syncTeslaCredentialsAcrossMatchingVehicles({
    uid,
    sourceVehicleId,
    sourceVehicle,
    sourceBaseCredentials,
    sharedCredentialPatch
  }) {
    if (!vehiclesRepo || typeof vehiclesRepo.listVehicles !== 'function' || typeof vehiclesRepo.setVehicleCredentials !== 'function') {
      return;
    }

    const matcher = buildTeslaCredentialGroupMatcher(sourceBaseCredentials, sourceVehicle);
    if (!matcher) return;

    let vehicles = [];
    try {
      vehicles = await vehiclesRepo.listVehicles(uid);
    } catch (error) {
      logger.warn?.('EVRoutes', `Failed to enumerate Tesla vehicles for credential sync (${uid}): ${error?.message || error}`);
      return;
    }

    const normalizedSourceVehicleId = String(sourceVehicleId || '').trim();
    await Promise.all((Array.isArray(vehicles) ? vehicles : []).map(async (candidateVehicle) => {
      const candidateVehicleId = String(candidateVehicle?.vehicleId || '').trim();
      if (!candidateVehicleId || candidateVehicleId === normalizedSourceVehicleId) {
        return;
      }

      const provider = String(candidateVehicle?.provider || '').trim().toLowerCase();
      if (provider !== 'tesla') {
        return;
      }

      let candidateCredentials = candidateVehicle?.credentials || null;
      if (!candidateCredentials && typeof vehiclesRepo.getVehicleCredentials === 'function') {
        try {
          candidateCredentials = await vehiclesRepo.getVehicleCredentials(uid, candidateVehicleId);
        } catch (error) {
          logger.warn?.('EVRoutes', `Failed to load Tesla credentials for ${uid}/${candidateVehicleId} during sync: ${error?.message || error}`);
          return;
        }
      }

      if (!matchesTeslaCredentialGroup(candidateCredentials, candidateVehicle, matcher)) {
        return;
      }

      const merged = mergeTeslaVehicleCredentials({
        vehicle: candidateVehicle,
        baseCredentials: candidateCredentials || {},
        nextCredentials: sharedCredentialPatch || {}
      });

      try {
        await vehiclesRepo.setVehicleCredentials(uid, candidateVehicleId, merged);
      } catch (error) {
        logger.warn?.('EVRoutes', `Failed to sync Tesla credentials for ${uid}/${candidateVehicleId}: ${error?.message || error}`);
      }
    }));
  }

  function buildPersistCredentialsFn({ uid, vehicleId, vehicle, credentials }) {
    let currentCredentials = { ...(credentials || {}) };
    return async (nextCredentials = {}) => {
      const previousCredentials = { ...currentCredentials };
      const merged = mergeTeslaVehicleCredentials({
        vehicle,
        baseCredentials: currentCredentials,
        nextCredentials
      });

      await vehiclesRepo.setVehicleCredentials(uid, vehicleId, merged);
      currentCredentials = { ...merged };

      await syncTeslaCredentialsAcrossMatchingVehicles({
        uid,
        sourceVehicleId: vehicleId,
        sourceVehicle: vehicle,
        sourceBaseCredentials: previousCredentials,
        sharedCredentialPatch: extractSharedTeslaCredentialFields(merged, vehicle)
      });
    };
  }

  function deriveTeslaPartnerDomain({ domain, redirectUri }) {
    const explicitDomain = String(domain || '').trim().toLowerCase();
    if (explicitDomain) {
      return explicitDomain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    }

    const redirect = String(redirectUri || '').trim();
    if (!redirect) {
      throw new Error('Tesla partner domain registration requires redirectUri or domain');
    }

    let parsed;
    try {
      parsed = new URL(redirect);
    } catch (error) {
      throw new Error('Tesla partner domain registration requires a valid redirectUri', { cause: error });
    }

    return String(parsed.hostname || '').trim().toLowerCase();
  }

  function isTeslaReconnectError(error) {
    const status = extractErrorStatus(error);
    const message = extractErrorMessage(error);
    if (status === 401) return true;
    if (!message) return false;
    if (status === 400 && /invalid.?grant|invalid.?token|expired|revoked/.test(message)) return true;
    if (status === 403 && /invalid.?grant|invalid.?token|token expired|token revoked|expired|revoked|refresh token/.test(message)) return true;
    return /invalid.?grant|invalid.?token|token expired|token revoked|refresh token.*(expired|revoked|invalid)|oauth.*(expired|revoked|invalid)/.test(message);
  }

  function isTeslaPermissionDeniedError(error) {
    const status = extractErrorStatus(error);
    const message = extractErrorMessage(error);
    if (status !== 403) return false;
    if (!message) return true;
    return /forbidden|insufficient|scope|permission|not allowed|not authorized|requires.*scope|access to this resource/.test(message)
      && !isTeslaReconnectError(error);
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

  function buildTeslaBatchErrorReadiness(error, source = 'batch_error') {
    const warning = String(error?.message || 'Tesla command-readiness unavailable').trim() || 'Tesla command-readiness unavailable';
    if (isTeslaReconnectError(error)) {
      return {
        state: 'setup_required',
        transport: 'none',
        source,
        vehicleCommandProtocolRequired: null,
        reasonCode: 'tesla_reconnect_required',
        warning
      };
    }
    if (isTeslaPermissionDeniedError(error)) {
      return {
        state: 'setup_required',
        transport: 'none',
        source,
        vehicleCommandProtocolRequired: null,
        reasonCode: 'tesla_permission_denied',
        warning
      };
    }
    if (isTeslaVehicleLookupError(error)) {
      return {
        state: 'setup_required',
        transport: 'none',
        source,
        vehicleCommandProtocolRequired: null,
        reasonCode: 'tesla_vehicle_lookup_failed',
        warning
      };
    }
    return null;
  }

  function isTeslaPartnerPublicKeyConflict(error) {
    const message = extractErrorMessage(error);
    return /public key hash has already been taken/.test(message);
  }

  function isTeslaPartnerDomainAccessDenied(error) {
    const message = extractErrorMessage(error);
    return /does not have access to/i.test(message);
  }

  async function verifyTeslaPartnerDomainAlreadyRegistered(params) {
    try {
      const result = await getTeslaPartnerDomainPublicKey(
        params,
        teslaHttpClient || createTeslaHttpClient()
      );
      return Boolean(result && typeof result.publicKey === 'string' && result.publicKey.trim());
    } catch (error) {
      logger.warn(`Tesla partner public key verification failed after registration conflict: ${JSON.stringify({
        domain: params?.domain,
        region: params?.region,
        error: error?.message || String(error)
      })}`);
      return false;
    }
  }

  function isTeslaUpstreamServiceError(error) {
    const status = extractErrorStatus(error);
    if (status >= 500 && status < 600) return true;
    const message = extractErrorMessage(error);
    return /timeout|timed out|network|enotfound|econnreset|ehostunreach|gateway|service unavailable|http\s*5\d\d/.test(message);
  }

  function isTeslaProxyFailureError(error) {
    const status = extractErrorStatus(error);
    // 408/403 through the proxy are Tesla responses, not proxy infrastructure failures
    if (status === 408 || status === 403) return false;
    if (error?.isProxyFailure === true) return true;
    const message = extractErrorMessage(error);
    return status === 502 || /proxy|signed command proxy|not_a_json_request|signed_command_proxy/.test(message);
  }

  function isTeslaVirtualKeyMissingError(error) {
    if (error?.isVirtualKeyMissing === true) return true;
    const message = extractErrorMessage(error);
    return /missing_key|public key has not been paired|key has not been paired|key not paired|no private key available|KeyNotPaired/.test(message);
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
  const EV_TESLA_WAKE_COOLDOWN_MS = Math.max(EV_TESLA_COMMAND_COOLDOWN_MS, Number(process.env.EV_TESLA_WAKE_COOLDOWN_MS || 30000));
  const recentTeslaCommandAttempts = new Map();
  const recentTeslaCommandResults = new Map();
  const teslaCommandReadinessInFlight = new Map();

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

  function resolveTeslaCommandReadinessCacheMaxAgeMs(userConfig = null) {
    return resolveTeslaStatusCacheMaxAgeMs(userConfig);
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

  function isTeslaCacheInvalidatedByCredentialUpdate(cachedState = {}, vehicle = {}) {
    const provider = String(vehicle?.provider || '').trim().toLowerCase();
    if (provider !== 'tesla') return false;

    const cachedMs = parseMillis(cachedState?.savedAt) || parseMillis(cachedState?.asOfIso);
    const credentialsUpdatedMs = parseMillis(vehicle?.credentialsUpdatedAt);
    if (!Number.isFinite(cachedMs) || !Number.isFinite(credentialsUpdatedMs)) {
      return false;
    }

    return cachedMs < credentialsUpdatedMs;
  }

  function isReusableVehicleCache(cachedState = {}, vehicle = {}, maxAgeMs = EV_STATUS_CACHE_MAX_AGE_MS) {
    if (!isFreshVehicleStatus(cachedState, maxAgeMs)) {
      return false;
    }
    return !isTeslaCacheInvalidatedByCredentialUpdate(cachedState, vehicle);
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

  async function getTeslaUserConfigSafe(uid, cacheLabel = 'cache') {
    if (!getUserConfig) return null;
    try {
      return await getUserConfig(uid);
    } catch (configError) {
      logger.warn?.('EVRoutes', `Failed to read user Tesla ${cacheLabel} for ${uid}: ${configError.message || configError}`);
      return null;
    }
  }

  async function getCachedTeslaCommandReadiness(uid, vehicleId) {
    if (!vehiclesRepo || typeof vehiclesRepo.getVehicleCommandReadiness !== 'function') {
      return null;
    }
    return vehiclesRepo.getVehicleCommandReadiness(uid, vehicleId);
  }

  async function saveCachedTeslaCommandReadiness(uid, vehicleId, readiness) {
    if (!vehiclesRepo || typeof vehiclesRepo.saveVehicleCommandReadiness !== 'function') {
      return;
    }
    await vehiclesRepo.saveVehicleCommandReadiness(uid, vehicleId, readiness);
  }

  function getTeslaCommandReadinessInFlightKey(uid, vehicleId) {
    return `${String(uid || '').trim()}::${String(vehicleId || '').trim()}`;
  }

  async function dedupeTeslaCommandReadinessFetch(uid, vehicleId, fetcher) {
    const key = getTeslaCommandReadinessInFlightKey(uid, vehicleId);
    const existing = teslaCommandReadinessInFlight.get(key);
    if (existing) {
      const readiness = await existing;
      return { readiness, deduped: true };
    }

    const promise = Promise.resolve().then(fetcher);
    teslaCommandReadinessInFlight.set(key, promise);
    try {
      const readiness = await promise;
      return { readiness, deduped: false };
    } finally {
      if (teslaCommandReadinessInFlight.get(key) === promise) {
        teslaCommandReadinessInFlight.delete(key);
      }
    }
  }

  function buildTeslaCommandReadinessBatchKey(credentials = {}, region = 'na') {
    return JSON.stringify([
      String(region || credentials?.region || 'na').trim().toLowerCase(),
      String(credentials?.accessToken || '').trim(),
      String(credentials?.refreshToken || '').trim(),
      String(credentials?.clientId || '').trim()
    ]);
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

  function claimTeslaWakeExecution(uid, vehicleId) {
    pruneRecentTeslaCommandState();
    const key = getTeslaCommandCooldownKey(uid, vehicleId, 'wakeVehicle');
    const lastAttemptMs = Number(recentTeslaCommandAttempts.get(key) || 0);
    const nowMs = Date.now();
    const remainingMs = EV_TESLA_WAKE_COOLDOWN_MS - (nowMs - lastAttemptMs);
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

      // Keep the generic EV counter aligned to each billable upstream Tesla call attempt.
      if (incrementApiCount && event?.billable === true) {
        await incrementApiCount(normalizedUid, 'ev');
      }
    };

    return {
      recordTeslaApiCall,
      snapshot
    };
  }

  function createTeslaBatchApiAuditTracker({ uid, vehicleIds = [], routeName }) {
    const normalizedUid = String(uid || '').trim();
    const normalizedRouteName = String(routeName || '').trim() || 'unknown_route';
    const normalizedVehicleIds = Array.from(new Set(
      (Array.isArray(vehicleIds) ? vehicleIds : [])
        .map((vehicleId) => String(vehicleId || '').trim())
        .filter(Boolean)
    ));
    const metricVehicleId = normalizedVehicleIds[0] || '';

    let totalApiCalls = 0;
    let billableApiCalls = 0;
    const categories = {};

    const snapshot = () => ({
      routeName: normalizedRouteName,
      vehicleIds: normalizedVehicleIds.slice(),
      teslaApiCalls: totalApiCalls,
      teslaBillableApiCalls: billableApiCalls,
      teslaApiCallsByCategory: { ...categories }
    });

    if (!normalizedUid || !metricVehicleId) {
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
          vehicleId: metricVehicleId,
          routeName: normalizedRouteName,
          ...event
        });
      }

      if (incrementApiCount && event?.billable === true) {
        await incrementApiCount(normalizedUid, 'ev');
      }
    };

    return {
      recordTeslaApiCall,
      snapshot
    };
  }

  async function fetchTeslaCommandReadinessLive({
    uid,
    vehicleId,
    vehicle,
    credentials,
    evAdapter,
    recordTeslaApiCall,
    persistCredentials
  }) {
    const teslaVehicleContext = resolveTeslaVehicleContext(vehicleId, vehicle, credentials);
    const readiness = await evAdapter.getCommandReadiness(vehicleId, {
      credentials,
      userId: uid,
      vehicleId,
      recordTeslaApiCall,
      region: vehicle.region || credentials.region || 'na',
      vehicleVin: teslaVehicleContext.vehicleVin,
      teslaVehicleId: teslaVehicleContext.teslaVehicleId,
      persistCredentials
    });

    await saveCachedTeslaCommandReadiness(uid, vehicleId, readiness);
    return readiness;
  }

  async function fetchTeslaCommandReadinessBatchLive({
    uid,
    routeName,
    entries = [],
    evAdapter
  }) {
    const normalizedEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
    const audit = createTeslaBatchApiAuditTracker({
      uid,
      vehicleIds: normalizedEntries.map((entry) => entry.vehicleId),
      routeName
    });
    const readinessByVehicleId = {};
    const groups = new Map();

    for (const entry of normalizedEntries) {
      const region = entry.vehicle?.region || entry.credentials?.region || 'na';
      const key = buildTeslaCommandReadinessBatchKey(entry.credentials, region);
      if (!groups.has(key)) {
        groups.set(key, {
          region,
          entries: []
        });
      }
      groups.get(key).entries.push(entry);
    }

    for (const group of groups.values()) {
      const groupEntries = group.entries;
      if (groupEntries.length === 0) continue;

      if (typeof evAdapter.getCommandReadinessBatch === 'function') {
        const persistFns = groupEntries.map((entry) => buildPersistCredentialsFn({
          uid,
          vehicleId: entry.vehicleId,
          vehicle: entry.vehicle,
          credentials: entry.credentials
        }));
        const sharedContext = {
          credentials: groupEntries[0].credentials,
          userId: uid,
          region: group.region,
          recordTeslaApiCall: audit.recordTeslaApiCall,
          persistCredentials: async (nextCredentials = {}) => {
            await Promise.all(persistFns.map((persistFn) => persistFn(nextCredentials)));
          }
        };
        const requests = groupEntries.map((entry) => {
          const teslaVehicleContext = resolveTeslaVehicleContext(entry.vehicleId, entry.vehicle, entry.credentials);
          return {
            key: entry.vehicleId,
            vehicleId: entry.vehicleId,
            context: {
              vehicleVin: teslaVehicleContext.vehicleVin,
              teslaVehicleId: teslaVehicleContext.teslaVehicleId
            }
          };
        });
        try {
          const batchResults = await evAdapter.getCommandReadinessBatch(requests, sharedContext);
          for (const entry of groupEntries) {
            const readiness = batchResults?.[entry.vehicleId] || null;
            if (!readiness) continue;
            readinessByVehicleId[entry.vehicleId] = readiness;
            await saveCachedTeslaCommandReadiness(uid, entry.vehicleId, readiness);
          }
        } catch (error) {
          const fallbackReadiness = buildTeslaBatchErrorReadiness(error, 'batch_group_error');
          if (!fallbackReadiness) {
            throw error;
          }
          for (const entry of groupEntries) {
            readinessByVehicleId[entry.vehicleId] = { ...fallbackReadiness };
          }
        }
        continue;
      }

      for (const entry of groupEntries) {
        const persistCredentials = buildPersistCredentialsFn({
          uid,
          vehicleId: entry.vehicleId,
          vehicle: entry.vehicle,
          credentials: entry.credentials
        });
        try {
          const readiness = await fetchTeslaCommandReadinessLive({
            uid,
            vehicleId: entry.vehicleId,
            vehicle: entry.vehicle,
            credentials: entry.credentials,
            evAdapter,
            recordTeslaApiCall: audit.recordTeslaApiCall,
            persistCredentials
          });
          readinessByVehicleId[entry.vehicleId] = readiness;
        } catch (error) {
          const fallbackReadiness = buildTeslaBatchErrorReadiness(error, 'batch_entry_error');
          if (!fallbackReadiness) {
            throw error;
          }
          readinessByVehicleId[entry.vehicleId] = fallbackReadiness;
        }
      }
    }

    return {
      readinessByVehicleId,
      audit: audit.snapshot()
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
        if (!live && cached && isReusableVehicleCache(cached, vehicle, statusCacheMaxAgeMs)) {
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

          if (isTeslaPermissionDeniedError(err)) {
            if (cachedFallback) {
              return res.json({
                errno: 0,
                result: cachedFallback,
                source: 'cache_permission_denied',
                actionRequired: true,
                reasonCode: 'tesla_permission_denied'
              });
            }
            return res.status(403).json({
              errno: 403,
              error: 'Tesla denied access for this vehicle. Confirm your Tesla app permissions and vehicle approval, then reconnect Tesla in Settings.',
              result: {
                reasonCode: 'tesla_permission_denied'
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

  app.post(
    '/api/ev/vehicles/command-readiness',
    authenticateUser,
    async (req, res) => {
      const uid = req.user.uid;
      const vehicleIds = Array.from(new Set(
        (Array.isArray(req.body?.vehicleIds) ? req.body.vehicleIds : [])
          .map((vehicleId) => String(vehicleId || '').trim())
          .filter(Boolean)
      ));
      const live = parseBooleanQueryFlag(req.body?.live) || parseBooleanQueryFlag(req?.query?.live);

      if (vehicleIds.length === 0) {
        return res.json({ errno: 0, result: { byVehicleId: {} } });
      }

      try {
        const vehicles = await Promise.all(vehicleIds.map(async (vehicleId) => ({
          vehicleId,
          vehicle: await vehiclesRepo.getVehicle(uid, vehicleId)
        })));
        const userConfig = !live ? await getTeslaUserConfigSafe(uid, 'command-readiness cache TTL') : null;
        const cacheMaxAgeMs = resolveTeslaCommandReadinessCacheMaxAgeMs(userConfig);
        const resultByVehicleId = {};
        const teslaEntriesToFetch = [];

        for (const entry of vehicles) {
          const { vehicleId, vehicle } = entry;
          if (!vehicle) {
            resultByVehicleId[vehicleId] = {
              state: 'read_only',
              transport: 'none',
              source: 'missing_vehicle',
              vehicleCommandProtocolRequired: null,
              reasonCode: 'vehicle_not_found'
            };
            continue;
          }

          const evAdapter = adapterRegistry.getEVProvider(vehicle.provider);
          if (!evAdapter) {
            resultByVehicleId[vehicleId] = {
              state: 'read_only',
              transport: 'none',
              source: 'missing_provider_adapter',
              vehicleCommandProtocolRequired: null,
              reasonCode: 'command_readiness_not_supported'
            };
            continue;
          }

          const credentials = await vehiclesRepo.getVehicleCredentials(uid, vehicleId);
          if (!credentials || !credentials.accessToken) {
            resultByVehicleId[vehicleId] = {
              state: 'setup_required',
              transport: 'none',
              source: 'missing_credentials',
              vehicleCommandProtocolRequired: null,
              reasonCode: 'vehicle_credentials_not_configured'
            };
            continue;
          }

          const cached = !live
            ? await getCachedTeslaCommandReadiness(uid, vehicleId).catch(() => null)
            : null;
          if (!live && cached && isReusableVehicleCache(cached, vehicle, cacheMaxAgeMs)) {
            resultByVehicleId[vehicleId] = cached;
            continue;
          }

          if (String(vehicle.provider || '').trim().toLowerCase() !== 'tesla') {
            resultByVehicleId[vehicleId] = await evAdapter.getCommandReadiness(vehicleId, {
              credentials,
              userId: uid,
              vehicleId
            });
            continue;
          }

          teslaEntriesToFetch.push({
            vehicleId,
            vehicle,
            credentials
          });
        }

        let audit = {
          routeName: live ? 'command_readiness_batch_live' : 'command_readiness_batch',
          teslaApiCalls: 0,
          teslaBillableApiCalls: 0,
          teslaApiCallsByCategory: {}
        };
        if (teslaEntriesToFetch.length > 0) {
          const evAdapter = adapterRegistry.getEVProvider('tesla');
          if (!evAdapter) {
            return res.status(400).json({ errno: 400, error: 'No EV provider registered for \'tesla\'' });
          }
          const liveResults = await fetchTeslaCommandReadinessBatchLive({
            uid,
            routeName: live ? 'command_readiness_batch_live' : 'command_readiness_batch',
            entries: teslaEntriesToFetch,
            evAdapter
          });
          Object.assign(resultByVehicleId, liveResults.readinessByVehicleId);
          audit = liveResults.audit;
        }

        return res.json({
          errno: 0,
          result: {
            byVehicleId: resultByVehicleId
          },
          audit
        });
      } catch (err) {
        if (isTeslaReconnectError(err)) {
          return res.status(400).json({
            errno: 400,
            error: 'Tesla authorization expired for one or more vehicles. Reconnect Tesla in Settings.',
            result: {
              reasonCode: 'tesla_reconnect_required'
            }
          });
        }

        if (isTeslaPermissionDeniedError(err)) {
          return res.status(403).json({
            errno: 403,
            error: 'Tesla denied command-readiness access for one or more vehicles. Review Tesla Setup in Settings, then reconnect Tesla.',
            result: {
              reasonCode: 'tesla_permission_denied'
            }
          });
        }

        if (isTeslaRateLimitError(err)) {
          const retryAfterSeconds = Number(err?.retryAfterMs) > 0
            ? Math.max(1, Math.ceil(Number(err.retryAfterMs) / 1000))
            : 30;
          res.set('Retry-After', String(retryAfterSeconds));
          return res.status(429).json({
            errno: 429,
            error: 'Tesla command-readiness rate limit reached. Please retry shortly.',
            result: {
              reasonCode: 'provider_rate_limited',
              retryAfterSeconds
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
            error: 'Tesla command-readiness service is temporarily unavailable.',
            result: {
              reasonCode: 'tesla_upstream_unavailable',
              retryAfterSeconds
            }
          });
        }

        return res.status(500).json({ errno: 500, error: err.message });
      }
    }
  );

  app.get(
    '/api/ev/vehicles/:vehicleId/command-readiness',
    authenticateUser,
    createTeslaUsageGuardMiddleware((req) => (parseBooleanQueryFlag(req?.query?.live) ? 'command_readiness' : '')),
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

        let cacheMaxAgeMs = EV_STATUS_CACHE_MAX_AGE_MS;
        if (String(vehicle?.provider || '').toLowerCase().trim() === 'tesla') {
          const userConfig = !live ? await getTeslaUserConfigSafe(uid, 'command-readiness cache TTL') : null;
          cacheMaxAgeMs = resolveTeslaCommandReadinessCacheMaxAgeMs(userConfig);
        }

        const cached = await getCachedTeslaCommandReadiness(uid, vehicleId).catch(() => null);
        const cacheAudit = buildVehicleStatusCacheAudit(cached, cacheMaxAgeMs, live);
        if (!live && cached && isReusableVehicleCache(cached, vehicle, cacheMaxAgeMs)) {
          return res.json({
            errno: 0,
            result: cached,
            source: 'cache',
            audit: {
              ...cacheAudit,
              routeName: 'command_readiness',
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
            action: 'command_readiness',
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
            error: String(usageDecision.error || 'Tesla command-readiness request blocked by usage guard'),
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
            error: 'Tesla command-readiness is temporarily paused to protect API budget',
            result: {
              degraded: true,
              reasonCode: usageDecision.reasonCode || 'degraded_mode'
            }
          });
        }

        const readinessAudit = createTeslaApiAuditTracker({
          uid,
          vehicleId,
          routeName: live ? 'command_readiness_live' : 'command_readiness'
        });
        const persistCredentials = buildPersistCredentialsFn({
          uid,
          vehicleId,
          vehicle,
          credentials
        });
        const { readiness, deduped } = await dedupeTeslaCommandReadinessFetch(uid, vehicleId, async () => (
          fetchTeslaCommandReadinessLive({
            uid,
            vehicleId,
            vehicle,
            credentials,
            evAdapter,
            recordTeslaApiCall: readinessAudit.recordTeslaApiCall,
            persistCredentials
          })
        ));

        return res.json({
          errno: 0,
          result: readiness,
          source: deduped ? 'live_deduped' : 'live',
          audit: {
            ...cacheAudit,
            ...readinessAudit.snapshot(),
            deduped
          }
        });
      } catch (err) {
        const cachedFallback = await getCachedTeslaCommandReadiness(uid, vehicleId).catch(() => null);

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
            error: 'Tesla command-readiness rate limit reached. Please retry shortly.',
            result: {
              reasonCode: 'provider_rate_limited',
              retryAfterSeconds
            }
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

        if (isTeslaPermissionDeniedError(err)) {
          if (cachedFallback) {
            return res.json({
              errno: 0,
              result: cachedFallback,
              source: 'cache_permission_denied',
              actionRequired: true,
              reasonCode: 'tesla_permission_denied'
            });
          }
          return res.status(403).json({
            errno: 403,
            error: 'Tesla denied command-readiness access for this vehicle. Confirm your Tesla app permissions and vehicle approval, then reconnect Tesla in Settings.',
            result: {
              reasonCode: 'tesla_permission_denied'
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
            error: 'Tesla command-readiness service is temporarily unavailable.',
            result: {
              degraded: true,
              reasonCode: 'tesla_upstream_unavailable',
              retryAfterSeconds
            }
          });
        }

        return res.status(500).json({ errno: 500, error: err.message });
      }
    }
  );

  app.post(
    '/api/ev/vehicles/:vehicleId/wake',
    authenticateUser,
    createTeslaUsageGuardMiddleware(() => 'wake'),
    async (req, res) => {
      const uid = req.user.uid;
      const { vehicleId } = req.params;
      let vehicle = null;

      try {
        vehicle = req.evVehicle || await vehiclesRepo.getVehicle(uid, vehicleId);
        if (!vehicle) {
          return res.status(404).json({ errno: 404, error: 'Vehicle not found' });
        }

        const evAdapter = adapterRegistry.getEVProvider(vehicle.provider);
        if (!evAdapter) {
          return res.status(400).json({ errno: 400, error: `No EV provider registered for '${vehicle.provider}'` });
        }
        if (typeof evAdapter.supportsWake === 'function' && evAdapter.supportsWake() !== true) {
          return res.status(501).json({ errno: 501, error: 'Manual wake is not supported for this EV provider' });
        }

        const credentials = await vehiclesRepo.getVehicleCredentials(uid, vehicleId);
        if (!credentials || !credentials.accessToken) {
          return res.status(400).json({ errno: 400, error: 'Vehicle credentials not configured' });
        }

        const cooldown = claimTeslaWakeExecution(uid, vehicleId);
        if (!cooldown.allowed) {
          res.set('Retry-After', String(cooldown.retryAfterSeconds));
          return res.status(429).json({
            errno: 429,
            error: 'Tesla wake cooldown in effect. Retry shortly.',
            result: {
              reasonCode: 'wake_cooldown_active',
              retryAfterSeconds: cooldown.retryAfterSeconds
            }
          });
        }

        const teslaVehicleContext = resolveTeslaVehicleContext(vehicleId, vehicle, credentials);
        const teslaApiAudit = createTeslaApiAuditTracker({
          uid,
          vehicleId,
          routeName: 'wake_vehicle'
        });

        const result = await evAdapter.wakeVehicle(vehicleId, {
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

        return res.json({
          errno: 0,
          result: {
            accepted: result?.accepted !== false,
            command: 'wakeVehicle',
            provider: 'tesla',
            vehicleId,
            transport: result?.transport || 'direct',
            status: result?.status || 'requested',
            wakeState: String(result?.wakeState || result?.status || 'requested'),
            asOfIso: result?.asOfIso || new Date().toISOString()
          },
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
              error: 'Tesla wake rate limit reached. Please retry shortly.',
              result: {
                reasonCode: 'wake_rate_limited',
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

          if (isTeslaPermissionDeniedError(err)) {
            return res.status(403).json({
              errno: 403,
              error: 'Tesla denied command-readiness access for this vehicle. Confirm your Tesla app permissions and vehicle approval, then reconnect Tesla in Settings.',
              result: {
                reasonCode: 'tesla_permission_denied'
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
              error: 'Tesla wake service is temporarily unavailable.',
              result: {
                reasonCode: 'tesla_wake_unavailable',
                retryAfterSeconds
              }
            });
          }
        }

        return res.status(500).json({ errno: 500, error: String(err?.message || 'Tesla wake failed') });
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
          ? await fetchTeslaCommandReadinessLive({
            uid,
            vehicleId,
            vehicle,
            credentials,
            evAdapter,
            recordTeslaApiCall: teslaApiAudit.recordTeslaApiCall,
            persistCredentials: baseContext.persistCredentials
          })
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

        if (readiness?.state === 'oauth_scope_upgrade_required') {
          return res.status(403).json({
            errno: 403,
            error: 'Tesla charging commands require the Tesla vehicle_cmds permission for this vehicle. Reconnect Tesla in Settings and approve command access again.',
            result: {
              reasonCode: readiness.reasonCode || 'tesla_vehicle_cmds_scope_required',
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

          if (isTeslaPermissionDeniedError(err)) {
            return res.status(403).json({
              errno: 403,
              error: 'Tesla denied this charging command. Confirm your Tesla app permissions and vehicle approval, then reconnect Tesla in Settings.',
              result: {
                reasonCode: 'tesla_permission_denied'
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

  // ── Shared Tesla App Config ──────────────────────────────────────────────

  const TESLA_APP_CONFIG_DOC = 'shared/teslaAppConfig';
  const TESLA_APP_SECRET_DOC = 'sharedPrivate/teslaAppSecret';

  async function getSharedTeslaAppConfig() {
    if (!db) return null;
    try {
      const doc = await db.doc(TESLA_APP_CONFIG_DOC).get();
      return doc.exists ? doc.data() : null;
    } catch (err) {
      logger.warn?.('[EV] Failed to read shared Tesla app config:', err.message || err);
      return null;
    }
  }

  async function getSharedTeslaAppSecret() {
    if (!db) return '';
    try {
      const doc = await db.doc(TESLA_APP_SECRET_DOC).get();
      if (doc.exists) {
        const secret = String(doc.data()?.clientSecret || '').trim();
        if (secret) return secret;
      }

      const legacyConfig = await getSharedTeslaAppConfig();
      return String(legacyConfig?.clientSecret || '').trim();
    } catch (err) {
      logger.warn?.('[EV] Failed to read shared Tesla app secret:', err.message || err);
      return '';
    }
  }

  async function getSharedTeslaAppCredentials() {
    const config = await getSharedTeslaAppConfig();
    if (!config) {
      return null;
    }

    const clientSecret = await getSharedTeslaAppSecret();
    return {
      ...config,
      ...(clientSecret ? { clientSecret } : {})
    };
  }

  /**
   * GET /api/ev/tesla-app-config
   * Returns the shared Tesla Fleet app clientId and domain registration status.
   * Available to any authenticated user.
   */
  app.get('/api/ev/tesla-app-config', authenticateUser, async (req, res) => {
    try {
      const config = await getSharedTeslaAppConfig();
      if (!config || !config.clientId) {
        return res.json({
          errno: 0,
          result: { configured: false }
        });
      }
      return res.json({
        errno: 0,
        result: {
          configured: true,
          clientId: config.clientId,
          domain: config.domain || '',
          domainRegistered: config.domainRegistered === true
        }
      });
    } catch (err) {
      return res.status(500).json({ errno: 500, error: err.message });
    }
  });

  /**
   * POST /api/ev/tesla-app-config
  * Admin-only: save the shared Tesla Fleet app configuration.
   * Body: { clientId, clientSecret, domain? }
   */
  if (requireAdmin && db) {
    app.post('/api/ev/tesla-app-config', authenticateUser, requireAdmin, async (req, res) => {
      const { clientId, clientSecret, domain } = req.body || {};
      if (!clientId) {
        return res.status(400).json({ errno: 400, error: 'clientId is required' });
      }
      try {
        const payload = {
          clientId: String(clientId).trim(),
          updatedAt: new Date().toISOString(),
          updatedBy: req.user.uid
        };
        if (domain) {
          payload.domain = String(domain).trim().toLowerCase();
        }
        if (clientSecret && deleteField) {
          payload.clientSecret = deleteField();
        }
        await db.doc(TESLA_APP_CONFIG_DOC).set(payload, { merge: true });
        if (clientSecret) {
          await db.doc(TESLA_APP_SECRET_DOC).set({
            clientSecret: String(clientSecret).trim(),
            updatedAt: payload.updatedAt,
            updatedBy: req.user.uid
          }, { merge: true });
        }
        logger.info?.('[EV] Shared Tesla app config updated', { uid: req.user.uid, domain: payload.domain });
        return res.json({
          errno: 0,
          result: { saved: true, clientId: payload.clientId, domain: payload.domain || '' }
        });
      } catch (err) {
        return res.status(500).json({ errno: 500, error: err.message });
      }
    });
  }

  // ── OAuth2 ────────────────────────────────────────────────────────────────

  /**
   * GET /api/ev/oauth/start
   * Begin Tesla OAuth2 PKCE flow.
   * Query: { clientId, redirectUri, codeChallenge, region?, state? }
   */
  app.get('/api/ev/oauth/start', authenticateUser, async (req, res) => {
    let { clientId, redirectUri, codeChallenge, region, state } = req.query;
    // Fall back to shared Tesla app clientId if not provided
    if (!clientId) {
      const shared = await getSharedTeslaAppConfig();
      if (shared?.clientId) clientId = shared.clientId;
    }
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
   * POST /api/ev/partner/check-domain-access
   * Check whether the Tesla Fleet app credentials have access to the partner domain.
   * Body: { clientId?, clientSecret?, redirectUri?, domain?, region? }
   */
  app.post('/api/ev/partner/check-domain-access', authenticateUser, async (req, res) => {
    let { clientId, clientSecret, redirectUri, domain, region } = req.body || {};

    if (!clientId || !clientSecret) {
      const shared = await getSharedTeslaAppCredentials();
      if (shared) {
        if (!clientId && shared.clientId) clientId = shared.clientId;
        if (!clientSecret && shared.clientSecret) clientSecret = shared.clientSecret;
        if (!domain && shared.domain) domain = shared.domain;
      }
    }

    if (!clientId || !clientSecret || (!redirectUri && !domain)) {
      return res.status(400).json({
        errno: 400,
        error: 'clientId, clientSecret, and redirectUri (or domain) are required'
      });
    }

    try {
      const resolvedDomain = deriveTeslaPartnerDomain({ domain, redirectUri });
      const result = await getTeslaPartnerDomainPublicKey(
        {
          clientId,
          clientSecret,
          domain: resolvedDomain,
          region: region || 'na'
        },
        teslaHttpClient || createTeslaHttpClient()
      );

      return res.json({
        errno: 0,
        result: {
          accessible: true,
          domain: resolvedDomain,
          region: region || 'na',
          publicKeyPresent: Boolean(String(result?.publicKey || '').trim())
        }
      });
    } catch (err) {
      const resolvedDomain = deriveTeslaPartnerDomain({ domain, redirectUri });
      if (isTeslaPartnerDomainAccessDenied(err)) {
        return res.json({
          errno: 0,
          result: {
            accessible: false,
            domain: resolvedDomain,
            region: region || 'na',
            reasonCode: 'tesla_partner_domain_access_denied',
            error: extractErrorMessage(err) || 'This Tesla Fleet app does not have access to the domain'
          }
        });
      }

      return res.json({
        errno: 0,
        result: {
          accessible: false,
          domain: resolvedDomain,
          region: region || 'na',
          reasonCode: 'tesla_partner_domain_lookup_failed',
          error: extractErrorMessage(err) || err.message || 'Tesla partner domain lookup failed'
        }
      });
    }
  });

  /**
   * POST /api/ev/partner/register-domain
   * Register the Tesla Fleet app domain for virtual-key pairing.
   * Body: { clientId?, clientSecret?, redirectUri?, domain?, region? }
   */
  app.post('/api/ev/partner/register-domain', authenticateUser, async (req, res) => {
    let { clientId, clientSecret, redirectUri, domain, region } = req.body || {};

    if (!clientId || !clientSecret) {
      const shared = await getSharedTeslaAppCredentials();
      if (shared) {
        if (!clientId && shared.clientId) clientId = shared.clientId;
        if (!clientSecret && shared.clientSecret) clientSecret = shared.clientSecret;
        if (!domain && shared.domain) domain = shared.domain;
      }
    }

    if (!clientId || !clientSecret || (!redirectUri && !domain)) {
      return res.status(400).json({
        errno: 400,
        error: 'clientId, clientSecret, and redirectUri (or domain) are required'
      });
    }

    try {
      const resolvedDomain = deriveTeslaPartnerDomain({ domain, redirectUri });
      if (!resolvedDomain) {
        return res.status(400).json({ errno: 400, error: 'Unable to determine Tesla partner domain' });
      }

      const partnerClient = teslaHttpClient || createTeslaHttpClient();

      const result = await registerTeslaPartnerDomain(
        {
          clientId,
          clientSecret,
          domain: resolvedDomain,
          region: region || 'na'
        },
        partnerClient
      );

      // Persist domainRegistered flag in shared Tesla app config
      if (db) {
        try {
          await db.doc(TESLA_APP_CONFIG_DOC).set(
            { domain: resolvedDomain, domainRegistered: true, domainRegisteredAt: new Date().toISOString() },
            { merge: true }
          );
        } catch (persistErr) {
          logger.warn?.('[EV] Failed to persist domain registration status:', persistErr.message || persistErr);
        }
      }

      return res.json({
        errno: 0,
        result: {
          ...result,
          alreadyRegistered: false
        }
      });
    } catch (err) {
      if (isTeslaPartnerPublicKeyConflict(err)) {
        const resolvedDomain = deriveTeslaPartnerDomain({ domain, redirectUri });
        const alreadyRegistered = await verifyTeslaPartnerDomainAlreadyRegistered({
          clientId,
          clientSecret,
          domain: resolvedDomain,
          region: region || 'na'
        });

        if (alreadyRegistered) {
          return res.json({
            errno: 0,
            result: {
              registered: true,
              alreadyRegistered: true,
              verificationState: 'verified',
              domain: resolvedDomain,
              region: region || 'na'
            }
          });
        }

        logger.warn(`Tesla partner registration conflict treated as already registered: ${JSON.stringify({
          domain: resolvedDomain,
          region: region || 'na',
          reason: 'public_key_hash_taken_unverified'
        })}`);

        return res.json({
          errno: 0,
          result: {
            registered: true,
            alreadyRegistered: true,
            verificationState: 'unverified_conflict',
            domain: resolvedDomain,
            region: region || 'na'
          }
        });
      }
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
      redirectUri,
      code,
      codeVerifier,
      region
    } = req.body || {};
    let { clientId, clientSecret } = req.body || {};
    const requestedVin = normalizeTeslaVin(vin || vehicleId);
    const requestedVehicleKey = String(vehicleId || '').trim();

    // Fall back to shared Tesla app credentials when not supplied by the user
    if (!clientId || !clientSecret) {
      const shared = await getSharedTeslaAppCredentials();
      if (shared) {
        if (!clientId && shared.clientId) clientId = shared.clientId;
        if (!clientSecret && shared.clientSecret) clientSecret = shared.clientSecret;
      }
    }

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
      const existingCredentials = typeof vehiclesRepo.getVehicleCredentials === 'function'
        ? await vehiclesRepo.getVehicleCredentials(uid, resolvedVehicleId).catch(() => vehicle?.credentials || null)
        : (vehicle?.credentials || null);
      const storedCredentials = {
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
      };
      await vehiclesRepo.setVehicleCredentials(uid, resolvedVehicleId, storedCredentials);
      await syncTeslaCredentialsAcrossMatchingVehicles({
        uid,
        sourceVehicleId: resolvedVehicleId,
        sourceVehicle: vehicle,
        sourceBaseCredentials: existingCredentials,
        sharedCredentialPatch: extractSharedTeslaCredentialFields(storedCredentials, vehicle)
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
