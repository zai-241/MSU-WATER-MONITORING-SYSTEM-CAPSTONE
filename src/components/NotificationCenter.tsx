
import { Bell, Check, Trash2 } from 'lucide-react';
import { useNotifications, Notification } from '@/store/useStore';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/hooks/useAuth';

const NotificationCenter = () => {
    const { notifications, markRead, clearAll, acknowledgeNotification } = useNotifications();
    const { currentUser } = useAuth();
    const unreadCount = notifications.filter(n => !n.read).length;

    // Warning and critical alerts (type === 'warning' or 'danger') that are not yet acknowledged
    const unacknowledgedCount = notifications.filter(
        n => (n.type === 'warning' || n.type === 'danger') && !n.acknowledged
    ).length;

    // Only admin and worker can acknowledge alerts or clear notifications
    const isPrivileged = currentUser?.role === 'admin' || currentUser?.role === 'worker';
    const canClear = isPrivileged;
    const canAcknowledge = isPrivileged;

    const handleMarkRead = (id: string) => {
        markRead(id);
    };

    const handleAcknowledge = (notif: Notification) => {
        const username = currentUser?.username || 'Operator';
        acknowledgeNotification(notif.id, username, notif.title);
    };

    const formatTime = (timestamp?: number) => {
        if (!timestamp) return '';
        return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    };

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="relative" data-testid="notification-bell">
                    <Bell className="h-5 w-5" />
                    {unacknowledgedCount > 0 ? (
                        <span
                            data-testid="unacknowledged-count-badge"
                            className="absolute -top-1 -right-1 flex h-4.5 min-w-4.5 px-1 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white shadow-sm ring-2 ring-background animate-pulse"
                            title={`${unacknowledgedCount} unacknowledged alert${unacknowledgedCount > 1 ? 's' : ''}`}
                        >
                            {unacknowledgedCount > 99 ? '99+' : unacknowledgedCount}
                        </span>
                    ) : unreadCount > 0 ? (
                        <span className="absolute top-1.5 right-1.5 flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500"></span>
                        </span>
                    ) : null}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-84 sm:w-96 p-0" align="end">
                <div className="flex items-center justify-between px-4 py-3 border-b">
                    <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-sm">Notifications</h4>
                        {unacknowledgedCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/10 text-red-600 border border-red-500/20">
                                {unacknowledgedCount} Unacknowledged
                            </span>
                        )}
                    </div>
                    {notifications.length > 0 && canClear && (
                        <Button variant="ghost" size="sm" onClick={clearAll} className="h-auto px-2 py-1 text-xs text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3 w-3 mr-1" /> Clear all
                        </Button>
                    )}
                </div>
                <ScrollArea className="h-[340px]">
                    {notifications.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm">
                            <Bell className="h-8 w-8 mb-2 opacity-20" />
                            <p>No notifications yet</p>
                        </div>
                    ) : (
                        <div className="divide-y">
                            {notifications.map((notif) => {
                                const isAlert = notif.type === 'warning' || notif.type === 'danger';
                                const isAcknowledged = !!notif.acknowledged;

                                return (
                                    <div
                                        key={notif.id}
                                        className={`flex flex-col gap-1.5 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors ${!notif.read ? 'bg-primary/5' : ''}`}
                                        onClick={() => handleMarkRead(notif.id)}
                                    >
                                        <div className="flex gap-3 items-start">
                                            <div className={`mt-1 h-2 w-2 rounded-full flex-shrink-0 ${
                                                notif.type === 'danger' ? 'bg-red-500' :
                                                notif.type === 'warning' ? 'bg-yellow-500' : 'bg-blue-500'
                                            }`} />
                                            <div className="flex-1 space-y-1">
                                                <div className="flex justify-between items-start">
                                                    <p className={`text-sm font-medium leading-none ${!notif.read ? 'text-primary' : ''}`}>
                                                        {notif.title}
                                                    </p>
                                                    <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                                                        {formatTime(notif.timestamp)}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-muted-foreground line-clamp-2">
                                                    {notif.message}
                                                </p>
                                            </div>
                                            {!notif.read && (
                                                <div className="flex items-center justify-center pt-0.5">
                                                    <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                                                </div>
                                            )}
                                        </div>

                                        {/* Alert Acknowledgment Section for warning / critical notifications */}
                                        {isAlert && (
                                            <div className="mt-1 pt-1.5 border-t border-border/40 flex items-center justify-between text-xs">
                                                {isAcknowledged ? (
                                                    <span className="text-[11px] text-muted-foreground font-medium flex items-center gap-1">
                                                        <Check className="h-3 w-3 text-emerald-500 flex-shrink-0" />
                                                        Acknowledged by {notif.acknowledgedBy || 'Operator'} at {formatTime(notif.acknowledgedAt || notif.timestamp)}
                                                    </span>
                                                ) : canAcknowledge ? (
                                                    <div className="flex items-center justify-between w-full">
                                                        <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                                                            Unacknowledged
                                                        </span>
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            className="h-6 px-2.5 text-xs font-semibold border-amber-500/40 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleAcknowledge(notif);
                                                            }}
                                                        >
                                                            Acknowledge
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                                                        Unacknowledged
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </ScrollArea>
            </PopoverContent>
        </Popover>
    );
};

export default NotificationCenter;
