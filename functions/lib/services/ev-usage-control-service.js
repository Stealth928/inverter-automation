'use strict';

const DEFAULT_RATE_WINDOW_MS = 60 * 1000;
const DEFAULT_STATUS_LIVE_RATE_PER_WINDOW = 30;
const DEFAULT_COMMAND_RATE_PER_WINDOW = 15;
const METRICS_TIMEZONE = 'Australia/Sydney';

const CATEGORY_TO_UNIT_COST_DENOMINATOR = Object.freeze({
  stream_signal: 150000,   // 150,000 signals per billing unit
  command: 1000,           // 1,000 commands per billing unit
  data_request: 500,       // 500 data requests per billing unit
  wake: 50                 // 50 wake requests per billing unit
});

function parsePositiveInt(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.floor(numeric);
}

function getTimezoneDateParts(date = new Date(), timeZone = METRICS_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(date);
  const lookup = {};
  parts.forEach((part) => {
    if (part.type === 'literal') return;
    lookup[part.type] = part.value;
  });
  return {
    year: String(lookup.year || ''),
    month: String(lookup.month || '').padStart(2, '0'),
    day: String(lookup.day || '').padStart(2, '0')
  };
}

function normalizeDateKey(date = new Date()) {
  const { year, month, day } = getTimezoneDateParts(date);
  return `${year}-${month}-${day}`;
}

function normalizeMonthKey(date = new Date()) {
  const { year, month } = getTimezoneDateParts(date);
  return `${year}-${month}`;
}

function normalizeCategory(raw) {
  const normalized = String(raw || '').trim().toLowerCase();
  if (!normalized) return 'other';
  if (normalized === 'data' || normalized === 'vehicle_data') return 'data_request';
  if (normalized === 'commands') return 'command';
  if (normalized === 'wakes') return 'wake';
  if (normalized === 'signals' || normalized === 'stream') return 'stream_signal';
  if (normalized === 'auth') return 'auth';
  return normalized;
}

function estimateBillingUnits(category, count = 1) {
  const normalizedCategory = normalizeCategory(category);
  const denominator = CATEGORY_TO_UNIT_COST_DENOMINATOR[normalizedCategory];
  if (!denominator || denominator <= 0) return 0;
  const numericCount = Number(count);
  if (!Number.isFinite(numericCount) || numericCount <= 0) return 0;
  return numericCount / denominator;
}

function createEvUsageControlService(deps = {}) {
  const admin = deps.admin || null;
  const db = deps.db || null;
  const logger = deps.logger || console;
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();

  const degradedMode = String(process.env.EV_TESLA_DEGRADED_MODE || 'off').trim().toLowerCase();
  const rateWindowMs = parsePositiveInt(process.env.EV_TESLA_RATE_WINDOW_MS, DEFAULT_RATE_WINDOW_MS);
  const statusLiveRatePerWindow = parsePositiveInt(
    process.env.EV_TESLA_RATE_STATUS_PER_WINDOW,
    DEFAULT_STATUS_LIVE_RATE_PER_WINDOW
  );
  const commandRatePerWindow = parsePositiveInt(
    process.env.EV_TESLA_RATE_COMMAND_PER_WINDOW,
    DEFAULT_COMMAND_RATE_PER_WINDOW
  );

  const dailyBillableLimitPerVehicle = parsePositiveInt(process.env.EV_TESLA_DAILY_BILLABLE_LIMIT_PER_VEHICLE, 0);
  const monthlyBillableLimitPerVehicle = parsePositiveInt(process.env.EV_TESLA_MONTHLY_BILLABLE_LIMIT_PER_VEHICLE, 0);
  const monthlyBillableLimitPerUser = parsePositiveInt(process.env.EV_TESLA_MONTHLY_BILLABLE_LIMIT_PER_USER, 0);
  const degradedUnitsLimitPerVehicle = Number(process.env.EV_TESLA_DEGRADED_UNITS_LIMIT_PER_VEHICLE || 0) || 0;
  const degradedUnitsLimitPerUser = Number(process.env.EV_TESLA_DEGRADED_UNITS_LIMIT_PER_USER || 0) || 0;

  const fieldValueIncrement = admin?.firestore?.FieldValue?.increment
    ? admin.firestore.FieldValue.increment.bind(admin.firestore.FieldValue)
    : null;
  const serverTimestamp = admin?.firestore?.FieldValue?.serverTimestamp
    ? admin.firestore.FieldValue.serverTimestamp.bind(admin.firestore.FieldValue)
    : (() => new Date());

  const requestWindowBuckets = new Map();
  const dailyBillableByVehicle = new Map();
  const monthlyBillableByVehicle = new Map();
  const monthlyBillableByUser = new Map();
  const monthlyUnitsByVehicle = new Map();
  const monthlyUnitsByUser = new Map();

  function getRequestBucketKey(uid, vehicleId, action) {
    return `${String(uid || '').trim()}::${String(vehicleId || '').trim()}::${String(action || '').trim()}`;
  }

  function getVehicleDailyKey(uid, vehicleId, dateKey) {
    return `${String(uid || '').trim()}::${String(vehicleId || '').trim()}::${String(dateKey || '')}`;
  }

  function getVehicleMonthlyKey(uid, vehicleId, monthKey) {
    return `${String(uid || '').trim()}::${String(vehicleId || '').trim()}::${String(monthKey || '')}`;
  }

  function getUserMonthlyKey(uid, monthKey) {
    return `${String(uid || '').trim()}::${String(monthKey || '')}`;
  }

  function getRateLimitForAction(action) {
    const normalized = String(action || '').trim().toLowerCase();
    if (normalized === 'status_live') {
      return statusLiveRatePerWindow;
    }
    if (normalized === 'command') {
      return commandRatePerWindow;
    }
    return 0;
  }

  function checkRateLimit(uid, vehicleId, action) {
    const limit = getRateLimitForAction(action);
    if (limit <= 0) {
      return { blocked: false, retryAfterSeconds: 0 };
    }

    const key = getRequestBucketKey(uid, vehicleId, action);
    const cutoff = now() - rateWindowMs;
    const current = requestWindowBuckets.get(key) || [];
    const pruned = current.filter((ts) => Number(ts) >= cutoff);

    if (pruned.length >= limit) {
      const oldest = pruned[0] || now();
      const retryAfterMs = Math.max(1000, (oldest + rateWindowMs) - now());
      requestWindowBuckets.set(key, pruned);
      return {
        blocked: true,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000)
      };
    }

    pruned.push(now());
    requestWindowBuckets.set(key, pruned);
    return { blocked: false, retryAfterSeconds: 0 };
  }

  function readBudgetSnapshot(uid, vehicleId, date = new Date()) {
    const dayKey = normalizeDateKey(date);
    const monthKey = normalizeMonthKey(date);
    const dayVehicleKey = getVehicleDailyKey(uid, vehicleId, dayKey);
    const monthVehicleKey = getVehicleMonthlyKey(uid, vehicleId, monthKey);
    const monthUserKey = getUserMonthlyKey(uid, monthKey);

    return {
      dayBillableVehicle: Number(dailyBillableByVehicle.get(dayVehicleKey) || 0),
      monthBillableVehicle: Number(monthlyBillableByVehicle.get(monthVehicleKey) || 0),
      monthBillableUser: Number(monthlyBillableByUser.get(monthUserKey) || 0),
      monthUnitsVehicle: Number(monthlyUnitsByVehicle.get(monthVehicleKey) || 0),
      monthUnitsUser: Number(monthlyUnitsByUser.get(monthUserKey) || 0),
      dayKey,
      monthKey
    };
  }

  function checkBudgetLimit(uid, vehicleId, date = new Date()) {
    const snapshot = readBudgetSnapshot(uid, vehicleId, date);
    if (
      dailyBillableLimitPerVehicle > 0 &&
      snapshot.dayBillableVehicle >= dailyBillableLimitPerVehicle
    ) {
      return {
        blocked: true,
        reasonCode: 'daily_vehicle_budget_exceeded',
        statusCode: 429,
        errno: 429,
        error: 'Tesla EV daily request budget exceeded for this vehicle'
      };
    }
    if (
      monthlyBillableLimitPerVehicle > 0 &&
      snapshot.monthBillableVehicle >= monthlyBillableLimitPerVehicle
    ) {
      return {
        blocked: true,
        reasonCode: 'monthly_vehicle_budget_exceeded',
        statusCode: 429,
        errno: 429,
        error: 'Tesla EV monthly request budget exceeded for this vehicle'
      };
    }
    if (
      monthlyBillableLimitPerUser > 0 &&
      snapshot.monthBillableUser >= monthlyBillableLimitPerUser
    ) {
      return {
        blocked: true,
        reasonCode: 'monthly_user_budget_exceeded',
        statusCode: 429,
        errno: 429,
        error: 'Tesla EV monthly request budget exceeded for this account'
      };
    }
    return { blocked: false, reasonCode: '' };
  }

  function checkDegradedMode(uid, vehicleId, date = new Date()) {
    const mode = degradedMode === 'on' || degradedMode === 'auto' || degradedMode === 'off'
      ? degradedMode
      : 'off';
    if (mode === 'off') {
      return { degraded: false, mode, reasonCode: '' };
    }
    if (mode === 'on') {
      return { degraded: true, mode, reasonCode: 'forced_degraded_mode' };
    }

    const snapshot = readBudgetSnapshot(uid, vehicleId, date);
    if (degradedUnitsLimitPerVehicle > 0 && snapshot.monthUnitsVehicle >= degradedUnitsLimitPerVehicle) {
      return { degraded: true, mode, reasonCode: 'vehicle_unit_limit_reached' };
    }
    if (degradedUnitsLimitPerUser > 0 && snapshot.monthUnitsUser >= degradedUnitsLimitPerUser) {
      return { degraded: true, mode, reasonCode: 'user_unit_limit_reached' };
    }
    return { degraded: false, mode, reasonCode: '' };
  }

  async function assessRouteRequest({ uid, vehicleId, action }) {
    const normalizedUid = String(uid || '').trim();
    const normalizedVehicleId = String(vehicleId || '').trim();
    const normalizedAction = String(action || '').trim();

    if (!normalizedUid || !normalizedVehicleId || !normalizedAction) {
      return { blocked: false, degraded: false, mode: degradedMode };
    }

    const rateResult = checkRateLimit(normalizedUid, normalizedVehicleId, normalizedAction);
    if (rateResult.blocked) {
      return {
        blocked: true,
        degraded: false,
        mode: degradedMode,
        reasonCode: 'rate_limit_exceeded',
        statusCode: 429,
        errno: 429,
        retryAfterSeconds: rateResult.retryAfterSeconds,
        error: `Tesla EV rate limit exceeded for this vehicle; retry after ${rateResult.retryAfterSeconds}s`
      };
    }

    const budgetResult = checkBudgetLimit(normalizedUid, normalizedVehicleId);
    if (budgetResult.blocked) {
      return {
        ...budgetResult,
        degraded: false,
        mode: degradedMode,
        retryAfterSeconds: 60
      };
    }

    const degraded = checkDegradedMode(normalizedUid, normalizedVehicleId);
    return {
      blocked: false,
      degraded: degraded.degraded,
      mode: degraded.mode,
      reasonCode: degraded.reasonCode || ''
    };
  }

  function incrementMapCounter(map, key, incrementBy = 1) {
    const current = Number(map.get(key) || 0);
    map.set(key, current + Number(incrementBy || 0));
  }

  async function persistCallMetrics({
    uid,
    vehicleId,
    dateKey,
    category,
    statusCode,
    billable,
    estimatedUnits
  }) {
    if (!db || !fieldValueIncrement || !uid || !vehicleId) {
      return;
    }

    const normalizedCategory = normalizeCategory(category);
    const statusField = Number.isFinite(Number(statusCode))
      ? `s${Math.max(0, Math.floor(Number(statusCode)))}`
      : 's0';
    const billableIncrement = billable ? 1 : 0;

    const userMetricsRef = db.collection('users').doc(uid).collection('metrics').doc(dateKey);
    const globalMetricsRef = db.collection('metrics').doc(dateKey);
    const vehicleMetricsRef = db
      .collection('users')
      .doc(uid)
      .collection('vehicles')
      .doc(vehicleId)
      .collection('metrics')
      .doc(dateKey);

    const updatePayload = {
      'teslaFleet.calls.total': fieldValueIncrement(1),
      'teslaFleet.calls.billable': fieldValueIncrement(billableIncrement),
      [`teslaFleet.calls.byCategory.${normalizedCategory}`]: fieldValueIncrement(1),
      [`teslaFleet.calls.byStatus.${statusField}`]: fieldValueIncrement(1),
      updatedAt: serverTimestamp()
    };
    if (billable && estimatedUnits > 0) {
      updatePayload['teslaFleet.billing.unitsEstimated'] = fieldValueIncrement(estimatedUnits);
      updatePayload[`teslaFleet.billing.unitsByCategory.${normalizedCategory}`] = fieldValueIncrement(estimatedUnits);
    }

    await Promise.all([
      globalMetricsRef.set(updatePayload, { merge: true }),
      userMetricsRef.set(updatePayload, { merge: true }),
      vehicleMetricsRef.set(updatePayload, { merge: true })
    ]);
  }

  async function recordTeslaApiCall({
    uid,
    vehicleId,
    category,
    status,
    billable
  }) {
    const normalizedUid = String(uid || '').trim();
    const normalizedVehicleId = String(vehicleId || '').trim();
    if (!normalizedUid || !normalizedVehicleId) return;

    const normalizedCategory = normalizeCategory(category);
    const statusCode = Number.isFinite(Number(status)) ? Number(status) : 0;
    const isBillable = typeof billable === 'boolean'
      ? billable
      : (statusCode >= 200 && statusCode < 300);
    const date = new Date(now());
    const dayKey = normalizeDateKey(date);
    const monthKey = normalizeMonthKey(date);
    const dailyVehicleKey = getVehicleDailyKey(normalizedUid, normalizedVehicleId, dayKey);
    const monthlyVehicleKey = getVehicleMonthlyKey(normalizedUid, normalizedVehicleId, monthKey);
    const monthlyUserKey = getUserMonthlyKey(normalizedUid, monthKey);
    const units = isBillable ? estimateBillingUnits(normalizedCategory, 1) : 0;

    if (isBillable) {
      incrementMapCounter(dailyBillableByVehicle, dailyVehicleKey, 1);
      incrementMapCounter(monthlyBillableByVehicle, monthlyVehicleKey, 1);
      incrementMapCounter(monthlyBillableByUser, monthlyUserKey, 1);
      if (units > 0) {
        incrementMapCounter(monthlyUnitsByVehicle, monthlyVehicleKey, units);
        incrementMapCounter(monthlyUnitsByUser, monthlyUserKey, units);
      }
    }

    try {
      await persistCallMetrics({
        uid: normalizedUid,
        vehicleId: normalizedVehicleId,
        dateKey: dayKey,
        category: normalizedCategory,
        statusCode,
        billable: isBillable,
        estimatedUnits: units
      });
    } catch (error) {
      logger.warn?.(
        'EVUsageControl',
        `Failed to persist Tesla call metrics for ${normalizedUid}/${normalizedVehicleId}: ${error.message || error}`
      );
    }
  }

  function getSnapshot(uid, vehicleId, date = new Date()) {
    const normalizedUid = String(uid || '').trim();
    const normalizedVehicleId = String(vehicleId || '').trim();
    if (!normalizedUid || !normalizedVehicleId) {
      return {
        dailyBillableVehicle: 0,
        monthlyBillableVehicle: 0,
        monthlyBillableUser: 0,
        monthlyUnitsVehicle: 0,
        monthlyUnitsUser: 0
      };
    }
    const snapshot = readBudgetSnapshot(normalizedUid, normalizedVehicleId, date);
    return {
      dailyBillableVehicle: snapshot.dayBillableVehicle,
      monthlyBillableVehicle: snapshot.monthBillableVehicle,
      monthlyBillableUser: snapshot.monthBillableUser,
      monthlyUnitsVehicle: snapshot.monthUnitsVehicle,
      monthlyUnitsUser: snapshot.monthUnitsUser
    };
  }

  return {
    assessRouteRequest,
    recordTeslaApiCall,
    getSnapshot,
    getMode: () => degradedMode,
    estimateBillingUnits
  };
}

module.exports = {
  createEvUsageControlService,
  estimateBillingUnits
};
