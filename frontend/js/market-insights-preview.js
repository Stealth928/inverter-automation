(function () {
    'use strict';

    var DEFAULT_REGION = 'NSW';
    var SPIKE_THRESHOLD = 300;
    var marketData = window.AemoMarketData;
    var state = {
        index: null,
        regions: new Map(),
        selectedRegion: DEFAULT_REGION,
        range: 30,
        loading: false
    };

    var refs = {
        freshness: document.getElementById('previewFreshness'),
        headline: document.getElementById('previewHeadline'),
        summary: document.getElementById('previewSummary'),
        regionLabel: document.getElementById('previewRegionLabel'),
        windowLabel: document.getElementById('previewWindowLabel'),
        coverage: document.getElementById('previewCoverage'),
        regionChips: document.getElementById('previewRegionChips'),
        rangeChips: document.getElementById('previewRangeChips'),
        avgPrice: document.getElementById('previewAvgPrice'),
        peakPrice: document.getElementById('previewPeakPrice'),
        peakMeta: document.getElementById('previewPeakMeta'),
        negative: document.getElementById('previewNegative'),
        volatility: document.getElementById('previewVolatility'),
        spikeDays: document.getElementById('previewSpikeDays'),
        lowestPrice: document.getElementById('previewLowestPrice'),
        lowestMeta: document.getElementById('previewLowestMeta'),
        trendChart: document.getElementById('previewTrendChart'),
        trendCaption: document.getElementById('previewTrendCaption'),
        takeaways: document.getElementById('previewTakeaways'),
        regionCards: document.getElementById('previewRegionCards'),
        rankingList: document.getElementById('previewRankingList'),
        summaryBand: document.getElementById('previewSummaryBand')
    };

    if (!refs.regionChips || !refs.rangeChips || typeof window.fetch !== 'function' || !marketData) return;

    function isFiniteNumber(value) {
        return Number.isFinite(Number(value));
    }

    function average(values) {
        var numeric = values.filter(isFiniteNumber).map(Number);
        if (!numeric.length) return null;
        return numeric.reduce(function (sum, value) { return sum + value; }, 0) / numeric.length;
    }

    function formatCurrency(value) {
        if (!isFiniteNumber(value)) return '--';
        return '$' + Math.round(Number(value)).toLocaleString('en-AU') + '/MWh';
    }

    function formatSignedCurrency(value) {
        if (!isFiniteNumber(value)) return '--';
        var rounded = Math.round(Number(value));
        return (rounded > 0 ? '$' : '-$') + Math.abs(rounded).toLocaleString('en-AU') + '/MWh';
    }

    function formatCount(value) {
        if (!isFiniteNumber(value)) return '--';
        return Math.round(Number(value)).toLocaleString('en-AU');
    }

    function formatDate(value) {
        if (!value) return '--';
        var parsed = new Date(String(value) + 'T00:00:00Z');
        if (Number.isNaN(parsed.getTime())) return String(value);
        return new Intl.DateTimeFormat('en-AU', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        }).format(parsed);
    }

    function getRegionHealth(region) {
        var regions = state.index && state.index.dataworks && Array.isArray(state.index.dataworks.regions) ? state.index.dataworks.regions : [];
        return regions.find(function (entry) { return entry.region === region; }) || null;
    }

    async function loadIndex() {
        if (state.index) return state.index;
        state.index = await marketData.loadIndex();
        return state.index;
    }

    async function loadRegion(region) {
        if (state.regions.has(region)) return state.regions.get(region);
        var payload = await marketData.loadRegion(region, await loadIndex());
        state.regions.set(region, payload);
        return payload;
    }

    function getRows(payload) {
        var rows = Array.isArray(payload && payload.daily) ? payload.daily : [];
        return rows.slice(-state.range);
    }

    function summarizeRows(rows) {
        var peakRow = null;
        var lowRow = null;
        var negativeIntervals = 0;
        var spikeDays = 0;

        rows.forEach(function (row) {
            var peak = Number(row.maxRRP);
            var mean = Number(row.meanRRP);
            var negative = Number(row.negativeRRPCount);
            if (!peakRow || (isFiniteNumber(peak) && peak > Number(peakRow.maxRRP))) peakRow = row;
            if (!lowRow || (isFiniteNumber(mean) && mean < Number(lowRow.meanRRP))) lowRow = row;
            if (isFiniteNumber(negative)) negativeIntervals += negative;
            if (isFiniteNumber(peak) && peak > SPIKE_THRESHOLD) spikeDays += 1;
        });

        return {
            avgPrice: average(rows.map(function (row) { return row.meanRRP; })),
            avgVolatility: average(rows.map(function (row) { return row.volatilityRRP; })),
            negativeIntervals: negativeIntervals,
            spikeDays: spikeDays,
            peakRow: peakRow,
            lowRow: lowRow
        };
    }

    function setChipRow(container, items, selectedValue, onClick) {
        container.innerHTML = '';
        items.forEach(function (item) {
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'mip-chip' + (item.value === selectedValue ? ' is-active' : '');
            button.textContent = item.label;
            button.dataset.value = String(item.value);
            button.addEventListener('click', function () {
                if (item.value === selectedValue || state.loading) return;
                onClick(item.value);
            });
            container.appendChild(button);
        });
    }

    function renderTrendChart(rows, summary) {
        if (!refs.trendChart) return;
        if (!rows.length) {
            refs.trendChart.innerHTML = '<div class="mip-empty">No daily market rows were available for this selection.</div>';
            return;
        }

        var width = 920;
        var height = 320;
        var left = 34;
        var right = 20;
        var top = 18;
        var bottom = 40;
        var values = rows.map(function (row) { return Number(row.meanRRP); }).filter(isFiniteNumber);
        var min = Math.min.apply(null, values);
        var max = Math.max.apply(null, values);
        var range = Math.max(max - min, 1);
        var chartWidth = width - left - right;
        var chartHeight = height - top - bottom;

        function x(index) {
            if (rows.length === 1) return left + chartWidth / 2;
            return left + (chartWidth * index) / (rows.length - 1);
        }

        function y(value) {
            return top + chartHeight - ((Number(value) - min) / range) * chartHeight;
        }

        var linePoints = rows.map(function (row, index) {
            return x(index).toFixed(2) + ',' + y(row.meanRRP).toFixed(2);
        }).join(' ');
        var areaPath = 'M ' + x(0).toFixed(2) + ' ' + (top + chartHeight).toFixed(2) + ' L ' + linePoints.replace(/ /g, ' L ') + ' L ' + x(rows.length - 1).toFixed(2) + ' ' + (top + chartHeight).toFixed(2) + ' Z';
        var peakIndex = rows.indexOf(summary.peakRow);
        var lowIndex = rows.indexOf(summary.lowRow);
        var tickValues = [0, 1, 2, 3].map(function (step) { return min + (range * step) / 3; });

        refs.trendChart.innerHTML = [
            '<svg viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none">',
            '<defs><linearGradient id="mipChartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(15,95,168,0.28)"></stop><stop offset="100%" stop-color="rgba(15,95,168,0)"></stop></linearGradient></defs>',
            tickValues.map(function (tick) {
                return '<line class="mip-chart__grid" x1="' + left + '" x2="' + (width - right) + '" y1="' + y(tick).toFixed(2) + '" y2="' + y(tick).toFixed(2) + '"></line>' +
                    '<text class="mip-chart__axis" x="' + left + '" y="' + (y(tick) - 8).toFixed(2) + '">' + Math.round(tick) + '</text>';
            }).join(''),
            '<path class="mip-chart__area" d="' + areaPath + '"></path>',
            '<polyline class="mip-chart__line" points="' + linePoints + '"></polyline>',
            peakIndex >= 0 ? '<circle class="mip-chart__peak" cx="' + x(peakIndex).toFixed(2) + '" cy="' + y(summary.peakRow.meanRRP).toFixed(2) + '" r="7"></circle>' : '',
            lowIndex >= 0 ? '<circle class="mip-chart__low" cx="' + x(lowIndex).toFixed(2) + '" cy="' + y(summary.lowRow.meanRRP).toFixed(2) + '" r="7"></circle>' : '',
            '<text class="mip-chart__label" x="' + left + '" y="' + (height - 12) + '">' + formatDate(rows[0].date) + '</text>',
            '<text class="mip-chart__label" x="' + (width - right) + '" y="' + (height - 12) + '" text-anchor="end">' + formatDate(rows[rows.length - 1].date) + '</text>',
            '</svg>'
        ].join('');
    }

    function renderTakeaways(region, summary, rows) {
        if (!refs.takeaways) return;
        var points = [];
        if (isFiniteNumber(summary.avgPrice)) {
            points.push(region + ' averaged ' + formatCurrency(summary.avgPrice) + ' over the last ' + rows.length + ' days.');
        }
        if (summary.peakRow && isFiniteNumber(summary.peakRow.maxRRP)) {
            points.push('Peak day hit ' + formatCurrency(summary.peakRow.maxRRP) + ' on ' + formatDate(summary.peakRow.date) + '.');
        }
        points.push(formatCount(summary.negativeIntervals) + ' negative-price intervals showed up in this window.');
        refs.takeaways.innerHTML = points.map(function (text) {
            return '<li>' + text + '</li>';
        }).join('');
    }

    function renderComparisonCards() {
        if (!refs.regionCards || !state.index) return;

        var summaries = (state.index.regions || []).map(function (region) {
            var payload = state.regions.get(region);
            var rows = getRows(payload);
            return {
                region: region,
                rows: rows,
                summary: summarizeRows(rows),
                health: getRegionHealth(region)
            };
        }).filter(function (entry) {
            return entry.rows.length;
        });

        if (!summaries.length) {
            refs.regionCards.innerHTML = '<div class="mip-empty">Region comparison is temporarily unavailable.</div>';
            return;
        }

        var topAvg = summaries.slice().sort(function (left, right) {
            return Number(right.summary.avgPrice || 0) - Number(left.summary.avgPrice || 0);
        })[0];
        var topVol = summaries.slice().sort(function (left, right) {
            return Number(right.summary.avgVolatility || 0) - Number(left.summary.avgVolatility || 0);
        })[0];
        var topNegative = summaries.slice().sort(function (left, right) {
            return Number(right.summary.negativeIntervals || 0) - Number(left.summary.negativeIntervals || 0);
        })[0];

        refs.regionCards.innerHTML = summaries.map(function (entry) {
            var signal = 'stable';
            var signalLabel = 'Stable pricing';

            if (topVol && entry.region === topVol.region) {
                signal = 'extreme';
                signalLabel = 'Most volatile';
            } else if ((topAvg && entry.region === topAvg.region) || (topNegative && entry.region === topNegative.region)) {
                signal = 'volatile';
                signalLabel = topNegative && entry.region === topNegative.region ? 'Most negative' : 'Highest average';
            }

            return [
                '<button type="button" class="mip-region-pick' + (entry.region === state.selectedRegion ? ' is-active' : '') + '" data-region-card="' + entry.region + '">',
                '<div class="mi-rcard">',
                '<div class="mi-rcard__region">' + entry.region + '</div>',
                '<div class="mi-rcard__metric"><span>Avg Price</span><span class="mi-rcard__val">' + formatCurrency(entry.summary.avgPrice) + '</span></div>',
                '<div class="mi-rcard__metric"><span>Spike Days</span><span class="mi-rcard__val">' + formatCount(entry.summary.spikeDays) + '</span></div>',
                '<div class="mi-rcard__metric"><span>Negative Events</span><span class="mi-rcard__val">' + formatCount(entry.summary.negativeIntervals) + '</span></div>',
                '<div class="mi-rcard__metric"><span>Avg Spread</span><span class="mi-rcard__val">' + formatCurrency(entry.summary.avgVolatility) + '</span></div>',
                '<span class="mi-rcard__signal mi-rcard__signal--' + signal + '">' + signalLabel + '</span>',
                '</div>',
                '</button>'
            ].join('');
        }).join('');

        refs.regionCards.querySelectorAll('[data-region-card]').forEach(function (button) {
            button.addEventListener('click', function () {
                var region = button.getAttribute('data-region-card');
                if (!region || region === state.selectedRegion || state.loading) return;
                state.selectedRegion = region;
                render();
            });
        });
    }

    function renderRanking(rows) {
        if (!refs.rankingList) return;
        if (!rows.length) {
            refs.rankingList.innerHTML = '<div class="mip-empty">No notable days were available for this selection.</div>';
            return;
        }

        var ranked = rows.slice().sort(function (left, right) {
            var leftScore = Number(left.volatilityRRP || 0) + Number(left.maxRRP || 0) * 0.25 + Number(left.negativeRRPCount || 0) * 5;
            var rightScore = Number(right.volatilityRRP || 0) + Number(right.maxRRP || 0) * 0.25 + Number(right.negativeRRPCount || 0) * 5;
            return rightScore - leftScore;
        }).slice(0, 5);

        refs.rankingList.innerHTML = ranked.map(function (row, index) {
            var level = Number(row.maxRRP || 0) > 500 ? 'high' : Number(row.maxRRP || 0) > 250 ? 'med' : 'low';
            return [
                '<div class="mi-rank-row">',
                '<span class="mi-rank-pos">' + (index + 1) + '</span>',
                '<div class="mi-rank-info">',
                '<div class="mi-rank-title">' + state.selectedRegion + ' — ' + formatDate(row.date) + '</div>',
                '<div class="mi-rank-sub">Peak ' + formatCurrency(row.maxRRP) + ' · Spread ' + formatCurrency(row.volatilityRRP) + ' · Negative ' + formatCount(row.negativeRRPCount) + '</div>',
                '</div>',
                '<span class="mi-rank-badge mi-rank-badge--' + level + '">' + formatCurrency(row.maxRRP) + '</span>',
                '</div>'
            ].join('');
        }).join('');
    }

    function renderSummaryBand(summary) {
        if (!refs.summaryBand) return;
        var signal = summary.avgVolatility > 200 ? 'elevated' : summary.spikeDays > 0 ? 'high' : 'normal';
        var signalLabel = signal === 'elevated' ? 'Elevated' : signal === 'high' ? 'Spike risk' : 'Calm';
        var icon = signal === 'elevated' ? '▲' : signal === 'high' ? '⚡' : '↗';
        var text = 'averaged ' + formatCurrency(summary.avgPrice) + ' with ' + formatCount(summary.negativeIntervals) + ' negative intervals over the last ' + state.range + ' days.';

        refs.summaryBand.innerHTML = [
            '<div class="mi-summary__icon mi-summary__icon--' + signal + '" aria-hidden="true">' + icon + '</div>',
            '<div class="mi-summary__body">',
            '<div class="mi-summary__signal mi-summary__signal--' + signal + '">' + signalLabel + '</div>',
            '<p class="mi-summary__text"><strong>' + state.selectedRegion + '</strong> ' + text + '</p>',
            '</div>'
        ].join('');
    }

    function renderSummary(region, rows, summary) {
        var health = getRegionHealth(region);
        var latestDate = (state.index && state.index.dataworks && state.index.dataworks.freshness && state.index.dataworks.freshness.latestDate) || (rows.length ? rows[rows.length - 1].date : '');
        var freshnessParts = [region + ' updated through ' + formatDate(latestDate)];
        if (state.index && state.index.dataworks && state.index.dataworks.workflow && state.index.dataworks.workflow.cadenceLabel) {
            freshnessParts.push(state.index.dataworks.workflow.cadenceLabel);
        }

        refs.freshness.textContent = freshnessParts.join(' • ');
        refs.regionLabel.textContent = region;
        refs.windowLabel.textContent = state.range + ' days';
        refs.coverage.textContent = health ? formatCount(health.recentCoveragePctMin) + '% coverage' : '--';

        refs.headline.textContent = summary.peakRow && summary.lowRow
            ? region + ' moved from ' + formatSignedCurrency(summary.lowRow.meanRRP) + ' to ' + formatCurrency(summary.peakRow.maxRRP) + '.'
            : region + ' market preview';
        refs.summary.textContent = formatCount(summary.spikeDays) + ' spike days and ' + formatCount(summary.negativeIntervals) + ' negative-price intervals in the selected window.';
        refs.avgPrice.textContent = formatCurrency(summary.avgPrice);
        refs.peakPrice.textContent = summary.peakRow ? formatCurrency(summary.peakRow.maxRRP) : '--';
        refs.peakMeta.textContent = summary.peakRow ? 'Reached on ' + formatDate(summary.peakRow.date) : 'Waiting for latest spike day';
        refs.negative.textContent = formatCount(summary.negativeIntervals);
        refs.volatility.textContent = formatCurrency(summary.avgVolatility);
        refs.spikeDays.textContent = formatCount(summary.spikeDays);
        refs.lowestPrice.textContent = summary.lowRow ? formatSignedCurrency(summary.lowRow.meanRRP) : '--';
        refs.lowestMeta.textContent = summary.lowRow ? 'Calmest day was ' + formatDate(summary.lowRow.date) : 'Waiting for calmest day';
        refs.trendCaption.textContent = 'Average daily price for ' + region + ' across the last ' + rows.length + ' days.';
        renderSummaryBand(summary);
    }

    async function ensureAllRegionsLoaded() {
        var index = await loadIndex();
        await Promise.all((index.regions || []).map(function (region) {
            return loadRegion(region);
        }));
    }

    async function render() {
        state.loading = true;
        try {
            setChipRow(refs.regionChips, (state.index.regions || []).map(function (region) {
                return { label: region, value: region };
            }), state.selectedRegion, function (value) {
                state.selectedRegion = value;
                render();
            });

            setChipRow(refs.rangeChips, [
                { label: '30 days', value: 30 },
                { label: '90 days', value: 90 }
            ], state.range, function (value) {
                state.range = Number(value);
                render();
            });

            var payload = await loadRegion(state.selectedRegion);
            var rows = getRows(payload);
            var summary = summarizeRows(rows);
            renderSummary(state.selectedRegion, rows, summary);
            renderTrendChart(rows, summary);
            renderTakeaways(state.selectedRegion, summary, rows);
            renderRanking(rows);

            ensureAllRegionsLoaded().then(function () {
                renderComparisonCards();
            }).catch(function () {
                refs.regionCards.innerHTML = '<div class="mip-empty">Region comparison is temporarily unavailable.</div>';
            });
        } catch (error) {
            refs.freshness.textContent = 'Market preview is temporarily unavailable';
            refs.headline.textContent = 'The public preview could not be loaded right now.';
            refs.summary.textContent = 'Try again shortly. The full member workspace remains available after sign in.';
            refs.trendChart.innerHTML = '<div class="mip-empty">Market data could not be loaded for the preview.</div>';
            refs.takeaways.innerHTML = '<li>The public preview could not load the dataset.</li>';
            refs.regionCards.innerHTML = '<div class="mip-empty">Region comparison is temporarily unavailable.</div>';
            refs.rankingList.innerHTML = '<div class="mip-empty">Top volatile days are temporarily unavailable.</div>';
            console.warn('[MarketInsightsPreview]', error);
        } finally {
            state.loading = false;
        }
    }

    loadIndex().then(function () {
        return render();
    }).catch(function (error) {
        refs.freshness.textContent = 'Market preview is temporarily unavailable';
        console.warn('[MarketInsightsPreview]', error);
    });
})();