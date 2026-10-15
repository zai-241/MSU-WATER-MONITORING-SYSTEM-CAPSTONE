/**
 * @file useStore.ts
 * @description Centralized state management for the Water Monitoring System.
 *
 * This store orchestrates the end‑to‑end telemetry flow between the ESP32 firmware,
 * Firebase Realtime Database, and the React frontend. Sensor data (water level,
 * pH, RSSI, connection status) is streamed from the ESP32, persisted in
 * Firebase, and synchronized here via onValue listeners. The UI components pull
 * from this store to render dashboards, logs, notifications, and configuration
 * panels.
 *
 * Key responsibilities include:
 *   • Loading initial state from localStorage for offline resilience.
 *   • Subscribing to Firebase paths for real‑time updates of users, tanks,
 *     configuration, notifications, and logs.
 *   • Providing CRUD helper functions (addUser, updateTank, addLog, etc.) that
 *     write back to Firebase and update local cache.
 *   • Exposing utility hooks (useAuth, useClock) used throughout the app.
 *
 * The architecture follows a unidirectional data flow: ESP32 → Firebase →
 * useStore (real‑time listeners) → React components. This ensures the UI always
 * reflects the latest telemetry while keeping the codebase modular and testable.
 */
import { useState, useEffect, useCallback } from 'react';
import { database } from '@/config/firebase';
import { ref, onValue, set, update, push, remove, runTransaction } from 'firebase/database';

export type UserRole = 'admin' | 'worker' | 'viewer';
export type TankStatus = 'safe' | 'warning' | 'danger' | 'offline';

export interface User {
  id: string;
  username: string;
  password?: string;
  role: UserRole;
  jobTitle: string;
  status: 'active' | 'inactive';
}

export interface Tank {
  id: string;
  name: string;
  waterLevel: number;
  phLevel: number;
  waterHeight: number;
  status: TankStatus;
  assignedWorker: string | null;
  pumpOn: boolean;
  enabled: boolean;
  
  /**
   * Calibration parameters used to convert raw sensor voltages to meaningful values.
   * These are configurable per‑tank to allow fine‑tuning of sensor accuracy.
   */
  /** Minimum voltage reading for the water level sensor (V) */
  levelVmin: number;
  /** Maximum voltage reading for the water level sensor (V) */
  levelVmax: number;
  /** Physical height of the tank (meters) */
  tankHeight: number;
  /** User‑defined offset applied to the calculated water level */
  levelOffset: number;
  /** Voltage reading corresponding to neutral pH (7.0) */
  phNeutralVoltage: number;
  /** Slope factor to convert voltage difference to pH units */
  phSlope: number;
  /** Additional offset applied to pH calculation */
  phOffset: number;

  // Sensor Validation Status
  phSensorOk: boolean;
  levelSensorOk: boolean;

  // Stable Alert States
  lowLevelAlert?: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'RECOVERED';
  highLevelAlert?: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'RECOVERED';
  phAlert?: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'RECOVERED';

  // Connection Telemetry Fields
  lastUpdate?: number;
  rssi?: number;
  wifiConnected?: boolean;
  firebaseConnected?: boolean;
  ethConnected?: boolean;
  location?: string;
  controllerOffline?: boolean;
}

export interface SystemConfig {
  lowLevelThreshold: number;
  overflowThreshold: number;
  minPh: number;
  maxPh: number;
  maintenanceMode: boolean;
  pumpControlLock: boolean;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'danger';
  timestamp: number;
  read: boolean;
  acknowledged?: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: number;
}

/**
   * Represents an event log entry recorded by the system.
   */
  export interface Log {
    /** Unique identifier for the log entry */
    id: string;
    /** Short description of the action performed */
    action: string;
    /** Detailed information about the event */
    details: string;
    /** Identifier of the user or system component that triggered the log */
    performedBy: string;
    /** Unix timestamp (ms) when the log was created */
    timestamp: number;
    /** Severity level of the log entry */
    logLevel?: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  }

const DEFAULT_TANKS: Tank[] = [
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
    lastUpdate: Date.now(),
    rssi: -50,
    wifiConnected: true,
    firebaseConnected: true,
    ethConnected: false,
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
    // Planned expansion tank: IoT not yet installed (never had lastUpdate)
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
    // Planned expansion tank: IoT not yet installed (never had lastUpdate)
    controllerOffline: false,
  },
  {
    id: '4',
    name: 'Reservoir Tank 4',
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
    // Planned expansion tank: IoT not yet installed (never had lastUpdate)
    controllerOffline: false,
  },
];

const DEFAULT_CONFIG: SystemConfig = {
  lowLevelThreshold: 15,
  overflowThreshold: 95,
  minPh: 6.5,
  maxPh: 8.5,
  maintenanceMode: false,
  pumpControlLock: false,
};

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : fallback;
  } catch { return fallback; }
}

function saveToStorage(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

/**
 * Hook to retrieve Firebase server time offset from '/.info/serverTimeOffset'.
 * Realtime Database measures the difference in milliseconds between the client's clock
 * and Firebase server time.
 * Estimated Server Time = Date.now() + serverTimeOffset
 */
export function useServerTimeOffset(): number {
  const [offset, setOffset] = useState<number>(0);

  useEffect(() => {
    const offsetRef = ref(database, '.info/serverTimeOffset');
    const unsubscribe = onValue(
      offsetRef,
      (snapshot) => {
        const val = snapshot.val();
        if (typeof val === 'number') {
          setOffset(val);
        }
      },
      (error) => {
        console.error('Error reading serverTimeOffset from database:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  return offset;
}

export const CONTROLLER_OFFLINE_THRESHOLD_MS = 30000; // 30 seconds

/**
 * Checks whether a tank is a planned expansion tank (IoT hardware not yet installed).
 * Rule: A tank is "planned" only if it has never had a lastUpdate.
 */
export function isTankPlanned(tank: Tank | null | undefined): boolean {
  if (!tank) return false;
  return !tank.lastUpdate;
}

/**
 * Checks whether a tank's controller is offline by comparing its lastUpdate
 * against the estimated Firebase server time (Date.now() + serverTimeOffset).
 * Rule: A tank with an old lastUpdate is "offline", not "planned".
 * A tank that has never had a lastUpdate is "planned", not "offline".
 */
export function isTankControllerOffline(tank: Tank, serverTimeOffset: number = 0): boolean {
  if (!tank.lastUpdate) return false;
  const currentServerTime = Date.now() + serverTimeOffset;
  return (currentServerTime - tank.lastUpdate) > CONTROLLER_OFFLINE_THRESHOLD_MS;
}

export type TankOperationalStatus = 'planned' | 'offline' | 'live';

/**
 * Derives operational status ('planned' | 'offline' | 'live') from telemetry without writing connected flags to DB.
 */
export function getTankOperationalStatus(tank: Tank, serverTimeOffset: number = 0): TankOperationalStatus {
  if (isTankPlanned(tank)) return 'planned';
  if (isTankControllerOffline(tank, serverTimeOffset)) return 'offline';
  return 'live';
}

/**
 * Atomically updates a tank's controllerOffline flag in Firebase Realtime Database
 * and writes a log entry only if the transaction committed the change.
 * This prevents duplicate log entries when multiple users or tabs have the dashboard open.
 */
export async function syncTankOfflineState(
  tankId: string,
  tankName: string,
  shouldBeOffline: boolean,
  addLogFn: (log: Omit<Log, 'id' | 'timestamp'>) => void
): Promise<boolean> {
  if (!tankId) return false;
  const flagRef = ref(database, `tanks/${tankId}/controllerOffline`);

  try {
    const result = await runTransaction(flagRef, (currentVal) => {
      // Transitioning to offline:
      if (shouldBeOffline) {
        if (currentVal === true) {
          // Already marked offline, abort transaction to prevent duplicate log
          return undefined;
        }
        return true;
      } else {
        // Transitioning to recovered (online):
        if (currentVal === false || currentVal === null || currentVal === undefined) {
          // Already marked recovered/online, abort transaction
          return undefined;
        }
        return false;
      }
    });

    if (result.committed) {
      if (shouldBeOffline) {
        addLogFn({
          action: 'CONTROLLER_OFFLINE',
          details: `Controller for ${tankName} went offline (last update older than 30s).`,
          logLevel: 'WARNING',
          performedBy: 'System',
        });
      } else {
        addLogFn({
          action: 'CONTROLLER_RECOVERED',
          details: `Controller for ${tankName} recovered and is back online.`,
          logLevel: 'INFO',
          performedBy: 'System',
        });
      }
      return true;
    }
  } catch (err) {
    console.error(`Error synchronizing controllerOffline state for tank ${tankId}:`, err);
  }
  return false;
}

export function useTanks() {
  const [tanks, setTanks] = useState<Tank[]>(() => loadFromStorage('wm_tanks', DEFAULT_TANKS));
  const serverTimeOffset = useServerTimeOffset();

  useEffect(() => {
    const tanksRef = ref(database, 'tanks');
    const unsubscribe = onValue(
      tanksRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          // Map database keys as ID if missing, to guarantee every tank has a valid ID and doesn't render empty ID
          const tankList = Object.entries(data).map(([key, value]: [string, any]) => ({
            ...value,
            id: value.id || key,
            name: value.name || `Tank ${key}`
          })) as Tank[];
          setTanks(tankList);
          saveToStorage('wm_tanks', tankList);
        } else {
          set(tanksRef, DEFAULT_TANKS.reduce((acc, tank) => ({ ...acc, [tank.id]: tank }), {}));
        }
      },
      (error) => {
        console.error('Error reading tanks from database:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  const updateTank = (id: string, updates: Partial<Tank>) => {
    if (!id || id.trim() === '') {
      return Promise.reject(new Error('Invalid tank ID. Operations cannot be performed on blank identifiers.'));
    }
    return update(ref(database, `tanks/${id}`), updates);
  };

  const addTank = (tank: Pick<Tank, 'id' | 'name'> & Partial<Tank>) => {
    if (!tank.id || tank.id.trim() === '') {
      return Promise.reject(new Error('Tank ID is required for registration.'));
    }
    const newTank: Tank = {
      waterLevel: 0,
      phLevel: 7.0,
      waterHeight: 0,
      status: 'safe',
      pumpOn: false,
      phSensorOk: true,
      levelSensorOk: true,
      levelVmin: 0.25,
      levelVmax: 3.0,
      tankHeight: 5.0,
      levelOffset: 0,
      phNeutralVoltage: 2.5,
      phSlope: 0.18,
      phOffset: 0.0,
      enabled: true,
      location: 'Unspecified',
      assignedWorker: null,
      controllerOffline: false,
      ...tank
    };
    return set(ref(database, `tanks/${newTank.id}`), newTank);
  };

  const deleteTank = (id: string) => {
    if (!id || id.trim() === '') {
      return Promise.reject(new Error('Invalid tank ID. Deletion cannot be performed on blank identifiers.'));
    }
    return remove(ref(database, `tanks/${id}`));
  };

  return { tanks, updateTank, addTank, deleteTank, serverTimeOffset };
}

export function useConfig() {
  const [config, setConfig] = useState<SystemConfig>(() => loadFromStorage('wm_config', DEFAULT_CONFIG));

  useEffect(() => {
    const configRef = ref(database, 'config');
    const unsubscribe = onValue(
      configRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          setConfig(data);
          saveToStorage('wm_config', data);
        } else {
          set(configRef, DEFAULT_CONFIG);
        }
      },
      (error) => {
        console.error('Error reading config from database:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  const updateConfig = (updates: Partial<SystemConfig>) => {
    return update(ref(database, 'config'), updates);
  };

  return { config, updateConfig };
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    const notifsRef = ref(database, 'notifications');
    const unsubscribe = onValue(
      notifsRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          // Convert object to array and sort by timestamp (newest first)
          const list = Object.values(data) as Notification[];
          list.sort((a, b) => b.timestamp - a.timestamp);
          setNotifications(list);
        } else {
          setNotifications([]);
        }
      },
      (error) => {
        console.error('Error reading notifications from database:', error);
      }
    );
    return () => unsubscribe();
  }, []);

  const addNotification = (notif: Omit<Notification, 'id' | 'timestamp' | 'read'> & { id?: string }) => {
    const id = notif.id || Date.now().toString();
    const newNotif: Notification = {
      id,
      timestamp: Date.now(),
      read: false,
      acknowledged: false,
      ...notif
    };
    return set(ref(database, `notifications/${id}`), newNotif);
  };

  const markRead = (id: string) => {
    return update(ref(database, `notifications/${id}`), { read: true });
  };

  const acknowledgeNotification = (id: string, username: string, title?: string) => {
    const acknowledgedAt = Date.now();
    update(ref(database, `notifications/${id}`), {
      acknowledged: true,
      acknowledgedBy: username,
      acknowledgedAt
    });

    const logId = Date.now().toString();
    const newLog: Log = {
      id: logId,
      action: 'Alert Acknowledged',
      details: `Alert "${title || 'System Alert'}" was acknowledged by ${username}.`,
      performedBy: username,
      timestamp: acknowledgedAt,
      logLevel: 'INFO'
    };
    return set(ref(database, `logs/${logId}`), newLog);
  };

  const clearAll = () => {
    return set(ref(database, 'notifications'), null);
  };

  return { notifications, addNotification, markRead, clearAll, acknowledgeNotification };
}

export function useLogs() {
  const [logs, setLogs] = useState<Log[]>([]);

  useEffect(() => {
    const logsRef = ref(database, 'logs');
    const unsubscribe = onValue(
      logsRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list = Object.values(data) as Log[];
          list.sort((a, b) => b.timestamp - a.timestamp);
          setLogs(list);
        } else {
          setLogs([]);
        }
      },
      (error) => {
        console.error('Error reading logs from database:', error);
      }
    );
    return () => unsubscribe();
  }, []);

  const addLog = (log: Omit<Log, 'id' | 'timestamp'>) => {
    const id = Date.now().toString();
    const newLog: Log = {
      ...log,
      logLevel: log.logLevel || 'INFO',
      id,
      timestamp: Date.now()
    };
    set(ref(database, `logs/${id}`), newLog);
  };

  const clearAll = () => {
    set(ref(database, 'logs'), null);
  };

  return { logs, addLog, clearAll };
}

export function useClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const formatted = time.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) +
    ' - ' + time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  return formatted;
}
