'use strict';

function registerMetricsRoutes(app, deps = {}) {
  const db = deps.db;
  const getAusDateKey = deps.getAusDateKey;
  const isAdmin = deps.isAdmin;
  const logger = deps.logger || console;
  const tryAttachUser = deps.tryAttachUser;
  const KNOWN_INVERTER_PROVIDER_KEYS = ['foxess', 'sungrow', 'sigenergy', 'alphaess'];

  if (!app || typeof app.get !== 'function') {
    throw new Error('registerMetricsRoutes requires an Express app');
  }
  if (typeof getAusDateKey !== 'function') {
    throw new Error('registerMetricsRoutes requires getAusDateKey()');
  }
  if (typeof tryAttachUser !== 'function') {
    throw new Error('registerMetricsRoutes requires tryAttachUser()');
  }

  const toCounter = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n);
  };

  const getTeslaFleetRoot = (metricsDoc = {}) => {
    if (!metricsDoc || typeof metricsDoc !== 'object') return null;
    return metricsDoc.teslaFleet || metricsDoc.teslafleet || null;
  };

  const normalizeMetricKey = (metricKey) => String(metricKey || '').toLowerCase().trim();
  const readNestedCounter = (root, path = []) => {
    if (!root || typeof root !== 'object' || !Array.isArray(path) || path.length === 0) return 0;
    let cursor = root;
    for (const segment of path) {
      if (!cursor || typeof cursor !== 'object') return 0;
      cursor = cursor[segment];
    }
    return toCounter(cursor);
  };

  const resolveEvCounter = (metricsDoc = {}) => {
    const explicitEv = toCounter(metricsDoc.ev);
    if (explicitEv) return explicitEv;

    const explicitTesla = toCounter(metricsDoc.tesla);
    if (explicitTesla) return explicitTesla;

    const teslaFleetRoot = getTeslaFleetRoot(metricsDoc);
    const teslaFleetBillable = readNestedCounter(teslaFleetRoot, ['calls', 'billable']);
    if (teslaFleetBillable) return teslaFleetBillable;

    const teslaFleetTotal = readNestedCounter(teslaFleetRoot, ['calls', 'total']);
    if (teslaFleetTotal) return teslaFleetTotal;

    const byCategory = (teslaFleetRoot && teslaFleetRoot.calls && teslaFleetRoot.calls.byCategory)
      ? teslaFleetRoot.calls.byCategory
      : null;
    if (byCategory && typeof byCategory === 'object') {
      const sum = Object.values(byCategory).reduce((acc, value) => acc + toCounter(value), 0);
      if (sum) return sum;
    }

    return 0;
  };

  const resolvePricingCounter = (metricsDoc = {}) => {
    const explicitPricing = toCounter(metricsDoc.pricing);
    if (explicitPricing) return explicitPricing;
    return toCounter(metricsDoc.amber) + toCounter(metricsDoc.aemo);
  };

  const getRecentUserMetricsSnapshot = async (metricsCollection, days) => {
    if (metricsCollection && typeof metricsCollection.orderBy === 'function') {
      try {
        return await metricsCollection.orderBy('__name__', 'desc').limit(days).get();
      } catch (queryError) {
        logger.warn(
          `[Metrics] Bounded user metrics query failed; falling back to full scan: ${queryError?.message || queryError}`
        );
      }
    }
    return metricsCollection.get();
  };

  const buildMetricsEnvelope = (rawDoc = {}) => {
    const metricsDoc = (rawDoc && typeof rawDoc === 'object') ? rawDoc : {};
    const providerBreakdown = {};

    const addProviderCount = (providerKey, value) => {
      const key = normalizeMetricKey(providerKey);
      if (!key) return;
      const count = toCounter(value);
      if (!count) return;
      providerBreakdown[key] = Math.max(providerBreakdown[key] || 0, count);
    };

    KNOWN_INVERTER_PROVIDER_KEYS.forEach((providerKey) => {
      addProviderCount(providerKey, metricsDoc[providerKey]);
    });

    if (metricsDoc.inverterByProvider && typeof metricsDoc.inverterByProvider === 'object') {
      Object.entries(metricsDoc.inverterByProvider).forEach(([providerKey, value]) => {
        addProviderCount(providerKey, value);
      });
    }

    // Do not infer provider counters from arbitrary top-level keys.
    // Some metrics docs include flat dotted keys (e.g. teslaFleet.calls.total)
    // that are non-inverter counters and would otherwise inflate inverter totals.

    const inverterByProvider = {};
    KNOWN_INVERTER_PROVIDER_KEYS.forEach((providerKey) => {
      inverterByProvider[providerKey] = providerBreakdown[providerKey] || 0;
    });
    const explicitInverter = toCounter(metricsDoc.inverter);
    const inverter = explicitInverter || Object.values(providerBreakdown).reduce((sum, count) => sum + count, 0);

    return {
      inverter,
      inverterByProvider,
      foxess: inverterByProvider.foxess || 0,
      sungrow: inverterByProvider.sungrow || 0,
      sigenergy: inverterByProvider.sigenergy || 0,
      alphaess: inverterByProvider.alphaess || 0,
      pricing: resolvePricingCounter(metricsDoc),
      amber: resolvePricingCounter(metricsDoc),
      aemo: toCounter(metricsDoc.aemo),
      weather: toCounter(metricsDoc.weather),
      ev: resolveEvCounter(metricsDoc)
    };
  };

  // Metrics (platform global or per-user).
  app.get('/api/metrics/api-calls', async (req, res) => {
    // Parse days outside try block so it's available in catch
    const days = Math.max(1, Math.min(30, parseInt(req.query.days || '7', 10)));

    try {
      // Attach optional user (don't require auth globally here)
      await tryAttachUser(req);

      const scope = String(req.query.scope || 'global');

      if (scope === 'global') {
        const userId = req.user?.uid;
        const isAuthorized = Boolean(userId) && (typeof isAdmin === 'function' ? isAdmin(userId) : true);
        if (!isAuthorized) {
          return res.status(401).json({ errno: 401, error: 'Unauthorized' });
        }
      }

      if (!db) {
        const result = {};
        const endDate = new Date();
        for (let i = 0; i < days; i++) {
          const d = new Date(endDate);
          d.setDate(d.getDate() - i);
          const key = getAusDateKey(d);
          result[key] = buildMetricsEnvelope({});
        }
        return res.json({ errno: 0, result });
      }

      const endDate = new Date();

      if (scope === 'user') {
        const userId = req.user?.uid;
        if (!userId) {
          logger.warn('[Metrics] User scope requested but no userId - returning 401');
          return res.status(401).json({ errno: 401, error: 'Unauthorized: user scope requested' });
        }

        const metricsCollection = db.collection('users').doc(userId).collection('metrics');
        const metricsSnapshot = await getRecentUserMetricsSnapshot(metricsCollection, days);

        const result = {};
        const allDocs = [];
        metricsSnapshot.forEach((doc) => {
          const d = buildMetricsEnvelope(doc.data() || {});
          allDocs.push({
            id: doc.id,
            metrics: d
          });
        });

        // Sort by date descending (YYYY-MM-DD format sorts alphabetically)
        allDocs.sort((a, b) => b.id.localeCompare(a.id));

        // Take only the most recent N days
        allDocs.slice(0, days).forEach((doc) => {
          result[doc.id] = doc.metrics;
        });

        // Fill in missing days with zeros (Australia/Sydney local date)
        for (let i = 0; i < days; i++) {
          const d = new Date(endDate);
          d.setDate(d.getDate() - i);
          const key = getAusDateKey(d);
          if (!result[key]) result[key] = buildMetricsEnvelope({});
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
        result[key] = buildMetricsEnvelope(data || {});
      }

      return res.json({ errno: 0, result });
    } catch (error) {
      console.error('[Metrics] Error in /api/metrics/api-calls (pre-auth):', error && error.message);
      const result = {};
      const endDate = new Date();
      for (let i = 0; i < days; i++) {
        const d = new Date(endDate);
        d.setDate(d.getDate() - i);
        const key = getAusDateKey(d);
        result[key] = buildMetricsEnvelope({});
      }
      return res.json({ errno: 0, result });
    }
  });
}

module.exports = {
  registerMetricsRoutes
};
