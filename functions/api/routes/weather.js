'use strict';

function registerWeatherRoutes(app, deps = {}) {
  const getCachedWeatherData = deps.getCachedWeatherData;
  const tryAttachUser = deps.tryAttachUser;

  if (!app || typeof app.get !== 'function') {
    throw new Error('registerWeatherRoutes requires an Express app');
  }
  if (typeof getCachedWeatherData !== 'function') {
    throw new Error('registerWeatherRoutes requires getCachedWeatherData()');
  }
  if (typeof tryAttachUser !== 'function') {
    throw new Error('registerWeatherRoutes requires tryAttachUser()');
  }

  // Weather endpoint
  app.get('/api/weather', async (req, res) => {
    try {
      await tryAttachUser(req);
      const place = req.query.place || 'Sydney';
      const days = parseInt(req.query.days || '3', 10);
      const forceRefresh = req.query.forceRefresh === 'true' || req.query.force === 'true';
      const result = await getCachedWeatherData(req.user?.uid || 'anonymous', place, days, forceRefresh);
      res.json(result);
    } catch (error) {
      res.status(500).json({ errno: 500, error: error.message });
    }
  });
}

module.exports = {
  registerWeatherRoutes
};
