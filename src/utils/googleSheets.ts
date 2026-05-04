import Papa from 'papaparse'
import type { DataSource, SheetInfo, ColumnInfo, SubSheetData, ChartConfig, ChartType } from '../types'
import { inferColumns } from './demoData'

// ─── URL helpers ─────────────────────────────────────────────────────────────
export function extractSpreadsheetId(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  return m ? m[1] : null
}

function extractGid(url: string): string | null {
  const m = url.match(/[?&#]gid=(\d+)/)
  return m ? m[1] : null
}

// ─── Sheet kind detection ─────────────────────────────────────────────────────
export function detectKind(name: string): SheetInfo['kind'] {
  const n = name.toLowerCase()
  if (n.includes('pivot') || n.includes('report')) return 'report'
  if (n.includes('summary') || n.includes('overview')) return 'summary'
  if (n.includes('dashboard')) return 'dashboard'
  return 'data'
}

// ─── Common sheet names to probe ──────────────────────────────────────────────
const COMMON_NAMES = [
  'Sheet1', 'Sheet2', 'Sheet3',
  'Raw Data', 'Data', 'Source Data', 'Input',
  'Pivot Table', 'Pivot Table 1', 'Pivot Table 2', 'Pivot1',
  'Summary', 'Monthly Summary', 'Weekly Summary',
  'Dashboard', 'Report', 'Overview', 'Analytics',
  'Sales', 'Revenue', 'Orders', 'Customers', 'Products',
  'Q1', 'Q2', 'Q3', 'Q4', 'Jan', 'Feb', 'Mar',
]

// ─── Core CSV fetcher via gviz/tq ─────────────────────────────────────────────
async function fetchCSV(
  spreadsheetId: string,
  gid?: string,
  sheetName?: string,
): Promise<string> {
  const params = new URLSearchParams({ tqx: 'out:csv' })
  if (gid) params.set('gid', gid)
  if (sheetName) params.set('sheet', sheetName)
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?${params}`
  const res = await fetch(url, { cache: 'no-cache' })
  if (!res.ok) {
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new Error('ACCESS_DENIED')
    throw new Error(`HTTP_${res.status}`)
  }
  const text = await res.text()
  if (text.trim().startsWith('{') && text.includes('"status":"error"')) throw new Error('ACCESS_DENIED')
  return text
}

// ─── CSV → typed rows ─────────────────────────────────────────────────────────
function parseCSV(csv: string): { data: Record<string, unknown>[]; columns: ColumnInfo[] } {
  const result = Papa.parse<Record<string, unknown>>(csv, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
  })
  const data = result.data.filter(row =>
    Object.values(row).some(v => v !== null && v !== '' && v !== undefined)
  )
  return { data, columns: inferColumns(data) }
}

// ─── Atom feed: works for "Published to web" sheets ──────────────────────────
async function tryAtomFeed(spreadsheetId: string): Promise<string[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const url = `https://spreadsheets.google.com/feeds/worksheets/${spreadsheetId}/public/full?alt=json`
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return []
    const json = await res.json()
    const entries = (json.feed?.entry ?? []) as Array<{ title: { $t: string } }>
    return entries.map(e => e.title.$t)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

// ─── Safely fetch one sheet by name, returning null on failure ────────────────
async function trySingleSheet(
  spreadsheetId: string,
  name: string,
): Promise<SubSheetData | null> {
  try {
    const csv = await fetchCSV(spreadsheetId, undefined, name)
    const { data, columns } = parseCSV(csv)
    if (data.length === 0) return null
    return { name, kind: detectKind(name), data, columns }
  } catch {
    return null
  }
}

// ─── Main connect ─────────────────────────────────────────────────────────────
export async function connectGoogleSheet(url: string): Promise<DataSource> {
  const spreadsheetId = extractSpreadsheetId(url)
  if (!spreadsheetId) {
    throw new Error('Invalid Google Sheets URL. Copy the full URL from your browser address bar.')
  }

  const gid = extractGid(url)

  let csv: string
  try {
    csv = await fetchCSV(spreadsheetId, gid ?? undefined)
  } catch (err) {
    if (err instanceof Error && err.message === 'ACCESS_DENIED') {
      throw new Error(
        'Access denied. In Google Sheets: Share → General access → "Anyone with the link" (Viewer).'
      )
    }
    throw new Error(
      'Could not reach this sheet. Check your internet connection and that the sheet is publicly shared.'
    )
  }

  const primary = parseCSV(csv)
  if (primary.data.length === 0) {
    throw new Error('The sheet appears to be empty or the data could not be read.')
  }

  return {
    id: `gs_${Date.now()}`,
    name: `Spreadsheet (${spreadsheetId.slice(0, 10)}…)`,
    type: 'google_sheets',
    url,
    data: primary.data,
    columns: primary.columns,
    sheets: [{ name: 'Sheet 1', rowCount: primary.data.length, kind: 'data' }],
    activeSheet: 'Sheet 1',
    lastSync: new Date().toISOString(),
    subSheets: [],
  }
}

// ─── Discover all sub-sheets ──────────────────────────────────────────────────
// Strategy 1: Atom feed (published sheets). Strategy 2: probe common names.
export async function discoverSubSheets(
  spreadsheetId: string,
  primaryFingerprint: string, // JSON.stringify of first data row — used to skip duplicates
): Promise<SubSheetData[]> {
  // Strategy 1: Atom feed
  const atomNames = await tryAtomFeed(spreadsheetId)

  let namesToFetch: string[]
  if (atomNames.length > 0) {
    namesToFetch = atomNames.slice(0, 10)
  } else {
    namesToFetch = COMMON_NAMES
  }

  // Fetch all in parallel
  const results = await Promise.allSettled(
    namesToFetch.map(name => trySingleSheet(spreadsheetId, name))
  )

  const seen = new Set<string>()
  seen.add(primaryFingerprint)

  const discovered: SubSheetData[] = []
  results.forEach(res => {
    if (res.status === 'fulfilled' && res.value) {
      const sheet = res.value
      const fp = JSON.stringify(sheet.data[0])
      if (!seen.has(fp)) {
        seen.add(fp)
        discovered.push(sheet)
      }
    }
  })

  return discovered
}

// ─── Manually add a sheet by name ────────────────────────────────────────────
export async function fetchSheetByName(
  spreadsheetId: string,
  sheetName: string,
): Promise<SubSheetData | null> {
  return trySingleSheet(spreadsheetId, sheetName)
}

// ─── Import embedded charts from Google Sheets (requires VITE_GOOGLE_API_KEY) ─
const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY

interface ParsedSheetChart {
  title: string
  type: ChartType
  xColumnIndex: number
  yColumnIndices: number[]
}

async function fetchEmbeddedChartConfigs(spreadsheetId: string, apiKey?: string): Promise<ParsedSheetChart[]> {
  const key = apiKey || GOOGLE_API_KEY
  if (!key) return []

  type SheetsApiResponse = {
    sheets?: Array<{
      charts?: Array<{
        spec?: {
          title?: string
          basicChart?: {
            chartType?: string
            domains?: Array<{ domain?: { sourceRange?: { sources?: Array<{ startColumnIndex?: number }> } } }>
            series?: Array<{ series?: { sourceRange?: { sources?: Array<{ startColumnIndex?: number }> } } }>
          }
          pieChart?: {
            domain?: { sourceRange?: { sources?: Array<{ startColumnIndex?: number }> } }
            series?: { sourceRange?: { sources?: Array<{ startColumnIndex?: number }> } }
          }
        }
      }>
    }>
  }

  try {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.charts&key=${key}`,
      { cache: 'no-cache' },
    )
    if (!res.ok) return []
    const json = (await res.json()) as SheetsApiResponse

    const TYPE_MAP: Record<string, ChartType> = {
      BAR: 'bar', COLUMN: 'bar', LINE: 'line',
      AREA: 'area', PIE: 'pie', SCATTER: 'bar',
    }

    const results: ParsedSheetChart[] = []
    for (const sheet of json.sheets ?? []) {
      for (const chart of sheet.charts ?? []) {
        const spec = chart.spec
        if (!spec) continue
        const title = spec.title ?? 'Imported Chart'

        if (spec.basicChart) {
          const bc = spec.basicChart
          const type = TYPE_MAP[bc.chartType ?? ''] ?? 'bar'
          const xIdx = bc.domains?.[0]?.domain?.sourceRange?.sources?.[0]?.startColumnIndex ?? 0
          const yIdxs = (bc.series ?? [])
            .map(s => s.series?.sourceRange?.sources?.[0]?.startColumnIndex)
            .filter((n): n is number => n !== undefined)
          if (yIdxs.length > 0) results.push({ title, type, xColumnIndex: xIdx, yColumnIndices: yIdxs })
        }

        if (spec.pieChart) {
          const pc = spec.pieChart
          const xIdx = pc.domain?.sourceRange?.sources?.[0]?.startColumnIndex ?? 0
          const yIdx = pc.series?.sourceRange?.sources?.[0]?.startColumnIndex
          if (yIdx !== undefined) results.push({ title, type: 'pie', xColumnIndex: xIdx, yColumnIndices: [yIdx] })
        }
      }
    }
    return results
  } catch {
    return []
  }
}

export async function importChartsFromSheet(
  spreadsheetId: string,
  columns: ColumnInfo[],
  apiKey?: string,
): Promise<ChartConfig[]> {
  const parsed = await fetchEmbeddedChartConfigs(spreadsheetId, apiKey)
  return parsed
    .map((c, i) => ({
      id: `imported_${Date.now()}_${i}`,
      type: c.type,
      title: c.title,
      xAxis: columns[c.xColumnIndex]?.name ?? columns[0]?.name ?? '',
      yAxes: c.yColumnIndices
        .map(idx => columns[idx]?.name)
        .filter((n): n is string => Boolean(n)),
    }))
    .filter(c => c.yAxes.length > 0)
}

// ─── Sync (re-fetch primary data) ────────────────────────────────────────────
export async function syncGoogleSheet(ds: DataSource): Promise<DataSource> {
  if (!ds.url) return ds
  const spreadsheetId = extractSpreadsheetId(ds.url)
  if (!spreadsheetId) return ds
  const gid = extractGid(ds.url)
  const csv = await fetchCSV(spreadsheetId, gid ?? undefined)
  const { data, columns } = parseCSV(csv)
  return { ...ds, data, columns, lastSync: new Date().toISOString() }
}
