'use strict';

function parseWindowTimeToMinutes(value) {
  const [hour, minute] = (value || '00:00').split(':').map(Number);
  return (hour * 60) + minute;
}

function evaluateBlackoutWindow(blackoutWindows, currentMinutes) {
  const windows = Array.isArray(blackoutWindows) ? blackoutWindows : [];

  for (const window of windows) {
    // Windows are enabled by default when explicitly created by the user.
    if (window && window.enabled === false) {
      continue;
    }

    const startMins = parseWindowTimeToMinutes(window?.start);
    const endMins = parseWindowTimeToMinutes(window?.end);

    // Window contained within same day.
    if (startMins <= endMins) {
      if (currentMinutes >= startMins && currentMinutes < endMins) {
        return { currentBlackoutWindow: window, inBlackout: true };
      }
      continue;
    }

    // Window wraps across midnight.
    if (currentMinutes >= startMins || currentMinutes < endMins) {
      return { currentBlackoutWindow: window, inBlackout: true };
    }
  }

  return {
    currentBlackoutWindow: null,
    inBlackout: false
  };
}

function hasWeatherDependentRules(enabledRules, isForecastTemperatureType) {
  const rules = Array.isArray(enabledRules) ? enabledRules : [];
  const isForecastType = typeof isForecastTemperatureType === 'function'
    ? isForecastTemperatureType
    : () => false;

  return rules.some(([, rule]) => {
    const cond = rule && typeof rule === 'object' ? (rule.conditions || {}) : {};
    const tempCond = cond.temp || cond.temperature;

    return (
      cond.solarRadiation?.enabled ||
      cond.cloudCover?.enabled ||
      cond.uvIndex?.enabled ||
      (tempCond?.enabled && isForecastType(tempCond.type))
    );
  });
}

function buildWeatherFetchPlan(options = {}) {
  const automationForecastDays = Number.isInteger(options.automationForecastDays)
    ? options.automationForecastDays
    : 11;
  const enabledRules = Array.isArray(options.enabledRules) ? options.enabledRules : [];
  const isForecastTemperatureType = typeof options.isForecastTemperatureType === 'function'
    ? options.isForecastTemperatureType
    : () => false;

  const needsWeatherData = hasWeatherDependentRules(enabledRules, isForecastTemperatureType);
  if (!needsWeatherData) {
    return {
      daysToFetch: 0,
      maxDaysNeeded: 0,
      needsWeatherData: false
    };
  }

  let maxDaysNeeded = 1;
  for (const [, rule] of enabledRules) {
    const cond = rule && typeof rule === 'object' ? (rule.conditions || {}) : {};

    if (cond.solarRadiation?.enabled) {
      const unit = cond.solarRadiation.lookAheadUnit || 'hours';
      const value = cond.solarRadiation.lookAhead || 6;
      const days = unit === 'days' ? value : Math.ceil(value / 24);
      maxDaysNeeded = Math.max(maxDaysNeeded, days);
    }

    if (cond.cloudCover?.enabled) {
      const unit = cond.cloudCover.lookAheadUnit || 'hours';
      const value = cond.cloudCover.lookAhead || 6;
      const days = unit === 'days' ? value : Math.ceil(value / 24);
      maxDaysNeeded = Math.max(maxDaysNeeded, days);
    }

    const tempCond = cond.temp || cond.temperature;
    if (tempCond?.enabled && isForecastTemperatureType(tempCond.type)) {
      const dayOffset = Number.isInteger(tempCond.dayOffset)
        ? tempCond.dayOffset
        : Number.parseInt(tempCond.dayOffset, 10) || 0;
      maxDaysNeeded = Math.max(maxDaysNeeded, dayOffset + 1);
    }
  }

  return {
    // Keep stable forecast window for cache reuse across rules.
    daysToFetch: automationForecastDays,
    maxDaysNeeded: Math.min(maxDaysNeeded, automationForecastDays),
    needsWeatherData: true
  };
}

module.exports = {
  buildWeatherFetchPlan,
  evaluateBlackoutWindow,
  hasWeatherDependentRules,
  parseWindowTimeToMinutes
};
