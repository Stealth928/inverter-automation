'use strict';

/**
 * Asset Registry Routes
 *
 * Exposes endpoints for the v2 assets collection.
 *
 *   GET    /api/assets              — list user's assets (v2 + legacy fallback)
 *   POST   /api/assets/migrate      — migrate a legacy user to v2 asset documents
 *   DELETE /api/assets/:assetId     — delete an asset
 */

function registerAssetsRoutes(app, deps = {}) {
  const authenticateUser = deps.authenticateUser;
  const assetRepo = deps.assetRepo;
  const getUserConfig = deps.getUserConfig;

  if (!app || typeof app.get !== 'function') {
    throw new Error('registerAssetsRoutes requires an Express app');
  }
  if (typeof authenticateUser !== 'function') {
    throw new Error('registerAssetsRoutes requires authenticateUser()');
  }
  if (
    !assetRepo ||
    typeof assetRepo.getAssetsWithLegacyFallback !== 'function' ||
    typeof assetRepo.migrateUserToAssets !== 'function' ||
    typeof assetRepo.deleteAsset !== 'function'
  ) {
    throw new Error('registerAssetsRoutes requires a valid assetRepo');
  }

  /**
   * GET /api/assets
   * Returns all assets for the authenticated user.
   * Uses dual-read fallback so legacy users see a virtual asset derived from config.
   */
  app.get('/api/assets', authenticateUser, async (req, res) => {
    const userId = req.user && req.user.uid;
    if (!userId) {
      return res.status(401).json({ errno: 401, error: 'Unauthorized' });
    }
    try {
      let userConfig = null;
      if (typeof getUserConfig === 'function') {
        userConfig = await getUserConfig(userId);
      }
      const assets = await assetRepo.getAssetsWithLegacyFallback(userId, userConfig || {});
      return res.json({ errno: 0, result: assets });
    } catch (error) {
      console.error('[Assets] GET error:', error);
      return res.status(500).json({ errno: 500, error: 'Failed to load assets' });
    }
  });

  /**
   * POST /api/assets/migrate
   * Idempotent: writes legacy flat config to v2 assets collection.
   * No-op if v2 assets already exist.
   */
  app.post('/api/assets/migrate', authenticateUser, async (req, res) => {
    const userId = req.user && req.user.uid;
    if (!userId) {
      return res.status(401).json({ errno: 401, error: 'Unauthorized' });
    }
    try {
      let userConfig = null;
      if (typeof getUserConfig === 'function') {
        userConfig = await getUserConfig(userId);
      }
      const outcome = await assetRepo.migrateUserToAssets(userId, userConfig || {});
      return res.json({ errno: 0, result: outcome });
    } catch (error) {
      console.error('[Assets] POST /migrate error:', error);
      return res.status(500).json({ errno: 500, error: 'Migration failed' });
    }
  });

  /**
   * DELETE /api/assets/:assetId
   * Remove a specific asset document for the authenticated user.
   */
  app.delete('/api/assets/:assetId', authenticateUser, async (req, res) => {
    const userId = req.user && req.user.uid;
    if (!userId) {
      return res.status(401).json({ errno: 401, error: 'Unauthorized' });
    }
    const { assetId } = req.params;
    if (!assetId) {
      return res.status(400).json({ errno: 400, error: 'assetId is required' });
    }
    try {
      const deleted = await assetRepo.deleteAsset(userId, assetId);
      if (!deleted) {
        return res.status(404).json({ errno: 404, error: 'Asset not found or could not be deleted' });
      }
      return res.json({ errno: 0, result: { deleted: true, assetId } });
    } catch (error) {
      console.error('[Assets] DELETE error:', error);
      return res.status(500).json({ errno: 500, error: 'Failed to delete asset' });
    }
  });
}

module.exports = { registerAssetsRoutes };
