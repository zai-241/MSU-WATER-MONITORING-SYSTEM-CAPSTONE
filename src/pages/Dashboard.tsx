import { useState, useEffect, useRef, memo } from 'react';
import WaterGauge from '@/components/WaterGauge';
import {
  useTanks,
  useConfig,
  useLogs,
  useServerTimeOffset,
  isTankControllerOffline,
  isTankPlanned,
  syncTankOfflineState,
  Tank,
  SystemConfig,
  User as UserType
} from '@/store/useStore';
import { useProcessedTankData } from '@/hooks/useUIStabilization';
import { WifiOff, User } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { collection, onSnapshot } from 'firebase/firestore';
import { firestore } from '@/config/firebase';

export const formatRelativeTime = (secs: number) => {
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return 'more than an hour ago';
};

export const formatLastSeen = (timestamp?: number, currentServerTime?: number) => {
  if (!timestamp) return 'Never';
  const now = currentServerTime ?? Date.now();
  const diffSecs = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (diffSecs < 5) return 'just now';
  if (diffSecs < 60) return `${diffSecs}s ago`;
  const mins = Math.floor(diffSecs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
};

interface TankCardProps {
  tank: Tank;
  config: SystemConfig;
  currentUser: UserType | null;
  isAdmin: boolean;
  onPumpToggle: (tankId: string, tankName: string, newState: boolean) => void;
  assignedWorkerName: string;
  getStatus: (tank: Tank) => 'safe' | 'warning' | 'danger';
  isOffline: boolean;
  nowServer: number;
}

/**
 * TankCard Component
 * Displays the state of a single water tank reservoir.
 * Wrapped in memo with custom diffing to block unnecessary React re-renders from minor telemetry drift.
 */
const TankCard = memo(({
  tank,
  config,
  currentUser,
  isAdmin,
  onPumpToggle,
  assignedWorkerName,
  getStatus,
  isOffline,
  nowServer,
}: TankCardProps) => {
  // Apply display stabilization: formats, rounds, and throttles values for clean UI presentation
  const processedTank = useProcessedTankData(tank);
  const isPlanned = isTankPlanned(tank);

  const status: 'safe' | 'warning' | 'danger' =
    !processedTank.enabled ? 'safe' :
    processedTank.status === 'danger' ? 'danger' :
    processedTank.status === 'warning' ? 'warning' :
    'safe';
  const disabled = !processedTank.enabled;

  const isWorker = currentUser?.role === 'worker';
  const canTogglePump = isAdmin || (isWorker && !config.pumpControlLock && processedTank.assignedWorker === currentUser?.id);

  return (
    <div className={`rounded-xl bg-card p-6 shadow-sm border transition-all ${
      isPlanned ? 'bg-muted/15 border-dashed border-border/80 opacity-75' : disabled ? 'opacity-50' : isOffline && !disabled ? 'border-border/80' : ''
    }`}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground leading-tight">{processedTank.name}</h3>
          {processedTank.location && (
            <p className="text-xs text-muted-foreground mt-1 font-medium">{processedTank.location}</p>
          )}
        </div>
        {isPlanned ? (
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-muted text-muted-foreground border border-border">
            Planned - IoT not yet installed
          </span>
        ) : disabled ? (
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-muted text-muted-foreground">Disabled</span>
        ) : isOffline ? (
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-muted text-muted-foreground border border-border flex items-center gap-1.5 shadow-sm">
            <WifiOff size={12} className="text-amber-500" />
            Controller Offline
          </span>
        ) : (
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
            status === 'warning' ? 'bg-warning text-warning-foreground' :
            status === 'danger' ? 'bg-danger text-danger-foreground' :
            'bg-safe text-safe-foreground'
          }`}>
            {status === 'safe' ? 'Safe' : status === 'warning' ? 'Warning' : 'Danger'}
          </span>
        )}
      </div>

      <div className={`flex justify-center mb-6 transition-all ${isPlanned ? 'opacity-50 select-none' : isOffline && !disabled ? 'opacity-40 grayscale select-none' : ''}`}>
        {/* For planned tanks, WaterGauge renders static empty fill and '--' text */}
        <WaterGauge
          percentage={disabled || isPlanned ? 0 : processedTank.waterLevel}
          status={disabled || isOffline || isPlanned ? 'safe' : status}
          isPlanned={isPlanned}
        />
      </div>
      
      <div className="space-y-3 text-sm">
        <div className="flex justify-between border-b border-border pb-2">
          <span className="text-muted-foreground">pH Level:</span>
          <div className={`flex items-center gap-2 ${!isPlanned && isOffline && !disabled ? 'opacity-40 grayscale' : ''}`}>
            {isPlanned ? (
              <span className="font-medium text-muted-foreground">--</span>
            ) : (
              <>
                {!disabled && !isOffline && processedTank.phAlert === 'CRITICAL' && (
                  <span className="text-[10px] bg-danger/10 text-danger border border-danger/20 px-1.5 py-0.5 rounded font-bold uppercase animate-pulse">PH CRITICAL</span>
                )}
                {!disabled && !isOffline && processedTank.phAlert === 'WARNING' && (
                  <span className="text-[10px] bg-warning/10 text-warning border border-warning/20 px-1.5 py-0.5 rounded font-bold uppercase animate-pulse">PH WARNING</span>
                )}
                {!disabled && !isOffline && processedTank.phAlert === 'RECOVERED' && (
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-1.5 py-0.5 rounded font-bold uppercase">RECOVERED</span>
                )}
                <span className={`font-medium ${!isOffline && processedTank.phSensorOk === false ? 'text-danger font-bold flex items-center gap-1.5' : isOffline ? 'text-muted-foreground' : ''}`}>
                  {disabled ? '-' : processedTank.phLevel}
                  {!disabled && !isOffline && processedTank.phSensorOk === false && (
                    <span className="text-[10px] bg-danger/10 text-danger border border-danger/20 px-1.5 py-0.5 rounded font-bold uppercase animate-pulse">FAULT</span>
                  )}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex justify-between border-b border-border pb-2">
          <span className="text-muted-foreground">Water Level:</span>
          <div className={`flex items-center gap-2 ${!isPlanned && isOffline && !disabled ? 'opacity-40 grayscale' : ''}`}>
            {isPlanned ? (
              <span className="font-medium text-muted-foreground">--</span>
            ) : (
              <>
                {!disabled && !isOffline && processedTank.lowLevelAlert === 'CRITICAL' && (
                  <span className="text-[10px] bg-danger/10 text-danger border border-danger/20 px-1.5 py-0.5 rounded font-bold uppercase animate-pulse">LOW WATER</span>
                )}
                {!disabled && !isOffline && processedTank.highLevelAlert === 'WARNING' && (
                  <span className="text-[10px] bg-warning/10 text-warning border border-warning/20 px-1.5 py-0.5 rounded font-bold uppercase animate-pulse">OVERFLOW WARNING</span>
                )}
                {!disabled && !isOffline && (processedTank.lowLevelAlert === 'RECOVERED' || processedTank.highLevelAlert === 'RECOVERED') && (
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-1.5 py-0.5 rounded font-bold uppercase">RECOVERED</span>
                )}
                <span className={`font-medium ${!isOffline && processedTank.levelSensorOk === false ? 'text-danger font-bold flex items-center gap-1.5' : isOffline ? 'text-muted-foreground' : ''}`}>
                  {disabled ? '-' : `${processedTank.waterHeight}m`}
                  {!disabled && !isOffline && processedTank.levelSensorOk === false && (
                    <span className="text-[10px] bg-danger/10 text-danger border border-danger/20 px-1.5 py-0.5 rounded font-bold uppercase animate-pulse">FAULT</span>
                  )}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex justify-between border-b border-border pb-2">
          <span className="text-muted-foreground">Last Seen:</span>
          <span className={`font-medium text-xs flex items-center gap-1 ${isPlanned ? 'text-muted-foreground' : isOffline ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-foreground'}`}>
            {isPlanned ? 'Not installed' : formatLastSeen(processedTank.lastUpdate, nowServer)}
          </span>
        </div>
        <div className="flex justify-between border-b border-border pb-2">
          <span className="text-muted-foreground">Assigned:</span>
          <span className="font-medium flex items-center gap-1">
            {disabled ? (
              <span className="text-muted-foreground">Disabled</span>
            ) : (
              <><User size={14} /> {assignedWorkerName}</>
            )}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Pump:</span>
          <div className="flex items-center gap-2">
            {isPlanned ? (
              <span className="text-sm font-medium text-muted-foreground">--</span>
            ) : (
              <>
                <span className={`text-sm font-medium ${processedTank.pumpOn && !disabled && !isOffline ? 'text-safe' : 'text-muted-foreground'}`}>
                  {processedTank.pumpOn && !disabled ? 'ON' : 'OFF'}
                </span>
                <button
                  disabled={disabled || isOffline || config.maintenanceMode || !canTogglePump}
                  onClick={() => onPumpToggle(processedTank.id, processedTank.name, !processedTank.pumpOn)}
                  title={isOffline ? 'Pump toggle disabled: Controller is offline' : undefined}
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    disabled || isOffline || config.maintenanceMode || !canTogglePump
                      ? 'cursor-not-allowed bg-muted opacity-50'
                      : processedTank.pumpOn ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-card shadow transition-transform ${processedTank.pumpOn && !disabled ? 'translate-x-5' : ''}`} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Prevent unnecessary React re-renders caused by minor value changes
  const p = prevProps.tank;
  const n = nextProps.tank;

  // Immediately re-render on state changes that alter permissions, layout, or controls
  const prevPlanned = isTankPlanned(p);
  const nextPlanned = isTankPlanned(n);
  if (prevPlanned !== nextPlanned) return false;

  if (prevProps.isOffline !== nextProps.isOffline) return false;
  if (p.enabled !== n.enabled) return false;
  if (p.pumpOn !== n.pumpOn) return false;
  if (prevProps.assignedWorkerName !== nextProps.assignedWorkerName) return false;
  if (p.status !== n.status) return false;
  if (p.location !== n.location) return false;
  if (p.name !== n.name) return false;
  if (p.phSensorOk !== n.phSensorOk) return false;
  if (p.levelSensorOk !== n.levelSensorOk) return false;
  if (p.lowLevelAlert !== n.lowLevelAlert) return false;
  if (p.highLevelAlert !== n.highLevelAlert) return false;
  if (p.phAlert !== n.phAlert) return false;
  if (p.lastUpdate !== n.lastUpdate) return false;

  // Re-render when last-seen formatted string changes
  const prevLastSeen = formatLastSeen(p.lastUpdate, prevProps.nowServer);
  const nextLastSeen = formatLastSeen(n.lastUpdate, nextProps.nowServer);
  if (prevLastSeen !== nextLastSeen) return false;

  // Block re-renders if telemetry drifts are smaller than the display rounding precision (1 decimal place for pH, 5% intervals for Level)
  const prevPh = Math.round(p.phLevel * 10) / 10;
  const nextPh = Math.round(n.phLevel * 10) / 10;
  if (prevPh !== nextPh) return false;

  const prevLevel = Math.round(p.waterLevel / 5) * 5;
  const nextLevel = Math.round(n.waterLevel / 5) * 5;
  if (prevLevel !== nextLevel) return false;

  const prevHeight = Math.round(p.waterHeight * 100) / 100;
  const nextHeight = Math.round(n.waterHeight * 100) / 100;
  if (prevHeight !== nextHeight) return false;

  // Check if system config or session status changed
  if (prevProps.isAdmin !== nextProps.isAdmin) return false;
  if (prevProps.currentUser?.id !== nextProps.currentUser?.id) return false;
  if (prevProps.config.lowLevelThreshold !== nextProps.config.lowLevelThreshold) return false;
  if (prevProps.config.overflowThreshold !== nextProps.config.overflowThreshold) return false;
  if (prevProps.config.minPh !== nextProps.config.minPh) return false;
  if (prevProps.config.maxPh !== nextProps.config.maxPh) return false;
  if (prevProps.config.maintenanceMode !== nextProps.config.maintenanceMode) return false;
  if (prevProps.config.pumpControlLock !== nextProps.config.pumpControlLock) return false;

  return true; // Values are visually identical; suppress rendering update
});

const Dashboard = () => {
  const { tanks, updateTank } = useTanks();
  const serverTimeOffset = useServerTimeOffset();
  const [users, setUsers] = useState<any[]>([]);
  const { config } = useConfig();
  const { currentUser } = useAuth();
  const { addLog } = useLogs();

  // Firestore real-time listener for user profiles to map operator assignments on dashboard
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(firestore, 'users'), (snapshot) => {
      const list: any[] = [];
      snapshot.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() });
      });
      setUsers(list);
    });
    return () => unsubscribe();
  }, []);
  const isAdmin = currentUser?.role === 'admin';
  const [pumpConfirm, setPumpConfirm] = useState<{ tankId: string; tankName: string; newState: boolean } | null>(null);

  // Synchronized server clock timer (ticks every 1000ms using Firebase server time offset)
  const [nowServer, setNowServer] = useState(() => Date.now() + serverTimeOffset);

  useEffect(() => {
    setNowServer(Date.now() + serverTimeOffset);
    const interval = setInterval(() => {
      setNowServer(Date.now() + serverTimeOffset);
    }, 1000);

    return () => clearInterval(interval);
  }, [serverTimeOffset]);

  // Connection status & relative heartbeat timer calculations
  // Select active operational tank (skip planned expansion tanks)
  const activeTank = tanks.find(t => !isTankPlanned(t)) || tanks[0];
  const lastUpdate = activeTank?.lastUpdate;
  const wifiConnected = activeTank?.wifiConnected ?? true;
  const firebaseConnected = activeTank?.firebaseConnected ?? true;
  const ethConnected = activeTank?.ethConnected ?? false;
  const rssi = activeTank?.rssi ?? -50;

  // Compare against Firebase server time (not browser clock)
  const secondsSinceUpdate = lastUpdate ? Math.max(0, Math.floor((nowServer - lastUpdate) / 1000)) : 999;
  // If no update for > 30 seconds, classify device as Offline
  const isOnline = secondsSinceUpdate <= 30;
  
  let connectionStatus: 'online' | 'reconnecting' | 'offline' = 'online';
  if (!isOnline) {
    connectionStatus = 'offline';
  } else if (!firebaseConnected) {
    connectionStatus = 'reconnecting';
  }

  // Atomic transaction synchronization to avoid duplicate logs when multiple users have dashboard open
  const inFlightTransactions = useRef<Set<string>>(new Set());

  useEffect(() => {
    tanks.forEach((tank) => {
      if (!tank.id) return;
      if (isTankPlanned(tank)) return; // Planned tanks never generate logs or sync offline state
      if (inFlightTransactions.current.has(tank.id)) return;

      const isOffline = isTankControllerOffline(tank, serverTimeOffset);
      const currentFlag = tank.controllerOffline ?? false;

      // Only attempt transaction when offline state diverges from flag under tanks/<id>
      if (isOffline !== currentFlag) {
        inFlightTransactions.current.add(tank.id);
        syncTankOfflineState(tank.id, tank.name, isOffline, addLog).finally(() => {
          inFlightTransactions.current.delete(tank.id);
        });
      }
    });
  }, [tanks, nowServer, serverTimeOffset, addLog]);

  const getSignalStrength = (rssiVal: number) => {
    if (ethConnected) return { label: 'Ethernet', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' };
    if (!wifiConnected) return { label: 'Disconnected', color: 'text-danger bg-danger/10 border-danger/20' };
    
    if (rssiVal >= -50) return { label: 'Signal: Excellent', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' };
    if (rssiVal >= -70) return { label: 'Signal: Good', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' };
    if (rssiVal >= -85) return { label: 'Signal: Fair', color: 'text-warning bg-warning/10 border-warning/20' };
    return { label: 'Signal: Poor', color: 'text-danger bg-danger/10 border-danger/20' };
  };

  const signalInfo = getSignalStrength(rssi);

  const getWorkerName = (id: string | null) => {
    if (!id) return 'Unassigned';
    const user = users.find(u => u.id === id);
    return user ? user.username : 'Unknown';
  };

  const getStatus = (tank: Tank) => {
    if (tank.waterLevel >= config.overflowThreshold) return 'danger';
    if (tank.waterLevel >= 80 || tank.phLevel < config.minPh || tank.phLevel > config.maxPh) return 'warning';
    return 'safe';
  };

  const handlePumpToggle = (tankId: string, tankName: string, newState: boolean) => {
    const targetTank = tanks.find(t => t.id === tankId);
    if (!targetTank || isTankPlanned(targetTank) || isTankControllerOffline(targetTank, serverTimeOffset)) {
      return; // Cannot toggle pump on planned tanks or when controller is offline
    }
    setPumpConfirm({ tankId, tankName, newState });
  };

  const confirmPumpToggle = () => {
    if (!pumpConfirm) return;
    const targetTank = tanks.find(t => t.id === pumpConfirm.tankId);
    if (targetTank && isTankControllerOffline(targetTank, serverTimeOffset)) {
      setPumpConfirm(null);
      return;
    }
    updateTank(pumpConfirm.tankId, { pumpOn: pumpConfirm.newState });

    addLog({
      action: pumpConfirm.newState ? 'PUMP_ON' : 'PUMP_OFF',
      details: `Pump for ${pumpConfirm.tankName} was turned ${pumpConfirm.newState ? 'ON' : 'OFF'}`,
      performedBy: currentUser?.username || 'Unknown'
    });

    setPumpConfirm(null);
  };

  return (
    <div>
      {config.maintenanceMode && (
        <div className="mb-4 p-3 rounded-lg bg-warning/20 border border-warning text-warning text-sm font-medium flex items-center gap-2">
          ⚠️ Maintenance Mode is active — All pumps are disabled and alerts are suppressed.
        </div>
      )}
      {config.pumpControlLock && !config.maintenanceMode && (
        <div className="mb-4 p-3 rounded-lg bg-danger/20 border border-danger text-danger text-sm font-medium flex items-center gap-2">
          🔒 Pump Control Lock is active — Worker pump controls are locked.
        </div>
      )}
      {/* Premium Connection Status Banner */}
      <div className={`mb-6 p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 transition-all duration-300 ${
        connectionStatus === 'online' ? 'bg-emerald-500/5 border-emerald-500/15' :
        connectionStatus === 'reconnecting' ? 'bg-warning/5 border-warning/15' :
        'bg-danger/5 border-danger/15'
      }`}>
        <div className="flex items-center gap-3">
          {/* Status Indicator Dot */}
          <div className="relative flex h-3 w-3">
            {connectionStatus !== 'offline' && (
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                connectionStatus === 'online' ? 'bg-emerald-500' : 'bg-warning'
              }`} />
            )}
            <span className={`relative inline-flex rounded-full h-3 w-3 ${
              connectionStatus === 'online' ? 'bg-emerald-500' :
              connectionStatus === 'reconnecting' ? 'bg-warning' : 'bg-danger'
            }`} />
          </div>
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-2">
              System Controller: {
                connectionStatus === 'online' ? 'Online' :
                connectionStatus === 'reconnecting' ? 'Reconnecting to Database' : 'Controller Offline'
              }
            </h2>
            <p className="text-xs text-muted-foreground">
              {connectionStatus === 'offline' ? (
                'System has not reported heartbeat telemetry for over 30 seconds. Controller is offline.'
              ) : (
                `ESP32 reporting active. Heartbeat received ${formatRelativeTime(secondsSinceUpdate)}.`
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {connectionStatus !== 'offline' && (
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${signalInfo.color}`}>
              {signalInfo.label} {!ethConnected && wifiConnected && `(${rssi} dBm)`}
            </span>
          )}
          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-secondary text-secondary-foreground border border-border">
            Device ID: ESP32-WROOM-32
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
        {tanks.map(tank => {
          const isOffline = isTankControllerOffline(tank, serverTimeOffset);
          return (
            <TankCard
              key={tank.id}
              tank={tank}
              config={config}
              currentUser={currentUser}
              isAdmin={isAdmin}
              onPumpToggle={handlePumpToggle}
              assignedWorkerName={getWorkerName(tank.assignedWorker)}
              getStatus={getStatus}
              isOffline={isOffline}
              nowServer={nowServer}
            />
          );
        })}
      </div>

      {pumpConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50">
          <div className="bg-card rounded-xl p-6 shadow-lg max-w-sm w-full mx-4 space-y-4">
            <h4 className="text-lg font-semibold text-foreground">Confirm Pump Toggle</h4>
            <div className="text-sm text-muted-foreground space-y-3">
              <p>
                Are you sure you want to turn <span className="font-semibold text-foreground">{pumpConfirm.newState ? 'ON' : 'OFF'}</span> the pump for <span className="font-semibold text-foreground">{pumpConfirm.tankName}</span>?
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setPumpConfirm(null)} className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-secondary transition">Cancel</button>
              <button onClick={confirmPumpToggle} className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
