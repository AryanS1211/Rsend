import { useState, useRef, useCallback, useEffect, type DragEvent, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import {
  Database, FileText, Link, RefreshCw, Trash2, Upload,
  CheckCircle, AlertCircle, X, BarChart2, Info,
  Search, Plus, TableProperties, Camera, Image,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import {
  connectGoogleSheet, syncGoogleSheet,
  discoverSubSheets, fetchSheetByName, extractSpreadsheetId,
} from '../utils/googleSheets'
import { inferColumns } from '../utils/demoData'
import { detectKind } from '../utils/googleSheets'
import type { DataSource, SubSheetData, CapturedVisual } from '../types'
import ChartCaptureModal, { captureFrameFromStream } from '../components/ChartCaptureModal'

// ─── Toast ─────────────────────────────────────────────────────────────────────
interface ToastMsg { id: number; kind: 'success' | 'error'; text: string }
function useToast() {
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  function show(text: string, kind: 'success' | 'error' = 'success') {
    const id = Date.now()
    setToasts(prev => [...prev, { id, kind, text }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4500)
  }
  return { toasts, show }
}
function ToastContainer({ toasts }: { toasts: ToastMsg[] }) {
  return (
    <div className="fixed top-5 right-5 z-50 space-y-2 max-w-sm">
      {toasts.map(t => (
        <div key={t.id} className={`flex items-start gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${t.kind === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {t.kind === 'success' ? <CheckCircle size={15} className="mt-0.5 shrink-0" /> : <AlertCircle size={15} className="mt-0.5 shrink-0" />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}

const kindColors: Record<string, string> = {
  data: 'bg-blue-50 text-blue-700',
  summary: 'bg-amber-50 text-amber-700',
  report: 'bg-purple-50 text-purple-700',
  dashboard: 'bg-emerald-50 text-emerald-700',
}


// ─── SheetViewer ──────────────────────────────────────────────────────────────
interface SheetViewerProps {
  ds: DataSource
  onUpdate: (updated: DataSource) => void
  onRemove: () => void
  onSync?: () => void
  syncing?: boolean
  show: (text: string, kind?: 'success' | 'error') => void
  onGoToReports: () => void
  captures: CapturedVisual[]
  onCapture: (visual: CapturedVisual) => void
  onDeleteCapture: (id: string) => void
}

function SheetViewer({
  ds, onUpdate, onRemove, onSync, syncing,
  show, onGoToReports, captures, onCapture, onDeleteCapture,
}: SheetViewerProps) {
  const [captureScreenshot, setCaptureScreenshot] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)

  async function handleOpenCapture() {
    if (ds.url) window.open(ds.url, '_blank')
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      // Capture the frame immediately — before any tab switch can black out the stream
      setCapturing(true)
      const url = await captureFrameFromStream(stream)
      setCaptureScreenshot(url)
    } catch (e) {
      if ((e as Error).name !== 'NotAllowedError') {
        show('Screen capture failed. Please use Chrome, Edge, or Firefox.', 'error')
      }
    } finally {
      setCapturing(false)
    }
  }
  const spreadsheetId = ds.type === 'google_sheets'
    ? (extractSpreadsheetId(ds.url ?? '') ?? '')
    : ''
  const [discovering, setDiscovering] = useState(false)
  const [activeTab, setActiveTab] = useState<string>('primary')
  const [addingName, setAddingName] = useState('')
  const [addingLoading, setAddingLoading] = useState(false)
  const [showAddSheet, setShowAddSheet] = useState(false)

  const subSheets = ds.subSheets ?? []

  // Auto-run on mount for GS sources: discover sub-sheets
  useEffect(() => {
    if (ds.type !== 'google_sheets' || !spreadsheetId) return
    initGS()
  }, [])

  async function initGS() {
    if (subSheets.length > 0) return
    setDiscovering(true)
    try {
      const primaryFp = JSON.stringify(ds.data[0])
      const found = await discoverSubSheets(spreadsheetId, primaryFp)
      if (found.length > 0) {
        onUpdate({ ...ds, subSheets: found })
        show(`Found ${found.length} sheet${found.length > 1 ? 's' : ''}: ${found.map(s => s.name).join(', ')}`)
      }
    } catch { /* ignore discovery failure */ } finally {
      setDiscovering(false)
    }
  }

  async function handleDiscover() {
    if (!spreadsheetId) return
    setDiscovering(true)
    try {
      const primaryFp = JSON.stringify(ds.data[0])
      const found = await discoverSubSheets(spreadsheetId, primaryFp)
      if (found.length > 0) {
        onUpdate({ ...ds, subSheets: found })
        show(`Found ${found.length} additional sheet${found.length > 1 ? 's' : ''}: ${found.map(s => s.name).join(', ')}`)
      } else {
        show('No additional sheets found. Try adding a sheet name manually.')
      }
    } catch {
      show('Sheet discovery failed.', 'error')
    } finally {
      setDiscovering(false)
    }
  }

  async function handleAddByName() {
    const name = addingName.trim()
    if (!name || !spreadsheetId) return
    if (subSheets.some(s => s.name.toLowerCase() === name.toLowerCase())) {
      show(`Sheet "${name}" is already added.`, 'error'); return
    }
    setAddingLoading(true)
    const result = await fetchSheetByName(spreadsheetId, name)
    setAddingLoading(false)
    if (!result) {
      show(`Sheet "${name}" not found or is empty. Check the exact tab name.`, 'error'); return
    }
    onUpdate({ ...ds, subSheets: [...subSheets, result] })
    setAddingName('')
    setShowAddSheet(false)
    setActiveTab(name)
    show(`Sheet "${name}" added — ${result.data.length} rows.`)
  }

  // Resolve active content
  const activeSubSheet = activeTab !== 'primary'
    ? subSheets.find(s => s.name === activeTab) ?? null
    : null
  const previewSheet = activeTab === 'primary'
    ? { name: 'Primary Sheet', data: ds.data, columns: ds.columns }
    : activeSubSheet
      ? { name: activeSubSheet.name, data: activeSubSheet.data, columns: activeSubSheet.columns }
      : null

  const isGS = ds.type === 'google_sheets'

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80">
      {/* Header */}
      <div className="flex items-start justify-between p-5 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${isGS ? 'bg-emerald-50' : 'bg-blue-50'}`}>
            <span className={`text-xs font-bold ${isGS ? 'text-emerald-600' : 'text-blue-600'}`}>
              {isGS ? 'GS' : 'XL'}
            </span>
          </div>
          <div>
            <p className="font-semibold text-slate-800 text-sm">{ds.name}</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {ds.data.length} rows · {ds.columns.length} cols
              {ds.lastSync ? ` · Synced ${new Date(ds.lastSync).toLocaleTimeString()}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isGS && onSync && (
            <button
              onClick={onSync}
              disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-60 rounded-lg transition-colors"
            >
              <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing…' : 'Sync'}
            </button>
          )}
          <button
            onClick={onRemove}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-500 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
          >
            <Trash2 size={12} /> Remove
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-0 flex-wrap border-b border-slate-100">
        {/* Primary */}
        <button
          onClick={() => setActiveTab('primary')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'primary'
              ? 'border-indigo-500 text-indigo-700 bg-indigo-50/60'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Database size={11} />
          {isGS ? 'Primary Sheet' : ds.sheets[0]?.name ?? 'Sheet 1'}
          <span className="text-slate-400">({ds.data.length}r)</span>
        </button>

        {/* Sub-sheet tabs */}
        {subSheets.map(s => (
          <button
            key={s.name}
            onClick={() => setActiveTab(s.name)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs font-medium border-b-2 -mb-px transition-colors ${
              activeTab === s.name
                ? 'border-indigo-500 text-indigo-700 bg-indigo-50/60'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {s.kind === 'report' || s.name.toLowerCase().includes('pivot') ? (
              <TableProperties size={11} />
            ) : (
              <Database size={11} />
            )}
            {s.name}
            <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${kindColors[s.kind]}`}>
              {s.kind}
            </span>
            {s.data.length > 0 && <span className="text-slate-400">({s.data.length}r)</span>}
          </button>
        ))}

        {/* Add sheet button (GS only) */}
        {isGS && !showAddSheet && (
          <button
            onClick={() => setShowAddSheet(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
          >
            <Plus size={11} /> Add sheet
          </button>
        )}
      </div>

      {/* Add sheet input */}
      {showAddSheet && (
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-100">
          <input
            value={addingName}
            onChange={e => setAddingName(e.target.value)}
            placeholder="Sheet tab name (e.g. Pivot Table 1)"
            className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            onKeyDown={e => e.key === 'Enter' && handleAddByName()}
            autoFocus
          />
          <button
            onClick={handleAddByName}
            disabled={addingLoading || !addingName.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg"
          >
            {addingLoading ? <RefreshCw size={11} className="animate-spin" /> : <Plus size={11} />}
            {addingLoading ? 'Fetching…' : 'Add'}
          </button>
          <button onClick={() => { setShowAddSheet(false); setAddingName('') }} className="p-1.5 text-slate-400 hover:text-slate-600">
            <X size={13} />
          </button>
        </div>
      )}

      {/* Discovering banner */}
      {discovering && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-indigo-50 border-b border-indigo-100">
          <RefreshCw size={13} className="animate-spin text-indigo-500" />
          <p className="text-xs text-indigo-600">Discovering sub-sheets automatically…</p>
        </div>
      )}

      {/* Empty sub-sheet notice */}
      {previewSheet && previewSheet.data.length === 0 && activeTab !== 'primary' && (
        <div className="px-5 py-8 text-center">
          <TableProperties size={28} className="mx-auto mb-2 text-slate-300" />
          <p className="text-sm font-medium text-slate-500">No readable rows in "{previewSheet.name}"</p>
          <p className="text-xs text-slate-400 mt-1">
            This sheet may contain a pivot table or embedded chart with special formatting.<br />
            Try re-saving the file as a plain XLSX from Excel/WPS and re-uploading.
          </p>
        </div>
      )}

      {/* Data table */}
      {previewSheet && previewSheet.data.length > 0 && (
        <div className="overflow-x-auto">
          <div className="px-4 py-2 bg-slate-50 flex items-center justify-between border-b border-slate-100">
            <p className="text-xs text-slate-500 font-medium">
              Preview — {previewSheet.name} ({previewSheet.data.length} rows)
            </p>
            <span className="text-xs text-slate-400">
              {previewSheet.columns.filter(c => c.type === 'number').length} numeric columns
            </span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100">
                {previewSheet.columns.map(col => (
                  <th key={col.name} className="px-3 py-2 text-left text-slate-500 font-semibold whitespace-nowrap bg-white">
                    {col.name}
                    <span className={`ml-1.5 px-1 py-0.5 rounded text-xs ${
                      col.type === 'number' ? 'bg-blue-50 text-blue-500' :
                      col.type === 'date' ? 'bg-purple-50 text-purple-500' :
                      'bg-slate-100 text-slate-400'
                    }`}>{col.type}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewSheet.data.slice(0, 8).map((row, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                  {previewSheet.columns.map(col => (
                    <td key={col.name} className="px-3 py-1.5 text-slate-600 whitespace-nowrap">
                      {String(row[col.name] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {previewSheet.data.length > 8 && (
            <p className="text-xs text-slate-400 text-center py-1.5 border-t border-slate-50">
              +{previewSheet.data.length - 8} more rows
            </p>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-2 p-4 border-t border-slate-100">
        {isGS && (
          <button
            onClick={handleDiscover}
            disabled={discovering}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 rounded-lg transition-colors"
          >
            <Search size={13} />
            {discovering ? 'Discovering…' : 'Rediscover sheets'}
          </button>
        )}
        <button
          onClick={handleOpenCapture}
          disabled={capturing}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 disabled:opacity-60 rounded-lg transition-colors"
        >
          <Camera size={13} /> {capturing ? 'Capturing…' : 'Open & Capture Chart'}
        </button>
        <button
          onClick={onGoToReports}
          className="flex items-center gap-2 flex-1 justify-center py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          <BarChart2 size={14} />
          Auto-generate All Visualizations →
        </button>
      </div>

      {/* Captured visuals gallery */}
      {captures.length > 0 && (
        <div className="border-t border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <Image size={13} className="text-purple-500" />
            <span className="text-xs font-semibold text-slate-600">Captured Visuals</span>
            <span className="ml-auto text-xs text-slate-400">{captures.length} saved</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {captures.map(v => (
              <div key={v.id} className="group relative rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                <img src={v.imageDataUrl} alt={v.name} className="w-full h-24 object-cover" />
                <div className="px-2 py-1.5 flex items-center justify-between gap-1">
                  <span className="text-xs text-slate-600 font-medium truncate">{v.name}</span>
                  <button
                    onClick={() => onDeleteCapture(v.id)}
                    className="shrink-0 text-slate-300 hover:text-red-500 transition-colors"
                    title="Delete"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {captureScreenshot && (
        <ChartCaptureModal
          dataSourceId={ds.id}
          dataSourceName={ds.name}
          initialScreenshotUrl={captureScreenshot}
          onSave={v => { onCapture(v); show(`"${v.name}" saved!`) }}
          onClose={() => setCaptureScreenshot(null)}
        />
      )}
    </div>
  )
}


// ─── XLSX parser ──────────────────────────────────────────────────────────────
// Reads sheet rows using the raw cell matrix so we can detect and handle
// pivot-table double-headers correctly.
function readSheetRows(ws: XLSX.WorkSheet): Record<string, unknown>[] {
  if (!ws) return []
  if ((ws as Record<string, unknown>)['!type'] === 'chart') return []

  // Always use raw 2D array so we have full control over header detection
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: '',
    raw: false,   // formatted strings — reads pivot-cached values reliably
  }) as unknown[][]

  // Drop fully-empty rows
  const rows = matrix.filter(row => (row as unknown[]).some(c => c !== '' && c !== null && c !== undefined))
  if (rows.length < 2) return []

  // Detect pivot-table double-header:
  // Row 0 often has merged cells → many blanks, e.g. ["COUNTA of order_id","store","","",…]
  // Row 1 is the real column header,          e.g. ["end_state_date","1MG_BNS","1MG_CCB",…]
  // Row 2+ are the numeric data rows.
  const row0 = rows[0] as unknown[]
  const row1 = rows[1] as unknown[]
  const blankRatio = row0.filter(c => c === '' || c === null).length / Math.max(row0.length, 1)
  const row1AllStrings = row1.every(c => c === '' || (typeof c === 'string' && isNaN(Number(c))))
  const row2HasNumbers = rows.length > 2 &&
    (rows[2] as unknown[]).some(c => c !== '' && c !== null && !isNaN(Number(c)))

  // If row 0 is mostly blank (merged pivot header) and row 1 looks like real column names
  // and row 2 has numeric data → skip row 0, use row 1 as header
  const headerIdx = (blankRatio > 0.35 && row1AllStrings && row2HasNumbers) ? 1 : 0

  const headerRow = rows[headerIdx] as unknown[]
  const headers = headerRow.map((h, i) => {
    const s = String(h ?? '').trim()
    return s || `Col${i + 1}`
  })

  return rows.slice(headerIdx + 1)
    .map(row => Object.fromEntries(headers.map((h, i) => [h, (row as unknown[])[i] ?? ''])))
    .filter(row => Object.values(row).some(v => v !== '' && v !== null))
}

async function parseXLSXFile(file: File): Promise<DataSource> {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' })
  const sheetNames = wb.SheetNames
  if (sheetNames.length === 0) throw new Error('No sheets found.')

  const primaryRows = readSheetRows(wb.Sheets[sheetNames[0]])
  if (primaryRows.length === 0) throw new Error('The first sheet appears to be empty.')

  const subSheets: SubSheetData[] = sheetNames.slice(1)
    .map(name => {
      const ws = wb.Sheets[name]
      if (!ws) return null
      if ((ws as Record<string, unknown>)['!type'] === 'chart') return null
      const rows = readSheetRows(ws)
      return { name, kind: detectKind(name), data: rows, columns: inferColumns(rows) }
    })
    .filter((s): s is SubSheetData => s !== null)

  const primaryColumns = inferColumns(primaryRows)

  return {
    id: `xl_${Date.now()}`,
    name: file.name.replace(/\.xlsx?$/i, ''),
    type: 'excel',
    data: primaryRows,
    columns: primaryColumns,
    sheets: sheetNames.map((n, i) => ({
      name: n,
      rowCount: i === 0 ? primaryRows.length : (subSheets.find(s => s.name === n)?.data.length ?? 0),
      kind: detectKind(n),
    })),
    activeSheet: sheetNames[0],
    lastSync: new Date().toISOString(),
    subSheets,
  }
}
// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function DataImport() {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()
  const { toasts, show } = useToast()
  const [tab, setTab] = useState<'sheets' | 'files'>('sheets')
  const [gsUrl, setGsUrl] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // ── Google Sheets Connect ──────────────────────────────────────────────────

  async function handleConnect() {
    const url = gsUrl.trim()
    if (!url) { show('Please enter a Google Sheets URL.', 'error'); return }
    if (!url.includes('docs.google.com/spreadsheets')) {
      show('That doesn\'t look like a Google Sheets URL.', 'error'); return
    }
    setConnecting(true)
    try {
      const ds = await connectGoogleSheet(url)
      dispatch({ type: 'ADD_DATA_SOURCE', payload: ds })
      setGsUrl('')
      show(`Connected! ${ds.data.length} rows loaded. Discovering sub-sheets…`)
    } catch (err) {
      show(err instanceof Error ? err.message : 'Connection failed.', 'error')
    } finally {
      setConnecting(false)
    }
  }

  function handleUpdateDs(updated: DataSource) {
    dispatch({ type: 'UPDATE_DATA_SOURCE', payload: updated })
  }

  async function handleSync(ds: DataSource) {
    setSyncing(ds.id)
    try {
      const updated = await syncGoogleSheet(ds)
      dispatch({ type: 'UPDATE_DATA_SOURCE', payload: updated })
      show(`Synced! ${updated.data.length} rows refreshed.`)
    } catch {
      show('Sync failed. Check the sheet is still publicly accessible.', 'error')
    } finally {
      setSyncing(null)
    }
  }

  function handleRemove(id: string) {
    dispatch({ type: 'REMOVE_DATA_SOURCE', payload: id })
    show('Data source removed.')
  }

  function handleCapture(visual: CapturedVisual) {
    dispatch({ type: 'ADD_CAPTURED_VISUAL', payload: visual })
  }

  function handleDeleteCapture(id: string) {
    dispatch({ type: 'REMOVE_CAPTURED_VISUAL', payload: id })
  }

  function goToReports(dsId: string) {
    dispatch({ type: 'SET_ACTIVE_DATA_SOURCE', payload: dsId })
    navigate('/reports', { state: { autoGenerate: true, dsId } })
  }

  // ── File Upload (CSV + XLSX) ────────────────────────────────────────────────
  async function parseFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase()

    if (ext === 'xlsx' || ext === 'xls') {
      try {
        const ds = await parseXLSXFile(file)
        dispatch({ type: 'ADD_DATA_SOURCE', payload: ds })

        const sheetsMsg = ds.subSheets && ds.subSheets.length > 0
          ? ` · ${ds.subSheets.length + 1} sheets`
          : ''
        const chartsMsg = ds.charts && ds.charts.length > 0
          ? ` · ${ds.charts.length} chart${ds.charts.length > 1 ? 's' : ''} detected`
          : ' · no charts found'
        show(`"${ds.name}" imported — ${ds.data.length} rows${sheetsMsg}${chartsMsg}`)
      } catch (err) {
        show(err instanceof Error ? err.message : 'Failed to parse Excel file.', 'error')
      }
      return
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (result) => {
        const data = result.data as Record<string, unknown>[]
        if (data.length === 0) { show('File appears to be empty.', 'error'); return }
        const ds: DataSource = {
          id: `csv_${Date.now()}`,
          name: file.name.replace(/\.csv$/i, ''),
          type: 'csv',
          data,
          columns: inferColumns(data),
          sheets: [{ name: 'Sheet1', rowCount: data.length, kind: 'data' }],
          activeSheet: 'Sheet1',
          lastSync: new Date().toISOString(),
        }
        dispatch({ type: 'ADD_DATA_SOURCE', payload: ds })
        show(`"${ds.name}" imported — ${data.length} rows, ${ds.columns.length} columns.`)
      },
      error: () => show('Failed to parse CSV file.', 'error'),
    })
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) parseFile(file)
    e.target.value = ''
  }

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file && /\.(csv|xlsx|xls)$/i.test(file.name)) parseFile(file)
    else show('Please drop a CSV or Excel file.', 'error')
  }, [])

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setIsDragging(true)
  }, [])
  const handleDragLeave = useCallback(() => setIsDragging(false), [])

  const gsSources = state.dataSources.filter(d => d.type === 'google_sheets')
  const fileSources = state.dataSources.filter(d => d.type === 'csv' || d.type === 'excel')

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <ToastContainer toasts={toasts} />

      {/* Header */}
      <div className="flex items-start justify-between mb-8 pb-6 border-b border-slate-200/70">
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Workspace</p>
          <h1 className="text-2xl font-bold text-slate-800">Data Sources</h1>
          <p className="text-slate-500 text-sm mt-1">
            Connect a Google Sheet or upload CSV / Excel. All sheets and charts appear as tabs.
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-xl border border-slate-200/80 shadow-sm text-sm text-slate-500 mt-1">
          <Database size={14} className="text-indigo-400" />
          <span className="font-medium">{state.dataSources.length}</span>
          <span className="text-slate-400">source{state.dataSources.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Page tabs */}
      <div className="flex gap-1.5 mb-6 p-1 bg-white rounded-xl border border-slate-200/80 shadow-sm w-fit">
        {(['sheets', 'files'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              tab === t ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            {t === 'sheets' ? <Link size={13} /> : <FileText size={13} />}
            {t === 'sheets' ? 'Google Sheets' : 'CSV / Excel'}
          </button>
        ))}
      </div>

      {/* ── Google Sheets Tab ── */}
      {tab === 'sheets' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Connect a Google Sheet</h2>
            <div className="flex gap-2">
              <input
                type="url"
                value={gsUrl}
                onChange={e => setGsUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                className="flex-1 px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 transition"
                onKeyDown={e => e.key === 'Enter' && handleConnect()}
                disabled={connecting}
              />
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-70 text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap"
              >
                {connecting ? <RefreshCw size={14} className="animate-spin" /> : <Link size={14} />}
                {connecting ? 'Fetching…' : 'Connect'}
              </button>
            </div>
            <div className="flex items-start gap-2 mt-3 p-3 bg-amber-50 rounded-lg border border-amber-100">
              <Info size={13} className="text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700">
                Sheet must be <span className="font-semibold">shared publicly</span>. In Google Sheets: Share → General access → <span className="font-semibold">"Anyone with the link"</span>. All sub-sheets appear as tabs automatically.
              </p>
            </div>

          </div>

          {gsSources.map(ds => (
            <SheetViewer
              key={ds.id}
              ds={ds}
              onUpdate={handleUpdateDs}
              onRemove={() => handleRemove(ds.id)}
              onSync={() => handleSync(ds)}
              syncing={syncing === ds.id}
              show={show}
              onGoToReports={() => goToReports(ds.id)}
              captures={state.capturedVisuals.filter(v => v.dataSourceId === ds.id)}
              onCapture={handleCapture}
              onDeleteCapture={handleDeleteCapture}
            />
          ))}

          {gsSources.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              <Link size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">No Google Sheets connected yet.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Files Tab ── */}
      {tab === 'files' && (
        <div className="space-y-4">
          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all ${
              isDragging ? 'border-indigo-400 bg-indigo-50/80' : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/20'
            }`}
          >
            <Upload size={36} className={`mx-auto mb-3 ${isDragging ? 'text-indigo-500' : 'text-slate-300'}`} />
            <p className="text-sm font-medium text-slate-600">
              {isDragging ? 'Drop your file here' : 'Drag & drop a CSV or Excel file'}
            </p>
            <p className="text-xs text-slate-400 mt-1">.csv · .xlsx · .xls — Excel files show all sheets as tabs</p>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileChange} />
          </div>

          {/* Excel files with SheetViewer */}
          {fileSources.filter(d => d.type === 'excel').map(ds => (
            <SheetViewer
              key={ds.id}
              ds={ds}
              onUpdate={handleUpdateDs}
              onRemove={() => handleRemove(ds.id)}
              show={show}
              onGoToReports={() => goToReports(ds.id)}
              captures={state.capturedVisuals.filter(v => v.dataSourceId === ds.id)}
              onCapture={handleCapture}
              onDeleteCapture={handleDeleteCapture}
            />
          ))}

          {/* Plain CSV files */}
          {fileSources.filter(d => d.type === 'csv').map(ds => (
            <div key={ds.id} className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-md bg-blue-50 flex items-center justify-center">
                    <FileText size={16} className="text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">{ds.name}</p>
                    <p className="text-xs text-slate-400">{ds.data.length} rows · {ds.columns.length} columns</p>
                  </div>
                </div>
                <button onClick={() => handleRemove(ds.id)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                  <X size={15} />
                </button>
              </div>
              <button
                onClick={() => goToReports(ds.id)}
                className="flex items-center gap-2 w-full justify-center py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                <BarChart2 size={14} /> Auto-generate All Visualizations →
              </button>
            </div>
          ))}

          {fileSources.length === 0 && (
            <div className="text-center py-8 text-slate-400">
              <FileText size={28} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No files uploaded yet.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
