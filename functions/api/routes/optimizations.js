'use strict';

function requireUser(req, res) {
  const userId = req.user?.uid;
  if (!userId) {
    res.status(401).json({ errno: 401, error: 'Unauthorized' });
    return null;
  }
  return userId;
}

function registerOptimizationRoutes(app, deps = {}) {
  const optimizationService = deps.optimizationService;

  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function') {
    throw new Error('registerOptimizationRoutes requires an Express app');
  }
  if (!optimizationService || typeof optimizationService.createRun !== 'function') {
    throw new Error('registerOptimizationRoutes requires optimizationService');
  }

  app.post('/api/optimizations/runs', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const result = await optimizationService.createRun(userId, req.body || {});
      return res.json({ errno: 0, result });
    } catch (error) {
      return res.status(400).json({ errno: 400, error: error?.message || String(error) });
    }
  });

  app.get('/api/optimizations/runs', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const result = await optimizationService.listRuns(userId, req.query.limit);
      return res.json({ errno: 0, result });
    } catch (error) {
      return res.status(500).json({ errno: 500, error: error?.message || String(error) });
    }
  });

  app.get('/api/optimizations/runs/:runId', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const result = await optimizationService.getRun(userId, req.params.runId);
      if (!result) return res.status(404).json({ errno: 404, error: 'Optimization run not found' });
      return res.json({ errno: 0, result });
    } catch (error) {
      return res.status(500).json({ errno: 500, error: error?.message || String(error) });
    }
  });

  app.post('/api/optimizations/runs/:runId/apply', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const result = await optimizationService.applyVariant(
        userId,
        req.params.runId,
        req.body?.variantId,
        req.body?.confirm === true
      );
      return res.json({ errno: 0, result });
    } catch (error) {
      const status = /not found/i.test(error?.message || '') ? 404 : 400;
      return res.status(status).json({ errno: status, error: error?.message || String(error) });
    }
  });
}

module.exports = {
  registerOptimizationRoutes
};
