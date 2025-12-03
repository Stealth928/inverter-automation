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
    this.baseUrl = ''; // Empty for same-origin, or set to Cloud Functions URL
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
    if (this.auth && typeof this.auth.getIdToken === 'function') {
      try {
        token = await this.auth.getIdToken();
      } catch (e) {
        console.warn('[API] Failed to get ID token:', e);
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

      // Handle 401 - redirect to login
      if (response.status === 401) {
        console.warn('[API] Unauthorized - redirecting to login');
        // Check if we are already on login page to avoid loop
        if (!window.location.pathname.includes('login.html')) {
             window.location.href = '/login.html';
        }
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
    if (this.auth && typeof this.auth.getIdToken === 'function') {
      try {
        token = await this.auth.getIdToken();
      } catch (e) {
        console.warn('[API] Failed to get ID token:', e);
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
      
      // Handle 401
      if (response.status === 401) {
         if (!window.location.pathname.includes('login.html')) {
             window.location.href = '/login.html';
         }
         // Return a safe 401 response
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { APIClient, initAPIClient };
}
