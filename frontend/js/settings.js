
        // Settings page loaded
        let currentConfig = {};
        let originalConfig = {};
        let hasUnsavedChanges = false;
        let originalCredentials = {}; // Track original credential values separately
        
        AppShell.init({
            pageName: 'settings',
            onReady: () => {
                try { TourEngine.init(window.apiClient); TourEngine.resume(); } catch(e) {}
                try {
                    bindTeslaOnboardingHandlers();
                    updateTeslaRedirectUriInput();
                    updateTeslaRegionHelp();
                    syncTeslaPendingAuthControls();
                    loadSettings();
                } catch (error) {
                    console.warn('[Settings] loadSettings failed to start', error);
                }
            }
        });
        
        // Toggle FAQ section visibility
        function toggleFaq(element) {
            element.classList.toggle('open');
            const content = element.nextElementSibling;
            if (content) {
                content.classList.toggle('open');
            }
        }

        const TIMING_INPUT_IDS = new Set([
            'automation_intervalMs',
            'cache_amber',
            'cache_inverter',
            'cache_weather',
            'cache_teslaStatus'
        ]);

        const TESLA_OAUTH_PENDING_KEY = 'teslaOauthPending';
        const TESLA_OAUTH_PENDING_TTL_MS = 20 * 60 * 1000;
        const TESLA_RECENT_CONNECTION_HIGHLIGHT_MS = 10 * 60 * 1000;
        const TESLA_REGION_DEFAULT = 'na';
        const TESLA_REGION_HELP = Object.freeze({
            na: 'Use North America + Asia-Pacific for the United States, Canada, Australia, New Zealand, Japan, South Korea, and most Tesla accounts outside Europe, Africa, the Middle East, and China.',
            eu: 'Use Europe, Middle East + Africa for Tesla accounts based in those regions.',
            cn: 'Use China for Mainland China Tesla accounts.'
        });
        const TESLA_VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/i;
        let teslaOnboardingHandlersBound = false;
        let teslaRecentlyConnectedVin = '';
        let teslaRecentlyConnectedAtMs = 0;
        let teslaVehiclesState = [];

        function normalizeTeslaVin(vin) {
            const normalized = String(vin || '').trim().toUpperCase();
            return TESLA_VIN_REGEX.test(normalized) ? normalized : '';
        }

        function getTeslaOnboardingElements() {
            return {
                badge: document.getElementById('teslaOnboardingBadge'),
                status: document.getElementById('teslaOnboardingStatus'),
                checkOwnershipBtn: document.getElementById('teslaCheckOwnershipBtn'),
                connectBtn: document.getElementById('teslaConnectBtn'),
                addVehicleBtn: document.getElementById('teslaAddVehicleBtn'),
                clearPendingBtn: document.getElementById('teslaClearPendingBtn'),
                refreshBtn: document.getElementById('teslaRefreshVehiclesBtn'),
                vehiclesList: document.getElementById('teslaVehiclesList'),
                vehicleStatusCounts: document.getElementById('teslaVehicleStatusCounts'),
                copyRedirectBtn: document.getElementById('teslaCopyRedirectBtn'),
                clientIdInput: document.getElementById('teslaClientId'),
                clientSecretInput: document.getElementById('teslaClientSecret'),
                vehicleIdInput: document.getElementById('teslaVehicleId'),
                displayNameInput: document.getElementById('teslaDisplayName'),
                regionInput: document.getElementById('teslaRegion'),
                regionHelp: document.getElementById('teslaRegionHelp'),
                redirectUriInput: document.getElementById('teslaRedirectUri')
            };
        }

        function setTeslaOnboardingBadge(label, kind = 'sync') {
            const { badge } = getTeslaOnboardingElements();
            if (!badge) return;
            badge.textContent = String(label || 'Setup Required');
            badge.className = kind === 'modified' ? 'badge badge-modified' : 'badge badge-sync';
        }

        function setTeslaOnboardingStatus(message, kind = 'muted') {
            const { status } = getTeslaOnboardingElements();
            if (!status) return;
            status.textContent = String(message || '');
            status.className = 'tesla-onboarding-status';
            if (kind === 'success') status.classList.add('is-success');
            if (kind === 'warning') status.classList.add('is-warning');
            if (kind === 'error') status.classList.add('is-error');
        }

        function getTeslaRedirectUri() {
            try {
                const url = new URL(window.location.href);
                url.search = '';
                url.hash = '';
                return `${url.origin}${url.pathname}`;
            } catch (e) {
                return `${window.location.origin}/settings.html`;
            }
        }

        function updateTeslaRedirectUriInput() {
            const { redirectUriInput } = getTeslaOnboardingElements();
            if (!redirectUriInput) return;
            redirectUriInput.value = getTeslaRedirectUri();
        }

        function getTeslaRegionHelpText(region) {
            const normalized = String(region || TESLA_REGION_DEFAULT).trim().toLowerCase();
            return TESLA_REGION_HELP[normalized] || TESLA_REGION_HELP[TESLA_REGION_DEFAULT];
        }

        function updateTeslaRegionHelp() {
            const { regionInput, regionHelp } = getTeslaOnboardingElements();
            if (!regionHelp) return;
            regionHelp.textContent = getTeslaRegionHelpText(regionInput?.value);
        }

        async function copyTeslaRedirectUri() {
            const { redirectUriInput } = getTeslaOnboardingElements();
            const redirectUri = String(redirectUriInput?.value || getTeslaRedirectUri()).trim();
            if (!redirectUri) return;

            const fallbackCopy = () => {
                const temp = document.createElement('textarea');
                temp.value = redirectUri;
                temp.setAttribute('readonly', 'readonly');
                temp.style.position = 'absolute';
                temp.style.left = '-9999px';
                document.body.appendChild(temp);
                temp.select();
                document.execCommand('copy');
                document.body.removeChild(temp);
            };

            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(redirectUri);
                } else {
                    fallbackCopy();
                }
                setTeslaOnboardingStatus('Redirect URI copied. Paste it into Tesla Developer Dashboard before you connect.', 'success');
                showMessage('success', 'Tesla redirect URI copied');
            } catch (error) {
                setTeslaOnboardingStatus('Unable to copy the redirect URI automatically. Copy it manually from the field above.', 'warning');
                showMessage('warning', `Failed to copy Tesla redirect URI: ${error.message || error}`);
            }
        }

        function bytesToBase64Url(uint8) {
            let binary = '';
            for (let i = 0; i < uint8.length; i += 1) {
                binary += String.fromCharCode(uint8[i]);
            }
            return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
        }

        function createRandomBase64Url(byteLength = 32) {
            if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') {
                throw new Error('Secure random generator unavailable in this browser');
            }
            const bytes = new Uint8Array(byteLength);
            window.crypto.getRandomValues(bytes);
            return bytesToBase64Url(bytes);
        }

        async function createPkceCodeChallenge(codeVerifier) {
            if (!window.crypto || !window.crypto.subtle || typeof window.crypto.subtle.digest !== 'function') {
                throw new Error('WebCrypto API unavailable for PKCE challenge generation');
            }
            const encoder = new TextEncoder();
            const digest = await window.crypto.subtle.digest('SHA-256', encoder.encode(String(codeVerifier || '')));
            return bytesToBase64Url(new Uint8Array(digest));
        }

        function persistTeslaPendingOAuth(payload) {
            try {
                sessionStorage.setItem(TESLA_OAUTH_PENDING_KEY, JSON.stringify(payload || {}));
            } catch (e) {
                console.warn('[Tesla OAuth] Failed to persist pending session', e);
            }
            syncTeslaPendingAuthControls();
        }

        function clearTeslaPendingOAuth() {
            try {
                sessionStorage.removeItem(TESLA_OAUTH_PENDING_KEY);
            } catch (e) {
                console.warn('[Tesla OAuth] Failed to clear pending session', e);
            }
            syncTeslaPendingAuthControls();
        }

        function readTeslaPendingOAuth() {
            try {
                const raw = sessionStorage.getItem(TESLA_OAUTH_PENDING_KEY);
                if (!raw) return null;
                const pending = JSON.parse(raw);
                if (!pending || typeof pending !== 'object') {
                    clearTeslaPendingOAuth();
                    return null;
                }
                const startedAtMs = Number(pending.startedAtMs || 0);
                if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) {
                    clearTeslaPendingOAuth();
                    return null;
                }
                if ((Date.now() - startedAtMs) > TESLA_OAUTH_PENDING_TTL_MS) {
                    clearTeslaPendingOAuth();
                    return null;
                }
                return pending;
            } catch (e) {
                console.warn('[Tesla OAuth] Failed to read pending session', e);
                clearTeslaPendingOAuth();
                return null;
            }
        }

        function syncTeslaPendingAuthControls() {
            const { clearPendingBtn, addVehicleBtn } = getTeslaOnboardingElements();
            if (!clearPendingBtn) return;
            const pending = readTeslaPendingOAuth();
            const hasPending = Boolean(pending);
            clearPendingBtn.disabled = !hasPending;
            clearPendingBtn.textContent = hasPending ? 'Reset Tesla Login' : 'No Tesla Login Pending';
            clearPendingBtn.title = hasPending
                ? 'Clear the pending Tesla OAuth session and restart login.'
                : 'No Tesla OAuth login session is currently pending.';
            clearPendingBtn.classList.toggle('is-idle', !hasPending);
            if (addVehicleBtn) {
                addVehicleBtn.disabled = hasPending;
                addVehicleBtn.title = hasPending
                    ? 'Finish or reset the current Tesla sign-in before adding another vehicle.'
                    : 'Prepare the form to add another Tesla VIN.';
            }
        }

        function cleanTeslaOAuthParamsFromUrl() {
            try {
                const url = new URL(window.location.href);
                const keys = ['code', 'state', 'error', 'error_description', 'scope'];
                keys.forEach((key) => url.searchParams.delete(key));
                const nextUrl = `${url.pathname}${url.search}${url.hash}`;
                window.history.replaceState({}, document.title, nextUrl);
            } catch (e) {
                console.warn('[Tesla OAuth] Failed to clean URL parameters', e);
            }
        }

        function extractApiErrorMessage(resp, fallback) {
            if (!resp || typeof resp !== 'object') return fallback;
            return resp.error || resp.msg || fallback;
        }

        function getTeslaOnboardingFormValues() {
            const {
                clientIdInput,
                clientSecretInput,
                vehicleIdInput,
                displayNameInput,
                regionInput
            } = getTeslaOnboardingElements();
            return {
                clientId: (clientIdInput?.value || '').trim(),
                clientSecret: (clientSecretInput?.value || '').trim(),
                vehicleId: normalizeTeslaVin(vehicleIdInput?.value || ''),
                displayName: (displayNameInput?.value || '').trim(),
                region: String(regionInput?.value || TESLA_REGION_DEFAULT).trim() || TESLA_REGION_DEFAULT,
                redirectUri: getTeslaRedirectUri()
            };
        }

        function applyTeslaPendingValuesToInputs(pending) {
            const {
                clientIdInput,
                clientSecretInput,
                vehicleIdInput,
                displayNameInput,
                regionInput
            } = getTeslaOnboardingElements();
            if (!pending || typeof pending !== 'object') return;
            if (clientIdInput && pending.clientId) clientIdInput.value = String(pending.clientId);
            if (clientSecretInput && pending.clientSecret) clientSecretInput.value = String(pending.clientSecret);
            const pendingVin = normalizeTeslaVin(pending.vin || pending.vehicleId || '');
            if (vehicleIdInput && pendingVin) vehicleIdInput.value = pendingVin;
            if (displayNameInput && pending.displayName) displayNameInput.value = String(pending.displayName);
            if (regionInput && pending.region) regionInput.value = String(pending.region);
            updateTeslaRegionHelp();
        }

        async function ensureTeslaVehicleRegistered({ vehicleId, displayName, region }) {
            if (!window.apiClient || typeof window.apiClient.registerEVVehicle !== 'function') {
                throw new Error('API client unavailable');
            }
            const normalizedVin = normalizeTeslaVin(vehicleId);
            if (!normalizedVin) {
                throw new Error('Tesla VIN must be 17 characters');
            }
            const resp = await window.apiClient.registerEVVehicle(
                normalizedVin,
                'tesla',
                String(displayName || '').trim() || normalizedVin,
                String(region || TESLA_REGION_DEFAULT).trim() || TESLA_REGION_DEFAULT,
                { vin: normalizedVin }
            );
            if (!resp || resp.errno !== 0) {
                throw new Error(extractApiErrorMessage(resp, 'Failed to register Tesla vehicle'));
            }
        }

        async function ensureTeslaPartnerDomainRegistered({ clientId, clientSecret, redirectUri, region }) {
            if (!clientSecret) {
                return { skipped: true, reason: 'missing_client_secret' };
            }
            if (!window.apiClient || typeof window.apiClient.registerEVPartnerDomain !== 'function') {
                throw new Error('API client unavailable');
            }
            const resp = await window.apiClient.registerEVPartnerDomain(
                clientId,
                clientSecret,
                redirectUri,
                region || TESLA_REGION_DEFAULT
            );
            if (!resp || resp.errno !== 0) {
                throw new Error(extractApiErrorMessage(resp, 'Failed to register Tesla app domain with Tesla'));
            }
            return resp.result || { registered: true };
        }

        function getTeslaPartnerRegistrationWarning(registrationResult = null) {
            if (String(registrationResult?.verificationState || '').trim() !== 'unverified_conflict') {
                return '';
            }
            return 'Tesla OAuth can continue for read-only vehicle status, but this Tesla Client ID does not have access to socratesautomation.com. Phone-app pairing at tesla.com/_ak/socratesautomation.com and Tesla charging commands will not work until you use the Fleet app that originally owns that domain, or move to a separate domain and keypair.';
        }

        async function checkTeslaPartnerDomainAccess() {
            const { checkOwnershipBtn } = getTeslaOnboardingElements();
            const form = getTeslaOnboardingFormValues();

            if (!form.clientId) {
                setTeslaOnboardingBadge('Action Needed', 'modified');
                setTeslaOnboardingStatus('Paste a Tesla Fleet Client ID before checking app ownership.', 'warning');
                showMessage('warning', 'Tesla Fleet Client ID is required');
                return;
            }
            if (!form.clientSecret) {
                setTeslaOnboardingBadge('Action Needed', 'modified');
                setTeslaOnboardingStatus('Paste a Tesla Fleet Client Secret before checking app ownership.', 'warning');
                showMessage('warning', 'Tesla Fleet Client Secret is required');
                return;
            }
            if (!window.apiClient || typeof window.apiClient.checkEVPartnerDomainAccess !== 'function') {
                throw new Error('API client unavailable');
            }

            const prevButtonHtml = checkOwnershipBtn ? checkOwnershipBtn.innerHTML : '';
            if (checkOwnershipBtn) {
                checkOwnershipBtn.disabled = true;
                checkOwnershipBtn.innerHTML = '<span class="spinner"></span> Checking app...';
            }

            try {
                setTeslaOnboardingStatus('Checking whether this Tesla Fleet app owns socratesautomation.com...', 'warning');
                const resp = await window.apiClient.checkEVPartnerDomainAccess(
                    form.clientId,
                    form.clientSecret,
                    form.redirectUri,
                    form.region || TESLA_REGION_DEFAULT
                );
                const result = resp?.result || null;

                if (!resp || resp.errno !== 0 || !result) {
                    throw new Error(extractApiErrorMessage(resp, 'Failed to verify Tesla app ownership'));
                }

                if (result.accessible) {
                    setTeslaOnboardingBadge('App Verified', 'sync');
                    setTeslaOnboardingStatus('This Tesla Fleet app has access to socratesautomation.com. It is the correct app to use for SoCrates pairing and command setup.', 'success');
                    showMessage('success', 'This Tesla Fleet app owns the SoCrates domain registration');
                    return;
                }

                if (String(result.reasonCode || '').trim() === 'tesla_partner_domain_access_denied') {
                    setTeslaOnboardingBadge('Action Needed', 'modified');
                    setTeslaOnboardingStatus('This Tesla Fleet app does not own socratesautomation.com. Try another Tesla Client ID and Client Secret from your Tesla Developer account.', 'warning');
                    showMessage('warning', 'This Tesla Fleet app does not have access to socratesautomation.com');
                    return;
                }

                setTeslaOnboardingBadge('Action Needed', 'modified');
                setTeslaOnboardingStatus(result.error || 'Tesla could not confirm whether this app owns socratesautomation.com.', 'warning');
                showMessage('warning', result.error || 'Tesla could not confirm whether this app owns socratesautomation.com');
            } catch (error) {
                setTeslaOnboardingBadge('Error', 'modified');
                setTeslaOnboardingStatus(error.message || 'Failed to verify Tesla app ownership', 'error');
                showMessage('warning', `Tesla app ownership check failed: ${error.message || error}`);
            } finally {
                if (checkOwnershipBtn) {
                    checkOwnershipBtn.disabled = false;
                    checkOwnershipBtn.innerHTML = prevButtonHtml;
                }
            }
        }

        function buildTeslaVehicleStatusSummaryChips(summary = {}) {
            return [
                { key: 'connected', label: 'Connected', count: Number(summary.connected || 0) },
                { key: 'setup_required', label: 'Setup Required', count: Number(summary.setup_required || 0) },
                { key: 'action_needed', label: 'Action Needed', count: Number(summary.action_needed || 0) }
            ];
        }

        function renderTeslaVehicleStatusCounts(summary = {}) {
            const { vehicleStatusCounts } = getTeslaOnboardingElements();
            if (!vehicleStatusCounts) return;
            vehicleStatusCounts.innerHTML = '';
            const chips = buildTeslaVehicleStatusSummaryChips(summary);
            chips.forEach((chip) => {
                const el = document.createElement('div');
                el.className = `tesla-status-count-chip status-${chip.key}`;
                const label = document.createElement('span');
                label.textContent = chip.label;
                const count = document.createElement('span');
                count.className = 'count';
                count.textContent = String(chip.count);
                el.appendChild(label);
                el.appendChild(count);
                vehicleStatusCounts.appendChild(el);
            });
        }

        function isTeslaRecentConnection(vehicleVin) {
            const normalizedVin = normalizeTeslaVin(vehicleVin);
            if (!normalizedVin || !teslaRecentlyConnectedVin) return false;
            if (normalizedVin !== teslaRecentlyConnectedVin) return false;
            return (Date.now() - Number(teslaRecentlyConnectedAtMs || 0)) <= TESLA_RECENT_CONNECTION_HIGHLIGHT_MS;
        }

        function markTeslaRecentlyConnected(vehicleId) {
            const normalizedVin = normalizeTeslaVin(vehicleId);
            if (!normalizedVin) return;
            teslaRecentlyConnectedVin = normalizedVin;
            teslaRecentlyConnectedAtMs = Date.now();
        }

        function resolveTeslaVehicleUiStatus(vehicle, pendingVin = '') {
            const vehicleVin = normalizeTeslaVin(vehicle?.vin || vehicle?.vehicleId || '');
            const vehicleId = String(vehicle?.vehicleId || '').trim();
            const hasCredentials = vehicle?.hasCredentials !== false;
            const normalizedPendingVin = normalizeTeslaVin(pendingVin);
            const normalizedVehicleId = normalizeTeslaVin(vehicleId);

            if (normalizedPendingVin && (normalizedPendingVin === vehicleVin || normalizedPendingVin === normalizedVehicleId)) {
                return {
                    key: 'action_needed',
                    label: 'Action Needed',
                    detail: 'Complete Tesla sign-in approval and return here to finish setup.'
                };
            }

            if (!hasCredentials) {
                return {
                    key: 'setup_required',
                    label: 'Setup Required',
                    detail: 'Vehicle is registered, but Tesla OAuth credentials are missing.'
                };
            }

            return {
                key: 'connected',
                label: 'Connected',
                detail: 'Vehicle is connected and ready for dashboard status updates.'
            };
        }

        function describeTeslaCommandReadiness(readiness, vehicleStatusKey) {
            if (vehicleStatusKey !== 'connected') {
                return null;
            }

            const state = String(readiness?.state || '').trim();
            if (state === 'ready_direct') {
                return {
                    key: 'charging_ready',
                    label: 'Charging Ready',
                    detail: 'Dashboard charging controls can use Tesla direct commands for this vehicle.'
                };
            }
            if (state === 'ready_signed') {
                return {
                    key: 'signed_ready',
                    label: 'Signed Commands Ready',
                    detail: 'Dashboard charging controls can use Tesla signed commands for this vehicle.'
                };
            }
            if (state === 'proxy_unavailable') {
                return {
                    key: 'proxy_required',
                    label: 'Proxy Required',
                    detail: 'This Tesla requires signed commands. Configure the signed-command proxy before charging controls can be enabled.'
                };
            }
            if (state === 'setup_required') {
                if (String(readiness?.reasonCode || '').trim() === 'tesla_permission_denied') {
                    return {
                        key: 'reconnect_required',
                        label: 'Review Tesla Setup',
                        detail: 'Tesla denied access for this vehicle. Confirm the Tesla developer app has vehicle data and charging permissions, then reconnect Tesla.'
                    };
                }
                return {
                    key: 'reconnect_required',
                    label: 'Reconnect Tesla',
                    detail: 'Reconnect Tesla OAuth for this vehicle before charging controls can be enabled.'
                };
            }
            if (state === 'read_only') {
                return {
                    key: 'read_only',
                    label: 'Read Only',
                    detail: 'Status visibility is available, but Tesla charging controls are not ready for this vehicle yet.'
                };
            }
            if (state) {
                return {
                    key: 'read_only',
                    label: 'Checking Commands',
                    detail: 'Tesla command readiness is still being verified for this vehicle.'
                };
            }
            return {
                key: 'read_only',
                label: 'Command Check Pending',
                detail: 'Tesla command readiness has not been loaded for this vehicle yet.'
            };
        }

        function shouldTeslaCommandStatusCountAsActionNeeded(commandStatus = null) {
            const key = String(commandStatus?.key || '').trim();
            return key === 'reconnect_required' || key === 'proxy_required' || key === 'read_only';
        }

        function updateTeslaOnboardingSummary(summary = {}, vehicleCount = 0, preserveStatus = false) {
            if (preserveStatus) return;

            const connectedCount = Number(summary.connected || 0);
            const setupRequiredCount = Number(summary.setup_required || 0);
            const actionNeededCount = Number(summary.action_needed || 0);

            if (vehicleCount <= 0) {
                setTeslaOnboardingBadge('Setup Required', 'modified');
                setTeslaOnboardingStatus('No Tesla vehicles connected yet. Complete the Tesla app setup above, then use Connect with Tesla.', 'warning');
                return;
            }

            if (setupRequiredCount > 0 || actionNeededCount > 0) {
                setTeslaOnboardingBadge('Action Needed', 'modified');
                const issues = setupRequiredCount + actionNeededCount;
                setTeslaOnboardingStatus(`${connectedCount} Tesla vehicle(s) connected, but ${issues} vehicle(s) need attention before dashboard charging controls are fully ready. Review the vehicle list below for reconnect or command-readiness details.`, 'warning');
                return;
            }

            setTeslaOnboardingBadge('Connected', 'sync');
            const suffix = vehicleCount > 1
                ? 'Use Add another vehicle to onboard more Teslas.'
                : 'Use Add another vehicle when you are ready for the next Tesla.';
            setTeslaOnboardingStatus(`${vehicleCount} Tesla vehicle(s) listed. ${suffix}`, 'success');
        }

        async function loadTeslaCommandReadinessMap(vehicles = []) {
            if (!window.apiClient || typeof window.apiClient.getEVVehicleCommandReadiness !== 'function') {
                return {};
            }

            const readinessEntries = await Promise.all((Array.isArray(vehicles) ? vehicles : []).map(async (vehicle) => {
                const vehicleId = String(vehicle?.vehicleId || '').trim();
                if (!vehicleId || vehicle?.hasCredentials === false) {
                    return [vehicleId, null];
                }
                try {
                    const resp = await window.apiClient.getEVVehicleCommandReadiness(vehicleId);
                    if (resp && resp.errno === 0 && resp.result) {
                        return [vehicleId, resp.result];
                    }
                    const reasonCode = String(resp?.result?.reasonCode || '').trim();
                    return [vehicleId, {
                        state: reasonCode === 'tesla_reconnect_required' || reasonCode === 'tesla_permission_denied' ? 'setup_required' : 'read_only',
                        reasonCode,
                        source: 'settings_api'
                    }];
                } catch (error) {
                    return [vehicleId, {
                        state: 'read_only',
                        source: 'settings_api_error',
                        warning: String(error?.message || error || 'Command readiness unavailable')
                    }];
                }
            }));

            return readinessEntries.reduce((acc, entry) => {
                const [vehicleId, readiness] = entry;
                if (vehicleId) acc[vehicleId] = readiness;
                return acc;
            }, {});
        }

        function renderTeslaVehicles(vehicles, readinessByVehicleId = {}) {
            const { vehiclesList } = getTeslaOnboardingElements();
            if (!vehiclesList) return { connected: 0, setup_required: 0, action_needed: 0 };
            vehiclesList.innerHTML = '';
            const list = Array.isArray(vehicles) ? vehicles : [];
            const pending = readTeslaPendingOAuth();
            const pendingVin = normalizeTeslaVin(pending?.vin || pending?.vehicleId || '');
            const statusSummary = { connected: 0, setup_required: 0, action_needed: 0 };
            if (list.length === 0) {
                renderTeslaVehicleStatusCounts(statusSummary);
                const empty = document.createElement('span');
                empty.style.color = 'var(--text-secondary)';
                empty.style.fontSize = '12px';
                empty.textContent = 'No Tesla vehicles connected yet.';
                vehiclesList.appendChild(empty);
                return statusSummary;
            }
            list.forEach((vehicle) => {
                const vehicleVin = normalizeTeslaVin(vehicle?.vin || vehicle?.vehicleId || '');
                const vehicleId = String(vehicle?.vehicleId || '').trim();
                const primaryKey = vehicleVin || vehicleId;
                if (!primaryKey) return;
                const displayName = String(vehicle?.displayName || primaryKey);
                const idLabel = vehicleVin || vehicleId;
                const vehicleStatus = resolveTeslaVehicleUiStatus(vehicle, pendingVin);
                const commandReadiness = readinessByVehicleId[vehicleId] || readinessByVehicleId[primaryKey] || null;
                const commandStatus = describeTeslaCommandReadiness(commandReadiness, vehicleStatus.key);
                statusSummary[vehicleStatus.key] = Number(statusSummary[vehicleStatus.key] || 0) + 1;
                if (vehicleStatus.key === 'connected' && shouldTeslaCommandStatusCountAsActionNeeded(commandStatus)) {
                    statusSummary.action_needed = Number(statusSummary.action_needed || 0) + 1;
                }
                const isRecent = isTeslaRecentConnection(vehicleVin || vehicleId);

                const row = document.createElement('div');
                row.className = `tesla-vehicle-row status-${vehicleStatus.key}${isRecent ? ' is-recently-connected' : ''}`;

                const main = document.createElement('div');
                main.className = 'tesla-vehicle-main';
                const title = document.createElement('div');
                title.className = 'tesla-vehicle-title';
                title.textContent = displayName;
                const idEl = document.createElement('div');
                idEl.className = 'tesla-vehicle-id';
                idEl.textContent = idLabel;
                const detail = document.createElement('div');
                detail.className = 'tesla-vehicle-subtext';
                detail.textContent = commandStatus
                    ? `${vehicleStatus.detail} ${commandStatus.detail}`
                    : vehicleStatus.detail;
                main.appendChild(title);
                main.appendChild(idEl);
                main.appendChild(detail);
                row.appendChild(main);

                const right = document.createElement('div');
                right.className = 'tesla-vehicle-right';
                const statusPill = document.createElement('span');
                statusPill.className = `tesla-vehicle-status status-${vehicleStatus.key}`;
                statusPill.textContent = vehicleStatus.label;
                right.appendChild(statusPill);

                if (commandStatus) {
                    const commandPill = document.createElement('span');
                    commandPill.className = `tesla-vehicle-status status-${commandStatus.key}`;
                    commandPill.textContent = commandStatus.label;
                    right.appendChild(commandPill);
                }

                if (isRecent) {
                    const newPill = document.createElement('span');
                    newPill.className = 'tesla-vehicle-status status-new';
                    newPill.textContent = 'Newly connected';
                    right.appendChild(newPill);
                }

                if (commandStatus?.key === 'reconnect_required') {
                    const reconnectBtn = document.createElement('button');
                    reconnectBtn.type = 'button';
                    reconnectBtn.setAttribute('data-tesla-reconnect-id', primaryKey);
                    reconnectBtn.title = `Reconnect ${displayName}`;
                    reconnectBtn.textContent = 'Reconnect';
                    right.appendChild(reconnectBtn);
                }

                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.setAttribute('data-tesla-remove-id', primaryKey);
                removeBtn.title = `Disconnect ${displayName}`;
                removeBtn.textContent = 'Disconnect';
                right.appendChild(removeBtn);
                row.appendChild(right);
                vehiclesList.appendChild(row);
            });
            renderTeslaVehicleStatusCounts(statusSummary);
            return statusSummary;
        }

        async function loadTeslaVehicles(options = {}) {
            const { silent = false, preserveStatus = false } = options || {};
            if (!window.apiClient || typeof window.apiClient.listEVVehicles !== 'function') {
                return [];
            }
            try {
                if (!silent) setTeslaOnboardingStatus('Loading Tesla vehicles...', 'muted');
                const resp = await window.apiClient.listEVVehicles();
                if (!resp || resp.errno !== 0) {
                    throw new Error(extractApiErrorMessage(resp, 'Failed to load Tesla vehicles'));
                }
                const allVehicles = Array.isArray(resp.result) ? resp.result : [];
                const teslaVehicles = allVehicles.filter((vehicle) => String(vehicle?.provider || '').toLowerCase() === 'tesla');
                teslaVehiclesState = teslaVehicles;
                const readinessByVehicleId = await loadTeslaCommandReadinessMap(teslaVehicles);
                const statusSummary = renderTeslaVehicles(teslaVehicles, readinessByVehicleId);
                updateTeslaOnboardingSummary(statusSummary, teslaVehicles.length, preserveStatus);
                return teslaVehicles;
            } catch (error) {
                teslaVehiclesState = [];
                renderTeslaVehicles([]);
                if (!preserveStatus) {
                    setTeslaOnboardingBadge('Error', 'modified');
                    setTeslaOnboardingStatus(error.message || 'Failed to load Tesla vehicles', 'error');
                }
                if (!silent) {
                    showMessage('warning', `Failed to load Tesla vehicles: ${error.message || error}`);
                }
                return [];
            }
        }

        async function removeTeslaVehicle(vehicleId) {
            const trimmedId = String(vehicleId || '').trim();
            if (!trimmedId) return;
            if (
                !window.apiClient ||
                (
                    typeof window.apiClient.deleteEVVehicle !== 'function' &&
                    typeof window.apiClient.request !== 'function'
                )
            ) {
                showMessage('warning', 'Tesla vehicle removal is unavailable right now');
                return;
            }
            const shouldDelete = confirm(`Disconnect Tesla vehicle ${trimmedId}?`);
            if (!shouldDelete) return;
            try {
                let resp = null;
                if (typeof window.apiClient.request === 'function') {
                    resp = await window.apiClient.request(
                        `/api/ev/vehicles/${encodeURIComponent(trimmedId)}`,
                        { method: 'DELETE' }
                    );
                } else {
                    resp = await window.apiClient.deleteEVVehicle(trimmedId);
                }
                if (!resp || resp.errno !== 0) {
                    throw new Error(extractApiErrorMessage(resp, 'Failed to disconnect vehicle'));
                }
                showMessage('success', `Tesla vehicle ${trimmedId} disconnected`);
                await loadTeslaVehicles({ silent: true });
            } catch (error) {
                setTeslaOnboardingBadge('Error', 'modified');
                setTeslaOnboardingStatus(error.message || 'Failed to disconnect Tesla vehicle', 'error');
                showMessage('warning', `Failed to disconnect Tesla vehicle: ${error.message || error}`);
            }
        }

        async function startTeslaOnboardingFlow() {
            const {
                connectBtn
            } = getTeslaOnboardingElements();

            const form = getTeslaOnboardingFormValues();
            if (!form.clientId) {
                setTeslaOnboardingBadge('Action Needed', 'modified');
                setTeslaOnboardingStatus('Open Tesla Developer Dashboard, copy your Tesla Client ID, then paste it here.', 'warning');
                showMessage('warning', 'Tesla Fleet Client ID is required');
                return;
            }
            if (!form.vehicleId) {
                setTeslaOnboardingBadge('Action Needed', 'modified');
                setTeslaOnboardingStatus('Enter the 17-character VIN from the Tesla app or the vehicle before you connect.', 'warning');
                showMessage('warning', 'Tesla Vehicle VIN is required');
                return;
            }
            if (!normalizeTeslaVin(form.vehicleId)) {
                setTeslaOnboardingBadge('Action Needed', 'modified');
                setTeslaOnboardingStatus('Vehicle VIN format is invalid. Use the full 17-character VIN.', 'warning');
                showMessage('warning', 'Tesla Vehicle VIN format is invalid');
                return;
            }

            const prevButtonHtml = connectBtn ? connectBtn.innerHTML : '';
            if (connectBtn) {
                connectBtn.disabled = true;
                connectBtn.innerHTML = '<span class="spinner"></span> Opening Tesla...';
            }

            try {
                if (!window.apiClient || typeof window.apiClient.getEVOAuthStartUrl !== 'function') {
                    throw new Error('API client unavailable');
                }

                await ensureTeslaVehicleRegistered(form);

                let partnerRegistrationResult = null;
                if (form.clientSecret) {
                    setTeslaOnboardingStatus('Registering your Tesla app domain with Tesla before sign-in...', 'warning');
                    partnerRegistrationResult = await ensureTeslaPartnerDomainRegistered(form);
                    const registrationWarning = getTeslaPartnerRegistrationWarning(partnerRegistrationResult);
                    if (registrationWarning) {
                        setTeslaOnboardingStatus(registrationWarning, 'warning');
                        showMessage('warning', registrationWarning);
                    }
                } else {
                    setTeslaOnboardingStatus('No Tesla client secret provided. Tesla sign-in can still work, but virtual-key pairing and charging controls may fail until the app domain is registered.', 'warning');
                }

                const codeVerifier = createRandomBase64Url(48);
                const codeChallenge = await createPkceCodeChallenge(codeVerifier);
                const stateToken = createRandomBase64Url(24);

                persistTeslaPendingOAuth({
                    vehicleId: form.vehicleId,
                    vin: form.vehicleId,
                    clientId: form.clientId,
                    clientSecret: form.clientSecret,
                    displayName: form.displayName,
                    region: form.region,
                    redirectUri: form.redirectUri,
                    partnerRegistrationState: String(partnerRegistrationResult?.verificationState || '').trim(),
                    codeVerifier,
                    state: stateToken,
                    startedAtMs: Date.now()
                });

                const oauthStartResp = await window.apiClient.getEVOAuthStartUrl(
                    form.clientId,
                    form.redirectUri,
                    codeChallenge,
                    form.region,
                    stateToken
                );
                if (!oauthStartResp || oauthStartResp.errno !== 0 || !oauthStartResp.result || !oauthStartResp.result.url) {
                    throw new Error(extractApiErrorMessage(oauthStartResp, 'Failed to start Tesla OAuth flow'));
                }

                const authUrl = new URL(String(oauthStartResp.result.url));
                authUrl.searchParams.set('state', stateToken);
                setTeslaOnboardingBadge('Pending', 'modified');
                setTeslaOnboardingStatus('Opening Tesla sign-in. Approve access there and you will return here automatically.', 'warning');
                window.location.assign(authUrl.toString());
            } catch (error) {
                clearTeslaPendingOAuth();
                setTeslaOnboardingBadge('Error', 'modified');
                setTeslaOnboardingStatus(error.message || 'Failed to start Tesla OAuth', 'error');
                showMessage('warning', `Tesla connect failed: ${error.message || error}`);
            } finally {
                if (connectBtn) {
                    connectBtn.disabled = false;
                    connectBtn.innerHTML = prevButtonHtml;
                }
            }
        }

        async function handleTeslaOAuthCallbackIfPresent() {
            let url;
            try {
                url = new URL(window.location.href);
            } catch (e) {
                return { handled: false, success: false };
            }

            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            const oauthError = url.searchParams.get('error');
            const oauthErrorDescription = url.searchParams.get('error_description');
            const pending = readTeslaPendingOAuth();

            if (!code && !oauthError) {
                if (pending) {
                    applyTeslaPendingValuesToInputs(pending);
                    setTeslaOnboardingBadge('Pending', 'modified');
                    setTeslaOnboardingStatus('Tesla sign-in is still pending. Finish approval in Tesla, then return to this page.', 'warning');
                } else {
                    setTeslaOnboardingBadge('Setup Required', 'modified');
                    setTeslaOnboardingStatus('Start with Step 1 in Tesla Developer Dashboard, then return here to connect.', 'warning');
                }
                return { handled: false, success: false };
            }

            if (oauthError) {
                clearTeslaPendingOAuth();
                cleanTeslaOAuthParamsFromUrl();
                const detail = String(oauthErrorDescription || oauthError || 'Authorization was declined');
                setTeslaOnboardingBadge('Action Needed', 'modified');
                setTeslaOnboardingStatus(`Tesla sign-in failed: ${detail}`, 'error');
                showMessage('warning', `Tesla authorization failed: ${detail}`);
                return { handled: true, success: false };
            }

            if (!pending) {
                cleanTeslaOAuthParamsFromUrl();
                setTeslaOnboardingBadge('Action Needed', 'modified');
                setTeslaOnboardingStatus('No pending Tesla sign-in was found. Use Connect with Tesla to restart the flow.', 'warning');
                showMessage('warning', 'No pending Tesla sign-in was found. Use Connect with Tesla to restart the flow.');
                return { handled: true, success: false };
            }

            applyTeslaPendingValuesToInputs(pending);
            if (!state || String(state) !== String(pending.state || '')) {
                clearTeslaPendingOAuth();
                cleanTeslaOAuthParamsFromUrl();
                setTeslaOnboardingBadge('Action Needed', 'modified');
                setTeslaOnboardingStatus('Tesla sign-in verification failed. Restart the connect flow from this page.', 'error');
                showMessage('warning', 'Tesla sign-in verification failed. Restart the connect flow from this page.');
                return { handled: true, success: false };
            }
            if (!pending.codeVerifier) {
                clearTeslaPendingOAuth();
                cleanTeslaOAuthParamsFromUrl();
                setTeslaOnboardingBadge('Action Needed', 'modified');
                setTeslaOnboardingStatus('The Tesla login session is incomplete. Restart the connect flow from this page.', 'error');
                showMessage('warning', 'The Tesla login session is incomplete. Restart the connect flow from this page.');
                return { handled: true, success: false };
            }

            try {
                if (!window.apiClient || typeof window.apiClient.exchangeEVOAuthCode !== 'function') {
                    throw new Error('API client unavailable');
                }
                setTeslaOnboardingBadge('Finalizing', 'modified');
                setTeslaOnboardingStatus('Tesla approved. Finalizing the connection now...', 'warning');

                await ensureTeslaVehicleRegistered({
                    vehicleId: pending.vehicleId,
                    displayName: pending.displayName,
                    region: pending.region
                });

                const exchangeResp = await window.apiClient.exchangeEVOAuthCode(
                    pending.vehicleId,
                    pending.clientId,
                    pending.clientSecret || '',
                    pending.redirectUri || getTeslaRedirectUri(),
                    code,
                    pending.codeVerifier,
                    pending.region || TESLA_REGION_DEFAULT,
                    { vin: pending.vin || pending.vehicleId }
                );

                if (!exchangeResp || exchangeResp.errno !== 0) {
                    throw new Error(extractApiErrorMessage(exchangeResp, 'Tesla OAuth callback exchange failed'));
                }

                clearTeslaPendingOAuth();
                cleanTeslaOAuthParamsFromUrl();
                markTeslaRecentlyConnected(pending.vehicleId);
                const registrationWarning = getTeslaPartnerRegistrationWarning({ verificationState: pending.partnerRegistrationState });
                if (registrationWarning) {
                    setTeslaOnboardingBadge('Action Needed', 'modified');
                    setTeslaOnboardingStatus(`Tesla connected for VIN ${pending.vehicleId} and dashboard status should begin syncing, but pairing and charging commands are still blocked. ${registrationWarning}`, 'warning');
                    showMessage('warning', `Tesla connected for VIN ${pending.vehicleId}, but this Client ID is still read-only for SoCrates because it does not own socratesautomation.com.`);
                } else {
                    setTeslaOnboardingBadge('Connected', 'sync');
                    setTeslaOnboardingStatus(`Tesla connected for VIN ${pending.vehicleId}. Dashboard status should now begin syncing for this vehicle.`, 'success');
                    showMessage('success', `Tesla connected for VIN ${pending.vehicleId}`);
                }
                return { handled: true, success: true };
            } catch (error) {
                clearTeslaPendingOAuth();
                cleanTeslaOAuthParamsFromUrl();
                setTeslaOnboardingBadge('Action Needed', 'modified');
                setTeslaOnboardingStatus(error.message || 'Tesla callback handling failed', 'error');
                showMessage('warning', `Tesla callback failed: ${error.message || error}`);
                return { handled: true, success: false };
            }
        }

        function clearTeslaPendingAuthFlow() {
            const pending = readTeslaPendingOAuth();
            if (!pending) {
                syncTeslaPendingAuthControls();
                setTeslaOnboardingBadge('Setup Required', 'modified');
                setTeslaOnboardingStatus('No pending Tesla sign-in session found. Use Connect with Tesla to start a fresh login.', 'warning');
                showMessage('info', 'No pending Tesla login session to reset');
                return;
            }
            clearTeslaPendingOAuth();
            setTeslaOnboardingBadge('Setup Required', 'modified');
            setTeslaOnboardingStatus('Reset Tesla login state. You can start the connect flow again.', 'warning');
            showMessage('info', 'Cleared pending Tesla authorization state');
        }

        function prepareTeslaAddAnotherVehicleFlow() {
            const pending = readTeslaPendingOAuth();
            if (pending) {
                setTeslaOnboardingBadge('Action Needed', 'modified');
                setTeslaOnboardingStatus('Finish or reset the current Tesla sign-in before adding another vehicle.', 'warning');
                showMessage('warning', 'Finish or reset the current Tesla login before adding another vehicle');
                return;
            }
            const { vehicleIdInput, displayNameInput } = getTeslaOnboardingElements();
            if (vehicleIdInput) {
                vehicleIdInput.value = '';
                vehicleIdInput.focus();
            }
            if (displayNameInput) {
                displayNameInput.value = '';
            }
            setTeslaOnboardingBadge('Setup Required', 'modified');
            setTeslaOnboardingStatus('Adding another Tesla: enter the next VIN, optional name, then click Connect with Tesla.', 'warning');
            showMessage('info', 'Ready to add another Tesla vehicle');
        }

        function prepareTeslaReconnectFlow(vehicle) {
            const pending = readTeslaPendingOAuth();
            if (pending) {
                setTeslaOnboardingBadge('Action Needed', 'modified');
                setTeslaOnboardingStatus('Finish or reset the current Tesla sign-in before reconnecting this vehicle.', 'warning');
                showMessage('warning', 'Finish or reset the current Tesla login before reconnecting this vehicle');
                return;
            }
            const {
                vehicleIdInput,
                displayNameInput,
                regionInput
            } = getTeslaOnboardingElements();
            const vehicleId = normalizeTeslaVin(vehicle?.vin || vehicle?.vehicleId || '');
            const displayName = String(vehicle?.displayName || vehicleId || '').trim();
            const region = String(vehicle?.region || TESLA_REGION_DEFAULT).trim() || TESLA_REGION_DEFAULT;

            if (vehicleIdInput) {
                vehicleIdInput.value = vehicleId;
                vehicleIdInput.focus();
            }
            if (displayNameInput) {
                displayNameInput.value = displayName;
            }
            if (regionInput) {
                regionInput.value = region;
            }
            updateTeslaRegionHelp();
            setTeslaOnboardingBadge('Action Needed', 'modified');
            setTeslaOnboardingStatus(`Reconnect ${displayName || vehicleId} by reviewing the VIN details below, then click Connect with Tesla.`, 'warning');
            showMessage('info', `Reconnect ready for ${displayName || vehicleId}. Click Connect with Tesla when you are ready.`);
        }

        function bindTeslaOnboardingHandlers() {
            if (teslaOnboardingHandlersBound) return;
            teslaOnboardingHandlersBound = true;
            const {
                checkOwnershipBtn,
                connectBtn,
                addVehicleBtn,
                clearPendingBtn,
                refreshBtn,
                vehiclesList,
                regionInput,
                copyRedirectBtn
            } = getTeslaOnboardingElements();

            if (checkOwnershipBtn) {
                checkOwnershipBtn.addEventListener('click', () => {
                    checkTeslaPartnerDomainAccess();
                });
            }
            if (connectBtn) {
                connectBtn.addEventListener('click', () => {
                    startTeslaOnboardingFlow();
                });
            }
            if (addVehicleBtn) {
                addVehicleBtn.addEventListener('click', () => {
                    prepareTeslaAddAnotherVehicleFlow();
                });
            }
            if (clearPendingBtn) {
                clearPendingBtn.addEventListener('click', () => {
                    clearTeslaPendingAuthFlow();
                });
            }
            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => {
                    loadTeslaVehicles();
                });
            }
            if (regionInput) {
                regionInput.addEventListener('change', () => {
                    updateTeslaRegionHelp();
                });
            }
            if (copyRedirectBtn) {
                copyRedirectBtn.addEventListener('click', () => {
                    copyTeslaRedirectUri();
                });
            }
            if (vehiclesList) {
                vehiclesList.addEventListener('click', (event) => {
                    const target = event?.target;
                    if (!(target instanceof Element)) return;
                    const reconnectId = target.getAttribute('data-tesla-reconnect-id');
                    if (reconnectId) {
                        const normalizedReconnectId = normalizeTeslaVin(reconnectId);
                        const vehicle = teslaVehiclesState.find((entry) => {
                            const vehicleKey = normalizeTeslaVin(entry?.vin || entry?.vehicleId || '');
                            return vehicleKey === normalizedReconnectId;
                        });
                        if (vehicle) {
                            prepareTeslaReconnectFlow(vehicle);
                        }
                        return;
                    }
                    const removeId = target.getAttribute('data-tesla-remove-id');
                    if (!removeId) return;
                    removeTeslaVehicle(removeId);
                });
            }
        }

        async function initializeTeslaOnboarding() {
            bindTeslaOnboardingHandlers();
            updateTeslaRedirectUriInput();
            updateTeslaRegionHelp();
            syncTeslaPendingAuthControls();
            const pendingBeforeCallback = readTeslaPendingOAuth();
            const callbackResult = await handleTeslaOAuthCallbackIfPresent();
            const preserveStatus = Boolean(callbackResult?.handled || pendingBeforeCallback);
            await loadTeslaVehicles({ silent: callbackResult.handled, preserveStatus });
            syncTeslaPendingAuthControls();
            return callbackResult;
        }

        function isTimingInputId(inputId) {
            return TIMING_INPUT_IDS.has(inputId);
        }

        function millisecondsToUiSeconds(ms) {
            const numeric = Number(ms);
            if (!Number.isFinite(numeric)) return '';
            const seconds = numeric / 1000;
            return Number.isInteger(seconds) ? String(seconds) : String(Number(seconds.toFixed(3)));
        }

        function uiSecondsToMilliseconds(seconds) {
            const numeric = Number(seconds);
            if (!Number.isFinite(numeric)) return null;
            return Math.round(numeric * 1000);
        }

        function withMsFallback(value, fallbackMs) {
            const numeric = Number(value);
            if (!Number.isFinite(numeric) || numeric <= 0) return fallbackMs;
            return Math.round(numeric);
        }

        // Helper to format milliseconds to human-readable
        function formatMs(ms) {
            if (ms === null || ms === undefined || isNaN(ms)) return '?';
            ms = parseInt(ms);
            if (ms < 1000) return `${ms}ms`;
            if (ms < 60000) return `${Math.round(ms/1000)}s`;
            if (ms < 3600000) return `${(ms/60000).toFixed(1)}m`;
            return `${(ms/3600000).toFixed(1)}h`;
        }

        // Update time display for a millisecond input
        function updateTimeDisplay(inputId) {
            const input = document.getElementById(inputId);
            const display = document.getElementById(inputId + '_display');
            if (input && display) {
                const msValue = getInputValue(inputId);
                display.textContent = '= ' + formatMs(msValue);
            }
        }

        // Update all time displays
        function updateAllTimeDisplays() {
            const msInputs = [
                'automation_intervalMs',
                'cache_amber', 'cache_inverter', 'cache_weather', 'cache_teslaStatus'
            ];
            msInputs.forEach(updateTimeDisplay);
        }

        // Helper to show messages
        function showMessage(type, message) {
            const area = document.getElementById('messageArea');
            const icon = type === 'success' ? '✅' : type === 'warning' ? '⚠️' : 'ℹ️';
            area.innerHTML = `<div class="alert alert-${type}">${icon} ${message}</div>`;
            setTimeout(() => area.innerHTML = '', 5000);
        }

        function setConfigStatus(kind, text) {
            const el = document.getElementById('configStatus');
            if (!el) return;

            if (kind === 'loading') {
                const label = text || 'Loading...';
                el.innerHTML = `<span class="spinner"></span> ${label}`;
                return;
            }

            const clsMap = {
                ok: 'status-state status-state--ok',
                warning: 'status-state status-state--warning',
                error: 'status-state status-state--error',
                muted: 'status-state status-state--muted'
            };
            const cls = clsMap[kind] || clsMap.muted;
            el.innerHTML = `<span class="${cls}">${text}</span>`;
        }

        // Load current settings from server
        async function reloadFromServer() {
            try {
                showMessage('info', 'Reloading settings from server...');
                await loadSettings();
                showMessage('success', 'Settings reloaded from server successfully');
            } catch (err) {
                console.error('Error reloading settings:', err);
                showMessage('warning', 'Error reloading settings: ' + err.message);
            }
        }

        async function loadSettings() {
            try {
                setConfigStatus('loading', 'Loading...');
                
                const resp = await authenticatedFetch('/api/config?t=' + Date.now());
                // If the server responded 401, treat as unauthorized -> redirect to login after a short delay
                if (resp && resp.status === 401) {
                    console.warn('[Settings] /api/config returned 401 (unauthorized)');
                    setConfigStatus('error', 'Unauthorized');
                    showMessage('warning', 'Not signed in or session expired — redirecting to login');
                    // Give the user a moment to see the message and avoid immediate bounce.
                    setTimeout(() => safeRedirect('/login.html'), 700);
                    return;
                }

                // Parse JSON safely (guard against HTML error pages or non-json responses)
                let data;
                try {
                    data = await resp.json();
                } catch (jsonErr) {
                    const text = await (typeof resp.text === 'function' ? resp.text() : Promise.resolve(String(resp)));
                    console.warn('[Settings] Received non-JSON response from /api/config:', text.substring ? text.substring(0, 300) : text);
                    setConfigStatus('error', 'Error');
                    showMessage('warning', 'Invalid response from server — check network or server logs');
                    return;
                }

                if (!data || data.errno !== 0 || !data.result) {
                    // Provide clearer message rather than a thrown exception which can cause missing cleanup
                    setConfigStatus('error', 'Error');
                    showMessage('warning', `Failed to load configuration: ${data?.msg || 'Invalid response from server'}`);
                    return;
                }
                
                // Set current config
                currentConfig = data.result;
                
                // Helper to safely set input value
                const setInput = (id, value) => setInputValue(id, value);
                
                // Automation and cache: always render from server values when present, otherwise defaults.
                const automationIntervalMs = withMsFallback(currentConfig.automation?.intervalMs, 60000);
                const cacheAmberMs = withMsFallback(currentConfig.cache?.amber, 60000);
                const cacheInverterMs = withMsFallback(currentConfig.cache?.inverter, 300000);
                const cacheWeatherMs = withMsFallback(currentConfig.cache?.weather, 1800000);
                const cacheTeslaStatusMs = withMsFallback(currentConfig.cache?.teslaStatus, 600000);

                setInput('automation_intervalMs', automationIntervalMs);
                setInput('cache_amber', cacheAmberMs);
                setInput('cache_inverter', cacheInverterMs);
                setInput('cache_weather', cacheWeatherMs);
                setInput('cache_teslaStatus', cacheTeslaStatusMs);
                
                // Defaults
                if (currentConfig.defaults) {
                    setInput('defaults_cooldownMinutes', currentConfig.defaults.cooldownMinutes);
                    setInput('defaults_durationMinutes', currentConfig.defaults.durationMinutes);
                    setInput('defaults_fdPwr', currentConfig.defaults.fdPwr);
                }
                
                // Preferences
                // PRIORITY: 'location' field (most recently saved) takes precedence over potentially stale preferences.weatherPlace
                // This ensures UI displays what the user just saved, not old data from mismatched fields
                if (currentConfig.location) {
                    // Location field - highest priority (this is what save writes to)
                    setInput('preferences_weatherPlace', currentConfig.location);
                    setInput('preferences_forecastDays', currentConfig.preferences?.forecastDays || 6);
                } else if (currentConfig.preferences?.weatherPlace) {
                    // Fallback: preferences.weatherPlace if location is empty
                    setInput('preferences_weatherPlace', currentConfig.preferences.weatherPlace);
                    setInput('preferences_forecastDays', currentConfig.preferences.forecastDays || 6);
                } else if (currentConfig.weatherPlace) {
                    // Fallback: weatherPlace at root level (legacy)
                    setInput('preferences_weatherPlace', currentConfig.weatherPlace);
                    setInput('preferences_forecastDays', 6);
                } else {
                    // Default fallback
                    setInput('preferences_weatherPlace', 'Sydney, Australia');
                    setInput('preferences_forecastDays', 6);
                }

                // Hardware
                setInput('hardware_inverterCapacityKw', ((currentConfig.inverterCapacityW || 10000) / 1000).toFixed(1));
                setInput('hardware_batteryCapacityKwh', currentConfig.batteryCapacityKWh || 41.93);
                // Update fdPwr max and validation rule dynamically to match user's inverter capacity
                const invCapW = currentConfig.inverterCapacityW || 10000;
                const fdPwrEl = document.getElementById('defaults_fdPwr');
                if (fdPwrEl) {
                    fdPwrEl.max = invCapW;
                    fdPwrEl.title = `Max: ${(invCapW / 1000).toFixed(1)} kW (your inverter capacity)`;
                }
                validationRules['defaults_fdPwr'].max = invCapW;
                validationRules['defaults_fdPwr'].errorMsg = `Power must be 1000–${invCapW} watts (your inverter capacity)`;

                // Credentials: populate device SN if available. Tokens are intentionally not returned by the API for security.
                try {
                    setInput('credentials_deviceSn', currentConfig.deviceSn || '');
                    // Initialize originalCredentials to reflect what we just loaded so the
                    // UI doesn't consider the credentials section "modified" by default.
                    originalCredentials.deviceSn = currentConfig.deviceSn || '';
                    // For credentials, store masked dots in originalCredentials to match the display
                    // The actual values are stored in the dataset for Show/Hide functionality
                    
                    // Clear credential input fields before reloading to ensure fresh state
                    const foxessInput = document.getElementById('credentials_foxessToken');
                    const amberInput = document.getElementById('credentials_amberKey');
                    if (foxessInput) {
                        foxessInput.value = '';
                        delete foxessInput.dataset.actualValue;
                        setSavedCredentialFlag(foxessInput, false);
                    }
                    if (amberInput) {
                        amberInput.value = '';
                        delete amberInput.dataset.actualValue;
                        setSavedCredentialFlag(amberInput, false);
                    }
                    
                    // Store actual credentials in a data attribute for Show/Hide functionality
                    if (foxessInput && currentConfig.foxessToken) {
                        foxessInput.dataset.actualValue = currentConfig.foxessToken;
                    }
                    if (amberInput && currentConfig.amberApiKey) {
                        amberInput.dataset.actualValue = currentConfig.amberApiKey;
                    }
                    
                    // Check presence of inverter token and pricing API key via /api/health endpoint
                    try {
                        const healthResp = await authenticatedFetch('/api/health');
                        const health = await healthResp.json();
                        const credStatusEl = document.getElementById('credentialsStatus');
                        const badge = document.getElementById('credentialsBadge');
                        
                        const hasFoxess = !!(health && health.FOXESS_TOKEN);
                        const hasAmber = !!(health && health.AMBER_API_KEY);
                        
                        // Show masked placeholder in input fields to indicate credentials are saved
                        if (hasFoxess) {
                            if (foxessInput) {
                                foxessInput.value = '••••••••';
                                originalCredentials.foxessToken = '••••••••';  // Match the display
                                setSavedCredentialFlag(foxessInput, true);
                            }
                        } else {
                            originalCredentials.foxessToken = '';
                            if (foxessInput) {
                                delete foxessInput.dataset.actualValue;
                                setSavedCredentialFlag(foxessInput, false);
                            }
                        }
                        
                        if (hasAmber) {
                            if (amberInput) {
                                amberInput.value = '••••••••';
                                originalCredentials.amberKey = '••••••••';  // Match the display
                                setSavedCredentialFlag(amberInput, true);
                            }
                        } else {
                            originalCredentials.amberKey = '';
                            if (amberInput) {
                                delete amberInput.dataset.actualValue;
                                setSavedCredentialFlag(amberInput, false);
                            }
                        }
                        
                        if (hasFoxess && hasAmber) {
                            // Both credentials present
                            if (credStatusEl) credStatusEl.textContent = 'Inverter token and pricing API key are present (hidden)';
                            if (badge) { badge.textContent = 'Synced'; badge.className = 'badge badge-sync'; }
                        } else if (hasFoxess && !hasAmber) {
                            // Only inverter token present
                            if (credStatusEl) credStatusEl.textContent = 'Inverter token is present (hidden) — pricing API key not set';
                            if (badge) { badge.textContent = 'Synced'; badge.className = 'badge badge-sync'; }
                        } else if (!hasFoxess && hasAmber) {
                            // Only pricing API key present
                            if (credStatusEl) credStatusEl.textContent = 'Pricing API key is present (hidden) — inverter token not set';
                            if (badge) { badge.textContent = 'Synced'; badge.className = 'badge badge-sync'; }
                        } else {
                            // Neither present
                            if (credStatusEl) credStatusEl.textContent = 'No credentials detected';
                            if (badge) { badge.textContent = 'Synced'; badge.className = 'badge badge-sync'; }
                        }
                    } catch (hErr) {
                        console.warn('[Settings] Health check failed:', hErr);
                    }
                } catch (credErr) {
                    console.warn('Failed to populate credentials fields', credErr);
                }
                
                // Blackout windows
                renderBlackoutWindows(currentConfig.automation?.blackoutWindows || []);
                
                // Solar curtailment - ensure defaults are applied
                const curtailmentConfig = currentConfig.curtailment || { enabled: false, priceThreshold: 0 };
                if (currentConfig.curtailment) {
                    const enabledButton = document.getElementById('curtailment_enabled');
                    const thresholdInput = document.getElementById('curtailment_priceThreshold');
                    const isEnabled = curtailmentConfig.enabled === true;
                    
                    // Update button state
                    if (enabledButton) {
                        if (isEnabled) {
                            enabledButton.classList.add('active');
                            enabledButton.querySelector('.curtailment-state').textContent = 'Enabled';
                        } else {
                            enabledButton.classList.remove('active');
                            enabledButton.querySelector('.curtailment-state').textContent = 'Disabled';
                        }
                    }
                    
                    if (thresholdInput) {
                        thresholdInput.value = curtailmentConfig.priceThreshold !== undefined ? curtailmentConfig.priceThreshold : 0;
                    }
                } else {
                    // Initialize defaults if no curtailment config exists
                    const enabledButton = document.getElementById('curtailment_enabled');
                    const thresholdInput = document.getElementById('curtailment_priceThreshold');
                    
                    if (enabledButton) {
                        enabledButton.classList.remove('active');
                        enabledButton.querySelector('.curtailment-state').textContent = 'Disabled';
                    }
                    
                    if (thresholdInput) {
                        thresholdInput.value = 0;
                    }
                }
                
                // NOW set originalConfig to match what we just loaded (so no unsaved changes)
                originalConfig = JSON.parse(JSON.stringify(data.result));
                
                // Ensure all sections exist in originalConfig to prevent undefined errors
                if (!originalConfig.automation) originalConfig.automation = {};
                if (!originalConfig.cache) originalConfig.cache = {};
                if (!originalConfig.defaults) originalConfig.defaults = {};
                if (!originalConfig.api) originalConfig.api = {};
                if (!originalConfig.preferences) originalConfig.preferences = {};
                if (!originalConfig.curtailment) originalConfig.curtailment = { enabled: false, priceThreshold: 0 };
                
                // Fill in missing values from displayed inputs if not in server response
                // This ensures originalConfig matches what was actually displayed to the user
                if (originalConfig.automation.intervalMs === undefined || originalConfig.automation.intervalMs === null) {
                    originalConfig.automation.intervalMs = automationIntervalMs;
                }
                if (originalConfig.automation.startDelayMs === undefined || originalConfig.automation.startDelayMs === null) {
                    originalConfig.automation.startDelayMs = currentConfig?.automation?.startDelayMs ?? 5000;
                }
                if (originalConfig.automation.gatherDataTimeoutMs === undefined || originalConfig.automation.gatherDataTimeoutMs === null) {
                    originalConfig.automation.gatherDataTimeoutMs = currentConfig?.automation?.gatherDataTimeoutMs ?? 8000;
                }
                
                if (originalConfig.cache.amber === undefined || originalConfig.cache.amber === null) {
                    originalConfig.cache.amber = cacheAmberMs;
                }
                if (originalConfig.cache.inverter === undefined || originalConfig.cache.inverter === null) {
                    originalConfig.cache.inverter = cacheInverterMs;
                }
                if (originalConfig.cache.weather === undefined || originalConfig.cache.weather === null) {
                    originalConfig.cache.weather = cacheWeatherMs;
                }
                if (originalConfig.cache.teslaStatus === undefined || originalConfig.cache.teslaStatus === null) {
                    originalConfig.cache.teslaStatus = cacheTeslaStatusMs;
                }
                
                if (originalConfig.defaults.cooldownMinutes === undefined || originalConfig.defaults.cooldownMinutes === null) {
                    originalConfig.defaults.cooldownMinutes = getInputValue('defaults_cooldownMinutes') || 5;
                }
                if (originalConfig.defaults.durationMinutes === undefined || originalConfig.defaults.durationMinutes === null) {
                    originalConfig.defaults.durationMinutes = getInputValue('defaults_durationMinutes') || 30;
                }
                if (originalConfig.defaults.fdPwr === undefined || originalConfig.defaults.fdPwr === null) {
                    originalConfig.defaults.fdPwr = getInputValue('defaults_fdPwr') || 5000;
                }
                
                if (originalConfig.api.retryCount === undefined || originalConfig.api.retryCount === null) {
                    originalConfig.api.retryCount = getInputValue('api_retryCount') || 3;
                }
                if (originalConfig.api.retryDelayMs === undefined || originalConfig.api.retryDelayMs === null) {
                    originalConfig.api.retryDelayMs = getInputValue('api_retryDelayMs') || 1000;
                }
                
                if (originalConfig.preferences.forecastDays === undefined || originalConfig.preferences.forecastDays === null) {
                    originalConfig.preferences.forecastDays = getInputValue('preferences_forecastDays') || 6;
                }
                
                // Save weatherPlace to preferences (primary storage location)
                const weatherPlaceInput = document.getElementById('preferences_weatherPlace')?.value || 'Sydney, Australia';
                originalConfig.preferences.weatherPlace = weatherPlaceInput;
                // Also keep location field in sync for backward compatibility
                originalConfig.location = weatherPlaceInput;
                
                // Sync curtailment only if not already set
                if (originalConfig.curtailment.priceThreshold === undefined) {
                    const thresholdInput = document.getElementById('curtailment_priceThreshold');
                    originalConfig.curtailment.priceThreshold = thresholdInput?.value !== '' && thresholdInput?.value !== null ? parseFloat(thresholdInput.value) : 0;
                }
                
                // Enable all inputs now that data is loaded from server
                document.querySelectorAll('input, select').forEach(input => {
                    input.disabled = false;
                });

                let teslaInitResult = { handled: false };
                try {
                    teslaInitResult = await initializeTeslaOnboarding();
                } catch (teslaInitErr) {
                    console.warn('[Settings] Tesla onboarding initialization failed', teslaInitErr);
                }

                updateAllTimeDisplays();
                updateStatus();
                if (!teslaInitResult?.handled) {
                    showMessage('success', 'Configuration loaded from server');
                }
            } catch (error) {
                console.error('loadSettings error:', error);
                setConfigStatus('error', 'Error');
                showMessage('warning', `Failed to load: ${error.message}`);
            }
        }

        function clearInputValidationState(input) {
            if (!input) return;
            input.style.borderColor = '';
            if (input.dataset?.validationError === '1' || input.title === 'Invalid number') {
                input.title = '';
            }
            if (input.dataset) delete input.dataset.validationError;
            input.removeAttribute('aria-invalid');
        }

        function setInputValue(id, value) {
            const input = document.getElementById(id);
            if (input) {
                if (isTimingInputId(id)) {
                    input.value = millisecondsToUiSeconds(value);
                } else {
                    input.value = value !== undefined && value !== null ? value : '';
                }
                clearInputValidationState(input);
            }
        }

        function getInputValue(id) {
            const input = document.getElementById(id);
            if (!input) return null;

            if (input.type === 'number') {
                const numericValue = Number(input.value);
                if (!Number.isFinite(numericValue)) return null;
                if (isTimingInputId(id)) {
                    return uiSecondsToMilliseconds(numericValue);
                }
                return Math.trunc(numericValue);
            }

            return input.value;
        }

        // Check for unsaved changes
        function checkForChanges() {
            // Don't check if configs aren't loaded yet
            if (!currentConfig || !originalConfig) {
                return false;
            }
            
            const sections = ['automation', 'cache', 'defaults', 'logging', 'api', 'preferences'];
            let hasChanges = false;
            let automationChanged = false;
            let cacheChanged = false;
            
            // Check credentials for changes
            const credentialsChanged = checkCredentialsChanged();
            if (credentialsChanged) hasChanges = true;
            
            sections.forEach(section => {
                let sectionChanged = false;
                
                // Check originalConfig section (which always exists after loading)
                if (originalConfig[section]) {
                    Object.keys(originalConfig[section]).forEach(key => {
                        // Skip blackoutWindows - handled separately
                        if (key === 'blackoutWindows') return;
                        
                        const inputId = `${section}_${key}`;
                        const input = document.getElementById(inputId);
                        if (!input) return;
                        
                        // Handle different input types appropriately
                        let currentValue;
                        if (input.tagName === 'SELECT') {
                            currentValue = input.value;
                        } else if (input.type === 'number') {
                            const numericValue = Number(input.value);
                            if (!Number.isFinite(numericValue)) {
                                currentValue = null;
                            } else if (isTimingInputId(inputId)) {
                                currentValue = uiSecondsToMilliseconds(numericValue);
                            } else {
                                currentValue = Math.trunc(numericValue);
                            }
                        } else {
                            // For text inputs, use the string value as-is
                            currentValue = input.value;
                        }
                        const originalValue = input.type === 'number'
                            ? (Number.isFinite(Number(originalConfig[section][key])) ? Number(originalConfig[section][key]) : null)
                            : originalConfig[section][key];
                        
                        if (currentValue !== originalValue) {
                            sectionChanged = true;
                            hasChanges = true;
                        }
                    });
                }

                if (section === 'automation') {
                    automationChanged = sectionChanged;
                    return;
                }
                if (section === 'cache') {
                    cacheChanged = sectionChanged;
                    return;
                }

                const badge = document.getElementById(`${section}Badge`);
                if (!badge) return;

                if (sectionChanged) {
                    badge.textContent = 'Modified';
                    badge.className = 'badge badge-modified';
                } else {
                    badge.textContent = 'Synced';
                    badge.className = 'badge badge-sync';
                }
            });

            const automationBadge = document.getElementById('automationBadge');
            if (automationBadge) {
                if (automationChanged || cacheChanged) {
                    automationBadge.textContent = 'Modified';
                    automationBadge.className = 'badge badge-modified';
                } else {
                    automationBadge.textContent = 'Synced';
                    automationBadge.className = 'badge badge-sync';
                }
            }
            
            // Check blackout windows separately
            const currentWindows = JSON.stringify(getBlackoutWindowsFromUI());
            const originalWindows = JSON.stringify(originalConfig.automation?.blackoutWindows || []);
            if (currentWindows !== originalWindows) {
                hasChanges = true;
                const badge = document.getElementById('blackoutBadge');
                if (badge) {
                    badge.textContent = 'Modified';
                    badge.className = 'badge badge-modified';
                }
            } else {
                const badge = document.getElementById('blackoutBadge');
                if (badge) {
                    badge.textContent = 'Synced';
                    badge.className = 'badge badge-sync';
                }
            }
            
            // Check curtailment settings separately
            const enabledButton = document.getElementById('curtailment_enabled');
            const thresholdInput = document.getElementById('curtailment_priceThreshold');
            
            const currentCurtailment = {
                enabled: enabledButton?.classList.contains('active') === true,
                priceThreshold: thresholdInput?.value !== '' && thresholdInput?.value !== null ? parseFloat(thresholdInput.value) : 0
            };
            
            // Normalize original curtailment values to match current format
            const originalCurtailment = originalConfig.curtailment || { enabled: false, priceThreshold: 0 };
            const normalizedOriginal = {
                enabled: originalCurtailment.enabled === true,
                priceThreshold: originalCurtailment.priceThreshold !== undefined ? parseFloat(originalCurtailment.priceThreshold) : 0
            };

            // Compare values directly instead of JSON strings to avoid precision issues
            const curtailmentChanged = 
                currentCurtailment.enabled !== normalizedOriginal.enabled ||
                currentCurtailment.priceThreshold !== normalizedOriginal.priceThreshold;

            if (curtailmentChanged) {
                hasChanges = true;
                const badge = document.getElementById('curtailmentBadge');
                if (badge) {
                    badge.textContent = 'Modified';
                    badge.className = 'badge badge-modified';
                }
            } else {
                const badge = document.getElementById('curtailmentBadge');
                if (badge) {
                    badge.textContent = 'Synced';
                    badge.className = 'badge badge-sync';
                }
            }
            
            // Check location (backend keeps both location and preferences.weatherPlace in sync)
            const currentLocation = document.getElementById('preferences_weatherPlace')?.value || 'Sydney, Australia';
            const originalLocation = originalConfig.location || (originalConfig.preferences?.weatherPlace) || 'Sydney, Australia';
            const locationChanged = currentLocation !== originalLocation;
            
            if (locationChanged) {
                hasChanges = true;
                const badge = document.getElementById('preferencesBadge');
                if (badge) {
                    badge.textContent = 'Modified';
                    badge.className = 'badge badge-modified';
                }
            } else {
                const badge = document.getElementById('preferencesBadge');
                if (badge && !hasChanges) {  // Only update if no other changes in preferences
                    badge.textContent = 'Synced';
                    badge.className = 'badge badge-sync';
                }
            }
            
            // Check hardware settings (stored flat at root level, not nested under a section)
            const currentInvKw = parseFloat(document.getElementById('hardware_inverterCapacityKw')?.value || '10');
            const currentBatKwh = parseFloat(document.getElementById('hardware_batteryCapacityKwh')?.value || '41.93');
            const origInvKw = (originalConfig.inverterCapacityW || 10000) / 1000;
            const origBatKwh = originalConfig.batteryCapacityKWh || 41.93;
            const hardwareChanged = Math.abs(currentInvKw - origInvKw) > 0.001 || Math.abs(currentBatKwh - origBatKwh) > 0.001;
            const hardwareBadgeEl = document.getElementById('hardwareBadge');
            if (hardwareBadgeEl) {
                hardwareBadgeEl.textContent = hardwareChanged ? 'Modified' : 'Synced';
                hardwareBadgeEl.className = hardwareChanged ? 'badge badge-modified' : 'badge badge-sync';
            }
            if (hardwareChanged) hasChanges = true;

            hasUnsavedChanges = hasChanges;
            return hasChanges;
        }

        // Update status display
        function updateStatus() {
            if (checkForChanges()) {
                setConfigStatus('warning', '⚠️ Unsaved');
            } else {
                setConfigStatus('ok', 'Up to Date');
            }
        }

        // Save all settings
        async function saveAllSettings() {
            try {
                // Collect all values
                const newConfig = {
                    automation: {
                        intervalMs: getInputValue('automation_intervalMs'),
                        // Hidden advanced fields preserved from current config.
                        startDelayMs: currentConfig?.automation?.startDelayMs ?? originalConfig?.automation?.startDelayMs ?? 5000,
                        gatherDataTimeoutMs: currentConfig?.automation?.gatherDataTimeoutMs ?? originalConfig?.automation?.gatherDataTimeoutMs ?? 8000,

                        blackoutWindows: getBlackoutWindowsFromUI()
                    },
                    cache: {
                        amber: getInputValue('cache_amber'),
                        inverter: getInputValue('cache_inverter'),
                        weather: getInputValue('cache_weather'),
                        teslaStatus: getInputValue('cache_teslaStatus')
                    },
                    defaults: {
                        cooldownMinutes: getInputValue('defaults_cooldownMinutes'),
                        durationMinutes: getInputValue('defaults_durationMinutes'),
                        fdPwr: getInputValue('defaults_fdPwr')
                    },
                    api: {
                        retryCount: currentConfig?.api?.retryCount ?? 3,
                        retryDelayMs: currentConfig?.api?.retryDelayMs ?? 1000
                    },
                    preferences: {
                        forecastDays: getInputValue('preferences_forecastDays') || 6,
                        weatherPlace: document.getElementById('preferences_weatherPlace')?.value || 'Sydney, Australia'
                    },
                    // Solar curtailment (price threshold range: -999 to +999 cents/kWh)
                    curtailment: {
                        enabled: document.getElementById('curtailment_enabled')?.classList.contains('active') === true,
                        priceThreshold: (() => {
                            const val = document.getElementById('curtailment_priceThreshold')?.value;
                            return val !== '' && val !== null ? parseFloat(val) : 0;
                        })()
                    },
                    // Also save location at root level for backward compatibility
                    location: document.getElementById('preferences_weatherPlace')?.value || 'Sydney, Australia',
                    // Hardware configuration (per-user inverter/battery specs, stored flat at config root)
                    inverterCapacityW: Math.round(parseFloat(document.getElementById('hardware_inverterCapacityKw')?.value || '10') * 1000),
                    batteryCapacityKWh: parseFloat(document.getElementById('hardware_batteryCapacityKwh')?.value || '41.93')
                };

                // Comprehensive validation
                const validationErrors = [];
                
                // Automation settings validation
                if (newConfig.automation.intervalMs < 20000 || newConfig.automation.intervalMs > 600000) {
                    validationErrors.push('Automation cycle: must be 20s-10m');
                }
                
                // Cache settings validation
                if (newConfig.cache.amber < 10000 || newConfig.cache.amber > 300000) {
                    validationErrors.push('Pricing data cache: must be 10s-5m');
                }
                if (newConfig.cache.inverter < 60000 || newConfig.cache.inverter > 600000) {
                    validationErrors.push('Inverter cache: must be 1m-10m (respect API rate limits)');
                }
                if (newConfig.cache.weather < 300000 || newConfig.cache.weather > 3600000) {
                    validationErrors.push('Weather cache: must be 5m-1h');
                }
                if (newConfig.cache.teslaStatus < 120000 || newConfig.cache.teslaStatus > 10000000) {
                    validationErrors.push('Tesla EV status cache: must be 120s-10000s');
                }
                
                // Hardware validation
                if (!newConfig.inverterCapacityW || newConfig.inverterCapacityW < 1000 || newConfig.inverterCapacityW > 30000) {
                    validationErrors.push('Inverter capacity: must be 1–30 kW (1,000–30,000 watts)');
                }
                if (!newConfig.batteryCapacityKWh || newConfig.batteryCapacityKWh < 1 || newConfig.batteryCapacityKWh > 500) {
                    validationErrors.push('Battery capacity: must be 1–500 kWh');
                }

                // Defaults validation
                if (newConfig.defaults.cooldownMinutes < 0 || newConfig.defaults.cooldownMinutes > 60) {
                    validationErrors.push('Default cooldown: must be 0-60 minutes');
                }
                if (newConfig.defaults.durationMinutes < 5 || newConfig.defaults.durationMinutes > 120) {
                    validationErrors.push('Default duration: must be 5-120 minutes');
                }
                if (newConfig.defaults.fdPwr < 1000 || newConfig.defaults.fdPwr > (newConfig.inverterCapacityW || 10000)) {
                    validationErrors.push(`Power setting: must be 1000–${newConfig.inverterCapacityW || 10000} watts (inverter capacity)`);
                }
                
                // Preferences validation
                if (newConfig.preferences.forecastDays < 1 || newConfig.preferences.forecastDays > 16) {
                    validationErrors.push('Forecast days: must be 1-16 days');
                }
                
                // Curtailment validation
                if (newConfig.curtailment.enabled) {
                    if (isNaN(newConfig.curtailment.priceThreshold) || newConfig.curtailment.priceThreshold < -999 || newConfig.curtailment.priceThreshold > 999) {
                        validationErrors.push('Curtailment price threshold: must be -999 to 999 cents/kWh');
                    }
                }
                
                if (validationErrors.length > 0) {
                    showMessage('warning', 'Validation errors:\n• ' + validationErrors.join('\n• '));
                    return;
                }

                const statusEl = document.getElementById('configStatus');
                if (statusEl) {
                    setConfigStatus('loading', 'Saving...');
                }

                // Add browser timezone for detection (most reliable source)
                const browserTz = apiClient.getBrowserTimezone();
                newConfig.browserTimezone = browserTz;

                const resp = await authenticatedFetch('/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(newConfig)
                });

                if (!resp.ok) {
                    // Try to extract structured error payload
                    try {
                        const err = await resp.json();
                        throw new Error(err?.msg || err?.error || `HTTP ${resp.status}`);
                    } catch (e) {
                        throw new Error(`HTTP ${resp.status}`);
                    }
                }

                const data = await resp.json();
                if (data.errno !== 0) throw new Error(data.msg || 'Failed to save config');

                // Capture previous location BEFORE overwriting originalConfig
                const prevSavedLoc = (originalConfig.location || originalConfig.preferences?.weatherPlace || '').trim().toLowerCase();

                // Update original config from server response
                originalConfig = JSON.parse(JSON.stringify(data.result));
                
                // Ensure curtailment config is properly initialized in originalConfig
                if (!originalConfig.curtailment) {
                    originalConfig.curtailment = { enabled: false, priceThreshold: 0 };
                }
                
                // Ensure preferences object exists
                if (!originalConfig.preferences) {
                    originalConfig.preferences = {};
                }
                
                currentConfig = data.result;

                // Refresh UI with saved values to prevent revert (backend keeps both fields in sync)
                const savedLocation = data.result.location || (data.result.preferences?.weatherPlace);
                if (savedLocation) {
                    const weatherInput = document.getElementById('preferences_weatherPlace');
                    if (weatherInput) weatherInput.value = savedLocation;
                }

                // Clear weather cache in localStorage if location changed so the dashboard
                // will fetch fresh data and show the correct timezone on next visit
                try {
                    const newSavedLoc = (savedLocation || '').trim().toLowerCase();
                    if (newSavedLoc && prevSavedLoc && newSavedLoc !== prevSavedLoc) {
                        const cs = JSON.parse(localStorage.getItem('cacheState') || '{}');
                        cs.weatherTime = 0;
                        localStorage.setItem('cacheState', JSON.stringify(cs));
                        localStorage.removeItem('cachedWeatherFull');
                    }
                } catch (e) { /* non-fatal */ }

                updateStatus();
                const savedAt = new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });
                document.getElementById('lastSaved').innerHTML = `<span class="status-state">${savedAt}</span>`;
                
                showMessage('success', '✅ Configuration saved to server and persisted to disk!');
            } catch (error) {
                showMessage('warning', `Failed to save configuration: ${error.message}`);
                updateStatus();
            }
        }

        function resetAutomationAndCache() {
            if (!confirm('Undo changes to automation and cache settings?')) return;
            ['automation', 'cache'].forEach(section => {
                if (!originalConfig[section]) return;
                Object.keys(originalConfig[section]).forEach(key => {
                    if (key === 'blackoutWindows') return;
                    setInputValue(`${section}_${key}`, originalConfig[section][key]);
                });
            });
            updateAllTimeDisplays();
            updateStatus();
        }

        // Reset section to defaults
        function resetSection(section) {
            if (!confirm(`Undo changes to ${section} settings?`)) return;
            
            if (originalConfig[section]) {
                Object.keys(originalConfig[section]).forEach(key => {
                    if (key === 'blackoutWindows') return;
                    setInputValue(`${section}_${key}`, originalConfig[section][key]);
                });
            }
            
            updateAllTimeDisplays();
            updateStatus();
        }
        
        // Blackout window functions
        function renderBlackoutWindows(windows) {
            const container = document.getElementById('blackoutWindowsList');
            if (!windows || windows.length === 0) {
                container.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;text-align:center;padding:20px">No blackout windows configured</div>';
                return;
            }
            
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            let html = '';
            windows.forEach((w, idx) => {
                const daysStr = w.days && w.days.length > 0 
                    ? w.days.map(d => dayNames[d]).join(', ')
                    : 'Every day';
                // Store the entire original object in a data attribute so getBlackoutWindowsFromUI can preserve all properties
                const windowData = JSON.stringify(w);
                html += `
                    <div class="setting-item blackout-window-row" data-window-idx="${idx}" data-window-original="${windowData.replace(/"/g, '&quot;')}">
                        <div class="blackout-window-times">
                            <input type="time" class="blackout-start" value="${w.start || '00:00'}" style="background:var(--bg-input);border:1px solid var(--border-primary);color:var(--text-primary);padding:6px;border-radius:4px;">
                            <span style="color:var(--text-secondary);white-space:nowrap;">to</span>
                            <input type="time" class="blackout-end" value="${w.end || '23:59'}" style="background:var(--bg-input);border:1px solid var(--border-primary);color:var(--text-primary);padding:6px;border-radius:4px;">
                            <span style="color:var(--text-secondary);font-size:12px;white-space:nowrap;">(${daysStr})</span>
                        </div>
                        <button onclick="removeBlackoutWindow(${idx})" style="background:var(--color-danger-bg);border:1px solid var(--color-danger);color:var(--color-danger);padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;white-space:nowrap;">🗑️ Remove</button>
                    </div>
                `;
            });
            container.innerHTML = html;
            
            // Add change listeners
            container.querySelectorAll('input').forEach(input => {
                input.addEventListener('change', updateStatus);
            });
        }
        
        function getBlackoutWindowsFromUI() {
            const container = document.getElementById('blackoutWindowsList');
            const items = container.querySelectorAll('[data-window-idx]');
            const windows = [];
            items.forEach(item => {
                const start = item.querySelector('.blackout-start')?.value;
                const end = item.querySelector('.blackout-end')?.value;
                if (start && end) {
                    // Try to get the original object from the data attribute to preserve all properties
                    const originalData = item.getAttribute('data-window-original');
                    if (originalData) {
                        try {
                            const original = JSON.parse(originalData);
                            // Update only the times, keep everything else
                            windows.push({ ...original, start, end });
                        } catch (e) {
                            // Fallback if parsing fails
                            windows.push({ enabled: true, start, end, days: [] });
                        }
                    } else {
                        // Fallback for new windows that haven't been saved yet
                        windows.push({ enabled: true, start, end, days: [] });
                    }
                }
            });
            return windows;
        }
        
        function addBlackoutWindow() {
            const current = getBlackoutWindowsFromUI();
            current.push({ enabled: true, start: '22:00', end: '06:00', days: [] });
            renderBlackoutWindows(current);
            updateStatus();
        }
        
        function removeBlackoutWindow(idx) {
            const current = getBlackoutWindowsFromUI();
            current.splice(idx, 1);
            renderBlackoutWindows(current);
            updateStatus();
        }
        
        // Curtailment toggle button handler
        function toggleCurtailmentButton(button) {
            button.classList.toggle('active');
            const isActive = button.classList.contains('active');
            button.querySelector('.curtailment-state').textContent = isActive ? 'Enabled' : 'Disabled';
            updateCurtailmentChanges();
        }
        
        // Update curtailment change status
        function updateCurtailmentChanges() {
            updateStatus();
        }
        
        // Factory reset removed for safety — endpoint not present in backend
        // If you need a safe reset flow, implement /api/config/reset on the server

        // Define validation rules for each input
        const validationRules = {
            'automation_intervalMs': {
                min: 20, max: 600,
                errorMsg: 'Automation cycle must be 20s-10m'
            },
            'cache_amber': {
                min: 10, max: 300,
                errorMsg: 'Pricing data cache must be 10s-5m'
            },
            'cache_inverter': {
                min: 60, max: 600,
                errorMsg: 'Inverter cache must be 1m-10m (respect API rate limits)'
            },
            'cache_weather': {
                min: 300, max: 3600,
                errorMsg: 'Weather cache must be 5m-1h'
            },
            'cache_teslaStatus': {
                min: 120, max: 10000,
                errorMsg: 'Tesla EV status cache must be 120s-10000s'
            },
            'defaults_cooldownMinutes': {
                min: 0, max: 60,
                errorMsg: 'Cooldown must be 0-60 minutes'
            },
            'defaults_durationMinutes': {
                min: 5, max: 120,
                errorMsg: 'Duration must be 5-120 minutes'
            },
            'defaults_fdPwr': {
                min: 1000, max: 10000,
                errorMsg: 'Power must be 1000-10000 watts'
            },
            'api_retryCount': {
                min: 0, max: 10,
                errorMsg: 'Retry count must be 0-10 attempts'
            },
            'api_retryDelayMs': {
                min: 100, max: 10000,
                errorMsg: 'Retry delay must be 100-10000ms (0.1-10 seconds)'
            },
            'preferences_forecastDays': {
                min: 1, max: 16,
                errorMsg: 'Forecast days must be 1-16 days'
            }
        };

        // Validate a numeric input against its rules
        function validateInput(input) {
            const id = input.id;
            
            // Skip validation for disabled inputs (they haven't loaded from server yet)
            if (input.disabled) {
                input.style.borderColor = '';
                input.title = '';
                return true;
            }
            
            const rules = validationRules[id];
            
            if (!rules) return true; // No validation rules defined
            
            const value = parseFloat(input.value);
            if (isNaN(value)) {
                input.style.borderColor = 'var(--color-danger)';
                input.title = 'Invalid number';
                input.dataset.validationError = '1';
                input.setAttribute('aria-invalid', 'true');
                return false;
            }
            
            if (value < rules.min || value > rules.max) {
                input.style.borderColor = 'var(--color-danger)';
                input.title = rules.errorMsg;
                input.dataset.validationError = '1';
                input.setAttribute('aria-invalid', 'true');
                return false;
            }
            
            // Valid
            input.style.borderColor = '';
            if (input.dataset.validationError === '1' || input.title === 'Invalid number' || input.title === rules.errorMsg) {
                input.title = '';
            }
            delete input.dataset.validationError;
            input.removeAttribute('aria-invalid');
            return true;
        }

        // Add change listeners to all inputs
        document.addEventListener('DOMContentLoaded', () => {
            // Add change listeners for status and time displays
            document.querySelectorAll('input[type="number"]').forEach(input => {
                input.addEventListener('input', () => {
                    validateInput(input);
                    updateStatus();
                    updateTimeDisplay(input.id);
                });
                input.addEventListener('blur', () => {
                    validateInput(input);
                });
                // Skip validation on page load - all inputs start disabled
            });
            
            // Add change listener for select
            document.querySelectorAll('select').forEach(select => {
                select.addEventListener('change', updateStatus);
            });
            
            // Add change listener for text inputs (especially preferences section)
            document.querySelectorAll('input[type="text"]').forEach(input => {
                input.addEventListener('input', updateStatus);
            });

            bindTeslaOnboardingHandlers();
            updateTeslaRedirectUriInput();

            // Initialize time displays
            updateAllTimeDisplays();
            // Credentials toggles
            const tFox = document.getElementById('credentials_toggleFoxess');
            const tAmber = document.getElementById('credentials_toggleAmber');
            if (tFox) {
                tFox.addEventListener('click', (e) => {
                    togglePasswordField('credentials_foxessToken', tFox);
                });
            }
            if (tAmber) {
                tAmber.addEventListener('click', (e) => {
                    togglePasswordField('credentials_amberKey', tAmber);
                });
            }
            const tSungrowPass = document.getElementById('credentials_toggleSungrowPassword');
            if (tSungrowPass) {
                tSungrowPass.addEventListener('click', () => {
                    togglePasswordField('credentials_sungrowPassword', tSungrowPass);
                });
            }
            const tSigenenergyPass = document.getElementById('credentials_toggleSigenenergyPassword');
            if (tSigenenergyPass) {
                tSigenenergyPass.addEventListener('click', () => {
                    togglePasswordField('credentials_sigenenergyPassword', tSigenenergyPass);
                });
            }
            const tAlphaEssSecret = document.getElementById('credentials_toggleAlphaessSecret');
            if (tAlphaEssSecret) {
                tAlphaEssSecret.addEventListener('click', () => {
                    togglePasswordField('credentials_alphaessAppSecret', tAlphaEssSecret);
                });
            }
        });

        function togglePasswordField(inputId, btn) {
            const input = document.getElementById(inputId);
            if (!input) {
                return;
            }
            
            if (input.type === 'password') {
                // Show actual value when toggling to text
                if (input.dataset.actualValue) {
                    input.value = input.dataset.actualValue;
                }
                input.type = 'text';
                btn.textContent = 'Hide';
            } else {
                // Hide - show masked dots again
                input.value = '••••••••';
                input.type = 'password';
                btn.textContent = 'Show';
            }
        }

        function setSavedCredentialFlag(input, isPresent) {
            if (!input) return;
            if (isPresent) {
                input.dataset.hasSavedCredential = '1';
            } else {
                delete input.dataset.hasSavedCredential;
            }
        }

        function isMaskedCredentialValue(value) {
            if (!value) return false;
            return /^[•*]+$/.test(value.trim());
        }

        // Load only credentials status (reload deviceSn and token presence)
        function checkCredentialsChanged() {
            const isAlphaEss = document.getElementById('alphaessCredentialsSection')?.style.display !== 'none';
            const isSungrow = document.getElementById('sungrowCredentialsSection')?.style.display !== 'none';
            const isSigenEnergy = document.getElementById('sigenenergyCredentialsSection')?.style.display !== 'none';
            const amberInput = document.getElementById('credentials_amberKey');
            const amberKey = (amberInput?.value || '').trim();
            const amberMatchesOriginal = amberKey === (originalCredentials.amberKey || '');
            const amberMaskedSaved = isMaskedCredentialValue(amberKey) && amberInput?.dataset.hasSavedCredential === '1';

            let changed;
            if (isSigenEnergy) {
                const sgUserInput = document.getElementById('credentials_sigenenergyUsername');
                const sgPassInput = document.getElementById('credentials_sigenenergyPassword');
                const sgUser = (sgUserInput?.value || '').trim();
                const sgPass = (sgPassInput?.value || '').trim();
                const sgUserChanged = !(sgUser === (originalCredentials.sigenenergyUsername || '') ||
                    (isMaskedCredentialValue(sgUser) && sgUserInput?.dataset.hasSavedCredential === '1'));
                const sgPassChanged = !(sgPass === (originalCredentials.sigenenergyPassword || '') ||
                    (isMaskedCredentialValue(sgPass) && sgPassInput?.dataset.hasSavedCredential === '1'));
                changed = sgUserChanged || sgPassChanged ||
                    !(amberMatchesOriginal || amberMaskedSaved);
            } else if (isAlphaEss) {
                const snInput = document.getElementById('credentials_alphaessSystemSn');
                const appIdInput = document.getElementById('credentials_alphaessAppId');
                const appSecretInput = document.getElementById('credentials_alphaessAppSecret');
                const systemSn = (snInput?.value || '').trim();
                const appId = (appIdInput?.value || '').trim();
                const appSecret = (appSecretInput?.value || '').trim();
                const systemSnChanged = systemSn !== (originalCredentials.alphaessSystemSn || '');
                const appIdChanged = !(appId === (originalCredentials.alphaessAppId || '') ||
                    (isMaskedCredentialValue(appId) && appIdInput?.dataset.hasSavedCredential === '1'));
                const appSecretChanged = !(appSecret === (originalCredentials.alphaessAppSecret || '') ||
                    (isMaskedCredentialValue(appSecret) && appSecretInput?.dataset.hasSavedCredential === '1'));
                changed = systemSnChanged || appIdChanged || appSecretChanged ||
                    !(amberMatchesOriginal || amberMaskedSaved);
            } else if (isSungrow) {
                const sgSnInput = document.getElementById('credentials_sungrowDeviceSn');
                const sgUserInput = document.getElementById('credentials_sungrowUsername');
                const sgPassInput = document.getElementById('credentials_sungrowPassword');
                const sgSn = (sgSnInput?.value || '').trim();
                const sgUser = (sgUserInput?.value || '').trim();
                const sgPass = (sgPassInput?.value || '').trim();
                const sgSnChanged = sgSn !== (originalCredentials.sungrowDeviceSn || '');
                const sgUserChanged = !(sgUser === (originalCredentials.sungrowUsername || '') ||
                    (isMaskedCredentialValue(sgUser) && sgUserInput?.dataset.hasSavedCredential === '1'));
                const sgPassChanged = !(sgPass === (originalCredentials.sungrowPassword || '') ||
                    (isMaskedCredentialValue(sgPass) && sgPassInput?.dataset.hasSavedCredential === '1'));
                changed = sgSnChanged || sgUserChanged || sgPassChanged ||
                    !(amberMatchesOriginal || amberMaskedSaved);
            } else {
                const deviceSn = (document.getElementById('credentials_deviceSn')?.value || '').trim();
                const foxessInput = document.getElementById('credentials_foxessToken');
                const foxessToken = (foxessInput?.value || '').trim();
                const foxessMatchesOriginal = foxessToken === (originalCredentials.foxessToken || '');
                const foxessMaskedSaved = isMaskedCredentialValue(foxessToken) && foxessInput?.dataset.hasSavedCredential === '1';
                const credentialsChanged = !(foxessMatchesOriginal || foxessMaskedSaved) ||
                    !(amberMatchesOriginal || amberMaskedSaved);
                changed = (deviceSn !== originalCredentials.deviceSn) || credentialsChanged;
            }
            
            const badge = document.getElementById('credentialsBadge');
            if (badge) {
                if (changed) {
                    badge.textContent = 'Modified';
                    badge.className = 'badge badge-modified';
                } else {
                    badge.textContent = 'Synced';
                    badge.className = 'badge badge-sync';
                }
            }
            return changed;
        }
        
        async function loadCredentials() {
            try {
                const [configResp, healthResp, statusResp] = await Promise.all([
                    authenticatedFetch('/api/config?t=' + Date.now()),
                    authenticatedFetch('/api/health'),
                    authenticatedFetch('/api/config/setup-status').catch(() => null)
                ]);
                const data = await configResp.json();
                const health = await healthResp.json();
                const statusData = statusResp ? await statusResp.json().catch(() => null) : null;

                const deviceProvider = statusData?.result?.deviceProvider || 'foxess';
                const hasAlphaEssSystemSn = statusData?.result?.hasAlphaEssSystemSn || false;
                const hasAlphaEssAppId = statusData?.result?.hasAlphaEssAppId || false;
                const hasAlphaEssAppSecret = statusData?.result?.hasAlphaEssAppSecret || false;
                const hasSungrowUsername = statusData?.result?.hasSungrowUsername || false;
                const hasSungrowDeviceSn = statusData?.result?.hasSungrowDeviceSn || false;
                const hasSigenUsername = statusData?.result?.hasSigenUsername || false;
                const hasSigenDeviceSn = statusData?.result?.hasSigenDeviceSn || false;

                // Show/hide provider-specific credential sections
                const foxessSec = document.getElementById('foxessCredentialsSection');
                const foxessTokenSec = document.getElementById('foxessTokenSection');
                const alphaEssSec = document.getElementById('alphaessCredentialsSection');
                const sungrowSec = document.getElementById('sungrowCredentialsSection');
                const sigenergySec = document.getElementById('sigenenergyCredentialsSection');
                const curtailmentSec = document.getElementById('curtailmentSection');
                const isAlphaEss = deviceProvider === 'alphaess';
                const isSungrow = deviceProvider === 'sungrow';
                const isSigenEnergy = deviceProvider === 'sigenergy';
                const isFoxess = !isAlphaEss && !isSungrow && !isSigenEnergy;
                if (foxessSec) foxessSec.style.display = (isAlphaEss || isSungrow || isSigenEnergy) ? 'none' : '';
                if (foxessTokenSec) foxessTokenSec.style.display = (isAlphaEss || isSungrow || isSigenEnergy) ? 'none' : '';
                if (alphaEssSec) alphaEssSec.style.display = isAlphaEss ? '' : 'none';
                if (sungrowSec) sungrowSec.style.display = isSungrow ? '' : 'none';
                if (sigenergySec) sigenergySec.style.display = isSigenEnergy ? '' : 'none';
                if (curtailmentSec) curtailmentSec.style.display = isFoxess ? '' : 'none';

                if (data.errno === 0 && data.result) {
                    if (isSigenEnergy) {
                        // No non-credential config fields for SigenEnergy on this path
                    } else if (isAlphaEss) {
                        const alphaSystemSnInput = document.getElementById('credentials_alphaessSystemSn');
                        const systemSnVal = data.result.alphaessSystemSn || '';
                        if (alphaSystemSnInput) {
                            alphaSystemSnInput.value = systemSnVal;
                            originalCredentials.alphaessSystemSn = systemSnVal;
                        }
                    } else if (isSungrow) {
                        const sgSnInput = document.getElementById('credentials_sungrowDeviceSn');
                        const snVal = data.result.sungrowDeviceSn || '';
                        if (sgSnInput) {
                            sgSnInput.value = snVal;
                            originalCredentials.sungrowDeviceSn = snVal;
                        }
                    } else {
                        const deviceSn = data.result.deviceSn || '';
                        document.getElementById('credentials_deviceSn').value = deviceSn;
                        originalCredentials.deviceSn = deviceSn;
                    }
                }

                const foxessPresent = !isAlphaEss && !isSungrow && !isSigenEnergy && health && health.FOXESS_TOKEN;
                const amberPresent = health && health.AMBER_API_KEY;

                // Get actual credential values from config (only available for foxess path)
                const actualFoxess = data.result?.foxessToken || '';
                const actualAmber = data.result?.amberApiKey || '';

                const foxessInput = document.getElementById('credentials_foxessToken');
                const amberInput = document.getElementById('credentials_amberKey');

                // Show masked credentials if they exist, and keep actual values for Show/Hide when available.
                // Always reset input type to password so the masked display is properly hidden after reload.
                if (foxessPresent) {
                    foxessInput.value = '••••••••';
                    foxessInput.type = 'password';
                    const tFox = document.getElementById('credentials_toggleFoxess');
                    if (tFox) tFox.textContent = 'Show';
                    if (actualFoxess) {
                        foxessInput.dataset.actualValue = actualFoxess;
                    }
                    originalCredentials.foxessToken = '••••••••';
                    setSavedCredentialFlag(foxessInput, true);
                } else {
                    foxessInput.value = '';
                    foxessInput.type = 'password';
                    const tFox = document.getElementById('credentials_toggleFoxess');
                    if (tFox) tFox.textContent = 'Show';
                    delete foxessInput.dataset.actualValue;
                    originalCredentials.foxessToken = '';
                    setSavedCredentialFlag(foxessInput, false);
                }

                if (amberPresent) {
                    amberInput.value = '••••••••';
                    amberInput.type = 'password';
                    const tAmber = document.getElementById('credentials_toggleAmber');
                    if (tAmber) tAmber.textContent = 'Show';
                    if (actualAmber) {
                        amberInput.dataset.actualValue = actualAmber;
                    }
                    originalCredentials.amberKey = '••••••••';
                    setSavedCredentialFlag(amberInput, true);
                } else {
                    amberInput.value = '';
                    amberInput.type = 'password';
                    const tAmber = document.getElementById('credentials_toggleAmber');
                    if (tAmber) tAmber.textContent = 'Show';
                    delete amberInput.dataset.actualValue;
                    originalCredentials.amberKey = '';
                    setSavedCredentialFlag(amberInput, false);
                }

                // AlphaESS: show masked presence indicators for app ID + app secret
                if (isAlphaEss) {
                    const alphaAppIdInput = document.getElementById('credentials_alphaessAppId');
                    const alphaAppSecretInput = document.getElementById('credentials_alphaessAppSecret');
                    if (alphaAppIdInput) {
                        if (hasAlphaEssAppId) {
                            alphaAppIdInput.value = '••••••••';
                            setSavedCredentialFlag(alphaAppIdInput, true);
                            originalCredentials.alphaessAppId = '••••••••';
                        } else {
                            alphaAppIdInput.value = '';
                            setSavedCredentialFlag(alphaAppIdInput, false);
                            originalCredentials.alphaessAppId = '';
                        }
                    }
                    if (alphaAppSecretInput) {
                        alphaAppSecretInput.type = 'password';
                        const tAlpha = document.getElementById('credentials_toggleAlphaessSecret');
                        if (tAlpha) tAlpha.textContent = 'Show';
                        if (hasAlphaEssAppSecret) {
                            alphaAppSecretInput.value = '••••••••';
                            setSavedCredentialFlag(alphaAppSecretInput, true);
                            originalCredentials.alphaessAppSecret = '••••••••';
                        } else {
                            alphaAppSecretInput.value = '';
                            setSavedCredentialFlag(alphaAppSecretInput, false);
                            originalCredentials.alphaessAppSecret = '';
                        }
                    }
                }

                // Sungrow: show masked presence indicators for username/password
                if (isSungrow) {
                    const sgUserInput = document.getElementById('credentials_sungrowUsername');
                    const sgPassInput = document.getElementById('credentials_sungrowPassword');
                    if (sgUserInput) {
                        if (hasSungrowUsername) {
                            sgUserInput.value = '••••••••';
                            setSavedCredentialFlag(sgUserInput, true);
                            originalCredentials.sungrowUsername = '••••••••';
                        } else {
                            sgUserInput.value = '';
                            setSavedCredentialFlag(sgUserInput, false);
                            originalCredentials.sungrowUsername = '';
                        }
                    }
                    if (sgPassInput) {
                        sgPassInput.type = 'password';
                        const tSg = document.getElementById('credentials_toggleSungrowPassword');
                        if (tSg) tSg.textContent = 'Show';
                        if (hasSungrowUsername) {
                            sgPassInput.value = '••••••••';
                            setSavedCredentialFlag(sgPassInput, true);
                            originalCredentials.sungrowPassword = '••••••••';
                        } else {
                            sgPassInput.value = '';
                            setSavedCredentialFlag(sgPassInput, false);
                            originalCredentials.sungrowPassword = '';
                        }
                    }
                }

                // SigenEnergy: show masked presence indicators for username/password
                if (isSigenEnergy) {
                    const sgUserInput = document.getElementById('credentials_sigenenergyUsername');
                    const sgPassInput = document.getElementById('credentials_sigenenergyPassword');
                    const sgRegionInput = document.getElementById('credentials_sigenenergyRegion');
                    if (sgUserInput) {
                        if (hasSigenUsername) {
                            sgUserInput.value = '••••••••';
                            setSavedCredentialFlag(sgUserInput, true);
                            originalCredentials.sigenenergyUsername = '••••••••';
                        } else {
                            sgUserInput.value = '';
                            setSavedCredentialFlag(sgUserInput, false);
                            originalCredentials.sigenenergyUsername = '';
                        }
                    }
                    if (sgPassInput) {
                        sgPassInput.type = 'password';
                        const tSg = document.getElementById('credentials_toggleSigenenergyPassword');
                        if (tSg) tSg.textContent = 'Show';
                        if (hasSigenUsername) {
                            sgPassInput.value = '••••••••';
                            setSavedCredentialFlag(sgPassInput, true);
                            originalCredentials.sigenenergyPassword = '••••••••';
                        } else {
                            sgPassInput.value = '';
                            setSavedCredentialFlag(sgPassInput, false);
                            originalCredentials.sigenenergyPassword = '';
                        }
                    }
                    if (sgRegionInput && data.result?.sigenRegion) {
                        sgRegionInput.value = data.result.sigenRegion;
                    }
                }

                const credStatusEl = document.getElementById('credentialsStatus');

                if (isAlphaEss) {
                    if (hasAlphaEssSystemSn && hasAlphaEssAppId && hasAlphaEssAppSecret) {
                        credStatusEl.textContent = 'AlphaESS system SN and app credentials are present (hidden)';
                    } else if (hasAlphaEssAppId || hasAlphaEssAppSecret) {
                        credStatusEl.textContent = 'AlphaESS app credentials partially configured — verify App ID/Secret and system SN';
                    } else {
                        credStatusEl.textContent = 'No AlphaESS credentials detected';
                    }
                    if (amberPresent) credStatusEl.textContent += ' · pricing API key present';
                } else if (isSigenEnergy) {
                    if (hasSigenUsername) {
                        credStatusEl.textContent = 'SigenEnergy credentials are present (hidden)';
                    } else {
                        credStatusEl.textContent = 'No SigenEnergy credentials detected';
                    }
                    if (amberPresent) credStatusEl.textContent += ' · pricing API key present';
                } else if (isSungrow) {
                    if (hasSungrowUsername && hasSungrowDeviceSn) {
                        credStatusEl.textContent = 'Sungrow device SN and iSolarCloud credentials are present (hidden)';
                    } else if (hasSungrowUsername) {
                        credStatusEl.textContent = 'iSolarCloud credentials present — device serial number not set';
                    } else {
                        credStatusEl.textContent = 'No Sungrow credentials detected';
                    }
                    if (amberPresent) {
                        credStatusEl.textContent += ' · pricing API key present';
                    }
                } else if (foxessPresent && amberPresent) {
                    credStatusEl.textContent = 'Inverter token and pricing API key are present (hidden)';
                } else if (foxessPresent) {
                    credStatusEl.textContent = 'Inverter token is present (hidden) — pricing API key not set';
                } else if (amberPresent) {
                    credStatusEl.textContent = 'Pricing API key is present (hidden) — inverter token not set';
                } else {
                    credStatusEl.textContent = 'No credentials detected';
                }

                // Update badge after reload
                checkCredentialsChanged();
                updateStatus();
                await loadTeslaVehicles({ silent: true });
            } catch (e) {
                console.warn('loadCredentials failed', e);
            }
        }

        // Save credentials by calling validate-keys endpoint which also sets them on server when valid
        async function saveCredentials() {
            const amberInput = document.getElementById('credentials_amberKey');
            const amberDisplayed = (amberInput?.value || '').trim();
            const originalAmber = (originalCredentials.amberKey || '').trim();
            const amberHasSavedFlag = amberInput?.dataset.hasSavedCredential === '1';
            const amberHasExistingCredential = amberHasSavedFlag ||
                !!amberInput?.dataset.actualValue ||
                isMaskedCredentialValue(originalAmber) ||
                isMaskedCredentialValue(amberDisplayed);
            const amberUnchangedHidden = isMaskedCredentialValue(amberDisplayed) && amberHasExistingCredential;
            const amberShownUnchanged = !!amberInput?.dataset.actualValue &&
                amberDisplayed === amberInput.dataset.actualValue &&
                (isMaskedCredentialValue(originalAmber) || amberHasExistingCredential);
            const amberUnchanged = amberUnchangedHidden || amberShownUnchanged;
            const amberKey = (amberDisplayed === originalAmber && amberInput?.dataset.actualValue)
                ? amberInput.dataset.actualValue
                : amberDisplayed;
            const amberToSend = amberUnchanged ? null : (amberKey || null);

            // Detect current provider from visible section
            const isAlphaEss = document.getElementById('alphaessCredentialsSection')?.style.display !== 'none';
            const isSungrow = document.getElementById('sungrowCredentialsSection')?.style.display !== 'none';
            const isSigenEnergy = document.getElementById('sigenenergyCredentialsSection')?.style.display !== 'none';

            if (isSigenEnergy) {
                return saveSigenEnergyCredentials(amberToSend, amberUnchanged);
            }

            if (isAlphaEss) {
                return saveAlphaEssCredentials(amberToSend, amberUnchanged);
            }

            if (isSungrow) {
                return saveSungrowCredentials(amberToSend, amberUnchanged);
            }

            // --- FoxESS path ---
            const deviceSn = (document.getElementById('credentials_deviceSn')?.value || '').trim();
            const foxessInput = document.getElementById('credentials_foxessToken');
            const foxessDisplayed = (foxessInput?.value || '').trim();
            const originalFoxess = (originalCredentials.foxessToken || '').trim();
            const foxessHasSavedFlag = foxessInput?.dataset.hasSavedCredential === '1';
            const foxessHasExistingCredential = foxessHasSavedFlag ||
                !!foxessInput?.dataset.actualValue ||
                isMaskedCredentialValue(originalFoxess) ||
                isMaskedCredentialValue(foxessDisplayed);
            const foxessUnchangedHidden = isMaskedCredentialValue(foxessDisplayed) && foxessHasExistingCredential;
            const foxessShownUnchanged = !!foxessInput?.dataset.actualValue &&
                foxessDisplayed === foxessInput.dataset.actualValue &&
                (isMaskedCredentialValue(originalFoxess) || foxessHasExistingCredential);
            const foxessUnchanged = foxessUnchangedHidden || foxessShownUnchanged;
            const foxessToken = (foxessDisplayed === originalFoxess && foxessInput?.dataset.actualValue)
                ? foxessInput.dataset.actualValue
                : foxessDisplayed;
            const tokenToSend = foxessUnchanged ? null : (foxessToken || null);

            // Safety guard: never send the masked placeholder to validate-keys.
            if (tokenToSend && isMaskedCredentialValue(tokenToSend)) {
                const recoveredToken = foxessInput?.dataset.actualValue || null;
                if (!recoveredToken) {
                    showMessage('warning', 'Enter a new token or keep the existing hidden token unchanged.');
                    return;
                }
                const patchPayload = { deviceSn };
                if (!amberUnchanged && amberToSend) patchPayload.amberApiKey = amberToSend;
                const pr = await authenticatedFetch('/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(patchPayload)
                });
                const pd = await pr.json();
                if (!pr.ok || pd.errno !== 0) throw new Error(pd?.msg || pd?.error || `HTTP ${pr.status}`);
                await loadCredentials();
                showMessage('success', 'Credential changes saved.');
                return;
            }

            if (!deviceSn) {
                showMessage('warning', 'Device Serial Number is required');
                return;
            }
            if (!foxessUnchanged && !tokenToSend) {
                showMessage('warning', 'Inverter API Token is required (enter a token or keep the saved hidden token unchanged).');
                return;
            }

            const saveBtn = document.getElementById('credentialsSaveBtn');
            const prevText = saveBtn.innerHTML;
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="spinner"></span> Saving...';

            try {
                if (foxessUnchanged) {
                    const patchPayload = { deviceSn };
                    if (!amberUnchanged) {
                        patchPayload.amberApiKey = amberToSend || '';
                    }
                    const patchResp = await authenticatedFetch('/api/config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(patchPayload)
                    });
                    const patchData = await patchResp.json();
                    if (!patchResp.ok || patchData.errno !== 0) {
                        throw new Error(patchData?.msg || patchData?.error || `HTTP ${patchResp.status}`);
                    }
                    await loadCredentials();
                    showMessage('success', 'Credential changes saved. Existing inverter token was kept unchanged.');
                    return;
                }

                const resp = await authenticatedFetch('/api/config/validate-keys', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ device_sn: deviceSn, foxess_token: tokenToSend, amber_api_key: amberToSend })
                });
                const data = await resp.json();
                if (data.errno !== 0) {
                    console.warn('validate-keys errors', data);
                    const first = (data.errors && (data.errors.foxess_token || data.errors.device_sn || data.msg)) || 'Validation failed';
                    showMessage('warning', first);
                    return;
                }

                await loadCredentials();
                showMessage('success', 'Credentials validated and stored on server');
            } catch (e) {
                console.error('saveCredentials error', e);
                showMessage('warning', 'Failed to save credentials: ' + (e.message || e));
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerHTML = prevText;
                updateStatus();
            }
        }

        async function saveSigenEnergyCredentials(amberToSend, amberUnchanged) {
            const usernameInput = document.getElementById('credentials_sigenenergyUsername');
            const passwordInput = document.getElementById('credentials_sigenenergyPassword');
            const regionInput  = document.getElementById('credentials_sigenenergyRegion');

            const usernameDisplayed = (usernameInput?.value || '').trim();
            const passwordDisplayed = (passwordInput?.value || '').trim();
            const region = (regionInput?.value || '').trim() || 'apac';

            const usernameUnchanged = isMaskedCredentialValue(usernameDisplayed) &&
                usernameInput?.dataset.hasSavedCredential === '1';
            const passwordUnchanged = isMaskedCredentialValue(passwordDisplayed) &&
                passwordInput?.dataset.hasSavedCredential === '1';
            const credsUnchanged = usernameUnchanged && passwordUnchanged;

            if (!credsUnchanged && (!usernameDisplayed || isMaskedCredentialValue(usernameDisplayed))) {
                showMessage('warning', 'SigenEnergy account email is required (or keep existing credentials unchanged)');
                return;
            }
            if (!credsUnchanged && (!passwordDisplayed || isMaskedCredentialValue(passwordDisplayed))) {
                showMessage('warning', 'SigenEnergy password is required (or keep existing credentials unchanged)');
                return;
            }

            const saveBtn = document.getElementById('credentialsSaveBtn');
            const prevText = saveBtn.innerHTML;
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="spinner"></span> Saving...';

            try {
                if (credsUnchanged) {
                    // Only region (and optionally amber key) changed
                    const patchPayload = { sigenRegion: region };
                    if (!amberUnchanged) patchPayload.amberApiKey = amberToSend || '';
                    const patchResp = await authenticatedFetch('/api/config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(patchPayload)
                    });
                    const patchData = await patchResp.json();
                    if (!patchResp.ok || patchData.errno !== 0) {
                        throw new Error(patchData?.msg || patchData?.error || `HTTP ${patchResp.status}`);
                    }
                    await loadCredentials();
                    showMessage('success', 'Credential changes saved.');
                    return;
                }

                const payload = {
                    sigenergy_username: usernameDisplayed,
                    sigenergy_password: passwordDisplayed,
                    sigenergy_region:   region
                };
                if (!amberUnchanged) payload.amber_api_key = amberToSend || null;

                const resp = await authenticatedFetch('/api/config/validate-keys', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await resp.json();
                if (data.errno !== 0) {
                    console.warn('validate-keys errors (sigenergy)', data);
                    const first = (data.errors && (
                        data.errors.sigenergy_username || data.errors.sigenergy_password || data.msg
                    )) || 'SigenEnergy validation failed';
                    showMessage('warning', first);
                    return;
                }

                await loadCredentials();
                showMessage('success', 'SigenEnergy credentials validated and stored on server');
            } catch (e) {
                console.error('saveSigenEnergyCredentials error', e);
                showMessage('warning', 'Failed to save credentials: ' + (e.message || e));
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerHTML = prevText;
                updateStatus();
            }
        }

        async function saveSungrowCredentials(amberToSend, amberUnchanged) {
            const deviceSnInput = document.getElementById('credentials_sungrowDeviceSn');
            const usernameInput = document.getElementById('credentials_sungrowUsername');
            const passwordInput = document.getElementById('credentials_sungrowPassword');

            const deviceSn = (deviceSnInput?.value || '').trim();
            const usernameDisplayed = (usernameInput?.value || '').trim();
            const passwordDisplayed = (passwordInput?.value || '').trim();

            const usernameUnchanged = isMaskedCredentialValue(usernameDisplayed) &&
                usernameInput?.dataset.hasSavedCredential === '1';
            const passwordUnchanged = isMaskedCredentialValue(passwordDisplayed) &&
                passwordInput?.dataset.hasSavedCredential === '1';
            const credsUnchanged = usernameUnchanged && passwordUnchanged;

            if (!deviceSn) {
                showMessage('warning', 'Sungrow Device Serial Number is required');
                return;
            }
            if (!credsUnchanged && (!usernameDisplayed || isMaskedCredentialValue(usernameDisplayed))) {
                showMessage('warning', 'iSolarCloud email is required (or keep existing credentials unchanged)');
                return;
            }
            if (!credsUnchanged && (!passwordDisplayed || isMaskedCredentialValue(passwordDisplayed))) {
                showMessage('warning', 'iSolarCloud password is required (or keep existing credentials unchanged)');
                return;
            }

            const saveBtn = document.getElementById('credentialsSaveBtn');
            const prevText = saveBtn.innerHTML;
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="spinner"></span> Saving...';

            try {
                if (credsUnchanged) {
                    // Only device SN (and optionally amber key) changed
                    const patchPayload = { sungrowDeviceSn: deviceSn };
                    if (!amberUnchanged) patchPayload.amberApiKey = amberToSend || '';
                    const patchResp = await authenticatedFetch('/api/config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(patchPayload)
                    });
                    const patchData = await patchResp.json();
                    if (!patchResp.ok || patchData.errno !== 0) {
                        throw new Error(patchData?.msg || patchData?.error || `HTTP ${patchResp.status}`);
                    }
                    await loadCredentials();
                    showMessage('success', 'Credential changes saved.');
                    return;
                }

                const payload = {
                    sungrow_device_sn: deviceSn,
                    sungrow_username: usernameDisplayed,
                    sungrow_password: passwordDisplayed
                };
                if (!amberUnchanged) payload.amber_api_key = amberToSend || null;

                const resp = await authenticatedFetch('/api/config/validate-keys', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await resp.json();
                if (data.errno !== 0) {
                    console.warn('validate-keys errors (sungrow)', data);
                    const first = (data.errors && (
                        data.errors.sungrow_username || data.errors.sungrow_password ||
                        data.errors.sungrow_device_sn || data.msg
                    )) || 'Sungrow validation failed';
                    showMessage('warning', first);
                    return;
                }

                await loadCredentials();
                showMessage('success', 'Sungrow credentials validated and stored on server');
            } catch (e) {
                console.error('saveSungrowCredentials error', e);
                showMessage('warning', 'Failed to save credentials: ' + (e.message || e));
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerHTML = prevText;
                updateStatus();
            }
        }

        async function saveAlphaEssCredentials(amberToSend, amberUnchanged) {
            const systemSnInput = document.getElementById('credentials_alphaessSystemSn');
            const appIdInput = document.getElementById('credentials_alphaessAppId');
            const appSecretInput = document.getElementById('credentials_alphaessAppSecret');

            const systemSn = (systemSnInput?.value || '').trim();
            const appIdDisplayed = (appIdInput?.value || '').trim();
            const appSecretDisplayed = (appSecretInput?.value || '').trim();

            const appIdUnchanged = isMaskedCredentialValue(appIdDisplayed) &&
                appIdInput?.dataset.hasSavedCredential === '1';
            const appSecretUnchanged = isMaskedCredentialValue(appSecretDisplayed) &&
                appSecretInput?.dataset.hasSavedCredential === '1';
            const credsUnchanged = appIdUnchanged && appSecretUnchanged;

            if (!systemSn) {
                showMessage('warning', 'AlphaESS System SN is required');
                return;
            }
            if (!credsUnchanged && (!appIdDisplayed || isMaskedCredentialValue(appIdDisplayed))) {
                showMessage('warning', 'AlphaESS App ID is required (or keep existing credentials unchanged)');
                return;
            }
            if (!credsUnchanged && (!appSecretDisplayed || isMaskedCredentialValue(appSecretDisplayed))) {
                showMessage('warning', 'AlphaESS App Secret is required (or keep existing credentials unchanged)');
                return;
            }

            const saveBtn = document.getElementById('credentialsSaveBtn');
            const prevText = saveBtn.innerHTML;
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="spinner"></span> Saving...';

            try {
                if (credsUnchanged) {
                    const patchPayload = { alphaessSystemSn: systemSn };
                    if (!amberUnchanged) patchPayload.amberApiKey = amberToSend || '';
                    const patchResp = await authenticatedFetch('/api/config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(patchPayload)
                    });
                    const patchData = await patchResp.json();
                    if (!patchResp.ok || patchData.errno !== 0) {
                        throw new Error(patchData?.msg || patchData?.error || `HTTP ${patchResp.status}`);
                    }
                    await loadCredentials();
                    showMessage('success', 'Credential changes saved.');
                    return;
                }

                const payload = {
                    alphaess_system_sn: systemSn,
                    alphaess_app_id: appIdDisplayed,
                    alphaess_app_secret: appSecretDisplayed
                };
                if (!amberUnchanged) payload.amber_api_key = amberToSend || null;

                const resp = await authenticatedFetch('/api/config/validate-keys', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await resp.json();
                if (data.errno !== 0) {
                    console.warn('validate-keys errors (alphaess)', data);
                    const first = (data.errors && (
                        data.errors.alphaess_system_sn ||
                        data.errors.alphaess_app_id ||
                        data.errors.alphaess_app_secret ||
                        data.msg
                    )) || 'AlphaESS validation failed';
                    showMessage('warning', first);
                    return;
                }

                await loadCredentials();
                showMessage('success', 'AlphaESS credentials validated and stored on server');
            } catch (e) {
                console.error('saveAlphaEssCredentials error', e);
                showMessage('warning', 'Failed to save credentials: ' + (e.message || e));
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerHTML = prevText;
                updateStatus();
            }
        }

        async function clearCredentials() {
            if (!confirm('Clear inverter provider credentials and Amber API key from the server?')) return;
            try {
                const resp = await authenticatedFetch('/api/config/clear-credentials', { method: 'POST' });
                const data = await resp.json();
                if (data.errno === 0) {
                    document.getElementById('credentials_deviceSn').value = '';
                    document.getElementById('credentials_foxessToken').value = '';
                    document.getElementById('credentials_amberKey').value = '';
                    const alphaSystemSn = document.getElementById('credentials_alphaessSystemSn');
                    const alphaAppId = document.getElementById('credentials_alphaessAppId');
                    const alphaAppSecret = document.getElementById('credentials_alphaessAppSecret');
                    if (alphaSystemSn) alphaSystemSn.value = '';
                    if (alphaAppId) alphaAppId.value = '';
                    if (alphaAppSecret) alphaAppSecret.value = '';
                    showMessage('success', 'Credentials cleared from server memory');
                    loadSettings();
                } else {
                    showMessage('warning', 'Failed to clear credentials: ' + (data.msg || 'unknown'));
                }
            } catch (e) {
                console.error('clearCredentials error', e);
                showMessage('warning', 'Failed to clear credentials: ' + (e.message || e));
            }
        }

        // Warn before leaving with unsaved changes
        window.addEventListener('beforeunload', (e) => {
            if (hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
        
        // Track changes to credential fields
        [
            'credentials_deviceSn',
            'credentials_foxessToken',
            'credentials_amberKey',
            'credentials_alphaessSystemSn',
            'credentials_alphaessAppId',
            'credentials_alphaessAppSecret',
            'credentials_sungrowDeviceSn',
            'credentials_sungrowUsername',
            'credentials_sungrowPassword',
            'credentials_sigenenergyUsername',
            'credentials_sigenenergyPassword',
            'credentials_sigenenergyRegion'
        ].forEach(id => {
            document.getElementById(id)?.addEventListener('input', () => {
                checkCredentialsChanged();
                updateStatus();
            });
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

        // ==================== CURTAILMENT MANUAL OVERRIDE ====================
        
        async function readExportLimit() {
            const statusEl = document.getElementById('currentExportLimit');
            try {
                statusEl.textContent = '⏳ Reading...';
                statusEl.style.color = 'var(--color-yellow)';
                
                const resp = await authenticatedFetch('/api/inverter/settings?key=ExportLimit');
                const data = await resp.json();
                
                if (data.errno === 0 && data.result && data.result.value !== undefined) {
                    const value = data.result.value;
                    statusEl.textContent = `${value}W`;
                    statusEl.style.color = value === 0 ? 'var(--color-danger)' : 'var(--color-success)';
                    
                    // Show user-friendly message
                    if (value === 0) {
                        showMessage('warning', `⚠️ Export is currently CURTAILED (0W). Use Force Set to restore.`);
                    } else {
                        showMessage('success', `✅ Export limit is ${value}W (normal operation)`);
                    }
                } else {
                    statusEl.textContent = '❌ Failed';
                    statusEl.style.color = 'var(--color-danger)';
                    showMessage('warning', `Failed to read ExportLimit: ${data.error || data.msg || 'Unknown error'}`);
                }
            } catch (error) {
                statusEl.textContent = '❌ Error';
                statusEl.style.color = 'var(--color-danger)';
                showMessage('warning', `Error reading ExportLimit: ${error.message}`);
            }
        }
        
        async function forceSetExportLimit() {
            const input = document.getElementById('manualExportLimit');
            const value = parseInt(input.value);
            
            if (isNaN(value) || value < 0 || value > 12000) {
                showMessage('warning', '⚠️ Please enter a valid value between 0 and 12000');
                return;
            }
            
            const actionDesc = value === 0 ? 'CURTAIL export (0W)' : value === 12000 ? 'RESTORE normal export (12000W)' : `set export to ${value}W`;
            if (!confirm(`⚠️ Force ${actionDesc}?\n\nThis will directly modify your inverter settings, bypassing automation. Only proceed if automation has failed or your system is stuck.`)) {
                return;
            }
            
            try {
                showMessage('info', `⏳ Setting ExportLimit to ${value}W...`);
                
                const resp = await authenticatedFetch('/api/device/setting/set', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        key: 'ExportLimit',
                        value: value
                    })
                });
                
                const data = await resp.json();
                
                if (data.errno === 0) {
                    showMessage('success', `✅ Export limit successfully set to ${value}W!`);
                    
                    // Update the read display
                    const statusEl = document.getElementById('currentExportLimit');
                    statusEl.textContent = `${value}W`;
                    statusEl.style.color = value === 0 ? 'var(--color-danger)' : 'var(--color-success)';
                    
                    // Show appropriate follow-up message
                    if (value === 12000) {
                        setTimeout(() => {
                            showMessage('info', '💡 Export restored to normal. Monitor your dashboard to verify operation.', 8000);
                        }, 2000);
                    } else if (value === 0) {
                        setTimeout(() => {
                            showMessage('warning', '⚠️ Export is now curtailed. Set to 12000W to restore normal operation.', 8000);
                        }, 2000);
                    }
                } else {
                    showMessage('warning', `❌ Failed to set ExportLimit: ${data.error || data.msg || 'Unknown error'}`);
                }
            } catch (error) {
                showMessage('warning', `❌ Error setting ExportLimit: ${error.message}`);
            }
        }
    
