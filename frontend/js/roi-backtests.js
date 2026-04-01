(() => {
    const state = {
        loading: true,
        error: '',
        runs: [],
        tariffPlans: [],
        filters: {
            period: 'all',
            scenario: '',
            tariff: 'all'
        }
    };

    let root = null;
    let bound = false;

    function escHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatCurrency(value) {
        return new Intl.NumberFormat('en-AU', {
            style: 'currency',
            currency: 'AUD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(Number(value || 0));
    }

    function formatDate(value) {
        if (!value) return 'Unknown';
        return new Date(value).toLocaleString('en-AU', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function runPeriodDays(run) {
        const start = run?.request?.period?.startDate;
        const end = run?.request?.period?.endDate;
        if (!start || !end) return null;
        const deltaMs = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
        return Number.isFinite(deltaMs) ? Math.round(deltaMs / (24 * 60 * 60 * 1000)) + 1 : null;
    }

    function resolveTariffNames(run) {
        const planMap = new Map(state.tariffPlans.map((plan) => [String(plan.id), plan.name]));
        const names = [];
        (run?.request?.scenarios || []).forEach((scenario) => {
            const tariff = scenario?.tariff;
            if (!tariff) return;
            if (tariff.plan?.name) names.push(tariff.plan.name);
            else if (tariff.planId && planMap.has(String(tariff.planId))) names.push(planMap.get(String(tariff.planId)));
        });
        return Array.from(new Set(names));
    }

    function enrichRun(run) {
        const summaries = Array.isArray(run?.result?.summaries) ? run.result.summaries : [];
        const nonBaseline = summaries.filter((summary) => summary.scenarioId !== 'baseline');
        const bestScenario = nonBaseline.slice().sort((left, right) => left.totalBillAud - right.totalBillAud)[0] || summaries[0] || null;
        return {
            ...run,
            scenarioNames: Array.from(new Set((run?.request?.scenarios || []).map((scenario) => scenario.name).filter(Boolean))),
            tariffNames: resolveTariffNames(run),
            periodDays: runPeriodDays(run),
            bestScenario
        };
    }

    function filteredRuns() {
        return state.runs
            .map(enrichRun)
            .filter((run) => {
                const matchesScenario = !state.filters.scenario
                    || run.scenarioNames.some((name) => name.toLowerCase().includes(state.filters.scenario))
                    || (run.bestScenario?.scenarioName || '').toLowerCase().includes(state.filters.scenario);
                const matchesTariff = state.filters.tariff === 'all'
                    || run.tariffNames.includes(state.filters.tariff);
                const matchesPeriod = state.filters.period === 'all'
                    || String(run.periodDays || '') === state.filters.period;
                return matchesScenario && matchesTariff && matchesPeriod;
            });
    }

    function ensureRoot() {
        if (root) return root;
        const historyCard = document.querySelector('[data-card="automation-history"]');
        if (!historyCard || !historyCard.parentElement) return null;

        const style = document.createElement('style');
        style.textContent = `
            .roi-backtests-controls { display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; margin-bottom:16px; }
            .roi-backtests-grid { display:grid; gap:12px; }
            .roi-backtest-card { background: var(--bg-overlay); border: 1px solid var(--border); border-radius: 12px; padding: 14px; }
            .roi-backtest-head { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:10px; }
            .roi-backtest-title { font-weight:700; color: var(--text); }
            .roi-backtest-meta { color: var(--text-muted); font-size:12px; line-height:1.5; }
            .roi-backtest-badges { display:flex; flex-wrap:wrap; gap:6px; margin:10px 0; }
            .roi-backtest-badge { border:1px solid color-mix(in srgb, var(--accent-blue) 25%, transparent); background: color-mix(in srgb, var(--accent-blue) 12%, transparent); color: var(--accent-blue); border-radius:999px; padding:4px 8px; font-size:11px; }
            .roi-backtest-summary { display:grid; gap:10px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
            .roi-backtest-metric { background: var(--bg-card); border:1px solid var(--border); border-radius:10px; padding:10px; }
            .roi-backtest-metric strong { display:block; margin-bottom:4px; color: var(--text); }
            .roi-backtest-metric span { color: var(--text-muted); font-size:12px; line-height:1.45; }
            .roi-backtest-details { margin-top:10px; border:1px solid var(--border); border-radius:10px; background: color-mix(in srgb, var(--bg-card) 92%, transparent); }
            .roi-backtest-details summary { cursor:pointer; padding:12px; font-weight:600; }
            .roi-backtest-details div { padding:0 12px 12px; color: var(--text-muted); font-size:12px; line-height:1.55; }
        `;
        document.head.appendChild(style);

        root = document.createElement('div');
        root.className = 'card';
        root.id = 'roiBacktestsCard';
        historyCard.parentElement.insertBefore(root, historyCard);
        if (!bound) {
            root.addEventListener('change', handleChange);
            root.addEventListener('click', handleClick);
            bound = true;
        }
        return root;
    }

    async function loadBacktests() {
        state.loading = true;
        render();
        try {
            await waitForAPIClient(5000);
            const [runsResponse, plansResponse] = await Promise.all([
                window.apiClient.listBacktestRuns(20),
                window.apiClient.listBacktestTariffPlans()
            ]);
            state.runs = Array.isArray(runsResponse?.result) ? runsResponse.result : [];
            state.tariffPlans = Array.isArray(plansResponse?.result) ? plansResponse.result : [];
            state.error = '';
        } catch (error) {
            state.error = error?.message || 'Backtests could not be loaded.';
        } finally {
            state.loading = false;
            render();
        }
    }

    function render() {
        const host = ensureRoot();
        if (!host) return;
        const visibleRuns = filteredRuns();
        host.innerHTML = `
            <div class="card-header">
                <div class="card-title">Backtests</div>
                <div style="display:flex;gap:8px;">
                    <button class="btn" type="button" data-action="refresh-backtests">Refresh</button>
                </div>
            </div>
            <div class="card-body">
                <div class="roi-backtests-controls">
                    <div class="control-group" style="min-width:120px;">
                        <label>Period</label>
                        <select class="input" data-filter="period">
                            <option value="all" ${state.filters.period === 'all' ? 'selected' : ''}>All</option>
                            <option value="30" ${state.filters.period === '30' ? 'selected' : ''}>30 days</option>
                            <option value="90" ${state.filters.period === '90' ? 'selected' : ''}>90 days</option>
                            <option value="365" ${state.filters.period === '365' ? 'selected' : ''}>365 days</option>
                        </select>
                    </div>
                    <div class="control-group" style="min-width:180px;flex:1;">
                        <label>Scenario</label>
                        <input class="input" type="text" data-filter="scenario" value="${escHtml(state.filters.scenario)}" placeholder="Search scenario name">
                    </div>
                    <div class="control-group" style="min-width:180px;">
                        <label>Tariff plan</label>
                        <select class="input" data-filter="tariff">
                            <option value="all" ${state.filters.tariff === 'all' ? 'selected' : ''}>All</option>
                            ${state.tariffPlans.map((plan) => `<option value="${escHtml(plan.name)}" ${state.filters.tariff === plan.name ? 'selected' : ''}>${escHtml(plan.name)}</option>`).join('')}
                        </select>
                    </div>
                </div>
                ${state.error ? `<div class="status error" style="display:block;">${escHtml(state.error)}</div>` : ''}
                ${state.loading ? `
                    <div class="empty-state">
                        <div class="icon">Loading...</div>
                        <p>Fetching saved backtests</p>
                    </div>
                ` : visibleRuns.length ? `
                    <div class="roi-backtests-grid">
                        ${visibleRuns.map((run) => renderRun(run)).join('')}
                    </div>
                ` : `
                    <div class="empty-state">
                        <div class="icon">Results</div>
                        <p>No backtests match your filters yet.</p>
                    </div>
                `}
            </div>
        `;

    }

    function renderRun(run) {
        const summaries = Array.isArray(run?.result?.summaries) ? run.result.summaries : [];
        const comparisons = Array.isArray(run?.result?.comparisons) ? run.result.comparisons : [];
        const limitations = Array.isArray(run?.result?.limitations || run?.limitations) ? (run.result?.limitations || run.limitations) : [];
        const bestScenario = run.bestScenario;
        return `
            <div class="roi-backtest-card">
                <div class="roi-backtest-head">
                    <div>
                        <div class="roi-backtest-title">${escHtml(run.request?.period?.startDate || '')} to ${escHtml(run.request?.period?.endDate || '')}</div>
                        <div class="roi-backtest-meta">Requested ${escHtml(formatDate(run.requestedAtMs))} • ${escHtml(run.status || 'unknown')} • ${run.periodDays || '?'} day replay</div>
                    </div>
                    <div class="roi-backtest-meta">Confidence: ${escHtml(run.result?.confidence || run.confidence || 'n/a')}</div>
                </div>
                <div class="roi-backtest-badges">
                    ${run.scenarioNames.map((name) => `<span class="roi-backtest-badge">${escHtml(name)}</span>`).join('')}
                    ${run.tariffNames.map((name) => `<span class="roi-backtest-badge">${escHtml(name)}</span>`).join('')}
                </div>
                ${bestScenario ? `
                    <div class="roi-backtest-summary">
                        <div class="roi-backtest-metric">
                            <strong>Headline outcome</strong>
                            <span>${escHtml(bestScenario.scenarioName)} finished at ${formatCurrency(bestScenario.totalBillAud)}.</span>
                        </div>
                        <div class="roi-backtest-metric">
                            <strong>What changed most</strong>
                            <span>${bestScenario.deltaVsBaseline ? `Bill vs baseline: ${formatCurrency(bestScenario.deltaVsBaseline.billAud)}` : 'Baseline comparison not available.'}</span>
                        </div>
                        <div class="roi-backtest-metric">
                            <strong>Trade-off snapshot</strong>
                            <span>Throughput ${bestScenario.throughputKWh.toFixed(3)} kWh • ${bestScenario.triggerCount} trigger(s).</span>
                        </div>
                    </div>
                ` : ''}
                <details class="roi-backtest-details">
                    <summary>Evidence and limitations</summary>
                    <div>
                        ${comparisons.length ? comparisons.map((comparison) => `<div>${escHtml(comparison.leftScenarioName)} vs ${escHtml(comparison.rightScenarioName)} • bill delta ${formatCurrency(-comparison.billDeltaAud)}</div>`).join('') : '<div>No side-by-side comparison rows saved for this run.</div>'}
                        ${limitations.length ? limitations.map((item) => `<div>${escHtml(item)}</div>`).join('') : ''}
                        ${summaries.length ? summaries.map((summary) => `<div>${escHtml(summary.scenarioName)} • import ${summary.importKWh.toFixed(3)} kWh • export ${summary.exportKWh.toFixed(3)} kWh</div>`).join('') : ''}
                    </div>
                </details>
            </div>
        `;
    }

    function handleChange(event) {
        const filter = event.target.dataset.filter;
        if (!filter) return;
        if (filter === 'scenario') {
            state.filters.scenario = String(event.target.value || '').trim().toLowerCase();
        } else {
            state.filters[filter] = event.target.value;
        }
        render();
    }

    function handleClick(event) {
        const actionEl = event.target.closest('[data-action]');
        if (!actionEl) return;
        if (actionEl.dataset.action === 'refresh-backtests') {
            loadBacktests();
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        ensureRoot();
        loadBacktests();
    });
})();
