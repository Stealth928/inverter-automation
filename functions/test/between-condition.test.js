/**
 * Between Condition Evaluation Tests
 *
 * Validates that the 'between' operator works correctly end-to-end for:
 *  - SoC conditions using both 'op' and 'operator' field names
 *  - Price conditions (price, feedInPrice, buyPrice)
 *  - The value2 != null guard (previously !== undefined caused bugs)
 *  - Edge cases: value2 = null, value2 = 0, boundary values
 *  - The compareValue helper with between + array/object targets
 */

// ─── Replicate the helpers as they exist in index.js ────────────────────────

/**
 * Mirrors the compareValue function in functions/index.js
 */
function compareValue(actual, operator, target) {
  if (actual === null || actual === undefined) return false;
  switch (operator) {
    case '>':  return actual > target;
    case '>=': return actual >= target;
    case '<':  return actual < target;
    case '<=': return actual <= target;
    case '==': return actual == target;
    case '!=': return actual != target;
    case 'between':
      if (Array.isArray(target)) return actual >= target[0] && actual <= target[1];
      if (target && typeof target === 'object') return actual >= (target.min || 0) && actual <= (target.max || 100);
      return false;
    default: return false;
  }
}

/**
 * Mirrors the SoC evaluation block in functions/index.js evaluateRuleConditions()
 */
function evalSoC(soc, condition) {
  if (!condition?.enabled) return null; // not enabled
  if (soc === null) return false;

  const operator = condition.op || condition.operator;
  const value    = condition.value;
  const value2   = condition.value2;

  if (operator === 'between' && value2 != null) {
    return soc >= value && soc <= value2;
  }
  return compareValue(soc, operator, value);
}

/**
 * Mirrors the price evaluation block (conditions.price) in evaluateRuleConditions()
 */
function evalPrice(actualPrice, condition) {
  if (!condition?.enabled) return null;
  if (actualPrice === null) return false;

  const operator = condition.op || condition.operator;
  const value    = condition.value;
  const value2   = condition.value2;

  if (operator === 'between' && value2 != null) {
    return actualPrice >= value && actualPrice <= value2;
  }
  return compareValue(actualPrice, operator, value);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('between condition – compareValue helper', () => {
  test('array target: value inside range returns true', () => {
    expect(compareValue(50, 'between', [20, 80])).toBe(true);
  });

  test('array target: value at lower bound returns true (inclusive)', () => {
    expect(compareValue(20, 'between', [20, 80])).toBe(true);
  });

  test('array target: value at upper bound returns true (inclusive)', () => {
    expect(compareValue(80, 'between', [20, 80])).toBe(true);
  });

  test('array target: value below range returns false', () => {
    expect(compareValue(10, 'between', [20, 80])).toBe(false);
  });

  test('array target: value above range returns false', () => {
    expect(compareValue(90, 'between', [20, 80])).toBe(false);
  });

  test('object {min, max} target: value inside returns true', () => {
    expect(compareValue(50, 'between', { min: 20, max: 80 })).toBe(true);
  });

  test('object {min, max} target: value outside returns false', () => {
    expect(compareValue(10, 'between', { min: 20, max: 80 })).toBe(false);
  });

  test('null actual returns false regardless of target', () => {
    expect(compareValue(null, 'between', [20, 80])).toBe(false);
  });

  test('undefined actual returns false', () => {
    expect(compareValue(undefined, 'between', [20, 80])).toBe(false);
  });

  test('scalar target (no array/object) returns false', () => {
    // compareValue 'between' with a plain number as target – should not throw
    expect(compareValue(50, 'between', 80)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('between condition – SoC evaluation (op/operator key variants)', () => {
  const SOC = 60; // simulated battery SoC %

  test('evaluates true when SoC is inside range using "op" key', () => {
    const cond = { enabled: true, op: 'between', value: 40, value2: 80 };
    expect(evalSoC(SOC, cond)).toBe(true);
  });

  test('evaluates true when SoC is inside range using "operator" key', () => {
    const cond = { enabled: true, operator: 'between', value: 40, value2: 80 };
    expect(evalSoC(SOC, cond)).toBe(true);
  });

  test('"op" key takes precedence over "operator" key when both present', () => {
    // op='between' wins; result should be true (60 between 40–80)
    const cond = { enabled: true, op: 'between', operator: '<', value: 40, value2: 80 };
    expect(evalSoC(SOC, cond)).toBe(true);
  });

  test('evaluates false when SoC is below range', () => {
    const cond = { enabled: true, op: 'between', value: 70, value2: 90 };
    expect(evalSoC(SOC, cond)).toBe(false);
  });

  test('evaluates false when SoC is above range', () => {
    const cond = { enabled: true, op: 'between', value: 10, value2: 50 };
    expect(evalSoC(SOC, cond)).toBe(false);
  });

  test('boundary: SoC equals lower bound returns true', () => {
    const cond = { enabled: true, op: 'between', value: 60, value2: 80 };
    expect(evalSoC(60, cond)).toBe(true);
  });

  test('boundary: SoC equals upper bound returns true', () => {
    const cond = { enabled: true, op: 'between', value: 40, value2: 60 };
    expect(evalSoC(60, cond)).toBe(true);
  });

  // ── Critical null/undefined guard (the main regression bug) ─────────────

  test('value2 = null must NOT trigger between (guard: value2 != null)', () => {
    // Before fix: value2 !== undefined → null !== undefined = TRUE → soc <= null = false
    // After fix:  value2 != null → null != null = FALSE → falls through to compareValue
    const cond = { enabled: true, op: 'between', value: 40, value2: null };
    // Should fall through to compareValue('between', 40) which returns false for scalar
    // i.e. should NOT incorrectly fire as a between range
    expect(evalSoC(SOC, cond)).toBe(false); // compareValue with scalar target returns false
  });

  test('value2 = undefined must NOT trigger between (guard: value2 != null)', () => {
    const cond = { enabled: true, op: 'between', value: 40 }; // no value2 key
    // undefined != null is FALSE → falls through to compareValue – scalar returns false
    expect(evalSoC(SOC, cond)).toBe(false);
  });

  test('value2 = 0 IS a valid range boundary (0 != null is TRUE)', () => {
    // SoC of 0 between 0-0 → true (edge case: range of one point)
    const cond = { enabled: true, op: 'between', value: 0, value2: 0 };
    expect(evalSoC(0, cond)).toBe(true);
  });

  test('value2 = 0 with active range evaluates correctly', () => {
    // soc = 0 between (0, 10) → true
    const cond = { enabled: true, op: 'between', value: 0, value2: 10 };
    expect(evalSoC(0, cond)).toBe(true);
  });

  test('disabled condition returns null (not evaluated)', () => {
    const cond = { enabled: false, op: 'between', value: 40, value2: 80 };
    expect(evalSoC(SOC, cond)).toBeNull();
  });

  test('null soc data returns false', () => {
    const cond = { enabled: true, op: 'between', value: 40, value2: 80 };
    expect(evalSoC(null, cond)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('between condition – price evaluation (operator key variant)', () => {
  const FEED_IN_PRICE = 25.5; // ¢
  const BUY_PRICE     = 12.0; // ¢

  test('feed-in price inside between range returns true (operator key)', () => {
    const cond = { enabled: true, operator: 'between', value: 20, value2: 30 };
    expect(evalPrice(FEED_IN_PRICE, cond)).toBe(true);
  });

  test('buy price inside between range returns true (op key)', () => {
    const cond = { enabled: true, op: 'between', value: 5, value2: 20 };
    expect(evalPrice(BUY_PRICE, cond)).toBe(true);
  });

  test('price below between range returns false', () => {
    const cond = { enabled: true, operator: 'between', value: 30, value2: 50 };
    expect(evalPrice(BUY_PRICE, cond)).toBe(false);
  });

  test('price above between range returns false', () => {
    const cond = { enabled: true, operator: 'between', value: 5, value2: 10 };
    expect(evalPrice(BUY_PRICE, cond)).toBe(false);
  });

  test('price between range: value2 = null does NOT trigger between (regression)', () => {
    const cond = { enabled: true, operator: 'between', value: 5, value2: null };
    // Should NOT evaluate as between; falls to compareValue with scalar → false
    expect(evalPrice(BUY_PRICE, cond)).toBe(false);
  });

  test('negative price within range returns true', () => {
    // Feed-in discount scenario: price = -5¢
    const cond = { enabled: true, operator: 'between', value: -10, value2: 0 };
    expect(evalPrice(-5, cond)).toBe(true);
  });

  test('boundary: price at lower bound is inclusive', () => {
    const cond = { enabled: true, operator: 'between', value: 12, value2: 20 };
    expect(evalPrice(12, cond)).toBe(true);
  });

  test('boundary: price at upper bound is inclusive', () => {
    const cond = { enabled: true, operator: 'between', value: 5, value2: 12 };
    expect(evalPrice(12, cond)).toBe(true);
  });

  test('non-between operator still works correctly', () => {
    const cond = { enabled: true, operator: '<', value: 15 };
    expect(evalPrice(BUY_PRICE, cond)).toBe(true); // 12 < 15
  });

  test('non-between operator with null value2 does not affect evaluation', () => {
    const cond = { enabled: true, operator: '>', value: 10, value2: null };
    expect(evalPrice(BUY_PRICE, cond)).toBe(true); // 12 > 10 (value2 ignored)
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('between condition – full rule condition evaluation (multi-condition)', () => {
  /**
   * Simulates the full condition-AND logic from evaluateRuleConditions:
   * ALL enabled conditions must be met for the rule to trigger.
   */
  function evalAllConditions({ soc, feedInPrice, buyPrice }, conditions) {
    const results = [];
    const enabled = [];

    if (conditions.soc?.enabled) {
      enabled.push('soc');
      results.push(evalSoC(soc, conditions.soc) === true);
    }
    if (conditions.price?.enabled) {
      const price = conditions.price.type === 'feedIn' ? feedInPrice : buyPrice;
      enabled.push('price');
      results.push(evalPrice(price, conditions.price) === true);
    }
    if (conditions.feedInPrice?.enabled) {
      enabled.push('feedInPrice');
      results.push(evalPrice(feedInPrice, conditions.feedInPrice) === true);
    }
    if (conditions.buyPrice?.enabled) {
      enabled.push('buyPrice');
      results.push(evalPrice(buyPrice, conditions.buyPrice) === true);
    }

    if (enabled.length === 0) return false; // no conditions → not triggered
    return results.every(r => r === true);
  }

  const liveData = { soc: 60, feedInPrice: 25, buyPrice: 12 };

  test('SoC between + price condition both met → rule triggers', () => {
    const conditions = {
      soc:   { enabled: true, operator: 'between', value: 40, value2: 80 },
      price: { enabled: true, type: 'feedIn', operator: '>', value: 20 }
    };
    expect(evalAllConditions(liveData, conditions)).toBe(true);
  });

  test('SoC between met but price NOT met → rule does not trigger', () => {
    const conditions = {
      soc:   { enabled: true, operator: 'between', value: 40, value2: 80 },
      price: { enabled: true, type: 'feedIn', operator: '>', value: 30 }
    };
    expect(evalAllConditions(liveData, conditions)).toBe(false);
  });

  test('SoC NOT in between range → rule does not trigger even if price met', () => {
    const conditions = {
      soc:   { enabled: true, operator: 'between', value: 70, value2: 90 },
      price: { enabled: true, type: 'feedIn', operator: '>', value: 20 }
    };
    expect(evalAllConditions(liveData, conditions)).toBe(false);
  });

  test('SoC between with value2=null (corrupted rule) does NOT trigger', () => {
    // Regression: old code had value2 !== undefined, allowing null through
    const conditions = {
      soc: { enabled: true, operator: 'between', value: 40, value2: null }
    };
    expect(evalAllConditions(liveData, conditions)).toBe(false);
  });

  test('SoC between using "op" key + buyPrice between using "operator" key', () => {
    const conditions = {
      soc:      { enabled: true, op: 'between', value: 40, value2: 80 },
      buyPrice: { enabled: true, operator: 'between', value: 5, value2: 20 }
    };
    expect(evalAllConditions(liveData, conditions)).toBe(true);
  });

  test('feedInPrice between condition met', () => {
    const conditions = {
      feedInPrice: { enabled: true, operator: 'between', value: 20, value2: 30 }
    };
    expect(evalAllConditions(liveData, conditions)).toBe(true); // 25 in [20,30]
  });

  test('buyPrice between condition NOT met (price above range)', () => {
    const conditions = {
      buyPrice: { enabled: true, op: 'between', value: 5, value2: 10 }
    };
    expect(evalAllConditions(liveData, conditions)).toBe(false); // 12 not in [5,10]
  });
});
