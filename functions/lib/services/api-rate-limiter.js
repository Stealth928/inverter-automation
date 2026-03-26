'use strict';

function createApiRateLimiter(options = {}) {
  const windowMs = Math.max(1000, Math.floor(Number(options.windowMs) || 60000));
  const max = Math.max(1, Math.floor(Number(options.max) || 100));
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const keyGenerator = typeof options.keyGenerator === 'function'
    ? options.keyGenerator
    : (req) => req.ip || 'anonymous';
  const skip = typeof options.skip === 'function' ? options.skip : () => false;
  const store = new Map();

  return function apiRateLimiter(req, res, next) {
    if (skip(req)) {
      next();
      return;
    }

    const currentNow = now();
    const key = String(keyGenerator(req) || 'anonymous');
    const current = store.get(key);
    const state = !current || current.resetAtMs <= currentNow
      ? { count: 0, resetAtMs: currentNow + windowMs }
      : current;

    state.count += 1;
    store.set(key, state);

    const remaining = Math.max(0, max - state.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(state.resetAtMs / 1000)));

    if (state.count > max) {
      res.status(429).json({ errno: 429, error: 'Too many requests' });
      return;
    }

    next();
  };
}

module.exports = {
  createApiRateLimiter
};