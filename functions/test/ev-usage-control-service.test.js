'use strict';

const {
  createEvUsageControlService,
  estimateBillingUnits
} = require('../lib/services/ev-usage-control-service');

describe('ev-usage-control-service', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('blocks per-vehicle live status requests above configured rate window', async () => {
    process.env.EV_TESLA_RATE_WINDOW_MS = '60000';
    process.env.EV_TESLA_RATE_STATUS_PER_WINDOW = '1';

    let nowMs = Date.now();
    const svc = createEvUsageControlService({
      now: () => nowMs
    });

    const first = await svc.assessRouteRequest({
      uid: 'u1',
      vehicleId: 'VIN123',
      action: 'status_live'
    });
    expect(first.blocked).toBe(false);

    const second = await svc.assessRouteRequest({
      uid: 'u1',
      vehicleId: 'VIN123',
      action: 'status_live'
    });
    expect(second.blocked).toBe(true);
    expect(second.reasonCode).toBe('rate_limit_exceeded');
    expect(second.statusCode).toBe(429);

    nowMs += 61000;
    const third = await svc.assessRouteRequest({
      uid: 'u1',
      vehicleId: 'VIN123',
      action: 'status_live'
    });
    expect(third.blocked).toBe(false);
  });

  test('blocks when daily billable budget per vehicle is exceeded', async () => {
    process.env.EV_TESLA_DAILY_BILLABLE_LIMIT_PER_VEHICLE = '1';

    const svc = createEvUsageControlService();
    await svc.recordTeslaApiCall({
      uid: 'u2',
      vehicleId: 'VIN456',
      category: 'data_request',
      status: 200,
      billable: true
    });

    const result = await svc.assessRouteRequest({
      uid: 'u2',
      vehicleId: 'VIN456',
      action: 'status_live'
    });
    expect(result.blocked).toBe(true);
    expect(result.reasonCode).toBe('daily_vehicle_budget_exceeded');
    expect(result.statusCode).toBe(429);
  });

  test('auto degraded mode turns on when per-vehicle monthly units threshold is hit', async () => {
    process.env.EV_TESLA_DEGRADED_MODE = 'auto';
    process.env.EV_TESLA_DEGRADED_UNITS_LIMIT_PER_VEHICLE = '0.01';

    const svc = createEvUsageControlService();
    await svc.recordTeslaApiCall({
      uid: 'u3',
      vehicleId: 'VIN789',
      category: 'wake',
      status: 200,
      billable: true
    });

    const assessed = await svc.assessRouteRequest({
      uid: 'u3',
      vehicleId: 'VIN789',
      action: 'command'
    });
    expect(assessed.blocked).toBe(false);
    expect(assessed.degraded).toBe(true);
    expect(assessed.reasonCode).toBe('vehicle_unit_limit_reached');
  });

  test('estimateBillingUnits maps Tesla categories to unit fractions', () => {
    expect(estimateBillingUnits('data_request', 500)).toBeCloseTo(1, 6);
    expect(estimateBillingUnits('command', 1000)).toBeCloseTo(1, 6);
    expect(estimateBillingUnits('wake', 50)).toBeCloseTo(1, 6);
    expect(estimateBillingUnits('stream_signal', 150000)).toBeCloseTo(1, 6);
    expect(estimateBillingUnits('auth', 100)).toBe(0);
  });

  test('persists Tesla usage under Australia-local metrics date key', async () => {
    const increment = jest.fn((value) => ({ op: 'increment', value }));
    const globalMetricSet = jest.fn(async () => undefined);
    const userMetricSet = jest.fn(async () => undefined);
    const vehicleMetricSet = jest.fn(async () => undefined);
    let globalDayKey = '';
    let userDayKey = '';
    let vehicleDayKey = '';

    const globalMetricsCollectionRef = {
      doc: jest.fn((dayKey) => {
        globalDayKey = dayKey;
        return { set: globalMetricSet };
      })
    };

    const userMetricsCollectionRef = {
      doc: jest.fn((dayKey) => {
        userDayKey = dayKey;
        return { set: userMetricSet };
      })
    };
    const vehicleMetricsCollectionRef = {
      doc: jest.fn((dayKey) => {
        vehicleDayKey = dayKey;
        return { set: vehicleMetricSet };
      })
    };
    const vehicleDocRef = {
      collection: jest.fn((name) => {
        if (name !== 'metrics') throw new Error(`Unexpected nested collection: ${name}`);
        return vehicleMetricsCollectionRef;
      })
    };
    const vehiclesCollectionRef = {
      doc: jest.fn(() => vehicleDocRef)
    };
    const userDocRef = {
      collection: jest.fn((name) => {
        if (name === 'metrics') return userMetricsCollectionRef;
        if (name === 'vehicles') return vehiclesCollectionRef;
        throw new Error(`Unexpected collection: ${name}`);
      })
    };
    const usersCollectionRef = {
      doc: jest.fn(() => userDocRef)
    };
    const db = {
      collection: jest.fn((name) => {
        if (name === 'metrics') return globalMetricsCollectionRef;
        if (name !== 'users') throw new Error(`Unexpected root collection: ${name}`);
        return usersCollectionRef;
      })
    };

    const utcLateEvening = Date.parse('2026-03-13T13:30:00.000Z'); // AU local date is 2026-03-14
    const svc = createEvUsageControlService({
      admin: {
        firestore: {
          FieldValue: {
            increment,
            serverTimestamp: () => '__TS__'
          }
        }
      },
      db,
      now: () => utcLateEvening
    });

    await svc.recordTeslaApiCall({
      uid: 'u-metrics',
      vehicleId: 'VIN-AU-1',
      category: 'command',
      status: 200,
      billable: true
    });

    expect(usersCollectionRef.doc).toHaveBeenCalledWith('u-metrics');
    expect(globalDayKey).toBe('2026-03-14');
    expect(userDayKey).toBe('2026-03-14');
    expect(vehicleDayKey).toBe('2026-03-14');
    expect(globalMetricSet).toHaveBeenCalled();
    expect(userMetricSet).toHaveBeenCalled();
    expect(vehicleMetricSet).toHaveBeenCalled();

    const [globalPayload, globalOptions] = globalMetricSet.mock.calls[0];
    expect(globalPayload['teslaFleet.calls.total']).toEqual({ op: 'increment', value: 1 });
    expect(globalPayload['teslaFleet.calls.billable']).toEqual({ op: 'increment', value: 1 });
    expect(globalPayload['teslaFleet.calls.byCategory.command']).toEqual({ op: 'increment', value: 1 });
    expect(globalPayload['teslaFleet.calls.byStatus.s200']).toEqual({ op: 'increment', value: 1 });
    expect(globalOptions).toEqual({ merge: true });
  });
});
