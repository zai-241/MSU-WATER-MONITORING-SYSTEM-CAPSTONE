import { useState } from 'react';
import { useLogs } from '@/store/useStore';
import { useAuth } from '@/hooks/useAuth';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileText, Search, AlertTriangle, XCircle, Info, Trash2, CheckCircle2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Safely format a Unix timestamp to localized human-readable string.
 * Prevents errors if telemetry sends an invalid date.
 */
const getFormattedDate = (timestamp: number): string => {
    try {
        const d = new Date(timestamp);
        if (isNaN(d.getTime())) return 'Invalid Date';
        return d.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
    } catch {
        return 'Unknown Time';
    }
};

/**
 * Safely split text and highlight matching search strings.
 * Safe-guarded against null, undefined, or non-string values.
 */
const highlightText = (text: unknown, search: string) => {
    if (text === null || text === undefined) return '';
    const str = String(text);
    if (!search || !search.trim()) return <span>{str}</span>;

    try {
        // Escape special regex characters to prevent crashes from inputs like '(' or '+'
        const escapedSearch = search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(`(${escapedSearch})`, 'gi');
        const parts = str.split(regex);

        return (
            <span>
                {parts.map((part, index) =>
                    regex.test(part) ? (
                        <mark key={index} className="bg-primary/20 text-foreground font-semibold rounded px-0.5 animate-pulse">
                            {part}
                        </mark>
                    ) : (
                        part
                    )
                )}
            </span>
        );
    } catch (e) {
        console.error("Highlighting error:", e);
        return <span>{str}</span>;
    }
};

const Logs = () => {
    const { logs, clearAll } = useLogs();
    const { currentUser } = useAuth();
    const isAdmin = currentUser?.role === 'admin';
    
    const [search, setSearch] = useState('');
    const [activeTab, setActiveTab] = useState<'all' | 'alerts' | 'system' | 'errors'>('all');
    const [showClearConfirm, setShowClearConfirm] = useState(false);

    // 1. Get logs matching search query (case-insensitive & safe-guarded)
    const getSearchMatchedLogs = () => {
        if (!search.trim()) return logs;

        const query = search.toLowerCase();
        return logs.filter(log => {
            const formattedDate = getFormattedDate(log.timestamp);
            const severity = log.logLevel || 'INFO';
            
            return (
                (log.action || '').toLowerCase().includes(query) ||
                (log.details || '').toLowerCase().includes(query) ||
                (log.performedBy || '').toLowerCase().includes(query) ||
                severity.toLowerCase().includes(query) ||
                formattedDate.toLowerCase().includes(query)
            );
        });
    };

    const searchMatchedLogs = getSearchMatchedLogs();

    // 2. Tab filtering logic (applied on top of search results)
    const getCategoryLogs = (baseLogs: typeof logs, tab: string) => {
        return baseLogs.filter(log => {
            const severity = log.logLevel || 'INFO';
            const actionStr = log.action || '';
            
            if (tab === 'alerts') {
                return severity === 'CRITICAL' || severity === 'WARNING' || actionStr.toLowerCase().includes('alert');
            }
            if (tab === 'system') {
                return severity === 'INFO';
            }
            if (tab === 'errors') {
                return severity === 'ERROR' || severity === 'CRITICAL';
            }
            return true; // 'all'
        });
    };

    // Calculate dynamic counts based on currently matched search results
    const totalCount = searchMatchedLogs.length;
    const alertsCount = getCategoryLogs(searchMatchedLogs, 'alerts').length;
    const errorsCount = getCategoryLogs(searchMatchedLogs, 'errors').length;
    const systemCount = getCategoryLogs(searchMatchedLogs, 'system').length;

    // Filter final list to render
    const filteredLogs = getCategoryLogs(searchMatchedLogs, activeTab);

    // Map severities to visual themes (color badges, glowing borders, custom icons)
    const getLogLevelMeta = (level?: string) => {
        const severity = level || 'INFO';
        switch (severity) {
            case 'CRITICAL':
                return {
                    label: 'CRITICAL',
                    icon: <XCircle className="h-4 w-4 text-rose-500 animate-pulse" />,
                    badgeClass: 'bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-400',
                    rowClass: 'border-l-4 border-l-rose-500 bg-rose-500/[0.01] hover:bg-rose-500/[0.03]'
                };
            case 'ERROR':
                return {
                    label: 'ERROR',
                    icon: <AlertTriangle className="h-4 w-4 text-orange-500" />,
                    badgeClass: 'bg-orange-500/10 text-orange-600 border-orange-500/20 dark:text-orange-400',
                    rowClass: 'border-l-4 border-l-orange-500 bg-orange-500/[0.01] hover:bg-orange-500/[0.03]'
                };
            case 'WARNING':
                return {
                    label: 'WARNING',
                    icon: <AlertTriangle className="h-4 w-4 text-amber-500" />,
                    badgeClass: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400',
                    rowClass: 'border-l-4 border-l-amber-500 bg-amber-500/[0.01] hover:bg-amber-500/[0.03]'
                };
            case 'INFO':
            default:
                return {
                    label: 'INFO',
                    icon: <Info className="h-4 w-4 text-sky-500" />,
                    badgeClass: 'bg-sky-500/10 text-sky-600 border-sky-500/20 dark:text-sky-400',
                    rowClass: 'border-l-4 border-l-sky-500 bg-sky-500/[0.005] hover:bg-sky-500/[0.02]'
                };
        }
    };

    const handleClearLogs = () => {
        clearAll();
        setShowClearConfirm(false);
    };

    return (
        <div className="space-y-6">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-extrabold text-primary flex items-center gap-2.5">
                        <FileText className="h-6 w-6 text-primary" /> System Logs
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">Real-time historical timeline of system telemetry, alerts, and operational events.</p>
                </div>
                
                <div className="flex items-center gap-3 self-start md:self-auto w-full md:w-auto">
                    {/* Search Field & Results Summary */}
                    <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                        {search && (
                            <span className="text-xs font-semibold text-muted-foreground bg-muted/60 px-2.5 py-1 rounded-lg border hidden md:inline-block animate-in fade-in duration-200">
                                Found {totalCount} of {logs.length}
                            </span>
                        )}
                        <div className="relative flex items-center flex-1 sm:flex-none">
                            <Search className="absolute left-3 h-4 w-4 text-muted-foreground" />
                            <input
                                placeholder="Search logs by levels, actions, dates..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-9 pr-10 py-2 rounded-xl border border-input text-sm bg-background w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all duration-300 shadow-xs"
                            />
                            {search && (
                                <button
                                    onClick={() => setSearch('')}
                                    className="absolute right-3 p-1 hover:bg-muted rounded-full transition-colors text-muted-foreground hover:text-foreground"
                                    title="Clear search"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Admin Clear Utility */}
                    {isAdmin && logs.length > 0 && (
                        <button
                            onClick={() => setShowClearConfirm(true)}
                            className="p-2 rounded-xl border border-danger/25 text-danger bg-danger/5 hover:bg-danger hover:text-white transition flex items-center gap-1.5 text-sm font-semibold whitespace-nowrap"
                            title="Purge logs"
                        >
                            <Trash2 className="h-4 w-4" /> Clear Logs
                        </button>
                    )}
                </div>
            </div>

            {/* Filter Tabs Card */}
            <div className="flex border-b border-border gap-1 bg-muted/20 p-1.5 rounded-xl max-w-lg overflow-x-auto scrollbar-none whitespace-nowrap">
                <button
                    onClick={() => setActiveTab('all')}
                    className={`flex-1 py-1.5 px-3 text-xs font-bold rounded-lg transition-all shrink-0 ${
                        activeTab === 'all'
                            ? 'bg-card text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                    All Logs ({totalCount})
                </button>
                <button
                    onClick={() => setActiveTab('alerts')}
                    className={`flex-1 py-1.5 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 shrink-0 ${
                        activeTab === 'alerts'
                            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 shadow-sm border border-amber-500/15'
                            : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                    Alerts {alertsCount > 0 && <span className="bg-amber-500/25 px-1.5 py-0.2 rounded text-[10px]">{alertsCount}</span>}
                </button>
                <button
                    onClick={() => setActiveTab('system')}
                    className={`flex-1 py-1.5 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 shrink-0 ${
                        activeTab === 'system'
                            ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400 shadow-sm border border-sky-500/15'
                            : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                    System {systemCount > 0 && <span className="bg-sky-500/25 px-1.5 py-0.2 rounded text-[10px]">{systemCount}</span>}
                </button>
                <button
                    onClick={() => setActiveTab('errors')}
                    className={`flex-1 py-1.5 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 shrink-0 ${
                        activeTab === 'errors'
                            ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 shadow-sm border border-rose-500/15'
                            : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                    Errors {errorsCount > 0 && <span className="bg-rose-500/25 px-1.5 py-0.2 rounded text-[10px]">{errorsCount}</span>}
                </button>
            </div>

            {/* Logs Table Area */}
            <div className="rounded-xl bg-card shadow-sm border overflow-hidden">
                <div className="p-4 border-b bg-muted/40 hidden md:grid grid-cols-12 gap-4 font-bold text-xs text-muted-foreground uppercase tracking-wider">
                    <div className="col-span-3">Timestamp</div>
                    <div className="col-span-2">Severity</div>
                    <div className="col-span-3">Action Group</div>
                    <div className="col-span-4">Event Details</div>
                </div>

                <ScrollArea className="h-[calc(100vh-270px)]">
                    {filteredLogs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 px-4 text-center text-muted-foreground space-y-4 animate-in fade-in duration-200">
                            {search ? (
                                <>
                                    <div className="p-3 bg-muted rounded-full text-muted-foreground/60">
                                        <Search className="h-8 w-8" />
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-base font-bold text-foreground">No logs match your search</p>
                                        <p className="text-sm text-muted-foreground max-w-xs mx-auto">We couldn't find any results for "{search}". Try checking your spelling or clearing the query.</p>
                                    </div>
                                    <button
                                        onClick={() => setSearch('')}
                                        className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-95 shadow transition-all duration-200"
                                    >
                                        Clear Search Filter
                                    </button>
                                </>
                            ) : (
                                <>
                                    <CheckCircle2 className="h-10 w-10 text-muted-foreground/40 animate-pulse" />
                                    <div className="space-y-1">
                                        <p className="text-base font-bold text-foreground">No operational logs found</p>
                                        <p className="text-sm text-muted-foreground">All systems are operational and quiet in this category.</p>
                                    </div>
                                </>
                            )}
                        </div>
                    ) : (
                        <div className="relative">
                            <motion.div layout className="divide-y divide-border">
                                <AnimatePresence mode="popLayout">
                                    {filteredLogs.map((log) => {
                                        const meta = getLogLevelMeta(log.logLevel);
                                        return (
                                            <motion.div
                                                key={log.id}
                                                layout
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, scale: 0.98 }}
                                                transition={{ duration: 0.18 }}
                                                className={`p-4 flex flex-col md:grid md:grid-cols-12 gap-3 md:gap-4 text-sm md:items-center transition-colors ${meta.rowClass}`}
                                            >
                                                {/* Timestamp */}
                                                <div className="col-span-3 text-xs text-muted-foreground font-mono order-3 md:order-none flex justify-between md:block items-center border-t md:border-none pt-2 md:pt-0">
                                                    <span className="md:hidden font-bold uppercase tracking-wider text-[10px] text-muted-foreground/50">Logged At</span>
                                                    {highlightText(getFormattedDate(log.timestamp), search)}
                                                </div>
                                                
                                                {/* Level Badge */}
                                                <div className="col-span-2 flex items-center gap-1.5 order-1 md:order-none justify-between md:justify-start">
                                                    <span className="md:hidden font-bold uppercase tracking-wider text-[10px] text-muted-foreground/50">Severity</span>
                                                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold tracking-wider border uppercase flex items-center gap-1.5 ${meta.badgeClass}`}>
                                                        {meta.icon}
                                                        {highlightText(meta.label, search)}
                                                    </span>
                                                </div>

                                                {/* Action Group */}
                                                <div className="col-span-3 font-semibold text-foreground flex items-center gap-1.5 order-1 md:order-none justify-between md:justify-start">
                                                    <span className="md:hidden font-bold uppercase tracking-wider text-[10px] text-muted-foreground/50">Action</span>
                                                    <span>{highlightText(log.action, search)}</span>
                                                </div>

                                                {/* Details */}
                                                <div className="col-span-4 text-muted-foreground text-xs leading-relaxed order-2 md:order-none">
                                                    <div className="md:hidden font-bold uppercase tracking-wider text-[10px] text-muted-foreground/50 mb-1">Details & Operator</div>
                                                    {highlightText(log.details, search)}
                                                    <span className="block mt-0.5 text-[10px] font-medium text-muted-foreground/60">
                                                        Operator: {highlightText(log.performedBy, search)}
                                                    </span>
                                                </div>
                                            </motion.div>
                                        );
                                    })}
                                </AnimatePresence>
                            </motion.div>
                        </div>
                    )}
                </ScrollArea>
            </div>

            {/* Clear Logs Confirmation Modal */}
            {showClearConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/60 backdrop-blur-xs">
                    <div className="bg-card rounded-xl p-6 shadow-xl max-w-sm w-full mx-4 border border-border space-y-4 animate-in zoom-in-95 duration-150">
                        <div className="flex items-center gap-3 text-danger">
                            <AlertTriangle className="h-6 w-6 animate-bounce" />
                            <h4 className="text-lg font-bold text-foreground">Purge System Logs?</h4>
                        </div>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            Are you sure you want to clear **all historical database logs**? This action is permanent and cannot be undone.
                        </p>
                        <div className="flex gap-3">
                            <button 
                                onClick={() => setShowClearConfirm(false)} 
                                className="flex-1 rounded-xl border border-border px-4 py-2 text-sm font-semibold hover:bg-secondary transition text-foreground"
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={handleClearLogs} 
                                className="flex-1 rounded-xl bg-danger hover:opacity-95 px-4 py-2 text-sm font-bold text-danger-foreground transition shadow-sm"
                            >
                                Clear All
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Logs;
