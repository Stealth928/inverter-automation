'use strict';

const {
  addMinutes,
  getAutomationTimezone,
  getTimeInTimezone,
  getUserTime,
  isTimeInRange,
  isValidTimezone
} = require('../lib/time-utils');

describe('time-utils', () => {
  test('isValidTimezone validates known IANA timezone names', () => {
    expect(isValidTimezone('Australia/Sydney')).toBe(true);
    expect(isValidTimezone('Invalid/Timezone')).toBe(false);
  });

  test('getAutomationTimezone falls back to provided default for invalid config timezone', () => {
    expect(getAutomationTimezone({ timezone: 'America/New_York' }, 'UTC')).toBe('America/New_York');
    expect(getAutomationTimezone({ timezone: 'Invalid/Timezone' }, 'UTC')).toBe('UTC');
    expect(getAutomationTimezone({}, 'UTC')).toBe('UTC');
  });

  test('getTimeInTimezone returns a Date value', () => {
    const value = getTimeInTimezone('UTC');
    expect(value instanceof Date).toBe(true);
    expect(Number.isNaN(value.getTime())).toBe(false);
  });

  test('isTimeInRange supports same-day and overnight windows', () => {
    expect(isTimeInRange('13:30', '13:00', '14:00')).toBe(true);
    expect(isTimeInRange('12:59', '13:00', '14:00')).toBe(false);
    expect(isTimeInRange('23:30', '22:00', '06:00')).toBe(true);
    expect(isTimeInRange('05:30', '22:00', '06:00')).toBe(true);
    expect(isTimeInRange('07:00', '22:00', '06:00')).toBe(false);
  });

  test('getUserTime and addMinutes produce expected component output', () => {
    const fixedNow = new Date('2026-03-01T12:34:56.000Z');
    const time = getUserTime('UTC', { now: fixedNow, defaultTimezone: 'Australia/Sydney' });

    expect(time.timezone).toBe('UTC');
    expect(time).toMatchObject({
      day: 1,
      month: 3,
      year: 2026,
      hour: 12,
      minute: 34,
      second: 56
    });
    expect(Number.isInteger(time.dayOfWeek)).toBe(true);
    expect(addMinutes(23, 50, 20)).toEqual({ hour: 0, minute: 10 });
  });
});
