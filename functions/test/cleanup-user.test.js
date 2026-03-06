/**
 * Cleanup user endpoint tests
 * Verifies /api/auth/cleanup-user deletes the full user data tree.
 */

const { createFirebaseAdminHarness } = require('./helpers/firebase-mock');
const mockAdminHarness = createFirebaseAdminHarness();
const { mockFirestore, mockAuth } = mockAdminHarness;

jest.mock('firebase-admin', () => {
  const actualAdmin = jest.requireActual('firebase-admin');
  return mockAdminHarness.buildAdminMock(actualAdmin);
});

jest.mock('firebase-functions', () => ({
  config: jest.fn(() => ({})),
  https: { onRequest: jest.fn((handler) => handler) },
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

jest.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: jest.fn(() => jest.fn())
}));

const request = require('supertest');

let app;

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.JEST_WORKER_ID = '1';

  mockAuth.verifyIdToken.mockResolvedValue({ uid: 'cleanup-user-1', email: 'cleanup@example.com' });
  mockFirestore.recursiveDelete.mockResolvedValue(undefined);

  mockFirestore.collection.mockImplementation((name) => {
    if (name === 'users') {
      return {
        doc: jest.fn((id) => ({ id, path: `users/${id}` }))
      };
    }
    return {
      doc: jest.fn(() => ({ id: 'doc-id', path: `${name}/doc-id` })),
      where: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: jest.fn(async () => ({ empty: true, docs: [] }))
        }))
      })),
      get: jest.fn(async () => ({ docs: [], size: 0, forEach: () => {} })),
      add: jest.fn(async () => ({ id: 'audit-id' }))
    };
  });

  app = require('../index').app;
});

beforeEach(() => {
  mockFirestore.recursiveDelete.mockClear();
});

describe('POST /api/auth/cleanup-user', () => {
  it('should delete full user tree with recursiveDelete', async () => {
    const res = await request(app)
      .post('/api/auth/cleanup-user')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.errno).toBe(0);
    expect(mockFirestore.recursiveDelete).toHaveBeenCalledTimes(1);
    expect(mockFirestore.recursiveDelete.mock.calls[0][0]).toEqual(
      expect.objectContaining({ path: 'users/cleanup-user-1' })
    );
  });

  it('should require authentication', async () => {
    const res = await request(app).post('/api/auth/cleanup-user');
    expect(res.status).toBe(401);
  });
});
