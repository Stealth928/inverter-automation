/**
 * app-analytics.js
 * Tracks user product engagement events from the frontend.
 * Events are captured from data-analytics-event attributes on HTML elements.
 */

const ANALYTICS_RETRY_DELAY_MS = 100;
const ANALYTICS_MAX_RETRIES = 50;

let analyticsInitialized = false;
let analyticsRetryCount = 0;

function getFirebaseAppRef() {
  if (typeof firebase === 'undefined') {
    return null;
  }

  if (Array.isArray(firebase.apps) && firebase.apps.length > 0) {
    return firebase.apps[0];
  }

  if (typeof firebase.app === 'function') {
    try {
      return firebase.app();
    } catch (error) {
      return null;
    }
  }

  return null;
}

function scheduleAnalyticsRetry(reason) {
  if (analyticsInitialized) {
    return;
  }

  if (analyticsRetryCount >= ANALYTICS_MAX_RETRIES) {
    console.warn('[Analytics] Initialization skipped after waiting for Firebase app:', reason);
    return;
  }

  analyticsRetryCount += 1;
  setTimeout(initializeAnalytics, ANALYTICS_RETRY_DELAY_MS);
}

// Wait for Firebase SDK and default app to be ready.
function initializeAnalytics() {
  if (analyticsInitialized) {
    return;
  }

  if (typeof firebase === 'undefined' || typeof firebase.analytics !== 'function') {
    scheduleAnalyticsRetry('analytics SDK unavailable');
    return;
  }

  if (!getFirebaseAppRef()) {
    scheduleAnalyticsRetry('default app unavailable');
    return;
  }

  try {
    const analytics = firebase.analytics();
    analyticsInitialized = true;
    
    // Track clicks on elements with data-analytics-event attribute
    document.addEventListener('click', function(event) {
      const target = event.target.closest('[data-analytics-event]');
      if (!target) return;
      
      const eventName = target.getAttribute('data-analytics-event');
      const location = target.getAttribute('data-analytics-location');
      const label = target.getAttribute('data-analytics-label');
      
      if (!eventName) return;
      
      const eventData = {
        location: location || 'unknown'
      };
      
      if (label) {
        eventData.label = label;
      }
      
      try {
        analytics.logEvent(eventName, eventData);
      } catch (e) {
        console.debug('[Analytics] Event logged locally:', eventName, eventData);
      }
    }, true);
    
    console.log('[Analytics] Initialized');
  } catch (error) {
    const isMissingDefaultApp = typeof error.message === 'string'
      && error.message.includes("No Firebase App '[DEFAULT]' has been created");

    if (isMissingDefaultApp) {
      scheduleAnalyticsRetry('default app unavailable');
      return;
    }

    console.error('[Analytics] Initialization error:', error);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeAnalytics);
} else {
  initializeAnalytics();
}
