'use strict';

const {
  DEFAULT_PRICING_PROVIDER,
  PRICING_PROVIDER_AEMO,
  PRICING_PROVIDER_AMBER,
  normalizePricingSelectionInput
} = require('../../lib/pricing-market');

const TESLA_STATUS_CACHE_MIN_MS = 120000;
const TESLA_STATUS_CACHE_MAX_MS = 10000000;
const TESLA_STATUS_CACHE_DEFAULT_MS = 600000;

function resolveTeslaStatusCacheMs(userConfig, serverConfig) {
  const serverDefaultRaw = Number(serverConfig?.automation?.cacheTtl?.teslaStatus);
  const serverDefault = Number.isFinite(serverDefaultRaw)
    ? Math.round(serverDefaultRaw)
    : TESLA_STATUS_CACHE_DEFAULT_MS;
  const fallback = Math.min(TESLA_STATUS_CACHE_MAX_MS, Math.max(TESLA_STATUS_CACHE_MIN_MS, serverDefault));
  const userValue = Number(userConfig?.cache?.teslaStatus);
  if (!Number.isFinite(userValue)) return fallback;
  const rounded = Math.round(userValue);
  return Math.min(TESLA_STATUS_CACHE_MAX_MS, Math.max(TESLA_STATUS_CACHE_MIN_MS, rounded));
}

function buildSetupPricingConfig(payload = {}) {
  const normalizedSelection = normalizePricingSelectionInput(payload);
  const pricingProvider = normalizedSelection.pricingProvider;

  if (pricingProvider === PRICING_PROVIDER_AEMO) {
    return {
      market: normalizedSelection.market,
      pricingProvider,
      amberApiKey: '',
      amberSiteId: '',
      aemoRegion: normalizedSelection.aemoRegion,
      siteIdOrRegion: normalizedSelection.siteIdOrRegion
    };
  }

  if (pricingProvider !== PRICING_PROVIDER_AMBER) {
    return {
      market: normalizedSelection.market,
      pricingProvider,
      amberApiKey: '',
      amberSiteId: '',
      aemoRegion: '',
      siteIdOrRegion: normalizedSelection.siteIdOrRegion || ''
    };
  }

  return {
    market: normalizedSelection.market,
    pricingProvider: DEFAULT_PRICING_PROVIDER,
    amberApiKey: String(payload.amber_api_key || '').trim(),
    amberSiteId: '',
    aemoRegion: '',
    siteIdOrRegion: ''
  };
}

function registerSetupPublicRoutes(app, deps = {}) {
  const db = deps.db;
  const foxessAPI = deps.foxessAPI;
  // alphaEssAPI is optional — only required when AlphaESS credentials are submitted
  const alphaEssAPI = deps.alphaEssAPI || null;
  // sungrowAPI is optional — only required when Sungrow credentials are submitted
  const sungrowAPI = deps.sungrowAPI || null;
  // sigenEnergyAPI is optional — only required when SigenEnergy credentials are submitted
  const sigenEnergyAPI = deps.sigenEnergyAPI || null;
  const getConfig = deps.getConfig;
  const getUserConfig = deps.getUserConfig;
  const getUserConfigPublic = deps.getUserConfigPublic || deps.getUserConfig;
  const logger = deps.logger;
  const serverTimestamp = deps.serverTimestamp;
  const setUserConfig = deps.setUserConfig;
  const tryAttachUser = deps.tryAttachUser;

  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function') {
    throw new Error('registerSetupPublicRoutes requires an Express app');
  }
  if (!db || typeof db.collection !== 'function') {
    throw new Error('registerSetupPublicRoutes requires Firestore db');
  }
  if (!foxessAPI || typeof foxessAPI.callFoxESSAPI !== 'function') {
    throw new Error('registerSetupPublicRoutes requires foxessAPI.callFoxESSAPI()');
  }
  if (typeof getConfig !== 'function') {
    throw new Error('registerSetupPublicRoutes requires getConfig()');
  }
  if (typeof getUserConfig !== 'function') {
    throw new Error('registerSetupPublicRoutes requires getUserConfig()');
  }
  if (typeof getUserConfigPublic !== 'function') {
    throw new Error('registerSetupPublicRoutes requires getUserConfigPublic()');
  }
  if (!logger || typeof logger.info !== 'function') {
    throw new Error('registerSetupPublicRoutes requires logger.info()');
  }
  if (typeof serverTimestamp !== 'function') {
    throw new Error('registerSetupPublicRoutes requires serverTimestamp()');
  }
  if (typeof setUserConfig !== 'function') {
    throw new Error('registerSetupPublicRoutes requires setUserConfig()');
  }
  if (typeof tryAttachUser !== 'function') {
    throw new Error('registerSetupPublicRoutes requires tryAttachUser()');
  }

  // Password reset (no auth required)
  app.post('/api/auth/forgot-password', async (req, res) => {
    try {
      const { email } = req.body;

      if (!email || !email.trim()) {
        return res.status(400).json({ errno: 400, error: 'Email is required' });
      }

      logger.info('Auth', `Password reset requested for: ${email}`, true);
      res.json({
        errno: 0,
        msg: 'If this email exists, a password reset link has been sent. Please check your email.'
      });
    } catch (error) {
      console.error('[Auth] Password reset error:', error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });

  // Validate API credentials during setup (no auth required for initial validation)
  app.post('/api/config/validate-keys', async (req, res) => {
    try {
      await tryAttachUser(req);
      const {
        device_sn, foxess_token, amber_api_key, weather_place,
        // AlphaESS credentials
        alphaess_system_sn, alphaess_app_id, alphaess_app_secret,
        // Sungrow credentials (mutually exclusive with foxess_token / device_sn)
        sungrow_username, sungrow_password, sungrow_device_sn,
        // SigenEnergy credentials
        sigenergy_username, sigenergy_password, sigenergy_region,
        pricing_provider, aemo_region
      } = req.body;
      const errors = {};
      const failed_keys = [];
      const pricingConfig = buildSetupPricingConfig({
        amber_api_key,
        pricing_provider,
        aemo_region
      });

      // In local emulator mode, skip real API checks and accept any non-empty credentials.
      const isEmulator = !!(
        process.env.FUNCTIONS_EMULATOR ||
        process.env.FIRESTORE_EMULATOR_HOST
      );

      // ── SigenEnergy credential validation ──────────────────────────────────
      // AlphaESS credential validation
      const isAlphaEssSetup = !!(alphaess_system_sn || alphaess_app_id || alphaess_app_secret);

      if (isAlphaEssSetup) {
        if (!alphaess_system_sn) {
          failed_keys.push('alphaess_system_sn');
          errors.alphaess_system_sn = 'AlphaESS system SN is required';
        }
        if (!alphaess_app_id) {
          failed_keys.push('alphaess_app_id');
          errors.alphaess_app_id = 'AlphaESS App ID is required';
        }
        if (!alphaess_app_secret) {
          failed_keys.push('alphaess_app_secret');
          errors.alphaess_app_secret = 'AlphaESS App Secret is required';
        }

        if (failed_keys.length === 0 && alphaEssAPI) {
          if (isEmulator) {
            logger.info('Validation', 'Emulator mode: skipping live AlphaESS API check', true);
          } else {
            logger.info('Validation', 'Testing AlphaESS credentials', true);
            const testConfig = {
              alphaessSystemSn: alphaess_system_sn,
              alphaessAppId: alphaess_app_id,
              alphaessAppSecret: alphaess_app_secret
            };
            const listResult = await alphaEssAPI.listSystems(testConfig, null);

            if (listResult.errno !== 0) {
              failed_keys.push('alphaess_app_id');
              errors.alphaess_app_id = listResult.error || 'AlphaESS credentials are invalid or not authorized';
            } else {
              const systems = Array.isArray(listResult.result) ? listResult.result : [];
              if (systems.length === 0) {
                failed_keys.push('alphaess_system_sn');
                errors.alphaess_system_sn = 'No systems found for this AlphaESS app. Verify the app has access to at least one system.';
              } else {
                const found = systems.some((item) => String(item?.sysSn || '').trim() === String(alphaess_system_sn).trim());
                if (!found) {
                  failed_keys.push('alphaess_system_sn');
                  const known = systems.map((item) => item?.sysSn).filter(Boolean);
                  errors.alphaess_system_sn = `System SN not found in your app scope. Found: ${known.join(', ')}`;
                }
              }
            }
          }
        } else if (failed_keys.length === 0 && !alphaEssAPI) {
          failed_keys.push('alphaess_app_id');
          errors.alphaess_app_id = 'AlphaESS module not initialized on server';
        }

        if (failed_keys.length === 0) {
          const configData = {
            alphaessSystemSn: alphaess_system_sn,
            alphaessAppId: alphaess_app_id,
            deviceProvider: 'alphaess',
            ...pricingConfig,
            location: weather_place || 'Sydney',
            inverterCapacityW: (typeof req.body.inverter_capacity_w === 'number' && req.body.inverter_capacity_w > 0)
              ? Math.round(req.body.inverter_capacity_w)
              : 5000,
            batteryCapacityKWh: (typeof req.body.battery_capacity_kwh === 'number' && req.body.battery_capacity_kwh > 0)
              ? req.body.battery_capacity_kwh
              : 9.6,
            setupComplete: true,
            updatedAt: serverTimestamp()
          };
          const credentialsData = {
            alphaessAppSecret: alphaess_app_secret,
            updatedAt: serverTimestamp()
          };

          if (req.user?.uid) {
            await Promise.all([
              setUserConfig(req.user.uid, configData, { merge: true }),
              db.collection('users').doc(req.user.uid).collection('secrets').doc('credentials')
                .set(credentialsData, { merge: true })
            ]);
            logger.info('Validation', `AlphaESS config saved for user ${req.user.uid}`, true);
          } else {
            await Promise.all([
              db.collection('shared').doc('serverConfig').set(configData, { merge: true }),
              db.collection('shared').doc('serverCredentials').set(credentialsData, { merge: true })
            ]);
          }
        }

        if (failed_keys.length > 0) {
          return res.status(400).json({
            errno: 1,
            msg: `Validation failed for: ${failed_keys.join(', ')}`,
            failed_keys,
            errors
          });
        }

        return res.json({
          errno: 0,
          msg: 'AlphaESS credentials validated successfully',
          result: { systemSn: alphaess_system_sn, provider: 'alphaess' }
        });
      }

      const isSigenEnergySetup = !!(sigenergy_username || sigenergy_password);

      if (isSigenEnergySetup) {
        if (!sigenergy_username) { failed_keys.push('sigenergy_username'); errors.sigenergy_username = 'SigenEnergy account email is required'; }
        if (!sigenergy_password) { failed_keys.push('sigenergy_password'); errors.sigenergy_password = 'SigenEnergy account password is required'; }

        let sigenLoginResult = null; // captures live login result for stationId/deviceSn extraction
        if (failed_keys.length === 0 && sigenEnergyAPI) {
          if (isEmulator) {
            logger.info('Validation', 'Emulator mode: skipping live SigenEnergy API check', true);
          } else {
            logger.info('Validation', 'Testing SigenEnergy credentials', true);
            const region = sigenergy_region || 'apac';
            const testConfig = { sigenUsername: sigenergy_username, sigenPassword: sigenergy_password, sigenRegion: region };
            sigenLoginResult = await sigenEnergyAPI.loginSigenergy(testConfig, null, null);

            if (sigenLoginResult.errno !== 0) {
              failed_keys.push('sigenergy_username');
              const msg = sigenLoginResult.error || '';
              if (sigenLoginResult.errno === 3402) {
                errors.sigenergy_username = 'Invalid SigenEnergy username or password. Check your credentials at the SigenEnergy app.';
              } else {
                errors.sigenergy_username = `SigenEnergy login failed: ${msg || 'unknown error'}`;
              }
            }
          }
        }

        if (failed_keys.length === 0) {
          const region = sigenergy_region || 'apac';
          const stationIdRaw = sigenLoginResult?.result?.stationId;
          const stationId = stationIdRaw === null || stationIdRaw === undefined
            ? ''
            : String(stationIdRaw).trim();
          const sigenDeviceSn = String(
            sigenLoginResult?.result?.dcSnList?.[0] || sigenLoginResult?.result?.acSnList?.[0] || ''
          ).trim();
          // Non-sensitive config — stored in the readable config doc
          const configData = {
            sigenUsername:  sigenergy_username,
            sigenRegion:    region,
            sigenStationId: stationId,
            sigenDeviceSn,
            deviceProvider: 'sigenergy',
            ...pricingConfig,
            location:       weather_place || 'Sydney',
            inverterCapacityW: (typeof req.body.inverter_capacity_w === 'number' && req.body.inverter_capacity_w > 0)
              ? Math.round(req.body.inverter_capacity_w)
              : 5000,
            batteryCapacityKWh: (typeof req.body.battery_capacity_kwh === 'number' && req.body.battery_capacity_kwh > 0)
              ? req.body.battery_capacity_kwh
              : 9.6,
            setupComplete: true,
            updatedAt: serverTimestamp()
          };
          // Password stored separately — clients can write but never read back (Firestore rules)
          const credentialsData = { sigenPassword: sigenergy_password, updatedAt: serverTimestamp() };
          if (req.user?.uid) {
            await Promise.all([
              setUserConfig(req.user.uid, configData, { merge: true }),
              db.collection('users').doc(req.user.uid).collection('secrets').doc('credentials')
                .set(credentialsData, { merge: true })
            ]);
            logger.info('Validation', `SigenEnergy config saved for user ${req.user.uid}`, true);
          } else {
            await Promise.all([
              db.collection('shared').doc('serverConfig').set(configData, { merge: true }),
              db.collection('shared').doc('serverCredentials').set(credentialsData, { merge: true })
            ]);
          }
        }

        if (failed_keys.length > 0) {
          return res.status(400).json({ errno: 1, msg: `Validation failed for: ${failed_keys.join(', ')}`, failed_keys, errors });
        }
        return res.json({ errno: 0, msg: 'SigenEnergy credentials validated successfully', result: { region: sigenergy_region || 'apac', provider: 'sigenergy' } });
      }

      // ── Sungrow credential validation ─────────────────────────────────────
      const isSungrowSetup = !!(sungrow_username || sungrow_password || sungrow_device_sn);

      if (isSungrowSetup) {
        if (!sungrow_username) { failed_keys.push('sungrow_username'); errors.sungrow_username = 'iSolarCloud account email is required'; }
        if (!sungrow_password) { failed_keys.push('sungrow_password'); errors.sungrow_password = 'iSolarCloud account password is required'; }
        if (!sungrow_device_sn) { failed_keys.push('sungrow_device_sn'); errors.sungrow_device_sn = 'Sungrow inverter serial number is required'; }

        if (failed_keys.length === 0 && sungrowAPI) {
          if (isEmulator) {
            logger.info('Validation', 'Emulator mode: skipping live Sungrow API check', true);
          } else {
            logger.info('Validation', 'Testing Sungrow credentials', true);
            const testConfig = { sungrowUsername: sungrow_username, sungrowPassword: sungrow_password };
            const loginResult = await sungrowAPI.loginSungrow(testConfig, null, null);

            if (loginResult.errno !== 0) {
              failed_keys.push('sungrow_username');
              const msg = loginResult.error || '';
              if (msg.toLowerCase().includes('password') || loginResult.errno === 3302) {
                errors.sungrow_username = 'Invalid iSolarCloud username or password. Check your credentials at au.isolarcloud.com.';
              } else {
                errors.sungrow_username = `Sungrow login failed: ${msg || 'unknown error'}`;
              }
            } else {
              // Verify device SN by listing devices associated with the account
              const token = loginResult.result?.token || '';
              const uid = loginResult.result?.uid || '';
              const deviceListResult = await sungrowAPI.callSungrowAPI(
                'queryDeviceListByTokenAndType',
                { device_type: '22' },
                { sungrowUsername: sungrow_username, sungrowPassword: sungrow_password, sungrowToken: token, sungrowUid: uid },
                null
              );
              if (deviceListResult.errno === 0) {
                const deviceList = deviceListResult.result?.list || deviceListResult.result?.device_list || [];
                const found = deviceList.some((d) => (d.sn || d.device_sn || d.serial_number) === sungrow_device_sn);
                if (!found && deviceList.length > 0) {
                  failed_keys.push('sungrow_device_sn');
                  const sns = deviceList.map((d) => d.sn || d.device_sn || d.serial_number).filter(Boolean);
                  errors.sungrow_device_sn = `Serial number not found in your account. Found device(s): ${sns.join(', ')}`;
                }
              }
              // If device list call fails, we still accept the credentials (device SN can be verified manually)
            }
          }
        }

        if (failed_keys.length === 0) {
          // Non-sensitive config — stored in the readable config doc
          const configData = {
            sungrowUsername: sungrow_username,
            sungrowDeviceSn: sungrow_device_sn,
            deviceProvider: 'sungrow',
            ...pricingConfig,
            location: weather_place || 'Sydney',
            inverterCapacityW: (typeof req.body.inverter_capacity_w === 'number' && req.body.inverter_capacity_w > 0)
              ? Math.round(req.body.inverter_capacity_w)
              : 5000,
            batteryCapacityKWh: (typeof req.body.battery_capacity_kwh === 'number' && req.body.battery_capacity_kwh > 0)
              ? req.body.battery_capacity_kwh
              : 9.6,
            setupComplete: true,
            updatedAt: serverTimestamp()
          };
          // Password stored separately — clients can write but never read back (Firestore rules)
          const credentialsData = { sungrowPassword: sungrow_password, updatedAt: serverTimestamp() };
          if (req.user?.uid) {
            await Promise.all([
              setUserConfig(req.user.uid, configData, { merge: true }),
              db.collection('users').doc(req.user.uid).collection('secrets').doc('credentials')
                .set(credentialsData, { merge: true })
            ]);
            logger.info('Validation', `Sungrow config saved for user ${req.user.uid}`, true);
          } else {
            await Promise.all([
              db.collection('shared').doc('serverConfig').set(configData, { merge: true }),
              db.collection('shared').doc('serverCredentials').set(credentialsData, { merge: true })
            ]);
          }
        }

        if (failed_keys.length > 0) {
          return res.status(400).json({ errno: 1, msg: `Validation failed for: ${failed_keys.join(', ')}`, failed_keys, errors });
        }
        return res.json({ errno: 0, msg: 'Sungrow credentials validated successfully', result: { deviceSn: sungrow_device_sn, provider: 'sungrow' } });
      }

      // ── FoxESS credential validation (unchanged) ───────────────────────────
      if (foxess_token && device_sn) {
        if (isEmulator) {
          logger.info('Validation', 'Emulator mode: skipping live FoxESS API check', true);
        } else {
          logger.info('Validation', 'Testing FoxESS token', true);
          const testConfig = { foxessToken: foxess_token, deviceSn: device_sn };
          const foxResult = await foxessAPI.callFoxESSAPI(
            '/op/v0/device/list',
            'POST',
            { currentPage: 1, pageSize: 10 },
            testConfig,
            null
          );

          logger.info(
            'Validation',
            `FoxESS API response: errno=${foxResult?.errno}, devices=${foxResult?.result?.data?.length || 0}`,
            true
          );

          if (!foxResult || foxResult.errno !== 0) {
            failed_keys.push('foxess_token');
            const rawMsg = foxResult?.msg || foxResult?.error || '';
            const rawLower = rawMsg.toLowerCase();
            let tokenErr;
            if (rawLower.includes('error token') || rawLower.includes('invalid') || foxResult?.errno === 40401) {
              tokenErr = 'Invalid or expired API token. Re-copy it from FoxESS Cloud -> User Settings -> API Management.';
            } else if (rawLower.includes('illegal parameter') || rawLower.includes('not bound')) {
              tokenErr = 'API token not authorised for third-party access. In FoxESS Cloud, go to User Settings -> API Management and generate a new token.';
            } else if (rawLower.includes('frequency') || foxResult?.errno === 40402) {
              tokenErr = 'FoxESS rate limit reached. Wait 60 seconds and try again.';
            } else if (rawMsg) {
              tokenErr = rawMsg;
            } else {
              tokenErr = 'Could not verify your FoxESS token. Check it matches exactly what FoxESS Cloud shows.';
            }
            errors.foxess_token = tokenErr;
          } else {
            const devices = foxResult.result?.data || [];
            const deviceFound = devices.some((d) => d.deviceSN === device_sn);
            if (!deviceFound && devices.length > 0) {
              failed_keys.push('device_sn');
              errors.device_sn = `Serial number not found in your account. Your registered device(s): ${devices.map((d) => d.deviceSN).join(', ')} - check the spelling carefully.`;
            } else if (!deviceFound && devices.length === 0) {
              failed_keys.push('foxess_token');
              errors.foxess_token = 'No inverters found on this account. Make sure this token is from the FoxESS account where your inverter is registered.';
            }
          }
        }
      } else {
        if (!device_sn) {
          failed_keys.push('device_sn');
          errors.device_sn = 'Device Serial Number is required';
        }
        if (!foxess_token) {
          failed_keys.push('foxess_token');
          errors.foxess_token = 'FoxESS API Token is required';
        }
      }

      if (failed_keys.length === 0) {
        const configData = {
          deviceSn: device_sn,
          foxessToken: foxess_token,
          ...pricingConfig,
          location: weather_place || 'Sydney',
          inverterCapacityW: (typeof req.body.inverter_capacity_w === 'number' && req.body.inverter_capacity_w > 0)
            ? Math.round(req.body.inverter_capacity_w)
            : 10000,
          batteryCapacityKWh: (typeof req.body.battery_capacity_kwh === 'number' && req.body.battery_capacity_kwh > 0)
            ? req.body.battery_capacity_kwh
            : 41.93,
          setupComplete: true,
          updatedAt: serverTimestamp()
        };

        if (req.user?.uid) {
          await setUserConfig(req.user.uid, configData, { merge: true });
          logger.info('Validation', `Config saved successfully for user ${req.user.uid}`, true);
        } else {
          await db.collection('shared').doc('serverConfig').set(configData, { merge: true });
          logger.info('Validation', 'Config saved to shared serverConfig (unauthenticated setup flow)', true);
        }
      }

      if (failed_keys.length > 0) {
        return res.status(400).json({
          errno: 1,
          msg: `Validation failed for: ${failed_keys.join(', ')}`,
          failed_keys,
          errors
        });
      }

      res.json({ errno: 0, msg: 'Credentials validated successfully', result: { deviceSn: device_sn } });
    } catch (error) {
      console.error('[Validation] Error:', error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });

  // Check if setup is complete (supports both authenticated and shared setup modes)
  app.get('/api/config/setup-status', async (req, res) => {
    try {
      await tryAttachUser(req);
      const serverConfig = getConfig();

      if (req.user?.uid) {
        const [userConfig, secretsDoc] = await Promise.all([
          getUserConfigPublic(req.user.uid),
          db.collection('users').doc(req.user.uid).collection('secrets').doc('credentials')
            .get()
            .catch(() => ({ exists: false, data: () => ({}) }))
        ]);
        const secrets = secretsDoc.exists ? (secretsDoc.data() || {}) : {};
        const hasAlphaEssAppSecret = !!(userConfig?.alphaessAppSecret || secrets?.alphaessAppSecret);
        const setupComplete = !!(
          (userConfig?.deviceSn && userConfig?.foxessToken) ||
          (userConfig?.alphaessSystemSn && userConfig?.alphaessAppId && hasAlphaEssAppSecret) ||
          (userConfig?.sungrowDeviceSn && userConfig?.sungrowUsername) ||
          (userConfig?.sigenUsername)
        );

        const config = {
          automation: {
            intervalMs: (userConfig?.automation?.intervalMs) || serverConfig.automation.intervalMs
          },
          cache: {
            amber: (userConfig?.cache?.amber) || serverConfig.automation.cacheTtl.amber,
            inverter: (userConfig?.automation?.inverterCacheTtlMs) || serverConfig.automation.cacheTtl.inverter,
            weather: (userConfig?.cache?.weather) || serverConfig.automation.cacheTtl.weather,
            teslaStatus: resolveTeslaStatusCacheMs(userConfig, serverConfig)
          },
          defaults: {
            cooldownMinutes: (userConfig?.defaults?.cooldownMinutes) || 5,
            durationMinutes: (userConfig?.defaults?.durationMinutes) || 30
          }
        };

        return res.json({
          errno: 0,
          result: {
            setupComplete,
            deviceProvider: userConfig?.deviceProvider || 'foxess',
            hasDeviceSn: !!userConfig?.deviceSn,
            hasFoxessToken: !!userConfig?.foxessToken,
            hasAlphaEssSystemSn: !!userConfig?.alphaessSystemSn,
            hasAlphaEssAppId: !!userConfig?.alphaessAppId,
            hasAlphaEssAppSecret: hasAlphaEssAppSecret,
            hasSungrowUsername: !!userConfig?.sungrowUsername,
            hasSungrowDeviceSn: !!userConfig?.sungrowDeviceSn,
            hasSigenUsername: !!userConfig?.sigenUsername,
            hasSigenDeviceSn: !!userConfig?.sigenDeviceSn,
            hasAmberKey: !!userConfig?.amberApiKey,
            source: userConfig?._source || 'user',
            config
          }
        });
      }

      try {
        const sharedDoc = await db.collection('shared').doc('serverConfig').get();
        if (sharedDoc.exists) {
          const cfg = sharedDoc.data() || {};
          let sharedCredentials = {};
          try {
            const credsDoc = await db.collection('shared').doc('serverCredentials').get();
            sharedCredentials = credsDoc.exists ? (credsDoc.data() || {}) : {};
          } catch (_sharedCredErr) {
            sharedCredentials = {};
          }
          const hasAlphaEssAppSecret = !!sharedCredentials?.alphaessAppSecret;
          const setupComplete = !!(
            (cfg.deviceSn && cfg.foxessToken) ||
            (cfg.alphaessSystemSn && cfg.alphaessAppId && hasAlphaEssAppSecret) ||
            (cfg.sungrowDeviceSn && cfg.sungrowUsername) ||
            (cfg.sigenUsername)
          );
          const config = {
            automation: { intervalMs: serverConfig.automation.intervalMs },
            cache: {
              amber: serverConfig.automation.cacheTtl.amber,
              inverter: serverConfig.automation.cacheTtl.inverter,
              weather: serverConfig.automation.cacheTtl.weather,
              teslaStatus: resolveTeslaStatusCacheMs(null, serverConfig)
            },
            defaults: { cooldownMinutes: 5, durationMinutes: 30 }
          };

          return res.json({
            errno: 0,
            result: {
              setupComplete,
              deviceProvider: cfg.deviceProvider || 'foxess',
              hasDeviceSn: !!cfg.deviceSn,
              hasFoxessToken: !!cfg.foxessToken,
              hasAlphaEssSystemSn: !!cfg.alphaessSystemSn,
              hasAlphaEssAppId: !!cfg.alphaessAppId,
              hasAlphaEssAppSecret: hasAlphaEssAppSecret,
              hasSungrowUsername: !!cfg.sungrowUsername,
              hasSungrowDeviceSn: !!cfg.sungrowDeviceSn,
              hasSigenUsername: !!cfg.sigenUsername,
              hasSigenDeviceSn: !!cfg.sigenDeviceSn,
              hasAmberKey: !!cfg.amberApiKey,
              source: 'shared',
              config
            }
          });
        }
      } catch (e) {
        console.warn('[Setup Status] Error reading shared server config:', e.message || e);
      }

      const config = {
        automation: { intervalMs: serverConfig.automation.intervalMs },
        cache: {
          amber: serverConfig.automation.cacheTtl.amber,
          inverter: serverConfig.automation.cacheTtl.inverter,
          weather: serverConfig.automation.cacheTtl.weather,
          teslaStatus: resolveTeslaStatusCacheMs(null, serverConfig)
        },
        defaults: { cooldownMinutes: 5, durationMinutes: 30 }
      };

      res.json({
        errno: 0,
        result: {
          setupComplete: false,
          deviceProvider: 'foxess',
          hasDeviceSn: false,
          hasFoxessToken: false,
          hasAlphaEssSystemSn: false,
          hasAlphaEssAppId: false,
          hasAlphaEssAppSecret: false,
          hasSungrowUsername: false,
          hasSungrowDeviceSn: false,
          hasSigenUsername: false,
          hasSigenDeviceSn: false,
          hasAmberKey: false,
          config
        }
      });
    } catch (error) {
      console.error('[Setup Status] Error:', error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });
}

module.exports = {
  registerSetupPublicRoutes
};
