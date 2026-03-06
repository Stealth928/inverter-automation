'use strict';

function createAutomationStateRepository(deps = {}) {
  const db = deps.db;

  if (!db || typeof db.collection !== 'function') {
    throw new Error('createAutomationStateRepository requires a Firestore db dependency');
  }

  function getUserDocRef(userId) {
    return db.collection('users').doc(userId);
  }

  async function getUserAutomationState(userId) {
    try {
      const stateDoc = await getUserDocRef(userId).collection('automation').doc('state').get();
      if (stateDoc.exists) {
        return stateDoc.data();
      }
      return {
        enabled: false,
        lastCheck: null,
        lastTriggered: null,
        activeRule: null
      };
    } catch (error) {
      console.error('Error getting automation state:', error);
      return null;
    }
  }

  async function saveUserAutomationState(userId, state) {
    try {
      await getUserDocRef(userId).collection('automation').doc('state').set(state, { merge: true });

      if ('enabled' in state) {
        await getUserDocRef(userId).set(
          { automationEnabled: !!state.enabled },
          { merge: true }
        );
      }
      return true;
    } catch (error) {
      console.error('Error saving automation state:', error);
      return false;
    }
  }

  async function getQuickControlState(userId) {
    try {
      const stateDoc = await getUserDocRef(userId).collection('quickControl').doc('state').get();
      if (stateDoc.exists) {
        return stateDoc.data();
      }
      return null;
    } catch (error) {
      console.error('Error getting quick control state:', error);
      return null;
    }
  }

  async function saveQuickControlState(userId, state) {
    try {
      if (state === null) {
        await getUserDocRef(userId).collection('quickControl').doc('state').delete();
      } else {
        await getUserDocRef(userId).collection('quickControl').doc('state').set(state);
      }
      return true;
    } catch (error) {
      console.error('Error saving quick control state:', error);
      return false;
    }
  }

  async function deleteCollectionDocs(query, batchSize = 200) {
    let snapshot = await query.limit(batchSize).get();
    while (!snapshot.empty) {
      const batch = db.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      snapshot = await query.limit(batchSize).get();
    }
  }

  async function deleteDocumentTreeFallback(docRef) {
    if (!docRef || typeof docRef.listCollections !== 'function') {
      await docRef?.delete?.().catch(() => {});
      return;
    }

    const subcollections = await docRef.listCollections();
    for (const subcollection of subcollections) {
      let snapshot = await subcollection.limit(100).get();
      while (!snapshot.empty) {
        for (const doc of snapshot.docs) {
          await deleteDocumentTreeFallback(doc.ref);
        }
        snapshot = await subcollection.limit(100).get();
      }
    }

    await docRef.delete().catch(() => {});
  }

  async function deleteUserDataTree(userId) {
    const userRef = getUserDocRef(userId);
    if (typeof db.recursiveDelete === 'function') {
      await db.recursiveDelete(userRef);
      return;
    }
    await deleteDocumentTreeFallback(userRef);
  }

  return {
    deleteCollectionDocs,
    deleteUserDataTree,
    getQuickControlState,
    getUserAutomationState,
    saveQuickControlState,
    saveUserAutomationState
  };
}

module.exports = {
  createAutomationStateRepository
};
