/**
 * Automation condition helpers shared by rule evaluation and tests.
 */

const WEEKDAY_NAME_TO_INDEX = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6
};

const WEEKDAY_INDEX_TO_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function compareNumeric(actual, operator, value, value2 = null) {
  if (actual === null || actual === undefined || Number.isNaN(actual)) return false;

  switch (operator) {
    case '>':
      return actual > value;
    case '>=':
      return actual >= value;
    case '<':
      return actual < value;
    case '<=':
      return actual <= value;
    case '==':
      return actual === value;
    case '!=':
      return actual !== value;
    case 'between':
      if (value2 === null || value2 === undefined || Number.isNaN(value2)) return false;
      return actual >= Math.min(value, value2) && actual <= Math.max(value, value2);
    default:
      return false;
  }
}

function parseTimeToMinutes(timeValue, fallback) {
  const input = typeof timeValue === 'string' && timeValue.includes(':') ? timeValue : fallback;
  if (!input || !input.includes(':')) return null;

  const [hRaw, mRaw] = input.split(':');
  const hour = Number(hRaw);
  const minute = Number(mRaw);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function isMinutesInWindow(currentMinutes, startMinutes, endMinutes) {
  if (!Number.isFinite(currentMinutes) || !Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) {
    return false;
  }

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  // Overnight window (e.g., 22:00 -> 06:00)
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function normalizeWeekdays(days) {
  if (!Array.isArray(days)) return [];

  const normalized = new Set();
  for (const value of days) {
    if (Number.isInteger(value) && value >= 0 && value <= 6) {
      normalized.add(value);
      continue;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (/^\d+$/.test(trimmed)) {
        const numeric = Number(trimmed);
        if (numeric >= 0 && numeric <= 6) {
          normalized.add(numeric);
          continue;
        }
      }

      const weekday = WEEKDAY_NAME_TO_INDEX[trimmed.toLowerCase()];
      if (weekday !== undefined) {
        normalized.add(weekday);
      }
    }
  }

  return Array.from(normalized).sort((a, b) => a - b);
}

function getWeekdayShortLabels(days) {
  return normalizeWeekdays(days).map((day) => WEEKDAY_INDEX_TO_SHORT[day]);
}

function getWeekdayIndexInTimezone(timezone, date = new Date()) {
  const weekdayShort = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short'
  }).format(date);

  return WEEKDAY_NAME_TO_INDEX[weekdayShort.toLowerCase()];
}

function getHourMinuteInTimezone(timezone, date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  });

  const parts = formatter.formatToParts(date);
  const values = {};
  for (const part of parts) {
    values[part.type] = part.value;
  }

  const hour = Number(values.hour);
  const minute = Number(values.minute);
  return {
    hour: hour === 24 ? 0 : hour,
    minute
  };
}

function evaluateTimeCondition(timeCondition, context = {}) {
  const startTime = timeCondition.startTime || timeCondition.start || '00:00';
  const endTime = timeCondition.endTime || timeCondition.end || '23:59';
  const days = normalizeWeekdays(timeCondition.days);

  const timezone = context.timezone || 'Australia/Sydney';
  const userTime = context.userTime || getHourMinuteInTimezone(timezone);
  const currentMinutes = Number.isFinite(context.currentMinutes)
    ? context.currentMinutes
    : (userTime.hour * 60 + userTime.minute);

  const weekdayIndex = Number.isInteger(context.dayOfWeek)
    ? context.dayOfWeek
    : Number.isInteger(userTime.dayOfWeek)
      ? userTime.dayOfWeek
      : getWeekdayIndexInTimezone(timezone);

  const startMinutes = parseTimeToMinutes(startTime, '00:00');
  const endMinutes = parseTimeToMinutes(endTime, '23:59');
  const inWindow = isMinutesInWindow(currentMinutes, startMinutes, endMinutes);
  const dayMatched = days.length === 0 || days.includes(weekdayIndex);

  return {
    met: dayMatched && inWindow,
    dayMatched,
    inWindow,
    weekdayIndex,
    startTime,
    endTime,
    days,
    daysLabel: days.length === 0 ? 'Every day' : getWeekdayShortLabels(days).join(', '),
    actualTime: `${String(userTime.hour || 0).padStart(2, '0')}:${String(userTime.minute || 0).padStart(2, '0')}`
  };
}

function isForecastTemperatureType(type) {
  const normalized = String(type || '').toLowerCase();
  return (
    normalized === 'forecastmax' ||
    normalized === 'forecast_max' ||
    normalized === 'dailymax' ||
    normalized === 'daily_max' ||
    normalized === 'forecastmin' ||
    normalized === 'forecast_min' ||
    normalized === 'dailymin' ||
    normalized === 'daily_min'
  );
}

function getForecastTemperatureMetric(type) {
  const normalized = String(type || '').toLowerCase();
  if (normalized.includes('min')) return 'min';
  return 'max';
}

function getForecastTemperature(weatherData, metric = 'max', dayOffset = 0) {
  const daily = weatherData?.result?.daily || weatherData?.daily;
  if (!daily) return { ok: false, reason: 'No daily weather data' };

  const values = metric === 'min' ? daily.temperature_2m_min : daily.temperature_2m_max;
  if (!Array.isArray(values) || values.length === 0) {
    return { ok: false, reason: `No daily temperature_${metric} data` };
  }

  const offset = Number.isInteger(dayOffset) ? dayOffset : 0;
  if (offset < 0 || offset >= values.length) {
    return { ok: false, reason: `No forecast data for day offset ${offset}` };
  }

  const value = Number(values[offset]);
  if (!Number.isFinite(value)) {
    return { ok: false, reason: 'Invalid forecast temperature value' };
  }

  return { ok: true, value, dayOffset: offset };
}

function evaluateTemperatureCondition(tempCondition, context = {}) {
  const condition = tempCondition || {};
  const type = condition.type || 'battery';
  const operator = condition.op || condition.operator || '>';
  const value = Number(condition.value);
  const value2 = condition.value2 !== undefined && condition.value2 !== null ? Number(condition.value2) : null;

  let actual = null;
  let source = 'inverter';
  let metric = null;
  let dayOffset = 0;

  if (isForecastTemperatureType(type)) {
    source = 'weather_daily';
    metric = getForecastTemperatureMetric(type);
    dayOffset = Number.isInteger(condition.dayOffset)
      ? condition.dayOffset
      : Number.parseInt(condition.dayOffset, 10) || 0;

    const forecast = getForecastTemperature(context.weatherData, metric, dayOffset);
    if (!forecast.ok) {
      return {
        met: false,
        reason: forecast.reason,
        type,
        source,
        metric,
        dayOffset
      };
    }

    actual = forecast.value;
  } else if (String(type).toLowerCase() === 'battery') {
    actual = context.batteryTemp;
  } else {
    // Legacy behavior: non-battery temp types map to ambient/inverter input.
    actual = context.ambientTemp;
  }

  if (actual === null || actual === undefined || Number.isNaN(Number(actual))) {
    return {
      met: false,
      reason: isForecastTemperatureType(type) ? 'No forecast temperature data' : `No ${type} temperature data`,
      type,
      source,
      metric,
      dayOffset
    };
  }

  const target = Number.isFinite(value) ? value : 0;
  const target2 = Number.isFinite(value2) ? value2 : null;
  const met = compareNumeric(Number(actual), operator, target, target2);

  return {
    met,
    actual: Number(actual),
    operator,
    target,
    target2,
    type,
    source,
    metric,
    dayOffset
  };
}

module.exports = {
  compareNumeric,
  parseTimeToMinutes,
  isMinutesInWindow,
  normalizeWeekdays,
  getWeekdayShortLabels,
  getWeekdayIndexInTimezone,
  evaluateTimeCondition,
  isForecastTemperatureType,
  getForecastTemperature,
  evaluateTemperatureCondition
};
