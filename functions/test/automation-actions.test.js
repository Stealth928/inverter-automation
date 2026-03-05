'use strict';

const {
  applySegmentToGroups,
  buildAutomationSchedulerSegment,
  buildClearedSchedulerGroups,
  clearSchedulerGroups,
  createDefaultSchedulerGroup,
  ensureSchedulerGroups,
  hasConfiguredSegment
} = require('../lib/automation-actions');

describe('automation action helpers', () => {
  test('createDefaultSchedulerGroup returns isolated defaults', () => {
    const first = createDefaultSchedulerGroup();
    const second = createDefaultSchedulerGroup();

    expect(first).toEqual({
      enable: 0,
      workMode: 'SelfUse',
      startHour: 0,
      startMinute: 0,
      endHour: 0,
      endMinute: 0,
      minSocOnGrid: 10,
      fdSoc: 10,
      fdPwr: 0,
      maxSoc: 100
    });

    first.enable = 1;
    expect(second.enable).toBe(0);
  });

  test('ensureSchedulerGroups creates one default group when input is empty', () => {
    const groups = ensureSchedulerGroups([]);
    expect(groups).toHaveLength(1);
    expect(groups[0].enable).toBe(0);
    expect(groups[0].workMode).toBe('SelfUse');
  });

  test('hasConfiguredSegment detects enabled or non-zero schedule values', () => {
    expect(hasConfiguredSegment({ enable: 1, startHour: 0, startMinute: 0, endHour: 0, endMinute: 0 })).toBe(true);
    expect(hasConfiguredSegment({ enable: 0, startHour: 1, startMinute: 0, endHour: 0, endMinute: 0 })).toBe(true);
    expect(hasConfiguredSegment({ enable: 0, startHour: 0, startMinute: 0, endHour: 0, endMinute: 0 })).toBe(false);
  });

  test('clearSchedulerGroups resets configured groups and reports count', () => {
    const result = clearSchedulerGroups([
      { enable: 1, workMode: 'ForceDischarge', startHour: 8, startMinute: 0, endHour: 9, endMinute: 0, minSocOnGrid: 20, fdSoc: 20, fdPwr: 5000, maxSoc: 90 },
      { enable: 0, workMode: 'SelfUse', startHour: 0, startMinute: 0, endHour: 0, endMinute: 0, minSocOnGrid: 10, fdSoc: 10, fdPwr: 0, maxSoc: 100 }
    ]);

    expect(result.clearedCount).toBe(1);
    expect(result.groups[0]).toEqual(createDefaultSchedulerGroup());
    expect(result.groups[1].enable).toBe(0);
  });

  test('buildAutomationSchedulerSegment normalizes defaults and fdPwr', () => {
    const segment = buildAutomationSchedulerSegment(
      {
        workMode: 'ForceDischarge',
        fdPwr: '5000',
        fdSoc: 30
      },
      {
        startHour: 10,
        startMinute: 15,
        endHour: 10,
        endMinute: 45
      }
    );

    expect(segment).toEqual({
      enable: 1,
      workMode: 'ForceDischarge',
      startHour: 10,
      startMinute: 15,
      endHour: 10,
      endMinute: 45,
      minSocOnGrid: 20,
      fdSoc: 30,
      fdPwr: 5000,
      maxSoc: 90
    });
  });

  test('applySegmentToGroups writes segment to target index', () => {
    const segment = buildAutomationSchedulerSegment(
      { workMode: 'ForceCharge', fdPwr: 4200, minSocOnGrid: 15, fdSoc: 35, maxSoc: 95 },
      { startHour: 6, startMinute: 0, endHour: 6, endMinute: 30 }
    );

    const groups = applySegmentToGroups([], segment, 0);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual(segment);
  });

  test('buildClearedSchedulerGroups returns requested count of default groups', () => {
    const groups = buildClearedSchedulerGroups(8);
    expect(groups).toHaveLength(8);
    expect(groups.every((group) => group.enable === 0 && group.workMode === 'SelfUse')).toBe(true);
  });
});
