const request = require('supertest');

let mockRules = [];
const mockVerifyIdToken = jest.fn().mockResolvedValue({ uid: 'test-user-automation' });

const mockDb = {
  collection: jest.fn(() => mockDb),
  doc: jest.fn(() => mockDb),
  get: jest.fn(async () => ({
    forEach: (callback) => {
      mockRules.forEach((entry) => {
        callback({
          id: entry.id,
          data: () => entry.data
        });
      });
    }
  })),
  set: jest.fn(() => Promise.resolve()),
  update: jest.fn(() => Promise.resolve()),
  add: jest.fn(() => Promise.resolve()),
  delete: jest.fn(() => Promise.resolve()),
  where: jest.fn(() => mockDb),
  orderBy: jest.fn(() => mockDb),
  limit: jest.fn(() => mockDb)
};

jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  firestore: jest.fn(() => mockDb),
  auth: jest.fn(() => ({
    verifyIdToken: mockVerifyIdToken
  })),
  FieldValue: {
    serverTimestamp: jest.fn(() => new Date())
  },
  apps: []
}));

jest.mock('firebase-functions', () => ({
  ...jest.requireActual('firebase-functions'),
  config: jest.fn(() => ({
    foxess: { token: '', base_url: 'https://www.foxesscloud.com' },
    amber: { api_key: '', base_url: 'https://api.amber.com.au/v1' }
  }))
}));

describe('Automation Test Endpoint', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRules = [];
    delete require.cache[require.resolve('../index.js')];
    app = require('../index.js').app;
  });

  test('triggers forecast temperature rule using dailyMaxTemps/dayOffset', async () => {
    mockRules = [
      {
        id: 'disabled_high_priority',
        data: {
          name: 'Disabled Rule',
          enabled: false,
          priority: 0,
          conditions: {
            temperature: { enabled: true, type: 'forecastMax', operator: '>=', value: 35, dayOffset: 2 }
          }
        }
      },
      {
        id: 'forecast_rule',
        data: {
          name: 'Forecast Trigger',
          enabled: true,
          priority: 1,
          conditions: {
            temperature: { enabled: true, type: 'forecastMax', operator: '>=', value: 31, dayOffset: 2 }
          },
          action: { workMode: 'ForceDischarge', durationMinutes: 30 }
        }
      }
    ];

    const response = await request(app)
      .post('/api/automation/test')
      .set('Authorization', 'Bearer valid-token')
      .send({
        mockData: {
          dailyMaxTemps: [26, 29, 33],
          dailyMinTemps: [15, 16, 17],
          batteryTemp: 25,
          ambientTemp: 26
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.triggered).toBe(true);
    expect(response.body.result.ruleId).toBe('forecast_rule');
    expect(response.body.allResults[0].conditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Forecast Max Temp (D+2)',
          value: 33,
          target: 31,
          met: true
        })
      ])
    );
  });

  test('respects selected weekdays in time conditions', async () => {
    mockRules = [
      {
        id: 'weekday_rule',
        data: {
          name: 'Weekday Morning Rule',
          enabled: true,
          priority: 1,
          conditions: {
            time: {
              enabled: true,
              startTime: '09:00',
              endTime: '11:00',
              days: [1] // Monday
            }
          },
          action: { workMode: 'SelfUse', durationMinutes: 20 }
        }
      }
    ];

    const mondayResponse = await request(app)
      .post('/api/automation/test')
      .set('Authorization', 'Bearer valid-token')
      .send({
        mockData: {
          testTime: '10:15',
          testDayOfWeek: 1
        }
      });

    expect(mondayResponse.status).toBe(200);
    expect(mondayResponse.body.triggered).toBe(true);

    const sundayResponse = await request(app)
      .post('/api/automation/test')
      .set('Authorization', 'Bearer valid-token')
      .send({
        mockData: {
          testTime: '10:15',
          testDayOfWeek: 0
        }
      });

    expect(sundayResponse.status).toBe(200);
    expect(sundayResponse.body.triggered).toBe(false);
    expect(sundayResponse.body.allResults[0].conditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Time Window',
          target: '09:00-11:00 (Mon)',
          met: false
        })
      ])
    );
  });

  test('supports weekday name aliases in mock day input', async () => {
    mockRules = [
      {
        id: 'thursday_rule',
        data: {
          name: 'Thursday Rule',
          enabled: true,
          priority: 1,
          conditions: {
            timeWindow: {
              enabled: true,
              start: '06:00',
              end: '23:00',
              days: ['thu']
            }
          },
          action: { workMode: 'ForceCharge', durationMinutes: 15 }
        }
      }
    ];

    const response = await request(app)
      .post('/api/automation/test')
      .set('Authorization', 'Bearer valid-token')
      .send({
        mockData: {
          testTime: '09:45',
          dayOfWeek: 'Thursday'
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.triggered).toBe(true);
    expect(response.body.result.ruleId).toBe('thursday_rule');
  });

  test('returns non-triggered with reason when forecast day offset is out of range', async () => {
    mockRules = [
      {
        id: 'forecast_missing_day',
        data: {
          name: 'Forecast Missing Day',
          enabled: true,
          priority: 1,
          conditions: {
            temp: {
              enabled: true,
              type: 'forecastMin',
              operator: '<=',
              value: 10,
              dayOffset: 4
            }
          },
          action: { workMode: 'Backup', durationMinutes: 10 }
        }
      }
    ];

    const response = await request(app)
      .post('/api/automation/test')
      .set('Authorization', 'Bearer valid-token')
      .send({
        mockData: {
          weatherData: {
            daily: {
              temperature_2m_min: [17, 16],
              temperature_2m_max: [28, 27]
            }
          }
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.triggered).toBe(false);
    expect(response.body.allResults[0].conditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Temperature',
          met: false,
          reason: expect.stringContaining('No forecast data for day offset 4')
        })
      ])
    );
  });
});
