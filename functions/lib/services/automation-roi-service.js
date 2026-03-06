'use strict';

const HOUSE_LOAD_KEYS = [
  'loadspower',
  'loadpower',
  'load',
  'houseload',
  'house_load',
  'consumption',
  'load_active_power',
  'loadactivepower',
  'loadsPower'
];

function findValue(arr, keysOrPatterns) {
  if (!Array.isArray(arr)) return null;
  for (const key of keysOrPatterns) {
    const lowerKey = String(key).toLowerCase();

    const exact = arr.find((item) =>
      (item.variable && item.variable.toString().toLowerCase() === lowerKey) ||
      (item.key && item.key.toString().toLowerCase() === lowerKey)
    );
    if (exact && exact.value !== undefined && exact.value !== null) return exact.value;

    const includes = arr.find((item) =>
      (item.variable && item.variable.toString().toLowerCase().includes(lowerKey)) ||
      (item.key && item.key.toString().toLowerCase().includes(lowerKey))
    );
    if (includes && includes.value !== undefined && includes.value !== null) return includes.value;
  }
  return null;
}

function normalizeInverterDatas(inverterData) {
  let datas = [];

  if (Array.isArray(inverterData?.result)) {
    if (inverterData.result.length > 0 && Array.isArray(inverterData.result[0].datas)) {
      inverterData.result.forEach((frame) => {
        if (Array.isArray(frame.datas)) {
          datas.push(...frame.datas);
        }
      });
    } else {
      datas = inverterData.result.slice();
    }
  } else if (inverterData?.result && typeof inverterData.result === 'object') {
    if (Array.isArray(inverterData.result.datas)) {
      datas = inverterData.result.datas.slice();
    } else if (Array.isArray(inverterData.result.data)) {
      datas = inverterData.result.data.slice();
    }
  }

  return datas;
}

function extractHouseLoadWatts(inverterData, logger = console) {
  const logError = logger && typeof logger.error === 'function' ? logger.error.bind(logger) : console.error;
  const logWarn = logger && typeof logger.warn === 'function' ? logger.warn.bind(logger) : console.warn;

  if (!inverterData || inverterData.errno !== 0) {
    logError(
      `[Automation ROI] Cannot extract house load - inverterData invalid: errno=${inverterData?.errno}, error=${inverterData?.error || inverterData?.msg || 'unknown'}`
    );
  }

  const datas = normalizeInverterDatas(inverterData);

  if (datas.length === 0) {
    logError(
      `[Automation ROI] No datapoints extracted! inverterData structure: errno=${inverterData?.errno}, hasResult=${!!inverterData?.result}, resultType=${Array.isArray(inverterData?.result) ? 'array' : typeof inverterData?.result}, resultLength=${Array.isArray(inverterData?.result) ? inverterData.result.length : 'N/A'}`
    );
    if (inverterData?.result && Array.isArray(inverterData.result) && inverterData.result.length > 0) {
      logError(
        `[Automation ROI] First result item structure: ${JSON.stringify(Object.keys(inverterData.result[0]))}, hasDatas=${!!inverterData.result[0].datas}`
      );
    }
  }

  let houseLoadW = findValue(datas, HOUSE_LOAD_KEYS);

  if (houseLoadW !== null && houseLoadW !== undefined) {
    houseLoadW = Number(houseLoadW);
    if (Number.isNaN(houseLoadW)) {
      logWarn(`[Automation ROI] House load found but NaN: ${houseLoadW}`);
      houseLoadW = null;
    } else if (Math.abs(houseLoadW) < 100) {
      houseLoadW *= 1000;
    }
  }

  if (houseLoadW === null) {
    logError(
      `[Automation ROI] FAILED to extract house load from ${datas.length} datapoints - tried keys: ${HOUSE_LOAD_KEYS.join(', ')}`
    );
    if (datas.length > 0) {
      const presentVars = datas
        .map((dataPoint) => dataPoint.variable || dataPoint.key)
        .filter((value) => value)
        .join(', ');
      logError(`[Automation ROI] Variables present in data: [${presentVars}]`);
    }
  }

  return {
    houseLoadW
  };
}

module.exports = {
  extractHouseLoadWatts,
  findValue,
  normalizeInverterDatas
};
