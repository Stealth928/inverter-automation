'use strict';

const { getWeekdayIndexInTimezone } = require('./automation-conditions');

function isValidTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Date().toLocaleString('en-AU', { timeZone: tz });
    return true;
  } catch (_error) {
    return false;
  }
}

function getAutomationTimezone(userConfig, defaultTimezone = 'Australia/Sydney') {
  if (userConfig?.timezone && isValidTimezone(userConfig.timezone)) {
    return userConfig.timezone;
  }
  return defaultTimezone;
}

function getTimeInTimezone(timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(new Date());
  const values = {};
  parts.forEach((part) => {
    values[part.type] = part.value;
  });
  return new Date(`${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`);
}

function isTimeInRange(currentTime, startTime, endTime) {
  const current = parseInt(currentTime.replace(':', ''), 10);
  const start = parseInt(startTime.replace(':', ''), 10);
  const end = parseInt(endTime.replace(':', ''), 10);

  if (start >= end) {
    return current >= start || current < end;
  }
  return current >= start && current < end;
}

function getUserTime(timezone, options = {}) {
  const defaultTimezone = options.defaultTimezone || 'Australia/Sydney';
  const targetTimezone = timezone || defaultTimezone;
  const now = options.now instanceof Date ? options.now : new Date();
  const timeStr = now.toLocaleString('en-AU', { timeZone: targetTimezone, hour12: false });
  const [datePart, timePart] = timeStr.split(', ');
  const [day, month, year] = datePart.split('/');
  const [hour, minute, second] = timePart.split(':');
  const parsedHour = parseInt(hour, 10);
  const normalizedHour = parsedHour === 24 ? 0 : parsedHour;

  return {
    hour: normalizedHour,
    minute: parseInt(minute, 10),
    second: parseInt(second, 10),
    day: parseInt(day, 10),
    month: parseInt(month, 10),
    year: parseInt(year, 10),
    dayOfWeek: getWeekdayIndexInTimezone(targetTimezone, now) ?? now.getDay(),
    timezone: targetTimezone
  };
}

function addMinutes(hour, minute, addMins) {
  const totalMins = hour * 60 + minute + addMins;
  return {
    hour: Math.floor(totalMins / 60) % 24,
    minute: totalMins % 60
  };
}

module.exports = {
  addMinutes,
  getAutomationTimezone,
  getTimeInTimezone,
  getUserTime,
  isTimeInRange,
  isValidTimezone
};
