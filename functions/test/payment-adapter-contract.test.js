'use strict';

const {
  PaymentAdapter,
  normalizeBillingCadence,
  normalizeBillingEvent,
  normalizeBillingEventType,
  normalizeSubscriptionState,
  validatePaymentAdapter
} = require('../lib/adapters/payment-adapter');

describe('payment-adapter contract helpers', () => {
  test('normalizeBillingCadence supports weekly and monthly aliases', () => {
    expect(normalizeBillingCadence('weekly')).toBe('WEEKLY');
    expect(normalizeBillingCadence('WEEK')).toBe('WEEKLY');
    expect(normalizeBillingCadence('monthly_plan')).toBe('MONTHLY');
    expect(normalizeBillingCadence('daily')).toBeNull();
  });

  test('normalizeSubscriptionState handles common provider values', () => {
    expect(normalizeSubscriptionState('active')).toBe('active');
    expect(normalizeSubscriptionState('trialing')).toBe('active');
    expect(normalizeSubscriptionState('unpaid')).toBe('past_due');
    expect(normalizeSubscriptionState('incomplete_expired')).toBe('canceled');
    expect(normalizeSubscriptionState(null)).toBe('incomplete');
  });

  test('normalizeBillingEventType maps provider aliases to canonical types', () => {
    expect(normalizeBillingEventType('checkout.session.completed')).toBe('checkout_completed');
    expect(normalizeBillingEventType('invoice.payment_succeeded')).toBe('renewal_succeeded');
    expect(normalizeBillingEventType('invoice.payment_failed')).toBe('renewal_failed');
    expect(normalizeBillingEventType('customer.subscription.deleted')).toBe('canceled');
    expect(normalizeBillingEventType('charge.refunded')).toBe('refund');
    expect(normalizeBillingEventType('something_else')).toBeNull();
  });

  test('normalizeBillingEvent validates and normalizes shape', () => {
    const normalized = normalizeBillingEvent({
      id: 'evt_123',
      type: 'invoice.payment_succeeded',
      provider: 'Stripe',
      occurredAtMs: 1700000000000,
      subscriptionId: 'sub_123',
      customerId: 'cus_123',
      payload: { amount: 1099 }
    });

    expect(normalized).toEqual({
      eventId: 'evt_123',
      eventType: 'renewal_succeeded',
      occurredAtMs: 1700000000000,
      provider: 'stripe',
      subscriptionId: 'sub_123',
      customerId: 'cus_123',
      payload: { amount: 1099 }
    });
  });

  test('normalizeBillingEvent throws on invalid event payload', () => {
    expect(() => normalizeBillingEvent({ type: 'invoice.payment_succeeded' })).toThrow(/missing eventId/i);
    expect(() => normalizeBillingEvent({ id: 'evt_x', type: 'unknown_type' })).toThrow(/Unsupported billing event type/i);
  });

  test('validatePaymentAdapter enforces method contract', () => {
    expect(() => validatePaymentAdapter({ createCheckoutSession() {} })).toThrow(/missing required methods/i);

    class DemoPaymentAdapter extends PaymentAdapter {
      async createCheckoutSession() { return {}; }
      async getSubscription() { return {}; }
      async cancelSubscription() { return {}; }
      async parseWebhookEvent() { return {}; }
      normalizeProviderError(error) { return { errno: 3600, error: error.message }; }
    }

    expect(validatePaymentAdapter(new DemoPaymentAdapter())).toBe(true);
  });

  test('base PaymentAdapter normalizeProviderError returns billing errno', () => {
    const adapter = new PaymentAdapter();
    const result = adapter.normalizeProviderError(new Error('No payment method'));
    expect(result).toEqual({ errno: 3600, error: 'No payment method' });
  });
});
