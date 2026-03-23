(function () {
    'use strict';

    const rules = Array.isArray(window.RULE_LIBRARY) ? window.RULE_LIBRARY.slice() : [];
    const byId = new Map(rules.map((rule) => [rule.id, rule]));
    const difficultyRank = { Beginner: 1, Intermediate: 2, Advanced: 3 };
    const variantMap = {
        safer: 'safer',
        aggressive: 'more aggressive',
        best: 'best fit'
    };

    const state = {
        answers: {
            priority: 'save-imports',
            pricing: 'amber',
            market: 'low-fitin',
            behavior: 'balanced',
            reserve: 'small',
            setup: 'no-ev',
            confidence: 'beginner'
        },
        activeBundleKey: 'balanced-price-shifter',
        activeVariant: 'best'
    };

    const bundleCatalog = {
        'balanced-price-shifter': {
            name: 'Balanced Price Shifter',
            lead: 'A starter pack that catches cheap charging windows, protects a modest reserve, and avoids hanging onto low-value export too long.',
            templates: ['price_cheap_import_charge', 'price_buy_price_guard', 'prod_post_spike_self_use'],
            supportTemplates: {
                reserve: ['time_peak_demand_shield'],
                fixed: ['time_offpeak_overnight_charge'],
                ev: ['ev_evening_return_reserve'],
                curtailment: ['solar_sunny_peak_headroom']
            },
            saferKey: 'self-use-protector',
            aggressiveKey: 'export-first'
        },
        'export-first': {
            name: 'Export First',
            lead: 'This bundle is built to monetize strong feed-in windows, move early into spike setups, and step back once export value collapses.',
            templates: ['price_spike_response', 'price_high_feedin_export', 'prod_post_spike_self_use'],
            supportTemplates: {
                amber: ['prod_precharge_spike_forecast'],
                curtailment: ['time_shoulder_export'],
                solar: ['prod_evening_drain_sunny_tomorrow']
            },
            saferKey: 'balanced-price-shifter',
            aggressiveKey: 'curtailment-aware'
        },
        'self-use-protector': {
            name: 'Self-Use Protector',
            lead: 'This pack minimizes imports and unnecessary trading by holding battery value for the home first, then only reacting in clearer windows.',
            templates: ['price_buy_price_guard', 'time_peak_demand_shield', 'prod_post_spike_self_use'],
            supportTemplates: {
                reserve: ['battery_overnight_soc_floor'],
                fixed: ['time_offpeak_overnight_charge'],
                winter: ['seasonal_winter_self_use']
            },
            saferKey: 'backup-priority',
            aggressiveKey: 'balanced-price-shifter'
        },
        'backup-priority': {
            name: 'Backup Priority',
            lead: 'This recommendation preserves battery resilience first and only trades when the case is clearly worth it.',
            templates: ['battery_overnight_soc_floor', 'solar_low_generation_backup', 'time_peak_demand_shield'],
            supportTemplates: {
                reserve: ['battery_low_soc_guard'],
                weather: ['seasonal_rainy_week_conserve'],
                fixed: ['time_offpeak_overnight_charge']
            },
            saferKey: 'self-use-protector',
            aggressiveKey: 'balanced-price-shifter'
        },
        'curtailment-aware': {
            name: 'Curtailment Aware',
            lead: 'This bundle creates headroom before strong solar periods, avoids low-value export when prices are poor, and keeps solar capture useful instead of wasteful.',
            templates: ['solar_sunny_peak_headroom', 'prod_post_spike_self_use', 'time_shoulder_export'],
            supportTemplates: {
                fixed: ['time_offpeak_overnight_charge'],
                ev: ['ev_solar_surplus_discharge'],
                amber: ['price_midday_solar_export']
            },
            saferKey: 'balanced-price-shifter',
            aggressiveKey: 'export-first'
        },
        'ev-ready-shifter': {
            name: 'EV Ready Shifter',
            lead: 'This pack keeps the home battery useful without competing too hard with EV charging, then leans on cheap windows and reserve protection around arrival times.',
            templates: ['ev_morning_commute_precharge', 'ev_evening_return_reserve', 'price_buy_price_guard'],
            supportTemplates: {
                export: ['ev_weekend_surplus_export'],
                curtailment: ['ev_solar_surplus_discharge'],
                fixed: ['time_offpeak_overnight_charge']
            },
            saferKey: 'self-use-protector',
            aggressiveKey: 'export-first'
        }
    };

    function init() {
        bindOptions();
        bindVariants();
        render();
    }

    function bindOptions() {
        document.querySelectorAll('.rtr-option').forEach((button) => {
            button.addEventListener('click', () => {
                const group = button.dataset.group;
                const value = button.dataset.value;
                if (!group || !value) return;
                state.answers[group] = value;
                state.activeVariant = 'best';

                document.querySelectorAll(`.rtr-option[data-group="${group}"]`).forEach((peer) => {
                    peer.classList.toggle('is-selected', peer === button);
                });

                render();
            });
        });
    }

    function bindVariants() {
        const safer = document.getElementById('saferVariantBtn');
        const aggressive = document.getElementById('aggressiveVariantBtn');
        if (safer) {
            safer.addEventListener('click', () => {
                state.activeVariant = 'safer';
                render();
            });
        }
        if (aggressive) {
            aggressive.addEventListener('click', () => {
                state.activeVariant = 'aggressive';
                render();
            });
        }
    }

    function render() {
        const bestKey = chooseBundleKey(state.answers);
        state.activeBundleKey = pickVariantBundle(bestKey, state.activeVariant);
        const bundle = buildBundle(state.activeBundleKey, state.answers, state.activeVariant);

        setText('recommendationName', bundle.name);
        setText('recommendationLead', bundle.lead);
        setText('recommendationBundle', bundle.name);
        setText('recommendationDifficulty', `Difficulty: ${bundle.difficulty}`);
        setText('recommendationVariantLabel', variantMap[state.activeVariant] || 'best fit');
        setText('recommendationScore', `${bundle.score}% fit`);
        setText('requiredInputs', bundle.requiredInputs);
        setText('recommendationWhy', bundle.why);
        setText('recommendationBehavior', bundle.behavior);

        renderTemplateCards(bundle.templates);
        renderLinks(bundle);
        renderVariantButtons(bestKey);
    }

    function chooseBundleKey(answers) {
        if (answers.priority === 'backup' || answers.reserve === 'high') return 'backup-priority';
        if (answers.priority === 'earn-exports' || answers.market === 'export-spikes') return 'export-first';
        if (answers.priority === 'ev') return 'ev-ready-shifter';
        if (answers.setup === 'curtailment' || answers.market === 'low-fitin') return 'curtailment-aware';
        if (answers.priority === 'simple' || answers.behavior === 'conservative') return 'self-use-protector';
        if (answers.setup === 'tesla') return 'ev-ready-shifter';
        return 'balanced-price-shifter';
    }

    function pickVariantBundle(bestKey, variant) {
        const bundle = bundleCatalog[bestKey];
        if (!bundle) return 'balanced-price-shifter';
        if (variant === 'safer' && bundle.saferKey) return bundle.saferKey;
        if (variant === 'aggressive' && bundle.aggressiveKey) return bundle.aggressiveKey;
        return bestKey;
    }

    function buildBundle(bundleKey, answers, variant) {
        const config = bundleCatalog[bundleKey] || bundleCatalog['balanced-price-shifter'];
        const templateIds = dedupeTemplates(resolveTemplateIds(config, answers));
        const templates = templateIds
            .map((id) => byId.get(id))
            .filter(Boolean)
            .sort((left, right) => Number(left.rule.priority || 99) - Number(right.rule.priority || 99));

        return {
            name: config.name,
            lead: buildLead(config, answers, variant),
            difficulty: computeDifficulty(templates),
            score: computeScore(config.name, answers, variant),
            requiredInputs: describeRequiredInputs(templates, answers),
            why: buildWhy(answers, templates, variant),
            behavior: buildBehavior(answers, templates),
            templates
        };
    }

    function resolveTemplateIds(config, answers) {
        const ids = config.templates.slice();

        if (answers.reserve !== 'none' && config.supportTemplates.reserve) {
            ids.push.apply(ids, config.supportTemplates.reserve);
        }
        if ((answers.pricing === 'no-live' || answers.setup === 'fixed-tariff' || answers.market === 'cheap-overnight') && config.supportTemplates.fixed) {
            ids.push.apply(ids, config.supportTemplates.fixed);
        }
        if (answers.pricing === 'amber' && config.supportTemplates.amber) {
            ids.push.apply(ids, config.supportTemplates.amber);
        }
        if (answers.setup === 'tesla' && config.supportTemplates.ev) {
            ids.push.apply(ids, config.supportTemplates.ev);
        }
        if (answers.market === 'export-spikes' && config.supportTemplates.export) {
            ids.push.apply(ids, config.supportTemplates.export);
        }
        if ((answers.setup === 'curtailment' || answers.market === 'low-fitin') && config.supportTemplates.curtailment) {
            ids.push.apply(ids, config.supportTemplates.curtailment);
        }
        if (answers.market === 'stable' && config.supportTemplates.winter) {
            ids.push.apply(ids, config.supportTemplates.winter);
        }
        if (answers.behavior === 'conservative' && config.supportTemplates.weather) {
            ids.push.apply(ids, config.supportTemplates.weather);
        }
        if (answers.behavior === 'aggressive' && config.supportTemplates.solar) {
            ids.push.apply(ids, config.supportTemplates.solar);
        }

        return ids;
    }

    function dedupeTemplates(ids) {
        return Array.from(new Set(ids)).slice(0, 5);
    }

    function computeDifficulty(templates) {
        return templates.reduce((hardest, template) => {
            return difficultyRank[template.difficulty] > difficultyRank[hardest] ? template.difficulty : hardest;
        }, 'Beginner');
    }

    function computeScore(name, answers, variant) {
        let score = 91;
        if (variant !== 'best') score -= 8;
        if (answers.confidence === 'advanced') score += 2;
        if (answers.pricing === 'unsure') score -= 3;
        if (name === 'Export First' && answers.pricing === 'amber') score += 4;
        if (name === 'Backup Priority' && answers.reserve === 'high') score += 4;
        if (name === 'Curtailment Aware' && answers.setup === 'curtailment') score += 4;
        return Math.max(74, Math.min(98, score));
    }

    function describeRequiredInputs(templates, answers) {
        const needsForecast = templates.some((template) => hasForecastInputs(template));
        const needsLivePrice = templates.some((template) => hasLivePriceInputs(template));
        const parts = [];

        if (answers.pricing === 'amber' || needsLivePrice) {
            parts.push('Amber strengthens the price-aware parts');
        } else {
            parts.push('Works on fixed tariffs and time windows');
        }
        if (needsForecast) {
            parts.push('Forecast-aware templates improve the result');
        }
        if (answers.setup === 'tesla') {
            parts.push('Tesla-friendly support template included');
        }

        return parts.join('. ') + '.';
    }

    function buildLead(config, answers, variant) {
        let lead = config.lead;
        if (variant === 'safer') {
            lead += ' This safer variant gives reserve protection more room to win.';
        }
        if (variant === 'aggressive') {
            lead += ' This more aggressive variant leans harder into export or dynamic opportunity capture.';
        }
        if (answers.confidence === 'beginner') {
            lead += ' It keeps the editing burden lighter after import.';
        }
        return lead;
    }

    function buildWhy(answers, templates, variant) {
        const fragments = [];
        if (answers.priority === 'save-imports') fragments.push('your main goal is reducing imports without building rules from scratch');
        if (answers.priority === 'earn-exports') fragments.push('you explicitly want stronger export behavior');
        if (answers.priority === 'backup') fragments.push('reserve protection matters more than squeezing every trade');
        if (answers.pricing === 'amber') fragments.push('Amber-connected pricing makes dynamic price templates more worthwhile');
        if (answers.setup === 'curtailment') fragments.push('curtailment concerns mean headroom and low-value export protection should stay in the mix');
        if (answers.setup === 'tesla') fragments.push('Tesla support adds a practical EV-aware companion instead of making the battery compete blindly');
        if (answers.confidence === 'beginner') fragments.push('you want a starter pack that still feels editable later');

        const forecastCount = templates.filter((template) => hasForecastInputs(template)).length;
        if (forecastCount > 0) {
            fragments.push(`it uses ${forecastCount} forecast-aware template${forecastCount > 1 ? 's' : ''} where they clearly improve the outcome`);
        }
        if (variant === 'safer') {
            fragments.push('the safer option keeps more reserve and lowers the chance of exporting into marginal value');
        }
        if (variant === 'aggressive') {
            fragments.push('the aggressive option brings forward higher-value export or pre-charge behavior when your answers support it');
        }

        return `This bundle fits because ${fragments.join(', ')}.`;
    }

    function buildBehavior(answers, templates) {
        const behaviors = [];
        if (templates.some((template) => /ForceCharge/.test(template.rule.action.workMode))) {
            behaviors.push('charge during cheap or strategically useful windows');
        }
        if (templates.some((template) => /ForceDischarge/.test(template.rule.action.workMode))) {
            behaviors.push('export or discharge when value is strong enough');
        }
        if (templates.some((template) => /SelfUse/.test(template.rule.action.workMode))) {
            behaviors.push('drop back to self-use when market value softens or reserve should take priority');
        }
        if (answers.reserve !== 'none') {
            behaviors.push(`hold a ${answers.reserve} reserve instead of draining all the way down`);
        }

        return `Expect it to ${behaviors.join(', ')}. The handoff also preserves sensible first-match ordering so the higher-value guardrails fire before the cleanup rules.`;
    }

    function hasForecastInputs(template) {
        const conditions = template && template.rule && template.rule.conditions;
        if (!conditions) return false;
        return Boolean(
            conditions.forecastPrice && conditions.forecastPrice.enabled ||
            conditions.solarRadiation && conditions.solarRadiation.enabled ||
            conditions.cloudCover && conditions.cloudCover.enabled
        );
    }

    function hasLivePriceInputs(template) {
        const conditions = template && template.rule && template.rule.conditions;
        if (!conditions) return false;
        return Boolean(
            conditions.feedInPrice && conditions.feedInPrice.enabled ||
            conditions.buyPrice && conditions.buyPrice.enabled ||
            conditions.forecastPrice && conditions.forecastPrice.enabled
        );
    }

    function renderTemplateCards(templates) {
        const list = document.getElementById('templateCardGrid');
        if (!list) return;
        list.innerHTML = templates.map((template) => {
            const conditions = Array.isArray(template.conditionSummary)
                ? template.conditionSummary.slice(0, 3)
                : [];

            return `
                <article class="rtr-rule-card">
                    <div class="rtr-rule-card__top">
                        <div class="rtr-rule-card__badges">
                            <span class="rtr-rule-badge">${escapeHtml(template.categoryLabel)}</span>
                            <span class="rtr-rule-badge">${escapeHtml(template.difficulty)}</span>
                        </div>
                        <span class="rtr-rule-card__priority">Priority ${Number(template.rule.priority || 0)}</span>
                    </div>
                    <h4 class="rtr-rule-card__title">${escapeHtml(template.name)}</h4>
                    <p class="rtr-rule-card__why">${escapeHtml(template.whyUseIt)}</p>
                    <div class="rtr-rule-card__chips">
                        ${conditions.map((condition) => `<span class="rtr-rule-chip">${escapeHtml(condition)}</span>`).join('')}
                    </div>
                    <div class="rtr-rule-card__footer">
                        <span class="rtr-rule-card__mode">First-match order uses this priority directly.</span>
                        <span class="rtr-rule-card__action">${escapeHtml(template.rule.action.workMode)}</span>
                    </div>
                </article>
            `;
        }).join('');
    }

    function renderLinks(bundle) {
        const ids = bundle.templates.map((template) => template.id).join(',');
        const target = `/rules-library.html?recommend=${encodeURIComponent(ids)}&bundle=${encodeURIComponent(bundle.name)}&variant=${encodeURIComponent(state.activeVariant)}&source=rule-template-recommender`;

        const importLink = document.getElementById('importStarterPackLink');
        const signupLink = document.getElementById('signupImportLink');
        if (importLink) importLink.href = target;
        if (signupLink) signupLink.href = `/login.html?tab=signup&returnTo=${encodeURIComponent(target)}`;
    }

    function renderVariantButtons(bestKey) {
        const safer = document.getElementById('saferVariantBtn');
        const aggressive = document.getElementById('aggressiveVariantBtn');
        const bundle = bundleCatalog[bestKey];
        if (safer) safer.disabled = !bundle || !bundle.saferKey;
        if (aggressive) aggressive.disabled = !bundle || !bundle.aggressiveKey;
    }

    function setText(id, value) {
        const node = document.getElementById(id);
        if (node) node.textContent = value;
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());