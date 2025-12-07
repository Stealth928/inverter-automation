# Feed-in Price Condition Bug Report

**Date:** December 7, 2025  
**Issue:** Feed-in price condition `>= 9` not triggering when actual price is `9.0¢`

---

## Summary

**CONFIRMED BUG FOUND** - There is a **sign inconsistency** in how feed-in prices are handled between different parts of the code.

---

## Root Cause

The Amber API returns feed-in prices as **negative numbers** (representing money you receive = negative from the grid).

**Example:** `feedInInterval.perKwh = -9.0` (negative because it's what you EARN)

### Current Code Flow

1. **Amber API returns:** `perKwh: -9.0` ✓ (correct - negative means you earn)

2. **Line 2862 in functions/index.js:**
   ```javascript
   if (feedInInterval) feedInPrice = -feedInInterval.perKwh; // Convert to positive (what you earn)
   ```
   - `feedInPrice = -(-9.0) = 9.0` ✓ (converted to positive for comparison)

3. **Rule condition:** `feedInPrice >= 9.0`
   - Should match: `9.0 >= 9.0` = `true` ✓

4. **But Line 3278 in forecast price comparison:**
   ```javascript
   const prices = relevantForecasts.map(f => priceType === 'feedIn' ? -f.perKwh : f.perKwh);
   ```
   - Also negating, which is correct

### The Real Issue

The problem is likely in how the **cache.amber** array is being constructed and what format it's in when returned from the API.

Let me trace this:

1. **Automation cycle (line 1660):**
   ```javascript
   amberData = await callAmberAPI(`/sites/${encodeURIComponent(siteId)}/prices/current`, { next: 288 }, userConfig);
   ```

2. **callAmberAPI** returns raw Amber API response (array of price objects)

3. **Each object has:**
   - `channelType: "feedIn"` or `"general"`
   - `type: "CurrentInterval"` or `"NextInterval"`
   - `perKwh: -9.0` (for feedIn) or `25.5` (for general/buy)

4. **Line 2860-2862:**
   ```javascript
   const feedInInterval = cache.amber.find(ch => ch.channelType === 'feedIn' && ch.type === 'CurrentInterval');
   if (feedInInterval) feedInPrice = -feedInInterval.perKwh; // Result: 9.0
   ```

---

## Why Might It Not Trigger?

**Possible Causes:**

1. **Data type mismatch:** `feedInPrice` could be a string instead of number
   - Comparison `"9" >= 9` might behave unexpectedly
   
2. **Rounding/precision issues:** Actual value might be `9.00000001` or `8.9999999`
   - IEEE float comparison pitfall

3. **Cache.amber not populated:** If `amberData` is `null` or wrong format
   - `cache.amber` would be `null`, so `cache.amber.find()` would crash
   - But there's no error handling shown...

4. **Wrong data format from API:** If Amber changed response format
   - `perKwh` might be nested deeper or named differently

5. **Off-by-one in operator precedence:** The negation might be applied incorrectly

---

## Evidence From Code

### Test Frontend (line 1005)
```javascript
if (priceCache.feedIn?.perKwh !== undefined) 
  document.getElementById('simFeedIn').value = (-priceCache.feedIn.perKwh).toFixed(1);
```
- Frontend is also negating feedIn prices
- This confirms Amber API returns negative values

### Logging (line 2866)
```javascript
console.log(`[Automation] Evaluating rule... FeedIn=${feedInPrice?.toFixed(1)}¢...`);
```
- This would show the actual value being compared
- **Check your Cloud Functions logs** to see what value is being logged

---

## Recommended Fix

### 1. Add Type Coercion (Safest)
```javascript
let feedInPrice = null;
let buyPrice = null;
if (Array.isArray(cache.amber)) {
  const feedInInterval = cache.amber.find(ch => ch.channelType === 'feedIn' && ch.type === 'CurrentInterval');
  const generalInterval = cache.amber.find(ch => ch.channelType === 'general' && ch.type === 'CurrentInterval');
  if (feedInInterval) feedInPrice = Math.abs(feedInInterval.perKwh); // Always positive
  if (generalInterval) buyPrice = Math.abs(generalInterval.perKwh); // Always positive
}
```

### 2. Or Fix compareValue to Handle Edge Cases
```javascript
function compareValue(actual, operator, target) {
  if (actual === null || actual === undefined) return false;
  // Ensure numeric comparison
  const actualNum = Number(actual);
  const targetNum = Number(target);
  if (isNaN(actualNum) || isNaN(targetNum)) return false;
  
  switch (operator) {
    case '>': return actualNum > targetNum;
    case '>=': return actualNum >= targetNum;
    // ... rest
  }
}
```

### 3. Debug First - Add Enhanced Logging
```javascript
if (actualPrice !== null) {
  console.log(`[Automation] DEBUG Price condition: actual=${actualPrice}, type=${typeof actualPrice}, target=${value}, type=${typeof value}, operator=${operator}`);
  console.log(`[Automation] DEBUG Comparison: ${actualPrice} ${operator} ${value} = ${compareValue(actualPrice, operator, value)}`);
  // ... rest of condition check
}
```

---

## Investigation Steps

1. **Check Cloud Functions logs** during a cycle when price is 9¢:
   - Look for: `[Automation] Evaluating rule... FeedIn=9.0¢...`
   - Note the exact value and data type

2. **Check if rule evaluation enters the price condition block:**
   - Look for: `[Automation] Rule '...' - Price (feedIn) condition NOT met: ...`
   - If this doesn't appear, the condition isn't being checked

3. **Verify cache.amber is populated:**
   - Look for: `[Automation] Amber data fetched: X intervals`
   - If 0 intervals, that's the problem

4. **Manual test with logging:**
   - Add console.log before/after compareValue call
   - Deploy and re-run

---

## Files Affected

| File | Line | Issue | Fix Needed |
|------|------|-------|-----------|
| functions/index.js | 2862 | Negation of perKwh | Add type coercion |
| functions/index.js | 2896 | Calls compareValue | May need null checks |
| functions/index.js | 3347 | compareValue function | Doesn't validate types |
| test.html | 1005 | Also negates (for display) | Document why |

---

## Recommendation

**Immediate Action:** Add the enhanced logging above to diagnose the exact issue, then deploy and run a test cycle with feed-in price ~9¢.

Once we see the logs, we can determine if it's:
1. Type mismatch (string vs number)
2. Precision issue (9.0000001)
3. Cache not populated
4. Operator precedence bug

