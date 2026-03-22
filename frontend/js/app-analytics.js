/**
 * app-analytics.js
 * Tracks user product engagement events from the frontend.
 * Events are captured from data-analytics-event attributes on HTML elements.
 */

// Wait for Firebase to be ready
function initializeAnalytics() {
  if (typeof firebase === 'undefined' || !firebase.analytics) {
    console.warn('[Analytics] Firebase not yet initialized, retrying...');
    setTimeout(initializeAnalytics, 100);
    return;
  }

  try {
    const analytics = firebase.analytics();
    
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
    console.error('[Analytics] Initialization error:', error);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeAnalytics);
} else {
  initializeAnalytics();
}
