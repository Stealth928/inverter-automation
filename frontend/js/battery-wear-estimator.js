(function () {
  'use strict';

  var FALLBACKS = {
    scenario: 'arbitrage',
    usableCapacityKwh: 12.2,
    replacementValue: 9000,
    roundTripEfficiency: 90,
    lifetimeMode: 'throughput',
    lifetimeThroughputKwh: 35000,
    expectedCycleLife: 5000,
    averageDodPct: 80,
    temperatureBand: 'mild',
    usageProfile: 'balanced',
    cycleFrequencyBasis: 'year',
    cycleFrequencyValue: 180,
    arbitrageChargePriceCents: 9,
    arbitrageLaterValueCents: 28,
    selfUseExportNowCents: 7,
    selfUseAvoidedImportCents: 32
  };

  var QUERY_KEYS = [
    'scenario',
    'usableCapacityKwh',
    'replacementValue',
    'roundTripEfficiency',
    'lifetimeMode',
    'lifetimeThroughputKwh',
    'expectedCycleLife',
    'averageDodPct',
    'temperatureBand',
    'usageProfile',
    'cycleFrequencyBasis',
    'cycleFrequencyValue',
    'arbitrageChargePriceCents',
    'arbitrageLaterValueCents',
    'selfUseExportNowCents',
    'selfUseAvoidedImportCents'
  ];

  var TEMPERATURE_FACTORS = {
    mild: 1,
    cool: 0.98,
    warm: 0.93,
    hot: 0.82
  };

  var USAGE_FACTORS = {
    light: 1.05,
    balanced: 1,
    aggressive: 0.9
  };

  var currencyWhole = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0
  });

  var currencyPrecise = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  var numberOne = new Intl.NumberFormat('en-AU', {
    maximumFractionDigits: 1
  });

  var numberZero = new Intl.NumberFormat('en-AU', {
    maximumFractionDigits: 0
  });

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toNumber(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function setText(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function readNumber(id, fallback) {
    var node = document.getElementById(id);
    if (!node) return fallback;
    if (String(node.value).trim() === '') return fallback;
    return toNumber(node.value, fallback);
  }

  function writeValue(id, value) {
    var node = document.getElementById(id);
    if (!node) return;
    node.value = value === null || value === undefined ? '' : String(value);
  }

  function getSelectValue(id, fallback) {
    var node = document.getElementById(id);
    return node ? String(node.value || fallback) : fallback;
  }

  function serializeState(state) {
    if (!window.history || !window.history.replaceState) return;
    var params = new URLSearchParams();
    QUERY_KEYS.forEach(function (key) {
      var value = state[key];
      var fallback = FALLBACKS[key];
      if (String(value) !== String(fallback)) {
        params.set(key, String(value));
      }
    });
    var next = window.location.pathname + (params.toString() ? ('?' + params.toString()) : '');
    window.history.replaceState({}, '', next);
  }

  function loadQueryState() {
    var params = new URLSearchParams(window.location.search);
    QUERY_KEYS.forEach(function (key) {
      if (!params.has(key) || key === 'scenario') return;
      writeValue(key, params.get(key));
    });
    return params.get('scenario') || FALLBACKS.scenario;
  }

  function getSelectedScenario() {
    var active = document.querySelector('.tool-preset.is-active[data-scenario]');
    return active ? String(active.getAttribute('data-scenario') || FALLBACKS.scenario) : FALLBACKS.scenario;
  }

  function readState() {
    return {
      scenario: getSelectedScenario(),
      usableCapacityKwh: clamp(readNumber('usableCapacityKwh', FALLBACKS.usableCapacityKwh), 1, 200),
      replacementValue: clamp(readNumber('replacementValue', FALLBACKS.replacementValue), 500, 100000),
      roundTripEfficiency: clamp(readNumber('roundTripEfficiency', FALLBACKS.roundTripEfficiency), 50, 100),
      lifetimeMode: getSelectValue('lifetimeMode', FALLBACKS.lifetimeMode),
      lifetimeThroughputKwh: clamp(readNumber('lifetimeThroughputKwh', FALLBACKS.lifetimeThroughputKwh), 1000, 500000),
      expectedCycleLife: clamp(readNumber('expectedCycleLife', FALLBACKS.expectedCycleLife), 100, 20000),
      averageDodPct: clamp(readNumber('averageDodPct', FALLBACKS.averageDodPct), 10, 100),
      temperatureBand: getSelectValue('temperatureBand', FALLBACKS.temperatureBand),
      usageProfile: getSelectValue('usageProfile', FALLBACKS.usageProfile),
      cycleFrequencyBasis: getSelectValue('cycleFrequencyBasis', FALLBACKS.cycleFrequencyBasis),
      cycleFrequencyValue: clamp(readNumber('cycleFrequencyValue', FALLBACKS.cycleFrequencyValue), 0, 365),
      arbitrageChargePriceCents: clamp(readNumber('arbitrageChargePriceCents', FALLBACKS.arbitrageChargePriceCents), -50, 200),
      arbitrageLaterValueCents: clamp(readNumber('arbitrageLaterValueCents', FALLBACKS.arbitrageLaterValueCents), -50, 300),
      selfUseExportNowCents: clamp(readNumber('selfUseExportNowCents', FALLBACKS.selfUseExportNowCents), -50, 200),
      selfUseAvoidedImportCents: clamp(readNumber('selfUseAvoidedImportCents', FALLBACKS.selfUseAvoidedImportCents), -50, 300)
    };
  }

  function calculateArbitrage(state, efficiency, throughputPerAverageCycle, deliveredPerAverageCycle, wearCostPerThroughputKwh) {
    var chargePrice = state.arbitrageChargePriceCents / 100;
    var laterValue = state.arbitrageLaterValueCents / 100;
    var grossCycleValue = (laterValue * deliveredPerAverageCycle) - (chargePrice * throughputPerAverageCycle);
    var wearPerAverageCycle = throughputPerAverageCycle * wearCostPerThroughputKwh;
    var netValuePerCycle = grossCycleValue - wearPerAverageCycle;
    var requiredLaterValue = (chargePrice + wearCostPerThroughputKwh) / efficiency;
    var breakEvenSpread = requiredLaterValue - chargePrice;
    var actualSpread = laterValue - chargePrice;

    return {
      kind: 'arbitrage',
      netValuePerCycle: netValuePerCycle,
      breakEvenDifference: breakEvenSpread,
      actualDifference: actualSpread,
      headline: 'break-even spread needed for arbitrage',
      copy: 'You would want at least ' + formatCents(breakEvenSpread) + ' spread before this trade looks worthwhile.'
    };
  }

  function calculateSelfUse(state, efficiency, throughputPerAverageCycle, deliveredPerAverageCycle, wearCostPerThroughputKwh) {
    var exportNow = state.selfUseExportNowCents / 100;
    var avoidedImport = state.selfUseAvoidedImportCents / 100;
    var grossCycleValue = (avoidedImport * deliveredPerAverageCycle) - (exportNow * throughputPerAverageCycle);
    var wearPerAverageCycle = throughputPerAverageCycle * wearCostPerThroughputKwh;
    var netValuePerCycle = grossCycleValue - wearPerAverageCycle;
    var requiredAvoidedImport = (exportNow + wearCostPerThroughputKwh) / efficiency;
    var breakEvenDifference = requiredAvoidedImport - exportNow;
    var actualDifference = avoidedImport - exportNow;

    return {
      kind: 'selfUse',
      netValuePerCycle: netValuePerCycle,
      breakEvenDifference: breakEvenDifference,
      actualDifference: actualDifference,
      headline: 'break-even value difference for self-use versus export',
      copy: 'At these assumptions, storing solar needs about ' + formatCents(breakEvenDifference) + ' more later value than exporting now.'
    };
  }

  function calculateModel(state) {
    var efficiency = state.roundTripEfficiency / 100;
    var dod = state.averageDodPct / 100;
    var tempFactor = TEMPERATURE_FACTORS[state.temperatureBand] || 1;
    var usageFactor = USAGE_FACTORS[state.usageProfile] || 1;
    var baseLifetimeThroughput = state.lifetimeMode === 'cycleLife'
      ? state.expectedCycleLife * state.usableCapacityKwh * dod
      : state.lifetimeThroughputKwh;
    var adjustedLifetimeThroughput = Math.max(1, baseLifetimeThroughput * tempFactor * usageFactor);
    var wearCostPerThroughputKwh = state.replacementValue / adjustedLifetimeThroughput;
    var wearCostPerFec = wearCostPerThroughputKwh * state.usableCapacityKwh;
    var throughputPerAverageCycle = state.usableCapacityKwh * dod;
    var deliveredPerAverageCycle = throughputPerAverageCycle * efficiency;
    var fullEquivalentCycles = adjustedLifetimeThroughput / state.usableCapacityKwh;

    var annualCycles = state.cycleFrequencyBasis === 'week'
      ? state.cycleFrequencyValue * 52
      : state.cycleFrequencyValue;
    var annualWearCost = annualCycles * throughputPerAverageCycle * wearCostPerThroughputKwh;

    var scenario = state.scenario === 'selfUse'
      ? calculateSelfUse(state, efficiency, throughputPerAverageCycle, deliveredPerAverageCycle, wearCostPerThroughputKwh)
      : calculateArbitrage(state, efficiency, throughputPerAverageCycle, deliveredPerAverageCycle, wearCostPerThroughputKwh);

    return {
      adjustedLifetimeThroughput: adjustedLifetimeThroughput,
      wearCostPerThroughputKwh: wearCostPerThroughputKwh,
      wearCostPerFec: wearCostPerFec,
      throughputPerAverageCycle: throughputPerAverageCycle,
      deliveredPerAverageCycle: deliveredPerAverageCycle,
      annualCycles: annualCycles,
      annualWearCost: annualWearCost,
      fullEquivalentCycles: fullEquivalentCycles,
      scenario: scenario
    };
  }

  function formatCents(valueInDollars) {
    return numberOne.format(valueInDollars * 100) + ' c/kWh';
  }

  function resolveVerdict(model) {
    var netAnnual = model.scenario.netValuePerCycle * model.annualCycles;
    var marginRatio = model.scenario.breakEvenDifference > 0
      ? model.scenario.actualDifference / model.scenario.breakEvenDifference
      : 1;

    if (netAnnual > 250 && marginRatio > 1.2) {
      return {
        title: 'Worth considering',
        body: 'One full-equivalent cycle costs about ' + currencyPrecise.format(model.wearCostPerFec) + ' in battery wear. ' + model.scenario.copy + ' At your entered prices, the strategy clears that hurdle with useful margin.'
      };
    }

    if (netAnnual >= -100 && marginRatio > 0.9) {
      return {
        title: 'Borderline',
        body: 'One full-equivalent cycle costs about ' + currencyPrecise.format(model.wearCostPerFec) + ' in battery wear. ' + model.scenario.copy + ' Your assumptions land close to break-even, so tariff shape and cycle frequency will decide whether it is really worth doing.'
      };
    }

    return {
      title: 'Probably not worth it',
      body: 'One full-equivalent cycle costs about ' + currencyPrecise.format(model.wearCostPerFec) + ' in battery wear. ' + model.scenario.copy + ' Under these assumptions, the value created does not comfortably cover the wear and efficiency loss.'
    };
  }

  function updateResults(state, model) {
    var verdict = resolveVerdict(model);
    setText('wearCostPerCycle', currencyPrecise.format(model.wearCostPerFec));
    setText('wearCostPerCycleSub', numberOne.format(model.fullEquivalentCycles) + ' full-equivalent cycles across the assumed life');
    setText('wearCostPerKwh', currencyPrecise.format(model.wearCostPerThroughputKwh));
    setText('wearCostPerKwhSub', 'Replacement value spread across adjusted lifetime usable throughput');
    setText('breakEvenThreshold', formatCents(model.scenario.breakEvenDifference));
    setText('breakEvenThresholdSub', model.scenario.headline);
    setText('annualWearCost', currencyWhole.format(model.annualWearCost));
    setText('annualWearCostSub', numberZero.format(model.annualCycles) + ' average cycles per year');
    setText('netValuePerCycle', currencyPrecise.format(model.scenario.netValuePerCycle));
    setText('deliveredEnergyPerCycle', numberOne.format(model.deliveredPerAverageCycle) + ' kWh');
    setText('adjustedLifetimeThroughput', numberZero.format(model.adjustedLifetimeThroughput) + ' kWh');
    setText('verdictHeadline', verdict.title);
    setText('verdictBody', verdict.body);
    setText('resultUseCopy', 'This estimate assumes ' + state.temperatureBand + ' conditions and a ' + state.usageProfile + ' usage profile, which apply a simple lifetime multiplier rather than claiming exact battery ageing. Use it to judge whether the economics are clearly positive or just noisy.');
  }

  function updateScenarioVisibility() {
    var scenario = getSelectedScenario();
    document.querySelectorAll('[data-scenario-field]').forEach(function (field) {
      field.hidden = field.getAttribute('data-scenario-field') !== scenario;
    });
  }

  function updateLifetimeVisibility() {
    var mode = getSelectValue('lifetimeMode', FALLBACKS.lifetimeMode);
    var throughputField = document.getElementById('throughputModeField');
    var cycleField = document.getElementById('cycleLifeField');
    if (throughputField) throughputField.hidden = mode !== 'throughput';
    if (cycleField) cycleField.hidden = mode !== 'cycleLife';
  }

  function setScenarioSelection(name) {
    document.querySelectorAll('.tool-preset[data-scenario]').forEach(function (button) {
      var isActive = button.getAttribute('data-scenario') === name;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    updateScenarioVisibility();
  }

  function bindScenarioButtons() {
    document.querySelectorAll('.tool-preset[data-scenario]').forEach(function (button) {
      button.addEventListener('click', function () {
        setScenarioSelection(button.getAttribute('data-scenario'));
        refresh();
      });
    });
  }

  function bindNavBurger() {
    var burger = document.getElementById('navBurger');
    var links = document.getElementById('navLinks');
    if (!burger || !links) return;
    burger.addEventListener('click', function () {
      var isOpen = links.classList.toggle('is-open');
      burger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }

  function refresh() {
    updateScenarioVisibility();
    updateLifetimeVisibility();
    var state = readState();
    var model = calculateModel(state);
    updateResults(state, model);
    serializeState(state);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var initialScenario = loadQueryState();
    bindNavBurger();
    bindScenarioButtons();
    setScenarioSelection(initialScenario);
    updateLifetimeVisibility();

    var form = document.getElementById('batteryWearForm');
    if (form) {
      form.addEventListener('input', refresh);
      form.addEventListener('change', refresh);
    }

    refresh();
  });
})();