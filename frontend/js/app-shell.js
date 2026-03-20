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
        profileInitUid: '',
        profileInitPromise: null,
        readyCallbacks: [],
        signOutCallbacks: [],
        metricsTimer: null,
        redirectTimer: null
    };

    function mergeOptions(options) {
        state.options = { ...defaultOptions, ...options };
        try {
            if (typeof window !== 'undefined' && window.__DISABLE_AUTH_REDIRECTS__ === true) {
                state.options.requireAuth = false;
            }
            const host = String(window.location?.hostname || '').toLowerCase();
            const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
            const isPlaywright = typeof navigator !== 'undefined' && navigator.webdriver === true;
            if (isLocalHost && isPlaywright) {
                state.options.requireAuth = false;
            }
        } catch (error) {
            // Keep default behavior if runtime inspection fails.
        }
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
        if (typeof window !== 'undefined' && window.__DISABLE_AUTH_REDIRECTS__ === true) {
            return;
        }
        if (state.redirectTimer) clearTimeout(state.redirectTimer);
        state.redirectTimer = setTimeout(() => {
            if (typeof safeRedirect === 'function') {
                safeRedirect('/login.html');
            } else {
                window.location.href = '/login.html';
            }
        }, 400);
    }

    function isPreviewModeActive() {
        try {
            return !!(window.PreviewSession && typeof window.PreviewSession.isActive === 'function' && window.PreviewSession.isActive());
        } catch (error) {
            return false;
        }
    }

    function isPreviewAllowedForCurrentPage() {
        if (!isPreviewModeActive()) return false;
        try {
            if (window.PreviewSession && typeof window.PreviewSession.isAllowedPath === 'function') {
                return window.PreviewSession.isAllowedPath(window.location.pathname);
            }
        } catch (error) {
            return false;
        }
        return false;
    }

    function shouldSkipProfileInit() {
        const impersonation = getImpersonationState();
        return Boolean(impersonation && impersonation.uid && impersonation.mode);
    }

    async function ensureUserProfileInitialized(client) {
        const currentUid = String(state.user?.uid || '');
        if (!currentUid) return true;
        if (shouldSkipProfileInit()) return true;
        if (state.profileInitUid === currentUid && state.profileInitPromise) {
            return state.profileInitPromise;
        }

        state.profileInitUid = currentUid;
        state.profileInitPromise = (async () => {
            try {
                const initResp = await client.fetch('/api/user/init-profile', { method: 'POST' });
                let initData = null;
                try {
                    initData = await initResp.json();
                } catch (jsonErr) {
                    initData = null;
                }

                if (initResp.status === 401) {
                    return false;
                }

                if (initResp.status === 403) {
                    console.info('[AppShell] Skipping user profile init: forbidden for current session.');
                    return true;
                }

                if (!initResp.ok || (initData && initData.errno !== 0)) {
                    console.warn('[AppShell] User profile init returned error:', initData?.error || `Request failed: ${initResp.status}`);
                }
            } catch (initErr) {
                console.warn('[AppShell] User profile initialization failed:', initErr && initErr.message ? initErr.message : initErr);
            }
            return true;
        })();

        return state.profileInitPromise;
    }

    async function ensureSetupComplete() {
        if (!state.options.checkSetup) return true;
        if (state.options.pageName === 'setup') return true;
        if (isPreviewModeActive()) {
            if (isPreviewAllowedForCurrentPage()) {
                return true;
            }
            if (typeof safeRedirect === 'function') {
                safeRedirect('/setup.html');
            } else {
                window.location.href = '/setup.html';
            }
            return false;
        }
        try {
            const client = window.apiClient || await waitForAPIClient(4000);
            const initOk = await ensureUserProfileInitialized(client);
            if (!initOk) {
                handleUnauthorizedRedirect();
                return false;
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
            const adminLink = document.getElementById('adminNavLink');
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
                    safeRedirect('/login.html?returnTo=%2Fadmin.html');
                } else {
                    window.location.href = '/login.html?returnTo=%2Fadmin.html';
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
        message.textContent = `\u26A0\uFE0F IMPERSONATION ACTIVE - You are viewing as: ${target}`;
        banner.style.display = 'block';
    }

    async function refreshAdminNavVisibility(user) {
        if (!user) {
            state.isAdmin = false;
            setAdminNavVisibility(false);
            return;
        }

        const seedAdminEmail = 'socrates.team.comms@gmail.com';
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

    const NAV_LINK_UI = {
        '/app.html': { icon: 'overview', label: 'Overview' },
        '/roi.html': { icon: 'roi', label: 'Automation ROI' },
        '/test.html': { icon: 'lab', label: 'Automation Lab' },
        '/history.html': { icon: 'reports', label: 'Reports' },
        '/market-insights.html': { icon: 'market', label: 'Market Insights', badge: 'NEW' },
        '/control.html': { icon: 'controls', label: 'Controls' },
        '/rules-library.html': { icon: 'library', label: 'Rules Library' },
        '/settings.html': { icon: 'settings', label: 'Settings' },
        '/admin.html': { icon: 'admin', label: 'Admin' }
    };

    const NAV_LINK_ICONS = {
        overview: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.8V20h14V9.8"/><path d="M9.5 20v-6h5v6"/></svg>',
        library: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 4h12a2 2 0 0 1 2 2v12H7a2 2 0 0 0-2 2z"/><path d="M7 4v16"/><path d="M11 8h5"/><path d="M11 11h5"/></svg>',
        roi: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 18h16"/><path d="m6 14 4-4 3 3 5-6"/><circle cx="7" cy="7" r="2.2"/><path d="M7 5.6v2.8"/><path d="M5.8 7h2.4"/></svg>',
        lab: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10 3v5l-5.5 9.5A2 2 0 0 0 6.2 20h11.6a2 2 0 0 0 1.7-2.5L14 8V3"/><path d="M9 8h6"/><path d="M9 14h6"/><path d="M11 16.5h2"/></svg>',
        reports: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 20h16"/><rect x="6" y="11" width="3" height="7" rx="1"/><rect x="11" y="8" width="3" height="10" rx="1"/><rect x="16" y="5" width="3" height="13" rx="1"/></svg>',
        controls: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="9" width="18" height="10" rx="5"/><path d="M8 13v4"/><path d="M6 15h4"/><circle cx="15.5" cy="13.5" r="1"/><circle cx="17.5" cy="15.5" r="1"/></svg>',
        settings: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/><circle cx="12" cy="12" r="3"/></svg>',
        market: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 17l4-4 4 4 4-8 6 6"/><circle cx="21" cy="15" r="1.4"/><path d="M3 21h18"/></svg>',
        admin: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3 4.5 6v5.8c0 4.4 3 8.3 7.5 9.2 4.5-.9 7.5-4.8 7.5-9.2V6L12 3z"/><path d="m9.5 12 1.8 1.8 3.2-3.4"/></svg>'
    };

    const USER_MENU_ICONS = {
        tour: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8"/><path d="m14.8 9.2-2 5.6-3.6 1.2 2-5.6 3.6-1.2z"/></svg>',
        contact: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 8h12a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-7l-4 3v-3H6a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3z"/><path d="M8 12h8"/><path d="M8 15h5"/></svg>',
        'theme-light': '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
        'theme-dark': '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/></svg>',
        stop: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 3h6l6 6v6l-6 6H9l-6-6V9z"/><path d="m8.5 8.5 7 7"/><path d="m15.5 8.5-7 7"/></svg>',
        delete: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M8 7l1 12h6l1-12"/><path d="M10 10v6"/><path d="M14 10v6"/></svg>',
        signout: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10 7V5a2 2 0 0 1 2-2h6v18h-6a2 2 0 0 1-2-2v-2"/><path d="M15 12H4"/><path d="m7 9-3 3 3 3"/></svg>'
    };

    const PAGE_TITLE_UI = {
        '/roi.html': { icon: 'roi', label: 'Automation ROI' },
        '/test.html': { icon: 'lab' },
        '/history.html': { icon: 'reports', label: 'Reports' },
        '/market-insights.html': { icon: 'market', label: 'AEMO Market Insights', selector: '.page-header h1' },
        '/control.html': { icon: 'controls', label: 'Advanced Controls' },
        '/rules-library.html': { icon: 'library', label: 'Rules Library' },
        '/settings.html': { icon: 'settings', label: 'Settings' },
        '/admin.html': { icon: 'admin', label: 'Admin Panel' }
    };

    function normalizeNavPath(path) {
        const cleaned = (path || '').replace(/\/$/, '');
        if (cleaned === '' || cleaned === '/' || cleaned === '/index' || cleaned === '/index.html') return '/app.html';
        return cleaned;
    }

    function stripLegacyIconPrefix(text) {
        const tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
        if (!tokens.length) return '';
        if (tokens.length > 1 && !/[A-Za-z0-9]/.test(tokens[0])) {
            tokens.shift();
        }
        return tokens.join(' ').trim();
    }

    function getMenuItemPresentation(button) {
        if (!button) return null;

        if (button.hasAttribute('data-go-settings')) return { icon: 'settings', label: 'Settings' };
        if (button.hasAttribute('data-setup-nav-locked') && button.getAttribute('data-setup-nav-locked') === 'settings') return { icon: 'settings', label: 'Settings' };
        if (button.hasAttribute('data-contact-us')) return { icon: 'contact', label: 'Contact Us' };
        if (button.hasAttribute('data-signout')) return { icon: 'signout', label: 'Sign Out' };
        if (button.hasAttribute('data-take-tour')) return { icon: 'tour', label: 'Take a Tour' };
        if (button.hasAttribute('data-stop-impersonation')) return { icon: 'stop', label: 'Stop Impersonation' };
        if (button.hasAttribute('data-delete-account')) return { icon: 'delete', label: 'Delete Account' };
        if (button.hasAttribute('data-toggle-theme')) {
            const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
            return currentTheme === 'light'
                ? { icon: 'theme-dark', label: 'Dark Theme' }
                : { icon: 'theme-light', label: 'Light Theme' };
        }
        return null;
    }

    function getIconMarkup(iconKey) {
        return NAV_LINK_ICONS[iconKey] || USER_MENU_ICONS[iconKey] || '';
    }

    function decorateUserMenuItem(button) {
        const presentation = getMenuItemPresentation(button);
        if (!presentation) return;

        const iconMarkup = getIconMarkup(presentation.icon);
        if (!iconMarkup) return;

        let iconEl = button.querySelector('.user-dropdown-item__icon');
        let labelEl = button.querySelector('.user-dropdown-item__label');

        if (!iconEl || !labelEl) {
            iconEl = document.createElement('span');
            iconEl.className = 'user-dropdown-item__icon';
            iconEl.setAttribute('aria-hidden', 'true');

            labelEl = document.createElement('span');
            labelEl.className = 'user-dropdown-item__label';

            button.textContent = '';
            button.appendChild(iconEl);
            button.appendChild(labelEl);
        }

        iconEl.innerHTML = iconMarkup;
        labelEl.textContent = presentation.label;
        button.dataset.userMenuIcon = presentation.icon;
    }

    function decorateUserMenuItems(root) {
        if (!root) return;
        root.querySelectorAll('.user-dropdown-item').forEach((button) => {
            decorateUserMenuItem(button);
        });
    }

    function decorateNavLinks() {
        const links = document.querySelectorAll('.nav-link[href]');
        if (!links.length) return;

        links.forEach((link) => {
            if (link.dataset.navIconDecorated === '1') return;

            let path = '';
            try {
                path = normalizeNavPath(new URL(link.getAttribute('href'), window.location.origin).pathname);
            } catch (err) {
                path = normalizeNavPath(link.getAttribute('href') || '');
            }

            const config = NAV_LINK_UI[path];
            if (!config) return;

            const iconMarkup = NAV_LINK_ICONS[config.icon];
            if (!iconMarkup) return;

            const fallbackLabel = stripLegacyIconPrefix(link.textContent || config.label);
            const label = config.label || fallbackLabel;

            const iconEl = document.createElement('span');
            iconEl.className = 'nav-link__icon';
            iconEl.setAttribute('aria-hidden', 'true');
            iconEl.innerHTML = iconMarkup;

            const labelEl = document.createElement('span');
            labelEl.className = 'nav-link__label';
            labelEl.textContent = label || fallbackLabel;

            const badgeEl = config.badge ? document.createElement('span') : null;
            if (badgeEl) {
                badgeEl.className = 'nav-link__badge';
                badgeEl.textContent = config.badge;
            }

            link.classList.add('nav-link--with-icon');
            link.dataset.navIcon = config.icon;
            link.dataset.navIconDecorated = '1';
            link.textContent = '';
            link.appendChild(iconEl);
            link.appendChild(labelEl);
            if (badgeEl) link.appendChild(badgeEl);
        });
    }

    function resolvePrimaryPageTitle(config) {
        const selectors = [];
        if (config && config.selector) {
            selectors.push(config.selector);
        }
        selectors.push(
            '.page-header h1',
            '.container.page-shell > header > h1',
            '.container > header > h1',
            'main header h1',
            'header h1'
        );

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el) return el;
        }
        return null;
    }

    function decoratePrimaryPageTitle() {
        const path = normalizeNavPath(window.location.pathname);
        const config = PAGE_TITLE_UI[path];
        if (!config || !config.icon) return;

        const heading = resolvePrimaryPageTitle(config);
        if (!heading || heading.dataset.pageTitleDecorated === '1') return;

        const iconMarkup = NAV_LINK_ICONS[config.icon];
        if (!iconMarkup) return;

        const stripped = stripLegacyIconPrefix(heading.textContent || '');
        const labelText = (config.label || stripped || '').trim();
        if (!labelText) return;

        const iconEl = document.createElement('span');
        iconEl.className = 'page-title__icon';
        iconEl.setAttribute('aria-hidden', 'true');
        iconEl.innerHTML = iconMarkup;

        const labelEl = document.createElement('span');
        labelEl.className = 'page-title__label';
        labelEl.textContent = labelText;

        heading.classList.add('page-title--with-icon');
        heading.dataset.pageTitleIcon = config.icon;
        heading.dataset.pageTitleDecorated = '1';
        heading.textContent = '';
        heading.appendChild(iconEl);
        heading.appendChild(labelEl);
    }

    function setupNavHighlight() {
        const links = document.querySelectorAll('.nav-link');
        if (!links.length) return;
        const currentPath = normalizeNavPath(window.location.pathname);
        const homeAliases = new Set(['/app.html']);
        let matched = false;

        links.forEach(link => {
            try {
                const linkPath = normalizeNavPath(new URL(link.getAttribute('href'), window.location.origin).pathname);
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
            const overviewLink = document.querySelector('.nav-link[href="/"]') || document.querySelector('.nav-link[href="/app.html"]');
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
                window.location.href = 'mailto:socrates.team.comms@gmail.com';
            });
        }

        // Add "Take a Tour" action once per page load
        if (dropdown && !dropdown.querySelector('[data-take-tour]')) {
            const tourBtn = document.createElement('button');
            tourBtn.className = 'user-dropdown-item';
            tourBtn.type = 'button';
            tourBtn.setAttribute('data-take-tour', '1');
            tourBtn.textContent = 'Take a Tour';
            tourBtn.addEventListener('click', () => {
                dropdown.classList.remove('show');
                if (window.location.pathname.includes('setup')) {
                    try {
                        const form = document.getElementById('setupForm');
                        if (window.PreviewSession) {
                            if (form && typeof window.PreviewSession.saveSetupDraft === 'function') {
                                window.PreviewSession.saveSetupDraft(form);
                            }
                            if (typeof window.PreviewSession.enterDashboardPreview === 'function') {
                                window.PreviewSession.enterDashboardPreview({
                                    source: 'profile-menu',
                                    scenario: 'solar-surplus',
                                    allowedPaths: ['/app.html']
                                });
                            }
                        } else {
                            try { sessionStorage.removeItem('lastRedirect'); } catch (e) {}
                            try { sessionStorage.setItem('tourAutoLaunch', '1'); } catch (e) {}
                        }
                    } catch (e) {
                        console.warn('[AppShell] Failed to enter preview mode from setup profile menu', e);
                    }
                    if (typeof safeRedirect === 'function') {
                        safeRedirect('/app.html');
                    } else {
                        window.location.href = '/app.html';
                    }
                    return;
                }
                if (window.TourEngine && typeof window.TourEngine.start === 'function') {
                    window.TourEngine.start(0);
                } else {
                    // TourEngine not loaded on this page - navigate to dashboard and start there
                    try {
                        sessionStorage.setItem('tourStep', '0');
                        sessionStorage.setItem('tourStepVersion', 'tour-v2026-03-15-ev-step');
                        sessionStorage.setItem('tourStepAt', String(Date.now()));
                    } catch (e) {}
                    if (typeof safeRedirect === 'function') {
                        safeRedirect('/app.html');
                    } else {
                        window.location.href = '/app.html';
                    }
                }
            });
            // Insert before settingsBtn (first item) if it exists, else append
            const settingsBtn = menu.querySelector('[data-go-settings]');
            if (settingsBtn && settingsBtn.parentNode === dropdown) {
                dropdown.insertBefore(tourBtn, settingsBtn);
            } else {
                dropdown.insertBefore(tourBtn, dropdown.firstChild);
            }
        }

        // Add theme toggle action once per page load
        if (dropdown && !dropdown.querySelector('[data-toggle-theme]')) {
            const themeBtn = document.createElement('button');
            themeBtn.className = 'user-dropdown-item';
            themeBtn.type = 'button';
            themeBtn.setAttribute('data-toggle-theme', '1');
            themeBtn.textContent = 'Light Theme';
            themeBtn.addEventListener('click', () => {
                const html = document.documentElement;
                const next = (html.getAttribute('data-theme') || 'dark') === 'dark' ? 'light' : 'dark';
                if (next === 'light') {
                    html.setAttribute('data-theme', 'light');
                } else {
                    html.removeAttribute('data-theme');  // dark = no attribute (default)
                }
                try { localStorage.setItem('uiTheme', next); } catch (e) {}
                const themeColorMeta = document.querySelector('meta[name="theme-color"]');
                if (themeColorMeta) {
                    themeColorMeta.setAttribute('content', next === 'light' ? '#ffffff' : '#0d1117');
                }
                document.querySelectorAll('[data-toggle-theme]').forEach((btn) => decorateUserMenuItem(btn));
                dropdown.classList.remove('show');
            });
            // Insert before stop-impersonation / delete-account (i.e. after tour btn)
            const contactBtn = menu.querySelector('[data-contact-us]');
            if (contactBtn && contactBtn.parentNode === dropdown) {
                dropdown.insertBefore(themeBtn, contactBtn.nextSibling);
            } else {
                dropdown.appendChild(themeBtn);
            }
        }

        // Add stop-impersonation action once per page load
        if (dropdown && !dropdown.querySelector('[data-stop-impersonation]')) {
            const stopBtn = document.createElement('button');
            stopBtn.className = 'user-dropdown-item danger';
            stopBtn.type = 'button';
            stopBtn.setAttribute('data-stop-impersonation', '1');
            stopBtn.textContent = 'Stop Impersonation';
            stopBtn.style.display = getImpersonationUid() ? '' : 'none';
            stopBtn.addEventListener('click', async () => {
                clearImpersonation();
                await signOut();
                if (typeof safeRedirect === 'function') {
                    safeRedirect('/login.html?returnTo=%2Fadmin.html');
                } else {
                    window.location.href = '/login.html?returnTo=%2Fadmin.html';
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
            deleteBtn.textContent = 'Delete Account';

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
                    decorateUserMenuItem(deleteBtn);
                }
            });

            if (signOutBtn) {
                dropdown.insertBefore(deleteBtn, signOutBtn);

                // Add visual separator above Sign Out to prevent accidental misclick
                if (!dropdown.querySelector('.user-dropdown-separator')) {
                    const sep = document.createElement('hr');
                    sep.className = 'user-dropdown-separator';
                    dropdown.insertBefore(sep, signOutBtn);
                }

                // Differentiate Sign Out from Delete Account - make it neutral, not danger
                signOutBtn.classList.remove('danger');
                signOutBtn.classList.add('sign-out');
            } else {
                dropdown.appendChild(deleteBtn);
            }
        }

        if (signOutBtn) {
            signOutBtn.addEventListener('click', async () => {
                clearImpersonation();
                await signOut();
                if (typeof safeRedirect === 'function') {
                    safeRedirect('/login.html?signedOut=1&tab=signin');
                } else {
                    window.location.href = '/login.html?signedOut=1&tab=signin';
                }
            });
        }

        decorateUserMenuItems(dropdown);
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
            toggleBtn.textContent = '\u2630';
            nav.insertBefore(toggleBtn, nav.firstChild);
        }
        if (toggleBtn.dataset.bound === '1') return;
        toggleBtn.dataset.bound = '1';

        const closeMenu = () => {
            nav.classList.remove('nav-open');
            toggleBtn.setAttribute('aria-expanded', 'false');
            toggleBtn.textContent = '\u2630';
        };

        const openMenu = () => {
            nav.classList.add('nav-open');
            toggleBtn.setAttribute('aria-expanded', 'true');
            toggleBtn.textContent = '\u2715';
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
        state.profileInitUid = '';
        state.profileInitPromise = null;
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
        const isLightTheme = document.documentElement.getAttribute('data-theme') === 'light';
        ensureMeta('theme-color', isLightTheme ? '#ffffff' : '#0d1117');
        ensureMeta('mobile-web-app-capable', 'yes');
        ensureMeta('apple-mobile-web-app-capable', 'yes');
        ensureMeta('apple-mobile-web-app-title', 'SoCrates');
        ensureMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');
    }

    function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
        const isPlaywright = typeof navigator !== 'undefined' && navigator.webdriver === true;
        if (typeof window !== 'undefined' && window.__DISABLE_SERVICE_WORKER__ === true) {
            return;
        }
        // Keep E2E focus/navigation deterministic on localhost automation runs.
        if (isLocalhost && isPlaywright) {
            return;
        }
        if (window.location.protocol !== 'https:' && !isLocalhost) {
            return;
        }

        const register = () => {
            let refreshing = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (refreshing) return;
                refreshing = true;
                window.location.reload();
            });

            navigator.serviceWorker.register('/sw.js?v=51').then((registration) => {
                if (typeof registration.update === 'function') {
                    registration.update().catch(() => {});
                }

                const promoteWaitingWorker = () => {
                    if (registration.waiting) {
                        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                    }
                };

                if (registration.waiting) {
                    promoteWaitingWorker();
                }

                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    if (!newWorker) return;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            promoteWaitingWorker();
                        }
                    });
                });
            }).catch((error) => {
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
        const ENABLE_IN_APP_INSTALL_PROMPTS = false;
        if (!ENABLE_IN_APP_INSTALL_PROMPTS) {
            const isMobilePromptSurface = /iphone|ipad|ipod|android/i.test(window.navigator.userAgent || '');
            if (isMobilePromptSurface) {
                window.addEventListener('beforeinstallprompt', (event) => {
                    event.preventDefault();
                });
            }
            const existingButton = document.getElementById('pwaInstallBtn');
            if (existingButton) existingButton.style.display = 'none';
            return;
        }

        let deferredInstallPrompt = null;
        let fallbackTimer = null;

        const PROMPT_DISMISS_UNTIL_KEY = 'pwaInstallPromptDismissUntil';
        const INSTALLED_SEEN_AT_KEY = 'pwaInstalledSeenAt';
        const INSTALL_PROMPT_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
        const MANUAL_HELP_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
        const INSTALLED_SEEN_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 days
        const KNOWN_PWA_HOSTS = [
            'socratesautomation.com',
            'www.socratesautomation.com',
            'inverter-automation-firebase.web.app',
            'inverter-automation-firebase.firebaseapp.com'
        ];

        const now = () => Date.now();

        const readStoredNumber = (key) => {
            try {
                const raw = window.localStorage.getItem(key);
                if (!raw) return 0;
                const parsed = Number(raw);
                return Number.isFinite(parsed) ? parsed : 0;
            } catch (_err) {
                return 0;
            }
        };

        const writeStoredNumber = (key, value) => {
            try {
                const safeValue = Math.max(0, Math.floor(Number(value) || 0));
                window.localStorage.setItem(key, String(safeValue));
            } catch (_err) {
                // Ignore storage errors (private mode / restricted storage).
            }
        };

        const clearStoredValue = (key) => {
            try {
                window.localStorage.removeItem(key);
            } catch (_err) {
                // Ignore storage errors.
            }
        };

        const isLocalhost = () => ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
        const isIOS = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent || '');
        const isAndroid = () => /android/i.test(window.navigator.userAgent || '');
        const isMobileInstallFlow = () => isIOS() || isAndroid();

        const getDisplayMode = () => {
            if (document.referrer && document.referrer.startsWith('android-app://')) {
                return 'twa';
            }
            if (window.navigator.standalone === true) {
                return 'standalone';
            }
            if (window.matchMedia('(display-mode: window-controls-overlay)').matches) {
                return 'window-controls-overlay';
            }
            if (window.matchMedia('(display-mode: standalone)').matches) {
                return 'standalone';
            }
            if (window.matchMedia('(display-mode: minimal-ui)').matches) {
                return 'minimal-ui';
            }
            if (window.matchMedia('(display-mode: fullscreen)').matches) {
                return 'fullscreen';
            }
            if (window.matchMedia('(display-mode: browser)').matches) {
                return 'browser';
            }
            return 'unknown';
        };

        const isStandalone = () => {
            const displayMode = getDisplayMode();
            return displayMode !== 'browser' && displayMode !== 'unknown';
        };

        const markInstalledSeen = () => {
            writeStoredNumber(INSTALLED_SEEN_AT_KEY, now());
        };

        const hasRecentInstalledSeen = () => {
            const seenAt = readStoredNumber(INSTALLED_SEEN_AT_KEY);
            if (!seenAt) return false;
            return (now() - seenAt) < INSTALLED_SEEN_TTL_MS;
        };

        const suppressPromptsFor = (durationMs = INSTALL_PROMPT_COOLDOWN_MS) => {
            writeStoredNumber(PROMPT_DISMISS_UNTIL_KEY, now() + durationMs);
        };

        const isPromptSuppressedByCooldown = () => {
            return now() < readStoredNumber(PROMPT_DISMISS_UNTIL_KEY);
        };

        const isCrossHostMigrationLaunch = () => {
            if (!document.referrer) return false;
            let refHost = '';
            try {
                refHost = String(new URL(document.referrer).hostname || '').toLowerCase();
            } catch (_err) {
                return false;
            }
            const currentHost = String(window.location.hostname || '').toLowerCase();
            if (!refHost || !currentHost || refHost === currentHost) return false;
            return KNOWN_PWA_HOSTS.includes(refHost) && KNOWN_PWA_HOSTS.includes(currentHost);
        };

        const shouldSuppressPrompts = () => {
            if (isStandalone()) return true;
            if (hasRecentInstalledSeen()) return true;
            if (isPromptSuppressedByCooldown()) return true;
            return false;
        };

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
                        border: 1px solid var(--border-accent);
                        background: var(--gradient-success);
                        color: #ffffff;
                        font-size: 13px;
                        font-weight: 600;
                        cursor: pointer;
                        box-shadow: var(--shadow-lg);
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

                // Place in document flow at end of main-content (below scheduler).
                // On setup page, mount in setup footer to avoid becoming a flex-row sibling of the form.
                const wrapper = document.createElement('div');
                wrapper.className = 'pwa-install-wrapper';
                wrapper.appendChild(button);
                const setupFooter = document.querySelector('.setup-footer');
                const mountTarget = setupFooter || document.querySelector('.main-content') || document.querySelector('.left-panel') || document.body;
                mountTarget.appendChild(wrapper);
            }
            return button;
        };

        const showButton = (label, onClick) => {
            if (!isMobileInstallFlow()) return;
            if (shouldSuppressPrompts()) return;
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
                suppressPromptsFor(MANUAL_HELP_COOLDOWN_MS);
                return;
            }

            if (isAndroid()) {
                window.alert('On Android: open the browser menu (three dots) and choose "Install app" or "Add to Home screen".');
                suppressPromptsFor(MANUAL_HELP_COOLDOWN_MS);
                return;
            }

            window.alert('Use your browser menu and choose "Install" or "Add to Home screen".');
            suppressPromptsFor(MANUAL_HELP_COOLDOWN_MS);
        };

        const clearFallbackTimer = () => {
            if (!fallbackTimer) return;
            clearTimeout(fallbackTimer);
            fallbackTimer = null;
        };

        const scheduleFallbackPrompt = () => {
            if (!isIOS()) return;
            if (shouldSuppressPrompts()) return;
            clearFallbackTimer();

            fallbackTimer = setTimeout(() => {
                if (deferredInstallPrompt) return;
                if (shouldSuppressPrompts()) return;
                showButton('Install App', showManualInstallHelp);
            }, 5000);
        };

        const detectInstalledRelatedApps = async () => {
            if (typeof navigator.getInstalledRelatedApps !== 'function') return;
            try {
                const relatedApps = await navigator.getInstalledRelatedApps();
                if (Array.isArray(relatedApps) && relatedApps.length > 0) {
                    markInstalledSeen();
                    clearStoredValue(PROMPT_DISMISS_UNTIL_KEY);
                    deferredInstallPrompt = null;
                    clearFallbackTimer();
                    hideButton();
                }
            } catch (_err) {
                // Best-effort detection only.
            }
        };

        if (isStandalone()) {
            markInstalledSeen();
            clearStoredValue(PROMPT_DISMISS_UNTIL_KEY);
        } else if (isCrossHostMigrationLaunch()) {
            // If a launch crossed known app hosts (www/apex/firebase hosts), treat it as
            // an existing app install context migration and suppress install nags.
            markInstalledSeen();
            suppressPromptsFor();
        }

        window.addEventListener('beforeinstallprompt', (event) => {
            if (isLocalhost()) {
                deferredInstallPrompt = null;
                hideButton();
                return;
            }
            event.preventDefault();
            // On desktop, let the browser keep its own install/open-in-app UX.
            // Suppressing it here creates a second install CTA and makes uninstall
            // behavior feel inconsistent because PWA installs are browser-specific.
            if (!isMobileInstallFlow()) {
                deferredInstallPrompt = null;
                hideButton();
                return;
            }
            if (shouldSuppressPrompts()) {
                deferredInstallPrompt = null;
                hideButton();
                return;
            }
            deferredInstallPrompt = event;
            clearFallbackTimer();
            showButton('Install App', async () => {
                if (!deferredInstallPrompt) return;
                deferredInstallPrompt.prompt();
                let accepted = false;
                try {
                    const choiceResult = await deferredInstallPrompt.userChoice;
                    accepted = choiceResult && choiceResult.outcome === 'accepted';
                } catch (err) {
                    console.warn('[AppShell] Install prompt interaction failed', err);
                }
                if (accepted) {
                    markInstalledSeen();
                    clearStoredValue(PROMPT_DISMISS_UNTIL_KEY);
                } else {
                    suppressPromptsFor();
                }
                deferredInstallPrompt = null;
                hideButton();
            });
        });

        scheduleFallbackPrompt();
        detectInstalledRelatedApps();

        window.addEventListener('appinstalled', () => {
            deferredInstallPrompt = null;
            markInstalledSeen();
            clearStoredValue(PROMPT_DISMISS_UNTIL_KEY);
            clearFallbackTimer();
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
        decorateNavLinks();
        decoratePrimaryPageTitle();
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
