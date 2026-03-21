'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const {
  DEFAULT_HOSTING_ORIGINS,
  buildReleaseManifestUrls,
  compareReleaseAlignment,
  normalizeBranchName,
  normalizeReleaseManifest,
  trimString
} = require('./lib/release-manifest');
const {
  collectPwaRuntimeFingerprint,
  collectPwaRuntimeFingerprintFromSources,
  comparePwaRuntimeFingerprints
} = require('./lib/pwa-version-contract');

const ROOT = path.resolve(__dirname, '..');

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

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}

function getHostingOrigins() {
  const configuredOrigins = trimString(process.env.RELEASE_MANIFEST_ORIGINS);
  if (!configuredOrigins) {
    return DEFAULT_HOSTING_ORIGINS.slice();
  }

  return configuredOrigins
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function getManifestUrls() {
  return buildReleaseManifestUrls(getHostingOrigins());
}

async function fetchText(url) {
  const response = await fetch(`${url}?ts=${Date.now()}`, {
    headers: {
      'Cache-Control': 'no-cache'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

async function fetchManifest(url) {
  return JSON.parse(await fetchText(url));
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadLiveManifest(urls, attempts, delayMs) {
  const errors = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    for (const url of urls) {
      try {
        const manifest = await fetchManifest(url);
        return {
          url,
          manifest: normalizeReleaseManifest(manifest),
          attempts: attempt
        };
      } catch (error) {
        errors.push(`${url} -> ${error.message || error}`);
      }
    }

    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }

  const detail = errors.length ? ` Last errors: ${errors.slice(-urls.length).join(' | ')}` : '';
  throw new Error(
    'Unable to fetch a live release manifest from hosting. ' +
    'Run the standard Firebase deploy workflow once from the release branch before using DataWorks hosting deploys.' +
    detail
  );
}

async function loadLivePwaFingerprint(origins, attempts, delayMs) {
  const errors = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    for (const origin of origins) {
      const normalizedOrigin = origin.replace(/\/+$/, '');
      try {
        const swUrl = `${normalizedOrigin}/sw.js`;
        const swSource = await fetchText(swUrl);
        const liveSwFingerprint = collectPwaRuntimeFingerprintFromSources({
          swSource,
          appShellSource: "const SERVICE_WORKER_VERSION = 'bootstrap'; const APP_RELEASE_ID = 'bootstrap';",
          swPath: swUrl,
          appShellPath: 'bootstrap-app-shell.js'
        });
        const appShellUrl = `${normalizedOrigin}/js/app-shell.js?v=${encodeURIComponent(liveSwFingerprint.expectedVersions.appShell)}`;
        const appShellSource = await fetchText(appShellUrl);
        const fingerprint = collectPwaRuntimeFingerprintFromSources({
          swSource,
          appShellSource,
          swPath: swUrl,
          appShellPath: appShellUrl
        });

        return {
          origin: normalizedOrigin,
          fingerprint,
          attempts: attempt
        };
      } catch (error) {
        errors.push(`${normalizedOrigin} -> ${error.message || error}`);
      }
    }

    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }

  const detail = errors.length ? ` Last errors: ${errors.slice(-origins.length).join(' | ')}` : '';
  throw new Error(`Unable to fetch a live PWA shell fingerprint from hosting.${detail}`);
}

async function main() {
  const origins = getHostingOrigins();
  const urls = buildReleaseManifestUrls(origins);
  const attempts = parsePositiveInt(process.env.RELEASE_ALIGNMENT_RETRIES, 1);
  const delayMs = parsePositiveInt(process.env.RELEASE_ALIGNMENT_DELAY_MS, 5000);
  const currentCommit = trimString(process.env.RELEASE_ALIGNMENT_CURRENT_SHA) || runGit(['rev-parse', 'HEAD']);
  const currentBranch = normalizeBranchName(process.env.GITHUB_REF_NAME || runGit(['rev-parse', '--abbrev-ref', 'HEAD']));
  const localFingerprint = collectPwaRuntimeFingerprint(ROOT);
  let liveRelease = null;

  try {
    liveRelease = await loadLiveManifest(urls, attempts, delayMs);
  } catch (manifestError) {
    const livePwa = await loadLivePwaFingerprint(origins, attempts, delayMs);
    const mismatches = comparePwaRuntimeFingerprints(livePwa.fingerprint, localFingerprint);

    if (mismatches.length > 0) {
      const detail = mismatches
        .map((entry) => `${entry.key}: live=${entry.left} current=${entry.right}`)
        .join('; ');
      throw new Error(
        `${manifestError.message} Fallback PWA shell fingerprint mismatch via ${livePwa.origin} on attempt ${livePwa.attempts}. ${detail}`
      );
    }

    process.stdout.write(
      `[ReleaseAlignment] Live release manifest is missing, but the hosted PWA shell fingerprint matches current checkout via ${livePwa.origin}\n`
    );
    return;
  }

  const comparison = compareReleaseAlignment({
    liveManifest: liveRelease.manifest,
    currentCommit,
    currentBranch
  });

  if (!comparison.ok) {
    throw new Error(
      `${comparison.reasons.join(' ')} Fetched ${liveRelease.url} on attempt ${liveRelease.attempts}. ` +
      `Live branch=${comparison.liveBranch || 'unknown'} current branch=${comparison.currentBranch || 'unknown'}. ` +
      'Deploy the current release branch first, or rerun this workflow from the same commit that is already live.'
    );
  }

  process.stdout.write(
    `[ReleaseAlignment] Live hosting matches current checkout ${comparison.currentCommit} (${comparison.currentBranch || 'unknown'}) via ${liveRelease.url}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
