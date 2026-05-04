export interface User {
  email: string;
  name: string;
}

export interface ColumnInfo {
  name: string;
  type: 'number' | 'string' | 'date';
}

export interface SheetInfo {
  name: string;
  rowCount: number;
  kind: 'data' | 'report' | 'summary' | 'dashboard';
}

export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'heatmap' | 'table';

export interface ChartConfig {
  id: string;
  type: ChartType;
  title: string;
  xAxis?: string;
  yAxes: string[];
  subSheetName?: string;
  cachedData?: Record<string, unknown>[];
}

export interface Report {
  id: string;
  name: string;
  prompt?: string;
  charts: ChartConfig[];
  dataSourceId: string;
  createdAt: string;
}

export type AlertCondition = 'above' | 'below' | 'equals' | 'change_pct';

export interface AlertColumnRule {
  column: string;
  condition: AlertCondition;
  threshold: number;
}
export type NotificationSchedule = 'immediate' | 'weekly' | 'custom';

export interface Alert {
  id: string;
  name: string;
  dataSourceId: string;       // '' when monitoring a custom sheet URL
  sheetUrl?: string;          // Google Sheet URL entered directly in alert (not imported)
  subSheetName?: string;      // which sub-sheet tab to monitor
  columnRules: AlertColumnRule[];  // per-column condition + threshold
  schedule: NotificationSchedule;
  customDay?: string;
  checkInterval: string;      // '10s' | '30s' | '1m' | '5m' | '15m' | '30m' | '1h'
  emailBody?: string;         // custom message included at top of alert emails
  notificationEmails: string[];
  enabled: boolean;
  createdAt: string;
}

export interface SubSheetData {
  name: string;
  kind: SheetInfo['kind'];
  data: Record<string, unknown>[];
  columns: ColumnInfo[];
}

export interface DataSource {
  id: string;
  name: string;
  type: 'csv' | 'excel' | 'google_sheets';
  url?: string;
  data: Record<string, unknown>[];
  columns: ColumnInfo[];
  sheets: SheetInfo[];
  activeSheet: string;
  lastSync?: string;
  subSheets?: SubSheetData[];
  charts?: ChartConfig[];
}

export interface EmailJSConfig {
  serviceId: string;
  templateId: string;
  publicKey: string;
}

export interface CloudinaryConfig {
  cloudName: string;
  uploadPreset: string;
}

export interface CapturedVisual {
  id: string;
  name: string;
  dataSourceId: string;
  imageDataUrl: string;
  createdAt: string;
}

export interface AppState {
  user: User | null;
  dataSources: DataSource[];
  activeDataSourceId: string | null;
  reports: Report[];
  alerts: Alert[];
  emailjsConfig: EmailJSConfig | null;
  cloudinaryConfig: CloudinaryConfig | null;
  capturedVisuals: CapturedVisual[];
}
