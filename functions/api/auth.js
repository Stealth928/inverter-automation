/**
 * Authentication Middleware Module
 * Handles Firebase Auth token verification for Cloud Functions endpoints
 * 
 * Key Features:
 * - Firebase ID token verification via admin.auth().verifyIdToken()
 * - Required auth middleware (authenticateUser) - returns 401 if token missing/invalid
 * - Optional auth helper (tryAttachUser) - attaches user if present, returns null otherwise
 * - Compatible with Express middleware patterns
 * 
 * Usage:
 *   const authAPI = require('./api/auth').init({ admin, logger });
 *   app.use('/api/protected', authAPI.authenticateUser);
 *   app.get('/api/public', async (req, res) => {
 *     await authAPI.tryAttachUser(req);
 *     // req.user will be set if authenticated, null otherwise
 *   });
 */

// Module state - initialized via init()
let admin = null;
let logger = null;

/**
 * Initialize module with dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.admin - Firebase Admin SDK instance
 * @param {Object} deps.logger - Logger instance (console or custom)
 */
function init(deps) {
  admin = deps.admin;
  logger = deps.logger || console;
  
  logger.info('[AuthAPI] Module initialized');
  
  return {
    authenticateUser,
    tryAttachUser
  };
}

/**
 * Middleware to verify Firebase ID token
 * REQUIRED auth - returns 401 if token missing or invalid
 * Attaches decoded token to req.user and calls next() on success
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const authenticateUser = async (req, res, next) => {
  let idToken = null;
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    idToken = authHeader.split('Bearer ')[1];
  } else if (req.query && req.query.idToken) {
    // Support idToken in query params for redirect-based flows
    idToken = req.query.idToken;
  }

  if (!idToken) {
    return res.status(401).json({ errno: 401, error: 'Unauthorized: No token provided' });
  }
  
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    logger.error('[AuthAPI] Token verification failed:', error.message);
    return res.status(401).json({ errno: 401, error: 'Unauthorized: Invalid token' });
  }
};

/**
 * Attempt to attach Firebase user info without enforcing auth
 * OPTIONAL auth - used by public endpoints that accept optional authentication
 * Returns decoded token if present and valid, null otherwise
 * Attaches decoded token to req.user as a side effect
 * 
 * @param {Object} req - Express request object
 * @returns {Promise<Object|null>} Decoded token or null
 */
const tryAttachUser = async (req) => {
  if (req.user) {
    return req.user;
  }

  let idToken = null;
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    idToken = authHeader.split('Bearer ')[1];
  } else if (req.query && req.query.idToken) {
    idToken = req.query.idToken;
  }

  if (!idToken) {
    return null;
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    return decodedToken;
  } catch (error) {
    logger.warn('[AuthAPI]', `Token verification failed: ${error.message}`);
    return null;
  }
};

module.exports = { init };
