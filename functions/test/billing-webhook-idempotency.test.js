'use strict';

const {
  buildBillingEventRecord,
  buildWebhookEventKey,
  mergeEventRecords,
  shouldProcessEvent
} = require('../lib/billing/webhook-idempotency');

describe('billing webhook idempotency', () => {
  test('buildWebhookEventKey normalizes provider and event id', () => {
    const key = buildWebhookEventKey('Stripe API', 'evt_ABC-123');
    expect(key).toBe('stripe_api__evt_abc-123');
  });

  test('buildBillingEventRecord constructs deterministic record', () => {
    const record = buildBillingEventRecord({
      provider: 'stripe',
      eventId: 'evt_1',
      eventType: 'renewal_succeeded',
      occurredAtMs: 1700000000000
    }, { receivedAtMs: 1700000001000, processingStatus: 'processed' });

    expect(record).toEqual({
      key: 'stripe__evt_1',
      provider: 'stripe',
      eventId: 'evt_1',
      eventType: 'renewal_succeeded',
      occurredAtMs: 1700000000000,
      receivedAtMs: 1700000001000,
      processingStatus: 'processed',
      attemptCount: 1,
      lastError: null
    });
  });

  test('shouldProcessEvent rejects stale duplicate when already processed', () => {
    const existing = {
      occurredAtMs: 1700000005000,
      processingStatus: 'processed'
    };
    const incoming = {
      occurredAtMs: 1700000005000,
      processingStatus: 'processed'
    };

    expect(shouldProcessEvent(existing, incoming)).toBe(false);
  });

  test('shouldProcessEvent accepts retry when previous attempt failed', () => {
    const existing = {
      occurredAtMs: 1700000005000,
      processingStatus: 'failed'
    };
    const incoming = {
      occurredAtMs: 1700000005000,
      processingStatus: 'processing'
    };

    expect(shouldProcessEvent(existing, incoming)).toBe(true);
  });

  test('mergeEventRecords keeps latest processable event and retains prior status', () => {
    const existing = {
      occurredAtMs: 1700000005000,
      processingStatus: 'failed',
      attemptCount: 1
    };
    const incoming = {
      occurredAtMs: 1700000005000,
      processingStatus: 'processed',
      attemptCount: 2
    };

    const merged = mergeEventRecords(existing, incoming);
    expect(merged.processingStatus).toBe('processed');
    expect(merged.previousStatus).toBe('failed');
    expect(merged.attemptCount).toBe(2);
  });
});
