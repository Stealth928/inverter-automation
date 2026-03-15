// Shared constants/helpers for local emulator test-user workflows.

const TEST_PASSWORD = '123456';

const TEST_USERS = Object.freeze([
  Object.freeze({
    uid: 'seed-admin-foxess',
    email: 'seed.foxess.admin@example.com',
    password: TEST_PASSWORD,
    displayName: 'Seed Admin FoxESS',
    role: 'admin',
    provider: 'foxess',
    config: Object.freeze({
      deviceProvider: 'foxess',
      deviceSn: 'FOX-SEED-1001',
      foxessToken: 'FOX_SEED_TOKEN_1001',
      amberApiKey: 'AMBER_SEED_FOXESS',
      amberSiteId: 'seed-site-foxess',
      weatherPlace: 'Adelaide',
      location: 'Adelaide, Australia',
      timezone: 'Australia/Adelaide',
      inverterCapacityW: 5000,
      batteryCapacityKWh: 13.5,
      systemTopology: { coupling: 'dc', source: 'seed' },
      setupComplete: true,
      tourComplete: true
    }),
    rule: Object.freeze({
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
    }),
    metrics: Object.freeze({
      today: { foxess: 177, amber: 346, weather: 45 },
      yesterday: { foxess: 96, amber: 205, weather: 28 }
    }),
    secrets: Object.freeze({})
  }),
  Object.freeze({
    uid: 'seed-admin-sungrow',
    email: 'seed.sungrow.admin@example.com',
    password: TEST_PASSWORD,
    displayName: 'Seed Admin Sungrow',
    role: 'admin',
    provider: 'sungrow',
    config: Object.freeze({
      deviceProvider: 'sungrow',
      deviceSn: 'SG-SEED-2001',
      sungrowDeviceSn: 'SG-SEED-2001',
      sungrowUsername: 'seed.sungrow.user@example.com',
      amberApiKey: 'AMBER_SEED_SUNGROW',
      amberSiteId: 'seed-site-sungrow',
      weatherPlace: 'Melbourne',
      location: 'Melbourne, Australia',
      timezone: 'Australia/Melbourne',
      inverterCapacityW: 8000,
      batteryCapacityKWh: 19.2,
      systemTopology: { coupling: 'ac', source: 'seed' },
      setupComplete: true,
      tourComplete: true
    }),
    rule: Object.freeze({
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
    }),
    metrics: Object.freeze({
      today: { sungrow: 143, amber: 221, weather: 34 },
      yesterday: { sungrow: 82, amber: 167, weather: 26 }
    }),
    secrets: Object.freeze({
      sungrowPassword: TEST_PASSWORD
    })
  }),
  Object.freeze({
    uid: 'seed-admin-sigenergy',
    email: 'seed.sigenergy.admin@example.com',
    password: TEST_PASSWORD,
    displayName: 'Seed Admin SigenEnergy',
    role: 'user',
    provider: 'sigenergy',
    config: Object.freeze({
      deviceProvider: 'sigenergy',
      deviceSn: 'SIG-SEED-3001',
      sigenDeviceSn: 'SIG-SEED-3001',
      sigenStationId: 'SIG-STATION-3001',
      sigenUsername: 'seed.sigenergy.user@example.com',
      sigenRegion: 'apac',
      amberApiKey: 'AMBER_SEED_SIGENERGY',
      amberSiteId: 'seed-site-sigenergy',
      weatherPlace: 'Brisbane',
      location: 'Brisbane, Australia',
      timezone: 'Australia/Brisbane',
      inverterCapacityW: 10000,
      batteryCapacityKWh: 20,
      systemTopology: { coupling: 'dc', source: 'seed' },
      setupComplete: true,
      tourComplete: true
    }),
    rule: Object.freeze({
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
    }),
    metrics: Object.freeze({
      today: { sigenergy: 118, amber: 189, weather: 30 },
      yesterday: { sigenergy: 67, amber: 122, weather: 21 }
    }),
    secrets: Object.freeze({
      sigenPassword: TEST_PASSWORD
    })
  }),
  Object.freeze({
    uid: 'seed-admin-alphaess',
    email: 'seed.alphaess.admin@example.com',
    password: TEST_PASSWORD,
    displayName: 'Seed Admin AlphaESS',
    role: 'admin',
    provider: 'alphaess',
    config: Object.freeze({
      deviceProvider: 'alphaess',
      deviceSn: 'ALPHA-SEED-4001',
      alphaessSystemSn: 'ALPHA-SEED-4001',
      alphaessAppId: 'ALPHA_SEED_APP_ID',
      alphaessAppSecret: 'ALPHA_SEED_APP_SECRET',
      amberApiKey: 'AMBER_SEED_ALPHAESS',
      amberSiteId: 'seed-site-alphaess',
      weatherPlace: 'Perth',
      location: 'Perth, Australia',
      timezone: 'Australia/Perth',
      inverterCapacityW: 6000,
      batteryCapacityKWh: 14.4,
      systemTopology: { coupling: 'ac', source: 'seed' },
      setupComplete: true,
      tourComplete: true
    }),
    rule: Object.freeze({
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
    }),
    metrics: Object.freeze({
      today: { alphaess: 101, amber: 174, weather: 27 },
      yesterday: { alphaess: 59, amber: 131, weather: 19 }
    }),
    secrets: Object.freeze({
      alphaessAppSecret: 'ALPHA_SEED_APP_SECRET'
    })
  })
]);

// Backward-compatible aliases for scripts expecting a single test user/config.
const TEST_USER = TEST_USERS[0];
const TEST_CONFIG = TEST_USER.config;

const LEGACY_TEST_USERS = Object.freeze([
  Object.freeze({ uid: 'emulator-test-user', email: 'test@gmail.com' })
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
  getProjectId,
  assertEmulatorEnvironment
};
