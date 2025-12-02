/**
 * API Client for Inverter App
 * 
 * Handles all API calls with Firebase authentication
 */

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
    const token = await this.auth.getIdToken();
    
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
        window.location.href = '/login.html';
        return { errno: 401, error: 'Unauthorized' };
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('[API] Request failed:', error);
      return { errno: 500, error: error.message };
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
