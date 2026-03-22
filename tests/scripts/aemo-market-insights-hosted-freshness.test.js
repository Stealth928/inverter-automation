const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const localIndexPath = path.join(repoRoot, 'frontend', 'data', 'aemo-market-insights', 'index.json');
const hostedUrls = [
  'https://inverter-automation-firebase.web.app/data/aemo-market-insights/index.json',
  'https://inverter-automation-firebase.firebaseapp.com/data/aemo-market-insights/index.json'
];

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

async function fetchHostedIndex(url) {
  const response = await fetch(`${url}?ts=${Date.now()}`, {
    headers: { 'Cache-Control': 'no-cache' }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function loadFirstHostedIndex(urls) {
  let lastError = null;

  for (const url of urls) {
    try {
      const index = await fetchHostedIndex(url);
      return { index, url };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Unable to fetch hosted Market Insights index from any configured URL. Last error: ${lastError?.message || lastError}`);
}

test('checked-in market insights bundle is not older than hosted production bundle', async () => {
  const localIndex = JSON.parse(await fs.readFile(localIndexPath, 'utf8'));
  const { index: hostedIndex, url } = await loadFirstHostedIndex(hostedUrls);

  const localFreshness = getFreshness(localIndex);
  const hostedFreshness = getFreshness(hostedIndex);
  const comparison = compareFreshness(localFreshness, hostedFreshness);

  assert.notEqual(localFreshness.maxDate, null, 'local Market Insights index is missing maxDate/latestDate');
  assert.notEqual(hostedFreshness.maxDate, null, `hosted Market Insights index from ${url} is missing maxDate/latestDate`);
  assert.ok(
    comparison >= 0,
    `Checked-in Market Insights data is stale. local maxDate=${localFreshness.maxDate || '-'} hosted maxDate=${hostedFreshness.maxDate || '-'} local generatedAt=${localIndex.generatedAt || '-'} hosted generatedAt=${hostedIndex.generatedAt || '-'} source=${url}`
  );
});