(() => {
    const CANDIDATE_STORAGE_KEY = 'automationLabCandidateSnapshot';
    const MODE_STORAGE_KEY = 'automationLabMode';
    const BACKTEST_POLL_MS = 3000;
    const OPTIMIZATION_POLL_MS = 3500;
    const MAX_BACKTEST_DAYS = 90;
    const MAX_BACKTEST_HISTORY = 5;
    const BACKTEST_HISTORY_FETCH_LIMIT = 50;
    const rootId = 'automationLabWorkbench';
    const state = {
        loading: true,
        bootstrapped: false,
        requestedLabMode: readRequestedLabMode(),
        labMode: getInitialLabMode(),
        isAdmin: false,
        adminAccessResolved: false,
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
    let shellMetaHost = null;
    let shellTabsHost = null;
    let backtestHost = null;
    let quickModeHost = null;
    let backtestPollTimer = null;
    let optimizationPollTimer = null;
    let uiBound = false;

    function deepClone(value) {
        return JSON.parse(JSON.stringify(value || null));
    }

    function readRequestedLabMode() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            const paramMode = String(params.get('mode') || '').trim().toLowerCase();
            if (paramMode === 'quick' || paramMode === 'backtest') return paramMode;
        } catch (error) {}

        try {
            const storedMode = String(localStorage.getItem(MODE_STORAGE_KEY) || '').trim().toLowerCase();
            if (storedMode === 'quick' || storedMode === 'backtest') return storedMode;
        } catch (error) {}

        return 'backtest';
    }

    function getKnownAdminState() {
        try {
            if (window.AppShell && typeof window.AppShell.getIsAdmin === 'function') {
                const isAdmin = window.AppShell.getIsAdmin();
                if (typeof isAdmin === 'boolean') return isAdmin;
            }
        } catch (error) {}

        return null;
    }

    function getInitialLabMode() {
        const requestedMode = readRequestedLabMode();
        return requestedMode === 'backtest' && getKnownAdminState() !== true ? 'quick' : requestedMode;
    }

    function persistLabMode(mode) {
        try {
            localStorage.setItem(MODE_STORAGE_KEY, mode);
        } catch (error) {}
    }

    function canAccessBacktestMode() {
        return state.isAdmin === true;
    }

    function getBacktestAccessState() {
        if (!state.adminAccessResolved) return 'checking';
        return canAccessBacktestMode() ? 'enabled' : 'restricted';
    }

    function setLabMode(mode, options = {}) {
        const { persist = true, remember = true } = options;
        const requestedMode = mode === 'quick' ? 'quick' : 'backtest';
        if (remember) state.requestedLabMode = requestedMode;
        const nextMode = requestedMode === 'backtest' && !canAccessBacktestMode() ? 'quick' : requestedMode;
        state.labMode = nextMode;
        if (persist) persistLabMode(requestedMode);
        return nextMode;
    }

    async function resolveAdminAccess() {
        const knownAdmin = getKnownAdminState();
        if (typeof knownAdmin === 'boolean') return knownAdmin;

        try {
            const response = await window.apiClient.checkAdminAccess();
            return response?.errno === 0 && response?.result?.isAdmin === true;
        } catch (error) {
            return false;
        }
    }

    function injectStyles() {
        if (document.getElementById('automationLabWorkbenchStyles')) return;
        const style = document.createElement('style');
        style.id = 'automationLabWorkbenchStyles';
        style.textContent = `
            .lab-workbench { margin: 0 0 20px; position: relative; z-index: 2; }
            .lab-mode-shell { display: grid; gap: 18px; }
            .lab-mode-head { display: grid; gap: 18px; grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr); padding: 22px; border-radius: 22px; border: 1px solid rgba(148, 163, 184, 0.16); background: radial-gradient(circle at top left, rgba(14, 165, 233, 0.18), transparent 42%), linear-gradient(145deg, rgba(15, 23, 42, 0.92), rgba(8, 47, 73, 0.88)); box-shadow: 0 24px 56px rgba(2, 6, 23, 0.28); overflow: hidden; }
            .lab-mode-copy { min-width: 0; }
            .lab-mode-kicker { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; background: rgba(15, 23, 42, 0.45); border: 1px solid rgba(148, 163, 184, 0.18); color: #cbd5e1; font-size: 0.78rem; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700; margin-bottom: 14px; }
            .lab-mode-title { margin: 0 0 10px; font-size: clamp(1.7rem, 3vw, 2.6rem); line-height: 1.02; color: #f8fafc; }
            .lab-mode-copy p { margin: 0; color: rgba(226, 232, 240, 0.86); line-height: 1.65; font-size: 1rem; max-width: 720px; }
            .lab-mode-stats { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
            .lab-mode-stat { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 999px; background: rgba(15, 23, 42, 0.38); border: 1px solid rgba(148, 163, 184, 0.16); color: #e2e8f0; font-size: 0.84rem; font-weight: 600; }
            .lab-mode-tabs { display: grid; gap: 12px; align-content: start; }
            .lab-mode-tab { text-align: left; display: grid; gap: 6px; padding: 16px; border-radius: 18px; border: 1px solid rgba(148, 163, 184, 0.18); background: rgba(15, 23, 42, 0.35); color: #cbd5e1; cursor: pointer; transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease; }
            .lab-mode-tab:not(:disabled):hover { transform: translateY(-1px); border-color: rgba(125, 211, 252, 0.42); }
            .lab-mode-tab.active { background: linear-gradient(145deg, rgba(14, 165, 233, 0.18), rgba(16, 185, 129, 0.14)); border-color: rgba(125, 211, 252, 0.56); box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.14); color: #f8fafc; }
            .lab-mode-tab:disabled { cursor: not-allowed; opacity: 0.76; transform: none; box-shadow: none; }
            .lab-mode-tab:disabled.active { box-shadow: none; }
            .lab-mode-tab-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
            .lab-mode-tab-badges { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
            .lab-mode-tab-label { display: block; font-size: 1rem; font-weight: 800; }
            .lab-mode-tab-copy { display: block; font-size: 0.88rem; line-height: 1.55; color: inherit; opacity: 0.9; }
            .lab-mode-tab-note { display: block; font-size: 0.78rem; line-height: 1.45; color: rgba(226, 232, 240, 0.74); }
            .lab-mode-panel { display: block; }
            .lab-mode-panel.hidden { display: none; }
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
            .lab-run-card { cursor: pointer; width: 100%; text-align: left; color: var(--text-primary); font: inherit; appearance: none; }
            .lab-run-card.active { border-color: rgba(16, 185, 129, 0.54); box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12); }
            .lab-run-card strong { color: var(--text-primary); }
            .lab-run-history-item { display: grid; gap: 8px; }
            .lab-run-history-actions { display: flex; justify-content: flex-end; }
            .lab-badge { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 5px 9px; background: rgba(15, 23, 42, 0.36); border: 1px solid rgba(148, 163, 184, 0.16); font-size: 0.76rem; color: var(--text-secondary); }
            .lab-badge-testing { background: rgba(245, 158, 11, 0.16); border-color: rgba(245, 158, 11, 0.28); color: #fde68a; }
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
            .lab-quick-shell { display: grid; gap: 18px; }

            [data-theme="light"] .lab-mode-head { border-color: rgba(208, 215, 222, 0.96); background: radial-gradient(circle at top left, rgba(14, 165, 233, 0.14), transparent 42%), linear-gradient(145deg, rgba(248, 250, 252, 0.98), rgba(226, 239, 255, 0.94)); box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08); }
            [data-theme="light"] .lab-mode-kicker { background: rgba(255, 255, 255, 0.82); border-color: rgba(9, 105, 218, 0.16); color: #155a9c; }
            [data-theme="light"] .lab-mode-title { color: #0f172a; }
            [data-theme="light"] .lab-mode-copy p { color: #475569; }
            [data-theme="light"] .lab-mode-stat { background: rgba(255, 255, 255, 0.84); border-color: rgba(9, 105, 218, 0.14); color: #1e293b; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8); }
            [data-theme="light"] .lab-mode-tab { background: rgba(255, 255, 255, 0.88); border-color: rgba(208, 215, 222, 0.96); color: #475569; box-shadow: 0 8px 20px rgba(148, 163, 184, 0.08); }
            [data-theme="light"] .lab-mode-tab:not(:disabled):hover { border-color: rgba(9, 105, 218, 0.4); box-shadow: 0 12px 24px rgba(15, 23, 42, 0.08); }
            [data-theme="light"] .lab-mode-tab.active { background: linear-gradient(145deg, rgba(14, 165, 233, 0.14), rgba(16, 185, 129, 0.12)); border-color: rgba(9, 105, 218, 0.44); box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.12), 0 14px 28px rgba(15, 23, 42, 0.08); color: #0f172a; }
            [data-theme="light"] .lab-mode-tab-note { color: #64748b; }
            [data-theme="light"] .lab-hero { background: radial-gradient(circle at top left, rgba(16, 185, 129, 0.1), transparent 42%), linear-gradient(135deg, rgba(224, 247, 242, 0.95), rgba(239, 246, 255, 0.98)), var(--bg-card); border-color: rgba(14, 165, 233, 0.2); box-shadow: 0 14px 32px rgba(15, 23, 42, 0.08); }
            [data-theme="light"] .lab-eyebrow { background: rgba(255, 255, 255, 0.8); border-color: rgba(9, 105, 218, 0.16); color: #475569; }
            [data-theme="light"] .lab-badge { background: rgba(255, 255, 255, 0.84); border-color: rgba(208, 215, 222, 0.96); color: #475569; }
            [data-theme="light"] .lab-badge-testing { background: rgba(245, 158, 11, 0.12); border-color: rgba(245, 158, 11, 0.28); color: #92400e; }
            [data-theme="light"] .lab-choice.active { background: linear-gradient(145deg, rgba(16, 185, 129, 0.1), rgba(14, 165, 233, 0.08)); }
            [data-theme="light"] .lab-message.error { background: rgba(239, 68, 68, 0.08); border-color: rgba(239, 68, 68, 0.18); color: #991b1b; }
            [data-theme="light"] .lab-message.success { background: rgba(16, 185, 129, 0.08); border-color: rgba(16, 185, 129, 0.18); color: #065f46; }
            [data-theme="light"] .lab-status.completed, [data-theme="light"] .lab-metric-value.good, [data-theme="light"] .lab-delta-amount.good { color: #15803d; }
            [data-theme="light"] .lab-status.running, [data-theme="light"] .lab-status.queued { color: #1d4ed8; }
            [data-theme="light"] .lab-status.failed, [data-theme="light"] .lab-metric-value.bad, [data-theme="light"] .lab-delta-amount.bad { color: #b91c1c; }

            /* ── Visual result enhancements ── */
            .lab-delta-hero { display: flex; align-items: center; gap: 10px; margin: 10px 0 6px; }
            .lab-delta-arrow { font-size: 1.6rem; line-height: 1; }
            .lab-delta-amount { font-size: 1.5rem; font-weight: 800; }
            .lab-delta-amount.good { color: #86efac; }
            .lab-delta-amount.bad { color: #fca5a5; }
            .lab-delta-amount.neutral { color: var(--text-secondary); }
            .lab-delta-label { font-size: 0.82rem; color: var(--text-secondary); }
            .lab-report-chart { margin-top: 14px; padding: 14px; border-radius: 14px; border: 1px solid rgba(148, 163, 184, 0.14); background: color-mix(in srgb, var(--bg-card) 86%, transparent); }
            .lab-report-chart-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
            .lab-report-chart-title { font-size: 0.84rem; font-weight: 800; color: var(--text-primary); }
            .lab-report-chart-copy { margin-top: 4px; font-size: 0.76rem; color: var(--text-secondary); line-height: 1.45; }
            .lab-report-chart-stats { display: flex; flex-wrap: wrap; gap: 8px; }
            .lab-report-chart-legend { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; font-size: 0.74rem; color: var(--text-secondary); }
            .lab-chart-key { display: inline-flex; align-items: center; gap: 6px; }
            .lab-chart-swatch { width: 10px; height: 10px; border-radius: 999px; display: inline-block; flex-shrink: 0; }
            .lab-chart-pill { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 5px 9px; background: rgba(15, 23, 42, 0.3); border: 1px solid rgba(148, 163, 184, 0.16); font-size: 0.74rem; color: var(--text-secondary); }
            .lab-report-chart svg { width: 100%; height: auto; display: block; overflow: visible; }

            .lab-impact-bar { display: flex; height: 10px; border-radius: 6px; overflow: hidden; margin: 10px 0 6px; background: rgba(148, 163, 184, 0.1); }
            .lab-impact-bar .helped { background: #86efac; }
            .lab-impact-bar .hurt { background: #fca5a5; }
            .lab-impact-bar .neutral-bar { background: rgba(148, 163, 184, 0.25); }
            .lab-impact-legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 0.78rem; color: var(--text-secondary); }
            .lab-impact-legend span { display: inline-flex; align-items: center; gap: 5px; }
            .lab-impact-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
            .lab-impact-dot.helped { background: #86efac; }
            .lab-impact-dot.hurt { background: #fca5a5; }
            .lab-impact-dot.neutral-bar { background: rgba(148, 163, 184, 0.4); }

            .lab-rule-bar-row { display: flex; align-items: center; gap: 10px; font-size: 0.82rem; }
            .lab-rule-bar-label { min-width: 120px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); font-weight: 600; }
            .lab-rule-bar-track { flex: 1; height: 8px; border-radius: 4px; background: rgba(148, 163, 184, 0.1); overflow: hidden; }
            .lab-rule-bar-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg, rgba(56, 189, 248, 0.7), rgba(16, 185, 129, 0.7)); transition: width 0.4s ease; }
            .lab-rule-bar-count { min-width: 48px; text-align: right; color: var(--text-secondary); font-weight: 600; font-size: 0.78rem; }

            .lab-metric-row { display: flex; justify-content: space-between; align-items: baseline; padding: 8px 0; border-bottom: 1px solid rgba(148, 163, 184, 0.08); }
            .lab-metric-row:last-child { border-bottom: none; }
            .lab-metric-label { font-size: 0.82rem; color: var(--text-secondary); }
            .lab-metric-number { font-weight: 700; font-size: 0.92rem; }

            .lab-explainer { padding: 14px; border-radius: 14px; background: rgba(59, 130, 246, 0.06); border: 1px solid rgba(59, 130, 246, 0.14); margin-bottom: 14px; }
            .lab-explainer-title { font-weight: 700; font-size: 0.88rem; margin-bottom: 8px; color: var(--text-primary); display: flex; align-items: center; gap: 8px; }
            .lab-explainer-body { color: var(--text-secondary); font-size: 0.84rem; line-height: 1.6; }
            .lab-explainer-body ul { margin: 6px 0 0; padding-left: 18px; }
            .lab-explainer-body li { margin-bottom: 4px; }

            .lab-comparison-visual { display: grid; gap: 8px; margin-top: 10px; }
            .lab-comparison-metric { display: grid; grid-template-columns: 90px 1fr 64px; gap: 8px; align-items: center; font-size: 0.82rem; }
            .lab-comparison-bar-track { height: 8px; border-radius: 4px; background: rgba(148, 163, 184, 0.1); position: relative; overflow: hidden; }
            .lab-comparison-bar-fill { position: absolute; top: 0; height: 100%; border-radius: 4px; }
            .lab-comparison-bar-fill.good { background: linear-gradient(90deg, rgba(16, 185, 129, 0.5), rgba(16, 185, 129, 0.8)); }
            .lab-comparison-bar-fill.bad { background: linear-gradient(90deg, rgba(239, 68, 68, 0.5), rgba(239, 68, 68, 0.8)); }

            .lab-progress-pulse { display: flex; align-items: center; gap: 10px; padding: 16px; border-radius: 12px; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.18); }
            .lab-progress-dot { width: 10px; height: 10px; border-radius: 50%; background: #38bdf8; animation: labPulse 1.2s ease-in-out infinite; }
            @keyframes labPulse { 0%,100% { opacity: 0.4; transform: scale(0.9); } 50% { opacity: 1; transform: scale(1.1); } }
            .lab-progress-text { font-size: 0.88rem; color: var(--text-secondary); }

            .lab-faq-card { background: var(--bg-secondary); border: 1px solid rgba(148, 163, 184, 0.14); border-radius: 14px; overflow: hidden; }
            .lab-faq-q { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; cursor: pointer; font-weight: 700; font-size: 0.86rem; }
            .lab-faq-q:hover { background: rgba(148, 163, 184, 0.06); }
            .lab-faq-a { display: none; padding: 0 14px 14px; font-size: 0.84rem; line-height: 1.6; color: var(--text-secondary); }
            .lab-faq-card.open .lab-faq-a { display: block; }
            .lab-faq-chevron { transition: transform 0.2s; font-size: 0.7rem; }
            .lab-faq-card.open .lab-faq-chevron { transform: rotate(180deg); }

            .lab-highlight-row { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: center; padding: 6px 0; font-size: 0.82rem; border-bottom: 1px solid rgba(148, 163, 184, 0.06); }
            .lab-highlight-row:last-child { border-bottom: none; }

            @media (max-width: 960px) { .lab-mode-head, .lab-summary-bar, .lab-columns { grid-template-columns: 1fr; } .lab-view-toggle { display: flex; } .lab-panel.lab-mobile-hidden { display: none; } .lab-summary-bar { top: 68px; } .lab-summary-bar { grid-template-columns: repeat(2, 1fr); } }
            @media (max-width: 720px) { .lab-mode-head, .lab-hero, .lab-card { padding: 16px; } .lab-plan-row { grid-template-columns: 1fr; } .lab-mode-tabs { grid-template-columns: 1fr; } .lab-summary-bar { top: auto; bottom: 12px; left: 0; right: 0; position: fixed; margin: 0 12px; box-shadow: 0 20px 32px rgba(0, 0, 0, 0.25); grid-template-columns: repeat(2, 1fr); } .lab-shell, .lab-quick-shell { padding-bottom: 116px; } .lab-comparison-metric { grid-template-columns: 70px 1fr 56px; } .lab-rule-bar-label { min-width: 80px; max-width: 100px; } .lab-choice-grid { grid-template-columns: 1fr; } }
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

    function toFiniteNumber(value, fallback = 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function clampNumber(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function historyLimitReached() {
        return state.backtestRuns.length >= MAX_BACKTEST_HISTORY;
    }

    function canDeleteRun(entry) {
        return !!entry && entry.status !== 'queued' && entry.status !== 'running';
    }

    function buildSvgLinePath(points, getX, getY) {
        return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${getX(point, index).toFixed(2)} ${getY(point, index).toFixed(2)}`).join(' ');
    }

    function buildSvgAreaPath(points, getX, getY, baselineY) {
        if (!points.length) return '';
        const firstX = getX(points[0], 0);
        const lastX = getX(points[points.length - 1], points.length - 1);
        return `M ${firstX.toFixed(2)} ${baselineY.toFixed(2)} ${points.map((point, index) => `L ${getX(point, index).toFixed(2)} ${getY(point, index).toFixed(2)}`).join(' ')} L ${lastX.toFixed(2)} ${baselineY.toFixed(2)} Z`;
    }

    function formatChartTick(timestampMs, spanMs) {
        const options = spanMs <= (3 * 24 * 60 * 60 * 1000)
            ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
            : { month: 'short', day: 'numeric' };
        return new Date(timestampMs).toLocaleString('en-AU', options);
    }

    function getTodayDateOnly() {
        return new Date().toISOString().slice(0, 10);
    }

    function getDateDaysAgo(days) {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() - Math.max(0, Number(days || 0)));
        return date.toISOString().slice(0, 10);
    }

    function getOldestBacktestStartDate() {
        return getDateDaysAgo(MAX_BACKTEST_DAYS - 1);
    }

    function getInclusiveDayCount(startDate, endDate) {
        const startMs = Date.parse(`${startDate}T00:00:00Z`);
        const endMs = Date.parse(`${endDate}T00:00:00Z`);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return NaN;
        return Math.floor((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1;
    }

    function getSelectedPeriod() {
        if (state.periodPreset === 'custom') {
            return { startDate: state.customStartDate, endDate: state.customEndDate };
        }
        const days = Number(state.periodPreset || 90);
        return { startDate: getDateDaysAgo(days - 1), endDate: getTodayDateOnly() };
    }

    function validateSelectedPeriod(period) {
        if (!period.startDate || !period.endDate) {
            return 'Choose a valid period before running a backtest.';
        }
        if (period.endDate < period.startDate) {
            return 'End date must be on or after start date.';
        }
        const today = getTodayDateOnly();
        if (period.startDate > today || period.endDate > today) {
            return 'Backtests cannot include future dates.';
        }
        if (period.startDate < getOldestBacktestStartDate()) {
            return `Backtests are limited to the last ${MAX_BACKTEST_DAYS} days.`;
        }
        const periodDays = getInclusiveDayCount(period.startDate, period.endDate);
        if (!Number.isFinite(periodDays)) {
            return 'Choose a valid period before running a backtest.';
        }
        if (periodDays > MAX_BACKTEST_DAYS) {
            return `Backtest periods cannot exceed ${MAX_BACKTEST_DAYS} days.`;
        }
        return '';
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

    function isForecastTemperatureType(type) {
        const normalized = String(type || '').trim().toLowerCase();
        return normalized === 'forecastmax'
            || normalized === 'forecast_max'
            || normalized === 'dailymax'
            || normalized === 'daily_max'
            || normalized === 'forecastmin'
            || normalized === 'forecast_min'
            || normalized === 'dailymin'
            || normalized === 'daily_min';
    }

    function collectUnsupportedRuleIssues(ruleSetSnapshot) {
        const issues = [];
        Object.entries(ruleSetSnapshot?.rules || {}).forEach(([ruleId, rule]) => {
            if (!rule || rule.enabled === false) return;
            const conditions = rule.conditions || {};
            if (conditions.evVehicleSoC?.enabled || conditions.evVehicleLocation?.enabled || conditions.evChargingState?.enabled) {
                issues.push({
                    ruleId,
                    ruleName: String(rule.name || ruleId),
                    reason: 'EV conditions are not yet supported in backtesting (requires vehicle data history)'
                });
            }
            const temp = conditions.temp || conditions.temperature;
            const tempType = String(temp?.type || 'battery').trim().toLowerCase();
            if (temp?.enabled && !isForecastTemperatureType(tempType) && tempType === 'battery') {
                issues.push({
                    ruleId,
                    ruleName: String(rule.name || ruleId),
                    reason: 'Battery temperature history is not yet available for backtesting (only forecast and ambient temps are supported)'
                });
            }
            if (conditions.weather?.enabled) {
                issues.push({
                    ruleId,
                    ruleName: String(rule.name || ruleId),
                    reason: 'Legacy weather conditions have been replaced by solar radiation and cloud cover conditions'
                });
            }
        });
        return issues;
    }

    function buildPayloadPreview() {
        const period = getSelectedPeriod();
        const periodError = validateSelectedPeriod(period);
        if (periodError) return { error: periodError };

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

        const unsupported = scenarios.flatMap((scenario) => collectUnsupportedRuleIssues(scenario.ruleSetSnapshot)
            .map((entry) => ({ ...entry, scenarioName: scenario.name })));
        if (unsupported.length > 0) {
            return {
                error: `${unsupported[0].ruleName}: ${unsupported[0].reason}`,
                scenarios
            };
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
            state.isAdmin = await resolveAdminAccess();
            state.adminAccessResolved = true;
            setLabMode(state.requestedLabMode, { persist: false, remember: false });
            if (!canAccessBacktestMode()) {
                stopBacktestPolling();
                stopOptimizationPolling();
            }
            render();

            const [configResponse, statusResponse, tariffResponse, runsResponse] = await Promise.all([
                window.apiClient.getConfig(),
                window.apiClient.getAutomationStatus(),
                canAccessBacktestMode() ? window.apiClient.listBacktestTariffPlans() : Promise.resolve(null),
                canAccessBacktestMode() ? window.apiClient.listBacktestRuns(BACKTEST_HISTORY_FETCH_LIMIT) : Promise.resolve(null)
            ]);

            state.currentTimezone = configResponse?.result?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Sydney';
            state.currentRulesSnapshot = {
                source: 'current',
                name: 'Current rules',
                rules: deepClone(statusResponse?.result?.rules || {})
            };
            state.candidateSnapshot = loadCandidateSnapshot();
            if (state.candidateSnapshot && canAccessBacktestMode()) {
                setLabMode('backtest');
            }
            state.tariffPlans = canAccessBacktestMode() && Array.isArray(tariffResponse?.result) ? tariffResponse.result : [];
            if (!state.tariffDraft) state.tariffDraft = createTariffDraft(state.currentTimezone);
            if (!state.selectedPlanId && state.tariffPlans[0]) state.selectedPlanId = state.tariffPlans[0].id;

            state.backtestRuns = canAccessBacktestMode() && Array.isArray(runsResponse?.result) ? runsResponse.result : [];
            if (!canAccessBacktestMode()) {
                state.selectedPlanId = '';
                state.selectedRunId = '';
                state.activeRun = null;
                state.optimizationRun = null;
                state.optimizationError = '';
                state.applyMessage = '';
            } else if (!state.selectedRunId && state.backtestRuns[0]) {
                state.selectedRunId = state.backtestRuns[0].id;
                const initialRun = await window.apiClient.getBacktestRun(state.selectedRunId);
                state.activeRun = initialRun?.result || state.backtestRuns[0];
                syncOptimizerScenario(state.activeRun);
            }

            if (state.candidateSnapshot && getRuleCount(state.currentRulesSnapshot) > 0) {
                state.compareMode = 'current_vs_candidate';
            } else if (state.candidateSnapshot) {
                state.compareMode = 'candidate_vs_baseline';
            }

            if (canAccessBacktestMode() && state.activeRun && ['queued', 'running'].includes(state.activeRun.status)) {
                startBacktestPolling(state.activeRun.id);
            }
        } catch (error) {
            state.backtestError = error?.message || 'Failed to load Automation Lab data.';
        } finally {
            state.loading = false;
            render();
        }
    }

    function getModeDefinition(mode = state.labMode) {
        const currentRuleCount = getRuleCount(state.currentRulesSnapshot);
        const candidateRuleCount = getRuleCount(state.candidateSnapshot);
        if (mode === 'quick') {
            return {
                mode: 'quick',
                title: 'Quick Simulation',
                copy: 'Model one decision moment, inspect the winning rule, and preview the scheduler payload before anything goes live.',
                stats: [
                    `${currentRuleCount} live rule${currentRuleCount === 1 ? '' : 's'} ready`,
                    'Single-moment rule evaluation',
                    'Live conditions or mocked inputs'
                ]
            };
        }
        return {
            mode: 'backtest',
            title: 'Backtesting / Optimisation',
            copy: 'Replay weeks or months of history, compare tariffs or rule sets, then ask for explainable tuning suggestions backed by the same evidence.',
            stats: [
                `${candidateRuleCount ? `${candidateRuleCount} candidate rule${candidateRuleCount === 1 ? '' : 's'}` : 'Rules Library ready'}`,
                'Historical tariff comparison',
                'Explainable optimisation variants'
            ]
        };
    }

    function renderModeChrome() {
        const modeDefinition = getModeDefinition(state.labMode);
        const backtestAccessState = getBacktestAccessState();
        const backtestDisabled = backtestAccessState !== 'enabled';
        const backtestBadges = [
            '<span class="lab-badge lab-badge-testing">Testing</span>',
            backtestAccessState === 'restricted' ? '<span class="lab-badge">Admin only</span>' : ''
        ].filter(Boolean).join('');
        const backtestNote = backtestAccessState === 'restricted'
            ? '<span class="lab-mode-tab-note">Visible to everyone. Enabled for admins while this area is in testing.</span>'
            : '';
        const backtestTitle = backtestAccessState === 'restricted'
            ? 'Admins only while backtesting is in testing.'
            : backtestAccessState === 'checking'
                ? 'Checking admin access...'
                : 'Backtesting and optimisation';
        const navInfo = document.querySelector('.nav-info');
        if (navInfo) {
            navInfo.textContent = state.labMode === 'quick' ? 'Quick simulation' : 'Backtest mode';
        }
        if (shellMetaHost) {
            shellMetaHost.innerHTML = `
                <div class="lab-mode-kicker">Automation Lab</div>
                <h2 class="lab-mode-title">${escHtml(modeDefinition.title)}</h2>
                <p>${escHtml(modeDefinition.copy)}</p>
                <div class="lab-mode-stats">
                    ${modeDefinition.stats.map((item) => `<span class="lab-mode-stat">${escHtml(item)}</span>`).join('')}
                </div>
            `;
        }
        if (shellTabsHost) {
            shellTabsHost.innerHTML = `
                <button type="button" class="lab-mode-tab ${state.labMode === 'backtest' ? 'active' : ''}" data-action="set-lab-mode" data-mode="backtest" ${backtestDisabled ? 'disabled aria-disabled="true"' : ''} title="${backtestTitle}">
                    <span class="lab-mode-tab-head">
                        <span class="lab-mode-tab-label">Backtesting / Optimisation</span>
                        <span class="lab-mode-tab-badges">${backtestBadges}</span>
                    </span>
                    <span class="lab-mode-tab-copy">Replay real history, compare plans, and generate measured rule variants.</span>
                    ${backtestNote}
                </button>
                <button type="button" class="lab-mode-tab ${state.labMode === 'quick' ? 'active' : ''}" data-action="set-lab-mode" data-mode="quick">
                    <span class="lab-mode-tab-label">Quick Simulation</span>
                    <span class="lab-mode-tab-copy">Test one decision moment with mocked or live inputs and inspect the exact rule outcome.</span>
                </button>
            `;
        }
        if (backtestHost?.parentElement) {
            backtestHost.parentElement.classList.toggle('hidden', state.labMode !== 'backtest');
        }
        if (quickModeHost) {
            quickModeHost.classList.toggle('hidden', state.labMode !== 'quick');
        }
    }

    function ensureRoot() {
        if (backtestHost) return backtestHost;
        const container = document.querySelector('.container');
        const header = container?.querySelector('header');
        const grid = container?.querySelector('.grid');
        const headerTitle = container?.querySelector('header h1');
        if (!container || !header || !grid || !headerTitle) return null;

        document.title = 'Automation Lab - SoCrates';
        headerTitle.textContent = 'Automation Lab';

        root = document.createElement('section');
        root.id = rootId;
        root.className = 'lab-workbench';
        root.innerHTML = `
            <div class="lab-mode-shell">
                <section class="lab-mode-head">
                    <div class="lab-mode-copy" data-lab-shell-meta></div>
                    <div class="lab-mode-tabs" data-lab-shell-tabs></div>
                </section>
                <section class="lab-mode-panel" data-lab-mode-panel="backtest">
                    <div data-lab-backtest-host></div>
                </section>
                <section class="lab-mode-panel hidden" data-lab-mode-panel="quick">
                    <div class="lab-quick-shell"></div>
                </section>
            </div>
        `;
        header.insertAdjacentElement('afterend', root);
        shellMetaHost = root.querySelector('[data-lab-shell-meta]');
        shellTabsHost = root.querySelector('[data-lab-shell-tabs]');
        backtestHost = root.querySelector('[data-lab-backtest-host]');
        quickModeHost = root.querySelector('[data-lab-mode-panel="quick"]');
        quickModeHost.querySelector('.lab-quick-shell').appendChild(grid);

        if (!uiBound) {
            root.addEventListener('click', handleClick);
            root.addEventListener('change', handleChange);
            uiBound = true;
        }
        return backtestHost;
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
        renderModeChrome();

        host.innerHTML = `
            <div class="lab-shell">
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
                <p class="lab-card-copy">Pick a focused comparison. Each mode tests a different question about your automation rules.</p>
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
                <p class="lab-card-copy">Shorter periods run faster and are great for recent rule changes. Longer periods give more statistical confidence.</p>
                <div class="lab-pills">
                    ${['30', '60', '90'].map((preset) => `
                        <button type="button" class="lab-pill ${state.periodPreset === preset ? 'active' : ''}" data-action="set-period-preset" data-preset="${preset}">${preset}d</button>
                    `).join('')}
                    <button type="button" class="lab-pill ${state.periodPreset === 'custom' ? 'active' : ''}" data-action="set-period-preset" data-preset="custom">Custom</button>
                </div>
                <div class="lab-inline-fields" style="margin-top:14px;">
                    <div class="lab-field">
                        <label>Start date</label>
                        <input type="date" data-field="customStartDate" value="${escHtml(state.customStartDate)}" min="${getOldestBacktestStartDate()}" max="${getTodayDateOnly()}" ${state.periodPreset !== 'custom' ? 'disabled' : ''}>
                    </div>
                    <div class="lab-field">
                        <label>End date</label>
                        <input type="date" data-field="customEndDate" value="${escHtml(state.customEndDate)}" min="${getOldestBacktestStartDate()}" max="${getTodayDateOnly()}" ${state.periodPreset !== 'custom' ? 'disabled' : ''}>
                    </div>
                </div>
                <div class="lab-note" style="margin-top:14px;">
                    Backtests are capped to the last 90 days and use a fixed 5-minute replay grid with historical pricing, weather, and provider history where available.
                </div>
                ${state.compareMode === 'current_vs_plan' ? renderTariffPanel(selectedPlan) : ''}
            </section>
            <section class="lab-card">
                <h3>Review and run</h3>
                <p class="lab-card-copy">Check the scenarios below, then hit run. Results appear on the right with visual savings breakdown and rule performance.</p>
                ${state.backtestError ? `<div class="lab-message error">${escHtml(state.backtestError)}</div>` : ''}
                ${preview.error ? `<div class="lab-message error">${escHtml(preview.error)}</div>` : ''}
                ${historyLimitReached() ? `<div class="lab-note">History is full (${MAX_BACKTEST_HISTORY}/${MAX_BACKTEST_HISTORY}). Delete a saved report before starting another backtest.</div>` : ''}
                <div class="lab-scenario-list">
                    ${(preview.scenarios || []).map((scenario) => `
                        <div class="lab-scenario-card">
                            <strong>${escHtml(scenario.name)}</strong>
                            <div class="lab-run-meta">${getRuleCount(scenario.ruleSetSnapshot)} rule${getRuleCount(scenario.ruleSetSnapshot) === 1 ? '' : 's'} in replay${scenario.tariff ? ` • tariff: ${escHtml(selectedPlan?.name || 'manual plan')}` : ''}</div>
                        </div>
                    `).join('')}
                </div>
                <button type="button" class="btn btn-primary lab-run-cta" data-action="run-backtest" ${preview.error || state.runningBacktest || historyLimitReached() ? 'disabled' : ''}>
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
                <p class="lab-card-copy">Headline savings and trade-offs first, then drill into rule mix, interval impact, and top impactful moments.</p>
                ${run ? renderActiveRun(run) : `
                    <div class="lab-empty">
                        <div style="font-size:1.8rem;margin-bottom:8px;">📊</div>
                        <div style="font-weight:600;margin-bottom:4px;">No results yet</div>
                        <div style="font-size:0.84rem;">Configure your comparison on the left and run a backtest to see visual savings reports, interval impact, and rule performance.</div>
                    </div>
                `}
            </section>
            <section class="lab-card">
                <h3>Saved backtests (${state.backtestRuns.length}/${MAX_BACKTEST_HISTORY})</h3>
                <p class="lab-card-copy">Recent runs are kept as lightweight reports. You can keep up to ${MAX_BACKTEST_HISTORY} saved reports and generate up to ${MAX_BACKTEST_HISTORY} reports per day.</p>
                ${historyLimitReached() ? `<div class="lab-note">History is full. Delete a saved report to make room for another run.</div>` : ''}
                <div class="lab-run-list">
                    ${state.backtestRuns.length ? state.backtestRuns.map((entry) => renderRunCard(entry)).join('') : '<div class="lab-empty">No backtests saved yet. Your first run will appear here.</div>'}
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
        const baselineSummary = summaries.find((s) => s.scenarioId === 'baseline');
        const scenarioSummaries = summaries.filter((s) => s.scenarioId !== 'baseline');

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
                ${failed ? `<div class="lab-message error">${escHtml(run.error || 'Backtest failed. Try again or shorten the period.')}</div>` : ''}
                ${running ? `
                    <div class="lab-progress-pulse">
                        <div class="lab-progress-dot"></div>
                        <div class="lab-progress-text">Replaying history at 5-minute intervals. Results update automatically every few seconds.</div>
                    </div>
                ` : ''}
                ${completed ? `
                    ${renderResultsExplainer()}
                    ${scenarioSummaries.length ? `
                        <div class="lab-summary-grid">
                            ${scenarioSummaries.map((summary) => renderSummaryCard(summary, baselineSummary)).join('')}
                        </div>
                    ` : ''}
                    ${baselineSummary ? renderBaselineCard(baselineSummary) : ''}
                    ${comparisons.length ? renderComparisonSection(comparisons) : ''}
                    ${renderOptimizationPanel(run)}
                    ${renderResultsFaq(limitations, confidence)}
                ` : ''}
            </div>
        `;
    }

    function renderResultsExplainer() {
        return `
            <div class="lab-explainer">
                <div class="lab-explainer-title">📊 How to read these results</div>
                <div class="lab-explainer-body">
                    <ul>
                        <li><strong>Bill savings</strong> — positive (green) means the scenario saved money vs passive self-use</li>
                        <li><strong>Impact bar</strong> — green segments are 5-min intervals where the scenario beat baseline; red where it cost more</li>
                        <li><strong>Rule mix</strong> — which rules triggered most often and drove the most value</li>
                        <li><strong>Comparisons</strong> — side-by-side metric bars showing relative performance between scenarios</li>
                    </ul>
                </div>
            </div>
        `;
    }

    function renderBaselineCard(summary) {
        return `
            <details class="lab-details">
                <summary>Baseline reference (passive self-use)</summary>
                <div class="lab-details-content">
                    <div class="lab-metric-row">
                        <span class="lab-metric-label">Total bill</span>
                        <span class="lab-metric-number">${formatCurrency(summary.totalBillAud)}</span>
                    </div>
                    <div class="lab-metric-row">
                        <span class="lab-metric-label">Grid import</span>
                        <span class="lab-metric-number">${summary.importKWh.toFixed(1)} kWh</span>
                    </div>
                    <div class="lab-metric-row">
                        <span class="lab-metric-label">Grid export</span>
                        <span class="lab-metric-number">${summary.exportKWh.toFixed(1)} kWh</span>
                    </div>
                    <div class="lab-metric-row">
                        <span class="lab-metric-label">Battery throughput</span>
                        <span class="lab-metric-number">${summary.throughputKWh.toFixed(1)} kWh</span>
                    </div>
                    <div class="lab-metric-row">
                        <span class="lab-metric-label">Equivalent cycles</span>
                        <span class="lab-metric-number">${summary.equivalentCycles.toFixed(1)}</span>
                    </div>
                </div>
            </details>
        `;
    }

    function renderScenarioChart(summary) {
        const chart = summary?.chart;
        const points = (Array.isArray(chart?.points) ? chart.points : []).filter((point) => Number.isFinite(Number(point?.timestampMs)));
        if (points.length < 2) return '';

        const width = 760;
        const left = 18;
        const right = 18;
        const powerTop = 26;
        const powerBottom = 158;
        const dividerY = 182;
        const priceTop = 202;
        const priceBottom = 264;
        const labelY = 286;
        const drawableWidth = Math.max(1, width - left - right);
        const spanMs = Math.max(1, points[points.length - 1].timestampMs - points[0].timestampMs);
        const peakSolar = Math.max(...points.map((point) => toFiniteNumber(point.solarKw, 0)), 0);
        const peakImport = Math.max(...points.map((point) => toFiniteNumber(point.importKw, 0)), 0);
        const peakBuy = Math.max(...points.map((point) => toFiniteNumber(point.buyCentsPerKwh, 0)), 0);
        const powerMax = Math.max(
            peakSolar,
            peakImport,
            ...points.map((point) => toFiniteNumber(point.loadKw, 0)),
            ...points.map((point) => toFiniteNumber(point.exportKw, 0)),
            0.1
        );
        const priceMax = Math.max(
            peakBuy,
            ...points.map((point) => toFiniteNumber(point.feedInCentsPerKwh, 0)),
            0.1
        );
        const xFor = (point, index) => {
            if (points.length === 1) return left + (drawableWidth / 2);
            return left + ((drawableWidth * index) / (points.length - 1));
        };
        const powerYFor = (value) => powerBottom - ((clampNumber(toFiniteNumber(value, 0), 0, powerMax) / powerMax) * (powerBottom - powerTop));
        const priceYFor = (value) => priceBottom - ((clampNumber(toFiniteNumber(value, 0), 0, priceMax) / priceMax) * (priceBottom - priceTop));
        const tickIndices = Array.from(new Set([0, Math.round((points.length - 1) / 2), points.length - 1])).sort((leftIndex, rightIndex) => leftIndex - rightIndex);
        const bucketCopy = chart?.bucketMinutes > chart?.stepMinutes
            ? `Downsampled from 5-minute replay into ${chart.bucketMinutes}-minute chart buckets.`
            : 'Rendered directly from the 5-minute replay profile.';

        return `
            <div class="lab-report-chart">
                <div class="lab-report-chart-head">
                    <div>
                        <div class="lab-report-chart-title">Inverter and price profile</div>
                        <div class="lab-report-chart-copy">${bucketCopy}</div>
                    </div>
                    <div class="lab-report-chart-stats">
                        <span class="lab-chart-pill">Peak solar ${peakSolar.toFixed(1)} kW</span>
                        <span class="lab-chart-pill">Peak import ${peakImport.toFixed(1)} kW</span>
                        <span class="lab-chart-pill">Peak buy ${peakBuy.toFixed(1)} c/kWh</span>
                    </div>
                </div>
                <div class="lab-report-chart-legend">
                    <span class="lab-chart-key"><span class="lab-chart-swatch" style="background:#34d399;"></span>Solar</span>
                    <span class="lab-chart-key"><span class="lab-chart-swatch" style="background:#cbd5e1;"></span>Load</span>
                    <span class="lab-chart-key"><span class="lab-chart-swatch" style="background:#f87171;"></span>Import</span>
                    <span class="lab-chart-key"><span class="lab-chart-swatch" style="background:#22d3ee;"></span>Export</span>
                    <span class="lab-chart-key"><span class="lab-chart-swatch" style="background:#fbbf24;"></span>Buy price</span>
                    <span class="lab-chart-key"><span class="lab-chart-swatch" style="background:#38bdf8;"></span>Feed-in</span>
                </div>
                <svg viewBox="0 0 ${width} 296" role="img" aria-label="Backtest inverter and price profile">
                    ${[powerTop, ((powerTop + powerBottom) / 2), powerBottom].map((y) => `
                        <line x1="${left}" y1="${y.toFixed(2)}" x2="${width - right}" y2="${y.toFixed(2)}" stroke="rgba(148, 163, 184, 0.18)" stroke-dasharray="3 4"></line>
                    `).join('')}
                    ${[priceTop, ((priceTop + priceBottom) / 2), priceBottom].map((y) => `
                        <line x1="${left}" y1="${y.toFixed(2)}" x2="${width - right}" y2="${y.toFixed(2)}" stroke="rgba(148, 163, 184, 0.18)" stroke-dasharray="3 4"></line>
                    `).join('')}
                    <text x="${left}" y="16" fill="var(--text-secondary)" font-size="12" font-weight="700">Power (kW)</text>
                    <text x="${width - right}" y="16" fill="var(--text-secondary)" font-size="12" text-anchor="end">${powerMax.toFixed(1)} kW peak</text>
                    <path d="${buildSvgAreaPath(points, xFor, (point) => powerYFor(point.solarKw), powerBottom)}" fill="rgba(52, 211, 153, 0.12)" stroke="none"></path>
                    <path d="${buildSvgLinePath(points, xFor, (point) => powerYFor(point.solarKw))}" fill="none" stroke="#34d399" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path>
                    <path d="${buildSvgLinePath(points, xFor, (point) => powerYFor(point.loadKw))}" fill="none" stroke="#cbd5e1" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path>
                    <path d="${buildSvgLinePath(points, xFor, (point) => powerYFor(point.importKw))}" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                    <path d="${buildSvgLinePath(points, xFor, (point) => powerYFor(point.exportKw))}" fill="none" stroke="#22d3ee" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                    <line x1="${left}" y1="${dividerY}" x2="${width - right}" y2="${dividerY}" stroke="rgba(148, 163, 184, 0.24)"></line>
                    <text x="${left}" y="${dividerY + 16}" fill="var(--text-secondary)" font-size="12" font-weight="700">Price (c/kWh)</text>
                    <text x="${width - right}" y="${dividerY + 16}" fill="var(--text-secondary)" font-size="12" text-anchor="end">${priceMax.toFixed(1)} c/kWh peak</text>
                    <path d="${buildSvgLinePath(points, xFor, (point) => priceYFor(point.buyCentsPerKwh))}" fill="none" stroke="#fbbf24" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path>
                    <path d="${buildSvgLinePath(points, xFor, (point) => priceYFor(point.feedInCentsPerKwh))}" fill="none" stroke="#38bdf8" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"></path>
                    ${tickIndices.map((tickIndex) => {
                        const point = points[tickIndex];
                        const x = xFor(point, tickIndex);
                        return `
                            <line x1="${x.toFixed(2)}" y1="${labelY - 18}" x2="${x.toFixed(2)}" y2="${labelY - 10}" stroke="rgba(148, 163, 184, 0.3)"></line>
                            <text x="${x.toFixed(2)}" y="${labelY}" fill="var(--text-secondary)" font-size="11" text-anchor="${tickIndex === 0 ? 'start' : tickIndex === points.length - 1 ? 'end' : 'middle'}">${escHtml(formatChartTick(point.timestampMs, spanMs))}</text>
                        `;
                    }).join('')}
                </svg>
            </div>
        `;
    }

    function renderSummaryCard(summary, baselineSummary) {
        const delta = summary.deltaVsBaseline;
        const billDelta = delta?.billAud;
        const impact = summary.intervalImpact || null;
        const isGood = Number(billDelta || 0) >= 0;
        const deltaClass = billDelta === undefined ? 'neutral' : (isGood ? 'good' : 'bad');
        const deltaArrow = billDelta === undefined ? '' : (isGood ? '↑' : '↓');
        const deltaLabel = billDelta === undefined ? '' : (isGood ? 'saved vs baseline' : 'more than baseline');

        const impactTotal = impact ? (impact.total || (impact.helped + impact.hurt + impact.neutral) || 1) : 1;
        const helpedPct = impact ? Math.round((impact.helped / impactTotal) * 100) : 0;
        const hurtPct = impact ? Math.round((impact.hurt / impactTotal) * 100) : 0;
        const neutralPct = impact ? 100 - helpedPct - hurtPct : 100;

        const maxTriggers = Math.max(...(summary.winningRuleMix || []).map((r) => r.triggerCount), 1);

        return `
            <div class="lab-metric-card">
                <div class="lab-metric-title" style="font-weight:800;">${escHtml(summary.scenarioName)}</div>

                ${billDelta !== undefined ? `
                    <div class="lab-delta-hero">
                        <span class="lab-delta-arrow">${deltaArrow}</span>
                        <div>
                            <div class="lab-delta-amount ${deltaClass}">${formatCurrency(Math.abs(billDelta))}</div>
                            <div class="lab-delta-label">${deltaLabel}</div>
                        </div>
                    </div>
                ` : ''}

                <div style="margin-top:10px;">
                    <div class="lab-metric-row">
                        <span class="lab-metric-label">Total bill</span>
                        <span class="lab-metric-number">${formatCurrency(summary.totalBillAud)}</span>
                    </div>
                    <div class="lab-metric-row">
                        <span class="lab-metric-label">Import cost</span>
                        <span class="lab-metric-number">${formatCurrency(summary.totalImportCostAud)}</span>
                    </div>
                    <div class="lab-metric-row">
                        <span class="lab-metric-label">Export revenue</span>
                        <span class="lab-metric-number">${formatCurrency(summary.totalExportRevenueAud)}</span>
                    </div>
                    <div class="lab-metric-row">
                        <span class="lab-metric-label">Supply charges</span>
                        <span class="lab-metric-number">${formatCurrency(summary.totalSupplyChargeAud)}</span>
                    </div>
                </div>

                <div class="lab-badges" style="margin-top:10px;">
                    <span class="lab-badge">Import ${summary.importKWh.toFixed(1)} kWh${delta?.importKWh !== undefined ? ` (${formatSignedNumber(-delta.importKWh, 1)})` : ''}</span>
                    <span class="lab-badge">Export ${summary.exportKWh.toFixed(1)} kWh${delta?.exportKWh !== undefined ? ` (${formatSignedNumber(delta.exportKWh, 1)})` : ''}</span>
                    <span class="lab-badge">Throughput ${summary.throughputKWh.toFixed(1)} kWh</span>
                    <span class="lab-badge">${summary.equivalentCycles.toFixed(1)} cycles</span>
                </div>

                ${renderScenarioChart(summary)}

                ${impact ? `
                    <div style="margin-top:14px;">
                        <div style="font-weight:700;font-size:0.82rem;margin-bottom:4px;">Interval impact</div>
                        <div class="lab-impact-bar">
                            <div class="helped" style="width:${helpedPct}%"></div>
                            <div class="hurt" style="width:${hurtPct}%"></div>
                            <div class="neutral-bar" style="width:${neutralPct}%"></div>
                        </div>
                        <div class="lab-impact-legend">
                            <span><span class="lab-impact-dot helped"></span> Helped ${impact.helped} (${helpedPct}%)</span>
                            <span><span class="lab-impact-dot hurt"></span> Hurt ${impact.hurt} (${hurtPct}%)</span>
                            <span><span class="lab-impact-dot neutral-bar"></span> Neutral ${impact.neutral}</span>
                        </div>
                    </div>
                ` : ''}

                ${summary.winningRuleMix?.length ? `
                    <details class="lab-details" style="margin-top:14px;">
                        <summary>Rule mix (${summary.triggerCount} total triggers)</summary>
                        <div class="lab-details-content" style="display:grid;gap:8px;">
                            ${summary.winningRuleMix.slice(0, 6).map((entry) => `
                                <div class="lab-rule-bar-row">
                                    <span class="lab-rule-bar-label" title="${escHtml(entry.ruleName)}">${escHtml(entry.ruleName)}</span>
                                    <div class="lab-rule-bar-track"><div class="lab-rule-bar-fill" style="width:${Math.round((entry.triggerCount / maxTriggers) * 100)}%"></div></div>
                                    <span class="lab-rule-bar-count">${entry.triggerCount}</span>
                                </div>
                            `).join('')}
                        </div>
                    </details>
                ` : ''}

                ${impact?.highlights?.length ? `
                    <details class="lab-details" style="margin-top:8px;">
                        <summary>Top impactful intervals</summary>
                        <div class="lab-details-content">
                            ${impact.highlights.slice(0, 8).map((h) => `
                                <div class="lab-highlight-row">
                                    <span style="color:var(--text-secondary);">${new Date(h.timestampMs).toLocaleString('en-AU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                    <span style="font-weight:600;color:${h.deltaAud > 0 ? '#86efac' : '#fca5a5'};">${formatSignedCurrency(h.deltaAud)}</span>
                                    <span class="lab-badge" style="font-size:0.72rem;">${escHtml(h.ruleName || 'baseline')}</span>
                                </div>
                            `).join('')}
                        </div>
                    </details>
                ` : ''}
            </div>
        `;
    }

    function renderComparisonSection(comparisons) {
        return `
            <div class="lab-stack">
                <strong>Side-by-side comparisons</strong>
                <div class="lab-comparison-grid">
                    ${comparisons.map((comparison) => renderComparisonCard(comparison)).join('')}
                </div>
            </div>
        `;
    }

    function renderComparisonCard(comparison) {
        const metrics = [
            { label: 'Bill', value: comparison.billDeltaAud, suffix: '', format: (v) => formatCurrency(Math.abs(v)), goodWhenNegative: true },
            { label: 'Import', value: comparison.importDeltaKWh, suffix: ' kWh', format: (v) => Math.abs(v).toFixed(1), goodWhenNegative: true },
            { label: 'Export', value: comparison.exportDeltaKWh, suffix: ' kWh', format: (v) => Math.abs(v).toFixed(1), goodWhenNegative: false },
            { label: 'Throughput', value: comparison.throughputDeltaKWh, suffix: ' kWh', format: (v) => Math.abs(v).toFixed(1), goodWhenNegative: false }
        ];
        const maxAbs = Math.max(...metrics.map((m) => Math.abs(m.value || 0)), 0.01);

        return `
            <div class="lab-comparison-card">
                <div style="font-weight:700;margin-bottom:4px;">${escHtml(comparison.leftScenarioName)} vs ${escHtml(comparison.rightScenarioName)}</div>
                <div class="lab-run-meta" style="margin-bottom:10px;">Positive values indicate ${escHtml(comparison.rightScenarioName)} is higher.</div>
                <div class="lab-comparison-visual">
                    ${metrics.map((m) => {
                        const val = Number(m.value || 0);
                        const isGood = m.goodWhenNegative ? val < -0.001 : val > 0.001;
                        const isBad = m.goodWhenNegative ? val > 0.001 : val < -0.001;
                        const barClass = isGood ? 'good' : (isBad ? 'bad' : 'good');
                        const barPct = Math.min(Math.abs(val) / maxAbs * 100, 100);
                        const sign = val >= 0 ? '+' : '-';
                        return `
                            <div class="lab-comparison-metric">
                                <span class="lab-metric-label">${m.label}</span>
                                <div class="lab-comparison-bar-track">
                                    <div class="lab-comparison-bar-fill ${barClass}" style="width:${barPct}%;${val < 0 ? 'right:0;' : 'left:0;'}"></div>
                                </div>
                                <span style="font-weight:700;font-size:0.8rem;color:${isGood ? '#86efac' : (isBad ? '#fca5a5' : 'var(--text-secondary)')};">${sign}${m.format(val)}${m.suffix}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    function renderResultsFaq(limitations, confidence) {
        const confidenceColor = confidence === 'high' ? '#86efac' : (confidence === 'medium' ? '#fbbf24' : '#fca5a5');
        const faqItems = [
            {
                q: 'What does the confidence level mean?',
                a: `Confidence reflects how complete the historical data was. <strong style="color:${confidenceColor}">${escHtml(confidence)}</strong> confidence means ${confidence === 'high' ? 'SoC, weather, and pricing data were all available with minimal gaps.' : confidence === 'medium' ? 'some data points (typically SoC history) were reconstructed from nearby values.' : 'significant data gaps affected the simulation. Consider a shorter period or check your data connections.'}`
            },
            {
                q: 'Why might the scenario cost more than baseline?',
                a: 'Rules can hurt during periods where forced charging or discharging happens at worse prices than passive self-use would have achieved. This is common with rules that charge overnight when solar would have been sufficient the next day.'
            },
            {
                q: 'What is the interval impact bar?',
                a: 'Each 5-minute replay interval is classified: <strong style="color:#86efac">helped</strong> if the scenario saved money vs baseline that interval, <strong style="color:#fca5a5">hurt</strong> if it cost more, and <strong>neutral</strong> if no meaningful difference. A high helped percentage with few hurt intervals indicates a well-tuned rule set.'
            },
            {
                q: 'How are battery cycles calculated?',
                a: 'Equivalent cycles = total battery throughput (charge + discharge kWh) divided by twice the battery capacity. One full charge-then-discharge equals one cycle. More cycles mean more battery wear but potentially more value extracted.'
            },
            {
                q: 'Can I trust the exact dollar amounts?',
                a: 'The simulation uses real historical tariffs and inverter data, but small timing differences (the 5-minute grid vs real-time decisions) mean real-world results will differ slightly. Use the direction and magnitude of savings as a guide, not exact predictions.'
            }
        ];

        return `
            <details class="lab-details">
                <summary>Understanding your results</summary>
                <div class="lab-details-content lab-stack">
                    ${limitations.length ? `
                        <div style="font-weight:700;font-size:0.86rem;margin-bottom:4px;">Limitations for this run</div>
                        <div class="lab-limitation-list">${limitations.map((item) => `<div class="lab-note">${escHtml(item)}</div>`).join('')}</div>
                    ` : ''}
                    <div style="font-weight:700;font-size:0.86rem;margin-bottom:4px;margin-top:${limitations.length ? '12px' : '0'};">Frequently asked questions</div>
                    ${faqItems.map((item) => `
                        <div class="lab-faq-card" onclick="this.classList.toggle('open')">
                            <div class="lab-faq-q"><span>${escHtml(item.q)}</span><span class="lab-faq-chevron">▼</span></div>
                            <div class="lab-faq-a">${item.a}</div>
                        </div>
                    `).join('')}
                </div>
            </details>
        `;
    }

    function renderOptimizationPanel(run) {
        const summaries = nonBaselineSummaries(run);
        return `
            <section class="lab-card" style="padding:0;border:none;box-shadow:none;background:transparent;">
                <h3>Explainable optimiser</h3>
                <p class="lab-card-copy">Use the completed backtest as evidence, then request bounded rule variants with explicit diffs and measured trade-offs.</p>
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
        if (!run) return `<div class="lab-note" style="margin-top:14px;">Choose a goal and let the optimiser test bounded variants against the selected backtest evidence.</div>`;
        if (run.status === 'queued' || run.status === 'running') return `
            <div class="lab-progress-pulse" style="margin-top:14px;">
                <div class="lab-progress-dot"></div>
                <div class="lab-progress-text">Optimiser is testing candidate variants. This updates automatically.</div>
            </div>`;
        if (run.status === 'failed') return `<div class="lab-message error" style="margin-top:14px;">${escHtml(run.error || 'Optimiser failed.')}</div>`;
        const variants = Array.isArray(run.result?.variants) ? run.result.variants : [];
        if (!variants.length) return '<div class="lab-note" style="margin-top:14px;">No useful variants beat the source scenario for that goal. Try a different goal or a longer backtest period.</div>';
        return `
            <div class="lab-variant-grid" style="margin-top:14px;">
                ${variants.map((variant) => {
                    const improvementVal = Number(variant.billImprovementAud || 0);
                    const improvementClass = improvementVal > 0 ? 'good' : (improvementVal < 0 ? 'bad' : 'neutral');
                    return `
                        <div class="lab-variant-card">
                            <div style="font-weight:800;margin-bottom:6px;">${escHtml(variant.name)}</div>
                            <div class="lab-delta-hero" style="margin:8px 0;">
                                <span class="lab-delta-arrow">${improvementVal >= 0 ? '↑' : '↓'}</span>
                                <div>
                                    <div class="lab-delta-amount ${improvementClass}">${formatCurrency(Math.abs(improvementVal))}</div>
                                    <div class="lab-delta-label">${improvementVal >= 0 ? 'improvement over source' : 'worse than source'}</div>
                                </div>
                            </div>
                            <div class="lab-metric-row">
                                <span class="lab-metric-label">Total bill</span>
                                <span class="lab-metric-number">${formatCurrency(variant.summary.totalBillAud)}</span>
                            </div>
                            <div class="lab-metric-row">
                                <span class="lab-metric-label">Throughput</span>
                                <span class="lab-metric-number">${variant.summary.throughputKWh.toFixed(1)} kWh</span>
                            </div>
                            <div class="lab-metric-row">
                                <span class="lab-metric-label">Import</span>
                                <span class="lab-metric-number">${variant.summary.importKWh.toFixed(1)} kWh</span>
                            </div>
                            ${variant.diffSummary?.length ? `
                                <div style="margin-top:10px;font-size:0.82rem;font-weight:700;">Changes from source</div>
                                <div class="lab-rule-list" style="margin-top:6px;">
                                    ${variant.diffSummary.map((item) => `<div class="lab-note" style="font-size:0.82rem;">${escHtml(item)}</div>`).join('')}
                                </div>
                            ` : ''}
                            <div class="lab-variant-actions" style="margin-top:12px;">
                                <button type="button" class="btn btn-primary" data-action="apply-variant" data-run-id="${escHtml(run.id)}" data-variant-id="${escHtml(variant.id)}">Apply variant</button>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderRunCard(entry) {
        const scenarioNames = (entry.result?.summaries || [])
            .filter((s) => s.scenarioId !== 'baseline')
            .map((s) => s.scenarioName)
            .slice(0, 3);
        const bestDelta = (entry.result?.summaries || [])
            .filter((s) => s.deltaVsBaseline?.billAud !== undefined)
            .sort((a, b) => b.deltaVsBaseline.billAud - a.deltaVsBaseline.billAud)[0];
        return `
            <div class="lab-run-history-item">
                <button type="button" class="lab-run-card ${entry.id === state.selectedRunId ? 'active' : ''}" data-action="select-run" data-run-id="${escHtml(entry.id)}">
                <strong>${escHtml(periodLabel(entry.request?.period || {}))}</strong>
                <div class="lab-run-meta">Requested ${escHtml(formatDate(entry.requestedAtMs))}</div>
                <div class="lab-badges">
                    <span class="lab-badge"><span class="lab-status ${escHtml(entry.status)}">${escHtml(entry.status)}</span></span>
                    ${scenarioNames.length ? scenarioNames.map((n) => `<span class="lab-badge">${escHtml(n)}</span>`).join('') : `<span class="lab-badge">${escHtml(entry.request?.comparisonMode || 'backtest')}</span>`}
                    ${bestDelta ? `<span class="lab-badge" style="color:${bestDelta.deltaVsBaseline.billAud >= 0 ? '#86efac' : '#fca5a5'};">${bestDelta.deltaVsBaseline.billAud >= 0 ? '↑' : '↓'} ${formatCurrency(Math.abs(bestDelta.deltaVsBaseline.billAud))}</span>` : ''}
                    </div>
                </button>
                ${canDeleteRun(entry) ? `
                    <div class="lab-run-history-actions">
                        <button type="button" class="btn btn-secondary" data-action="delete-run" data-run-id="${escHtml(entry.id)}">Delete</button>
                    </div>
                ` : ''}
            </div>
        `;
    }

    async function refreshBacktestRuns() {
        const response = await window.apiClient.listBacktestRuns(BACKTEST_HISTORY_FETCH_LIMIT);
        state.backtestRuns = Array.isArray(response?.result) ? response.result : [];
        if (state.selectedRunId) {
            const selected = state.backtestRuns.find((entry) => entry.id === state.selectedRunId);
            if (selected) {
                if (!state.activeRun || state.activeRun.id !== selected.id) state.activeRun = selected;
            }
            else {
                state.selectedRunId = '';
                state.activeRun = null;
            }
        }
    }

    async function runBacktest() {
        if (historyLimitReached()) {
            state.backtestError = `You already have ${MAX_BACKTEST_HISTORY} saved backtests. Delete one from history before running another.`;
            render();
            return;
        }
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

    async function deleteBacktestRun(runId) {
        const entry = state.backtestRuns.find((candidate) => candidate.id === runId) || (state.activeRun?.id === runId ? state.activeRun : null);
        if (!canDeleteRun(entry)) {
            state.backtestError = 'Backtest runs can only be deleted after they finish.';
            render();
            return;
        }
        if (!window.confirm('Delete this saved backtest report from history?')) return;
        const deletingSelected = state.selectedRunId === runId || state.activeRun?.id === runId;
        try {
            const response = await window.apiClient.deleteBacktestRun(runId);
            if (response?.errno !== 0) throw new Error(response?.error || 'Backtest report could not be deleted.');
            if (deletingSelected) {
                stopBacktestPolling();
                state.selectedRunId = '';
                state.activeRun = null;
            }
            await refreshBacktestRuns();
            if (deletingSelected) {
                const fallbackRun = state.backtestRuns[0] || null;
                if (fallbackRun?.id) {
                    await selectRun(fallbackRun.id);
                    return;
                }
                state.selectedRunId = '';
                state.activeRun = null;
                state.optimizationRun = null;
                state.optimizationError = '';
                state.applyMessage = '';
            }
            state.backtestError = '';
        } catch (error) {
            state.backtestError = error?.message || 'Backtest report could not be deleted.';
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
        if (action === 'set-lab-mode') {
            setLabMode(actionEl.dataset.mode === 'quick' ? 'quick' : 'backtest');
            render();
        } else if (action === 'set-compare-mode') {
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
        } else if (action === 'delete-run') {
            deleteBacktestRun(actionEl.dataset.runId);
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

    function bootstrapAutomationLab() {
        if (state.bootstrapped) return;
        state.bootstrapped = true;
        injectStyles();
        state.tariffDraft = createTariffDraft(state.currentTimezone);
        loadInitialData();
    }

    function startAutomationLabWhenReady() {
        if (window.AppShell && typeof window.AppShell.onReady === 'function') {
            window.AppShell.onReady(() => {
                bootstrapAutomationLab();
            });
            return;
        }
        bootstrapAutomationLab();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            startAutomationLabWhenReady();
        }, { once: true });
    } else {
        startAutomationLabWhenReady();
    }
})();
