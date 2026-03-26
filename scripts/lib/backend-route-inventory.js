'use strict';

const fs = require('fs');
const path = require('path');

function getRepoRoot(start = process.cwd()) {
  let root = start;
  if (path.basename(root) === 'functions') {
    root = path.dirname(root);
  }
  return root;
}

function toPosix(filePath) {
  return filePath.replace(/\\/g, '/');
}

function toRelPath(repoRoot, filePath) {
  return toPosix(path.relative(repoRoot, filePath));
}

function readFileOrThrow(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function normalizeEndpointPath(raw) {
  if (!raw || typeof raw !== 'string') {
    return '';
  }

  let value = raw.trim();
  if (!value) {
    return '';
  }

  const apiIndex = value.indexOf('/api/');
  if (apiIndex >= 0) {
    value = value.slice(apiIndex);
  }

  value = value.split('#')[0];
  value = value.split('?')[0];
  value = value.replace(/\$\{[^}]+\}/g, ':param');
  value = value.replace(/\{[^}]+\}/g, ':param');
  value = value.replace(/\/+/g, '/');

  if (!value.startsWith('/')) {
    value = `/${value}`;
  }

  if (value.length > 1 && value.endsWith('/')) {
    value = value.slice(0, -1);
  }

  return value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compilePathPattern(patternPath) {
  const normalized = normalizeEndpointPath(patternPath);
  if (!normalized) {
    return null;
  }

  const segments = normalized.split('/').filter(Boolean);
  const regexSegments = segments.map((segment) => {
    if (segment.startsWith(':')) {
      return '[^/]+';
    }
    return escapeRegExp(segment);
  });

  return new RegExp(`^/${regexSegments.join('/')}$`);
}

function pathsMatch(patternPath, actualPath) {
  const regex = compilePathPattern(patternPath);
  const normalizedActual = normalizeEndpointPath(actualPath);
  if (!regex || !normalizedActual) {
    return false;
  }
  return regex.test(normalizedActual);
}

function pathsEquivalent(pathA, pathB) {
  return pathsMatch(pathA, pathB) || pathsMatch(pathB, pathA);
}

function walkFiles(dirPath, predicate) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const results = [];

  entries.forEach((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath, predicate));
      return;
    }
    if (predicate(fullPath)) {
      results.push(fullPath);
    }
  });

  return results;
}

function listRouteModuleFiles(repoRoot) {
  const routesDir = path.join(repoRoot, 'functions', 'api', 'routes');
  return walkFiles(routesDir, (filePath) => filePath.toLowerCase().endsWith('.js')).sort();
}

function parseMountedRouteModules(indexContent, indexFilePath, repoRoot) {
  const indexDir = path.dirname(indexFilePath);
  const lines = indexContent.split(/\r?\n/);
  const authFloorPattern = /app\.use\(\s*['"]\/api['"]\s*,\s*authenticateUser\s*\)/;
  const importPattern = /const\s+\{\s*(register[A-Za-z0-9_]+(?:Routes|Route))\s*\}\s*=\s*require\(\s*['"](.\/api\/routes\/[^'"]+)['"]\s*\);/g;
  const callPattern = /\b(register[A-Za-z0-9_]+(?:Routes|Route))\(\s*app\s*,/;
  const routeModuleByRegisterName = new Map();

  let importMatch;
  while ((importMatch = importPattern.exec(indexContent)) !== null) {
    const registerName = importMatch[1];
    const requiredPath = importMatch[2];
    const resolvedPath = path.resolve(indexDir, requiredPath.endsWith('.js') ? requiredPath : `${requiredPath}.js`);
    routeModuleByRegisterName.set(registerName, resolvedPath);
  }

  const mounted = [];
  let authFloorSeen = false;
  let authFloorLineIndex = -1;

  lines.forEach((line, lineIndex) => {
    if (!authFloorSeen && authFloorPattern.test(line)) {
      authFloorSeen = true;
      authFloorLineIndex = lineIndex;
    }

    const callMatch = line.match(callPattern);
    if (!callMatch) {
      return;
    }

    const registerName = callMatch[1];
    const filePath = routeModuleByRegisterName.get(registerName);
    if (!filePath) {
      return;
    }

    mounted.push({
      registerName,
      filePath,
      source: toRelPath(repoRoot, filePath),
      line: lineIndex + 1,
      authFloor: authFloorSeen ? 'authenticated' : 'none'
    });
  });

  return {
    authFloorLineIndex,
    mountedRouteModules: mounted,
    routeModuleByRegisterName
  };
}

function parseBackendRoutesFromSource(content, sourceFile, options = {}) {
  const lines = content.split(/\r?\n/);
  const routeLinePattern = /^\s*app\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]\s*,\s*(.*)$/;
  const routeStartPattern = /^\s*app\.(get|post|put|delete|patch)\(\s*$/;
  const aliasRouteLinePattern = /^\s*register(Get|Post|Put|Delete|Patch)Aliases\(\s*app\s*,\s*\[([^\]]+)\]\s*,\s*(.*)$/;
  const pathLiteralPattern = /['"]([^'"]+)['"]/g;
  const authFloorResolver = typeof options.resolveAuthFloor === 'function'
    ? options.resolveAuthFloor
    : () => (options.authFloor || 'none');
  const routes = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(routeLinePattern);
    if (match) {
      const method = match[1].toUpperCase();
      const routePath = normalizeEndpointPath(match[2]);
      if (!routePath.startsWith('/api/')) {
        continue;
      }

      routes.push({
        method,
        path: routePath,
        middlewareSegment: match[3] || '',
        line: i + 1,
        lineIndex: i
      });
      continue;
    }

    const routeStartMatch = line.match(routeStartPattern);
    if (routeStartMatch) {
      const method = routeStartMatch[1].toUpperCase();
      let routePath = '';
      let middlewareSegment = '';

      for (let j = i + 1; j < Math.min(lines.length, i + 8); j += 1) {
        const candidateLine = lines[j];
        const pathMatch = candidateLine.match(/['"]([^'"]+)['"]/);
        if (!pathMatch) {
          continue;
        }
        routePath = normalizeEndpointPath(pathMatch[1]);
        middlewareSegment = lines.slice(j + 1, Math.min(lines.length, j + 4)).join(' ');
        break;
      }

      if (!routePath.startsWith('/api/')) {
        continue;
      }

      routes.push({
        method,
        path: routePath,
        middlewareSegment,
        line: i + 1,
        lineIndex: i
      });
      continue;
    }

    const aliasMatch = line.match(aliasRouteLinePattern);
    if (!aliasMatch) {
      continue;
    }

    const method = aliasMatch[1].toUpperCase();
    const middlewareSegment = aliasMatch[3] || '';
    pathLiteralPattern.lastIndex = 0;
    let pathMatch;
    while ((pathMatch = pathLiteralPattern.exec(aliasMatch[2])) !== null) {
      const routePath = normalizeEndpointPath(pathMatch[1]);
      if (!routePath.startsWith('/api/')) {
        continue;
      }

      routes.push({
        method,
        path: routePath,
        middlewareSegment,
        line: i + 1,
        lineIndex: i
      });
    }
  }

  return routes.map((route, index) => {
    const nextLineIndex = index + 1 < routes.length ? routes[index + 1].lineIndex : lines.length;
    const block = lines.slice(route.lineIndex, nextLineIndex).join('\n');
    const authFloor = authFloorResolver(route.lineIndex);

    let authRequirement = 'public';
    if (route.middlewareSegment.includes('requireAdmin')) {
      authRequirement = 'admin';
    } else if (route.middlewareSegment.includes('authenticateUser')) {
      authRequirement = 'authenticated';
    } else if (authFloor === 'authenticated') {
      authRequirement = 'authenticated';
    } else if (/\btryAttachUser\s*\(\s*req\s*\)/.test(block)) {
      authRequirement = 'optional';
    }

    return {
      method: route.method,
      path: route.path,
      authRequirement,
      handlerLocation: `${sourceFile}:${route.line}`,
      lineIndex: route.lineIndex
    };
  });
}

function dedupeRoutes(routes) {
  const seen = new Set();
  const results = [];

  routes.forEach((route) => {
    const key = `${route.method} ${route.path} ${route.handlerLocation}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    results.push(route);
  });

  return results;
}

function getLiveBackendRouteInventory(repoRootInput = process.cwd()) {
  const repoRoot = getRepoRoot(repoRootInput);
  const indexFilePath = path.join(repoRoot, 'functions', 'index.js');
  const indexContent = readFileOrThrow(indexFilePath);
  const { authFloorLineIndex, mountedRouteModules } = parseMountedRouteModules(indexContent, indexFilePath, repoRoot);
  const allRouteModuleFiles = listRouteModuleFiles(repoRoot);
  const mountedModulePaths = new Set(mountedRouteModules.map((entry) => path.resolve(entry.filePath)));
  const unmountedRouteModules = allRouteModuleFiles
    .filter((filePath) => !mountedModulePaths.has(path.resolve(filePath)))
    .map((filePath) => ({
      filePath,
      source: toRelPath(repoRoot, filePath)
    }));

  const routes = [];

  mountedRouteModules.forEach((moduleEntry) => {
    const content = readFileOrThrow(moduleEntry.filePath);
    routes.push(
      ...parseBackendRoutesFromSource(content, moduleEntry.source, {
        authFloor: moduleEntry.authFloor
      })
    );
  });

  routes.push(
    ...parseBackendRoutesFromSource(indexContent, toRelPath(repoRoot, indexFilePath), {
      resolveAuthFloor: (lineIndex) => (
        authFloorLineIndex >= 0 && lineIndex > authFloorLineIndex ? 'authenticated' : 'none'
      )
    })
  );

  return {
    repoRoot,
    indexFilePath,
    routes: dedupeRoutes(routes),
    mountedRouteModules,
    unmountedRouteModules
  };
}

module.exports = {
  getLiveBackendRouteInventory,
  getRepoRoot,
  normalizeEndpointPath,
  pathsEquivalent,
  pathsMatch,
  readFileOrThrow,
  toRelPath,
  walkFiles
};
