# Cost Analysis Validation & Re-Assessment
## December 2025

**Validator:** GitHub Copilot  
**Date:** December 24, 2025  
**Reference:** `docs/COST_ANALYSIS_2025.md`

---

## 1. Validation of Previous Analysis

I have audited the previous analysis (`COST_ANALYSIS_2025.md`) and found **significant discrepancies** in the calculations.

### ❌ Critical Errors Found

1.  **Math Error in Firestore Read Costs (10x Overestimation)**
    *   *Previous Claim:* 1,000 users × 130,000 reads = 130M reads = **$780.30**
    *   *Actual Math:* 130,000,000 reads / 100,000 × $0.06 = **$78.00**
    *   *Impact:* The previous report overstated read costs by **1000%**.

2.  **Underestimation of Read Volume (3x Underestimation)**
    *   *Previous Claim:* ~130,000 reads/user/month.
    *   *Code Reality:* The `runAutomationHandler` loop reads 3 documents (User, State, Config) for **EVERY** user, every minute, *before* checking if the cycle should run.
    *   *Actual Volume:* ~432,000 reads/user/month (for active users).
    *   *Impact:* The volume is 3x higher than stated, but because the cost was calculated with a 10x multiplier error, the final dollar figure was still too high.

3.  **Scheduler Invocation Misunderstanding**
    *   *Previous Claim:* 62M invocations/month ($24.88).
    *   *Code Reality:* `onSchedule('every 1 minutes')` triggers **once per minute** for the system, not per user.
    *   *Actual Count:* 43,200 invocations/month total.
    *   *Impact:* Invocation cost is negligible ($0.02/month), not $25. The primary cost is compute time (vCPU-seconds), which scales with user count.

---

## 2. Corrected Cost Analysis

### Architecture Reality Check
*   **Scheduler Loop:** Runs 1/min. Reads **ALL** user docs (`users.get()`), then reads `state` and `config` for each.
    *   **Base Load:** 3 reads per user per minute (regardless of settings).
*   **Active Cycle:** If enabled, calls API endpoint which **re-reads** Config, Rules, State, and Caches.
    *   **Active Load:** +7 reads per user per minute.
*   **Total Reads:** ~10 reads/minute for active users.

### Per-User Monthly Cost (Active User)

| Metric | Calculation | Value | Cost |
|--------|-------------|-------|------|
| **Firestore Reads** | 10 reads/min × 43,200 min | 432,000 | **$0.26** |
| **Firestore Writes** | 1 write/min (lastCheck) × 43,200 | 43,200 | **$0.08** |
| **Functions CPU** | ~200ms/min × 43,200 | ~8,640s | **$0.01** |
| **Total** | | | **$0.35** |

### Cost by Scale

| Scale | Firestore Reads | Firestore Writes | Functions | Total Cost | Per User |
|-------|-----------------|------------------|-----------|------------|----------|
| **100 Users** | $26.00 | $8.00 | $0.50 | **$34.50** | **$0.35** |
| **1,000 Users** | $260.00 | $80.00 | $5.00 | **$345.00** | **$0.35** |
| **10,000 Users** | $2,600.00 | $800.00 | $50.00 | **$3,450.00** | **$0.35** |

---

## 3. Comparison

| Metric | Previous Report (1k users) | Corrected Analysis (1k users) | Variance |
|--------|----------------------------|-------------------------------|----------|
| **Read Volume** | 130M reads | 432M reads | **+232%** |
| **Read Cost** | $780.30 (Math Error) | $260.00 | **-66%** |
| **Write Cost** | $108.00 | $80.00 | **-26%** |
| **Total Monthly** | $917.68 | $345.00 | **-62%** |
| **Per User** | **$0.92** | **$0.35** | **-62%** |

**Conclusion:** The system is **significantly cheaper** than previously reported ($0.35/user vs $0.92/user), despite the code being less efficient than assumed.

---

## 4. Optimization Opportunities (Revised)

The current architecture has a "Base Load" inefficiency: it reads 3 documents for every user every minute, even if they are disabled or set to a 5-minute interval.

### 🚀 High-Impact Fix: "Next Run" Indexing
**Problem:** `runAutomationHandler` iterates ALL users and reads their config/state every minute.
**Solution:**
1.  Store `nextRun` timestamp on the **User Document** (or a dedicated `schedules` collection).
2.  Query only users due for a run: `db.collection('users').where('nextRun', '<=', now).get()`.
3.  Update `nextRun` after execution: `now + interval`.

**Impact:**
*   **Reduces Base Load:** From 3 reads/min to 0 reads/min for waiting users.
*   **Reduces Active Load:** From 10 reads/min to ~7 reads/min (no redundant state/config check).
*   **Cost Savings:** Reduces read volume by ~30-50%.
*   **New Cost:** ~$0.20/user/month.

### 📉 Quick Fix: Replicate "Enabled" State
**Problem:** We read `users/{uid}/automation/state` just to check `enabled: true`.
**Solution:** Replicate `automationEnabled` to the root `users/{uid}` doc.
**Query:** `db.collection('users').where('automationEnabled', '==', true).get()`.
**Impact:** Instantly stops billing for disabled users (currently paying $0.08/month/disabled-user).

---

## 5. Final Verdict

The project is **highly viable** at **$0.35/user/month**.
*   **100 Users:** $35/mo
*   **1,000 Users:** $345/mo

This leaves ample margin for the external API costs (FoxESS ~ $3.00/user/mo if not cached, but we cache it to ~$0.60/mo).

**Total Cost of Goods Sold (COGS):**
*   Firebase: $0.35
*   FoxESS API: ~$0.60 (with caching)
*   **Total:** ~$1.00 / user / month
