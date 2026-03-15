(function (window) {
    'use strict';

    var PREVIEW_SESSION_KEY = 'socratesPreviewSession';
    var SETUP_DRAFT_KEY = 'socratesSetupDraft';
    var LAST_REDIRECT_KEY = 'lastRedirect';

    function getStorage() {
        try {
            return window.sessionStorage;
        } catch (error) {
            return null;
        }
    }

    function normalizePath(path) {
        var candidate = String(path || '').replace(/\/$/, '') || '/app.html';
        return candidate === '/' ? '/app.html' : candidate;
    }

    function readJson(key) {
        var storage = getStorage();
        if (!storage) return null;
        try {
            var raw = storage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            return null;
        }
    }

    function writeJson(key, value) {
        var storage = getStorage();
        if (!storage) return false;
        try {
            storage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            return false;
        }
    }

    function readSession() {
        var session = readJson(PREVIEW_SESSION_KEY);
        if (!session || session.active !== true) return null;
        return {
            active: true,
            startedAt: Number(session.startedAt || Date.now()),
            source: String(session.source || 'setup'),
            scenario: String(session.scenario || 'solar-surplus'),
            allowedPaths: Array.isArray(session.allowedPaths) && session.allowedPaths.length
                ? session.allowedPaths.map(normalizePath)
                : ['/app.html']
        };
    }

    function writeSession(session) {
        return writeJson(PREVIEW_SESSION_KEY, {
            active: true,
            startedAt: Number(session.startedAt || Date.now()),
            source: String(session.source || 'setup'),
            scenario: String(session.scenario || 'solar-surplus'),
            allowedPaths: Array.isArray(session.allowedPaths) && session.allowedPaths.length
                ? session.allowedPaths.map(normalizePath)
                : ['/app.html']
        });
    }

    function captureSetupDraft(form) {
        if (!form || typeof form.querySelectorAll !== 'function') return {};
        var draft = {};
        form.querySelectorAll('input, select, textarea').forEach(function (field) {
            if (!field || !field.id) return;
            draft[field.id] = {
                type: String(field.type || field.tagName || '').toLowerCase(),
                value: field.value,
                checked: !!field.checked
            };
        });
        return draft;
    }

    function applySetupDraft(form) {
        if (!form || typeof form.querySelectorAll !== 'function') return false;
        var draft = readJson(SETUP_DRAFT_KEY);
        if (!draft || typeof draft !== 'object') return false;

        Object.keys(draft).forEach(function (fieldId) {
            var snapshot = draft[fieldId] || {};
            var field = form.querySelector('#' + fieldId);
            if (!field) return;
            var type = String(snapshot.type || '').toLowerCase();
            if (type === 'checkbox' || type === 'radio') {
                field.checked = !!snapshot.checked;
            } else if (typeof snapshot.value !== 'undefined') {
                field.value = snapshot.value;
            }
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
        });

        return true;
    }

    function clearJson(key) {
        var storage = getStorage();
        if (!storage) return;
        try {
            storage.removeItem(key);
        } catch (error) {
            /* ignore */
        }
    }

    function clearBounceRedirectState() {
        clearJson(LAST_REDIRECT_KEY);
    }

    var PreviewSession = {
        start: function start(options) {
            var session = {
                active: true,
                startedAt: Date.now(),
                source: options && options.source ? options.source : 'setup',
                scenario: options && options.scenario ? options.scenario : 'solar-surplus',
                allowedPaths: options && Array.isArray(options.allowedPaths) && options.allowedPaths.length
                    ? options.allowedPaths
                    : ['/app.html']
            };
            writeSession(session);
            return session;
        },
        get: function get() {
            return readSession();
        },
        isActive: function isActive() {
            return !!readSession();
        },
        clear: function clear() {
            clearJson(PREVIEW_SESSION_KEY);
        },
        isAllowedPath: function isAllowedPath(path) {
            var session = readSession();
            if (!session) return false;
            var normalized = normalizePath(path || (window.location && window.location.pathname));
            return session.allowedPaths.indexOf(normalized) !== -1;
        },
        getScenario: function getScenario() {
            var session = readSession();
            return session ? session.scenario : 'solar-surplus';
        },
        setScenario: function setScenario(scenario) {
            var session = readSession();
            if (!session) return null;
            session.scenario = String(scenario || 'solar-surplus');
            writeSession(session);
            return session.scenario;
        },
        saveSetupDraft: function saveSetupDraft(form) {
            return writeJson(SETUP_DRAFT_KEY, captureSetupDraft(form));
        },
        applySetupDraft: function restoreSetupDraft(form) {
            return applySetupDraft(form);
        },
        hasSetupDraft: function hasSetupDraft() {
            return !!readJson(SETUP_DRAFT_KEY);
        },
        clearSetupDraft: function clearSetupDraft() {
            clearJson(SETUP_DRAFT_KEY);
        },
        clearBounceRedirect: function clearBounceRedirect() {
            clearBounceRedirectState();
        },
        markTourAutoLaunch: function markTourAutoLaunch() {
            var storage = getStorage();
            if (!storage) return;
            try {
                storage.setItem('tourAutoLaunch', '1');
            } catch (error) {
                /* ignore */
            }
        },
        enterDashboardPreview: function enterDashboardPreview(options) {
            var session = PreviewSession.start({
                source: options && options.source ? options.source : 'setup',
                scenario: options && options.scenario ? options.scenario : 'solar-surplus',
                allowedPaths: options && Array.isArray(options.allowedPaths) && options.allowedPaths.length
                    ? options.allowedPaths
                    : ['/app.html']
            });
            clearBounceRedirectState();
            PreviewSession.markTourAutoLaunch();
            return session;
        }
    };

    window.PreviewSession = PreviewSession;
}(window));