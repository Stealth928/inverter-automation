# How to Monitor Curtailment & Export Limit Changes

## Quick Reference

### Check Past 48 Hours of Changes

Run this Firebase CLI command to see recent logs:
```bash
firebase functions:log | findstr /C:"Curtailment" /C:"action"
```

### What to Look For in Logs

**✅ GOOD (Efficient) - Should see this pattern:**
```
[Cycle] Curtailment result: {...,"action":null,"stateChanged":false}
[Cycle] Curtailment result: {...,"action":null,"stateChanged":false}
[Cycle] Curtailment result: {...,"action":null,"stateChanged":false}
[Curtailment] Activating (price 5.00¢ < 10.00¢)
[Cycle] Curtailment result: {...,"action":"activated","stateChanged":true}
[Cycle] Curtailment result: {...,"action":null,"stateChanged":false}
[Cycle] Curtailment result: {...,"action":null,"stateChanged":false}
```

In this example:
- 3 cycles: No change (no-op) ✅
- 1 activation event
- 2 more cycles: No change (staying active) ✅

**❌ BAD (Inefficient) - Would look like this:**
```
[Curtailment] Activating (price 5.00¢ < 10.00¢)
[Curtailment] Deactivating (price 5.01¢ >= 0.00¢)
[Curtailment] Activating (price 5.00¢ < 10.00¢)
[Curtailment] Deactivating (price 5.01¢ >= 0.00¢)
```

If you see alternating activate/deactivate in every cycle = price is right at your threshold

---

## Interpret the Curtailment Result JSON

### stateChanged Field
- `"stateChanged": true` → **API call was made** (export limit changed)
- `"stateChanged": false` → **No API call** (state unchanged, most cycles)

### action Field
- `"action": "activated"` → Set ExportLimit to 0 (curtailing solar)
- `"action": "deactivated"` → Set ExportLimit to 12000 (allowing export)
- `"action": null` → No change made (price steady relative to threshold)

### enabled Field
- `"enabled": true` → Curtailment feature is active and checking
- `"enabled": false` → Feature disabled by user (no checks performed)

### triggered Field
- `"triggered": true` → Current price is BELOW threshold (would curtail)
- `"triggered": false` → Current price is ABOVE threshold (normal operation)

---

## Expected Metrics

### Normal Operation (Feature Disabled)
- **Curtailment Activations (24h):** 0
- **Curtailment Deactivations (24h):** 0
- **API Calls:** 0
- **Firestore Writes:** 0

### Normal Operation (Feature Enabled, Price Stable)
- **Curtailment Activations (24h):** 0-2 (only at price crossover points)
- **Curtailment Deactivations (24h):** 0-2 (only at price crossover points)
- **API Calls (24h):** 0-4 (only on transitions)
- **Firestore Writes (24h):** 0-4 (only on transitions)
- **No-op Cycles (24h):** 1436-1440 out of 1440 (99.7%+ efficiency)

### Investigate If You See This
- **> 10 state changes per day** without correlated market events
- **Activation every cycle** (indicates threshold set too high)
- **Deactivation every cycle** (indicates threshold set too low)
- **Rapid alternation** (price bouncing right at threshold, may need wider margin)

---

## How to Adjust Your Threshold

If you're seeing too many changes:

1. **Too many activations?**
   - Your `priceThreshold` is set too low
   - Solar curtailment activates too often
   - Solution: Increase threshold value (e.g., from 0 to 5)

2. **Too many deactivations?**
   - Your `priceThreshold` is set too high
   - Solar starts curtailing too rarely
   - Solution: Decrease threshold value (e.g., from 10 to 5)

3. **Bouncing back and forth?**
   - Price is volatile around your threshold
   - Solution: Set threshold lower (e.g., -5 instead of 0) to avoid frequent bounces

---

## Database State Location

The curtailment state is tracked at:
```
Firestore: users/{uid}/curtailment/state
```

Fields stored:
```json
{
  "active": true,                    // Currently curtailed?
  "lastPrice": 5.5,                  // Price at last state change
  "lastActivated": 1704067200000,    // Timestamp when activated
  "lastDeactivated": 1704070800000,  // Timestamp when deactivated
  "threshold": 0                     // Threshold in effect
}
```

---

## Troubleshooting

**I see no curtailment logs at all**
- Check if feature is enabled: `userConfig.curtailment.enabled`
- Check threshold value: `userConfig.curtailment.priceThreshold`
- Check if you have Amber API configured (needed for feed-in prices)

**I see "Curtailment Activating" but no "Deactivating"**
- Curtailment is currently active (price still below threshold)
- Waiting for price to rise back above threshold
- This is normal

**I see errors in curtailment logs**
- Check if device SN is configured
- Check if FoxESS API token is valid
- Check if you're hitting FoxESS API rate limits

**Curtailment state seems stuck**
- Check the timestamp in `users/{uid}/curtailment/state`
- Compare to current time
- If stuck > 24h, may indicate API failure during state change

---

## Cost Implications

Each **export limit change** costs approximately:
- 1 FoxESS API call (~$0.001 in costs)
- 1-2 Firestore writes (~$0.0000013 per write)
- Negligible network traffic

**Example Monthly Cost:**
- 1440 cycles/day
- 2 state changes per day (worst case)
- 60 state changes per month
- **Cost: ~$0.06/month** (negligible)

The optimization to skip redundant API calls when state hasn't changed saves far more than the initial activation/deactivation calls cost.

---

## Quick Command Reference

```bash
# View last 100 logs mentioning curtailment
firebase functions:log | grep -i "curtailment"

# Count how many times curtailment activated today
firebase functions:log | grep -c "Activating"

# Count how many times curtailment deactivated today
firebase functions:log | grep -c "Deactivating"

# View full curtailment result for debugging
firebase functions:log | grep "Curtailment result"
```
