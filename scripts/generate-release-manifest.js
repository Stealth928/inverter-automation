'use strict';

const fs = require('fs/promises');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  RELEASE_MANIFEST_FILE_PATH,
  buildReleaseManifest,
  normalizeBranchName
} = require('./lib/release-manifest');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, RELEASE_MANIFEST_FILE_PATH.replace(/\//g, path.sep));

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim();
    throw new Error(stderr || `git ${args.join(' ')} exited with code ${result.status}`);
  }

  return String(result.stdout || '').trim();
}

function resolveGitContext() {
  const commit = runGit(['rev-parse', 'HEAD']);
  const rawBranch = process.env.GITHUB_REF_NAME || runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = normalizeBranchName(rawBranch);
  const ref = process.env.GITHUB_REF || (branch ? `refs/heads/${branch}` : null);

  return {
    commit,
    branch,
    ref
  };
}

async function main() {
  const gitContext = resolveGitContext();
  const manifest = buildReleaseManifest({
    commit: gitContext.commit,
    branch: gitContext.branch,
    ref: gitContext.ref,
    workflowName: process.env.GITHUB_WORKFLOW,
    runId: process.env.GITHUB_RUN_ID,
    runNumber: process.env.GITHUB_RUN_NUMBER,
    actor: process.env.GITHUB_ACTOR
  });

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  process.stdout.write(`[ReleaseManifest] Wrote ${OUTPUT_PATH} for commit ${manifest.git.commit}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
