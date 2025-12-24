# Testing Guide

## Overview

This repository has two test tracks:
- **Backend (Jest)**: All Cloud Functions tests in `functions/test/*.test.js`
- **Frontend (Playwright)**: UI tests in `tests/frontend/*.spec.js`

**Last verified:** 2025-12-24  
**Backend Jest result:** 22 suites, 376 tests (1 skipped), all passing  
**Coverage command used:**
```bash
npm --prefix functions test -- --coverage --collectCoverageFrom="**/*.js" --collectCoverageFrom="!**/test/**" --collectCoverageFrom="!**/node_modules/**"
```

Note: there are no standalone `functions/integration-test.js` or `functions/e2e-tests.js` scripts in this repo right now. Any docs or scripts that reference them are outdated.

---

## 1. Backend Tests (Jest)

**Location:** `functions/test/*.test.js`  
**What they cover:**
- Automation logic, edge cases, and scheduler behavior
- API integrations (FoxESS, Amber, Weather)
- Auth flows and middleware
- Route integration tests via supertest

**Run all backend tests:**
```bash
npm --prefix functions test
```

**Run a single file:**
```bash
npm --prefix functions test -- routes-integration.test.js
```

**Coverage (latest run):**
```
Overall: Lines 10.84% (335/3091) | Functions 10.14% (28/276) | Branches 5.58% (132/2365)
root:    Lines 10.63% (273/2569) | Functions  9.13% (20/219) | Branches 5.15% (108/2099)
api:     Lines 13.25% ( 62/468)  | Functions 15.38% ( 8/52)  | Branches 9.64% ( 24/249)
scripts: Lines 0.00% (  0/54)    | Functions  0.00% ( 0/5)   | Branches 0.00% (  0/17)
```

The coverage report is generated at `functions/coverage/index.html`.

---

## 2. Auth Flow Tests (Jest + Emulator)

Some auth tests require the Firebase emulator:
```bash
firebase emulators:start --only auth,firestore,functions
```

Run just the auth suite:
```bash
npm --prefix functions test -- auth-flows.test.js
```

---

## 3. Frontend Tests (Playwright)

**Location:** `tests/frontend/*.spec.js`  
**Run all UI tests:**
```bash
npx playwright test
```

**Run a single spec file:**
```bash
npx playwright test tests/frontend/control.spec.js
```

To list tests:
```bash
npx playwright test --list
```

---

## 4. Test Runner Script (PowerShell)

**File:** `run-tests.ps1`

```powershell
.\run-tests.ps1
.\run-tests.ps1 -Type unit
.\run-tests.ps1 -Type frontend
```

Note: the `-Type e2e` and `-Type integration` modes currently reference missing scripts and will fail until those scripts are added.

---

## CI/CD

Example workflow steps:
```yaml
- name: Install backend deps
  run: npm --prefix functions install

- name: Run backend tests
  run: npm --prefix functions test

- name: Run frontend tests
  run: npx playwright test
```

---

## Troubleshooting

- **Auth tests fail**: ensure the emulator is running and reachable.
- **Playwright fails to launch**: install browsers with `npx playwright install`.
- **Coverage looks low**: coverage includes all JS files under `functions/`, including scripts.
