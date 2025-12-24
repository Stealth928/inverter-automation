# Backend Test Suite (Jest)

This folder contains all backend tests for Cloud Functions.

## What Exists

- Unit and edge-case tests for automation logic
- Integration-style route tests using supertest
- Auth flow tests (require emulator)
- API client tests (Amber, FoxESS, Weather)

## Run Tests

From repo root:
```bash
npm --prefix functions test
```

Run a single file:
```bash
npm --prefix functions test -- routes-integration.test.js
```

## Auth Flow Tests

Some tests require the Firebase emulator:
```bash
firebase emulators:start --only auth,firestore,functions
npm --prefix functions test -- auth-flows.test.js
```

## Notes

- There are no standalone `e2e-tests.js` or `integration-test.js` scripts in this repo.
- See `TESTING_GUIDE.md` for the latest counts and coverage summary.
