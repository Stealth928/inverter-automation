'use strict';

/**
 * Provider Accounts Routes
 *
 * Exposes CRUD endpoints for the v2 providerAccounts and sites collections.
 *
 *   GET  /api/config/provider-accounts          — list all provider accounts (v2 + legacy fallback)
 *   POST /api/config/provider-accounts          — create or update a provider account
 *   DELETE /api/config/provider-accounts/:id    — delete a provider account
 *   POST /api/config/provider-accounts/:id/migrate — migrate a legacy user to v2 account docs
 *   GET  /api/config/sites                      — list all sites for the authenticated user
 */

function registerProviderAccountsRoutes(app, deps = {}) {
  const authenticateUser = deps.authenticateUser;
  const providerAccountsRepo = deps.providerAccountsRepo;
  const getUserConfig = deps.getUserConfig;

  if (!app || typeof app.get !== 'function') {
    throw new Error('registerProviderAccountsRoutes requires an Express app');
  }
  if (typeof authenticateUser !== 'function') {
    throw new Error('registerProviderAccountsRoutes requires authenticateUser()');
  }
  if (
    !providerAccountsRepo ||
    typeof providerAccountsRepo.getProviderAccountsWithLegacyFallback !== 'function' ||
    typeof providerAccountsRepo.saveProviderAccount !== 'function' ||
    typeof providerAccountsRepo.deleteProviderAccount !== 'function'
  ) {
    throw new Error('registerProviderAccountsRoutes requires a valid providerAccountsRepo');
  }

  /**
   * GET /api/config/provider-accounts
   * Returns all provider accounts for the authenticated user.
   * Uses dual-read fallback so legacy users see a virtual account derived from config.
   */
  app.get('/api/config/provider-accounts', authenticateUser, async (req, res) => {
    const userId = req.user && req.user.uid;
    if (!userId) {
      return res.status(401).json({ errno: 401, error: 'Unauthorized' });
    }
    try {
      let userConfig = null;
      if (typeof getUserConfig === 'function') {
        userConfig = await getUserConfig(userId);
      }
      const accounts = await providerAccountsRepo.getProviderAccountsWithLegacyFallback(userId, userConfig || {});
      // Strip internal credentials before returning
      const safeAccounts = accounts.map((a) => ({
        id: a.id,
        providerType: a.providerType,
        defaultSiteId: a.defaultSiteId,
        defaultDeviceSn: a.defaultDeviceSn,
        _source: a._source,
        updatedAt: a.updatedAt
      }));
      return res.json({ errno: 0, result: safeAccounts });
    } catch (error) {
      console.error('[ProviderAccounts] GET error:', error);
      return res.status(500).json({ errno: 500, error: 'Failed to load provider accounts' });
    }
  });

  /**
   * POST /api/config/provider-accounts
   * Create or update a provider account for the authenticated user.
   * Body: { id?, providerType, credentials?, defaultSiteId?, defaultDeviceSn? }
   */
  app.post('/api/config/provider-accounts', authenticateUser, async (req, res) => {
    const userId = req.user && req.user.uid;
    if (!userId) {
      return res.status(401).json({ errno: 401, error: 'Unauthorized' });
    }
    const body = req.body || {};
    if (!body.providerType || typeof body.providerType !== 'string') {
      return res.status(400).json({ errno: 400, error: 'providerType is required' });
    }
    try {
      const saved = await providerAccountsRepo.saveProviderAccount(userId, {
        id: body.id || undefined,
        providerType: String(body.providerType).toLowerCase().trim(),
        credentials: body.credentials || undefined,
        defaultSiteId: body.defaultSiteId || undefined,
        defaultDeviceSn: body.defaultDeviceSn || undefined
      });
      // Don't return raw credentials in response
      return res.json({
        errno: 0,
        result: {
          id: saved.id,
          providerType: saved.providerType,
          defaultSiteId: saved.defaultSiteId,
          defaultDeviceSn: saved.defaultDeviceSn,
          updatedAt: saved.updatedAt
        }
      });
    } catch (error) {
      console.error('[ProviderAccounts] POST error:', error);
      return res.status(500).json({ errno: 500, error: 'Failed to save provider account' });
    }
  });

  /**
   * DELETE /api/config/provider-accounts/:id
   * Delete a provider account by document ID.
   */
  app.delete('/api/config/provider-accounts/:id', authenticateUser, async (req, res) => {
    const userId = req.user && req.user.uid;
    if (!userId) {
      return res.status(401).json({ errno: 401, error: 'Unauthorized' });
    }
    const accountId = req.params.id;
    if (!accountId) {
      return res.status(400).json({ errno: 400, error: 'Account id is required' });
    }
    try {
      const deleted = await providerAccountsRepo.deleteProviderAccount(userId, accountId);
      return res.json({ errno: 0, result: { deleted } });
    } catch (error) {
      console.error('[ProviderAccounts] DELETE error:', error);
      return res.status(500).json({ errno: 500, error: 'Failed to delete provider account' });
    }
  });

  /**
   * POST /api/config/provider-accounts/migrate
   * Migrate the authenticated user from legacy flat config to v2 provider accounts.
   * Idempotent — safe to call multiple times.
   */
  app.post('/api/config/provider-accounts/migrate', authenticateUser, async (req, res) => {
    const userId = req.user && req.user.uid;
    if (!userId) {
      return res.status(401).json({ errno: 401, error: 'Unauthorized' });
    }
    try {
      let userConfig = null;
      if (typeof getUserConfig === 'function') {
        userConfig = await getUserConfig(userId);
      }
      const migrationResult = await providerAccountsRepo.migrateUserToProviderAccounts(userId, userConfig || {});
      return res.json({
        errno: 0,
        result: {
          migrated: migrationResult.migrated,
          accountCount: migrationResult.accounts.length
        }
      });
    } catch (error) {
      console.error('[ProviderAccounts] migrate error:', error);
      return res.status(500).json({ errno: 500, error: 'Failed to migrate provider accounts' });
    }
  });

  /**
   * GET /api/config/sites
   * List all v2 sites for the authenticated user.
   */
  app.get('/api/config/sites', authenticateUser, async (req, res) => {
    const userId = req.user && req.user.uid;
    if (!userId) {
      return res.status(401).json({ errno: 401, error: 'Unauthorized' });
    }
    try {
      const sites = await providerAccountsRepo.getSites(userId);
      return res.json({ errno: 0, result: sites });
    } catch (error) {
      console.error('[ProviderAccounts] GET /sites error:', error);
      return res.status(500).json({ errno: 500, error: 'Failed to load sites' });
    }
  });
}

module.exports = { registerProviderAccountsRoutes };
