'use strict';

const fs = require('fs');
const path = require('path');

// Shared constants/helpers for local emulator test-user workflows.

const TEST_PASSWORD = '123456';
const OPTIONAL_LIVE_FOXESS_SEED_PATH = process.env.EMULATOR_LIVE_USER_CONFIG_PATH
  ? path.resolve(process.env.EMULATOR_LIVE_USER_CONFIG_PATH)
  : path.join(__dirname, 'emulator-live-user.local.json');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  Object.keys(value).forEach((key) => {
    deepFreeze(value[key]);
  });
  return value;
}

function trimString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function inferWeatherPlace(location) {
  const normalized = trimString(location);
  if (!normalized) return 'Sydney';
  const firstSegment = normalized.split(',')[0];
  return trimString(firstSegment) || 'Sydney';
}

function buildOptionalLiveFoxessSeedUid(email, role = 'user') {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (normalizedEmail === 'live.test@gmail.com') return 'seed-live-foxess';
  if (normalizedEmail === 'live.test.admin@gmail.com') return 'seed-live-foxess-admin';

  const slug = normalizedEmail.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const fallback = role === 'admin' ? 'foxess-admin' : 'foxess';
  return `seed-live-${slug || fallback}`;
}

function buildOptionalLiveFoxessSeedUser(seed = {}, sharedDefaults = {}) {
  const source = {
    ...(sharedDefaults && typeof sharedDefaults === 'object' ? sharedDefaults : {}),
    ...(seed && typeof seed === 'object' ? seed : {})
  };

  if (!source || typeof source !== 'object') {
    return null;
  }

  const email = trimString(source.email);
  const deviceSn = trimString(source.deviceSn || source.deviceSN);
  const foxessToken = trimString(source.foxessToken);
  const amberApiKey = trimString(source.amberApiKey);

  const hasAnyConfiguredValue = Boolean(email || deviceSn || foxessToken || amberApiKey);
  if (!hasAnyConfiguredValue) {
    return null;
  }

  const requiredFields = {
    email,
    deviceSn,
    foxessToken,
    amberApiKey
  };

  Object.entries(requiredFields).forEach(([field, value]) => {
    if (!value) {
      throw new Error(`Optional live FoxESS seed missing "${field}" in ${OPTIONAL_LIVE_FOXESS_SEED_PATH}`);
    }
  });

  const role = trimString(source.role) === 'admin' ? 'admin' : 'user';
  const amberSiteId = trimString(source.amberSiteId);
  const location = trimString(source.location) || 'Sydney, Australia';
  const weatherPlace = trimString(source.weatherPlace) || inferWeatherPlace(location);
  const timezone = trimString(source.timezone) || 'Australia/Sydney';
  const inverterCapacityW = Number.isFinite(Number(source.inverterCapacityW))
    ? Math.round(Number(source.inverterCapacityW))
    : 10000;
  const batteryCapacityKWh = Number.isFinite(Number(source.batteryCapacityKWh))
    ? Number(source.batteryCapacityKWh)
    : 41.93;

  return deepFreeze({
    uid: trimString(source.uid) || buildOptionalLiveFoxessSeedUid(email, role),
    email,
    password: trimString(source.password) || TEST_PASSWORD,
    displayName: trimString(source.displayName) || (role === 'admin' ? 'Live Test FoxESS Admin' : 'Live Test FoxESS'),
    role,
    provider: 'foxess',
    seedOptions: {
      skipRuntimeCache: true
    },
    config: {
      deviceProvider: 'foxess',
      deviceSn,
      foxessToken,
      amberApiKey,
      ...(amberSiteId ? { amberSiteId, siteIdOrRegion: amberSiteId } : {}),
      cache: { amber: 3600000 }, // 1 hour TTL for seeded data
      weatherPlace,
      location,
      timezone,
      inverterCapacityW,
      batteryCapacityKWh,
      systemTopology: { coupling: 'dc', source: 'seed-live' },
      setupComplete: true,
      tourComplete: true
    },
    rule: {
      id: 'seed_rule_live_foxess',
      name: 'Live FoxESS High Feed-in',
      enabled: true,
      priority: 1,
      cooldownMinutes: 5,
      conditions: { feedInPrice: { enabled: true, operator: '>', value: 25 } },
      action: {
        workMode: 'ForceDischarge',
        durationMinutes: 30,
        fdPwr: 5000,
        fdSoc: 20,
        minSocOnGrid: 20,
        maxSoc: 100
      }
    },
    metrics: {
      today: { foxess: 177, amber: 346, weather: 45 },
      yesterday: { foxess: 96, amber: 205, weather: 28 }
    },
    secrets: {}
  });
}

function buildOptionalLiveFoxessSeedUsers(seedConfig = {}) {
  if (!seedConfig || typeof seedConfig !== 'object') {
    return [];
  }

  const declaredUsers = Array.isArray(seedConfig.users) ? seedConfig.users : [seedConfig];
  const sharedDefaults = Array.isArray(seedConfig.users)
    ? Object.fromEntries(Object.entries(seedConfig).filter(([key]) => key !== 'users'))
    : {};
  const users = declaredUsers
    .map((entry) => buildOptionalLiveFoxessSeedUser(entry, sharedDefaults))
    .filter(Boolean);

  const seenUids = new Set();
  const seenEmails = new Set();
  users.forEach((user) => {
    if (seenUids.has(user.uid)) {
      throw new Error(`Optional live FoxESS seed has duplicate uid "${user.uid}" in ${OPTIONAL_LIVE_FOXESS_SEED_PATH}`);
    }
    if (seenEmails.has(user.email)) {
      throw new Error(`Optional live FoxESS seed has duplicate email "${user.email}" in ${OPTIONAL_LIVE_FOXESS_SEED_PATH}`);
    }
    seenUids.add(user.uid);
    seenEmails.add(user.email);
  });

  return users;
}

function loadOptionalLiveFoxessSeedUsers() {
  if (!fs.existsSync(OPTIONAL_LIVE_FOXESS_SEED_PATH)) {
    return [];
  }

  const raw = fs.readFileSync(OPTIONAL_LIVE_FOXESS_SEED_PATH, 'utf8').trim();
  if (!raw) {
    throw new Error(`Optional live FoxESS seed file is empty: ${OPTIONAL_LIVE_FOXESS_SEED_PATH}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Optional live FoxESS seed file is not valid JSON: ${OPTIONAL_LIVE_FOXESS_SEED_PATH} (${error.message})`
    );
  }

  return buildOptionalLiveFoxessSeedUsers(parsed);
}

function loadOptionalLiveFoxessSeedUser() {
  const users = loadOptionalLiveFoxessSeedUsers();
  return users[0] || null;
}

const BASE_TEST_USERS = Object.freeze([
  deepFreeze({
    uid: 'seed-admin-foxess',
    email: 'seed.foxess.admin@example.com',
    password: TEST_PASSWORD,
    displayName: 'Seed Admin FoxESS',
    role: 'admin',
    provider: 'foxess',
    config: {
      deviceProvider: 'foxess',
      deviceSn: 'FOX-SEED-1001',
      foxessToken: 'FOX_SEED_TOKEN_1001',
      amberApiKey: 'AMBER_SEED_FOXESS',
      amberSiteId: 'seed-site-foxess',
      cache: { amber: 3600000 }, // 1 hour TTL for seeded data
      weatherPlace: 'Adelaide',
      location: 'Adelaide, Australia',
      timezone: 'Australia/Adelaide',
      inverterCapacityW: 5000,
      batteryCapacityKWh: 13.5,
      systemTopology: { coupling: 'dc', source: 'seed' },
      setupComplete: true,
      tourComplete: true
    },
    rule: {
      id: 'seed_rule_foxess',
      name: 'Seed FoxESS High Feed-in',
      enabled: true,
      priority: 1,
      cooldownMinutes: 5,
      conditions: { feedInPrice: { enabled: true, operator: '>', value: 25 } },
      action: {
        workMode: 'ForceDischarge',
        durationMinutes: 30,
        fdPwr: 5000,
        fdSoc: 20,
        minSocOnGrid: 20,
        maxSoc: 100
      }
    },
    metrics: {
      today: { foxess: 177, amber: 346, weather: 45 },
      yesterday: { foxess: 96, amber: 205, weather: 28 }
    },
    secrets: {}
  }),
  deepFreeze({
    uid: 'seed-admin-sungrow',
    email: 'seed.sungrow.admin@example.com',
    password: TEST_PASSWORD,
    displayName: 'Seed Admin Sungrow',
    role: 'admin',
    provider: 'sungrow',
    config: {
      deviceProvider: 'sungrow',
      deviceSn: 'SG-SEED-2001',
      sungrowDeviceSn: 'SG-SEED-2001',
      sungrowUsername: 'seed.sungrow.user@example.com',
      amberApiKey: 'AMBER_SEED_SUNGROW',
      amberSiteId: 'seed-site-sungrow',
      cache: { amber: 3600000 }, // 1 hour TTL for seeded data
      weatherPlace: 'Melbourne',
      location: 'Melbourne, Australia',
      timezone: 'Australia/Melbourne',
      inverterCapacityW: 8000,
      batteryCapacityKWh: 19.2,
      systemTopology: { coupling: 'ac', source: 'seed' },
      setupComplete: true,
      tourComplete: true
    },
    rule: {
      id: 'seed_rule_sungrow',
      name: 'Seed Sungrow Price Charge',
      enabled: true,
      priority: 2,
      cooldownMinutes: 10,
      conditions: { buyPrice: { enabled: true, operator: '<', value: 8 } },
      action: {
        workMode: 'ForceCharge',
        durationMinutes: 45,
        minSocOnGrid: 30,
        maxSoc: 95
      }
    },
    metrics: {
      today: { sungrow: 143, amber: 221, weather: 34 },
      yesterday: { sungrow: 82, amber: 167, weather: 26 }
    },
    secrets: {
      sungrowPassword: TEST_PASSWORD
    }
  }),
  deepFreeze({
    uid: 'seed-admin-sigenergy',
    email: 'seed.sigenergy.admin@example.com',
    password: TEST_PASSWORD,
    displayName: 'Seed Admin SigenEnergy',
    role: 'user',
    provider: 'sigenergy',
    config: {
      deviceProvider: 'sigenergy',
      deviceSn: 'SIG-SEED-3001',
      sigenDeviceSn: 'SIG-SEED-3001',
      sigenStationId: 'SIG-STATION-3001',
      sigenUsername: 'seed.sigenergy.user@example.com',
      sigenRegion: 'apac',
      amberApiKey: 'AMBER_SEED_SIGENERGY',
      amberSiteId: 'seed-site-sigenergy',
      cache: { amber: 3600000 }, // 1 hour TTL for seeded data
      weatherPlace: 'Brisbane',
      location: 'Brisbane, Australia',
      timezone: 'Australia/Brisbane',
      inverterCapacityW: 10000,
      batteryCapacityKWh: 20,
      systemTopology: { coupling: 'dc', source: 'seed' },
      setupComplete: true,
      tourComplete: true
    },
    rule: {
      id: 'seed_rule_sigenergy',
      name: 'Seed SigenEnergy Backup',
      enabled: true,
      priority: 2,
      cooldownMinutes: 15,
      conditions: { soc: { enabled: true, operator: '<', value: 30 } },
      action: {
        workMode: 'Backup',
        durationMinutes: 60
      }
    },
    metrics: {
      today: { sigenergy: 118, amber: 189, weather: 30 },
      yesterday: { sigenergy: 67, amber: 122, weather: 21 }
    },
    secrets: {
      sigenPassword: TEST_PASSWORD
    }
  }),
  deepFreeze({
    uid: 'seed-admin-alphaess',
    email: 'seed.alphaess.admin@example.com',
    password: TEST_PASSWORD,
    displayName: 'Seed Admin AlphaESS',
    role: 'admin',
    provider: 'alphaess',
    config: {
      deviceProvider: 'alphaess',
      deviceSn: 'ALPHA-SEED-4001',
      alphaessSystemSn: 'ALPHA-SEED-4001',
      alphaessAppId: 'ALPHA_SEED_APP_ID',
      alphaessAppSecret: 'ALPHA_SEED_APP_SECRET',
      amberApiKey: 'AMBER_SEED_ALPHAESS',
      amberSiteId: 'seed-site-alphaess',
      cache: { amber: 3600000 }, // 1 hour TTL for seeded data
      weatherPlace: 'Perth',
      location: 'Perth, Australia',
      timezone: 'Australia/Perth',
      inverterCapacityW: 6000,
      batteryCapacityKWh: 14.4,
      systemTopology: { coupling: 'ac', source: 'seed' },
      setupComplete: true,
      tourComplete: true
    },
    rule: {
      id: 'seed_rule_alphaess',
      name: 'Seed AlphaESS Backup',
      enabled: true,
      priority: 3,
      cooldownMinutes: 20,
      conditions: { batteryTemp: { enabled: true, operator: '>', value: 35 } },
      action: {
        workMode: 'Backup',
        durationMinutes: 30
      }
    },
    metrics: {
      today: { alphaess: 101, amber: 174, weather: 27 },
      yesterday: { alphaess: 59, amber: 131, weather: 19 }
    },
    secrets: {
      alphaessAppSecret: 'ALPHA_SEED_APP_SECRET'
    }
  })
]);

const optionalLiveFoxessSeedUsers = loadOptionalLiveFoxessSeedUsers();
const TEST_USERS = Object.freeze(
  optionalLiveFoxessSeedUsers.length > 0
    ? [...BASE_TEST_USERS, ...optionalLiveFoxessSeedUsers]
    : [...BASE_TEST_USERS]
);

// Backward-compatible aliases for scripts expecting a single test user/config.
const TEST_USER = TEST_USERS[0];
const TEST_CONFIG = TEST_USER.config;

const LEGACY_TEST_USERS = Object.freeze([
  deepFreeze({ uid: 'emulator-test-user', email: 'test@gmail.com' })
]);

function getProjectId() {
  return process.env.GCLOUD_PROJECT || process.env.GCLOUD_PROJECT_ID || 'inverter-automation-firebase';
}

function assertEmulatorEnvironment() {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error(
      'Refusing to run without emulator env vars. Set FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST first.'
    );
  }
}

module.exports = {
  TEST_PASSWORD,
  TEST_USERS,
  TEST_USER,
  TEST_CONFIG,
  LEGACY_TEST_USERS,
  OPTIONAL_LIVE_FOXESS_SEED_PATH,
  buildOptionalLiveFoxessSeedUid,
  buildOptionalLiveFoxessSeedUser,
  buildOptionalLiveFoxessSeedUsers,
  loadOptionalLiveFoxessSeedUsers,
  loadOptionalLiveFoxessSeedUser,
  getProjectId,
  assertEmulatorEnvironment
};
