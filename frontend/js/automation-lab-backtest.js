(() => {
    const CANDIDATE_STORAGE_KEY = 'automationLabCandidateSnapshot';
    const BACKTEST_POLL_MS = 3000;
    const OPTIMIZATION_POLL_MS = 3500;
    const rootId = 'automationLabWorkbench';
    const state = {
        loading: true,
        bootstrapped: false,
        currentTimezone: 'Australia/Sydney',
        currentRulesSnapshot: null,
        candidateSnapshot: null,
        compareMode: 'current_vs_baseline',
        periodPreset: '90',
        customStartDate: '',
        customEndDate: '',
        tariffPlans: [],
        selectedPlanId: '',
        backtestRuns: [],
        selectedRunId: '',
        activeRun: null,
        runningBacktest: false,
        backtestError: '',
        view: 'setup',
        tariffDraftOpen: false,
        tariffDraftMessage: '',
        savingTariffDraft: false,
        tariffDraft: null,
        optimizerGoal: 'maximize_roi',
        optimizerScenarioId: '',
        optimizationRun: null,
        optimizationError: '',
        optimizerBusy: false,
        applyMessage: ''
    };

    let root = null;
    let backtestPollTimer = null;
    let optimizationPollTimer = null;
    let uiBound = false;

    function deepClone(value) {
        return JSON.parse(JSON.stringify(value || null));
    }

    function injectStyles() {
        if (document.getElementById('automationLabWorkbenchStyles')) return;
        const style = document.createElement('style');
        style.id = 'automationLabWorkbenchStyles';
        style.textContent = `
            .lab-workbench { margin: 0 0 20px; position: relative; z-index: 2; }
            .lab-shell { display: grid; gap: 18px; }
            .lab-hero { background: radial-gradient(circle at top left, rgba(16, 185, 129, 0.18), transparent 42%), linear-gradient(135deg, rgba(13, 148, 136, 0.16), rgba(30, 64, 175, 0.14)), var(--bg-card); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 18px; padding: 22px; box-shadow: 0 18px 40px rgba(0, 0, 0, 0.18); }
            .lab-eyebrow { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; background: rgba(15, 23, 42, 0.35); border: 1px solid rgba(148, 163, 184, 0.22); color: var(--text-secondary); font-size: 0.78rem; letter-spacing: 0.04em; text-transform: uppercase; font-weight: 700; margin-bottom: 14px; }
            .lab-hero h2 { margin: 0 0 10px; font-size: clamp(1.5rem, 3vw, 2.3rem); line-height: 1.05; }
            .lab-hero p { margin: 0; max-width: 720px; color: var(--text-secondary); line-height: 1.6; font-size: 0.97rem; }
            .lab-summary-bar { position: sticky; top: 76px; z-index: 3; display: grid; gap: 10px; grid-template-columns: repeat(4, minmax(0, 1fr)); padding: 14px 16px; background: color-mix(in srgb, var(--bg-card) 90%, #0f172a 10%); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 14px; backdrop-filter: blur(16px); }
            .lab-summary-label { display: block; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin-bottom: 4px; }
            .lab-summary-value { font-size: 0.96rem; font-weight: 700; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .lab-view-toggle { display: none; gap: 8px; background: var(--bg-secondary); border: 1px solid var(--border-primary); border-radius: 12px; padding: 4px; }
            .lab-view-toggle button { flex: 1; border: none; border-radius: 9px; background: transparent; color: var(--text-secondary); padding: 10px 12px; font-weight: 700; cursor: pointer; }
            .lab-view-toggle button.active { background: var(--bg-card); color: var(--text-primary); box-shadow: 0 6px 16px rgba(0, 0, 0, 0.14); }
            .lab-columns { display: grid; gap: 18px; grid-template-columns: minmax(320px, 420px) minmax(0, 1fr); }
            .lab-panel { display: grid; gap: 16px; align-content: start; }
            .lab-card { background: var(--bg-card); border: 1px solid rgba(148, 163, 184, 0.18); border-radius: 16px; padding: 18px; box-shadow: 0 16px 36px rgba(0, 0, 0, 0.12); }
            .lab-card h3 { margin: 0 0 6px; font-size: 1rem; }
            .lab-card-copy { margin: 0 0 16px; color: var(--text-secondary); line-height: 1.55; font-size: 0.9rem; }
            .lab-stack, .lab-choice-grid, .lab-summary-grid, .lab-comparison-grid, .lab-variant-grid, .lab-run-list, .lab-scenario-list, .lab-limitation-list, .lab-rule-list, .lab-plan-rows { display: grid; gap: 12px; }
            .lab-choice-grid { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
            .lab-choice { text-align: left; background: var(--bg-secondary); border: 1px solid rgba(148, 163, 184, 0.18); border-radius: 14px; padding: 14px; color: var(--text-primary); cursor: pointer; transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease; }
            .lab-choice:hover { transform: translateY(-1px); border-color: rgba(56, 189, 248, 0.42); }
            .lab-choice.active { border-color: rgba(16, 185, 129, 0.62); box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.14); background: linear-gradient(145deg, rgba(16, 185, 129, 0.12), rgba(15, 23, 42, 0.2)); }
            .lab-choice-title { display: block; font-weight: 700; margin-bottom: 4px; }
            .lab-choice-copy, .lab-run-meta, .lab-metric-meta, .lab-variant-copy, .lab-empty { color: var(--text-secondary); line-height: 1.5; font-size: 0.86rem; }
            .lab-inline-actions, .lab-inline-fields, .lab-pills, .lab-badges, .lab-variant-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
            .lab-field { display: grid; gap: 6px; min-width: 0; flex: 1; }
            .lab-field label { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); }
            .lab-field input, .lab-field select { width: 100%; }
            .lab-pill { border: 1px solid rgba(148, 163, 184, 0.2); background: var(--bg-secondary); border-radius: 999px; color: var(--text-secondary); padding: 8px 12px; font-size: 0.84rem; font-weight: 700; cursor: pointer; }
            .lab-pill.active { background: rgba(59, 130, 246, 0.18); border-color: rgba(59, 130, 246, 0.42); color: var(--text-primary); }
            .lab-note, .lab-message { padding: 12px 14px; border-radius: 12px; font-size: 0.88rem; line-height: 1.5; }
            .lab-note { background: rgba(59, 130, 246, 0.09); border: 1px solid rgba(59, 130, 246, 0.2); color: var(--text-secondary); }
            .lab-message.error { background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #fecaca; }
            .lab-message.success { background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); color: #d1fae5; }
            .lab-run-cta { width: 100%; justify-content: center; font-size: 0.96rem; font-weight: 700; padding: 14px 18px; }
            .lab-scenario-card, .lab-run-card, .lab-metric-card, .lab-comparison-card, .lab-variant-card { background: var(--bg-secondary); border: 1px solid rgba(148, 163, 184, 0.14); border-radius: 14px; padding: 14px; }
            .lab-run-card { cursor: pointer; }
            .lab-run-card.active { border-color: rgba(16, 185, 129, 0.54); box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12); }
            .lab-badge { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 5px 9px; background: rgba(15, 23, 42, 0.36); border: 1px solid rgba(148, 163, 184, 0.16); font-size: 0.76rem; color: var(--text-secondary); }
            .lab-status { font-weight: 700; text-transform: capitalize; }
            .lab-status.completed { color: #86efac; }
            .lab-status.running, .lab-status.queued { color: #93c5fd; }
            .lab-status.failed { color: #fca5a5; }
            .lab-summary-grid { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
            .lab-metric-value { font-size: 1.35rem; font-weight: 800; margin: 8px 0 4px; color: var(--text-primary); }
            .lab-metric-value.good { color: #86efac; }
            .lab-metric-value.bad { color: #fca5a5; }
            .lab-comparison-grid, .lab-variant-grid { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
            .lab-variant-actions .btn { flex: 1; justify-content: center; }
            .lab-details { border-radius: 12px; border: 1px solid rgba(148, 163, 184, 0.16); background: color-mix(in srgb, var(--bg-card) 86%, transparent); }
            .lab-details summary { cursor: pointer; list-style: none; padding: 14px; font-weight: 700; }
            .lab-details summary::-webkit-details-marker { display: none; }
            .lab-details-content { padding: 0 14px 14px; }
            .lab-plan-row { display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) auto; align-items: end; }
            .lab-empty, .lab-loading { padding: 24px; text-align: center; border: 1px dashed rgba(148, 163, 184, 0.18); border-radius: 14px; }
            .lab-quick-test { margin-top: 18px; border: 1px solid rgba(148, 163, 184, 0.16); border-radius: 18px; background: var(--bg-card); overflow: hidden; }
            .lab-quick-test summary { padding: 18px 20px; cursor: pointer; font-weight: 700; list-style: none; }
            .lab-quick-test summary::-webkit-details-marker { display: none; }
            .lab-quick-test-copy { padding: 0 20px 16px; color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6; }
            @media (max-width: 960px) { .lab-summary-bar, .lab-columns { grid-template-columns: 1fr; } .lab-view-toggle { display: flex; } .lab-panel.lab-mobile-hidden { display: none; } .lab-summary-bar { top: 68px; } }
            @media (max-width: 720px) { .lab-hero, .lab-card { padding: 16px; } .lab-plan-row { grid-template-columns: 1fr; } .lab-summary-bar { top: auto; bottom: 12px; left: 0; right: 0; position: fixed; margin: 0 12px; box-shadow: 0 20px 32px rgba(0, 0, 0, 0.25); } .lab-summary-bar .lab-summary-item:last-child { display: none; } .lab-shell { padding-bottom: 116px; } }
        `;
        document.head.appendChild(style);
    }

    function createTariffDraft(timezone) {
        return {
            name: '',
            timezone: timezone || 'Australia/Sydney',
            dailySupplyCharge: '',
            importWindows: [{ startTime: '00:00', endTime: '23:59', centsPerKwh: '30' }],
            exportWindows: [{ startTime: '00:00', endTime: '23:59', centsPerKwh: '10' }]
        };
    }

    function loadCandidateSnapshot() {
        try {
            const stored = localStorage.getItem(CANDIDATE_STORAGE_KEY);
            if (!stored) return null;
            const parsed = JSON.parse(stored);
            if (!parsed || typeof parsed !== 'object' || !parsed.rules || Object.keys(parsed.rules).length === 0) return null;
            return parsed;
        } catch (error) {
            console.warn('[Automation Lab] Failed to read candidate snapshot', error);
            return null;
        }
    }

    function getRuleCount(snapshot) {
        return Object.values(snapshot?.rules || {}).filter((rule) => rule && rule.enabled !== false).length;
    }

    function formatDate(value) {
        if (!value) return 'Not set';
        return new Date(value).toLocaleString('en-AU', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function formatCurrency(value) {
        const number = Number(value || 0);
        return new Intl.NumberFormat('en-AU', {
            style: 'currency',
            currency: 'AUD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(number);
    }

    function formatSignedCurrency(value) {
        const number = Number(value || 0);
        return `${number >= 0 ? '+' : '-'}${formatCurrency(Math.abs(number))}`;
    }

    function formatSignedNumber(value, digits = 2, suffix = '') {
        const number = Number(value || 0);
        return `${number >= 0 ? '+' : '-'}${Math.abs(number).toFixed(digits)}${suffix}`;
    }

    function escHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function getTodayDateOnly() {
        return new Date().toISOString().slice(0, 10);
    }

    function getDateDaysAgo(days) {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() - Math.max(0, Number(days || 0)));
        return date.toISOString().slice(0, 10);
    }

    function getSelectedPeriod() {
        if (state.periodPreset === 'custom') {
            return { startDate: state.customStartDate, endDate: state.customEndDate };
        }
        const days = Number(state.periodPreset || 90);
        return { startDate: getDateDaysAgo(days - 1), endDate: getTodayDateOnly() };
    }

    function compareModes() {
        const modes = [{
            id: 'current_vs_baseline',
            title: 'Current vs baseline',
            copy: 'Replay your current live rules against passive self-use.'
        }];
        if (state.candidateSnapshot && getRuleCount(state.currentRulesSnapshot) > 0) {
            modes.push({
                id: 'current_vs_candidate',
                title: 'Current vs candidate',
                copy: 'Compare your live rules to the candidate rules waiting in Automation Lab.'
            });
        }
        if (state.candidateSnapshot) {
            modes.push({
                id: 'candidate_vs_baseline',
                title: 'Candidate vs baseline',
                copy: 'Test a Rules Library candidate before you import or enable anything.'
            });
        }
        modes.push({
            id: 'current_vs_plan',
            title: 'Current tariff vs plan',
            copy: 'Run your current rules under today\'s tariff and a manual plan model.'
        });
        return modes;
    }

    function buildPayloadPreview() {
        const period = getSelectedPeriod();
        if (!period.startDate || !period.endDate) {
            return { error: 'Choose a valid period before running a backtest.' };
        }
        if (period.endDate < period.startDate) {
            return { error: 'End date must be on or after start date.' };
        }

        const currentRulesCount = getRuleCount(state.currentRulesSnapshot);
        const candidateRulesCount = getRuleCount(state.candidateSnapshot);
        const scenarios = [];
        if (state.compareMode === 'current_vs_baseline') {
            if (currentRulesCount === 0) return { error: 'You do not have any enabled current rules to backtest.' };
            scenarios.push({
                id: 'current',
                name: 'Current rules',
                ruleSetSnapshot: deepClone(state.currentRulesSnapshot)
            });
        } else if (state.compareMode === 'current_vs_candidate') {
            if (currentRulesCount === 0) return { error: 'Your current rule set is empty.' };
            if (candidateRulesCount === 0) return { error: 'Your candidate rule set is empty.' };
            scenarios.push({
                id: 'current',
                name: 'Current rules',
                ruleSetSnapshot: deepClone(state.currentRulesSnapshot)
            });
            scenarios.push({
                id: 'candidate',
                name: state.candidateSnapshot.name || 'Candidate rules',
                ruleSetSnapshot: deepClone(state.candidateSnapshot)
            });
        } else if (state.compareMode === 'candidate_vs_baseline') {
            if (candidateRulesCount === 0) return { error: 'Choose at least one candidate rule from Rules Library first.' };
            scenarios.push({
                id: 'candidate',
                name: state.candidateSnapshot.name || 'Candidate rules',
                ruleSetSnapshot: deepClone(state.candidateSnapshot)
            });
        } else if (state.compareMode === 'current_vs_plan') {
            if (currentRulesCount === 0) return { error: 'You need at least one enabled current rule to compare tariffs.' };
            const selectedPlan = state.tariffPlans.find((plan) => String(plan.id) === String(state.selectedPlanId));
            if (!selectedPlan) return { error: 'Choose or create a manual tariff plan first.' };
            scenarios.push({
                id: 'current_tariff',
                name: 'Current tariff',
                ruleSetSnapshot: deepClone(state.currentRulesSnapshot)
            });
            scenarios.push({
                id: 'candidate_plan',
                name: selectedPlan.name,
                ruleSetSnapshot: deepClone(state.currentRulesSnapshot),
                tariff: {
                    kind: 'manual',
                    planId: selectedPlan.id
                }
            });
        }

        return {
            payload: {
                period,
                includeBaseline: true,
                comparisonMode: state.compareMode,
                scenarios
            },
            scenarios
        };
    }

    function selectedRunSummaries(run) {
        return Array.isArray(run?.result?.summaries) ? run.result.summaries : [];
    }

    function nonBaselineSummaries(run) {
        return selectedRunSummaries(run).filter((summary) => summary.scenarioId !== 'baseline');
    }

    function syncOptimizerScenario(run) {
        const summaries = nonBaselineSummaries(run);
        if (!summaries.length) {
            state.optimizerScenarioId = '';
            return;
        }
        if (!summaries.some((summary) => summary.scenarioId === state.optimizerScenarioId)) {
            state.optimizerScenarioId = summaries[0].scenarioId;
        }
    }

    async function loadInitialData() {
        state.loading = true;
        render();
        try {
            await waitForAPIClient(5000);
            const [configResponse, statusResponse, tariffResponse, runsResponse] = await Promise.all([
                window.apiClient.getConfig(),
                window.apiClient.getAutomationStatus(),
                window.apiClient.listBacktestTariffPlans(),
                window.apiClient.listBacktestRuns(12)
            ]);

            state.currentTimezone = configResponse?.result?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Sydney';
            state.currentRulesSnapshot = {
                source: 'current',
                name: 'Current rules',
                rules: deepClone(statusResponse?.result?.rules || {})
            };
            state.candidateSnapshot = loadCandidateSnapshot();
            state.tariffPlans = Array.isArray(tariffResponse?.result) ? tariffResponse.result : [];
            if (!state.tariffDraft) state.tariffDraft = createTariffDraft(state.currentTimezone);
            if (!state.selectedPlanId && state.tariffPlans[0]) state.selectedPlanId = state.tariffPlans[0].id;

            state.backtestRuns = Array.isArray(runsResponse?.result) ? runsResponse.result : [];
            if (!state.selectedRunId && state.backtestRuns[0]) {
                state.selectedRunId = state.backtestRuns[0].id;
                state.activeRun = state.backtestRuns[0];
                syncOptimizerScenario(state.activeRun);
            }

            if (state.candidateSnapshot && getRuleCount(state.currentRulesSnapshot) > 0) {
                state.compareMode = 'current_vs_candidate';
            } else if (state.candidateSnapshot) {
                state.compareMode = 'candidate_vs_baseline';
            }

            if (state.activeRun && ['queued', 'running'].includes(state.activeRun.status)) {
                startBacktestPolling(state.activeRun.id);
            }
        } catch (error) {
            state.backtestError = error?.message || 'Failed to load Automation Lab data.';
        } finally {
            state.loading = false;
            render();
        }
    }

    function ensureRoot() {
        if (root) return root;
        const container = document.querySelector('.container');
        const infoBanner = container?.querySelector('.info-banner');
        const grid = container?.querySelector('.grid');
        const headerTitle = container?.querySelector('header h1');
        if (!container || !infoBanner || !grid || !headerTitle) return null;

        document.title = 'Automation Lab - SoCrates';
        headerTitle.textContent = 'Automation Lab';

        root = document.createElement('section');
        root.id = rootId;
        root.className = 'lab-workbench';
        infoBanner.insertAdjacentElement('afterend', root);

        if (!grid.parentElement.classList.contains('lab-quick-test')) {
            const quickTest = document.createElement('details');
            quickTest.className = 'lab-quick-test';
            quickTest.innerHTML = `
                <summary>Quick Test</summary>
                <div class="lab-quick-test-copy">
                    Keep the original simulator close by for single-moment checks. Backtesting and optimizer runs now live above it as the default Automation Lab flow.
                </div>
            `;
            grid.parentElement.insertBefore(quickTest, grid);
            quickTest.appendChild(grid);
        }

        if (!uiBound) {
            root.addEventListener('click', handleClick);
            root.addEventListener('change', handleChange);
            uiBound = true;
        }
        return root;
    }

    function periodLabel(period) {
        if (!period?.startDate || !period?.endDate) return 'Choose dates';
        return `${period.startDate} to ${period.endDate}`;
    }

    function render() {
        const host = ensureRoot();
        if (!host) return;
        const preview = buildPayloadPreview();
        const selectedPlan = state.tariffPlans.find((plan) => String(plan.id) === String(state.selectedPlanId)) || null;
        const run = state.activeRun;
        syncOptimizerScenario(run);

        host.innerHTML = `
            <div class="lab-shell">
                <section class="lab-hero">
                    <div class="lab-eyebrow">Backtest and Optimise</div>
                    <h2>Test changes before you trust them.</h2>
                    <p>Replay your automation against real history, compare plans under the same household pattern, and only then ask for explainable tuning suggestions.</p>
                </section>
                <div class="lab-summary-bar">
                    <div class="lab-summary-item">
                        <span class="lab-summary-label">Comparison</span>
                        <span class="lab-summary-value">${escHtml(compareModes().find((mode) => mode.id === state.compareMode)?.title || 'Current vs baseline')}</span>
                    </div>
                    <div class="lab-summary-item">
                        <span class="lab-summary-label">Period</span>
                        <span class="lab-summary-value">${escHtml(periodLabel(getSelectedPeriod()))}</span>
                    </div>
                    <div class="lab-summary-item">
                        <span class="lab-summary-label">Tariff</span>
                        <span class="lab-summary-value">${escHtml(selectedPlan ? selectedPlan.name : 'Current tariff')}</span>
                    </div>
                    <div class="lab-summary-item">
                        <span class="lab-summary-label">Candidate</span>
                        <span class="lab-summary-value">${escHtml(state.candidateSnapshot ? `${getRuleCount(state.candidateSnapshot)} rules ready` : 'None loaded')}</span>
                    </div>
                </div>
                <div class="lab-view-toggle">
                    <button type="button" class="${state.view === 'setup' ? 'active' : ''}" data-action="switch-view" data-view="setup">Setup</button>
                    <button type="button" class="${state.view === 'results' ? 'active' : ''}" data-action="switch-view" data-view="results">Results</button>
                </div>
                <div class="lab-columns">
                    <section class="lab-panel ${state.view === 'results' ? 'lab-mobile-hidden' : ''}">
                        ${renderSetupColumn(preview, selectedPlan)}
                    </section>
                    <section class="lab-panel ${state.view === 'setup' ? 'lab-mobile-hidden' : ''}">
                        ${renderResultsColumn(run)}
                    </section>
                </div>
            </div>
        `;
    }

    function renderSetupColumn(preview, selectedPlan) {
        const currentRuleCount = getRuleCount(state.currentRulesSnapshot);
        const candidateRuleCount = getRuleCount(state.candidateSnapshot);
        return `
            <section class="lab-card">
                <h3>What to test</h3>
                <p class="lab-card-copy">Pick one focused comparison. The page keeps the rest of the detail out of your way until you need it.</p>
                <div class="lab-choice-grid">
                    ${compareModes().map((mode) => `
                        <button type="button" class="lab-choice ${mode.id === state.compareMode ? 'active' : ''}" data-action="set-compare-mode" data-mode="${mode.id}">
                            <span class="lab-choice-title">${escHtml(mode.title)}</span>
                            <span class="lab-choice-copy">${escHtml(mode.copy)}</span>
                        </button>
                    `).join('')}
                </div>
                <div class="lab-badges">
                    <span class="lab-badge">${currentRuleCount} live rule${currentRuleCount === 1 ? '' : 's'}</span>
                    ${state.candidateSnapshot ? `<span class="lab-badge">${candidateRuleCount} candidate rule${candidateRuleCount === 1 ? '' : 's'}</span>` : ''}
                </div>
                ${state.candidateSnapshot ? `
                    <div class="lab-note" style="margin-top:12px;">
                        Candidate loaded: <strong>${escHtml(state.candidateSnapshot.name || 'Rules Library candidate')}</strong>.
                        <button type="button" class="btn btn-secondary" data-action="clear-candidate" style="margin-left:10px;">Clear candidate</button>
                    </div>
                ` : ''}
            </section>
            <section class="lab-card">
                <h3>Period and tariff</h3>
                <p class="lab-card-copy">Use quick windows for clean comparisons, then switch to custom dates only when you need a more specific slice of history.</p>
                <div class="lab-pills">
                    ${['30', '90', '365'].map((preset) => `
                        <button type="button" class="lab-pill ${state.periodPreset === preset ? 'active' : ''}" data-action="set-period-preset" data-preset="${preset}">Last ${preset} days</button>
                    `).join('')}
                    <button type="button" class="lab-pill ${state.periodPreset === 'custom' ? 'active' : ''}" data-action="set-period-preset" data-preset="custom">Custom</button>
                </div>
                <div class="lab-inline-fields" style="margin-top:14px;">
                    <div class="lab-field">
                        <label>Start date</label>
                        <input type="date" data-field="customStartDate" value="${escHtml(state.customStartDate)}" ${state.periodPreset !== 'custom' ? 'disabled' : ''}>
                    </div>
                    <div class="lab-field">
                        <label>End date</label>
                        <input type="date" data-field="customEndDate" value="${escHtml(state.customEndDate)}" ${state.periodPreset !== 'custom' ? 'disabled' : ''}>
                    </div>
                </div>
                <div class="lab-note" style="margin-top:14px;">
                    Backtests use a fixed 5-minute replay grid and today\'s truth sources: historical pricing, historical weather, and provider history where available.
                </div>
                ${state.compareMode === 'current_vs_plan' ? renderTariffPanel(selectedPlan) : ''}
            </section>
            <section class="lab-card">
                <h3>Review and run</h3>
                <p class="lab-card-copy">Summary first, evidence second. You\'ll get a saved report in ROI after the run completes.</p>
                ${state.backtestError ? `<div class="lab-message error">${escHtml(state.backtestError)}</div>` : ''}
                ${preview.error ? `<div class="lab-message error">${escHtml(preview.error)}</div>` : ''}
                <div class="lab-scenario-list">
                    ${(preview.scenarios || []).map((scenario) => `
                        <div class="lab-scenario-card">
                            <strong>${escHtml(scenario.name)}</strong>
                            <div class="lab-run-meta">${getRuleCount(scenario.ruleSetSnapshot)} rule${getRuleCount(scenario.ruleSetSnapshot) === 1 ? '' : 's'} in replay${scenario.tariff ? ` • tariff: ${escHtml(selectedPlan?.name || 'manual plan')}` : ''}</div>
                        </div>
                    `).join('')}
                </div>
                <button type="button" class="btn btn-primary lab-run-cta" data-action="run-backtest" ${preview.error || state.runningBacktest ? 'disabled' : ''}>
                    ${state.runningBacktest ? 'Running backtest...' : 'Run historical backtest'}
                </button>
            </section>
        `;
    }

    function renderTariffPanel(selectedPlan) {
        const draft = state.tariffDraft || createTariffDraft(state.currentTimezone);
        return `
            <div class="lab-stack" style="margin-top:16px;">
                <div class="lab-inline-fields">
                    <div class="lab-field">
                        <label>Manual plan</label>
                        <select data-field="selectedPlanId">
                            <option value="">Choose a saved plan</option>
                            ${state.tariffPlans.map((plan) => `<option value="${escHtml(plan.id)}" ${String(plan.id) === String(state.selectedPlanId) ? 'selected' : ''}>${escHtml(plan.name)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="lab-inline-actions">
                        <button type="button" class="btn btn-secondary" data-action="toggle-tariff-draft">${state.tariffDraftOpen ? 'Hide plan builder' : 'New plan'}</button>
                        ${selectedPlan ? `<button type="button" class="btn btn-secondary" data-action="delete-plan" data-plan-id="${escHtml(selectedPlan.id)}">Delete plan</button>` : ''}
                    </div>
                </div>
                ${selectedPlan ? `<div class="lab-note">Selected plan: <strong>${escHtml(selectedPlan.name)}</strong> with ${selectedPlan.importWindows?.length || 0} import window(s) and ${selectedPlan.exportWindows?.length || 0} export window(s).</div>` : ''}
                ${state.tariffDraftMessage ? `<div class="lab-message ${state.tariffDraftMessage.startsWith('Saved') || state.tariffDraftMessage === 'Plan deleted.' ? 'success' : 'error'}">${escHtml(state.tariffDraftMessage)}</div>` : ''}
                ${state.tariffDraftOpen ? `
                    <details class="lab-details" open>
                        <summary>Manual tariff plan builder</summary>
                        <div class="lab-details-content lab-stack">
                            <div class="lab-inline-fields">
                                <div class="lab-field">
                                    <label>Plan name</label>
                                    <input type="text" data-draft-field="name" value="${escHtml(draft.name)}" placeholder="Example: Flat import / premium export">
                                </div>
                                <div class="lab-field">
                                    <label>Timezone</label>
                                    <input type="text" data-draft-field="timezone" value="${escHtml(draft.timezone)}">
                                </div>
                                <div class="lab-field">
                                    <label>Daily supply charge (cents)</label>
                                    <input type="number" data-draft-field="dailySupplyCharge" value="${escHtml(draft.dailySupplyCharge)}" min="0" step="0.1">
                                </div>
                            </div>
                            ${renderTariffWindowGroup('import', 'Import windows', draft.importWindows)}
                            ${renderTariffWindowGroup('export', 'Export windows', draft.exportWindows)}
                            <div class="lab-inline-actions">
                                <button type="button" class="btn btn-secondary" data-action="save-plan" ${state.savingTariffDraft ? 'disabled' : ''}>${state.savingTariffDraft ? 'Saving...' : 'Save plan'}</button>
                                <button type="button" class="btn btn-secondary" data-action="reset-plan-draft">Reset</button>
                            </div>
                        </div>
                    </details>
                ` : ''}
            </div>
        `;
    }

    function renderTariffWindowGroup(kind, title, windows) {
        return `
            <div class="lab-stack">
                <div class="lab-inline-actions" style="justify-content:space-between;">
                    <strong>${escHtml(title)}</strong>
                    <button type="button" class="btn btn-secondary" data-action="add-plan-window" data-kind="${kind}">Add window</button>
                </div>
                <div class="lab-plan-rows">
                    ${(windows || []).map((window, index) => `
                        <div class="lab-plan-row">
                            <div class="lab-field">
                                <label>Start</label>
                                <input type="time" data-window-kind="${kind}" data-window-index="${index}" data-window-field="startTime" value="${escHtml(window.startTime || '00:00')}">
                            </div>
                            <div class="lab-field">
                                <label>End</label>
                                <input type="time" data-window-kind="${kind}" data-window-index="${index}" data-window-field="endTime" value="${escHtml(window.endTime || '23:59')}">
                            </div>
                            <div class="lab-field">
                                <label>Rate (c/kWh)</label>
                                <input type="number" data-window-kind="${kind}" data-window-index="${index}" data-window-field="centsPerKwh" value="${escHtml(window.centsPerKwh || '')}" step="0.1">
                            </div>
                            <button type="button" class="btn btn-secondary" data-action="remove-plan-window" data-kind="${kind}" data-index="${index}">Remove</button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    function renderResultsColumn(run) {
        if (state.loading) {
            return `<section class="lab-card"><div class="lab-loading">Loading backtest surface...</div></section>`;
        }

        return `
            <section class="lab-card">
                <h3>Results</h3>
                <p class="lab-card-copy">Open the headline outcome first, then drill into rule mix, interval impact, and limitations only if you need them.</p>
                ${run ? renderActiveRun(run) : '<div class="lab-empty">Run a backtest to see headline savings, trade-offs, and confidence notes here.</div>'}
            </section>
            <section class="lab-card">
                <h3>Saved backtests</h3>
                <p class="lab-card-copy">Recent runs stay available in ROI as lightweight reports. Pick one here to inspect it again or continue into optimisation.</p>
                <div class="lab-run-list">
                    ${state.backtestRuns.length ? state.backtestRuns.map((entry) => renderRunCard(entry)).join('') : '<div class="lab-empty">No backtests saved yet.</div>'}
                </div>
            </section>
        `;
    }

    function renderActiveRun(run) {
        const summaries = selectedRunSummaries(run);
        const comparisons = Array.isArray(run?.result?.comparisons) ? run.result.comparisons : [];
        const limitations = Array.isArray(run?.result?.limitations || run?.limitations) ? (run.result?.limitations || run.limitations) : [];
        const confidence = run?.result?.confidence || run?.confidence || 'n/a';
        const completed = run.status === 'completed';
        const failed = run.status === 'failed';
        const running = run.status === 'queued' || run.status === 'running';

        return `
            <div class="lab-stack">
                <div class="lab-run-card active">
                    <strong>${escHtml(run.request?.period?.startDate || '')} to ${escHtml(run.request?.period?.endDate || '')}</strong>
                    <div class="lab-run-meta">Requested ${escHtml(formatDate(run.requestedAtMs))}</div>
                    <div class="lab-badges">
                        <span class="lab-badge"><span class="lab-status ${escHtml(run.status)}">${escHtml(run.status)}</span></span>
                        <span class="lab-badge">Confidence: ${escHtml(confidence)}</span>
                    </div>
                </div>
                ${failed ? `<div class="lab-message error">${escHtml(run.error || 'Backtest failed.')}</div>` : ''}
                ${running ? `<div class="lab-note">This run is still processing. Results update automatically every few seconds.</div>` : ''}
                ${completed ? `
                    <div class="lab-summary-grid">
                        ${summaries.map((summary) => renderSummaryCard(summary)).join('')}
                    </div>
                    ${comparisons.length ? `
                        <div class="lab-stack">
                            <strong>Side-by-side comparisons</strong>
                            <div class="lab-comparison-grid">
                                ${comparisons.map((comparison) => `
                                    <div class="lab-comparison-card">
                                        <div class="lab-comparison-title">${escHtml(comparison.leftScenarioName)} vs ${escHtml(comparison.rightScenarioName)}</div>
                                        <div class="lab-run-meta">Bill delta: ${formatSignedCurrency(-comparison.billDeltaAud)}</div>
                                        <div class="lab-run-meta">Import delta: ${formatSignedNumber(-comparison.importDeltaKWh, 3, ' kWh')}</div>
                                        <div class="lab-run-meta">Throughput delta: ${formatSignedNumber(-comparison.throughputDeltaKWh, 3, ' kWh')}</div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                    ${renderOptimizationPanel(run)}
                    <details class="lab-details">
                        <summary>Confidence and limitations</summary>
                        <div class="lab-details-content">
                            ${limitations.length ? `<div class="lab-limitation-list">${limitations.map((item) => `<div class="lab-note">${escHtml(item)}</div>`).join('')}</div>` : '<div class="lab-note">No additional limitations were recorded for this run.</div>'}
                        </div>
                    </details>
                ` : ''}
            </div>
        `;
    }

    function renderSummaryCard(summary) {
        const delta = summary.deltaVsBaseline?.billAud;
        const impact = summary.intervalImpact || null;
        return `
            <div class="lab-metric-card">
                <div class="lab-metric-title">${escHtml(summary.scenarioName)}</div>
                <div class="lab-metric-value ${Number(delta || 0) >= 0 ? 'good' : 'bad'}">${formatCurrency(summary.totalBillAud)}</div>
                <div class="lab-metric-meta">
                    ${summary.scenarioId === 'baseline' ? 'Passive self-use baseline' : `Delta vs baseline: ${delta === undefined ? 'n/a' : formatSignedCurrency(delta)}`}
                </div>
                <div class="lab-badges">
                    <span class="lab-badge">Import ${summary.importKWh.toFixed(3)} kWh</span>
                    <span class="lab-badge">Export ${summary.exportKWh.toFixed(3)} kWh</span>
                    <span class="lab-badge">Throughput ${summary.throughputKWh.toFixed(3)} kWh</span>
                    <span class="lab-badge">${summary.triggerCount} trigger${summary.triggerCount === 1 ? '' : 's'}</span>
                </div>
                ${impact ? `
                    <details class="lab-details" style="margin-top:12px;">
                        <summary>Trade-offs</summary>
                        <div class="lab-details-content">
                            <div class="lab-run-meta">Helped intervals: ${impact.helped}</div>
                            <div class="lab-run-meta">Neutral intervals: ${impact.neutral}</div>
                            <div class="lab-run-meta">Hurt intervals: ${impact.hurt}</div>
                            ${summary.winningRuleMix?.length ? `
                                <div class="lab-rule-list" style="margin-top:12px;">
                                    ${summary.winningRuleMix.slice(0, 4).map((entry) => `<div class="lab-note">${escHtml(entry.ruleName)} • ${entry.triggerCount} trigger(s)</div>`).join('')}
                                </div>
                            ` : ''}
                        </div>
                    </details>
                ` : ''}
            </div>
        `;
    }

    function renderOptimizationPanel(run) {
        const summaries = nonBaselineSummaries(run);
        return `
            <section class="lab-card" style="padding:0;border:none;box-shadow:none;background:transparent;">
                <h3>Explainable optimiser</h3>
                <p class="lab-card-copy">Use the completed backtest as the truth layer, then ask for bounded rule variants with explicit diffs and measured trade-offs.</p>
                ${state.optimizationError ? `<div class="lab-message error">${escHtml(state.optimizationError)}</div>` : ''}
                ${state.applyMessage ? `<div class="lab-message success">${escHtml(state.applyMessage)}</div>` : ''}
                <div class="lab-inline-fields">
                    <div class="lab-field">
                        <label>Source scenario</label>
                        <select data-field="optimizerScenarioId">
                            ${summaries.map((summary) => `<option value="${escHtml(summary.scenarioId)}" ${summary.scenarioId === state.optimizerScenarioId ? 'selected' : ''}>${escHtml(summary.scenarioName)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="lab-field">
                        <label>Goal</label>
                        <select data-field="optimizerGoal">
                            <option value="maximize_roi" ${state.optimizerGoal === 'maximize_roi' ? 'selected' : ''}>Maximise ROI</option>
                            <option value="protect_battery" ${state.optimizerGoal === 'protect_battery' ? 'selected' : ''}>Protect battery</option>
                            <option value="reduce_import" ${state.optimizerGoal === 'reduce_import' ? 'selected' : ''}>Reduce import</option>
                            <option value="increase_export" ${state.optimizerGoal === 'increase_export' ? 'selected' : ''}>Increase export</option>
                            <option value="balanced" ${state.optimizerGoal === 'balanced' ? 'selected' : ''}>Balanced</option>
                        </select>
                    </div>
                    <div class="lab-inline-actions">
                        <button type="button" class="btn btn-primary" data-action="run-optimizer" ${state.optimizerBusy ? 'disabled' : ''}>${state.optimizerBusy ? 'Optimising...' : 'Suggest variants'}</button>
                    </div>
                </div>
                ${renderOptimizationRun()}
            </section>
        `;
    }

    function renderOptimizationRun() {
        const run = state.optimizationRun;
        if (!run) return '<div class="lab-note" style="margin-top:14px;">No optimiser run yet. Choose a goal and we will test bounded variants against the selected backtest.</div>';
        if (run.status === 'queued' || run.status === 'running') return '<div class="lab-note" style="margin-top:14px;">Optimiser is testing candidate variants now. This updates automatically.</div>';
        if (run.status === 'failed') return `<div class="lab-message error" style="margin-top:14px;">${escHtml(run.error || 'Optimiser failed.')}</div>`;
        const variants = Array.isArray(run.result?.variants) ? run.result.variants : [];
        if (!variants.length) return '<div class="lab-note" style="margin-top:14px;">No useful variants beat the source scenario for that goal.</div>';
        return `
            <div class="lab-variant-grid" style="margin-top:14px;">
                ${variants.map((variant) => `
                    <div class="lab-variant-card">
                        <div class="lab-variant-title">${escHtml(variant.name)}</div>
                        <div class="lab-variant-copy">Improvement: ${variant.billImprovementAud === null ? 'n/a' : formatSignedCurrency(variant.billImprovementAud)}</div>
                        <div class="lab-badges">
                            <span class="lab-badge">Bill ${formatCurrency(variant.summary.totalBillAud)}</span>
                            <span class="lab-badge">Throughput ${variant.summary.throughputKWh.toFixed(3)} kWh</span>
                            <span class="lab-badge">Import ${variant.summary.importKWh.toFixed(3)} kWh</span>
                        </div>
                        <div class="lab-rule-list" style="margin-top:12px;">
                            ${(variant.diffSummary || []).map((item) => `<div class="lab-note">${escHtml(item)}</div>`).join('')}
                        </div>
                        <div class="lab-variant-actions">
                            <button type="button" class="btn btn-primary" data-action="apply-variant" data-run-id="${escHtml(run.id)}" data-variant-id="${escHtml(variant.id)}">Apply variant</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function renderRunCard(entry) {
        return `
            <button type="button" class="lab-run-card ${entry.id === state.selectedRunId ? 'active' : ''}" data-action="select-run" data-run-id="${escHtml(entry.id)}">
                <strong>${escHtml(periodLabel(entry.request?.period || {}))}</strong>
                <div class="lab-run-meta">Requested ${escHtml(formatDate(entry.requestedAtMs))}</div>
                <div class="lab-badges">
                    <span class="lab-badge"><span class="lab-status ${escHtml(entry.status)}">${escHtml(entry.status)}</span></span>
                    <span class="lab-badge">Mode: ${escHtml(entry.request?.comparisonMode || 'side_by_side')}</span>
                </div>
            </button>
        `;
    }

    async function refreshBacktestRuns() {
        const response = await window.apiClient.listBacktestRuns(12);
        state.backtestRuns = Array.isArray(response?.result) ? response.result : [];
        if (state.selectedRunId) {
            const selected = state.backtestRuns.find((entry) => entry.id === state.selectedRunId);
            if (selected) state.activeRun = selected;
        }
    }

    async function runBacktest() {
        const preview = buildPayloadPreview();
        if (preview.error) {
            state.backtestError = preview.error;
            render();
            return;
        }
        state.backtestError = '';
        state.optimizationRun = null;
        state.optimizationError = '';
        state.applyMessage = '';
        state.runningBacktest = true;
        state.view = 'results';
        render();
        try {
            const response = await window.apiClient.createBacktestRun(preview.payload);
            if (response?.errno !== 0 || !response?.result?.id) throw new Error(response?.error || 'Backtest run could not be created.');
            state.selectedRunId = response.result.id;
            state.activeRun = response.result;
            state.backtestRuns = [response.result].concat(state.backtestRuns.filter((entry) => entry.id !== response.result.id));
            startBacktestPolling(response.result.id);
        } catch (error) {
            state.backtestError = error?.message || 'Backtest run could not be created.';
        } finally {
            state.runningBacktest = false;
            render();
        }
    }

    function stopBacktestPolling() {
        if (backtestPollTimer) {
            clearTimeout(backtestPollTimer);
            backtestPollTimer = null;
        }
    }

    function startBacktestPolling(runId) {
        stopBacktestPolling();
        const tick = async () => {
            try {
                const response = await window.apiClient.getBacktestRun(runId);
                if (response?.errno === 0 && response?.result) {
                    state.activeRun = response.result;
                    state.selectedRunId = response.result.id;
                    syncOptimizerScenario(state.activeRun);
                    await refreshBacktestRuns();
                    render();
                    if (response.result.status === 'queued' || response.result.status === 'running') {
                        backtestPollTimer = setTimeout(tick, BACKTEST_POLL_MS);
                        return;
                    }
                }
            } catch (error) {
                console.warn('[Automation Lab] Backtest polling failed', error);
            }
            stopBacktestPolling();
        };
        backtestPollTimer = setTimeout(tick, BACKTEST_POLL_MS);
    }

    async function selectRun(runId) {
        state.selectedRunId = runId;
        state.optimizationRun = null;
        state.optimizationError = '';
        state.applyMessage = '';
        render();
        try {
            const response = await window.apiClient.getBacktestRun(runId);
            if (response?.errno === 0 && response?.result) {
                state.activeRun = response.result;
                syncOptimizerScenario(state.activeRun);
                if (response.result.status === 'queued' || response.result.status === 'running') {
                    startBacktestPolling(runId);
                }
            }
        } catch (error) {
            state.backtestError = error?.message || 'Could not load that backtest run.';
        }
        render();
    }

    function normalizeDraftWindow(window) {
        const cents = Number(window?.centsPerKwh);
        if (!window?.startTime || !window?.endTime || !Number.isFinite(cents)) return null;
        return {
            startTime: window.startTime,
            endTime: window.endTime,
            centsPerKwh: cents
        };
    }

    async function saveTariffPlan() {
        const draft = state.tariffDraft || createTariffDraft(state.currentTimezone);
        state.savingTariffDraft = true;
        state.tariffDraftMessage = '';
        render();
        try {
            const payload = {
                name: draft.name,
                timezone: draft.timezone,
                dailySupplyCharge: Number(draft.dailySupplyCharge || 0),
                importWindows: draft.importWindows.map(normalizeDraftWindow).filter(Boolean),
                exportWindows: draft.exportWindows.map(normalizeDraftWindow).filter(Boolean)
            };
            if (!payload.name) throw new Error('Plan name is required.');
            if (!payload.importWindows.length) throw new Error('At least one import window is required.');
            const response = await window.apiClient.createBacktestTariffPlan(payload);
            if (response?.errno !== 0 || !response?.result?.id) throw new Error(response?.error || 'Plan could not be saved.');
            state.tariffDraftMessage = `Saved ${response.result.name}.`;
            state.tariffDraftOpen = false;
            state.tariffDraft = createTariffDraft(state.currentTimezone);
            const plans = await window.apiClient.listBacktestTariffPlans();
            state.tariffPlans = Array.isArray(plans?.result) ? plans.result : [];
            state.selectedPlanId = response.result.id;
        } catch (error) {
            state.tariffDraftMessage = error?.message || 'Plan could not be saved.';
        } finally {
            state.savingTariffDraft = false;
            render();
        }
    }

    async function deleteTariffPlan(planId) {
        try {
            const response = await window.apiClient.deleteBacktestTariffPlan(planId);
            if (response?.errno !== 0) throw new Error(response?.error || 'Plan could not be deleted.');
            const plans = await window.apiClient.listBacktestTariffPlans();
            state.tariffPlans = Array.isArray(plans?.result) ? plans.result : [];
            if (String(state.selectedPlanId) === String(planId)) state.selectedPlanId = state.tariffPlans[0]?.id || '';
            state.tariffDraftMessage = 'Plan deleted.';
        } catch (error) {
            state.tariffDraftMessage = error?.message || 'Plan could not be deleted.';
        }
        render();
    }

    async function runOptimizer() {
        if (!state.activeRun?.id || !state.optimizerScenarioId) return;
        state.optimizerBusy = true;
        state.optimizationError = '';
        state.applyMessage = '';
        render();
        try {
            const response = await window.apiClient.createOptimizationRun({
                backtestRunId: state.activeRun.id,
                goal: state.optimizerGoal,
                sourceScenarioId: state.optimizerScenarioId
            });
            if (response?.errno !== 0 || !response?.result?.id) throw new Error(response?.error || 'Optimizer could not start.');
            state.optimizationRun = response.result;
            startOptimizationPolling(response.result.id);
        } catch (error) {
            state.optimizationError = error?.message || 'Optimizer could not start.';
        } finally {
            state.optimizerBusy = false;
            render();
        }
    }

    function stopOptimizationPolling() {
        if (optimizationPollTimer) {
            clearTimeout(optimizationPollTimer);
            optimizationPollTimer = null;
        }
    }

    function startOptimizationPolling(runId) {
        stopOptimizationPolling();
        const tick = async () => {
            try {
                const response = await window.apiClient.getOptimizationRun(runId);
                if (response?.errno === 0 && response?.result) {
                    state.optimizationRun = response.result;
                    render();
                    if (response.result.status === 'queued' || response.result.status === 'running') {
                        optimizationPollTimer = setTimeout(tick, OPTIMIZATION_POLL_MS);
                        return;
                    }
                }
            } catch (error) {
                console.warn('[Automation Lab] Optimization polling failed', error);
            }
            stopOptimizationPolling();
        };
        optimizationPollTimer = setTimeout(tick, OPTIMIZATION_POLL_MS);
    }

    async function applyVariant(runId, variantId) {
        state.applyMessage = '';
        state.optimizationError = '';
        render();
        try {
            const response = await window.apiClient.applyOptimizationVariant(runId, variantId, true);
            if (response?.errno !== 0) throw new Error(response?.error || 'Variant could not be applied.');
            state.applyMessage = 'Variant applied. Your live rules have been replaced with the selected version.';
            const statusResponse = await window.apiClient.getAutomationStatus();
            state.currentRulesSnapshot = {
                source: 'current',
                name: 'Current rules',
                rules: deepClone(statusResponse?.result?.rules || {})
            };
        } catch (error) {
            state.optimizationError = error?.message || 'Variant could not be applied.';
        }
        render();
    }

    function clearCandidate() {
        localStorage.removeItem(CANDIDATE_STORAGE_KEY);
        state.candidateSnapshot = null;
        state.compareMode = 'current_vs_baseline';
        render();
    }

    function updateDraftWindow(kind, index, field, value) {
        const draft = state.tariffDraft || createTariffDraft(state.currentTimezone);
        const key = kind === 'import' ? 'importWindows' : 'exportWindows';
        draft[key][index][field] = value;
        state.tariffDraft = draft;
    }

    function handleClick(event) {
        const actionEl = event.target.closest('[data-action]');
        if (!actionEl) return;
        const action = actionEl.dataset.action;
        if (action === 'set-compare-mode') {
            state.compareMode = actionEl.dataset.mode;
            render();
        } else if (action === 'set-period-preset') {
            state.periodPreset = actionEl.dataset.preset;
            if (state.periodPreset === 'custom' && !state.customStartDate) {
                state.customStartDate = getDateDaysAgo(29);
                state.customEndDate = getTodayDateOnly();
            }
            render();
        } else if (action === 'run-backtest') {
            runBacktest();
        } else if (action === 'select-run') {
            selectRun(actionEl.dataset.runId);
        } else if (action === 'switch-view') {
            state.view = actionEl.dataset.view || 'setup';
            render();
        } else if (action === 'toggle-tariff-draft') {
            state.tariffDraftOpen = !state.tariffDraftOpen;
            render();
        } else if (action === 'add-plan-window') {
            const key = actionEl.dataset.kind === 'import' ? 'importWindows' : 'exportWindows';
            state.tariffDraft[key].push({ startTime: '00:00', endTime: '23:59', centsPerKwh: '' });
            render();
        } else if (action === 'remove-plan-window') {
            const key = actionEl.dataset.kind === 'import' ? 'importWindows' : 'exportWindows';
            state.tariffDraft[key].splice(Number(actionEl.dataset.index), 1);
            render();
        } else if (action === 'save-plan') {
            saveTariffPlan();
        } else if (action === 'reset-plan-draft') {
            state.tariffDraft = createTariffDraft(state.currentTimezone);
            state.tariffDraftMessage = '';
            render();
        } else if (action === 'delete-plan') {
            deleteTariffPlan(actionEl.dataset.planId);
        } else if (action === 'run-optimizer') {
            runOptimizer();
        } else if (action === 'apply-variant') {
            applyVariant(actionEl.dataset.runId, actionEl.dataset.variantId);
        } else if (action === 'clear-candidate') {
            clearCandidate();
        }
    }

    function handleChange(event) {
        const field = event.target.dataset.field;
        if (field) {
            state[field] = event.target.value;
            render();
            return;
        }
        const draftField = event.target.dataset.draftField;
        if (draftField) {
            state.tariffDraft[draftField] = event.target.value;
            render();
            return;
        }
        if (event.target.dataset.windowField) {
            updateDraftWindow(
                event.target.dataset.windowKind,
                Number(event.target.dataset.windowIndex),
                event.target.dataset.windowField,
                event.target.value
            );
        }
    }

    document.addEventListener('DOMContentLoaded', async () => {
        if (state.bootstrapped) return;
        state.bootstrapped = true;
        injectStyles();
        state.tariffDraft = createTariffDraft(state.currentTimezone);
        loadInitialData();
    });
})();
