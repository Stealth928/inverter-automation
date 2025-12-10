/**
 * API Client for Inverter App
 * 
 * Handles all API calls with Firebase authentication
 */

/**
 * Helper to safely parse fetch responses that might be HTML error pages (404/500)
 * instead of the expected JSON.
 */
async function normalizeFetchResponse(response) {
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch (e) {
      console.warn('[API] JSON parse failed, falling back to text:', e);
    }
  }
  
  // If we get here, it's not JSON or parsing failed.
  // It might be an HTML error page from Firebase Hosting or Express.
  const text = await response.text();
  
  // If status is OK but we got text/html, that's unexpected for an API
  if (response.ok) {
    console.warn('[API] Received non-JSON response 200 OK:', text.substring(0, 100));
    // Return a safe empty object or error structure
    return { errno: -1, error: 'Invalid API response format', raw: text.substring(0, 500) };
  }

  // For error status codes, return a structured error
  return { 
    errno: response.status, 
    error: `Request failed: ${response.status} ${response.statusText}`,
    details: text.substring(0, 200) // truncated body
  };
}

class APIClient {
  constructor(firebaseAuth) {
    this.auth = firebaseAuth;
    this.baseUrl = ''; // Same-origin by default; can be overridden via setBaseUrl for local dev
  }

  /**
   * Set base URL for API calls (useful for local development)
   */
  setBaseUrl(url) {
    this.baseUrl = url;
  }

  /**
   * Make authenticated API request
   */
  async request(endpoint, options = {}) {
    // Get token if user is signed in
    let token = null;
    
    // Try to get token from the API client's auth object first
    if (this.auth && typeof this.auth.getIdToken === 'function') {
      try {
        token = await this.auth.getIdToken();
      } catch (e) {
        console.warn('[API] request() - Failed to get token from auth object:', e);
      }
    }
    
    // If that failed, try to get it directly from Firebase auth (backup method)
    if (!token && typeof firebase !== 'undefined' && firebase.auth) {
      try {
        const currentUser = firebase.auth().currentUser;
        if (currentUser) {
          token = await currentUser.getIdToken();
        }
      } catch (e) {
        console.warn('[API] request() - Failed to get token from Firebase:', e);
      }
    }
    
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    
    // Add auth header if signed in
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const url = `${this.baseUrl}${endpoint}`;
    
    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      // Handle 401 - return structured error without redirecting
      if (response.status === 401) {
        console.warn('[API] Unauthorized response (401) — returning error to caller');
        return { errno: 401, error: 'Unauthorized' };
      }

      return await normalizeFetchResponse(response);
    } catch (error) {
      console.error('[API] Request failed:', error);
      return { errno: 500, error: error.message };
    }
  }

  /**
   * Raw authenticated fetch that returns a Response object.
   * Useful for legacy code expecting a fetch-like API.
   */
  async fetch(endpoint, options = {}) {
    let token = null;
    
    // Try to get token from the API client's auth object first
    if (this.auth && typeof this.auth.getIdToken === 'function') {
      try {
        token = await this.auth.getIdToken();
      } catch (e) {
        console.warn('[API] Failed to get token from auth object:', e.message || e);
      }
    }
    
    // If that failed, try to get it directly from Firebase auth (backup method)
    if (!token && typeof firebase !== 'undefined' && firebase.auth) {
      try {
        const currentUser = firebase.auth().currentUser;
        if (currentUser) {
          token = await currentUser.getIdToken();
        }
      } catch (e) {
        console.warn('[API] Failed to get token from Firebase:', e.message || e);
      }
    }
    
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
    
    try {
      const response = await fetch(url, { ...options, headers });
      
      // Handle 401: return a standard response so callers can decide what to do
      if (response.status === 401) {
        // Return a safe 401 response with JSON body and leave navigation decision to caller
        return new Response(JSON.stringify({ errno: 401, error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }

      // Normalize
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return response;
      }
      
      // If not JSON, wrap it
      const text = await response.text();
      return new Response(JSON.stringify({ 
        errno: response.ok ? 0 : response.status, 
        error: response.ok ? null : `Request failed: ${response.status}`,
        result: null, // or try to parse text if it's actually JSON
        raw: text.substring(0, 1000)
      }), { 
        status: response.status, 
        headers: { 'Content-Type': 'application/json' } 
      });

    } catch (error) {
      return new Response(JSON.stringify({ errno: 500, error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }

  /**
   * GET request
   */
  async get(endpoint, params = {}) {
    const url = new URL(endpoint, window.location.origin);
    Object.keys(params).forEach(key => {
      if (params[key] !== undefined && params[key] !== null) {
        url.searchParams.append(key, params[key]);
      }
    });
    return this.request(url.pathname + url.search, { method: 'GET' });
  }

  /**
   * POST request
   */
  async post(endpoint, body = {}) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  // ==================== CONFIG ====================

  async getConfig() {
    return this.get('/api/config');
  }

  async saveConfig(config) {
    return this.post('/api/config', { config });
  }

  // ==================== AUTOMATION ====================

  async getAutomationStatus() {
    return this.get('/api/automation/status');
  }

  async toggleAutomation(enabled) {
    return this.post('/api/automation/toggle', { enabled });
  }

  async createRule(rule) {
    return this.post('/api/automation/rule/create', rule);
  }

  async deleteRule(ruleName) {
    return this.post('/api/automation/rule/delete', { ruleName });
  }

  async getAutomationHistory(limit = 50) {
    return this.get('/api/automation/history', { limit });
  }

  async testRule(ruleName, testTime = null) {
    return this.post('/api/automation/rule/test', { ruleName, testTime });
  }

  // ==================== INVERTER ====================

  async getInverterList() {
    return this.get('/api/inverter/list');
  }

  async getInverterRealTime(sn) {
    return this.get('/api/inverter/real-time', { sn });
  }

  async getInverterDetail(sn) {
    return this.get('/api/inverter/detail', { sn });
  }

  async getInverterTemps(sn) {
    return this.get('/api/inverter/temps', { sn });
  }

  // ==================== SCHEDULER ====================

  async getScheduler(sn) {
    return this.get('/api/scheduler/v1/get', { sn });
  }

  async setScheduler(sn, groups) {
    return this.post('/api/scheduler/v1/set', { sn, groups });
  }

  async clearAllScheduler(sn) {
    return this.post('/api/scheduler/v1/clear-all', { sn });
  }

  // ==================== AMBER ====================

  async getAmberSites() {
    return this.get('/api/amber/sites');
  }

  async getAmberPrices(siteId) {
    return this.get('/api/amber/prices', { siteId });
  }

  async getAmberHistoricalPrices(siteId, startDate, endDate, resolution = 30) {
    // startDate and endDate should be YYYY-MM-DD format
    return this.get('/api/amber/prices', { 
      siteId, 
      startDate, 
      endDate, 
      resolution 
    });
  }

  // ==================== WEATHER ====================

  async getWeather(place, days = 3) {
    return this.get('/api/weather', { place, days });
  }

  // ==================== HEALTH ====================

  async healthCheck() {
    return this.get('/api/health');
  }
}

// Export singleton instance (will be initialized after Firebase Auth)
let apiClient = null;

function initAPIClient(firebaseAuth) {
  apiClient = new APIClient(firebaseAuth);
  return apiClient;
}

/**
 * Helper: return whether the global apiClient has been initialized
 */
function isAPIClientReady() {
  return apiClient !== null;
}

/**
 * Wait for apiClient to be initialized (polling). Rejects after timeoutMs.
 */
async function waitForAPIClient(timeoutMs = 3000) {
  const start = Date.now();
  while (apiClient === null) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('API client not ready');
    }
    await new Promise((res) => setTimeout(res, 50));
  }
  return apiClient;
}

/**
 * Safe redirect helper to reduce bounce loops between pages.
 * It stores last redirect info in sessionStorage and prevents immediate reverse redirects
 */
function safeRedirect(target, maxBounceMs = 5000) {
  try {
    const key = 'lastRedirect';
    const normalize = (p) => {
      if (!p) return p;
      // Normalize root to index.html to avoid mismatch between '/' and '/index.html'
      if (p === '/' || p === '') return '/index.html';
      return p.replace(/\/$/, ''); // remove trailing slash
    };
    const raw = sessionStorage.getItem(key);
    if (raw) {
      try {
        const last = JSON.parse(raw);
        if (last && (Date.now() - last.ts) < maxBounceMs) {
          // Normalize comparators
          const lastFrom = normalize(last.from);
          const lastTo = normalize(last.to);
          const curPath = normalize(window.location.pathname);
          const tgt = normalize(target);
          // If the last redirect went from `target` to this page, avoid bouncing back
          if (lastFrom === tgt && lastTo === curPath) {
            console.warn('[Redirect] Suppressing bounce redirect to', target);
            return;
          }
        }
      } catch (e) { /* ignore malformed */ }
    }
    sessionStorage.setItem(key, JSON.stringify({ from: window.location.pathname, to: target, ts: Date.now() }));
    window.location.href = target;
  } catch (e) {
    // On any failure, fallback to normal redirect to avoid blocking navigation
    window.location.href = target;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { APIClient, initAPIClient, isAPIClientReady, waitForAPIClient };
}
