'use strict';

const { resolveProviderDeviceId } = require('../../lib/provider-device-id');

function maskDeviceId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length <= 6) return '***';
  return `${raw.slice(0, 3)}***${raw.slice(-3)}`;
}

function registerQuickControlRoutes(app, deps = {}) {
  const addHistoryEntry = deps.addHistoryEntry;
  const addMinutes = deps.addMinutes;
  const authenticateUser = deps.authenticateUser;
  const cleanupExpiredQuickControl = deps.cleanupExpiredQuickControl;
  const foxessAPI = deps.foxessAPI;
  const adapterRegistry = deps.adapterRegistry || null;
  const getAutomationTimezone = deps.getAutomationTimezone;
  const getQuickControlState = deps.getQuickControlState;
  const getUserConfig = deps.getUserConfig;
  const getUserTime = deps.getUserTime;
  const logger = deps.logger;
  const saveQuickControlState = deps.saveQuickControlState;
  const serverTimestamp = deps.serverTimestamp;

  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function') {
    throw new Error('registerQuickControlRoutes requires an Express app');
  }
  if (typeof addHistoryEntry !== 'function') {
    throw new Error('registerQuickControlRoutes requires addHistoryEntry()');
  }
  if (typeof addMinutes !== 'function') {
    throw new Error('registerQuickControlRoutes requires addMinutes()');
  }
  if (typeof authenticateUser !== 'function') {
    throw new Error('registerQuickControlRoutes requires authenticateUser middleware');
  }
  if (typeof cleanupExpiredQuickControl !== 'function') {
    throw new Error('registerQuickControlRoutes requires cleanupExpiredQuickControl()');
  }
  if (!foxessAPI || typeof foxessAPI.callFoxESSAPI !== 'function') {
    throw new Error('registerQuickControlRoutes requires foxessAPI.callFoxESSAPI()');
  }
  if (typeof getAutomationTimezone !== 'function') {
    throw new Error('registerQuickControlRoutes requires getAutomationTimezone()');
  }
  if (typeof getQuickControlState !== 'function') {
    throw new Error('registerQuickControlRoutes requires getQuickControlState()');
  }
  if (typeof getUserConfig !== 'function') {
    throw new Error('registerQuickControlRoutes requires getUserConfig()');
  }
  if (typeof getUserTime !== 'function') {
    throw new Error('registerQuickControlRoutes requires getUserTime()');
  }
  if (!logger || typeof logger.info !== 'function' || typeof logger.debug !== 'function') {
    throw new Error('registerQuickControlRoutes requires logger.info/debug()');
  }
  if (typeof saveQuickControlState !== 'function') {
    throw new Error('registerQuickControlRoutes requires saveQuickControlState()');
  }
  if (typeof serverTimestamp !== 'function') {
    throw new Error('registerQuickControlRoutes requires serverTimestamp()');
  }

  function shouldVerify(req) {
    const raw = req?.query?.verify;
    if (raw === undefined || raw === null || raw === '') return false;
    const normalized = String(raw).trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  /**
   * Start a quick manual control (charge or discharge)
   * POST /api/quickcontrol/start
   * Body: { type: 'charge'|'discharge', power: 0-30000, durationMinutes: 2-360 }
   */
  app.post('/api/quickcontrol/start', authenticateUser, async (req, res) => {
    try {
      const userId = req.user.uid;
      const { type, power, durationMinutes } = req.body;
      const requestId = `qc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      console.log('[QuickControl] Start request:', {
        requestId,
        userId,
        type,
        power,
        durationMinutes,
        bodyType: typeof req.body
      });

      if (!type || (type !== 'charge' && type !== 'discharge')) {
        console.log('[QuickControl] Validation failed: invalid type');
        return res.status(400).json({ errno: 400, error: 'type must be "charge" or "discharge"' });
      }
      if (typeof power !== 'number' || power < 0 || power > 30000) {
        console.log('[QuickControl] Validation failed: invalid power', { power, type: typeof power });
        return res.status(400).json({ errno: 400, error: 'power must be between 0 and 30000 watts' });
      }
      if (typeof durationMinutes !== 'number' || durationMinutes < 2 || durationMinutes > 360) {
        console.log('[QuickControl] Validation failed: invalid duration', { durationMinutes, type: typeof durationMinutes });
        return res.status(400).json({ errno: 400, error: 'durationMinutes must be between 2 and 360' });
      }

      logger.debug('QuickControl', `requestId=${requestId} Start requested: type=${type}, power=${power}W, duration=${durationMinutes}min, userId=${userId}`);

      const userConfig = await getUserConfig(userId);
      const resolvedDevice = resolveProviderDeviceId(userConfig);
      const provider = resolvedDevice.provider;
      const deviceSN = resolvedDevice.deviceId;
      if (!deviceSN) {
        return res.status(400).json({ errno: 400, error: 'Device serial number not configured' });
      }
      const deviceAdapter = provider !== 'foxess' && adapterRegistry
        ? adapterRegistry.getDeviceProvider(provider)
        : null;

      logger.info(
        'QuickControl',
        `requestId=${requestId} provider=${provider} device=${maskDeviceId(deviceSN)} adapterAvailable=${!!deviceAdapter}`
      );

      const userTimezone = getAutomationTimezone(userConfig);
      const userTime = getUserTime(userTimezone);
      const startHour = userTime.hour;
      const startMinute = userTime.minute;

      logger.debug('QuickControl', `requestId=${requestId} Using timezone: ${userTimezone}, local time: ${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}`);

      const endTimeObj = addMinutes(startHour, startMinute, durationMinutes);
      let endHour = endTimeObj.hour;
      let endMinute = endTimeObj.minute;

      const startTotalMins = startHour * 60 + startMinute;
      const endTotalMins = endHour * 60 + endMinute;
      if (endTotalMins <= startTotalMins) {
        logger.warn('QuickControl', 'Midnight crossing detected, capping at 23:59');
        endHour = 23;
        endMinute = 59;
      }

      logger.debug('QuickControl', `requestId=${requestId} Segment time: ${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')} -> ${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`);

      const workMode = type === 'charge' ? 'ForceCharge' : 'ForceDischarge';
      const minSocOnGrid = 20;
      const fdSoc = type === 'charge' ? 90 : 30;

      logger.debug('QuickControl', `requestId=${requestId} Parameters: workMode=${workMode}, power=${power}W, minSocOnGrid=${minSocOnGrid}%, fdSoc=${fdSoc}%, maxSoc=100%`);

      const groups = [];
      for (let i = 0; i < 8; i++) {
        if (i === 0) {
          groups.push({
            enable: 1,
            workMode: workMode,
            startHour: startHour,
            startMinute: startMinute,
            endHour: endHour,
            endMinute: endMinute,
            minSocOnGrid: minSocOnGrid,
            fdSoc: fdSoc,
            fdPwr: power,
            maxSoc: 100
          });
        } else {
          groups.push({
            enable: 0,
            workMode: 'SelfUse',
            startHour: 0,
            startMinute: 0,
            endHour: 0,
            endMinute: 0,
            minSocOnGrid: 10,
            fdSoc: 10,
            fdPwr: 0,
            maxSoc: 100
          });
        }
      }

      logger.info('QuickControl', `requestId=${requestId} activeGroup=${JSON.stringify(groups[0])}`);

      let result = null;
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        try {
          attempts++;
          if (provider !== 'foxess') {
            if (!deviceAdapter || typeof deviceAdapter.setSchedule !== 'function') {
              return res.status(400).json({ errno: 400, error: `Not supported for provider: ${provider}` });
            }
            logger.debug('QuickControl', `requestId=${requestId} Attempt ${attempts}/${maxAttempts}: Calling provider adapter...`);
            result = await deviceAdapter.setSchedule({ deviceSN, userConfig, userId }, groups);
          } else {
            logger.debug('QuickControl', `requestId=${requestId} Attempt ${attempts}/${maxAttempts}: Calling FoxESS API...`);
            result = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', {
              deviceSN,
              groups
            }, userConfig, userId);
          }

          const attemptDiagnostic = {
            requestId,
            provider,
            attempt: attempts,
            errno: result?.errno,
            msg: result?.msg || result?.error || '',
            hasResult: !!result?.result,
            raw: result?.raw || null
          };
          logger.debug('QuickControl', `Attempt diagnostic: ${JSON.stringify(attemptDiagnostic)}`);

          if (result && result.errno === 0) {
            logger.debug('QuickControl', `requestId=${requestId} Segment set success on attempt ${attempts}`);
            break;
          } else {
            logger.debug('QuickControl', `requestId=${requestId} Attempt ${attempts} returned errno=${result?.errno}`);
            if (attempts < maxAttempts) {
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          }
        } catch (apiErr) {
          logger.debug('QuickControl', `requestId=${requestId} API error on attempt ${attempts}: ${apiErr.message}`);
          if (attempts === maxAttempts) throw apiErr;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      if (!result || result.errno !== 0) {
        const providerLabel = provider === 'foxess'
          ? 'FoxESS'
          : (provider ? String(provider).toUpperCase() : 'Provider');
        const errorDetails = {
          requestId,
          errno: result?.errno || 500,
          msg: result?.msg || result?.error || 'Failed to set quick control segment',
          result: result?.result || null,
          provider,
          raw: result?.raw || null
        };
        console.error(`[QuickControl] ${providerLabel} API failed after retries:`, JSON.stringify(errorDetails));
        return res.status(500).json({
          errno: errorDetails.errno,
          error: errorDetails.msg,
          details: errorDetails.result,
          requestId
        });
      }

      let flagResult = null;
      if (provider === 'foxess') {
        try {
          flagResult = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/set/flag', 'POST', {
            deviceSN,
            enable: 1
          }, userConfig, userId);
          logger.debug('QuickControl', `Flag enable result: errno=${flagResult?.errno}`);
        } catch (flagErr) {
          console.warn('[QuickControl] Flag enable failed:', flagErr?.message || flagErr);
        }
      }

      let verify = null;
      if (shouldVerify(req)) {
        try {
          if (provider !== 'foxess' && deviceAdapter && typeof deviceAdapter.getSchedule === 'function') {
            verify = await deviceAdapter.getSchedule({ deviceSN, userConfig, userId });
          } else {
            verify = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN }, userConfig, userId);
          }
        } catch (e) {
          console.warn('[QuickControl] Verify read failed:', e?.message || e);
        }
      }

      const startedAt = Date.now();
      const expiresAt = startedAt + (durationMinutes * 60 * 1000);

      await saveQuickControlState(userId, {
        active: true,
        type: type,
        power: power,
        durationMinutes: durationMinutes,
        startedAt: startedAt,
        expiresAt: expiresAt,
        provider: provider,
        createdAt: serverTimestamp()
      });

      try {
        await addHistoryEntry(userId, {
          type: 'quickcontrol_start',
          controlType: type,
          power: power,
          durationMinutes: durationMinutes,
          timestamp: serverTimestamp()
        });
      } catch (e) { /* ignore */ }

      logger.info('QuickControl', `requestId=${requestId} Started: type=${type}, power=${power}W, duration=${durationMinutes}min, expiresAt=${new Date(expiresAt).toISOString()}`);

      res.json({
        errno: 0,
        msg: 'Quick control started',
        requestId,
        state: {
          active: true,
          type: type,
          power: power,
          durationMinutes: durationMinutes,
          startedAt: startedAt,
          expiresAt: expiresAt,
          provider: provider
        },
        flagResult,
        verify: verify?.result || null
      });
    } catch (error) {
      console.error('[QuickControl] Start error:', error);
      console.error('[QuickControl] Error stack:', error.stack);
      console.error('[QuickControl] Error details:', JSON.stringify({
        message: error.message,
        name: error.name,
        code: error.code
      }));
      res.status(500).json({ errno: 500, error: error.message });
    }
  });

  /**
   * Stop/end quick manual control
   * POST /api/quickcontrol/end
   */
  app.post('/api/quickcontrol/end', authenticateUser, async (req, res) => {
    try {
      const userId = req.user.uid;

      logger.debug('QuickControl', `End requested: userId=${userId}`);

      const quickState = await getQuickControlState(userId);
      if (!quickState || !quickState.active) {
        return res.json({
          errno: 0,
          msg: 'No active quick control to stop'
        });
      }

      const userConfig = await getUserConfig(userId);
      const resolvedDevice = resolveProviderDeviceId(userConfig);
      const provider = resolvedDevice.provider;
      const deviceSN = resolvedDevice.deviceId;
      if (!deviceSN) {
        return res.status(400).json({ errno: 400, error: 'Device serial number not configured' });
      }
      const deviceAdapter = provider !== 'foxess' && adapterRegistry
        ? adapterRegistry.getDeviceProvider(provider)
        : null;

      const groups = [];
      for (let i = 0; i < 8; i++) {
        groups.push({
          enable: 0,
          workMode: 'SelfUse',
          startHour: 0,
          startMinute: 0,
          endHour: 0,
          endMinute: 0,
          minSocOnGrid: 10,
          fdSoc: 10,
          fdPwr: 0,
          maxSoc: 100
        });
      }

      let result = null;
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        try {
          attempts++;
          if (provider !== 'foxess') {
            if (!deviceAdapter || typeof deviceAdapter.clearSchedule !== 'function') {
              return res.status(400).json({ errno: 400, error: `Not supported for provider: ${provider}` });
            }
            result = await deviceAdapter.clearSchedule({ deviceSN, userConfig, userId });
          } else {
            result = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', {
              deviceSN,
              groups
            }, userConfig, userId);
          }

          if (result && result.errno === 0) {
            logger.debug('QuickControl', `Segments cleared on attempt ${attempts}`);
            break;
          } else {
            logger.debug('QuickControl', `Clear attempt ${attempts} returned errno=${result?.errno}`);
            if (attempts < maxAttempts) {
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          }
        } catch (apiErr) {
          logger.debug('QuickControl', `API error on attempt ${attempts}: ${apiErr.message}`);
          if (attempts === maxAttempts) throw apiErr;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      if (!result || result.errno !== 0) {
        return res.status(500).json({
          errno: result?.errno || 500,
          error: result?.msg || result?.error || 'Failed to clear quick control segment'
        });
      }

      let flagResult = null;
      if (provider === 'foxess') {
        try {
          flagResult = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/set/flag', 'POST', {
            deviceSN,
            enable: 0
          }, userConfig, userId);
          logger.debug('QuickControl', `Flag disable result: errno=${flagResult?.errno}`);
        } catch (flagErr) {
          console.warn('[QuickControl] Flag disable failed:', flagErr?.message || flagErr);
        }
      }

      let verify = null;
      if (shouldVerify(req)) {
        try {
          if (provider !== 'foxess' && deviceAdapter && typeof deviceAdapter.getSchedule === 'function') {
            verify = await deviceAdapter.getSchedule({ deviceSN, userConfig, userId });
          } else {
            verify = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN }, userConfig, userId);
          }
        } catch (e) {
          console.warn('[QuickControl] Verify read failed:', e?.message || e);
        }
      }

      await saveQuickControlState(userId, null);

      try {
        await addHistoryEntry(userId, {
          type: 'quickcontrol_end',
          controlType: quickState.type,
          power: quickState.power,
          durationMinutes: quickState.durationMinutes,
          completedEarly: quickState.expiresAt > Date.now(),
          timestamp: serverTimestamp()
        });
      } catch (e) { /* ignore */ }

      logger.info('QuickControl', `Ended: type=${quickState.type}, power=${quickState.power}W`);

      res.json({
        errno: 0,
        msg: 'Quick control stopped',
        flagResult,
        verify: verify?.result || null
      });
    } catch (error) {
      console.error('[QuickControl] End error:', error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });

  /**
   * Get quick control status
   * GET /api/quickcontrol/status
   */
  app.get('/api/quickcontrol/status', authenticateUser, async (req, res) => {
    try {
      const userId = req.user.uid;
      const quickState = await getQuickControlState(userId);

      if (!quickState || !quickState.active) {
        return res.json({
          errno: 0,
          result: {
            active: false
          }
        });
      }

      const now = Date.now();
      if (now >= quickState.expiresAt) {
        const cleaned = await cleanupExpiredQuickControl(userId, quickState);
        logger.info('QuickControl', `Status check triggered auto-cleanup: cleaned=${cleaned}`);

        return res.json({
          errno: 0,
          result: {
            active: false,
            justExpired: true,
            completedControl: {
              type: quickState.type,
              power: quickState.power,
              durationMinutes: quickState.durationMinutes
            }
          }
        });
      }

      const remainingMs = Math.max(0, quickState.expiresAt - now);
      const remainingMinutes = Math.ceil(remainingMs / 60000);

      res.json({
        errno: 0,
        result: {
          active: true,
          type: quickState.type,
          power: quickState.power,
          durationMinutes: quickState.durationMinutes,
          startedAt: quickState.startedAt,
          expiresAt: quickState.expiresAt,
          remainingMinutes: remainingMinutes,
          expired: false
        }
      });
    } catch (error) {
      console.error('[QuickControl] Status error:', error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });
}

module.exports = {
  registerQuickControlRoutes
};
