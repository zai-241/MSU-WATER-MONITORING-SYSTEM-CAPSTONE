import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isTankControllerOffline,
  isTankPlanned,
  getTankOperationalStatus,
  syncTankOfflineState,
  CONTROLLER_OFFLINE_THRESHOLD_MS,
  Tank
} from '@/store/useStore';
import { formatLastSeen, formatRelativeTime } from '@/pages/Dashboard';

const mockRunTransaction = vi.fn();
const mockRef = vi.fn();

vi.mock('firebase/database', () => ({
  ref: (...args: any[]) => mockRef(...args),
  runTransaction: (...args: any[]) => mockRunTransaction(...args),
  onValue: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  push: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({
  database: {},
  firestore: {},
  auth: {},
}));

describe('Controller Offline Detection & Time Offset', () => {
  const baseTank: Tank = {
    id: '1',
    name: 'Reservoir Tank 1',
    waterLevel: 50,
    phLevel: 7.0,
    waterHeight: 1.2,
    status: 'safe',
    assignedWorker: null,
    pumpOn: false,
    enabled: true,
    levelVmin: 0.25,
    levelVmax: 3.0,
    tankHeight: 5.0,
    levelOffset: 0,
    phNeutralVoltage: 2.5,
    phSlope: 0.18,
    phOffset: 0.0,
    phSensorOk: true,
    levelSensorOk: true,
  };

  it('classifies tank as planned (not offline) when lastUpdate has never been set', () => {
    const tank = { ...baseTank, lastUpdate: undefined };
    expect(isTankPlanned(tank)).toBe(true);
    expect(isTankControllerOffline(tank, 0)).toBe(false);
    expect(getTankOperationalStatus(tank, 0)).toBe('planned');
  });

  it('marks tank as online when lastUpdate is fresh (<= 30s)', () => {
    const now = Date.now();
    const tank = { ...baseTank, lastUpdate: now - 15000 }; // 15s ago
    expect(isTankControllerOffline(tank, 0)).toBe(false);

    const tank29s = { ...baseTank, lastUpdate: now - 29000 }; // 29s ago
    expect(isTankControllerOffline(tank29s, 0)).toBe(false);
  });

  it('marks tank as offline when lastUpdate is older than 30 seconds', () => {
    const now = Date.now();
    const tank31s = { ...baseTank, lastUpdate: now - 31000 }; // 31s ago
    expect(isTankControllerOffline(tank31s, 0)).toBe(true);

    const tank60s = { ...baseTank, lastUpdate: now - 60000 }; // 60s ago
    expect(isTankControllerOffline(tank60s, 0)).toBe(true);
  });

  it('uses Firebase serverTimeOffset rather than browser clock to avoid false offline states', () => {
    const clientNow = 1000000;
    vi.spyOn(Date, 'now').mockReturnValue(clientNow);

    // Scenario A: Client clock is lagging.
    // Tank last update was at 975000.
    // Client-only diff: 1000000 - 975000 = 25000 (<= 30s, looks online to local clock)
    // BUT true Firebase server time is clientNow + 10000 = 1010000.
    // Server-adjusted diff: 1010000 - 975000 = 35000 (> 30s) -> properly marked offline!
    const tankA = { ...baseTank, lastUpdate: 975000 };
    expect(isTankControllerOffline(tankA, 0)).toBe(false); // local clock was deceived
    expect(isTankControllerOffline(tankA, 10000)).toBe(true); // server offset catches it!

    // Scenario B: Client clock is ahead causing false offline.
    // Tank last update was at 965000.
    // Client-only diff: 1000000 - 965000 = 35000 (> 30s, false offline on bad client clock!)
    // BUT true serverTimeOffset is -10000 (server time is 990000).
    // Server-adjusted diff: 990000 - 965000 = 25000 (<= 30s) -> prevents false offline!
    const tankB = { ...baseTank, lastUpdate: 965000 };
    expect(isTankControllerOffline(tankB, 0)).toBe(true); // false offline without offset
    expect(isTankControllerOffline(tankB, -10000)).toBe(false); // correctly online with server offset!

    vi.restoreAllMocks();
  });
});

describe('Deduplicated Offline/Recovery Logging via RTDB Transactions', () => {
  beforeEach(() => {
    mockRunTransaction.mockReset();
    mockRef.mockReset();
    mockRef.mockReturnValue({});
  });

  it('writes one log entry on transition to offline and aborts on duplicate calls', async () => {
    let databaseValue: boolean | null = false;
    const addLog = vi.fn();

    mockRunTransaction.mockImplementation(async (_ref: any, updateFn: any) => {
      const newVal = updateFn(databaseValue);
      if (newVal === undefined) {
        return { committed: false, snapshot: { val: () => databaseValue } };
      }
      databaseValue = newVal;
      return { committed: true, snapshot: { val: () => databaseValue } };
    });

    // 1st client runs transaction -> should commit and write log
    const res1 = await syncTankOfflineState('1', 'Reservoir Tank 1', true, addLog);
    expect(res1).toBe(true);
    expect(addLog).toHaveBeenCalledTimes(1);
    expect(addLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CONTROLLER_OFFLINE',
      logLevel: 'WARNING',
    }));

    // 2nd client (another tab/user) tries same transaction -> aborted, NO duplicate log!
    const res2 = await syncTankOfflineState('1', 'Reservoir Tank 1', true, addLog);
    expect(res2).toBe(false);
    expect(addLog).toHaveBeenCalledTimes(1); // still only 1!
  });

  it('writes one log entry on recovery and aborts on duplicate calls', async () => {
    let databaseValue: boolean | null = true; // currently offline
    const addLog = vi.fn();

    mockRunTransaction.mockImplementation(async (_ref: any, updateFn: any) => {
      const newVal = updateFn(databaseValue);
      if (newVal === undefined) {
        return { committed: false, snapshot: { val: () => databaseValue } };
      }
      databaseValue = newVal;
      return { committed: true, snapshot: { val: () => databaseValue } };
    });

    // 1st client detects recovery -> commits and writes log
    const res1 = await syncTankOfflineState('1', 'Reservoir Tank 1', false, addLog);
    expect(res1).toBe(true);
    expect(addLog).toHaveBeenCalledTimes(1);
    expect(addLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CONTROLLER_RECOVERED',
      logLevel: 'INFO',
    }));

    // 2nd client tries recovery transaction -> aborted, NO duplicate log!
    const res2 = await syncTankOfflineState('1', 'Reservoir Tank 1', false, addLog);
    expect(res2).toBe(false);
    expect(addLog).toHaveBeenCalledTimes(1); // still only 1!
  });
});

describe('Dashboard UI Helpers', () => {
  it('formats last-seen relative timestamps correctly', () => {
    const serverTime = 1700000000000;
    expect(formatLastSeen(undefined, serverTime)).toBe('Never');
    expect(formatLastSeen(serverTime - 2000, serverTime)).toBe('just now');
    expect(formatLastSeen(serverTime - 25000, serverTime)).toBe('25s ago');
    expect(formatLastSeen(serverTime - 120000, serverTime)).toBe('2m ago');
    expect(formatLastSeen(serverTime - 7200000, serverTime)).toBe('2h ago');
  });

  it('formats relative elapsed time correctly', () => {
    expect(formatRelativeTime(3)).toBe('just now');
    expect(formatRelativeTime(15)).toBe('15s ago');
    expect(formatRelativeTime(120)).toBe('2m ago');
    expect(formatRelativeTime(4000)).toBe('more than an hour ago');
  });
});
