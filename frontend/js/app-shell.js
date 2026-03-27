(function (window, document) {
    const APP_RELEASE_ID = '2026-03-27-notifications-v1';
    const APP_RELEASE_STORAGE_KEY = 'socratesAppReleaseId';
    const APP_RELEASE_RELOAD_SESSION_KEY = `socratesAppReleaseReload:${APP_RELEASE_ID}`;
    const SERVICE_WORKER_VERSION = '56';
    const NOTIFICATION_POLL_INTERVAL_MS = 60000;
    const NOTIFICATION_PAGE_LIMIT = 20;
    const SOCRATES_CACHE_PREFIX = 'socrates-';
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
        redirectTimer: null,
        activeAnnouncementId: '',
        announcementRequestToken: 0,
        announcementDismissPending: false,
        sessionHiddenAnnouncementIds: [],
        notificationsEnabled: true,
        notificationItems: [],
        notificationUnreadCount: 0,
        notificationNextCursor: null,
        notificationPanelOpen: false,
        notificationPollingTimer: null,
        notificationRequestToken: 0,
        notificationMessageBound: false
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
            let hasSeededMockUser = false;
            try {
                hasSeededMockUser = Boolean(
                    window.mockFirebaseAuth?.currentUser ||
                    localStorage.getItem('mockAuthUser')
                );
            } catch (storageError) {
                hasSeededMockUser = Boolean(window.mockFirebaseAuth?.currentUser);
            }
            if (isLocalHost && isPlaywright && !hasSeededMockUser) {
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

    function hasSessionHiddenAnnouncement(id) {
        return !!(id && Array.isArray(state.sessionHiddenAnnouncementIds) && state.sessionHiddenAnnouncementIds.includes(id));
    }

    function markSessionHiddenAnnouncement(id) {
        if (!id) return;
        if (!Array.isArray(state.sessionHiddenAnnouncementIds)) {
            state.sessionHiddenAnnouncementIds = [];
        }
        if (!state.sessionHiddenAnnouncementIds.includes(id)) {
            state.sessionHiddenAnnouncementIds.push(id);
        }
    }

    function injectAnnouncementBannerStyles() {
        if (document.getElementById('globalAnnouncementBannerStyles')) return;
        const style = document.createElement('style');
        style.id = 'globalAnnouncementBannerStyles';
        style.textContent = `
            #globalAnnouncementBanner {
                display: none;
                position: sticky;
                top: 64px;
                z-index: 9998;
                width: 100%;
                overflow: hidden;
            }
            #globalAnnouncementBanner.gab-visible {
                display: block;
                animation: gabSlideDown 0.32s cubic-bezier(0.16, 1, 0.3, 1) both;
            }
            @keyframes gabSlideDown {
                from { transform: translateY(-110%); opacity: 0; }
                to   { transform: translateY(0);    opacity: 1; }
            }
            .gab-shimmer {
                position: absolute;
                inset: 0;
                background: linear-gradient(105deg,
                    transparent 40%,
                    rgba(255,255,255,0.07) 50%,
                    transparent 60%);
                background-size: 200% 100%;
                animation: gabShimmer 4s linear 0.4s infinite;
                pointer-events: none;
            }
            @keyframes gabShimmer {
                0%   { background-position: 200% 0; }
                100% { background-position: -200% 0; }
            }
            .gab-inner {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 16px;
                max-width: 1280px;
                margin: 0 auto;
                padding: 13px 18px;
                position: relative;
                z-index: 1;
            }
            .gab-left {
                display: flex;
                align-items: flex-start;
                gap: 12px;
                min-width: 0;
                flex: 1;
            }
            .gab-icon {
                font-size: 20px;
                line-height: 1;
                flex-shrink: 0;
                margin-top: 1px;
                filter: drop-shadow(0 1px 4px rgba(0,0,0,0.3));
            }
            .gab-content {
                min-width: 0;
                flex: 1;
            }
            #globalAnnouncementBannerTitle {
                font-size: 14px;
                font-weight: 800;
                line-height: 1.35;
                margin-bottom: 3px;
                letter-spacing: 0.01em;
            }
            #globalAnnouncementBannerBody {
                font-size: 13px;
                line-height: 1.6;
                white-space: pre-line;
                opacity: 0.92;
            }
            .gab-actions {
                display: flex;
                align-items: center;
                gap: 8px;
                flex: 0 0 auto;
                padding-top: 1px;
            }
            #globalAnnouncementDismissButton {
                padding: 7px 16px;
                border-radius: 999px;
                border: 1.5px solid rgba(255,255,255,0.45);
                background: rgba(0,0,0,0.18);
                color: inherit;
                cursor: pointer;
                font-size: 12px;
                font-weight: 700;
                letter-spacing: 0.03em;
                transition: background 0.18s, border-color 0.18s, transform 0.12s;
                white-space: nowrap;
            }
            #globalAnnouncementDismissButton:hover:not(:disabled) {
                background: rgba(0,0,0,0.32);
                border-color: rgba(255,255,255,0.72);
                transform: translateY(-1px);
            }
            #globalAnnouncementDismissButton:active:not(:disabled) {
                transform: translateY(0);
            }
            #globalAnnouncementDismissButton:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    const ANNOUNCEMENT_THEMES = {
        info: {
            background: 'linear-gradient(100deg, #0c2d52 0%, #1d4ed8 60%, #1e40af 100%)',
            color: '#eff6ff',
            icon: 'ℹ️',
            borderBottom: '1px solid rgba(147,197,253,0.2)'
        },
        success: {
            background: 'linear-gradient(100deg, #052e16 0%, #166534 60%, #14532d 100%)',
            color: '#f0fdf4',
            icon: '✅',
            borderBottom: '1px solid rgba(134,239,172,0.2)'
        },
        warning: {
            background: 'linear-gradient(100deg, #431407 0%, #b45309 60%, #92400e 100%)',
            color: '#fffbeb',
            icon: '⚠️',
            borderBottom: '1px solid rgba(252,211,77,0.22)'
        },
        danger: {
            background: 'linear-gradient(100deg, #450a0a 0%, #b91c1c 60%, #991b1b 100%)',
            color: '#fef2f2',
            icon: '🚨',
            borderBottom: '1px solid rgba(252,165,165,0.2)'
        }
    };

    function ensureAnnouncementBanner() {
        let banner = document.getElementById('globalAnnouncementBanner');
        if (banner) return banner;

        injectAnnouncementBannerStyles();

        banner = document.createElement('section');
        banner.id = 'globalAnnouncementBanner';
        banner.setAttribute('role', 'status');
        banner.setAttribute('aria-live', 'polite');

        // Shimmer overlay
        const shimmer = document.createElement('div');
        shimmer.className = 'gab-shimmer';

        const inner = document.createElement('div');
        inner.className = 'gab-inner';

        const left = document.createElement('div');
        left.className = 'gab-left';

        const iconEl = document.createElement('span');
        iconEl.className = 'gab-icon';
        iconEl.id = 'globalAnnouncementBannerIcon';
        iconEl.setAttribute('aria-hidden', 'true');

        const content = document.createElement('div');
        content.className = 'gab-content';

        const title = document.createElement('div');
        title.id = 'globalAnnouncementBannerTitle';

        const message = document.createElement('div');
        message.id = 'globalAnnouncementBannerBody';

        const actions = document.createElement('div');
        actions.className = 'gab-actions';

        const dismissBtn = document.createElement('button');
        dismissBtn.type = 'button';
        dismissBtn.id = 'globalAnnouncementDismissButton';
        dismissBtn.textContent = 'Dismiss';
        dismissBtn.addEventListener('click', async () => {
            const announcementId = banner.dataset.announcementId || '';
            const showOnce = banner.dataset.showOnce === 'true';
            if (showOnce && announcementId) {
                if (state.announcementDismissPending) return;
                state.announcementDismissPending = true;
                dismissBtn.disabled = true;
                dismissBtn.textContent = 'Saving...';
                try {
                    const response = await authFetch('/api/config/announcement/dismiss', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: announcementId })
                    });
                    const data = await response.json().catch(() => null);
                    if (!response.ok || !data || data.errno !== 0) {
                        throw new Error(data?.error || `Request failed: ${response.status}`);
                    }
                    markSessionHiddenAnnouncement(announcementId);
                    clearAnnouncementBanner();
                } catch (error) {
                    dismissBtn.disabled = false;
                    dismissBtn.textContent = 'Dismiss';
                    if (typeof showMessage === 'function') {
                        showMessage('warning', `Failed to dismiss announcement: ${error.message || error}`);
                    }
                } finally {
                    state.announcementDismissPending = false;
                }
                return;
            }

            if (announcementId) {
                markSessionHiddenAnnouncement(announcementId);
            }
            clearAnnouncementBanner();
        });

        content.appendChild(title);
        content.appendChild(message);
        left.appendChild(iconEl);
        left.appendChild(content);
        actions.appendChild(dismissBtn);
        inner.appendChild(left);
        inner.appendChild(actions);
        banner.appendChild(shimmer);
        banner.appendChild(inner);

        const impersonationBanner = document.getElementById('globalImpersonationBanner');
        const nav = document.querySelector('.nav-main');
        if (impersonationBanner && impersonationBanner.parentNode) {
            impersonationBanner.parentNode.insertBefore(banner, impersonationBanner.nextSibling);
        } else if (nav && nav.parentNode) {
            nav.parentNode.insertBefore(banner, nav.nextSibling);
        } else if (document.body) {
            document.body.insertBefore(banner, document.body.firstChild);
        }

        return banner;
    }

    function clearAnnouncementBanner() {
        const banner = document.getElementById('globalAnnouncementBanner');
        state.activeAnnouncementId = '';
        if (!banner) return;
        banner.classList.remove('gab-visible');
        banner.style.display = 'none';
        banner.dataset.announcementId = '';
        banner.dataset.showOnce = 'false';
    }

    function renderAnnouncementBanner(announcement) {
        if (!announcement || (!announcement.title && !announcement.body)) {
            clearAnnouncementBanner();
            return;
        }

        if (announcement.id && hasSessionHiddenAnnouncement(announcement.id)) {
            clearAnnouncementBanner();
            return;
        }

        const banner = ensureAnnouncementBanner();
        const title = document.getElementById('globalAnnouncementBannerTitle');
        const body = document.getElementById('globalAnnouncementBannerBody');
        const iconEl = document.getElementById('globalAnnouncementBannerIcon');
        const dismissBtn = document.getElementById('globalAnnouncementDismissButton');
        const sev = String(announcement.severity || 'info').toLowerCase();
        const theme = ANNOUNCEMENT_THEMES[sev] || ANNOUNCEMENT_THEMES.info;
        const impersonationVisible = !!(document.getElementById('globalImpersonationBanner') &&
            document.getElementById('globalImpersonationBanner').style.display !== 'none');

        banner.style.background = theme.background;
        banner.style.color = theme.color;
        banner.style.borderBottom = theme.borderBottom;
        banner.style.boxShadow = '0 8px 32px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.2)';
        banner.style.top = impersonationVisible ? '108px' : '64px';
        banner.dataset.announcementId = announcement.id || '';
        banner.dataset.showOnce = announcement.showOnce ? 'true' : 'false';
        if (iconEl) iconEl.textContent = theme.icon;
        title.textContent = announcement.title || 'Announcement';
        body.textContent = announcement.body || '';
        dismissBtn.textContent = announcement.showOnce ? 'Dismiss' : 'Hide';
        dismissBtn.disabled = false;
        // Trigger slide-down animation on each show.
        // Remove inline display so CSS class rules take over, then add class.
        banner.style.removeProperty('display');
        banner.classList.remove('gab-visible');
        void banner.offsetWidth; // force reflow so animation re-triggers
        banner.classList.add('gab-visible');
        state.activeAnnouncementId = announcement.id || '';
    }

    async function refreshAnnouncementBanner() {
        if (!state.user || !state.options.requireAuth) {
            clearAnnouncementBanner();
            return;
        }

        const requestToken = ++state.announcementRequestToken;
        try {
            const response = await authFetch('/api/config/announcement');
            const data = await response.json().catch(() => null);
            if (requestToken !== state.announcementRequestToken) return;
            if (!response.ok || !data || data.errno !== 0) {
                clearAnnouncementBanner();
                return;
            }
            renderAnnouncementBanner(data.result?.announcement || null);
        } catch (error) {
            if (requestToken !== state.announcementRequestToken) return;
            console.warn('[AppShell] Failed to load announcement banner', error);
            clearAnnouncementBanner();
        }
    }

    function escapeNotificationText(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeNotificationRecord(record) {
        const source = record && typeof record === 'object' ? record : {};
        const createdAtRaw = source.createdAtMs || source.createdAt || null;
        const createdAtMs = Number.isFinite(Number(createdAtRaw))
            ? Number(createdAtRaw)
            : Date.parse(createdAtRaw || '');
        return {
            id: String(source.id || '').trim(),
            title: String(source.title || '').trim(),
            body: String(source.body || '').trim(),
            severity: String(source.severity || 'info').trim().toLowerCase(),
            deepLink: String(source.deepLink || '').trim(),
            read: source.read === true,
            createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0
        };
    }

    function formatNotificationTime(createdAtMs) {
        const millis = Number(createdAtMs);
        if (!Number.isFinite(millis) || millis <= 0) return '';
        const ageMs = Date.now() - millis;
        if (ageMs < 60 * 1000) return 'just now';
        if (ageMs < 60 * 60 * 1000) return `${Math.floor(ageMs / (60 * 1000))}m ago`;
        if (ageMs < 24 * 60 * 60 * 1000) return `${Math.floor(ageMs / (60 * 60 * 1000))}h ago`;
        return new Date(millis).toLocaleDateString('en-AU', {
            day: '2-digit',
            month: 'short'
        });
    }

    function ensureNotificationCenter() {
        const navRight = document.querySelector('.nav-right');
        if (!navRight) return null;
        let center = document.getElementById('navNotificationCenter');
        if (center) return center;

        center = document.createElement('div');
        center.id = 'navNotificationCenter';
        center.className = 'nav-notification-center';

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.id = 'navNotificationButton';
        trigger.className = 'nav-notification-btn';
        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-label', 'Notifications');
        trigger.innerHTML = '<span class="nav-notification-icon" aria-hidden="true">\uD83D\uDD14</span><span class="nav-notification-label">Alerts</span><span id="navNotificationBadge" class="nav-notification-badge" style="display:none;">0</span>';

        const panel = document.createElement('section');
        panel.id = 'navNotificationPanel';
        panel.className = 'nav-notification-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Notifications');
        panel.hidden = true;
        panel.innerHTML = [
            '<div class="nav-notification-panel-head">',
            '<strong>Notifications</strong>',
            '<button type="button" id="navNotificationMarkAllBtn" class="nav-notification-inline-btn">Mark all read</button>',
            '</div>',
            '<div id="navNotificationList" class="nav-notification-list">',
            '<div class="nav-notification-empty">No notifications yet.</div>',
            '</div>',
            '<div class="nav-notification-panel-foot">',
            '<button type="button" id="navNotificationLoadMoreBtn" class="nav-notification-inline-btn" style="display:none;">Load more</button>',
            '</div>'
        ].join('');

        center.appendChild(trigger);
        center.appendChild(panel);
        navRight.insertBefore(center, navRight.firstChild);

        const list = panel.querySelector('#navNotificationList');
        const markAllBtn = panel.querySelector('#navNotificationMarkAllBtn');
        const loadMoreBtn = panel.querySelector('#navNotificationLoadMoreBtn');

        trigger.addEventListener('click', async (event) => {
            event.preventDefault();
            state.notificationPanelOpen = !state.notificationPanelOpen;
            trigger.setAttribute('aria-expanded', state.notificationPanelOpen ? 'true' : 'false');
            panel.hidden = !state.notificationPanelOpen;
            if (state.notificationPanelOpen) {
                await refreshNotifications({ includeItems: true });
            }
        });

        document.addEventListener('click', (event) => {
            if (!state.notificationPanelOpen) return;
            if (!center.contains(event.target)) {
                state.notificationPanelOpen = false;
                trigger.setAttribute('aria-expanded', 'false');
                panel.hidden = true;
            }
        });

        list.addEventListener('click', async (event) => {
            const row = event.target.closest('[data-notification-id]');
            if (!row) return;
            const notificationId = row.getAttribute('data-notification-id') || '';
            const deepLink = row.getAttribute('data-notification-link') || '';
            if (!notificationId) return;

            const target = state.notificationItems.find((item) => item.id === notificationId);
            if (target && !target.read) {
                await markNotificationsRead({ ids: [notificationId], read: true });
                target.read = true;
                state.notificationUnreadCount = Math.max(0, Number(state.notificationUnreadCount || 0) - 1);
                renderNotificationList();
                updateNotificationBadge();
            }

            if (deepLink) {
                if (typeof safeRedirect === 'function') {
                    safeRedirect(deepLink);
                } else {
                    window.location.href = deepLink;
                }
            }
        });

        if (markAllBtn) {
            markAllBtn.addEventListener('click', async () => {
                await markNotificationsRead({ all: true, read: true });
                await refreshNotifications({ includeItems: true, resetCursor: true });
            });
        }

        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', async () => {
                await refreshNotifications({ includeItems: true, append: true });
            });
        }

        return center;
    }

    function updateNotificationBadge() {
        const badge = document.getElementById('navNotificationBadge');
        if (!badge) return;
        const unreadCount = Number(state.notificationUnreadCount || 0);
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
            badge.style.display = 'inline-flex';
        } else {
            badge.textContent = '0';
            badge.style.display = 'none';
        }
    }

    function renderNotificationList() {
        const list = document.getElementById('navNotificationList');
        const loadMoreBtn = document.getElementById('navNotificationLoadMoreBtn');
        if (!list) return;
        const rows = Array.isArray(state.notificationItems) ? state.notificationItems : [];
        if (!rows.length) {
            list.innerHTML = '<div class="nav-notification-empty">No notifications yet.</div>';
            if (loadMoreBtn) loadMoreBtn.style.display = 'none';
            return;
        }

        const severityTone = (severity) => {
            if (severity === 'danger') return 'danger';
            if (severity === 'warning') return 'warning';
            if (severity === 'success') return 'success';
            return 'info';
        };

        list.innerHTML = rows.map((entry) => {
            const row = normalizeNotificationRecord(entry);
            const title = escapeNotificationText(row.title || 'Notification');
            const body = escapeNotificationText(row.body || '');
            const when = escapeNotificationText(formatNotificationTime(row.createdAtMs));
            const tone = severityTone(row.severity);
            const deepLink = row.deepLink || '';
            const rowClasses = `nav-notification-row ${row.read ? '' : 'is-unread'} tone-${tone}`.trim();
            return [
                `<article class="${rowClasses}" data-notification-id="${escapeNotificationText(row.id)}" data-notification-link="${escapeNotificationText(deepLink)}">`,
                `<header><h4>${title}</h4><time>${when}</time></header>`,
                body ? `<p>${body}</p>` : '',
                '</article>'
            ].join('');
        }).join('');

        if (loadMoreBtn) {
            loadMoreBtn.style.display = state.notificationNextCursor ? '' : 'none';
        }
    }

    async function markNotificationsRead(payload) {
        if (!state.user) return { updatedCount: 0 };
        try {
            const response = await authFetch('/api/notifications/read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload || {})
            });
            const data = await response.json().catch(() => null);
            if (!response.ok || !data || data.errno !== 0) {
                throw new Error(data?.error || `Request failed: ${response.status}`);
            }
            return data.result || { updatedCount: 0 };
        } catch (error) {
            if (typeof showMessage === 'function') {
                showMessage('warning', `Failed to update notification state: ${error.message || error}`);
            }
            return { updatedCount: 0 };
        }
    }

    async function refreshNotifications(options = {}) {
        if (!state.user || !state.notificationsEnabled) return;
        const includeItems = options.includeItems !== false;
        const append = options.append === true;
        const resetCursor = options.resetCursor === true;
        const requestToken = ++state.notificationRequestToken;
        const cursor = append
            ? state.notificationNextCursor
            : (resetCursor ? null : state.notificationNextCursor);

        try {
            const params = new URLSearchParams();
            params.set('limit', String(NOTIFICATION_PAGE_LIMIT));
            if (append && cursor) params.set('cursor', String(cursor));
            const response = await authFetch(`/api/notifications?${params.toString()}`);
            const data = await response.json().catch(() => null);
            if (requestToken !== state.notificationRequestToken) return;
            if (!response.ok || !data || data.errno !== 0) {
                throw new Error(data?.error || `Request failed: ${response.status}`);
            }

            const result = data.result || {};
            const incomingItems = Array.isArray(result.notifications)
                ? result.notifications.map((item) => normalizeNotificationRecord(item))
                : [];
            state.notificationUnreadCount = Number(result.unreadCount || 0);
            state.notificationNextCursor = String(result.nextCursor || '').trim() || null;
            if (includeItems) {
                if (append) {
                    state.notificationItems = [...state.notificationItems, ...incomingItems];
                } else {
                    state.notificationItems = incomingItems;
                }
                renderNotificationList();
            }
            updateNotificationBadge();
        } catch (error) {
            if (!options.silent) {
                console.warn('[AppShell] Failed to refresh notifications', error);
            }
        }
    }

    function stopNotificationPolling() {
        if (state.notificationPollingTimer) {
            clearInterval(state.notificationPollingTimer);
            state.notificationPollingTimer = null;
        }
    }

    function startNotificationPolling() {
        stopNotificationPolling();
        state.notificationPollingTimer = setInterval(() => {
            refreshNotifications({ includeItems: state.notificationPanelOpen, silent: true });
        }, NOTIFICATION_POLL_INTERVAL_MS);
    }

    function teardownNotificationCenter() {
        stopNotificationPolling();
        state.notificationRequestToken += 1;
        state.notificationItems = [];
        state.notificationUnreadCount = 0;
        state.notificationNextCursor = null;
        state.notificationPanelOpen = false;
        const center = document.getElementById('navNotificationCenter');
        if (center) {
            center.remove();
        }
    }

    function handleServiceWorkerNotificationMessage(event) {
        const payload = event?.data && typeof event.data === 'object' ? event.data : null;
        if (!payload) return;
        const type = String(payload.type || '').trim();
        if (type !== 'SOC_NOTIFICATIONS_PUSH') return;
        const notification = normalizeNotificationRecord(payload.payload || {});
        if (typeof showMessage === 'function') {
            const toastType = notification.severity === 'danger'
                ? 'error'
                : (notification.severity === 'warning' ? 'warning' : 'info');
            showMessage(toastType, notification.title || notification.body || 'New notification');
        }
        refreshNotifications({ includeItems: state.notificationPanelOpen, silent: true });
    }

    async function initNotificationCenter() {
        if (!state.user || !state.options.requireAuth) {
            teardownNotificationCenter();
            return;
        }

        const center = ensureNotificationCenter();
        if (!center) return;
        if (!state.notificationsEnabled) return;

        if (navigator.serviceWorker && !state.notificationMessageBound) {
            navigator.serviceWorker.addEventListener('message', handleServiceWorkerNotificationMessage);
            state.notificationMessageBound = true;
        }

        await refreshNotifications({ includeItems: state.notificationPanelOpen, resetCursor: true, silent: true });
        startNotificationPolling();
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
            const announcementBanner = document.getElementById('globalAnnouncementBanner');
            if (announcementBanner && announcementBanner.style.display !== 'none') {
                announcementBanner.style.top = '64px';
            }
            return;
        }

        const target = stateData.email || user.email || user.uid || 'unknown user';
        message.textContent = `\u26A0\uFE0F IMPERSONATION ACTIVE - You are viewing as: ${target}`;
        banner.style.display = 'block';
        const announcementBanner = document.getElementById('globalAnnouncementBanner');
        if (announcementBanner && announcementBanner.style.display !== 'none') {
            announcementBanner.style.top = '108px';
        }
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
        if (!user) {
            clearAnnouncementBanner();
        }

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
                        sessionStorage.setItem('tourStepVersion', 'tour-v2026-03-22-market-insights');
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
        state.announcementRequestToken += 1;
        state.announcementDismissPending = false;
        state.sessionHiddenAnnouncementIds = [];
        state.notificationsEnabled = true;
        stopMetricsTimer();
        teardownNotificationCenter();
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
                        refreshAnnouncementBanner();
                        initNotificationCenter();
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

    async function enforceCurrentRelease() {
        let previousRelease = '';
        let alreadyReloadedThisSession = false;
        const hasServiceWorkerControl = !!(
            typeof navigator !== 'undefined' &&
            navigator.serviceWorker &&
            navigator.serviceWorker.controller
        );

        try {
            alreadyReloadedThisSession = window.sessionStorage.getItem(APP_RELEASE_RELOAD_SESSION_KEY) === '1';
        } catch (_error) {
            alreadyReloadedThisSession = false;
        }

        try {
            previousRelease = window.localStorage.getItem(APP_RELEASE_STORAGE_KEY) || '';
            window.localStorage.setItem(APP_RELEASE_STORAGE_KEY, APP_RELEASE_ID);
        } catch (_error) {
            previousRelease = '';
        }

        const releaseChanged = previousRelease !== APP_RELEASE_ID;
        if (!releaseChanged) {
            return false;
        }

        try {
            if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                await Promise.all(registrations.map(async (registration) => {
                    try {
                        if (registration.waiting) {
                            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                        }
                        if (typeof registration.update === 'function') {
                            await registration.update();
                        }
                    } catch (_error) {
                        // Keep best-effort cache eviction resilient.
                    }
                }));
            }
        } catch (_error) {
            // Ignore release cleanup update failures.
        }

        try {
            if ('caches' in window) {
                const cacheKeys = await window.caches.keys();
                await Promise.all(
                    cacheKeys
                        .filter((key) => String(key || '').startsWith(SOCRATES_CACHE_PREFIX))
                        .map((key) => window.caches.delete(key))
                );
            }
        } catch (_error) {
            // Ignore cache cleanup failures and continue with reload path.
        }

        const shouldReload = !alreadyReloadedThisSession && (Boolean(previousRelease) || hasServiceWorkerControl);
        if (!shouldReload) {
            return false;
        }

        try {
            window.sessionStorage.setItem(APP_RELEASE_RELOAD_SESSION_KEY, '1');
        } catch (_error) {
            // Session storage can fail in restricted browsing modes; reload anyway.
        }

        window.location.reload();
        return true;
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

            navigator.serviceWorker.register(`/sw.js?v=${SERVICE_WORKER_VERSION}`, {
                updateViaCache: 'none'
            }).then((registration) => {
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
        const ENABLE_DESKTOP_IN_APP_INSTALL_CTA = true;
        const ENABLE_ANDROID_IN_APP_INSTALL_CTA = true;
        const ENABLE_IOS_IN_APP_INSTALL_CTA = false;
        let deferredInstallPrompt = null;
        let fallbackTimer = null;
        let hasInstalledRelatedApp = false;
        let hasCheckedInstalledRelatedApps = false;

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
        const getPromptSurface = () => (isMobileInstallFlow() ? 'mobile' : 'desktop');
        const isInAppInstallEnabled = (surface = getPromptSurface()) => {
            if (surface === 'desktop') return ENABLE_DESKTOP_IN_APP_INSTALL_CTA;
            if (isAndroid()) return ENABLE_ANDROID_IN_APP_INSTALL_CTA;
            if (isIOS()) return ENABLE_IOS_IN_APP_INSTALL_CTA;
            return false;
        };

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

        const shouldSuppressPrompts = (surface = getPromptSurface()) => {
            if (isStandalone()) return true;
            if (surface === 'mobile' && isIOS() && hasRecentInstalledSeen()) return true;
            if (surface === 'mobile' && isAndroid() && hasCheckedInstalledRelatedApps && hasInstalledRelatedApp) return true;
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

        const showButton = (label, onClick, surface = getPromptSurface()) => {
            if (!isInAppInstallEnabled(surface)) return;
            if (shouldSuppressPrompts(surface)) return;
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
            if (!ENABLE_IOS_IN_APP_INSTALL_CTA) return;
            if (!isIOS()) return;
            if (shouldSuppressPrompts('mobile')) return;
            clearFallbackTimer();

            fallbackTimer = setTimeout(() => {
                if (deferredInstallPrompt) return;
                if (shouldSuppressPrompts('mobile')) return;
                showButton('Install App', showManualInstallHelp, 'mobile');
            }, 5000);
        };

        const detectInstalledRelatedApps = async () => {
            if (typeof navigator.getInstalledRelatedApps !== 'function') return;
            try {
                const relatedApps = await navigator.getInstalledRelatedApps();
                hasCheckedInstalledRelatedApps = true;
                hasInstalledRelatedApp = Array.isArray(relatedApps) && relatedApps.some((app) => app && app.platform === 'webapp');
                if (hasInstalledRelatedApp) {
                    markInstalledSeen();
                    clearStoredValue(PROMPT_DISMISS_UNTIL_KEY);
                    deferredInstallPrompt = null;
                    clearFallbackTimer();
                    hideButton();
                } else if (isAndroid() && !isStandalone()) {
                    // On Android, if the related PWA is no longer installed, clear stale state
                    // so the user can be offered reinstall again immediately.
                    clearStoredValue(INSTALLED_SEEN_AT_KEY);
                    clearStoredValue(PROMPT_DISMISS_UNTIL_KEY);
                }
            } catch (_err) {
                // Best-effort detection only.
            }
        };

        if (isStandalone()) {
            markInstalledSeen();
            clearStoredValue(PROMPT_DISMISS_UNTIL_KEY);
        } else if (isIOS() && isCrossHostMigrationLaunch()) {
            // If a launch crossed known app hosts (www/apex/firebase hosts), treat it as
            // an existing app install context migration and suppress install nags.
            markInstalledSeen();
            suppressPromptsFor();
        }

        window.addEventListener('beforeinstallprompt', (event) => {
            const promptSurface = getPromptSurface();
            if (isLocalhost()) {
                deferredInstallPrompt = null;
                hideButton();
                return;
            }
            if (!isInAppInstallEnabled(promptSurface)) {
                if (promptSurface === 'mobile') {
                    event.preventDefault();
                }
                deferredInstallPrompt = null;
                hideButton();
                return;
            }
            if (promptSurface === 'mobile' && isAndroid()) {
                hasCheckedInstalledRelatedApps = true;
                hasInstalledRelatedApp = false;
                clearStoredValue(INSTALLED_SEEN_AT_KEY);
            }
            event.preventDefault();
            if (shouldSuppressPrompts(promptSurface)) {
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
            }, promptSurface);
        });

        scheduleFallbackPrompt();
        detectInstalledRelatedApps();

        window.addEventListener('appinstalled', () => {
            deferredInstallPrompt = null;
            hasCheckedInstalledRelatedApps = true;
            hasInstalledRelatedApp = true;
            markInstalledSeen();
            clearStoredValue(PROMPT_DISMISS_UNTIL_KEY);
            clearFallbackTimer();
            hideButton();
        });
    }
    function initPwaSupport() {
        ensurePwaHeadTags();
        enforceCurrentRelease()
            .then((reloaded) => {
                if (reloaded) return;
                registerServiceWorker();
                initInstallPrompt();
            })
            .catch(() => {
                registerServiceWorker();
                initInstallPrompt();
            });
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
        initNotificationCenter();
        // Re-apply identity and admin link visibility in case auth state arrived
        // before DOM was ready on navigation.
        updateUserIdentity(state.user);
    });

    window.AppShell = {
        init,
        onReady,
        onSignOut,
        authFetch,
        refreshAnnouncement: refreshAnnouncementBanner,
        showAnnouncement: renderAnnouncementBanner,
        hideAnnouncement: clearAnnouncementBanner,
        signOut,
        refreshNotifications: () => refreshNotifications({ includeItems: state.notificationPanelOpen, resetCursor: true, silent: true }),
        getUser: () => state.user,
        getApiClient: () => window.apiClient || null
    };
})(window, document);
