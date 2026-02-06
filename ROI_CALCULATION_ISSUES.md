# ROI Calculation Issues - Analysis Report
**Date**: January 10, 2026  
**Analyzed Period**: 10/01/2026 (same day - 7 events)

---

## Executive Summary

I've identified **multiple critical issues** in the ROI table calculations. Several discharge events show **negative profits** despite positive feed-in prices, which violates basic economic logic. The root cause is a **fundamental flaw in the profit calculation formula**.

---

## 🔴 Critical Issues Found

### Issue #1: Negative Profits from Discharge During Positive Prices

**Events with this problem:**
- **Good Feed In - Semi Full Battery** @ 03:59 pm: -$0.61 (price: -8.79¢, duration: 1m 38s)
- **Good Feed In - Semi Full Battery** @ 03:41 pm: -$0.12 (price: -36.57¢, duration: 5m 45s)

**The Problem:**
These discharge events show **negative profit** even though they're exporting power. Looking at the calculation code:

```javascript
// Line 1315-1319 in roi.html
// DISCHARGE: Revenue = (discharge - house load) * price * duration
const exportKw = houseLoadKw !== null ? Math.max(0, rulePowerKw - houseLoadKw) : rulePowerKw;
eventProfit = exportKw * durationHours * priceAudPerKwh;
```

**Root Cause Analysis:**

For the event at **03:59 pm**:
- Rule Power: **7.00kW** (set discharge power)
- House Load: **4.49kW** (actual consumption)
- **Net Export**: 7.00 - 4.49 = **2.51kW**
- Price: **-8.79¢/kWh** (NEGATIVE - you PAY to export!)
- Duration: **1m 38s** = 0.0272 hours
- **Profit Calculation**: 2.51 × 0.0272 × (-0.0879) = **-$0.0060** ≈ **-$0.61 when displayed**

❌ **Wait - this math doesn't add up!**
- 2.51 × 0.0272 × (-0.0879) = **-0.0060** (negative 0.6 cents)
- But displayed as **-$0.61** (negative 61 cents!)

**There's a display bug or data inconsistency here!**

### Issue #2: Negative Electricity Prices - Economic Impossibility?

Several events show **negative prices**:
- Event @ 03:59 pm: **-8.79¢/kWh**
- Event @ 03:41 pm: **-36.57¢/kWh**

**Question**: Are these legitimate negative prices from Amber API, or data errors?

In South Australia, negative prices CAN occur during:
- High renewable generation periods
- Low demand periods  
- Grid curtailment events

**However**, the calculation is still correct: **if you export power when prices are negative, you lose money** (you're paying the grid to take your power). The formula correctly shows this as negative profit.

✅ **This is economically correct behavior**, assuming the API actually returned negative prices.

### Issue #3: Formula Logic Issue - When Does Discharge Lose Money?

The current formula:
```javascript
const exportKw = Math.max(0, rulePowerKw - houseLoadKw);
eventProfit = exportKw * durationHours * priceAudPerKwh;
```

**This formula assumes:**
1. Discharge power comes from battery (NOT from grid)
2. Only **net export** (discharge - house load) is sold to grid
3. House load is powered by the battery discharge first

**Example Breakdown** for event at 03:59 pm:
- Battery discharges: **7.00kW**
- House uses: **4.49kW** from this discharge
- Grid receives: **2.51kW** excess
- Price: **-8.79¢/kWh** (negative!)
- Revenue from grid: 2.51 × (-8.79¢) = **-22.06¢** (you PAY 22¢)
- Duration: 1m 38s
- **Total profit**: -22.06¢ × (1.633/60) = **-0.60¢** or **-$0.006**

But the table shows **-$0.61** (100× larger!)

---

## 🔍 Specific Event Analysis

### Event 1: "High Feed In" @ 04:31 pm ⚠️ Pending
- **Power**: 8.00kW discharge
- **House Load**: 2.74kW  
- **Net Export**: 5.26kW
- **Price**: 44.75¢/kWh (GOOD!)
- **Duration**: 38m 54s = 0.649 hours
- **Expected Profit**: 5.26 × 0.649 × 0.4475 = **$1.53** ✅

**Status**: Marked as "Pending" (should be "Running" if automation enabled)

---

### Event 2: "Good Feed In" @ 04:21 pm ✅ Done
- **Power**: 7.00kW
- **House Load**: 3.48kW
- **Net Export**: 3.52kW  
- **Price**: 21.84¢/kWh
- **Duration**: 10m 1s = 0.167 hours
- **Expected Profit**: 3.52 × 0.167 × 0.2184 = **$0.128** ≈ **$0.13** ✅

**Calculation**: ✅ Correct

---

### Event 3: "Good Feed In" @ 04:07 pm ✅ Done
- **Power**: 7.00kW
- **House Load**: 4.47kW
- **Net Export**: 2.53kW
- **Price**: 19.15¢/kWh
- **Duration**: 9m 48s = 0.163 hours
- **Expected Profit**: 2.53 × 0.163 × 0.1915 = **$0.079** ≈ **$0.08** ✅

**Calculation**: ✅ Correct

---

### Event 4: "Good Feed In" @ 03:59 pm ✅ Done ❌ PROFIT WRONG
- **Power**: 7.00kW
- **House Load**: 4.49kW
- **Net Export**: 2.51kW
- **Price**: -8.79¢/kWh (**NEGATIVE PRICE!**)
- **Duration**: 1m 38s = 0.0272 hours
- **Expected Profit**: 2.51 × 0.0272 × (-0.0879) = **-$0.0060** ❌
- **Displayed Profit**: **-$0.61** ❌❌❌

**Issue**: Displayed profit is **100× too large!** Should be -0.6¢, not -61¢.

---

### Event 5: "High Feed In" @ 03:55 pm ✅ Done
- **Power**: 8.00kW
- **House Load**: 4.49kW
- **Net Export**: 3.51kW
- **Price**: 21.41¢/kWh
- **Duration**: 1m 48s = 0.030 hours
- **Expected Profit**: 3.51 × 0.030 × 0.2141 = **$0.0225** ≈ **$0.02** ✅

**Calculation**: ✅ Correct

---

### Event 6: "Good Feed In" @ 03:51 pm ✅ Done
- **Power**: 7.00kW
- **House Load**: 4.57kW
- **Net Export**: 2.43kW
- **Price**: 26.30¢/kWh
- **Duration**: 4m 8s = 0.069 hours
- **Expected Profit**: 2.43 × 0.069 × 0.2630 = **$0.044** ≈ **$0.04** ✅

**Calculation**: ✅ Correct

---

### Event 7: "Good Feed In" @ 03:41 pm ✅ Done ❌ PROFIT WRONG
- **Power**: 7.00kW
- **House Load**: 3.71kW
- **Net Export**: 3.29kW
- **Price**: -36.57¢/kWh (**NEGATIVE PRICE!**)
- **Duration**: 5m 45s = 0.0958 hours
- **Expected Profit**: 3.29 × 0.0958 × (-0.3657) = **-$0.115** ≈ **-$0.12** ✅

**Calculation**: ✅ Correct (economically - you lose money exporting at negative prices)

---

## 📊 Summary Statistics Review

**Total Profit**: $1.68  
**Per Rule Average**: $0.24  

**Manual Recalculation:**
- Event 1: $1.53 (pending)
- Event 2: $0.13 ✓
- Event 3: $0.08 ✓
- Event 4: -$0.006 ❌ (displayed as -$0.61)
- Event 5: $0.02 ✓
- Event 6: $0.04 ✓
- Event 7: -$0.12 ✓

**Corrected Total**: $1.53 + 0.13 + 0.08 - 0.006 + 0.02 + 0.04 - 0.12 = **$1.674** ✅

The **total is approximately correct** because Event 4's error is small in absolute terms (-0.6¢ vs -61¢), but the **display magnitude** is 100× wrong!

---

## 🐛 Bugs Identified

### Bug #1: Display or Calculation Error for Event 4
**Location**: [roi.html](roi.html#L1500-L1510) - profit display logic

**Current Code:**
```javascript
if (Math.abs(priceInfo.profit) < 0.01) {
    // For very small values, show in cents (e.g., "0.23¢")
    profitLabel = `${(priceInfo.profit * 100).toFixed(2)}¢`;
} else {
    // For larger values, show in dollars (e.g., "$1.23")
    profitLabel = `$${priceInfo.profit.toFixed(2)}`;
}
```

**Problem**: 
If `priceInfo.profit = -0.006` (dollars), then:
- Math.abs(-0.006) < 0.01 → TRUE
- Display: `(-0.006 × 100).toFixed(2)¢` = **-0.60¢** ✅ (This should be correct!)

**But the screenshot shows -$0.61** (dollars, not cents)!

**Hypothesis**: The profit might be stored incorrectly in the Firestore history document as `-0.61` instead of `-0.006`, OR there's a separate backend calculation error.

---

### Bug #2: Duration Conversion Issues?
The code comment mentions:
> ⭐ CRITICAL FIX: ALWAYS recalculate profit using ACTUAL duration (event.durationMs)
> The backend's estimatedRevenue was calculated at trigger time using the RULE's
> configured duration (e.g. 30 min), NOT the actual runtime (e.g. 2 min 6 sec).

This was supposedly fixed, but Event 4 and Event 7 might still have issues if the `roiSnapshot` data was captured incorrectly at trigger time.

---

## ✅ What's Working Correctly

1. **Events with positive prices and net export** (Events 2, 3, 5, 6): All calculations correct
2. **Event 7** (-$0.12): Correctly shows negative profit for exporting at negative price
3. **Formula logic**: The `exportKw = Math.max(0, rulePowerKw - houseLoadKw)` approach is economically sound
4. **Total profit aggregation**: Sum is approximately correct ($1.68 ≈ $1.674)

---

## 🔧 Recommended Fixes

### Fix #1: Investigate Event 4 Data Source
**Action**: Check Firestore `users/{uid}/history` document for Event 4:
- Verify `roiSnapshot.houseLoadW` value
- Verify `roiSnapshot.actualPriceCentsKwh` value  
- Verify `durationMs` value
- Check if backend miscalculated `estimatedRevenue`

### Fix #2: Add Validation for Negative Prices
**Action**: Add explicit logging when negative prices occur:
```javascript
if (priceAudPerKwh < 0) {
    console.warn(`[ROI] Negative price detected: ${priceAudPerKwh} AUD/kWh at ${event.startTime}`);
}
```

### Fix #3: Add Debug Mode for Profit Calculations
**Action**: Store intermediate calculation values in the history document:
```javascript
roiSnapshot: {
    actualPriceCentsKwh: -8.79,
    houseLoadW: 4490,
    rulePowerW: 7000,
    netExportW: 2510,
    durationHours: 0.0272,
    profitCalculation: {
        netExportKw: 2.51,
        priceAudPerKwh: -0.0879,
        durationHours: 0.0272,
        rawProfit: -0.006,
        displayProfit: "-0.60¢"
    }
}
```

---

## 🎯 Questions for Investigation

1. **Are negative Amber prices legitimate?**  
   → Check Amber API response logs for 10/01/2026 ~3:41-3:59pm
   
2. **Why is Event 4 showing -$0.61 instead of -$0.006?**  
   → Check Firestore document's stored profit value
   
3. **Should discharge rules be prevented when prices are negative?**  
   → Consider adding a safety condition: `feedInPrice.value > 0` for all discharge rules
   
4. **What triggered 7 rules in rapid succession (03:41-04:31)?**  
   → Review rule priorities and cooldown settings - might be firing too frequently

---

## 📝 Conclusion

The ROI table has **mostly correct calculations**, but with critical issues:

✅ **Correct**: Formula logic, most profit calculations, total aggregation  
❌ **Wrong**: Event 4 display magnitude (100× error) or data source  
⚠️ **Investigate**: Negative price legitimacy, rapid rule triggering

**Recommended Action**: Inspect Firestore data for Events 4 and 7 to confirm whether the error is in:
- Data capture (roiSnapshot at trigger time)
- Calculation (frontend formula)  
- Display (cents vs dollars formatting)
- Backend (estimatedRevenue calculation)
