import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import {
  DragDropContext, Droppable, Draggable, type DropResult,
} from '@hello-pangea/dnd'
import {
  BarChart2, GripVertical, Trash2, Wand2, Pencil, Check,
  FileDown, FileSpreadsheet, Mail, ChevronDown, X, FileText, Sparkles, Send,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import ChartRenderer from '../components/charts/ChartRenderer'
import EmailModal from '../components/EmailModal'
import { exportCSV, exportXLSX, exportPDF } from '../utils/exportUtils'
import type { ChartConfig, ChartType, ColumnInfo } from '../types'

// ─── Auto-generate charts from data columns ─────────────────────────────────
function autoGenerateCharts(columns: ColumnInfo[]): ChartConfig[] {
  const dateCols = columns.filter(c => c.type === 'date')
  const strCols = columns.filter(c => c.type === 'string')
  const numCols = columns.filter(c => c.type === 'number')
  const charts: ChartConfig[] = []
  const t = Date.now()

  if (numCols.length === 0) {
    return [{
      id: `auto_table_${t}`,
      type: 'table',
      title: 'Data Overview',
      xAxis: columns[0]?.name ?? '',
      yAxes: columns.map(c => c.name),
    }]
  }

  // 1. Trend over time (line chart with date axis)
  if (dateCols.length > 0) {
    charts.push({
      id: `auto_line_${t}`,
      type: 'line',
      title: `${numCols.slice(0, 2).map(c => c.name).join(' & ')} Trend Over Time`,
      xAxis: dateCols[0].name,
      yAxes: numCols.slice(0, 2).map(c => c.name),
    })
  }

  // 2. Category comparison (bar chart — first string col as axis)
  if (strCols.length > 0) {
    charts.push({
      id: `auto_bar_${t + 1}`,
      type: 'bar',
      title: `${numCols[0].name} by ${strCols[0].name}`,
      xAxis: strCols[0].name,
      yAxes: numCols.slice(0, 2).map(c => c.name),
    })
  }

  // 3. Distribution pie — second string col if available (e.g. Category vs Region)
  const pieX = strCols[1] ?? strCols[0]
  if (pieX) {
    charts.push({
      id: `auto_pie_${t + 2}`,
      type: 'pie',
      title: `${numCols[0].name} Share by ${pieX.name}`,
      xAxis: pieX.name,
      yAxes: [numCols[0].name],
    })
  }

  // 4. Area comparison (two numeric columns over same X)
  if (numCols.length >= 2) {
    const xCol = dateCols[0] ?? strCols[0]
    if (xCol) {
      charts.push({
        id: `auto_area_${t + 3}`,
        type: 'area',
        title: `${numCols[0].name} vs ${numCols[1].name}`,
        xAxis: xCol.name,
        yAxes: [numCols[0].name, numCols[1].name],
      })
    }
  }

  // 5. Heatmap — categorical rows × numeric intensity
  if (strCols.length >= 1 && numCols.length > 0) {
    charts.push({
      id: `auto_heat_${t + 4}`,
      type: 'heatmap',
      title: `${numCols[0].name} Heat Map by ${strCols[0].name}`,
      xAxis: strCols[0].name,
      yAxes: [numCols[0].name],
    })
  }

  // 6. Full data table
  charts.push({
    id: `auto_table_${t + 5}`,
    type: 'table',
    title: 'Full Data Table',
    xAxis: columns[0]?.name ?? '',
    yAxes: columns.map(c => c.name),
  })

  return charts
}

// ─── Prompt → single chart config ───────────────────────────────────────────
function parsePrompt(prompt: string, columns: ColumnInfo[]): ChartConfig {
  const p = prompt.toLowerCase()

  let type: ChartType = 'bar'
  if (/heat\s*map|heatmap/.test(p)) type = 'heatmap'
  else if (/pie|distribution|breakdown|share/.test(p)) type = 'pie'
  else if (/line|trend|over time|monthly|weekly|daily/.test(p)) type = 'line'
  else if (/area/.test(p)) type = 'area'
  else if (/table|list|all data|raw/.test(p)) type = 'table'

  const dateCols = columns.filter(c => c.type === 'date')
  const strCols  = columns.filter(c => c.type === 'string')
  const numCols  = columns.filter(c => c.type === 'number')

  // Match column names in prompt — also try with underscores replaced by spaces
  const mentionedCols = columns.filter(c =>
    p.includes(c.name.toLowerCase()) ||
    p.includes(c.name.toLowerCase().replace(/_/g, ' '))
  )

  // X-axis: column appearing after grouping keywords
  const xKeywords = ['for each ', 'group by ', 'per ', 'across ', ' by ', 'each ']
  let xCol: ColumnInfo | undefined
  for (const kw of xKeywords) {
    const idx = p.indexOf(kw)
    if (idx === -1) continue
    const after = p.slice(idx + kw.length).trim()
    xCol = columns.find(c =>
      after.startsWith(c.name.toLowerCase()) ||
      after.startsWith(c.name.toLowerCase().replace(/_/g, ' '))
    )
    if (xCol) break
  }

  // Y-axis: columns appearing after measurement keywords
  const yKeywords = ['count ', 'count of ', 'sum of ', 'sum ', 'total ', 'show ', 'plot ', 'of ']
  const yColsFromPrompt: ColumnInfo[] = []
  for (const kw of yKeywords) {
    let idx = 0
    while ((idx = p.indexOf(kw, idx)) !== -1) {
      const after = p.slice(idx + kw.length).trim()
      const found = columns.find(c =>
        after.startsWith(c.name.toLowerCase()) ||
        after.startsWith(c.name.toLowerCase().replace(/_/g, ' '))
      )
      if (found && found !== xCol && !yColsFromPrompt.includes(found)) {
        yColsFromPrompt.push(found)
      }
      idx += kw.length
    }
  }

  // Fallback: any mentioned column that isn't the x-axis
  if (yColsFromPrompt.length === 0) {
    mentionedCols.filter(c => c !== xCol).forEach(c => yColsFromPrompt.push(c))
  }

  // Resolve xAxis
  let xAxis: string
  if (type === 'line' && dateCols.length > 0) xAxis = dateCols[0].name
  else if (xCol) xAxis = xCol.name
  else {
    const mentionedStr = mentionedCols.find(c => c.type === 'string' || c.type === 'date')
    xAxis = mentionedStr?.name ?? strCols[0]?.name ?? dateCols[0]?.name ?? columns[0]?.name ?? ''
  }

  // Resolve yAxes
  let yAxes: string[]
  if (type === 'table') {
    yAxes = columns.map(c => c.name)
  } else if (type === 'heatmap') {
    yAxes = yColsFromPrompt.length > 0
      ? yColsFromPrompt.slice(0, 3).map(c => c.name)
      : numCols.slice(0, 3).map(c => c.name)
  } else {
    yAxes = yColsFromPrompt.length > 0
      ? yColsFromPrompt.slice(0, 2).map(c => c.name)
      : numCols.filter(c => c.name !== xAxis).slice(0, 2).map(c => c.name)
  }
  if (yAxes.length === 0) yAxes = numCols.slice(0, 2).map(c => c.name)

  const title = prompt.trim().charAt(0).toUpperCase() + prompt.trim().slice(1, 60)

  return {
    id: `chart_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    title,
    xAxis,
    yAxes,
  }
}

// ─── Toast ───────────────────────────────────────────────────────────────────
interface Toast { id: number; text: string; kind: 'success' | 'error' }
function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])
  function show(text: string, kind: 'success' | 'error' = 'success') {
    const id = Date.now()
    setToasts(prev => [...prev, { id, kind, text }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500)
  }
  return { toasts, show }
}

const CHART_TYPES: ChartType[] = ['bar', 'line', 'area', 'pie', 'heatmap', 'table']

const EXAMPLE_PROMPTS = [
  'Revenue trend by month',
  'Sales by category (bar)',
  'Regional breakdown pie chart',
  'Product performance table',
  'Heat map by product and region',
]

// ─── Chart Card ──────────────────────────────────────────────────────────────
interface ChartCardProps {
  chart: ChartConfig
  index: number
  data: Record<string, unknown>[]
  columns: ColumnInfo[]
  onDelete: (id: string) => void
  onUpdate: (updated: ChartConfig) => void
}

function ChartCard({ chart, index, data, columns, onDelete, onUpdate }: ChartCardProps) {
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(chart.title)
  const [editType, setEditType] = useState<ChartType>(chart.type)
  const [editX, setEditX] = useState(chart.xAxis ?? '')
  const [editYStr, setEditYStr] = useState(chart.yAxes.join(', '))

  function applyEdit() {
    const yAxes = editYStr.split(',').map(s => s.trim()).filter(Boolean)
    onUpdate({ ...chart, title: editTitle, type: editType, xAxis: editX, yAxes })
    setEditing(false)
  }

  const typeColors: Record<ChartType, string> = {
    bar: 'bg-indigo-50 text-indigo-600',
    line: 'bg-blue-50 text-blue-600',
    area: 'bg-sky-50 text-sky-600',
    pie: 'bg-purple-50 text-purple-600',
    heatmap: 'bg-amber-50 text-amber-600',
    table: 'bg-slate-100 text-slate-600',
  }

  return (
    <Draggable draggableId={chart.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={`bg-white rounded-2xl border transition-shadow ${
            snapshot.isDragging ? 'shadow-xl border-indigo-200' : 'shadow-sm border-slate-200/80'
          }`}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
            <span {...provided.dragHandleProps} className="cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing">
              <GripVertical size={16} />
            </span>
            <span className="flex-1 font-semibold text-slate-700 text-sm truncate">{chart.title}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeColors[chart.type]}`}>
              {chart.type}
            </span>
            <button
              onClick={() => setEditing(e => !e)}
              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={() => onDelete(chart.id)}
              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            >
              <Trash2 size={14} />
            </button>
          </div>

          {/* Inline Edit */}
          {editing && (
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex flex-wrap gap-2 items-end">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Title</label>
                <input
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="border border-slate-200 rounded px-2 py-1.5 text-xs text-slate-700 w-48 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Type</label>
                <select
                  value={editType}
                  onChange={e => setEditType(e.target.value as ChartType)}
                  className="border border-slate-200 rounded px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                >
                  {CHART_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">X Axis</label>
                <select
                  value={editX}
                  onChange={e => setEditX(e.target.value)}
                  className="border border-slate-200 rounded px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                >
                  {columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Y Axes (comma-sep)</label>
                <input
                  value={editYStr}
                  onChange={e => setEditYStr(e.target.value)}
                  className="border border-slate-200 rounded px-2 py-1.5 text-xs text-slate-700 w-44 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
              </div>
              <button
                onClick={applyEdit}
                className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700 transition-colors"
              >
                <Check size={12} /> Apply
              </button>
              <button onClick={() => setEditing(false)} className="p-1.5 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            </div>
          )}

          {/* Chart */}
          <div className="p-4">
            <ChartRenderer
              type={chart.type}
              data={data}
              xAxis={chart.xAxis ?? ''}
              yAxes={chart.yAxes}
              height={280}
            />
          </div>
        </div>
      )}
    </Draggable>
  )
}

function PlaneSVG() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" className="text-white">
      <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ReportGeneration() {
  const { state, dispatch } = useApp()
  const location = useLocation()
  const { toasts, show } = useToast()

  const navState = location.state as { autoGenerate?: boolean; dsId?: string } | null

  const [selectedDsId, setSelectedDsId] = useState<string>(
    navState?.dsId ?? state.activeDataSourceId ?? state.dataSources[0]?.id ?? ''
  )
  const [selectedSubSheet, setSelectedSubSheet] = useState<string>('primary')
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [autoRunning, setAutoRunning] = useState(false)
  const [activeCharts, setActiveCharts] = useState<ChartConfig[]>([])
  const [reportName, setReportName] = useState('My Report')
  const [loadedReportId, setLoadedReportId] = useState<string | null>(null)
  const [showEmailModal, setShowEmailModal] = useState(false)

  const ds = state.dataSources.find(d => d.id === selectedDsId) ?? null

  // Resolve the active data/columns based on selected sub-sheet
  const activeData = (() => {
    if (!ds) return []
    if (selectedSubSheet === 'primary') return ds.data
    const sub = ds.subSheets?.find(s => s.name === selectedSubSheet)
    return sub?.data ?? ds.data
  })()
  const activeColumns = (() => {
    if (!ds) return []
    if (selectedSubSheet === 'primary') return ds.columns
    const sub = ds.subSheets?.find(s => s.name === selectedSubSheet)
    return sub?.columns ?? ds.columns
  })()

  const lastReport = state.reports
    .filter(r => r.dataSourceId === selectedDsId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]

  useEffect(() => {
    if (!navState?.dsId) {
      setSelectedDsId(state.activeDataSourceId ?? state.dataSources[0]?.id ?? '')
    }
  }, [state.activeDataSourceId, state.dataSources])

  // Auto-generate on navigation from DataImport (runs once on mount)
  useEffect(() => {
    if (navState?.autoGenerate && navState.dsId) {
      const targetDs = state.dataSources.find(d => d.id === navState.dsId)
      if (targetDs && targetDs.columns.length > 0) {
        triggerAutoGenerate(targetDs.columns, targetDs.name)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reset sub-sheet selection when data source changes
  useEffect(() => { setSelectedSubSheet('primary') }, [selectedDsId])

  // When data source changes, load its saved report (or clear charts if none)
  useEffect(() => {
    if (navState?.autoGenerate) return
    const report = state.reports
      .filter(r => r.dataSourceId === selectedDsId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    if (report) {
      setActiveCharts(report.charts)
      setReportName(report.name)
      setLoadedReportId(report.id)
    } else {
      setActiveCharts([])
      setReportName('My Report')
      setLoadedReportId(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDsId])

  function triggerAutoGenerate(columns: ColumnInfo[], dsName: string) {
    setAutoRunning(true)
    const charts = autoGenerateCharts(columns)
    const name = `${dsName} — Full Report`
    setReportName(name)
    setActiveCharts(charts)
    const reportId = `report_${Date.now()}`
    dispatch({
      type: 'ADD_REPORT',
      payload: {
        id: reportId,
        name,
        charts,
        dataSourceId: selectedDsId || (navState?.dsId ?? ''),
        createdAt: new Date().toISOString(),
      },
    })
    setLoadedReportId(reportId)
    setAutoRunning(false)
    show(`Generated ${charts.length} visualizations from your data!`)
  }

  function handleAutoGenerate() {
    if (!ds) return
    const label = selectedSubSheet !== 'primary' ? `${ds.name} — ${selectedSubSheet}` : ds.name
    triggerAutoGenerate(activeColumns, label)
  }

  async function handleGenerate() {
    if (!ds || !prompt.trim()) return
    setGenerating(true)
    await new Promise(r => setTimeout(r, 500))
    const config = parsePrompt(prompt, activeColumns)
    const newCharts = [...activeCharts, config]
    setActiveCharts(newCharts)

    const reportId = loadedReportId ?? `report_${Date.now()}`
    const report = {
      id: reportId,
      name: reportName,
      prompt,
      charts: newCharts,
      dataSourceId: selectedDsId,
      createdAt: new Date().toISOString(),
    }
    if (loadedReportId) {
      dispatch({ type: 'UPDATE_REPORT', payload: report })
    } else {
      dispatch({ type: 'ADD_REPORT', payload: report })
      setLoadedReportId(reportId)
    }
    setPrompt('')
    setGenerating(false)
    show('Chart added to report!')
  }

  function handleDeleteChart(id: string) {
    const newCharts = activeCharts.filter(c => c.id !== id)
    setActiveCharts(newCharts)
    if (loadedReportId) {
      const report = state.reports.find(r => r.id === loadedReportId)
      if (report) dispatch({ type: 'UPDATE_REPORT', payload: { ...report, charts: newCharts } })
    }
  }

  function handleUpdateChart(updated: ChartConfig) {
    const newCharts = activeCharts.map(c => c.id === updated.id ? updated : c)
    setActiveCharts(newCharts)
    if (loadedReportId) {
      const report = state.reports.find(r => r.id === loadedReportId)
      if (report) dispatch({ type: 'UPDATE_REPORT', payload: { ...report, charts: newCharts } })
    }
  }

  function handleDragEnd(result: DropResult) {
    if (!result.destination) return
    const reordered = [...activeCharts]
    const [removed] = reordered.splice(result.source.index, 1)
    reordered.splice(result.destination.index, 0, removed)
    setActiveCharts(reordered)
  }

  async function handleExportPDF() {
    if (!ds) return
    try { await exportPDF(reportName, activeCharts, ds, state.user?.email ?? '') }
    catch { show('PDF export failed.', 'error') }
  }

  function handleExportCSV() {
    if (!ds) return
    exportCSV(ds.data, `${reportName.replace(/\s+/g, '_')}.csv`)
  }

  async function handleExportXLSX() {
    if (!ds) return
    await exportXLSX(ds.data, `${reportName.replace(/\s+/g, '_')}.xlsx`)
  }

  function handleSendEmail() {
    setShowEmailModal(true)
  }

  return (
    <div className="p-8 max-w-4xl mx-auto pb-28">
      {/* Toast */}
      <div className="fixed top-5 right-5 z-50 space-y-2 max-w-sm">
        {toasts.map(t => (
          <div key={t.id} className={`flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${t.kind === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
            {t.text}
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-8 pb-6 border-b border-slate-200/70">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-sm flex-shrink-0">
            <PlaneSVG />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-0.5">Email Delivery System</p>
            <h1 className="text-2xl font-bold text-slate-800">Generate Report</h1>
            <p className="text-slate-500 text-sm mt-0.5">
              Auto-generate all charts from your data, or describe a specific visualization.
            </p>
          </div>
        </div>
      </div>

      {/* Data source + report name row */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-6 mb-6">
        <div className={`grid gap-3 mb-5 ${ds && ds.subSheets && ds.subSheets.length > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {/* Report Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              Report Name
            </label>
            <input
              value={reportName}
              onChange={e => setReportName(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          {/* Data Source */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              Data Source
            </label>
            <div className="relative">
              <select
                value={selectedDsId}
                onChange={e => {
                  setSelectedDsId(e.target.value)
                  dispatch({ type: 'SET_ACTIVE_DATA_SOURCE', payload: e.target.value })
                }}
                className="w-full appearance-none border border-slate-200 rounded-lg pl-3 pr-8 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
              >
                {state.dataSources.length === 0 && <option value="">No data sources — go to Import Data first</option>}
                {state.dataSources.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <ChevronDown size={13} className="absolute right-2.5 top-3 text-slate-400 pointer-events-none" />
            </div>
          </div>

          {/* Sheet / Tab — only shown when sub-sheets exist, occupies 3rd column */}
          {ds && ds.subSheets && ds.subSheets.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Sheet / Tab
              </label>
              <div className="relative">
                <select
                  value={selectedSubSheet}
                  onChange={e => setSelectedSubSheet(e.target.value)}
                  className="w-full appearance-none border border-indigo-200 rounded-lg pl-3 pr-8 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-indigo-50"
                >
                  <option value="primary">Primary Sheet ({ds.data.length} rows)</option>
                  {ds.subSheets.map(s => (
                    <option key={s.name} value={s.name}>{s.name} ({s.data.length} rows)</option>
                  ))}
                </select>
                <ChevronDown size={13} className="absolute right-2.5 top-3 text-slate-400 pointer-events-none" />
              </div>
            </div>
          )}
        </div>

        {/* Auto-generate banner */}
        {ds && (
          <div className="flex items-center justify-between p-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-100 mb-5">
            <div>
              <p className="text-sm font-semibold text-indigo-700">Auto-generate all visualizations</p>
              <p className="text-xs text-indigo-500 mt-0.5">
                Creates {autoGenerateCharts(activeColumns).length} charts from{' '}
                <span className="font-medium">{activeData.length} rows</span> across{' '}
                <span className="font-medium">{activeColumns.length} columns</span> — instantly
              </p>
            </div>
            <button
              onClick={handleAutoGenerate}
              disabled={autoRunning}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm whitespace-nowrap"
            >
              <Sparkles size={15} />
              {autoRunning ? 'Generating…' : 'Auto-generate'}
            </button>
          </div>
        )}

        {/* Manual prompt */}
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
          Or describe a specific chart
        </label>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="e.g., 'Show revenue trend by month as a line chart'"
          rows={2}
          className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleGenerate() }}
        />

        <div className="flex flex-wrap gap-2 mt-2.5 mb-4">
          {EXAMPLE_PROMPTS.map(ex => (
            <button
              key={ex}
              onClick={() => setPrompt(ex)}
              className="px-3 py-1 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-600 rounded-full text-xs font-medium transition-colors"
            >
              {ex}
            </button>
          ))}
        </div>

        <button
          onClick={handleGenerate}
          disabled={!ds || !prompt.trim() || generating}
          className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-900 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
        >
          <Wand2 size={14} />
          {generating ? 'Generating…' : 'Add Chart'}
        </button>

        {state.dataSources.length === 0 && (
          <p className="text-xs text-amber-600 mt-3 flex items-center gap-1">
            ⚠ Connect a data source in <strong>Import Data</strong> first.
          </p>
        )}
      </div>

      {/* Charts */}
      {activeCharts.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-slate-200">
          <BarChart2 size={40} className="mx-auto text-slate-200 mb-4" />
          <p className="text-slate-500 font-medium">No charts yet</p>
          <p className="text-slate-400 text-sm mt-1">
            Click <span className="font-semibold text-indigo-500">Auto-generate</span> to visualize everything at once,
            or describe a specific chart above.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-slate-600">
              {activeCharts.length} chart{activeCharts.length !== 1 ? 's' : ''} —{' '}
              <span className="text-slate-400 font-normal">drag to reorder</span>
            </p>
            <button
              onClick={() => {
                state.reports
                  .filter(r => r.dataSourceId === selectedDsId)
                  .forEach(r => dispatch({ type: 'REMOVE_REPORT', payload: r.id }))
                setActiveCharts([])
                setLoadedReportId(null)
              }}
              className="text-xs text-slate-400 hover:text-red-500 transition-colors"
            >
              Clear all
            </button>
          </div>
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="charts">
              {provided => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="space-y-4"
                >
                  {activeCharts.map((chart, index) => (
                    <ChartCard
                      key={chart.id}
                      chart={chart}
                      index={index}
                      data={activeData}
                      columns={activeColumns}
                      onDelete={handleDeleteChart}
                      onUpdate={handleUpdateChart}
                    />
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </>
      )}


      {/* Email Compose Modal */}
      <EmailModal
        isOpen={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        charts={activeCharts}
        dataSource={ds}
        userEmail={state.user?.email ?? ''}
        reportName={reportName}
      />
    </div>
  )
}
