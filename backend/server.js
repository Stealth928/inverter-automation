require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK (uses GOOGLE_APPLICATION_CREDENTIALS env var or Application Default Credentials)
let db = null;
try {
    // Production: use real credentials
    admin.initializeApp();
    db = admin.firestore();
    console.log('[Firebase] Admin SDK initialized successfully');
} catch (error) {
    console.warn('[Firebase] Admin SDK initialization failed:', error.message);
    // Continue anyway - backend will work without Firestore for per-user persistence
}

const app = express();
app.use(cors());
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

app.use(express.static(path.join(__dirname, '../frontend')));

let FOXESS_TOKEN = process.env.FOXESS_TOKEN;
const FOXESS_BASE_URL = process.env.FOXESS_BASE_URL || 'https://www.foxesscloud.com';
let DEVICE_SN = process.env.DEVICE_SN;
let AMBER_API_KEY = process.env.AMBER_API_KEY;
const AMBER_BASE_URL = process.env.AMBER_BASE_URL || 'https://api.amber.com.au/v1';
const PORT = process.env.PORT || 3000;

// Persistent cache for history chunks (reduces FoxESS API calls)
const HISTORY_CACHE_FILE = path.join(__dirname, 'history_cache.json');
const HISTORY_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ==================== HISTORY CACHE FUNCTIONS ====================
// Persistent cache for history chunks (30-day TTL, file-based)
function loadHistoryCache() {
    try {
        if (fs.existsSync(HISTORY_CACHE_FILE)) {
            const raw = fs.readFileSync(HISTORY_CACHE_FILE, 'utf8');
            return JSON.parse(raw) || {};
        }
    } catch (e) {
        console.warn('[HistoryCache] Failed to load cache:', e.message);
    }
    return {};
}

function saveHistoryCache(cache) {
    try {
        fs.writeFileSync(HISTORY_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
    } catch (e) {
        console.warn('[HistoryCache] Failed to save cache:', e.message);
    }
}

function getHistoryCacheKey(sn, begin, end) {
    return `${sn}:${begin}:${end}`;
}

function getHistoryFromCache(sn, begin, end) {
    const cache = loadHistoryCache();
    const key = getHistoryCacheKey(sn, begin, end);
    const entry = cache[key];
    if (entry && entry.timestamp && (Date.now() - entry.timestamp) < HISTORY_CACHE_TTL_MS) {
        return entry.data;
    }
    return null;
}

function setHistoryCache(sn, begin, end, data) {
    const cache = loadHistoryCache();
    const key = getHistoryCacheKey(sn, begin, end);
    cache[key] = { timestamp: Date.now(), data };
    // Prune expired entries
    const now = Date.now();
    for (const k of Object.keys(cache)) {
        if (!cache[k].timestamp || (now - cache[k].timestamp) > HISTORY_CACHE_TTL_MS) {
            delete cache[k];
        }
    }
    saveHistoryCache(cache);
}

// ==================== CONFIGURATION ====================
// Centralized configuration for all timing and thresholds
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Factory defaults - used when no config file exists or for reset
const FACTORY_DEFAULTS = {
    // Automation timing
    automation: {
        intervalMs: 60 * 1000,              // How often automation cycles run
        startDelayMs: 5000,                  // Delay before starting automation loop after server start
        gatherDataTimeoutMs: 8000,           // Timeout for gathering data in automation cycle
        blackoutWindows: []                  // Array of {start: 'HH:MM', end: 'HH:MM', days: [0-6]} - no automation during these times
    },
    
    // Cache TTLs - how long to cache data before refreshing
    cache: {
        amber: 60 * 1000,                    // 60 seconds - Amber prices change frequently
        inverter: 5 * 60 * 1000,             // 5 minutes - FoxESS has rate limits
        weather: 30 * 60 * 1000              // 30 minutes - weather changes slowly
    },
    
    // Default values for automation rules
    defaults: {
        cooldownMinutes: 5,                  // Default cooldown between rule triggers
        durationMinutes: 30,                 // Default segment duration
        fdPwr: 5000                          // Default force discharge power (watts)
    },
    
    // Logging settings
    logging: {
        level: 'info'                        // error, warn, info, debug
    },
    
    // API retry settings for external services
    api: {
        retryCount: 3,                       // Number of retries on failure
        retryDelayMs: 1000                   // Base delay between retries (exponential backoff)
    },
    // Notification defaults (prototype)
    notifications: {
        enabled: false,                    // Master switch for notification prototype
        provider: 'smtp',                  // 'smtp' currently supported
        cooldownMinutes: 60,               // Minimum minutes between identical notifications
        from: '',                          // From address for emails (use env SMTP_FROM if blank)
        to: '',                            // Default recipient for test notifications
        subjectPrefix: '[FoxESS]',         // Prefix for notification subjects
    },
    
    // Battery safety thresholds
    safety: {
        minSocPercent: 10,                   // Minimum SoC - prevent discharge below this
        maxSocPercent: 100                   // Maximum SoC - prevent charge above this
    }
};

// Active configuration - starts with factory defaults, then loads from file
let CONFIG = JSON.parse(JSON.stringify(FACTORY_DEFAULTS));

// Load config from file on startup
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
            const saved = JSON.parse(raw);
            // Deep merge saved config with factory defaults (so new keys get defaults)
            CONFIG = deepMergeConfig(FACTORY_DEFAULTS, saved);
            log('info', '[Config] Loaded configuration from file');
        } else {
            CONFIG = JSON.parse(JSON.stringify(FACTORY_DEFAULTS));
            log('info', '[Config] No config file found, using factory defaults');
        }
    } catch (e) {
        log('warn', '[Config] Failed to load config file, using factory defaults:', e.message);
        CONFIG = JSON.parse(JSON.stringify(FACTORY_DEFAULTS));
    }
}

// Save config to file
function saveConfig() {
    try {
        // Backup existing config
        if (fs.existsSync(CONFIG_FILE)) {
            const backupPath = CONFIG_FILE + '.bak';
            fs.copyFileSync(CONFIG_FILE, backupPath);
        }
        safeWriteJson(CONFIG_FILE, CONFIG);
        log('info', '[Config] Configuration saved to file');
    } catch (e) {
        log('error', '[Config] Failed to save config:', e.message);
    }
}

// Deep merge helper for config (preserves arrays, merges objects)
function deepMergeConfig(target, source) {
    const result = JSON.parse(JSON.stringify(target));
    for (const key of Object.keys(source)) {
        if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMergeConfig(target[key] || {}, source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

// ==================== LOGGING ====================
// Centralized logging with configurable level
const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function log(level, ...args) {
    const configLevel = LOG_LEVELS[CONFIG.logging?.level] ?? LOG_LEVELS.info;
    const msgLevel = LOG_LEVELS[level] ?? LOG_LEVELS.info;
    if (msgLevel <= configLevel) {
        const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}]`;
        if (level === 'error') console.error(prefix, ...args);
        else if (level === 'warn') console.warn(prefix, ...args);
        else console.log(prefix, ...args);
    }
}

// API call counters persisted daily to file
const COUNTS_FILE = path.join(__dirname, 'api_call_counts.json');
let apiCallCounts = {};

function loadApiCallCounts() {
    try {
        if (fs.existsSync(COUNTS_FILE)) {
            const raw = fs.readFileSync(COUNTS_FILE, 'utf8');
            apiCallCounts = JSON.parse(raw || '{}');
        } else {
            apiCallCounts = {};
        }
    } catch (e) {
        console.warn('Failed to load api call counts file, starting fresh', e.message);
        apiCallCounts = {};
    }
}

// Helper for atomic file writes to prevent corruption
function safeWriteJson(filePath, data) {
    try {
        const tempPath = `${filePath}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tempPath, filePath);
    } catch (e) {
        console.error(`Failed to save ${path.basename(filePath)}:`, e.message);
    }
}

// Legacy synchronous save kept for compatibility when immediate persistence is required
function saveApiCallCounts() {
    safeWriteJson(COUNTS_FILE, apiCallCounts);
}

// ----------------- Batched API call flushing -----------------
// We avoid synchronous disk writes on every increment by keeping pending
// increments in memory and flushing them at intervals.
const DEFAULT_API_CALLS_FLUSH_MS = (CONFIG?.metrics?.flushIntervalMs) || 10000; // 10s default
let pendingApiCallCounts = {}; // { dateKey: { foxess: n, amber: n, ... } }
let apiCountsFlushTimer = null;
let apiCountsFlushing = false;

function scheduleApiCountsFlush(delayMs = DEFAULT_API_CALLS_FLUSH_MS) {
    // If a timer is already set, leave it in place (debounce)
    if (apiCountsFlushTimer || apiCountsFlushing) return;
    apiCountsFlushTimer = setTimeout(() => {
        apiCountsFlushTimer = null;
        flushApiCallCounts().catch(err => console.error('[Metrics] flushApiCallCounts failed:', err.message));
    }, delayMs);
}

async function flushApiCallCounts() {
    // Don't re-enter
    if (apiCountsFlushing) return;
    try {
        apiCountsFlushing = true;
        // Merge pending into main counts, then persist to disk in one atomic operation
        const pending = JSON.parse(JSON.stringify(pendingApiCallCounts));
        // Clear pending first (so new increments go into a fresh bucket)
        pendingApiCallCounts = {};

        // Merge into main in-memory counts
        for (const dateKey of Object.keys(pending)) {
            ensureDateKey(dateKey);
            const dayPending = pending[dateKey];
            for (const api of Object.keys(dayPending)) {
                apiCallCounts[dateKey][api] = (apiCallCounts[dateKey][api] || 0) + (dayPending[api] || 0);
            }
        }

        // write asynchronously using promises (atomic via temp file)
        const tmpPath = `${COUNTS_FILE}.tmp`;
        await fs.promises.writeFile(tmpPath, JSON.stringify(apiCallCounts, null, 2), 'utf8');
        await fs.promises.rename(tmpPath, COUNTS_FILE);
        log('debug', `[Metrics] flushApiCallCounts: flushed counts to disk (dateKeys=${Object.keys(pending).length})`);
    } catch (e) {
        console.error('[Metrics] Error flushing API call counts:', e.message);
    } finally {
        apiCountsFlushing = false;
    }
}

// Ensure pending counters are flushed at shutdown
async function flushPendingAndExit(code = 0) {
    try {
        if (apiCountsFlushTimer) {
            clearTimeout(apiCountsFlushTimer);
            apiCountsFlushTimer = null;
        }
        // If there are pending counts, flush them
        if (Object.keys(pendingApiCallCounts).length > 0) {
            log('info', '[Metrics] flushPendingAndExit: Flushing pending api call counts before exit');
            await flushApiCallCounts();
        }
    } catch (e) {
        console.error('[Metrics] flushPendingAndExit error:', e.message);
    }
}

// Register shutdown handlers so we persist data before termination
process.on('SIGINT', async () => {
    await flushPendingAndExit(0);
    process.exit(0);
});
process.on('SIGTERM', async () => {
    await flushPendingAndExit(0);
    process.exit(0);
});
process.on('beforeExit', async () => {
    await flushPendingAndExit(0);
});
process.on('uncaughtException', async (err) => {
    try {
        console.error('[Metrics] Uncaught exception, flushing pending api counts before exit:', err && err.message);
        await flushPendingAndExit(1);
    } catch (e) {
        console.error('[Metrics] Error during uncaughtException handler:', e && e.message);
    } finally {
        // Exit with failure
        process.exit(1);
    }
});

function getDateKey(date = new Date()) {
    // Use Australia/Sydney timezone so counter resets at local midnight
    return date.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }); // YYYY-MM-DD
}

function ensureDateKey(key) {
    if (!apiCallCounts[key]) apiCallCounts[key] = { foxess: 0, amber: 0, weather: 0 };
}

function incrementApiCall(apiName) {
    try {
        // normalize
        const api = String(apiName || 'other').toLowerCase();
        const key = getDateKey();
        ensureDateKey(key);

        // update the authoritative in-memory counts immediately (fast)
        apiCallCounts[key][api] = (apiCallCounts[key][api] || 0) + 1;

        // record this increment in the pending delta so we can flush to disk in batches
        if (!pendingApiCallCounts[key]) pendingApiCallCounts[key] = {};
        pendingApiCallCounts[key][api] = (pendingApiCallCounts[key][api] || 0) + 1;

        // Debug log the increment - shown only in debug mode
        log('debug', `[Metrics] incrementApiCall (pending): ${api} => ${apiCallCounts[key][api]} (date=${key})`);

        // Schedule a batched flush rather than writing to disk every call
        scheduleApiCountsFlush();
    } catch (e) {
        console.error('incrementApiCall failed', e.message);
    }
}

// Load counters on startup
loadApiCallCounts();

// Load config from file on startup (after safeWriteJson is defined)
loadConfig();

// ==================== Automation Engine ====================
// Automation rules triggered by Amber prices, battery SoC, temperature, weather
// Persist automation state to file
const AUTOMATION_FILE = path.join(__dirname, 'automation_state.json');

let automationInterval = null;

// Cache for current data (updated each cycle)
let currentData = {
    amber: null,
    amberFetchedAt: null,
    inverter: null,
    inverterFetchedAt: null,
    weather: null,
    weatherFetchedAt: null,
    lastUpdate: null
};

// Cache TTL reference (uses CONFIG.cache)
const CACHE_TTL = CONFIG.cache;

const defaultAutomationState = {
    enabled: true,  // Master enable for all automation
    lastCheck: null,
    lastTriggered: null,
    activeRule: null,
    rules: {
        // No default rules - user will create their own
    }
};

let automationState = JSON.parse(JSON.stringify(defaultAutomationState)); // Deep copy

function loadAutomationState() {
    try {
        if (fs.existsSync(AUTOMATION_FILE)) {
            const raw = fs.readFileSync(AUTOMATION_FILE, 'utf8');
            const saved = JSON.parse(raw || '{}');
            // Deep merge saved state with defaults
            automationState = deepMerge(defaultAutomationState, saved);
            console.log('[Automation] State loaded from file');
        } else {
            automationState = JSON.parse(JSON.stringify(defaultAutomationState));
            console.log('[Automation] Using default state (no file)');
        }
    } catch (e) {
        console.warn('Failed to load automation state, using defaults', e.message);
        automationState = JSON.parse(JSON.stringify(defaultAutomationState));
    }
}

// Deep merge helper
function deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(target[key] || {}, source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

function saveAutomationState() {
    safeWriteJson(AUTOMATION_FILE, automationState);
}

// Load on startup
loadAutomationState();

// ---------------- Amber persistence & notification state ----------------
const AMBER_STORE_FILE = path.join(__dirname, 'amber_store.json');
const NOTIFICATIONS_FILE = path.join(__dirname, 'notifications.json');

// Load persisted amber store (keeps a small history of snapshots)
function loadAmberStore() {
    try {
        if (fs.existsSync(AMBER_STORE_FILE)) {
            const raw = fs.readFileSync(AMBER_STORE_FILE, 'utf8');
            return JSON.parse(raw || '[]');
        }
    } catch (e) {
        console.warn('[AmberStore] Failed to load store:', e.message);
    }
    return [];
}

function persistAmberSnapshot(siteId, payload) {
    try {
        const store = loadAmberStore();
        const entry = { ts: Date.now(), siteId: siteId || null, data: payload };
        store.unshift(entry);
        // Keep only the latest 200 entries to bound file size
        const trimmed = store.slice(0, 200);
        safeWriteJson(AMBER_STORE_FILE, trimmed);
        log('info', `[AmberStore] Persisted snapshot (site=${siteId}, intervals=${Array.isArray(payload) ? payload.length : 'n/a'})`);
        return true;
    } catch (e) {
        console.error('[AmberStore] persistAmberSnapshot error:', e.message);
        return false;
    }
}

// Notification state (record last notification times)
let notificationState = null;
function loadNotificationState() {
    try {
        if (fs.existsSync(NOTIFICATIONS_FILE)) {
            const raw = fs.readFileSync(NOTIFICATIONS_FILE, 'utf8');
            notificationState = JSON.parse(raw || '{}');
        } else {
            notificationState = {};
        }
    } catch (e) {
        console.warn('[Notify] Failed to load notifications file:', e.message);
        notificationState = {};
    }
}

function saveNotificationState() {
    try {
        safeWriteJson(NOTIFICATIONS_FILE, notificationState || {});
    } catch (e) {
        console.error('[Notify] Failed to save notifications file:', e.message);
    }
}

// Load on startup
loadNotificationState();

// Send a notification (prototype). Uses SMTP via nodemailer if SMTP env configured.
async function sendNotification(subject, text, opts = {}) {
    try {
        const enabled = (CONFIG.notifications && CONFIG.notifications.enabled) || process.env.NOTIFICATIONS_ENABLED === '1';
        if (!enabled) {
            log('info', '[Notify] Notifications disabled - would send:', subject);
            return { errno: 0, msg: 'disabled', simulated: true };
        }

        // Prepare subject prefix
        const prefix = (CONFIG.notifications && CONFIG.notifications.subjectPrefix) || process.env.NOTIFY_SUBJECT_PREFIX || '';
        const fullSubject = `${prefix} ${subject}`.trim();

        // Basic recipient
        const to = opts.to || CONFIG.notifications.to || process.env.NOTIFY_TO;
        const from = opts.from || CONFIG.notifications.from || process.env.NOTIFY_FROM || `foxess@${require('os').hostname()}`;

        if (!to) {
            log('warn', '[Notify] No recipient configured (to) - skipping send');
            return { errno: 1, msg: 'no recipient' };
        }

        // SMTP transport - requires SMTP_HOST/SMTP_PORT and credentials if needed
        const smtpHost = process.env.SMTP_HOST;
        if (!smtpHost) {
            log('warn', '[Notify] SMTP not configured (SMTP_HOST missing) - simulated send');
            return { errno: 0, msg: 'simulated', simulated: true };
        }

        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: parseInt(process.env.SMTP_PORT || '587', 10),
            secure: (process.env.SMTP_SECURE === '1' || process.env.SMTP_SECURE === 'true'),
            auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
        });

        const mail = {
            from,
            to,
            subject: fullSubject,
            text
        };

        const info = await transporter.sendMail(mail);
        log('info', `[Notify] Email sent: ${info && info.messageId ? info.messageId : JSON.stringify(info)}`);
        return { errno: 0, msg: 'sent', info };
    } catch (e) {
        console.error('[Notify] sendNotification error:', e.message);
        return { errno: 500, msg: e.message };
    }
}

// Scan amber intervals for spike descriptors and notify once per cooldown
async function checkAmberForSpikes(siteId, intervals) {
    try {
        if (!Array.isArray(intervals) || intervals.length === 0) return { fired: false };

        // find any upcoming interval flagged as spike
        const spikeFound = intervals.find(i => (i.spikeStatus && i.spikeStatus.toLowerCase() === 'spike') || (i.descriptor && String(i.descriptor).toLowerCase().includes('spike')));
        if (!spikeFound) return { fired: false };

        const key = `amber_spike_${siteId || 'default'}`;
        const lastTs = (notificationState && notificationState[key]) || 0;
        const cooldownMs = (CONFIG.notifications?.cooldownMinutes || 60) * 60 * 1000;
        if (Date.now() - lastTs < cooldownMs) {
            log('info', '[Notify] Spike detected but still in cooldown window - skipping');
            return { fired: false };
        }

        // Build message
        const when = spikeFound.nemTime || spikeFound.startTime || spikeFound.date || '';
        const price = spikeFound.perKwh !== undefined ? spikeFound.perKwh : ((spikeFound.advancedPrice && spikeFound.advancedPrice.predicted) || 'n/a');
        const subj = `Amber Spike forecast ${when}`;
        const body = `Spike detected for site ${siteId || 'unknown'} at ${when} - price: ${price}\n\nInterval details:\n${JSON.stringify(spikeFound, null, 2)}`;

        const result = await sendNotification(subj, body);
        if (result && result.errno === 0) {
            notificationState[key] = Date.now();
            saveNotificationState();
            return { fired: true, result };
        }
        return { fired: false, result };
    } catch (e) {
        console.error('[Notify] checkAmberForSpikes error:', e.message);
        return { fired: false };
    }
}

// Delay automation loop start until after server is listening
// This prevents startup hangs from API calls
let automationLoopStarted = false;

function startAutomationLoop() {
    if (automationInterval) clearInterval(automationInterval);
    console.log(`[Automation] Starting background loop (Interval: ${CONFIG.automation.intervalMs}ms)`);
    
    // Run immediately
    runAutomationCycle();
    
    // Schedule
    automationInterval = setInterval(runAutomationCycle, CONFIG.automation.intervalMs);
}

async function runAutomationCycle() {
    if (!automationState.enabled) {
        log('info', '[Automation] Master switch is OFF - skipping cycle');
        return;
    }
    
    // Check blackout windows
    if (isInBlackoutWindow()) {
        log('info', '[Automation] Currently in blackout window - skipping cycle');
        return;
    }
    
    // Update lastCheck at the START of cycle so frontend timer syncs properly
    automationState.lastCheck = Date.now();
    
    try {
        log('info', '[Automation] === Starting automation cycle ===');
        
        // 0. Gather all current data
        await gatherCurrentData();
        
        // 1. Check active segment status (ACTIVE CANCELLATION) - only if we have an active rule
        if (automationState.activeRule && automationState.activeSegmentEnabled) {
            // Fetch scheduler ONLY when we need to validate an active segment
            const schedulerData = await disableExpiredSegments();
            
            // FoxESS V1 API REORDERS groups - we can't rely on groupIdx!
            // Instead, find our segment by matching workMode + time window overlap
            const trackedSegment = automationState.activeSegment; // {startHour, startMinute, endHour, endMinute, workMode}
            
            if (!schedulerData || schedulerData.errno !== 0) {
                console.log(`[Automation] Could not fetch scheduler data - skipping active check this cycle`);
                // Don't clear state if we couldn't verify - try again next cycle
            } else if (schedulerData.result?.groups && trackedSegment) {
                
                // Find ANY enabled segment that matches our tracked segment (same times + mode)
                let foundGroup = null;
                let foundGroupIdx = -1;
                
                schedulerData.result.groups.forEach((g, i) => {
                    const isMatch = g.enable === 1 && 
                                   g.workMode === trackedSegment.workMode &&
                                   g.startHour === trackedSegment.startHour &&
                                   g.startMinute === trackedSegment.startMinute &&
                                   g.endHour === trackedSegment.endHour &&
                                   g.endMinute === trackedSegment.endMinute;
                    if (isMatch) {
                        foundGroup = g;
                        foundGroupIdx = i;
                    }
                });
                
                const actualSegmentActive = foundGroup !== null;
                console.log(`[Automation] Scheduler check: foundSegment=${actualSegmentActive}, foundGroupIdx=${foundGroupIdx + 1}`);
                
                // Update our tracked group index (FoxESS may have moved it)
                if (foundGroupIdx >= 0) {
                    automationState.activeGroupIdx = foundGroupIdx;
                }
                
                // Check if segment was disabled externally (manual override, app, expired)
                if (!actualSegmentActive) {
                    console.log(`[Automation] Active segment was disabled externally (expired/manual/app) - clearing state`);
                    automationState.activeRule = null;
                    automationState.activeSegmentEnabled = false;
                    automationState.activeGroupIdx = null;
                    automationState.activeSegment = null;
                    saveAutomationState();
                } else {
                    // Segment is still active - check if conditions still hold
                    console.log(`[Automation] Active segment found in Group ${foundGroupIdx + 1} - rule '${automationState.activeRule}' is currently running`);
                    const activeRuleName = automationState.activeRule;
                    const activeRule = automationState.rules[activeRuleName];
                    
                    if (activeRule && activeRule.enabled) {
                        // Re-evaluate the active rule's conditions (without triggering action)
                        const checkResult = await evaluateRuleConditionsOnly(activeRuleName, activeRule);
                        
                        if (!checkResult.allMet) {
                            console.log(`[Automation] Active rule '${activeRuleName}' conditions no longer met - CANCELLING segment NOW`);
                            const cancelResult = await cancelActiveSegment();
                            console.log(`[Automation] Cancel result: errno=${cancelResult?.errno}, msg=${cancelResult?.msg}`);
                            automationState.activeRule = null;
                            automationState.activeSegmentEnabled = false;
                            automationState.activeGroupIdx = null;
                            automationState.activeSegment = null;
                            saveAutomationState();
                        } else {
                            console.log(`[Automation] Active rule '${activeRuleName}' conditions still hold - segment continues`);
                        }
                    } else {
                        // Active rule was disabled or deleted - cancel segment
                        console.log(`[Automation] Active rule '${activeRuleName}' no longer enabled - CANCELLING segment NOW`);
                        const cancelResult = await cancelActiveSegment();
                        console.log(`[Automation] Cancel result: errno=${cancelResult?.errno}, msg=${cancelResult?.msg}`);
                        automationState.activeRule = null;
                        automationState.activeSegmentEnabled = false;
                        automationState.activeGroupIdx = null;
                        automationState.activeSegment = null;
                        saveAutomationState();
                    }
                }
            }
        } // No active rule - skip scheduler API call entirely
        
        // 2. Get rules sorted by priority (lower number = higher priority)
        const sortedRules = Object.entries(automationState.rules || {})
            .filter(([_, rule]) => rule.enabled)
            .sort((a, b) => (a[1].priority || 99) - (b[1].priority || 99));
        
        console.log(`[Automation Loop] Checking ${sortedRules.length} enabled rules by priority...`);
        
        // 3. Evaluate rules in priority order - first match wins
        for (const [ruleName, rule] of sortedRules) {
            // Check if this rule should bypass cooldown:
            // - No active segment: bypass cooldown for all rules (nothing active, fresh evaluation)
            // - Higher priority than active rule: bypass cooldown to allow override
            const noActiveSegment = !automationState.activeRule || !automationState.activeSegmentEnabled;
            const higherPriorityThanActive = automationState.activeRule && 
                                   automationState.activeRule !== ruleName &&
                                   (rule.priority || 99) < (automationState.rules[automationState.activeRule]?.priority || 99);
            const bypassCooldown = noActiveSegment || higherPriorityThanActive;
            
            console.log(`[Automation Loop] Evaluating rule '${ruleName}' (priority ${rule.priority || 99})...`);
            const result = await evaluateRule(ruleName, rule, false, null, bypassCooldown);
            console.log(`[Automation Loop] Rule '${ruleName}' result:`, { triggered: result?.triggered, reason: result?.reason });
            if (result && result.triggered) {
                console.log(`[Automation Loop] Rule '${ruleName}' TRIGGERED - stopping evaluation`);
                
                // If a different rule was active, it's been replaced by the new higher-priority rule
                // (applyRuleAction already disabled all other segments)
                automationState.activeSegmentEnabled = true;
                saveAutomationState();
                return; // Stop after first triggered rule
            }
        }
        
        console.log('[Automation Loop] No rules triggered');
    } catch (e) {
        console.error('[Automation Loop] Error in cycle:', e.message);
    }
}

// Gather current data from all sources (with timeouts and caching)
async function gatherCurrentData() {
    const TIMEOUT_MS = CONFIG.automation.gatherDataTimeoutMs;
    const now = Date.now();
    
    try {
        // Amber prices (cached for 60 seconds)
        if (!currentData.amber || !currentData.amberFetchedAt || (now - currentData.amberFetchedAt > CACHE_TTL.amber)) {
            try {
                const sites = await callAmberAPI('/sites', {}, 'Automation:gatherData:sites');
                if (Array.isArray(sites) && sites.length > 0) {
                    const siteId = sites[0].id;
                    const prices = await callAmberAPI(`/sites/${encodeURIComponent(siteId)}/prices/current`, { next: 1 }, 'Automation:gatherData:prices');
                    if (Array.isArray(prices)) {
                        currentData.amber = prices;
                        currentData.amberFetchedAt = now;
                        // Persist a snapshot for historical analysis
                        try { persistAmberSnapshot(siteId, prices); } catch (e) { log('warn','Could not persist amber snapshot:', e.message); }
                        // Check for spikes and optionally notify (prototype)
                        try { checkAmberForSpikes(siteId, prices).then(r => { if (r && r.fired) log('info','Spike notification fired'); }); } catch (e) { log('warn', 'checkAmberForSpikes error:', e.message); }
                    }
                }
            } catch (e) {
                console.warn('[Automation] Amber API error:', e.message);
            }
        }
        
        // Inverter data (cached for 5 minutes to respect FoxESS rate limits)
        if (!currentData.inverter || !currentData.inverterFetchedAt || (now - currentData.inverterFetchedAt > CACHE_TTL.inverter)) {
            console.log('[Automation] Fetching fresh inverter data...');
            try {
                if (DEVICE_SN) {
                    const inverterResp = await callFoxESSAPI('/op/v0/device/real/query', 'POST', {
                        sn: DEVICE_SN,
                        variables: ['SoC', 'batTemperature', 'ambientTemperation', 'pvPower', 'loadsPower', 'feedinPower', 'gridConsumptionPower']
                    }, 'Automation:gatherData:inverter');
                    if (inverterResp.errno === 0) {
                        currentData.inverter = inverterResp.result;
                        currentData.inverterFetchedAt = now;
                        console.log(`[Automation] Inverter data fetched successfully (${inverterResp.result?.length || 0} variables)`);
                    } else {
                        console.warn('[Automation] FoxESS API returned error:', inverterResp.errno, inverterResp.msg);
                    }
                } else {
                    console.warn('[Automation] DEVICE_SN not configured - cannot fetch inverter data');
                }
            } catch (e) {
                console.warn('[Automation] FoxESS API error:', e.message);
            }
        } else {
            const cacheAge = Math.round((now - currentData.inverterFetchedAt) / 1000);
            console.log(`[Automation] Using cached inverter data (${cacheAge}s old)`);
        }
        
        // Weather (cached for 30 minutes)
        if (!currentData.weather || !currentData.weatherFetchedAt || (now - currentData.weatherFetchedAt > CACHE_TTL.weather)) {
            try {
                const place = process.env.WEATHER_PLACE || 'Sydney';
                const payload = await callWeatherAPI(place, 3, TIMEOUT_MS, 'Automation:gatherData:weather');
                if (!payload || payload.errno) {
                    console.warn('[Automation] callWeatherAPI failed or returned error', payload);
                } else {
                    currentData.weather = payload.current;
                    currentData.weatherFetchedAt = now;
                }
            } catch (e) {
                console.warn('[Automation] Weather API error:', e.message);
            }
        }
        
        currentData.lastUpdate = now;
    } catch (e) {
        console.error('[Automation] Error gathering data:', e.message);
    }
}

// Extract values from current data
function extractDataValues() {
    const values = {
        feedInPrice: null,  // Earnings (positive when you earn)
        buyPrice: null,     // Cost to buy (positive)
        soc: null,          // Battery %
        temperature: null,  // Ambient temp
        batteryTemp: null,
        weatherCode: null,
        pvPower: null,
        loadPower: null
    };
    
    // Amber prices
    if (Array.isArray(currentData.amber)) {
        const feedIn = currentData.amber.find(ch => ch.channelType === 'feedIn' && ch.type === 'CurrentInterval');
        const general = currentData.amber.find(ch => ch.channelType === 'general' && ch.type === 'CurrentInterval');
        if (feedIn) values.feedInPrice = -feedIn.perKwh; // Negate: Amber negative = earnings
        if (general) values.buyPrice = general.perKwh;
    }
    
    // Inverter data - handle nested structure from FoxESS API
    if (Array.isArray(currentData.inverter) && currentData.inverter.length > 0) {
        // FoxESS returns: [{datas: [{variable: "SoC", value: 47}, ...]}]
        const dataArray = currentData.inverter[0]?.datas || currentData.inverter;
        for (const item of dataArray) {
            if (item.variable === 'SoC') values.soc = item.value;
            if (item.variable === 'ambientTemperation') values.temperature = item.value;
            if (item.variable === 'batTemperature') values.batteryTemp = item.value;
            if (item.variable === 'pvPower') values.pvPower = item.value;
            if (item.variable === 'loadsPower') values.loadPower = item.value;
        }
    } else {
        console.warn('[Automation] Inverter data is not available or not an array:', typeof currentData.inverter);
    }
    
    // Weather
    if (currentData.weather) {
        values.weatherCode = currentData.weather.weathercode;
        if (values.temperature === null) values.temperature = currentData.weather.temperature;
    }
    
    return values;
}

// Evaluate a single rule against current data
async function evaluateRule(ruleName, rule, dryRun = false, testTime = null, bypassCooldown = false) {
    const now = Date.now();
    const conditions = rule.conditions || {};
    const values = extractDataValues();
    
    // Check cooldown (skip in dry run or when bypassing for priority override)
    if (!dryRun && !bypassCooldown && rule.lastTriggered) {
        const cooldownMs = (rule.cooldownMinutes ?? CONFIG.defaults.cooldownMinutes) * 60 * 1000;
        if ((now - rule.lastTriggered) < cooldownMs) {
            console.log(`[Automation] Rule '${ruleName}' in cooldown`);
            return { triggered: false, reason: 'cooldown' };
        }
    }
    
    if (bypassCooldown && rule.lastTriggered) {
        console.log(`[Automation] Rule '${ruleName}' bypassing cooldown (higher priority override)`);
    }
    
    // Check all enabled conditions (AND logic)
    const results = [];
    
    // Feed-in price condition
    if (conditions.feedInPrice?.enabled) {
        const cond = conditions.feedInPrice;
        const met = compareValue(values.feedInPrice, cond.operator, cond.value);
        results.push({ name: 'feedInPrice', value: values.feedInPrice, target: `${cond.operator} ${cond.value}`, met });
    }
    
    // Buy price condition
    if (conditions.buyPrice?.enabled) {
        const cond = conditions.buyPrice;
        const met = compareValue(values.buyPrice, cond.operator, cond.value);
        results.push({ name: 'buyPrice', value: values.buyPrice, target: `${cond.operator} ${cond.value}`, met });
    }
    
    // SoC condition
    if (conditions.soc?.enabled) {
        const cond = conditions.soc;
        const met = compareValue(values.soc, cond.operator, cond.value);
        results.push({ name: 'soc', value: values.soc, target: `${cond.operator} ${cond.value}`, met });
    }
    
    // Temperature condition - respect configured type (battery / ambient)
    if (conditions.temperature?.enabled) {
        const cond = conditions.temperature;

        // Determine which temperature value to use
        // cond.type can be 'battery' or 'ambient' (default: 'battery' in rule creation)
        let tempValue = null;
        if (cond.type === 'battery') {
            tempValue = values.batteryTemp;
        } else if (cond.type === 'ambient') {
            tempValue = values.temperature;
        } else {
            // Fallback: prefer ambient if present, otherwise battery
            tempValue = values.temperature != null ? values.temperature : values.batteryTemp;
        }

        const met = compareValue(tempValue, cond.operator, cond.value);
        results.push({ name: 'temperature', type: cond.type || 'auto', value: tempValue, target: `${cond.operator} ${cond.value}`, met });
    }
    
    // Weather code condition
    if (conditions.weatherCode?.enabled) {
        const cond = conditions.weatherCode;
        const codes = cond.codes || [];
        const met = codes.includes(values.weatherCode);
        results.push({ name: 'weatherCode', value: values.weatherCode, target: `in [${codes.join(',')}]`, met });
    }
    
    // Time window condition - support both 'time' and legacy 'timeWindow' formats
    const timeCond = conditions.time || conditions.timeWindow;
    if (timeCond?.enabled) {
        let currentHour, currentMinute;
        if (testTime && testTime.trim() !== '') {
            // Use provided test time (HH:MM format)
            const [h, m] = testTime.split(':').map(Number);
            currentHour = h;
            currentMinute = m;
        } else {
            // Use current Sydney time
            const sydney = getSydneyTime();
            currentHour = sydney.hour;
            currentMinute = sydney.minute;
        }
        const currentMins = currentHour * 60 + currentMinute;
        const startTime = timeCond.startTime || timeCond.start || '00:00';
        const endTime = timeCond.endTime || timeCond.end || '23:59';
        
        // Validate time format
        if (!startTime.includes(':') || !endTime.includes(':')) {
            console.warn(`[Automation] Invalid time format in rule '${ruleName}'`);
            results.push({ name: 'time', value: 'invalid', target: 'invalid', met: false });
            return { triggered: false, ruleName, priority: rule.priority, conditions: results, values };
        }
        
        const [startH, startM] = startTime.split(':').map(Number);
        const [endH, endM] = endTime.split(':').map(Number);
        
        if (isNaN(startH) || isNaN(startM) || isNaN(endH) || isNaN(endM)) {
            console.warn(`[Automation] Could not parse time in rule '${ruleName}'`);
            results.push({ name: 'time', value: 'invalid', target: 'invalid', met: false });
            return { triggered: false, ruleName, priority: rule.priority, conditions: results, values };
        }
        const startMins = startH * 60 + startM;
        const endMins = endH * 60 + endM;
        const met = currentMins >= startMins && currentMins <= endMins;
        results.push({ name: 'time', value: `${currentHour}:${String(currentMinute).padStart(2,'0')}`, target: `${startTime}-${endTime}`, met });
    }
    
    // All conditions must be met
    const allMet = results.length === 0 || results.every(r => r.met);
    
    console.log(`[Automation] ${dryRun ? '[DRY RUN] ' : ''}Rule '${ruleName}': ${results.map(r => `${r.name}=${r.value}${r.met ? '✓' : '✗'}`).join(', ')} => ${allMet ? 'TRIGGERED' : 'not met'}`);
    
    if (allMet) {
        // Apply the action
        const actionResult = await applyRuleAction(rule.action, dryRun);
        
        if (actionResult.errno === 0 && !dryRun) {
            rule.lastTriggered = now;
            automationState.lastTriggered = now;
            automationState.activeRule = ruleName;
            automationState.activeGroupIdx = actionResult.targetGroupIdx ?? 0; // Store which group was used
            // Store full segment details for matching (FoxESS reorders groups!)
            automationState.activeSegment = actionResult.segment || null;
            saveAutomationState();
        }
        
        return {
            triggered: true,
            ruleName,
            priority: rule.priority,
            conditions: results,
            values,
            action: rule.action,
            result: actionResult
        };
    }
    
    return { triggered: false, ruleName, priority: rule.priority, conditions: results, values };
}

// Evaluate rule conditions only (for active cancellation check) - doesn't apply action or check cooldown
async function evaluateRuleConditionsOnly(ruleName, rule) {
    const conditions = rule.conditions || {};
    const values = extractDataValues();
    const results = [];
    
    // Feed-in price condition
    if (conditions.feedInPrice?.enabled) {
        const cond = conditions.feedInPrice;
        const met = compareValue(values.feedInPrice, cond.operator, cond.value);
        results.push({ name: 'feedInPrice', value: values.feedInPrice, met });
    }
    
    // Buy price condition
    if (conditions.buyPrice?.enabled) {
        const cond = conditions.buyPrice;
        const met = compareValue(values.buyPrice, cond.operator, cond.value);
        results.push({ name: 'buyPrice', value: values.buyPrice, met });
    }
    
    // SoC condition
    if (conditions.soc?.enabled) {
        const cond = conditions.soc;
        const met = compareValue(values.soc, cond.operator, cond.value);
        results.push({ name: 'soc', value: values.soc, met });
    }
    
    // Temperature condition
    if (conditions.temperature?.enabled) {
        const cond = conditions.temperature;
        let tempValue = cond.type === 'battery' ? values.batteryTemp : 
                        cond.type === 'ambient' ? values.temperature :
                        values.temperature ?? values.batteryTemp;
        const met = compareValue(tempValue, cond.operator, cond.value);
        results.push({ name: 'temperature', value: tempValue, met });
    }
    
    // Weather code condition
    if (conditions.weather?.enabled) {
        const cond = conditions.weather;
        const codes = cond.codes || [];
        const met = codes.includes(values.weatherCode);
        results.push({ name: 'weatherCode', value: values.weatherCode, met });
    }
    
    // Time window condition
    const timeCond = conditions.time || conditions.timeWindow;
    if (timeCond?.enabled) {
        const sydney = getSydneyTime();
        const currentMins = sydney.hour * 60 + sydney.minute;
        const startTime = timeCond.startTime || timeCond.start || '00:00';
        const endTime = timeCond.endTime || timeCond.end || '23:59';
        
        if (startTime.includes(':') && endTime.includes(':')) {
            const [startH, startM] = startTime.split(':').map(Number);
            const [endH, endM] = endTime.split(':').map(Number);
            if (!isNaN(startH) && !isNaN(startM) && !isNaN(endH) && !isNaN(endM)) {
                const startMins = startH * 60 + startM;
                const endMins = endH * 60 + endM;
                const met = currentMins >= startMins && currentMins <= endMins;
                results.push({ name: 'time', met });
            }
        }
    }
    
    const allMet = results.length === 0 || results.every(r => r.met);
    console.log(`[Automation] Condition check for '${ruleName}': ${results.map(r => `${r.name}=${r.met ? '✓' : '✗'}`).join(', ')} => ${allMet ? 'STILL VALID' : 'NO LONGER MET'}`);
    
    return { allMet, results, values };
}

// Cancel the active automation segment (clear/reset the automation-controlled time period)
async function cancelActiveSegment() {
    if (!DEVICE_SN) return { errno: -1, msg: 'No device configured' };
    
    try {
        // Use V1 API for consistency
        const currentScheduler = await callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN: DEVICE_SN }, 'Automation:cancelSegment:get');
        
        if (currentScheduler.errno !== 0 || !currentScheduler.result?.groups?.length) {
            return { errno: -1, msg: 'No scheduler data' };
        }
        
        const groups = JSON.parse(JSON.stringify(currentScheduler.result.groups));
        const trackedSegment = automationState.activeSegment;
        
        // FoxESS reorders groups! Find our segment by matching times + workMode
        let groupIdx = -1;
        if (trackedSegment) {
            for (let i = 0; i < groups.length; i++) {
                const g = groups[i];
                if (g.enable === 1 && 
                    g.workMode === trackedSegment.workMode &&
                    g.startHour === trackedSegment.startHour &&
                    g.startMinute === trackedSegment.startMinute &&
                    g.endHour === trackedSegment.endHour &&
                    g.endMinute === trackedSegment.endMinute) {
                    groupIdx = i;
                    console.log(`[Automation] Found our segment in Group ${i + 1} (FoxESS reordered it)`);
                    break;
                }
            }
        }
        
        // Fallback to stored groupIdx if segment matching fails
        if (groupIdx < 0) {
            groupIdx = automationState.activeGroupIdx ?? 0;
            console.log(`[Automation] Segment not found by matching, using stored groupIdx=${groupIdx}`);
        }
        
        if (!groups[groupIdx] || groups[groupIdx].enable !== 1) {
            console.log(`[Automation] Time Period ${groupIdx + 1} already disabled`);
            return { errno: 0, msg: 'Already disabled' };
        }
        
        // CLEAR the segment completely (reset to disabled with 00:00 times) to avoid future time clashes
        console.log(`[Automation] Clearing Time Period ${groupIdx + 1}: ${groups[groupIdx].startHour}:${groups[groupIdx].startMinute}-${groups[groupIdx].endHour}:${groups[groupIdx].endMinute} ${groups[groupIdx].workMode}`);
        groups[groupIdx] = {
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
        };
        
        const result = await callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN: DEVICE_SN, groups }, 'Automation:cancelSegment:clear');
        
        if (result.errno === 0) {
            console.log(`[Automation] Successfully CLEARED Time Period ${groupIdx + 1} (reset to 00:00-00:00)`);
        } else {
            console.warn(`[Automation] Failed to clear Time Period ${groupIdx + 1}:`, result.msg);
        }
        
        return result;
    } catch (e) {
        console.error('[Automation] Error clearing time period:', e.message);
        return { errno: -1, msg: e.message };
    }
}

// Compare a value using an operator
function compareValue(actual, operator, target) {
    if (actual === null || actual === undefined) return false;
    switch (operator) {
        case '>': return actual > target;
        case '>=': return actual >= target;
        case '<': return actual < target;
        case '<=': return actual <= target;
        case '==': return actual == target;
        case '!=': return actual != target;
        default: return false;
    }
}

// Check and disable expired automation segments
// Fetch scheduler data (used by expiry check and state validation)
async function getSchedulerData() {
    if (!DEVICE_SN) return null;
    try {
        return await callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN: DEVICE_SN }, 'Automation:getSchedulerData');
    } catch (e) {
        console.error('[Automation] Error fetching scheduler:', e.message);
        return null;
    }
}

async function disableExpiredSegments() {
    if (!DEVICE_SN) return null; // Skip if device not configured
    if (!automationState.activeGroupIdx && automationState.activeGroupIdx !== 0) {
        // No active segment to check - skip API call
        return null;
    }
    
    try {
        // Only fetch when we have an active segment to check
        const currentScheduler = await getSchedulerData();
        
        if (currentScheduler.errno !== 0 || !currentScheduler.result?.groups || currentScheduler.result.groups.length === 0) {
            return currentScheduler; // Return scheduler data even if no groups
        }
        
        const groups = JSON.parse(JSON.stringify(currentScheduler.result.groups));
        const groupIdx = automationState.activeGroupIdx ?? 0;
        const period = groups[groupIdx];
        
        if (!period || !period.enable) {
            return currentScheduler; // Return scheduler data even if period disabled
        }
        
        // Calculate period end time in minutes
        const segmentEndMins = period.endHour * 60 + period.endMinute;
        
        // Get current Sydney time
        const sydney = getSydneyTime();
        const currentMins = sydney.hour * 60 + sydney.minute;
        
        // Check if period has expired
        if (currentMins > segmentEndMins) {
            const endTime = formatTime(period.endHour, period.endMinute);
            const nowTime = formatTime(sydney.hour, sydney.minute);
            console.log(`[Automation] Time Period ${groupIdx + 1} expired (ended at ${endTime}, now ${nowTime}). Clearing...`);
            
            // CLEAR the segment completely (reset to disabled with 00:00 times) to avoid future time clashes
            groups[groupIdx] = {
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
            };
            
            const result = await callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN: DEVICE_SN, groups }, 'Automation:disableExpired:clear');
            
            if (result.errno === 0) {
                console.log(`[Automation] Successfully CLEARED expired Time Period ${groupIdx + 1} (reset to 00:00-00:00)`);
                // Clear automation state since segment is now cleared
                automationState.activeRule = null;
                automationState.activeSegmentEnabled = false;
                automationState.activeGroupIdx = null;
                saveAutomationState();
            } else {
                console.warn(`[Automation] Failed to clear expired Time Period ${groupIdx + 1}: ${result.msg}`);
            }
        }
        
        // Return the scheduler data for reuse
        return currentScheduler;
    } catch (e) {
        console.error('[Automation] Error checking expired segments:', e.message);
        return null;
    }
}

// Apply a rule's action (create scheduler segment)
async function applyRuleAction(action, dryRun = false) {
    // Safety threshold check before applying action
    const currentSoc = currentData.inverter?.SoC ?? currentData.inverter?.soc ?? null;
    const safetyCheck = checkSafetyThresholds(action.workMode, currentSoc);
    if (!safetyCheck.safe) {
        log('warn', `[Automation] Action blocked by safety threshold: ${safetyCheck.reason}`);
        return { errno: -1, msg: `Safety threshold: ${safetyCheck.reason}`, blocked: true };
    }
    
    const sydney = getSydneyTime();
    const startTime = formatTime(sydney.hour, sydney.minute);
    const durationMins = action.durationMinutes || 30;
    const endTimeObj = addMinutes(sydney.hour, sydney.minute, durationMins);
    const endTime = formatTime(endTimeObj.hour, endTimeObj.minute);
    
    log('info', `[Automation] ${dryRun ? '[DRY RUN] ' : ''}Applying ${action.workMode || 'SelfUse'}: ${startTime} - ${endTime}`);
    
    // Get current scheduler using V1 API (same as manual scheduler)
    const currentScheduler = await callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN: DEVICE_SN }, 'Automation:applyRule:get');
    
    let groups = [];
    if (currentScheduler.errno === 0 && currentScheduler.result?.groups) {
        groups = JSON.parse(JSON.stringify(currentScheduler.result.groups)); // Deep copy
    }
    
    if (groups.length === 0) {
        groups = [{ enable: 1, segments: [] }];
    }
    // Ensure we have at least one segment slot for automation (V1 flat structure)
    if (groups.length === 0 || !groups[0]) {
        groups[0] = {
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
        };
    }
    
    // Parse start/end times for V1 flat structure
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);
    
    // Build segment using V1 flat structure (same as manual scheduler)
    const segment = {
        enable: 1,
        workMode: action.workMode || 'SelfUse',
        startHour,
        startMinute,
        endHour,
        endMinute,
        minSocOnGrid: action.minSocOnGrid ?? 20,
        fdSoc: action.fdSoc ?? 35,
        fdPwr: action.fdPwr ?? CONFIG.defaults.fdPwr,
        maxSoc: action.maxSoc ?? 90
    };
    
    // CRITICAL: Clear ALL segments first to avoid FoxESS reordering issues and ghost data
    // This ensures a clean slate - only our new segment will have data
    let clearedCount = 0;
    groups.forEach((group, idx) => {
        if (group.enable === 1 || group.startHour !== 0 || group.startMinute !== 0 || group.endHour !== 0 || group.endMinute !== 0) {
            // Fully reset this group to avoid ghost data
            groups[idx] = {
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
            };
            clearedCount++;
        }
    });
    if (clearedCount > 0) {
        console.log(`[Automation] Cleared ${clearedCount} existing period(s) to ensure clean slate`);
    }
    
    // Always use Group 1 since we've cleared everything
    let targetGroupIdx = 0;
    console.log(`[Automation] Using Time Period 1 for automation`);
    
    // Update the selected group with new segment
    groups[targetGroupIdx] = segment;
    
    console.log(`[Automation] Updating Time Period ${targetGroupIdx + 1} with ${action.workMode} (${startTime}-${endTime})`);
    
    if (dryRun) {
        console.log(`[Automation] DRY RUN: Would apply segment:`, JSON.stringify(segment, null, 2));
        return { errno: 0, msg: 'Dry Run Success', segment, targetGroupIdx };
    }
    
    // Use V1 API endpoint (same as manual scheduler)
    const result = await callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN: DEVICE_SN, groups }, 'Automation:applyRule:enable');
    console.log(`[Automation] Scheduler ${result.errno === 0 ? 'SUCCESS' : 'FAILED'}: ${result.msg || ''}`);
    
    // Store segment details for later matching (FoxESS reorders groups!)
    if (result.errno === 0) {
        result.targetGroupIdx = targetGroupIdx;
        result.segment = segment; // Full segment details for matching
    }
    
    return result;
}

// Helper to get Sydney time components
function getSydneyTime() {
    const now = new Date();
    const sydneyStr = now.toLocaleString('en-AU', { timeZone: 'Australia/Sydney', hour12: false });
    // Parse "DD/MM/YYYY, HH:MM:SS" format
    const [datePart, timePart] = sydneyStr.split(', ');
    const [day, month, year] = datePart.split('/');
    const [hour, minute, second] = timePart.split(':');
    return {
        hour: parseInt(hour, 10),
        minute: parseInt(minute, 10),
        second: parseInt(second, 10),
        day: parseInt(day, 10),
        month: parseInt(month, 10),
        year: parseInt(year, 10),
        dayOfWeek: new Date().getDay() // 0 = Sunday, 6 = Saturday
    };
}

// Get blackout window info (used by both check and API)
function getBlackoutInfo() {
    const windows = CONFIG.automation?.blackoutWindows || [];
    if (windows.length === 0) return { inBlackout: false, window: null };
    
    const sydney = getSydneyTime();
    const currentMins = sydney.hour * 60 + sydney.minute;
    const currentDay = sydney.dayOfWeek;
    
    for (const w of windows) {
        // Check day filter if specified
        if (w.days && Array.isArray(w.days) && w.days.length > 0) {
            if (!w.days.includes(currentDay)) continue;
        }
        
        // Parse start/end times
        const [startH, startM] = (w.start || '00:00').split(':').map(Number);
        const [endH, endM] = (w.end || '23:59').split(':').map(Number);
        const startMins = startH * 60 + startM;
        const endMins = endH * 60 + endM;
        
        // Handle overnight windows (e.g., 22:00 - 06:00)
        if (startMins <= endMins) {
            // Normal window (same day)
            if (currentMins >= startMins && currentMins <= endMins) {
                return { inBlackout: true, window: { start: w.start, end: w.end, days: w.days } };
            }
        } else {
            // Overnight window (crosses midnight)
            if (currentMins >= startMins || currentMins <= endMins) {
                return { inBlackout: true, window: { start: w.start, end: w.end, days: w.days } };
            }
        }
    }
    return { inBlackout: false, window: null };
}

// Check if current time is within a blackout window
function isInBlackoutWindow() {
    const info = getBlackoutInfo();
    if (info.inBlackout) {
        log('debug', `[Automation] In blackout window: ${info.window.start}-${info.window.end}`);
    }
    return info.inBlackout;
}

// Check if SoC is within safety thresholds for a given action
function checkSafetyThresholds(action, currentSoc) {
    const minSoc = CONFIG.safety?.minSocPercent ?? 10;
    const maxSoc = CONFIG.safety?.maxSocPercent ?? 100;
    
    if (currentSoc === null || currentSoc === undefined) {
        log('warn', '[Safety] Cannot check thresholds - SoC unknown');
        return { safe: true, reason: 'SoC unknown, allowing action' };
    }
    
    // Prevent discharge if SoC is at or below minimum
    const dischargeActions = ['ForceDischarge', 'Feedin'];
    if (dischargeActions.includes(action) && currentSoc <= minSoc) {
        return { safe: false, reason: `SoC ${currentSoc}% is at or below minimum threshold (${minSoc}%)` };
    }
    
    // Prevent charge if SoC is at or above maximum
    const chargeActions = ['ForceCharge'];
    if (chargeActions.includes(action) && currentSoc >= maxSoc) {
        return { safe: false, reason: `SoC ${currentSoc}% is at or above maximum threshold (${maxSoc}%)` };
    }
    
    return { safe: true, reason: 'Within safety thresholds' };
}

// Format time as HH:MM for scheduler
function formatTime(hour, minute) {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// Add minutes to a time, handling overflow
function addMinutes(hour, minute, addMins) {
    let totalMins = hour * 60 + minute + addMins;
    // Cap at 23:59 to avoid going to next day
    if (totalMins >= 24 * 60) totalMins = 24 * 60 - 1;
    return {
        hour: Math.floor(totalMins / 60),
        minute: totalMins % 60
    };
}

// Generate FoxESS signature
function generateSignature(apiPath, token, timestamp) {
    // FoxESS expects LITERAL backslash-r-backslash-n strings (not actual CRLF bytes)
    // This matches the Postman pre-request script: path + "\\r\\n" + token + "\\r\\n" + timestamp
    const signaturePlain = apiPath + '\\r\\n' + token + '\\r\\n' + timestamp;
    return crypto.createHash('md5').update(signaturePlain).digest('hex');
}

// Generic retry wrapper for API calls
async function withRetry(fn, apiName = 'API') {
    const maxRetries = CONFIG.api?.retryCount ?? 3;
    const baseDelay = CONFIG.api?.retryDelayMs ?? 1000;
    
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const result = await fn();
            // Check if result indicates an error that should trigger retry
            if (result && (result.errno === 408 || result.errno === 500 || result.errno === 502 || result.errno === 503)) {
                throw new Error(result.msg || `Error ${result.errno}`);
            }
            return result;
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries) {
                const delay = baseDelay * Math.pow(2, attempt); // Exponential backoff
                log('warn', `[${apiName}] Attempt ${attempt + 1} failed: ${error.message}. Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    log('error', `[${apiName}] All ${maxRetries + 1} attempts failed`);
    return { errno: 500, msg: `${apiName} failed after ${maxRetries + 1} attempts: ${lastError?.message}` };
}

// Generic FoxESS API call
// source: optional string describing the origin of this call (e.g., 'UI:/api/inverter/real-time', 'Automation:gatherData')
async function callFoxESSAPI(apiPath, method = 'GET', body = null, source = 'unknown') {
    if (!FOXESS_TOKEN) {
        console.warn('callFoxESSAPI: FOXESS_TOKEN not configured');
        return { errno: 401, msg: 'FOXESS_TOKEN not configured' };
    }
    incrementApiCall('foxess');
    log('debug', `[FoxESS] ${method} ${apiPath} | source: ${source}`);
    const token = FOXESS_TOKEN.trim();
    const timestamp = Date.now();
    const signaturePath = apiPath.split('?')[0];
    const signature = generateSignature(signaturePath, token, timestamp);

    const headers = {
        'token': token,
        'timestamp': timestamp.toString(),
        'signature': signature,
        'lang': 'en',
        'Content-Type': 'application/json'
    };

    const options = {
        method,
        headers
    };

    if (body && method !== 'GET') {
        options.body = JSON.stringify(body);
    }

    const url = `${FOXESS_BASE_URL}${apiPath}`;
    
    // Add 10 second timeout to prevent hanging
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    options.signal = controller.signal;

    try {
        const response = await fetch(url, options);
        clearTimeout(timeout);
        const text = await response.text();
        // Try to return JSON when possible, otherwise give helpful debug
        try {
            return JSON.parse(text);
        } catch (err) {
            console.warn('callFoxESSAPI: non-json response', text.substring(0, 200));
            return { errno: -1, msg: 'non-json response from upstream', raw: text };
        }
    } catch (error) {
        clearTimeout(timeout);
        if (error.name === 'AbortError') {
            console.error('callFoxESSAPI timeout:', apiPath);
            return { errno: 408, msg: 'Request timeout' };
        }
        console.error('callFoxESSAPI fetch error:', error.message);
        // bubble a useful object back to callers so they can return clean JSON
        return { errno: 500, msg: 'failed to fetch upstream', error: String(error) };
    }
}

// Generic Amber API call helper with timeout
// source: optional string describing the origin of this call
async function callAmberAPI(path, queryParams = {}, source = 'unknown') {
    incrementApiCall('amber');
    log('debug', `[Amber] GET ${path} | source: ${source}`);
    if (!AMBER_API_KEY) return { errno: 401, error: 'AMBER_API_KEY not configured' };
    const url = new URL(`${AMBER_BASE_URL}${path}`);
    Object.keys(queryParams || {}).forEach(k => {
        if (queryParams[k] !== undefined && queryParams[k] !== null) url.searchParams.set(k, String(queryParams[k]));
    });

    const headers = {
        'Authorization': `Bearer ${AMBER_API_KEY}`,
        'Accept': 'application/json'
    };

    // Add 10 second timeout to prevent hanging
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
        const resp = await fetch(url.toString(), { headers, signal: controller.signal });
        clearTimeout(timeout);
        const text = await resp.text();
        try { return JSON.parse(text); } catch (e) { return { errno: -1, error: 'Non-JSON response from Amber', raw: text }; }
    } catch (error) {
        clearTimeout(timeout);
        if (error.name === 'AbortError') {
            console.error('callAmberAPI timeout:', path);
            return { errno: 408, error: 'Request timeout' };
        }
        console.error('callAmberAPI error', error.message);
        return { errno: 500, error: String(error) };
    }
}

// Generic Weather API helper (Open-Meteo). Returns a structured payload similar to the old /api/weather response.
// source: optional string describing the origin of this call
async function callWeatherAPI(place = 'Sydney', days = 3, timeoutMs = 10000, source = 'unknown') {
    incrementApiCall('weather');
    log('debug', `[Weather] place=${place}, days=${days} | source: ${source}`);
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en`;
        const geoResp = await fetch(geoUrl, { signal: controller.signal });
        const geoJson = await geoResp.json();

        let latitude, longitude, resolvedName, country;
        let geocodingFallback = false;
        let geocodingFallbackReason = '';
        let geocodingFallbackResolvedName = '';
        if (geoJson && geoJson.results && geoJson.results.length > 0) {
            const g = geoJson.results[0];
            latitude = g.latitude;
            longitude = g.longitude;
            resolvedName = g.name;
            country = g.country;
        } else {
            // Upstream geocoding returned no usable result — use the existing fallback coords
            geocodingFallback = true;
            geocodingFallbackReason = 'geocoding_no_results';
            latitude = -33.9215;
            longitude = 151.0390;
            resolvedName = place;
            country = 'AU';
            // Attempt a reverse-geocode on the fallback coordinates using Nominatim
            // to produce a friendly location name (suburb / city / state / postcode).
            try {
                const nomUrl = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&format=jsonv2&addressdetails=1`;
                const revResp = await fetch(nomUrl, { signal: controller.signal, headers: { 'User-Agent': 'FoxESS-Dashboard/1.0 (local)' } });
                if (revResp && revResp.ok) {
                    const revJson = await revResp.json();
                    const addr = revJson && revJson.address ? revJson.address : null;
                    if (addr) {
                        // Prefer suburb/town + city + postcode for a concise label
                        const parts = [];
                        const locality = addr.suburb || addr.town || addr.village || addr.city || addr.hamlet || addr.county || revJson.name;
                        if (locality) parts.push(locality);
                        if (addr.city && addr.city !== locality) parts.push(addr.city);
                        if (addr.state) parts.push(addr.state);
                        if (addr.postcode) parts.push(addr.postcode);
                        if (addr.country && !parts.includes(addr.country)) parts.push(addr.country);
                        const fbName = parts.filter(Boolean).join(' ');
                        if (fbName) {
                            geocodingFallbackResolvedName = fbName;
                            resolvedName = geocodingFallbackResolvedName || resolvedName;
                        }
                    }
                }
            } catch (e) {
                log('warn', '[Weather] reverse geocode (nominatim) on fallback coords failed:', e && e.message ? e.message : e);
            }
        }

        const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,precipitation,precipitation_probability,weathercode&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&current_weather=true&temperature_unit=celsius&timezone=auto&forecast_days=${days}`;
        const forecastResp = await fetch(forecastUrl, { signal: controller.signal });
        const forecastJson = await forecastResp.json();
        clearTimeout(timeout);

        return {
            source: 'open-meteo',
            place: {
                query: place,
                resolvedName,
                country,
                latitude,
                longitude,
                // Indicate to callers when we had to use a fallback because geocoding failed
                fallback: !!geocodingFallback,
                fallbackReason: geocodingFallback ? geocodingFallbackReason : '',
                // When available, a friendly reverse-geocoded name for the fallback
                fallbackResolvedName: (typeof geocodingFallbackResolvedName !== 'undefined') ? geocodingFallbackResolvedName : ''
            },
            current: forecastJson.current_weather || null,
            hourly: forecastJson.hourly || null,
            daily: forecastJson.daily || null,
            raw: forecastJson
        };
    } catch (error) {
        console.error('callWeatherAPI error', error && error.message ? error.message : error);
        return { errno: 500, error: String(error) };
    }
}

// ==================== FIRESTORE HELPERS ====================
// Extract Firebase UID from Authorization header (Bearer token)
async function getUidFromRequest(req) {
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token || !admin.auth) {
        return null;
    }
    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        return decodedToken.uid;
    } catch (error) {
        return null;
    }
}

// Save user credentials to Firestore
async function saveUserCredentials(uid, credentials) {
    if (!db) {
        console.warn('[Firestore] Not connected - credentials will not persist');
        return false;
    }
    
    try {
        await db.collection('users').doc(uid).set({
            credentials: {
                device_sn: credentials.device_sn || '',
                foxess_token: credentials.foxess_token || '',
                amber_api_key: credentials.amber_api_key || '',
                updated_at: new Date()
            }
        }, { merge: true });
        console.log(`[Firestore] Saved credentials for user ${uid}`);
        return true;
    } catch (error) {
        console.warn(`[Firestore] Failed to save credentials for user ${uid}:`, error.message);
        return false;
    }
}

// Load user credentials from Firestore
async function loadUserCredentials(uid) {
    if (!db) {
        return null;
    }
    
    try {
        const doc = await db.collection('users').doc(uid).get();
        if (doc.exists && doc.data().credentials) {
            return doc.data().credentials;
        }
        return null;
    } catch (error) {
        console.warn(`[Firestore] Failed to load credentials for user ${uid}:`, error.message);
        return null;
    }
}

// Middleware to attach uid to request if authenticated
app.use(async (req, res, next) => {
    const uid = await getUidFromRequest(req);
    if (uid) {
        req.uid = uid;
    }
    next();
});

// Health check endpoint to help debugging 'Failed to fetch' issues
app.get('/health', (req, res) => {
    res.json({ ok: true, FOXESS_TOKEN: !!FOXESS_TOKEN, DEVICE_SN: DEVICE_SN || null, logLevel: CONFIG.logging?.level || 'info' });
});

// Public configuration endpoint (safe defaults for frontend)
app.get('/api/config', (req, res) => {
    res.json({
        errno: 0,
        result: {
            weatherPlace: process.env.WEATHER_PLACE || 'Roselands Sydney 2196',
            deviceSn: DEVICE_SN || '',
            automation: { ...CONFIG.automation },
            cache: { ...CONFIG.cache },
            defaults: { ...CONFIG.defaults },
            logging: { ...CONFIG.logging },
            api: { ...CONFIG.api },
            safety: { ...CONFIG.safety }
        }
    });
});

// Check if setup is complete
app.get('/api/config/setup-status', async (req, res) => {
    let deviceSn = null;
    let foxessToken = null;
    let hasAmberKey = false;
    let uid = req.uid || 'unknown';
    
    // If user is authenticated, load their per-user credentials from Firestore
    if (req.uid) {
        const userCreds = await loadUserCredentials(req.uid);
        console.log(`[Setup Status] UID: ${req.uid}, Creds found:`, !!userCreds, userCreds);
        if (userCreds) {
            deviceSn = userCreds.device_sn || null;
            foxessToken = userCreds.foxess_token || null;
            hasAmberKey = !!userCreds.amber_api_key;
        }
    } else {
        console.log('[Setup Status] No UID in request - user not authenticated');
    }
    
    // Setup is complete if user has both device SN and FoxESS token
    const setupComplete = !!(deviceSn && foxessToken);
    res.json({
        errno: 0,
        result: {
            setupComplete,
            deviceSn: deviceSn || null,
            hasAmberKey: hasAmberKey,
            debug: { uid, authenticated: !!req.uid }
        }
    });
});


// Get factory defaults (for reset functionality)
app.get('/api/config/defaults', (req, res) => {
    res.json({
        errno: 0,
        result: FACTORY_DEFAULTS
    });
});

// Reset configuration to factory defaults
app.post('/api/config/reset', (req, res) => {
    try {
        const { section } = req.body; // optional: 'automation', 'cache', 'defaults', 'logging', 'api', 'safety', or undefined for all
        
        if (section) {
            if (!FACTORY_DEFAULTS[section]) {
                return res.json({ errno: 1, msg: `Unknown section: ${section}` });
            }
            CONFIG[section] = JSON.parse(JSON.stringify(FACTORY_DEFAULTS[section]));
            log('info', `[Config] Reset section '${section}' to factory defaults`);
        } else {
            // Reset all
            Object.assign(CONFIG, JSON.parse(JSON.stringify(FACTORY_DEFAULTS)));
            log('info', '[Config] Reset ALL sections to factory defaults');
        }
        
        saveConfig();
        
        res.json({
            errno: 0,
            msg: section ? `Section '${section}' reset to factory defaults` : 'All settings reset to factory defaults',
            result: CONFIG
        });
    } catch (error) {
        log('error', 'Failed to reset configuration:', error);
        res.json({ errno: 1, msg: `Failed to reset: ${error.message}` });
    }
});

// Clear stored credentials (FoxESS token, device SN, Amber API key)
// Useful for testing/setup flows to force re-onboarding without restarting the process
app.post('/api/config/clear-credentials', (req, res) => {
    try {
        process.env.FOXESS_TOKEN = '';
        process.env.DEVICE_SN = '';
        process.env.AMBER_API_KEY = '';

        FOXESS_TOKEN = '';
        DEVICE_SN = '';
        AMBER_API_KEY = '';

        log('info', '[Config] Cleared FOXESS_TOKEN, DEVICE_SN and AMBER_API_KEY from environment and memory');

        res.json({ errno: 0, msg: 'Cleared stored credentials' });
    } catch (error) {
        log('error', 'Failed to clear credentials:', error);
        res.json({ errno: 1, msg: `Failed to clear credentials: ${error.message}` });
    }
});

// Validate provided credentials (FoxESS token, device SN, Amber API key)
app.post('/api/config/validate-keys', async (req, res) => {
    try {
        const { device_sn, foxess_token, amber_api_key } = req.body;
        // optional query flag to include raw upstream responses for debugging: /api/config/validate-keys?diagnose=1
        const diagnose = String(req.query?.diagnose || '').trim() === '1';
        const failed_keys = [];
        const errors = {};

        // Test FoxESS token if provided
        if (foxess_token && foxess_token.trim()) {
            const testToken = foxess_token.trim();
            const timestamp = Date.now();
            const signaturePath = '/op/v0/device/detail';
            const signature = generateSignature(signaturePath, testToken, timestamp);

            const headers = {
                'token': testToken,
                'timestamp': timestamp.toString(),
                'signature': signature,
                'lang': 'en',
                'Content-Type': 'application/json'
            };

            const url = `${FOXESS_BASE_URL}${signaturePath}?sn=${encodeURIComponent(device_sn || '')}`;

            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000);
                const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
                clearTimeout(timeout);
                const rawText = await response.text();

                // Try parse JSON safely — if parsing fails, capture raw response for diagnostics
                let data = null;
                try {
                    data = rawText ? JSON.parse(rawText) : null;
                } catch (parseErr) {
                    // Keep rawText available for error reporting below
                    data = null;
                }

                // If not ok or upstream returned an unexpected payload, mark as failed and include diagnostic snippets
                if (!response.ok || !data || data.errno !== 0) {
                    failed_keys.push('foxess_token');
                    // Prefer upstream message when available
                    if (data && data.msg) {
                        errors.foxess_token = data.msg;
                    } else if (!response.ok) {
                        errors.foxess_token = `FoxESS API HTTP ${response.status} ${response.statusText}`;
                    } else if (!rawText || rawText.trim() === '') {
                        errors.foxess_token = `Empty or non-JSON response from FoxESS (HTTP ${response.status})`;
                    } else {
                        // Include a short raw preview to help diagnose unexpected responses
                        errors.foxess_token = `Invalid JSON response from FoxESS (preview): ${rawText.substring(0, 400)}`;
                    }
                    if (diagnose) {
                        // include a trimmed raw debug preview when requested
                        errors.foxess_token_raw = rawText ? rawText.substring(0, 2000) : '';

                        // Attempt alternative signature timestamp formats to help diagnose 'illegal signature' issues.
                        // Try both millisecond and second timestamps and return short previews for each attempt.
                        try {
                            const altAttempts = [];
                            const tsCandidates = [Date.now(), Math.floor(Date.now() / 1000)];
                            // Different signature builders to try when diagnosing 'illegal signature'
                            // IMPORTANT: FoxESS uses LITERAL backslash-r-backslash-n strings, NOT actual CRLF bytes
                            const variants = [
                                { name: 'path_literal_rn_token_literal_rn_ts', build: (p, tk, t) => p + '\\r\\n' + tk + '\\r\\n' + t },
                                { name: 'path_CRLF_token_CRLF_ts', build: (p, tk, t) => `${p}\r\n${tk}\r\n${t}` },
                                { name: 'path_LF_token_LF_ts', build: (p, tk, t) => `${p}\n${tk}\n${t}` },
                                { name: 'token_literal_rn_path_literal_rn_ts', build: (p, tk, t) => tk + '\\r\\n' + p + '\\r\\n' + t }
                            ];

                            for (let ts of tsCandidates) {
                                for (let v of variants) {
                                    const sigPlain = v.build(signaturePath, testToken, ts);
                                    const hash = crypto.createHash('md5').update(sigPlain).digest();
                                    const sigHex = hash.toString('hex');
                                    const sigHexUpper = sigHex.toUpperCase();
                                    const sigBase64 = Buffer.from(hash).toString('base64');
                                    const sigFormats = [sigHex, sigHexUpper, sigBase64];
                                    for (let fmt of sigFormats) {
                                        const altHeaders = { ...headers, timestamp: String(ts), signature: fmt };
                                        const ctrl = new AbortController();
                                        const timeoutId = setTimeout(() => ctrl.abort(), 10000);
                                        try {
                                            const resp = await fetch(url, { method: 'GET', headers: altHeaders, signal: ctrl.signal });
                                            clearTimeout(timeoutId);
                                            const txt = await resp.text();
                                            let parsed = null;
                                            try { parsed = txt ? JSON.parse(txt) : null; } catch (parseE) { parsed = null; }
                                            altAttempts.push({ variant: v.name, timestamp: ts, status: resp.status, ok: resp.ok, errno: parsed?.errno ?? null, msg: parsed?.msg ?? null, preview: txt ? txt.substring(0, 800) : '' });
                                        } catch (fetchErr) {
                                            clearTimeout(timeoutId);
                                            altAttempts.push({ variant: v.name, timestamp: ts, error: String(fetchErr) });
                                        }
                                    }
                                }
                            }
                            errors.foxess_attempts = altAttempts;
                        } catch (e) {
                            // best-effort diagnostics — don't fail the whole validation flow
                            errors.foxess_attempts_diag_error = String(e);
                        }
                    }
                }
            } catch (error) {
                failed_keys.push('foxess_token');
                const msg = String(error && error.message ? error.message : error);
                // Common TLS/cert issues produce 'self-signed certificate in certificate chain' — give actionable hint
                if (msg.toLowerCase().indexOf('self-signed') !== -1 || msg.toLowerCase().indexOf('certificate') !== -1) {
                    errors.foxess_token = `Failed to contact FoxESS (TLS certificate problem): ${msg}. This often indicates a local MITM/proxy or upstream hosting with private CA. Check your environment or run validations from a machine without TLS interception.`;
                } else {
                    errors.foxess_token = `Failed to verify FoxESS token: ${msg}`;
                }
            }
        } else if (!foxess_token || !foxess_token.trim()) {
            failed_keys.push('foxess_token');
            errors.foxess_token = 'FoxESS token is required';
        }

        // Test device SN if provided (validated in FoxESS test above)
        if (!device_sn || !device_sn.trim()) {
            failed_keys.push('device_sn');
            errors.device_sn = 'Device serial number is required';
        }

        // Test Amber API key if provided (optional)
        if (amber_api_key && amber_api_key.trim()) {
            const testKey = amber_api_key.trim();
            const url = new URL(`${AMBER_BASE_URL}/sites`);
            const headers = {
                'Authorization': `Bearer ${testKey}`,
                'Accept': 'application/json'
            };

            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000);
                const response = await fetch(url.toString(), { headers, signal: controller.signal });
                clearTimeout(timeout);
                const amberRawText = await response.text();
                let amberData = null;
                try {
                    amberData = amberRawText ? JSON.parse(amberRawText) : null;
                } catch (e) {
                    amberData = null;
                }

                // Check if the response indicates success
                if (!response.ok || !amberData || (amberData.error && amberData.error !== 'ok')) {
                    failed_keys.push('amber_api_key');
                    if (amberData && amberData.error) errors.amber_api_key = amberData.error; else if (!response.ok) errors.amber_api_key = `Amber API HTTP ${response.status} ${response.statusText}`; else errors.amber_api_key = `Non-JSON response from Amber (preview): ${amberRawText ? amberRawText.substring(0, 400) : ''}`;
                    if (diagnose) errors.amber_api_key_raw = amberRawText ? amberRawText.substring(0, 2000) : '';
                }
            } catch (error) {
                failed_keys.push('amber_api_key');
                errors.amber_api_key = `Failed to verify Amber API key: ${error.message}`;
            }
        }

        // If any keys failed, return error
        if (failed_keys.length > 0) {
            return res.json({
                errno: 1,
                msg: `Validation failed for: ${failed_keys.join(', ')}`,
                failed_keys,
                errors
            });
        }

        // All validations passed - save configuration
        process.env.DEVICE_SN = device_sn;
        process.env.FOXESS_TOKEN = foxess_token;
        if (amber_api_key) process.env.AMBER_API_KEY = amber_api_key;

        // Update in-memory variables
        DEVICE_SN = device_sn;
        FOXESS_TOKEN = foxess_token;
        if (amber_api_key) AMBER_API_KEY = amber_api_key;

        log('info', `[Config] Credentials validated and set: DEVICE_SN='${DEVICE_SN}', FOXESS_TOKEN=***`, AMBER_API_KEY ? ', AMBER_API_KEY=***' : '');

        // Save to Firestore for the authenticated user
        if (req.uid) {
            await saveUserCredentials(req.uid, {
                device_sn,
                foxess_token,
                amber_api_key: amber_api_key || ''
            });
        }

        res.json({
            errno: 0,
            msg: 'All credentials validated successfully'
        });
    } catch (error) {
        log('error', 'Failed to validate credentials:', error);
        res.json({ errno: 1, msg: `Validation error: ${error.message}` });
    }
});

// Get available device variables from FoxESS
app.get('/api/device/variables', async (req, res) => {
    try {
        const result = await callFoxESSAPI('/op/v0/device/variable/get', 'GET', null, 'UI:/api/device/variables');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get work mode setting (default active mode, not scheduler)
app.get('/api/device/workmode/get', async (req, res) => {
    try {
        const sn = req.query.sn || DEVICE_SN;
        // Use 'WorkMode' key to get the current active work mode
        const result = await callFoxESSAPI('/op/v0/device/setting/get', 'POST', { sn, key: 'WorkMode' }, 'UI:/api/device/workmode/get');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Set work mode setting (default active mode, not scheduler)
app.post('/api/device/workmode/set', async (req, res) => {
    try {
        const sn = req.body.sn || DEVICE_SN;
        const { workMode } = req.body;
        if (!workMode) {
            return res.status(400).json({ errno: 400, error: 'workMode is required (SelfUse, Feedin, Backup, PeakShaving)' });
        }
        // Use 'WorkMode' key to set the active work mode
        const result = await callFoxESSAPI('/op/v0/device/setting/set', 'POST', { sn, key: 'WorkMode', value: workMode }, 'UI:/api/device/workmode/set');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== Platform Interface ====================

// Metrics - API call counts per day
app.get('/api/metrics/api-calls', (req, res) => {
    try {
        const days = Math.max(1, Math.min(30, Number(req.query.days || 1)));
        const out = {};
        for (let i = 0; i < days; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const key = getDateKey(d);
            ensureDateKey(key);
            out[key] = apiCallCounts[key];
        }
        res.json({ errno: 0, result: out });
    } catch (e) {
        res.status(500).json({ errno: -1, error: e.message });
    }
});

app.get('/api/platform/access-count', async (req, res) => {
    try {
        const result = await callFoxESSAPI('/op/v0/user/getAccessCount', 'GET', null, 'UI:/api/platform/access-count');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/platform/installer-count', async (req, res) => {
    try {
        const result = await callFoxESSAPI('/op/v0/device/installer/count', 'POST', {}, 'UI:/api/platform/installer-count');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== Inverter ====================

app.get('/api/inverter/list', async (req, res) => {
    try {
        const result = await callFoxESSAPI('/op/v0/device/list', 'POST', {
            currentPage: 1,
            pageSize: 10
        }, 'UI:/api/inverter/list');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/inverter/detail', async (req, res) => {
    try {
        const sn = req.query.sn || DEVICE_SN;
        // FoxESS device detail endpoint expects the SN as a query param on GET
        const result = await callFoxESSAPI(`/op/v0/device/detail?sn=${encodeURIComponent(sn)}`, 'GET', null, 'UI:/api/inverter/detail');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/inverter/real-time', async (req, res) => {
    try {
        const sn = req.query.sn || DEVICE_SN;
            const result = await callFoxESSAPI('/op/v0/device/real/query', 'POST', {
                sn,
                variables: ['generationPower', 'pvPower', 'pv1Power', 'pv2Power', 'pv3Power', 'pv4Power', 'pv1Volt', 'pv2Volt', 'pv3Volt', 'pv4Volt', 'pv1Current', 'pv2Current', 'pv3Current', 'pv4Current', 'feedinPower', 'gridConsumptionPower', 'loadsPower', 'batChargePower', 'batDischargePower', 'SoC', 'batTemperature', 'ambientTemperation', 'invTemperation', 'boostTemperation']
        }, 'UI:/api/inverter/real-time');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to probe for per-string PV variables (pv1Power..pv4Power and variants)
app.get('/api/inverter/pv-strings', async (req, res) => {
    try {
        const sn = req.query.sn || DEVICE_SN;
        // Try many possible variable names for per-string PV data
        const variables = [
            'pvPower', 'pv1Power', 'pv2Power', 'pv3Power', 'pv4Power',
            'PV1Power', 'PV2Power', 'PV3Power', 'PV4Power',
            'pv1Volt', 'pv2Volt', 'pv3Volt', 'pv4Volt',
            'pv1Current', 'pv2Current', 'pv3Current', 'pv4Current',
            'PVPower', 'PV1Voltage', 'PV2Voltage', 'PV3Voltage', 'PV4Voltage',
            'string1Power', 'string2Power', 'string3Power', 'string4Power',
            'mppt1Power', 'mppt2Power', 'mppt1Volt', 'mppt2Volt',
            'dcPower', 'dcPower1', 'dcPower2', 'dcPower3', 'dcPower4'
        ];

        const result = await callFoxESSAPI('/op/v0/device/real/query', 'POST', { sn, variables }, 'UI:/api/inverter/pv-strings');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get inverter work mode
app.get('/api/inverter/mode', async (req, res) => {
    try {
        const sn = req.query.sn || DEVICE_SN;
        // Try several possible variable names used by different firmware versions
        const variables = [
            'workMode', 'workModeName', 'workStatus', 'runMode', 'mode', 'operationMode', 'operatingMode', 'runStatus'
        ];

        const result = await callFoxESSAPI('/op/v0/device/real/query', 'POST', { sn, variables }, 'UI:/api/inverter/mode');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Set inverter work mode
// Supported modes: SelfUse, ForceCharge, ForceDischarge, Feedin, Backup
app.post('/api/inverter/mode/set', async (req, res) => {
    try {
        const sn = req.body.sn || DEVICE_SN;
        const { workMode } = req.body;
        if (!workMode) {
            return res.status(400).json({ errno: 400, error: 'workMode is required' });
        }
        // Use the device setting endpoint to set work mode - use 'WorkMode' key to match GET endpoint
        const result = await callFoxESSAPI('/op/v0/device/setting/set', 'POST', { sn, key: 'WorkMode', value: workMode }, 'UI:/api/inverter/mode/set');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Dedicated temperatures endpoint - returns only temperature-related variables
app.get('/api/inverter/temps', async (req, res) => {
    try {
        const sn = req.query.sn || DEVICE_SN;
        const variables = [
            'batTemperature',
            'ambientTemperation',
            'invTemperation',
            'boostTemperation'
        ];

        const result = await callFoxESSAPI('/op/v0/device/real/query', 'POST', {
            sn,
            variables
        }, 'UI:/api/inverter/temps');

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== Weather (Open-Meteo) ====================
// Returns current weather and short forecast for a given place (default: Roselands Sydney 2196)
app.get('/api/weather', async (req, res) => {
    try {
        const place = req.query.place || 'Roselands Sydney 2196';
        const days = parseInt(req.query.days || '3', 10);

        // validate days (Open-Meteo forecast_days max is 16)
        if (!Number.isInteger(days) || days < 1 || days > 16) {
            return res.status(400).json({ errno: 400, error: 'days must be an integer between 1 and 16' });
        }

        const payload = await callWeatherAPI(place, days, 10000, 'UI:/api/weather');
        if (payload && payload.errno) return res.status(500).json(payload);
        res.json(payload);
    } catch (error) {
        console.error('weather fetch error', error);
        res.status(500).json({ error: String(error) });
    }
});

// ==================== Amber Prices ====================
// GET /api/amber/sites - List all sites
app.get('/api/amber/sites', async (req, res) => {
    try {
        const data = await callAmberAPI('/sites', {}, 'UI:/api/amber/sites');
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

    // Persist a snapshot of Amber prices to local store (manual trigger)
    app.post('/api/amber/persist', async (req, res) => {
        try {
            const siteId = req.body.siteId || req.query.siteId || null;
            const data = req.body.data || currentData.amber || null;
            if (!data) return res.status(400).json({ errno: 400, error: 'No data available to persist' });
            const ok = persistAmberSnapshot(siteId, data);
            if (ok) return res.json({ errno: 0, msg: 'persisted' });
            res.status(500).json({ errno: -1, error: 'persist failed' });
        } catch (e) {
            res.status(500).json({ errno: -1, error: e.message });
        }
    });

    // Compute the cheapest consecutive window in upcoming Amber forecast
    // GET /api/amber/summary/cheapest-next?siteId=...&hours=4&resolution=30
    app.get('/api/amber/summary/cheapest-next', async (req, res) => {
        try {
            const siteId = req.query.siteId;
            if (!siteId) return res.status(400).json({ errno: 400, error: 'siteId is required' });
            const hours = Math.max(1, Math.min(48, parseFloat(req.query.hours || '2')));
            const resolution = req.query.resolution ? parseInt(req.query.resolution, 10) : undefined;

            // Request enough intervals: we'll ask for next (hours * 60 / (resolution || 30)) intervals
            const assumedRes = resolution || 30;
            const intervalsNeeded = Math.ceil((hours * 60) / assumedRes) + 1;

            const q = { next: intervalsNeeded };
            if (resolution) q.resolution = resolution;

            const data = await callAmberAPI(`/sites/${encodeURIComponent(siteId)}/prices/current`, q, 'UI:/api/amber/summary/cheapest-next');
            if (!Array.isArray(data) || data.length === 0) return res.status(500).json({ errno: -1, error: 'No price data returned' });

            // Filter for general channel forecast intervals
            const general = data.filter(i => i.channelType === 'general' && i.type && String(i.type).toLowerCase().includes('forecast'));
            // Fall back to any general intervals if no forecast entries
            const candidates = general.length > 0 ? general : data.filter(i => i.channelType === 'general');
            if (!candidates || candidates.length === 0) return res.status(500).json({ errno: -1, error: 'No general channel intervals available' });

            // Sort by startTime
            candidates.sort((a, b) => new Date(a.startTime || a.nemTime || a.date) - new Date(b.startTime || b.nemTime || b.date));

            const intervalDuration = candidates[0].duration || assumedRes; // minutes
            const windowSize = Math.max(1, Math.round((hours * 60) / intervalDuration));

            if (candidates.length < windowSize) return res.status(400).json({ errno: 400, error: 'Not enough intervals returned for requested window' });

            // Map to numeric price (use advancedPrice.predicted when present)
            const prices = candidates.map(it => ({
                ts: it.startTime || it.nemTime || it.date,
                perKwh: (it.advancedPrice && (typeof it.advancedPrice.predicted === 'number')) ? it.advancedPrice.predicted : it.perKwh,
                raw: it
            }));

            // Sliding window to find minimum total (sum of perKwh across window)
            let best = null;
            let sum = 0;
            for (let i = 0; i < prices.length; i++) {
                sum += prices[i].perKwh;
                if (i >= windowSize) sum -= prices[i - windowSize].perKwh;
                if (i >= windowSize - 1) {
                    const startIdx = i - (windowSize - 1);
                    const avg = sum / windowSize;
                    if (!best || avg < best.avg) {
                        best = { startIdx, endIdx: i, avg, total: sum, windowSize };
                    }
                }
            }

            if (!best) return res.status(500).json({ errno: -1, error: 'Could not compute cheapest window' });

            const resultWindow = prices.slice(best.startIdx, best.endIdx + 1);
            return res.json({ errno: 0, result: { start: resultWindow[0].ts, end: resultWindow[resultWindow.length - 1].ts, avgPerKwh: best.avg, total: best.total, intervals: resultWindow.map(p => p.raw) } });
        } catch (e) {
            console.error('cheapest-next error', e.message);
            res.status(500).json({ errno: -1, error: e.message });
        }
    });

    // Test notification endpoint (prototype)
    app.post('/api/notify/test', async (req, res) => {
        try {
            const subject = req.body.subject || 'Test Notification';
            const message = req.body.message || 'This is a test notification from FoxESS dashboard';
            const to = req.body.to || undefined;
            const r = await sendNotification(subject, message, { to });
            res.json(r);
        } catch (e) {
            res.status(500).json({ errno: -1, error: e.message });
        }
    });

// GET /api/amber/prices/current?siteId=...&next=48&previous=0&resolution=30
app.get('/api/amber/prices/current', async (req, res) => {
    try {
        const siteId = req.query.siteId;
        if (!siteId) return res.status(400).json({ errno: 400, error: 'siteId is required' });
        const next = req.query.next ? parseInt(req.query.next, 10) : undefined;
        const previous = req.query.previous ? parseInt(req.query.previous, 10) : undefined;
        const resolution = req.query.resolution ? parseInt(req.query.resolution, 10) : undefined;

        const q = {};
        if (next) q.next = next;
        if (previous) q.previous = previous;
        if (resolution) q.resolution = resolution;

        const data = await callAmberAPI(`/sites/${encodeURIComponent(siteId)}/prices/current`, q, 'UI:/api/amber/prices/current');
        
        // Note: Automation is now handled by the background loop (runAutomationCycle)
        // We no longer trigger it here to avoid double-firing or dependency on UI polling.
        
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// GET /api/amber/prices?siteId=...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&resolution=30
app.get('/api/amber/prices', async (req, res) => {
    try {
        const siteId = req.query.siteId;
        if (!siteId) return res.status(400).json({ errno: 400, error: 'siteId is required' });
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;
        const resolution = req.query.resolution ? parseInt(req.query.resolution, 10) : undefined;

        const q = {};
        if (startDate) q.startDate = startDate;
        if (endDate) q.endDate = endDate;
        if (resolution) q.resolution = resolution;

        const data = await callAmberAPI(`/sites/${encodeURIComponent(siteId)}/prices`, q, 'UI:/api/amber/prices');
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// GET persisted amber snapshots
app.get('/api/amber/store', async (req, res) => {
    try {
        const store = loadAmberStore();
        res.json({ errno: 0, result: store });
    } catch (e) {
        res.status(500).json({ errno: -1, error: e.message });
    }
});

// Serve structured crosswalk JSON for programmatic use
app.get('/api/amber/crosswalk', async (req, res) => {
    try {
        const crosswalkPath = path.join(__dirname, 'amber_crosswalk.json');
        if (!fs.existsSync(crosswalkPath)) return res.status(404).json({ errno: 404, error: 'crosswalk not found' });
        const raw = fs.readFileSync(crosswalkPath, 'utf8');
        const obj = JSON.parse(raw || '{}');
        res.json({ errno: 0, result: obj });
    } catch (e) {
        res.status(500).json({ errno: -1, error: e.message });
    }
});

// Battery real data (not present previously in server) -> maps to /op/v0/device/battery/real/query
app.post('/api/device/battery/real', async (req, res) => {
    try {
        const sn = (req.body && req.body.sn) || DEVICE_SN;
        // The FoxESS API expects GET for this endpoint with sn in query params
        const result = await callFoxESSAPI(`/op/v0/device/battery/real/query?sn=${sn}`, 'GET', null, 'UI:/api/device/battery/real');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== Inverter V1 ====================

app.get('/api/inverter-v1/real-time', async (req, res) => {
    try {
        const sn = req.query.sn || DEVICE_SN;
            const result = await callFoxESSAPI('/op/v1/device/real/query', 'POST', {
                sns: [sn],
                variables: ['generationPower', 'pvPower', 'pv1Power', 'pv2Power', 'pv3Power', 'pv4Power', 'pv1Volt', 'pv2Volt', 'pv3Volt', 'pv4Volt', 'feedinPower', 'gridConsumptionPower', 'loadsPower', 'batChargePower', 'batDischargePower', 'SoC']
        }, 'UI:/api/inverter-v1/real-time');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/inverter/history', async (req, res) => {
    try {
        const sn = req.query.sn || DEVICE_SN;
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
        
        log('info', `[History] Requesting: begin=${begin} (${new Date(begin).toISOString()}), end=${end} (${new Date(end).toISOString()})`);
        
        // Set a strict timeout for the FoxESS call to prevent hanging
        // Note: AbortController is not supported by node-fetch v2, so we rely on the timeout inside callFoxESSAPI
        // But we keep this logic to ensure we respond to the client even if callFoxESSAPI hangs
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Request timeout')), 9000)
        );
        
        try {
            const MAX_RANGE_MS = 24 * 60 * 60 * 1000; // 24 hours per FoxESS request to avoid upstream parameter limits

            // If the requested window is small, call FoxESS once. For larger windows, split into chunks and merge results.
            if ((end - begin) <= MAX_RANGE_MS) {
                // Check cache first
                const cachedResult = getHistoryFromCache(sn, begin, end);
                if (cachedResult) {
                    log('info', `[History] Cache HIT for single chunk ${new Date(begin).toISOString()} - ${new Date(end).toISOString()}`);
                    return res.json(cachedResult);
                }
                
                const result = await Promise.race([
                    callFoxESSAPI('/op/v0/device/history/query', 'POST', {
                        sn,
                        begin,
                        end,
                        variables: ['generationPower', 'feedinPower', 'gridConsumptionPower']
                    }, 'UI:/api/inverter/history'),
                    timeoutPromise
                ]);
                
                // Cache successful response
                if (result && result.errno === 0) {
                    setHistoryCache(sn, begin, end, result);
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
            let deviceSN = DEVICE_SN;

            for (const ch of chunks) {
                // Check cache for this chunk
                let chunkResp = getHistoryFromCache(sn, ch.cbeg, ch.cend);
                if (chunkResp) {
                    log('info', `[History] Cache HIT for chunk ${new Date(ch.cbeg).toISOString()} - ${new Date(ch.cend).toISOString()}`);
                } else {
                    chunkResp = await callFoxESSAPI('/op/v0/device/history/query', 'POST', {
                        sn,
                        begin: ch.cbeg,
                        end: ch.cend,
                        variables: ['generationPower', 'feedinPower', 'gridConsumptionPower']
                    }, 'UI:/api/inverter/history:chunk');
                    
                    // Cache successful chunk response
                    if (chunkResp && chunkResp.errno === 0) {
                        setHistoryCache(sn, ch.cbeg, ch.cend, chunkResp);
                    }
                }

                if (!chunkResp || chunkResp.errno !== 0) {
                    // Bubble up the upstream error
                    const errMsg = chunkResp && chunkResp.msg ? chunkResp.msg : 'Unknown FoxESS error';
                    log('warn', `[History] FoxESS chunk error for ${new Date(ch.cbeg).toISOString()} - ${new Date(ch.cend).toISOString()}: ${errMsg}`);
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
            log('warn', `[History] API error: ${apiError.message}`);
            res.status(500).json({ errno: 500, msg: `FoxESS API error: ${apiError.message}` });
        }
    } catch (error) {
        log('error', `[History] Request error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Mock endpoint for testing when FoxESS has no data
// Note: Mock history endpoint intentionally removed - mock/test data disabled in production.
// If you need to re-enable synthetic data temporarily, reintroduce a controlled test endpoint
// in a separate development branch. Mock endpoints are removed to avoid accidental UI fallbacks.

app.get('/api/inverter/report', async (req, res) => {
    try {
        const sn = req.query.sn || DEVICE_SN;
        const dimension = req.query.dimension || 'day'; // day, month, year
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;
        const day = parseInt(req.query.day) || new Date().getDate();
        
        // Build request body based on dimension
        const body = {
            sn,
            dimension,
            variables: ['generation', 'feedin', 'gridConsumption', 'chargeEnergyToTal', 'dischargeEnergyToTal']
        };
        
        // Add year for month/year dimensions
        if (dimension === 'month' || dimension === 'year') {
            body.year = year;
        }
        // Add month and year for day dimension
        if (dimension === 'day') {
            body.month = month;
            body.year = year;
        }
        // Add month, day, year for hour dimension
        if (dimension === 'hour') {
            body.month = month;
            body.day = day;
            body.year = year;
        }
        
        const result = await callFoxESSAPI('/op/v0/device/report/query', 'POST', body, 'UI:/api/inverter/report');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/inverter/generation', async (req, res) => {
    try {
        const sn = req.query.sn || DEVICE_SN;
        // FoxESS generation endpoint requires GET with sn as query param
        const result = await callFoxESSAPI(`/op/v0/device/generation?sn=${encodeURIComponent(sn)}`, 'GET', null, 'UI:/api/inverter/generation');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/inverter/settings', async (req, res) => {
    try {
        const sn = req.query.sn || DEVICE_SN;
        // FoxESS device setting/get endpoint requires sn and key in body
        // key examples: MinSoc, MinSocOnGrid, etc.
        const key = req.query.key;
        if (!key) {
            return res.json({ errno: 40257, msg: 'Missing required parameter: key (e.g., MinSoc, MinSocOnGrid)', result: null });
        }
        const result = await callFoxESSAPI('/op/v0/device/setting/get', 'POST', { sn, key }, 'UI:/api/inverter/settings');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/inverter/battery-soc', async (req, res) => {
    try {
        const sn = req.query.sn || DEVICE_SN;
        // FoxESS battery soc endpoint requires GET with sn as query param
        const result = await callFoxESSAPI(`/op/v0/device/battery/soc/get?sn=${encodeURIComponent(sn)}`, 'GET', null, 'UI:/api/inverter/battery-soc');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/device/battery/soc/get', async (req, res) => {
    try {
        const sn = req.query.sn || DEVICE_SN;
        const result = await callFoxESSAPI(`/op/v0/device/battery/soc/get?sn=${encodeURIComponent(sn)}`, 'GET', null, 'UI:/api/device/battery/soc/get');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== Set / Write Endpoints ====================

app.post('/api/device/battery/soc/set', async (req, res) => {
    try {
        const sn = req.body.sn || DEVICE_SN;
        const { minSoc, minSocOnGrid } = req.body;
        const result = await callFoxESSAPI('/op/v0/device/battery/soc/set', 'POST', { sn, minSoc, minSocOnGrid }, 'UI:/api/device/battery/soc/set');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/device/battery/forceChargeTime/set', async (req, res) => {
    try {
        const sn = req.body.sn || DEVICE_SN;
        const body = Object.assign({ sn }, req.body);
        const result = await callFoxESSAPI('/op/v0/device/battery/forceChargeTime/set', 'POST', body, 'UI:/api/device/battery/forceChargeTime/set');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/device/setting/set', async (req, res) => {
    try {
        const sn = req.body.sn || DEVICE_SN;
        const { key, value } = req.body;
        const result = await callFoxESSAPI('/op/v0/device/setting/set', 'POST', { sn, key, value }, 'UI:/api/device/setting/set');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/device/time/set', async (req, res) => {
    try {
        const sn = req.body.sn || DEVICE_SN;
        const body = Object.assign({ sn }, req.body);
        const result = await callFoxESSAPI('/op/v0/device/time/set', 'POST', body, 'UI:/api/device/time/set');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/device/peakShaving/set', async (req, res) => {
    try {
        const sn = req.body.sn || DEVICE_SN;
        const body = Object.assign({ sn }, req.body);
        const result = await callFoxESSAPI('/op/v0/device/peakShaving/set', 'POST', body, 'UI:/api/device/peakShaving/set');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/device/setMeterReader', async (req, res) => {
    try {
        const sn = req.body.sn || DEVICE_SN;
        const body = Object.assign({ sn }, req.body);
        const result = await callFoxESSAPI('/op/v0/device/setMeterReader', 'POST', body, 'UI:/api/device/setMeterReader');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/device/batteryHeating/set', async (req, res) => {
    try {
        const sn = req.body.sn || DEVICE_SN;
        const body = Object.assign({ sn }, req.body);
        const result = await callFoxESSAPI('/op/v0/device/batteryHeating/set', 'POST', body, 'UI:/api/device/batteryHeating/set');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/scheduler/set/flag', async (req, res) => {
    try {
        const deviceSN = req.body.deviceSN || DEVICE_SN;
        const { enable } = req.body;
        const result = await callFoxESSAPI('/op/v0/device/scheduler/set/flag', 'POST', { deviceSN, enable }, 'UI:/api/scheduler/set/flag');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/scheduler/enable', async (req, res) => {
    try {
        const deviceSN = req.body.deviceSN || DEVICE_SN;
        const body = Object.assign({ deviceSN }, req.body);
        const result = await callFoxESSAPI('/op/v0/device/scheduler/enable', 'POST', body, 'UI:/api/scheduler/enable');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/ems/setting/rate/set', async (req, res) => {
    try {
        const body = req.body;
        const result = await callFoxESSAPI('/op/v0/ems/setting/rate/set', 'POST', body, 'UI:/api/ems/setting/rate/set');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/ems/setting/system/set', async (req, res) => {
    try {
        const body = req.body;
        const result = await callFoxESSAPI('/op/v0/ems/setting/system/set', 'POST', body, 'UI:/api/ems/setting/system/set');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/gw/setting/set', async (req, res) => {
    try {
        const body = req.body;
        const result = await callFoxESSAPI('/op/v0/gw/setting/set', 'POST', body, 'UI:/api/gw/setting/set');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/plant/create', async (req, res) => {
    try {
        const body = req.body;
        const result = await callFoxESSAPI('/op/v0/plant/create', 'POST', body, 'UI:/api/plant/create');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/plant/delete', async (req, res) => {
    try {
        const body = req.body;
        const result = await callFoxESSAPI('/op/v0/plant/delete', 'POST', body, 'UI:/api/plant/delete');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/plant/update', async (req, res) => {
    try {
        const body = req.body;
        const result = await callFoxESSAPI('/op/v0/plant/update', 'POST', body, 'UI:/api/plant/update');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/module/modbus/commands', async (req, res) => {
    try {
        const body = req.body;
        const result = await callFoxESSAPI('/op/v0/module/modbus/commands', 'POST', body, 'UI:/api/module/modbus/commands');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== Power Station ====================

app.get('/api/plant/list', async (req, res) => {
    try {
        const result = await callFoxESSAPI('/op/v0/plant/list', 'POST', {
            currentPage: 1,
            pageSize: 10
        }, 'UI:/api/plant/list');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== Scheduler ====================

// ==================== Automation API ====================

// Update configuration
app.post('/api/config', (req, res) => {
    try {
        const newConfig = req.body;
        
        // Validate required structure (original sections)
        if (!newConfig.automation || !newConfig.cache || !newConfig.defaults) {
            return res.json({ errno: 1, msg: 'Missing required configuration sections' });
        }
        
        // Validate automation values
        if (newConfig.automation.intervalMs < 10000) {
            return res.json({ errno: 1, msg: 'Automation interval must be at least 10 seconds' });
        }
        if (newConfig.automation.startDelayMs < 0) {
            return res.json({ errno: 1, msg: 'Start delay cannot be negative' });
        }
        if (newConfig.automation.gatherDataTimeoutMs < 5000) {
            return res.json({ errno: 1, msg: 'Gather data timeout must be at least 5 seconds' });
        }
        
        // Validate blackout windows if provided
        if (newConfig.automation.blackoutWindows) {
            if (!Array.isArray(newConfig.automation.blackoutWindows)) {
                return res.json({ errno: 1, msg: 'Blackout windows must be an array' });
            }
            for (const w of newConfig.automation.blackoutWindows) {
                if (!w.start || !w.end || !/^\d{2}:\d{2}$/.test(w.start) || !/^\d{2}:\d{2}$/.test(w.end)) {
                    return res.json({ errno: 1, msg: 'Blackout windows must have start and end in HH:MM format' });
                }
            }
        }
        
        // Validate cache values
        if (newConfig.cache.amber < 30000) {
            return res.json({ errno: 1, msg: 'Amber cache must be at least 30 seconds' });
        }
        if (newConfig.cache.inverter < 60000) {
            return res.json({ errno: 1, msg: 'Inverter cache must be at least 60 seconds (API rate limits)' });
        }
        if (newConfig.cache.weather < 300000) {
            return res.json({ errno: 1, msg: 'Weather cache must be at least 5 minutes' });
        }
        
        // Validate defaults
        if (newConfig.defaults.cooldownMinutes < 0) {
            return res.json({ errno: 1, msg: 'Cooldown cannot be negative' });
        }
        if (newConfig.defaults.durationMinutes < 1) {
            return res.json({ errno: 1, msg: 'Duration must be at least 1 minute' });
        }
        if (newConfig.defaults.fdPwr < 1000 || newConfig.defaults.fdPwr > 10000) {
            return res.json({ errno: 1, msg: 'Force discharge power must be between 1000-10000 watts' });
        }
        
        // Validate logging if provided
        if (newConfig.logging) {
            const validLevels = ['error', 'warn', 'info', 'debug'];
            if (newConfig.logging.level && !validLevels.includes(newConfig.logging.level)) {
                return res.json({ errno: 1, msg: `Logging level must be one of: ${validLevels.join(', ')}` });
            }
        }
        
        // Validate API retry settings if provided
        if (newConfig.api) {
            if (newConfig.api.retryCount !== undefined && (newConfig.api.retryCount < 0 || newConfig.api.retryCount > 10)) {
                return res.json({ errno: 1, msg: 'API retry count must be between 0 and 10' });
            }
            if (newConfig.api.retryDelayMs !== undefined && (newConfig.api.retryDelayMs < 100 || newConfig.api.retryDelayMs > 10000)) {
                return res.json({ errno: 1, msg: 'API retry delay must be between 100ms and 10000ms' });
            }
        }
        
        // Validate safety thresholds if provided
        if (newConfig.safety) {
            const minSoc = newConfig.safety.minSocPercent ?? CONFIG.safety.minSocPercent;
            const maxSoc = newConfig.safety.maxSocPercent ?? CONFIG.safety.maxSocPercent;
            if (minSoc < 0 || minSoc > 50) {
                return res.json({ errno: 1, msg: 'Minimum SoC must be between 0% and 50%' });
            }
            if (maxSoc < 50 || maxSoc > 100) {
                return res.json({ errno: 1, msg: 'Maximum SoC must be between 50% and 100%' });
            }
            if (minSoc >= maxSoc) {
                return res.json({ errno: 1, msg: 'Minimum SoC must be less than Maximum SoC' });
            }
        }
        
        // Update CONFIG object
        CONFIG.automation = { ...CONFIG.automation, ...newConfig.automation };
        CONFIG.cache = { ...CONFIG.cache, ...newConfig.cache };
        CONFIG.defaults = { ...CONFIG.defaults, ...newConfig.defaults };
        if (newConfig.logging) CONFIG.logging = { ...CONFIG.logging, ...newConfig.logging };
        if (newConfig.api) CONFIG.api = { ...CONFIG.api, ...newConfig.api };
        if (newConfig.safety) CONFIG.safety = { ...CONFIG.safety, ...newConfig.safety };
        
        // Persist to file
        saveConfig();
        
        log('info', '[Config] Configuration updated:', JSON.stringify(CONFIG));
        
        // Note: Automation interval change will take effect on next cycle
        // We don't restart the automation loop here to avoid interrupting current cycle
        
        res.json({
            errno: 0,
            msg: 'Configuration saved successfully. Changes will take effect on next automation cycle.',
            result: CONFIG
        });
    } catch (error) {
        log('error', 'Failed to update configuration:', error);
        res.json({ errno: 1, msg: `Failed to update configuration: ${error.message}` });
    }
});

// Get automation status
app.get('/api/automation/status', (req, res) => {
    // Check if currently in blackout window
    const blackoutInfo = getBlackoutInfo();
    
    res.json({
        errno: 0,
        result: {
            enabled: automationState.enabled,
            lastCheck: automationState.lastCheck,
            lastTriggered: automationState.lastTriggered,
            activeRule: automationState.activeRule,
            activeSegmentEnabled: automationState.activeSegmentEnabled,
            activeGroupIdx: automationState.activeGroupIdx,
            rules: automationState.rules,
            inBlackout: blackoutInfo.inBlackout,
            currentBlackoutWindow: blackoutInfo.window
        }
    });
});

// Enable/disable master automation (all rules)
app.post('/api/automation/enable', (req, res) => {
    const { enabled } = req.body;
    automationState.enabled = !!enabled;
    saveAutomationState();
    console.log(`[Automation] Master switch ${automationState.enabled ? 'ENABLED' : 'DISABLED'}`);
    res.json({ errno: 0, result: { enabled: automationState.enabled } });
});

// Update a specific rule - supports ALL parameters including conditions and action
app.post('/api/automation/rule/update', async (req, res) => {
    const { ruleName, ...updates } = req.body;
    if (!ruleName || !automationState.rules[ruleName]) {
        return res.status(400).json({ errno: 400, error: 'Invalid rule name' });
    }
    const rule = automationState.rules[ruleName];
    
    // Check if this rule is being DISABLED and it's currently the active rule
    const wasEnabled = rule.enabled;
    const isBeingDisabled = updates.enabled === false && wasEnabled;
    const isActiveRule = automationState.activeRule === ruleName && automationState.activeSegmentEnabled;
    
    // Update basic rule properties
    if (updates.name !== undefined) rule.name = updates.name;
    if (updates.enabled !== undefined) rule.enabled = !!updates.enabled;
    if (updates.priority !== undefined) rule.priority = parseInt(updates.priority, 10) || 5;
    if (updates.threshold !== undefined) rule.threshold = parseFloat(updates.threshold);
    if (updates.cooldownMinutes !== undefined) rule.cooldownMinutes = parseInt(updates.cooldownMinutes, 10);
    
    // Update conditions if provided
    if (updates.conditions && typeof updates.conditions === 'object') {
        if (!rule.conditions) rule.conditions = {};
        
        // Feed-in price condition
        if (updates.conditions.feedInPrice) {
            rule.conditions.feedInPrice = {
                enabled: !!updates.conditions.feedInPrice.enabled,
                operator: updates.conditions.feedInPrice.operator || '>',
                value: parseFloat(updates.conditions.feedInPrice.value) || 0,
                value2: parseFloat(updates.conditions.feedInPrice.value2) || 0
            };
        }
        // Buy price condition
        if (updates.conditions.buyPrice) {
            rule.conditions.buyPrice = {
                enabled: !!updates.conditions.buyPrice.enabled,
                operator: updates.conditions.buyPrice.operator || '<',
                value: parseFloat(updates.conditions.buyPrice.value) || 0,
                value2: parseFloat(updates.conditions.buyPrice.value2) || 0
            };
        }
        // SoC condition
        if (updates.conditions.soc) {
            rule.conditions.soc = {
                enabled: !!updates.conditions.soc.enabled,
                operator: updates.conditions.soc.operator || '>',
                value: parseFloat(updates.conditions.soc.value) || 50,
                value2: parseFloat(updates.conditions.soc.value2) || 100
            };
        }
        // Temperature condition
        if (updates.conditions.temperature) {
            rule.conditions.temperature = {
                enabled: !!updates.conditions.temperature.enabled,
                type: updates.conditions.temperature.type || 'battery',
                operator: updates.conditions.temperature.operator || '<',
                value: parseFloat(updates.conditions.temperature.value) || 40
            };
        }
        // Time window condition - store as 'time' format
        if (updates.conditions.time) {
            rule.conditions.time = {
                enabled: !!updates.conditions.time.enabled,
                startTime: updates.conditions.time.startTime || '00:00',
                endTime: updates.conditions.time.endTime || '23:59'
            };
            // Remove legacy timeWindow if it exists
            delete rule.conditions.timeWindow;
        }
    }
    
    // Update action parameters if provided
    if (updates.action && typeof updates.action === 'object') {
        if (!rule.action) rule.action = {};
        if (updates.action.workMode !== undefined) rule.action.workMode = updates.action.workMode;
        if (updates.action.durationMinutes !== undefined) rule.action.durationMinutes = parseInt(updates.action.durationMinutes, 10);
        if (updates.action.minSocOnGrid !== undefined) rule.action.minSocOnGrid = parseInt(updates.action.minSocOnGrid, 10);
        if (updates.action.fdSoc !== undefined) rule.action.fdSoc = parseInt(updates.action.fdSoc, 10);
        if (updates.action.fdPwr !== undefined) rule.action.fdPwr = parseInt(updates.action.fdPwr, 10);
        if (updates.action.maxSoc !== undefined) rule.action.maxSoc = parseInt(updates.action.maxSoc, 10);
    }
    
    saveAutomationState();
    console.log(`[Automation] Rule '${ruleName}' updated:`, JSON.stringify(rule, null, 2));
    
    // If this rule was active and is being disabled, cancel its segment immediately
    if (isBeingDisabled && isActiveRule) {
        console.log(`[Automation] Rule '${ruleName}' was DISABLED while active - cancelling segment NOW`);
        try {
            const cancelResult = await cancelActiveSegment();
            console.log(`[Automation] Cancel result: errno=${cancelResult?.errno}, msg=${cancelResult?.msg}`);
            automationState.activeRule = null;
            automationState.activeSegmentEnabled = false;
            automationState.activeGroupIdx = null;
            automationState.activeSegment = null;
            saveAutomationState();
        } catch (e) {
            console.error(`[Automation] Failed to cancel segment on rule disable:`, e.message);
        }
    }
    
    res.json({ errno: 0, result: { rule: ruleName, ...rule } });
});

// Manually trigger a rule (for testing)
app.post('/api/automation/trigger', async (req, res) => {
    const { ruleName } = req.body;
    const rule = automationState.rules[ruleName];
    if (!rule) {
        return res.status(400).json({ errno: 400, error: 'Unknown rule' });
    }
    
    try {
        const result = await applyRuleAction(rule.action || {}, false);
        rule.lastTriggered = Date.now();
        automationState.lastTriggered = Date.now();
        automationState.activeRule = ruleName;
        saveAutomationState();
        res.json({ errno: 0, result: result });
    } catch (e) {
        res.status(500).json({ errno: 500, error: e.message });
    }
});

// Test automation rules with mock data (Dry Run)
app.post('/api/automation/test', async (req, res) => {
    try {
        const { mockData } = req.body;
        
        // Temporarily set mock currentData for testing
        const originalData = JSON.parse(JSON.stringify(currentData));
        
        // Build mock Amber data structure
        currentData.amber = [
            {
                type: 'CurrentInterval',
                channelType: 'feedIn',
                perKwh: -(mockData?.feedInPrice ?? 0) // Convert back to Amber's negative format
            },
            {
                type: 'CurrentInterval',
                channelType: 'general',
                perKwh: mockData?.buyPrice ?? 30
            }
        ];
        
        // Build mock inverter data structure
        currentData.inverter = [
            { variable: 'SoC', value: mockData?.soc ?? 50 },
            { variable: 'batTemperature', value: mockData?.batteryTemp ?? 25 },
            { variable: 'ambientTemperation', value: mockData?.ambientTemp ?? 20 }
        ];
        
        // Weather
        currentData.weather = {
            temperature: mockData?.ambientTemp ?? 20,
            weathercode: mockData?.weatherCode ?? 0
        };
        
        currentData.lastUpdate = Date.now();
        
        console.log('[Automation] Test Request - Mock data applied', mockData?.testTime ? `(testTime: ${mockData.testTime})` : '(using current time)');
        
        // Get rules sorted by priority
        const sortedRules = Object.entries(automationState.rules || {})
            .filter(([_, rule]) => rule.enabled)
            .sort((a, b) => (a[1].priority || 99) - (b[1].priority || 99));
        
        let triggeredResult = null;
        let allResults = [];
        
        // Evaluate rules in priority order - first match wins
        for (const [ruleName, rule] of sortedRules) {
            const result = await evaluateRule(ruleName, rule, true, mockData?.testTime); // Dry Run with optional testTime
            allResults.push(result);
            if (result && result.triggered) {
                triggeredResult = result;
                break;
            }
        }
        
        // Restore original data
        Object.assign(currentData, originalData);
        
        res.json({
            errno: 0,
            triggered: !!triggeredResult,
            testData: {
                feedInPrice: mockData?.feedInPrice ?? 0,
                buyPrice: mockData?.buyPrice ?? 30,
                soc: mockData?.soc ?? 50,
                batteryTemp: mockData?.batteryTemp ?? 25,
                ambientTemp: mockData?.ambientTemp ?? 20,
                testTime: mockData?.testTime || 'current time'
            },
            result: triggeredResult || { message: 'No rules triggered', allResults }
        });
    } catch (error) {
        console.error('[Automation] Test error:', error);
        res.status(500).json({ errno: 500, error: error.message });
    }
});

// Create a new automation rule with multi-condition support
app.post('/api/automation/rule/create', (req, res) => {
    try {
        const { ruleName, name, priority, conditions, cooldownMinutes, enabled, action } = req.body;
        
        if (!ruleName || typeof ruleName !== 'string') {
            return res.status(400).json({ errno: 400, error: 'ruleName is required (e.g., lowBuyCost, highSoC)' });
        }
        
        // Sanitize ruleName (alphanumeric + underscore only)
        const sanitizedName = ruleName.replace(/[^a-zA-Z0-9_]/g, '_');
        
        // Check if rule already exists
        if (automationState.rules[sanitizedName]) {
            return res.status(400).json({ errno: 400, error: `Rule '${sanitizedName}' already exists. Use /api/automation/rule/update to modify it.` });
        }
        
        // Build conditions object from request
        const ruleConditions = {
            feedInPrice: {
                enabled: conditions?.feedInPrice?.enabled ?? false,
                operator: conditions?.feedInPrice?.operator || '>',
                value: parseFloat(conditions?.feedInPrice?.value) || 0,
                value2: parseFloat(conditions?.feedInPrice?.value2) || 0
            },
            buyPrice: {
                enabled: conditions?.buyPrice?.enabled ?? false,
                operator: conditions?.buyPrice?.operator || '<',
                value: parseFloat(conditions?.buyPrice?.value) || 0,
                value2: parseFloat(conditions?.buyPrice?.value2) || 0
            },
            soc: {
                enabled: conditions?.soc?.enabled ?? false,
                operator: conditions?.soc?.operator || '>',
                value: parseFloat(conditions?.soc?.value) || 50,
                value2: parseFloat(conditions?.soc?.value2) || 100
            },
            temperature: {
                enabled: conditions?.temperature?.enabled ?? false,
                type: conditions?.temperature?.type || 'battery',
                operator: conditions?.temperature?.operator || '<',
                value: parseFloat(conditions?.temperature?.value) || 40,
                value2: parseFloat(conditions?.temperature?.value2) || 0
            },
            weather: {
                enabled: conditions?.weather?.enabled ?? false,
                codes: Array.isArray(conditions?.weather?.codes) ? conditions.weather.codes : []
            },
            time: {
                enabled: conditions?.time?.enabled ?? false,
                startTime: conditions?.time?.startTime || '00:00',
                endTime: conditions?.time?.endTime || '23:59'
            }
        };
        
        // Create new rule with defaults
        const newRule = {
            name: name || ruleName,
            enabled: enabled !== undefined ? !!enabled : false,
            priority: parseInt(priority, 10) || 10,
            conditions: ruleConditions,
            cooldownMinutes: parseInt(cooldownMinutes, 10) || 5,
            lastTriggered: null,
            action: {
                workMode: action?.workMode || 'SelfUse',
                durationMinutes: parseInt(action?.durationMinutes, 10) || 30,
                minSocOnGrid: parseInt(action?.minSocOnGrid, 10) || 10,
                fdSoc: parseInt(action?.fdSoc, 10) || 10,
                fdPwr: parseInt(action?.fdPwr, 10) || 0,
                maxSoc: parseInt(action?.maxSoc, 10) || 100
            }
        };
        
        automationState.rules[sanitizedName] = newRule;
        saveAutomationState();
        
        console.log(`[Automation] Created new rule '${sanitizedName}':`, JSON.stringify(newRule, null, 2));
        res.json({ errno: 0, result: { ruleName: sanitizedName, ...newRule } });
    } catch (error) {
        console.error('[Automation] Rule create error:', error);
        res.status(500).json({ errno: 500, error: error.message });
    }
});

// Delete an automation rule
app.post('/api/automation/rule/delete', (req, res) => {
    try {
        const { ruleName } = req.body;
        
        if (!ruleName) {
            return res.status(400).json({ errno: 400, error: 'ruleName is required' });
        }
        
        if (!automationState.rules[ruleName]) {
            return res.status(404).json({ errno: 404, error: `Rule '${ruleName}' not found` });
        }
        
        delete automationState.rules[ruleName];
        saveAutomationState();
        
        console.log(`[Automation] Deleted rule '${ruleName}'`);
        res.json({ errno: 0, result: { deleted: ruleName } });
    } catch (error) {
        res.status(500).json({ errno: 500, error: error.message });
    }
});

// Reset automation state (clear cooldowns)
app.post('/api/automation/reset', (req, res) => {
    for (const rule of Object.values(automationState.rules)) {
        rule.lastTriggered = null;
    }
    automationState.lastTriggered = null;
    automationState.activeRule = null;
    saveAutomationState();
    console.log(`[Automation] State reset`);
    res.json({ errno: 0, result: 'Automation state reset' });
});

app.get('/api/scheduler/get', async (req, res) => {
    try {
        const sn = req.query.sn || DEVICE_SN;
        const result = await callFoxESSAPI('/op/v0/device/scheduler/get', 'POST', { deviceSN: sn }, 'UI:/api/scheduler/get');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/scheduler/flag', async (req, res) => {
    try {
        const sn = req.query.sn || DEVICE_SN;
        const result = await callFoxESSAPI('/op/v0/device/scheduler/get/flag', 'POST', { deviceSN: sn }, 'UI:/api/scheduler/flag');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Scheduler V2 - Time segments (manual scheduler in FoxESS app)
app.get('/api/scheduler/v2/get', async (req, res) => {
    try {
        const sn = req.query.sn || DEVICE_SN;
        const result = await callFoxESSAPI('/op/v2/device/scheduler/get', 'POST', { deviceSN: sn }, 'UI:/api/scheduler/v2/get');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Scheduler V2 - Set time segments
app.post('/api/scheduler/v2/set', async (req, res) => {
    try {
        const deviceSN = req.body.sn || req.body.deviceSN || DEVICE_SN;
        const groups = req.body.groups || [];
        const result = await callFoxESSAPI('/op/v2/device/scheduler/enable', 'POST', { deviceSN, groups }, 'UI:/api/scheduler/v2/set');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Scheduler V1 - Set time segments (Mode Scheduler - safer for maxSoc devices)
app.post('/api/scheduler/v1/set', async (req, res) => {
    try {
        const deviceSN = req.body.sn || req.body.deviceSN || DEVICE_SN;
        const groups = req.body.groups || [];
        const result = await callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups }, 'UI:/api/scheduler/v1/set');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Scheduler V1 - Get time segments
app.get('/api/scheduler/v1/get', async (req, res) => {
    try {
        const sn = req.query.sn || DEVICE_SN;
        const result = await callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN: sn }, 'UI:/api/scheduler/v1/get');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Scheduler V1 - Set flag (enable/disable)
app.post('/api/scheduler/v1/flag', async (req, res) => {
    try {
        const deviceSN = req.body.sn || req.body.deviceSN || DEVICE_SN;
        const enable = req.body.enable !== undefined ? req.body.enable : 0;
        const result = await callFoxESSAPI('/op/v1/device/scheduler/set/flag', 'POST', { deviceSN, enable }, 'UI:/api/scheduler/v1/flag');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Scheduler V1 - Clear ALL segments (reset all 10 to disabled/00:00)
app.post('/api/scheduler/v1/clear-all', async (req, res) => {
    try {
        const deviceSN = req.body.sn || req.body.deviceSN || DEVICE_SN;
        console.log('[Scheduler] Clearing ALL 10 time periods...');
        
        // Create 10 empty/disabled segments
        const emptyGroups = [];
        for (let i = 0; i < 10; i++) {
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
        
        const result = await callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { 
            deviceSN, 
            groups: emptyGroups 
        }, 'UI:/api/scheduler/v1/clear-all');
        
        console.log(`[Scheduler] Clear all result: errno=${result.errno}, msg=${result.msg}`);
        res.json(result);
    } catch (error) {
        console.error('[Scheduler] Clear all error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Force charge time schedule
app.get('/api/device/battery/forceChargeTime/get', async (req, res) => {
    try {
        const sn = req.query.sn || DEVICE_SN;
        const result = await callFoxESSAPI(`/op/v0/device/battery/forceChargeTime/get?sn=${encodeURIComponent(sn)}`, 'GET', null, 'UI:/api/device/battery/forceChargeTime/get');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== Data Logger ====================

app.get('/api/module/list', async (req, res) => {
    try {
        const result = await callFoxESSAPI('/op/v0/module/list', 'POST', {
            currentPage: 1,
            pageSize: 10
        }, 'UI:/api/module/list');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/module/signal', async (req, res) => {
    try {
        // Module signal requires the module SN (not device SN)
        // First get moduleSN from module/list if not provided
        let moduleSN = req.query.moduleSN;
        if (!moduleSN) {
            const moduleList = await callFoxESSAPI('/op/v0/module/list', 'POST', {
                sn: DEVICE_SN,
                currentPage: 1,
                pageSize: 10
            }, 'UI:/api/module/signal:moduleLookup');
            if (moduleList.result?.data?.length > 0) {
                moduleSN = moduleList.result.data[0].moduleSN;
            }
        }
        if (!moduleSN) {
            return res.json({ errno: 41037, msg: 'No module found for device', result: null });
        }
        // API expects 'sn' param containing the moduleSN value
        const result = await callFoxESSAPI('/op/v0/module/getSignal', 'POST', { sn: moduleSN }, 'UI:/api/module/signal');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== EMS ====================

app.get('/api/ems/list', async (req, res) => {
    try {
        const result = await callFoxESSAPI('/op/v0/ems/list', 'POST', {
            currentPage: 1,
            pageSize: 10
        }, 'UI:/api/ems/list');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== Meter ====================

app.get('/api/meter/list', async (req, res) => {
    try {
        const result = await callFoxESSAPI('/op/v0/gw/list', 'POST', {
            currentPage: 1,
            pageSize: 10
        }, 'UI:/api/meter/list');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Catch-all for undefined API routes to prevent HTML responses
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ errno: 404, error: 'Endpoint not found' });
  }
  next();
});

// Catch unhandled promise rejections
process.on('uncaughtException', (err) => {
    console.error('[' + new Date().toISOString() + '] UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[' + new Date().toISOString() + '] UNHANDLED REJECTION at:', promise, 'reason:', reason);
});
process.on('exit', (code) => {
    console.log('[' + new Date().toISOString() + '] Process exit with code:', code);
});
process.on('SIGINT', () => {
    console.log('[' + new Date().toISOString() + '] Received SIGINT');
});
process.on('SIGTERM', () => {
    console.log('[' + new Date().toISOString() + '] Received SIGTERM');
});

app.listen(PORT, () => {
    console.log(`[${new Date().toISOString()}] Server running on http://localhost:${PORT}`);
    console.log('Make sure to set your FOXESS_TOKEN and DEVICE_SN in .env file');
    
    // Start automation loop AFTER server is ready (with 5 second delay)
    if (!automationLoopStarted) {
        automationLoopStarted = true;
        setTimeout(() => {
            console.log('[Automation] Starting background loop (delayed start)');
            startAutomationLoop();
        }, CONFIG.automation.startDelayMs);
    }
});
