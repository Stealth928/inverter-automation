/* Market Insights v2 — visual, interactive, plain-English */
(function () {
    'use strict';

    const INDEX_URL = '/data/aemo-market-insights/index.json';
    const DAY_MS = 86400000;
    const COLORS = ['#58a6ff', '#7ee787', '#ffc56d', '#ff7b72', '#d2a8ff'];
    const SPIKE_THRESHOLD = 300; // $/MWh — industry convention for "spike"

    // ── State ──
    const S = {
        index: null,
        data: new Map(),
        regions: [],
        gran: 'daily',
        preset: '30d',
        startP: null,
        endP: null,
        trendMetric: 'meanRRP',
        detail: null,
        monthlySpikeByKey: new Map()
    };

    const $ = (id) => document.getElementById(id);

    // ── Formatting ──
    function fmtDollar(v) {
        if (!isNum(v)) return '—';
        return '$' + Number(v).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function fmtInt(v) {
        if (!isNum(v)) return '—';
        return Math.round(Number(v)).toLocaleString('en-AU');
    }
    function fmtPct(v) {
        if (!isNum(v)) return '—';
        return Number(v).toFixed(1) + '%';
    }
    function pad2(n) {
        return String(n).padStart(2, '0');
    }
    function formatDateParts(y, m, d) {
        return `${pad2(d)}-${pad2(m)}-${String(y)}`;
    }
    // UI-only formatter: keeps source keys untouched while normalizing all rendered dates.
    function fmtDate(input) {
        if (!input) return '—';
        if (input instanceof Date && !Number.isNaN(input.getTime())) {
            return formatDateParts(input.getFullYear(), input.getMonth() + 1, input.getDate());
        }

        const s = String(input).trim();
        let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); // YYYY-MM-DD
        if (m) return `${m[3]}-${m[2]}-${m[1]}`;

        m = s.match(/^(\d{4})(\d{2})(\d{2})$/); // YYYYMMDD
        if (m) return `${m[3]}-${m[2]}-${m[1]}`;

        m = s.match(/^(\d{4})(\d{2})$/); // YYYYMM (monthly period)
        if (m) return `01-${m[2]}-${m[1]}`;

        const parsed = new Date(s);
        if (!Number.isNaN(parsed.getTime())) return fmtDate(parsed);
        return s;
    }
    function rowDateLabel(row) {
        if (!row) return '—';
        return row.date ? fmtDate(row.date) : periodLabel(row.period);
    }
    function periodLabel(p) {
        if (!p) return '—';
        return fmtDate(String(p));
    }
    function isNum(v) { return v !== null && v !== undefined && Number.isFinite(Number(v)); }
    function avg(arr) {
        const nums = arr.filter(isNum).map(Number);
        return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    }
    function total(arr) {
        return arr.filter(isNum).map(Number).reduce((a, b) => a + b, 0);
    }

    // ── Data Loading ──
    async function loadIndex() {
        const r = await fetch(INDEX_URL, { cache: 'no-store' });
        if (!r.ok) throw new Error('Failed to load data index');
        S.index = await r.json();
    }

    async function loadRegion(region) {
        if (S.data.has(region)) return;
        const r = await fetch(S.index.files[region], { cache: 'no-store' });
        if (!r.ok) throw new Error('Failed to load ' + region);
        S.data.set(region, await r.json());
    }

    async function loadSelected() {
        await Promise.all(S.regions.map(loadRegion));
    }

    // ── Persistence ──
    function saveRegions() {
        try { localStorage.setItem('mi_regions', JSON.stringify(S.regions)); } catch (e) { /* */ }
    }
    function loadSavedRegions() {
        try { return JSON.parse(localStorage.getItem('mi_regions') || '[]').filter(Boolean); } catch (e) { return []; }
    }

    // ── Period Helpers ──
    function allPeriods() {
        const out = [];
        const end = Number(S.index.bounds.maxPeriod);
        let y = Number(String(S.index.bounds.minPeriod).slice(0, 4));
        let m = Number(String(S.index.bounds.minPeriod).slice(4, 6));
        const ey = Number(String(end).slice(0, 4));
        const em = Number(String(end).slice(4, 6));
        while (y < ey || (y === ey && m <= em)) {
            out.push(`${y}${String(m).padStart(2, '0')}`);
            if (++m > 12) { m = 1; y++; }
        }
        return out;
    }

    function applyPreset(preset) {
        const periods = allPeriods();
        S.endP = periods[periods.length - 1];
        if (preset === '30d' || preset === '90d') {
            const cut = new Date(Date.parse(S.index.bounds.maxDate + 'T00:00:00Z') - (preset === '30d' ? 29 : 89) * DAY_MS);
            S.startP = `${cut.getUTCFullYear()}${String(cut.getUTCMonth() + 1).padStart(2, '0')}`;
        } else if (preset === '6m') {
            S.startP = periods[Math.max(periods.length - 6, 0)];
        } else if (preset === '12m') {
            S.startP = periods[Math.max(periods.length - 12, 0)];
        } else if (preset === 'ytd') {
            S.startP = `${String(S.endP).slice(0, 4)}01`;
        } else {
            S.startP = periods[0];
        }
        S.preset = preset;
    }

    // ── Filtering ──
    function rowsFor(region) {
        const d = S.data.get(region);
        if (!d) return [];
        const rows = S.gran === 'daily' ? d.daily : d.monthly;
        return rows.filter(r =>
            String(r.period) >= String(S.startP) &&
            String(r.period) <= String(S.endP)
        );
    }

    function rowsByRegion() {
        const m = new Map();
        S.regions.forEach(r => m.set(r, rowsFor(r)));
        return m;
    }

    function allFlat(rMap) {
        return Array.from(rMap.entries()).flatMap(([reg, rows]) =>
            rows.map(r => ({ ...r, region: reg }))
        );
    }

    // Always available for KPI/summary spike normalization in both views.
    function selectedDailyFlat() {
        return S.regions.flatMap((region) => {
            const d = S.data.get(region);
            if (!d || !Array.isArray(d.daily)) return [];
            return d.daily
                .filter(r =>
                    String(r.period) >= String(S.startP) &&
                    String(r.period) <= String(S.endP)
                )
                .map(r => ({ ...r, region }));
        });
    }

    function buildMonthlySpikeLookup() {
        const lookup = new Map();
        selectedDailyFlat().forEach((r) => {
            const key = `${r.region}:${r.period}`;
            const agg = lookup.get(key) || { spikeDays: 0, totalDays: 0, maxPeak: Number.NEGATIVE_INFINITY };
            agg.totalDays += 1;
            if (isNum(r.maxRRP) && Number(r.maxRRP) > SPIKE_THRESHOLD) agg.spikeDays += 1;
            if (isNum(r.maxRRP)) agg.maxPeak = Math.max(agg.maxPeak, Number(r.maxRRP));
            lookup.set(key, agg);
        });

        lookup.forEach((v) => {
            v.spikeDayPct = v.totalDays > 0 ? (v.spikeDays / v.totalDays) * 100 : 0;
            if (!Number.isFinite(v.maxPeak)) v.maxPeak = null;
        });

        S.monthlySpikeByKey = lookup;
    }

    function monthlySpikeStats(row) {
        const key = `${row.region}:${row.period}`;
        const byDay = S.monthlySpikeByKey.get(key);
        if (byDay && byDay.totalDays > 0) return byDay;

        // Fallback for old data snapshots lacking daily rows.
        const rows = Number(row.rows || 0);
        const high = Number(row.highRRPIntervalCount || 0);
        return {
            spikeDays: null,
            totalDays: null,
            spikeDayPct: rows > 0 ? (high / rows) * 100 : 0,
            maxPeak: isNum(row.maxRRP) ? Number(row.maxRRP) : null
        };
    }

    function monthlyActivityScore(row) {
        const spike = monthlySpikeStats(row);
        const eventRatePerDay = spike.totalDays && spike.totalDays > 0
            ? Number(row.highRRPEventCount || 0) / spike.totalDays
            : 0;
        // Mix day-based exceedance with burstiness of events.
        return Number(spike.spikeDayPct || 0) + eventRatePerDay * 4;
    }

    function validate() {
        if (String(S.startP) > String(S.endP)) {
            setWarn('Start must be before end.');
            return false;
        }
        setWarn('');
        return true;
    }

    function setWarn(msg) {
        const el = $('selWarn');
        el.hidden = !msg;
        el.textContent = msg;
    }

    // ── Build UI Controls ──
    function buildRegionChips() {
        const c = $('regionChips');
        c.innerHTML = S.index.regions.map(r =>
            `<button type="button" class="mi-chip ${S.regions.includes(r) ? 'is-active' : ''}" data-r="${r}">${r}</button>`
        ).join('');
    }

    function initRegionChips() {
        buildRegionChips();
        $('regionChips').addEventListener('click', async (e) => {
            const b = e.target.closest('[data-r]');
            if (!b) return;
            const r = b.dataset.r;
            if (S.regions.includes(r)) {
                if (S.regions.length === 1) return; // keep at least one
                S.regions = S.regions.filter(x => x !== r);
            } else {
                S.regions = [...S.regions, r].sort();
            }
            saveRegions();
            buildRegionChips();
            await loadSelected();
            refresh();
        });
    }

    function buildPresetChips() {
        const presets = [
            { v: '30d', l: '30 days' },
            { v: '90d', l: '90 days' },
            { v: '6m',  l: '6 months' },
            { v: '12m', l: '12 months' },
            { v: 'ytd', l: 'This year' },
            { v: 'all', l: 'All time' }
        ];
        const c = $('presetChips');
        c.innerHTML = presets.map(p =>
            `<button type="button" class="mi-chip ${p.v === S.preset ? 'is-active' : ''}" data-p="${p.v}">${p.l}</button>`
        ).join('');
    }

    function initPresetChips() {
        buildPresetChips();
        $('presetChips').addEventListener('click', (e) => {
            const b = e.target.closest('[data-p]');
            if (!b) return;
            applyPreset(b.dataset.p);
            buildPresetChips();
            refresh();
        });
    }

    function buildGranToggle() {
        const c = $('granToggle');
        c.addEventListener('click', (e) => {
            const b = e.target.closest('[data-value]');
            if (!b) return;
            S.gran = b.dataset.value;
            c.querySelectorAll('[data-value]').forEach(n => n.classList.toggle('is-active', n === b));
            refresh();
        });
    }

    function bindMetricSelect() {
        $('trendMetric').addEventListener('change', (e) => {
            S.trendMetric = e.target.value;
            refresh();
        });
    }

    // ── KPIs ──
    function renderKpis(flat) {
        const avgPrice = avg(flat.map(r => r.meanRRP));
        const medPrice = avg(flat.map(r => r.p50RRP));
        const negCount = total(flat.map(r => r.negativeRRPCount));
        const allRows = total(flat.map(r => r.rowCount));
        const negPct = allRows ? (negCount / allRows * 100) : null;

        // Keep spike KPI normalized to daily exceedance regardless of current granularity.
        const dailyBase = selectedDailyFlat();
        const spikeCount = dailyBase.filter(r => isNum(r.maxRRP) && Number(r.maxRRP) > SPIKE_THRESHOLD).length;
        const spikeDen = dailyBase.length;
        const spikePct = spikeDen ? (spikeCount / spikeDen * 100) : 0;

        const minAll = Math.min(...flat.map(r => Number(r.minRRP)).filter(Number.isFinite));
        const maxAll = Math.max(...flat.map(r => Number(r.maxRRP)).filter(Number.isFinite));
        const volAvg = avg(flat.map((r) => {
            if (isNum(r.volatilityRRP)) return Number(r.volatilityRRP);
            if (isNum(r.maxRRP) && isNum(r.minRRP)) return Number(r.maxRRP) - Number(r.minRRP);
            return null;
        }));

        $('kpiAvgPrice').textContent = fmtDollar(avgPrice);
        $('kpiAvgSub').textContent = avgPrice !== null ? 'per MWh across selected period' : '';

        $('kpiMedianPrice').textContent = fmtDollar(medPrice);
        $('kpiMedSub').textContent = medPrice !== null ? 'typical daily median' : '';

        $('kpiSpikes').textContent = fmtInt(spikeCount);
        $('kpiSpikesSub').textContent = spikeDen
            ? `${spikePct.toFixed(1)}% of days exceeded $${SPIKE_THRESHOLD}/MWh`
            : '';

        $('kpiNegative').textContent = fmtInt(negCount);
        $('kpiNegSub').textContent = negPct !== null ? `${fmtPct(negPct)} of intervals were negative` : '';

        $('kpiRange').textContent = Number.isFinite(minAll) ? `${fmtDollar(minAll)} — ${fmtDollar(maxAll)}` : '—';

        $('kpiVolatility').textContent = fmtDollar(volAvg);
    }

    // ── Freshness Badge ──
    function renderFreshness() {
        const ts = S.index.sourceGeneratedAt;
        if (!ts) { $('freshnessBadge').textContent = 'Unknown'; return; }
        const d = new Date(ts);
        const diff = Math.max(Date.now() - d.getTime(), 0);
        const days = Math.floor(diff / DAY_MS);
        const hrs = Math.floor((diff % DAY_MS) / 3600000);
        $('freshnessBadge').textContent = `Updated ${fmtDate(d)} · ${days}d ${hrs}h ago`;
    }

    // ── SVG Line Chart ──
    function renderLineChart(container, legendContainer, seriesList, opts = {}) {
        if (!seriesList.length || seriesList.every(s => !s.pts.length)) {
            container.innerHTML = '<div class="mi-empty">No data to chart.</div>';
            legendContainer.innerHTML = '';
            return;
        }

        const W = 960, H = opts.height || 280;
        const pad = { t: 20, r: 24, b: 32, l: 52 };
        const iw = W - pad.l - pad.r;
        const ih = H - pad.t - pad.b;

        const allVals = seriesList.flatMap(s => s.pts.map(p => p.v)).filter(Number.isFinite);
        if (!allVals.length) {
            container.innerHTML = '<div class="mi-empty">No plottable values.</div>';
            return;
        }

        let minY = Math.min(...allVals);
        let maxY = Math.max(...allVals);

        // Clamp outliers: cap at 95th-percentile of values to avoid one spike destroying the scale.
        // Out-of-range points are drawn clamped to the top edge so spikes are still visible.
        const sortedVals = [...allVals].sort((a, b) => a - b);
        const p95 = sortedVals[Math.floor(sortedVals.length * 0.95)] ?? sortedVals[sortedVals.length - 1];
        const capY = p95 * 1.2;
        if (capY > minY + 10) maxY = capY;
        if (minY === maxY) { minY -= 1; maxY += 1; }
        const clampY = (v) => Math.min(Math.max(v, minY), maxY);

        // Downsample
        const maxPts = 150;
        const sample = (pts) => {
            if (pts.length <= maxPts) return pts;
            const step = Math.ceil(pts.length / maxPts);
            return pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
        };

        // Build grid lines
        const gridCount = 5;
        let gridLines = '';
        for (let i = 0; i <= gridCount; i++) {
            const f = i / gridCount;
            const y = pad.t + f * ih;
            const val = maxY - f * (maxY - minY);
            gridLines += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" stroke="var(--mi-grid)" />`;
            gridLines += `<text x="${pad.l - 8}" y="${y + 4}" fill="var(--text-muted)" font-size="11" text-anchor="end">$${Math.round(val)}</text>`;
        }

        // Build lines + hit areas
        let linesHtml = '';
        const allSampled = [];

        seriesList.forEach((series, si) => {
            const pts = sample(series.pts);
            allSampled.push(pts);
            const color = COLORS[si % COLORS.length];
            const coords = pts.map((p, i) => ({
                x: pad.l + (i / Math.max(pts.length - 1, 1)) * iw,
                y: pad.t + ((maxY - clampY(p.v)) / (maxY - minY)) * ih,
                p
            }));
            const polyline = coords.map(c => `${c.x},${c.y}`).join(' ');
            linesHtml += `<polyline points="${polyline}" stroke="${color}" />`;

            // Invisible wider hit targets per point
            coords.forEach((c, ci) => {
                linesHtml += `<circle cx="${c.x}" cy="${c.y}" r="12" fill="transparent" class="hit-target" data-si="${si}" data-pi="${ci}" />`;
                linesHtml += `<circle cx="${c.x}" cy="${c.y}" r="0" fill="${color}" class="hover-dot" data-si="${si}" data-pi="${ci}" />`;
            });
        });

        container.innerHTML = `
            <div class="mi-tooltip" id="chartTooltip"></div>
            <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
                ${gridLines}
                ${linesHtml}
            </svg>
        `;

        // Hover interaction
        const tooltip = container.querySelector('.mi-tooltip');
        const svg = container.querySelector('svg');

        svg.addEventListener('mouseover', (e) => {
            const hit = e.target.closest('.hit-target');
            if (!hit) return;
            const si = Number(hit.dataset.si);
            const pi = Number(hit.dataset.pi);
            const pt = allSampled[si][pi];
            const dot = svg.querySelector(`circle.hover-dot[data-si="${si}"][data-pi="${pi}"]`);
            if (dot) dot.setAttribute('r', '4');

            const label = pt.label || pt.key || '';
            const region = seriesList[si].label;
            tooltip.innerHTML = `<strong>${region}</strong> ${label}<br>${fmtDollar(pt.v)}`;
            tooltip.classList.add('is-visible');

            const rect = container.getBoundingClientRect();
            const cx = Number(hit.getAttribute('cx'));
            const cy = Number(hit.getAttribute('cy'));
            const svgRect = svg.getBoundingClientRect();
            const sx = svgRect.width / W;
            const sy = svgRect.height / H;
            const anchorX = cx * sx + svgRect.left - rect.left;
            const anchorY = cy * sy + svgRect.top - rect.top;
            const margin = 8;
            const ttRect = tooltip.getBoundingClientRect();
            const ttW = ttRect.width || 160;
            const ttH = ttRect.height || 48;

            let left = anchorX + 12;
            if (left + ttW > rect.width - margin) left = anchorX - ttW - 12;
            left = Math.max(margin, Math.min(left, rect.width - ttW - margin));

            let top = anchorY - ttH - 10;
            if (top < margin) top = anchorY + 10;
            top = Math.max(margin, Math.min(top, rect.height - ttH - margin));

            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
        });

        svg.addEventListener('mouseout', (e) => {
            const hit = e.target.closest('.hit-target');
            if (!hit) return;
            const dot = svg.querySelector(`circle.hover-dot[data-si="${hit.dataset.si}"][data-pi="${hit.dataset.pi}"]`);
            if (dot) dot.setAttribute('r', '0');
            tooltip.classList.remove('is-visible');
        });

        // Legend
        legendContainer.innerHTML = seriesList.map((s, i) =>
            `<span class="mi-legend-item"><span class="mi-legend-dot" style="background:${COLORS[i % COLORS.length]}"></span>${s.label}</span>`
        ).join('');
    }

    // ── Smart Summary ──
    function renderSummary(flat) {
        const el = $('summaryBanner');
        if (!flat.length) { el.hidden = true; return; }

        const regionList = S.regions.join(', ');
        const presetLabel = {
            '30d': 'last 30 days', '90d': 'last 90 days',
            '6m': 'last 6 months', '12m': 'last 12 months',
            'ytd': 'this year', 'all': 'all available data'
        }[S.preset] || 'selected period';
        const avgP = avg(flat.map(r => r.meanRRP));
        const dailyBase = selectedDailyFlat();
        const spikeCount = dailyBase.filter(r => isNum(r.maxRRP) && Number(r.maxRRP) > SPIKE_THRESHOLD).length;
        const spikePct = dailyBase.length ? (spikeCount / dailyBase.length * 100) : 0;
        const spikeDay = dailyBase.slice().sort((a, b) => Number(b.maxRRP) - Number(a.maxRRP))[0];
        const negCount = total(flat.map(r => r.negativeRRPCount));
        const totalRows = total(flat.map(r => r.rowCount || 0));
        const negPct = totalRows ? (negCount / totalRows * 100) : 0;

        // Trend: compare first half avg vs second half avg
        // Sort flat by date before splitting
        const sorted = flat.slice().sort((a, b) => String(a.date || a.period).localeCompare(String(b.date || b.period)));
        const mid = Math.floor(sorted.length / 2);
        const firstHalfAvg = avg(sorted.slice(0, mid).map(r => r.meanRRP));
        const secondHalfAvg = avg(sorted.slice(mid).map(r => r.meanRRP));
        const trendPct = firstHalfAvg && Math.abs(firstHalfAvg) > 0.01
            ? ((secondHalfAvg - firstHalfAvg) / Math.abs(firstHalfAvg) * 100)
            : 0;
        const trendWord = trendPct > 8 ? 'rising' : trendPct < -8 ? 'falling' : 'relatively stable';
        const trendArrow = trendPct > 8 ? '\u2197' : trendPct < -8 ? '\u2198' : '\u2192';

        const signal = spikePct > 12 ? 'high' : spikePct > 4 ? 'elevated' : 'normal';
        const signalLabel = { high: 'High market activity', elevated: 'Elevated activity', normal: 'Normal market conditions' }[signal];

        const parts = [];
        parts.push(`Over the <strong>${presetLabel}</strong>, ${regionList} prices averaged <strong>${fmtDollar(avgP)}/MWh</strong>.`);

        if (spikeCount > 0) {
            const n = spikeCount === 1 ? '1 day' : `${spikeCount} days`;
            parts.push(`Daily spike pressure was <strong>${n}</strong> above $${SPIKE_THRESHOLD}/MWh (${spikePct.toFixed(1)}% of days), peaking at <strong>${fmtDollar(spikeDay?.maxRRP)}</strong>${spikeDay ? ` on ${rowDateLabel(spikeDay)}` : ''}.`);
        } else {
            parts.push(`No days exceeded the $${SPIKE_THRESHOLD}/MWh spike threshold — prices stayed contained.`);
        }

        if (S.gran === 'monthly') {
            parts.push('Monthly charts below are aggregated, while spike percentages above stay normalized to daily exceedance for consistency.');
        }

        if (negPct > 1.5) {
            parts.push(`Negative prices made up <strong>${negPct.toFixed(1)}%</strong> of intervals, reflecting periods of renewable oversupply.`);
        }

        parts.push(`The overall price direction is <strong>${trendWord} ${trendArrow}</strong>${Math.abs(trendPct) > 8 ? ` (${Math.abs(trendPct).toFixed(0)}% ${trendPct > 0 ? 'higher' : 'lower'} than at the start of the period)` : ''}.`);

        const icon = { high: '\u26a1', elevated: '\u2197', normal: '\u2713' }[signal];
        el.innerHTML = `
            <div class="mi-summary__icon mi-summary__icon--${signal}">${icon}</div>
            <div class="mi-summary__body">
                <div class="mi-summary__signal mi-summary__signal--${signal}">${signalLabel}</div>
                <p class="mi-summary__text">${parts.join(' ')}</p>
            </div>
        `;
        el.hidden = false;
        el.dataset.signal = signal;
    }

    // ── Render sections ──

    function renderTrend(rMap) {
        const metric = S.trendMetric;
        const metricLabels = { meanRRP: 'Avg Price', p50RRP: 'Median', p95RRP: '95th Pct', maxRRP: 'Peak' };
        const series = Array.from(rMap.entries()).map(([region, rows]) => ({
            label: region,
            pts: rows.map(r => ({
                key: r.date || r.period,
                label: rowDateLabel(r),
                v: Number(r[metric])
            })).filter(p => Number.isFinite(p.v))
        })).filter(s => s.pts.length);

        renderLineChart($('trendChart'), $('trendLegend'), series, { height: 300 });
    }

    function heatBand(row) {
        // Daily: colour by peak price
        const max = Number(row.maxRRP);
        if (!Number.isFinite(max)) return 1;
        if (max < 100) return 1;
        if (max < 200) return 2;
        if (max < SPIKE_THRESHOLD) return 3;
        if (max < 1000) return 4;
        return 5;
    }

    function renderHeatmap(flat) {
        const el = $('heatmap');
        if (!flat.length) { el.innerHTML = ''; return; }

        const sorted = flat.slice().sort((a, b) =>
            String(a.date || a.period).localeCompare(String(b.date || b.period))
        );
        // For monthly, show all; for daily, limit to 180
        const isMonthly = S.gran === 'monthly';
        const sampled = isMonthly ? sorted : (sorted.length > 180 ? sorted.filter((_, i) => i % Math.ceil(sorted.length / 180) === 0 || i === sorted.length - 1) : sorted);

        // Monthly colouring uses quantile ranking of activity scores so variation remains visible.
        const monthBandByIdx = new Map();
        if (isMonthly && sampled.length) {
            const ranked = sampled
                .map((r, i) => ({ i, score: monthlyActivityScore(r) }))
                .filter(x => Number.isFinite(x.score))
                .sort((a, b) => a.score - b.score);
            ranked.forEach((entry, rank) => {
                const q = ranked.length === 1 ? 1 : rank / (ranked.length - 1);
                const band = q < 0.2 ? 1 : q < 0.4 ? 2 : q < 0.6 ? 3 : q < 0.8 ? 4 : 5;
                monthBandByIdx.set(entry.i, band);
            });
        }

        // Use larger tiles with labels for monthly
        if (isMonthly) el.classList.add('mi-heatmap--monthly');
        else el.classList.remove('mi-heatmap--monthly');

        el.innerHTML = sampled.map((r, i) => {
            const key = `${r.region}:${r.date || r.period}`;
            const label = rowDateLabel(r);
            const sel = S.detail && S.detail.key === key ? ' is-selected' : '';
            const tileLabel = isMonthly ? `<span class="mi-heat__label">${r.region}<br>${periodLabel(r.period)}</span>` : '';
            const m = monthlySpikeStats(r);
            const spikeTip = isMonthly
                ? `spike days ${m.spikeDays ?? '—'}/${m.totalDays ?? '—'} (${Number(m.spikeDayPct || 0).toFixed(1)}%), events ${fmtInt(r.highRRPEventCount)}`
                : `max ${fmtDollar(r.maxRRP)}`;
            const band = isMonthly ? (monthBandByIdx.get(i) || 1) : heatBand(r);
            return `<div class="mi-heat mi-heat--${band}${sel}" data-idx="${i}" title="${r.region} ${label}: ${spikeTip}">${tileLabel}</div>`;
        }).join('');

        el.onclick = (e) => {
            const t = e.target.closest('[data-idx]');
            if (!t) return;
            const row = sampled[Number(t.dataset.idx)];
            S.detail = { key: `${row.region}:${row.date || row.period}`, row };
            renderDetail();
            renderHeatmap(flat); // re-render to update selection
        };
    }

    function renderDetail() {
        const p = $('detailPane');
        const isMonthly = S.gran === 'monthly';
        if (!S.detail || !S.detail.row) {
            p.innerHTML = `<div class="mi-detail__empty">Click a tile or row to inspect a ${isMonthly ? 'month' : 'day'}.</div>`;
            return;
        }

        const r = S.detail.row;
        const spike = isNum(r.maxRRP) && Number(r.maxRRP) > SPIKE_THRESHOLD;
        const negEvents = Number(r.negativeRRPCount || 0);
        const statusClass = spike ? 'danger' : negEvents > 50 ? 'warn' : 'ok';
        const statusLabel = spike ? 'Price spike detected' : negEvents > 50 ? 'High negative events' : 'Normal trading';

        let items;
        if (isMonthly) {
            const spike = monthlySpikeStats(r);
            const spikePct = `${Number(spike.spikeDayPct || 0).toFixed(1)}%`;
            items = `
                <div class="mi-detail__item">
                    <div class="mi-detail__item-label">Region</div>
                    <div class="mi-detail__item-value">${r.region || '—'}</div>
                </div>
                <div class="mi-detail__item">
                    <div class="mi-detail__item-label">Month</div>
                    <div class="mi-detail__item-value">${periodLabel(r.period)}</div>
                </div>
                <div class="mi-detail__item">
                    <div class="mi-detail__item-label">Avg Price</div>
                    <div class="mi-detail__item-value">${fmtDollar(r.meanRRP)}</div>
                </div>
                <div class="mi-detail__item">
                    <div class="mi-detail__item-label">Median Price</div>
                    <div class="mi-detail__item-value">${fmtDollar(r.p50RRP)}</div>
                </div>
                <div class="mi-detail__item">
                    <div class="mi-detail__item-label">Peak Price</div>
                    <div class="mi-detail__item-value">${fmtDollar(r.maxRRP)}</div>
                </div>
                <div class="mi-detail__item">
                    <div class="mi-detail__item-label">Low Price</div>
                    <div class="mi-detail__item-value">${fmtDollar(r.minRRP)}</div>
                </div>
                <div class="mi-detail__item">
                    <div class="mi-detail__item-label">Spike Days (&gt;$${SPIKE_THRESHOLD})</div>
                    <div class="mi-detail__item-value">${spike.spikeDays ?? '—'} / ${spike.totalDays ?? '—'} (${spikePct})</div>
                </div>
                <div class="mi-detail__item">
                    <div class="mi-detail__item-label">Spike Events</div>
                    <div class="mi-detail__item-value">${fmtInt(r.highRRPEventCount)}</div>
                </div>
                <div class="mi-detail__item">
                    <div class="mi-detail__item-label">Longest Spike</div>
                    <div class="mi-detail__item-value">${isNum(r.longestHighRRPEventMinutes) ? Math.round(Number(r.longestHighRRPEventMinutes)) + ' min' : '—'}</div>
                </div>
                <div class="mi-detail__item">
                    <div class="mi-detail__item-label">Negative Events</div>
                    <div class="mi-detail__item-value">${fmtInt(r.negativeRRPCount)}</div>
                </div>`;
        } else {
            items = `
                <div class="mi-detail__item">
                    <div class="mi-detail__item-label">Region</div>
                    <div class="mi-detail__item-value">${r.region || '—'}</div>
                </div>
                <div class="mi-detail__item">
                    <div class="mi-detail__item-label">Date</div>
                    <div class="mi-detail__item-value">${rowDateLabel(r)}</div>
                </div>
                <div class="mi-detail__item">
                    <div class="mi-detail__item-label">Average Price</div>
                    <div class="mi-detail__item-value">${fmtDollar(r.meanRRP)}</div>
                </div>
                <div class="mi-detail__item">
                    <div class="mi-detail__item-label">Peak Price</div>
                    <div class="mi-detail__item-value">${fmtDollar(r.maxRRP)}</div>
                </div>
                <div class="mi-detail__item">
                    <div class="mi-detail__item-label">Low Price</div>
                    <div class="mi-detail__item-value">${fmtDollar(r.minRRP)}</div>
                </div>
                <div class="mi-detail__item">
                    <div class="mi-detail__item-label">Price Spread</div>
                    <div class="mi-detail__item-value">${fmtDollar(r.volatilityRRP)}</div>
                </div>
                <div class="mi-detail__item">
                    <div class="mi-detail__item-label">Negative Events</div>
                    <div class="mi-detail__item-value">${fmtInt(r.negativeRRPCount)}</div>
                </div>
                <div class="mi-detail__item">
                    <div class="mi-detail__item-label">Peak Hour</div>
                    <div class="mi-detail__item-value">${isNum(r.peakHour) ? String(Math.round(Number(r.peakHour))).padStart(2, '0') + ':00' : '—'}</div>
                </div>`;
        }

        p.innerHTML = `
            <div class="mi-detail__grid">
                ${items}
                <div class="mi-detail__status mi-detail__status--${statusClass}">${statusLabel}</div>
            </div>
        `;
    }

    function renderRegionCards(rMap) {
        const el = $('regionCards');
        const windowSize = S.gran === 'daily' ? 7 : 3;
        const cards = Array.from(rMap.entries()).map(([region, rows]) => {
            if (!rows.length) return '';
            const recent = rows.slice(-windowSize);
            const avgP = avg(recent.map(r => r.meanRRP));
            const spikes = recent.filter(r => isNum(r.maxRRP) && Number(r.maxRRP) > SPIKE_THRESHOLD).length;
            const negCount = total(recent.map(r => r.negativeRRPCount));
            const spread = avg(recent.map(r => r.volatilityRRP));
            const signal = spread > 500 ? 'extreme' : spread > 200 ? 'volatile' : 'stable';
            const signalLabel = signal === 'extreme' ? 'Extreme volatility' : signal === 'volatile' ? 'Above-average volatility' : 'Stable pricing';

            return `
                <div class="mi-rcard">
                    <div class="mi-rcard__region">${region}</div>
                    <div class="mi-rcard__metric"><span>Avg Price (${windowSize}${S.gran === 'daily' ? 'd' : 'm'})</span><span class="mi-rcard__val">${fmtDollar(avgP)}</span></div>
                    <div class="mi-rcard__metric"><span>Price Spikes</span><span class="mi-rcard__val">${spikes}</span></div>
                    <div class="mi-rcard__metric"><span>Negative Events</span><span class="mi-rcard__val">${fmtInt(negCount)}</span></div>
                    <div class="mi-rcard__metric"><span>Avg Spread</span><span class="mi-rcard__val">${fmtDollar(spread)}</span></div>
                    <span class="mi-rcard__signal mi-rcard__signal--${signal}">${signalLabel}</span>
                </div>
            `;
        });
        el.innerHTML = cards.join('');
    }

    function riskScore(row) {
        if (S.gran === 'monthly') {
            const spikePct = Number(monthlySpikeStats(row).spikeDayPct || 0);
            const avgP = Number(row.meanRRP || 0);
            const tail = Number(row.highRRPEventCount || 0) * 2;
            return spikePct * 12 + Math.max(avgP, 0) * 0.25 + tail;
        }
        const spread = Number(row.volatilityRRP || row.maxRRP || 0);
        const tail = Number(row.hoursAboveP95 || 0) * 25;
        return spread + tail;
    }

    function renderRankingHeader() {
        const titleEl = $('rankingCardTitle');
        const hintEl = $('rankingCardHint');
        if (!titleEl || !hintEl) return;

        if (S.gran === 'monthly') {
            titleEl.textContent = 'Most Volatile Months';
            hintEl.textContent = 'Ranked by monthly spike intensity and average price stress';
        } else {
            titleEl.textContent = 'Most Volatile Days';
            hintEl.textContent = 'Ranked by price spread and spike persistence';
        }
    }

    function renderActivityHeader() {
        const titleEl = $('activityCardTitle');
        const hintEl = $('activityCardHint');
        if (!titleEl || !hintEl) return;

        if (S.gran === 'monthly') {
            titleEl.textContent = 'Monthly Activity';
            hintEl.textContent = 'Each tile is one month — colour shows spike interval rate';
        } else {
            titleEl.textContent = 'Price Activity';
            hintEl.textContent = 'Each tile is one day — colour shows intensity';
        }
    }

    function renderRanking(flat) {
        const isMonthly = S.gran === 'monthly';
        const ranked = flat.slice().sort((a, b) => riskScore(b) - riskScore(a)).slice(0, 5);
        const el = $('rankingList');
        el.innerHTML = ranked.map((r, i) => {
            const score = riskScore(r);
            const spikePct = Number(monthlySpikeStats(r).spikeDayPct || 0);
            const cls = isMonthly
                ? (spikePct > 8 ? 'high' : spikePct > 2 ? 'med' : 'low')
                : (score > 800 ? 'high' : score > 250 ? 'med' : 'low');
            const key = `${r.region}:${r.date || r.period}`;
            const sub = isMonthly
                ? `Spike ${spikePct.toFixed(1)}% · Avg ${fmtDollar(r.meanRRP)} · Median ${fmtDollar(r.p50RRP)}`
                : `Peak ${fmtDollar(r.maxRRP)} · Spread ${fmtDollar(r.volatilityRRP)}`;
            const badge = isMonthly
                ? `${spikePct.toFixed(1)}% spike`
                : fmtDollar(r.maxRRP);
            return `
                <div class="mi-rank-row" data-key="${key}" data-idx="${i}">
                    <span class="mi-rank-pos">${i + 1}</span>
                    <div class="mi-rank-info">
                        <div class="mi-rank-title">${r.region} — ${rowDateLabel(r)}</div>
                        <div class="mi-rank-sub">${sub}</div>
                    </div>
                    <span class="mi-rank-badge mi-rank-badge--${cls}">${badge}</span>
                </div>
            `;
        }).join('');

        el.onclick = (e) => {
            const row = e.target.closest('[data-idx]');
            if (!row) return;
            const r = ranked[Number(row.dataset.idx)];
            S.detail = { key: `${r.region}:${r.date || r.period}`, row: r };
            renderDetail();
            // Scroll to detail
            $('detailCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        };
    }

    function renderMonthly() {
        // Interactive grouped chart with metric toggle for readability.
        const container = $('monthlyChart');
        const legendEl = $('monthlyLegend');

        const allSeries = S.regions.map(region => {
            const d = S.data.get(region);
            if (!d) return null;
            const rows = d.monthly.filter(r =>
                String(r.period) >= String(S.startP) && String(r.period) <= String(S.endP)
            );
            return { region, rows };
        }).filter(Boolean).filter(s => s.rows.length);

        if (!allSeries.length) {
            container.innerHTML = '<div class="mi-empty">No monthly data to chart.</div>';
            legendEl.innerHTML = '';
            return;
        }
        const metrics = {
            avg: {
                key: 'avg',
                label: 'Average Price',
                format: (v) => fmtDollar(v),
                axisLabel: (v) => `$${Math.round(v)}`,
                value: (r) => Number(r.meanRRP)
            },
            median: {
                key: 'median',
                label: 'Median Price',
                format: (v) => fmtDollar(v),
                axisLabel: (v) => `$${Math.round(v)}`,
                value: (r) => Number(r.p50RRP)
            },
            spike: {
                key: 'spike',
                label: 'Spike Day Rate',
                format: (v) => `${Number(v).toFixed(1)}%`,
                axisLabel: (v) => `${Math.round(v)}%`,
                value: (r) => Number(monthlySpikeStats(r).spikeDayPct || 0)
            }
        };

        const allPeriods = [...new Set(allSeries.flatMap(s => s.rows.map(r => String(r.period))))].sort();
        const periodIndex = new Map(allPeriods.map((p, i) => [p, i]));
        const N = allPeriods.length;
        const M = allSeries.length;

        let activeMetric = container.dataset.metric;
        if (!metrics[activeMetric]) activeMetric = 'avg';

        function draw(metricKey) {
            const metric = metrics[metricKey];
            const W = 960, H = 340;
            const pad = { t: 30, r: 20, b: 46, l: 60 };
            const iw = W - pad.l - pad.r;
            const ih = H - pad.t - pad.b;
            const slotW = iw / Math.max(N, 1);
            const gap = 3;
            const barW = Math.max(4, Math.floor((slotW - (M + 1) * gap) / Math.max(M, 1)));

            const vals = allSeries.flatMap(s => s.rows.map(metric.value)).filter(Number.isFinite).sort((a, b) => a - b);
            if (!vals.length) {
                container.innerHTML = '<div class="mi-empty">No plottable monthly values.</div>';
                legendEl.innerHTML = '';
                return;
            }

            const p98 = vals[Math.floor(vals.length * 0.98)] ?? vals[vals.length - 1];
            const yMin = metric.key === 'spike' ? 0 : Math.min(0, vals[0] || 0);
            let yMax = Math.max(p98 * 1.12, metric.key === 'spike' ? 5 : 20);
            if (yMax <= yMin) yMax = yMin + 10;

            const xBar = (pIdx, si) =>
                pad.l + (pIdx + 0.5) * slotW - (M * barW + (M - 1) * gap) / 2 + si * (barW + gap);
            const yScale = (v) => pad.t + (yMax - Math.min(Math.max(v, yMin), yMax)) / (yMax - yMin) * ih;
            const yZero = yScale(0);

            let grid = '';
            for (let i = 0; i <= 5; i++) {
                const f = i / 5;
                const y = pad.t + f * ih;
                const yVal = yMax - f * (yMax - yMin);
                grid += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" stroke="var(--mi-grid)" />`;
                grid += `<text x="${pad.l - 8}" y="${y + 4}" fill="var(--text-muted)" font-size="11" text-anchor="end">${metric.axisLabel(yVal)}</text>`;
            }

            let bars = '';
            const hitData = [];

            allSeries.forEach((s, si) => {
                const color = COLORS[si % COLORS.length];
                s.rows.forEach((r) => {
                    const pIdx = periodIndex.get(String(r.period));
                    if (pIdx === undefined) return;

                    const v = metric.value(r);
                    if (!Number.isFinite(v)) return;

                    const x = xBar(pIdx, si);
                    const y = yScale(v);
                    const top = Math.min(y, yZero);
                    const bot = Math.max(y, yZero);
                    const h = Math.max(1, bot - top);

                    bars += `<rect x="${x}" y="${top}" width="${barW}" height="${h}" rx="3" fill="${color}" opacity="0.84" />`;

                    // Show reference marker from a second metric to aid interpretation.
                    if (metric.key === 'avg' && Number.isFinite(Number(r.p50RRP))) {
                        const yMed = yScale(Number(r.p50RRP));
                        const mY = Math.min(Math.max(yMed, top), bot);
                        bars += `<line x1="${x}" x2="${x + barW}" y1="${mY}" y2="${mY}" stroke="white" stroke-width="2" opacity="0.95" />`;
                    }
                    if (metric.key !== 'spike') {
                        const sp = Number(r.rows) > 0 ? (Number(r.highRRPIntervalCount || 0) / Number(r.rows)) * 100 : 0;
                        if (sp > 0.5) {
                            const tx = x + barW / 2;
                            const op = Math.min(0.9, 0.30 + sp / 20);
                            bars += `<polygon points="${tx},${top - 6} ${x},${top} ${x + barW},${top}" fill="#ff7b72" opacity="${op.toFixed(2)}" />`;
                        }
                    }

                    const hi = hitData.length;
                    hitData.push({ row: r, color });
                    bars += `<rect x="${x}" y="${top - 10}" width="${barW}" height="${h + 20}" fill="transparent" class="mi-bar-hit" data-hi="${hi}" />`;
                });
            });

            let xLabels = '';
            const step = Math.max(1, Math.ceil(N / 12));
            allPeriods.forEach((p, i) => {
                if (i % step === 0 || i === N - 1) {
                    const x = pad.l + (i + 0.5) * slotW;
                    xLabels += `<text x="${x}" y="${H - 8}" fill="var(--text-muted)" font-size="10" text-anchor="middle">${periodLabel(p)}</text>`;
                }
            });

            container.innerHTML = `
                <div class="mi-chart-tools" id="monthlyTools" aria-label="Monthly chart metric selector">
                    <button type="button" class="mi-chip ${metricKey === 'avg' ? 'is-active' : ''}" data-metric="avg">Avg $</button>
                    <button type="button" class="mi-chip ${metricKey === 'median' ? 'is-active' : ''}" data-metric="median">Median $</button>
                    <button type="button" class="mi-chip ${metricKey === 'spike' ? 'is-active' : ''}" data-metric="spike">Spike %</button>
                </div>
                <div class="mi-chart-meta">Viewing: <strong>${metric.label}</strong></div>
                <div class="mi-tooltip" id="monthlyTooltip"></div>
                <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
                    ${grid}
                    ${bars}
                    ${xLabels}
                </svg>
            `;

            container.dataset.metric = metricKey;
            const svg = container.querySelector('svg');
            const tooltip = container.querySelector('#monthlyTooltip');
            const tools = container.querySelector('#monthlyTools');

            tools.onclick = (e) => {
                const btn = e.target.closest('[data-metric]');
                if (!btn) return;
                const m = btn.dataset.metric;
                if (!metrics[m] || m === metricKey) return;
                draw(m);
            };

            svg.onmousemove = (e) => {
                const hit = e.target.closest('.mi-bar-hit');
                if (!hit) {
                    tooltip.classList.remove('is-visible');
                    return;
                }
                const d = hitData[Number(hit.dataset.hi)];
                if (!d) return;
                const r = d.row;
                const spikePct = Number(r.rows) > 0
                    ? Number(monthlySpikeStats(r).spikeDayPct || 0)
                    : 0;
                tooltip.innerHTML = `
                    <strong>${r.region}</strong> — ${periodLabel(r.period)}<br>
                    Avg: ${fmtDollar(r.meanRRP)} · Median: ${fmtDollar(r.p50RRP)}<br>
                    Spike days: ${spikePct.toFixed(1)}% · Peak: ${fmtDollar(r.maxRRP)}
                `;
                tooltip.classList.add('is-visible');
                const rect = container.getBoundingClientRect();
                const x = e.clientX - rect.left + 14;
                const y = e.clientY - rect.top - 14;
                tooltip.style.left = Math.min(x, rect.width - 240) + 'px';
                tooltip.style.top = Math.max(6, y - 18) + 'px';
            };
            svg.onmouseleave = () => tooltip.classList.remove('is-visible');

            const regionLegend = allSeries.map((s, i) =>
                `<span class="mi-legend-item"><span class="mi-legend-dot" style="background:${COLORS[i % COLORS.length]}"></span>${s.region}</span>`
            ).join('');
            legendEl.innerHTML = regionLegend +
                `<span class="mi-legend-item"><span style="display:inline-block;width:16px;height:2px;background:white;border:1px solid rgba(128,128,128,0.4);vertical-align:middle;margin-right:4px"></span>Median marker (Avg view)</span>` +
                `<span class="mi-legend-item"><span style="display:inline-block;width:0;height:0;border-style:solid;border-width:0 5px 8px 5px;border-color:transparent transparent #ff7b72 transparent;vertical-align:middle;margin-right:4px"></span>Spike cue</span>`;
        }

        draw(activeMetric);
    }

    // ── Main Refresh ──
    function refresh() {
        if (!validate()) {
            $('emptyState').hidden = false;
            return;
        }

        const rMap = rowsByRegion();
        const flat = allFlat(rMap);
        const hasData = flat.length > 0;
        buildMonthlySpikeLookup();

        $('emptyState').hidden = hasData;
        if (!hasData) {
            [$('kpiAvgPrice'), $('kpiMedianPrice'), $('kpiSpikes'), $('kpiNegative'), $('kpiRange'), $('kpiVolatility')]
                .forEach(el => el.textContent = '—');
            $('trendChart').innerHTML = '<div class="mi-empty">No data to display.</div>';
            $('trendLegend').innerHTML = '';
            $('heatmap').innerHTML = '';
            $('regionCards').innerHTML = '';
            $('rankingList').innerHTML = '';
            $('monthlyChart').innerHTML = '';
            $('monthlyLegend').innerHTML = '';
            return;
        }

        renderKpis(flat);
        renderSummary(flat);
        // Update detail panel title for granularity
        const detailTitle = $('detailCardTitle');
        if (detailTitle) detailTitle.textContent = S.gran === 'monthly' ? 'Month Detail' : 'Day Detail';
        renderRankingHeader();
        renderActivityHeader();
        renderTrend(rMap);
        renderHeatmap(flat);
        renderRegionCards(rMap);
        renderRanking(flat);
        renderMonthly();
        renderDetail();
    }

    // ── Init ──
    async function init() {
        await loadIndex();
        renderFreshness();

        // Restore or default regions
        const saved = loadSavedRegions().filter(r => S.index.regions.includes(r));
        S.regions = saved.length ? saved : S.index.defaults.regions.slice();
        if (!S.regions.length) S.regions = S.index.regions.slice(0, 1);

        applyPreset(S.index.defaults.preset);

        initRegionChips();
        initPresetChips();
        buildGranToggle();
        bindMetricSelect();
        await loadSelected();
        refresh();
    }

    let started = false;
    const startApp = () => {
        if (started) return;
        started = true;
        init().catch((err) => {
            const el = $('selWarn');
            if (el) {
                el.hidden = false;
                el.textContent = err && err.message ? err.message : String(err);
            }
        });
    };

    if (window.AppShell && typeof window.AppShell.init === 'function') {
        window.AppShell.init({
            pageName: 'market-insights',
            autoMetrics: true,
            onReady: () => startApp()
        }).catch(() => startApp());
    } else {
        startApp();
    }
})();
