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
        isAdmin: null,
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

    // Wait for apiClient to be initialized (with timeout)
    async function waitForAPIClient(timeoutMs = 5000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            if (window.apiClient) {
                return window.apiClient;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('API Client initialization timeout');
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
            const client = window.apiClient || await waitForAPIClient(4000);
            
            // Initialize user profile in Firestore (creates document and automation state if missing)
            try {
              const initResp = await client.fetch('/api/user/init-profile', { method: 'POST' });
              const initData = await initResp.json();
              if (initData.errno !== 0) {
                console.warn('[AppShell] User profile init returned error:', initData.error);
              }
            } catch (initErr) {
              console.warn('[AppShell] User profile initialization failed:', initErr && initErr.message ? initErr.message : initErr);
            }
            
            // Ensure we have a fresh token before calling setup-status
            if (window.firebaseAuth) {
                try {
                    await window.firebaseAuth.getIdToken(true); // force refresh
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

    function setAdminNavVisibility(isAdmin) {
        try {
            const teslaLink = document.getElementById('teslaNavLink');
            const topologyLink = document.getElementById('topologyNavLink');
            const adminLink = document.getElementById('adminNavLink');
            if (teslaLink) teslaLink.style.display = isAdmin ? '' : 'none';
            if (topologyLink) topologyLink.style.display = isAdmin ? '' : 'none';
            if (adminLink) adminLink.style.display = isAdmin ? '' : 'none';
        } catch (e) {
            console.warn('[AppShell] Failed to set admin nav visibility', e);
        }
    }

    function getImpersonationState() {
        try {
            return {
                uid: localStorage.getItem('adminImpersonationUid') || '',
                email: localStorage.getItem('adminImpersonationEmail') || '',
                mode: localStorage.getItem('adminImpersonationMode') || '',
                startedAt: Number(localStorage.getItem('adminImpersonationStartedAt') || 0) || 0
            };
        } catch (e) {
            return { uid: '', email: '', mode: '', startedAt: 0 };
        }
    }

    function clearImpersonationState() {
        try {
            localStorage.removeItem('adminImpersonationUid');
            localStorage.removeItem('adminImpersonationEmail');
            localStorage.removeItem('adminImpersonationMode');
            localStorage.removeItem('adminImpersonationStartedAt');
        } catch (e) {
            // ignore
        }
    }

    function renderImpersonationBanner(user) {
        const stateData = getImpersonationState();
        if (stateData.mode === 'header') {
            clearImpersonationState();
            return;
        }
        const isImpersonating = !!(user && stateData.uid && String(user.uid || '') === String(stateData.uid));

        let banner = document.getElementById('globalImpersonationBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'globalImpersonationBanner';
            banner.style.cssText = [
                'display:none',
                'position:sticky',
                'top:64px',
                'z-index:9999',
                'width:100%',
                'padding:10px 14px',
                'background:linear-gradient(90deg, #7f1d1d, #b91c1c)',
                'border-top:1px solid rgba(255,255,255,0.15)',
                'border-bottom:1px solid rgba(255,255,255,0.15)',
                'color:#fff',
                'font-weight:700',
                'letter-spacing:0.2px'
            ].join(';');
            const message = document.createElement('span');
            message.id = 'globalImpersonationBannerText';
            const stopBtn = document.createElement('button');
            stopBtn.type = 'button';
            stopBtn.textContent = 'Stop';
            stopBtn.style.cssText = 'float:right;margin-left:10px;padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.5);background:rgba(0,0,0,0.2);color:#fff;cursor:pointer;font-weight:700;';
            stopBtn.addEventListener('click', async () => {
                clearImpersonationState();
                await signOut();
                if (typeof safeRedirect === 'function') {
                    safeRedirect('/login.html?impersonationStopped=1');
                } else {
                    window.location.href = '/login.html?impersonationStopped=1';
                }
            });
            banner.appendChild(message);
            banner.appendChild(stopBtn);

            const nav = document.querySelector('.nav-main');
            if (nav && nav.parentNode) {
                nav.parentNode.insertBefore(banner, nav.nextSibling);
            } else {
                document.body.insertBefore(banner, document.body.firstChild);
            }
        }

        const message = document.getElementById('globalImpersonationBannerText');
        if (!isImpersonating) {
            banner.style.display = 'none';
            return;
        }

        const target = stateData.email || user.email || user.uid || 'unknown user';
        message.textContent = `⚠️ IMPERSONATION ACTIVE — You are viewing as: ${target}`;
        banner.style.display = 'block';
    }

    async function refreshAdminNavVisibility(user) {
        if (!user) {
            state.isAdmin = false;
            setAdminNavVisibility(false);
            return;
        }

        const seedAdminEmail = 'sardanapalos928@hotmail.com';
        const byEmail = !!(user.email && String(user.email).toLowerCase() === seedAdminEmail);

        // Apply a fast local decision first to avoid visual delay/flicker.
        setAdminNavVisibility(byEmail);

        // Then confirm via backend role check (supports promoted admins too).
        try {
            const client = window.apiClient || await waitForAPIClient(2000);
            const response = await client.fetch('/api/admin/check');
            if (!response || !response.ok) {
                state.isAdmin = byEmail;
                setAdminNavVisibility(byEmail);
                return;
            }
            const data = await response.json().catch(() => null);
            const backendIsAdmin = !!(data && data.errno === 0 && data.result && data.result.isAdmin === true);
            state.isAdmin = backendIsAdmin || byEmail;
            setAdminNavVisibility(state.isAdmin);
        } catch (e) {
            state.isAdmin = byEmail;
            setAdminNavVisibility(byEmail);
        }
    }

    function updateUserIdentity(user) {
        // Keep admin nav visibility in sync even if user-menu is not rendered yet.
        refreshAdminNavVisibility(user);
        renderImpersonationBanner(user);

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
        const normalizePath = (path) => {
            const cleaned = (path || '').replace(/\/$/, '');
            if (cleaned === '' || cleaned === '/' || cleaned === '/index') return '/index.html';
            return cleaned;
        };

        const currentPath = normalizePath(window.location.pathname);
        const homeAliases = new Set(['/index.html']);
        let matched = false;

        links.forEach(link => {
            try {
                const linkPath = normalizePath(new URL(link.getAttribute('href'), window.location.origin).pathname);
                const isHomeMatch = homeAliases.has(currentPath) && homeAliases.has(linkPath);
                if (linkPath === currentPath || isHomeMatch) {
                    link.classList.add('active');
                    link.setAttribute('aria-current', 'page');
                    matched = true;
                } else {
                    link.classList.remove('active');
                    link.removeAttribute('aria-current');
                }
            } catch (err) {
                // Ignore invalid URLs
            }
        });

        // Fallback: ensure Overview is active on home route even if URL parsing differs.
        if (!matched && homeAliases.has(currentPath)) {
            const overviewLink = document.querySelector('.nav-link[href="/"]') || document.querySelector('.nav-link[href="/index.html"]');
            if (overviewLink) {
                overviewLink.classList.add('active');
                overviewLink.setAttribute('aria-current', 'page');
            }
        }
    }

    function setupUserMenu() {
        const menu = document.querySelector('[data-user-menu]');
        if (!menu) return;
        const avatarBtn = menu.querySelector('[data-user-avatar]');
        const dropdown = menu.querySelector('[data-user-dropdown]');
        const settingsBtn = menu.querySelector('[data-go-settings]');
        const contactUsBtn = menu.querySelector('[data-contact-us]');
        const signOutBtn = menu.querySelector('[data-signout]');

        const getImpersonationUid = () => getImpersonationState().uid;
        const clearImpersonation = () => clearImpersonationState();

        const notify = (type, message) => {
            if (typeof window.showMessage === 'function') {
                window.showMessage(type, message);
            } else {
                window.alert(message);
            }
        };

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

        // Add stop-impersonation action once per page load
        if (dropdown && !dropdown.querySelector('[data-stop-impersonation]')) {
            const stopBtn = document.createElement('button');
            stopBtn.className = 'user-dropdown-item danger';
            stopBtn.type = 'button';
            stopBtn.setAttribute('data-stop-impersonation', '1');
            stopBtn.textContent = '🛑 Stop Impersonation';
            stopBtn.style.display = getImpersonationUid() ? '' : 'none';
            stopBtn.addEventListener('click', async () => {
                clearImpersonation();
                await signOut();
                if (typeof safeRedirect === 'function') {
                    safeRedirect('/login.html?impersonationStopped=1');
                } else {
                    window.location.href = '/login.html?impersonationStopped=1';
                }
            });
            dropdown.appendChild(stopBtn);
        }

        // Add delete-account action once per page load (before Sign Out)
        if (dropdown && !dropdown.querySelector('[data-delete-account]')) {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'user-dropdown-item danger';
            deleteBtn.type = 'button';
            deleteBtn.setAttribute('data-delete-account', '1');
            deleteBtn.textContent = '🗑️ Delete Account';

            deleteBtn.addEventListener('click', async () => {
                const currentUser = state.user;
                if (!currentUser) {
                    notify('error', 'You must be signed in to delete your account.');
                    return;
                }

                if (getImpersonationUid()) {
                    notify('warning', 'Stop impersonation before deleting an account.');
                    return;
                }

                const email = String(currentUser.email || '').trim();

                const firstConfirm = window.confirm(
                    'Delete account permanently? This action cannot be undone and will remove your data, rules, history, and settings.'
                );
                if (!firstConfirm) return;

                const confirmText = window.prompt('Type DELETE to confirm account deletion:');
                if (confirmText !== 'DELETE') {
                    notify('warning', 'Account deletion cancelled (confirmation text did not match).');
                    return;
                }

                const confirmEmail = email
                    ? window.prompt(`Type your email (${email}) to confirm:`)
                    : '';

                if (email && String(confirmEmail || '').trim().toLowerCase() !== email.toLowerCase()) {
                    notify('warning', 'Account deletion cancelled (email confirmation did not match).');
                    return;
                }

                const originalLabel = deleteBtn.textContent;
                deleteBtn.disabled = true;
                deleteBtn.textContent = 'Deleting...';

                try {
                    const response = await authFetch('/api/user/delete-account', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ confirmText: 'DELETE', confirmEmail: confirmEmail || '' })
                    });

                    const data = await response.json().catch(() => null);
                    if (!response.ok || !data || data.errno !== 0) {
                        throw new Error(data && data.error ? data.error : `Delete failed (${response.status})`);
                    }

                    clearImpersonation();
                    try {
                        if (typeof window.firebaseAuth !== 'undefined') {
                            await window.firebaseAuth.signOut();
                        }
                    } catch (e) {
                        // Best effort
                    }

                    window.location.href = '/login.html?accountDeleted=1';
                } catch (error) {
                    notify('error', `Failed to delete account: ${error.message || error}`);
                } finally {
                    deleteBtn.disabled = false;
                    deleteBtn.textContent = originalLabel;
                }
            });

            if (signOutBtn) {
                dropdown.insertBefore(deleteBtn, signOutBtn);
            } else {
                dropdown.appendChild(deleteBtn);
            }
        }

        if (signOutBtn) {
            signOutBtn.addEventListener('click', async () => {
                clearImpersonation();
                await signOut();
            });
        }
    }

    function setupMobileNavMenu() {
        const nav = document.querySelector('.nav-main');
        if (!nav) return;

        const navLinks = nav.querySelector('.nav-links');
        const navRight = nav.querySelector('.nav-right');
        if (!navLinks) return;

        let toggleBtn = nav.querySelector('[data-nav-toggle]');
        if (!toggleBtn) {
            toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = 'nav-toggle';
            toggleBtn.setAttribute('data-nav-toggle', '1');
            toggleBtn.setAttribute('aria-label', 'Toggle navigation menu');
            toggleBtn.setAttribute('aria-expanded', 'false');
            toggleBtn.textContent = '☰';
            nav.insertBefore(toggleBtn, nav.firstChild);
        }
        if (toggleBtn.dataset.bound === '1') return;
        toggleBtn.dataset.bound = '1';

        const closeMenu = () => {
            nav.classList.remove('nav-open');
            toggleBtn.setAttribute('aria-expanded', 'false');
            toggleBtn.textContent = '☰';
        };

        const openMenu = () => {
            nav.classList.add('nav-open');
            toggleBtn.setAttribute('aria-expanded', 'true');
            toggleBtn.textContent = '✕';
        };

        const toggleMenu = () => {
            if (nav.classList.contains('nav-open')) {
                closeMenu();
            } else {
                openMenu();
            }
        };

        toggleBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleMenu();
        });

        if (navLinks) {
            navLinks.addEventListener('click', (event) => {
                const link = event.target.closest('a');
                if (link && window.matchMedia('(max-width: 900px)').matches) {
                    closeMenu();
                }
            });
        }

        if (navRight) {
            navRight.addEventListener('click', (event) => {
                const link = event.target.closest('a');
                if (link && window.matchMedia('(max-width: 900px)').matches) {
                    closeMenu();
                }
            });
        }

        document.addEventListener('click', (event) => {
            if (!window.matchMedia('(max-width: 900px)').matches) return;
            if (!nav.contains(event.target)) {
                closeMenu();
            }
        });

        window.addEventListener('resize', () => {
            if (!window.matchMedia('(max-width: 900px)').matches) {
                closeMenu();
            }
        });
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
        clearImpersonationState();
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
                    const errorMsg = error?.message || 'Unknown error';
                    const userMsg = errorMsg.includes('already exists') 
                        ? 'Firebase initialization issue detected. Please reload the page.'
                        : errorMsg.includes('network') 
                        ? 'Network error initializing Firebase. Please check your connection.'
                        : 'Firebase initialization failed. Check console for details.';
                    
                    if (typeof showMessage === 'function') {
                        showMessage('error', userMsg);
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
            let signedOut = false;
            if (typeof window.firebaseAuth !== 'undefined') {
                const result = await window.firebaseAuth.signOut();
                signedOut = !(result && result.success === false);
            }

            // Fallback: if wrapper sign-out did not succeed (e.g. wrapper not initialized),
            // use Firebase Auth SDK directly when available.
            if (!signedOut && typeof firebase !== 'undefined' && firebase.auth) {
                const authInstance = firebase.auth();
                if (authInstance && authInstance.currentUser) {
                    await authInstance.signOut();
                    signedOut = true;
                }
            }

            if (!signedOut) {
                throw new Error('No active authenticated session found');
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

    function ensurePwaHeadTags() {
        const head = document.head;
        if (!head) return;

        const ensureMeta = (name, content, attribute = 'name') => {
            let meta = head.querySelector(`meta[${attribute}="${name}"]`);
            if (!meta) {
                meta = document.createElement('meta');
                meta.setAttribute(attribute, name);
                head.appendChild(meta);
            }
            meta.setAttribute('content', content);
        };

        const ensureLink = (rel, href) => {
            let link = head.querySelector(`link[rel="${rel}"]`);
            if (!link) {
                link = document.createElement('link');
                link.setAttribute('rel', rel);
                head.appendChild(link);
            }
            link.setAttribute('href', href);
        };

        ensureLink('manifest', '/manifest.webmanifest');
        ensureLink('apple-touch-icon', '/icons/apple-touch-icon.png');
        ensureMeta('theme-color', '#0d1117');
        ensureMeta('mobile-web-app-capable', 'yes');
        ensureMeta('apple-mobile-web-app-capable', 'yes');
        ensureMeta('apple-mobile-web-app-title', 'FoxESS Automation');
        ensureMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');
    }

    function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
        if (window.location.protocol !== 'https:' && !isLocalhost) {
            return;
        }

        const register = () => {
            navigator.serviceWorker.register('/sw.js').catch((error) => {
                console.warn('[AppShell] Service worker registration failed', error);
            });
        };

        if (document.readyState === 'complete') {
            register();
            return;
        }

        window.addEventListener('load', register, { once: true });
    }

    function initInstallPrompt() {
        let deferredInstallPrompt = null;
        let fallbackTimer = null;

        const isStandalone = () =>
            window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

        const isIOS = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent || '');
        const isAndroid = () => /android/i.test(window.navigator.userAgent || '');

        const ensureInstallButton = () => {
            let styleTag = document.getElementById('pwa-install-style');
            if (!styleTag) {
                styleTag = document.createElement('style');
                styleTag.id = 'pwa-install-style';
                styleTag.textContent = `
                    .pwa-install-wrapper {
                        display: flex;
                        justify-content: flex-end;
                        padding: 16px 0 8px;
                    }
                    .pwa-install-btn {
                        padding: 10px 14px;
                        border-radius: 10px;
                        border: 1px solid rgba(88, 166, 255, 0.4);
                        background: linear-gradient(135deg, #238636, #1a7f37);
                        color: #ffffff;
                        font-size: 13px;
                        font-weight: 600;
                        cursor: pointer;
                        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
                    }
                    .pwa-install-btn:hover {
                        filter: brightness(1.05);
                    }
                    @media (max-width: 900px) {
                        .pwa-install-wrapper {
                            position: fixed !important;
                            left: max(8px, env(safe-area-inset-left)) !important;
                            right: auto !important;
                            top: auto !important;
                            bottom: calc(12px + env(safe-area-inset-bottom)) !important;
                            width: auto !important;
                            justify-content: flex-start !important;
                            padding: 0;
                            z-index: 10000;
                        }
                        .pwa-install-btn {
                            margin-left: 0 !important;
                        }
                        .pwa-install-btn {
                            font-size: 12px;
                            padding: 9px 12px;
                        }
                    }
                `;
                document.head.appendChild(styleTag);
            }

            let button = document.getElementById('pwaInstallBtn');
            if (!button) {
                button = document.createElement('button');
                button.id = 'pwaInstallBtn';
                button.className = 'pwa-install-btn';
                button.type = 'button';
                button.style.display = 'none';

                // Place in document flow at end of main-content (below scheduler),
                // falling back to body if main-content is not present on this page.
                const wrapper = document.createElement('div');
                wrapper.className = 'pwa-install-wrapper';
                wrapper.appendChild(button);
                const mainContent = document.querySelector('.main-content') || document.querySelector('.left-panel') || document.body;
                mainContent.appendChild(wrapper);
            }
            return button;
        };

        const showButton = (label, onClick) => {
            if (isStandalone()) return;
            const button = ensureInstallButton();
            button.textContent = label;
            button.onclick = onClick;
            button.style.display = 'inline-flex';
        };

        const hideButton = () => {
            const button = document.getElementById('pwaInstallBtn');
            if (button) button.style.display = 'none';
        };

        const showManualInstallHelp = () => {
            if (isIOS()) {
                window.alert('On iPhone/iPad: open this site in Safari, tap Share, then choose "Add to Home Screen".');
                return;
            }

            if (isAndroid()) {
                window.alert('On Android: open the browser menu (⋮) and choose "Install app" or "Add to Home screen".');
                return;
            }

            window.alert('Use your browser menu and choose "Install" or "Add to Home screen".');
        };

        const scheduleFallbackPrompt = () => {
            if (isStandalone()) return;
            if (!isIOS() && !isAndroid()) return;
            if (fallbackTimer) clearTimeout(fallbackTimer);

            fallbackTimer = setTimeout(() => {
                if (deferredInstallPrompt) return;
                showButton('Install App', showManualInstallHelp);
            }, 3500);
        };

        window.addEventListener('beforeinstallprompt', (event) => {
            event.preventDefault();
            deferredInstallPrompt = event;
            if (fallbackTimer) {
                clearTimeout(fallbackTimer);
                fallbackTimer = null;
            }
            showButton('Install App', async () => {
                if (!deferredInstallPrompt) return;
                deferredInstallPrompt.prompt();
                try {
                    await deferredInstallPrompt.userChoice;
                } catch (err) {
                    console.warn('[AppShell] Install prompt interaction failed', err);
                }
                deferredInstallPrompt = null;
                hideButton();
            });
        });

        scheduleFallbackPrompt();

        window.addEventListener('appinstalled', () => {
            deferredInstallPrompt = null;
            if (fallbackTimer) {
                clearTimeout(fallbackTimer);
                fallbackTimer = null;
            }
            hideButton();
        });
    }

    function initPwaSupport() {
        ensurePwaHeadTags();
        registerServiceWorker();
        initInstallPrompt();
    }

    initPwaSupport();

    document.addEventListener('DOMContentLoaded', () => {
        document.body.classList.add('has-fixed-nav');
        setupMobileNavMenu();
        setupNavHighlight();
        setupUserMenu();
        relocateMetricsWidget();
        // Re-apply identity and admin link visibility in case auth state arrived
        // before DOM was ready on navigation.
        updateUserIdentity(state.user);
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
