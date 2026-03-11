'use strict';

function registerHealthRoutes(app, deps = {}) {
  const getUserConfig = deps.getUserConfig;
  const tryAttachUser = deps.tryAttachUser;

  if (!app || typeof app.get !== 'function') {
    throw new Error('registerHealthRoutes requires an Express app');
  }
  if (typeof getUserConfig !== 'function') {
    throw new Error('registerHealthRoutes requires getUserConfig()');
  }
  if (typeof tryAttachUser !== 'function') {
    throw new Error('registerHealthRoutes requires tryAttachUser()');
  }

  // Health check (no auth required)
  app.get('/api/health', async (req, res) => {
    const buildResponse = (foxessTokenPresent, amberApiKeyPresent) => ({
      errno: 0,
      result: {
        status: 'OK'
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

      if (userId) {
        try {
          const config = (await getUserConfig(userId)) || {};
          foxessTokenPresent = !!config.foxessToken;
          amberApiKeyPresent = !!config.amberApiKey;
        } catch (e) {
          console.warn('[Health] Failed to check config:', e.message);
        }
      }

      res.json(buildResponse(foxessTokenPresent, amberApiKeyPresent));
    } catch (error) {
      console.error('[Health] Error:', error);
      res.json(buildResponse(false, false));
    }
  });
}

module.exports = {
  registerHealthRoutes
};
