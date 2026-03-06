/**
 * Shared firebase-admin test harness for Jest suites.
 * Provides reusable Firestore/Auth mock instances and admin module factory.
 */

function createFirebaseAdminHarness(options = {}) {
  const mockFirestore = {
    collection: jest.fn(),
    runTransaction: jest.fn(),
    recursiveDelete: jest.fn(),
    batch: jest.fn(() => ({
      delete: jest.fn(),
      set: jest.fn(),
      update: jest.fn(),
      commit: jest.fn(async () => {})
    })),
    ...(options.firestore || {})
  };

  const mockAuth = {
    verifyIdToken: jest.fn(),
    getUser: jest.fn(),
    listUsers: jest.fn(),
    createCustomToken: jest.fn(),
    deleteUser: jest.fn(),
    setCustomUserClaims: jest.fn(),
    ...(options.auth || {})
  };

  const mockFieldValue = {
    serverTimestamp: jest.fn(() => new Date()),
    increment: jest.fn((n) => n),
    delete: jest.fn(),
    ...(options.fieldValue || {})
  };

  const buildAdminMock = (actualAdmin = {}) => ({
    ...actualAdmin,
    initializeApp: jest.fn(),
    apps: [{ name: 'test' }],
    firestore: Object.assign(jest.fn(() => mockFirestore), {
      FieldValue: mockFieldValue
    }),
    auth: jest.fn(() => mockAuth)
  });

  const resetAllMocks = () => {
    Object.values(mockFirestore).forEach((v) => {
      if (v && typeof v.mockClear === 'function') v.mockClear();
    });
    Object.values(mockAuth).forEach((v) => {
      if (v && typeof v.mockClear === 'function') v.mockClear();
    });
    Object.values(mockFieldValue).forEach((v) => {
      if (v && typeof v.mockClear === 'function') v.mockClear();
    });
  };

  return {
    mockFirestore,
    mockAuth,
    mockFieldValue,
    buildAdminMock,
    resetAllMocks
  };
}

module.exports = {
  createFirebaseAdminHarness
};
