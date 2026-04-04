(function initRoiDemoData(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.RoiDemoData = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildRoiDemoData(root) {
  'use strict';

  const STORAGE_KEY = 'roi-demo-mode';
  let enabled = readInitialEnabled();

  function readInitialEnabled() {
    try {
      const search = root && root.location ? String(root.location.search || '') : '';
      const params = new URLSearchParams(search);
      const requested = params.get('demo');
      if (requested !== null) {
        return requested === '1' || requested === 'true';
      }
    } catch (error) {
      // Ignore URL parsing errors and fall back to persisted state.
    }

    try {
      return root && root.localStorage && root.localStorage.getItem(STORAGE_KEY) === '1';
    } catch (error) {
      return false;
    }
  }

  function emitChange() {
    if (!root || typeof root.dispatchEvent !== 'function' || typeof root.CustomEvent !== 'function') return;
    root.dispatchEvent(new root.CustomEvent('roi-demo-data-changed', {
      detail: { enabled }
    }));
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function formatDateInput(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function atLocalTime(daysAgo, hour, minute) {
    const value = new Date();
    value.setSeconds(0, 0);
    value.setDate(value.getDate() - Number(daysAgo || 0));
    value.setHours(Number(hour || 0), Number(minute || 0), 0, 0);
    return value;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function buildRuleEval(name, triggered, conditions) {
    return {
      name,
      triggered,
      conditions: Array.isArray(conditions) ? conditions.map((condition) => ({
        met: !!condition.met,
        name: condition.name,
        value: condition.value
      })) : []
    };
  }

  function buildEvent(options) {
    const start = atLocalTime(options.daysAgo, options.hour, options.minute);
    const durationMs = Math.max(1, Number(options.durationMinutes || 0)) * 60 * 1000;
    const endTime = options.ongoing ? null : start.getTime() + durationMs;
    return {
      ruleId: options.ruleId,
      ruleName: options.ruleName,
      startTime: start.getTime(),
      endTime,
      durationMs,
      type: options.ongoing ? 'ongoing' : 'completed',
      action: {
        workMode: options.workMode,
        fdPwr: options.fdPwr
      },
      roiSnapshot: {
        workMode: options.workMode,
        buyPrice: options.buyPrice,
        feedInPrice: options.feedInPrice,
        houseLoadW: options.houseLoadW,
        estimatedGridExportW: options.estimatedGridExportW
      },
      startAllRules: options.startAllRules || [],
      endAllRules: options.ongoing ? [] : (options.endAllRules || [])
    };
  }

  function buildBacktestRun(options) {
    return {
      requestedAtMs: options.requestedAtMs,
      status: 'completed',
      request: {
        period: {
          startDate: options.startDate,
          endDate: options.endDate
        },
        scenarios: options.scenarios
      },
      result: {
        confidence: options.confidence,
        limitations: options.limitations,
        summaries: options.summaries,
        comparisons: options.comparisons
      }
    };
  }

  function getScenario() {
    const today = atLocalTime(0, 12, 0);
    const endDate = formatDateInput(today);
    const startDate = formatDateInput(atLocalTime(6, 0, 0));

    const nightChargeStartRules = [
      buildRuleEval('Night Charge Window', true, [
        { met: true, name: 'Buy Price', value: '8.6c/kWh' },
        { met: true, name: 'Battery SoC', value: '23%' },
        { met: true, name: 'Time Window', value: '01:00-05:00' }
      ]),
      buildRuleEval('Peak Saver Discharge', false, [
        { met: false, name: 'Buy Price', value: '8.6c/kWh' }
      ])
    ];
    const nightChargeEndRules = [
      buildRuleEval('Night Charge Window', false, [
        { met: false, name: 'Buy Price', value: '14.2c/kWh' },
        { met: true, name: 'Battery SoC', value: '51%' }
      ])
    ];

    const peakDischargeStartRules = [
      buildRuleEval('Peak Saver Discharge', true, [
        { met: true, name: 'Buy Price', value: '41.8c/kWh' },
        { met: true, name: 'Battery SoC', value: '87%' },
        { met: true, name: 'Time Window', value: '17:00-21:00' }
      ]),
      buildRuleEval('Export Spike Capture', false, [
        { met: false, name: 'Feed In Price', value: '13.5c/kWh' }
      ])
    ];
    const peakDischargeEndRules = [
      buildRuleEval('Peak Saver Discharge', false, [
        { met: false, name: 'Buy Price', value: '28.3c/kWh' },
        { met: true, name: 'Battery SoC', value: '69%' }
      ])
    ];

    const exportSpikeStartRules = [
      buildRuleEval('Export Spike Capture', true, [
        { met: true, name: 'Feed In Price', value: '31.4c/kWh' },
        { met: true, name: 'Battery SoC', value: '92%' }
      ]),
      buildRuleEval('Peak Saver Discharge', false, [
        { met: false, name: 'Buy Price', value: '19.1c/kWh' }
      ])
    ];
    const exportSpikeEndRules = [
      buildRuleEval('Export Spike Capture', false, [
        { met: false, name: 'Feed In Price', value: '18.9c/kWh' },
        { met: true, name: 'Battery SoC', value: '74%' }
      ])
    ];

    const events = [
      buildEvent({
        ruleId: 'demo-charge-1',
        ruleName: 'Night Charge Window',
        daysAgo: 2,
        hour: 2,
        minute: 10,
        durationMinutes: 55,
        workMode: 'ForceCharge',
        fdPwr: 3200,
        buyPrice: 8.6,
        feedInPrice: 6.4,
        houseLoadW: 900,
        estimatedGridExportW: 0,
        startAllRules: nightChargeStartRules,
        endAllRules: nightChargeEndRules
      }),
      buildEvent({
        ruleId: 'demo-discharge-1',
        ruleName: 'Peak Saver Discharge',
        daysAgo: 1,
        hour: 18,
        minute: 5,
        durationMinutes: 40,
        workMode: 'ForceDischarge',
        fdPwr: 2600,
        buyPrice: 41.8,
        feedInPrice: 12.3,
        houseLoadW: 1800,
        estimatedGridExportW: 800,
        startAllRules: peakDischargeStartRules,
        endAllRules: peakDischargeEndRules
      }),
      buildEvent({
        ruleId: 'demo-export-1',
        ruleName: 'Export Spike Capture',
        daysAgo: 1,
        hour: 13,
        minute: 20,
        durationMinutes: 30,
        workMode: 'FeedIn',
        fdPwr: 3000,
        buyPrice: 16.2,
        feedInPrice: 31.4,
        houseLoadW: 400,
        estimatedGridExportW: 2600,
        startAllRules: exportSpikeStartRules,
        endAllRules: exportSpikeEndRules
      })
    ];

    const tariffPlans = [
      { id: 'demo-plan-amber', name: 'Amber NSW' },
      { id: 'demo-plan-smart', name: 'SmartSaver TOU' }
    ];

    const backtestRuns = [
      buildBacktestRun({
        requestedAtMs: atLocalTime(1, 9, 15).getTime(),
        startDate: formatDateInput(atLocalTime(30, 0, 0)),
        endDate: formatDateInput(atLocalTime(1, 0, 0)),
        confidence: 'medium',
        limitations: [
          'Opening battery state for the first replay interval was reconstructed from historical power samples.',
          'Weather was replayed from forecast snapshots rather than panel-level irradiance.'
        ],
        scenarios: [
          {
            name: 'Peak Saver',
            tariff: { plan: { name: 'Amber NSW' } }
          }
        ],
        summaries: [
          {
            scenarioId: 'baseline',
            scenarioName: 'No automation',
            totalBillAud: 194.85,
            throughputKWh: 5.8,
            triggerCount: 0,
            importKWh: 42.1,
            exportKWh: 11.6
          },
          {
            scenarioId: 'peak-saver',
            scenarioName: 'Peak Saver',
            totalBillAud: 164.42,
            throughputKWh: 10.7,
            triggerCount: 9,
            importKWh: 33.4,
            exportKWh: 15.9,
            deltaVsBaseline: {
              billAud: 30.43
            }
          }
        ],
        comparisons: [
          {
            leftScenarioName: 'No automation',
            rightScenarioName: 'Peak Saver',
            billDeltaAud: -30.43
          }
        ]
      }),
      buildBacktestRun({
        requestedAtMs: atLocalTime(0, 8, 30).getTime(),
        startDate: formatDateInput(atLocalTime(90, 0, 0)),
        endDate: formatDateInput(atLocalTime(1, 0, 0)),
        confidence: 'high',
        limitations: [
          'Wholesale settlement was replayed from five-minute intervals and does not include retailer fees.'
        ],
        scenarios: [
          {
            name: 'Export Shield',
            tariff: { plan: { name: 'SmartSaver TOU' } }
          }
        ],
        summaries: [
          {
            scenarioId: 'baseline',
            scenarioName: 'No automation',
            totalBillAud: 612.28,
            throughputKWh: 14.4,
            triggerCount: 0,
            importKWh: 138.3,
            exportKWh: 40.8
          },
          {
            scenarioId: 'export-shield',
            scenarioName: 'Export Shield',
            totalBillAud: 553.74,
            throughputKWh: 28.9,
            triggerCount: 21,
            importKWh: 122.6,
            exportKWh: 55.2,
            deltaVsBaseline: {
              billAud: 58.54
            }
          }
        ],
        comparisons: [
          {
            leftScenarioName: 'No automation',
            rightScenarioName: 'Export Shield',
            billDeltaAud: -58.54
          }
        ]
      })
    ];

    return clone({
      provider: 'foxess',
      providerLabel: 'FoxESS',
      startDate,
      endDate,
      events,
      automationHistoryEvents: events,
      backtestRuns,
      tariffPlans
    });
  }

  function isEnabled() {
    return enabled;
  }

  function setEnabled(value) {
    enabled = !!value;
    try {
      if (root && root.localStorage) {
        if (enabled) root.localStorage.setItem(STORAGE_KEY, '1');
        else root.localStorage.removeItem(STORAGE_KEY);
      }
    } catch (error) {
      // Ignore storage errors.
    }
    emitChange();
    return enabled;
  }

  return {
    getScenario,
    isEnabled,
    setEnabled,
    storageKey: STORAGE_KEY
  };
});
