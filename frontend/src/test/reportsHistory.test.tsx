import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import Reports from '@/pages/Reports';
import * as authHooks from '@/hooks/useAuth';

const mockRef = vi.fn();
const mockQuery = vi.fn();
const mockOrderByChild = vi.fn();
const mockStartAt = vi.fn();
const mockEndAt = vi.fn();
const mockLimitToLast = vi.fn();
const mockOnValue = vi.fn();
const mockGet = vi.fn();
const mockUpdate = vi.fn();

vi.mock('firebase/database', () => ({
  ref: (...args: any[]) => mockRef(...args),
  query: (...args: any[]) => mockQuery(...args),
  orderByChild: (...args: any[]) => mockOrderByChild(...args),
  startAt: (...args: any[]) => mockStartAt(...args),
  endAt: (...args: any[]) => mockEndAt(...args),
  limitToLast: (...args: any[]) => mockLimitToLast(...args),
  onValue: (...args: any[]) => mockOnValue(...args),
  get: (...args: any[]) => mockGet(...args),
  update: (...args: any[]) => mockUpdate(...args),
  set: vi.fn(),
  push: vi.fn(),
  remove: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({
  database: {},
  firestore: {},
  auth: {},
}));

vi.mock('sonner', () => ({
  toast: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    promise: vi.fn(),
  },
}));

// Mock ResizeObserver for Recharts
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe('Historical Data & Reports Telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockRef.mockImplementation((_db: any, pathStr: string) => ({ _path: pathStr }));
    mockQuery.mockImplementation((r: any) => r);
    mockOrderByChild.mockReturnValue({} as any);
    mockStartAt.mockReturnValue({} as any);
    mockEndAt.mockReturnValue({} as any);
    mockLimitToLast.mockReturnValue({} as any);
    mockGet.mockResolvedValue({ exists: () => false } as any);
    mockUpdate.mockResolvedValue(undefined);
  });

  it('1. database.rules.json contains auth-protected history node with timestamp index under tanks/1', () => {
    const possiblePaths = [
      path.resolve(process.cwd(), 'backend/cloud/database.rules.json'),
      path.resolve(process.cwd(), '../backend/cloud/database.rules.json'),
      path.resolve(__dirname, '../../../backend/cloud/database.rules.json'),
      path.resolve(process.cwd(), 'database.rules.json'),
    ];
    const rulesPath = possiblePaths.find(p => fs.existsSync(p)) || possiblePaths[0];
    const rulesJson = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));

    expect(rulesJson.rules.history).toBeDefined();
    expect(rulesJson.rules.history['.read']).toBe('auth != null');
    expect(rulesJson.rules.history['.write']).toBe('auth != null');
    expect(rulesJson.rules.history.tanks['1']).toBeDefined();
    expect(rulesJson.rules.history.tanks['1']['.indexOn']).toContain('timestamp');
  });

  it('2. Shows "No data yet" and does NOT generate placeholder values when history is empty', async () => {
    vi.spyOn(authHooks, 'useAuth').mockReturnValue({
      currentUser: {
        id: 'user-1',
        email: 'viewer@example.com',
        username: 'ViewerUser',
        role: 'viewer',
        jobTitle: 'Inspector',
        status: 'active',
      },
      loading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      resetPassword: vi.fn(),
      clearError: vi.fn(),
    });

    mockOnValue.mockImplementation((targetRef: any, callback: any) => {
      const p = targetRef?._path || '';
      if (p === 'tanks') {
        callback({
          exists: () => true,
          val: () => ({
            '1': { id: '1', name: 'Reservoir Tank 1', enabled: true, tankHeight: 3.0, lastUpdate: Date.now() },
          }),
        });
      } else {
        // history or logs or config
        callback({
          exists: () => false,
          val: () => null,
        });
      }
      return () => {};
    });

    render(<Reports />);

    await waitFor(() => {
      const noDataElements = screen.getAllByText('No data yet');
      expect(noDataElements.length).toBeGreaterThan(0);
    });

    expect(screen.getByText(/No historical water level samples recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/No historical pH samples recorded/i)).toBeInTheDocument();
  });

  it('3. Successfully renders real historical telemetry grouped by averages and displays sensor fault nulls', async () => {
    vi.spyOn(authHooks, 'useAuth').mockReturnValue({
      currentUser: {
        id: 'admin-1',
        email: 'admin@msu.edu',
        username: 'AdminUser',
        role: 'admin',
        jobTitle: 'Lead Engineer',
        status: 'active',
      },
      loading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      resetPassword: vi.fn(),
      clearError: vi.fn(),
    });

    const now = Date.now();
    const mockHistoryData = {
      'samp-1': {
        waterLevel: 50,
        phLevel: 7.2,
        waterHeight: 2.5,
        pumpOn: false,
        timestamp: now - 3600000 * 2, // Today, 2 hours ago
      },
      'samp-2': {
        waterLevel: 60,
        phLevel: 7.4,
        waterHeight: 3.0,
        pumpOn: true,
        timestamp: now - 3600000 * 2 + 600000, // Today, 2 hours ago + 10 mins
      },
      'samp-3': {
        waterLevel: null, // Faulty level sensor marked null on separate day (yesterday)
        phLevel: 7.1,
        waterHeight: null,
        pumpOn: false,
        timestamp: now - 24 * 3600000, // Yesterday
      },
    };

    mockOnValue.mockImplementation((targetRef: any, callback: any) => {
      const p = targetRef?._path || '';
      if (p === 'tanks') {
        callback({
          exists: () => true,
          val: () => ({
            '1': { id: '1', name: 'Reservoir Tank 1', enabled: true, tankHeight: 3.0, lastUpdate: Date.now() },
          }),
        });
      } else if (p.includes('history')) {
        callback({
          exists: () => true,
          val: () => mockHistoryData,
        });
      } else {
        callback({
          exists: () => false,
          val: () => null,
        });
      }
      return () => {};
    });

    render(<Reports />);

    await waitFor(() => {
      expect(screen.getByText(/Printable Telemetry Log Table/i)).toBeInTheDocument();
      // Should show the table row and summary with averaged level (55%)
      expect(screen.getAllByText('55%').length).toBeGreaterThan(0);
      // Should display Sensor Fault for the row with null waterLevel
      expect(screen.getByText('Sensor Fault')).toBeInTheDocument();
    });
  });

  it('4. Admin opening Reports triggers 90-day monthly cleanup', async () => {
    vi.spyOn(authHooks, 'useAuth').mockReturnValue({
      currentUser: {
        id: 'admin-1',
        email: 'admin@msu.edu',
        username: 'AdminUser',
        role: 'admin',
        jobTitle: 'Lead Engineer',
        status: 'active',
      },
      loading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      resetPassword: vi.fn(),
      clearError: vi.fn(),
    });

    mockGet.mockResolvedValue({
      exists: () => true,
      forEach: (cb: any) => {
        cb({ key: 'old-samp-1' });
        cb({ key: 'old-samp-2' });
      },
    } as any);

    mockOnValue.mockImplementation((targetRef: any, callback: any) => {
      const p = targetRef?._path || '';
      if (p === 'tanks') {
        callback({
          exists: () => true,
          val: () => ({
            '1': { id: '1', name: 'Reservoir Tank 1', enabled: true, tankHeight: 3.0, lastUpdate: Date.now() },
          }),
        });
      } else {
        callback({
          exists: () => false,
          val: () => null,
        });
      }
      return () => {};
    });

    render(<Reports />);

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.anything(),
        {
          'old-samp-1': null,
          'old-samp-2': null,
        }
      );
    });

    // Check localStorage was marked for the current month
    const currentMonthKey = new Date().toISOString().slice(0, 7);
    expect(localStorage.getItem('wm_monthly_history_cleanup_1')).toBe(currentMonthKey);
  });

  it('5. Non-admin users do NOT trigger 90-day monthly cleanup', async () => {
    vi.spyOn(authHooks, 'useAuth').mockReturnValue({
      currentUser: {
        id: 'worker-1',
        email: 'worker@msu.edu',
        username: 'WorkerUser',
        role: 'worker',
        jobTitle: 'Field Tech',
        status: 'active',
      },
      loading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      resetPassword: vi.fn(),
      clearError: vi.fn(),
    });

    mockOnValue.mockImplementation((targetRef: any, callback: any) => {
      const p = targetRef?._path || '';
      if (p === 'tanks') {
        callback({
          exists: () => true,
          val: () => ({
            '1': { id: '1', name: 'Reservoir Tank 1', enabled: true, tankHeight: 3.0, lastUpdate: Date.now() },
          }),
        });
      } else {
        callback({
          exists: () => false,
          val: () => null,
        });
      }
      return () => {};
    });

    render(<Reports />);

    await waitFor(() => {
      expect(screen.getByText(/Printable Telemetry Log Table/i)).toBeInTheDocument();
    });

    expect(mockGet).not.toHaveBeenCalled();
  });

  it('6. Export buttons display "No data to export" and are disabled when range is empty', async () => {
    vi.spyOn(authHooks, 'useAuth').mockReturnValue({
      currentUser: {
        id: 'admin-1',
        email: 'admin@msu.edu',
        username: 'AdminUser',
        role: 'admin',
        jobTitle: 'Lead Engineer',
        status: 'active',
      },
      loading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      resetPassword: vi.fn(),
      clearError: vi.fn(),
    });

    mockOnValue.mockImplementation((targetRef: any, callback: any) => {
      const p = targetRef?._path || '';
      if (p === 'tanks') {
        callback({
          exists: () => true,
          val: () => ({
            '1': { id: '1', name: 'Reservoir Tank 1', enabled: true, tankHeight: 3.0, lastUpdate: Date.now() },
          }),
        });
      } else {
        callback({
          exists: () => false,
          val: () => null,
        });
      }
      return () => {};
    });

    render(<Reports />);

    await waitFor(() => {
      expect(screen.getByText('Document & Telemetry Export')).toBeInTheDocument();
    });

    // Check that "No data to export" badge and disabled buttons are present
    const noDataBadges = screen.getAllByText(/No data to export/i);
    expect(noDataBadges.length).toBeGreaterThan(0);

    const excelButton = screen.getByRole('button', { name: /Excel.*No data to export/i });
    expect(excelButton).toBeDisabled();

    const pdfButton = screen.getByRole('button', { name: /PDF.*No data to export/i });
    expect(pdfButton).toBeDisabled();

    const csvButton = screen.getByRole('button', { name: /CSV.*No data to export/i });
    expect(csvButton).toBeDisabled();
  });

  it('7. Export buttons are NOT rendered for viewer role', async () => {
    vi.spyOn(authHooks, 'useAuth').mockReturnValue({
      currentUser: {
        id: 'viewer-1',
        email: 'viewer@msu.edu',
        username: 'ViewerUser',
        role: 'viewer',
        jobTitle: 'Observer',
        status: 'active',
      },
      loading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      resetPassword: vi.fn(),
      clearError: vi.fn(),
    });

    mockOnValue.mockImplementation((targetRef: any, callback: any) => {
      const p = targetRef?._path || '';
      if (p === 'tanks') {
        callback({
          exists: () => true,
          val: () => ({
            '1': { id: '1', name: 'Reservoir Tank 1', enabled: true, tankHeight: 3.0, lastUpdate: Date.now() },
          }),
        });
      } else {
        callback({
          exists: () => false,
          val: () => null,
        });
      }
      return () => {};
    });

    render(<Reports />);

    await waitFor(() => {
      expect(screen.getByText(/Printable Telemetry Log Table/i)).toBeInTheDocument();
    });

    // Viewer should not have the Document & Telemetry Export panel
    expect(screen.queryByText('Document & Telemetry Export')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download Excel/i })).not.toBeInTheDocument();
  });

  it('8. Admin or worker can export Excel (.xlsx) and PDF (.pdf) with real data and correct filename', async () => {
    window.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    window.URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    vi.spyOn(authHooks, 'useAuth').mockReturnValue({
      currentUser: {
        id: 'admin-1',
        email: 'admin@msu.edu',
        username: 'AdminUser',
        role: 'admin',
        jobTitle: 'Lead Engineer',
        status: 'active',
      },
      loading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      resetPassword: vi.fn(),
      clearError: vi.fn(),
    });

    const now = Date.now();
    const mockHistoryData = {
      'samp-1': {
        waterLevel: 55,
        phLevel: 7.2,
        waterHeight: 2.2,
        pumpOn: false,
        timestamp: now - 3600000,
      },
    };

    mockOnValue.mockImplementation((targetRef: any, callback: any) => {
      const p = targetRef?._path || '';
      if (p === 'tanks') {
        callback({
          exists: () => true,
          val: () => ({
            '1': { id: '1', name: 'Reservoir Tank 1', enabled: true, tankHeight: 3.0, lastUpdate: Date.now() },
          }),
        });
      } else if (p.includes('history')) {
        callback({
          exists: () => true,
          val: () => mockHistoryData,
        });
      } else {
        callback({
          exists: () => false,
          val: () => null,
        });
      }
      return () => {};
    });

    render(<Reports />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Download Excel \(\.xlsx\)/i })).toBeInTheDocument();
    });

    const excelButton = screen.getByRole('button', { name: /Download Excel \(\.xlsx\)/i });
    expect(excelButton).toBeEnabled();

    const pdfButton = screen.getByRole('button', { name: /Export PDF Document/i });
    expect(pdfButton).toBeEnabled();

    const today = new Date().toISOString().split('T')[0];

    // Trigger Excel export
    excelButton.click();

    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalled();
      const clickedAnchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
      expect(clickedAnchor.download).toBe(`WaterReport_Tank1_${today}.xlsx`);
    });

    clickSpy.mockRestore();
  });
});
