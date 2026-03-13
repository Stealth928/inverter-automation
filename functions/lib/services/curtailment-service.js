'use strict';

const { resolveProviderDeviceId } = require('../provider-device-id');

function createCurtailmentService(deps = {}) {
  const db = deps.db;
  const foxessAPI = deps.foxessAPI;
  const getCurrentAmberPrices = deps.getCurrentAmberPrices;
  const now = typeof deps.now === 'function' ? deps.now : Date.now;

  if (!db || typeof db.collection !== 'function') {
    throw new Error('createCurtailmentService requires Firestore db');
  }
  if (!foxessAPI || typeof foxessAPI.callFoxESSAPI !== 'function') {
    throw new Error('createCurtailmentService requires foxessAPI.callFoxESSAPI()');
  }
  if (typeof getCurrentAmberPrices !== 'function') {
    throw new Error('createCurtailmentService requires getCurrentAmberPrices()');
  }

  function getStateDocRef(userId) {
    return db.collection('users').doc(userId).collection('curtailment').doc('state');
  }

  async function loadCurtailmentState(userId, fallbackState) {
    const stateDoc = await getStateDocRef(userId).get();
    return stateDoc.exists ? stateDoc.data() : fallbackState;
  }

  async function saveCurtailmentState(userId, payload) {
    await getStateDocRef(userId).set(payload);
  }

  function resolveCurtailmentTarget(userConfig = {}) {
    const resolved = resolveProviderDeviceId(userConfig);
    return {
      provider: String(resolved.provider || 'foxess').toLowerCase().trim(),
      deviceSN: resolved.deviceId || null
    };
  }

  async function setExportLimit(userId, userConfig, deviceSN, value) {
    return foxessAPI.callFoxESSAPI(
      '/op/v0/device/setting/set',
      'POST',
      {
        sn: deviceSN,
        key: 'ExportLimit',
        value
      },
      userConfig,
      userId
    );
  }

  async function checkAndApplyCurtailment(userId, userConfig, amberData) {
    const result = {
      enabled: false,
      triggered: false,
      priceThreshold: null,
      currentPrice: null,
      action: null,
      error: null,
      stateChanged: false
    };

    try {
      const target = resolveCurtailmentTarget(userConfig);

      if (target.provider !== 'foxess') {
        // Curtailment uses FoxESS-specific ExportLimit control; mark as unsupported for other providers.
        result.enabled = false;
        result.action = 'unsupported_provider';
        const existingState = await loadCurtailmentState(userId, { active: false });
        if (existingState.active) {
          result.stateChanged = true;
          await saveCurtailmentState(userId, {
            active: false,
            lastPrice: null,
            lastDeactivated: now(),
            disabledByProvider: target.provider
          });
        }
        return result;
      }

      if (!userConfig?.curtailment?.enabled) {
        result.enabled = false;

        if (target.deviceSN) {
          const curtailmentState = await loadCurtailmentState(userId, { active: false });

          if (curtailmentState.active) {
            console.log('[Curtailment] Restoring power (was active, now disabled)');
            const setResult = await setExportLimit(userId, userConfig, target.deviceSN, 12000);

            if (setResult?.errno === 0) {
              result.action = 'deactivated_by_disable';
              result.stateChanged = true;
              await saveCurtailmentState(userId, {
                active: false,
                lastPrice: null,
                lastDeactivated: now(),
                disabledByUser: true
              });
            } else {
              result.error = `Failed to restore export limit: ${setResult?.msg || 'Unknown error'}`;
            }
          }
        }

        return result;
      }

      result.enabled = true;
      result.priceThreshold = userConfig.curtailment.priceThreshold;

      if (!Array.isArray(amberData) || amberData.length === 0) {
        result.error = 'No Amber price data available';
        return result;
      }

      const { feedInPrice: currentFeedInPrice } = getCurrentAmberPrices(amberData);
      if (currentFeedInPrice === null) {
        result.error = 'No current feed-in price found';
        return result;
      }

      result.currentPrice = currentFeedInPrice;

      const curtailmentState = await loadCurtailmentState(userId, { active: false, lastPrice: null });
      const shouldCurtail = result.currentPrice < result.priceThreshold;
      result.triggered = shouldCurtail;

      if (shouldCurtail && !curtailmentState.active) {
        console.log(`[Curtailment] Activating (price ${result.currentPrice.toFixed(2)}c < ${result.priceThreshold}c)`);
        if (!target.deviceSN) {
          result.error = 'No device SN configured';
          return result;
        }

        const setResult = await setExportLimit(userId, userConfig, target.deviceSN, 0);
        if (setResult?.errno === 0) {
          result.action = 'activated';
          result.stateChanged = true;
          await saveCurtailmentState(userId, {
            active: true,
            lastPrice: result.currentPrice,
            lastActivated: now(),
            threshold: result.priceThreshold
          });
        } else {
          result.error = `Failed to set export limit: ${setResult?.msg || 'Unknown error'}`;
        }
      } else if (!shouldCurtail && curtailmentState.active) {
        console.log(`[Curtailment] Deactivating (price ${result.currentPrice.toFixed(2)}c >= ${result.priceThreshold}c)`);
        if (!target.deviceSN) {
          result.error = 'No device SN configured';
          return result;
        }

        const setResult = await setExportLimit(userId, userConfig, target.deviceSN, 12000);
        if (setResult?.errno === 0) {
          result.action = 'deactivated';
          result.stateChanged = true;
          await saveCurtailmentState(userId, {
            active: false,
            lastPrice: result.currentPrice,
            lastDeactivated: now(),
            threshold: result.priceThreshold
          });
        } else {
          result.error = `Failed to restore export limit: ${setResult?.msg || 'Unknown error'}`;
        }
      }
    } catch (error) {
      result.error = error.message;
      console.error('[Curtailment] Error:', error);
    }

    return result;
  }

  return {
    checkAndApplyCurtailment
  };
}

module.exports = {
  createCurtailmentService
};
