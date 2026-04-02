const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectImpactedRules,
  evaluateDocsImpact,
  normalizeRepoPath,
  parseDocsOverrideFromText
} = require('../../scripts/lib/docs-impact');

test('normalizeRepoPath normalizes Windows-style repo paths', () => {
  assert.equal(
    normalizeRepoPath('.\\docs\\API_CONTRACT_BASELINE.md'),
    'docs/API_CONTRACT_BASELINE.md'
  );
});

test('API surface changes require mapped canonical docs', () => {
  const evaluation = evaluateDocsImpact({
    changedFiles: ['functions/api/routes/weather.js']
  });

  assert.equal(evaluation.ok, false);
  assert.deepEqual(
    evaluation.missingRules.map((rule) => rule.id),
    ['api-surface']
  );
  assert.deepEqual(evaluation.missingRules[0].docs, [
    'docs/API.md',
    'docs/openapi/openapi.v1.yaml',
    'docs/API_CONTRACT_BASELINE.md'
  ]);
});

test('matching canonical docs satisfy the mapped docs impact', () => {
  const evaluation = evaluateDocsImpact({
    changedFiles: [
      'functions/api/routes/weather.js',
      'docs/API.md'
    ]
  });

  assert.equal(evaluation.ok, true);
  assert.deepEqual(evaluation.missingRules, []);
  assert.deepEqual(evaluation.impactedRules[0].matchedDocs, ['docs/API.md']);
});

test('frontend changes map to product-surface docs', () => {
  const impactedRules = collectImpactedRules([
    'frontend/index.html',
    'frontend/css/landing.css'
  ]);

  assert.deepEqual(
    impactedRules.map((rule) => rule.id),
    ['frontend-product-surface']
  );
});

test('pull request body can justify a no-doc-impact exception', () => {
  const reason = parseDocsOverrideFromText(`
## Docs Impact
- [ ] Docs updated
Docs updated:

- [x] No doc impact
No doc impact: internal refactor only, no contract or workflow behavior changed.
`);

  assert.equal(
    reason,
    'internal refactor only, no contract or workflow behavior changed.'
  );
});
