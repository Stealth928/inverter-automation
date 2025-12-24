# Test Coverage Report
## Inverter Automation Project

**Report Date:** 2025-12-24  
**Scope:** Backend Cloud Functions (`functions/`)  
**Test Runner:** Jest  

---

## Test Run Summary

- **Suites:** 22 passed
- **Tests:** 376 total (1 skipped, 375 passed)
- **Command:**
```bash
npm --prefix functions test -- --coverage --collectCoverageFrom="**/*.js" --collectCoverageFrom="!**/test/**" --collectCoverageFrom="!**/node_modules/**"
```

---

## Coverage Summary (Backend Only)

```
Area    | Lines                      | Functions                   | Branches
------- | -------------------------- | --------------------------- | --------------------------
Overall | 10.84% (335 / 3091)        | 10.14% (28 / 276)           | 5.58% (132 / 2365)
root    | 10.63% (273 / 2569)        |  9.13% (20 / 219)           | 5.15% (108 / 2099)
api     | 13.25% (62 / 468)          | 15.38% (8 / 52)             | 9.64% (24 / 249)
scripts |  0.00% (0 / 54)            |  0.00% (0 / 5)              | 0.00% (0 / 17)
```

**Notes:**
- Coverage is calculated from `functions/coverage/lcov.info`.
- `root` includes `functions/index.js`, `.eslintrc.js`, and `jest.config.js`.
- `scripts` are utilities not executed by tests, so they show 0%.
- Frontend coverage is not included in this report.

---

## Artifacts

- HTML report: `functions/coverage/index.html`
- Raw lcov: `functions/coverage/lcov.info`
