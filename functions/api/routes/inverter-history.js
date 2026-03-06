'use strict';

function registerInverterHistoryRoutes(app, deps = {}) {
  const authenticateUser = deps.authenticateUser;
  const db = deps.db;
  const foxessAPI = deps.foxessAPI;
  const getUserConfig = deps.getUserConfig;
  const logger = deps.logger || console;

  if (!app || typeof app.get !== 'function') {
    throw new Error('registerInverterHistoryRoutes requires an Express app');
  }
  if (typeof authenticateUser !== 'function') {
    throw new Error('registerInverterHistoryRoutes requires authenticateUser middleware');
  }
  if (!db || typeof db.collection !== 'function') {
    throw new Error('registerInverterHistoryRoutes requires db');
  }
  if (!foxessAPI || typeof foxessAPI.callFoxESSAPI !== 'function') {
    throw new Error('registerInverterHistoryRoutes requires foxessAPI');
  }
  if (typeof getUserConfig !== 'function') {
    throw new Error('registerInverterHistoryRoutes requires getUserConfig()');
  }

  async function withTimeout(promise, timeoutMs) {
    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Request timeout')), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Get inverter history data from FoxESS API
   * Handles large date ranges by splitting into 24-hour chunks
   * Caches results in Firestore to reduce API calls
   */
  app.get('/api/inverter/history', authenticateUser, async (req, res) => {
    try {
      const userId = req.user.uid;
      const userConfig = await getUserConfig(userId);
      const sn = req.query.sn || userConfig?.deviceSn;

      if (!sn) {
        return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
      }

      let begin = Number(req.query.begin);
      let end = Number(req.query.end);

      const DEFAULT_RANGE_MS = 24 * 60 * 60 * 1000;

      if (!Number.isFinite(begin)) begin = Date.now() - DEFAULT_RANGE_MS;
      if (!Number.isFinite(end)) end = Date.now();

      // Normalize to milliseconds (FoxESS expects ms)
      if (begin < 1e12) begin *= 1000;
      if (end < 1e12) end *= 1000;

      begin = Math.floor(begin);
      end = Math.floor(end);

      try {
        const MAX_RANGE_MS = 24 * 60 * 60 * 1000; // 24 hours per FoxESS request

        // If the requested window is small, call FoxESS once. For larger windows, split into chunks and merge results.
        if ((end - begin) <= MAX_RANGE_MS) {
          // Check cache first
          const cachedResult = await getHistoryFromCacheFirestore(userId, sn, begin, end);
          if (cachedResult) {
            return res.json(cachedResult);
          }

          const result = await withTimeout(foxessAPI.callFoxESSAPI('/op/v0/device/history/query', 'POST', {
            sn,
            begin,
            end,
            variables: ['generationPower', 'pvPower', 'meterPower', 'meterPower2', 'feedinPower', 'gridConsumptionPower', 'loadsPower']
          }, userConfig, userId), 9000);

          // Cache successful response
          if (result && result.errno === 0) {
            await setHistoryToCacheFirestore(userId, sn, begin, end, result)
              .catch((e) => logger.warn('[History] Cache write failed:', e.message));
          }

          return res.json(result);
        }

        // Build chunk ranges
        const chunks = [];
        let cursor = begin;
        while (cursor < end) {
          const chunkEnd = Math.min(end, cursor + MAX_RANGE_MS - 1);
          chunks.push({ cbeg: cursor, cend: chunkEnd });
          cursor = chunkEnd + 1;
        }

        // Aggregate results per variable
        const aggMap = {}; // variable -> array of {time, value}
        let deviceSN = sn;

        for (const ch of chunks) {
          // Check cache for this chunk
          let chunkResp = await getHistoryFromCacheFirestore(userId, sn, ch.cbeg, ch.cend);
          if (!chunkResp) {
            chunkResp = await foxessAPI.callFoxESSAPI('/op/v0/device/history/query', 'POST', {
              sn,
              begin: ch.cbeg,
              end: ch.cend,
              variables: ['generationPower', 'pvPower', 'meterPower', 'meterPower2', 'feedinPower', 'gridConsumptionPower', 'loadsPower']
            }, userConfig, userId);

            // Cache successful chunk response
            if (chunkResp && chunkResp.errno === 0) {
              await setHistoryToCacheFirestore(userId, sn, ch.cbeg, ch.cend, chunkResp)
                .catch((e) => logger.warn('[History] Cache write failed:', e.message));
            }
          }

          if (!chunkResp || chunkResp.errno !== 0) {
            // Bubble up the upstream error
            const errMsg = chunkResp && chunkResp.msg ? chunkResp.msg : 'Unknown FoxESS error';
            logger.warn(`[History] FoxESS chunk error for ${new Date(ch.cbeg).toISOString()} - ${new Date(ch.cend).toISOString()}: ${errMsg}`);
            return res.status(500).json({ errno: chunkResp?.errno || 500, msg: `FoxESS API error: ${errMsg}` });
          }

          const r = Array.isArray(chunkResp.result) && chunkResp.result[0] ? chunkResp.result[0] : null;
          if (!r) continue;
          deviceSN = r.deviceSN || deviceSN;

          const datas = Array.isArray(r.datas) ? r.datas : [];
          for (const item of datas) {
            const variable = item.variable || item.name || 'unknown';
            if (!Array.isArray(item.data)) continue;
            if (!aggMap[variable]) aggMap[variable] = [];
            // Append all points (chunks are non-overlapping)
            aggMap[variable].push(...item.data);
          }

          // Small delay to be kind to upstream when many chunks requested
          await new Promise((resolve) => setTimeout(resolve, 150));
        }

        // Merge & dedupe per-variable by time, then sort chronologically
        const mergedDatas = [];
        for (const [variable, points] of Object.entries(aggMap)) {
          const mapByTime = new Map();
          for (const p of points) {
            // Use the time string prefix (YYYY-MM-DD HH:MM:SS) as key when available
            const tKey = (typeof p.time === 'string' && p.time.length >= 19) ? p.time.substr(0, 19) : String(p.time);
            mapByTime.set(tKey, p);
          }
          // Convert back to array and sort by key (YYYY-MM-DD HH:MM:SS sorts lexicographically)
          const merged = Array.from(mapByTime.values()).sort((a, b) => {
            const ta = (typeof a.time === 'string' ? a.time.substr(0, 19) : String(a.time));
            const tb = (typeof b.time === 'string' ? b.time.substr(0, 19) : String(b.time));
            return ta < tb ? -1 : (ta > tb ? 1 : 0);
          });
          mergedDatas.push({ unit: 'kW', data: merged, name: variable, variable });
        }

        return res.json({ errno: 0, msg: 'Operation successful', result: [{ datas: mergedDatas, deviceSN }] });
      } catch (apiError) {
        logger.warn(`[History] API error: ${apiError.message}`);
        return res.status(500).json({ errno: 500, msg: `FoxESS API error: ${apiError.message}` });
      }
    } catch (error) {
      console.error(`[History] Request error: ${error.message}`);
      return res.status(500).json({ errno: 500, error: error.message });
    }
  });

  /**
   * Get inverter history from Firestore cache
   * Cache TTL: 30 minutes
   */
  async function getHistoryFromCacheFirestore(userId, sn, begin, end) {
    try {
      const cacheKey = `history_${sn}_${begin}_${end}`;
      const docRef = db.collection('users').doc(userId).collection('cache').doc(cacheKey);
      const doc = await docRef.get();

      if (doc.exists) {
        const entry = doc.data();
        const ttl = 30 * 60 * 1000; // 30 minutes
        if (entry.timestamp && (Date.now() - entry.timestamp) < ttl) {
          return entry.data;
        }
        // Delete expired entry
        await docRef.delete().catch(() => {});
      }
      return null;
    } catch (error) {
      logger.warn('[History] Cache get error:', error.message);
      return null;
    }
  }

  /**
   * Set inverter history to Firestore cache
   */
  async function setHistoryToCacheFirestore(userId, sn, begin, end, data) {
    try {
      const cacheKey = `history_${sn}_${begin}_${end}`;
      const docRef = db.collection('users').doc(userId).collection('cache').doc(cacheKey);
      await docRef.set({
        timestamp: Date.now(),
        data,
        ttl: Math.floor(Date.now() / 1000) + (30 * 60) // Firestore TTL in seconds (30 min from now)
      });
    } catch (error) {
      logger.warn('[History] Cache set error:', error.message);
      // Don't throw - cache is optional
    }
  }
}

module.exports = {
  registerInverterHistoryRoutes
};
