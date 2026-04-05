'use strict';

const {
  collectUnsupportedConditions,
  createBacktestService,
  normalizeTariffPlanModel,
  simulateRuleSet,
  validateBacktestPeriod
} = require('../lib/services/backtest-service');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createSnapshot(id, data) {
  const stored = clone(data);
  return {
    id,
    exists: stored !== undefined,
    data: () => clone(stored)
  };
}

function matchesQuery(value, operator, expected) {
  if (operator === 'in') return Array.isArray(expected) && expected.includes(value);
  if (operator === '>=') return Number(value) >= Number(expected);
  if (operator === '<') return Number(value) < Number(expected);
  return value === expected;
}

function buildQuery(getEntries, state = {}) {
  const filters = Array.isArray(state.filters) ? state.filters : [];
  const order = state.order || null;
  const limitValue = Number.isFinite(Number(state.limitValue)) ? Number(state.limitValue) : null;
  return {
    where(field, operator, value) {
      return buildQuery(getEntries, { filters: filters.concat([{ field, operator, value }]), order, limitValue });
    },
    orderBy(field, direction = 'asc') {
      return buildQuery(getEntries, { filters, order: { field, direction }, limitValue });
    },
    limit(value) {
      return buildQuery(getEntries, { filters, order, limitValue: value });
    },
    async get() {
      let entries = getEntries();
      filters.forEach(({ field, operator, value }) => {
        entries = entries.filter(([, data]) => matchesQuery(data?.[field], operator, value));
      });
      if (order) {
        const multiplier = order.direction === 'desc' ? -1 : 1;
        entries = entries.slice().sort((left, right) => {
          const leftValue = left[1]?.[order.field];
          const rightValue = right[1]?.[order.field];
          if (leftValue === rightValue) return 0;
          return leftValue > rightValue ? multiplier : -multiplier;
        });
      }
      if (limitValue !== null) entries = entries.slice(0, limitValue);
      return {
        size: entries.length,
        docs: entries.map(([id, data]) => createSnapshot(id, data))
      };
    }
  };
}

function createDocRef(store, id) {
  return {
    id,
    async get() {
      return createSnapshot(id, store.get(id));
    },
    async set(data, options = {}) {
      const next = clone(data);
      if (options && options.merge) {
        store.set(id, { ...(store.get(id) || {}), ...(next || {}) });
      } else {
        store.set(id, next);
      }
    },
    async delete() {
      store.delete(id);
    }
  };
}

function createCollectionRef(store, prefix, counters) {
  return {
    doc(id) {
      const resolvedId = id || `${prefix}-${++counters[prefix]}`;
      return createDocRef(store, resolvedId);
    },
    where(field, operator, value) {
      return buildQuery(() => Array.from(store.entries())).where(field, operator, value);
    },
    orderBy(field, direction = 'asc') {
      return buildQuery(() => Array.from(store.entries())).orderBy(field, direction);
    },
    limit(value) {
      return buildQuery(() => Array.from(store.entries())).limit(value);
    },
    async get() {
      return buildQuery(() => Array.from(store.entries())).get();
    }
  };
}

function buildBacktestDbHarness({ runs = [], dailyUsage = {} } = {}) {
  const runStore = new Map((Array.isArray(runs) ? runs : []).map((entry) => [entry.id, clone(entry.data)]));
  const usageStore = new Map(Object.entries(dailyUsage || {}).map(([id, data]) => [id, clone(data)]));
  const tariffStore = new Map();
  const counters = { run: runStore.size, usage: usageStore.size, tariff: 0 };
  const runsRef = createCollectionRef(runStore, 'run', counters);
  const usageRef = createCollectionRef(usageStore, 'usage', counters);
  const tariffRef = createCollectionRef(tariffStore, 'tariff', counters);

  return {
    runStore,
    usageStore,
    db: {
      collection: jest.fn((name) => {
        if (name !== 'users') throw new Error(`Unexpected collection: ${name}`);
        return {
          doc: jest.fn(() => ({
            collection: jest.fn((subName) => {
              if (subName !== 'backtests') throw new Error(`Unexpected subcollection: ${subName}`);
              return {
                doc: jest.fn((docName) => {
                  if (docName === 'runs') return { collection: jest.fn(() => runsRef) };
                  if (docName === 'usage') return { collection: jest.fn(() => usageRef) };
                  if (docName === 'tariffPlans') return { collection: jest.fn(() => tariffRef) };
                  throw new Error(`Unexpected backtests doc: ${docName}`);
                })
              };
            })
          }))
        };
      }),
      runTransaction: jest.fn(async (handler) => handler({
        get: async (ref) => ref.get(),
        set: async (ref, data, options) => ref.set(data, options),
        update: async (ref, data) => ref.set(data, { merge: true })
      }))
    }
  };
}

function buildServiceForCreateFlow(db, overrides = {}) {
  return createBacktestService({
    adapterRegistry: overrides.adapterRegistry || {
      getTariffProvider: jest.fn(() => null),
      getDeviceProvider: jest.fn(() => null)
    },
    db,
    foxessAPI: overrides.foxessAPI || {
      callFoxESSAPI: jest.fn(async () => ({ errno: 0, result: [{ datas: [] }] }))
    },
    getConfig: overrides.getConfig || (() => ({
      automation: {
        backtesting: {
          replayIntervalMinutes: 5,
          maxLookbackDays: 365,
          maxScenarios: 3,
          maxActiveRuns: 2,
          maxSavedRuns: 5,
          maxRunsPerDay: 5,
          runTtlMs: 30 * 24 * 60 * 60 * 1000,
          ...(overrides.runtimeConfig || {})
        }
      }
    })),
    getHistoricalWeather: overrides.getHistoricalWeather || jest.fn(async () => ({
      hourly: { time: [] },
      daily: { time: [] }
    })),
    getUserConfig: overrides.getUserConfig || jest.fn(async () => ({
      timezone: 'Australia/Sydney',
      pricingProvider: 'amber',
      deviceProvider: 'foxess',
      deviceSn: 'FOX-SEED-1001',
      batteryCapacityKWh: 10,
      inverterCapacityW: 5000,
      defaults: { minSocOnGrid: 20 },
      automation: { blackoutWindows: [] }
    })),
    getUserRules: overrides.getUserRules || jest.fn(async () => ({}))
  });
}

describe('backtest service helpers', () => {
  test('collectUnsupportedConditions flags EV and temperature history rules', () => {
    const issues = collectUnsupportedConditions({
      rules: {
        ev_rule: {
          name: 'EV rule',
          conditions: {
            evVehicleSoC: { enabled: true }
          }
        },
        temp_rule: {
          name: 'Temp rule',
          conditions: {
            temperature: { enabled: true, type: 'battery', operator: '>', value: 35 }
          }
        },
        ambient_rule: {
          name: 'Ambient rule',
          conditions: {
            temperature: { enabled: true, type: 'ambient', operator: '<=', value: 10 }
          }
        }
      }
    });

    expect(issues).toHaveLength(2);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ruleId: 'ev_rule',
        reason: 'EV conditions are not supported in Stage 1 backtesting'
      }),
      expect.objectContaining({
        ruleId: 'temp_rule',
        reason: 'Battery temperature history is not supported in Stage 1 backtesting'
      })
    ]));
  });

  test('normalizeTariffPlanModel keeps only valid windows', () => {
    const plan = normalizeTariffPlanModel({
      name: 'Flat plan',
      timezone: 'Australia/Sydney',
      dailySupplyCharge: 120,
      importWindows: [
        { startTime: '00:00', endTime: '23:59', centsPerKwh: 30 },
        { startTime: 'bad', endTime: '23:59', centsPerKwh: 30 }
      ],
      exportWindows: [
        { startTime: '00:00', endTime: '23:59', centsPerKwh: 10 }
      ]
    });

    expect(plan).toEqual(expect.objectContaining({
      name: 'Flat plan',
      timezone: 'Australia/Sydney',
      dailySupplyCharge: 120
    }));
    expect(plan.importWindows).toHaveLength(1);
    expect(plan.exportWindows).toHaveLength(1);
  });

  test('validateBacktestPeriod rejects ranges longer than 90 days', () => {
    expect(() => validateBacktestPeriod({
      startDate: '2026-01-01',
      endDate: '2026-04-01'
    }, {
      nowMs: Date.parse('2026-04-02T12:00:00Z'),
      maxLookbackDays: 365,
      maxRangeDays: 90
    })).toThrow('Backtest periods cannot exceed 90 days');
  });

  test('validateBacktestPeriod rejects dates older than the 90-day lookback window', () => {
    expect(() => validateBacktestPeriod({
      startDate: '2025-12-31',
      endDate: '2026-02-15'
    }, {
      nowMs: Date.parse('2026-04-02T12:00:00Z'),
      maxLookbackDays: 90,
      maxRangeDays: 90
    })).toThrow('Backtests are limited to the last 90 days');
  });

  test('simulateRuleSet respects priority order and first-match wins', () => {
    const baseConditions = {
      solarRadiation: { enabled: false },
      cloudCover: { enabled: false },
      forecastPrice: { enabled: false },
      time: { enabled: false },
      temperature: { enabled: false },
      soc: { enabled: false }
    };
    const result = simulateRuleSet({
      scenario: {
        id: 'scenario-1',
        name: 'Priority test',
        ruleSetSnapshot: {
          rules: {
            charge_first: {
              name: 'Charge first',
              enabled: true,
              priority: 1,
              cooldownMinutes: 30,
              conditions: {
                ...baseConditions,
                buyPrice: { enabled: true, operator: '<=', value: 30 },
                feedInPrice: { enabled: false }
              },
              action: {
                workMode: 'ForceCharge',
                durationMinutes: 30,
                fdPwr: 5000,
                fdSoc: 100,
                minSocOnGrid: 20,
                maxSoc: 100
              }
            },
            discharge_second: {
              name: 'Discharge second',
              enabled: true,
              priority: 2,
              cooldownMinutes: 30,
              conditions: {
                ...baseConditions,
                buyPrice: { enabled: false },
                feedInPrice: { enabled: true, operator: '>=', value: 0 }
              },
              action: {
                workMode: 'ForceDischarge',
                durationMinutes: 30,
                fdPwr: 5000,
                fdSoc: 20,
                minSocOnGrid: 20,
                maxSoc: 100
              }
            }
          }
        }
      },
      userConfig: {
        timezone: 'Australia/Sydney',
        batteryCapacityKWh: 10,
        inverterCapacityW: 5000,
        defaults: { minSocOnGrid: 20 },
        automation: { blackoutWindows: [] }
      },
      gridMs: [
        Date.parse('2026-01-15T00:00:00.000Z'),
        Date.parse('2026-01-15T00:05:00.000Z')
      ],
      stepMs: 5 * 60 * 1000,
      inputSeries: {
        solarKw: [0, 0],
        loadKw: [0, 0]
      },
      weatherIndices: {
        hourlyIndex: [],
        dailyMap: new Map()
      },
      tariffLookup: {
        dailySupplyCharge: 0,
        lookup: jest.fn(() => ({
          buyCentsPerKwh: 20,
          feedInCentsPerKwh: 5
        })),
        window: jest.fn(() => [])
      },
      initialSocPct: 50,
      timezone: 'Australia/Sydney'
    });

    expect(result.triggerCount).toBe(1);
    expect(result.winningRuleMix[0]).toEqual(expect.objectContaining({
      ruleId: 'charge_first',
      triggerCount: 1,
      activeIntervals: 2
    }));
  });

  test('simulateRuleSet supports ambient temperature history without extra providers', () => {
    const result = simulateRuleSet({
      scenario: {
        id: 'scenario-ambient',
        name: 'Ambient support',
        ruleSetSnapshot: {
          rules: {
            winter_self_use: {
              name: 'Winter Self-Use Override',
              enabled: true,
              priority: 1,
              cooldownMinutes: 30,
              conditions: {
                feedInPrice: { enabled: false },
                buyPrice: { enabled: false },
                soc: { enabled: true, operator: '>=', value: 20 },
                temperature: { enabled: true, type: 'ambient', operator: '<=', value: 10 },
                solarRadiation: { enabled: false },
                cloudCover: { enabled: false },
                forecastPrice: { enabled: false },
                time: { enabled: true, startTime: '06:00', endTime: '09:00' }
              },
              action: {
                workMode: 'SelfUse',
                durationMinutes: 180,
                fdPwr: 0,
                fdSoc: 30,
                minSocOnGrid: 30,
                maxSoc: 100
              }
            }
          }
        }
      },
      userConfig: {
        timezone: 'Australia/Sydney',
        batteryCapacityKWh: 10,
        inverterCapacityW: 5000,
        defaults: { minSocOnGrid: 20 },
        automation: { blackoutWindows: [] }
      },
      gridMs: [
        Date.parse('2026-06-01T20:00:00.000Z'),
        Date.parse('2026-06-01T20:05:00.000Z')
      ],
      stepMs: 5 * 60 * 1000,
      inputSeries: {
        solarKw: [0, 0],
        loadKw: [0.5, 0.5]
      },
      weatherIndices: {
        hourlyIndex: [],
        dailyMap: new Map(),
        ambientTemperatureSeries: [8, 8]
      },
      tariffLookup: {
        dailySupplyCharge: 0,
        lookup: jest.fn(() => ({
          buyCentsPerKwh: 25,
          feedInCentsPerKwh: 5
        })),
        window: jest.fn(() => [])
      },
      initialSocPct: 50,
      timezone: 'Australia/Sydney'
    });

    expect(result.triggerCount).toBe(1);
    expect(result.winningRuleMix[0]).toEqual(expect.objectContaining({
      ruleId: 'winter_self_use',
      triggerCount: 1,
      activeIntervals: 2
    }));
  });

  test('listRuns returns lightweight report previews without chart payloads', async () => {
    const harness = buildBacktestDbHarness({
      runs: [{
        id: 'run-preview',
        data: {
          type: 'backtestRun',
          status: 'completed',
          requestedAtMs: 123,
          request: { period: { startDate: '2026-03-01', endDate: '2026-03-02' } },
          result: {
            summaries: [
              {
                scenarioId: 'current',
                scenarioName: 'Current rules',
                totalBillAud: 4.21,
                deltaVsBaseline: {
                  billAud: 1.34,
                  importKWh: 2.1
                },
                chart: {
                  points: [{ timestampMs: 1, solarKw: 0.5 }]
                },
                winningRuleMix: [{ ruleId: 'rule-1', triggerCount: 4 }]
              },
              {
                scenarioId: 'baseline',
                scenarioName: 'Baseline',
                totalBillAud: 5.55,
                chart: {
                  points: [{ timestampMs: 1, solarKw: 0.1 }]
                }
              }
            ],
            comparisons: [{ leftScenarioId: 'baseline', rightScenarioId: 'current' }]
          }
        }
      }]
    });
    const service = buildServiceForCreateFlow(harness.db);

    const runs = await service.listRuns('user-1', 20);

    expect(runs).toEqual([expect.objectContaining({
      id: 'run-preview',
      status: 'completed',
      result: {
        summaries: [
          {
            scenarioId: 'current',
            scenarioName: 'Current rules',
            totalBillAud: 4.21,
            deltaVsBaseline: { billAud: 1.34 }
          },
          {
            scenarioId: 'baseline',
            scenarioName: 'Baseline',
            totalBillAud: 5.55,
            deltaVsBaseline: undefined
          }
        ]
      }
    })]);
    expect(runs[0].result.comparisons).toBeUndefined();
    expect(runs[0].result.summaries[0].chart).toBeUndefined();
  });

  test('listRuns preserves structured failure details for saved reports', async () => {
    const harness = buildBacktestDbHarness({
      runs: [{
        id: 'run-failed',
        data: {
          type: 'backtestRun',
          status: 'failed',
          requestedAtMs: 456,
          request: { period: { startDate: '2026-03-01', endDate: '2026-03-02' } },
          error: 'Amber provider authentication failed',
          errorDetails: {
            provider: 'amber',
            errno: 3202,
            providerErrno: 401
          }
        }
      }]
    });
    const service = buildServiceForCreateFlow(harness.db);

    const runs = await service.listRuns('user-1', 20);

    expect(runs).toEqual([expect.objectContaining({
      id: 'run-failed',
      status: 'failed',
      error: 'Amber provider authentication failed',
      errorDetails: {
        provider: 'amber',
        errno: 3202,
        providerErrno: 401
      }
    })]);
  });

  test('listRuns reconciles stale running reports to failed infrastructure errors', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-05T13:40:00.000Z'));
    try {
      const harness = buildBacktestDbHarness({
        runs: [{
          id: 'run-stale',
          data: {
            type: 'backtestRun',
            status: 'running',
            requestedAtMs: Date.parse('2026-04-05T13:00:00.000Z'),
            startedAtMs: Date.parse('2026-04-05T13:10:00.000Z'),
            request: { period: { startDate: '2026-03-07', endDate: '2026-04-05' } },
            error: null,
            errorDetails: null
          }
        }]
      });
      const service = buildServiceForCreateFlow(harness.db, {
        runtimeConfig: {
          staleRunningRunMs: 5 * 60 * 1000
        }
      });

      const runs = await service.listRuns('user-1', 20);

      expect(runs).toEqual([expect.objectContaining({
        id: 'run-stale',
        status: 'failed',
        error: expect.stringContaining('stopped before the replay completed'),
        errorDetails: expect.objectContaining({
          category: 'infrastructure',
          reason: 'stale-run',
          lastStatus: 'running'
        })
      })]);
      expect(harness.runStore.get('run-stale')).toEqual(expect.objectContaining({
        status: 'failed',
        errorDetails: expect.objectContaining({
          category: 'infrastructure',
          reason: 'stale-run',
          lastStatus: 'running'
        })
      }));
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('createRun rejects when report history already has five saved backtests', async () => {
    const harness = buildBacktestDbHarness({
      runs: Array.from({ length: 5 }, (_, index) => ({
        id: `run-${index + 1}`,
        data: {
          status: 'completed',
          requestedAtMs: 5000 - index,
          request: { period: { startDate: '2026-03-01', endDate: '2026-03-02' } }
        }
      }))
    });
    const service = buildServiceForCreateFlow(harness.db);

    await expect(service.createRun('user-1', {})).rejects.toThrow('Delete one from history before running another');
  });

  test('createRun enforces the per-day report limit even when history is empty', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-02T04:00:00.000Z'));
    try {
      const harness = buildBacktestDbHarness({
        dailyUsage: {
          '2026-04-02': {
            dateKey: '2026-04-02',
            count: 5,
            createdAtMs: Date.parse('2026-04-02T00:00:00.000Z'),
            updatedAtMs: Date.parse('2026-04-02T03:00:00.000Z')
          }
        }
      });
      const service = buildServiceForCreateFlow(harness.db);

      await expect(service.createRun('user-1', {
        period: {
          startDate: '2026-04-01',
          endDate: '2026-04-02'
        }
      })).rejects.toThrow('You can generate up to 5 backtest reports per day');
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('createRun skips the per-day report limit for admins', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-02T04:00:00.000Z'));
    try {
      const harness = buildBacktestDbHarness({
        dailyUsage: {
          '2026-04-02': {
            dateKey: '2026-04-02',
            count: 5,
            createdAtMs: Date.parse('2026-04-02T00:00:00.000Z'),
            updatedAtMs: Date.parse('2026-04-02T03:00:00.000Z')
          }
        }
      });
      const service = buildServiceForCreateFlow(harness.db);

      await expect(service.createRun('user-1', {
        period: {
          startDate: '2026-04-01',
          endDate: '2026-04-02'
        }
      }, {
        isAdmin: true
      })).resolves.toMatchObject({ status: 'queued' });

      expect(harness.runStore.size).toBe(1);
      expect(harness.usageStore.get('2026-04-02')).toMatchObject({ count: 5 });
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('createRun ignores stale active reports when enforcing active run limits', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-05T13:40:00.000Z'));
    try {
      const harness = buildBacktestDbHarness({
        runs: [{
          id: 'run-stale-active',
          data: {
            type: 'backtestRun',
            status: 'running',
            requestedAtMs: Date.parse('2026-04-05T13:00:00.000Z'),
            startedAtMs: Date.parse('2026-04-05T13:05:00.000Z'),
            request: { period: { startDate: '2026-03-07', endDate: '2026-04-05' } },
            error: null,
            errorDetails: null
          }
        }]
      });
      const service = buildServiceForCreateFlow(harness.db, {
        runtimeConfig: {
          maxActiveRuns: 1,
          staleRunningRunMs: 5 * 60 * 1000
        }
      });

      await expect(service.createRun('user-1', {
        period: {
          startDate: '2026-04-04',
          endDate: '2026-04-05'
        }
      })).resolves.toMatchObject({ status: 'queued' });

      expect(harness.runStore.size).toBe(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('deleteRun removes completed reports and blocks active ones', async () => {
    const nowMs = Date.now();
    const harness = buildBacktestDbHarness({
      runs: [
        {
          id: 'run-complete',
          data: {
            status: 'completed',
            requestedAtMs: 10
          }
        },
        {
          id: 'run-active',
          data: {
            status: 'running',
            requestedAtMs: nowMs - 60 * 1000,
            startedAtMs: nowMs - 30 * 1000
          }
        }
      ]
    });
    const service = buildServiceForCreateFlow(harness.db);

    await expect(service.deleteRun('user-1', 'run-active')).rejects.toThrow('cannot be deleted yet');

    await expect(service.deleteRun('user-1', 'run-complete')).resolves.toBe(true);
    expect(harness.runStore.has('run-complete')).toBe(false);
  });

  test('runBacktestAnalysis uses telemetry-mapped AC solar history in report charts', async () => {
    const buildDaySeries = (buildValue) => Array.from({ length: 288 }, (_, index) => {
      const hour = Math.floor(index / 12);
      const minute = (index % 12) * 5;
      return {
        time: `2026-03-04 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`,
        value: buildValue(hour, minute, index)
      };
    });

    const foxessAPI = {
      callFoxESSAPI: jest.fn(async (_path, _method, payload) => {
        const requested = new Set(Array.isArray(payload?.variables) ? payload.variables : []);
        const datas = [];
        if (requested.has('pvPower')) {
          datas.push({ variable: 'pvPower', unit: 'kW', data: buildDaySeries(() => 0) });
        }
        if (requested.has('meterPower2')) {
          datas.push({
            variable: 'meterPower2',
            unit: 'kW',
            data: buildDaySeries((hour) => (hour >= 10 && hour < 14 ? 2.4 : 0))
          });
        }
        if (requested.has('loadsPower')) {
          datas.push({ variable: 'loadsPower', unit: 'kW', data: buildDaySeries(() => 1.2) });
        }
        if (requested.has('gridConsumptionPower')) {
          datas.push({
            variable: 'gridConsumptionPower',
            unit: 'kW',
            data: buildDaySeries((hour) => (hour < 6 || hour >= 18 ? 1.1 : 0.2))
          });
        }
        if (requested.has('feedinPower')) {
          datas.push({ variable: 'feedinPower', unit: 'kW', data: buildDaySeries(() => 0) });
        }
        return { errno: 0, result: [{ datas, deviceSN: 'FOX-SEED-1001' }] };
      })
    };

    const service = createBacktestService({
      adapterRegistry: {
        getTariffProvider: jest.fn(() => null),
        getDeviceProvider: jest.fn(() => null)
      },
      db: buildBacktestDbHarness().db,
      foxessAPI,
      getConfig: () => ({
        automation: {
          backtesting: {
            replayIntervalMinutes: 5,
            maxLookbackDays: 365,
            maxScenarios: 3,
            maxActiveRuns: 2,
            maxSavedRuns: 5,
            maxRunsPerDay: 5,
            runTtlMs: 30 * 24 * 60 * 60 * 1000
          }
        }
      }),
      getHistoricalWeather: jest.fn(async () => ({
        hourly: { time: [] },
        daily: { time: [] }
      })),
      getUserConfig: jest.fn(async () => ({
        timezone: 'Australia/Sydney',
        pricingProvider: 'amber',
        deviceProvider: 'foxess',
        deviceSn: 'FOX-SEED-1001',
        batteryCapacityKWh: 10,
        inverterCapacityW: 5000,
        telemetryMappings: { acSolarPowerVariable: 'meterPower2' },
        defaults: { minSocOnGrid: 20 },
        automation: { blackoutWindows: [] }
      })),
      getUserRules: jest.fn(async () => ({}))
    });

    const result = await service.runBacktestAnalysis('user-1', {
      period: {
        startDate: '2026-03-04',
        endDate: '2026-03-04'
      },
      includeBaseline: true,
      scenarios: [{
        id: 'current',
        name: 'Current rules',
        ruleSetSnapshot: { source: 'current', rules: {} },
        tariff: {
          kind: 'manual',
          plan: {
            name: 'Flat plan',
            timezone: 'Australia/Sydney',
            importWindows: [{ startTime: '00:00', endTime: '23:59', centsPerKwh: 20 }],
            exportWindows: [{ startTime: '00:00', endTime: '23:59', centsPerKwh: 5 }]
          }
        }
      }]
    });

    const requestedVariables = foxessAPI.callFoxESSAPI.mock.calls[0][2].variables;
    const currentSummary = result.summaries.find((entry) => entry.scenarioId === 'current');
    const peakSolar = Math.max(...currentSummary.chart.points.map((point) => point.solarKw));

    expect(requestedVariables).toEqual(expect.arrayContaining(['meterPower2']));
    expect(peakSolar).toBeGreaterThan(2);
  });

  test('runBacktestAnalysis rejects provider-backed scenarios when historical tariff intervals are unavailable', async () => {
    const emptyTariffProvider = {
      getHistoricalPrices: jest.fn(async () => ({
        buyCentsPerKwh: null,
        feedInCentsPerKwh: null,
        intervals: []
      }))
    };
    const db = {
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          collection: jest.fn(() => ({
            doc: jest.fn(() => ({
              collection: jest.fn(() => ({
                orderBy: jest.fn(() => ({
                  get: jest.fn(async () => ({ docs: [] }))
                }))
              }))
            }))
          }))
        }))
      }))
    };
    const service = createBacktestService({
      adapterRegistry: {
        getTariffProvider: jest.fn(() => emptyTariffProvider),
        getDeviceProvider: jest.fn(() => null)
      },
      db,
      foxessAPI: {
        callFoxESSAPI: jest.fn(async () => ({
          errno: 0,
          result: [{ datas: [] }]
        }))
      },
      getConfig: () => ({
        automation: {
          backtesting: {
            replayIntervalMinutes: 5,
            maxLookbackDays: 365,
            maxScenarios: 3,
            maxActiveRuns: 2,
            runTtlMs: 30 * 24 * 60 * 60 * 1000
          }
        }
      }),
      getHistoricalWeather: jest.fn(async () => ({
        hourly: { time: [] },
        daily: { time: [] }
      })),
      getUserConfig: jest.fn(async () => ({
        timezone: 'Australia/Sydney',
        deviceProvider: 'foxess',
        deviceSn: 'FOX-SEED-1001',
        pricingProvider: 'amber',
        location: 'Sydney',
        batteryCapacityKWh: 10,
        inverterCapacityW: 5000,
        defaults: { minSocOnGrid: 20 },
        automation: { blackoutWindows: [] }
      })),
      getUserRules: jest.fn(async () => ({}))
    });

    await expect(service.runBacktestAnalysis('user-1', {
      period: {
        startDate: '2026-03-04',
        endDate: '2026-03-04'
      },
      includeBaseline: true,
      scenarios: [{
        id: 'current',
        name: 'Current rules',
        ruleSetSnapshot: { source: 'current', rules: {} }
      }]
    })).rejects.toThrow('Historical pricing was unavailable');

    expect(emptyTariffProvider.getHistoricalPrices).toHaveBeenCalled();
  });

  test('runBacktestAnalysis falls back to a manual plan when provider history is unavailable', async () => {
    const emptyTariffProvider = {
      getHistoricalPrices: jest.fn(async () => ({
        buyCentsPerKwh: null,
        feedInCentsPerKwh: null,
        intervals: []
      }))
    };
    const db = {
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          collection: jest.fn(() => ({
            doc: jest.fn(() => ({
              collection: jest.fn(() => ({
                orderBy: jest.fn(() => ({
                  get: jest.fn(async () => ({ docs: [] }))
                }))
              }))
            }))
          }))
        }))
      }))
    };
    const service = createBacktestService({
      adapterRegistry: {
        getTariffProvider: jest.fn(() => emptyTariffProvider),
        getDeviceProvider: jest.fn(() => null)
      },
      db,
      foxessAPI: {
        callFoxESSAPI: jest.fn(async () => ({
          errno: 0,
          result: [{ datas: [] }]
        }))
      },
      getConfig: () => ({
        automation: {
          backtesting: {
            replayIntervalMinutes: 5,
            maxLookbackDays: 365,
            maxScenarios: 3,
            maxActiveRuns: 2,
            runTtlMs: 30 * 24 * 60 * 60 * 1000
          }
        }
      }),
      getHistoricalWeather: jest.fn(async () => ({
        hourly: { time: [] },
        daily: { time: [] }
      })),
      getUserConfig: jest.fn(async () => ({
        timezone: 'Australia/Sydney',
        deviceProvider: 'foxess',
        deviceSn: 'FOX-SEED-1001',
        pricingProvider: 'amber',
        location: 'Sydney',
        batteryCapacityKWh: 10,
        inverterCapacityW: 5000,
        defaults: { minSocOnGrid: 20 },
        automation: { blackoutWindows: [] }
      })),
      getUserRules: jest.fn(async () => ({}))
    });

    const result = await service.runBacktestAnalysis('user-1', {
      period: {
        startDate: '2026-03-04',
        endDate: '2026-03-04'
      },
      includeBaseline: true,
      scenarios: [{
        id: 'current',
        name: 'Current rules',
        ruleSetSnapshot: { source: 'current', rules: {} },
        tariff: {
          fallbackPlan: {
            name: 'Flat plan',
            timezone: 'Australia/Sydney',
            dailySupplyCharge: 95,
            importWindows: [{ startTime: '00:00', endTime: '23:59', centsPerKwh: 20 }],
            exportWindows: [{ startTime: '00:00', endTime: '23:59', centsPerKwh: 5 }]
          }
        }
      }]
    });

    expect(result.summaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ scenarioId: 'baseline' }),
      expect.objectContaining({ scenarioId: 'current' })
    ]));
    expect(result.limitations).toContain(
      'Historical Amber pricing was unavailable for scenario "No automation"; used manual tariff plan "Flat plan" instead.'
    );
    expect(result.limitations).toContain(
      'Historical Amber pricing was unavailable for scenario "Current rules"; used manual tariff plan "Flat plan" instead.'
    );
    expect(emptyTariffProvider.getHistoricalPrices).toHaveBeenCalled();
  });

  test('runBacktestAnalysis surfaces provider history errors when the tariff provider rejects the request', async () => {
    const providerError = new Error('Range requested is too large. Maximum 7 days.');
    providerError.errno = 3200;
    const failingTariffProvider = {
      getHistoricalPrices: jest.fn(async () => {
        throw providerError;
      })
    };
    const db = {
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          collection: jest.fn(() => ({
            doc: jest.fn(() => ({
              collection: jest.fn(() => ({
                orderBy: jest.fn(() => ({
                  get: jest.fn(async () => ({ docs: [] }))
                }))
              }))
            }))
          }))
        }))
      }))
    };
    const service = createBacktestService({
      adapterRegistry: {
        getTariffProvider: jest.fn(() => failingTariffProvider),
        getDeviceProvider: jest.fn(() => null)
      },
      db,
      foxessAPI: {
        callFoxESSAPI: jest.fn(async () => ({
          errno: 0,
          result: [{ datas: [] }]
        }))
      },
      getConfig: () => ({
        automation: {
          backtesting: {
            replayIntervalMinutes: 5,
            maxLookbackDays: 365,
            maxScenarios: 3,
            maxActiveRuns: 2,
            runTtlMs: 30 * 24 * 60 * 60 * 1000
          }
        }
      }),
      getHistoricalWeather: jest.fn(async () => ({
        hourly: { time: [] },
        daily: { time: [] }
      })),
      getUserConfig: jest.fn(async () => ({
        timezone: 'Australia/Sydney',
        deviceProvider: 'foxess',
        deviceSn: 'FOX-SEED-1001',
        pricingProvider: 'amber',
        location: 'Sydney',
        batteryCapacityKWh: 10,
        inverterCapacityW: 5000,
        defaults: { minSocOnGrid: 20 },
        automation: { blackoutWindows: [] }
      })),
      getUserRules: jest.fn(async () => ({}))
    });

    await expect(service.runBacktestAnalysis('user-1', {
      period: {
        startDate: '2026-03-07',
        endDate: '2026-04-05'
      },
      includeBaseline: true,
      scenarios: [{
        id: 'current',
        name: 'Current rules',
        ruleSetSnapshot: { source: 'current', rules: {} }
      }]
    })).rejects.toThrow('Range requested is too large. Maximum 7 days.');

    expect(failingTariffProvider.getHistoricalPrices).toHaveBeenCalled();
  });

  test('processRun stores structured provider failure details on failed runs', async () => {
    const providerError = new Error('Amber provider authentication failed');
    providerError.errno = 3202;
    providerError.providerErrno = 401;
    providerError.provider = 'amber';
    const failingTariffProvider = {
      getHistoricalPrices: jest.fn(async () => {
        throw providerError;
      })
    };
    const harness = buildBacktestDbHarness({
      runs: [{
        id: 'run-process-fail',
        data: {
          type: 'backtestRun',
          status: 'queued',
          requestedAtMs: Date.parse('2026-04-05T00:00:00Z'),
          request: {
            period: { startDate: '2026-03-07', endDate: '2026-04-05' },
            includeBaseline: true,
            scenarios: [{
              id: 'current',
              name: 'Current rules',
              ruleSetSnapshot: { source: 'current', rules: {} }
            }],
            timezone: 'Australia/Sydney'
          },
          error: null,
          errorDetails: null
        }
      }]
    });
    const service = createBacktestService({
      adapterRegistry: {
        getTariffProvider: jest.fn(() => failingTariffProvider),
        getDeviceProvider: jest.fn(() => null)
      },
      db: harness.db,
      foxessAPI: {
        callFoxESSAPI: jest.fn(async () => ({
          errno: 0,
          result: [{ datas: [] }]
        }))
      },
      getConfig: () => ({
        automation: {
          backtesting: {
            replayIntervalMinutes: 5,
            maxLookbackDays: 365,
            maxScenarios: 3,
            maxActiveRuns: 2,
            runTtlMs: 30 * 24 * 60 * 60 * 1000
          }
        }
      }),
      getHistoricalWeather: jest.fn(async () => ({
        hourly: { time: [] },
        daily: { time: [] }
      })),
      getUserConfig: jest.fn(async () => ({
        timezone: 'Australia/Sydney',
        deviceProvider: 'foxess',
        deviceSn: 'FOX-SEED-1001',
        pricingProvider: 'amber',
        location: 'Sydney',
        batteryCapacityKWh: 10,
        inverterCapacityW: 5000,
        defaults: { minSocOnGrid: 20 },
        automation: { blackoutWindows: [] }
      })),
      getUserRules: jest.fn(async () => ({}))
    });

    await expect(service.processRun('user-1', 'run-process-fail')).rejects.toThrow('Amber provider authentication failed');

    expect(harness.runStore.get('run-process-fail')).toEqual(expect.objectContaining({
      status: 'failed',
      error: 'Amber provider authentication failed',
      errorDetails: {
        provider: 'amber',
        errno: 3202,
        providerErrno: 401
      }
    }));
  });

  test('runBacktestAnalysis clamps weather look-ahead to the latest historical day', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-04T13:00:00Z'));
    const getHistoricalWeather = jest.fn(async () => ({
      hourly: { time: [] },
      daily: { time: [] }
    }));

    try {
      const service = createBacktestService({
        adapterRegistry: {
          getTariffProvider: jest.fn(() => null),
          getDeviceProvider: jest.fn(() => null)
        },
        db: buildBacktestDbHarness().db,
        foxessAPI: {
          callFoxESSAPI: jest.fn(async () => ({
            errno: 0,
            result: [{ datas: [] }]
          }))
        },
        getConfig: () => ({
          automation: {
            backtesting: {
              replayIntervalMinutes: 5,
              maxLookbackDays: 365,
              maxScenarios: 3,
              maxActiveRuns: 2,
              maxSavedRuns: 5,
              maxRunsPerDay: 5,
              runTtlMs: 30 * 24 * 60 * 60 * 1000
            }
          }
        }),
        getHistoricalWeather,
        getUserConfig: jest.fn(async () => ({
          timezone: 'Australia/Sydney',
          location: 'Sydney, Australia',
          pricingProvider: 'amber',
          deviceProvider: 'foxess',
          deviceSn: 'FOX-SEED-1001',
          batteryCapacityKWh: 10,
          inverterCapacityW: 5000,
          defaults: { minSocOnGrid: 20 },
          automation: { blackoutWindows: [] }
        })),
        getUserRules: jest.fn(async () => ({}))
      });

      const result = await service.runBacktestAnalysis('user-1', {
        period: {
          startDate: '2026-03-06',
          endDate: '2026-04-04'
        },
        includeBaseline: false,
        scenarios: [{
          id: 'current',
          name: 'Current rules',
          ruleSetSnapshot: {
            source: 'current',
            rules: {
              weather_rule: {
                name: 'Tomorrow weather check',
                enabled: true,
                conditions: {
                  temperature: {
                    enabled: true,
                    type: 'forecastMax',
                    operator: '>=',
                    value: 25,
                    dayOffset: 1
                  }
                }
              }
            }
          },
          tariff: {
            kind: 'manual',
            plan: {
              name: 'Flat plan',
              timezone: 'Australia/Sydney',
              importWindows: [{ startTime: '00:00', endTime: '23:59', centsPerKwh: 20 }],
              exportWindows: [{ startTime: '00:00', endTime: '23:59', centsPerKwh: 5 }]
            }
          }
        }]
      });

      expect(getHistoricalWeather).toHaveBeenCalledWith(expect.objectContaining({
        startDate: '2026-03-06',
        endDate: '2026-04-04',
        timezone: 'Australia/Sydney'
      }));
      expect(result.limitations).toContain(
        'Weather forecast look-ahead near the end of the period was truncated because historical weather is only available through 2026-04-04.'
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('runBacktestAnalysis ignores disabled rules when sizing hidden look-ahead windows', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-04T13:00:00Z'));
    const getHistoricalWeather = jest.fn(async () => ({
      hourly: { time: [] },
      daily: { time: [] }
    }));

    try {
      const service = createBacktestService({
        adapterRegistry: {
          getTariffProvider: jest.fn(() => null),
          getDeviceProvider: jest.fn(() => null)
        },
        db: buildBacktestDbHarness().db,
        foxessAPI: {
          callFoxESSAPI: jest.fn(async () => ({
            errno: 0,
            result: [{ datas: [] }]
          }))
        },
        getConfig: () => ({
          automation: {
            backtesting: {
              replayIntervalMinutes: 5,
              maxLookbackDays: 365,
              maxScenarios: 3,
              maxActiveRuns: 2,
              maxSavedRuns: 5,
              maxRunsPerDay: 5,
              runTtlMs: 30 * 24 * 60 * 60 * 1000
            }
          }
        }),
        getHistoricalWeather,
        getUserConfig: jest.fn(async () => ({
          timezone: 'Australia/Sydney',
          location: 'Sydney, Australia',
          pricingProvider: 'amber',
          deviceProvider: 'foxess',
          deviceSn: 'FOX-SEED-1001',
          batteryCapacityKWh: 10,
          inverterCapacityW: 5000,
          defaults: { minSocOnGrid: 20 },
          automation: { blackoutWindows: [] }
        })),
        getUserRules: jest.fn(async () => ({}))
      });

      const result = await service.runBacktestAnalysis('user-1', {
        period: {
          startDate: '2026-03-06',
          endDate: '2026-04-04'
        },
        includeBaseline: false,
        scenarios: [{
          id: 'current',
          name: 'Current rules',
          ruleSetSnapshot: {
            source: 'current',
            rules: {
              disabled_future_rule: {
                name: 'Disabled future weather rule',
                enabled: false,
                conditions: {
                  temperature: {
                    enabled: true,
                    type: 'forecastMax',
                    operator: '>=',
                    value: 25,
                    dayOffset: 3
                  }
                }
              }
            }
          },
          tariff: {
            kind: 'manual',
            plan: {
              name: 'Flat plan',
              timezone: 'Australia/Sydney',
              importWindows: [{ startTime: '00:00', endTime: '23:59', centsPerKwh: 20 }],
              exportWindows: [{ startTime: '00:00', endTime: '23:59', centsPerKwh: 5 }]
            }
          }
        }]
      });

      expect(getHistoricalWeather).toHaveBeenCalledWith(expect.objectContaining({
        startDate: '2026-03-06',
        endDate: '2026-04-04',
        timezone: 'Australia/Sydney'
      }));
      expect(result.limitations).not.toContain(
        'Weather forecast look-ahead near the end of the period was truncated because historical weather is only available through 2026-04-04.'
      );
    } finally {
      nowSpy.mockRestore();
    }
  });
});
