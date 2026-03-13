'use strict';

/**
 * EV (Electric Vehicle) Routes
 *
 * Endpoints for EV vehicle management, status, command issuance, and OAuth flows.
 *
 *   GET    /api/ev/vehicles                           — list registered vehicles
 *   POST   /api/ev/vehicles                           — register a vehicle
 *   DELETE /api/ev/vehicles/:vehicleId                — remove a vehicle
 *   GET    /api/ev/vehicles/:vehicleId/status         — current vehicle status
 *   POST   /api/ev/vehicles/:vehicleId/command        — issue an EV command
 *   GET    /api/ev/oauth/start                        — begin OAuth2 flow
 *   POST   /api/ev/oauth/callback                     — exchange auth code for tokens
 */

const { createEVCommandService } = require('../../lib/services/ev-command-service');
const {
  buildTeslaAuthUrl,
  createTeslaHttpClient,
  exchangeTeslaAuthCode
} = require('../../lib/adapters/tesla-fleet-adapter');

function registerEVRoutes(app, deps = {}) {
  const authenticateUser = deps.authenticateUser;
  const vehiclesRepo = deps.vehiclesRepo;
  const adapterRegistry = deps.adapterRegistry;
  const teslaHttpClient = deps.teslaHttpClient || deps.httpClient || null;

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

  // ── Helper: build command service for a given adapter ────────────────────

  function buildCommandService(evAdapter) {
    return createEVCommandService({ evAdapter, vehiclesRepo, skipWake: false });
  }

  function toPublicVehicleShape(vehicle = {}) {
    const publicFields = { ...(vehicle || {}) };
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

  function buildReadinessErrorMessage(readiness = {}) {
    const reasons = Array.isArray(readiness.blockingReasons) ? readiness.blockingReasons : [];
    if (reasons.includes('signed_command_required')) {
      return 'Tesla signed command setup required before this command can be sent';
    }
    if (reasons.includes('virtual_key_not_paired')) {
      return 'Tesla virtual key must be paired with this vehicle before commands can be sent';
    }
    return 'Vehicle is not ready to accept EV commands';
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
    const { vehicleId, provider, displayName, region } = req.body || {};

    if (!vehicleId || typeof vehicleId !== 'string') {
      return res.status(400).json({ errno: 400, error: 'vehicleId is required' });
    }
    if (!provider || typeof provider !== 'string') {
      return res.status(400).json({ errno: 400, error: 'provider is required' });
    }

    try {
      const vehicle = {
        vehicleId,
        provider,
        displayName: displayName || vehicleId,
        region: region || 'na',
        registeredAtIso: new Date().toISOString()
      };
      await vehiclesRepo.setVehicle(uid, vehicleId, vehicle);
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
  app.get('/api/ev/vehicles/:vehicleId/status', authenticateUser, async (req, res) => {
    const uid = req.user.uid;
    const { vehicleId } = req.params;
    const live = req.query.live === '1' || req.query.live === 'true';

    try {
      const vehicle = await vehiclesRepo.getVehicle(uid, vehicleId);
      if (!vehicle) {
        return res.status(404).json({ errno: 404, error: 'Vehicle not found' });
      }

      if (!live) {
        const cached = await vehiclesRepo.getVehicleState(uid, vehicleId);
        if (cached) {
          return res.json({ errno: 0, result: cached, source: 'cache' });
        }
      }

      const evAdapter = adapterRegistry.getEVProvider(vehicle.provider);
      if (!evAdapter) {
        return res.status(400).json({ errno: 400, error: `No EV provider registered for '${vehicle.provider}'` });
      }

      const credentials = await vehiclesRepo.getVehicleCredentials(uid, vehicleId);
      if (!credentials || !credentials.accessToken) {
        return res.status(400).json({ errno: 400, error: 'Vehicle credentials not configured' });
      }

      const status = await evAdapter.getVehicleStatus(vehicleId, {
        credentials,
        region: vehicle.region || credentials.region || 'na',
        persistCredentials: buildPersistCredentialsFn({
          uid,
          vehicleId,
          vehicle,
          credentials
        })
      });

      // Persist the fresh status
      await vehiclesRepo.saveVehicleState(uid, vehicleId, status);

      return res.json({ errno: 0, result: status, source: 'live' });
    } catch (err) {
      return res.status(500).json({ errno: 500, error: err.message });
    }
  });

  // ── Command issuance ─────────────────────────────────────────────────────

  /**
   * POST /api/ev/vehicles/:vehicleId/command
   * Issue an EV command (startCharging, stopCharging, setChargeLimit).
   * Body: { command: string, commandId?: string, targetSocPct?: number }
   */
  app.post('/api/ev/vehicles/:vehicleId/command', authenticateUser, async (req, res) => {
    const uid = req.user.uid;
    const { vehicleId } = req.params;
    const { command, commandId, targetSocPct } = req.body || {};

    const ALLOWED_COMMANDS = ['startCharging', 'stopCharging', 'setChargeLimit'];
    if (!command || !ALLOWED_COMMANDS.includes(command)) {
      return res.status(400).json({ errno: 400, error: `command must be one of: ${ALLOWED_COMMANDS.join(', ')}` });
    }
    if (command === 'setChargeLimit' && (targetSocPct === undefined || targetSocPct === null)) {
      return res.status(400).json({ errno: 400, error: 'targetSocPct is required for setChargeLimit' });
    }

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
      const cmdService = buildCommandService(evAdapter);
      if (!credentials || !credentials.accessToken) {
        return res.status(400).json({ errno: 400, error: 'Vehicle credentials not configured' });
      }

      const context = {
        credentials,
        region: vehicle.region || credentials.region || 'na',
        persistCredentials: buildPersistCredentialsFn({
          uid,
          vehicleId,
          vehicle,
          credentials
        })
      };
      const options = { commandId };

      if (typeof evAdapter.getCommandReadiness === 'function') {
        try {
          const readiness = await evAdapter.getCommandReadiness(vehicleId, context);
          if (readiness && readiness.readyForCommands === false) {
            return res.status(412).json({
              errno: 412,
              error: buildReadinessErrorMessage(readiness),
              result: { readiness }
            });
          }
        } catch {
          // Readiness check is best-effort only; command path still executes.
        }
      }

      let result;
      if (command === 'startCharging') {
        result = await cmdService.startCharging(uid, vehicleId, context, options);
      } else if (command === 'stopCharging') {
        result = await cmdService.stopCharging(uid, vehicleId, context, options);
      } else {
        result = await cmdService.setChargeLimit(uid, vehicleId, context, targetSocPct, options);
      }

      return res.json({ errno: 0, result });
    } catch (err) {
      if (err.message && err.message.includes('cooldown')) {
        return res.status(429).json({ errno: 429, error: err.message });
      }
      return res.status(500).json({ errno: 500, error: err.message });
    }
  });

  // ── OAuth2 ────────────────────────────────────────────────────────────────

  /**
   * GET /api/ev/oauth/start
   * Begin Tesla OAuth2 PKCE flow.
   * Query: { clientId, redirectUri, codeChallenge, region? }
   */
  app.get('/api/ev/oauth/start', authenticateUser, (req, res) => {
    const { clientId, redirectUri, codeChallenge, region } = req.query;
    if (!clientId || !redirectUri || !codeChallenge) {
      return res.status(400).json({ errno: 400, error: 'clientId, redirectUri, and codeChallenge are required' });
    }
    try {
      const url = buildTeslaAuthUrl({ clientId, redirectUri, codeChallenge }, region || 'na');
      return res.json({ errno: 0, result: { url } });
    } catch (err) {
      return res.status(500).json({ errno: 500, error: err.message });
    }
  });

  /**
   * POST /api/ev/oauth/callback
   * Exchange an authorization code for Tesla tokens and store credentials.
   * Body: { vehicleId, clientId, redirectUri, code, codeVerifier, clientSecret?, region? }
   */
  app.post('/api/ev/oauth/callback', authenticateUser, async (req, res) => {
    const uid = req.user.uid;
    const { vehicleId, clientId, clientSecret, redirectUri, code, codeVerifier, region } = req.body || {};

    if (!vehicleId || !clientId || !redirectUri || !code || !codeVerifier) {
      return res.status(400).json({ errno: 400, error: 'vehicleId, clientId, redirectUri, code, and codeVerifier are required' });
    }

    try {
      const vehicle = await vehiclesRepo.getVehicle(uid, vehicleId);
      if (!vehicle) {
        return res.status(404).json({ errno: 404, error: 'Vehicle not found' });
      }

      const provider = String(vehicle.provider || '').toLowerCase().trim();
      if (provider !== 'tesla') {
        return res.status(400).json({ errno: 400, error: `OAuth callback currently supports tesla provider only (got '${provider || 'unknown'}')` });
      }

      const tokens = await exchangeTeslaAuthCode(
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

      // Store credentials against the vehicle
      await vehiclesRepo.setVehicleCredentials(uid, vehicleId, {
        provider: 'tesla',
        region: region || vehicle.region || 'na',
        clientId,
        ...(clientSecret ? { clientSecret } : {}),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenType: tokens.tokenType || 'Bearer',
        scope: tokens.scope || '',
        expiresAtMs: tokens.expiresAtMs,
        storedAtIso: new Date().toISOString()
      });
      return res.json({ errno: 0, result: { stored: true, vehicleId } });
    } catch (err) {
      return res.status(500).json({ errno: 500, error: err.message });
    }
  });
}

module.exports = { registerEVRoutes };
