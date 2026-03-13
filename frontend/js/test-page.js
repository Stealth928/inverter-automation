
        AppShell.init({
            pageName: 'automation-lab',
            autoMetrics: true,
            onReady: () => {
                try { TourEngine.init(window.apiClient); TourEngine.resume(); } catch(e) {}
                try {
                    // Load cached data into UI on page load
                    loadCachedDataIntoUI();
                    loadRules();
                    // Initialize FAQ with dynamic values
                    initFaq();
                } catch (error) {
                    console.warn('[Automation Lab] Failed to initialize', error);
                }
            }
        });

        /* ===== Mobile tab switching ===== */
        function switchTab(name) {
            document.querySelectorAll('[data-section]').forEach(function(el) {
                el.classList.toggle('tab-active', el.dataset.section === name);
            });
            document.querySelectorAll('.mobile-tab').forEach(function(btn) {
                btn.classList.toggle('active', btn.dataset.tab === name);
            });
        }
        /* On load: activate Conditions tab (only effective on mobile — desktop shows all) */
        document.addEventListener('DOMContentLoaded', function() {
            if (window.innerWidth <= 800) switchTab('conditions');
        });

        // FAQ toggle
        function toggleFaq(element) {
            const item = element.parentElement;
            item.classList.toggle('open');
        }

        // Get dynamic configuration values from the backend
        let cachedAutomationConfig = null;
        async function getAutomationConfig() {
            if (cachedAutomationConfig) return cachedAutomationConfig;
            try {
                const resp = await authenticatedFetch('/api/automation/status');
                if (resp.ok) {
                    const data = await resp.json();
                    if (data.errno === 0 && data.result?.config) {
                        const cfg = data.result.config;
                        // Use user-specific values from config, these already include user overrides
                        cachedAutomationConfig = {
                            intervalSeconds: Math.round(cfg.automation.intervalMs / 1000),
                            amberCacheSeconds: Math.round(cfg.cache.amber / 1000),
                            inverterCacheSeconds: Math.round(cfg.cache.inverter / 1000),
                            weatherCacheSeconds: Math.round(cfg.cache.weather / 1000),
                            defaultCooldownMinutes: cfg.defaults.cooldownMinutes,
                            defaultDurationMinutes: cfg.defaults.durationMinutes
                        };
                    } else {
                        // Fallback to defaults if config not available
                        cachedAutomationConfig = {
                            intervalSeconds: 60,
                            amberCacheSeconds: 60,
                            inverterCacheSeconds: 300,
                            weatherCacheSeconds: 1800,
                            defaultCooldownMinutes: 5,
                            defaultDurationMinutes: 30
                        };
                    }
                }
            } catch (e) {
                // Fallback to defaults if API not available
                cachedAutomationConfig = {
                    intervalSeconds: 60,
                    amberCacheSeconds: 60,
                    inverterCacheSeconds: 300,
                    weatherCacheSeconds: 1800,
                    defaultCooldownMinutes: 5,
                    defaultDurationMinutes: 30
                };
            }
            return cachedAutomationConfig;
        }

        // FAQ content driven from configuration
        const buildAutomationFaq = async () => {
            const config = await getAutomationConfig();
            const min2sec = config.inverterCacheSeconds / 60;
            const min3sec = config.weatherCacheSeconds / 60;
            
            return [
                {
                    question: 'How often does automation check conditions?',
                    answer: `The automation engine runs every <code>${config.intervalSeconds} seconds</code>. Each cycle it uses <strong>cached data</strong> from:
                        <ul>
                            <li><strong>Amber prices:</strong> refreshed every ${config.amberCacheSeconds} seconds</li>
                            <li><strong>Inverter data (SoC, temps):</strong> refreshed every ${min2sec} minutes (respects FoxESS rate limits)</li>
                            <li><strong>Weather:</strong> refreshed every ${min3sec} minutes</li>
                        </ul>
                        <div class="faq-highlight">
                            The automation does NOT poll the inverter every ${config.intervalSeconds} seconds – it reuses the same data cache as the main UI to avoid excessive API calls.
                        </div>`
                },
                {
                    question: 'What is the cooldown and why does it exist?',
                    answer: `Each rule has a <code>cooldown</code> period (default: ${config.defaultCooldownMinutes} minutes). After a rule triggers, it cannot trigger again until the cooldown expires.
                        <div class="faq-highlight"><strong>Why?</strong> Prevents "flapping" – rapidly switching modes when values hover near thresholds. For example, if SoC bounces between 29% and 31%, you don't want to switch modes every ${config.intervalSeconds} seconds.</div>`
                },
                {
                    question: 'What happens if conditions change after a rule triggers?',
                    answer: `<div class="faq-highlight"><strong>Active Cancellation:</strong> Rules are monitored continuously. If the triggering rule's conditions are no longer met, the scheduled segment is cancelled immediately (within ~${config.intervalSeconds * 2} seconds).</div>
                        <strong>Example:</strong>
                        <ul>
                            <li>Price drops below 10¢ → "Charge Battery" rule triggers for ${config.defaultDurationMinutes} minutes</li>
                            <li>5 minutes later, price spikes back up to 40¢</li>
                            <li>Within ${config.intervalSeconds * 2} seconds, system detects conditions changed → <em>cancels the charging segment</em></li>
                            <li>A different rule (e.g., "High Export Price") may then take over</li>
                        </ul>
                        <div class="faq-highlight"><strong>Priority Override:</strong> If a higher-priority rule's conditions are met while a lower-priority rule is active, the higher-priority rule <em>immediately replaces</em> the active segment (bypasses cooldown).</div>
                        This prevents wasteful operations when market conditions change rapidly.`
                },
                {
                    question: 'How does priority work?',
                    answer: `<ul>
                            <li><strong>Lower number = Higher priority</strong> (Priority 1 beats Priority 5)</li>
                            <li>Rules are evaluated in priority order</li>
                            <li><strong>First match wins</strong> – once a rule's conditions are met, no lower-priority rules are checked</li>
                            <li>Use high priority (1-2) for safety rules (e.g., hot battery protection)</li>
                            <li>Use lower priority (3-5) for optimization rules (e.g., price arbitrage)</li>
                        </ul>
                        <div class="faq-highlight">💡 <strong>Tip:</strong> Color-coded badges show priority at a glance: 🔴 Red = 1, 🟠 Orange = 2, 🟡 Yellow = 3, 🟢 Green = 4-5</div>`
                },
                {
                    question: 'What is "duration" in the action?',
                    answer: `Duration sets how long the inverter scheduler segment should last (default: ${config.defaultDurationMinutes} minutes).
                        <ul>
                            <li>A triggered rule creates a time-bound segment (e.g., 10:00–10:${String(config.defaultDurationMinutes).padStart(2, '0')})</li>
                            <li>After the segment ends, the inverter reverts to its base schedule</li>
                            <li>However, if conditions are still met, the rule will re-trigger (after cooldown)</li>
                        </ul>
                        <strong>Note:</strong> Due to Active Cancellation, segments may end early if conditions change.`
                },
                {
                    question: 'What conditions can I use?',
                    answer: `<ul>
                            <li><code>feedInPrice</code> – Amber feed-in price (¢/kWh) with operators &gt;, &lt;, or <em>between</em></li>
                            <li><code>buyPrice</code> – Amber import price (¢/kWh) with operators &gt;, &lt;, or <em>between</em></li>
                            <li><code>batterySoC</code> – Battery state of charge (%) with operators &gt;, &lt;, or <em>between</em></li>
                            <li><code>temperature</code> – Battery, Ambient, or Inverter temperature (°C)</li>
                            <li><code>solarRadiation</code> – Forecasted solar radiation (W/m²) - average/min/max</li>
                            <li><code>cloudCover</code> – Forecasted cloud cover (%) - average/min/max</li>
                            <li><code>forecastPrice</code> – Upcoming Amber prices with lookAhead period</li>
                            <li><code>timeWindow</code> – Time of day range (e.g., 14:00-18:00)</li>
                        </ul>
                        <div class="faq-highlight">💡 All specified conditions must be met (AND logic) for the rule to trigger.</div>`
                },
                {
                    question: 'What are the weather-based conditions?',
                    answer: `<strong>Solar Radiation (☀️)</strong>
                        <ul>
                            <li>Measures expected sunlight intensity in W/m²</li>
                            <li>High values (800+) = sunny day, great for solar generation</li>
                            <li>Low values (&lt;200) = cloudy/overcast, limited solar</li>
                            <li>Use to charge battery when solar production will be low tomorrow</li>
                        </ul>
                        <strong>Cloud Cover (☁️)</strong>
                        <ul>
                            <li>Percentage of sky covered by clouds (0–100%)</li>
                            <li>0% = clear sky, 100% = completely overcast</li>
                            <li>Combine with solar radiation for weather-aware automation rules</li>
                        </ul>
                        <div class="faq-highlight">💡 <strong>Example:</strong> "If cloud cover &gt; 80% AND solar &lt; 150 W/m², charge battery from grid during cheap periods"</div>`
                },
                {
                    question: 'How does forecast price work?',
                    answer: `The <strong>Forecast Price</strong> condition checks upcoming Amber prices:
                        <ul>
                            <li><strong>Type:</strong> Feed-in (export earnings) or Buy (import costs)</li>
                            <li><strong>Check:</strong> Average, Min, Max, or Any value in the look-ahead period</li>
                            <li><strong>LookAhead:</strong> How far ahead to check (hours or days)</li>
                        </ul>
                        <strong>Use Cases:</strong>
                        <ul>
                            <li>Charge battery now if prices will spike in the next 2 hours</li>
                            <li>Hold charge if high feed-in prices are coming this afternoon</li>
                            <li>Discharge before cheap import prices arrive</li>
                        </ul>
                        <div class="faq-highlight">💡 This lets you make proactive decisions based on upcoming market conditions rather than just reacting to current prices.</div>`
                }
            ];
        };

        // Store FAQ as a promise to be resolved on init
        let automationFaq = [];

        function renderFaq() {
            const container = document.getElementById('faqContainer');
            if (!container) return;
            let html = '';
            automationFaq.forEach((item, idx) => {
                html += `<div class="faq-item ${idx === 0 ? 'open' : ''}">` +
                        `<div class="faq-question" onclick="toggleFaq(this)"><span>${item.question}</span><span class="icon">▼</span></div>` +
                        `<div class="faq-answer">${item.answer}</div>` +
                        `</div>`;
            });
            container.innerHTML = html;
        }

        // Render the FAQ from the config on page load
        async function initFaq() {
            automationFaq = await buildAutomationFaq();
            renderFaq();
        }

        // State
        let mockSchedulerSegments = [];
        let currentRules = {};
        
        // Initialize time to now
        document.getElementById('simTime').value = new Date().toTimeString().slice(0,5);

        // Presets aligned to rule-library templates:
        // highFeedIn -> price_high_feedin_export
        // cheapBuy   -> price_cheap_import_charge
        // spike      -> price_spike_response
        // lowSoc     -> battery_low_soc_guard
        // hotBattery -> battery_high_temp_limit
        // cloudyDay  -> solar_cloudy_precharge
        // sunnyPeak  -> solar_sunny_peak_headroom
        const presets = {
            highFeedIn: {
                ruleId: 'price_high_feedin_export',
                feedIn: 36, buy: 22, soc: 70, batteryTemp: 29, ambientTemp: 24, inverterTemp: 36,
                solarRadiation: 620, cloudCover: 25, forecastBuy1D: 24, forecastFeedIn1D: 34, forecastSolar1D: 640, forecastCloudCover1D: 30
            },
            cheapBuy: {
                ruleId: 'price_cheap_import_charge',
                feedIn: 3, buy: 3, soc: 45, batteryTemp: 24, ambientTemp: 19, inverterTemp: 31,
                solarRadiation: 180, cloudCover: 55, forecastBuy1D: 6, forecastFeedIn1D: 5, forecastSolar1D: 220, forecastCloudCover1D: 58
            },
            spike: {
                ruleId: 'price_spike_response',
                feedIn: 65, buy: 85, soc: 62, batteryTemp: 31, ambientTemp: 26, inverterTemp: 39,
                solarRadiation: 520, cloudCover: 20, forecastBuy1D: 70, forecastFeedIn1D: 58, forecastSolar1D: 540, forecastCloudCover1D: 22
            },
            lowSoc: {
                ruleId: 'battery_low_soc_guard',
                feedIn: 12, buy: 28, soc: 12, batteryTemp: 26, ambientTemp: 22, inverterTemp: 33,
                solarRadiation: 350, cloudCover: 40, forecastBuy1D: 30, forecastFeedIn1D: 14, forecastSolar1D: 360, forecastCloudCover1D: 38
            },
            hotBattery: {
                ruleId: 'battery_high_temp_limit',
                feedIn: 16, buy: 26, soc: 58, batteryTemp: 43, ambientTemp: 36, inverterTemp: 48,
                solarRadiation: 760, cloudCover: 12, forecastBuy1D: 28, forecastFeedIn1D: 18, forecastSolar1D: 780, forecastCloudCover1D: 14
            },
            cloudyDay: {
                ruleId: 'solar_cloudy_precharge',
                time: '02:30',
                feedIn: 4, buy: 12, soc: 44, batteryTemp: 23, ambientTemp: 16, inverterTemp: 29,
                solarRadiation: 120, cloudCover: 90, forecastBuy1D: 14, forecastFeedIn1D: 4, forecastSolar1D: 140, forecastCloudCover1D: 92
            },
            sunnyPeak: {
                ruleId: 'solar_sunny_peak_headroom',
                feedIn: 8, buy: 24, soc: 88, batteryTemp: 30, ambientTemp: 27, inverterTemp: 41,
                solarRadiation: 760, cloudCover: 6, forecastBuy1D: 22, forecastFeedIn1D: 10, forecastSolar1D: 880, forecastCloudCover1D: 8
            }
        };

        function loadPreset(name) {
            const p = presets[name];
            if (!p) return;
            document.getElementById('simFeedIn').value = p.feedIn;
            document.getElementById('simBuy').value = p.buy;
            document.getElementById('simSoC').value = p.soc;
            document.getElementById('simBatteryTemp').value = p.batteryTemp;
            document.getElementById('simAmbientTemp').value = p.ambientTemp;
            document.getElementById('simInverterTemp').value = p.inverterTemp;
            document.getElementById('simSolarRadiation').value = p.solarRadiation;
            document.getElementById('simCloudCover').value = p.cloudCover;
            document.getElementById('simForecastBuy1D').value = p.forecastBuy1D;
            document.getElementById('simForecastFeedIn1D').value = p.forecastFeedIn1D;
            document.getElementById('simForecastSolar1D').value = p.forecastSolar1D;
            document.getElementById('simForecastCloudCover1D').value = p.forecastCloudCover1D;
            if (p.time) {
                document.getElementById('simTime').value = p.time;
            }
            const ruleText = p.ruleId ? ` (${p.ruleId})` : '';
            log('info', `Loaded preset: ${name}${ruleText}`);
        }

        async function fetchRealConditions() {
            console.log('[DEBUG] fetchRealConditions called');
            log('info', '📦 Checking if cached data is still fresh...');
            
            try {
                // Cache TTLs (must match backend)
                const INVERTER_TTL = 5 * 60 * 1000;   // 5 minutes
                const AMBER_TTL = 60 * 1000;           // 60 seconds
                const WEATHER_TTL = 30 * 60 * 1000;    // 30 minutes
                
                // Get cache timestamps
                const cacheState = JSON.parse(localStorage.getItem('cacheState') || '{}');
                const now = Date.now();
                
                let needsInverter = true;
                let needsAmber = true;
                let needsWeather = true;
                
                // Check if cached data is still fresh
                if (cacheState.inverterTime && (now - cacheState.inverterTime) < INVERTER_TTL) {
                    console.log('[Cache] Inverter cache is fresh');
                    needsInverter = false;
                }
                if (cacheState.amberTime && (now - cacheState.amberTime) < AMBER_TTL) {
                    console.log('[Cache] Amber cache is fresh');
                    needsAmber = false;
                }
                if (cacheState.weatherTime && (now - cacheState.weatherTime) < WEATHER_TTL) {
                    console.log('[Cache] Weather cache is fresh');
                    needsWeather = false;

                    // If cached 1D values are missing/zero, force a refresh to avoid stale defaults
                    try {
                        const wxCache = JSON.parse(localStorage.getItem('cachedWeather') || '{}');
                        const missing1D = (wxCache.solarRadiation1D === undefined || wxCache.cloudCover1D === undefined);
                        const zero1D = (wxCache.solarRadiation1D === 0 && wxCache.cloudCover1D === 0);
                        if (missing1D || zero1D) {
                            console.log('[Cache] Weather 1D values missing/zero, refreshing');
                            needsWeather = true;
                        }
                    } catch (e) { /* ignore */ }
                }
                
                if (!needsInverter && !needsAmber && !needsWeather) {
                    log('info', '✨ All data fresh from cache (< 30 min old)');
                    console.log('[Cache] All caches are fresh, loading from cache');
                    // Load cached data into UI
                    loadCachedDataIntoUI();
                    return;
                }
                
                console.log(`[DEBUG] Need to fetch: Inverter=${needsInverter}, Amber=${needsAmber}, Weather=${needsWeather}`);
                log('info', '🔄 Fetching fresh data for stale caches...');
                
                await fetchLiveConditionsOnce(needsInverter, needsAmber, needsWeather);
            } catch (e) {
                log('error', `❌ Error: ${e.message}`);
                console.error('fetchRealConditions error:', e);
            }
        }
        
        function loadCachedDataIntoUI() {
            try {
                // Load inverter data
                const invCache = JSON.parse(localStorage.getItem('cachedInverter') || '{}');
                if (invCache.SoC !== undefined) document.getElementById('simSoC').value = invCache.SoC;
                if (invCache.batTemperature !== undefined) document.getElementById('simBatteryTemp').value = invCache.batTemperature.toFixed(1);
                if (invCache.ambientTemperation !== undefined) document.getElementById('simAmbientTemp').value = invCache.ambientTemperation.toFixed(1);
                if (invCache.invTemperation !== undefined) document.getElementById('simInverterTemp').value = invCache.invTemperation.toFixed(1);
                
                // Load Amber prices
                // NOTE: Amber API returns NEGATIVE values for feed-in (negative = you earn)
                // Dashboard displays as positive by negating: -(-9) = 9¢
                // We must do the same transformation here
                const priceCache = JSON.parse(localStorage.getItem('cachedPrices') || '{}');
                if (priceCache.general?.perKwh !== undefined) document.getElementById('simBuy').value = priceCache.general.perKwh.toFixed(1);
                if (priceCache.feedIn?.perKwh !== undefined) {
                    // Negate feed-in to match dashboard display (negative API value → positive display)
                    const feedInDisplay = -priceCache.feedIn.perKwh;
                    document.getElementById('simFeedIn').value = feedInDisplay.toFixed(1);
                }
                if (priceCache.forecastBuy1D !== undefined) document.getElementById('simForecastBuy1D').value = priceCache.forecastBuy1D.toFixed(1);
                if (priceCache.forecastFeedIn1D !== undefined) {
                    // forecastFeedIn1D is stored as MAX of negated values (positive)
                    document.getElementById('simForecastFeedIn1D').value = priceCache.forecastFeedIn1D.toFixed(1);
                }
                
                // Load weather - try simple cache first, fall back to full cache for 1D values
                const wxCache = JSON.parse(localStorage.getItem('cachedWeather') || '{}');
                if (wxCache.solarRadiation !== undefined) document.getElementById('simSolarRadiation').value = Math.round(wxCache.solarRadiation);
                if (wxCache.cloudCover !== undefined) document.getElementById('simCloudCover').value = Math.round(wxCache.cloudCover);
                
                // For 1D values, try simple cache first, then compute from full weather cache
                if (wxCache.solarRadiation1D !== undefined) {
                    document.getElementById('simForecastSolar1D').value = Math.round(wxCache.solarRadiation1D);
                } else {
                    // Compute from cachedWeatherFull if available
                    try {
                        const fullWx = JSON.parse(localStorage.getItem('cachedWeatherFull') || '{}');
                        if (fullWx.hourly?.shortwave_radiation && fullWx.hourly?.time) {
                            const currentTime = fullWx.current?.time || new Date().toISOString();
                            const currentHourStr = currentTime.substring(0, 13);
                            let idx = fullWx.hourly.time.findIndex(t => t && t.substring(0, 13) === currentHourStr);
                            if (idx < 0) idx = 0;
                            // Get max solar in next 24h
                            const next24Solar = fullWx.hourly.shortwave_radiation.slice(idx + 1, idx + 25);
                            if (next24Solar.length > 0) {
                                const maxSolar = Math.max(...next24Solar.map(v => v || 0));
                                document.getElementById('simForecastSolar1D').value = Math.round(maxSolar);
                            }
                        }
                    } catch (e) { /* ignore */ }
                }
                
                if (wxCache.cloudCover1D !== undefined) {
                    document.getElementById('simForecastCloudCover1D').value = Math.round(wxCache.cloudCover1D);
                } else {
                    // Compute from cachedWeatherFull if available
                    try {
                        const fullWx = JSON.parse(localStorage.getItem('cachedWeatherFull') || '{}');
                        const cloudArr = fullWx.hourly?.cloud_cover || fullWx.hourly?.cloudcover;
                        if (cloudArr && fullWx.hourly?.time) {
                            const currentTime = fullWx.current?.time || new Date().toISOString();
                            const currentHourStr = currentTime.substring(0, 13);
                            let idx = fullWx.hourly.time.findIndex(t => t && t.substring(0, 13) === currentHourStr);
                            if (idx < 0) idx = 0;
                            // Get min cloud cover in next 24h (lower = clearer)
                            const next24Cloud = cloudArr.slice(idx + 1, idx + 25);
                            if (next24Cloud.length > 0) {
                                const minCloud = Math.min(...next24Cloud.map(v => v ?? 100));
                                document.getElementById('simForecastCloudCover1D').value = Math.round(minCloud);
                            }
                        }
                    } catch (e) { /* ignore */ }
                }
                
                log('success', '✅ Loaded cached values');
            } catch (e) {
                console.error('[Cache] Error loading cached data:', e);
            }
        }
        
        async function fetchLiveConditionsOnce(fetchInverter = true, fetchAmber = true, fetchWeather = true) {
            try {
                let updated = [];
                const now = Date.now();
                
                // Get stored Amber site ID (needed for Amber prices)
                function getAmberUserStorageId() {
                    try {
                        const mode = localStorage.getItem('adminImpersonationMode') || '';
                        const impersonatedUid = localStorage.getItem('adminImpersonationUid') || '';
                        if (mode === 'header' && impersonatedUid) return impersonatedUid;
                    } catch (e) { /* ignore */ }
                    try {
                        if (window.AppShell && typeof window.AppShell.getUser === 'function') {
                            const uid = window.AppShell.getUser()?.uid;
                            if (uid) return uid;
                        }
                    } catch (e) { /* ignore */ }
                    return 'guest';
                }

                function getAmberSiteStorageKey() {
                    return `amberSiteSelection:${getAmberUserStorageId()}`;
                }

                function getStoredAmberSiteId() {
                    try {
                        const scoped = localStorage.getItem(getAmberSiteStorageKey());
                        if (scoped) return String(scoped).trim();
                    } catch (e) { /* ignore */ }
                    try {
                        const legacy = localStorage.getItem('amberSiteId');
                        if (legacy) return String(legacy).trim();
                    } catch (e) { /* ignore */ }
                    return null;
                }

                function storeAmberSiteId(siteId) {
                    const normalized = String(siteId || '').trim();
                    if (!normalized) return;
                    try { localStorage.setItem(getAmberSiteStorageKey(), normalized); } catch (e) { /* ignore */ }
                    try { localStorage.setItem('amberSiteId', normalized); } catch (e) { /* ignore */ }
                }

                let siteId = null;
                try {
                    const stored = getStoredAmberSiteId();
                    if (stored) {
                        siteId = stored;
                        console.log('[Fetch] Using stored Amber siteId:', siteId);
                    }
                } catch (e) { /* ignore */ }

                // If still missing, try persisted user config before hitting /api/pricing/sites
                if (!siteId && fetchAmber) {
                    try {
                        const cfgResp = await authenticatedFetch('/api/config');
                        if (cfgResp.ok) {
                            const cfg = await cfgResp.json();
                            const cfgSiteId = String(cfg?.result?.amberSiteId || '').trim();
                            if (cfgSiteId) {
                                siteId = cfgSiteId;
                                storeAmberSiteId(siteId);
                                console.log('[Fetch] Using amberSiteId from /api/config:', siteId);
                            }
                        }
                    } catch (e) {
                        console.log('[Fetch] Could not read /api/config amberSiteId:', e.message);
                    }
                }
                
                // If no stored siteId and Amber fetch requested, try to get from Amber sites endpoint
                if (!siteId && fetchAmber) {
                    try {
                        console.log('[Fetch] No stored siteId, attempting to fetch from /api/pricing/sites');
                        const sitesResp = await authenticatedFetch('/api/pricing/sites');
                        if (sitesResp.ok) {
                            const sites = await sitesResp.json();
                            const sitesList = Array.isArray(sites) ? sites : (sites.result || []);
                            if (sitesList.length > 0) {
                                siteId = sitesList[0].id;
                                storeAmberSiteId(siteId);
                                console.log('[Fetch] Got siteId from API:', siteId);
                            }
                        }
                    } catch (e) { 
                        console.log('[Fetch] Could not fetch sites:', e.message);
                    }
                }
                
                // Fetch inverter data only if needed
                if (fetchInverter) {
                    try {
                        const invResp = await authenticatedFetch('/api/inverter/real-time');
                        if (invResp.ok) {
                            const invData = await invResp.json();
                            if (invData.errno === 0 && invData.result) {
                                const r = invData.result;
                                const items = [];
                                if (Array.isArray(r) && r.length > 0 && Array.isArray(r[0].datas)) {
                                    r.forEach(frame => { if (Array.isArray(frame.datas)) items.push(...frame.datas); });
                                }
                                const invCache = {};
                                items.forEach(item => {
                                    if (item.variable && item.value !== undefined) {
                                        invCache[item.variable] = item.value;
                                    }
                                });
                                if (invCache.SoC !== undefined) {
                                    document.getElementById('simSoC').value = invCache.SoC;
                                    updated.push('SoC');
                                }
                                if (invCache.batTemperature !== undefined) {
                                    document.getElementById('simBatteryTemp').value = invCache.batTemperature.toFixed(1);
                                    updated.push('Battery temp');
                                }
                                if (invCache.ambientTemperation !== undefined) {
                                    document.getElementById('simAmbientTemp').value = invCache.ambientTemperation.toFixed(1);
                                    updated.push('Ambient temp');
                                }
                                if (invCache.invTemperation !== undefined) {
                                    document.getElementById('simInverterTemp').value = invCache.invTemperation.toFixed(1);
                                    updated.push('Inverter temp');
                                }
                                localStorage.setItem('cachedInverter', JSON.stringify(invCache));
                                const cacheState = JSON.parse(localStorage.getItem('cacheState') || '{}');
                                cacheState.inverterTime = now;
                                localStorage.setItem('cacheState', JSON.stringify(cacheState));
                            }
                        }
                    } catch (e) { log('warning', `Inverter fetch failed: ${e.message}`); }
                }
                
                // Fetch Amber prices only if needed
                if (fetchAmber) {
                    try {
                        if (siteId) {
                            const amberResp = await authenticatedFetch(`/api/pricing/current?siteId=${siteId}&next=48`);
                            if (amberResp.ok) {
                                const amberData = await amberResp.json();
                                let prices = [];
                                if (Array.isArray(amberData)) {
                                    prices = amberData;
                                } else if (amberData.errno === 0 && amberData.result) {
                                    prices = Array.isArray(amberData.result) ? amberData.result : [];
                                }
                                
                                const general = prices.find(p => p.channelType === 'general' && p.type === 'CurrentInterval');
                                const feedIn = prices.find(p => p.channelType === 'feedIn' && p.type === 'CurrentInterval');

                                const sortByStart = arr => arr.slice().sort((a, b) => new Date(a.startTime || a.start || 0) - new Date(b.startTime || b.start || 0));
                                const generalForecasts = sortByStart(prices.filter(p => p.channelType === 'general' && p.type === 'ForecastInterval'));
                                const feedInForecasts = sortByStart(prices.filter(p => p.channelType === 'feedIn' && p.type === 'ForecastInterval'));
                                
                                if (general?.perKwh !== undefined) {
                                    document.getElementById('simBuy').value = general.perKwh.toFixed(1);
                                    updated.push('Buy price');
                                }
                                if (feedIn?.perKwh !== undefined) {
                                    // Amber API returns NEGATIVE values for feed-in (negative = you earn)
                                    // Dashboard displays as positive by negating: -(-9) = 9¢
                                    const feedInDisplay = -feedIn.perKwh;
                                    document.getElementById('simFeedIn').value = feedInDisplay.toFixed(1);
                                    updated.push('Feed-in price');
                                }
                                
                                // Get max buy price from first 24 forecast intervals (approx next 24h)
                                if (generalForecasts.length > 0) {
                                    const sliceBuy = generalForecasts.slice(0, 24);
                                    const max1DBuy = Math.max(...sliceBuy.map(f => f.perKwh || 0));
                                    document.getElementById('simForecastBuy1D').value = max1DBuy.toFixed(1);
                                    updated.push(`Buy 1D max (${max1DBuy.toFixed(1)}¢)`);
                                }
                                
                                // Get max feed-in price from first 24 forecast intervals (approx next 24h)
                                // Amber returns NEGATIVE feed-in values; negate to get positive display values
                                // Then MAX finds the best earning rate
                                if (feedInForecasts.length > 0) {
                                    const sliceFi = feedInForecasts.slice(0, 24);
                                    // Negate each value to convert negative API values to positive display values
                                    const max1DFeedIn = Math.max(...sliceFi.map(f => -(f.perKwh || 0)));
                                    document.getElementById('simForecastFeedIn1D').value = max1DFeedIn.toFixed(1);
                                    updated.push(`Feed-in 1D max (${max1DFeedIn.toFixed(1)}¢)`);
                                }
                                
                                // Cache values - store RAW API values for feedIn (will be negated when loaded)
                                // But store TRANSFORMED values for forecast 1D (already computed as display values)
                                const priceCache = {
                                    general: general ? { perKwh: general.perKwh } : null,
                                    feedIn: feedIn ? { perKwh: feedIn.perKwh } : null,  // Store RAW (negative)
                                    forecastBuy1D: generalForecasts.length > 0 ? Math.max(...generalForecasts.slice(0, Math.min(24, generalForecasts.length)).map(f => f.perKwh || 0)) : null,
                                    // Store NEGATED max (positive display value)
                                    forecastFeedIn1D: feedInForecasts.length > 0 ? Math.max(...feedInForecasts.slice(0, Math.min(24, feedInForecasts.length)).map(f => -(f.perKwh || 0))) : null
                                };
                                localStorage.setItem('cachedPrices', JSON.stringify(priceCache));
                                const cacheState = JSON.parse(localStorage.getItem('cacheState') || '{}');
                                cacheState.amberTime = now;
                                localStorage.setItem('cacheState', JSON.stringify(cacheState));
                            }
                        } else {
                            console.log('[Fetch] No Amber siteId stored, skipping prices fetch');
                        }
                    } catch (e) { log('warning', `Amber fetch failed: ${e.message}`); }
                }
                
                // Fetch Weather only if needed
                if (fetchWeather) {
                    try {
                        const wxResp = await authenticatedFetch('/api/weather?days=3');
                        if (wxResp.ok) {
                            const wxData = await wxResp.json();
                            
                            let weatherObj = null;
                            if (wxData.errno === 0 && wxData.result) {
                                weatherObj = wxData.result;
                            } else if (wxData.source === 'open-meteo') {
                                weatherObj = wxData;
                            }
                            
                            if (weatherObj && weatherObj.hourly) {
                                const hourly = weatherObj.hourly;
                                
                                // Find current hour index from time array
                                // Use API's current time (which is in local timezone) instead of JS Date (which is UTC)
                                let currentHourIdx = 0;
                                if (hourly.time && Array.isArray(hourly.time)) {
                                    const currentTime = weatherObj.current?.time || new Date().toISOString();
                                    const currentHourStr = currentTime.substring(0, 13); // YYYY-MM-DDTHH
                                    currentHourIdx = hourly.time.findIndex(t => t && t.substring(0, 13) === currentHourStr);
                                    if (currentHourIdx < 0) currentHourIdx = 0; // Fallback to index 0 if not found
                                }
                                
                                let solar1DComputed = null;
                                if (hourly.shortwave_radiation && Array.isArray(hourly.shortwave_radiation) && hourly.shortwave_radiation.length > currentHourIdx) {
                                    document.getElementById('simSolarRadiation').value = Math.round(hourly.shortwave_radiation[currentHourIdx]);
                                    updated.push('Solar radiation');

                                    // 1-day ahead peak (max in next 48h slice of 24h starting now)
                                    const next24Solar = hourly.shortwave_radiation.slice(currentHourIdx + 1, currentHourIdx + 25);
                                    if (next24Solar.length > 0) {
                                        solar1DComputed = Math.max(...next24Solar.map(v => v || 0));
                                        document.getElementById('simForecastSolar1D').value = Math.round(solar1DComputed);
                                        updated.push(`Solar 1D max (${Math.round(solar1DComputed)}W)`);
                                    }
                                    // If still zero, look at overall upcoming 48h to find any daylight
                                    if ((solar1DComputed === null || solar1DComputed === 0) && hourly.shortwave_radiation.length > currentHourIdx) {
                                        const next48Solar = hourly.shortwave_radiation.slice(currentHourIdx + 1, currentHourIdx + 49);
                                        if (next48Solar.length > 0) {
                                            solar1DComputed = Math.max(...next48Solar.map(v => v || 0));
                                            document.getElementById('simForecastSolar1D').value = Math.round(solar1DComputed);
                                            updated.push(`Solar 1D max48 (${Math.round(solar1DComputed)}W)`);
                                        }
                                    }
                                }

                                // Fallback: if hourly solar missing/zero, use daily shortwave sum average
                                if ((solar1DComputed === null || solar1DComputed === 0) && weatherObj.daily?.shortwave_radiation_sum?.length > 1) {
                                    const dailySolar = weatherObj.daily.shortwave_radiation_sum[1];
                                    if (dailySolar !== undefined) {
                                        const avgSolar = Math.round(dailySolar / 24);
                                        solar1DComputed = avgSolar;
                                        document.getElementById('simForecastSolar1D').value = avgSolar;
                                        updated.push(`Solar 1D daily (${avgSolar}W)`);
                                    }
                                }
                                
                                let cloud1DComputed = null;
                                const cloudcoverArray = hourly.cloudcover || hourly.cloud_cover;
                                if (cloudcoverArray && Array.isArray(cloudcoverArray) && cloudcoverArray.length > currentHourIdx) {
                                    document.getElementById('simCloudCover').value = Math.round(cloudcoverArray[currentHourIdx]);
                                    updated.push('Cloud cover');

                                    // 1-day ahead best-case (min in next 24h)
                                    const next24Cloud = cloudcoverArray.slice(currentHourIdx + 1, currentHourIdx + 25);
                                    if (next24Cloud.length > 0) {
                                        cloud1DComputed = Math.min(...next24Cloud.map(v => v ?? 100));
                                        document.getElementById('simForecastCloudCover1D').value = Math.round(cloud1DComputed);
                                        updated.push(`Cloud 1D min (${Math.round(cloud1DComputed)}%)`);
                                    }
                                    // If still 100, consider next 48h to find clearest point
                                    if ((cloud1DComputed === null || cloud1DComputed === 100) && cloudcoverArray.length > currentHourIdx) {
                                        const next48Cloud = cloudcoverArray.slice(currentHourIdx + 1, currentHourIdx + 49);
                                        if (next48Cloud.length > 0) {
                                            cloud1DComputed = Math.min(...next48Cloud.map(v => v ?? 100));
                                            document.getElementById('simForecastCloudCover1D').value = Math.round(cloud1DComputed);
                                            updated.push(`Cloud 1D min48 (${Math.round(cloud1DComputed)}%)`);
                                        }
                                    }
                                }

                                // Fallback: use daily mean cloud cover
                                if ((cloud1DComputed === null || cloud1DComputed === 0) && weatherObj.daily?.cloudcover_mean?.length > 1) {
                                    const dailyCloud = weatherObj.daily.cloudcover_mean[1];
                                    if (dailyCloud !== undefined) {
                                        cloud1DComputed = dailyCloud;
                                        document.getElementById('simForecastCloudCover1D').value = Math.round(dailyCloud);
                                        updated.push(`Cloud 1D daily (${Math.round(dailyCloud)}%)`);
                                    }
                                }
                                
                                const next24Solar = hourly.shortwave_radiation ? hourly.shortwave_radiation.slice(currentHourIdx + 1, currentHourIdx + 25) : [];
                                const next24Cloud = (hourly.cloudcover || hourly.cloud_cover || []).slice(currentHourIdx + 1, currentHourIdx + 25);
                                const wxCache = {
                                    solarRadiation: (hourly?.shortwave_radiation && hourly.shortwave_radiation[currentHourIdx]) || 0,
                                    cloudCover: ((hourly?.cloudcover || hourly?.cloud_cover) && (hourly.cloudcover || hourly.cloud_cover)[currentHourIdx]) || 0,
                                    solarRadiation1D: (solar1DComputed !== null ? solar1DComputed : (next24Solar.length ? Math.max(...next24Solar.map(v => v || 0)) : (weatherObj.daily?.shortwave_radiation_sum?.length > 1 ? Math.round(weatherObj.daily.shortwave_radiation_sum[1] / 24) : 0))),
                                    cloudCover1D: (cloud1DComputed !== null ? cloud1DComputed : (next24Cloud.length ? Math.min(...next24Cloud.map(v => v ?? 100)) : (weatherObj.daily?.cloudcover_mean?.length > 1 ? weatherObj.daily.cloudcover_mean[1] : 0)))
                                };
                                localStorage.setItem('cachedWeather', JSON.stringify(wxCache));
                                const cacheState = JSON.parse(localStorage.getItem('cacheState') || '{}');
                                cacheState.weatherTime = now;
                                localStorage.setItem('cacheState', JSON.stringify(cacheState));
                            }
                        }
                    } catch (e) { log('warning', `Weather fetch failed: ${e.message}`); }
                }
                
                if (updated.length > 0) {
                    log('success', `✅ Updated: ${updated.join(', ')}`);
                } else if (fetchInverter || fetchAmber || fetchWeather) {
                    log('warning', `⚠️ No data updated. Check your config and API connections.`);
                }
            } catch (e) {
                log('error', `❌ Live fetch error: ${e.message}`);
            }
        }

        async function loadRules() {
            try {
                const resp = await authenticatedFetch('/api/automation/status');
                if (!resp.ok) {
                    if (resp.status === 401 || resp.status === 403) {
                        renderRules({ enabled: false, rules: {} });
                        log('info', 'Sign in to load rules');
                        return;
                    }
                    throw new Error(`HTTP ${resp.status}`);
                }
                const data = await resp.json();
                if (data.errno === 0 && data.result) {
                    currentRules = data.result.rules || {};
                    renderRules(data.result);
                    log('success', `Loaded ${Object.keys(currentRules).length} rules`);
                } else {
                    renderRules({ enabled: false, rules: {} });
                }
            } catch (e) {
                console.error('[Rules] Load error:', e);
                renderRules({ enabled: false, rules: {} });
                log('error', 'Failed to load rules: ' + e.message);
            }
        }

        function renderRules(status) {
            const container = document.getElementById('rulesDisplay');
            let html = '';
            
            // Master status
            html += `<div style="padding:8px;margin-bottom:12px;background:${status.enabled ? 'rgba(126,231,135,0.1)' : 'rgba(248,81,73,0.1)'};border-radius:6px;font-size:0.85rem;display:flex;align-items:center;gap:8px">
                <span style="font-size:1.2rem">${status.enabled ? '✅' : '⏸️'}</span>
                <span>Master: <strong style="color:${status.enabled ? 'var(--accent)' : 'var(--accent-red)'}">${status.enabled ? 'ACTIVE' : 'PAUSED'}</strong></span>
            </div>`;
            
            const rules = Object.entries(status.rules || {}).sort((a, b) => (a[1].priority || 99) - (b[1].priority || 99));
            
            if (rules.length === 0) {
                html += `<div class="empty-state"><div class="icon">📭</div><p>No rules configured</p></div>`;
            }
            
            for (const [key, rule] of rules) {
                const conditions = rule.conditions || {};
                let condHtml = '';
                
                // Helper to create styled condition badges
                const condBadge = (label, color, bgColor) => `<span style="display:inline-block;padding:4px 8px;border-radius:4px;font-size:0.7rem;background:${bgColor};color:${color};border:1px solid ${color};margin-right:4px;margin-bottom:4px;font-weight:600">${label}</span>`;
                
                // Price conditions with between support and colors
                if (conditions.feedInPrice?.enabled) {
                    const feedInOper = conditions.feedInPrice.operator || conditions.feedInPrice.op;
                    const label = feedInOper === 'between' 
                        ? `Feed ${conditions.feedInPrice.value}¢–${conditions.feedInPrice.value2}¢` 
                        : `Feed ${feedInOper} ${conditions.feedInPrice.value}¢`;
                    condHtml += condBadge(label, '#7ee787', 'rgba(126, 231, 135, 0.15)');
                }
                if (conditions.buyPrice?.enabled) {
                    const buyOper = conditions.buyPrice.operator || conditions.buyPrice.op;
                    const label = buyOper === 'between'
                        ? `Buy ${conditions.buyPrice.value}¢–${conditions.buyPrice.value2}¢`
                        : `Buy ${buyOper} ${conditions.buyPrice.value}¢`;
                    condHtml += condBadge(label, '#a371f7', 'rgba(163, 113, 247, 0.15)');
                }
                if (conditions.soc?.enabled) {
                    const socOper = conditions.soc.operator || conditions.soc.op;
                    const label = socOper === 'between'
                        ? `SoC ${conditions.soc.value}%–${conditions.soc.value2}%`
                        : `SoC ${socOper} ${conditions.soc.value}%`;
                    condHtml += condBadge(label, '#ffd43b', 'rgba(255, 212, 59, 0.15)');
                }
                if (conditions.temperature?.enabled) {
                    const label = `${conditions.temperature.type === 'battery' ? 'bat' : conditions.temperature.type === 'ambient' ? 'ambient' : 'inv'} ${conditions.temperature.operator} ${conditions.temperature.value}°C`;
                    condHtml += condBadge(label, '#ff922b', 'rgba(255, 146, 43, 0.15)');
                }
                if (conditions.solarRadiation?.enabled) {
                    const sr = conditions.solarRadiation;
                    const label = `☀️ ${sr.check || 'avg'} ${sr.operator} ${sr.value}W/m²`;
                    condHtml += condBadge(label, '#ffd43b', 'rgba(255, 212, 59, 0.15)');
                }
                if (conditions.cloudCover?.enabled) {
                    const cc = conditions.cloudCover;
                    const label = `☁️ ${cc.check || 'avg'} ${cc.operator} ${cc.value}%`;
                    condHtml += condBadge(label, '#58a6ff', 'rgba(88, 166, 255, 0.15)');
                }
                if (conditions.forecastPrice?.enabled) {
                    const fp = conditions.forecastPrice;
                    const label = `📈 ${fp.type === 'feedIn' ? 'FI' : 'Buy'} ${fp.check || 'max'} ${fp.operator} ${fp.value}¢`;
                    condHtml += condBadge(label, '#79c0ff', 'rgba(121, 192, 255, 0.15)');
                }
                // Handle both 'time' and legacy 'timeWindow' formats
                const timeCond = conditions.time || conditions.timeWindow;
                if (timeCond?.enabled) {
                    const label = `${timeCond.startTime || timeCond.start}-${timeCond.endTime || timeCond.end}`;
                    condHtml += condBadge(label, '#79c0ff', 'rgba(121, 192, 255, 0.15)');
                }
                
                const action = rule.action || {};
                const priorityClass = rule.priority >= 1 && rule.priority <= 10 ? `p${rule.priority}` : 'p-low';
                html += `
                <div class="rule-card ${rule.enabled ? '' : 'disabled'}" id="rule-${key}" data-ruletitle="${rule.name || key}">
                    <div class="rule-header">
                        <span class="rule-name">
                            <span class="priority-badge ${priorityClass}" title="Priority ${rule.priority || '?'} (lower number = higher priority)">P${rule.priority || '?'}</span>
                            ${rule.name || key}
                        </span>
                        <span class="rule-status ${rule.enabled ? 'enabled' : 'disabled'}">${rule.enabled ? 'ON' : 'OFF'}</span>
                    </div>
                    <div style="margin-bottom:6px">${condHtml || '<span style="color:var(--text-secondary);font-size:0.75rem">No conditions</span>'}</div>
                    <div class="rule-params">
                        <div class="rule-param"><span class="label">→</span> <span class="value">${action.workMode || 'N/A'}</span></div>
                        <div class="rule-param"><span class="label">⏱</span> <span class="value">${action.durationMinutes || 0}m</span></div>
                        <div class="rule-param"><span class="label">⚡</span> <span class="value">${action.fdPwr || 0}W</span></div>
                    </div>
                    
                </div>`;
            }
            
            container.innerHTML = html;
        }

        async function runTest() {
            const mockData = {
                feedInPrice: parseFloat(document.getElementById('simFeedIn').value) || 0,
                buyPrice: parseFloat(document.getElementById('simBuy').value) || 0,
                soc: parseFloat(document.getElementById('simSoC').value) || 50,
                batteryTemp: parseFloat(document.getElementById('simBatteryTemp').value) || 25,
                ambientTemp: parseFloat(document.getElementById('simAmbientTemp').value) || 20,
                inverterTemp: parseFloat(document.getElementById('simInverterTemp').value) || 35,
                solarRadiation: parseFloat(document.getElementById('simSolarRadiation').value) || 0,
                cloudCover: parseFloat(document.getElementById('simCloudCover').value) || 0,
                // 1-Day forecast prices
                forecastBuy1D: parseFloat(document.getElementById('simForecastBuy1D').value) || 0,
                forecastFeedIn1D: parseFloat(document.getElementById('simForecastFeedIn1D').value) || 0,
                // 1-Day forecast weather
                forecastSolar1D: parseFloat(document.getElementById('simForecastSolar1D').value) || 0,
                forecastCloudCover1D: parseFloat(document.getElementById('simForecastCloudCover1D').value) || 0,
                testTime: document.getElementById('simTime').value || null
            };
            
            const timeStr = mockData.testTime ? ` Time=${mockData.testTime}` : '';
            log('info', `Testing: FI=${mockData.feedInPrice}¢, Buy=${mockData.buyPrice}¢, SoC=${mockData.soc}%, BatTemp=${mockData.batteryTemp}°C, Solar=${mockData.solarRadiation}W/m², Cloud=${mockData.cloudCover}%${timeStr}`);
            
            // Show loading state
            const resultsContainer = document.getElementById('testResults');
            resultsContainer.innerHTML = `
                <div class="result-box" style="border-color:var(--accent-blue)">
                    <div class="result-title">
                        <span style="display:inline-block;animation:spin 1s linear infinite">⚙️</span>
                        Running Test...
                    </div>
                    <p style="color:var(--text-secondary);margin-top:8px">Evaluating automation rules with mock conditions...</p>
                </div>
            `;
            
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 15000);
                
                const resp = await authenticatedFetch('/api/automation/test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mockData }),
                    signal: controller.signal
                });
                clearTimeout(timeout);
                
                const result = await resp.json();
                
                // Update rules display to highlight triggered rule
                document.querySelectorAll('.rule-card').forEach(el => el.classList.remove('triggered'));
                
                if (result.errno === 0) {
                    if (result.triggered) {
                        const ruleName = result.result.ruleName;
                        log('success', `✓ TRIGGERED: ${ruleName} → ${result.result.action?.workMode}`);
                        
                        // Highlight triggered rule (match by display name stored in data-ruletitle)
                        let ruleEl = null;
                        document.querySelectorAll('.rule-card').forEach(el => {
                            if ((el.dataset.ruletitle || '').trim() === (ruleName || '').trim()) ruleEl = el;
                        });
                        if (ruleEl) ruleEl.classList.add('triggered');
                        
                        // Add to mock scheduler
                        addMockSegment(result.result);
                        
                        // Show API payload
                        showApiPayload(result.result);
                        
                        showResult('triggered', result);
                    } else {
                        log('warn', 'No rules triggered with current conditions');
                        showResult('not-triggered', result);
                        document.getElementById('apiPayload').textContent = '// No action would be taken';
                    }
                } else {
                    log('error', 'Test error: ' + (result.error || 'Unknown'));
                    showResult('error', result);
                }
            } catch (e) {
                if (e.name === 'AbortError') {
                    log('error', 'Request timed out');
                } else {
                    log('error', 'Test failed: ' + e.message);
                }
                showResult('error', { error: e.message });
            }
        }

        async function testSingleRule(ruleName) {
            log('info', `Testing single rule: ${ruleName}`);
            runTest();
        }

        function showResult(type, data) {
            /* On mobile, jump to the Results tab automatically so the user sees the outcome */
            if (window.innerWidth <= 800) switchTab('results');

            const container = document.getElementById('testResults');
            const icons = { 'triggered': '✅', 'not-triggered': '⚠️', 'error': '❌' };
            const titles = { 'triggered': 'Rule Would Trigger!', 'not-triggered': 'No Rules Matched', 'error': 'Test Error' };

            // allResults can be returned at top-level or under data.result depending on backend shape
            const allResults = data.allResults || (data.result && data.result.allResults) || [];

            function renderConditionList(condArr, ruleMatched = false) {
                if (!condArr || condArr.length === 0) return '<div style="color:var(--text-secondary);font-size:0.85rem">No conditions</div>';
                
                // Define the order of conditions to match renderRules
                const conditionOrder = ['feedInPrice', 'buyPrice', 'soc', 'temperature', 'solarRadiation', 'cloudCover', 'forecastPrice', 'timeWindow', 'time'];
                
                // Sort conditions array by their type/name according to the defined order
                const sortedConds = condArr.slice().sort((a, b) => {
                    // Try to determine condition type from name
                    let aType = '', bType = '';
                    
                    // Match condition names to types
                    if (a.name.includes('Feed')) aType = 'feedInPrice';
                    else if (a.name.includes('Buy')) aType = 'buyPrice';
                    else if (a.name.includes('SoC') || a.name.includes('Battery')) aType = 'soc';
                    else if (a.name.includes('Temp') || a.name.includes('Temperature')) aType = 'temperature';
                    else if (a.name.includes('Solar') || a.name.includes('Radiation')) aType = 'solarRadiation';
                    else if (a.name.includes('Cloud') || a.name.includes('Cover')) aType = 'cloudCover';
                    else if (a.name.includes('Forecast') || a.name.includes('Price')) aType = 'forecastPrice';
                    else if (a.name.includes('Time')) aType = 'timeWindow';
                    
                    if (b.name.includes('Feed')) bType = 'feedInPrice';
                    else if (b.name.includes('Buy')) bType = 'buyPrice';
                    else if (b.name.includes('SoC') || b.name.includes('Battery')) bType = 'soc';
                    else if (b.name.includes('Temp') || b.name.includes('Temperature')) bType = 'temperature';
                    else if (b.name.includes('Solar') || b.name.includes('Radiation')) bType = 'solarRadiation';
                    else if (b.name.includes('Cloud') || b.name.includes('Cover')) bType = 'cloudCover';
                    else if (b.name.includes('Forecast') || b.name.includes('Price')) bType = 'forecastPrice';
                    else if (b.name.includes('Time')) bType = 'timeWindow';
                    
                    const aIndex = conditionOrder.indexOf(aType);
                    const bIndex = conditionOrder.indexOf(bType);
                    
                    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
                });
                
                return `<div style="display:flex;flex-direction:column;gap:8px">` + sortedConds.map(c => {
                    const isMet = c.met;
                    const bgColor = isMet ? 'rgba(126, 231, 135, 0.15)' : 'rgba(248, 81, 73, 0.15)';
                    const borderColor = isMet ? 'var(--color-success)' : 'var(--color-danger)';
                    const textColor = isMet ? 'var(--color-success)' : 'var(--color-danger)';
                    const icon = isMet ? '✓' : '✗';
                    const target = (c.target !== undefined && c.target !== null) ? c.target : '';
                    
                    return `
                        <div style="display:flex;align-items:stretch;gap:0;border-radius:6px;overflow:hidden;border-left:3px solid ${borderColor}">
                            <div style="display:flex;align-items:center;justify-content:center;width:36px;background:${bgColor};padding:8px;flex-shrink:0">
                                <span style="font-weight:700;color:${textColor};font-size:1.1rem">${icon}</span>
                            </div>
                            <div style="flex:1;padding:10px;background:${bgColor};display:flex;align-items:center;justify-content:space-between">
                                <div style="flex:1">
                                    <div style="font-weight:600;color:var(--text-primary);font-size:0.9rem;margin-bottom:3px">${c.name}</div>
                                    <div style="font-size:0.8rem;color:var(--text-secondary);display:flex;gap:12px;flex-wrap:wrap">
                                        <span>Actual: <strong style="color:${textColor}">${c.value}</strong></span>
                                        ${target ? `<span>Target: <strong>${target}</strong></span>` : ''}
                                    </div>
                                </div>
                            </div>
                        </div>`;
                }).join('') + `</div>`;
            }

            function renderRuleCard(ruleInfo, isTriggered = false, triggeredRuleName = null) {
                const isTrigRule = ruleInfo.ruleName === triggeredRuleName;
                const allCondsMet = ruleInfo.conditions && ruleInfo.conditions.every(c => c.met);
                
                const cardBg = isTrigRule ? 'rgba(126, 231, 135, 0.1)' : 'rgba(248, 81, 73, 0.1)';
                const headerBg = isTrigRule ? 'rgba(126, 231, 135, 0.25)' : 'rgba(248, 81, 73, 0.15)';
                const borderColor = isTrigRule ? 'var(--color-success)' : allCondsMet ? 'var(--color-orange)' : 'var(--color-danger)';
                const statusIcon = isTrigRule ? '✅ TRIGGERED' : allCondsMet ? '⏳ BLOCKED' : '❌ NOT MET';
                const statusColor = isTrigRule ? 'var(--color-success)' : allCondsMet ? 'var(--color-orange)' : 'var(--color-danger)';
                
                return `
                    <div style="background:${cardBg};border:2px solid ${borderColor};border-radius:8px;padding:12px;margin-bottom:12px;overflow:hidden">
                        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid ${borderColor}">
                            <div style="display:flex;align-items:center;gap:12px;flex:1">
                                <div style="font-size:1.2rem;font-weight:700">${isTrigRule ? '🎯' : '📋'}</div>
                                <div>
                                    <div style="font-weight:700;color:var(--text-primary);font-size:0.95rem">${ruleInfo.ruleName}</div>
                                    <div style="font-size:0.75rem;color:var(--text-secondary)">Priority P${ruleInfo.priority}</div>
                                </div>
                            </div>
                            <div style="text-align:right">
                                <div style="font-weight:700;color:${statusColor};font-size:0.9rem">${statusIcon}</div>
                                <div style="font-size:0.7rem;color:var(--text-secondary);margin-top:2px">${ruleInfo.conditions ? ruleInfo.conditions.filter(c => c.met).length : 0}/${ruleInfo.conditions ? ruleInfo.conditions.length : 0} conditions met</div>
                            </div>
                        </div>
                        <div style="margin-bottom:12px">
                            ${renderConditionList(ruleInfo.conditions || [], isTrigRule)}
                        </div>
                        ${isTrigRule ? `
                            <div style="background:rgba(126, 231, 135, 0.2);border-left:3px solid var(--color-success);padding:10px;border-radius:4px;font-size:0.85rem">
                                <strong style="color:var(--color-success)">⚡ Action:</strong> ${ruleInfo.action ? ruleInfo.action.workMode + ' for ' + ruleInfo.action.durationMinutes + ' min' : 'N/A'}
                            </div>
                        ` : ''}
                    </div>
                `;
            }

            let detailsHtml = '';
            if (type === 'triggered' && data.result) {
                const r = data.result;
                const a = r.action || {};
                const triggeredRuleName = r.ruleName || r.ruleId;
                
                detailsHtml = `
                    <div style="background:rgba(126, 231, 135, 0.2);border:2px solid var(--color-success);border-radius:8px;padding:14px;margin-bottom:16px">
                        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
                            <span style="font-size:1.5rem">🎯</span>
                            <div>
                                <div style="font-weight:700;color:var(--color-success);font-size:1rem">RULE TRIGGERED!</div>
                                <div style="font-size:0.85rem;color:var(--text-secondary)">${r.ruleName} (P${r.priority})</div>
                            </div>
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                            <div>
                                <div style="font-size:0.75rem;color:var(--text-secondary);margin-bottom:6px">WORK MODE</div>
                                <div style="font-weight:700;color:var(--accent-blue);font-size:0.95rem">${a.workMode}</div>
                            </div>
                            <div>
                                <div style="font-size:0.75rem;color:var(--text-secondary);margin-bottom:6px">DURATION</div>
                                <div style="font-weight:700;color:var(--accent-blue);font-size:0.95rem">${a.durationMinutes} minutes</div>
                            </div>
                            <div>
                                <div style="font-size:0.75rem;color:var(--text-secondary);margin-bottom:6px">POWER</div>
                                <div style="font-weight:700;color:var(--accent-blue);font-size:0.95rem">${a.fdPwr}W</div>
                            </div>
                            <div>
                                <div style="font-size:0.75rem;color:var(--text-secondary);margin-bottom:6px">MIN SOC (GRID)</div>
                                <div style="font-weight:700;color:var(--accent-blue);font-size:0.95rem">${a.minSocOnGrid}%</div>
                            </div>
                        </div>
                    </div>
                    
                    <div style="margin-bottom:16px">
                        <h4 style="font-size:0.9rem;color:var(--text-primary);margin-bottom:12px;display:flex;align-items:center;gap:8px">
                            <span>✓</span> Triggered Rule Details
                        </h4>
                        ${renderRuleCard(allResults.find(x => x.ruleName === triggeredRuleName) || {ruleName: r.ruleName, priority: r.priority, action: a}, true, triggeredRuleName)}
                    </div>
                    
                    ${allResults.length > 1 ? `
                        <div>
                            <h4 style="font-size:0.9rem;color:var(--text-primary);margin-bottom:12px;display:flex;align-items:center;gap:8px">
                                <span>❌</span> Other Rules (Not Evaluated)
                            </h4>
                            ${allResults.filter(x => x.ruleName !== triggeredRuleName).map(r => renderRuleCard(r, false, triggeredRuleName)).join('')}
                        </div>
                    ` : ''}
                `;
            } else if (type === 'not-triggered') {
                // Show all rules checked and why they didn't match
                let ruleDetails = '';
                if (allResults && allResults.length > 0) {
                    // Separate rules by whether all conditions were met
                    const blocked = allResults.filter(r => r.conditions && r.conditions.every(c => c.met));
                    const notMet = allResults.filter(r => !r.conditions || !r.conditions.every(c => c.met));
                    
                    if (blocked.length > 0) {
                        ruleDetails += `
                            <div style="margin-bottom:16px">
                                <h4 style="font-size:0.9rem;color:var(--color-orange);margin-bottom:12px;display:flex;align-items:center;gap:8px">
                                    <span>⏳</span> All Conditions Met (Cooldown/Other Blocking)
                                </h4>
                                ${blocked.map(r => renderRuleCard(r, false)).join('')}
                            </div>
                        `;
                    }
                    
                    if (notMet.length > 0) {
                        ruleDetails += `
                            <div>
                                <h4 style="font-size:0.9rem;color:var(--color-danger);margin-bottom:12px;display:flex;align-items:center;gap:8px">
                                    <span>❌</span> Conditions Not Met
                                </h4>
                                ${notMet.map(r => renderRuleCard(r, false)).join('')}
                            </div>
                        `;
                    }
                }
                detailsHtml = `
                    <div style="background:rgba(248, 81, 73, 0.15);border:2px solid var(--color-danger);border-radius:8px;padding:14px;margin-bottom:16px">
                        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
                            <span style="font-size:1.5rem">⚠️</span>
                            <div style="font-weight:700;color:var(--color-danger);font-size:1rem">No Rules Triggered</div>
                        </div>
                        <div style="font-size:0.9rem;color:var(--text-secondary)">The simulated conditions did not match any enabled rule. See rule details below.</div>
                    </div>
                    ${ruleDetails ? `<div>${ruleDetails}</div>` : ''}
                    <div style="margin-top:12px">
                        <h4 style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:8px">Test Conditions Used:</h4>
                        <pre style="background:var(--bg-card);padding:10px;border-radius:6px;font-size:0.8rem;overflow-x:auto">${JSON.stringify(data.testData, null, 2)}</pre>
                    </div>
                    <p style="margin-top:10px;font-size:0.85rem">Try adjusting values or check that rules are enabled.</p>
                `;
            } else {
                detailsHtml = `<pre style="color:var(--accent-red)">${JSON.stringify(data, null, 2)}</pre>`;
            }

            container.innerHTML = `
                <div class="result-box ${type}">
                    <div class="result-title">${icons[type]} ${titles[type]}</div>
                    ${detailsHtml}
                </div>
            `;
        }

        function addMockSegment(result) {
            const action = result.action || {};
            const now = new Date();
            const startTime = now.toTimeString().slice(0,5);
            const endDate = new Date(now.getTime() + (action.durationMinutes || 30) * 60000);
            const endTime = endDate.toTimeString().slice(0,5);
            
            const segment = {
                id: Date.now(),
                ruleName: result.ruleName,
                workMode: action.workMode,
                startTime,
                endTime,
                duration: action.durationMinutes,
                minSocOnGrid: action.minSocOnGrid,
                fdSoc: action.fdSoc,
                fdPwr: action.fdPwr,
                maxSoc: action.maxSoc,
                timestamp: now.toISOString()
            };
            
            // Replace existing segment - only Segment 1 exists on the inverter
            mockSchedulerSegments = [segment];
            renderMockScheduler();
        }

        function renderMockScheduler() {
            const container = document.getElementById('mockScheduler');
            
            if (mockSchedulerSegments.length === 0) {
                container.innerHTML = `<div class="empty-state"><div class="icon">📭</div><p>No pending segments</p></div>`;
                return;
            }
            
            let html = '';
            mockSchedulerSegments.forEach((seg, i) => {
                html += `
                <div class="scheduler-segment pending">
                    <div style="display:flex;justify-content:space-between;align-items:center">
                        <div>
                            <span style="font-size:0.7rem;color:var(--accent-blue);margin-right:6px">SEGMENT 1</span>
                            <span class="segment-mode">${seg.workMode}</span>
                        </div>
                        <span style="font-size:0.75rem;color:var(--accent-yellow)">MOCK</span>
                    </div>
                    <div class="time-bar">
                        <div class="fill" style="left:0;width:100%"></div>
                    </div>
                    <div class="segment-info">
                        <span>${seg.startTime} → ${seg.endTime}</span>
                        <span>${seg.duration}min</span>
                    </div>
                    <div style="margin-top:8px;font-size:0.75rem;color:var(--text-secondary);display:grid;grid-template-columns:1fr 1fr;gap:4px">
                        <div>From rule: <strong>${seg.ruleName}</strong></div>
                        <div>Power: <strong style="color:var(--accent)">${seg.fdPwr}W</strong></div>
                        <div>Min SoC (Grid): <strong style="color:var(--accent)">${seg.minSocOnGrid}%</strong></div>
                        <div>Stop SoC: <strong style="color:var(--accent)">${seg.fdSoc}%</strong></div>
                        <div>Max SoC: <strong style="color:var(--accent)">${seg.maxSoc}%</strong></div>
                    </div>
                </div>`;
            });
            
            container.innerHTML = html;
        }

        function clearMockScheduler() {
            mockSchedulerSegments = [];
            renderMockScheduler();
            log('info', 'Mock scheduler cleared');
        }

        function showApiPayload(result) {
            const action = result.action || {};
            const now = new Date();
            const startHour = now.getHours();
            const startMinute = now.getMinutes();
            const endDate = new Date(now.getTime() + (action.durationMinutes || 30) * 60000);
            
            const payload = {
                sn: "YOUR_DEVICE_SN",
                groups: [{
                    enable: true,
                    startHour: startHour,
                    startMinute: startMinute,
                    endHour: endDate.getHours(),
                    endMinute: endDate.getMinutes(),
                    workMode: action.workMode,
                    minSocOnGrid: action.minSocOnGrid || 20,
                    fdSoc: action.fdSoc || 35,
                    fdPwr: action.fdPwr || 0,
                    maxsoc: action.maxSoc || 100
                }]
            };
            
            document.getElementById('apiPayload').textContent = 
                `// POST /op/v0/device/scheduler/set\n` +
                JSON.stringify(payload, null, 2);
        }

        function log(level, message) {
            const container = document.getElementById('logArea');
            const time = new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });
            const formatted = `[${time}] ${message}`;

            if (!container) {
                // Fallback to console so removing the log area doesn't break the page
                const logger = (level === 'error' ? console.error : level === 'warn' || level === 'warning' ? console.warn : console.log);
                logger(`[TestLab] ${formatted}`);
                return;
            }

            const entry = document.createElement('div');
            entry.className = 'log-entry';
            entry.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-${level}">${message}</span>`;
            container.appendChild(entry);
            container.scrollTop = container.scrollHeight;
        }

        // Rule Management
        function showAddRuleModal(editData = null) {
            const isEdit = !!editData;
            
            // Pre-process time condition to handle both formats
            const timeCond = editData?.conditions?.time || editData?.conditions?.timeWindow;
            const timeEnabled = timeCond?.enabled || false;
            const timeStart = timeCond?.startTime || timeCond?.start || '06:00';
            const timeEnd = timeCond?.endTime || timeCond?.end || '18:00';
            
            // Pre-process other conditions
            const solarCond = editData?.conditions?.solarRadiation || {};
            const cloudCond = editData?.conditions?.cloudCover || {};
            const forecastCond = editData?.conditions?.forecastPrice || {};
            
            // Build modal inner content (outer structure is static in HTML)
            const modalInnerHtml = `
                        <div class="modal-header">
                            <h3>${isEdit ? '✏️ Edit Rule' : '➕ Create Test Rule'}</h3>
                            <button class="modal-close" onclick="closeRuleModal()">×</button>
                        </div>
                        
                        <input type="hidden" id="editingRuleId" value="${editData?.id || ''}">
                        
                        <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:16px">
                            <div>
                                <label style="display:block;font-size:0.8rem;color:var(--text-secondary);margin-bottom:4px">Rule Name</label>
                                <input type="text" id="ruleName" value="${editData?.name || ''}" placeholder="e.g., High Export Discharge" style="width:100%">
                            </div>
                            <div>
                                <label style="display:block;font-size:0.8rem;color:var(--text-secondary);margin-bottom:4px">Priority (1=highest)</label>
                                <input type="number" id="rulePriority" value="${editData?.priority || 5}" min="1" max="99" style="width:100%">
                            </div>
                        </div>
                        
                        <!-- Conditions -->
                        <div style="background:var(--bg-card);border-radius:8px;padding:14px;margin-bottom:16px">
                            <h4 style="font-size:0.9rem;color:var(--accent-blue);margin-bottom:12px">📋 Conditions (ALL must match)</h4>
                            
                            <div style="display:flex;flex-direction:column;gap:10px">
                                <!-- Feed-in Price -->
                                <div style="display:flex;align-items:center;gap:10px;padding:8px;background:var(--bg-secondary);border-radius:6px;flex-wrap:wrap">
                                    <input type="checkbox" id="condFeedIn" ${editData?.conditions?.feedInPrice?.enabled ? 'checked' : ''}>
                                    <label style="min-width:120px;font-size:0.85rem">💰 Feed-in Price</label>
                                    <select id="condFeedInOp" style="width:80px" onchange="toggleBetween('FeedIn')">
                                        <option value=">" ${(editData?.conditions?.feedInPrice?.operator || editData?.conditions?.feedInPrice?.op) === '>' ? 'selected' : ''}>&gt;</option>
                                        <option value=">=" ${(editData?.conditions?.feedInPrice?.operator || editData?.conditions?.feedInPrice?.op) === '>=' ? 'selected' : ''}>&gt;=</option>
                                        <option value="<" ${(editData?.conditions?.feedInPrice?.operator || editData?.conditions?.feedInPrice?.op) === '<' ? 'selected' : ''}>&lt;</option>
                                        <option value="<=" ${(editData?.conditions?.feedInPrice?.operator || editData?.conditions?.feedInPrice?.op) === '<=' ? 'selected' : ''}>&lt;=</option>
                                        <option value="between" ${(editData?.conditions?.feedInPrice?.operator || editData?.conditions?.feedInPrice?.op) === 'between' ? 'selected' : ''}>between</option>
                                    </select>
                                    <input type="number" id="condFeedInVal" value="${editData?.conditions?.feedInPrice?.value || 25}" min="-100" max="500" style="width:70px">
                                    <span id="condFeedInVal2Wrap" style="display:${(editData?.conditions?.feedInPrice?.operator || editData?.conditions?.feedInPrice?.op) === 'between' ? 'inline' : 'none'}">and <input type="number" id="condFeedInVal2" value="${editData?.conditions?.feedInPrice?.value2 ?? 50}" min="-100" max="500" style="width:60px"></span>
                                    <span>¢</span>
                                </div>
                                
                                <!-- Buy Price -->
                                <div style="display:flex;align-items:center;gap:10px;padding:8px;background:var(--bg-secondary);border-radius:6px;flex-wrap:wrap">
                                    <input type="checkbox" id="condBuy" ${editData?.conditions?.buyPrice?.enabled ? 'checked' : ''}>
                                    <label style="min-width:120px;font-size:0.85rem">🛒 Buy Price</label>
                                    <select id="condBuyOp" style="width:80px" onchange="toggleBetween('Buy')">
                                        <option value="<" ${(editData?.conditions?.buyPrice?.operator || editData?.conditions?.buyPrice?.op) === '<' ? 'selected' : ''}>&lt;</option>
                                        <option value="<=" ${(editData?.conditions?.buyPrice?.operator || editData?.conditions?.buyPrice?.op) === '<=' ? 'selected' : ''}>&lt;=</option>
                                        <option value=">" ${(editData?.conditions?.buyPrice?.operator || editData?.conditions?.buyPrice?.op) === '>' ? 'selected' : ''}>&gt;</option>
                                        <option value=">=" ${(editData?.conditions?.buyPrice?.operator || editData?.conditions?.buyPrice?.op) === '>=' ? 'selected' : ''}>&gt;=</option>
                                        <option value="between" ${(editData?.conditions?.buyPrice?.operator || editData?.conditions?.buyPrice?.op) === 'between' ? 'selected' : ''}>between</option>
                                    </select>
                                    <input type="number" id="condBuyVal" value="${editData?.conditions?.buyPrice?.value || 10}" min="-100" max="500" style="width:70px">
                                    <span id="condBuyVal2Wrap" style="display:${(editData?.conditions?.buyPrice?.operator || editData?.conditions?.buyPrice?.op) === 'between' ? 'inline' : 'none'}">and <input type="number" id="condBuyVal2" value="${editData?.conditions?.buyPrice?.value2 ?? 20}" min="-100" max="500" style="width:60px"></span>
                                    <span>¢</span>
                                </div>
                                
                                <!-- SoC -->
                                <div style="display:flex;align-items:center;gap:10px;padding:8px;background:var(--bg-secondary);border-radius:6px;flex-wrap:wrap">
                                    <input type="checkbox" id="condSoc" ${editData?.conditions?.soc?.enabled ? 'checked' : ''}>
                                    <label style="min-width:120px;font-size:0.85rem">🔋 Battery SoC</label>
                                    <select id="condSocOp" style="width:80px" onchange="toggleBetween('Soc')">
                                        <option value=">" ${(editData?.conditions?.soc?.operator || editData?.conditions?.soc?.op) === '>' ? 'selected' : ''}>&gt;</option>
                                        <option value=">=" ${(editData?.conditions?.soc?.operator || editData?.conditions?.soc?.op) === '>=' ? 'selected' : ''}>&gt;=</option>
                                        <option value="<" ${(editData?.conditions?.soc?.operator || editData?.conditions?.soc?.op) === '<' ? 'selected' : ''}>&lt;</option>
                                        <option value="<=" ${(editData?.conditions?.soc?.operator || editData?.conditions?.soc?.op) === '<=' ? 'selected' : ''}>&lt;=</option>
                                        <option value="between" ${(editData?.conditions?.soc?.operator || editData?.conditions?.soc?.op) === 'between' ? 'selected' : ''}>between</option>
                                    </select>
                                    <input type="number" id="condSocVal" value="${editData?.conditions?.soc?.value || 50}" min="0" max="100" style="width:70px">
                                    <span id="condSocVal2Wrap" style="display:${(editData?.conditions?.soc?.operator || editData?.conditions?.soc?.op) === 'between' ? 'inline' : 'none'}">and <input type="number" id="condSocVal2" value="${editData?.conditions?.soc?.value2 ?? 80}" min="0" max="100" style="width:60px"></span>
                                    <span>%</span>
                                </div>
                                
                                <!-- Temperature -->
                                <div style="display:flex;align-items:center;gap:10px;padding:8px;background:var(--bg-secondary);border-radius:6px;flex-wrap:wrap">
                                    <input type="checkbox" id="condTemp" ${editData?.conditions?.temperature?.enabled ? 'checked' : ''}>
                                    <label style="min-width:120px;font-size:0.85rem">🌡️ Temperature</label>
                                    <select id="condTempType" style="width:80px">
                                        <option value="battery" ${editData?.conditions?.temperature?.type === 'battery' ? 'selected' : ''}>Battery</option>
                                        <option value="ambient" ${editData?.conditions?.temperature?.type === 'ambient' ? 'selected' : ''}>Ambient</option>
                                        <option value="inverter" ${editData?.conditions?.temperature?.type === 'inverter' ? 'selected' : ''}>Inverter</option>
                                    </select>
                                    <select id="condTempOp" style="width:70px">
                                        <option value="<" ${editData?.conditions?.temperature?.operator === '<' ? 'selected' : ''}>&lt;</option>
                                        <option value="<=" ${editData?.conditions?.temperature?.operator === '<=' ? 'selected' : ''}>&lt;=</option>
                                        <option value=">" ${editData?.conditions?.temperature?.operator === '>' ? 'selected' : ''}>&gt;</option>
                                        <option value=">=" ${editData?.conditions?.temperature?.operator === '>=' ? 'selected' : ''}>&gt;=</option>
                                    </select>
                                    <input type="number" id="condTempVal" value="${editData?.conditions?.temperature?.value || 40}" min="-40" max="80" style="width:60px"> °C
                                </div>
                                
                                <!-- Solar Radiation -->
                                <div style="display:flex;align-items:center;gap:10px;padding:8px;background:var(--bg-secondary);border-radius:6px;flex-wrap:wrap">
                                    <input type="checkbox" id="condSolar" ${solarCond.enabled ? 'checked' : ''}>
                                    <label style="min-width:120px;font-size:0.85rem">☀️ Solar Radiation</label>
                                    <select id="condSolarCheck" style="width:70px">
                                        <option value="average" ${solarCond.check === 'average' ? 'selected' : ''}>Avg</option>
                                        <option value="min" ${solarCond.check === 'min' ? 'selected' : ''}>Min</option>
                                        <option value="max" ${solarCond.check === 'max' ? 'selected' : ''}>Max</option>
                                    </select>
                                    <select id="condSolarOp" style="width:70px">
                                        <option value=">" ${solarCond.operator === '>' ? 'selected' : ''}>&gt;</option>
                                        <option value=">=" ${solarCond.operator === '>=' ? 'selected' : ''}>&gt;=</option>
                                        <option value="<" ${solarCond.operator === '<' ? 'selected' : ''}>&lt;</option>
                                        <option value="<=" ${solarCond.operator === '<=' ? 'selected' : ''}>&lt;=</option>
                                    </select>
                                    <input type="number" id="condSolarVal" value="${solarCond.value || 300}" min="0" max="1500" step="10" style="width:70px">
                                    <span style="font-size:0.8rem;color:var(--text-secondary)">W/m² in next</span>
                                    <input type="number" id="condSolarLookAhead" value="${solarCond.lookAhead || 6}" min="1" max="168" style="width:50px;font-size:0.85rem" title="Max 7 days (168 hours)">
                                    <select id="condSolarLookAheadUnit" style="width:60px;font-size:0.85rem">
                                        <option value="hours" ${solarCond.lookAheadUnit === 'hours' ? 'selected' : ''}>hrs</option>
                                        <option value="days" ${solarCond.lookAheadUnit === 'days' ? 'selected' : ''}>days</option>
                                    </select>
                                </div>
                                
                                <!-- Cloud Cover -->
                                <div style="display:flex;align-items:center;gap:10px;padding:8px;background:var(--bg-secondary);border-radius:6px;flex-wrap:wrap">
                                    <input type="checkbox" id="condCloud" ${cloudCond.enabled ? 'checked' : ''}>
                                    <label style="min-width:120px;font-size:0.85rem">☁️ Cloud Cover</label>
                                    <select id="condCloudCheck" style="width:70px">
                                        <option value="average" ${cloudCond.check === 'average' ? 'selected' : ''}>Avg</option>
                                        <option value="min" ${cloudCond.check === 'min' ? 'selected' : ''}>Min</option>
                                        <option value="max" ${cloudCond.check === 'max' ? 'selected' : ''}>Max</option>
                                    </select>
                                    <select id="condCloudOp" style="width:70px">
                                        <option value="<" ${cloudCond.operator === '<' ? 'selected' : ''}>&lt;</option>
                                        <option value="<=" ${cloudCond.operator === '<=' ? 'selected' : ''}>&lt;=</option>
                                        <option value=">" ${cloudCond.operator === '>' ? 'selected' : ''}>&gt;</option>
                                        <option value=">=" ${cloudCond.operator === '>=' ? 'selected' : ''}>&gt;=</option>
                                    </select>
                                    <input type="number" id="condCloudVal" value="${cloudCond.value || 50}" min="0" max="100" style="width:60px">
                                    <span style="font-size:0.8rem;color:var(--text-secondary)">% in next</span>
                                    <input type="number" id="condCloudLookAhead" value="${cloudCond.lookAhead || 6}" min="1" max="168" style="width:50px;font-size:0.85rem" title="Max 7 days (168 hours)">
                                    <select id="condCloudLookAheadUnit" style="width:60px;font-size:0.85rem">
                                        <option value="hours" ${cloudCond.lookAheadUnit === 'hours' ? 'selected' : ''}>hrs</option>
                                        <option value="days" ${cloudCond.lookAheadUnit === 'days' ? 'selected' : ''}>days</option>
                                    </select>
                                </div>
                                
                                <!-- Forecast Price -->
                                <div style="display:flex;align-items:center;gap:10px;padding:8px;background:var(--bg-secondary);border-radius:6px;flex-wrap:wrap">
                                    <input type="checkbox" id="condForecast" ${forecastCond.enabled ? 'checked' : ''}>
                                    <label style="min-width:120px;font-size:0.85rem">📈 Forecast Price</label>
                                    <select id="condForecastType" style="width:70px">
                                        <option value="feedIn" ${forecastCond.type === 'feedIn' ? 'selected' : ''}>Feed-in</option>
                                        <option value="general" ${forecastCond.type === 'general' || !forecastCond.type ? 'selected' : ''}>Buy</option>
                                    </select>
                                    <select id="condForecastCheck" style="width:70px">
                                        <option value="average" ${forecastCond.check === 'average' ? 'selected' : ''}>Avg</option>
                                        <option value="min" ${forecastCond.check === 'min' ? 'selected' : ''}>Min</option>
                                        <option value="max" ${forecastCond.check === 'max' || !forecastCond.check ? 'selected' : ''}>Max</option>
                                        <option value="any" ${forecastCond.check === 'any' ? 'selected' : ''}>Any</option>
                                    </select>
                                    <select id="condForecastOp" style="width:70px">
                                        <option value=">" ${forecastCond.operator === '>' ? 'selected' : ''}>&gt;</option>
                                        <option value=">=" ${forecastCond.operator === '>=' ? 'selected' : ''}>&gt;=</option>
                                        <option value="<" ${forecastCond.operator === '<' ? 'selected' : ''}>&lt;</option>
                                        <option value="<=" ${forecastCond.operator === '<=' ? 'selected' : ''}>&lt;=</option>
                                    </select>
                                    <input type="number" id="condForecastVal" value="${forecastCond.value || 30}" min="-100" max="500" style="width:60px">
                                    <span style="font-size:0.8rem;color:var(--text-secondary)">¢ in next</span>
                                    <input type="number" id="condForecastLookAhead" value="${forecastCond.lookAhead || 1}" min="1" max="24" style="width:50px;font-size:0.85rem" title="Max 24 hours or 1 day">
                                    <select id="condForecastLookAheadUnit" style="width:60px;font-size:0.85rem">
                                        <option value="hours" ${forecastCond.lookAheadUnit === 'hours' ? 'selected' : ''}>hrs</option>
                                        <option value="days" ${forecastCond.lookAheadUnit === 'days' ? 'selected' : ''}>days</option>
                                    </select>
                                </div>
                                
                                <!-- Time Window -->
                                <div style="display:flex;align-items:center;gap:10px;padding:8px;background:var(--bg-secondary);border-radius:6px;flex-wrap:wrap">
                                    <input type="checkbox" id="condTime" ${timeEnabled ? 'checked' : ''}>
                                    <label style="min-width:120px;font-size:0.85rem">🕐 Time Window</label>
                                    <input type="time" id="condTimeStart" value="${timeStart}">
                                    <span>to</span>
                                    <input type="time" id="condTimeEnd" value="${timeEnd}">
                                </div>
                            </div>
                        </div>
                        
                        <!-- Action -->
                        <div style="background:var(--bg-card);border-radius:8px;padding:14px;margin-bottom:16px">
                            <h4 style="font-size:0.9rem;color:var(--accent);margin-bottom:12px">⚡ Action</h4>
                            
                            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">
                                <div>
                                    <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px">Work Mode</label>
                                    <select id="actionMode" style="width:100%">
                                        <option value="ForceDischarge" ${editData?.action?.workMode === 'ForceDischarge' ? 'selected' : ''}>Force Discharge</option>
                                        <option value="ForceCharge" ${editData?.action?.workMode === 'ForceCharge' ? 'selected' : ''}>Force Charge</option>
                                        <option value="SelfUse" ${editData?.action?.workMode === 'SelfUse' ? 'selected' : ''}>Self Use</option>
                                        <option value="Feedin" ${editData?.action?.workMode === 'Feedin' ? 'selected' : ''}>Feed In</option>
                                        <option value="Backup" ${editData?.action?.workMode === 'Backup' ? 'selected' : ''}>Backup</option>
                                    </select>
                                </div>
                                <div>
                                    <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px">Duration (min)</label>
                                    <input type="number" id="actionDuration" value="${editData?.action?.durationMinutes || 30}" min="5" max="120" style="width:100%">
                                </div>
                                <div>
                                    <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px">Cooldown (min)</label>
                                    <input type="number" id="actionCooldown" value="${editData?.cooldownMinutes || 5}" min="1" max="1440" style="width:100%">
                                </div>
                            </div>
                            
                            <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px">
                                <div>
                                    <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px">Power (W)</label>
                                    <input type="number" id="actionFdPwr" value="${editData?.action?.fdPwr || 7000}" min="0" max="10500" step="100" style="width:100%">
                                </div>
                                <div>
                                    <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px">Stop SoC (%)</label>
                                    <input type="number" id="actionFdSoc" value="${editData?.action?.fdSoc || 35}" min="10" max="100" style="width:100%">
                                </div>
                                <div>
                                    <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px">Min SoC (Grid)</label>
                                    <input type="number" id="actionMinSoc" value="${editData?.action?.minSocOnGrid || 20}" min="10" max="100" style="width:100%">
                                </div>
                                <div>
                                    <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px">Max SoC (%)</label>
                                    <input type="number" id="actionMaxSoc" value="${editData?.action?.maxSoc || 90}" min="10" max="100" style="width:100%">
                                </div>
                            </div>
                        </div>
                        
                        <div style="display:flex;gap:10px">
                            <button class="btn-secondary" style="flex:1" onclick="closeRuleModal()">Cancel</button>
                            <button class="btn-primary" style="flex:1" onclick="saveRule()">${isEdit ? 'Update Rule' : 'Create Rule'}</button>
                        </div>
            `;
            
            // Populate the static modal container and show it using direct style manipulation
            const modalContent = document.getElementById('ruleModalContent');
            const modalOverlay = document.getElementById('ruleModal');
            
            modalContent.innerHTML = modalInnerHtml;
            
            // Force modal to display centered with inline styles (bypasses any CSS conflicts)
            modalOverlay.style.cssText = `
                display: flex !important;
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                right: 0 !important;
                bottom: 0 !important;
                width: 100vw !important;
                height: 100dvh !important;
                align-items: center !important;
                justify-content: center !important;
                background: rgba(0, 0, 0, 0.85) !important;
                backdrop-filter: blur(4px) !important;
                z-index: 999999 !important;
                padding: 20px !important;
                box-sizing: border-box !important;
                margin: 0 !important;
            `;
            
            // Lock background scroll
            document.body.classList.add('modal-open');
            
            // Close on Esc key
            const escHandler = (e) => { if (e.key === 'Escape') closeRuleModal(); };
            document.addEventListener('keydown', escHandler);
            modalOverlay._escHandler = escHandler;
        }

        // Toggle between value display for range operators
        function toggleBetween(type) {
            const op = document.getElementById('cond' + type + 'Op').value;
            const wrap = document.getElementById('cond' + type + 'Val2Wrap');
            if (wrap) {
                wrap.style.display = op === 'between' ? 'inline' : 'none';
            }
        }

        function closeRuleModal() {
            const modal = document.getElementById('ruleModal');
            if (modal) {
                // remove any Esc listener
                try {
                    const handler = modal._escHandler;
                    if (handler) document.removeEventListener('keydown', handler);
                } catch (e) {}
                // Hide the modal by clearing inline styles and setting display none
                modal.style.cssText = 'display: none !important;';
            }
            document.body.classList.remove('modal-open');
        }

        async function saveRule() {
            const editingId = document.getElementById('editingRuleId').value;
            const name = document.getElementById('ruleName').value.trim();
            
            if (!name) {
                alert('Please enter a rule name');
                return;
            }
            
            const ruleName = editingId || name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || ('rule_' + Date.now());
            
            // Build conditions including new types
            const feedInOp = document.getElementById('condFeedInOp').value;
            const buyOp = document.getElementById('condBuyOp').value;
            const socOp = document.getElementById('condSocOp').value;
            
            const conditions = {
                feedInPrice: {
                    enabled: document.getElementById('condFeedIn').checked,
                    operator: feedInOp,
                    value: parseFloat(document.getElementById('condFeedInVal').value) || 0,
                    ...(feedInOp === 'between' && { value2: parseFloat(document.getElementById('condFeedInVal2').value) || 50 })
                },
                buyPrice: {
                    enabled: document.getElementById('condBuy').checked,
                    operator: buyOp,
                    value: parseFloat(document.getElementById('condBuyVal').value) || 0,
                    ...(buyOp === 'between' && { value2: parseFloat(document.getElementById('condBuyVal2').value) || 20 })
                },
                soc: {
                    enabled: document.getElementById('condSoc').checked,
                    operator: socOp,
                    value: parseFloat(document.getElementById('condSocVal').value) || 50,
                    ...(socOp === 'between' && { value2: parseFloat(document.getElementById('condSocVal2').value) || 80 })
                },
                temperature: {
                    enabled: document.getElementById('condTemp').checked,
                    type: document.getElementById('condTempType').value,
                    operator: document.getElementById('condTempOp').value,
                    value: parseFloat(document.getElementById('condTempVal').value) || 40
                },
                solarRadiation: {
                    enabled: document.getElementById('condSolar').checked,
                    check: document.getElementById('condSolarCheck').value,
                    checkType: document.getElementById('condSolarCheck').value,  // Backend uses 'checkType'
                    operator: document.getElementById('condSolarOp').value,
                    value: parseFloat(document.getElementById('condSolarVal').value) || 300,
                    lookAhead: parseInt(document.getElementById('condSolarLookAhead').value) || 6,
                    lookAheadUnit: document.getElementById('condSolarLookAheadUnit').value || 'hours'
                },
                cloudCover: {
                    enabled: document.getElementById('condCloud').checked,
                    check: document.getElementById('condCloudCheck').value,
                    checkType: document.getElementById('condCloudCheck').value,  // Backend uses 'checkType'
                    operator: document.getElementById('condCloudOp').value,
                    value: parseFloat(document.getElementById('condCloudVal').value) || 50,
                    lookAhead: parseInt(document.getElementById('condCloudLookAhead').value) || 6,
                    lookAheadUnit: document.getElementById('condCloudLookAheadUnit').value || 'hours'
                },
                forecastPrice: {
                    enabled: document.getElementById('condForecast').checked,
                    type: document.getElementById('condForecastType').value,
                    checkType: document.getElementById('condForecastCheck').value,  // Backend uses 'checkType'
                    operator: document.getElementById('condForecastOp').value,
                    value: parseFloat(document.getElementById('condForecastVal').value) || 30,
                    lookAhead: parseInt(document.getElementById('condForecastLookAhead').value) || 1,
                    lookAheadUnit: document.getElementById('condForecastLookAheadUnit').value || 'hours'
                },
                time: {
                    enabled: document.getElementById('condTime').checked,
                    startTime: document.getElementById('condTimeStart').value || '00:00',
                    endTime: document.getElementById('condTimeEnd').value || '23:59'
                }
            };
            
            const hasCondition = Object.values(conditions).some(c => c.enabled);
            if (!hasCondition) {
                alert('Please enable at least one condition');
                return;
            }
            
            const payload = {
                ruleName,
                name,
                priority: parseInt(document.getElementById('rulePriority').value) || 5,
                conditions,
                cooldownMinutes: parseInt(document.getElementById('actionCooldown').value) || 5,
                enabled: true,
                action: {
                    workMode: document.getElementById('actionMode').value,
                    durationMinutes: parseInt(document.getElementById('actionDuration').value) || 30,
                    fdPwr: parseInt(document.getElementById('actionFdPwr').value) || 7000,
                    fdSoc: parseInt(document.getElementById('actionFdSoc').value) || 35,
                    minSocOnGrid: parseInt(document.getElementById('actionMinSoc').value) || 20,
                    maxSoc: parseInt(document.getElementById('actionMaxSoc').value) || 90
                }
            };
            
            try {
                const endpoint = editingId ? '/api/automation/rule/update' : '/api/automation/rule/create';
                const resp = await authenticatedFetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await resp.json();
                
                if (data.errno === 0) {
                    log('success', `Rule ${editingId ? 'updated' : 'created'}: ${name}`);
                    closeRuleModal();
                    loadRules();
                } else {
                    alert('Failed: ' + (data.error || 'Unknown error'));
                }
            } catch (e) {
                alert('Error: ' + e.message);
            }
        }

        async function editRule(ruleName) {
            alert('📌 Rule editing is only available in the main automation page (app.html).\n\nPlease navigate there to edit rules.');
            return;
        }

        async function deleteRule(ruleName) {
            alert('🗑️ Rule deletion is only available in the main automation page (app.html).\n\nPlease navigate there to delete rules.');
            return;
        }

        // AppShell handles auth lifecycle; no additional bootstrap required here.

        // WIP Pages visibility - Topology Discovery (admin only)
        if (typeof window.auth !== 'undefined' && window.auth) {
            window.auth.onAuthStateChanged((user) => {
                if (user && user.email === 'socrates.team.comms@gmail.com') {
                    const topologyLink = document.getElementById('topologyNavLink');
                    if (topologyLink) topologyLink.style.display = '';
                }
            });
        }
    
