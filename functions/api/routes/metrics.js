'use strict';

function registerMetricsRoutes(app, deps = {}) {
  const db = deps.db;
  const getAusDateKey = deps.getAusDateKey;
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
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const normalizeMetricKey = (metricKey) => String(metricKey || '').toLowerCase().trim();

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

    Object.entries(metricsDoc).forEach(([metricKey, metricValue]) => {
      const key = normalizeMetricKey(metricKey);
      if (!key || key === 'inverter' || key === 'inverterbyprovider' || key === 'amber' || key === 'weather' || key === 'updatedat') {
        return;
      }
      if (Object.prototype.hasOwnProperty.call(providerBreakdown, key)) return;
      addProviderCount(key, metricValue);
    });

    const inverterByProvider = {};
    KNOWN_INVERTER_PROVIDER_KEYS.forEach((providerKey) => {
      inverterByProvider[providerKey] = providerBreakdown[providerKey] || 0;
    });
    Object.entries(providerBreakdown).forEach(([providerKey, count]) => {
      if (Object.prototype.hasOwnProperty.call(inverterByProvider, providerKey)) return;
      inverterByProvider[providerKey] = count;
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
      amber: toCounter(metricsDoc.amber),
      weather: toCounter(metricsDoc.weather)
    };
  };

  // Metrics (platform global or per-user). Allow unauthenticated callers to read global metrics by default.
  app.get('/api/metrics/api-calls', async (req, res) => {
    // Parse days outside try block so it's available in catch
    const days = Math.max(1, Math.min(30, parseInt(req.query.days || '7', 10)));

    try {
      // Attach optional user (don't require auth globally here)
      await tryAttachUser(req);

      const scope = String(req.query.scope || 'global');

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
          console.warn('[Metrics] User scope requested but no userId - returning 401');
          return res.status(401).json({ errno: 401, error: 'Unauthorized: user scope requested' });
        }

        // Query without orderBy to avoid needing a composite index
        // Get all metrics docs for the user and filter/sort in code
        const metricsSnapshot = await db.collection('users').doc(userId)
          .collection('metrics')
          .get();

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
