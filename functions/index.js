/**
 * Firebase Cloud Functions for Inverter App
 * Version: 2.2.0 - Fix segment group count (use 8, not 10)
 * 
 * This module provides:
 * - API endpoints (proxied from frontend)
 * - Scheduled automation tasks
 * - Shared API caching (Amber, Weather, FoxESS)
 * - Per-user automation execution
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const crypto = require('crypto');

// Initialize Firebase Admin SDK
admin.initializeApp();
const db = admin.firestore();

// ==================== CONFIGURATION ====================
// Secrets are stored in Firebase Functions config or Secret Manager
// Set via: firebase functions:config:set foxess.token="xxx" amber.api_key="xxx"
const getConfig = () => {
  let ffConfig = {};
  try {
    ffConfig = functions.config() || {};
  } catch (e) {
    // functions.config() may not be available in 2nd gen runtimes.
    ffConfig = {};
  }

  return {
    foxess: {
      token: (ffConfig.foxess && ffConfig.foxess.token) || process.env.FOXESS_TOKEN || '',
      baseUrl: (ffConfig.foxess && ffConfig.foxess.base_url) || process.env.FOXESS_BASE_URL || 'https://www.foxesscloud.com'
    },
    amber: {
      apiKey: (ffConfig.amber && ffConfig.amber.api_key) || process.env.AMBER_API_KEY || '',
      baseUrl: (ffConfig.amber && ffConfig.amber.base_url) || process.env.AMBER_BASE_URL || 'https://api.amber.com.au/v1'
    },
    automation: {
      intervalMs: 60000,
      cacheTtl: {
        amber: 60000,      // 60 seconds
        inverter: 300000,  // 5 minutes
        weather: 1800000   // 30 minutes
      }
    }
  };
};

// ==================== CACHED INVERTER DATA HELPER ====================
/**
 * Get inverter data with per-user Firestore cache.
 * Respects TTL (default 5 minutes, configurable via user config).
 * Only fetches fresh data if cache is expired.
 */
async function getCachedInverterData(userId, deviceSN, userConfig, forceRefresh = false) {
  const config = getConfig();
  // Use user's custom TTL if set, otherwise fall back to default
  const ttlMs = (userConfig?.automation?.inverterCacheTtlMs) || config.automation.cacheTtl.inverter;
  
  try {
    // Check cache if not forcing refresh
    if (!forceRefresh) {
      const cacheDoc = await db.collection('users').doc(userId).collection('cache').doc('inverter').get();
      if (cacheDoc.exists) {
        const { data, timestamp } = cacheDoc.data();
        const ageMs = Date.now() - timestamp;
        if (ageMs < ttlMs) {
          console.log(`[Cache] Inverter data fresh (age: ${ageMs}ms, TTL: ${ttlMs}ms)`);
          return { ...data, __cacheHit: true, __cacheAgeMs: ageMs, __cacheTtlMs: ttlMs };
        } else {
          console.log(`[Cache] Inverter data expired (age: ${ageMs}ms, TTL: ${ttlMs}ms) - fetching fresh`);
        }
      } else {
        console.log(`[Cache] No cached inverter data - fetching fresh`);
      }
    } else {
      console.log(`[Cache] Force refresh requested for inverter data`);
    }
    
    // Fetch fresh data from FoxESS
    const data = await callFoxESSAPI('/op/v0/device/real/query', 'POST', {
      sn: deviceSN,
      variables: ['SoC', 'batTemperature', 'ambientTemperation', 'pvPower', 'loadsPower', 'gridConsumptionPower', 'feedinPower']
    }, userConfig, userId);
    
    // Store in cache if successful
    if (data?.errno === 0) {
      await db.collection('users').doc(userId).collection('cache').doc('inverter').set({
        data,
        timestamp: Date.now(),
        ttlMs,
        ttl: Math.floor(Date.now() / 1000) + Math.floor(ttlMs / 1000) // Firestore TTL in seconds
      }, { merge: true }).catch(cacheErr => {
        console.warn(`[Cache] Failed to store inverter cache: ${cacheErr.message}`);
      });
      console.log(`[Cache] Stored fresh inverter data in cache (TTL: ${ttlMs}ms)`);
    }
    
    return { ...data, __cacheHit: false, __cacheAgeMs: 0, __cacheTtlMs: ttlMs };
  } catch (err) {
    console.error(`[Cache] Error in getCachedInverterData: ${err.message}`);
    return { errno: 500, error: err.message };
  }
}

// ==================== AUTOMATION AUDIT LOG HELPERS ====================
/**
 * Log a single automation cycle to the audit trail.
 * Stores in users/{uid}/automationAudit/{docId} with 48-hour TTL.
 */
async function addAutomationAuditEntry(userId, cycleData) {
  try {
    const docId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const auditEntry = {
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      epochMs: Date.now(),
      cycleId: cycleData.cycleId || docId,
      
      // Evaluation results
      triggered: cycleData.triggered || false,
      ruleName: cycleData.ruleName || null,
      ruleId: cycleData.ruleId || null,
      rulesEvaluated: cycleData.rulesEvaluated || 0,
      
      // Condition evaluation details
      evaluationResults: cycleData.evaluationResults || [],
      
      // Action taken (if any)
      actionTaken: cycleData.actionTaken || null,
      segmentApplied: cycleData.segmentApplied || null,
      
      // Cache info
      inverterCacheHit: cycleData.inverterCacheHit || false,
      inverterCacheAgeMs: cycleData.inverterCacheAgeMs || null,
      
      // Timing
      cycleDurationMs: cycleData.cycleDurationMs || 0,
      
      // State transitions
      activeRuleBefore: cycleData.activeRuleBefore || null,
      activeRuleAfter: cycleData.activeRuleAfter || null,
      
      // Errors
      error: cycleData.error || null,
      
      // TTL for 48-hour auto-cleanup (Firestore TTL policy must be enabled)
      ttl: Math.floor((Date.now() + 48 * 60 * 60 * 1000) / 1000)
    };
    
    await db.collection('users').doc(userId).collection('automationAudit').doc(docId).set(auditEntry);
    console.log(`[Audit] Logged automation cycle: ${docId}`);
  } catch (err) {
    console.warn(`[Audit] Failed to log automation entry: ${err.message}`);
  }
}

/**
 * Get recent automation audit logs (last 48 hours).
 * Returns entries sorted by timestamp descending.
 */
async function getAutomationAuditLogs(userId, limitEntries = 100) {
  try {
    const snapshot = await db
      .collection('users').doc(userId).collection('automationAudit')
      .orderBy('epochMs', 'desc')
      .limit(limitEntries)
      .get();
    
    const entries = [];
    snapshot.forEach(doc => {
      entries.push({ docId: doc.id, ...doc.data() });
    });
    
    console.log(`[Audit] Retrieved ${entries.length} audit logs for user ${userId}`);
    return entries;
  } catch (err) {
    console.error(`[Audit] Failed to retrieve audit logs: ${err.message}`);
    return [];
  }
}

// ==================== RATE LIMIT STATE ====================
const amberRateLimitState = {
  retryAfter: 0,
  lastError: null,
  resetTime: 0
};

// ==================== EXPRESS APP ====================
const app = express();
app.use(cors({ origin: true }));
// Simple request logger to help debug routing and missing endpoints
app.use((req, res, next) => {
  try {
    console.log('[API REQ] ', req.method, req.originalUrl || req.url, 'headers:', Object.keys(req.headers).slice(0,10));
  } catch (e) { /* ignore logging errors */ }
  next();
});
// Capture raw request body (for debugging) and provide a more helpful error when JSON parsing fails
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf && buf.toString ? buf.toString() : '';
  }
}));

// JSON parse error handler - return structured JSON instead of generic 500
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    console.error('[API] Invalid JSON body:', err.message, 'rawBody=', req.rawBody && req.rawBody.slice ? req.rawBody.slice(0, 1000) : req.rawBody);
    return res.status(400).json({ errno: 400, error: 'Invalid JSON body', raw: req.rawBody && req.rawBody.slice ? req.rawBody.slice(0, 1000) : req.rawBody });
  }
  next(err);
});

// ==================== AUTH MIDDLEWARE ====================
/**
 * Middleware to verify Firebase ID token
 */
const authenticateUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ errno: 401, error: 'Unauthorized: No token provided' });
  }
  
  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Token verification failed:', error.message);
    return res.status(401).json({ errno: 401, error: 'Unauthorized: Invalid token' });
  }
};

// Attempt to attach Firebase user info without enforcing auth (used by public endpoints)
const tryAttachUser = async (req) => {
  if (req.user) {
    console.log('[Auth] User already attached:', req.user.uid);
    return req.user;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('[Auth] No Authorization header or not Bearer format');
    return null;
  }

  const idToken = authHeader.split('Bearer ')[1];
  console.log('[Auth] Attempting to verify token:', idToken.substring(0, 20) + '...');
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    console.log('[Auth] Token verified successfully for user:', decodedToken.uid);
    return decodedToken;
  } catch (error) {
    console.warn('[Auth] Token verification failed:', error.message);
    return null;
  }
};

// ==================== UNPROTECTED ENDPOINTS (Before Auth Middleware) ====================

// Health check (no auth required)
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Password reset (no auth required)
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email || !email.trim()) {
      return res.status(400).json({ errno: 400, error: 'Email is required' });
    }
    
    console.log(`[Auth] Password reset requested for: ${email}`);
    res.json({ 
      errno: 0, 
      msg: 'If this email exists, a password reset link has been sent. Please check your email.' 
    });
  } catch (error) {
    console.error('[Auth] Password reset error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Validate API credentials during setup (no auth required for initial validation)
app.post('/api/config/validate-keys', async (req, res) => {
  try {
    await tryAttachUser(req);
    const { device_sn, foxess_token, amber_api_key } = req.body;
    const errors = {};
    const failed_keys = [];
    
    // For unauthenticated setup, just validate the FoxESS token without saving
    // Once user is authenticated, they can complete setup via authenticated endpoint
    if (foxess_token && device_sn) {
      console.log(`[Validation] Testing FoxESS token`);
      const testConfig = { foxessToken: foxess_token, deviceSn: device_sn };
      const foxResult = await callFoxESSAPI('/op/v0/device/list', 'POST', { currentPage: 1, pageSize: 10 }, testConfig, null);
      
      console.log(`[Validation] FoxESS API response:`, foxResult);
      
      if (!foxResult || foxResult.errno !== 0) {
        failed_keys.push('foxess_token');
        errors.foxess_token = foxResult?.msg || foxResult?.error || 'Invalid FoxESS token or API error';
      } else {
        // Check if device SN exists in the response
        const devices = foxResult.result?.data || [];
        const deviceFound = devices.some(d => d.deviceSN === device_sn);
        if (!deviceFound && devices.length > 0) {
          failed_keys.push('device_sn');
          errors.device_sn = `Device SN not found. Available: ${devices.map(d => d.deviceSN).join(', ')}`;
        } else if (!deviceFound && devices.length === 0) {
          // No devices returned - might be a token issue
          failed_keys.push('foxess_token');
          errors.foxess_token = 'No devices found. Please check your FoxESS token.';
        }
      }
    } else {
      if (!device_sn) {
        failed_keys.push('device_sn');
        errors.device_sn = 'Device Serial Number is required';
      }
      if (!foxess_token) {
        failed_keys.push('foxess_token');
        errors.foxess_token = 'FoxESS API Token is required';
      }
    }
    
    // If validation passed, persist config.
    // - If the caller is authenticated, save under their user document.
    // - If unauthenticated (setup flow), save to a shared server config doc so hosting deployments
    //   can persist runtime credentials across requests (useful for single-instance installs).
    if (failed_keys.length === 0) {
      const configData = {
        deviceSn: device_sn,
        foxessToken: foxess_token,
        amberApiKey: amber_api_key || '',
        setupComplete: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      if (req.user?.uid) {
        await db.collection('users').doc(req.user.uid).collection('config').doc('main').set(configData, { merge: true });
        console.log(`[Validation] Config saved successfully for user ${req.user.uid}`);
      } else {
        // Persist to shared server config so the setup flow completes for unauthenticated users
        await db.collection('shared').doc('serverConfig').set(configData, { merge: true });
        console.log('[Validation] Config saved to shared serverConfig (unauthenticated setup flow)');
      }
    }
    
    if (failed_keys.length > 0) {
      return res.status(400).json({
        errno: 1,
        msg: `Validation failed for: ${failed_keys.join(', ')}`,
        failed_keys,
        errors
      });
    }
    
    res.json({ errno: 0, msg: 'Credentials validated successfully', result: { deviceSn: device_sn } });
  } catch (error) {
    console.error('[Validation] Error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Check if user setup is complete (no auth required for initial check during setup flow)
app.get('/api/config/setup-status', async (req, res) => {
  try {
    // Log all request details for debugging
    const authHeader = req.headers.authorization || '(no auth header)';
    console.log(`[Setup Status] Request headers:`, {
      hasAuthHeader: !!req.headers.authorization,
      authHeaderPrefix: authHeader.substring(0, 20)
    });
    
    await tryAttachUser(req);
    
    console.log(`[Setup Status] After tryAttachUser - User:`, req.user ? `${req.user.uid} (email: ${req.user.email})` : '(not authenticated)');
    
    // If user is authenticated (has ID token), check their Firestore config
    if (req.user?.uid) {
      const config = await getUserConfig(req.user.uid);
      console.log(`[Setup Status] getUserConfig result for ${req.user.uid}:`, {
        found: !!config,
        deviceSn: config?.deviceSn ? '(present)' : '(missing)',
        foxessToken: config?.foxessToken ? '(present)' : '(missing)',
        amberApiKey: config?.amberApiKey ? '(present)' : '(missing)',
        setupComplete: config?.setupComplete,
        source: config?._source
      });
      
      // Treat setupComplete as true if explicitly set OR if both critical fields are present
      const setupComplete = !!((config?.setupComplete === true) || (config?.deviceSn && config?.foxessToken));
      return res.json({ errno: 0, result: { setupComplete, hasDeviceSn: !!config?.deviceSn, hasFoxessToken: !!config?.foxessToken, hasAmberKey: !!config?.amberApiKey, source: config?._source || 'user' } });
    }
    
    // Unauthenticated user - fall back to shared server config (if present)
    console.log(`[Setup Status] No user authenticated, checking shared serverConfig...`);
    try {
      const sharedDoc = await db.collection('shared').doc('serverConfig').get();
      if (sharedDoc.exists) {
        const cfg = sharedDoc.data() || {};
        console.log(`[Setup Status] Found shared serverConfig:`, {
          deviceSn: cfg.deviceSn ? '(present)' : '(missing)',
          foxessToken: cfg.foxessToken ? '(present)' : '(missing)'
        });
        const setupComplete = !!(cfg.setupComplete && cfg.deviceSn && cfg.foxessToken);
        return res.json({ errno: 0, result: { setupComplete, hasDeviceSn: !!cfg.deviceSn, hasFoxessToken: !!cfg.foxessToken, hasAmberKey: !!cfg.amberApiKey, source: 'shared' } });
      }
    } catch (e) {
      console.warn('[Setup Status] Error reading shared server config:', e.message || e);
    }

    // No shared config found - setup not complete
    console.log(`[Setup Status] No shared config found, setup not complete`);
    res.json({ errno: 0, result: { setupComplete: false, hasDeviceSn: false, hasFoxessToken: false, hasAmberKey: false } });
  } catch (error) {
    console.error('[Setup Status] Error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Amber sites (allow unauthenticated calls - return empty list when no user)
app.get('/api/amber/sites', async (req, res) => {
  try {
    // Attach optional user if provided, but don't require auth
    await tryAttachUser(req);
    const userId = req.user?.uid;
    const debug = req.query.debug === 'true';
    
    console.log(`[Amber] /sites request (pre-auth-middleware) from user: ${userId}`);

    if (!userId) {
      // No user signed in - safe empty response for UI
      const response = { errno: 0, result: [] };
      if (debug) response._debug = 'Not authenticated';
      return res.json(response);
    }

    const userConfig = await getUserConfig(userId);
    const hasKey = userConfig?.amberApiKey;
    console.log(`[Amber] User config (pre-auth) for ${userId}:`, userConfig ? 'found' : 'not found', hasKey ? '(has key)' : '(no key)');

    if (!userConfig || !hasKey) {
      const response = { errno: 0, result: [] };
      if (debug) {
        response._debug = `Config issue: userConfig=${!!userConfig}, hasAmberKey=${hasKey}`;
      }
      return res.json(response);
    }

    // Try cache first
    let cachedSites = await getCachedAmberSites(userId);
    if (cachedSites) {
      console.log(`[Amber] Returning ${cachedSites.length} cached sites for ${userId}`);
      return res.json({ errno: 0, result: cachedSites, _cached: true });
    }

    // Cache miss - call API
    console.log(`[Amber] Sites cache miss for ${userId}, calling API`);
    incrementApiCount(userId, 'amber').catch(err => console.warn('[Amber] Failed to log API call:', err.message));
    const result = await callAmberAPI('/sites', {}, userConfig, userId, true);

    console.log(`[Amber] API result for ${userId}:`, result && result.errno === 0 ? 'success' : `error(${result?.errno}): ${result?.error || result?.msg}`);

    let sites = [];
    if (result && result.data && Array.isArray(result.data)) sites = result.data;
    else if (result && result.sites && Array.isArray(result.sites)) sites = result.sites;
    else if (Array.isArray(result)) sites = result;
    
    // Store in cache for future requests
    if (sites.length > 0) {
      await cacheAmberSites(userId, sites);
    }

    if (sites.length > 0) {
      return res.json({ errno: 0, result: sites });
    }
    
    // If there's an error from Amber API, pass it through with debug info if requested
    if (result && result.errno && result.errno !== 0) {
      const response = { errno: 0, result: [] };
      if (debug) response._debug = `Amber API error: ${result.error || result.msg}`;
      return res.json(response);
    }
    
    return res.json({ errno: 0, result: [] });
  } catch (e) {
    console.error('[Amber] Pre-auth /sites error:', e && e.message ? e.message : e);
    const response = { errno: 0, result: [] };
    if (req.query.debug === 'true') response._debug = `Exception: ${e?.message || String(e)}`;
    return res.json(response);
  }
});

// Public-friendly endpoint for current prices (mirror of /api/amber/prices but accepts
// the '/current' path which the frontend sometimes uses). Returns safe JSON when unauthenticated.
app.get('/api/amber/prices/current', async (req, res) => {
  try {
    await tryAttachUser(req);
    const userId = req.user?.uid;
    if (!userId) return res.json({ errno: 0, result: [] });

    const userConfig = await getUserConfig(userId);
    if (!userConfig || !userConfig.amberApiKey) return res.json({ errno: 0, result: [] });

    const siteId = req.query.siteId;
    const next = Number(req.query.next || '1') || 1;

    if (!siteId) return res.status(400).json({ errno: 400, error: 'Site ID is required', result: [] });

    const result = await callAmberAPI(`/sites/${encodeURIComponent(siteId)}/prices/current`, { next }, userConfig, userId);
    
    // LOG: Detailed Amber response analysis
    if (Array.isArray(result)) {
      console.log(`[Amber /prices/current] Received ${result.length} total intervals`);
      const forecastIntervals = result.filter(p => p.type === 'ForecastInterval');
      const feedInForecasts = forecastIntervals.filter(p => p.channelType === 'feedIn');
      console.log(`[Amber /prices/current] ${forecastIntervals.length} forecast intervals (${feedInForecasts.length} feedIn)`);
      if (feedInForecasts.length > 0) {
        // Show feed-in price range
        const feedInPrices = feedInForecasts.map(f => f.perKwh);
        const minFeedIn = Math.min(...feedInPrices);
        const maxFeedIn = Math.max(...feedInPrices);
        const firstTime = new Date(feedInForecasts[0].startTime).toLocaleString('en-AU', {hour12:false, timeZone:'Australia/Sydney'});
        const lastTime = new Date(feedInForecasts[feedInForecasts.length - 1].startTime).toLocaleString('en-AU', {hour12:false, timeZone:'Australia/Sydney'});
        console.log(`[Amber /prices/current] Feed-in range: ${minFeedIn.toFixed(2)} to ${maxFeedIn.toFixed(2)} ¢/kWh`);
        console.log(`[Amber /prices/current] Time range: ${firstTime} to ${lastTime}`);
        // Show actual prices if max is > 100 (to catch spikes)
        if (maxFeedIn > 100 || maxFeedIn < -100) {
          const allPricesWithTime = feedInForecasts.map(f => `${new Date(f.startTime).toLocaleTimeString('en-AU', {hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Australia/Sydney'})}=${f.perKwh.toFixed(1)}¢`);
          console.log(`[Amber /prices/current] ALL FEED-IN PRICES: ${allPricesWithTime.join(', ')}`);
        }
      }
    }
    
    // Normalize response to wrapped format
    if (Array.isArray(result)) {
      return res.json({ errno: 0, result });
    }
    // If already wrapped, return as-is
    if (result?.errno !== undefined) {
      return res.json(result);
    }
    // Fallback: wrap whatever we got
    return res.json({ errno: 0, result });
  } catch (e) {
    console.error('[Amber] /prices/current error (pre-auth):', e && e.message ? e.message : e);
    return res.json({ errno: 0, result: [] });
  }
});

// Amber prices (standard endpoint) - Allow unauthenticated access (returns empty if no user)
app.get('/api/amber/prices', async (req, res) => {
  try {
    await tryAttachUser(req);
    const userId = req.user?.uid;
    
    if (!userId) {
      // No user signed in - safe empty response for UI
      return res.json({ errno: 0, result: [] });
    }

    const userConfig = await getUserConfig(userId);
    if (!userConfig || !userConfig.amberApiKey) {
      return res.status(400).json({ errno: 400, error: 'Amber not configured', result: [] });
    }
    const siteId = req.query.siteId;
    
    if (!siteId) {
      return res.status(400).json({ errno: 400, error: 'Site ID is required' });
    }
    // If the caller provided startDate/endDate, treat this as a historical range
    // request and use intelligent caching to avoid repeated API calls.
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    if (startDate || endDate) {
      const resolution = req.query.resolution || 30;
      
      console.log(`[Prices] Fetching historical prices with caching for ${siteId}:`, {
        startDate,
        endDate,
        resolution
      });
      
      const result = await fetchAmberHistoricalPricesWithCache(siteId, startDate, endDate, resolution, userConfig, userId);
      return res.json(result);
    }

    // Default behavior: return the current forecast/prices
    const result = await callAmberAPI(`/sites/${encodeURIComponent(siteId)}/prices/current`, { next: 1 }, userConfig, userId);
    res.json(result);
  } catch (error) {
    console.warn('[Amber] Error fetching prices:', error.message);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Metrics (platform global or per-user). Allow unauthenticated callers to read global metrics by default.
app.get('/api/metrics/api-calls', async (req, res) => {
  // Parse days outside try block so it's available in catch
  const days = Math.max(1, Math.min(30, parseInt(req.query.days || '7', 10)));
  
  try {
    // Attach optional user (don't require auth globally here)
    await tryAttachUser(req);

    const scope = String(req.query.scope || 'global');

    if (!db) {
      console.warn('[Metrics] Firestore not initialized - returning zeroed metrics');
      const result = {};
      const endDate = new Date();
      for (let i = 0; i < days; i++) {
        const d = new Date(endDate);
        d.setDate(d.getDate() - i);
        const key = getAusDateKey(d);
        result[key] = { foxess: 0, amber: 0, weather: 0 };
      }
      return res.json({ errno: 0, result });
    }

    const endDate = new Date();

    if (scope === 'user') {
      const userId = req.user?.uid;
      if (!userId) return res.status(401).json({ errno: 401, error: 'Unauthorized: user scope requested' });

      const metricsSnapshot = await db.collection('users').doc(userId)
        .collection('metrics')
        .orderBy(admin.firestore.FieldPath.documentId(), 'desc')
        .limit(days)
        .get();

      const result = {};
      metricsSnapshot.forEach(doc => {
        const d = doc.data() || {};
        result[doc.id] = {
          foxess: Number(d.foxess || 0),
          amber: Number(d.amber || 0),
          weather: Number(d.weather || 0)
        };
      });

      // Fill in missing days with zeros (Australia/Sydney local date)
      for (let i = 0; i < days; i++) {
        const d = new Date(endDate);
        d.setDate(d.getDate() - i);
        const key = getAusDateKey(d);
        if (!result[key]) result[key] = { foxess: 0, amber: 0, weather: 0 };
      }

      return res.json({ errno: 0, result });
    }

    // Global scope: read top-level `metrics` collection for each date
    const result = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(endDate);
      d.setDate(d.getDate() - i);
      const key = getAusDateKey(d);

      const doc = await db.collection('metrics').doc(key).get();
      const data = doc.exists ? doc.data() : null;
      result[key] = {
        foxess: Number(data?.foxess || 0),
        amber: Number(data?.amber || 0),
        weather: Number(data?.weather || 0)
      };
    }

    res.json({ errno: 0, result });
  } catch (error) {
    console.error('[Metrics] Error in /api/metrics/api-calls (pre-auth):', error && error.message);
    const result = {};
    const endDate = new Date();
    for (let i = 0; i < days; i++) {
      const d = new Date(endDate);
      d.setDate(d.getDate() - i);
      const key = getAusDateKey(d);
      result[key] = { foxess: 0, amber: 0, weather: 0 };
    }
    return res.json({ errno: 0, result });
  }
});

// Apply auth middleware to remaining API routes
app.use('/api', authenticateUser);

// ==================== PROTECTED ENDPOINTS (After Auth Middleware) ====================

// Health check with auth
app.get('/api/health/auth', (req, res) => {
  res.json({ ok: true, user: req.user.uid });
});

// ==================== HELPER FUNCTIONS ====================

/**
 * Generate FoxESS API signature
 * NOTE: FoxESS expects literal backslash-r-backslash-n characters, NOT actual CRLF bytes
 * This matches the Postman collection which uses escaped \\r\\n
 */
function generateFoxESSSignature(apiPath, token, timestamp) {
  // See CONFIGURATION.md -> "FoxESS API authentication / signature" for examples (curl, PowerShell, Node.js) and troubleshooting tips.

  const signaturePlain = `${apiPath}\\r\\n${token}\\r\\n${timestamp}`;
  const signature = crypto.createHash('md5').update(signaturePlain).digest('hex');
  console.log(`[FoxESS] Signature calc: path="${apiPath}" token="${token}" timestamp="${timestamp}"`);
  console.log(`[FoxESS] Plain text (length=${signaturePlain.length}): ${JSON.stringify(signaturePlain)}`);
  console.log(`[FoxESS] Generated signature: ${signature}`);
  return signature;
}

/**
 * Call FoxESS API with user's credentials
 */
async function callFoxESSAPI(apiPath, method = 'GET', body = null, userConfig, userId = null) {
  const config = getConfig();
  let token = userConfig?.foxessToken || config.foxess.token;
  
  if (!token) {
    return { errno: 401, error: 'FoxESS token not configured' };
  }
  
  // Clean token - remove whitespace per Postman collection
  if (typeof token === 'string') {
    token = token.trim().replace(/\s+/g, '').replace(/[^\x20-\x7E]/g, '');
  }
  
  // Track API call if userId provided
  if (userId) {
    incrementApiCount(userId, 'foxess').catch(() => {});
  }
  
  try {
    const timestamp = Date.now();
    
    // Split apiPath into base path and query string for signature calculation
    // Signature should be calculated on the path WITHOUT query parameters
    const [basePath, queryString] = apiPath.split('?');
    const signature = generateFoxESSSignature(basePath, token, timestamp);
    
    const url = new URL(`${config.foxess.baseUrl}${apiPath}`);
    
    const options = {
      method: method,
      headers: {
        'token': token,
        'timestamp': timestamp.toString(),
        'signature': signature,
        'lang': 'en',
        'Content-Type': 'application/json'
      }
    };
    
    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    options.signal = controller.signal;
    
    console.log(`[FoxESS] Calling ${method} ${url.toString()} with signature ${signature}`);
    const response = await fetch(url, options);
    clearTimeout(timeout);
    const text = await response.text();
    
    console.log(`[FoxESS] Response status: ${response.status}, body length: ${text.length}, content: ${text.slice(0, 500)}`);
    
    try {
      return JSON.parse(text);
    } catch (err) {
      return { errno: -1, msg: 'Non-JSON response', raw: text };
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      return { errno: 408, msg: 'Request timeout' };
    }
    console.error(`[FoxESS] Error calling API: ${error.message}`);
    return { errno: 500, msg: error.message };
  }
}

/**
 * Call Amber API
 */

/**
 * Get cached Amber sites list from Firestore.
 * Per-user cache stored at users/{userId}/cache/amber_sites
 * TTL: 7 days (sites rarely change)
 */
async function getCachedAmberSites(userId) {
  try {
    if (!userId) return null;
    
    const cacheDoc = await db.collection('users').doc(userId).collection('cache').doc('amber_sites').get();
    if (!cacheDoc.exists) {
      console.log(`[Cache] No sites cache found for ${userId}`);
      return null;
    }
    
    const cached = cacheDoc.data();
    const cacheAge = Date.now() - (cached.cachedAt?.toMillis?.() || 0);
    const cacheTTL = 7 * 24 * 60 * 60 * 1000; // 7 days
    
    if (cacheAge > cacheTTL) {
      console.log(`[Cache] Sites cache expired for ${userId} (age: ${Math.round(cacheAge / 1000)}s)`);
      return null;
    }
    
    console.log(`[Cache] Using cached sites for ${userId} (age: ${Math.round(cacheAge / 1000)}s)`);
    return cached.sites || [];
  } catch (e) {
    console.error(`[Cache] Error reading sites cache for ${userId}:`, e.message);
    return null;
  }
}

/**
 * Store Amber sites list in Firestore cache.
 * Per-user cache stored at users/{userId}/cache/amber_sites
 */
async function cacheAmberSites(userId, sites) {
  try {
    if (!userId || !sites) return;
    
    await db.collection('users').doc(userId).collection('cache').doc('amber_sites').set({
      sites,
      cachedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`[Cache] Stored ${sites.length} sites in cache for ${userId}`);
  } catch (e) {
    console.error(`[Cache] Error storing sites cache for ${userId}:`, e.message);
  }
}

/**
 * Get cached Amber price data from Firestore for a given date range.
 * Per-user cache stored at users/{userId}/cache/amber_{siteId}
 * Returns prices that fall within [startDate, endDate] inclusive.
 */
async function getCachedAmberPrices(siteId, startDate, endDate, userId) {
  try {
    if (!userId) {
      console.warn(`[Cache] No userId provided for Amber cache lookup`);
      return [];
    }
    
    const cacheRef = db.collection('users').doc(userId).collection('cache').doc('amber_' + siteId);
    const snap = await cacheRef.get();
    
    if (!snap.exists) {
      console.log(`[Cache] No cached data found for user ${userId}, site ${siteId}`);
      return [];
    }
    
    const cached = snap.data().prices || [];
    
    // Parse dates to include full day range
    const startMs = new Date(startDate + 'T00:00:00Z').getTime();
    const endMs = new Date(endDate + 'T23:59:59.999Z').getTime();
    
    // Filter prices within the requested range (inclusive of both start and end dates)
    const filtered = cached.filter(p => {
      const priceMs = new Date(p.startTime).getTime();
      return priceMs >= startMs && priceMs <= endMs;
    });
    
    console.log(`[Cache] Found ${cached.length} cached prices total for user ${userId}, ${filtered.length} in requested range [${startDate} to ${endDate}]`);
    return filtered;
  } catch (error) {
    console.warn(`[Cache] Error reading prices for user ${userId}, site ${siteId}:`, error.message);
    return [];
  }
}

/**
 * Find gaps in coverage between startDate and endDate.
 * Returns array of { start, end } objects for gaps that need API calls.
 * Improved to detect proper date coverage, not just large time gaps.
 */
function findGaps(startDate, endDate, existingPrices) {
  const gaps = [];
  const startMs = new Date(startDate + 'T00:00:00Z').getTime();
  const endMs = new Date(endDate + 'T23:59:59Z').getTime();
  
  console.log(`[Cache] findGaps: looking for gaps between ${startDate} and ${endDate}, have ${existingPrices.length} cached prices`);
  console.log(`[Cache] findGaps time range: ${startMs} to ${endMs}`);
  
  if (existingPrices.length === 0) {
    gaps.push({ start: startDate, end: endDate });
    console.log(`[Cache] No cached prices - entire range is a gap`);
    return gaps;
  }
  
  // Sort prices by startTime
  const sorted = [...existingPrices].sort((a, b) => 
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
  
  // Get the actual date range of cached prices
  const firstPriceMs = new Date(sorted[0].startTime).getTime();
  const lastPriceMs = new Date(sorted[sorted.length - 1].startTime).getTime();
  
  // Get dates (YYYY-MM-DD) from cached price range
  const firstCachedDate = sorted[0].startTime.split('T')[0];
  const lastCachedDate = sorted[sorted.length - 1].startTime.split('T')[0];
  
  console.log(`[Cache] Cached date range: ${firstCachedDate} to ${lastCachedDate} (ms: ${firstPriceMs} to ${lastPriceMs})`);
  console.log(`[Cache] Requested date range: ${startDate} to ${endDate}`);
  console.log(`[Cache] String comparison: startDate < firstCached? ${startDate} < ${firstCachedDate} = ${startDate < firstCachedDate}`);
  console.log(`[Cache] String comparison: endDate > lastCached? ${endDate} > ${lastCachedDate} = ${endDate > lastCachedDate}`);
  
  // Check if we need data before the first cached date
  if (startDate < firstCachedDate) {
    // Need dates before cached range
    const gapEnd = new Date(new Date(firstCachedDate).getTime() - 86400000).toISOString().split('T')[0];
    gaps.push({ start: startDate, end: gapEnd });
    console.log(`[Cache] Gap before cached data: ${startDate} to ${gapEnd}`);
  }
  
  // Check if we need data after the last cached date
  if (endDate > lastCachedDate) {
    // Need dates after cached range
    const gapStart = new Date(new Date(lastCachedDate).getTime() + 86400000).toISOString().split('T')[0];
    gaps.push({ start: gapStart, end: endDate });
    console.log(`[Cache] Gap after cached data: ${gapStart} to ${endDate}`);
  }
  
  console.log(`[Cache] Total gaps found: ${gaps.length}`);
  return gaps;
}

/**
 * Cache Amber prices in Firestore for persistent storage.
 * Per-user cache stored at users/{userId}/cache/amber_{siteId}
 * Merges new prices with existing cached prices.
 * Historical prices are cached for 180 days (6 months) since they don't change.
 */
async function cacheAmberPrices(siteId, newPrices, userId) {
  try {
    if (!userId) {
      console.warn(`[Cache] No userId provided for Amber cache storage`);
      return;
    }
    
    const cacheRef = db.collection('users').doc(userId).collection('cache').doc('amber_' + siteId);
    const snap = await cacheRef.get();
    
    const existing = snap.exists ? (snap.data().prices || []) : [];
    
    // Merge: remove duplicates by (startTime, channelType) composite key
    const priceMap = new Map();
    
    // Add existing prices
    existing.forEach(p => {
      const key = `${p.startTime}|${p.channelType}`;
      priceMap.set(key, p);
    });
    
    // Add/override with new prices
    newPrices.forEach(p => {
      const key = `${p.startTime}|${p.channelType}`;
      priceMap.set(key, p);
    });
    
    const merged = Array.from(priceMap.values());
    
    // Sort by startTime for consistency
    merged.sort((a, b) => 
      new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
    
    console.log(`[Cache] Storing ${merged.length} total prices for user ${userId}, site ${siteId} (${newPrices.length} new prices added)`);
    
    await cacheRef.set({
      siteId,
      prices: merged,
      lastUpdated: new Date().toISOString(),
      priceCount: merged.length,
      ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // Firestore TTL in seconds (30 days)
    });
  } catch (error) {
    console.warn(`[Cache] Error caching prices for user ${userId}, site ${siteId}:`, error.message);
  }
}

/**
 * Split a date range into chunks for API calls.
 * Amber API limit appears to be ~14 days per request.
 * Returns array of { start, end } objects.
 */
function splitRangeIntoChunks(startDate, endDate, maxDaysPerChunk = 14) {
  const chunks = [];
  
  // Parse dates properly to avoid timezone shifts
  const [startY, startM, startD] = startDate.split('-').map(Number);
  const [endY, endM, endD] = endDate.split('-').map(Number);
  
  let currentStart = new Date(startY, startM - 1, startD);
  const end = new Date(endY, endM - 1, endD);
  
  while (currentStart <= end) {
    let currentEnd = new Date(currentStart);
    currentEnd.setDate(currentEnd.getDate() + maxDaysPerChunk - 1); // -1 because range is inclusive
    
    if (currentEnd > end) {
      currentEnd = end;
    }
    
    // Format as YYYY-MM-DD manually to avoid UTC conversion
    const formatDate = (d) => {
      return d.getFullYear() + '-' + 
             String(d.getMonth() + 1).padStart(2, '0') + '-' + 
             String(d.getDate()).padStart(2, '0');
    };
    
    chunks.push({
      start: formatDate(currentStart),
      end: formatDate(currentEnd)
    });
    
    currentStart = new Date(currentEnd);
    currentStart.setDate(currentStart.getDate() + 1);
  }
  
  return chunks;
}

/**
 * Fetch Amber historical prices with intelligent caching.
 * - Checks Firestore for existing per-user data
 * - Only fetches gaps from API
 * - Merges cached + new data
 * - Returns complete dataset for the requested range
 */
async function fetchAmberHistoricalPricesWithCache(siteId, startDate, endDate, resolution, userConfig, userId) {
  console.log(`[Cache] Fetching prices with cache for user ${userId}, ${siteId}:`, { startDate, endDate, resolution });
  
  // Step 1: Get cached prices (per-user cache)
  const cachedPrices = await getCachedAmberPrices(siteId, startDate, endDate, userId);
  console.log(`[Cache] Found ${cachedPrices.length} cached prices in range`);
  
  // Step 2: Check if we have BOTH channels for the full range
  const channelCounts = {};
  cachedPrices.forEach(p => {
    channelCounts[p.channelType] = (channelCounts[p.channelType] || 0) + 1;
  });
  const hasGeneral = channelCounts['general'] || 0;
  const hasFeedin = channelCounts['feedIn'] || 0;
  console.log(`[Cache] Cached channels - general: ${hasGeneral}, feedIn: ${hasFeedin}`);
  
  // If either channel is completely missing, treat entire range as gap to force fresh fetch
  // But if both exist, use normal gap detection (they may naturally have different counts)
  let gaps = [];
  if (!hasGeneral || !hasFeedin) {
    console.log(`[Cache] Missing channels (general: ${hasGeneral}, feedIn: ${hasFeedin}), fetching full range fresh`);
    gaps = [{ start: startDate, end: endDate }];
  } else {
    // Both channels present, use normal gap detection
    console.log(`[Cache] Both channels present (general: ${hasGeneral}, feedIn: ${hasFeedin}), checking for gaps`);
    gaps = findGaps(startDate, endDate, cachedPrices);
  }
  
  console.log(`[Cache] Found ${gaps.length} gaps to fetch from API`);
  
  let newPrices = [];
  
  // Step 3: Fetch gaps from API (split into 30-day chunks)
  if (gaps.length > 0) {
    // Increment API counter once per cache miss (not per chunk)
    console.log(`[Cache] Cache miss detected: ${gaps.length} gaps found, incrementing counter`);
    if (userId) {
      incrementApiCount(userId, 'amber').catch(() => {});
    }
    
    for (const gap of gaps) {
      const chunks = splitRangeIntoChunks(gap.start, gap.end, 30);
      console.log(`[Cache] Fetching gap ${gap.start} to ${gap.end} in ${chunks.length} chunk(s)`);
      
      for (const chunk of chunks) {
        console.log(`[Cache] Fetching chunk: ${chunk.start} to ${chunk.end}`);
        
        // Call Amber API directly (skip counter since we track at cache level)
        const result = await callAmberAPI(`/sites/${encodeURIComponent(siteId)}/prices`, {
          startDate: chunk.start,
          endDate: chunk.end,
          resolution: resolution || 30
        }, userConfig, userId, true); // skipCounter = true
        
        // Handle error responses (have errno property)
        if (result && result.errno && result.errno !== 0) {
          console.warn(`[Cache] API error for chunk ${chunk.start} to ${chunk.end}:`, result.error);
          // Don't fail entirely; continue with what we have
          continue;
        }
        
        // Extract prices from result
        // Amber API returns raw array on success, but we might have wrapped it
        let prices = [];
        if (Array.isArray(result)) {
          // Direct array from Amber
          prices = result;
        } else if (result && Array.isArray(result.result)) {
          // Wrapped response
          prices = result.result;
        } else if (result && result.data && Array.isArray(result.data)) {
          // Alternative wrapper
          prices = result.data;
        }
        
        // Debug: log channel types in this chunk
        const channelCounts = {};
        prices.forEach(p => {
          channelCounts[p.channelType] = (channelCounts[p.channelType] || 0) + 1;
        });
        console.log(`[Cache] Chunk ${chunk.start} to ${chunk.end} returned ${prices.length} prices - channels:`, channelCounts);
        
        // Log first and last timestamp to verify date range
        if (prices.length > 0) {
          const sortedPrices = prices.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
          console.log(`[Cache] Chunk actual date range: ${sortedPrices[0].startTime} to ${sortedPrices[sortedPrices.length - 1].startTime}`);
        }
        
        newPrices = newPrices.concat(prices);
      }
    }
  }
  
  // Step 4: Cache the new prices (per-user cache)
  if (newPrices.length > 0) {
    await cacheAmberPrices(siteId, newPrices, userId);
  }
  
  // Step 5: Return merged result (cached + new)
  const allPrices = [...cachedPrices, ...newPrices];
  
  // Remove duplicates by (startTime, channelType) composite key and sort
  const priceMap = new Map();
  allPrices.forEach(p => {
    const key = `${p.startTime}|${p.channelType}`;
    priceMap.set(key, p);
  });
  
  const finalPrices = Array.from(priceMap.values());
  finalPrices.sort((a, b) => 
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
  
  // Debug: log final channel breakdown
  const finalChannels = {};
  finalPrices.forEach(p => {
    finalChannels[p.channelType] = (finalChannels[p.channelType] || 0) + 1;
  });
  console.log(`[Cache] Final result: ${finalPrices.length} total prices (${cachedPrices.length} from cache, ${newPrices.length} from API) - channels:`, finalChannels);
  
  return { 
    errno: 0, 
    result: finalPrices,
    _cacheInfo: {
      total: finalPrices.length,
      fromCache: cachedPrices.length,
      fromAPI: newPrices.length,
      cacheHitRate: finalPrices.length > 0 ? Math.round((cachedPrices.length / finalPrices.length) * 100) : 0
    }
  };
}

async function callAmberAPI(path, queryParams = {}, userConfig, userId = null, skipCounter = false) {
  const config = getConfig();
  const apiKey = userConfig?.amberApiKey || config.amber.apiKey;
  
  if (!apiKey) {
    return { errno: 401, error: 'Amber API key not configured' };
  }
  
  // Check if we're rate-limited
  if (amberRateLimitState.retryAfter > Date.now()) {
    return { errno: 429, error: `Rate limited by Amber API. Retry after ${new Date(amberRateLimitState.retryAfter).toISOString()}`, retryAfter: amberRateLimitState.retryAfter };
  }
  
  // Track API call if userId provided (unless caller is handling it, like cache logic)
  if (userId && !skipCounter) {
    console.log(`[Amber] callAmberAPI incrementing counter (skipCounter=${skipCounter})`);
    incrementApiCount(userId, 'amber').catch(() => {});
  }
  
  const url = new URL(`${config.amber.baseUrl}${path}`);
  Object.keys(queryParams).forEach(k => {
    if (queryParams[k] !== undefined && queryParams[k] !== null) {
      url.searchParams.set(k, String(queryParams[k]));
    }
  });
  
  console.log(`[Amber] Full URL being called: ${url.toString()}`);
  console.log(`[Amber] Query params object:`, queryParams);
  
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Accept': 'application/json'
  };
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const resp = await fetch(url.toString(), { headers, signal: controller.signal });
    clearTimeout(timeout);
    const text = await resp.text();
    
    console.log(`[Amber] ${path} - HTTP ${resp.status}, Content-Type: ${resp.headers.get('content-type')}, Length: ${text.length}`);
    
    // Handle rate limiting (429 Too Many Requests)
    if (resp.status === 429) {
      const retryAfterHeader = resp.headers.get('retry-after');
      const delaySeconds = retryAfterHeader ? parseInt(retryAfterHeader) : 60;
      const delayMs = delaySeconds * 1000;
      amberRateLimitState.retryAfter = Date.now() + delayMs;
      amberRateLimitState.lastError = `Rate limited: retry after ${delaySeconds}s`;
      console.warn('[Amber] Rate limited (429). Retry after:', delaySeconds, 'seconds');
      return { errno: 429, error: `Rate limited. Retry after ${delaySeconds}s`, retryAfter: amberRateLimitState.retryAfter };
    }
    
    // Handle other HTTP errors
    if (!resp.ok) {
      console.warn(`[Amber] HTTP ${resp.status} Error:`, {
        statusText: resp.statusText,
        contentType: resp.headers.get('content-type'),
        responseText: text.substring(0, 1000)
      });
      return { errno: resp.status, error: `HTTP ${resp.status}: ${resp.statusText}` };
    }
    
    // Clear rate limit on success
    if (resp.status === 200) {
      amberRateLimitState.retryAfter = 0;
    }
    
    try {
      const json = JSON.parse(text);
      console.log(`[Amber] Successfully parsed JSON response from ${path}`);
      return json;
    } catch (e) {
      console.warn(`[Amber] Failed to parse JSON from ${path}:`, e.message, 'Response preview:', text.substring(0, 500));
      return { errno: 500, error: 'Invalid JSON response from Amber API', details: text.substring(0, 200) };
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      return { errno: 408, error: 'Request timeout' };
    }
    return { errno: 500, error: error.message };
  }
}

/**
 * Call Weather API (Open-Meteo)
 * Fetches extended forecast with solar radiation, cloud cover, and other useful fields
 * Max forecast_days is 16 for Open-Meteo free tier
 */
async function callWeatherAPI(place = 'Sydney', days = 16, userId = null) {
  // Track API call if userId provided
  if (userId) {
    incrementApiCount(userId, 'weather').catch(() => {});
  }
  
  // Clamp days to Open-Meteo max of 16
  const forecastDays = Math.min(Math.max(1, days), 16);
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // Increased timeout for larger payload
    
    // Geocode place - request 5 results to handle ambiguous names across countries
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=5&language=en`;
    const geoResp = await fetch(geoUrl, { signal: controller.signal });
    const geoJson = await geoResp.json();
    
    let latitude, longitude, resolvedName, country, fallback = false, fallbackReason = '', fallbackResolvedName = '';
    if (geoJson?.results?.length > 0) {
      // Prioritize Australian locations to handle cases like "Narara" (AU vs Fiji)
      const auResult = geoJson.results.find(r => r.country_code === 'AU');
      const selectedResult = auResult || geoJson.results[0];
      
      latitude = selectedResult.latitude;
      longitude = selectedResult.longitude;
      resolvedName = selectedResult.name;
      country = selectedResult.country;
      console.log(`[Weather] Geocoded "${place}" to "${resolvedName}, ${country}" (${latitude}, ${longitude})`);
    } else {
      // Fallback to Sydney when geocoding returns no results
      fallback = true;
      fallbackReason = 'location_not_found';
      fallbackResolvedName = 'Sydney NSW';
      latitude = -33.9215;
      longitude = 151.0390;
      resolvedName = place;
      country = 'AU';
      console.log(`[Weather] Geocoding failed for "${place}" - falling back to Sydney (${latitude}, ${longitude})`);
    }
    
    // Extended hourly variables including solar radiation and cloud cover
    const hourlyVars = [
      'temperature_2m',
      'precipitation',
      'precipitation_probability',
      'weathercode',
      'shortwave_radiation',      // Solar irradiance W/m² - key for PV production
      'direct_radiation',         // Direct solar radiation W/m²
      'diffuse_radiation',        // Diffuse solar radiation W/m²
      'cloudcover',               // Total cloud cover %
      'windspeed_10m',
      'relativehumidity_2m',
      'uv_index'
    ].join(',');
    
    // Extended daily variables including sunrise/sunset
    const dailyVars = [
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
      'weathercode',
      'shortwave_radiation_sum',  // Total daily solar radiation MJ/m²
      'uv_index_max',
      'sunrise',
      'sunset',
      'precipitation_probability_max'
    ].join(',');
    
    // Get forecast with extended variables
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=${hourlyVars}&daily=${dailyVars}&current_weather=true&temperature_unit=celsius&timezone=auto&forecast_days=${forecastDays}`;
    const forecastResp = await fetch(forecastUrl, { signal: controller.signal });
    const forecastJson = await forecastResp.json();
    clearTimeout(timeout);
    
    return {
      errno: 0,
      result: {
        source: 'open-meteo',
        place: {
          query: place,
          resolvedName,
          country,
          latitude,
          longitude,
          fallback,
          fallbackReason,
          fallbackResolvedName
        },
        current: forecastJson.current_weather || null,
        hourly: forecastJson.hourly || null,
        daily: forecastJson.daily || null,
        raw: forecastJson,
        forecastDays: forecastDays
      }
    };
  } catch (error) {
    return { errno: 500, error: error.message };
  }
}

/**
 * Cache weather data in Firestore (per-user)
 * TTL: 30 minutes
 */
async function getCachedWeatherData(userId, place = 'Sydney', days = 16) {
  const config = getConfig();
  const ttlMs = config.automation.cacheTtl.weather; // 30 minutes
  
  try {
    const cacheDoc = await db.collection('users').doc(userId).collection('cache').doc('weather').get();
    
    if (cacheDoc.exists) {
      const { data, timestamp, cachedDays, cachedPlace } = cacheDoc.data();
      const ageMs = Date.now() - timestamp;
      const cachedDayCount = data?.result?.daily?.time?.length || 0;
      
      // Compare places case-insensitively and handle undefined/null
      const placesMatch = (cachedPlace || '').toLowerCase().trim() === (place || '').toLowerCase().trim();
      
      // Validate cache is still fresh AND has enough days AND is for the same place
      // Use cache if it has >= requested days (e.g., cached 7 days can serve a request for 6 days)
      if (ageMs < ttlMs && cachedDays >= days && placesMatch && cachedDayCount >= days) {
        console.log(`[Cache] Weather HIT - age: ${Math.round(ageMs/1000)}s, cached ${cachedDays} days, requested ${days}, place: ${cachedPlace}`);
        return { ...data, __cacheHit: true, __cacheAgeMs: ageMs, __cacheTtlMs: ttlMs };
      } else {
        console.log(`[Cache] Weather MISS - TTL ok=${ageMs < ttlMs}, enough days=${cachedDays >= days} (cached=${cachedDays}, requested=${days}), place match=${placesMatch} (cached="${cachedPlace}", requested="${place}"), data count=${cachedDayCount}`);
      }
    } else {
      console.log(`[Cache] No cached weather data - fetching fresh`);
    }
    
    // Fetch fresh data from Open-Meteo
    const data = await callWeatherAPI(place, days, userId);
    
    // Store in cache if successful
    // NOTE: Only store the daily data and metadata, not full hourly (reduces Firestore document size)
    if (data?.errno === 0) {
      const cacheData = {
        errno: data.errno,
        result: {
          source: data.result?.source,
          place: data.result?.place,
          current: data.result?.current,
          daily: data.result?.daily,  // Include daily forecast
          hourly: data.result?.hourly,  // Include hourly forecast
          forecastDays: data.result?.forecastDays
        }
      };
      await db.collection('users').doc(userId).collection('cache').doc('weather').set({
        data: cacheData,
        timestamp: Date.now(),
        ttlMs,
        cachedPlace: place,  // Store the place parameter exactly as received for comparison
        cachedDays: days,  // Store requested days for cache validation
        ttl: Math.floor(Date.now() / 1000) + Math.floor(ttlMs / 1000) // Firestore TTL in seconds
      }, { merge: true }).catch(cacheErr => {
        console.warn(`[Cache] Failed to store weather cache: ${cacheErr.message}`);
      });
      console.log(`[Cache] Stored fresh weather data in cache (TTL: ${ttlMs}ms, stored days: ${data.result?.daily?.time?.length || 0}, place: ${place})`);
    }
    
    return { ...data, __cacheHit: false, __cacheAgeMs: 0, __cacheTtlMs: ttlMs };
  } catch (err) {
    console.error(`[Cache] Error in getCachedWeatherData: ${err.message}`);
    return { errno: 500, error: err.message };
  }
}

/**
 * Get user config from Firestore
 */
async function getUserConfig(userId) {
  try {
    console.log(`[Config] Loading config for user: ${userId}`);
    
    // Primary location: users/{uid}/config/main (newer code)
    const configDoc = await db.collection('users').doc(userId).collection('config').doc('main').get();
    if (configDoc.exists) {
      const data = configDoc.data() || {};
      console.log(`[Config] Found config at users/${userId}/config/main:`, { hasDeviceSn: !!data.deviceSn, hasFoxessToken: !!data.foxessToken });
      return { ...data, _source: 'config-main' };
    }
    console.log(`[Config] No config at users/${userId}/config/main`);

    // Backward compatibility: older deployments stored credentials directly on users/{uid}.credentials
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      const data = userDoc.data() || {};
      console.log(`[Config] Found user doc for ${userId}, has credentials?`, !!data.credentials);
      
      // If the older 'credentials' object exists, map its snake_case fields to the config shape
        if (data.credentials && (data.credentials.device_sn || data.credentials.foxess_token || data.credentials.amber_api_key)) {
        console.log(`[Config] Found legacy credentials for ${userId}`);
        return {
          deviceSn: data.credentials.device_sn || '',
          foxessToken: data.credentials.foxess_token || '',
          amberApiKey: data.credentials.amber_api_key || '',
          // No explicit setupComplete flag in old storage — consider presence of tokens as complete
          setupComplete: !!(data.credentials.device_sn && data.credentials.foxess_token),
          _source: 'legacy-credentials'
        };
      }

      // If top-level config keys exist directly on the user doc, use them too
      if (data.deviceSn || data.foxessToken || data.amberApiKey) {
        console.log(`[Config] Found top-level config keys for ${userId}`);
        return {
          deviceSn: data.deviceSn || '',
          foxessToken: data.foxessToken || '',
          amberApiKey: data.amberApiKey || '',
          setupComplete: !!(data.deviceSn && data.foxessToken),
          _source: 'user-top-level'
        };
      }
    }
    
    console.log(`[Config] No config found for user ${userId}`);
    return null;
  } catch (error) {
    console.error('Error getting user config:', error);
    return null;
  }
}

/**
 * Get user automation state from Firestore
 */
async function getUserAutomationState(userId) {
  try {
    const stateDoc = await db.collection('users').doc(userId).collection('automation').doc('state').get();
    if (stateDoc.exists) {
      return stateDoc.data();
    }
    return {
      enabled: true,
      lastCheck: null,
      lastTriggered: null,
      activeRule: null
    };
  } catch (error) {
    console.error('Error getting automation state:', error);
    return null;
  }
}

/**
 * Save user automation state to Firestore
 */
async function saveUserAutomationState(userId, state) {
  try {
    await db.collection('users').doc(userId).collection('automation').doc('state').set(state, { merge: true });
    return true;
  } catch (error) {
    console.error('Error saving automation state:', error);
    return false;
  }
}

/**
 * Get user automation rules from Firestore
 */
async function getUserRules(userId) {
  try {
    const rulesSnapshot = await db.collection('users').doc(userId).collection('rules').get();
    const rules = {};
    rulesSnapshot.forEach(doc => {
      rules[doc.id] = doc.data();
    });
    return rules;
  } catch (error) {
    console.error('Error getting user rules:', error);
    return {};
  }
}

/**
 * Add entry to user history
 */
async function addHistoryEntry(userId, entry) {
  try {
    await db.collection('users').doc(userId).collection('history').add({
      ...entry,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    return true;
  } catch (error) {
    console.error('Error adding history entry:', error);
    return false;
  }
}

// ==================== API ENDPOINTS ====================

// Get user config
app.get('/api/config', async (req, res) => {
  try {
    if (!req.user || !req.user.uid) {
      return res.status(401).json({ errno: 401, error: 'Unauthorized' });
    }
    const config = await getUserConfig(req.user.uid);
    res.json({ errno: 0, result: config || {} });
  } catch (error) {
    console.error('[Config] Error getting user config:', error.message);
    // Return safe empty config instead of 500 error
    res.json({ errno: 0, result: {} });
  }
});

// Save user config
app.post('/api/config', async (req, res) => {
  try {
    // Accept both shapes: { config: {...} } (older functions API) or raw config object in body
    const newConfig = req.body && typeof req.body === 'object' ? (req.body.config ?? req.body) : null;
    if (!newConfig || typeof newConfig !== 'object') {
      return res.status(400).json({ errno: 400, error: 'Invalid payload: expected config object' });
    }

    console.log('[API] /api/config save called by user:', req.user?.uid, 'payloadKeys=', Object.keys(newConfig || {}).slice(0,20));

    // Persist to Firestore under user's config/main
    await db.collection('users').doc(req.user.uid).collection('config').doc('main').set(newConfig, { merge: true });
    res.json({ errno: 0, msg: 'Config saved', result: newConfig });
  } catch (error) {
    console.error('[API] /api/config save error:', error && error.stack ? error.stack : String(error));
    res.status(500).json({ errno: 500, error: error.message || String(error) });
  }
});

// Clear credentials (clear deviceSN, foxessToken, amberApiKey from user config)
app.post('/api/config/clear-credentials', authenticateUser, async (req, res) => {
  try {
    console.log('[API] /api/config/clear-credentials called by user:', req.user.uid);

    const updates = {
      deviceSn: admin.firestore.FieldValue.delete(),
      foxessToken: admin.firestore.FieldValue.delete(),
      amberApiKey: admin.firestore.FieldValue.delete(),
      setupComplete: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Update the user's config/main document to clear these fields
    await db.collection('users').doc(req.user.uid).collection('config').doc('main').update(updates);
    
    res.json({ errno: 0, msg: 'Credentials cleared successfully' });
  } catch (error) {
    console.error('[API] /api/config/clear-credentials error:', error && error.stack ? error.stack : String(error));
    res.status(500).json({ errno: 500, error: error.message || String(error) });
  }
});

// Get automation state
app.get('/api/automation/status', async (req, res) => {
  try {
    const state = await getUserAutomationState(req.user.uid);
    const rules = await getUserRules(req.user.uid);
    const userConfig = await getUserConfig(req.user.uid);
    
    // Check for blackout windows
    const blackoutWindows = userConfig?.automation?.blackoutWindows || [];
    const sydney = getSydneyTime();
    const currentMinutes = sydney.hour * 60 + sydney.minute;
    
    let inBlackout = false;
    let currentBlackoutWindow = null;
    for (const window of blackoutWindows) {
      if (!window.enabled) continue;
      const [startH, startM] = (window.start || '00:00').split(':').map(Number);
      const [endH, endM] = (window.end || '00:00').split(':').map(Number);
      const startMins = startH * 60 + startM;
      const endMins = endH * 60 + endM;
      
      // Handle windows that cross midnight
      if (startMins <= endMins) {
        if (currentMinutes >= startMins && currentMinutes < endMins) {
          inBlackout = true;
          currentBlackoutWindow = window;
          break;
        }
      } else {
        if (currentMinutes >= startMins || currentMinutes < endMins) {
          inBlackout = true;
          currentBlackoutWindow = window;
          break;
        }
      }
    }
    
    res.json({
      errno: 0,
      result: {
        ...state,
        rules,
        serverTime: Date.now(),
        nextCheckIn: getConfig().automation.intervalMs,
        inBlackout,
        currentBlackoutWindow
      }
    });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Toggle automation
app.post('/api/automation/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;
    await saveUserAutomationState(req.user.uid, { enabled: !!enabled });
    res.json({ errno: 0, result: { enabled: !!enabled } });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Backwards-compatible alias: some frontends call /api/automation/enable
app.post('/api/automation/enable', async (req, res) => {
  try {
    const { enabled } = req.body;
    await saveUserAutomationState(req.user.uid, { enabled: !!enabled });
    res.json({ errno: 0, result: { enabled: !!enabled } });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Manually trigger a rule (for testing) - applies the rule's action immediately
app.post('/api/automation/trigger', async (req, res) => {
  try {
    const { ruleName } = req.body;
    
    if (!ruleName) {
      return res.status(400).json({ errno: 400, error: 'Rule name is required' });
    }
    
    // Get the rule
    const rules = await getUserRules(req.user.uid);
    const ruleId = ruleName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const rule = rules[ruleId] || rules[ruleName];
    
    if (!rule) {
      return res.status(400).json({ errno: 400, error: `Unknown rule: ${ruleName}` });
    }
    
    // Get user config
    const userConfig = await getUserConfig(req.user.uid);
    
    // Apply the rule action (uses v1 API, sets flag, does verification)
    const result = await applyRuleAction(req.user.uid, rule, userConfig);
    
    // Update automation state - use ruleId for UI matching
    await saveUserAutomationState(req.user.uid, {
      lastTriggered: Date.now(),
      activeRule: ruleId,
      activeRuleName: rule.name || ruleName
    });
    
    // Update rule's lastTriggered
    await db.collection('users').doc(req.user.uid).collection('rules').doc(ruleId).set({
      lastTriggered: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    res.json({ errno: 0, result, ruleName });
  } catch (error) {
    console.error('[Automation] Trigger error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Reset automation state (clear cooldowns, active rule, etc.)
app.post('/api/automation/reset', async (req, res) => {
  try {
    // Reset automation state
    await saveUserAutomationState(req.user.uid, {
      lastTriggered: null,
      activeRule: null,
      lastCheck: null
    });
    
    // Reset lastTriggered on all rules
    const rulesSnapshot = await db.collection('users').doc(req.user.uid).collection('rules').get();
    const batch = db.batch();
    rulesSnapshot.forEach(doc => {
      batch.update(doc.ref, { lastTriggered: null });
    });
    await batch.commit();
    
    console.log(`[Automation] State reset for user ${req.user.uid}`);
    res.json({ errno: 0, result: 'Automation state reset' });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Run automation cycle - evaluates all rules and triggers if conditions met
// This is called by the frontend timer every 60 seconds
app.post('/api/automation/cycle', async (req, res) => {
  try {
    const userId = req.user.uid;
    console.log(`[Automation] Running cycle for user ${userId}`);
    
    // Get user's automation state
    const state = await getUserAutomationState(userId);
    // Check explicitly for enabled === false (not undefined which means not set yet)
    if (state && state.enabled === false) {
      console.log(`[Automation] 🛑 Master switch is DISABLED (state.enabled === false)`);
      
      // ALWAYS clear all segments when automation is disabled, regardless of activeRule state
      // The inverter might have segments still scheduled from a previous rule
      try {
        const userConfig = await getUserConfig(userId);
        const deviceSN = userConfig?.deviceSn;
        if (deviceSN) {
          console.log(`[Automation] 📡 Sending clear command to device ${deviceSN}...`);
          const clearedGroups = [];
          for (let i = 0; i < 8; i++) {
            clearedGroups.push({
              enable: 0,
              workMode: 'SelfUse',
              startHour: 0, startMinute: 0,
              endHour: 0, endMinute: 0,
              minSocOnGrid: 10,
              fdSoc: 10,
              fdPwr: 0,
              maxSoc: 100
            });
          }
          const clearResult = await callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: clearedGroups }, userConfig, userId);
          if (clearResult?.errno === 0) {
            console.log(`[Automation] ✅ All segments CLEARED successfully (errno=0)`);
          } else {
            console.warn(`[Automation] ⚠️ Segment clear returned errno=${clearResult?.errno}`);
          }
        } else {
          console.warn(`[Automation] ⚠️ No deviceSN found - cannot clear segments`);
        }
      } catch (err) {
        console.error(`[Automation] ❌ Error clearing segments on disable:`, err.message);
      }
      
      // Clear lastTriggered on the active rule if one exists (so it can re-trigger when automation re-enabled)
      if (state.activeRule) {
        console.log(`[Automation] 🧹 Active rule detected: ${state.activeRuleName || state.activeRule} - clearing lastTriggered`);
        try {
          await db.collection('users').doc(userId).collection('rules').doc(state.activeRule).set({
            lastTriggered: null
          }, { merge: true });
          console.log(`[Automation] ✅ Cleared lastTriggered for rule ${state.activeRuleName || state.activeRule}`);
        } catch (err) {
          console.warn(`[Automation] ⚠️ Error clearing rule lastTriggered:`, err.message);
        }
      }
      
      // Always clear automation state
      await saveUserAutomationState(userId, { 
        lastCheck: Date.now(), 
        activeRule: null,
        activeRuleName: null,
        activeSegment: null,
        activeSegmentEnabled: false
      });
      console.log(`[Automation] ✅ Automation state cleared`);
      
      return res.json({ errno: 0, result: { skipped: true, reason: 'Automation disabled', segmentsCleared: true } });
    }
    
    // Check for blackout windows
    const userConfig = await getUserConfig(userId);
    const blackoutWindows = userConfig?.automation?.blackoutWindows || [];
    const sydney = getSydneyTime();
    const currentMinutes = sydney.hour * 60 + sydney.minute;
    
    let inBlackout = false;
    let currentBlackoutWindow = null;
    for (const window of blackoutWindows) {
      if (!window.enabled) continue;
      const [startH, startM] = (window.start || '00:00').split(':').map(Number);
      const [endH, endM] = (window.end || '00:00').split(':').map(Number);
      const startMins = startH * 60 + startM;
      const endMins = endH * 60 + endM;
      
      // Handle windows that cross midnight
      if (startMins <= endMins) {
        if (currentMinutes >= startMins && currentMinutes < endMins) {
          inBlackout = true;
          currentBlackoutWindow = window;
          break;
        }
      } else {
        if (currentMinutes >= startMins || currentMinutes < endMins) {
          inBlackout = true;
          currentBlackoutWindow = window;
          break;
        }
      }
    }
    
    if (inBlackout) {
      await saveUserAutomationState(userId, { lastCheck: Date.now(), inBlackout: true, currentBlackoutWindow });
      return res.json({ errno: 0, result: { skipped: true, reason: 'In blackout window', blackoutWindow: currentBlackoutWindow } });
    }
    
    // Get user's rules
    const rules = await getUserRules(userId);
    const totalRules = Object.keys(rules).length;
    console.log(`[Automation] Found ${totalRules} total rules`);
    
    if (totalRules === 0) {
      await saveUserAutomationState(userId, { lastCheck: Date.now(), inBlackout: false });
      return res.json({ errno: 0, result: { skipped: true, reason: 'No rules configured' } });
    }
    
    // Check if a rule was just disabled and we need to clear segments (via flag)
    if (state.clearSegmentsOnNextCycle) {
      console.log('[Cycle] 🧹 clearSegmentsOnNextCycle flag detected - clearing all segments immediately');
      try {
        const deviceSN = userConfig?.deviceSn;
        if (deviceSN) {
          const clearedGroups = [];
          for (let i = 0; i < 8; i++) {
            clearedGroups.push({
              enable: 0,
              workMode: 'SelfUse',
              startHour: 0, startMinute: 0,
              endHour: 0, endMinute: 0,
              minSocOnGrid: 10,
              fdSoc: 10,
              fdPwr: 0,
              maxSoc: 100
            });
          }
          const clearResult = await callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: clearedGroups }, userConfig, userId);
          if (clearResult?.errno === 0) {
            console.log(`[Cycle] ✅ Segments cleared successfully due to rule disable flag`);
          }
        }
      } catch (err) {
        console.error('[Cycle] Error clearing segments:', err.message);
      }
      
      // Clear the flag after processing
      await saveUserAutomationState(userId, {
        clearSegmentsOnNextCycle: false
      });
      
      return res.json({ errno: 0, result: { skipped: true, reason: 'Rule was disabled - segments cleared', segmentsCleared: true } });
    }
    
    // Check if the active rule was disabled (CRITICAL: Must check BEFORE filtering)
    // If activeRule exists but is now disabled, we need to clear segments
    if (state.activeRule && rules[state.activeRule] && !rules[state.activeRule].enabled) {
      console.log(`[Automation] 🧹 Active rule '${state.activeRuleName || state.activeRule}' was DISABLED - clearing segments`);
      try {
        const deviceSN = userConfig?.deviceSn;
        if (deviceSN) {
          const clearedGroups = [];
          for (let i = 0; i < 8; i++) {
            clearedGroups.push({
              enable: 0,
              workMode: 'SelfUse',
              startHour: 0, startMinute: 0,
              endHour: 0, endMinute: 0,
              minSocOnGrid: 10,
              fdSoc: 10,
              fdPwr: 0,
              maxSoc: 100
            });
          }
          const clearResult = await callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: clearedGroups }, userConfig, userId);
          if (clearResult?.errno === 0) {
            console.log(`[Automation] ✅ Segments cleared successfully after rule disable`);
          } else {
            console.warn(`[Automation] ⚠️ Failed to clear segments: errno=${clearResult?.errno}`);
          }
        }
      } catch (err) {
        console.error(`[Automation] ❌ Error clearing segments after rule disable:`, err.message);
      }
      
      // Clear automation state (but DON'T update lastCheck - let scheduler timer continue)
      await saveUserAutomationState(userId, {
        activeRule: null,
        activeRuleName: null,
        activeSegment: null,
        activeSegmentEnabled: false
      });
      console.log(`[Automation] ✅ Automation state cleared after rule disable`);
      return res.json({ errno: 0, result: { skipped: true, reason: 'Active rule was disabled', segmentsCleared: true } });
    }
    
    // Get live data for evaluation
    const deviceSN = userConfig?.deviceSn;
    let inverterData = null;
    let amberData = null;
    const cycleStartTime = Date.now();
    
    // Fetch inverter data (with per-user cache TTL)
    if (deviceSN) {
      try {
        inverterData = await getCachedInverterData(userId, deviceSN, userConfig, false);
      } catch (e) {
        console.warn('[Automation] Failed to get inverter data:', e.message);
      }
    }
    
    // Fetch Amber data (with forecast for next 288 intervals = 24 hours, Amber provides up to ~48hrs)
    if (userConfig?.amberApiKey) {
      try {
        const sites = await callAmberAPI('/sites', {}, userConfig);
        if (Array.isArray(sites) && sites.length > 0) {
          const siteId = userConfig.amberSiteId || sites[0].id;
          amberData = await callAmberAPI(`/sites/${encodeURIComponent(siteId)}/prices/current`, { next: 288 }, userConfig);
          console.log(`[Automation] Amber data fetched: ${Array.isArray(amberData) ? amberData.length : 0} intervals`);
          if (Array.isArray(amberData) && amberData.length > 0) {
            const forecastCount = amberData.filter(p => p.type === 'ForecastInterval').length;
            const currentCount = amberData.filter(p => p.type === 'CurrentInterval').length;
            const generalForecasts = amberData.filter(p => p.type === 'ForecastInterval' && p.channelType === 'general');
            const feedInForecasts = amberData.filter(p => p.type === 'ForecastInterval' && p.channelType === 'feedIn');
            console.log(`[Automation] Breakdown: ${currentCount} current, ${forecastCount} forecast (${generalForecasts.length} general, ${feedInForecasts.length} feedIn)`);
            // Show time range and price extremes for BOTH channels
            if (generalForecasts.length > 0) {
              const generalPrices = generalForecasts.map(f => f.perKwh);
              const maxGeneral = Math.max(...generalPrices);
              const firstTime = new Date(generalForecasts[0].startTime).toLocaleTimeString('en-AU', {hour12:false, timeZone:'Australia/Sydney'});
              const lastTime = new Date(generalForecasts[generalForecasts.length - 1].startTime).toLocaleTimeString('en-AU', {hour12:false, timeZone:'Australia/Sydney'});
              console.log(`[Automation] General (buy) forecasts: ${firstTime} to ${lastTime}, max=${maxGeneral.toFixed(1)}¢`);
            }
            if (feedInForecasts.length > 0) {
              const feedInPrices = feedInForecasts.map(f => -f.perKwh); // Negate for display (you earn positive)
              const maxFeedIn = Math.max(...feedInPrices);
              const firstTime = new Date(feedInForecasts[0].startTime).toLocaleTimeString('en-AU', {hour12:false, timeZone:'Australia/Sydney'});
              const lastTime = new Date(feedInForecasts[feedInForecasts.length - 1].startTime).toLocaleTimeString('en-AU', {hour12:false, timeZone:'Australia/Sydney'});
              console.log(`[Automation] FeedIn forecasts: ${firstTime} to ${lastTime}, max=${maxFeedIn.toFixed(1)}¢`);
            }
          }
        }
      } catch (e) {
        console.warn('[Automation] Failed to get Amber data:', e.message);
      }
    }
    
    // Build cache object for rule evaluation
    const cache = { amber: amberData, weather: null };
    
    // Evaluate rules (sorted by priority - lower number = higher priority)
    const enabledRules = Object.entries(rules).filter(([_, rule]) => rule.enabled);
    console.log(`[Automation] ${enabledRules.length} of ${totalRules} rules are enabled`);
    
    if (enabledRules.length === 0) {
      await saveUserAutomationState(userId, { lastCheck: Date.now(), inBlackout: false });
      return res.json({ errno: 0, result: { skipped: true, reason: 'No rules enabled', totalRules } });
    }
    
    // Check if any enabled rule uses weather-dependent conditions (solar radiation, cloud cover, UV)
    const needsWeatherData = enabledRules.some(([_, rule]) => {
      const cond = rule.conditions || {};
      return cond.solarRadiation?.enabled || cond.cloudCover?.enabled || cond.uvIndex?.enabled;
    });
    
    // Only fetch weather if a rule actually needs it
    let weatherData = null;
    if (needsWeatherData) {
      try {
        const place = userConfig?.location || 'Sydney';
        
        // Calculate maximum lookAhead days needed across all enabled rules
        let maxDaysNeeded = 1;
        for (const [_, rule] of enabledRules) {
          const cond = rule.conditions || {};
          
          // Check solar radiation lookAhead
          if (cond.solarRadiation?.enabled) {
            const unit = cond.solarRadiation.lookAheadUnit || 'hours';
            const value = cond.solarRadiation.lookAhead || 6;
            const days = unit === 'days' ? value : Math.ceil(value / 24);
            maxDaysNeeded = Math.max(maxDaysNeeded, days);
          }
          
          // Check cloud cover lookAhead
          if (cond.cloudCover?.enabled) {
            const unit = cond.cloudCover.lookAheadUnit || 'hours';
            const value = cond.cloudCover.lookAhead || 6;
            const days = unit === 'days' ? value : Math.ceil(value / 24);
            maxDaysNeeded = Math.max(maxDaysNeeded, days);
          }
        }
        
        // Cap at 7 days (Open-Meteo free tier limit)
        maxDaysNeeded = Math.min(maxDaysNeeded, 7);
        
        // Always fetch 7 days to maximize cache hits - any rule requesting ≤7 days will use cached data
        // This prevents cache busting when different rules request different day counts
        const daysToFetch = 7;
        console.log(`[Automation] Rules need ${maxDaysNeeded} days, fetching ${daysToFetch} days for optimal caching`);
        weatherData = await getCachedWeatherData(userId, place, daysToFetch);
        if (weatherData?.result?.current_weather) {
          console.log(`[Automation] Weather data fetched: ${weatherData.result.current_weather.temperature}°C, code=${weatherData.result.current_weather.weathercode}`);
        }
        cache.weather = weatherData.result || weatherData;
      } catch (e) {
        console.warn('[Automation] Failed to get weather data:', e.message);
      }
    } else {
      console.log(`[Automation] Skipping weather fetch - no rules use weather conditions`);
    }
    
    const sortedRules = enabledRules.sort((a, b) => (a[1].priority || 99) - (b[1].priority || 99));
    
    let triggeredRule = null;
    let triggerResult = null;
    const evaluationResults = [];
    let cancelledRuleThisCycle = false;  // Track if a rule was cancelled in this cycle for logging
    
    for (const [ruleId, rule] of sortedRules) {
      console.log(`[Automation] Checking rule '${rule.name}' (priority ${rule.priority})`);
      console.log(`[Automation] Rule conditions:`, JSON.stringify(rule.conditions || {}).slice(0, 500));
      
      // BUG FIX: Check if this is the ACTIVE rule
      // Active rules should always be re-evaluated to verify conditions still hold, even if in cooldown
      const isActiveRule = state.activeRule === ruleId;
      
      // Only apply cooldown check to INACTIVE rules (new rule searches)
      // Active rules bypass cooldown check because they need continuous condition monitoring
      const lastTriggered = rule.lastTriggered;
      const cooldownMs = (rule.cooldownMinutes || 5) * 60 * 1000;
      if (!isActiveRule && lastTriggered) {
        const lastTriggeredMs = typeof lastTriggered === 'object' 
          ? (lastTriggered._seconds || lastTriggered.seconds || 0) * 1000 
          : lastTriggered;
        if (Date.now() - lastTriggeredMs < cooldownMs) {
          const remaining = Math.round((cooldownMs - (Date.now() - lastTriggeredMs)) / 1000);
          console.log(`[Automation] Rule '${rule.name}' in cooldown (${remaining}s remaining)`);
          evaluationResults.push({ rule: rule.name, result: 'cooldown', remaining });
          continue;
        }
      }
      
      // Always evaluate active rules even if in cooldown, to detect when conditions no longer hold
      // For inactive rules, this is a normal condition check
      const result = await evaluateRule(userId, ruleId, rule, cache, inverterData, userConfig, isActiveRule /* skipCooldownCheck */);
      
      if (result.triggered) {
        if (isActiveRule) {
          // Active rule continues - conditions still hold
          // Calculate how long rule has been active
          const lastTriggeredMs = typeof lastTriggered === 'object' 
            ? (lastTriggered._seconds || lastTriggered.seconds || 0) * 1000 
            : (lastTriggered || Date.now());
          const activeForSec = Math.round((Date.now() - lastTriggeredMs) / 1000);
          const cooldownRemaining = Math.max(0, Math.round((cooldownMs - (Date.now() - lastTriggeredMs)) / 1000));
          
          // Check if cooldown has EXPIRED - if so, reset and re-trigger in SAME cycle
          if (Date.now() - lastTriggeredMs >= cooldownMs) {
            console.log(`[Automation] ⏰ Active rule '${rule.name}' COOLDOWN EXPIRED (active ${activeForSec}s) - resetting to allow re-trigger IN SAME CYCLE`);
            
            try {
              // Reset lastTriggered to allow immediate re-trigger
              await db.collection('users').doc(userId).collection('rules').doc(ruleId).set({
                lastTriggered: null
              }, { merge: true });
              
              // Clear active rule state so the rule can re-trigger as NEW in this same cycle
              await saveUserAutomationState(userId, { 
                lastCheck: Date.now(), 
                inBlackout: false, 
                activeRule: null,
                activeRuleName: null,
                activeSegment: null,
                activeSegmentEnabled: false
              });
              
              console.log(`[Automation] Rule '${ruleId}' reset after cooldown expiry - treating as NEW rule this cycle`);
            } catch (err) {
              console.error(`[Automation] Error resetting rule after cooldown expiry:`, err.message);
            }
            
            // Mark as triggered - this is a re-trigger after cooldown expiry
            // Since we cleared activeRule state, it will be treated as a new rule and re-trigger with updated times
            evaluationResults.push({ 
              rule: rule.name, 
              result: 'triggered', 
              activeFor: activeForSec,
              details: result 
            });
            
            // Fall through to NEW trigger logic below (isActiveRule is still true in variable but state is cleared)
            // We need to manually apply the action since we're not going through the normal path
            console.log(`[Automation] ✅ Rule '${rule.name}' RE-TRIGGERING after cooldown expiry with updated times`);
            
            // Apply the rule action with NEW timestamps
            const isNewTrigger = true; // Treat as new trigger
            triggeredRule = { ruleId, ...rule, isNewTrigger, status: 'new_trigger' };
            triggerResult = result;
            
            let actionResult = null;
            try {
              console.log(`[Automation] 🔄 Calling applyRuleAction to ATOMICALLY update segment with new times...`);
              const applyStart = Date.now();
              actionResult = await applyRuleAction(userId, rule, userConfig);
              const applyDuration = Date.now() - applyStart;
              console.log(`[Automation] ✅ applyRuleAction completed in ${applyDuration}ms - errno=${actionResult?.errno}, msg=${actionResult?.msg}`);
              if (actionResult?.retrysFailed) {
                console.warn(`[Automation] ⚠️ Some retries failed during atomic segment update`);
              }
            } catch (actionError) {
              console.error(`[Automation] ❌ Action failed:`, actionError);
              actionResult = { errno: -1, msg: actionError.message || 'Action failed' };
            }
            
            // Update rule's lastTriggered (new trigger)
            await db.collection('users').doc(userId).collection('rules').doc(ruleId).set({
              lastTriggered: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            
            // Update automation state with NEW active rule
            await saveUserAutomationState(userId, {
              lastCheck: Date.now(),
              lastTriggered: Date.now(),
              activeRule: ruleId,
              activeRuleName: rule.name,
              activeSegment: actionResult?.segment || null,
              activeSegmentEnabled: actionResult?.errno === 0,
              inBlackout: false,
              lastActionResult: actionResult
            });
            
            triggeredRule.actionResult = actionResult;
            break; // Rule applied, exit loop
          } else {
            // Cooldown still active - rule continues
            console.log(`[Automation] ✅ Active rule '${rule.name}' conditions STILL MET - continuing (active ${activeForSec}s, cooldown ${cooldownRemaining}s remaining)`);
            
            // Mark as 'continuing' in evaluation results with cooldown info
            evaluationResults.push({ 
              rule: rule.name, 
              result: 'continuing', 
              activeFor: activeForSec,
              cooldownRemaining,
              details: result 
            });
            
            // Mark this as the triggered rule for response (continuing state)
            triggeredRule = { ruleId, ...rule, isNewTrigger: false, status: 'continuing' };
            triggerResult = result;
            
            // Update check timestamp only, don't re-apply segment
            await saveUserAutomationState(userId, {
              lastCheck: Date.now(),
              inBlackout: false,
              activeSegmentEnabled: true
            });
            
            break; // Rule still active, exit loop
          }
        } else {
          // Mark as 'triggered' for new rules
          evaluationResults.push({ rule: rule.name, result: 'triggered', details: result });
          // New rule triggered - check priority vs active rule
          if (state.activeRule && rules[state.activeRule]) {
            const activeRulePriority = rules[state.activeRule].priority || 99;
            const newRulePriority = rule.priority || 99;
            if (newRulePriority > activeRulePriority) {
              // New rule is LOWER priority than active rule - don't trigger
              console.log(`[Automation] Rule '${rule.name}' (P${newRulePriority}) would trigger but active rule P${activeRulePriority} has higher priority - skipping`);
              continue;
            } else if (newRulePriority < activeRulePriority) {
              // New rule has HIGHER priority (lower number) - cancel active rule first
              console.log(`[Automation] 🔥 Rule '${rule.name}' (P${newRulePriority}) has HIGHER priority than active rule P${activeRulePriority} - canceling active rule`);
              try {
                const deviceSN = userConfig?.deviceSn;
                if (deviceSN) {
                  const clearedGroups = [];
                  for (let i = 0; i < 8; i++) {
                    clearedGroups.push({
                      enable: 0,
                      workMode: 'SelfUse',
                      startHour: 0, startMinute: 0,
                      endHour: 0, endMinute: 0,
                      minSocOnGrid: 10,
                      fdSoc: 10,
                      fdPwr: 0,
                      maxSoc: 100
                    });
                  }
                  await callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: clearedGroups }, userConfig, userId);
                  console.log(`[Automation] ✅ Cleared lower-priority active rule's segment`);
                  await new Promise(resolve => setTimeout(resolve, 2500)); // Wait for inverter to process
                }
              } catch (err) {
                console.error(`[Automation] ❌ Error clearing active rule segment:`, err.message);
              }
              // Reset active rule's lastTriggered so it can be re-triggered later
              if (state.activeRule) {
                await db.collection('users').doc(userId).collection('rules').doc(state.activeRule).set({ lastTriggered: null }, { merge: true });
              }
              cancelledRuleThisCycle = true;
            }
          }
          // New rule triggered with higher priority or no active rule exists
          console.log(`[Automation] ✅ Rule '${rule.name}' TRIGGERED! Applying action...`);
        }
        // Mark whether this is a new trigger or a continuing active rule
        const isNewTrigger = !isActiveRule;
        triggeredRule = { ruleId, ...rule, isNewTrigger, status: isNewTrigger ? 'new_trigger' : 'continuing' };
        triggerResult = result;
        
        // Only apply the rule action if this is a NEW rule (not the active one continuing)
        if (!isActiveRule) {
          // Actually apply the rule action (create scheduler segment)
          let actionResult = null;
          try {
            actionResult = await applyRuleAction(userId, rule, userConfig);
            console.log(`[Automation] Action result for '${rule.name}': errno=${actionResult?.errno}, msg=${actionResult?.msg}`);
          } catch (actionError) {
            console.error(`[Automation] Action failed:`, actionError);
            actionResult = { errno: -1, msg: actionError.message || 'Action failed' };
          }
          
          // Update rule's lastTriggered (new rule triggered)
          await db.collection('users').doc(userId).collection('rules').doc(ruleId).set({
            lastTriggered: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          
          // Update automation state
          // IMPORTANT: Save ruleId (doc key) not rule.name so UI can match activeRule with rule keys
          await saveUserAutomationState(userId, {
            lastCheck: Date.now(),
            lastTriggered: Date.now(),
            activeRule: ruleId,
            activeRuleName: rule.name, // Keep display name for reference
            activeSegment: actionResult?.segment || null, // Store segment details for verification
            activeSegmentEnabled: actionResult?.errno === 0,
            inBlackout: false,
            lastActionResult: actionResult
          });
          
          // Store action result for response
          triggeredRule.actionResult = actionResult;
        } else {
          // Active rule is continuing - just update check timestamp, no re-apply needed
          console.log(`[Automation] Continuing with active rule - segment remains active`);
          await saveUserAutomationState(userId, {
            lastCheck: Date.now(),
            inBlackout: false,
            activeSegmentEnabled: true
          });
        }
        
        break; // First matching rule wins
      } else {
        // Conditions not met - add to evaluation results
        evaluationResults.push({ rule: rule.name, result: 'not_met', details: result });
        
        // Active rule's conditions NO LONGER hold during evaluation
        if (isActiveRule) {
          console.log(`[Automation] Active rule '${rule.name}' conditions NO LONGER MET - canceling segment`);
          let segmentClearSuccess = false;
          try {
            // Clear all scheduler segments
            const deviceSN = userConfig?.deviceSn;
            if (deviceSN) {
              const clearedGroups = [];
              for (let i = 0; i < 8; i++) {
                clearedGroups.push({
                  enable: 0,
                  workMode: 'SelfUse',
                  startHour: 0, startMinute: 0,
                  endHour: 0, endMinute: 0,
                  minSocOnGrid: 10,
                  fdSoc: 10,
                  fdPwr: 0,
                  maxSoc: 100
                });
              }
              
              // Retry logic for segment clearing (up to 3 attempts)
              let clearAttempt = 0;
              let clearResult = null;
              while (clearAttempt < 3 && !segmentClearSuccess) {
                clearAttempt++;
                console.log(`[Automation] Segment clear attempt ${clearAttempt}/3...`);
                clearResult = await callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: clearedGroups }, userConfig, userId);
                
                if (clearResult?.errno === 0) {
                  console.log(`[Automation] ✓ Cleared all scheduler segments (attempt ${clearAttempt})`);
                  segmentClearSuccess = true;
                } else {
                  console.warn(`[Automation] Segment clear attempt ${clearAttempt} failed: errno=${clearResult?.errno}, msg=${clearResult?.msg}`);
                  if (clearAttempt < 3) {
                    console.log(`[Automation] ⏳ Waiting 1.2s before retry...`);
                    await new Promise(resolve => setTimeout(resolve, 1200));
                  }
                }
              }
              
              if (!segmentClearSuccess) {
                console.error(`[Automation] ❌ Failed to clear segments after 3 attempts - aborting replacement rule evaluation for safety`);
                // Break out of rule loop if we can't clear - too risky to apply new segment
                break;
              }
              
              // Wait for inverter to process segment clearing before continuing evaluation
              // Extended delay to ensure hardware is ready (2.5s total wait)
              console.log(`[Automation] ⏳ Waiting 2.5s for inverter to process segment clearing...`);
              await new Promise(resolve => setTimeout(resolve, 2500));
              console.log(`[Automation] ✓ Inverter processing delay complete, ready to evaluate replacement rules`);
            }
            // Clear lastTriggered when rule is canceled (conditions failed)
            // This allows the rule to re-trigger immediately if conditions become valid again
            // Cooldown only applies to CONTINUING active rules, not canceled ones
            await db.collection('users').doc(userId).collection('rules').doc(ruleId).set({
              lastTriggered: null
            }, { merge: true });
            console.log(`[Automation] Rule '${ruleId}' canceled - cooldown reset, can re-trigger if conditions met`);
          } catch (cancelError) {
            console.error(`[Automation] Unexpected error during cancellation:`, cancelError.message);
            // Break on unexpected errors - don't risk applying a replacement
            break;
          }
          
          // Only proceed if segment clear was successful
          if (segmentClearSuccess) {
            await saveUserAutomationState(userId, { 
              lastCheck: Date.now(), 
              inBlackout: false, 
              activeRule: null,
              activeRuleName: null,
              activeSegment: null,
              activeSegmentEnabled: false
            });
            // Continue to check if any other rule can trigger
            console.log(`[Automation] 🔄 Continuing rule evaluation after cancellation...`);
            cancelledRuleThisCycle = true;  // Mark that we cancelled a rule this cycle
            continue;
          } else {
            // Failed to clear - don't evaluate replacement rules this cycle
            console.log(`[Automation] 🛑 Skipping replacement rule evaluation due to segment clear failure`);
            break;
          }
        }
      }
    }
    
    if (!triggeredRule) {
      console.log(`[Automation] No new rules triggered and no active rule continuing this cycle`);
      
      // Just update lastCheck timestamp
      // Note: If an active rule's conditions no longer held, it was already handled in the main loop above
      await saveUserAutomationState(userId, { lastCheck: Date.now(), inBlackout: false });
    }

    
    // Calculate cycle duration
    const cycleDurationMs = Date.now() - cycleStartTime;
    
    res.json({
      errno: 0,
      result: {
        triggered: !!triggeredRule,
        status: triggeredRule?.status || null,  // 'new_trigger', 'continuing', or null
        rule: triggeredRule ? { name: triggeredRule.name, priority: triggeredRule.priority, actionResult: triggeredRule.actionResult } : null,
        rulesEvaluated: sortedRules.length,
        totalRules,
        evaluationResults,
        lastCheck: Date.now(),
        // Performance
        cycleDurationMs
      }
    });
  } catch (error) {
    console.error('[Automation] Cycle error:', error);
    
    // Still update lastCheck even on error
    try {
      await saveUserAutomationState(req.user.uid, { lastCheck: Date.now() });
    } catch (e) { /* ignore */ }
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Cancel active automation segment - clears all scheduler segments
app.post('/api/automation/cancel', async (req, res) => {
  try {
    const userId = req.user.uid;
    const userConfig = await getUserConfig(userId);
    const deviceSN = userConfig?.deviceSn;
    
    if (!deviceSN) {
      return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    }
    
    console.log(`[Automation] Cancel request for user ${userId}, device ${deviceSN}`);

    // Create 8 empty/disabled segments (matching device's actual group count)
    const emptyGroups = [];
    for (let i = 0; i < 8; i++) {
      emptyGroups.push({
        enable: 0,
        workMode: 'SelfUse',
        startHour: 0, startMinute: 0,
        endHour: 0, endMinute: 0,
        minSocOnGrid: 10,
        fdSoc: 10,
        fdPwr: 0,
        maxSoc: 100
      });
    }
    
    // Send to device via v1 API
    const result = await callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: emptyGroups }, userConfig, userId);
    console.log(`[Automation] Cancel v1 result: errno=${result.errno}`);
    
    // Disable the scheduler flag
    let flagResult = null;
    try {
      flagResult = await callFoxESSAPI('/op/v1/device/scheduler/set/flag', 'POST', { deviceSN, enable: 0 }, userConfig, userId);
      console.log(`[Automation] Cancel flag result: errno=${flagResult?.errno}`);
    } catch (flagErr) {
      console.warn('[Automation] Flag disable failed:', flagErr && flagErr.message ? flagErr.message : flagErr);
    }
    
    // Verification read
    let verify = null;
    try {
      verify = await callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN }, userConfig, userId);
    } catch (e) {
      console.warn('[Automation] Verify read failed:', e && e.message ? e.message : e);
    }
    
    // Clear active rule in state
    await saveUserAutomationState(userId, {
      activeRule: null
    });
    
    // Log to history
    try {
      await addHistoryEntry(userId, {
        type: 'automation_cancel',
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) { /* ignore */ }
    
    res.json({
      errno: result.errno,
      msg: result.msg || (result.errno === 0 ? 'Automation cancelled' : 'Failed'),
      flagResult,
      verify: verify?.result || null
    });
  } catch (error) {
    console.error('[Automation] Cancel error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Create automation rule
app.post('/api/automation/rule/create', async (req, res) => {
  try {
    const { name, enabled, priority, conditions, action, cooldownMinutes } = req.body;
    
    if (!name) {
      return res.status(400).json({ errno: 400, error: 'Rule name is required' });
    }
    
    const ruleId = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const rule = {
      name,
      enabled: enabled !== false,
      priority: typeof priority === 'number' ? priority : 5, // Default to priority 5 for new rules
      conditions: conditions || {},
      action: action || {},
      cooldownMinutes: typeof cooldownMinutes === 'number' ? cooldownMinutes : 5,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await db.collection('users').doc(req.user.uid).collection('rules').doc(ruleId).set(rule);
    res.json({ errno: 0, result: { ruleId, ...rule } });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Update automation rule (backwards-compatible endpoint used by frontend)
// IMPORTANT: Only updates provided fields - does NOT overwrite with defaults
app.post('/api/automation/rule/update', async (req, res) => {
  try {
    const { ruleName, name, enabled, priority, conditions, action, cooldownMinutes } = req.body;

    if (!ruleName && !name) {
      return res.status(400).json({ errno: 400, error: 'Rule name or ruleId is required' });
    }

    const ruleId = (ruleName || name).toLowerCase().replace(/[^a-z0-9]+/g, '_');
    
    // Build update object with ONLY provided fields to avoid overwriting existing data
    const update = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    // Only include fields that were explicitly provided in the request
    if (name !== undefined) update.name = name;
    if (enabled !== undefined) update.enabled = !!enabled;
    if (typeof priority === 'number') update.priority = priority;
    if (conditions !== undefined) update.conditions = conditions;
    if (cooldownMinutes !== undefined) update.cooldownMinutes = cooldownMinutes;
    
    // Handle action - merge with existing if partial update
    if (action !== undefined) {
      // Get existing rule to merge action properly
      const existingDoc = await db.collection('users').doc(req.user.uid).collection('rules').doc(ruleId).get();
      if (existingDoc.exists && existingDoc.data().action) {
        // Merge new action fields with existing action
        update.action = { ...existingDoc.data().action, ...action };
      } else {
        update.action = action;
      }
    }

    console.log(`[Rule Update] Updating rule ${ruleId} with fields:`, Object.keys(update));
    
    // If rule is being DISABLED, clear lastTriggered to reset cooldown
    // This ensures the rule can trigger immediately when re-enabled
    if (enabled === false) {
      update.lastTriggered = null;
      console.log(`[Rule Update] Rule ${ruleId} disabled - clearing lastTriggered to reset cooldown`);
      
      // Also check if this was the active rule and flag for immediate clearing
      const state = await getUserAutomationState(req.user.uid);
      if (state && state.activeRule === ruleId) {
        console.log(`[Rule Update] Disabled rule was active - setting clearSegmentsOnNextCycle flag`);
        await saveUserAutomationState(req.user.uid, {
          activeRule: null,
          activeRuleName: null,
          activeSegment: null,
          activeSegmentEnabled: false,
          clearSegmentsOnNextCycle: true  // Flag for cycle to clear segments immediately
        });
      }
    }
    
    await db.collection('users').doc(req.user.uid).collection('rules').doc(ruleId).set(update, { merge: true });
    
    // Return the updated rule
    const updatedDoc = await db.collection('users').doc(req.user.uid).collection('rules').doc(ruleId).get();
    res.json({ errno: 0, result: { ruleId, ...updatedDoc.data() } });
  } catch (error) {
    console.error('[Rule Update] Error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});
// Delete automation rule
app.post('/api/automation/rule/delete', async (req, res) => {
  try {
    const { ruleName } = req.body;
    
    if (!ruleName) {
      return res.status(400).json({ errno: 400, error: 'Rule name is required' });
    }
    
    const ruleId = ruleName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    
    // Check if this is the active rule, if so, set flag to clear segments
    const state = await getUserAutomationState(req.user.uid);
    if (state && state.activeRule === ruleId) {
      console.log(`[Rule Delete] Deleted rule was active - setting clearSegmentsOnNextCycle flag`);
      await saveUserAutomationState(req.user.uid, {
        activeRule: null,
        activeRuleName: null,
        activeSegment: null,
        activeSegmentEnabled: false,
        clearSegmentsOnNextCycle: true  // Flag for cycle to clear segments immediately
      });
    }
    
    await db.collection('users').doc(req.user.uid).collection('rules').doc(ruleId).delete();
    res.json({ errno: 0, result: { deleted: ruleName } });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Get automation history
app.get('/api/automation/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const historySnapshot = await db.collection('users').doc(req.user.uid)
      .collection('history')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();
    
    const history = [];
    historySnapshot.forEach(doc => {
      history.push({ id: doc.id, ...doc.data() });
    });
    
    res.json({ errno: 0, result: history });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Get automation audit logs (cycle history with cache & performance metrics)
app.get('/api/automation/audit', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '100', 10);
    const auditLogs = await getAutomationAuditLogs(req.user.uid, limit);
    
    res.json({ 
      errno: 0, 
      result: {
        entries: auditLogs,
        count: auditLogs.length,
        period: '48 hours',
        note: 'Logs older than 48 hours are automatically deleted'
      }
    });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Run automation test with provided mock data (simulation)
app.post('/api/automation/test', async (req, res) => {
  try {
    const mockData = req.body && req.body.mockData ? req.body.mockData : (req.body || {});

    // Load user rules
    const rules = await getUserRules(req.user.uid);
    const sorted = Object.entries(rules || {}).filter(([_, r]) => r.enabled).sort((a,b) => (a[1].priority||99) - (b[1].priority||99));

    const allResults = [];
    // Helper to check time window
    const timeInWindow = (timeStr, start, end) => {
      if (!timeStr) return true; // if no test time provided assume match
      const toMins = t => { const [hh,mm] = (t||'00:00').split(':').map(x=>parseInt(x,10)||0); return hh*60+mm; };
      const t = toMins(timeStr);
      const s = toMins(start || '00:00');
      const e = toMins(end || '23:59');
      if (s <= e) return t >= s && t <= e;
      // window spans midnight
      return t >= s || t <= e;
    };

    for (const [ruleId, rule] of sorted) {
      const cond = rule.conditions || {};
      let met = true;
      const condDetails = [];

      // feedInPrice
      if (cond.feedInPrice?.enabled) {
        const price = Number(mockData.feedInPrice || 0);
        const target = Number(cond.feedInPrice.value || 0);
        const cmet = compareValue(price, cond.feedInPrice.operator, target);
        condDetails.push({ name: 'Feed-in Price', value: price, target, operator: cond.feedInPrice.operator, met: !!cmet });
        if (!cmet) met = false;
      }

      // buyPrice
      if (cond.buyPrice?.enabled) {
        const price = Number(mockData.buyPrice || 0);
        const target = Number(cond.buyPrice.value || 0);
        const cmet = compareValue(price, cond.buyPrice.operator, target);
        condDetails.push({ name: 'Buy Price', value: price, target, operator: cond.buyPrice.operator, met: !!cmet });
        if (!cmet) met = false;
      }

      // soc
      if (cond.soc?.enabled) {
        const soc = Number(mockData.soc || 0);
        const target = Number(cond.soc.value || 0);
        const cmet = compareValue(soc, cond.soc.operator, target);
        condDetails.push({ name: 'Battery SoC', value: soc, target, operator: cond.soc.operator, met: !!cmet });
        if (!cmet) met = false;
      }

      // temperature
      if (cond.temperature?.enabled) {
        const type = cond.temperature.type || 'battery';
        const tempVal = type === 'ambient' ? Number(mockData.ambientTemp || 0) : Number(mockData.batteryTemp || 0);
        const target = Number(cond.temperature.value || 0);
        const cmet = compareValue(tempVal, cond.temperature.operator, target);
        condDetails.push({ name: (type === 'ambient' ? 'Ambient Temp' : 'Battery Temp'), value: tempVal, target, operator: cond.temperature.operator, met: !!cmet });
        if (!cmet) met = false;
      }

      // time
      const timeCond = cond.time || cond.timeWindow;
      if (timeCond?.enabled) {
        const ok = timeInWindow(mockData.testTime || null, timeCond.startTime || timeCond.start, timeCond.endTime || timeCond.end);
        condDetails.push({ name: 'Time Window', value: mockData.testTime || 'now', target: `${timeCond.startTime || timeCond.start || '00:00'}–${timeCond.endTime || timeCond.end || '23:59'}`, operator: 'in', met: !!ok });
        if (!ok) met = false;
      }

      allResults.push({ ruleName: rule.name || ruleId, ruleId, met, priority: rule.priority || 99, conditions: condDetails });

      if (met) {
        // First match wins
        return res.json({ errno: 0, triggered: true, result: { ruleName: rule.name || ruleId, ruleId, priority: rule.priority || 99, action: rule.action || {} }, testData: mockData, allResults });
      }
    }

    // No rules triggered
    res.json({ errno: 0, triggered: false, result: null, testData: mockData, allResults });
  } catch (error) {
    console.error('[API] /api/automation/test error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Inverter endpoints (proxy to FoxESS)
app.get('/api/inverter/list', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const result = await callFoxESSAPI('/op/v0/device/list', 'POST', { currentPage: 1, pageSize: 10 }, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

app.get('/api/inverter/real-time', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.query.sn || userConfig?.deviceSn;
    
    if (!sn) {
      return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    }
    
    const result = await callFoxESSAPI('/op/v0/device/real/query', 'POST', {
      sn,
      variables: ['generationPower', 'pvPower', 'pv1Power', 'pv2Power', 'pv3Power', 'pv4Power', 'pv1Volt', 'pv2Volt', 'pv3Volt', 'pv4Volt', 'pv1Current', 'pv2Current', 'pv3Current', 'pv4Current', 'feedinPower', 'gridConsumptionPower', 'loadsPower', 'batChargePower', 'batDischargePower', 'SoC', 'batTemperature', 'ambientTemperation', 'invTemperation', 'boostTemperation']
    }, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Read a specific inverter setting (returns the value for a given key)
app.get('/api/inverter/settings', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.query.sn || userConfig?.deviceSn;
    const key = req.query.key;
    if (!key) return res.status(400).json({ errno: 400, error: 'Missing required parameter: key' });
    const result = await callFoxESSAPI('/op/v0/device/setting/get', 'POST', { sn, key }, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/inverter/settings error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Battery SoC read endpoint used by control UI
app.get('/api/device/battery/soc/get', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.query.sn || userConfig?.deviceSn;
    if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    const result = await callFoxESSAPI(`/op/v0/device/battery/soc/get?sn=${encodeURIComponent(sn)}`, 'GET', null, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/device/battery/soc/get error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Battery SoC set
app.post('/api/device/battery/soc/set', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.body.sn || userConfig?.deviceSn;
    const { minSoc, minSocOnGrid } = req.body;
    if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    const result = await callFoxESSAPI('/op/v0/device/battery/soc/set', 'POST', { sn, minSoc, minSocOnGrid }, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/device/battery/soc/set error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Force charge time read
app.get('/api/device/battery/forceChargeTime/get', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.query.sn || userConfig?.deviceSn;
    if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    const result = await callFoxESSAPI(`/op/v0/device/battery/forceChargeTime/get?sn=${encodeURIComponent(sn)}`, 'GET', null, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/device/battery/forceChargeTime/get error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Force charge time set
app.post('/api/device/battery/forceChargeTime/set', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.body.sn || userConfig?.deviceSn;
    const body = Object.assign({ sn }, req.body);
    const result = await callFoxESSAPI('/op/v0/device/battery/forceChargeTime/set', 'POST', body, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/device/battery/forceChargeTime/set error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// FoxESS: Get meter reader (legacy endpoint used by UI)
app.post('/api/device/getMeterReader', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.body.sn || userConfig?.deviceSn;
    if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    const body = Object.assign({ sn }, req.body);
    const result = await callFoxESSAPI('/op/v0/device/getMeterReader', 'POST', body, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/device/getMeterReader error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Dedicated temperatures endpoint - returns only temperature-related variables
app.get('/api/inverter/temps', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.query.sn || userConfig?.deviceSn;
    if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    const variables = ['batTemperature', 'ambientTemperation', 'invTemperation', 'boostTemperation'];
    const result = await callFoxESSAPI('/op/v0/device/real/query', 'POST', { sn, variables }, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/inverter/temps error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Device report (daily, monthly, yearly, hourly data)
app.get('/api/inverter/report', authenticateUser, async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.query.sn || userConfig?.deviceSn;
    if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    
    const dimension = req.query.dimension || 'month';
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    
    // FoxESS API dimensions:
    // 'year' = monthly data for the year (needs: year)
    // 'month' = daily data for the month (needs: year, month)
    const body = {
      sn,
      dimension,
      year,
      variables: ['generation', 'feedin', 'gridConsumption', 'chargeEnergyToTal', 'dischargeEnergyToTal']
    };
    
    // Add month for 'month' dimension
    if (dimension === 'month') {
      body.month = month;
    }
    
    console.log(`[API] /api/inverter/report - dimension: ${dimension}, body: ${JSON.stringify(body)}`);
    
    const result = await callFoxESSAPI('/op/v0/device/report/query', 'POST', body, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/inverter/report error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Device generation summary
app.get('/api/inverter/generation', authenticateUser, async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.query.sn || userConfig?.deviceSn;
    if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    
    // Get point-in-time generation data (today, month, cumulative)
    const genResult = await callFoxESSAPI(`/op/v0/device/generation?sn=${encodeURIComponent(sn)}`, 'GET', null, userConfig, req.user.uid);
    
    // Enhance with yearly data from report endpoint
    try {
      const year = new Date().getFullYear();
      const reportBody = {
        sn,
        dimension: 'year',
        year,
        variables: ['generation']
      };
      const reportResult = await callFoxESSAPI('/op/v0/device/report/query', 'POST', reportBody, userConfig, req.user.uid);
      
      // Extract yearly generation from report (array of monthly values for the year)
      if (reportResult.result && Array.isArray(reportResult.result) && reportResult.result.length > 0) {
        const genVar = reportResult.result.find(v => v.variable === 'generation');
        if (genVar && Array.isArray(genVar.values)) {
          // Sum all monthly values to get year-to-date generation
          const yearGeneration = genVar.values.reduce((sum, val) => sum + (val || 0), 0);
          // Add to the generation data if it's a valid number
          if (genResult.result && typeof genResult.result === 'object') {
            genResult.result.year = yearGeneration;
            genResult.result.yearGeneration = yearGeneration;
          }
        }
      }
    } catch (reportError) {
      // Log but don't fail - report endpoint might not be available
      console.warn('[API] /api/inverter/generation - report endpoint failed:', reportError.message);
    }
    
    res.json(genResult);
  } catch (error) {
    console.error('[API] /api/inverter/generation error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// EMS list
app.get('/api/ems/list', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const result = await callFoxESSAPI('/op/v0/ems/list', 'POST', { currentPage: 1, pageSize: 10 }, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/ems/list error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Module list
app.get('/api/module/list', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const result = await callFoxESSAPI('/op/v0/module/list', 'POST', { currentPage: 1, pageSize: 10, sn: userConfig?.deviceSn }, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/module/list error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Module signal (requires moduleSN parameter)
app.get('/api/module/signal', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const moduleSN = req.query.moduleSN;
    
    if (!moduleSN) {
      return res.status(400).json({ errno: 400, error: 'moduleSN parameter is required' });
    }
    
    const result = await callFoxESSAPI('/op/v0/module/getSignal', 'POST', { sn: moduleSN }, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/module/signal error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Meter list
app.get('/api/meter/list', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const result = await callFoxESSAPI('/op/v0/gw/list', 'POST', { currentPage: 1, pageSize: 10 }, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/meter/list error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Get work mode setting (default active mode, not scheduler)
app.get('/api/device/workmode/get', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.query.sn || userConfig?.deviceSn;
    if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });

    const result = await callFoxESSAPI('/op/v0/device/setting/get', 'POST', { sn, key: 'WorkMode' }, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/device/workmode/get error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Set work mode setting (default active mode, not scheduler)
app.post('/api/device/workmode/set', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.body.sn || userConfig?.deviceSn;
    const { workMode } = req.body;
    if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    if (!workMode) return res.status(400).json({ errno: 400, error: 'workMode is required (SelfUse, Feedin, Backup, PeakShaving)' });

    const result = await callFoxESSAPI('/op/v0/device/setting/set', 'POST', { sn, key: 'WorkMode', value: workMode }, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/device/workmode/set error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// (Amber sites handler moved earlier to allow unauthenticated callers)
// (Amber prices handler moved earlier to allow unauthenticated callers)

// Weather endpoint
app.get('/api/weather', async (req, res) => {
  try {
    await tryAttachUser(req);
    const place = req.query.place || 'Sydney';
    const days = parseInt(req.query.days || '3', 10);
    console.log(`[Weather API] Request for place="${place}", days=${days}`);
    const result = await getCachedWeatherData(req.user?.uid || 'anonymous', place, days);
    console.log(`[Weather API] Returning: errno=${result.errno}, daily days=${result.result?.daily?.time?.length || 0}, cache hit=${result.__cacheHit || false}`);
    res.json(result);
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Scheduler endpoints
// IMPORTANT: Always fetch from the live FoxESS device to ensure UI matches actual device state
// (not from Firestore cache, which caused segments to appear saved but not sync to manufacturer app)
app.get('/api/scheduler/v1/get', async (req, res) => {
  try {
    await tryAttachUser(req);
    const userConfig = await getUserConfig(req.user?.uid);
    const sn = req.query.sn || userConfig?.deviceSn;
    
    if (!sn) {
      // No device SN configured - return sensible defaults
      const defaultGroups = Array.from({ length: 10 }).map((_, i) => ({
        startHour: 0, startMinute: 0,
        endHour: 0, endMinute: 0,
        enable: 0,
        workMode: 'SelfUse',
        minSocOnGrid: 10,
        fdSoc: 10,
        fdPwr: 0,
        maxSoc: 100
      }));
      return res.json({ errno: 0, result: { groups: defaultGroups, enable: false }, source: 'defaults' });
    }
    
    // Always fetch live data from the device (this is what the manufacturer app sees)
    const result = await callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN: sn }, userConfig, req.user?.uid);
    
    // Tag the source so debugging is easier
    if (result && result.errno === 0) {
      result.source = 'device';
    }
    
    res.json(result);
  } catch (error) {
    console.error('[Scheduler] GET error:', error.message);
    res.status(500).json({ errno: 500, error: error.message });
  }
});



app.post('/api/scheduler/v1/set', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const deviceSN = req.body.sn || req.body.deviceSN || userConfig?.deviceSn;
    const groups = req.body.groups || [];
    
    if (!deviceSN) {
      return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    }
    
    console.log('[Scheduler] SET request for device:', deviceSN, 'groups count:', groups.length);
    console.log('[Scheduler] Groups payload:', JSON.stringify(groups).slice(0, 500));
    
    // Primary: v1 API (this is what backend server.js uses and it works)
    const result = await callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups }, userConfig, req.user.uid);
    console.log('[Scheduler] v1 result:', JSON.stringify(result).slice(0, 300));

    // Determine if we should enable or disable the scheduler flag
    const shouldEnable = Array.isArray(groups) && groups.some(g => Number(g.enable) === 1);
    
    // Set scheduler flag (required for FoxESS app to show the schedule)
    let flagResult = null;
    try {
      flagResult = await callFoxESSAPI('/op/v1/device/scheduler/set/flag', 'POST', { deviceSN, enable: shouldEnable ? 1 : 0 }, userConfig, req.user.uid);
      console.log('[Scheduler] Flag v1 result:', JSON.stringify(flagResult).slice(0, 200));
    } catch (flagErr) {
      console.warn('[Scheduler] Flag v1 failed:', flagErr && flagErr.message ? flagErr.message : flagErr);
    }

    // Log action to history
    await addHistoryEntry(req.user.uid, {
      type: 'scheduler_update',
      action: 'manual',
      groups,
      result: result.errno === 0 ? 'success' : 'failed'
    });

    // Verification read: fetch what the device actually has now
    let verify = null;
    try {
      verify = await callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN }, userConfig, req.user.uid);
      console.log('[Scheduler] Verify read:', JSON.stringify(verify).slice(0, 500));
    } catch (e) { 
      console.warn('[Scheduler] Verify read failed:', e && e.message ? e.message : e); 
    }

    // Return the result with verification data
    res.json({
      errno: result.errno,
      msg: result.msg || (result.errno === 0 ? 'Success' : 'Failed'),
      result: result.result,
      flagResult,
      verify: verify?.result || null
    });
  } catch (error) {
    console.error('[Scheduler] SET error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// ==================== API METRICS (USER-SPECIFIC) ====================

/**
 * Increment API call count for a user
 */
// Helper: returns YYYY-MM-DD for Australia/Sydney local date (handles DST)
function getAusDateKey(date = new Date()) {
  return date.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }); // YYYY-MM-DD
}

async function incrementApiCount(userId, apiType) {
  const today = getAusDateKey(); // YYYY-MM-DD (Australia/Sydney)

  // Only update per-user metrics when we have a valid userId
  if (userId) {
    const docRef = db.collection('users').doc(userId).collection('metrics').doc(today);
    try {
      await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        const data = doc.exists ? doc.data() : { foxess: 0, amber: 0, weather: 0 };
        data[apiType] = (data[apiType] || 0) + 1;
        data.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        transaction.set(docRef, data, { merge: true });
      });
    } catch (error) {
      console.error('Error incrementing API count:', error);
    }
  }
  
  // Also maintain an aggregated global daily metric so the UI (and non-authenticated callers)
  // can show platform-level API usage (mirrors backend `api_call_counts.json`).
  try {
    await incrementGlobalApiCount(apiType);
  } catch (e) {
    console.error('[Metrics] incrementGlobalApiCount error:', e && e.message ? e.message : e);
  }
}

/**
 * Increment the global daily counters (top-level `metrics` collection)
 * This keeps a platform-wide view of API usage similar to the backend file-based counters.
 */
async function incrementGlobalApiCount(apiType) {
  try {
    const today = getAusDateKey(); // YYYY-MM-DD (Australia/Sydney)
    const docRef = db.collection('metrics').doc(today);

    await docRef.set({
      [apiType]: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (error) {
    console.error('[Metrics] Failed to increment global count:', error && error.message ? error.message : error);
  }
}



// NOTE: 404 handler moved to the end of the file so all routes
// declared below (including scheduler user-scoped endpoints)
// are reachable. See end-of-file for the catch-all handler.

// ==================== SCHEDULER ENDPOINTS (USER-SCOPED) ====================
/**
 * Get scheduler segments for the authenticated user
 * Response: { errno: 0, result: { groups: [...], enable: boolean } }
 */


/**
 * Clear all scheduler segments (set to disabled / zeroed).
 * Sends directly to the device, same pattern as backend/server.js
 * Body: {}
 */
app.post('/api/scheduler/v1/clear-all', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userConfig = await getUserConfig(userId);
    const deviceSN = req.body.sn || req.body.deviceSN || userConfig?.deviceSn;
    
    if (!deviceSN) {
      return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    }
    
    console.log('[Scheduler] CLEAR-ALL request for device:', deviceSN);

    // Create 8 empty/disabled segments (matching device's actual group count)
    const emptyGroups = [];
    for (let i = 0; i < 8; i++) {
      emptyGroups.push({
        enable: 0,
        workMode: 'SelfUse',
        startHour: 0,
        startMinute: 0,
        endHour: 0,
        endMinute: 0,
        minSocOnGrid: 10,
        fdSoc: 10,
        fdPwr: 0,
        maxSoc: 100
      });
    }
    
    // Send to device via v1 API (primary - this is what works in server.js)
    const result = await callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: emptyGroups }, userConfig, userId);
    console.log('[Scheduler] Clear-all v1 result:', JSON.stringify(result).slice(0, 300));
    
    // Disable the scheduler flag
    let flagResult = null;
    try {
      flagResult = await callFoxESSAPI('/op/v1/device/scheduler/set/flag', 'POST', { deviceSN, enable: 0 }, userConfig, userId);
      console.log('[Scheduler] Clear-all flag result:', JSON.stringify(flagResult).slice(0, 200));
    } catch (flagErr) {
      console.warn('[Scheduler] Flag disable failed:', flagErr && flagErr.message ? flagErr.message : flagErr);
    }
    
    // Verification read
    let verify = null;
    try {
      verify = await callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN }, userConfig, userId);
      console.log('[Scheduler] Clear-all verify:', JSON.stringify(verify).slice(0, 500));
    } catch (e) {
      console.warn('[Scheduler] Verify read failed:', e && e.message ? e.message : e);
    }
    
    // Log to history
    try {
      await db.collection('users').doc(userId).collection('history').add({
        type: 'scheduler_clear',
        by: userId,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) { console.warn('[Scheduler] Failed to write history entry:', e && e.message); }

    res.json({ 
      errno: result.errno, 
      msg: result.msg || (result.errno === 0 ? 'Scheduler cleared' : 'Failed'),
      result: result.result,
      flagResult,
      verify: verify?.result || null
    });
  } catch (err) {
    console.error('[Scheduler] clear-all error:', err.message || err);
    res.status(500).json({ errno: 500, error: err.message || String(err) });
  }
});

// ==================== EXPORT EXPRESS APP AS CLOUD FUNCTION ====================
// Use the broadly-compatible onRequest export to avoid depending on newer SDK features
exports.api = functions.https.onRequest(app);

// ==================== SCHEDULED AUTOMATION ====================
/**
 * Scheduled automation is handled by the backend server.js in 1st Gen
 * Cloud Functions here only provides the API proxy and per-user endpoints
 */

/**
 * Evaluate a single automation rule - checks ALL conditions
 * ALL enabled conditions must be met for the rule to trigger
 */
async function evaluateRule(userId, ruleId, rule, cache, inverterData, userConfig, skipCooldown = false) {
  // skipCooldown: if true, we skip the cooldown check (used for re-evaluating active rules)
  const conditions = rule.conditions || {};
  const enabledConditions = [];
  const results = [];
  
  // Get current Sydney time for time-based conditions
  const sydney = getSydneyTime();
  const currentMinutes = sydney.hour * 60 + sydney.minute;
  
  // Parse inverter data
  let soc = null;
  let batTemp = null;
  let ambientTemp = null;
  if (inverterData?.result?.[0]?.datas) {
    const datas = inverterData.result[0].datas;
    const socData = datas.find(d => d.variable === 'SoC');
    const batTempData = datas.find(d => d.variable === 'batTemperature');
    const ambientTempData = datas.find(d => d.variable === 'ambientTemperation');
    soc = socData?.value ?? null;
    batTemp = batTempData?.value ?? null;
    ambientTemp = ambientTempData?.value ?? null;
  }
  
  // Parse Amber prices
  let feedInPrice = null;
  let buyPrice = null;
  if (Array.isArray(cache.amber)) {
    const feedInInterval = cache.amber.find(ch => ch.channelType === 'feedIn' && ch.type === 'CurrentInterval');
    const generalInterval = cache.amber.find(ch => ch.channelType === 'general' && ch.type === 'CurrentInterval');
    if (feedInInterval) feedInPrice = -feedInInterval.perKwh; // Convert to positive (what you earn)
    if (generalInterval) buyPrice = generalInterval.perKwh;
  }
  
  console.log(`[Automation] Evaluating rule '${rule.name}' - Live data: SoC=${soc}%, BatTemp=${batTemp}°C, FeedIn=${feedInPrice?.toFixed(1)}¢, Buy=${buyPrice?.toFixed(1)}¢`);
  
  // Check SoC condition (support both 'op' and 'operator' field names)
  if (conditions.soc?.enabled) {
    enabledConditions.push('soc');
    if (soc !== null) {
      const operator = conditions.soc.op || conditions.soc.operator;
      const value = conditions.soc.value;
      const value2 = conditions.soc.value2;
      let met = false;
      if (operator === 'between' && value2 !== undefined) {
        met = soc >= value && soc <= value2;
      } else {
        met = compareValue(soc, operator, value);
      }
      results.push({ condition: 'soc', met, actual: soc, operator, target: value });
      if (!met) {
        console.log(`[Automation] Rule '${rule.name}' - SoC condition NOT met: ${soc} ${operator} ${value} = false`);
      }
    } else {
      results.push({ condition: 'soc', met: false, reason: 'No SoC data' });
      console.log(`[Automation] Rule '${rule.name}' - SoC condition NOT met: No SoC data available`);
    }
  }
  
  // Check price condition (support both 'price' and 'feedInPrice/buyPrice' formats)
  // Frontend saves as conditions.price with 'type' field (feedIn or buy)
  const priceCondition = conditions.price;
  if (priceCondition?.enabled && priceCondition?.type) {
    const priceType = priceCondition.type; // 'feedIn' or 'buy'
    const actualPrice = priceType === 'feedIn' ? feedInPrice : buyPrice;
    enabledConditions.push('price');
    if (actualPrice !== null) {
      const operator = priceCondition.op || priceCondition.operator;
      const value = priceCondition.value;
      const value2 = priceCondition.value2;
      let met = false;
      if (operator === 'between' && value2 !== undefined) {
        met = actualPrice >= value && actualPrice <= value2;
      } else {
        met = compareValue(actualPrice, operator, value);
      }
      results.push({ condition: 'price', met, actual: actualPrice, operator, target: value, type: priceType });
      if (!met) {
        console.log(`[Automation] Rule '${rule.name}' - Price (${priceType}) condition NOT met: actual=${actualPrice} (type: ${typeof actualPrice}), target=${value} (type: ${typeof value}), operator=${operator}, result: ${actualPrice} ${operator} ${value} = false`);
      } else {
        console.log(`[Automation] Rule '${rule.name}' - Price (${priceType}) condition MET: ${actualPrice} ${operator} ${value} = true`);
      }
    } else {
      results.push({ condition: 'price', met: false, reason: 'No Amber price data' });
      console.log(`[Automation] Rule '${rule.name}' - Price condition NOT met: No Amber data available`);
    }
  }
  
  // Legacy: Check feed-in price condition (for old format rules)
  if (conditions.feedInPrice?.enabled) {
    enabledConditions.push('feedInPrice');
    if (feedInPrice !== null) {
      const operator = conditions.feedInPrice.op || conditions.feedInPrice.operator;
      const value = conditions.feedInPrice.value;
      const value2 = conditions.feedInPrice.value2;
      let met = false;
      if (operator === 'between' && value2 !== undefined) {
        met = feedInPrice >= value && feedInPrice <= value2;
      } else {
        met = compareValue(feedInPrice, operator, value);
      }
      results.push({ condition: 'feedInPrice', met, actual: feedInPrice, operator, target: value });
      if (!met) {
        console.log(`[Automation] Rule '${rule.name}' - FeedIn condition NOT met: actual=${feedInPrice} (type: ${typeof feedInPrice}), target=${value} (type: ${typeof value}), operator=${operator}, result: ${feedInPrice} ${operator} ${value} = false`);
      } else {
        console.log(`[Automation] Rule '${rule.name}' - FeedIn condition MET: ${feedInPrice} ${operator} ${value} = true`);
      }
    } else {
      results.push({ condition: 'feedInPrice', met: false, reason: 'No Amber data' });
      console.log(`[Automation] Rule '${rule.name}' - FeedIn condition NOT met: No Amber data available`);
    }
  }
  
  // Check buy price condition
  if (conditions.buyPrice?.enabled) {
    enabledConditions.push('buyPrice');
    if (buyPrice !== null) {
      const operator = conditions.buyPrice.op || conditions.buyPrice.operator;
      const value = conditions.buyPrice.value;
      const value2 = conditions.buyPrice.value2;
      let met = false;
      if (operator === 'between' && value2 !== undefined) {
        met = buyPrice >= value && buyPrice <= value2;
      } else {
        met = compareValue(buyPrice, operator, value);
      }
      results.push({ condition: 'buyPrice', met, actual: buyPrice, operator, target: value });
      if (!met) {
        console.log(`[Automation] Rule '${rule.name}' - BuyPrice condition NOT met: actual=${buyPrice} (type: ${typeof buyPrice}), target=${value} (type: ${typeof value}), operator=${operator}, result: ${buyPrice} ${operator} ${value} = false`);
      } else {
        console.log(`[Automation] Rule '${rule.name}' - BuyPrice condition MET: ${buyPrice} ${operator} ${value} = true`);
      }
    } else {
      results.push({ condition: 'buyPrice', met: false, reason: 'No Amber data' });
      console.log(`[Automation] Rule '${rule.name}' - BuyPrice condition NOT met: No Amber data available`);
    }
  }
  
  // Check temperature condition (support both 'temp' and 'temperature' with 'op' and 'operator')
  const tempCondition = conditions.temp || conditions.temperature;
  if (tempCondition?.enabled) {
    enabledConditions.push('temperature');
    const tempType = tempCondition.type || 'battery';
    const actualTemp = tempType === 'battery' ? batTemp : ambientTemp;
    if (actualTemp !== null) {
      const operator = tempCondition.op || tempCondition.operator;
      const value = tempCondition.value;
      const met = compareValue(actualTemp, operator, value);
      results.push({ condition: 'temperature', met, actual: actualTemp, operator, target: value, type: tempType });
      if (!met) {
        console.log(`[Automation] Rule '${rule.name}' - Temperature condition NOT met: ${actualTemp} ${operator} ${value} = false`);
      }
    } else {
      results.push({ condition: 'temperature', met: false, reason: `No ${tempType} temperature data` });
      console.log(`[Automation] Rule '${rule.name}' - Temperature condition NOT met: No ${tempType} temp data available`);
    }
  }
  
  // Check time window condition
  const timeCondition = conditions.time || conditions.timeWindow;
  if (timeCondition?.enabled) {
    enabledConditions.push('time');
    const startTime = timeCondition.startTime || timeCondition.start || '00:00';
    const endTime = timeCondition.endTime || timeCondition.end || '23:59';
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    const startMins = startH * 60 + startM;
    const endMins = endH * 60 + endM;
    
    let met = false;
    // Handle windows that cross midnight
    if (startMins <= endMins) {
      met = currentMinutes >= startMins && currentMinutes < endMins;
    } else {
      met = currentMinutes >= startMins || currentMinutes < endMins;
    }
    results.push({ condition: 'time', met, actual: `${sydney.hour}:${String(sydney.minute).padStart(2,'0')}`, window: `${startTime}-${endTime}` });
    if (!met) {
      console.log(`[Automation] Rule '${rule.name}' - Time condition NOT met: ${sydney.hour}:${String(sydney.minute).padStart(2,'0')} not in ${startTime}-${endTime}`);
    }
  }
  
  // Check solar radiation condition (new separate condition)
  if (conditions.solarRadiation?.enabled) {
    enabledConditions.push('solarRadiation');
    const weatherData = cache.weather;
    const hourly = weatherData?.result?.hourly || weatherData?.hourly;
    
    if (hourly?.shortwave_radiation && hourly?.time) {
      // Support lookAheadUnit: hours or days
      const lookAheadUnit = conditions.solarRadiation.lookAheadUnit || 'hours';
      const lookAheadValue = conditions.solarRadiation.lookAhead || 6;
      const lookAheadHours = lookAheadUnit === 'days' ? lookAheadValue * 24 : lookAheadValue;
      
      const threshold = conditions.solarRadiation.value || 200; // W/m² default
      const operator = conditions.solarRadiation.operator || '>';
      const checkType = conditions.solarRadiation.checkType || 'average';
      
      // Find NEXT hour index (skip current hour since it's partially elapsed)
      const now = new Date();
      const nowTimestamp = now.getTime();
      let startIdx = -1;
      for (let i = 0; i < hourly.time.length; i++) {
        const t = new Date(hourly.time[i]);
        // Find first hour that's in the future (not restricted to same day)
        if (t.getTime() > nowTimestamp) {
          startIdx = i;
          break;
        }
      }
      
      // If no future hours found, start from beginning (should not happen with proper weather data)
      if (startIdx === -1 && hourly.time.length > 0) {
        startIdx = 0;
      }
      
      // Get radiation values for next N hours (starting from NEXT hour, not current)
      const endIdx = Math.min(startIdx + lookAheadHours, hourly.shortwave_radiation.length);
      const radiationValues = hourly.shortwave_radiation.slice(startIdx, endIdx);
      const hoursRequested = lookAheadHours;
      const hoursRetrieved = radiationValues.length;
      
      if (radiationValues.length > 0) {
        let actualValue;
        if (checkType === 'min') {
          actualValue = Math.min(...radiationValues);
        } else if (checkType === 'max') {
          actualValue = Math.max(...radiationValues);
        } else {
          actualValue = radiationValues.reduce((a, b) => a + b, 0) / radiationValues.length;
        }
        
        const met = compareValue(actualValue, operator, threshold);
        const lookAheadDisplay = lookAheadUnit === 'days' ? `${lookAheadValue}d` : `${lookAheadValue}h`;
        
        // Warn if we got fewer hours than requested (incomplete timeframe)
        const hasIncompleteData = hoursRetrieved < hoursRequested;
        if (hasIncompleteData) {
          console.warn(`[Automation] Rule '${rule.name}' - Solar radiation: Only got ${hoursRetrieved} of ${hoursRequested} hours requested`);
        }
        
        results.push({ 
          condition: 'solarRadiation', 
          met, 
          actual: actualValue?.toFixed(0), 
          operator,
          target: threshold,
          unit: 'W/m²',
          lookAhead: lookAheadDisplay,
          checkType,
          hoursChecked: radiationValues.length,
          hoursRequested,
          incomplete: hasIncompleteData
        });
        if (!met) {
          console.log(`[Automation] Rule '${rule.name}' - Solar radiation NOT met: ${checkType} ${actualValue?.toFixed(0)} W/m² ${operator} ${threshold} W/m²`);
        }
      } else {
        results.push({ condition: 'solarRadiation', met: false, reason: 'No radiation data for timeframe' });
      }
    } else {
      results.push({ condition: 'solarRadiation', met: false, reason: 'No hourly radiation data' });
    }
  }
  
  // Check cloud cover condition (new separate condition)
  if (conditions.cloudCover?.enabled) {
    enabledConditions.push('cloudCover');
    const weatherData = cache.weather;
    const hourly = weatherData?.result?.hourly || weatherData?.hourly;
    
    if (hourly?.cloudcover && hourly?.time) {
      // Support lookAheadUnit: hours or days
      const lookAheadUnit = conditions.cloudCover.lookAheadUnit || 'hours';
      const lookAheadValue = conditions.cloudCover.lookAhead || 6;
      const lookAheadHours = lookAheadUnit === 'days' ? lookAheadValue * 24 : lookAheadValue;
      
      const threshold = conditions.cloudCover.value || 50; // % default
      const operator = conditions.cloudCover.operator || '<';
      const checkType = conditions.cloudCover.checkType || 'average';
      
      // Find NEXT hour index (skip current hour since it's partially elapsed)
      const now = new Date();
      const nowTimestamp = now.getTime();
      let startIdx = -1;
      for (let i = 0; i < hourly.time.length; i++) {
        const t = new Date(hourly.time[i]);
        // Find first hour that's in the future (not restricted to same day)
        if (t.getTime() > nowTimestamp) {
          startIdx = i;
          break;
        }
      }
      
      // If no future hours found, start from beginning (should not happen with proper weather data)
      if (startIdx === -1 && hourly.time.length > 0) {
        startIdx = 0;
      }
      
      const endIdx = Math.min(startIdx + lookAheadHours, hourly.cloudcover.length);
      const cloudValues = hourly.cloudcover.slice(startIdx, endIdx);
      const hoursRequested = lookAheadHours;
      const hoursRetrieved = cloudValues.length;
      
      if (cloudValues.length > 0) {
        let actualValue;
        if (checkType === 'min') {
          actualValue = Math.min(...cloudValues);
        } else if (checkType === 'max') {
          actualValue = Math.max(...cloudValues);
        } else {
          actualValue = cloudValues.reduce((a, b) => a + b, 0) / cloudValues.length;
        }
        
        const met = compareValue(actualValue, operator, threshold);
        const lookAheadDisplay = lookAheadUnit === 'days' ? `${lookAheadValue}d` : `${lookAheadValue}h`;
        
        // Warn if we got fewer hours than requested (incomplete timeframe)
        const hasIncompleteData = hoursRetrieved < hoursRequested;
        if (hasIncompleteData) {
          console.warn(`[Automation] Rule '${rule.name}' - Cloud cover: Only got ${hoursRetrieved} of ${hoursRequested} hours requested`);
        }
        
        results.push({ 
          condition: 'cloudCover', 
          met, 
          actual: actualValue?.toFixed(0), 
          operator,
          target: threshold,
          unit: '%',
          lookAhead: lookAheadDisplay,
          checkType,
          hoursChecked: cloudValues.length,
          hoursRequested,
          incomplete: hasIncompleteData
        });
        if (!met) {
          console.log(`[Automation] Rule '${rule.name}' - Cloud cover NOT met: ${checkType} ${actualValue?.toFixed(0)}% ${operator} ${threshold}%`);
        }
      } else {
        results.push({ condition: 'cloudCover', met: false, reason: 'No cloud cover data' });
      }
    } else {
      results.push({ condition: 'cloudCover', met: false, reason: 'No hourly cloud data' });
    }
  }
  
  // Legacy weather condition (for backward compatibility with old rules)
  if (conditions.weather?.enabled) {
    enabledConditions.push('weather');
    const weatherData = cache.weather;
    
    // Check if this is an old-style radiation/cloudcover rule (migrate to new format)
    if (conditions.weather.type === 'radiation' || conditions.weather.radiationEnabled ||
        conditions.weather.type === 'solar' || conditions.weather.type === 'cloudcover') {
      // This is a legacy rule using the old weather.type format - evaluate it for compatibility
      if (conditions.weather.type === 'solar' || conditions.weather.type === 'radiation' || conditions.weather.radiationEnabled) {
        const hourly = weatherData?.result?.hourly || weatherData?.hourly;
        if (hourly?.shortwave_radiation && hourly?.time) {
          const lookAheadHours = conditions.weather.radiationHours || conditions.weather.lookAheadHours || 6;
          const threshold = conditions.weather.radiationThreshold || 200;
          const rawOp = conditions.weather.radiationOp || '>';
          // Parse operator from combined string like 'avg>' or simple '>'
          const operator = rawOp.replace('avg', '').replace('min', '').replace('max', '') || '>';
          const checkType = rawOp.includes('min') ? 'min' : rawOp.includes('max') ? 'max' : 'average';
          
          const now = new Date();
          const currentHour = now.getHours();
          let startIdx = 0;
          for (let i = 0; i < hourly.time.length; i++) {
            const t = new Date(hourly.time[i]);
            if (t.getHours() >= currentHour && t.getDate() === now.getDate()) {
              startIdx = i;
              break;
            }
          }
          
          const endIdx = Math.min(startIdx + lookAheadHours, hourly.shortwave_radiation.length);
          const radiationValues = hourly.shortwave_radiation.slice(startIdx, endIdx);
          
          if (radiationValues.length > 0) {
            let actualValue;
            if (checkType === 'min') actualValue = Math.min(...radiationValues);
            else if (checkType === 'max') actualValue = Math.max(...radiationValues);
            else actualValue = radiationValues.reduce((a, b) => a + b, 0) / radiationValues.length;
            
            const met = compareValue(actualValue, operator, threshold);
            results.push({ condition: 'weather', met, type: 'radiation', actual: actualValue?.toFixed(0), operator, target: threshold, unit: 'W/m²', legacy: true });
          } else {
            results.push({ condition: 'weather', met: false, reason: 'No radiation data' });
          }
        } else {
          results.push({ condition: 'weather', met: false, reason: 'No hourly data' });
        }
      } else if (conditions.weather.type === 'cloudcover') {
        const hourly = weatherData?.result?.hourly || weatherData?.hourly;
        if (hourly?.cloudcover && hourly?.time) {
          const lookAheadHours = conditions.weather.cloudcoverHours || conditions.weather.lookAheadHours || 6;
          const threshold = conditions.weather.cloudcoverThreshold || 50;
          const rawOp = conditions.weather.cloudcoverOp || '<';
          const operator = rawOp.replace('avg', '').replace('min', '').replace('max', '') || '<';
          const checkType = rawOp.includes('min') ? 'min' : rawOp.includes('max') ? 'max' : 'average';
          
          const now = new Date();
          const currentHour = now.getHours();
          let startIdx = 0;
          for (let i = 0; i < hourly.time.length; i++) {
            const t = new Date(hourly.time[i]);
            if (t.getHours() >= currentHour && t.getDate() === now.getDate()) {
              startIdx = i;
              break;
            }
          }
          
          const endIdx = Math.min(startIdx + lookAheadHours, hourly.cloudcover.length);
          const cloudValues = hourly.cloudcover.slice(startIdx, endIdx);
          
          if (cloudValues.length > 0) {
            let actualValue;
            if (checkType === 'min') actualValue = Math.min(...cloudValues);
            else if (checkType === 'max') actualValue = Math.max(...cloudValues);
            else actualValue = cloudValues.reduce((a, b) => a + b, 0) / cloudValues.length;
            
            const met = compareValue(actualValue, operator, threshold);
            results.push({ condition: 'weather', met, type: 'cloudcover', actual: actualValue?.toFixed(0), operator, target: threshold, unit: '%', legacy: true });
          } else {
            results.push({ condition: 'weather', met: false, reason: 'No cloud data' });
          }
        } else {
          results.push({ condition: 'weather', met: false, reason: 'No hourly data' });
        }
      }
    }
    // Legacy weathercode-based condition (sunny/cloudy/rainy)
    else if (weatherData?.current_weather) {
      const currentCode = weatherData.current_weather.weathercode;
      const weatherType = conditions.weather.condition || conditions.weather.type || 'any';
      
      let met = false;
      if (weatherType === 'any') {
        met = true;
      } else if (weatherType === 'sunny' || weatherType === 'clear') {
        met = currentCode <= 1;
      } else if (weatherType === 'cloudy') {
        met = currentCode >= 2 && currentCode <= 48;
      } else if (weatherType === 'rainy') {
        met = currentCode >= 51;
      }
      
      const codeDesc = currentCode <= 1 ? 'Clear' : currentCode <= 3 ? 'Partly Cloudy' : currentCode <= 48 ? 'Cloudy/Fog' : currentCode <= 67 ? 'Rain' : 'Storm';
      results.push({ condition: 'weather', met, type: 'weathercode', actual: codeDesc, target: weatherType, weatherCode: currentCode, legacy: true });
      if (!met) {
        console.log(`[Automation] Rule '${rule.name}' - Weather condition NOT met: ${codeDesc} (code ${currentCode}) != ${weatherType}`);
      }
    } else {
      results.push({ condition: 'weather', met: false, reason: 'No weather data' });
    }
  }
  
  // Check forecast price condition (future amber prices - supports minutes, hours, or days)
  if (conditions.forecastPrice?.enabled) {
    enabledConditions.push('forecastPrice');
    const amberData = cache.amber;
    if (Array.isArray(amberData)) {
      const priceType = conditions.forecastPrice.type || 'general'; // 'general' (buy) or 'feedIn'
      const channelType = priceType === 'feedIn' ? 'feedIn' : 'general';
      
      // Support different time units: minutes (default), hours, days
      const lookAheadUnit = conditions.forecastPrice.lookAheadUnit || 'minutes';
      let lookAheadMinutes;
      if (lookAheadUnit === 'days') {
        lookAheadMinutes = (conditions.forecastPrice.lookAhead || 1) * 24 * 60;
      } else if (lookAheadUnit === 'hours') {
        lookAheadMinutes = (conditions.forecastPrice.lookAhead || 1) * 60;
      } else {
        lookAheadMinutes = conditions.forecastPrice.lookAhead || 30;
      }
      
      const intervalsNeeded = Math.ceil(lookAheadMinutes / 5); // 5-min intervals
      
      // Get forecast intervals for the specified channel
      const forecasts = amberData.filter(p => p.channelType === channelType && p.type === 'ForecastInterval');
      const relevantForecasts = forecasts.slice(0, intervalsNeeded);
      
      // LOG: Show what forecast data we have
      console.log(`[ForecastPrice] Rule '${rule.name}' - Type: ${priceType}, CheckType: ${conditions.forecastPrice.checkType || 'average'}`);
      console.log(`[ForecastPrice] Requested: ${lookAheadMinutes} minutes (${intervalsNeeded} intervals)`);
      console.log(`[ForecastPrice] Found ${forecasts.length} forecast intervals in Amber data`);
      if (forecasts.length > 0) {
        const firstTime = new Date(forecasts[0].startTime).toLocaleTimeString('en-AU', {hour12:false, timeZone:'Australia/Sydney'});
        const lastTime = new Date(forecasts[forecasts.length - 1].startTime).toLocaleTimeString('en-AU', {hour12:false, timeZone:'Australia/Sydney'});
        console.log(`[ForecastPrice] Time range: ${firstTime} to ${lastTime}`);
        // Show first 5 prices to see what we're working with
        const firstPrices = forecasts.slice(0, 5).map(f => `${new Date(f.startTime).toLocaleTimeString('en-AU', {hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Australia/Sydney'})}=${(priceType === 'feedIn' ? -f.perKwh : f.perKwh).toFixed(1)}¢`);
        console.log(`[ForecastPrice] First 5 prices: ${firstPrices.join(', ')}`);
      }
      
      // Check if we got fewer intervals than requested (Amber API limit is ~12 intervals = 1 hour)
      const intervalsRequested = intervalsNeeded;
      const intervalsActuallyAvailable = forecasts.length;
      const hasIncompleteData = relevantForecasts.length < intervalsNeeded;
      
      if (hasIncompleteData && intervalsActuallyAvailable < intervalsNeeded) {
        console.warn(`[Automation] Rule '${rule.name}' - Forecast ${priceType}: Only ${intervalsActuallyAvailable} intervals available in Amber API (limit ~1 hour), but requested ${lookAheadMinutes} minutes`);
      }
      
      if (relevantForecasts.length > 0) {
        // Calculate average or check specific criteria
        const checkType = conditions.forecastPrice.checkType || 'average'; // 'average', 'min', 'max', 'any'
        const prices = relevantForecasts.map(f => priceType === 'feedIn' ? -f.perKwh : f.perKwh);
        
        // LOG: Show all prices being considered
        console.log(`[ForecastPrice] Evaluating ${relevantForecasts.length} intervals, prices: ${prices.map(p => p.toFixed(1)).join(', ')}`);
        
        let actualValue;
        if (checkType === 'min') {
          actualValue = Math.min(...prices);
        } else if (checkType === 'max') {
          actualValue = Math.max(...prices);
        } else if (checkType === 'any') {
          actualValue = prices.find(p => compareValue(p, conditions.forecastPrice.operator, conditions.forecastPrice.value));
        } else {
          actualValue = prices.reduce((a, b) => a + b, 0) / prices.length; // average
        }
        
        console.log(`[ForecastPrice] Calculated ${checkType}: ${actualValue?.toFixed(1)}¢ (comparing ${conditions.forecastPrice.operator} ${conditions.forecastPrice.value}¢)`);

        
        const operator = conditions.forecastPrice.operator;
        const value = conditions.forecastPrice.value;
        const met = checkType === 'any' ? actualValue !== undefined : compareValue(actualValue, operator, value);
        
        // Format lookAhead for display
        const lookAheadDisplay = lookAheadUnit === 'days' 
          ? `${conditions.forecastPrice.lookAhead}d`
          : lookAheadUnit === 'hours'
          ? `${conditions.forecastPrice.lookAhead}h`
          : `${conditions.forecastPrice.lookAhead}m`;
        
        results.push({ 
          condition: 'forecastPrice', 
          met, 
          actual: actualValue?.toFixed(1), 
          operator, 
          target: value, 
          type: priceType, 
          lookAhead: lookAheadDisplay,
          lookAheadMinutes,
          checkType,
          intervalsChecked: relevantForecasts.length,
          intervalsAvailable: forecasts.length,
          incomplete: hasIncompleteData
        });
        if (!met) {
          console.log(`[Automation] Rule '${rule.name}' - Forecast ${priceType} condition NOT met: ${checkType} ${actualValue?.toFixed(1)}¢ ${operator} ${value}¢ (${lookAheadDisplay})`);
        }
      } else {
        results.push({ condition: 'forecastPrice', met: false, reason: 'No forecast data' });
        console.log(`[Automation] Rule '${rule.name}' - Forecast price condition NOT met: No forecast data available`);
      }
    } else {
      results.push({ condition: 'forecastPrice', met: false, reason: 'No Amber data' });
      console.log(`[Automation] Rule '${rule.name}' - Forecast price condition NOT met: No Amber data available`);
    }
  }
  
  // Determine if all conditions are met
  const allMet = results.length > 0 && results.every(r => r.met);
  
  if (enabledConditions.length === 0) {
    console.log(`[Automation] Rule '${rule.name}' - No conditions enabled, skipping`);
    return { triggered: false, reason: 'No conditions enabled' };
  }
  
  if (allMet) {
    console.log(`[Automation] Rule '${rule.name}' - ALL ${enabledConditions.length} conditions MET!`);
    return { triggered: true, results };
  }
  
  console.log(`[Automation] Rule '${rule.name}' - Not all conditions met (${results.filter(r => r.met).length}/${results.length})`);
  return { triggered: false, results };
}

/**
 * Compare a value using an operator
 */
function compareValue(actual, operator, target) {
  if (actual === null || actual === undefined) return false;
  switch (operator) {
    case '>': return actual > target;
    case '>=': return actual >= target;
    case '<': return actual < target;
    case '<=': return actual <= target;
    case '==': return actual == target;
    case '!=': return actual != target;
    case 'between':
      // For "between" operator, target should be an object with min/max or an array [min, max]
      if (Array.isArray(target)) return actual >= target[0] && actual <= target[1];
      if (target && typeof target === 'object') return actual >= (target.min || 0) && actual <= (target.max || 100);
      return false;
    default: return false;
  }
}

/**
 * Helper to get Sydney time components
 */
function getSydneyTime() {
  const now = new Date();
  const sydneyStr = now.toLocaleString('en-AU', { timeZone: 'Australia/Sydney', hour12: false });
  // Parse "DD/MM/YYYY, HH:MM:SS" format
  const [datePart, timePart] = sydneyStr.split(', ');
  const [day, month, year] = datePart.split('/');
  const [hour, minute, second] = timePart.split(':');
  // IMPORTANT: Some Node.js/ICU versions return hour "24" for midnight instead of "00"
  // Normalize to 0-23 range for FoxESS API compatibility
  const parsedHour = parseInt(hour, 10);
  const normalizedHour = parsedHour === 24 ? 0 : parsedHour;
  return {
    hour: normalizedHour,
    minute: parseInt(minute, 10),
    second: parseInt(second, 10),
    day: parseInt(day, 10),
    month: parseInt(month, 10),
    year: parseInt(year, 10),
    dayOfWeek: now.getDay() // 0 = Sunday, 6 = Saturday
  };
}

/**
 * Helper to add minutes to a time
 */
function addMinutes(hour, minute, addMins) {
  const totalMins = hour * 60 + minute + addMins;
  return {
    hour: Math.floor(totalMins / 60) % 24,
    minute: totalMins % 60
  };
}

/**
 * Apply a rule's action - creates/updates scheduler segment on device
 * Uses the same v1 API pattern as the manual scheduler endpoints
 */
async function applyRuleAction(userId, rule, userConfig) {
  const action = rule.action || {};
  const deviceSN = userConfig?.deviceSn;
  
  if (!deviceSN) {
    console.warn(`[Automation] Cannot apply rule action - no deviceSN for user ${userId}`);
    return { errno: -1, msg: 'No device SN configured' };
  }
  
  console.log(`[Automation] Applying action for user ${userId}:`, JSON.stringify(action).slice(0, 300));
  
  // Get current time in Sydney timezone
  const sydney = getSydneyTime();
  const startHour = sydney.hour;
  const startMinute = sydney.minute;
  
  // Calculate end time based on duration
  const durationMins = action.durationMinutes || 30;
  const endTimeObj = addMinutes(startHour, startMinute, durationMins);
  const endHour = endTimeObj.hour;
  const endMinute = endTimeObj.minute;
  
  console.log(`[Automation] Creating segment: ${String(startHour).padStart(2,'0')}:${String(startMinute).padStart(2,'0')} - ${String(endHour).padStart(2,'0')}:${String(endMinute).padStart(2,'0')} (${durationMins}min)`);
  
  // Get current scheduler from device (v1 API)
  let currentGroups = [];
  try {
    const currentScheduler = await callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN }, userConfig, userId);
    if (currentScheduler.errno === 0 && currentScheduler.result?.groups) {
      currentGroups = JSON.parse(JSON.stringify(currentScheduler.result.groups)); // Deep copy
      console.log(`[Automation] Got ${currentGroups.length} groups from device`);
    }
  } catch (e) {
    console.warn('[Automation] Failed to get current scheduler:', e && e.message ? e.message : e);
  }
  
  // Ensure we have at least one group (don't pad to 10 - use device's actual count)
  if (currentGroups.length === 0) {
    currentGroups.push({
      enable: 0,
      workMode: 'SelfUse',
      startHour: 0, startMinute: 0,
      endHour: 0, endMinute: 0,
      minSocOnGrid: 10,
      fdSoc: 10,
      fdPwr: 0,
      maxSoc: 100
    });
  }
  
  // Clear all existing enabled segments (same as backend server.js does)
  // This avoids FoxESS reordering issues and ensures clean state
  let clearedCount = 0;
  currentGroups.forEach((group, idx) => {
    if (group.enable === 1 || group.startHour !== 0 || group.startMinute !== 0 || group.endHour !== 0 || group.endMinute !== 0) {
      currentGroups[idx] = {
        enable: 0,
        workMode: 'SelfUse',
        startHour: 0, startMinute: 0,
        endHour: 0, endMinute: 0,
        minSocOnGrid: 10,
        fdSoc: 10,
        fdPwr: 0,
        maxSoc: 100
      };
      clearedCount++;
    }
  });
  if (clearedCount > 0) {
    console.log(`[Automation] Cleared ${clearedCount} existing segment(s)`);
  }
  
  // Build the new segment (V1 flat structure)
  const segment = {
    enable: 1,
    workMode: action.workMode || 'SelfUse',
    startHour,
    startMinute,
    endHour,
    endMinute,
    minSocOnGrid: action.minSocOnGrid ?? 20,
    fdSoc: action.fdSoc ?? 35,
    fdPwr: action.fdPwr ?? 0,
    maxSoc: action.maxSoc ?? 90
  };
  
  // Always use Group 1 (index 0) for automation - clean slate approach
  currentGroups[0] = segment;
  
  console.log(`[Automation] Applying segment: ${String(startHour).padStart(2,'0')}:${String(startMinute).padStart(2,'0')}-${String(endHour).padStart(2,'0')}:${String(endMinute).padStart(2,'0')} ${segment.workMode} fdSoc=${segment.fdSoc}`);
  
  // Send to device via v1 API with retry logic (up to 3 attempts)
  let applyAttempt = 0;
  let result = null;
  while (applyAttempt < 3) {
    applyAttempt++;
    result = await callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: currentGroups }, userConfig, userId);
    
    if (result?.errno === 0) {
      console.log(`[Automation] ✓ Segment sent (attempt ${applyAttempt})`);
      break;
    } else {
      console.warn(`[Automation] Attempt ${applyAttempt} failed: errno=${result?.errno}`);
      if (applyAttempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
    }
  }
  
  if (result?.errno !== 0) {
    console.error(`[Automation] ❌ Segment failed after 3 attempts: ${result?.msg}`);
    return {
      errno: result?.errno || -1,
      msg: result?.msg || 'Failed to apply segment after 3 retry attempts',
      segment,
      flagResult: null,
      verify: null,
      retrysFailed: true
    };
  }
  
  // Set the scheduler flag to enabled (required for FoxESS app to show schedule)
  let flagResult = null;
  let flagAttempt = 0;
  while (flagAttempt < 2) {
    flagAttempt++;
    try {
      flagResult = await callFoxESSAPI('/op/v1/device/scheduler/set/flag', 'POST', { deviceSN, enable: 1 }, userConfig, userId);
      if (flagResult?.errno === 0) {
        console.log(`[Automation] ✓ Flag set successfully (attempt ${flagAttempt})`);
        break;
      } else {
        console.warn(`[Automation] Flag set attempt ${flagAttempt} failed: errno=${flagResult?.errno}`);
      }
    } catch (flagErr) {
      console.warn('[Automation] Flag set attempt failed:', flagErr && flagErr.message ? flagErr.message : flagErr);
    }
    if (flagAttempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 800));
    }
  }
  
  // Wait 3 seconds for FoxESS to process the request before verification
  // Extended from 2s to 3s for better reliability
  console.log(`[Automation] ⏳ Waiting 3s for FoxESS to process...`);
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Verification read to confirm device accepted the segment (with retry)
  let verify = null;
  let verifyAttempt = 0;
  while (verifyAttempt < 2) {
    verifyAttempt++;
    try {
      verify = await callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN }, userConfig, userId);
      if (verify?.errno === 0) {
        console.log(`[Automation] ✓ Verification read successful (attempt ${verifyAttempt}): groups count=${verify?.result?.groups?.length || 0}`);
        break;
      } else {
        console.warn(`[Automation] Verification read attempt ${verifyAttempt} failed: errno=${verify?.errno}`);
      }
    } catch (verifyErr) {
      console.warn(`[Automation] Verification read attempt ${verifyAttempt} error:`, verifyErr.message);
    }
    if (verifyAttempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  if (verify?.result?.groups?.[0]) {
    if (verify.result.groups[0].enable === 1) {
      console.log(`[Automation] ✓ Segment CONFIRMED on device`);
    }
  }
  
  // Log to user history
  try {
    await addHistoryEntry(userId, {
      type: 'automation_action',
      ruleName: rule.name,
      action,
      segment,
      result: result.errno === 0 ? 'success' : 'failed',
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.warn('[Automation] Failed to log history:', e && e.message ? e.message : e);
  }
  
  return {
    errno: result.errno,
    msg: result.msg || (result.errno === 0 ? 'Segment applied' : 'Failed'),
    segment,
    flagResult,
    verify: verify?.result || null,
    retrysFailed: false
  };
}

// ==================== USER CREATION TRIGGER ====================
/**
 * When a new user is created, initialize their Firestore documents
 * NOTE: This trigger is called manually from the frontend after sign-up
 * In future, we can use Firebase Auth triggers if available
 */
app.post('/api/auth/init-user', async (req, res) => {
  try {
    const userId = req.user.uid;
    const { email, displayName } = req.user;
    
    // Create user profile
    await db.collection('users').doc(userId).set({
      email,
      displayName: displayName || '',
      photoURL: req.user.photoURL || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    // Create default config
    await db.collection('users').doc(userId).collection('config').doc('main').set({
      deviceSn: '',
      foxessToken: '',
      amberApiKey: '',
      amberSiteId: '',
      weatherPlace: 'Sydney',
      automation: {
        intervalMs: 60000,
        enabled: true
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    // Create default automation state
    await db.collection('users').doc(userId).collection('automation').doc('state').set({
      enabled: false, // Disabled by default until user configures
      lastCheck: null,
      lastTriggered: null,
      activeRule: null
    }, { merge: true });
    
    console.log(`[Auth] User ${userId} initialized successfully`);
    res.json({ errno: 0, msg: 'User initialized' });
  } catch (error) {
    console.error('[Auth] Error initializing user:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// ==================== USER DELETION TRIGGER ====================
/**
 * When a user is deleted, clean up their Firestore documents
 * NOTE: This endpoint should be called before deleting the Firebase Auth user
 */
app.post('/api/auth/cleanup-user', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.log(`[Auth] Cleaning up user: ${userId}`);
    
    // Delete user's subcollections
    const subcollections = ['config', 'automation', 'rules', 'history', 'notifications', 'metrics'];
    for (const subcol of subcollections) {
      const snapshot = await db.collection('users').doc(userId).collection(subcol).get();
      const batch = db.batch();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
    
    // Delete user document
    await db.collection('users').doc(userId).delete();
    
    console.log(`[Auth] User ${userId} data cleaned up successfully`);
    res.json({ errno: 0, msg: 'User data deleted' });
  } catch (error) {
    console.error(`[Auth] Error cleaning up user:`, error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// ==================== INVERTER HISTORY ENDPOINT ====================
/**
 * Get inverter history data from FoxESS API
 * Handles large date ranges by splitting into 24-hour chunks
 * Caches results in Firestore to reduce API calls
 */
app.get('/api/inverter/history', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userConfig = await getUserConfig(userId);
    const sn = req.query.sn || userConfig?.deviceSn;
    
    if (!sn) {
      return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    }
    
    let begin = Number(req.query.begin);
    let end = Number(req.query.end);

    const DEFAULT_RANGE_MS = 24 * 60 * 60 * 1000;

    if (!Number.isFinite(begin)) begin = Date.now() - DEFAULT_RANGE_MS;
    if (!Number.isFinite(end)) end = Date.now();

    // Normalize to milliseconds (FoxESS expects ms)
    if (begin < 1e12) begin *= 1000;
    if (end < 1e12) end *= 1000;

    begin = Math.floor(begin);
    end = Math.floor(end);
    
    console.log(`[History] Requesting: begin=${begin} (${new Date(begin).toISOString()}), end=${end} (${new Date(end).toISOString()}), sn=${sn}`);
    
    // Set a strict timeout for the FoxESS call
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Request timeout')), 9000)
    );
    
    try {
      const MAX_RANGE_MS = 24 * 60 * 60 * 1000; // 24 hours per FoxESS request

      // If the requested window is small, call FoxESS once. For larger windows, split into chunks and merge results.
      if ((end - begin) <= MAX_RANGE_MS) {
        // Check cache first
        const cachedResult = await getHistoryFromCacheFirestore(userId, sn, begin, end);
        if (cachedResult) {
          console.log(`[History] Cache HIT for single chunk ${new Date(begin).toISOString()} - ${new Date(end).toISOString()}`);
          return res.json(cachedResult);
        }
        
        const result = await Promise.race([
          callFoxESSAPI('/op/v0/device/history/query', 'POST', {
            sn,
            begin,
            end,
            variables: ['generationPower', 'feedinPower', 'gridConsumptionPower']
          }, userConfig, userId),
          timeoutPromise
        ]);
        
        // Cache successful response
        if (result && result.errno === 0) {
          await setHistoryToCacheFirestore(userId, sn, begin, end, result).catch(e => console.warn('[History] Cache write failed:', e.message));
        }
        
        return res.json(result);
      }

      // Build chunk ranges
      const chunks = [];
      let cursor = begin;
      while (cursor < end) {
        const chunkEnd = Math.min(end, cursor + MAX_RANGE_MS - 1);
        chunks.push({ cbeg: cursor, cend: chunkEnd });
        cursor = chunkEnd + 1;
      }

      // Aggregate results per variable
      const aggMap = {}; // variable -> array of {time, value}
      let deviceSN = sn;

      for (const ch of chunks) {
        // Check cache for this chunk
        let chunkResp = await getHistoryFromCacheFirestore(userId, sn, ch.cbeg, ch.cend);
        if (chunkResp) {
          console.log(`[History] Cache HIT for chunk ${new Date(ch.cbeg).toISOString()} - ${new Date(ch.cend).toISOString()}`);
        } else {
          chunkResp = await callFoxESSAPI('/op/v0/device/history/query', 'POST', {
            sn,
            begin: ch.cbeg,
            end: ch.cend,
            variables: ['generationPower', 'feedinPower', 'gridConsumptionPower']
          }, userConfig, userId);
          
          // Cache successful chunk response
          if (chunkResp && chunkResp.errno === 0) {
            await setHistoryToCacheFirestore(userId, sn, ch.cbeg, ch.cend, chunkResp).catch(e => console.warn('[History] Cache write failed:', e.message));
          }
        }

        if (!chunkResp || chunkResp.errno !== 0) {
          // Bubble up the upstream error
          const errMsg = chunkResp && chunkResp.msg ? chunkResp.msg : 'Unknown FoxESS error';
          console.warn(`[History] FoxESS chunk error for ${new Date(ch.cbeg).toISOString()} - ${new Date(ch.cend).toISOString()}: ${errMsg}`);
          return res.status(500).json({ errno: chunkResp?.errno || 500, msg: `FoxESS API error: ${errMsg}` });
        }

        const r = Array.isArray(chunkResp.result) && chunkResp.result[0] ? chunkResp.result[0] : null;
        if (!r) continue;
        deviceSN = r.deviceSN || deviceSN;

        const datas = Array.isArray(r.datas) ? r.datas : [];
        for (const item of datas) {
          const variable = item.variable || item.name || 'unknown';
          if (!Array.isArray(item.data)) continue;
          if (!aggMap[variable]) aggMap[variable] = [];
          // Append all points (chunks are non-overlapping)
          aggMap[variable].push(...item.data);
        }

        // Small delay to be kind to upstream when many chunks requested
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      // Merge & dedupe per-variable by time, then sort chronologically
      const mergedDatas = [];
      for (const [variable, points] of Object.entries(aggMap)) {
        const mapByTime = new Map();
        for (const p of points) {
          // Use the time string prefix (YYYY-MM-DD HH:MM:SS) as key when available
          const tKey = (typeof p.time === 'string' && p.time.length >= 19) ? p.time.substr(0, 19) : String(p.time);
          mapByTime.set(tKey, p);
        }
        // Convert back to array and sort by key (YYYY-MM-DD HH:MM:SS sorts lexicographically)
        const merged = Array.from(mapByTime.values()).sort((a, b) => {
          const ta = (typeof a.time === 'string' ? a.time.substr(0,19) : String(a.time));
          const tb = (typeof b.time === 'string' ? b.time.substr(0,19) : String(b.time));
          return ta < tb ? -1 : (ta > tb ? 1 : 0);
        });
        mergedDatas.push({ unit: 'kW', data: merged, name: variable, variable });
      }

      return res.json({ errno: 0, msg: 'Operation successful', result: [{ datas: mergedDatas, deviceSN }] });
    } catch (apiError) {
      console.warn(`[History] API error: ${apiError.message}`);
      res.status(500).json({ errno: 500, msg: `FoxESS API error: ${apiError.message}` });
    }
  } catch (error) {
    console.error(`[History] Request error: ${error.message}`);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

/**
 * Get inverter history from Firestore cache
 * Cache TTL: 30 minutes
 */
async function getHistoryFromCacheFirestore(userId, sn, begin, end) {
  try {
    const cacheKey = `history_${sn}_${begin}_${end}`;
    const docRef = db.collection('users').doc(userId).collection('cache').doc(cacheKey);
    const doc = await docRef.get();
    
    if (doc.exists) {
      const entry = doc.data();
      const ttl = 30 * 60 * 1000; // 30 minutes
      if (entry.timestamp && (Date.now() - entry.timestamp) < ttl) {
        return entry.data;
      }
      // Delete expired entry
      await docRef.delete().catch(() => {});
    }
    return null;
  } catch (error) {
    console.warn('[History] Cache get error:', error.message);
    return null;
  }
}

/**
 * Set inverter history to Firestore cache
 */
async function setHistoryToCacheFirestore(userId, sn, begin, end, data) {
  try {
    const cacheKey = `history_${sn}_${begin}_${end}`;
    const docRef = db.collection('users').doc(userId).collection('cache').doc(cacheKey);
    await docRef.set({
      timestamp: Date.now(),
      data: data,
      ttl: Math.floor(Date.now() / 1000) + (30 * 60) // Firestore TTL in seconds (30 min from now)
    });
  } catch (error) {
    console.warn('[History] Cache set error:', error.message);
    // Don't throw - cache is optional
  }
}

// ==================== 404 HANDLER ====================
// Catch-all for undefined routes to prevent HTML responses
app.use((req, res) => {
  res.status(404).json({ errno: 404, error: 'Endpoint not found' });
});
// ==================== CLOUD SCHEDULER: BACKGROUND AUTOMATION ====================
/**
 * Cloud Scheduler trigger: Orchestrates background automation for all users.
 * 
 * RESPECTS ALL BACKEND CONFIGURATION:
 * ✅ Uses getConfig().automation.intervalMs for cycle frequency (default 60000ms)
 * ✅ Uses getConfig().automation.cacheTtl for all API cache TTL
 * ✅ Respects per-user config: automation.intervalMs, automation.inverterCacheTtlMs
 * ✅ Checks lastCheck timestamp - only runs cycle if enough time elapsed
 * ✅ Uses existing cache functions: getCachedInverterData, getCachedWeatherData, callAmberAPI
 * ✅ Reuses POST /api/automation/cycle endpoint logic - zero duplication
 * ✅ Respects blackout windows, enabled state, all rule conditions
 * 
 * HOW IT WORKS:
 * 1. Runs every 1 minute (Cloud Scheduler frequency - can be more frequent than user cycles)
 * 2. For each user: checks if (now - lastCheck) >= userIntervalMs
 * 3. If yes: triggers automation cycle by calling the endpoint logic
 * 4. Endpoint handles ALL the work (cache, evaluation, segments, counters)
 */
exports.runAutomation = functions.pubsub
  .schedule('every 1 minutes')  // Check frequency - actual cycle timing controlled by intervalMs
  .timeZone('Australia/Sydney')
  .onRun(async (_context) => {
    const schedulerStartTime = Date.now();
    const schedId = `${schedulerStartTime}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`[Scheduler] ========== Background check ${schedId} START ==========`);
    
    try {
      // Get server config for default interval
      const serverConfig = getConfig();
      const defaultIntervalMs = serverConfig.automation.intervalMs; // Respects backend config!
      
      console.log(`[Scheduler] Config: defaultIntervalMs=${defaultIntervalMs}ms, cacheTTL=${JSON.stringify(serverConfig.automation.cacheTtl)}`);
      
      // Get all users
      const usersSnapshot = await db.collection('users').get();
      const totalUsers = usersSnapshot.size;
      
      console.log(`[Scheduler] Found ${totalUsers} users`);
      
      if (totalUsers === 0) {
        console.log(`[Scheduler] No users to check`);
        return null;
      }
      
      let cyclesRun = 0;
      let skippedTooSoon = 0;
      let skippedDisabled = 0;
      let errors = 0;
      
      // Check each user to see if they need a cycle
      for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        
        try {
          // Get user automation state
          const state = await getUserAutomationState(userId);
          
          // Skip if automation disabled
          if (state?.enabled === false) {
            skippedDisabled++;
            continue;
          }
          
          // Get user config
          const userConfig = await getUserConfig(userId);
          
          // Skip if no device configured
          if (!userConfig?.deviceSn) {
            skippedDisabled++;
            continue;
          }
          
          // Determine interval for this user (per-user config overrides default)
          const userIntervalMs = userConfig?.automation?.intervalMs || defaultIntervalMs;
          
          // Check if enough time elapsed since last cycle
          const lastCheck = state?.lastCheck || 0;
          const elapsed = Date.now() - lastCheck;
          
          if (elapsed < userIntervalMs) {
            // Too soon - skip this user
            skippedTooSoon++;
            continue;
          }
          
          // Time to run a cycle for this user!
          console.log(`[Scheduler] User ${userId}: Triggering cycle (elapsed=${elapsed}ms, interval=${userIntervalMs}ms)`);
          
          // Create mock request/response to call the existing endpoint
          const mockReq = {
            user: { uid: userId },
            body: {},
            headers: {},
            get: () => null
          };
          
          let cycleResult = null;
          const mockRes = {
            json: (data) => {
              cycleResult = data;
              return mockRes;
            },
            status: () => mockRes,
            send: () => mockRes
          };
          
          // Find and call the /api/automation/cycle route handler
          const route = app._router.stack.find(layer => 
            layer.route && 
            layer.route.path === '/api/automation/cycle' && 
            layer.route.methods.post
          );
          
          if (route && route.route.stack[0]) {
            await route.route.stack[0].handle(mockReq, mockRes);
            
            if (cycleResult) {
              cyclesRun++;
              if (cycleResult.errno === 0) {
                const r = cycleResult.result;
                if (r?.triggered) {
                  console.log(`[Scheduler] User ${userId}: ✅ Rule '${r.rule?.name}' triggered`);
                } else if (r?.skipped) {
                  console.log(`[Scheduler] User ${userId}: ⏭️ Skipped: ${r.reason}`);
                } else {
                  console.log(`[Scheduler] User ${userId}: ✅ No rules matched`);
                }
              } else {
                errors++;
                console.error(`[Scheduler] User ${userId}: ❌ Error: ${cycleResult.error}`);
              }
            }
          } else {
            console.error(`[Scheduler] User ${userId}: ❌ Route /api/automation/cycle not found!`);
            errors++;
          }
          
        } catch (userErr) {
          errors++;
          console.error(`[Scheduler] User ${userId}: Exception: ${userErr.message}`);
        }
      }
      
      const duration = Date.now() - schedulerStartTime;
      console.log(`[Scheduler] ========== Background check ${schedId} COMPLETE ==========`);
      console.log(`[Scheduler] ${totalUsers} users: ${cyclesRun} cycles, ${skippedTooSoon} too soon, ${skippedDisabled} disabled, ${errors} errors (${duration}ms)`);
      
      return null;
      
    } catch (fatal) {
      console.error(`[Scheduler] FATAL:`, fatal);
      throw fatal;
    }
  });