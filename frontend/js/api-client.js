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

const IMPERSONATION_UID_KEY = 'adminImpersonationUid';
const IMPERSONATION_MODE_KEY = 'adminImpersonationMode';

function getImpersonationUid() {
  try {
    return localStorage.getItem(IMPERSONATION_UID_KEY) || '';
  } catch (e) {
    return '';
  }
}

function getImpersonationMode() {
  try {
    const mode = localStorage.getItem(IMPERSONATION_MODE_KEY) || '';
    if (mode === 'header') {
      localStorage.removeItem(IMPERSONATION_UID_KEY);
      localStorage.removeItem('adminImpersonationEmail');
      localStorage.removeItem(IMPERSONATION_MODE_KEY);
      localStorage.removeItem('adminImpersonationStartedAt');
      return '';
    }
    return mode;
  } catch (e) {
    return '';
  }
}

function shouldSkipImpersonationHeader(endpoint) {
  try {
    const path = endpoint.startsWith('http')
      ? new URL(endpoint, window.location.origin).pathname
      : new URL(endpoint, window.location.origin).pathname;
    return path.startsWith('/api/admin');
  } catch (e) {
    return false;
  }
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

    const impersonationUid = getImpersonationUid();
    const impersonationMode = getImpersonationMode();
    if (impersonationMode === 'header' && impersonationUid && !shouldSkipImpersonationHeader(endpoint)) {
      headers['X-Impersonate-Uid'] = impersonationUid;
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

    const impersonationUid = getImpersonationUid();
    const impersonationMode = getImpersonationMode();
    if (impersonationMode === 'header' && impersonationUid && !shouldSkipImpersonationHeader(endpoint)) {
      headers['X-Impersonate-Uid'] = impersonationUid;
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

  /**
   * DELETE request
   */
  async delete(endpoint, body = null) {
    const options = { method: 'DELETE' };
    if (body !== null && body !== undefined) {
      options.body = JSON.stringify(body);
    }
    return this.request(endpoint, options);
  }

  // ==================== CONFIG ====================

  async getConfig() {
    return this.get('/api/config');
  }

  async saveConfig(config) {
    // Auto-detect browser timezone using Intl API and include in config
    // This allows server to update timezone immediately if location changes
    const browserTimezone = this.getBrowserTimezone();
    const configWithTimezone = {
      ...config,
      browserTimezone: browserTimezone
    };
    return this.post('/api/config', { config: configWithTimezone });
  }

  /**
   * Detect user's browser timezone using Intl API
   * Returns IANA timezone identifier (e.g., 'America/New_York', 'Australia/Sydney')
   */
  getBrowserTimezone() {
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // console.log('[API] Detected browser timezone:', timezone);
      return timezone;
    } catch (e) {
      console.warn('[API] Failed to detect browser timezone:', e);
      return null;
    }
  }

  // ==================== AUTOMATION ====================

  async getAutomationStatus() {
    return this.get('/api/automation/status');
  }

  async getAutomationStatusSummary() {
    return this.get('/api/automation/status-summary');
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
    return this.post('/api/automation/test', { ruleName, testTime });
  }

  async updateRule(ruleName, ruleData) {
    return this.post('/api/automation/rule/update', { ruleName, ruleData });
  }

  async triggerAutomation() {
    return this.post('/api/automation/trigger', {});
  }

  async resetAutomation() {
    return this.post('/api/automation/reset', {});
  }

  async enableAutomation(enabled) {
    return this.post('/api/automation/enable', { enabled });
  }

  async runAutomationCycle() {
    return this.post('/api/automation/cycle', {});
  }

  async getAutomationAudit(limit = 100) {
    return this.get('/api/automation/audit', { limit });
  }

  // ==================== INVERTER ====================

  async getInverterList() {
    return this.get('/api/inverter/list');
  }

  async getInverterRealTime(sn) {
    return this.get('/api/inverter/real-time', { sn });
  }

  async getInverterDetail(sn) {
    return this.get('/api/inverter/real-time', { sn });
  }

  async getInverterTemps(sn) {
    return this.get('/api/inverter/temps', { sn });
  }

  async getInverterSettings(sn) {
    return this.get('/api/inverter/settings', { sn });
  }

  async getInverterHistory(sn, begin, end) {
    return this.get('/api/inverter/history', { sn, begin, end });
  }

  async getInverterGeneration(sn, begin, end) {
    return this.get('/api/inverter/generation', { sn, begin, end });
  }

  async getInverterReport(sn, begin, end) {
    return this.get('/api/inverter/report', { sn, begin, end });
  }

  async discoverInverterVariables(sn) {
    return this.get('/api/inverter/discover-variables', { sn });
  }

  async getInverterAllData(sn) {
    return this.post('/api/inverter/all-data', { sn });
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

  // ==================== PRICING ====================

  async getPricingSites(provider = 'amber') {
    return this.get('/api/pricing/sites', { provider });
  }

  async getPricingPrices(provider = 'amber', siteIdOrRegion = '', options = {}) {
    const normalizedProvider = String(provider || 'amber').trim().toLowerCase() || 'amber';
    const params = { provider: normalizedProvider, ...options };
    if (normalizedProvider === 'aemo') {
      params.regionId = siteIdOrRegion;
    } else {
      params.siteId = siteIdOrRegion;
    }
    return this.get('/api/pricing/prices', params);
  }

  async getPricingCurrentPrices(provider = 'amber', siteIdOrRegion = '', forceRefresh = false, options = {}) {
    const normalizedProvider = String(provider || 'amber').trim().toLowerCase() || 'amber';
    const params = { provider: normalizedProvider, forceRefresh, ...options };
    if (normalizedProvider === 'aemo') {
      params.regionId = siteIdOrRegion;
    } else {
      params.siteId = siteIdOrRegion;
    }
    return this.get('/api/pricing/current', params);
  }

  async getPricingHistoricalPrices(provider = 'amber', siteIdOrRegion, startDate, endDate, resolution = 30, actualOnly = false) {
    // startDate and endDate should be YYYY-MM-DD format
    // Backend handles per-user caching in Firestore
    // If actualOnly=true, bypasses cache and returns only materialized (past) prices
    const normalizedProvider = String(provider || 'amber').trim().toLowerCase() || 'amber';
    const params = {
      provider: normalizedProvider,
      startDate, 
      endDate, 
      resolution
    };

    if (normalizedProvider === 'aemo') {
      params.regionId = siteIdOrRegion;
    } else {
      params.siteId = siteIdOrRegion;
    }
    
    // Only add actual_only if true (don't send 'false' to keep query clean)
    if (actualOnly) {
      params.actual_only = 'true';
    }
    
    return this.get('/api/pricing/prices', params);
  }

  /**
   * Get actual (settled) Amber prices for a specific timestamp
   * Used to improve ROI accuracy by replacing forecast prices with settled prices
   * @param {string} siteId - Amber site ID
   * @param {string} timestamp - ISO 8601 timestamp (e.g., "2025-12-21T14:30:00Z")
   * @param {number} resolution - 5 or 30 (minute interval)
   * @returns {Promise} Response with actual price data or null if unavailable
   */
  async getPricingActualPrice(provider = 'amber', siteIdOrRegion, timestamp, resolution = 30) {
    const normalizedProvider = String(provider || 'amber').trim().toLowerCase() || 'amber';
    const params = { provider: normalizedProvider, timestamp, resolution };
    if (normalizedProvider === 'aemo') {
      params.regionId = siteIdOrRegion;
    } else {
      params.siteId = siteIdOrRegion;
    }
    return this.get('/api/pricing/actual', params);
  }

  async getAmberSites() {
    return this.getPricingSites('amber');
  }

  async getAmberPrices(siteId) {
    return this.getPricingPrices('amber', siteId);
  }

  async getAmberCurrentPrices(siteId, forceRefresh = false) {
    return this.getPricingCurrentPrices('amber', siteId, forceRefresh);
  }

  async getAmberHistoricalPrices(siteId, startDate, endDate, resolution = 30, actualOnly = false) {
    return this.getPricingHistoricalPrices('amber', siteId, startDate, endDate, resolution, actualOnly);
  }

  async getAmberActualPrice(siteId, timestamp, resolution = 30) {
    return this.getPricingActualPrice('amber', siteId, timestamp, resolution);
  }

  // ==================== QUICK CONTROL ====================

  async getQuickControlStatus() {
    return this.get('/api/quickcontrol/status');
  }

  async startQuickControl(type, power, durationMinutes) {
    return this.post('/api/quickcontrol/start', { type, power, durationMinutes });
  }

  async endQuickControl() {
    return this.post('/api/quickcontrol/end', {});
  }

  // ==================== DEVICE ====================

  async getBatterySoC(sn) {
    return this.get('/api/device/battery/soc/get', { sn });
  }

  async setBatterySoC(sn, minSocOnGrid, minSoc) {
    return this.post('/api/device/battery/soc/set', { sn, minSocOnGrid, minSoc });
  }

  async getForceChargeTime(sn) {
    return this.get('/api/device/battery/forceChargeTime/get', { sn });
  }

  async setForceChargeTime(sn, forceChargeEnable, startTime, endTime) {
    return this.post('/api/device/battery/forceChargeTime/set', {
      sn,
      forceChargeEnable,
      startTime,
      endTime
    });
  }

  async getDeviceSetting(sn, key) {
    return this.post('/api/device/setting/get', { sn, key });
  }

  async setDeviceSetting(sn, key, value) {
    return this.post('/api/device/setting/set', { sn, key, value });
  }

  async getDeviceWorkmode(sn) {
    return this.get('/api/device/workmode/get', { sn });
  }

  async setDeviceWorkmode(sn, workMode) {
    return this.post('/api/device/workmode/set', { sn, workMode });
  }

  // ==================== CONFIG AND PROFILE ====================

  async validateKeys(payload) {
    return this.post('/api/config/validate-keys', payload);
  }

  async getSetupStatus() {
    return this.get('/api/config/setup-status');
  }

  async clearCredentials() {
    return this.post('/api/config/clear-credentials', {});
  }

  async getSystemTopology() {
    return this.get('/api/config/system-topology');
  }

  async saveSystemTopology(payload) {
    return this.post('/api/config/system-topology', payload);
  }

  async initUserProfile() {
    return this.post('/api/user/init-profile', {});
  }

  async deleteUserAccount(confirmText, confirmEmail) {
    return this.post('/api/user/delete-account', { confirmText, confirmEmail });
  }

  async initAuthUser() {
    return this.post('/api/auth/init-user', {});
  }

  // ==================== ADMIN ====================

  async checkAdminAccess() {
    return this.get('/api/admin/check');
  }

  async getAdminUsers() {
    return this.get('/api/admin/users');
  }

  async getAdminPlatformStats(days = 90) {
    return this.get('/api/admin/platform-stats', { days });
  }

  async getAdminSchedulerMetrics(days = 14, includeRuns = true, runLimit = 20) {
    return this.get('/api/admin/scheduler-metrics', { days, includeRuns, runLimit });
  }

  async getAdminApiHealth(days = 30, refresh = false) {
    return this.get('/api/admin/api-health', refresh ? { days, refresh: 1 } : { days });
  }

  async getAdminDataworksOps(force = false) {
    return this.get('/api/admin/dataworks/ops', force ? { force: 1 } : {});
  }

  async triggerAdminDataworksDispatch() {
    return this.post('/api/admin/dataworks/dispatch', {});
  }

  async getAdminUserStats(uid) {
    return this.get(`/api/admin/users/${encodeURIComponent(uid)}/stats`);
  }

  async updateAdminUserRole(uid, role) {
    return this.post(`/api/admin/users/${encodeURIComponent(uid)}/role`, { role });
  }

  async deleteAdminUser(uid, confirmText = 'DELETE') {
    return this.post(`/api/admin/users/${encodeURIComponent(uid)}/delete`, { confirmText });
  }

  async impersonateUser(uid) {
    return this.post('/api/admin/impersonate', { uid });
  }

  async getAdminFirestoreMetrics(days = 30) {
    return this.get('/api/admin/firestore-metrics', { days });
  }

  // ==================== METRICS ====================

  async getApiCallMetrics(days = 30, scope = 'user') {
    return this.get('/api/metrics/api-calls', { days, scope });
  }

  // ==================== WEATHER ====================

  async getWeather(place, days = 3) {
    return this.get('/api/weather', { place, days });
  }

  // ==================== BACKTESTS ====================

  async createBacktestRun(payload) {
    return this.post('/api/backtests/runs', payload || {});
  }

  async listBacktestRuns(limit = 20) {
    return this.get('/api/backtests/runs', { limit });
  }

  async getBacktestRun(runId) {
    return this.get(`/api/backtests/runs/${encodeURIComponent(runId)}`);
  }

  async deleteBacktestRun(runId) {
    return this.delete(`/api/backtests/runs/${encodeURIComponent(runId)}`);
  }

  async listBacktestTariffPlans() {
    return this.get('/api/backtests/tariff-plans');
  }

  async createBacktestTariffPlan(payload) {
    return this.post('/api/backtests/tariff-plans', payload || {});
  }

  async updateBacktestTariffPlan(planId, payload) {
    return this.post(`/api/backtests/tariff-plans/${encodeURIComponent(planId)}`, payload || {});
  }

  async deleteBacktestTariffPlan(planId) {
    return this.delete(`/api/backtests/tariff-plans/${encodeURIComponent(planId)}`);
  }

  // ==================== OPTIMIZER ====================

  async createOptimizationRun(payload) {
    return this.post('/api/optimizations/runs', payload || {});
  }

  async listOptimizationRuns(limit = 20) {
    return this.get('/api/optimizations/runs', { limit });
  }

  async getOptimizationRun(runId) {
    return this.get(`/api/optimizations/runs/${encodeURIComponent(runId)}`);
  }

  async applyOptimizationVariant(runId, variantId, confirm = true) {
    return this.post(`/api/optimizations/runs/${encodeURIComponent(runId)}/apply`, {
      variantId,
      confirm
    });
  }

  // ==================== HEALTH ====================

  async healthCheck() {
    return this.get('/api/health');
  }

  // ==================== EV ====================

  async listEVVehicles() {
    return this.get('/api/ev/vehicles');
  }

  async registerEVVehicle(vehicleId, provider, displayName, region, options = {}) {
    return this.post('/api/ev/vehicles', {
      vehicleId,
      provider,
      displayName,
      region,
      ...(options || {})
    });
  }

  async deleteEVVehicle(vehicleId) {
    return this.delete(`/api/ev/vehicles/${encodeURIComponent(vehicleId)}`);
  }

  async getEVVehicleStatus(vehicleId, live = false) {
    return this.get(`/api/ev/vehicles/${encodeURIComponent(vehicleId)}/status`, { live: live ? '1' : undefined });
  }

  async getEVVehicleCommandReadiness(vehicleId) {
    return this.get(`/api/ev/vehicles/${encodeURIComponent(vehicleId)}/command-readiness`);
  }

  async getEVVehicleCommandReadinessBatch(vehicleIds = [], options = {}) {
    return this.post('/api/ev/vehicles/command-readiness', {
      vehicleIds: Array.isArray(vehicleIds) ? vehicleIds : [],
      ...(options && options.live ? { live: true } : {})
    });
  }

  async issueEVVehicleCommand(vehicleId, command, options = {}) {
    return this.post(`/api/ev/vehicles/${encodeURIComponent(vehicleId)}/command`, {
      command,
      ...(options || {})
    });
  }

  async wakeEVVehicle(vehicleId) {
    return this.post(`/api/ev/vehicles/${encodeURIComponent(vehicleId)}/wake`, {});
  }

  async getEVTeslaAppConfig() {
    return this.get('/api/ev/tesla-app-config');
  }

  async saveEVTeslaAppConfig(clientId, clientSecret, domain = '') {
    return this.post('/api/ev/tesla-app-config', {
      clientId,
      clientSecret,
      ...(domain ? { domain } : {})
    });
  }

  async getEVOAuthStartUrl(clientId, redirectUri, codeChallenge, region, state = '') {
    return this.get('/api/ev/oauth/start', { clientId, redirectUri, codeChallenge, region, state: state || undefined });
  }

  async checkEVPartnerDomainAccess(clientId, clientSecret, redirectUri, region, domain = '') {
    return this.post('/api/ev/partner/check-domain-access', {
      clientId,
      clientSecret,
      redirectUri,
      region,
      ...(domain ? { domain } : {})
    });
  }

  async registerEVPartnerDomain(clientId, clientSecret, redirectUri, region, domain = '') {
    return this.post('/api/ev/partner/register-domain', {
      clientId,
      clientSecret,
      redirectUri,
      region,
      ...(domain ? { domain } : {})
    });
  }

  async exchangeEVOAuthCode(vehicleId, clientId, clientSecret, redirectUri, code, codeVerifier, region, options = {}) {
    return this.post('/api/ev/oauth/callback', {
      vehicleId,
      clientId,
      clientSecret,
      redirectUri,
      code,
      codeVerifier,
      region,
      ...(options || {})
    });
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
    if (typeof window !== 'undefined' && window.__DISABLE_AUTH_REDIRECTS__ === true) {
      return;
    }
  } catch (e) {
    // ignore and continue with normal redirect flow
  }
  try {
    const key = 'lastRedirect';
    const normalize = (p) => {
      if (!p) return p;
      // Normalize root to app.html to avoid mismatch between '/' and '/app.html'
      if (p === '/' || p === '') return '/app.html';
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

// Expose to window for direct script access
if (typeof window !== 'undefined') {
  window.initAPIClient = initAPIClient;
  window.isAPIClientReady = isAPIClientReady;
  window.waitForAPIClient = waitForAPIClient;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { APIClient, initAPIClient, isAPIClientReady, waitForAPIClient };
}
