
    // ==================== Admin Panel Logic ====================
    function cssVar(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    function getThemeColor(name, fallback) {
        const value = cssVar(name);
        return value || fallback;
    }

    function withAlpha(hexOrRgb, alpha) {
        if (!hexOrRgb) return `rgba(255, 255, 255, ${alpha})`;
        if (hexOrRgb.startsWith('rgba(') || hexOrRgb.startsWith('rgb(')) {
            return hexOrRgb.replace(/rgba?\(([^)]+)\)/, (_match, inner) => {
                const parts = inner.split(',').map((part) => part.trim()).slice(0, 3);
                return `rgba(${parts.join(', ')}, ${alpha})`;
            });
        }
        const hex = hexOrRgb.replace('#', '').trim();
        if (hex.length !== 6) return `rgba(255, 255, 255, ${alpha})`;
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function drawLabelPill(ctx, x, y, text, options = {}) {
        const paddingX = options.paddingX ?? 6;
        const paddingY = options.paddingY ?? 3;
        const radius = options.radius ?? 8;
        const metrics = ctx.measureText(text);
        const width = metrics.width + (paddingX * 2);
        const height = (options.height ?? 18);
        const left = x - (width / 2);
        const top = y - (height / 2);

        ctx.save();
        ctx.fillStyle = options.background || 'rgba(15, 23, 42, 0.82)';
        ctx.strokeStyle = options.border || 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left + radius, top);
        ctx.lineTo(left + width - radius, top);
        ctx.quadraticCurveTo(left + width, top, left + width, top + radius);
        ctx.lineTo(left + width, top + height - radius);
        ctx.quadraticCurveTo(left + width, top + height, left + width - radius, top + height);
        ctx.lineTo(left + radius, top + height);
        ctx.quadraticCurveTo(left, top + height, left, top + height - radius);
        ctx.lineTo(left, top + radius);
        ctx.quadraticCurveTo(left, top, left + radius, top);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = options.color || '#f8fafc';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x, y + 0.5);
        ctx.restore();
    }

    function createVerticalGradient(canvas, topColor, bottomColor) {
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 220);
        gradient.addColorStop(0, topColor);
        gradient.addColorStop(1, bottomColor);
        return gradient;
    }

    function getChartPalette() {
        // CSS-var lookups with guaranteed dark-theme fallbacks.
        // Hardcoded fallbacks ensure charts never render with invisible/black text
        // even when CSS vars haven't resolved yet (lazy tab load timing).
        const t = (v, fb) => { const r = cssVar(v); return r || fb; };
        return {
            textPrimary:   t('--text-primary',   '#e2e8f0'),
            textSecondary: t('--text-secondary', '#94a3b8'),
            surface:       t('--bg-secondary',   '#161b22'),
            border:        'rgba(148, 163, 184, 0.12)',
            // Vivid, high-contrast accent colours for dark backgrounds
            accentBlue:   '#3b9eff',
            accentGreen:  '#22d3a0',
            accentOrange: '#fb923c',
            accentPink:   '#f472b6',
            accentSlate:  '#64748b',
            accentPurple: '#a78bfa',
            accentTeal:   '#2dd4bf',
        };
    }

    let currentUsers = [];
    let currentUsersFiltered = [];
    let currentUsersPagination = { page: 1, pageSize: 50, totalUsers: 0, totalPages: 1, showAll: false, sortingScope: 'current-page' };
    let currentUsersSummary = null;
    let adminApiClient = null;
    let currentSort = { key: 'lastSignedInAt', direction: 'desc' };
    let currentUsersFilters = createDefaultUsersFilters();
    let platformTrendChart = null;
    let behaviorTrendChart = null;
    let behaviorEventsChart = null;
    let behaviorMetricsData = null;
    let behaviorSelectedPageKey = 'all';
    let firestoreMetricsChart = null;
    let schedulerMetricsChart = null;
    let apiHealthTrendChart = null;
    let apiHealthExecutionChart = null;
    let apiHealthProviderChart = null;
    let apiHealthData = null;
    let usersProviderChart = null;
    let usersInverterSizeChart = null;
    let usersBatterySizeChart = null;
    let usersCouplingChart = null;
    let usersTourChart = null;
    let activeTab = 'overview';
    let tabsLoaded = { overview: false, behavior: false, announcement: false, scheduler: false, dataworks: false, users: false, apiHealth: false };
    let usersTableRequestSequence = 0;
    let usersSummaryRequestSequence = 0;
    let usersFilterInputDebounce = null;
    let currentAdminAnnouncement = null;
    let announcementEditorBound = false;

    function createDefaultUsersFilters() {
        return {
            search: '',
            inverterProvider: '',
            inverterSize: '',
            batterySize: '',
            pricing: '',
            country: '',
            rules: '',
            topology: '',
            tourStatus: ''
        };
    }

    function normalizeUsersFilterValue(value) {
        return String(value || '').trim().toLowerCase();
    }

    function countActiveUsersFilters(filters = currentUsersFilters) {
        return Object.values(filters || {}).filter((value) => normalizeUsersFilterValue(value)).length;
    }

    function getUsersFilterScopeLabel() {
        return currentUsersPagination.showAll ? 'all loaded users' : 'the loaded page';
    }

    function formatUsersPricingLabel(pricingProvider) {
        switch (normalizeUsersFilterValue(pricingProvider)) {
            case 'amber': return 'Amber';
            case 'aemo': return 'AEMO';
            case 'flat-rate': return 'Flat rate';
            case 'unknown':
            default: return 'Not set';
        }
    }

    function formatUsersTopologyLabel(topology) {
        switch (normalizeUsersFilterValue(topology)) {
            case 'ac': return 'AC-Coupled';
            case 'dc': return 'DC-Coupled';
            case 'unknown':
            default: return 'Not set';
        }
    }

    function formatUsersTourStatusLabel(tourStatus) {
        switch (normalizeUsersFilterValue(tourStatus)) {
            case 'watched': return 'Watched';
            case 'not_watched': return 'Not watched';
            case 'no_config':
            default: return 'No config';
        }
    }

    function formatUsersInverterSizeLabel(user) {
        if (user?.inverterSizeLabel) return String(user.inverterSizeLabel);
        const inverterCapacityW = Number(user?.inverterCapacityW);
        if (!Number.isFinite(inverterCapacityW) || inverterCapacityW <= 0) return 'Not set';
        const inverterKw = inverterCapacityW / 1000;
        return `${Number.isInteger(inverterKw) ? inverterKw.toFixed(0) : inverterKw.toFixed(1)} kW`;
    }

    function formatUsersBatterySizeLabel(user) {
        if (user?.batterySizeLabel) return String(user.batterySizeLabel);
        const batteryCapacityKWh = Number(user?.batteryCapacityKWh);
        if (!Number.isFinite(batteryCapacityKWh) || batteryCapacityKWh <= 0) return 'Not set';
        return `${batteryCapacityKWh.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 1 })} kWh`;
    }

    function readUsersCountry(user) {
        const country = String(user?.country || '').trim();
        return country || 'Not set';
    }

    function getUsersFiltersFromDom() {
        return {
            search: document.getElementById('usersFilterSearch')?.value || '',
            inverterProvider: document.getElementById('usersFilterProvider')?.value || '',
            inverterSize: document.getElementById('usersFilterInverterSize')?.value || '',
            batterySize: document.getElementById('usersFilterBatterySize')?.value || '',
            pricing: document.getElementById('usersFilterPricing')?.value || '',
            country: document.getElementById('usersFilterCountry')?.value || '',
            rules: document.getElementById('usersFilterRules')?.value || '',
            topology: document.getElementById('usersFilterTopology')?.value || '',
            tourStatus: document.getElementById('usersFilterTourStatus')?.value || ''
        };
    }

    function setUsersFiltersDom(filters = currentUsersFilters) {
        const searchInput = document.getElementById('usersFilterSearch');
        if (searchInput && searchInput.value !== (filters.search || '')) {
            searchInput.value = filters.search || '';
        }

        const assignments = [
            ['usersFilterProvider', filters.inverterProvider],
            ['usersFilterInverterSize', filters.inverterSize],
            ['usersFilterBatterySize', filters.batterySize],
            ['usersFilterPricing', filters.pricing],
            ['usersFilterCountry', filters.country],
            ['usersFilterRules', filters.rules],
            ['usersFilterTopology', filters.topology],
            ['usersFilterTourStatus', filters.tourStatus]
        ];

        assignments.forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el && el.value !== (value || '')) {
                el.value = value || '';
            }
        });
    }

    function sortUsersFilterOptions(options = [], type = 'alpha') {
        const rows = Array.isArray(options) ? [...options] : [];
        if (type === 'numeric-label') {
            rows.sort((a, b) => {
                const av = parseFloat(String(a.label || '').replace(/[^\d.]+/g, ''));
                const bv = parseFloat(String(b.label || '').replace(/[^\d.]+/g, ''));
                if (Number.isFinite(av) && Number.isFinite(bv) && av !== bv) return av - bv;
                return String(a.label || '').localeCompare(String(b.label || ''));
            });
            return rows;
        }
        rows.sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
        return rows;
    }

    function ensureUsersFilterOption(options, value, label) {
        const normalizedValue = String(value || '');
        if (!normalizedValue) return options;
        if (options.some((option) => option.value === normalizedValue)) return options;
        return [...options, { value: normalizedValue, label }];
    }

    function populateUsersFilterSelect(selectId, placeholderLabel, options, selectedValue) {
        const select = document.getElementById(selectId);
        if (!select) return;
        const optionHtml = [
            `<option value="">${escapeHtml(placeholderLabel)}</option>`,
            ...options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
        ].join('');
        select.innerHTML = optionHtml;
        select.value = selectedValue || '';
    }

    function collectUsersFilterOptions(users = currentUsers) {
        const providerOptions = new Map();
        const inverterSizeOptions = new Map();
        const batterySizeOptions = new Map();
        const pricingOptions = new Map();
        const countryOptions = new Map();
        const topologyOptions = new Map();
        const tourStatusOptions = new Map();

        (Array.isArray(users) ? users : []).forEach((user) => {
            const provider = normalizeUsersFilterValue(user?.deviceProvider || 'unknown');
            providerOptions.set(provider || 'unknown', providerLabel(provider || 'unknown'));

            const inverterSizeLabel = formatUsersInverterSizeLabel(user);
            inverterSizeOptions.set(normalizeUsersFilterValue(inverterSizeLabel) || 'not set', inverterSizeLabel);

            const batterySizeLabel = formatUsersBatterySizeLabel(user);
            batterySizeOptions.set(normalizeUsersFilterValue(batterySizeLabel) || 'not set', batterySizeLabel);

            const pricing = normalizeUsersFilterValue(user?.pricingProvider || 'unknown');
            pricingOptions.set(pricing || 'unknown', formatUsersPricingLabel(pricing || 'unknown'));

            const country = readUsersCountry(user);
            countryOptions.set(normalizeUsersFilterValue(country) || 'not set', country);

            const topology = normalizeUsersFilterValue(user?.topology || 'unknown');
            topologyOptions.set(topology || 'unknown', formatUsersTopologyLabel(topology || 'unknown'));

            const tourStatus = normalizeUsersFilterValue(user?.tourStatus || 'no_config');
            tourStatusOptions.set(tourStatus || 'no_config', formatUsersTourStatusLabel(tourStatus || 'no_config'));
        });

        return {
            provider: Array.from(providerOptions.entries()).map(([value, label]) => ({ value, label })),
            inverterSize: sortUsersFilterOptions(Array.from(inverterSizeOptions.entries()).map(([value, label]) => ({ value, label })), 'numeric-label'),
            batterySize: sortUsersFilterOptions(Array.from(batterySizeOptions.entries()).map(([value, label]) => ({ value, label })), 'numeric-label'),
            pricing: Array.from(pricingOptions.entries()).map(([value, label]) => ({ value, label })),
            country: sortUsersFilterOptions(Array.from(countryOptions.entries()).map(([value, label]) => ({ value, label }))),
            topology: Array.from(topologyOptions.entries()).map(([value, label]) => ({ value, label })),
            tourStatus: Array.from(tourStatusOptions.entries()).map(([value, label]) => ({ value, label }))
        };
    }

    function renderUsersFilterOptions(users = currentUsers) {
        const options = collectUsersFilterOptions(users);

        const providerOptions = ensureUsersFilterOption(
            sortUsersFilterOptions(options.provider),
            currentUsersFilters.inverterProvider,
            providerLabel(currentUsersFilters.inverterProvider || 'unknown')
        );
        const inverterSizeOptions = ensureUsersFilterOption(
            options.inverterSize,
            currentUsersFilters.inverterSize,
            currentUsersFilters.inverterSize || 'Not set'
        );
        const batterySizeOptions = ensureUsersFilterOption(
            options.batterySize,
            currentUsersFilters.batterySize,
            currentUsersFilters.batterySize || 'Not set'
        );
        const pricingOptions = ensureUsersFilterOption(
            sortUsersFilterOptions(options.pricing),
            currentUsersFilters.pricing,
            formatUsersPricingLabel(currentUsersFilters.pricing)
        );
        const countryOptions = ensureUsersFilterOption(
            options.country,
            currentUsersFilters.country,
            currentUsersFilters.country || 'Not set'
        );
        const topologyOptions = ensureUsersFilterOption(
            sortUsersFilterOptions(options.topology),
            currentUsersFilters.topology,
            formatUsersTopologyLabel(currentUsersFilters.topology)
        );
        const tourStatusOptions = ensureUsersFilterOption(
            sortUsersFilterOptions(options.tourStatus),
            currentUsersFilters.tourStatus,
            formatUsersTourStatusLabel(currentUsersFilters.tourStatus)
        );

        populateUsersFilterSelect('usersFilterProvider', 'All providers', providerOptions, currentUsersFilters.inverterProvider);
        populateUsersFilterSelect('usersFilterInverterSize', 'All inverter sizes', inverterSizeOptions, currentUsersFilters.inverterSize);
        populateUsersFilterSelect('usersFilterBatterySize', 'All battery sizes', batterySizeOptions, currentUsersFilters.batterySize);
        populateUsersFilterSelect('usersFilterPricing', 'All pricing', pricingOptions, currentUsersFilters.pricing);
        populateUsersFilterSelect('usersFilterCountry', 'All countries', countryOptions, currentUsersFilters.country);
        populateUsersFilterSelect('usersFilterTopology', 'All topology', topologyOptions, currentUsersFilters.topology);
        populateUsersFilterSelect('usersFilterTourStatus', 'All tour states', tourStatusOptions, currentUsersFilters.tourStatus);
        setUsersFiltersDom(currentUsersFilters);
    }

    function buildUsersSearchHaystack(user) {
        return [
            user?.email,
            user?.uid,
            providerLabel(user?.deviceProvider || 'unknown'),
            formatUsersPricingLabel(user?.pricingProvider),
            user?.location,
            readUsersCountry(user),
            formatUsersInverterSizeLabel(user),
            formatUsersBatterySizeLabel(user),
            formatUsersTopologyLabel(user?.topology),
            formatUsersTourStatusLabel(user?.tourStatus),
            String(user?.rulesCount || 0)
        ].map((value) => String(value || '').toLowerCase()).join(' ');
    }

    function userMatchesUsersFilters(user, filters = currentUsersFilters) {
        const search = normalizeUsersFilterValue(filters.search);
        if (search && !buildUsersSearchHaystack(user).includes(search)) return false;

        if (filters.inverterProvider && normalizeUsersFilterValue(user?.deviceProvider || 'unknown') !== normalizeUsersFilterValue(filters.inverterProvider)) {
            return false;
        }
        if (filters.inverterSize && normalizeUsersFilterValue(formatUsersInverterSizeLabel(user)) !== normalizeUsersFilterValue(filters.inverterSize)) {
            return false;
        }
        if (filters.batterySize && normalizeUsersFilterValue(formatUsersBatterySizeLabel(user)) !== normalizeUsersFilterValue(filters.batterySize)) {
            return false;
        }
        if (filters.pricing && normalizeUsersFilterValue(user?.pricingProvider || 'unknown') !== normalizeUsersFilterValue(filters.pricing)) {
            return false;
        }
        if (filters.country && normalizeUsersFilterValue(readUsersCountry(user)) !== normalizeUsersFilterValue(filters.country)) {
            return false;
        }
        if (filters.topology && normalizeUsersFilterValue(user?.topology || 'unknown') !== normalizeUsersFilterValue(filters.topology)) {
            return false;
        }
        if (filters.tourStatus && normalizeUsersFilterValue(user?.tourStatus || 'no_config') !== normalizeUsersFilterValue(filters.tourStatus)) {
            return false;
        }

        const rulesCount = Number(user?.rulesCount || 0);
        if (filters.rules === 'has_rules' && rulesCount <= 0) return false;
        if (filters.rules === 'no_rules' && rulesCount > 0) return false;

        return true;
    }

    function getFilteredUsers(users = currentUsers) {
        return (Array.isArray(users) ? users : []).filter((user) => userMatchesUsersFilters(user));
    }

    function renderUsersFiltersStatus(filteredUsers = currentUsersFiltered, users = currentUsers) {
        const status = document.getElementById('usersFiltersStatus');
        const clearBtn = document.getElementById('usersClearFiltersBtn');
        if (!status || !clearBtn) return;

        const loadedCount = Array.isArray(users) ? users.length : 0;
        const filteredCount = Array.isArray(filteredUsers) ? filteredUsers.length : 0;
        const scope = getUsersFilterScopeLabel();
        const activeCount = countActiveUsersFilters();

        status.textContent = activeCount
            ? `${filteredCount} of ${loadedCount} loaded users match the current filters. Filters only apply to ${scope}.`
            : `Filters only apply to ${scope}. Choose Show all if you want to filter every loaded user at once.`;
        clearBtn.disabled = activeCount === 0;
    }

    function renderUsersView() {
        renderUsersFilterOptions(currentUsers);
        currentUsersFiltered = getFilteredUsers(currentUsers);
        renderUsersFiltersStatus(currentUsersFiltered, currentUsers);
        renderUsersTable(currentUsersFiltered);
        renderUsersPagination(currentUsersPagination);
    }

    function applyUsersFilters() {
        currentUsersFilters = getUsersFiltersFromDom();
        renderUsersView();
    }

    function clearUsersFilters() {
        currentUsersFilters = createDefaultUsersFilters();
        setUsersFiltersDom(currentUsersFilters);
        renderUsersView();
    }

    function bindUsersFilterHandlers() {
        const searchInput = document.getElementById('usersFilterSearch');
        if (searchInput && searchInput.dataset.bound !== '1') {
            searchInput.dataset.bound = '1';
            searchInput.addEventListener('input', () => {
                window.clearTimeout(usersFilterInputDebounce);
                usersFilterInputDebounce = window.setTimeout(() => {
                    applyUsersFilters();
                }, 180);
            });
        }

        [
            'usersFilterProvider',
            'usersFilterInverterSize',
            'usersFilterBatterySize',
            'usersFilterPricing',
            'usersFilterCountry',
            'usersFilterRules',
            'usersFilterTopology',
            'usersFilterTourStatus'
        ].forEach((id) => {
            const el = document.getElementById(id);
            if (!el || el.dataset.bound === '1') return;
            el.dataset.bound = '1';
            el.addEventListener('change', () => {
                applyUsersFilters();
            });
        });

        renderUsersFilterOptions(currentUsers);
        renderUsersFiltersStatus(currentUsersFiltered, currentUsers);
    }

    function showMessage(type, msg, duration = 5000) {
        const area = document.getElementById('messageArea');
        if (!area) return;
        const colors = {
            error: 'var(--color-danger)',
            success: 'var(--color-success)',
            warning: 'var(--color-warning)',
            info: 'var(--accent-blue)'
        };
        const messageEl = document.createElement('div');
        messageEl.style.padding = '10px 16px';
        messageEl.style.borderRadius = 'var(--radius-lg)';
        messageEl.style.background = `${colors[type] || colors.info}15`;
        messageEl.style.border = `1px solid ${colors[type] || colors.info}40`;
        messageEl.style.color = colors[type] || colors.info;
        messageEl.style.fontSize = '13px';
        messageEl.style.marginBottom = '12px';
        messageEl.textContent = msg;
        area.replaceChildren(messageEl);
        if (duration > 0) {
            setTimeout(() => { area.replaceChildren(); }, duration);
        }
    }

    function formatDate(ts) {
        if (!ts) return '-';
        try {
            const d = ts.toDate ? ts.toDate() : new Date(ts._seconds ? ts._seconds * 1000 : ts);
            if (isNaN(d.getTime())) return '-';
            return d.toLocaleDateString('en-AU', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch { return '-'; }
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    let adminInfoTooltipEl = null;
    let adminInfoTooltipTarget = null;

    function ensureAdminInfoTooltip() {
        if (adminInfoTooltipEl || !document.body) return adminInfoTooltipEl;
        adminInfoTooltipEl = document.createElement('div');
        adminInfoTooltipEl.id = 'adminInfoTooltip';
        adminInfoTooltipEl.className = 'admin-info-tooltip';
        adminInfoTooltipEl.setAttribute('role', 'tooltip');
        adminInfoTooltipEl.setAttribute('aria-hidden', 'true');
        document.body.appendChild(adminInfoTooltipEl);
        return adminInfoTooltipEl;
    }

    function positionAdminInfoTooltip(target) {
        const tooltipEl = ensureAdminInfoTooltip();
        if (!tooltipEl || !target) return;

        const rect = target.getBoundingClientRect();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const margin = 10;

        tooltipEl.style.top = '0px';
        tooltipEl.style.left = '0px';
        const tooltipRect = tooltipEl.getBoundingClientRect();
        const tooltipWidth = tooltipRect.width || Math.min(320, Math.max(180, viewportWidth - (margin * 2)));
        const tooltipHeight = tooltipRect.height || 0;

        const preferredTop = rect.top - tooltipHeight - 10;
        const placeBelow = preferredTop < margin && rect.bottom + tooltipHeight + 10 <= viewportHeight - margin;
        const top = placeBelow
            ? Math.min(viewportHeight - tooltipHeight - margin, rect.bottom + 10)
            : Math.max(margin, preferredTop);
        const centeredLeft = rect.left + (rect.width / 2) - (tooltipWidth / 2);
        const left = Math.max(margin, Math.min(centeredLeft, viewportWidth - tooltipWidth - margin));

        tooltipEl.dataset.placement = placeBelow ? 'bottom' : 'top';
        tooltipEl.style.top = `${Math.round(top)}px`;
        tooltipEl.style.left = `${Math.round(left)}px`;
    }

    function hideAdminInfoTooltip(target = null) {
        const tooltipEl = ensureAdminInfoTooltip();
        if (!tooltipEl) return;
        if (target && adminInfoTooltipTarget && target !== adminInfoTooltipTarget) return;
        if (adminInfoTooltipTarget) {
            adminInfoTooltipTarget.removeAttribute('aria-describedby');
        }
        adminInfoTooltipTarget = null;
        tooltipEl.classList.remove('is-visible');
        tooltipEl.setAttribute('aria-hidden', 'true');
        tooltipEl.textContent = '';
        delete tooltipEl.dataset.placement;
    }

    function showAdminInfoTooltip(target) {
        const tooltipEl = ensureAdminInfoTooltip();
        if (!tooltipEl || !target) return;
        const tipText = String(target.getAttribute('data-tip') || '').trim();
        if (!tipText) {
            hideAdminInfoTooltip();
            return;
        }
        adminInfoTooltipTarget = target;
        tooltipEl.textContent = tipText;
        tooltipEl.setAttribute('aria-hidden', 'false');
        target.setAttribute('aria-describedby', tooltipEl.id);
        positionAdminInfoTooltip(target);
        tooltipEl.classList.add('is-visible');
    }

    function initializeInfoTips() {
        if (!document.body) return;
        document.body.classList.add('js-info-tooltips');
        ensureAdminInfoTooltip();

        document.querySelectorAll('.info-tip').forEach((tipEl) => {
            if (!(tipEl instanceof HTMLElement) || tipEl.dataset.tooltipBound === '1') return;
            tipEl.dataset.tooltipBound = '1';
            if (!tipEl.getAttribute('aria-label')) {
                const tipText = String(tipEl.getAttribute('data-tip') || '').trim();
                if (tipText) {
                    tipEl.setAttribute('aria-label', tipText);
                }
            }
            tipEl.addEventListener('mouseenter', () => showAdminInfoTooltip(tipEl));
            tipEl.addEventListener('mouseleave', () => hideAdminInfoTooltip(tipEl));
            tipEl.addEventListener('focus', () => showAdminInfoTooltip(tipEl));
            tipEl.addEventListener('blur', () => hideAdminInfoTooltip(tipEl));
            tipEl.addEventListener('click', (event) => {
                event.preventDefault();
                if (adminInfoTooltipTarget === tipEl) {
                    hideAdminInfoTooltip(tipEl);
                    return;
                }
                showAdminInfoTooltip(tipEl);
            });
        });

        if (document.body.dataset.infoTooltipListenersBound === '1') return;
        document.body.dataset.infoTooltipListenersBound = '1';
        document.addEventListener('scroll', () => {
            if (adminInfoTooltipTarget) {
                positionAdminInfoTooltip(adminInfoTooltipTarget);
            }
        }, true);
        window.addEventListener('resize', () => {
            if (adminInfoTooltipTarget) {
                positionAdminInfoTooltip(adminInfoTooltipTarget);
            }
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                hideAdminInfoTooltip();
            }
        });
        document.addEventListener('pointerdown', (event) => {
            const target = event.target;
            if (target instanceof Element && target.closest('.info-tip')) return;
            hideAdminInfoTooltip();
        });
    }

    function formatSummaryRatio(metric, totalUsers) {
        if (!metric || !Number.isFinite(Number(metric.count))) {
            return { value: 'N/A', meta: 'Not available' };
        }
        const count = Number(metric.count || 0);
        const percentage = Number.isFinite(Number(metric.percentage))
            ? Number(metric.percentage)
            : (totalUsers > 0 ? Math.round((count / totalUsers) * 100) : 0);
        return {
            value: `${percentage}%`,
            meta: `${count} of ${totalUsers}`
        };
    }

    function calculatePercentage(value, total) {
        const num = Number(value || 0);
        const denom = Number(total || 0);
        if (!Number.isFinite(num) || !Number.isFinite(denom) || denom <= 0) return 0;
        return Math.round((num / denom) * 100);
    }

    const doughnutPercentagePlugin = {
        id: 'usersDoughnutPercentagePlugin',
        afterDatasetsDraw(chart) {
            if (chart.config.type !== 'doughnut') return;
            const dataset = chart.data?.datasets?.[0];
            const data = Array.isArray(dataset?.data) ? dataset.data.map((value) => Number(value || 0)) : [];
            const total = data.reduce((sum, value) => sum + value, 0);
            if (!total) return;

            const ctx = chart.ctx;
            const meta = chart.getDatasetMeta(0);
            const palette = getChartPalette();
            ctx.save();
            ctx.font = '700 11px sans-serif';

            meta.data.forEach((arc, index) => {
                const value = data[index];
                const percentage = calculatePercentage(value, total);
                if (!percentage) return;
                const circumference = arc.circumference || 0;
                if (circumference < 0.35) return;
                const angle = arc.startAngle + (circumference / 2);
                const radius = arc.innerRadius + ((arc.outerRadius - arc.innerRadius) * 0.52);
                const x = arc.x + (Math.cos(angle) * radius);
                const y = arc.y + (Math.sin(angle) * radius);
                // Use hardcoded pill colours so labels are always legible
                // regardless of CSS-var resolution timing
                drawLabelPill(ctx, x, y, `${percentage}%`, {
                    background: 'rgba(8, 14, 28, 0.82)',
                    border: 'rgba(255,255,255,0.12)',
                    color: '#f1f5f9',
                    height: 20,
                    radius: 10
                });
            });
            ctx.restore();
        }
    };

    const barPercentagePlugin = {
        id: 'usersBarPercentagePlugin',
        afterDatasetsDraw(chart) {
            if (chart.config.type !== 'bar') return;
            const dataset = chart.data?.datasets?.[0];
            const data = Array.isArray(dataset?.data) ? dataset.data.map((value) => Number(value || 0)) : [];
            const total = data.reduce((sum, value) => sum + value, 0);
            if (!total) return;

            const ctx = chart.ctx;
            const meta = chart.getDatasetMeta(0);
            const palette = getChartPalette();
            ctx.save();
            ctx.font = '700 10px sans-serif';

            meta.data.forEach((bar, index) => {
                const percentage = calculatePercentage(data[index], total);
                if (!percentage) return;
                drawLabelPill(ctx, bar.x, Math.max(12, bar.y - 10), `${percentage}%`, {
                    background: withAlpha(palette.surface, 0.94),
                    border: withAlpha(palette.textSecondary, 0.18),
                    color: palette.textPrimary,
                    height: 18,
                    radius: 9,
                    paddingX: 5,
                    paddingY: 2
                });
            });
            ctx.restore();
        }
    };

    const doughnutCenterPlugin = {
        id: 'doughnutCenterPlugin',
        afterDatasetsDraw(chart) {
            if (chart.config.type !== 'doughnut') return;
            const label = chart.options?.plugins?.centerLabel;
            if (!label) return;
            const meta = chart.getDatasetMeta(0);
            const arc = meta?.data?.[0];
            if (!arc) return;
            const { x: cx, y: cy } = arc;
            const palette = getChartPalette();
            const ctx = chart.ctx;
            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `800 ${label.valueSize || 20}px system-ui, sans-serif`;
            ctx.fillStyle = label.valueColor || palette.textPrimary;
            ctx.fillText(label.value, cx, cy - 9);
            ctx.font = `500 ${label.subSize || 10}px system-ui, sans-serif`;
            ctx.fillStyle = palette.textSecondary;
            ctx.fillText(label.sub || '', cx, cy + 10);
            ctx.restore();
        }
    };

    function updatePlatformStatsFromSummary(summary) {
        if (!summary) return;
        const totalUsers = Number(summary.totalUsers || 0);
        const configuredCount = Number(summary.configured?.count || 0);
        const automationActiveCount = Number(summary.automationActive?.count || 0);

        const totalEl = document.getElementById('statTotalUsers');
        const configuredEl = document.getElementById('statConfigured');
        const automationEl = document.getElementById('statAutomationActive');
        if (totalEl) totalEl.textContent = totalUsers;
        if (configuredEl) configuredEl.textContent = configuredCount;
        if (automationEl) automationEl.textContent = automationActiveCount;
    }

    function destroyUsersSummaryCharts() {
        if (usersProviderChart) {
            usersProviderChart.destroy();
            usersProviderChart = null;
        }
        if (usersInverterSizeChart) {
            usersInverterSizeChart.destroy();
            usersInverterSizeChart = null;
        }
        if (usersBatterySizeChart) {
            usersBatterySizeChart.destroy();
            usersBatterySizeChart = null;
        }
        if (usersCouplingChart) {
            usersCouplingChart.destroy();
            usersCouplingChart = null;
        }
        if (usersTourChart) {
            usersTourChart.destroy();
            usersTourChart = null;
        }
    }

    function setUsersSummaryLoading() {
        const card = document.getElementById('usersSummaryCard');
        const note = document.getElementById('usersSummaryNote');
        const content = document.getElementById('usersSummaryContent');
        if (!card || !note || !content) return;
        destroyUsersSummaryCharts();
        card.style.display = '';
        note.textContent = 'Computed from the existing admin users scan.';
        content.innerHTML = '<div class="users-summary-loading">Loading summary...</div>';
    }

    function updateUsersScopeNote() {
        const note = document.getElementById('usersTableScopeNote');
        if (!note) return;
        const scope = getUsersFilterScopeLabel();
        const activeFilterCount = countActiveUsersFilters();
        const loadedCount = Array.isArray(currentUsers) ? currentUsers.length : 0;
        const filteredCount = Array.isArray(currentUsersFiltered) ? currentUsersFiltered.length : loadedCount;

        if (activeFilterCount > 0) {
            note.textContent = `Loaded ${loadedCount} users in last sign-in order. ${filteredCount} match the current filters. Filters and column sorting apply to ${scope}.`;
            return;
        }

        if (currentUsersPagination.showAll) {
            note.textContent = `All ${loadedCount} users loaded. Filters and column sorting apply to ${scope}.`;
            return;
        }

        note.textContent = `Top ${currentUsersPagination.pageSize} by last sign-in. Filters and column sorting apply to ${scope}.`;
    }

    function buildUsersQuery({ page, pageSize, showAll, includeSummary, refreshSummary }) {
        const params = new URLSearchParams();
        params.set('page', String(page || 1));
        params.set('limit', String(pageSize || 50));
        params.set('all', showAll ? '1' : '0');
        params.set('includeSummary', includeSummary ? '1' : '0');
        if (refreshSummary) {
            params.set('refreshSummary', '1');
        }
        return params.toString();
    }

    function renderUsersPagination(pagination) {
        const footer = document.getElementById('usersTableFooter');
        const meta = document.getElementById('usersPaginationMeta');
        const status = document.getElementById('usersPaginationStatus');
        const prevBtn = document.getElementById('usersPrevPageBtn');
        const nextBtn = document.getElementById('usersNextPageBtn');
        const toggleBtn = document.getElementById('usersToggleAllBtn');
        if (!footer || !meta || !status || !prevBtn || !nextBtn || !toggleBtn) return;

        const info = pagination || currentUsersPagination;
        const activeFilterCount = countActiveUsersFilters();
        const loadedCount = Array.isArray(currentUsers) ? currentUsers.length : 0;
        const filteredCount = Array.isArray(currentUsersFiltered) ? currentUsersFiltered.length : loadedCount;
        footer.style.display = '';
        meta.textContent = info.showAll
            ? `Showing all ${info.totalUsers} users. Server default order is last sign-in.`
            : `Showing page ${info.page} of ${info.totalPages}. Default page order is by last sign-in.`;
        if (activeFilterCount > 0) {
            meta.textContent += ` ${filteredCount} of ${loadedCount} loaded users match the current filters.`;
        }
        status.textContent = activeFilterCount > 0
            ? `${filteredCount} / ${loadedCount} match`
            : (info.showAll ? `All ${info.totalUsers}` : `Page ${info.page} of ${info.totalPages}`);
        prevBtn.disabled = info.showAll || info.page <= 1;
        nextBtn.disabled = info.showAll || info.page >= info.totalPages;
        toggleBtn.textContent = info.showAll ? 'Back to top 50' : 'Show all';
        updateUsersScopeNote();
    }

    function createDoughnutOptions(_entries) {
        // Legend is replaced by a custom HTML legend (see createDoughnutLegendHTML),
        // so we disable Chart.js's built-in renderer entirely — this avoids
        // CSS-var colour resolution issues that caused black/unreadable text.
        return {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            radius: '88%',
            layout: {
                padding: { top: 8, right: 8, bottom: 8, left: 8 }
            },
            animation: {
                animateRotate: true,
                duration: 750,
                easing: 'easeOutQuart'
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    // Hardcoded dark-themed tooltip — no CSS var dependency
                    backgroundColor: 'rgba(15, 23, 42, 0.96)',
                    titleColor: '#e2e8f0',
                    bodyColor: '#94a3b8',
                    borderColor: 'rgba(148, 163, 184, 0.18)',
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label(context) {
                            const data = context.dataset.data.map((v) => Number(v || 0));
                            const total = data.reduce((s, v) => s + v, 0);
                            const count = Number(context.raw || 0);
                            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                            return ` ${context.label}: ${count}  (${pct}%)`;
                        }
                    }
                }
            }
        };
    }

    const DOUGHNUT_PROVIDER_COLORS = ['#3b9eff', '#22d3a0', '#fb923c', '#f472b6', '#64748b', '#a78bfa'];
    const DOUGHNUT_COUPLING_COLORS = ['#3b9eff', '#22d3a0', '#64748b'];
    const DOUGHNUT_TOUR_COLORS = ['#22d3a0', '#64748b', '#3b9eff'];

    function createDoughnutLegendHTML(entries, colors, total) {
        return entries.map((entry, i) => {
            const count = Number(entry.count || 0);
            const pct = calculatePercentage(count, total);
            const color = colors[i % colors.length];
            const label = String(entry.label || 'Unknown').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `<span class="chart-legend-item"><span class="chart-legend-dot" style="background:${color}"></span><span class="chart-legend-text">${label}</span><span class="chart-legend-pct">${pct}%</span></span>`;
        }).join('');
    }

    function insertChartLegend(canvas, html) {
        const existing = canvas.parentElement.parentElement.querySelector('.chart-html-legend');
        if (existing) existing.remove();
        const div = document.createElement('div');
        div.className = 'chart-html-legend';
        div.innerHTML = html;
        canvas.parentElement.insertAdjacentElement('afterend', div);
    }

    function renderUsersProviderChart(entries) {
        const canvas = document.getElementById('usersProviderChart');
        if (!canvas || typeof Chart === 'undefined' || !Array.isArray(entries) || !entries.length) return;
        const total = entries.reduce((s, e) => s + Number(e.count || 0), 0);
        const options = createDoughnutOptions(entries);
        options.plugins.centerLabel = { value: String(total), sub: 'users' };
        usersProviderChart = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: entries.map((e) => e.label),
                datasets: [{
                    data: entries.map((e) => Number(e.count || 0)),
                    backgroundColor: DOUGHNUT_PROVIDER_COLORS.slice(0, entries.length),
                    borderColor: 'transparent',
                    borderWidth: 0,
                    hoverOffset: 12,
                    spacing: 4
                }]
            },
            options,
            plugins: [doughnutPercentagePlugin, doughnutCenterPlugin]
        });
        insertChartLegend(canvas, createDoughnutLegendHTML(entries, DOUGHNUT_PROVIDER_COLORS, total));
    }

    function renderUsersTourChart(entries) {
        const canvas = document.getElementById('usersTourChart');
        if (!canvas || typeof Chart === 'undefined' || !Array.isArray(entries) || !entries.length) return;
        const total = entries.reduce((s, e) => s + Number(e.count || 0), 0);
        const options = createDoughnutOptions(entries);
        options.plugins.centerLabel = { value: String(total), sub: 'users' };
        usersTourChart = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: entries.map((e) => e.label),
                datasets: [{
                    data: entries.map((e) => Number(e.count || 0)),
                    backgroundColor: DOUGHNUT_TOUR_COLORS.slice(0, entries.length),
                    borderColor: 'transparent',
                    borderWidth: 0,
                    hoverOffset: 12,
                    spacing: 4
                }]
            },
            options,
            plugins: [doughnutPercentagePlugin, doughnutCenterPlugin]
        });
        insertChartLegend(canvas, createDoughnutLegendHTML(entries, DOUGHNUT_TOUR_COLORS, total));
    }

    function renderUsersCouplingChart(entries) {
        const canvas = document.getElementById('usersCouplingChart');
        if (!canvas || typeof Chart === 'undefined' || !Array.isArray(entries) || !entries.length) return;
        const total = entries.reduce((s, e) => s + Number(e.count || 0), 0);
        const options = createDoughnutOptions(entries);
        options.plugins.centerLabel = { value: String(total), sub: 'systems' };
        usersCouplingChart = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: entries.map((e) => e.label),
                datasets: [{
                    data: entries.map((e) => Number(e.count || 0)),
                    backgroundColor: DOUGHNUT_COUPLING_COLORS.slice(0, entries.length),
                    borderColor: 'transparent',
                    borderWidth: 0,
                    hoverOffset: 12,
                    spacing: 4
                }]
            },
            options,
            plugins: [doughnutPercentagePlugin, doughnutCenterPlugin]
        });
        insertChartLegend(canvas, createDoughnutLegendHTML(entries, DOUGHNUT_COUPLING_COLORS, total));
    }

    function createDistributionChart(canvasId, entries, label, colors) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || typeof Chart === 'undefined' || !Array.isArray(entries) || !entries.length) return;
        const palette = getChartPalette();
        const backgroundGradient = createVerticalGradient(canvas, colors.top, colors.bottom);

        return new Chart(canvas, {
            type: 'bar',
            data: {
                labels: entries.map((entry) => entry.label),
                datasets: [{
                    label,
                    data: entries.map((entry) => Number(entry.count || 0)),
                    backgroundColor: backgroundGradient,
                    borderColor: colors.border,
                    borderWidth: 1,
                    borderRadius: 14,
                    borderSkipped: false,
                    barPercentage: 0.8,
                    categoryPercentage: 0.84,
                    maxBarThickness: 64,
                    hoverBackgroundColor: colors.hover,
                    clip: 20
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: { top: 24, right: 8, bottom: 0, left: 0 }
                },
                animation: {
                    duration: 650,
                    easing: 'easeOutQuart'
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: withAlpha(palette.surface, 0.96),
                        titleColor: palette.textPrimary,
                        bodyColor: palette.textSecondary,
                        borderColor: withAlpha(palette.textSecondary, 0.14),
                        borderWidth: 1,
                        padding: 10,
                        callbacks: {
                            label(context) {
                                const values = context.dataset.data.map((value) => Number(value || 0));
                                const total = values.reduce((sum, value) => sum + value, 0);
                                const count = Number(context.raw || 0);
                                const percentage = calculatePercentage(count, total);
                                return `${count} users (${percentage}%)`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            color: palette.textSecondary,
                            maxRotation: 0,
                            minRotation: 0,
                            font: { size: 11 }
                        },
                        grid: { display: false },
                        border: { display: false }
                    },
                    y: {
                        beginAtZero: true,
                        grace: '18%',
                        ticks: {
                            color: palette.textSecondary,
                            precision: 0,
                            padding: 8,
                            stepSize: 1
                        },
                        grid: {
                            color: withAlpha(palette.textSecondary, 0.08),
                            drawBorder: false
                        },
                        border: { display: false }
                    }
                }
            },
            plugins: [barPercentagePlugin]
        });
    }

    function renderUsersInverterSizeChart(entries) {
        usersInverterSizeChart = createDistributionChart('usersInverterSizeChart', entries, 'Inverter users', {
            top: 'rgba(116, 188, 255, 0.95)',
            bottom: 'rgba(62, 124, 204, 0.72)',
            border: 'rgba(125, 196, 255, 0.95)',
            hover: 'rgba(135, 203, 255, 0.98)'
        });
    }

    function renderUsersBatterySizeChart(entries) {
        usersBatterySizeChart = createDistributionChart('usersBatterySizeChart', entries, 'Battery users', {
            top: 'rgba(140, 229, 151, 0.95)',
            bottom: 'rgba(79, 153, 88, 0.72)',
            border: 'rgba(155, 238, 165, 0.95)',
            hover: 'rgba(156, 240, 167, 0.98)'
        });
    }

    function renderUsersSummary(summary) {
        const card = document.getElementById('usersSummaryCard');
        const note = document.getElementById('usersSummaryNote');
        const content = document.getElementById('usersSummaryContent');
        if (!card || !note || !content) return;

        destroyUsersSummaryCharts();

        if (!summary) {
            card.style.display = 'none';
            content.innerHTML = '';
            note.textContent = '';
            return;
        }

        const totalUsers = Number(summary.totalUsers || 0);
        const configured = formatSummaryRatio(summary.configured, totalUsers);
        const automationActive = formatSummaryRatio(summary.automationActive, totalUsers);
        const amberConfigured = formatSummaryRatio(summary.amberConfigured, totalUsers);
        const evConfigured = summary.evConfigured && summary.evConfigured.available
            ? formatSummaryRatio(summary.evConfigured, totalUsers)
            : { value: 'N/A', meta: summary.evConfigured?.note || 'Not available in low-cost mode' };

        const providerBreakdown = Array.isArray(summary.providerBreakdown) ? summary.providerBreakdown : [];
        const topLocations = Array.isArray(summary.topLocations) ? summary.topLocations : [];
        const inverterSizeDistribution = Array.isArray(summary.inverterSizeDistribution) ? summary.inverterSizeDistribution : [];
        const batterySizeDistribution = Array.isArray(summary.batterySizeDistribution) ? summary.batterySizeDistribution : [];
        const couplingBreakdown = Array.isArray(summary.couplingBreakdown) ? summary.couplingBreakdown : [];
        const tourStatusBreakdown = Array.isArray(summary.tourStatusBreakdown) ? summary.tourStatusBreakdown : [];
        const notes = Array.isArray(summary.notes) ? summary.notes.filter(Boolean) : [];
        const configuredPct = totalUsers > 0 ? Math.round((Number(summary.configured?.count || 0) / totalUsers) * 100) : 0;
        const automationPct = totalUsers > 0 ? Math.round((Number(summary.automationActive?.count || 0) / totalUsers) * 100) : 0;
        const amberPct = totalUsers > 0 ? Math.round((Number(summary.amberConfigured?.count || 0) / totalUsers) * 100) : 0;
        const evPct = (summary.evConfigured?.available && totalUsers > 0) ? Math.round((Number(summary.evConfigured?.count || 0) / totalUsers) * 100) : 0;
        const evAvailable = !!(summary.evConfigured?.available);
        const topLocationsMaxCount = topLocations.length > 0 ? Math.max(1, Number(topLocations[0]?.count || 1)) : 1;

        note.textContent = notes[0] || 'Computed from the existing admin users scan.';
        card.style.display = '';
        content.innerHTML = `
            <div class="users-summary-kpis">
                <div class="users-summary-kpi kpi-configured">
                    <div class="kpi-top">
                        <div class="label">Configured</div>
                        <span class="kpi-icon">🔧</span>
                    </div>
                    <div class="value">${escapeHtml(configured.value)}</div>
                    <div class="meta">${escapeHtml(configured.meta)}</div>
                    <div class="kpi-progress"><div class="kpi-progress-fill" style="width:${configuredPct}%"></div></div>
                </div>
                <div class="users-summary-kpi kpi-automation">
                    <div class="kpi-top">
                        <div class="label">Automation Active</div>
                        <span class="kpi-icon">⚡</span>
                    </div>
                    <div class="value">${escapeHtml(automationActive.value)}</div>
                    <div class="meta">${escapeHtml(automationActive.meta)}</div>
                    <div class="kpi-progress"><div class="kpi-progress-fill" style="width:${automationPct}%"></div></div>
                </div>
                <div class="users-summary-kpi kpi-amber">
                    <div class="kpi-top">
                        <div class="label">Amber Configured</div>
                        <span class="kpi-icon">🟡</span>
                    </div>
                    <div class="value">${escapeHtml(amberConfigured.value)}</div>
                    <div class="meta">${escapeHtml(amberConfigured.meta)}</div>
                    <div class="kpi-progress"><div class="kpi-progress-fill" style="width:${amberPct}%"></div></div>
                </div>
                <div class="users-summary-kpi kpi-ev">
                    <div class="kpi-top">
                        <div class="label">EV Linked</div>
                        <span class="kpi-icon">🚗</span>
                    </div>
                    <div class="value">${escapeHtml(evConfigured.value)}</div>
                    <div class="meta">${escapeHtml(evConfigured.meta)}</div>
                    ${evAvailable ? `<div class="kpi-progress"><div class="kpi-progress-fill" style="width:${evPct}%"></div></div>` : ''}
                </div>
            </div>
            <div class="users-summary-grid-3">
                <section class="users-summary-panel">
                    <div class="users-summary-panel-title"><span class="panel-title-icon">📡</span>Inverter Providers</div>
                    ${providerBreakdown.length ? '<div class="users-summary-chart users-summary-chart-compact"><canvas id="usersProviderChart"></canvas></div>' : '<div class="users-summary-empty">No provider data yet.</div>'}
                </section>
                <section class="users-summary-panel">
                    <div class="users-summary-panel-title"><span class="panel-title-icon">🗺️</span>Tour Status</div>
                    ${tourStatusBreakdown.length ? '<div class="users-summary-chart users-summary-chart-compact"><canvas id="usersTourChart"></canvas></div>' : '<div class="users-summary-empty">No tour data yet.</div>'}
                </section>
                <section class="users-summary-panel">
                    <div class="users-summary-panel-title"><span class="panel-title-icon">📍</span>Top 5 Locations</div>
                    ${topLocations.length === 0 ? '<div class="users-summary-empty">No location data yet.</div>' : `
                        <div class="rank-list">
                            ${topLocations.map((row, idx) => {
                                const cnt = Number(row.count || 0);
                                const bw = topLocationsMaxCount > 0 ? Math.round((cnt / topLocationsMaxCount) * 100) : 0;
                                const cntLabel = cnt + ' user' + (cnt === 1 ? '' : 's');
                                return '<div class="rank-row"><span class="rank-num">' + String(idx + 1).padStart(2, '0') + '</span><span class="rank-label">' + escapeHtml(row.label || row.key || 'Unknown') + '</span><div class="rank-bar-track"><div class="rank-bar" style="width:' + bw + '%"></div></div><span class="rank-badge">' + escapeHtml(cntLabel) + '</span></div>';
                            }).join('')}
                        </div>
                    `}
                </section>
            </div>
            <div class="users-summary-grid-3">
                <section class="users-summary-panel">
                    <div class="users-summary-panel-title"><span class="panel-title-icon">⚡</span>Inverter Sizes</div>
                    ${inverterSizeDistribution.length ? '<div class="users-summary-chart users-summary-chart-compact"><canvas id="usersInverterSizeChart"></canvas></div>' : '<div class="users-summary-empty">No inverter size data yet.</div>'}
                </section>
                <section class="users-summary-panel">
                    <div class="users-summary-panel-title"><span class="panel-title-icon">🔋</span>Battery Sizes</div>
                    ${batterySizeDistribution.length ? '<div class="users-summary-chart users-summary-chart-compact"><canvas id="usersBatterySizeChart"></canvas></div>' : '<div class="users-summary-empty">No battery size data yet.</div>'}
                </section>
                <section class="users-summary-panel">
                    <div class="users-summary-panel-title"><span class="panel-title-icon">🔗</span>Coupling</div>
                    ${couplingBreakdown.length ? '<div class="users-summary-chart users-summary-chart-compact"><canvas id="usersCouplingChart"></canvas></div>' : '<div class="users-summary-empty">No coupling data yet.</div>'}
                </section>
            </div>
            ${notes[1] ? `<div class="users-summary-footnote">${escapeHtml(notes[1])}</div>` : ''}
        `;

        renderUsersProviderChart(providerBreakdown);
        renderUsersTourChart(tourStatusBreakdown);
        renderUsersInverterSizeChart(inverterSizeDistribution);
        renderUsersBatterySizeChart(batterySizeDistribution);
        renderUsersCouplingChart(couplingBreakdown);
    }

    function toComparableTimestamp(value) {
        if (!value) return 0;
        if (typeof value === 'string') {
            const t = Date.parse(value);
            return Number.isNaN(t) ? 0 : t;
        }
        if (value.toDate && typeof value.toDate === 'function') {
            const d = value.toDate();
            return d && d.getTime ? d.getTime() : 0;
        }
        if (value._seconds) return value._seconds * 1000;
        if (value.seconds) return value.seconds * 1000;
        if (typeof value === 'number') return value;
        const fallback = new Date(value).getTime();
        return Number.isNaN(fallback) ? 0 : fallback;
    }

    function isUserConfigured(user) {
        if (typeof user?.configured === 'boolean') return user.configured;
        return !!(user?.profileInitialized || Number(user?.rulesCount || 0) > 0 || (user?.hasDeviceSn && user?.hasFoxessToken));
    }

    function getSortValue(user, key) {
        switch (key) {
            case 'email': return (user.email || '').toLowerCase();
            case 'role': return (user.role || 'user').toLowerCase();
            case 'configured': return isUserConfigured(user) ? 1 : 0;
            case 'automationEnabled': return user.automationEnabled ? 1 : 0;
            case 'joinedAt': return toComparableTimestamp(user.joinedAt || user.createdAt);
            case 'lastSignedInAt': return toComparableTimestamp(user.lastSignedInAt);
            case 'rulesCount': return Number(user.rulesCount || 0);
            case 'actions': return (user.email || user.uid || '').toLowerCase();
            default: return (user.email || '').toLowerCase();
        }
    }

    function sortUsers(users) {
        const sorted = [...users].sort((a, b) => {
            const av = getSortValue(a, currentSort.key);
            const bv = getSortValue(b, currentSort.key);
            let cmp = 0;
            if (typeof av === 'string' || typeof bv === 'string') {
                cmp = String(av).localeCompare(String(bv));
            } else {
                cmp = av - bv;
            }
            if (cmp === 0) {
                // Stable tie-breaker by email
                cmp = String(a.email || '').localeCompare(String(b.email || ''));
            }
            return currentSort.direction === 'asc' ? cmp : -cmp;
        });
        return sorted;
    }

    function sortBy(key) {
        if (currentSort.key === key) {
            currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
        } else {
            currentSort.key = key;
            currentSort.direction = 'asc';
        }
        renderUsersView();
    }

    function sortIcon(key) {
        if (currentSort.key !== key) return '↕';
        return currentSort.direction === 'asc' ? '↑' : '↓';
    }

    // ==================== Tab Switching ====================
    function switchTab(name) {
        activeTab = name;
        let activeButton = null;
        document.querySelectorAll('.tab-btn').forEach((btn) => {
            const isActive = btn.dataset.tab === name;
            btn.classList.toggle('active', isActive);
            if (isActive) activeButton = btn;
        });
        document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `tab-${name}`));
        const tabNav = document.querySelector('.admin-tab-nav');
        if (tabNav && activeButton && tabNav.scrollWidth > tabNav.clientWidth) {
            try {
                const reduceMotion = typeof window.matchMedia === 'function'
                    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
                    : false;
                activeButton.scrollIntoView({
                    behavior: reduceMotion ? 'auto' : 'smooth',
                    block: 'nearest',
                    inline: 'center'
                });
            } catch (error) {
                activeButton.scrollIntoView();
            }
        }
        if (!tabsLoaded[name]) {
            tabsLoaded[name] = true;
            if (name === 'overview') {
                loadPlatformStats();
                loadFirestoreCostMetrics();
            } else if (name === 'behavior') {
                loadBehaviorMetrics();
            } else if (name === 'announcement') {
                loadAdminAnnouncement();
            } else if (name === 'scheduler') {
                loadSchedulerMetrics();
            } else if (name === 'dataworks') {
                loadDataworks();
            } else if (name === 'users') {
                if (!currentUsersSummary) {
                    setUsersSummaryLoading();
                }
                loadUsers({ includeSummary: false, requestSummary: true });
            } else if (name === 'apiHealth') {
                loadApiHealth();
            }
        }
    }

    // ==================== Admin Check ====================
    async function checkAdminAccess() {
        try {
            const resp = await adminApiClient.fetch('/api/admin/check');
            const data = await resp.json();
            if (data.errno === 0 && data.result?.isAdmin) {
                document.getElementById('adminContent').style.display = '';
                document.getElementById('accessDenied').style.display = 'none';
                switchTab('overview');
            } else {
                document.getElementById('adminContent').style.display = 'none';
                document.getElementById('accessDenied').style.display = '';
            }
        } catch (e) {
            console.error('[Admin] Access check failed:', e);
            document.getElementById('adminContent').style.display = 'none';
            document.getElementById('accessDenied').style.display = '';
        }
    }

    // ==================== Load Users ====================
    async function loadUsers(options = {}) {
        const requestSequence = ++usersTableRequestSequence;
        const loading = document.getElementById('usersLoading');
        const tableWrapper = document.getElementById('usersTableWrapper');
        const footer = document.getElementById('usersTableFooter');
        const includeSummary = options.includeSummary ?? false;
        const requestSummary = options.requestSummary ?? false;
        const refreshSummary = options.refreshSummary ?? false;
        const showAll = options.showAll ?? currentUsersPagination.showAll ?? false;
        const page = options.page ?? currentUsersPagination.page ?? 1;
        const pageSize = options.pageSize ?? currentUsersPagination.pageSize ?? 50;
        loading.textContent = 'Loading users...';
        loading.style.color = '';
        loading.style.display = '';
        tableWrapper.style.display = 'none';
        if (footer) footer.style.display = 'none';
        if ((includeSummary || requestSummary) && !currentUsersSummary) {
            setUsersSummaryLoading();
        }

        try {
            const query = buildUsersQuery({ page, pageSize, showAll, includeSummary });
            const resp = await adminApiClient.fetch(`/api/admin/users?${query}`);
            const data = await resp.json();
            if (data.errno !== 0) throw new Error(data.error || 'Failed to load users');
            if (requestSequence !== usersTableRequestSequence) return;

            currentUsers = data.result.users || [];
            currentUsersPagination = data.result.pagination || { page: 1, pageSize: 50, totalUsers: currentUsers.length, totalPages: 1, showAll, sortingScope: showAll ? 'all-loaded' : 'current-page' };
            if (data.result.summary) {
                currentUsersSummary = data.result.summary;
                renderUsersSummary(currentUsersSummary);
                updatePlatformStatsFromSummary(currentUsersSummary);
            } else if (currentUsersSummary) {
                renderUsersSummary(currentUsersSummary);
            }
            renderUsersView();

            loading.style.display = 'none';
            tableWrapper.style.display = '';

            if (!includeSummary && requestSummary) {
                loadUsersSummary({ refreshSummary });
            }
        } catch (e) {
            if (requestSequence !== usersTableRequestSequence) return;
            console.error('[Admin] Failed to load users:', e);
            tabsLoaded.users = false;
            if (!currentUsersSummary) {
                renderUsersSummary(null);
            }
            loading.textContent = `Failed to load users: ${e.message}`;
            loading.style.color = 'var(--color-danger)';
        }
    }

    async function loadUsersSummary(options = {}) {
        const requestSequence = ++usersSummaryRequestSequence;
        const refreshSummary = options.refreshSummary === true;

        if (!currentUsersSummary) {
            setUsersSummaryLoading();
        }

        try {
            const query = buildUsersQuery({
                page: 1,
                pageSize: 1,
                showAll: false,
                includeSummary: true,
                refreshSummary
            });
            const resp = await adminApiClient.fetch(`/api/admin/users?${query}`);
            const data = await resp.json();
            if (data.errno !== 0) throw new Error(data.error || 'Failed to load users summary');
            if (requestSequence !== usersSummaryRequestSequence) return;

            if (data.result.summary) {
                currentUsersSummary = data.result.summary;
                renderUsersSummary(currentUsersSummary);
                updatePlatformStatsFromSummary(currentUsersSummary);
            } else if (!currentUsersSummary) {
                renderUsersSummary(null);
            }
        } catch (e) {
            if (requestSequence !== usersSummaryRequestSequence) return;
            console.error('[Admin] Failed to load users summary:', e);
            if (!currentUsersSummary) {
                renderUsersSummary(null);
            }
        }
    }

    async function refreshOverviewData() {
        const refreshBtn = document.getElementById('refreshOverviewBtn');
        if (refreshBtn?.disabled) return;

        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.textContent = 'Refreshing...';
        }

        try {
            await Promise.allSettled([
                loadPlatformStats(),
                loadFirestoreCostMetrics()
            ]);
            tabsLoaded.overview = true;
        } finally {
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.textContent = '🔄 Refresh';
            }
        }
    }

    function refreshAdminData() {
        tabsLoaded[activeTab] = false;
        currentUsersPagination = { page: 1, pageSize: 50, totalUsers: 0, totalPages: 1, showAll: false, sortingScope: 'current-page' };
        currentUsersSummary = null;
        switchTab(activeTab);
    }

    function goToUsersPage(direction) {
        if (currentUsersPagination.showAll) return;
        const nextPage = Math.max(1, Math.min(currentUsersPagination.totalPages, currentUsersPagination.page + Number(direction || 0)));
        if (nextPage === currentUsersPagination.page) return;
        loadUsers({ page: nextPage, pageSize: currentUsersPagination.pageSize, showAll: false, includeSummary: false, requestSummary: false });
    }

    function toggleAllUsers() {
        const nextShowAll = !currentUsersPagination.showAll;
        loadUsers({ page: 1, pageSize: 50, showAll: nextShowAll, includeSummary: false, requestSummary: false });
    }

    async function loadPlatformStats() {
        const subtitleEl = document.getElementById('platformTrendSubtitle');
        const warningEl = document.getElementById('platformTrendWarning');
        if (subtitleEl) {
            subtitleEl.textContent = 'Bars = active users, lines = configured users + users with rules, red line = cumulative deletions';
        }
        if (warningEl) {
            warningEl.style.display = 'none';
            warningEl.textContent = '';
        }

        try {
            const resp = await adminApiClient.fetch('/api/admin/platform-stats?days=90');
            const data = await resp.json();
            if (data.errno !== 0) throw new Error(data.error || 'Failed to load platform stats');

            const summary = data.result?.summary || {};
            const trend = Array.isArray(data.result?.trend) ? data.result.trend : [];
            const warnings = Array.isArray(data.result?.warnings) ? data.result.warnings : [];

            document.getElementById('statTotalUsers').textContent = Number(summary.totalUsers || 0);
            document.getElementById('statConfigured').textContent = Number(summary.configuredUsers || 0);
            document.getElementById('statMAU').textContent = Number(summary.mau ?? summary.admins ?? 0);
            document.getElementById('statAutomationActive').textContent = Number(summary.automationActive || 0);

            if (warningEl && warnings.length) {
                warningEl.style.display = '';
                warningEl.textContent = warnings.join(' · ');
            }

            renderPlatformTrendChart(trend);
        } catch (e) {
            console.error('[Admin] Failed to load platform stats:', e);
            if (warningEl) {
                warningEl.style.display = '';
                warningEl.textContent = e.message || String(e);
            }
            showMessage('warning', `⚠️ Failed to load trend stats: ${e.message}`);
        }
    }

    function renderPlatformTrendChart(trend) {
        const canvas = document.getElementById('platformTrendChart');
        if (!canvas || typeof Chart === 'undefined') return;

        const labels = trend.map(point => {
            const d = new Date(point.date + 'T00:00:00Z');
            return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });
        });
        const totalUsers = trend.map(point => Number(point.totalUsers || 0));
        const configuredUsers = trend.map(point => Number(point.configuredUsers || 0));
        const usersWithRules = trend.map(point => Number(point.usersWithRules || 0));
        const deletedUsers = trend.map(point => Number(point.deletedUsers || 0));

        if (platformTrendChart) {
            platformTrendChart.destroy();
            platformTrendChart = null;
        }

        platformTrendChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        type: 'bar',
                        label: 'Total Users',
                        data: totalUsers,
                        backgroundColor: 'rgba(88, 166, 255, 0.28)',
                        borderColor: 'rgba(88, 166, 255, 0.7)',
                        borderWidth: 1,
                        borderRadius: 4,
                        barPercentage: 0.9,
                        categoryPercentage: 0.95,
                        order: 1
                    },
                    {
                        type: 'line',
                        label: 'Configured Users',
                        data: configuredUsers,
                        borderColor: 'rgba(126, 231, 135, 0.95)',
                        backgroundColor: 'rgba(126, 231, 135, 0.15)',
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 3,
                        tension: 0.25,
                        fill: false,
                        order: 0
                    },
                    {
                        type: 'line',
                        label: 'Users with Rules',
                        data: usersWithRules,
                        borderColor: 'rgba(240, 136, 62, 0.95)',
                        backgroundColor: 'rgba(240, 136, 62, 0.18)',
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 3,
                        tension: 0.25,
                        fill: false,
                        order: 0
                    },
                    {
                        type: 'line',
                        label: 'Deleted Users',
                        data: deletedUsers,
                        borderColor: 'rgba(248, 81, 73, 0.95)',
                        backgroundColor: 'rgba(248, 81, 73, 0.15)',
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 3,
                        tension: 0.25,
                        fill: false,
                        order: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        labels: {
                            color: cssVar('--text-secondary'),
                            boxWidth: 12,
                            usePointStyle: true,
                            pointStyle: 'rectRounded'
                        }
                    },
                    tooltip: {
                        backgroundColor: cssVar('--bg-secondary'),
                        borderColor: cssVar('--border-primary'),
                        borderWidth: 1,
                        titleColor: cssVar('--text-primary'),
                        bodyColor: cssVar('--text-secondary')
                    }
                },
                scales: {
                    x: {
                        ticks: { color: cssVar('--text-secondary'), maxTicksLimit: 12 },
                        grid: { color: cssVar('--border-secondary') }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: {
                            color: cssVar('--text-secondary'),
                            precision: 0
                        },
                        grid: { color: cssVar('--border-secondary') }
                    }
                }
            }
        });
    }

    function destroyBehaviorCharts() {
        if (behaviorTrendChart) {
            behaviorTrendChart.destroy();
            behaviorTrendChart = null;
        }
        if (behaviorEventsChart) {
            behaviorEventsChart.destroy();
            behaviorEventsChart = null;
        }
    }

    function formatCount(value) {
        const num = Number(value || 0);
        if (!Number.isFinite(num)) return '-';
        return num.toLocaleString('en-AU');
    }

    function formatSeconds(value) {
        const seconds = Number(value || 0);
        if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
        if (seconds < 60) return `${Math.round(seconds)}s`;
        const minutes = Math.floor(seconds / 60);
        const remSeconds = Math.round(seconds % 60);
        if (minutes < 60) return `${minutes}m ${remSeconds}s`;
        const hours = Math.floor(minutes / 60);
        const remMinutes = minutes % 60;
        return `${hours}h ${remMinutes}m`;
    }

    function humanizeEventName(value) {
        const text = String(value || '').trim();
        if (!text) return '-';
        return text
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/\b\w/g, (char) => char.toUpperCase());
    }

    function resetBehaviorView() {
        destroyBehaviorCharts();
        behaviorMetricsData = null;
        behaviorSelectedPageKey = 'all';
        const setupEl = document.getElementById('behaviorSetup');
        const pagesBody = document.getElementById('behaviorTopPagesBody');
        const eventsBody = document.getElementById('behaviorTopEventsBody');
        const pagesEmpty = document.getElementById('behaviorTopPagesEmpty');
        const eventsEmpty = document.getElementById('behaviorTopEventsEmpty');
        const pageFilter = document.getElementById('behaviorPageFilter');
        const pageFilterSummary = document.getElementById('behaviorPageFilterSummary');
        ['behaviorActiveUsers', 'behaviorPageViews', 'behaviorEvents', 'behaviorAvgEngagement'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.textContent = '-';
        });
        if (setupEl) {
            setupEl.style.display = 'none';
            setupEl.textContent = '';
        }
        if (pagesBody) pagesBody.innerHTML = '';
        if (eventsBody) eventsBody.innerHTML = '';
        if (pagesEmpty) pagesEmpty.style.display = '';
        if (eventsEmpty) eventsEmpty.style.display = '';
        if (pageFilter) {
            pageFilter.innerHTML = '<option value="all">All main pages</option>';
            pageFilter.value = 'all';
            pageFilter.disabled = true;
        }
        if (pageFilterSummary) pageFilterSummary.textContent = 'Showing all tracked product pages.';
    }

    function getBehaviorSelectedPageOption() {
        const options = Array.isArray(behaviorMetricsData?.mainPageOptions) ? behaviorMetricsData.mainPageOptions : [];
        return options.find((option) => option.key === behaviorSelectedPageKey) || null;
    }

    function getBehaviorTrendSeries() {
        if (!behaviorMetricsData) return [];
        if (behaviorSelectedPageKey === 'all') {
            return Array.isArray(behaviorMetricsData.pageSeries) ? behaviorMetricsData.pageSeries : [];
        }
        const byKey = behaviorMetricsData.pageSeriesByKey && typeof behaviorMetricsData.pageSeriesByKey === 'object'
            ? behaviorMetricsData.pageSeriesByKey
            : {};
        return Array.isArray(byKey[behaviorSelectedPageKey]) ? byKey[behaviorSelectedPageKey] : [];
    }

    function updateBehaviorFilterSummary() {
        const summaryEl = document.getElementById('behaviorPageFilterSummary');
        if (!summaryEl) return;
        const selected = getBehaviorSelectedPageOption();
        summaryEl.textContent = selected
            ? `Showing ${selected.label} only.`
            : 'Showing all tracked product pages.';
    }

    function populateBehaviorPageFilter() {
        const pageFilter = document.getElementById('behaviorPageFilter');
        if (!pageFilter) return;
        const options = Array.isArray(behaviorMetricsData?.mainPageOptions) ? behaviorMetricsData.mainPageOptions : [];
        pageFilter.innerHTML = ['<option value="all">All main pages</option>']
            .concat(options.map((option) => `<option value="${escapeHtml(option.key)}">${escapeHtml(option.label)}</option>`))
            .join('');
        pageFilter.disabled = options.length === 0;
        if (!options.some((option) => option.key === behaviorSelectedPageKey)) {
            behaviorSelectedPageKey = 'all';
        }
        pageFilter.value = behaviorSelectedPageKey;
        updateBehaviorFilterSummary();
    }

    function applyBehaviorPageFilter() {
        const pageFilter = document.getElementById('behaviorPageFilter');
        if (!pageFilter) return;
        behaviorSelectedPageKey = String(pageFilter.value || 'all');
        updateBehaviorFilterSummary();
        destroyBehaviorCharts();
        renderBehaviorTrendChart(getBehaviorTrendSeries());
    }

    function renderBehaviorTrendChart(series) {
        const canvas = document.getElementById('behaviorTrendChart');
        if (!canvas || typeof Chart === 'undefined' || !Array.isArray(series) || !series.length) return;

        const palette = getChartPalette();
        const labels = series.map((point) => {
            const date = new Date(`${point.date}T00:00:00Z`);
            return Number.isNaN(date.getTime())
                ? point.date
                : date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });
        });

        behaviorTrendChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        type: 'bar',
                        label: 'Page views',
                        data: series.map((point) => Number(point.pageViews || 0)),
                        backgroundColor: withAlpha(palette.accentBlue, 0.38),
                        borderColor: palette.accentBlue,
                        borderWidth: 1,
                        borderRadius: 8,
                        yAxisID: 'y'
                    },
                    {
                        type: 'line',
                        label: 'Active users',
                        data: series.map((point) => Number(point.activeUsers || 0)),
                        borderColor: palette.accentGreen,
                        backgroundColor: withAlpha(palette.accentGreen, 0.12),
                        pointBackgroundColor: palette.accentGreen,
                        pointBorderColor: palette.accentGreen,
                        tension: 0.3,
                        borderWidth: 2,
                        fill: false,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        labels: {
                            color: palette.textPrimary
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: palette.textSecondary },
                        grid: { color: withAlpha(palette.textSecondary, 0.08) }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { color: palette.textSecondary },
                        grid: { color: withAlpha(palette.textSecondary, 0.08) }
                    },
                    y1: {
                        beginAtZero: true,
                        position: 'right',
                        ticks: { color: palette.textSecondary },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });
    }

    function renderBehaviorEventsChart(events) {
        const canvas = document.getElementById('behaviorEventsChart');
        if (!canvas || typeof Chart === 'undefined' || !Array.isArray(events) || !events.length) return;

        const palette = getChartPalette();
        behaviorEventsChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: events.map((entry) => humanizeEventName(entry.eventName)),
                datasets: [{
                    label: 'Events',
                    data: events.map((entry) => Number(entry.eventCount || 0)),
                    backgroundColor: createVerticalGradient(canvas, withAlpha(palette.accentOrange, 0.92), withAlpha(palette.accentPink, 0.72)),
                    borderColor: palette.accentOrange,
                    borderWidth: 1,
                    borderRadius: 12,
                    borderSkipped: false,
                    maxBarThickness: 56
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label(context) {
                                return ` ${formatCount(context.raw)} events`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: { color: palette.textSecondary },
                        grid: { color: withAlpha(palette.textSecondary, 0.08) }
                    },
                    y: {
                        ticks: { color: palette.textPrimary },
                        grid: { display: false }
                    }
                }
            }
        });
    }

    function renderBehaviorTables(topPages, topEvents) {
        const pagesBody = document.getElementById('behaviorTopPagesBody');
        const eventsBody = document.getElementById('behaviorTopEventsBody');
        const pagesEmpty = document.getElementById('behaviorTopPagesEmpty');
        const eventsEmpty = document.getElementById('behaviorTopEventsEmpty');

        if (pagesBody) {
            pagesBody.innerHTML = Array.isArray(topPages) && topPages.length
                ? topPages.map((entry) => `
                    <tr>
                        <td><span class="path">${escapeHtml(entry.path || '/')}</span><span class="meta">${escapeHtml(entry.title || 'Untitled')}</span></td>
                        <td>${escapeHtml(formatCount(entry.pageViews))}</td>
                        <td>${escapeHtml(formatCount(entry.activeUsers))}</td>
                        <td>${escapeHtml(formatSeconds(entry.avgEngagementSeconds))}</td>
                    </tr>`).join('')
                : '';
        }

        if (eventsBody) {
            eventsBody.innerHTML = Array.isArray(topEvents) && topEvents.length
                ? topEvents.map((entry) => `
                    <tr>
                        <td>${escapeHtml(humanizeEventName(entry.eventName))}<span class="meta">${escapeHtml(entry.eventName || '')}</span></td>
                        <td>${escapeHtml(formatCount(entry.eventCount))}</td>
                        <td>${escapeHtml(formatCount(entry.activeUsers))}</td>
                    </tr>`).join('')
                : '';
        }

        if (pagesEmpty) pagesEmpty.style.display = Array.isArray(topPages) && topPages.length ? 'none' : '';
        if (eventsEmpty) eventsEmpty.style.display = Array.isArray(topEvents) && topEvents.length ? 'none' : '';
    }

    async function loadBehaviorMetrics(options = {}) {
        const updatedEl = document.getElementById('behaviorMetricsUpdated');
        const warningEl = document.getElementById('behaviorMetricsWarning');
        const setupEl = document.getElementById('behaviorSetup');
        if (!adminApiClient || !updatedEl || !warningEl || !setupEl) return;

        updatedEl.textContent = 'Loading behaviour analytics...';
        warningEl.style.display = 'none';
        warningEl.textContent = '';
        resetBehaviorView();

        try {
            const params = new URLSearchParams({ days: '30', limit: '8' });
            if (options.force) params.set('refresh', '1');
            const resp = await adminApiClient.fetch(`/api/admin/behavior-metrics?${params.toString()}`);
            const data = await resp.json();
            if (data.errno !== 0) throw new Error(data.error || 'Failed to load behavior metrics');

            const result = data.result || {};
            const warnings = Array.isArray(result.warnings) ? result.warnings : [];

            if (!result.configured) {
                setupEl.style.display = '';
                setupEl.textContent = result.setup?.message || 'Behavior analytics is not configured yet.';
                updatedEl.textContent = 'Behaviour analytics setup required';
                if (warnings.length) {
                    warningEl.style.display = '';
                    warningEl.textContent = warnings.join(' · ');
                }
                return;
            }

            const summary = result.summary || {};
            behaviorMetricsData = result;
            document.getElementById('behaviorActiveUsers').textContent = formatCount(summary.activeUsers);
            document.getElementById('behaviorPageViews').textContent = formatCount(summary.pageViews);
            document.getElementById('behaviorEvents').textContent = formatCount(summary.eventCount);
            document.getElementById('behaviorAvgEngagement').textContent = formatSeconds(summary.avgEngagementSecondsPerUser);

            populateBehaviorPageFilter();
            renderBehaviorTrendChart(getBehaviorTrendSeries());
            renderBehaviorEventsChart(Array.isArray(result.topEvents) ? result.topEvents : []);
            renderBehaviorTables(result.topPages, result.topEvents);

            const updatedAt = result.updatedAt ? new Date(result.updatedAt) : new Date();
            updatedEl.textContent = `Last updated ${updatedAt.toLocaleDateString('en-AU')} ${updatedAt.toLocaleTimeString('en-AU')} · last ${Number(result.window?.days || 30)} days · GA4 property ${result.propertyId}`;
            if (warnings.length) {
                warningEl.style.display = '';
                warningEl.textContent = warnings.join(' · ');
            }
        } catch (e) {
            console.error('[Admin] Failed to load behavior metrics:', e);
            updatedEl.textContent = 'Unable to load behaviour analytics';
            warningEl.style.display = '';
            warningEl.textContent = e.message || String(e);
            showMessage('warning', `⚠️ Failed to load behaviour analytics: ${e.message}`);
        }
    }

    function createDefaultAnnouncementConfig() {
        return {
            enabled: false,
            id: '',
            title: '',
            body: '',
            severity: 'info',
            showOnce: true,
            audience: {
                requireTourComplete: true,
                requireSetupComplete: true,
                requireAutomationEnabled: false,
                minAccountAgeDays: null,
                onlyIncludeUids: [],
                includeUids: [],
                excludeUids: []
            },
            updatedAt: null,
            updatedByUid: null,
            updatedByEmail: null
        };
    }

    function normalizeAnnouncementSeverity(value) {
        const normalized = String(value || '').trim().toLowerCase();
        return ['info', 'success', 'warning', 'danger'].includes(normalized) ? normalized : 'info';
    }

    const SEVERITY_COLORS = { info: '#388bfd', success: '#7ee787', warning: '#d29922', danger: '#f85149' };

    function updateSeverityDot() {
        const sel = document.getElementById('announcementSeveritySelect');
        const dot = document.getElementById('announcementSeverityDot');
        if (!sel || !dot) return;
        dot.style.background = SEVERITY_COLORS[normalizeAnnouncementSeverity(sel.value)] || '#388bfd';
    }

    function normalizeAnnouncementId(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, '-')
            .replace(/-{2,}/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80);
    }

    function parseAnnouncementUidList(value) {
        const items = String(value || '')
            .split(/[\n,]+/)
            .map((item) => item.trim())
            .filter(Boolean);
        return Array.from(new Set(items)).slice(0, 200);
    }

    function formatAnnouncementUidList(value) {
        return Array.isArray(value) && value.length ? value.join('\n') : '';
    }

    function getAnnouncementElements() {
        return {
            updated: document.getElementById('announcementUpdated'),
            warning: document.getElementById('announcementWarning'),
            refreshBtn: document.getElementById('refreshAnnouncementBtn'),
            saveBtn: document.getElementById('saveAnnouncementBtn'),
            disableBtn: document.getElementById('disableAnnouncementBtn'),
            idInput: document.getElementById('announcementIdInput'),
            severitySelect: document.getElementById('announcementSeveritySelect'),
            titleInput: document.getElementById('announcementTitleInput'),
            bodyInput: document.getElementById('announcementBodyInput'),
            enabledInput: document.getElementById('announcementEnabledInput'),
            showOnceInput: document.getElementById('announcementShowOnceInput'),
            requireTourInput: document.getElementById('announcementRequireTourInput'),
            requireSetupInput: document.getElementById('announcementRequireSetupInput'),
            requireAutomationInput: document.getElementById('announcementRequireAutomationInput'),
            minAccountAgeInput: document.getElementById('announcementMinAccountAgeInput'),
            onlyIncludeUidsInput: document.getElementById('announcementOnlyIncludeUidsInput'),
            includeUidsInput: document.getElementById('announcementIncludeUidsInput'),
            excludeUidsInput: document.getElementById('announcementExcludeUidsInput'),
            preview: document.getElementById('announcementPreview'),
            previewTitle: document.getElementById('announcementPreviewTitle'),
            previewBody: document.getElementById('announcementPreviewBody'),
            previewMeta: document.getElementById('announcementPreviewMeta'),
            audienceSummary: document.getElementById('announcementAudienceSummary')
        };
    }

    function bindAnnouncementEditorHandlers() {
        if (announcementEditorBound) return;
        announcementEditorBound = true;

        const els = getAnnouncementElements();
        const previewHandler = () => {
            renderAnnouncementPreview(collectAdminAnnouncementForm());
        };

        [
            els.idInput,
            els.severitySelect,
            els.titleInput,
            els.bodyInput,
            els.enabledInput,
            els.showOnceInput,
            els.requireTourInput,
            els.requireSetupInput,
            els.requireAutomationInput,
            els.minAccountAgeInput,
            els.onlyIncludeUidsInput,
            els.includeUidsInput,
            els.excludeUidsInput
        ].forEach((el) => {
            if (!el || typeof el.addEventListener !== 'function') return;
            el.addEventListener('input', previewHandler);
            el.addEventListener('change', previewHandler);
        });
    }

    function setAnnouncementEditorBusy(isBusy) {
        const els = getAnnouncementElements();
        if (els.refreshBtn) els.refreshBtn.disabled = isBusy;
        if (els.saveBtn) els.saveBtn.disabled = isBusy;
        if (els.disableBtn) els.disableBtn.disabled = isBusy;
    }

    function setAnnouncementEditorWarning(message = '') {
        const { warning } = getAnnouncementElements();
        if (!warning) return;
        if (!message) {
            warning.style.display = 'none';
            warning.textContent = '';
            return;
        }
        warning.style.display = '';
        warning.textContent = message;
    }

    function buildAudienceSummaryLines(announcement) {
        const audience = announcement && announcement.audience ? announcement.audience : {};
        const filters = [];
        if (audience.requireTourComplete) filters.push('Tour complete only');
        if (audience.requireSetupComplete) filters.push('Setup-complete users only');
        if (audience.requireAutomationEnabled) filters.push('Automation-enabled users only');
        if (Number(audience.minAccountAgeDays || 0) > 0) filters.push(`Account age >= ${Number(audience.minAccountAgeDays)} days`);
        if (!filters.length) filters.push('No automatic maturity filters');

        const onlyIncludeSummary = Array.isArray(audience.onlyIncludeUids) && audience.onlyIncludeUids.length
            ? `Only include allowlist: ${audience.onlyIncludeUids.length} user${audience.onlyIncludeUids.length === 1 ? '' : 's'}`
            : 'Only include allowlist: none';
        const includeSummary = Array.isArray(audience.includeUids) && audience.includeUids.length
            ? `Always include override: ${audience.includeUids.length} user${audience.includeUids.length === 1 ? '' : 's'}`
            : 'Always include override: none';
        const excludeSummary = Array.isArray(audience.excludeUids) && audience.excludeUids.length
            ? `Always exclude override: ${audience.excludeUids.length} user${audience.excludeUids.length === 1 ? '' : 's'}`
            : 'Always exclude override: none';

        return [filters.join(' · '), onlyIncludeSummary, includeSummary, excludeSummary];
    }

    function renderAnnouncementPreview(announcement) {
        const els = getAnnouncementElements();
        if (!els.preview || !els.previewTitle || !els.previewBody || !els.previewMeta || !els.audienceSummary) return;

        const hasCopy = !!(announcement.title || announcement.body);
        els.preview.className = `announcement-preview ${normalizeAnnouncementSeverity(announcement.severity)}${hasCopy ? ' active' : ''}`;
        els.previewTitle.textContent = announcement.title || 'Announcement preview';
        els.previewBody.textContent = announcement.body || 'No announcement body set yet.';
        updateSeverityDot();

        const chips = [];
        chips.push(`<span class="announcement-chip">${announcement.enabled ? 'Enabled' : 'Disabled'}</span>`);
        chips.push(`<span class="announcement-chip">${announcement.showOnce ? 'Show once' : 'Repeatable'}</span>`);
        chips.push(`<span class="announcement-chip">${escapeHtml(normalizeAnnouncementSeverity(announcement.severity))}</span>`);
        if (announcement.id) {
            chips.push(`<span class="announcement-chip">ID: ${escapeHtml(announcement.id)}</span>`);
        }
        els.previewMeta.innerHTML = chips.join('');
        els.audienceSummary.innerHTML = buildAudienceSummaryLines(announcement)
            .map((line) => `<div>${escapeHtml(line)}</div>`)
            .join('');
    }

    function renderAdminAnnouncement(announcement) {
        const els = getAnnouncementElements();
        if (!els.updated) return;

        const next = {
            ...createDefaultAnnouncementConfig(),
            ...(announcement || {}),
            audience: {
                ...createDefaultAnnouncementConfig().audience,
                ...((announcement && announcement.audience) || {})
            }
        };
        currentAdminAnnouncement = next;

        if (els.idInput) els.idInput.value = next.id || '';
        if (els.severitySelect) els.severitySelect.value = normalizeAnnouncementSeverity(next.severity);
        updateSeverityDot();
        if (els.titleInput) els.titleInput.value = next.title || '';
        if (els.bodyInput) els.bodyInput.value = next.body || '';
        if (els.enabledInput) els.enabledInput.checked = next.enabled === true;
        if (els.showOnceInput) els.showOnceInput.checked = next.showOnce !== false;
        if (els.requireTourInput) els.requireTourInput.checked = next.audience.requireTourComplete !== false;
        if (els.requireSetupInput) els.requireSetupInput.checked = next.audience.requireSetupComplete !== false;
        if (els.requireAutomationInput) els.requireAutomationInput.checked = next.audience.requireAutomationEnabled === true;
        if (els.minAccountAgeInput) els.minAccountAgeInput.value = Number(next.audience.minAccountAgeDays || 0) > 0 ? String(next.audience.minAccountAgeDays) : '';
        if (els.onlyIncludeUidsInput) els.onlyIncludeUidsInput.value = formatAnnouncementUidList(next.audience.onlyIncludeUids);
        if (els.includeUidsInput) els.includeUidsInput.value = formatAnnouncementUidList(next.audience.includeUids);
        if (els.excludeUidsInput) els.excludeUidsInput.value = formatAnnouncementUidList(next.audience.excludeUids);

        const updatedAtText = next.updatedAt ? formatDate(next.updatedAt) : 'Never saved';
        const updatedByText = next.updatedByEmail || next.updatedByUid || 'unknown admin';
        els.updated.textContent = next.updatedAt
            ? `Last updated ${updatedAtText} by ${updatedByText}`
            : 'Announcement has not been saved yet.';

        setAnnouncementEditorWarning('');
        renderAnnouncementPreview(next);
    }

    function collectAdminAnnouncementForm() {
        const els = getAnnouncementElements();
        const minAccountAgeRaw = Number(els.minAccountAgeInput?.value || 0);
        const minAccountAgeDays = Number.isFinite(minAccountAgeRaw) && minAccountAgeRaw > 0
            ? Math.min(3650, Math.round(minAccountAgeRaw))
            : null;

        return {
            enabled: els.enabledInput?.checked === true,
            id: normalizeAnnouncementId(els.idInput?.value || ''),
            title: String(els.titleInput?.value || '').trim().slice(0, 160),
            body: String(els.bodyInput?.value || '').replace(/\r\n/g, '\n').trim().slice(0, 4000),
            severity: normalizeAnnouncementSeverity(els.severitySelect?.value || 'info'),
            showOnce: els.showOnceInput?.checked !== false,
            audience: {
                requireTourComplete: els.requireTourInput?.checked !== false,
                requireSetupComplete: els.requireSetupInput?.checked !== false,
                requireAutomationEnabled: els.requireAutomationInput?.checked === true,
                minAccountAgeDays,
                onlyIncludeUids: parseAnnouncementUidList(els.onlyIncludeUidsInput?.value || ''),
                includeUids: parseAnnouncementUidList(els.includeUidsInput?.value || ''),
                excludeUids: parseAnnouncementUidList(els.excludeUidsInput?.value || '')
            }
        };
    }

    function validateAdminAnnouncement(announcement) {
        if (announcement.enabled && !announcement.title && !announcement.body) {
            return 'Enabled announcements need a title or body.';
        }
        if (announcement.enabled && announcement.showOnce && !announcement.id) {
            return 'Show-once announcements require an ID.';
        }
        return null;
    }

    async function persistAdminAnnouncement(payload, options = {}) {
        const els = getAnnouncementElements();
        const validationError = validateAdminAnnouncement(payload);
        renderAnnouncementPreview(payload);
        if (validationError) {
            setAnnouncementEditorWarning(validationError);
            return false;
        }

        setAnnouncementEditorBusy(true);
        setAnnouncementEditorWarning('');

        try {
            const resp = await adminApiClient.fetch('/api/admin/announcement', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ announcement: payload })
            });
            const data = await resp.json();
            if (!resp.ok || data.errno !== 0) {
                throw new Error(data.error || `Save failed (${resp.status})`);
            }
            renderAdminAnnouncement(data.result?.announcement || payload);
            showMessage('success', options.successMessage || 'Announcement settings saved.');
            return true;
        } catch (error) {
            const message = error?.message || String(error);
            setAnnouncementEditorWarning(message);
            if (els.updated) els.updated.textContent = 'Failed to save announcement settings';
            showMessage('error', `Failed to save announcement settings: ${message}`);
            return false;
        } finally {
            setAnnouncementEditorBusy(false);
        }
    }

    async function loadAdminAnnouncement(options = {}) {
        const els = getAnnouncementElements();
        if (!adminApiClient || !els.updated) return;

        setAnnouncementEditorBusy(true);
        setAnnouncementEditorWarning('');
        els.updated.textContent = options.force ? 'Refreshing announcement settings...' : 'Loading announcement settings...';

        try {
            const resp = await adminApiClient.fetch('/api/admin/announcement');
            const data = await resp.json();
            if (!resp.ok || data.errno !== 0) {
                throw new Error(data.error || `Request failed (${resp.status})`);
            }
            renderAdminAnnouncement(data.result?.announcement || createDefaultAnnouncementConfig());
        } catch (error) {
            const message = error?.message || String(error);
            renderAdminAnnouncement(currentAdminAnnouncement || createDefaultAnnouncementConfig());
            els.updated.textContent = 'Unable to load announcement settings';
            setAnnouncementEditorWarning(message);
            showMessage('warning', `Failed to load announcement settings: ${message}`);
        } finally {
            setAnnouncementEditorBusy(false);
        }
    }

    async function saveAdminAnnouncement() {
        if (!adminApiClient) return;
        const payload = collectAdminAnnouncementForm();
        await persistAdminAnnouncement(payload, { successMessage: 'Announcement settings saved.' });
    }

    async function disableAdminAnnouncement() {
        if (!adminApiClient) return;
        const payload = collectAdminAnnouncementForm();
        payload.enabled = false;
        await persistAdminAnnouncement(payload, { successMessage: 'Announcement disabled.' });
    }

    // ==================== Render Users Table ====================
    function renderUsersTable(users) {
        const tableWrapper = document.getElementById('usersTableWrapper');
        const table = tableWrapper.querySelector('table.users-table');
        const thead = table.querySelector('thead');
        const tbody = document.getElementById('usersTableBody');

        thead.innerHTML = `
            <tr>
                <th class="sortable" onclick="sortBy('email')">User <span class="sort-indicator">${sortIcon('email')}</span></th>
                <th class="sortable" onclick="sortBy('role')">Role <span class="sort-indicator">${sortIcon('role')}</span></th>
                <th class="sortable" onclick="sortBy('configured')">Configured <span class="sort-indicator">${sortIcon('configured')}</span></th>
                <th class="sortable" onclick="sortBy('automationEnabled')">Automation <span class="sort-indicator">${sortIcon('automationEnabled')}</span></th>
                <th class="sortable" onclick="sortBy('joinedAt')">Joined <span class="sort-indicator">${sortIcon('joinedAt')}</span></th>
                <th class="sortable" onclick="sortBy('lastSignedInAt')">Last Signed In <span class="sort-indicator">${sortIcon('lastSignedInAt')}</span></th>
                <th class="sortable" onclick="sortBy('rulesCount')">Rules <span class="sort-indicator">${sortIcon('rulesCount')}</span></th>
                <th class="sortable" onclick="sortBy('actions')">Actions <span class="sort-indicator">${sortIcon('actions')}</span></th>
            </tr>
        `;

        if (!users.length) {
            const emptyLabel = countActiveUsersFilters() > 0
                ? 'No loaded users match the current filters'
                : 'No users found';
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color: var(--text-secondary); padding: 30px;">${emptyLabel}</td></tr>`;
            return;
        }

        const sorted = sortUsers(users);

        tbody.innerHTML = sorted.map(u => {
            const roleBadge = u.role === 'admin'
                ? '<span class="role-badge admin">🛡️ Admin</span>'
                : '<span class="role-badge user">👤 User</span>';

            const configured = isUserConfigured(u);
            const automationStatus = u.automationEnabled
                ? '<span class="status-dot active"></span>Active'
                : '<span class="status-dot inactive"></span>Inactive';
            const configuredStatus = configured
                ? '<span class="config-status yes" title="Configured">&#10003;</span>'
                : '<span class="config-status no" title="Not configured">&#10007;</span>';

            const roleAction = u.role === 'admin'
                ? `<button class="action-btn danger" onclick="setRole('${u.uid}', 'user')" title="Demote to user">Demote</button>`
                : `<button class="action-btn success" onclick="setRole('${u.uid}', 'admin')" title="Promote to admin">Promote</button>`;

            return `<tr>
                <td class="email-cell" title="${u.email}">${u.email || '<em>No email</em>'}</td>
                <td>${roleBadge}</td>
                <td>${configuredStatus}</td>
                <td>${automationStatus}</td>
                <td>${formatDate(u.joinedAt || u.createdAt)}</td>
                <td>${formatDate(u.lastSignedInAt)}</td>
                <td>${Number(u.rulesCount || 0)}</td>
                <td>
                    <div class="actions-cell">
                        <button class="action-btn" onclick="viewStats('${u.uid}', '${(u.email || '').replace(/'/g, '')}')">📊 Stats</button>
                        <button class="action-btn" onclick="impersonateUser('${u.uid}', '${(u.email || '').replace(/'/g, '')}')">👁️ View As</button>
                        ${roleAction}
                        <button class="action-btn danger" onclick="deleteUserByAdmin('${u.uid}', '${(u.email || '').replace(/'/g, '')}')">Delete</button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    async function deleteUserByAdmin(uid, email) {
        const label = email || uid;
        const first = confirm(`Delete user "${label}" and all Firestore/Auth data permanently?`);
        if (!first) return;
        const confirmText = window.prompt('Type DELETE to confirm user deletion:');
        if (confirmText !== 'DELETE') {
            showMessage('warning', 'Deletion cancelled (confirmation text did not match)');
            return;
        }

        try {
            const resp = await adminApiClient.fetch(`/api/admin/users/${uid}/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirmText: 'DELETE' })
            });
            const data = await resp.json().catch(() => null);
            if (!resp.ok || !data || data.errno !== 0) {
                throw new Error(data && data.error ? data.error : `Delete failed (${resp.status})`);
            }
            showMessage('success', `✅ Deleted user ${label}`);
            refreshAdminData();
        } catch (e) {
            showMessage('error', `❌ Failed to delete user: ${e.message || e}`);
        }
    }

    function formatCompactNumber(n) {
        const num = Number(n || 0);
        if (Math.abs(num) >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
        if (Math.abs(num) >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
        return String(Math.round(num));
    }

    function formatMetricWarning(text) {
        const raw = String(text || '').trim();
        if (!raw) return '';
        const short = raw.replace(/\s*If a metric was created recently[\s\S]*$/i, '').trim();
        return short.length > 160 ? `${short.slice(0, 157)}...` : short;
    }

    function renderFirestoreMetricsChart(trend) {
        const canvas = document.getElementById('firestoreMetricsChart');
        if (!canvas || typeof Chart === 'undefined') return;

        const sorted = Array.isArray(trend) ? trend.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)) : [];
        const labels = sorted.map((point) => {
            const d = new Date(point.timestamp);
            return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
        });

        const reads = sorted.map((point) => Number(point.reads || 0));
        const writes = sorted.map((point) => Number(point.writes || 0));
        const deletes = sorted.map((point) => Number(point.deletes || 0));

        if (firestoreMetricsChart) {
            firestoreMetricsChart.destroy();
            firestoreMetricsChart = null;
        }

        firestoreMetricsChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Reads',
                        data: reads,
                        borderColor: 'rgba(88, 166, 255, 0.95)',
                        backgroundColor: 'rgba(88, 166, 255, 0.12)',
                        borderWidth: 1.8,
                        pointRadius: 0,
                        tension: 0.2
                    },
                    {
                        label: 'Writes',
                        data: writes,
                        borderColor: 'rgba(126, 231, 135, 0.95)',
                        backgroundColor: 'rgba(126, 231, 135, 0.12)',
                        borderWidth: 1.8,
                        pointRadius: 0,
                        tension: 0.2
                    },
                    {
                        label: 'Deletes',
                        data: deletes,
                        borderColor: 'rgba(240, 136, 62, 0.95)',
                        backgroundColor: 'rgba(240, 136, 62, 0.12)',
                        borderWidth: 1.8,
                        pointRadius: 0,
                        tension: 0.2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        labels: {
                            color: cssVar('--text-secondary'),
                            boxWidth: 12,
                            usePointStyle: true,
                            pointStyle: 'circle'
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: cssVar('--text-secondary'), maxTicksLimit: 10 },
                        grid: { color: cssVar('--border-secondary') }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { color: cssVar('--text-secondary'), precision: 0 },
                        grid: { color: cssVar('--border-secondary') }
                    }
                }
            }
        });
    }

    async function loadFirestoreCostMetrics() {
        const updatedEl = document.getElementById('firestoreMetricsUpdated');
        const warningEl = document.getElementById('firestoreMetricsWarning');
        const refreshBtn = document.getElementById('refreshFirestoreBtn');
        if (!adminApiClient || !updatedEl || !warningEl) return;

        if (refreshBtn) refreshBtn.disabled = true;
        updatedEl.textContent = 'Loading usage from GCP Monitoring...';
        warningEl.style.display = 'none';
        warningEl.textContent = '';

        try {
            const resp = await adminApiClient.fetch('/api/admin/firestore-metrics?hours=36');
            const data = await resp.json();
            if (data.errno !== 0) throw new Error(data.error || 'Failed to load Firestore metrics');

            const firestore = data.result?.firestore || {};
            const billing = data.result?.billing || {};
            const cache = data.result?.cache || {};
            const quota = firestore.quota || {};
            const trend = Array.isArray(data.result?.trend) ? data.result.trend : [];
            const warnings = Array.isArray(data.result?.warnings) ? data.result.warnings : [];

            const docOpsEstimatedCostUsd = firestore.estimatedDocOpsCostUsd;
            const docOpsBreakdown = Array.isArray(firestore.estimatedDocOpsBreakdown) ? firestore.estimatedDocOpsBreakdown : [];
            const hasDocOpsEstimatedCost = docOpsEstimatedCostUsd !== null && docOpsEstimatedCostUsd !== undefined && Number.isFinite(Number(docOpsEstimatedCostUsd));
            const hasStorage = firestore.storageGb !== null && firestore.storageGb !== undefined && Number.isFinite(Number(firestore.storageGb));
            const projectMtdCostUsd = (billing.projectMtdCostUsd !== undefined) ? billing.projectMtdCostUsd : billing.estimatedMtdCostUsd;
            const projectServices = Array.isArray(billing.projectServices) ? billing.projectServices : billing.services;
            const projectCostIsEstimate = (billing.projectCostIsEstimate !== undefined) ? (billing.projectCostIsEstimate === true) : (billing.isEstimate === true);
            const projectCostSourceRaw = (billing.projectCostSource !== undefined) ? billing.projectCostSource : billing.costSource;
            const projectCostSource = String(projectCostSourceRaw || '').toLowerCase();
            const hasProjectCost = projectMtdCostUsd !== null && projectMtdCostUsd !== undefined && Number.isFinite(Number(projectMtdCostUsd));
            const shouldFallbackToDocOps = !hasProjectCost && hasDocOpsEstimatedCost;
            const effectiveProjectCostUsd = hasProjectCost
                ? Number(projectMtdCostUsd)
                : (shouldFallbackToDocOps ? Number(docOpsEstimatedCostUsd) : null);
            const effectiveProjectCostSource = hasProjectCost
                ? projectCostSource
                : (shouldFallbackToDocOps ? 'firestore-doc-ops-estimate' : projectCostSource);
            const hasEffectiveProjectCost = Number.isFinite(effectiveProjectCostUsd);
            const isDocOpsOnlyProjectCost = effectiveProjectCostSource === 'firestore-doc-ops-estimate';
            const projectCostApproximate = projectCostIsEstimate || shouldFallbackToDocOps || isDocOpsOnlyProjectCost;

            document.getElementById('firestoreReadsMtd').textContent = formatCompactNumber(firestore.readsMtd || 0);
            document.getElementById('firestoreWritesMtd').textContent = formatCompactNumber(firestore.writesMtd || 0);
            document.getElementById('firestoreDeletesMtd').textContent = formatCompactNumber(firestore.deletesMtd || 0);
            const storageEl = document.getElementById('firestoreStorageGb');
            if (storageEl) {
                storageEl.textContent = hasStorage
                    ? Number(firestore.storageGb).toFixed(3)
                    : 'Unavailable';
                storageEl.title = hasStorage
                    ? 'Approximate Firestore storage from Cloud Monitoring.'
                    : 'Firestore storage metric unavailable for this project/region.';
            }
            const projectCostEl = document.getElementById('firestoreProjectMtdCost');
            const projectBreakdownEl = document.getElementById('firestoreProjectServiceBreakdown');
            if (projectCostEl) {
                if (hasEffectiveProjectCost) {
                    const prefix = projectCostApproximate ? '~' : '';
                    const suffix = isDocOpsOnlyProjectCost ? '*' : '';
                    projectCostEl.textContent = `${prefix}$${Number(effectiveProjectCostUsd).toFixed(2)}${suffix}`;
                    projectCostEl.title = isDocOpsOnlyProjectCost
                        ? 'Firestore doc-op-only estimate (reads/writes/deletes). Excludes storage, egress, Functions, and other services.'
                        : (projectCostApproximate
                            ? 'Estimated/derived project-level MTD cost (Cloud Monitoring fallback may be delayed and approximate).'
                            : 'Project-level MTD cost from Cloud Billing API.');
                } else {
                    projectCostEl.textContent = 'Unavailable';
                    projectCostEl.title = 'Project-level billing metrics unavailable for this project.';
                }
            }

            if (projectBreakdownEl) {
                if (isDocOpsOnlyProjectCost && hasEffectiveProjectCost) {
                    projectBreakdownEl.textContent = '* Firestore doc-op estimate only (reads/writes/deletes).';
                    projectBreakdownEl.style.display = '';
                } else if (hasEffectiveProjectCost && Array.isArray(projectServices) && projectServices.length > 0) {
                    const parts = projectServices
                        .sort((a, b) => b.costUsd - a.costUsd)
                        .map((entry) => {
                            const label = String(entry.service || '')
                                .replace('Cloud Firestore', 'Firestore')
                                .replace('Cloud Functions', 'Functions')
                                .replace(/^Cloud /, '');
                            return `${label}: $${Number(entry.costUsd || 0).toFixed(2)}`;
                        });
                    projectBreakdownEl.textContent = parts.join(' · ');
                    projectBreakdownEl.style.display = '';
                } else {
                    projectBreakdownEl.textContent = '';
                    projectBreakdownEl.style.display = 'none';
                }
            }

            const docOpsCostEl = document.getElementById('firestoreDocOpsCost');
            const docOpsBreakdownEl = document.getElementById('firestoreDocOpsBreakdown');
            const docOpsTileEl = docOpsCostEl ? docOpsCostEl.closest('.firestore-kpi') : null;
            if (docOpsTileEl) {
                docOpsTileEl.style.display = isDocOpsOnlyProjectCost ? 'none' : '';
            }
            if (docOpsCostEl) {
                if (hasDocOpsEstimatedCost) {
                    docOpsCostEl.textContent = `~$${Number(docOpsEstimatedCostUsd).toFixed(2)}`;
                    docOpsCostEl.title = 'Firestore read/write/delete estimate only. Excludes storage, egress, Functions, and other services.';
                } else {
                    docOpsCostEl.textContent = 'Unavailable';
                    docOpsCostEl.title = 'Firestore doc-op estimate unavailable.';
                }
            }

            if (docOpsBreakdownEl) {
                if (hasDocOpsEstimatedCost && docOpsBreakdown.length > 0) {
                    const parts = docOpsBreakdown
                        .sort((a, b) => b.costUsd - a.costUsd)
                        .map((entry) => {
                            const label = String(entry.service || '')
                                .replace('Cloud Firestore', 'Firestore')
                                .replace(/^Firestore /, '');
                            return `${label}: $${Number(entry.costUsd || 0).toFixed(2)}`;
                        });
                    docOpsBreakdownEl.textContent = parts.join(' · ');
                    docOpsBreakdownEl.style.display = '';
                } else {
                    docOpsBreakdownEl.textContent = '';
                    docOpsBreakdownEl.style.display = 'none';
                }
            }

            const cacheTotals = cache && typeof cache === 'object' ? (cache.totals || {}) : {};
            const cacheSources = Array.isArray(cache.sources) ? cache.sources : [];
            const cacheHitRateEl = document.getElementById('cacheOverallHitRate');
            const cacheTopMissSourceEl = document.getElementById('cacheTopMissSource');
            const cacheHitRatePct = Number(cacheTotals.hitRatePct);
            const topMissSource = cacheSources
                .filter((entry) => Number(entry?.reads || 0) > 0)
                .sort((a, b) => Number(b?.misses || 0) - Number(a?.misses || 0) || Number(a?.hitRatePct || 0) - Number(b?.hitRatePct || 0))[0] || null;

            if (cacheHitRateEl) {
                cacheHitRateEl.textContent = Number.isFinite(cacheHitRatePct)
                    ? formatPercentage(cacheHitRatePct, 1)
                    : 'No samples';
                cacheHitRateEl.title = Number(cacheTotals.reads || 0) > 0
                    ? `${formatCompactNumber(cacheTotals.hits || 0)} hits across ${formatCompactNumber(cacheTotals.reads || 0)} cache-backed reads since process start.`
                    : 'No cache-backed reads recorded since process start.';
            }
            if (cacheTopMissSourceEl) {
                cacheTopMissSourceEl.textContent = topMissSource
                    ? `${topMissSource.source}: ${formatCompactNumber(topMissSource.misses || 0)} misses`
                    : 'No cache misses recorded';
            }

            const quotaStatusEl = document.getElementById('firestoreQuotaStatus');
            const quotaSummaryEl = document.getElementById('firestoreQuotaSummary');
            const quotaMetrics = Array.isArray(quota.metrics) ? quota.metrics : [];
            const busiestQuotaMetric = quotaMetrics
                .slice()
                .sort((a, b) => Number(b?.last24HoursUtilizationPct || 0) - Number(a?.last24HoursUtilizationPct || 0))[0] || null;

            if (quotaStatusEl) {
                const quotaStatus = String(quota.overallStatus || 'healthy').toUpperCase();
                quotaStatusEl.textContent = quotaStatus;
                quotaStatusEl.title = busiestQuotaMetric
                    ? `${busiestQuotaMetric.label} last-24h utilization: ${formatPercentage(busiestQuotaMetric.last24HoursUtilizationPct, 1)}`
                    : 'No quota utilization samples available';
            }
            if (quotaSummaryEl) {
                quotaSummaryEl.textContent = busiestQuotaMetric
                    ? `${busiestQuotaMetric.label}: ${formatCompactNumber(busiestQuotaMetric.last24Hours || 0)} last 24h / ${formatCompactNumber(busiestQuotaMetric.dailyFreeTier || 0)} free tier`
                    : 'No recent Firestore quota usage samples';
            }

            const updatedAt = data.result?.updatedAt ? new Date(data.result.updatedAt) : new Date();
            const expectedUnavailablePattern = /unavailable for this project\/region|not available for this project\/billing setup/i;
            const billingIamPattern = /BILLING_IAM:/i;
            const formattedWarnings = warnings.map(formatMetricWarning).filter(Boolean);
            const iamWarnings = formattedWarnings.filter((w) => billingIamPattern.test(w));
            const actionableWarnings = formattedWarnings.filter((w) => !expectedUnavailablePattern.test(w) && !billingIamPattern.test(w));
            const suppressedCount = formattedWarnings.length - actionableWarnings.length - iamWarnings.length;

            const partialSuffix = suppressedCount > 0 ? ' · partial data' : '';
            updatedEl.textContent = `Last updated ${updatedAt.toLocaleDateString('en-AU')} ${updatedAt.toLocaleTimeString('en-AU')} · data source: ${data.result?.source || 'gcp-monitoring'}${partialSuffix}`;

            const allShownWarnings = [
                ...iamWarnings.map(w => '⚠️ IAM setup needed: ' + w.replace('BILLING_IAM: ', '')),
                ...actionableWarnings
            ];
            if (allShownWarnings.length) {
                warningEl.style.display = '';
                warningEl.textContent = allShownWarnings.join(' · ');
            }

            renderFirestoreMetricsChart(trend);
        } catch (e) {
            updatedEl.textContent = 'Unable to load Firestore usage from GCP Monitoring';
            warningEl.style.display = '';
            warningEl.textContent = e.message || String(e);
            showMessage('warning', `⚠️ Firestore metrics unavailable: ${e.message || e}`);
        } finally {
            if (refreshBtn) refreshBtn.disabled = false;
        }
    }

    function formatDurationMs(durationMs) {
        const ms = Number(durationMs || 0);
        if (!Number.isFinite(ms) || ms <= 0) return '0ms';
        if (ms < 1000) return `${Math.round(ms)}ms`;
        const seconds = ms / 1000;
        if (seconds < 60) return `${seconds.toFixed(1)}s`;
        const minutes = Math.floor(seconds / 60);
        const remSeconds = Math.round(seconds % 60);
        return `${minutes}m ${remSeconds}s`;
    }

    function formatPercentage(value, digits = 1) {
        const num = Number(value);
        if (!Number.isFinite(num)) return '-';
        return `${num.toFixed(digits)}%`;
    }

    function parseDateValue(value) {
        if (!value) return null;
        if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
            const date = new Date(`${value}T00:00:00Z`);
            return Number.isNaN(date.getTime()) ? null : date;
        }
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function formatDateShort(value) {
        const date = parseDateValue(value);
        if (!date) return '-';
        return date.toLocaleDateString('en-AU', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
    }

    function formatRelativeTime(value) {
        const date = parseDateValue(value);
        if (!date) return '-';
        const diffMs = Date.now() - date.getTime();
        if (!Number.isFinite(diffMs)) return '-';
        const absMs = Math.abs(diffMs);
        const suffix = diffMs >= 0 ? 'ago' : 'ahead';
        if (absMs < 60000) return 'just now';
        if (absMs < 3600000) return `${Math.round(absMs / 60000)}m ${suffix}`;
        if (absMs < 86400000) return `${Math.round(absMs / 3600000)}h ${suffix}`;
        return `${Math.round(absMs / 86400000)}d ${suffix}`;
    }

    function formatDayAge(value) {
        const num = Number(value);
        if (!Number.isFinite(num)) return '-';
        if (num <= 0) return 'today';
        if (num === 1) return '1 day';
        return `${num} days`;
    }

    function formatStatusLabel(value) {
        const text = String(value || '').trim();
        if (!text) return '-';
        return text
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/\b\w/g, (char) => char.toUpperCase());
    }

    function utcMidnight(value) {
        const date = parseDateValue(value);
        if (!date) return null;
        return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    }

    function diffUtcDays(left, right) {
        const leftDate = utcMidnight(left);
        const rightDate = utcMidnight(right);
        if (!leftDate || !rightDate) return null;
        return Math.round((leftDate.getTime() - rightDate.getTime()) / 86400000);
    }

    function computeCurrentUtcDayAge(value) {
        const latestDate = parseDateValue(value);
        if (!latestDate) return null;
        return diffUtcDays(new Date(), latestDate);
    }

    function buildLiveDataworksStatus({ dataAgeDays, issuePeriods, recentMinimumCoveragePct, recentAverageQualityScore, fallbackStatus }) {
        const reasons = [];
        let level = 'good';
        let label = 'Healthy';

        if (Number.isFinite(dataAgeDays) && dataAgeDays > 1) {
            level = dataAgeDays > 3 ? 'bad' : 'warn';
            label = dataAgeDays > 3 ? 'Stale' : 'Lagging';
            reasons.push(`latest market date is ${dataAgeDays} day${dataAgeDays === 1 ? '' : 's'} behind UTC`);
        }

        if (Number.isFinite(recentMinimumCoveragePct) && recentMinimumCoveragePct < 99.5) {
            if (level === 'good') {
                level = 'warn';
                label = 'Watch';
            }
            reasons.push(`recent minimum coverage dipped to ${recentMinimumCoveragePct.toFixed(2)}%`);
        }

        if (Number.isFinite(recentAverageQualityScore) && recentAverageQualityScore < 99) {
            if (level !== 'bad') {
                level = recentAverageQualityScore < 97 ? 'bad' : 'warn';
                label = recentAverageQualityScore < 97 ? 'Degraded' : 'Watch';
            }
            reasons.push(`recent average quality score is ${recentAverageQualityScore.toFixed(2)}`);
        }

        if (Number(issuePeriods || 0) > 0) {
            if (level === 'good') {
                level = 'warn';
                label = 'Watch';
            }
            reasons.push(`${issuePeriods} quality-report period${issuePeriods === 1 ? '' : 's'} flagged`);
        }

        if (reasons.length) {
            return { level, label, reasons };
        }

        return fallbackStatus && typeof fallbackStatus === 'object'
            ? {
                level: fallbackStatus.level || level,
                label: fallbackStatus.label || label,
                reasons: Array.isArray(fallbackStatus.reasons) ? fallbackStatus.reasons : reasons
            }
            : { level, label, reasons };
    }

    function dataworksTone(level) {
        const normalized = String(level || '').toLowerCase();
        if (normalized === 'healthy' || normalized === 'good' || normalized === 'ok' || normalized === 'fresh') return 'good';
        if (normalized === 'watch' || normalized === 'warn' || normalized === 'lagging' || normalized === 'degraded') return 'warn';
        if (normalized === 'breach' || normalized === 'bad' || normalized === 'stale' || normalized === 'error') return 'bad';
        return 'neutral';
    }

    function statusSeverity(level) {
        const tone = dataworksTone(level);
        if (tone === 'bad') return 2;
        if (tone === 'warn') return 1;
        return 0;
    }

    function summarizeReleaseGuard(releaseAlignment) {
        if (releaseAlignment?.matches === true) {
            return { label: 'Aligned', level: 'good', reason: null };
        }
        if (releaseAlignment?.status === 'mismatch') {
            return { label: 'Needs deploy', level: 'warn', reason: releaseAlignment.reason || 'Historical publish is blocked until the live release is deployed.' };
        }
        if (releaseAlignment?.status === 'target-unresolved') {
            return { label: 'Blocked', level: 'warn', reason: releaseAlignment.reason || 'Workflow ref could not be resolved.' };
        }
        if (releaseAlignment?.status === 'manifest-missing') {
            return { label: 'Bootstrap', level: 'neutral', reason: releaseAlignment.reason || 'Waiting for hosted release metadata.' };
        }
        return { label: 'Unknown', level: 'neutral', reason: releaseAlignment?.reason || null };
    }

    function formatMinutesCompact(value) {
        const minutes = Number(value);
        if (!Number.isFinite(minutes) || minutes < 0) return '-';
        if (minutes < 60) return `${Math.round(minutes)}m`;
        const totalHours = Math.floor(minutes / 60);
        const remMinutes = Math.round(minutes % 60);
        if (totalHours < 24) {
            return remMinutes ? `${totalHours}h ${remMinutes}m` : `${totalHours}h`;
        }
        const days = Math.floor(totalHours / 24);
        const remHours = totalHours % 24;
        return remHours ? `${days}d ${remHours}h` : `${days}d`;
    }

    function buildDataworksOverallStatus({ marketSummary, liveAemo, opsSummary }) {
        const reasons = [];
        let level = 'good';
        let label = 'Healthy';

        const considerStatus = (status) => {
            if (!status || typeof status !== 'object') return;
            if (statusSeverity(status.level) > statusSeverity(level)) {
                level = status.level || level;
                label = status.label || label;
            }
            if (Array.isArray(status.reasons)) {
                status.reasons.forEach((reason) => {
                    if (reason) reasons.push(String(reason));
                });
            }
        };

        considerStatus(marketSummary?.status || null);
        considerStatus(liveAemo?.status || null);

        const releaseGuard = summarizeReleaseGuard(opsSummary?.releaseAlignment || null);
        if (statusSeverity(releaseGuard.level) > statusSeverity(level)) {
            level = releaseGuard.level;
            label = releaseGuard.label;
        }
        if (releaseGuard.reason) reasons.push(releaseGuard.reason);

        const uniqueReasons = Array.from(new Set(reasons.filter(Boolean)));
        return {
            level,
            label,
            reasons: uniqueReasons
        };
    }

    function renderDataworksBadge(label, level) {
        const tone = dataworksTone(level || label);
        return `<span class="dataworks-badge ${tone}">${escapeHtml(label || 'Unknown')}</span>`;
    }

    function renderDataworksMetricRow(label, value, meta) {
        return `
            <div class="dataworks-metric-row">
                <div class="dataworks-metric-label">${escapeHtml(label)}</div>
                <div class="dataworks-metric-value">${escapeHtml(value)}</div>
                ${meta ? `<div class="dataworks-metric-meta">${escapeHtml(meta)}</div>` : ''}
            </div>
        `;
    }

    function renderDataworksPanel(title, icon, badgeHtml, bodyHtml, subtitle = '') {
        return `
            <div class="dw-panel-head">
                <div class="dw-head-main">
                    <span class="dw-icon-box">${escapeHtml(icon)}</span>
                    <div class="dw-head-text">
                        <span class="dw-title">${escapeHtml(title)}</span>
                        ${subtitle ? `<span class="dw-subtitle">${escapeHtml(subtitle)}</span>` : ''}
                    </div>
                </div>
                ${badgeHtml || ''}
            </div>
            <div class="dw-panel-body">${bodyHtml}</div>
        `;
    }

    function renderExternalLink(url, label) {
        if (!url) return escapeHtml(label || '-');
        return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label || url)}</a>`;
    }

    async function fetchJsonResponse(url, options = {}) {
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`Request failed: ${response.status}`);
        }
        return response.json();
    }

    async function fetchDataworksIndex() {
        const cacheBust = Date.now();
        return fetchJsonResponse(`/data/aemo-market-insights/index.json?ts=${cacheBust}`, {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' }
        });
    }

    async function fetchDataworksOpsSummary(force = false) {
        if (typeof adminApiClient?.getAdminDataworksOps === 'function') {
            const data = await adminApiClient.getAdminDataworksOps(force);
            if (!data || data.errno !== 0) {
                throw new Error(data?.error || 'Failed to load DataWorks workflow diagnostics');
            }
            return data;
        }

        const query = new URLSearchParams();
        if (force) query.set('force', '1');
        const path = query.size ? `/api/admin/dataworks/ops?${query.toString()}` : '/api/admin/dataworks/ops';
        const resp = await adminApiClient.fetch(path);
        if (!resp.ok) {
            throw new Error(`Request failed: ${resp.status}`);
        }
        const data = await resp.json();
        if (!data || data.errno !== 0) {
            throw new Error(data?.error || 'Failed to load DataWorks workflow diagnostics');
        }
        return data;
    }

    function deriveDataworksMarketSummary(index) {
        const summary = index?.dataworks || {};
        const freshness = summary.freshness || {};
        const quality = summary.quality || {};
        const files = summary.files || {};
        const workflow = summary.workflow || {};
        const sourceRegionRows = Array.isArray(summary.regions) ? summary.regions : [];
        const latestDate = freshness.latestDate || index?.bounds?.maxDate || null;
        const latestPeriod = freshness.latestPeriod || index?.bounds?.maxPeriod || null;
        const dataAgeDays = computeCurrentUtcDayAge(latestDate);
        const regionRows = sourceRegionRows.map((row) => ({
            ...row,
            ageDays: computeCurrentUtcDayAge(row?.latestDate)
        }));
        const status = buildLiveDataworksStatus({
            dataAgeDays,
            issuePeriods: quality?.issuePeriods,
            recentMinimumCoveragePct: quality?.recentMinimumCoveragePct,
            recentAverageQualityScore: quality?.recentAverageQualityScore,
            fallbackStatus: summary.status
        });
        return {
            latestDate,
            latestPeriod,
            dataAgeDays: Number.isFinite(dataAgeDays) ? dataAgeDays : null,
            generatedAt: index?.generatedAt || null,
            sourceGeneratedAt: index?.sourceGeneratedAt || null,
            status,
            workflow,
            files,
            quality,
            regionRows,
            counts: index?.counts || {},
            regions: Array.isArray(index?.regions) ? index.regions : [],
            bounds: index?.bounds || {}
        };
    }

    function deriveDataworksOpsSummary(data) {
        const result = data?.result || {};
        const workflow = result.workflow || {};
        const dispatch = result.dispatch || {};
        const liveAemo = result.liveAemo && typeof result.liveAemo === 'object'
            ? result.liveAemo
            : null;
        const latestRun = result.latestRun && typeof result.latestRun === 'object' ? result.latestRun : null;
        const lastSuccessfulRun = result.lastSuccessfulRun && typeof result.lastSuccessfulRun === 'object'
            ? result.lastSuccessfulRun
            : null;
        const latestJob = result.latestJob && typeof result.latestJob === 'object' ? result.latestJob : null;
        const recentRuns = Array.isArray(result.recentRuns) ? result.recentRuns : [];
        const latestFailedStep = latestJob?.steps?.find((step) => step?.conclusion === 'failure') || null;
        const latestCompletedStep = Array.isArray(latestJob?.steps) && latestJob.steps.length
            ? latestJob.steps[latestJob.steps.length - 1]
            : null;
        const latestStep = latestFailedStep || latestCompletedStep || null;
        const latestRunState = String(latestRun?.status || '').toLowerCase();
        const latestRunConclusion = String(latestRun?.conclusion || '').toLowerCase();
        const badge = (() => {
            if (!latestRun) return { label: 'No Runs', level: 'neutral' };
            if (latestRunState && latestRunState !== 'completed') return { label: 'Running', level: 'warn' };
            if (latestRunConclusion === 'success') return { label: 'Healthy', level: 'good' };
            if (latestRunConclusion === 'failure') return { label: 'Failure', level: 'bad' };
            if (latestRunConclusion === 'cancelled' || latestRunConclusion === 'timed_out') return { label: 'Watch', level: 'warn' };
            return {
                label: formatStatusLabel(latestRun?.conclusion || latestRun?.status || 'Unknown'),
                level: 'neutral'
            };
        })();

        return {
            workflow,
            liveAemo,
            dispatchEnabled: !!dispatch.enabled,
            dispatchConfigured: !!dispatch.configured,
            dispatchReason: dispatch.reason || null,
            dispatchCooldownMs: Number(dispatch.cooldownMs || 0),
            releaseAlignment: result.releaseAlignment || null,
            latestRun,
            latestJob,
            latestStep,
            latestFailedStep,
            lastSuccessfulRun,
            recentRuns,
            cache: result.cache || null,
            rateLimit: result.rateLimit || null,
            badge
        };
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function computeWeightedRunAverageMs(runs, statsKey) {
        const list = Array.isArray(runs) ? runs : [];
        let weightedTotalMs = 0;
        let totalSamples = 0;
        list.forEach((run) => {
            const stats = run && typeof run === 'object' ? run[statsKey] : null;
            const avgMs = Number(stats?.avgMs || 0);
            const count = Number(stats?.count || 0);
            if (!Number.isFinite(avgMs) || !Number.isFinite(count) || avgMs < 0 || count <= 0) return;
            weightedTotalMs += avgMs * count;
            totalSamples += count;
        });
        if (totalSamples <= 0) {
            return { avgMs: 0, sampleCount: 0 };
        }
        return {
            avgMs: weightedTotalMs / totalSamples,
            sampleCount: totalSamples
        };
    }

    function classifySchedulerSloLevel(value, target) {
        const measured = Number(value);
        const threshold = Number(target);
        if (!Number.isFinite(measured) || !Number.isFinite(threshold) || threshold <= 0) {
            return { level: 'warn', label: 'No data' };
        }
        if (measured <= threshold) {
            return { level: 'good', label: 'Healthy' };
        }
        if (measured <= threshold * 2) {
            return { level: 'warn', label: 'Watch' };
        }
        return { level: 'bad', label: 'Breach' };
    }

    function computeSchedulerRatePct(numerator, denominator) {
        const safeNumerator = Number(numerator || 0);
        const safeDenominator = Number(denominator || 0);
        if (!Number.isFinite(safeNumerator) || !Number.isFinite(safeDenominator) || safeDenominator <= 0) {
            return 0;
        }
        return Number(((safeNumerator / safeDenominator) * 100).toFixed(2));
    }

    function buildSchedulerCurrentSnapshotFallback(recentRuns, currentAlert) {
        const latestRun = Array.isArray(recentRuns) && recentRuns.length ? recentRuns[0] : null;
        if (!latestRun || typeof latestRun !== 'object') return null;
        const alertMatchesRun = currentAlert && currentAlert.runId && currentAlert.runId === latestRun.runId;
        return {
            runId: latestRun.runId || null,
            dayKey: latestRun.dayKey || null,
            schedulerId: latestRun.schedulerId || null,
            workerId: latestRun.workerId || null,
            startedAtMs: Number(latestRun.startedAtMs || 0),
            completedAtMs: Number(latestRun.completedAtMs || 0),
            durationMs: Number(latestRun.durationMs || 0),
            cycleCandidates: Number(latestRun.cycleCandidates || 0),
            cyclesRun: Number(latestRun.cyclesRun || 0),
            errors: Number(latestRun.errors || 0),
            deadLetters: Number(latestRun.deadLetters || 0),
            retries: Number(latestRun.retries || 0),
            errorRatePct: computeSchedulerRatePct(latestRun.errors, latestRun.cyclesRun),
            deadLetterRatePct: computeSchedulerRatePct(latestRun.deadLetters, latestRun.cyclesRun),
            avgQueueLagMs: Number(latestRun.queueLagMs?.avgMs || 0),
            maxQueueLagMs: Number(latestRun.queueLagMs?.maxMs || 0),
            avgCycleDurationMs: Number(latestRun.cycleDurationMs?.avgMs || 0),
            maxCycleDurationMs: Number(latestRun.cycleDurationMs?.maxMs || 0),
            maxTelemetryAgeMs: Number(latestRun.telemetryAgeMs?.maxMs || 0),
            p95CycleDurationMs: Number(latestRun.cycleDurationMs?.p95Ms || 0),
            p99CycleDurationMs: Number(latestRun.cycleDurationMs?.p99Ms || 0),
            phaseTimingsMaxMs: {
                dataFetchMs: Number(latestRun.phaseTimingsMs?.dataFetchMs?.maxMs || 0),
                ruleEvalMs: Number(latestRun.phaseTimingsMs?.ruleEvalMs?.maxMs || 0),
                actionApplyMs: Number(latestRun.phaseTimingsMs?.actionApplyMs?.maxMs || 0),
                curtailmentMs: Number(latestRun.phaseTimingsMs?.curtailmentMs?.maxMs || 0)
            },
            skipped: {
                disabledOrBlackout: Number(latestRun.skipped?.disabledOrBlackout || 0),
                idempotent: Number(latestRun.skipped?.idempotent || 0),
                locked: Number(latestRun.skipped?.locked || 0),
                tooSoon: Number(latestRun.skipped?.tooSoon || 0)
            },
            failureByType: latestRun.failureByType && typeof latestRun.failureByType === 'object'
                ? latestRun.failureByType
                : {},
            telemetryPauseReasons: latestRun.telemetryPauseReasons && typeof latestRun.telemetryPauseReasons === 'object'
                ? latestRun.telemetryPauseReasons
                : {},
            likelyCauses: [],
            slo: {
                status: alertMatchesRun ? String(currentAlert.status || 'healthy').toLowerCase() : String(latestRun.slo?.status || 'healthy').toLowerCase(),
                breachedMetrics: alertMatchesRun && Array.isArray(currentAlert.breachedMetrics) ? currentAlert.breachedMetrics : (Array.isArray(latestRun.slo?.breachedMetrics) ? latestRun.slo.breachedMetrics : []),
                watchMetrics: alertMatchesRun && Array.isArray(currentAlert.watchMetrics) ? currentAlert.watchMetrics : (Array.isArray(latestRun.slo?.watchMetrics) ? latestRun.slo.watchMetrics : [])
            }
        };
    }

    function renderSchedulerSloCards(prefix, summary, options = {}) {
        const safePrefix = String(prefix || '').trim();
        const hasWindowSummary = summary && typeof summary === 'object';
        if (!safePrefix) return;
        if (!hasWindowSummary) {
            ['SloErrorRate', 'SloDeadLetterRate', 'SloQueueLag', 'SloCycleDuration', 'SloTelemetryAge', 'SloCycleTailP99'].forEach((suffix) => {
                const id = `${safePrefix}${suffix}`;
                const cardEl = document.getElementById(id);
                if (!cardEl) return;
                const statusEl = cardEl.querySelector('.slo-status');
                const valueEl = cardEl.querySelector('.slo-value');
                const metaEl = cardEl.querySelector('.slo-meta');
                cardEl.classList.remove('good', 'warn', 'bad');
                cardEl.classList.add('warn');
                if (statusEl) statusEl.textContent = 'No data';
                if (valueEl) valueEl.textContent = 'Window unavailable';
                if (metaEl) metaEl.textContent = 'Refresh to load scheduler metrics.';
            });
            return;
        }
        const cyclesRun = Number(summary?.cyclesRun || 0);
        const deadLetters = Number(summary?.deadLetters || 0);
        const errorRatePct = Number(summary?.errorRatePct || 0);
        const deadLetterRatePct = Number(summary?.deadLetterRatePct || computeSchedulerRatePct(deadLetters, cyclesRun));
        const p95QueueLagMs = Number(summary?.p95QueueLagMs || summary?.maxQueueLagMs || 0);
        const p95CycleDurationMs = Number(summary?.p95CycleDurationMs || 0);
        const maxQueueLagMs = Number(summary?.maxQueueLagMs || 0);
        const maxCycleDurationMs = Number(summary?.maxCycleDurationMs || 0);
        const maxTelemetryAgeMs = Number(summary?.maxTelemetryAgeMs || 0);
        const p99CycleDurationMs = Number(summary?.p99CycleDurationMs || 0);
        const avgQueueLagMs = Number(summary?.avgQueueLagMs || options?.avgQueueLagMs || 0);
        const avgCycleDurationMs = Number(summary?.avgCycleDurationMs || options?.avgCycleDurationMs || 0);
        const telemetryPauseReasons = summary?.telemetryPauseReasons && typeof summary.telemetryPauseReasons === 'object'
            ? summary.telemetryPauseReasons
            : {};
        const telemetryMissingTimestampCount = Number(telemetryPauseReasons.stale_telemetry_missing_timestamp || 0);
        const thresholds = options?.thresholds && typeof options.thresholds === 'object'
            ? options.thresholds
            : {};
        const queueLagTargetMs = Number(thresholds.maxQueueLagMs || 120000);
        const cycleDurationTargetMs = Number(thresholds.maxCycleDurationMs || 20000);
        const telemetryAgeTargetMs = Number(thresholds.maxTelemetryAgeMs || (30 * 60 * 1000));
        const p99TargetMs = Number(thresholds.p99CycleDurationMs || 10000);
        const tailWindowMinutes = Math.max(1, Number(thresholds.tailWindowMinutes || 15));
        const tailInfo = options?.tailLatency && typeof options.tailLatency === 'object'
            ? options.tailLatency
            : null;
        const tailStatus = String(tailInfo?.status || 'healthy').toUpperCase();
        const tailRunsAbove = Number(tailInfo?.runsAboveThreshold || 0);
        const tailObservedRuns = Number(tailInfo?.observedRuns || 0);
        const tailMinRuns = Math.max(1, Number(tailInfo?.minRuns || thresholds.tailMinRuns || 10));
        const tailThresholdMs = Number(tailInfo?.thresholdMs || p99TargetMs);

        const cards = [
            {
                id: `${safePrefix}SloErrorRate`,
                value: errorRatePct,
                target: Number(thresholds.errorRatePct || 1.0),
                display: `${errorRatePct.toFixed(2)}%`,
                targetDisplay: `Target <= ${Number(thresholds.errorRatePct || 1.0).toFixed(2)}%`,
                meta: `Runs ${formatCompactNumber(summary?.runs || 0)} · Cycles ${formatCompactNumber(summary?.cyclesRun || 0)} · Errors ${formatCompactNumber(summary?.errors || 0)} · Dead letters ${formatCompactNumber(summary?.deadLetters || 0)}`
            },
            {
                id: `${safePrefix}SloDeadLetterRate`,
                value: deadLetterRatePct,
                target: Number(thresholds.deadLetterRatePct || 0.2),
                display: `${deadLetterRatePct.toFixed(2)}%`,
                targetDisplay: `Target <= ${Number(thresholds.deadLetterRatePct || 0.2).toFixed(2)}%`,
                meta: `Runs ${formatCompactNumber(summary?.runs || 0)} · Cycles ${formatCompactNumber(summary?.cyclesRun || 0)} · Errors ${formatCompactNumber(summary?.errors || 0)} · Dead letters ${formatCompactNumber(summary?.deadLetters || 0)}`
            },
            {
                id: `${safePrefix}SloQueueLag`,
                value: p95QueueLagMs,
                target: queueLagTargetMs,
                display: `${formatDurationMs(avgQueueLagMs)} avg / ${formatDurationMs(p95QueueLagMs)} p95`,
                targetDisplay: `Target window p95 <= ${formatDurationMs(queueLagTargetMs)}`,
                meta: `Weighted average across executed cycles in this window. Diagnostic max ${formatDurationMs(maxQueueLagMs)}. Runs ${formatCompactNumber(summary?.runs || 0)} · Cycles ${formatCompactNumber(summary?.cyclesRun || 0)}`
            },
            {
                id: `${safePrefix}SloCycleDuration`,
                value: p95CycleDurationMs,
                target: cycleDurationTargetMs,
                display: `${formatDurationMs(avgCycleDurationMs)} avg / ${formatDurationMs(p95CycleDurationMs)} p95`,
                targetDisplay: `Target window p95 <= ${formatDurationMs(cycleDurationTargetMs)}`,
                meta: `Weighted average across executed cycles in this window. Diagnostic max ${formatDurationMs(maxCycleDurationMs)}. Runs ${formatCompactNumber(summary?.runs || 0)} · Cycles ${formatCompactNumber(summary?.cyclesRun || 0)}`
            },
            {
                id: `${safePrefix}SloTelemetryAge`,
                value: maxTelemetryAgeMs,
                target: telemetryAgeTargetMs,
                display: telemetryMissingTimestampCount > 0
                    ? `${formatDurationMs(maxTelemetryAgeMs)} max · ${formatCompactNumber(telemetryMissingTimestampCount)} missing timestamp`
                    : `${formatDurationMs(maxTelemetryAgeMs)} max`,
                targetDisplay: `Target max <= ${formatDurationMs(telemetryAgeTargetMs)}`,
                meta: telemetryMissingTimestampCount > 0
                    ? `Derived from runs with parseable source timestamps. Missing timestamp cycles: ${formatCompactNumber(telemetryMissingTimestampCount)} · Runs ${formatCompactNumber(summary?.runs || 0)} · Cycles ${formatCompactNumber(summary?.cyclesRun || 0)}`
                    : `Derived from runs with parseable source timestamps. Runs ${formatCompactNumber(summary?.runs || 0)} · Cycles ${formatCompactNumber(summary?.cyclesRun || 0)}`
            },
            {
                id: `${safePrefix}SloCycleTailP99`,
                value: p99CycleDurationMs,
                target: p99TargetMs,
                display: `${formatDurationMs(p99CycleDurationMs)} window max p99`,
                targetDisplay: `Target window max p99 <= ${formatDurationMs(p99TargetMs)}`,
                meta: `Current sustained signal ${tailStatus} (${tailRunsAbove}/${tailObservedRuns} above ${formatDurationMs(tailThresholdMs)} in ${tailWindowMinutes}m, min ${tailMinRuns})`
            }
        ];

        cards.forEach((card) => {
            const cardEl = document.getElementById(card.id);
            if (!cardEl) return;

            const statusEl = cardEl.querySelector('.slo-status');
            const targetEl = cardEl.querySelector('.slo-value');
            const metaEl = cardEl.querySelector('.slo-meta');
            const { level, label } = classifySchedulerSloLevel(card.value, card.target);
            cardEl.classList.remove('good', 'warn', 'bad');
            cardEl.classList.add(level);
            if (statusEl) {
                statusEl.textContent = `${label} - ${card.display}`;
            }
            if (targetEl && card.targetDisplay) {
                targetEl.textContent = card.targetDisplay;
            }
            if (metaEl) {
                metaEl.textContent = card.meta || '';
            }
        });
    }

    function renderSchedulerMetricsChart(dailyRows) {
        const canvas = document.getElementById('schedulerMetricsChart');
        if (!canvas || typeof Chart === 'undefined') return;

        const daily = Array.isArray(dailyRows) ? dailyRows : [];
        const labels = daily.map((point) => {
            const d = new Date(`${point.dayKey}T00:00:00Z`);
            return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });
        });
        const cycles = daily.map((point) => Number(point.cyclesRun || 0));
        const errors = daily.map((point) => Number(point.errors || 0));
        const retries = daily.map((point) => Number(point.retries || 0));
        const avgCycleSec = daily.map((point) => {
            const ms = Number(point.avgCycleDurationMs || 0);
            return ms > 0 ? Math.round(ms / 100) / 10 : null;
        });
        const p99CycleSec = daily.map((point) => {
            const ms = Number(point.p99CycleDurationMs || 0);
            return ms > 0 ? Math.round(ms / 100) / 10 : null;
        });

        if (schedulerMetricsChart) {
            schedulerMetricsChart.destroy();
            schedulerMetricsChart = null;
        }

        schedulerMetricsChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        type: 'bar',
                        label: 'Cycles Run',
                        data: cycles,
                        backgroundColor: 'rgba(88, 166, 255, 0.26)',
                        borderColor: 'rgba(88, 166, 255, 0.7)',
                        borderWidth: 1,
                        borderRadius: 4
                    },
                    {
                        type: 'line',
                        label: 'Errors',
                        data: errors,
                        borderColor: 'rgba(248, 113, 113, 0.95)',
                        backgroundColor: 'rgba(248, 113, 113, 0.16)',
                        borderWidth: 2,
                        pointRadius: 2,
                        tension: 0.2
                    },
                    {
                        type: 'line',
                        label: 'Retries',
                        data: retries,
                        borderColor: 'rgba(240, 136, 62, 0.95)',
                        backgroundColor: 'rgba(240, 136, 62, 0.16)',
                        borderWidth: 2,
                        pointRadius: 2,
                        tension: 0.2
                    },
                    {
                        type: 'line',
                        label: 'Avg Cycle (s)',
                        data: avgCycleSec,
                        yAxisID: 'y1',
                        borderColor: 'rgba(163, 230, 53, 0.85)',
                        backgroundColor: 'rgba(163, 230, 53, 0.12)',
                        borderWidth: 2,
                        borderDash: [4, 3],
                        pointRadius: 2,
                        tension: 0.3,
                        spanGaps: true
                    },
                    {
                        type: 'line',
                        label: 'P99 Cycle (s)',
                        data: p99CycleSec,
                        yAxisID: 'y1',
                        borderColor: 'rgba(250, 204, 21, 0.92)',
                        backgroundColor: 'rgba(250, 204, 21, 0.2)',
                        borderWidth: 2,
                        pointRadius: 2,
                        tension: 0.2,
                        spanGaps: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        labels: {
                            color: cssVar('--text-secondary'),
                            boxWidth: 12,
                            usePointStyle: true,
                            pointStyle: 'rectRounded'
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: cssVar('--text-secondary'), maxTicksLimit: 12 },
                        grid: { color: cssVar('--border-secondary') }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { color: cssVar('--text-secondary'), precision: 0 },
                        grid: { color: cssVar('--border-secondary') }
                    },
                    y1: {
                        beginAtZero: true,
                        position: 'right',
                        ticks: {
                            color: 'rgba(163, 230, 53, 0.7)',
                            callback: (v) => `${v}s`
                        },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });
    }

    function renderSchedulerRecentRuns(recentRuns) {
        const body = document.getElementById('schedulerRecentRunsBody');
        const empty = document.getElementById('schedulerRecentRunsEmpty');
        if (!body || !empty) return;

        const runs = Array.isArray(recentRuns) ? recentRuns : [];
        if (!runs.length) {
            body.innerHTML = '';
            empty.style.display = '';
            return;
        }

        empty.style.display = 'none';
        body.innerHTML = runs.map((run) => {
            const startedAt = run.startedAtMs ? new Date(Number(run.startedAtMs)).toLocaleString('en-AU') : '-';
            const schedulerId = run.schedulerId || '-';
            const workerId = run.workerId || '-';
            const candidates = Number(run.cycleCandidates || 0);
            const cyclesRun = Number(run.cyclesRun || 0);
            const errors = Number(run.errors || 0);
            const deadLetters = Number(run.deadLetters || 0);
            const locked = Number(run.skipped?.locked || 0);
            const idempotent = Number(run.skipped?.idempotent || 0);
            const p99Cycle = formatDurationMs(run.cycleDurationMs?.p99Ms || 0);
            const maxCycle = formatDurationMs(run.cycleDurationMs?.maxMs || 0);
            const title = `run=${run.runId || '-'} worker=${workerId}`;
            return `<tr>
                <td>${startedAt}</td>
                <td title="${escapeHtml(title)}">${escapeHtml(schedulerId)}</td>
                <td>${candidates}</td>
                <td>${cyclesRun}</td>
                <td>${errors}</td>
                <td>${deadLetters}</td>
                <td>${locked}</td>
                <td>${idempotent}</td>
                <td>${p99Cycle}</td>
                <td>${maxCycle}</td>
            </tr>`;
        }).join('');
    }

    function renderSchedulerDiagnostics(diagnostics) {
        const el = document.getElementById('schedulerDiagnostics');
        if (!el) return;

        const diag = diagnostics && typeof diagnostics === 'object' ? diagnostics : {};
        const outlier = diag.outlierRun && typeof diag.outlierRun === 'object' ? diag.outlierRun : null;
        const tail = diag.tailLatency && typeof diag.tailLatency === 'object' ? diag.tailLatency : null;
        const phaseTimings = diag.phaseTimings && typeof diag.phaseTimings === 'object'
            ? diag.phaseTimings
            : null;
        const phaseRows = [
            { key: 'dataFetchMs', label: 'Fetch' },
            { key: 'ruleEvalMs', label: 'Eval' },
            { key: 'actionApplyMs', label: 'Apply' },
            { key: 'curtailmentMs', label: 'Curtail' }
        ];
        const telemetryPauseReasons = diag.telemetryPauseReasons && typeof diag.telemetryPauseReasons === 'object'
            ? diag.telemetryPauseReasons
            : {};
        const telemetryPauseReasonEntries = Object.entries(telemetryPauseReasons)
            .map(([reason, count]) => ({
                reason: String(reason || '').trim(),
                count: Number(count || 0)
            }))
            .filter((entry) => entry.reason && entry.count > 0)
            .sort((a, b) => b.count - a.count);
        const telemetryText = telemetryPauseReasonEntries.length > 0
            ? telemetryPauseReasonEntries
                .slice(0, 5)
                .map((entry) => `${entry.reason}=${entry.count}`)
                .join(', ')
            : 'none observed in window';
        const phaseComparison = phaseRows
            .map(({ key, label }) => {
                const latestMs = Number(phaseTimings?.latestRunMaxMs?.[key] || 0);
                const windowMaxMs = Number(phaseTimings?.windowMaxMs?.[key] || 0);
                return `${label} ${formatDurationMs(latestMs)} / ${formatDurationMs(windowMaxMs)}`;
            })
            .join(' | ');
        const outlierPhaseComparison = phaseRows
            .map(({ key, label }) => {
                const outlierMs = Number(phaseTimings?.outlierRunMaxMs?.[key] || 0);
                const windowMaxMs = Number(phaseTimings?.windowMaxMs?.[key] || 0);
                return `${label} ${formatDurationMs(outlierMs)} / ${formatDurationMs(windowMaxMs)}`;
            })
            .join(' | ');
        const phaseStartedAt = phaseTimings?.latestRunStartedAtMs
            ? new Date(Number(phaseTimings.latestRunStartedAtMs)).toLocaleString('en-AU')
            : '-';
        const outlierPhaseStartedAt = phaseTimings?.outlierRunStartedAtMs
            ? new Date(Number(phaseTimings.outlierRunStartedAtMs)).toLocaleString('en-AU')
            : '-';

        if (!outlier && !phaseTimings && telemetryPauseReasonEntries.length === 0) {
            el.textContent = 'No scheduler outlier diagnostics available yet.';
            return;
        }
        if (!outlier && phaseTimings) {
            const tailRunsAboveOnly = Number(tail?.runsAboveThreshold || 0);
            const tailObservedOnly = Number(tail?.observedRuns || 0);
            const tailMinOnly = Math.max(1, Number(tail?.minRuns || 1));
            const tailTextOnly = tail
                ? `${String(tail.status || 'healthy').toUpperCase()} (${tailRunsAboveOnly}/${tailObservedOnly} runs above ${formatDurationMs(tail.thresholdMs || 0)} in ${Math.max(1, Number(tail.windowMinutes || 15))}m window; min ${tailMinOnly})`
                : 'No sustained tail data';
            el.innerHTML = `
                <div><strong>Phase Timings:</strong> latest run @ ${escapeHtml(phaseStartedAt)} maxes (latest / window): ${escapeHtml(phaseComparison)}</div>
                <div><strong>Sustained Tail Signal:</strong> ${escapeHtml(tailTextOnly)}</div>
                <div><strong>Telemetry Fail-safe Reasons:</strong> ${escapeHtml(telemetryText)}</div>
            `;
            return;
        }
        if (!outlier) {
            el.innerHTML = `
                <div><strong>Telemetry Fail-safe Reasons:</strong> ${escapeHtml(telemetryText)}</div>
            `;
            return;
        }

        const startedAt = outlier?.startedAtMs ? new Date(Number(outlier.startedAtMs)).toLocaleString('en-AU') : '-';
        const slowest = outlier?.slowestCycle && typeof outlier.slowestCycle === 'object' ? outlier.slowestCycle : null;
        const causes = Array.isArray(outlier?.likelyCauses) ? outlier.likelyCauses : [];
        const causeText = causes.length ? causes.join(', ') : 'no_clear_cause_from_scheduler_metrics';
        const tailRunsAbove = Number(tail?.runsAboveThreshold || 0);
        const tailObservedRuns = Number(tail?.observedRuns || 0);
        const tailMinRuns = Math.max(1, Number(tail?.minRuns || 1));
        const tailText = tail
            ? `${String(tail.status || 'healthy').toUpperCase()} (${tailRunsAbove}/${tailObservedRuns} runs above ${formatDurationMs(tail.thresholdMs || 0)} in ${Math.max(1, Number(tail.windowMinutes || 15))}m window; min ${tailMinRuns})`
            : 'No sustained tail data';

        const slowestText = slowest
            ? `slowestCycle user=${escapeHtml(slowest.userId || '-')} duration=${formatDurationMs(slowest.durationMs || 0)} queue=${formatDurationMs(slowest.queueLagMs || 0)} retries=${Number(slowest.retriesUsed || 0)} failure=${escapeHtml(slowest.failureType || 'none')}`
            : 'slowestCycle unavailable';

        el.innerHTML = `
            <div><strong>Outlier Run:</strong> ${escapeHtml(outlier?.runId || '-')} @ ${escapeHtml(startedAt)} (scheduler=${escapeHtml(outlier?.schedulerId || '-')}, worker=${escapeHtml(outlier?.workerId || '-')})</div>
            <div><strong>Tail:</strong> p95=${formatDurationMs(outlier?.p95CycleDurationMs || 0)}, p99=${formatDurationMs(outlier?.p99CycleDurationMs || 0)}, max=${formatDurationMs(outlier?.maxCycleDurationMs || 0)}, queueMax=${formatDurationMs(outlier?.queueLagMaxMs || 0)}</div>
            <div><strong>Outlier Phases:</strong> run @ ${escapeHtml(outlierPhaseStartedAt === '-' ? startedAt : outlierPhaseStartedAt)} maxes (outlier / window): ${escapeHtml(outlierPhaseComparison)}</div>
            <div><strong>Latest Phases:</strong> latest run @ ${escapeHtml(phaseStartedAt)} maxes (latest / window): ${escapeHtml(phaseComparison)}</div>
            <div><strong>Likely Causes:</strong> ${escapeHtml(causeText)}</div>
            <div><strong>Slowest Cycle:</strong> ${slowestText}</div>
            <div><strong>Sustained Tail Signal:</strong> ${escapeHtml(tailText)}</div>
            <div><strong>Telemetry Fail-safe Reasons:</strong> ${escapeHtml(telemetryText)}</div>
        `;
    }

    function formatSchedulerAlertMessage(currentAlert) {
        const alert = currentAlert && typeof currentAlert === 'object' ? currentAlert : null;
        if (!alert) return '';
        const status = String(alert.status || '').toLowerCase();
        const severity = status === 'breach' ? 'BREACH' : 'WATCH';
        const breached = Array.isArray(alert.breachedMetrics) ? alert.breachedMetrics : [];
        const watched = Array.isArray(alert.watchMetrics) ? alert.watchMetrics : [];
        const metricList = status === 'breach' ? breached : watched;
        const metricHint = metricList.length ? ` [${metricList.join(', ')}]` : '';
        return `Scheduler SLO ${severity}${metricHint}. See SLO cards and diagnostics for details.`;
    }

    async function retrySchedulerDeadLetter(userId, deadLetterId, buttonEl) {
        if (!adminApiClient || !userId || !deadLetterId) return;
        const button = buttonEl instanceof HTMLButtonElement ? buttonEl : null;
        const originalLabel = button ? button.textContent : 'Retry now';
        if (button) {
            button.disabled = true;
            button.textContent = 'Retrying...';
        }

        try {
            const resp = await adminApiClient.fetch(`/api/admin/dead-letters/${encodeURIComponent(userId)}/${encodeURIComponent(deadLetterId)}/retry`, {
                method: 'POST'
            });
            const payload = await resp.json();
            if (!resp.ok || payload?.errno !== 0) {
                throw new Error(payload?.error || `Retry failed (${resp.status})`);
            }
            showMessage('success', `Retried dead-letter cycle ${payload?.result?.cycleKey || deadLetterId}`);
            await loadSchedulerMetrics();
        } catch (error) {
            showMessage('error', `Failed to retry dead letter: ${error.message || error}`);
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = originalLabel;
            }
        }
    }

    function renderSchedulerDeadLetters(payload) {
        const countEl = document.getElementById('schedulerDeadLetterCount');
        const retryReadyEl = document.getElementById('schedulerDeadLetterRetryReady');
        const oldestEl = document.getElementById('schedulerDeadLetterOldest');
        const topErrorsEl = document.getElementById('schedulerDeadLetterTopErrors');
        const bodyEl = document.getElementById('schedulerDeadLettersBody');
        const emptyEl = document.getElementById('schedulerDeadLettersEmpty');
        if (!countEl || !retryReadyEl || !oldestEl || !topErrorsEl || !bodyEl || !emptyEl) return;

        const result = payload && typeof payload === 'object' ? payload : {};
        const items = Array.isArray(result.items) ? result.items : [];
        const topErrors = Array.isArray(result.topErrors) ? result.topErrors : [];

        if (!bodyEl.dataset.retryBound) {
            bodyEl.dataset.retryBound = '1';
            bodyEl.addEventListener('click', (event) => {
                const button = event.target instanceof Element
                    ? event.target.closest('button[data-dead-letter-retry="1"]')
                    : null;
                if (!button) return;
                retrySchedulerDeadLetter(button.dataset.userId, button.dataset.deadLetterId, button);
            });
        }

        countEl.textContent = formatCompactNumber(result.total || 0);
        retryReadyEl.textContent = formatCompactNumber(result.retryReadyCount || 0);
        oldestEl.textContent = formatDurationMs(result.oldestAgeMs || 0);
        topErrorsEl.textContent = topErrors.length
            ? `Top errors: ${topErrors.slice(0, 3).map((entry) => `${entry.error} (${entry.count})`).join(' · ')}`
            : 'No dead-letter error clusters in this window.';

        if (!items.length) {
            bodyEl.innerHTML = '';
            emptyEl.style.display = '';
            return;
        }

        emptyEl.style.display = 'none';
        bodyEl.innerHTML = items.map((item) => {
            const createdAt = item.createdAt ? new Date(Number(item.createdAt)).toLocaleString('en-AU') : '-';
            const retryState = item.retryReady ? 'Retry ready' : 'Cooling down';
            return `
                <tr>
                    <td>${escapeHtml(createdAt)}</td>
                    <td>${escapeHtml(item.userId || '-')}</td>
                    <td title="${escapeHtml(item.cycleKey || '-')}">${escapeHtml(item.cycleKey || '-')}</td>
                    <td>${formatCompactNumber(item.attempts || 0)}</td>
                    <td>${escapeHtml(retryState)}</td>
                    <td>${escapeHtml(item.error || '-')}</td>
                    <td><button class="btn btn-sm" data-dead-letter-retry="1" data-user-id="${escapeHtml(item.userId || '')}" data-dead-letter-id="${escapeHtml(item.id || '')}">Retry now</button></td>
                </tr>
            `;
        }).join('');
    }

    async function loadSchedulerMetrics() {
        const updatedEl = document.getElementById('schedulerMetricsUpdated');
        const warningEl = document.getElementById('schedulerMetricsWarning');
        const refreshBtn = document.getElementById('refreshSchedulerBtn');
        if (!adminApiClient || !updatedEl || !warningEl) return;

        if (refreshBtn) refreshBtn.disabled = true;
        updatedEl.textContent = 'Loading scheduler metrics...';
        warningEl.style.display = 'none';
        warningEl.textContent = '';

        try {
            const days = 14;
            const includeRuns = true;
            const runLimit = 1500;
            let data;
            if (typeof adminApiClient.getAdminSchedulerMetrics === 'function') {
                data = await adminApiClient.getAdminSchedulerMetrics(days, includeRuns, runLimit);
            } else {
                const query = new URLSearchParams({
                    days: String(days),
                    includeRuns: includeRuns ? '1' : '0',
                    runLimit: String(runLimit)
                });
                const resp = await adminApiClient.fetch(`/api/admin/scheduler-metrics?${query.toString()}`);
                if (!resp.ok) throw new Error(`Request failed: ${resp.status}`);
                const rawBody = await resp.text();
                let parsed = null;
                if (rawBody) {
                    try {
                        parsed = JSON.parse(rawBody);
                    } catch (parseError) {
                        throw new Error('Invalid scheduler metrics response');
                    }
                }
                if (!parsed || typeof parsed !== 'object') throw new Error('Invalid scheduler metrics response');
                data = parsed;
            }
            if (!data || data.errno !== 0) throw new Error(data?.error || 'Failed to load scheduler metrics');

            const result = data.result || {};
            const summary = result.summary || {};
            const last24hSummary = result.last24hSummary || {};
            const daily = Array.isArray(result.daily) ? result.daily : [];
            const recentRuns = Array.isArray(result.recentRuns) ? result.recentRuns : [];
            const queueLagAverage = computeWeightedRunAverageMs(recentRuns, 'queueLagMs');
            const cycleDurationAverage = computeWeightedRunAverageMs(recentRuns, 'cycleDurationMs');
            const currentAlert = result.currentAlert && typeof result.currentAlert === 'object'
                ? result.currentAlert
                : null;
            const diagnostics = result.diagnostics && typeof result.diagnostics === 'object'
                ? result.diagnostics
                : {};
            const currentSnapshot = result.currentSnapshot && typeof result.currentSnapshot === 'object'
                ? result.currentSnapshot
                : buildSchedulerCurrentSnapshotFallback(recentRuns, currentAlert);
            const tailLatency = diagnostics.tailLatency && typeof diagnostics.tailLatency === 'object'
                ? diagnostics.tailLatency
                : (currentAlert?.tailLatency && typeof currentAlert.tailLatency === 'object'
                    ? currentAlert.tailLatency
                    : null);
            const last24hTailLatency = diagnostics.last24hTailLatency && typeof diagnostics.last24hTailLatency === 'object'
                ? diagnostics.last24hTailLatency
                : tailLatency;
            const sloThresholds = currentAlert?.thresholds && typeof currentAlert.thresholds === 'object'
                ? currentAlert.thresholds
                : {};

            document.getElementById('schedulerRuns').textContent = formatCompactNumber(summary.runs || 0);
            document.getElementById('schedulerCyclesRun').textContent = formatCompactNumber(summary.cyclesRun || 0);
            document.getElementById('schedulerErrors').textContent = formatCompactNumber(summary.errors || 0);
            document.getElementById('schedulerErrorRate').textContent = `${Number(summary.errorRatePct || 0).toFixed(2)}%`;
            document.getElementById('schedulerRetriesDeadLetters').textContent =
                `${formatCompactNumber(summary.retries || 0)} / ${formatCompactNumber(summary.deadLetters || 0)}`;
            document.getElementById('schedulerLockIdempotentSkips').textContent =
                `${formatCompactNumber(summary.skipped?.locked || 0)} / ${formatCompactNumber(summary.skipped?.idempotent || 0)}`;
            const p95El = document.getElementById('schedulerTailP95');
            const p99El = document.getElementById('schedulerTailP99');
            if (p95El) p95El.textContent = formatDurationMs(summary.p95CycleDurationMs || 0);
            if (p99El) p99El.textContent = formatDurationMs(summary.p99CycleDurationMs || 0);
            renderSchedulerSloCards('scheduler24h', last24hSummary, {
                avgQueueLagMs: Number(last24hSummary.avgQueueLagMs || 0),
                avgCycleDurationMs: Number(last24hSummary.avgCycleDurationMs || 0),
                thresholds: sloThresholds,
                tailLatency: last24hTailLatency
            });
            renderSchedulerSloCards('scheduler14d', summary, {
                avgQueueLagMs: Number(summary.avgQueueLagMs || queueLagAverage.avgMs || 0),
                avgCycleDurationMs: Number(summary.avgCycleDurationMs || cycleDurationAverage.avgMs || 0),
                thresholds: sloThresholds,
                tailLatency
            });

            renderSchedulerMetricsChart(daily);
            renderSchedulerRecentRuns(recentRuns.slice(0, 20));
            renderSchedulerDiagnostics({
                outlierRun: diagnostics.outlierRun || null,
                tailLatency,
                phaseTimings: diagnostics.phaseTimings || null,
                telemetryPauseReasons: diagnostics.telemetryPauseReasons || summary.telemetryPauseReasons || {}
            });

            try {
                const deadLettersResp = await adminApiClient.fetch('/api/admin/dead-letters?days=7&limit=20');
                const deadLettersData = await deadLettersResp.json();
                if (!deadLettersResp.ok || deadLettersData?.errno !== 0) {
                    throw new Error(deadLettersData?.error || `Dead-letter request failed (${deadLettersResp.status})`);
                }
                renderSchedulerDeadLetters(deadLettersData.result || {});
            } catch (deadLetterError) {
                renderSchedulerDeadLetters({
                    total: 0,
                    retryReadyCount: 0,
                    oldestAgeMs: 0,
                    topErrors: [{ error: deadLetterError.message || String(deadLetterError), count: 1 }],
                    items: []
                });
            }

            const updatedAt = result.updatedAt ? new Date(result.updatedAt) : new Date();
            const latestRunText = currentSnapshot?.startedAtMs
                ? `latest run ${new Date(Number(currentSnapshot.startedAtMs)).toLocaleString('en-AU')}`
                : 'latest run unavailable';
            updatedEl.textContent = `Last updated ${updatedAt.toLocaleDateString('en-AU')} ${updatedAt.toLocaleTimeString('en-AU')} · ${latestRunText} · recent 24h has ${formatCompactNumber(last24hSummary.runs || 0)} run(s) · 14d window has ${daily.length} day(s) with data`;

            if (currentAlert && String(currentAlert.status || '').toLowerCase() === 'breach') {
                warningEl.style.display = '';
                warningEl.textContent = formatSchedulerAlertMessage(currentAlert);
            }
        } catch (e) {
            updatedEl.textContent = 'Unable to load scheduler metrics';
            warningEl.style.display = '';
            warningEl.textContent = e.message || String(e);
            renderSchedulerSloCards('scheduler24h', null);
            renderSchedulerSloCards('scheduler14d', null);
            renderSchedulerRecentRuns([]);
            renderSchedulerDiagnostics(null);
            renderSchedulerDeadLetters({ total: 0, retryReadyCount: 0, oldestAgeMs: 0, topErrors: [], items: [] });
            const p95El = document.getElementById('schedulerTailP95');
            const p99El = document.getElementById('schedulerTailP99');
            if (p95El) p95El.textContent = '-';
            if (p99El) p99El.textContent = '-';
            showMessage('warning', `Failed to load scheduler metrics: ${e.message || e}`);
        } finally {
            if (refreshBtn) refreshBtn.disabled = false;
        }
    }

    const API_HEALTH_PROVIDER_COLORS = {
        foxess: '#3b9eff',
        sungrow: '#22d3a0',
        sigenergy: '#fb923c',
        alphaess: '#f472b6',
        amber: '#facc15',
        weather: '#38bdf8',
        ev: '#a78bfa'
    };

    function formatSignedPercentage(value, digits = 1) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return 'N/A';
        const sign = numeric > 0 ? '+' : '';
        return `${sign}${numeric.toFixed(digits)}%`;
    }

    function getApiHealthStatusClass(level) {
        const normalized = String(level || '').toLowerCase();
        if (normalized === 'bad' || normalized === 'error') return 'bad';
        if (normalized === 'warn' || normalized === 'warning') return 'warn';
        return 'good';
    }

    function getApiHealthProviderColor(key) {
        return API_HEALTH_PROVIDER_COLORS[key] || '#64748b';
    }

    function destroyApiHealthCharts() {
        if (apiHealthTrendChart) {
            apiHealthTrendChart.destroy();
            apiHealthTrendChart = null;
        }
        if (apiHealthExecutionChart) {
            apiHealthExecutionChart.destroy();
            apiHealthExecutionChart = null;
        }
        if (apiHealthProviderChart) {
            apiHealthProviderChart.destroy();
            apiHealthProviderChart = null;
        }
    }

    function renderApiHealthLead(summary, monitoring, alerts) {
        const leadEl = document.getElementById('apiHealthLead');
        if (!leadEl) return;
        const level = getApiHealthStatusClass(summary?.healthStatus);
        const dominantLabel = summary?.dominantProvider?.label || 'No dominant provider yet';
        const dominantShare = Number.isFinite(Number(summary?.dominantProvider?.sharePct))
            ? `${Number(summary.dominantProvider.sharePct).toFixed(1)}% share`
            : 'share unavailable';
        const failureNote = monitoring?.available
            ? (Number.isFinite(Number(monitoring.errorRatePct))
                ? `Execution failures are at ${Number(monitoring.errorRatePct).toFixed(2)}% over the window.`
                : 'Execution totals are available, but failure breakdown is incomplete.')
            : 'Cloud Monitoring execution overlay is unavailable, so this view is using the existing provider rollups only.';
        const alertNote = Array.isArray(alerts) && alerts.length
            ? alerts[0].detail
            : 'No immediate spike, concentration, or traffic-drop alerts were detected in the current window.';

        leadEl.dataset.level = level;
        leadEl.innerHTML = `<strong>Scope:</strong> Provider/API traffic, request failures, and inferred overage risk. Scheduler queue, cycle, and dead-letter health stays in the Scheduler tab.<br><strong>Current mix:</strong> ${escapeHtml(dominantLabel)} leads with ${escapeHtml(dominantShare)}.<br><strong>Health:</strong> ${escapeHtml(failureNote)}<br><strong>Watch:</strong> ${escapeHtml(alertNote)}`;
    }

    function renderAlphaEssObservability(observability, providers) {
        const summaryEl = document.getElementById('apiHealthAlphaEssSummary');
        const badgesEl = document.getElementById('apiHealthAlphaEssBadges');
        const checkWhenEl = document.getElementById('apiHealthAlphaEssCheckWhen');
        const lookForEl = document.getElementById('apiHealthAlphaEssLookFor');
        const costEl = document.getElementById('apiHealthAlphaEssCost');
        const rollbackEl = document.getElementById('apiHealthAlphaEssRollback');
        const footnoteEl = document.getElementById('apiHealthAlphaEssFootnote');
        if (!summaryEl || !badgesEl || !checkWhenEl || !lookForEl || !costEl || !rollbackEl || !footnoteEl) return;

        const alpha = observability && typeof observability === 'object' && observability.alphaess && typeof observability.alphaess === 'object'
            ? observability.alphaess
            : null;
        const alphaProvider = Array.isArray(providers)
            ? providers.find((provider) => String(provider?.key || '').toLowerCase() === 'alphaess')
            : null;

        if (!alpha || alpha.enabled !== true) {
            summaryEl.textContent = 'AlphaESS observability guidance is currently unavailable.';
            badgesEl.innerHTML = '';
            checkWhenEl.innerHTML = '<li>No AlphaESS guidance published yet.</li>';
            lookForEl.innerHTML = '<li>No AlphaESS anomaly catalogue is published yet.</li>';
            costEl.innerHTML = '<li>No AlphaESS cost guidance is published yet.</li>';
            rollbackEl.innerHTML = '<li>No rollback guidance is published yet.</li>';
            footnoteEl.textContent = 'This panel remains passive and does not create extra provider traffic.';
            return;
        }

        const alphaCalls = alphaProvider ? Number(alphaProvider.totalCalls || 0) : 0;
        const alphaLastDayCalls = alphaProvider ? Number(alphaProvider.lastDayCalls || 0) : 0;
        summaryEl.innerHTML = `Low-cost AlphaESS observability is active. <strong>Live realtime reads</strong> only log when an anomaly is detected, while <strong>manual deep diagnostics</strong> always log because they are operator-triggered. In the selected API-health window AlphaESS accounts for <strong>${escapeHtml(formatCompactNumber(alphaCalls))}</strong> provider calls, with <strong>${escapeHtml(formatCompactNumber(alphaLastDayCalls))}</strong> in the last day.`;

        badgesEl.innerHTML = [
            `<span class="api-health-observability-pill"><strong>Live</strong> ${escapeHtml(String(alpha.liveRealtimeLogging || 'unknown'))}</span>`,
            `<span class="api-health-observability-pill"><strong>Manual</strong> ${escapeHtml(String(alpha.manualDiagnosticsLogging || 'unknown'))}</span>`,
            `<span class="api-health-observability-pill"><strong>Extra provider calls</strong> ${escapeHtml(String(alpha.extraProviderCallsPerRequest || 0))}</span>`,
            `<span class="api-health-observability-pill"><strong>Firestore writes</strong> ${escapeHtml(String(alpha.extraFirestoreWritesPerRequest || 0))}</span>`
        ].join('');

        const watchWhen = Array.isArray(alpha.watchWhen) ? alpha.watchWhen : [];
        checkWhenEl.innerHTML = watchWhen.length
            ? watchWhen.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
            : '<li>No AlphaESS timing guidance published.</li>';

        const anomalyCodes = Array.isArray(alpha.anomalyCodes) ? alpha.anomalyCodes : [];
        lookForEl.innerHTML = anomalyCodes.length
            ? anomalyCodes.map((item) => `<li><span class="api-health-observability-code">${escapeHtml(item.code || 'code')}</span>${escapeHtml(item.lookFor || item.title || '')}</li>`).join('')
            : '<li>No AlphaESS anomaly catalogue published.</li>';

        const costItems = [];
        if (Array.isArray(alpha.notes)) costItems.push(...alpha.notes);
        costItems.push(`Extra provider calls per request: ${Number(alpha.extraProviderCallsPerRequest || 0)}.`);
        costItems.push(`Extra Firestore writes per request: ${Number(alpha.extraFirestoreWritesPerRequest || 0)}.`);
        costEl.innerHTML = costItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('');

        const rollbackItems = [];
        if (alpha.rollback?.summary) rollbackItems.push(alpha.rollback.summary);
        if (alpha.rollback?.docsPath) rollbackItems.push(`Runbook: ${alpha.rollback.docsPath}`);
        rollbackEl.innerHTML = rollbackItems.length
            ? rollbackItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
            : '<li>No rollback guidance published.</li>';

        footnoteEl.textContent = 'Operator workflow: check this panel first, then inspect AlphaESSDiagnostics logs only when one of the listed watch conditions is true or the user reports an impossible power-flow reading.';
    }

    function renderApiHealthTrendChart(daily) {
        const canvas = document.getElementById('apiHealthTrendChart');
        if (!canvas || typeof Chart !== 'function') return;

        if (apiHealthTrendChart) {
            apiHealthTrendChart.destroy();
            apiHealthTrendChart = null;
        }

        const palette = getChartPalette();
        const labels = daily.map((row) => String(row.date || '').slice(5));
        const providerCalls = daily.map((row) => Number(row.totalCalls || 0));

        const datasets = [{
            type: 'line',
            label: 'Provider calls',
            data: providerCalls,
            borderColor: palette.accentBlue,
            backgroundColor: withAlpha(palette.accentBlue, 0.14),
            fill: true,
            borderWidth: 2,
            pointRadius: 2,
            tension: 0.28,
            yAxisID: 'y'
        }];

        apiHealthTrendChart = new Chart(canvas, {
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        labels: {
                            color: palette.textSecondary,
                            boxWidth: 12,
                            usePointStyle: true,
                            pointStyle: 'circle'
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: palette.textSecondary, maxTicksLimit: 10 },
                        grid: { color: withAlpha(palette.textSecondary, 0.08) }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { color: palette.textSecondary, precision: 0 },
                        grid: { color: withAlpha(palette.textSecondary, 0.08) }
                    }
                }
            }
        });
    }

    function renderApiHealthExecutionChart(daily) {
        const canvas = document.getElementById('apiHealthExecutionChart');
        if (!canvas || typeof Chart !== 'function') return;

        if (apiHealthExecutionChart) {
            apiHealthExecutionChart.destroy();
            apiHealthExecutionChart = null;
        }

        const labels = daily.map((row) => String(row.date || '').slice(5));
        const requestExecutions = daily.map((row) => Number(row.requestExecutions || 0));
        const errorExecutions = daily.map((row) => row.errorExecutions == null ? null : Number(row.errorExecutions || 0));
        const hasRequestExecutions = daily.some((row) => Number(row.requestExecutions || 0) > 0);
        const hasErrorExecutions = daily.some((row) => row.errorExecutions != null);
        const palette = getChartPalette();

        if (!hasRequestExecutions && !hasErrorExecutions) {
          return;
        }

        const datasets = [];
        if (hasRequestExecutions) {
            datasets.push({
                type: 'line',
                label: 'Function executions',
                data: requestExecutions,
                borderColor: palette.accentGreen,
                backgroundColor: withAlpha(palette.accentGreen, 0.08),
                borderWidth: 2,
                pointRadius: 2,
                tension: 0.24,
                yAxisID: 'yExecutions'
            });
        }

        if (hasErrorExecutions) {
            datasets.push({
                type: 'bar',
                label: 'Failed executions',
                data: errorExecutions,
                backgroundColor: withAlpha('#f87171', 0.72),
                borderColor: '#f87171',
                borderWidth: 1,
                borderRadius: 8,
                maxBarThickness: 28,
                yAxisID: 'yFailures'
            });
        }

        apiHealthExecutionChart = new Chart(canvas, {
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        labels: {
                            color: palette.textSecondary,
                            boxWidth: 12,
                            usePointStyle: true,
                            pointStyle: 'circle'
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: palette.textSecondary, maxTicksLimit: 10 },
                        grid: { color: withAlpha(palette.textSecondary, 0.08) }
                    },
                    yExecutions: {
                        type: 'linear',
                        position: 'left',
                        beginAtZero: true,
                        ticks: { color: palette.accentGreen, precision: 0 },
                        grid: { color: withAlpha(palette.textSecondary, 0.08) }
                    },
                    yFailures: {
                        type: 'linear',
                        position: 'right',
                        beginAtZero: true,
                        ticks: { color: '#f87171', precision: 0 },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });
    }

    function renderApiHealthProviderChart(providers, summary) {
        const canvas = document.getElementById('apiHealthProviderChart');
        if (!canvas || typeof Chart !== 'function') return;

        if (apiHealthProviderChart) {
            apiHealthProviderChart.destroy();
            apiHealthProviderChart = null;
        }

        const palette = getChartPalette();
        const safeProviders = Array.isArray(providers) && providers.length
            ? providers
            : [{ key: 'none', label: 'No usage yet', totalCalls: 1, sharePct: 100 }];
        const labels = safeProviders.map((provider) => provider.label || provider.key || 'Unknown');
        const values = safeProviders.map((provider) => Number(provider.totalCalls || 0));
        const colors = safeProviders.map((provider) => getApiHealthProviderColor(provider.key));

        apiHealthProviderChart = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors,
                    borderColor: withAlpha(palette.surface, 1),
                    borderWidth: 2,
                    hoverOffset: 6
                }]
            },
            options: {
                ...createDoughnutOptions(safeProviders),
                plugins: {
                    ...createDoughnutOptions(safeProviders).plugins,
                    centerLabel: {
                        value: formatCompactNumber(summary?.totalCalls || 0),
                        sub: 'provider calls'
                    }
                }
            },
            plugins: [doughnutCenterPlugin]
        });
    }

    function renderApiHealthAlerts(alerts, warnings) {
        const alertsEl = document.getElementById('apiHealthAlerts');
        if (!alertsEl) return;
        const safeAlerts = Array.isArray(alerts) ? alerts : [];
        const safeWarnings = Array.isArray(warnings) ? warnings.filter(Boolean) : [];

        if (!safeAlerts.length && !safeWarnings.length) {
            alertsEl.innerHTML = '<div class="api-health-empty">No active API health alerts. Provider traffic, concentration, and request-failure checks are currently within expected bounds.</div>';
            return;
        }

        const alertRows = safeAlerts.map((alert) => {
            const levelClass = getApiHealthStatusClass(alert.level);
            return `<div class="api-health-alert ${levelClass}"><div class="api-health-alert-head"><span class="api-health-badge ${levelClass}">${escapeHtml(String(alert.level || 'info').toUpperCase())}</span><strong>${escapeHtml(alert.title || 'Alert')}</strong></div><div class="api-health-alert-body">${escapeHtml(alert.detail || '')}</div></div>`;
        });
        const warningRows = safeWarnings.map((warning) => `<div class="api-health-alert warn"><div class="api-health-alert-head"><span class="api-health-badge warn">NOTE</span><strong>Visibility gap</strong></div><div class="api-health-alert-body">${escapeHtml(warning)}</div></div>`);
        alertsEl.innerHTML = alertRows.concat(warningRows).join('');
    }

    function humanizeApiHealthKey(value) {
        const normalized = String(value || '').trim();
        if (!normalized) return 'Other';
        return normalized
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/[\s_-]+/g, ' ')
            .split(' ')
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
            .join(' ');
    }

    function normalizeApiHealthEvBreakdownLabel(key) {
        const normalized = String(key || '').trim().toLowerCase();
        if (!normalized) return 'Other';
        if (/wake/.test(normalized)) return 'Wake';
        if (/command|signed/.test(normalized)) return 'Command';
        if (/data|status|vehicle|telemetry/.test(normalized)) return 'Data';
        return humanizeApiHealthKey(key);
    }

    function formatApiHealthTeslaBreakdown(row) {
        // Always render Wake/Command/Data counts as plain integers in the format x/y/z.
        const rawBreakdown = row && row.evBreakdown && typeof row.evBreakdown === 'object'
            ? row.evBreakdown
            : {};
        const grouped = new Map();

        Object.entries(rawBreakdown).forEach(([key, value]) => {
            const count = Number(value || 0);
            if (!Number.isFinite(count) || count <= 0) return;
            const label = normalizeApiHealthEvBreakdownLabel(key);
            grouped.set(label, (grouped.get(label) || 0) + count);
        });

        const totalNumeric = Number(row?.categories?.ev || 0);
        const wake = grouped.get('Wake') || 0;
        const command = grouped.get('Command') || 0;
        const data = grouped.get('Data') || 0;

        // If breakdown was empty but a total exists, place the total in the first position (Wake) for visibility.
        const outWake = (wake || command || data) ? wake : (totalNumeric || 0);

        return `<span class="api-health-cell-primary">${escapeHtml(String(outWake))}/${escapeHtml(String(command))}/${escapeHtml(String(data))}</span>`;
    }

    function renderApiHealthProviderTable(providers) {
        const body = document.getElementById('apiHealthProvidersBody');
        const empty = document.getElementById('apiHealthProvidersEmpty');
        if (!body || !empty) return;

        if (!Array.isArray(providers) || !providers.length) {
            body.innerHTML = '';
            empty.style.display = '';
            return;
        }

        body.innerHTML = providers.map((provider) => `
            <tr>
                <td data-label="Provider"><span class="api-health-provider-dot" style="background:${getApiHealthProviderColor(provider.key)}"></span>${escapeHtml(provider.label || provider.key || 'Unknown')}</td>
                <td data-label="Window Calls">${escapeHtml(formatCompactNumber(provider.totalCalls || 0))}</td>
                <td data-label="Share">${escapeHtml(formatPercentage(provider.sharePct || 0, 1))}</td>
                <td data-label="Last Day">${escapeHtml(formatCompactNumber(provider.lastDayCalls || 0))}</td>
                <td data-label="7d Avg">${escapeHtml(formatCompactNumber(Math.round(provider.avgDailyCalls7d || 0)))}</td>
                <td data-label="Trend">${escapeHtml(formatSignedPercentage(provider.trendPct, 1))}</td>
            </tr>`).join('');
        empty.style.display = 'none';
    }

    function renderApiHealthDailyTable(daily) {
        const body = document.getElementById('apiHealthDailyBody');
        const empty = document.getElementById('apiHealthDailyEmpty');
        if (!body || !empty) return;

        const safeDaily = Array.isArray(daily) ? daily.slice(-14).reverse() : [];
        if (!safeDaily.length) {
            body.innerHTML = '';
            empty.style.display = '';
            return;
        }

        body.innerHTML = safeDaily.map((row) => `
            <tr>
                <td data-label="Date"><span class="api-health-cell-primary">${escapeHtml(row.date || '-')}</span></td>
                <td data-label="Provider Calls"><span class="api-health-cell-primary">${escapeHtml(formatCompactNumber(row.totalCalls || 0))}</span></td>
                <td data-label="Inverter">${escapeHtml(formatCompactNumber(row.categories?.inverter || 0))}</td>
                <td data-label="Pricing">${escapeHtml(formatCompactNumber(row.categories?.amber || 0))}</td>
                <td data-label="Weather">${escapeHtml(formatCompactNumber(row.categories?.weather || 0))}</td>
                <td data-label="Tesla EV">${formatApiHealthTeslaBreakdown(row)}</td>
                <td data-label="Executions">${row.requestExecutions == null ? '-' : escapeHtml(formatCompactNumber(row.requestExecutions || 0))}</td>
                <td data-label="Errors">${row.errorExecutions == null ? '-' : escapeHtml(formatCompactNumber(row.errorExecutions || 0))}</td>
            </tr>`).join('');
        empty.style.display = 'none';
    }

    async function loadApiHealth(options = {}) {
        const updatedEl = document.getElementById('apiHealthUpdated');
        const warningEl = document.getElementById('apiHealthWarning');
        const refreshBtn = document.getElementById('refreshApiHealthBtn');
        if (!adminApiClient || !updatedEl || !warningEl) return;

        if (refreshBtn) refreshBtn.disabled = true;
        updatedEl.textContent = 'Loading API health...';
        warningEl.style.display = 'none';
        warningEl.textContent = '';

        try {
            const days = 30;
            let data;
            if (typeof adminApiClient.getAdminApiHealth === 'function') {
                data = await adminApiClient.getAdminApiHealth(days, options.force === true);
            } else {
                const query = new URLSearchParams({ days: String(days) });
                if (options.force) query.set('refresh', '1');
                const resp = await adminApiClient.fetch(`/api/admin/api-health?${query.toString()}`);
                data = await resp.json();
            }
            if (!data || data.errno !== 0) throw new Error(data?.error || 'Failed to load API health');

            const result = data.result || {};
            apiHealthData = result;
            const summary = result.summary || {};
            const monitoring = result.monitoring || {};
            const providers = Array.isArray(result.providers) ? result.providers : [];
            const daily = Array.isArray(result.daily) ? result.daily : [];
            const alerts = Array.isArray(result.alerts) ? result.alerts : [];
            const warnings = Array.isArray(result.warnings) ? result.warnings : [];
            const observability = result.observability && typeof result.observability === 'object' ? result.observability : {};

            document.getElementById('apiHealthTotalCalls').textContent = formatCompactNumber(summary.totalCalls || 0);
            document.getElementById('apiHealthLastDayCalls').textContent = formatCompactNumber(summary.lastDayCalls || 0);
            document.getElementById('apiHealthDailyAvg').textContent = `${formatCompactNumber(Math.round(summary.callsAvg7d || 0))}/d`;
            document.getElementById('apiHealthDominantProvider').textContent = summary.dominantProvider?.label || 'None';
            document.getElementById('apiHealthDominantProviderMeta').textContent = summary.dominantProvider
                ? `${formatPercentage(summary.dominantProvider.sharePct || 0, 1)} of tracked calls`
                : 'No tracked provider calls yet';
            document.getElementById('apiHealthExecutions').textContent = monitoring.available
                ? formatCompactNumber(monitoring.requestExecutionsTotal || 0)
                : 'Unavailable';
            document.getElementById('apiHealthErrorRate').textContent = monitoring.available && monitoring.errorRatePct != null
                ? formatPercentage(monitoring.errorRatePct || 0, 2)
                : 'Unavailable';
            document.getElementById('apiHealthErrorRateMeta').textContent = summary.callsPerExecution != null
                ? `${Number(summary.callsPerExecution).toFixed(2)} calls per execution`
                : 'Execution overlay unavailable';

            renderApiHealthLead(summary, monitoring, alerts);
            renderAlphaEssObservability(observability, providers);
            renderApiHealthTrendChart(daily);
            renderApiHealthExecutionChart(daily);
            renderApiHealthProviderChart(providers, summary);
            renderApiHealthAlerts(alerts, warnings);
            renderApiHealthProviderTable(providers);
            renderApiHealthDailyTable(daily);

            const updatedAt = result.updatedAt ? new Date(result.updatedAt) : new Date();
            updatedEl.textContent = `Last updated ${updatedAt.toLocaleDateString('en-AU')} ${updatedAt.toLocaleTimeString('en-AU')} · window ${Number(result.window?.days || 30)} days · scheduler-specific orchestration issues stay in Scheduler`;

            if (warnings.length) {
                warningEl.style.display = '';
                warningEl.textContent = warnings.join(' · ');
            }
        } catch (e) {
            console.error('[Admin] Failed to load API health:', e);
            destroyApiHealthCharts();
            renderAlphaEssObservability({}, []);
            renderApiHealthAlerts([], [e.message || String(e)]);
            renderApiHealthProviderTable([]);
            renderApiHealthDailyTable([]);
            updatedEl.textContent = 'Unable to load API health';
            warningEl.style.display = '';
            warningEl.textContent = e.message || String(e);
            showMessage('warning', `Failed to load API health: ${e.message || e}`);
        } finally {
            if (refreshBtn) refreshBtn.disabled = false;
        }
    }

    async function loadDataworks(options = {}) {
        const updatedEl = document.getElementById('dataworksUpdated');
        const refreshBtn = document.getElementById('refreshDataworksBtn');
        const dispatchBtn = document.getElementById('triggerDataworksRunBtn');
        const statusEl = document.getElementById('dataworksPipelineStatus');
        const rowsEl = document.getElementById('dataworksRowsProcessed');
        const filesEl = document.getElementById('dataworksFilesIngested');
        const workflowStatusEl = document.getElementById('dataworksWorkflowStatus');
        const leadEl = document.getElementById('dataworksLead');
        const pipelinePanel = document.getElementById('dataworksPipelinePanel');
        const qualityPanel = document.getElementById('dataworksQualityPanel');
        const footprintPanel = document.getElementById('dataworksFootprintPanel');
        const regionsPanel = document.getElementById('dataworksRegionsPanel');
        const workflowRunsPanel = document.getElementById('dataworksWorkflowRunsPanel');
        const opsPanel = document.getElementById('dataworksOpsPanel');

        if (!adminApiClient || !updatedEl || !statusEl || !rowsEl || !filesEl || !workflowStatusEl || !leadEl || !pipelinePanel || !qualityPanel || !footprintPanel || !regionsPanel || !workflowRunsPanel || !opsPanel) return;

        if (refreshBtn) refreshBtn.disabled = true;
        if (dispatchBtn) {
            dispatchBtn.disabled = true;
            dispatchBtn.textContent = 'Run historical';
            dispatchBtn.title = 'Loading historical workflow controls...';
        }
        updatedEl.textContent = 'Loading NEM data jobs...';
        leadEl.textContent = 'Loading NEM pipeline details...';
        statusEl.textContent = '-';
        rowsEl.textContent = '-';
        filesEl.textContent = '-';
        workflowStatusEl.textContent = '-';
        pipelinePanel.innerHTML = '<div class="dataworks-empty">Loading NEM jobs overview...</div>';
        qualityPanel.innerHTML = '<div class="dataworks-empty">Loading live AEMO snapshots...</div>';
        footprintPanel.innerHTML = '<div class="dataworks-empty">Loading historical bundle...</div>';
        regionsPanel.innerHTML = '<div class="dataworks-empty">Loading live region health...</div>';
        workflowRunsPanel.innerHTML = '<div class="dataworks-empty">Loading historical workflow history...</div>';
        opsPanel.innerHTML = '<div class="dataworks-empty">Loading historical workflow controls...</div>';

        try {
            const [marketResult, opsResult] = await Promise.allSettled([
                fetchDataworksIndex(),
                fetchDataworksOpsSummary(options.forceOps === true)
            ]);

            const marketSummary = marketResult.status === 'fulfilled'
                ? deriveDataworksMarketSummary(marketResult.value)
                : null;
            const opsSummary = opsResult.status === 'fulfilled'
                ? deriveDataworksOpsSummary(opsResult.value)
                : null;

            if (!marketSummary && !opsSummary) {
                throw new Error('Failed to load DataWorks summary and workflow diagnostics');
            }

            const liveAemo = opsSummary?.liveAemo || null;
            const releaseGuard = summarizeReleaseGuard(opsSummary?.releaseAlignment || null);
            const overallStatus = buildDataworksOverallStatus({ marketSummary, liveAemo, opsSummary });
            const latestMarketDate = marketSummary?.latestDate || null;
            const historicalText = latestMarketDate
                ? `${formatDateShort(latestMarketDate)}${marketSummary?.dataAgeDays !== null ? ` · ${formatDayAge(marketSummary.dataAgeDays)}` : ''}`
                : 'Unavailable';
            const latestWorkflowRun = opsSummary?.latestRun?.createdAt || opsSummary?.latestRun?.updatedAt
                ? formatRelativeTime(opsSummary.latestRun.createdAt || opsSummary.latestRun.updatedAt)
                : '-';
            const workflowStatusLabel = opsSummary?.badge?.label || 'Unavailable';
            const liveAemoText = liveAemo?.latestAsOf
                ? `${liveAemo?.status?.label || 'Live'} · ${formatRelativeTime(liveAemo.latestAsOf)}`
                : (liveAemo?.status?.label || 'Unavailable');
            const workflowKpiText = opsSummary
                ? (releaseGuard.level === 'warn'
                    ? `${workflowStatusLabel} · ${releaseGuard.label}`
                    : (latestWorkflowRun !== '-' ? `${workflowStatusLabel} · ${latestWorkflowRun}` : workflowStatusLabel))
                : 'Unavailable';

            statusEl.textContent = overallStatus.label || 'Unavailable';
            rowsEl.textContent = historicalText;
            filesEl.textContent = liveAemoText;
            workflowStatusEl.textContent = workflowKpiText;

            const leadParts = [];
            if (marketSummary) {
                const historicalReason = Array.isArray(marketSummary.status?.reasons) && marketSummary.status.reasons.length
                    ? marketSummary.status.reasons.join(' · ')
                    : 'historical bundle is publishing cleanly.';
                leadParts.push(`<strong>Historical ${escapeHtml(marketSummary.status?.label || 'Bundle')}</strong> ${escapeHtml(historicalReason)}`);
            }
            if (releaseGuard.level === 'warn' && releaseGuard.reason) {
                leadParts.push(`<strong>Manual historical runs ${escapeHtml(releaseGuard.label.toLowerCase())}</strong> ${escapeHtml(releaseGuard.reason)}`);
            } else if (opsSummary?.latestRun) {
                if (opsSummary.latestFailedStep?.name) {
                    leadParts.push(`<strong>Historical workflow ${escapeHtml(opsSummary.badge.label)}</strong> latest run failed at ${escapeHtml(opsSummary.latestFailedStep.name)}.`);
                } else if (opsSummary.latestRun.status && String(opsSummary.latestRun.status).toLowerCase() !== 'completed') {
                    leadParts.push(`<strong>Historical workflow Running</strong> latest run is ${escapeHtml(formatStatusLabel(opsSummary.latestRun.status))}.`);
                } else {
                    leadParts.push(`<strong>Historical workflow ${escapeHtml(opsSummary.badge.label)}</strong> latest run is ${escapeHtml(formatStatusLabel(opsSummary.latestRun.conclusion || opsSummary.latestRun.status || 'unknown'))}.`);
                }
            }
            if (liveAemo) {
                const liveReason = Array.isArray(liveAemo.status?.reasons) && liveAemo.status.reasons.length
                    ? liveAemo.status.reasons.join(' · ')
                    : `scheduler snapshots are ${String(liveAemo.status?.label || 'available').toLowerCase()} across ${Number(liveAemo.freshRegions || 0)}/${Number(liveAemo.expectedRegionCount || 5)} regions.`;
                leadParts.push(`<strong>Live AEMO ${escapeHtml(liveAemo.status?.label || 'Snapshots')}</strong> ${escapeHtml(liveReason)}`);
            }
            leadEl.innerHTML = leadParts.length
                ? leadParts.join(' ')
                : 'Published historical metadata and live AEMO snapshot diagnostics are available.';

            const kpiEls = document.querySelectorAll('#dataworksKpis .kpi-item');
            if (kpiEls[0]) kpiEls[0].dataset.level = dataworksTone(overallStatus.level || 'neutral');
            if (kpiEls[1]) kpiEls[1].dataset.level = dataworksTone(marketSummary?.status?.level || 'neutral');
            if (kpiEls[2]) kpiEls[2].dataset.level = dataworksTone(liveAemo?.status?.level || 'neutral');
            if (kpiEls[3]) kpiEls[3].dataset.level = dataworksTone(releaseGuard.level === 'warn' ? releaseGuard.level : (opsSummary?.badge?.level || 'neutral'));
            leadEl.dataset.level = dataworksTone(overallStatus.level || 'neutral');

            const dispatchLabel = opsSummary?.dispatchEnabled ? 'Available' : 'Read-only';
            const dispatchMeta = opsSummary
                ? (opsSummary.dispatchReason || `cooldown ${Math.round((opsSummary.dispatchCooldownMs || 0) / 1000)}s`)
                : 'GitHub diagnostics unavailable';

            pipelinePanel.innerHTML = renderDataworksPanel(
                'NEM Jobs',
                '🧭',
                renderDataworksBadge(overallStatus.label || 'Unknown', overallStatus.level),
                `<div class="dataworks-metric-list">
                    ${renderDataworksMetricRow('Live AEMO snapshots', liveAemo?.status?.label || 'Unavailable', liveAemo ? `scheduler every ${Number(liveAemo.schedule?.cadenceMinutes || 5)}m with ${Number(liveAemo.schedule?.lagMinutes || 1)}m lag · ${Number(liveAemo.freshRegions || 0)}/${Number(liveAemo.expectedRegionCount || 5)} fresh` : 'Firestore snapshot health unavailable')}
                    ${renderDataworksMetricRow('Historical bundle', marketSummary?.status?.label || 'Unavailable', historicalText)}
                    ${renderDataworksMetricRow('Historical workflow', workflowStatusLabel, releaseGuard.reason ? `${releaseGuard.label} · ${releaseGuard.reason}` : (latestWorkflowRun !== '-' ? `latest run ${latestWorkflowRun}` : 'No recent workflow run'))}
                    ${renderDataworksMetricRow('Manual historical runs', dispatchLabel, dispatchMeta)}
                </div>
                <div class="dataworks-note-list" style="margin-top:10px;">
                    <div class="dataworks-note"><strong>Sources:</strong> hosted market-insights index, Firestore <code>aemoSnapshots/*</code>, and cached GitHub Actions diagnostics.</div>
                    <div class="dataworks-note"><strong>Live path:</strong> dashboard and automation now read stored AEMO snapshots only; this tab does not trigger upstream AEMO refreshes.</div>
                </div>`,
                'High-level view of live and historical NEM data jobs.'
            );

            if (liveAemo) {
                qualityPanel.innerHTML = renderDataworksPanel(
                    'Live AEMO',
                    '⚡',
                    renderDataworksBadge(liveAemo.status?.label || 'Unknown', liveAemo.status?.level),
                    `<div class="dataworks-metric-list">
                        ${renderDataworksMetricRow('Scheduler', `Every ${Number(liveAemo.schedule?.cadenceMinutes || 5)}m`, `${Number(liveAemo.schedule?.lagMinutes || 1)}m lag · ${liveAemo.schedule?.timeZone || 'Australia/Brisbane'}`)}
                        ${renderDataworksMetricRow('Latest interval', liveAemo.latestAsOf ? formatRelativeTime(liveAemo.latestAsOf) : '-', liveAemo.latestAsOf ? `as of ${formatDate(liveAemo.latestAsOf)}` : 'No stored intervals yet')}
                        ${renderDataworksMetricRow('Region freshness', `${Number(liveAemo.freshRegions || 0)}/${Number(liveAemo.expectedRegionCount || 5)} fresh`, `${Number(liveAemo.watchRegions || 0)} watch · ${Number(liveAemo.staleRegions || 0)} stale · ${Number(liveAemo.missingRegions || 0)} missing`)}
                        ${renderDataworksMetricRow('Forecast horizon', formatMinutesCompact(liveAemo.maxForecastHorizonMinutes || liveAemo.minForecastHorizonMinutes || 0), liveAemo.minForecastHorizonMinutes && liveAemo.maxForecastHorizonMinutes && liveAemo.minForecastHorizonMinutes !== liveAemo.maxForecastHorizonMinutes ? `min ${formatMinutesCompact(liveAemo.minForecastHorizonMinutes)}` : `${Number(liveAemo.forecastCompleteRegions || 0)}/${Number(liveAemo.expectedRegionCount || 5)} forecast-complete`)}
                        ${renderDataworksMetricRow('Snapshot footprint', formatCompactNumber(liveAemo.totalRows || 0), `${liveAemo.source || 'firestore:aemoSnapshots'} · scheduler-only`)}
                    </div>`,
                    'Scheduler-backed live and forecast price snapshots used by dashboard and automation.'
                );
            } else {
                qualityPanel.innerHTML = '<div class="dataworks-empty">Live AEMO snapshot diagnostics unavailable.</div>';
            }

            if (marketSummary) {
                const coverageWindow = marketSummary.bounds?.minPeriod && marketSummary.bounds?.maxPeriod
                    ? `${marketSummary.bounds.minPeriod} to ${marketSummary.bounds.maxPeriod}`
                    : '';
                const issueRegions = Array.isArray(marketSummary.quality?.issueRegions) ? marketSummary.quality.issueRegions : [];
                footprintPanel.innerHTML = renderDataworksPanel(
                    'Historical Bundle',
                    '📦',
                    renderDataworksBadge(marketSummary.status?.label || 'Unknown', marketSummary.status?.level),
                    `<div class="dataworks-metric-list">
                        ${renderDataworksMetricRow('Published', formatRelativeTime(marketSummary.generatedAt), marketSummary.generatedAt ? `index generated ${formatDate(marketSummary.generatedAt)}` : '')}
                        ${renderDataworksMetricRow('Source aggregate', formatRelativeTime(marketSummary.sourceGeneratedAt), marketSummary.sourceGeneratedAt ? `aggregate manifest ${formatDate(marketSummary.sourceGeneratedAt)}` : '')}
                        ${renderDataworksMetricRow('Latest market date', formatDateShort(marketSummary.latestDate), marketSummary.dataAgeDays !== null ? `${formatDayAge(marketSummary.dataAgeDays)} behind UTC` : '')}
                        ${renderDataworksMetricRow('Coverage window', marketSummary.latestPeriod || '-', coverageWindow)}
                        ${renderDataworksMetricRow('Quality', formatPercentage(marketSummary.quality?.recentAverageCoveragePct, 2), marketSummary.quality?.recentAverageQualityScore != null ? `score ${Number(marketSummary.quality.recentAverageQualityScore).toFixed(2)} · issues ${formatCompactNumber(marketSummary.quality?.issuePeriods || 0)}` : 'Quality summary unavailable')}
                        ${renderDataworksMetricRow('Files / assets', `${formatCompactNumber(marketSummary.files?.rawCsvFiles || 0)} / ${formatCompactNumber(marketSummary.files?.publishedAssetCount || 0)}`, marketSummary.files?.hourlyRows ? `${formatCompactNumber(marketSummary.files.hourlyRows)} hourly rows in aggregates` : '')}
                    </div>
                    ${issueRegions.length ? `<div class="dataworks-inline-list">${issueRegions.map((region) => `<span class="dataworks-chip">${escapeHtml(region)}</span>`).join('')}</div>` : ''}`,
                    'Hosted static market-insights bundle for historical NEM analysis.'
                );
            } else {
                footprintPanel.innerHTML = '<div class="dataworks-empty">Static market-insights metadata unavailable.</div>';
            }

            const liveRegionRows = Array.isArray(liveAemo?.regions) ? liveAemo.regions : [];
            regionsPanel.innerHTML = renderDataworksPanel(
                'Live Region Health',
                '🗺️',
                renderDataworksBadge(`${liveRegionRows.length || 0} regions`, liveAemo?.status?.level || 'neutral'),
                liveRegionRows.length
                    ? `<div class="dataworks-table-wrap"><table class="dataworks-table"><thead><tr><th>Region</th><th>As Of</th><th>Stored</th><th>Forecast</th><th>Status</th></tr></thead><tbody>${liveRegionRows.map((row) => `<tr><td>${escapeHtml(row.regionCode || row.regionId || '-')}</td><td>${escapeHtml(row.asOf ? formatDate(row.asOf) : '-')}</td><td>${escapeHtml(row.storedAt ? formatRelativeTime(row.storedAt) : '-')}</td><td>${escapeHtml(formatMinutesCompact(row.forecastHorizonMinutes || 0))}</td><td>${renderDataworksBadge(row.statusLabel || 'Unknown', row.statusLevel || 'neutral')}</td></tr>`).join('')}</tbody></table></div>`
                    : '<div class="dataworks-empty">No stored live AEMO snapshots available.</div>',
                'Per-region freshness for the scheduler-written AEMO snapshots.'
            );

            if (opsSummary) {
                const workflowRuns = Array.isArray(opsSummary.recentRuns) ? opsSummary.recentRuns.slice(0, 5) : [];
                const latestRunLabel = opsSummary.latestRun
                    ? `${formatStatusLabel(opsSummary.latestRun.conclusion || opsSummary.latestRun.status)} · ${formatStatusLabel(opsSummary.latestRun.event || 'manual')}`
                    : 'No workflow runs found';
                const latestStepMeta = opsSummary.latestStep
                    ? `${formatStatusLabel(opsSummary.latestStep.conclusion || opsSummary.latestStep.status)} in latest job`
                    : (opsSummary.latestJob ? `${formatStatusLabel(opsSummary.latestJob.conclusion || opsSummary.latestJob.status)} job` : 'No job detail');
                const workflowLink = opsSummary.latestRun?.htmlUrl || opsSummary.workflow?.htmlUrl || null;
                const cacheMeta = opsSummary.cache?.fetchedAt
                    ? `GitHub metadata ${formatRelativeTime(opsSummary.cache.fetchedAt)}`
                    : 'GitHub metadata fresh on server cache';
                const rateLimitMeta = Number.isFinite(Number(opsSummary.rateLimit?.remaining))
                    ? `API remaining ${Number(opsSummary.rateLimit.remaining)}`
                    : '';

                workflowRunsPanel.innerHTML = renderDataworksPanel(
                    'Historical Workflow Runs',
                    '📜',
                    renderDataworksBadge(workflowRuns.length ? `${workflowRuns.length} runs` : 'No runs', workflowRuns.length ? 'neutral' : 'warn'),
                    workflowRuns.length
                        ? `<div class="dataworks-table-wrap"><table class="dataworks-table"><thead><tr><th>Run</th><th>Status</th><th>Trigger</th><th>Started</th><th>Duration</th></tr></thead><tbody>${workflowRuns.map((run) => `<tr><td>${escapeHtml(String(run.number || '-'))}</td><td>${escapeHtml(formatStatusLabel(run.conclusion || run.status || 'unknown'))}</td><td>${escapeHtml(formatStatusLabel(run.event || 'unknown'))}</td><td>${escapeHtml(formatRelativeTime(run.createdAt || run.updatedAt || null))}</td><td>${escapeHtml(run.durationMs != null ? formatDurationMs(run.durationMs) : '-')}</td></tr>`).join('')}</tbody></table></div>`
                        : '<div class="dataworks-empty">No recent workflow runs available.</div>',
                    'Recent GitHub Actions runs for the historical market-insights pipeline.'
                );

                opsPanel.innerHTML = renderDataworksPanel(
                    'Historical Workflow Ops',
                    '🚀',
                    renderDataworksBadge(releaseGuard.level === 'warn' ? releaseGuard.label : opsSummary.badge.label, releaseGuard.level === 'warn' ? releaseGuard.level : opsSummary.badge.level),
                    `<div class="dataworks-metric-list">
                        ${renderDataworksMetricRow('Workflow', formatStatusLabel(opsSummary.workflow.state), opsSummary.workflow.ref ? `ref ${opsSummary.workflow.ref}` : '')}
                        ${renderDataworksMetricRow('Release guard', releaseGuard.label, releaseGuard.reason || (opsSummary.releaseAlignment?.liveShortCommit ? `live ${opsSummary.releaseAlignment.liveShortCommit}` : 'waiting for release metadata'))}
                        ${renderDataworksMetricRow('Latest run', opsSummary.latestRun ? formatRelativeTime(opsSummary.latestRun.createdAt || opsSummary.latestRun.updatedAt) : '-', latestRunLabel)}
                        ${renderDataworksMetricRow('Latest step', opsSummary.latestStep?.name || '-', latestStepMeta)}
                        ${renderDataworksMetricRow('Last success', opsSummary.lastSuccessfulRun ? formatRelativeTime(opsSummary.lastSuccessfulRun.updatedAt || opsSummary.lastSuccessfulRun.createdAt) : '-', opsSummary.lastSuccessfulRun ? `run #${opsSummary.lastSuccessfulRun.number || '-'}` : 'No recent success')}
                        ${renderDataworksMetricRow('Manual historical run', dispatchLabel, dispatchMeta)}
                    </div>
                    <div class="dataworks-note-list" style="margin-top:10px;">
                        <div class="dataworks-note"><strong>Links:</strong> ${workflowLink ? renderExternalLink(workflowLink, 'Open GitHub workflow') : 'Workflow link unavailable'}.</div>
                        <div class="dataworks-note"><strong>Diagnostics cache:</strong> ${escapeHtml(cacheMeta)}${rateLimitMeta ? ` · ${escapeHtml(rateLimitMeta)}` : ''}</div>
                        <div class="dataworks-note"><strong>Live AEMO:</strong> scheduler-only path; this admin control does not manually refresh live snapshots.</div>
                    </div>`,
                    'GitHub Actions controls and release guard for the historical market-insights workflow.'
                );
            } else {
                workflowRunsPanel.innerHTML = renderDataworksPanel(
                    'Historical Workflow Runs',
                    '📜',
                    renderDataworksBadge('Unavailable', 'warn'),
                    '<div class="dataworks-note-list"><div class="dataworks-note"><strong>Workflow history unavailable:</strong> GitHub diagnostics did not load.</div><div class="dataworks-note"><strong>Cost posture:</strong> DataWorks still reads one hosted historical bundle plus live Firestore snapshots when available.</div></div>'
                );
                opsPanel.innerHTML = '<div class="dataworks-empty">Historical workflow diagnostics unavailable.</div>';
            }

            if (dispatchBtn) {
                const runInProgress = !!opsSummary?.latestRun?.status && String(opsSummary.latestRun.status).toLowerCase() !== 'completed';
                dispatchBtn.disabled = !opsSummary?.dispatchEnabled || runInProgress;
                dispatchBtn.textContent = runInProgress ? 'Historical active' : 'Run historical';
                dispatchBtn.title = runInProgress
                    ? 'A historical DataWorks workflow run is already active.'
                    : (opsSummary?.dispatchEnabled ? 'Trigger the GitHub historical market-insights workflow now.' : (opsSummary?.dispatchReason || 'Manual historical run unavailable.'));
            }

            const updatedParts = [];
            if (liveAemo?.latestStoredAt || liveAemo?.latestAsOf) {
                updatedParts.push(`live AEMO ${formatRelativeTime(liveAemo.latestStoredAt || liveAemo.latestAsOf)}`);
            }
            if (marketSummary?.generatedAt) {
                updatedParts.push(`historical bundle ${formatRelativeTime(marketSummary.generatedAt)}`);
            }
            if (opsSummary?.latestRun?.createdAt || opsSummary?.latestRun?.updatedAt) {
                updatedParts.push(`workflow run ${formatRelativeTime(opsSummary.latestRun.createdAt || opsSummary.latestRun.updatedAt)}`);
            }
            updatedEl.textContent = updatedParts.length
                ? `Last checked ${new Date().toLocaleDateString('en-AU')} ${new Date().toLocaleTimeString('en-AU')} · ${updatedParts.join(' · ')}`
                : `Last checked ${new Date().toLocaleDateString('en-AU')} ${new Date().toLocaleTimeString('en-AU')}`;
        } catch (e) {
            console.error('[Admin] Failed to load DataWorks summary:', e);
            updatedEl.textContent = 'Unable to load NEM data jobs';
            leadEl.textContent = e?.message ? `Error: ${e.message}` : 'Failed to load NEM data jobs';
            statusEl.textContent = 'Unavailable';
            rowsEl.textContent = '-';
            filesEl.textContent = '-';
            workflowStatusEl.textContent = '-';
            pipelinePanel.innerHTML = '<div class="dataworks-empty">Unable to load NEM jobs overview.</div>';
            qualityPanel.innerHTML = '<div class="dataworks-empty">Unable to load live AEMO snapshots.</div>';
            footprintPanel.innerHTML = '<div class="dataworks-empty">Unable to load historical bundle.</div>';
            regionsPanel.innerHTML = '<div class="dataworks-empty">Unable to load live region health.</div>';
            workflowRunsPanel.innerHTML = '<div class="dataworks-empty">Unable to load historical workflow history.</div>';
            opsPanel.innerHTML = '<div class="dataworks-empty">Unable to load historical workflow diagnostics.</div>';
            if (dispatchBtn) {
                dispatchBtn.disabled = true;
                dispatchBtn.textContent = 'Run historical';
                dispatchBtn.title = 'Historical workflow diagnostics unavailable.';
            }
            showMessage('warning', `Failed to load DataWorks summary: ${e.message || e}`);
        } finally {
            if (refreshBtn) refreshBtn.disabled = false;
        }
    }

    async function triggerDataworksDispatch() {
        const dispatchBtn = document.getElementById('triggerDataworksRunBtn');
        if (!adminApiClient || !dispatchBtn) return;
        if (!window.confirm('Trigger the historical market-insights GitHub workflow now?')) return;

        dispatchBtn.disabled = true;
        const originalLabel = dispatchBtn.textContent;
        dispatchBtn.textContent = 'Dispatching...';

        try {
            let data;
            if (typeof adminApiClient.triggerAdminDataworksDispatch === 'function') {
                data = await adminApiClient.triggerAdminDataworksDispatch();
            } else {
                const resp = await adminApiClient.fetch('/api/admin/dataworks/dispatch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                data = await resp.json();
            }

            if (!data || data.errno !== 0) {
                throw new Error(data?.error || 'Failed to dispatch DataWorks workflow');
            }

            const pollDelayMs = Number(data?.result?.recommendedPollAfterMs || 15000);
            showMessage('success', `Queued historical market-insights workflow on ${data?.result?.ref || 'main'}. Refreshing diagnostics shortly...`, 6000);
            window.setTimeout(() => {
                loadDataworks({ forceOps: true });
            }, pollDelayMs);
        } catch (e) {
            showMessage('error', `Failed to trigger historical workflow: ${e.message || e}`);
            dispatchBtn.textContent = originalLabel;
            loadDataworks({ forceOps: true });
        }
    }

    // ==================== Platform Stats ====================
    function updatePlatformStats(users) {
        // Keep KPIs responsive even if trend endpoint temporarily fails.
        document.getElementById('statTotalUsers').textContent = users.length;
        // MAU: users with lastSignedInAt in the current calendar month
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        const mau = users.filter(u => {
            const ts = u.lastSignedInAt;
            if (!ts) return false;
            const ms = typeof ts === 'number' ? ts
                : ts._seconds ? ts._seconds * 1000
                : ts.seconds ? ts.seconds * 1000
                : Date.parse(ts);
            return Number.isFinite(ms) && ms >= monthStart;
        }).length;
        document.getElementById('statMAU').textContent = mau;
        document.getElementById('statAutomationActive').textContent = users.filter(u => u.automationEnabled).length;
        document.getElementById('statConfigured').textContent = users.filter(isUserConfigured).length;
    }

    // ==================== Role Management ====================
    async function setRole(uid, role) {
        const action = role === 'admin' ? 'promote' : 'demote';
        const user = currentUsers.find(u => u.uid === uid);
        const label = user?.email || uid;
        if (!confirm(`Are you sure you want to ${action} "${label}" to ${role}?`)) return;

        try {
            const resp = await adminApiClient.fetch(`/api/admin/users/${uid}/role`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role })
            });
            const data = await resp.json();
            if (data.errno !== 0) throw new Error(data.error || 'Failed to update role');
            showMessage('success', `✅ ${label} is now ${role}`);
            loadUsers({ includeSummary: false, requestSummary: true, refreshSummary: true });
        } catch (e) {
            showMessage('error', `❌ Failed to update role: ${e.message}`);
        }
    }

    // ==================== Impersonation ====================
    function setImpersonationState(uid, email, mode) {
        try {
            localStorage.setItem('adminImpersonationUid', uid);
            localStorage.setItem('adminImpersonationEmail', email || '');
            localStorage.setItem('adminImpersonationMode', mode || 'customToken');
            localStorage.setItem('adminImpersonationStartedAt', String(Date.now()));
        } catch (e) {
            console.warn('[Admin] Failed to store impersonation state:', e);
        }
    }

    async function impersonateUser(uid, email) {
        if (!confirm(`You are about to sign in as "${email}". You will be redirected to the dashboard as that user.\n\nTo return to admin, sign out and sign back in with your admin credentials.\n\nContinue?`)) return;

        try {
            const resp = await adminApiClient.fetch('/api/admin/impersonate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid })
            });
            const data = await resp.json();
            if (data.errno !== 0) throw new Error(data.error || 'Impersonation failed');

            const mode = data.result?.mode || 'customToken';
            const targetEmail = data.result?.targetEmail || email || uid;

            if (mode !== 'customToken' || !data.result?.customToken) {
                throw new Error('Impersonation requires IAM token-signing (custom token mode only).');
            }

            showMessage('info', `🔄 Signing in as ${targetEmail}...`, 0);
            setImpersonationState(uid, targetEmail, 'customToken');
            await firebase.auth().signInWithCustomToken(data.result.customToken);
            window.location.href = '/app.html';
        } catch (e) {
            try {
                localStorage.removeItem('adminImpersonationUid');
                localStorage.removeItem('adminImpersonationEmail');
                localStorage.removeItem('adminImpersonationMode');
                localStorage.removeItem('adminImpersonationStartedAt');
            } catch (storageErr) {
                console.warn('[Admin] Failed to clear impersonation state after error:', storageErr);
            }
            showMessage('error', `❌ Impersonation failed: ${e.message}`);
        }
    }

    // ==================== User Stats Drawer ====================
    function openStatsDrawer() {
        document.getElementById('statsDrawer').classList.add('open');
        document.getElementById('statsBackdrop').classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function closeStatsDrawer() {
        document.getElementById('statsDrawer').classList.remove('open');
        document.getElementById('statsBackdrop').classList.remove('open');
        document.body.style.overflow = '';
    }

    document.getElementById('statsBackdrop').addEventListener('click', closeStatsDrawer);

    async function viewStats(uid, email) {
        document.getElementById('statsDrawerTitle').textContent = `Stats: ${email || uid}`;
        document.getElementById('statsDrawerBody').innerHTML = '<div class="loading-spinner">Loading stats...</div>';
        openStatsDrawer();

        try {
            const resp = await adminApiClient.fetch(`/api/admin/users/${uid}/stats`);
            const data = await resp.json();
            if (data.errno !== 0) throw new Error(data.error || 'Failed to load stats');

            renderStats(data.result);
        } catch (e) {
            const statsDrawerBody = document.getElementById('statsDrawerBody');
            const errorEl = document.createElement('p');
            errorEl.style.color = 'var(--color-danger)';
            errorEl.style.padding = '20px';
            errorEl.textContent = `Failed to load stats: ${e.message}`;
            statsDrawerBody.replaceChildren(errorEl);
        }
    }

    const PROVIDER_LABELS = {
        foxess: 'FoxESS',
        sungrow: 'Sungrow',
        sigenergy: 'SigenEnergy',
        alphaess: 'AlphaESS'
    };

    function normalizeProvider(providerRaw, cfg = null) {
        const provider = String(providerRaw || '').toLowerCase().trim();
        if (provider) return provider;
        if (cfg && typeof cfg === 'object') {
            if (cfg.hasSungrowUsername || cfg.hasSungrowDeviceSn) return 'sungrow';
            if (cfg.hasSigenUsername || cfg.hasSigenStationId || cfg.hasSigenDeviceSn) return 'sigenergy';
            if (cfg.hasAlphaEssSystemSn || cfg.hasAlphaEssAppId || cfg.hasAlphaEssAppSecret) return 'alphaess';
        }
        return 'foxess';
    }

    function providerLabel(providerRaw) {
        const rawProvider = String(providerRaw || '').toLowerCase().trim();
        if (!rawProvider) return 'Unknown';
        const provider = normalizeProvider(rawProvider);
        if (PROVIDER_LABELS[provider]) return PROVIDER_LABELS[provider];
        return provider ? `${provider.charAt(0).toUpperCase()}${provider.slice(1)}` : 'Unknown';
    }

    function toCounter(value) {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function getProviderAccessSummary(cfg = {}, provider = 'foxess') {
        const providedSummary = cfg.providerAccess;
        if (providedSummary && typeof providedSummary === 'object') {
            return {
                identifierLabel: providedSummary.identifierLabel || 'Device ID',
                hasIdentifier: !!providedSummary.hasIdentifier,
                credentialLabel: providedSummary.credentialLabel || 'Credentials',
                hasCredential: !!providedSummary.hasCredential
            };
        }

        switch (provider) {
            case 'sungrow':
                return {
                    identifierLabel: 'Device SN',
                    hasIdentifier: !!cfg.hasSungrowDeviceSn,
                    credentialLabel: 'iSolarCloud Login',
                    hasCredential: !!cfg.hasSungrowUsername
                };
            case 'sigenergy':
                return {
                    identifierLabel: 'Station / Device ID',
                    hasIdentifier: !!(cfg.hasSigenStationId || cfg.hasSigenDeviceSn),
                    credentialLabel: 'Account Login',
                    hasCredential: !!cfg.hasSigenUsername
                };
            case 'alphaess':
                return {
                    identifierLabel: 'System SN',
                    hasIdentifier: !!cfg.hasAlphaEssSystemSn,
                    credentialLabel: 'App Credentials',
                    hasCredential: !!(cfg.hasAlphaEssAppId && cfg.hasAlphaEssAppSecret)
                };
            case 'foxess':
            default:
                return {
                    identifierLabel: 'Device SN',
                    hasIdentifier: !!cfg.hasDeviceSn,
                    credentialLabel: 'API Token',
                    hasCredential: !!cfg.hasFoxessToken
                };
        }
    }

    function summarizeInverterUsage(dayMetrics = {}) {
        const byProvider = {};
        const providerSource = (dayMetrics.inverterByProvider && typeof dayMetrics.inverterByProvider === 'object')
            ? dayMetrics.inverterByProvider
            : {};

        Object.entries(providerSource).forEach(([providerKey, value]) => {
            const count = toCounter(value);
            if (!count) return;
            byProvider[normalizeProvider(providerKey)] = count;
        });

        ['foxess', 'sungrow', 'sigenergy', 'alphaess'].forEach((providerKey) => {
            if (Object.prototype.hasOwnProperty.call(byProvider, providerKey)) return;
            const count = toCounter(dayMetrics[providerKey]);
            if (!count) return;
            byProvider[providerKey] = count;
        });

        let inverter = toCounter(dayMetrics.inverter);
        if (!inverter) {
            inverter = Object.values(byProvider).reduce((sum, count) => sum + count, 0);
            Object.entries(dayMetrics).forEach(([metricKey, metricValue]) => {
                if (metricKey === 'inverter' || metricKey === 'inverterByProvider' || metricKey === 'amber' || metricKey === 'weather' || metricKey === 'updatedAt') return;
                if (Object.prototype.hasOwnProperty.call(byProvider, normalizeProvider(metricKey))) return;
                inverter += toCounter(metricValue);
            });
        }

        const breakdown = Object.entries(byProvider)
            .sort((a, b) => b[1] - a[1])
            .map(([providerKey, count]) => `${providerLabel(providerKey)}: ${count}`)
            .join(', ');

        return { inverter, breakdown };
    }

    function renderStats(stats) {
        const body = document.getElementById('statsDrawerBody');
        const cfg = stats.configSummary || {};
        const autoState = stats.automationState || {};
        const provider = normalizeProvider(cfg.deviceProvider, cfg);
        const providerName = providerLabel(provider);
        const providerAccess = getProviderAccessSummary(cfg, provider);
        const inverterCapacityW = Number(cfg.inverterCapacityW);
        const batteryCapacityKWh = Number(cfg.batteryCapacityKWh);
        const inverterLabel = Number.isFinite(inverterCapacityW) && inverterCapacityW > 0
            ? `${(inverterCapacityW / 1000).toFixed(1)} kW`
            : 'Not set';
        const batteryLabel = Number.isFinite(batteryCapacityKWh) && batteryCapacityKWh > 0
            ? `${batteryCapacityKWh.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kWh`
            : 'Not set';
        const locationLabel = (typeof cfg.location === 'string' && cfg.location.trim())
            ? cfg.location.trim()
            : 'Not set';
        const tourStatusLabel = cfg.tourComplete ? '✅ Watched' : '❌ Not watched';

        const topologyCouplingRaw = (cfg.systemTopology && cfg.systemTopology.coupling)
            ? String(cfg.systemTopology.coupling).toLowerCase()
            : 'unknown';
        const topologyCouplingLabel = topologyCouplingRaw === 'ac'
            ? 'AC-Coupled'
            : (topologyCouplingRaw === 'dc' ? 'DC-Coupled' : 'Not set');

        // Config summary section
        let configHtml = `
            <div class="stat-section">
                <div class="stat-section-title">Configuration</div>
                <div class="stat-subsection">
                    <div class="stat-subsection-title">Access & Integrations</div>
                    <div class="stat-grid">
                        <div class="stat-item">
                            <div class="label">Inverter Provider</div>
                            <div class="value small">${providerName}</div>
                        </div>
                        <div class="stat-item">
                            <div class="label">${providerAccess.identifierLabel}</div>
                            <div class="value small">${providerAccess.hasIdentifier ? '✅ Configured' : '❌ Missing'}</div>
                        </div>
                        <div class="stat-item">
                            <div class="label">${providerAccess.credentialLabel}</div>
                            <div class="value small">${providerAccess.hasCredential ? '✅ Set' : '❌ Missing'}</div>
                        </div>
                        <div class="stat-item">
                            <div class="label">Amber API Key</div>
                            <div class="value small">${cfg.hasAmberApiKey ? '✅ Set' : '❌ Missing'}</div>
                        </div>
                        <div class="stat-item">
                            <div class="label">Rules</div>
                            <div class="value">${stats.ruleCount}</div>
                        </div>
                    </div>
                </div>

                <div class="stat-subsection">
                    <div class="stat-subsection-title">System Context</div>
                    <div class="stat-grid">
                        <div class="stat-item">
                            <div class="label">Location</div>
                            <div class="value small">${locationLabel}</div>
                        </div>
                        <div class="stat-item">
                            <div class="label">Tour</div>
                            <div class="value small">${tourStatusLabel}</div>
                        </div>
                    </div>
                </div>

                <div class="stat-subsection">
                    <div class="stat-subsection-title">Sizing & Topology</div>
                    <div class="stat-grid">
                        <div class="stat-item">
                            <div class="label">Inverter Size</div>
                            <div class="value small">${inverterLabel}</div>
                        </div>
                        <div class="stat-item">
                            <div class="label">Battery Size</div>
                            <div class="value small">${batteryLabel}</div>
                        </div>
                        <div class="stat-item">
                            <div class="label">System Topology</div>
                            <div class="value small">${topologyCouplingLabel}</div>
                        </div>
                    </div>
                </div>
            </div>`;

        // Automation state section
        let automationHtml = `
            <div class="stat-section">
                <div class="stat-section-title">Automation</div>
                <div class="stat-grid">
                    <div class="stat-item">
                        <div class="label">Status</div>
                        <div class="value small">${autoState.enabled ? '<span class="status-dot active"></span>Enabled' : '<span class="status-dot inactive"></span>Disabled'}</div>
                    </div>
                    <div class="stat-item">
                        <div class="label">Active Rule</div>
                        <div class="value small">${autoState.activeRule || 'None'}</div>
                    </div>
                </div>
            </div>`;

        // API usage metrics section
        const metrics = stats.metrics || {};
        const days = Object.keys(metrics).sort().reverse().slice(0, 14); // Last 14 days
        let maxTotal = 1;
        days.forEach(day => {
            const m = metrics[day] || {};
            const inverterUsage = summarizeInverterUsage(m);
            const total = inverterUsage.inverter + toCounter(m.amber) + toCounter(m.weather) + toCounter(m.ev);
            if (total > maxTotal) maxTotal = total;
        });

        let metricsHtml = '<div class="stat-section"><div class="stat-section-title">API Usage (Last 14 Days)</div>';
        if (days.length === 0) {
            metricsHtml += '<p style="color: var(--text-secondary); font-size: 13px;">No metrics data available</p>';
        } else {
            metricsHtml += `<div class="metrics-legend">
                <span class="inverter">Inverter</span>
                <span class="amber">Pricing</span>
                <span class="weather">Weather</span>
                <span class="ev">EV</span>
            </div>`;
            days.forEach(day => {
                const m = metrics[day] || {};
                const inverterUsage = summarizeInverterUsage(m);
                const inverter = inverterUsage.inverter;
                const amber = toCounter(m.amber);
                const weather = toCounter(m.weather);
                const ev = toCounter(m.ev);
                const total = inverter + amber + weather + ev;
                const barScale = 200; // max bar width in px
                const inverterTitle = inverterUsage.breakdown
                    ? `Inverter: ${inverter} (${inverterUsage.breakdown})`
                    : `Inverter: ${inverter}`;
                metricsHtml += `<div class="metrics-day">
                    <span class="date">${day.slice(5)}</span>
                    <div class="metrics-bar-group">
                        <div class="metrics-bar inverter" style="width: ${Math.max(2, inverter / maxTotal * barScale)}px;" title="${inverterTitle}"></div>
                        <div class="metrics-bar amber" style="width: ${Math.max(2, amber / maxTotal * barScale)}px;" title="Pricing: ${amber}"></div>
                        <div class="metrics-bar weather" style="width: ${Math.max(2, weather / maxTotal * barScale)}px;" title="Weather: ${weather}"></div>
                        <div class="metrics-bar ev" style="width: ${Math.max(2, ev / maxTotal * barScale)}px;" title="EV: ${ev}"></div>
                    </div>
                    <span class="total">${total}</span>
                </div>`;
            });
        }
        metricsHtml += '</div>';

        body.innerHTML = configHtml + automationHtml + metricsHtml;
    }

    // ==================== Init ====================
    AppShell.init({ pageName: 'admin', requireAuth: true, checkSetup: false });
    AppShell.onReady(async (ctx) => {
        adminApiClient = ctx.apiClient;
        initializeInfoTips();
        bindUsersFilterHandlers();
        bindAnnouncementEditorHandlers();
        if (!adminApiClient) {
            document.getElementById('accessDenied').style.display = '';
            return;
        }
        await checkAdminAccess();
    });
    
