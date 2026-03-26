'use strict';

const fs = require('fs');
const path = require('path');

describe('pricing refresh discipline', () => {
  const appHtmlPath = path.join(__dirname, '..', '..', 'frontend', 'app.html');
  const dashboardPath = path.join(__dirname, '..', '..', 'frontend', 'js', 'dashboard.js');
  const pricingRoutePath = path.join(__dirname, '..', 'api', 'routes', 'pricing.js');

  test('dashboard only force-refreshes Amber on manual user action', () => {
    const appHtmlSource = fs.readFileSync(appHtmlPath, 'utf8');
    const dashboardSource = fs.readFileSync(dashboardPath, 'utf8');

    expect(dashboardSource).toContain(
      'return provider === \'amber\' && refreshMode === \'manual\';'
    );
    expect(dashboardSource).toContain(
      'refreshButton.title = provider === \'aemo\''
    );
    expect(dashboardSource).toContain(
      '? \'Refresh displayed prices from the latest stored AEMO snapshot\''
    );
    expect(dashboardSource).toContain(
      ': \'Force refresh Amber prices from API (bypasses cache)\''
    );
    expect(appHtmlSource).not.toContain(
      'onclick="getAmberCurrent(true)"'
    );
    expect(appHtmlSource).toContain(
      'onclick="refreshPricingCard(\'manual\')"'
    );
  });

  test('dashboard auto-refresh follows provider cadence instead of forcing live pricing reads', () => {
    const dashboardSource = fs.readFileSync(dashboardPath, 'utf8');

    expect(dashboardSource).toContain(
      'const AEMO_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;'
    );
    expect(dashboardSource).toContain(
      'refreshPricingCard(\'auto\');'
    );
    expect(dashboardSource).toContain(
      'const cadenceMs = getPricingAutoRefreshCadenceMs(provider);'
    );
    expect(dashboardSource).not.toContain(
      'getAmberCurrent(true);'
    );
  });

  test('pricing route keeps AEMO current reads scheduler-backed', () => {
    const pricingRouteSource = fs.readFileSync(pricingRoutePath, 'utf8');

    expect(pricingRouteSource).toContain('if (provider === \'aemo\') {');
    expect(pricingRouteSource).toContain('const result = await aemoAPI.getCurrentPriceData({');
    expect(pricingRouteSource).not.toContain(
      'aemoAPI.getCurrentPriceData({\n          forceRefresh:'
    );
  });
});
