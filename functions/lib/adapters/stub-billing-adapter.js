'use strict';

/**
 * Stub Billing Adapter
 *
 * A concrete in-memory implementation of the PaymentAdapter contract that
 * supports weekly and monthly billing cadences. This serves as:
 *   - The G4 exit criterion #6 implementation artifact proving the contract
 *     is implementable for weekly/monthly subscriptions.
 *   - A test double for integration tests that need a real PaymentAdapter.
 *   - A reference implementation for future Stripe/payment-provider wiring.
 *
 * Persistence: in-memory only (Map). Not suitable for production use.
 */

const {
  PaymentAdapter,
  normalizeBillingCadence,
  normalizeBillingEvent,
  normalizeSubscriptionState,
  validatePaymentAdapter
} = require('./payment-adapter');

const STUB_PROVIDER_NAME = 'stub';

function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowMs() {
  return Date.now();
}

/**
 * Calculate next renewal epoch for a cadence from a given startMs.
 */
function nextRenewalMs(startMs, cadence) {
  const d = new Date(startMs);
  if (cadence === 'WEEKLY') {
    d.setDate(d.getDate() + 7);
  } else {
    // MONTHLY
    d.setMonth(d.getMonth() + 1);
  }
  return d.getTime();
}

class StubBillingAdapter extends PaymentAdapter {
  constructor() {
    super();
    // In-memory stores
    this._sessions = new Map();    // sessionId → session record
    this._subscriptions = new Map(); // subscriptionId → subscription record
    this._webhookLog = [];
  }

  /**
   * Create a checkout session for the given plan/cadence.
   *
   * @param {object} context  — { userId, userEmail? }
   * @param {string} planCode — e.g. 'basic', 'pro'
   * @param {string} cadence  — 'WEEKLY' | 'MONTHLY' (or casing variants)
   * @returns {{ sessionId, checkoutUrl, cadence, planCode, expiresAtMs }}
   */
  async createCheckoutSession(context = {}, planCode = 'basic', cadence = 'MONTHLY') {
    const normalizedCadence = normalizeBillingCadence(cadence);
    if (!normalizedCadence) {
      throw new Error(`Unsupported billing cadence: ${cadence}. Must be WEEKLY or MONTHLY.`);
    }

    if (!planCode || typeof planCode !== 'string' || !planCode.trim()) {
      throw new Error('planCode is required');
    }

    const sessionId = generateId('sess');
    const now = nowMs();
    const session = {
      sessionId,
      userId: context.userId || null,
      userEmail: context.userEmail || null,
      planCode: planCode.trim().toLowerCase(),
      cadence: normalizedCadence,
      checkoutUrl: `https://stub.billing/checkout/${sessionId}`,
      createdAtMs: now,
      expiresAtMs: now + 30 * 60 * 1000, // 30-minute session window
      status: 'pending'
    };

    this._sessions.set(sessionId, session);

    return {
      sessionId,
      checkoutUrl: session.checkoutUrl,
      cadence: normalizedCadence,
      planCode: session.planCode,
      expiresAtMs: session.expiresAtMs
    };
  }

  /**
   * Retrieve a subscription by ID.
   *
   * @param {object} context
   * @param {string} subscriptionId
   * @returns {object|null} subscription record or null if not found
   */
  async getSubscription(_context = {}, subscriptionId) {
    if (!subscriptionId) return null;
    const sub = this._subscriptions.get(subscriptionId);
    if (!sub) return null;
    return { ...sub };
  }

  /**
   * Cancel a subscription.
   *
   * @param {object} context
   * @param {string} subscriptionId
   * @param {{ immediately?: boolean }} options — if true, cancels now; else at period end
   * @returns {{ subscriptionId, state, canceledAtMs, effectiveAtMs }}
   */
  async cancelSubscription(_context = {}, subscriptionId, options = {}) {
    if (!subscriptionId) {
      throw new Error('subscriptionId is required');
    }

    const sub = this._subscriptions.get(subscriptionId);
    if (!sub) {
      throw new Error(`Subscription not found: ${subscriptionId}`);
    }

    const now = nowMs();
    const cancelAtPeriodEnd = options.immediately !== true;
    const effectiveAtMs = cancelAtPeriodEnd ? sub.currentPeriodEndMs : now;

    sub.state = normalizeSubscriptionState('canceled');
    sub.canceledAtMs = now;
    sub.cancelAtPeriodEnd = cancelAtPeriodEnd;
    sub.effectiveAtMs = effectiveAtMs;

    this._subscriptions.set(subscriptionId, sub);

    return {
      subscriptionId,
      state: sub.state,
      canceledAtMs: now,
      effectiveAtMs
    };
  }

  /**
   * Parse and normalize an incoming webhook payload.
   * Simulates provider-event ingestion using normalizeBillingEvent.
   *
   * @param {{ body: object, headers?: object }} rawRequest
   * @returns normalized billing event object
   */
  async parseWebhookEvent(rawRequest = {}) {
    const body = rawRequest.body || rawRequest;

    const event = normalizeBillingEvent(body);

    // Side-effect: if checkout_completed, auto-create a subscription record
    if (event.eventType === 'checkout_completed' && event.subscriptionId) {
      const sessionRecord = [...this._sessions.values()].find(
        (s) => s.status === 'pending' && (s.sessionId === body.sessionId || !body.sessionId)
      );

      const cadence = sessionRecord?.cadence || 'MONTHLY';
      const now = nowMs();

      if (!this._subscriptions.has(event.subscriptionId)) {
        this._subscriptions.set(event.subscriptionId, {
          subscriptionId: event.subscriptionId,
          customerId: event.customerId,
          planCode: sessionRecord?.planCode || 'basic',
          cadence,
          state: normalizeSubscriptionState('active'),
          currentPeriodStartMs: now,
          currentPeriodEndMs: nextRenewalMs(now, cadence),
          createdAtMs: now
        });
      }
    }

    this._webhookLog.push(event);
    return event;
  }

  /**
   * Normalize a provider error into a canonical billing error envelope.
   */
  normalizeProviderError(error) {
    const message = (error && error.message) ? error.message : String(error || 'Billing error');
    return {
      errno: 3600,
      error: message,
      provider: STUB_PROVIDER_NAME
    };
  }

  // ---------------------------------------------------------------------------
  // Test/simulation helpers (not part of the PaymentAdapter contract)
  // ---------------------------------------------------------------------------

  /**
   * Directly insert a subscription (for test setup / simulation).
   */
  seedSubscription(sub = {}) {
    const id = sub.subscriptionId || generateId('sub');
    const now = nowMs();
    const cadence = normalizeBillingCadence(sub.cadence) || 'MONTHLY';
    const record = {
      subscriptionId: id,
      customerId: sub.customerId || null,
      planCode: sub.planCode || 'basic',
      cadence,
      state: normalizeSubscriptionState(sub.state || 'active'),
      currentPeriodStartMs: sub.currentPeriodStartMs || now,
      currentPeriodEndMs: sub.currentPeriodEndMs || nextRenewalMs(now, cadence),
      createdAtMs: now
    };
    this._subscriptions.set(id, record);
    return record;
  }
}

module.exports = {
  StubBillingAdapter,
  validatePaymentAdapter
};
