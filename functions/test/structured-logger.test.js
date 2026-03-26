'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const { createStructuredLogger } = require('../lib/structured-logger');

describe('structured logger', () => {
  test('emits JSON logs with request context and tag/message pairs', () => {
    const storage = new AsyncLocalStorage();
    const log = jest.fn();
    const logger = createStructuredLogger({
      service: 'automation-api',
      storage,
      consoleImpl: { log, warn: log, error: log }
    });

    storage.run({ requestId: 'req-123', path: '/api/test', method: 'GET' }, () => {
      logger.info('Health', 'probe complete');
    });

    const payload = JSON.parse(log.mock.calls[0][0]);
    expect(payload).toEqual(expect.objectContaining({
      severity: 'INFO',
      service: 'automation-api',
      tag: 'Health',
      message: 'probe complete',
      requestId: 'req-123',
      path: '/api/test',
      method: 'GET'
    }));
  });

  test('supports single-string messages and verbose gating', () => {
    const log = jest.fn();
    const logger = createStructuredLogger({
      service: 'automation-api',
      verboseEnabled: false,
      consoleImpl: { log, warn: log, error: log }
    });

    logger.info('plain message', true);
    logger.warn('warning message');

    expect(log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(log.mock.calls[0][0]);
    expect(payload).toEqual(expect.objectContaining({
      severity: 'WARN',
      message: 'warning message'
    }));
  });
});