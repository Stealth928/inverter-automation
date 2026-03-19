        // ===== STATE MANAGEMENT =====
        const discoveryState = {
            topology: null,
            telemetry: null,
            keysProbed: {},
            deviceSn: null,
            deviceProvider: ''
        };

        // ===== LOGGING =====
        function addLog(message, type = 'info') {
            const log = document.getElementById('statusLog');
            const entry = document.createElement('div');
            entry.className = `log-entry ${type}`;
            entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
            log.appendChild(entry);
            log.scrollTop = log.scrollHeight;
        }

        // ===== GET DEVICE SN =====
        async function getDeviceSn() {
            try {
                const resp = await authenticatedFetch('/api/config');
                const data = await resp.json();
                if (data.errno === 0 && data.result?.deviceProvider) {
                    discoveryState.deviceProvider = String(data.result.deviceProvider).toLowerCase();
                }
                if (data.errno === 0 && data.result?.deviceSn) {
                    discoveryState.deviceSn = data.result.deviceSn;
                    addLog(`Device SN: ${discoveryState.deviceSn}`, 'success');
                    return data.result.deviceSn;
                }
            } catch (err) {
                addLog(`Failed to get device SN from config: ${err.message}`, 'error');
            }
            return null;
        }

        // ===== TELEMETRY FETCHING =====
        async function fetchTelemetry(force = false) {
            addLog('Fetching real-time telemetry...', 'info');
            try {
                const resp = await authenticatedFetch('/api/inverter/real-time' + (force ? '?forceRefresh=true' : ''));
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = await resp.json();
                
                if (data.errno !== 0) {
                    addLog(`Telemetry failed: ${data.error}`, 'error');
                    return null;
                }

                discoveryState.telemetry = data.result;
                addLog(`Fetched ${data.result?.[0]?.datas?.length || 0} telemetry variables`, 'success');
                displayTelemetry(data.result);
                return data.result;
            } catch (err) {
                addLog(`Telemetry error: ${err.message}`, 'error');
                return null;
            }
        }

        // ===== TELEMETRY DISPLAY =====
        function displayTelemetry(inverterData) {
            const tbody = document.getElementById('telemetryBody');
            tbody.innerHTML = '';

            if (!inverterData || !Array.isArray(inverterData)) return;

            const result = inverterData[0];
            if (!result?.datas || !Array.isArray(result.datas)) return;

            result.datas.forEach(item => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${item.variable}</strong></td>
                    <td class="value">${(item.value !== undefined ? item.value : '—')}</td>
                    <td>${item.unit || '—'}</td>
                `;
                tbody.appendChild(tr);
            });

            document.getElementById('telemetryTimestamp').textContent = new Date().toLocaleTimeString();
        }

        // ===== TOPOLOGY DETECTION =====
        function detectSystemTopology(inverterData) {
            if (!inverterData || !Array.isArray(inverterData)) return 'unknown';

            const result = inverterData[0];
            const datas = result?.datas || [];
            const provider = String(discoveryState.deviceProvider || '').toLowerCase();
            const getVar = (name) => datas.find(d => d.variable === name)?.value ?? 0;

            const toKW = (raw) => {
                const n = Number(raw);
                if (isNaN(n)) return 0;
                return Math.abs(n) > 100 ? (n / 1000) : n;
            };

            const pvPower = toKW(getVar('pvPower'));
            const meterPower2 = toKW(getVar('meterPower2'));
            const feedinPower = toKW(getVar('feedinPower'));
            const generationPower = toKW(getVar('generationPower'));
            const allowMeterPower2SolarHeuristic = provider !== 'alphaess';

            // Daytime detection (simplified)
            const isDaylight = new Date().getHours() >= 6 && new Date().getHours() <= 18;

            // AC-coupled indicators
            const hasFeedinButNoPV = feedinPower > 0.5 && pvPower < 0.1;
            const meter2SuggestsExternalPV = allowMeterPower2SolarHeuristic && meterPower2 > 0.5 && pvPower < 0.1;
            const isLikelyACCoupled = isDaylight && (hasFeedinButNoPV || meter2SuggestsExternalPV);

            // DC-coupled indicators
            const isLikelyDCCoupled = pvPower > 0.5 || (pvPower > 0.1 && generationPower > 0.1);

            if (isLikelyACCoupled && !isLikelyDCCoupled) {
                return 'ac-coupled';
            } else if (isLikelyDCCoupled && !isLikelyACCoupled) {
                return 'dc-coupled';
            } else if (isLikelyACCoupled && isLikelyDCCoupled) {
                return 'hybrid';
            }

            return 'unknown';
        }

        async function runTopologyDetection() {
            document.getElementById('detectTopologyBtn').disabled = true;
            addLog('Starting topology detection...', 'info');

            try {
                const telemetry = await fetchTelemetry(true);
                if (!telemetry) {
                    document.getElementById('detectTopologyBtn').disabled = false;
                    return;
                }

                const topology = detectSystemTopology(telemetry);
                discoveryState.topology = topology;

                const result = telemetry[0];
                const datas = result?.datas || [];
                const getVar = (name) => datas.find(d => d.variable === name)?.value ?? 0;
                const toKW = (raw) => {
                    const n = Number(raw);
                    if (isNaN(n)) return 0;
                    return Math.abs(n) > 100 ? (n / 1000) : n;
                };

                const pvPower = toKW(getVar('pvPower'));
                const meterPower2 = toKW(getVar('meterPower2'));
                const canUseMeterPower2AsSolar = String(discoveryState.deviceProvider || '').toLowerCase() !== 'alphaess';
                const effectiveSolar = (canUseMeterPower2AsSolar && topology === 'ac-coupled' && meterPower2 > 0.05) ? meterPower2 : pvPower;
                const feedinPower = toKW(getVar('feedinPower'));
                const loadsPower = toKW(getVar('loadsPower'));

                // Update display
                const topologyLabel = topology === 'hybrid'
                    ? 'HYBRID / MIXED'
                    : topology.toUpperCase();
                const topoEl = document.getElementById('topologyResult');
                topoEl.innerHTML = `${topologyLabel}<div class="topology-indicator ${topology}">${topology}</div>`;

                document.getElementById('solarGenResult').textContent = `${effectiveSolar.toFixed(2)}kW`;
                document.getElementById('currentExportResult').textContent = `${feedinPower.toFixed(2)}kW`;
                document.getElementById('houseLoadResult').textContent = `${loadsPower.toFixed(2)}kW`;

                addLog(`✓ Topology detected: ${topology}`, 'success');

                if (topology === 'ac-coupled') {
                    addLog('⚠️ AC-coupled system detected. External solar inverter likely. Curtailment will only limit battery exports.', 'warning');
                } else if (topology === 'dc-coupled') {
                    addLog('✓ DC-coupled system detected. Full curtailment control available.', 'success');
                } else if (topology === 'hybrid') {
                    addLog('⚠️ Mixed AC and DC indicators detected. Review telemetry manually before relying on curtailment behavior.', 'warning');
                } else {
                    addLog('? Topology unclear. System may have insufficient telemetry or unusual configuration.', 'warning');
                }
            } catch (err) {
                addLog(`Topology detection failed: ${err.message}`, 'error');
            } finally {
                document.getElementById('detectTopologyBtn').disabled = false;
            }
        }

        // ===== KEY PROBING =====
        async function probeExportLimitKeys() {
            const keysToProbe = [
                'ExportLimit',
                'ExportLimitPower',
                'ExportMaxPower',
                'ExportLimitEnable',
                'ExportLimitActive'
            ];

            if (!discoveryState.deviceSn) {
                addLog('⚠️ Device SN not available. Attempting to fetch...', 'warning');
                if (!await getDeviceSn()) {
                    addLog('✗ Cannot probe without device SN', 'error');
                    return;
                }
            }

            document.getElementById('probeKeysBtn').disabled = true;
            addLog('Starting export limit key probing...', 'info');

            const table = document.getElementById('keysProbeTable');
            const tbody = document.getElementById('keysProbebody');
            tbody.innerHTML = '';
            table.style.display = 'table';

            for (const key of keysToProbe) {
                addLog(`Probing key: ${key}`, 'info');
                
                try {
                    const resp = await authenticatedFetch('/api/device/setting/get', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ key, sn: discoveryState.deviceSn })
                    });

                    const data = await resp.json();
                    const row = tbody.insertRow();

                    addLog(`Response for ${key}: errno=${data.errno}`, 'info');

                    if (data.errno === 0) {
                        const resultIsEmpty = data.result && Object.keys(data.result).length === 0;
                        const value = data.result?.data?.value ?? data.result?.value ?? data.data?.value ?? data.value ?? 'N/A';
                        
                        if (resultIsEmpty) {
                            // Empty result means setting not available on this device
                            row.innerHTML = `
                                <td><strong>${key}</strong></td>
                                <td><span style="color: var(--color-warning);">⚠ Not Available</span></td>
                                <td>—</td>
                                <td>Device doesn't support this setting</td>
                            `;
                            discoveryState.keysProbed[key] = { status: 'not-supported', value: null };
                            addLog(`⚠️ Key not supported on device: ${key}`, 'warning');
                        } else {
                            // Value available
                            const numValue = typeof value === 'string' && !isNaN(value) ? parseFloat(value) : value;
                            row.innerHTML = `
                                <td><strong>${key}</strong></td>
                                <td><span style="color: var(--color-success);">✓ Available</span></td>
                                <td class="value">${numValue}</td>
                                <td>Key exists on device</td>
                            `;
                            discoveryState.keysProbed[key] = { status: 'available', value: numValue };
                            addLog(`✓ Key available: ${key} = ${numValue}`, 'success');
                        }
                    } else {
                        row.innerHTML = `
                            <td><strong>${key}</strong></td>
                            <td><span style="color: var(--text-secondary);">✗ Not Available</span></td>
                            <td>—</td>
                            <td>${data.msg || data.error || 'Key not found'}</td>
                        `;
                        discoveryState.keysProbed[key] = { status: 'not-available', error: data.msg || data.error };
                        addLog(`✗ Key not available: ${key}`, 'warning');
                    }
                } catch (err) {
                    const row = tbody.insertRow();
                    row.innerHTML = `
                        <td><strong>${key}</strong></td>
                        <td><span style="color: var(--color-danger);">⚠ Error</span></td>
                        <td>—</td>
                        <td>${err.message}</td>
                    `;
                    discoveryState.keysProbed[key] = { status: 'error', error: err.message };
                    addLog(`⚠ Error probing ${key}: ${err.message}`, 'error');
                }
            }

            const availableKeys = Object.entries(discoveryState.keysProbed)
                .filter(([, v]) => v.status === 'available')
                .map(([k]) => k);

            if (availableKeys.length > 0) {
                addLog(`✓ Found ${availableKeys.length} available keys: ${availableKeys.join(', ')}`, 'success');
            } else {
                addLog('⚠️ No export limit keys found. Your device may not support this feature.', 'warning');
            }

            document.getElementById('probeKeysBtn').disabled = false;
        }

        // ===== SETTINGS READING =====
        async function readCurrentSettings() {
            if (!discoveryState.deviceSn) {
                addLog('⚠️ Device SN not available. Attempting to fetch...', 'warning');
                if (!await getDeviceSn()) {
                    addLog('✗ Cannot read settings without device SN', 'error');
                    return;
                }
            }

            document.getElementById('readSettingsBtn').disabled = true;
            addLog('Reading current export limit settings...', 'info');

            const container = document.getElementById('settingsContainer');
            container.innerHTML = '<div class="loading">Reading settings...</div>';

            try {
                const keysToCheck = ['ExportLimit', 'ExportLimitPower'];
                const settings = {};

                for (const key of keysToCheck) {
                    try {
                        const resp = await authenticatedFetch('/api/device/setting/get', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ key, sn: discoveryState.deviceSn })
                        });

                        const data = await resp.json();
                        
                        if (data.errno === 0) {
                            // Try multiple paths for the value
                            let value = data.result?.data?.value ?? data.result?.value ?? data.data?.value ?? null;
                            
                            // Check if result is empty (means setting not available on device)
                            const resultIsEmpty = data.result && Object.keys(data.result).length === 0;
                            if (resultIsEmpty) {
                                settings[key] = null;
                                addLog(`⚠️ ${key}: Not available on this device`, 'warning');
                            } else if (value !== null && value !== undefined) {
                                // Convert string numbers to actual numbers
                                const numValue = typeof value === 'string' ? parseFloat(value) : value;
                                settings[key] = numValue;
                                addLog(`✓ ${key}: ${numValue}`, 'success');
                            } else {
                                settings[key] = null;
                                addLog(`⚠️ ${key}: No value available`, 'warning');
                            }
                        } else {
                            addLog(`✗ ${key}: API error ${data.errno} - ${data.msg}`, 'error');
                        }
                    } catch (err) {
                        addLog(`✗ ${key}: ${err.message}`, 'error');
                    }
                }

                container.innerHTML = `
                    <div class="info-card">
                        <div class="info-card-title">Export Limit Power (Watts)</div>
                        <div class="info-card-value">${settings.ExportLimit ?? '?'}</div>
                        <small style="color: var(--text-secondary); margin-top: 5px; display: block;">Current maximum export to grid</small>
                    </div>
                    ${settings.ExportLimitPower === null ? `
                    <div class="info-card" style="margin-top: 15px; background: rgba(210, 153, 34, 0.1); border-left: 3px solid var(--color-warning);">
                        <div class="info-card-title">⚠️ ExportLimitPower Not Available</div>
                        <div style="color: var(--color-warning); font-size: 13px; margin-top: 5px;">
                            <p style="margin: 0 0 10px 0;">This device does not report the ExportLimitPower setting. This can happen if:</p>
                            <ul style="margin: 5px 0; padding-left: 20px;">
                                <li>The FoxESS API is temporarily unavailable</li>
                                <li>Your device firmware doesn't support this setting</li>
                                <li>The setting was recently disabled in the device configuration</li>
                            </ul>
                            <button onclick="readCurrentSettings()" style="margin-top: 10px; padding: 6px 12px; background: rgba(210, 153, 34, 0.2); border: 1px solid var(--color-warning); color: var(--color-warning); border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;">🔄 Retry Reading</button>
                        </div>
                    </div>
                    ` : `
                    <div class="info-card" style="margin-top: 15px;">
                        <div class="info-card-title">Export Limit Power (Watts)</div>
                        <div class="info-card-value">${settings.ExportLimitPower}</div>
                        <small style="color: var(--text-secondary); margin-top: 5px; display: block;">Alternative power control</small>
                    </div>
                    `}
                `;
            } catch (err) {
                container.innerHTML = `<div class="test-result failure">Error reading settings: ${err.message}</div>`;
                addLog(`Settings read failed: ${err.message}`, 'error');
            }

            document.getElementById('readSettingsBtn').disabled = false;
        }

        // ===== EXPORT LIMIT CONTROL =====
        async function setExportLimit() {
            if (!discoveryState.deviceSn) {
                addLog('⚠️ Device SN not available. Attempting to fetch...', 'warning');
                if (!await getDeviceSn()) {
                    addLog('✗ Cannot set limit without device SN', 'error');
                    return;
                }
            }

            const limitValue = parseInt(document.getElementById('exportLimitInput').value);
            if (isNaN(limitValue) || limitValue < 0) {
                addLog('Invalid export limit value', 'error');
                return;
            }

            document.getElementById('setExportLimitBtn').disabled = true;
            addLog(`⚠️ Attempting to set export limit to ${limitValue}W...`, 'warning');

            const container = document.getElementById('controlTestLog');

            try {
                // Set export limit directly (ExportLimit handles both enable and value)
                // Note: value 0 disables export limiting, any other value enables it with that limit
                const setResp = await authenticatedFetch('/api/device/setting/set', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: 'ExportLimit', value: limitValue, sn: discoveryState.deviceSn })
                });

                const setData = await setResp.json();
                if (setData.errno !== 0) {
                    throw new Error(`Failed to set export limit: ${setData.error || setData.msg}`);
                }

                addLog(`✓ Export limit set to ${limitValue}W on device`, 'success');

                container.innerHTML = `
                    <div class="test-result">
                        <strong>✓ Export Limit Set Successfully</strong><br />
                        Target: ${limitValue}W<br />
                        Status: Applied to inverter<br />
                        <br />
                        <small style="color: var(--text-secondary);">
                            Check your FoxESS Cloud app or inverter display to verify the change.
                            The limit should be applied within a few seconds.
                        </small>
                    </div>
                `;
            } catch (err) {
                container.innerHTML = `<div class="test-result failure"><strong>✗ Failed to Set Export Limit</strong><br />${err.message}</div>`;
                addLog(`Export limit set failed: ${err.message}`, 'error');
            }

            document.getElementById('setExportLimitBtn').disabled = false;
        }

        async function disableExportLimit() {
            if (!discoveryState.deviceSn) {
                addLog('⚠️ Device SN not available. Attempting to fetch...', 'warning');
                if (!await getDeviceSn()) {
                    addLog('✗ Cannot disable without device SN', 'error');
                    return;
                }
            }

            document.getElementById('disableLimitBtn').disabled = true;
            addLog('⚠️ Disabling export limiting...', 'warning');

            const container = document.getElementById('controlTestLog');

            try {
                const resp = await authenticatedFetch('/api/device/setting/set', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: 'ExportLimit', value: 0, sn: discoveryState.deviceSn })
                });

                const data = await resp.json();
                if (data.errno !== 0) {
                    throw new Error(data.error);
                }

                addLog('✓ Export limiting disabled on device', 'success');

                container.innerHTML = `
                    <div class="test-result">
                        <strong>✓ Export Limiting Disabled</strong><br />
                        Status: Device will now use default export settings<br />
                    </div>
                `;
            } catch (err) {
                container.innerHTML = `<div class="test-result failure"><strong>✗ Failed</strong><br />${err.message}</div>`;
                addLog(`Disable export limit failed: ${err.message}`, 'error');
            }

            document.getElementById('disableLimitBtn').disabled = false;
        }

        // ===== EVENT LISTENERS =====
        document.getElementById('detectTopologyBtn').addEventListener('click', runTopologyDetection);
        document.getElementById('refreshTelemetryBtn').addEventListener('click', () => fetchTelemetry(true));
        document.getElementById('probeKeysBtn').addEventListener('click', probeExportLimitKeys);
        document.getElementById('readSettingsBtn').addEventListener('click', readCurrentSettings);
        document.getElementById('setExportLimitBtn').addEventListener('click', setExportLimit);
        document.getElementById('disableLimitBtn').addEventListener('click', disableExportLimit);

        // ===== INITIALIZATION =====
        async function initPage() {
            addLog('Page initialized. Getting device configuration...', 'info');
            await getDeviceSn();
            // Force refresh telemetry on page load to ensure API call for metrics
            await fetchTelemetry(true);
            // Load API metrics
            try { loadApiMetrics(1); } catch(e) { console.warn('Failed to load API metrics:', e); }
            addLog('Ready for discovery. Use the tools below to inspect topology and export limits.', 'success');
        }

        // Initialize AppShell and then the page
        if (window.AppShell) {
            window.AppShell.init({ pageName: 'curtailment', requireAuth: true, checkSetup: false }).then(() => {
                initPage();
            }).catch((err) => {
                addLog(`AppShell init error: ${err.message}`, 'error');
            });
        } else {
            addLog('AppShell not available', 'warning');
        }
    
