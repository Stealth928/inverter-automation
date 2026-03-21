const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildReleaseManifest,
  buildReleaseManifestUrls,
  compareReleaseAlignment,
  normalizeReleaseManifest
} = require('../../scripts/lib/release-manifest');

test('buildReleaseManifest normalizes git ref metadata', () => {
  const manifest = buildReleaseManifest({
    commit: '1234567890abcdef1234567890abcdef12345678',
    branch: 'refs/heads/release/prod',
    workflowName: 'Deploy to Firebase',
    runId: '77'
  });

  assert.equal(manifest.git.commit, '1234567890abcdef1234567890abcdef12345678');
  assert.equal(manifest.git.shortCommit, '1234567');
  assert.equal(manifest.git.branch, 'release/prod');
  assert.equal(manifest.git.ref, 'refs/heads/release/prod');
  assert.equal(manifest.workflow.name, 'Deploy to Firebase');
  assert.equal(manifest.workflow.runId, '77');
});

test('compareReleaseAlignment passes when live and current commits match', () => {
  const result = compareReleaseAlignment({
    liveManifest: normalizeReleaseManifest({
      git: {
        commit: 'abcdef1234567890abcdef1234567890abcdef12',
        branch: 'feature/live-hotfix'
      }
    }),
    currentCommit: 'abcdef1234567890abcdef1234567890abcdef12',
    currentBranch: 'feature/live-hotfix'
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.reasons, []);
});

test('compareReleaseAlignment fails closed on commit mismatch', () => {
  const result = compareReleaseAlignment({
    liveManifest: {
      git: {
        commit: 'abcdef1234567890abcdef1234567890abcdef12',
        branch: 'feature/live-hotfix'
      }
    },
    currentCommit: 'fedcba1234567890abcdef1234567890abcdef12',
    currentBranch: 'main'
  });

  assert.equal(result.ok, false);
  assert.match(result.reasons[0], /Live hosting is on commit/);
  assert.equal(result.liveBranch, 'feature/live-hotfix');
  assert.equal(result.currentBranch, 'main');
});

test('buildReleaseManifestUrls deduplicates configured hosting origins', () => {
  const urls = buildReleaseManifestUrls([
    'https://inverter-automation-firebase.web.app/',
    'https://inverter-automation-firebase.web.app',
    'https://inverter-automation-firebase.firebaseapp.com'
  ]);

  assert.deepEqual(urls, [
    'https://inverter-automation-firebase.web.app/data/release-manifest.json',
    'https://inverter-automation-firebase.firebaseapp.com/data/release-manifest.json'
  ]);
});
