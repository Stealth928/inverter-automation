
    const output = document.getElementById('output');
    let currentDeviceProvider = 'foxess';
    let currentProviderCapabilities = resolveProviderCapabilities(currentDeviceProvider);
    const DEFAULT_AC_SOLAR_VARIABLES = Object.freeze(['meterPower2', 'meterPower', 'generationPower', 'generation']);
    const telemetryMappingState = {
      acSolarPowerVariable: '',
      recommendedAcSolarPowerVariable: '',
      availableVariables: new Set(DEFAULT_AC_SOLAR_VARIABLES),
      sampleValues: new Map()
    };

    function normalizeTelemetryVariableName(value) {
      return String(value || '').trim().replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64);
    }

    function resolveProviderCapabilities(provider) {
      if (window.sharedUtils && typeof window.sharedUtils.getProviderCapabilities === 'function') {
        return window.sharedUtils.getProviderCapabilities(provider);
      }
      const normalized = String(provider || 'foxess').toLowerCase();
      return {
        provider: normalized,
        supportsDirectWorkMode: normalized === 'foxess',
        supportsBackupMode: normalized === 'foxess',
        supportsAdvancedDeviceControls: normalized === 'foxess',
        supportsTelemetrySourceMapping: normalized === 'foxess',
        supportsQuickControl: normalized !== 'sigenergy',
        supportsSchedulerControl: normalized !== 'sigenergy'
      };
    }

    function getDirectWorkModeNotice(capabilities = currentProviderCapabilities) {
      const provider = capabilities?.provider || 'foxess';
      if (provider === 'alphaess') {
        return '<strong>AlphaESS note:</strong> Direct Work Mode control is unavailable because AlphaESS OpenAPI only supports scheduler-based overrides. Use Scheduler or Quick Control for temporary charge/discharge changes.';
      }
      if (provider === 'sungrow') {
        return '<strong>Sungrow note:</strong> Direct Work Mode control is hidden because the current Sungrow integration still maps work modes through FoxESS-style labels. Use Scheduler or Quick Control for temporary charge/discharge actions until vendor-specific mode handling is implemented.';
      }
      if (provider === 'sigenergy') {
        return '<strong>SigenEnergy note:</strong> Direct Work Mode control is hidden because the current Sigenergy integration only supports a limited subset of public operating modes. Use the Sigenergy app for mode changes until the adapter is completed.';
      }
      return '';
    }

    function getDirectWorkModePlainMessage(provider = currentDeviceProvider) {
      const normalized = String(provider || 'foxess').toLowerCase();
      if (normalized === 'alphaess') {
        return 'AlphaESS does not support direct work mode switching through OpenAPI. Use Scheduler or Quick Control instead.';
      }
      if (normalized === 'sungrow') {
        return 'Sungrow direct work mode switching is hidden because the current integration still maps work modes through FoxESS-style labels. Use Scheduler or Quick Control instead.';
      }
      if (normalized === 'sigenergy') {
        return 'SigenEnergy direct work mode switching is hidden because the current integration only supports a limited subset of public operating modes. Use the Sigenergy app instead.';
      }
      return 'Direct work mode switching is unavailable for this provider.';
    }

    function getCanonicalWorkModeLabel(provider, modeKey) {
      const normalized = String(provider || currentDeviceProvider || 'foxess').toLowerCase();
      const labels = {
        SelfUse: 'Self Use',
        Feedin: normalized === 'sigenergy' ? 'Fully Fed to Grid' : 'Feed In',
        FeedinFirst: 'Feed In First',
        ForceCharge: 'Force Charge',
        ForceDischarge: 'Force Discharge',
        Backup: 'Backup',
        PeakShaving: 'Peak Shaving',
        VPP: 'Virtual Power Plant'
      };
      return labels[modeKey] || String(modeKey || 'Unknown');
    }

    function resolveWorkModeResultPayload(payload = {}) {
      const result = payload?.result || {};
      if (typeof result.workMode === 'string' && result.workMode.trim()) {
        const modeKey = result.workMode.trim();
        return {
          modeKey,
          modeName: String(result.displayName || getCanonicalWorkModeLabel(result.provider || currentDeviceProvider, modeKey)),
          rawValue: result.raw ?? result.value ?? null
        };
      }

      const numericMode = result.value;
      const workModeMap = {
        0: 'SelfUse',
        1: 'Feedin',
        2: 'Backup',
        3: 'PeakShaving'
      };
      return {
        modeKey: workModeMap[numericMode] || numericMode,
        modeName: getCanonicalWorkModeLabel(currentDeviceProvider, workModeMap[numericMode] || numericMode),
        rawValue: numericMode
      };
    }
    
    AppShell.init({
      pageName: 'controls',
      autoMetrics: true,
      onReady: async () => {
        // Apply provider-specific restrictions before the tour highlights controls.
        await initProviderUI();
        await loadTelemetryMappings();
        try { TourEngine.init(window.apiClient); TourEngine.resume(); } catch(e) {}
      }
    });

    /** Hide FoxESS-only cards and options for non-FoxESS providers. */
    async function initProviderUI() {
      try {
        const statusRes = await window.apiClient.getSetupStatus();
        const provider = String(statusRes?.result?.deviceProvider || 'foxess').toLowerCase();
        currentDeviceProvider = provider;
        currentProviderCapabilities = resolveProviderCapabilities(provider);
        const providerNote = document.getElementById('controls-provider-note');
        const workModeCard = document.getElementById('card-work-mode');
        if (!currentProviderCapabilities.supportsAdvancedDeviceControls) {
          const socCard = document.getElementById('card-battery-soc');
          const fcCard = document.getElementById('card-force-charge');
          if (socCard) socCard.style.display = 'none';
          if (fcCard) fcCard.style.display = 'none';
        }
        if (!currentProviderCapabilities.supportsBackupMode) {
          const backupOpts = document.querySelectorAll('select[name="workMode"] option[value="Backup"], select[name="workMode"] option[data-foxess-sungrow-only]');
          backupOpts.forEach((opt) => opt.remove());
        }
        if (!currentProviderCapabilities.supportsDirectWorkMode) {
          if (workModeCard) workModeCard.style.display = 'none';
          if (providerNote) {
            providerNote.innerHTML = getDirectWorkModeNotice(currentProviderCapabilities);
            providerNote.style.display = providerNote.innerHTML ? '' : 'none';
          }
        } else if (providerNote) {
          providerNote.style.display = 'none';
          providerNote.textContent = '';
        }
        syncTelemetryMappingVisibility();
        return provider;
      } catch (e) {
        // Ignore errors — if setup status is unavailable, show all controls
        syncTelemetryMappingVisibility();
        return currentDeviceProvider;
      }
    }

    function showStatus(formId, message, type = 'info') {
      const statusEl = document.getElementById(`status-${formId}`);
      if (statusEl) {
        statusEl.innerHTML = `<div class="status-message ${type}">${message}</div>`;
        setTimeout(() => statusEl.innerHTML = '', 5000);
      }
    }

    function clearOutput() {
      output.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-secondary);font-size:13px">📋 Output cleared. Run an action or diagnostic to see results...</div>';
    }

    function displayFormattedResponse(title, data) {
      const isSuccess = data.errno === 0;
      const statusColor = isSuccess ? 'var(--color-success)' : 'var(--color-danger)';
      const statusIcon = isSuccess ? '✅' : '❌';
      
      let html = `<div style="border-bottom:1px solid var(--border-secondary);padding-bottom:10px;margin-bottom:12px">`;
      html += `<div style="font-size:14px;font-weight:600;color:${statusColor};margin-bottom:4px">${statusIcon} ${title}</div>`;
      html += `<div style="font-size:11px;color:var(--text-secondary)">Status: ${data.errno === 0 ? 'Success' : 'Error'} • Code: ${data.errno}</div>`;
      html += `</div>`;
      
      if (data.msg) {
        html += `<div style="padding:8px;background:var(--accent-blue-bg);border-radius:6px;margin-bottom:10px;font-size:12px;color:var(--accent-blue-hover)">📝 ${data.msg}</div>`;
      }
      if (data.error) {
        html += `<div style="padding:8px;background:var(--color-danger-bg);border:1px solid color-mix(in srgb,var(--color-danger) 30%,transparent);border-radius:6px;margin-bottom:10px;font-size:12px;color:var(--color-danger)">⚠️ ${data.error}</div>`;
      }
      
      if (data.result) {
        html += `<div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">Result Data:</div>`;
        html += `<div style="background:color-mix(in srgb,#000 30%,transparent);padding:10px;border-radius:6px;border:1px solid var(--border-secondary)">`;
        
        if (typeof data.result === 'object' && !Array.isArray(data.result)) {
          for (const [key, value] of Object.entries(data.result)) {
            const displayValue = typeof value === 'object' ? JSON.stringify(value) : value;
            html += `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid color-mix(in srgb,var(--border-primary) 30%,transparent)">`;
            html += `<span style="color:var(--text-secondary);font-size:12px">${key}:</span>`;
            html += `<span style="color:var(--color-terminal-text);font-size:12px;font-weight:500">${displayValue}</span>`;
            html += `</div>`;
          }
        } else {
          html += `<pre style="margin:0;color:var(--color-terminal-text);font-size:11px;white-space:pre-wrap">${JSON.stringify(data.result, null, 2)}</pre>`;
        }
        html += `</div>`;
      }
      
      html += `<details style="margin-top:12px;cursor:pointer">`;
      html += `<summary style="color:var(--text-secondary);font-size:11px;padding:6px;background:var(--bg-overlay);border-radius:4px">🔍 View Raw JSON</summary>`;
      html += `<pre style="margin:8px 0 0 0;padding:10px;background:var(--bg-terminal);border-radius:6px;font-size:11px;color:var(--color-terminal-text);overflow:auto">${JSON.stringify(data, null, 2)}</pre>`;
      html += `</details>`;
      
      output.innerHTML = html;
    }

    // Battery SoC Functions
    async function setBatterySoc(e) {
      e.preventDefault();
      const form = e.target;
      const minSoc = parseInt(form.minSoc.value);
      const minSocOnGrid = parseInt(form.minSocOnGrid.value);
      const maxSoc = parseInt(form.maxSoc.value);
      
      console.log('[BatterySoC] Saving settings: minSoc:', minSoc, 'minSocOnGrid:', minSocOnGrid, 'maxSoc:', maxSoc);
      showStatus('batterySoc', '⏳ Saving battery SoC settings...', 'info');
      
      try {
        // Step 1: Set minSoc and minSocOnGrid via battery/soc/set API
        console.log('[BatterySoC] Step 1: Setting minSoc and minSocOnGrid via /api/device/battery/soc/set');
        const res1 = await authenticatedFetch('/api/device/battery/soc/set', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ minSoc, minSocOnGrid })
        });
        const result1 = await res1.json();
        console.log('[BatterySoC] Battery SoC API response:', result1);
        
        if (result1.errno !== 0) {
          throw new Error(`Failed to set min SoC: ${result1.msg || 'Unknown error'}`);
        }
        
        // Step 2: Set maxSoc via device/setting/set API (MaxSoc is a device setting, not a battery/soc parameter)
        console.log('[BatterySoC] Step 2: Setting maxSoc via /api/device/setting/set with key="MaxSoc"');
        const res2 = await authenticatedFetch('/api/device/setting/set', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'MaxSoc', value: maxSoc })
        });
        const result2 = await res2.json();
        console.log('[BatterySoC] Device setting API response:', result2);
        
        if (result2.errno !== 0) {
          throw new Error(`Min SoC saved, but MaxSoc failed: ${result2.msg || 'Unknown error'}`);
        }
        
        console.log('[BatterySoC] ✅ All settings saved successfully');
        showStatus('batterySoc', '✅ Battery SoC settings saved successfully!', 'success');
        displayFormattedResponse('Battery SoC Settings (Combined)', {
          errno: 0,
          msg: 'All settings saved',
          batterySocResult: result1,
          maxSocResult: result2
        });
      } catch (error) {
        console.error('[BatterySoC] Error:', error);
        showStatus('batterySoc', `❌ Error: ${error.message}`, 'error');
      }
    }

    async function getBatterySoc() {
      showStatus('batterySoc', '⏳ Loading current settings...', 'info');
      try {
        // Step 1: Get minSoc and minSocOnGrid from battery/soc/get
        console.log('[BatterySoC] Loading: Step 1 - Fetching battery/soc/get');
        const res1 = await authenticatedFetch('/api/device/battery/soc/get');
        const contentType = res1.headers.get('content-type');
        
        if (!res1.ok) {
          throw new Error(`HTTP ${res1.status}: ${res1.statusText}`);
        }
        
        let result1;
        if (contentType && contentType.includes('application/json')) {
          result1 = await res1.json();
        } else {
          const text = await res1.text();
          showStatus('batterySoc', `❌ Error: Server returned invalid response (${text.substring(0, 100)})`, 'error');
          return;
        }
        
        console.log('[BatterySoC] Battery SoC GET response:', result1);
        
        // Step 2: Get maxSoc from device setting (MaxSoc is a device setting)
        console.log('[BatterySoC] Loading: Step 2 - Fetching device/setting/get for MaxSoc');
        const res2 = await authenticatedFetch('/api/device/setting/get', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'MaxSoc' })
        });
        const result2 = await res2.json();
        console.log('[BatterySoC] MaxSoc device setting response:', result2);
        
        if (result1.errno === 0 && result1.result) {
          const form = document.getElementById('form-batterySoc');
          form.minSoc.value = result1.result.minSoc || 10;
          form.minSocOnGrid.value = result1.result.minSocOnGrid || 10;
          form.maxSoc.value = (result2.errno === 0 && result2.result?.value) ? result2.result.value : 90;
          
          console.log('[BatterySoC] ✅ Loaded all settings successfully');
          showStatus('batterySoc', '✅ Loaded current settings', 'success');
          displayFormattedResponse('Battery SoC Settings (Combined)', {
            errno: 0,
            msg: 'Settings loaded',
            batterySoc: result1.result,
            maxSoc: result2.result
          });
        } else {
          showStatus('batterySoc', `❌ ${result1.msg || 'Failed to load settings'}`, 'error');
        }
      } catch (error) {
        console.error('[BatterySoC] Load error:', error);
        showStatus('batterySoc', `❌ Error: ${error.message}`, 'error');
      }
    }

    // Work Mode Functions
    async function setWorkMode(e) {
      e.preventDefault();
      if (!currentProviderCapabilities.supportsDirectWorkMode) {
        const message = getDirectWorkModePlainMessage(currentDeviceProvider);
        showStatus('workMode', `⚠️ ${message}`, 'error');
        displayFormattedResponse('Work Mode Setting', {
          errno: 3500,
          error: message
        });
        return;
      }
      const form = e.target;
      const workMode = form.workMode.value;
      
      if (!workMode) {
        showStatus('workMode', '⚠️ Please select a work mode', 'error');
        return;
      }
      
      showStatus('workMode', `⏳ Setting work mode to ${workMode}...`, 'info');
      
      try {
        const res = await authenticatedFetch('/api/device/workmode/set', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workMode })
        });
        const result = await res.json();
        
        if (result.errno === 0) {
          showStatus('workMode', `✅ Work mode set to ${workMode} successfully!`, 'success');
          document.getElementById('currentWorkMode').innerHTML = `Current mode: <span style="color:var(--color-success)">${workMode}</span>`;
          displayFormattedResponse('Work Mode Setting', result);
        } else {
          showStatus('workMode', `❌ Error: ${result.msg || 'Failed to set work mode'}`, 'error');
          displayFormattedResponse('Work Mode Setting', result);
        }
      } catch (error) {
        showStatus('workMode', `❌ Error: ${error.message}`, 'error');
      }
    }

    async function getWorkMode() {
      if (!currentProviderCapabilities.supportsDirectWorkMode) {
        const message = getDirectWorkModePlainMessage(currentDeviceProvider);
        showStatus('workMode', `⚠️ ${message}`, 'error');
        displayFormattedResponse('Work Mode Setting', {
          errno: 3500,
          error: message
        });
        return;
      }
      try {
        const res = await authenticatedFetch('/api/device/workmode/get');
        const result = await res.json();
        
        if (result.errno === 0 && result.result) {
          const { modeKey, modeName } = resolveWorkModeResultPayload(result);
          
          document.getElementById('currentWorkMode').innerHTML = `Current mode: <span style="color:var(--color-success)">${modeName}</span>`;
          
          const select = document.querySelector('#form-workMode select[name="workMode"]');
          if (select && Array.from(select.options || []).some((option) => option.value === modeKey)) {
            select.value = modeKey;
          }
          
          showStatus('workMode', '✅ Loaded current work mode', 'success');
          displayFormattedResponse('Work Mode Setting', result);
        } else {
          showStatus('workMode', `❌ ${result.msg || 'Failed to get work mode'}`, 'error');
          displayFormattedResponse('Work Mode Setting', result);
        }
      } catch (error) {
        showStatus('workMode', `❌ Error: ${error.message}`, 'error');
      }
    }

    // Force Charge Times Functions
    async function setForceChargeTimes(e) {
      e.preventDefault();
      const form = e.target;
      
      const parseTime = (timeStr) => {
        const [hour, minute] = timeStr.split(':').map(Number);
        return { hour, minute };
      };
      
      const data = {
        enable1: form.enable1.checked,
        enable2: form.enable2.checked,
        startTime1: parseTime(form.startTime1.value),
        endTime1: parseTime(form.endTime1.value),
        startTime2: parseTime(form.startTime2.value),
        endTime2: parseTime(form.endTime2.value)
      };
      
      showStatus('forceCharge', '⏳ Saving force charge times...', 'info');
      
      try {
        const res = await authenticatedFetch('/api/device/battery/forceChargeTime/set', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        const result = await res.json();
        
        if (result.errno === 0) {
          showStatus('forceCharge', '✅ Force charge times saved successfully!', 'success');
          displayFormattedResponse('Force Charge Times', result);
        } else {
          showStatus('forceCharge', `❌ Error: ${result.msg || 'Failed to save times'}`, 'error');
          displayFormattedResponse('Force Charge Times', result);
        }
      } catch (error) {
        showStatus('forceCharge', `❌ Error: ${error.message}`, 'error');
      }
    }

    async function getForceChargeTimes() {
      try {
        const res = await authenticatedFetch('/api/device/battery/forceChargeTime/get');
        const result = await res.json();
        
        if (result.errno === 0 && result.result) {
          const form = document.getElementById('form-forceCharge');
          const data = result.result;
          
          form.enable1.checked = data.enable1 || false;
          form.enable2.checked = data.enable2 || false;
          
          const formatTime = (obj) => {
            const h = String(obj.hour || 0).padStart(2, '0');
            const m = String(obj.minute || 0).padStart(2, '0');
            return `${h}:${m}`;
          };
          
          form.startTime1.value = formatTime(data.startTime1 || {});
          form.endTime1.value = formatTime(data.endTime1 || {});
          form.startTime2.value = formatTime(data.startTime2 || {});
          form.endTime2.value = formatTime(data.endTime2 || {});
          
          showStatus('forceCharge', '✅ Loaded current charge times', 'success');
          displayFormattedResponse('Force Charge Times', result);
        } else {
          showStatus('forceCharge', `❌ ${result.msg || 'Failed to load times'}`, 'error');
          displayFormattedResponse('Force Charge Times', result);
        }
      } catch (error) {
        showStatus('forceCharge', `❌ Error: ${error.message}`, 'error');
      }
    }

    // Load API metrics
    async function loadApiMetrics(days = 1) {
      try {
        // Use scope=user to show per-user metrics, not global platform totals
        const resp = await authenticatedFetch(`/api/metrics/api-calls?days=${encodeURIComponent(days)}&scope=user`);
        const data = await resp.json();
        if (!data || data.errno !== 0 || !data.result) return;
        const keys = Object.keys(data.result).sort().reverse();
        const todayKey = keys[0];
        const today = data.result[todayKey] || {};

        const dateObj = new Date(todayKey);
        const formatted = dateObj.toLocaleDateString('en-AU', { month: 'short', day: 'numeric', year: 'numeric' });
        const toCounter = (value) => {
          const n = Number(value);
          return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
        };
        const fallbackEvCounter = (metrics = {}) => {
          const fleet = metrics.teslaFleet || metrics.teslafleet || null;
          if (toCounter(metrics.ev)) return toCounter(metrics.ev);
          if (toCounter(metrics.tesla)) return toCounter(metrics.tesla);
          if (toCounter(fleet?.calls?.billable)) return toCounter(fleet.calls.billable);
          if (toCounter(fleet?.calls?.total)) return toCounter(fleet.calls.total);
          const byCategory = fleet && fleet.calls && fleet.calls.byCategory;
          if (byCategory && typeof byCategory === 'object') {
            const sum = Object.values(byCategory).reduce((acc, value) => acc + toCounter(value), 0);
            if (sum) return sum;
          }
          return 0;
        };
        document.getElementById('metricsDate').textContent = formatted;
        const inverterCount = (typeof getInverterApiCount === 'function')
          ? getInverterApiCount(today)
          : toCounter(today.inverter ?? today.foxess ?? 0);
        const evCount = (typeof getEvApiCount === 'function')
          ? getEvApiCount(today)
          : fallbackEvCounter(today);
        document.getElementById('countFox').textContent = inverterCount;
        document.getElementById('countAmber').textContent = toCounter(today.amber);
        document.getElementById('countWeather').textContent = toCounter(today.weather);
        const evEl = document.getElementById('countEV');
        if (evEl) evEl.textContent = evCount;
      } catch (e) {
        console.warn('Failed to load api metrics', e.message);
      }
    }

    function syncTelemetryMappingVisibility() {
      const panel = document.getElementById('acSolarMappingPanel');
      const steps = document.getElementById('acSolarMappingSteps');
      const controls = document.getElementById('acSolarMappingControls');
      const providerNote = document.getElementById('acSolarMappingProviderNote');
      const locked = document.getElementById('acSolarMappingLocked');
      const select = document.getElementById('acSolarPowerVariable');
      const saveBtn = document.getElementById('btnSaveAcSolarMapping');
      const clearBtn = document.getElementById('btnClearAcSolarMapping');
      const mappingSupported = currentProviderCapabilities?.supportsTelemetrySourceMapping === true;
      const providerLabel = currentProviderCapabilities?.label || String(currentDeviceProvider || 'Unknown');

      if (!panel) return;

      if (steps) {
        steps.style.display = mappingSupported ? 'grid' : 'none';
      }
      if (controls) {
        controls.style.display = mappingSupported ? 'block' : 'none';
      }

      if (providerNote) {
        providerNote.style.display = mappingSupported ? 'none' : 'block';
        providerNote.textContent = mappingSupported
          ? ''
          : `${providerLabel} currently exposes normalized adapter telemetry here, not stable raw source fields, so manual AC solar source mapping is disabled.`;
      }

      if (locked) {
        locked.style.display = mappingSupported ? 'none' : 'block';
        locked.innerHTML = mappingSupported
          ? ''
          : `This override stays off for <strong>${providerLabel}</strong> until that adapter exposes raw source candidates with stable semantics. Otherwise the picker would only offer synthesized fields and could create incorrect solar totals.`;
      }

      [select, saveBtn, clearBtn].forEach((el) => {
        if (el) el.disabled = !mappingSupported;
      });

      if (!mappingSupported) {
        setTelemetryMappingStatus('', 'info');
      }
    }

    function setTelemetryMappingStatus(message, type = 'info') {
      const status = document.getElementById('status-telemetryMapping');
      if (!status) return;
      status.innerHTML = message
        ? `<div class="status-message ${type}">${message}</div>`
        : '';
    }

    function formatTelemetryPower(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return null;
      const kw = Math.abs(numeric) > 100 ? (numeric / 1000) : numeric;
      return `${Math.abs(kw).toFixed(2)} kW`;
    }

    function mergeTelemetryVariables(variables = []) {
      variables.forEach((value) => {
        const normalized = normalizeTelemetryVariableName(value);
        if (!normalized) return;
        if (normalized === 'acSolarPower' || normalized === 'solarPowerTotal') return;
        telemetryMappingState.availableVariables.add(normalized);
      });
    }

    function updateTelemetrySampleValues(datas = []) {
      telemetryMappingState.sampleValues.clear();
      if (!Array.isArray(datas)) return;
      datas.forEach((entry) => {
        const variable = normalizeTelemetryVariableName(entry?.variable || entry?.key);
        if (!variable) return;
        telemetryMappingState.sampleValues.set(variable, entry?.value);
      });
    }

    function renderTelemetryMappingOptions() {
      const select = document.getElementById('acSolarPowerVariable');
      if (!select) return;

      const currentSelection = normalizeTelemetryVariableName(select.value) || telemetryMappingState.acSolarPowerVariable;
      const ordered = Array.from(new Set([
        telemetryMappingState.acSolarPowerVariable,
        telemetryMappingState.recommendedAcSolarPowerVariable,
        ...DEFAULT_AC_SOLAR_VARIABLES,
        ...Array.from(telemetryMappingState.availableVariables)
      ].filter(Boolean)));

      ordered.sort((left, right) => {
        const score = (value) => {
          if (value === telemetryMappingState.acSolarPowerVariable) return 0;
          if (value === telemetryMappingState.recommendedAcSolarPowerVariable) return 1;
          const defaultIndex = DEFAULT_AC_SOLAR_VARIABLES.indexOf(value);
          return defaultIndex >= 0 ? defaultIndex + 2 : 100;
        };
        const diff = score(left) - score(right);
        return diff !== 0 ? diff : left.localeCompare(right);
      });

      let html = '<option value="">Auto-detect (leave unset)</option>';
      ordered.forEach((variable) => {
        let label = variable;
        if (variable === telemetryMappingState.acSolarPowerVariable) {
          label += ' (Saved)';
        } else if (variable === telemetryMappingState.recommendedAcSolarPowerVariable) {
          label += ' (Recommended)';
        }
        html += `<option value="${variable}">${label}</option>`;
      });
      select.innerHTML = html;
      select.value = ordered.includes(currentSelection) ? currentSelection : '';
      updateTelemetryMappingSummary();
    }

    function updateTelemetryMappingSummary() {
      const select = document.getElementById('acSolarPowerVariable');
      const meta = document.getElementById('acSolarMappingMeta');
      if (!select || !meta) return;

      const selected = normalizeTelemetryVariableName(select.value);
      const saved = normalizeTelemetryVariableName(telemetryMappingState.acSolarPowerVariable);
      const sampleValue = selected ? telemetryMappingState.sampleValues.get(selected) : null;
      const parts = [];

      if (saved) {
        parts.push(`Saved for this account: <code>${saved}</code>.`);
      } else {
        parts.push('Currently using auto-detect.');
      }

      if (selected) {
        if (selected !== saved) {
          parts.push('Selection has not been saved yet.');
        }
        const formattedValue = formatTelemetryPower(sampleValue);
        if (formattedValue) {
          parts.push(`Latest sampled value for <code>${selected}</code>: <strong>${formattedValue}</strong>.`);
        } else {
          parts.push('Run "Get All Real-Time Data" during solar production to verify this field.');
        }
      } else {
        parts.push('Leave this blank unless you need to override AC-coupled solar detection.');
      }

      meta.innerHTML = parts.join(' ');
    }

    function updateTelemetryRecommendation(hints = null) {
      const box = document.getElementById('acSolarRecommendation');
      if (!box) return;

      const recommended = normalizeTelemetryVariableName(hints?.recommendedAcSolarVariable || '');
      telemetryMappingState.recommendedAcSolarPowerVariable = recommended;

      if (!recommended) {
        box.style.display = 'block';
        box.innerHTML = 'Recommendation will appear here after you run <strong>Get All Real-Time Data</strong> during solar production.';
        renderTelemetryMappingOptions();
        return;
      }

      const formattedPower = formatTelemetryPower(hints?.acSolarPower ?? hints?.meterPower2 ?? hints?.meterPower);
      const alreadySaved = normalizeTelemetryVariableName(telemetryMappingState.acSolarPowerVariable) === recommended;
      box.style.display = 'block';
      box.innerHTML = alreadySaved
        ? `Saved mapping <code>${recommended}</code> matches the latest live recommendation${formattedPower ? ` (${formattedPower})` : ''}.`
        : `Latest live sample suggests <code>${recommended}</code>${formattedPower ? ` (${formattedPower})` : ''} for AC-coupled solar. <button type="button" class="btn btn-primary" style="width:auto;padding:6px 10px;margin-left:8px" onclick="applyRecommendedAcSolarMapping()">Use recommendation</button>`;
      renderTelemetryMappingOptions();
    }

    async function loadTelemetryMappings() {
      const select = document.getElementById('acSolarPowerVariable');
      if (!select) return;

      try {
        const resp = await authenticatedFetch('/api/config/telemetry-mappings');
        const result = await resp.json();
        if (result?.errno === 0) {
          telemetryMappingState.acSolarPowerVariable = normalizeTelemetryVariableName(result.result?.acSolarPowerVariable);
          mergeTelemetryVariables([telemetryMappingState.acSolarPowerVariable]);
        }
      } catch (error) {
        console.warn('Failed to load telemetry mappings:', error.message);
      }

      if (select.dataset.bound !== '1') {
        select.dataset.bound = '1';
        select.addEventListener('change', () => updateTelemetryMappingSummary());
      }

      renderTelemetryMappingOptions();
      updateTelemetryRecommendation(null);
      syncTelemetryMappingVisibility();
    }

    async function persistTelemetryMappings(acSolarPowerVariable) {
      const normalized = normalizeTelemetryVariableName(acSolarPowerVariable);
      setTelemetryMappingStatus('⏳ Saving telemetry mapping...', 'info');

      const resp = await authenticatedFetch('/api/config/telemetry-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acSolarPowerVariable: normalized })
      });
      const result = await resp.json();
      if (!resp.ok || result?.errno !== 0) {
        throw new Error(result?.error || result?.msg || `HTTP ${resp.status}`);
      }

      telemetryMappingState.acSolarPowerVariable = normalizeTelemetryVariableName(result.result?.acSolarPowerVariable);
      mergeTelemetryVariables([telemetryMappingState.acSolarPowerVariable]);
      renderTelemetryMappingOptions();
      setTelemetryMappingStatus(
        telemetryMappingState.acSolarPowerVariable
          ? `✅ Saved AC solar mapping to ${telemetryMappingState.acSolarPowerVariable}.`
          : '✅ Cleared AC solar mapping. Auto-detect is active again.',
        'success'
      );
      displayFormattedResponse('Telemetry Mappings', result);
    }

    async function saveTelemetryMappings() {
      try {
        const select = document.getElementById('acSolarPowerVariable');
        await persistTelemetryMappings(select ? select.value : '');
      } catch (error) {
        setTelemetryMappingStatus(`❌ Error: ${error.message}`, 'error');
      }
    }

    async function clearTelemetryMappings() {
      try {
        await persistTelemetryMappings('');
      } catch (error) {
        setTelemetryMappingStatus(`❌ Error: ${error.message}`, 'error');
      }
    }

    function applyRecommendedAcSolarMapping() {
      const select = document.getElementById('acSolarPowerVariable');
      if (!select || !telemetryMappingState.recommendedAcSolarPowerVariable) return;
      select.value = telemetryMappingState.recommendedAcSolarPowerVariable;
      updateTelemetryMappingSummary();
    }

    // ==================== DIAGNOSTICS FUNCTIONS ====================

    async function discoverVariables() {
      const btn = document.getElementById('btnDiscoverVars');
      const status = document.getElementById('status-discover');
      
      try {
        btn.disabled = true;
        btn.textContent = '⏳ Discovering...';
        status.innerHTML = '<div class="status-message info">Querying device variables...</div>';

        const resp = await authenticatedFetch('/api/inverter/discover-variables');
        const result = await resp.json();

        if (result.errno === 0) {
          status.innerHTML = '<div class="status-message success">✅ Variables discovered! Check output panel below.</div>';
          displayFormattedResponse('Available Variables', result);
          if (Array.isArray(result.result)) {
            mergeTelemetryVariables(result.result);
            renderTelemetryMappingOptions();
          }
          
          // Show available variables count
          if (result.result && Array.isArray(result.result)) {
            const varCount = result.result.length;
            status.innerHTML = `<div class="status-message success">✅ Found ${varCount} available variables</div>`;
          }
        } else {
          status.innerHTML = `<div class="status-message error">❌ ${result.error || 'Failed to discover variables'}</div>`;
          displayFormattedResponse('Discovery Error', result);
        }
      } catch (error) {
        status.innerHTML = `<div class="status-message error">❌ Error: ${error.message}</div>`;
        console.error('Discovery error:', error);
      } finally {
        btn.disabled = false;
        btn.textContent = '🔍 Discover Available Variables';
      }
    }

    async function getAllRealtimeData() {
      const btn = document.getElementById('btnAllData');
      const status = document.getElementById('status-alldata');
      const analysisDiv = document.getElementById('topologyAnalysis');
      const resultDiv = document.getElementById('topologyResult');
      
      try {
        btn.disabled = true;
        btn.textContent = '⏳ Querying...';
        status.innerHTML = '<div class="status-message info">Fetching all real-time data...</div>';

        console.log('[Diagnostics] Making request to /api/inverter/all-data');
        
        const resp = await authenticatedFetch('/api/inverter/all-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        
        console.log('[Diagnostics] Response status:', resp.status);
        let result = null;
        const contentType = String(resp.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('application/json')) {
          result = await resp.json();
        } else {
          const rawText = await resp.text();
          result = { errno: resp.status, error: rawText || `HTTP ${resp.status}` };
        }

        if (!resp.ok) {
          const serverMessage = result?.error || result?.msg || `HTTP ${resp.status}: ${resp.statusText || 'Request failed'}`;
          throw new Error(serverMessage);
        }

        console.log('[Diagnostics] Response data:', result);

        if (result.errno === 0) {
          status.innerHTML = '<div class="status-message success">✅ Data retrieved! Check output and topology analysis below.</div>';
          displayFormattedResponse('All Real-Time Data', result);
          const datas = Array.isArray(result?.result?.[0]?.datas) ? result.result[0].datas : [];
          mergeTelemetryVariables(datas.map((entry) => entry?.variable));
          updateTelemetrySampleValues(datas);
          updateTelemetryRecommendation(result.topologyHints || null);
          renderTelemetryMappingOptions();
          
          // Show topology analysis if available
          if (result.topologyHints) {
            analysisDiv.style.display = 'block';
            const hints = result.topologyHints;
            
            let html = `<div style="display: grid; gap: 8px; font-size: 12px;">`;
            html += `<div><strong>Detected Topology:</strong> <span style="color: var(--accent);">${hints.likelyTopology}</span></div>`;
            html += `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 4px;">`;
            html += `<div>pvPower: <strong>${hints.pvPower?.toFixed(2) || 0} kW</strong></div>`;
            html += `<div>batChargePower: <strong>${hints.batChargePower?.toFixed(2) || 0} kW</strong></div>`;
            if (hints.meterPower !== null) {
              html += `<div>meterPower: <strong>${hints.meterPower?.toFixed(2) || 0} kW</strong></div>`;
            }
            if (hints.meterPower2 !== null) {
              html += `<div>meterPower2: <strong>${hints.meterPower2?.toFixed(2) || 0} kW</strong></div>`;
            }
            html += `<div>gridConsumption: <strong>${hints.gridConsumptionPower?.toFixed(2) || 0} kW</strong></div>`;
            html += `</div></div>`;
            
            // Add interpretation
            if (hints.likelyTopology.includes('AC-coupled')) {
              html += `<div style="margin-top: 8px; padding: 8px; background: rgba(126, 231, 135, 0.1); border-radius: 4px; color: var(--accent);">`;
              html += `<strong>⚠️ AC-Coupled Solar Detected:</strong> Your solar appears to be on a separate inverter. `;
              if (hints.meterPower2 > 0.5) {
                html += `<code>meterPower2</code> likely represents your solar production (${hints.meterPower2.toFixed(2)} kW).`;
              } else if (hints.meterPower > 0.5) {
                html += `<code>meterPower</code> likely represents your solar production (${hints.meterPower.toFixed(2)} kW).`;
              }
              html += `</div>`;
            } else if (hints.likelyTopology.includes('Unknown')) {
              html += `<div style="margin-top: 8px; padding: 8px; background: rgba(255, 212, 59, 0.1); border-radius: 4px; color: var(--color-warning);">`;
              html += `<strong>ℹ️ Run During Solar Hours:</strong> Test this during midday when solar is producing for accurate detection.`;
              html += `</div>`;
            }

            if (hints.configuredAcSolarVariable) {
              html += `<div style="margin-top: 8px; padding: 8px; background: rgba(88, 166, 255, 0.08); border-radius: 4px; color: var(--text);">`;
              html += `<strong>Saved mapping:</strong> <code>${hints.configuredAcSolarVariable}</code>`;
              if (hints.acSolarPower !== null && hints.acSolarPower !== undefined) {
                html += ` → ${Number(hints.acSolarPower).toFixed(2)} kW`;
              }
              html += `</div>`;
            }
            
            resultDiv.innerHTML = html;
          }
        } else {
          status.innerHTML = `<div class="status-message error">❌ ${result.error || 'Failed to get data'}</div>`;
          displayFormattedResponse('Query Error', result);
          analysisDiv.style.display = 'none';
        }
      } catch (error) {
        status.innerHTML = `<div class="status-message error">❌ Error: ${error.message}</div>`;
        console.error('All-data query error:', error);
        analysisDiv.style.display = 'none';
      } finally {
        btn.disabled = false;
        btn.textContent = '📊 Get All Real-Time Data (No Filters)';
      }
    }

    // Initialize Firebase on page load
  
