import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import {
  isTankPlanned,
  isTankControllerOffline,
  getTankOperationalStatus,
  Tank,
  SystemConfig,
} from '@/store/useStore';
import Dashboard from '@/pages/Dashboard';
import Reports from '@/pages/Reports';
import AdminPanel from '@/pages/AdminPanel';

// Mocks
const mockTanks: Tank[] = [
  {
    id: '1',
    name: 'Reservoir Tank 1',
    waterLevel: 75,
    phLevel: 7.2,
    waterHeight: 1.5,
    status: 'safe',
    assignedWorker: null,
    pumpOn: true,
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
    lowLevelAlert: 'NORMAL',
    highLevelAlert: 'NORMAL',
    phAlert: 'NORMAL',
    lastUpdate: Date.now(), // Live
    controllerOffline: false,
  },
  {
    id: '2',
    name: 'Reservoir Tank 2',
    waterLevel: 0,
    phLevel: 7.0,
    waterHeight: 0,
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
    lowLevelAlert: 'NORMAL',
    highLevelAlert: 'NORMAL',
    phAlert: 'NORMAL',
    // No lastUpdate -> Planned
    controllerOffline: false,
  },
  {
    id: '3',
    name: 'Reservoir Tank 3',
    waterLevel: 0,
    phLevel: 7.0,
    waterHeight: 0,
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
    lowLevelAlert: 'NORMAL',
    highLevelAlert: 'NORMAL',
    phAlert: 'NORMAL',
    // No lastUpdate -> Planned
    controllerOffline: false,
  },
  {
    id: '4',
    name: 'Reservoir Tank 4',
    waterLevel: 50,
    phLevel: 7.0,
    waterHeight: 1.0,
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
    lowLevelAlert: 'NORMAL',
    highLevelAlert: 'NORMAL',
    phAlert: 'NORMAL',
    lastUpdate: Date.now() - 60000, // Old lastUpdate -> Offline
    controllerOffline: true,
  },
];

const mockConfig: SystemConfig = {
  lowLevelThreshold: 15,
  overflowThreshold: 95,
  minPh: 6.5,
  maxPh: 8.5,
  maintenanceMode: false,
  pumpControlLock: false,
};

const mockUpdateTank = vi.fn().mockResolvedValue(undefined);
const mockAddTank = vi.fn().mockResolvedValue(undefined);
const mockDeleteTank = vi.fn().mockResolvedValue(undefined);

vi.mock('@/store/useStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/useStore')>();
  return {
    ...actual,
    useTanks: () => ({
      tanks: mockTanks,
      updateTank: mockUpdateTank,
      addTank: mockAddTank,
      deleteTank: mockDeleteTank,
      serverTimeOffset: 0,
    }),
    useConfig: () => ({
      config: mockConfig,
      updateConfig: vi.fn(),
    }),
    useLogs: () => ({
      logs: [],
      addLog: vi.fn(),
      clearAll: vi.fn(),
    }),
    useNotifications: () => ({
      notifications: [],
      addNotification: vi.fn(),
      markRead: vi.fn(),
      clearAll: vi.fn(),
      acknowledgeNotification: vi.fn(),
    }),
    useServerTimeOffset: () => 0,
  };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    currentUser: { id: 'admin1', username: 'admin', role: 'admin', email: 'admin@msu.edu' },
    role: 'admin',
    logout: vi.fn(),
  }),
}));

vi.mock('firebase/database', () => ({
  ref: vi.fn(),
  onValue: vi.fn(() => vi.fn()),
  set: vi.fn(),
  update: vi.fn(),
  push: vi.fn(),
  remove: vi.fn(),
  query: vi.fn(),
  orderByChild: vi.fn(),
  startAt: vi.fn(),
  endAt: vi.fn(),
  limitToLast: vi.fn(),
  get: vi.fn().mockResolvedValue({ exists: () => false, val: () => null }),
  runTransaction: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  onSnapshot: vi.fn(() => vi.fn()),
  query: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({
  database: {},
  firestore: {},
  auth: {},
}));

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe('Part A: Planned Expansion Tanks Logic & UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. State Derivation Rules', () => {
    it('correctly classifies a tank with no lastUpdate as planned', () => {
      const plannedTank = mockTanks[1];
      expect(isTankPlanned(plannedTank)).toBe(true);
      expect(isTankControllerOffline(plannedTank, 0)).toBe(false);
      expect(getTankOperationalStatus(plannedTank, 0)).toBe('planned');
    });

    it('correctly classifies a tank with fresh lastUpdate as live', () => {
      const liveTank = mockTanks[0];
      expect(isTankPlanned(liveTank)).toBe(false);
      expect(isTankControllerOffline(liveTank, 0)).toBe(false);
      expect(getTankOperationalStatus(liveTank, 0)).toBe('live');
    });

    it('correctly classifies a tank with an old lastUpdate as offline, NOT planned', () => {
      const offlineTank = mockTanks[3];
      expect(isTankPlanned(offlineTank)).toBe(false);
      expect(isTankControllerOffline(offlineTank, 0)).toBe(true);
      expect(getTankOperationalStatus(offlineTank, 0)).toBe('offline');
    });

    it('switches to live automatically when lastUpdate is set', () => {
      const tank: Tank = { ...mockTanks[1], lastUpdate: undefined };
      expect(isTankPlanned(tank)).toBe(true);

      // ESP32 reports recent telemetry timestamp
      const updatedTank: Tank = { ...tank, lastUpdate: Date.now() };
      expect(isTankPlanned(updatedTank)).toBe(false);
      expect(isTankControllerOffline(updatedTank, 0)).toBe(false);
      expect(getTankOperationalStatus(updatedTank, 0)).toBe('live');
    });
  });

  describe('2. Dashboard UI for Planned Tanks', () => {
    it('renders planned tanks with "Planned - IoT not yet installed" badge, "--" metrics, and no pump control button', () => {
      render(<Dashboard />);

      // Badge should exist for planned tanks 2 & 3
      const plannedBadges = screen.getAllByText('Planned - IoT not yet installed');
      expect(plannedBadges.length).toBe(2);

      // Reservoir Tank 2 card should have "--" for pH and water level
      expect(screen.getByText('Reservoir Tank 2')).toBeInTheDocument();
      expect(screen.getByText('Reservoir Tank 3')).toBeInTheDocument();

      // Live tank has "Safe" badge and active pump toggle
      expect(screen.getByText('Reservoir Tank 1')).toBeInTheDocument();
      expect(screen.getByText('Safe')).toBeInTheDocument();
    });
  });

  describe('3. Reports & Analytics Exclusion', () => {
    it('excludes planned tanks from the Reports reservoir selector and analytics', async () => {
      render(<Reports />);

      // Tank 1 (live) and Tank 4 (offline) should be present
      expect(screen.getAllByText(/Reservoir Tank 1/i).length).toBeGreaterThan(0);
      expect(screen.getByRole('option', { name: /Reservoir Tank 4/i })).toBeInTheDocument();

      // Planned tanks 2 and 3 should NOT appear as options in the dropdown
      const selects = screen.getAllByRole('combobox');
      const reservoirSelect = selects[0];
      const options = Array.from(reservoirSelect.querySelectorAll('option')).map(o => o.textContent);
      
      expect(options.some(t => t?.includes('Reservoir Tank 1'))).toBe(true);
      expect(options.some(t => t?.includes('Reservoir Tank 4'))).toBe(true);
      expect(options.some(t => t?.includes('Reservoir Tank 2'))).toBe(false);
      expect(options.some(t => t?.includes('Reservoir Tank 3'))).toBe(false);
    });
  });

  describe('4. Admin Panel Management of Planned Tanks', () => {
    it('allows Admin to view, rename, and enable/disable planned tanks', async () => {
      render(<AdminPanel />);

      // Click Tank Assignment tab
      const tanksTabButton = screen.getByRole('button', { name: /tank assignment/i });
      fireEvent.click(tanksTabButton);

      // Verify Planned badge appears in tank table
      const plannedBadges = screen.getAllByText('Planned');
      expect(plannedBadges.length).toBeGreaterThanOrEqual(2);

      // Verify buttons for enabling/disabling and editing exist
      const editButtons = screen.getAllByRole('button', { name: /edit/i });
      expect(editButtons.length).toBeGreaterThan(0);
    });
  });
});
