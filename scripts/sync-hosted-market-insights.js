const fs = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'frontend', 'data', 'aemo-market-insights');
const LOCAL_INDEX_PATH = path.join(OUTPUT_DIR, 'index.json');
const REMOTE_DATA_PREFIX = '/data/aemo-market-insights/';
const STRICT_MODE = process.argv.includes('--strict') || String(process.env.MARKET_INSIGHTS_SYNC_STRICT || '').trim() === '1';
const DEFAULT_HOSTS = [
  'https://inverter-automation-firebase.web.app',
  'https://inverter-automation-firebase.firebaseapp.com'
];

function uniqueHosts(values) {
  return Array.from(new Set(
    values
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ));
}

function buildHostList() {
  return uniqueHosts([
    process.env.MARKET_INSIGHTS_HOST_URL,
    ...DEFAULT_HOSTS
  ]);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'Cache-Control': 'no-cache'
    }
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function withCacheBust(url) {
  const sep = String(url).includes('?') ? '&' : '?';
  return `${url}${sep}ts=${Date.now()}`;
}

function getFreshness(index) {
  if (!index || typeof index !== 'object') {
    return { maxDate: null, generatedAtMs: null };
  }

  const maxDate = String(index?.bounds?.maxDate || index?.dataworks?.freshness?.latestDate || '').trim() || null;
  const generatedAtMs = Date.parse(String(index.generatedAt || '').trim());

  return {
    maxDate,
    generatedAtMs: Number.isFinite(generatedAtMs) ? generatedAtMs : null
  };
}

function compareFreshness(left, right) {
  const leftDate = String(left?.maxDate || '').trim();
  const rightDate = String(right?.maxDate || '').trim();

  if (leftDate && rightDate && leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }

  if (leftDate && !rightDate) return 1;
  if (!leftDate && rightDate) return -1;

  const leftGeneratedAtMs = Number.isFinite(left?.generatedAtMs) ? left.generatedAtMs : null;
  const rightGeneratedAtMs = Number.isFinite(right?.generatedAtMs) ? right.generatedAtMs : null;

  if (leftGeneratedAtMs !== null && rightGeneratedAtMs !== null && leftGeneratedAtMs !== rightGeneratedAtMs) {
    return leftGeneratedAtMs > rightGeneratedAtMs ? 1 : -1;
  }

  if (leftGeneratedAtMs !== null && rightGeneratedAtMs === null) return 1;
  if (leftGeneratedAtMs === null && rightGeneratedAtMs !== null) return -1;

  return 0;
}

function resolveRemoteDataUrl(baseUrl, assetPath) {
  const normalizedPath = String(assetPath || '').trim();
  if (!normalizedPath.startsWith(REMOTE_DATA_PREFIX)) {
    throw new Error(`Unexpected market insights asset path: ${normalizedPath || '(empty)'}`);
  }

  return new URL(normalizedPath, `${String(baseUrl).replace(/\/+$/, '')}/`).toString();
}

async function loadRemoteBundle(baseUrl) {
  const normalizedBaseUrl = String(baseUrl || '').replace(/\/+$/, '');
  const indexUrl = withCacheBust(`${normalizedBaseUrl}${REMOTE_DATA_PREFIX}index.json`);
  const index = await fetchJson(indexUrl);

  const files = { 'index.json': index };
  const assets = Object.entries(index?.files || {});

  for (const [, assetPath] of assets) {
    const assetUrl = withCacheBust(resolveRemoteDataUrl(normalizedBaseUrl, assetPath));
    const fileName = path.basename(new URL(assetUrl).pathname);
    files[fileName] = await fetchJson(assetUrl);
  }

  return { baseUrl: normalizedBaseUrl, index, files };
}

async function readLocalIndex() {
  try {
    const text = await fs.readFile(LOCAL_INDEX_PATH, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeBundle(files) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  for (const [fileName, payload] of Object.entries(files)) {
    const targetPath = path.join(OUTPUT_DIR, fileName);
    await fs.writeFile(targetPath, JSON.stringify(payload), 'utf8');
  }
}

async function main() {
  const localIndex = await readLocalIndex();
  const localFreshness = getFreshness(localIndex);
  const hosts = buildHostList();

  let remoteBundle = null;
  let lastError = null;

  for (const host of hosts) {
    try {
      remoteBundle = await loadRemoteBundle(host);
      break;
    } catch (error) {
      lastError = error;
      console.warn(`[MarketInsightsSync] Failed to fetch hosted bundle from ${host}: ${error.message || error}`);
    }
  }

  if (!remoteBundle) {
    if (STRICT_MODE) {
      throw new Error(`[MarketInsightsSync] Unable to fetch hosted market insights bundle in strict mode.${lastError ? ` Last error: ${lastError.message || lastError}` : ''}`);
    }
    console.warn(`[MarketInsightsSync] Unable to fetch hosted market insights bundle. Keeping local files as-is.${lastError ? ` Last error: ${lastError.message || lastError}` : ''}`);
    return;
  }

  const remoteFreshness = getFreshness(remoteBundle.index);
  const comparison = compareFreshness(remoteFreshness, localFreshness);

  if (comparison > 0) {
    await writeBundle(remoteBundle.files);
    console.log(`[MarketInsightsSync] Synced hosted market insights from ${remoteBundle.baseUrl} into ${OUTPUT_DIR}`);
    console.log(`[MarketInsightsSync] Hosted maxDate=${remoteFreshness.maxDate || '-'} local maxDate=${localFreshness.maxDate || '-'}`);
    return;
  }

  console.log(`[MarketInsightsSync] Local market insights are current or fresher. local maxDate=${localFreshness.maxDate || '-'} hosted maxDate=${remoteFreshness.maxDate || '-'}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
