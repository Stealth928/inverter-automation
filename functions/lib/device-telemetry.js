'use strict';

const SOC_VARIABLE_ALIASES = Object.freeze(['SoC', 'SoC1', 'SoC_1']);
const BATTERY_TEMPERATURE_ALIASES = Object.freeze(['batTemperature', 'batTemperature_1']);
const AMBIENT_TEMPERATURE_ALIASES = Object.freeze(['ambientTemperation', 'ambientTemperature']);

function toAliasArray(aliases) {
  if (Array.isArray(aliases)) return aliases;
  if (aliases === null || aliases === undefined) return [];
  return [aliases];
}

function getInverterDatas(inverterData) {
  const datas = inverterData && inverterData.result && inverterData.result[0] && inverterData.result[0].datas;
  return Array.isArray(datas) ? datas : [];
}

function findVariableData(datas, aliases) {
  if (!Array.isArray(datas) || datas.length === 0) {
    return null;
  }

  const aliasList = toAliasArray(aliases);
  for (const alias of aliasList) {
    if (!alias) continue;
    const match = datas.find((entry) => entry && entry.variable === alias);
    if (match) return match;
  }

  return null;
}

function getVariableValue(datas, aliases, fallback = null) {
  const variableData = findVariableData(datas, aliases);
  if (!variableData || variableData.value === undefined) {
    return fallback;
  }
  return variableData.value;
}

function parseAutomationTelemetry(inverterData) {
  const datas = getInverterDatas(inverterData);
  return {
    soc: getVariableValue(datas, SOC_VARIABLE_ALIASES, null),
    batTemp: getVariableValue(datas, BATTERY_TEMPERATURE_ALIASES, null),
    ambientTemp: getVariableValue(datas, AMBIENT_TEMPERATURE_ALIASES, null)
  };
}

module.exports = {
  AMBIENT_TEMPERATURE_ALIASES,
  BATTERY_TEMPERATURE_ALIASES,
  SOC_VARIABLE_ALIASES,
  findVariableData,
  getInverterDatas,
  getVariableValue,
  parseAutomationTelemetry
};
