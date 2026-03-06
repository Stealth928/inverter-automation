'use strict';

const { createAutomationStateRepository } = require('../lib/repositories/automation-state-repository');

function buildDbWithUserDoc(userDocRef, options = {}) {
  return {
    batch: options.batch || (() => ({ delete: () => {}, commit: async () => {} })),
    collection: (name) => {
      if (name !== 'users') throw new Error(`Unexpected collection: ${name}`);
      return {
        doc: () => userDocRef
      };
    },
    recursiveDelete: options.recursiveDelete
  };
}

describe('automation-state repository', () => {
  test('getUserAutomationState returns defaults when state document is missing', async () => {
    const userDocRef = {
      collection: (name) => {
        if (name !== 'automation') throw new Error(`Unexpected subcollection: ${name}`);
        return {
          doc: () => ({
            get: async () => ({ exists: false })
          })
        };
      }
    };

    const repository = createAutomationStateRepository({ db: buildDbWithUserDoc(userDocRef) });
    const state = await repository.getUserAutomationState('u-1');

    expect(state).toEqual({
      enabled: false,
      lastCheck: null,
      lastTriggered: null,
      activeRule: null
    });
  });

  test('saveUserAutomationState persists state and syncs automationEnabled flag', async () => {
    const automationWrites = [];
    const userWrites = [];
    const userDocRef = {
      collection: (name) => {
        if (name !== 'automation') throw new Error(`Unexpected subcollection: ${name}`);
        return {
          doc: () => ({
            set: async (payload, options) => {
              automationWrites.push({ payload: { ...payload }, options: { ...options } });
            }
          })
        };
      },
      set: async (payload, options) => {
        userWrites.push({ payload: { ...payload }, options: { ...options } });
      }
    };

    const repository = createAutomationStateRepository({ db: buildDbWithUserDoc(userDocRef) });
    const ok = await repository.saveUserAutomationState('u-2', { enabled: false, lastCheck: 123 });

    expect(ok).toBe(true);
    expect(automationWrites).toEqual([
      {
        payload: { enabled: false, lastCheck: 123 },
        options: { merge: true }
      }
    ]);
    expect(userWrites).toEqual([
      {
        payload: { automationEnabled: false },
        options: { merge: true }
      }
    ]);
  });

  test('quick control get/save/delete uses users/{uid}/quickControl/state', async () => {
    let quickState = { active: true, type: 'force_discharge' };
    let deleted = false;
    const userDocRef = {
      collection: (name) => {
        if (name !== 'quickControl') throw new Error(`Unexpected subcollection: ${name}`);
        return {
          doc: () => ({
            delete: async () => {
              deleted = true;
              quickState = null;
            },
            get: async () => ({
              exists: !!quickState,
              data: () => quickState
            }),
            set: async (payload) => {
              quickState = { ...payload };
              deleted = false;
            }
          })
        };
      }
    };

    const repository = createAutomationStateRepository({ db: buildDbWithUserDoc(userDocRef) });

    expect(await repository.getQuickControlState('u-quick')).toEqual({ active: true, type: 'force_discharge' });
    expect(await repository.saveQuickControlState('u-quick', { active: true, type: 'force_charge' })).toBe(true);
    expect(await repository.getQuickControlState('u-quick')).toEqual({ active: true, type: 'force_charge' });
    expect(await repository.saveQuickControlState('u-quick', null)).toBe(true);
    expect(deleted).toBe(true);
    expect(await repository.getQuickControlState('u-quick')).toBeNull();
  });

  test('deleteCollectionDocs deletes query documents in batches', async () => {
    const userDocRef = { collection: () => ({ doc: () => ({}) }) };
    let remaining = ['a', 'b', 'c', 'd'].map((id) => ({ ref: { id } }));
    let commitCount = 0;

    const db = buildDbWithUserDoc(userDocRef, {
      batch: () => {
        const refs = [];
        return {
          delete: (ref) => refs.push(ref),
          commit: async () => {
            commitCount += 1;
            const toDelete = new Set(refs.map((ref) => ref.id));
            remaining = remaining.filter((doc) => !toDelete.has(doc.ref.id));
          }
        };
      }
    });

    const query = {
      limit: (batchSize) => ({
        get: async () => {
          const docs = remaining.slice(0, batchSize);
          return {
            empty: docs.length === 0,
            docs
          };
        }
      })
    };

    const repository = createAutomationStateRepository({ db });
    await repository.deleteCollectionDocs(query, 2);

    expect(remaining).toEqual([]);
    expect(commitCount).toBe(2);
  });

  test('deleteUserDataTree prefers db.recursiveDelete when available', async () => {
    const userDocRef = { id: 'u-tree' };
    const recursiveDelete = jest.fn(async () => undefined);
    const db = buildDbWithUserDoc(userDocRef, { recursiveDelete });
    const repository = createAutomationStateRepository({ db });

    await repository.deleteUserDataTree('u-tree');

    expect(recursiveDelete).toHaveBeenCalledWith(userDocRef);
  });
});
