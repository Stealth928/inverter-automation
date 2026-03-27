'use strict';

function registerNotificationRoutes(app, deps = {}) {
  const authenticateUser = deps.authenticateUser;
  const notificationsService = deps.notificationsService;

  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function' || typeof app.delete !== 'function') {
    throw new Error('registerNotificationRoutes requires an Express app');
  }
  if (typeof authenticateUser !== 'function') {
    throw new Error('registerNotificationRoutes requires authenticateUser middleware');
  }
  if (!notificationsService || typeof notificationsService.getBootstrap !== 'function') {
    throw new Error('registerNotificationRoutes requires notificationsService');
  }

  app.get('/api/notifications/bootstrap', authenticateUser, async (req, res) => {
    try {
      const result = await notificationsService.getBootstrap(req.user.uid);
      return res.json({ errno: 0, result });
    } catch (error) {
      console.error('[Notifications] bootstrap error:', error?.stack || error?.message || error);
      return res.status(500).json({ errno: 500, error: error?.message || 'Failed to load notifications bootstrap' });
    }
  });

  app.get('/api/notifications', authenticateUser, async (req, res) => {
    try {
      const result = await notificationsService.listNotifications(req.user.uid, {
        limit: req.query.limit,
        cursor: req.query.cursor,
        unreadOnly: req.query.unreadOnly
      });
      return res.json({ errno: 0, result });
    } catch (error) {
      console.error('[Notifications] list error:', error?.stack || error?.message || error);
      return res.status(500).json({ errno: 500, error: error?.message || 'Failed to load notifications' });
    }
  });

  app.post('/api/notifications/preferences', authenticateUser, async (req, res) => {
    try {
      const preferences = await notificationsService.saveUserPreferences(
        req.user.uid,
        req.body?.preferences || req.body || {}
      );
      return res.json({ errno: 0, result: { preferences } });
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      console.error('[Notifications] preferences save error:', error?.stack || error?.message || error);
      return res.status(statusCode).json({ errno: statusCode, error: error?.message || 'Failed to save notification preferences' });
    }
  });

  app.post('/api/notifications/subscriptions', authenticateUser, async (req, res) => {
    try {
      const result = await notificationsService.upsertSubscription(req.user.uid, req.body || {});
      return res.json({ errno: 0, result });
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      console.error('[Notifications] subscription upsert error:', error?.stack || error?.message || error);
      return res.status(statusCode).json({ errno: statusCode, error: error?.message || 'Failed to save push subscription' });
    }
  });

  app.delete('/api/notifications/subscriptions/:subscriptionId', authenticateUser, async (req, res) => {
    try {
      const result = await notificationsService.deactivateSubscription(req.user.uid, req.params.subscriptionId);
      return res.json({ errno: 0, result });
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      console.error('[Notifications] subscription delete error:', error?.stack || error?.message || error);
      return res.status(statusCode).json({ errno: statusCode, error: error?.message || 'Failed to deactivate push subscription' });
    }
  });

  app.post('/api/notifications/read', authenticateUser, async (req, res) => {
    try {
      const result = await notificationsService.markRead(req.user.uid, req.body || {});
      return res.json({ errno: 0, result });
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      console.error('[Notifications] read update error:', error?.stack || error?.message || error);
      return res.status(statusCode).json({ errno: statusCode, error: error?.message || 'Failed to update notification read state' });
    }
  });
}

module.exports = {
  registerNotificationRoutes
};
