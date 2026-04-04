
        // Global state
        let roiData = null;
        let automationHistoryData = null;
        let deviceSn = null;
        let deviceProvider = 'foxess';
        let providerCapabilities = resolveRoiProviderCapabilities(deviceProvider);

        async function getRoiPricingContext() {
            const configResp = await apiClient.getConfig();
            const config = configResp?.result || {};
            const provider = String(config.pricingProvider || 'amber').trim().toLowerCase() || 'amber';
            const storedSelection = window.sharedUtils && typeof window.sharedUtils.getStoredPricingSelection === 'function'
                ? window.sharedUtils.getStoredPricingSelection(provider)
                : '';
            const selection = storedSelection || (provider === 'aemo'
                ? (config.aemoRegion || config.siteIdOrRegion || 'NSW1')
                : (config.amberSiteId || config.siteIdOrRegion || ''));
            return { provider, selection };
        }

        function normalizeRoiProvider(provider) {
            if (window.sharedUtils && typeof window.sharedUtils.normalizeDeviceProvider === 'function') {
                return window.sharedUtils.normalizeDeviceProvider(provider);
            }
            const normalized = String(provider || '').trim().toLowerCase();
            return normalized || 'unknown';
        }

        function getRoiImpactHelpers() {
            if (typeof window !== 'undefined' && window.RoiImpact) {
                return window.RoiImpact;
            }
            return null;
        }

        function getDefaultRoiEmptyStateMarkup() {
            return `
                <div class="empty-state">
                    <div class="icon">💵</div>
                    <p>Click "Calculate ROI" to review triggered-rule value estimates</p>
                    <p style="font-size:12px;margin-top:8px">Shows gross triggered-rule value using charge cost, import avoidance, and export capture. Use backtests below for passive self-use comparison.</p>
                </div>
            `;
        }

        function escHtml(value) {
            const helpers = getRoiImpactHelpers();
            if (helpers && typeof helpers.escHtml === 'function') {
                return helpers.escHtml(value);
            }
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function showStatus(statusEl, variant, text) {
            if (!statusEl) return;
            statusEl.style.display = 'block';
            statusEl.className = variant ? `status ${variant}` : 'status';
            statusEl.textContent = text || '';
        }

        function clearStatus(statusEl) {
            if (!statusEl) return;
            statusEl.style.display = '';
            statusEl.className = 'status';
            statusEl.textContent = '';
        }

        function dismissStatus(statusEl) {
            if (!statusEl) return;
            clearStatus(statusEl);
            statusEl.style.display = 'none';
        }

        function formatSignedAud(value) {
            if (value === null || value === undefined || Number.isNaN(Number(value))) {
                return '—';
            }
            const amount = Number(value);
            const sign = amount < 0 ? '-' : '';
            return `${sign}$${Math.abs(amount).toFixed(2)}`;
        }

        function resolveRoiProviderCapabilities(provider) {
            const normalized = normalizeRoiProvider(provider);
            const helpers = getRoiImpactHelpers();
            const knownProfiles = helpers && helpers.KNOWN_PROVIDER_PROFILES
                ? helpers.KNOWN_PROVIDER_PROFILES
                : null;
            const hasKnownProfile = !!(knownProfiles && Object.prototype.hasOwnProperty.call(knownProfiles, normalized));

            let baseCapabilities = {};
            if (hasKnownProfile && window.sharedUtils && typeof window.sharedUtils.getProviderCapabilities === 'function') {
                baseCapabilities = window.sharedUtils.getProviderCapabilities(normalized) || {};
            }

            if (helpers && typeof helpers.buildRoiProviderCapabilities === 'function') {
                return helpers.buildRoiProviderCapabilities(normalized, baseCapabilities);
            }

            const defaultLabels = {
                alphaess: 'AlphaESS',
                foxess: 'FoxESS',
                sigenergy: 'SigenEnergy',
                sungrow: 'Sungrow'
            };
            return {
                ...baseCapabilities,
                provider: normalized,
                label: defaultLabels[normalized] || 'Unknown provider',
                supportsExactPowerControl: normalized === 'foxess',
                roiAccuracy: normalized === 'foxess' ? 'exact' : 'provisional',
                roiAccuracyLabel: normalized === 'foxess' ? 'Exact' : 'Provisional',
                roiExplanation: normalized === 'foxess'
                    ? 'Uses actual settled prices, requested power, and actual runtime. Treat as an estimate, not invoice-grade billing.'
                    : 'This provider is not in the current ROI capability map, so values are shown conservatively and should be treated as provisional.'
            };
        }

        function renderRoiProviderNotice() {
            const roiContent = document.getElementById('roiContent');
            if (!roiContent || !roiContent.parentElement) return;

            let noticeEl = document.getElementById('roiProviderNotice');
            if (!noticeEl) {
                noticeEl = document.createElement('div');
                noticeEl.id = 'roiProviderNotice';
                noticeEl.className = 'info-banner';
                noticeEl.style.display = 'none';
                roiContent.parentElement.insertBefore(noticeEl, roiContent);
            }

            const accuracyLabel = escHtml(providerCapabilities.roiAccuracyLabel || 'Provisional');
            const providerLabel = escHtml(providerCapabilities.label || 'Unknown provider');
            const explanation = escHtml(providerCapabilities.roiExplanation || 'ROI values are shown conservatively for this provider.');
            const icon = providerCapabilities.roiAccuracy === 'exact' ? '✅' : (providerCapabilities.roiAccuracy === 'indicative' ? 'ℹ️' : '⚠️');

            noticeEl.style.display = 'flex';
            noticeEl.innerHTML = `
                <span class="icon">${icon}</span>
                <div class="text">
                    <strong>${providerLabel} ROI accuracy: ${accuracyLabel}</strong> ${explanation}
                </div>
            `;
        }

        /**
         * Format duration in milliseconds to human-readable string
         */
        function formatDuration(ms) {
            if (!ms) return '0s';
            
            const seconds = Math.floor(ms / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);
            
            if (days > 0) return `${days}d ${hours % 24}h`;
            if (hours > 0) return `${hours}h ${minutes % 60}m`;
            if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
            return `${seconds}s`;
        }

        /**
         * Validate that date range does not exceed 7 days
         */
        function validateDateRange() {
            const startDateInput = document.getElementById('roiStartDate');
            const endDateInput = document.getElementById('roiEndDate');
            const status = document.getElementById('roiStatus');
            
            if (!startDateInput.value || !endDateInput.value) return;
            
            const startDate = new Date(startDateInput.value);
            const endDate = new Date(endDateInput.value);
            const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
            
            if (daysDiff > 7) {
                showStatus(status, 'warning', '⚠ Maximum 7 days allowed. Start date will be auto-adjusted to match this range.');
                // Auto-adjust start date to be 7 days before end date
                const adjustedStart = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
                startDateInput.valueAsDate = adjustedStart;
            } else {
                clearStatus(status);
            }
        }

        /**
         * Initialize date pickers with default values
         */
        function initDatePickers() {
            const today = new Date();
            const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
            
            document.getElementById('roiEndDate').valueAsDate = today;
            document.getElementById('roiStartDate').valueAsDate = sevenDaysAgo;
            
            // Add validation listeners for date changes
            document.getElementById('roiStartDate').addEventListener('change', validateDateRange);
            document.getElementById('roiEndDate').addEventListener('change', validateDateRange);
        }

        function resolveRoiEventClassification(event) {
            if (
                typeof window !== 'undefined' &&
                window.ROIClassification &&
                typeof window.ROIClassification.resolveRoiEventClassification === 'function'
            ) {
                return window.ROIClassification.resolveRoiEventClassification(event);
            }
            return {
                isChargeRule: false,
                isDischargeRule: false,
                isExportMode: false,
                isFeedinRule: false,
                ruleType: 'Unknown'
            };
        }

        /**
         * Calculate ROI based on rule history and prices
         */
        async function calculateROI() {
            const startDate = document.getElementById('roiStartDate').value;
            const endDate = document.getElementById('roiEndDate').value;
            const btn = document.getElementById('btnCalculateROI');
            const status = document.getElementById('roiStatus');
            const content = document.getElementById('roiContent');

            if (!startDate || !endDate) {
                showStatus(status, 'error', '✗ Please select both start and end dates');
                return;
            }
            
            if (new Date(startDate) > new Date(endDate)) {
                showStatus(status, 'error', '✗ Start date must be before end date');
                return;
            }
            
            btn.disabled = true;
            btn.innerHTML = '⏳ Calculating...';
            showStatus(status, 'loading', 'Calculating ROI...');
            
            try {
                // Fetch automation audit data for the date range
                // Calculate days: if same day, request 2 days; otherwise add 1 to include end date
                const startDateObj = new Date(startDate);
                const endDateObj = new Date(endDate);
                const daysDiff = Math.ceil((endDateObj - startDateObj) / (1000 * 60 * 60 * 24));
                const daysToFetch = Math.max(2, daysDiff + 1); // Always fetch at least 2 days to handle timezone offsets
                
                // Pass date range to backend so it can filter properly
                const auditResp = await authenticatedFetch(`/api/automation/audit?days=${Math.min(daysToFetch, 7)}&startDate=${startDate}&endDate=${endDate}`);
                const auditData = await auditResp.json();
                
                if (auditData.errno && auditData.errno !== 0) {
                    throw new Error(auditData.error || 'Failed to fetch audit data');
                }
                
                // Filter events within date range
                const allEvents = auditData.result?.ruleEvents || [];
                
                // Backend now filters by date range, but we do a final check for safety
                const events = allEvents.filter(event => {
                    if (!event.startTime && event.startTime !== 0) {
                        console.warn('[ROI] Event missing startTime:', event);
                        return false;
                    }
                    return true;
                });
                
                if (events.length === 0) {
                    content.innerHTML = `
                        <div class="empty-state">
                            <div class="icon">📭</div>
                            <p>No triggered rules in this window.</p>
                            <p style="font-size:12px;margin-top:8px">Choose another range or wait for new activity.</p>
                        </div>
                    `;
                    showStatus(status, 'success', 'No rules triggered during this period');
                    return;
                }
                
                // Fetch current automation enabled state
                let isAutomationEnabled = false;
                // NOTE: /api/automation/state and /api/pricing/prices endpoints don't exist or require parameters
                // We fetch automation state from config endpoint and prices from historical data above
                let pricesData = null;
                try {
                    const configResp = await authenticatedFetch('/api/config');
                    const configJson = await configResp.json();
                    if (configJson.errno === 0 && configJson.result) {
                        // Check if automation rules exist in config
                        isAutomationEnabled = (configJson.result.rules && configJson.result.rules.length > 0);
                    }
                } catch (e) {
                    // If config fetch fails, that's OK - we'll assume automation is enabled since we have events
                    isAutomationEnabled = (events && events.length > 0);
                }
                
                await renderROICalculation(events, startDate, endDate, pricesData, isAutomationEnabled);
                
                showStatus(status, 'success', `✓ Analyzed ${events.length} rule trigger(s)`);
                setTimeout(() => { dismissStatus(status); }, 3000);
            } catch (e) {
                showStatus(status, 'error', `✗ Error: ${e.message}`);
                content.innerHTML = `
                    <div class="empty-state">
                        <div class="icon">❌</div>
                        <p>Failed to calculate ROI</p>
                        <p style="font-size:12px;margin-top:8px">${escHtml(e.message)}</p>
                    </div>
                `;
            } finally {
                btn.disabled = false;
                btn.innerHTML = 'Calculate ROI';
            }
        }

        /**
         * Render ROI calculation results
         */
        async function renderROICalculation(events, startDate, endDate, pricesData, isAutomationEnabled) {
            const content = document.getElementById('roiContent');
            
            try {
            
            const impactHelpers = getRoiImpactHelpers();
            if (!impactHelpers || typeof impactHelpers.calculateEventImpact !== 'function' || typeof impactHelpers.formatPriceBasis !== 'function') {
                throw new Error('ROI impact helpers are unavailable.');
            }

            // Helper function to extract price inputs from rule data (prefer explicit fields, fallback to parsing)
            function extractPriceFromRule(ruleEvals) {
                const extracted = {
                    anyPrice: null,
                    buyPrice: null,
                    feedInPrice: null
                };
                if (!ruleEvals || ruleEvals.length === 0) {
                    return extracted;
                }

                for (const ruleEval of ruleEvals) {
                    if (!ruleEval || !ruleEval.triggered) continue;
                    if (extracted.feedInPrice === null && ruleEval.feedInPrice !== null && ruleEval.feedInPrice !== undefined) {
                        extracted.feedInPrice = Number(ruleEval.feedInPrice);
                    }
                    if (extracted.buyPrice === null && ruleEval.buyPrice !== null && ruleEval.buyPrice !== undefined) {
                        extracted.buyPrice = Number(ruleEval.buyPrice);
                    }
                }

                for (const ruleEval of ruleEvals) {
                    if (!ruleEval || !ruleEval.triggered || !ruleEval.conditions || ruleEval.conditions.length === 0) continue;
                    for (const condition of ruleEval.conditions) {
                        const condName = String(condition.name || condition.rule || '').trim();
                        if (condName.includes('SoC') || condName.includes('Temperature') || condName.includes('Temp') || condName.includes('Battery')) {
                            continue;
                        }

                        if ((condName.includes('Price') || condName.includes('Feed') || condName === 'price') && condition.value !== undefined && condition.value !== null) {
                            const parsed = parseFloat(condition.value);
                            if (!Number.isNaN(parsed) && parsed > -10000 && parsed < 10000) {
                                const lowerName = condName.toLowerCase();
                                if (extracted.anyPrice === null) extracted.anyPrice = parsed;
                                if (lowerName.includes('feed') && extracted.feedInPrice === null) {
                                    extracted.feedInPrice = parsed;
                                } else if (lowerName.includes('buy') && extracted.buyPrice === null) {
                                    extracted.buyPrice = parsed;
                                }
                            }
                        }
                    }
                }

                return extracted;
            }
            
            // Calculate summary stats
            let totalRules = 0;
            let totalChargeRules = 0;
            let totalDischargeRules = 0;
            let totalNetImpactAud = 0;
            let totalChargeImpactAud = 0;
            let totalImportAvoidanceAud = 0;
            let totalExportCaptureAud = 0;
            
            // Tracking for new metrics
            let totalChargePower = 0;
            let totalDischargePower = 0;
            let numRulesWithImpact = 0;
            
            // Store impact details for each event for later use in table
            const eventImpacts = [];
            
            // Fetch ALL actual prices for the ACTUAL event date range (not just user-selected range)
            const actualPriceMap = new Map(); // key: ISO timestamp, value: {buyPrice, feedInPrice}
            
            try {
                const pricingContext = await getRoiPricingContext();
                const sitesResp = await apiClient.getPricingSites(pricingContext.provider);
                if (sitesResp && sitesResp.errno === 0 && sitesResp.result && sitesResp.result.length > 0) {
                    const selectionKey = pricingContext.provider === 'aemo' ? 'region' : 'id';
                    const siteId = (pricingContext.selection && sitesResp.result.some(s => String(s[selectionKey] || s.id) === pricingContext.selection))
                        ? pricingContext.selection
                        : String(sitesResp.result[0][selectionKey] || sitesResp.result[0].id || '');

                    // Find the actual date range covered by events (may be wider than user selection)
                    let minEventTime = Infinity;
                    let maxEventTime = -Infinity;
                    for (const event of events) {
                        if (event.startTime) {
                            const eventTime = new Date(event.startTime).getTime();
                            minEventTime = Math.min(minEventTime, eventTime);
                            maxEventTime = Math.max(maxEventTime, eventTime);
                        }
                    }

                    // If we found events, use their date range; otherwise fallback to user selection
                    let fetchStartDate, fetchEndDate;
                    if (minEventTime !== Infinity && maxEventTime !== -Infinity) {
                        // Convert event timestamps to date strings (UTC)
                        // Events are stored as epoch ms and represent UTC times
                        const minDate = new Date(minEventTime);
                        const maxDate = new Date(maxEventTime);

                        // Extract UTC date (YYYY-MM-DD) and add one day buffer at end for safety
                        fetchStartDate = minDate.toISOString().split('T')[0];
                        fetchEndDate = new Date(maxDate.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                    } else {
                        // Fallback: use user-selected date range
                        // User selects dates in their local timezone (AEDT), pass them directly to API
                        // Amber API interprets YYYY-MM-DD as local Australian dates
                        fetchStartDate = startDate;
                        fetchEndDate = endDate;
                    }

                    // Fetch all prices for the date range with 5-minute resolution (not actualOnly to get recent data)
                    const pricesResp = await apiClient.getPricingHistoricalPrices(pricingContext.provider, siteId, fetchStartDate, fetchEndDate, 5, false);
                    if (pricesResp && pricesResp.errno === 0 && pricesResp.result) {
                        const applyAmberSecondOffset = pricingContext.provider === 'amber';
                        const nowMs = Date.now();
                        // Build map of prices indexed by EPOCH MILLISECONDS (avoids timezone issues)
                        for (const pricePoint of pricesResp.result) {
                            const startMs = new Date(pricePoint.startTime || pricePoint.nemTime).getTime();
                            // Use only settled (actual) prices: ignore forecasts and future timestamps
                            if (pricePoint.type === 'ForecastInterval' || startMs > nowMs) {
                                continue;
                            }
                            // Amber historical rows sometimes land one second after the interval boundary
                            // (for example 14:00:01 instead of 14:00:00). Keep that compatibility shim
                            // for Amber only; AEMO rows already align to exact 5-minute boundaries.
                            const priceEpochMs = applyAmberSecondOffset ? (startMs - 1000) : startMs;
                            const channelType = pricePoint.channelType;

                            // Amber API returns prices in cents/kWh already (e.g., 105.87 = 105.87¢/kWh)
                            // No conversion or normalization needed
                            const perKwh = pricePoint.perKwh;

                            if (!actualPriceMap.has(priceEpochMs)) {
                                actualPriceMap.set(priceEpochMs, {});
                            }

                            if (channelType === 'general') {
                                actualPriceMap.get(priceEpochMs).buyPrice = perKwh;
                            } else if (channelType === 'feedIn') {
                                // Amber API returns feedIn as negative (grid paying user to take power)
                                // Negate it so discharge operations (exporting) show positive revenue
                                actualPriceMap.get(priceEpochMs).feedInPrice = -perKwh;
                            }
                        }
                    } else {
                        console.warn('[ROI Actual] No price data returned:', pricesResp);
                    }
                }
            } catch (error) {
                console.warn('[ROI Actual] Failed to fetch historical prices:', error.message);
            }
            
            /**
             * Look up actual prices from the pre-fetched cache
             * For events spanning multiple 5-min windows, average the prices
             */
            function getActualPrice(event) {
                if (!event || !event.startTime || actualPriceMap.size === 0) {
                    return { feedInPrice: null, buyPrice: null };
                }
                
                // Event times are in epoch milliseconds (timezone-agnostic), create Date object
                const eventTime = new Date(event.startTime);
                const eventDuration = event.durationMs || 0;
                const eventEndTime = new Date(eventTime.getTime() + eventDuration);
                const now = new Date();
                const ageMinutes = (now.getTime() - eventTime.getTime()) / (1000 * 60);
                
                // Only use actual prices for events older than 5 minutes
                if (ageMinutes < 5) {
                    return { feedInPrice: null, buyPrice: null };
                }
                
                // Event timestamps are stored as epoch milliseconds (timezone-agnostic)
                // Use them directly without any timezone conversion
                
                // Collect all 5-minute windows that fall within the event duration
                const buyPrices = [];
                const feedInPrices = [];
                
                // Round start time down to nearest 5-minute interval (using epoch ms)
                const startWindowMs = Math.floor(eventTime.getTime() / (5 * 60 * 1000)) * (5 * 60 * 1000);
                
                // Iterate through all 5-minute windows in the event duration
                for (let windowMs = startWindowMs; windowMs <= eventEndTime.getTime(); windowMs += 5 * 60 * 1000) {
                    // Use epoch ms directly as key (no timezone conversion needed)
                    const priceData = actualPriceMap.get(windowMs);
                    
                    if (priceData) {
                        if (priceData.buyPrice !== null && priceData.buyPrice !== undefined) {
                            buyPrices.push(priceData.buyPrice);
                        }
                        if (priceData.feedInPrice !== null && priceData.feedInPrice !== undefined) {
                            feedInPrices.push(priceData.feedInPrice);
                        }
                    }
                }
                
                // Return average prices across all windows, or null if no data found
                const avgBuyPrice = buyPrices.length > 0 ? buyPrices.reduce((a, b) => a + b) / buyPrices.length : null;
                const avgFeedinPrice = feedInPrices.length > 0 ? feedInPrices.reduce((a, b) => a + b) / feedInPrices.length : null;
                
                return { 
                    buyPrice: avgBuyPrice, 
                    feedInPrice: avgFeedinPrice 
                };
            }
            
            for (const event of events) {
                totalRules++;

                const classification = resolveRoiEventClassification(event);
                const isChargeRule = classification.isChargeRule === true;
                const isDischargeRule = classification.isDischargeRule === true;
                const isGridTransferRule = isChargeRule || isDischargeRule;
                const ruleType = classification.ruleType || 'Unknown';
                let buyPrice = null;
                let feedInPrice = null;

                if (isChargeRule) {
                    totalChargeRules++;
                } else if (isDischargeRule) {
                    totalDischargeRules++;
                }

                if (event.roiSnapshot && isGridTransferRule) {
                    buyPrice = (event.roiSnapshot.buyPrice !== null && event.roiSnapshot.buyPrice !== undefined)
                        ? event.roiSnapshot.buyPrice
                        : null;
                    feedInPrice = (event.roiSnapshot.feedInPrice !== null && event.roiSnapshot.feedInPrice !== undefined)
                        ? event.roiSnapshot.feedInPrice
                        : null;

                    const actualPrices = getActualPrice(event);
                    if (actualPrices.buyPrice !== null) buyPrice = actualPrices.buyPrice;
                    if (actualPrices.feedInPrice !== null) feedInPrice = actualPrices.feedInPrice;
                }

                if (isGridTransferRule) {
                    const extractedPrices = extractPriceFromRule(event.startAllRules);
                    if (buyPrice === null && extractedPrices.buyPrice !== null) buyPrice = extractedPrices.buyPrice;
                    if (feedInPrice === null && extractedPrices.feedInPrice !== null) feedInPrice = extractedPrices.feedInPrice;
                    if (buyPrice === null && isChargeRule && extractedPrices.anyPrice !== null) buyPrice = extractedPrices.anyPrice;
                    if (buyPrice === null && isDischargeRule && classification.isExportMode !== true && extractedPrices.anyPrice !== null) buyPrice = extractedPrices.anyPrice;
                    if (feedInPrice === null && classification.isExportMode === true && extractedPrices.anyPrice !== null) feedInPrice = extractedPrices.anyPrice;
                }

                const impact = impactHelpers.calculateEventImpact({
                    buyPrice,
                    classification,
                    event,
                    feedInPrice
                });

                if (impact.rulePowerKw !== null && impact.rulePowerKw !== undefined) {
                    if (isChargeRule) {
                        totalChargePower += impact.rulePowerKw;
                    } else if (isDischargeRule) {
                        totalDischargePower += impact.rulePowerKw;
                    }
                }
                if (impact.chargeImpactAud !== null) totalChargeImpactAud += impact.chargeImpactAud;
                if (impact.importAvoidanceAud !== null) totalImportAvoidanceAud += impact.importAvoidanceAud;
                if (impact.exportCaptureAud !== null) totalExportCaptureAud += impact.exportCaptureAud;
                if (impact.impactAud !== null && !isNaN(impact.impactAud)) {
                    numRulesWithImpact++;
                    totalNetImpactAud += impact.impactAud;
                }
                
                eventImpacts.push({
                    eventId: event.ruleId,
                    priceBasis: impactHelpers.formatPriceBasis(impact),
                    impactAud: impact.impactAud,
                    chargeImpactAud: impact.chargeImpactAud,
                    importAvoidanceAud: impact.importAvoidanceAud,
                    exportCaptureAud: impact.exportCaptureAud,
                    isChargeRule: impact.isChargeRule,
                    isDischargeRule: impact.isDischargeRule,
                    isExportMode: impact.isExportMode,
                    ruleType,
                    rulePowerKw: impact.rulePowerKw,
                    houseLoadKw: impact.houseLoadKw
                });
            }
            
            // Calculate average metrics
            const daysDiff = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1;
            const avgRulesPerDay = (totalRules / daysDiff).toFixed(1);
            const avgChargePower = totalChargeRules > 0 ? (totalChargePower / totalChargeRules).toFixed(2) : '—';
            const avgDischargePower = totalDischargeRules > 0 ? (totalDischargePower / totalDischargeRules).toFixed(2) : '—';
            const avgImpactPerRule = numRulesWithImpact > 0 ? (totalNetImpactAud / numRulesWithImpact).toFixed(2) : '—';
            
            // Determine impact color
            const impactColor = totalNetImpactAud >= 0 ? 'var(--color-success-bg)' : 'var(--color-danger-bg)';
            const impactBorderColor = totalNetImpactAud >= 0 ? 'color-mix(in srgb,var(--color-success-dark) 30%,transparent)' : 'color-mix(in srgb,var(--color-danger) 30%,transparent)';
            const impactTextColor = totalNetImpactAud >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
            const impactIcon = totalNetImpactAud >= 0 ? '💰' : '📉';
            
            // Build HTML with summary cards and detailed table
            let html = `
                <div class="roi-grid">
                    <div class="roi-card">
                        <div class="roi-card-title">
                            <span>🎯</span>
                            Total Rules Triggered
                        </div>
                        <div class="roi-card-content">
                            <div class="roi-card-main">
                                <div class="roi-value">${totalRules}</div>
                                <div class="roi-value-label">during this period</div>
                            </div>
                            <div class="roi-card-secondary">
                                <div class="roi-secondary-value">${avgRulesPerDay}</div>
                                <div class="roi-secondary-label">avg per day</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="roi-card">
                        <div class="roi-card-title">
                            <span>⚡</span>
                            Charge Operations
                        </div>
                        <div class="roi-card-content">
                            <div class="roi-card-main">
                                <div class="roi-value">${totalChargeRules}</div>
                                <div class="roi-value-label">smart charging events</div>
                            </div>
                            <div class="roi-card-secondary">
                                <div class="roi-secondary-value">${avgChargePower}</div>
                                <div class="roi-secondary-label">avg power (kW)</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="roi-card">
                        <div class="roi-card-title">
                            <span>📤</span>
                            Discharge Operations
                        </div>
                        <div class="roi-card-content">
                            <div class="roi-card-main">
                                <div class="roi-value">${totalDischargeRules}</div>
                                <div class="roi-value-label">battery discharge events</div>
                            </div>
                            <div class="roi-card-secondary">
                                <div class="roi-secondary-value">${avgDischargePower}</div>
                                <div class="roi-secondary-label">avg requested power (kW)</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="roi-card" style="background: ${impactColor}; border-color: ${impactBorderColor};">
                        <div class="roi-card-title">
                            <span>${impactIcon}</span>
                            Net Triggered Value
                        </div>
                        <div class="roi-card-content">
                            <div class="roi-card-main">
                                <div class="roi-value" style="color: ${impactTextColor};">$${Math.abs(totalNetImpactAud).toFixed(2)}</div>
                                <div class="roi-value-label">${totalNetImpactAud >= 0 ? 'estimated gross value' : 'estimated net cost'}</div>
                            </div>
                            <div class="roi-card-secondary">
                                <div class="roi-secondary-value" style="color: ${impactTextColor};">${avgImpactPerRule !== '—' ? '$' + avgImpactPerRule : '—'}</div>
                                <div class="roi-secondary-label">avg per priced rule</div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="roi-info-band roi-info-band--model">
                    <span class="roi-info-band__icon" aria-hidden="true">💡</span>
                    <div>
                        <strong>Triggered-rule value:</strong> Import avoidance ${escHtml(formatSignedAud(totalImportAvoidanceAud))} • Export capture ${escHtml(formatSignedAud(totalExportCaptureAud))} • Charge cost / gain ${escHtml(formatSignedAud(totalChargeImpactAud))}
                        <span
                            class="inline-tip"
                            tabindex="0"
                            role="img"
                            aria-label="ROI impact model details"
                            title="Gross triggered-rule value, not passive self-use delta. Charge uses requested charge power only. Discharge values energy sent to the home at buy price and any exported energy at feed-in price. Accuracy for ${escHtml(providerCapabilities.label || 'this provider')}: ${escHtml(providerCapabilities.roiAccuracyLabel || 'Provisional')}."
                        >i</span>
                        <span class="roi-inline-note">Model: gross triggered-rule value, not passive self-use delta. Charge uses requested charge power only for charge. Accuracy for ${escHtml(providerCapabilities.label || 'this provider')}: ${escHtml(providerCapabilities.roiAccuracyLabel || 'Provisional')}.</span>
                    </div>
                </div>

                <div class="roi-summary-table-shell">
                    <table class="roi-summary-table" id="roiTable">
                        <thead>
                            <tr>
                                <th data-column="ruleName">Rule</th>
                                <th data-column="ruleType">Type</th>
                                <th data-column="rulePowerKw">Req. kW</th>
                                <th data-column="houseLoadKw">House kW</th>
                                <th data-column="startTime">Triggered</th>
                                <th data-column="duration">Duration</th>
                                <th data-column="price">Price</th>
                                <th data-column="profit">Impact</th>
                                <th data-column="status">Status</th>
                            </tr>
                        </thead>
                        <tbody>
            `;            
            let priceIndex = 0;
            for (const event of events) {
                const startDate = new Date(event.startTime);
                const duration = formatDuration(event.durationMs);
                const priceInfo = eventImpacts[priceIndex] || {};
                
                const priceDisplay = escHtml(priceInfo.priceBasis || '—');
                
                let profitLabel = '—';
                if (priceInfo.impactAud !== null && priceInfo.impactAud !== undefined && !isNaN(priceInfo.impactAud)) {
                    const absProfit = Math.abs(priceInfo.impactAud);
                    if (absProfit < 0.01 && absProfit > 0) {
                        const sign = priceInfo.impactAud < 0 ? '-' : '';
                        profitLabel = `${sign}${(absProfit * 100).toFixed(2)}¢`;
                    } else {
                        const sign = priceInfo.impactAud < 0 ? '-' : '';
                        profitLabel = `${sign}$${absProfit.toFixed(2)}`;
                    }
                }
                    
                let profitColor = 'var(--text-secondary)';
                if (priceInfo.impactAud !== null && priceInfo.impactAud !== undefined && !isNaN(priceInfo.impactAud)) {
                    profitColor = priceInfo.impactAud >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
                }
                
                const ruleTypeDisplay = escHtml(priceInfo.ruleType || '—');
                const powerDisplay = (priceInfo.rulePowerKw !== null && priceInfo.rulePowerKw !== undefined && !isNaN(priceInfo.rulePowerKw)) 
                    ? `${priceInfo.rulePowerKw.toFixed(2)} kW` 
                    : '—';
                const houseLoadDisplay = (priceInfo.houseLoadKw !== null && priceInfo.houseLoadKw !== undefined && !isNaN(priceInfo.houseLoadKw)) 
                    ? `${priceInfo.houseLoadKw.toFixed(2)} kW` 
                    : '—';
                const startDateLabel = escHtml(startDate.toLocaleString('en-AU', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }));
                    
                const statusDisplay = (event.type === 'ongoing') 
                    ? (isAutomationEnabled ? '🟢 Running' : '⏸ Pending') 
                    : '✓ Done';
                    
                html += `
                    <tr>
                        <td class="rule-name">${escHtml(event.ruleName || 'Unknown Rule')}</td>
                        <td>${ruleTypeDisplay}</td>
                        <td>${powerDisplay}</td>
                        <td>${houseLoadDisplay}</td>
                        <td>${startDateLabel}</td>
                        <td>${duration}</td>
                        <td>${priceDisplay}</td>
                        <td style="color: ${profitColor}; font-weight: 600;">${escHtml(profitLabel)}</td>
                        <td>${statusDisplay}</td>
                    </tr>
                `;
                
                priceIndex++;
            }
            
            html += `
                        </tbody>
                    </table>
                </div>
            `;
            
            content.innerHTML = html;
            
            // Add sorting functionality
            const table = document.getElementById('roiTable');
            if (table) {
                const headers = table.querySelectorAll('th[data-column]');
                let sortState = {}; // Track sort direction per column
                
                headers.forEach(header => {
                    header.addEventListener('click', () => {
                        const columnName = header.getAttribute('data-column');
                        const tbody = table.querySelector('tbody');
                        const rows = Array.from(tbody.querySelectorAll('tr'));
                        
                        // Determine sort direction
                        const isAsc = sortState[columnName] !== 'asc';
                        sortState = {}; // Reset all other columns
                        sortState[columnName] = isAsc ? 'asc' : 'desc';
                        
                        // Update header indicators
                        headers.forEach(h => {
                            h.classList.remove('sort-asc', 'sort-desc');
                        });
                        header.classList.add(isAsc ? 'sort-asc' : 'sort-desc');
                        
                        // Sort rows
                        rows.sort((rowA, rowB) => {
                            let valA, valB;
                            
                            // Extract values based on column
                            const getCellValue = (row, col) => {
                                const cell = row.querySelector(`td:nth-child(${headers.length - Array.from(headers).indexOf(headers[Array.from(headers).findIndex(h => h.getAttribute('data-column') === col)]) + 1})`);
                                return cell ? cell.textContent.trim() : '';
                            };
                            
                            // Map columns to their positions for direct access
                            const colIndex = Array.from(headers).findIndex(h => h.getAttribute('data-column') === columnName);
                            const getRowValue = (row) => {
                                const cells = row.querySelectorAll('td');
                                if (colIndex >= 0 && colIndex < cells.length) {
                                    return cells[colIndex].textContent.trim();
                                }
                                return '';
                            };
                            
                            valA = getRowValue(rowA);
                            valB = getRowValue(rowB);
                            
                            // Parse numeric values for sorting
                            const numA = parseFloat(valA.replace(/[^0-9.-]/g, ''));
                            const numB = parseFloat(valB.replace(/[^0-9.-]/g, ''));
                            
                            if (!isNaN(numA) && !isNaN(numB)) {
                                // Numeric sort
                                return isAsc ? numA - numB : numB - numA;
                            } else {
                                // String sort
                                return isAsc 
                                    ? valA.localeCompare(valB) 
                                    : valB.localeCompare(valA);
                            }
                        });
                        
                        // Re-append sorted rows
                        rows.forEach(row => tbody.appendChild(row));
                    });
                });
            }
            } catch (renderError) {
                console.error('[ROI] Error rendering ROI results:', renderError);
                content.innerHTML = `
                    <div class="empty-state">
                        <div class="icon">❌</div>
                        <p>Error rendering ROI results</p>
                        <p style="font-size:12px;margin-top:8px">${escHtml(renderError.message)}</p>
                    </div>
                `;
            }
        }

        /**
         * Fetch automation history
         */
        async function fetchAutomationHistory() {            const btn = document.getElementById('btnRefreshAutomationHistory');
            const status = document.getElementById('automationHistoryStatus');
            const content = document.getElementById('automationHistoryContent');

            if (btn) {
                btn.disabled = true;
                btn.innerHTML = 'Loading...';
            }
            
            showStatus(status, 'loading', 'Fetching automation rule history...');
            
            try {                const resp = await authenticatedFetch('/api/automation/audit?days=7');
                
                if (!resp.ok) {
                    throw new Error(`API error: ${resp.status} ${resp.statusText}`);
                }
                
                const data = await resp.json();                
                if (data.errno && data.errno !== 0) {
                    throw new Error(data.error || 'API error');
                }
                
                const events = data.result?.ruleEvents || [];                
                if (events.length === 0) {
                    content.innerHTML = `
                        <div class="timeline-empty">
                            <div class="icon">📭</div>
                            <p>No recent automation activity.</p>
                            <p style="font-size:12px;margin-top:8px">Triggered rules will show here.</p>
                        </div>
                    `;
                } else {
                    renderAutomationTimeline(events);
                }
                
                showStatus(status, 'success', `✓ Found ${events.length} rule event${events.length !== 1 ? 's' : ''} in the last 7 days`);
                setTimeout(() => { dismissStatus(status); }, 3000);
            } catch (e) {
                console.error('[ROI] Error fetching automation history:', e);
                showStatus(status, 'error', `✗ Error: ${e.message}`);
                content.innerHTML = `
                    <div class="timeline-empty">
                        <div class="icon">❌</div>
                        <p>Failed to load automation history</p>
                        <p style="font-size:12px;margin-top:8px">${escHtml(e.message)}</p>
                    </div>
                `;
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = 'Refresh';
                }
            }
        }

        /**
         * Render automation timeline
         */
        function renderAutomationTimeline(events) {            const content = document.getElementById('automationHistoryContent');
            
            if (!content) {
                console.error('[ROI] automationHistoryContent element not found!');
                return;
            }

            function buildConditionDetails(conditions) {
                if (!Array.isArray(conditions) || conditions.length === 0) return '';
                return conditions.map((condition) => {
                    const conditionIcon = condition && condition.met ? '✓' : '✗';
                    const conditionName = escHtml(condition?.name || condition?.rule || 'Condition');
                    const conditionValue = escHtml(condition?.value ?? '—');
                    return `${conditionIcon} ${conditionName}: ${conditionValue}`;
                }).join(' • ');
            }
            
            let html = '<div class="automation-timeline">';
            
            for (const event of events) {
                const isOngoing = event.type === 'ongoing';
                const eventTypeClass = isOngoing ? 'ongoing' : 'complete';
                const duration = formatDuration(event.durationMs);
                const startDate = new Date(event.startTime);
                const endDate = event.endTime ? new Date(event.endTime) : null;
                const ruleName = escHtml(event.ruleName || 'Unknown Rule');
                const startedAt = escHtml(startDate.toLocaleString('en-AU', { month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }));
                const endedAt = endDate
                    ? escHtml(endDate.toLocaleString('en-AU', { month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }))
                    : '';
                
                html += `
                    <div class="timeline-event ${eventTypeClass}">
                        <div class="event-header">
                            <div class="event-title">
                                <span>${ruleName}</span>
                                <span class="event-badge ${eventTypeClass}">${isOngoing ? '🟢 Active' : '✓ Complete'}</span>
                            </div>
                            <div class="event-duration">${duration}</div>
                        </div>
                        
                        <div class="event-times">
                            <span class="event-time-label">Started:</span>
                            <span class="event-time-value">${startedAt}</span>
                            ${!isOngoing ? `
                                <span class="event-time-label">Ended:</span>
                                <span class="event-time-value">${endedAt}</span>
                            ` : ''}
                        </div>
                `;
                
                // Show comprehensive rule evaluation report
                const allRules = event.startAllRules || [];
                if (allRules && allRules.length > 0) {
                    html += `
                        <div class="event-conditions">
                            <div class="event-conditions-title">Rule Evaluation Report (${allRules.filter(r => r.triggered).length}/${allRules.length} rules triggered):</div>
                            <div class="condition-list">
                    `;
                    
                    for (const ruleEval of allRules) {
                        const isTriggered = ruleEval.triggered;
                        const icon = isTriggered ? '✓' : '✗';
                        const metClass = isTriggered ? 'met' : 'not-met';
                        const conditionDetails = buildConditionDetails(ruleEval.conditions);
                        
                        html += `
                            <div class="condition-chip ${metClass}" style="display: block; margin-bottom: 4px;">
                                <span style="font-weight: 600;">${icon} ${escHtml(ruleEval.name || ruleEval.ruleId || 'Rule')}</span>
                                ${conditionDetails ? `<span style="margin-left: 8px; opacity: 0.9;">| ${conditionDetails}</span>` : ''}
                            </div>
                        `;
                    }
                    
                    html += `
                            </div>
                        </div>
                    `;
                }
                
                // Show end conditions for completed events
                if (!isOngoing && event.endAllRules && event.endAllRules.length > 0) {
                    html += `
                        <div class="event-conditions">
                            <div class="event-conditions-title">Rule Evaluation at End (${event.endAllRules.filter(r => r.triggered).length}/${event.endAllRules.length} rules triggered):</div>
                            <div class="condition-list">
                    `;
                    
                    for (const ruleEval of event.endAllRules) {
                        const isTriggered = ruleEval.triggered;
                        const icon = isTriggered ? '✓' : '✗';
                        const metClass = isTriggered ? 'met' : 'not-met';
                        const conditionDetails = buildConditionDetails(ruleEval.conditions);
                        
                        html += `
                            <div class="condition-chip ${metClass}" style="display: block; margin-bottom: 4px;">
                                <span style="font-weight: 600;">${icon} ${escHtml(ruleEval.name || ruleEval.ruleId || 'Rule')}</span>
                                ${conditionDetails ? `<span style="margin-left: 8px; opacity: 0.9;">| ${conditionDetails}</span>` : ''}
                            </div>
                        `;
                    }
                    
                    html += `
                            </div>
                        </div>
                    `;
                }
                
                html += `
                    </div>
                `;
            }
            
            html += '</div>';            content.innerHTML = html;        }

        /**
         * Load device SN from Firestore
         */
        async function loadDeviceSn() {
            try {
                const resp = await authenticatedFetch('/api/config');
                const data = await resp.json();
                if (data.errno === 0 && data.result?.deviceProvider) {
                    deviceProvider = normalizeRoiProvider(data.result.deviceProvider);
                    providerCapabilities = resolveRoiProviderCapabilities(deviceProvider);
                }
                if (data.errno === 0 && data.result?.deviceSn) {
                    deviceSn = data.result.deviceSn;
                }
                renderRoiProviderNotice();
            } catch (e) {
                console.warn('Failed to load device SN:', e);
            }
        }

        /**
         * Load API call metrics
         */
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
                const pricingCount = (typeof getPricingApiCount === 'function')
                    ? getPricingApiCount(today)
                    : (toCounter(today.pricing) || (toCounter(today.amber) + toCounter(today.aemo)));
                const evCount = (typeof getEvApiCount === 'function')
                    ? getEvApiCount(today)
                    : fallbackEvCounter(today);
                document.getElementById('countFox').textContent = inverterCount;
                document.getElementById('countAmber').textContent = pricingCount;
                document.getElementById('countWeather').textContent = toCounter(today.weather);
                const evEl = document.getElementById('countEV');
                if (evEl) evEl.textContent = evCount;
            } catch (e) {
                console.warn('Failed to load api metrics', e.message);
            }
        }

        /**
         * Format date helper
         */
        function formatDate(date, includeTime = true) {
            const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            if (includeTime) {
                const timeStr = date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });
                return `${dateStr} ${timeStr}`;
            }
            return dateStr;
        }

        // Initialize on page load
        document.addEventListener('DOMContentLoaded', () => {
            initDatePickers();
        });

        // Initialize Firebase & AppShell
        AppShell.init({
            pageName: 'roi',
            autoMetrics: true,
            onReady: () => {
                try { TourEngine.init(window.apiClient); TourEngine.resume(); } catch(e) {}
                // User is authorized, load page content
                try {
                    loadDeviceSn();
                } catch (error) {
                    console.error('Failed to load device SN', error);
                }
                try {
                    fetchAutomationHistory();
                } catch (error) {
                    console.error('Failed to load automation history', error);
                }
            }
        });
    
