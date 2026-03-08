'use strict';

const DEFAULT_SCHEDULER_GROUP = Object.freeze({
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

function createDefaultSchedulerGroup() {
  return {
    ...DEFAULT_SCHEDULER_GROUP
  };
}

function buildClearedSchedulerGroups(count = 8) {
  const safeCount = Number.isInteger(count) && count > 0 ? count : 8;
  const groups = [];

  for (let i = 0; i < safeCount; i++) {
    groups.push(createDefaultSchedulerGroup());
  }

  return groups;
}

function cloneSchedulerGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return groups.map((group) => ({
    ...group
  }));
}

function ensureSchedulerGroups(groups) {
  const normalized = cloneSchedulerGroups(groups);
  if (normalized.length === 0) {
    normalized.push(createDefaultSchedulerGroup());
  }
  return normalized;
}

function hasConfiguredSegment(group) {
  if (!group || typeof group !== 'object') {
    return false;
  }

  return (
    Number(group.enable) === 1 ||
    Number(group.startHour || 0) !== 0 ||
    Number(group.startMinute || 0) !== 0 ||
    Number(group.endHour || 0) !== 0 ||
    Number(group.endMinute || 0) !== 0
  );
}

function clearSchedulerGroups(groups) {
  const normalized = ensureSchedulerGroups(groups);
  let clearedCount = 0;

  const clearedGroups = normalized.map((group) => {
    if (!hasConfiguredSegment(group)) {
      return group;
    }
    clearedCount += 1;
    return createDefaultSchedulerGroup();
  });

  return {
    groups: clearedGroups,
    clearedCount
  };
}

function buildAutomationSchedulerSegment(action, timeWindow) {
  const safeAction = action && typeof action === 'object' ? action : {};
  const window = timeWindow && typeof timeWindow === 'object' ? timeWindow : {};
  const normalizedFdPwr = Number(safeAction.fdPwr ?? 0);

  const workMode = safeAction.workMode || 'SelfUse';
  const minSocOnGrid = safeAction.minSocOnGrid ?? 20;
  let fdSoc = safeAction.fdSoc ?? 35;

  // Safety: stop SoC must never be below min on-grid SoC regardless of mode
  if (fdSoc < minSocOnGrid) {
    fdSoc = minSocOnGrid;
  }

  return {
    enable: 1,
    workMode,
    startHour: Number(window.startHour || 0),
    startMinute: Number(window.startMinute || 0),
    endHour: Number(window.endHour || 0),
    endMinute: Number(window.endMinute || 0),
    minSocOnGrid,
    fdSoc,
    fdPwr: Number.isFinite(normalizedFdPwr) ? normalizedFdPwr : 0,
    maxSoc: safeAction.maxSoc ?? 90
  };
}

function applySegmentToGroups(groups, segment, index = 0) {
  const normalized = ensureSchedulerGroups(groups);
  const targetIndex = Number.isInteger(index) && index >= 0 ? index : 0;
  normalized[targetIndex] = segment;
  return normalized;
}

module.exports = {
  applySegmentToGroups,
  buildAutomationSchedulerSegment,
  buildClearedSchedulerGroups,
  clearSchedulerGroups,
  createDefaultSchedulerGroup,
  ensureSchedulerGroups,
  hasConfiguredSegment
};
