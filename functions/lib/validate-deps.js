'use strict';

/**
 * Validates that all required dependencies are present and of the expected type.
 * Used by route registration functions to eliminate the repeated if/throw boilerplate.
 *
 * @param {string} callerName - Name of the calling function (used in error messages)
 * @param {Object} deps - The deps object passed to the caller
 * @param {Array<{name: string, type: string}>} required - Array of { name, type } descriptors
 *
 * Supported types: 'function', 'object', 'string', 'app' (Express app duck-type check)
 *
 * @example
 * validateDeps('registerMyRoutes', deps, [
 *   { name: 'app',              type: 'app'      },
 *   { name: 'authenticateUser', type: 'function' },
 *   { name: 'db',               type: 'object'   },
 * ]);
 */
function validateDeps(callerName, deps, required) {
  for (const { name, type } of required) {
    const value = name === 'app' ? deps : deps[name];
    switch (type) {
      case 'app':
        if (!deps || typeof deps.get !== 'function' || typeof deps.post !== 'function') {
          throw new Error(`${callerName} requires an Express app`);
        }
        break;
      case 'function':
        if (typeof value !== 'function') {
          throw new Error(`${callerName} requires ${name}() to be a function`);
        }
        break;
      case 'object':
        if (!value || typeof value !== 'object') {
          throw new Error(`${callerName} requires ${name} to be an object`);
        }
        break;
      case 'string':
        if (typeof value !== 'string' || value.length === 0) {
          throw new Error(`${callerName} requires ${name} to be a non-empty string`);
        }
        break;
      default:
        throw new Error(`validateDeps: unknown type "${type}" for dep "${name}"`);
    }
  }
}

module.exports = { validateDeps };
