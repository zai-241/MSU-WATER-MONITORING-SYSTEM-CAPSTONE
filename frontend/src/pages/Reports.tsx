import { useState, useMemo, useEffect } from 'react';
import { useTanks, useLogs, Tank, isTankPlanned } from '@/store/useStore';
import { useAuth } from '@/hooks/useAuth';
import { database } from '@/config/firebase';
import { ref, onValue, query, orderByChild, startAt, endAt, limitToLast, get, update } from 'firebase/database';
import { useProcessedTankData, useThrottledValue } from '@/hooks/useUIStabilization';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ReferenceLine
} from 'recharts';
import {
  FileText,
  Download,
  Loader2,
  Droplet,
  Activity,
  AlertTriangle,
  Cpu,
  Wifi,
  Database,
  TrendingUp,
  ScrollText,
  AlertOctagon,
  Printer,
  ChevronLeft,
  ChevronRight,
  WifiOff,
  FileSpreadsheet
} from 'lucide-react';
import { toast } from 'sonner';
import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const DATE_RANGES = ['Last 7 Days', 'Last 14 Days', 'Last 30 Days'] as const;
type DateRange = typeof DATE_RANGES[number];

const PIE_COLORS = ['#ef4444', '#f59e0b', '#a855f7', '#f97316', '#3b82f6'];

export interface HistoryRawSample {
  id: string;
  waterLevel: number | null;
  phLevel: number | null;
  waterHeight: number | null;
  pumpOn?: boolean;
  timestamp: number;
}

export interface GroupedTelemetryPoint {
  date: string;
  timestamp: number;
  waterLevel: number | null;
  phLevel: number | null;
  height: number;
  sampleCount: number;
}

const Reports = () => {
  const { tanks: rawTanks } = useTanks();
  const { logs: rawLogs, addLog } = useLogs();
  const { currentUser } = useAuth();

  // Throttle high-frequency updates from Firebase to stabilize chart drawings and heavy table pagination
  const allTanks = useThrottledValue(rawTanks, 1500);
  const logs = useThrottledValue(rawLogs, 1500);

  // Exclude planned expansion tanks from Reports, exports, summary averages, and alert counts
  const tanks = useMemo(() => allTanks.filter(t => !isTankPlanned(t)), [allTanks]);

  const [selectedTankId, setSelectedTankId] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>('Last 30 Days');
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportGenerated, setReportGenerated] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [historySamples, setHistorySamples] = useState<HistoryRawSample[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [exportingType, setExportingType] = useState<'excel' | 'pdf' | null>(null);
  const itemsPerPage = 7;

  const canExport = currentUser?.role === 'admin' || currentUser?.role === 'worker';

  // Auto-select reactive hook - falls back gracefully to the first operational tank
  useEffect(() => {
    if (!selectedTankId && tanks.length > 0) {
      const firstActive = tanks.find(t => t.enabled) || tanks[0];
      if (firstActive) {
        setSelectedTankId(firstActive.id);
      }
    } else if (selectedTankId && tanks.length > 0 && !tanks.some(t => t.id === selectedTankId)) {
      setSelectedTankId(tanks[0].id);
    }
  }, [tanks, selectedTankId]);

  const days = useMemo(() => {
    return dateRange === 'Last 7 Days' ? 7 : dateRange === 'Last 14 Days' ? 14 : 30;
  }, [dateRange]);

  const selectedTank = useMemo(() => {
    return tanks.find(t => t.id === selectedTankId) || null;
  }, [tanks, selectedTankId]);

  // Setup processedTank with state buffering, stabilization rounding, and debounce timers
  const dummyTank: Tank = {
    id: '',
    name: '',
    enabled: false,
    waterLevel: 0,
    phLevel: 7,
    waterHeight: 0,
    tankHeight: 2,
    status: 'safe',
    assignedWorker: null,
    pumpOn: false,
    rssi: -999,
    levelVmin: 0.25,
    levelVmax: 3.0,
    levelOffset: 0,
    phNeutralVoltage: 2.5,
    phSlope: 0.18,
    phOffset: 0.0,
    phSensorOk: true,
    levelSensorOk: true,
  };
  const processedTank = useProcessedTankData(selectedTank || dummyTank);

  // Determine RSSI strength label and color
  const rssiDetails = useMemo(() => {
    if (!selectedTank) return { label: 'Syncing', color: 'text-muted-foreground', pct: 0 };
    const rssi = processedTank.rssi ?? -999;
    if (rssi === -999) return { label: 'Offline', color: 'text-muted-foreground', pct: 0 };
    if (rssi >= -60) return { label: 'Excellent', color: 'text-safe', pct: 100 };
    if (rssi >= -75) return { label: 'Good', color: 'text-safe/80', pct: 75 };
    if (rssi >= -85) return { label: 'Fair', color: 'text-warning', pct: 45 };
    return { label: 'Poor', color: 'text-danger', pct: 20 };
  }, [processedTank.rssi, selectedTank]);

  // Determine pH Chemical Category
  const phCategory = useMemo(() => {
    if (!selectedTank) return { label: 'Neutral', color: 'text-safe bg-safe/10 border-safe/20' };
    const ph = processedTank.phLevel ?? 7.0;
    if (ph < 6.5) return { label: 'Acidic', color: 'text-danger bg-danger/10 border-danger/20' };
    if (ph > 8.5) return { label: 'Alkaline', color: 'text-warning bg-warning/10 border-warning/20' };
    return { label: 'Neutral', color: 'text-safe bg-safe/10 border-safe/20' };
  }, [processedTank.phLevel, selectedTank]);

  // Calculate dynamic active alert count
  const activeAlerts = useMemo(() => {
    if (!selectedTank) return [];
    const list = [];
    if (processedTank.lowLevelAlert === 'CRITICAL') list.push('Low Water Level');
    if (processedTank.highLevelAlert === 'WARNING') list.push('High Water Level');
    if (processedTank.phAlert === 'CRITICAL') list.push('Unsafe pH Level');
    if (!processedTank.phSensorOk) list.push('pH Sensor Fault');
    if (!processedTank.levelSensorOk) list.push('Level Sensor Fault');
    return list;
  }, [
    selectedTank,
    processedTank.lowLevelAlert,
    processedTank.highLevelAlert,
    processedTank.phAlert,
    processedTank.phSensorOk,
    processedTank.levelSensorOk
  ]);

  // 1. Fetch real historical samples from Firebase RTDB (/history/tanks/{tankId})
  useEffect(() => {
    if (!selectedTankId) {
      setHistorySamples([]);
      setIsLoadingHistory(false);
      return;
    }

    setIsLoadingHistory(true);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const historyRef = ref(database, `history/tanks/${selectedTankId}`);
    const historyQuery = query(
      historyRef,
      orderByChild('timestamp'),
      startAt(cutoff),
      limitToLast(5000)
    );

    const unsubscribe = onValue(
      historyQuery,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.val();
          const list: HistoryRawSample[] = Object.entries(data).map(([key, val]: [string, any]) => ({
            id: key,
            waterLevel: typeof val?.waterLevel === 'number' ? val.waterLevel : null,
            phLevel: typeof val?.phLevel === 'number' ? val.phLevel : null,
            waterHeight: typeof val?.waterHeight === 'number' ? val.waterHeight : null,
            pumpOn: typeof val?.pumpOn === 'boolean' ? val.pumpOn : false,
            timestamp: typeof val?.timestamp === 'number' ? val.timestamp : 0,
          })).filter((item) => item.timestamp >= cutoff);

          list.sort((a, b) => a.timestamp - b.timestamp);
          setHistorySamples(list);
        } else {
          setHistorySamples([]);
        }
        setIsLoadingHistory(false);
      },
      (error) => {
        console.error('Error fetching historical telemetry:', error);
        setHistorySamples([]);
        setIsLoadingHistory(false);
      }
    );

    return () => unsubscribe();
  }, [selectedTankId, days]);

  // Monthly automated cleanup: Deletes samples older than 90 days when an admin opens Reports
  useEffect(() => {
    if (currentUser?.role !== 'admin' || !selectedTankId) return;

    const currentMonthKey = new Date().toISOString().slice(0, 7); // e.g. "2026-10"
    const storageKey = `wm_monthly_history_cleanup_${selectedTankId}`;
    const lastCleanupKey = localStorage.getItem(storageKey);
    if (lastCleanupKey === currentMonthKey) {
      return; // Already executed this month
    }

    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const cleanupQuery = query(
      ref(database, `history/tanks/${selectedTankId}`),
      orderByChild('timestamp'),
      endAt(ninetyDaysAgo)
    );

    get(cleanupQuery).then((snapshot) => {
      if (snapshot.exists()) {
        const updates: Record<string, null> = {};
        let count = 0;
        snapshot.forEach((child) => {
          updates[child.key!] = null;
          count++;
        });
        if (count > 0) {
          update(ref(database, `history/tanks/${selectedTankId}`), updates).then(() => {
            addLog({
              action: 'Historical Data Retention',
              details: `Monthly automated cleanup: deleted ${count} historical samples older than 90 days from tank ${selectedTankId}.`,
              performedBy: currentUser.username || 'Admin',
              logLevel: 'INFO',
            });
            toast.info(`Monthly cleanup: removed ${count} historical samples older than 90 days.`);
          }).catch((err) => {
            console.error('Error removing old history samples:', err);
          });
        }
      }
      localStorage.setItem(storageKey, currentMonthKey);
    }).catch((err) => {
      console.warn('Error querying historical samples for cleanup:', err);
    });
  }, [currentUser, selectedTankId, addLog]);

  // 2. Group real samples into hourly averages (for 7 days) or daily averages (for 14/30 days)
  const telemetryData: GroupedTelemetryPoint[] = useMemo(() => {
    if (historySamples.length === 0) return [];

    const isHourly = days === 7;
    const groups = new Map<string | number, { timestamp: number; samples: HistoryRawSample[] }>();

    for (const sample of historySamples) {
      if (isHourly) {
        const hourMs = 3600000;
        const bucketTime = Math.floor(sample.timestamp / hourMs) * hourMs;
        if (!groups.has(bucketTime)) {
          groups.set(bucketTime, { timestamp: bucketTime, samples: [] });
        }
        groups.get(bucketTime)!.samples.push(sample);
      } else {
        const d = new Date(sample.timestamp);
        const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (!groups.has(dayKey)) {
          const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
          groups.set(dayKey, { timestamp: dayStart, samples: [] });
        }
        groups.get(dayKey)!.samples.push(sample);
      }
    }

    const sortedEntries = Array.from(groups.values()).sort((a, b) => a.timestamp - b.timestamp);
    const tankHeight = selectedTank?.tankHeight || 5.0;

    return sortedEntries.map(({ timestamp, samples }) => {
      const validLevels = samples.map(s => s.waterLevel).filter((v): v is number => v !== null);
      const validPhs = samples.map(s => s.phLevel).filter((v): v is number => v !== null);
      const validHeights = samples.map(s => s.waterHeight).filter((v): v is number => v !== null);

      const avgLevel = validLevels.length > 0
        ? Math.round(validLevels.reduce((a, b) => a + b, 0) / validLevels.length)
        : null;

      const avgPh = validPhs.length > 0
        ? Math.round((validPhs.reduce((a, b) => a + b, 0) / validPhs.length) * 10) / 10
        : null;

      let avgHeight = 0;
      if (validHeights.length > 0) {
        avgHeight = Number((validHeights.reduce((a, b) => a + b, 0) / validHeights.length).toFixed(2));
      } else if (avgLevel !== null) {
        avgHeight = Number(((avgLevel / 100) * tankHeight).toFixed(2));
      }

      const d = new Date(timestamp);
      const dateLabel = isHourly
        ? `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`
        : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      return {
        date: dateLabel,
        timestamp,
        waterLevel: avgLevel,
        phLevel: avgPh,
        height: avgHeight,
        sampleCount: samples.length,
      };
    });
  }, [historySamples, days, selectedTank?.tankHeight]);

  // 2. Dynamic Pump Activations parsed from Real-Time Firebase System Logs
  const pumpActivityData = useMemo(() => {
    const rangeData = [];
    const now = new Date();
    
    // Group active logs
    const pumpLogs = logs.filter(l => 
      l.action === 'Pump Controller' && 
      (l.details.includes('Activating') || l.details.includes('ON'))
    );
    
    for (let i = days; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      
      // Count actual log events matching this specific date
      const activationsCount = pumpLogs.filter(l => {
        const logDate = new Date(l.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return logDate === dateStr;
      }).length;
      
      rangeData.push({
        date: dateStr,
        activations: activationsCount
      });
    }
    
    return rangeData;
  }, [logs, days]);

  // 3. Dynamic Alert Distribution parsed from Real-Time Firebase Logs
  const alertDistributionData = useMemo(() => {
    const categories = {
      'Low Water Level': 0,
      'High Water Level': 0,
      'Unsafe pH Level': 0,
      'Sensor Faults': 0,
      'Network Failures': 0
    };
    
    // Scan all warnings, errors and critical logs
    logs.forEach(l => {
      const details = l.details.toLowerCase();
      const action = l.action.toLowerCase();
      
      if (details.includes('low water') || details.includes('low level')) {
        categories['Low Water Level']++;
      } else if (details.includes('high water') || details.includes('overflow') || details.includes('high level')) {
        categories['High Water Level']++;
      } else if (details.includes('ph level') || details.includes('unsafe ph')) {
        categories['Unsafe pH Level']++;
      } else if (action.includes('fault') || details.includes('fault') || action.includes('sensor error')) {
        categories['Sensor Faults']++;
      } else if (action.includes('network') || details.includes('offline') || action.includes('firebase error')) {
        categories['Network Failures']++;
      }
    });

    const result = [
      { name: 'Low Water Level', value: categories['Low Water Level'] },
      { name: 'High Water Level', value: categories['High Water Level'] },
      { name: 'Unsafe pH Level', value: categories['Unsafe pH Level'] },
      { name: 'Sensor Faults', value: categories['Sensor Faults'] },
      { name: 'Network Failures', value: categories['Network Failures'] }
    ];

    return result.filter(item => item.value > 0);
  }, [logs]);

  // Summary Metrics calculations
  const summaryMetrics = useMemo(() => {
    if (telemetryData.length === 0) return null;
    
    const validLevels = telemetryData.map(d => d.waterLevel).filter((v): v is number => v !== null);
    const validPhs = telemetryData.map(d => d.phLevel).filter((v): v is number => v !== null);
    const pumpRuns = pumpActivityData.reduce((acc, curr) => acc + curr.activations, 0);

    if (validLevels.length === 0 && validPhs.length === 0) return null;
    
    return {
      avgLevel: validLevels.length > 0 ? Math.round(validLevels.reduce((a, b) => a + b, 0) / validLevels.length) : 0,
      minLevel: validLevels.length > 0 ? Math.min(...validLevels) : 0,
      maxLevel: validLevels.length > 0 ? Math.max(...validLevels) : 0,
      avgPh: validPhs.length > 0 ? Number((validPhs.reduce((a, b) => a + b, 0) / validPhs.length).toFixed(1)) : 7.0,
      minPh: validPhs.length > 0 ? Math.min(...validPhs) : 7.0,
      maxPh: validPhs.length > 0 ? Math.max(...validPhs) : 7.0,
      totalPumpRuns: pumpRuns,
      alertsRegistered: alertDistributionData.reduce((acc, curr) => acc + curr.value, 0)
    };
  }, [telemetryData, pumpActivityData, alertDistributionData]);

  // Filtered Alert Logs for this Tank specifically
  const alertHistoryLogs = useMemo(() => {
    return logs.filter(l => 
      (l.logLevel === 'WARNING' || l.logLevel === 'ERROR' || l.logLevel === 'CRITICAL' || l.action.includes('Alert') || l.action.includes('Fault'))
    ).slice(0, 8);
  }, [logs]);

  const handleGenerateReport = () => {
    setIsGenerating(true);
    const reportPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        setReportGenerated(true);
        resolve();
      }, 1500);
    }).finally(() => {
      setIsGenerating(false);
    });

    toast.promise(
      reportPromise,
      {
        loading: 'Interrogating historical database and compiling charts...',
        success: 'Telemetry report compiled successfully! Export options unlocked.',
        error: 'Failed to compile report.',
      }
    );
  };

  const handleExport = (type: 'csv' | 'print') => {
    if (!selectedTank) return;
    
    if (type === 'csv') {
      const csvHeader = 'Date,Water Level (%),Water Height (m),pH Value,Estimated Volume (L),Sample Count\n';
      const csvRows = telemetryData.map(d => {
        const lvl = d.waterLevel !== null ? String(d.waterLevel) : 'N/A';
        const ph = d.phLevel !== null ? String(d.phLevel) : 'N/A';
        const estVolume = d.waterLevel !== null ? Math.round(d.waterLevel * 50) : 'N/A';
        return `${d.date},${lvl},${d.height},${ph},${estVolume},${d.sampleCount}`;
      }).join('\n');
      
      const blob = new Blob([csvHeader + csvRows], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${processedTank.name.replace(/\s+/g, '_')}_Analytics_${dateRange.replace(/\s+/g, '_')}.csv`;
      a.click();
      toast.success('CSV spreadsheet exported successfully!');
    } else {
      toast.info('Preparing document workspace layout for high-quality print...');
      setTimeout(() => {
        window.print();
      }, 500);
    }
  };

  const handleExportExcel = async () => {
    if (!selectedTank || telemetryData.length === 0) {
      toast.error('No data to export for this time window.');
      return;
    }
    setExportingType('excel');
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = currentUser?.username || 'MSU Water Monitoring System';
      workbook.created = new Date();

      const navyFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E3A8A' }
      };
      const headerFont: Partial<ExcelJS.Font> = {
        name: 'Segoe UI',
        size: 11,
        bold: true,
        color: { argb: 'FFFFFFFF' }
      };
      const sectionFont: Partial<ExcelJS.Font> = {
        name: 'Segoe UI',
        size: 13,
        bold: true,
        color: { argb: 'FF1E3A8A' }
      };

      // 1. SUMMARY SHEET
      const summarySheet = workbook.addWorksheet('Summary', {
        views: [{ showGridLines: true }]
      });
      summarySheet.columns = [
        { width: 30 },
        { width: 32 },
        { width: 28 },
      ];

      const titleRow = summarySheet.addRow(['MSU MOTOR POOL - WATER MONITORING REPORT']);
      titleRow.font = { name: 'Segoe UI', size: 16, bold: true, color: { argb: 'FF1E3A8A' } };
      summarySheet.addRow([]);

      const metaHeader = summarySheet.addRow(['Report Information', '']);
      metaHeader.font = sectionFont;
      summarySheet.addRow(['Tank / Reservoir Name', selectedTank.name]);
      summarySheet.addRow(['Selected Time Window', dateRange]);
      summarySheet.addRow(['Generated By', currentUser?.username || currentUser?.email || 'System User']);
      summarySheet.addRow(['Generation Time', new Date().toLocaleString()]);
      summarySheet.addRow([]);

      const metricsHeaderRow = summarySheet.addRow(['Summary Metric Parameter', 'Value', 'Operational Benchmark']);
      metricsHeaderRow.eachCell((cell) => {
        cell.fill = navyFill;
        cell.font = headerFont;
      });

      const metricsList = [
        ['Average Water Level', summaryMetrics?.avgLevel !== null && summaryMetrics?.avgLevel !== undefined ? `${summaryMetrics.avgLevel}%` : 'N/A', 'Normal: 20% - 90%'],
        ['Minimum Water Level', summaryMetrics?.minLevel !== null && summaryMetrics?.minLevel !== undefined ? `${summaryMetrics.minLevel}%` : 'N/A', 'Observed Low'],
        ['Maximum Water Level', summaryMetrics?.maxLevel !== null && summaryMetrics?.maxLevel !== undefined ? `${summaryMetrics.maxLevel}%` : 'N/A', 'Observed High'],
        ['Average pH Level', summaryMetrics?.avgPh !== null && summaryMetrics?.avgPh !== undefined ? `${summaryMetrics.avgPh}` : 'N/A', 'Safe: 6.5 - 8.5'],
        ['Minimum pH Level', summaryMetrics?.minPh !== null && summaryMetrics?.minPh !== undefined ? `${summaryMetrics.minPh}` : 'N/A', 'Observed Low'],
        ['Maximum pH Level', summaryMetrics?.maxPh !== null && summaryMetrics?.maxPh !== undefined ? `${summaryMetrics.maxPh}` : 'N/A', 'Observed High'],
        ['Total Pump Cycles (Runs)', summaryMetrics?.totalPumpRuns ?? 0, 'Activation Count in Window'],
        ['Total System Alarms / Alerts', summaryMetrics?.alertsRegistered ?? 0, 'Registered Incidents'],
      ];

      metricsList.forEach(m => summarySheet.addRow(m));

      // 2. TELEMETRY HISTORY SHEET
      const historySheet = workbook.addWorksheet('Telemetry History', {
        views: [{ showGridLines: true }]
      });
      historySheet.columns = [
        { header: 'Date & Time', key: 'date', width: 24 },
        { header: 'Water Level (%)', key: 'waterLevel', width: 18 },
        { header: 'Water Height (m)', key: 'waterHeight', width: 18 },
        { header: 'pH Level', key: 'phLevel', width: 16 },
        { header: 'Estimated Volume (L)', key: 'volume', width: 22 },
        { header: 'Sample Count', key: 'sampleCount', width: 16 },
        { header: 'Sensor Status', key: 'status', width: 20 },
      ];

      const histHeader = historySheet.getRow(1);
      histHeader.eachCell((cell) => {
        cell.fill = navyFill;
        cell.font = headerFont;
        cell.alignment = { horizontal: 'center' };
      });

      telemetryData.forEach(item => {
        const isLevelFault = item.waterLevel === null;
        const isPhFault = item.phLevel === null;
        const status = (isLevelFault && isPhFault)
          ? 'Both Faulty'
          : isLevelFault
          ? 'Level Fault'
          : isPhFault
          ? 'pH Fault'
          : 'Normal';

        historySheet.addRow({
          date: item.date,
          waterLevel: item.waterLevel !== null ? item.waterLevel : 'Sensor Fault',
          waterHeight: item.waterLevel !== null ? item.height : 'N/A',
          phLevel: item.phLevel !== null ? item.phLevel : 'Sensor Fault',
          volume: item.waterLevel !== null ? Math.round(item.waterLevel * 50) : 'N/A',
          sampleCount: item.sampleCount,
          status,
        });
      });

      // 3. PUMP ACTIVITY SHEET
      const pumpSheet = workbook.addWorksheet('Pump Activity', {
        views: [{ showGridLines: true }]
      });
      pumpSheet.columns = [
        { header: 'Date', key: 'date', width: 20 },
        { header: 'Activation Cycles', key: 'activations', width: 22 },
        { header: 'Operational Status', key: 'status', width: 22 },
      ];

      const pumpHeader = pumpSheet.getRow(1);
      pumpHeader.eachCell((cell) => {
        cell.fill = navyFill;
        cell.font = headerFont;
        cell.alignment = { horizontal: 'center' };
      });

      pumpActivityData.forEach(item => {
        pumpSheet.addRow({
          date: item.date,
          activations: item.activations,
          status: item.activations > 0 ? 'Active' : 'Idle',
        });
      });

      // 4. ALERT LOGS SHEET
      const alertSheet = workbook.addWorksheet('Alert Logs', {
        views: [{ showGridLines: true }]
      });
      alertSheet.columns = [
        { header: 'Timestamp', key: 'timestamp', width: 24 },
        { header: 'Severity Level', key: 'logLevel', width: 18 },
        { header: 'Action / Event', key: 'action', width: 28 },
        { header: 'Log Details', key: 'details', width: 45 },
        { header: 'Performed By / Source', key: 'performedBy', width: 24 },
      ];

      const alertHeader = alertSheet.getRow(1);
      alertHeader.eachCell((cell) => {
        cell.fill = navyFill;
        cell.font = headerFont;
        cell.alignment = { horizontal: 'center' };
      });

      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const relevantLogs = logs.filter(l => {
        const t = new Date(l.timestamp).getTime();
        return t >= cutoff && (
          l.logLevel === 'WARNING' ||
          l.logLevel === 'ERROR' ||
          l.logLevel === 'CRITICAL' ||
          l.action.toLowerCase().includes('alert') ||
          l.action.toLowerCase().includes('fault') ||
          l.action.toLowerCase().includes('alarm')
        );
      });

      if (relevantLogs.length === 0) {
        alertSheet.addRow({
          timestamp: new Date().toLocaleString(),
          logLevel: 'INFO',
          action: 'Normal Operation',
          details: 'No system alarms or warnings recorded in selected time window.',
          performedBy: 'System',
        });
      } else {
        relevantLogs.forEach(l => {
          alertSheet.addRow({
            timestamp: new Date(l.timestamp).toLocaleString(),
            logLevel: l.logLevel || 'WARNING',
            action: l.action,
            details: l.details,
            performedBy: l.performedBy || 'System',
          });
        });
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date().toISOString().split('T')[0];
      a.download = `WaterReport_Tank${selectedTankId}_${dateStr}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success('Excel workbook (.xlsx) exported successfully!');
    } catch (err) {
      console.error('Error generating Excel file:', err);
      toast.error('Failed to generate Excel file.');
    } finally {
      setExportingType(null);
    }
  };

  const handleExportPdf = async () => {
    if (!selectedTank || telemetryData.length === 0) {
      toast.error('No data to export for this time window.');
      return;
    }
    setExportingType('pdf');
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const primaryColor: [number, number, number] = [30, 58, 138];
      const grayColor: [number, number, number] = [100, 116, 139];

      // Document Header
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.setTextColor(...primaryColor);
      doc.text('MSU MOTOR POOL', 14, 18);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(...grayColor);
      doc.text('Water Reservoir Monitoring & Telemetry Report', 14, 25);

      // Divider line
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.5);
      doc.line(14, 28, 196, 28);

      // Metadata Block
      doc.setFontSize(9);
      doc.setTextColor(30, 41, 59);
      doc.text(`Tank / Reservoir: ${selectedTank.name}`, 14, 34);
      doc.text(`Date Range: ${dateRange}`, 14, 39);
      doc.text(`Generated By: ${currentUser?.username || currentUser?.email || 'System User'}`, 120, 34);
      doc.text(`Generation Time: ${new Date().toLocaleString()}`, 120, 39);

      let currentY = 45;

      // 1. EXECUTIVE SUMMARY TABLE
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...primaryColor);
      doc.text('1. Executive Telemetry Summary', 14, currentY);

      const summaryTableRows = [
        ['Average Water Level', summaryMetrics?.avgLevel !== null && summaryMetrics?.avgLevel !== undefined ? `${summaryMetrics.avgLevel}%` : 'N/A', 'Target: 20% - 90%'],
        ['Water Level Range', summaryMetrics ? `${summaryMetrics.minLevel}% - ${summaryMetrics.maxLevel}%` : 'N/A', 'Observed extremes'],
        ['Average pH Value', summaryMetrics?.avgPh !== null && summaryMetrics?.avgPh !== undefined ? `${summaryMetrics.avgPh}` : 'N/A', 'Safe range: 6.5 - 8.5'],
        ['pH Value Range', summaryMetrics ? `${summaryMetrics.minPh} - ${summaryMetrics.maxPh}` : 'N/A', 'Observed extremes'],
        ['Total Pump Cycles (Runs)', summaryMetrics?.totalPumpRuns !== undefined ? `${summaryMetrics.totalPumpRuns} cycles` : '0 cycles', 'Logged activations'],
        ['Total Alarms & Incidents', summaryMetrics?.alertsRegistered !== undefined ? `${summaryMetrics.alertsRegistered}` : '0', 'System warnings'],
      ];

      autoTable(doc, {
        startY: currentY + 3,
        head: [['Metric Parameter', 'Recorded Value', 'Operational Context']],
        body: summaryTableRows,
        theme: 'striped',
        headStyles: { fillColor: primaryColor, textColor: 255, fontSize: 9, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8.5, textColor: [30, 41, 59] },
        margin: { left: 14, right: 14 },
      });

      currentY = (doc as any).lastAutoTable.finalY + 10;

      // 2. TELEMETRY HISTORY TABLE
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...primaryColor);
      doc.text('2. Water Level & pH History (/history)', 14, currentY);

      const historyRows = telemetryData.map((d) => {
        const isLevelFault = d.waterLevel === null;
        const isPhFault = d.phLevel === null;
        const statusStr = (isLevelFault && isPhFault)
          ? 'Both Faulty'
          : isLevelFault
          ? 'Level Fault'
          : isPhFault
          ? 'pH Fault'
          : 'Normal';

        return [
          d.date,
          d.waterLevel !== null ? `${d.waterLevel}%` : 'Sensor Fault',
          d.waterLevel !== null ? `${d.height} m` : 'N/A',
          d.phLevel !== null ? `${d.phLevel}` : 'Sensor Fault',
          d.waterLevel !== null ? `${Math.round(d.waterLevel * 50)} L` : 'N/A',
          String(d.sampleCount),
          statusStr,
        ];
      });

      autoTable(doc, {
        startY: currentY + 3,
        head: [['Date / Time', 'Water Level', 'Height', 'pH Level', 'Est. Volume', 'Samples', 'Status']],
        body: historyRows,
        theme: 'grid',
        headStyles: { fillColor: primaryColor, textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
        margin: { left: 14, right: 14 },
      });

      currentY = (doc as any).lastAutoTable.finalY + 10;

      // 3. PUMP ACTIVITY TABLE
      if (currentY > 230) {
        doc.addPage();
        currentY = 20;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...primaryColor);
      doc.text('3. Pump Operational Activity', 14, currentY);

      const pumpRows = pumpActivityData.map(p => [
        p.date,
        `${p.activations} cycles`,
        p.activations > 0 ? 'Active' : 'Idle',
      ]);

      autoTable(doc, {
        startY: currentY + 3,
        head: [['Date', 'Activation Cycles', 'Operational Status']],
        body: pumpRows,
        theme: 'striped',
        headStyles: { fillColor: primaryColor, textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
        margin: { left: 14, right: 14 },
      });

      currentY = (doc as any).lastAutoTable.finalY + 10;

      // 4. ALARM & INCIDENT LOGS TABLE
      if (currentY > 230) {
        doc.addPage();
        currentY = 20;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...primaryColor);
      doc.text('4. System Alarms & Incident Logs', 14, currentY);

      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const relevantLogs = logs.filter(l => {
        const t = new Date(l.timestamp).getTime();
        return t >= cutoff && (
          l.logLevel === 'WARNING' ||
          l.logLevel === 'ERROR' ||
          l.logLevel === 'CRITICAL' ||
          l.action.toLowerCase().includes('alert') ||
          l.action.toLowerCase().includes('fault') ||
          l.action.toLowerCase().includes('alarm')
        );
      });

      const alertRows = relevantLogs.length > 0
        ? relevantLogs.slice(0, 20).map(l => [
            new Date(l.timestamp).toLocaleString(),
            l.logLevel || 'WARNING',
            l.action,
            l.details,
          ])
        : [['-', 'INFO', 'Normal Operation', 'No active warnings or incidents logged for this time window.']];

      autoTable(doc, {
        startY: currentY + 3,
        head: [['Timestamp', 'Severity', 'Action', 'Details']],
        body: alertRows,
        theme: 'striped',
        headStyles: { fillColor: primaryColor, textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
        bodyStyles: { fontSize: 7.5, textColor: [30, 41, 59] },
        margin: { left: 14, right: 14 },
      });

      // Page numbers footer
      const pageCount = (doc as any).internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(
          `MSU Motor Pool Water Monitoring System • Page ${i} of ${pageCount}`,
          14,
          290
        );
      }

      const dateStr = new Date().toISOString().split('T')[0];
      doc.save(`WaterReport_Tank${selectedTankId}_${dateStr}.pdf`);
      toast.success('PDF document exported successfully!');
    } catch (err) {
      console.error('Error generating PDF file:', err);
      toast.error('Failed to generate PDF file.');
    } finally {
      setExportingType(null);
    }
  };

  // Table pagination calculations
  const totalPages = Math.ceil(telemetryData.length / itemsPerPage);
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return telemetryData.slice(startIndex, startIndex + itemsPerPage);
  }, [telemetryData, currentPage]);

  const isLoadingTanks = tanks.length === 0;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-6 print:p-0 print:bg-white print:text-black"
    >
      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-3xl font-extrabold text-foreground flex items-center gap-2 tracking-tight">
            <TrendingUp className="text-primary h-8 w-8 animate-pulse" /> Telemetry Reports & Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Analyze historical run logs, sensor stability parameters, and download printable logs.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-safe/90 bg-safe/5 border border-safe/20 px-3 py-1.5 rounded-full shadow-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-safe opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-safe"></span>
            </span>
            Real-Time Live Telemetry Active
          </div>
        </div>
      </div>

      {/* FILTER CONTROL CARD */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-card/40 backdrop-blur-md p-4 rounded-xl border border-border/40 shadow-sm print:hidden">
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-muted-foreground tracking-wider uppercase">Select Reservoir</label>
          <select 
            value={selectedTankId} 
            onChange={e => { setSelectedTankId(e.target.value); setReportGenerated(false); setCurrentPage(1); }}
            disabled={isLoadingTanks}
            className="w-full text-sm bg-background border border-border/60 hover:border-primary/50 focus:border-primary px-3.5 py-2.5 rounded-lg outline-none transition text-foreground disabled:opacity-50"
          >
            {isLoadingTanks ? (
              <option value="">Syncing database telemetry...</option>
            ) : tanks.length === 0 ? (
              <option value="">No operational tanks installed</option>
            ) : (
              tanks.map(t => (
                <option key={t.id} value={t.id}>{t.name} {!t.enabled ? '(Disabled)' : ''}</option>
              ))
            )}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-bold text-muted-foreground tracking-wider uppercase">Time window</label>
          <select 
            value={dateRange} 
            onChange={e => { setDateRange(e.target.value as DateRange); setReportGenerated(false); setCurrentPage(1); }}
            className="w-full text-sm bg-background border border-border/60 hover:border-primary/50 focus:border-primary px-3.5 py-2.5 rounded-lg outline-none transition text-foreground"
          >
            {DATE_RANGES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <div className="flex items-end print:hidden">
          <button
            disabled={isGenerating || isLoadingTanks || telemetryData.length === 0}
            onClick={handleGenerateReport}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary hover:opacity-90 active:scale-[0.98] py-2.5 text-sm font-bold text-primary-foreground transition disabled:opacity-40"
          >
            {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
            {isGenerating ? 'Analyzing Trends...' : 'Compile Reports Dashboard'}
          </button>
        </div>
      </div>

      {/* ACTIVE CRITICAL ALERTS BANNER SYSTEM */}
      <AnimatePresence>
        {activeAlerts.length > 0 && selectedTank && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-danger/10 border-l-4 border-danger p-4 rounded-r-xl flex items-start gap-3 shadow-sm print:hidden overflow-hidden"
          >
            <AlertOctagon className="text-danger h-5 w-5 shrink-0 mt-0.5 animate-bounce" />
            <div className="flex-1 space-y-1">
              <h4 className="text-sm font-bold text-danger flex items-center gap-1.5">
                Active System Alarms Detected ({activeAlerts.length})
              </h4>
              <p className="text-xs text-danger/80">
                The hardware node is currently broadcasting critical thresholds. Operator inspection is advised.
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {activeAlerts.map((alert, idx) => (
                  <span key={idx} className="text-[10px] bg-danger/10 border border-danger/30 text-danger px-2 py-0.5 rounded-full font-bold uppercase tracking-wider animate-pulse">
                    {alert}
                  </span>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* TOP SECTION: MODERN GLASSMORPHIC STATUS CARDS (OR PULSING SKELETONS WHILE LOADING) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoadingTanks || !selectedTank ? (
          // RENDER 4 MODERN SKELETAL PULSING CARDS
          Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="animate-pulse bg-card/20 border border-border/25 h-32 rounded-xl p-5 flex flex-col justify-between">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-secondary" />
                <div className="h-4 w-24 rounded bg-secondary" />
              </div>
              <div className="h-8 w-16 rounded bg-secondary" />
              <div className="h-2 w-full rounded-full bg-secondary" />
            </div>
          ))
        ) : (
          <>
            {/* CARD 1: WATER LEVEL CARD */}
            <motion.div 
              whileHover={{ y: -3 }}
              className="bg-card/40 backdrop-blur-md p-5 rounded-xl border border-border/40 shadow-sm relative overflow-hidden flex flex-col justify-between"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500 border border-blue-500/20">
                    <Droplet size={18} className="animate-bounce" />
                  </div>
                  <span className="text-xs font-bold text-muted-foreground tracking-wider uppercase">Water Level</span>
                </div>
                <span className={`h-2.5 w-2.5 rounded-full ${
                  processedTank.waterLevel < 20 ? 'bg-danger animate-ping' :
                  processedTank.waterLevel > 90 ? 'bg-warning animate-pulse' :
                  'bg-safe'
                }`} />
              </div>

              <div className="space-y-1">
                <h2 className="text-3xl font-extrabold tracking-tight text-foreground font-mono">
                  {Math.round(processedTank?.waterLevel ?? 0)}%
                </h2>
                <div className="flex justify-between items-center text-xs text-muted-foreground font-medium">
                  <span>Height: {(processedTank?.waterHeight ?? 0).toFixed(2)}m</span>
                  <span>Volume: {Math.round((processedTank?.waterLevel ?? 0) * 50).toLocaleString()}L</span>
                </div>
              </div>

              <div className="mt-4 space-y-1">
                <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-500 ${
                      (processedTank?.waterLevel ?? 0) < 20 ? 'bg-danger' :
                      (processedTank?.waterLevel ?? 0) > 90 ? 'bg-warning' :
                      'bg-blue-500'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, processedTank?.waterLevel ?? 0))}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground block text-right font-medium">Cap: 5,000L Max</span>
              </div>
            </motion.div>

            {/* CARD 2: PH LEVEL CARD */}
            <motion.div 
              whileHover={{ y: -3 }}
              className="bg-card/40 backdrop-blur-md p-5 rounded-xl border border-border/40 shadow-sm relative overflow-hidden flex flex-col justify-between"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500 border border-purple-500/20">
                    <Activity size={18} />
                  </div>
                  <span className="text-xs font-bold text-muted-foreground tracking-wider uppercase">pH Level</span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-md border font-bold uppercase tracking-wider ${phCategory.color}`}>
                  {phCategory.label}
                </span>
              </div>

              <div className="space-y-1">
                <h2 className="text-3xl font-extrabold tracking-tight text-foreground font-mono">
                  {(processedTank?.phLevel ?? 7.0).toFixed(1)}
                </h2>
                <div className="flex justify-between text-xs text-muted-foreground font-medium">
                  <span>Threshold min: 6.5</span>
                  <span>max: 8.5</span>
                </div>
              </div>

              <div className="mt-4 pt-2 border-t border-border/40 flex items-center justify-between text-xs font-medium text-muted-foreground">
                <span>Status:</span>
                <span className={processedTank?.phSensorOk ? 'text-safe' : 'text-danger animate-pulse font-bold'}>
                  {processedTank?.phSensorOk ? 'SENSOR OK' : 'SENSOR FAULT'}
                </span>
              </div>
            </motion.div>

            {/* CARD 3: PUMP & ACTUATORS CARD */}
            <motion.div 
              whileHover={{ y: -3 }}
              className="bg-card/40 backdrop-blur-md p-5 rounded-xl border border-border/40 shadow-sm relative overflow-hidden flex flex-col justify-between"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                    <Cpu size={18} />
                  </div>
                  <span className="text-xs font-bold text-muted-foreground tracking-wider uppercase">Pump System</span>
                </div>
                <span className={`h-2.5 w-2.5 rounded-full ${processedTank?.pumpOn ? 'bg-safe animate-ping' : 'bg-muted-foreground/60'}`} />
              </div>

              <div className="space-y-1">
                <h2 className="text-3xl font-extrabold tracking-tight text-foreground font-mono">
                  {processedTank?.pumpOn ? 'ACTIVE' : 'STANDBY'}
                </h2>
                <p className="text-xs text-muted-foreground font-medium">
                  Daily Activations: {pumpActivityData[pumpActivityData.length - 1]?.activations ?? 0}
                </p>
              </div>

              <div className="mt-4 pt-2 border-t border-border/40 flex items-center justify-between text-xs font-medium text-muted-foreground">
                <span>Flow Rate:</span>
                <span className={processedTank?.pumpOn ? 'text-safe font-mono font-bold' : 'text-muted-foreground font-mono'}>
                  {processedTank?.pumpOn ? '250 L/min' : '0 L/min'}
                </span>
              </div>
            </motion.div>

            {/* CARD 4: DIAGNOSTICS & SYSTEM CARD */}
            <motion.div 
              whileHover={{ y: -3 }}
              className="bg-card/40 backdrop-blur-md p-5 rounded-xl border border-border/40 shadow-sm relative overflow-hidden flex flex-col justify-between"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-orange-500/10 text-orange-500 border border-orange-500/20">
                    <Wifi size={18} />
                  </div>
                  <span className="text-xs font-bold text-muted-foreground tracking-wider uppercase">Diagnostics</span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-md border font-bold uppercase tracking-wider ${rssiDetails.color} bg-background/50 border-border/40`}>
                  {rssiDetails.label}
                </span>
              </div>

              <div className="space-y-1">
                <h2 className="text-2xl font-extrabold tracking-tight text-foreground font-mono">
                  {processedTank?.rssi ?? -999} dBm
                </h2>
                <div className="flex justify-between items-center text-xs text-muted-foreground font-medium">
                  <span>Link: {processedTank?.ethConnected ? 'Ethernet' : 'WiFi Backup'}</span>
                  <Database size={14} className={processedTank?.firebaseConnected ? 'text-safe' : 'text-danger'} />
                </div>
              </div>

              <div className="mt-4 pt-2 border-t border-border/40 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                <span>Sync Timestamp:</span>
                <span className="font-semibold text-foreground">
                  {new Date(processedTank?.lastUpdate || Date.now()).toLocaleTimeString()}
                </span>
              </div>
            </motion.div>
          </>
        )}
      </div>

      {/* CHARTS CONTAINER GRID (SKELETONS WHILE SYNCING TELEMETRY) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {isLoadingTanks || !selectedTank || isLoadingHistory ? (
          // RENDER CHART PLACEHOLDER SKELETONS
          Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="bg-card/20 border border-border/25 h-80 rounded-xl p-6 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="h-5 w-48 rounded bg-secondary animate-pulse" />
                <div className="h-3 w-72 rounded bg-secondary animate-pulse" />
              </div>
              <div className="h-44 w-full rounded bg-secondary/15 flex items-center justify-center">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <Loader2 className="animate-spin" size={16} /> Syncing telemetry trends...
                </div>
              </div>
            </div>
          ))
        ) : (
          <>
            {/* CHART 1: WATER LEVEL TREND (AREA) */}
            <div className="bg-card/30 backdrop-blur-md p-6 rounded-xl border border-border/40 shadow-sm flex flex-col justify-between print:w-full">
              <div>
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2 tracking-tight">
                  <TrendingUp className="text-blue-500 h-5 w-5" /> Water Level % Telemetry Drift
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Real water level drift grouped by {days === 7 ? 'hourly' : 'daily'} averages ({dateRange})
                </p>
              </div>
              {telemetryData.length === 0 ? (
                <div className="h-72 w-full mt-6 flex flex-col items-center justify-center text-muted-foreground border border-dashed border-border/40 rounded-xl bg-secondary/5 p-6 text-center">
                  <Droplet size={32} className="opacity-30 mb-2 text-blue-500" />
                  <span className="text-sm font-semibold text-foreground">No data yet</span>
                  <span className="text-xs text-muted-foreground mt-1 max-w-xs">
                    No historical water level samples recorded for {dateRange.toLowerCase()}.
                  </span>
                </div>
              ) : (
                <div className="h-72 w-full mt-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={telemetryData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="levelGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={(val) => `${val}%`} />
                      <Tooltip
                        contentStyle={{ background: 'hsl(var(--card))', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px', color: 'hsl(var(--foreground))' }}
                        formatter={(value: any) => [value !== null ? `${value}%` : 'Sensor Fault', 'Water Level']}
                      />
                      <Area type="monotone" dataKey="waterLevel" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#levelGradient)" dot={{ r: 4, fill: '#3b82f6' }} />
                      <ReferenceLine y={20} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Low Threshold', fill: '#ef4444', fontSize: 9, position: 'insideBottomLeft' }} />
                      <ReferenceLine y={90} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: 'High Threshold', fill: '#f59e0b', fontSize: 9, position: 'insideTopLeft' }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* CHART 2: pH LEVEL TREND (LINE) */}
            <div className="bg-card/30 backdrop-blur-md p-6 rounded-xl border border-border/40 shadow-sm flex flex-col justify-between print:w-full">
              <div>
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2 tracking-tight">
                  <TrendingUp className="text-purple-500 h-5 w-5" /> pH Level Telemetry Drift
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Real pH drift grouped by {days === 7 ? 'hourly' : 'daily'} averages ({dateRange})
                </p>
              </div>
              {telemetryData.length === 0 ? (
                <div className="h-72 w-full mt-6 flex flex-col items-center justify-center text-muted-foreground border border-dashed border-border/40 rounded-xl bg-secondary/5 p-6 text-center">
                  <Activity size={32} className="opacity-30 mb-2 text-purple-500" />
                  <span className="text-sm font-semibold text-foreground">No data yet</span>
                  <span className="text-xs text-muted-foreground mt-1 max-w-xs">
                    No historical pH samples recorded for {dateRange.toLowerCase()}.
                  </span>
                </div>
              ) : (
                <div className="h-72 w-full mt-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={telemetryData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="phGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#a855f7" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                      <YAxis domain={[5.0, 9.0]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={(val) => Number(val).toFixed(1)} />
                      <Tooltip
                        contentStyle={{ background: 'hsl(var(--card))', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px', color: 'hsl(var(--foreground))' }}
                        formatter={(value: any) => [value !== null ? `${value} pH` : 'Sensor Fault', 'pH Value']}
                      />
                      <Line type="monotone" dataKey="phLevel" stroke="#a855f7" strokeWidth={3} dot={{ r: 3, fill: 'hsl(var(--card))' }} />
                      <ReferenceLine y={6.5} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'Acidic Limit', fill: '#ef4444', fontSize: 9, position: 'insideBottomLeft' }} />
                      <ReferenceLine y={8.5} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'Alkaline Limit', fill: '#ef4444', fontSize: 9, position: 'insideTopLeft' }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* CHART 3: PUMP RUNS ACTIVITY (BAR) */}
            <div className="bg-card/30 backdrop-blur-md p-6 rounded-xl border border-border/40 shadow-sm flex flex-col justify-between print:w-full">
              <div>
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2 tracking-tight">
                  <Activity className="text-emerald-500 h-5 w-5" /> Pump Activity Logs Histogram
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Daily pump activation counts compiled from dynamic system event logs
                </p>
              </div>
              <div className="h-72 w-full mt-6">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={pumpActivityData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip
                      contentStyle={{ background: 'hsl(var(--card))', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px', color: 'hsl(var(--foreground))' }}
                      formatter={(value: any) => [`${value} runs`, 'Activations']}
                    />
                    <Bar dataKey="activations" fill="#10b981" radius={[4, 4, 0, 0]}>
                      {pumpActivityData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.activations > 2 ? '#10b981' : '#34d399'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* CHART 4: ALERTS PIE CHART */}
            <div className="bg-card/30 backdrop-blur-md p-6 rounded-xl border border-border/40 shadow-sm flex flex-col justify-between print:w-full">
              <div>
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2 tracking-tight">
                  <AlertTriangle className="text-orange-500 h-5 w-5" /> Alert Occurrence Distribution
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Historical breakdown of registered alarm states and network flags
                </p>
              </div>
              {alertDistributionData.length === 0 ? (
                <div className="h-72 w-full mt-6 flex items-center justify-center text-muted-foreground text-sm font-medium">
                  No alerts recorded
                </div>
              ) : (
                <div className="h-72 w-full mt-6 flex flex-col sm:flex-row items-center justify-between">
                  <div className="h-full w-full sm:w-[55%]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={alertDistributionData}
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={75}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {alertDistributionData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ background: 'hsl(var(--card))', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px', color: 'hsl(var(--foreground))' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="w-full sm:w-[45%] space-y-2 mt-4 sm:mt-0">
                    {alertDistributionData.map((entry, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }} />
                          <span className="text-muted-foreground font-medium truncate max-w-[120px]">{entry.name}</span>
                        </div>
                        <span className="font-bold text-foreground">{entry.value} occurrences</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* BOTTOM SECTION: REPORTS TABLE & PRINT LOGS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* COMPREHENSIVE REPORTS TABLE */}
        <div className="bg-card/30 backdrop-blur-md p-6 rounded-xl border border-border/40 shadow-sm lg:col-span-2 flex flex-col justify-between print:col-span-3">
          <div>
            <div className="flex items-center justify-between print:hidden">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <ScrollText size={18} className="text-primary" /> Printable Telemetry Log Table
              </h3>
              <span className="text-xs text-muted-foreground font-medium">Page {currentPage} of {totalPages || 1}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 print:hidden">
              {days === 7 ? 'Hourly' : 'Daily'} averaged telemetry logs with water height and estimated metrics
            </p>
            
            <div className="mt-6 overflow-x-auto w-full">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border/40 text-muted-foreground font-bold tracking-wide uppercase bg-secondary/30">
                    <th className="py-3 px-4 rounded-l-lg">Date</th>
                    <th className="py-3 px-4">Level (%)</th>
                    <th className="py-3 px-4">Height (m)</th>
                    <th className="py-3 px-4">pH Value</th>
                    <th className="py-3 px-4 rounded-r-lg">Est. Volume (L)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20 font-mono">
                  {isLoadingTanks || !selectedTank || isLoadingHistory ? (
                    Array.from({ length: 4 }).map((_, idx) => (
                      <tr key={idx} className="animate-pulse">
                        <td className="py-3 px-4"><div className="h-4 w-12 rounded bg-secondary" /></td>
                        <td className="py-3 px-4"><div className="h-4 w-8 rounded bg-secondary" /></td>
                        <td className="py-3 px-4"><div className="h-4 w-8 rounded bg-secondary" /></td>
                        <td className="py-3 px-4"><div className="h-4 w-8 rounded bg-secondary" /></td>
                        <td className="py-3 px-4"><div className="h-4 w-12 rounded bg-secondary" /></td>
                      </tr>
                    ))
                  ) : (
                    paginatedData.map((row, idx) => (
                      <tr key={idx} className="hover:bg-secondary/10 transition-colors">
                        <td className="py-3.5 px-4 font-sans font-semibold text-foreground">{row.date}</td>
                        <td className="py-3.5 px-4 text-foreground font-bold">
                          {row.waterLevel !== null ? (
                            <span className={`px-2 py-0.5 rounded ${
                              row.waterLevel < 20 ? 'bg-danger/10 text-danger' : 'text-blue-500'
                            }`}>{row.waterLevel}%</span>
                          ) : (
                            <span className="text-muted-foreground italic text-[11px]">Sensor Fault</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-muted-foreground">{row.height}m</td>
                        <td className="py-3.5 px-4">
                          {row.phLevel !== null ? (
                            <span className={`px-2 py-0.5 rounded ${
                              row.phLevel < 6.5 || row.phLevel > 8.5 ? 'bg-danger/10 text-danger' : 'text-purple-500'
                            }`}>{row.phLevel}</span>
                          ) : (
                            <span className="text-muted-foreground italic text-[11px]">Sensor Fault</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-foreground font-bold">
                          {row.waterLevel !== null ? `${Math.round(row.waterLevel * 50).toLocaleString()} L` : 'N/A'}
                        </td>
                      </tr>
                    ))
                  )}
                  {!isLoadingTanks && selectedTank && !isLoadingHistory && paginatedData.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-muted-foreground font-sans">
                        <div className="flex flex-col items-center justify-center gap-1.5">
                          <Database size={24} className="opacity-40" />
                          <span className="font-semibold text-foreground text-sm">No data yet</span>
                          <span className="text-xs text-muted-foreground">Historical telemetry records will appear once samples are logged for {dateRange.toLowerCase()}.</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Table pagination controls */}
          {!isLoadingTanks && selectedTank && totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 mt-4 border-t border-border/40 print:hidden">
              <button 
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="flex items-center gap-1 text-xs border border-border/60 hover:border-primary/50 disabled:opacity-40 px-3 py-1.5 rounded-lg transition-colors text-muted-foreground"
              >
                <ChevronLeft size={14} /> Previous
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentPage(i + 1)}
                    className={`h-7 w-7 rounded-lg text-xs font-bold transition-colors ${
                      currentPage === i + 1 ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
              <button 
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="flex items-center gap-1 text-xs border border-border/60 hover:border-primary/50 disabled:opacity-40 px-3 py-1.5 rounded-lg transition-colors text-muted-foreground"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>

        {/* ALARM LOGS & ANALYTICS SUMMARY PANEL */}
        <div className="space-y-6">
          {/* ANALYTICS SUMMARY */}
          {isLoadingTanks || !selectedTank || isLoadingHistory ? (
            <div className="bg-card/20 animate-pulse border border-border/25 h-[230px] rounded-xl p-6 flex flex-col justify-between">
              <div className="h-5 w-32 rounded bg-secondary" />
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-10 rounded bg-secondary/80" />
                ))}
              </div>
            </div>
          ) : !summaryMetrics ? (
            <div className="bg-card/30 backdrop-blur-md p-6 rounded-xl border border-border/40 shadow-sm">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2 mb-3">
                <TrendingUp size={16} className="text-primary" /> Window Analytics Summary
              </h3>
              <div className="py-10 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-1.5">
                <Database size={24} className="opacity-40" />
                <span className="font-semibold text-foreground text-sm">No data yet</span>
                <span>Averages and ranges will appear once telemetry records are available for {dateRange.toLowerCase()}.</span>
              </div>
            </div>
          ) : (
            <div className="bg-card/30 backdrop-blur-md p-6 rounded-xl border border-border/40 shadow-sm">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2 mb-4">
                <TrendingUp size={16} className="text-primary" /> Window Analytics Summary
              </h3>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-secondary/20 p-2.5 rounded-lg border border-border/10">
                  <span className="text-muted-foreground block">Avg Water Level</span>
                  <span className="text-base font-extrabold text-blue-500 font-mono block mt-1">{summaryMetrics.avgLevel}%</span>
                </div>
                <div className="bg-secondary/20 p-2.5 rounded-lg border border-border/10">
                  <span className="text-muted-foreground block">Water Level Range</span>
                  <span className="text-xs font-bold text-foreground font-mono block mt-1">
                    {summaryMetrics.minLevel}% - {summaryMetrics.maxLevel}%
                  </span>
                </div>
                <div className="bg-secondary/20 p-2.5 rounded-lg border border-border/10">
                  <span className="text-muted-foreground block">Avg pH Value</span>
                  <span className="text-base font-extrabold text-purple-500 font-mono block mt-1">{summaryMetrics.avgPh}</span>
                </div>
                <div className="bg-secondary/20 p-2.5 rounded-lg border border-border/10">
                  <span className="text-muted-foreground block">pH Value Range</span>
                  <span className="text-xs font-bold text-foreground font-mono block mt-1">
                    {summaryMetrics.minPh} - {summaryMetrics.maxPh}
                  </span>
                </div>
                <div className="bg-secondary/20 p-2.5 rounded-lg border border-border/10">
                  <span className="text-muted-foreground block">Total Pump Cycles</span>
                  <span className="text-base font-extrabold text-emerald-500 font-mono block mt-1">{summaryMetrics.totalPumpRuns}</span>
                </div>
                <div className="bg-secondary/20 p-2.5 rounded-lg border border-border/10">
                  <span className="text-muted-foreground block">Incidents Logged</span>
                  <span className="text-base font-extrabold text-orange-500 font-mono block mt-1">{summaryMetrics.alertsRegistered}</span>
                </div>
              </div>
            </div>
          )}

          {/* HISTORICAL ALERT LOGS */}
          <div className="bg-card/30 backdrop-blur-md p-6 rounded-xl border border-border/40 shadow-sm flex-1 flex flex-col justify-between">
            <div>
              <h3 className="text-base font-bold text-foreground flex items-center gap-2 mb-3">
                <AlertOctagon size={16} className="text-danger" /> System Warnings & Alarms
              </h3>
              <div className="space-y-2 max-h-[170px] overflow-y-auto pr-1">
                {alertHistoryLogs.map((log) => (
                  <div key={log.id} className="p-2.5 rounded-lg bg-danger/5 border border-danger/10 text-[11px] flex gap-2">
                    <AlertTriangle className="text-danger shrink-0 mt-0.5" size={13} />
                    <div className="flex-1 space-y-0.5">
                      <span className="font-bold text-foreground block uppercase text-[10px] tracking-wide">{log.action}</span>
                      <p className="text-muted-foreground leading-tight">{log.details}</p>
                      <span className="text-[9px] text-muted-foreground/60 font-mono block">
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
                {alertHistoryLogs.length === 0 && (
                  <div className="py-8 text-center text-xs text-muted-foreground font-medium">
                    No critical alarms or events logged. System is operating safely.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* EXPORT CONTROL BUTTONS PANEL (AVAILABLE TO ADMIN AND WORKER ROLES ONLY) */}
      {canExport && selectedTank && (
        <div className="bg-card/40 backdrop-blur-md p-5 rounded-xl border border-border/40 shadow-sm print:hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Download size={16} className="text-primary" /> Document & Telemetry Export
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Export comprehensive operational records for {selectedTank.name} ({dateRange}).
              </p>
            </div>
            {telemetryData.length === 0 && (
              <span className="text-xs font-semibold text-warning bg-warning/10 border border-warning/20 px-3 py-1 rounded-full w-fit">
                No data to export
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* EXCEL EXPORT BUTTON */}
            <button
              disabled={exportingType !== null || telemetryData.length === 0}
              onClick={handleExportExcel}
              title={telemetryData.length === 0 ? "No data to export" : "Download Excel workbook (.xlsx)"}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:scale-95 px-4 py-2.5 text-xs font-bold text-white transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            >
              {exportingType === 'excel' ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <FileSpreadsheet size={15} />
              )}
              {exportingType === 'excel'
                ? 'Generating Excel...'
                : telemetryData.length === 0
                ? 'Excel (.xlsx) - No data to export'
                : 'Download Excel (.xlsx)'}
            </button>

            {/* PDF EXPORT BUTTON */}
            <button
              disabled={exportingType !== null || telemetryData.length === 0}
              onClick={handleExportPdf}
              title={telemetryData.length === 0 ? "No data to export" : "Export PDF document"}
              className="flex items-center gap-2 rounded-lg bg-primary hover:opacity-90 active:scale-95 px-4 py-2.5 text-xs font-bold text-primary-foreground transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            >
              {exportingType === 'pdf' ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <FileText size={15} />
              )}
              {exportingType === 'pdf'
                ? 'Generating PDF...'
                : telemetryData.length === 0
                ? 'PDF - No data to export'
                : 'Export PDF Document'}
            </button>

            {/* CSV SPREADSHEET BUTTON */}
            <button
              disabled={exportingType !== null || telemetryData.length === 0}
              onClick={() => handleExport('csv')}
              title={telemetryData.length === 0 ? "No data to export" : "Download CSV spreadsheet"}
              className="flex items-center gap-2 rounded-lg border border-primary text-primary hover:bg-primary/5 active:scale-95 px-4 py-2.5 text-xs font-bold transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={15} />
              {telemetryData.length === 0 ? 'CSV - No data to export' : 'Download CSV Spreadsheet'}
            </button>

            {/* PRINT LAYOUT BUTTON */}
            <button
              disabled={exportingType !== null || telemetryData.length === 0}
              onClick={() => handleExport('print')}
              title={telemetryData.length === 0 ? "No data to export" : "Print layout"}
              className="flex items-center gap-2 rounded-lg border border-border/80 text-foreground hover:bg-secondary/40 active:scale-95 px-4 py-2.5 text-xs font-bold transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Printer size={15} />
              {telemetryData.length === 0 ? 'Print - No data to export' : 'Print Layout'}
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default Reports;
