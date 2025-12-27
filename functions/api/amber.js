/**
 * Amber API Client Module
 * 
 * Handles all Amber Electric API interactions including:
 * - API calls with rate limiting
 * - Multi-layer caching (sites, current prices, historical prices)
 * - Gap detection and smart data fetching
 * - Per-user cache management
 * 
 * @module api/amber
 */

const admin = require('firebase-admin');
const fetch = require('node-fetch');

// Rate limiting state (shared across all requests)
const amberRateLimitState = {
  retryAfter: 0,
  lastError: null
};

// In-flight request tracker to prevent duplicate API calls
const amberPricesInFlight = new Map(); // key: "userId:siteId", value: Promise

/**
 * Initialize the module with dependencies from index.js.
 * Returns wrapper functions that have access to db, logger, config, incrementApiCount.
 * 
 * This allows the module to be imported and used with minimal changes to existing code.
 */
function init(dependencies) {
  const { db, logger, getConfig, incrementApiCount } = dependencies;
  
  /**
   * Make an API call to Amber Electric with rate limiting and error handling.
   * 
   * @param {string} path - API path (e.g., '/sites' or '/sites/{id}/prices')
   * @param {Object} queryParams - Query parameters object
   * @param {Object} userConfig - User configuration (for API key)
   * @param {string|null} userId - User ID for API counter tracking
   * @param {boolean} skipCounter - Skip incrementing API counter (for cache logic)
   * @returns {Promise<Object>} API response or error object
   */
  async function callAmberAPI(path, queryParams = {}, userConfig, userId = null, skipCounter = false) {
    const config = getConfig();
    const apiKey = userConfig?.amberApiKey || config.amber.apiKey;
    
    if (!apiKey) {
      return { errno: 401, error: 'Amber API key not configured' };
    }
    
    // Check if we're rate-limited
    if (amberRateLimitState.retryAfter > Date.now()) {
      return { 
        errno: 429, 
        error: `Rate limited by Amber API. Retry after ${new Date(amberRateLimitState.retryAfter).toISOString()}`, 
        retryAfter: amberRateLimitState.retryAfter 
      };
    }
    
    // Track API call if userId provided (unless caller is handling it)
    if (userId && !skipCounter && incrementApiCount) {
      incrementApiCount(userId, 'amber').catch(() => {});
    }
    
    const url = new URL(`${config.amber.baseUrl}${path}`);
    Object.keys(queryParams).forEach(k => {
      if (queryParams[k] !== undefined && queryParams[k] !== null) {
        url.searchParams.set(k, String(queryParams[k]));
      }
    });
    
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
   * Get Amber cache TTL for a user (respects per-user config, falls back to server default)
   * @param {Object} userConfig - User configuration object
   * @returns {number} Cache TTL in milliseconds
   */
  function getAmberCacheTTL(userConfig) {
    const config = getConfig();
    return (userConfig?.cache?.amber) || config.automation.cacheTtl.amber;
  }

  /**
   * Get cached Amber sites list from Firestore.
   * Per-user cache stored at users/{userId}/cache/amber_sites
   * TTL: 7 days
   * 
   * @param {string} userId - User ID
   * @returns {Promise<Array|null>} Cached sites array or null if not found/expired
   */
  async function getCachedAmberSites(userId) {
    try {
      if (!userId) return null;
      
      const cacheDoc = await db.collection('users').doc(userId).collection('cache').doc('amber_sites').get();
      if (!cacheDoc.exists) {
        return null;
      }
      
      const cached = cacheDoc.data();
      const cacheAge = Date.now() - (cached.cachedAt?.toMillis?.() || 0);
      const cacheTTL = 7 * 24 * 60 * 60 * 1000; // 7 days
      
      if (cacheAge > cacheTTL) {
        return null;
      }
      
      return cached.sites || [];
    } catch (e) {
      logger.error('Cache', `Error reading sites cache for ${userId}: ${e.message}`);
      return null;
    }
  }

  /**
   * Store Amber sites list in Firestore cache.
   * Per-user cache stored at users/{userId}/cache/amber_sites
   * 
   * @param {string} userId - User ID
   * @param {Array} sites - Sites array to cache
   * @returns {Promise<void>}
   */
  async function cacheAmberSites(userId, sites) {
    try {
      if (!userId || !sites) return;
      
      await db.collection('users').doc(userId).collection('cache').doc('amber_sites').set({
        sites,
        cachedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      logger.error('Cache', `Error storing sites cache for ${userId}: ${e.message}`);
    }
  }

  /**
   * Get cached current Amber prices from Firestore with in-flight request deduplication.
   * Per-user cache stored at users/{userId}/cache/amber_current_{siteId}
   * 
   * @param {string} siteId - Amber site ID
   * @param {string} userId - User ID
   * @param {Object} userConfig - User configuration (for TTL)
   * @returns {Promise<Array|null>} Cached prices array or null if not found/expired
   */
  async function getCachedAmberPricesCurrent(siteId, userId, userConfig) {
    try {
      if (!userId || !siteId) return null;
      
      const cacheDoc = db.collection('users').doc(userId).collection('cache').doc('amber_current_' + siteId);
      const snap = await cacheDoc.get();
      
      if (!snap.exists) {
        return null;
      }
      
      const cached = snap.data();
      const cacheAge = Date.now() - (cached.cachedAt?.toMillis?.() || 0);
      const cacheTTL = getAmberCacheTTL(userConfig);
      
      if (cacheAge > cacheTTL) {
        return null;
      }
      
      return cached.prices || null;
    } catch (error) {
      console.warn(`[Cache] Error reading current prices for user ${userId}, site ${siteId}:`, error.message);
      return null;
    }
  }

  /**
   * Store cached current Amber prices in Firestore.
   * Per-user cache stored at users/{userId}/cache/amber_current_{siteId}
   * 
   * @param {string} siteId - Amber site ID
   * @param {Array} prices - Prices array to cache
   * @param {string} userId - User ID
   * @param {Object} userConfig - User configuration (for TTL logging)
   * @returns {Promise<void>}
   */
  async function cacheAmberPricesCurrent(siteId, prices, userId, userConfig) {
    try {
      if (!userId || !siteId || !prices) return;
      
      const cacheDoc = db.collection('users').doc(userId).collection('cache').doc('amber_current_' + siteId);
      await cacheDoc.set({
        siteId,
        prices,
        cachedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) {
      console.warn(`[Cache] Error caching current prices for user ${userId}, site ${siteId}:`, error.message);
    }
  }

  /**
   * Get cached Amber price data from Firestore for a given date range.
   * Per-user cache stored at users/{userId}/cache/amber_{siteId}
   * Returns prices that fall within [startDate, endDate] inclusive.
   * 
   * @param {string} siteId - Amber site ID
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Array of cached prices in the date range
   */
  async function getCachedAmberPrices(siteId, startDate, endDate, userId) {
    try {
      if (!userId) {
        return [];
      }
      
      const cacheRef = db.collection('users').doc(userId).collection('cache').doc('amber_' + siteId);
      const snap = await cacheRef.get();
      
      if (!snap.exists) {
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
      
      return filtered;
    } catch (error) {
      console.warn(`[Cache] Error reading prices for user ${userId}, site ${siteId}:`, error.message);
      return [];
    }
  }

  /**
   * Find gaps in coverage between startDate and endDate.
   * Returns array of { start, end } objects for gaps that need API calls.
   * 
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @param {Array} existingPrices - Array of existing price objects with startTime
   * @returns {Array<{start: string, end: string}>} Array of gaps
   */
  function findGaps(startDate, endDate, existingPrices) {
    const gaps = [];
    const startMs = new Date(startDate + 'T00:00:00Z').getTime();
    const endMs = new Date(endDate + 'T23:59:59Z').getTime();
    
    if (existingPrices.length === 0) {
      gaps.push({ start: startDate, end: endDate });
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
    
    // Check if we need data before the first cached date
    if (startDate < firstCachedDate) {
      const gapEnd = new Date(new Date(firstCachedDate).getTime() - 86400000).toISOString().split('T')[0];
      gaps.push({ start: startDate, end: gapEnd });
    }
    
    // Check if we need data after the last cached date
    if (endDate > lastCachedDate) {
      const gapStart = new Date(new Date(lastCachedDate).getTime() + 86400000).toISOString().split('T')[0];
      gaps.push({ start: gapStart, end: endDate });
    }
    
    return gaps;
  }

  /**
   * Cache Amber prices in Firestore for persistent storage.
   * Per-user cache stored at users/{userId}/cache/amber_{siteId}
   * Merges new prices with existing cached prices.
   * 
   * @param {string} siteId - Amber site ID
   * @param {Array} newPrices - New prices to add to cache
   * @param {string} userId - User ID
   * @returns {Promise<void>}
   */
  async function cacheAmberPrices(siteId, newPrices, userId) {
    try {
      if (!userId) {
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
   * 
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @param {number} maxDaysPerChunk - Maximum days per chunk (default: 14)
   * @returns {Array<{start: string, end: string}>} Array of date range chunks
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
   * Fetch Amber historical prices WITHOUT cache, filter to actual (past) only.
   * Used by Reports page to ensure we show materialized prices, not stale forecasts.
   * 
   * @param {string} siteId - Amber site ID
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @param {number} resolution - Resolution in minutes (default: 30)
   * @param {Object} userConfig - User configuration
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Response with actual prices only
   */
  async function fetchAmberHistoricalPricesActualOnly(siteId, startDate, endDate, resolution, userConfig, userId) {
    // Increment API counter once per request (bypassing cache means we're hitting the API)
    if (userId && incrementApiCount) {
      incrementApiCount(userId, 'amber').catch(() => {});
    }
    
    const now = new Date();
    let allPrices = [];
    
    // Split range into 30-day chunks and fetch each from API (skip cache entirely)
    const chunks = splitRangeIntoChunks(startDate, endDate, 30);
    
    for (const chunk of chunks) {
      
      // Call Amber API directly (skip counter since we'll track at endpoint level)
      const result = await callAmberAPI(
        `/sites/${encodeURIComponent(siteId)}/prices`, 
        {
          startDate: chunk.start,
          endDate: chunk.end,
          resolution: resolution || 30
        }, 
        userConfig, 
        userId, 
        true // skipCounter = true
      );
      
      // Handle error responses
      if (result && result.errno && result.errno !== 0) {
        continue;
      }
      
      // Extract prices from result
      let prices = [];
      if (Array.isArray(result)) {
        prices = result;
      } else if (result && Array.isArray(result.result)) {
        prices = result.result;
      } else if (result && result.data && Array.isArray(result.data)) {
        prices = result.data;
      }
      
      allPrices = allPrices.concat(prices);
    }
    
    // Filter to keep ONLY prices where startTime <= now (actual, not forecast)
    const actualPrices = allPrices.filter(p => {
      const priceTime = new Date(p.startTime);
      return priceTime <= now;
    });
    
    // Sort by startTime
    actualPrices.sort((a, b) => 
      new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
    
    return {
      errno: 0,
      result: actualPrices,
      _info: {
        total: actualPrices.length,
        source: 'fresh_api_no_cache',
        filtered: `${allPrices.length - actualPrices.length} future prices excluded`
      }
    };
  }

  /**
   * Fetch Amber historical prices with intelligent caching.
   * - Checks Firestore for existing per-user data
   * - Only fetches gaps from API
   * - Merges cached + new data
   * - Returns complete dataset for the requested range
   * 
   * @param {string} siteId - Amber site ID
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @param {number} resolution - Resolution in minutes (default: 30)
   * @param {Object} userConfig - User configuration
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Response with cached + fresh prices
   */
  async function fetchAmberHistoricalPricesWithCache(siteId, startDate, endDate, resolution, userConfig, userId) {
    // Step 1: Get cached prices (per-user cache)
    const cachedPrices = await getCachedAmberPrices(siteId, startDate, endDate, userId);
    logger.debug('AmberCache', `Found ${cachedPrices.length} cached prices in range`);
    
    // Step 2: Check if we have BOTH channels for the full range
    const channelCounts = {};
    cachedPrices.forEach(p => {
      channelCounts[p.channelType] = (channelCounts[p.channelType] || 0) + 1;
    });
    const hasGeneral = channelCounts['general'] || 0;
    const hasFeedin = channelCounts['feedIn'] || 0;
    
    // If either channel is completely missing, treat entire range as gap to force fresh fetch
    let gaps = [];
    if (!hasGeneral || !hasFeedin) {
      gaps = [{ start: startDate, end: endDate }];
    } else {
      // Both channels present, use normal gap detection
      gaps = findGaps(startDate, endDate, cachedPrices);
    }
    
    let newPrices = [];
    
    // Step 3: Fetch gaps from API (split into 30-day chunks)
    if (gaps.length > 0) {
      // Increment API counter once per cache miss (not per chunk)
      if (userId && incrementApiCount) {
        incrementApiCount(userId, 'amber').catch(() => {});
      }
      
      for (const gap of gaps) {
        const chunks = splitRangeIntoChunks(gap.start, gap.end, 30);
        
        for (const chunk of chunks) {
          
          // Call Amber API directly (skip counter since we track at cache level)
          const result = await callAmberAPI(
            `/sites/${encodeURIComponent(siteId)}/prices`, 
            {
              startDate: chunk.start,
              endDate: chunk.end,
              resolution: resolution || 30
            }, 
            userConfig, 
            userId, 
            true // skipCounter = true
          );
          
          // Handle error responses
          if (result && result.errno && result.errno !== 0) {
            continue;
          }
          
          // Extract prices from result
          let prices = [];
          if (Array.isArray(result)) {
            prices = result;
          } else if (result && Array.isArray(result.result)) {
            prices = result.result;
          } else if (result && result.data && Array.isArray(result.data)) {
            prices = result.data;
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

  return {
    callAmberAPI,
    getAmberCacheTTL,
    getCachedAmberSites,
    cacheAmberSites,
    getCachedAmberPricesCurrent,
    cacheAmberPricesCurrent,
    getCachedAmberPrices,
    findGaps,
    cacheAmberPrices,
    splitRangeIntoChunks,
    fetchAmberHistoricalPricesActualOnly,
    fetchAmberHistoricalPricesWithCache,
    amberRateLimitState,
    amberPricesInFlight
  };
}

// Export init function and state for backwards compatibility
module.exports = { init, amberRateLimitState, amberPricesInFlight };
