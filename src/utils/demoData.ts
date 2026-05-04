import type { DataSource, ColumnInfo, SheetInfo } from '../types';

export const DEMO_DATA: Record<string, unknown>[] = [
  { Date: '2024-01-05', Product: 'Laptop Pro', Category: 'Electronics', Region: 'North', Sales: 45, Revenue: 67500, Units: 45, Profit: 13500 },
  { Date: '2024-01-05', Product: 'Wireless Mouse', Category: 'Accessories', Region: 'North', Sales: 120, Revenue: 3600, Units: 120, Profit: 1440 },
  { Date: '2024-01-05', Product: 'Monitor 27"', Category: 'Electronics', Region: 'South', Sales: 30, Revenue: 21000, Units: 30, Profit: 5250 },
  { Date: '2024-01-05', Product: 'Keyboard Mech', Category: 'Accessories', Region: 'East', Sales: 85, Revenue: 12750, Units: 85, Profit: 3825 },
  { Date: '2024-01-12', Product: 'Laptop Pro', Category: 'Electronics', Region: 'South', Sales: 52, Revenue: 78000, Units: 52, Profit: 15600 },
  { Date: '2024-01-12', Product: 'USB Hub', Category: 'Accessories', Region: 'West', Sales: 200, Revenue: 6000, Units: 200, Profit: 2400 },
  { Date: '2024-01-12', Product: 'Tablet X', Category: 'Electronics', Region: 'North', Sales: 38, Revenue: 30400, Units: 38, Profit: 7600 },
  { Date: '2024-01-19', Product: 'Laptop Air', Category: 'Electronics', Region: 'East', Sales: 40, Revenue: 48000, Units: 40, Profit: 9600 },
  { Date: '2024-01-19', Product: 'Webcam HD', Category: 'Accessories', Region: 'South', Sales: 95, Revenue: 9500, Units: 95, Profit: 2850 },
  { Date: '2024-01-26', Product: 'Monitor 27"', Category: 'Electronics', Region: 'West', Sales: 25, Revenue: 17500, Units: 25, Profit: 4375 },
  { Date: '2024-02-02', Product: 'Laptop Pro', Category: 'Electronics', Region: 'North', Sales: 60, Revenue: 90000, Units: 60, Profit: 18000 },
  { Date: '2024-02-02', Product: 'Wireless Mouse', Category: 'Accessories', Region: 'East', Sales: 140, Revenue: 4200, Units: 140, Profit: 1680 },
  { Date: '2024-02-09', Product: 'Tablet X', Category: 'Electronics', Region: 'South', Sales: 44, Revenue: 35200, Units: 44, Profit: 8800 },
  { Date: '2024-02-09', Product: 'Keyboard Mech', Category: 'Accessories', Region: 'North', Sales: 70, Revenue: 10500, Units: 70, Profit: 3150 },
  { Date: '2024-02-16', Product: 'Laptop Air', Category: 'Electronics', Region: 'West', Sales: 35, Revenue: 42000, Units: 35, Profit: 8400 },
  { Date: '2024-02-16', Product: 'USB Hub', Category: 'Accessories', Region: 'South', Sales: 180, Revenue: 5400, Units: 180, Profit: 2160 },
  { Date: '2024-02-23', Product: 'Monitor 27"', Category: 'Electronics', Region: 'East', Sales: 28, Revenue: 19600, Units: 28, Profit: 4900 },
  { Date: '2024-03-01', Product: 'Laptop Pro', Category: 'Electronics', Region: 'South', Sales: 55, Revenue: 82500, Units: 55, Profit: 16500 },
  { Date: '2024-03-01', Product: 'Webcam HD', Category: 'Accessories', Region: 'North', Sales: 110, Revenue: 11000, Units: 110, Profit: 3300 },
  { Date: '2024-03-08', Product: 'Tablet X', Category: 'Electronics', Region: 'West', Sales: 50, Revenue: 40000, Units: 50, Profit: 10000 },
  { Date: '2024-03-08', Product: 'Wireless Mouse', Category: 'Accessories', Region: 'South', Sales: 155, Revenue: 4650, Units: 155, Profit: 1860 },
  { Date: '2024-03-15', Product: 'Laptop Air', Category: 'Electronics', Region: 'North', Sales: 48, Revenue: 57600, Units: 48, Profit: 11520 },
  { Date: '2024-03-22', Product: 'Monitor 27"', Category: 'Electronics', Region: 'East', Sales: 32, Revenue: 22400, Units: 32, Profit: 5600 },
  { Date: '2024-03-29', Product: 'Keyboard Mech', Category: 'Accessories', Region: 'West', Sales: 90, Revenue: 13500, Units: 90, Profit: 4050 },
];

export const DEMO_COLUMNS: ColumnInfo[] = [
  { name: 'Date', type: 'date' },
  { name: 'Product', type: 'string' },
  { name: 'Category', type: 'string' },
  { name: 'Region', type: 'string' },
  { name: 'Sales', type: 'number' },
  { name: 'Revenue', type: 'number' },
  { name: 'Units', type: 'number' },
  { name: 'Profit', type: 'number' },
];

export const DEMO_SHEETS: SheetInfo[] = [
  { name: 'Sales Data', rowCount: 24, kind: 'data' },
  { name: 'Monthly Summary', rowCount: 3, kind: 'summary' },
  { name: 'Dashboard', rowCount: 0, kind: 'dashboard' },
  { name: 'Q1 Report', rowCount: 12, kind: 'report' },
];

export function createGoogleSheetsDemoSource(url: string): DataSource {
  const id = `gs_${Date.now()}`;
  const spreadsheetName = 'Q1 Sales Performance';
  return {
    id,
    name: spreadsheetName,
    type: 'google_sheets',
    url,
    data: DEMO_DATA,
    columns: DEMO_COLUMNS,
    sheets: DEMO_SHEETS,
    activeSheet: 'Sales Data',
    lastSync: new Date().toISOString(),
  };
}

export function inferColumns(data: Record<string, unknown>[]): ColumnInfo[] {
  if (data.length === 0) return [];
  const sample = data[0];
  return Object.keys(sample).map((name) => {
    const val = sample[name];
    let type: 'number' | 'string' | 'date' = 'string';
    if (typeof val === 'number' || (typeof val === 'string' && val !== '' && !isNaN(Number(val)))) {
      type = 'number';
    } else if (typeof val === 'string' && !isNaN(Date.parse(val))) {
      type = 'date';
    }
    return { name, type };
  });
}
