#!/usr/bin/env node
'use strict';

const path = require('path');
const yaml = require('js-yaml');
const {
  getLiveBackendRouteInventory,
  getRepoRoot,
  normalizeEndpointPath,
  pathsEquivalent,
  readFileOrThrow,
  toRelPath
} = require('./lib/backend-route-inventory');

const args = new Set(process.argv.slice(2));
const silent = args.has('--silent');

const repoRoot = getRepoRoot();
const openApiSpecPath = path.join(repoRoot, 'docs', 'openapi', 'openapi.v1.yaml');

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

function logInfo(message) {
  if (!silent) {
    console.log(`[OpenAPI] ${message}`);
  }
}

function parseOpenApiOperations(specDoc) {
  const errors = [];
  const operations = [];

  if (!specDoc || typeof specDoc !== 'object') {
    errors.push('Spec root must be a YAML object.');
    return { operations, errors };
  }

  const version = String(specDoc.openapi || '').trim();
  if (!version.startsWith('3.')) {
    errors.push(`Unsupported or missing OpenAPI version: "${version || 'undefined'}" (expected 3.x).`);
  }

  if (!specDoc.info || typeof specDoc.info !== 'object') {
    errors.push('Missing required "info" object.');
  }

  if (!specDoc.paths || typeof specDoc.paths !== 'object') {
    errors.push('Missing required "paths" object.');
    return { operations, errors };
  }

  const seenOperationIds = new Map();
  const seenMethodPath = new Set();

  for (const [rawPath, pathItem] of Object.entries(specDoc.paths)) {
    if (!rawPath.startsWith('/')) {
      errors.push(`Path must start with '/': ${rawPath}`);
      continue;
    }

    const normalizedPath = normalizeEndpointPath(rawPath);
    if (!normalizedPath.startsWith('/api/')) {
      errors.push(`Path must be under /api/* for this backend: ${rawPath}`);
    }

    if (!pathItem || typeof pathItem !== 'object') {
      errors.push(`Path item must be an object for ${rawPath}.`);
      continue;
    }

    for (const [method, operation] of Object.entries(pathItem)) {
      const normalizedMethod = method.toLowerCase();
      if (!HTTP_METHODS.has(normalizedMethod)) {
        continue;
      }

      if (!operation || typeof operation !== 'object') {
        errors.push(`Operation object missing for ${method.toUpperCase()} ${rawPath}.`);
        continue;
      }

      const operationId = String(operation.operationId || '').trim();
      if (!operationId) {
        errors.push(`Missing operationId for ${method.toUpperCase()} ${rawPath}.`);
      } else {
        const previous = seenOperationIds.get(operationId);
        if (previous) {
          errors.push(
            `Duplicate operationId "${operationId}" used by ${previous} and ${method.toUpperCase()} ${rawPath}.`
          );
        } else {
          seenOperationIds.set(operationId, `${method.toUpperCase()} ${rawPath}`);
        }
      }

      const methodPathKey = `${normalizedMethod.toUpperCase()} ${normalizedPath}`;
      if (seenMethodPath.has(methodPathKey)) {
        errors.push(`Duplicate OpenAPI operation after path normalization: ${methodPathKey}.`);
      } else {
        seenMethodPath.add(methodPathKey);
      }

      operations.push({
        method: normalizedMethod.toUpperCase(),
        rawPath,
        path: normalizedPath,
        operationId: operationId || null,
      });
    }
  }

  if (operations.length === 0) {
    errors.push('No HTTP operations found under paths.');
  }

  return { operations, errors };
}

function main() {
  let specContent;

  try {
    specContent = readFileOrThrow(openApiSpecPath);
  } catch (error) {
    console.error(`[OpenAPI] ${error.message}`);
    process.exit(1);
  }

  let specDoc;
  try {
    specDoc = yaml.load(specContent);
  } catch (error) {
    const reason = error && error.message ? error.message : String(error);
    console.error(`[OpenAPI] YAML parse error in ${toRelPath(openApiSpecPath)}: ${reason}`);
    process.exit(1);
  }

  const backendRoutes = getLiveBackendRouteInventory(repoRoot).routes;
  const { operations, errors: structuralErrors } = parseOpenApiOperations(specDoc);

  const parityMismatches = operations
    .map((operation) => {
      const exactMatch = backendRoutes.some(
        (route) => route.method === operation.method && pathsEquivalent(route.path, operation.path)
      );
      if (exactMatch) {
        return null;
      }

      const pathMatches = backendRoutes.filter((route) => pathsEquivalent(route.path, operation.path));
      if (pathMatches.length > 0) {
        const backendMethods = Array.from(new Set(pathMatches.map((route) => route.method))).sort();
        return {
          ...operation,
          reason: `Method mismatch. Backend supports: ${backendMethods.join(', ')}.`,
        };
      }

      return {
        ...operation,
        reason: 'No matching backend route path found.',
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.path === b.path) return a.method.localeCompare(b.method);
      return a.path.localeCompare(b.path);
    });

  if (structuralErrors.length > 0 || parityMismatches.length > 0) {
    console.error('[OpenAPI] Validation failed.');

    if (structuralErrors.length > 0) {
      console.error('[OpenAPI] Structural issues:');
      structuralErrors.forEach((issue) => {
        console.error(`  - ${issue}`);
      });
    }

    if (parityMismatches.length > 0) {
      console.error('[OpenAPI] Path/method parity mismatches:');
      parityMismatches.forEach((mismatch) => {
        console.error(
          `  - ${mismatch.method} ${mismatch.rawPath} (${mismatch.reason})` +
            (mismatch.operationId ? ` [operationId=${mismatch.operationId}]` : '')
        );
      });
    }

    process.exit(1);
  }

  const undocumentedBackendRoutes = backendRoutes.filter(
    (route) => !operations.some((operation) => operation.method === route.method && pathsEquivalent(operation.path, route.path))
  );

  logInfo(`Spec parsed: ${toRelPath(repoRoot, openApiSpecPath)}`);
  logInfo(`Backend routes discovered: ${backendRoutes.length}`);
  logInfo(`OpenAPI operations declared: ${operations.length}`);
  logInfo(`OpenAPI operations matching backend: ${operations.length - parityMismatches.length}`);
  logInfo(`Backend routes not yet in OpenAPI (allowed during incremental rollout): ${undocumentedBackendRoutes.length}`);

  process.exit(0);
}

main();
