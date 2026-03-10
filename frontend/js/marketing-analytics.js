(function () {
  'use strict';

  var analyticsState = {
    enabled: false,
    measurementId: '',
    track: function () {}
  };

  function isLocalhost(hostname) {
    if (!hostname) return false;
    var host = String(hostname).toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  }

  function isValidMeasurementId(value) {
    return /^G-[A-Z0-9]+$/i.test(String(value || '').trim());
  }

  function resolveMeasurementId() {
    var overrideId = (typeof window !== 'undefined' && window.__SOCRATES_GA4_MEASUREMENT_ID)
      ? String(window.__SOCRATES_GA4_MEASUREMENT_ID).trim()
      : '';
    if (isValidMeasurementId(overrideId)) {
      return overrideId;
    }

    var firebaseId = (
      typeof window !== 'undefined' &&
      window.firebaseConfig &&
      window.firebaseConfig.measurementId
    )
      ? String(window.firebaseConfig.measurementId).trim()
      : '';

    return isValidMeasurementId(firebaseId) ? firebaseId : '';
  }

  function ensureGtagBootstrap(measurementId) {
    window.dataLayer = window.dataLayer || [];
    if (typeof window.gtag !== 'function') {
      window.gtag = function () {
        window.dataLayer.push(arguments);
      };
    }

    window.gtag('js', new Date());
    window.gtag('config', measurementId, {
      page_title: document.title,
      page_path: window.location.pathname + window.location.search
    });
  }

  function loadGtagScript(measurementId) {
    var existing = document.getElementById('socrates-ga4-loader');
    if (existing) return;

    var script = document.createElement('script');
    script.id = 'socrates-ga4-loader';
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(measurementId);
    document.head.appendChild(script);
  }

  function trackEvent(eventName, params) {
    if (!analyticsState.enabled || typeof window.gtag !== 'function' || !eventName) {
      return;
    }

    try {
      window.gtag('event', eventName, params || {});
    } catch (err) {
      // Never break page interactions because of analytics failures.
    }
  }

  function bindTrackedClicks() {
    document.addEventListener('click', function (event) {
      var origin = event.target;
      if (!(origin instanceof Element)) return;

      var trigger = origin.closest('[data-analytics-event]');
      if (!trigger) return;

      var eventName = String(trigger.getAttribute('data-analytics-event') || '').trim();
      if (!eventName) return;

      var location = String(trigger.getAttribute('data-analytics-location') || '').trim();
      var label = String(trigger.getAttribute('data-analytics-label') || trigger.textContent || '').trim();
      var href = String(trigger.getAttribute('href') || '').trim();

      trackEvent(eventName, {
        event_category: 'marketing',
        event_label: label,
        cta_location: location,
        link_url: href,
        page_path: window.location.pathname
      });
    }, true);
  }

  function init() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    var measurementId = resolveMeasurementId();
    var host = window.location && window.location.hostname ? window.location.hostname : '';
    var shouldEnable = isValidMeasurementId(measurementId) && !isLocalhost(host);

    analyticsState.enabled = shouldEnable;
    analyticsState.measurementId = measurementId;
    analyticsState.track = trackEvent;
    window.__socratesMarketingAnalytics = analyticsState;

    bindTrackedClicks();

    if (!shouldEnable) return;

    ensureGtagBootstrap(measurementId);
    loadGtagScript(measurementId);

    trackEvent('landing_page_view', {
      event_category: 'marketing',
      page_path: window.location.pathname
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
