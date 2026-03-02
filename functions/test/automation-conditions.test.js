const {
  normalizeWeekdays,
  evaluateTimeCondition,
  evaluateTemperatureCondition,
  isForecastTemperatureType,
  getWeekdayIndexInTimezone
} = require('../lib/automation-conditions');

describe('automation-conditions', () => {
  describe('normalizeWeekdays', () => {
    test('normalizes numeric and string values with dedupe', () => {
      const result = normalizeWeekdays([1, '2', 'mon', 'Monday', 'sun', 0, '9', 'bad']);
      expect(result).toEqual([0, 1, 2]);
    });
  });

  describe('evaluateTimeCondition', () => {
    test('matches normal window when day is allowed', () => {
      const result = evaluateTimeCondition(
        {
          enabled: true,
          startTime: '09:00',
          endTime: '17:00',
          days: [1, 2, 3, 4, 5]
        },
        {
          userTime: { hour: 10, minute: 30, dayOfWeek: 1 }
        }
      );

      expect(result.met).toBe(true);
      expect(result.dayMatched).toBe(true);
      expect(result.inWindow).toBe(true);
    });

    test('rejects when day does not match', () => {
      const result = evaluateTimeCondition(
        {
          enabled: true,
          startTime: '09:00',
          endTime: '17:00',
          days: [1, 2, 3, 4, 5]
        },
        {
          userTime: { hour: 10, minute: 30, dayOfWeek: 0 }
        }
      );

      expect(result.met).toBe(false);
      expect(result.dayMatched).toBe(false);
      expect(result.inWindow).toBe(true);
    });

    test('supports overnight windows', () => {
      const result = evaluateTimeCondition(
        {
          enabled: true,
          startTime: '22:00',
          endTime: '06:00',
          days: []
        },
        {
          userTime: { hour: 1, minute: 15, dayOfWeek: 2 }
        }
      );

      expect(result.met).toBe(true);
      expect(result.inWindow).toBe(true);
      expect(result.daysLabel).toBe('Every day');
    });

    test('normalizes weekday names for day matching', () => {
      const result = evaluateTimeCondition(
        {
          enabled: true,
          startTime: '08:00',
          endTime: '12:00',
          days: ['Mon', 'wednesday', 'fri']
        },
        {
          userTime: { hour: 9, minute: 0, dayOfWeek: 1 }
        }
      );

      expect(result.met).toBe(true);
      expect(result.days).toEqual([1, 3, 5]);
      expect(result.daysLabel).toBe('Mon, Wed, Fri');
    });
  });

  describe('evaluateTemperatureCondition', () => {
    test('uses forecast daily max with day offset', () => {
      const result = evaluateTemperatureCondition(
        {
          enabled: true,
          type: 'forecastMax',
          operator: '>=',
          value: 31,
          dayOffset: 1
        },
        {
          weatherData: {
            daily: {
              temperature_2m_max: [29, 33, 30],
              temperature_2m_min: [18, 19, 17]
            }
          }
        }
      );

      expect(result.met).toBe(true);
      expect(result.actual).toBe(33);
      expect(result.source).toBe('weather_daily');
      expect(result.metric).toBe('max');
      expect(result.dayOffset).toBe(1);
    });

    test('returns reason when forecast data missing', () => {
      const result = evaluateTemperatureCondition(
        {
          enabled: true,
          type: 'forecastMin',
          operator: '<=',
          value: 10,
          dayOffset: 2
        },
        {
          weatherData: {
            daily: {
              temperature_2m_max: [30],
              temperature_2m_min: [20]
            }
          }
        }
      );

      expect(result.met).toBe(false);
      expect(result.reason).toContain('No forecast data');
    });

    test('falls back to battery/ambient temps for non-forecast types', () => {
      const batteryResult = evaluateTemperatureCondition(
        { enabled: true, type: 'battery', operator: '<', value: 40 },
        { batteryTemp: 32, ambientTemp: 45 }
      );

      const ambientResult = evaluateTemperatureCondition(
        { enabled: true, type: 'ambient', operator: '>=', value: 30 },
        { batteryTemp: 32, ambientTemp: 45 }
      );

      expect(batteryResult.met).toBe(true);
      expect(batteryResult.actual).toBe(32);
      expect(ambientResult.met).toBe(true);
      expect(ambientResult.actual).toBe(45);
    });

    test('supports between operator for forecast temperature', () => {
      const result = evaluateTemperatureCondition(
        {
          enabled: true,
          type: 'forecastMin',
          operator: 'between',
          value: 15,
          value2: 20,
          dayOffset: 0
        },
        {
          weatherData: {
            daily: {
              temperature_2m_max: [29],
              temperature_2m_min: [18]
            }
          }
        }
      );

      expect(result.met).toBe(true);
      expect(result.actual).toBe(18);
      expect(result.target).toBe(15);
      expect(result.target2).toBe(20);
    });

    test('parses dayOffset from string values', () => {
      const result = evaluateTemperatureCondition(
        {
          enabled: true,
          type: 'forecastMax',
          operator: '>',
          value: 30,
          dayOffset: '2'
        },
        {
          weatherData: {
            daily: {
              temperature_2m_max: [26, 28, 31]
            }
          }
        }
      );

      expect(result.met).toBe(true);
      expect(result.dayOffset).toBe(2);
      expect(result.actual).toBe(31);
    });
  });

  describe('isForecastTemperatureType', () => {
    test('detects supported forecast type aliases', () => {
      expect(isForecastTemperatureType('forecastMax')).toBe(true);
      expect(isForecastTemperatureType('forecast_min')).toBe(true);
      expect(isForecastTemperatureType('dailyMax')).toBe(true);
      expect(isForecastTemperatureType('battery')).toBe(false);
    });
  });

  describe('getWeekdayIndexInTimezone', () => {
    test('returns stable weekday index for a fixed UTC instant', () => {
      const fixedDate = new Date('2026-03-02T12:00:00.000Z'); // Monday in UTC
      const result = getWeekdayIndexInTimezone('UTC', fixedDate);
      expect(result).toBe(1); // Monday
    });
  });
});
