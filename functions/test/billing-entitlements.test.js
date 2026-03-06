'use strict';

const {
  deriveEntitlementFromSubscription,
  hasFeatureAccess,
  isEntitlementActive,
  mapSubscriptionStateToEntitlementState
} = require('../lib/billing/entitlements');

describe('billing entitlements', () => {
  test('maps past_due to grace_period when inside grace window', () => {
    const nowMs = 1700000000000;
    const periodEndMs = nowMs - 1000;
    const gracePeriodMs = 5 * 60 * 1000;

    const status = mapSubscriptionStateToEntitlementState('past_due', {
      nowMs,
      periodEndMs,
      gracePeriodMs
    });

    expect(status).toBe('grace_period');
  });

  test('derives entitlement from active monthly subscription', () => {
    const entitlement = deriveEntitlementFromSubscription({
      userId: 'user_1',
      subscriptionId: 'sub_1',
      planCode: 'pro',
      cadence: 'monthly',
      state: 'active',
      periodStartMs: 1700000000000,
      periodEndMs: 1702592000000,
      features: ['automation_core', 'advanced_rules', 'advanced_rules']
    }, { nowMs: 1700100000000 });

    expect(entitlement.status).toBe('active');
    expect(entitlement.cadence).toBe('MONTHLY');
    expect(entitlement.features).toEqual(['advanced_rules', 'automation_core']);
    expect(isEntitlementActive(entitlement, 1700100000000)).toBe(true);
    expect(hasFeatureAccess(entitlement, 'advanced_rules', 1700100000000)).toBe(true);
  });

  test('marks canceled when cancelAtPeriodEnd has elapsed', () => {
    const entitlement = deriveEntitlementFromSubscription({
      userId: 'user_2',
      subscriptionId: 'sub_2',
      planCode: 'starter',
      cadence: 'weekly',
      state: 'active',
      periodStartMs: 1700000000000,
      periodEndMs: 1700500000000,
      cancelAtPeriodEnd: true,
      features: ['automation_core']
    }, { nowMs: 1700600000000 });

    expect(entitlement.cadence).toBe('WEEKLY');
    expect(entitlement.status).toBe('canceled');
    expect(isEntitlementActive(entitlement, 1700600000000)).toBe(false);
    expect(hasFeatureAccess(entitlement, 'automation_core', 1700600000000)).toBe(false);
  });

  test('grace entitlement remains active until graceUntilMs', () => {
    const nowMs = 1700000000000;
    const entitlement = deriveEntitlementFromSubscription({
      userId: 'user_3',
      subscriptionId: 'sub_3',
      planCode: 'pro',
      cadence: 'monthly',
      state: 'past_due',
      periodStartMs: 1697408000000,
      periodEndMs: nowMs - 1000,
      features: ['automation_core']
    }, {
      nowMs,
      gracePeriodMs: 10 * 60 * 1000
    });

    expect(entitlement.status).toBe('grace_period');
    expect(isEntitlementActive(entitlement, nowMs)).toBe(true);
    expect(isEntitlementActive(entitlement, entitlement.graceUntilMs + 1)).toBe(false);
  });

  test('feature access requires active entitlement and included feature', () => {
    const entitlement = {
      status: 'active',
      graceUntilMs: null,
      features: ['automation_core']
    };

    expect(hasFeatureAccess(entitlement, 'automation_core')).toBe(true);
    expect(hasFeatureAccess(entitlement, 'billing_admin')).toBe(false);
    expect(hasFeatureAccess({ ...entitlement, status: 'past_due' }, 'automation_core')).toBe(false);
  });
});
