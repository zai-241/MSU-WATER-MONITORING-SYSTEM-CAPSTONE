import { useEffect, useRef } from 'react';
import { useTanks, useConfig, useNotifications, isTankPlanned } from '@/store/useStore';
import { toast } from 'sonner';
import { alertSound } from '@/utils/alertSound';

// Validation delays and notification cooldown configurations
const ALERT_VALIDATION_TIME = 5000;   // 5 seconds continuous anomaly required
const RECOVERY_VALIDATION_TIME = 5000; // 5 seconds continuous normal required
const ALERT_COOLDOWN = 60 * 1000;     // 60 seconds notification cooldown to prevent spam

interface AlertTracker {
  status: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'RECOVERED';
  abnormalStartTime: number;
  normalStartTime: number;
  lastNotificationTime: number;
}

/**
 * SystemMonitor Component
 * Headless browser component that performs client-side alert evaluation.
 * Uses persistent ref state machines for consecutive reading validation, hysteresis recovery,
 * and toast/notification cooldowns to prevent dashboard alert spamming.
 * Integrates alert sound chime and dismisses toasts when alerts are acknowledged across dashboards.
 */
const SystemMonitor = () => {
    const { tanks } = useTanks();
    const { config } = useConfig();
    const { notifications, addNotification } = useNotifications();
    
    // Store stable state machines for alerts across renders to prevent fluctuations/noise
    const trackers = useRef<Record<string, Record<string, AlertTracker>>>({});

    // Real-time synchronization: stop sound and dismiss toasts when alerts are acknowledged on any open dashboard
    useEffect(() => {
        const unacknowledgedAlerts = notifications.filter(
            n => (n.type === 'warning' || n.type === 'danger') && !n.acknowledged
        );

        if (unacknowledgedAlerts.length > 0) {
            alertSound.startAlert();
        } else {
            alertSound.stopAlert();
        }

        // Dismiss active toast for any alert that has been acknowledged
        notifications.forEach(n => {
            if (n.acknowledged) {
                toast.dismiss(n.id);
            }
        });
    }, [notifications]);

    // Cleanup sound on component unmount
    useEffect(() => {
        return () => {
            alertSound.stopAlert();
        };
    }, []);

    useEffect(() => {
        const now = Date.now();

        tanks.forEach(tank => {
            // Planned tanks and disabled tanks must never evaluate or trigger alerts
            if (!tank.enabled || isTankPlanned(tank)) return;

            // Initialize trackers for this tank if they do not exist
            if (!trackers.current[tank.id]) {
                trackers.current[tank.id] = {
                    lowLevel: { status: 'NORMAL', abnormalStartTime: 0, normalStartTime: 0, lastNotificationTime: 0 },
                    overflow: { status: 'NORMAL', abnormalStartTime: 0, normalStartTime: 0, lastNotificationTime: 0 },
                    ph: { status: 'NORMAL', abnormalStartTime: 0, normalStartTime: 0, lastNotificationTime: 0 },
                };
            }

            const tankTrackers = trackers.current[tank.id];

            // Helper to evaluate and update alert state machine for a specific alert key
            const evaluateAlert = (
                key: 'lowLevel' | 'overflow' | 'ph',
                isAbnormal: boolean,
                isNormal: boolean,
                title: string,
                abnormalMsg: string,
                recoveryMsg: string,
                type: 'warning' | 'danger'
            ) => {
                const tracker = tankTrackers[key];
                const notifId = `alert-${tank.id}-${key}`;

                // 1. STATE MACHINE TRANSITIONS
                switch (tracker.status) {
                    case 'NORMAL':
                        if (isAbnormal) {
                            if (tracker.abnormalStartTime === 0) {
                                tracker.abnormalStartTime = now;
                            } else if (now - tracker.abnormalStartTime >= ALERT_VALIDATION_TIME) {
                                tracker.status = type === 'warning' ? 'WARNING' : 'CRITICAL';
                                tracker.abnormalStartTime = 0;
                                tracker.lastNotificationTime = now;
                                
                                // Dispatch warning notification and toast
                                toast[type === 'warning' ? 'warning' : 'error'](abnormalMsg, { id: notifId, duration: 15000 });
                                addNotification({ id: notifId, title, message: abnormalMsg, type });
                            }
                        } else {
                            tracker.abnormalStartTime = 0;
                        }
                        break;

                    case 'WARNING':
                    case 'CRITICAL':
                        if (isNormal) {
                            if (tracker.normalStartTime === 0) {
                                tracker.normalStartTime = now;
                            } else if (now - tracker.normalStartTime >= RECOVERY_VALIDATION_TIME) {
                                tracker.status = 'RECOVERED';
                                tracker.normalStartTime = 0;
                                tracker.lastNotificationTime = now;
                                
                                // Dismiss active toast on recovery
                                toast.dismiss(notifId);
                                toast.success(recoveryMsg);
                                addNotification({ title: `${title} Recovered`, message: recoveryMsg, type: 'info' });
                            }
                        } else {
                            tracker.normalStartTime = 0;
                            // Check if alert was already acknowledged by an operator
                            const isAcknowledged = notifications.some(n => n.id === notifId && n.acknowledged);
                            if (isAcknowledged) {
                                // Acknowledged by operator: do not re-toast or overwrite while still active
                                return;
                            }

                            // Cooldown handling to prevent duplicate spamming for persistent unacknowledged alert
                            if (now - tracker.lastNotificationTime >= ALERT_COOLDOWN) {
                                tracker.lastNotificationTime = now;
                                toast[type === 'warning' ? 'warning' : 'error'](abnormalMsg, { id: notifId, duration: 15000 });
                                addNotification({ id: notifId, title, message: abnormalMsg, type });
                            }
                        }
                        break;

                    case 'RECOVERED':
                        // Reset to normal on next tick
                        tracker.status = 'NORMAL';
                        tracker.abnormalStartTime = 0;
                        tracker.normalStartTime = 0;
                        break;
                }
            };

            // 2. CHECK LOW WATER LEVEL (Hysteresis recovery margin: +2%)
            const isLowAbnormal = tank.waterLevel <= config.lowLevelThreshold;
            const isLowNormal = tank.waterLevel > (config.lowLevelThreshold + 2);
            evaluateAlert(
                'lowLevel',
                isLowAbnormal,
                isLowNormal,
                'Low Water Level',
                `${tank.name} water level is extremely low (${tank.waterLevel}%).`,
                `${tank.name} water level returned to normal (${tank.waterLevel}%).`,
                'warning'
            );

            // 3. CHECK OVERFLOW (Hysteresis recovery margin: -2%)
            const isOverflowAbnormal = tank.waterLevel >= config.overflowThreshold;
            const isOverflowNormal = tank.waterLevel < (config.overflowThreshold - 2);
            evaluateAlert(
                'overflow',
                isOverflowAbnormal,
                isOverflowNormal,
                'Critical Water Level',
                `${tank.name} is reaching overflow capacity (${tank.waterLevel}%).`,
                `${tank.name} overflow condition resolved (${tank.waterLevel}%).`,
                'danger'
            );

            // 4. CHECK PH LEVELS (Hysteresis recovery margin: +/- 0.15)
            const isPhAbnormal = tank.phLevel < config.minPh || tank.phLevel > config.maxPh;
            const isPhNormal = tank.phLevel >= (config.minPh + 0.15) && tank.phLevel <= (config.maxPh - 0.15);
            evaluateAlert(
                'ph',
                isPhAbnormal,
                isPhNormal,
                'Unsafe pH Level',
                `${tank.name} pH level is unsafe (${tank.phLevel}).`,
                `${tank.name} pH level returned to safe zone (${tank.phLevel}).`,
                'danger'
            );
        });
    }, [tanks, config, notifications, addNotification]);

    return null; // Headless component
};

export default SystemMonitor;
