# 🔬 Solar Curtailment Implementation - README

**Status:** Phase 1 Complete ✅ — Discovery Page Live  
**Last Updated:** December 20, 2025  
**Next Phase:** Phase 2 (Automation Rules Integration)

---

## Quick Links

### 🚀 Start Here
- **Live Page:** https://inverter-automation-firebase.web.app/curtailment-discovery.html
- **Quick Start:** `docs/CURTAILMENT_QUICK_START.md` (5 min read)
- **What's Delivered:** `docs/CURTAILMENT_DELIVERY_SUMMARY.md`

### 📚 Full Documentation
| Document | Purpose | Read Time |
|----------|---------|-----------|
| `CURTAILMENT_QUICK_START.md` | 5-min tutorial | 5 min |
| `CURTAILMENT_DISCOVERY_PAGE.md` | Feature guide | 15 min |
| `CURTAILMENT_IMPLEMENTATION_CHECKPOINT.md` | Project status & roadmap | 20 min |
| `CURTAILMENT_DELIVERY_SUMMARY.md` | What was built | 10 min |
| `SOLAR_CURTAILMENT_ASSESSMENT.md` | Technical deep dive | 30 min |

---

## What You Have Now

### ✅ Discovery Page (Live)
- Interactive UI for system exploration
- 6 discovery sections with one-click buttons
- Real-time activity logging
- Safe testing environment

**Access:** Click "🔬 WIP - Solar Curtailment" in app menu

### ✅ Technical Assessment
- 600+ line feasibility document
- 5-phase implementation roadmap
- Edge case analysis
- Code examples & patterns

**File:** `docs/SOLAR_CURTAILMENT_ASSESSMENT.md`

### ✅ Backend API Endpoints
- `POST /api/device/setting/get` — Read device settings
- `POST /api/device/setting/set` — Write device settings
- Full authentication & logging

**Code:** `functions/index.js` lines 3915-3956

---

## How to Use (Right Now)

### 1. Navigate to Discovery Page
```
Click: 🔬 WIP - Solar Curtailment (in main menu)
Or visit: https://inverter-automation-firebase.web.app/curtailment-discovery.html
```

### 2. Run Discovery (5 minutes)
```
a) Click "Detect Topology Now"
   → Learn if you're DC-coupled (full control) or AC-coupled (limited)

b) Click "Probe Export Limit Keys"
   → See which FoxESS settings your device supports

c) Click "Read Current Settings"
   → Check if export limiting is currently enabled

d) Review "System Capability Summary"
   → Get your readiness assessment
```

### 3. Optional — Test Control
```
Only if confident:
a) Set target export limit (e.g., 5000W)
b) Click "Set Export Limit"
c) Watch FoxESS Cloud app to verify change
d) Click "Disable Export Limiting" to restore
```

### 4. Review Activity Log
```
All operations logged with timestamps
Green = Success ✓
Yellow = Warning ⚠️
Red = Error ✗
```

---

## What You'll Learn

After running discovery, you'll know:

```
✓ System Topology
  → DC-coupled (ideal) or AC-coupled (limited)
  → Tells you if full curtailment is possible

✓ API Key Availability  
  → Which FoxESS settings are available
  → Proof that export limit control works

✓ Current Configuration
  → Is export limiting enabled?
  → What's the current export cap?

✓ Device Capabilities
  → Can you control exports remotely?
  → What's the propagation delay?

✓ System Readiness
  → Ready for Phase 2 automation
  → Any known limitations or issues
```

---

## Next Steps by Scenario

### ✅ If DC-Coupled
```
Your system supports full curtailment automation.

Next: Phase 2 (3-4 days)
1. Create negative FiT automation rule
2. Implement curtailment action
3. Test with real price conditions
4. Deploy and monitor

Then: Phase 3-5 (2-3 weeks)
- Core curtailment function
- UI for rule building
- ROI tracking
```

### ⚠️ If AC-Coupled
```
External solar inverter limits control.

Options:
1. Curtail battery exports only (partial)
2. Use Amber SmartShift for solar
3. Plan external inverter integration

Plan: Different Phase 2 approach
- Document topology limitation
- Plan multi-inverter strategy
```

### ❓ If Unknown/No Keys
```
Device may not support FoxESS export limiting.

Check Manually:
1. Open FoxESS Cloud app
2. Look for "ExportLimit" setting
3. If found: Contact FoxESS re API access
4. If not found: May need alternative approach
```

---

## Key Files Reference

### Discovery Page
```
frontend/curtailment-discovery.html (928 lines)
├── Section 1: Topology Detection
├── Section 2: API Key Probing  
├── Section 3: Settings Reader
├── Section 4: Real-Time Telemetry
├── Section 5: Control Tester
├── Section 6: Capability Summary
└── Activity Log
```

### Backend APIs
```
functions/index.js (lines 3915-3956)
├── POST /api/device/setting/get
│   └── Reads device settings from FoxESS
├── POST /api/device/setting/set
│   └── Writes device settings to FoxESS
└── Both: Auth required, Logging included
```

### Documentation
```
docs/
├── CURTAILMENT_QUICK_START.md (200 lines)
│   └── 5-minute tutorial
├── CURTAILMENT_DISCOVERY_PAGE.md (400 lines)
│   └── Complete feature guide
├── CURTAILMENT_IMPLEMENTATION_CHECKPOINT.md (400 lines)
│   └── Project status & roadmap
├── CURTAILMENT_DELIVERY_SUMMARY.md (350 lines)
│   └── What was built & tested
└── SOLAR_CURTAILMENT_ASSESSMENT.md (600 lines)
    └── Technical feasibility study
```

---

## Architecture Overview

```
┌─────────────────────────────────────┐
│  Your App (Frontend)                │
│  ┌─────────────────────────────────┐│
│  │ Discovery Page                  ││
│  │ ✓ Topology Detection           ││
│  │ ✓ API Key Probing              ││
│  │ ✓ Settings Reader              ││
│  │ ✓ Control Tester               ││
│  └─────────────────────────────────┘│
└──────────────┬──────────────────────┘
               │ HTTP/JSON
               ↓
┌──────────────────────────────────────┐
│ Backend API (Cloud Functions)        │
│ ┌──────────────────────────────────┐ │
│ │ /api/device/setting/get          │ │
│ │ /api/device/setting/set          │ │
│ │ /api/inverter/real-time (existing)
│ └──────────────────────────────────┘ │
└──────────────┬──────────────────────┘
               │ HTTPS/OAuth
               ↓
┌──────────────────────────────────────┐
│ FoxESS Cloud API                     │
│ ┌──────────────────────────────────┐ │
│ │ /op/v0/device/setting/get        │ │
│ │ /op/v0/device/setting/set        │ │
│ │ /op/v0/device/real/query         │ │
│ └──────────────────────────────────┘ │
└──────────────┬──────────────────────┘
               │
               ↓
      Your FoxESS Inverter
      (ExportLimit setting)
```

---

## Phase 2 Preview (When You're Ready)

### What Phase 2 Will Add
```
1. Automation Rule Extension
   └── New action type: "curtail-export"

2. Trigger Integration
   └── Execute curtailment at rule trigger time

3. Audit Logging
   └── Log all curtailment actions

4. Safety Checks
   └── Verify capabilities before executing

5. Example: Negative FiT Automation
   └── Curtail exports when price < 0
```

### Timeline
- **Effort:** 3-4 days
- **Dependencies:** Discovery findings (which you have)
- **Input:** This discovery page results
- **Output:** Working negative FiT curtailment automation

---

## FAQ

### Q: Is my system ready?
**A:** Run discovery and see the auto-generated "System Capability Summary"

### Q: Can I hurt something testing?
**A:** No, export limit is a safe FoxESS setting. Always restore default to be safe.

### Q: How long until curtailment works?
**A:** You can test now. Phase 2 (automation) = 3-4 days. Full implementation = 2-3 weeks.

### Q: What if I'm AC-coupled?
**A:** Curtailment will only affect battery exports. External solar still exports freely. Plan accordingly.

### Q: Can I use Amber SmartShift too?
**A:** Not simultaneously. Choose one or the other (conflict risk).

### Q: How do I know if it worked?
**A:** Watch FoxESS Cloud app after setting export limit. Should see feedinPower drop.

---

## Testing Checklist

Before Phase 2, you should:

- [ ] Access discovery page (no auth issues)
- [ ] Run topology detection (get a result)
- [ ] Probe API keys (see available keys)
- [ ] Read current settings (understand config)
- [ ] Optional: Test export limit (watch FoxESS Cloud)
- [ ] Understand your system's type (DC/AC/Hybrid)
- [ ] Know which API keys work on your device
- [ ] Review activity log (all operations logged)

---

## Support

### Issues Running Discovery
1. Check you're logged in
2. Verify device SN in Settings
3. Check browser console for errors
4. Try hard refresh (Ctrl+Shift+R)

### Questions About Results
- See: `docs/CURTAILMENT_QUICK_START.md`
- See: `docs/CURTAILMENT_DISCOVERY_PAGE.md`

### Want to Proceed to Phase 2
- Review: `docs/CURTAILMENT_IMPLEMENTATION_CHECKPOINT.md`
- Check: Phase 2 section of this README

### Technical Questions
- See: `docs/SOLAR_CURTAILMENT_ASSESSMENT.md`
- Check: Code comments in `functions/index.js`

---

## Success Criteria

| Item | Status |
|------|--------|
| Discovery page live | ✅ |
| Topology detection works | ✅ |
| API key probing works | ✅ |
| Settings reader works | ✅ |
| Control tester works | ✅ |
| Documentation complete | ✅ |
| Backend endpoints deployed | ✅ |
| Ready for Phase 2 | ✅ |

---

## What Happens Now

### Week 1 (This Week)
- [x] Delivery complete
- [ ] You explore discovery page
- [ ] You understand your system
- [ ] You decide on Phase 2 start

### Week 2 (Phase 2 Start)
- [ ] Extend automation schema
- [ ] Implement curtailment logic
- [ ] Test with conditions
- [ ] Deploy

### Weeks 3-4 (Phases 3-5)
- [ ] Build UI
- [ ] Add ROI tracking
- [ ] Complete implementation
- [ ] Monitor in production

---

## Remember

```
Discovery Page = Low Risk Exploration
    ↓
You learn about your system
    ↓
No changes to production
    ↓
Safe testing in controlled way
    ↓
Ready for Phase 2 automation
```

---

## Price Threshold Settings

### What is the Curtailment Price Threshold?

The **price threshold** is a dynamic control value that determines when solar curtailment should activate based on feed-in electricity price.

**Key Points:**
- **Range:** -999 to +999 cents/kWh
- **Default:** 0 cents/kWh
- **Meaning:** Curtail when feed-in price ≤ threshold value
- **Example:** If set to 5, curtailment activates when price drops to 5¢ or lower

### Use Cases by Value

| Threshold | Use Case | Notes |
|-----------|----------|-------|
| **-50 to -10** | Avoid negative pricing | Curtail only when grid pays you to NOT export |
| **-5 to 0** | Break-even curtailment | Curtail when export isn't profitable |
| **1 to 15** | Peak pricing avoidance | Curtail during low-price periods |
| **20+** | Aggressive conservation | Curtail most of the time (extreme case) |

### Configuration

Access in **Settings → Solar Curtailment → Price Threshold (cents/kWh)**

**Example Setup:**
```
Price Threshold: 5 cents/kWh
Current Market: 3¢/kWh
Result: ✓ Curtailment ACTIVE (3 < 5)

Price Threshold: 5 cents/kWh  
Current Market: 8¢/kWh
Result: ✗ Curtailment INACTIVE (8 >= 5)
```

### How It Works in Automation

1. **Every automation cycle** (default: every 2 minutes)
2. **Check:** Is curtailment enabled AND current price < threshold?
3. **If YES:** Activate solar curtailment (reduce exports)
4. **If NO:** Deactivate curtailment (allow normal exports)
5. **Log:** Each state change with price/threshold comparison

---

## Let's Go! 🚀

1. **Open:** https://inverter-automation-firebase.web.app/curtailment-discovery.html
2. **Click:** "Detect Topology Now"
3. **Read:** Your system's capabilities
4. **Decide:** Phase 2 timeline

You have everything you need. Let's build! 🌞⚡

---

*Questions? Check the docs. Ready to start Phase 2? Let's build it!*
