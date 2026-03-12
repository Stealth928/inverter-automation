(function () {
  'use strict';

  var FALLBACKS = {
    batterySizeKwh: 13.5,
    cyclesPerWeek: 4.5,
    chargeEnergyCostCents: 10,
    dischargeValueCents: 32,
    roundTripEfficiency: 88,
    activeMonthsPerYear: 11,
    manualCaptureRate: 40,
    automationCaptureRate: 82,
    annualSoftwareCost: 0,
    batterySystemCost: ''
  };

  var PRESETS = {
    balanced: {
      batterySizeKwh: 13.5,
      cyclesPerWeek: 4.5,
      chargeEnergyCostCents: 10,
      dischargeValueCents: 32,
      roundTripEfficiency: 88,
      activeMonthsPerYear: 11,
      manualCaptureRate: 40,
      automationCaptureRate: 82,
      annualSoftwareCost: 0,
      batterySystemCost: ''
    },
    conservative: {
      batterySizeKwh: 10,
      cyclesPerWeek: 3.2,
      chargeEnergyCostCents: 12,
      dischargeValueCents: 28,
      roundTripEfficiency: 86,
      activeMonthsPerYear: 10,
      manualCaptureRate: 45,
      automationCaptureRate: 70,
      annualSoftwareCost: 0,
      batterySystemCost: ''
    },
    large: {
      batterySizeKwh: 42,
      cyclesPerWeek: 5.5,
      chargeEnergyCostCents: 8,
      dischargeValueCents: 34,
      roundTripEfficiency: 90,
      activeMonthsPerYear: 12,
      manualCaptureRate: 45,
      automationCaptureRate: 88,
      annualSoftwareCost: 0,
      batterySystemCost: ''
    },
    highSpread: {
      batterySizeKwh: 13.5,
      cyclesPerWeek: 5.2,
      chargeEnergyCostCents: 6,
      dischargeValueCents: 42,
      roundTripEfficiency: 88,
      activeMonthsPerYear: 12,
      manualCaptureRate: 32,
      automationCaptureRate: 90,
      annualSoftwareCost: 0,
      batterySystemCost: ''
    }
  };

  var QUERY_KEYS = [
    'batterySizeKwh',
    'cyclesPerWeek',
    'chargeEnergyCostCents',
    'dischargeValueCents',
    'roundTripEfficiency',
    'activeMonthsPerYear',
    'manualCaptureRate',
    'automationCaptureRate',
    'annualSoftwareCost',
    'batterySystemCost'
  ];

  var annualCurrency = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0
  });

  var cycleCurrency = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  var numberOne = new Intl.NumberFormat('en-AU', {
    maximumFractionDigits: 1
  });

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toNumber(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function readInputNumber(id, fallback) {
    var el = document.getElementById(id);
    if (!el) return fallback;
    if (String(el.value).trim() === '') return fallback;
    return toNumber(el.value, fallback);
  }

  function writeInputValue(id, value) {
    var el = document.getElementById(id);
    if (!el) return;
    el.value = value === null || value === undefined ? '' : String(value);
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function setWidth(id, pct) {
    var el = document.getElementById(id);
    if (el) el.style.width = clamp(pct, 0, 100) + '%';
  }

  function serializeState(state) {
    if (!window.history || !window.history.replaceState) return;
    var params = new URLSearchParams();
    QUERY_KEYS.forEach(function (key) {
      if (key === 'batterySystemCost' && Number(state[key]) <= 0) {
        return;
      }
      var fallback = Object.prototype.hasOwnProperty.call(FALLBACKS, key) ? FALLBACKS[key] : '';
      var value = state[key];
      if (String(value) !== String(fallback) && String(value) !== '') {
        params.set(key, String(value));
      }
    });
    var next = window.location.pathname + (params.toString() ? ('?' + params.toString()) : '');
    window.history.replaceState({}, '', next);
  }

  function loadQueryState() {
    var params = new URLSearchParams(window.location.search);
    QUERY_KEYS.forEach(function (key) {
      if (!params.has(key)) return;
      writeInputValue(key, params.get(key));
    });
  }

  function readState() {
    return {
      batterySizeKwh: clamp(readInputNumber('batterySizeKwh', FALLBACKS.batterySizeKwh), 1, 80),
      cyclesPerWeek: clamp(readInputNumber('cyclesPerWeek', FALLBACKS.cyclesPerWeek), 0, 14),
      chargeEnergyCostCents: clamp(readInputNumber('chargeEnergyCostCents', FALLBACKS.chargeEnergyCostCents), -50, 150),
      dischargeValueCents: clamp(readInputNumber('dischargeValueCents', FALLBACKS.dischargeValueCents), -50, 200),
      roundTripEfficiency: clamp(readInputNumber('roundTripEfficiency', FALLBACKS.roundTripEfficiency), 50, 100),
      activeMonthsPerYear: clamp(readInputNumber('activeMonthsPerYear', FALLBACKS.activeMonthsPerYear), 1, 12),
      manualCaptureRate: clamp(readInputNumber('manualCaptureRate', FALLBACKS.manualCaptureRate), 0, 100),
      automationCaptureRate: clamp(readInputNumber('automationCaptureRate', FALLBACKS.automationCaptureRate), 0, 100),
      annualSoftwareCost: clamp(readInputNumber('annualSoftwareCost', FALLBACKS.annualSoftwareCost), 0, 5000),
      batterySystemCost: clamp(readInputNumber('batterySystemCost', FALLBACKS.batterySystemCost || 0), 0, 100000)
    };
  }

  function calculateModel(state) {
    var efficiencyRatio = state.roundTripEfficiency / 100;
    var candidateCyclesPerYear = state.cyclesPerWeek * 52 * (state.activeMonthsPerYear / 12);
    var manualCaptureRatio = state.manualCaptureRate / 100;
    var automationCaptureRatio = state.automationCaptureRate / 100;

    var chargedEnergyPerCycle = state.batterySizeKwh;
    var deliveredEnergyPerCycle = chargedEnergyPerCycle * efficiencyRatio;

    var cycleChargeCost = chargedEnergyPerCycle * (state.chargeEnergyCostCents / 100);
    var cycleDischargeValue = deliveredEnergyPerCycle * (state.dischargeValueCents / 100);
    var cycleNetValue = cycleDischargeValue - cycleChargeCost;

    var manualSuccessfulCycles = candidateCyclesPerYear * manualCaptureRatio;
    var automationSuccessfulCycles = candidateCyclesPerYear * automationCaptureRatio;

    var manualAnnualValue = manualSuccessfulCycles * cycleNetValue;
    var automationAnnualValue = automationSuccessfulCycles * cycleNetValue;
    var automationUplift = automationAnnualValue - manualAnnualValue;
    var netUplift = automationUplift - state.annualSoftwareCost;

    var annualShiftedEnergy = deliveredEnergyPerCycle * automationSuccessfulCycles;
    var tenYearValue = 0;
    var annualFadeRate = 0.02;
    for (var year = 0; year < 10; year += 1) {
      tenYearValue += automationAnnualValue * Math.max(0, 1 - (annualFadeRate * year));
    }

    return {
      annualShiftedEnergy: annualShiftedEnergy,
      automationAnnualValue: automationAnnualValue,
      automationSuccessfulCycles: automationSuccessfulCycles,
      automationUplift: automationUplift,
      candidateCyclesPerYear: candidateCyclesPerYear,
      cycleNetValue: cycleNetValue,
      cycleChargeCost: cycleChargeCost,
      cycleDischargeValue: cycleDischargeValue,
      deliveredEnergyPerCycle: deliveredEnergyPerCycle,
      efficiencyRatio: efficiencyRatio,
      manualAnnualValue: manualAnnualValue,
      manualSuccessfulCycles: manualSuccessfulCycles,
      netUplift: netUplift,
      tenYearValue: tenYearValue
    };
  }

  function formatPaybackYears(years) {
    if (!Number.isFinite(years) || years <= 0) return 'No payback';
    if (years >= 100) return '100+ years';
    return numberOne.format(years) + ' years';
  }

  function resolveInsight(state, model) {
    var cycleCaution = model.candidateCyclesPerYear > 365
      ? ' This assumes more than one worthwhile cycle per day on average, so sanity-check it against your tariff shape and battery warranty.'
      : '';

    if (model.cycleNetValue <= 0) {
      return 'This scenario destroys value: each full cycle costs more to charge than it earns later. Change the tariff assumptions before worrying about automation.' + cycleCaution;
    }

    if (state.automationCaptureRate < state.manualCaptureRate) {
      return 'Your automation capture rate is lower than the manual capture rate, so the model shows a negative automation case by design.' + cycleCaution;
    }

    if (model.netUplift <= 0 && model.automationUplift > 0) {
      return 'Automation still captures extra value here, but the software cost you entered absorbs the entire uplift.' + cycleCaution;
    }

    if (model.automationUplift < 150) {
      return 'The automation case is thin. A static schedule or occasional manual intervention may already catch most of the value.' + cycleCaution;
    }

    if (model.automationUplift < 400) {
      return 'This is a moderate automation case. The economics work, but the margin depends heavily on how often the opportunity appears.' + cycleCaution;
    }

    if (model.automationUplift < 700) {
      return 'This is a solid automation case. The uplift is large enough that missing high-value windows manually becomes expensive.' + cycleCaution;
    }

    return 'This is a strong automation case. Regular high-value cycles and a large capture gap create meaningful upside for rule-based control.' + cycleCaution;
  }

  function updateResults(state, model) {
    setText('annualBatteryValue', annualCurrency.format(model.automationAnnualValue));
    setText('annualBatteryValueSub', numberOne.format(model.automationSuccessfulCycles) + ' successful automated cycles per year');
    setText('automationUpliftValue', annualCurrency.format(model.automationUplift));
    setText('automationUpliftSub', 'Versus manual capture at ' + state.manualCaptureRate + '%');
    setText('netUpliftValue', annualCurrency.format(model.netUplift));
    setText('netUpliftSub', 'After ' + annualCurrency.format(state.annualSoftwareCost) + ' annual software cost');

    if (state.batterySystemCost > 0) {
      if (model.automationAnnualValue > 0) {
        var paybackYears = state.batterySystemCost / model.automationAnnualValue;
        setText('simplePaybackValue', formatPaybackYears(paybackYears));
        setText('simplePaybackSub', 'Simple payback from annual timed-use value (software cost excluded)');
      } else {
        setText('simplePaybackValue', 'No payback');
        setText('simplePaybackSub', 'The annual timed-use value is not positive under this scenario');
      }
    } else {
      setText('simplePaybackValue', 'Add a battery cost');
      setText('simplePaybackSub', 'Optional based on annual timed-use value (excludes software cost)');
    }

    setText('manualCaptureDisplay', state.manualCaptureRate + '%');
    setText('automationCaptureDisplay', state.automationCaptureRate + '%');
    setWidth('manualCaptureBar', state.manualCaptureRate);
    setWidth('automationCaptureBar', state.automationCaptureRate);

    setText('valuePerCycle', cycleCurrency.format(model.cycleNetValue));
    setText('annualShiftedEnergy', numberOne.format(model.annualShiftedEnergy) + ' kWh');
    setText('tenYearValue', annualCurrency.format(model.tenYearValue));
    setText('scenarioInsight', resolveInsight(state, model));
  }

  function valuesMatchForPreset(key, left, right) {
    var normalizedLeft = key === 'batterySystemCost' ? Number(left || 0) : Number(left);
    var normalizedRight = key === 'batterySystemCost' ? Number(right || 0) : Number(right);
    return normalizedLeft === normalizedRight;
  }

  function presetMatchesState(preset, state) {
    return QUERY_KEYS.every(function (key) {
      return valuesMatchForPreset(key, preset[key], state[key]);
    });
  }

  function setPresetSelection(name) {
    var presetButtons = document.querySelectorAll('.tool-preset');
    presetButtons.forEach(function (button) {
      var isActive = name && button.getAttribute('data-preset') === name;
      button.classList.toggle('is-active', Boolean(isActive));
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function syncPresetSelection(state) {
    var presetNames = Object.keys(PRESETS);
    for (var i = 0; i < presetNames.length; i += 1) {
      var name = presetNames[i];
      if (presetMatchesState(PRESETS[name], state)) {
        setPresetSelection(name);
        return;
      }
    }
    setPresetSelection('');
  }

  function applyPreset(name) {
    var preset = PRESETS[name];
    if (!preset) return;

    QUERY_KEYS.forEach(function (key) {
      writeInputValue(key, preset[key]);
    });
    setPresetSelection(name);
  }

  function clearPresetSelection() {
    setPresetSelection('');
  }

  function bindPresets() {
    var presetButtons = document.querySelectorAll('.tool-preset');
    presetButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        var presetName = button.getAttribute('data-preset');
        applyPreset(presetName);
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
    var state = readState();
    syncPresetSelection(state);
    var model = calculateModel(state);
    updateResults(state, model);
    serializeState(state);
  }

  document.addEventListener('DOMContentLoaded', function () {
    loadQueryState();
    bindNavBurger();
    bindPresets();

    var form = document.getElementById('batteryRoiForm');
    if (form) {
      form.addEventListener('input', function () {
        clearPresetSelection();
        refresh();
      });
      form.addEventListener('change', function () {
        clearPresetSelection();
        refresh();
      });
    }

    refresh();
  });
})();
