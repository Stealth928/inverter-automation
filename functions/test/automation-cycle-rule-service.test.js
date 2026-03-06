'use strict';

const {
  buildWeatherFetchPlan,
  evaluateBlackoutWindow,
  hasWeatherDependentRules,
  parseWindowTimeToMinutes
} = require('../lib/services/automation-cycle-rule-service');

describe('automation cycle rule service', () => {
  test('parseWindowTimeToMinutes parses HH:mm values', () => {
    expect(parseWindowTimeToMinutes('00:00')).toBe(0);
    expect(parseWindowTimeToMinutes('05:30')).toBe(330);
    expect(parseWindowTimeToMinutes('23:59')).toBe(1439);
  });

  test('evaluateBlackoutWindow returns no blackout when list is empty', () => {
    expect(evaluateBlackoutWindow([], 540)).toEqual({
      currentBlackoutWindow: null,
      inBlackout: false
    });
  });

  test('evaluateBlackoutWindow matches same-day window', () => {
    const window = { start: '09:00', end: '11:00' };

    expect(evaluateBlackoutWindow([window], 601)).toEqual({
      currentBlackoutWindow: window,
      inBlackout: true
    });
    expect(evaluateBlackoutWindow([window], 661)).toEqual({
      currentBlackoutWindow: null,
      inBlackout: false
    });
  });

  test('evaluateBlackoutWindow matches midnight-wrapping window', () => {
    const window = { start: '22:00', end: '06:00' };

    expect(evaluateBlackoutWindow([window], 30)).toEqual({
      currentBlackoutWindow: window,
      inBlackout: true
    });
    expect(evaluateBlackoutWindow([window], 1380)).toEqual({
      currentBlackoutWindow: window,
      inBlackout: true
    });
    expect(evaluateBlackoutWindow([window], 720)).toEqual({
      currentBlackoutWindow: null,
      inBlackout: false
    });
  });

  test('evaluateBlackoutWindow ignores explicitly disabled windows', () => {
    const disabled = { enabled: false, start: '00:00', end: '23:59' };
    const active = { enabled: true, start: '12:00', end: '13:00' };

    expect(evaluateBlackoutWindow([disabled, active], 750)).toEqual({
      currentBlackoutWindow: active,
      inBlackout: true
    });
  });

  test('hasWeatherDependentRules detects weather-dependent conditions', () => {
    const enabledRules = [
      ['rule-1', { conditions: { soc: { enabled: true } } }],
      ['rule-2', { conditions: { cloudCover: { enabled: true } } }]
    ];

    expect(hasWeatherDependentRules(enabledRules, () => false)).toBe(true);
  });

  test('hasWeatherDependentRules detects forecast temperature conditions via callback', () => {
    const enabledRules = [
      ['rule-1', {
        conditions: {
          temperature: { enabled: true, type: 'forecast_daily_max', dayOffset: 2 }
        }
      }]
    ];

    expect(hasWeatherDependentRules(enabledRules, (type) => type === 'forecast_daily_max')).toBe(true);
    expect(hasWeatherDependentRules(enabledRules, () => false)).toBe(false);
  });

  test('buildWeatherFetchPlan returns no fetch when weather is not needed', () => {
    const enabledRules = [
      ['rule-1', { conditions: { soc: { enabled: true } } }]
    ];

    expect(buildWeatherFetchPlan({
      enabledRules,
      isForecastTemperatureType: () => false
    })).toEqual({
      daysToFetch: 0,
      maxDaysNeeded: 0,
      needsWeatherData: false
    });
  });

  test('buildWeatherFetchPlan computes look-ahead and clamps max days', () => {
    const enabledRules = [
      ['rule-1', {
        conditions: {
          solarRadiation: { enabled: true, lookAhead: 30, lookAheadUnit: 'hours' }
        }
      }],
      ['rule-2', {
        conditions: {
          cloudCover: { enabled: true, lookAhead: 3, lookAheadUnit: 'days' }
        }
      }],
      ['rule-3', {
        conditions: {
          temp: { enabled: true, type: 'forecast_daily_max', dayOffset: 20 }
        }
      }]
    ];

    expect(buildWeatherFetchPlan({
      enabledRules,
      isForecastTemperatureType: (type) => type === 'forecast_daily_max'
    })).toEqual({
      daysToFetch: 11,
      maxDaysNeeded: 11,
      needsWeatherData: true
    });
  });
});
