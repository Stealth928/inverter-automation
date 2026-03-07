#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function printUsage() {
  console.log(`
Usage:
  node scripts/scheduler-soak-evidence-status.js [options]

Options:
  --out-dir <path>     Evidence directory (default: docs/evidence/scheduler-soak)
  --require-ready      Exit non-zero unless latest artifact is readyForCloseout=true
  --json               Print machine-readable JSON summary
  --help               Show help
`.trim());
}

function parseArgs(argv) {
  const options = {
    outDir: path.join('docs', 'evidence', 'scheduler-soak'),
    requireReady: false,
    json: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--require-ready') {
      options.requireReady = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--out-dir') {
      const value = argv[i + 1];
      if (!value) throw new Error('--out-dir requires a value');
      options.outDir = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function listEvidenceJsonFiles(outDir) {
  if (!fs.existsSync(outDir)) {
    return [];
  }
  return fs
    .readdirSync(outDir)
    .filter((name) => /^scheduler-soak-.*\.json$/i.test(name))
    .sort();
}

function loadLatestSnapshot(outDir) {
  const jsonFiles = listEvidenceJsonFiles(outDir);
  if (jsonFiles.length === 0) {
    return {
      exists: false,
      jsonFiles,
      latest: null
    };
  }
  const latestName = jsonFiles[jsonFiles.length - 1];
  const latestPath = path.join(outDir, latestName);
  const raw = fs.readFileSync(latestPath, 'utf8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(raw);
  return {
    exists: true,
    jsonFiles,
    latest: {
      name: latestName,
      path: latestPath,
      data: parsed
    }
  };
}

function buildStatusSummary(snapshotState) {
  if (!snapshotState.exists || !snapshotState.latest) {
    return {
      hasEvidence: false,
      readyForCloseout: false,
      latestArtifact: null,
      capturedAt: null,
      status: 'missing',
      daysWithData: 0,
      healthyDays: 0,
      watchDays: 0,
      breachDays: 0
    };
  }

  const data = snapshotState.latest.data || {};
  const soak = data.soak && typeof data.soak === 'object' ? data.soak : {};
  const readiness = soak.readiness && typeof soak.readiness === 'object' ? soak.readiness : {};

  return {
    hasEvidence: true,
    readyForCloseout: Boolean(readiness.readyForCloseout),
    latestArtifact: snapshotState.latest.name,
    capturedAt: data.capturedAt || null,
    status: String(soak.status || 'unknown'),
    daysWithData: toFiniteNumber(soak.daysWithData, 0),
    healthyDays: toFiniteNumber(soak.healthyDays, 0),
    watchDays: toFiniteNumber(soak.watchDays, 0),
    breachDays: toFiniteNumber(soak.breachDays, 0)
  };
}

function printHumanSummary(summary, outDir) {
  console.log('[SchedulerSoakStatus] Evidence directory:', outDir);
  if (!summary.hasEvidence) {
    console.log('[SchedulerSoakStatus] No evidence artifacts found');
    return;
  }
  console.log('[SchedulerSoakStatus] Latest artifact:', summary.latestArtifact);
  console.log('[SchedulerSoakStatus] Captured at:', summary.capturedAt || '-');
  console.log('[SchedulerSoakStatus] Soak status:', summary.status);
  console.log('[SchedulerSoakStatus] Days with data:', summary.daysWithData);
  console.log(
    `[SchedulerSoakStatus] Healthy/Watch/Breach days: ${summary.healthyDays}/${summary.watchDays}/${summary.breachDays}`
  );
  console.log('[SchedulerSoakStatus] Ready for closeout:', summary.readyForCloseout ? 'YES' : 'NO');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    process.exit(0);
  }

  const outDir = path.resolve(options.outDir);
  const snapshotState = loadLatestSnapshot(outDir);
  const summary = buildStatusSummary(snapshotState);

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printHumanSummary(summary, outDir);
  }

  if (options.requireReady) {
    if (!summary.hasEvidence) {
      console.error('[SchedulerSoakStatus] --require-ready set but no evidence artifacts were found');
      process.exit(2);
    }
    if (!summary.readyForCloseout) {
      console.error('[SchedulerSoakStatus] --require-ready set but readiness is not met');
      process.exit(3);
    }
  }

  process.exit(0);
}

try {
  main();
} catch (error) {
  console.error(`[SchedulerSoakStatus] Failed: ${error.message}`);
  process.exit(1);
}
