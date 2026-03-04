# Phase Gate Dashboard

- Status: Active tracker
- Owner: RefactoringMar26
- Related Plan: `docs/REFACTORING_IMPLEMENTATION_PLAN_MAR26.md` (Sprint 1 item 19)

## Label Strategy

Use one phase label and one gate label on each tracking issue.

Phase labels:
- `P0`
- `P1`
- `P2`
- `P3`
- `P4`
- `P5`
- `P6`

Gate labels:
- `G0`
- `G1`
- `G2`
- `G3`
- `G4`
- `G5`
- `G6`

Shared label:
- `phase-gate`

## Suggested GitHub Searches

- `is:open is:issue label:phase-gate label:P0`
- `is:open is:issue label:phase-gate label:G0`
- `is:open is:issue label:phase-gate label:P0 label:G0`
- `is:open is:issue label:phase-gate label:G0 sort:updated-desc`

## Dashboard Table (manual update)

| Phase | Gate | Owner | Issue Link | Status | Last Update |
|---|---|---|---|---|---|
| P0 | G0 | RefactoringMar26 | [Create P0/G0 tracker](https://github.com/Stealth928/inverter-automation/issues/new?template=phase-gate-tracker.md&title=P0%20-%20G0%20Tracker&labels=phase-gate,P0,G0) | Completed | 2026-03-04 |
| P1 | G1 | RefactoringMar26 | [Create P1/G1 tracker](https://github.com/Stealth928/inverter-automation/issues/new?template=phase-gate-tracker.md&title=P1%20-%20G1%20Tracker&labels=phase-gate,P1,G1) | In Progress | 2026-03-05 |
| P2 | G2 | TBD | - | Pending | - |
| P3 | G3 | TBD | - | Pending | - |
| P4 | G4 | TBD | - | Pending | - |
| P5 | G5 | TBD | - | Pending | - |
| P6 | G6 | TBD | - | Pending | - |

## Usage Notes

1. Open one tracking issue per active phase/gate pair.
2. Keep acceptance criteria in the issue body.
3. Update issue weekly in implementation sync.
4. Close phase issue only after gate criteria are verified.
5. GitHub CLI (`gh`) is not installed in this local environment; use the prefilled links above to create issues quickly.
