/**
 * SoCrates - Shared Utilities
 * 
 * Common JavaScript functions used across the application.
 */

/* ============================================
   MESSAGE / NOTIFICATION UTILITIES
   ============================================ */

/**
 * Show a message notification
 * @param {string} type - 'success', 'error', 'warning', 'info'
 * @param {string} message - The message to display
 * @param {number} duration - Auto-hide duration in ms (0 = no auto-hide)
 */
function showMessage(type, message, duration = 5000) {
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    
    const icon = icons[type] || icons.info;
    
    // Try to find existing message area, or create one
    let messageArea = document.getElementById('messageArea');
    if (!messageArea) {
        messageArea = document.createElement('div');
        messageArea.id = 'messageArea';
        messageArea.style.cssText = [
            'position:fixed',
            'bottom:24px',
            'left:50%',
            'transform:translateX(-50%)',
            'z-index:10001',
            'max-width:480px',
            'width:90%',
            'pointer-events:none'
        ].join(';');
        document.body.appendChild(messageArea);
    }

    const alertClass = type === 'error' ? 'alert-danger' : `alert-${type}`;
    const toast = document.createElement('div');
    toast.className = `alert ${alertClass} toast-notification`;
    toast.style.animation = 'slideUpFadeIn 0.25s ease';
    toast.textContent = `${icon} ${message}`;
    messageArea.replaceChildren(toast);

    if (duration > 0) {
        setTimeout(() => {
            if (messageArea) messageArea.replaceChildren();
        }, duration);
    }
}

/**
 * Show error message
 */
function showError(message, duration = 5000) {
    showMessage('error', message, duration);
}

/**
 * Show success message
 */
function showSuccess(message, duration = 5000) {
    showMessage('success', message, duration);
}

/**
 * Show warning message
 */
function showWarning(message, duration = 5000) {
    showMessage('warning', message, duration);
}

/**
 * Show info message
 */
function showInfo(message, duration = 5000) {
    showMessage('info', message, duration);
}

/* ============================================
   API METRICS UTILITIES
   ============================================ */

function getInverterApiCount(dayMetrics = {}) {
    const metrics = (dayMetrics && typeof dayMetrics === 'object') ? dayMetrics : {};
    const explicitInverter = Number(metrics.inverter);
    if (Number.isFinite(explicitInverter) && explicitInverter >= 0) {
        return Math.round(explicitInverter);
    }

    const providerBuckets = {};
    const addProviderCount = (providerKey, value) => {
        const key = String(providerKey || '').toLowerCase().trim();
        if (!key) return;
        const count = Number(value);
        if (!Number.isFinite(count) || count <= 0) return;
        providerBuckets[key] = Math.max(providerBuckets[key] || 0, count);
    };

    ['foxess', 'sungrow', 'sigenergy', 'alphaess'].forEach((providerKey) => {
        addProviderCount(providerKey, metrics[providerKey]);
    });

    if (metrics.inverterByProvider && typeof metrics.inverterByProvider === 'object') {
        Object.entries(metrics.inverterByProvider).forEach(([providerKey, value]) => {
            addProviderCount(providerKey, value);
        });
    }

    // Do not infer inverter providers from arbitrary keys.
    // Some responses include non-inverter dotted counters (e.g. teslaFleet.calls.total).

    return Math.round(Object.values(providerBuckets).reduce((sum, count) => sum + count, 0));
}

function getEvApiCount(dayMetrics = {}) {
    const metrics = (dayMetrics && typeof dayMetrics === 'object') ? dayMetrics : {};
    const toCounter = (value) => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
    };
    const teslaFleetRoot = metrics.teslaFleet || metrics.teslafleet || null;

    const readNestedCounter = (root, path = []) => {
        if (!root || typeof root !== 'object' || !Array.isArray(path) || path.length === 0) return 0;
        let cursor = root;
        for (const segment of path) {
            if (!cursor || typeof cursor !== 'object') return 0;
            cursor = cursor[segment];
        }
        return toCounter(cursor);
    };

    const explicitEv = toCounter(metrics.ev);
    if (explicitEv) return explicitEv;

    const explicitTesla = toCounter(metrics.tesla);
    if (explicitTesla) return explicitTesla;

    const teslaFleetBillable = readNestedCounter(teslaFleetRoot, ['calls', 'billable']);
    if (teslaFleetBillable) return teslaFleetBillable;

    const teslaFleetTotal = readNestedCounter(teslaFleetRoot, ['calls', 'total']);
    if (teslaFleetTotal) return teslaFleetTotal;

    const byCategory = teslaFleetRoot && teslaFleetRoot.calls && teslaFleetRoot.calls.byCategory;
    if (byCategory && typeof byCategory === 'object') {
        const sum = Object.values(byCategory).reduce((acc, value) => acc + toCounter(value), 0);
        if (sum) return sum;
    }

    return 0;
}

function getPricingApiCount(dayMetrics = {}) {
    const metrics = (dayMetrics && typeof dayMetrics === 'object') ? dayMetrics : {};
    const toCounter = (value) => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
    };

    const explicitPricing = toCounter(metrics.pricing);
    if (explicitPricing) return explicitPricing;

    return toCounter(metrics.amber) + toCounter(metrics.aemo);
}

/* ============================================
   PROVIDER CAPABILITIES
   ============================================ */

const PROVIDER_UI_CAPABILITIES = Object.freeze({
    foxess: Object.freeze({
        label: 'FoxESS',
        supportsDirectWorkMode: true,
        supportsBackupMode: true,
        supportsAdvancedDeviceControls: true,
        supportsTelemetrySourceMapping: true,
        supportsQuickControl: true,
        supportsSchedulerControl: true,
        supportsExactPowerControl: true,
        supportsReliableYearlyReport: true,
        supportsAcHistoryAutoDetect: true,
        schedulerEditableWindowCount: 8,
        schedulerStepMinutes: 1
    }),
    alphaess: Object.freeze({
        label: 'AlphaESS',
        supportsDirectWorkMode: false,
        supportsBackupMode: false,
        supportsAdvancedDeviceControls: false,
        supportsTelemetrySourceMapping: false,
        supportsQuickControl: true,
        supportsSchedulerControl: true,
        supportsExactPowerControl: false,
        supportsReliableYearlyReport: false,
        supportsAcHistoryAutoDetect: false,
        schedulerEditableWindowCount: 4,
        schedulerStepMinutes: 15
    }),
    sungrow: Object.freeze({
        label: 'Sungrow',
        supportsDirectWorkMode: false,
        supportsBackupMode: false,
        supportsAdvancedDeviceControls: false,
        supportsTelemetrySourceMapping: false,
        supportsQuickControl: true,
        supportsSchedulerControl: true,
        supportsExactPowerControl: false,
        supportsReliableYearlyReport: true,
        supportsAcHistoryAutoDetect: true,
        schedulerEditableWindowCount: 4,
        schedulerStepMinutes: 1
    }),
    sigenergy: Object.freeze({
        label: 'SigenEnergy',
        supportsDirectWorkMode: false,
        supportsBackupMode: false,
        supportsAdvancedDeviceControls: false,
        supportsTelemetrySourceMapping: false,
        supportsQuickControl: false,
        supportsSchedulerControl: false,
        supportsExactPowerControl: false,
        supportsReliableYearlyReport: false,
        supportsAcHistoryAutoDetect: false,
        schedulerEditableWindowCount: 0,
        schedulerStepMinutes: 1
    })
});

function normalizeDeviceProvider(provider) {
    const normalized = String(provider || '').trim().toLowerCase();
    return normalized || 'foxess';
}

function getProviderCapabilities(provider) {
    const normalized = normalizeDeviceProvider(provider);
    const capabilities = PROVIDER_UI_CAPABILITIES[normalized] || PROVIDER_UI_CAPABILITIES.foxess;
    return {
        provider: normalized,
        ...capabilities
    };
}

/**
 * Load and display API call metrics
 * @param {number} days - Number of days to fetch
 */
async function loadApiMetrics(days = 1) {
    try {
        // Use apiClient if available, otherwise fallback
        // IMPORTANT: Use scope=user to show per-user metrics, not global platform totals
        let resp;
        const apiUrl = `/api/metrics/api-calls?days=${encodeURIComponent(days)}&scope=user`;
        if (typeof apiClient !== 'undefined' && apiClient) {
            resp = await apiClient.fetch(apiUrl);
        } else {
            resp = await firebaseAuth.fetchWithAuth(apiUrl);
        }
        
        let data;
        const contentType = resp.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
             data = await resp.json();
        } else {
             // If not JSON, it might be an error page
             const text = await resp.text();
             try { data = JSON.parse(text); } catch(e) { 
                 console.warn('Metrics API returned non-JSON:', text.substring(0, 100));
                 return; 
             }
        }
        
        if (!data || data.errno !== 0 || !data.result) return;
        
        const keys = Object.keys(data.result).sort().reverse();
        const todayKey = keys[0];
        const today = data.result[todayKey] || {};
        
        // Format date
        const dateObj = new Date(todayKey);
        const formatted = dateObj.toLocaleDateString('en-AU', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
        });
        
        // Update UI elements
        const dateEl = document.getElementById('metricsDate');
        const inverterEl = document.getElementById('countFox');
        const amberEl = document.getElementById('countAmber');
        const weatherEl = document.getElementById('countWeather');
        const evEl = document.getElementById('countEV');
        
        const displayCounter = (value) => {
            const n = Number(value);
            return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
        };

        if (dateEl) dateEl.textContent = formatted;
        if (inverterEl) inverterEl.textContent = getInverterApiCount(today);
        if (amberEl) amberEl.textContent = getPricingApiCount(today);
        if (weatherEl) weatherEl.textContent = displayCounter(today.weather);
        if (evEl) evEl.textContent = getEvApiCount(today);
    } catch (e) {
        console.warn('Failed to load API metrics:', e.message);
    }
}

// Global metrics timer (singleton to prevent multiple concurrent timers)
let metricsTimerId = null;

/**
 * Start automatic API metrics refresh (singleton pattern)
 * @param {number} intervalMs - Refresh interval in milliseconds
 * @returns {number|null} Timer ID if started, null if already running
 */
function startMetricsAutoRefresh(intervalMs = 60000) {
    // If timer already running, don't start another
    if (metricsTimerId) {
        // console.log('[Metrics] Auto-refresh already running');
        return null;
    }
    
    // Initial load
    loadApiMetrics(1);
    
    // Start interval timer
    metricsTimerId = setInterval(() => loadApiMetrics(1), intervalMs);
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (metricsTimerId) {
            clearInterval(metricsTimerId);
            metricsTimerId = null;
        }
    });
    
    return metricsTimerId;
}

/* ============================================
   FORMATTING UTILITIES
   ============================================ */

/**
 * Format milliseconds to human-readable string
 * @param {number} ms - Milliseconds
 * @returns {string}
 */
function formatMs(ms) {
    if (ms === null || ms === undefined || isNaN(ms)) return '?';
    ms = parseInt(ms);
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
}

/**
 * Format date to locale string
 * @param {Date|string|number} date - Date to format
 * @param {boolean} includeTime - Whether to include time
 * @returns {string}
 */
function formatDate(date, includeTime = true) {
    const d = new Date(date);
    const dateStr = d.toLocaleDateString('en-AU', { 
        month: 'short', 
        day: 'numeric' 
    });
    
    if (includeTime) {
        const timeStr = d.toLocaleTimeString('en-AU', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false
        });
        return `${dateStr} ${timeStr}`;
    }
    return dateStr;
}

/**
 * Format time ago string
 * @param {Date|string|number} date - Date to compare
 * @returns {string}
 */
function formatTimeAgo(date) {
    const now = new Date();
    const then = new Date(date);
    const diffMs = now - then;
    
    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    if (seconds > 10) return `${seconds}s ago`;
    return 'just now';
}

/**
 * Format number with unit
 * @param {number} value - Number to format
 * @param {string} unit - Unit string
 * @param {number} decimals - Decimal places
 * @returns {string}
 */
function formatValue(value, unit = '', decimals = 1) {
    if (value === null || value === undefined) return '—';
    const formatted = typeof value === 'number' ? value.toFixed(decimals) : value;
    return unit ? `${formatted}${unit}` : formatted;
}

/**
 * Convert a per-kWh price (in cents) to the displayed feed-in integer value
 * used by the tiles. Matches the transform used throughout the UI.
 * @param {number} perKwh - price in cents per kWh (may be decimal)
 * @returns {number|null} - display value (rounded and sign flipped), or null
 */
function feedDisplayValue(perKwh) {
    if (perKwh === null || perKwh === undefined || isNaN(perKwh)) return null;
    // Amber API returns positive values when you earn money
    return Math.round(perKwh);
}

/**
 * Map a feed-in display value to a CSS class name for tile colouring/highlight.
 * Keep thresholds conservative and easy to adjust in one place.
 * @param {number} displayVal - value returned by `feedDisplayValue`
 * @returns {string} - CSS class to apply (without the dot)
 */
function getFeedColour(displayVal) {
    if (displayVal === null || displayVal === undefined) return '';
    // Bright highlight for very high export rates (>= 50¢)
    if (displayVal >= 50) return 'feedin-highlight';
    // Extreme positive export (>= 30¢)
    if (displayVal >= 30) return 'extreme';
    // Good export (>= 10¢)
    if (displayVal >= 10) return 'success';
    // Low export or neutral
    if (displayVal >= 0) return '';
    // Negative values (shouldn't normally happen) mark as danger
    return 'danger';
}

/* ============================================
   DOM UTILITIES
   ============================================ */

/**
 * Toggle FAQ item open/closed
 * @param {HTMLElement} element - The FAQ question element
 */
function toggleFaq(element) {
    const item = element.closest('.faq-item') || element.parentElement;
    if (item) {
        item.classList.toggle('open');
    }
    
    // Also handle toggle button with arrow
    if (element.classList.contains('faq-toggle')) {
        element.classList.toggle('open');
        const content = element.nextElementSibling;
        if (content) {
            content.classList.toggle('open');
        }
    }
}

/**
 * Set loading state on a button
 * @param {string|HTMLElement} btn - Button ID or element
 * @param {boolean} loading - Whether loading
 * @param {string} loadingText - Text to show while loading
 */
function setButtonLoading(btn, loading, loadingText = 'Loading...') {
    const button = typeof btn === 'string' ? document.getElementById(btn) : btn;
    if (!button) return;
    
    if (loading) {
        button.disabled = true;
        button._originalHTML = button.innerHTML;
        button.innerHTML = `<div class="spinner"></div><span>${loadingText}</span>`;
    } else {
        button.disabled = false;
        if (button._originalHTML) {
            button.innerHTML = button._originalHTML;
        }
    }
}

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>}
 */
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (e) {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        return success;
    }
}

/* ============================================
   VALIDATION UTILITIES
   ============================================ */

/**
 * Sanitize input: remove invisible characters, BOM, zero-width spaces
 * @param {string} value - Input value
 * @returns {string}
 */
function sanitizeInput(value) {
    if (!value) return '';
    return value
        .replace(/[\uFEFF\u200B\u200C\u200D\u00A0]/g, '') // BOM and zero-width chars
        .replace(/[\x00-\x1F\x7F]/g, '') // Control characters
        .trim();
}

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean}
 */
function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

/* ============================================
   LOCAL STORAGE UTILITIES
   ============================================ */

/**
 * Safely get item from localStorage
 * @param {string} key - Storage key
 * @param {*} defaultValue - Default value if not found
 * @returns {*}
 */
function storageGet(key, defaultValue = null) {
    try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : defaultValue;
    } catch (e) {
        return defaultValue;
    }
}

/**
 * Safely set item in localStorage
 * @param {string} key - Storage key
 * @param {*} value - Value to store
 * @returns {boolean}
 */
function storageSet(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (e) {
        console.warn('localStorage set failed:', e);
        return false;
    }
}

/**
 * Safely remove item from localStorage
 * @param {string} key - Storage key
 */
function storageRemove(key) {
    try {
        localStorage.removeItem(key);
    } catch (e) {
        console.warn('localStorage remove failed:', e);
    }
}

/* ============================================
   DEBOUNCE / THROTTLE
   ============================================ */

/**
 * Debounce function calls
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function}
 */
function debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function calls
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in ms
 * @returns {Function}
 */
function throttle(func, limit = 300) {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/* ============================================
   AMBER SITE SELECTION — shared across pages
   ============================================ */

/** Returns the localStorage key to scope site selection per-user. */
function getAmberUserStorageId() {
    try {
        const mode = localStorage.getItem('adminImpersonationMode') || '';
        const uid = localStorage.getItem('adminImpersonationUid') || '';
        if (mode === 'header' && uid) return uid;
    } catch (e) { /* ignore */ }
    try {
        if (window.AppShell && typeof window.AppShell.getUser === 'function') {
            const uid = window.AppShell.getUser()?.uid;
            if (uid) return uid;
        }
    } catch (e) { /* ignore */ }
    return 'guest';
}

function getAmberSiteStorageKey() {
    return `amberSiteSelection:${getAmberUserStorageId()}`;
}

function normalizePricingProviderKey(provider) {
    const normalized = String(provider || 'amber').trim().toLowerCase();
    return normalized || 'amber';
}

function getPricingSelectionStorageKey(provider = 'amber') {
    return `pricingSelection:${normalizePricingProviderKey(provider)}:${getAmberUserStorageId()}`;
}

function getStoredPricingSelection(provider = 'amber') {
    const normalizedProvider = normalizePricingProviderKey(provider);
    try {
        const scoped = localStorage.getItem(getPricingSelectionStorageKey(normalizedProvider));
        if (scoped) return String(scoped).trim();
    } catch (e) { /* continue to legacy fallback */ }

    if (normalizedProvider === 'amber') {
        try {
            const legacy = localStorage.getItem('amberSiteId');
            if (legacy) return String(legacy).trim();
        } catch (e) { /* ignore */ }
    }

    return '';
}

function setStoredPricingSelection(provider = 'amber', selectionValue) {
    const normalizedProvider = normalizePricingProviderKey(provider);
    const normalizedValue = String(selectionValue || '').trim();
    if (!normalizedValue) return;
    try {
        localStorage.setItem(getPricingSelectionStorageKey(normalizedProvider), normalizedValue);
        if (normalizedProvider === 'amber') {
            localStorage.setItem('amberSiteId', normalizedValue);
        }
    } catch (e) { /* ignore */ }
}

/** Returns the user's stored Amber site ID (scoped per-user, legacy fallback). */
function getStoredAmberSiteId() {
    return getStoredPricingSelection('amber');
}

/** Persists the selected Amber site ID to localStorage (scoped + legacy key). */
function setStoredAmberSiteId(siteId) {
    setStoredPricingSelection('amber', siteId);
}

/* ============================================
   EXPORT FOR MODULE SYSTEMS
   ============================================ */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        showMessage,
        showError,
        showSuccess,
        showWarning,
        showInfo,
        loadApiMetrics,
        getPricingApiCount,
        getInverterApiCount,
        getProviderCapabilities,
        startMetricsAutoRefresh,
        formatMs,
        formatDate,
        formatTimeAgo,
        formatValue,
        toggleFaq,
        setButtonLoading,
        copyToClipboard,
        sanitizeInput,
        isValidEmail,
        storageGet,
        storageSet,
        storageRemove,
        debounce,
        throttle,
        // Pricing/format helpers
        feedDisplayValue,
        getFeedColour,
        // Amber site selection helpers
        getAmberUserStorageId,
        getAmberSiteStorageKey,
        getPricingSelectionStorageKey,
        getStoredPricingSelection,
        getStoredAmberSiteId,
        normalizePricingProviderKey,
        setStoredPricingSelection,
        setStoredAmberSiteId,
        normalizeDeviceProvider
    };
}

// Expose helpers to browser global for non-module usage
if (typeof window !== 'undefined') {
    window.sharedUtils = window.sharedUtils || {};
    Object.assign(window.sharedUtils, {
        feedDisplayValue,
        getFeedColour,
        formatValue,
        formatDate,
        formatTimeAgo,
        getPricingApiCount,
        getInverterApiCount,
        getProviderCapabilities,
        getStoredPricingSelection,
        getStoredAmberSiteId,
        normalizePricingProviderKey,
        setStoredPricingSelection,
        setStoredAmberSiteId,
        normalizeDeviceProvider
    });
}
