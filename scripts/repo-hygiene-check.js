#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REQUIRED_GITIGNORE_ENTRIES = [
  '*.log',
  '*.pid',
  'tmp*',
  '.firebase_logs.txt',
  'firebase.local.json'
];

const ROOT_MARKDOWN_ALLOWLIST = new Set([
  'README.md'
]);

const FORBIDDEN_TRACKED_FILE_PATTERNS = [
  {
    pattern: /(^|\/)[^/]+\.log$/i,
    reason: 'Tracked log files are not allowed.'
  },
  {
    pattern: /(^|\/)[^/]+\.pid$/i,
    reason: 'Tracked PID/runtime state files are not allowed.'
  },
  {
    pattern: /(^|\/)tmp[^/]*\.txt$/i,
    reason: 'Tracked temporary dump files are not allowed.'
  },
  {
    pattern: /^\.firebase_logs\.txt$/i,
    reason: 'Firebase local log dump must not be tracked.'
  },
  {
    pattern: /^firebase\.local\.json$/i,
    reason: 'Local Firebase override config must not be tracked.'
  }
];

function resolveRepoRoot() {
  let root = process.cwd();
  if (path.basename(root) === 'functions') {
    root = path.dirname(root);
  }
  return root;
}

function getTrackedFiles(repoRoot) {
  const output = execSync('git ls-files', {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((filePath) => fs.existsSync(path.join(repoRoot, filePath)));
}

function checkGitignore(repoRoot, violations) {
  const gitignorePath = path.join(repoRoot, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    violations.push({
      scope: '.gitignore',
      message: '.gitignore is missing.'
    });
    return;
  }

  const gitignore = fs.readFileSync(gitignorePath, 'utf8');
  REQUIRED_GITIGNORE_ENTRIES.forEach((entry) => {
    if (!gitignore.includes(entry)) {
      violations.push({
        scope: '.gitignore',
        message: `Missing required ignore entry: ${entry}`
      });
    }
  });
}

function checkTrackedArtifacts(trackedFiles, violations) {
  trackedFiles.forEach((filePath) => {
    FORBIDDEN_TRACKED_FILE_PATTERNS.forEach(({ pattern, reason }) => {
      if (pattern.test(filePath)) {
        violations.push({
          scope: filePath,
          message: reason
        });
      }
    });
  });
}

function checkRootMarkdownFiles(trackedFiles, violations) {
  trackedFiles
    .filter((filePath) => /^[^/]+\.md$/i.test(filePath))
    .forEach((filePath) => {
      if (!ROOT_MARKDOWN_ALLOWLIST.has(filePath)) {
        violations.push({
          scope: filePath,
          message: 'Root-level markdown should be consolidated under docs/.'
        });
      }
    });
}

function main() {
  const repoRoot = resolveRepoRoot();
  const trackedFiles = getTrackedFiles(repoRoot);
  const violations = [];

  checkGitignore(repoRoot, violations);
  checkTrackedArtifacts(trackedFiles, violations);
  checkRootMarkdownFiles(trackedFiles, violations);

  if (violations.length > 0) {
    console.error('[Hygiene] FAILED');
    violations.forEach((violation, index) => {
      console.error(`  ${index + 1}. ${violation.scope} - ${violation.message}`);
    });
    process.exit(1);
  }

  console.log('[Hygiene] PASS');
}

main();
