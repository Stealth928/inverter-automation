'use strict';

const fs = require('fs');
const path = require('path');

const ASSET_VERSION_PATTERNS = {
  apiClient: {
    assetName: 'api-client.js',
    regex: /api-client\.js\?v=(\d+)/
  },
  sharedUtils: {
    assetName: 'shared-utils.js',
    regex: /shared-utils\.js\?v=(\d+)/
  },
  appShell: {
    assetName: 'app-shell.js',
    regex: /app-shell\.js\?v=(\d+)/
  },
  tour: {
    assetName: 'tour.js',
    regex: /tour\.js\?v=(\d+)/
  },
  admin: {
    assetName: 'admin.js',
    regex: /admin\.js\?v=(\d+)/
  }
};

function readRequiredFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function extractConstantValue(source, constantName, filePath) {
  const match = source.match(new RegExp(`const\\s+${constantName}\\s*=\\s*['"]([^'"]+)['"]`));
  if (!match) {
    throw new Error(`Unable to find ${constantName} in ${filePath}`);
  }
  return match[1];
}

function collectPwaVersionContract(repoRoot) {
  const frontendDir = path.join(repoRoot, 'frontend');
  const swPath = path.join(frontendDir, 'sw.js');
  const appShellPath = path.join(frontendDir, 'js', 'app-shell.js');
  const swSource = readRequiredFile(swPath);
  const appShellSource = readRequiredFile(appShellPath);
  const htmlFiles = fs.readdirSync(frontendDir)
    .filter((name) => name.toLowerCase().endsWith('.html'))
    .sort();

  const entrypoints = htmlFiles.map((fileName) => {
    const filePath = path.join(frontendDir, fileName);
    const source = readRequiredFile(filePath);
    const versions = {};

    Object.entries(ASSET_VERSION_PATTERNS).forEach(([key, { regex }]) => {
      const match = source.match(regex);
      if (match) {
        versions[key] = match[1];
      }
    });

    return {
      fileName,
      filePath,
      versions
    };
  }).filter((entry) => Object.keys(entry.versions).length > 0);

  return {
    expectedVersions: {
      apiClient: extractConstantValue(swSource, 'API_CLIENT_VERSION', swPath),
      sharedUtils: extractConstantValue(swSource, 'SHARED_UTILS_VERSION', swPath),
      appShell: extractConstantValue(swSource, 'APP_SHELL_VERSION', swPath),
      tour: extractConstantValue(swSource, 'TOUR_VERSION', swPath),
      admin: extractConstantValue(swSource, 'ADMIN_VERSION', swPath)
    },
    cacheVersion: extractConstantValue(swSource, 'CACHE_VERSION', swPath),
    serviceWorkerVersion: extractConstantValue(appShellSource, 'SERVICE_WORKER_VERSION', appShellPath),
    appReleaseId: extractConstantValue(appShellSource, 'APP_RELEASE_ID', appShellPath),
    entrypoints
  };
}

function getPwaVersionViolations(repoRoot) {
  let contract;
  try {
    contract = collectPwaVersionContract(repoRoot);
  } catch (error) {
    return [{
      scope: 'pwa-version-contract',
      message: error.message
    }];
  }

  const violations = [];
  contract.entrypoints.forEach((entry) => {
    Object.entries(entry.versions).forEach(([key, actualVersion]) => {
      const expectedVersion = contract.expectedVersions[key];
      if (!expectedVersion) {
        violations.push({
          scope: path.relative(repoRoot, entry.filePath),
          message: `Unexpected tracked PWA asset key: ${key}`
        });
        return;
      }

      if (actualVersion !== expectedVersion) {
        violations.push({
          scope: path.relative(repoRoot, entry.filePath),
          message: `${ASSET_VERSION_PATTERNS[key].assetName} version ${actualVersion} does not match service worker version ${expectedVersion}`
        });
      }
    });
  });

  return violations;
}

module.exports = {
  collectPwaVersionContract,
  getPwaVersionViolations
};
