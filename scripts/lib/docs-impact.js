'use strict';

const CANONICAL_CURRENT_DOCS = [
  'README.md',
  'docs/INDEX.md',
  'docs/DOCUMENTATION_GOVERNANCE.md',
  'docs/SETUP.md',
  'docs/API.md',
  'docs/API_CONTRACT_BASELINE.md',
  'docs/openapi/openapi.v1.yaml',
  'docs/AUTOMATION.md',
  'docs/BACKGROUND_AUTOMATION.md',
  'docs/AEMO_AGGREGATION_PIPELINE.md',
  'docs/DEPLOYMENT_GUIDE.md',
  'docs/RELEASE_READINESS_CHECKLIST.md',
  'docs/LOGGING_GUIDE.md',
  'docs/USER_DEBUGGING_RUNBOOK.md',
  'docs/PROD_BACKUP_ROLLBACK_RUNBOOK.md',
  'docs/checklists/MIGRATION_SAFETY_CHECKLIST.md',
  'docs/checklists/ROLLBACK_CHECKLIST.md',
  'docs/guides/PRODUCT_CAPABILITY_GUIDE.md',
  'docs/guides/FRONTEND_CONTENT_GUIDE.md',
  'docs/guides/TESTING_GUIDE.md',
  'docs/guides/TESLA_ONBOARDING.md'
];

function normalizeRepoPath(filePath) {
  return String(filePath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

function uniqueNormalizedPaths(filePaths = []) {
  return Array.from(
    new Set(
      filePaths
        .map((filePath) => normalizeRepoPath(filePath))
        .filter(Boolean)
    )
  ).sort();
}

function pathMatchesExact(filePath, expectedPaths) {
  const normalizedPath = normalizeRepoPath(filePath);
  return expectedPaths.some((expectedPath) => normalizedPath === normalizeRepoPath(expectedPath));
}

function pathMatchesPrefix(filePath, expectedPrefixes) {
  const normalizedPath = normalizeRepoPath(filePath);
  return expectedPrefixes.some((expectedPrefix) => {
    const normalizedPrefix = normalizeRepoPath(expectedPrefix).replace(/\/+$/, '');
    return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
  });
}

function isFrontendSurfacePath(filePath) {
  const normalizedPath = normalizeRepoPath(filePath);
  if (!normalizedPath.startsWith('frontend/')) {
    return false;
  }

  if (pathMatchesPrefix(normalizedPath, ['frontend/data'])) {
    return false;
  }

  if (pathMatchesExact(normalizedPath, ['frontend/js/api-client.js'])) {
    return false;
  }

  return (
    /\.(html|css|js|xml|txt|webmanifest)$/i.test(normalizedPath) ||
    pathMatchesExact(normalizedPath, ['frontend/favicon.ico']) ||
    pathMatchesPrefix(normalizedPath, [
      'frontend/blog',
      'frontend/market-insights',
      'frontend/rule-template-recommender',
      'frontend/amber-smartshift-vs-socrates',
      'frontend/home-battery-automation-options-compared',
      'frontend/battery-automation-roi-examples'
    ])
  );
}

function isMarketInsightsPath(filePath) {
  const normalizedPath = normalizeRepoPath(filePath);
  return (
    pathMatchesExact(normalizedPath, [
      'scripts/generate-aemo-market-insights.js',
      'scripts/aemo-market-insights-delta-update.js',
      'scripts/sync-hosted-market-insights.js'
    ]) ||
    pathMatchesPrefix(normalizedPath, [
      'frontend/data/aemo-market-insights',
      'frontend/market-insights'
    ]) ||
    pathMatchesExact(normalizedPath, [
      'frontend/js/market-insights.js',
      'frontend/js/market-insights-preview.js'
    ])
  );
}

const DOCS_IMPACT_RULES = [
  {
    id: 'api-surface',
    description: 'Live API surface, auth model, or frontend API contracts changed.',
    docs: [
      'docs/API.md',
      'docs/openapi/openapi.v1.yaml',
      'docs/API_CONTRACT_BASELINE.md'
    ],
    matches(filePath) {
      return (
        pathMatchesExact(filePath, [
          'functions/index.js',
          'frontend/js/api-client.js',
          'scripts/api-contract-baseline.js',
          'scripts/openapi-contract-check.js',
          'scripts/lib/backend-route-inventory.js'
        ]) ||
        pathMatchesPrefix(filePath, ['functions/api'])
      );
    }
  },
  {
    id: 'automation-runtime',
    description: 'Automation runtime, scheduler, quick control, or Automation Lab behavior changed.',
    docs: [
      'docs/AUTOMATION.md',
      'docs/BACKGROUND_AUTOMATION.md',
      'docs/guides/PRODUCT_CAPABILITY_GUIDE.md'
    ],
    matches(filePath) {
      return (
        pathMatchesPrefix(filePath, [
          'functions/api/routes/automation',
          'functions/api/routes/scheduler'
        ]) ||
        pathMatchesExact(filePath, [
          'functions/api/routes/quick-control.js',
          'functions/lib/services/quick-control-service.js',
          'functions/lib/services/backtest-service.js',
          'frontend/test.html',
          'frontend/control.html',
          'frontend/settings.html',
          'frontend/app.html',
          'frontend/rules-library.html',
          'frontend/history.html',
          'frontend/roi.html',
          'frontend/js/automation-lab-backtest.js',
          'frontend/js/dashboard.js',
          'frontend/js/control.js',
          'frontend/js/settings.js',
          'frontend/js/rules-library.js',
          'frontend/js/history.js',
          'frontend/js/roi.js'
        ]) ||
        pathMatchesPrefix(filePath, [
          'functions/lib/services/automation',
          'functions/lib/services/scheduler',
          'functions/lib/automation'
        ])
      );
    }
  },
  {
    id: 'frontend-product-surface',
    description: 'Public or authenticated product surface changed.',
    docs: [
      'docs/guides/PRODUCT_CAPABILITY_GUIDE.md',
      'docs/guides/FRONTEND_CONTENT_GUIDE.md',
      'README.md'
    ],
    matches(filePath) {
      return isFrontendSurfacePath(filePath);
    }
  },
  {
    id: 'market-insights-pipeline',
    description: 'Market-insights pipeline or published data flow changed.',
    docs: [
      'docs/AEMO_AGGREGATION_PIPELINE.md',
      'docs/guides/PRODUCT_CAPABILITY_GUIDE.md',
      'docs/guides/FRONTEND_CONTENT_GUIDE.md'
    ],
    matches(filePath) {
      return isMarketInsightsPath(filePath);
    }
  },
  {
    id: 'operations-release',
    description: 'Deployment, release gates, CI, or repo policy changed.',
    docs: [
      'docs/DEPLOYMENT_GUIDE.md',
      'docs/RELEASE_READINESS_CHECKLIST.md',
      'docs/guides/TESTING_GUIDE.md',
      'docs/DOCUMENTATION_GOVERNANCE.md'
    ],
    matches(filePath) {
      return (
        pathMatchesPrefix(filePath, ['.github/workflows']) ||
        pathMatchesExact(filePath, [
          '.github/copilot-instructions.md',
          'firebase.json',
          'package.json',
          'functions/package.json',
          'scripts/pre-deploy-check.js',
          'scripts/repo-hygiene-check.js',
          'scripts/generate-release-manifest.js',
          'scripts/verify-release-alignment.js',
          'scripts/docs-impact-check.js'
        ])
      );
    }
  },
  {
    id: 'setup-and-data-contracts',
    description: 'Firestore contracts, setup flows, or seed/restore operations changed.',
    docs: [
      'docs/SETUP.md',
      'docs/PROD_BACKUP_ROLLBACK_RUNBOOK.md',
      'docs/checklists/MIGRATION_SAFETY_CHECKLIST.md',
      'docs/checklists/ROLLBACK_CHECKLIST.md'
    ],
    matches(filePath) {
      return (
        pathMatchesExact(filePath, [
          'firestore.rules',
          'firestore.indexes.json',
          'functions/scripts/seed-emulator-state.js',
          'functions/scripts/restore-user-config.js',
          'functions/scripts/cleanup-stale-state.js'
        ])
      );
    }
  }
];

function collectChangedDocs(changedFiles = []) {
  const normalizedFiles = uniqueNormalizedPaths(changedFiles);
  return normalizedFiles.filter((filePath) => CANONICAL_CURRENT_DOCS.includes(filePath));
}

function collectImpactedRules(changedFiles = []) {
  const normalizedFiles = uniqueNormalizedPaths(changedFiles);
  return DOCS_IMPACT_RULES
    .map((rule) => {
      const triggeredFiles = normalizedFiles.filter((filePath) => rule.matches(filePath));
      if (!triggeredFiles.length) {
        return null;
      }

      return {
        id: rule.id,
        description: rule.description,
        docs: [...rule.docs],
        triggeredFiles
      };
    })
    .filter(Boolean);
}

function evaluateDocsImpact({ changedFiles = [], overrideReason = null } = {}) {
  const normalizedFiles = uniqueNormalizedPaths(changedFiles);
  const changedDocs = collectChangedDocs(normalizedFiles);
  const impactedRules = collectImpactedRules(normalizedFiles)
    .map((rule) => ({
      ...rule,
      matchedDocs: rule.docs.filter((docPath) => changedDocs.includes(docPath))
    }));
  const missingRules = impactedRules.filter((rule) => rule.matchedDocs.length === 0);
  const normalizedOverrideReason = String(overrideReason || '').trim() || null;

  return {
    changedFiles: normalizedFiles,
    changedDocs,
    impactedRules,
    missingRules,
    overrideReason: normalizedOverrideReason,
    ok: missingRules.length === 0 || Boolean(normalizedOverrideReason)
  };
}

function parseDocsOverrideFromText(text) {
  const source = String(text || '');
  const directReasonMatch = source.match(/^\s*No doc impact:\s*(.+?)\s*$/im);
  if (directReasonMatch && !directReasonMatch[1].includes('<!--')) {
    return directReasonMatch[1].trim();
  }

  const docsImpactMatch = source.match(/^\s*Docs impact:\s*none(?:\s*[-:]\s*(.+))?\s*$/im);
  if (docsImpactMatch) {
    const reason = String(docsImpactMatch[1] || '').trim();
    return reason || 'No doc impact justification provided in PR body.';
  }

  return null;
}

module.exports = {
  CANONICAL_CURRENT_DOCS,
  DOCS_IMPACT_RULES,
  collectChangedDocs,
  collectImpactedRules,
  evaluateDocsImpact,
  normalizeRepoPath,
  parseDocsOverrideFromText,
  uniqueNormalizedPaths
};
