'use strict';

function createStructuredLogger(options = {}) {
  const service = String(options.service || 'automation-api').trim() || 'automation-api';
  const debugEnabled = options.debugEnabled === true;
  const verboseEnabled = options.verboseEnabled === true;
  const storage = options.storage || null;
  const consoleImpl = options.consoleImpl || console;

  const getSink = (severity) => {
    if (severity === 'ERROR' && typeof consoleImpl.error === 'function') return consoleImpl.error.bind(consoleImpl);
    if (severity === 'WARN' && typeof consoleImpl.warn === 'function') return consoleImpl.warn.bind(consoleImpl);
    return typeof consoleImpl.log === 'function' ? consoleImpl.log.bind(consoleImpl) : console.log.bind(console);
  };

  const normalizeArgs = (args = []) => {
    const values = Array.from(args);
    let onlyIfVerbose = false;
    if (typeof values[values.length - 1] === 'boolean') {
      onlyIfVerbose = values.pop() === true;
    }

    let tag = null;
    let message = '';
    let meta = null;

    if (values.length >= 2 && typeof values[0] === 'string' && typeof values[1] === 'string') {
      tag = values[0];
      message = values[1];
      meta = values[2] && typeof values[2] === 'object' ? values[2] : null;
    } else if (values.length >= 1 && typeof values[0] === 'string') {
      message = values[0];
      meta = values[1] && typeof values[1] === 'object' ? values[1] : null;
    } else if (values[0] && typeof values[0] === 'object') {
      const payload = values[0];
      message = payload.message || '';
      tag = payload.tag || null;
      meta = payload.meta && typeof payload.meta === 'object'
        ? payload.meta
        : Object.fromEntries(Object.entries(payload).filter(([key]) => !['message', 'tag', 'meta'].includes(key)));
    }

    return {
      onlyIfVerbose,
      tag,
      message: String(message || ''),
      meta: meta && typeof meta === 'object' ? meta : null
    };
  };

  const emit = (severity, args = []) => {
    const normalized = normalizeArgs(args);
    if (normalized.onlyIfVerbose && !verboseEnabled) {
      return;
    }

    const context = storage && typeof storage.getStore === 'function'
      ? storage.getStore() || {}
      : {};
    const payload = {
      severity,
      service,
      message: normalized.message,
      tag: normalized.tag,
      requestId: context.requestId || null,
      path: context.path || null,
      method: context.method || null,
      ...((normalized.meta && typeof normalized.meta === 'object') ? normalized.meta : {})
    };

    getSink(severity)(JSON.stringify(payload));
  };

  return {
    error: (...args) => emit('ERROR', args),
    warn: (...args) => emit('WARN', args),
    info: (...args) => emit('INFO', args),
    debug: (...args) => {
      if (!debugEnabled) return;
      emit('DEBUG', args);
    }
  };
}

module.exports = {
  createStructuredLogger
};