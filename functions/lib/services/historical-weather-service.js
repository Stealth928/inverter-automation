'use strict';

const defaultFetch = global.fetch;

if (typeof defaultFetch !== 'function') {
  throw new Error('Global fetch is not available in this runtime.');
}

const DEFAULT_PLACE = 'Sydney, Australia';
const DEFAULT_COORDS = Object.freeze({
  latitude: -33.8688,
  longitude: 151.2093,
  resolvedName: 'Sydney',
  country: 'Australia',
  timezone: 'Australia/Sydney',
  fallback: true
});

function normalizeDateOnly(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }
  return text;
}

function normalizeCloudCoverFields(hourly = {}) {
  if (!hourly || typeof hourly !== 'object') {
    return hourly;
  }
  if (Array.isArray(hourly.cloudcover)) {
    return hourly;
  }
  if (Array.isArray(hourly.cloud_cover)) {
    return {
      ...hourly,
      cloudcover: hourly.cloud_cover
    };
  }
  return hourly;
}

function buildGeocodeUrl(place) {
  return `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=5&language=en`;
}

function buildArchiveUrl(options = {}) {
  const params = new URLSearchParams({
    latitude: String(options.latitude),
    longitude: String(options.longitude),
    start_date: options.startDate,
    end_date: options.endDate,
    timezone: options.timezone || 'auto',
    temperature_unit: 'celsius',
    hourly: [
      'temperature_2m',
      'shortwave_radiation',
      'cloud_cover'
    ].join(','),
    daily: [
      'temperature_2m_max',
      'temperature_2m_min'
    ].join(',')
  });
  return `https://archive-api.open-meteo.com/v1/archive?${params.toString()}`;
}

function assertOk(response, label) {
  if (response && response.ok !== false) {
    return;
  }
  const status = Number(response?.status || 500);
  const error = new Error(`${label} failed with HTTP ${status}`);
  error.status = status;
  throw error;
}

function createHistoricalWeatherService(deps = {}) {
  const fetchImpl = deps.fetchImpl || defaultFetch;
  const logger = deps.logger || console;

  async function resolvePlace(place = DEFAULT_PLACE) {
    const requestedPlace = String(place || DEFAULT_PLACE).trim() || DEFAULT_PLACE;

    if (!requestedPlace) {
      return { ...DEFAULT_COORDS, query: DEFAULT_PLACE };
    }

    const response = await fetchImpl(buildGeocodeUrl(requestedPlace));
    assertOk(response, 'Open-Meteo geocoding');
    const payload = await response.json();
    const matches = Array.isArray(payload?.results) ? payload.results : [];
    const selected = matches[0];

    if (!selected) {
      logger.warn?.('[HistoricalWeather] No geocoding match for place:', requestedPlace);
      return {
        ...DEFAULT_COORDS,
        query: requestedPlace
      };
    }

    return {
      query: requestedPlace,
      latitude: Number(selected.latitude),
      longitude: Number(selected.longitude),
      resolvedName: selected.name || requestedPlace,
      country: selected.country || selected.country_code || null,
      timezone: selected.timezone || 'Australia/Sydney',
      fallback: false
    };
  }

  async function getHistoricalWeather(options = {}) {
    const startDate = normalizeDateOnly(options.startDate);
    const endDate = normalizeDateOnly(options.endDate);
    if (!startDate || !endDate) {
      throw new Error('Historical weather requires startDate and endDate in YYYY-MM-DD format');
    }

    const place = await resolvePlace(options.place || DEFAULT_PLACE);
    const timezone = String(options.timezone || place.timezone || 'Australia/Sydney').trim() || 'Australia/Sydney';
    const response = await fetchImpl(buildArchiveUrl({
      latitude: place.latitude,
      longitude: place.longitude,
      startDate,
      endDate,
      timezone
    }));
    assertOk(response, 'Open-Meteo archive');
    const payload = await response.json();

    return {
      errno: 0,
      result: {
        source: 'open-meteo-archive',
        place: {
          query: place.query,
          resolvedName: place.resolvedName,
          country: place.country,
          latitude: place.latitude,
          longitude: place.longitude,
          timezone: payload?.timezone || timezone,
          fallback: place.fallback === true
        },
        hourly: normalizeCloudCoverFields(payload?.hourly || {}),
        daily: payload?.daily || {}
      }
    };
  }

  return {
    getHistoricalWeather,
    resolvePlace
  };
}

module.exports = {
  createHistoricalWeatherService,
  normalizeCloudCoverFields,
  normalizeDateOnly
};
