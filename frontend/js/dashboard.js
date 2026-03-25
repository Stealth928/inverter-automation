
        // Helper to read a CSS variable from the current theme (respects light/dark mode)
        function cssVar(name) {
            return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        }

        const OVERVIEW_ICON_SVGS = {
            customize: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/><circle cx="9" cy="6" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="11" cy="18" r="1.8"/></svg>',
            settings: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/><circle cx="12" cy="12" r="3"/></svg>',
            bolt: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m13 2-7 11h5l-1 9 8-12h-5z"/></svg>',
            money: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 18h16"/><path d="m6 14 4-4 3 3 5-6"/><circle cx="7" cy="7" r="2.2"/><path d="M7 5.6v2.8"/><path d="M5.8 7h2.4"/></svg>',
            weather: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 17h10a3.5 3.5 0 0 0 .5-7A5 5 0 0 0 7.5 10 3.5 3.5 0 0 0 7 17z"/><path d="M9 13h6"/></svg>',
            ev: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 15h14l-1.2-5H6.2L5 15z"/><circle cx="8" cy="17" r="1.5"/><circle cx="16" cy="17" r="1.5"/><path d="M7 10l1-2h8l1 2"/></svg>',
            quick: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="9" width="18" height="10" rx="5"/><path d="M8 13v4"/><path d="M6 15h4"/><circle cx="15.5" cy="13.5" r="1"/><circle cx="17.5" cy="15.5" r="1"/></svg>',
            calendar: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M4 10h16"/><path d="M8 14h4"/></svg>',
            help: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8"/><path d="M9.5 9a2.5 2.5 0 1 1 4.3 1.7c-.6.6-1.3.9-1.8 1.6-.2.3-.3.6-.3 1"/><circle cx="12" cy="16.3" r=".6" fill="currentColor" stroke="none"/></svg>',
            note: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M9 11h6"/><path d="M9 14h5"/></svg>',
            target: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>',
            chart: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 20h16"/><rect x="6" y="11" width="3" height="7" rx="1"/><rect x="11" y="8" width="3" height="10" rx="1"/><rect x="16" y="5" width="3" height="13" rx="1"/></svg>',
            battery: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4" y="7" width="14" height="10" rx="2"/><rect x="18" y="10" width="2" height="4" rx="1"/><rect x="6.5" y="9.5" width="8" height="5" rx="1" fill="currentColor" stroke="none"/></svg>',
            temp: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10 4a2 2 0 0 1 4 0v8.5a4 4 0 1 1-4 0z"/><path d="M12 9v6"/></svg>',
            clock: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
            solar: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.5"/><path d="M12 3v2.5"/><path d="M12 18.5V21"/><path d="m5.64 5.64 1.77 1.77"/><path d="m16.59 16.59 1.77 1.77"/><path d="M3 12h2.5"/><path d="M18.5 12H21"/><path d="m5.64 18.36 1.77-1.77"/><path d="m16.59 7.41 1.77-1.77"/></svg>',
            home: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.8V20h14V9.8"/><path d="M9.5 20v-6h5v6"/></svg>',
            grid: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 4v5"/><path d="M15 4v5"/><path d="M7 9h10v3a5 5 0 0 1-10 0z"/><path d="M12 15v5"/></svg>',
            refresh: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.5 10.5A6 6 0 0 1 17 7"/><path d="M17.5 13.5A6 6 0 0 1 7 17"/></svg>',
            play: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9 7 8 5-8 5z" fill="currentColor" stroke="none"/></svg>',
            stop: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>'
        };

        const OVERVIEW_EMOJI_ICON_MAP = {
            '🧩': 'customize',
            '⚙': 'settings',
            '⚡': 'bolt',
            '💰': 'money',
            '🌤': 'weather',
            '🚗': 'ev',
            '🕹': 'quick',
            '📅': 'calendar',
            '❓': 'help',
            '📝': 'note',
            '🎯': 'target',
            '📊': 'chart',
            '🔋': 'battery',
            '🌡': 'temp',
            '🕐': 'clock'
        };

        function overviewIconSvg(iconKey) {
            return OVERVIEW_ICON_SVGS[iconKey] || '';
        }

        function overviewIconChipHtml(iconKey, extraClasses = '') {
            const svg = overviewIconSvg(iconKey);
            if (!svg) return '';
            const classes = ['app-overview-icon', `app-overview-icon--${iconKey}`];
            if (extraClasses) classes.push(extraClasses);
            return `<span class="${classes.join(' ')}" aria-hidden="true">${svg}</span>`;
        }

        function overviewIconKeyFromText(text) {
            const firstToken = String(text || '').trim().split(/\s+/)[0] || '';
            const normalized = firstToken.replace(/\uFE0F/g, '');
            return OVERVIEW_EMOJI_ICON_MAP[normalized] || '';
        }

        function decorateOverviewIconSpans(root = document) {
            const targets = root.querySelectorAll('.card-title .icon, .form-section-title .icon, .condition-item-header .icon, .automation-header h2 .icon, .modal-header h3 .icon');
            targets.forEach((el) => {
                if (el.dataset.overviewIconDecorated === '1') return;
                const key = overviewIconKeyFromText(el.textContent || '');
                if (!key) return;
                const svg = overviewIconSvg(key);
                if (!svg) return;
                el.classList.add('app-overview-icon', `app-overview-icon--${key}`);
                el.dataset.overviewIconDecorated = '1';
                el.setAttribute('aria-hidden', 'true');
                el.innerHTML = svg;
            });
        }

        function decorateOverviewButtons(root = document) {
            root.querySelectorAll('button.btn').forEach((btn) => {
                if (btn.dataset.overviewEmojiButtonDecorated === '1') return;
                const text = String(btn.textContent || '').trim();
                let iconKey = '';
                let label = '';

                if (text.startsWith('🔋')) {
                    iconKey = 'battery';
                    label = text.replace(/^🔋\s*/, '') || 'Charge';
                } else if (text.startsWith('⚡')) {
                    iconKey = 'bolt';
                    label = text.replace(/^⚡\s*/, '') || 'Discharge';
                } else if (text.startsWith('▶')) {
                    iconKey = 'play';
                    label = text.replace(/^▶️?\s*/, '') || 'Start Quick Control';
                } else if (text.startsWith('⏹')) {
                    iconKey = 'stop';
                    label = text.replace(/^⏹️?\s*/, '') || 'Stop Now';
                }

                if (!iconKey) return;
                btn.innerHTML = `${overviewIconChipHtml(iconKey, 'app-overview-icon--sm')}<span>${label}</span>`;
                btn.dataset.overviewEmojiButtonDecorated = '1';
            });
        }

        function setQuickControlStartButtonIdle(button) {
            if (!button) return;
            button.innerHTML = `${overviewIconChipHtml('play', 'app-overview-icon--sm')}<span>Start Quick Control</span>`;
        }

        const PREVIEW_SCENARIO_OPTIONS = Object.freeze([
            { value: 'solar-surplus', label: 'Solar Surplus' },
            { value: 'evening-peak', label: 'Evening Peak' },
            { value: 'storm-watch', label: 'Storm Watch' },
            { value: 'ev-charge', label: 'EV Charge Night' }
        ]);
        const PREVIEW_READONLY_MESSAGE = 'Preview mode is read-only. Connect your system in Setup to enable real controls.';
        const PREVIEW_WEATHER_LOCATION = 'Pyrmont, Australia';

        function isPreviewMode() {
            try {
                return !!(window.PreviewSession && typeof window.PreviewSession.isActive === 'function' && window.PreviewSession.isActive());
            } catch (error) {
                return false;
            }
        }

        function getPreviewScenario() {
            try {
                if (window.PreviewSession && typeof window.PreviewSession.getScenario === 'function') {
                    return window.PreviewSession.getScenario();
                }
            } catch (error) { /* ignore */ }
            return 'solar-surplus';
        }

        function createJsonResponse(payload, status = 200) {
            return new Response(JSON.stringify(payload), {
                status,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        function getPreviewRequestPath(url) {
            try {
                const parsed = new URL(String(url || ''), window.location.origin);
                return `${parsed.pathname}${parsed.search}`;
            } catch (error) {
                return String(url || '');
            }
        }

        function getPreviewInterceptResponse(url, options = {}) {
            if (!isPreviewMode()) return null;

            const method = String(options.method || 'GET').toUpperCase();
            const path = getPreviewRequestPath(url);

            if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
                return createJsonResponse({ errno: 403, error: PREVIEW_READONLY_MESSAGE, msg: PREVIEW_READONLY_MESSAGE, preview: true }, 403);
            }

            if (path.startsWith('/api/metrics/api-calls')) {
                return createJsonResponse(getMockApiMetricsResponse());
            }

            if (path.startsWith('/api/scheduler/v1/get')) {
                return createJsonResponse({ errno: 0, result: { groups: getMockSchedulerGroups() }, preview: true });
            }

            return null;
        }

        function wrapPreviewFetch(target, methodName, installedFlagName) {
            if (!target || typeof target[methodName] !== 'function' || target[installedFlagName]) return;

            const baseFetch = target[methodName].bind(target);
            target[installedFlagName] = true;

            target[methodName] = async function previewWrappedFetch(url, options = {}) {
                const intercepted = getPreviewInterceptResponse(url, options);
                if (intercepted) {
                    return intercepted;
                }
                return baseFetch(url, options);
            };
        }

        function installPreviewFetchGuard() {
            wrapPreviewFetch(window, 'authenticatedFetch', '__dashboardPreviewFetchGuardInstalled');
            wrapPreviewFetch(window.firebaseAuth, 'fetchWithAuth', '__dashboardPreviewFirebaseFetchGuardInstalled');
            wrapPreviewFetch(window.apiClient, 'fetch', '__dashboardPreviewApiClientFetchGuardInstalled');
        }

        function renderPreviewModeBanner() {
            if (!isPreviewMode()) return;

            const mainContent = document.querySelector('.main-content');
            if (!mainContent) return;

            let banner = document.getElementById('previewModeBanner');
            if (!banner) {
                banner = document.createElement('section');
                banner.id = 'previewModeBanner';
                banner.className = 'preview-banner';
                const visibilityCard = mainContent.querySelector('.dashboard-visibility-card');
                if (visibilityCard && visibilityCard.parentNode === mainContent) {
                    mainContent.insertBefore(banner, visibilityCard.nextSibling);
                } else {
                    mainContent.insertBefore(banner, mainContent.firstChild);
                }
            }

            const scenario = getPreviewScenario();
            const scenarioOptions = PREVIEW_SCENARIO_OPTIONS.map((option) => `<option value="${option.value}" ${option.value === scenario ? 'selected' : ''}>${option.label}</option>`).join('');
            banner.innerHTML = `
                <div class="preview-banner__top">
                    <div class="preview-banner__copy">
                        <div class="preview-banner__eyebrow">Preview Mode</div>
                        <div class="preview-banner__title">Sample dashboard tour with read-only data</div>
                        <div class="preview-banner__description">Switch scenarios to see different sample conditions, then launch the guided tour or return to Setup when you're ready to connect real devices.</div>
                        <div class="preview-banner__meta">
                            <span class="preview-banner__pill">Read-only controls</span>
                            <span class="preview-banner__pill">Sample inverter, pricing, weather, EV, and automation data</span>
                        </div>
                    </div>
                    <div class="preview-banner__controls">
                        <label class="preview-banner__field">
                            <span class="preview-banner__field-label">Scenario</span>
                            <select id="previewScenarioSelect" class="preview-banner__select">${scenarioOptions}</select>
                        </label>
                        <div class="preview-banner__buttons">
                            <button type="button" id="previewRestartTourBtn" class="btn preview-banner__btn preview-banner__btn--primary">Start Tour</button>
                            <button type="button" id="previewExitBtn" class="btn preview-banner__btn preview-banner__btn--warning">Back to Setup</button>
                        </div>
                    </div>
                </div>
                <div class="preview-banner__hint">Quick control, EV commands, automation edits, and scheduler writes are disabled while preview mode is active.</div>
            `;

            const scenarioSelect = document.getElementById('previewScenarioSelect');
            if (scenarioSelect && scenarioSelect.dataset.bound !== '1') {
                scenarioSelect.dataset.bound = '1';
                scenarioSelect.addEventListener('change', (event) => {
                    try {
                        window.PreviewSession.setScenario(event.target.value);
                    } catch (error) { /* ignore */ }
                    window.location.reload();
                });
            }

            const restartTourBtn = document.getElementById('previewRestartTourBtn');
            if (restartTourBtn && restartTourBtn.dataset.bound !== '1') {
                restartTourBtn.dataset.bound = '1';
                restartTourBtn.addEventListener('click', () => {
                    try { sessionStorage.setItem('tourAutoLaunch', '1'); } catch (error) { /* ignore */ }
                    if (window.TourEngine && typeof window.TourEngine.start === 'function') {
                        window.TourEngine.start(0);
                    }
                });
            }

            const exitBtn = document.getElementById('previewExitBtn');
            if (exitBtn && exitBtn.dataset.bound !== '1') {
                exitBtn.dataset.bound = '1';
                exitBtn.addEventListener('click', () => {
                    try {
                        if (window.PreviewSession) {
                            window.PreviewSession.clear();
                        }
                    } catch (error) { /* ignore */ }
                    if (typeof safeRedirect === 'function') {
                        safeRedirect('/setup.html');
                    } else {
                        window.location.href = '/setup.html';
                    }
                });
            }
        }

        installPreviewFetchGuard();

        // default collapsed state for right response panel; value persisted in localStorage
        let panelCollapsed = false;
        // When true, suppress auto-opening the right response panel (used during init)
        window.suppressPanelAutoOpen = false;
        // User timezone (populated from backend `/api/config` during initialization)
        // Used throughout render functions and time formatting to respect user's local timezone
        let USER_TZ = 'Australia/Sydney';

        // Hardware config — per-user inverter and battery specs loaded from /api/config.
        // Defaults match legacy hard-coded values so existing users see no change.
        let _batteryCapacityKwh = 41.93; // kWh; overridden from user config on load
        let _inverterCapacityW  = 10000; // Watts; overridden from user config on load
        let _userProvider       = '';    // 'foxess' | 'alphaess' | 'sungrow' | etc; overridden on load
        let _providerCapabilities = resolveProviderCapabilities('foxess');

        function getEffectiveInverterCapacityW(capacityW = _inverterCapacityW) {
            const parsed = Number(capacityW);
            if (!Number.isFinite(parsed) || parsed < 1000) {
                return 10000;
            }
            return Math.min(30000, Math.round(parsed));
        }

        function getRulePowerValidationMessage(capacityW = _inverterCapacityW) {
            return `⚡ Power must be 0-${getEffectiveInverterCapacityW(capacityW)}W (your inverter capacity)`;
        }

        function applyRulePowerCapacityToUI(capacityW = _inverterCapacityW) {
            const effectiveCapacityW = getEffectiveInverterCapacityW(capacityW);
            const title = `Max: ${(effectiveCapacityW / 1000).toFixed(1)} kW (your inverter capacity)`;
            const inputs = new Set([
                ...document.querySelectorAll('input[name="fdPwr"]'),
                document.getElementById('newRuleFdPwr'),
                document.getElementById('actionFdPwr')
            ].filter(Boolean));

            inputs.forEach((input) => {
                input.max = String(effectiveCapacityW);
                input.title = title;
            });
        }

        function normalizeDashboardProvider(provider) {
            if (window.sharedUtils && typeof window.sharedUtils.normalizeDeviceProvider === 'function') {
                return window.sharedUtils.normalizeDeviceProvider(provider);
            }
            const normalized = String(provider || '').trim().toLowerCase();
            return normalized || 'foxess';
        }

        function resolveProviderCapabilities(provider) {
            if (window.sharedUtils && typeof window.sharedUtils.getProviderCapabilities === 'function') {
                return window.sharedUtils.getProviderCapabilities(provider);
            }
            const normalized = normalizeDashboardProvider(provider);
            return {
                provider: normalized,
                label: normalized === 'alphaess' ? 'AlphaESS' : (normalized === 'sigenergy' ? 'SigenEnergy' : (normalized === 'sungrow' ? 'Sungrow' : 'FoxESS')),
                supportsDirectWorkMode: normalized === 'foxess',
                supportsBackupMode: normalized === 'foxess',
                supportsAdvancedDeviceControls: normalized === 'foxess',
                supportsTelemetrySourceMapping: normalized === 'foxess',
                supportsQuickControl: normalized !== 'sigenergy',
                supportsSchedulerControl: normalized !== 'sigenergy',
                supportsExactPowerControl: normalized === 'foxess',
                supportsReliableYearlyReport: normalized !== 'alphaess' && normalized !== 'sigenergy',
                supportsAcHistoryAutoDetect: normalized !== 'alphaess' && normalized !== 'sigenergy',
                schedulerEditableWindowCount: normalized === 'alphaess' ? 4 : (normalized === 'sungrow' ? 4 : (normalized === 'sigenergy' ? 0 : 8)),
                schedulerStepMinutes: normalized === 'alphaess' ? 15 : 1
            };
        }

        function getSchedulerSlotLabel(caps = _providerCapabilities, index = null) {
            const baseLabel = caps && caps.provider === 'alphaess' ? 'Window' : 'Segment';
            return index === null ? baseLabel : `${baseLabel} ${index}`;
        }

        function getSchedulerSlotCount(caps = _providerCapabilities) {
            const count = Number(caps?.schedulerEditableWindowCount);
            return Number.isFinite(count) && count > 0 ? count : 8;
        }

        function setWorkModeOptionAvailability(selectEl, optionValue, isAvailable, fallbackValue = 'SelfUse') {
            if (!selectEl) return;
            const targetOption = Array.from(selectEl.options || []).find((option) => option.value === optionValue);
            if (!targetOption) return;
            targetOption.disabled = !isAvailable;
            targetOption.hidden = !isAvailable;
            if (!isAvailable && selectEl.value === optionValue) {
                selectEl.value = fallbackValue;
            }
        }

        function applyProviderConstraintsToDashboard() {
            const caps = _providerCapabilities || resolveProviderCapabilities(_userProvider);
            const quickControlCard = document.querySelector('[data-dashboard-card="quickControls"]');
            const schedulerCard = document.querySelector('[data-dashboard-card="scheduler"]');
            const schedulerForm = document.getElementById('form-scheduler-segment');
            const schedulerStatus = document.getElementById('schedulerStatus');
            let schedulerNotice = document.getElementById('schedulerProviderNotice');

            if (!schedulerNotice && schedulerStatus && schedulerStatus.parentElement) {
                schedulerNotice = document.createElement('div');
                schedulerNotice.id = 'schedulerProviderNotice';
                schedulerNotice.style.cssText = 'display:none;padding:10px 12px;margin-bottom:12px;background:rgba(56,139,253,0.1);border:1px solid rgba(56,139,253,0.3);border-radius:6px;font-size:12px;line-height:1.6;color:var(--text-secondary);';
                schedulerStatus.parentElement.insertBefore(schedulerNotice, schedulerStatus);
            }

            if (quickControlCard) {
                quickControlCard.style.display = caps.supportsQuickControl ? '' : 'none';
            }
            if (schedulerCard) {
                schedulerCard.style.display = caps.supportsSchedulerControl ? '' : 'none';
            }

            if (schedulerForm) {
                const segmentIndexSelect = schedulerForm.querySelector('select[name="segmentIndex"]');
                const segmentLabel = segmentIndexSelect?.closest('.input-group')?.querySelector('label');
                const powerLabel = schedulerForm.querySelector('input[name="fdPwr"]')?.closest('.input-group')?.querySelector('label');
                const workModeSelect = schedulerForm.querySelector('select[name="workMode"]');
                const schedulerCount = getSchedulerSlotCount(caps);

                if (segmentLabel) segmentLabel.textContent = caps.provider === 'alphaess' ? 'Window #' : 'Segment #';
                if (powerLabel) powerLabel.textContent = caps.supportsExactPowerControl ? 'Power (W)' : 'Requested Power (W)';
                setWorkModeOptionAvailability(workModeSelect, 'Backup', caps.supportsBackupMode);
                setWorkModeOptionAvailability(workModeSelect, 'SelfUse', caps.provider !== 'sungrow');

                if (segmentIndexSelect) {
                    Array.from(segmentIndexSelect.options).forEach((option, index) => {
                        const available = index < schedulerCount;
                        option.disabled = !available;
                        option.hidden = !available;
                    });
                    if (Number(segmentIndexSelect.value) >= schedulerCount) {
                        segmentIndexSelect.value = '0';
                    }
                }
            }

            setWorkModeOptionAvailability(document.getElementById('actionWorkMode'), 'Backup', caps.supportsBackupMode);
            setWorkModeOptionAvailability(document.getElementById('newRuleWorkMode'), 'Backup', caps.supportsBackupMode);
            setWorkModeOptionAvailability(document.getElementById('actionWorkMode'), 'SelfUse', caps.provider !== 'sungrow');
            setWorkModeOptionAvailability(document.getElementById('newRuleWorkMode'), 'SelfUse', caps.provider !== 'sungrow');

            if (schedulerNotice) {
                if (caps.provider === 'alphaess') {
                    schedulerNotice.style.display = 'block';
                    schedulerNotice.innerHTML =
                        '<strong style="color:var(--accent-blue);">AlphaESS scheduler note</strong><br>' +
                        'Only the first <strong>4 windows</strong> map to AlphaESS charge/discharge slots.<br>' +
                        'Times are rounded to <strong>15-minute boundaries</strong> and requested power is <strong>advisory only</strong>.<br>' +
                        '<strong>Backup</strong> is unavailable, and <strong>Feed In</strong> uses AlphaESS discharge/export scheduling semantics.';
                } else if (caps.provider === 'sungrow') {
                    schedulerNotice.style.display = 'block';
                    schedulerNotice.innerHTML =
                        '<strong style="color:var(--accent-blue);">Sungrow scheduler note</strong><br>' +
                        'Only the first <strong>4 windows</strong> map to the current Sungrow TOU integration.<br>' +
                        'Requested power and SoC values are <strong>not written as exact device parameters</strong> by the current adapter.<br>' +
                        '<strong>Self Use</strong> and <strong>Backup</strong> are hidden here because they do not map cleanly to the current Sungrow scheduler implementation.';
                } else {
                    schedulerNotice.style.display = 'none';
                    schedulerNotice.innerHTML = '';
                }
            }
        }

        function setDashboardProvider(provider) {
            _userProvider = normalizeDashboardProvider(provider);
            _providerCapabilities = resolveProviderCapabilities(_userProvider);
            applyProviderConstraintsToDashboard();
        }

        // apiClient is declared in api-client.js and initialized after Firebase auth is ready

        // Dismiss the weather fallback banner for a given location key
        function dismissWeatherFallback(key) {
            try {
                localStorage.setItem('weatherFallbackDismissed:' + key, String(Date.now()));
            } catch (e) { /* ignore storage errors */ }
            const el = document.getElementById('weather-fallback-banner-' + key);
            if (el && el.remove) el.remove();
            // Also clear status bar border if it was indicating fallback
            try {
                const statusBar = document.getElementById('status-bar');
                if (statusBar) statusBar.style.border = '';
            } catch (e) {}

            // Ensure the toggle button remains clickable; keep pointer events enabled
            try {
                const tbtn = document.getElementById('automationToggleBtn');
                if (tbtn) tbtn.style.pointerEvents = 'auto';
            } catch (e) { /* ignore */ }
        }

        function syncAutomationToggleVisibility() {
            try {
                const toggle = document.getElementById('automationToggleBtn');
                if (!toggle) return;

                const addRuleModalOpen = !!document.getElementById('addRuleModal');
                const ruleModal = document.getElementById('ruleModal');
                const ruleModalOpen = !!(ruleModal && ruleModal.classList.contains('show'));

                if (addRuleModalOpen || ruleModalOpen) {
                    toggle.style.display = 'none';
                } else {
                    toggle.style.display = '';
                    toggle.style.pointerEvents = 'auto';
                }
            } catch (e) { /* ignore */ }
        }

        window.addEventListener('pageshow', () => {
            setTimeout(syncAutomationToggleVisibility, 0);
        });

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                setTimeout(syncAutomationToggleVisibility, 0);
            }
        });

        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(syncAutomationToggleVisibility, 0);
            decorateOverviewIconSpans();
            decorateOverviewButtons();
        });

        function initSmartTooltips() {
            if (window.__smartTooltipsInit) return;
            window.__smartTooltipsInit = true;

            if (document.body) {
                document.body.classList.add('tooltip-js');
            }

            const popover = document.createElement('div');
            popover.className = 'tooltip-popover';
            popover.setAttribute('role', 'tooltip');
            document.body.appendChild(popover);

            let activeIcon = null;
            let rafHandle = null;

            function positionPopover() {
                if (!activeIcon) return;

                const margin = 10;
                const maxWidth = Math.max(160, Math.min(320, window.innerWidth - (margin * 2)));
                popover.style.maxWidth = `${maxWidth}px`;
                popover.style.left = '-9999px';
                popover.style.top = '-9999px';

                const iconRect = activeIcon.getBoundingClientRect();
                const popRect = popover.getBoundingClientRect();

                let left = iconRect.left + (iconRect.width / 2) - (popRect.width / 2);
                left = Math.max(margin, Math.min(left, window.innerWidth - popRect.width - margin));

                let top = iconRect.top - popRect.height - 10;
                let placement = 'top';
                if (top < margin) {
                    top = iconRect.bottom + 10;
                    placement = 'bottom';
                }

                top = Math.max(margin, Math.min(top, window.innerHeight - popRect.height - margin));

                const arrowLeft = Math.max(10, Math.min(iconRect.left + (iconRect.width / 2) - left, popRect.width - 10));

                popover.dataset.placement = placement;
                popover.style.setProperty('--tooltip-arrow-left', `${Math.round(arrowLeft)}px`);
                popover.style.left = `${Math.round(left)}px`;
                popover.style.top = `${Math.round(top)}px`;
            }

            function schedulePosition() {
                if (!activeIcon) return;
                if (rafHandle) cancelAnimationFrame(rafHandle);
                rafHandle = requestAnimationFrame(positionPopover);
            }

            function showFor(icon) {
                const text = icon?.getAttribute('data-tooltip');
                if (!text) return;
                activeIcon = icon;
                popover.textContent = text;
                popover.classList.add('show');
                schedulePosition();
            }

            function hidePopover() {
                activeIcon = null;
                popover.classList.remove('show');
                popover.style.left = '-9999px';
                popover.style.top = '-9999px';
            }

            document.addEventListener('mouseenter', (event) => {
                const icon = event.target?.closest?.('.tooltip-icon[data-tooltip]');
                if (icon) showFor(icon);
            }, true);

            document.addEventListener('mouseleave', (event) => {
                const icon = event.target?.closest?.('.tooltip-icon[data-tooltip]');
                if (!icon) return;
                const to = event.relatedTarget;
                if (to && to.closest && to.closest('.tooltip-icon[data-tooltip]')) return;
                hidePopover();
            }, true);

            document.addEventListener('focusin', (event) => {
                const icon = event.target?.closest?.('.tooltip-icon[data-tooltip]');
                if (icon) showFor(icon);
            });

            document.addEventListener('focusout', (event) => {
                const icon = event.target?.closest?.('.tooltip-icon[data-tooltip]');
                if (icon) hidePopover();
            });

            document.addEventListener('click', (event) => {
                if (!event.target?.closest?.('.tooltip-icon[data-tooltip]')) {
                    hidePopover();
                }
            });

            window.addEventListener('resize', schedulePosition);
            window.addEventListener('scroll', schedulePosition, true);
        }

        // Dynamically load Leaflet CSS+JS once and return a Promise when ready
        function ensureLeafletLoaded() {
            if (window.__leafletLoading) return window.__leafletLoading;
            if (window.L) return Promise.resolve();

            window.__leafletLoading = new Promise((resolve, reject) => {
                try {
                    // CSS
                    const cssHref = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
                    const existing = Array.from(document.getElementsByTagName('link')).find(l => l.href && l.href.indexOf('unpkg.com/leaflet') !== -1);
                    if (!existing) {
                        const link = document.createElement('link');
                        link.rel = 'stylesheet';
                        link.href = cssHref;
                        document.head.appendChild(link);
                    }

                    // JS
                    const existingScript = Array.from(document.getElementsByTagName('script')).find(s => s.src && s.src.indexOf('unpkg.com/leaflet') !== -1);
                    if (existingScript) {
                        existingScript.addEventListener('load', () => resolve());
                        existingScript.addEventListener('error', () => reject(new Error('Leaflet script failed to load')));
                        return;
                    }
                    const script = document.createElement('script');
                    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
                    script.async = true;
                    script.onload = () => setTimeout(() => resolve(), 20);
                    script.onerror = () => reject(new Error('Leaflet script failed to load'));
                    document.body.appendChild(script);
                } catch (e) {
                    reject(e);
                }
            });
            return window.__leafletLoading;
        }
        
        function updateToggleBtnPosition() {
            const panel = document.getElementById('rightPanel');
            const toggleBtn = document.getElementById('toggleBtn');
            const automationToggleBtn = document.getElementById('automationToggleBtn');
            if (!panel) return;
            const panelWidth = panel.classList.contains('collapsed') ? 0 : (panel.offsetWidth || 0);
            if (toggleBtn) toggleBtn.style.right = panelWidth + 'px';
            if (automationToggleBtn) {
                // On desktop, keep automation launcher aligned with the right-panel edge.
                // On mobile, CSS pins it to viewport edge.
                automationToggleBtn.style.right = window.innerWidth > 900 ? `${panelWidth}px` : '0px';
            }
        }
        
        function togglePanel() {
            if (window.innerWidth <= 900) return;
            const panel = document.getElementById('rightPanel');
            const toggleBtn = document.getElementById('toggleBtn');
            if (!panel) return;
            
            panelCollapsed = !panelCollapsed;
            if (panelCollapsed) {
                panel.classList.add('collapsed');
                // Panel is collapsed — clicking should open it (move left), so show left-facing arrow
                toggleBtn.textContent = 'R ◀';
                try { localStorage.setItem('rightPanelCollapsed', 'true'); } catch(e) {}
            } else {
                // Force reflow before removing class
                void panel.offsetWidth;
                panel.classList.remove('collapsed');
                // Panel is expanded — clicking should collapse it (move right), so show right-facing arrow
                toggleBtn.textContent = 'R ▶';
                try { localStorage.setItem('rightPanelCollapsed', 'false'); } catch(e) {}
            }
            updateToggleBtnPosition();
        }
        
        async function callAPI(endpoint, name, autoOpen = false, forceRefresh = false) {
            // Only auto-open the right-panel if caller explicitly requests it.
            // Suppress during initial boot to keep panel collapsed by default.
            if (autoOpen && panelCollapsed && !window.suppressPanelAutoOpen) togglePanel();
            const resultEl = document.getElementById('result');
            const statusBar = document.getElementById('status-bar');
            const sn = document.getElementById('deviceSn').value;
            
            let url = endpoint;
            // Add forceRefresh parameter if provided to bypass backend cache
            if (forceRefresh && !url.includes('forceRefresh')) {
                const separator = url.includes('?') ? '&' : '?';
                url += separator + 'forceRefresh=true';
            }
            if (sn && (endpoint.includes('/inverter') || endpoint.includes('/scheduler/') || endpoint.includes('/module/signal'))) {
                // Use & if URL already has query parameters, otherwise use ?
                const separator = url.includes('?') ? '&' : '?';
                url += `${separator}sn=${encodeURIComponent(sn)}`;
            }
            
            resultEl.className = '';
            resultEl.textContent = `Loading ${name}...`;
            const startTime = Date.now();
            
                try {
                    const useMockInverterRealtime = isDashboardLocalMockEnabled() &&
                        (endpoint.includes('/api/inverter/real-time') || name === 'Real-time Data');

                    let data;
                    if (useMockInverterRealtime) {
                        // Short delay keeps UI behavior consistent with normal loading states.
                        await new Promise((resolve) => setTimeout(resolve, 80));
                        data = getMockInverterRealtimeData();
                    } else {
                        // Ensure a global in-flight map exists for deduplication
                        if (!window._inflightRequests) window._inflightRequests = {};
                        const inflightKey = `GET ${url}`;
                        let fetchPromise = window._inflightRequests[inflightKey];
                        if (!fetchPromise) {
                            fetchPromise = (async () => {
                                try {
                                    const response = await authenticatedFetch(url);
                                    return await response.json();
                                } finally {
                                    // Clear the in-flight entry when finished (success or error)
                                    try { delete window._inflightRequests[inflightKey]; } catch (e) {}
                                }
                            })();
                            window._inflightRequests[inflightKey] = fetchPromise;
                        }
                        data = await fetchPromise;
                    }
                const endTime = Date.now();
                
                statusBar.style.display = 'flex';
                statusBar.querySelector('.endpoint').textContent = `${name}${useMockInverterRealtime ? ' (mock)' : ''} - ${endpoint}`;
                statusBar.querySelector('.time').textContent = `${endTime - startTime}ms`;
                
                resultEl.className = (data.errno === 0 || data.result) ? 'success' : 'error';
                resultEl.textContent = JSON.stringify(data, null, 2);
                
                // Cache data for automation test page (no API calls there)
                if (data.errno === 0) {
                    if (endpoint.includes('/inverter/real-time') || name === 'Real-time Data') {
                        try {
                            const items = [];
                            const result = data.result || [];
                            if (Array.isArray(result) && result.length > 0 && Array.isArray(result[0].datas)) {
                                result.forEach(r => { if (Array.isArray(r.datas)) items.push(...r.datas); });
                            }
                            const invCache = {};
                            items.forEach(item => {
                                if (item.variable && item.value !== undefined) {
                                    invCache[item.variable] = item.value;
                                }
                            });
                            localStorage.setItem('cachedInverter', JSON.stringify(invCache));
                        } catch (e) { /* ignore cache errors */ }
                    } else if (endpoint.includes('/amber/prices/current')) {
                        try {
                            const prices = data.result || [];
                            const general = prices.find(p => p.channelType === 'general');
                            const feedIn = prices.find(p => p.channelType === 'feedIn');
                            const forecasts = prices.filter(p => p.type === 'ForecastInterval');
                            const priceCache = {
                                general: general ? { perKwh: general.perKwh } : null,
                                feedIn: feedIn ? { perKwh: feedIn.perKwh } : null,
                                forecastHigh: forecasts.length > 0 ? Math.max(...forecasts.map(f => f.perKwh || 0)) : null
                            };
                            localStorage.setItem('cachedPrices', JSON.stringify(priceCache));
                        } catch (e) { /* ignore cache errors */ }
                    } else if (endpoint.includes('/weather')) {
                        try {
                            // API now returns {errno, result: {source, hourly, current, ...}}
                            const weatherData = data.result || data;
                            const hourly = weatherData?.hourly || {};
                            const current = weatherData?.current || {};
                            // Find current hour index for accurate solar radiation
                            // Use API's current time (which is in local timezone) instead of JS Date (which is UTC)
                            let currentHourIdx = 0;
                            if (hourly.time && Array.isArray(hourly.time)) {
                                const currentTime = current?.time || new Date().toISOString();
                                const currentHourStr = currentTime.substring(0, 13); // YYYY-MM-DDTHH
                                currentHourIdx = hourly.time.findIndex(t => t && t.substring(0, 13) === currentHourStr);
                                if (currentHourIdx < 0) currentHourIdx = 0;
                            }
                            const wxCache = {
                                solarRadiation: hourly.shortwave_radiation?.[currentHourIdx] || 0,
                                cloudCover: hourly.cloudcover?.[currentHourIdx] || hourly.cloud_cover?.[currentHourIdx] || 0
                            };
                            localStorage.setItem('cachedWeather', JSON.stringify(wxCache));
                        } catch (e) { /* ignore cache errors */ }
                    }
                }
                
                // Update inverter card if relevant
                if (endpoint.includes('/inverter/')) {
                    updateInverterCard(data, name);
                }

                // If this was a real-time inverter fetch, prefer the cloud timestamp when available
                try {
                    if (endpoint.includes('/inverter/real-time') || name === 'Real-time Data') {
                        // Save the client fetch time
                        setLastUpdated('inverter');

                        // If the API provided a server/cloud timestamp (result[0].time), parse and use it
                        try {
                            const frame = (data && data.result && Array.isArray(data.result) && data.result[0]) ? data.result[0] : null;
                            if (frame && frame.time) {
                                const parsed = parseFoxESSCloudTime(frame.time);
                                if (parsed) {
                                    // store cloud timestamp (ms since epoch)
                                    lastUpdated.inverterCloud = parsed;
                                }
                            }
                        } catch (e) {/* ignore parse errors */}
                    }
                } catch (e) { /* ignore */ }
            } catch (error) {
                resultEl.className = 'error';
                resultEl.textContent = `Error: ${error.message}`;
                statusBar.style.display = 'none';
            }
        }

        async function callAPIPost(endpoint, name, bodyTemplate = {}, autoOpen = false) {
            // Only auto-open the right-panel if caller explicitly requests it.
            if (autoOpen && panelCollapsed && !window.suppressPanelAutoOpen) togglePanel();
            const resultEl = document.getElementById('result');
            const statusBar = document.getElementById('status-bar');
            const sn = document.getElementById('deviceSn').value;
            const body = Object.assign({}, bodyTemplate);
            if (sn) body.sn = sn;

            resultEl.className = '';
            resultEl.textContent = `Sending ${name}...`;
            const startTime = Date.now();

            try {
                // POST dedupe: include body in the key so identical requests reuse the same in-flight Promise
                if (!window._inflightRequests) window._inflightRequests = {};
                let bodyKey = '';
                try { bodyKey = JSON.stringify(body); } catch (e) { bodyKey = String(Date.now()); }
                const inflightKey = `POST ${endpoint} ${bodyKey}`;
                let postPromise = window._inflightRequests[inflightKey];
                if (!postPromise) {
                    postPromise = (async () => {
                        try {
                            const response = await authenticatedFetch(endpoint, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(body)
                            });
                            return await response.json();
                        } finally {
                            try { delete window._inflightRequests[inflightKey]; } catch (e) {}
                        }
                    })();
                    window._inflightRequests[inflightKey] = postPromise;
                }
                const data = await postPromise;
                const endTime = Date.now();

                statusBar.style.display = 'flex';
                statusBar.querySelector('.endpoint').textContent = `${name} - ${endpoint}`;
                statusBar.querySelector('.time').textContent = `${endTime - startTime}ms`;

                resultEl.className = (data.errno === 0 || data.result) ? 'success' : 'error';
                resultEl.textContent = JSON.stringify(data, null, 2);
            } catch (error) {
                resultEl.className = 'error';
                resultEl.textContent = `Error: ${error.message}`;
                statusBar.style.display = 'none';
            }
        }

        async function getSetting() {
            const key = document.getElementById('settingKey').value;
            callAPI(`/api/inverter/settings?key=${encodeURIComponent(key)}`, `Setting: ${key}`);
        }

        // Get current inverter work mode (direct setting, not scheduler)
        async function getWorkMode() {
            const displayEl = document.getElementById('currentWorkMode');
            const sn = document.getElementById('deviceSn').value;
            displayEl.textContent = 'Loading...';
            displayEl.style.color = cssVar('--text-secondary');
            
            try {
                let url = '/api/device/workmode/get';
                if (sn) url += `?sn=${encodeURIComponent(sn)}`;
                const fetchStart = Date.now();
                const response = await authenticatedFetch(url);
                const data = await response.json();
                
                if (data.errno === 0 && data.result) {
                    const result = data.result;
                    const numericToCanonical = {
                        0: 'SelfUse',
                        1: 'Feedin',
                        2: 'Backup',
                        3: 'PeakShaving'
                    };
                    const currentMode = typeof result.workMode === 'string' && result.workMode
                        ? result.workMode
                        : (numericToCanonical[result.value] || result.value);
                    const displayMode = result.displayName || currentMode;
                    
                    displayEl.innerHTML = `<span style="color:${cssVar('--color-success')}">Current:</span> ${displayMode}`;
                    
                    // Select matching option in dropdown
                    const select = document.getElementById('workModeSelect');
                    if (select) {
                        for (let opt of select.options) {
                            if (opt.value === currentMode) {
                                select.value = opt.value;
                                break;
                            }
                        }
                    }
                } else {
                    displayEl.textContent = data.msg || 'Failed to get mode';
                    displayEl.style.color = cssVar('--color-danger');
                }
                
                // Also show in the right panel using the fetched data (avoid duplicate network call)
                try {
                    const resultEl = document.getElementById('result');
                    const statusBar = document.getElementById('status-bar');
                    const fetchEnd = Date.now();
                    if (resultEl) {
                        resultEl.className = (data.errno === 0 && data.result) ? 'success' : 'error';
                        resultEl.textContent = JSON.stringify(data, null, 2);
                    }
                    if (statusBar) {
                        statusBar.style.display = 'flex';
                        const endpointLabel = `Work Mode Setting - ${url}`;
                        try { statusBar.querySelector('.endpoint').textContent = endpointLabel; } catch (e) {}
                        try { statusBar.querySelector('.time').textContent = `${fetchEnd - fetchStart}ms`; } catch (e) {}
                    }
                } catch (e) { /* ignore panel update errors */ }
            } catch (error) {
                displayEl.textContent = `Error: ${error.message}`;
                displayEl.style.color = cssVar('--color-danger');
            }
        }

        // Set inverter work mode (direct setting, not scheduler)
        async function setWorkMode() {
            const displayEl = document.getElementById('currentWorkMode');
            const select = document.getElementById('workModeSelect');
            const workMode = select.value;
            const sn = document.getElementById('deviceSn').value;
            
            if (!workMode) {
                displayEl.textContent = 'Please select a mode';
                displayEl.style.color = cssVar('--color-danger');
                return;
            }
            
            displayEl.textContent = `Setting to ${workMode}...`;
            displayEl.style.color = cssVar('--accent-blue');
            
            try {
                const body = { workMode };
                if (sn) body.sn = sn;
                
                const response = await authenticatedFetch('/api/device/workmode/set', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const data = await response.json();
                
                if (data.errno === 0) {
                    displayEl.innerHTML = `<span style="color:${cssVar('--color-success')}">✓ Set to:</span> ${workMode}`;
                } else {
                    displayEl.textContent = data.msg || 'Failed to set mode';
                    displayEl.style.color = cssVar('--color-danger');
                }
                
                // Show response in right panel
                if (panelCollapsed) togglePanel();
                const resultEl = document.getElementById('result');
                const statusBar = document.getElementById('status-bar');
                statusBar.style.display = 'flex';
                statusBar.querySelector('.endpoint').textContent = `Set Work Mode - /api/device/workmode/set`;
                statusBar.querySelector('.time').textContent = '';
                resultEl.className = data.errno === 0 ? 'success' : 'error';
                resultEl.textContent = JSON.stringify(data, null, 2);
            } catch (error) {
                displayEl.textContent = `Error: ${error.message}`;
                displayEl.style.color = cssVar('--color-danger');
            }
        }

        async function getAllSettings() {
            if (panelCollapsed) togglePanel();
            const resultEl = document.getElementById('result');
            const statusBar = document.getElementById('status-bar');
            const card = document.getElementById('inverterCard');
            const keys = ['MinSoc', 'MinSocOnGrid'];
            
            resultEl.className = '';
            resultEl.textContent = 'Loading all settings...';
            const startTime = Date.now();
            
            try {
                const results = await Promise.all(keys.map(key => 
                    authenticatedFetch(`/api/inverter/settings?key=${encodeURIComponent(key)}`).then(r => r.json())
                ));
                const endTime = Date.now();
                
                const settings = {};
                keys.forEach((key, i) => {
                    if (results[i].errno === 0 && results[i].result) {
                        settings[key] = results[i].result;
                    } else {
                        settings[key] = { error: results[i].msg || 'Failed' };
                    }
                });
                
                statusBar.style.display = 'flex';
                statusBar.querySelector('.endpoint').textContent = 'All Settings';
                statusBar.querySelector('.time').textContent = `${endTime - startTime}ms`;
                
                resultEl.className = 'success';
                resultEl.textContent = JSON.stringify(settings, null, 2);
                
                // Update inverter card with settings
                card.innerHTML = `<div class="stat-row">
                    <div class="stat-item"><div class="value">${settings.MinSoc?.value || '-'}%</div><div class="label">Min SoC</div></div>
                    <div class="stat-item"><div class="value">${settings.MinSocOnGrid?.value || '-'}%</div><div class="label">Min On-Grid</div></div>
                </div>`;
            } catch (error) {
                resultEl.className = 'error';
                resultEl.textContent = `Error: ${error.message}`;
                statusBar.style.display = 'none';
            }
        }

        function updateInverterCard(data, name) {
            const card = document.getElementById('inverterCard');
            if (!data || data.errno !== 0) {
                card.innerHTML = `<div style="color:var(--color-danger);font-size:12px">Error loading data</div>`;
                return;
            }
            
            const result = data.result || [];
            if (name === 'Real-time Data' && Array.isArray(result)) {
                // Helper to find a numeric value from common variable keys or variable name patterns
                function findValue(arr, keysOrPatterns) {
                    if (!Array.isArray(arr)) return null;
                    for (const k of keysOrPatterns) {
                        // try exact match on variable
                        const exact = arr.find(it => (it.variable && it.variable.toString().toLowerCase() === k.toString().toLowerCase()) || (it.key && it.key.toString().toLowerCase() === k.toString().toLowerCase()));
                        if (exact && exact.value !== undefined && exact.value !== null) return exact.value;
                        // try includes match on variable name
                        const incl = arr.find(it => (it.variable && it.variable.toString().toLowerCase().includes(k.toString().toLowerCase())) || (it.key && it.key.toString().toLowerCase().includes(k.toString().toLowerCase())));
                        if (incl && incl.value !== undefined && incl.value !== null) return incl.value;
                    }
                    return null;
                }

                // Normalize a list of datapoints from various FoxESS response shapes
                let items = [];
                if (Array.isArray(result)) {
                    // result may be an array of frames, each with a `datas` array
                    if (result.length > 0 && Array.isArray(result[0].datas)) {
                        result.forEach(r => { if (Array.isArray(r.datas)) items.push(...r.datas); });
                    } else {
                        // assume array of simple datapoints
                        items = result.slice();
                    }
                } else if (result && typeof result === 'object') {
                    if (Array.isArray(result.datas)) items = result.datas.slice();
                    else if (Array.isArray(result.data)) items = result.data.slice();
                    else if (result.result && Array.isArray(result.result.datas)) items = result.result.datas.slice();
                    else if (Array.isArray(result.result)) items = result.result.slice();
                }

                // Try a set of common keys for each concept (case-insensitive)
                // Keys expanded to match FoxESS responses (observe real-time payload)
                const solarKeys = ['generationpower', 'generation', 'pvpower','pv_power','pv','solar','generationpower','acpower','pv1power','pv2power','powerpv'];
                // 'loadsPower' is the FoxESS variable for house load
                const loadKeys = ['loadspower','load','loadpower','houseload','house_load','consumption','load_active_power','loadactivepower','loadsPower'];
                // Grid may come as gridConsumptionPower or feedinPower - handle both
                const gridKeys = ['gridconsumptionpower','grid_consumption_power','gridpower','grid_power','grid','meterpower','gridactivepower','grid_active_power','eim','feedinpower','feed_in'];
                // Battery values may appear as batChargePower / batDischargePower
                const battKeys = ['batchargepower','batcharge','batpower','battery','bms_chg_power','batterycharge','batterydischarge','batdischargepower','battery_current','batchargepower','batdischargepower'];

                // Primary raw values
                const solar = findValue(items, solarKeys);
                const houseLoad = findValue(items, loadKeys);
                // Prefer feed-in and grid consumption separately so we can decide import vs export
                const feedIn = findValue(items, ['feedinpower', 'feed_in', 'feed-in', 'feedin']);
                const gridConsumption = findValue(items, ['gridconsumptionpower', 'grid_consumption_power', 'gridconsumption', 'gridconsumption']);
                const grid = gridConsumption !== null && gridConsumption !== undefined ? gridConsumption : findValue(items, gridKeys);
                // Battery: prefer discharge/charge specific keys
                const batDis = findValue(items, ['batdischargepower', 'bat_discharge_power', 'batdischarge', 'dischargepower']);
                const batChg = findValue(items, ['batchargepower', 'bat_charge_power', 'batcharge', 'chargepower']);
                const battery = (batChg !== null && batChg !== undefined) || (batDis !== null && batDis !== undefined) ? { charge: batChg, discharge: batDis } : findValue(items, battKeys);

                // Compute solar production as manufacturer app expects:
                // PV = load + batteryCharge + feedIn - batteryDischarge - gridImport
                // Fallbacks: if any part missing, try generationPower + batCharge as approximation
                const gen = findValue(items, ['generationpower', 'generation', 'outputpower']);
                function asNumber(v) { return v === null || v === undefined || v === '-' ? 0 : Number(v); }
                let computedSolar = null;
                if (houseLoad !== null || batChg !== null || feedIn !== null || batDis !== null || grid !== null) {
                    // Use numeric values (treat missing as 0)
                    const L = asNumber(houseLoad);
                    const C = asNumber(batChg);
                    const F = asNumber(feedIn);
                    const D = asNumber(batDis);
                    const Gc = asNumber(grid);
                    // grid is reported as gridConsumptionPower (positive when importing)
                    computedSolar = L + C + F - D - Gc;
                }
                // If computedSolar is effectively zero and generation is present, prefer generation + charge
                if ((!computedSolar || computedSolar === 0) && gen !== null && (batChg !== null)) {
                    computedSolar = asNumber(gen) + asNumber(batChg);
                }
                // Prefer backend-normalized solar totals when available, then fall back to legacy heuristics.
                const pvTotal = findValue(items, ['pvPower','pvpower','pv_total','pv_total_power']);
                const acSolarPower = findValue(items, ['acSolarPower', 'acsolarpower']);
                const solarPowerTotal = findValue(items, ['solarPowerTotal', 'solarpowertotal']);
                const meterPower2 = findValue(items, ['meterPower2', 'meter_power_2', 'meter2power']);

                function normalizeTopologyPower(v) {
                    if (v === null || v === undefined || v === '-') return null;
                    const n = Number(v);
                    if (isNaN(n)) return null;
                    // FoxESS payloads are usually kW here; if a large value appears, treat as W.
                    return Math.abs(n) > 100 ? (n / 1000) : n;
                }

                const pvTotalKW = normalizeTopologyPower(pvTotal);
                const acSolarPowerKW = normalizeTopologyPower(acSolarPower);
                const solarPowerTotalKW = normalizeTopologyPower(solarPowerTotal);
                const meterPower2KW = normalizeTopologyPower(meterPower2);
                const allowMeterBasedSolarFallback = Boolean(_providerCapabilities?.supportsTelemetrySourceMapping);
                const isLikelyACCoupled =
                    allowMeterBasedSolarFallback &&
                    (pvTotalKW === null || Math.abs(pvTotalKW) < 0.05) &&
                    (meterPower2KW !== null && Math.abs(meterPower2KW) > 0.05);

                let finalSolar = null;
                if (solarPowerTotalKW !== null) {
                    finalSolar = solarPowerTotalKW;
                } else if (isLikelyACCoupled) {
                    finalSolar = Math.abs(meterPower2KW);
                } else if (pvTotal !== null && pvTotal !== undefined && !isNaN(Number(pvTotal))) {
                    finalSolar = pvTotal;
                } else {
                    // If computedSolar set use it, otherwise fall back to raw solar field
                    finalSolar = (computedSolar !== null && !isNaN(Number(computedSolar))) ? computedSolar : solar;
                }

                // Format helper (kW, one decimal). Some APIs return W — if value seems large, convert to kW.
                function fmtKW(v) {
                    if (v === null || v === undefined || v === '-') return '-';
                    let n = Number(v);
                    if (isNaN(n)) return '-';
                    // if value looks like watts (>100), convert to kW
                    if (Math.abs(n) > 100) n = n / 1000;
                    return n.toFixed(2) + ' kW';
                }

                // Interpret grid using feedIn and gridConsumption when available
                function gridLabel(feedInVal, gridVal) {
                    try {
                        let f = feedInVal !== null && feedInVal !== undefined ? Number(feedInVal) : null;
                        let g = gridVal !== null && gridVal !== undefined ? Number(gridVal) : null;
                        
                        // Convert watts to kW if needed (>100 likely means watts)
                        if (f !== null && !isNaN(f) && Math.abs(f) > 100) f = f / 1000;
                        if (g !== null && !isNaN(g) && Math.abs(g) > 100) g = g / 1000;

                        // if both provided and non-zero, show both
                        if (f !== null && !isNaN(f) && Math.abs(f) > 0 && g !== null && !isNaN(g) && Math.abs(g) > 0) {
                            return `Import ${Math.abs(g).toFixed(2)} kW / Export ${Math.abs(f).toFixed(2)} kW`;
                        }
                        if (g !== null && !isNaN(g) && Math.abs(g) > 0) return `${Math.abs(g).toFixed(2)} kW <span class="substatus">(import)</span>`;
                        if (f !== null && !isNaN(f) && Math.abs(f) > 0) return `${Math.abs(f).toFixed(2)} kW <span class="substatus">(export)</span>`;
                        return '0.00 kW';
                    } catch (e) { return '0.00 kW'; }
                }

                // Interpret battery using separate charge/discharge values when available
                function batteryLabelComposite(objOrVal) {
                    try {
                        if (!objOrVal) return '—';
                        if (typeof objOrVal === 'object') {
                            const ch = objOrVal.charge !== null && objOrVal.charge !== undefined ? Number(objOrVal.charge) : 0;
                            const dis = objOrVal.discharge !== null && objOrVal.discharge !== undefined ? Number(objOrVal.discharge) : 0;
                            if (!isNaN(dis) && dis > 0) {
                                // Convert from watts to kW if value > 100
                                const disKW = Math.abs(dis) > 100 ? dis / 1000 : dis;
                                return `${disKW.toFixed(2)} kW <span class="substatus">(discharging)</span>`;
                            }
                            if (!isNaN(ch) && ch > 0) {
                                // Convert from watts to kW if value > 100
                                const chKW = Math.abs(ch) > 100 ? ch / 1000 : ch;
                                return `${chKW.toFixed(2)} kW <span class="substatus">(charging)</span>`;
                            }
                            return '—';
                        }
                        const n = Number(objOrVal);
                        if (isNaN(n)) return '—';
                        // Convert from watts to kW if value > 100
                        const normalizedN = Math.abs(n) > 100 ? n / 1000 : n;
                        return n > 0 ? `${Math.abs(normalizedN).toFixed(2)} kW <span class="substatus">(charging)</span>` : `${Math.abs(normalizedN).toFixed(2)} kW <span class="substatus">(discharging)</span>`;
                    } catch (e) { return '—'; }
                }

                const solarDisplay = fmtKW(finalSolar);
                const loadDisplay = fmtKW(houseLoad);
                const gridDisplay = grid !== null || feedIn !== null ? gridLabel(feedIn, grid) : '-';
                const batteryDisplay = (typeof battery === 'object' || battery !== null) ? batteryLabelComposite(battery) : batteryLabelComposite(null);

                // Determine coloring for grid and battery
                let batteryIsCharging = false, batteryIsDischarging = false;
                if (typeof battery === 'object') {
                    batteryIsCharging = battery.charge !== null && battery.charge !== undefined && Number(battery.charge) > 0;
                    batteryIsDischarging = battery.discharge !== null && battery.discharge !== undefined && Number(battery.discharge) > 0;
                } else if (battery !== null && battery !== undefined) {
                    const bn = Number(battery);
                    if (!isNaN(bn)) {
                        batteryIsCharging = bn > 0;
                        batteryIsDischarging = bn < 0;
                    }
                }

                // Determine import/export presence robustly. grid/feed in some payloads can be strings
                // (eg "0.01 kW (import)") so we attempt to extract a numeric value when needed.
                let gridIsImport = false, gridIsExport = false;
                const rawG = (grid !== null && grid !== undefined) ? grid : null;
                const rawF = (feedIn !== null && feedIn !== undefined) ? feedIn : null;

                function extractNumberFromRaw(r) {
                    if (r === null || r === undefined) return null;
                    if (typeof r === 'number') return r;
                    // Try to parse direct numeric string
                    if (typeof r === 'string') {
                        // match first number (including decimals and negative)
                        const m = r.match(/-?\d+\.?\d*/);
                        if (m) return Number(m[0]);
                    }
                    const n = Number(r);
                    return isNaN(n) ? null : n;
                }

                const gNumRaw = extractNumberFromRaw(rawG);
                const fNumRaw = extractNumberFromRaw(rawF);
                if (gNumRaw !== null && !isNaN(gNumRaw) && gNumRaw > 0) gridIsImport = true;
                if (fNumRaw !== null && !isNaN(fNumRaw) && fNumRaw > 0) gridIsExport = true;

                // Helper: simple normalization to kW for small-value checks
                function _normToKWForSmall(v) {
                    if (v === null || v === undefined) return null;
                    const n = Number(v);
                    if (isNaN(n)) return null;
                    // Heuristic: large numbers are likely in watts
                    if (Math.abs(n) > 100) return n / 1000;
                    return n;
                }

                // Compute a battery power (kW) for small-value heuristics
                let batteryPowerKW = null;
                if (typeof battery === 'object') {
                    if (batteryIsCharging && battery.charge !== undefined && battery.charge !== null) batteryPowerKW = _normToKWForSmall(battery.charge);
                    else if (batteryIsDischarging && battery.discharge !== undefined && battery.discharge !== null) batteryPowerKW = _normToKWForSmall(battery.discharge);
                    else {
                        // fallback to raw keys if present in payload
                        batteryPowerKW = batteryIsCharging && typeof batChg !== 'undefined' ? _normToKWForSmall(batChg) : (batteryIsDischarging && typeof batDis !== 'undefined' ? _normToKWForSmall(batDis) : null);
                    }
                } else if (battery !== null && battery !== undefined) {
                    batteryPowerKW = _normToKWForSmall(battery);
                }

                // If the battery power is tiny (<0.05 kW) show it as neutral/gray
                const SMALL_BATT_THRESHOLD = 0.05; // kW
                let batteryClass = '';
                if (batteryPowerKW !== null && !isNaN(batteryPowerKW) && Math.abs(batteryPowerKW) < SMALL_BATT_THRESHOLD) {
                    batteryClass = 'price-neutral';
                } else {
                    batteryClass = batteryIsCharging ? 'price-low' : (batteryIsDischarging ? 'price-high' : '');
                }
                // Normalise grid/feed values to kW and keep very small values (close to zero)
                // displayed as neutral/gray. User requested values under 0.05 kW remain gray.
                // Try to find the original items so we can detect units (W vs kW)
                function findItemByKeys(keys) {
                    if (!Array.isArray(items)) return null;
                    for (const k of keys) {
                        const exact = items.find(it => (it.variable && it.variable.toString().toLowerCase() === k.toString().toLowerCase()) || (it.key && it.key.toString().toLowerCase() === k.toString().toLowerCase()));
                        if (exact) return exact;
                        const incl = items.find(it => (it.variable && it.variable.toString().toLowerCase().includes(k.toString().toLowerCase())) || (it.key && it.key.toString().toLowerCase().includes(k.toString().toLowerCase())));
                        if (incl) return incl;
                    }
                    return null;
                }

                function normalizedKWFromValue(val, item) {
                    if (val === null || val === undefined) return null;
                    const n = Number(val);
                    if (isNaN(n)) return null;

                    // If the variable includes a unit string, prefer that
                    const unit = (item && item.unit) ? item.unit.toString().toLowerCase() : '';
                    if (unit.includes('kw')) return n; // already kW
                    if (unit.includes('w')) return n / 1000; // watts -> kW

                    // Fallback heuristics: if value looks large assume watts, otherwise assume kW
                    // Treat values > 100 as watts, convert to kW
                    if (Math.abs(n) > 100) return n / 1000;

                    // If dividing by 1000 produces a value that would be considered "close to zero"
                    // (e.g., 10 -> 0.01), prefer the divided value because many small W values are reported
                    // and should be interpreted as kW when deciding if they're 'near zero'. This is safer
                    // for tiny readings (e.g. 10 -> 0.01 kW) which we want to keep neutral.
                    if (Math.abs(n) / 1000 < 0.05 && Math.abs(n) >= 1) return n / 1000;

                    // Otherwise treat as already kW
                    return n;
                }

                // Use raw values (or extracted numeric) to normalise to kW
                const gKW = normalizedKWFromValue(gNumRaw !== null ? gNumRaw : rawG, findItemByKeys(['gridconsumptionpower','grid_consumption_power','gridpower','grid_power','grid','meterpower','gridactivepower','grid_active_power','eim','feedin','feed_in','feed-in']));
                const fKW = normalizedKWFromValue(fNumRaw !== null ? fNumRaw : rawF, findItemByKeys(['feedinpower','feed_in','feed-in','feedin']));
                let gridClass = '';
                if (gridIsImport && gKW !== null && Math.abs(gKW) < 0.05) {
                    // small import — show neutral/gray
                    gridClass = 'price-neutral';
                } else if (gridIsExport && fKW !== null && Math.abs(fKW) < 0.05) {
                    // small export — show neutral/gray
                    gridClass = 'price-neutral';
                } else {
                    gridClass = gridIsImport ? 'price-high' : (gridIsExport ? 'price-low' : 'price-neutral');
                }

                // Fallback: if the formatted label contains a numeric reading and that number is < 0.05 kW
                // treat it as near-zero and keep the display neutral. This covers cases where raw
                // values weren't easily parseable earlier.
                try {
                    if (typeof gridDisplay === 'string') {
                        const m = gridDisplay.match(/-?\d+\.?\d*/);
                        if (m) {
                            const parsed = Number(m[0]);
                            if (!isNaN(parsed) && Math.abs(parsed) < 0.05) {
                                gridClass = 'price-neutral';
                            }
                        }
                    }
                } catch (e) { /* ignore fallback parse errors */ }
                // end try

                // Battery capacity from user config (kWh). Defaulting to legacy value until config loads.
                const BATTERY_CAP_KWH = _batteryCapacityKwh;

                // Try to find SoC in the real-time feed
                const socVal = findValue(items, ['soc','socvalue','SoC','batSoc','bms_soc','stateofcharge','batterySoc','socpercent']);
                const socNum = (socVal !== null && socVal !== undefined && !isNaN(Number(socVal))) ? Number(socVal) : null;

                // helper to normalise numeric power into kW (some endpoints return W)
                function toKW(v) {
                    if (v === null || v === undefined || v === '-') return null;
                    let n = Number(v);
                    if (isNaN(n)) return null;
                    if (Math.abs(n) > 2000) n = n / 1000; // treat as W -> kW
                    return n;
                }

                // Compute estimated time to reach target energy when charging/discharging
                let batteryTimeText = '';
                const currentEnergyKWh = (socNum !== null) ? (socNum / 100.0) * BATTERY_CAP_KWH : null;
                const chKW = (batChg !== null && batChg !== undefined) ? toKW(batChg) : (battery && battery.charge ? toKW(battery.charge) : null);
                const disKW = (batDis !== null && batDis !== undefined) ? toKW(batDis) : (battery && battery.discharge ? toKW(battery.discharge) : null);

                function fmtTimeHours(h) {
                    if (!h || !isFinite(h) || h <= 0) return null;
                    const totMin = Math.round(h * 60);
                    const hours = Math.floor(totMin / 60);
                    const mins = totMin % 60;
                    if (hours === 0) return `${mins}m`;
                    return `${hours}h ${mins}m`;
                }

                if (batteryIsCharging && chKW && chKW > 0 && currentEnergyKWh !== null) {
                    const energyNeeded = Math.max(0, BATTERY_CAP_KWH - currentEnergyKWh);
                    if (energyNeeded <= 0) batteryTimeText = 'Full';
                    else {
                        // base hours to full at current power (kW)
                        let hrs = energyNeeded / chKW;

                        // Add a 5% buffer for the portion of charge above 90% SoC
                        // Battery slows when >90%, so if current or future charge includes >90% portion we increase time accordingly
                        const ninetyKwh = 0.9 * BATTERY_CAP_KWH;
                        if (currentEnergyKWh >= ninetyKwh) {
                            // already beyond 90% — apply full 5% buffer
                            hrs *= 1.05;
                        } else if ((currentEnergyKWh + energyNeeded) > ninetyKwh) {
                            // charging will cross 90% — only apply buffer proportional to the portion above 90%
                            const portionAbove90 = (currentEnergyKWh + energyNeeded) - ninetyKwh;
                            const proportion = portionAbove90 / energyNeeded; // 0..1
                            hrs *= (1 + 0.05 * proportion);
                        }

                        const s = fmtTimeHours(hrs);
                        batteryTimeText = s ? `≈ ${s} to ${BATTERY_CAP_KWH.toFixed(2)} kWh` : '';
                    }
                } else if (batteryIsDischarging && disKW && disKW > 0 && currentEnergyKWh !== null) {
                    const targetEnergy = 0.2 * BATTERY_CAP_KWH; // 20%
                    const energyAvailable = Math.max(0, currentEnergyKWh - targetEnergy);
                    if (energyAvailable <= 0) batteryTimeText = `≤ 20% (${targetEnergy.toFixed(3)} kWh)`;
                    else {
                        const hrs = energyAvailable / disKW;
                        const s = fmtTimeHours(hrs);
                        batteryTimeText = s ? `≈ ${s} to 20% (${targetEnergy.toFixed(3)} kWh)` : '';
                    }
                }

                // Helper for temperature class: <40 green, <55 amber, >=55 red
                function tempClassRealtime(v) {
                    if (v === undefined || v === null || isNaN(Number(v))) return '';
                    const n = Number(v);
                    if (n < 40) return 'price-low';
                    if (n < 55) return 'price-mid';
                    return 'price-high';
                }

                // Pull real-time temperatures if present
                let batTempVal = findValue(items, ['batTemperature','bat_temperature','batterytemperature','batTemp','batteryTemp','battemperation']);
                let ambTempVal = findValue(items, ['ambientTemperation','ambienttemperature','ambient_temp','ambientTemp','ambTemperature']);
                let invTempVal = findValue(items, ['invTemperation','invtemperature','invertertemperature','invTemp','inverterTemp']);

                const isAlphaProvider = String(_userProvider || '').toLowerCase() === 'alphaess';
                const batTempNum = Number(batTempVal);
                const ambTempNum = Number(ambTempVal);
                const invTempNum = Number(invTempVal);
                const alphaTempsLikelyUnavailable = isAlphaProvider
                    && Number.isFinite(batTempNum)
                    && Number.isFinite(ambTempNum)
                    && batTempNum === 0
                    && ambTempNum === 0
                    && (!Number.isFinite(invTempNum) || invTempNum === 0);
                if (alphaTempsLikelyUnavailable) {
                    batTempVal = null;
                    ambTempVal = null;
                    invTempVal = null;
                }

                function fmtTemp(v) { if (v === null || v === undefined || v === '-') return '-'; const n = Number(v); if (isNaN(n)) return '-'; return n.toFixed(1) + '°C'; }

                // Create an inline thermometer SVG string for a temperature value
                // Visual idea: a bulb + tube. Fill level mapped from 0..80°C (clamped).
                function makeThermSVG(v) {
                    const n = (v === null || v === undefined || v === '-') ? null : Number(v);
                    const minT = 0; const maxT = 80; // range mapped to 0..100%
                    const pct = (n === null || isNaN(n)) ? 0 : Math.max(0, Math.min(1, (n - minT) / (maxT - minT)));
                    // tube inner height (px) and geometry tuned for viewBox
                    const innerH = 34; // tube height
                    const fillH = Math.round(pct * innerH);
                    const tubeX = 8; const tubeW = 8; const tubeY = 4;
                    const y = tubeY + (innerH - fillH);
                    // color thresholds: <40 green, <55 amber, >=55 red
                    const fillColor = (n === null || isNaN(n)) ? 'rgba(255,255,255,0.06)' : (n < 40 ? 'var(--color-success-dark)' : (n < 55 ? 'var(--color-warning)' : 'var(--color-danger)'));
                    // return compact SVG (class "therm-svg" for styling)
                    return `
                        <div class="tile-icon thermometer" aria-hidden="true">
                            <svg class="therm-svg" viewBox="0 0 24 48" xmlns="http://www.w3.org/2000/svg">
                                <!-- outer tube -->
                                <rect x="${tubeX}" y="${tubeY}" width="${tubeW}" height="${innerH}" rx="4" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1.5" />
                                <!-- fill (matches tube rounded corners) -->
                                <rect x="${tubeX}" y="${y}" width="${tubeW}" height="${fillH}" rx="3" fill="${fillColor}" class="therm-fill" />
                                <!-- bulb -->
                                <circle cx="12" cy="42" r="6.5" fill="${fillColor}" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
                                <circle cx="12" cy="42" r="6.5" fill-opacity="0.12" />
                            </svg>
                        </div>`;
                }

                const batTempCls = tempClassRealtime(batTempVal);
                const ambTempCls = tempClassRealtime(ambTempVal);
                const invTempCls = tempClassRealtime(invTempVal);

                // Check if curtailment is active
                const curtailmentActive = window.curtailmentState && window.curtailmentState.active;
                const solarTileClass = curtailmentActive ? 'stat-item curtailed' : 'stat-item';
                const curtailmentLabel = curtailmentActive ? ' (Curtailed)' : '';

                const html = `<div class="stat-row">
                    <div class="${solarTileClass}" id="solar-tile"><div class="tile-icon tile-icon--glyph">${overviewIconChipHtml('solar', 'app-overview-icon--tile')}</div><div class="value">${solarDisplay}</div><div class="label">Solar Production${curtailmentLabel}</div></div>
                    <div class="stat-item"><div class="tile-icon tile-icon--glyph">${overviewIconChipHtml('home', 'app-overview-icon--tile')}</div><div class="value">${loadDisplay}</div><div class="label">House Load</div></div>
                    <div class="stat-item"><div class="tile-icon tile-icon--glyph">${overviewIconChipHtml('grid', 'app-overview-icon--tile')}</div><div class="value ${gridClass}">${gridDisplay}</div><div class="label">Grid Import/Export</div></div>
                    <div class="stat-item battery-tile"><div class="tile-icon battery ${batteryIsCharging ? 'charging' : ''}">
                                <!-- Inline SVG battery: fill level reflects SoC -->
                                ${(() => {
                                    const socPct = (socNum !== null && !isNaN(Number(socNum))) ? Math.max(0, Math.min(100, Number(socNum))) : 0;
                                    // innerHeight = 28 (y from 4..32). Compute rect y and height so fill starts at bottom
                                    const innerH = 28;
                                    const fillH = Math.round((socPct / 100) * innerH);
                                    const y = 4 + (innerH - fillH);
                                    // Conditional coloring: green >=50%, amber 25-44%, red <25%
                                    const fillColor = socPct >= 50 ? 'var(--color-success-dark)' : (socPct >= 25 ? 'var(--color-warning)' : 'var(--color-danger)');
                                    return `
                                    <svg viewBox="0 0 24 40" aria-hidden="true">
                                        <rect x="3" y="4" width="18" height="28" rx="3" ry="3" fill="var(--battery-shell-bg)"></rect>
                                        <rect x="3" y="4" width="18" height="28" rx="3" ry="3" fill="none" stroke="var(--battery-shell-color)" stroke-width="1.5"></rect>
                                        <rect x="3" y="${y}" width="18" height="${fillH}" rx="2" ry="2" class="level" fill="${fillColor}"></rect>
                                        <rect x="9" y="1" width="6" height="2" rx="1" ry="1" fill="var(--battery-shell-color)"></rect>
                                    </svg>`;
                                })()}
                            </div>
                            <div class="value ${batteryClass}" style="font-size:20px;font-weight:600">${batteryDisplay}</div>
                        <div style="font-size:28px;font-weight:700;color:var(--accent-blue);margin-top:4px">${socNum !== null ? socNum.toFixed(0) + '%' : '-'}</div>
                        <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">${currentEnergyKWh !== null ? (currentEnergyKWh.toFixed(2) + ' kWh') : ''}</div>
                        <div style="font-size:11px;color:var(--text-secondary);margin-top:4px">${batteryTimeText || ''}</div>
                    </div>
                </div>

                <!-- Inline temps row for real-time display -->
                <div class="stat-row" style="margin-top:8px">
                        <div class="stat-item" style="min-width:140px">
                            ${makeThermSVG(batTempVal)}
                            <div class="value ${batTempCls}" style="font-size:18px">${batTempVal !== null && batTempVal !== undefined ? fmtTemp(batTempVal) : '-'}</div>
                            <div class="label">Battery Temp</div>
                        </div>
                    <div class="stat-item" style="min-width:140px">
                        ${makeThermSVG(ambTempVal)}
                        <div class="value ${ambTempCls}" style="font-size:18px">${ambTempVal !== null && ambTempVal !== undefined ? fmtTemp(ambTempVal) : '-'}</div>
                        <div class="label">Ambient Temp</div>
                    </div>
                    <div class="stat-item" style="min-width:140px">
                        ${makeThermSVG(invTempVal)}
                        <div class="value ${invTempCls}" style="font-size:18px">${invTempVal !== null && invTempVal !== undefined ? fmtTemp(invTempVal) : '-'}</div>
                        <div class="label">Inverter Temp</div>
                    </div>
                </div>`;
                const tempNoticeHtml = alphaTempsLikelyUnavailable
                    ? `<div style="margin-top:6px;font-size:11px;color:var(--text-secondary);text-align:center;">AlphaESS is currently not reporting temperature sensors.</div>`
                    : '';
                // Debug raw view removed for stable inverter status
                const rawHtml = '';

                // Display per-PV-string outputs if present (pv1Power..pv4Power)
                const pvStrings = [];
                for (let i = 1; i <= 4; i++) {
                    const pKey = `pv${i}power`;
                    const vKey = `pv${i}volt`;
                    const cKey = `pv${i}current`;
                    const p = findValue(items, [pKey, `pv${i}Power`]);
                    const v = findValue(items, [vKey, `pv${i}Volt`]);
                    const c = findValue(items, [cKey, `pv${i}Current`]);
                    if (p !== null && p !== undefined) pvStrings.push({ idx: i, power: p, volt: v, current: c });
                }
                // Also include aggregated pvPower if available
                const pvPowerTotal = findValue(items, ['pvPower','pvpower']);
                const hasAcSolarBreakdown = acSolarPower !== null && acSolarPower !== undefined;
                const hasSolarBreakdown = pvStrings.length > 0 || hasAcSolarBreakdown;

                if (hasSolarBreakdown) {
                    let pvHtml = '<div style="margin-top:12px;font-size:12px;color:var(--text-secondary);font-weight:600">';
                    pvHtml += hasAcSolarBreakdown ? '🔸 Solar Inputs' : '🔸 PV String Outputs';
                    const breakdownTotal = solarPowerTotal !== null && solarPowerTotal !== undefined
                        ? solarPowerTotal
                        : (pvPowerTotal !== null && pvPowerTotal !== undefined ? pvPowerTotal : finalSolar);
                    if (breakdownTotal !== null && breakdownTotal !== undefined) {
                        pvHtml += ` <span style="color:var(--color-success);font-weight:700">(Total: ${fmtKW(breakdownTotal)})</span>`;
                    }
                    pvHtml += '</div>';
                    pvHtml += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">';
                    pvStrings.forEach(s => {
                        const voltStr = s.volt !== null && s.volt !== undefined ? `${Number(s.volt).toFixed(1)}V` : '-';
                        const currStr = s.current !== null && s.current !== undefined ? `${Number(s.current).toFixed(1)}A` : '-';
                        const pvColor = (Number(s.power) === 0) ? 'var(--text-secondary)' : 'var(--color-success)';
                        pvHtml += `<div class="stat-item" style="min-width:90px;padding:10px;text-align:center">
                            <div class="value" style="font-size:18px;font-weight:700;color:${pvColor}">${fmtKW(s.power)}</div>
                            <div class="label" style="font-size:12px;color:var(--accent-blue);margin-top:4px;font-weight:600">PV${s.idx}</div>
                            <div style="font-size:10px;color:var(--text-secondary);margin-top:4px">${voltStr} · ${currStr}</div>
                        </div>`;
                    });

                    if (hasAcSolarBreakdown) {
                        if (!pvStrings.length && pvPowerTotal !== null && pvPowerTotal !== undefined) {
                            pvHtml += `<div class="stat-item" style="min-width:110px;padding:10px;text-align:center">
                                <div class="value" style="font-size:18px;font-weight:700;color:var(--color-success)">${fmtKW(pvPowerTotal)}</div>
                                <div class="label" style="font-size:12px;color:var(--accent-blue);margin-top:4px;font-weight:600">DC Solar</div>
                                <div style="font-size:10px;color:var(--text-secondary);margin-top:4px">Fox PV input</div>
                            </div>`;
                        }
                        pvHtml += `<div class="stat-item" style="min-width:110px;padding:10px;text-align:center">
                            <div class="value" style="font-size:18px;font-weight:700;color:var(--accent)">${fmtKW(acSolarPower)}</div>
                            <div class="label" style="font-size:12px;color:var(--accent-blue);margin-top:4px;font-weight:600">AC Solar</div>
                            <div style="font-size:10px;color:var(--text-secondary);margin-top:4px">Mapped external source</div>
                        </div>`;
                    }

                    pvHtml += '</div>';
                    card.innerHTML = html + tempNoticeHtml + pvHtml;
                } else {
                    card.innerHTML = html + tempNoticeHtml;
                }
            } else if (name === 'Battery SoC' && data.result) {
                const r = data.result;
                card.innerHTML = `<div class="stat-row">
                    <div class="stat-item"><div class="value">${r.minSoc || '-'}%</div><div class="label">Min SoC</div></div>
                    <div class="stat-item"><div class="value">${r.minSocOnGrid || '-'}%</div><div class="label">Min On-Grid</div></div>
                </div>`;
            } else if (name === 'Temperatures' && Array.isArray(result) && result[0]?.datas) {
                const temps = result[0].datas;
                const batTemp = temps.find(t => t.variable === 'batTemperature');
                const ambTemp = temps.find(t => t.variable === 'ambientTemperation');
                const invTemp = temps.find(t => t.variable === 'invTemperation');
                const time = result[0].time || '';

                // Temperature threshold helper: <40 green, <55 amber, >=55 red
                function tempClass(v) {
                    if (v === undefined || v === null || isNaN(Number(v))) return '';
                    const n = Number(v);
                    if (n < 40) return 'price-low';
                    if (n < 55) return 'price-mid';
                    return 'price-high';
                }

                const batCls = tempClass(batTemp?.value);
                const ambCls = tempClass(ambTemp?.value);
                const invCls = tempClass(invTemp?.value);

                card.innerHTML = `
                    <div class="stat-row">
                        <div class="stat-item" style="flex:2">
                            <div class="value ${batCls}" style="font-size:28px">🔋 ${batTemp ? batTemp.value : '-'}°C</div>
                            <div class="label">Battery Temperature</div>
                        </div>
                    </div>
                    <div class="stat-row" style="margin-top:8px">
                        <div class="stat-item"><div class="value ${ambCls}">${ambTemp ? ambTemp.value : '-'}°C</div><div class="label">Ambient</div></div>
                        <div class="stat-item"><div class="value ${invCls}">${invTemp ? invTemp.value : '-'}°C</div><div class="label">Inverter</div></div>
                    </div>
                    <div style="font-size:10px;color:var(--text-secondary);margin-top:6px;text-align:center">${time}</div>`;
            } else if (name === 'Generation' && data.result) {
                const r = data.result;
                card.innerHTML = `<div class="stat-row">
                    <div class="stat-item"><div class="value">${r.today?.toFixed(1) || '-'} kWh</div><div class="label">Today</div></div>
                    <div class="stat-item"><div class="value">${r.month?.toFixed(1) || '-'} kWh</div><div class="label">Month</div></div>
                    <div class="stat-item"><div class="value">${r.cumulative?.toFixed(0) || '-'} kWh</div><div class="label">Total</div></div>
                </div>`;
            } else {
                card.innerHTML = `<div style="color:var(--color-success);font-size:12px">✓ ${name} loaded - see response panel</div>`;
            }
        }

        // Weather
        async function getWeather(force = false) {
            const placeEl = document.getElementById('weatherPlace');
            const rawPlace = (placeEl && typeof placeEl.value === 'string') ? placeEl.value.trim() : '';
            // Guard against the literal string 'undefined' (can appear from bad inputs)
            const cleanRaw = (rawPlace && rawPlace !== 'undefined') ? rawPlace : '';
            const place = cleanRaw || 'Sydney, Australia';
            // normalize back into the input (helps when using autocomplete)
            try { if (placeEl) placeEl.value = (place === 'Sydney, Australia' ? placeEl.value || place : place); } catch (e) {}

            // Prefer the saved user preference input if present (settings page uses id
            // 'preferences_forecastDays'). If not present, use the weatherDays control.
            const prefEl = document.getElementById('preferences_forecastDays');
            const primaryEl = document.getElementById('weatherDays');
            let days = CONFIG?.preferences?.forecastDays || 6;
            try {
                if (prefEl && prefEl.value && String(prefEl.value).trim()) {
                    days = Number(prefEl.value);
                } else if (primaryEl && primaryEl.value && String(primaryEl.value).trim()) {
                    days = Number(primaryEl.value);
                }
            } catch (e) { /* use CONFIG value */ }

            if (isPreviewMode()) {
                const previewWeather = getMockWeatherData(place, days);
                renderWeatherCard(previewWeather);
                setLastUpdated('weather');
                document.getElementById('result').textContent = JSON.stringify({ errno: 0, result: previewWeather, preview: true }, null, 2);
                document.getElementById('status-bar').style.display = 'flex';
                document.getElementById('status-bar').querySelector('.endpoint').textContent = `Weather Preview - ${previewWeather.place.resolvedName}`;
                return;
            }
            
            // Check if cached weather is still fresh (30 minutes TTL matches backend)
            // IMPORTANT: Cache key must include the requested days so we don't return stale cache
            // when user requests a different number of forecast days
            // ALSO: Invalidate cache if the calendar day has changed to get fresh forecasts
            const cacheState = JSON.parse(localStorage.getItem('cacheState') || '{}');
            const cachedDays = cacheState.weatherDays || 0;
            const cachedDate = cacheState.weatherDate || null;  // Track the calendar day
            const today = new Date().toISOString().substring(0, 10);  // YYYY-MM-DD
            const age = Date.now() - (cacheState.weatherTime || 0);
            
            // Force refresh if requested, page reloaded, or currently impersonating another user
            // (impersonation: admin's localStorage cache has their location, not the target user's)
            const isImpersonating = typeof getImpersonationUid === 'function' && !!getImpersonationUid();
            const shouldBypassCache = force || isPageReload || isImpersonating;
            
            if (!shouldBypassCache && cacheState.weatherTime && age < CONFIG.cache.weather && cachedDays === days && cachedDate === today) {
                // Load cached full weather object and render it
                try {
                    const cachedWeatherFull = JSON.parse(localStorage.getItem('cachedWeatherFull') || '{}');
                    if (cachedWeatherFull.place || cachedWeatherFull.current) {
                        renderWeatherCard(cachedWeatherFull);
                        setLastUpdated('weather');
                        return;
                    }
                } catch (e) { console.error('[Cache] Error loading weather cache:', e); }
            }
            
            const card = document.getElementById('weatherCard');
            card.innerHTML = '<div style="color:var(--text-secondary)">Loading weather...</div>';

            try {
                let url = `/api/weather?place=${encodeURIComponent(place)}&days=${days}`;
                // Add forceRefresh if force flag is set
                if (force) {
                    url += '&forceRefresh=true';
                }
                const resp = await authenticatedFetch(url);
                const data = await resp.json();
                
                // Handle wrapped {errno, result} response format
                let weatherData = data;
                if (data.errno === 0 && data.result) {
                    weatherData = data.result;
                }
                
                // Cache weather data - full object for dashboard, simplified for test.html
                if (weatherData?.hourly) {
                    try {
                        // Cache FULL weather object for rendering on dashboard
                        localStorage.setItem('cachedWeatherFull', JSON.stringify(weatherData));
                        
                        // Also cache simplified data for automation test page
                        const hourly = weatherData.hourly;
                        const current = weatherData.current || {};
                        // Find current hour index for accurate solar radiation
                        // Use API's current time (which is in local timezone) instead of JS Date (which is UTC)
                        let currentHourIdx = 0;
                        if (hourly.time && Array.isArray(hourly.time)) {
                            const currentTime = current?.time || new Date().toISOString();
                            const currentHourStr = currentTime.substring(0, 13); // YYYY-MM-DDTHH
                            currentHourIdx = hourly.time.findIndex(t => t && t.substring(0, 13) === currentHourStr);
                            if (currentHourIdx < 0) currentHourIdx = 0;
                        }
                        const wxCache = {
                            solarRadiation: hourly.shortwave_radiation?.[currentHourIdx] || 0,
                            cloudCover: hourly.cloud_cover?.[currentHourIdx] || hourly.cloudcover?.[currentHourIdx] || 0
                        };
                        localStorage.setItem('cachedWeather', JSON.stringify(wxCache));
                        
                        // Update cache timestamp AND store the requested days and date so we know if cache is valid
                        const cacheState = JSON.parse(localStorage.getItem('cacheState') || '{}');
                        cacheState.weatherTime = Date.now();
                        cacheState.weatherDays = days;  // Store the days count for cache validation
                        cacheState.weatherDate = new Date().toISOString().substring(0, 10);  // Store today's date (YYYY-MM-DD)
                        localStorage.setItem('cacheState', JSON.stringify(cacheState));
                    } catch (e) { /* ignore cache errors */ }
                }
                
                renderWeatherCard(weatherData);
                // mark last updated for weather
                setLastUpdated('weather');

                // Update visible location display with API-resolved name when available
                try {
                    const resolvedDisplay = (weatherData?.place?.resolvedName && !weatherData?.place?.fallback)
                        ? weatherData.place.resolvedName
                        : place;
                    const wDisp = document.getElementById('weatherPlaceDisplay');
                    if (wDisp && resolvedDisplay) wDisp.textContent = resolvedDisplay;
                } catch (e) {}

                // Show full payload in the result panel
                document.getElementById('result').textContent = JSON.stringify(data, null, 2);
                // If API returned a resolved place name, prefer that in the status bar
                document.getElementById('status-bar').style.display = 'flex';
                // Prefer the API-resolved name for display, but only if it was
                // genuinely resolved (i.e. the server did not fall back to defaults).
                // We still derive the dismissal key from resolvedName or the query
                // (so it remains stable across page-load vs manual searches).
                const resolved = (data && data.place && data.place.resolvedName && !data.place.fallback) ? data.place.resolvedName : '';
                // Use the original query as the dismissal key when available so the
                // user-dismiss action applies to their typed query (not a backend
                // resolved/fallback name). Fallback to resolvedName if query missing.
                const locKeySource = (data && data.place && (data.place.query || data.place.resolvedName)) ? (data.place.query || data.place.resolvedName) : place;
                // build a sanitized key for dismissals (use locKeySource so key is stable)
                const locKey = (locKeySource || 'unknown').toString().trim().toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_-]/g,'');
                let endpointText = resolved ? `Weather - ${resolved}` : 'Weather';
                // If server indicated it used fallback coordinates, make that visible to user
                let dismissed = false;
                try { dismissed = !!localStorage.getItem('weatherFallbackDismissed:' + locKey); } catch (e) { dismissed = false; }
                if (data && data.place && data.place.fallback && !dismissed) {
                    endpointText += ' (used fallback coords)';
                    // also make status-bar visually noticeable
                    document.getElementById('status-bar').style.border = '1px solid var(--color-warning)';
                } else {
                    document.getElementById('status-bar').style.border = '';
                }
                document.getElementById('status-bar').querySelector('.endpoint').textContent = endpointText;
            } catch (e) {
                card.innerHTML = `<div style="color:var(--color-danger)">Error: ${e.message}</div>`;
            }
        }

        function weatherCodeToWord(code) {
            // Map Open-Meteo / WMO weather codes to simple one-word descriptions
            const c = Number(code);
            if (c === 0) return 'Clear';
            if (c === 1 || c === 2) return 'Partly Cloudy';
            if (c === 3) return 'Overcast';
            if (c === 45 || c === 48) return 'Fog';
            if ([51,53,55].includes(c)) return 'Drizzle';
            if ([56,57].includes(c)) return 'Freezing Drizzle';
            if ([61,63,65].includes(c)) return 'Rain';
            if ([66,67].includes(c)) return 'Freezing Rain';
            if ([71,73,75,77].includes(c)) return 'Snow';
            if ([80,81,82].includes(c)) return 'Showers';
            if ([85,86].includes(c)) return 'Snow Showers';
            if (c === 95 || c === 96 || c === 99) return 'Thunderstorm';
            return 'Unknown';
        }

        // Ensure Leaflet is loaded (returns a Promise). Loads CSS+JS once via CDN.
        function ensureLeafletLoaded() {
            if (window._leafletPromise) return window._leafletPromise;
            window._leafletPromise = new Promise((resolve, reject) => {
                // If L already exists, resolve immediately
                if (window.L) return resolve(window.L);

                // Load CSS
                try {
                    const cssId = 'leaflet-css';
                    if (!document.getElementById(cssId)) {
                        const link = document.createElement('link');
                        link.id = cssId;
                        link.rel = 'stylesheet';
                        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
                        link.crossOrigin = '';
                        document.head.appendChild(link);
                    }
                } catch (e) { /* ignore */ }

                // Load script
                const jsId = 'leaflet-js';
                if (document.getElementById(jsId)) {
                    // wait for it to be available
                    const waitForL = setInterval(() => {
                        if (window.L) {
                            clearInterval(waitForL);
                            resolve(window.L);
                        }
                    }, 50);
                    // timeout safety
                    setTimeout(() => { clearInterval(waitForL); if (!window.L) reject(new Error('Leaflet failed to load')); }, 8000);
                    return;
                }

                const script = document.createElement('script');
                script.id = jsId;
                script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
                script.async = true;
                script.onload = () => {
                    if (window.L) resolve(window.L);
                    else reject(new Error('Leaflet loaded but L not available'));
                };
                script.onerror = () => reject(new Error('Failed to load Leaflet script'));
                document.head.appendChild(script);
            });
            return window._leafletPromise;
        }

        // Update the small label showing how many days are requested by the control
        function updateWeatherRequestedLabel() {
            try {
                const prefEl = document.getElementById('preferences_forecastDays');
                const el = document.getElementById('weatherDays');
                const lbl = document.getElementById('weatherRequestedLabel');
                if (!lbl) return;
                // Prefer user preferences input if present (settings page may expose it)
                const prefVal = prefEl && prefEl.value ? String(prefEl.value).trim() : null;
                const controlVal = el && el.value ? String(el.value).trim() : null;
                const v = prefVal || controlVal || String(CONFIG?.preferences?.forecastDays || 6);
                lbl.textContent = `${v}d`;
            } catch (e) { /* ignore */ }
        }

        function renderWeatherCard(data) {
            const card = document.getElementById('weatherCard');
            if (!data) { card.innerHTML = '<div style="color:var(--color-danger)">No data</div>'; return; }

            const place = data.place || {};
            const current = data.current || null;
            const daily = data.daily || null;

            // Build a concise location header: prefer API-resolved name, show country and coords if available
            // Show the resolved name when available. If the server used fallback
            // coordinates, prefer a friendly `fallbackResolvedName` (provided by
            // the backend) so we can display a human-readable fallback place.
            let locName = '';
            if (place && typeof place === 'object') {
                const tryName = (v) => (v === undefined || v === null || String(v).toLowerCase() === 'undefined') ? '' : String(v);
                if (place.fallback && tryName(place.fallbackResolvedName)) {
                    locName = tryName(place.fallbackResolvedName);
                } else if (tryName(place.resolvedName) && !place.fallback) {
                    locName = tryName(place.resolvedName);
                }
            }
            const lat = (place.latitude !== undefined && place.latitude !== null) ? Number(place.latitude).toFixed(4) : null;
            const lon = (place.longitude !== undefined && place.longitude !== null) ? Number(place.longitude).toFixed(4) : null;
            // sanitized key for map/banner instances (based on user's query when available)
            const locKey = (place.query || place.resolvedName || 'unknown').toString().trim().toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_-]/g,'');
            const country = place.country || '';
            let locExtra = '';
            if (country) locExtra += country;
            if (lat !== null && lon !== null) locExtra += (locExtra ? ' • ' : '') + `${lat}, ${lon}`;
            // Show weather source (Open-Meteo)
            const source = data.source || 'open-meteo';
            if (locExtra) locExtra += ` • <span style="opacity:0.7">${source}</span>`;
            else if (lat !== null && lon !== null) locExtra = `${lat}, ${lon} • <span style="opacity:0.7">${source}</span>`;
            else locExtra = `<span style="opacity:0.7">${source}</span>`;
            // If the API resolved a location name, show it. If not, show a friendly
            // label and include an info icon when the server fell back to coordinates.
            let headerTooltip = '';
            if (place && place.fallback) {
                const reasonText = (place.fallbackReason || 'unknown').replace(/_/g,' ');
                headerTooltip = ` <span class="info-tip" title="Using fallback coordinates: ${reasonText}">ⓘ</span>`;
            }
            let html = `<div style="font-weight:600;color:var(--accent-blue);margin-bottom:6px">${locName || 'Unknown location'}${headerTooltip}</div>`;
            if (locExtra) html += `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">${locExtra}</div>`;

            // Show a visible, dismissible warning when the backend had to use fallback coordinates
            if (place && place.fallback) {
                const reason = place.fallbackReason || 'unknown';
                // Prefer the original query when building the banner key so dismissal
                // is associated with what the user typed, not the backend's resolved label.
                const locKeyBanner = (place.query || place.resolvedName || '').toString().trim().toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_-]/g,'');
                let dismissedBanner = false;
                try { dismissedBanner = !!localStorage.getItem('weatherFallbackDismissed:' + locKeyBanner); } catch (e) { dismissedBanner = false; }
                if (!dismissedBanner) {
                    html += `<div id="weather-fallback-banner-${locKeyBanner}" style="margin-top:8px;padding:10px 14px;border-radius:8px;background:linear-gradient(90deg,color-mix(in srgb,var(--color-warning) 15%,var(--bg-card)),color-mix(in srgb,var(--color-warning) 25%,var(--bg-card)));color:var(--text-primary);font-size:13px;display:flex;align-items:flex-start;gap:10px;justify-content:space-between">
                        <div style="flex:1;line-height:1.6;">
                            <div><strong>⚠️ Location not resolved</strong> — showing weather for approximate fallback coordinates.</div>
                            <div style="font-size:12px;margin-top:4px;opacity:0.9;">To fix: go to <a href="settings.html" style="color:var(--color-warning);text-decoration:underline;">Settings → Preferences</a> and set your location as <strong>City, Country</strong> — for example <em>Sydney, Australia</em> or <em>London, UK</em>.</div>
                        </div>
                        <div style="flex:0 0 auto;margin-left:12px;margin-top:2px;"><button onclick="dismissWeatherFallback('${locKeyBanner}')" style="background:transparent;border:1px solid var(--border-primary);color:var(--text-primary);padding:5px 10px;border-radius:6px;cursor:pointer;font-size:12px;">Dismiss</button></div>
                    </div>`;
                }
            }

            if (current) {
                // Determine today's weather description and rainfall if available
                const todayCode = (current.weathercode !== undefined && current.weathercode !== null) ? current.weathercode : (daily && daily.weathercode ? daily.weathercode[0] : null);
                const todayDesc = todayCode !== null ? weatherCodeToWord(todayCode) : 'Unknown';
                const rainArr = daily && (daily.precipitation_sum || daily.precipitation || daily.rain_sum) ? (daily.precipitation_sum || daily.precipitation || daily.rain_sum) : null;
                const todayRain = (rainArr && rainArr[0] !== undefined) ? Number(rainArr[0]) : null;

                // windInfo: prefer current.windspeed and current.winddirection when supplied (Open-Meteo style)
                function degToCompass(num) {
                    if (num === null || num === undefined || isNaN(Number(num))) return '';
                    const val = Math.floor((Number(num) / 22.5) + 0.5);
                    const arr = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
                    return arr[(val % 16)];
                }

                const windSpeed = (current.windspeed !== undefined && current.windspeed !== null) ? Number(current.windspeed) : null;
                const windDirDeg = (current.winddirection !== undefined && current.winddirection !== null) ? Number(current.winddirection) : null;
                const windDirName = windDirDeg !== null ? degToCompass(windDirDeg) : '';

                const nowTemp = (current.temperature !== undefined && current.temperature !== null && String(current.temperature).toLowerCase() !== 'undefined') ? `${current.temperature}°` : '—';
                // Extract time from current.time (ISO format: YYYY-MM-DDTHH:MM)
                let nowTimeStr = '';
                if (current.time && typeof current.time === 'string') {
                    const timePart = current.time.split('T')[1];
                    if (timePart) nowTimeStr = timePart.substring(0, 5); // HH:MM
                }
                const nowLabel = nowTimeStr ? `Now (${nowTimeStr})` : 'Now';
                html += `<div class="live-stat"><span class="value">${nowTemp}</span><span class="unit">C</span><span class="label">${nowLabel}</span></div>`;

                // Determine current shortwave radiation and cloudcover.
                let currentRad = null;
                let currentCloud = null;
                try {
                    if (current.shortwave_radiation !== undefined && current.shortwave_radiation !== null) {
                        currentRad = current.shortwave_radiation;
                    } else if (data.hourly && Array.isArray(data.hourly.time) && Array.isArray(data.hourly.shortwave_radiation)) {
                        const times = data.hourly.time;
                        const radArr = data.hourly.shortwave_radiation;
                        let idx = -1;
                        if (current.time) idx = times.indexOf(current.time);
                        if (idx === -1) {
                            const nowHour = (current.time ? current.time.substring(0,13) : new Date().toISOString().substring(0,13));
                            for (let k = 0; k < times.length; k++) {
                                if (times[k] && times[k].substring(0,13) === nowHour) { idx = k; break; }
                            }
                        }
                        if (idx !== -1) currentRad = radArr[idx];
                    }

                    if (current.cloudcover !== undefined && current.cloudcover !== null) {
                        currentCloud = current.cloudcover;
                    } else if (data.hourly && Array.isArray(data.hourly.time) && Array.isArray(data.hourly.cloudcover)) {
                        const times = data.hourly.time;
                        const cloudArr = data.hourly.cloudcover;
                        let idx = -1;
                        if (current.time) idx = times.indexOf(current.time);
                        if (idx === -1) {
                            const nowHour = (current.time ? current.time.substring(0,13) : new Date().toISOString().substring(0,13));
                            for (let k = 0; k < times.length; k++) {
                                if (times[k] && times[k].substring(0,13) === nowHour) { idx = k; break; }
                            }
                        }
                        if (idx !== -1) currentCloud = cloudArr[idx];
                    }
                } catch (e) { /* ignore */ }

                html += `<div style="margin-top:8px;font-size:13px;color:var(--text-secondary)">${todayDesc} • Rain: ${todayRain !== null ? todayRain.toFixed(1) + ' mm' : '—'}`;
                if (windSpeed !== null) html += ` • Wind: <strong style="color:var(--text-primary)">${windSpeed.toFixed(1)} km/h</strong>${windDirName ? ' ' + windDirName : ''}`;
                // Add current radiance/cloud values (use units W/m² for radiation)
                html += ` • <span title="Current shortwave radiation">☀️ ${currentRad !== null ? String(currentRad) + ' W/m²' : '—'}</span>`;
                html += ` • <span title="Current cloud cover">☁️ ${currentCloud !== null ? String(currentCloud) + '%' : '—'}</span>`;
                html += `</div>`;
            }

            if (daily && daily.time) {
                // Compute daily averages from hourly data for solar radiation and cloud cover
                const hourly = data.hourly || {};
                const hourlyTimes = hourly.time || [];
                const hourlyRadiation = hourly.shortwave_radiation || [];
                const hourlyCloudcover = hourly.cloudcover || [];
                
                // Group hourly data by day (YYYY-MM-DD)
                const dailyRadiationAvg = {};
                const dailyCloudcoverAvg = {};
                for (let hi = 0; hi < hourlyTimes.length; hi++) {
                    const dayKey = hourlyTimes[hi]?.substring(0, 10);
                    if (!dayKey) continue;
                    if (!dailyRadiationAvg[dayKey]) dailyRadiationAvg[dayKey] = { sum: 0, count: 0 };
                    if (!dailyCloudcoverAvg[dayKey]) dailyCloudcoverAvg[dayKey] = { sum: 0, count: 0 };
                    if (hourlyRadiation[hi] !== null && hourlyRadiation[hi] !== undefined) {
                        dailyRadiationAvg[dayKey].sum += hourlyRadiation[hi];
                        dailyRadiationAvg[dayKey].count++;
                    }
                    if (hourlyCloudcover[hi] !== null && hourlyCloudcover[hi] !== undefined) {
                        dailyCloudcoverAvg[dayKey].sum += hourlyCloudcover[hi];
                        dailyCloudcoverAvg[dayKey].count++;
                    }
                }
                
                html += '<div class="weather-days">';
                // Get the user's requested number of days from the input field
                const weatherDaysInput = document.getElementById('weatherDays');
                const requestedDays = weatherDaysInput ? Number(weatherDaysInput.value) : 6;
                // Show up to the requested number of days, but not more than available
                const showCount = Math.min(daily.time.length, Math.max(1, requestedDays));
                for (let i = 0; i < showCount; i++) {
                    const d = daily.time[i];
                    const dayKey = d?.substring(0, 10);
                    const tmax = (daily.temperature_2m_max && daily.temperature_2m_max[i] !== undefined && daily.temperature_2m_max[i] !== null && String(daily.temperature_2m_max[i]).toLowerCase() !== 'undefined') ? daily.temperature_2m_max[i] : '-';
                    const tmin = (daily.temperature_2m_min && daily.temperature_2m_min[i] !== undefined && daily.temperature_2m_min[i] !== null && String(daily.temperature_2m_min[i]).toLowerCase() !== 'undefined') ? daily.temperature_2m_min[i] : '-';
                    const code = (daily.weathercode && daily.weathercode[i] !== undefined) ? daily.weathercode[i] : null;
                    const desc = code !== null ? weatherCodeToWord(code) : 'Unknown';
                    // precipitation_sum can be named differently depending on API fields
                    const rainArr = daily.precipitation_sum || daily.precipitation || daily.rain_sum || null;
                    const rain = (rainArr && rainArr[i] !== undefined) ? Number(rainArr[i]) : null;
                    
                    // Daily averages for solar radiation and cloud cover
                    const radAvg = dailyRadiationAvg[dayKey]?.count > 0 ? Math.round(dailyRadiationAvg[dayKey].sum / dailyRadiationAvg[dayKey].count) : null;
                    const cloudAvg = dailyCloudcoverAvg[dayKey]?.count > 0 ? Math.round(dailyCloudcoverAvg[dayKey].sum / dailyCloudcoverAvg[dayKey].count) : null;
                    
                    // Sunrise/sunset from daily data
                    const sunrise = daily.sunrise?.[i] ? daily.sunrise[i].split('T')[1]?.substring(0, 5) : null;
                    const sunset = daily.sunset?.[i] ? daily.sunset[i].split('T')[1]?.substring(0, 5) : null;

                    // Detect "extreme" conditions for this day so we can visually highlight them.
                    // Rules (tunable): heavy rain >= 10mm, very hot high >= 35°C, very cold low <= 0°C,
                    // or descriptions that mention storm/thunder/snow/hail/sleet/blizzard/heavy
                    const extremeReasons = [];
                    try {
                        if (rain !== null && !isNaN(rain) && rain >= 10) extremeReasons.push(`Heavy rain: ${rain.toFixed(1)} mm`);
                        if (!isNaN(Number(tmax)) && Number(tmax) >= 35) extremeReasons.push(`High heat: ${Number(tmax)}°`);
                        if (!isNaN(Number(tmin)) && Number(tmin) <= 0) extremeReasons.push(`Very cold: ${Number(tmin)}°`);
                        if (desc && /thunder|storm|snow|sleet|hail|blizzard|heavy/i.test(String(desc))) extremeReasons.push(String(desc));
                    } catch (e) { /* ignore detection errors */ }
                    const isExtreme = extremeReasons.length > 0;
                    const extremeClass = isExtreme ? ' extreme' : '';
                    const extremeTitle = isExtreme ? ` title="${extremeReasons.join('; ')}"` : '';
                    
                    // Solar indicator color: green (good) > 300, yellow 100-300, red < 100
                    const radColor = radAvg === null ? 'var(--text-secondary)' : radAvg > 300 ? 'var(--color-success)' : radAvg > 100 ? 'var(--color-orange)' : 'var(--color-danger)';
                    // Cloud indicator color: green (clear) < 30, yellow 30-70, red > 70
                    const cloudColor = cloudAvg === null ? 'var(--text-secondary)' : cloudAvg < 30 ? 'var(--color-success)' : cloudAvg < 70 ? 'var(--color-orange)' : 'var(--color-danger)';

                    html += `<div class="stat-item${extremeClass}"${extremeTitle}>
                        <div style="font-size:12px;font-weight:700;color:var(--text-primary)">${formatForecastDay(d)}</div>
                        <div style="font-size:13px;color:var(--accent-blue);font-weight:600;margin-top:4px">${desc}</div>
                        <div style="font-size:12px;color:var(--text-secondary);margin-top:4px">High ${tmax}° / Low ${tmin}°</div>
                        <div style="font-size:11px;color:var(--color-success);margin-top:3px">Rain: ${rain !== null ? rain.toFixed(1) + ' mm' : '—'}</div>
                        <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">
                            <span style="font-size:10px;color:${radColor}" title="Avg solar radiation (W/m²)">☀️${radAvg !== null ? radAvg : '—'}</span>
                            <span style="font-size:10px;color:${cloudColor}" title="Avg cloud cover %">☁️${cloudAvg !== null ? cloudAvg + '%' : '—'}</span>
                        </div>
                    </div>`;
                }
                html += '</div>';
            }

            // Insert a small inline map below the weather content when we have coordinates
            if (lat !== null && lon !== null) {
                html += `<div class="weather-map" id="weather-map-${locKey}"></div>`;
            }

            card.innerHTML = html;

            // Initialize or update the inline Leaflet map for this location
            try {
                if (lat !== null && lon !== null) {
                    // Retry loop to ensure container is ready and Leaflet loads
                    let attempts = 0;
                    const mapId = 'weather-map-' + locKey;
                    function tryInitMap() {
                        const mapEl = document.getElementById(mapId);
                        // Only attempt to initialize when element exists and is laid out
                        // (non-zero width/height). When forecast count is large the
                        // element may be present but not yet painted or sized.
                        if (mapEl && (mapEl.offsetWidth === 0 || mapEl.offsetHeight === 0)) {
                            // wait longer for layout to stabilise
                            if (attempts < 60) {
                                attempts++;
                                const delay = attempts < 12 ? 100 : 160; // back off a bit
                                setTimeout(tryInitMap, delay);
                                return;
                            }
                        }
                        if (!mapEl) {
                            // When many tiles are rendered the browser may take longer to
                            // parse/paint the large innerHTML blob. Retry longer to ensure
                            // the container appears before giving up.
                            if (attempts < 40) {
                                attempts++;
                                // progressive backoff: start fast then slow down
                                const delay = attempts < 8 ? 80 : 120;
                                setTimeout(tryInitMap, delay);
                            } else {
                                console.warn('Leaflet map container not found after retries:', mapId);
                                // Show error in container if the element exists later
                                if (mapEl) mapEl.innerHTML = '<div style="color:var(--color-danger);font-size:13px;padding:8px">Map container not found</div>';
                            }
                            return;
                        }
                        ensureLeafletLoaded().then(() => {
                            try {
                                if (!window.weatherMaps) window.weatherMaps = {};
                                const latNum = Number(place.latitude);
                                const lonNum = Number(place.longitude);
                                // Reuse existing map instance if present
                                if (window.weatherMaps[mapId]) {
                                    let m = window.weatherMaps[mapId];
                                    // If the stored map instance is attached to an old/removed container
                                    // (card.innerHTML was replaced), recreate the map on the new element.
                                    try {
                                        const currentContainer = m.getContainer && m.getContainer();
                                        if (!currentContainer || currentContainer !== mapEl) {
                                            try {
                                                // disconnect any attached observers/listeners before removing
                                                try { if (m._resizeObserver) m._resizeObserver.disconnect(); } catch(e){}
                                                try { if (m._resizeListener) window.removeEventListener('resize', m._resizeListener); } catch(e){}
                                                m.remove && m.remove();
                                            } catch (err) { /* ignore */ }
                                            // drop stale instance so we create a fresh one below
                                            delete window.weatherMaps[mapId];
                                            m = null;
                                        }
                                    } catch (err) {
                                        // If anything goes wrong checking container, prefer to recreate
                                        try { m.remove && m.remove(); } catch (e){}
                                        delete window.weatherMaps[mapId];
                                        m = null;
                                    }
                                    if (m) {
                                    m.setView([latNum, lonNum], 9);
                                    try { if (m._weatherMarker) m.removeLayer(m._weatherMarker); } catch(e){}
                                    const mark = L.circleMarker([latNum, lonNum], { radius:6, fillColor:'#58a6ff', color:'#fff', weight:1, fillOpacity:0.95 }).addTo(m);
                                    m._weatherMarker = mark;
                                        // In some cases reflow needs multiple ticks — call invalidate repeatedly
                                        const invalidate = () => {
                                            try { m.invalidateSize && m.invalidateSize(); if (m._weatherMarker) m._weatherMarker.setLatLng([latNum, lonNum]); } catch(e){}
                                        };
                                        requestAnimationFrame(invalidate);
                                        setTimeout(invalidate, 160);
                                        setTimeout(invalidate, 420);
                                        setTimeout(invalidate, 900);
                                        setTimeout(invalidate, 1600);
                                        // Ensure map invalidates when its container or window resizes
                                        try {
                                            if (!m._resizeObserver && 'ResizeObserver' in window) {
                                                const ro = new ResizeObserver(() => { try { m.invalidateSize && m.invalidateSize(); } catch(e){} });
                                                ro.observe(mapEl);
                                                m._resizeObserver = ro;
                                            } else if (!m._resizeListener) {
                                                const onWin = () => { try { m.invalidateSize && m.invalidateSize(); } catch(e){} };
                                                window.addEventListener('resize', onWin);
                                                m._resizeListener = onWin;
                                            }
                                        } catch(e) {}
                                    } else {
                                        // Removed stale map instance — fall through to create a new map below
                                    }
                                } else {
                                    const m = L.map(mapId, { zoomControl:false, attributionControl:false, dragging:false, scrollWheelZoom:false, doubleClickZoom:false, boxZoom:false, touchZoom:false }).setView([latNum, lonNum], 9);
                                    const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
                                    // diagnostic counters & handlers
                                    let tileLoadCount = 0;
                                    // lightweight in-map diagnostics node
                                    function ensureDiagNode() {
                                        const el = document.getElementById(mapId);
                                        if (!el) return null;
                                        return null;
                                    }
                                    tileLayer.on('tileload', function (ev) {
                                        tileLoadCount++;
                                        // ensure the specific tile is visible (fallback if stylesheet didn't load)
                                        try { if (ev && ev.tile) { ev.tile.style.opacity = '1'; ev.tile.style.visibility = 'visible'; ev.tile.style.filter = 'none'; } } catch(e){}
                                        // ...existing code...
                                    });
                                    tileLayer.on('load', function () {
                                        // ...existing code...
                                    });
                                    tileLayer.on('tileerror', function (ev) {
                                        const mapEl = document.getElementById(mapId);
                                        console.warn('tileerror', mapId, ev);
                                        // ...existing code...
                                    });
                                    tileLayer.addTo(m);
                                    const mark = L.circleMarker([latNum, lonNum], { radius:6, fillColor:'#58a6ff', color:'#fff', weight:1, fillOpacity:0.95 }).addTo(m);
                                    m._weatherMarker = mark;
                                    window.weatherMaps[mapId] = m;
                                    // Attach a ResizeObserver so the map adapts to the card/panel width
                                    try {
                                        if ('ResizeObserver' in window) {
                                            const ro2 = new ResizeObserver(() => { try { m.invalidateSize && m.invalidateSize(); } catch(e){} });
                                            const mapElNow = document.getElementById(mapId);
                                            if (mapElNow) {
                                                ro2.observe(mapElNow);
                                                m._resizeObserver = ro2;
                                            }
                                        } else {
                                            const onWin2 = () => { try { m.invalidateSize && m.invalidateSize(); } catch(e){} };
                                            window.addEventListener('resize', onWin2);
                                            m._resizeListener = onWin2;
                                        }
                                    } catch(e) {}
                                    setTimeout(() => { try { m.invalidateSize && m.invalidateSize(); } catch(e){} }, 200);
                                    // Ensure map also invalidates a bit later to handle large DOM updates
                                    setTimeout(() => { try { m.invalidateSize && m.invalidateSize(); } catch(e){} }, 800);
                                    // Extra diagnostics: log map size and tile container children
                                            setTimeout(() => {
                                        try {
                                            const size = m.getSize();
                                            const tileContainer = mapEl.querySelector('.leaflet-tile-pane');
                                            const tiles = tileContainer ? tileContainer.querySelectorAll('img') : [];
                                            // If no tiles loaded after a short delay, attempt a direct tile test by requesting a single tile image
                                            if (tileLoadCount === 0) {
                                                try {
                                                    const z = 9;
                                                    // convert lat/lon to tile xy for zoom z
                                                    function long2tile(lon, z) { return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
                                                    function lat2tile(lat, z) { return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z)); }
                                                    const tx = long2tile(latNum ? lonNum : 151.03, z);
                                                    const ty = lat2tile(latNum ? latNum : -33.92, z);
                                                    const tileUrl = `https://a.tile.openstreetmap.org/${z}/${tx}/${ty}.png`;
                                                    const tImg = new Image();
                                                    tImg.crossOrigin = 'anonymous';
                                                    tImg.onload = function() {
                                                        // ...existing code...
                                                    };
                                                    tImg.onerror = function(err) {
                                                        console.warn('Direct tile failed to load', err);
                                                        // ...existing code...
                                                    };
                                                    tImg.src = tileUrl;
                                                } catch(e) { console.error('direct tile test failed', e); }
                                            }
                                        } catch (e) { console.error('map diag error', e); }
                                            }, 600);
                                            // extra run: collect per-tile diagnostics and display them
                                            setTimeout(() => {
                                                try {
                                                    const mapEl2 = document.getElementById(mapId);
                                                    if (!mapEl2) return;
                                                    const tilePane = mapEl2.querySelector('.leaflet-tile-pane');
                                                    const tiles = tilePane ? Array.from(tilePane.querySelectorAll('img')) : [];
                                                    const diag2 = ensureDiagNode();
                                                    if (diag2) {
                                                        if (tiles.length === 0) {
                                                            diag2.textContent = (diag2.textContent || '') + ' | tiles:0';
                                                        } else {
                                                            let info = ' | tiles:' + tiles.length + ' [';
                                                            info += tiles.slice(0,6).map(img => {
                                                                const src = img.src.split('/').slice(-3).join('/');
                                                                const cw = img.naturalWidth || img.width || 0;
                                                                const ch = img.naturalHeight || img.height || 0;
                                                                const style = window.getComputedStyle(img);
                                                                return `${src} w:${cw} h:${ch} d:${style.display} o:${style.opacity}`;
                                                            }).join(' ; ');
                                                            info += (tiles.length > 6 ? ' …' : '') + ']';
                                                            diag2.textContent = (diag2.textContent || '') + info;
                                                        }
                                                    }
                                                } catch(e) { console.error('tile diagnostics 2 error', e); }
                                            }, 900);
                                }
                            } catch (e) {
                                console.error('Map init error:', e);
                                mapEl.innerHTML = '<div style="color:var(--color-danger);font-size:13px;padding:8px">Map init error: ' + e.message + '</div>';
                            }
                        }).catch((e) => {
                            console.error('Leaflet failed to load:', e);
                            mapEl.innerHTML = '<div style="color:var(--color-danger);font-size:13px;padding:8px">Leaflet failed to load</div>';
                        });
                    }
                    setTimeout(tryInitMap, 120);
                }
            } catch (e) { /* ignore */ }

            // Populate debug raw intervals list for feed-in so we can compare exact nemTime/perKwh/spotPerKwh
            const rawDiv = document.getElementById('amberRaw');
            if (rawDiv) {
                const feedList = feedIn.slice(0, 48); // up to next 48 intervals
                if (feedList.length === 0) {
                    rawDiv.style.display = 'none';
                } else {
                    let rawHtml = '<div style="font-weight:600;margin-bottom:6px">Raw Feed-in Intervals (nemTime / spot / perKwh)</div>';
                    rawHtml += '<div style="display:flex;flex-direction:column;gap:6px">';
                    feedList.forEach(it => {
                        const nem = it.nemTime || it.startTime;
                        const spot = (typeof it.spotPerKwh === 'number') ? it.spotPerKwh.toFixed(3) : 'n/a';
                        const per = (typeof it.perKwh === 'number') ? it.perKwh.toFixed(3) : 'n/a';
                        // Format nemTime to DD/MM/YYYY HH:MM when possible
                        let nemFormatted = nem;
                        try {
                            const nd = new Date(nem);
                            if (!isNaN(nd.getTime())) nemFormatted = formatDate(nd, true);
                        } catch(e) {}
                        rawHtml += `<div style="padding:6px;background:var(--bg-input);border-radius:6px">${nemFormatted} — spot: <strong style=\"color:${(parseFloat(spot) < 0 ? 'var(--color-danger)' : 'var(--color-success)')}\">${spot}¢</strong> — per: <strong>${per}¢</strong></div>`;
                    });
                    rawHtml += '</div>';
                    rawDiv.style.display = 'block';
                    rawDiv.innerHTML = rawHtml;
                }
            }
        }

        // Amber
        let amberSites = [];
        let amberConfiguredSiteId = '';
        let amberLastPersistedSiteId = '';

        // Prefer shared-utils helpers, but keep a local fallback for stale cached bundles.
        function getStoredAmberSiteIdSafe() {
            try {
                if (window.sharedUtils && typeof window.sharedUtils.getStoredAmberSiteId === 'function') {
                    return String(window.sharedUtils.getStoredAmberSiteId() || '').trim();
                }
            } catch (e) { /* ignore and fallback */ }
            try {
                return String(localStorage.getItem('amberSiteId') || '').trim();
            } catch (e) {
                return '';
            }
        }

        function setStoredAmberSiteIdSafe(siteId) {
            const normalized = String(siteId || '').trim();
            if (!normalized) return;

            try {
                if (window.sharedUtils && typeof window.sharedUtils.setStoredAmberSiteId === 'function') {
                    window.sharedUtils.setStoredAmberSiteId(normalized);
                    return;
                }
            } catch (e) { /* ignore and fallback */ }

            try {
                localStorage.setItem('amberSiteId', normalized);
            } catch (e) { /* ignore */ }
        }

        async function persistAmberSiteSelection(siteId) {
            const normalized = String(siteId || '').trim();
            if (!normalized || isDashboardLocalMockEnabled()) return;
            if (normalized === amberLastPersistedSiteId) return;

            amberLastPersistedSiteId = normalized;
            amberConfiguredSiteId = normalized;

            try {
                const resp = await authenticatedFetch('/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ amberSiteId: normalized })
                });
                if (!resp.ok) {
                    throw new Error(`HTTP ${resp.status}`);
                }
                let payload = null;
                try { payload = await resp.json(); } catch (e) { /* ignore parse */ }
                if (payload && payload.errno !== undefined && payload.errno !== 0) {
                    throw new Error(payload.msg || payload.error || 'Config save failed');
                }
            } catch (e) {
                console.warn('[Amber] Failed to persist selected site:', e && e.message ? e.message : e);
                if (amberLastPersistedSiteId === normalized) {
                    amberLastPersistedSiteId = '';
                }
            }
        }
        
        async function loadAmberSites(forceRefresh = false) {
            const select = document.getElementById('amberSiteId');
            const card = document.getElementById('amberCard');
            select.innerHTML = '<option value="">Loading...</option>';

            if (!select.dataset.boundAmberChange) {
                select.dataset.boundAmberChange = '1';
                select.addEventListener('change', () => {
                    const selectedSiteId = String(select.value || '').trim();
                    if (!selectedSiteId) return;
                    setStoredAmberSiteIdSafe(selectedSiteId);
                    persistAmberSiteSelection(selectedSiteId);
                    getAmberCurrent(true);
                });
            }

            if (isDashboardLocalMockEnabled()) {
                const sites = getMockAmberSites();
                amberSites = sites;
                select.innerHTML = sites.map(s => `<option value="${s.id}">${s.nmi} (${s.network})</option>`).join('');
                const storedSiteId = getStoredAmberSiteIdSafe();
                // localStorage (user's last manual pick) takes priority over backend config
                const preferredSiteId = storedSiteId || amberConfiguredSiteId;
                const preferredExists = preferredSiteId && sites.some(s => String(s.id) === String(preferredSiteId));
                if (preferredExists) {
                    select.value = String(preferredSiteId);
                } else if (select.options.length > 0) {
                    select.selectedIndex = 0;
                }
                const selectedSiteId = String(select.value || '').trim();
                if (selectedSiteId) {
                    setStoredAmberSiteIdSafe(selectedSiteId);
                }
                card.innerHTML = '<div style="color:var(--color-success)">Mock sites loaded (local mode)</div>';
                setTimeout(() => getAmberCurrent(forceRefresh), 80);
                return;
            }
            
            try {
                let url = '/api/pricing/sites';
                if (forceRefresh) {
                    url += '?forceRefresh=true';
                }
                const resp = await authenticatedFetch(url);
                const json = await resp.json();
                
                // Extract sites array from response
                let sites = [];
                if (Array.isArray(json)) {
                    sites = json;
                } else if (json && json.result) {
                    sites = Array.isArray(json.result) ? json.result : [];
                } else if (json && json.sites) {
                    sites = json.sites;
                }
                
                if (sites.length > 0) {
                    amberSites = sites;
                    select.innerHTML = sites.map(s => `<option value="${s.id}">${s.nmi} (${s.network})</option>`).join('');
                    const storedSiteId = getStoredAmberSiteIdSafe();
                    // localStorage (user's last manual pick) takes priority over backend config
                    const preferredSiteId = storedSiteId || amberConfiguredSiteId;
                    const preferredExists = preferredSiteId && sites.some(s => String(s.id) === String(preferredSiteId));
                    if (preferredExists) {
                        select.value = String(preferredSiteId);
                    } else if (select.options.length > 0) {
                        select.selectedIndex = 0;
                    }
                    const selectedSiteId = String(select.value || '').trim();
                    if (selectedSiteId) {
                        setStoredAmberSiteIdSafe(selectedSiteId);
                        if (preferredExists) {
                            // Found and applied the user's saved preference
                            if (!amberConfiguredSiteId || amberConfiguredSiteId !== selectedSiteId) {
                                persistAmberSiteSelection(selectedSiteId);
                            } else {
                                amberLastPersistedSiteId = amberConfiguredSiteId;
                            }
                        } else if (!preferredSiteId) {
                            // Brand-new user with no prior preference — auto-save the default first site
                            persistAmberSiteSelection(selectedSiteId);
                        }
                        // If preferredSiteId existed but wasn't found in the list, do NOT overwrite —
                        // keep the server-saved preference intact and just temporarily show the first site
                    }
                    card.innerHTML = `<div style="color:var(--color-success)">✓ ${sites.length} site(s) found</div>`;
                    // Auto-fetch current prices
                    setTimeout(() => getAmberCurrent(forceRefresh), 500);
                } else {
                    select.innerHTML = '<option value="">No sites</option>';
                    card.innerHTML = `<div style="color:var(--color-warning)">No sites found</div>`;
                }
            } catch (e) {
                console.error('[Amber] Error loading sites:', e);
                select.innerHTML = '<option value="">Error</option>';
                card.innerHTML = `<div style="color:var(--color-danger)">Error: ${e.message}</div>`;
            }
        }

        async function getAmberCurrent(force = false) {
            const select = document.getElementById('amberSiteId');
            let siteId = select.value;
            if (!siteId && isDashboardLocalMockEnabled()) {
                const mockSites = getMockAmberSites();
                if (mockSites.length > 0) {
                    amberSites = mockSites;
                    select.innerHTML = mockSites.map(s => `<option value="${s.id}">${s.nmi} (${s.network})</option>`).join('');
                    siteId = mockSites[0].id;
                    select.value = siteId;
                }
            }
            if (!siteId) { document.getElementById('amberCard').innerHTML = '<div style="color:var(--color-warning)">Select a site</div>'; return; }
            setStoredAmberSiteIdSafe(siteId);
            
            // Check if cached data is still fresh (TTL from backend config)
            const cacheState = JSON.parse(localStorage.getItem('cacheState') || '{}');
            const age = Date.now() - (cacheState.amberTime || 0);
            const cacheSiteId = String(cacheState.amberSiteId || '');
            const cacheOwnerId = String(cacheState.amberUserId || '');
            const currentOwnerId = getAmberUserStorageId();
            
            // Force refresh if requested (either explicit parameter or page reload bypass)
            const mockMode = isDashboardLocalMockEnabled();
            const shouldBypassCache = force || isPageReload || mockMode;
            
            if (!shouldBypassCache && cacheState.amberTime && age < CONFIG.cache.amber && cacheSiteId === String(siteId) && cacheOwnerId === currentOwnerId) {
                // Load cached full prices array and render
                try {
                    const cachedPricesFull = JSON.parse(localStorage.getItem('cachedPricesFull') || '[]');
                    if (cachedPricesFull.length > 0) {
                        renderAmberCard(cachedPricesFull);
                        setLastUpdated('amber');
                        return;
                    }
                } catch (e) { console.error('[Cache] Error loading Amber cache:', e); }
            }
            
            const card = document.getElementById('amberCard');
            card.innerHTML = '<div style="color:var(--text-secondary)">Loading prices...</div>';
            
            try {
                const next = Number(document.getElementById('amberNext')?.value) || 12;
                let data;
                if (mockMode) {
                    data = { errno: 0, result: getMockAmberPrices(next, siteId), mock: true };
                } else {
                    let url = `/api/pricing/current?siteId=${siteId}&next=${next}`;
                    // Add forceRefresh if force flag is set
                    if (force) {
                        url += '&forceRefresh=true';
                    }
                    const resp = await authenticatedFetch(url);
                    data = await resp.json();
                }
                
                // Handle both wrapped {errno, result} and unwrapped array formats
                let prices = [];
                if (Array.isArray(data)) {
                    prices = data;
                } else if (data?.errno === 0 && Array.isArray(data.result)) {
                    prices = data.result;
                } else if (data?.result && Array.isArray(data.result)) {
                    prices = data.result;
                }
                
                // Cache Amber prices - full array for dashboard, summary for test.html
                if (prices.length > 0) {
                    try {
                        // Cache FULL prices array for rendering on dashboard
                        localStorage.setItem('cachedPricesFull', JSON.stringify(prices));
                        
                        // Also cache simplified data for automation test page
                        const general = prices.find(p => p.channelType === 'general');
                        const feedIn = prices.find(p => p.channelType === 'feedIn');
                        const forecasts = prices.filter(p => p.type === 'ForecastInterval');
                        const priceCache = {
                            general: general ? { perKwh: general.perKwh } : null,
                            feedIn: feedIn ? { perKwh: -feedIn.perKwh } : null,  // Negate for display (Amber returns negative)
                            forecastHigh: forecasts.length > 0 ? Math.max(...forecasts.map(f => f.perKwh || 0)) : null
                        };
                        localStorage.setItem('cachedPrices', JSON.stringify(priceCache));
                        
                        // Update cache timestamp
                        const cacheState = JSON.parse(localStorage.getItem('cacheState') || '{}');
                        cacheState.amberTime = Date.now();
                        cacheState.amberSiteId = String(siteId);
                        cacheState.amberUserId = currentOwnerId;
                        localStorage.setItem('cacheState', JSON.stringify(cacheState));
                    } catch (e) { /* ignore cache errors */ }
                }
                
                renderAmberCard(prices);
                // Also set last-updated for amber (history query counts as an update)
                setLastUpdated('amber');
                // mark last updated for amber prices
                setLastUpdated('amber');
                
                document.getElementById('result').textContent = JSON.stringify(data, null, 2);
                document.getElementById('status-bar').style.display = 'flex';
                document.getElementById('status-bar').querySelector('.endpoint').textContent = `Amber Prices`;
            } catch (e) {
                card.innerHTML = `<div style="color:var(--color-danger)">Error: ${e.message}</div>`;
            }
        }

        // Open the Amber history modal
        function openAmberHistoryModal() {
            const today = new Date();
            const yesterday = new Date(today.getTime() - 24*60*60*1000);
            const elStart = document.getElementById('amberHistoryStart');
            const elEnd = document.getElementById('amberHistoryEnd');
            if (elStart) elStart.value = yesterday.toISOString().slice(0,10);
            if (elEnd) elEnd.value = today.toISOString().slice(0,10);
            document.getElementById('amberHistoryModal').classList.add('show');
        }
        function closeAmberHistoryModal() { document.getElementById('amberHistoryModal').classList.remove('show'); }
        
        // Dump full Amber response to debug panel
        function dumpAmberRaw() {
            const resp = window.lastAmberResponse || [];
            const json = JSON.stringify(resp, null, 2);
            const debugEl = document.getElementById('result');
            if (debugEl) {
                debugEl.textContent = json;
                document.getElementById('status-bar').style.display = 'flex';
                document.getElementById('status-bar').querySelector('.endpoint').textContent = 'Amber Raw Response';
            } else {
                alert('Debug panel not available. Response has ' + resp.length + ' items');
            }
        }
        
        // Export Amber data as CSV or JSON
        function exportAmberData(format) {
            const resp = window.lastAmberResponse || [];
            if (!resp.length) { alert('No data to export'); return; }
            let content, filename, mime;
            if (format === 'csv') {
                const headers = ['type','date','startTime','perKwh','spotPerKwh','renewables','spikeStatus','descriptor','channelType','period'];
                const rows = resp.map(r => [
                    r.type, r.date, r.startTime, r.perKwh, r.spotPerKwh, r.renewables, r.spikeStatus, r.descriptor, r.channelType, r.tariffInformation?.period || ''
                ].map(v => typeof v === 'string' && v.includes(',') ? `"${v}"` : v).join(','));
                content = [headers.join(','), ...rows].join('\n');
                filename = 'amber_' + new Date().toISOString().slice(0,10) + '.csv';
                mime = 'text/csv';
            } else {
                content = JSON.stringify(resp, null, 2);
                filename = 'amber_' + new Date().toISOString().slice(0,19).replace(/[-T:]/g, '') + '.json';
                mime = 'application/json';
            }
            const blob = new Blob([content], {type: mime});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        async function getAmberRange(startDate, endDate) {
            const siteId = document.getElementById('amberSiteId').value;
            if (!siteId) return;

            const card = document.getElementById('amberCard');
            card.innerHTML = '<div style="color:var(--text-secondary)">Loading history...</div>';

            try {
                let s = startDate, e = endDate;
                if (!s || !e) {
                    const today = new Date();
                    const yesterday = new Date(today.getTime() - 24*60*60*1000);
                    s = yesterday.toISOString().slice(0,10);
                    e = today.toISOString().slice(0,10);
                }
                const resp = await authenticatedFetch(`/api/pricing/prices?siteId=${siteId}&startDate=${s}&endDate=${e}`);
                const data = await resp.json();
                renderAmberCard(data);
                document.getElementById('result').textContent = JSON.stringify(data, null, 2);
            } catch (e) {
                card.innerHTML = `<div style="color:var(--color-danger)">Error: ${e.message}</div>`;
            }
        }

        function toggleAmberMore() {
            const btn = document.getElementById('amberShowMore');
            if (!btn) return;
            const isShowingAll = btn.dataset.showAll === '1';
            // Toggle state and request appropriate number of intervals
            if (isShowingAll) {
                btn.dataset.showAll = '0';
                // restore to default smaller fetch
                const nextEl = document.getElementById('amberNext');
                if (nextEl) nextEl.value = '288';
            } else {
                btn.dataset.showAll = '1';
                // request a larger window to see more intervals
                const nextEl = document.getElementById('amberNext');
                if (nextEl) nextEl.value = '500';
            }
            // Fetch fresh data so count/limits are accurate
            getAmberCurrent();
        }

        function renderAmberCard(data) {
            const card = document.getElementById('amberCard');
            // Handle both wrapped {errno, result} and unwrapped array formats
            let intervals = [];
            if (Array.isArray(data)) {
                intervals = data;
            } else if (data?.result && Array.isArray(data.result)) {
                intervals = data.result;
            }
            if (!intervals.length) { card.innerHTML = '<div style="color:var(--color-warning)">No data</div>'; return; }
            window.lastAmberResponse = intervals; // Store for raw dump and export

            const general = intervals.filter(i => i.channelType === 'general');
            const feedIn = intervals.filter(i => i.channelType === 'feedIn');
            const currentGen = general.find(i => i.type === 'CurrentInterval');
            const currentFeed = feedIn.find(i => i.type === 'CurrentInterval');
            const forecasts = general.filter(i => i.type === 'ForecastInterval');
            const feedForecasts = feedIn.filter(i => i.type === 'ForecastInterval');

            // Detect spikes in forecasts
            const spikeForecasts = forecasts.filter(i => i.spikeStatus && i.spikeStatus !== 'none');
            const hasSpikes = spikeForecasts.length > 0;
            
            // How many forecasts to show (use button dataset for show-all state)
            const showAllBtn = document.getElementById('amberShowMore');
            const showAll = showAllBtn?.dataset?.showAll === '1';
            // If show-all is enabled, display everything returned; otherwise show 12
            const forecastLimit = showAll ? forecasts.length : Math.min(forecasts.length, 12);

            // Find price extremes in DISPLAYED forecasts only (to align with tiles)
            const displayForecasts = forecasts.slice(0, forecastLimit);
            const displayFeedForecasts = feedForecasts.slice(0, forecastLimit);
            
            const maxBuyPrice = displayForecasts.length ? Math.max(...displayForecasts.map(i => i.perKwh)) : 0;
            const minBuyPrice = displayForecasts.length ? Math.min(...displayForecasts.map(i => i.perKwh)) : 0;
            // Compute feed-in display values (positive = earning money)
            const feedDisplayValues = displayFeedForecasts.length ? displayFeedForecasts.map(it => {
                try {
                    if (window.sharedUtils && typeof window.sharedUtils.feedDisplayValue === 'function') {
                        // Negate to convert Amber's negative values to positive display
                        return -Math.round(it.perKwh);
                    }
                } catch (e) {
                    // fall through to inline transform
                }
                return -Math.round(it.perKwh);  // Negate Amber's negative values
            }) : [];
            const minFeedSpot = feedDisplayValues.length ? Math.min(...feedDisplayValues) : 0;
            const maxFeedSpot = feedDisplayValues.length ? Math.max(...feedDisplayValues) : 0;

            let html = '';

            // Compact info row: forecast count and time range
            try {
                const returned = forecasts.length;
                const lastInterval = forecasts.length ? new Date(forecasts[forecasts.length-1].startTime).toLocaleString('en-AU', {hour:'2-digit',minute:'2-digit', day:'2-digit', month:'2-digit', hour12:false, timeZone: USER_TZ || 'Australia/Sydney'}) : '—';
                html += `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px">
                    <strong>${returned}</strong> forecast intervals available — until <strong>${lastInterval}</strong>
                </div>`;
                // Update the external show-all button label
                const btn = document.getElementById('amberShowMore');
                if (btn) {
                    const isShowingAll = btn.dataset.showAll === '1';
                    btn.textContent = isShowingAll ? 'Show less' : `Show all (${returned})`;
                }
            } catch(e) { /* ignore diagnostics errors */ }

            // Helper: format a price (val in cents). Values >= 100¢ shown as $X.YY, else as XX.XX¢
            function formatPrice(val) {
                const n = Number(val) || 0;
                const neg = n < 0;
                const abs = Math.abs(n);
                if (abs >= 100) {
                    // Format as dollar amount with 2 decimal places
                    const s = `$${(abs / 100).toFixed(2)}`;
                    return neg ? `-${s}` : s;
                }
                // Format as cents - show decimal only if needed
                const s = abs >= 10 ? `${abs.toFixed(1)}¢` : `${abs.toFixed(2)}¢`;
                return neg ? `-${s}` : s;
            }

            function formatForecastRelativeLabel(value) {
                const date = new Date(value);
                if (Number.isNaN(date.getTime())) return 'at --:--';

                const timeZone = USER_TZ || 'Australia/Sydney';
                const timeLabel = date.toLocaleTimeString('en-AU', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                    timeZone
                });

                const getDateParts = (input) => {
                    const parts = new Intl.DateTimeFormat('en-CA', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        timeZone
                    }).formatToParts(input);
                    return {
                        year: Number(parts.find((part) => part.type === 'year')?.value || 0),
                        month: Number(parts.find((part) => part.type === 'month')?.value || 0),
                        day: Number(parts.find((part) => part.type === 'day')?.value || 0)
                    };
                };

                const todayParts = getDateParts(new Date());
                const targetParts = getDateParts(date);
                const todayUtc = Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day);
                const targetUtc = Date.UTC(targetParts.year, targetParts.month - 1, targetParts.day);
                const dayDiff = Math.round((targetUtc - todayUtc) / 86400000);

                if (dayDiff === 0) return `today at ${timeLabel}`;
                if (dayDiff === 1) return `tomorrow at ${timeLabel}`;

                const dateLabel = date.toLocaleDateString('en-AU', {
                    day: '2-digit',
                    month: '2-digit',
                    timeZone
                });
                return `on ${dateLabel} at ${timeLabel}`;
            }

            // Spike Alert Banner (if any forecasted spikes)
            if (hasSpikes) {
                const nextSpike = spikeForecasts[0];
                const spikeTimeLabel = formatForecastRelativeLabel(nextSpike.startTime);
                const spikePrice = formatPrice(nextSpike.perKwh);
                html += `<div style="background:color-mix(in srgb, var(--color-danger) 15%, transparent);border:1px solid color-mix(in srgb, var(--color-danger) 40%, transparent);border-radius:8px;padding:10px;margin-bottom:12px;display:flex;align-items:center;gap:10px">
                    <span style="font-size:24px">⚠️</span>
                    <div>
                        <div style="font-weight:600;color:var(--color-danger)">Price Spike Forecast</div>
                        <div style="font-size:12px;color:var(--text-primary)">${spikeForecasts.length} spike${spikeForecasts.length > 1 ? 's' : ''} expected — next <strong>${spikeTimeLabel}</strong> (${spikePrice})</div>
                    </div>
                </div>`;
            }

            // Current Prices Row
            if (currentGen || currentFeed) {
                html += '<div style="display:flex;gap:16px;margin-bottom:12px;flex-wrap:wrap">';
                if (currentGen) {
                    const p = currentGen.perKwh;
                    const spot = currentGen.spotPerKwh;
                    const cls = p > 30 ? 'price-high' : p > 20 ? 'price-mid' : 'price-low';
                    const spike = currentGen.spikeStatus && currentGen.spikeStatus !== 'none';
                    // Format price using helper function for consistency
                    const priceStr = formatPrice(p);
                    html += `<div style="min-width:100px">
                        <div style="font-size:11px;color:var(--text-secondary)">Buy Now ${spike ? '<span style="color:var(--color-danger)">⚠️</span>' : ''}</div>
                        <div class="value ${cls}" style="font-size:28px;font-weight:700">${priceStr}</div>
                    </div>`;
                }
                if (currentFeed) {
                    // Display feed-in price (what you earn when exporting)
                    // Amber returns NEGATIVE values for feed-in (negative = you earn)
                    // Display as positive for user clarity: -9¢ displays as 9¢
                    const displayVal = -currentFeed.perKwh;
                    function feedClassFromVal(v) {
                        // v is display value in cents (positive = you earn at this rate)
                        if (v < -6) return 'price-high'; // red - paying money (negative feed-in)
                        if (v < 0) return 'price-mid'; // amber - slightly negative
                        if (v < 5) return 'price-neutral'; // grey - very low earnings
                        if (v < 20) return 'price-low'; // green - good rate
                        if (v >= 20) return 'price-darkgreen'; // dark green - excellent rate
                        return 'price-neutral';
                    }
                    const getCls = feedClassFromVal(displayVal);
                    // Format price using helper function for consistency
                    const feedPriceStr = formatPrice(displayVal);
                    html += `<div style="min-width:100px">
                        <div style="font-size:11px;color:var(--text-secondary)">Feed-In Price</div>
                        <div class="value ${getCls}" style="font-size:28px;font-weight:700">${feedPriceStr}</div>
                    </div>`;
                }
                if (currentGen && currentGen.renewables !== undefined) {
                    const renew = currentGen.renewables;
                    // Map renewable descriptor to emoji and color
                    const renewDesc = currentGen.descriptor || '';
                    const renewEmoji = { best: '🌱', great: '🌿', ok: '☁️', notGreat: '🏭', worst: '💨' }[renewDesc] || '';
                    const renewColor = renew > 55 ? cssVar('--color-success') : renew > 35 ? '#ffd43b' : cssVar('--color-danger');
                    html += `<div style="min-width:100px">
                        <div style="font-size:11px;color:var(--text-secondary)">Renewables ${renewEmoji}</div>
                        <div class="value" style="font-size:28px;font-weight:700;color:${renewColor}">${renew.toFixed(0)}%</div>
                    </div>`;
                }
                html += '</div>';
            }

            // Price Range Summary with consistent coloring logic
            if (forecasts.length > 1) {
                // Buy price coloring (low=cheap, high=expensive)
                const minBuyCls = minBuyPrice > 30 ? 'price-high' : minBuyPrice > 20 ? 'price-mid' : 'price-low';
                const maxBuyCls = maxBuyPrice > 30 ? 'price-high' : maxBuyPrice > 20 ? 'price-mid' : 'price-low';
                // Feed-in coloring (high=you earn money, low=you pay)
                function feedClassFromVal(v) {
                    if (v < -6) return 'price-high'; // red - paying money
                    if (v < 0) return 'price-mid'; // amber - slightly negative
                    if (v < 5) return 'price-neutral'; // grey - very low earnings
                    if (v < 20) return 'price-low'; // green - good rate
                    if (v >= 20) return 'price-darkgreen'; // dark green - excellent rate
                    return 'price-neutral';
                }
                const minFeedCls = feedClassFromVal(minFeedSpot);
                const maxFeedCls = feedClassFromVal(maxFeedSpot);
                // Note: `formatPrice` helper is defined earlier to provide consistent formatting
                html += `<div style="display:flex;gap:12px;margin-bottom:12px;padding:8px;background:var(--bg-input);border-radius:6px;font-size:11px">
                    <div><span style="color:var(--text-secondary)">Forecast range:</span> <span class="${minBuyCls}" style="font-weight:600">${formatPrice(minBuyPrice)}</span> — <span class="${maxBuyCls}" style="font-weight:600">${formatPrice(maxBuyPrice)}</span></div>
                    ${feedForecasts.length ? `<div><span style="color:var(--text-secondary)">Feed-in range:</span> <span class="${minFeedCls}" style="font-weight:600">${formatPrice(minFeedSpot)}</span> — <span class="${maxFeedCls}" style="font-weight:600">${formatPrice(maxFeedSpot)}</span></div>` : ''}
                </div>`;
            }

            // Buy price forecasts with advanced pricing and tariff info
            if (displayForecasts.length) {
                html += '<div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;margin-top:8px;font-weight:600">📈 Buy Price Forecast</div>';
                html += '<div style="display:flex;gap:4px;flex-wrap:wrap">';
                displayForecasts.forEach(it => {
                    const startDate = new Date(it.startTime);
                    const time = startDate.toLocaleTimeString('en-AU', {hour:'numeric', minute:'2-digit', hour12:false, timeZone: USER_TZ || 'Australia/Sydney'});
                    const p = it.perKwh;
                    const cls = p > 30 ? 'price-high' : p > 20 ? 'price-mid' : 'price-low';
                    const spike = it.spikeStatus && it.spikeStatus !== 'none';
                    const ap = it.advancedPrice;
                    const bandInfo = ap ? `Low: ${ap.low.toFixed(0)}¢ | Pred: ${ap.predicted.toFixed(0)}¢ | High: ${ap.high.toFixed(0)}¢` : '';
                    const tooltip = spike ? `SPIKE: ${it.spikeStatus}` : bandInfo;
                    let priceStr;
                    if (p > 99) {
                        priceStr = `$${(p/100).toFixed(2)}`;
                    } else {
                        priceStr = `${p.toFixed(0)}¢`;
                    }
                    html += `<div class="stat-item" style="min-width:52px;padding:5px;${spike ? 'border:1px solid rgba(248,81,73,0.5);background:rgba(248,81,73,0.1)' : ''}" title="${tooltip}">
                        <div style="display:flex;align-items:center;justify-content:center;gap:2px">
                            <span class="value ${cls}" style="font-size:12px;font-weight:600">${priceStr}</span>
                            ${spike ? '<span style="font-size:10px">⚠️</span>' : ''}
                        </div>
                        <div class="label" style="font-size:9px;color:var(--text-secondary)">${time}</div>
                    </div>`;
                });
                html += '</div>';
            }

            // Feed-in price forecasts - Amber app shows spotPerKwh rounded to whole cents
            if (displayFeedForecasts.length) {
                html += '<div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;margin-top:12px;font-weight:600">📉 Feed-in Spot Forecast</div>';
                html += '<div style="display:flex;gap:4px;flex-wrap:wrap">';
                displayFeedForecasts.forEach(it => {
                    // Use startTime converted to AEST - Amber shows interval START time
                    const startDate = new Date(it.startTime);
                    const time = startDate.toLocaleTimeString('en-AU', {hour:'numeric', minute:'2-digit', hour12:false, timeZone: USER_TZ || 'Australia/Sydney'});
                    // Display -Round(perKwh) to match Amber app (negative perKwh = you earn, shown positive)
                    const displayVal = -Math.round(it.perKwh);
                    function feedClassFromVal(v) {
                        // v is display value in cents (positive = you earn at this rate)
                        if (v < -6) return 'price-high'; // red - paying money
                        if (v < 0) return 'price-mid'; // amber - slightly negative
                        if (v < 5) return 'price-neutral'; // grey - very low earnings
                        if (v < 20) return 'price-low'; // green - good rate
                        if (v >= 20) return 'price-darkgreen'; // dark green - excellent rate
                        return 'price-neutral';
                    }
                    const getCls = feedClassFromVal(displayVal);
                    const isVeryNegative = displayVal < -2;
                    const feedHighlightCls = displayVal > 50 ? 'feedin-highlight' : '';
                    let feedPriceStr;
                    if (displayVal > 99) {
                        feedPriceStr = `$${(displayVal/100).toFixed(2)}`;
                    } else {
                        feedPriceStr = `${displayVal}¢`;
                    }
                    html += `<div class="stat-item ${feedHighlightCls}" style="min-width:52px;padding:6px;${isVeryNegative ? 'border:1px solid rgba(248,81,73,0.5);background:rgba(248,81,73,0.1)' : ''}">
                                <div style="display:flex;align-items:center;justify-content:center;gap:2px">
                                    <span class="value ${getCls}" style="font-size:13px;font-weight:700">${feedPriceStr}</span>
                        </div>
                        <div class="label" style="font-size:9px">${time}</div>
                    </div>`;
                });
                html += '</div>';
            }

            // Add chart canvas to HTML before rendering
            html += '<div style="margin-top:16px;position:relative;height:200px;width:100%"><canvas id="amberPriceChart" style="width:100%;height:200px"></canvas></div>';
            card.innerHTML = html;

            // Schedule chart rendering after DOM is ready
            setTimeout(() => renderAmberChart(displayForecasts, displayFeedForecasts), 100);
        }

        async function renderAmberChart(displayForecasts, displayFeedForecasts) {
            try {
                // Load Chart.js if not present
                if (typeof Chart === 'undefined') {
                    await new Promise((resolve, reject) => {
                        const s = document.createElement('script');
                        s.src = 'https://cdn.jsdelivr.net/npm/chart.js';
                        s.onload = resolve;
                        s.onerror = reject;
                        document.head.appendChild(s);
                    });
                }

                const canvas = document.getElementById('amberPriceChart');
                if (!canvas || typeof Chart === 'undefined') return;

                // Build labels from buy or feed-in forecasts
                const forecasts = displayForecasts.length ? displayForecasts : displayFeedForecasts;
                const labels = forecasts.map(it => {
                    try {
                        const d = new Date(it.startTime);
                        return d.toLocaleTimeString('en-AU', {hour:'2-digit', minute:'2-digit', hour12:false, timeZone: USER_TZ || 'Australia/Sydney'});
                    } catch(e) { return ''; }
                });

                // Build datasets
                const buySeries = displayForecasts.map(it => it ? Number(it.perKwh) : null);
                const feedSeries = displayFeedForecasts.map(it => it ? -Math.round(it.perKwh) : null);

                // Destroy old chart if exists
                if (window.amberChartInst) {
                    try { window.amberChartInst.destroy(); } catch(e) {}
                }

                const ctx = canvas.getContext('2d');
                // Prepare a constant zero series so we can draw a horizontal dotted line at 0
                const zeroSeries = labels.map(() => 0);

                window.amberChartInst = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels,
                        datasets: [
                            // invisible legend entry (empty label) used to draw dotted zero line
                            {
                                label: '',
                                data: zeroSeries,
                                borderColor: 'rgba(255,255,255,0.25)',
                                borderWidth: 1,
                                pointRadius: 0,
                                tension: 0,
                                borderDash: [4, 4],
                                fill: false
                            },
                            {
                                label: 'Buy Price (¢/kWh)',
                                data: buySeries,
                                borderColor: '#ffd43b',
                                backgroundColor: 'rgba(255,212,59,0.1)',
                                borderWidth: 2,
                                tension: 0.3,
                                pointRadius: 4,
                                pointBackgroundColor: '#ffd43b',
                                pointBorderColor: cssVar('--bg-primary'),
                                pointBorderWidth: 1,
                                fill: true
                            },
                            {
                                label: 'Feed-in Spot (¢)',
                                data: feedSeries,
                                borderColor: '#7ee787',
                                backgroundColor: 'rgba(126,231,135,0.1)',
                                borderWidth: 2,
                                tension: 0.3,
                                pointRadius: 4,
                                pointBackgroundColor: '#7ee787',
                                pointBorderColor: cssVar('--bg-primary'),
                                pointBorderWidth: 1,
                                fill: true
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        plugins: {
                            legend: {
                                display: true,
                                labels: { color: cssVar('--text-primary'), usePointStyle: true, padding: 15, font: { size: 12 } }
                            },
                            tooltip: {
                                backgroundColor: cssVar('--bg-secondary'),
                                titleColor: cssVar('--text-primary'),
                                bodyColor: cssVar('--text-secondary'),
                                borderColor: cssVar('--border-primary'),
                                borderWidth: 1,
                                padding: 10,
                                cornerRadius: 6,
                                displayColors: true
                            }
                        },
                        scales: {
                            x: {
                                grid: { color: 'rgba(255,255,255,0.02)', drawBorder: false },
                                ticks: { color: cssVar('--text-secondary'), font: { size: 11 } }
                            },
                            y: {
                                beginAtZero: true,
                                grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
                                ticks: { color: cssVar('--text-secondary'), font: { size: 11 }, callback: val => val + '¢' }
                            }
                        }
                    }
                });
            } catch (err) {
                console.error('Chart render failed:', err);
            }
        }

        // Scheduler segments
        let currentSchedulerGroups = [];
        
        async function clearAllSchedulerSegments() {
            const slotCount = getSchedulerSlotCount();
            const slotLabel = getSchedulerSlotLabel(_providerCapabilities).toLowerCase();
            if (!confirm(`⚠️ Clear all ${slotCount} scheduler ${slotLabel}${slotCount === 1 ? '' : 's'}?\n\nThis will reset all visible ${slotLabel}${slotCount === 1 ? '' : 's'} to disabled (00:00-00:00).`)) {
                return;
            }
            
            const statusEl = document.getElementById('schedulerStatus');
            statusEl.style.display = 'block';
            statusEl.style.background = 'var(--accent-blue)';
            statusEl.textContent = '🔄 Clearing all segments...';
            
            try {
                const resp = await authenticatedFetch('/api/scheduler/v1/clear-all', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                const data = await resp.json();
                
                if (data.errno === 0) {
                    statusEl.style.background = 'var(--color-success-dark)';
                    let msg = '✅ All segments cleared successfully!';
                    // Show flag result if available
                    if (data.flagResult) {
                        msg += data.flagResult.errno === 0 ? ' (flag disabled)' : ' (flag warning)';
                    }
                    statusEl.textContent = msg;
                    // Show full response including verify info so user can see device state
                    try { document.getElementById('result').className = 'info'; document.getElementById('result').textContent = JSON.stringify(data, null, 2); } catch(e) {}
                    setTimeout(() => loadSchedulerSegments(), CONFIG.ui.schedulerReloadDelayMs);
                } else {
                    statusEl.style.background = 'var(--color-danger)';
                    statusEl.textContent = `❌ Failed: ${data.msg || 'Unknown error'}`;
                    // Show error response for debugging
                    try { document.getElementById('result').className = 'error'; document.getElementById('result').textContent = JSON.stringify(data, null, 2); } catch(e) {}
                }
            } catch (err) {
                statusEl.style.background = 'var(--color-danger)';
                statusEl.textContent = `❌ Error: ${err.message}`;
            }
            
            setTimeout(() => { statusEl.style.display = 'none'; }, CONFIG.ui.statusFadeMs);
        }
        
        async function loadSchedulerSegments() {
            const container = document.getElementById('schedulerSegments');
            container.innerHTML = '<div style="color:var(--text-secondary);font-size:12px;padding:20px;text-align:center">Loading...</div>';
            
            try {
                const resp = await authenticatedFetch('/api/scheduler/v1/get');
                const data = await resp.json();
                
                if (data.errno !== 0 || !data.result) {
                    container.innerHTML = `<div style="color:var(--color-danger);font-size:12px;padding:20px">Error: ${data.msg || 'Failed to load'}</div>`;
                    return;
                }
                
                currentSchedulerGroups = data.result.groups || [];
                const globalEnable = data.result.enable;
                const visibleGroups = (_providerCapabilities.provider === 'alphaess')
                    ? currentSchedulerGroups.slice(0, getSchedulerSlotCount())
                    : currentSchedulerGroups;
                
                if (visibleGroups.length === 0) {
                    container.innerHTML = '<div style="color:var(--text-secondary);font-size:12px;padding:20px;text-align:center">No segments configured</div>';
                    return;
                }
                
                const modeColors = {
                    'SelfUse': cssVar('--color-success'),
                    'ForceCharge': cssVar('--accent-blue'), 
                    'ForceDischarge': cssVar('--color-orange'),
                    'Feedin': cssVar('--color-warning'),
                    'Backup': cssVar('--color-purple')
                };
                
                let html = `<div style="grid-column:1/-1;margin-bottom:8px;padding:8px;background:${globalEnable ? cssVar('--color-success-dark') : cssVar('--border-primary')};border-radius:6px;text-align:center;font-size:12px">
                    Scheduler: <strong>${globalEnable ? '✅ ENABLED' : '❌ DISABLED'}</strong>
                </div>`;
                
                visibleGroups.forEach((seg, i) => {
                    const color = modeColors[seg.workMode] || cssVar('--text-secondary');
                    const startTime = `${String(seg.startHour).padStart(2,'0')}:${String(seg.startMinute).padStart(2,'0')}`;
                    const endTime = `${String(seg.endHour).padStart(2,'0')}:${String(seg.endMinute).padStart(2,'0')}`;
                    const isEnabled = seg.enable === 1;
                    
                    html += `<div style="background:var(--bg-card);border:1px solid ${isEnabled ? color : 'var(--border-primary)'};border-radius:8px;padding:10px;opacity:${isEnabled ? 1 : 0.6}">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                            <span style="font-weight:600;color:${color}">${getSchedulerSlotLabel(_providerCapabilities, i + 1)}</span>
                            <span style="font-size:11px;padding:2px 8px;border-radius:4px;background:${isEnabled ? color : 'var(--border-primary)'};color:var(--bg-primary)">${isEnabled ? 'ON' : 'OFF'}</span>
                        </div>
                        <div style="font-size:20px;font-weight:600;color:var(--text-primary);margin-bottom:4px">${startTime} → ${endTime}</div>
                        <div style="font-size:13px;color:${color};margin-bottom:8px">${seg.workMode}</div>
                        <div style="font-size:11px;color:var(--text-secondary);display:grid;grid-template-columns:1fr 1fr;gap:4px">
                            <span>MinSoC: ${seg.minSocOnGrid ?? seg.extraParam?.minSocOnGrid ?? '-'}%</span>
                            <span>Stop SoC: ${seg.fdSoc ?? seg.extraParam?.fdSoc ?? '-'}%</span>
                            <span>Power: ${seg.fdPwr ?? seg.extraParam?.fdPwr ?? 0}W</span>
                            <span>Max SoC: ${seg.maxSoc ?? seg.extraParam?.maxSoc ?? '-'}%</span>
                        </div>
                        <div style="display:flex;gap:6px;margin-top:8px">
                            <button class="btn" onclick="editSegment(${i})" style="flex:1;font-size:11px;padding:4px">✏️ Edit</button>
                            <button class="btn" onclick="deleteSegment(${i})" style="flex:1;font-size:11px;padding:4px;background:var(--color-danger)">🗑️ Clear</button>
                        </div>
                    </div>`;
                });
                
                container.innerHTML = html;
                
                // Check automation status and show warning if enabled
                checkAutomationStatusForScheduler();
                
                // Update solar tile curtailment indicator after rendering
                updateSolarTileCurtailmentIndicator();
                
                // Also show in result panel
                document.getElementById('result').className = 'success';
                document.getElementById('result').textContent = JSON.stringify(data, null, 2);
            } catch (error) {
                container.innerHTML = `<div style="color:var(--color-danger);font-size:12px;padding:20px">Error: ${error.message}</div>`;
            }
        }
        
        async function checkAutomationStatusForScheduler() {
            const warningDiv = document.getElementById('schedulerAutomationWarning');
            if (!warningDiv) return;
            
            try {
                const resp = await authenticatedFetch('/api/automation/status');
                const data = await resp.json();
                
                if (data.errno === 0 && data.result?.enabled === true) {
                    warningDiv.style.display = 'block';
                } else {
                    warningDiv.style.display = 'none';
                }
            } catch (error) {
                console.warn('[Scheduler] Failed to check automation status:', error);
                warningDiv.style.display = 'none';
            }
        }

        // ============================================================
        // EV Overview
        // ============================================================

        const evDashboardState = {
            vehicles: [],
            selectedVehicleId: '',
            statusByVehicleId: {},
            commandReadinessByVehicleId: {},
            statusMetaByVehicleId: {},
            readinessMetaByVehicleId: {},
            loadingVehicles: false,
            loadingStatusByVehicleId: {},
            loadingReadinessByVehicleId: {},
            commandInFlight: false,
            wakeInFlight: false,
            controlsBound: false
        };

        function getEVVehicleDisplayName(vehicle) {
            const preferred = String(vehicle?.displayName || '').trim();
            if (preferred) return preferred;
            return String(vehicle?.vehicleId || 'Unknown vehicle');
        }

        function hasEVVehicleCredentialsConfigured(vehicle) {
            if (!vehicle || typeof vehicle !== 'object') return false;
            if (typeof vehicle.hasCredentials === 'boolean') {
                return vehicle.hasCredentials;
            }
            // Backward compatibility with older API payloads that do not expose
            // hasCredentials yet: keep existing behavior and try status fetch.
            return true;
        }

        function formatEVChargingState(state) {
            const normalized = String(state || 'unknown').toLowerCase();
            if (normalized === 'charging') return 'Charging';
            if (normalized === 'complete') return 'Complete';
            if (normalized === 'stopped') return 'Stopped';
            if (normalized === 'disconnected') return 'Not Plugged In';
            return 'Unknown';
        }

        function formatEVBoolean(value) {
            if (value === true) return 'Yes';
            if (value === false) return 'No';
            return 'Unknown';
        }

        function formatEVRangeKm(value) {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return '—';
            const km = Math.round(numeric);
            const mi = Math.round(numeric * 0.621371);
            return `${km} km / ${mi} mi`;
        }

        function formatEVDistanceGainKm(value) {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return '—';
            return `+${Math.round(numeric)} km`;
        }

        function formatEVHoursToFull(value) {
            const numeric = Number(value);
            if (!Number.isFinite(numeric) || numeric < 0) return '—';
            if (numeric === 0) return 'Ready now';

            const totalMinutes = Math.max(1, Math.round(numeric * 60));
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
            if (hours > 0) return `${hours}h`;
            return `${minutes}m`;
        }

        function formatEVEnergyKwh(value) {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return '—';
            return `${numeric.toFixed(numeric >= 10 ? 1 : 2)} kWh`;
        }

        function formatEVCurrencyFromCents(value) {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return '—';
            const sign = numeric < 0 ? '-' : '';
            return `${sign}$${Math.abs(numeric / 100).toFixed(2)}`;
        }

        function getCurrentAmberBuyPriceCents() {
            try {
                const cached = JSON.parse(localStorage.getItem('cachedPrices') || '{}');
                const value = Number(cached?.general?.perKwh);
                return Number.isFinite(value) ? value : null;
            } catch {
                return null;
            }
        }

        function deriveEVStatusInsights(status = {}) {
            const buyPriceCentsPerKwh = getCurrentAmberBuyPriceCents();
            const chargeEnergyAddedKwh = Number(status?.chargeEnergyAddedKwh);
            const timeToFullChargeHours = Number(status?.timeToFullChargeHours);
            const chargingPowerKw = Number(status?.chargingPowerKw);
            const costAddedCents = Number.isFinite(chargeEnergyAddedKwh) && Number.isFinite(buyPriceCentsPerKwh)
                ? chargeEnergyAddedKwh * buyPriceCentsPerKwh
                : null;

            let costToFullCents = null;
            if (Number.isFinite(timeToFullChargeHours) && timeToFullChargeHours > 0 && Number.isFinite(chargingPowerKw) && chargingPowerKw > 0 && Number.isFinite(buyPriceCentsPerKwh)) {
                costToFullCents = timeToFullChargeHours * chargingPowerKw * buyPriceCentsPerKwh;
            }

            return {
                buyPriceCentsPerKwh,
                costAddedCents,
                costToFullCents
            };
        }

        function formatEVSoc(value) {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return '—';
            return `${Math.round(numeric)}%`;
        }

        function formatEVLastUpdatedLabel(meta = {}, status = {}) {
            const asOfIso = status?.asOfIso || null;
            if (asOfIso) {
                const asOfMs = Date.parse(asOfIso);
                if (Number.isFinite(asOfMs)) {
                    const ageMs = Date.now() - asOfMs;
                    if (ageMs >= 0) {
                        return `${formatMsToReadable(ageMs)} ago`;
                    }
                }
            }
            if (meta.loadedAtMs) {
                const ageMs = Date.now() - Number(meta.loadedAtMs || 0);
                if (ageMs >= 0) {
                    return `${formatMsToReadable(ageMs)} ago`;
                }
            }
            return '—';
        }

        function setEVOverviewMessage(kind, text, isHtml = false) {
            const messageEl = document.getElementById('evOverviewMessage');
            if (!messageEl) return;
            if (!text) {
                messageEl.className = 'ev-message';
                messageEl.textContent = '';
                return;
            }
            const safeKind = ['info', 'success', 'warning', 'error'].includes(kind) ? kind : 'info';
            messageEl.className = `ev-message ${safeKind}`;
            if (isHtml) {
                messageEl.innerHTML = text;
            } else {
                messageEl.textContent = text;
            }
        }

        function setEVCommandHint(kind, text) {
            const messageEl = document.getElementById('evCommandHint');
            if (!messageEl) return;
            if (!text) {
                messageEl.className = 'ev-message ev-command-hint';
                messageEl.textContent = '';
                return;
            }
            const safeKind = ['info', 'success', 'warning', 'error'].includes(kind) ? kind : 'info';
            messageEl.className = `ev-message ev-command-hint is-visible ${safeKind}`;
            messageEl.textContent = text;
        }

        function extractEVApiErrorMessage(payload, fallback) {
            const direct = String(payload?.error || payload?.msg || '').trim();
            if (direct) return direct;
            const nested = String(payload?.result?.error || payload?.result?.reasonCode || '').trim();
            if (nested) return nested;
            return String(fallback || 'Tesla request failed');
        }

        function extractEVApiErrorDetails(payload, fallback) {
            return {
                message: extractEVApiErrorMessage(payload, fallback),
                reasonCode: String(payload?.result?.reasonCode || '').trim().toLowerCase()
            };
        }

        function updateEVVehicleCountBadge() {
            const badge = document.getElementById('evVehicleCountBadge');
            if (!badge) return;
            const count = evDashboardState.vehicles.length;
            badge.textContent = `${count} vehicle${count === 1 ? '' : 's'}`;
        }

        function getSelectedEVVehicle() {
            const selectedId = String(evDashboardState.selectedVehicleId || '');
            if (!selectedId) return null;
            return evDashboardState.vehicles.find((vehicle) => String(vehicle.vehicleId) === selectedId) || null;
        }

        function getSelectedEVStatus() {
            const selectedId = String(evDashboardState.selectedVehicleId || '');
            if (!selectedId) return {};
            return evDashboardState.statusByVehicleId[selectedId] || {};
        }

        function getSelectedEVStatusError() {
            const selectedId = String(evDashboardState.selectedVehicleId || '');
            if (!selectedId) return '';
            const meta = evDashboardState.statusMetaByVehicleId[selectedId] || {};
            return String(meta.error || '');
        }

        function getSelectedEVStatusMeta() {
            const selectedId = String(evDashboardState.selectedVehicleId || '');
            if (!selectedId) return {};
            return evDashboardState.statusMetaByVehicleId[selectedId] || {};
        }

        function getSelectedEVReadinessError() {
            const selectedId = String(evDashboardState.selectedVehicleId || '');
            if (!selectedId) return '';
            const meta = evDashboardState.readinessMetaByVehicleId[selectedId] || {};
            return String(meta.error || '');
        }

        function getSelectedEVCommandReadiness() {
            const selectedId = String(evDashboardState.selectedVehicleId || '');
            if (!selectedId) return null;
            return evDashboardState.commandReadinessByVehicleId[selectedId] || null;
        }

        function isEVVehicleOfflineStatus(status = {}, statusError = '') {
            const reasonCode = String(status?.reasonCode || '').trim().toLowerCase();
            const errorText = String(statusError || '').trim().toLowerCase();
            return reasonCode === 'vehicle_offline' || /vehicle.*(offline|asleep|unavailable)|\boffline\b|\basleep\b|wake the vehicle/.test(errorText);
        }

        function getEVStatusMetaSource(statusMeta = {}) {
            return String(statusMeta?.source || '').trim().toLowerCase();
        }

        function getEVStatusAgeMs(status = {}) {
            const asOfIso = String(status?.asOfIso || '').trim();
            if (!asOfIso) return null;
            const parsedMs = Date.parse(asOfIso);
            if (!Number.isFinite(parsedMs)) return null;
            const ageMs = Date.now() - parsedMs;
            return Number.isFinite(ageMs) && ageMs >= 0 ? ageMs : null;
        }

        function isEVReliableImmediateStatus(statusMeta = {}) {
            const source = getEVStatusMetaSource(statusMeta);
            return source === 'live' || source === 'command_confirmed';
        }

        function isEVPotentiallyStaleStatus(status = {}, statusMeta = {}) {
            if (!isEVReliableImmediateStatus(statusMeta)) {
                return true;
            }
            const ageMs = getEVStatusAgeMs(status);
            return Number.isFinite(ageMs) && ageMs > 10 * 60 * 1000;
        }

        function isEVDisconnectedStatus(status = {}) {
            return status?.isPluggedIn === false || String(status?.chargingState || '').trim().toLowerCase() === 'disconnected';
        }

        function isEVStaleDisconnectedStatus(status = {}, statusMeta = {}, statusError = '') {
            if (!isEVDisconnectedStatus(status)) return false;
            if (isEVVehicleOfflineStatus(status, statusError)) return true;
            return isEVPotentiallyStaleStatus(status, statusMeta);
        }

        function isEVDisconnectedCommandError(reasonCode = '', errorText = '') {
            const normalizedReasonCode = String(reasonCode || '').trim().toLowerCase();
            const normalizedError = String(errorText || '').trim().toLowerCase();
            return normalizedReasonCode === 'disconnected' || /\bdisconnected\b|not plugged/.test(normalizedError);
        }

        function isEVReconnectRequiredError(errorText = '') {
            return /credential|reconnect tesla|authorization expired|invalid.?token|expired/.test(String(errorText || '').trim().toLowerCase());
        }

        function getEVConnectionDescriptor(statusError = '') {
            if (statusError && /credential/i.test(statusError)) {
                return {
                    kind: 'error',
                    label: 'Setup Required',
                    detail: 'Connect Tesla in Settings to enable status visibility'
                };
            }

            if (statusError) {
                return {
                    kind: 'warn',
                    label: 'Status Unavailable',
                    detail: 'Live vehicle status could not be loaded'
                };
            }

            return {
                kind: 'ok',
                label: 'Tesla Linked',
                detail: 'Tesla account access is active and vehicle status reads are available'
            };
        }

        function formatEVTransport(readiness = {}) {
            const state = String(readiness?.state || '').trim();
            if (state === 'ready_signed') return 'Signed Tesla commands';
            if (state === 'ready_direct') return 'Direct Tesla commands';
            if (state === 'proxy_unavailable') return 'Virtual key pairing required';
            if (state === 'read_only') return 'Read-only Tesla connection';
            return 'Checking Tesla command readiness';
        }

        function describeEVCommandAvailability(selectedVehicle, readiness, status = {}, statusMeta = {}, statusError = '', readinessError = '') {
            if (!selectedVehicle) {
                return {
                    kind: 'info',
                    label: 'No Command Target',
                    detail: 'Select a Tesla vehicle to use charging controls.',
                    canControl: false,
                    canWake: false
                };
            }

            if (!hasEVVehicleCredentialsConfigured(selectedVehicle)) {
                return {
                    kind: 'warn',
                    label: 'Setup Required',
                    detail: 'Finish Tesla OAuth in Settings before charging controls can be enabled.',
                    canControl: false,
                    canWake: false
                };
            }

            if (isEVReconnectRequiredError(statusError) || isEVReconnectRequiredError(readinessError)) {
                return {
                    kind: 'warn',
                    label: 'Setup Required',
                    detail: 'Reconnect Tesla in Settings before charging controls can be enabled.',
                    canControl: false,
                    canWake: false
                };
            }

            if (isEVVehicleOfflineStatus(status, statusError)) {
                return {
                    kind: 'warn',
                    label: 'Wake Required',
                    detail: 'Tesla reports this vehicle is asleep or offline. Use the manual wake button, then retry charging controls. Wake requests are never automatic.',
                    canControl: false,
                    canWake: true,
                    wakeTitle: 'Vehicle is asleep',
                    wakeDetail: 'A manual wake is required before charging controls become available.',
                    wakeNote: 'Wake requests are never sent automatically by dashboard refreshes or automations.'
                };
            }

            const state = String(readiness?.state || '').trim();
            if (isEVStaleDisconnectedStatus(status, statusMeta, statusError)) {
                const canControl = state === 'ready_direct' || state === 'ready_signed';
                return {
                    kind: 'warn',
                    label: 'Wake Recommended',
                    detail: 'Tesla last reported this vehicle was not plugged in, but that status may be stale. If you connected the cable after the last update, wake the vehicle to refresh live status, then retry charging controls.',
                    canControl,
                    canWake: true,
                    wakeTitle: 'Plug status may be stale',
                    wakeDetail: 'Tesla last reported the cable as disconnected. If you plugged in after that, wake the vehicle to refresh live status before retrying charging controls.',
                    wakeNote: 'Wake requests are manual only and should be used only when the dashboard status may be stale.'
                };
            }

            if (state === 'ready_direct') {
                return {
                    kind: 'ok',
                    label: 'Controls Ready',
                    detail: 'Tesla direct charging commands are available for this vehicle.',
                    canControl: true,
                    canWake: false
                };
            }
            if (state === 'ready_signed') {
                return {
                    kind: 'ok',
                    label: 'Controls Ready',
                    detail: 'Tesla signed charging commands are available for this vehicle.',
                    canControl: true,
                    canWake: false
                };
            }
            if (state === 'proxy_unavailable') {
                const pairingDomain = String(window.location.hostname || '').trim().toLowerCase();
                return {
                    kind: 'warn',
                    label: 'Pairing Required',
                    detail: `This vehicle requires virtual-key pairing before charging controls can be used. Open tesla.com/_ak/${pairingDomain} on your phone with the Tesla app, approve the key, then confirm on the vehicle screen.`,
                    canControl: false,
                    canWake: false
                };
            }
            if (state === 'setup_required') {
                return {
                    kind: 'warn',
                    label: 'Setup Required',
                    detail: 'Reconnect Tesla in Settings before charging controls can be enabled.',
                    canControl: false,
                    canWake: false
                };
            }
            if (state === 'read_only') {
                return {
                    kind: 'warn',
                    label: 'Status Only',
                    detail: 'Status visibility is available, but charging controls are not ready for this vehicle yet.',
                    canControl: false,
                    canWake: false
                };
            }
            if (readinessError) {
                return {
                    kind: 'warn',
                    label: 'Commands Unavailable',
                    detail: 'Refresh Tesla command readiness first, then retry charging controls.',
                    canControl: false,
                    canWake: false
                };
            }
            if (statusError) {
                return {
                    kind: 'warn',
                    label: 'Status Unavailable',
                    detail: 'Refresh Tesla status first, then retry charging controls.',
                    canControl: false,
                    canWake: false
                };
            }
            return {
                kind: 'info',
                label: 'Checking Controls',
                detail: 'Checking Tesla command readiness for this vehicle.',
                canControl: false,
                canWake: false
            };
        }

        function updateEVSliderFill(slider, minValue, maxValue, accentColor) {
            if (!slider) return;
            const currentValue = Number(slider.value);
            const min = Number(minValue);
            const max = Number(maxValue);
            const ratio = Number.isFinite(currentValue) && Number.isFinite(min) && Number.isFinite(max) && max > min
                ? ((currentValue - min) / (max - min)) * 100
                : 0;
            slider.style.background = `linear-gradient(to right, ${accentColor} 0%, ${accentColor} ${ratio}%, var(--border-primary) ${ratio}%, var(--border-primary) 100%)`;
        }

        function syncEVRangeSliderState() {
            const limitInput = document.getElementById('evChargeLimitInput');
            const ampsInput = document.getElementById('evChargingAmpsInput');
            const limitDisplay = document.getElementById('evChargeLimitDisplay');
            const ampsDisplay = document.getElementById('evChargingAmpsDisplay');
            const selectedStatus = getSelectedEVStatus();
            const activeAmps = Number(selectedStatus?.chargingAmps);

            if (limitInput && limitDisplay) {
                limitDisplay.textContent = `${limitInput.value}%`;
                updateEVSliderFill(limitInput, 50, 100, 'var(--accent-blue)');
            }
            if (ampsInput && ampsDisplay) {
                const sliderValue = Number(ampsInput.value);
                const hasActiveAmps = Number.isFinite(activeAmps);
                const hasDifferentTarget = hasActiveAmps && Number.isFinite(sliderValue) && Math.round(activeAmps) !== Math.round(sliderValue);
                ampsDisplay.textContent = hasDifferentTarget
                    ? `${Math.round(sliderValue)}A target · now ${Math.round(activeAmps)}A`
                    : `${ampsInput.value}A`;
                updateEVSliderFill(ampsInput, 1, 48, 'var(--color-success-dark)');
            }
        }

        function renderEVVehicleTabs() {
            const tabsEl = document.getElementById('evVehicleTabs');
            if (!tabsEl) return;
            tabsEl.innerHTML = '';

            if (evDashboardState.loadingVehicles && evDashboardState.vehicles.length === 0) {
                const loading = document.createElement('div');
                loading.style.fontSize = '12px';
                loading.style.color = 'var(--text-secondary)';
                loading.textContent = 'Loading vehicles...';
                tabsEl.appendChild(loading);
                return;
            }

            if (evDashboardState.vehicles.length === 0) {
                return;
            }

            evDashboardState.vehicles.forEach((vehicle) => {
                const vehicleId = String(vehicle.vehicleId || '');
                const hasCredentials = hasEVVehicleCredentialsConfigured(vehicle);
                const status = evDashboardState.statusByVehicleId[vehicleId] || null;
                const socText = formatEVSoc(status?.socPct);
                const chargingText = formatEVChargingState(status?.chargingState);
                const summaryText = hasCredentials
                    ? `${socText} • ${chargingText}`
                    : 'Setup Required';

                const button = document.createElement('button');
                button.type = 'button';
                button.className = `ev-vehicle-tab${evDashboardState.selectedVehicleId === vehicleId ? ' active' : ''}`;
                button.textContent = `${getEVVehicleDisplayName(vehicle)} • ${summaryText}`;
                button.addEventListener('click', () => {
                    selectEVVehicle(vehicleId);
                });
                tabsEl.appendChild(button);
            });
        }

        function renderEVSelectedSummary() {
            const summaryEl = document.getElementById('evSelectedSummary');
            const pillsEl = document.getElementById('evSelectedStatusPills');
            if (!summaryEl || !pillsEl) return;

            summaryEl.innerHTML = '';
            pillsEl.innerHTML = '';

            if (evDashboardState.vehicles.length === 0) {
                return;
            }

            const selectedVehicle = getSelectedEVVehicle();
            if (!selectedVehicle) {
                const placeholder = document.createElement('div');
                placeholder.className = 'ev-summary-stat';
                const label = document.createElement('div');
                label.className = 'ev-summary-label';
                label.textContent = 'Vehicle';
                const value = document.createElement('div');
                value.className = 'ev-summary-value';
                value.textContent = 'No vehicle selected';
                placeholder.appendChild(label);
                placeholder.appendChild(value);
                summaryEl.appendChild(placeholder);
                renderEVCommandControls(null, {}, null, {}, '');
                return;
            }

            const vehicleId = String(selectedVehicle.vehicleId || '');
            const status = evDashboardState.statusByVehicleId[vehicleId] || {};
            const meta = evDashboardState.statusMetaByVehicleId[vehicleId] || {};
            const readiness = evDashboardState.commandReadinessByVehicleId[vehicleId] || null;
            const readinessMeta = evDashboardState.readinessMetaByVehicleId[vehicleId] || {};
            const statusError = getSelectedEVStatusError();
            const readinessError = String(readinessMeta.error || '');
            const connectionDescriptor = getEVConnectionDescriptor(statusError);
            const commandDescriptor = describeEVCommandAvailability(selectedVehicle, readiness, status, meta, statusError, readinessError);

            const connectionPill = document.createElement('span');
            connectionPill.className = `ev-status-pill ${connectionDescriptor.kind}`;
            connectionPill.title = connectionDescriptor.detail;
            connectionPill.textContent = connectionDescriptor.label;
            pillsEl.appendChild(connectionPill);

            const commandPill = document.createElement('span');
            commandPill.className = `ev-status-pill ${commandDescriptor.kind}`;
            commandPill.title = commandDescriptor.detail;
            commandPill.textContent = commandDescriptor.label;
            pillsEl.appendChild(commandPill);

            if (meta.source) {
                const sourcePill = document.createElement('span');
                sourcePill.className = 'ev-status-pill';
                sourcePill.textContent = `Source: ${String(meta.source).toUpperCase()}`;
                pillsEl.appendChild(sourcePill);
            }

            const insights = deriveEVStatusInsights(status);
            const isCharging = String(status.chargingState || '').toLowerCase() === 'charging';
            const stats = [
                {
                    label: 'SoC',
                    value: formatEVSoc(status.socPct),
                    type: 'battery',
                    socPct: status.socPct,
                    chargingState: status.chargingState,
                    highlight: isCharging,
                    subvalue: (() => {
                        const stateLabel = formatEVChargingState(status.chargingState);
                        const state = String(status.chargingState || '').toLowerCase();
                        if (state === 'disconnected') return stateLabel;
                        if (status.isPluggedIn === true) return `${stateLabel} · Plugged in`;
                        if (status.isPluggedIn === false) return `${stateLabel} · Not plugged`;
                        return stateLabel;
                    })()
                },
                {
                    label: 'Range',
                    value: formatEVRangeKm(status.ratedRangeKm ?? status.rangeKm),
                    subvalue: Number.isFinite(Number(status.rangeKm)) && Number.isFinite(Number(status.ratedRangeKm)) && Math.round(Number(status.ratedRangeKm)) !== Math.round(Number(status.rangeKm))
                        ? `Est. ${formatEVRangeKm(status.rangeKm)}`
                        : 'Rated range'
                },
                {
                    label: 'To full',
                    value: formatEVHoursToFull(status.timeToFullChargeHours),
                    subvalue: Number.isFinite(Number(insights.costToFullCents))
                        ? `Est. ${formatEVCurrencyFromCents(insights.costToFullCents)}`
                        : 'Current tariff'
                },
                {
                    label: 'Session gain',
                    value: formatEVDistanceGainKm(status.rangeAddedKm),
                    subvalue: Number.isFinite(Number(status.chargeEnergyAddedKwh))
                        ? formatEVEnergyKwh(status.chargeEnergyAddedKwh)
                        : ''
                },
                {
                    label: 'Charge cost',
                    value: formatEVCurrencyFromCents(insights.costAddedCents),
                    subvalue: Number.isFinite(Number(insights.buyPriceCentsPerKwh))
                        ? `${Number(insights.buyPriceCentsPerKwh).toFixed(1)}¢/kWh`
                        : 'Tariff unavailable'
                }
            ];

            function getEVBatteryFillColor(socPct) {
                const numericSoc = Number(socPct);
                if (!Number.isFinite(numericSoc)) return 'rgba(255,255,255,0.08)';
                if (numericSoc >= 50) return 'var(--color-success-dark)';
                if (numericSoc >= 25) return 'var(--color-warning)';
                return 'var(--color-danger)';
            }

            function createEVSocValueElement(socPct, chargingState, value) {
                const wrap = document.createElement('div');
                wrap.className = 'ev-summary-value ev-summary-value--with-icon';

                const numericSoc = Number(socPct);
                const normalizedSoc = Number.isFinite(numericSoc)
                    ? Math.max(0, Math.min(100, numericSoc))
                    : null;
                const fillHeight = normalizedSoc === null ? 0 : Math.round((normalizedSoc / 100) * 18);
                const fillY = 3 + (18 - fillHeight);
                const fillColor = getEVBatteryFillColor(normalizedSoc);
                const battery = document.createElement('div');
                battery.className = `ev-summary-battery${String(chargingState || '').toLowerCase() === 'charging' ? ' charging' : ''}`;
                battery.setAttribute('aria-hidden', 'true');
                battery.innerHTML = `
                    <svg viewBox="0 0 24 32" focusable="false">
                        <rect x="3" y="3" width="16" height="18" rx="3" ry="3" fill="var(--battery-shell-bg)"></rect>
                        <rect x="3" y="3" width="16" height="18" rx="3" ry="3" fill="none" stroke="var(--battery-shell-color)" stroke-width="1.5"></rect>
                        <rect x="3" y="${fillY}" width="16" height="${fillHeight}" rx="2" ry="2" class="level" fill="${fillColor}"></rect>
                        <rect x="8" y="0.5" width="6" height="2" rx="1" ry="1" fill="var(--battery-shell-color)"></rect>
                    </svg>`;

                const text = document.createElement('div');
                text.className = 'ev-summary-value-main';
                const valueEl = document.createElement('span');
                valueEl.textContent = value;
                text.appendChild(valueEl);
                if (normalizedSoc !== null) {
                    const suffix = document.createElement('span');
                    suffix.className = 'ev-summary-value-suffix';
                    suffix.textContent = normalizedSoc >= 50 ? 'healthy' : (normalizedSoc >= 25 ? 'mid' : 'low');
                    text.appendChild(suffix);
                }

                wrap.appendChild(battery);
                wrap.appendChild(text);
                return wrap;
            }

            stats.forEach((stat) => {
                const card = document.createElement('div');
                card.className = `ev-summary-stat${stat.highlight ? ' is-charging' : ''}`;
                const labelEl = document.createElement('div');
                labelEl.className = 'ev-summary-label';
                labelEl.textContent = stat.label;
                card.appendChild(labelEl);

                if (stat.type === 'battery') {
                    card.appendChild(createEVSocValueElement(stat.socPct, stat.chargingState, stat.value));
                } else {
                    const valueEl = document.createElement('div');
                    valueEl.className = 'ev-summary-value';
                    valueEl.textContent = stat.value;
                    card.appendChild(valueEl);
                }

                if (stat.subvalue) {
                    const subvalueEl = document.createElement('div');
                    subvalueEl.className = 'ev-summary-subvalue';
                    subvalueEl.textContent = stat.subvalue;
                    card.appendChild(subvalueEl);
                }

                summaryEl.appendChild(card);
            });

            const footerEl = document.createElement('div');
            footerEl.className = 'ev-summary-footer';
            footerEl.textContent = formatEVLastUpdatedLabel(meta, status);
            summaryEl.appendChild(footerEl);

            renderEVCommandControls(selectedVehicle, status, readiness, readinessMeta, statusError);
        }

        function renderEVCommandControls(selectedVehicle, status = {}, readiness = null, readinessMeta = {}, statusError = '') {
            const controlsEl = document.getElementById('evControls');
            const transportHintEl = document.getElementById('evControlsTransportHint');
            const hintEl = document.getElementById('evCommandHint');
            const wakeBtn = document.getElementById('evWakeVehicleBtn');
            const wakePrompt = document.getElementById('evWakePrompt');
            const sessionGroup = document.getElementById('evSessionControlGroup');
            const limitGroup = document.getElementById('evChargeLimitGroup');
            const ampsGroup = document.getElementById('evChargingAmpsGroup');
            const startBtn = document.getElementById('evStartChargingBtn');
            const stopBtn = document.getElementById('evStopChargingBtn');
            const limitInput = document.getElementById('evChargeLimitInput');
            const limitBtn = document.getElementById('evSetChargeLimitBtn');
            const ampsInput = document.getElementById('evChargingAmpsInput');
            const ampsBtn = document.getElementById('evSetChargingAmpsBtn');
            if (!controlsEl || !hintEl) return;

            const statusMeta = evDashboardState.statusMetaByVehicleId[String(selectedVehicle?.vehicleId || '')] || {};
            const commandDescriptor = describeEVCommandAvailability(selectedVehicle, readiness, status, statusMeta, statusError, String(readinessMeta?.error || ''));
            const canControl = commandDescriptor.canControl === true;
            const canWake = commandDescriptor.canWake === true;
            const inFlight = evDashboardState.commandInFlight === true || evDashboardState.wakeInFlight === true;
            const isCharging = String(status?.chargingState || '').toLowerCase() === 'charging';

            controlsEl.classList.toggle('is-visible', canControl || canWake);
            controlsEl.style.display = (canControl || canWake) ? 'block' : 'none';
            if (transportHintEl) {
                transportHintEl.textContent = canControl ? formatEVTransport(readiness) : '';
            }
            if (wakePrompt) {
                wakePrompt.style.display = canWake ? '' : 'none';
                const wakeTitleEl = wakePrompt.querySelector('.ev-wake-prompt-title');
                const wakeDescEl = wakePrompt.querySelector('.ev-wake-prompt-desc');
                const wakeNoteEl = document.getElementById('evWakeVehicleNote');
                if (wakeTitleEl) {
                    wakeTitleEl.textContent = commandDescriptor.wakeTitle || 'Vehicle wake recommended';
                }
                if (wakeDescEl) {
                    wakeDescEl.textContent = commandDescriptor.wakeDetail || 'Wake the vehicle to refresh live Tesla status before retrying charging controls.';
                }
                if (wakeNoteEl) {
                    wakeNoteEl.textContent = commandDescriptor.wakeNote || 'Wake requests are never sent automatically by dashboard refreshes or automations';
                }
            }
            if (wakeBtn) {
                wakeBtn.disabled = !canWake || inFlight;
                wakeBtn.textContent = evDashboardState.wakeInFlight ? 'Waking...' : 'Wake vehicle';
            }
            [sessionGroup, limitGroup, ampsGroup].forEach((element) => {
                if (!element) return;
                element.classList.toggle('is-hidden', !canControl);
            });

            if (canControl) {
                const currentHint = String(hintEl.textContent || '').trim();
                if (/checking tesla command readiness/i.test(currentHint)) {
                    setEVCommandHint('', '');
                }
            } else if (selectedVehicle) {
                const hintKind = commandDescriptor.kind === 'error' ? 'error' : (commandDescriptor.kind === 'info' ? 'info' : 'warning');
                setEVCommandHint(hintKind, commandDescriptor.detail);
            } else {
                setEVCommandHint('', '');
            }

            if (!selectedVehicle) return;

            if (limitInput && document.activeElement !== limitInput) {
                const currentLimit = Number(status?.chargeLimitPct);
                limitInput.value = Number.isFinite(currentLimit)
                    ? String(Math.max(50, Math.min(100, Math.round(currentLimit))))
                    : (String(limitInput.value || '').trim() || '80');
            }

            if (ampsInput && document.activeElement !== ampsInput) {
                const currentAmps = Number(status?.chargingAmps || ampsInput.value || 16);
                ampsInput.value = Number.isFinite(currentAmps)
                    ? String(Math.max(1, Math.min(48, Math.round(currentAmps))))
                    : '16';
            }

            syncEVRangeSliderState();

            [startBtn, stopBtn, limitInput, limitBtn, ampsInput, ampsBtn].forEach((element) => {
                if (!element) return;
                element.disabled = !canControl || inFlight;
            });

            if (startBtn) {
                startBtn.textContent = inFlight ? 'Sending...' : 'Start charging';
                startBtn.disabled = !canControl || inFlight || isCharging;
            }
            if (stopBtn) {
                stopBtn.textContent = inFlight ? 'Sending...' : 'Stop charging';
                stopBtn.disabled = !canControl || inFlight || !isCharging;
            }
            if (ampsBtn) {
                ampsBtn.disabled = !canControl || inFlight || !isCharging;
            }
            if (readinessMeta.loading === true && !canControl) {
                setEVCommandHint('info', 'Checking Tesla command readiness for this vehicle.');
            }
        }

        function renderEVOverview() {
            updateEVVehicleCountBadge();
            renderEVVehicleTabs();
            renderEVSelectedSummary();
        }

        async function fetchEVVehicleCommandReadiness(vehicleId, options = {}) {
            const silent = options.silent === true;
            const selectedId = String(vehicleId || '');
            if (!selectedId) return null;

            const selectedVehicle = evDashboardState.vehicles.find((vehicle) => String(vehicle.vehicleId || '') === selectedId) || null;
            if (!selectedVehicle || !hasEVVehicleCredentialsConfigured(selectedVehicle)) {
                delete evDashboardState.commandReadinessByVehicleId[selectedId];
                evDashboardState.readinessMetaByVehicleId[selectedId] = {
                    source: 'setup',
                    loadedAtMs: Date.now(),
                    error: 'Vehicle credentials not configured. Connect Tesla in Settings to finish setup.',
                    loading: false
                };
                if (!silent) renderEVOverview();
                return null;
            }

            if (isDashboardLocalMockEnabled()) {
                const readiness = {
                    state: 'ready_direct',
                    transport: 'direct',
                    source: 'mock',
                    vehicleCommandProtocolRequired: false
                };
                evDashboardState.commandReadinessByVehicleId[selectedId] = readiness;
                evDashboardState.readinessMetaByVehicleId[selectedId] = {
                    source: 'mock',
                    loadedAtMs: Date.now(),
                    error: '',
                    loading: false
                };
                if (!silent) renderEVOverview();
                return readiness;
            }

            evDashboardState.loadingReadinessByVehicleId[selectedId] = true;
            evDashboardState.readinessMetaByVehicleId[selectedId] = {
                source: '',
                loadedAtMs: Date.now(),
                error: '',
                loading: true
            };
            if (!silent) renderEVOverview();

            try {
                const response = await authenticatedFetch(`/api/ev/vehicles/${encodeURIComponent(selectedId)}/command-readiness`);
                let data = null;
                try {
                    data = await response.json();
                } catch {
                    data = null;
                }

                if (response.ok && data && data.errno === 0 && data.result) {
                    evDashboardState.commandReadinessByVehicleId[selectedId] = data.result;
                    evDashboardState.readinessMetaByVehicleId[selectedId] = {
                        source: data.result.source || 'readiness',
                        loadedAtMs: Date.now(),
                        error: '',
                        loading: false
                    };
                    return data.result;
                }

                delete evDashboardState.commandReadinessByVehicleId[selectedId];
                evDashboardState.readinessMetaByVehicleId[selectedId] = {
                    source: '',
                    loadedAtMs: Date.now(),
                    error: extractEVApiErrorMessage(data, `Failed to load command readiness (HTTP ${response.status})`),
                    loading: false
                };
                return null;
            } catch (error) {
                delete evDashboardState.commandReadinessByVehicleId[selectedId];
                evDashboardState.readinessMetaByVehicleId[selectedId] = {
                    source: '',
                    loadedAtMs: Date.now(),
                    error: String(error?.message || 'Failed to load command readiness'),
                    loading: false
                };
                return null;
            } finally {
                delete evDashboardState.loadingReadinessByVehicleId[selectedId];
                renderEVOverview();
            }
        }

        async function fetchEVVehicleStatus(vehicleId, options = {}) {
            const live = options.live === true;
            const silent = options.silent === true;
            const selectedId = String(vehicleId || '');
            if (!selectedId) return null;

            if (isDashboardLocalMockEnabled()) {
                const status = getMockEVStatus(selectedId);
                evDashboardState.statusByVehicleId[selectedId] = status;
                evDashboardState.statusMetaByVehicleId[selectedId] = {
                    source: 'mock',
                    loadedAtMs: Date.now(),
                    error: ''
                };
                if (silent) renderEVOverview();
                return status;
            }

            evDashboardState.loadingStatusByVehicleId[selectedId] = true;
            if (!silent) renderEVOverview();

            try {
                const query = live ? '?live=1' : '';
                const response = await authenticatedFetch(`/api/ev/vehicles/${encodeURIComponent(selectedId)}/status${query}`);
                let data = null;
                try {
                    data = await response.json();
                } catch {
                    data = null;
                }

                if (response.ok && data && data.errno === 0 && data.result) {
                    evDashboardState.statusByVehicleId[selectedId] = data.result;
                    evDashboardState.statusMetaByVehicleId[selectedId] = {
                        source: data.source || (live ? 'live' : 'cache'),
                        loadedAtMs: Date.now(),
                        error: ''
                    };
                    return data.result;
                }

                const errorMessage = String(data?.error || `Failed to load status (HTTP ${response.status})`);
                evDashboardState.statusMetaByVehicleId[selectedId] = {
                    source: '',
                    loadedAtMs: Date.now(),
                    error: errorMessage
                };
                return null;
            } catch (error) {
                evDashboardState.statusMetaByVehicleId[selectedId] = {
                    source: '',
                    loadedAtMs: Date.now(),
                    error: String(error?.message || 'Failed to load status')
                };
                return null;
            } finally {
                delete evDashboardState.loadingStatusByVehicleId[selectedId];
                renderEVOverview();
            }
        }

        async function selectEVVehicle(vehicleId, options = {}) {
            const selectedId = String(vehicleId || '');
            if (!selectedId) return;
            evDashboardState.selectedVehicleId = selectedId;
            renderEVOverview();

            const selectedVehicle = getSelectedEVVehicle();
            if (selectedVehicle && !hasEVVehicleCredentialsConfigured(selectedVehicle)) {
                evDashboardState.statusMetaByVehicleId[selectedId] = {
                    source: 'setup',
                    loadedAtMs: Date.now(),
                    error: 'Vehicle credentials not configured. Connect Tesla in Settings to finish setup.'
                };
                delete evDashboardState.commandReadinessByVehicleId[selectedId];
                evDashboardState.readinessMetaByVehicleId[selectedId] = {
                    source: 'setup',
                    loadedAtMs: Date.now(),
                    error: 'Vehicle credentials not configured. Connect Tesla in Settings to finish setup.',
                    loading: false
                };
                renderEVOverview();
                return;
            }

            const forceLive = options.forceLive === true;
            await fetchEVVehicleStatus(selectedId, { live: forceLive, silent: true });
            await fetchEVVehicleCommandReadiness(selectedId, { silent: true });

        }

        function clearStaleEVState() {
            const validIds = new Set(evDashboardState.vehicles.map((vehicle) => String(vehicle.vehicleId || '')));

            Object.keys(evDashboardState.statusByVehicleId).forEach((vehicleId) => {
                if (!validIds.has(vehicleId)) delete evDashboardState.statusByVehicleId[vehicleId];
            });
            Object.keys(evDashboardState.statusMetaByVehicleId).forEach((vehicleId) => {
                if (!validIds.has(vehicleId)) delete evDashboardState.statusMetaByVehicleId[vehicleId];
            });
            Object.keys(evDashboardState.commandReadinessByVehicleId).forEach((vehicleId) => {
                if (!validIds.has(vehicleId)) delete evDashboardState.commandReadinessByVehicleId[vehicleId];
            });
            Object.keys(evDashboardState.readinessMetaByVehicleId).forEach((vehicleId) => {
                if (!validIds.has(vehicleId)) delete evDashboardState.readinessMetaByVehicleId[vehicleId];
            });
        }

        async function loadEVOverviewData(forceLiveSelected = false) {
            const currentSelected = String(evDashboardState.selectedVehicleId || '');
            evDashboardState.loadingVehicles = true;
            renderEVOverview();

            try {
                if (isDashboardLocalMockEnabled()) {
                    evDashboardState.vehicles = getMockEVVehicles();
                    const firstId = String(evDashboardState.vehicles[0]?.vehicleId || '');
                    evDashboardState.selectedVehicleId = currentSelected && evDashboardState.vehicles.some((v) => String(v.vehicleId) === currentSelected)
                        ? currentSelected
                        : firstId;

                    evDashboardState.statusByVehicleId = {};
                    evDashboardState.commandReadinessByVehicleId = {};
                    evDashboardState.statusMetaByVehicleId = {};
                    evDashboardState.readinessMetaByVehicleId = {};

                    evDashboardState.vehicles.forEach((vehicle) => {
                        const vehicleId = String(vehicle.vehicleId || '');
                        if (!vehicleId) return;
                        evDashboardState.statusByVehicleId[vehicleId] = getMockEVStatus(vehicleId);
                        evDashboardState.commandReadinessByVehicleId[vehicleId] = getMockEVCommandReadiness(vehicleId);
                        evDashboardState.statusMetaByVehicleId[vehicleId] = {
                            source: 'mock',
                            loadedAtMs: Date.now(),
                            error: ''
                        };
                        evDashboardState.readinessMetaByVehicleId[vehicleId] = {
                            source: 'mock',
                            loadedAtMs: Date.now(),
                            error: '',
                            loading: false
                        };
                    });

                    setEVOverviewMessage('', '');
                    renderEVOverview();
                    return;
                }

                const response = await authenticatedFetch('/api/ev/vehicles');
                const data = await response.json();

                if (!response.ok || data?.errno !== 0 || !Array.isArray(data?.result)) {
                    const errorText = String(data?.error || `Failed to load vehicles (HTTP ${response.status})`);
                    setEVOverviewMessage('warning', errorText);
                    evDashboardState.vehicles = [];
                    evDashboardState.selectedVehicleId = '';
                    clearStaleEVState();
                    renderEVOverview();
                    return;
                }

                evDashboardState.vehicles = data.result;
                clearStaleEVState();

                if (evDashboardState.vehicles.length === 0) {
                    evDashboardState.selectedVehicleId = '';
                    setEVOverviewMessage('info', 'No Tesla vehicles linked yet. <a href="/settings.html" style="color:var(--accent-blue);text-decoration:none;">Connect one in Settings</a>.', true);
                    renderEVOverview();
                    return;
                }

                const hasPreviousSelection = evDashboardState.vehicles.some((vehicle) => String(vehicle.vehicleId) === currentSelected);
                evDashboardState.selectedVehicleId = hasPreviousSelection
                    ? currentSelected
                    : String(evDashboardState.vehicles[0].vehicleId || '');

                setEVOverviewMessage('', '');
                renderEVOverview();

                const statusFetches = evDashboardState.vehicles.map((vehicle) => {
                    const vehicleId = String(vehicle.vehicleId || '');
                    if (!vehicleId) return Promise.resolve(null);

                    if (!hasEVVehicleCredentialsConfigured(vehicle)) {
                        delete evDashboardState.statusByVehicleId[vehicleId];
                        evDashboardState.statusMetaByVehicleId[vehicleId] = {
                            source: 'setup',
                            loadedAtMs: Date.now(),
                            error: 'Vehicle credentials not configured. Connect Tesla in Settings to finish setup.'
                        };
                        return Promise.resolve(null);
                    }

                    const live = forceLiveSelected && vehicleId === evDashboardState.selectedVehicleId;
                    return fetchEVVehicleStatus(vehicleId, { live, silent: true });
                });
                await Promise.all(statusFetches);

                if (evDashboardState.selectedVehicleId) {
                    await fetchEVVehicleCommandReadiness(evDashboardState.selectedVehicleId, { silent: true });
                }
            } catch (error) {
                const message = String(error?.message || 'Failed to load EV overview');
                setEVOverviewMessage('warning', message);
            } finally {
                evDashboardState.loadingVehicles = false;
                renderEVOverview();
            }
        }

        function guardEVCommand(command, status = {}, statusMeta = {}) {
            const chargingState = String(status?.chargingState || '').toLowerCase();
            const isPluggedIn = status?.isPluggedIn;

            if (command === 'startCharging') {
                if (isEVStaleDisconnectedStatus(status, statusMeta, String(statusMeta?.error || ''))) {
                    return {
                        blocked: true,
                        message: 'Tesla last reported the car was not plugged in, but that status may be stale. If you plugged it in after the last update, use Wake vehicle to refresh live status, then retry.'
                    };
                }
                if (isPluggedIn === false) {
                    return { blocked: true, message: 'Car is not plugged in. Connect the charging cable before starting a session.' };
                }
                if (chargingState === 'charging') {
                    return { blocked: true, message: 'Car is already charging. Stop the current session first, or adjust the charge limit / amps instead.' };
                }
            }

            if (command === 'stopCharging') {
                if (chargingState && chargingState !== 'charging' && chargingState !== 'unknown') {
                    return { blocked: true, message: `Car is not currently charging (status: ${formatEVChargingState(status?.chargingState)}). Nothing to stop.` };
                }
            }

            const ageMs = getEVStatusAgeMs(status);
            if (Number.isFinite(ageMs)) {
                if (ageMs > 10 * 60 * 1000) {
                    return { blocked: false, staleWarning: true, message: `Vehicle status is ${Math.round(ageMs / 60000)} min old — the car's state may have changed. Sending command anyway.` };
                }
            }

            return { blocked: false };
        }

        async function refreshEVOverview(forceLiveSelected = false) {
            await loadEVOverviewData(forceLiveSelected === true);
        }

        async function submitEVVehicleCommand(command, extraPayload = {}) {
            const selectedVehicle = getSelectedEVVehicle();
            const vehicleId = String(selectedVehicle?.vehicleId || '');
            if (!vehicleId) {
                setEVOverviewMessage('warning', 'Select a Tesla vehicle before sending charging commands.');
                return null;
            }

            const readiness = getSelectedEVCommandReadiness();
            const status = getSelectedEVStatus();
            const statusMeta = getSelectedEVStatusMeta();
            const statusError = getSelectedEVStatusError();
            const readinessError = getSelectedEVReadinessError();
            const commandDescriptor = describeEVCommandAvailability(selectedVehicle, readiness, status, statusMeta, statusError, readinessError);
            if (commandDescriptor.canControl !== true) {
                setEVCommandHint('warning', commandDescriptor.detail);
                renderEVOverview();
                return null;
            }

            const guard = guardEVCommand(command, status, statusMeta);
            if (guard.blocked) {
                setEVOverviewMessage('warning', guard.message);
                return null;
            }
            if (guard.staleWarning) {
                setEVOverviewMessage('warning', guard.message);
            }

            evDashboardState.commandInFlight = true;
            setEVOverviewMessage('info', `Sending ${command} to Tesla...`);
            renderEVOverview();

            try {
                let data = null;
                if (isDashboardLocalMockEnabled()) {
                    data = {
                        errno: 0,
                        result: {
                            accepted: true,
                            command,
                            vehicleId,
                            transport: 'direct',
                            asOfIso: new Date().toISOString()
                        }
                    };
                } else {
                    const response = await authenticatedFetch(`/api/ev/vehicles/${encodeURIComponent(vehicleId)}/command`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ command, ...extraPayload })
                    });
                    try {
                        data = await response.json();
                    } catch {
                        data = null;
                    }
                    if (!response.ok || !data || data.errno !== 0) {
                        const errorDetails = extractEVApiErrorDetails(data, `Tesla command failed (HTTP ${response.status})`);
                        const requestError = new Error(errorDetails.message);
                        requestError.reasonCode = errorDetails.reasonCode;
                        throw requestError;
                    }
                }

                const successMessage = command === 'setChargeLimit'
                    ? `Tesla charge limit updated to ${extraPayload.targetSocPct}%.`
                    : command === 'setChargingAmps'
                        ? `Tesla charging amps updated to ${extraPayload.chargingAmps}A.`
                        : command === 'stopCharging'
                            ? 'Tesla charging stop request accepted.'
                            : 'Tesla charging start request accepted.';
                setEVOverviewMessage('success', successMessage);
                if (data?.result?.readiness) {
                    evDashboardState.commandReadinessByVehicleId[vehicleId] = data.result.readiness;
                    evDashboardState.readinessMetaByVehicleId[vehicleId] = {
                        ...(evDashboardState.readinessMetaByVehicleId[vehicleId] || {}),
                        source: data.result.readiness.source || data.result.readiness.transport || 'command',
                        loadedAtMs: Date.now(),
                        error: '',
                        loading: false
                    };
                }
                await fetchEVVehicleStatus(vehicleId, { live: true, silent: true });
                return data?.result || null;
            } catch (error) {
                const message = String(error?.message || 'Tesla command failed');
                const reasonCode = String(error?.reasonCode || '').trim().toLowerCase();
                setEVOverviewMessage('error', message);
                if (isEVReconnectRequiredError(message)) {
                    delete evDashboardState.commandReadinessByVehicleId[vehicleId];
                    evDashboardState.readinessMetaByVehicleId[vehicleId] = {
                        ...(evDashboardState.readinessMetaByVehicleId[vehicleId] || {}),
                        source: 'command_guard',
                        loadedAtMs: Date.now(),
                        error: 'Tesla authorization expired for this vehicle. Reconnect Tesla in Settings.',
                        loading: false
                    };
                    setEVCommandHint('warning', 'Tesla authorization expired for this vehicle. Reconnect Tesla in Settings before retrying charging controls.');
                }
                if (/vehicle command protocol|signed-command proxy|signed command proxy|not_a_json_request|virtual key|missing_virtual_key/i.test(message)) {
                    const pairingDomain = String(window.location.hostname || '').trim().toLowerCase();
                    setEVCommandHint('warning', `This vehicle requires virtual-key pairing before charging commands will work. On your phone with the Tesla app installed, open tesla.com/_ak/${pairingDomain}, approve in the app, then confirm on the vehicle screen.`);
                }
                if (isEVDisconnectedCommandError(reasonCode, message)) {
                    evDashboardState.statusByVehicleId[vehicleId] = {
                        ...(evDashboardState.statusByVehicleId[vehicleId] || {}),
                        isPluggedIn: false,
                        chargingState: 'disconnected',
                        asOfIso: new Date().toISOString()
                    };
                    evDashboardState.statusMetaByVehicleId[vehicleId] = {
                        ...(evDashboardState.statusMetaByVehicleId[vehicleId] || {}),
                        source: 'command_confirmed',
                        loadedAtMs: Date.now(),
                        error: ''
                    };
                    setEVOverviewMessage('warning', 'Tesla reports the vehicle is not plugged in. Connect the charging cable, then retry charging controls.');
                    setEVCommandHint('warning', 'Tesla confirmed the cable is disconnected. Connect it, then retry charging controls.');
                }
                if (reasonCode === 'vehicle_offline' || /offline|asleep|wake the vehicle/i.test(message)) {
                    evDashboardState.statusByVehicleId[vehicleId] = {
                        ...(evDashboardState.statusByVehicleId[vehicleId] || {}),
                        reasonCode: 'vehicle_offline'
                    };
                    evDashboardState.statusMetaByVehicleId[vehicleId] = {
                        ...(evDashboardState.statusMetaByVehicleId[vehicleId] || {}),
                        source: (evDashboardState.statusMetaByVehicleId[vehicleId] || {}).source || 'command_guard',
                        loadedAtMs: Date.now(),
                        error: 'Tesla vehicle is offline or asleep. Use the manual wake button, then retry.'
                    };
                    setEVCommandHint('warning', 'Tesla reports this vehicle is asleep or offline. Use the manual wake button, then retry charging controls.');
                }
                return null;
            } finally {
                evDashboardState.commandInFlight = false;
                renderEVOverview();
            }
        }

        async function submitEVVehicleWake() {
            const selectedVehicle = getSelectedEVVehicle();
            const vehicleId = String(selectedVehicle?.vehicleId || '');
            if (!vehicleId) {
                setEVOverviewMessage('warning', 'Select a Tesla vehicle before sending a wake request.');
                return null;
            }

            evDashboardState.wakeInFlight = true;
            setEVOverviewMessage('info', 'Sending manual Tesla wake request...');
            setEVCommandHint('info', 'Manual wake in progress. Charging controls will stay disabled until the vehicle responds.');
            renderEVOverview();

            try {
                let data = null;
                if (isDashboardLocalMockEnabled()) {
                    data = {
                      errno: 0,
                      result: {
                        accepted: true,
                        command: 'wakeVehicle',
                        vehicleId,
                        wakeState: 'online',
                        status: 'online',
                        asOfIso: new Date().toISOString()
                      }
                    };
                } else {
                    const response = await authenticatedFetch(`/api/ev/vehicles/${encodeURIComponent(vehicleId)}/wake`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({})
                    });
                    try {
                        data = await response.json();
                    } catch {
                        data = null;
                    }
                    if (!response.ok || !data || data.errno !== 0) {
                        throw new Error(extractEVApiErrorMessage(data, `Tesla wake failed (HTTP ${response.status})`));
                    }
                }

                evDashboardState.statusMetaByVehicleId[vehicleId] = {
                    ...(evDashboardState.statusMetaByVehicleId[vehicleId] || {}),
                    loadedAtMs: Date.now(),
                    error: ''
                };
                setEVOverviewMessage('success', 'Manual Tesla wake request accepted. Refreshing live status now.');
                await fetchEVVehicleStatus(vehicleId, { live: true, silent: true });
                setEVCommandHint('success', 'Vehicle wake requested. If Tesla still reports asleep, wait a few seconds and retry.');
                return data?.result || null;
            } catch (error) {
                const message = String(error?.message || 'Tesla wake failed');
                setEVOverviewMessage('error', message);
                setEVCommandHint('warning', 'Manual wake did not complete. Retry only when needed because wake requests are rate-limited.');
                return null;
            } finally {
                evDashboardState.wakeInFlight = false;
                renderEVOverview();
            }
        }

        async function handleEVSetChargeLimit() {
            const input = document.getElementById('evChargeLimitInput');
            const targetSocPct = Math.round(Number(input?.value));
            if (!Number.isFinite(targetSocPct) || targetSocPct < 50 || targetSocPct > 100) {
                setEVOverviewMessage('warning', 'Charge limit must be between 50 and 100.');
                return;
            }
            await submitEVVehicleCommand('setChargeLimit', { targetSocPct });
        }

        async function handleEVSetChargingAmps() {
            const input = document.getElementById('evChargingAmpsInput');
            const chargingAmps = Math.round(Number(input?.value));
            if (!Number.isFinite(chargingAmps) || chargingAmps < 1 || chargingAmps > 48) {
                setEVOverviewMessage('warning', 'Charging amps must be between 1 and 48.');
                return;
            }
            await submitEVVehicleCommand('setChargingAmps', { chargingAmps });
        }

        function bindEVOverviewControls() {
            if (evDashboardState.controlsBound) return;
            const wakeBtn = document.getElementById('evWakeVehicleBtn');
            const startBtn = document.getElementById('evStartChargingBtn');
            const stopBtn = document.getElementById('evStopChargingBtn');
            const limitBtn = document.getElementById('evSetChargeLimitBtn');
            const ampsBtn = document.getElementById('evSetChargingAmpsBtn');
            const limitInput = document.getElementById('evChargeLimitInput');
            const ampsInput = document.getElementById('evChargingAmpsInput');
            if (!wakeBtn || !startBtn || !stopBtn || !limitBtn || !ampsBtn || !limitInput || !ampsInput) return;

            wakeBtn.addEventListener('click', () => submitEVVehicleWake());
            startBtn.addEventListener('click', () => submitEVVehicleCommand('startCharging'));
            stopBtn.addEventListener('click', () => submitEVVehicleCommand('stopCharging'));
            limitBtn.addEventListener('click', () => handleEVSetChargeLimit());
            ampsBtn.addEventListener('click', () => handleEVSetChargingAmps());
            limitInput.addEventListener('input', () => syncEVRangeSliderState());
            ampsInput.addEventListener('input', () => syncEVRangeSliderState());
            evDashboardState.controlsBound = true;
        }

        // Expose EV handlers for inline dashboard controls.
        window.refreshEVOverview = refreshEVOverview;
        window.selectEVVehicle = selectEVVehicle;
        
        // ============================================================
        // Quick Controls
        // ============================================================
        
        let quickControlState = {
            type: 'charge', // 'charge' or 'discharge'
            power: 5000,
            duration: 30,
            countdownInterval: null
        };
        
        function selectQuickControlType(type) {
            quickControlState.type = type;
            const chargeBtn = document.getElementById('btnChargeType');
            const dischargeBtn = document.getElementById('btnDischargeType');
            
            if (type === 'charge') {
                chargeBtn.style.background = 'var(--accent-blue)';
                chargeBtn.style.borderColor = 'var(--accent-blue)';
                dischargeBtn.style.background = '';
                dischargeBtn.style.borderColor = '';
            } else {
                dischargeBtn.style.background = 'var(--color-danger)';
                dischargeBtn.style.borderColor = 'var(--color-danger)';
                chargeBtn.style.background = '';
                chargeBtn.style.borderColor = '';
            }
        }
        
        function updateQuickControlPowerDisplay(value) {
            quickControlState.power = parseInt(value);
            document.getElementById('quickControlPowerDisplay').textContent = (quickControlState.power / 1000).toFixed(1);
        }
        
        function setQuickControlPower(watts) {
            document.getElementById('quickControlPower').value = watts;
            updateQuickControlPowerDisplay(watts);
        }

        // Applies the user's inverter capacity to the quick-control slider and preset button.
        // Called after user config loads from /api/config.
        function applyInverterCapacityToUI(capacityW) {
            const effectiveCapacityW = getEffectiveInverterCapacityW(capacityW);
            const slider = document.getElementById('quickControlPower');
            if (slider) {
                slider.max = effectiveCapacityW;
                if (parseInt(slider.value) > effectiveCapacityW) {
                    slider.value = effectiveCapacityW;
                    updateQuickControlPowerDisplay(effectiveCapacityW);
                }
            }
            const maxLabel = document.getElementById('quickControlMaxLabel');
            if (maxLabel) maxLabel.textContent = `${(effectiveCapacityW / 1000).toFixed(1)} kW`;
            const maxBtn = document.getElementById('quickControlMaxBtn');
            if (maxBtn) {
                maxBtn.onclick = () => setQuickControlPower(effectiveCapacityW);
                maxBtn.textContent = `${(effectiveCapacityW / 1000).toFixed(1)} kW`;
            }
            applyRulePowerCapacityToUI(effectiveCapacityW);
        }
        
        function updateQuickControlDurationDisplay(value) {
            quickControlState.duration = parseInt(value);
            document.getElementById('quickControlDurationDisplay').textContent = quickControlState.duration;
        }
        
        function setQuickControlDuration(minutes) {
            const duration = parseInt(minutes);
            if (duration >= 2 && duration <= 360) {
                document.getElementById('quickControlDuration').value = Math.min(300, duration);
                quickControlState.duration = duration;
                document.getElementById('quickControlDurationDisplay').textContent = duration;
                const customInput = document.getElementById('quickControlDurationCustom');
                if (duration > 300) {
                    customInput.value = duration;
                    customInput.style.display = 'block';
                } else {
                    customInput.style.display = 'none';
                }
            }
        }
        
        function toggleQuickControlCustomDuration() {
            const customInput = document.getElementById('quickControlDurationCustom');
            if (customInput.style.display === 'none') {
                customInput.style.display = 'block';
                customInput.focus();
            } else {
                customInput.style.display = 'none';
            }
        }
        
        // Initialize Quick Control status on page load
        document.addEventListener('DOMContentLoaded', () => {
            // Load initial status
            refreshQuickControlStatus();
        });

        function isNotAuthenticatedError(error) {
            const msg = String(error?.message || error || '').toLowerCase();
            return msg.includes('not authenticated') || msg.includes('401');
        }

        function applyProviderNoticeToQCForm(provider) {
            const noticeEl = document.getElementById('quickControlProviderNotice');
            if (!noticeEl) return;
            const caps = resolveProviderCapabilities(provider || _userProvider);
            if (caps.provider === 'alphaess') {
                noticeEl.style.display = 'block';
                noticeEl.innerHTML =
                    '<strong style="color:var(--accent-blue);">ℹ️ AlphaESS Note</strong><br>' +
                    '• <strong>Time windows are rounded to 15-minute slots</strong> — a 5-min charge will use the nearest 15-min window.<br>' +
                    '• <strong>Power setting is advisory</strong> — AlphaESS controls the actual charge/discharge rate within the window.<br>' +
                    '• Allow <strong>~30–60 seconds</strong> for your inverter to pick up the new schedule.';
            } else if (caps.provider === 'sungrow') {
                noticeEl.style.display = 'block';
                noticeEl.innerHTML =
                    '<strong style="color:var(--accent-blue);">ℹ️ Sungrow Note</strong><br>' +
                    '• Quick Control currently works by writing a Sungrow TOU window rather than an exact power command.<br>' +
                    '• <strong>Power is requested, not guaranteed</strong>, and the inverter may choose a different charge/discharge rate.<br>' +
                    '• Allow <strong>~30–60 seconds</strong> for the inverter to apply the updated schedule.';
            } else {
                noticeEl.style.display = 'none';
                noticeEl.innerHTML = '';
            }
        }
        
        async function refreshQuickControlStatus(showFeedback = false) {
            if (showFeedback) {
                const messageEl = document.getElementById('quickControlMessage');
                if (messageEl) {
                    messageEl.style.display = 'block';
                    messageEl.style.background = 'var(--accent-blue)';
                    messageEl.textContent = '🔄 Refreshing...';
                }
            }

            if (isPreviewMode()) {
                updateQuickControlUI(getMockQuickControlStatus());
                checkQuickControlAutomationWarning();
                if (showFeedback) {
                    const messageEl = document.getElementById('quickControlMessage');
                    if (messageEl) {
                        messageEl.style.background = 'color-mix(in srgb, var(--accent-blue) 18%, transparent)';
                        messageEl.textContent = 'Preview data refreshed';
                        setTimeout(() => { messageEl.style.display = 'none'; }, 1500);
                    }
                }
                return;
            }
            
            try {
                const resp = await authenticatedFetch('/api/quickcontrol/status');
                const data = await resp.json();
                
                if (data.errno === 0 && data.result) {
                    // Update form notice if provider is known from status (before config may load)
                    if (data.result.provider && !_userProvider) {
                        setDashboardProvider(data.result.provider);
                    }
                    applyProviderNoticeToQCForm(data.result.provider || _userProvider);
                    updateQuickControlUI(data.result);
                    
                    // Check automation status for warning
                    checkQuickControlAutomationWarning();
                }
                
                if (showFeedback) {
                    const messageEl = document.getElementById('quickControlMessage');
                    if (messageEl) {
                        messageEl.style.display = 'none';
                    }
                }
            } catch (error) {
                if (isNotAuthenticatedError(error)) {
                    if (showFeedback) {
                        const messageEl = document.getElementById('quickControlMessage');
                        if (messageEl) messageEl.style.display = 'none';
                    }
                    return;
                }

                console.warn('[QuickControl] Failed to fetch status:', error);
                
                if (showFeedback) {
                    const messageEl = document.getElementById('quickControlMessage');
                    if (messageEl) {
                        messageEl.style.background = 'var(--color-danger)';
                        messageEl.textContent = '❌ Refresh failed';
                        setTimeout(() => { messageEl.style.display = 'none'; }, 3000);
                    }
                }
            }
        }
        
        async function checkQuickControlAutomationWarning() {
            const warningDiv = document.getElementById('quickControlAutomationWarning');
            if (!warningDiv) return;

            if (isPreviewMode()) {
                warningDiv.style.display = 'block';
                return;
            }
            
            try {
                const resp = await authenticatedFetch('/api/automation/status');
                const data = await resp.json();
                
                if (data.errno === 0 && data.result?.enabled === true) {
                    warningDiv.style.display = 'block';
                } else {
                    warningDiv.style.display = 'none';
                }
            } catch (error) {
                if (!isNotAuthenticatedError(error)) {
                    console.warn('[QuickControl] Failed to check automation status:', error);
                }
                warningDiv.style.display = 'none';
            }
        }
        
        function updateQuickControlUI(status) {
            const statusDiv = document.getElementById('quickControlStatus');
            const formDiv = document.getElementById('quickControlForm');
            const startBtn = document.getElementById('btnStartQuickControl');
            
            if (!status || !status.active) {
                // No active quick control - check if just expired (server auto-cleaned)
                if (status && status.justExpired && status.completedControl) {
                    const cc = status.completedControl;
                    const typeIcon = cc.type === 'charge' ? '🔋' : '⚡';
                    const typeText = cc.type === 'charge' ? 'Charging' : 'Discharging';
                    const powerKW = (cc.power / 1000).toFixed(1);
                    
                    statusDiv.style.display = 'block';
                    formDiv.style.display = 'none';
                    statusDiv.style.background = 'rgba(46,160,67,0.15)';
                    statusDiv.style.borderColor = 'rgba(46,160,67,0.4)';
                    statusDiv.style.color = 'var(--color-success)';
                    statusDiv.innerHTML = `
                        <div style="font-weight:600;margin-bottom:8px">✅ Quick Control Completed</div>
                        <div style="font-size:12px;">
                            ${typeIcon} ${typeText} at ${powerKW} kW for ${cc.durationMinutes} minutes has finished. Segments cleared automatically.
                        </div>
                    `;
                    
                    // Auto-dismiss after 5 seconds and show the form again
                    setTimeout(() => {
                        statusDiv.style.display = 'none';
                        formDiv.style.display = 'block';
                    }, 5000);
                } else {
                    statusDiv.style.display = 'none';
                    formDiv.style.display = 'block';
                }
                
                // Clear any countdown
                if (quickControlState.countdownInterval) {
                    clearInterval(quickControlState.countdownInterval);
                    quickControlState.countdownInterval = null;
                }
                return;
            }
            
            // Active quick control
            statusDiv.style.display = 'block';
            formDiv.style.display = 'none';
            
            const typeIcon = overviewIconChipHtml(status.type === 'charge' ? 'battery' : 'bolt', 'app-overview-icon--sm');
            const typeText = status.type === 'charge' ? 'Charging' : 'Discharging';
            const powerKW = (status.power / 1000).toFixed(1);
            
            // Calculate remaining time
            const now = Date.now();
            const remainingMs = Math.max(0, status.expiresAt - now);
            const remainingMinutes = Math.ceil(remainingMs / 60000);
            
            if (remainingMinutes <= 0) {
                // Timer expired - trigger a status refresh which will auto-clean on server
                statusDiv.style.background = 'rgba(139,148,158,0.15)';
                statusDiv.style.borderColor = 'rgba(139,148,158,0.4)';
                statusDiv.style.color = 'var(--text-secondary)';
                statusDiv.innerHTML = `
                    <div style="display:flex;align-items:center;gap:12px;justify-content:center;padding:10px;">
                        <div class="spinner"></div>
                        <span>Quick control finished. Clearing segments...</span>
                    </div>
                `;
                // Server-side auto-cleanup will happen when we refresh status
                setTimeout(() => refreshQuickControlStatus(), 2000);
            } else {
                statusDiv.style.background = 'rgba(46,160,67,0.15)';
                statusDiv.style.borderColor = 'rgba(46,160,67,0.4)';
                statusDiv.style.color = 'var(--color-success)';
                const caps = resolveProviderCapabilities(status.provider || _userProvider);
                const isAlphaEss = caps.provider === 'alphaess';
                const isSungrow = caps.provider === 'sungrow';
                const secondsActive = Math.floor((Date.now() - status.startedAt) / 1000);
                const providerHint = isAlphaEss ? `
                    <div style="margin-bottom:12px;padding:8px 10px;background:rgba(56,139,253,0.1);border:1px solid rgba(56,139,253,0.3);border-radius:5px;font-size:11px;color:var(--text-secondary);line-height:1.5;">
                        <strong style="color:var(--accent-blue);">ℹ️ AlphaESS</strong> — 
                        Time window rounded to nearest 15-min slot.
                        Power is advisory; your inverter sets the actual rate.
                        ${secondsActive < 90 ? '<strong style="color:var(--color-orange);">Allow ~30–60s for the inverter to apply this schedule.</strong>' : ''}
                    </div>` : (isSungrow ? `
                    <div style="margin-bottom:12px;padding:8px 10px;background:rgba(56,139,253,0.1);border:1px solid rgba(56,139,253,0.3);border-radius:5px;font-size:11px;color:var(--text-secondary);line-height:1.5;">
                        <strong style="color:var(--accent-blue);">ℹ️ Sungrow</strong> —
                        Quick Control is being enforced through a TOU window.
                        Power is requested rather than exact, and the inverter may choose the final rate.
                        ${secondsActive < 90 ? '<strong style="color:var(--color-orange);">Allow ~30–60s for the inverter to apply this schedule.</strong>' : ''}
                    </div>` : '');
                statusDiv.innerHTML = `
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <div style="font-weight:600;display:flex;align-items:center;gap:8px;">${typeIcon}<span>${typeText} at ${powerKW} kW</span></div>
                        <div id="quickControlCountdown" style="font-family:monospace;font-size:16px;font-weight:700;">${formatCountdown(remainingMs)}</div>
                    </div>
                    <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">
                        Started: ${new Date(status.startedAt).toLocaleTimeString()} • 
                        Ends: ${new Date(status.expiresAt).toLocaleTimeString()}
                    </div>
                    ${providerHint}
                    <div style="display:flex;gap:8px;">
                        <button class="btn" onclick="stopQuickControl()" style="background:var(--color-danger);border-color:var(--color-danger);flex:1;font-size:12px;padding:8px;font-weight:600;">
                            ${overviewIconChipHtml('stop', 'app-overview-icon--sm')}<span>Stop Now</span>
                        </button>
                        <button class="btn" onclick="refreshQuickControlStatus(true)" style="font-size:12px;padding:8px;">
                            🔄 Refresh
                        </button>
                    </div>
                `;
                
                // Start countdown timer
                startCountdownTimer(status.expiresAt);
            }
        }
        
        function formatCountdown(ms) {
            const totalSeconds = Math.floor(ms / 1000);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;
            
            if (hours > 0) {
                return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            } else {
                return `${minutes}:${String(seconds).padStart(2, '0')}`;
            }
        }
        
        function startCountdownTimer(expiresAt) {
            // Clear existing timer
            if (quickControlState.countdownInterval) {
                clearInterval(quickControlState.countdownInterval);
            }
            
            quickControlState.countdownInterval = setInterval(() => {
                const now = Date.now();
                const remainingMs = Math.max(0, expiresAt - now);
                const countdownEl = document.getElementById('quickControlCountdown');
                
                if (countdownEl) {
                    countdownEl.textContent = formatCountdown(remainingMs);
                }
                
                if (remainingMs <= 0) {
                    clearInterval(quickControlState.countdownInterval);
                    quickControlState.countdownInterval = null;
                    // Refresh to show completion
                    setTimeout(() => refreshQuickControlStatus(), 1000);
                }
            }, 1000);
        }
        
        async function startQuickControl() {
            const startBtn = document.getElementById('btnStartQuickControl');
            const durationSlider = document.getElementById('quickControlDuration');
            const customInput = document.getElementById('quickControlDurationCustom');
            
            // Get duration from custom input if visible, otherwise from slider
            let durationMinutes;
            if (customInput.style.display !== 'none' && customInput.value) {
                durationMinutes = parseInt(customInput.value);
                if (isNaN(durationMinutes) || durationMinutes < 2 || durationMinutes > 360) {
                    alert('❌ Please enter a valid duration (2-360 minutes)');
                    return;
                }
            } else {
                durationMinutes = parseInt(durationSlider.value);
            }
            
            // Validate power
            if (quickControlState.power < 0 || quickControlState.power > _inverterCapacityW) {
                alert(`❌ Power must be between 0 and ${(_inverterCapacityW / 1000).toFixed(1)} kW (your inverter capacity)`);
                return;
            }
            
            // Disable button and show loading
            startBtn.disabled = true;
            startBtn.innerHTML = '<span style="opacity:0.6">⏳ Starting...</span>';
            
            const messageEl = document.getElementById('quickControlMessage');
            messageEl.style.display = 'block';
            messageEl.style.background = 'var(--accent-blue)';
            messageEl.textContent = '🔄 Starting quick control...';
            
            try {
                console.log('[QuickControl] Starting:', { type: quickControlState.type, power: quickControlState.power, durationMinutes });
                
                // Add timeout to prevent hanging
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
                
                const resp = await authenticatedFetch('/api/quickcontrol/start', {
                    method: 'POST',
                    body: JSON.stringify({
                        type: quickControlState.type,
                        power: quickControlState.power,
                        durationMinutes: durationMinutes
                    }),
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                console.log('[QuickControl] Response status:', resp.status);
                const data = await resp.json();
                console.log('[QuickControl] Response data:', data);
                
                if (data.errno === 0) {
                    messageEl.style.background = 'var(--color-success-dark)';
                    messageEl.textContent = `✅ Quick ${quickControlState.type} started successfully!`;
                    setTimeout(() => { messageEl.style.display = 'none'; }, 3000);
                    
                    // Reset button first (in case updateQuickControlUI doesn't hide form immediately)
                    startBtn.disabled = false;
                    setQuickControlStartButtonIdle(startBtn);
                    
                    // Update UI to show active status (this will hide the form)
                    updateQuickControlUI(data.state);
                } else {
                    console.error('[QuickControl] API returned error:', data);
                    messageEl.style.background = 'var(--color-danger)';
                    messageEl.textContent = `❌ Failed: ${data.error || data.msg || 'Unknown error'}`;
                    setTimeout(() => { messageEl.style.display = 'none'; }, 5000);
                    startBtn.disabled = false;
                    setQuickControlStartButtonIdle(startBtn);
                }
            } catch (error) {
                console.error('[QuickControl] Start error:', error);
                messageEl.style.background = 'var(--color-danger)';
                
                if (error.name === 'AbortError') {
                    messageEl.textContent = '❌ Request timed out. Please try again.';
                } else {
                    messageEl.textContent = `❌ Error: ${error.message}`;
                }
                
                setTimeout(() => { messageEl.style.display = 'none'; }, 5000);
                startBtn.disabled = false;
                setQuickControlStartButtonIdle(startBtn);
            }
        }
        
        async function stopQuickControl() {
            if (!confirm('Stop quick control now? The scheduler segment will be cleared.')) {
                return;
            }
            
            const messageEl = document.getElementById('quickControlMessage');
            messageEl.style.display = 'block';
            messageEl.style.background = 'var(--accent-blue)';
            messageEl.textContent = '🔄 Stopping quick control...';
            
            try {
                const resp = await authenticatedFetch('/api/quickcontrol/end', {
                    method: 'POST'
                });
                
                const data = await resp.json();
                
                if (data.errno === 0) {
                    messageEl.style.background = 'var(--color-success-dark)';
                    messageEl.textContent = '✅ Quick control stopped successfully';
                    setTimeout(() => { messageEl.style.display = 'none'; }, 3000);
                    await refreshQuickControlStatus();
                } else {
                    messageEl.style.background = 'var(--color-danger)';
                    messageEl.textContent = `❌ Failed: ${data.error || data.msg || 'Unknown error'}`;
                    setTimeout(() => { messageEl.style.display = 'none'; }, 5000);
                }
            } catch (error) {
                console.error('[QuickControl] Stop error:', error);
                messageEl.style.background = 'var(--color-danger)';
                messageEl.textContent = `❌ Error: ${error.message}`;
                setTimeout(() => { messageEl.style.display = 'none'; }, 5000);
            }
        }
        
        async function acknowledgeQuickControlComplete() {
            const statusDiv = document.getElementById('quickControlStatus');
            
            // Show loading state
            statusDiv.innerHTML = `
                <div style="display:flex;align-items:center;gap:12px;justify-content:center;padding:20px;">
                    <div class="spinner"></div>
                    <span style="color:var(--accent-blue);font-weight:500;">Clearing quick control...</span>
                </div>
            `;
            
            // Clear the expired state by calling end endpoint
            try {
                await authenticatedFetch('/api/quickcontrol/end', {
                    method: 'POST'
                });
            } catch (error) {
                console.warn('[QuickControl] Failed to clear completed state:', error);
            }
            // Refresh UI regardless
            await refreshQuickControlStatus();
        }
        
        function editSegment(index) {
            const seg = currentSchedulerGroups[index];
            if (!seg) return;
            
            const form = document.getElementById('form-scheduler-segment');
            form.segmentIndex.value = index;
            form.enable.value = seg.enable;
            form.workMode.value = seg.workMode;
            form.startTime.value = `${String(seg.startHour).padStart(2,'0')}:${String(seg.startMinute).padStart(2,'0')}`;
            form.endTime.value = `${String(seg.endHour).padStart(2,'0')}:${String(seg.endMinute).padStart(2,'0')}`;
            form.minSocOnGrid.value = seg.minSocOnGrid ?? seg.extraParam?.minSocOnGrid ?? 10;
            form.fdSoc.value = seg.fdSoc ?? seg.extraParam?.fdSoc ?? 10;
            form.fdPwr.value = seg.fdPwr ?? seg.extraParam?.fdPwr ?? 0;
            form.maxSoc.value = seg.maxSoc ?? seg.extraParam?.maxSoc ?? 100;
            
            // Scroll to form
            form.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        
        async function deleteSegment(index) {
            const slotLabel = getSchedulerSlotLabel(_providerCapabilities, index + 1);
            if (!confirm(`Clear ${slotLabel.toLowerCase()}? This will disable it and reset times to 00:00.`)) return;
            
            const statusDiv = document.getElementById('schedulerStatus');
            statusDiv.style.display = 'block';
            statusDiv.style.background = 'var(--bg-card)';
            statusDiv.style.color = 'var(--accent-blue)';
            statusDiv.innerHTML = '<div style="display:flex;align-items:center;gap:8px"><div class="spinner"></div><span>Clearing segment...</span></div>';
            
            // First load current segments if not loaded
            if (currentSchedulerGroups.length === 0) {
                try {
                    const resp = await authenticatedFetch('/api/scheduler/v1/get');
                    const data = await resp.json();
                    if (data.errno === 0 && data.result?.groups) {
                        currentSchedulerGroups = data.result.groups;
                    }
                } catch (e) {
                    statusDiv.style.background = 'var(--color-danger)';
                    statusDiv.style.color = '#fff';
                    statusDiv.textContent = '❌ Failed to load current segments';
                    return;
                }
            }
            
            // Reset the segment to disabled with 00:00 times (V1 flat structure)
            currentSchedulerGroups[index] = {
                enable: 0,
                workMode: 'SelfUse',
                startHour: 0,
                startMinute: 0,
                endHour: 0,
                endMinute: 0,
                minSocOnGrid: 10,
                fdSoc: 10,
                fdPwr: 0,
                maxSoc: 100
            };
            
            // Send all segments to API
            const sn = document.getElementById('deviceSn').value || '';
            const body = { groups: currentSchedulerGroups };
            if (sn) body.sn = sn;
            
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
                
                const resp = await authenticatedFetch('/api/scheduler/v1/set', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                const data = await resp.json();
                
                if (data.errno === 0) {
                    statusDiv.style.background = 'var(--color-success-dark)';
                    statusDiv.style.color = '#fff';
                    let msg = `✅ ${slotLabel} cleared successfully`;
                    if (data.flagResult) {
                        msg += data.flagResult.errno === 0 ? ' (flag updated)' : '';
                    }
                    statusDiv.textContent = msg;
                    // Show full response including verify info so user can see device state
                    try { document.getElementById('result').className = 'info'; document.getElementById('result').textContent = JSON.stringify(data, null, 2); } catch(e) {}
                    // Reload segments to reflect changes
                    setTimeout(() => loadSchedulerSegments(), CONFIG.ui.schedulerReloadDelayMs);
                } else {
                    statusDiv.style.background = 'var(--color-danger)';
                    statusDiv.style.color = '#fff';
                    statusDiv.textContent = `❌ Failed to clear segment: ${data.msg || 'Unknown error'}`;
                }
            } catch (error) {
                statusDiv.style.background = 'var(--color-danger)';
                statusDiv.style.color = '#fff';
                if (error.name === 'AbortError') {
                    statusDiv.innerHTML = '<div style="display:flex;align-items:center;gap:8px"><div class="spinner"></div><span>⚠️ Request taking longer than expected, still processing...</span></div>';
                    // Check for success after timeout by reloading
                    setTimeout(() => {
                        loadSchedulerSegments();
                        statusDiv.style.background = 'var(--color-orange)';
                        statusDiv.style.color = 'var(--bg-primary)';
                        statusDiv.textContent = '⚠️ Operation may have succeeded - segments reloaded';
                        setTimeout(() => { statusDiv.style.display = 'none'; }, CONFIG.ui.statusFadeMs);
                    }, CONFIG.ui.clearAllDelayMs);
                    return;
                }
                statusDiv.textContent = `❌ Error: ${error.message}`;
            }
            
            // Hide status after configured delay
            setTimeout(() => { statusDiv.style.display = 'none'; }, CONFIG.ui.statusFadeMs);
        }
        
        async function submitSchedulerSegment(evt) {
            evt.preventDefault();
            const form = evt.target;
            
            const statusDiv = document.getElementById('schedulerStatus');
            statusDiv.style.display = 'block';
            statusDiv.style.background = 'var(--bg-card)';
            statusDiv.style.color = 'var(--accent-blue)';
            statusDiv.innerHTML = '<div style="display:flex;align-items:center;gap:8px"><div class="spinner"></div><span>Saving segment...</span></div>';
            
            // First load current segments if not loaded
            if (currentSchedulerGroups.length === 0) {
                try {
                    const resp = await authenticatedFetch('/api/scheduler/v1/get');
                    const data = await resp.json();
                    if (data.errno === 0 && data.result?.groups) {
                        currentSchedulerGroups = data.result.groups;
                    }
                } catch (e) {
                    statusDiv.style.background = 'var(--color-danger)';
                    statusDiv.style.color = '#fff';
                    statusDiv.textContent = '❌ Failed to load current segments';
                    setTimeout(() => { statusDiv.style.display = 'none'; }, CONFIG.ui.statusFadeMs);
                    return;
                }
            }
            
            const index = parseInt(form.segmentIndex.value);
            const [startHour, startMinute] = form.startTime.value.split(':').map(Number);
            const [endHour, endMinute] = form.endTime.value.split(':').map(Number);
            const slotLabel = getSchedulerSlotLabel(_providerCapabilities, index + 1);

            if (index >= getSchedulerSlotCount()) {
                statusDiv.style.background = 'var(--color-danger)';
                statusDiv.style.color = '#fff';
                statusDiv.textContent = `❌ ${slotLabel} is outside the editable range for ${_providerCapabilities.label}.`;
                setTimeout(() => { statusDiv.style.display = 'none'; }, CONFIG.ui.statusFadeMs);
                return;
            }

            if (!_providerCapabilities.supportsBackupMode && form.workMode.value === 'Backup') {
                statusDiv.style.background = 'var(--color-danger)';
                statusDiv.style.color = '#fff';
                statusDiv.textContent = `❌ Backup mode is not available for ${_providerCapabilities.label}.`;
                setTimeout(() => { statusDiv.style.display = 'none'; }, CONFIG.ui.statusFadeMs);
                return;
            }
            
            // Validate: fdSoc must be >= minSocOnGrid
            const minSocOnGrid = parseInt(form.minSocOnGrid.value) || 10;
            let fdSoc = parseInt(form.fdSoc.value) || 10;
            if (fdSoc < minSocOnGrid) {
                fdSoc = minSocOnGrid;
                form.fdSoc.value = fdSoc;
                statusDiv.style.background = 'var(--color-orange)';
                statusDiv.style.color = 'var(--bg-primary)';
                statusDiv.textContent = `⚠️ Stop SoC must be >= Min SoC (Grid) (${minSocOnGrid}%). Auto-corrected to ${fdSoc}%.`;
                await new Promise(resolve => setTimeout(resolve, 2000));
                statusDiv.style.background = 'var(--bg-card)';
                statusDiv.style.color = 'var(--accent-blue)';
                statusDiv.innerHTML = '<div style="display:flex;align-items:center;gap:8px"><div class="spinner"></div><span>Saving segment...</span></div>';
            }
            
            // Update the segment
            if (!currentSchedulerGroups[index]) {
                currentSchedulerGroups[index] = {};
            }
            
            // V1 uses flat structure (no extraParam nesting)
            currentSchedulerGroups[index] = {
                enable: parseInt(form.enable.value),
                workMode: form.workMode.value,
                startHour,
                startMinute,
                endHour,
                endMinute,
                minSocOnGrid,
                fdSoc,
                fdPwr: parseInt(form.fdPwr.value) || 0,
                maxSoc: parseInt(form.maxSoc.value) || 100
            };
            
            // Send all segments to API (V1 endpoint)
            const sn = document.getElementById('deviceSn').value || '';
            const body = { groups: currentSchedulerGroups };
            if (sn) body.sn = sn;
            
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout.schedulerMs);
                
                const resp = await authenticatedFetch('/api/scheduler/v1/set', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                const data = await resp.json();
                
                if (data.errno === 0) {
                    statusDiv.style.background = 'var(--color-success-dark)';
                    statusDiv.style.color = '#fff';
                    let msg = `✅ ${slotLabel} saved successfully`;
                    // Show flag status
                    if (data.flagResult) {
                        msg += data.flagResult.errno === 0 ? ' (flag set)' : ' (flag warning)';
                    }
                    if (!_providerCapabilities.supportsExactPowerControl && currentSchedulerGroups[index]?.fdPwr > 0) {
                        msg += ' (requested power advisory)';
                    }
                    statusDiv.textContent = msg;
                    // Show full response including verify info so user can see device state
                    try { document.getElementById('result').className = 'info'; document.getElementById('result').textContent = JSON.stringify(data, null, 2); } catch(e) {}
                    // Reload segments to reflect changes (this now reads from device, not Firestore)
                    setTimeout(() => loadSchedulerSegments(), CONFIG.ui.schedulerReloadDelayMs);
                } else {
                    statusDiv.style.background = 'var(--color-danger)';
                    statusDiv.style.color = '#fff';
                    statusDiv.textContent = `❌ Failed to save segment: ${data.msg || 'Unknown error'}`;
                    // Show error response for debugging
                    try { document.getElementById('result').className = 'error'; document.getElementById('result').textContent = JSON.stringify(data, null, 2); } catch(e) {}
                }
            } catch (error) {
                statusDiv.style.background = 'var(--color-danger)';
                statusDiv.style.color = '#fff';
                if (error.name === 'AbortError') {
                    statusDiv.innerHTML = '<div style="display:flex;align-items:center;gap:8px"><div class="spinner"></div><span>⚠️ Request taking longer than expected, still processing...</span></div>';
                    // Check for success after timeout by reloading
                    setTimeout(() => {
                        loadSchedulerSegments();
                        statusDiv.style.background = 'var(--color-orange)';
                        statusDiv.style.color = 'var(--bg-primary)';
                        statusDiv.textContent = '⚠️ Operation may have succeeded - segments reloaded';
                        setTimeout(() => { statusDiv.style.display = 'none'; }, CONFIG.ui.statusFadeMs);
                    }, CONFIG.ui.clearAllDelayMs);
                    return;
                }
                statusDiv.textContent = `❌ Error: ${error.message}`;
            }
            
            // Hide status after configured delay
            setTimeout(() => { statusDiv.style.display = 'none'; }, CONFIG.ui.statusFadeMs);
        }

        // Forms
        async function submitSetForm(evt, endpoint) {
            evt.preventDefault();
            const form = evt.target;
            const body = buildBodyFromForm(form);
            const sn = document.getElementById('deviceSn').value;
            if (sn && !body.sn) body.sn = sn;

            if (body.raw) {
                try { Object.assign(body, JSON.parse(body.raw)); } catch(e) {}
                delete body.raw;
            }
            if (body.readerInfo && typeof body.readerInfo === 'string') {
                try { body.readerInfo = JSON.parse(body.readerInfo); } catch(e) {}
            }

            callAPIPost(endpoint, form.querySelector('.form-title')?.textContent || endpoint, body);
        }

        function buildBodyFromForm(form) {
            const obj = {};
            Array.from(form.elements).filter(el => el.name && !el.disabled).forEach(el => {
                if (el.type === 'submit' || el.type === 'button') return;
                let val = el.type === 'checkbox' ? el.checked : el.value;
                if (val === '') return;
                if (el.type === 'number') { const n = Number(val); if (!isNaN(n)) val = n; }
                
                if (el.name.includes('.')) {
                    const parts = el.name.split('.');
                    let cur = obj;
                    parts.forEach((p, i) => {
                        if (i === parts.length - 1) cur[p] = val;
                        else { cur[p] = cur[p] || {}; cur = cur[p]; }
                    });
                } else {
                    obj[el.name] = val;
                }
            });
            return obj;
        }

        function fillExample(formId) {
            const form = document.getElementById(formId);
            if (!form) return;
            if (formId === 'form-soc') {
                form.querySelector('[name=minSoc]').value = 20;
                form.querySelector('[name=minSocOnGrid]').value = 10;
            } else if (formId === 'form-forceCharge') {
                form.querySelector('[name=enable1]').checked = true;
                form.querySelector('[name="startTime1.hour"]').value = 6;
                form.querySelector('[name="startTime1.minute"]').value = 0;
                form.querySelector('[name="endTime1.hour"]').value = 8;
                form.querySelector('[name="endTime1.minute"]').value = 30;
            } else if (formId === 'form-peakShaving') {
                form.querySelector('[name=importLimit]').value = 5;
                form.querySelector('[name=soc]').value = 10;
            } else if (formId === 'form-time') {
                syncLocalTime(formId);
            }
        }

        function syncLocalTime(formId) {
            const form = document.getElementById(formId);
            if (!form) return;
            const d = new Date();
            form.querySelector('[name=year]').value = d.getFullYear();
            form.querySelector('[name=month]').value = d.getMonth() + 1;
            form.querySelector('[name=day]').value = d.getDate();
            form.querySelector('[name=hour]').value = d.getHours();
            form.querySelector('[name=minute]').value = d.getMinutes();
        }
        
        function clearResult() {
            document.getElementById('result').textContent = 'Click any button to see the API response here...';
            document.getElementById('result').className = '';
            document.getElementById('status-bar').style.display = 'none';
        }
        
        function copyResult() {
            navigator.clipboard.writeText(document.getElementById('result').textContent).then(() => {
                const btn = document.querySelector('.copy-btn');
                btn.textContent = '✓ Copied!';
                setTimeout(() => btn.textContent = '📋 Copy', 2000);
            });
        }
        
        // Resize handle
        const resizeHandle = document.getElementById('resizeHandle');
        const rightPanel = document.getElementById('rightPanel');
        let isResizing = false;
        
        resizeHandle.addEventListener('mousedown', () => {
            isResizing = true;
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newWidth = window.innerWidth - e.clientX;
            if (newWidth >= 300 && newWidth <= 800) {
                rightPanel.style.width = newWidth + 'px';
                updateToggleBtnPosition();
            }
        });
        
        document.addEventListener('mouseup', () => {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            updateToggleBtnPosition();
        });

        window.addEventListener('resize', () => {
            updateToggleBtnPosition();
        });

        // Clean up timers before unload (helps when navigating away during development)
        window.addEventListener('beforeunload', () => {
            try { if (amberRefreshTimer) clearInterval(amberRefreshTimer); } catch(e){}
            try { if (inverterRefreshTimer) clearInterval(inverterRefreshTimer); } catch(e){}
            try { if (weatherRefreshTimer) clearInterval(weatherRefreshTimer); } catch(e){}
            try { if (evRefreshTimer) clearInterval(evRefreshTimer); } catch(e){}
            try { if (lastUpdateTicker) clearInterval(lastUpdateTicker); } catch(e){}
        });

        // EARLY DECLARATION: Make toggleAutomationPanel available to onclick handlers in HTML
        window.toggleAutomationPanel = function(forceState) {
            console.warn('[Early] toggleAutomationPanel called before full initialization');
        };

        // ==================== CONFIGURATION ====================
        // Centralized configuration for all timing and thresholds
        const CONFIG = {
            // Data refresh intervals (should match backend cache TTLs)
            refresh: {
                amberPricesMs: 60 * 1000,      // 60 seconds - Amber prices
                inverterMs: 5 * 60 * 1000,     // 5 minutes - Inverter data
                weatherMs: 30 * 60 * 1000      // 30 minutes - Weather data
            },
            
            // Cache TTL values (updated from backend config)
            cache: {
                amber: 60 * 1000,              // 60 seconds - Amber prices cache TTL
                inverter: 5 * 60 * 1000,       // 5 minutes - Inverter data cache TTL
                weather: 30 * 60 * 1000        // 30 minutes - Weather data cache TTL
            },
            
            // Automation timing
            automation: {
                intervalMs: 60 * 1000,         // How often automation cycles run (must match backend)
                countdownUpdateMs: 1000        // How often to update countdown display
            },
            
            // UI timing
            ui: {
                statusFadeMs: 5000,            // How long to show status messages
                schedulerReloadDelayMs: 800,   // Delay before reloading scheduler after changes
                amberRetryDelayMs: 500,        // Delay before retrying Amber API call
                toggleAnimationDelayMs: 100,   // Delay for toggle button position update
                automationLoadDelayMs: 300,    // Delay before loading automation status
                tickerIntervalMs: 1000,        // Update interval for 'time since' labels
                copyButtonResetMs: 2000,       // Time to show 'copied' state on copy button
                clearAllDelayMs: 2000          // Delay in clear all segments
            },
            
            // API timeouts
            timeout: {
                schedulerMs: 30000,            // Timeout for scheduler API calls
                testAutomationMs: 15000        // Timeout for test automation calls
            },
            
            // Display limits
            display: {
                forecastLimit: 48,             // Max forecast intervals to show
                defaultAmberNext: 12           // Default number of Amber forecast intervals
            },
            
            // User preferences loaded from backend
            preferences: {
                forecastDays: 6                // User's preferred forecast days (loaded from backend)
            }
        };
        
        // Legacy alias for backwards compatibility
        const REFRESH = CONFIG.refresh;

        // ==================== LOCAL MOCK MODE ====================
        // Supports local dashboard testing without real FoxESS/Amber credentials.
        // Enable with:
        //   - URL param: ?mockDashboard=1
        //   - localStorage: dashboardLocalMockMode=1
        const LOCAL_MOCK_STORAGE_KEY = 'dashboardLocalMockMode';
        let autoLocalMockMode = false;

        function isLocalHostEnv() {
            const host = (window.location && window.location.hostname) || '';
            return host === 'localhost' || host === '127.0.0.1' || host === '::1';
        }

        function applyMockPreferenceFromQuery() {
            try {
                const params = new URLSearchParams(window.location.search || '');
                const raw = String(params.get('mockDashboard') || '').toLowerCase();
                if (raw === '1' || raw === 'true' || raw === 'on') {
                    localStorage.setItem(LOCAL_MOCK_STORAGE_KEY, '1');
                } else if (raw === '0' || raw === 'false' || raw === 'off') {
                    localStorage.setItem(LOCAL_MOCK_STORAGE_KEY, '0');
                }
            } catch (e) { /* ignore */ }
        }

        function getStoredLocalMockPreference() {
            try {
                const raw = localStorage.getItem(LOCAL_MOCK_STORAGE_KEY);
                if (raw === '1') return 'on';
                if (raw === '0') return 'off';
                return 'auto';
            } catch (e) {
                return 'auto';
            }
        }

        function isDashboardLocalMockEnabled() {
            if (isPreviewMode()) return true;
            if (!isLocalHostEnv()) return false;
            const pref = getStoredLocalMockPreference();
            if (pref === 'on') return true;
            if (pref === 'off') return false;
            return autoLocalMockMode;
        }

        function updateDataSourceBadges() {
            const mock = isDashboardLocalMockEnabled();
            const preview = isPreviewMode();
            const inverterBadge = document.getElementById('inverterSourceBadge');
            const amberBadge = document.getElementById('amberSourceBadge');

            if (inverterBadge) {
                inverterBadge.textContent = preview ? 'Preview' : (mock ? 'Mock' : 'Live');
                inverterBadge.style.background = mock ? 'color-mix(in srgb, var(--color-warning) 22%, transparent)' : '';
                inverterBadge.style.color = mock ? 'var(--color-warning)' : '';
            }
            if (amberBadge) {
                amberBadge.textContent = preview ? 'Preview' : (mock ? 'Mock' : 'Amber');
                amberBadge.style.background = mock ? 'color-mix(in srgb, var(--color-warning) 22%, transparent)' : '';
                amberBadge.style.color = mock ? 'var(--color-warning)' : '';
            }
        }

        function maybeEnableAutoLocalMockFromConfig(configResult) {
            if (!isLocalHostEnv() || !configResult) {
                autoLocalMockMode = false;
                updateDataSourceBadges();
                return;
            }

            const deviceSn = String(configResult.deviceSn || '').toUpperCase();
            const foxessToken = String(configResult.foxessToken || '').toUpperCase();
            const amberApiKey = String(configResult.amberApiKey || '').toUpperCase();

            autoLocalMockMode =
                deviceSn.startsWith('TEST-') ||
                foxessToken.startsWith('FAKE') ||
                amberApiKey.startsWith('FAKE');

            updateDataSourceBadges();
            if (autoLocalMockMode) {
                console.info('[LocalMock] Auto-enabled using local test credentials.');
            }
        }

        function getPreviewScenarioDescriptor() {
            const scenario = getPreviewScenario();
            if (scenario === 'evening-peak') {
                return {
                    solarBase: 0.35,
                    solarVariance: 0.2,
                    houseLoadBase: 3.8,
                    houseLoadVariance: 0.8,
                    socBase: 62,
                    socVariance: 6,
                    amberBuyOffset: 15,
                    amberFeedOffset: -3.5,
                    renewablesBase: 28,
                    renewablesVariance: 12,
                    weatherCode: 3,
                    temperatureBase: 24,
                    cloudBase: 72,
                    radiationBase: 140,
                    evCharging: false,
                    activeRule: 'High Feed-in Export',
                    currentRuleMode: 'ForceDischarge'
                };
            }
            if (scenario === 'storm-watch') {
                return {
                    solarBase: 0.18,
                    solarVariance: 0.12,
                    houseLoadBase: 2.7,
                    houseLoadVariance: 0.5,
                    socBase: 81,
                    socVariance: 4,
                    amberBuyOffset: 6,
                    amberFeedOffset: -1.8,
                    renewablesBase: 18,
                    renewablesVariance: 8,
                    weatherCode: 95,
                    temperatureBase: 19,
                    cloudBase: 92,
                    radiationBase: 65,
                    evCharging: false,
                    activeRule: 'Rainy Week Battery Saver',
                    currentRuleMode: 'SelfUse'
                };
            }
            if (scenario === 'ev-charge') {
                return {
                    solarBase: 0.1,
                    solarVariance: 0.08,
                    houseLoadBase: 1.9,
                    houseLoadVariance: 0.4,
                    socBase: 54,
                    socVariance: 7,
                    amberBuyOffset: -6,
                    amberFeedOffset: -1.2,
                    renewablesBase: 46,
                    renewablesVariance: 10,
                    weatherCode: 1,
                    temperatureBase: 17,
                    cloudBase: 25,
                    radiationBase: 90,
                    evCharging: true,
                    activeRule: 'Morning Commute Pre-charge',
                    currentRuleMode: 'ForceCharge'
                };
            }
            return {
                solarBase: 4.6,
                solarVariance: 1.4,
                houseLoadBase: 1.8,
                houseLoadVariance: 0.45,
                socBase: 74,
                socVariance: 7,
                amberBuyOffset: -2,
                amberFeedOffset: -5,
                renewablesBase: 76,
                renewablesVariance: 16,
                weatherCode: 0,
                temperatureBase: 27,
                cloudBase: 18,
                radiationBase: 640,
                evCharging: false,
                activeRule: 'Solar Surplus — Charge Everything',
                currentRuleMode: 'SelfUse'
            };
        }

        function getMockWeatherData(place = PREVIEW_WEATHER_LOCATION, days = 6) {
            const descriptor = getPreviewScenarioDescriptor();
            const totalDays = Math.max(1, Math.min(10, Number(days) || 6));
            const now = new Date();
            const hourTimes = [];
            const radiation = [];
            const cloudcover = [];
            const temperature = [];

            for (let index = 0; index < totalDays * 24; index++) {
                const tick = new Date(now.getTime() + (index * 60 * 60 * 1000));
                const hour = tick.getHours();
                const daylightFactor = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
                hourTimes.push(tick.toISOString().slice(0, 16));
                radiation.push(Math.round((descriptor.radiationBase * daylightFactor) + Math.sin(index / 3) * 35));
                cloudcover.push(Math.max(4, Math.min(100, Math.round(descriptor.cloudBase + Math.cos(index / 4) * 9))));
                temperature.push(Number((descriptor.temperatureBase + Math.sin(index / 6) * 3.4).toFixed(1)));
            }

            const daily = {
                time: [],
                weathercode: [],
                temperature_2m_max: [],
                temperature_2m_min: [],
                precipitation_sum: [],
                sunrise: [],
                sunset: []
            };

            for (let dayIndex = 0; dayIndex < totalDays; dayIndex++) {
                const day = new Date(now.getTime() + (dayIndex * 24 * 60 * 60 * 1000));
                const isoDay = day.toISOString().slice(0, 10);
                daily.time.push(isoDay);
                daily.weathercode.push(descriptor.weatherCode);
                daily.temperature_2m_max.push(Number((descriptor.temperatureBase + 5 + Math.sin(dayIndex / 2) * 2).toFixed(1)));
                daily.temperature_2m_min.push(Number((descriptor.temperatureBase - 6 + Math.cos(dayIndex / 2) * 2).toFixed(1)));
                daily.precipitation_sum.push(descriptor.weatherCode === 95 ? Number((12 + dayIndex * 0.6).toFixed(1)) : Number((Math.max(0, 1.2 + Math.sin(dayIndex) * 1.4)).toFixed(1)));
                daily.sunrise.push(`${isoDay}T06:18`);
                daily.sunset.push(`${isoDay}T18:02`);
            }

            return {
                place: {
                    query: PREVIEW_WEATHER_LOCATION,
                    resolvedName: 'Pyrmont',
                    country: 'Australia',
                    latitude: -33.8698,
                    longitude: 151.1949
                },
                source: 'preview-mock',
                current: {
                    time: now.toISOString().slice(0, 16),
                    temperature: Number((descriptor.temperatureBase + Math.sin(now.getHours() / 4) * 2.2).toFixed(1)),
                    weathercode: descriptor.weatherCode,
                    windspeed: Number((13 + Math.cos(now.getHours() / 3) * 4).toFixed(1)),
                    winddirection: 135,
                    shortwave_radiation: Math.max(0, Math.round(descriptor.radiationBase * 0.72)),
                    cloudcover: Math.max(4, Math.min(100, Math.round(descriptor.cloudBase)))
                },
                hourly: {
                    time: hourTimes,
                    shortwave_radiation: radiation,
                    cloudcover,
                    temperature_2m: temperature
                },
                daily
            };
        }

        function getMockAutomationRules() {
            const descriptor = getPreviewScenarioDescriptor();
            const now = Date.now();
            const templateRules = [
                {
                    name: 'High Feed-in Export',
                    priority: 2,
                    cooldownMinutes: 15,
                    conditions: {
                        feedInPrice: { enabled: true, operator: '>=', value: 30, value2: null },
                        buyPrice: { enabled: false },
                        soc: { enabled: true, operator: '>=', value: 40, value2: null },
                        temperature: { enabled: false },
                        solarRadiation: { enabled: false },
                        cloudCover: { enabled: false },
                        forecastPrice: { enabled: false },
                        time: { enabled: false }
                    },
                    action: {
                        workMode: 'ForceDischarge',
                        durationMinutes: 30,
                        fdPwr: 5000,
                        fdSoc: 20,
                        minSocOnGrid: 20,
                        maxSoc: 100
                    }
                },
                {
                    name: 'Cheap Import Charging',
                    priority: 3,
                    cooldownMinutes: 30,
                    conditions: {
                        feedInPrice: { enabled: false },
                        buyPrice: { enabled: true, operator: '<=', value: 5, value2: null },
                        soc: { enabled: true, operator: '<=', value: 70, value2: null },
                        temperature: { enabled: false },
                        solarRadiation: { enabled: false },
                        cloudCover: { enabled: false },
                        forecastPrice: { enabled: false },
                        time: { enabled: false }
                    },
                    action: {
                        workMode: 'ForceCharge',
                        durationMinutes: 60,
                        fdPwr: 0,
                        fdSoc: 100,
                        minSocOnGrid: 20,
                        maxSoc: 100
                    }
                },
                {
                    name: 'Rainy Week Battery Saver',
                    priority: 7,
                    cooldownMinutes: 360,
                    conditions: {
                        feedInPrice: { enabled: false },
                        buyPrice: { enabled: false },
                        soc: { enabled: false },
                        temperature: { enabled: false },
                        solarRadiation: { enabled: true, checkType: 'average', operator: '<=', value: 150, lookAhead: 7, lookAheadUnit: 'days' },
                        cloudCover: { enabled: true, checkType: 'average', operator: '>=', value: 85, lookAhead: 7, lookAheadUnit: 'days' },
                        forecastPrice: { enabled: false },
                        time: { enabled: false }
                    },
                    action: {
                        workMode: 'SelfUse',
                        durationMinutes: 360,
                        fdPwr: 0,
                        fdSoc: 30,
                        minSocOnGrid: 30,
                        maxSoc: 100
                    }
                },
                {
                    name: 'Morning Commute Pre-charge',
                    priority: 4,
                    cooldownMinutes: 360,
                    conditions: {
                        feedInPrice: { enabled: false },
                        buyPrice: { enabled: true, operator: '<=', value: 15, value2: null },
                        soc: { enabled: true, operator: '<=', value: 75, value2: null },
                        temperature: { enabled: false },
                        solarRadiation: { enabled: false },
                        cloudCover: { enabled: false },
                        forecastPrice: { enabled: false },
                        time: { enabled: true, startTime: '00:00', endTime: '06:00', days: [] }
                    },
                    action: {
                        workMode: 'ForceCharge',
                        durationMinutes: 180,
                        fdPwr: 0,
                        fdSoc: 90,
                        minSocOnGrid: 20,
                        maxSoc: 100
                    }
                },
                {
                    name: 'Evening Return Battery Reserve',
                    priority: 3,
                    cooldownMinutes: 60,
                    conditions: {
                        feedInPrice: { enabled: false },
                        buyPrice: { enabled: true, operator: '>=', value: 20, value2: null },
                        soc: { enabled: true, operator: '>=', value: 30, value2: null },
                        temperature: { enabled: false },
                        solarRadiation: { enabled: false },
                        cloudCover: { enabled: false },
                        forecastPrice: { enabled: false },
                        time: { enabled: true, startTime: '18:00', endTime: '23:00', days: [] }
                    },
                    action: {
                        workMode: 'SelfUse',
                        durationMinutes: 300,
                        fdPwr: 0,
                        fdSoc: 40,
                        minSocOnGrid: 40,
                        maxSoc: 100
                    }
                },
                {
                    name: 'Solar Surplus — Charge Everything',
                    priority: 6,
                    cooldownMinutes: 90,
                    conditions: {
                        feedInPrice: { enabled: true, operator: '<=', value: 8, value2: null },
                        buyPrice: { enabled: false },
                        soc: { enabled: true, operator: '>=', value: 70, value2: null },
                        temperature: { enabled: false },
                        solarRadiation: { enabled: true, checkType: 'average', operator: '>=', value: 700, lookAhead: 4, lookAheadUnit: 'hours' },
                        cloudCover: { enabled: false },
                        forecastPrice: { enabled: false },
                        time: { enabled: false }
                    },
                    action: {
                        workMode: 'SelfUse',
                        durationMinutes: 120,
                        fdPwr: 0,
                        fdSoc: 20,
                        minSocOnGrid: 20,
                        maxSoc: 85
                    }
                }
            ];

            return templateRules.reduce((accumulator, template, index) => {
                const isActive = template.name === descriptor.activeRule;
                accumulator[template.name] = {
                    name: template.name,
                    priority: template.priority,
                    enabled: true,
                    cooldownMinutes: template.cooldownMinutes,
                    conditions: JSON.parse(JSON.stringify(template.conditions)),
                    action: JSON.parse(JSON.stringify(template.action)),
                    lastTriggered: isActive ? now - (9 * 60 * 1000) : now - ((index + 2) * 37 * 60 * 1000)
                };
                return accumulator;
            }, {});
        }

        function getMockAutomationStatus() {
            const descriptor = getPreviewScenarioDescriptor();
            const lastCheck = Date.now() - 18000;
            const rules = getMockAutomationRules();

            return {
                enabled: true,
                inBlackout: false,
                telemetryFailsafePaused: false,
                telemetryAgeMs: 45000,
                lastCheck,
                activeRule: descriptor.activeRule,
                activeRuleName: descriptor.activeRule,
                currentRuleMode: descriptor.currentRuleMode,
                activeSegmentEnabled: true,
                lastTriggered: Date.now() - 9 * 60 * 1000,
                userTimezone: 'Australia/Sydney',
                rules
            };
        }

        function getMockQuickControlStatus() {
            return {
                active: false,
                provider: 'foxess'
            };
        }

        function getMockApiMetricsResponse() {
            const today = new Date().toISOString().slice(0, 10);
            return {
                errno: 0,
                result: {
                    [today]: {
                        inverter: 143,
                        amber: 88,
                        weather: 36,
                        teslaFleet: { calls: { total: 41, billable: 33 } }
                    }
                },
                preview: true
            };
        }

        function getMockSchedulerGroups() {
            return Array.from({ length: 6 }, () => ({
                enable: 0,
                workMode: 'SelfUse',
                startHour: 0,
                startMinute: 0,
                endHour: 0,
                endMinute: 0,
                minSocOnGrid: 10,
                fdSoc: 10,
                fdPwr: 0,
                maxSoc: 100
            }));
        }

        function getMockAmberSites() {
            return [{
                id: 'mock-site-local-1',
                nmi: 'MOCK-NMI-0001',
                network: 'Local Grid A'
            }, {
                id: 'mock-site-local-2',
                nmi: 'MOCK-NMI-0002',
                network: 'Local Grid B'
            }];
        }

        function getMockAmberPrices(next = 12, siteId = 'mock-site-local-1') {
            const descriptor = getPreviewScenarioDescriptor();
            const count = Math.max(12, Math.min(500, Number(next) || 12));
            const now = new Date();
            const base = new Date(now);
            base.setSeconds(0, 0);
            base.setMinutes(base.getMinutes() < 30 ? 0 : 30);
            const siteOffset = (String(siteId) === 'mock-site-local-2' ? 3.5 : 0) + descriptor.amberBuyOffset;

            function renewDescriptor(renewables) {
                if (renewables >= 70) return 'best';
                if (renewables >= 55) return 'great';
                if (renewables >= 40) return 'ok';
                if (renewables >= 25) return 'notGreat';
                return 'worst';
            }

            const rows = [];
            for (let i = 0; i < count; i++) {
                const start = new Date(base.getTime() + (i * 30 * 60 * 1000));
                const phase = i / 3;
                const buy = Number(Math.max(6, 18 + siteOffset + Math.sin(phase) * 7 + (i % 8 === 0 ? 4 : 0)).toFixed(2));
                // Amber feed-in values are negative when you are paid.
                const feed = Number((-Math.max(2, (9 - (siteOffset * 0.45)) + descriptor.amberFeedOffset + Math.cos(phase) * 4)).toFixed(2));
                const renewables = Math.max(10, Math.min(95, Math.round(descriptor.renewablesBase + Math.sin(i / 4) * descriptor.renewablesVariance)));
                const type = i === 0 ? 'CurrentInterval' : 'ForecastInterval';
                const spikeStatus = buy >= 28 ? 'high' : 'none';

                const common = {
                    startTime: start.toISOString(),
                    nemTime: start.toISOString(),
                    type,
                    date: start.toISOString().slice(0, 10)
                };

                rows.push({
                    ...common,
                    channelType: 'general',
                    perKwh: buy,
                    spotPerKwh: buy,
                    renewables,
                    descriptor: renewDescriptor(renewables),
                    spikeStatus,
                    advancedPrice: type === 'ForecastInterval'
                        ? {
                            low: Number((buy - 2.5).toFixed(2)),
                            predicted: buy,
                            high: Number((buy + 2.5).toFixed(2))
                        }
                        : undefined
                });

                rows.push({
                    ...common,
                    channelType: 'feedIn',
                    perKwh: feed,
                    spotPerKwh: feed,
                    renewables,
                    descriptor: renewDescriptor(renewables),
                    spikeStatus: 'none'
                });
            }

            return rows;
        }

        function getMockInverterRealtimeData() {
            const descriptor = getPreviewScenarioDescriptor();
            const now = new Date();
            const t = (now.getMinutes() + (now.getSeconds() / 60)) / 60;

            const solar = Math.max(0.05, descriptor.solarBase + Math.sin(t * Math.PI * 2) * descriptor.solarVariance);
            const houseLoad = Math.max(0.4, descriptor.houseLoadBase + Math.cos(t * Math.PI * 2) * descriptor.houseLoadVariance);
            const batteryDischarge = Math.max(0, houseLoad - solar + 0.35);
            const batteryCharge = Math.max(0, solar - houseLoad - 0.45);
            const feedIn = Math.max(0, solar - houseLoad - batteryCharge);
            const gridImport = Math.max(0, houseLoad - solar - batteryDischarge + batteryCharge);
            const soc = Math.max(18, Math.min(96, Math.round(descriptor.socBase + Math.sin((t + 0.15) * Math.PI * 2) * descriptor.socVariance)));
            const pvRatios = [0.31, 0.27, 0.23, 0.19];
            const pvPowers = pvRatios.map((ratio, index) => {
                if (index === pvRatios.length - 1) {
                    const priorTotal = pvRatios.slice(0, index).reduce((sum, priorRatio) => sum + (solar * priorRatio), 0);
                    return Math.max(0.01, solar - priorTotal);
                }
                return Math.max(0.01, solar * ratio);
            });
            const pvVolts = [382, 366, 351, 337].map((base, index) => Number((base + Math.sin((t + (index * 0.11)) * Math.PI * 2) * 8).toFixed(1)));
            const pvCurrents = pvPowers.map((power, index) => Number(((power * 1000) / Math.max(1, pvVolts[index])).toFixed(1)));

            const datas = [
                { variable: 'pvPower', value: Number(solar.toFixed(2)), unit: 'kW' },
                { variable: 'loadsPower', value: Number(houseLoad.toFixed(2)), unit: 'kW' },
                { variable: 'feedinPower', value: Number(feedIn.toFixed(2)), unit: 'kW' },
                { variable: 'gridConsumptionPower', value: Number(gridImport.toFixed(2)), unit: 'kW' },
                { variable: 'batChargePower', value: Number(batteryCharge.toFixed(2)), unit: 'kW' },
                { variable: 'batDischargePower', value: Number(batteryDischarge.toFixed(2)), unit: 'kW' },
                { variable: 'SoC', value: soc, unit: '%' },
                { variable: 'batTemperature', value: Number((28 + Math.sin(t * Math.PI * 2) * 1.8).toFixed(1)), unit: '°C' },
                { variable: 'ambientTemperation', value: Number((24 + Math.cos(t * Math.PI * 2) * 2.2).toFixed(1)), unit: '°C' },
                { variable: 'invTemperation', value: Number((36 + Math.sin((t + 0.3) * Math.PI * 2) * 2.6).toFixed(1)), unit: '°C' }
            ];

            pvPowers.forEach((power, index) => {
                const pvIndex = index + 1;
                datas.push({ variable: `pv${pvIndex}power`, value: Number(power.toFixed(2)), unit: 'kW' });
                datas.push({ variable: `pv${pvIndex}volt`, value: pvVolts[index], unit: 'V' });
                datas.push({ variable: `pv${pvIndex}current`, value: pvCurrents[index], unit: 'A' });
            });

            return {
                errno: 0,
                result: [{
                    time: now.toISOString(),
                    datas
                }],
                mock: true
            };
        }

        function getMockEVVehicles() {
            return [
                { vehicleId: 'MOCK-1', displayName: 'Tesla Model 3 Long Range', hasCredentials: true },
                { vehicleId: 'MOCK-2', displayName: 'Tesla Model Y Performance', hasCredentials: true }
            ];
        }

        function getMockEVStatus(vehicleId) {
            const descriptor = getPreviewScenarioDescriptor();
            const now = new Date();
            const t = (now.getMinutes() + now.getSeconds() / 60) / 60;
            const isPrimaryVehicle = String(vehicleId) === 'MOCK-1';
            const socBase = isPrimaryVehicle ? (descriptor.evCharging ? 34 : 42) : 81;
            const socVariance = isPrimaryVehicle ? 5 : 3;
            const soc = Math.max(12, Math.min(98, Math.round(socBase + Math.sin((t + (isPrimaryVehicle ? 0.08 : 0.21)) * Math.PI * 2) * socVariance)));
            const chargingState = isPrimaryVehicle ? 'Charging' : 'Stopped';
            const rangeKm = Math.round((isPrimaryVehicle ? 172 : 438) + Math.sin((t + (isPrimaryVehicle ? 0.05 : 0.18)) * Math.PI * 2) * (isPrimaryVehicle ? 18 : 12));
            const ratedRangeKm = rangeKm + (isPrimaryVehicle ? 19 : 11);
            return {
                asOfIso: now.toISOString(),
                socPct: soc,
                rangeKm,
                ratedRangeKm,
                chargingState,
                isPluggedIn: true,
                isHome: true,
                timeToFullChargeHours: isPrimaryVehicle ? 2.2 : 0,
                chargeEnergyAddedKwh: isPrimaryVehicle ? 8.4 : 0,
                rangeAddedKm: isPrimaryVehicle ? 52 : 0,
                chargingPowerKw: isPrimaryVehicle ? 7.2 : 0,
                chargingAmps: isPrimaryVehicle ? 24 : 16,
                odometerKm: isPrimaryVehicle ? 18250 : 27440,
                estimatedRemainingKm: rangeKm
            };
        }

        function getMockEVCommandReadiness(vehicleId) {
            const isPrimaryVehicle = String(vehicleId) === 'MOCK-1';
            return {
                state: isPrimaryVehicle ? 'ready_signed' : 'ready_direct',
                transport: isPrimaryVehicle ? 'signed' : 'direct',
                source: 'mock',
                vehicleCommandProtocolRequired: isPrimaryVehicle
            };
        }

        // Expose simple controls for local dev:
        //   window.setDashboardMockMode(true|false)
        //   window.isDashboardMockMode()
        window.setDashboardMockMode = function setDashboardMockMode(enabled) {
            try {
                if (enabled === null || typeof enabled === 'undefined') {
                    localStorage.removeItem(LOCAL_MOCK_STORAGE_KEY);
                } else {
                    localStorage.setItem(LOCAL_MOCK_STORAGE_KEY, enabled ? '1' : '0');
                }
            } catch (e) { /* ignore */ }
            window.location.reload();
        };
        window.isDashboardMockMode = function isDashboardMockMode() {
            return isDashboardLocalMockEnabled();
        };

        applyMockPreferenceFromQuery();
        updateDataSourceBadges();

        const DASHBOARD_CARD_VISIBILITY_DEFAULTS = {
            inverter: true,
            prices: true,
            weather: true,
            ev: true,
            quickControls: true,
            scheduler: true
        };
        let dashboardCardVisibilityState = { ...DASHBOARD_CARD_VISIBILITY_DEFAULTS };

        function getDashboardVisibilityUserId() {
            try {
                if (window.AppShell && typeof window.AppShell.getUser === 'function') {
                    return window.AppShell.getUser()?.uid || null;
                }
            } catch (e) {
                return null;
            }
            return null;
        }

        function getDashboardCardVisibilityStorageKey(uid) {
            const resolvedUid = uid || getDashboardVisibilityUserId();
            return `dashboardCardVisibility:${resolvedUid || 'guest'}`;
        }

        function ensureDashboardCardVisibilityDefaultsForUser(uid) {
            if (!uid) return;
            try {
                const storageKey = getDashboardCardVisibilityStorageKey(uid);
                const existing = localStorage.getItem(storageKey);
                if (!existing) {
                    localStorage.setItem(storageKey, JSON.stringify(DASHBOARD_CARD_VISIBILITY_DEFAULTS));
                }
            } catch (e) {
                // ignore storage failures
            }
        }

        function loadDashboardCardVisibilityPreferences() {
            dashboardCardVisibilityState = { ...DASHBOARD_CARD_VISIBILITY_DEFAULTS };
            try {
                const uid = getDashboardVisibilityUserId();
                if (uid) ensureDashboardCardVisibilityDefaultsForUser(uid);
                const storageKey = getDashboardCardVisibilityStorageKey(uid);
                let raw = localStorage.getItem(storageKey);
                if (!raw) return;
                const parsed = JSON.parse(raw);
                if (!parsed || typeof parsed !== 'object') return;
                Object.keys(DASHBOARD_CARD_VISIBILITY_DEFAULTS).forEach((key) => {
                    if (typeof parsed[key] === 'boolean') {
                        dashboardCardVisibilityState[key] = parsed[key];
                    }
                });
            } catch (e) {
                console.warn('[Dashboard] Failed to load card visibility preferences', e);
            }
        }

        function saveDashboardCardVisibilityPreferences() {
            try {
                const payload = JSON.stringify(dashboardCardVisibilityState);
                const uid = getDashboardVisibilityUserId();
                const storageKey = getDashboardCardVisibilityStorageKey(uid);
                localStorage.setItem(
                    storageKey,
                    payload
                );
                if (!uid) {
                    localStorage.setItem('dashboardCardVisibility:guest', payload);
                }
            } catch (e) {
                console.warn('[Dashboard] Failed to save card visibility preferences', e);
            }
        }

        function syncDashboardCardVisibilityToggles() {
            const toggles = document.querySelectorAll('[data-dashboard-toggle]');
            toggles.forEach((toggle) => {
                const key = toggle.getAttribute('data-dashboard-toggle');
                if (!key || !(key in DASHBOARD_CARD_VISIBILITY_DEFAULTS)) return;
                toggle.checked = dashboardCardVisibilityState[key] !== false;
            });
        }

        function applyDashboardCardVisibility() {
            const cards = document.querySelectorAll('[data-dashboard-card]');
            cards.forEach((card) => {
                const key = card.getAttribute('data-dashboard-card');
                if (!key || !(key in DASHBOARD_CARD_VISIBILITY_DEFAULTS)) return;
                const isVisible = dashboardCardVisibilityState[key] !== false;
                card.classList.toggle('is-hidden-preference', !isVisible);
            });

            ['priorityRow', 'operationsRow'].forEach((rowId) => {
                const row = document.getElementById(rowId);
                if (!row) return;
                const hasVisibleCards = !!row.querySelector('[data-dashboard-card]:not(.is-hidden-preference)');
                row.classList.toggle('is-hidden-preference', !hasVisibleCards);
            });

            syncDashboardCardVisibilityToggles();
        }

        function initDashboardCardVisibilityPreferences() {
            loadDashboardCardVisibilityPreferences();
            applyDashboardCardVisibility();
        }

        function initDashboardVisibilityCollapse() {
            const card = document.querySelector('.dashboard-visibility-card');
            const button = document.getElementById('dashboardVisibilityToggleBtn');
            if (!card || !button) return;

            const mobileQuery = window.matchMedia('(max-width: 900px)');

            const syncState = () => {
                if (mobileQuery.matches) {
                    const expanded = card.classList.contains('mobile-expanded');
                    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
                    button.textContent = expanded ? 'Hide' : 'Show';
                } else {
                    card.classList.remove('mobile-expanded');
                    button.setAttribute('aria-expanded', 'true');
                    button.textContent = 'Hide';
                }
            };

            card.classList.remove('mobile-expanded');
            syncState();

            button.addEventListener('click', () => {
                if (!mobileQuery.matches) return;
                card.classList.toggle('mobile-expanded');
                syncState();
            });

            if (typeof mobileQuery.addEventListener === 'function') {
                mobileQuery.addEventListener('change', syncState);
            } else if (typeof mobileQuery.addListener === 'function') {
                mobileQuery.addListener(syncState);
            }
        }

        function refreshDashboardCardVisibilityPreferencesForCurrentUser() {
            const uid = getDashboardVisibilityUserId();
            if (uid) ensureDashboardCardVisibilityDefaultsForUser(uid);
            initDashboardCardVisibilityPreferences();
        }

        function toggleDashboardCardVisibility(cardKey, toggleEl) {
            if (!(cardKey in DASHBOARD_CARD_VISIBILITY_DEFAULTS)) return;
            dashboardCardVisibilityState[cardKey] = !!(toggleEl && toggleEl.checked);
            saveDashboardCardVisibilityPreferences();
            applyDashboardCardVisibility();
        }

        window.toggleDashboardCardVisibility = toggleDashboardCardVisibility;

        // Timer handles for auto-refresh (kept so we can cancel/replace during dev)
        let amberRefreshTimer = null;
        let inverterRefreshTimer = null;
        let weatherRefreshTimer = null;
        let evRefreshTimer = null;

        // Auto-refresh control: pause when tab hidden or after idle timeout
        const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes of no interaction
        let lastUserActivity = Date.now();
        let isPageVisible = !document.hidden;
        let idleCheckTimer = null;
        let autoRefreshActive = false;  // Start as false so timers will actually start

        // Map of last update timestamps (ms since epoch)
        const lastUpdated = {
            inverter: null,           // client local ms when we last successfully fetched from API
            inverterCloud: null,      // cloud-recorded timestamp (ms) as returned by API
            amber: null,
            weather: null
        };

        // UI ticker for 'time since' labels
        let lastUpdateTicker = null;

        // Helper to format milliseconds to human-readable string
        function formatMsToReadable(ms) {
            if (!ms || ms <= 0) return '—';
            const sec = Math.floor(ms / 1000);
            if (sec < 60) return sec + 's';
            const min = Math.floor(sec / 60);
            if (min < 60) return min + 'm';
            const hours = Math.floor(min / 60);
            if (hours < 24) return hours + 'h';
            const days = Math.floor(hours / 24);
            return days + 'd';
        }

        /**
         * Stop all auto-refresh timers (when page hidden or idle)
         */
        function stopAutoRefreshTimers() {
            if (!autoRefreshActive) return; // Already stopped
            
            if (amberRefreshTimer) {
                clearInterval(amberRefreshTimer);
                amberRefreshTimer = null;
            }
            if (inverterRefreshTimer) {
                clearInterval(inverterRefreshTimer);
                inverterRefreshTimer = null;
            }
            if (weatherRefreshTimer) {
                clearInterval(weatherRefreshTimer);
                weatherRefreshTimer = null;
            }
            if (evRefreshTimer) {
                clearInterval(evRefreshTimer);
                evRefreshTimer = null;
            }
            if (window.metricsRefreshTimer) {
                clearInterval(window.metricsRefreshTimer);
                window.metricsRefreshTimer = null;
            }
            if (window.automationStatusRefreshInterval) {
                clearInterval(window.automationStatusRefreshInterval);
                window.automationStatusRefreshInterval = null;
            }
            
            autoRefreshActive = false;
        }

        /**
         * Start all auto-refresh timers (when page visible and active)
         */
        function startAutoRefreshTimers() {
            if (autoRefreshActive) {
                return; // Already running
            }
            
            // Amber prices: every 60s (with cache bypass)
            if (!amberRefreshTimer) {
                amberRefreshTimer = setInterval(() => {
                    const siteId = document.getElementById('amberSiteId')?.value;
                    if (siteId) {
                        getAmberCurrent(true);
                    }
                }, REFRESH.amberPricesMs);
            }

            // Inverter real-time data: auto-refresh via cached path.
            // Manual refresh remains the only cache-bypassing action.
            if (!inverterRefreshTimer) {
                inverterRefreshTimer = setInterval(() => {
                    callAPI('/api/inverter/real-time', 'Real-time Data');
                }, REFRESH.inverterMs);
            }

            // Weather: every 30 minutes (with cache bypass)
            if (!weatherRefreshTimer) {
                weatherRefreshTimer = setInterval(() => {
                    getWeather(true);
                }, REFRESH.weatherMs);
            }

            // EV: refresh selected vehicle status every 90s (cached path only).
            // Live fetches are user-initiated to avoid unnecessary paid API calls.
            if (!evRefreshTimer) {
                evRefreshTimer = setInterval(() => {
                    const selectedId = String(evDashboardState.selectedVehicleId || '');
                    if (!selectedId) return;
                    fetchEVVehicleStatus(selectedId, { live: false, silent: true });
                }, 90000);
            }

            // API call metrics: every 30 seconds
            if (!window.metricsRefreshTimer) {
                window.metricsRefreshTimer = setInterval(() => {
                    loadApiMetrics(1);
                }, 30000);
            }

            // Automation status: every 30 seconds
            if (!window.automationStatusRefreshInterval) {
                window.automationStatusRefreshInterval = setInterval(() => {
                    try {
                        loadBackendAutomationStatus();
                    } catch (e) {
                        console.warn('[Automation] Failed to refresh status:', e);
                    }
                }, 30000);
            }
            
            autoRefreshActive = true;
        }

        /**
         * Check if user has been idle too long, stop timers if so
         * NOTE: Disabled for dashboards - we want continuous refresh even when passive monitoring
         */
        function checkIdleTimeout() {
            // Idle timeout disabled - dashboard should refresh continuously
            return;
            
            /*
            const idleTime = Date.now() - lastUserActivity;
            if (idleTime > IDLE_TIMEOUT_MS && autoRefreshActive) {
                console.log(`[AutoRefresh] User idle for ${Math.floor(idleTime/1000/60)} minutes, stopping auto-refresh`);
                stopAutoRefreshTimers();
            }
            */
        }

        /**
         * Track user activity to prevent idle timeout
         */
        function recordUserActivity() {
            const wasIdle = !autoRefreshActive;
            lastUserActivity = Date.now();
            
            // If we were idle and page is visible, restart timers
            if (wasIdle && isPageVisible) {
                startAutoRefreshTimers();
            }
        }

        // Set up Page Visibility API to pause/resume on tab switch
        // DISABLED: Visibility changes are being triggered inappropriately, breaking refresh
        // Just use interval timers instead - they're more reliable
        /*

        // Track user activity events
        ['mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(event => {
            document.addEventListener(event, recordUserActivity, { passive: true });
        });

        // Check for idle timeout every minute
        idleCheckTimer = setInterval(checkIdleTimeout, 60000);
        */

        // Helper to format milliseconds to human-readable string
        function formatMsToReadable(ms) {
            if (!ms || ms <= 0) return '—';
            const sec = Math.floor(ms / 1000);
            if (sec < 60) return sec + 's';
            const min = Math.floor(sec / 60);
            if (min < 60) return min + ' min';
            const hours = Math.floor(min / 60);
            return hours + 'h ' + (min % 60) + 'm';
        }

        // Update FAQ display values from CONFIG
        function updateFaqValues() {
            try {
                // Automation interval
                const faqInterval = document.getElementById('faqAutomationInterval');
                if (faqInterval) faqInterval.textContent = formatMsToReadable(CONFIG.automation.intervalMs);
                
                // Cache intervals
                const faqAmber = document.getElementById('faqAmberCache');
                if (faqAmber) faqAmber.textContent = formatMsToReadable(CONFIG.refresh.amberPricesMs);
                
                const faqInverter = document.getElementById('faqInverterCache');
                if (faqInverter) faqInverter.textContent = formatMsToReadable(CONFIG.refresh.inverterMs);
                
                const faqWeather = document.getElementById('faqWeatherCache');
                if (faqWeather) faqWeather.textContent = formatMsToReadable(CONFIG.refresh.weatherMs);
                
                // Cooldown
                const faqCooldown = document.getElementById('faqCooldown');
                if (faqCooldown) faqCooldown.textContent = (CONFIG.defaults?.cooldownMinutes || 5) + ' minutes';
                
                // Cancel interval (same as automation interval)
                const faqCancel = document.getElementById('faqCancelInterval');
                if (faqCancel) faqCancel.textContent = formatMsToReadable(CONFIG.automation.intervalMs);
            } catch (e) {
                console.warn('Failed to update FAQ values:', e);
            }
        }

        function formatSince(ts) {
            if (!ts) return '—';
            const delta = Math.floor((Date.now() - ts) / 1000);
            if (delta <= 2) return 'just now';
            if (delta < 60) return `${delta}s ago`;
            const mins = Math.floor(delta / 60);
            if (mins < 60) return `${mins}m ${delta % 60}s ago`;
            const hours = Math.floor(mins / 60);
            return `${hours}h ${mins % 60}m ago`;
        }

        // Format a date/timestamp to DD/MM/YYYY optionally with time
        function formatDate(ts, withTime = false, withSeconds = false, timeZone = null) {
            if (!ts) return '—';
            
            // Handle date-only strings (YYYY-MM-DD) from weather API
            // These should be treated as LOCAL dates, not UTC
            if (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ts)) {
                const [yyyy, mm, dd] = ts.split('-');
                if (!withTime) return `${dd}/${mm}/${yyyy}`;
                return `${dd}/${mm}/${yyyy} --:--`;
            }
            
            // Handle Firestore Timestamp objects
            let timestamp = ts;
            if (typeof ts === 'object' && ts !== null) {
                // Firestore Timestamp: {_seconds, _nanoseconds} or {seconds, nanos}
                const sec = ts._seconds ?? ts.seconds;
                if (typeof sec === 'number') {
                    timestamp = sec * 1000;
                } else if (ts.toMillis) {
                    // Firestore client SDK Timestamp
                    timestamp = ts.toMillis();
                } else if (ts.toDate) {
                    timestamp = ts.toDate().getTime();
                }
            }
            
            const d = (timestamp instanceof Date) ? timestamp : new Date(Number(timestamp) || timestamp);
            if (isNaN(d.getTime())) return '—';
            
            let dd, mm, yyyy, hh, min, sec;
            
            // If specific timezone requested, use toLocaleString to get time in that timezone
            if (timeZone && withTime) {
                try {
                    // Use Intl.DateTimeFormat to convert to user's timezone
                    const formatter = new Intl.DateTimeFormat('en-GB', {
                        timeZone,
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                    });
                    const parts = formatter.formatToParts(d);
                    const values = {};
                    parts.forEach(p => values[p.type] = p.value);
                    dd = values.day;
                    mm = values.month;
                    yyyy = values.year;
                    hh = values.hour;
                    min = values.minute;
                    sec = values.second;
                } catch (e) {
                    // Fall back to browser timezone if timezone is invalid
                    return formatDate(ts, withTime, withSeconds, null);
                }
            } else {
                // Use browser's local timezone
                dd = String(d.getDate()).padStart(2, '0');
                mm = String(d.getMonth() + 1).padStart(2, '0');
                yyyy = d.getFullYear();
                hh = String(d.getHours()).padStart(2, '0');
                min = String(d.getMinutes()).padStart(2, '0');
                sec = String(d.getSeconds()).padStart(2, '0');
            }
            
            if (!withTime) return `${dd}/${mm}/${yyyy}`;
            if (withSeconds) {
                return `${dd}/${mm}/${yyyy} ${hh}:${min}:${sec}`;
            }
            return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
        }

        /**
         * Format a forecast day (YYYY-MM-DD) with day of week and date (e.g., "Wednesday - 7/1/2026")
         * @param {string} dateStr - YYYY-MM-DD date string
         * @returns {string} e.g. "Wednesday - 07/12/2025" or "Thursday - 08/12/2025"
         */
        function formatForecastDay(dateStr) {
            if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                return formatDate(dateStr, false);
            }
            
            const [yyyy, mm, dd] = dateStr.split('-').map(Number);
            const forecastDate = new Date(yyyy, mm - 1, dd);
            
            const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const dayOfWeek = daysOfWeek[forecastDate.getDay()];
            
            return `${dayOfWeek} - ${dd}/${mm}/${yyyy}`;
        }
        
        // Format automation cycle result for debug display
        function formatCycleResult(result) {
            if (!result) return '<span style="color:var(--text-muted);font-size:11px">No data</span>';
            
            let html = '';
            
            if (result.skipped) {
                const reason = String(result.reason || 'Unknown');
                let reasonText = reason;
                if (reason === 'stale_telemetry') {
                    const ageMs = Number(result?.telemetry?.ageMs);
                    const ageLabel = Number.isFinite(ageMs) ? formatMsToReadable(ageMs) : 'unknown age';
                    reasonText = `Inverter telemetry stale (${ageLabel} old)`;
                } else if (reason === 'stale_telemetry_missing_timestamp') {
                    reasonText = 'Inverter telemetry timestamp missing';
                } else if (reason === 'frozen_telemetry') {
                    const ageMs = Number(result?.telemetry?.ageMs);
                    const ageLabel = Number.isFinite(ageMs) ? formatMsToReadable(ageMs) : 'unknown age';
                    reasonText = `Inverter telemetry frozen (${ageLabel})`;
                }
                html += `<span style="color:var(--color-orange);font-size:11px">⏭️ Skipped: ${reasonText}</span>`;
                return html;
            }
            
            // Main result section - triggered or not
            if (result.triggered && result.rule) {
                // Support both old format (no status) and new format (with status field)
                const statusIndicator = result.status === 'continuing' ? '⏱️ Continuing'
                                      : result.status === 'new_trigger' ? '✅ New Trigger'
                                      : '?';
                const statusColor = result.status === 'continuing' ? 'var(--accent-blue-hover)'
                                  : result.status === 'new_trigger' ? 'var(--color-success)'
                                  : 'var(--text-secondary)';
                
                html += `<span style="color:${statusColor};font-weight:600;font-size:11px">${statusIndicator} <strong>${result.rule.name || 'Unknown'}</strong>`;
                
                if (result.rule.actionResult) {
                    const ar = result.rule.actionResult;
                    if (ar.errno === 0) {
                        html += ` <span style="color:var(--color-success)">✓ API Continuing</span>`;
                    } else {
                        // API FAILED - show prominent error
                        html += `</span><div style="margin-top:6px;padding:8px;background:rgba(248,81,73,0.15);border:1px solid var(--color-danger);border-radius:4px">`;
                        html += `<span style="color:var(--color-danger);font-weight:600">❌ API FAILED</span>`;
                        html += `<span style="color:var(--color-danger);font-size:10px"> • errno=${ar.errno}</span>`;
                        if (ar.msg) html += `<br><span style="color:var(--color-danger);font-size:10px">${ar.msg}</span>`;
                        html += `</div><span>`;
                    }
                }
                html += `</span>`;
            } else {
                html += `<span style="color:var(--text-secondary);font-size:11px">ℹ️ No rules triggered</span>`;
            }
            
            // Show evaluation summary with condition details - inline
            if (result.evaluationResults && result.evaluationResults.length > 0) {
                html += `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;align-items:flex-start">`;
                
                result.evaluationResults.forEach(er => {
                    const icon = er.result === 'triggered' ? '✅' : er.result === 'continuing' ? '⏱️' : er.result === 'cooldown' ? '⏳' : '❌';
                    const bgColor = er.result === 'triggered' ? 'rgba(126,231,135,0.1)' 
                                  : er.result === 'continuing' ? 'rgba(121,192,255,0.1)'
                                  : er.result === 'cooldown' ? 'rgba(240,136,62,0.1)' 
                                  : 'rgba(248,81,73,0.1)';
                    const borderColor = er.result === 'triggered' ? 'var(--color-success)'
                                      : er.result === 'continuing' ? 'var(--accent-blue-hover)'
                                      : er.result === 'cooldown' ? 'var(--color-orange)'
                                      : 'var(--color-danger)';
                    const textColor = er.result === 'triggered' ? 'var(--color-success)'
                                    : er.result === 'continuing' ? 'var(--accent-blue-hover)'
                                    : er.result === 'cooldown' ? 'var(--color-orange)'
                                    : 'var(--color-danger)';
                    
                    html += `<div style="background:${bgColor};border:1px solid ${borderColor};border-radius:3px;padding:4px 6px;display:inline-flex;align-items:center;gap:3px;font-size:10px">`;
                    html += `<span style="color:${textColor};font-weight:600">${icon} ${er.rule}</span>`;
                    
                    // Show cooldown info for continuing rules
                    if (er.result === 'continuing' && er.cooldownRemaining != null) {
                        html += `<span style="color:var(--accent-blue-hover);font-size:9px"> • ${Math.ceil(er.cooldownRemaining)}s cooldown</span>`;
                    }
                    
                    // Show individual condition details inline if available
                    if (er.details?.results && er.details.results.length > 0) {
                        const condSummary = er.details.results.map(cond => {
                            const condIcon = cond.met ? '✓' : '✗';
                            const condColor = cond.met ? 'var(--color-success)' : 'var(--color-danger)';
                            let short = '';
                            if (cond.condition === 'soc') {
                                short = `SoC: ${cond.actual != null ? cond.actual + '%' : '—'}${cond.reason ? ' (N/A)' : ''}`;
                            } else if (cond.condition === 'feedInPrice') {
                                short = `FI: ${cond.actual?.toFixed(1)}¢`;
                            } else if (cond.condition === 'buyPrice') {
                                short = `Buy: ${cond.actual?.toFixed(1)}¢`;
                            } else if (cond.condition === 'temperature') {
                                short = `${cond.type || 'T'}: ${cond.actual}°C`;
                            } else if (cond.condition === 'time') {
                                short = `Time: ${cond.actual}`;
                            } else if (cond.condition === 'solarRadiation') {
                                short = `☀️ ${cond.actual || '—'}W/m²`;
                            } else if (cond.condition === 'cloudCover') {
                                short = `☁️ ${cond.actual || '—'}%`;
                            } else {
                                short = `${cond.condition}: ${cond.actual}`;
                            }
                            return `<span style="color:${condColor}">${condIcon} ${short}</span>`;
                        }).join(' • ');
                        html += `<span style="color:var(--text-muted);font-size:9px"> | ${condSummary}</span>`;
                    }
                    html += `</div>`;
                });
                html += `</div>`;
            }
            
            // Footer summary inline
            html += `<div style="margin-top:6px;color:var(--text-muted);font-size:10px">📊 ${result.rulesEvaluated || 0}/${result.totalRules || 0} rules</div>`;
            
            return html;
        }

        // Update solar tile curtailment indicator
        function updateSolarTileCurtailmentIndicator() {
            const solarTile = document.getElementById('solar-tile');
            if (!solarTile) return;
            
            const isCurtailed = window.curtailmentState && window.curtailmentState.active;
            const label = solarTile.querySelector('.label');
            
            if (isCurtailed) {
                solarTile.classList.add('curtailed');
                if (label) {
                    label.textContent = 'Solar Production (Curtailed)';
                }
            } else {
                solarTile.classList.remove('curtailed');
                if (label) {
                    label.textContent = 'Solar Production';
                }
            }
        }

        // Parse FoxESS cloud time strings like "2025-11-29 19:01:57 AEDT+1100" into epoch ms.
        function parseFoxESSCloudTime(s) {
            if (!s || typeof s !== 'string') return null;
            // Try to find an ISO-like datetime + offset (e.g., "2025-11-29 19:01:57 AEDT+1100")
            // We'll extract the date/time and the trailing +HHMM or -HHMM offset if present.
            const m = s.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:.*?([+-]\d{4}))?$/);
            if (!m) return null;
            const base = m[1];
            const offset = m[2];
            // Convert to ISO by replacing space between date and time with 'T'
            let iso = base.replace(' ', 'T');
            if (offset) {
                // convert +1100 -> +11:00
                const off = offset.replace(/([+-]\d{2})(\d{2})/, '$1:$2');
                iso = iso + off;
            } else {
                // No explicit offset; treat as local time
            }
            const d = Date.parse(iso);
            if (isNaN(d)) return null;
            return d;
        }

        function updateLastUpdateDisplays() {
            try {
                const inv = document.getElementById('inverterLastUpdate');
                const amb = document.getElementById('amberLastUpdate');
                const we = document.getElementById('weatherLastUpdate');
                if (inv) {
                    // Prefer the reading age; fall back to the dashboard check age.
                    if (lastUpdated.inverterCloud) {
                        const text = `Data age: ${formatSince(lastUpdated.inverterCloud)}`;
                        inv.textContent = text;
                    } else if (lastUpdated.inverter) {
                        const text = `Last checked: ${formatSince(lastUpdated.inverter)}`;
                        inv.textContent = text;
                    } else {
                        inv.textContent = 'Data age: —';
                    }
                }
                if (amb) {
                    const text = lastUpdated.amber ? formatSince(lastUpdated.amber) : '—';
                    amb.textContent = text;
                }
                if (we) {
                    const text = lastUpdated.weather ? formatSince(lastUpdated.weather) : '—';
                    we.textContent = text;
                }

                // Also update the detailed inverter check label.
                try {
                    const fetchAgoEl = document.getElementById('inverterFetchAgo');
                    if (fetchAgoEl) {
                        const text = lastUpdated.inverter ? formatSince(lastUpdated.inverter) : '—';
                        fetchAgoEl.textContent = text;
                    }
                } catch (e) { console.error('Error updating inverter display details:', e); }
            } catch (e) { console.error('Error in updateLastUpdateDisplays:', e); }
        }

        function setLastUpdated(key) {
            if (!['inverter','amber','weather'].includes(key)) return;
            lastUpdated[key] = Date.now();
            updateLastUpdateDisplays();
        }

        // -------------------------
        // Automation panel resizer
        // -------------------------
        // Toggle automation panel - standalone function
        window.toggleAutomationPanel = function(forceState) {
            try {
                const panel = document.querySelector('.automation-panel');
                const resizer = document.getElementById('automationResizer');
                const btn = document.getElementById('automationToggleBtn');
                if (!panel) return;
                
                const isCollapsed = panel.classList.contains('collapsed');
                let targetCollapsed = typeof forceState === 'boolean' ? forceState : !isCollapsed;

                    if (targetCollapsed) {
                    panel.classList.add('collapsed');
                    if (resizer) resizer.style.display = 'none';
                    if (btn) {
                        btn.innerHTML = '<span class="automation-toggle-icon">' +
                        '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
                        '<defs><linearGradient id="robotBody" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#667eea;stop-opacity:1" /><stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" /></linearGradient></defs>' +
                        '<rect x="5" y="8" width="14" height="10" rx="3" fill="url(#robotBody)" stroke="#5567d8" stroke-width="0.5" />' +
                        '<rect x="7" y="4" width="10" height="4" rx="2" fill="#667eea" stroke="#5567d8" stroke-width="0.5" />' +
                        '<circle cx="9.5" cy="11" r="1.3" fill="#fff" />' +
                        '<circle cx="14.5" cy="11" r="1.3" fill="#fff" />' +
                        '<circle cx="9.5" cy="11" r="0.7" fill="#667eea" />' +
                        '<circle cx="14.5" cy="11" r="0.7" fill="#667eea" />' +
                        '<rect x="10" y="15" width="4" height="1.5" rx="0.7" fill="#764ba2" />' +
                        '<circle cx="6" cy="4" r="0.8" fill="#ffd700" />' +
                        '</svg></span><span class="automation-toggle-arrow">◀</span>';
                        // When collapsed, allow the toggle to receive pointer events (so it can be clicked)
                        try { btn.style.pointerEvents = 'auto'; } catch(e) {}
                    }
                } else {
                    panel.classList.remove('collapsed');
                    if (resizer) resizer.style.display = 'flex';
                    if (btn) {
                        btn.innerHTML = '<span class="automation-toggle-icon">' +
                        '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
                        '<defs><linearGradient id="robotBody" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#667eea;stop-opacity:1" /><stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" /></linearGradient></defs>' +
                        '<rect x="5" y="8" width="14" height="10" rx="3" fill="url(#robotBody)" stroke="#5567d8" stroke-width="0.5" />' +
                        '<rect x="7" y="4" width="10" height="4" rx="2" fill="#667eea" stroke="#5567d8" stroke-width="0.5" />' +
                        '<circle cx="9.5" cy="11" r="1.3" fill="#fff" />' +
                        '<circle cx="14.5" cy="11" r="1.3" fill="#fff" />' +
                        '<circle cx="9.5" cy="11" r="0.7" fill="#667eea" />' +
                        '<circle cx="14.5" cy="11" r="0.7" fill="#667eea" />' +
                        '<rect x="10" y="15" width="4" height="1.5" rx="0.7" fill="#764ba2" />' +
                        '<circle cx="6" cy="4" r="0.8" fill="#ffd700" />' +
                        '</svg></span><span class="automation-toggle-arrow">▶</span>';
                        // Keep the toggle clickable even when expanded
                        try { btn.style.pointerEvents = 'auto'; } catch(e) {}
                    }
                }
                try { localStorage.setItem('automationPanelCollapsed', targetCollapsed ? 'true' : 'false'); } catch(e) {}
            } catch (e) { console.warn('toggleAutomationPanel error', e); }
        };

        function initAutomationResizer() {
            const leftPanel = document.querySelector('.left-panel');
            const resizer = document.getElementById('automationResizer');
            const panel = document.querySelector('.automation-panel');
            if (!leftPanel || !resizer || !panel) return;

            // restore saved width + collapsed state
            try {
                const saved = localStorage.getItem('automationPanelWidth');
                if (saved) panel.style.width = saved;
                const collapsedSaved = localStorage.getItem('automationPanelCollapsed');
                // default to collapsed unless explicitly set to 'false'
                if (collapsedSaved !== 'false') {
                    panel.classList.add('collapsed');
                    // hide resizer if collapsed
                    try { resizer.style.display = 'none'; } catch(e) {}
                    try {
                        const tbtn = document.getElementById('automationToggleBtn');
                        if (tbtn) {
                            tbtn.innerHTML = '<span class="automation-toggle-icon">' +
                        '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
                        '<defs><linearGradient id="robotBody" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#667eea;stop-opacity:1" /><stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" /></linearGradient></defs>' +
                        '<rect x="5" y="8" width="14" height="10" rx="3" fill="url(#robotBody)" stroke="#5567d8" stroke-width="0.5" />' +
                        '<rect x="7" y="4" width="10" height="4" rx="2" fill="#667eea" stroke="#5567d8" stroke-width="0.5" />' +
                        '<circle cx="9.5" cy="11" r="1.3" fill="#fff" />' +
                        '<circle cx="14.5" cy="11" r="1.3" fill="#fff" />' +
                        '<circle cx="9.5" cy="11" r="0.7" fill="#667eea" />' +
                        '<circle cx="14.5" cy="11" r="0.7" fill="#667eea" />' +
                        '<rect x="10" y="15" width="4" height="1.5" rx="0.7" fill="#764ba2" />' +
                        '<circle cx="6" cy="4" r="0.8" fill="#ffd700" />' +
                        '</svg></span><span class="automation-toggle-arrow">◀</span>';
                            try { tbtn.style.pointerEvents = 'auto'; } catch(e) {}
                        }
                    } catch(e) {}
                }
            } catch (e) {}

            let dragging = false;
            let pointerId = null;
            const minW = 220;
            const maxW = Math.min(900, leftPanel.clientWidth - 160);
            // Pointer Events (preferred): covers mouse, touch, stylus
            // We'll attach a full-window transparent overlay while dragging so other panels
            // (like the API response right-panel) can't steal pointer events.
            let dragOverlay = null;
            function createOverlay() {
                if (dragOverlay) return dragOverlay;
                dragOverlay = document.createElement('div');
                dragOverlay.id = 'resizerDragOverlay';
                Object.assign(dragOverlay.style, {
                    position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
                    background: 'transparent', zIndex: 9990, cursor: 'col-resize'
                });
                return dragOverlay;
            }

            resizer.addEventListener('pointerdown', (ev) => {
                try { ev.preventDefault(); } catch(e){}
                dragging = true;
                pointerId = ev.pointerId;
                try { resizer.setPointerCapture(pointerId); } catch(e) {}
                // add overlay to ensure we keep receiving pointer events even when cursor
                // moves over other interactive panels
                try {
                    const o = createOverlay();
                    document.body.appendChild(o);
                } catch (e) { /* ignore overlay failures */ }
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
            });

            document.addEventListener('pointermove', (ev) => {
                if (!dragging) return;
                // if pointerId is set, only respond to that pointer
                if (pointerId !== null && ev.pointerId !== pointerId) return;
                // Anchor width calculation to the window's right edge minus the right panel width
                // (mirrors the working right-panel resizer logic). This prevents event
                // interception when the cursor moves over the right panel.
                let newW = Math.round((window.innerWidth - (rightPanel?.offsetWidth || 0)) - ev.clientX);
                const maxForNow = Math.min(maxW, (window.innerWidth - (rightPanel?.offsetWidth || 0)) - (leftPanel.getBoundingClientRect().left + 120));
                if (newW < minW) newW = minW;
                if (newW > maxForNow) newW = maxForNow;
                panel.style.width = newW + 'px';
            });

            document.addEventListener('pointerup', (ev) => {
                if (!dragging) return;
                if (pointerId !== null && ev.pointerId !== pointerId) return;
                dragging = false;
                try { resizer.releasePointerCapture(ev.pointerId); } catch (e) {}
                pointerId = null;
                // remove overlay
                try { const o = document.getElementById('resizerDragOverlay'); if (o && o.parentNode) o.parentNode.removeChild(o); } catch(e) {}
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                try { localStorage.setItem('automationPanelWidth', panel.style.width); } catch(e) {}
            });

            // Fallback for older browsers: also listen for mouse/touch
            resizer.addEventListener('mousedown', (ev) => {
                try { ev.preventDefault(); } catch(e){}
                dragging = true;
                try { const o = createOverlay(); document.body.appendChild(o); } catch(e){}
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
            });

            document.addEventListener('mousemove', (ev) => { if (!dragging) return; let newW = Math.round((window.innerWidth - (rightPanel?.offsetWidth || 0)) - ev.clientX); const maxForNow = Math.min(maxW, (window.innerWidth - (rightPanel?.offsetWidth || 0)) - (leftPanel.getBoundingClientRect().left + 120)); if (newW < minW) newW = minW; if (newW > maxForNow) newW = maxForNow; panel.style.width = newW + 'px'; });
            document.addEventListener('mouseup', () => { if (dragging) { dragging = false; try { const o = document.getElementById('resizerDragOverlay'); if (o && o.parentNode) o.parentNode.removeChild(o); } catch(e){} document.body.style.cursor = ''; document.body.style.userSelect = ''; try { localStorage.setItem('automationPanelWidth', panel.style.width); } catch(e) {} } });

            resizer.addEventListener('touchstart', (ev) => { try { ev.preventDefault(); } catch(e){} dragging = true; try { const o = createOverlay(); document.body.appendChild(o); } catch(e){} document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; }, {passive:false});
            document.addEventListener('touchmove', (ev) => { if (!dragging) return; const touch = ev.touches[0]; if (!touch) return; let newW = Math.round((window.innerWidth - (rightPanel?.offsetWidth || 0)) - touch.clientX); const maxForNow = Math.min(maxW, (window.innerWidth - (rightPanel?.offsetWidth || 0)) - (leftPanel.getBoundingClientRect().left + 120)); if (newW < minW) newW = minW; if (newW > maxForNow) newW = maxForNow; panel.style.width = newW + 'px'; }, {passive:true});
            document.addEventListener('touchend', () => { dragging = false; try { const o = document.getElementById('resizerDragOverlay'); if (o && o.parentNode) o.parentNode.removeChild(o); } catch(e){} document.body.style.cursor = ''; document.body.style.userSelect = ''; try { localStorage.setItem('automationPanelWidth', panel.style.width); } catch(e) {} }, {passive:true});
        }

        // Init - set up UI state on page load (NO authenticated API calls here!)
        document.addEventListener('DOMContentLoaded', () => {
            // Suppress auto-opening of the right-panel while the page initializes
            window.suppressPanelAutoOpen = true;
            try { initSmartTooltips(); } catch (e) { console.warn('initSmartTooltips failed', e); }

            initDashboardCardVisibilityPreferences();
            initDashboardVisibilityCollapse();

            // Ensure right-panel collapsed by default unless user explicitly expanded it before
            try {
                let saved = localStorage.getItem('rightPanelCollapsed');
                // If the user has no saved preference, default to collapsed and persist that choice
                if (saved === null) {
                    try { localStorage.setItem('rightPanelCollapsed', 'true'); } catch(e) {}
                    saved = 'true';
                }
                const panel = document.getElementById('rightPanel');
                const toggleBtn = document.getElementById('toggleBtn');
                // localStorage stores 'true' when collapsed, 'false' when expanded
                // Default to collapsed (panelCollapsed=true) unless explicitly set to 'false'
                if (saved === 'false') {
                    // User previously expanded the panel - keep it expanded
                    if (panel) panel.classList.remove('collapsed');
                    if (toggleBtn) {
                        toggleBtn.textContent = 'R ▶';
                    }
                    panelCollapsed = false;
                } else {
                    // Default or 'true' - keep collapsed
                    if (panel) panel.classList.add('collapsed');
                    if (toggleBtn) {
                        toggleBtn.textContent = 'R ◀';
                    }
                    panelCollapsed = true;
                }
                setTimeout(updateToggleBtnPosition, 100);
            } catch (e) { /* ignore */ }
            // NOTE: All authenticated API calls are deferred to initializePageData()
            // which is called only after firebaseAuth confirms user is authenticated
        });
        
        // =====================================================
        // PAGE RELOAD DETECTION & CACHE BYPASS
        // =====================================================
        // Detect page reload to force cache bypass on initial load
        let isPageReload = false;
        try {
            // Use Navigation Timing API to detect reload (standard way across all browsers)
            // navigation.type: 0 = normal navigation, 1 = reload (F5/Ctrl+R), 2 = back/forward, 255 = unknown
            if (window.performance && window.performance.navigation) {
                isPageReload = (window.performance.navigation.type === 1);
            }
            
            // Fallback for newer browsers using PerformanceNavigationTiming
            if (!isPageReload && window.performance?.getEntriesByType) {
                const navEntries = window.performance.getEntriesByType('navigation');
                if (navEntries.length > 0) {
                    // If this navigation entry exists, check if it's a reload
                    isPageReload = navEntries[0]?.type === 'reload';
                }
            }
        } catch (e) {
            console.warn('[PageInit] Could not detect page reload:', e);
            isPageReload = false;
        }

        // =====================================================
        // AUTHENTICATED PAGE DATA INITIALIZATION
        // =====================================================
        // This function is called ONLY after user is authenticated
        // It loads all data that requires Firebase auth tokens
        async function initializePageData() {
            renderPreviewModeBanner();
            installPreviewFetchGuard();
            updateDataSourceBadges();
            
            // Declare cfg at function scope so it's accessible to all steps
            let cfg = null;
            
            // 0) Load shared config from backend (e.g. default weather location)
            try {
                const cfgResp = await authenticatedFetch('/api/config');
                cfg = await cfgResp.json();
                if (cfg.errno === 0 && cfg.result) {
                    maybeEnableAutoLocalMockFromConfig(cfg.result);
                    // Update USER_TZ from backend-provided config (user-specific or server default)
                    try {
                        USER_TZ = cfg.result.timezone || (cfg.result.config && cfg.result.config.automation && cfg.result.config.automation.timeZone) || USER_TZ;
                    } catch (e) { /* ignore and use default */ }
                    const wInput = document.getElementById('weatherPlace');
                    // Backend now keeps location and preferences.weatherPlace in sync - check location first (primary source)
                    const preferredWeather = isPreviewMode()
                        ? PREVIEW_WEATHER_LOCATION
                        : (cfg.result.location || (cfg.result.preferences && cfg.result.preferences.weatherPlace) || cfg.result.weatherPlace);
                    // On page load, ALWAYS update from server config (it's the source of truth)
                    // Only exception: if user manually typed during this active session
                    if (wInput && preferredWeather && String(preferredWeather).trim() !== '' && preferredWeather !== 'undefined') {
                        const userActivelyTyping = window.sessionStorage.getItem('weatherInputActive') === 'true';
                        
                        if (!userActivelyTyping) {
                            wInput.value = preferredWeather;
                        }
                    }
                    // Keep the visible location display in sync
                    const wDisplay = document.getElementById('weatherPlaceDisplay');
                    if (wDisplay && preferredWeather && preferredWeather !== 'undefined') {
                        wDisplay.textContent = preferredWeather;
                        wDisplay.title = `Fetching weather for: ${preferredWeather}\nThis also sets the timezone for automation rules.\nChange in Settings → Preferences.`;
                    }
                    // Bust weather cache if the configured location changed since the last fetch
                    // (handles navigating back from settings without a full page reload)
                    try {
                        const cachedFull = JSON.parse(localStorage.getItem('cachedWeatherFull') || '{}');
                        const cachedLoc = (cachedFull?.place?.query || cachedFull?.place?.resolvedName || '').trim().toLowerCase();
                        const newLoc = (preferredWeather || '').trim().toLowerCase();
                        if (cachedLoc && newLoc && cachedLoc !== newLoc) {
                            const cs = JSON.parse(localStorage.getItem('cacheState') || '{}');
                            cs.weatherTime = 0;
                            localStorage.setItem('cacheState', JSON.stringify(cs));
                            localStorage.removeItem('cachedWeatherFull');
                            console.log('[Weather] Location changed from', cachedLoc, 'to', newLoc, '— cache cleared');
                        }
                    } catch (e) { /* non-fatal */ }
                    const snInput = document.getElementById('deviceSn');
                    if (snInput && !snInput.value && cfg.result.deviceSn) {
                        snInput.value = cfg.result.deviceSn;
                    }
                    const configuredAmberSite = String(cfg.result.amberSiteId || '').trim();
                    amberConfiguredSiteId = configuredAmberSite;
                    amberLastPersistedSiteId = configuredAmberSite;
                    // Only seed localStorage from backend when it is empty (e.g. new browser / first login).
                    // Do NOT overwrite when localStorage already has a value — the user's last manual
                    // selection lives there and must take priority over the backend's cached value.
                    if (configuredAmberSite && !getStoredAmberSiteIdSafe()) {
                        setStoredAmberSiteIdSafe(configuredAmberSite);
                    }

                    // Apply backend-configured refresh intervals so the UI honors settings
                    try {
                        // Use the new config field from API response which includes user-specific settings
                        
                        if (cfg.result.config) {
                            if (typeof cfg.result.config.cache.amber === 'number') {
                                CONFIG.refresh.amberPricesMs = Number(cfg.result.config.cache.amber);
                                CONFIG.cache.amber = Number(cfg.result.config.cache.amber);
                            }
                            if (typeof cfg.result.config.cache.inverter === 'number') {
                                CONFIG.refresh.inverterMs = Number(cfg.result.config.cache.inverter);
                                CONFIG.cache.inverter = Number(cfg.result.config.cache.inverter);
                            }
                            if (typeof cfg.result.config.cache.weather === 'number') {
                                CONFIG.refresh.weatherMs = Number(cfg.result.config.cache.weather);
                                CONFIG.cache.weather = Number(cfg.result.config.cache.weather);
                            }
                            if (typeof cfg.result.config.automation.intervalMs === 'number') {
                                CONFIG.automation.intervalMs = Number(cfg.result.config.automation.intervalMs);
                            }
                            if (cfg.result.config.defaults) {
                                CONFIG.defaults = cfg.result.config.defaults;
                            }
                        } else {
                            // Fallback to old field names for backward compatibility
                            if (cfg.result.cache && typeof cfg.result.cache.amber === 'number') {
                                CONFIG.refresh.amberPricesMs = Number(cfg.result.cache.amber);
                            }
                            if (cfg.result.cache && typeof cfg.result.cache.inverter === 'number') {
                                CONFIG.refresh.inverterMs = Number(cfg.result.cache.inverter);
                            }
                            if (cfg.result.cache && typeof cfg.result.cache.weather === 'number') {
                                CONFIG.refresh.weatherMs = Number(cfg.result.cache.weather);
                            }
                            if (cfg.result.automation && typeof cfg.result.automation.intervalMs === 'number') {
                                CONFIG.automation.intervalMs = Number(cfg.result.automation.intervalMs);
                            }
                            if (cfg.result.defaults && typeof cfg.result.defaults.cooldownMinutes === 'number') {
                                CONFIG.defaults = cfg.result.defaults;
                            }
                        }
                        // Update FAQ display with actual config values (deferred until page fully loads)
                        setTimeout(() => { if (typeof updateFaqValues === 'function') updateFaqValues(); }, 100);
                    } catch (e) {
                        console.warn('Failed to apply backend refresh config', e);
                    }
                    // Hardware config: read per-user inverter and battery capacity
                    if (typeof cfg.result.inverterCapacityW === 'number' && cfg.result.inverterCapacityW > 0) {
                        _inverterCapacityW = cfg.result.inverterCapacityW;
                    }
                    if (typeof cfg.result.batteryCapacityKWh === 'number' && cfg.result.batteryCapacityKWh > 0) {
                        _batteryCapacityKwh = cfg.result.batteryCapacityKWh;
                    }
                    // Store inverter provider for provider-specific UI hints (e.g. AlphaESS notices)
                    if (cfg.result.deviceProvider) {
                        setDashboardProvider(cfg.result.deviceProvider);
                        applyProviderNoticeToQCForm(_userProvider);
                    }
                    applyInverterCapacityToUI(_inverterCapacityW);
                }
            } catch (e) { console.warn('Failed to load backend config', e); }
            
            // 1) Load Amber sites / prices (bypass cache if page reload)
            try { loadAmberSites(isPageReload); } catch(e) { console.warn('Failed to load Amber sites:', e); }
            
            // 2) Fetch inverter real-time data immediately via the cached path.
            try { callAPI('/api/inverter/real-time', 'Real-time Data'); } catch(e) { console.warn('Failed to load inverter data:', e); }
            
            // 3) Set up weather request (bypass cache if page reload)
            try {
                // Determine default forecast days from backend preferences or top-level config
                try {
                    const daysEl = document.getElementById('weatherDays');
                    let defaultDays = 6;
                    if (cfg.result) {
                        if (cfg.result.preferences && typeof cfg.result.preferences.forecastDays === 'number') {
                            defaultDays = Number(cfg.result.preferences.forecastDays);
                        } else if (typeof cfg.result.forecastDays === 'number') {
                            defaultDays = Number(cfg.result.forecastDays);
                        }
                    }
                    // Clamp to allowed range
                    defaultDays = Math.max(1, Math.min(16, defaultDays || 6));
                    // Store in CONFIG so getWeather() can access it
                    CONFIG.preferences.forecastDays = defaultDays;
                    if (daysEl) daysEl.value = defaultDays;
                    // If preference changed from what was cached, invalidate cache so fresh data is fetched
                    const cacheState = JSON.parse(localStorage.getItem('cacheState') || '{}');
                    if (cacheState.weatherDays && cacheState.weatherDays !== defaultDays) {
                        cacheState.weatherDays = defaultDays;
                        localStorage.setItem('cacheState', JSON.stringify(cacheState));
                    }
                } catch (e) {
                    console.error('[Weather Init] Exception in setup:', e);
                    try { document.getElementById('weatherDays').value = 6; } catch (ee) {}
                    try { CONFIG.preferences.forecastDays = 6; } catch (eee) {}
                }
                updateWeatherRequestedLabel();
                document.getElementById('weatherDays').addEventListener('input', updateWeatherRequestedLabel);
                getWeather(isPageReload);  // Bypass cache on page reload
            } catch(e) { console.warn('Failed to initialize weather:', e); }

            // 4) Load EV overview data
            try {
                loadEVOverviewData(false);
            } catch (e) {
                console.warn('Failed to initialize EV overview:', e);
            }

            // 5) Load automation rules from localStorage
            try { loadAutomationRules(); } catch (e) { console.error('Error loading automation rules:', e); }

            // 6) Load backend automation status
            try { 
                // Initialize curtailment state variable
                window.curtailmentState = { active: false, enabled: false, triggered: false };
                setTimeout(() => { loadBackendAutomationStatus(); }, 300); 
            } catch(e) { console.warn('Failed to load automation status:', e); }

            // 7) Load API call metrics
            try { loadApiMetrics(1); } catch(e) { console.warn('Failed to load API metrics:', e); }
            
            // Now allow user-triggered API calls to open the panel
            window.suppressPanelAutoOpen = false;
            
            // ---- Start auto-refresh timers (managed by visibility/idle detection) ----
            try {
                startAutoRefreshTimers();
            } catch (e) { console.warn('Failed to start auto-refresh timers:', e); }
            
            // Start the 'since' ticker
            try {
                updateLastUpdateDisplays();
                if (!lastUpdateTicker) {
                    lastUpdateTicker = setInterval(updateLastUpdateDisplays, 1000);
                }
            } catch(e) { console.error('Update displays failed:', e); }
            
            // Init resizer for automation panel
            try { initAutomationResizer(); } catch(e) { console.error('initAutomationResizer failed:', e); }

            // Reconcile floating toggle visibility after all init paths complete.
            try { syncAutomationToggleVisibility(); } catch (e) {}

            // Allow automated API calls to open the panel
            setTimeout(() => { try { window.suppressPanelAutoOpen = false; } catch(e) {} }, 1200);
        }

        // =====================================================
        // AUTOMATION RULES SYSTEM
        // =====================================================
        
        let automationRules = [];
        let automationEnabled = false;

        function loadAutomationRules() {
            try {
                const saved = localStorage.getItem('automationRules');
                if (saved) {
                    automationRules = JSON.parse(saved);
                }
                const enabledState = localStorage.getItem('automationEnabled');
                automationEnabled = enabledState === 'true';
            } catch (e) {
                console.error('Failed to load automation rules:', e);
                automationRules = [];
            }
            renderRules();
            updateAutomationToggle();
        }

        // Load backend automation status and sync UI
        async function loadBackendAutomationStatus() {
            if (isPreviewMode()) {
                updateBackendAutomationUI(getMockAutomationStatus());
                return;
            }
            try {
                const container = document.getElementById('backendAutomationStatus');
                if (!container) {
                    console.error('[Automation] Container backendAutomationStatus not found');
                    return;
                }
                
                // Don't show "Loading..." during refresh - it causes flicker
                // Only show it if the container is completely empty
                if (!container.innerHTML.trim() || container.innerHTML.includes('Failed') || container.innerHTML.includes('Error')) {
                    container.innerHTML = '<div style="color:var(--text-secondary);font-size:12px">Loading automation status...</div>';
                }
                
                const resp = await authenticatedFetch('/api/automation/status');
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = await resp.json();
                if (data.errno === 0 && data.result) {
                    updateBackendAutomationUI(data.result);
                } else {
                    container.innerHTML = '<div style="color:var(--color-danger);font-size:12px">⚠️ Failed to load (errno: ' + data.errno + ')</div>';
                }
            } catch (e) {
                console.error('[Automation] Load failed:', e);
                const container = document.getElementById('backendAutomationStatus');
                if (container) {
                    container.innerHTML = `<div style="color:var(--color-danger);font-size:12px">⚠️ Error: ${e.message}</div>`;
                }
            }
        }

        // Update the backend automation section UI
        function updateBackendAutomationUI(status) {
            try {
                const container = document.getElementById('backendAutomationStatus');
                if (!container) {
                    console.error('[Automation] Container not found in updateBackendAutomationUI');
                    return;
                }
                
                const masterEnabled = status.enabled;
                const inBlackout = status.inBlackout || false;
                const blackoutWindow = status.currentBlackoutWindow;
                const telemetryFailsafePaused = masterEnabled && status.telemetryFailsafePaused === true;
                const telemetryPauseReason = String(status.telemetryFailsafePauseReason || '').trim();
                const telemetryAgeMs = Number(status.telemetryAgeMs);
                const telemetryAgeText = Number.isFinite(telemetryAgeMs)
                    ? formatMsToReadable(telemetryAgeMs)
                    : 'unknown age';
                let telemetryPauseText = '';
                if (telemetryPauseReason === 'stale_telemetry') {
                    telemetryPauseText = `Automation paused: inverter telemetry is stale (${telemetryAgeText} old).`;
                } else if (telemetryPauseReason === 'stale_telemetry_missing_timestamp') {
                    telemetryPauseText = 'Automation paused: inverter telemetry timestamp missing or unreadable.';
                } else if (telemetryPauseReason === 'frozen_telemetry') {
                    telemetryPauseText = `Automation paused: inverter telemetry appears frozen (unchanged for ${telemetryAgeText}).`;
                }
                // Normalize lastCheck (handle Firestore Timestamp shapes and seconds/ms ambiguity)
                let lastCheckRaw = status.lastCheck;
                let lastCheck = Date.now();
                if (lastCheckRaw !== null && lastCheckRaw !== undefined) {
                    if (typeof lastCheckRaw === 'number') {
                        lastCheck = lastCheckRaw > 1e12 ? lastCheckRaw : lastCheckRaw * 1000;
                    } else if (typeof lastCheckRaw === 'object') {
                        const sec = lastCheckRaw._seconds ?? lastCheckRaw.seconds;
                        const nsec = lastCheckRaw._nanoseconds ?? lastCheckRaw.nanos ?? 0;
                        if (typeof sec === 'number') {
                            lastCheck = (sec * 1000) + Math.floor((nsec || 0) / 1e6);
                        } else {
                            const parsed = Number(lastCheckRaw);
                            lastCheck = !isNaN(parsed) ? (parsed > 1e12 ? parsed : parsed * 1000) : Date.now();
                        }
                    } else {
                        const parsed = Number(lastCheckRaw);
                        lastCheck = !isNaN(parsed) ? (parsed > 1e12 ? parsed : parsed * 1000) : Date.now();
                    }
                }
                const automationIntervalSec = CONFIG.automation.intervalMs / 1000;
                const nextCheckIn = Math.max(0, automationIntervalSec - Math.floor((Date.now() - lastCheck) / 1000));
                
                // Determine effective state: blackout overrides master enabled
                const effectivelyPaused = !masterEnabled || inBlackout || telemetryFailsafePaused;
                const previewMode = isPreviewMode();
                const statusText = inBlackout
                    ? 'BLACKOUT'
                    : (telemetryFailsafePaused ? 'FAILSAFE' : (masterEnabled ? 'ACTIVE' : 'PAUSED'));
                const statusColor = inBlackout
                    ? 'var(--color-orange)'
                    : (telemetryFailsafePaused ? 'var(--color-danger)' : (masterEnabled ? 'var(--color-success)' : 'var(--color-danger)'));
                const countdownText = previewMode
                    ? 'DEMO'
                    : (inBlackout
                    ? 'BLACKOUT'
                    : (!effectivelyPaused ? (nextCheckIn + 's') : 'PAUSED'));
                const subtitleText = inBlackout 
                    ? `⏸️ Blackout window: ${blackoutWindow?.start || '??'} - ${blackoutWindow?.end || '??'}`
                    : (previewMode
                        ? 'Preview mode shows sample rules and outcomes only. Live automation stays disabled until setup is complete.'
                    : (telemetryFailsafePaused
                        ? telemetryPauseText
                        : (masterEnabled ? `Auto-refreshes every ${automationIntervalSec} seconds` : 'Enable master switch to activate')));
                const gradientColors = inBlackout
                    ? '#f0883e 0%, #da3633 100%'
                    : (telemetryFailsafePaused
                        ? '#da3633 0%, #b62324 100%'
                        : (masterEnabled ? '#1f6feb 0%, #238636 100%' : '#6e7681 0%, #8b949e 100%'));
            
            let html = `
                <!-- Unified Countdown Timer + Master Switch -->
                <div data-tour="automation-master" style="background:linear-gradient(135deg, ${gradientColors});border-radius:12px;padding:14px 16px;margin-bottom:12px;box-shadow:0 6px 20px rgba(0,0,0,0.4)">
                    <div style="display:flex;align-items:center;justify-content:center;gap:16px">
                        <div style="flex:0 0 auto;text-align:center">
                            <div style="font-size:10px;color:rgba(255,255,255,0.9);font-weight:600;letter-spacing:1px;text-transform:uppercase">${inBlackout ? '🚫 BLACKOUT' : '⏱️ NEXT CYCLE'}</div>
                            <div id="automationCountdown" style="font-size:32px;font-weight:800;color:#fff;font-family:'Courier New',monospace;letter-spacing:3px;text-shadow:0 3px 10px rgba(0,0,0,0.4);margin-top:4px">${countdownText}</div>
                        </div>
                        <div style="width:2px;height:50px;background:rgba(255,255,255,0.25);border-radius:1px"></div>
                        <div style="display:flex;flex-direction:column;align-items:center;gap:6px;min-width:90px">
                            <div style="font-size:12px;color:rgba(255,255,255,0.9);font-weight:600;letter-spacing:0.5px">🤖 Master</div>
                            <div class="automation-toggle ${masterEnabled ? 'active' : ''}" onclick="toggleBackendAutomation()" style="width:48px;height:28px;cursor:pointer;transition:all 0.3s ease"></div>
                            <span style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:#fff;text-transform:uppercase;text-shadow:0 1px 3px rgba(0,0,0,0.3)">${statusText}</span>
                        </div>
                    </div>
                    <div style="font-size:10px;color:rgba(255,255,255,0.75);text-align:center;margin-top:8px;font-weight:500">${subtitleText}</div>
                </div>
                ${telemetryFailsafePaused ? `<div style="margin-bottom:12px;padding:10px 12px;border-radius:8px;background:rgba(248,81,73,0.16);border:1px solid rgba(248,81,73,0.55);color:var(--color-danger);font-size:12px;font-weight:600">⚠️ ${telemetryPauseText || 'Automation paused by telemetry fail-safe.'}</div>` : ''}
                <!-- Compact Add Rule button placed under master section for quick access -->
                <div style="display:flex;justify-content:flex-start;gap:8px;margin-bottom:12px">
                    ${_providerCapabilities.supportsSchedulerControl
                        ? '<button class="btn btn-primary btn-sm" onclick="showAddRuleModal()" style="padding:6px 10px;font-size:12px">➕ Add Rule</button>'
                        : '<div style="padding:6px 10px;font-size:12px;border:1px solid var(--border-primary);border-radius:6px;background:var(--bg-overlay);color:var(--text-secondary);">Automation rule editing is unavailable for SigenEnergy until scheduler support is implemented.</div>'}
                </div>
            `;
            
            // Render all automation rules (sorted by priority)
            const allRules = Object.entries(status.rules || {}).sort((a,b) => (a[1].priority || 99) - (b[1].priority || 99));
            html += `<div data-tour="automation-rules">`;
            if (allRules.length > 0) {
                html += `<div style=\"font-size:12px;font-weight:600;color:var(--accent-blue);margin-bottom:8px\">📋 Automation Rules (${allRules.length})</div>`;
                html += `<div style="font-size:10px;color:var(--text-secondary);margin-bottom:8px;padding:6px 8px;background:var(--accent-blue-bg);border-radius:4px;border-left:2px solid var(--accent-blue)">Sorted by priority • Lower number = Higher priority • First match wins</div>`;
                allRules.forEach(([ruleName, rule]) => {
                    const ruleAction = rule.action || {};
                    const conditions = rule.conditions || {};
                    
                    // Build conditions badges
                    let condBadges = '';
                    if (conditions.feedInPrice?.enabled) {
                        const fiOp = conditions.feedInPrice.op || conditions.feedInPrice.operator || '>';
                        const fiStr = fiOp === 'between' ? `${conditions.feedInPrice.value}¢ – ${conditions.feedInPrice.value2}¢` : `${fiOp} ${conditions.feedInPrice.value}¢`;
                        condBadges += `<span style="background:#238636;color:#fff;padding:2px 6px;border-radius:3px;font-size:10px;margin-right:4px">Feed-in ${fiStr}</span>`;
                    }
                    if (conditions.buyPrice?.enabled) {
                        const bpOp = conditions.buyPrice.op || conditions.buyPrice.operator || '<';
                        const bpStr = bpOp === 'between' ? `${conditions.buyPrice.value}¢ – ${conditions.buyPrice.value2}¢` : `${bpOp} ${conditions.buyPrice.value}¢`;
                        condBadges += `<span style="background:#1f6feb;color:#fff;padding:2px 6px;border-radius:3px;font-size:10px;margin-right:4px">Buy ${bpStr}</span>`;
                    }
                    if (conditions.soc?.enabled) {
                        const socOp = conditions.soc.op || conditions.soc.operator || '<';
                        const socStr = socOp === 'between' ? `${conditions.soc.value}% – ${conditions.soc.value2}%` : `${socOp} ${conditions.soc.value}%`;
                        condBadges += `<span style="background:#8957e5;color:#fff;padding:2px 6px;border-radius:3px;font-size:10px;margin-right:4px">SoC ${socStr}</span>`;
                    }
                    const tempCond = conditions.temperature || conditions.temp;
                    if (tempCond?.enabled) {
                        const tempType = tempCond.type || 'battery';
                        let tempLabel = 'Battery Temp';
                        if (tempType === 'ambient' || tempType === 'inverter') tempLabel = 'Ambient Temp';
                        if (tempType === 'forecastMax') tempLabel = `Forecast Max (D+${tempCond.dayOffset || 0})`;
                        if (tempType === 'forecastMin') tempLabel = `Forecast Min (D+${tempCond.dayOffset || 0})`;
                        condBadges += `<span style="background:#f0883e;color:#000;padding:2px 6px;border-radius:3px;font-size:10px;margin-right:4px">${tempLabel} ${tempCond.operator} ${tempCond.value}°C</span>`;
                    }
                    // Solar Radiation condition
                    if (conditions.solarRadiation?.enabled) {
                        const unit = conditions.solarRadiation.lookAheadUnit || 'hours';
                        const unitLabel = unit === 'hours' ? 'h' : 'd';
                        condBadges += `<span style="background:#f9d71c;color:#000;padding:2px 6px;border-radius:3px;font-size:10px;margin-right:4px">☀️ ${conditions.solarRadiation.checkType || 'avg'} ${conditions.solarRadiation.operator} ${conditions.solarRadiation.value}W/m² (${conditions.solarRadiation.lookAhead}${unitLabel})</span>`;
                    }
                    // Cloud Cover condition
                    if (conditions.cloudCover?.enabled) {
                        const unit = conditions.cloudCover.lookAheadUnit || 'hours';
                        const unitLabel = unit === 'hours' ? 'h' : 'd';
                        condBadges += `<span style="background:#79c0ff;color:#000;padding:2px 6px;border-radius:3px;font-size:10px;margin-right:4px">☁️ ${conditions.cloudCover.checkType || 'avg'} ${conditions.cloudCover.operator} ${conditions.cloudCover.value}% (${conditions.cloudCover.lookAhead}${unitLabel})</span>`;
                    }
                    // Legacy weather condition (for backward compatibility)
                    if (conditions.weather?.enabled) {
                        const wType = conditions.weather.type || conditions.weather.condition || 'sunny';
                        condBadges += `<span style="background:#79c0ff;color:#000;padding:2px 6px;border-radius:3px;font-size:10px;margin-right:4px">🌤️ ${wType}</span>`;
                    }
                    if (conditions.forecastPrice?.enabled) {
                        const unit = conditions.forecastPrice.lookAheadUnit || 'minutes';
                        const unitLabel = unit === 'minutes' ? 'm' : unit === 'hours' ? 'h' : 'd';
                        condBadges += `<span style="background:#f778ba;color:#000;padding:2px 6px;border-radius:3px;font-size:10px;margin-right:4px">📈 ${conditions.forecastPrice.type === 'feedIn' ? 'FI' : 'Buy'} ${conditions.forecastPrice.checkType || 'avg'} ${conditions.forecastPrice.operator} ${conditions.forecastPrice.value}¢ (${conditions.forecastPrice.lookAhead || 30}${unitLabel})</span>`;
                    }
                    if (conditions.time?.enabled || conditions.timeWindow?.enabled) {
                        const tw = conditions.time || conditions.timeWindow;
                        const startTime = tw.start || tw.startTime || '00:00';
                        const endTime = tw.end || tw.endTime || '23:59';
                        const dayLabel = formatTimeConditionDays(tw.days);
                        const daySuffix = dayLabel === 'Every day' ? '' : ` [${dayLabel}]`;
                        condBadges += `<span style="background:#6e7681;color:#fff;padding:2px 6px;border-radius:3px;font-size:10px;margin-right:4px">${startTime}-${endTime}${daySuffix}</span>`;
                    }
                    if (!condBadges) condBadges = '<span style="color:var(--text-secondary);font-size:10px">No conditions set</span>';
                    
                    const priorityClass = rule.priority >= 1 && rule.priority <= 10 ? `p${rule.priority}` : 'p-low';
                    const isActive = status.activeRule === ruleName;
                    const segmentStatus = isActive && status.activeSegmentEnabled ? '✓' : (isActive && !status.activeSegmentEnabled ? '⚠️' : '');
                    const segmentStatusTitle = isActive && !status.activeSegmentEnabled ? 'Segment pending or failed to send to inverter' : '';
                    html += `
                    <div style="background:${isActive ? (status.activeSegmentEnabled ? 'rgba(126,231,135,0.1)' : 'rgba(240,136,62,0.1)') : 'var(--bg-card)'};border:1px solid ${isActive ? (status.activeSegmentEnabled ? 'var(--color-success)' : 'var(--color-orange)') : (rule.enabled && masterEnabled ? 'var(--accent-blue)' : 'var(--border-primary)')};border-radius:8px;padding:12px;margin-bottom:8px;opacity:${masterEnabled ? 1 : 0.6};border-left:${isActive ? (status.activeSegmentEnabled ? '3px solid var(--color-success)' : '3px solid var(--color-orange)') : '1px solid ' + (rule.enabled && masterEnabled ? 'var(--accent-blue)' : 'var(--border-primary)')}">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                            <div style="display:flex;align-items:center;gap:8px">
                                <span class="priority-badge ${priorityClass}" title="Priority ${rule.priority || '?'} - Lower number = Higher priority">P${rule.priority || '?'}</span>
                                <span style="font-weight:600;color:${isActive ? (status.activeSegmentEnabled ? 'var(--color-success)' : 'var(--color-orange)') : 'var(--accent-blue)'};font-size:14px">${rule.name || ruleName}</span>
                                ${isActive ? `<span style="background:${status.activeSegmentEnabled ? 'var(--color-success)' : 'var(--color-orange)'};color:#000;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;title='${segmentStatusTitle}'">${status.activeSegmentEnabled ? '✅ ACTIVE' : '⚠️ PENDING'}</span>` : ''}
                            </div>
                            <div style="display:flex;align-items:center;gap:6px">
                                <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
                                    <input type="checkbox" ${rule.enabled ? 'checked' : ''} onchange="updateBackendRule('${ruleName}', 'enabled', this.checked)" style="accent-color:var(--accent-blue);width:14px;height:14px">
                                    <span style="font-size:11px;font-weight:600;color:${rule.enabled ? 'var(--accent-blue)' : 'var(--text-secondary)'}">${rule.enabled ? 'ON' : 'OFF'}</span>
                                </label>
                                <button onclick="editBackendRule('${ruleName}')" style="background:color-mix(in srgb, var(--accent-blue) 15%, transparent);border:1px solid var(--accent-blue);color:var(--accent-blue);padding:3px 6px;border-radius:4px;cursor:pointer;font-size:10px" title="Edit">✏️</button>
                                <button onclick="deleteBackendRule('${ruleName}')" style="background:color-mix(in srgb, var(--color-danger) 15%, transparent);border:1px solid var(--color-danger);color:var(--color-danger);padding:3px 6px;border-radius:4px;cursor:pointer;font-size:10px" title="Delete">🗑️</button>
                            </div>
                        </div>
                        <div style="margin-bottom:8px">${condBadges}</div>
                        <div style="display:flex;gap:8px;font-size:11px;flex-wrap:wrap">
                            <div style="background:var(--bg-secondary);padding:4px 8px;border-radius:4px">
                                <span style="color:var(--text-secondary)">→</span> <span style="color:var(--color-success)">${ruleAction.workMode || 'N/A'}</span>
                            </div>
                            <div style="background:var(--bg-secondary);padding:4px 8px;border-radius:4px">
                                <span style="color:var(--text-secondary)">⏱</span> <span style="color:var(--text-primary)">${ruleAction.durationMinutes || 0}min</span>
                            </div>
                            <div style="background:var(--bg-secondary);padding:4px 8px;border-radius:4px">
                                <span style="color:var(--text-secondary)">⚡</span> <span style="color:var(--text-primary)">${ruleAction.fdPwr || 0}W</span>
                            </div>
                            <div style="background:var(--bg-secondary);padding:4px 8px;border-radius:4px">
                                <span style="color:var(--text-secondary)">� Stop</span> <span style="color:var(--text-primary)">${ruleAction.fdSoc != null ? ruleAction.fdSoc : '—'}%</span>
                            </div>
                            <div style="background:var(--bg-secondary);padding:4px 8px;border-radius:4px">
                                <span style="color:var(--text-secondary)">�🔄</span> <span style="color:var(--text-primary)">${rule.cooldownMinutes || 5}min CD</span>
                            </div>
                        </div>
                        ${rule.lastTriggered ? `<div style="margin-top:8px;font-size:10px;color:var(--color-orange)">⏱️ Last: ${formatDate(rule.lastTriggered, true)}</div>` : ''}
                    </div>
                    `;
                });
            } else {
                // No rules yet - show empty state
                html += `
                    <div style="padding:20px;background:var(--bg-secondary);border-radius:8px;text-align:center;margin-bottom:8px">
                        <div style="font-size:32px;margin-bottom:12px">📭</div>
                        <div style="font-size:14px;color:var(--text-secondary);margin-bottom:8px">No automation rules yet</div>
                        <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">Click the Add Rule button above to create your first rule</div>
                        <a href="/rules-library.html" style="display:inline-flex;align-items:center;gap:6px;background:var(--bg-overlay);border:1px solid var(--border);border-radius:8px;padding:8px 14px;color:var(--accent-blue);font-size:12px;font-weight:600;text-decoration:none">📚 Or browse the Rules Library →</a>
                    </div>
                `;
            }
            html += `</div>`;
            
            // Small placeholder to keep layout/anchors stable (hidden)
            html += `<div class="add-rule-card" style="display:none"></div>`;
            
            // Test Link
            html += `
                <div style="margin-top:16px;text-align:center">
                    <a href="/test.html" target="_blank" style="color:var(--accent-blue);font-size:12px;text-decoration:none">🧪 Open Automation Test UI →</a>
                </div>
            `;
            
            // Last triggered info
            if (status.lastTriggered) {
                html += `
                    <div style="margin-top:12px;padding:8px;background:var(--bg-secondary);border-radius:6px;font-size:11px;color:var(--text-secondary);text-align:center">
                        Last automation: ${formatDate(status.lastTriggered, true)} (${status.activeRuleName || status.activeRule || 'unknown'})
                    </div>
                `;
            }
            
            // Curtailment status indicator (if active)
            if (window.curtailmentState && window.curtailmentState.active) {
                html += `
                    <div style="margin-top:12px;padding:10px;background:linear-gradient(135deg,#f0883e 0%,#da3633 100%);border-radius:6px;border-left:3px solid #ff6b35">
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                            <div style="display:flex;align-items:center;gap:6px;flex:1">
                                <span style="font-size:14px">☀️</span>
                                <div style="flex:1">
                                    <div style="font-weight:600;color:#fff;font-size:11px">Solar Curtailment Active</div>
                                    <div style="font-size:10px;color:rgba(255,255,255,0.85);margin-top:2px">${window.curtailmentState.currentPrice ? (window.curtailmentState.currentPrice.toFixed(2) + '¢ < ' + window.curtailmentState.priceThreshold + '¢') : 'Price below threshold'}</div>
                                </div>
                            </div>
                            <div style="font-size:11px;color:#fff;font-weight:700;background:rgba(0,0,0,0.3);padding:4px 8px;border-radius:3px;white-space:nowrap">Export: 0W</div>
                        </div>
                    </div>
                `;
            }
            
            // Debug Info Box - shows last cycle outcome
            const debugTimestamp = status.lastCheck ? formatDate(status.lastCheck, true, false, status.userTimezone) : 'N/A';
            const tzLabel = status.userTimezone ? ` (${status.userTimezone})` : '';
            html += `
                <div id="automationDebugBox" style="margin-top:12px;padding:8px 10px;background:var(--bg-input);border:1px solid var(--border-primary);border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,0.1)">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
                        <span style="color:var(--accent-blue);font-weight:600;font-size:11px;white-space:nowrap">📊 Last Cycle</span>
                        <div id="debugContent" style="color:var(--text-primary);font-size:11px;flex:1;min-width:250px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                            <div style="flex:1">${window.lastCycleResult ? formatCycleResult(window.lastCycleResult) : '<span style="color:var(--text-muted);font-size:10px">⏳ Waiting...</span>'}</div>
                            <div id="debugTimestamp" style="color:var(--text-muted);font-size:11px;white-space:nowrap;background:var(--bg-primary);padding:2px 6px;border-radius:3px;margin-left:6px" title="User timezone: ${status.userTimezone || 'unknown'}">${debugTimestamp}${tzLabel}</div>
                        </div>
                    </div>
                </div>
            `;
            
            container.innerHTML = html;
            
            // Update solar tile curtailment indicator with current state
            updateSolarTileCurtailmentIndicator();
            
            // Store lastCheck, enabled state, and blackout info for countdown timer
            // Normalize lastCheck: Firestore may return a Timestamp object or seconds-only value.
            (function(){
                const raw = status.lastCheck;
                let lastMs = Date.now();
                if (raw !== null && raw !== undefined) {
                    if (typeof raw === 'number') {
                        // If small number, treat as seconds, otherwise milliseconds
                        lastMs = raw > 1e12 ? raw : raw * 1000;
                    } else if (typeof raw === 'object') {
                        // Firestore Timestamp shape: {_seconds, _nanoseconds} or {seconds, nanos}
                        const sec = raw._seconds ?? raw.seconds;
                        const nsec = raw._nanoseconds ?? raw.nanos ?? 0;
                        if (typeof sec === 'number') {
                            lastMs = (sec * 1000) + Math.floor((nsec || 0) / 1e6);
                        } else {
                            const parsed = Number(raw);
                            lastMs = !isNaN(parsed) ? (parsed > 1e12 ? parsed : parsed * 1000) : Date.now();
                        }
                    } else {
                        const parsed = Number(raw);
                        lastMs = !isNaN(parsed) ? (parsed > 1e12 ? parsed : parsed * 1000) : Date.now();
                    }
                }
                window.automationLastCheck = lastMs;
            })();
            window.automationEnabled = !!status.enabled;
            window.automationInBlackout = !!status.inBlackout;
            window.automationFailsafePaused = !!status.enabled && !!status.telemetryFailsafePaused;
            
            // Start countdown timer if not already running (or restart if state changed)
            const shouldRun = !previewMode && window.automationEnabled && !window.automationInBlackout && !window.automationFailsafePaused;
            const wasRunning = !!window.automationCountdownInterval;
            const stateChanged = (shouldRun !== wasRunning) || !window.automationCountdownStarted;
            
            if (stateChanged) {
                if (window.automationCountdownInterval) {
                    clearInterval(window.automationCountdownInterval);
                    window.automationCountdownInterval = null;
                }
                
                if (shouldRun) {
                    // Initialize lastCheck if not set
                    if (!window.automationLastCheck) {
                        window.automationLastCheck = Date.now();
                    }
                    window.automationCountdownStarted = true;
                    
                    window.automationCountdownInterval = setInterval(() => {
                        const countdownEl = document.getElementById('automationCountdown');
                        if (!countdownEl) {
                            clearInterval(window.automationCountdownInterval);
                            window.automationCountdownInterval = null;
                            return;
                        }
                        // If we're now in blackout, stop countdown immediately
                        if (window.automationInBlackout) {
                            countdownEl.textContent = 'BLACKOUT';
                            // Stop the automation cycle from being triggered
                            return;
                        }
                        const elapsed = Math.floor((Date.now() - window.automationLastCheck) / 1000);
                        const intervalSec = CONFIG.automation.intervalMs / 1000;
                        const remaining = Math.max(0, intervalSec - elapsed);
                        countdownEl.textContent = remaining + 's';
                        // Only trigger cycle if: automation is enabled, not in blackout, and timer reached 0
                        if (remaining === 0 && window.automationEnabled && !window.automationInBlackout && !window.automationFailsafePaused && !window.automationCycleRunning) {
                            // Run the actual automation cycle on the backend
                            runAutomationCycle();
                        }
                    }, CONFIG.automation.countdownUpdateMs);
                } else {
                    window.automationCountdownStarted = false;
                    // Keep PAUSED or BLACKOUT visible
                    const countdownEl = document.getElementById('automationCountdown');
                    if (countdownEl) countdownEl.textContent = window.automationInBlackout ? 'BLACKOUT' : 'PAUSED';
                }
            }
            } catch (e) {
                console.error('[Automation] updateBackendAutomationUI failed:', e);
                const container = document.getElementById('backendAutomationStatus');
                if (container) {
                    container.innerHTML = '<div style="color:var(--color-danger);font-size:12px">⚠️ UI Error: ' + e.message + '</div>';
                }
            }
        }
        
        // Run the automation cycle - called by the countdown timer when it hits 0
        async function runAutomationCycle() {
            // Prevent multiple simultaneous calls
            if (window.automationCycleRunning) {
                console.log('[Automation] Cycle already running, skipping');
                return;
            }
            window.automationCycleRunning = true;
            
            // Immediately update lastCheck to reset the countdown
            window.automationLastCheck = Date.now();
            
            const countdownEl = document.getElementById('automationCountdown');
            if (countdownEl) countdownEl.textContent = '⏳';
            
            try {
                const resp = await authenticatedFetch('/api/automation/cycle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                const data = await resp.json();
                
                if (data.errno === 0) {
                    
                    // Store cycle result for debug display
                    window.lastCycleResult = data.result;
                    
                    // Handle curtailment feedback
                    if (data.result?.curtailment) {
                        const curtailment = data.result.curtailment;
                        // Store curtailment state for display in info box
                        window.curtailmentState = {
                            active: curtailment.enabled && curtailment.triggered,
                            enabled: curtailment.enabled,
                            triggered: curtailment.triggered,
                            currentPrice: curtailment.currentPrice,
                            priceThreshold: curtailment.priceThreshold
                        };
                        // Update solar tile curtailment indicator
                        updateSolarTileCurtailmentIndicator();
                        if (curtailment.error) {
                            showMessage('warning', `☀️ Curtailment error: ${curtailment.error}`, 5000);
                        } else if (curtailment.stateChanged) {
                            if (curtailment.action === 'activated') {
                                showMessage('info', `☀️ Solar curtailment activated (price ${curtailment.currentPrice.toFixed(2)}¢ < ${curtailment.priceThreshold}¢)`, 5000);
                            } else if (curtailment.action === 'deactivated') {
                                showMessage('success', `☀️ Solar curtailment deactivated (price ${curtailment.currentPrice.toFixed(2)}¢ >= ${curtailment.priceThreshold}¢)`, 5000);
                            }
                        }
                    }
                    
                    // Immediately update debug box if visible
                    const debugContent = document.getElementById('debugContent');
                    const debugTimestamp = document.getElementById('debugTimestamp');
                    if (debugContent) {
                        debugContent.innerHTML = formatCycleResult(data.result);
                    }
                    if (debugTimestamp) {
                        debugTimestamp.textContent = formatDate(Date.now(), true, true);
                    }
                    
                    // If a rule was triggered, show a notification
                    if (data.result?.triggered && data.result?.rule) {
                        const ruleName = data.result.rule.name || 'Unknown';
                        if (data.result.status === 'new_trigger') {
                            showMessage('success', `🤖 Automation triggered: ${ruleName}`, 5000);
                        } else if (data.result.status === 'continuing') {
                            // Check if there are cooldown rules in evaluationResults
                            const cooldownRules = (data.result.evaluationResults || []).filter(er => er.result === 'cooldown');
                            if (cooldownRules.length > 0) {
                                const cooldownNames = cooldownRules.map(cr => cr.rule).join(', ');
                                showMessage('info', `⏱️ ${ruleName} continuing (${cooldownNames} in cooldown)`, 4000);
                            } else {
                                showMessage('info', `✓ ${ruleName} continuing`, 3000);
                            }
                        }
                    } else if (data.result?.skipped) {
                        const skipReason = String(data.result.reason || '');
                        if (skipReason === 'stale_telemetry' || skipReason === 'stale_telemetry_missing_timestamp' || skipReason === 'frozen_telemetry') {
                            const ageMs = Number(data.result?.telemetry?.ageMs);
                            const ageLabel = Number.isFinite(ageMs) ? formatMsToReadable(ageMs) : 'unknown age';
                            if (skipReason === 'stale_telemetry') {
                                showMessage('warning', `Automation paused: inverter telemetry is stale (${ageLabel} old).`, 6000);
                            } else if (skipReason === 'stale_telemetry_missing_timestamp') {
                                showMessage('warning', 'Automation paused: inverter telemetry timestamp missing or unreadable.', 6000);
                            } else {
                                showMessage('warning', `Automation paused: inverter telemetry appears frozen (${ageLabel}).`, 6000);
                            }
                        }
                    } else {
                    }
                    
                    // ALWAYS refresh automation status after cycle to show current state (active rule, etc.)
                    let triggeredRuleName = null;
                    try {
                        const statusResp = await authenticatedFetch('/api/automation/status');
                        const statusData = await statusResp.json();
                        if (statusData.errno === 0) {
                            window.automationStatus = statusData.result;
                            // If a rule was triggered, ensure its lastTriggered is set to now
                            if (data.result?.triggered && data.result?.rule) {
                                triggeredRuleName = data.result.rule.name || 'Unknown';
                                for (const [name, rule] of Object.entries(statusData.result.rules || {})) {
                                    if (name === triggeredRuleName) {
                                        rule.lastTriggered = Date.now();
                                        break;
                                    }
                                }
                            }
                            updateBackendAutomationUI(statusData.result);
                        }
                    } catch (statusErr) {
                        console.warn('[Automation] Failed to refresh status:', statusErr);
                    }
                    
                    // Update lastCheck from server response (ensures sync)
                    if (data.result?.lastCheck) {
                        window.automationLastCheck = data.result.lastCheck;
                    }
                } else {
                    console.warn('[Automation] Cycle error:', data.error);
                    showMessage('warning', `Automation cycle error: ${data.error}`, 5000);
                }
            } catch (e) {
                console.error('[Automation] Cycle failed:', e);
                showMessage('error', `Automation cycle failed: ${e.message}`, 5000);
            } finally {
                window.automationCycleRunning = false;
                // Reset countdown display
                if (countdownEl) {
                    const intervalSec = CONFIG.automation.intervalMs / 1000;
                    countdownEl.textContent = intervalSec + 's';
                }
            }
        }
        
        // Show modal to add a new automation rule
        function showAddRuleModal() {
            const modalHtml = `
                <div id="addRuleModal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:12000">
                    <div style="background:var(--bg-secondary);border:1px solid var(--border-primary);border-radius:12px;padding:24px;width:95%;max-width:840px;max-height:90vh;overflow-y:auto">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
                            <h3 style="margin:0;font-size:18px;color:var(--text-primary)">➕ Create New Automation Rule</h3>
                            <button onclick="closeAddRuleModal()" style="background:none;border:none;color:var(--text-secondary);font-size:20px;cursor:pointer">✕</button>
                        </div>
                        
                        <!-- Basic Info -->
                        <input type="hidden" id="newRuleId" value="">
                        <input type="hidden" id="editingRuleId" value="">
                        <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:16px;align-items:end">
                            <div>
                                <label style="display:block;font-size:12px;color:var(--text-secondary);margin-bottom:4px">Rule Name</label>
                                <input type="text" id="newRuleName" placeholder="e.g., Low Buy Cost Charge" style="width:100%;padding:8px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:6px;color:var(--text-primary);font-size:13px">
                            </div>
                            <div>
                                <label style="display:block;font-size:12px;color:var(--text-secondary);margin-bottom:4px">Priority (1=highest)</label>
                                <input type="number" id="newRulePriority" value="5" min="1" max="99" style="width:100%;padding:8px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:6px;color:var(--text-primary);font-size:13px">
                            </div>
                        </div>
                        
                        <!-- Rule Status Toggle -->
                        <div style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg-secondary);border-radius:6px;margin-bottom:16px">
                            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:0">
                                <input type="checkbox" id="newRuleEnabled" checked style="width:16px;height:16px">
                                <span style="color:var(--text-primary);font-size:13px;font-weight:500">🟢 Rule Enabled</span>
                            </label>
                            <span style="color:var(--text-secondary);font-size:11px;margin-left:auto">Disable to pause this rule temporarily</span>
                        </div>

                        <div id="rulePlainEnglishTop" style="margin:-4px 0 14px 0;padding:10px 12px;border:1px solid color-mix(in srgb, var(--accent-blue) 35%, var(--border-primary));border-radius:8px;background:linear-gradient(135deg,color-mix(in srgb, var(--accent-blue) 12%, var(--bg-primary)),color-mix(in srgb, var(--accent-blue) 4%, var(--bg-primary)));">
                            <div style="font-size:11px;font-weight:700;color:var(--accent-blue);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Plain-English Summary</div>
                            <div id="rulePlainEnglishTopText" style="font-size:12px;line-height:1.45;color:var(--text-primary)">As you configure this rule, a plain-language summary will appear here.</div>
                        </div>
                        
                        <!-- CONDITIONS SECTION -->
                        <div style="background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:8px;padding:16px;margin-bottom:16px">
                            <h4 style="margin:0 0 12px 0;font-size:14px;color:var(--accent-blue)">📋 Conditions (ALL must be true)</h4>
                            
                            <!-- Feed-in Price -->
                            <div style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--bg-secondary);border-radius:6px;margin-bottom:8px">
                                <label style="display:flex;align-items:center;gap:6px;min-width:160px;cursor:pointer">
                                    <input type="checkbox" id="condFeedInEnabled" style="width:16px;height:16px">
                                    <span style="color:var(--text-primary);font-size:13px">💰 Feed-in Price</span>
                                </label>
                                <select id="condFeedInOp" style="padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                    <option value=">">&gt;</option>
                                    <option value=">=">&gt;=</option>
                                    <option value="<">&lt;</option>
                                    <option value="<=">&lt;=</option>
                                    <option value="between">between</option>
                                </select>
                                <input type="number" id="condFeedInVal" placeholder="¢/kWh" value="20" min="-100" max="500" step="0.1" style="width:80px;padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                <span id="condFeedInVal2Wrap" style="display:none;color:var(--text-secondary);font-size:12px">and <input type="number" id="condFeedInVal2" value="50" min="-100" max="500" step="0.1" style="width:60px;padding:4px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px"></span>
                                <span style="color:var(--text-secondary);font-size:11px">¢/kWh</span>
                            </div>
                            
                            <!-- Buy Price -->
                            <div style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--bg-secondary);border-radius:6px;margin-bottom:8px">
                                <label style="display:flex;align-items:center;gap:6px;min-width:160px;cursor:pointer">
                                    <input type="checkbox" id="condBuyEnabled" style="width:16px;height:16px">
                                    <span style="color:var(--text-primary);font-size:13px">🛒 Buy Price</span>
                                </label>
                                <select id="condBuyOp" style="padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                    <option value="<">&lt;</option>
                                    <option value="<=">&lt;=</option>
                                    <option value=">">&gt;</option>
                                    <option value=">=">&gt;=</option>
                                    <option value="between">between</option>
                                </select>
                                <input type="number" id="condBuyVal" placeholder="¢/kWh" value="10" min="-100" max="500" step="0.1" style="width:80px;padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                <span id="condBuyVal2Wrap" style="display:none;color:var(--text-secondary);font-size:12px">and <input type="number" id="condBuyVal2" value="20" min="-100" max="500" step="0.1" style="width:60px;padding:4px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px"></span>
                                <span style="color:var(--text-secondary);font-size:11px">¢/kWh</span>
                            </div>
                            
                            <!-- Battery SoC -->
                            <div style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--bg-secondary);border-radius:6px;margin-bottom:8px">
                                <label style="display:flex;align-items:center;gap:6px;min-width:160px;cursor:pointer">
                                    <input type="checkbox" id="condSocEnabled" style="width:16px;height:16px">
                                    <span style="color:var(--text-primary);font-size:13px">🔋 Battery SoC</span>
                                </label>
                                <select id="condSocOp" style="padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                    <option value=">">&gt;</option>
                                    <option value=">=">&gt;=</option>
                                    <option value="<">&lt;</option>
                                    <option value="<=">&lt;=</option>
                                    <option value="between">between</option>
                                </select>
                                <input type="number" id="condSocVal" placeholder="%" value="80" min="0" max="100" style="width:80px;padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                <span id="condSocVal2Wrap" style="display:none;color:var(--text-secondary);font-size:12px">and <input type="number" id="condSocVal2" value="100" min="0" max="100" style="width:60px;padding:4px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px"></span>
                                <span style="color:var(--text-secondary);font-size:11px">%</span>
                            </div>
                            
                            <!-- Temperature -->
                            <div style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--bg-secondary);border-radius:6px;margin-bottom:8px;flex-wrap:wrap">
                                <label style="display:flex;align-items:center;gap:6px;min-width:160px;cursor:pointer">
                                    <input type="checkbox" id="condTempEnabled" style="width:16px;height:16px">
                                    <span style="color:var(--text-primary);font-size:13px">🌡️ Temperature</span>
                                </label>
                                <select id="condTempType" onchange="updateTemperatureConditionUI()" style="padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                    <option value="forecastMax">Forecast Daily Max</option>
                                    <option value="forecastMin">Forecast Daily Min</option>
                                    <option value="battery">Battery</option>
                                    <option value="ambient">Ambient</option>
                                    <option value="inverter">Inverter</option>
                                </select>
                                <select id="condTempOp" style="padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                    <option value="<">&lt;</option>
                                    <option value="<=">&lt;=</option>
                                    <option value=">">&gt;</option>
                                    <option value=">=">&gt;=</option>
                                </select>
                                <input type="number" id="condTempVal" placeholder="°C" value="40" min="-40" max="80" step="1" style="width:70px;padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                <span style="color:var(--text-secondary);font-size:11px">°C</span>
                                <span id="condTempDayOffsetWrap" style="display:none;color:var(--text-secondary);font-size:11px">
                                    in next
                                    <select id="condTempDayOffset" style="min-width:180px;padding:4px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                        <option value="0">0 days (today)</option>
                                        <option value="1">1 day</option>
                                        <option value="2">2 days</option>
                                        <option value="3">3 days</option>
                                        <option value="4">4 days</option>
                                        <option value="5">5 days</option>
                                        <option value="6">6 days</option>
                                        <option value="7">7 days</option>
                                        <option value="8">8 days</option>
                                        <option value="9">9 days</option>
                                        <option value="10">10 days</option>
                                    </select>
                                    days
                                </span>
                            </div>
                            
                            <!-- Solar Radiation Forecast -->
                            <div style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--bg-secondary);border-radius:6px;margin-bottom:8px;flex-wrap:wrap">
                                <label style="display:flex;align-items:center;gap:6px;min-width:160px;cursor:pointer">
                                    <input type="checkbox" id="condSolarEnabled" style="width:16px;height:16px">
                                    <span style="color:var(--text-primary);font-size:13px">☀️ Solar Radiation</span>
                                </label>
                                <select id="condSolarCheck" style="padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                    <option value="average">Avg</option>
                                    <option value="min">Min</option>
                                    <option value="max">Max</option>
                                </select>
                                <select id="condSolarOp" style="padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                    <option value=">">&gt;</option>
                                    <option value=">=">&gt;=</option>
                                    <option value="<">&lt;</option>
                                    <option value="<=">&lt;=</option>
                                </select>
                                <input type="number" id="condSolarVal" placeholder="W/m²" value="300" min="0" max="1500" step="10" style="width:70px;padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                <span style="color:var(--text-secondary);font-size:11px">W/m² in next</span>
                                <input type="number" id="condSolarLookAhead" value="6" min="1" max="168" style="width:50px;padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                <select id="condSolarLookAheadUnit" style="padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                    <option value="hours" selected>hrs</option>
                                    <option value="days">days</option>
                                </select>
                            </div>
                            
                            <!-- Cloud Cover Forecast -->
                            <div style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--bg-secondary);border-radius:6px;margin-bottom:8px;flex-wrap:wrap">
                                <label style="display:flex;align-items:center;gap:6px;min-width:160px;cursor:pointer">
                                    <input type="checkbox" id="condCloudEnabled" style="width:16px;height:16px">
                                    <span style="color:var(--text-primary);font-size:13px">☁️ Cloud Cover</span>
                                </label>
                                <select id="condCloudCheck" style="padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                    <option value="average">Avg</option>
                                    <option value="min">Min</option>
                                    <option value="max">Max</option>
                                </select>
                                <select id="condCloudOp" style="padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                    <option value="<">&lt;</option>
                                    <option value="<=">&lt;=</option>
                                    <option value=">">&gt;</option>
                                    <option value=">=">&gt;=</option>
                                </select>
                                <input type="number" id="condCloudVal" placeholder="%" value="50" min="0" max="100" style="width:60px;padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                <span style="color:var(--text-secondary);font-size:11px">% in next</span>
                                <input type="number" id="condCloudLookAhead" value="6" min="1" max="168" style="width:50px;padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                <select id="condCloudLookAheadUnit" style="padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                    <option value="hours" selected>hrs</option>
                                    <option value="days">days</option>
                                </select>
                            </div>
                            
                            <!-- Forecast Price -->
                            <div style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--bg-secondary);border-radius:6px;margin-bottom:8px;flex-wrap:wrap">
                                <label style="display:flex;align-items:center;gap:6px;min-width:160px;cursor:pointer">
                                    <input type="checkbox" id="condForecastEnabled" style="width:16px;height:16px">
                                    <span style="color:var(--text-primary);font-size:13px">📈 Forecast Price</span>
                                </label>
                                <select id="condForecastType" style="padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                    <option value="feedIn">Feed-in</option>
                                    <option value="general">Buy</option>
                                </select>
                                <select id="condForecastCheck" style="padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                    <option value="average">Avg</option>
                                    <option value="min">Min</option>
                                    <option value="max">Max</option>
                                    <option value="any">Any</option>
                                </select>
                                <select id="condForecastOp" style="padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                    <option value=">">&gt;</option>
                                    <option value=">=">&gt;=</option>
                                    <option value="<">&lt;</option>
                                    <option value="<=">&lt;=</option>
                                </select>
                                <input type="number" id="condForecastVal" placeholder="¢" value="30" min="-100" max="500" step="0.1" style="width:60px;padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                <span style="color:var(--text-secondary);font-size:11px">¢ in next</span>
                                <input type="number" id="condForecastLookAhead" value="1" min="1" max="24" style="width:50px;padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                <select id="condForecastLookAheadUnit" style="padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px" onchange="updateForecastLookAheadRange()">
                                    <option value="hours" selected>hrs</option>
                                    <option value="days">days</option>
                                </select>
                            </div>
                            
                            <!-- Time Window -->
                            <div style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--bg-secondary);border-radius:6px;flex-wrap:wrap">
                                <label style="display:flex;align-items:center;gap:6px;min-width:160px;cursor:pointer">
                                    <input type="checkbox" id="condTimeEnabled" style="width:16px;height:16px">
                                    <span style="color:var(--text-primary);font-size:13px">🕐 Time Window</span>
                                </label>
                                <input type="time" id="condTimeStart" value="06:00" style="padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                <span style="color:var(--text-secondary);font-size:12px">to</span>
                                <input type="time" id="condTimeEnd" value="18:00" style="padding:6px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-primary);font-size:12px">
                                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                                    <span style="color:var(--text-secondary);font-size:11px">Days:</span>
                                    <label style="display:flex;align-items:center;gap:4px;color:var(--text-primary);font-size:11px"><input type="checkbox" class="cond-time-day" value="1">Mon</label>
                                    <label style="display:flex;align-items:center;gap:4px;color:var(--text-primary);font-size:11px"><input type="checkbox" class="cond-time-day" value="2">Tue</label>
                                    <label style="display:flex;align-items:center;gap:4px;color:var(--text-primary);font-size:11px"><input type="checkbox" class="cond-time-day" value="3">Wed</label>
                                    <label style="display:flex;align-items:center;gap:4px;color:var(--text-primary);font-size:11px"><input type="checkbox" class="cond-time-day" value="4">Thu</label>
                                    <label style="display:flex;align-items:center;gap:4px;color:var(--text-primary);font-size:11px"><input type="checkbox" class="cond-time-day" value="5">Fri</label>
                                    <label style="display:flex;align-items:center;gap:4px;color:var(--text-primary);font-size:11px"><input type="checkbox" class="cond-time-day" value="6">Sat</label>
                                    <label style="display:flex;align-items:center;gap:4px;color:var(--text-primary);font-size:11px"><input type="checkbox" class="cond-time-day" value="0">Sun</label>
                                    <span style="color:var(--text-muted);font-size:10px">(none = every day)</span>
                                </div>
                            </div>
                        </div>
                        
                        <!-- ACTION SECTION -->
                        <div style="background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:8px;padding:16px;margin-bottom:16px">
                            <h4 style="margin:0 0 12px 0;font-size:14px;color:var(--color-success-dark)">⚡ Action (when conditions met)</h4>
                            
                            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
                                <div>
                                    <div class="field-label-with-tooltip">
                                        <label style="display:block;font-size:11px;color:var(--text-secondary)">Work Mode</label>
                                        <span class="tooltip-icon" data-tooltip="Mode sent to the inverter scheduler (ForceDischarge, ForceCharge, SelfUse, Feedin, Backup).">?</span>
                                    </div>
                                    <select id="newRuleWorkMode" style="width:100%;padding:8px;background:var(--bg-secondary);border:1px solid var(--border-primary);border-radius:6px;color:var(--text-primary);font-size:13px;margin-top:4px">
                                        <option value="ForceDischarge">Force Discharge</option>
                                        <option value="ForceCharge">Force Charge</option>
                                        <option value="SelfUse">Self Use</option>
                                        <option value="Feedin">Feed In</option>
                                        <option value="Backup">Backup</option>
                                    </select>
                                </div>
                                <div>
                                    <div class="field-label-with-tooltip">
                                        <label style="display:block;font-size:11px;color:var(--text-secondary)">Duration (min)</label>
                                        <span class="tooltip-icon" data-tooltip="Requested run time in minutes. Segments cannot cross midnight; end time is capped at 23:59 if needed.">?</span>
                                    </div>
                                    <input type="number" id="newRuleDuration" value="30" min="5" max="120" style="width:100%;padding:8px;background:var(--bg-secondary);border:1px solid var(--border-primary);border-radius:6px;color:var(--text-primary);font-size:13px;margin-top:4px">
                                </div>
                                <div>
                                    <div class="field-label-with-tooltip">
                                        <label style="display:block;font-size:11px;color:var(--text-secondary)">Cooldown (min)</label>
                                        <span class="tooltip-icon" data-tooltip="Minimum wait before this rule can trigger again. Active rules are still re-evaluated while running.">?</span>
                                    </div>
                                    <input type="number" id="newRuleCooldown" value="5" min="1" max="1440" style="width:100%;padding:8px;background:var(--bg-secondary);border:1px solid var(--border-primary);border-radius:6px;color:var(--text-primary);font-size:13px;margin-top:4px">
                                </div>
                            </div>
                            
                            <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px">
                                <div>
                                    <div class="field-label-with-tooltip">
                                        <label style="display:block;font-size:11px;color:var(--text-secondary)">Power (W)</label>
                                        <span class="tooltip-icon" data-tooltip="Requested charge/discharge power in watts (fdPwr).">?</span>
                                    </div>
                                    <input type="number" id="newRuleFdPwr" value="5000" min="0" max="10000" step="100" style="width:100%;padding:8px;background:var(--bg-secondary);border:1px solid var(--border-primary);border-radius:6px;color:var(--text-primary);font-size:13px;margin-top:4px">
                                </div>
                                <div>
                                    <div class="field-label-with-tooltip">
                                        <label style="display:block;font-size:11px;color:var(--text-secondary)">Stop SoC (%)</label>
                                        <span class="tooltip-icon" data-tooltip="Stop threshold: minimum SoC for discharge, maximum SoC for charge.">?</span>
                                    </div>
                                    <input type="number" id="newRuleFdSoc" value="35" min="10" max="100" style="width:100%;padding:8px;background:var(--bg-secondary);border:1px solid var(--border-primary);border-radius:6px;color:var(--text-primary);font-size:13px;margin-top:4px">
                                </div>
                                <div>
                                    <div class="field-label-with-tooltip">
                                        <label style="display:block;font-size:11px;color:var(--text-secondary)">Min SoC (Grid)</label>
                                        <span class="tooltip-icon" data-tooltip="Set this at or above your global Battery SoC limits (Min SoC / Min SoC on Grid). Lower values may be rejected by the inverter scheduler (errno 40257).">?</span>
                                    </div>
                                    <input type="number" id="newRuleMinSoc" value="20" min="10" max="100" style="width:100%;padding:8px;background:var(--bg-secondary);border:1px solid var(--border-primary);border-radius:6px;color:var(--text-primary);font-size:13px;margin-top:4px">
                                    <div id="newRuleMinSocWarning" style="display:none;margin-top:6px;font-size:11px;color:var(--color-warning);line-height:1.35">
                                        ⚠️ Below recommended floor (20%). Keep this at or above your global battery Min SoC settings to reduce scheduler rejects (40257).
                                    </div>
                                </div>
                                <div>
                                    <div class="field-label-with-tooltip">
                                        <label style="display:block;font-size:11px;color:var(--text-secondary)">Max SoC (%)</label>
                                        <span class="tooltip-icon" data-tooltip="Maximum SoC limit sent with the segment (enforced by the inverter).">?</span>
                                    </div>
                                    <input type="number" id="newRuleMaxSoc" value="90" min="10" max="100" style="width:100%;padding:8px;background:var(--bg-secondary);border:1px solid var(--border-primary);border-radius:6px;color:var(--text-primary);font-size:13px;margin-top:4px">
                                </div>
                            </div>

                            <div id="ruleActionPlainEnglish" style="margin-top:12px;padding:10px 12px;border:1px solid color-mix(in srgb, var(--color-success-dark) 45%, var(--border-primary));border-radius:8px;background:linear-gradient(135deg,color-mix(in srgb, var(--color-success-dark) 13%, var(--bg-primary)),color-mix(in srgb, var(--color-success-dark) 4%, var(--bg-primary)));">
                                <div style="font-size:11px;font-weight:700;color:var(--color-success-dark);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Action Explained</div>
                                <div id="ruleActionPlainEnglishText" style="font-size:12px;line-height:1.45;color:var(--text-primary)">Set action values to see a clear plain-language explanation.</div>
                            </div>
                        </div>
                        
                        <div style="display:flex;gap:12px">
                            <button onclick="closeAddRuleModal()" style="flex:1;padding:12px;background:var(--bg-card);border:1px solid var(--border-primary);border-radius:6px;color:var(--text-primary);cursor:pointer;font-size:14px">Cancel</button>
                            <button onclick="testNewRule()" style="flex:1;padding:12px;background:var(--accent-blue);border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:14px">🧪 Test Rule</button>
                            <button onclick="createBackendRule()" style="flex:1;padding:12px;background:var(--color-success-dark);border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:14px;font-weight:600">Create Rule</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            const modal = document.getElementById('addRuleModal');
            if (modal && window.innerWidth <= 900) {
                modal.style.padding = '10px';
                modal.style.alignItems = 'flex-start';
                modal.style.overflowY = 'auto';
                const card = modal.firstElementChild;
                if (card) {
                    card.style.width = '100%';
                    card.style.maxWidth = '100%';
                    card.style.maxHeight = 'none';
                    card.style.margin = '8px 0 16px';
                    card.style.padding = '14px';
                    card.style.overflow = 'auto';
                    card.querySelectorAll('div[style*="grid-template-columns"]').forEach((el) => {
                        el.style.gridTemplateColumns = '1fr';
                    });
                    card.querySelectorAll('div[style*="display:flex"][style*="gap:12px"]').forEach((el) => {
                        el.style.flexWrap = 'wrap';
                    });
                }
            }
            applyRulePowerCapacityToUI(_inverterCapacityW);
            applyProviderConstraintsToDashboard();
            syncAutomationToggleVisibility();

            const minSocInput = document.getElementById('newRuleMinSoc');
            if (minSocInput) {
                minSocInput.addEventListener('input', updateRuleMinSocFloorWarning);
                minSocInput.addEventListener('change', updateRuleMinSocFloorWarning);
                updateRuleMinSocFloorWarning();
            }
            
            // Add event listeners for "between" operator toggle
            ['FeedIn', 'Buy', 'Soc'].forEach(type => {
                const opSelect = document.getElementById('cond' + type + 'Op');
                const val2Wrap = document.getElementById('cond' + type + 'Val2Wrap');
                if (opSelect && val2Wrap) {
                    opSelect.addEventListener('change', () => {
                        val2Wrap.style.display = opSelect.value === 'between' ? 'inline' : 'none';
                    });
                }
            });

            setupRulePlainEnglishListeners(modal);
            updateTemperatureConditionUI(modal);
            updateRulePlainEnglishSummary(modal);
        }

        const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

        function normalizeTimeConditionDays(days) {
            if (!Array.isArray(days)) return [];
            const mapped = [];
            days.forEach((value) => {
                if (Number.isInteger(value) && value >= 0 && value <= 6) {
                    mapped.push(value);
                    return;
                }
                if (typeof value === 'string') {
                    const trimmed = value.trim().toLowerCase();
                    if (/^[0-6]$/.test(trimmed)) {
                        mapped.push(parseInt(trimmed, 10));
                        return;
                    }
                    const byName = {
                        sun: 0, sunday: 0,
                        mon: 1, monday: 1,
                        tue: 2, tues: 2, tuesday: 2,
                        wed: 3, wednesday: 3,
                        thu: 4, thur: 4, thurs: 4, thursday: 4,
                        fri: 5, friday: 5,
                        sat: 6, saturday: 6
                    };
                    if (byName[trimmed] !== undefined) mapped.push(byName[trimmed]);
                }
            });
            return [...new Set(mapped)].sort((a, b) => a - b);
        }

        function getSelectedTimeConditionDays(modal) {
            if (!modal) return [];
            const selected = Array.from(modal.querySelectorAll('.cond-time-day:checked'))
                .map((el) => parseInt(el.value, 10))
                .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
            return [...new Set(selected)].sort((a, b) => a - b);
        }

        function setSelectedTimeConditionDays(modal, days) {
            if (!modal) return;
            const normalized = normalizeTimeConditionDays(days);
            modal.querySelectorAll('.cond-time-day').forEach((el) => {
                const dayValue = parseInt(el.value, 10);
                el.checked = normalized.includes(dayValue);
            });
        }

        function formatTimeConditionDays(days) {
            const normalized = normalizeTimeConditionDays(days);
            if (normalized.length === 0) return 'Every day';
            return normalized.map((d) => WEEKDAY_LABELS[d]).join(', ');
        }

        const TEMP_OPERATOR_PRETTY = {
            '<': 'is below',
            '<=': 'is at or below',
            '>': 'is above',
            '>=': 'is at or above',
            '==': 'equals',
            '!=': 'is not'
        };

        function getTempTypeLabel(type) {
            if (type === 'forecastMax') return 'forecast daily maximum temperature';
            if (type === 'forecastMin') return 'forecast daily minimum temperature';
            if (type === 'ambient') return 'ambient temperature';
            if (type === 'inverter') return 'inverter temperature';
            return 'battery temperature';
        }

        function getForecastOffsetDisplayLabel(offset) {
            const n = Number.isInteger(offset) ? offset : 0;
            if (n === 0) return '0 days (today)';
            if (n === 1) return '1 day';
            return `${n} days`;
        }

        function getForecastWindowSentence(offset) {
            const n = Number.isInteger(offset) ? offset : 0;
            if (n === 0) return 'today';
            if (n === 1) return 'in the next 1 day';
            return `in the next ${n} days`;
        }

        function buildTemperatureDayOffsetOptions(modal) {
            if (!modal) return;
            const selectEl = modal.querySelector('#condTempDayOffset');
            if (!selectEl) return;

            const currentValue = parseInt(selectEl.value, 10);
            const selectedOffset = Number.isInteger(currentValue) ? currentValue : 0;

            const options = [];
            for (let i = 0; i <= 10; i++) {
                options.push(`<option value="${i}">${getForecastOffsetDisplayLabel(i)}</option>`);
            }
            selectEl.innerHTML = options.join('');

            const safeValue = Math.max(0, Math.min(10, selectedOffset));
            selectEl.value = String(safeValue);
        }

        function readModalField(modal, selector, fallback = '') {
            if (!modal) return fallback;
            const el = modal.querySelector(selector);
            if (!el) return fallback;
            const value = el.value;
            if (value === undefined || value === null || String(value).trim() === '') return fallback;
            return String(value).trim();
        }

        function formatCountWithUnit(valueRaw, unitRaw) {
            const count = Math.max(0, parseInt(valueRaw, 10) || 0);
            const unit = (unitRaw || 'hours').toLowerCase();
            if (unit === 'days') return `${count} ${count === 1 ? 'day' : 'days'}`;
            if (unit === 'minutes') return `${count} ${count === 1 ? 'minute' : 'minutes'}`;
            return `${count} ${count === 1 ? 'hour' : 'hours'}`;
        }

        function getConditionOperatorText(op) {
            return TEMP_OPERATOR_PRETTY[op] || `is ${op}`;
        }

        function formatSimpleCondition(op, value, unitText = '') {
            if (op === 'between') return '';
            return `${getConditionOperatorText(op)} ${value}${unitText}`;
        }

        function getEnabledConditionPhrases(modal) {
            const phrases = [];

            if (modal.querySelector('#condFeedInEnabled')?.checked) {
                const op = readModalField(modal, '#condFeedInOp', '>');
                const val1 = readModalField(modal, '#condFeedInVal', '0');
                if (op === 'between') {
                    const val2 = readModalField(modal, '#condFeedInVal2', '0');
                    phrases.push(`feed-in price is between ${val1} and ${val2} c/kWh`);
                } else {
                    phrases.push(`feed-in price ${formatSimpleCondition(op, val1, ' c/kWh')}`);
                }
            }

            if (modal.querySelector('#condBuyEnabled')?.checked) {
                const op = readModalField(modal, '#condBuyOp', '<');
                const val1 = readModalField(modal, '#condBuyVal', '0');
                if (op === 'between') {
                    const val2 = readModalField(modal, '#condBuyVal2', '0');
                    phrases.push(`buy price is between ${val1} and ${val2} c/kWh`);
                } else {
                    phrases.push(`buy price ${formatSimpleCondition(op, val1, ' c/kWh')}`);
                }
            }

            if (modal.querySelector('#condSocEnabled')?.checked) {
                const op = readModalField(modal, '#condSocOp', '>');
                const val1 = readModalField(modal, '#condSocVal', '0');
                if (op === 'between') {
                    const val2 = readModalField(modal, '#condSocVal2', '100');
                    phrases.push(`battery SoC is between ${val1}% and ${val2}%`);
                } else {
                    phrases.push(`battery SoC ${formatSimpleCondition(op, val1, '%')}`);
                }
            }

            if (modal.querySelector('#condTempEnabled')?.checked) {
                const type = readModalField(modal, '#condTempType', 'battery');
                const op = readModalField(modal, '#condTempOp', '<');
                const value = readModalField(modal, '#condTempVal', '40');
                if (type === 'forecastMax' || type === 'forecastMin') {
                    const dayOffset = Math.max(0, Math.min(10, parseInt(readModalField(modal, '#condTempDayOffset', '0'), 10) || 0));
                    phrases.push(`${getTempTypeLabel(type)} ${getForecastWindowSentence(dayOffset)} ${getConditionOperatorText(op)} ${value}°C`);
                } else {
                    phrases.push(`${getTempTypeLabel(type)} ${getConditionOperatorText(op)} ${value}°C`);
                }
            }

            if (modal.querySelector('#condSolarEnabled')?.checked) {
                const checkType = readModalField(modal, '#condSolarCheck', 'average');
                const checkLabel = checkType === 'min' ? 'minimum' : (checkType === 'max' ? 'maximum' : 'average');
                const op = readModalField(modal, '#condSolarOp', '>');
                const value = readModalField(modal, '#condSolarVal', '300');
                const lookAhead = formatCountWithUnit(
                    readModalField(modal, '#condSolarLookAhead', '6'),
                    readModalField(modal, '#condSolarLookAheadUnit', 'hours')
                );
                phrases.push(`${checkLabel} solar radiation over the next ${lookAhead} ${getConditionOperatorText(op)} ${value} W/m²`);
            }

            if (modal.querySelector('#condCloudEnabled')?.checked) {
                const checkType = readModalField(modal, '#condCloudCheck', 'average');
                const checkLabel = checkType === 'min' ? 'minimum' : (checkType === 'max' ? 'maximum' : 'average');
                const op = readModalField(modal, '#condCloudOp', '<');
                const value = readModalField(modal, '#condCloudVal', '50');
                const lookAhead = formatCountWithUnit(
                    readModalField(modal, '#condCloudLookAhead', '6'),
                    readModalField(modal, '#condCloudLookAheadUnit', 'hours')
                );
                phrases.push(`${checkLabel} cloud cover over the next ${lookAhead} ${getConditionOperatorText(op)} ${value}%`);
            }

            if (modal.querySelector('#condForecastEnabled')?.checked) {
                const priceType = readModalField(modal, '#condForecastType', 'feedIn');
                const priceLabel = priceType === 'feedIn' ? 'feed-in' : 'buy';
                const checkType = readModalField(modal, '#condForecastCheck', 'average');
                const op = readModalField(modal, '#condForecastOp', '>');
                const value = readModalField(modal, '#condForecastVal', '0');
                const lookAhead = formatCountWithUnit(
                    readModalField(modal, '#condForecastLookAhead', '1'),
                    readModalField(modal, '#condForecastLookAheadUnit', 'hours')
                );

                if (checkType === 'any') {
                    phrases.push(`any ${priceLabel} forecast price in the next ${lookAhead} ${getConditionOperatorText(op)} ${value} c/kWh`);
                } else {
                    const checkLabel = checkType === 'min' ? 'minimum' : (checkType === 'max' ? 'maximum' : 'average');
                    phrases.push(`${checkLabel} ${priceLabel} forecast price over the next ${lookAhead} ${getConditionOperatorText(op)} ${value} c/kWh`);
                }
            }

            if (modal.querySelector('#condTimeEnabled')?.checked) {
                const start = readModalField(modal, '#condTimeStart', '00:00');
                const end = readModalField(modal, '#condTimeEnd', '23:59');
                const days = getSelectedTimeConditionDays(modal);
                const dayLabel = formatTimeConditionDays(days);
                if (dayLabel === 'Every day') {
                    phrases.push(`time is between ${start} and ${end} every day`);
                } else {
                    phrases.push(`time is between ${start} and ${end} on ${dayLabel}`);
                }
            }

            return phrases;
        }

        function getWorkModeActionPhrase(mode) {
            if (_providerCapabilities.provider === 'alphaess') {
                if (mode === 'ForceDischarge') return 'schedule a battery discharge window';
                if (mode === 'ForceCharge') return 'schedule a battery charge window';
                if (mode === 'Feedin') return 'schedule a discharge/export window';
            }
            const map = {
                ForceDischarge: 'force battery discharge',
                ForceCharge: 'force battery charge',
                SelfUse: 'switch inverter to self-use mode',
                Feedin: 'switch inverter to feed-in mode',
                Backup: 'switch inverter to backup mode'
            };
            return map[mode] || 'apply the selected work mode';
        }

        function buildRuleActionSummaryText(modal, compact = false) {
            const mode = readModalField(modal, '#newRuleWorkMode', 'SelfUse');
            const duration = readModalField(modal, '#newRuleDuration', '30');
            const power = readModalField(modal, '#newRuleFdPwr', '0');
            const stopSoc = readModalField(modal, '#newRuleFdSoc', '35');
            const minSoc = readModalField(modal, '#newRuleMinSoc', '20');
            const maxSoc = readModalField(modal, '#newRuleMaxSoc', '90');
            const cooldown = readModalField(modal, '#newRuleCooldown', '5');

            if (compact) {
                return `Then it will ${getWorkModeActionPhrase(mode)} for ${duration} minutes.`;
            }

            const powerPhrase = _providerCapabilities.supportsExactPowerControl ? `${power}W` : `requested ${power}W`;
            const providerNote = _providerCapabilities.provider === 'alphaess'
                ? ' AlphaESS applies this through scheduler windows, rounds times to 15-minute boundaries, and may choose the actual charge/discharge rate.'
                : (_providerCapabilities.provider === 'sungrow'
                    ? ' Sungrow currently applies this through TOU windows, and the current adapter records the requested power/SOC values without writing matching exact device limits.'
                    : (_providerCapabilities.provider === 'sigenergy'
                        ? ' Sigenergy scheduler-backed rule execution is not implemented in the current adapter.'
                        : ''));

            return `When triggered, this rule will ${getWorkModeActionPhrase(mode)} for ${duration} minutes at ${powerPhrase}, with stop SoC ${stopSoc}%, min grid SoC ${minSoc}%, max SoC ${maxSoc}%, and cooldown ${cooldown} minutes before retrigger. Active cancellation applies: if conditions no longer match, the active segment is cancelled on the next automation check.${providerNote}`;
        }

        function updateRulePlainEnglishSummary(modalRef = null) {
            const modal = modalRef || document.getElementById('addRuleModal') || document;
            const topTextEl = modal.querySelector ? modal.querySelector('#rulePlainEnglishTopText') : null;
            const actionTextEl = modal.querySelector ? modal.querySelector('#ruleActionPlainEnglishText') : null;
            if (!topTextEl || !actionTextEl) return;

            const ruleName = readModalField(modal, '#newRuleName', 'This rule');
            const ruleEnabled = modal.querySelector('#newRuleEnabled')?.checked === true;
            const ruleState = ruleEnabled ? 'enabled' : 'paused';
            const conditions = getEnabledConditionPhrases(modal);
            const triggerText = conditions.length > 0
                ? `It triggers only when all selected conditions are true: ${conditions.join('; ')}.`
                : 'No trigger conditions are selected yet, so this rule will not run automatically.';

            topTextEl.textContent = `${ruleName} is ${ruleState}. ${triggerText} ${buildRuleActionSummaryText(modal, true)}`;
            actionTextEl.textContent = buildRuleActionSummaryText(modal, false);
        }

        function setupRulePlainEnglishListeners(modal) {
            if (!modal || modal.dataset.rulePlainEnglishBound === '1') return;
            modal.dataset.rulePlainEnglishBound = '1';

            const refresh = () => updateRulePlainEnglishSummary(modal);
            modal.addEventListener('input', (event) => {
                if (event?.target && event.target.matches && event.target.matches('input, select, textarea')) refresh();
            });
            modal.addEventListener('change', (event) => {
                if (event?.target && event.target.matches && event.target.matches('input, select, textarea')) refresh();
            });
        }

        function updateTemperatureConditionUI(modalRef = null) {
            const modal = modalRef || document.getElementById('addRuleModal') || document;
            const typeEl = modal.querySelector ? modal.querySelector('#condTempType') : null;
            const dayWrap = modal.querySelector ? modal.querySelector('#condTempDayOffsetWrap') : null;
            const daySelect = modal.querySelector ? modal.querySelector('#condTempDayOffset') : null;
            if (!typeEl || !dayWrap || !daySelect) return;

            const type = typeEl.value || 'battery';
            const isForecastType = type === 'forecastMax' || type === 'forecastMin';
            dayWrap.style.display = isForecastType ? 'inline-flex' : 'none';
            buildTemperatureDayOffsetOptions(modal);
            if (!isForecastType) daySelect.value = '0';
            updateRulePlainEnglishSummary(modal);
        }
        
        function closeAddRuleModal() {
            const modal = document.getElementById('addRuleModal');
            if (modal) modal.remove();
            syncAutomationToggleVisibility();
        }
        
        // Update forecast lookAhead range based on unit
        function updateForecastLookAheadRange() {
            const unit = document.getElementById('condForecastLookAheadUnit')?.value || 'hours';
            const input = document.getElementById('condForecastLookAhead');
            if (!input) return;
            
            // Forecast price: max 24 hours or 1 day
            switch (unit) {
                case 'hours':
                    input.max = 24;
                    if (parseInt(input.value) > 24) input.value = 24;
                    break;
                case 'days':
                    input.max = 1;
                    if (parseInt(input.value) > 1) input.value = 1;
                    break;
            }
        }

        function updateRuleMinSocFloorWarning() {
            const warningFloor = 20;
            const modal = document.getElementById('addRuleModal');
            if (!modal) return;

            const input = modal.querySelector('#newRuleMinSoc') || document.getElementById('newRuleMinSoc');
            const warning = modal.querySelector('#newRuleMinSocWarning') || document.getElementById('newRuleMinSocWarning');
            if (!input || !warning) return;

            const minSoc = parseInt(input.value, 10);
            const hasValidationError = input.style.borderColor === 'var(--color-danger)';
            const showWarning = !hasValidationError && !isNaN(minSoc) && minSoc < warningFloor;

            warning.style.display = showWarning ? 'block' : 'none';

            if (showWarning) {
                input.style.borderColor = 'var(--color-warning)';
                input.style.boxShadow = '0 0 0 2px rgba(210,153,34,0.25)';
            } else if (!hasValidationError) {
                input.style.borderColor = 'var(--border-primary)';
                input.style.boxShadow = 'none';
            }
        }
        
        // Comprehensive rule validation function
        function validateRuleForm() {
            const errors = [];
            const modal = document.getElementById('addRuleModal');
            if (!modal) return { valid: false, errors: ['Modal not found'] };
            
            // Helper to show field error (adds red border and stores error)
            const setFieldError = (elementId, message) => {
                const el = modal.querySelector('#' + elementId) || document.getElementById(elementId);
                if (el) {
                    el.style.borderColor = 'var(--color-danger)';
                    el.style.boxShadow = '0 0 0 2px rgba(248,81,73,0.3)';
                }
                errors.push(message);
            };
            
            // Helper to clear field error styling
            const clearFieldError = (elementId) => {
                const el = modal.querySelector('#' + elementId) || document.getElementById(elementId);
                if (el) {
                    el.style.borderColor = 'var(--border-primary)';
                    el.style.boxShadow = 'none';
                }
            };
            
            // Clear all previous error styles first
            ['newRuleName', 'newRulePriority', 'newRuleDuration', 'newRuleCooldown', 'newRuleFdPwr', 
             'newRuleFdSoc', 'newRuleMinSoc', 'newRuleMaxSoc', 'condFeedInVal', 'condFeedInVal2',
             'condBuyVal', 'condBuyVal2', 'condSocVal', 'condSocVal2', 'condTempVal', 'condTempDayOffset', 'condSolarVal',
             'condSolarLookAhead', 'condCloudVal', 'condCloudLookAhead', 'condForecastVal', 
             'condForecastLookAhead', 'condTimeStart', 'condTimeEnd'].forEach(clearFieldError);
            
            // === BASIC INFO VALIDATION ===
            const name = document.getElementById('newRuleName')?.value?.trim();
            if (!name) {
                setFieldError('newRuleName', '📝 Rule name is required');
            } else if (name.length < 3) {
                setFieldError('newRuleName', '📝 Rule name must be at least 3 characters');
            } else if (name.length > 100) {
                setFieldError('newRuleName', '📝 Rule name must be under 100 characters');
            }
            
            const priority = parseInt(document.getElementById('newRulePriority')?.value);
            if (isNaN(priority) || priority < 1 || priority > 99) {
                setFieldError('newRulePriority', '🎯 Priority must be between 1 (highest) and 99 (lowest)');
            }
            
            // === CONDITION VALIDATION ===
            const condFeedInEnabled = modal.querySelector('#condFeedInEnabled')?.checked;
            const condBuyEnabled = modal.querySelector('#condBuyEnabled')?.checked;
            const condSocEnabled = modal.querySelector('#condSocEnabled')?.checked;
            const condTempEnabled = modal.querySelector('#condTempEnabled')?.checked;
            const condSolarEnabled = modal.querySelector('#condSolarEnabled')?.checked;
            const condCloudEnabled = modal.querySelector('#condCloudEnabled')?.checked;
            const condForecastEnabled = modal.querySelector('#condForecastEnabled')?.checked;
            const condTimeEnabled = modal.querySelector('#condTimeEnabled')?.checked;
            
            const hasAnyCondition = condFeedInEnabled || condBuyEnabled || condSocEnabled || 
                                    condTempEnabled || condSolarEnabled || condCloudEnabled ||
                                    condForecastEnabled || condTimeEnabled;
            
            if (!hasAnyCondition) {
                errors.push('📋 At least one condition must be enabled for the rule to trigger');
            }
            
            // Feed-in Price validation (prices can be -100 to 500 ¢/kWh in Australia)
            if (condFeedInEnabled) {
                const val = parseFloat(modal.querySelector('#condFeedInVal')?.value);
                const op = modal.querySelector('#condFeedInOp')?.value;
                if (isNaN(val) || val < -100 || val > 500) {
                    setFieldError('condFeedInVal', '💰 Feed-in price must be between -100 and 500 ¢/kWh');
                }
                if (op === 'between') {
                    const val2 = parseFloat(modal.querySelector('#condFeedInVal2')?.value);
                    if (isNaN(val2) || val2 < -100 || val2 > 500) {
                        setFieldError('condFeedInVal2', '💰 Feed-in price range end must be between -100 and 500 ¢/kWh');
                    } else if (val >= val2) {
                        setFieldError('condFeedInVal2', '💰 Feed-in "between" range: first value must be less than second');
                    }
                }
            }
            
            // Buy Price validation
            if (condBuyEnabled) {
                const val = parseFloat(modal.querySelector('#condBuyVal')?.value);
                const op = modal.querySelector('#condBuyOp')?.value;
                if (isNaN(val) || val < -100 || val > 500) {
                    setFieldError('condBuyVal', '🛒 Buy price must be between -100 and 500 ¢/kWh');
                }
                if (op === 'between') {
                    const val2 = parseFloat(modal.querySelector('#condBuyVal2')?.value);
                    if (isNaN(val2) || val2 < -100 || val2 > 500) {
                        setFieldError('condBuyVal2', '🛒 Buy price range end must be between -100 and 500 ¢/kWh');
                    } else if (val >= val2) {
                        setFieldError('condBuyVal2', '🛒 Buy "between" range: first value must be less than second');
                    }
                }
            }
            
            // Battery SoC validation (0-100%)
            if (condSocEnabled) {
                const val = parseFloat(modal.querySelector('#condSocVal')?.value);
                const op = modal.querySelector('#condSocOp')?.value;
                if (isNaN(val) || val < 0 || val > 100) {
                    setFieldError('condSocVal', '🔋 Battery SoC must be between 0% and 100%');
                }
                if (op === 'between') {
                    const val2 = parseFloat(modal.querySelector('#condSocVal2')?.value);
                    if (isNaN(val2) || val2 < 0 || val2 > 100) {
                        setFieldError('condSocVal2', '🔋 SoC range end must be between 0% and 100%');
                    } else if (val >= val2) {
                        setFieldError('condSocVal2', '🔋 SoC "between" range: first value must be less than second');
                    }
                }
            }
            
            // Temperature validation (-40°C to 80°C reasonable range for batteries/environment)
            if (condTempEnabled) {
                const val = parseFloat(modal.querySelector('#condTempVal')?.value);
                if (isNaN(val) || val < -40 || val > 80) {
                    setFieldError('condTempVal', '🌡️ Temperature must be between -40°C and 80°C');
                }
                const tempType = modal.querySelector('#condTempType')?.value || 'battery';
                if (tempType === 'forecastMax' || tempType === 'forecastMin') {
                    const dayOffset = parseInt(modal.querySelector('#condTempDayOffset')?.value, 10);
                    if (isNaN(dayOffset) || dayOffset < 0 || dayOffset > 10) {
                        setFieldError('condTempDayOffset', '🌡️ Forecast look-ahead must be 0-10 days');
                    }
                }
            }
            
            // Solar Radiation validation (0-1500 W/m², lookAhead 1-168 hours or 1-7 days)
            if (condSolarEnabled) {
                const val = parseFloat(modal.querySelector('#condSolarVal')?.value);
                if (isNaN(val) || val < 0 || val > 1500) {
                    setFieldError('condSolarVal', '☀️ Solar radiation must be between 0 and 1500 W/m²');
                }
                const lookAhead = parseInt(modal.querySelector('#condSolarLookAhead')?.value);
                const unit = modal.querySelector('#condSolarLookAheadUnit')?.value;
                if (unit === 'hours' && (isNaN(lookAhead) || lookAhead < 1 || lookAhead > 168)) {
                    setFieldError('condSolarLookAhead', '☀️ Look-ahead must be 1-168 hours');
                } else if (unit === 'days' && (isNaN(lookAhead) || lookAhead < 1 || lookAhead > 7)) {
                    setFieldError('condSolarLookAhead', '☀️ Look-ahead must be 1-7 days');
                }
            }
            
            // Cloud Cover validation (0-100%, lookAhead 1-168 hours or 1-7 days)
            if (condCloudEnabled) {
                const val = parseFloat(modal.querySelector('#condCloudVal')?.value);
                if (isNaN(val) || val < 0 || val > 100) {
                    setFieldError('condCloudVal', '☁️ Cloud cover must be between 0% and 100%');
                }
                const lookAhead = parseInt(modal.querySelector('#condCloudLookAhead')?.value);
                const unit = modal.querySelector('#condCloudLookAheadUnit')?.value;
                if (unit === 'hours' && (isNaN(lookAhead) || lookAhead < 1 || lookAhead > 168)) {
                    setFieldError('condCloudLookAhead', '☁️ Look-ahead must be 1-168 hours');
                } else if (unit === 'days' && (isNaN(lookAhead) || lookAhead < 1 || lookAhead > 7)) {
                    setFieldError('condCloudLookAhead', '☁️ Look-ahead must be 1-7 days');
                }
            }
            
            // Forecast Price validation (hours only, max 24h or 1 day)
            if (condForecastEnabled) {
                const val = parseFloat(modal.querySelector('#condForecastVal')?.value);
                if (isNaN(val) || val < -100 || val > 500) {
                    setFieldError('condForecastVal', '📈 Forecast price must be between -100 and 500 ¢/kWh');
                }
                const lookAhead = parseInt(modal.querySelector('#condForecastLookAhead')?.value);
                const unit = modal.querySelector('#condForecastLookAheadUnit')?.value;
                if (unit === 'hours' && (isNaN(lookAhead) || lookAhead < 1 || lookAhead > 24)) {
                    setFieldError('condForecastLookAhead', '📈 Look-ahead must be 1-24 hours');
                } else if (unit === 'days' && (isNaN(lookAhead) || lookAhead < 1 || lookAhead > 1)) {
                    setFieldError('condForecastLookAhead', '📈 Look-ahead must be exactly 1 day');
                }
            }
            
            // Time Window validation
            if (condTimeEnabled) {
                const start = modal.querySelector('#condTimeStart')?.value;
                const end = modal.querySelector('#condTimeEnd')?.value;
                if (!start) {
                    setFieldError('condTimeStart', '🕐 Start time is required');
                }
                if (!end) {
                    setFieldError('condTimeEnd', '🕐 End time is required');
                }
                // Note: Don't validate start < end since overnight windows like 22:00-06:00 are valid
            }
            
            // === ACTION VALIDATION ===
            const duration = parseInt(document.getElementById('newRuleDuration')?.value);
            if (isNaN(duration) || duration < 5 || duration > 1440) {
                setFieldError('newRuleDuration', '⏱️ Duration must be 5-1440 minutes (max 24 hours)');
            }
            
            const cooldown = parseInt(document.getElementById('newRuleCooldown')?.value);
            if (isNaN(cooldown) || cooldown < 1 || cooldown > 1440) {
                setFieldError('newRuleCooldown', '🔄 Cooldown must be 1-1440 minutes');
            }
            
            const maxRulePowerW = getEffectiveInverterCapacityW();
            const fdPwr = parseInt(document.getElementById('newRuleFdPwr')?.value);
            if (isNaN(fdPwr) || fdPwr < 0 || fdPwr > maxRulePowerW) {
                setFieldError('newRuleFdPwr', getRulePowerValidationMessage(maxRulePowerW));
            }
            
            const fdSoc = parseInt(document.getElementById('newRuleFdSoc')?.value);
            if (isNaN(fdSoc) || fdSoc < 5 || fdSoc > 100) {
                setFieldError('newRuleFdSoc', '🔋 Stop SoC must be 5-100% (cutoff threshold)');
            }
            
            const minSoc = parseInt(document.getElementById('newRuleMinSoc')?.value);
            if (isNaN(minSoc) || minSoc < 5 || minSoc > 100) {
                setFieldError('newRuleMinSoc', '🔋 Min SoC (Grid) must be 5-100%');
            }
            
            const maxSoc = parseInt(document.getElementById('newRuleMaxSoc')?.value);
            if (isNaN(maxSoc) || maxSoc < 10 || maxSoc > 100) {
                setFieldError('newRuleMaxSoc', '🔋 Max SoC must be 10-100%');
            }
            
            // Cross-field validations for SoC
            if (!isNaN(minSoc) && !isNaN(maxSoc) && minSoc >= maxSoc) {
                setFieldError('newRuleMinSoc', '🔋 Min SoC (Grid) must be less than Max SoC');
                setFieldError('newRuleMaxSoc', '🔋 Max SoC must be greater than Min SoC (Grid)');
            }
            
            if (!isNaN(fdSoc) && !isNaN(minSoc) && fdSoc > minSoc + 50) {
                // Warning but not error - Stop SoC much higher than Min might be intentional
            }

            // For ForceDischarge, stop SoC must be >= min on-grid SoC
            const workModeVal = document.getElementById('newRuleWorkMode')?.value;
            if (workModeVal === 'ForceDischarge' && !isNaN(fdSoc) && !isNaN(minSoc) && fdSoc < minSoc) {
                setFieldError('newRuleFdSoc', '🔋 Stop SoC must be ≥ Min SoC (Grid) for Force Discharge — battery cannot discharge below its own floor');
                setFieldError('newRuleMinSoc', '🔋 Min SoC (Grid) is higher than Stop SoC — reduce Min SoC or raise Stop SoC');
            }

            // Re-apply non-blocking warning styling after validation pass
            updateRuleMinSocFloorWarning();
            
            return { valid: errors.length === 0, errors };
        }
        
        // Show validation errors in a user-friendly modal
        function showValidationErrors(errors) {
            const errorHtml = `
                <div id="validationErrorModal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:12001">
                    <div style="background:var(--bg-secondary);border:2px solid var(--color-danger);border-radius:12px;padding:20px;width:90%;max-width:450px;max-height:80vh;overflow-y:auto">
                        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
                            <span style="font-size:28px">⚠️</span>
                            <h3 style="margin:0;color:var(--color-danger);font-size:16px">Please fix the following issues:</h3>
                        </div>
                        <ul style="margin:0;padding:0 0 0 20px;color:var(--text-primary);font-size:13px;line-height:1.8">
                            ${errors.map(e => `<li style="margin-bottom:6px">${e}</li>`).join('')}
                        </ul>
                        <button onclick="document.getElementById('validationErrorModal').remove()" 
                                style="width:100%;margin-top:16px;padding:12px;background:var(--bg-card);border:1px solid var(--border-primary);border-radius:6px;color:var(--text-primary);cursor:pointer;font-size:14px">
                            Got it, let me fix
                        </button>
                    </div>
                </div>
            `;
            // Remove any existing error modal
            const existing = document.getElementById('validationErrorModal');
            if (existing) existing.remove();
            document.body.insertAdjacentHTML('beforeend', errorHtml);
        }
        
        async function createBackendRule() {
            // Run comprehensive validation first
            const validation = validateRuleForm();
            if (!validation.valid) {
                showValidationErrors(validation.errors);
                return;
            }
            
            const editingId = document.getElementById('editingRuleId')?.value;
            const name = document.getElementById('newRuleName').value.trim();
            // Auto-generate rule ID from name if not editing
            const ruleName = editingId || name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || ('rule_' + Date.now());
            const priority = parseInt(document.getElementById('newRulePriority').value) || 5;
            const cooldownMinutes = parseInt(document.getElementById('newRuleCooldown').value) || 5;
            const workMode = document.getElementById('newRuleWorkMode').value;
            const durationMinutes = parseInt(document.getElementById('newRuleDuration').value) || 30;
            const fdPwr = parseInt(document.getElementById('newRuleFdPwr').value) || 0;
            const minSocOnGrid = parseInt(document.getElementById('newRuleMinSoc').value) || 20;
            const fdSoc = Math.max(parseInt(document.getElementById('newRuleFdSoc').value) || minSocOnGrid, minSocOnGrid);
            const maxSoc = parseInt(document.getElementById('newRuleMaxSoc').value) || 100;
            
            // Collect conditions - use modal scoping to avoid duplicate ID conflicts with old modal
            const modal = document.getElementById('addRuleModal');
            const conditions = {
                feedInPrice: {
                    enabled: modal?.querySelector('#condFeedInEnabled')?.checked || false,
                    operator: modal?.querySelector('#condFeedInOp')?.value || '>',
                    value: parseFloat(modal?.querySelector('#condFeedInVal')?.value) || 0,
                    ...(modal?.querySelector('#condFeedInOp')?.value === 'between' && { value2: parseFloat(modal?.querySelector('#condFeedInVal2')?.value) || 0 })
                },
                buyPrice: {
                    enabled: modal?.querySelector('#condBuyEnabled')?.checked || false,
                    operator: modal?.querySelector('#condBuyOp')?.value || '>',
                    value: parseFloat(modal?.querySelector('#condBuyVal')?.value) || 0,
                    ...(modal?.querySelector('#condBuyOp')?.value === 'between' && { value2: parseFloat(modal?.querySelector('#condBuyVal2')?.value) || 0 })
                },
                soc: {
                    enabled: modal?.querySelector('#condSocEnabled')?.checked || false,
                    operator: modal?.querySelector('#condSocOp')?.value || '<',
                    value: parseFloat(modal?.querySelector('#condSocVal')?.value) || 50,
                    ...(modal?.querySelector('#condSocOp')?.value === 'between' && { value2: parseFloat(modal?.querySelector('#condSocVal2')?.value) || 80 })
                },
                temperature: {
                    enabled: modal?.querySelector('#condTempEnabled')?.checked || false,
                    type: modal?.querySelector('#condTempType')?.value || 'battery',
                    operator: modal?.querySelector('#condTempOp')?.value || '>',
                    value: parseFloat(modal?.querySelector('#condTempVal')?.value) || 40,
                    dayOffset: parseInt(modal?.querySelector('#condTempDayOffset')?.value, 10) || 0
                },
                solarRadiation: {
                    enabled: modal?.querySelector('#condSolarEnabled')?.checked || false,
                    checkType: modal?.querySelector('#condSolarCheck')?.value || 'average',
                    operator: modal?.querySelector('#condSolarOp')?.value || '>',
                    value: parseFloat(modal?.querySelector('#condSolarVal')?.value) || 300,
                    lookAhead: parseInt(modal?.querySelector('#condSolarLookAhead')?.value) || 6,
                    lookAheadUnit: modal?.querySelector('#condSolarLookAheadUnit')?.value || 'hours'
                },
                cloudCover: {
                    enabled: modal?.querySelector('#condCloudEnabled')?.checked || false,
                    checkType: modal?.querySelector('#condCloudCheck')?.value || 'average',
                    operator: modal?.querySelector('#condCloudOp')?.value || '<',
                    value: parseFloat(modal?.querySelector('#condCloudVal')?.value) || 50,
                    lookAhead: parseInt(modal?.querySelector('#condCloudLookAhead')?.value) || 6,
                    lookAheadUnit: modal?.querySelector('#condCloudLookAheadUnit')?.value || 'hours'
                },
                forecastPrice: {
                    enabled: modal?.querySelector('#condForecastEnabled')?.checked || false,
                    type: modal?.querySelector('#condForecastType')?.value || 'feedIn',
                    checkType: modal?.querySelector('#condForecastCheck')?.value || 'average',
                    operator: modal?.querySelector('#condForecastOp')?.value || '>',
                    value: parseFloat(modal?.querySelector('#condForecastVal')?.value) || 0,
                    lookAhead: parseInt(modal?.querySelector('#condForecastLookAhead')?.value) || 1,
                    lookAheadUnit: modal?.querySelector('#condForecastLookAheadUnit')?.value || 'hours'
                },
                time: {
                    enabled: modal?.querySelector('#condTimeEnabled')?.checked || false,
                    startTime: modal?.querySelector('#condTimeStart')?.value || '00:00',
                    endTime: modal?.querySelector('#condTimeEnd')?.value || '23:59',
                    days: getSelectedTimeConditionDays(modal)
                }
            };
            
            try {
                // Use update endpoint if editing, create if new
                const endpoint = editingId ? '/api/automation/rule/update' : '/api/automation/rule/create';
                const resp = await authenticatedFetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ruleName,
                        name: name || ruleName,
                        priority,
                        conditions,
                        cooldownMinutes,
                        enabled: document.getElementById('newRuleEnabled')?.checked === true,
                        action: { workMode, durationMinutes, fdPwr, fdSoc, minSocOnGrid, maxSoc }
                    })
                });
                const data = await resp.json();
                
                if (data.errno === 0) {
                    closeAddRuleModal();
                    loadBackendAutomationStatus();
                    showMessage('success', `✅ Rule "${name}" ${editingId ? 'updated' : 'created'} successfully!`, 3000);
                } else {
                    showValidationErrors([`Server error: ${data.error || 'Unknown error'}`]);
                }
            } catch (e) {
                showValidationErrors([`Network error: ${e.message}`]);
            }
        }
        
        async function testNewRule() {
            // Redirect to test page where user can test rule with live data
            // Note: The rule definition is NOT saved until you click "Create Rule"
            alert('📋 Test Rule opens the dedicated test page (test.html).\n\nThere you can:\n• Simulate different conditions\n• See if the rule would trigger\n• Preview what action would execute\n\n⚠️ Your rule is NOT saved until you click "Create Rule" on this page.');
            window.open('/test.html', '_blank');
        }
        
        // Edit an existing rule - opens modal with pre-filled values
        async function editBackendRule(ruleName) {
            try {
                const resp = await authenticatedFetch('/api/automation/status');
                const data = await resp.json();
                const rule = data.result?.rules?.[ruleName];
                if (!rule) {
                    alert('Rule not found');
                    return;
                }
                
                // Open the add modal
                showAddRuleModal();
                
                // Wait for modal to render
                await new Promise(r => setTimeout(r, 50));
                
                // Get modal reference for scoped queries
                const modal = document.getElementById('addRuleModal');
                
                // Change modal title
                const modalTitle = modal?.querySelector('#ruleModalTitle');
                if (modalTitle) modalTitle.textContent = 'Edit Automation Rule';
                
                // Set editing flag
                document.getElementById('editingRuleId').value = ruleName;
                
                // Fill in basic info (these have unique IDs, OK to use getElementById)
                document.getElementById('newRuleName').value = rule.name || ruleName;
                document.getElementById('newRulePriority').value = rule.priority || 5;
                document.getElementById('newRuleEnabled').checked = rule.enabled !== false;  // Default to enabled if not specified
                document.getElementById('newRuleCooldown').value = rule.cooldownMinutes || 5;
                
                // Fill in conditions using modal-scoped queries
                const conditions = rule.conditions || {};
                if (conditions.feedInPrice) {
                    const el = modal?.querySelector('#condFeedInEnabled'); if (el) el.checked = conditions.feedInPrice.enabled || false;
                    const feedInOper = conditions.feedInPrice.operator || conditions.feedInPrice.op || '>';
                    const op = modal?.querySelector('#condFeedInOp'); if (op) op.value = feedInOper;
                    const val = modal?.querySelector('#condFeedInVal'); if (val) val.value = conditions.feedInPrice.value || 0;
                    if (feedInOper === 'between') {
                        const v2wrap = modal?.querySelector('#condFeedInVal2Wrap'); if (v2wrap) v2wrap.style.display = 'inline';
                        const v2 = modal?.querySelector('#condFeedInVal2'); if (v2) v2.value = conditions.feedInPrice.value2 ?? 0;
                    }
                }
                if (conditions.buyPrice) {
                    const el = modal?.querySelector('#condBuyEnabled'); if (el) el.checked = conditions.buyPrice.enabled || false;
                    const buyOper = conditions.buyPrice.operator || conditions.buyPrice.op || '<';
                    const op = modal?.querySelector('#condBuyOp'); if (op) op.value = buyOper;
                    const val = modal?.querySelector('#condBuyVal'); if (val) val.value = conditions.buyPrice.value || 0;
                    if (buyOper === 'between') {
                        const v2wrap = modal?.querySelector('#condBuyVal2Wrap'); if (v2wrap) v2wrap.style.display = 'inline';
                        const v2 = modal?.querySelector('#condBuyVal2'); if (v2) v2.value = conditions.buyPrice.value2 ?? 0;
                    }
                }
                if (conditions.soc) {
                    const el = modal?.querySelector('#condSocEnabled'); if (el) el.checked = conditions.soc.enabled || false;
                    const socOper = conditions.soc.operator || conditions.soc.op || '>';
                    const op = modal?.querySelector('#condSocOp'); if (op) op.value = socOper;
                    const val = modal?.querySelector('#condSocVal'); if (val) val.value = conditions.soc.value || 50;
                    if (socOper === 'between') {
                        const v2wrap = modal?.querySelector('#condSocVal2Wrap'); if (v2wrap) v2wrap.style.display = 'inline';
                        const v2 = modal?.querySelector('#condSocVal2'); if (v2) v2.value = conditions.soc.value2 ?? 80;
                    }
                }
                const tempCondition = conditions.temperature || conditions.temp;
                if (tempCondition) {
                    const el = modal?.querySelector('#condTempEnabled'); if (el) el.checked = tempCondition.enabled || false;
                    const tp = modal?.querySelector('#condTempType'); if (tp) tp.value = tempCondition.type || 'battery';
                    const op = modal?.querySelector('#condTempOp'); if (op) op.value = tempCondition.operator || tempCondition.op || '<';
                    const val = modal?.querySelector('#condTempVal'); if (val) val.value = tempCondition.value || 40;
                    const dayOffset = modal?.querySelector('#condTempDayOffset'); if (dayOffset) dayOffset.value = tempCondition.dayOffset || 0;
                    updateTemperatureConditionUI(modal);
                }
                // Solar Radiation condition
                if (conditions.solarRadiation) {
                    const el = modal?.querySelector('#condSolarEnabled'); if (el) el.checked = conditions.solarRadiation.enabled || false;
                    const chk = modal?.querySelector('#condSolarCheck'); if (chk) chk.value = conditions.solarRadiation.checkType || 'average';
                    const op = modal?.querySelector('#condSolarOp'); if (op) op.value = conditions.solarRadiation.operator || '>';
                    const val = modal?.querySelector('#condSolarVal'); if (val) val.value = conditions.solarRadiation.value || 300;
                    const la = modal?.querySelector('#condSolarLookAhead'); if (la) la.value = conditions.solarRadiation.lookAhead || 6;
                    const lau = modal?.querySelector('#condSolarLookAheadUnit'); if (lau) lau.value = conditions.solarRadiation.lookAheadUnit || 'hours';
                }
                // Cloud Cover condition
                if (conditions.cloudCover) {
                    const el = modal?.querySelector('#condCloudEnabled'); if (el) el.checked = conditions.cloudCover.enabled || false;
                    const chk = modal?.querySelector('#condCloudCheck'); if (chk) chk.value = conditions.cloudCover.checkType || 'average';
                    const op = modal?.querySelector('#condCloudOp'); if (op) op.value = conditions.cloudCover.operator || '<';
                    const val = modal?.querySelector('#condCloudVal'); if (val) val.value = conditions.cloudCover.value || 50;
                    const la = modal?.querySelector('#condCloudLookAhead'); if (la) la.value = conditions.cloudCover.lookAhead || 6;
                    const lau = modal?.querySelector('#condCloudLookAheadUnit'); if (lau) lau.value = conditions.cloudCover.lookAheadUnit || 'hours';
                }
                if (conditions.forecastPrice) {
                    const el = modal?.querySelector('#condForecastEnabled'); if (el) el.checked = conditions.forecastPrice.enabled || false;
                    const tp = modal?.querySelector('#condForecastType'); if (tp) tp.value = conditions.forecastPrice.type || 'feedIn';
                    const chk = modal?.querySelector('#condForecastCheck'); if (chk) chk.value = conditions.forecastPrice.checkType || 'average';
                    const op = modal?.querySelector('#condForecastOp'); if (op) op.value = conditions.forecastPrice.operator || '>';
                    const val = modal?.querySelector('#condForecastVal'); if (val) val.value = conditions.forecastPrice.value || 0;
                    const la = modal?.querySelector('#condForecastLookAhead'); if (la) la.value = conditions.forecastPrice.lookAhead || 1;
                    const lau = modal?.querySelector('#condForecastLookAheadUnit'); if (lau) lau.value = conditions.forecastPrice.lookAheadUnit || 'hours';
                    updateForecastLookAheadRange();
                }
                const timeCondition = conditions.time || conditions.timeWindow;
                if (timeCondition && modal) {
                    const timeEnabledEl = modal.querySelector('#condTimeEnabled');
                    const timeStartEl = modal.querySelector('#condTimeStart');
                    const timeEndEl = modal.querySelector('#condTimeEnd');
                    
                    if (timeEnabledEl) timeEnabledEl.checked = timeCondition.enabled || false;
                    if (timeStartEl) timeStartEl.value = timeCondition.startTime || timeCondition.start || '06:00';
                    if (timeEndEl) timeEndEl.value = timeCondition.endTime || timeCondition.end || '18:00';
                    setSelectedTimeConditionDays(modal, timeCondition.days || []);
                }
                
                // Fill in action
                const action = rule.action || {};
                document.getElementById('newRuleWorkMode').value = action.workMode || 'SelfUse';
                document.getElementById('newRuleDuration').value = action.durationMinutes || 30;
                document.getElementById('newRuleFdPwr').value = action.fdPwr || 0;
                const editMinSoc = action.minSocOnGrid || 20;
                const editFdSoc = Math.max(action.fdSoc || editMinSoc, editMinSoc);
                document.getElementById('newRuleFdSoc').value = editFdSoc;
                document.getElementById('newRuleMinSoc').value = editMinSoc;
                document.getElementById('newRuleMaxSoc').value = action.maxSoc || 100;
                updateRuleMinSocFloorWarning();
                updateRulePlainEnglishSummary(modal);
                
                // Change button text
                const createBtn = modal?.querySelector('button[onclick="createBackendRule()"]');
                if (createBtn) createBtn.textContent = 'Save Changes';
            } catch (e) {
                alert('Error loading rule: ' + e.message);
            }
        }
        
        async function deleteBackendRule(ruleName) {
            if (!confirm(`Delete rule "${ruleName}"? This cannot be undone.`)) return;
            
            try {
                const resp = await authenticatedFetch('/api/automation/rule/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ruleName })
                });
                const data = await resp.json();
                
                if (data.errno === 0) {
                    // Trigger an immediate cycle to clear any segments from the deleted rule
                    console.log(`[Automation] Rule ${ruleName} deleted - triggering immediate cycle to clear segments`);
                    try {
                        const cycleResp = await authenticatedFetch('/api/automation/cycle', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({})
                        });
                        const cycleData = await cycleResp.json();
                        if (cycleData.errno === 0) {
                            console.log('[Automation] Cycle complete - segments cleared if rule was active');
                        }
                    } catch (cycleErr) {
                        console.warn('[Automation] Failed to run cycle after deleting rule:', cycleErr);
                    }
                    
                    loadBackendAutomationStatus();
                } else {
                    alert('Failed to delete rule: ' + (data.error || 'Unknown error'));
                }
            } catch (e) {
                alert('Error deleting rule: ' + e.message);
            }
        }

        // Toggle backend automation on/off
        async function toggleBackendAutomation() {
            try {
                const statusResp = await authenticatedFetch('/api/automation/status');
                const statusData = await statusResp.json();
                const currentEnabled = statusData.result?.enabled || false;
                
                const resp = await authenticatedFetch('/api/automation/enable', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled: !currentEnabled })
                });
                const data = await resp.json();
                if (data.errno === 0) {
                    // Refresh status immediately to show updated state
                    await loadBackendAutomationStatus();
                    
                    // Force an immediate cycle when toggling (to clear segments when disabling,
                    // or trigger rules when enabling)
                    console.log(`[Automation] Master switch toggled to ${data.result.enabled ? 'ENABLED' : 'DISABLED'} - triggering immediate cycle`);
                    try {
                        const cycleResp = await authenticatedFetch('/api/automation/cycle', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({})
                        });
                        const cycleData = await cycleResp.json();
                        if (cycleData.errno === 0) {
                            console.log('[Automation] Cycle result:', cycleData.result);
                            // Refresh status to show updated state
                            await loadBackendAutomationStatus();
                            
                            // Update scheduler warning if present
                            if (typeof checkAutomationStatusForScheduler === 'function') {
                                checkAutomationStatusForScheduler();
                            }
                            
                            if (data.result.enabled) {
                                showMessage('success', '✅ Automation enabled', 2000);
                            } else {
                                showMessage('success', '🔆 Automation disabled and segments cleared', 3000);
                            }
                        }
                    } catch (cycleError) {
                        console.error('[Automation] Error running cycle:', cycleError);
                        showMessage('warning', `Automation ${data.result.enabled ? 'enabled' : 'disabled'} but cycle failed`, 3000);
                    }
                }
            } catch (e) {
                console.error('Failed to toggle backend automation:', e);
                showMessage('error', 'Failed to toggle automation', 2000);
            }
        }

        // Update a backend rule setting
        async function updateBackendRule(ruleName, field, value) {
            try {
                const body = { ruleName };
                body[field] = field === 'enabled' ? !!value : (field === 'threshold' ? parseFloat(value) : parseInt(value));
                
                const resp = await authenticatedFetch('/api/automation/rule/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const data = await resp.json();
                if (data.errno === 0) {
                    console.log(`Rule ${ruleName} updated:`, data.result);
                    
                    // If disabling a rule, trigger an immediate cycle to clear any active segments
                    if (field === 'enabled' && value === false) {
                        console.log(`[Automation] Rule ${ruleName} disabled - triggering immediate cycle to clear segments`);
                        try {
                            const cycleResp = await authenticatedFetch('/api/automation/cycle', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({})
                            });
                            const cycleData = await cycleResp.json();
                            if (cycleData.errno === 0) {
                                console.log('[Automation] Cycle complete - segments cleared if rule was active');
                            }
                        } catch (cycleErr) {
                            console.warn('[Automation] Failed to run cycle after disabling rule:', cycleErr);
                        }
                    }
                    
                    // Refresh UI to show current state
                    loadBackendAutomationStatus();
                }
            } catch (e) {
                console.error('Failed to update backend rule:', e);
            }
        }

        // Update a backend rule action parameter
        async function updateBackendRuleAction(ruleName, field, value) {
            try {
                const body = { 
                    ruleName,
                    action: {}
                };
                // Parse value appropriately
                if (field === 'workMode') {
                    body.action[field] = value;
                } else {
                    body.action[field] = parseInt(value, 10);
                }
                
                const resp = await authenticatedFetch('/api/automation/rule/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const data = await resp.json();
                if (data.errno === 0) {
                    console.log(`Rule ${ruleName} action updated:`, data.result);
                }
            } catch (e) {
                console.error('Failed to update backend rule action:', e);
            }
        }

        // Test trigger a backend rule manually
        async function testBackendRule(ruleName) {
            if (!confirm(`Manually trigger the "${ruleName}" rule? This will immediately apply the automation action.`)) return;
            
            try {
                const resp = await authenticatedFetch('/api/automation/trigger', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ruleName })
                });
                const data = await resp.json();
                
                // Show result
                const resultEl = document.getElementById('result');
                const statusBar = document.getElementById('status-bar');
                if (panelCollapsed) togglePanel();
                statusBar.style.display = 'flex';
                statusBar.querySelector('.endpoint').textContent = `Automation Trigger - ${ruleName}`;
                resultEl.className = data.errno === 0 ? 'success' : 'error';
                resultEl.textContent = JSON.stringify(data, null, 2);
                
                // Reload status to show updated lastTriggered
                loadBackendAutomationStatus();
                // Also reload scheduler to see the changes
                setTimeout(loadSchedulerSegments, 1000);
            } catch (e) {
                console.error('Failed to trigger rule:', e);
                alert('Failed to trigger rule: ' + e.message);
            }
        }

        // Reset backend automation cooldowns
        async function resetBackendAutomation() {
            try {
                const resp = await authenticatedFetch('/api/automation/reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                const data = await resp.json();
                if (data.errno === 0) {
                    loadBackendAutomationStatus();
                }
            } catch (e) {
                console.error('Failed to reset automation:', e);
            }
        }

        function saveAutomationRules() {
            try {
                localStorage.setItem('automationRules', JSON.stringify(automationRules));
                localStorage.setItem('automationEnabled', automationEnabled.toString());
            } catch (e) {
                console.error('Failed to save automation rules:', e);
            }
        }

        function toggleAutomation() {
            automationEnabled = !automationEnabled;
            saveAutomationRules();
            updateAutomationToggle();
        }

        function updateAutomationToggle() {
            // Some builds may not include the legacy DOM elements (automationToggle, automationStatusText)
            // guard access so missing nodes do not throw and break the rest of the page JS.
            const toggle = document.getElementById('automationToggle');
            const text = document.getElementById('automationStatusText');

            if (toggle) {
                try {
                    if (automationEnabled) toggle.classList.add('active');
                    else toggle.classList.remove('active');
                } catch (e) { console.warn('updateAutomationToggle toggle update failed:', e); }
            }

            if (text) {
                try {
                    text.textContent = automationEnabled ? 'Enabled' : 'Disabled';
                    if (automationEnabled) text.classList.add('active');
                    else text.classList.remove('active');
                } catch (e) { console.warn('updateAutomationToggle text update failed:', e); }
            }
        }

        function renderRules() {
            const container = document.getElementById('rulesContainer');
            const emptyMsg = document.getElementById('emptyRulesMessage');
            
            if (!container) return;

            // Clear existing rule cards (keep empty message and add button)
            const existingCards = container.querySelectorAll('.rule-card');
            existingCards.forEach(card => card.remove());
            
            if (automationRules.length === 0) {
                emptyMsg.style.display = 'block';
            } else {
                emptyMsg.style.display = 'none';
                
                // Sort by priority
                const sortedRules = [...automationRules].sort((a, b) => (a.priority || 3) - (b.priority || 3));
                
                sortedRules.forEach(rule => {
                    const card = createRuleCard(rule);
                    container.insertBefore(card, container.querySelector('.add-rule-card'));
                });
            }
        }

        function createRuleCard(rule) {
            const card = document.createElement('div');
            card.className = `rule-card ${rule.enabled === false ? 'disabled' : ''}`;
            card.dataset.ruleId = rule.id;
            
            // Build conditions display
            let conditionsHtml = '';
            if (rule.conditions) {
                if (rule.conditions.price && rule.conditions.price.enabled) {
                    const p = rule.conditions.price;
                    const typeLabel = p.type === 'feedin' ? 'Feed-in' : 'Buy';
                    const pOper = p.op || p.operator || '<';
                    let valueStr = pOper === 'between' ? `${p.value}¢ – ${p.value2}¢` : `${pOper} ${p.value}¢`;
                    conditionsHtml += `<span class="condition-tag price">💰 ${typeLabel} ${valueStr}</span>`;
                }
                if (rule.conditions.soc && rule.conditions.soc.enabled) {
                    const s = rule.conditions.soc;
                    const sOper = s.op || s.operator || '<';
                    let valueStr = sOper === 'between' ? `${s.value}% – ${s.value2}%` : `${sOper} ${s.value}%`;
                    conditionsHtml += `<span class="condition-tag soc">🔋 SoC ${valueStr}</span>`;
                }
                if (rule.conditions.temp && rule.conditions.temp.enabled) {
                    const t = rule.conditions.temp;
                    const tOper = t.op || t.operator || '<';
                    let valueStr = tOper === 'between' ? `${t.value}°C – ${t.value2}°C` : `${tOper} ${t.value}°C`;
                    conditionsHtml += `<span class="condition-tag temp">🌡️ Temp ${valueStr}</span>`;
                }
                if (rule.conditions.weather && rule.conditions.weather.enabled) {
                    const w = rule.conditions.weather;
                    conditionsHtml += `<span class="condition-tag weather">🌤️ ${w.type || 'Any'}</span>`;
                }
                if (rule.conditions.time && rule.conditions.time.enabled) {
                    const tm = rule.conditions.time;
                    const startTime = tm.start || tm.startTime || '00:00';
                    const endTime = tm.end || tm.endTime || '23:59';
                    const dayLabel = formatTimeConditionDays(tm.days);
                    const daySuffix = dayLabel === 'Every day' ? '' : ` [${dayLabel}]`;
                    conditionsHtml += `<span class="condition-tag weather">🕐 ${startTime} - ${endTime}${daySuffix}</span>`;
                }
            }
            if (!conditionsHtml) {
                conditionsHtml = '<span style="color:var(--text-muted);font-size:12px">No conditions set</span>';
            }
            
            // Build actions display
            let actionsHtml = '';
            if (rule.action) {
                if (rule.action.workMode) {
                    const modeClass = rule.action.workMode === 'ForceCharge' ? 'charge' : 
                                     rule.action.workMode === 'ForceDischarge' ? 'discharge' : 
                                     rule.action.workMode === 'Feedin' ? 'feedin' : '';
                    actionsHtml += `<span class="action-tag ${modeClass}">⚡ ${rule.action.workMode}</span>`;
                }
                if (rule.action.minSoC) {
                    actionsHtml += `<span class="action-tag">Min ${rule.action.minSoC}%</span>`;
                }
                if (rule.action.maxSoC) {
                    actionsHtml += `<span class="action-tag">Max ${rule.action.maxSoC}%</span>`;
                }
            }
            if (!actionsHtml) {
                actionsHtml = '<span style="color:var(--text-muted);font-size:12px">No action set</span>';
            }
            
            card.innerHTML = `
                <div class="rule-card-header">
                    <div class="rule-card-title">
                        <span style="font-size:11px;color:var(--text-secondary);background:rgba(0,0,0,0.3);padding:2px 6px;border-radius:4px">P${rule.priority || 3}</span>
                        ${rule.name || 'Unnamed Rule'}
                    </div>
                    <div class="rule-card-actions">
                        <button onclick="toggleRuleEnabled('${rule.id}')" title="${rule.enabled !== false ? 'Disable' : 'Enable'}">
                            ${rule.enabled !== false ? '✓' : '○'}
                        </button>
                        <button onclick="editRule('${rule.id}')" title="Edit">✏️</button>
                        <button class="delete" onclick="deleteRule('${rule.id}')" title="Delete">🗑️</button>
                    </div>
                </div>
                <div class="rule-card-body">
                    <div class="rule-conditions">
                        <div class="rule-section-label">📋 When</div>
                        <div>${conditionsHtml}</div>
                    </div>
                    <div class="rule-actions-box">
                        <div class="rule-section-label">⚡ Then</div>
                        <div>${actionsHtml}</div>
                    </div>
                </div>
            `;
            
            return card;
        }

        function openRuleModal(ruleId = null) {
            const modal = document.getElementById('ruleModal');
            const title = document.getElementById('ruleModalTitle');
            const form = document.getElementById('ruleForm');
            
            // Reset form
            form.reset();
            document.getElementById('ruleId').value = '';
            
            // Reset all condition items
            ['Price', 'SoC', 'Temp', 'Weather', 'Time'].forEach(cond => {
                document.getElementById(`cond${cond}Enabled`).checked = false;
                document.getElementById(`condition${cond}`).classList.remove('active');
            });
            
            // Hide "between" value2 fields
            ['condPriceValue2Row', 'condSoCValue2Row', 'condTempValue2Row'].forEach(id => {
                document.getElementById(id).style.display = 'none';
            });
            
            if (ruleId) {
                // Edit existing rule
                title.textContent = 'Edit Automation Rule';
                const rule = automationRules.find(r => r.id === ruleId);
                if (rule) {
                    populateRuleForm(rule);
                }
            } else {
                title.textContent = 'Create Automation Rule';
            }
            
            modal.classList.add('show');
            syncAutomationToggleVisibility();
        }

        function closeRuleModal() {
            document.getElementById('ruleModal').classList.remove('show');
            syncAutomationToggleVisibility();
        }

        function populateRuleForm(rule) {
            document.getElementById('ruleId').value = rule.id;
            document.getElementById('ruleName').value = rule.name || '';
            document.getElementById('rulePriority').value = rule.priority || 3;
            
            // Populate conditions
            if (rule.conditions) {
                if (rule.conditions.price) {
                    const p = rule.conditions.price;
                    document.getElementById('condPriceEnabled').checked = p.enabled;
                    if (p.enabled) document.getElementById('conditionPrice').classList.add('active');
                    document.getElementById('condPriceType').value = p.type || 'buy';
                    const priceOper = p.op || p.operator || '<';
                    document.getElementById('condPriceOp').value = priceOper;
                    document.getElementById('condPriceValue').value = p.value || '';
                    if (priceOper === 'between') {
                        document.getElementById('condPriceValue2Row').style.display = 'flex';
                        document.getElementById('condPriceValue2').value = p.value2 ?? '';
                    }
                }
                if (rule.conditions.soc) {
                    const s = rule.conditions.soc;
                    document.getElementById('condSoCEnabled').checked = s.enabled;
                    if (s.enabled) document.getElementById('conditionSoC').classList.add('active');
                    const socOper = s.op || s.operator || '<';
                    document.getElementById('condSoCOp').value = socOper;
                    document.getElementById('condSoCValue').value = s.value || '';
                    if (socOper === 'between') {
                        document.getElementById('condSoCValue2Row').style.display = 'flex';
                        document.getElementById('condSoCValue2').value = s.value2 ?? '';
                    }
                }
                if (rule.conditions.temp) {
                    const t = rule.conditions.temp;
                    document.getElementById('condTempEnabled').checked = t.enabled;
                    if (t.enabled) document.getElementById('conditionTemp').classList.add('active');
                    const tempOper = t.op || t.operator || '<';
                    document.getElementById('condTempOp').value = tempOper;
                    document.getElementById('condTempValue').value = t.value || '';
                    if (tempOper === 'between') {
                        document.getElementById('condTempValue2Row').style.display = 'flex';
                        document.getElementById('condTempValue2').value = t.value2 ?? '';
                    }
                }
                if (rule.conditions.weather) {
                    const w = rule.conditions.weather;
                    document.getElementById('condWeatherEnabled').checked = w.enabled;
                    if (w.enabled) document.getElementById('conditionWeather').classList.add('active');
                    document.getElementById('condWeatherType').value = w.type || 'any';
                    document.getElementById('condWeatherSolarOp').value = w.solarOp || 'any';
                    document.getElementById('condWeatherSolarValue').value = w.solarValue || '';
                }
                if (rule.conditions.time) {
                    const tm = rule.conditions.time;
                    document.getElementById('condTimeEnabled').checked = tm.enabled;
                    if (tm.enabled) document.getElementById('conditionTime').classList.add('active');
                    document.getElementById('condTimeStart').value = tm.start || '00:00';
                    document.getElementById('condTimeEnd').value = tm.end || '23:59';
                }
            }
            
            // Populate actions
            if (rule.action) {
                document.getElementById('actionWorkMode').value = rule.action.workMode || '';
                document.getElementById('actionMinSoC').value = rule.action.minSoC || '';
                document.getElementById('actionMaxSoC').value = rule.action.maxSoC || '';
                document.getElementById('actionFdPwr').value = rule.action.fdPwr || '';
            }
        }

        function toggleCondition(condName) {
            const checkbox = document.getElementById(`cond${condName}Enabled`);
            const item = document.getElementById(`condition${condName}`);
            if (!item || !checkbox) return;
            
            if (checkbox.checked) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        }

        // Handle operator change to show/hide between value2 field
        document.addEventListener('DOMContentLoaded', () => {
            ['Price', 'SoC', 'Temp'].forEach(cond => {
                const opSelect = document.getElementById(`cond${cond}Op`);
                const value2Row = document.getElementById(`cond${cond}Value2Row`);
                if (opSelect && value2Row) {
                    opSelect.addEventListener('change', () => {
                        value2Row.style.display = opSelect.value === 'between' ? 'flex' : 'none';
                    });
                }
            });
            // Allow pressing Enter in the location input to trigger Get Forecast
            try {
                const wInput = document.getElementById('weatherPlace');
                if (wInput) {
                    // Mark as actively typing when user types (preserves their input during session)
                    wInput.addEventListener('input', () => {
                        window.sessionStorage.setItem('weatherInputActive', 'true');
                    });
                    wInput.addEventListener('keydown', (ev) => {
                        if (ev.key === 'Enter') {
                            ev.preventDefault();
                            try { getWeather(); } catch(e) { /* ignore */ }
                        }
                    });
                }
            } catch(e) { /* ignore */ }
        });

        function saveRule() {
            const ruleId = document.getElementById('ruleId').value;
            const ruleName = document.getElementById('ruleName').value.trim();
            
            // Validate rule name
            if (!ruleName) {
                alert('❌ Please enter a rule name');
                return;
            }
            if (ruleName.length < 3) {
                alert('❌ Rule name must be at least 3 characters');
                return;
            }
            if (ruleName.length > 100) {
                alert('❌ Rule name must be less than 100 characters');
                return;
            }
            
            // Validate at least one condition is enabled
            const condPriceEnabled = document.getElementById('condPriceEnabled').checked;
            const condSoCEnabled = document.getElementById('condSoCEnabled').checked;
            const condTempEnabled = document.getElementById('condTempEnabled').checked;
            const condWeatherEnabled = document.getElementById('condWeatherEnabled').checked;
            const condTimeEnabled = document.getElementById('condTimeEnabled').checked;
            
            if (!condPriceEnabled && !condSoCEnabled && !condTempEnabled && !condWeatherEnabled && !condTimeEnabled) {
                alert('❌ Please enable at least one condition');
                return;
            }
            
            // Validate enabled conditions
            if (condPriceEnabled) {
                const priceValue = parseFloat(document.getElementById('condPriceValue').value);
                const priceOp = document.getElementById('condPriceOp').value;
                const priceValue2 = parseFloat(document.getElementById('condPriceValue2').value);
                
                if (isNaN(priceValue) || priceValue < 0 || priceValue > 100) {
                    alert('❌ Price value must be between 0 and 100 ¢');
                    document.getElementById('condPriceValue').focus();
                    return;
                }
                if (priceOp === 'between') {
                    if (isNaN(priceValue2) || priceValue2 < 0 || priceValue2 > 100) {
                        alert('❌ Price range end value must be between 0 and 100 ¢');
                        document.getElementById('condPriceValue2').focus();
                        return;
                    }
                    if (priceValue >= priceValue2) {
                        alert('❌ Price range: first value must be less than second value');
                        return;
                    }
                }
            }
            
            if (condSoCEnabled) {
                const socValue = parseInt(document.getElementById('condSoCValue').value);
                const socOp = document.getElementById('condSoCOp').value;
                const socValue2 = parseInt(document.getElementById('condSoCValue2').value);
                
                if (isNaN(socValue) || socValue < 0 || socValue > 100) {
                    alert('❌ SoC value must be between 0% and 100%');
                    document.getElementById('condSoCValue').focus();
                    return;
                }
                if (socOp === 'between') {
                    if (isNaN(socValue2) || socValue2 < 0 || socValue2 > 100) {
                        alert('❌ SoC range end value must be between 0% and 100%');
                        document.getElementById('condSoCValue2').focus();
                        return;
                    }
                    if (socValue >= socValue2) {
                        alert('❌ SoC range: first value must be less than second value');
                        return;
                    }
                }
            }
            
            if (condTempEnabled) {
                const tempValue = parseInt(document.getElementById('condTempValue').value);
                const tempOp = document.getElementById('condTempOp').value;
                const tempValue2 = parseInt(document.getElementById('condTempValue2').value);
                
                if (isNaN(tempValue) || tempValue < -20 || tempValue > 80) {
                    alert('❌ Temperature must be between -20°C and 80°C');
                    document.getElementById('condTempValue').focus();
                    return;
                }
                if (tempOp === 'between') {
                    if (isNaN(tempValue2) || tempValue2 < -20 || tempValue2 > 80) {
                        alert('❌ Temperature range end must be between -20°C and 80°C');
                        document.getElementById('condTempValue2').focus();
                        return;
                    }
                    if (tempValue >= tempValue2) {
                        alert('❌ Temperature range: first value must be less than second value');
                        return;
                    }
                }
            }
            
            // Validate time window if enabled
            if (condTimeEnabled) {
                const timeStart = document.getElementById('condTimeStart').value;
                const timeEnd = document.getElementById('condTimeEnd').value;
                
                if (!timeStart || !timeEnd) {
                    alert('❌ Please set both start and end times for time window');
                    return;
                }
                if (timeStart >= timeEnd) {
                    alert('❌ Start time must be before end time');
                    return;
                }
            }
            
            // Validate action fields
            const actionWorkMode = document.getElementById('actionWorkMode').value;
            const actionMinSoC = document.getElementById('actionMinSoC').value;
            const actionMaxSoC = document.getElementById('actionMaxSoC').value;
            const actionFdPwr = document.getElementById('actionFdPwr').value;
            
            if (!actionWorkMode && !actionMinSoC && !actionMaxSoC && !actionFdPwr) {
                alert('❌ Please configure at least one action (Work Mode or settings)');
                return;
            }
            
            if (actionMinSoC) {
                const minSoC = parseInt(actionMinSoC);
                if (isNaN(minSoC) || minSoC < 0 || minSoC > 100) {
                    alert('❌ Min SoC must be between 0% and 100%');
                    document.getElementById('actionMinSoC').focus();
                    return;
                }
            }
            
            if (actionMaxSoC) {
                const maxSoC = parseInt(actionMaxSoC);
                if (isNaN(maxSoC) || maxSoC < 0 || maxSoC > 100) {
                    alert('❌ Max SoC must be between 0% and 100%');
                    document.getElementById('actionMaxSoC').focus();
                    return;
                }
            }
            
            if (actionMinSoC && actionMaxSoC) {
                const minSoC = parseInt(actionMinSoC);
                const maxSoC = parseInt(actionMaxSoC);
                if (minSoC >= maxSoC) {
                    alert('❌ Min SoC must be less than Max SoC');
                    return;
                }
            }
            
            if (actionFdPwr) {
                const maxRulePowerW = getEffectiveInverterCapacityW();
                const fdPwr = parseInt(actionFdPwr);
                if (isNaN(fdPwr) || fdPwr < 0 || fdPwr > maxRulePowerW) {
                    alert(`❌ Power must be between 0W and ${maxRulePowerW}W`);
                    document.getElementById('actionFdPwr').focus();
                    return;
                }
            }
            
            const rule = {
                id: ruleId || 'rule_' + Date.now(),
                name: ruleName,
                enabled: true,
                priority: parseInt(document.getElementById('rulePriority').value) || 3,
                conditions: {
                    price: {
                        enabled: document.getElementById('condPriceEnabled').checked,
                        type: document.getElementById('condPriceType').value,
                        op: document.getElementById('condPriceOp').value,
                        value: parseFloat(document.getElementById('condPriceValue').value) || null,
                        value2: parseFloat(document.getElementById('condPriceValue2').value) || null
                    },
                    soc: {
                        enabled: document.getElementById('condSoCEnabled').checked,
                        op: document.getElementById('condSoCOp').value,
                        value: parseInt(document.getElementById('condSoCValue').value) || null,
                        value2: parseInt(document.getElementById('condSoCValue2').value) || null
                    },
                    temp: {
                        enabled: document.getElementById('condTempEnabled').checked,
                        op: document.getElementById('condTempOp').value,
                        value: parseInt(document.getElementById('condTempValue').value) || null,
                        value2: parseInt(document.getElementById('condTempValue2').value) || null
                    },
                    weather: {
                        type: document.getElementById('condWeatherType').value,
                        solarOp: document.getElementById('condWeatherSolarOp').value,
                        solarValue: parseFloat(document.getElementById('condWeatherSolarValue').value) || null
                    },
                    time: {
                        enabled: document.getElementById('condTimeEnabled').checked,
                        start: document.getElementById('condTimeStart').value,
                        end: document.getElementById('condTimeEnd').value
                    }
                },
                action: {
                    workMode: document.getElementById('actionWorkMode').value || null,
                    minSoC: parseInt(document.getElementById('actionMinSoC').value) || null,
                    maxSoC: parseInt(document.getElementById('actionMaxSoC').value) || null,
                    fdPwr: parseInt(document.getElementById('actionFdPwr').value) || null
                }
            };
            
            // Update or add rule
            if (ruleId) {
                const idx = automationRules.findIndex(r => r.id === ruleId);
                if (idx !== -1) {
                    rule.enabled = automationRules[idx].enabled; // Preserve enabled state
                    automationRules[idx] = rule;
                }
            } else {
                automationRules.push(rule);
            }
            
            saveAutomationRules();
            renderRules();
            closeRuleModal();
        }

        function editRule(ruleId) {
            openRuleModal(ruleId);
        }

        function deleteRule(ruleId) {
            if (!confirm('Delete this rule?')) return;
            automationRules = automationRules.filter(r => r.id !== ruleId);
            saveAutomationRules();
            renderRules();
        }

        function toggleRuleEnabled(ruleId) {
            const rule = automationRules.find(r => r.id === ruleId);
            if (rule) {
                rule.enabled = rule.enabled === false ? true : false;
                saveAutomationRules();
                renderRules();
            }
        }

        AppShell.init({
            pageName: 'overview',
            autoMetrics: false,
            onReady: () => {
                try { TourEngine.init(window.apiClient); TourEngine.resume(); } catch(e) {}
                try { 
                    bindEVOverviewControls();
                    refreshDashboardCardVisibilityPreferencesForCurrentUser();
                    initializePageData(); 
                    checkAutomationStatusForScheduler(); // Check automation status for scheduler warning
                    refreshQuickControlStatus(); // Check quick control status
                } catch (err) { console.error('Failed to initialize dashboard', err); }
            }
        });

        // Re-check automation status when page becomes visible (handles toggle from another tab/page)
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                if (typeof checkAutomationStatusForScheduler === 'function') {
                    checkAutomationStatusForScheduler();
                }
                if (typeof refreshQuickControlStatus === 'function') {
                    refreshQuickControlStatus();
                }
                if (typeof refreshEVOverview === 'function') {
                    refreshEVOverview(false);
                }
            }
        });
