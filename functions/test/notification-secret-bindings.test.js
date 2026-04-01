'use strict';

const fs = require('fs');
const path = require('path');

describe('notification secret bindings', () => {
  const indexPath = path.join(__dirname, '..', 'index.js');
  const source = fs.readFileSync(indexPath, 'utf8');

  test('groups the web push secrets into a reusable binding list', () => {
    expect(source).toMatch(
      /const WEB_PUSH_NOTIFICATION_SECRETS = Object\.freeze\(\[\s*_secretWebPushVapidPublicKey,\s*_secretWebPushVapidPrivateKey,\s*_secretWebPushVapidSubject\s*\]\);/s
    );
  });

  test('binds web push secrets to the scheduler that emits user automation notifications', () => {
    expect(source).toMatch(
      /const RUN_AUTOMATION_SECRETS = Object\.freeze\(\[\s*_secretSungrowAppKey,\s*_secretSungrowAppSecret,\s*\.\.\.WEB_PUSH_NOTIFICATION_SECRETS\s*\]\);/s
    );
    expect(source).toMatch(
      /exports\.runAutomation = onSchedule\(\s*\{\s*schedule: 'every 1 minutes',\s*timeZone: 'UTC',\s*secrets: RUN_AUTOMATION_SECRETS/s
    );
  });

  test('binds web push secrets to the admin operational alerts scheduler', () => {
    expect(source).toMatch(
      /const RUN_ADMIN_ALERTS_SECRETS = Object\.freeze\(\[\s*_secretGithubDataworksToken,\s*\.\.\.WEB_PUSH_NOTIFICATION_SECRETS\s*\]\);/s
    );
    expect(source).toMatch(
      /exports\.runAdminOperationalAlerts = onSchedule\(\s*\{\s*schedule: '2-59\/5 \* \* \* \*',\s*timeZone: 'UTC',\s*secrets: RUN_ADMIN_ALERTS_SECRETS/s
    );
  });
});
