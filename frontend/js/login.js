
        function registerAuthRedirect() {
            if (typeof firebaseAuth === 'undefined') return;
            firebaseAuth.onAuthStateChanged(async (user) => {
                if (!user) return;
                await redirectAfterLogin();
            });
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
                    safeRedirect(returnTo || '/index.html');
                } else {
                    safeRedirect('/setup.html');
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

        // Password toggle functionality
        document.querySelectorAll('.password-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const input = document.getElementById(btn.dataset.target);
                const isPassword = input.type === 'password';
                input.type = isPassword ? 'text' : 'password';
                btn.textContent = isPassword ? '🔒' : '👁️';
            });
        });

        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                
                // Update active tab
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // Show corresponding form
                document.querySelectorAll('.form-section').forEach(s => s.classList.remove('active'));
                document.getElementById(`${tab}Form`).classList.add('active');
                
                // Clear messages
                hideMessages();
            });
        });

        // Forgot password link
        document.getElementById('forgotPasswordLink').addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
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
        });

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

        // WIP Pages visibility - Topology Discovery (admin only)
        if (typeof window.auth !== 'undefined' && window.auth) {
            window.auth.onAuthStateChanged((user) => {
                if (user && user.email === 'sardanapalos928@hotmail.com') {
                    const topologyLink = document.getElementById('topologyNavLink');
                    if (topologyLink) topologyLink.style.display = '';
                }
            });
        }
    