
        async function ensureSetupStillRequired() {
            try {
                const response = await authenticatedFetch('/api/config/setup-status');
                if (response.status === 401) {
                    console.warn('[Setup] Unauthorized while checking status');
                    return;
                }
                const data = await response.json();
                if (data?.result?.setupComplete) {
                    try {
                        await new Promise(r => setTimeout(r, 250));
                        const confirmResp = await authenticatedFetch('/api/config/setup-status');
                        if (confirmResp.status === 401) {
                            safeRedirect('/login.html');
                            return;
                        }
                        const confirmData = await confirmResp.json();
                        if (confirmData?.result?.setupComplete) {
                            safeRedirect('/index.html');
                        } else {
                            console.log('[Setup] Status changed during double-check; staying on setup');
                        }
                    } catch (recheckError) {
                        console.warn('[Setup] Re-check failed; staying on setup page', recheckError);
                    }
                }
            } catch (error) {
                console.error('[Setup] Failed to check configuration status', error);
            }
        }

        updateProgress();

        AppShell.init({
            pageName: 'setup',
            checkSetup: false,
            onReady: () => {
                ensureSetupStillRequired();
            }
        });

        // Password toggle functionality
        document.querySelectorAll('.password-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const input = document.getElementById(btn.dataset.target);
                const isPassword = input.type === 'password';
                input.type = isPassword ? 'text' : 'password';
                btn.textContent = isPassword ? '🔒' : '👁️';
            });
        });

        // Provider selector toggle
        function getSelectedProvider() {
            const checked = document.querySelector('input[name="provider"]:checked');
            return checked ? checked.value : 'foxess';
        }

        function applyProviderSelection(provider) {
            const foxessFields    = document.getElementById('foxessFields');
            const sungrowFields   = document.getElementById('sungrowFields');
            const sigenenergyFields = document.getElementById('sigenenergyFields');
            const foxessOption    = document.getElementById('providerFoxessOption');
            const sungrowOption   = document.getElementById('providerSungrowOption');
            const sigenenergyOption = document.getElementById('providerSigenEnergyOption');
            if (provider === 'sungrow') {
                foxessFields.style.display    = 'none';
                sungrowFields.style.display   = '';
                sigenenergyFields.style.display = 'none';
                foxessOption.classList.remove('provider-option--selected');
                sungrowOption.classList.add('provider-option--selected');
                if (sigenenergyOption) sigenenergyOption.classList.remove('provider-option--selected');
            } else if (provider === 'sigenergy') {
                foxessFields.style.display    = 'none';
                sungrowFields.style.display   = 'none';
                sigenenergyFields.style.display = '';
                foxessOption.classList.remove('provider-option--selected');
                sungrowOption.classList.remove('provider-option--selected');
                if (sigenenergyOption) sigenenergyOption.classList.add('provider-option--selected');
            } else {
                foxessFields.style.display    = '';
                sungrowFields.style.display   = 'none';
                sigenenergyFields.style.display = 'none';
                sungrowOption.classList.remove('provider-option--selected');
                if (sigenenergyOption) sigenenergyOption.classList.remove('provider-option--selected');
                foxessOption.classList.add('provider-option--selected');
            }
            updateProgress();
        }

        document.querySelectorAll('input[name="provider"]').forEach(radio => {
            radio.addEventListener('change', () => applyProviderSelection(getSelectedProvider()));
        });

        // Sign out link
        document.getElementById('signOutLink').addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                if (window.AppShell && typeof AppShell.signOut === 'function') {
                    await AppShell.signOut();
                } else if (typeof firebaseAuth !== 'undefined') {
                    await firebaseAuth.signOut();
                }
            } finally {
                safeRedirect('/login.html');
            }
        });

        // Form submission
        document.getElementById('setupForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const provider = getSelectedProvider();
            const amberApiKey = sanitizeInput(document.getElementById('amberApiKey').value);
            const weatherPlace = sanitizeInput(document.getElementById('weatherPlace').value);
            const inverterCapacityKw = parseFloat(document.getElementById('inverterCapacityKw').value);
            const batteryCapacityKwh = parseFloat(document.getElementById('batteryCapacityKwh').value);

            // Clear previous errors
            clearAllFieldStates();

            // Provider-specific credential validation
            let requestBody = {};
            if (provider === 'sigenergy') {
                const sigenenergyUsername = sanitizeInput(document.getElementById('sigenenergyUsername').value);
                const sigenenergyPassword = sanitizeInput(document.getElementById('sigenenergyPassword').value);
                const sigenenergyRegion   = document.getElementById('sigenenergyRegion').value || 'apac';

                if (!sigenenergyUsername) {
                    setFieldError('sigenenergyUsername', 'SigenEnergy account email is required');
                    return;
                }
                if (!sigenenergyPassword) {
                    setFieldError('sigenenergyPassword', 'SigenEnergy password is required');
                    return;
                }
                requestBody = {
                    sigenergy_username: sigenenergyUsername,
                    sigenergy_password: sigenenergyPassword,
                    sigenergy_region:   sigenenergyRegion
                };
            } else if (provider === 'sungrow') {
                const sungrowDeviceSn  = sanitizeInput(document.getElementById('sungrowDeviceSn').value);
                const sungrowUsername  = sanitizeInput(document.getElementById('sungrowUsername').value);
                const sungrowPassword  = sanitizeInput(document.getElementById('sungrowPassword').value);

                if (!sungrowDeviceSn) {
                    setFieldError('sungrowDeviceSn', 'Inverter Serial Number is required');
                    return;
                }
                if (!sungrowUsername) {
                    setFieldError('sungrowUsername', 'iSolarCloud account email is required');
                    return;
                }
                if (!sungrowPassword) {
                    setFieldError('sungrowPassword', 'iSolarCloud password is required');
                    return;
                }
                requestBody = {
                    sungrow_device_sn: sungrowDeviceSn,
                    sungrow_username:  sungrowUsername,
                    sungrow_password:  sungrowPassword
                };
            } else {
                const deviceSn    = sanitizeInput(document.getElementById('deviceSn').value);
                const foxessToken = sanitizeInput(document.getElementById('foxessToken').value);

                if (!deviceSn) {
                    setFieldError('deviceSn', 'Device Serial Number is required');
                    return;
                }
                if (!foxessToken) {
                    setFieldError('foxessToken', 'FoxESS API Token is required');
                    return;
                }
                requestBody = {
                    device_sn:    deviceSn,
                    foxess_token: foxessToken
                };
            }

            if (!weatherPlace) {
                setFieldError('weatherPlace', 'Your location is required to set your timezone');
                return;
            }
            if (!inverterCapacityKw || inverterCapacityKw <= 0) {
                setFieldError('inverterCapacityKw', 'Please enter your inverter capacity in kW (e.g., 10)');
                return;
            }
            if (!batteryCapacityKwh || batteryCapacityKwh <= 0) {
                setFieldError('batteryCapacityKwh', 'Please enter your battery capacity in kWh (e.g., 41.93)');
                return;
            }

            Object.assign(requestBody, {
                amber_api_key:       amberApiKey || null,
                weather_place:       weatherPlace || 'Sydney NSW',
                inverter_capacity_w: Math.round(inverterCapacityKw * 1000),
                battery_capacity_kwh: batteryCapacityKwh
            });

            // Disable button and show loading state
            const submitBtn = document.getElementById('submitBtn');
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<div class="spinner"></div><span>Validating...</span>';

            try {
                const response = await authenticatedFetch('/api/config/validate-keys', {
                    method: 'POST',
                    body: JSON.stringify(requestBody)
                });
                
                const data = await response.json();

                if (!response.ok || data.errno !== 0) {
                    const failedKeys = data?.failed_keys;
                    if (Array.isArray(failedKeys) && failedKeys.length) {
                        failedKeys.forEach(key => {
                            const fieldMap = {
                                'device_sn':           'deviceSn',
                                'foxess_token':        'foxessToken',
                                'amber_api_key':       'amberApiKey',
                                'sungrow_device_sn':   'sungrowDeviceSn',
                                'sungrow_username':    'sungrowUsername',
                                'sungrow_password':    'sungrowPassword',
                                'sigenergy_username':  'sigenenergyUsername',
                                'sigenergy_password':  'sigenenergyPassword'
                            };
                            const fieldId = fieldMap[key];
                            if (fieldId) {
                                const detailed = data?.errors?.[key];
                                setFieldError(fieldId, detailed || data?.msg || 'Validation failed');
                            }
                        });
                    } else {
                        const firstField = provider === 'sungrow' ? 'sungrowDeviceSn' : 'deviceSn';
                        setFieldError(firstField, data?.msg || data?.error || 'Validation failed. Please check your credentials.');
                    }
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<span class="btn-text">Validate & Continue</span><span>→</span>';
                    return;
                }

                // Success - mark credential fields as valid
                if (provider === 'sigenergy') {
                    setFieldSuccess('sigenenergyUsername');
                    setFieldSuccess('sigenenergyPassword');
                } else if (provider === 'sungrow') {
                    setFieldSuccess('sungrowDeviceSn');
                    setFieldSuccess('sungrowUsername');
                    setFieldSuccess('sungrowPassword');
                } else {
                    setFieldSuccess('deviceSn');
                    setFieldSuccess('foxessToken');
                }
                if (amberApiKey) setFieldSuccess('amberApiKey');

                // Update button to show success
                submitBtn.innerHTML = '<span>✓</span><span>Success! Redirecting...</span>';
                submitBtn.style.background = 'var(--gradient-success)';

                // Store device SN in localStorage for UX
                if (provider === 'sigenergy') {
                    const username = sanitizeInput(document.getElementById('sigenenergyUsername').value);
                    localStorage.setItem('sigenergy_setup_username', username);
                } else if (provider === 'sungrow') {
                    const sn = sanitizeInput(document.getElementById('sungrowDeviceSn').value);
                    localStorage.setItem('sungrow_setup_device_sn', sn);
                } else {
                    const sn = sanitizeInput(document.getElementById('deviceSn').value);
                    localStorage.setItem('foxess_setup_device_sn', sn);
                }
                if (amberApiKey) {
                    localStorage.setItem('foxess_setup_amber_api_key', amberApiKey);
                }

                // Flag tour auto-launch for first-time users
                try { sessionStorage.setItem('tourAutoLaunch', '1'); } catch (e) {}

                // Redirect to dashboard after brief delay
                setTimeout(() => {
                    safeRedirect('/index.html');
                }, 1000);

            } catch (error) {
                console.error('Validation error:', error);
                const firstField = provider === 'sigenergy' ? 'sigenenergyUsername' : (provider === 'sungrow' ? 'sungrowDeviceSn' : 'deviceSn');
                // Only expose the message if it looks like a user-facing API/network error,
                // not an internal TypeError or similar programming error.
                const isInternalError = error instanceof TypeError || error instanceof ReferenceError;
                const displayMsg = isInternalError
                    ? 'Something went wrong — please refresh and try again.'
                    : (error.message || 'Unknown error');
                setFieldError(firstField, displayMsg);
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<span class="btn-text">Validate & Continue</span><span>→</span>';
            }
        });

        // Sanitize input: remove invisible characters, BOM, zero-width spaces, etc.
        function sanitizeInput(value) {
            if (!value) return '';
            // Remove BOM, zero-width characters, and trim whitespace
            return value
                .replace(/[\uFEFF\u200B\u200C\u200D\u00A0]/g, '') // BOM and zero-width chars
                .replace(/[\x00-\x1F\x7F]/g, '') // Control characters
                .trim();
        }

        function clearAllFieldStates() {
            document.querySelectorAll('.form-group').forEach(g => {
                g.classList.remove('error', 'success');
                const errMsg = g.querySelector('.error-message .message-text');
                if (errMsg) errMsg.textContent = '';
            });
        }

        // Map technical/raw error strings to user-friendly language before display
        function friendlyError(fieldId, raw) {
            const msg = (raw || '').toLowerCase();

            // Network / connectivity
            if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed') || msg.includes('could not reach')) {
                return 'Connection failed — check your internet connection and try again.';
            }
            if (msg.includes('timeout') || msg.includes('took too long')) {
                return 'Request timed out — check your internet connection and try again.';
            }
            if (msg.includes('unreadable response') || msg.includes('unexpected response') || msg.includes('invalid json')) {
                return 'Got an unreadable response — double-check your credentials and try again, or retry if the problem persists.';
            }

            // FoxESS token issues
            if (fieldId === 'foxessToken') {
                if (msg.includes('error token') || (msg.includes('invalid') && msg.includes('token'))) {
                    return 'Invalid or expired API token. Re-copy it from FoxESS Cloud → User Settings → API Management.';
                }
                if (msg.includes('illegal parameter') || msg.includes('not bound')) {
                    return 'API token not authorised for third-party access. In FoxESS Cloud, go to User Settings → API Management and generate a new token.';
                }
                if (msg.includes('rate limit') || msg.includes('frequency')) {
                    return 'FoxESS rate limit reached. Wait 60 seconds and try again.';
                }
            }

            // Amber key issues
            if (fieldId === 'amberApiKey') {
                if (msg.includes('401') || msg.includes('unauthori') || (msg.includes('invalid') && msg.includes('key'))) {
                    return 'Invalid Amber API key. Get yours at app.amber.com.au → Account → API.';
                }
            }

            // Generic validation fallback
            if (msg === 'validation failed') {
                return 'Couldn\'t verify this field — please check your entry and try again.';
            }

            return raw; // Already a good message
        }

        function setFieldError(fieldId, rawMessage) {
            const message = friendlyError(fieldId, rawMessage);
            const el = document.getElementById(fieldId);
            const group = el ? el.closest('.form-group') : null;
            if (!group) return;
            group.classList.remove('success');
            group.classList.add('error');
            const msgEl = group.querySelector('.error-message .message-text');
            if (msgEl) msgEl.textContent = message;
            updateProgress();
        }

        function setFieldSuccess(fieldId) {
            const el = document.getElementById(fieldId);
            const group = el ? el.closest('.form-group') : null;
            if (!group) return;
            group.classList.remove('error');
            group.classList.add('success');
            updateProgress();
        }

        function updateProgress() {
            const provider = getSelectedProvider();

            // Step 1: all inverter credentials for the active provider
            let inverterValid;
            if (provider === 'sungrow') {
                const sgSn   = document.getElementById('sungrowDeviceSn');
                const sgUser = document.getElementById('sungrowUsername');
                const sgPass = document.getElementById('sungrowPassword');
                inverterValid = !!(sgSn?.value.trim()   && !sgSn.closest('.form-group')?.classList.contains('error') &&
                                   sgUser?.value.trim() && !sgUser.closest('.form-group')?.classList.contains('error') &&
                                   sgPass?.value.trim() && !sgPass.closest('.form-group')?.classList.contains('error'));
            } else {
                const deviceSn    = document.getElementById('deviceSn');
                const foxessToken = document.getElementById('foxessToken');
                inverterValid = !!(deviceSn?.value.trim()    && !deviceSn.closest('.form-group')?.classList.contains('error') &&
                                   foxessToken?.value.trim() && !foxessToken.closest('.form-group')?.classList.contains('error'));
            }

            // Step 2: Location
            const weatherPlace = document.getElementById('weatherPlace');
            const weatherValid = !!(weatherPlace?.value.trim() && !weatherPlace.closest('.form-group')?.classList.contains('error'));

            // Step 3: Amber (optional — ticks once entered without error, or once hardware is filled)
            const amberApiKey  = document.getElementById('amberApiKey');
            const amberEntered = !!(amberApiKey?.value.trim() && !amberApiKey.closest('.form-group')?.classList.contains('error'));
            const inverterAhead = parseFloat(document.getElementById('inverterCapacityKw')?.value) > 0;
            const batteryAhead  = parseFloat(document.getElementById('batteryCapacityKwh')?.value) > 0;
            const amberValid = amberEntered || (inverterAhead && batteryAhead);

            // Step 4: Hardware
            const hardwareValid = inverterAhead && batteryAhead;

            const states  = [inverterValid, weatherValid, amberValid, hardwareValid];
            const stepEls = ['step1', 'step2', 'step3', 'step4'].map(id => document.getElementById(id));
            const lineEls = ['line1', 'line2', 'line3'].map(id => document.getElementById(id));
            const nums    = ['1', '2', '3', '4'];

            // First incomplete step gets 'current' highlight
            const firstIncomplete = states.findIndex(v => !v);

            stepEls.forEach((el, i) => {
                if (!el) return;
                el.classList.remove('current', 'complete');
                const dot = el.querySelector('.step-dot');
                if (states[i]) {
                    el.classList.add('complete');
                    if (dot) dot.textContent = '✓';
                } else {
                    if (i === firstIncomplete) el.classList.add('current');
                    if (dot) dot.textContent = nums[i];
                }
            });

            lineEls.forEach((el, i) => {
                if (el) el.classList.toggle('complete', !!states[i]);
            });
        }

        // Real-time progress updates as user types
        document.getElementById('deviceSn').addEventListener('input', () => {
            clearFieldState('deviceSn');
            updateProgress();
        });
        document.getElementById('foxessToken').addEventListener('input', () => {
            clearFieldState('foxessToken');
            updateProgress();
        });
        document.getElementById('sungrowDeviceSn').addEventListener('input', () => {
            clearFieldState('sungrowDeviceSn');
            updateProgress();
        });
        document.getElementById('sungrowUsername').addEventListener('input', () => {
            clearFieldState('sungrowUsername');
            updateProgress();
        });
        document.getElementById('sungrowPassword').addEventListener('input', () => {
            clearFieldState('sungrowPassword');
            updateProgress();
        });
        document.getElementById('weatherPlace').addEventListener('input', () => {
            clearFieldState('weatherPlace');
            updateProgress();
        });
        document.getElementById('amberApiKey').addEventListener('input', () => {
            clearFieldState('amberApiKey');
            updateProgress();
        });
        document.getElementById('inverterCapacityKw').addEventListener('input', updateProgress);
        document.getElementById('batteryCapacityKwh').addEventListener('input', updateProgress);

        function clearFieldState(fieldId) {
            const el = document.getElementById(fieldId);
            const group = el ? el.closest('.form-group') : null;
            if (group) group.classList.remove('error', 'success');
        }

        // WIP Pages visibility - Topology Discovery (admin only)
        if (typeof window.auth !== 'undefined' && window.auth) {
            window.auth.onAuthStateChanged((user) => {
                if (user && user.email === 'sardanapalos928@hotmail.com') {
                    const topologyLink = document.getElementById('topologyNavLink');
                    if (topologyLink) topologyLink.style.display = '';
                }
            });
        }

        // Block navigation away from setup: intercept locked dropdown items
        document.addEventListener('click', function (e) {
            const btn = e.target.closest('[data-setup-nav-locked]');
            if (!btn) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            // close the dropdown
            const dd = btn.closest('[data-user-dropdown]');
            if (dd) dd.classList.remove('show');
            // show a brief inline toast
            let toast = document.getElementById('_setupNavToast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = '_setupNavToast';
                toast.style.cssText = [
                    'position:fixed', 'bottom:24px', 'left:50%',
                    'transform:translateX(-50%)', 'background:var(--bg-card)',
                    'border:1px solid color-mix(in srgb,var(--accent-blue) 35%,transparent)', 'color:var(--text-primary)',
                    'padding:10px 20px', 'border-radius:10px', 'font-size:13px',
                    'z-index:99999', 'pointer-events:none',
                    'box-shadow:var(--shadow-lg)',
                    'white-space:nowrap'
                ].join(';');
                document.body.appendChild(toast);
            }
            toast.textContent = '⚙️ Complete setup first to access Settings';
            toast.style.opacity = '1';
            clearTimeout(toast._t);
            toast._t = setTimeout(function () { toast.style.opacity = '0'; }, 2400);
        });
    