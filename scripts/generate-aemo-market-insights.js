const fs = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'aemo-aggregated-data');
const AGGREGATES_DIR = path.join(ROOT, 'aemo-aggregated-data', 'aggregates');
const OUTPUT_DIR = path.join(ROOT, 'frontend', 'data', 'aemo-market-insights');
const WORKFLOW_PATH = path.join(ROOT, '.github', 'workflows', 'aemo-market-insights-delta.yml');
const RAW_FILE_RE = /^[A-Z]+\d{6}\.csv$/;

const DAILY_FIELDS = [
  'region', 'period', 'date', 'rowCount', 'meanRRP', 'minRRP', 'maxRRP', 'p05RRP', 'p25RRP', 'p50RRP',
  'p75RRP', 'p90RRP', 'p95RRP', 'meanDemand', 'minDemand', 'maxDemand', 'negativeRRPCount', 'stdRRP',
  'volatilityRRP', 'expectedRowCount', 'missingRowCount', 'coveragePct', 'qualityScore', 'hourCount',
  'hourCoveragePct', 'peakHour', 'peakHourRRP', 'offPeakMeanRRP', 'hoursAboveP95'
];

const MONTHLY_FIELDS = [
  'region', 'period', 'meanRRP', 'minRRP', 'maxRRP', 'p05RRP', 'p25RRP', 'p50RRP', 'p75RRP', 'p90RRP',
  'p95RRP', 'coverageFullPct', 'coverageSpanPct', 'status', 'negativeRRPCount', 'highRRPIntervalCount',
  'highRRPEventCount', 'longestHighRRPEventMinutes', 'intervalModeMinutes', 'rows'
];

const QUALITY_FIELDS = [
  'region', 'period', 'rows', 'issue', 'estimatedMissingIntervals', 'intervalAnomalies', 'malformedRows'
];

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function coerceValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  if (text === 'True') return true;
  if (text === 'False') return false;

  const numeric = Number(text);
  if (!Number.isNaN(numeric) && /^-?\d+(?:\.\d+)?$/.test(text)) {
    return numeric;
  }

  return text;
}

async function readCsv(filePath, selectedFields) {
  const text = await fs.readFile(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  const headers = parseCsvLine(lines[0]);
  const selected = new Set(selectedFields || headers);

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};

    headers.forEach((header, index) => {
      if (!selected.has(header)) return;
      row[header] = coerceValue(values[index]);
    });

    return row;
  });
}

function ensureArrayMap(map, key) {
  if (!map.has(key)) {
    map.set(key, []);
  }
  return map.get(key);
}

function sortByField(rows, field) {
  return rows.sort((left, right) => String(left[field] || '').localeCompare(String(right[field] || '')));
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function averageOf(rows, field) {
  const values = rows
    .map((row) => toFiniteNumber(row[field]))
    .filter((value) => value !== null);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sumOf(rows, field) {
  return rows.reduce((sum, row) => sum + (toFiniteNumber(row[field]) || 0), 0);
}

function minOf(rows, field) {
  const values = rows
    .map((row) => toFiniteNumber(row[field]))
    .filter((value) => value !== null);
  if (!values.length) return null;
  return Math.min(...values);
}

function averageBy(rows, selector) {
  const values = rows
    .map((row) => selector(row))
    .filter((value) => value !== null);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function minBy(rows, selector) {
  const values = rows
    .map((row) => selector(row))
    .filter((value) => value !== null);
  if (!values.length) return null;
  return Math.min(...values);
}

function parseIsoDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addUtcDays(date, dayOffset) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + dayOffset));
}

function toIsoDateOnly(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function diffUtcDays(left, right) {
  if (!(left instanceof Date) || !(right instanceof Date)) return null;
  const leftUtc = Date.UTC(left.getUTCFullYear(), left.getUTCMonth(), left.getUTCDate());
  const rightUtc = Date.UTC(right.getUTCFullYear(), right.getUTCMonth(), right.getUTCDate());
  return Math.round((leftUtc - rightUtc) / 86400000);
}

function deriveCoveragePct(row) {
  const hourCoveragePct = toFiniteNumber(row?.hourCoveragePct);
  if (hourCoveragePct !== null) {
    if (hourCoveragePct >= 0 && hourCoveragePct <= 1) return hourCoveragePct * 100;
    return hourCoveragePct;
  }
  const rowCount = toFiniteNumber(row?.rowCount);
  const expectedRowCount = toFiniteNumber(row?.expectedRowCount);
  if (rowCount !== null && expectedRowCount !== null && expectedRowCount > 0) {
    return Math.max(0, Math.min(100, (rowCount / expectedRowCount) * 100));
  }
  const coveragePct = toFiniteNumber(row?.coveragePct);
  if (coveragePct === null) return null;
  if (coveragePct >= 0 && coveragePct <= 1) return coveragePct * 100;
  return coveragePct;
}

function deriveQualityScore(row) {
  const derivedCoverage = deriveCoveragePct(row);
  if (derivedCoverage !== null) return derivedCoverage;
  const qualityScore = toFiniteNumber(row?.qualityScore);
  if (qualityScore === null) return null;
  if (qualityScore >= 0 && qualityScore <= 1) return qualityScore * 100;
  return qualityScore;
}

function describeWorkflowCadence(cron) {
  const normalized = String(cron || '').trim();
  if (!normalized) {
    return 'Workflow schedule unavailable';
  }
  if (normalized === '25 1 * * *') {
    return 'Daily 01:25 UTC';
  }
  return `Cron ${normalized}`;
}

async function countRawCsvFiles() {
  try {
    const entries = await fs.readdir(RAW_DIR, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && RAW_FILE_RE.test(entry.name)).length;
  } catch (_error) {
    return null;
  }
}

async function readWorkflowSchedule() {
  try {
    const text = await fs.readFile(WORKFLOW_PATH, 'utf8');
    const cronMatch = text.match(/cron:\s*['\"]([^'\"]+)['\"]/i);
    const cron = cronMatch ? cronMatch[1].trim() : null;
    return {
      cron,
      cadenceLabel: describeWorkflowCadence(cron)
    };
  } catch (_error) {
    return {
      cron: null,
      cadenceLabel: 'Workflow schedule unavailable'
    };
  }
}

function buildDataworksStatus({ dataAgeDays, issuePeriods, recentMinCoveragePct, recentAverageQualityScore }) {
  const reasons = [];
  let level = 'good';
  let label = 'Healthy';

  if (Number.isFinite(dataAgeDays) && dataAgeDays > 1) {
    level = dataAgeDays > 3 ? 'bad' : 'warn';
    label = dataAgeDays > 3 ? 'Stale' : 'Lagging';
    reasons.push(`latest market date is ${dataAgeDays} day${dataAgeDays === 1 ? '' : 's'} behind UTC`);
  }

  if (Number.isFinite(recentMinCoveragePct) && recentMinCoveragePct < 99.5) {
    if (level === 'good') {
      level = 'warn';
      label = 'Watch';
    }
    reasons.push(`recent minimum coverage dipped to ${recentMinCoveragePct.toFixed(2)}%`);
  }

  if (Number.isFinite(recentAverageQualityScore) && recentAverageQualityScore < 99) {
    if (level !== 'bad') {
      level = recentAverageQualityScore < 97 ? 'bad' : 'warn';
      label = recentAverageQualityScore < 97 ? 'Degraded' : 'Watch';
    }
    reasons.push(`recent average quality score is ${recentAverageQualityScore.toFixed(2)}`);
  }

  if (Number(issuePeriods || 0) > 0) {
    if (level === 'good') {
      level = 'warn';
      label = 'Watch';
    }
    reasons.push(`${issuePeriods} quality-report period${issuePeriods === 1 ? '' : 's'} flagged`);
  }

  return {
    level,
    label,
    reasons
  };
}

async function main() {
  const [manifestText, dailyRows, monthlyRows, qualityRows, rawCsvFileCount, workflow] = await Promise.all([
    fs.readFile(path.join(AGGREGATES_DIR, 'manifest.json'), 'utf8'),
    readCsv(path.join(AGGREGATES_DIR, 'daily_summary.csv'), DAILY_FIELDS),
    readCsv(path.join(AGGREGATES_DIR, 'monthly_summary.csv'), MONTHLY_FIELDS),
    readCsv(path.join(AGGREGATES_DIR, 'quality_report.csv'), QUALITY_FIELDS),
    countRawCsvFiles(),
    readWorkflowSchedule()
  ]);

  const manifest = JSON.parse(manifestText);
  const dailyByRegion = new Map();
  const monthlyByRegion = new Map();
  const qualityByRegion = new Map();

  dailyRows.forEach((row) => ensureArrayMap(dailyByRegion, row.region).push(row));
  monthlyRows.forEach((row) => ensureArrayMap(monthlyByRegion, row.region).push(row));
  qualityRows.forEach((row) => ensureArrayMap(qualityByRegion, row.region).push(row));

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const regions = Array.from(new Set([
    ...dailyByRegion.keys(),
    ...monthlyByRegion.keys(),
    ...qualityByRegion.keys()
  ])).sort();

  const files = {};
  let minDate = null;
  let maxDate = null;
  let minPeriod = null;
  let maxPeriod = null;

  for (const region of regions) {
    const daily = sortByField(dailyByRegion.get(region) || [], 'date');
    const monthly = sortByField(monthlyByRegion.get(region) || [], 'period');
    const quality = sortByField(qualityByRegion.get(region) || [], 'period');

    const latestDaily = daily[daily.length - 1] || null;
    const latestMonthly = monthly[monthly.length - 1] || null;

    if (daily.length) {
      minDate = minDate && minDate < daily[0].date ? minDate : daily[0].date;
      maxDate = maxDate && maxDate > latestDaily.date ? maxDate : latestDaily.date;
    }
    if (monthly.length) {
      minPeriod = minPeriod && minPeriod < monthly[0].period ? minPeriod : monthly[0].period;
      maxPeriod = maxPeriod && maxPeriod > latestMonthly.period ? maxPeriod : latestMonthly.period;
    }

    const payload = {
      region,
      generatedAt: new Date().toISOString(),
      sourceGeneratedAt: manifest.generatedAt,
      latestDate: latestDaily ? latestDaily.date : null,
      latestPeriod: latestMonthly ? latestMonthly.period : null,
      daily,
      monthly,
      quality,
      qualityPeriods: quality.filter((row) => row.issue && row.issue !== 'none').map((row) => row.period)
    };

    const fileName = `${region}.json`;
    await fs.writeFile(path.join(OUTPUT_DIR, fileName), JSON.stringify(payload));
    files[region] = `/data/aemo-market-insights/${fileName}`;
  }

  const latestDataDate = parseIsoDate(maxDate);
  const currentUtcDate = new Date();
  const currentUtcMidnight = new Date(Date.UTC(
    currentUtcDate.getUTCFullYear(),
    currentUtcDate.getUTCMonth(),
    currentUtcDate.getUTCDate()
  ));
  const currentUtcPeriod = Number(`${currentUtcDate.getUTCFullYear()}${String(currentUtcDate.getUTCMonth() + 1).padStart(2, '0')}`);
  const latestPeriodNumber = Number(maxPeriod || 0);
  const latestDataAgeDays = latestDataDate ? diffUtcDays(currentUtcMidnight, latestDataDate) : null;
  const hasInProgressDay = Number.isFinite(latestDataAgeDays) && latestDataAgeDays === 0;
  const hasInProgressMonth = Number.isFinite(latestPeriodNumber) && latestPeriodNumber === currentUtcPeriod;
  const qualityWindowEndDate = hasInProgressDay ? addUtcDays(latestDataDate, -1) : latestDataDate;
  const qualityWindowEndIso = toIsoDateOnly(qualityWindowEndDate);
  const issueRows = qualityRows
    .filter((row) => row.issue && row.issue !== 'none')
    .filter((row) => !hasInProgressMonth || Number(row.period || 0) !== currentUtcPeriod)
    .sort((left, right) => `${left.period}|${left.region}`.localeCompare(`${right.period}|${right.region}`));
  const recentWindowDays = 7;
  const recentWindowStart = qualityWindowEndDate ? addUtcDays(qualityWindowEndDate, -(recentWindowDays - 1)) : null;
  const recentWindowStartIso = toIsoDateOnly(recentWindowStart);
  const recentRows = recentWindowStartIso && qualityWindowEndIso
    ? dailyRows.filter((row) => String(row.date || '') >= recentWindowStartIso && String(row.date || '') <= qualityWindowEndIso)
    : [];
  const issueRegions = Array.from(new Set(issueRows.map((row) => row.region))).sort();
  const regionSummaries = regions.map((region) => {
    const daily = sortByField((dailyByRegion.get(region) || []).slice(), 'date');
    const monthly = sortByField((monthlyByRegion.get(region) || []).slice(), 'period');
    const quality = sortByField((qualityByRegion.get(region) || []).slice(), 'period');
    const latestDaily = daily[daily.length - 1] || null;
    const latestPeriod = monthly.length ? monthly[monthly.length - 1].period : null;
    const latestRegionDate = parseIsoDate(latestDaily?.date);
    const recentRegionRows = recentWindowStartIso && qualityWindowEndIso
      ? daily.filter((row) => String(row.date || '') >= recentWindowStartIso && String(row.date || '') <= qualityWindowEndIso)
      : [];
    const regionIssueRows = quality
      .filter((row) => row.issue && row.issue !== 'none')
      .filter((row) => !hasInProgressMonth || Number(row.period || 0) !== currentUtcPeriod);
    return {
      region,
      latestDate: latestDaily ? latestDaily.date : null,
      latestPeriod,
      ageDays: latestRegionDate ? diffUtcDays(currentUtcMidnight, latestRegionDate) : null,
      recentCoveragePctMin: minBy(recentRegionRows, deriveCoveragePct),
      recentQualityScoreAvg: averageBy(recentRegionRows, deriveQualityScore),
      qualityIssuePeriods: regionIssueRows.length,
      latestQualityIssuePeriod: regionIssueRows.length ? regionIssueRows[regionIssueRows.length - 1].period : null,
      dailyCount: daily.length,
      monthlyCount: monthly.length
    };
  });
  const recentAverageCoveragePct = averageBy(recentRows, deriveCoveragePct);
  const recentMinimumCoveragePct = minBy(recentRows, deriveCoveragePct);
  const recentAverageQualityScore = averageBy(recentRows, deriveQualityScore);
  const recentMinimumQualityScore = minBy(recentRows, deriveQualityScore);
  const dataAgeDays = latestDataAgeDays;
  const dataworksStatus = buildDataworksStatus({
    dataAgeDays,
    issuePeriods: issueRows.length,
    recentMinCoveragePct: recentMinimumCoveragePct,
    recentAverageQualityScore
  });

  const index = {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: manifest.generatedAt,
    regions,
    files,
    defaults: {
      regions: regions.includes('NSW') ? ['NSW'] : regions.slice(0, 1),
      granularity: 'daily',
      preset: '30d',
      qualityScoreMin: 0,
      thresholdQuantile: 95
    },
    bounds: {
      minDate,
      maxDate,
      minPeriod,
      maxPeriod
    },
    counts: {
      daily: manifest.dailyCount,
      monthly: manifest.monthlyCount
    },
    dataworks: {
      status: dataworksStatus,
      freshness: {
        latestDate: maxDate,
        latestPeriod: maxPeriod,
        dataAgeDays,
        generatedAgeHours: (() => {
          const generatedAt = new Date(manifest.generatedAt);
          if (Number.isNaN(generatedAt.getTime())) return null;
          return Math.round(((Date.now() - generatedAt.getTime()) / 3600000) * 10) / 10;
        })(),
        window: {
          days: recentWindowDays,
          startDate: recentWindowStartIso,
          endDate: qualityWindowEndIso
        }
      },
      workflow,
      files: {
        rawCsvFiles: rawCsvFileCount,
        aggregateCsvFiles: 4,
        publishedAssetCount: regions.length + 1,
        dailyRows: manifest.dailyCount,
        monthlyRows: manifest.monthlyCount,
        hourlyRows: manifest.hourlyCount
      },
      quality: {
        issuePeriods: issueRows.length,
        issueRegions,
        latestIssuePeriod: issueRows.length ? issueRows[issueRows.length - 1].period : null,
        estimatedMissingIntervals: sumOf(issueRows, 'estimatedMissingIntervals'),
        intervalAnomalies: sumOf(issueRows, 'intervalAnomalies'),
        malformedRows: sumOf(issueRows, 'malformedRows'),
        recentAverageCoveragePct,
        recentMinimumCoveragePct,
        recentAverageQualityScore,
        recentMinimumQualityScore
      },
      regions: regionSummaries
    }
  };

  await fs.writeFile(path.join(OUTPUT_DIR, 'index.json'), JSON.stringify(index));
  process.stdout.write(`Wrote AEMO market insights assets to ${OUTPUT_DIR}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exitCode = 1;
});