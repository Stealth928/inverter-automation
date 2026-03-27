'use strict';

function registerAuthLifecycleRoutes(app, deps = {}) {
  const authenticateUser = deps.authenticateUser;
  const db = deps.db;
  const deleteUserDataTree = deps.deleteUserDataTree;
  const logger = deps.logger;
  const serverTimestamp = deps.serverTimestamp;
  const setUserConfig = deps.setUserConfig;
  const sendSignupAlert = typeof deps.sendSignupAlert === 'function'
    ? deps.sendSignupAlert
    : (typeof deps.sendAdminSystemAlert === 'function' ? deps.sendAdminSystemAlert : null);

  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function') {
    throw new Error('registerAuthLifecycleRoutes requires an Express app');
  }
  if (typeof authenticateUser !== 'function') {
    throw new Error('registerAuthLifecycleRoutes requires authenticateUser middleware');
  }
  if (!db || typeof db.collection !== 'function') {
    throw new Error('registerAuthLifecycleRoutes requires Firestore db');
  }
  if (typeof deleteUserDataTree !== 'function') {
    throw new Error('registerAuthLifecycleRoutes requires deleteUserDataTree()');
  }
  if (!logger || typeof logger.info !== 'function') {
    throw new Error('registerAuthLifecycleRoutes requires logger.info()');
  }
  if (typeof serverTimestamp !== 'function') {
    throw new Error('registerAuthLifecycleRoutes requires serverTimestamp()');
  }
  if (typeof setUserConfig !== 'function') {
    throw new Error('registerAuthLifecycleRoutes requires setUserConfig()');
  }

  // Health check with auth
  app.get('/api/health/auth', authenticateUser, (req, res) => {
    res.json({ ok: true, user: req.user.uid });
  });

  // Initialize Firestore user/profile/config/state after sign-up.
  app.post('/api/auth/init-user', authenticateUser, async (req, res) => {
    try {
      const userId = req.user.uid;
      const { email, displayName } = req.user;
      const userDocRef = db.collection('users').doc(userId);
      const existingUserSnapshot = await userDocRef.get();
      const isFirstInit = !existingUserSnapshot.exists;

      await userDocRef.set({
        email,
        displayName: displayName || '',
        photoURL: req.user.photoURL || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });

      await setUserConfig(userId, {
        deviceSn: '',
        foxessToken: '',
        amberApiKey: '',
        amberSiteId: '',
        weatherPlace: 'Sydney',
        cache: {
          teslaStatus: 600000
        },
        automation: {
          intervalMs: 60000,
          enabled: true
        },
        createdAt: serverTimestamp()
      }, { merge: true });

      await db.collection('users').doc(userId).collection('automation').doc('state').set({
        enabled: false,
        lastCheck: null,
        lastTriggered: null,
        activeRule: null
      }, { merge: true });

      if (isFirstInit && sendSignupAlert) {
        try {
          await sendSignupAlert({
            userId,
            eventType: 'signup',
            stateSignature: `uid:${userId}`,
            title: 'New user signup',
            email,
            body: `${email || userId} completed account initialization.`,
            severity: 'info',
            deepLink: '/admin.html#users'
          });
        } catch (alertError) {
          logger.info('Auth', `Failed to emit admin signup alert for ${userId}: ${alertError?.message || alertError}`, true);
        }
      }

      logger.info('Auth', `User ${userId} initialized successfully`, true);
      res.json({ errno: 0, msg: 'User initialized' });
    } catch (error) {
      console.error('[Auth] Error initializing user:', error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });

  // Cleanup Firestore data before deleting Firebase Auth user.
  app.post('/api/auth/cleanup-user', authenticateUser, async (req, res) => {
    try {
      const userId = req.user.uid;
      logger.info('Auth', `Cleaning up user: ${userId}`, true);

      await deleteUserDataTree(userId);

      logger.info('Auth', `User ${userId} data cleaned up successfully`, true);
      res.json({ errno: 0, msg: 'User data deleted' });
    } catch (error) {
      console.error('[Auth] Error cleaning up user:', error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });
}

module.exports = {
  registerAuthLifecycleRoutes
};
