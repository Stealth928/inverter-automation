// Shared constants/helpers for local emulator test-user workflows.

const TEST_USER = Object.freeze({
  uid: 'emulator-test-user',
  email: 'test@gmail.com',
  password: '123456',
  displayName: 'Local Emulator Test User',
  role: 'admin'
});

const TEST_CONFIG = Object.freeze({
  deviceSn: 'TEST-SN-0001',
  foxessToken: 'FAKE_TOKEN',
  amberApiKey: 'FAKE_AMBER',
  amberSiteId: 'mock-site-local-1',
  weatherPlace: 'Sydney',
  location: 'Sydney, Australia'
});

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
  TEST_USER,
  TEST_CONFIG,
  getProjectId,
  assertEmulatorEnvironment
};
