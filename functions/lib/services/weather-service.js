'use strict';

const defaultFetch = global.fetch;

if (typeof defaultFetch !== 'function') {
  throw new Error('Global fetch is not available in this runtime.');
}

function createWeatherService(deps = {}) {
  const db = deps.db;
  const getConfig = deps.getConfig;
  const incrementApiCount = deps.incrementApiCount;
  const setUserConfig = deps.setUserConfig;
  const fetchImpl = deps.fetchImpl || defaultFetch;
  const logger = deps.logger || console;

  if (!db || typeof db.collection !== 'function') {
    throw new Error('createWeatherService requires Firestore db');
  }
  if (typeof getConfig !== 'function') {
    throw new Error('createWeatherService requires getConfig()');
  }
  if (typeof incrementApiCount !== 'function') {
    throw new Error('createWeatherService requires incrementApiCount()');
  }
  if (typeof setUserConfig !== 'function') {
    throw new Error('createWeatherService requires setUserConfig()');
  }

  const warn = (...args) => {
    if (typeof logger.warn === 'function') {
      logger.warn(...args);
      return;
    }
    console.warn(...args);
  };

  const errorLog = (...args) => {
    if (typeof logger.error === 'function') {
      logger.error(...args);
      return;
    }
    console.error(...args);
  };

  async function callWeatherAPI(place = 'Sydney', days = 16, userId = null) {
    if (userId) {
      incrementApiCount(userId, 'weather').catch(() => {});
    }

    const forecastDays = Math.min(Math.max(1, days), 16);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=5&language=en`;
      const geoResp = await fetchImpl(geoUrl, { signal: controller.signal });
      const geoJson = await geoResp.json();

      let latitude;
      let longitude;
      let resolvedName;
      let country;
      let fallback = false;
      let fallbackReason = '';
      let fallbackResolvedName = '';

      if (geoJson && Array.isArray(geoJson.results) && geoJson.results.length > 0) {
        const auResult = geoJson.results.find((result) => result.country_code === 'AU');
        const selectedResult = auResult || geoJson.results[0];

        latitude = selectedResult.latitude;
        longitude = selectedResult.longitude;
        resolvedName = selectedResult.name;
        country = selectedResult.country;
      } else {
        fallback = true;
        fallbackReason = 'location_not_found';
        fallbackResolvedName = 'Sydney NSW';
        latitude = -33.9215;
        longitude = 151.0390;
        resolvedName = place;
        country = 'AU';
      }

      const hourlyVars = [
        'temperature_2m',
        'precipitation',
        'precipitation_probability',
        'weathercode',
        'shortwave_radiation',
        'direct_radiation',
        'diffuse_radiation',
        'cloudcover',
        'windspeed_10m',
        'relativehumidity_2m',
        'uv_index'
      ].join(',');

      const dailyVars = [
        'temperature_2m_max',
        'temperature_2m_min',
        'precipitation_sum',
        'weathercode',
        'shortwave_radiation_sum',
        'uv_index_max',
        'sunrise',
        'sunset',
        'precipitation_probability_max'
      ].join(',');

      const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=${hourlyVars}&daily=${dailyVars}&current_weather=true&temperature_unit=celsius&timezone=auto&forecast_days=${forecastDays}`;
      const forecastResp = await fetchImpl(forecastUrl, { signal: controller.signal });
      const forecastJson = await forecastResp.json();
      clearTimeout(timeout);

      const detectedTimezone = forecastJson.timezone || 'Australia/Sydney';

      return {
        errno: 0,
        result: {
          source: 'open-meteo',
          place: {
            query: place,
            resolvedName,
            country,
            latitude,
            longitude,
            timezone: detectedTimezone,
            fallback,
            fallbackReason,
            fallbackResolvedName
          },
          current: forecastJson.current_weather || null,
          hourly: forecastJson.hourly || null,
          daily: forecastJson.daily || null,
          raw: forecastJson,
          forecastDays
        }
      };
    } catch (error) {
      return { errno: 500, error: error.message };
    }
  }

  async function getCachedWeatherData(userId, place = 'Sydney', days = 16, forceRefresh = false) {
    const config = getConfig();
    const ttlMs = config.automation.cacheTtl.weather;

    try {
      if (!forceRefresh) {
        const cacheDoc = await db.collection('users').doc(userId).collection('cache').doc('weather').get();

        if (cacheDoc.exists) {
          const { data, timestamp, cachedDays, cachedPlace } = cacheDoc.data();
          const ageMs = Date.now() - timestamp;
          const cachedDayCount = data && data.result && data.result.daily && Array.isArray(data.result.daily.time)
            ? data.result.daily.time.length
            : 0;
          const placesMatch = (cachedPlace || '').toLowerCase().trim() === (place || '').toLowerCase().trim();

          if (placesMatch && ageMs < ttlMs && cachedDays >= days && cachedDayCount >= days) {
            return { ...data, __cacheHit: true, __cacheAgeMs: ageMs, __cacheTtlMs: ttlMs };
          }
        }
      }

      const data = await callWeatherAPI(place, days, userId);

      if (data && data.errno === 0 && data.result && data.result.place && data.result.place.timezone && userId) {
        const detectedTimezone = data.result.place.timezone;
        try {
          await setUserConfig(userId, { timezone: detectedTimezone }, { merge: true });
        } catch (tzErr) {
          warn(`[Weather] Failed to update user timezone: ${tzErr.message}`);
        }
      }

      if (data && data.errno === 0) {
        const cacheData = {
          errno: data.errno,
          result: {
            source: data.result ? data.result.source : undefined,
            place: data.result ? data.result.place : undefined,
            current: data.result ? data.result.current : undefined,
            daily: data.result ? data.result.daily : undefined,
            hourly: data.result ? data.result.hourly : undefined,
            forecastDays: data.result ? data.result.forecastDays : undefined
          }
        };

        await db.collection('users').doc(userId).collection('cache').doc('weather').set({
          data: cacheData,
          timestamp: Date.now(),
          ttlMs,
          cachedPlace: place,
          cachedDays: days,
          ttl: Math.floor(Date.now() / 1000) + Math.floor(ttlMs / 1000)
        }, { merge: true }).catch((cacheErr) => {
          warn(`[Cache] Failed to store weather cache: ${cacheErr.message}`);
        });
      }

      return { ...data, __cacheHit: false, __cacheAgeMs: 0, __cacheTtlMs: ttlMs };
    } catch (error) {
      errorLog(`[Cache] Error in getCachedWeatherData: ${error.message}`);
      return { errno: 500, error: error.message };
    }
  }

  return {
    callWeatherAPI,
    getCachedWeatherData
  };
}

module.exports = {
  createWeatherService
};
