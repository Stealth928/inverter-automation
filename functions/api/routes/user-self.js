'use strict';

function registerUserSelfRoutes(app, deps = {}) {
  const authenticateUser = deps.authenticateUser;
  const admin = deps.admin;
  const db = deps.db;
  const deleteCollectionDocs = deps.deleteCollectionDocs;
  const deleteUserDataTree = deps.deleteUserDataTree;
  const serverTimestamp = deps.serverTimestamp;

  if (!app || typeof app.post !== 'function') {
    throw new Error('registerUserSelfRoutes requires an Express app');
  }
  if (typeof authenticateUser !== 'function') {
    throw new Error('registerUserSelfRoutes requires authenticateUser middleware');
  }
  if (!admin || typeof admin.auth !== 'function') {
    throw new Error('registerUserSelfRoutes requires Firebase admin.auth()');
  }
  if (!db || typeof db.collection !== 'function') {
    throw new Error('registerUserSelfRoutes requires Firestore db');
  }
  if (typeof deleteCollectionDocs !== 'function') {
    throw new Error('registerUserSelfRoutes requires deleteCollectionDocs()');
  }
  if (typeof deleteUserDataTree !== 'function') {
    throw new Error('registerUserSelfRoutes requires deleteUserDataTree()');
  }
  if (typeof serverTimestamp !== 'function') {
    throw new Error('registerUserSelfRoutes requires serverTimestamp()');
  }

  // Initialize user profile (creates Firestore document if missing)
  app.post('/api/user/init-profile', authenticateUser, async (req, res) => {
    try {
      const userId = req.user.uid;
      const userEmail = req.user.email || '';

      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();
      const existing = userDoc.exists ? (userDoc.data() || {}) : {};
      const profileUpdate = {};
      let shouldWriteProfile = false;
      let automationEnabled = typeof existing.automationEnabled === 'boolean'
        ? existing.automationEnabled
        : false;

      if (!userDoc.exists || existing.uid !== userId) {
        profileUpdate.uid = userId;
        shouldWriteProfile = true;
      }
      if (!userDoc.exists || existing.email !== userEmail) {
        profileUpdate.email = userEmail;
        shouldWriteProfile = true;
      }
      if (!userDoc.exists || typeof existing.automationEnabled !== 'boolean') {
        profileUpdate.automationEnabled = false;
        automationEnabled = false;
        shouldWriteProfile = true;
      }
      // createdAt must be immutable once set.
      if (!existing.createdAt) {
        profileUpdate.createdAt = serverTimestamp();
        shouldWriteProfile = true;
      }
      if (shouldWriteProfile) {
        profileUpdate.lastUpdated = serverTimestamp();
        await userRef.set(profileUpdate, { merge: true });
      }

      // Ensure automation state exists and is enabled
      const stateRef = db.collection('users').doc(userId).collection('automation').doc('state');
      const stateDoc = await stateRef.get();
      let createdAutomationState = false;

      if (!stateDoc.exists) {
        // Create default state with automation DISABLED (user must enable it)
        await stateRef.set({
          enabled: false,
          lastCheck: null,
          lastTriggered: null,
          activeRule: null,
          updatedAt: serverTimestamp()
        });
        createdAutomationState = true;
        automationEnabled = false;
      } else {
        const stateData = stateDoc.data() || {};
        if (typeof stateData.enabled === 'boolean') {
          automationEnabled = stateData.enabled;
        }
      }

      res.json({
        errno: 0,
        result: {
          userId,
          message: 'User profile initialized successfully',
          automationEnabled,
          profileUpdated: shouldWriteProfile,
          automationStateCreated: createdAutomationState
        }
      });
    } catch (error) {
      console.error('[API] Error initializing user:', error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });

  // Delete own account + user data (irreversible)
  app.post('/api/user/delete-account', authenticateUser, async (req, res) => {
    try {
      // Safety: disallow deleting through admin header-impersonation context.
      if (req.actorUser) {
        return res.status(403).json({ errno: 403, error: 'Stop impersonation before deleting an account.' });
      }

      const userId = req.user.uid;
      const userEmail = String(req.user.email || '').trim().toLowerCase();
      const confirmText = String(req.body?.confirmText || '').trim();
      const confirmEmail = String(req.body?.confirmEmail || '').trim().toLowerCase();

      if (confirmText !== 'DELETE') {
        return res.status(400).json({ errno: 400, error: 'Confirmation text must be DELETE' });
      }

      if (userEmail && confirmEmail !== userEmail) {
        return res.status(400).json({ errno: 400, error: 'Confirmation email does not match signed-in user' });
      }

      // Remove user-scoped Firestore data first.
      await deleteUserDataTree(userId);

      // Best-effort cleanup for audit records referencing this user.
      try {
        await deleteCollectionDocs(db.collection('admin_audit').where('adminUid', '==', userId));
        await deleteCollectionDocs(db.collection('admin_audit').where('targetUid', '==', userId));
      } catch (auditError) {
        console.warn('[AccountDelete] Failed to clean admin_audit references:', auditError.message || auditError);
      }

      // Delete Firebase Auth identity.
      try {
        await admin.auth().deleteUser(userId);
      } catch (authErr) {
        if (!authErr || authErr.code !== 'auth/user-not-found') {
          throw authErr;
        }
      }

      res.json({ errno: 0, result: { deleted: true } });
    } catch (error) {
      console.error('[API] /api/user/delete-account error:', error && error.stack ? error.stack : String(error));
      res.status(500).json({ errno: 500, error: error.message || String(error) });
    }
  });
}

module.exports = {
  registerUserSelfRoutes
};
