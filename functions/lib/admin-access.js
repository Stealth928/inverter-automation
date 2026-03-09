'use strict';

const DEFAULT_SEED_ADMIN_EMAIL = 'socrates.team.comms@gmail.com';

function createAdminAccess({ db, seedAdminEmail = DEFAULT_SEED_ADMIN_EMAIL, logger = console } = {}) {
  if (!db || typeof db.collection !== 'function') {
    throw new Error('createAdminAccess requires Firestore db');
  }

  const normalizedSeedAdminEmail = String(seedAdminEmail || '').toLowerCase();

  async function isAdmin(req) {
    if (req && req._isAdmin !== undefined) return req._isAdmin;
    if (!req || !req.user) {
      if (req) req._isAdmin = false;
      return false;
    }

    const email = String(req.user.email || '').toLowerCase();
    if (email && email === normalizedSeedAdminEmail) {
      req._isAdmin = true;
      return true;
    }

    try {
      const userDoc = await db.collection('users').doc(req.user.uid).get();
      const data = userDoc.exists ? userDoc.data() : {};
      req._isAdmin = data.role === 'admin';
    } catch (error) {
      const warnFn = logger && typeof logger.warn === 'function' ? logger.warn.bind(logger) : console.warn;
      warnFn('[Admin] Error checking admin role:', error && error.message ? error.message : error);
      req._isAdmin = false;
    }

    return req._isAdmin;
  }

  async function requireAdmin(req, res, next) {
    const adminAllowed = await isAdmin(req);
    if (!adminAllowed) {
      return res.status(403).json({ errno: 403, error: 'Admin access required' });
    }
    return next();
  }

  return {
    isAdmin,
    requireAdmin,
    SEED_ADMIN_EMAIL: normalizedSeedAdminEmail
  };
}

module.exports = {
  DEFAULT_SEED_ADMIN_EMAIL,
  createAdminAccess
};
