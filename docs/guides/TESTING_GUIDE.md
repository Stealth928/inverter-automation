# Testing Guide

Purpose: canonical test execution reference.
Last verified: 2026-03-26

## 1. Test Tracks

Current repo test tracks:

- Backend Jest suites: `functions/test/*.test.js`
- Frontend Playwright specs: `tests/frontend/*.spec.js`
- Root Node contract/unit tests: `tests/scripts/*.test.js`

Current snapshot:

- backend Jest suite files: `113`
- frontend Playwright spec files: `20`
- root script test files: `5`
- Playwright listed tests: `261`

Refresh inventory:

```bash
npm --prefix functions test -- --listTests
npx playwright test --list
Get-ChildItem tests/scripts -Filter *.test.js
```

## 2. Backend (Jest)

Run all backend tests:

```bash
npm --prefix functions test
```

Run deterministically in one process:

```bash
npm --prefix functions test -- --runInBand
```

Run a single file:

```bash
npm --prefix functions test -- automation-cycle-route-module.test.js
```

Coverage:

```bash
npm --prefix functions test -- --coverage
```

## 3. Frontend (Playwright)

Run all frontend tests:

```bash
npm run test:e2e:frontend
```

Run smoke tests only:

```bash
npm run test:e2e:frontend:smoke
```

Run a single spec:

```bash
npx playwright test tests/frontend/market-insights.spec.js
```

List tests:

```bash
npx playwright test --list
```

## 4. Root Contract and Release Tests

Market-insights data bundle contracts:

```bash
npm run test:market-insights:contracts
```

PWA version contract:

```bash
npm run test:pwa:versions
```

Release-manifest contract:

```bash
npm run test:release:manifest
```

## 5. Contract Checks

API route parity:

```bash
npm run api:contract:check
```

Refresh generated API baseline:

```bash
npm run api:contract:refresh
```

OpenAPI parity:

```bash
npm run openapi:check
```

Repo hygiene:

```bash
npm run hygiene:check
```

## 6. PowerShell Runner

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

- `unit` is an alias for backend Jest tests
- `auth` tests require emulators

## 7. Emulator-dependent Flows

Start emulators first:

```bash
npm run emu:start
```

Then run emulator-sensitive tests or flows such as auth-focused backend tests.

Recommended reset when local state is suspicious:

```bash
npm run emu:reset
```

## 8. Recommended CI / Release Set

Minimum merge or release checks:

- `npm --prefix functions run lint`
- `npm --prefix functions test -- --runInBand`
- `npm run api:contract:check`
- `npm run openapi:check`
- `npm run hygiene:check`
- `npm run test:market-insights:contracts`
- `npm run test:pwa:versions`
- `npm run test:release:manifest`

When frontend changed, also run:

- `npm run test:e2e:frontend`

## 9. Troubleshooting

- Playwright browser missing:
  - `npx playwright install`
- emulator state looks stale:
  - `npm run emu:reset`
- local Hosting/PWA behavior looks inconsistent:
  - clear service worker/cache and rerun the PWA version contract
