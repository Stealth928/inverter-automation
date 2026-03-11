# Testing Guide

Purpose: canonical test execution reference.
Last verified: 2026-03-11

## 1. Test Tracks

- Backend: Jest (`functions/test/*.test.js`)
- Frontend: Playwright (`tests/frontend/*.spec.js`)

Current snapshot (2026-03-11):
- Jest test files: 99
- Backend run (`--runInBand`): 99 suites, 1352 tests passing
- Playwright spec files: 13
- Playwright listed tests: 201

Refresh inventory:

```bash
npm --prefix functions test -- --listTests
npx playwright test --list
```

## 2. Backend (Jest)

Run all backend tests:

```bash
npm --prefix functions test
```

Run deterministically in one process (good for release checks):

```bash
npm --prefix functions test -- --runInBand
```

Run one file:

```bash
npm --prefix functions test -- routes-integration.test.js
```

Coverage:

```bash
npm --prefix functions test -- --coverage
```

## 3. Frontend (Playwright)

Run all:

```bash
npm run test:e2e:frontend
```

Run one spec:

```bash
npx playwright test tests/frontend/control.spec.js
```

List tests:

```bash
npx playwright test --list
```

## 4. PowerShell Runner

File: `run-tests.ps1`

Supported modes:

```powershell
.\run-tests.ps1
.\run-tests.ps1 -Type backend
.\run-tests.ps1 -Type frontend
.\run-tests.ps1 -Type unit
.\run-tests.ps1 -Type auth
.\run-tests.ps1 -Type backend -Coverage
```

Notes:
- `unit` is an alias for backend Jest tests.
- `auth` tests require emulators.

## 5. Emulator-Dependent Auth Tests

Start emulators first:

```bash
npm run emu:start
```

Then run auth flows:

```bash
npm --prefix functions test -- auth-flows.test.js
```

## 6. CI Alignment

Minimum CI checks for merges to `main`:
- `npm --prefix functions run lint`
- `npm --prefix functions test`
- `npm run api:contract:check`
- `npm run openapi:check`
- `npm run hygiene:check`

When frontend is changed, include:
- `npm run test:e2e:frontend`

## 7. Troubleshooting

- Emulator startup fails with Java runtime errors on macOS:
  - `export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"`
  - `export JAVA_HOME="/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home"`
- Playwright browser missing:
  - `npx playwright install`
- Flaky local state:
  - use deterministic reset: `npm run emu:reset`
