/* global safeRedirect, showMessage */
/**
 * TourEngine — guided spotlight tour for inverter-automation
 *
 * Public API
 *   TourEngine.init(apiClient)   – call once in every page's onReady
 *   TourEngine.start(stepIndex)  – launch (or relaunch) tour from step N
 *   TourEngine.resume()          – called by each page; resumes if a step is pending
 */
(function (window) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /*  State                                                               */
  /* ------------------------------------------------------------------ */
  var _apiClient = null;
  var _overlay   = null;
  var _tooltip   = null;
  var _active    = false;
  var _currentStep = 0;

  /* ------------------------------------------------------------------ */
  /*  Step definitions                                                    */
  /* ------------------------------------------------------------------ */
  var STEPS = [
    /* 0 — Welcome splash */
    {
      page: '/index.html',
      selector: null,
      position: 'center',
      title: 'Welcome to FoxESS Automation 👋',
      body: 'This 2-minute tour covers every feature of the app — live prices, weather, automation rules, manual controls, savings tracking and more. You can skip or relaunch it anytime from the Help menu.'
    },

    /* 1 — Live prices */
    {
      page: '/index.html',
      selector: '#amberCard',
      position: 'bottom',
      title: '⚡ Live Electricity Prices',
      body: 'Amber Electric buy and feed-in prices refresh every 60 seconds. Price forecast tiles show the next few hours so rules can react before a spike or cheap window arrives.'
    },

    /* 2 — Weather forecast */
    {
      page: '/index.html',
      selector: '#weatherCard',
      position: 'bottom',
      title: '🌤 Solar & Weather Forecast',
      body: 'Live shortwave radiation, cloud cover, temperature and multi-day forecast. Automation rules can condition on radiation level or cloud percentage — e.g. only charge when solar is abundant.'
    },

    /* 3 — Battery status */
    {
      page: '/index.html',
      selector: '.battery-tile',
      position: 'bottom',
      title: '🔋 Battery & Inverter Status',
      body: 'Real-time state of charge (%), power flows, inverter mode and temperatures. The battery fill and colour reflect your SoC at a glance. Data refreshes every 5 minutes from FoxESS.'
    },

    /* 4 — Automation panel + master toggle */
    {
      page: '/index.html',
      selector: '#backendAutomationStatus',
      position: 'right',
      title: '🤖 Automation Engine',
      body: 'Use the Master toggle to enable or disable automation. When on, the engine evaluates your rules every 60 seconds and applies the first one whose conditions are met.',
      beforeShow: function () {
        /* Expand the automation side-panel before highlighting its contents */
        try {
          if (typeof window.toggleAutomationPanel === 'function') {
            window.toggleAutomationPanel(false);   /* false = expand */
          }
        } catch (e) { /* ignore */ }
      }
    },

    /* 5 — Rules list */
    {
      page: '/index.html',
      selector: '#backendAutomationStatus',
      position: 'right',
      title: '📋 Automation Rules',
      body: 'Rules are sorted by priority (1 = highest). Each rule has conditions (price, SoC, time, weather) and an action (ForceCharge, Discharge, SelfUse, Backup). Only the first matching rule fires per cycle.'
    },

    /* 6 — Quick control */
    {
      page: '/index.html',
      selector: '#quickControlForm',
      position: 'top',
      title: '🕹️ Quick Manual Control',
      body: 'Override the inverter for a fixed time without disabling automation. Set a mode (charge/discharge), power level (0–10 kW) and duration (2–360 min). The inverter restores automatically when the timer expires.'
    },

    /* 7 — Dashboard customisation */
    {
      page: '/index.html',
      selector: '.dashboard-visibility-card',
      position: 'bottom',
      title: '\uD83E\uDDE9 Customize Your Dashboard',
      body: 'Use the Customize Dashboard panel to show or hide any card — Inverter, Prices, Weather, Quick Controls, or Scheduler. Tick the ones you want and they\u2019ll persist across sessions so you only see what matters to you.',
      beforeShow: function () {
        try {
          var btn = document.getElementById('dashboardVisibilityToggleBtn');
          if (btn && btn.getAttribute('aria-expanded') !== 'true') {
            btn.click();
          }
        } catch (e) { /* ignore */ }
      }
    },

    /* 8 — Manual Scheduler (Time Segments) */
    {
      page: '/index.html',
      selector: '[data-dashboard-card="scheduler"]',
      position: 'top',
      title: '\uD83D\uDCC5 Manual Scheduler (Time Segments)',
      body: 'Program up to 8 time-based segments directly on the inverter — each with its own work mode (Self Use, Force Charge, Discharge, Feed In), start/end time, power and SoC targets. Use this for deterministic control independent of automation rules.',
      beforeShow: function () {
        try {
          var card = document.querySelector('[data-dashboard-card="scheduler"]');
          if (card && card.classList.contains('is-hidden-preference')) {
            card.classList.remove('is-hidden-preference');
            card.style.display = '';
          }
          if (typeof window.loadSchedulerSegments === 'function') {
            setTimeout(function () { window.loadSchedulerSegments(); }, 350);
          }
        } catch (e) { /* ignore */ }
      }
    },

    /* 9 — Work mode control */
    {
      page: '/control.html',
      selector: '#form-workMode',
      position: 'right',
      title: '🔧 Inverter Work Mode',
      body: 'Directly set the inverter work mode: SelfUse, ForceCharge, ForceDischarge or Backup. Changes take effect immediately and persist until another rule or manual action overrides them.'
    },

    /* 10 — Time-based charge schedule */
    {
      page: '/control.html',
      selector: '#form-forceCharge',
      position: 'right',
      title: '⏰ Time-Based Charge Windows',
      body: 'Configure up to 2 time windows for force-charging — useful for off-peak tariffs. The scheduler segments are sent directly to the inverter and work independently of the automation rules.'
    },

    /* 11 — Battery SoC settings */
    {
      page: '/control.html',
      selector: '#form-batterySoc',
      position: 'right',
      title: '🔋 Min SoC Settings',
      body: 'Set the minimum state-of-charge the inverter must maintain. "Min SoC on Grid" is the threshold while grid-connected; the inverter will not discharge below this level.'
    },

    /* 12 — Credentials */
    {
      page: '/settings.html',
      selector: '#credentials_deviceSn',
      position: 'bottom',
      title: '🔑 API Credentials',
      body: 'Your FoxESS device serial, API token and Amber Electric key live here. Update them at any time — keys are stored securely in Firestore and never exposed client-side.'
    },

    /* 13 — Blackout windows */
    {
      page: '/settings.html',
      selector: '#blackoutWindowsList',
      position: 'top',
      title: '🚫 Blackout Windows',
      body: 'Blackout windows pause the automation engine on specific days and times — e.g. every weekday morning to avoid discharging during your commute. Automation resumes automatically after the window ends.'
    },

    /* 14 — Solar Curtailment */
    {
      page: '/settings.html',
      selector: '#curtailment_enabled',
      position: 'right',
      title: '\u2600\uFE0F Solar Curtailment',
      body: 'Solar curtailment automatically limits your inverter\u2019s grid export when the Amber feed-in price drops below your chosen threshold — protecting against zero or negative feed-in rates. Toggle it on and set the price threshold to activate it.'
    },

    /* 15 — Automation lab inputs */
    {
      page: '/test.html',
      selector: '#simFeedIn',
      position: 'right',
      title: '🧪 Simulated Conditions',
      body: 'The Automation Lab lets you test what your rules would do given any hypothetical price, SoC, time or weather. No commands are sent to the inverter — it\'s a completely safe sandbox.'
    },

    /* 16 — Run test button */
    {
      page: '/test.html',
      selector: '[onclick="runTest()"]',
      position: 'top',
      title: '🚀 Run the Simulation',
      body: 'Click "Run Automation Test" to see which rule (if any) would fire given the conditions above. The result shows which conditions matched, the action that would be taken, and why other rules were skipped.'
    },

    /* 17 — History / reports */
    {
      page: '/history.html',
      selector: '#btnFetchHistory',
      position: 'top',
      title: '\uD83D\uDCCA Energy History & Reports',
      body: 'The History page lets you fetch inverter time-series data (up to 7 days), view aggregated energy reports by month or year, and browse historical Amber prices. All data is loaded on-demand to preserve your API quota.'
    },

    /* 18 — ROI */
    {
      page: '/roi.html',
      selector: '#btnCalculateROI',
      position: 'bottom',
      title: '💰 ROI & Savings',
      body: 'Track the financial value of your automation. The ROI calculator estimates grid import savings, feed-in revenue gains and avoided peak costs over a date range you choose.'
    },

    /* 19 — Light / Dark theme */
    {
      page: '/index.html',
      selector: null,
      position: 'center',
      title: '🎨 Light & Dark Themes',
      body: 'The app defaults to a dark theme — easy on the eyes at night. Want a brighter look? Click your avatar in the top-right corner and choose ☀️ Light Theme.'
    },

    /* 20 — Outro splash */
    {
      page: '/index.html',
      selector: null,
      position: 'center',
      title: "You're all set! 🎉",
      body: 'You\'ve seen everything the app can do. Explore the docs for deeper dives, and use the Help menu (your avatar → ❓ Take a Tour) to relaunch this tour at any time.'
    }
  ];

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                             */
  /* ------------------------------------------------------------------ */

  /** Current page path normalised to /index.html at root */
  function currentPage() {
    var p = window.location.pathname.replace(/\/$/, '') || '/index.html';
    if (p === '' || p === '/') return '/index.html';
    return p;
  }

  /** Return true if the current page matches the step's target page */
  function onStepPage(step) {
    var cp = currentPage();
    var sp = step.page;
    return cp === sp || cp.endsWith(sp) ||
      (sp === '/index.html' && (cp === '/' || cp === ''));
  }

  /** Total visible steps (none have a skipIf in this build — kept for future use) */
  function totalVisible() {
    return STEPS.filter(function (s) {
      return !s.skipIf || !s.skipIf();
    }).length;
  }

  /** Index among visible steps (for the N/Total badge) */
  function visibleIndex(rawIndex) {
    var count = 0;
    for (var i = 0; i <= rawIndex && i < STEPS.length; i++) {
      if (!STEPS[i].skipIf || !STEPS[i].skipIf()) count++;
    }
    return count;
  }

  /* ------------------------------------------------------------------ */
  /*  Core render                                                         */
  /* ------------------------------------------------------------------ */

  function renderStep(index) {
    if (index < 0 || index >= STEPS.length) {
      complete();
      return;
    }

    var step = STEPS[index];

    /* skip if predicate */
    if (step.skipIf && step.skipIf()) {
      _currentStep = index + 1;
      renderStep(_currentStep);
      return;
    }

    /* redirect if on wrong page */
    if (!onStepPage(step)) {
      try { sessionStorage.setItem('tourStep', String(index)); } catch (e) {}
      try {
        if (typeof safeRedirect === 'function') {
          safeRedirect(step.page);
        } else {
          window.location.href = step.page;
        }
      } catch (e) { window.location.href = step.page; }
      return;
    }

    _currentStep = index;
    _active = true;

    /* CRITICAL: unlock scroll first so scrollIntoView actually works.
       On step-to-step transitions the body is already position:fixed from
       the previous step — scrollIntoView silently no-ops on a fixed body. */
    unlockBodyScroll();

    /* beforeShow hook (e.g. expand automation panel) */
    if (typeof step.beforeShow === 'function') {
      try { step.beforeShow(); } catch (e) { /* ignore */ }
    }

    /* Initial scroll so element is roughly in view before we lock. Skip for
       position:fixed elements (automation panel on mobile) since scrollIntoView
       on fixed elements is a no-op anyway. */
    var preScrollTarget = step.selector ? document.querySelector(step.selector) : null;
    if (preScrollTarget) {
      var cs = window.getComputedStyle(preScrollTarget);
      var isFixed = (cs.position === 'fixed');
      /* walk up to find if any ancestor is fixed (e.g. element inside fixed panel) */
      if (!isFixed) {
        var anc = preScrollTarget.parentElement;
        while (anc && anc !== document.body) {
          if (window.getComputedStyle(anc).position === 'fixed') { isFixed = true; break; }
          anc = anc.parentElement;
        }
      }
      if (!isFixed) {
        preScrollTarget.scrollIntoView({ behavior: 'instant', block: 'center' });
      }
    }

    /* Wait for beforeShow DOM mutations to settle, then lock + re-scroll + show */
    var settleMs = step.beforeShow ? 420 : 100;
    setTimeout(function () {
      /* Second scroll pass — catches layout shifts caused by beforeShow */
      if (preScrollTarget) {
        var cs2 = window.getComputedStyle(preScrollTarget);
        var isFixed2 = (cs2.position === 'fixed');
        if (!isFixed2) {
          var anc2 = preScrollTarget.parentElement;
          while (anc2 && anc2 !== document.body) {
            if (window.getComputedStyle(anc2).position === 'fixed') { isFixed2 = true; break; }
            anc2 = anc2.parentElement;
          }
        }
        if (!isFixed2) {
          preScrollTarget.scrollIntoView({ behavior: 'instant', block: 'center' });
        }
      }
      showOverlay();
      setTimeout(function () { showTooltip(step, index); }, 60);
    }, settleMs);
  }

  /* ------------------------------------------------------------------ */
  /*  Overlay                                                             */
  /* ------------------------------------------------------------------ */

  // iOS Safari scroll-lock helpers
  // Fixed positioning breaks during momentum scroll on iOS unless body is locked.
  var _savedScrollY    = 0;
  var _bodyScrollLocked = false;

  function lockBodyScroll() {
    if (_bodyScrollLocked) return;
    _savedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.overflow  = 'hidden';
    document.body.style.position  = 'fixed';
    document.body.style.top       = '-' + _savedScrollY + 'px';
    document.body.style.width     = '100%';
    _bodyScrollLocked = true;
  }

  function unlockBodyScroll() {
    if (!_bodyScrollLocked) return;
    document.body.style.overflow  = '';
    document.body.style.position  = '';
    document.body.style.top       = '';
    document.body.style.width     = '';
    window.scrollTo(0, _savedScrollY);
    _bodyScrollLocked = false;
  }

  function showOverlay() {
    lockBodyScroll();
    if (!_overlay) {
      _overlay = document.createElement('div');
      _overlay.className = 'tour-overlay';
      document.body.appendChild(_overlay);
    }
    /* Clicking the overlay dismisses the current step without ending the tour */
    _overlay.onclick = function () { /* no-op — let users use buttons */ };
    _overlay.style.display = 'block';
  }

  /* ------------------------------------------------------------------ */
  /*  Tooltip                                                             */
  /* ------------------------------------------------------------------ */

  function showTooltip(step, index) {
    /* remove previous tooltip & highlights */
    cleanTooltip();

    var targetEl = step.selector ? document.querySelector(step.selector) : null;
    var pos = step.position || (targetEl ? 'bottom' : 'center');
    var total = totalVisible();
    var vIdx  = visibleIndex(index);

    /* build progress dots */
    var dots = '';
    for (var d = 0; d < STEPS.length; d++) {
      var cls = 'tour-dot';
      if (d < index) cls += ' done';
      else if (d === index) cls += ' active';
      dots += '<span class="' + cls + '"></span>';
    }

    /* build button row */
    var prevBtn = index > 0
      ? '<button class="tour-btn tour-btn-secondary" id="_tourPrev">← Back</button>'
      : '';
    var isLast = (index === STEPS.length - 1);
    var nextBtn = isLast
      ? '<button class="tour-btn tour-btn-primary" id="_tourFinish">Finish ✓</button>'
      : '<button class="tour-btn tour-btn-primary" id="_tourNext">Next →</button>';

    _tooltip = document.createElement('div');
    _tooltip.className = 'tour-tooltip';
    _tooltip.innerHTML =
      '<div class="tour-step-badge">Step ' + vIdx + ' of ' + total + '</div>' +
      '<div class="tour-progress">' + dots + '</div>' +
      '<h3 class="tour-title">' + step.title + '</h3>' +
      '<p class="tour-body">' + step.body + '</p>' +
      '<div class="tour-actions">' +
        prevBtn +
        '<button class="tour-btn tour-btn-ghost" id="_tourSkip">Skip tour</button>' +
        nextBtn +
      '</div>';

    document.body.appendChild(_tooltip);

    /* highlight target & position tooltip.
       No scrollIntoView here — renderStep already scrolled before locking body. */
    if (targetEl) {
      targetEl.classList.add('tour-highlight');
      /* rAF + small timeout ensures layout is fully composited on mobile */
      requestAnimationFrame(function () {
        setTimeout(function () { positionTooltip(targetEl, pos); }, 60);
      });
    } else {
      centerTooltip();
    }

    /* wire buttons */
    var el;
    el = document.getElementById('_tourPrev');
    if (el) el.addEventListener('click', function () { renderStep(_currentStep - 1); });
    el = document.getElementById('_tourNext');
    if (el) el.addEventListener('click', function () { renderStep(_currentStep + 1); });
    el = document.getElementById('_tourFinish');
    if (el) el.addEventListener('click', function () { complete(); });
    el = document.getElementById('_tourSkip');
    if (el) el.addEventListener('click', function () { dismiss(); });
  }

  /* ------------------------------------------------------------------ */
  /*  Positioning                                                         */
  /* ------------------------------------------------------------------ */

  function positionTooltip(targetEl, position) {
    var rect   = targetEl.getBoundingClientRect();
    var tt     = _tooltip;
    var margin = 12;
    var vpW    = window.innerWidth;
    var vpH    = window.innerHeight;
    var isMobile = vpW < 600;

    /* force layout pass so we can read tooltip dimensions */
    tt.style.visibility = 'hidden';
    tt.style.top  = '0px';
    tt.style.left = '0px';
    var ttW = tt.offsetWidth  || 320;
    var ttH = tt.offsetHeight || 200;
    tt.style.visibility = '';

    /* On mobile, left/right rarely fit — fall back to bottom/top first.
       Also honour per-step mobilePosition override (e.g. steps inside fixed panels). */
    if (isMobile) {
      var stepMobilePos = STEPS[_currentStep] && STEPS[_currentStep].mobilePosition;
      if (stepMobilePos) {
        position = stepMobilePos;
        if (position === 'center') { centerTooltip(); return; }
      } else if (position === 'right' || position === 'left') {
        position = 'bottom';
      }
    }

    var top, left;

    /* auto-flip if preferred position doesn't fit */
    if (position === 'bottom' && rect.bottom + ttH + margin > vpH) position = 'top';
    if (position === 'top'    && rect.top  - ttH - margin < 0)     position = 'bottom';
    if (position === 'right'  && rect.right + ttW + margin > vpW)  position = 'left';
    if (position === 'left'   && rect.left  - ttW - margin < 0)    position = 'right';
    /* last resort: if still off-screen vertically on mobile, center it */
    if (isMobile && position === 'top' && rect.top - ttH - margin < 0) position = 'center';
    if (position === 'center') { centerTooltip(); return; }

    switch (position) {
      case 'top':
        top  = rect.top  - ttH - margin;
        left = rect.left + rect.width  / 2 - ttW / 2;
        break;
      case 'left':
        top  = rect.top  + rect.height / 2 - ttH / 2;
        left = rect.left - ttW - margin;
        break;
      case 'right':
        top  = rect.top  + rect.height / 2 - ttH / 2;
        left = rect.right + margin;
        break;
      default: /* bottom */
        top  = rect.bottom + margin;
        left = rect.left + rect.width  / 2 - ttW / 2;
    }

    /* clamp to viewport */
    top  = Math.max(margin, Math.min(vpH - ttH - margin, top));
    left = Math.max(margin, Math.min(vpW - ttW - margin, left));

    tt.style.top  = top  + 'px';
    tt.style.left = left + 'px';
    tt.classList.add('tour-tooltip--' + position);
  }

  function centerTooltip() {
    _tooltip.style.top       = '50%';
    _tooltip.style.left      = '50%';
    _tooltip.style.transform = 'translate(-50%, -50%)';
    _tooltip.classList.add('tour-tooltip--center');
  }

  /* ------------------------------------------------------------------ */
  /*  Cleanup helpers                                                     */
  /* ------------------------------------------------------------------ */

  function cleanTooltip() {
    if (_tooltip) {
      try { _tooltip.remove(); } catch (e) {}
      _tooltip = null;
    }
    document.querySelectorAll('.tour-highlight').forEach(function (el) {
      el.classList.remove('tour-highlight');
    });
  }

  function cleanAll() {
    cleanTooltip();
    if (_overlay) {
      try { _overlay.remove(); } catch (e) {}
      _overlay = null;
    }
    unlockBodyScroll();
    _active = false;
    try { sessionStorage.removeItem('tourStep');      } catch (e) {}
    try { sessionStorage.removeItem('tourAutoLaunch'); } catch (e) {}
  }

  /* ------------------------------------------------------------------ */
  /*  Completion / dismissal                                              */
  /* ------------------------------------------------------------------ */

  function complete() {
    cleanAll();
    /* persist tourComplete flag to Firestore via API */
    if (_apiClient) {
      try {
        _apiClient.fetch('/api/config/tour-status', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ tourComplete: true, tourCompletedAt: Date.now() })
        }).catch(function (err) {
          console.warn('[Tour] Failed to persist tour status:', err);
        });
      } catch (e) { /* ignore */ }
    }
    /* show toast if available */
    try {
      if (typeof showMessage === 'function') {
        showMessage('success', '🎉 Tour complete! Find it again under your avatar → ❓ Take a Tour.');
      }
    } catch (e) { /* ignore */ }
  }

  function dismiss() {
    cleanAll();
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * init(apiClient)
   * Must be called in each page's onReady so _apiClient is available
   * for auth-aware API calls (e.g. persisting tour completion).
   */
  function init(apiClient) {
    _apiClient = apiClient || window.apiClient || null;
  }

  /**
   * start(stepIndex)
   * Launches the tour from the given step (default 0).
   * Always works regardless of previous completion — supports relaunch.
   */
  function start(stepIndex) {
    var idx = (typeof stepIndex === 'number' && stepIndex >= 0) ? stepIndex : 0;
    renderStep(idx);
  }

  /**
   * resume()
   * Called by every tour-enabled page in onReady.
   * - If a pending cross-page step is in sessionStorage → resumes immediately.
   * - If tourAutoLaunch flag is set AND tour not yet completed → auto-starts.
   * - Otherwise no-op.
   */
  function resume() {
    /* 1. Cross-page resume */
    var pending = null;
    try { pending = sessionStorage.getItem('tourStep'); } catch (e) {}
    if (pending !== null) {
      var idx = parseInt(pending, 10);
      try { sessionStorage.removeItem('tourStep'); } catch (e) {}
      if (!isNaN(idx)) {
        renderStep(idx);
        return;
      }
    }

    /* 2. Auto-launch after first-time setup */
    var autoLaunch = false;
    try { autoLaunch = sessionStorage.getItem('tourAutoLaunch') === '1'; } catch (e) {}
    if (!autoLaunch) return;

    try { sessionStorage.removeItem('tourAutoLaunch'); } catch (e) {}

    /* User just completed setup — skip the tour-status API check and start immediately.
       They cannot have completed the tour yet, and any API round-trip here risks a
       timing failure (token refresh not ready, network lag) that silently drops the tour. */
    start(0);
  }

  /* ------------------------------------------------------------------ */
  /*  Export                                                              */
  /* ------------------------------------------------------------------ */
  window.TourEngine = { init: init, start: start, resume: resume };

}(window));
