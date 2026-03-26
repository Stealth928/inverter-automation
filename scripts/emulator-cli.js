#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { execSync, spawn, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const PID_FILE = path.join(REPO_ROOT, 'emulator.pid');
const LOG_FILE = path.join(REPO_ROOT, 'emulator.log');
const LOG_DIR = path.join(REPO_ROOT, 'logs');
const DEFAULT_PROJECT = 'inverter-automation-firebase';

const REQUIRED_PORTS = [4000, 5000, 5001, 8080, 8085, 9099];
const CLEANUP_PORTS = [4000, 4400, 4500, 5000, 5001, 8080, 8085, 9099, 9150, 9299, 9499];
const EMULATOR_ARGS = [
  'firebase',
  'emulators:start',
  '--only',
  'functions,firestore,hosting,auth,pubsub',
  '--import=./emulator-state',
  '--export-on-exit'
];
const NPM_EXEC_ARGS = ['exec', '--', ...EMULATOR_ARGS];

function log(message) {
  console.log(`[emu] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readPid() {
  try {
    const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writePid(pid) {
  fs.writeFileSync(PID_FILE, `${pid}\n`, 'utf8');
}

function removePidFile() {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // no-op
  }
}

function pidExists(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function normalizePathEntryForComparison(value) {
  if (!value) return '';
  return String(value).trim().replace(/[\\/]+$/, '').toLowerCase();
}

function prependPathEntries(env, entries = []) {
  const separator = process.platform === 'win32' ? ';' : ':';
  const current = String(env.PATH || '');
  const existing = current ? current.split(separator).filter(Boolean) : [];
  const seen = new Set(existing.map(normalizePathEntryForComparison));
  const additions = [];

  for (const entry of entries) {
    if (!entry || !fs.existsSync(entry)) continue;
    const normalized = normalizePathEntryForComparison(entry);
    if (seen.has(normalized)) continue;
    additions.push(entry);
    seen.add(normalized);
  }

  if (additions.length === 0) return;
  env.PATH = `${additions.join(separator)}${current ? `${separator}${current}` : ''}`;
}

function getLatestAdoptiumJavaBin() {
  if (process.platform !== 'win32') return null;
  const root = 'C:\\Program Files\\Eclipse Adoptium';
  if (!fs.existsSync(root)) return null;

  try {
    const candidates = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name, 'bin'))
      .filter((binPath) => fs.existsSync(path.join(binPath, 'java.exe')))
      .sort()
      .reverse();
    return candidates[0] || null;
  } catch {
    return null;
  }
}

function getWindowsRuntimePaths() {
  if (process.platform !== 'win32') return [];
  const runtimePaths = [
    'C:\\Program Files\\nodejs',
    'C:\\Program Files\\Git\\cmd'
  ];

  // Add global npm bin directory
  const npmGlobalPrefix = execSync('npm config get prefix', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
  if (npmGlobalPrefix) {
    runtimePaths.push(npmGlobalPrefix);
  }

  const javaBin = getLatestAdoptiumJavaBin();
  if (javaBin) runtimePaths.push(javaBin);

  return runtimePaths;
}

function buildEmulatorEnv() {
  const env = { ...process.env };

  if (process.platform === 'win32') {
    // Ensure common runtime paths are available first
    prependPathEntries(env, getWindowsRuntimePaths());
    // If JAVA_HOME is set in the environment, ensure its bin directory is on PATH
    try {
      const javaHome = env.JAVA_HOME || process.env.JAVA_HOME;
      if (javaHome) {
        const javaBin = path.join(javaHome.replace(/[\\/]+$/,''), 'bin');
        prependPathEntries(env, [javaBin]);
      }
    } catch (err) {
      // best-effort; continue without failing
    }
    return env;
  }

  const homebrewJavaBin = '/opt/homebrew/opt/openjdk/bin';
  const homebrewJavaHome = '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home';

  if (fs.existsSync(homebrewJavaBin)) {
    env.PATH = env.PATH ? `${homebrewJavaBin}:${env.PATH}` : homebrewJavaBin;
  }
  if (!env.JAVA_HOME && fs.existsSync(homebrewJavaHome)) {
    env.JAVA_HOME = homebrewJavaHome;
  }

  return env;
}

function ensureJava(env) {
  const probe = spawnSync('java', ['-version'], {
    env,
    stdio: 'ignore'
  });

  if (probe.status !== 0) {
    throw new Error(
      'Java runtime not found. Install OpenJDK (or set JAVA_HOME/PATH) before starting Firestore/PubSub emulators.'
    );
  }
}

function getPortPids(port) {
  if (process.platform === 'win32') {
    const netstat = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
    if (netstat.status !== 0 || !netstat.stdout) {
      return [];
    }

    const pids = new Set();
    for (const line of netstat.stdout.split('\n')) {
      if (!line.includes(`:${port}`) || !line.toUpperCase().includes('LISTEN')) {
        continue;
      }
      const parts = line.trim().split(/\s+/);
      const pid = Number.parseInt(parts[parts.length - 1], 10);
      if (Number.isFinite(pid)) {
        pids.add(pid);
      }
    }
    return Array.from(pids);
  }

  try {
    const stdout = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN || true`, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return stdout
      .split('\n')
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isFinite(pid));
  } catch {
    return [];
  }
}

function killPid(pid, signal = 'SIGKILL') {
  if (!pid || pid === process.pid) {
    return;
  }
  try {
    process.kill(pid, signal);
  } catch {
    // best effort
  }
}

async function killPidGracefully(pid) {
  if (!pidExists(pid)) {
    return;
  }

  killPid(pid, 'SIGTERM');
  for (let i = 0; i < 20; i += 1) {
    if (!pidExists(pid)) {
      return;
    }
    await sleep(250);
  }

  killPid(pid, 'SIGKILL');
}

function dedupe(numbers) {
  return Array.from(new Set(numbers.filter((n) => Number.isFinite(n))));
}

function killPorts(ports) {
  const allPids = [];
  for (const port of ports) {
    allPids.push(...getPortPids(port));
  }

  for (const pid of dedupe(allPids)) {
    killPid(pid, 'SIGKILL');
  }

  return dedupe(allPids).length;
}

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const settle = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(400);
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
    socket.connect(port, '127.0.0.1');
  });
}

async function waitForPorts(ports, timeoutMs, pid) {
  const pending = new Set(ports);
  const deadline = Date.now() + timeoutMs;

  while (pending.size > 0) {
    for (const port of Array.from(pending)) {
      // eslint-disable-next-line no-await-in-loop
      const up = await checkPort(port);
      if (up) {
        pending.delete(port);
      }
    }

    if (pending.size === 0) {
      return;
    }

    if (pid && !pidExists(pid)) {
      throw new Error(`Emulator parent process exited before ports were ready: ${Array.from(pending).join(', ')}`);
    }

    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ports: ${Array.from(pending).join(', ')}`);
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(500);
  }
}

function tailLogLines(lineCount = 120) {
  try {
    const raw = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = raw.split('\n');
    return lines.slice(Math.max(lines.length - lineCount, 0)).join('\n');
  } catch {
    return '(no emulator.log available)';
  }
}

function runNodeScript(scriptPath, env, label) {
  const result = spawnSync('node', [scriptPath], {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
}

function getEmulatorSpawnCandidates() {
  if (process.platform === 'win32') {
    // With shell: true, pass command as a single string
    const firebaseCommandStr = `firebase ${EMULATOR_ARGS.slice(1).join(' ')}`;
    const npxCommandStr = `npx ${EMULATOR_ARGS.join(' ')}`;
    return [
      { command: firebaseCommandStr, args: [], label: 'firebase direct (via shell)' },
      { command: npxCommandStr, args: [], label: 'npx (via shell)' }
    ];
  }

  return [
    { command: 'npx', args: EMULATOR_ARGS, label: 'npx' },
    { command: 'npm', args: NPM_EXEC_ARGS, label: 'npm exec --' }
  ];
}

function spawnDetached(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);

    const onError = (error) => {
      child.removeListener('spawn', onSpawn);
      reject(error);
    };
    const onSpawn = () => {
      child.removeListener('error', onError);
      resolve(child);
    };

    child.once('error', onError);
    child.once('spawn', onSpawn);
  });
}

async function spawnEmulatorProcess(env, logFd) {
  const spawnOptions = {
    cwd: REPO_ROOT,
    env,
    detached: true,
    shell: true,
    stdio: ['ignore', logFd, logFd]
  };

  const candidates = getEmulatorSpawnCandidates();
  const failures = [];

  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const child = await spawnDetached(candidate.command, candidate.args, spawnOptions);
      log(`Spawned emulator parent via ${candidate.label}`);
      return child;
    } catch (error) {
      failures.push(`${candidate.label}: ${error && error.code ? error.code : error && error.message ? error.message : 'unknown error'}`);
    }
  }

  throw new Error(`Failed to spawn emulator process (${failures.join('; ')})`);
}

async function verifySetupStatus() {
  const maxAttempts = 120; // ~60s total
  const retryDelayMs = 500;

  let lastStatus = null;
  let lastError = null;

  for (let i = 0; i < maxAttempts; i += 1) {
    if (i === 0) {
      log('Waiting for /api/config/setup-status to become healthy...');
    } else if (i % 10 === 0) {
      log(`Still waiting for setup-status (attempt ${i + 1}/${maxAttempts})...`);
    }

    const ok = await new Promise((resolve) => {
      const req = http.get('http://127.0.0.1:5000/api/config/setup-status', (res) => {
        lastStatus = res.statusCode;
        const success = res.statusCode && res.statusCode >= 200 && res.statusCode < 300;
        res.resume();
        resolve(Boolean(success));
      });
      req.on('error', (err) => {
        lastError = err && err.message ? err.message : err;
        resolve(false);
      });
      req.setTimeout(1200, () => {
        lastError = 'timeout';
        req.destroy();
        resolve(false);
      });
    });

    if (ok) {
      return true;
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(retryDelayMs);
  }

  log(`setup-status did not become healthy (last http status=${lastStatus ?? 'unknown'} last error=${lastError ?? 'none'})`);
  return false;
}

async function startEmulators() {
  const env = buildEmulatorEnv();
  ensureJava(env);

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logFd = fs.openSync(LOG_FILE, 'a');
  let child;
  try {
    child = await spawnEmulatorProcess(env, logFd);
  } finally {
    fs.closeSync(logFd);
  }

  child.unref();
  writePid(child.pid);

  log(`Started emulators (pid ${child.pid})`);
  await waitForPorts(REQUIRED_PORTS, 120000, child.pid);
  log(`Ready ports: ${REQUIRED_PORTS.join(', ')}`);

  return child.pid;
}

async function stopEmulators() {
  const pid = readPid();
  if (pid) {
    await killPidGracefully(pid);
  }
  removePidFile();

  const killedCount = killPorts(CLEANUP_PORTS);
  log(`Stopped emulators and cleaned ${killedCount} listener process(es).`);
}

async function seedEmulators({ requireSetupStatus = false } = {}) {
  const env = {
    ...buildEmulatorEnv(),
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    GCLOUD_PROJECT: process.env.GCLOUD_PROJECT || DEFAULT_PROJECT
  };

  runNodeScript(path.join('functions', 'scripts', 'clear-firestore.js'), env, 'clear-firestore');
  runNodeScript(path.join('functions', 'scripts', 'seed-emulator-state.js'), env, 'seed-emulator-state');

  if (!requireSetupStatus) {
    log('Seed completed.');
    return;
  }

  const setupOk = await verifySetupStatus();
  if (!setupOk) {
    const message = 'setup-status endpoint did not become healthy after seed';
    throw new Error(message);
  }

  log('Seed completed and setup-status is healthy.');
}

async function printStatus() {
  const rows = [];
  for (const port of REQUIRED_PORTS) {
    // eslint-disable-next-line no-await-in-loop
    const up = await checkPort(port);
    rows.push({ port, state: up ? 'LISTENING' : 'FREE' });
  }
  const pid = readPid();
  log(`PID file: ${pid || 'none'}`);
  for (const row of rows) {
    log(`Port ${row.port}: ${row.state}`);
  }
}

async function main() {
  const command = (process.argv[2] || 'reset').toLowerCase();

  try {
    if (command === 'start') {
      await startEmulators();
      await seedEmulators({ requireSetupStatus: false });
      return;
    }

    if (command === 'stop') {
      await stopEmulators();
      return;
    }

    if (command === 'seed') {
      await seedEmulators();
      return;
    }

    if (command === 'status') {
      await printStatus();
      return;
    }

    if (command === 'reset') {
      const startTs = Date.now();
      await stopEmulators();
      await startEmulators();
      await seedEmulators({ requireSetupStatus: false });
      const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
      log(`Reset + reseed complete in ${elapsed}s.`);
      return;
    }

    throw new Error(`Unknown command "${command}". Use: start | stop | seed | status | reset`);
  } catch (error) {
    console.error(`[emu] ERROR: ${error.message}`);
    console.error('[emu] Recent emulator log tail:');
    console.error(tailLogLines(120));
    process.exit(1);
  }
}

main();
