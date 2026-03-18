const fs = require('fs/promises');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'aemo-aggregated-data');
const AGG_DIR = path.join(ROOT, 'aemo-aggregated-data', 'aggregates');
const DELTA_TMP_DIR = path.join(AGG_DIR, '.delta-tmp');
const STATE_PATH = path.join(AGG_DIR, 'delta-state.json');
const MANIFEST_PATH = path.join(AGG_DIR, 'manifest.json');

const RAW_FILE_RE = /^(?<region>[A-Z]+)(?<period>\d{6})\.csv$/;

const CSV_CONFIG = [
  {
    name: 'monthly_summary.csv',
    keyOf: (row) => `${row.region}|${row.period}`,
    sortBy: ['region', 'period']
  },
  {
    name: 'daily_summary.csv',
    keyOf: (row) => `${row.region}|${row.date}`,
    sortBy: ['region', 'date']
  },
  {
    name: 'hourly_summary.csv',
    keyOf: (row) => `${row.region}|${row.hour}`,
    sortBy: ['region', 'hour']
  },
  {
    name: 'quality_report.csv',
    keyOf: (row) => `${row.region}|${row.period}`,
    sortBy: ['region', 'period']
  }
];

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  values.push(current);
  return values;
}

function toCsvValue(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

async function readCsv(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
    if (!lines.length) return { headers: [], rows: [] };

    const headers = parseCsvLine(lines[0]);
    const rows = lines.slice(1).map((line) => {
      const values = parseCsvLine(line);
      const row = {};
      headers.forEach((header, idx) => {
        row[header] = values[idx] ?? '';
      });
      return row;
    });

    return { headers, rows };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { headers: [], rows: [] };
    }
    throw error;
  }
}

async function writeCsv(filePath, headers, rows) {
  const lines = [headers.map(toCsvValue).join(',')];
  for (const row of rows) {
    const line = headers.map((header) => toCsvValue(row[header])).join(',');
    lines.push(line);
  }
  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
}

async function listRawFiles() {
  const entries = await fs.readdir(RAW_DIR, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = RAW_FILE_RE.exec(entry.name);
    if (!match) continue;

    const fullPath = path.join(RAW_DIR, entry.name);
    const stat = await fs.stat(fullPath);
    out.push({
      name: entry.name,
      path: fullPath,
      region: match.groups.region,
      period: match.groups.period,
      size: stat.size,
      mtimeMs: Math.trunc(stat.mtimeMs)
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function readState() {
  try {
    const text = await fs.readFile(STATE_PATH, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { files: {} };
    }
    throw error;
  }
}

function toMonth(period) {
  return `${period.slice(0, 4)}-${period.slice(4, 6)}`;
}

function runCommand(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: false,
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${cmd} exited with code ${result.status}`);
  }
}

function sortRows(rows, fields) {
  return rows.sort((left, right) => {
    for (const field of fields) {
      const a = String(left[field] ?? '');
      const b = String(right[field] ?? '');
      const cmp = a.localeCompare(b);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
}

async function mergeCsv(config) {
  const basePath = path.join(AGG_DIR, config.name);
  const deltaPath = path.join(DELTA_TMP_DIR, config.name);

  const [{ headers: baseHeaders, rows: baseRows }, { headers: deltaHeaders, rows: deltaRows }] = await Promise.all([
    readCsv(basePath),
    readCsv(deltaPath)
  ]);

  if (!deltaRows.length) {
    return { count: baseRows.length, headers: baseHeaders };
  }

  const headers = baseHeaders.length ? baseHeaders : deltaHeaders;
  const merged = new Map();

  for (const row of baseRows) {
    merged.set(config.keyOf(row), row);
  }
  for (const row of deltaRows) {
    merged.set(config.keyOf(row), row);
  }

  const mergedRows = sortRows(Array.from(merged.values()), config.sortBy);
  await writeCsv(basePath, headers, mergedRows);

  return { count: mergedRows.length, headers };
}

async function writeManifest(meta) {
  const monthly = await readCsv(path.join(AGG_DIR, 'monthly_summary.csv'));
  const daily = await readCsv(path.join(AGG_DIR, 'daily_summary.csv'));
  const hourly = await readCsv(path.join(AGG_DIR, 'hourly_summary.csv'));
  const regions = Array.from(new Set(monthly.rows.map((row) => row.region))).sort();

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceDir: path.resolve(RAW_DIR),
    filesProcessed: meta.changedFiles,
    outDir: path.resolve(AGG_DIR),
    monthlyCount: monthly.rows.length,
    dailyCount: daily.rows.length,
    hourlyCount: hourly.rows.length,
    start: meta.startMonth,
    end: meta.endMonth,
    regions,
    delta: {
      changedCsvFiles: meta.changedFileNames,
      changedPeriods: meta.changedPeriods,
      changedRegions: meta.changedRegions
    }
  };

  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
}

async function main() {
  await fs.mkdir(AGG_DIR, { recursive: true });

  const [state, rawFiles] = await Promise.all([readState(), listRawFiles()]);
  const prevFiles = state.files || {};

  const changed = rawFiles.filter((file) => {
    const prev = prevFiles[file.name];
    if (!prev) return true;
    return prev.size !== file.size || prev.mtimeMs !== file.mtimeMs;
  });

  if (!changed.length) {
    console.log('No changed AEMO CSV files detected. Delta update skipped.');
    return;
  }

  const changedPeriods = Array.from(new Set(changed.map((f) => f.period))).sort();
  const changedRegions = Array.from(new Set(changed.map((f) => f.region))).sort();
  const minPeriod = changedPeriods[0];
  const maxPeriod = changedPeriods[changedPeriods.length - 1];

  await fs.rm(DELTA_TMP_DIR, { recursive: true, force: true });
  await fs.mkdir(DELTA_TMP_DIR, { recursive: true });

  const pythonBin = process.env.PYTHON_BIN || 'python';
  const aggregateScript = path.join(ROOT, 'aggregate_aemo_monthly.py');
  const aggregateArgs = [
    aggregateScript,
    '--source', RAW_DIR,
    '--out', DELTA_TMP_DIR,
    '--start', toMonth(minPeriod),
    '--end', toMonth(maxPeriod),
    '--regions', ...changedRegions
  ];

  console.log(`Delta aggregation for periods ${minPeriod}..${maxPeriod} and regions ${changedRegions.join(', ')}`);
  runCommand(pythonBin, aggregateArgs, { cwd: ROOT });

  for (const config of CSV_CONFIG) {
    await mergeCsv(config);
  }

  await writeManifest({
    changedFiles: changed.length,
    changedFileNames: changed.map((f) => f.name),
    changedPeriods,
    changedRegions,
    startMonth: toMonth(minPeriod),
    endMonth: toMonth(maxPeriod)
  });

  const nextState = {
    updatedAt: new Date().toISOString(),
    files: Object.fromEntries(rawFiles.map((f) => [f.name, { size: f.size, mtimeMs: f.mtimeMs }]))
  };
  await fs.writeFile(STATE_PATH, JSON.stringify(nextState, null, 2), 'utf8');

  const generatorScript = path.join(ROOT, 'scripts', 'generate-aemo-market-insights.js');
  runCommand(process.execPath, [generatorScript], { cwd: ROOT });

  await fs.rm(DELTA_TMP_DIR, { recursive: true, force: true });
  console.log(`Delta update complete. Changed CSV files: ${changed.length}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
