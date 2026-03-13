
        // Global state
        let roiData = null;
        let automationHistoryData = null;
        let deviceSn = null;

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
                status.className = 'status warning';
                status.textContent = '⚠ Maximum 7 days allowed. Start date will be auto-adjusted to match this range.';
                // Auto-adjust start date to be 7 days before end date
                const adjustedStart = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
                startDateInput.valueAsDate = adjustedStart;
            } else {
                status.className = '';
                status.textContent = '';
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
            return { isChargeRule: false, isFeedinRule: false, ruleType: 'Unknown' };
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
                status.className = 'status error';
                status.textContent = '✗ Please select both start and end dates';
                return;
            }
            
            if (new Date(startDate) > new Date(endDate)) {
                status.className = 'status error';
                status.textContent = '✗ Start date must be before end date';
                return;
            }
            
            btn.disabled = true;
            btn.innerHTML = '⏳ Calculating...';
            status.className = 'status loading';
            status.textContent = 'Calculating ROI...';
            
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
                            <p>No automation rule activity in this date range</p>
                        </div>
                    `;
                    status.className = 'status success';
                    status.textContent = 'No rules triggered during this period';
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
                
                status.className = 'status success';
                status.textContent = `✓ Analyzed ${events.length} rule trigger(s)`;
                setTimeout(() => { status.style.display = 'none'; }, 3000);
            } catch (e) {
                status.className = 'status error';
                status.textContent = `✗ Error: ${e.message}`;
                content.innerHTML = `
                    <div class="empty-state">
                        <div class="icon">❌</div>
                        <p>Failed to calculate ROI</p>
                        <p style="font-size:12px;margin-top:8px">${e.message}</p>
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
            
            // Helper function to extract price from rule data (prefer explicit fields, fallback to parsing)
            function extractPriceFromRule(ruleEvals) {
                if (!ruleEvals || ruleEvals.length === 0) {                    return null;
                }                
                // First try to get price from explicit feedInPrice/buyPrice fields (NEW)
                for (const ruleEval of ruleEvals) {                    if (ruleEval.triggered) {
                        if (ruleEval.feedInPrice !== null && ruleEval.feedInPrice !== undefined) {                            return ruleEval.feedInPrice;
                        }
                        if (ruleEval.buyPrice !== null && ruleEval.buyPrice !== undefined) {                            return ruleEval.buyPrice;
                        }
                    }
                }                
                // Fallback: Parse from condition data (for older events without explicit fields)
                for (const ruleEval of ruleEvals) {
                    if (ruleEval.triggered && ruleEval.conditions && ruleEval.conditions.length > 0) {
                        for (const condition of ruleEval.conditions) {
                            // Skip non-price conditions (Battery SoC, Ambient/Battery Temp)
                            const condName = condition.name || '';
                            if (condName.includes('SoC') || condName.includes('Temperature') || condName.includes('Temp') || condName.includes('Battery')) {
                                continue;
                            }
                            
                            // Check if this is a price condition by name match
                            if ((condName.includes('Price') || condName.includes('Feed') || condName === 'price') && condition.value !== undefined && condition.value !== null) {
                                const parsed = parseFloat(condition.value);
                                if (!isNaN(parsed) && parsed >= 0 && parsed < 10000) {
                                    // Valid price range (0-10000 cents/kWh, or 0-100 AUD/kWh)
                                    return parsed;
                                }
                            }
                        }
                    }
                }
                return null;
            }
            
            // Calculate summary stats
            let totalRules = 0;
            let totalChargeRules = 0;
            let totalDischargeRules = 0;
            let totalFeedinRules = 0;
            let totalProfit = 0; // Total profit from all rules
            let estimatedSavings = 0; // charge operations that avoided high prices
            let estimatedEarnings = 0; // feed-in operations during peak prices
            
            // Tracking for new metrics
            let totalChargePower = 0; // Total power in kW for charge operations
            let totalDischargePower = 0; // Total power in kW for discharge operations
            let numRulesWithProfit = 0; // Count of rules with valid profit calculations
            
            // Store prices and power for each event for later use in table
            const eventPrices = [];
            
            // Fetch ALL actual prices for the ACTUAL event date range (not just user-selected range)
            const actualPriceMap = new Map(); // key: ISO timestamp, value: {buyPrice, feedInPrice}
            
            try {
                const sitesResp = await apiClient.getAmberSites();
                if (sitesResp && sitesResp.errno === 0 && sitesResp.result && sitesResp.result.length > 0) {
                    const storedSiteId = (window.sharedUtils && window.sharedUtils.getStoredAmberSiteId) ? window.sharedUtils.getStoredAmberSiteId() : '';
                    const siteId = (storedSiteId && sitesResp.result.some(s => String(s.id) === storedSiteId))
                        ? storedSiteId
                        : sitesResp.result[0].id;
                    
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
                    const pricesResp = await apiClient.getAmberHistoricalPrices(siteId, fetchStartDate, fetchEndDate, 5, false);                    
                    if (pricesResp && pricesResp.errno === 0 && pricesResp.result) {                        
                        const nowMs = Date.now();
                        // Build map of prices indexed by EPOCH MILLISECONDS (avoids timezone issues)
                        for (const pricePoint of pricesResp.result) {
                            const startMs = new Date(pricePoint.startTime || pricePoint.nemTime).getTime();
                            // Use only settled (actual) prices: ignore forecasts and future timestamps
                            if (pricePoint.type === 'ForecastInterval' || startMs > nowMs) {
                                continue;
                            }
                            // Amber API adds +1 second to timestamps (14:00:01 instead of 14:00:00)
                            // Subtract 1 second so it aligns with our 5-minute interval rounding
                            const priceEpochMs = startMs - 1000;
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
                
                // Calculate rule duration in hours (assuming it's stored in milliseconds)
                const durationHours = (event.durationMs || 0) / (1000 * 60 * 60);
                
                // Determine rule type from explicit workMode when available.
                const classification = resolveRoiEventClassification(event);
                let isChargeRule = classification.isChargeRule === true;
                let isFeedinRule = classification.isFeedinRule === true;
                let ruleType = classification.ruleType || 'Unknown';
                const isGridTransferRule = isChargeRule || isFeedinRule;
                let actualPrice = null;
                let rulePowerKw = null; // Use actual rule power from fdPwr if available

                if (isChargeRule) {
                    totalChargeRules++;
                } else if (isFeedinRule) {
                    totalFeedinRules++;
                }

                // Look up settled prices only for charge/discharge events.
                if (event.roiSnapshot && isGridTransferRule) {
                    if (isChargeRule) {
                        actualPrice = (event.roiSnapshot.buyPrice !== null && event.roiSnapshot.buyPrice !== undefined)
                            ? event.roiSnapshot.buyPrice
                            : null;
                    } else if (isFeedinRule) {
                        actualPrice = (event.roiSnapshot.feedInPrice !== null && event.roiSnapshot.feedInPrice !== undefined)
                            ? event.roiSnapshot.feedInPrice
                            : null;
                    }

                    const actualPrices = getActualPrice(event);
                    if (isChargeRule && actualPrices.buyPrice !== null) {
                        actualPrice = actualPrices.buyPrice;
                    } else if (isFeedinRule && actualPrices.feedInPrice !== null) {
                        actualPrice = actualPrices.feedInPrice;
                    }
                }
                
                // If no explicit prices from backend, fall back to condition parsing
                if ((actualPrice === null || actualPrice === undefined) && isGridTransferRule) {
                    actualPrice = extractPriceFromRule(event.startAllRules);
                }
                
                // ⭐ Get ROI snapshot data (house load, prices, power) and ALWAYS recalculate profit
                // using ACTUAL duration from event.durationMs, not the backend's estimated revenue
                // (which was calculated using rule's configured duration, not actual runtime)
                let houseLoadKw = null;
                let gridExportKw = null;
                let eventProfit = 0;                
                if (event.roiSnapshot) {
                    // Extract house load from snapshot (captured at trigger time)
                    // Safely convert watts to kW, treating null/undefined as null (not 0)
                    houseLoadKw = (event.roiSnapshot.houseLoadW !== null && event.roiSnapshot.houseLoadW !== undefined) 
                        ? event.roiSnapshot.houseLoadW / 1000 
                        : null;
                    gridExportKw = (event.roiSnapshot.estimatedGridExportW !== null && event.roiSnapshot.estimatedGridExportW !== undefined) 
                        ? event.roiSnapshot.estimatedGridExportW / 1000 
                        : null;
                    
                    // Extract prices from roiSnapshot if not already set.
                    if ((actualPrice === null || actualPrice === undefined) && isGridTransferRule) {
                        if (isChargeRule && event.roiSnapshot.buyPrice !== null && event.roiSnapshot.buyPrice !== undefined) {
                            actualPrice = event.roiSnapshot.buyPrice;
                        } else if (isFeedinRule && event.roiSnapshot.feedInPrice !== null && event.roiSnapshot.feedInPrice !== undefined) {
                            actualPrice = event.roiSnapshot.feedInPrice;
                        }
                    }
                    
                    // Get power from action (in Watts, convert to kW)
                    if (event.action && event.action.fdPwr && isGridTransferRule) {
                        rulePowerKw = event.action.fdPwr / 1000;
                    }
                    
                    // ⭐ CRITICAL FIX: ALWAYS recalculate profit using ACTUAL duration (event.durationMs)
                    // The backend's estimatedRevenue was calculated at trigger time using the RULE's
                    // configured duration (e.g. 30 min), NOT the actual runtime (e.g. 2 min 6 sec).
                    // This caused massively inflated profits (e.g. $127 instead of $0.01).
                    if ((actualPrice !== null && actualPrice !== undefined) && rulePowerKw !== null && isGridTransferRule) {
                        // Price conversion: Amber API prices are ALWAYS in cents/kWh
                        // Convert to dollars by dividing by 100
                        const priceAudPerKwh = actualPrice / 100;
                        
                        if (isChargeRule) {
                            // CHARGE: revenue = -(power * price)
                            // - Positive price: negative result (cost)
                            // - Negative price: positive result (profit - you get paid to consume!)
                            const gridDrawKw = houseLoadKw !== null ? (rulePowerKw + houseLoadKw) : rulePowerKw;
                            eventProfit = -(gridDrawKw * durationHours * priceAudPerKwh);
                        } else if (isFeedinRule) {
                            // DISCHARGE: Revenue = (discharge - house load) * price * duration
                            // - Positive price: positive result (revenue)
                            // - Negative price: negative result (cost - rare, pay to export)
                            const exportKw = houseLoadKw !== null ? Math.max(0, rulePowerKw - houseLoadKw) : rulePowerKw;
                            eventProfit = exportKw * durationHours * priceAudPerKwh;
                        }
                    } else {
                    }
                    
                // Calculation complete
                } else {
                    // Fallback to old method if roiSnapshot not available
                    if (event.action && event.action.fdPwr && isGridTransferRule) {
                        rulePowerKw = event.action.fdPwr / 1000;
                    } else {
                        rulePowerKw = null;
                    }
                    
                    if ((actualPrice !== null && actualPrice !== undefined) && rulePowerKw !== null && isGridTransferRule) {
                        // Price conversion: Amber API prices are ALWAYS in cents/kWh
                        // Convert to dollars by dividing by 100
                        const priceAudPerKwh = actualPrice / 100;
                        
                        if (isChargeRule) {
                            // CHARGE: revenue = -(power * price) (no house load data)
                            const energyConsumed = rulePowerKw * durationHours;
                            eventProfit = -(energyConsumed * priceAudPerKwh);
                        } else if (isFeedinRule) {
                            // DISCHARGE: Revenue = power * price * duration (no house load data)
                            const energyGenerated = rulePowerKw * durationHours;
                            eventProfit = energyGenerated * priceAudPerKwh;
                        }
                    } else {                    }
                }
                
                // Track power and profit metrics
                if (rulePowerKw !== null && rulePowerKw !== undefined) {
                    if (isChargeRule) {
                        totalChargePower += rulePowerKw;
                    } else if (isFeedinRule) {
                        totalDischargePower += rulePowerKw;
                    }
                }
                if (eventProfit !== null && eventProfit !== undefined && !isNaN(eventProfit)) {
                    numRulesWithProfit++;
                }
                
                eventPrices.push({
                    eventId: event.ruleId,
                    price: actualPrice,
                    profit: eventProfit,
                    isChargeRule,
                    isFeedinRule,
                    ruleType,
                    rulePowerKw,
                    houseLoadKw      // ⭐ NEW: house load from roiSnapshot
                });
                
                // IMPORTANT: Don't blindly flip charge profit signs!
                // - Positive buy price: Charge costs money = NEGATIVE profit (correct)
                // - Negative buy price: You get PAID to charge = POSITIVE profit (correct!)
                // The profit sign should match the economic reality, not just the rule type.
                
                totalProfit += eventProfit;
            }
            
            // Calculate average metrics
            const daysDiff = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1;
            const avgRulesPerDay = (totalRules / daysDiff).toFixed(1);
            const avgChargePower = totalChargeRules > 0 ? (totalChargePower / totalChargeRules).toFixed(2) : '—';
            const avgDischargePower = totalFeedinRules > 0 ? (totalDischargePower / totalFeedinRules).toFixed(2) : '—';
            const avgProfitPerRule = numRulesWithProfit > 0 ? (totalProfit / numRulesWithProfit).toFixed(2) : '—';
            
            // Determine profit color
            const profitColor = totalProfit >= 0 ? 'var(--color-success-bg)' : 'var(--color-danger-bg)';
            const profitBorderColor = totalProfit >= 0 ? 'color-mix(in srgb,var(--color-success-dark) 30%,transparent)' : 'color-mix(in srgb,var(--color-danger) 30%,transparent)';
            const profitTextColor = totalProfit >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
            const profitIcon = totalProfit >= 0 ? '💰' : '📉';
            
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
                            Feed-in Operations
                        </div>
                        <div class="roi-card-content">
                            <div class="roi-card-main">
                                <div class="roi-value">${totalFeedinRules}</div>
                                <div class="roi-value-label">export events</div>
                            </div>
                            <div class="roi-card-secondary">
                                <div class="roi-secondary-value">${avgDischargePower}</div>
                                <div class="roi-secondary-label">avg power (kW)</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="roi-card" style="background: ${profitColor}; border-color: ${profitBorderColor};">
                        <div class="roi-card-title">
                            <span>${profitIcon}</span>
                            Total Profit
                        </div>
                        <div class="roi-card-content">
                            <div class="roi-card-main">
                                <div class="roi-value" style="color: ${profitTextColor};">$${Math.abs(totalProfit).toFixed(2)}</div>
                                <div class="roi-value-label">${totalProfit >= 0 ? 'estimated savings' : 'estimated cost'}</div>
                            </div>
                            <div class="roi-card-secondary">
                                <div class="roi-secondary-value" style="color: ${profitTextColor};">${avgProfitPerRule !== '—' ? '$' + avgProfitPerRule : '—'}</div>
                                <div class="roi-secondary-label">per rule</div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="info-banner" style="background: rgba(126,231,135,0.08); border-color: rgba(126,231,135,0.2);">
                    <span class="icon">💡</span>
                    <div class="text">
                        <strong>Profit Calculation:</strong> Uses actual feed-in/buy-in prices captured at rule trigger time, multiplied by rule power setting and rule duration. Prices in ¢/kWh.
                    </div>
                </div>
                
                <table class="roi-summary-table" id="roiTable">
                    <thead>
                        <tr>
                            <th data-column="ruleName">Rule</th>
                            <th data-column="ruleType">Rule Type</th>
                            <th data-column="rulePowerKw">Set Power (kW)</th>
                            <th data-column="houseLoadKw">House Load (kW)</th>
                            <th data-column="startTime">Triggered At</th>
                            <th data-column="duration">Duration</th>
                            <th data-column="price">Price (¢/kWh)</th>
                            <th data-column="profit">Est. Profit</th>
                            <th data-column="status">Status</th>
                        </tr>
                    </thead>
                    <tbody>
            `;            
            let priceIndex = 0;
            for (const event of events) {
                const startDate = new Date(event.startTime);
                const duration = formatDuration(event.durationMs);
                const priceInfo = eventPrices[priceIndex] || {};
                
                // Display values: treat null/undefined as '—', but show all numbers including 0
                let priceDisplay = '—';
                if (priceInfo.price !== null && priceInfo.price !== undefined && !isNaN(priceInfo.price)) {
                    priceDisplay = `${priceInfo.price.toFixed(2)}¢`;
                }
                
                // Show profit with appropriate precision - show cents for values < $0.01
                let profitLabel = '—';
                if (priceInfo.profit !== null && priceInfo.profit !== undefined && !isNaN(priceInfo.profit)) {
                    const absProfit = Math.abs(priceInfo.profit);
                    if (absProfit < 0.01 && absProfit > 0) {
                        // For very small values, show in cents with sign (e.g., "-0.60¢" or "0.23¢")
                        const sign = priceInfo.profit < 0 ? '-' : '';
                        profitLabel = `${sign}${(absProfit * 100).toFixed(2)}¢`;
                    } else {
                        // For larger values, show in dollars (e.g., "$1.23" or "-$0.12")
                        profitLabel = `$${priceInfo.profit.toFixed(2)}`;
                    }
                }
                    
                // Determine profit color based on ECONOMIC value, not rule type
                // - Positive profit (you earned money) = GREEN (even for charge with negative prices!)
                // - Negative profit (you spent money) = RED
                let profitColor = 'var(--text-secondary)'; // Default gray for missing data
                if (priceInfo.profit !== null && priceInfo.profit !== undefined && !isNaN(priceInfo.profit)) {
                    profitColor = priceInfo.profit >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
                }
                
                const ruleTypeDisplay = priceInfo.ruleType || '—';
                const powerDisplay = (priceInfo.rulePowerKw !== null && priceInfo.rulePowerKw !== undefined && !isNaN(priceInfo.rulePowerKw)) 
                    ? `${priceInfo.rulePowerKw.toFixed(2)}kW` 
                    : '—';
                const houseLoadDisplay = (priceInfo.houseLoadKw !== null && priceInfo.houseLoadKw !== undefined && !isNaN(priceInfo.houseLoadKw)) 
                    ? `${priceInfo.houseLoadKw.toFixed(2)}kW` 
                    : '—';
                    
                    // Show status based on event type and automation state
                    // Ongoing events show "Running" if automation is currently enabled
                    // Complete events show "Done" regardless
                    const statusDisplay = (event.type === 'ongoing') 
                        ? (isAutomationEnabled ? '🟢 Running' : '⏸ Pending') 
                        : '✓ Done';
                    
                    html += `
                        <tr>
                            <td class="rule-name">${event.ruleName || 'Unknown Rule'}</td>
                            <td>${ruleTypeDisplay}</td>
                            <td>${powerDisplay}</td>
                            <td>${houseLoadDisplay}</td>
                            <td>${startDate.toLocaleString('en-AU', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                            <td>${duration}</td>
                            <td>${priceDisplay}</td>
                            <td style="color: ${profitColor}; font-weight: 600;">${profitLabel}</td>
                            <td>${statusDisplay}</td>
                        </tr>
                    `;
                
                priceIndex++;
            }
            
            html += `
                    </tbody>
                </table>
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
                        <p style="font-size:12px;margin-top:8px">${renderError.message}</p>
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
                btn.innerHTML = '⏳ Loading...';
            }
            
            status.className = 'status loading';
            status.textContent = 'Fetching automation rule history...';
            
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
                            <p>No automation rule activity in the last 7 days</p>
                            <p style="font-size:12px;margin-top:8px">Rules will appear here when automation is enabled and rules trigger</p>
                        </div>
                    `;
                } else {
                    renderAutomationTimeline(events);
                }
                
                status.className = 'status success';
                status.textContent = `✓ Found ${events.length} rule event${events.length !== 1 ? 's' : ''} in the last 7 days`;
                setTimeout(() => { status.style.display = 'none'; }, 3000);
            } catch (e) {
                console.error('[ROI] Error fetching automation history:', e);
                status.className = 'status error';
                status.textContent = `✗ Error: ${e.message}`;
                content.innerHTML = `
                    <div class="timeline-empty">
                        <div class="icon">❌</div>
                        <p>Failed to load automation history</p>
                        <p style="font-size:12px;margin-top:8px">${e.message}</p>
                    </div>
                `;
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '🔄 Refresh';
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
            
            let html = '<div class="automation-timeline">';
            
            for (const event of events) {
                const isOngoing = event.type === 'ongoing';
                const duration = formatDuration(event.durationMs);
                const startDate = new Date(event.startTime);
                const endDate = event.endTime ? new Date(event.endTime) : null;
                
                html += `
                    <div class="timeline-event ${event.type}">
                        <div class="event-header">
                            <div class="event-title">
                                <span>${event.ruleName}</span>
                                <span class="event-badge ${event.type}">${isOngoing ? '🟢 Active' : '✓ Complete'}</span>
                            </div>
                            <div class="event-duration">${duration}</div>
                        </div>
                        
                        <div class="event-times">
                            <span class="event-time-label">Started:</span>
                            <span class="event-time-value">${startDate.toLocaleString('en-AU', { month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                            ${!isOngoing ? `
                                <span class="event-time-label">Ended:</span>
                                <span class="event-time-value">${endDate.toLocaleString('en-AU', { month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</span>
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
                        
                        let conditionDetails = '';
                        if (ruleEval.conditions && ruleEval.conditions.length > 0) {
                            conditionDetails = ruleEval.conditions.map(c => {
                                const cIcon = c.met ? '✓' : '✗';
                                return `${cIcon} ${c.name || c.rule}: ${c.value}`;
                            }).join(' • ');
                        }
                        
                        html += `
                            <div class="condition-chip ${metClass}" style="display: block; margin-bottom: 4px;">
                                <span style="font-weight: 600;">${icon} ${ruleEval.name || ruleEval.ruleId}</span>
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
                        
                        let conditionDetails = '';
                        if (ruleEval.conditions && ruleEval.conditions.length > 0) {
                            conditionDetails = ruleEval.conditions.map(c => {
                                const cIcon = c.met ? '✓' : '✗';
                                return `${cIcon} ${c.name || c.rule}: ${c.value}`;
                            }).join(' • ');
                        }
                        
                        html += `
                            <div class="condition-chip ${metClass}" style="display: block; margin-bottom: 4px;">
                                <span style="font-weight: 600;">${icon} ${ruleEval.name || ruleEval.ruleId}</span>
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
                if (data.errno === 0 && data.result?.deviceSn) {
                    deviceSn = data.result.deviceSn;
                }
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

        // WIP Pages visibility - Topology Discovery (admin only)
        if (typeof window.auth !== 'undefined' && window.auth) {
            window.auth.onAuthStateChanged((user) => {
                if (user && user.email === 'socrates.team.comms@gmail.com') {
                    const topologyLink = document.getElementById('topologyNavLink');
                    if (topologyLink) topologyLink.style.display = '';
                }
            });
        }
    
