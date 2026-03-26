'use strict';

function createUpstreamCircuitBreaker(options = {}) {
  const name = String(options.name || 'upstream').trim() || 'upstream';
  const failureThreshold = Math.max(1, Math.floor(Number(options.failureThreshold) || 3));
  const openWindowMs = Math.max(1000, Math.floor(Number(options.openWindowMs) || 60000));
  let logger = options.logger || console;
  let state = 'closed';
  let consecutiveFailures = 0;
  let openedAtMs = 0;
  let retryAtMs = 0;
  let lastFailureAtMs = 0;
  let lastFailureMessage = null;
  let lastSuccessAtMs = 0;
  let halfOpenProbeInFlight = false;

  const warn = (message) => {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(message);
      return;
    }
    console.warn(message);
  };

  const info = (message) => {
    if (logger && typeof logger.info === 'function') {
      logger.info(message);
      return;
    }
    console.log(message);
  };

  const normalizeMessage = (errorLike) => {
    if (!errorLike) return 'Unknown upstream failure';
    if (typeof errorLike === 'string') return errorLike;
    if (typeof errorLike.message === 'string' && errorLike.message.trim()) return errorLike.message.trim();
    return String(errorLike);
  };

  const getState = (nowMs = Date.now()) => ({
    name,
    state,
    failureThreshold,
    consecutiveFailures,
    openWindowMs,
    openedAtMs: openedAtMs || null,
    retryAtMs: retryAtMs || null,
    retryAfterMs: retryAtMs > nowMs ? retryAtMs - nowMs : 0,
    lastFailureAtMs: lastFailureAtMs || null,
    lastFailureMessage,
    lastSuccessAtMs: lastSuccessAtMs || null,
    halfOpenProbeInFlight
  });

  const reset = (nowMs = Date.now()) => {
    state = 'closed';
    consecutiveFailures = 0;
    openedAtMs = 0;
    retryAtMs = 0;
    lastSuccessAtMs = nowMs;
    halfOpenProbeInFlight = false;
  };

  const beforeRequest = (nowMs = Date.now()) => {
    if (state === 'open') {
      if (retryAtMs > nowMs) {
        return {
          allowed: false,
          probe: false,
          state,
          retryAfterMs: retryAtMs - nowMs
        };
      }

      state = 'half-open';
      halfOpenProbeInFlight = false;
    }

    if (state === 'half-open') {
      if (halfOpenProbeInFlight) {
        return {
          allowed: false,
          probe: false,
          state,
          retryAfterMs: Math.max(0, retryAtMs - nowMs)
        };
      }

      halfOpenProbeInFlight = true;
      return {
        allowed: true,
        probe: true,
        state,
        retryAfterMs: 0
      };
    }

    return {
      allowed: true,
      probe: false,
      state,
      retryAfterMs: 0
    };
  };

  const recordSuccess = (nowMs = Date.now()) => {
    const wasOpen = state !== 'closed' || consecutiveFailures > 0;
    state = 'closed';
    consecutiveFailures = 0;
    openedAtMs = 0;
    retryAtMs = 0;
    lastSuccessAtMs = nowMs;
    halfOpenProbeInFlight = false;
    if (wasOpen) {
      info(`[CircuitBreaker:${name}] closed after recovery`);
    }
  };

  const recordFailure = (errorLike, nowMs = Date.now()) => {
    consecutiveFailures += 1;
    lastFailureAtMs = nowMs;
    lastFailureMessage = normalizeMessage(errorLike);
    halfOpenProbeInFlight = false;

    if (state === 'half-open' || consecutiveFailures >= failureThreshold) {
      state = 'open';
      openedAtMs = nowMs;
      retryAtMs = nowMs + openWindowMs;
      warn(
        `[CircuitBreaker:${name}] opened after ${consecutiveFailures} failure(s); retry after ${new Date(retryAtMs).toISOString()} (${lastFailureMessage})`
      );
      return;
    }

    state = 'closed';
  };

  return {
    beforeRequest,
    getState,
    recordFailure,
    recordSuccess,
    reset,
    setLogger(nextLogger) {
      logger = nextLogger || console;
    }
  };
}

module.exports = {
  createUpstreamCircuitBreaker
};