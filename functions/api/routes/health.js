'use strict';

function registerHealthRoutes(app, deps = {}) {
  const getUserConfig = deps.getUserConfig;
  const getUserConfigPublic = deps.getUserConfigPublic || deps.getUserConfig;
  const getUpstreamHealthSnapshot = deps.getUpstreamHealthSnapshot;
  const tryAttachUser = deps.tryAttachUser;

  if (!app || typeof app.get !== 'function') {
    throw new Error('registerHealthRoutes requires an Express app');
  }
  if (typeof getUserConfig !== 'function') {
    throw new Error('registerHealthRoutes requires getUserConfig()');
  }
  if (typeof getUserConfigPublic !== 'function') {
    throw new Error('registerHealthRoutes requires getUserConfigPublic()');
  }
  if (typeof tryAttachUser !== 'function') {
    throw new Error('registerHealthRoutes requires tryAttachUser()');
  }

  // Health check (no auth required)
  app.get('/api/health', async (req, res) => {
    const buildResponse = (foxessTokenPresent, amberApiKeyPresent, upstream = null) => ({
      errno: 0,
      result: {
        status: upstream?.status || 'OK',
        upstream: upstream || undefined
      },
      // Legacy fields retained for existing frontend consumers.
      ok: true,
      FOXESS_TOKEN: !!foxessTokenPresent,
      AMBER_API_KEY: !!amberApiKeyPresent
    });

    try {
      await tryAttachUser(req);
      const userId = req.user?.uid;

      // Check if user is authenticated and has tokens saved
      let foxessTokenPresent = false;
      let amberApiKeyPresent = false;
      let upstream = null;

      if (userId) {
        try {
          const config = (await getUserConfigPublic(userId)) || {};
          foxessTokenPresent = !!config.foxessToken;
          amberApiKeyPresent = !!config.amberApiKey;
        } catch (e) {
          console.warn('[Health] Failed to check config:', e.message);
        }
      }

      if (typeof getUpstreamHealthSnapshot === 'function') {
        upstream = await getUpstreamHealthSnapshot({
          forceRefresh: req.query?.refresh === '1' || req.query?.probe === '1',
          user: req.user || null
        });
      }

      const response = buildResponse(foxessTokenPresent, amberApiKeyPresent, upstream);
      const statusCode = upstream && upstream.status && upstream.status !== 'OK' ? 503 : 200;
      res.status(statusCode).json(response);
    } catch (error) {
      console.error('[Health] Error:', error);
      res.status(503).json(buildResponse(false, false, {
        status: 'DEGRADED',
        services: {},
        error: error.message || String(error)
      }));
    }
  });
}

module.exports = {
  registerHealthRoutes
};
