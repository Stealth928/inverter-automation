'use strict';

const RELEASE_MANIFEST_URL_PATH = '/data/release-manifest.json';
const RELEASE_MANIFEST_FILE_PATH = 'frontend/data/release-manifest.json';
const DEFAULT_HOSTING_ORIGINS = [
  'https://inverter-automation-firebase.web.app',
  'https://inverter-automation-firebase.firebaseapp.com'
];

function trimString(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeBranchName(value) {
  const raw = trimString(value);
  if (!raw) return null;
  return raw
    .replace(/^refs\/heads\//i, '')
    .replace(/^origin\//i, '');
}

function normalizeReleaseManifest(manifest = {}) {
  const source = manifest && typeof manifest === 'object' ? manifest : {};
  const git = source.git && typeof source.git === 'object' ? source.git : {};
  const workflow = source.workflow && typeof source.workflow === 'object' ? source.workflow : {};

  const commit = trimString(git.commit);
  const branch = normalizeBranchName(git.branch || git.ref);
  const ref = trimString(git.ref) || (branch ? `refs/heads/${branch}` : null);

  return {
    generatedAt: trimString(source.generatedAt),
    git: {
      commit,
      shortCommit: trimString(git.shortCommit) || (commit ? commit.slice(0, 7) : null),
      branch,
      ref
    },
    workflow: {
      name: trimString(workflow.name),
      runId: trimString(workflow.runId),
      runNumber: trimString(workflow.runNumber),
      actor: trimString(workflow.actor)
    }
  };
}

function buildReleaseManifest(options = {}) {
  const commit = trimString(options.commit) || 'unknown';
  const branch = normalizeBranchName(options.branch || options.ref);
  const ref = trimString(options.ref) || (branch ? `refs/heads/${branch}` : null);

  return normalizeReleaseManifest({
    generatedAt: trimString(options.generatedAt) || new Date().toISOString(),
    git: {
      commit,
      shortCommit: commit === 'unknown' ? null : commit.slice(0, 7),
      branch,
      ref
    },
    workflow: {
      name: trimString(options.workflowName),
      runId: trimString(options.runId),
      runNumber: trimString(options.runNumber),
      actor: trimString(options.actor)
    }
  });
}

function compareReleaseAlignment({ liveManifest, currentCommit, currentBranch } = {}) {
  const normalizedLiveManifest = normalizeReleaseManifest(liveManifest);
  const normalizedCurrentCommit = trimString(currentCommit);
  const normalizedCurrentBranch = normalizeBranchName(currentBranch);
  const reasons = [];

  if (!normalizedLiveManifest.git.commit) {
    reasons.push('Live release manifest is missing git.commit.');
  }
  if (!normalizedCurrentCommit) {
    reasons.push('Current checkout is missing a git commit SHA.');
  }
  if (!reasons.length && normalizedLiveManifest.git.commit !== normalizedCurrentCommit) {
    reasons.push(
      `Live hosting is on commit ${normalizedLiveManifest.git.commit}, but this workflow checkout is ${normalizedCurrentCommit}.`
    );
  }

  return {
    ok: reasons.length === 0,
    reasons,
    liveCommit: normalizedLiveManifest.git.commit,
    liveBranch: normalizedLiveManifest.git.branch,
    currentCommit: normalizedCurrentCommit,
    currentBranch: normalizedCurrentBranch
  };
}

function buildReleaseManifestUrls(origins = DEFAULT_HOSTING_ORIGINS) {
  return Array.from(new Set(
    (Array.isArray(origins) ? origins : [])
      .map((origin) => trimString(origin))
      .filter(Boolean)
      .map((origin) => `${origin.replace(/\/+$/, '')}${RELEASE_MANIFEST_URL_PATH}`)
  ));
}

module.exports = {
  DEFAULT_HOSTING_ORIGINS,
  RELEASE_MANIFEST_FILE_PATH,
  RELEASE_MANIFEST_URL_PATH,
  buildReleaseManifest,
  buildReleaseManifestUrls,
  compareReleaseAlignment,
  normalizeBranchName,
  normalizeReleaseManifest,
  trimString
};
