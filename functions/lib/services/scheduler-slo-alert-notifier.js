'use strict';

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeAlertStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'breach' || normalized === 'watch') {
    return normalized;
  }
  return 'healthy';
}

function sanitizeMetricList(value) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
}

function buildAlertSignature(alert = {}, status = 'healthy') {
  const schedulerId = String(alert.schedulerId || '').trim() || 'scheduler';
  const breached = sanitizeMetricList(alert.breachedMetrics).sort().join(',');
  const watched = sanitizeMetricList(alert.watchMetrics).sort().join(',');
  return `${status}|${schedulerId}|${breached}|${watched}`;
}

function buildAlertText(alert = {}, status = 'healthy') {
  const severity = status.toUpperCase();
  const schedulerId = String(alert.schedulerId || '').trim() || 'scheduler';
  const measured = alert.measurements || {};
  const errorRate = toFiniteNumber(measured.errorRatePct, 0).toFixed(2);
  const deadRate = toFiniteNumber(measured.deadLetterRatePct, 0).toFixed(2);
  const queueLag = Math.round(toFiniteNumber(measured.maxQueueLagMs, 0));
  const cycleDuration = Math.round(toFiniteNumber(measured.maxCycleDurationMs, 0));
  const breached = sanitizeMetricList(alert.breachedMetrics);
  const watched = sanitizeMetricList(alert.watchMetrics);
  const metricTags = [
    ...breached.map((metric) => `breach:${metric}`),
    ...watched.map((metric) => `watch:${metric}`)
  ];
  const metricSuffix = metricTags.length > 0 ? ` [${metricTags.join(', ')}]` : '';
  return `[SchedulerSLO] ${severity}${metricSuffix} scheduler=${schedulerId} error=${errorRate}% dead=${deadRate}% queueLagMs=${queueLag} cycleDurationMs=${cycleDuration}`;
}

function createSchedulerSloAlertNotifier(deps = {}) {
  const logger = deps.logger || console;
  const fetchImpl = typeof deps.fetchImpl === 'function'
    ? deps.fetchImpl
    : (typeof fetch === 'function' ? fetch : null);
  const webhookUrl = String(
    deps.webhookUrl ||
      process.env.AUTOMATION_SCHEDULER_SLO_ALERT_WEBHOOK_URL ||
      ''
  ).trim();
  const cooldownMs = Math.max(
    0,
    toFiniteNumber(
      deps.cooldownMs != null
        ? deps.cooldownMs
        : process.env.AUTOMATION_SCHEDULER_SLO_ALERT_COOLDOWN_MS,
      300000
    )
  );

  let lastSignature = null;
  let lastSentAtMs = 0;

  async function notifySchedulerSloAlert(alert = {}) {
    const status = normalizeAlertStatus(alert.alertStatus || alert.status);
    if (status === 'healthy') {
      return { delivered: false, reason: 'healthy_status' };
    }

    const nowMs = Date.now();
    const signature = buildAlertSignature(alert, status);
    const elapsedMs = nowMs - lastSentAtMs;
    if (
      cooldownMs > 0 &&
      lastSignature === signature &&
      elapsedMs >= 0 &&
      elapsedMs < cooldownMs
    ) {
      return {
        delivered: false,
        reason: 'cooldown_active',
        cooldownRemainingMs: cooldownMs - elapsedMs
      };
    }

    const text = buildAlertText(alert, status);
    const payload = {
      text,
      schedulerSloAlert: {
        status,
        dayKey: alert.dayKey || null,
        runId: alert.runId || null,
        schedulerId: alert.schedulerId || null,
        breachedMetrics: sanitizeMetricList(alert.breachedMetrics),
        watchMetrics: sanitizeMetricList(alert.watchMetrics),
        monitoredAtMs: toFiniteNumber(alert.monitoredAtMs, 0),
        measurements: alert.measurements && typeof alert.measurements === 'object'
          ? alert.measurements
          : {},
        thresholds: alert.thresholds && typeof alert.thresholds === 'object'
          ? alert.thresholds
          : {}
      }
    };

    if (!webhookUrl || !fetchImpl) {
      if (logger && typeof logger.warn === 'function') {
        const reason = !webhookUrl ? 'missing webhook URL' : 'fetch unavailable';
        logger.warn(`[SchedulerSLO] ${text} (notification skipped: ${reason})`);
      }
      return {
        delivered: false,
        reason: !webhookUrl ? 'no_webhook_url' : 'fetch_unavailable'
      };
    }

    try {
      const response = await fetchImpl(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response || response.ok !== true) {
        const statusCode = response ? Number(response.status || 0) : 0;
        if (logger && typeof logger.warn === 'function') {
          logger.warn(`[SchedulerSLO] webhook delivery failed status=${statusCode}`);
        }
        return {
          delivered: false,
          reason: 'webhook_http_error',
          statusCode
        };
      }

      lastSignature = signature;
      lastSentAtMs = nowMs;
      if (logger && typeof logger.log === 'function') {
        logger.log(`[SchedulerSLO] webhook delivered (${status})`);
      }
      return { delivered: true };
    } catch (error) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn(`[SchedulerSLO] webhook delivery exception: ${error.message}`);
      }
      return {
        delivered: false,
        reason: 'webhook_exception',
        error: error.message
      };
    }
  }

  return {
    notifySchedulerSloAlert
  };
}

module.exports = {
  createSchedulerSloAlertNotifier
};
