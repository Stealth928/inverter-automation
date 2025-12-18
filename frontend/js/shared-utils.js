/**
 * FoxESS Automation - Shared Utilities
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
        messageArea.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:10001;max-width:500px;width:90%;';
        document.body.appendChild(messageArea);
    }
    
    const alertClass = type === 'error' ? 'alert-danger' : `alert-${type}`;
    messageArea.innerHTML = `<div class="alert ${alertClass}" style="animation:fadeIn 0.3s ease">${icon} ${message}</div>`;
    
    if (duration > 0) {
        setTimeout(() => {
            if (messageArea) messageArea.innerHTML = '';
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
        } else if (typeof firebaseAuth !== 'undefined' && firebaseAuth.isSignedIn()) {
            resp = await firebaseAuth.fetchWithAuth(apiUrl);
        } else {
            resp = await fetch(apiUrl);
        }
        
        // Handle response using normalizeFetchResponse logic if available, or manual check
        let data;
        if (typeof normalizeFetchResponse === 'function') {
             // If we have the helper (from api-client.js or inline), use it? 
             // Actually api-client.js is not imported here.
             // But apiClient.fetch returns a Response object that might be normalized if it came from apiClient.
             // If it came from fetchWithAuth, it's raw.
        }
        
        // Just try to parse JSON
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
        const foxEl = document.getElementById('countFox');
        const amberEl = document.getElementById('countAmber');
        const weatherEl = document.getElementById('countWeather');
        
        if (dateEl) dateEl.textContent = formatted;
        if (foxEl) foxEl.textContent = today.foxess ?? 0;
        if (amberEl) amberEl.textContent = today.amber ?? 0;
        if (weatherEl) weatherEl.textContent = today.weather ?? 0;
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
        console.log('[Metrics] Auto-refresh already running');
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
        getFeedColour
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
        formatTimeAgo
    });
}
