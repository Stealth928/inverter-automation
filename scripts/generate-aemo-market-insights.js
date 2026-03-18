const fs = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const AGGREGATES_DIR = path.join(ROOT, 'aemo-aggregated-data', 'aggregates');
const OUTPUT_DIR = path.join(ROOT, 'frontend', 'data', 'aemo-market-insights');

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

async function main() {
  const [manifestText, dailyRows, monthlyRows, qualityRows] = await Promise.all([
    fs.readFile(path.join(AGGREGATES_DIR, 'manifest.json'), 'utf8'),
    readCsv(path.join(AGGREGATES_DIR, 'daily_summary.csv'), DAILY_FIELDS),
    readCsv(path.join(AGGREGATES_DIR, 'monthly_summary.csv'), MONTHLY_FIELDS),
    readCsv(path.join(AGGREGATES_DIR, 'quality_report.csv'), QUALITY_FIELDS)
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
    }
  };

  await fs.writeFile(path.join(OUTPUT_DIR, 'index.json'), JSON.stringify(index));
  process.stdout.write(`Wrote AEMO market insights assets to ${OUTPUT_DIR}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exitCode = 1;
});