#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  evaluateDocsImpact,
  parseDocsOverrideFromText,
  uniqueNormalizedPaths
} = require('./lib/docs-impact');

function resolveRepoRoot() {
  let root = process.cwd();
  if (path.basename(root) === 'functions') {
    root = path.dirname(root);
  }
  return root;
}

function runGit(repoRoot, args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
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

function parseArgs(argv) {
  const options = {
    files: [],
    allowNoDocs: null,
    base: null,
    head: 'HEAD',
    silent: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--files') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--files requires a comma-separated value.');
      }
      options.files.push(
        ...value
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
      );
      index += 1;
      continue;
    }

    if (arg === '--allow-no-docs') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--allow-no-docs requires a reason.');
      }
      options.allowNoDocs = value.trim();
      index += 1;
      continue;
    }

    if (arg === '--base') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--base requires a git ref.');
      }
      options.base = value.trim();
      index += 1;
      continue;
    }

    if (arg === '--head') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--head requires a git ref.');
      }
      options.head = value.trim();
      index += 1;
      continue;
    }

    if (arg === '--silent') {
      options.silent = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function listFilesFromDiff(repoRoot, diffArgs) {
  const output = runGit(repoRoot, ['diff', '--name-only', '--diff-filter=ACMRTUXB', ...diffArgs]);
  return uniqueNormalizedPaths(output.split(/\r?\n/));
}

function listFilesFromWorkingTree(repoRoot) {
  const output = runGit(repoRoot, ['status', '--porcelain']);
  return uniqueNormalizedPaths(
    output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .map((entry) => {
        const renameParts = entry.split(' -> ');
        return renameParts[renameParts.length - 1];
      })
  );
}

function resolvePullRequestBaseRef(repoRoot) {
  const baseRef = String(process.env.GITHUB_BASE_REF || '').trim();
  if (!baseRef) {
    return null;
  }

  const candidates = [`origin/${baseRef}`, baseRef];
  for (const candidate of candidates) {
    try {
      runGit(repoRoot, ['rev-parse', '--verify', candidate]);
      return candidate;
    } catch (error) {
      continue;
    }
  }

  return null;
}

function collectChangedFiles(repoRoot, options) {
  if (options.files.length > 0) {
    return uniqueNormalizedPaths(options.files);
  }

  if (options.base) {
    return listFilesFromDiff(repoRoot, [`${options.base}...${options.head}`]);
  }

  const eventName = String(process.env.GITHUB_EVENT_NAME || '').trim();
  if (eventName === 'pull_request') {
    const baseRef = resolvePullRequestBaseRef(repoRoot);
    if (!baseRef) {
      throw new Error('Unable to resolve pull request base ref. Ensure checkout fetch-depth includes the base branch.');
    }
    return listFilesFromDiff(repoRoot, [`${baseRef}...${options.head}`]);
  }

  const beforeSha = String(process.env.GITHUB_EVENT_BEFORE || '').trim();
  const currentSha = String(process.env.GITHUB_SHA || '').trim();
  if (eventName === 'push' && beforeSha && currentSha && !/^0+$/.test(beforeSha)) {
    return listFilesFromDiff(repoRoot, [`${beforeSha}..${currentSha}`]);
  }

  return listFilesFromWorkingTree(repoRoot);
}

function readGitHubPullRequestOverride() {
  const eventPath = String(process.env.GITHUB_EVENT_PATH || '').trim();
  if (!eventPath || !fs.existsSync(eventPath)) {
    return null;
  }

  try {
    const payload = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    const body = payload && payload.pull_request ? payload.pull_request.body : null;
    return parseDocsOverrideFromText(body);
  } catch (error) {
    return null;
  }
}

function resolveOverrideReason(options) {
  if (options.allowNoDocs) {
    return options.allowNoDocs;
  }

  const envOverride = String(process.env.DOCS_IMPACT_OVERRIDE || '').trim();
  if (envOverride) {
    return envOverride;
  }

  if (String(process.env.GITHUB_EVENT_NAME || '').trim() === 'pull_request') {
    return readGitHubPullRequestOverride();
  }

  return null;
}

function main() {
  const repoRoot = resolveRepoRoot();
  const options = parseArgs(process.argv.slice(2));
  const changedFiles = collectChangedFiles(repoRoot, options);
  const evaluation = evaluateDocsImpact({
    changedFiles,
    overrideReason: resolveOverrideReason(options)
  });

  if (!options.silent) {
    console.log(`[DocsImpact] Changed files analyzed: ${evaluation.changedFiles.length}`);
  }

  if (evaluation.impactedRules.length === 0) {
    if (!options.silent) {
      console.log('[DocsImpact] PASS - No mapped product or operational doc impacts detected.');
    }
    process.exit(0);
  }

  const missingRules = evaluation.missingRules.map((rule) => ({
    ...rule,
    requiredDocsText: rule.docs.join(', '),
    triggeredText: rule.triggeredFiles.join(', ')
  }));

  if (missingRules.length === 0) {
    if (!options.silent) {
      console.log('[DocsImpact] PASS - Matching canonical docs changed with impacted code.');
      evaluation.impactedRules.forEach((rule) => {
        console.log(`  * ${rule.id}: ${rule.matchedDocs.join(', ')}`);
      });
    }
    process.exit(0);
  }

  if (evaluation.overrideReason) {
    if (!options.silent) {
      console.log('[DocsImpact] PASS - No-doc-impact override supplied for missing mapped docs.');
      console.log(`[DocsImpact] Override reason: ${evaluation.overrideReason}`);
      missingRules.forEach((rule) => {
        console.log(`  * ${rule.id}: ${rule.triggeredText}`);
      });
    }
    process.exit(0);
  }

  console.error('[DocsImpact] FAIL - Code changes hit mapped areas without a canonical doc update.');
  missingRules.forEach((rule, index) => {
    console.error(`  ${index + 1}. ${rule.id} - ${rule.description}`);
    console.error(`     Triggered by: ${rule.triggeredText}`);
    console.error(`     Update one of: ${rule.requiredDocsText}`);
  });
  console.error('[DocsImpact] Either update the mapped docs or rerun with --allow-no-docs "<reason>" for a verified internal-only change.');
  process.exit(1);
}

main();
