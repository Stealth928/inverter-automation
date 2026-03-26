const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

function jsonResponse(payload, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload)
  };
}

async function mockAdminEnvironment(page, options = {}) {
  const behaviorResult = options.behaviorResult || {
    configured: false,
    source: 'ga4-data-api',
    updatedAt: new Date().toISOString(),
    window: { days: 30, startDate: '30daysAgo', endDate: 'today' },
    warnings: ['GA4 property id not configured on server'],
    setup: {
      requiredEnv: 'GA4_PROPERTY_ID',
      message: 'Set GA4_PROPERTY_ID to the numeric Google Analytics 4 property id for your web property to enable the Behaviour tab.'
    }
  };
  const apiHealthResult = options.apiHealthResult || {
    source: 'metrics-rollups+cloud-functions-monitoring',
    updatedAt: new Date().toISOString(),
    window: { days: 30 },
    summary: {
      totalCalls: 1240,
      lastDayCalls: 88,
      callsAvg7d: 73.4,
      dominantProvider: { key: 'foxess', label: 'FoxESS', sharePct: 52.4 },
      callsPerExecution: 1.78,
      healthStatus: 'warn'
    },
    monitoring: {
      available: true,
      requestExecutionsTotal: 696,
      errorExecutionsTotal: 14,
      errorRatePct: 2.01
    },
    providers: [
      { key: 'foxess', label: 'FoxESS', totalCalls: 650, sharePct: 52.4, lastDayCalls: 41, avgDailyCalls7d: 34.2, trendPct: 42.1 },
      { key: 'amber', label: 'Amber', totalCalls: 310, sharePct: 25.0, lastDayCalls: 21, avgDailyCalls7d: 17.2, trendPct: 18.3 },
      { key: 'weather', label: 'Weather', totalCalls: 190, sharePct: 15.3, lastDayCalls: 15, avgDailyCalls7d: 11.4, trendPct: 4.5 },
      { key: 'ev', label: 'Tesla EV', totalCalls: 90, sharePct: 7.3, lastDayCalls: 11, avgDailyCalls7d: 10.6, trendPct: 87.4 }
    ],
    daily: [
      { date: '2026-03-20', totalCalls: 61, categories: { inverter: 35, amber: 14, weather: 7, ev: 5 }, evBreakdown: { wake: 2, vehicleData: 3 }, requestExecutions: 34, errorExecutions: 0 },
      { date: '2026-03-21', totalCalls: 75, categories: { inverter: 42, amber: 18, weather: 9, ev: 6 }, evBreakdown: { wake: 1, command: 2, vehicleData: 3 }, requestExecutions: 39, errorExecutions: 1 },
      { date: '2026-03-22', totalCalls: 88, categories: { inverter: 48, amber: 21, weather: 8, ev: 11 }, evBreakdown: { wake: 2, command: 4, vehicleData: 5 }, requestExecutions: 44, errorExecutions: 2 }
    ],
    alerts: [
      {
        level: 'warn',
        code: 'potential_overage_foxess',
        title: 'FoxESS usage acceleration',
        detail: 'Latest 7-day average is 34/day, up 42.1% versus the prior week. Treat this as a potential overage or rate-limit risk if that provider has tight quotas.'
      }
    ],
    warnings: [],
    observability: {
      alphaess: {
        enabled: true,
        liveRealtimeLogging: 'suspicious-only',
        manualDiagnosticsLogging: 'always',
        extraProviderCallsPerRequest: 0,
        extraFirestoreWritesPerRequest: 0,
        notes: [
          'Diagnostics are computed in-memory from existing AlphaESS responses.',
          'GET /api/inverter/real-time only emits logs when an anomaly is detected.'
        ],
        watchWhen: [
          'Immediately after deploying AlphaESS normalization, battery-sign, or topology changes.',
          'When support reports negative house load, impossible export, or missing temperature sensors.'
        ],
        anomalyCodes: [
          {
            code: 'negative-load-power',
            title: 'Negative house load',
            lookFor: 'loadPower is below zero; treat the load channel as semantically suspect for that reading.'
          },
          {
            code: 'power-unit-normalization-ambiguity',
            title: 'Unit ambiguity',
            lookFor: 'strict watt conversion and heuristic conversion disagree materially; compare selectedKw vs heuristic values.'
          }
        ],
        rollback: {
          summary: 'Reversal is code-only. Remove the helper wiring from the runtime routes and admin panel, then redeploy.',
          docsPath: 'docs/ALPHAESS_OBSERVABILITY_RUNBOOK_MAR26.md'
        }
      }
    }
  };
  const schedulerResult = options.schedulerResult || {
    updatedAt: '2026-03-25T04:47:38.000Z',
    summary: {
      runs: 18800,
      cyclesRun: 172000,
      errors: 403,
      deadLetters: 402,
      retries: 406,
      errorRatePct: 0.23,
      deadLetterRatePct: 0.23,
      maxQueueLagMs: 29800,
      maxCycleDurationMs: 94000,
      maxTelemetryAgeMs: 5617000,
      p95CycleDurationMs: 50600,
      p99CycleDurationMs: 78000,
      avgQueueLagMs: 1200,
      avgCycleDurationMs: 1500,
      skipped: { locked: 600, idempotent: 0, disabledOrBlackout: 0, tooSoon: 0 },
      telemetryPauseReasons: { stale_telemetry: 5, stale_telemetry_missing_timestamp: 2 }
    },
    last24hSummary: {
      runs: 1400,
      cyclesRun: 14000,
      errors: 5,
      deadLetters: 5,
      retries: 5,
      errorRatePct: 0.04,
      deadLetterRatePct: 0.04,
      maxQueueLagMs: 5200,
      maxCycleDurationMs: 94000,
      maxTelemetryAgeMs: 4350000,
      p95CycleDurationMs: 11000,
      p99CycleDurationMs: 78000,
      avgQueueLagMs: 1200,
      avgCycleDurationMs: 1700,
      telemetryPauseReasons: { stale_telemetry: 2, stale_telemetry_missing_timestamp: 1 }
    },
    daily: [
      {
        dayKey: '2026-03-25',
        runs: 1400,
        cyclesRun: 14000,
        errors: 5,
        deadLetters: 5,
        retries: 5,
        maxQueueLagMs: 5200,
        maxCycleDurationMs: 94000,
        maxTelemetryAgeMs: 4350000,
        p95CycleDurationMs: 11000,
        p99CycleDurationMs: 78000,
        avgQueueLagMs: 1200,
        avgCycleDurationMs: 1700,
        skipped: { locked: 0, idempotent: 0, disabledOrBlackout: 0, tooSoon: 0 },
        telemetryPauseReasons: { stale_telemetry: 2, stale_telemetry_missing_timestamp: 1 },
        phaseTimingsMaxMs: { dataFetchMs: 800, ruleEvalMs: 30, actionApplyMs: 1200, curtailmentMs: 400 }
      }
    ],
    recentRuns: [
      {
        runId: 'run-1',
        dayKey: '2026-03-25',
        schedulerId: 'sched-a',
        workerId: 'worker-a',
        startedAtMs: Date.parse('2026-03-25T04:47:01.000Z'),
        completedAtMs: Date.parse('2026-03-25T04:47:03.000Z'),
        durationMs: 2000,
        cycleCandidates: 10,
        cyclesRun: 10,
        errors: 0,
        deadLetters: 0,
        retries: 0,
        skipped: { locked: 0, idempotent: 0, disabledOrBlackout: 0, tooSoon: 0 },
        queueLagMs: { avgMs: 1200, count: 10, maxMs: 5200, minMs: 100, p95Ms: 5000, p99Ms: 5200 },
        cycleDurationMs: { avgMs: 1700, count: 10, maxMs: 94000, minMs: 1000, p95Ms: 11000, p99Ms: 78000 },
        telemetryAgeMs: { avgMs: 180000, count: 9, maxMs: 4350000, minMs: 12000, p95Ms: 3600000, p99Ms: 4350000 },
        telemetryPauseReasons: { stale_telemetry: 2, stale_telemetry_missing_timestamp: 1 },
        phaseTimingsMs: {
          dataFetchMs: { avgMs: 20, count: 10, maxMs: 800, minMs: 5, p95Ms: 80, p99Ms: 800 },
          ruleEvalMs: { avgMs: 8, count: 10, maxMs: 30, minMs: 1, p95Ms: 20, p99Ms: 30 },
          actionApplyMs: { avgMs: 12, count: 10, maxMs: 1200, minMs: 2, p95Ms: 90, p99Ms: 1200 },
          curtailmentMs: { avgMs: 6, count: 10, maxMs: 400, minMs: 1, p95Ms: 60, p99Ms: 400 }
        }
      }
    ],
    currentAlert: {
      runId: 'run-1',
      schedulerId: 'sched-a',
      status: 'breach',
      thresholds: {
        errorRatePct: 1,
        deadLetterRatePct: 0.2,
        maxQueueLagMs: 120000,
        maxCycleDurationMs: 20000,
        maxTelemetryAgeMs: 1800000,
        p99CycleDurationMs: 10000,
        tailP99CycleDurationMs: 10000,
        tailWindowMinutes: 15,
        tailMinRuns: 10
      },
      tailLatency: {
        metric: 'sustainedP99CycleDurationMs',
        status: 'healthy',
        thresholdMs: 10000,
        windowMinutes: 15,
        minRuns: 10,
        observedRuns: 15,
        runsAboveThreshold: 0,
        ratioAboveThreshold: 0,
        latestP99Ms: 78000,
        minObservedP99Ms: 2000,
        maxObservedP99Ms: 9000
      }
    },
    currentSnapshot: {
      runId: 'run-1',
      schedulerId: 'sched-a',
      workerId: 'worker-a',
      startedAtMs: Date.parse('2026-03-25T04:47:01.000Z')
    },
    diagnostics: {
      tailLatency: {
        metric: 'sustainedP99CycleDurationMs',
        status: 'healthy',
        thresholdMs: 10000,
        windowMinutes: 15,
        minRuns: 10,
        observedRuns: 15,
        runsAboveThreshold: 0,
        ratioAboveThreshold: 0,
        latestP99Ms: 78000,
        minObservedP99Ms: 2000,
        maxObservedP99Ms: 9000
      },
      last24hTailLatency: {
        metric: 'sustainedP99CycleDurationMs',
        status: 'healthy',
        thresholdMs: 10000,
        windowMinutes: 15,
        minRuns: 10,
        observedRuns: 15,
        runsAboveThreshold: 0,
        ratioAboveThreshold: 0,
        latestP99Ms: 78000,
        minObservedP99Ms: 2000,
        maxObservedP99Ms: 9000
      },
      telemetryPauseReasons: { stale_telemetry: 5, stale_telemetry_missing_timestamp: 2 },
      phaseTimings: {
        latestRunStartedAtMs: Date.parse('2026-03-25T04:47:01.000Z'),
        latestRunMaxMs: { dataFetchMs: 800, ruleEvalMs: 30, actionApplyMs: 1200, curtailmentMs: 400 },
        outlierRunStartedAtMs: Date.parse('2026-03-25T04:47:01.000Z'),
        outlierRunMaxMs: { dataFetchMs: 800, ruleEvalMs: 30, actionApplyMs: 1200, curtailmentMs: 400 },
        windowMaxMs: { dataFetchMs: 800, ruleEvalMs: 30, actionApplyMs: 1200, curtailmentMs: 400 }
      }
    }
  };

  await page.route('**/js/firebase-config.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.firebaseConfig = { apiKey: "YOUR_TEST_KEY" };'
    });
  });

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let payload = { errno: 0, result: {} };

    if (path === '/api/admin/check') {
      payload = { errno: 0, result: { isAdmin: true } };
    } else if (path === '/api/admin/platform-stats') {
      payload = {
        errno: 0,
        result: {
          summary: { totalUsers: 12, configuredUsers: 9, mau: 7, automationActive: 5 },
          trend: [],
          warnings: []
        }
      };
    } else if (path === '/api/admin/firestore-metrics') {
      payload = {
        errno: 0,
        result: {
          updatedAt: new Date().toISOString(),
          source: 'gcp-monitoring+usage-estimate',
          firestore: {
            readsMtd: 1234,
            writesMtd: 456,
            deletesMtd: 12,
            storageGb: 0.4,
            estimatedDocOpsCostUsd: 1.23,
            estimatedDocOpsBreakdown: []
          },
          billing: {
            projectMtdCostUsd: 4.56,
            projectServices: [],
            estimatedMtdCostUsd: 4.56,
            services: []
          },
          trend: [],
          warnings: []
        }
      };
    } else if (path === '/api/admin/behavior-metrics') {
      payload = { errno: 0, result: behaviorResult };
    } else if (path === '/api/admin/api-health') {
      payload = { errno: 0, result: apiHealthResult };
    } else if (path === '/api/admin/scheduler-metrics') {
      payload = { errno: 0, result: schedulerResult };
    } else if (path === '/api/user/init-profile') {
      payload = { errno: 0, result: { initialized: true } };
    }

    await route.fulfill(jsonResponse(payload));
  });

  await page.addInitScript(() => {
    window.__DISABLE_AUTH_REDIRECTS__ = true;
    window.__DISABLE_SERVICE_WORKER__ = true;
    window.mockFirebaseAuth = {
      currentUser: {
        uid: 'admin-user-1',
        email: 'admin@example.com',
        displayName: 'Admin User',
        getIdToken: () => Promise.resolve('mock-token')
      }
    };
    try {
      localStorage.setItem('mockAuthUser', JSON.stringify({
        uid: 'admin-user-1',
        email: 'admin@example.com',
        displayName: 'Admin User'
      }));
    } catch (_error) {
      // ignore storage issues in test bootstrap
    }
  });
}

test.describe('Admin Behaviour Tab', () => {
  test('renders the Behaviour tab and setup guidance when GA4 is not configured', async ({ page }) => {
    await mockAdminEnvironment(page);

    await page.goto('/admin.html');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('button', { name: /Behaviour/i })).toBeVisible();
    await page.getByRole('button', { name: /Behaviour/i }).click();
    await expect(page.locator('#tab-behavior')).toBeVisible();
    await expect(page.locator('#behaviorSetup')).toContainText(/GA4_PROPERTY_ID/i);
  });

  test('renders behaviour metrics when the endpoint returns aggregated data', async ({ page }) => {
    await mockAdminEnvironment(page, {
      behaviorResult: {
        configured: true,
        source: 'ga4-data-api',
        propertyId: '123456789',
        updatedAt: '2026-03-21T03:14:15.000Z',
        window: { days: 30, startDate: '30daysAgo', endDate: 'today' },
        summary: {
          activeUsers: 18,
          pageViews: 146,
          eventCount: 221,
          avgEngagementSecondsPerUser: 51.8,
          avgEventsPerUser: 12.3,
          trackedPageCount: 6,
          customEventTypes: 2
        },
        pageSeries: [
          { date: '2026-03-08', activeUsers: 5, pageViews: 10, eventCount: 12 },
          { date: '2026-03-09', activeUsers: 5, pageViews: 10, eventCount: 12 },
          { date: '2026-03-10', activeUsers: 5, pageViews: 10, eventCount: 12 },
          { date: '2026-03-11', activeUsers: 5, pageViews: 10, eventCount: 12 },
          { date: '2026-03-12', activeUsers: 5, pageViews: 10, eventCount: 12 },
          { date: '2026-03-13', activeUsers: 5, pageViews: 10, eventCount: 12 },
          { date: '2026-03-14', activeUsers: 5, pageViews: 10, eventCount: 12 },
          { date: '2026-03-15', activeUsers: 8, pageViews: 16, eventCount: 16 },
          { date: '2026-03-16', activeUsers: 8, pageViews: 16, eventCount: 16 },
          { date: '2026-03-17', activeUsers: 8, pageViews: 16, eventCount: 16 },
          { date: '2026-03-18', activeUsers: 8, pageViews: 16, eventCount: 16 },
          { date: '2026-03-19', activeUsers: 8, pageViews: 16, eventCount: 16 },
          { date: '2026-03-20', activeUsers: 8, pageViews: 16, eventCount: 16 },
          { date: '2026-03-21', activeUsers: 8, pageViews: 16, eventCount: 16 }
        ],
        mainPageOptions: [
          { key: 'app', label: 'Dashboard' },
          { key: 'settings', label: 'Settings' }
        ],
        pageSeriesByKey: {
          app: [
            { date: '2026-03-08', activeUsers: 4, pageViews: 6, eventCount: 0 },
            { date: '2026-03-09', activeUsers: 4, pageViews: 6, eventCount: 0 },
            { date: '2026-03-10', activeUsers: 4, pageViews: 6, eventCount: 0 },
            { date: '2026-03-11', activeUsers: 4, pageViews: 6, eventCount: 0 },
            { date: '2026-03-12', activeUsers: 4, pageViews: 6, eventCount: 0 },
            { date: '2026-03-13', activeUsers: 4, pageViews: 6, eventCount: 0 },
            { date: '2026-03-14', activeUsers: 4, pageViews: 6, eventCount: 0 },
            { date: '2026-03-15', activeUsers: 6, pageViews: 10, eventCount: 0 },
            { date: '2026-03-16', activeUsers: 6, pageViews: 10, eventCount: 0 },
            { date: '2026-03-17', activeUsers: 6, pageViews: 10, eventCount: 0 },
            { date: '2026-03-18', activeUsers: 6, pageViews: 10, eventCount: 0 },
            { date: '2026-03-19', activeUsers: 6, pageViews: 10, eventCount: 0 },
            { date: '2026-03-20', activeUsers: 6, pageViews: 10, eventCount: 0 },
            { date: '2026-03-21', activeUsers: 6, pageViews: 10, eventCount: 0 }
          ],
          settings: [
            { date: '2026-03-08', activeUsers: 2, pageViews: 4, eventCount: 0 },
            { date: '2026-03-09', activeUsers: 2, pageViews: 4, eventCount: 0 },
            { date: '2026-03-10', activeUsers: 2, pageViews: 4, eventCount: 0 },
            { date: '2026-03-11', activeUsers: 2, pageViews: 4, eventCount: 0 },
            { date: '2026-03-12', activeUsers: 2, pageViews: 4, eventCount: 0 },
            { date: '2026-03-13', activeUsers: 2, pageViews: 4, eventCount: 0 },
            { date: '2026-03-14', activeUsers: 2, pageViews: 4, eventCount: 0 },
            { date: '2026-03-15', activeUsers: 3, pageViews: 6, eventCount: 0 },
            { date: '2026-03-16', activeUsers: 3, pageViews: 6, eventCount: 0 },
            { date: '2026-03-17', activeUsers: 3, pageViews: 6, eventCount: 0 },
            { date: '2026-03-18', activeUsers: 3, pageViews: 6, eventCount: 0 },
            { date: '2026-03-19', activeUsers: 3, pageViews: 6, eventCount: 0 },
            { date: '2026-03-20', activeUsers: 3, pageViews: 6, eventCount: 0 },
            { date: '2026-03-21', activeUsers: 3, pageViews: 6, eventCount: 0 }
          ]
        },
        topPages: [
          { path: '/app.html', title: 'Overview', pageViews: 81, activeUsers: 14, avgEngagementSeconds: 43.6 },
          { path: '/settings.html', title: 'Settings', pageViews: 32, activeUsers: 8, avgEngagementSeconds: 26.8 }
        ],
        topEvents: [
          { eventName: 'settings_save_all', eventCount: 19, activeUsers: 6 },
          { eventName: 'history_fetch_report', eventCount: 12, activeUsers: 5 }
        ],
        warnings: []
      }
    });

    await page.goto('/admin.html');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Behaviour/i }).click();
    await expect(page.locator('#behaviorActiveUsers')).toHaveText('18');
    await expect(page.locator('#behaviorPageViews')).toHaveText('146');
    await expect(page.locator('#behaviorEvents')).toHaveText('221');
    await expect(page.locator('#behaviorEventsPerUser')).toHaveText('12.3');
    await expect(page.locator('#behaviorTrackedPages')).toHaveText('6');
    await expect(page.locator('#behaviorCustomEventTypes')).toHaveText('2');
    await expect(page.locator('#behaviorSignalMomentum')).toContainText(/Users \+60\.0%/i);
    await expect(page.locator('#behaviorSignalRepeatPressure')).toContainText(/8\.1 views\/user/i);
    await expect(page.locator('#behaviorSignalPageMix')).toContainText(/Dashboard is 62\.5%/i);
    await expect(page.locator('#behaviorTopPagesBody')).toContainText('/app.html');
    await expect(page.locator('#behaviorTopEventsBody')).toContainText('Settings Save All');
    await expect(page.locator('#behaviorMetricsUpdated')).toContainText(/GA4 property 123456789/i);
  });

  test('renders API health metrics and alerts from the admin endpoint', async ({ page }) => {
    await mockAdminEnvironment(page);

    await page.goto('/admin.html');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /API Health/i }).click();
    await expect(page.locator('#apiHealthTotalCalls')).toHaveText('1.2K');
    await expect(page.locator('#apiHealthDominantProvider')).toHaveText('FoxESS');
    await expect(page.locator('#apiHealthErrorRate')).toHaveText('2.01%');
    await expect(page.locator('#apiHealthProvidersBody')).toContainText('Amber');
    await expect(page.locator('#apiHealthAlerts')).toContainText(/potential overage or rate-limit risk/i);
    await expect(page.locator('#apiHealthDailyBody')).toContainText('2/4/5');
    await expect(page.locator('#apiHealthAlphaEssSummary')).toContainText(/Low-cost AlphaESS observability is active/i);
    await expect(page.locator('#apiHealthAlphaEssLookFor')).toContainText(/negative-load-power/i);
    await expect(page.locator('#apiHealthAlphaEssCost')).toContainText(/GET \/api\/inverter\/real-time only emits logs when an anomaly is detected/i);
    await expect(page.locator('#apiHealthAlphaEssRollback')).toContainText(/ALPHAESS_OBSERVABILITY_RUNBOOK_MAR26\.md/i);
  });

  test('keeps API health layout contained on phone screens', async ({ page }) => {
    await mockAdminEnvironment(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin.html');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /API Health/i }).click();
    await expect(page.locator('#apiHealthDailyBody')).toContainText('2/4/5');

    const cardBounds = await page.locator('#tab-apiHealth .card').evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        viewportWidth: window.innerWidth
      };
    });

    expect(cardBounds.left).toBeGreaterThanOrEqual(-1);
    expect(cardBounds.right).toBeLessThanOrEqual(cardBounds.viewportWidth + 1);
  });

  test('renders scheduler tooltips and clarifies telemetry-age and tail semantics', async ({ page }) => {
    await mockAdminEnvironment(page);

    await page.goto('/admin.html');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Scheduler/i }).click();
    await expect(page.locator('#scheduler14dSloCycleTailP99 .slo-status')).toContainText('window max p99');
    await expect(page.locator('#scheduler14dSloTelemetryAge .slo-meta')).toContainText('Missing timestamp cycles: 2');

    await page.locator('#scheduler14dSloTelemetryAge .info-tip').hover();
    await expect(page.locator('#adminInfoTooltip')).toBeVisible();
    await expect(page.locator('#adminInfoTooltip')).toContainText(/source timestamp embedded in inverter telemetry/i);

    await page.locator('#scheduler14dSloCycleTailP99 .info-tip').hover();
    await expect(page.locator('#adminInfoTooltip')).toContainText(/window-max p99/i);
    await expect(page.locator('#scheduler14dSloCycleTailP99 .slo-meta')).toContainText(/Current sustained signal HEALTHY/i);
  });
});
