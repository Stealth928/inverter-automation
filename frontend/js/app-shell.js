(function (window, document) {
    const defaultOptions = {
        pageName: 'app',
        requireAuth: true,
        checkSetup: true,
        autoMetrics: false,
        metricsInterval: 60000,
        allowMock: true,
        onReady: null
    };

    const state = {
        options: { ...defaultOptions },
        initStarted: false,
        initPromise: null,
        initResolved: false,
        ready: false,
        user: null,
        readyCallbacks: [],
        signOutCallbacks: [],
        metricsTimer: null,
        redirectTimer: null
    };

    function mergeOptions(options) {
        state.options = { ...defaultOptions, ...options };
        if (typeof state.options.onReady === 'function') {
            state.readyCallbacks.push(state.options.onReady);
        }
    }

    function getContext() {
        return { user: state.user, apiClient: window.apiClient || null };
    }

    function onReady(callback) {
        if (typeof callback !== 'function') return;
        const canRun = state.ready && ((state.user && window.apiClient) || !state.options.requireAuth);
        if (canRun) {
            callback(getContext());
        } else {
            state.readyCallbacks.push(callback);
        }
    }

    function resolveReady(ctx) {
        if (!state.ready) {
            state.ready = true;
            state.readyCallbacks.forEach(cb => {
                try { cb(ctx); } catch (err) { console.warn('[AppShell] onReady callback failed', err); }
            });
            state.readyCallbacks = [];
        }
    }

    function handleUnauthorizedRedirect() {
        if (!state.options.requireAuth) return;
        if (state.redirectTimer) clearTimeout(state.redirectTimer);
        state.redirectTimer = setTimeout(() => {
            if (typeof safeRedirect === 'function') {
                safeRedirect('/login.html');
            } else {
                window.location.href = '/login.html';
            }
        }, 400);
    }

    async function ensureSetupComplete() {
        if (!state.options.checkSetup) return true;
        if (state.options.pageName === 'setup') return true;
        try {
            console.log('[AppShell] ensureSetupComplete called');
            console.log('[AppShell] state.user:', state.user ? `${state.user.uid} (${state.user.email})` : 'null');
            console.log('[AppShell] window.firebaseAuth exists:', !!window.firebaseAuth);
            
            if (window.firebaseAuth) {
              console.log('[AppShell] firebaseAuth.user:', window.firebaseAuth.user ? `${window.firebaseAuth.user.uid}` : 'null');
              console.log('[AppShell] firebaseAuth.auth exists:', !!window.firebaseAuth.auth);
              if (window.firebaseAuth.auth && typeof firebase !== 'undefined') {
                const fbUser = firebase.auth().currentUser;
                console.log('[AppShell] firebase.auth().currentUser:', fbUser ? `${fbUser.uid} (${fbUser.email})` : 'null');
              }
            }
            
            const client = window.apiClient || await waitForAPIClient(4000);
            
            // Ensure we have a fresh token before calling setup-status
            if (window.firebaseAuth) {
                try {
                    console.log('[AppShell] Attempting to get fresh token...');
                    const token = await window.firebaseAuth.getIdToken(true); // force refresh
                    console.log('[AppShell] Got fresh token:', token ? (token.substring(0, 20) + '...') : '(null)');
                } catch (tokenErr) {
                    console.warn('[AppShell] Failed to refresh token:', tokenErr && tokenErr.message ? tokenErr.message : tokenErr);
                }
            }
            
            const response = await client.fetch('/api/config/setup-status');
            if (response.status === 401) {
                handleUnauthorizedRedirect();
                return false;
            }
            const data = await response.json().catch(() => null);
            console.log('[AppShell] Setup status response:', data);
            if (data && data.errno === 0 && !data.result?.setupComplete) {
                if (typeof safeRedirect === 'function') {
                    safeRedirect('/setup.html');
                } else {
                    window.location.href = '/setup.html';
                }
                return false;
            }
        } catch (error) {
            console.warn('[AppShell] Setup check failed', error);
        }
        return true;
    }

    function updateUserIdentity(user) {
        const menu = document.querySelector('[data-user-menu]');
        if (!menu) return;
        const avatar = menu.querySelector('[data-user-avatar]');
        const initials = menu.querySelector('[data-user-initials]');
        const nameEl = menu.querySelector('[data-user-name]');
        const emailEl = menu.querySelector('[data-user-email]');

        if (!user) {
            if (initials) initials.textContent = '?';
            if (nameEl) nameEl.textContent = 'Guest';
            if (emailEl) emailEl.textContent = 'Not signed in';
            if (avatar && avatar.tagName === 'BUTTON') {
                avatar.innerHTML = '<span data-user-initials>?</span>';
            }
            return;
        }

        const name = user.displayName || (user.email ? user.email.split('@')[0] : 'User');
        const email = user.email || '';
        const initial = name.charAt(0).toUpperCase();

        if (nameEl) nameEl.textContent = name;
        if (emailEl) emailEl.textContent = email;
        if (initials) initials.textContent = initial;

        if (avatar) {
            if (user.photoURL) {
                avatar.innerHTML = `<img src="${user.photoURL}" alt="${name}" onerror="this.remove();" />`;
            } else if (!avatar.querySelector('[data-user-initials]')) {
                avatar.innerHTML = `<span data-user-initials>${initial}</span>`;
            }
        }
    }

    function setupNavHighlight() {
        const links = document.querySelectorAll('.nav-link');
        if (!links.length) return;
        const currentPath = window.location.pathname === '/' ? '/index.html' : window.location.pathname.replace(/\/$/, '');
        links.forEach(link => {
            try {
                const linkPath = new URL(link.getAttribute('href'), window.location.origin).pathname.replace(/\/$/, '');
                if (linkPath === currentPath) {
                    link.classList.add('active');
                } else {
                    link.classList.remove('active');
                }
            } catch (err) {
                // Ignore invalid URLs
            }
        });
    }

    function setupUserMenu() {
        const menu = document.querySelector('[data-user-menu]');
        if (!menu) return;
        const avatarBtn = menu.querySelector('[data-user-avatar]');
        const dropdown = menu.querySelector('[data-user-dropdown]');
        const settingsBtn = menu.querySelector('[data-go-settings]');
        const contactUsBtn = menu.querySelector('[data-contact-us]');
        const signOutBtn = menu.querySelector('[data-signout]');

        if (avatarBtn && dropdown) {
            avatarBtn.addEventListener('click', () => {
                dropdown.classList.toggle('show');
            });
            document.addEventListener('click', (event) => {
                if (!menu.contains(event.target)) {
                    dropdown.classList.remove('show');
                }
            });
        }

        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                if (typeof safeRedirect === 'function') {
                    safeRedirect('/settings.html');
                } else {
                    window.location.href = '/settings.html';
                }
            });
        }

        if (contactUsBtn) {
            contactUsBtn.addEventListener('click', () => {
                window.location.href = 'mailto:sardanapalos928@hotmail.com';
            });
        }

        if (signOutBtn) {
            signOutBtn.addEventListener('click', async () => {
                await signOut();
            });
        }
    }

    function relocateMetricsWidget() {
        const widgets = document.querySelectorAll('.api-metrics-footer');
        if (!widgets.length) return;
        const primary = widgets[0];
        if (!primary.dataset.injected) {
            document.body.appendChild(primary);
            primary.dataset.injected = 'true';
        }
        widgets.forEach((widget, idx) => {
            if (idx > 0) widget.remove();
        });
    }

    function startMetricsTimer() {
        if (state.metricsTimer) clearInterval(state.metricsTimer);
        if (typeof loadApiMetrics !== 'function') return;
        loadApiMetrics(1);
        state.metricsTimer = setInterval(() => loadApiMetrics(1), state.options.metricsInterval || 60000);
    }

    function stopMetricsTimer() {
        if (state.metricsTimer) {
            clearInterval(state.metricsTimer);
            state.metricsTimer = null;
        }
    }

    function handleSignedOut() {
        state.user = null;
        state.ready = false;
        stopMetricsTimer();
        updateUserIdentity(null);
        state.signOutCallbacks.forEach(cb => {
            try { cb(); } catch (err) { console.warn('[AppShell] signOut callback failed', err); }
        });
        if (state.options.requireAuth) {
            handleUnauthorizedRedirect();
        }
    }

    async function init(options = {}) {
        mergeOptions(options);
        if (state.initStarted) {
            return state.initPromise;
        }
        state.initStarted = true;

        state.initPromise = new Promise((resolve) => {
            if (typeof window.firebaseAuth === 'undefined' || typeof window.firebaseConfig === 'undefined') {
                console.warn('[AppShell] Firebase not available; running without auth bootstrap');
                resolveReady(getContext());
                if (!state.initResolved) {
                    resolve(getContext());
                    state.initResolved = true;
                }
                return;
            }

            window.firebaseAuth.init(window.firebaseConfig, { allowMock: state.options.allowMock })
                .then(() => {
                    window.apiClient = initAPIClient(window.firebaseAuth);
                    window.firebaseAuth.onAuthStateChanged(async (user) => {
                        if (!user) {
                            handleSignedOut();
                            if (!state.options.requireAuth && !state.initResolved) {
                                resolveReady(getContext());
                                resolve(getContext());
                                state.initResolved = true;
                            }
                            return;
                        }
                        // If a redirect to login was scheduled because we were briefly signed out,
                        // cancel it now that we have a valid user.
                        try {
                            if (state.redirectTimer) {
                                clearTimeout(state.redirectTimer);
                                state.redirectTimer = null;
                            }
                        } catch (e) { /* ignore */ }

                        state.user = user;
                        updateUserIdentity(user);
                        const setupOk = await ensureSetupComplete();
                        if (!setupOk) return;
                        resolveReady(getContext());
                        if (!state.initResolved) {
                            resolve(getContext());
                            state.initResolved = true;
                        }
                        if (state.options.autoMetrics) {
                            startMetricsTimer();
                        }
                    });
                })
                .catch((error) => {
                    console.error('[AppShell] Firebase initialization failed', error);
                    if (typeof showMessage === 'function') {
                        showMessage('error', 'Firebase initialization failed. Check console for details.');
                    }
                    resolveReady(getContext());
                    if (!state.initResolved) {
                        resolve(getContext());
                        state.initResolved = true;
                    }
                });
        });

        return state.initPromise;
    }

    async function authFetch(url, options = {}) {
        const client = window.apiClient || await waitForAPIClient(4000);
        const response = await client.fetch(url, options);
        if (response.status === 401) {
            handleUnauthorizedRedirect();
        }
        return response;
    }

    async function signOut() {
        try {
            if (typeof window.firebaseAuth !== 'undefined') {
                await window.firebaseAuth.signOut();
            }
        } catch (error) {
            console.warn('[AppShell] Sign out failed', error);
            if (typeof showMessage === 'function') {
                showMessage('warning', 'Unable to sign out. Please try again.');
            }
        }
    }

    function onSignOut(callback) {
        if (typeof callback === 'function') {
            state.signOutCallbacks.push(callback);
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.body.classList.add('has-fixed-nav');
        setupNavHighlight();
        setupUserMenu();
        relocateMetricsWidget();
    });

    window.AppShell = {
        init,
        onReady,
        onSignOut,
        authFetch,
        signOut,
        getUser: () => state.user,
        getApiClient: () => window.apiClient || null
    };
})(window, document);
