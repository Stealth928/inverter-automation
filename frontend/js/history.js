
        // CSS variable helper for theme-aware chart colors
        function cssVar(name) {
            return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        }

        // Global state
        let chartJsLoaded = false;
        let historyChart = null;
        let reportChart = null;
        let lastRawData = null;
        let historyVariables = null;
        let deviceSn = null;
        let deviceProvider = '';
        let providerCapabilities = resolveHistoryProviderCapabilities('foxess');
        let cachedTopologyContext = null;
        let cachedTopologyFetchedAt = 0;

        const TOPOLOGY_CACHE_MS = 10 * 60 * 1000;
        const DEFAULT_TOPOLOGY_REFRESH_MS = 4 * 60 * 60 * 1000;
        const HISTORY_DEBUG_STORAGE_KEY = 'debug:history';

        async function getPricingContext() {
            const configResp = await apiClient.getConfig();
            const config = configResp?.result || {};
            const provider = String(config.pricingProvider || 'amber').trim().toLowerCase() || 'amber';
            const storedSelection = window.sharedUtils && typeof window.sharedUtils.getStoredPricingSelection === 'function'
                ? window.sharedUtils.getStoredPricingSelection(provider)
                : '';
            const selection = storedSelection || (provider === 'aemo'
                ? (config.aemoRegion || config.siteIdOrRegion || 'NSW1')
                : (config.amberSiteId || config.siteIdOrRegion || ''));
            return { provider, selection, config };
        }

        function historyDebugLog(...args) {
            try {
                if (window.localStorage && window.localStorage.getItem(HISTORY_DEBUG_STORAGE_KEY) === '1') {
                    console.debug(...args);
                }
            } catch (_) {}
        }

        function normalizeHistoryProvider(provider) {
            if (window.sharedUtils && typeof window.sharedUtils.normalizeDeviceProvider === 'function') {
                return window.sharedUtils.normalizeDeviceProvider(provider);
            }
            const normalized = String(provider || '').trim().toLowerCase();
            return normalized || 'foxess';
        }

        function resolveHistoryProviderCapabilities(provider) {
            if (window.sharedUtils && typeof window.sharedUtils.getProviderCapabilities === 'function') {
                return window.sharedUtils.getProviderCapabilities(provider);
            }
            const normalized = normalizeHistoryProvider(provider);
            return {
                provider: normalized,
                label: normalized === 'alphaess' ? 'AlphaESS' : (normalized === 'sigenergy' ? 'SigenEnergy' : (normalized === 'sungrow' ? 'Sungrow' : 'FoxESS')),
                supportsReliableYearlyReport: normalized !== 'alphaess' && normalized !== 'sigenergy',
                supportsAcHistoryAutoDetect: normalized !== 'alphaess' && normalized !== 'sigenergy'
            };
        }

        function renderReportProviderNotice() {
            const reportStatus = document.getElementById('reportStatus');
            if (!reportStatus || !reportStatus.parentElement) return;

            let noticeEl = document.getElementById('reportProviderNotice');
            if (!noticeEl) {
                noticeEl = document.createElement('div');
                noticeEl.id = 'reportProviderNotice';
                noticeEl.style.cssText = 'display:none;padding:10px 12px;margin-bottom:12px;background:rgba(56,139,253,0.1);border:1px solid rgba(56,139,253,0.3);border-radius:6px;font-size:12px;line-height:1.6;color:var(--text-secondary);';
                reportStatus.parentElement.insertBefore(noticeEl, reportStatus);
            }

            if (providerCapabilities.provider === 'alphaess') {
                noticeEl.style.display = 'block';
                noticeEl.innerHTML =
                    '<strong style="color:var(--accent-blue);">AlphaESS report note</strong><br>' +
                    'Monthly view is usable, but the <strong>yearly view is estimated</strong> rather than a true month-by-month breakdown.<br>' +
                    '<strong>AC-coupled auto-detect is disabled</strong> on AlphaESS history/report remapping unless topology is manually stored.';
            } else if (providerCapabilities.provider === 'sigenergy') {
                noticeEl.style.display = 'block';
                noticeEl.innerHTML =
                    '<strong style="color:var(--accent-blue);">SigenEnergy report note</strong><br>' +
                    'The current Sigenergy adapter does <strong>not yet implement full history/report/generation parity</strong> in this UI.<br>' +
                    'Expect report views to be incomplete until the adapter is finished and telemetry mappings are verified.';
            } else {
                noticeEl.style.display = 'none';
                noticeEl.innerHTML = '';
            }
        }

        // Initialize page (NO automatic API calls - those happen after auth)
        document.addEventListener('DOMContentLoaded', () => {
            // Populate year dropdown
            const yearSelect = document.getElementById('reportYear');
            const currentYear = new Date().getFullYear();
            for (let y = currentYear; y >= currentYear - 5; y--) {
                const opt = document.createElement('option');
                opt.value = y;
                opt.textContent = y;
                yearSelect.appendChild(opt);
            }
            
            // Set current month
            document.getElementById('reportMonth').value = new Date().getMonth() + 1;
            
            // Initialize month group visibility (show by default since default is "Daily")
            const monthGroup = document.getElementById('reportMonthGroup');
            monthGroup.style.display = 'flex';
            
            // Handle dimension change
            document.getElementById('reportDimension').addEventListener('change', (e) => {
                monthGroup.style.display = e.target.value === 'month' ? 'none' : 'flex';
            });
            
            // Try to get device SN from localStorage (no API call)
            try {
                const savedSn = localStorage.getItem('deviceSn');
                if (savedSn) {
                    deviceSn = savedSn;
                }
            } catch (e) {}
            // NOTE: loadDeviceSn() is called from initFirebaseAuth after auth is ready
        });

        async function loadDeviceSn() {
            try {
                const resp = await authenticatedFetch('/api/config');
                const data = await resp.json();
                if (data.errno === 0 && data.result?.deviceProvider) {
                    deviceProvider = normalizeHistoryProvider(data.result.deviceProvider);
                    providerCapabilities = resolveHistoryProviderCapabilities(deviceProvider);
                }
                if (data.errno === 0 && data.result?.deviceSn) {
                    deviceSn = data.result.deviceSn;
                    try { localStorage.setItem('deviceSn', deviceSn); } catch (e) {}
                }
                renderReportProviderNotice();
            } catch (e) {
                console.warn('Could not load device SN:', e);
            }
        }

        function isAlphaEssProvider() {
            return providerCapabilities.provider === 'alphaess';
        }

        // Load Chart.js on demand
        async function ensureChartJs() {
            if (chartJsLoaded) return;
            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
                script.onload = () => {
                    chartJsLoaded = true;
                    resolve();
                };
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }

        // Format date/time
        function formatDateTime(ts) {
            const d = new Date(ts);
            return d.toLocaleString('en-AU', { 
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                hour12: false
            });
        }
        
        function formatTime(ts) {
            const d = new Date(ts);
            return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });
        }

        function normalizePowerToKW(rawValue) {
            const n = Number(rawValue);
            if (isNaN(n)) return 0;
            return Math.abs(n) > 100 ? (n / 1000) : n;
        }

        function parseHistoryTimeMs(rawTime) {
            if (rawTime === null || rawTime === undefined) return NaN;
            if (typeof rawTime === 'number') {
                return rawTime < 1e12 ? rawTime * 1000 : rawTime;
            }
            if (typeof rawTime === 'string') {
                const parsed = Date.parse(rawTime);
                if (!isNaN(parsed)) return parsed;
                const parts = rawTime.split(' ');
                if (parts.length >= 2) {
                    const fallback = Date.parse(`${parts[0]}T${parts[1]}`);
                    if (!isNaN(fallback)) return fallback;
                }
            }
            const n = Number(rawTime);
            if (!isNaN(n)) return n < 1e12 ? n * 1000 : n;
            return NaN;
        }

        function extractRealtimeDatas(realtimePayload) {
            const result = realtimePayload?.result;
            if (Array.isArray(result) && result.length > 0) {
                if (Array.isArray(result[0]?.datas)) return result[0].datas;
                return result;
            }
            if (result && Array.isArray(result.datas)) return result.datas;
            return [];
        }

        function findRealtimeVar(datas, key) {
            const item = datas.find(d => d.variable === key || d.key === key);
            return item ? item.value : null;
        }

        function normalizeCouplingValue(value) {
            const raw = String(value || '').toLowerCase().trim();
            if (raw === 'ac' || raw === 'ac-coupled' || raw === 'ac_coupled') return 'ac';
            if (raw === 'dc' || raw === 'dc-coupled' || raw === 'dc_coupled') return 'dc';
            return 'unknown';
        }

        async function getStoredTopologyContext(forceRefresh = false) {
            if (!forceRefresh && cachedTopologyContext && (Date.now() - cachedTopologyFetchedAt) < TOPOLOGY_CACHE_MS) {
                return cachedTopologyContext;
            }

            try {
                const resp = await authenticatedFetch('/api/config/system-topology');
                const data = await resp.json();
                if (data?.errno !== 0) {
                    cachedTopologyContext = null;
                    cachedTopologyFetchedAt = Date.now();
                    return null;
                }

                const result = data?.result || {};
                const coupling = normalizeCouplingValue(result.coupling);
                const isLikelyAcCoupled = coupling === 'ac' ? true : (coupling === 'dc' ? false : false);
                const hasStoredCoupling = coupling === 'ac' || coupling === 'dc';
                const source = String(result.source || 'unknown').toLowerCase();
                const lastDetectedAt = Number(result.lastDetectedAt) || 0;
                const refreshAfterMs = Number(result.refreshAfterMs) > 0
                    ? Number(result.refreshAfterMs)
                    : DEFAULT_TOPOLOGY_REFRESH_MS;
                const isStale = !lastDetectedAt || (Date.now() - lastDetectedAt) > refreshAfterMs;

                cachedTopologyContext = {
                    coupling,
                    source,
                    isLikelyAcCoupled,
                    hasStoredCoupling,
                    lastDetectedAt,
                    refreshAfterMs,
                    isStale
                };
                cachedTopologyFetchedAt = Date.now();
                return cachedTopologyContext;
            } catch (error) {
                console.warn('[History] Failed to load stored topology:', error);
                cachedTopologyContext = null;
                cachedTopologyFetchedAt = Date.now();
                return null;
            }
        }

        async function persistTopologyDetection(isLikelyAcCoupled, pvPower, meterPower2, confidence = 0.7) {
            try {
                const coupling = isLikelyAcCoupled ? 'ac' : 'dc';
                const resp = await authenticatedFetch('/api/config/system-topology', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        coupling,
                        source: 'auto',
                        confidence,
                        refreshAfterMs: DEFAULT_TOPOLOGY_REFRESH_MS,
                        lastDetectedAt: Date.now(),
                        evidence: {
                            pvPower,
                            meterPower2,
                            heuristic: 'pvPower~0 && meterPower2>0'
                        }
                    })
                });
                const data = await resp.json();
                if (data?.errno === 0) {
                    cachedTopologyContext = {
                        coupling,
                        source: 'auto',
                        isLikelyAcCoupled,
                        hasStoredCoupling: true,
                        lastDetectedAt: Date.now(),
                        refreshAfterMs: DEFAULT_TOPOLOGY_REFRESH_MS,
                        isStale: false
                    };
                    cachedTopologyFetchedAt = Date.now();
                }
            } catch (error) {
                console.warn('[History] Failed to persist topology detection:', error);
            }
        }

        async function detectAcCoupledContext() {
            const stored = await getStoredTopologyContext(false);
            if (stored?.hasStoredCoupling && stored.source === 'manual') {
                return {
                    isLikelyAcCoupled: stored.isLikelyAcCoupled,
                    source: 'stored-manual'
                };
            }
            if (isAlphaEssProvider()) {
                return {
                    isLikelyAcCoupled: false,
                    source: stored?.hasStoredCoupling ? 'alphaess-no-auto-detect' : 'alphaess-default'
                };
            }
            if (stored?.hasStoredCoupling && !stored.isStale) {
                return {
                    isLikelyAcCoupled: stored.isLikelyAcCoupled,
                    source: 'stored-auto'
                };
            }

            try {
                const resp = await authenticatedFetch('/api/inverter/real-time');
                const data = await resp.json();
                if (data?.errno !== 0) {
                    if (stored?.hasStoredCoupling) {
                        return {
                            isLikelyAcCoupled: stored.isLikelyAcCoupled,
                            source: 'stored-fallback'
                        };
                    }
                    return { isLikelyAcCoupled: false, source: 'default' };
                }

                const datas = extractRealtimeDatas(data);
                const pvPower = normalizePowerToKW(findRealtimeVar(datas, 'pvPower'));
                const meterPower2 = normalizePowerToKW(findRealtimeVar(datas, 'meterPower2'));
                const isLikelyAcCoupled = Math.abs(pvPower) < 0.05 && meterPower2 > 0.05;

                const shouldPersist =
                    !stored?.hasStoredCoupling ||
                    stored.isStale ||
                    stored.isLikelyAcCoupled !== isLikelyAcCoupled;

                if (shouldPersist) {
                    const confidence = isLikelyAcCoupled
                        ? (meterPower2 > 0.3 ? 0.9 : 0.75)
                        : (Math.abs(pvPower) > 0.2 ? 0.8 : 0.65);
                    await persistTopologyDetection(isLikelyAcCoupled, pvPower, meterPower2, confidence);
                }

                return { isLikelyAcCoupled, pvPower, meterPower2, source: 'realtime' };
            } catch (error) {
                console.warn('[History] AC detection failed:', error);
                if (stored?.hasStoredCoupling) {
                    return {
                        isLikelyAcCoupled: stored.isLikelyAcCoupled,
                        source: 'stored-fallback'
                    };
                }
                return { isLikelyAcCoupled: false, source: 'default' };
            }
        }

        async function fetchHistoryVariableSeries(beginSec, endSec, variableCandidates = ['meterPower2']) {
            const resp = await authenticatedFetch(`/api/inverter/history?begin=${beginSec}&end=${endSec}`);
            const data = await resp.json();
            if (data?.errno && data.errno !== 0) {
                throw new Error(data.msg || data.error || 'History API error');
            }

            const datas = data?.result?.[0]?.datas || [];
            let selected = null;
            for (const variable of variableCandidates) {
                selected = datas.find(d => d.variable === variable);
                if (selected?.data?.length) break;
            }
            return selected?.data || [];
        }

        function integratePowerSeriesToBuckets(series, bucketCount, bucketIndexFromMs) {
            const buckets = Array.from({ length: bucketCount }, () => 0);
            if (!Array.isArray(series) || series.length < 2) return buckets;

            const sorted = series
                .map(point => ({
                    t: parseHistoryTimeMs(point.time),
                    v: normalizePowerToKW(point.value)
                }))
                .filter(point => Number.isFinite(point.t))
                .sort((a, b) => a.t - b.t);

            for (let i = 1; i < sorted.length; i++) {
                const prev = sorted[i - 1];
                const cur = sorted[i];
                const dtHours = (cur.t - prev.t) / 3600000;
                if (!Number.isFinite(dtHours) || dtHours <= 0 || dtHours > 6) continue;

                const bucketIndex = bucketIndexFromMs(prev.t);
                if (bucketIndex < 0 || bucketIndex >= bucketCount) continue;

                const kw = Math.max(0, prev.v);
                buckets[bucketIndex] += kw * dtHours;
            }

            return buckets.map(value => Number(value.toFixed(3)));
        }

        function getMonthRangeSeconds(year, month) {
            const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
            const end = new Date(year, month, 0, 23, 59, 59, 999);
            return {
                beginSec: Math.floor(start.getTime() / 1000),
                endSec: Math.floor(end.getTime() / 1000),
                daysInMonth: new Date(year, month, 0).getDate()
            };
        }

        function getTodayRangeSeconds() {
            const now = new Date();
            const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
            return {
                beginSec: Math.floor(start.getTime() / 1000),
                endSec: Math.floor(Date.now() / 1000)
            };
        }

        // ==================== HISTORY ====================
        // fetchHistoryMock() removed — mock endpoint disabled and Test Data UI removed.
        
        async function fetchHistory() {
            const btn = document.getElementById('btnFetchHistory');
            const status = document.getElementById('historyStatus');
            const content = document.getElementById('historyContent');
            const timestamp = document.getElementById('historyTimestamp');
            
            btn.disabled = true;
            btn.innerHTML = '⏳ Loading...';
            status.className = 'status loading';
            status.textContent = 'Fetching history data from inverter...';
            
            try {
                const hours = parseInt(document.getElementById('historyRange').value);
                const end = Math.floor(Date.now() / 1000); // Convert ms to Unix seconds
                const begin = end - (hours * 60 * 60); // hours to seconds
                
                const resp = await authenticatedFetch(`/api/inverter/history?begin=${begin}&end=${end}`);
                const data = await resp.json();
                
                if (data.errno && data.errno !== 0) {
                    throw new Error(data.msg || 'API error');
                }
                
                lastRawData = { type: 'history', data };
                updateRawDataViewer();
                
                await renderHistoryData(data, hours);
                
                status.className = 'status success';
                status.textContent = `✓ History loaded successfully (${hours}h range)`;
                timestamp.textContent = `Updated: ${new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
                
                setTimeout(() => { status.style.display = 'none'; }, 3000);
            } catch (e) {
                status.className = 'status error';
                status.textContent = `✗ Error: ${e.message}`;
                content.innerHTML = `<div class="empty-state"><div class="icon">❌</div><p>Failed to load history: ${e.message}</p></div>`;
            } finally {
                btn.disabled = false;
                btn.innerHTML = '📈 Fetch History Data';
            }
        }

        async function renderHistoryData(data, hours) {
            const content = document.getElementById('historyContent');
            
            // Parse the FoxESS response format - data.result[0].datas contains the variables
            const result = data.result;
            if (!result || !Array.isArray(result) || result.length === 0) {
                content.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>No history data available for this period</p></div>';
                return;
            }
            
            // Extract datas array from the first result item
            const datas = result[0].datas || [];
            if (datas.length === 0) {
                content.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>No history data available for this period</p></div>';
                return;
            }
            
            // FoxESS returns: {datas: [{variable: 'xxx', data: [{time: ts, value: v}, ...]}]}
            const variables = {};
            datas.forEach(item => {
                if (item.variable && item.data) {
                    variables[item.variable] = item;
                }
            });
            
            // Store all variables for debugging
            historyVariables = {};
            Object.entries(variables).forEach(([name, item]) => {
                if (item.data) {
                    historyVariables[name] = item.data;
                }
            });
            
            // Show the "Show All Variables" button
            document.getElementById('btnToggleVariables').style.display = 'inline-block';
            
            // Debug: log available variables with sample values
            const debugInfo = {};
            Object.entries(variables).forEach(([name, item]) => {
                if (item.data && item.data.length > 0) {
                    const samples = item.data.slice(0, 3).map(d => `${d.time}: ${d.value}`);
                    debugInfo[name] = {count: item.data.length, samples};
                }
            });
            historyDebugLog('[History] Variables detail:', debugInfo);
            
            // Choose solar source with AC-coupled awareness:
            // prefer pvPower for DC systems, but if pvPower is missing/near-zero
            // and meterPower2 has meaningful values, use meterPower2.
            const solarTotalData = variables.solarPowerTotal?.data || [];
            const acSolarData = variables.acSolarPower?.data || [];
            const pvData = variables.pvPower?.data || [];
            const meter2Data = variables.meterPower2?.data || [];
            const generationData = variables.generationPower?.data || [];

            const maxAbs = (arr) => arr.length ? Math.max(...arr.map(d => Math.abs(Number(d?.value) || 0))) : 0;
            const solarTotalPeak = maxAbs(solarTotalData);
            const acSolarPeak = maxAbs(acSolarData);
            const pvPeak = maxAbs(pvData);
            const meter2Peak = maxAbs(meter2Data);
            const canUseMeterPower2AsSolar = !isAlphaEssProvider();

            let genData = [];
            let solarSource = 'generationPower';
            if (solarTotalData.length > 0 && solarTotalPeak >= 0.05) {
                genData = solarTotalData;
                solarSource = 'solarPowerTotal';
            } else if (pvData.length > 0 && pvPeak >= 0.05) {
                genData = pvData;
                solarSource = 'pvPower';
            } else if (canUseMeterPower2AsSolar && meter2Data.length > 0 && meter2Peak >= 0.05) {
                genData = meter2Data;
                solarSource = 'meterPower2';
            } else {
                genData = generationData;
                solarSource = 'generationPower';
            }

            const feedData = variables.feedinPower?.data || [];
            const gridData = variables.gridConsumptionPower?.data || [];
            const loadsData = variables.loadsPower?.data || [];
            
            historyDebugLog('[History] Solar source selected:', solarSource, 'solarTotalPeak:', solarTotalPeak, 'acSolarPeak:', acSolarPeak, 'pvPeak:', pvPeak, 'meter2Peak:', meter2Peak);
            historyDebugLog('[History] genData length:', genData.length, 'feedData length:', feedData.length, 'gridData length:', gridData.length, 'loadsData length:', loadsData.length);
            
            if (genData.length === 0) {
                content.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>No generation data available. Available variables: ${Object.keys(variables).join(', ')}</p></div>`;
                return;
            }
            
            // Sort all data arrays by time to ensure chronological order
            const parseTime = (timeStr) => {
                if (typeof timeStr === 'string') {
                    // Format: "2025-12-01 23:20:14 AEDT+1100"
                    const [date, time] = timeStr.split(' ');
                    return new Date(`${date}T${time}`).getTime();
                }
                return timeStr;
            };
            
            genData.sort((a, b) => parseTime(a.time) - parseTime(b.time));
            feedData.sort((a, b) => parseTime(a.time) - parseTime(b.time));
            gridData.sort((a, b) => parseTime(a.time) - parseTime(b.time));
            
            // Create time-based lookup maps for house load calculation
            const feedinMap = {};
            const gridMap = {};
            const loadsMap = {};
            feedData.forEach(d => feedinMap[d.time] = d.value || 0);
            gridData.forEach(d => gridMap[d.time] = d.value || 0);
            loadsData.forEach(d => loadsMap[d.time] = d.value || 0);
            
            const avgGen = genData.length ? (genData.reduce((s, d) => s + (d.value || 0), 0) / genData.length) : 0;
            const avgFeed = feedData.length ? (feedData.reduce((s, d) => s + (d.value || 0), 0) / feedData.length) : 0;
            const avgGrid = gridData.length ? (gridData.reduce((s, d) => s + (d.value || 0), 0) / gridData.length) : 0;
            const maxGen = genData.length ? Math.max(...genData.map(d => d.value || 0)) : 0;
            
            // Calculate house load stats
            const houseLoadValues = genData.map(d => {
                if (loadsMap[d.time] !== undefined) {
                    return loadsMap[d.time];
                }
                const gen = d.value || 0;
                const feedin = feedinMap[d.time] || 0;
                const grid = gridMap[d.time] || 0;
                return gen + grid - feedin;
            });
            const avgHouseLoad = houseLoadValues.length ? (houseLoadValues.reduce((s, v) => s + v, 0) / houseLoadValues.length) : 0;
            const maxHouseLoad = houseLoadValues.length ? Math.max(...houseLoadValues) : 0;
            
            let html = `
                <div class="stats-grid">
                    <div class="stat-box generation">
                        <div class="label">Avg Solar Generation</div>
                        <div class="value">${avgGen.toFixed(2)}<span class="unit">kW</span></div>
                    </div>
                    <div class="stat-box generation">
                        <div class="label">Peak Solar Generation</div>
                        <div class="value">${maxGen.toFixed(2)}<span class="unit">kW</span></div>
                    </div>
                    <div class="stat-box feedin">
                        <div class="label">Avg Feed-in</div>
                        <div class="value">${avgFeed.toFixed(2)}<span class="unit">kW</span></div>
                    </div>
                    <div class="stat-box consumption">
                        <div class="label">Avg Grid Import</div>
                        <div class="value">${avgGrid.toFixed(2)}<span class="unit">kW</span></div>
                    </div>
                    <div class="stat-box houseload">
                        <div class="label">Avg House Load</div>
                        <div class="value">${avgHouseLoad.toFixed(2)}<span class="unit">kW</span></div>
                    </div>
                    <div class="stat-box houseload">
                        <div class="label">Peak House Load</div>
                        <div class="value">${maxHouseLoad.toFixed(2)}<span class="unit">kW</span></div>
                    </div>
                </div>
                ${isAlphaEssProvider() ? `
                <div style="margin-bottom:10px;padding:10px 12px;border-radius:8px;background:${cssVar('--accent-blue-bg')};border:1px solid ${cssVar('--border-primary')};color:${cssVar('--accent-blue')};font-size:12px;">
                    AlphaESS history uses provider-native power series. AC-coupled auto-detect remapping is disabled unless topology has been stored manually.
                </div>` : ''}
                <div class="chart-container">
                    <canvas id="historyChartCanvas"></canvas>
                </div>
            `;
            
            content.innerHTML = html;
            
            // Render chart
            await ensureChartJs();
            
            if (historyChart) {
                historyChart.destroy();
            }
            
            const ctx = document.getElementById('historyChartCanvas').getContext('2d');
            
            // Prepare datasets - parse time strings from the response
            const labels = genData.map(d => {
                // Parse time format: "2025-12-01 23:20:14 AEDT+1100"
                // For better clarity, show date + time for boundary crossing
                if (typeof d.time === 'string') {
                    const parts = d.time.split(' ');
                    const [year, month, day] = parts[0].split('-');
                    const timeStr = parts[1];
                    // Just show HH:MM, date is implicit from chart context
                    return timeStr.substring(0, 5);
                }
                return formatTime(d.time);
            });
            
            // Use actual house loads power from inverter instead of calculated value
            // loadsPower represents the actual power consumption in the house
            const houseLoad = genData.map(d => {
                // Prefer actual loadsPower measurement if available
                if (loadsMap[d.time] !== undefined) {
                    return loadsMap[d.time];
                }
                // Fallback to calculation: Gen + Grid - FeedIn
                const gen = d.value || 0;
                const feedin = feedinMap[d.time] || 0;
                const grid = gridMap[d.time] || 0;
                return gen + grid - feedin;
            });
            
            historyChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Solar Generation (kW)',
                            data: genData.map(d => d.value || 0),
                            borderColor: cssVar('--color-yellow'),
                            backgroundColor: 'rgba(255, 212, 59, 0.1)',
                            fill: true,
                            tension: 0.3,
                            pointRadius: 1
                        },
                        {
                            label: 'Feed-in (kW)',
                            data: feedData.map(d => d.value || 0),
                            borderColor: cssVar('--color-success'),
                            backgroundColor: 'rgba(126, 231, 135, 0.1)',
                            fill: true,
                            tension: 0.3,
                            pointRadius: 1
                        },
                        {
                            label: 'Grid Import (kW)',
                            data: gridData.map(d => d.value || 0),
                            borderColor: cssVar('--accent-blue'),
                            backgroundColor: 'rgba(88, 166, 255, 0.1)',
                            fill: true,
                            tension: 0.3,
                            pointRadius: 1
                        },
                        {
                            label: 'House Load (kW)',
                            data: houseLoad,
                            borderColor: cssVar('--color-danger'),
                            backgroundColor: 'rgba(255, 123, 114, 0.1)',
                            fill: true,
                            tension: 0.3,
                            pointRadius: 1
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { 
                            labels: { color: cssVar('--text-secondary'), usePointStyle: true }
                        },
                        tooltip: {
                            backgroundColor: cssVar('--bg-secondary'),
                            titleColor: cssVar('--text-primary'),
                            bodyColor: cssVar('--text-secondary'),
                            borderColor: cssVar('--border-primary'),
                            borderWidth: 1
                        }
                    },
                    scales: {
                        x: {
                            ticks: { color: cssVar('--text-secondary'), maxTicksLimit: 12 },
                            grid: { color: cssVar('--border-secondary') }
                        },
                        y: {
                            ticks: { color: cssVar('--text-secondary') },
                            grid: { color: cssVar('--border-secondary') },
                            beginAtZero: true
                        }
                    }
                }
            });
        }

        // ==================== REPORTS ======================================
        async function fetchReport() {
            const btn = document.getElementById('btnFetchReport');
            const status = document.getElementById('reportStatus');
            const content = document.getElementById('reportContent');
            const timestamp = document.getElementById('reportTimestamp');
            
            btn.disabled = true;
            btn.innerHTML = '⏳ Loading...';
            status.className = 'status loading';
            status.textContent = 'Fetching report data from inverter...';
            
            try {
                const dimension = document.getElementById('reportDimension').value;
                const year = document.getElementById('reportYear').value;
                const month = document.getElementById('reportMonth').value;
                const acContext = await detectAcCoupledContext();
                
                let url = `/api/inverter/report?dimension=${dimension}&year=${year}&month=${month}`;
                
                const resp = await authenticatedFetch(url);
                const data = await resp.json();
                
                if (data.errno && data.errno !== 0) {
                    throw new Error(data.msg || 'API error');
                }

                const reportOptions = {};
                if (providerCapabilities.provider === 'alphaess' && dimension === 'year') {
                    reportOptions.note = 'AlphaESS yearly report is estimated by the current integration and should not be treated as a true month-by-month history.';
                }
                if (acContext.isLikelyAcCoupled) {
                    if (dimension === 'month') {
                        try {
                            const { beginSec, endSec, daysInMonth } = getMonthRangeSeconds(Number(year), Number(month));
                            const meterSeries = await fetchHistoryVariableSeries(beginSec, endSec, ['meterPower2', 'meterPower']);
                            const bucketed = integratePowerSeriesToBuckets(
                                meterSeries,
                                daysInMonth,
                                (ms) => new Date(ms).getDate() - 1
                            );
                            if (bucketed.some(v => v > 0)) {
                                reportOptions.generationValues = bucketed;
                                reportOptions.generationSourceLabel = 'meterPower2 estimate (AC-coupled)';
                            }
                        } catch (fallbackErr) {
                            console.warn('[Report] AC fallback generation from meterPower2 failed:', fallbackErr);
                        }
                    } else if (dimension === 'year') {
                        reportOptions.note = reportOptions.note
                            ? `${reportOptions.note} AC-coupled detected: yearly generation remains from report API (meterPower2 remap currently applied to daily/monthly view).`
                            : 'AC-coupled detected: yearly generation remains from report API (meterPower2 remap currently applied to daily/monthly view).';
                    }
                }
                
                lastRawData = { type: 'report', data };
                updateRawDataViewer();
                
                await renderReportData(data, dimension, reportOptions);
                
                status.className = 'status success';
                status.textContent = reportOptions.generationSourceLabel
                    ? `✓ Report loaded successfully (${reportOptions.generationSourceLabel})`
                    : `✓ Report loaded successfully`;
                timestamp.textContent = `Updated: ${new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
                
                setTimeout(() => { status.style.display = 'none'; }, 3000);
            } catch (e) {
                status.className = 'status error';
                status.textContent = `✗ Error: ${e.message}`;
                content.innerHTML = `<div class="empty-state"><div class="icon">❌</div><p>Failed to load report: ${e.message}</p></div>`;
            } finally {
                btn.disabled = false;
                btn.innerHTML = '📊 Fetch Report';
            }
        }

        async function renderReportData(data, dimension, options = {}) {
            const content = document.getElementById('reportContent');
            
            const result = data.result || data;
            if (!result || !Array.isArray(result) || result.length === 0) {
                content.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>No report data available</p></div>';
                return;
            }
            
            // Parse variables - API returns {variable, values: [...], unit}
            const variables = {};
            result.forEach(item => {
                if (item.variable && item.values && Array.isArray(item.values)) {
                    // Convert values array to objects with value and index
                    variables[item.variable] = {
                        ...item,
                        data: item.values.map((value, index) => ({
                            value: value,
                            index: index + 1  // 1-indexed
                        }))
                    };
                }
            });
            
            historyDebugLog('[Report] Parsed variables:', Object.keys(variables));
            historyDebugLog('[Report] Generation data count:', variables.generation?.data.length, 'values:', variables.generation?.values.slice(0, 5));
            
            let genData = variables.generation?.data || [];
            if (Array.isArray(options.generationValues) && options.generationValues.length > 0) {
                genData = options.generationValues.map((value, index) => ({
                    value: value || 0,
                    index: index + 1
                }));
            }
            const feedData = variables.feedin?.data || [];
            const gridData = variables.gridConsumption?.data || [];
            const chargeData = variables.chargeEnergyToTal?.data || [];
            const dischargeData = variables.dischargeEnergyToTal?.data || [];
            
            // Calculate totals
            const totalGen = genData.reduce((s, d) => s + (d.value || 0), 0);
            const totalFeed = feedData.reduce((s, d) => s + (d.value || 0), 0);
            const totalGrid = gridData.reduce((s, d) => s + (d.value || 0), 0);
            const totalCharge = chargeData.reduce((s, d) => s + (d.value || 0), 0);
            const totalDischarge = dischargeData.reduce((s, d) => s + (d.value || 0), 0);
            
            const labelMap = { day: 'Day', month: 'Month', year: 'Year' };
            const periodLabel = labelMap[dimension] || 'Period';
            
            let html = `
                <div class="stats-grid">
                    <div class="stat-box generation">
                        <div class="label">Total Generation${options.generationSourceLabel ? ' (AC est.)' : ''}</div>
                        <div class="value">${totalGen.toFixed(1)}<span class="unit">kWh</span></div>
                    </div>
                    <div class="stat-box feedin">
                        <div class="label">Total Feed-in</div>
                        <div class="value">${totalFeed.toFixed(1)}<span class="unit">kWh</span></div>
                    </div>
                    <div class="stat-box consumption">
                        <div class="label">Total Grid Import</div>
                        <div class="value">${totalGrid.toFixed(1)}<span class="unit">kWh</span></div>
                    </div>
                    <div class="stat-box charge">
                        <div class="label">Battery Charged</div>
                        <div class="value">${totalCharge.toFixed(1)}<span class="unit">kWh</span></div>
                    </div>
                    <div class="stat-box discharge">
                        <div class="label">Battery Discharged</div>
                        <div class="value">${totalDischarge.toFixed(1)}<span class="unit">kWh</span></div>
                    </div>
                </div>
                <div class="chart-container">
                    <canvas id="reportChartCanvas"></canvas>
                </div>
            `;

            if (options.generationSourceLabel || options.note) {
                html += `
                    <div style="margin-top:10px;padding:10px 12px;border-radius:8px;background:${cssVar('--accent-blue-bg')};border:1px solid ${cssVar('--border-primary')};color:${cssVar('--accent-blue')};font-size:12px;">
                        ${options.generationSourceLabel ? `Source: <strong>${options.generationSourceLabel}</strong>. ` : ''}
                        ${options.note ? options.note : ''}
                    </div>
                `;
            }
            
            content.innerHTML = html;
            
            // Render chart
            await ensureChartJs();
            
            if (reportChart) {
                reportChart.destroy();
            }
            
            // Wait for canvas to be available in DOM
            await new Promise(resolve => setTimeout(resolve, 50));
            
            const canvas = document.getElementById('reportChartCanvas');
            if (!canvas) {
                console.error('Chart canvas not found in DOM');
                content.innerHTML += '<div style="color:red">Error: Chart canvas not available</div>';
                return;
            }
            const ctx = canvas.getContext('2d');
            
            // Labels based on dimension
            let labels = [];
            if (dimension === 'month') {
                // For month view, show day numbers (1-31)
                labels = genData.map((d, i) => `Day ${i + 1}`);
            } else if (dimension === 'day') {
                // For day view, show hour numbers (0-23)
                labels = genData.map((d, i) => `${String(i).padStart(2, '0')}:00`);
            } else {
                // For year view, show month names
                labels = genData.map((d, i) => ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i] || `M${i + 1}`);
            }
            
            reportChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: options.generationSourceLabel ? 'Generation (kWh, AC estimate)' : 'Generation (kWh)',
                            data: genData.map(d => d.value || 0),
                            borderColor: cssVar('--color-yellow'),
                            backgroundColor: 'rgba(255, 212, 59, 0.1)',
                            fill: true,
                            tension: 0.3,
                            pointRadius: 3,
                            pointHoverRadius: 5,
                            pointBackgroundColor: cssVar('--color-yellow')
                        },
                        {
                            label: 'Feed-in (kWh)',
                            data: feedData.map(d => d.value || 0),
                            borderColor: cssVar('--color-success'),
                            backgroundColor: 'rgba(126, 231, 135, 0.1)',
                            fill: true,
                            tension: 0.3,
                            pointRadius: 3,
                            pointHoverRadius: 5,
                            pointBackgroundColor: cssVar('--color-success')
                        },
                        {
                            label: 'Grid Import (kWh)',
                            data: gridData.map(d => d.value || 0),
                            borderColor: cssVar('--accent-blue'),
                            backgroundColor: 'rgba(88, 166, 255, 0.1)',
                            fill: true,
                            tension: 0.3,
                            pointRadius: 3,
                            pointHoverRadius: 5,
                            pointBackgroundColor: cssVar('--accent-blue')
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { 
                            labels: { color: cssVar('--text-secondary'), usePointStyle: true }
                        },
                        tooltip: {
                            backgroundColor: cssVar('--bg-secondary'),
                            titleColor: cssVar('--text-primary'),
                            bodyColor: cssVar('--text-secondary'),
                            borderColor: cssVar('--border-primary'),
                            borderWidth: 1
                        }
                    },
                    scales: {
                        x: {
                            ticks: { color: cssVar('--text-secondary'), maxTicksLimit: 12 },
                            grid: { color: cssVar('--border-secondary') }
                        },
                        y: {
                            ticks: { color: cssVar('--text-secondary') },
                            grid: { color: cssVar('--border-secondary') },
                            beginAtZero: true
                        }
                    }
                }
            });
        }

        // ==================== GENERATION ======================================
        async function fetchGeneration() {
            const btn = document.getElementById('btnFetchGeneration');
            const status = document.getElementById('generationStatus');
            const content = document.getElementById('generationContent');
            const timestamp = document.getElementById('generationTimestamp');
            
            btn.disabled = true;
            btn.innerHTML = '⏳ Loading...';
            status.className = 'status loading';
            status.textContent = 'Fetching generation data from inverter...';
            
            try {
                const acContext = await detectAcCoupledContext();
                const resp = await authenticatedFetch('/api/inverter/generation');
                const data = await resp.json();
                
                if (data.errno && data.errno !== 0) {
                    throw new Error(data.msg || 'API error');
                }

                const generationOptions = {};
                if (acContext.isLikelyAcCoupled) {
                    try {
                        const now = new Date();
                        const { beginSec: todayBeginSec, endSec: todayEndSec } = getTodayRangeSeconds();
                        const { beginSec: monthBeginSec, endSec: monthEndSec } = getMonthRangeSeconds(now.getFullYear(), now.getMonth() + 1);

                        const [todaySeries, monthSeries] = await Promise.all([
                            fetchHistoryVariableSeries(todayBeginSec, todayEndSec, ['meterPower2', 'meterPower']),
                            fetchHistoryVariableSeries(monthBeginSec, monthEndSec, ['meterPower2', 'meterPower'])
                        ]);

                        const todayKwh = integratePowerSeriesToBuckets(todaySeries, 1, () => 0)[0] || 0;
                        const monthKwh = integratePowerSeriesToBuckets(monthSeries, 1, () => 0)[0] || 0;

                        if (todayKwh > 0 || monthKwh > 0) {
                            generationOptions.today = todayKwh;
                            generationOptions.month = monthKwh;
                            generationOptions.sourceLabel = 'meterPower2 estimate (AC-coupled)';
                        }
                    } catch (fallbackErr) {
                        console.warn('[Generation] AC fallback from meterPower2 failed:', fallbackErr);
                    }
                }
                
                lastRawData = { type: 'generation', data };
                updateRawDataViewer();
                
                renderGenerationData(data, generationOptions);
                
                status.className = 'status success';
                status.textContent = generationOptions.sourceLabel
                    ? `✓ Generation data loaded (${generationOptions.sourceLabel})`
                    : `✓ Generation data loaded successfully`;
                timestamp.textContent = `Updated: ${new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
                
                setTimeout(() => { status.style.display = 'none'; }, 3000);
            } catch (e) {
                status.className = 'status error';
                status.textContent = `✗ Error: ${e.message}`;
                content.innerHTML = `<div class="empty-state"><div class="icon">❌</div><p>Failed to load generation: ${e.message}</p></div>`;
            } finally {
                btn.disabled = false;
                btn.innerHTML = '🔋 Fetch Generation Data';
            }
        }

        // ==================== RENDER GENERATION DATA ====================
        function renderGenerationData(data, options = {}) {
            const content = document.getElementById('generationContent');
            
            const result = data.result || data;
            if (!result) {
                content.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>No generation data available</p></div>';
                return;
            }
            
            // FoxESS generation response includes cumulative values
            const today = options.today ?? result.today ?? result.todayGeneration ?? 0;
            const month = options.month ?? result.month ?? result.monthGeneration ?? 0;
            const year = result.year || result.yearGeneration || 0;
            const total = result.cumulative || result.cumulativeGeneration || result.total || 0;
            
            let html = `
                <div class="stats-grid">
                    <div class="stat-box generation">
                        <div class="label">Today</div>
                        <div class="value">${Number(today).toFixed(1)}<span class="unit">kWh</span></div>
                    </div>
                    <div class="stat-box generation">
                        <div class="label">This Month</div>
                        <div class="value">${Number(month).toFixed(1)}<span class="unit">kWh</span></div>
                    </div>
                    <div class="stat-box generation">
                        <div class="label">Lifetime Total</div>
                        <div class="value">${Number(total).toFixed(0)}<span class="unit">kWh</span></div>
                    </div>
                </div>
            `;

            if (options.sourceLabel) {
                html += `
                    <div style="margin-top:10px;padding:10px 12px;border-radius:8px;background:${cssVar('--accent-blue-bg')};border:1px solid ${cssVar('--border-primary')};color:${cssVar('--accent-blue')};font-size:12px;">
                        Source: <strong>${options.sourceLabel}</strong>. Year and lifetime values are from the inverter generation API.
                    </div>
                `;
            }
            
            // Add any additional fields from the response
            const knownKeys = ['today', 'month', 'year', 'cumulative', 'todayGeneration', 'monthGeneration', 'yearGeneration', 'cumulativeGeneration', 'total'];
            const extraFields = Object.entries(result).filter(([k, v]) => !knownKeys.includes(k) && typeof v === 'number');
            
            if (extraFields.length > 0) {
                html += `
                    <table class="data-table">
                        <thead>
                            <tr><th>Metric</th><th>Value</th></tr>
                        </thead>
                        <tbody>
                            ${extraFields.map(([k, v]) => `
                                <tr>
                                    <td>${k}</td>
                                    <td class="value">${typeof v === 'number' ? v.toFixed(2) : v}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
            }
            
            content.innerHTML = html;
        }

        // ==================== INITIALIZATION ====================
        // Initialize price datepickers on page load
        document.addEventListener('DOMContentLoaded', () => {
            try { initPriceDatepickers(); } catch (error) { console.warn('Failed to init price datepickers', error); }
        });

        // Initialize Firebase on page load
        AppShell.init({
            pageName: 'history',
            autoMetrics: true,
            onReady: () => {
                try { TourEngine.init(window.apiClient); TourEngine.resume(); } catch(e) {}
                try { loadDeviceSn(); } catch (error) { console.warn('Failed to load device SN', error); }
            }
        });

        // ==================== RAW DATA ====================
        function toggleRawData() {
            const el = document.getElementById('rawDataContent');
            el.style.display = el.style.display === 'none' ? 'block' : 'none';
        }

        function updateRawDataViewer() {
            const pre = document.getElementById('rawDataPre');
            if (lastRawData) {
                pre.textContent = JSON.stringify(lastRawData, null, 2);
            }
        }

        function toggleHistoryVariables() {
            if (!historyVariables) {
                alert('No history data loaded yet');
                return;
            }

            // Create a table showing all variables with sample values
            let html = `<div style="background: ${cssVar('--bg-terminal')}; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 12px;">`;
            html += `<h3 style="margin-top: 0; color: ${cssVar('--color-yellow')};">Available Variables in Last Fetch:</h3>`;
            html += `<table style="width: 100%; border-collapse: collapse; color: ${cssVar('--text-primary')};">`;
            html += `<tr style="border-bottom: 1px solid ${cssVar('--border-primary')};"><th style="text-align: left; padding: 8px;">Variable</th><th style="text-align: left; padding: 8px;">Count</th><th style="text-align: left; padding: 8px;">Sample Values (first 5)</th></tr>`;
            
            Object.entries(historyVariables).forEach(([name, data]) => {
                if (data && data.length > 0) {
                    const samples = data.slice(0, 5).map(d => `${d.time}: ${d.value.toFixed(2)}`).join(' | ');
                    html += `<tr style="border-bottom: 1px solid ${cssVar('--border-primary')};"><td style="padding: 8px; color: ${cssVar('--accent-blue')}; font-weight: bold;">${name}</td><td style="padding: 8px;">${data.length}</td><td style="padding: 8px; font-family: monospace; font-size: 11px;">${samples}</td></tr>`;
                }
            });
            
            html += '</table></div>';
            
            // Show in a modal or alert
            const modal = document.createElement('div');
            modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 9999;';
            modal.innerHTML = `
                <div style="background: ${cssVar('--bg-secondary')}; border: 1px solid ${cssVar('--border-primary')}; border-radius: 12px; padding: 24px; max-width: 900px; max-height: 80vh; overflow: auto; color: ${cssVar('--text-primary')};">
                    ${html}
                    <button class="btn btn-primary" onclick="this.closest('div').parentElement.remove()" style="margin-top: 16px;">Close</button>
                </div>
            `;
            document.body.appendChild(modal);
        }

        // Load API call metrics (per-day) and display in footer
        async function loadApiMetrics(days = 1) {
            try {
                // Use scope=user to show per-user metrics, not global platform totals
                const resp = await authenticatedFetch(`/api/metrics/api-calls?days=${encodeURIComponent(days)}&scope=user`);
                const data = await resp.json();
                if (!data || data.errno !== 0 || !data.result) return;
                const keys = Object.keys(data.result).sort().reverse();
                const todayKey = keys[0];
                const today = data.result[todayKey] || {};

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

                document.getElementById('metricsDate').textContent = formatDate(new Date(todayKey), false);
                const inverterCount = (typeof getInverterApiCount === 'function') ? getInverterApiCount(today) : toCounter(today.inverter ?? today.foxess ?? 0);
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

        // Helper function for date formatting
        function formatDate(date, includeTime = true) {
            const dateStr = date.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' });
            if (includeTime) {
                const timeStr = date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });
                return `${dateStr} ${timeStr}`;
            }
            return dateStr;
        }

        // ==================== AMBER HISTORICAL PRICES ====================

        let amberHistoricalChart = null;

        // Initialize date pickers with sensible defaults (last 7 days)
        function initPriceDatepickers() {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 7);
            
            document.getElementById('priceStartDate').value = startDate.toISOString().split('T')[0];
            document.getElementById('priceEndDate').value = endDate.toISOString().split('T')[0];
        }

        // Validate date inputs and return structured validation result
        function validatePriceDateRange() {
            const startInput = document.getElementById('priceStartDate').value;
            const endInput = document.getElementById('priceEndDate').value;

            if (!startInput) return { valid: false, error: 'Start date is required' };
            if (!endInput) return { valid: false, error: 'End date is required' };

            // Parse dates in local timezone without timezone shift
            // HTML5 date input gives YYYY-MM-DD in local timezone
            const [startYear, startMonth, startDay] = startInput.split('-').map(Number);
            const [endYear, endMonth, endDay] = endInput.split('-').map(Number);
            
            const startDate = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
            const endDate = new Date(endYear, endMonth - 1, endDay, 0, 0, 0, 0);
            
            const today = new Date();
            today.setHours(0, 0, 0, 0); // Start of today in local time

            if (startDate > endDate) {
                return { valid: false, error: 'Start date must be before end date' };
            }

            // Allow today's date (tomorrow is when it becomes future)
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            if (endDate >= tomorrow) {
                return { valid: false, error: 'End date cannot be in the future' };
            }

            // Check maximum range (Amber API chunks at 14 days, we allow up to 60 days = ~5 chunks)
            // Count days inclusively: if start=Nov 1 and end=Nov 5, that's 5 days
            const maxRangeDays = 60;
            const rangeDays = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
            historyDebugLog('[Prices] Date range calculation:', { 
                startDate: startDate.toISOString(), 
                endDate: endDate.toISOString(), 
                msecDiff: endDate - startDate,
                daysDiff: (endDate - startDate) / (1000 * 60 * 60 * 24),
                rangeDays 
            });
            if (rangeDays > maxRangeDays) {
                return { valid: false, error: `Maximum range is ${maxRangeDays} days (you selected ${rangeDays} days). Please narrow the date range.` };
            }

            // Warn if range is large (>30 days = multiple chunks)
            if (rangeDays > 30) {
                return { 
                    valid: true, 
                    warning: `Large range (${rangeDays} days) will be fetched in multiple 14-day chunks`,
                    dates: { startDate, endDate, rangeDays }
                };
            }

            return { valid: true, dates: { startDate, endDate, rangeDays } };
        }

        async function fetchAmberHistoricalPrices() {
            const btn = document.getElementById('btnFetchPrices');
            const status = document.getElementById('pricesStatus');
            const content = document.getElementById('pricesContent');
            const statsContainer = document.getElementById('pricesStats');
            const timestamp = document.getElementById('pricesTimestamp');

            // Validate inputs
            const validation = validatePriceDateRange();
            if (!validation.valid) {
                status.className = 'status error';
                status.style.display = 'block';
                status.textContent = `✗ ${validation.error}`;
                historyDebugLog('[Prices] Validation failed:', validation.error);
                btn.disabled = false;
                btn.innerHTML = '📈 Fetch Prices';
                return;
            }

            if (validation.warning) {
                historyDebugLog(`[Prices] Warning: ${validation.warning}`);
            }

            btn.disabled = true;
            btn.innerHTML = '⏳ Loading prices...';
            status.className = 'status loading';
            status.style.display = 'block';
            status.textContent = '⏳ Fetching historical prices...';
            statsContainer.style.display = 'none';
            content.innerHTML = '';

            try {
                // Ensure Chart.js is loaded before rendering
                await ensureChartJs();
                
                const pricingContext = await getPricingContext();
                const sitesResp = await apiClient.getPricingSites(pricingContext.provider);
                historyDebugLog('[Prices] getPricingSites response:', pricingContext.provider, sitesResp);
                
                // Extract sites from response - handle both array and {errno, result} formats
                let sites = [];
                if (Array.isArray(sitesResp)) {
                    sites = sitesResp;
                } else if (sitesResp && sitesResp.result && Array.isArray(sitesResp.result)) {
                    sites = sitesResp.result;
                } else if (sitesResp && sitesResp.errno === 401) {
                    throw new Error('Not authenticated. Please log in first.');
                }
                
                if (sites.length === 0) {
                    // Try to get more debug info
                    const debugResp = await apiClient.fetch('/api/pricing/sites?debug=true');
                    const debugJson = await debugResp.json();
                    historyDebugLog('[Prices] Debug response:', debugJson);
                    throw new Error(pricingContext.provider === 'aemo'
                        ? 'No AEMO regions are available. Check your pricing settings.'
                        : 'No Amber sites available. Please configure your Amber API key in Settings → Integrations → Amber API.');
                }

                const selectionKey = pricingContext.provider === 'aemo' ? 'region' : 'id';
                const siteId = (pricingContext.selection && sites.some(s => String(s[selectionKey] || s.id) === pricingContext.selection))
                    ? pricingContext.selection
                    : String(sites[0][selectionKey] || sites[0].id || '');
                const { dates } = validation;
                const resolution = document.getElementById('priceResolution').value;

                // Format dates as YYYY-MM-DD (keep in local timezone, no UTC conversion)
                const startDate = dates.startDate.getFullYear() + '-' + 
                    String(dates.startDate.getMonth() + 1).padStart(2, '0') + '-' + 
                    String(dates.startDate.getDate()).padStart(2, '0');
                const endDate = dates.endDate.getFullYear() + '-' + 
                    String(dates.endDate.getMonth() + 1).padStart(2, '0') + '-' + 
                    String(dates.endDate.getDate()).padStart(2, '0');

                historyDebugLog('[Prices] Date conversion check:', {
                    inputStart: document.getElementById('priceStartDate').value,
                    inputEnd: document.getElementById('priceEndDate').value,
                    parsedStartDate: dates.startDate.toString(),
                    parsedEndDate: dates.endDate.toString(),
                    formattedStart: startDate,
                    formattedEnd: endDate
                });

                status.textContent = `⏳ Fetching prices for ${dates.rangeDays} days at ${resolution}-minute resolution...`;
                status.textContent += ` [Requesting: ${startDate} to ${endDate}]`;
                historyDebugLog('[Prices] Request details:', { provider: pricingContext.provider, siteId, startDate, endDate, resolution });

                // Fetch historical prices (actual only, no forecasts)
                const pricesResp = await apiClient.getPricingHistoricalPrices(pricingContext.provider, siteId, startDate, endDate, resolution, true);
                
                historyDebugLog('[Prices] Response from API:', pricesResp);
                historyDebugLog('[Prices] First 3 price timestamps:', pricesResp.result?.slice(0, 3).map(p => ({ startTime: p.startTime, channel: p.channelType })));
                
                if (pricesResp.errno && pricesResp.errno !== 0) {
                    throw new Error(pricesResp.error || `API Error ${pricesResp.errno}`);
                }

                const prices = Array.isArray(pricesResp) ? pricesResp : pricesResp.result || [];
                historyDebugLog('[Prices] Parsed prices array:', { count: prices.length, sample: prices.slice(0, 2) });
                
                if (prices.length === 0) {
                    throw new Error('No price data available for this date range');
                }

                // Process and display data
                renderAmberHistoricalChart(prices);
                
                // Render statistics with error handling
                try {
                    renderPriceStatistics(prices);
                } catch (statsErr) {
                    console.warn('[Prices] Statistics rendering failed (non-critical):', statsErr);
                    // Continue even if stats fail - chart is more important
                }

                // Clear any previous error and show success
                const errorMessage = document.querySelector('#pricesContent .empty-state');
                if (errorMessage) {
                    errorMessage.remove();
                }
                
                status.className = 'status success';
                status.textContent = `✓ Loaded ${prices.length} price intervals`;
                timestamp.textContent = `Updated: ${new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })}`;

                setTimeout(() => { status.style.display = 'none'; }, 3000);
            } catch (e) {
                status.className = 'status error';
                status.textContent = `✗ Error: ${e.message}`;
                content.innerHTML = `<div class="empty-state"><div class="icon">❌</div><p>${e.message}</p></div>`;
                console.error('[Prices] Error:', e);
            } finally {
                btn.disabled = false;
                btn.innerHTML = '📈 Fetch Prices';
            }
        }

        function renderPriceStatistics(prices) {
            historyDebugLog('[Prices] renderPriceStatistics called with', prices.length, 'prices');
            
            // Log unique channel types to debug
            const uniqueChannels = [...new Set(prices.map(p => p.channelType))];
            historyDebugLog('[Prices] Unique channel types:', uniqueChannels);
            
            // Separate buy and feed-in prices
            const buyPrices = prices
                .filter(p => p.channelType === 'general')
                .map(p => p.perKwh)
                .filter(v => typeof v === 'number');

            const feedPrices = prices
                .filter(p => p.channelType === 'feedIn')
                .map(p => -Math.round(p.perKwh)) // Convert to display format (negative = you earn)
                .filter(v => typeof v === 'number');

            historyDebugLog('[Prices] Separated data:', { buyCount: buyPrices.length, feedCount: feedPrices.length });

            if (buyPrices.length === 0 || feedPrices.length === 0) {
                console.warn('[Prices] Insufficient data for statistics - buy:', buyPrices.length, 'feed:', feedPrices.length);
                return;
            }

            // Calculate statistics
            const calc = {
                buyMin: Math.min(...buyPrices),
                buyMax: Math.max(...buyPrices),
                buyAvg: (buyPrices.reduce((a, b) => a + b, 0) / buyPrices.length),
                feedMin: Math.min(...feedPrices),
                feedMax: Math.max(...feedPrices),
                feedAvg: (feedPrices.reduce((a, b) => a + b, 0) / feedPrices.length)
            };

            // Update stat boxes with coloring
            document.getElementById('statBuyMin').textContent = calc.buyMin.toFixed(1);
            document.getElementById('statBuyAvg').textContent = calc.buyAvg.toFixed(1);
            document.getElementById('statBuyMax').textContent = calc.buyMax.toFixed(1);
            document.getElementById('statFeedMin').textContent = calc.feedMin.toFixed(1);
            document.getElementById('statFeedAvg').textContent = calc.feedAvg.toFixed(1);
            document.getElementById('statFeedMax').textContent = calc.feedMax.toFixed(1);

            document.getElementById('pricesStats').style.display = 'block';
            historyDebugLog('[Prices] Statistics rendered successfully');
        }

        function renderAmberHistoricalChart(prices) {
            historyDebugLog('[Prices] renderAmberHistoricalChart called with', prices.length, 'prices');
            
            // Separate data by channel type
            const generalPrices = prices.filter(p => p.channelType === 'general');
            const feedinPrices = prices.filter(p => p.channelType === 'feedIn');

            historyDebugLog('[Prices] Chart data - general:', generalPrices.length, 'feedIn:', feedinPrices.length);

            // Build a unified, sorted list of timestamps from all prices so each dataset aligns
            const allTimestamps = Array.from(new Set(prices.map(p => p.startTime))).sort((a, b) => new Date(a) - new Date(b));

            // Create labels with both date and time for every interval
            const timestamps = allTimestamps.map(ts => {
                const date = new Date(ts);
                const dateStr = date.toLocaleDateString('en-AU', { 
                    weekday: 'short',
                    day: '2-digit',
                    month: 'short',
                    timeZone: 'Australia/Sydney'
                });
                const timeStr = date.toLocaleTimeString('en-AU', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                    timeZone: 'Australia/Sydney'
                });
                // Always include date and time (date on first line, time on second)
                return `${dateStr}\n${timeStr}`;
            });

            // Build maps for fast lookup so we can align values to the unified timestamps
            const generalMap = new Map(generalPrices.map(p => [p.startTime, p.perKwh]));
            const feedMap = new Map(feedinPrices.map(p => [p.startTime, -Math.round(p.perKwh)])); // Display as positive

            // Extract price data aligned with timestamps; use null for missing points
            const buyData = allTimestamps.map(ts => generalMap.has(ts) ? generalMap.get(ts) : null);
            const feedData = allTimestamps.map(ts => feedMap.has(ts) ? feedMap.get(ts) : null);

            historyDebugLog('[Prices] Price data - buy samples:', buyData.slice(0, 3), 'feed samples:', feedData.slice(0, 3));

            // Get canvas element
            const canvas = document.getElementById('amberHistoricalChart');
            const ctx = canvas.getContext('2d');

            // Destroy previous chart if exists
            if (amberHistoricalChart) {
                amberHistoricalChart.destroy();
            }

            // Create new chart
            amberHistoricalChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: timestamps,
                    datasets: [
                        {
                            label: 'Buy Price (¢/kWh)',
                            data: buyData,
                            borderColor: cssVar('--color-orange'),
                            backgroundColor: 'rgba(240, 136, 62, 0.1)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.3,
                            pointRadius: 1,
                            pointHoverRadius: 4,
                            pointBackgroundColor: cssVar('--color-orange'),
                            pointBorderColor: '#fff',
                            pointBorderWidth: 1,
                            yAxisID: 'y'
                        },
                        {
                            label: 'Feed-in Price (¢/kWh)',
                            data: feedData,
                            borderColor: cssVar('--accent-blue'),
                            backgroundColor: 'rgba(88, 166, 255, 0.1)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.3,
                            pointRadius: 1,
                            pointHoverRadius: 4,
                            pointBackgroundColor: cssVar('--accent-blue'),
                            pointBorderColor: '#fff',
                            pointBorderWidth: 1,
                            yAxisID: 'y1'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false
                    },
                    plugins: {
                        legend: {
                            display: true,
                            labels: {
                                color: cssVar('--text-secondary'),
                                boxWidth: 12,
                                padding: 12,
                                font: { size: 12, weight: '500' }
                            }
                        },
                        tooltip: {
                            backgroundColor: cssVar('--bg-secondary'),
                            titleColor: cssVar('--text-primary'),
                            bodyColor: cssVar('--text-primary'),
                            borderColor: cssVar('--border-primary'),
                            borderWidth: 1,
                            padding: 8,
                            displayColors: true,
                            callbacks: {
                                label: function(context) {
                                    return `${context.dataset.label}: ${context.parsed.y.toFixed(2)}¢`;
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            type: 'linear',
                            display: true,
                            position: 'left',
                            ticks: {
                                color: cssVar('--text-secondary'),
                                font: { size: 11 },
                                callback: function(value) {
                                    return value.toFixed(1) + '¢';
                                }
                            },
                            grid: {
                                color: cssVar('--border-secondary'),
                                drawBorder: false
                            },
                            title: {
                                display: true,
                                text: 'Buy Price',
                                color: cssVar('--text-primary')
                            }
                        },
                        y1: {
                            type: 'linear',
                            display: true,
                            position: 'right',
                            ticks: {
                                color: cssVar('--text-secondary'),
                                font: { size: 11 },
                                callback: function(value) {
                                    return value.toFixed(1) + '¢';
                                }
                            },
                            grid: {
                                drawOnChartArea: false,
                                drawBorder: false
                            },
                            title: {
                                display: true,
                                text: 'Feed-in Price',
                                color: cssVar('--text-primary')
                            }
                        },
                        x: {
                            ticks: {
                                color: cssVar('--text-secondary'),
                                font: { size: 10 },
                                maxTicksLimit: 15,
                                maxRotation: 45,
                                minRotation: 0
                            },
                            grid: {
                                color: cssVar('--border-secondary'),
                                drawBorder: false
                            }
                        }
                    }
                }
            });
        }

