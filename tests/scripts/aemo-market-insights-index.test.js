const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

test('market insights index exposes DataWorks summary metadata', async () => {
  const root = path.resolve(__dirname, '..', '..');
  const indexPath = path.join(root, 'frontend', 'data', 'aemo-market-insights', 'index.json');
  const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));

  assert.ok(index.dataworks, 'expected dataworks summary in index');
  assert.ok(index.dataworks.status, 'expected dataworks status metadata');
  assert.ok(index.dataworks.freshness, 'expected dataworks freshness metadata');
  assert.ok(index.dataworks.quality, 'expected dataworks quality metadata');
  assert.ok(index.dataworks.files, 'expected dataworks file metadata');
  assert.ok(index.dataworks.workflow, 'expected workflow cadence metadata');
  assert.ok(Array.isArray(index.dataworks.regions), 'expected per-region DataWorks rows');
  assert.equal(index.dataworks.regions.length, index.regions.length, 'region summaries should align with published regions');
  assert.equal(
    index.dataworks.files.publishedAssetCount,
    Object.keys(index.files || {}).length + 1,
    'published asset count should equal region payloads plus the index file'
  );
  assert.equal(index.dataworks.files.dailyRows, index.counts.daily, 'daily row counts should stay aligned');
  assert.equal(index.dataworks.files.monthlyRows, index.counts.monthly, 'monthly row counts should stay aligned');
});