
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

        document.addEventListener('DOMContentLoaded', () => {
            updateProgress();
        });

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

            // Get values and strip any invisible characters that browsers might add
            const deviceSn = sanitizeInput(document.getElementById('deviceSn').value);
            const foxessToken = sanitizeInput(document.getElementById('foxessToken').value);
            const amberApiKey = sanitizeInput(document.getElementById('amberApiKey').value);
            const weatherPlace = sanitizeInput(document.getElementById('weatherPlace').value);
            const inverterCapacityKw = parseFloat(document.getElementById('inverterCapacityKw').value);
            const batteryCapacityKwh = parseFloat(document.getElementById('batteryCapacityKwh').value);

            // Clear previous errors
            clearAllFieldStates();

            // Validate inputs
            if (!deviceSn) {
                setFieldError('deviceSn', 'Device Serial Number is required');
                return;
            }

            if (!foxessToken) {
                setFieldError('foxessToken', 'FoxESS API Token is required');
                return;
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

            // Disable button and show loading state
            const submitBtn = document.getElementById('submitBtn');
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<div class="spinner"></div><span>Validating...</span>';

            try {
                const response = await authenticatedFetch('/api/config/validate-keys', {
                    method: 'POST',
                    body: JSON.stringify({
                        device_sn: deviceSn,
                        foxess_token: foxessToken,
                        amber_api_key: amberApiKey || null,
                        weather_place: weatherPlace || 'Sydney NSW',
                        inverter_capacity_w: Math.round(inverterCapacityKw * 1000),
                        battery_capacity_kwh: batteryCapacityKwh
                    })
                });
                
                const data = await response.json();

                if (!response.ok || data.errno !== 0) {
                    const failedKeys = data?.failed_keys;
                    if (Array.isArray(failedKeys) && failedKeys.length) {
                        failedKeys.forEach(key => {
                            const fieldMap = {
                                'device_sn': 'deviceSn',
                                'foxess_token': 'foxessToken',
                                'amber_api_key': 'amberApiKey'
                            };
                            const fieldId = fieldMap[key];
                            if (fieldId) {
                                const detailed = data?.errors?.[key];
                                setFieldError(fieldId, detailed || data?.msg || 'Validation failed');
                            }
                        });
                    } else {
                        setFieldError('deviceSn', data?.msg || data?.error || 'Validation failed. Please check your credentials.');
                    }
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<span class="btn-text">Validate & Continue</span><span>→</span>';
                    return;
                }

                // Success - mark fields as valid
                setFieldSuccess('deviceSn');
                setFieldSuccess('foxessToken');
                if (amberApiKey) setFieldSuccess('amberApiKey');

                // Update button to show success
                submitBtn.innerHTML = '<span>✓</span><span>Success! Redirecting...</span>';
                submitBtn.style.background = 'var(--gradient-success)';

                // Store config in localStorage for UX
                localStorage.setItem('foxess_setup_device_sn', deviceSn);
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
                setFieldError('deviceSn', error.message || 'Unknown error');
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
            const group = document.getElementById(fieldId).closest('.form-group');
            group.classList.remove('success');
            group.classList.add('error');
            const msgEl = group.querySelector('.error-message .message-text');
            if (msgEl) msgEl.textContent = message;
            updateProgress();
        }

        function setFieldSuccess(fieldId) {
            const group = document.getElementById(fieldId).closest('.form-group');
            group.classList.remove('error');
            group.classList.add('success');
            updateProgress();
        }

        function updateProgress() {
            const deviceSn = document.getElementById('deviceSn');
            const foxessToken = document.getElementById('foxessToken');
            const weatherPlace = document.getElementById('weatherPlace');
            const amberApiKey = document.getElementById('amberApiKey');

            const deviceSnValid = deviceSn.value.trim() && !deviceSn.closest('.form-group').classList.contains('error');
            const foxessValid = foxessToken.value.trim() && !foxessToken.closest('.form-group').classList.contains('error');
            const weatherValid = weatherPlace.value.trim() && !weatherPlace.closest('.form-group').classList.contains('error');
            // Amber is optional: complete if a value is entered without error, or if the user has moved on to hardware
            const amberEntered = amberApiKey.value.trim() !== '' && !amberApiKey.closest('.form-group').classList.contains('error');
            const inverterAhead = parseFloat((document.getElementById('inverterCapacityKw') || {}).value) > 0;
            const batteryAhead  = parseFloat((document.getElementById('batteryCapacityKwh') || {}).value) > 0;
            const amberValid = amberEntered || (inverterAhead && batteryAhead);

            const step1 = document.getElementById('step1');
            const step2 = document.getElementById('step2');
            const step3 = document.getElementById('step3');
            const step4 = document.getElementById('step4');
            const step5 = document.getElementById('step5');
            const line1 = document.getElementById('line1');
            const line2 = document.getElementById('line2');
            const line3 = document.getElementById('line3');
            const line4 = document.getElementById('line4');

            // Step 5: Hardware (capacity values must be positive numbers)
            const inverterInput = document.getElementById('inverterCapacityKw');
            const batteryInput = document.getElementById('batteryCapacityKwh');
            const inverterCapValid = inverterInput && parseFloat(inverterInput.value) > 0;
            const batteryCapValid = batteryInput && parseFloat(batteryInput.value) > 0;
            const hardwareValid = inverterCapValid && batteryCapValid;

            // Each step goes green based solely on its own field — sequence-agnostic.
            // Lines go green when the step on their left is complete.
            const stepStates = [deviceSnValid, foxessValid, weatherValid, amberValid, hardwareValid];
            const stepEls    = [step1, step2, step3, step4, step5];
            const lineEls    = [line1, line2, line3, line4];
            const stepNums   = ['1', '2', '3', '4', '5'];

            // First incomplete step gets 'current' highlight
            const firstIncomplete = stepStates.findIndex(v => !v);

            stepEls.forEach((el, i) => {
                el.classList.remove('current', 'complete');
                if (stepStates[i]) {
                    el.classList.add('complete');
                    el.querySelector('.step-dot').textContent = '✓';
                } else {
                    if (i === firstIncomplete) el.classList.add('current');
                    el.querySelector('.step-dot').textContent = stepNums[i];
                }
            });

            lineEls.forEach((el, i) => {
                el.classList.toggle('complete', stepStates[i]);
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
            const group = document.getElementById(fieldId).closest('.form-group');
            group.classList.remove('error', 'success');
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
    