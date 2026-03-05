'use strict';

function registerMetricsRoutes(app, deps = {}) {
  const db = deps.db;
  const getAusDateKey = deps.getAusDateKey;
  const tryAttachUser = deps.tryAttachUser;

  if (!app || typeof app.get !== 'function') {
    throw new Error('registerMetricsRoutes requires an Express app');
  }
  if (typeof getAusDateKey !== 'function') {
    throw new Error('registerMetricsRoutes requires getAusDateKey()');
  }
  if (typeof tryAttachUser !== 'function') {
    throw new Error('registerMetricsRoutes requires tryAttachUser()');
  }

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
          result[key] = { foxess: 0, amber: 0, weather: 0 };
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
          const d = doc.data() || {};
          allDocs.push({
            id: doc.id,
            foxess: Number(d.foxess || 0),
            amber: Number(d.amber || 0),
            weather: Number(d.weather || 0)
          });
        });

        // Sort by date descending (YYYY-MM-DD format sorts alphabetically)
        allDocs.sort((a, b) => b.id.localeCompare(a.id));

        // Take only the most recent N days
        allDocs.slice(0, days).forEach((doc) => {
          result[doc.id] = {
            foxess: doc.foxess,
            amber: doc.amber,
            weather: doc.weather
          };
        });

        // Fill in missing days with zeros (Australia/Sydney local date)
        for (let i = 0; i < days; i++) {
          const d = new Date(endDate);
          d.setDate(d.getDate() - i);
          const key = getAusDateKey(d);
          if (!result[key]) result[key] = { foxess: 0, amber: 0, weather: 0 };
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
        result[key] = {
          foxess: Number(data?.foxess || 0),
          amber: Number(data?.amber || 0),
          weather: Number(data?.weather || 0)
        };
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
        result[key] = { foxess: 0, amber: 0, weather: 0 };
      }
      return res.json({ errno: 0, result });
    }
  });
}

module.exports = {
  registerMetricsRoutes
};
