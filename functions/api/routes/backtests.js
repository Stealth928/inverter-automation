'use strict';

function requireUser(req, res) {
  const userId = req.user?.uid;
  if (!userId) {
    res.status(401).json({ errno: 401, error: 'Unauthorized' });
    return null;
  }
  return userId;
}

function createRequireFeatureAccess(requireAdmin) {
  return async function requireFeatureAccess(req, res, next) {
    const userId = requireUser(req, res);
    if (!userId) return;
    if (typeof requireAdmin !== 'function') {
      return next();
    }
    return requireAdmin(req, res, next);
  };
}

function registerBacktestRoutes(app, deps = {}) {
  const backtestService = deps.backtestService;
  const requireAdmin = typeof deps.requireAdmin === 'function' ? deps.requireAdmin : null;
  const requireFeatureAccess = createRequireFeatureAccess(requireAdmin);

  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function' || typeof app.delete !== 'function') {
    throw new Error('registerBacktestRoutes requires an Express app');
  }
  if (!backtestService || typeof backtestService.createRun !== 'function') {
    throw new Error('registerBacktestRoutes requires backtestService');
  }

  app.post('/api/backtests/runs', requireFeatureAccess, async (req, res) => {
    const userId = req.user.uid;
    try {
      const run = await backtestService.createRun(userId, req.body || {});
      return res.json({ errno: 0, result: run });
    } catch (error) {
      return res.status(400).json({ errno: 400, error: error?.message || String(error) });
    }
  });

  app.get('/api/backtests/runs', requireFeatureAccess, async (req, res) => {
    const userId = req.user.uid;
    try {
      const result = await backtestService.listRuns(userId, req.query.limit);
      return res.json({ errno: 0, result });
    } catch (error) {
      return res.status(500).json({ errno: 500, error: error?.message || String(error) });
    }
  });

  app.get('/api/backtests/runs/:runId', requireFeatureAccess, async (req, res) => {
    const userId = req.user.uid;
    try {
      const result = await backtestService.getRun(userId, req.params.runId);
      if (!result) return res.status(404).json({ errno: 404, error: 'Backtest run not found' });
      return res.json({ errno: 0, result });
    } catch (error) {
      return res.status(500).json({ errno: 500, error: error?.message || String(error) });
    }
  });

  app.delete('/api/backtests/runs/:runId', requireFeatureAccess, async (req, res) => {
    const userId = req.user.uid;
    try {
      await backtestService.deleteRun(userId, req.params.runId);
      return res.json({ errno: 0, result: { deleted: true } });
    } catch (error) {
      const message = error?.message || String(error);
      const status = /not found/i.test(message) ? 404 : /cannot be deleted/i.test(message) ? 409 : 500;
      return res.status(status).json({ errno: status, error: message });
    }
  });

  app.get('/api/backtests/tariff-plans', requireFeatureAccess, async (req, res) => {
    const userId = req.user.uid;
    try {
      const result = await backtestService.listTariffPlans(userId);
      return res.json({ errno: 0, result });
    } catch (error) {
      return res.status(500).json({ errno: 500, error: error?.message || String(error) });
    }
  });

  app.post('/api/backtests/tariff-plans', requireFeatureAccess, async (req, res) => {
    const userId = req.user.uid;
    try {
      const result = await backtestService.createTariffPlan(userId, req.body || {});
      return res.json({ errno: 0, result });
    } catch (error) {
      return res.status(400).json({ errno: 400, error: error?.message || String(error) });
    }
  });

  app.post('/api/backtests/tariff-plans/:planId', requireFeatureAccess, async (req, res) => {
    const userId = req.user.uid;
    try {
      const result = await backtestService.updateTariffPlan(userId, req.params.planId, req.body || {});
      return res.json({ errno: 0, result });
    } catch (error) {
      const status = /not found/i.test(error?.message || '') ? 404 : 400;
      return res.status(status).json({ errno: status, error: error?.message || String(error) });
    }
  });

  app.delete('/api/backtests/tariff-plans/:planId', requireFeatureAccess, async (req, res) => {
    const userId = req.user.uid;
    try {
      await backtestService.deleteTariffPlan(userId, req.params.planId);
      return res.json({ errno: 0, result: { deleted: true } });
    } catch (error) {
      return res.status(500).json({ errno: 500, error: error?.message || String(error) });
    }
  });
}

module.exports = {
  registerBacktestRoutes
};
