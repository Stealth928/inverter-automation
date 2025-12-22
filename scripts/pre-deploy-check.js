#!/usr/bin/env node

/**
 * Pre-Deployment Quality Assurance Check
 * 
 * This script runs comprehensive checks before deployment to catch:
 * - Test failures
 * - Linting errors
 * - Missing module imports
 * - Broken routes
 * - Critical module exports
 * 
 * Usage: npm run pre-deploy (or node scripts/pre-deploy-check.js)
 * Exit codes: 0 = all checks pass, 1 = failure
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Determine repo root (could be called from functions/ or from root)
let repoRoot = process.cwd();
if (path.basename(repoRoot) === 'functions') {
  repoRoot = path.dirname(repoRoot);
}

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function log(color, ...args) {
  console.log(color, ...args, colors.reset);
}

function section(title) {
  console.log('\n' + colors.cyan + colors.bright + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + colors.reset);
  console.log(colors.cyan + colors.bright + '  ' + title + colors.reset);
  console.log(colors.cyan + colors.bright + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + colors.reset + '\n');
}

function checkPass(msg) {
  log(colors.green, '✓', msg);
}

function checkFail(msg) {
  log(colors.red, '✗', msg);
}

function checkWarn(msg) {
  log(colors.yellow, '⚠', msg);
}

let failures = [];

// ============================================================================
// 1. RUN JEST TESTS
// ============================================================================
section('1. Running Test Suite');
try {
  log(colors.cyan, 'Running: npm --prefix functions test -- --passWithNoTests');
  execSync('npm --prefix functions test -- --passWithNoTests', { stdio: 'inherit' });
  checkPass('All tests passed');
} catch (e) {
  checkFail('Tests failed - see output above');
  failures.push('TEST_FAILURE');
}

// ============================================================================
// 2. RUN LINTER
// ============================================================================
section('2. Running ESLint');
try {
  log(colors.cyan, 'Running: npm --prefix functions run lint');
  execSync('npm --prefix functions run lint', { stdio: 'inherit' });
  checkPass('No linting errors');
} catch (e) {
  checkFail('Linting errors found - see output above');
  failures.push('LINT_FAILURE');
}

// ============================================================================
// 3. VERIFY MODULE IMPORTS AND EXPORTS
// ============================================================================
section('3. Verifying Module Imports and Exports');

const criticalModules = {
  'functions/api/amber.js': ['amberPricesInFlight', 'init'],
  'functions/api/foxess.js': ['init', 'generateFoxESSSignature'],
  'functions/api/auth.js': ['init'],
};

let moduleChecksPassed = true;

Object.entries(criticalModules).forEach(([filePath, exports]) => {
  const fullPath = path.join(repoRoot, filePath);
  if (!fs.existsSync(fullPath)) {
    checkFail(`Module file not found: ${filePath}`);
    moduleChecksPassed = false;
    return;
  }

  const content = fs.readFileSync(fullPath, 'utf8');
  exports.forEach(exp => {
    if (content.includes(`module.exports`) && content.includes(`${exp}`)) {
      checkPass(`${filePath} exports "${exp}"`);
    } else {
      checkFail(`${filePath} missing export: "${exp}"`);
      moduleChecksPassed = false;
    }
  });
});

if (!moduleChecksPassed) {
  failures.push('MODULE_EXPORT_FAILURE');
}

// ============================================================================
// 4. VERIFY CRITICAL MODULE IMPORTS IN INDEX.JS
// ============================================================================
section('4. Verifying Module Imports in index.js');

const indexPath = path.join(repoRoot, 'functions', 'index.js');
const indexContent = fs.readFileSync(indexPath, 'utf8');

const requiredImports = [
  { pattern: /const\s+amberAPI\s*=\s*amberModule\.init/, name: 'amberAPI initialization' },
  { pattern: /const\s+\{\s*amberPricesInFlight\s*\}\s*=\s*amberModule/, name: 'amberPricesInFlight import' },
  { pattern: /const\s+foxessAPI\s*=\s*foxessModule\.init/, name: 'foxessAPI initialization' },
  { pattern: /const\s+authAPI\s*=\s*authModule\.init/, name: 'authAPI initialization' },
  { pattern: /app\.use\(.*authenticateUser/, name: 'authenticateUser middleware' },
];

let importsChecksPassed = true;

requiredImports.forEach(({ pattern, name }) => {
  if (pattern.test(indexContent)) {
    checkPass(`index.js has: ${name}`);
  } else {
    checkFail(`index.js missing: ${name}`);
    importsChecksPassed = false;
  }
});

if (!importsChecksPassed) {
  failures.push('IMPORT_FAILURE');
}

// ============================================================================
// 5. VERIFY CRITICAL ROUTES EXIST
// ============================================================================
section('5. Verifying Critical Routes');

const criticalRoutes = [
  { pattern: /app\.get\(['"]\/api\/amber\/sites/, name: '/api/amber/sites' },
  { pattern: /app\.get\(['"]\/api\/amber\/prices\/current/, name: '/api/amber/prices/current' },
  { pattern: /app\.get\(['"]\/api\/inverter\/real-time/, name: '/api/inverter/real-time' },
  { pattern: /app\.get\(['"]\/api\/health/, name: '/api/health' },
];

let routesChecksPassed = true;

criticalRoutes.forEach(({ pattern, name }) => {
  if (pattern.test(indexContent)) {
    checkPass(`Route defined: ${name}`);
  } else {
    checkFail(`Route missing: ${name}`);
    routesChecksPassed = false;
  }
});

if (!routesChecksPassed) {
  failures.push('ROUTE_FAILURE');
}

// ============================================================================
// 6. CHECK FOR COMMON REFACTORING MISTAKES
// ============================================================================
section('6. Checking for Common Refactoring Issues');

const commonMistakes = [
  {
    pattern: /(?<!amberAPI\.)callAmberAPI\s*\(/g,
    name: 'callAmberAPI called without amberAPI prefix',
    shouldNotFind: true,
  },
  {
    pattern: /(?<!foxessAPI\.)callFoxESSAPI\s*\(/g,
    name: 'callFoxESSAPI called without foxessAPI prefix',
    shouldNotFind: true,
  },
  {
    pattern: /amberPricesInFlight(?!.*=.*amberModule)/,
    name: 'amberPricesInFlight used but not imported from amberModule',
    shouldNotFind: true,
  },
];

let mistakesChecksPassed = true;

commonMistakes.forEach(({ pattern, name, shouldNotFind }) => {
  const matches = indexContent.match(pattern);
  if (shouldNotFind && !matches) {
    checkPass(`No issues found: ${name}`);
  } else if (!shouldNotFind && matches) {
    checkPass(`Pattern found: ${name}`);
  } else if (shouldNotFind && matches) {
    checkWarn(`Potential issue detected: ${name} (${matches.length} occurrences)`);
    // Don't fail completely, just warn
  }
});

// ============================================================================
// 7. CHECK FIREBASE.JSON REWRITES
// ============================================================================
section('7. Verifying firebase.json Configuration');

const firebaseJsonPath = path.join(repoRoot, 'firebase.json');
if (fs.existsSync(firebaseJsonPath)) {
  try {
    const firebaseConfig = JSON.parse(fs.readFileSync(firebaseJsonPath, 'utf8'));
    if (firebaseConfig.hosting && firebaseConfig.hosting.rewrites) {
      checkPass('firebase.json has hosting rewrites configured');
      
      // Verify API rewrite points to correct function
      const apiRewrite = firebaseConfig.hosting.rewrites.find(r => r.source === '/api/**');
      if (apiRewrite && apiRewrite.function === 'api') {
        checkPass('API rewrite correctly configured: /api/** → api function');
      } else {
        checkFail('API rewrite misconfigured in firebase.json');
        failures.push('FIREBASE_CONFIG_FAILURE');
      }
    } else {
      checkWarn('firebase.json missing hosting rewrites');
    }
  } catch (e) {
    checkFail(`Error reading firebase.json: ${e.message}`);
    failures.push('FIREBASE_CONFIG_FAILURE');
  }
} else {
  checkFail('firebase.json not found');
  failures.push('FIREBASE_CONFIG_FAILURE');
}

// ============================================================================
// 8. SUMMARY AND EXIT
// ============================================================================
section('Pre-Deployment Check Summary');

if (failures.length === 0) {
  log(colors.green + colors.bright, '🎉 All pre-deployment checks passed!');
  log(colors.green, 'You are safe to deploy.');
  process.exit(0);
} else {
  log(colors.red + colors.bright, '❌ Pre-deployment check failed');
  log(colors.red, `\nFailures detected (${failures.length}):`);
  failures.forEach((failure, idx) => {
    log(colors.red, `  ${idx + 1}. ${failure}`);
  });
  log(colors.red, '\nPlease fix the issues above before deploying.');
  process.exit(1);
}
