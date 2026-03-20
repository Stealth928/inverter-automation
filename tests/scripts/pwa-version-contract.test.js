const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

const {
  collectPwaVersionContract,
  getPwaVersionViolations
} = require('../../scripts/lib/pwa-version-contract');

test('PWA entrypoints stay aligned with the current shell asset versions', () => {
  const root = path.resolve(__dirname, '..', '..');
  const violations = getPwaVersionViolations(root);
  assert.deepEqual(violations, []);
});

test('PWA runtime forces fresh service worker upgrades and release migrations', async () => {
  const root = path.resolve(__dirname, '..', '..');
  const appShellPath = path.join(root, 'frontend', 'js', 'app-shell.js');
  const swPath = path.join(root, 'frontend', 'sw.js');
  const [appShellSource, swSource] = await Promise.all([
    fs.readFile(appShellPath, 'utf8'),
    fs.readFile(swPath, 'utf8')
  ]);

  assert.match(appShellSource, /const\s+APP_RELEASE_ID\s*=\s*'[^']+'/);
  assert.match(appShellSource, /const\s+SERVICE_WORKER_VERSION\s*=\s*'[^']+'/);
  assert.match(appShellSource, /function\s+enforceCurrentRelease\s*\(/);
  assert.match(appShellSource, /updateViaCache:\s*'none'/);
  assert.match(swSource, /const\s+CACHE_VERSION\s*=\s*'socrates-v\d+'/);
  assert.match(swSource, /request\.mode === 'navigate'/);
  assert.match(swSource, /cache:\s*'no-store'/);
});

test('PWA version contract exposes non-empty release metadata', () => {
  const root = path.resolve(__dirname, '..', '..');
  const contract = collectPwaVersionContract(root);

  assert.ok(contract.cacheVersion);
  assert.ok(contract.serviceWorkerVersion);
  assert.ok(contract.appReleaseId);
  assert.ok(contract.expectedVersions.appShell);
  assert.ok(contract.entrypoints.length > 0);
});
