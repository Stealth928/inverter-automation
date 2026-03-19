# Solar Curtailment Quick Start

Last updated: 2026-03-17

## Purpose

This guide explains the current shipped curtailment workflow:

- enable curtailment from Settings
- choose a feed-in price threshold
- understand when the runtime activates or deactivates curtailment
- optionally use the advanced discovery page for support/admin investigation

## What Curtailment Does Today

Curtailment monitors the current feed-in price and toggles export limiting when
your configured threshold is crossed.

In practice:

- if current feed-in price is below your threshold, curtailment can activate
- if current feed-in price rises back above your threshold, curtailment can
  deactivate
- state changes are tracked separately from the main rule winner

This is an operational runtime feature, not just a planning concept.

## Fast Path for Normal Users

### Step 1: Open Settings

Go to `Settings` and find the `Solar Curtailment` section.

### Step 2: Enable Curtailment

Turn curtailment on.

### Step 3: Set the Price Threshold

Choose the feed-in threshold in cents per kWh.

Simple starting guidance:

- below `0`: only react to clearly negative export pricing
- around `0`: react when export is neutral or worse
- above `0`: react earlier and more aggressively

### Step 4: Save Settings

After saving, the background automation cycle uses the threshold in ongoing
runtime evaluation.

### Step 5: Watch Dashboard and Logs

When price crosses the threshold, the dashboard and runtime logs will reflect
curtailment activation or deactivation.

## Recommended Threshold Choices

| Goal | Example threshold |
| --- | --- |
| Avoid negative export pricing | `-10` to `0` |
| Curtail around break-even | `0` to `5` |
| Curtail aggressively in weak export markets | `5` and above |

Choose thresholds carefully. A threshold that sits too close to frequently
oscillating prices can cause more frequent state changes.

## What to Expect at Runtime

Normal behavior looks like this:

- most automation cycles produce no curtailment state change
- curtailment only writes state and sends control updates when a threshold
  crossing occurs
- repeated activation/deactivation on every cycle is a sign that your threshold
  may be too close to a volatile price band

## When to Use Discovery Instead of Settings Alone

Use the advanced discovery page if:

- you suspect AC-coupled or mixed-topology behavior
- export limiting does not behave as expected
- you are troubleshooting provider-specific capability questions
- support/admin needs to inspect low-level behavior beyond the normal settings

## Verification Checklist

After enabling curtailment, verify:

1. settings save successfully
2. curtailment remains enabled after reload
3. current price and threshold relationship make sense
4. runtime logs show stable behavior rather than repeated oscillation
5. dashboard messaging matches the expected active/inactive state

## Related Docs

- [CURTAILMENT_MONITORING_GUIDE.md](CURTAILMENT_MONITORING_GUIDE.md)
- [guides/PRODUCT_GUIDE.md](guides/PRODUCT_GUIDE.md)
- [SETUP.md](SETUP.md)
