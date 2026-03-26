'use strict';

const fetch = global.fetch;

if (typeof fetch !== 'function') {
  throw new Error('Global fetch is not available in this runtime.');
}

function getRuntimeProjectId(admin) {
  try {
    return process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || admin.app().options.projectId || null;
  } catch (error) {
    return process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || null;
  }
}

function getPointNumericValue(point) {
  if (!point || !point.value) return 0;
  const value = point.value;
  if (typeof value.doubleValue === 'number') return value.doubleValue;
  if (typeof value.int64Value === 'string') return Number(value.int64Value) || 0;
  if (typeof value.int64Value === 'number') return value.int64Value;
  if (typeof value.distributionValue?.count === 'number') return value.distributionValue.count;
  return 0;
}

async function listMonitoringTimeSeries({
  monitoring,
  projectId,
  filter,
  startTime,
  endTime,
  aligner = 'ALIGN_SUM',
  alignmentPeriod = '3600s'
}) {
  const name = `projects/${projectId}`;
  let pageToken;
  const pointByTimestamp = new Map();

  do {
    const response = await monitoring.projects.timeSeries.list({
      name,
      filter,
      'interval.startTime': startTime.toISOString(),
      'interval.endTime': endTime.toISOString(),
      'aggregation.alignmentPeriod': alignmentPeriod,
      'aggregation.perSeriesAligner': aligner,
      'aggregation.crossSeriesReducer': 'REDUCE_SUM',
      'aggregation.groupByFields': [],
      view: 'FULL',
      pageSize: 1000,
      pageToken
    });

    const timeSeries = response && response.data && Array.isArray(response.data.timeSeries)
      ? response.data.timeSeries
      : [];

    for (const series of timeSeries) {
      const points = Array.isArray(series && series.points) ? series.points : [];
      for (const point of points) {
        const ts = point?.interval?.endTime || point?.interval?.startTime;
        if (!ts) continue;
        const current = pointByTimestamp.get(ts) || 0;
        pointByTimestamp.set(ts, current + getPointNumericValue(point));
      }
    }

    pageToken = response && response.data ? response.data.nextPageToken : undefined;
  } while (pageToken);

  return Array.from(pointByTimestamp.entries())
    .map(([timestamp, value]) => ({ timestamp, value }))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function sumSeriesValues(series) {
  return series.reduce((sum, point) => sum + (Number(point.value) || 0), 0);
}

function normalizeMetricErrorMessage(error) {
  const raw = String((error && error.message) || error || 'metric unavailable');
  const stripped = raw.split('If a metric was created recently')[0].trim();
  return stripped.replace(/\s+/g, ' ');
}

async function getRuntimeServiceAccountEmail(projectId) {
  const fallback = `${projectId || 'PROJECT_NUMBER'}-compute@developer.gserviceaccount.com`;

  try {
    const metadataResp = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email',
      {
        headers: { 'Metadata-Flavor': 'Google' },
        timeout: 1500
      }
    );

    if (metadataResp.ok) {
      const email = String(await metadataResp.text()).trim();
      if (email) return email;
    }
  } catch (error) {
    // local emulator and unit tests do not expose the metadata server
  }

  return fallback;
}

function estimateFirestoreCostFromUsage(readsMtd, writesMtd, deletesMtd, nowDate) {
  const dayOfMonth = Math.max(1, nowDate.getUTCDate());
  const freeReads = 50000 * dayOfMonth;
  const freeWrites = 20000 * dayOfMonth;
  const freeDeletes = 20000 * dayOfMonth;

  const billableReads = Math.max(0, readsMtd - freeReads);
  const billableWrites = Math.max(0, writesMtd - freeWrites);
  const billableDeletes = Math.max(0, deletesMtd - freeDeletes);

  const readCost = (billableReads / 100000) * 0.06;
  const writeCost = (billableWrites / 100000) * 0.18;
  const deleteCost = (billableDeletes / 100000) * 0.02;

  return {
    totalUsd: readCost + writeCost + deleteCost,
    isEstimate: true,
    services: [
      { service: 'Cloud Firestore reads', costUsd: readCost },
      { service: 'Cloud Firestore writes', costUsd: writeCost },
      { service: 'Cloud Firestore deletes', costUsd: deleteCost }
    ]
  };
}

const FIRESTORE_DAILY_FREE_TIER = Object.freeze({
  reads: 50000,
  writes: 20000,
  deletes: 20000
});

function sumTrailingWindow(series = [], trailingMs, nowMs = Date.now()) {
  if (!Array.isArray(series) || trailingMs <= 0) return 0;
  const windowStartMs = nowMs - trailingMs;
  return series.reduce((sum, point) => {
    const timestampMs = new Date(point?.timestamp || 0).getTime();
    if (!Number.isFinite(timestampMs) || timestampMs < windowStartMs || timestampMs > nowMs) {
      return sum;
    }
    return sum + Number(point?.value || 0);
  }, 0);
}

function describeQuotaStatus(utilizationPct) {
  const value = Number(utilizationPct || 0);
  if (value >= 90) return 'breach';
  if (value >= 70) return 'watch';
  return 'healthy';
}

function buildQuotaMetricSummary({ key, label, last24Hours, mtd, dayOfMonth, daysInMonth }) {
  const dailyFreeTier = Number(FIRESTORE_DAILY_FREE_TIER[key] || 0);
  const monthToDateAllowance = dailyFreeTier * dayOfMonth;
  const projectedMonthEnd = dayOfMonth > 0 ? Math.round((Number(mtd || 0) / dayOfMonth) * daysInMonth) : 0;
  const last24HoursUtilizationPct = dailyFreeTier > 0 ? Number(((Number(last24Hours || 0) / dailyFreeTier) * 100).toFixed(1)) : null;
  const projectedMonthEndUtilizationPct = monthToDateAllowance > 0
    ? Number(((projectedMonthEnd / (dailyFreeTier * daysInMonth)) * 100).toFixed(1))
    : null;
  return {
    key,
    label,
    dailyFreeTier,
    monthToDateAllowance,
    monthToDateUsage: Math.round(Number(mtd || 0)),
    last24Hours: Math.round(Number(last24Hours || 0)),
    last24HoursUtilizationPct,
    projectedMonthEnd,
    projectedMonthEndUtilizationPct,
    status: describeQuotaStatus(last24HoursUtilizationPct)
  };
}

function buildFirestoreQuotaSummary({ deletesMtd, deletesSeries, nowDate = new Date(), readsMtd, readsSeries, writesMtd, writesSeries }) {
  const nowMs = nowDate.getTime();
  const dayOfMonth = Math.max(1, nowDate.getUTCDate());
  const daysInMonth = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() + 1, 0)).getUTCDate();
  const trailing24hMs = 24 * 60 * 60 * 1000;

  const metrics = [
    buildQuotaMetricSummary({
      key: 'reads',
      label: 'Reads',
      last24Hours: sumTrailingWindow(readsSeries, trailing24hMs, nowMs),
      mtd: readsMtd,
      dayOfMonth,
      daysInMonth
    }),
    buildQuotaMetricSummary({
      key: 'writes',
      label: 'Writes',
      last24Hours: sumTrailingWindow(writesSeries, trailing24hMs, nowMs),
      mtd: writesMtd,
      dayOfMonth,
      daysInMonth
    }),
    buildQuotaMetricSummary({
      key: 'deletes',
      label: 'Deletes',
      last24Hours: sumTrailingWindow(deletesSeries, trailing24hMs, nowMs),
      mtd: deletesMtd,
      dayOfMonth,
      daysInMonth
    })
  ];

  const alerts = metrics
    .filter((metric) => metric.status !== 'healthy')
    .map((metric) => ({
      code: `firestore_${metric.key}_${metric.status}`,
      metric: metric.key,
      severity: metric.status,
      message: `${metric.label} last-24h usage is ${metric.last24HoursUtilizationPct}% of the daily free-tier allowance.`
    }));

  const overallStatus = alerts.some((alert) => alert.severity === 'breach')
    ? 'breach'
    : (alerts.length ? 'watch' : 'healthy');

  return {
    alerts,
    dailyFreeTier: { ...FIRESTORE_DAILY_FREE_TIER },
    generatedAt: nowDate.toISOString(),
    metrics,
    overallStatus
  };
}

async function fetchCloudBillingCost(projectId, options = {}) {
  const googleApis = options.googleApis;
  if (!googleApis) throw new Error('googleapis not available');

  const runtimeServiceAccount = await getRuntimeServiceAccountEmail(projectId);

  const auth = new googleApis.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-billing.readonly']
  });
  const client = await auth.getClient();
  const tokenResp = await client.getAccessToken();
  const token = tokenResp.token;

  const billingInfoResp = await fetch(
    `https://cloudbilling.googleapis.com/v1/projects/${projectId}/billingInfo`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (billingInfoResp.status === 403) {
    const bodyText = await billingInfoResp.text().catch(() => '');
    const disabledApi = /SERVICE_DISABLED|Cloud Billing API has not been used|cloudbilling\.googleapis\.com/i.test(bodyText);
    if (disabledApi) {
      const err = new Error(
        'BILLING_API_DISABLED: Enable cloudbilling.googleapis.com for this project, then retry.'
      );
      err.isBillingApiDisabled = true;
      throw err;
    }

    const err = new Error(
      'BILLING_IAM: Grant roles/billing.viewer on the billing account to the Functions service account ' +
      `(${runtimeServiceAccount}). ` +
      'See GCP IAM -> Billing Account -> Add Principal.'
    );
    err.isBillingIamError = true;
    throw err;
  }

  if (!billingInfoResp.ok) {
    throw new Error(`billingInfo: ${billingInfoResp.status} ${billingInfoResp.statusText}`);
  }

  const billingInfo = await billingInfoResp.json();
  if (!billingInfo.billingEnabled || !billingInfo.billingAccountName) {
    throw new Error('No billing account is linked to this project');
  }

  const accountName = billingInfo.billingAccountName;
  const accountId = accountName.replace('billingAccounts/', '');

  const now = new Date();
  const params = new URLSearchParams({
    'dateRange.startDate.year': now.getUTCFullYear(),
    'dateRange.startDate.month': now.getUTCMonth() + 1,
    'dateRange.startDate.day': 1,
    'dateRange.endDate.year': now.getUTCFullYear(),
    'dateRange.endDate.month': now.getUTCMonth() + 1,
    'dateRange.endDate.day': now.getUTCDate()
  });

  const reportsResp = await fetch(
    `https://cloudbilling.googleapis.com/v1beta/${accountName}/reports?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (reportsResp.status === 403) {
    const bodyText = await reportsResp.text().catch(() => '');
    const disabledApi = /SERVICE_DISABLED|Cloud Billing API has not been used|cloudbilling\.googleapis\.com/i.test(bodyText);
    if (disabledApi) {
      const err = new Error(
        'BILLING_API_DISABLED: Enable cloudbilling.googleapis.com for this project, then retry.'
      );
      err.isBillingApiDisabled = true;
      throw err;
    }

    const err = new Error(
      'BILLING_IAM: Grant roles/billing.viewer on the billing account to the Functions service account ' +
      `(${runtimeServiceAccount}) to read cost reports.`
    );
    err.isBillingIamError = true;
    throw err;
  }

  if (reportsResp.status === 404) {
    const err = new Error('BILLING_REPORTS_UNAVAILABLE: Cloud Billing reports endpoint is not available for this billing account/project.');
    err.isBillingReportsUnavailable = true;
    throw err;
  }

  if (!reportsResp.ok) {
    const body = await reportsResp.text().catch(() => '');
    throw new Error(`billing reports: ${reportsResp.status} - ${body.substring(0, 300)}`);
  }

  const reportsJson = await reportsResp.json();
  console.log('[Admin] Cloud Billing reports response keys:', Object.keys(reportsJson));

  const toUsd = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (typeof value === 'object') {
      if (value.amount !== undefined) return toUsd(value.amount);
      if (value.value !== undefined) return toUsd(value.value);
      if (value.doubleValue !== undefined) return toUsd(value.doubleValue);
      if (value.units !== undefined || value.nanos !== undefined) {
        const units = Number(value.units || 0);
        const nanos = Number(value.nanos || 0);
        const total = units + (nanos / 1e9);
        return Number.isFinite(total) ? total : null;
      }
      if (value.currencyAmount !== undefined) return toUsd(value.currencyAmount);
    }
    return null;
  };

  const getServiceName = (obj) => {
    if (!obj || typeof obj !== 'object') return '';

    const explicit =
      obj.serviceDisplayName ||
      obj.serviceName ||
      obj.service ||
      obj.displayName ||
      obj.cloudServiceId ||
      '';
    if (explicit && typeof explicit === 'string') return explicit;

    if (Array.isArray(obj.dimensionValues)) {
      const namedService = obj.dimensionValues.find((dimension) => {
        const key = String(dimension?.dimension || dimension?.name || dimension?.key || '').toLowerCase();
        return key.includes('service');
      });

      if (namedService) {
        const value = namedService.value || namedService.stringValue || namedService.displayName;
        if (typeof value === 'string' && value.trim()) return value.trim();
      }

      const firstString = obj.dimensionValues
        .map((dimension) => dimension?.value || dimension?.stringValue || dimension?.displayName)
        .find((value) => typeof value === 'string' && value.trim());
      if (firstString) return firstString.trim();
    }

    if (Array.isArray(obj.cells) && obj.cells.length) {
      const firstStringCell = obj.cells
        .map((cell) => cell?.value || cell?.stringValue || cell?.displayName || cell?.text)
        .find((value) => typeof value === 'string' && value.trim());
      if (firstStringCell) return firstStringCell.trim();
    }

    return '';
  };

  const getCostValue = (obj) => {
    if (!obj || typeof obj !== 'object') return null;

    const candidates = [
      obj.cost,
      obj.totalCost,
      obj.aggregatedCost,
      obj.totalCostAmount,
      obj.costAmount,
      obj.amount,
      obj.metricValue,
      obj.value
    ];
    for (const candidate of candidates) {
      const parsed = toUsd(candidate);
      if (parsed !== null) return parsed;
    }

    if (Array.isArray(obj.metricValues)) {
      for (const metricValue of obj.metricValues) {
        const parsed = toUsd(metricValue);
        if (parsed !== null) return parsed;
      }
    }

    if (Array.isArray(obj.cells)) {
      for (const cell of obj.cells) {
        const parsed = toUsd(cell);
        if (parsed !== null) return parsed;
      }
    }

    return null;
  };

  const serviceTotals = new Map();
  const totalFallbacks = [];

  const addServiceCost = (serviceName, amount) => {
    if (!serviceName || !Number.isFinite(amount) || amount <= 0) return;
    const current = serviceTotals.get(serviceName) || 0;
    serviceTotals.set(serviceName, current + amount);
  };

  const walk = (node) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry);
      return;
    }
    if (typeof node !== 'object') return;

    const serviceName = getServiceName(node);
    const costValue = getCostValue(node);
    if (serviceName && costValue !== null) {
      addServiceCost(serviceName, costValue);
    } else if (!serviceName && costValue !== null) {
      totalFallbacks.push(costValue);
    }

    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === 'object') {
        walk(value);
      } else if (typeof value !== 'object') {
        const keyLower = key.toLowerCase();
        if ((keyLower.includes('total') || keyLower.includes('cost')) && value !== null && value !== undefined) {
          const parsed = toUsd(value);
          if (parsed !== null) totalFallbacks.push(parsed);
        }
      }
    }
  };

  walk(reportsJson);

  const services = Array.from(serviceTotals.entries())
    .map(([service, costUsd]) => ({ service, costUsd }))
    .sort((a, b) => b.costUsd - a.costUsd);

  let totalUsd = services.reduce((sum, entry) => sum + entry.costUsd, 0);
  if ((!Number.isFinite(totalUsd) || totalUsd <= 0) && totalFallbacks.length) {
    const bestTotal = Math.max(...totalFallbacks.filter((value) => Number.isFinite(value) && value > 0));
    if (Number.isFinite(bestTotal) && bestTotal > 0) {
      totalUsd = bestTotal;
    }
  }

  if (!services.length && !totalUsd) {
    console.log('[Admin] Cloud Billing reports raw JSON (unparsed):', JSON.stringify(reportsJson).substring(0, 1500));
  }

  return {
    services,
    totalUsd: Number.isFinite(totalUsd) && totalUsd > 0 ? totalUsd : null,
    accountId,
    raw: reportsJson
  };
}

module.exports = {
  buildFirestoreQuotaSummary,
  estimateFirestoreCostFromUsage,
  fetchCloudBillingCost,
  getRuntimeProjectId,
  getRuntimeServiceAccountEmail,
  listMonitoringTimeSeries,
  normalizeMetricErrorMessage,
  sumSeriesValues
};
