'use strict';

const SUPPORTED_BILLING_CADENCES = Object.freeze(['WEEKLY', 'MONTHLY']);
const SUPPORTED_SUBSCRIPTION_STATES = Object.freeze([
  'active',
  'grace_period',
  'past_due',
  'canceled',
  'incomplete'
]);

const CANONICAL_BILLING_EVENT_TYPES = Object.freeze([
  'checkout_completed',
  'renewal_succeeded',
  'renewal_failed',
  'canceled',
  'refund'
]);

const BILLING_EVENT_TYPE_ALIASES = Object.freeze({
  checkout_completed: ['checkout_completed', 'checkout.session.completed', 'subscription_created', 'customer.subscription.created'],
  renewal_succeeded: ['renewal_succeeded', 'invoice.payment_succeeded', 'renewal.success'],
  renewal_failed: ['renewal_failed', 'invoice.payment_failed', 'renewal.failed'],
  canceled: ['canceled', 'subscription.canceled', 'customer.subscription.deleted'],
  refund: ['refund', 'charge.refunded', 'refund.created']
});

function normalizeBillingCadence(cadence) {
  if (!cadence || typeof cadence !== 'string') {
    return null;
  }

  const normalized = cadence.trim().toUpperCase();
  if (SUPPORTED_BILLING_CADENCES.includes(normalized)) {
    return normalized;
  }

  if (normalized === 'WEEK' || normalized === 'WEEKLY_PLAN') {
    return 'WEEKLY';
  }

  if (normalized === 'MONTH' || normalized === 'MONTHLY_PLAN') {
    return 'MONTHLY';
  }

  return null;
}

function normalizeSubscriptionState(state) {
  if (!state || typeof state !== 'string') {
    return 'incomplete';
  }

  const normalized = state.trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');

  if (SUPPORTED_SUBSCRIPTION_STATES.includes(normalized)) {
    return normalized;
  }

  if (normalized === 'trialing') {
    return 'active';
  }

  if (normalized === 'unpaid') {
    return 'past_due';
  }

  if (normalized === 'incomplete_expired') {
    return 'canceled';
  }

  return 'incomplete';
}

function normalizeBillingEventType(eventType) {
  if (!eventType || typeof eventType !== 'string') {
    return null;
  }

  const normalized = eventType.trim().toLowerCase();

  for (const canonicalType of CANONICAL_BILLING_EVENT_TYPES) {
    const aliases = BILLING_EVENT_TYPE_ALIASES[canonicalType] || [];
    if (aliases.includes(normalized)) {
      return canonicalType;
    }
  }

  return null;
}

function normalizeBillingEvent(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') {
    throw new Error('rawEvent must be an object');
  }

  const eventId = String(rawEvent.eventId || rawEvent.id || '').trim();
  if (!eventId) {
    throw new Error('Billing event is missing eventId');
  }

  const eventType = normalizeBillingEventType(rawEvent.eventType || rawEvent.type);
  if (!eventType) {
    throw new Error(`Unsupported billing event type: ${rawEvent.eventType || rawEvent.type || 'undefined'}`);
  }

  const occurredAtCandidate = Number(rawEvent.occurredAtMs || rawEvent.occurredAt || Date.now());
  const occurredAtMs = Number.isFinite(occurredAtCandidate) && occurredAtCandidate > 0
    ? Math.floor(occurredAtCandidate)
    : Date.now();

  const provider = String(rawEvent.provider || 'unknown').trim().toLowerCase();

  return {
    eventId,
    eventType,
    occurredAtMs,
    provider,
    subscriptionId: rawEvent.subscriptionId || null,
    customerId: rawEvent.customerId || null,
    payload: rawEvent.payload && typeof rawEvent.payload === 'object' ? rawEvent.payload : {}
  };
}

function validatePaymentAdapter(adapter) {
  const requiredMethods = [
    'createCheckoutSession',
    'getSubscription',
    'cancelSubscription',
    'parseWebhookEvent',
    'normalizeProviderError'
  ];

  const missingMethods = requiredMethods.filter((methodName) => !adapter || typeof adapter[methodName] !== 'function');

  if (missingMethods.length > 0) {
    throw new Error(`Payment adapter is missing required methods: ${missingMethods.join(', ')}`);
  }

  return true;
}

class PaymentAdapter {
  async createCheckoutSession(_context, _planCode, _cadence) {
    throw new Error('PaymentAdapter.createCheckoutSession not implemented');
  }

  async getSubscription(_context, _subscriptionId) {
    throw new Error('PaymentAdapter.getSubscription not implemented');
  }

  async cancelSubscription(_context, _subscriptionId, _options) {
    throw new Error('PaymentAdapter.cancelSubscription not implemented');
  }

  async parseWebhookEvent(_rawRequest) {
    throw new Error('PaymentAdapter.parseWebhookEvent not implemented');
  }

  normalizeProviderError(error) {
    return {
      errno: 3600,
      error: error && error.message ? error.message : 'Billing provider error'
    };
  }
}

module.exports = {
  CANONICAL_BILLING_EVENT_TYPES,
  PaymentAdapter,
  SUPPORTED_BILLING_CADENCES,
  SUPPORTED_SUBSCRIPTION_STATES,
  normalizeBillingCadence,
  normalizeBillingEvent,
  normalizeBillingEventType,
  normalizeSubscriptionState,
  validatePaymentAdapter
};
