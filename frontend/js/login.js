
        function clearSignedOutParamFromUrl() {
            try {
                const current = new URL(window.location.href);
                if (!current.searchParams.has('signedOut')) return;
                current.searchParams.delete('signedOut');
                const next = `${current.pathname}${current.search}${current.hash}`;
                window.history.replaceState({}, '', next);
            } catch (e) { /* ignore */ }
        }

        function registerAuthRedirect() {
            if (typeof firebaseAuth === 'undefined') return;
            let allowSignedOutSuppression = true;
            firebaseAuth.onAuthStateChanged(async (user) => {
                if (!user) {
                    // Once Firebase confirms signed-out state, this URL flag is no longer needed.
                    allowSignedOutSuppression = false;
                    clearSignedOutParamFromUrl();
                    return;
                }
                try {
                    const params = new URLSearchParams(window.location.search);
                    if (params.get('signedOut') === '1' && allowSignedOutSuppression) {
                        allowSignedOutSuppression = false;
                        return;
                    }
                } catch (e) { /* ignore */ }
                await redirectAfterLogin();
            });
        }

        function updateTabIndicator(tabName) {
            const indicator = document.getElementById('tabIndicator');
            if (!indicator) return;
            const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
            if (!btn) return;
            indicator.style.opacity = '1';
            indicator.style.width = btn.offsetWidth + 'px';
            // btn.offsetLeft includes parent padding (4px), indicator starts at left:4px, so subtract 4
            indicator.style.transform = `translateX(${btn.offsetLeft - 4}px)`;
        }

        function activateTab(tab) {
            const target = (tab === 'signup') ? 'signup' : 'signin';
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            const targetBtn = document.querySelector(`.tab-btn[data-tab="${target}"]`);
            if (targetBtn) targetBtn.classList.add('active');

            document.querySelectorAll('.form-section').forEach(s => s.classList.remove('active'));
            const targetForm = document.getElementById(`${target}Form`);
            if (targetForm) targetForm.classList.add('active');
            hideMessages();
            updateTabIndicator(target);
        }

        function normalizePostLoginTarget(returnTo) {
            if (!returnTo || typeof returnTo !== 'string') return '/app.html';
            if (!returnTo.startsWith('/') || returnTo.startsWith('//')) return '/app.html';

            const [pathOnly] = returnTo.split('?');
            const normalizedPath = (pathOnly || '').replace(/\/$/, '') || '/';

            // Keep authenticated users out of landing and auth pages after login.
            if (
                normalizedPath === '/' ||
                normalizedPath === '/index' ||
                normalizedPath === '/index.html' ||
                normalizedPath === '/login' ||
                normalizedPath === '/login.html'
            ) {
                return '/app.html';
            }

            return returnTo;
        }

        function directAuthRedirect(target) {
            // Authentication transitions should be deterministic and skip bounce guards.
            window.location.replace(target);
        }

        async function redirectAfterLogin() {
            try {
                const response = await authenticatedFetch('/api/config/setup-status');
                // response may be a Response or already normalized JSON depending on API client
                let data = null;
                try {
                    data = await response.json();
                } catch (e) {
                    // If response is already JSON-like object (api-client.request returned object), use it
                    data = response;
                }
                console.log('[Auth] setup-status response:', data);

                // If we're on the login page, ensure we don't suppress the redirect bounce guard
                try {
                    const key = 'lastRedirect';
                    const raw = sessionStorage.getItem(key);
                    if (raw) {
                        const last = JSON.parse(raw);
                        // If the last redirect was to the login page, clear it so we can navigate onward
                        if (last && last.to && last.to.includes('/login')) {
                            sessionStorage.removeItem(key);
                            console.log('[Redirect] Cleared lastRedirect to allow navigation to next page');
                        }
                    }
                } catch (e) { /* ignore */ }

                // Honor ?returnTo= (e.g. after stopping impersonation sends admin back to /admin.html)
                let returnTo = '';
                try {
                    const params = new URLSearchParams(window.location.search);
                    const rt = params.get('returnTo');
                    if (rt && rt.startsWith('/') && !rt.startsWith('//')) returnTo = rt;
                } catch (e) {}

                if (data && data.errno === 0 && data.result?.setupComplete) {
                    directAuthRedirect(normalizePostLoginTarget(returnTo || '/app.html'));
                } else {
                    directAuthRedirect('/setup.html');
                }
            } catch (e) {
                console.warn('[Auth] Could not determine setup status, staying on login (error):', e);
            }
        }

        AppShell.init({
            pageName: 'login',
            requireAuth: false,
            checkSetup: false,
            autoMetrics: false,
            onReady: () => {
                registerAuthRedirect();
            }
        });

        // Password toggle functionality — SVG eye icons
        const SVG_EYE_SHOW = '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/></svg>';
        const SVG_EYE_HIDE = '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true"><path fill-rule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clip-rule="evenodd"/><path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.064 7 9.542 7 .847 0 1.669-.105 2.454-.303z"/></svg>';
        document.querySelectorAll('.password-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const input = document.getElementById(btn.dataset.target);
                const isPassword = input.type === 'password';
                input.type = isPassword ? 'text' : 'password';
                btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
                btn.innerHTML = isPassword ? SVG_EYE_HIDE : SVG_EYE_SHOW;
            });
        });

        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                activateTab(btn.dataset.tab);
            });
        });

        // Keep keyboard flow deterministic: email -> password on Sign In.
        const signinEmailInput = document.getElementById('signinEmail');
        const signinPasswordInput = document.getElementById('signinPassword');
        if (signinEmailInput && signinPasswordInput) {
            signinEmailInput.addEventListener('keydown', (event) => {
                if (event.key === 'Tab' && !event.shiftKey) {
                    event.preventDefault();
                    signinPasswordInput.focus();
                }
            });
        }

        // Landing CTAs can deep-link directly to Sign Up via /login.html?tab=signup
        try {
            const params = new URLSearchParams(window.location.search);
            const requestedTab = params.get('tab');
            if (requestedTab === 'signup' || requestedTab === 'signin') {
                activateTab(requestedTab);
            } else {
                // Init indicator to signin (default active tab)
                // Use rAF so the layout is settled before measuring offsets
                requestAnimationFrame(() => updateTabIndicator('signin'));
            }
        } catch (e) { /* ignore */ }

        // Forgot password link
        document.getElementById('forgotPasswordLink').addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            const indicator = document.getElementById('tabIndicator');
            if (indicator) indicator.style.opacity = '0';
            document.querySelectorAll('.form-section').forEach(s => s.classList.remove('active'));
            document.getElementById('resetForm').classList.add('active');
            hideMessages();
        });

        // Back to sign in link
        document.getElementById('backToSigninLink').addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.form-section').forEach(s => s.classList.remove('active'));
            document.getElementById('signinForm').classList.add('active');
            document.querySelector('.tab-btn[data-tab="signin"]').classList.add('active');
            hideMessages();
            updateTabIndicator('signin');
        });

        // Password strength meter for signup
        function updatePasswordStrength(value) {
            const container = document.getElementById('signupPasswordStrength');
            if (!container) return;
            const label = container.querySelector('.strength-label');
            const bars = container.querySelectorAll('.strength-bar');
            if (!value) { container.style.display = 'none'; return; }
            container.style.display = 'flex';
            let score = 0;
            if (value.length >= 8) score++;
            if (value.length >= 12) score++;
            if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score++;
            if (/[0-9]/.test(value)) score++;
            if (/[^A-Za-z0-9]/.test(value)) score++;
            const level = value.length < 6 ? 0 : Math.min(4, Math.max(1, Math.ceil(score * 4 / 5)));
            const config = [null,
                { label: 'Weak',   color: 'filled-1' },
                { label: 'Fair',   color: 'filled-2' },
                { label: 'Good',   color: 'filled-3' },
                { label: 'Strong', color: 'filled-4' },
            ];
            bars.forEach((bar, i) => {
                bar.className = 'strength-bar';
                if (level > 0 && i < level) bar.classList.add(config[level].color);
            });
            if (label) {
                const colors = ['', '#ef4444', '#f97316', '#eab308', '#22c55e'];
                label.textContent = level === 0 ? 'Too short' : config[level].label;
                label.style.color = level === 0 ? '' : colors[level];
            }
        }
        const signupPasswordInput = document.getElementById('signupPassword');
        if (signupPasswordInput) {
            signupPasswordInput.addEventListener('input', () => updatePasswordStrength(signupPasswordInput.value));
        }

        // Sign in form
        document.getElementById('signinFormElement').addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('signinEmail').value;
            const password = document.getElementById('signinPassword').value;
            
            setLoading('signinBtn', true);
            hideMessages();
            
            const result = await firebaseAuth.signIn(email, password);
            
            setLoading('signinBtn', false);
            
            if (!result.success) {
                showError(getAuthErrorMessage(result.code));
            }
            // If success, onAuthStateChanged will redirect
        });

        // Sign up form
        document.getElementById('signupFormElement').addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('signupName').value;
            const email = document.getElementById('signupEmail').value;
            const password = document.getElementById('signupPassword').value;
            const passwordConfirm = document.getElementById('signupPasswordConfirm').value;
            
            if (password !== passwordConfirm) {
                showError('Passwords do not match');
                return;
            }
            
            if (password.length < 6) {
                showError('Password must be at least 6 characters');
                return;
            }
            
            setLoading('signupBtn', true);
            hideMessages();
            
            const result = await firebaseAuth.signUp(email, password, name);
            
            setLoading('signupBtn', false);
            
            if (!result.success) {
                showError(getAuthErrorMessage(result.code));
                        } else {
                                // Initialize user profile in the backend after successful sign up
                                try {
                                    const initResp = await authenticatedFetch('/api/auth/init-user', { method: 'POST' });
                                    if (!initResp.ok) {
                                        console.warn('Failed to initialize user profile, but account was created');
                                    }
                                } catch (e) {
                                    console.warn('Error calling init-user:', e);
                                }
                                // If success, onAuthStateChanged will redirect
                        }
        });

        // Reset password form
        document.getElementById('resetFormElement').addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('resetEmail').value;
            
            setLoading('resetBtn', true);
            hideMessages();
            
            // Provide a redirect URL so the email points back to our app reset page
            const continueUrl = window.location.origin + '/reset-password.html';
            const result = await firebaseAuth.sendPasswordResetEmail(email, continueUrl);
            
            setLoading('resetBtn', false);
            
            if (result.success) {
                showSuccess('Password reset email sent! Check your inbox.');
            } else {
                showError(getAuthErrorMessage(result.code));
            }
        });

        // Google sign in
        document.getElementById('googleSigninBtn').addEventListener('click', async () => {
            setLoading('googleSigninBtn', true);
            hideMessages();
            
            const result = await firebaseAuth.signInWithGoogle();
            
            setLoading('googleSigninBtn', false);
            
            if (!result.success) {
                showError(getAuthErrorMessage(result.code));
            }
            // If success, onAuthStateChanged will redirect
        });

        // Helper functions
        function setLoading(btnId, loading) {
            const btn = document.getElementById(btnId);
            if (loading) {
                btn.disabled = true;
                btn.innerHTML = '<div class="spinner"></div>';
            } else {
                btn.disabled = false;
                // Restore original content based on button
                if (btnId === 'signinBtn') btn.innerHTML = '<span>Sign In</span>';
                else if (btnId === 'signupBtn') btn.innerHTML = '<span>Create Account</span>';
                else if (btnId === 'resetBtn') btn.innerHTML = '<span>Send Reset Link</span>';
                else if (btnId === 'googleSigninBtn') {
                    btn.innerHTML = `
                        <svg class="google-icon" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                        <span>Continue with Google</span>
                    `;
                }
            }
        }

        function showError(message) {
            const el = document.getElementById('errorMessage');
            el.querySelector('.message-text').textContent = message;
            el.classList.add('show');
        }

        function showSuccess(message) {
            const el = document.getElementById('successMessage');
            el.querySelector('.message-text').textContent = message;
            el.classList.add('show');
        }

        function hideMessages() {
            document.getElementById('errorMessage').classList.remove('show');
            document.getElementById('successMessage').classList.remove('show');
        }

        function getAuthErrorMessage(code) {
            const messages = {
                'auth/email-already-in-use': 'This email is already registered. Try signing in instead.',
                'auth/invalid-email': 'Please enter a valid email address.',
                'auth/operation-not-allowed': 'This sign-in method is not enabled.',
                'auth/weak-password': 'Password is too weak. Use at least 6 characters.',
                'auth/user-disabled': 'This account has been disabled.',
                'auth/user-not-found': 'No account found with this email.',
                'auth/wrong-password': 'Incorrect password. Try again.',
                'auth/invalid-credential': 'Invalid email or password.',
                'auth/too-many-requests': 'Too many failed attempts. Please try again later.',
                'auth/popup-closed-by-user': 'Sign-in popup was closed. Please try again.',
                'auth/popup-blocked': 'Sign-in popup was blocked. Please allow popups for this site.'
            };
            return messages[code] || 'An error occurred. Please try again.';
        }
    
