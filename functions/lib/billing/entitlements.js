'use strict';

const {
  normalizeBillingCadence,
  normalizeSubscriptionState
} = require('../adapters/payment-adapter');

const ENTITLEMENT_STATES = Object.freeze([
  'active',
  'grace_period',
  'past_due',
  'canceled',
  'incomplete',
  'inactive'
]);

function mapSubscriptionStateToEntitlementState(subscriptionState, options = {}) {
  const normalizedState = normalizeSubscriptionState(subscriptionState);
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const periodEndMs = Number.isFinite(Number(options.periodEndMs)) ? Number(options.periodEndMs) : null;
  const gracePeriodMs = Number.isFinite(Number(options.gracePeriodMs)) ? Number(options.gracePeriodMs) : 0;

  if (normalizedState === 'active') {
    return 'active';
  }

  if (normalizedState === 'grace_period') {
    return 'grace_period';
  }

  if (normalizedState === 'past_due') {
    if (periodEndMs && gracePeriodMs > 0 && nowMs <= (periodEndMs + gracePeriodMs)) {
      return 'grace_period';
    }
    return 'past_due';
  }

  if (normalizedState === 'canceled') {
    return 'canceled';
  }

  return 'incomplete';
}

function deriveEntitlementFromSubscription(subscription, options = {}) {
  if (!subscription || typeof subscription !== 'object') {
    throw new Error('subscription must be an object');
  }

  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const gracePeriodMs = Number.isFinite(Number(options.gracePeriodMs))
    ? Math.max(0, Number(options.gracePeriodMs))
    : 0;

  const periodStartMs = Number.isFinite(Number(subscription.periodStartMs)) ? Number(subscription.periodStartMs) : null;
  const periodEndMs = Number.isFinite(Number(subscription.periodEndMs)) ? Number(subscription.periodEndMs) : null;

  const cadence = normalizeBillingCadence(subscription.cadence);
  const subscriptionState = normalizeSubscriptionState(subscription.state);

  let status = mapSubscriptionStateToEntitlementState(subscriptionState, {
    nowMs,
    periodEndMs,
    gracePeriodMs
  });

  if (subscription.cancelAtPeriodEnd === true && periodEndMs && nowMs > periodEndMs) {
    status = 'canceled';
  }

  if (!ENTITLEMENT_STATES.includes(status)) {
    status = 'inactive';
  }

  const features = Array.isArray(subscription.features)
    ? Array.from(new Set(subscription.features.filter((feature) => typeof feature === 'string' && feature.trim()))).sort()
    : [];

  return {
    userId: subscription.userId || null,
    subscriptionId: subscription.subscriptionId || null,
    planCode: subscription.planCode || null,
    cadence,
    subscriptionState,
    status,
    periodStartMs,
    periodEndMs,
    graceUntilMs: periodEndMs && gracePeriodMs > 0 ? periodEndMs + gracePeriodMs : null,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd === true,
    features,
    updatedAtMs: nowMs
  };
}

function isEntitlementActive(entitlement, nowMs = Date.now()) {
  if (!entitlement || typeof entitlement !== 'object') {
    return false;
  }

  if (entitlement.status === 'active') {
    return true;
  }

  if (entitlement.status === 'grace_period') {
    if (!Number.isFinite(Number(entitlement.graceUntilMs))) {
      return true;
    }
    return nowMs <= Number(entitlement.graceUntilMs);
  }

  return false;
}

function hasFeatureAccess(entitlement, featureKey, nowMs = Date.now()) {
  if (typeof featureKey !== 'string' || !featureKey.trim()) {
    return false;
  }

  if (!isEntitlementActive(entitlement, nowMs)) {
    return false;
  }

  const features = Array.isArray(entitlement.features) ? entitlement.features : [];
  return features.includes(featureKey);
}

module.exports = {
  ENTITLEMENT_STATES,
  deriveEntitlementFromSubscription,
  hasFeatureAccess,
  isEntitlementActive,
  mapSubscriptionStateToEntitlementState
};
