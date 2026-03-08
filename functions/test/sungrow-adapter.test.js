'use strict';

/**
 * Tests for functions/lib/adapters/sungrow-adapter.js
 * Covers all 8 DeviceAdapter contract methods plus helper conversions.
 */

const {
  SungrowDeviceAdapter,
  createSungrowDeviceAdapter,
  generateSign: _stub,   // not exported — ignore
  groupsToTouParams,
  touParamsToGroups,
  normalizeRealtimePoints,
  parseRealtimeData,
  WORK_MODE_TO_SUNGROW,
  SUNGROW_TO_WORK_MODE,
  EMS_MODE_PARAM_CODE
} = require('../lib/adapters/sungrow-adapter');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMockSungrowAPI(overrides = {}) {
  return {
    callSungrowAPI: jest.fn(async () => ({ errno: 0, result: {} })),
    loginSungrow: jest.fn(async () => ({ errno: 0, result: { token: 't', uid: 'u' } })),
    ...overrides
  };
}

function buildAdapter(apiOverrides = {}) {
  return createSungrowDeviceAdapter({
    sungrowAPI: buildMockSungrowAPI(apiOverrides),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
  });
}

const BASE_CONTEXT = {
  deviceSN: 'SG-SN-001',
  userConfig: { sungrowToken: 'tok', sungrowUid: 'uid1', sungrowTokenExpiry: Date.now() + 9999 },
  userId: 'user1'
};

// ---------------------------------------------------------------------------
// Constructor guard
// ---------------------------------------------------------------------------

describe('SungrowDeviceAdapter constructor', () => {
  test('throws when sungrowAPI is missing', () => {
    expect(() => new SungrowDeviceAdapter({})).toThrow(/sungrowAPI/);
  });

  test('throws when sungrowAPI lacks callSungrowAPI', () => {
    expect(() => new SungrowDeviceAdapter({ sungrowAPI: { loginSungrow: jest.fn() } }))
      .toThrow(/callSungrowAPI/);
  });

  test('createSungrowDeviceAdapter convenience factory works', () => {
    const adapter = buildAdapter();
    expect(adapter).toBeInstanceOf(SungrowDeviceAdapter);
  });
});

// ---------------------------------------------------------------------------
// getCapabilities
// ---------------------------------------------------------------------------

describe('getCapabilities', () => {
  test('returns expected capabilities', async () => {
    const caps = await buildAdapter().getCapabilities();
    expect(caps.scheduler).toBe(true);
    expect(caps.workMode).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------------

describe('getStatus', () => {
  test('throws when deviceSN is missing from context', async () => {
    await expect(buildAdapter().getStatus({})).rejects.toThrow(/deviceSN/);
  });

  test('calls queryRealTimeDataByTokenAndType with correct device_sn', async () => {
    const mockCallApi = jest.fn(async () => ({
      errno: 0,
      result: {
        device_point_list: [
          { point_id: 'p187', point_value: '82' },
          { point_id: 'p190', point_value: '28' },
          { point_id: 'p83',  point_value: '2500' },
          { point_id: 'p27',  point_value: '1800' },
          { point_id: 'p10994', point_value: '300' }
        ]
      }
    }));
    const adapter = createSungrowDeviceAdapter({
      sungrowAPI: { callSungrowAPI: mockCallApi },
      logger: { info: jest.fn() }
    });

    const status = await adapter.getStatus(BASE_CONTEXT);

    expect(mockCallApi).toHaveBeenCalledWith(
      'queryRealTimeDataByTokenAndType',
      expect.objectContaining({ device_sn: 'SG-SN-001' }),
      BASE_CONTEXT.userConfig,
      BASE_CONTEXT.userId
    );
    expect(status.socPct).toBe(82);
    expect(status.batteryTempC).toBe(28);
    expect(status.pvPowerW).toBe(2500);
    expect(status.loadPowerW).toBe(1800);
    expect(status.gridPowerW).toBe(300);
    expect(status.feedInPowerW).toBe(0);
    expect(status.deviceSN).toBe('SG-SN-001');
  });

  test('throws normalized error when API returns non-zero errno', async () => {
    const adapter = createSungrowDeviceAdapter({
      sungrowAPI: { callSungrowAPI: jest.fn(async () => ({ errno: 3302, error: 'Auth fail' })) },
      logger: { info: jest.fn() }
    });

    await expect(adapter.getStatus(BASE_CONTEXT)).rejects.toMatchObject({ errno: 3302 });
  });
});

// ---------------------------------------------------------------------------
// getSchedule / setSchedule / clearSchedule
// ---------------------------------------------------------------------------

describe('getSchedule', () => {
  test('throws when deviceSN is missing', async () => {
    await expect(buildAdapter().getSchedule({})).rejects.toThrow(/deviceSN/);
  });

  test('returns errno 0 and FoxESS-style groups on success', async () => {
    const mockCallApi = jest.fn(async () => ({
      errno: 0,
      result: {
        device_point_list: [
          { point_id: 'p27243', point_value: '600' },
          { point_id: 'p27244', point_value: '800' },
          { point_id: 'p27245', point_value: '0' },
          { point_id: 'p27246', point_value: '0' },
          { point_id: 'p27247', point_value: '0' },
          { point_id: 'p27248', point_value: '0' },
          { point_id: 'p27249', point_value: '0' },
          { point_id: 'p27250', point_value: '0' },
          { point_id: 'p27251', point_value: '1' }
        ]
      }
    }));

    const adapter = createSungrowDeviceAdapter({
      sungrowAPI: { callSungrowAPI: mockCallApi },
      logger: { info: jest.fn() }
    });

    const { errno, result } = await adapter.getSchedule(BASE_CONTEXT);
    expect(errno).toBe(0);
    expect(Array.isArray(result.groups)).toBe(true);
    expect(result.enable).toBe(true);
    // First slot should map to 06:00 → 08:00
    expect(result.groups[0].startHour).toBe(6);
    expect(result.groups[0].endHour).toBe(8);
  });
});

describe('setSchedule', () => {
  test('throws when deviceSN is missing', async () => {
    await expect(buildAdapter().setSchedule({}, [])).rejects.toThrow(/deviceSN/);
  });

  test('calls setDevicePoint with translated TOU params', async () => {
    const mockCallApi = jest.fn(async () => ({ errno: 0, result: {} }));
    const adapter = createSungrowDeviceAdapter({
      sungrowAPI: { callSungrowAPI: mockCallApi },
      logger: { info: jest.fn() }
    });

    const groups = [{
      enable: 1,
      workMode: 'ForceCharge',
      startHour: 22, startMinute: 0,
      endHour: 6,    endMinute: 0
    }];

    const result = await adapter.setSchedule(BASE_CONTEXT, groups);
    expect(result.errno).toBe(0);

    expect(mockCallApi).toHaveBeenCalledWith(
      'setDevicePoint',
      expect.objectContaining({
        device_sn: 'SG-SN-001',
        device_point_list: expect.arrayContaining([
          expect.objectContaining({ point_id: 'p27243', point_value: '2200' })
        ])
      }),
      BASE_CONTEXT.userConfig,
      BASE_CONTEXT.userId
    );
  });

  test('sets EMS mode from first active group workMode', async () => {
    const mockCallApi = jest.fn(async () => ({ errno: 0, result: {} }));
    const adapter = createSungrowDeviceAdapter({
      sungrowAPI: { callSungrowAPI: mockCallApi },
      logger: { info: jest.fn() }
    });

    await adapter.setSchedule(BASE_CONTEXT, [{
      enable: 1, workMode: 'Backup',
      startHour: 10, startMinute: 0, endHour: 12, endMinute: 0
    }]);

    const call = mockCallApi.mock.calls[0];
    const points = call[1].device_point_list;
    const emsPoint = points.find((p) => p.point_id === EMS_MODE_PARAM_CODE);
    expect(emsPoint).toBeTruthy();
    expect(emsPoint.point_value).toBe(String(WORK_MODE_TO_SUNGROW['Backup'])); // '2028'
  });
});

describe('clearSchedule', () => {
  test('delegates to setSchedule with cleared groups', async () => {
    const mockCallApi = jest.fn(async () => ({ errno: 0, result: {} }));
    const adapter = createSungrowDeviceAdapter({
      sungrowAPI: { callSungrowAPI: mockCallApi },
      logger: { info: jest.fn() }
    });

    const result = await adapter.clearSchedule(BASE_CONTEXT);
    expect(result.errno).toBe(0);
    expect(mockCallApi).toHaveBeenCalledWith(
      'setDevicePoint',
      expect.objectContaining({ device_sn: 'SG-SN-001' }),
      expect.anything(),
      expect.anything()
    );
  });
});

// ---------------------------------------------------------------------------
// getWorkMode / setWorkMode
// ---------------------------------------------------------------------------

describe('getWorkMode', () => {
  test('throws when deviceSN is missing', async () => {
    await expect(buildAdapter().getWorkMode({})).rejects.toThrow(/deviceSN/);
  });

  test('maps raw EMS mode back to canonical work mode name', async () => {
    const mockCallApi = jest.fn(async () => ({
      errno: 0,
      result: {
        device_point_list: [{ point_id: EMS_MODE_PARAM_CODE, point_value: '2002' }]
      }
    }));
    const adapter = createSungrowDeviceAdapter({
      sungrowAPI: { callSungrowAPI: mockCallApi },
      logger: { info: jest.fn() }
    });

    const { result } = await adapter.getWorkMode(BASE_CONTEXT);
    expect(result.workMode).toBe('ForceCharge');
    expect(result.raw).toBe(2002);
  });
});

describe('setWorkMode', () => {
  test('throws when deviceSN is missing', async () => {
    await expect(buildAdapter().setWorkMode({}, 'SelfUse')).rejects.toThrow(/deviceSN/);
  });

  test('throws for unknown mode names', async () => {
    await expect(buildAdapter().setWorkMode(BASE_CONTEXT, 'InvalidMode'))
      .rejects.toThrow(/unknown mode/i);
  });

  test('sends correct EMS mode value', async () => {
    const mockCallApi = jest.fn(async () => ({ errno: 0, result: {} }));
    const adapter = createSungrowDeviceAdapter({
      sungrowAPI: { callSungrowAPI: mockCallApi },
      logger: { info: jest.fn() }
    });

    await adapter.setWorkMode(BASE_CONTEXT, 'ForceDischarge');
    expect(mockCallApi).toHaveBeenCalledWith(
      'setDevicePoint',
      expect.objectContaining({
        device_point_list: [{ point_id: EMS_MODE_PARAM_CODE, point_value: '2003' }]
      }),
      BASE_CONTEXT.userConfig,
      BASE_CONTEXT.userId
    );
  });
});

// ---------------------------------------------------------------------------
// normalizeProviderError
// ---------------------------------------------------------------------------

describe('normalizeProviderError', () => {
  const adapter = buildAdapter();

  test.each([
    [{ errno: 3301, error: 'Token expired' }, 3301],
    [{ errno: 3302, error: 'Auth failed' }, 3302],
    [{ errno: 3303, error: 'Rate limited' }, 3303],
    [{ errno: 3304, error: 'Server error' }, 3304],
    [{ errno: 408,  error: 'Timeout' }, 3305],
    [{ errno: 999,  error: 'Unknown' }, 3300]
  ])('maps %o → errno %i', (input, expected) => {
    expect(adapter.normalizeProviderError(input).errno).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// groupsToTouParams / touParamsToGroups
// ---------------------------------------------------------------------------

describe('groupsToTouParams', () => {
  test('returns all-zero params with TOU disabled for empty array', () => {
    const params = groupsToTouParams([]);
    expect(params.p27251).toBe(0);
    for (let i = 0; i < 4; i++) {
      expect(params[`p2724${3 + i * 2}`]).toBe(0);
      expect(params[`p2724${4 + i * 2}`]).toBe(0);
    }
  });

  test('encodes startHour:startMinute as HHMM integer', () => {
    const groups = [{
      enable: 1, workMode: 'ForceCharge',
      startHour: 22, startMinute: 30,
      endHour: 6, endMinute: 0
    }];
    const params = groupsToTouParams(groups);
    expect(params.p27243).toBe(2230);
    expect(params.p27244).toBe(600);
    expect(params.p27251).toBe(1);
  });

  test('skips disabled groups', () => {
    const groups = [
      { enable: 0, workMode: 'ForceCharge', startHour: 1, endHour: 2 },
      { enable: 1, workMode: 'ForceCharge', startHour: 3, startMinute: 0, endHour: 4, endMinute: 0 }
    ];
    const params = groupsToTouParams(groups);
    expect(params.p27243).toBe(300); // first active slot = index 0
    expect(params.p27251).toBe(1);
  });

  test('skips SelfUse / Backup modes (not TOU charge modes)', () => {
    const groups = [
      { enable: 1, workMode: 'SelfUse',  startHour: 0, endHour: 24 },
      { enable: 1, workMode: 'ForceCharge', startHour: 23, startMinute: 0, endHour: 7, endMinute: 0 }
    ];
    const params = groupsToTouParams(groups);
    // SelfUse skipped — first TOU slot gets the ForceCharge entry
    expect(params.p27243).toBe(2300);
  });

  test('limits to MAX_TOU_SLOTS (4) — extra groups are silently dropped', () => {
    const groups = Array.from({ length: 6 }, (_, i) => ({
      enable: 1, workMode: 'ForceCharge',
      startHour: i, startMinute: 0, endHour: i + 1, endMinute: 0
    }));
    const params = groupsToTouParams(groups);
    // All 4 TOU slots should be filled with the first 4 groups (indexes 0–3)
    expect(params.p27243).toBe(0);    // startHour 0 → 0*100+0 = 0
    expect(params.p27245).toBe(100);  // startHour 1 → 100
    expect(params.p27247).toBe(200);  // startHour 2 → 200
    expect(params.p27249).toBe(300);  // startHour 3 → 300
    // Group 4 and 5 are truncated — no 5th TOU slot exists in the params
    expect(Object.keys(params).filter((k) => k.startsWith('p2725')).length).toBe(1); // only p27251
    expect(params.p27251).toBe(1);
  });
});

describe('touParamsToGroups', () => {
  test('returns 4 groups always', () => {
    const groups = touParamsToGroups({ p27243: 600, p27244: 800 });
    expect(groups).toHaveLength(4);
  });

  test('marks a slot as enabled when start or end time is non-zero', () => {
    const groups = touParamsToGroups({ p27243: 600, p27244: 800 });
    expect(groups[0].enable).toBe(1);
    expect(groups[1].enable).toBe(0);
  });

  test('decodes HHMM back to hours/minutes', () => {
    const groups = touParamsToGroups({ p27243: 2230, p27244: 600 });
    expect(groups[0].startHour).toBe(22);
    expect(groups[0].startMinute).toBe(30);
    expect(groups[0].endHour).toBe(6);
    expect(groups[0].endMinute).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// normalizeRealtimePoints
// ---------------------------------------------------------------------------

describe('normalizeRealtimePoints', () => {
  test('correctly separates grid import and feed-in', () => {
    // Positive p10994 = importing
    const importing = normalizeRealtimePoints({ p10994: 500 }, null, null);
    expect(importing.gridPowerW).toBe(500);
    expect(importing.feedInPowerW).toBe(0);

    // Negative p10994 = exporting (feeding in to grid)
    const feedIn = normalizeRealtimePoints({ p10994: -700 }, null, null);
    expect(feedIn.feedInPowerW).toBe(700);
    expect(feedIn.gridPowerW).toBe(0);
  });

  test('returns null for battery temperature when point missing', () => {
    const result = normalizeRealtimePoints({ p187: 82 }, null, 'SN1');
    expect(result.batteryTempC).toBeNull();
    expect(result.socPct).toBe(82);
    expect(result.deviceSN).toBe('SN1');
  });

  test('ambientTempC is always null (not available via standard Sungrow realtime)', () => {
    const result = normalizeRealtimePoints({ p190: 30 }, null, null);
    expect(result.ambientTempC).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseRealtimeData
// ---------------------------------------------------------------------------

describe('parseRealtimeData', () => {
  test('parses array-of-{point_id, point_value} shape', () => {
    const data = {
      device_point_list: [
        { point_id: 'p187', point_value: '75' },
        { point_id: 'p190', point_value: '29.5' }
      ]
    };
    const result = parseRealtimeData(data);
    expect(result.p187).toBe(75);
    expect(result.p190).toBe(29.5);
  });

  test('parses flat object shape', () => {
    const result = parseRealtimeData({ p187: '80', p83: '3000' });
    expect(result.p187).toBe(80);
    expect(result.p83).toBe(3000);
  });

  test('returns empty object for null/undefined', () => {
    expect(parseRealtimeData(null)).toEqual({});
    expect(parseRealtimeData(undefined)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Work mode constants coverage
// ---------------------------------------------------------------------------

describe('work mode constants', () => {
  test('WORK_MODE_TO_SUNGROW covers SelfUse, ForceCharge, ForceDischarge, Backup, Feedin', () => {
    expect(WORK_MODE_TO_SUNGROW.SelfUse).toBe(2001);
    expect(WORK_MODE_TO_SUNGROW.ForceCharge).toBe(2002);
    expect(WORK_MODE_TO_SUNGROW.ForceDischarge).toBe(2003);
    expect(WORK_MODE_TO_SUNGROW.Backup).toBe(2028);
    expect(WORK_MODE_TO_SUNGROW.Feedin).toBe(2003);
  });

  test('SUNGROW_TO_WORK_MODE covers all unique values', () => {
    expect(SUNGROW_TO_WORK_MODE[2001]).toBe('SelfUse');
    expect(SUNGROW_TO_WORK_MODE[2002]).toBe('ForceCharge');
    expect(SUNGROW_TO_WORK_MODE[2003]).toBe('ForceDischarge');
    expect(SUNGROW_TO_WORK_MODE[2028]).toBe('Backup');
  });
});
