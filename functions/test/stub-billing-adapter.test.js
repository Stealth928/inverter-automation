'use strict';

const { StubBillingAdapter, validatePaymentAdapter } = require('../lib/adapters/stub-billing-adapter');

// ---------------------------------------------------------------------------
// 1 — Contract compliance
// ---------------------------------------------------------------------------

describe('StubBillingAdapter — PaymentAdapter contract', () => {
  test('passes validatePaymentAdapter', () => {
    expect(validatePaymentAdapter(new StubBillingAdapter())).toBe(true);
  });

  test('exposes all 5 required contract methods', () => {
    const adapter = new StubBillingAdapter();
    expect(typeof adapter.createCheckoutSession).toBe('function');
    expect(typeof adapter.getSubscription).toBe('function');
    expect(typeof adapter.cancelSubscription).toBe('function');
    expect(typeof adapter.parseWebhookEvent).toBe('function');
    expect(typeof adapter.normalizeProviderError).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// 2 — createCheckoutSession
// ---------------------------------------------------------------------------

describe('StubBillingAdapter — createCheckoutSession', () => {
  test('creates a WEEKLY session', async () => {
    const adapter = new StubBillingAdapter();
    const session = await adapter.createCheckoutSession({ userId: 'u1' }, 'pro', 'WEEKLY');
    expect(session.cadence).toBe('WEEKLY');
    expect(session.planCode).toBe('pro');
    expect(session.sessionId).toMatch(/^sess_/);
    expect(session.checkoutUrl).toContain(session.sessionId);
    expect(typeof session.expiresAtMs).toBe('number');
  });

  test('creates a MONTHLY session', async () => {
    const adapter = new StubBillingAdapter();
    const session = await adapter.createCheckoutSession({ userId: 'u1' }, 'basic', 'MONTHLY');
    expect(session.cadence).toBe('MONTHLY');
  });

  test('accepts cadence aliases (lowercase, week, month)', async () => {
    const adapter = new StubBillingAdapter();
    const weekly = await adapter.createCheckoutSession({}, 'plan', 'weekly');
    const monthly = await adapter.createCheckoutSession({}, 'plan', 'month');
    expect(weekly.cadence).toBe('WEEKLY');
    expect(monthly.cadence).toBe('MONTHLY');
  });

  test('throws on unsupported cadence', async () => {
    const adapter = new StubBillingAdapter();
    await expect(adapter.createCheckoutSession({}, 'plan', 'daily')).rejects.toThrow(/Unsupported billing cadence/);
  });

  test('throws when planCode is missing', async () => {
    const adapter = new StubBillingAdapter();
    await expect(adapter.createCheckoutSession({}, '', 'MONTHLY')).rejects.toThrow(/planCode is required/);
  });
});

// ---------------------------------------------------------------------------
// 3 — getSubscription
// ---------------------------------------------------------------------------

describe('StubBillingAdapter — getSubscription', () => {
  test('returns null for unknown subscription', async () => {
    const adapter = new StubBillingAdapter();
    const result = await adapter.getSubscription({}, 'sub_unknown');
    expect(result).toBeNull();
  });

  test('returns null for empty subscriptionId', async () => {
    const adapter = new StubBillingAdapter();
    expect(await adapter.getSubscription({}, null)).toBeNull();
    expect(await adapter.getSubscription({}, '')).toBeNull();
  });

  test('returns seeded subscription by id', async () => {
    const adapter = new StubBillingAdapter();
    const seeded = adapter.seedSubscription({ subscriptionId: 'sub_123', planCode: 'pro', cadence: 'WEEKLY' });
    const result = await adapter.getSubscription({}, 'sub_123');
    expect(result.subscriptionId).toBe('sub_123');
    expect(result.cadence).toBe('WEEKLY');
    expect(result.state).toBe('active');
    expect(result.currentPeriodEndMs).toBeGreaterThan(seeded.currentPeriodStartMs);
  });

  test('returned object is a copy (not the internal reference)', async () => {
    const adapter = new StubBillingAdapter();
    adapter.seedSubscription({ subscriptionId: 'sub_copy', state: 'active' });
    const a = await adapter.getSubscription({}, 'sub_copy');
    const b = await adapter.getSubscription({}, 'sub_copy');
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// 4 — cancelSubscription
// ---------------------------------------------------------------------------

describe('StubBillingAdapter — cancelSubscription', () => {
  test('cancels at period end by default', async () => {
    const adapter = new StubBillingAdapter();
    const seeded = adapter.seedSubscription({ subscriptionId: 'sub_c1', cadence: 'MONTHLY' });
    const result = await adapter.cancelSubscription({}, 'sub_c1');
    expect(result.state).toBe('canceled');
    expect(result.effectiveAtMs).toBe(seeded.currentPeriodEndMs);
    expect(typeof result.canceledAtMs).toBe('number');
  });

  test('cancels immediately when immediately:true', async () => {
    const adapter = new StubBillingAdapter();
    adapter.seedSubscription({ subscriptionId: 'sub_c2', cadence: 'WEEKLY' });
    const before = Date.now();
    const result = await adapter.cancelSubscription({}, 'sub_c2', { immediately: true });
    const after = Date.now();
    expect(result.state).toBe('canceled');
    expect(result.effectiveAtMs).toBeGreaterThanOrEqual(before);
    expect(result.effectiveAtMs).toBeLessThanOrEqual(after);
  });

  test('subscription state is persisted after cancel', async () => {
    const adapter = new StubBillingAdapter();
    adapter.seedSubscription({ subscriptionId: 'sub_c3' });
    await adapter.cancelSubscription({}, 'sub_c3', { immediately: true });
    const sub = await adapter.getSubscription({}, 'sub_c3');
    expect(sub.state).toBe('canceled');
  });

  test('throws on missing subscriptionId', async () => {
    const adapter = new StubBillingAdapter();
    await expect(adapter.cancelSubscription({}, '')).rejects.toThrow(/subscriptionId is required/);
  });

  test('throws when subscription does not exist', async () => {
    const adapter = new StubBillingAdapter();
    await expect(adapter.cancelSubscription({}, 'sub_nope')).rejects.toThrow(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// 5 — parseWebhookEvent
// ---------------------------------------------------------------------------

describe('StubBillingAdapter — parseWebhookEvent', () => {
  test('normalizes a renewal_succeeded event', async () => {
    const adapter = new StubBillingAdapter();
    const event = await adapter.parseWebhookEvent({
      id: 'evt_1',
      type: 'invoice.payment_succeeded',
      provider: 'stripe',
      subscriptionId: 'sub_w1',
      customerId: 'cus_1'
    });
    expect(event.eventType).toBe('renewal_succeeded');
    expect(event.eventId).toBe('evt_1');
    expect(event.provider).toBe('stripe');
  });

  test('checkout_completed auto-creates WEEKLY subscription', async () => {
    const adapter = new StubBillingAdapter();
    // First create a session
    const session = await adapter.createCheckoutSession({ userId: 'u1' }, 'pro', 'WEEKLY');

    await adapter.parseWebhookEvent({
      id: 'evt_checkout',
      type: 'checkout.session.completed',
      sessionId: session.sessionId,
      subscriptionId: 'sub_new_1',
      customerId: 'cus_abc',
      provider: 'stub'
    });

    const sub = await adapter.getSubscription({}, 'sub_new_1');
    expect(sub).not.toBeNull();
    expect(sub.state).toBe('active');
    expect(sub.cadence).toBe('WEEKLY');
  });

  test('checkout_completed auto-creates MONTHLY subscription', async () => {
    const adapter = new StubBillingAdapter();
    await adapter.createCheckoutSession({ userId: 'u1' }, 'basic', 'MONTHLY');

    await adapter.parseWebhookEvent({
      id: 'evt_m',
      type: 'checkout.session.completed',
      subscriptionId: 'sub_monthly_1',
      customerId: 'cus_m',
      provider: 'stub'
    });

    const sub = await adapter.getSubscription({}, 'sub_monthly_1');
    expect(sub.cadence).toBe('MONTHLY');
  });

  test('throws on unsupported event type', async () => {
    const adapter = new StubBillingAdapter();
    await expect(adapter.parseWebhookEvent({ id: 'e1', type: 'unknown_event' })).rejects.toThrow(/Unsupported billing event type/);
  });

  test('throws when eventId is missing', async () => {
    const adapter = new StubBillingAdapter();
    await expect(adapter.parseWebhookEvent({ type: 'invoice.payment_succeeded' })).rejects.toThrow(/missing eventId/i);
  });

  test('all events are logged to internal webhook log', async () => {
    const adapter = new StubBillingAdapter();
    await adapter.parseWebhookEvent({ id: 'evtA', type: 'charge.refunded', provider: 'stub' });
    await adapter.parseWebhookEvent({ id: 'evtB', type: 'invoice.payment_failed', provider: 'stub' });
    expect(adapter._webhookLog).toHaveLength(2);
    expect(adapter._webhookLog[0].eventType).toBe('refund');
    expect(adapter._webhookLog[1].eventType).toBe('renewal_failed');
  });
});

// ---------------------------------------------------------------------------
// 6 — normalizeProviderError
// ---------------------------------------------------------------------------

describe('StubBillingAdapter — normalizeProviderError', () => {
  test('returns canonical billing error envelope', () => {
    const adapter = new StubBillingAdapter();
    const result = adapter.normalizeProviderError(new Error('card declined'));
    expect(result).toEqual({ errno: 3600, error: 'card declined', provider: 'stub' });
  });

  test('handles null error gracefully', () => {
    const adapter = new StubBillingAdapter();
    const result = adapter.normalizeProviderError(null);
    expect(result.errno).toBe(3600);
    expect(typeof result.error).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// 7 — G4 criterion #6 explicit proof
// ---------------------------------------------------------------------------

describe('G4 criterion #6 — billing adapter supports weekly and monthly subscriptions', () => {
  test('full weekly subscription lifecycle: create → event → cancel', async () => {
    const adapter = new StubBillingAdapter();

    // Step 1: merchant creates a checkout session
    const session = await adapter.createCheckoutSession({ userId: 'user_w' }, 'pro', 'WEEKLY');
    expect(session.cadence).toBe('WEEKLY');

    // Step 2: user completes checkout (webhook fires)
    await adapter.parseWebhookEvent({
      id: 'evt_w1',
      type: 'checkout.session.completed',
      sessionId: session.sessionId,
      subscriptionId: 'sub_weekly',
      customerId: 'cus_w',
      provider: 'stub'
    });

    const sub = await adapter.getSubscription({}, 'sub_weekly');
    expect(sub.state).toBe('active');
    expect(sub.cadence).toBe('WEEKLY');
    // period end should be ~7 days from now
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(sub.currentPeriodEndMs - sub.currentPeriodStartMs).toBeGreaterThanOrEqual(sevenDaysMs - 1000);
    expect(sub.currentPeriodEndMs - sub.currentPeriodStartMs).toBeLessThanOrEqual(sevenDaysMs + 1000);

    // Step 3: cancel at period end
    const cancelResult = await adapter.cancelSubscription({}, 'sub_weekly');
    expect(cancelResult.state).toBe('canceled');
    expect(cancelResult.effectiveAtMs).toBe(sub.currentPeriodEndMs);
  });

  test('full monthly subscription lifecycle: create → event → cancel immediately', async () => {
    const adapter = new StubBillingAdapter();

    const session = await adapter.createCheckoutSession({ userId: 'user_m' }, 'basic', 'MONTHLY');
    expect(session.cadence).toBe('MONTHLY');

    await adapter.parseWebhookEvent({
      id: 'evt_m1',
      type: 'checkout.session.completed',
      sessionId: session.sessionId,
      subscriptionId: 'sub_monthly',
      customerId: 'cus_m',
      provider: 'stub'
    });

    const sub = await adapter.getSubscription({}, 'sub_monthly');
    expect(sub.state).toBe('active');
    expect(sub.cadence).toBe('MONTHLY');

    const cancelResult = await adapter.cancelSubscription({}, 'sub_monthly', { immediately: true });
    expect(cancelResult.state).toBe('canceled');
    expect(cancelResult.effectiveAtMs).toBeLessThanOrEqual(cancelResult.canceledAtMs + 100);
  });
});
