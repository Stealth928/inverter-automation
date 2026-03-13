'use strict';

const DEFAULT_PRICING_PROVIDER = 'amber';

function normalizeProvider(value) {
  const normalized = String(value || DEFAULT_PRICING_PROVIDER).trim().toLowerCase();
  return normalized || DEFAULT_PRICING_PROVIDER;
}

function getRequestedProvider(req) {
  return normalizeProvider(req?.query?.provider);
}

function rejectUnsupportedProvider(req, res) {
  const provider = getRequestedProvider(req);
  if (provider !== DEFAULT_PRICING_PROVIDER) {
    res.status(400).json({
      errno: 400,
      error: `Unsupported pricing provider: ${provider}`,
      result: []
    });
    return true;
  }
  return false;
}

function registerGetAliases(app, routes, ...handlers) {
  routes.forEach((route) => app.get(route, ...handlers));
}

function registerPricingRoutes(app, deps = {}) {
  const amberAPI = deps.amberAPI;
  const amberPricesInFlight = deps.amberPricesInFlight;
  const authenticateUser = deps.authenticateUser;
  const getUserConfig = deps.getUserConfig;
  const incrementApiCount = deps.incrementApiCount;
  const logger = deps.logger || console;
  const tryAttachUser = deps.tryAttachUser;

  if (!app || typeof app.get !== 'function') {
    throw new Error('registerPricingRoutes requires an Express app');
  }
  if (!amberAPI || typeof amberAPI.callAmberAPI !== 'function') {
    throw new Error('registerPricingRoutes requires amberAPI');
  }
  if (!amberPricesInFlight || typeof amberPricesInFlight.has !== 'function') {
    throw new Error('registerPricingRoutes requires amberPricesInFlight Map');
  }
  if (typeof authenticateUser !== 'function') {
    throw new Error('registerPricingRoutes requires authenticateUser middleware');
  }
  if (typeof getUserConfig !== 'function') {
    throw new Error('registerPricingRoutes requires getUserConfig()');
  }
  if (typeof tryAttachUser !== 'function') {
    throw new Error('registerPricingRoutes requires tryAttachUser()');
  }

  // Sites endpoint (allow unauthenticated calls - return empty list when no user)
  const sitesHandler = async (req, res) => {
    if (rejectUnsupportedProvider(req, res)) return;

    try {
      // Attach optional user if provided, but don't require auth
      await tryAttachUser(req);
      const userId = req.user?.uid;
      const debug = req.query.debug === 'true';

      if (!userId) {
        // No user signed in - safe empty response for UI
        const response = { errno: 0, result: [] };
        if (debug) response._debug = 'Not authenticated';
        return res.json(response);
      }

      const userConfig = await getUserConfig(userId);
      const hasKey = userConfig?.amberApiKey;

      if (!userConfig || !hasKey) {
        const response = { errno: 0, result: [] };
        if (debug) {
          response._debug = `Config issue: userConfig=${!!userConfig}, hasAmberKey=${hasKey}`;
        }
        return res.json(response);
      }

      // Try cache first
      const cachedSites = await amberAPI.getCachedAmberSites(userId);
      if (cachedSites) {
        return res.json({ errno: 0, result: cachedSites, _cached: true });
      }

      // Cache miss - call API
      if (typeof incrementApiCount === 'function') {
        incrementApiCount(userId, 'amber').catch((err) => console.warn('[Amber] Failed to log API call:', err.message));
      }
      const result = await amberAPI.callAmberAPI('/sites', {}, userConfig, userId, true);

      let sites = [];
      if (result && result.data && Array.isArray(result.data)) sites = result.data;
      else if (result && result.sites && Array.isArray(result.sites)) sites = result.sites;
      else if (Array.isArray(result)) sites = result;

      // Store in cache for future requests
      if (sites.length > 0) {
        await amberAPI.cacheAmberSites(userId, sites);
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
  };

  // Public-friendly endpoint for current prices. Returns safe JSON when unauthenticated.
  const currentPricesHandler = async (req, res) => {
    if (rejectUnsupportedProvider(req, res)) return;

    try {
      await tryAttachUser(req);
      const userId = req.user?.uid;
      if (!userId) return res.json({ errno: 0, result: [] });

      const userConfig = await getUserConfig(userId);
      if (!userConfig || !userConfig.amberApiKey) {
        return res.json({ errno: 0, result: [] });
      }

      let siteId = req.query.siteId || userConfig.amberSiteId;
      const next = Number(req.query.next || '1') || 1;
      const forceRefresh = req.query.forceRefresh === 'true' || req.query.force === 'true';

      if (!siteId) {
        // Try to fetch sites and use the first one if not configured
        const sites = await amberAPI.callAmberAPI('/sites', {}, userConfig, userId);
        if (Array.isArray(sites) && sites.length > 0) {
          siteId = sites[0].id;
        }
      }

      if (!siteId) return res.status(400).json({ errno: 400, error: 'Site ID is required', result: [] });

      // Try cache first for current prices (unless force refresh requested)
      let result = null;
      if (!forceRefresh) {
        result = await amberAPI.getCachedAmberPricesCurrent(siteId, userId, userConfig);
      }

      if (!result) {
        const inflightKey = `${userId}:${siteId}`;

        // Check if another request is already fetching this data
        if (amberPricesInFlight.has(inflightKey)) {
          try {
            result = await amberPricesInFlight.get(inflightKey);
          } catch (err) {
            logger.warn('Amber', `In-flight request failed for ${userId}: ${err.message}`);
          }
        }

        // If still no data (first request or in-flight failed), fetch it
        if (!result) {
          const fetchPromise = amberAPI.callAmberAPI(`/sites/${encodeURIComponent(siteId)}/prices/current`, { next }, userConfig, userId)
            .then(async (data) => {
              if (Array.isArray(data) && data.length > 0) {
                await amberAPI.cacheAmberPricesCurrent(siteId, data, userId, userConfig);
              }
              return data;
            })
            .finally(() => {
              amberPricesInFlight.delete(inflightKey);
            });

          amberPricesInFlight.set(inflightKey, fetchPromise);
          result = await fetchPromise;
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
      // Fallback: wrap whatever we got (ensure array)
      return res.json({ errno: 0, result: result || [] });
    } catch (e) {
      console.error('[Amber] /prices/current error (pre-auth):', e && e.message ? e.message : e);
      return res.json({ errno: 0, result: [] });
    }
  };

  // Prices endpoint - allow unauthenticated access (returns empty if no user)
  const pricesHandler = async (req, res) => {
    if (rejectUnsupportedProvider(req, res)) return;

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
      let siteId = req.query.siteId || userConfig.amberSiteId;

      if (!siteId) {
        // Try to fetch sites and use the first one if not configured
        const sites = await amberAPI.callAmberAPI('/sites', {}, userConfig, userId);
        if (Array.isArray(sites) && sites.length > 0) {
          siteId = sites[0].id;
        }
      }

      if (!siteId) {
        return res.status(400).json({ errno: 400, error: 'Site ID is required' });
      }

      // Check if caller wants only actual (non-forecast) prices
      const actualOnly = req.query.actual_only === 'true';

      // If the caller provided startDate/endDate, treat this as a historical range
      // request and use intelligent caching to avoid repeated API calls.
      const startDate = req.query.startDate;
      const endDate = req.query.endDate;
      if (startDate || endDate) {
        const resolution = req.query.resolution || 30;

        // If actualOnly is set, check if this is a recent date range
        // For dates older than 3 days, use cache since they're definitely materialized
        // For recent dates (today, yesterday, day before), fetch fresh to avoid forecast
        if (actualOnly) {
          const endDateObj = new Date(endDate);
          const now = new Date();
          const daysSinceEnd = Math.floor((now - endDateObj) / (1000 * 60 * 60 * 24));

          if (daysSinceEnd > 3) {
            // Old data - safe to use cache (it's all materialized)
            const result = await amberAPI.fetchAmberHistoricalPricesWithCache(siteId, startDate, endDate, resolution, userConfig, userId);
            return res.json(result);
          }
          // Recent data - fetch fresh to avoid forecast pollution
          const result = await amberAPI.fetchAmberHistoricalPricesActualOnly(siteId, startDate, endDate, resolution, userConfig, userId);
          return res.json(result);
        }

        // Default: use cache
        const result = await amberAPI.fetchAmberHistoricalPricesWithCache(siteId, startDate, endDate, resolution, userConfig, userId);
        return res.json(result);
      }

      // Default behavior: return the current forecast/prices
      const result = await amberAPI.callAmberAPI(`/sites/${encodeURIComponent(siteId)}/prices/current`, { next: 1 }, userConfig, userId);
      return res.json(result);
    } catch (error) {
      console.warn('[Amber] Error fetching prices:', error.message);
      return res.status(500).json({ errno: 500, error: error.message });
    }
  };

  /**
   * Get actual (settled) Amber prices for a specific timestamp
   * Used by ROI calculator to get accurate prices for completed rules
   * Only works for timestamps within last 7 days (Amber API limitation)
   */
  const actualPricesHandler = async (req, res) => {
    if (rejectUnsupportedProvider(req, res)) return;

    try {
      const userId = req.user.uid;
      const userConfig = await getUserConfig(userId);

      if (!userConfig || !userConfig.amberApiKey) {
        return res.status(400).json({ errno: 400, error: 'Amber not configured' });
      }

      let siteId = req.query.siteId || userConfig.amberSiteId;
      const timestamp = req.query.timestamp; // ISO 8601 timestamp

      if (!siteId) {
        // Try to fetch sites and use the first one if not configured
        const sites = await amberAPI.callAmberAPI('/sites', {}, userConfig, userId);
        if (Array.isArray(sites) && sites.length > 0) {
          siteId = sites[0].id;
        }
      }

      if (!siteId) {
        return res.status(400).json({ errno: 400, error: 'Site ID is required' });
      }

      if (!timestamp) {
        return res.status(400).json({ errno: 400, error: 'Timestamp is required' });
      }

      // Parse timestamp and check if within 7-day window
      const targetTime = new Date(timestamp);
      const now = new Date();
      const ageMs = now.getTime() - targetTime.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);

      if (isNaN(targetTime.getTime())) {
        return res.status(400).json({ errno: 400, error: 'Invalid timestamp format' });
      }

      if (ageDays > 7) {
        logger.debug('Amber Actual', `Timestamp ${timestamp} is ${ageDays.toFixed(2)} days old (>7 days) - outside Amber data retention`);
        return res.json({ errno: 0, result: null, reason: 'outside_retention_window', ageDays: ageDays.toFixed(2) });
      }

      if (ageMs < 5 * 60 * 1000) {
        logger.debug('Amber Actual', `Timestamp ${timestamp} is only ${(ageMs / 60000).toFixed(1)} minutes old - price may not be settled yet`);
        return res.json({ errno: 0, result: null, reason: 'too_recent', ageMinutes: (ageMs / 60000).toFixed(1) });
      }

      // Calculate date for the timestamp (Amber uses date-based queries)
      const targetDate = targetTime.toISOString().split('T')[0]; // YYYY-MM-DD

      logger.debug('Amber Actual', `Fetching actual prices for ${targetDate} (timestamp: ${timestamp}, age: ${ageDays.toFixed(2)} days)`);

      // Fetch prices for that date (we'll filter to the specific interval)
      // Use the same resolution as the user's billing interval (5 or 30 minutes)
      const resolution = req.query.resolution || 30;

      try {
        const result = await amberAPI.callAmberAPI(
          `/sites/${encodeURIComponent(siteId)}/prices`,
          { startDate: targetDate, endDate: targetDate, resolution },
          userConfig,
          userId
        );

        if (!result || (result.errno && result.errno !== 0)) {
          console.warn(`[Amber Actual] API error: ${result?.error || 'unknown'}`);
          return res.json({ errno: result?.errno || 500, error: result?.error || 'API call failed', result: null });
        }

        // Extract prices array
        let prices = [];
        if (Array.isArray(result)) {
          prices = result;
        } else if (result.result && Array.isArray(result.result)) {
          prices = result.result;
        }

        if (prices.length === 0) {
          logger.debug('Amber Actual', `No prices returned for ${targetDate}`);
          return res.json({ errno: 0, result: null, reason: 'no_data' });
        }

        // Filter to find the interval containing our timestamp
        // Amber prices have startTime and endTime fields
        const matchingInterval = prices.find((price) => {
          const intervalStart = new Date(price.startTime);
          const intervalEnd = new Date(price.endTime);
          return targetTime >= intervalStart && targetTime <= intervalEnd;
        });

        if (!matchingInterval) {
          logger.debug('Amber Actual', `No matching interval found for ${timestamp} in ${prices.length} price intervals`);
          return res.json({ errno: 0, result: null, reason: 'no_matching_interval' });
        }

        // Return the actual price data
        logger.debug('Amber Actual', `Found matching interval: type=${matchingInterval.type}, channel=${matchingInterval.channelType}, price=${matchingInterval.perKwh}c/kWh`);

        return res.json({
          errno: 0,
          result: matchingInterval
        });
      } catch (error) {
        console.warn('[Amber Actual] Error fetching actual prices:', error.message);
        return res.status(500).json({ errno: 500, error: error.message });
      }
    } catch (error) {
      console.warn('[Amber Actual] Error in route handler:', error.message);
      return res.status(500).json({ errno: 500, error: error.message });
    }
  };

  registerGetAliases(app, ['/api/pricing/sites', '/api/amber/sites'], sitesHandler);
  registerGetAliases(app, ['/api/pricing/current', '/api/amber/prices/current'], currentPricesHandler);
  registerGetAliases(app, ['/api/pricing/prices', '/api/amber/prices'], pricesHandler);
  registerGetAliases(app, ['/api/pricing/actual', '/api/amber/prices/actual'], authenticateUser, actualPricesHandler);
}

module.exports = {
  registerPricingRoutes
};
