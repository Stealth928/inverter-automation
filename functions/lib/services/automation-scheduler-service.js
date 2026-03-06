'use strict';

function assertFunction(value, name) {
  if (typeof value !== 'function') {
    throw new Error(`runAutomationSchedulerCycle requires ${name}()`);
  }
}

function createMockResponseCollector() {
  let payload = null;
  const response = {
    json: (data) => {
      payload = data;
      return response;
    },
    status: () => response,
    send: (data) => {
      payload = data;
      return response;
    }
  };

  return {
    response,
    getPayload: () => payload
  };
}

async function runAutomationSchedulerCycle(_context, deps = {}) {
  const automationCycleHandler = deps.automationCycleHandler;
  const db = deps.db;
  const getConfig = deps.getConfig;
  const getTimeInTimezone = deps.getTimeInTimezone;
  const getUserAutomationState = deps.getUserAutomationState;
  const getUserConfig = deps.getUserConfig;
  const getUserRules = deps.getUserRules;
  const isTimeInRange = deps.isTimeInRange;
  const logger = deps.logger || console;

  if (!db || typeof db.collection !== 'function') {
    throw new Error('runAutomationSchedulerCycle requires db.collection()');
  }
  assertFunction(automationCycleHandler, 'automationCycleHandler');
  assertFunction(getConfig, 'getConfig');
  assertFunction(getTimeInTimezone, 'getTimeInTimezone');
  assertFunction(getUserAutomationState, 'getUserAutomationState');
  assertFunction(getUserConfig, 'getUserConfig');
  assertFunction(getUserRules, 'getUserRules');
  assertFunction(isTimeInRange, 'isTimeInRange');

  const schedulerStartTime = Date.now();
  const schedId = `${schedulerStartTime}_${Math.random().toString(36).slice(2, 11)}`;
  logger.log(`[Scheduler] ========== Background check ${schedId} START ==========`);

  try {
    const serverConfig = getConfig();
    const defaultIntervalMs = serverConfig.automation.intervalMs;
    let usersSnapshot = await db.collection('users').where('automationEnabled', '==', true).get();

    if (usersSnapshot.size === 0) {
      logger.log('[Scheduler] No pre-filtered users found - running migration scan...');
      const allUsersSnapshot = await db.collection('users').get();
      let migratedCount = 0;

      const migrationChecks = allUsersSnapshot.docs.map(async (userDoc) => {
        try {
          const stateDoc = await db.collection('users').doc(userDoc.id)
            .collection('automation').doc('state').get();
          if (stateDoc.exists && stateDoc.data()?.enabled === true) {
            await db.collection('users').doc(userDoc.id).set(
              { automationEnabled: true },
              { merge: true }
            );
            logger.log(`[Scheduler] Migrated user ${userDoc.id}: set automationEnabled=true`);
            migratedCount++;
          }
        } catch (error) {
          logger.error(`[Scheduler] Migration check failed for ${userDoc.id}:`, error.message);
        }
      });
      await Promise.all(migrationChecks);

      if (migratedCount === 0) {
        logger.log('[Scheduler] Migration scan complete - no enabled users found, skipping');
        return null;
      }

      logger.log(`[Scheduler] Migration complete - ${migratedCount} user(s) migrated, re-querying...`);
      usersSnapshot = await db.collection('users').where('automationEnabled', '==', true).get();
    }

    const totalEnabled = usersSnapshot.size;
    const userDataAll = await Promise.all(usersSnapshot.docs.map(async (userDoc) => {
      const userId = userDoc.id;
      try {
        const state = await getUserAutomationState(userId);
        const userConfig = await getUserConfig(userId);
        return {
          userId,
          state,
          userConfig,
          ready: state && state.enabled === true && userConfig?.deviceSn
        };
      } catch (error) {
        return { userId, error: error.message, ready: false };
      }
    }));

    const cycleCandidates = [];
    let skippedDisabled = 0;
    let skippedTooSoon = 0;
    const now = Date.now();

    for (const userData of userDataAll) {
      if (!userData.ready) {
        skippedDisabled++;
        continue;
      }

      const { userId, state, userConfig } = userData;
      const userIntervalMs = userConfig?.automation?.intervalMs || defaultIntervalMs;
      const lastCheck = state?.lastCheck || 0;
      if ((now - lastCheck) < userIntervalMs) {
        skippedTooSoon++;
        continue;
      }

      const userRules = await getUserRules(userId);
      const blackoutWindows = userRules?.blackoutWindows || [];
      let inBlackout = false;
      if (Array.isArray(blackoutWindows) && blackoutWindows.length > 0) {
        const userTz = userConfig?.timezone || 'UTC';
        const userNow = getTimeInTimezone(userTz);
        const dayOfWeek = userNow.toLocaleString('en-US', { weekday: 'long' }).toLowerCase();
        const currentTime = userNow.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

        for (const window of blackoutWindows) {
          if (window.enabled === false) continue;
          const applicableDays = window.days || [];
          if (applicableDays.length > 0 && !applicableDays.includes(dayOfWeek)) {
            continue;
          }
          if (isTimeInRange(currentTime, window.start, window.end)) {
            inBlackout = true;
            break;
          }
        }
      }

      if (inBlackout) {
        skippedDisabled++;
        continue;
      }

      cycleCandidates.push({ userId, state, userConfig });
    }

    let cyclesRun = 0;
    let errors = 0;
    if (cycleCandidates.length > 0) {
      const cycleResults = await Promise.all(cycleCandidates.map(async ({ userId }) => {
        const userStartTime = Date.now();
        try {
          const mockReq = { user: { uid: userId }, body: {}, headers: {}, get: () => null };
          const collector = createMockResponseCollector();
          await automationCycleHandler(mockReq, collector.response);
          const cycleResult = collector.getPayload();
          const userDuration = Date.now() - userStartTime;

          if (!cycleResult) {
            return { success: true };
          }
          if (cycleResult.errno !== 0) {
            logger.error(`[Scheduler] User ${userId}: Error: ${cycleResult.error} (${userDuration}ms)`);
            return { success: false };
          }

          const result = cycleResult.result;
          if (result?.triggered) {
            logger.log(`[Scheduler] User ${userId}: Rule '${result.rule?.name}' triggered (${userDuration}ms)`);
          } else if (result?.skipped) {
            logger.log(`[Scheduler] User ${userId}: Skipped: ${result.reason} (${userDuration}ms)`);
          }
          return { success: true };
        } catch (error) {
          logger.error(`[Scheduler] User ${userId}: Exception: ${error.message}`);
          return { success: false };
        }
      }));

      cyclesRun = cycleResults.filter((entry) => entry.success).length;
      errors = cycleResults.filter((entry) => !entry.success).length;
    }

    const duration = Date.now() - schedulerStartTime;
    logger.log(`[Scheduler] ========== Background check ${schedId} COMPLETE ==========`);
    logger.log(`[Scheduler] ${totalEnabled} enabled users: ${cyclesRun} cycles, ${skippedTooSoon} too soon, ${skippedDisabled} skipped, ${errors} errors (${duration}ms)`);
    return null;
  } catch (error) {
    logger.error('[Scheduler] FATAL:', error);
    throw error;
  }
}

module.exports = {
  runAutomationSchedulerCycle
};
