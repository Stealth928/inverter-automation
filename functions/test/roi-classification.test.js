'use strict';

const {
  resolveRoiEventClassification
} = require('../../frontend/js/roi-classification');

describe('ROI event classification', () => {
  test('classifies SelfUse from roiSnapshot workMode as neutral', () => {
    const result = resolveRoiEventClassification({
      roiSnapshot: { workMode: 'SelfUse' },
      action: { workMode: 'ForceDischarge' },
      ruleName: 'Discharge by name should not override'
    });

    expect(result).toEqual({
      isChargeRule: false,
      isDischargeRule: false,
      isExportMode: false,
      isFeedinRule: false,
      ruleType: 'Self Use'
    });
  });

  test('classifies ForceDischarge from action workMode', () => {
    const result = resolveRoiEventClassification({
      action: { workMode: 'ForceDischarge' }
    });

    expect(result).toEqual({
      isChargeRule: false,
      isDischargeRule: true,
      isExportMode: false,
      isFeedinRule: false,
      ruleType: 'Discharge'
    });
  });

  test('classifies Feedin from action workMode as export mode', () => {
    const result = resolveRoiEventClassification({
      action: { workMode: 'Feedin' }
    });

    expect(result).toEqual({
      isChargeRule: false,
      isDischargeRule: true,
      isExportMode: true,
      isFeedinRule: true,
      ruleType: 'Feed In'
    });
  });

  test('treats generic names with no signal as Unknown (not Discharge)', () => {
    const result = resolveRoiEventClassification({
      ruleName: 'Test rule'
    });

    expect(result).toEqual({
      isChargeRule: false,
      isDischargeRule: false,
      isExportMode: false,
      isFeedinRule: false,
      ruleType: 'Unknown'
    });
  });

  test('classifies discharge names before charge substring fallback', () => {
    const result = resolveRoiEventClassification({
      ruleName: 'Evening discharge rule'
    });

    expect(result).toEqual({
      isChargeRule: false,
      isDischargeRule: true,
      isExportMode: false,
      isFeedinRule: false,
      ruleType: 'Discharge'
    });
  });

  test('classifies export names before generic discharge fallback', () => {
    const result = resolveRoiEventClassification({
      ruleName: 'High export feed-in window'
    });

    expect(result).toEqual({
      isChargeRule: false,
      isDischargeRule: true,
      isExportMode: true,
      isFeedinRule: true,
      ruleType: 'Feed In'
    });
  });

  test('classifies triggered rule name from startAllRules fallback', () => {
    const result = resolveRoiEventClassification({
      startAllRules: [
        { name: 'Some other rule', triggered: false },
        { name: 'Self Use overnight', triggered: true }
      ]
    });

    expect(result).toEqual({
      isChargeRule: false,
      isDischargeRule: false,
      isExportMode: false,
      isFeedinRule: false,
      ruleType: 'Self Use'
    });
  });
});
