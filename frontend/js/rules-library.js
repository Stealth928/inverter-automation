
    (() => {
        // ── State ──────────────────────────────────────────────
        let selectedImportIds = new Set();
        let selectedRemoveIds = new Set();
        let existingRules = {}; // ruleId → rule payload (already imported)
        let activeRuleId = null;
        let activeCategory = 'all';
        let userInverterCapacityW = 10000;
        let userDefaultRulePowerW = null;
        let initialRecommendationApplied = false;
        const TEMPLATE_POWER_PERCENT_FALLBACK = Object.freeze({
            price_high_feedin_export: 50,
            price_spike_response: 80,
            price_midday_solar_export: 25,
            solar_sunny_peak_headroom: 30,
            time_shoulder_export: 20,
            ev_weekend_surplus_export: 30,
            prod_evening_drain_sunny_tomorrow: 50
        });

        // ── Init ───────────────────────────────────────────────
        AppShell.init({
            pageName: 'rules-library',
            onReady: async () => {
                setRulesLoading(true);
                try {
                    await loadUserPowerProfile();
                    await loadExistingRules();
                    renderCards();
                    applyInitialRecommendationSelection();
                    try { TourEngine.init(window.apiClient); TourEngine.resume(); } catch(e) {}
                } finally {
                    setRulesLoading(false);
                }
            }
        });

        // If page is restored from browser BFCache, reload live profile/rules so
        // inverter-capacity-based power chips are never stale after Settings edits.
        window.addEventListener('pageshow', async (event) => {
            if (!event.persisted) return;
            setRulesLoading(true);
            try {
                await loadUserPowerProfile();
                await loadExistingRules();
                renderCards();
                applyInitialRecommendationSelection();
            } finally {
                setRulesLoading(false);
            }
        });

        function getInitialRecommendationState() {
            try {
                const params = new URLSearchParams(window.location.search || '');
                const validIds = new Set((window.RULE_LIBRARY || []).map((rule) => rule.id));
                const ids = (params.get('recommend') || '')
                    .split(',')
                    .map((id) => id.trim())
                    .filter((id) => validIds.has(id));
                return {
                    ids,
                    bundle: (params.get('bundle') || '').trim(),
                    variant: (params.get('variant') || '').trim()
                };
            } catch (_) {
                return { ids: [], bundle: '', variant: '' };
            }
        }

        function applyInitialRecommendationSelection() {
            if (initialRecommendationApplied) return;

            const recommendation = getInitialRecommendationState();
            if (!recommendation.ids.length) return;

            let addedCount = 0;
            recommendation.ids.forEach((id) => {
                const tmpl = window.RULE_LIBRARY.find((rule) => rule.id === id);
                if (!tmpl) return;
                if (existingRules[slugify(tmpl.name)] || selectedImportIds.has(id)) return;
                selectedImportIds.add(id);
                addedCount += 1;
            });

            initialRecommendationApplied = true;

            if (addedCount > 0) {
                renderCards();
                updateActionBar();
            }

            renderRecommendationBanner(recommendation, addedCount);
        }

        function renderRecommendationBanner(recommendation, addedCount) {
            const banner = document.getElementById('recommendedBundleBanner');
            const text = document.getElementById('recommendedBundleBannerText');
            if (!banner || !text || !recommendation.ids.length) return;

            const bundleName = recommendation.bundle || 'Recommended starter pack';
            const variantLabel = recommendation.variant
                ? ` (${recommendation.variant.replace(/-/g, ' ')})`
                : '';

            if (addedCount > 0) {
                text.innerHTML = `<strong>${escHtml(bundleName)}${escHtml(variantLabel)}</strong> was loaded from the Rule Template Recommender. Review the preselected templates below, then import them into your automation as inactive starter rules.`;
            } else {
                text.innerHTML = `<strong>${escHtml(bundleName)}${escHtml(variantLabel)}</strong> matched templates you already imported or selected. You can still browse the full library and adjust priorities before enabling anything.`;
            }

            banner.style.display = '';
        }

        function setRulesLoading(isLoading) {
            const loading = document.getElementById('rulesLoading');
            const grid = document.getElementById('rulesGrid');
            const searchInput = document.getElementById('searchInput');
            const pills = document.querySelectorAll('#categoryPills .pill');

            if (!loading || !grid) return;

            if (isLoading) {
                loading.classList.add('show');
                loading.setAttribute('aria-busy', 'true');
                grid.classList.add('loading');
                renderLoadingSkeletons();
                if (searchInput) searchInput.disabled = true;
                pills.forEach(p => { p.disabled = true; });
                document.getElementById('emptyState').style.display = 'none';
                document.getElementById('visibleCount').textContent = '...';
                return;
            }

            loading.classList.remove('show');
            loading.setAttribute('aria-busy', 'false');
            grid.classList.remove('loading');
            if (searchInput) searchInput.disabled = false;
            pills.forEach(p => { p.disabled = false; });
        }

        function renderLoadingSkeletons() {
            const grid = document.getElementById('rulesGrid');
            if (!grid) return;

            const cardSkeleton = `
                <div class="rule-skeleton" aria-hidden="true">
                    <div class="skeleton-line w-30"></div>
                    <div class="skeleton-line w-55"></div>
                    <div class="skeleton-line w-90"></div>
                    <div class="skeleton-line w-75"></div>
                    <div class="skeleton-line w-45"></div>
                    <div class="skeleton-line w-65"></div>
                </div>
            `;
            grid.innerHTML = cardSkeleton.repeat(6);
        }

        async function loadUserPowerProfile() {
            try {
                const client = window.apiClient;
                if (!client) return;
                const res = await client.get('/api/config', { t: Date.now() });
                if (!res || res.errno !== 0 || !res.result) return;

                const cfg = res.result || {};
                userInverterCapacityW = getEffectiveInverterCapacityW(cfg.inverterCapacityW);

                const preferredPower = Number(cfg?.defaults?.fdPwr);
                if (Number.isFinite(preferredPower) && preferredPower > 0) {
                    userDefaultRulePowerW = normalizePowerForImport(preferredPower, userInverterCapacityW);
                } else {
                    userDefaultRulePowerW = null;
                }
            } catch (_) {
                // Keep safe defaults; import logic handles fallback.
            }
        }

        async function loadExistingRules() {
            try {
                const client = window.apiClient;
                if (!client) return;
                const res = await client.get('/api/automation/status');
                if (res && res.errno === 0 && res.result && res.result.rules) {
                    existingRules = res.result.rules; // keyed by ruleId
                    activeRuleId = typeof res.result.activeRule === 'string' ? res.result.activeRule : null;
                }
            } catch (e) {
                // silently continue — duplicates will just be flagged at import time
            }
        }

        // ── Category filter ────────────────────────────────────
        window.selectCategory = function(cat, el) {
            activeCategory = cat;
            document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
            el.classList.add('active');
            filterRules();
        };

        // ── Search + filter ────────────────────────────────────
        window.filterRules = function() {
            const q = document.getElementById('searchInput').value.trim().toLowerCase();
            const cards = document.querySelectorAll('.rule-card');
            let visible = 0;
            cards.forEach(card => {
                const id  = card.dataset.id;
                const tmpl = window.RULE_LIBRARY.find(r => r.id === id);
                if (!tmpl) return;

                const catMatch = activeCategory === 'all' || tmpl.category === activeCategory;
                const qMatch   = !q
                    || tmpl.name.toLowerCase().includes(q)
                    || tmpl.description.toLowerCase().includes(q)
                    || tmpl.whyUseIt.toLowerCase().includes(q)
                    || tmpl.categoryLabel.toLowerCase().includes(q)
                    || tmpl.conditionSummary.some(c => c.toLowerCase().includes(q));

                const show = catMatch && qMatch;
                card.style.display = show ? '' : 'none';
                if (show) visible++;
            });

            document.getElementById('visibleCount').textContent = visible;
            document.getElementById('emptyState').style.display = visible === 0 ? '' : 'none';
        };

        // ── Render cards ───────────────────────────────────────
        function renderCards() {
            const grid = document.getElementById('rulesGrid');
            grid.classList.remove('loading');
            grid.innerHTML = '';

            window.RULE_LIBRARY.forEach(tmpl => {
                const alreadyImported = !!existingRules[slugify(tmpl.name)];
                const card = document.createElement('div');
                card.className = 'rule-card'
                    + (alreadyImported ? ' already-imported' : '')
                    + (!alreadyImported && selectedImportIds.has(tmpl.id) ? ' selected' : '')
                    + (alreadyImported && selectedRemoveIds.has(tmpl.id) ? ' marked-remove' : '');
                card.dataset.id = tmpl.id;
                card.onclick = () => toggleCard(tmpl.id, card, alreadyImported);

                const catClass  = 'badge-' + tmpl.category;
                const diffClass = 'badge-' + tmpl.difficulty.toLowerCase();

                const checkboxContent = alreadyImported
                    ? (selectedRemoveIds.has(tmpl.id) ? '−' : '✓')
                    : (selectedImportIds.has(tmpl.id) ? '✓' : '');

                const actionLabel = formatActionLabel(tmpl.rule.action);
                const actionPower = formatActionPowerSummary(
                    tmpl.rule.action,
                    userInverterCapacityW,
                    userDefaultRulePowerW,
                    tmpl.id
                );

                card.innerHTML = `
                    <div class="card-top">
                        <div class="card-top-main">
                            <div class="card-badges">
                                <span class="badge ${catClass}">${tmpl.categoryLabel}</span>
                                <span class="badge ${diffClass}">${tmpl.difficulty}</span>
                            </div>
                            <div class="card-name">${escHtml(tmpl.name)}</div>
                        </div>
                        <div class="card-corner-controls">
                            <div class="card-priority-pill">Priority ${tmpl.rule.priority}</div>
                            <div class="card-checkbox" id="chk-${tmpl.id}">${checkboxContent}</div>
                        </div>
                    </div>
                    <div class="card-description">${escHtml(tmpl.description)}</div>
                    <div class="card-why">
                        <strong>Great for</strong>
                        ${escHtml(tmpl.whyUseIt)}
                    </div>
                    <div class="card-conditions">
                        ${tmpl.conditionSummary.map(c => `<span class="condition-chip">${escHtml(c)}</span>`).join('')}
                    </div>
                    <div class="card-action">
                        <div class="card-action-head">
                            <span class="card-action-label">Action</span>
                            <span class="action-mode">${escHtml(actionLabel)}</span>
                        </div>
                        <div class="card-action-meta">
                            <span class="action-meta">${escHtml(actionPower)}</span>
                            <span class="action-meta">${tmpl.rule.action.durationMinutes} min</span>
                            <span class="action-meta">🔋 Stop ${tmpl.rule.action.fdSoc != null ? tmpl.rule.action.fdSoc : '—'}%</span>
                        </div>
                    </div>
                `;
                grid.appendChild(card);
            });

            filterRules();
        }

        function toggleCard(id, card, alreadyImported) {
            const chk = document.getElementById('chk-' + id);
            if (!chk) return;

            if (alreadyImported) {
                if (selectedRemoveIds.has(id)) {
                    selectedRemoveIds.delete(id);
                    card.classList.remove('marked-remove');
                    chk.textContent = '✓';
                } else {
                    selectedRemoveIds.add(id);
                    card.classList.add('marked-remove');
                    chk.textContent = '−';
                }
            } else {
                if (selectedImportIds.has(id)) {
                    selectedImportIds.delete(id);
                    card.classList.remove('selected');
                    chk.textContent = '';
                } else {
                    selectedImportIds.add(id);
                    card.classList.add('selected');
                    chk.textContent = '✓';
                }
            }
            updateActionBar();
        }

        window.clearSelection = function() {
            selectedImportIds.clear();
            selectedRemoveIds.clear();
            document.querySelectorAll('.rule-card.selected, .rule-card.marked-remove').forEach(c => {
                c.classList.remove('selected');
                c.classList.remove('marked-remove');
                const chk = c.querySelector('.card-checkbox');
                if (!chk) return;
                chk.textContent = c.classList.contains('already-imported') ? '✓' : '';
            });
            updateActionBar();
        };

        function updateActionBar() {
            const bar = document.getElementById('actionBar');
            const addCount = selectedImportIds.size;
            const removeCount = selectedRemoveIds.size;
            const total = addCount + removeCount;

            const countLabel = document.getElementById('selectedCountLabel');
            const btnText = document.getElementById('importBtnText');

            countLabel.textContent = total === 0
                ? '0 selected'
                : `${total} selected (${addCount} add, ${removeCount} remove)`;

            if (addCount > 0 && removeCount > 0) {
                btnText.textContent = 'Apply Changes →';
            } else if (removeCount > 0) {
                btnText.textContent = 'Remove from Automation →';
            } else {
                btnText.textContent = 'Import to Automation →';
            }

            if (total > 0) {
                bar.classList.add('visible');
            } else {
                bar.classList.remove('visible');
            }
        }

        // ── Import / Remove ────────────────────────────────────
        window.importSelected = async function() {
            if (selectedImportIds.size === 0 && selectedRemoveIds.size === 0) return;

            const client = window.apiClient;
            if (!client) {
                showImportResult({
                    added: [],
                    removed: [],
                    skippedAdd: [],
                    skippedRemove: [],
                    failedAdd: [{ name: 'Import', reason: 'Not authenticated. Please refresh and try again.' }],
                    failedRemove: [],
                    priorityAdjusted: [],
                    powerAdjusted: []
                });
                return;
            }

            const btn      = document.getElementById('importBtn');
            const btnText  = document.getElementById('importBtnText');
            btn.disabled   = true;
            btnText.innerHTML = '<div class="spinner"></div> Applying…';

            // Re-fetch live existing rules to catch any changes since page load
            await loadExistingRules();
            const activeRuleAtOperation = activeRuleId;

            const toImport = [];
            const toRemove = [];
            const skippedAdd = [];
            const skippedRemove = [];

            selectedImportIds.forEach(id => {
                const tmpl = window.RULE_LIBRARY.find(r => r.id === id);
                if (!tmpl) return;
                const ruleId = slugify(tmpl.name);
                if (existingRules[ruleId]) {
                    skippedAdd.push(tmpl.name);
                } else {
                    toImport.push(tmpl);
                }
            });

            selectedRemoveIds.forEach(id => {
                const tmpl = window.RULE_LIBRARY.find(r => r.id === id);
                if (!tmpl) return;
                const ruleId = slugify(tmpl.name);
                if (existingRules[ruleId]) {
                    toRemove.push(tmpl);
                } else {
                    skippedRemove.push(tmpl.name);
                }
            });

            // ── Priority clash handling ──────────────────────────
            // Collect all priorities already used by the user's existing rules
            const usedPriorities = new Set();
            Object.values(existingRules).forEach(r => {
                if (r.priority != null) usedPriorities.add(Number(r.priority));
            });

            /** Find next available priority starting from `preferred`.
             *  Tries preferred first, then sweeps 1-10. Falls back to preferred
             *  if every slot is taken (duplicates are harmless). */
            function pickAvailablePriority(preferred, alreadyClaimed) {
                if (!alreadyClaimed.has(preferred) && !usedPriorities.has(preferred)) return preferred;
                for (let p = 1; p <= 10; p++) {
                    if (!usedPriorities.has(p) && !alreadyClaimed.has(p)) return p;
                }
                return preferred; // all 10 in use — duplicate is fine
            }

            // Assign non-clashing priorities before import
            const claimedByBatch = new Set(); // tracks priorities allocated within this batch
            const priorityAdjusted = [];
            const powerAdjusted = [];
            for (const tmpl of toImport) {
                const wanted = tmpl.rule.priority;
                const actual = pickAvailablePriority(wanted, claimedByBatch);
                claimedByBatch.add(actual);
                tmpl._importPriority = actual;
                const preparedAction = prepareTemplateActionForImport(tmpl.rule.action, userInverterCapacityW, userDefaultRulePowerW, tmpl.id);
                tmpl._importAction = preparedAction.action;
                if (actual !== wanted) {
                    priorityAdjusted.push(`${tmpl.name}: ${wanted} → ${actual}`);
                }
                if (preparedAction.adjusted && preparedAction.note) {
                    powerAdjusted.push(`${tmpl.name}: ${preparedAction.note}`);
                }
            }

            const added = [];
            const removed = [];
            const activeRuleRemoved = [];
            const failedAdd = [];
            const failedRemove = [];

            for (const tmpl of toImport) {
                try {
                    const body = {
                        name:            tmpl.name,
                        enabled:         false,
                        priority:        tmpl._importPriority,
                        cooldownMinutes: tmpl.rule.cooldownMinutes,
                        conditions:      tmpl.rule.conditions,
                        action:          tmpl._importAction
                    };
                    const res = await client.post('/api/automation/rule/create', body);
                    if (res && res.errno === 0) {
                        added.push(tmpl.name);
                    } else {
                        failedAdd.push({ name: tmpl.name, reason: res?.error || 'Unknown error' });
                    }
                } catch (e) {
                    failedAdd.push({ name: tmpl.name, reason: e.message || 'Request failed' });
                }
            }

            for (const tmpl of toRemove) {
                try {
                    const res = await client.post('/api/automation/rule/delete', { ruleName: tmpl.name });
                    if (res && res.errno === 0) {
                        removed.push(tmpl.name);
                        if (slugify(tmpl.name) === activeRuleAtOperation) {
                            activeRuleRemoved.push(tmpl.name);
                        }
                    } else {
                        failedRemove.push({ name: tmpl.name, reason: res?.error || 'Unknown error' });
                    }
                } catch (e) {
                    failedRemove.push({ name: tmpl.name, reason: e.message || 'Request failed' });
                }
            }

            btn.disabled  = false;

            // Refresh existing rules to update card states
            await loadExistingRules();
            renderCards();
            clearSelection();
            showImportResult({
                added,
                removed,
                skippedAdd,
                skippedRemove,
                failedAdd,
                failedRemove,
                priorityAdjusted,
                powerAdjusted,
                activeRuleRemoved
            });
        };

        function showImportResult({
            added = [],
            removed = [],
            skippedAdd = [],
            skippedRemove = [],
            failedAdd = [],
            failedRemove = [],
            priorityAdjusted = [],
            powerAdjusted = [],
            activeRuleRemoved = []
        }) {
            const banner = document.getElementById('importBanner');
            const icon   = document.getElementById('bannerIcon');
            const title  = document.getElementById('bannerTitle');
            const detail = document.getElementById('bannerDetail');

            let type = 'success';
            let titleText = '';
            let detailLines = [];

            if (added.length > 0 && removed.length > 0) {
                titleText = `${added.length} rule${added.length > 1 ? 's' : ''} added and ${removed.length} removed.`;
            } else if (added.length > 0) {
                titleText = `${added.length} rule${added.length > 1 ? 's' : ''} added to your automation as inactive.`;
                detailLines.push(`<a href="/">View in Automation Panel →</a> to review and enable them, or <a href="/test.html">try them in Automation Lab</a> first.`);
            } else if (removed.length > 0) {
                titleText = `${removed.length} rule${removed.length > 1 ? 's' : ''} removed from your automation.`;
            }
            if (removed.length > 0) {
                detailLines.push(`Removed: <em>${removed.join(', ')}</em>.`);
            }
            if (activeRuleRemoved.length > 0) {
                detailLines.push(`Active rule cleanup applied: scheduler segments were cleared and the active rule was ended for <em>${activeRuleRemoved.join(', ')}</em>.`);
            }
            if (priorityAdjusted.length > 0) {
                detailLines.push(`⚡ Priority adjusted to avoid clashes: <em>${priorityAdjusted.join('; ')}</em>.`);
            }
            if (powerAdjusted.length > 0) {
                detailLines.push(`⚡ Power adjusted for inverter limits: <em>${powerAdjusted.join('; ')}</em>.`);
            }
            if (skippedAdd.length > 0) {
                type = 'warning';
                if (!titleText) titleText = 'No new rules were imported.';
                detailLines.push(`Skipped ${skippedAdd.length} add request${skippedAdd.length > 1 ? 's' : ''} already in your automation: <em>${skippedAdd.join(', ')}</em>.`);
            }
            if (skippedRemove.length > 0) {
                type = 'warning';
                if (!titleText) titleText = 'No rules were removed.';
                detailLines.push(`Skipped ${skippedRemove.length} remove request${skippedRemove.length > 1 ? 's' : ''} not found in your automation: <em>${skippedRemove.join(', ')}</em>.`);
            }
            if (failedAdd.length > 0 || failedRemove.length > 0) {
                type = 'error';
                if (!titleText) titleText = 'Some changes failed.';
                if (failedAdd.length > 0) {
                    detailLines.push(`Import failed: ${failedAdd.map(f => `${f.name} (${f.reason})`).join(', ')}.`);
                }
                if (failedRemove.length > 0) {
                    detailLines.push(`Remove failed: ${failedRemove.map(f => `${f.name} (${f.reason})`).join(', ')}.`);
                }
            }
            if (!titleText) {
                type = 'warning';
                titleText = 'No changes were applied.';
            }

            icon.textContent = type === 'success' ? '✅' : type === 'warning' ? '⚠️' : '❌';
            title.textContent = titleText;
            detail.innerHTML  = detailLines.join(' ');

            banner.className = `import-banner show ${type}`;
            banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        window.closeBanner = function() {
            document.getElementById('importBanner').className = 'import-banner';
        };

        // ── Helpers ────────────────────────────────────────────
        function slugify(name) {
            return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        }

        function escHtml(str) {
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        function formatActionLabel(action) {
            const modes = {
                SelfUse:       'Self Use',
                ForceDischarge: 'Force Discharge',
                ForceCharge:    'Force Charge',
                Feedin:         'Feed In',
                Backup:         'Backup'
            };
            return modes[action.workMode] || action.workMode;
        }

        function getEffectiveInverterCapacityW(rawCapacityW) {
            const parsed = Number(rawCapacityW);
            if (!Number.isFinite(parsed) || parsed < 1000) return 10000;
            return Math.min(30000, Math.round(parsed));
        }

        function normalizePowerForImport(powerW, inverterCapacityW) {
            const parsed = Number(powerW);
            if (!Number.isFinite(parsed) || parsed <= 0) return null;
            const rounded = Math.round(parsed / 100) * 100;
            return Math.max(1000, Math.min(inverterCapacityW, rounded));
        }

        function normalizePowerPercent(percent) {
            const parsed = Number(percent);
            if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) return null;
            return Math.round(parsed * 10) / 10;
        }

        function deriveTemplatePowerW(inverterCapacityW, _preferredPowerW) {
            const halfCapacity = Math.round((inverterCapacityW * 0.5) / 100) * 100;
            return Math.max(1000, Math.min(inverterCapacityW, halfCapacity));
        }

        function requiresExplicitPower(workMode) {
            return workMode === 'ForceCharge' || workMode === 'ForceDischarge' || workMode === 'Feedin';
        }

        function getTemplatePowerPercent(templateId, action) {
            const explicitPercent = normalizePowerPercent(action?.fdPwrPercent);
            if (explicitPercent) return explicitPercent;

            const fallbackPercent = normalizePowerPercent(TEMPLATE_POWER_PERCENT_FALLBACK[templateId]);
            if (!fallbackPercent) return null;

            // Only apply fallback when the template still carries its canonical
            // baseline 10kW absolute power (protects custom/edited template values).
            const parsedPower = Number(action?.fdPwr);
            if (Number.isFinite(parsedPower) && parsedPower > 0) {
                const expectedBaselineW = normalizePowerForImport((10000 * fallbackPercent) / 100, 10000);
                if (!expectedBaselineW || Math.abs(parsedPower - expectedBaselineW) > 150) return null;
            }

            return fallbackPercent;
        }

        function prepareTemplateActionForImport(templateAction, inverterCapacityW, preferredPowerW, templateId) {
            const action = JSON.parse(JSON.stringify(templateAction || {}));
            const mode = action.workMode || 'SelfUse';
            const templatePowerPercent = getTemplatePowerPercent(templateId, action);
            delete action.fdPwrPercent;

            if (!requiresExplicitPower(mode)) {
                action.fdPwr = 0;
                return { action, adjusted: false, note: '' };
            }

            if (templatePowerPercent) {
                const percentPower = normalizePowerForImport((inverterCapacityW * templatePowerPercent) / 100, inverterCapacityW);
                if (percentPower) {
                    action.fdPwr = percentPower;
                    return {
                        action,
                        adjusted: true,
                        note: `Power set to ${percentPower}W (resolved for your inverter)`
                    };
                }
            }

            const parsedPower = Number(action.fdPwr);
            const hasValidTemplatePower = Number.isFinite(parsedPower) && parsedPower > 0;
            const normalizedTemplatePower = hasValidTemplatePower
                ? normalizePowerForImport(parsedPower, inverterCapacityW)
                : null;

            if (!normalizedTemplatePower) {
                const derivedPower = deriveTemplatePowerW(inverterCapacityW, preferredPowerW);
                action.fdPwr = derivedPower;
                return {
                    action,
                    adjusted: true,
                    note: `Power auto-set to ${derivedPower}W (from ${Math.round(inverterCapacityW / 100) / 10}kW inverter capacity)`
                };
            }

            if (normalizedTemplatePower !== parsedPower) {
                action.fdPwr = normalizedTemplatePower;
                return {
                    action,
                    adjusted: true,
                    note: `Power capped to ${normalizedTemplatePower}W (inverter limit)`
                };
            }

            action.fdPwr = normalizedTemplatePower;
            return { action, adjusted: false, note: '' };
        }

        function resolveActionPowerW(action, inverterCapacityW, preferredPowerW, templateId) {
            const mode = action?.workMode || 'SelfUse';
            if (!requiresExplicitPower(mode)) return 0;

            const templatePowerPercent = getTemplatePowerPercent(templateId, action);
            if (templatePowerPercent) {
                const resolvedFromPercent = normalizePowerForImport((inverterCapacityW * templatePowerPercent) / 100, inverterCapacityW);
                if (resolvedFromPercent && resolvedFromPercent > 0) return resolvedFromPercent;
            }

            const parsedPower = Number(action?.fdPwr);
            if (Number.isFinite(parsedPower) && parsedPower > 0) {
                const explicitPower = normalizePowerForImport(parsedPower, inverterCapacityW);
                if (explicitPower && explicitPower > 0) return explicitPower;
            }

            return deriveTemplatePowerW(inverterCapacityW, preferredPowerW);
        }

        function formatActionPowerSummary(action, inverterCapacityW, preferredPowerW, templateId) {
            const mode = action?.workMode || 'SelfUse';
            if (!requiresExplicitPower(mode)) return '0W';

            const resolvedPower = resolveActionPowerW(action, inverterCapacityW, preferredPowerW, templateId);
            return `${Math.round(resolvedPower)}W`;
        }

    })();
    