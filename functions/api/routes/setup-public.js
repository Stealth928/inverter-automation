'use strict';

function registerSetupPublicRoutes(app, deps = {}) {
  const db = deps.db;
  const foxessAPI = deps.foxessAPI;
  // sungrowAPI is optional — only required when Sungrow credentials are submitted
  const sungrowAPI = deps.sungrowAPI || null;
  const getConfig = deps.getConfig;
  const getUserConfig = deps.getUserConfig;
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
        // Sungrow credentials (mutually exclusive with foxess_token / device_sn)
        sungrow_username, sungrow_password, sungrow_device_sn
      } = req.body;
      const errors = {};
      const failed_keys = [];

      // In local emulator mode, skip real API checks and accept any non-empty credentials.
      const isEmulator = !!(
        process.env.FUNCTIONS_EMULATOR ||
        process.env.FIRESTORE_EMULATOR_HOST
      );

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
          const configData = {
            sungrowUsername: sungrow_username,
            sungrowPassword: sungrow_password,
            sungrowDeviceSn: sungrow_device_sn,
            deviceProvider: 'sungrow',
            amberApiKey: amber_api_key || '',
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
          if (req.user?.uid) {
            await setUserConfig(req.user.uid, configData, { merge: true });
            logger.info('Validation', `Sungrow config saved for user ${req.user.uid}`, true);
          } else {
            await db.collection('shared').doc('serverConfig').set(configData, { merge: true });
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
          amberApiKey: amber_api_key || '',
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
        const userConfig = await getUserConfig(req.user.uid);
        const setupComplete = !!(
          (userConfig?.setupComplete === true) ||
          (userConfig?.deviceSn && userConfig?.foxessToken) ||
          (userConfig?.sungrowDeviceSn && userConfig?.sungrowUsername)
        );

        const config = {
          automation: {
            intervalMs: (userConfig?.automation?.intervalMs) || serverConfig.automation.intervalMs
          },
          cache: {
            amber: (userConfig?.cache?.amber) || serverConfig.automation.cacheTtl.amber,
            inverter: (userConfig?.automation?.inverterCacheTtlMs) || serverConfig.automation.cacheTtl.inverter,
            weather: (userConfig?.cache?.weather) || serverConfig.automation.cacheTtl.weather
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
            hasSungrowUsername: !!userConfig?.sungrowUsername,
            hasSungrowDeviceSn: !!userConfig?.sungrowDeviceSn,
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
          const setupComplete = !!(
            (cfg.setupComplete && cfg.deviceSn && cfg.foxessToken) ||
            (cfg.setupComplete && cfg.sungrowDeviceSn && cfg.sungrowUsername)
          );
          const config = {
            automation: { intervalMs: serverConfig.automation.intervalMs },
            cache: serverConfig.automation.cacheTtl,
            defaults: { cooldownMinutes: 5, durationMinutes: 30 }
          };

          return res.json({
            errno: 0,
            result: {
              setupComplete,
              deviceProvider: cfg.deviceProvider || 'foxess',
              hasDeviceSn: !!cfg.deviceSn,
              hasFoxessToken: !!cfg.foxessToken,
              hasSungrowUsername: !!cfg.sungrowUsername,
              hasSungrowDeviceSn: !!cfg.sungrowDeviceSn,
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
        cache: serverConfig.automation.cacheTtl,
        defaults: { cooldownMinutes: 5, durationMinutes: 30 }
      };

      res.json({
        errno: 0,
        result: {
          setupComplete: false,
          deviceProvider: 'foxess',
          hasDeviceSn: false,
          hasFoxessToken: false,
          hasSungrowUsername: false,
          hasSungrowDeviceSn: false,
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
