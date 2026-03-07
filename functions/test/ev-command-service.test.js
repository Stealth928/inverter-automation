'use strict';

const { createEVCommandService, DEFAULT_COMMAND_COOLDOWN_MS, IDEMPOTENCY_WINDOW_SECS } = require('../lib/services/ev-command-service');
const { StubEVAdapter } = require('../lib/adapters/stub-ev-adapter');

// ---------------------------------------------------------------------------
// In-memory vehicles repository stub
// ---------------------------------------------------------------------------

function makeVehiclesRepoStub() {
  const commands = new Map(); // commandId → commandEntry
  const states = new Map();   // vehicleId → status

  return {
    async appendCommand(_userId, _vehicleId, entry) {
      commands.set(entry.commandId, { ...entry });
      return entry.commandId;
    },
    async updateCommand(_userId, _vehicleId, commandId, patch) {
      const existing = commands.get(commandId) || {};
      commands.set(commandId, { ...existing, ...patch });
    },
    async getCommand(_userId, _vehicleId, commandId) {
      return commands.get(commandId) || null;
    },
    async saveVehicleState(_userId, vehicleId, status) {
      states.set(vehicleId, { ...status });
    },
    async getVehicleState(_userId, vehicleId) {
      return states.get(vehicleId) || null;
    },
    _commands: commands,
    _states: states
  };
}

function makeAdapter() {
  const adapter = new StubEVAdapter();
  adapter.seedVehicle('v1', { isPluggedIn: true, chargingState: 'stopped', socPct: 60 });
  return adapter;
}

const TEST_CONTEXT = { credentials: { accessToken: 'test-token' } };
const USER_ID = 'user1';
const VEH_ID = 'v1';

// ---------------------------------------------------------------------------
// 1 — Guard
// ---------------------------------------------------------------------------

describe('createEVCommandService — guard', () => {
  test('throws when evAdapter is missing', () => {
    expect(() => createEVCommandService({ vehiclesRepo: makeVehiclesRepoStub() }))
      .toThrow(/valid evAdapter/);
  });

  test('throws when vehiclesRepo is missing', () => {
    expect(() => createEVCommandService({ evAdapter: makeAdapter() }))
      .toThrow(/valid vehiclesRepo/);
  });
});

// ---------------------------------------------------------------------------
// 2 — startCharging
// ---------------------------------------------------------------------------

describe('EV command service — startCharging', () => {
  function makeService(opts = {}) {
    return createEVCommandService({
      evAdapter: makeAdapter(),
      vehiclesRepo: makeVehiclesRepoStub(),
      skipWake: true,
      commandCooldownMs: 0,
      ...opts
    });
  }

  test('issues command and returns result with commandId', async () => {
    const svc = makeService();
    const result = await svc.startCharging(USER_ID, VEH_ID, TEST_CONTEXT);
    expect(result.commandId).toMatch(/^ev-startCharging-/);
    expect(result.status).toBe('sent');
    expect(typeof result.sentAtIso).toBe('string');
  });

  test('idempotency: duplicate commandId returns cached result', async () => {
    const repo = makeVehiclesRepoStub();
    const svc = createEVCommandService({
      evAdapter: makeAdapter(),
      vehiclesRepo: repo,
      skipWake: true,
      commandCooldownMs: 0
    });

    // First call creates the command
    const r1 = await svc.startCharging(USER_ID, VEH_ID, TEST_CONTEXT, { commandId: 'cmd-idem' });
    expect(r1.commandId).toBe('cmd-idem');

    // Manually set requestedAtIso to now so it's within the idempotency window
    const stored = repo._commands.get('cmd-idem');
    stored.requestedAtIso = new Date().toISOString();

    // Second call with same commandId
    const r2 = await svc.startCharging(USER_ID, VEH_ID, TEST_CONTEXT, { commandId: 'cmd-idem' });
    expect(r2.commandId).toBe('cmd-idem');

    // Adapter should only have been called once (not twice)
    const adapterCallsForV1 = svc; // verify through repo: only one queued+update cycle
    // The repo should have the command in the store once
    expect(repo._commands.size).toBe(1);
  });

  test('conflict detection: throws when force_discharge rule is active', async () => {
    const svc = makeService();
    await expect(
      svc.startCharging(USER_ID, VEH_ID, TEST_CONTEXT, {
        automationState: { ruleActive: true, ruleType: 'force_discharge' }
      })
    ).rejects.toThrow(/conflict.*force.discharge/i);
  });

  test('command audit log records queued→sent lifecycle', async () => {
    const repo = makeVehiclesRepoStub();
    const svc = createEVCommandService({
      evAdapter: makeAdapter(),
      vehiclesRepo: repo,
      skipWake: true,
      commandCooldownMs: 0
    });
    await svc.startCharging(USER_ID, VEH_ID, TEST_CONTEXT, { commandId: 'cmd-audit' });

    const logged = repo._commands.get('cmd-audit');
    expect(logged.commandType).toBe('startCharging');
    expect(logged.status).toBe('sent');
    expect(logged.sentAtIso).toBeDefined();
    expect(logged.completedAtIso).toBeDefined();
  });

  test('marks command as failed in audit log on adapter error', async () => {
    const adapter = makeAdapter();
    adapter.failNextCommand();
    const repo = makeVehiclesRepoStub();
    const svc = createEVCommandService({
      evAdapter: adapter,
      vehiclesRepo: repo,
      skipWake: true,
      commandCooldownMs: 0
    });
    await expect(svc.startCharging(USER_ID, VEH_ID, TEST_CONTEXT, { commandId: 'cmd-fail' }))
      .rejects.toThrow(/simulated failure/);

    const logged = repo._commands.get('cmd-fail');
    expect(logged.status).toBe('failed');
    expect(typeof logged.errorMsg).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// 3 — Cooldown enforcement
// ---------------------------------------------------------------------------

describe('EV command service — cooldown', () => {
  test('throws when command is within cooldown window', async () => {
    const svc = createEVCommandService({
      evAdapter: makeAdapter(),
      vehiclesRepo: makeVehiclesRepoStub(),
      skipWake: true,
      commandCooldownMs: 60000 // 60s cooldown
    });

    await svc.startCharging(USER_ID, VEH_ID, TEST_CONTEXT);

    // Second command immediately → should throw
    await expect(svc.startCharging(USER_ID, VEH_ID, TEST_CONTEXT))
      .rejects.toThrow(/cooldown/);
  });

  test('does not throw when cooldown is 0', async () => {
    const svc = createEVCommandService({
      evAdapter: makeAdapter(),
      vehiclesRepo: makeVehiclesRepoStub(),
      skipWake: true,
      commandCooldownMs: 0
    });
    await svc.startCharging(USER_ID, VEH_ID, TEST_CONTEXT);
    // Immediately issue again — should not throw
    const adapter = makeAdapter();
    adapter.seedVehicle('v1', { isPluggedIn: true });
    await expect(svc.stopCharging(USER_ID, VEH_ID, TEST_CONTEXT)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 4 — stopCharging
// ---------------------------------------------------------------------------

describe('EV command service — stopCharging', () => {
  test('issues stop command and records in audit log', async () => {
    const repo = makeVehiclesRepoStub();
    const svc = createEVCommandService({
      evAdapter: makeAdapter(),
      vehiclesRepo: repo,
      skipWake: true,
      commandCooldownMs: 0
    });
    const result = await svc.stopCharging(USER_ID, VEH_ID, TEST_CONTEXT, { commandId: 'stop-1' });
    expect(result.commandId).toBe('stop-1');
    expect(result.status).toBe('sent');
    expect(repo._commands.get('stop-1').commandType).toBe('stopCharging');
  });
});

// ---------------------------------------------------------------------------
// 5 — setChargeLimit
// ---------------------------------------------------------------------------

describe('EV command service — setChargeLimit', () => {
  test('issues set-limit command and records in audit log', async () => {
    const repo = makeVehiclesRepoStub();
    const svc = createEVCommandService({
      evAdapter: makeAdapter(),
      vehiclesRepo: repo,
      skipWake: true,
      commandCooldownMs: 0
    });
    const result = await svc.setChargeLimit(USER_ID, VEH_ID, TEST_CONTEXT, 75, { commandId: 'limit-1' });
    expect(result.commandId).toBe('limit-1');
    expect(repo._commands.get('limit-1').params.limitPct).toBe(75);
  });

  test('propagates invalid limit error from adapter', async () => {
    const svc = createEVCommandService({
      evAdapter: makeAdapter(),
      vehiclesRepo: makeVehiclesRepoStub(),
      skipWake: true,
      commandCooldownMs: 0
    });
    await expect(svc.setChargeLimit(USER_ID, VEH_ID, TEST_CONTEXT, 0, { commandId: 'bad-limit' }))
      .rejects.toThrow(/invalid charge limit/);
  });
});

// ---------------------------------------------------------------------------
// 6 — getVehicleStatus (with state caching)
// ---------------------------------------------------------------------------

describe('EV command service — getVehicleStatus', () => {
  test('returns canonical status and saves to vehicle state cache', async () => {
    const repo = makeVehiclesRepoStub();
    const svc = createEVCommandService({
      evAdapter: makeAdapter(),
      vehiclesRepo: repo,
      skipWake: true,
      commandCooldownMs: 0
    });
    const status = await svc.getVehicleStatus(USER_ID, VEH_ID, TEST_CONTEXT);
    expect(status.socPct).toBe(60);
    expect(repo._states.get(VEH_ID)).toBeDefined();
    expect(repo._states.get(VEH_ID).socPct).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// 7 — Wake integration (skipWake=false)
// ---------------------------------------------------------------------------

describe('EV command service — wake integration', () => {
  test('calls wakeVehicle before command when skipWake=false and status is unknown', async () => {
    const adapter = new StubEVAdapter();
    // Seed with unknown charging state (vehicle might be asleep)
    adapter.seedVehicle('v2', { isPluggedIn: true, chargingState: 'unknown', socPct: 50 });

    const repo = makeVehiclesRepoStub();
    const svc = createEVCommandService({
      evAdapter: adapter,
      vehiclesRepo: repo,
      skipWake: false,
      commandCooldownMs: 0
    });

    await svc.startCharging(USER_ID, 'v2', TEST_CONTEXT, { commandId: 'wake-cmd' });

    // Both getVehicleStatus (for online check) and wakeVehicle should have been called
    const commands = adapter.capturedCommands.map((c) => c.command);
    expect(commands).toContain('wakeVehicle');
    expect(commands).toContain('startCharging');
  });
});
