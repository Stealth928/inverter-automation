#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  getLiveBackendRouteInventory,
  getRepoRoot,
  normalizeEndpointPath,
  pathsEquivalent,
  pathsMatch,
  readFileOrThrow,
  toRelPath,
  walkFiles
} = require('./lib/backend-route-inventory');

const args = new Set(process.argv.slice(2));
const shouldWriteDoc = args.has('--write-doc') || args.has('--write') || args.has('--update-docs');
const silent = args.has('--silent');

const repoRoot = getRepoRoot();
const apiClientFile = path.join(repoRoot, 'frontend', 'js', 'api-client.js');
const frontendDir = path.join(repoRoot, 'frontend');
const outputDocFile = path.join(repoRoot, 'docs', 'API_CONTRACT_BASELINE_MAR26.md');

function parseApiClientEndpoints(content) {
  const lines = content.split(/\r?\n/);
  const results = [];
  const endpointPattern = /this\.(get|post|put|delete|patch)\(\s*(['"`])((?:https?:\/\/[^'"`\s]+)?\/api\/[^'"`\s]*)\2/g;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let match;
    while ((match = endpointPattern.exec(line)) !== null) {
      const method = match[1].toUpperCase();
      const endpointPath = normalizeEndpointPath(match[3]);
      if (!endpointPath) {
        continue;
      }
      results.push({
        method,
        path: endpointPath,
        source: `frontend/js/api-client.js:${i + 1}`,
      });
    }
  }

  return results;
}

function detectLikelyMethod(lines, lineIndex) {
  const sameLine = lines[lineIndex] || '';
  if (sameLine.includes('.post(')) return 'POST';
  if (sameLine.includes('.put(')) return 'PUT';
  if (sameLine.includes('.patch(')) return 'PATCH';
  if (sameLine.includes('.delete(')) return 'DELETE';
  if (sameLine.includes('.get(')) return 'GET';

  const callWindow = lines.slice(lineIndex, Math.min(lines.length, lineIndex + 8)).join(' ');
  const methodMatch = callWindow.match(/method\s*:\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]/i);
  if (methodMatch) {
    return methodMatch[1].toUpperCase();
  }

  return 'GET';
}

function parseInlineHtmlEndpoints(frontendPath) {
  const htmlFiles = walkFiles(frontendPath, (filePath) => filePath.toLowerCase().endsWith('.html'));
  const endpointLiteralPattern = /(['"`])((?:https?:\/\/[^'"`\s]+)?\/api\/[^'"`\s]*)\1/g;
  const results = [];

  for (const filePath of htmlFiles) {
    const relPath = toRelPath(repoRoot, filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();
      if (
        trimmed.startsWith('//') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('<!--')
      ) {
        continue;
      }

      let match;
      while ((match = endpointLiteralPattern.exec(line)) !== null) {
        const endpointPath = normalizeEndpointPath(match[2]);
        if (!endpointPath) {
          continue;
        }

        results.push({
          method: detectLikelyMethod(lines, i),
          path: endpointPath,
          source: `${relPath}:${i + 1}`,
        });
      }
    }
  }

  return results;
}

function dedupeByMethodAndPath(entries) {
  const deduped = new Map();

  for (const entry of entries) {
    const key = `${entry.method} ${entry.path}`;
    if (!deduped.has(key)) {
      deduped.set(key, {
        method: entry.method,
        path: entry.path,
        sources: [entry.source],
      });
      continue;
    }
    deduped.get(key).sources.push(entry.source);
  }

  return Array.from(deduped.values()).sort((a, b) => {
    if (a.path === b.path) return a.method.localeCompare(b.method);
    return a.path.localeCompare(b.path);
  });
}

function groupByPath(entries) {
  const grouped = new Map();

  for (const entry of entries) {
    const key = entry.path;
    if (!grouped.has(key)) {
      grouped.set(key, {
        path: entry.path,
        methods: new Set([entry.method]),
        sources: [entry.source],
      });
      continue;
    }
    const existing = grouped.get(key);
    existing.methods.add(entry.method);
    existing.sources.push(entry.source);
  }

  return Array.from(grouped.values())
    .map((entry) => ({
      path: entry.path,
      methods: Array.from(entry.methods).sort(),
      sources: Array.from(new Set(entry.sources)).sort(),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function collectConsumer(route, apiClientEntries, inlinePathEntries) {
  const hasApiClientConsumer = apiClientEntries.some((entry) => pathsMatch(route.path, entry.path));
  if (hasApiClientConsumer) {
    return 'APIClient';
  }

  const hasInlineConsumer = inlinePathEntries.some((entry) => pathsMatch(route.path, entry.path));
  if (hasInlineConsumer) {
    return 'inline';
  }

  return 'server-only';
}

function mdEscape(text) {
  return String(text).replace(/\|/g, '\\|');
}

function formatSources(sources, maxCount = 2) {
  if (!sources.length) return '';
  const limited = sources.slice(0, maxCount);
  const suffix = sources.length > maxCount ? ` (+${sources.length - maxCount} more)` : '';
  return `${limited.join(', ')}${suffix}`;
}

function generateMarkdownReport(data) {
  const now = new Date().toISOString().slice(0, 10);
  const lines = [];

  lines.push('# API Contract Baseline (March 2026)');
  lines.push('');
  lines.push(`Generated: ${now} via \`node scripts/api-contract-baseline.js --write-doc\``);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Backend routes discovered: **${data.routes.length}**`);
  lines.push(`- Mounted route modules scanned: **${data.mountedRouteModules.length}**`);
  lines.push(`- Unmounted route modules excluded: **${data.unmountedRouteModules.length}**`);
  lines.push(`- APIClient endpoint-method entries: **${data.apiClientEntries.length}**`);
  lines.push(`- Inline HTML endpoint paths discovered: **${data.inlinePathEntries.length}**`);
  lines.push(`- Inline HTML endpoint paths missing from APIClient: **${data.inlineMissing.length}**`);
  lines.push(`- APIClient mismatches vs backend routes: **${data.apiClientMismatches.length}**`);
  lines.push('');
  lines.push('## Backend Route Inventory');
  lines.push('');
  lines.push('| # | Method | Path | Auth Requirement | Handler | Consumer |');
  lines.push('|---:|---|---|---|---|---|');
  data.routes.forEach((route, index) => {
    lines.push(`| ${index + 1} | ${route.method} | \`${mdEscape(route.path)}\` | ${route.authRequirement} | \`${route.handlerLocation}\` | ${route.consumer} |`);
  });
  lines.push('');
  lines.push('## Inline HTML Endpoints Missing from APIClient');
  lines.push('');
  if (data.inlineMissing.length === 0) {
    lines.push('No inline-only endpoints were detected.');
  } else {
    lines.push('| Path | Backend Method(s) | Auth Requirement(s) | Example Source(s) |');
    lines.push('|---|---|---|---|');
    data.inlineMissing.forEach((entry) => {
      lines.push(`| \`${mdEscape(entry.path)}\` | ${mdEscape(entry.backendMethods.join(', '))} | ${mdEscape(entry.authRequirements.join(', '))} | \`${mdEscape(formatSources(entry.sources))}\` |`);
    });
  }
  lines.push('');
  lines.push('## APIClient vs Backend Mismatch Check');
  lines.push('');
  if (data.apiClientMismatches.length === 0) {
    lines.push('No APIClient route mismatches detected.');
  } else {
    lines.push('| APIClient Endpoint | Source | Reason |');
    lines.push('|---|---|---|');
    data.apiClientMismatches.forEach((mismatch) => {
      lines.push(`| \`${mismatch.method} ${mdEscape(mismatch.path)}\` | \`${mdEscape(mismatch.source)}\` | ${mdEscape(mismatch.reason)} |`);
    });
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- Consumer classification priority: `APIClient` -> `inline` -> `server-only`.');
  lines.push('- `Auth Requirement = optional` means the route is mounted before the global `/api` auth middleware and calls `tryAttachUser(req)` inside the handler.');
  lines.push('- Routes mounted after `app.use(\'/api\', authenticateUser)` inherit `authenticated` even when their route modules omit explicit middleware.');
  lines.push(`- Unmounted route modules are intentionally excluded from this report: ${data.unmountedRouteModules.map((entry) => `\`${entry.source}\``).join(', ') || 'none'}.`);
  lines.push('- This file is generated and should be refreshed whenever API routes or frontend endpoint calls change.');
  lines.push('');

  return `${lines.join('\n')}\n`;
}

function main() {
  const apiClientContent = readFileOrThrow(apiClientFile);
  const backendInventory = getLiveBackendRouteInventory(repoRoot);

  const backendRoutes = backendInventory.routes;
  const apiClientEntries = dedupeByMethodAndPath(parseApiClientEndpoints(apiClientContent));
  const inlineHtmlEntries = parseInlineHtmlEndpoints(frontendDir);
  const inlinePathEntries = groupByPath(inlineHtmlEntries);

  const routesWithConsumer = backendRoutes
    .map((route) => ({
      ...route,
      consumer: collectConsumer(route, apiClientEntries, inlinePathEntries),
    }))
    .sort((a, b) => {
      if (a.path === b.path) return a.method.localeCompare(b.method);
      return a.path.localeCompare(b.path);
    });

  const apiClientMismatches = apiClientEntries
    .map((entry) => {
      const exactMatch = backendRoutes.some((route) => route.method === entry.method && pathsMatch(route.path, entry.path));
      if (exactMatch) {
        return null;
      }

      const pathMatches = backendRoutes.filter((route) => pathsMatch(route.path, entry.path));
      let reason = 'No backend route found for this path.';
      if (pathMatches.length > 0) {
        const methods = Array.from(new Set(pathMatches.map((route) => route.method))).sort();
        reason = `Method mismatch. Backend supports: ${methods.join(', ')}.`;
      }

      return {
        method: entry.method,
        path: entry.path,
        source: formatSources(entry.sources, 1),
        reason,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.path === b.path) return a.method.localeCompare(b.method);
      return a.path.localeCompare(b.path);
    });

  const inlineMissing = inlinePathEntries
    .map((entry) => {
      const coveredByApiClient = apiClientEntries.some((apiEntry) => pathsEquivalent(apiEntry.path, entry.path));
      if (coveredByApiClient) {
        return null;
      }

      const matchedRoutes = backendRoutes.filter((route) => pathsMatch(route.path, entry.path));
      if (matchedRoutes.length === 0) {
        return null;
      }

      return {
        path: entry.path,
        backendMethods: Array.from(new Set(matchedRoutes.map((route) => route.method))).sort(),
        authRequirements: Array.from(new Set(matchedRoutes.map((route) => route.authRequirement))).sort(),
        sources: entry.sources,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.path.localeCompare(b.path));

  if (!silent) {
    console.log(`[API Contract] Backend routes: ${backendRoutes.length}`);
    console.log(`[API Contract] APIClient endpoint-method entries: ${apiClientEntries.length}`);
    console.log(`[API Contract] Inline HTML endpoint paths: ${inlinePathEntries.length}`);
    console.log(`[API Contract] Inline HTML paths missing from APIClient: ${inlineMissing.length}`);
    console.log(`[API Contract] APIClient mismatches vs backend: ${apiClientMismatches.length}`);
  }

  if (shouldWriteDoc) {
    const markdown = generateMarkdownReport({
      routes: routesWithConsumer,
      mountedRouteModules: backendInventory.mountedRouteModules,
      unmountedRouteModules: backendInventory.unmountedRouteModules,
      apiClientEntries,
      inlinePathEntries,
      inlineMissing,
      apiClientMismatches,
    });
    fs.writeFileSync(outputDocFile, markdown, 'utf8');
    if (!silent) {
      console.log(`[API Contract] Wrote report: ${toRelPath(repoRoot, outputDocFile)}`);
    }
  }

  if (apiClientMismatches.length > 0) {
    if (!silent) {
      console.error('[API Contract] Mismatches detected:');
      apiClientMismatches.forEach((mismatch) => {
        console.error(`  - ${mismatch.method} ${mismatch.path} (${mismatch.reason}) [${mismatch.source}]`);
      });
    }
    process.exit(1);
  }

  process.exit(0);
}

main();
