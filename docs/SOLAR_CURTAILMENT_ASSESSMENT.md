# Solar Curtailment Assessment & Implementation Plan

**Date:** December 20, 2025  
**Status:** Exploratory Analysis Complete  
**Recommendation:** Viable for DC-coupled systems; conditional for AC-coupled

---

## Executive Summary

Solar curtailment (export limiting) is **technically feasible** for your FoxESS KH-series system using the FoxESS Open API's `device/setting/set` endpoint. However, feasibility depends critically on **system topology** (DC-coupled vs AC-coupled) and **control authority** (which devices you can actually control).

### Key Finding
Your app already has the infrastructure in place:
- ✅ FoxESS API auth & token management
- ✅ Device setting read endpoint (`/op/v0/device/setting/get`)
- ✅ Device setting write endpoint (`/op/v0/device/setting/set`) — **we've tested WorkMode changes**
- ✅ Real-time inverter telemetry including `meterPower`, `meterPower2` (topology detection)
- ❌ No existing curtailment control logic (this is the gap)

---

## Part 1: Your System Architecture (DC-coupled)

### Current Topology
Based on the codebase and typical FoxESS KH10 deployments with solar:

```
Solar Panels (PV)
    ↓ DC ↓
[FoxESS Hybrid Inverter] ← DC input → Battery ← DC input ← Loads + Grid
    ↑ AC ↑                                    ↑ controlled by inverter
    └─ Grid Connection (AC) ─┘
```

**Telemetry variables you fetch:**
- `pvPower` — DC solar input (reliable for DC-coupled)
- `feedinPower` — AC power exported to grid
- `loadsPower` — AC loads being supplied
- `meterPower` / `meterPower2` — Secondary meter channels (if present)
- `batChargePower`, `batDischargePower` — Battery state

**For your system (DC-coupled), the control flow is straightforward:**
1. If solar is exceeding loads + grid import limits
2. FoxESS hybrid decides to export excess (or charge battery, or waste it)
3. You can cap the export via "Export Limit" (EL) setting

---

## Part 2: FoxESS API Capability Analysis

### 1. Real-Time Data Endpoints (Already Implemented)
```
POST /op/v0/device/real/query
Body: { sn, variables: [...] }
```
Returns telemetry. Your code uses this.

**Variables for curtailment decisions:**
- `pvPower` — Solar generation (DC-coupled)
- `feedinPower` — Current export
- `loadsPower` — Home consumption
- `SoC` — Battery state of charge
- `gridConsumptionPower` — Import from grid (may be negative = export)

### 2. Device Setting Read (Already Implemented)
```
POST /op/v0/device/setting/get
Body: { sn, key }
```
**Relevant keys for curtailment:**
- `ExportLimit` (boolean) — Enable/disable export limiting
- `ExportLimitPower` (integer, Watts) — Export cap (0 = no export)

Your code already has this:
```javascript
// Line 3879 in functions/index.js
const result = await callFoxESSAPI('/op/v0/device/setting/get', 'POST', 
  { sn, key }, userConfig, req.user.uid);
```

### 3. Device Setting Write (Already Implemented)
```
POST /op/v0/device/setting/set
Body: { sn, key, value }
```
Your code already uses this for WorkMode:
```javascript
// Line 4253 in functions/index.js
const result = await callFoxESSAPI('/op/v0/device/setting/set', 'POST', 
  { sn, key: 'WorkMode', value: workMode }, userConfig, req.user.uid);
```

**✅ THIS IS YOUR ENTRY POINT FOR CURTAILMENT.** You can set:
- `key: 'ExportLimit'`, `value: 1` (enable)
- `key: 'ExportLimit'`, `value: 0` (disable)
- `key: 'ExportLimitPower'`, `value: 0` (cap at 0W)
- `key: 'ExportLimitPower'`, `value: 5000` (cap at 5kW)

**Important caveat:** Exact key names are model/firmware-dependent. The FoxESS Open API docs list these, but you'll need to:
1. Test against your device to confirm key names
2. Possibly handle variations for different KH models (KH3.7, KH6.5, KH10, etc.)

---

## Part 3: Topology Detection (Critical for Multi-Installation Support)

### Why This Matters

Your assessment correctly identified: **AC-coupled systems break your assumption that `pvPower` = "all solar generation".**

Example scenario:
- User has separate solar inverter (AC-coupled) + FoxESS hybrid
- FoxESS real-time: `pvPower = 0` (no DC input)
- But `feedinPower = 5kW` (external solar exporting)
- Your app would miss the solar generation entirely

### Detection Algorithm

Implement in `functions/index.js` after fetching real-time data:

```javascript
/**
 * Detect system topology from real-time inverter data
 * Returns: 'dc-coupled', 'ac-coupled', 'hybrid', 'unknown'
 */
function detectSystemTopology(inverterData) {
  const result = inverterData.result?.[0];
  if (!result?.datas) return 'unknown';
  
  const datas = result.datas;
  const getVar = (name) => datas.find(d => d.variable === name)?.value ?? 0;
  
  const pvPower = getVar('pvPower');
  const feedinPower = getVar('feedinPower');
  const loadsPower = getVar('loadsPower');
  const generationPower = getVar('generationPower'); // Some models report total generation
  
  // AC-coupled indicator: external PV is producing but pvPower is ~0
  // (solar inverter is separate, not connected to FoxESS DC input)
  const isDaylight = new Date().getHours() >= 6 && new Date().getHours() <= 18;
  const hasFeedinButNoPV = feedinPower > 500 && pvPower < 100;
  const isLikelyACCoupled = isDaylight && hasFeedinButNoPV;
  
  // DC-coupled indicator: pvPower tracks solar generation
  const isLikelyDCCoupled = pvPower > 1000 || (pvPower > 0 && generationPower > 0);
  
  if (isLikelyACCoupled && !isLikelyDCCoupled) {
    return 'ac-coupled'; // Separate solar inverter
  } else if (isLikelyDCCoupled && !isLikelyACCoupled) {
    return 'dc-coupled'; // PV directly into FoxESS
  } else if (isLikelyACCoupled && isLikelyDCCoupled) {
    return 'hybrid'; // Both: FoxESS DC PV + external solar inverter
  }
  
  return 'unknown';
}
```

### Store Topology in User Config
```javascript
// In user config, add:
{
  automation: {
    systemTopology: 'dc-coupled', // detected value
    curtailmentCapability: {
      canControlFoxExportLimit: true,
      canControlExternalSolarInverter: false, // unknown brand/model
      isAmbertIntegrationEnabled: false
    }
  }
}
```

---

## Part 4: Curtailment Control Architecture

### A) Capability Matrix (Per User)

Add to the user's `config` document structure:

```javascript
{
  curtailmentCapability: {
    // Can we control the FoxESS hybrid export limit?
    canControlFoxHybridExportLimit: true, // Always yes for FoxESS
    
    // Can we control the external solar inverter (if AC-coupled)?
    externalSolarBrand: null, // 'Solarman', 'GoodWe', 'Fronius', null
    canControlExternalSolar: false,
    
    // Is Amber SmartShift active?
    amberSmartShiftActive: false,
    amberSmartShiftLastSync: null,
    
    // What curtailment strategies are available?
    availableStrategies: ['export-limit', 'load-following', 'on-off'],
    preferredStrategy: 'export-limit'
  }
}
```

### B) Curtailment API Endpoint

Add new endpoint to `functions/index.js`:

```javascript
// POST /api/curtailment/set
app.post('/api/curtailment/set', authenticateUser, async (req, res) => {
  const { action, targetExportW = 0, durationMs = null } = req.body;
  
  // action: 'enable' | 'disable' | 'set-limit'
  // targetExportW: 0 (no export) to infinity
  // durationMs: null (permanent) or milliseconds (temporary)
  
  const result = await setCurtailment(
    req.user.uid, 
    req.body.deviceSn,
    { action, targetExportW, durationMs }
  );
  
  res.json({ errno: result.errno, result: result.data, error: result.error });
});

/**
 * Execute curtailment control
 * @param {string} userId - Firestore user ID
 * @param {string} deviceSn - FoxESS device serial
 * @param {object} curtailmentRequest - { action, targetExportW, durationMs }
 * @returns { errno, data, error }
 */
async function setCurtailment(userId, deviceSn, curtailmentRequest) {
  const { action, targetExportW = 0, durationMs } = curtailmentRequest;
  
  try {
    // 1. Validate: user owns device, has curtailment capability
    const userConfig = await getUserConfig(userId);
    if (!userConfig?.curtailmentCapability?.canControlFoxHybridExportLimit) {
      return {
        errno: 403,
        error: 'Curtailment not enabled for this system'
      };
    }
    
    // 2. Get current state (for audit trail)
    const currentSettings = await callFoxESSAPI('/op/v0/device/setting/get', 'POST',
      { sn: deviceSn, key: 'ExportLimit' }, userConfig, userId);
    const currentLimit = await callFoxESSAPI('/op/v0/device/setting/get', 'POST',
      { sn: deviceSn, key: 'ExportLimitPower' }, userConfig, userId);
    
    // 3. Execute curtailment command
    let result;
    switch (action) {
      case 'enable':
        // Enable export limiting
        result = await callFoxESSAPI('/op/v0/device/setting/set', 'POST',
          { sn: deviceSn, key: 'ExportLimit', value: 1 }, userConfig, userId);
        break;
      
      case 'set-limit':
        // Set specific export limit (Watts)
        result = await callFoxESSAPI('/op/v0/device/setting/set', 'POST',
          { sn: deviceSn, key: 'ExportLimitPower', value: targetExportW }, 
          userConfig, userId);
        break;
      
      case 'disable':
        // Disable export limiting (restore default)
        result = await callFoxESSAPI('/op/v0/device/setting/set', 'POST',
          { sn: deviceSn, key: 'ExportLimit', value: 0 }, userConfig, userId);
        break;
      
      default:
        return { errno: 400, error: `Unknown curtailment action: ${action}` };
    }
    
    // 4. Log to audit trail
    if (result?.errno === 0) {
      await addCurtailmentAuditEntry(userId, {
        deviceSn,
        action,
        targetExportW,
        durationMs,
        previousSettings: { 
          exportLimit: currentSettings?.result,
          exportLimitPower: currentLimit?.result 
        },
        timestamp: Date.now(),
        triggeredBy: 'manual' // or 'automation'
      });
    }
    
    return result;
  } catch (err) {
    console.error(`[Curtailment] Error: ${err.message}`);
    return { errno: 500, error: err.message };
  }
}
```

---

## Part 5: Automation Rule Integration

### Extend Automation Rules with Curtailment Actions

Current rule structure (from `AUTOMATION.md`):
```json
{
  "name": "No Export Window",
  "conditions": [{ "field": "feedInPrice", "operator": "<=", "value": 0 }],
  "actions": [
    { "type": "discharge", "fdPwr": 5000, "duration": 60 }
  ]
}
```

**Proposed extension:**
```json
{
  "name": "Negative FiT Curtailment",
  "conditions": [{ "field": "feedInPrice", "operator": "<", "value": 0 }],
  "actions": [
    { "type": "curtail-export", "targetExportW": 0, "duration": 60 }
  ]
}
```

**At automation trigger time**, execute both discharge AND curtailment:

```javascript
// In runAutomation() — add alongside existing discharge logic
if (action.type === 'curtail-export') {
  console.log(`[Automation] Curtailing exports to ${action.targetExportW}W for ${action.duration} minutes`);
  
  // Call FoxESS to set export limit
  const curtailResult = await setCurtailment(userId, deviceSn, {
    action: 'set-limit',
    targetExportW: action.targetExportW,
    durationMs: action.duration * 60000
  });
  
  // Log result to audit
  auditData.curtailmentAction = {
    requested: action,
    result: curtailResult.errno === 0 ? 'success' : 'failed',
    error: curtailResult.error
  };
}
```

---

## Part 6: Edge Cases & Limitations

### 1. AC-Coupled Systems (You Cannot Curtail What You Don't Control)

**Scenario:** User has separate Solarman/GoodWe solar inverter + FoxESS battery

**Your app's limitation:**
- You can curtail FoxESS hybrid export limit ✅
- But the external solar inverter **still exports to grid** directly ❌
- Result: curtailment appears to "fail" or have no effect

**Solution:**
- Detect topology (`ac-coupled`)
- Show user: "External solar inverter detected. Curtailment will only limit battery discharge exports, not solar exports. Contact your installer to enable solar inverter control."
- Optionally: store external inverter info for future Solarman/GoodWe API integration

### 2. Amber SmartShift Conflict

**Scenario:** User enables Amber SmartShift + your app tries to curtail

**Risk:** Both controllers fighting over the same settings → unpredictable results

**Solution:**
- Detect if Amber SmartShift is active (user config flag or periodic check)
- In automation rules, add condition: `AND NOT amberSmartShift.isActive`
- Or: document "Amber SmartShift + manual curtailment not supported together"

### 3. Export Limit Key Name Variations

**Risk:** Different KH models may use different setting key names
- KH3.7: `ExportLimit` / `ExportLimitPower`
- KH6.5: `ExportLimit` / `ExportMaxPower`  (hypothetically)
- KH10: unknown (need to test)

**Solution:**
- At setup, probe: attempt to READ `ExportLimit`, `ExportLimitPower`, `ExportMaxPower`
- Cache the working key names in user config
- Fall back gracefully if none work

### 4. Inverter Propagation Delay

**Real behavior:** FoxESS may take 5-30 seconds to apply export limit changes

**Your app's impact:**
- Automation may exit (discharge) while export limit is still "pending"
- Actual export may differ from commanded limit for several seconds

**Solution:**
- Document in automation audit: "Limit may not apply instantly"
- In `roiSnapshot`, add `curtailmentTarget` vs `actualFeedin` (post-curtailment)
- Monitor real-time `feedinPower` for 30 seconds post-automation to verify

---

## Part 7: Implementation Roadmap

### Phase 1: Capability Detection (1 sprint)
- [ ] Implement `detectSystemTopology()` function
- [ ] Store topology + capabilities in user config
- [ ] Add API endpoint: `GET /api/curtailment/capabilities`
- [ ] Test on your DC-coupled system (confirm `pvPower` detection)
- [ ] Probe for actual ExportLimit key names on your KH10

### Phase 2: Basic Curtailment Control (1-2 sprints)
- [ ] Implement `setCurtailment()` function
- [ ] Add API endpoint: `POST /api/curtailment/set`
- [ ] Create audit trail: `addCurtailmentAuditEntry()`
- [ ] Test: manually enable/disable export limit via API
- [ ] Verify FoxESS Cloud reflects changes

### Phase 3: Automation Integration (1-2 sprints)
- [ ] Extend automation rule schema to include `curtail-export` action
- [ ] Update `runAutomation()` to execute curtailment at trigger time
- [ ] Add curtailment event to audit trail
- [ ] Test automation rule: negative FiT → curtailment trigger
- [ ] Log ROI impact: "Prevented X kWh export @ negative price"

### Phase 4: UI & User Guidance (1 sprint)
- [ ] Add "System Topology" display to settings
- [ ] Show curtailment capability status
- [ ] Add rule builder: "Curtail exports" action
- [ ] Display curtailment audit in dashboard (export limits applied)
- [ ] Warn users: "AC-coupled detected — curtailment limited to battery only"

### Phase 5: Advanced Features (Future)
- [ ] Temporary curtailment with auto-restore
- [ ] Curtailment conflict detection (Amber SmartShift)
- [ ] External solar inverter integrations (Solarman, GoodWe, Fronius)
- [ ] Dynamic export limit based on price (load-following mode)

---

## Part 8: Code Snippets & Testing

### Test 1: Detect Topology (Local Testing)

```javascript
// Test data: DC-coupled system
const dcCoupledData = {
  result: [{
    datas: [
      { variable: 'pvPower', value: 3500 },
      { variable: 'feedinPower', value: 2800 },
      { variable: 'loadsPower', value: 1200 },
      { variable: 'generationPower', value: 3500 }
    ]
  }]
};
console.log(detectSystemTopology(dcCoupledData)); // Should return 'dc-coupled'

// Test data: AC-coupled system (daytime, no PV, but exporting)
const acCoupledData = {
  result: [{
    datas: [
      { variable: 'pvPower', value: 0 },      // No DC input to FoxESS
      { variable: 'feedinPower', value: 5000 }, // But exporting
      { variable: 'loadsPower', value: 1200 },
      { variable: 'generationPower', value: 0 }
    ]
  }]
};
console.log(detectSystemTopology(acCoupledData)); // Should return 'ac-coupled'
```

### Test 2: Read Current Export Limit (Firebase Emulator)

```bash
# Terminal 1: Start emulator
npm --prefix functions run serve

# Terminal 2: Test GET
curl -X POST http://localhost:5001/inverter-automation-firebase/us-central1/api/api/device/setting/get \
  -H "Authorization: Bearer <test-token>" \
  -H "Content-Type: application/json" \
  -d '{"sn": "YOUR_DEVICE_SN", "key": "ExportLimit"}'

# Expected response
# { "errno": 0, "result": { "errno": 0, "data": { "value": 0 } } }
```

### Test 3: Set Export Limit to 0 (Curtail All Exports)

```bash
curl -X POST http://localhost:5001/inverter-automation-firebase/us-central1/api/api/curtailment/set \
  -H "Authorization: Bearer <test-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "set-limit",
    "targetExportW": 0,
    "durationMs": null
  }'

# Expected: FoxESS device applies export limit instantly
# Watch FoxESS Cloud UI — feedinPower should drop to ~0
```

---

## Part 9: Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| AC-coupled undetected → false confidence in curtailment | High | Phase 1: Topology detection + user warning |
| Export limit key mismatch (model-specific) | Medium | Phase 1: Key name probing at setup |
| Amber SmartShift conflict | Medium | Phase 4: Capability check before automation |
| Inverter lag (setting not applied instantly) | Low | Document in audit trail, monitor post-action |
| User disables curtailment manually in FoxESS Cloud | Low | Next sync will restore; log discrepancy in audit |
| API auth token expires mid-curtailment | Low | Token refresh already handled by `callFoxESSAPI` |

---

## Part 10: Conclusion & Recommendation

### For Your System (DC-Coupled FoxESS KH10)

**✅ Go ahead with implementation.** You have:
- Clear control path: FoxESS hybrid PV → export limit setting
- No competing AC-coupled inverter
- API endpoints already in place
- User config structure for capability flags

**Start with Phase 1 (topology detection)** even though you don't have AC-coupled users yet. This prevents future bugs when/if you do.

### Estimated Effort
- **Phase 1**: 2-3 days (detection, probing)
- **Phase 2**: 3-5 days (API, audit logging)
- **Phase 3**: 4-6 days (automation integration, testing)
- **Phase 4**: 2-3 days (UI, warnings)
- **Total**: ~2-3 weeks for MVP (Phases 1-3)

### Success Metrics
- ✅ Negative FiT automation rule triggers curtailment successfully
- ✅ ROI dashboard shows "Exports curtailed: 2.4 kWh saved @ -5¢/kWh = $0.12 savings"
- ✅ Audit trail logs every curtailment action + FoxESS response
- ✅ UI warns AC-coupled users of limitations
- ✅ No conflicts with Amber SmartShift

---

## References

1. **FoxESS Open API**: https://www.foxesscloud.com/public/i18n/en/OpenApiDocument.html
   - `/op/v0/device/setting/get` — Read device settings
   - `/op/v0/device/setting/set` — Write device settings
   - Key: `ExportLimit` (boolean), `ExportLimitPower` (integer, Watts)

2. **Amber Electric Documentation**:
   - [Solar curtailment mechanics](https://help.amber.com.au/hc/en-us/articles/30479419989005-Solar-curtailment-to-maximise-feed-in-earnings)
   - [FoxESS enrollment](https://help.amber.com.au/hc/en-us/articles/38980157821197-Enrolling-your-FoxESS-system-with-Amber)
   - [Known SmartShift issues](https://help.amber.com.au/hc/en-us/articles/35922375367181-Known-issues-and-outages-affecting-the-Amber-for-Batteries-automation)

3. **Your Codebase**:
   - `functions/index.js`: Lines 955-1050 (`callFoxESSAPI`)
   - `functions/index.js`: Line 4253 (existing `device/setting/set` usage)
   - `docs/AUTOMATION.md`: Rule schema + execution logic

---

**Next Step:** Would you like me to begin Phase 1 implementation (topology detection + capability matrix)?
