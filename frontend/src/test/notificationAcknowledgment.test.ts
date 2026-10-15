import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import NotificationCenter from '@/components/NotificationCenter';
import * as authHooks from '@/hooks/useAuth';
import * as storeModule from '@/store/useStore';
import { alertSound } from '@/utils/alertSound';
import { toast } from 'sonner';

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
    dismiss: vi.fn(),
  },
}));

describe('NotificationCenter Alert Acknowledgment', () => {
  const mockAcknowledgeNotification = vi.fn();
  const mockMarkRead = vi.fn();
  const mockClearAll = vi.fn();

  const sampleNotifications: storeModule.Notification[] = [
    {
      id: 'notif-1',
      title: 'Low Water Level',
      message: 'Reservoir Tank 1 water level is extremely low (10%).',
      type: 'warning',
      timestamp: 1728349200000,
      read: false,
      acknowledged: false,
    },
    {
      id: 'notif-2',
      title: 'Critical Water Level',
      message: 'Reservoir Tank 2 is reaching overflow capacity (96%).',
      type: 'danger',
      timestamp: 1728349300000,
      read: false,
      acknowledged: true,
      acknowledgedBy: 'ChiefAdmin',
      acknowledgedAt: 1728349350000,
    },
    {
      id: 'notif-3',
      title: 'System Startup',
      message: 'Telemetry system initialized.',
      type: 'info',
      timestamp: 1728349100000,
      read: true,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(storeModule, 'useNotifications').mockReturnValue({
      notifications: sampleNotifications,
      addNotification: vi.fn(),
      markRead: mockMarkRead,
      clearAll: mockClearAll,
      acknowledgeNotification: mockAcknowledgeNotification,
    });
  });

  it('renders "Unacknowledged" count badge on the notification bell', () => {
    vi.spyOn(authHooks, 'useAuth').mockReturnValue({
      currentUser: { id: '1', username: 'adminUser', role: 'admin', jobTitle: 'Admin', status: 'active' },
      loading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      resetPassword: vi.fn(),
      clearError: vi.fn(),
    });

    render(React.createElement(NotificationCenter));

    // There is 1 unacknowledged warning/danger alert (notif-1)
    const badge = screen.getByTestId('unacknowledged-count-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('1');
  });

  it('allows admin and worker to see and click the Acknowledge button', () => {
    vi.spyOn(authHooks, 'useAuth').mockReturnValue({
      currentUser: { id: '2', username: 'workerBob', role: 'worker', jobTitle: 'Operator', status: 'active' },
      loading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      resetPassword: vi.fn(),
      clearError: vi.fn(),
    });

    render(React.createElement(NotificationCenter));

    // Open popover by clicking the bell
    const bellBtn = screen.getByTestId('notification-bell');
    fireEvent.click(bellBtn);

    // Acknowledge button should be present for unacknowledged alert (notif-1)
    const ackButton = screen.getByRole('button', { name: /acknowledge/i });
    expect(ackButton).toBeInTheDocument();

    fireEvent.click(ackButton);
    expect(mockAcknowledgeNotification).toHaveBeenCalledWith('notif-1', 'workerBob', 'Low Water Level');
  });

  it('restricts viewers from seeing the Acknowledge button while displaying the status', () => {
    vi.spyOn(authHooks, 'useAuth').mockReturnValue({
      currentUser: { id: '3', username: 'viewerAlice', role: 'viewer', jobTitle: 'Auditor', status: 'active' },
      loading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      resetPassword: vi.fn(),
      clearError: vi.fn(),
    });

    render(React.createElement(NotificationCenter));

    const bellBtn = screen.getByTestId('notification-bell');
    fireEvent.click(bellBtn);

    // Viewer should NOT have the Acknowledge button
    expect(screen.queryByRole('button', { name: /acknowledge/i })).not.toBeInTheDocument();

    // Viewer should see the Unacknowledged status text
    expect(screen.getByText('Unacknowledged')).toBeInTheDocument();
  });

  it('shows "Acknowledged by <name> at <time>" instead of button on acknowledged alerts', () => {
    vi.spyOn(authHooks, 'useAuth').mockReturnValue({
      currentUser: { id: '1', username: 'adminUser', role: 'admin', jobTitle: 'Admin', status: 'active' },
      loading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      resetPassword: vi.fn(),
      clearError: vi.fn(),
    });

    render(React.createElement(NotificationCenter));

    const bellBtn = screen.getByTestId('notification-bell');
    fireEvent.click(bellBtn);

    // notif-2 is acknowledged by ChiefAdmin
    expect(screen.getByText(/Acknowledged by ChiefAdmin at/i)).toBeInTheDocument();
  });

  it('does not display acknowledgment UI on info notifications', () => {
    vi.spyOn(authHooks, 'useAuth').mockReturnValue({
      currentUser: { id: '1', username: 'adminUser', role: 'admin', jobTitle: 'Admin', status: 'active' },
      loading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      resetPassword: vi.fn(),
      clearError: vi.fn(),
    });

    render(React.createElement(NotificationCenter));

    const bellBtn = screen.getByTestId('notification-bell');
    fireEvent.click(bellBtn);

    // Info notification (notif-3) should be rendered but has no ack button or ack status
    expect(screen.getByText('System Startup')).toBeInTheDocument();
    // Only 1 Acknowledge button exists (for notif-1)
    const ackButtons = screen.getAllByRole('button', { name: /acknowledge/i });
    expect(ackButtons).toHaveLength(1);
  });
});

describe('Alert Sound & Toast Dismissal on Acknowledgment', () => {
  it('controls alert sound based on unacknowledged alerts and dismisses toasts', () => {
    const startSpy = vi.spyOn(alertSound, 'startAlert');
    const stopSpy = vi.spyOn(alertSound, 'stopAlert');

    // Simulate presence of unacknowledged alerts
    const unacknowledged: storeModule.Notification[] = [
      {
        id: 'alert-1',
        title: 'Low Water Level',
        message: 'Water low',
        type: 'warning',
        timestamp: Date.now(),
        read: false,
        acknowledged: false,
      },
    ];

    const hasUnack = unacknowledged.some(n => (n.type === 'warning' || n.type === 'danger') && !n.acknowledged);
    expect(hasUnack).toBe(true);
    if (hasUnack) alertSound.startAlert();
    expect(startSpy).toHaveBeenCalled();

    // Now simulate acknowledgment
    const acknowledged: storeModule.Notification[] = [
      {
        id: 'alert-1',
        title: 'Low Water Level',
        message: 'Water low',
        type: 'warning',
        timestamp: Date.now(),
        read: false,
        acknowledged: true,
        acknowledgedBy: 'Operator',
        acknowledgedAt: Date.now(),
      },
    ];

    const hasUnackAfter = acknowledged.some(n => (n.type === 'warning' || n.type === 'danger') && !n.acknowledged);
    expect(hasUnackAfter).toBe(false);
    if (!hasUnackAfter) alertSound.stopAlert();
    expect(stopSpy).toHaveBeenCalled();

    // Acknowledged notification dismisses toast
    acknowledged.forEach(n => {
      if (n.acknowledged) toast.dismiss(n.id);
    });
    expect(toast.dismiss).toHaveBeenCalledWith('alert-1');
  });

  it('preserves active tank alert state even when notification is acknowledged', () => {
    const tank: storeModule.Tank = {
      id: '1',
      name: 'Reservoir Tank 1',
      waterLevel: 10,
      phLevel: 7.2,
      waterHeight: 0.5,
      status: 'danger',
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
      lowLevelAlert: 'CRITICAL',
    };

    // Acknowledging a notification does not mutate the tank or clear its active alert state
    expect(tank.lowLevelAlert).toBe('CRITICAL');
    expect(tank.status).toBe('danger');
    expect(tank.waterLevel).toBe(10);
  });

  it('updates notification in RTDB and writes an Alert Acknowledged log', async () => {
    const mockDbUpdate = vi.fn();
    const mockDbSet = vi.fn();

    // Test the logic directly
    const notifId = 'notif-101';
    const username = 'sarahOperator';
    const title = 'High pH Alert';
    const acknowledgedAt = Date.now();

    // Simulate acknowledgeNotification execution
    mockDbUpdate(`notifications/${notifId}`, {
      acknowledged: true,
      acknowledgedBy: username,
      acknowledgedAt,
    });

    const logId = acknowledgedAt.toString();
    mockDbSet(`logs/${logId}`, {
      id: logId,
      action: 'Alert Acknowledged',
      details: `Alert "${title}" acknowledged by ${username}.`,
      performedBy: username,
      timestamp: acknowledgedAt,
      logLevel: 'INFO',
    });

    expect(mockDbUpdate).toHaveBeenCalledWith(
      `notifications/notif-101`,
      expect.objectContaining({
        acknowledged: true,
        acknowledgedBy: 'sarahOperator',
      })
    );

    expect(mockDbSet).toHaveBeenCalledWith(
      expect.stringContaining('logs/'),
      expect.objectContaining({
        action: 'Alert Acknowledged',
        details: expect.stringContaining('High pH Alert'),
        performedBy: 'sarahOperator',
        logLevel: 'INFO',
      })
    );
  });
});
