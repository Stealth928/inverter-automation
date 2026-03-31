'use strict';

const MARKET_AU = 'AU';
const MARKET_DE = 'DE';

const PRICING_PROVIDER_AMBER = 'amber';
const PRICING_PROVIDER_AEMO = 'aemo';
const PRICING_PROVIDER_GERMANY_MARKET_DATA = 'germany-market-data';

const DEFAULT_MARKET = MARKET_AU;
const DEFAULT_PRICING_PROVIDER = PRICING_PROVIDER_AMBER;
const DEFAULT_AEMO_REGION = 'NSW1';
const DEFAULT_GERMANY_MARKET_ID = 'DE';

const SUPPORTED_AEMO_REGIONS = new Set(['NSW1', 'QLD1', 'VIC1', 'SA1', 'TAS1']);
const PUBLIC_MARKET_PROVIDERS = new Set([
  PRICING_PROVIDER_AEMO,
  PRICING_PROVIDER_GERMANY_MARKET_DATA
]);

function trimLower(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeMarket(value, fallback = DEFAULT_MARKET) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === MARKET_DE || raw === 'GERMANY') return MARKET_DE;
  if (raw === MARKET_AU || raw === 'AUSTRALIA') return MARKET_AU;
  return fallback;
}

function inferMarketFromProvider(provider, fallback = DEFAULT_MARKET) {
  return trimLower(provider) === PRICING_PROVIDER_GERMANY_MARKET_DATA ? MARKET_DE : fallback;
}

function inferPricingProviderFromConfig(config = {}, fallback = DEFAULT_PRICING_PROVIDER) {
  const raw = trimLower(config?.pricingProvider || config?.pricing_provider);
  if (raw === PRICING_PROVIDER_AEMO) return PRICING_PROVIDER_AEMO;
  if (raw === PRICING_PROVIDER_GERMANY_MARKET_DATA) return PRICING_PROVIDER_GERMANY_MARKET_DATA;
  if (raw === PRICING_PROVIDER_AMBER) return PRICING_PROVIDER_AMBER;

  if (normalizeMarket(config?.market || config?.pricingMarket, null) === MARKET_DE) {
    return PRICING_PROVIDER_GERMANY_MARKET_DATA;
  }

  const aemoRegion = String(config?.aemoRegion || config?.aemo_region || config?.siteIdOrRegion || '').trim().toUpperCase();
  if (SUPPORTED_AEMO_REGIONS.has(aemoRegion)) {
    return PRICING_PROVIDER_AEMO;
  }

  return fallback;
}

function inferMarketFromConfig(config = {}, fallback = DEFAULT_MARKET) {
  const explicitMarket = normalizeMarket(config?.market || config?.pricingMarket, null);
  if (explicitMarket) return explicitMarket;
  return inferMarketFromProvider(inferPricingProviderFromConfig(config, DEFAULT_PRICING_PROVIDER), fallback);
}

function normalizePricingProvider(value, market = DEFAULT_MARKET) {
  const normalizedMarket = normalizeMarket(market, DEFAULT_MARKET);
  const raw = trimLower(value);

  if (normalizedMarket === MARKET_DE) {
    return PRICING_PROVIDER_GERMANY_MARKET_DATA;
  }

  return raw === PRICING_PROVIDER_AEMO ? PRICING_PROVIDER_AEMO : PRICING_PROVIDER_AMBER;
}

function normalizeAemoRegion(value) {
  const normalized = String(value || DEFAULT_AEMO_REGION).trim().toUpperCase();
  return SUPPORTED_AEMO_REGIONS.has(normalized) ? normalized : DEFAULT_AEMO_REGION;
}

function normalizePricingSelectionInput(payload = {}, existingConfig = null) {
  const requestedProvider = inferPricingProviderFromConfig(payload, inferPricingProviderFromConfig(existingConfig));
  const requestedMarket = normalizeMarket(
    payload?.market || payload?.pricingMarket || existingConfig?.market,
    inferMarketFromProvider(requestedProvider)
  );
  const pricingProvider = normalizePricingProvider(requestedProvider, requestedMarket);
  const market = normalizeMarket(payload?.market || payload?.pricingMarket, inferMarketFromProvider(pricingProvider));

  if (pricingProvider === PRICING_PROVIDER_AEMO) {
    const aemoRegion = normalizeAemoRegion(
      payload?.aemoRegion
      || payload?.aemo_region
      || payload?.regionId
      || payload?.siteId
      || payload?.siteIdOrRegion
      || existingConfig?.aemoRegion
      || existingConfig?.siteIdOrRegion
    );
    return {
      market,
      pricingProvider,
      aemoRegion,
      siteIdOrRegion: aemoRegion
    };
  }

  if (pricingProvider === PRICING_PROVIDER_GERMANY_MARKET_DATA) {
    return {
      market,
      pricingProvider,
      siteIdOrRegion: DEFAULT_GERMANY_MARKET_ID
    };
  }

  return {
    market,
    pricingProvider
  };
}

function isPublicMarketPricingProvider(provider) {
  return PUBLIC_MARKET_PROVIDERS.has(trimLower(provider));
}

function getDefaultPricingSelection(provider) {
  const normalizedProvider = trimLower(provider);
  if (normalizedProvider === PRICING_PROVIDER_AEMO) return DEFAULT_AEMO_REGION;
  if (normalizedProvider === PRICING_PROVIDER_GERMANY_MARKET_DATA) return DEFAULT_GERMANY_MARKET_ID;
  return null;
}

function listSupportedPricingProvidersForMarket(market = DEFAULT_MARKET) {
  const normalizedMarket = normalizeMarket(market, DEFAULT_MARKET);
  if (normalizedMarket === MARKET_DE) {
    return [PRICING_PROVIDER_GERMANY_MARKET_DATA];
  }
  return [PRICING_PROVIDER_AMBER, PRICING_PROVIDER_AEMO];
}

module.exports = {
  DEFAULT_AEMO_REGION,
  DEFAULT_GERMANY_MARKET_ID,
  DEFAULT_MARKET,
  DEFAULT_PRICING_PROVIDER,
  MARKET_AU,
  MARKET_DE,
  PRICING_PROVIDER_AEMO,
  PRICING_PROVIDER_AMBER,
  PRICING_PROVIDER_GERMANY_MARKET_DATA,
  PUBLIC_MARKET_PROVIDERS,
  SUPPORTED_AEMO_REGIONS,
  getDefaultPricingSelection,
  inferMarketFromConfig,
  inferMarketFromProvider,
  inferPricingProviderFromConfig,
  isPublicMarketPricingProvider,
  listSupportedPricingProvidersForMarket,
  normalizeAemoRegion,
  normalizeMarket,
  normalizePricingProvider,
  normalizePricingSelectionInput
};