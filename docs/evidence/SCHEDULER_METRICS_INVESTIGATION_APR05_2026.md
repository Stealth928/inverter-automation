# Scheduler Metrics Investigation and Recommendations (Apr 5 2026)

Purpose: persist the production investigation into the scheduler alert state, the validated root causes, and the prioritized mitigation ideas.

Related operational references:

- [Scheduler SLO Alert Runbook](../SCHEDULER_SLO_ALERT_RUNBOOK_MAR26.md)
- [Background Automation](../BACKGROUND_AUTOMATION.md)

## Executive Summary

The scheduler looked bad because two different problems were overlapping:

- a historical FoxESS outage window created a concentrated dead-letter spike dominated by one user
- the current residual issue is mostly latency, especially `actionApplyMs`, and many p99 breaches happen on successful runs rather than failures

The latest live window is materially better on error/dead-letter rates, but the day-level alert still shows a breach because the alert model is driven by day aggregates plus a tail overlay.

## Verified Findings

### Current State

- current alert status: `breach`
- breached metric: `p99CycleDurationMs`
- watch metric: `maxCycleDurationMs`
- tail latency status: `healthy`
- 15-minute tail window had 15 observed runs, 0 runs above the tail threshold

Interpretation: the live system had recovered in the near term, but the day-level alert still reflected earlier bad runs.

### Recent Window Health

| Window | Runs | Errors | Dead Letters | p99 > 10s | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| 2h | 120 | 0 | 0 | 7 | action apply dominated 80/120 runs |
| 6h | 360 | 0 | 0 | 24 | action apply dominated 215/360 runs |
| 24h | 1338 | 256 | 256 | 80 | one user dominated dead letters |
| 72h | 4103 | 331 | 331 | 221 | same FoxESS concentration persisted |

Additional ratios that matter:

- 70% of 24h p99 breaches had no errors or dead letters
- 47.5% of 24h p99 breaches had `actionApplyMs` over 10s
- 91.74% of the 2h slow-user sample was FoxESS
- 76.88% of the 24h slow-user sample was FoxESS

### Dead-Letter Concentration

The morning incident was highly concentrated:

- 24h dead letters: 268 total
- one FoxESS user accounted for 252 of them, or 94.03%
- 72h dead letters: 343 total
- the same user accounted for 253 of them, or 73.76%

This is the strongest signal that per-user containment is a high-leverage control.

### Latency Pattern

Tail latency is not just a failure artifact.

- `actionApplyMs` was the dominant phase in most slow runs
- `dataFetchMs` was secondary but still relevant in a small number of outliers
- the largest p99 outliers were often successful runs with long `actionApplyMs`

That means reducing error retries alone will not fix the tail; the apply path itself needs guardrails and idempotency.

### Churn Pattern

The third-pass churn check found repeated same-rule reapply cadence in a top slow-user sample:

- 12 users
- 872 actions considered
- 354 short-gap transitions at or below 6 minutes
- 41.16% short-gap transition rate overall
- 6 of 12 users had at least 30 short-gap transitions
- the median user cadence center was about 603 seconds

Representative repeated rules from the churn sample:

| Rule | Actions | Short-gap transitions <= 6m |
| --- | ---: | ---: |
| Self Use | 80 | 60 |
| Discharge during PEAK (Flow) | 78 | 51 |
| Self use from midnight to 5pm | 57 | 41 |
| Cheap Import Charging | 35 | 30 |
| Expensive Grid Guard | 96 | 27 |

This strongly suggests reapply churn and no-op traffic are contributing to pressure on the tail.

## Prioritized Recommendations

| Priority | Recommendation | Impact | Risk | Why it matters |
| --- | --- | --- | --- | --- |
| 1 | Per-user failure circuit breaker and quarantine | Very high | Medium | One user created most of the dead-letter spike, so containment has immediate SLO benefit |
| 2 | Idempotent action-apply with no-op suppression | Very high | Medium | Many breaches are successful-but-slow runs, and repeated same-rule applies are common |
| 3 | Action-apply latency budgets and retry guardrails | High | Medium | The tail is dominated by long apply calls, not by queue lag |
| 4 | FoxESS outage mode / provider shed mode | High | Medium | FoxESS is the dominant provider in slow and failed cohorts |
| 5 | Preserve upstream error class and errno in dead letters | Medium | Low | Current dead-letter text hides the useful upstream error signal |
| 6 | Split day-level health from rolling health in ops UI | Medium | Low | Prevents the current alert from looking worse than the live near-term state |

## Suggested Rollout Order

1. Add per-user quarantine for repeated failures.
2. Add idempotency checks and no-op suppression in the apply path.
3. Put hard budgets around apply latency and verification retries.
4. Add provider-level shed mode for FoxESS-heavy incidents.
5. Improve dead-letter error fidelity.
6. Separate day-aggregate status from rolling status in the admin view.

## Operational Notes

- Use 2h and 6h windows for live triage.
- Use 24h and 72h windows for blast-radius analysis.
- Treat `alerts/current` as a day-aggregate status, not a pure real-time signal.
- Compare dead letters by user and provider before deciding whether to escalate.

## Interpretation Caveat

The scheduler can be operationally healthier in the last few hours while the current alert still shows a breach. That is expected with the present alert model and should not be read as a contradiction.
