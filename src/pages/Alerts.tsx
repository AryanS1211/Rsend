import { useState, useRef, useEffect } from 'react'
import {
  BellPlus, Bell, Pencil, Trash2, ToggleLeft, ToggleRight,
  CheckCircle, AlertCircle, X, RefreshCw, Settings2, Link, Database, Mail,
} from 'lucide-react'
import emailjs from '@emailjs/browser'
import { useApp } from '../context/AppContext'
import type { Alert, AlertCondition, AlertColumnRule, NotificationSchedule, ColumnInfo, DataSource, SubSheetData } from '../types'
import { connectGoogleSheet, discoverSubSheets, extractSpreadsheetId, fetchSheetByName } from '../utils/googleSheets'

// ─── Toggle ───────────────────────────────────────────────────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none ${checked ? 'bg-indigo-600' : 'bg-slate-200'}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

// ─── Toast ────────────────────────────────────────────────────────────────────
interface Toast { id: number; text: string; kind: 'success' | 'error' }
function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])
  function show(text: string, kind: 'success' | 'error' = 'success') {
    const id = Date.now()
    setToasts(prev => [...prev, { id, kind, text }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }
  return { toasts, show }
}
function ToastContainer({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed top-5 right-5 z-50 space-y-2">
      {toasts.map(t => (
        <div key={t.id} className={`flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${t.kind === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {t.kind === 'success' ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
          {t.text}
        </div>
      ))}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function conditionLabel(condition: AlertCondition, column: string, threshold: number): string {
  const map: Record<AlertCondition, string> = {
    above:      `${column} goes above ${threshold.toLocaleString()}`,
    below:      `${column} falls below ${threshold.toLocaleString()}`,
    equals:     `${column} equals exactly ${threshold.toLocaleString()}`,
    change_pct: `${column} changes by more than ${threshold}%`,
  }
  return map[condition] ?? ''
}

function parseInterval(s: string): number {
  const n = parseInt(s)
  if (s.endsWith('s')) return n * 1_000
  if (s.endsWith('m')) return n * 60_000
  if (s.endsWith('h')) return n * 3_600_000
  return 300_000
}

const CHECK_INTERVALS = [
  { value: '10s', label: '10 sec' },
  { value: '30s', label: '30 sec' },
  { value: '1m',  label: '1 min'  },
  { value: '5m',  label: '5 min'  },
  { value: '15m', label: '15 min' },
  { value: '30m', label: '30 min' },
  { value: '1h',  label: '1 hour' },
] as const

const scheduleColors: Record<NotificationSchedule, string> = {
  immediate: 'bg-red-50 text-red-600',
  weekly:    'bg-blue-50 text-blue-600',
  custom:    'bg-purple-50 text-purple-600',
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ─── Email chips ──────────────────────────────────────────────────────────────
function EmailChips({ emails, onChange }: { emails: string[]; onChange: (v: string[]) => void }) {
  const [input, setInput] = useState('')
  const [err, setErr] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function add(raw: string) {
    const email = raw.trim().toLowerCase()
    if (!email) return
    if (!email.includes('@') || !email.includes('.')) {
      setErr(`"${email}" is not a valid email.`)
      setTimeout(() => setErr(''), 3000)
      return
    }
    if (emails.includes(email)) { setInput(''); return }
    onChange([...emails, email])
    setInput(''); setErr('')
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input) }
    else if (e.key === 'Backspace' && !input && emails.length > 0) onChange(emails.slice(0, -1))
  }

  return (
    <div>
      <div
        onClick={() => inputRef.current?.focus()}
        className={`flex flex-wrap gap-1.5 px-3 py-2 border rounded-lg cursor-text min-h-[44px] focus-within:ring-2 focus-within:ring-indigo-400 focus-within:border-transparent ${err ? 'border-red-300' : 'border-slate-200'}`}
      >
        {emails.map(email => (
          <span key={email} className="flex items-center gap-1 px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-xs font-medium">
            <span className="truncate max-w-[180px]">{email}</span>
            <button onClick={e => { e.stopPropagation(); onChange(emails.filter(r => r !== email)) }} className="text-indigo-400 hover:text-indigo-700"><X size={11} /></button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          onBlur={() => { if (input.trim()) add(input) }}
          placeholder={emails.length === 0 ? 'Add email and press Enter…' : ''}
          className="flex-1 min-w-[160px] text-sm text-slate-700 placeholder-slate-400 outline-none bg-transparent"
        />
      </div>
      {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
    </div>
  )
}

// ─── Preview table ────────────────────────────────────────────────────────────
function PreviewTable({ rows, cols }: { rows: Record<string, unknown>[]; cols: ColumnInfo[] }) {
  if (rows.length === 0 || cols.length === 0) return null
  const displayCols = cols.slice(0, 7)
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            {displayCols.map(c => (
              <th key={c.name} className="px-2.5 py-1.5 text-left font-semibold text-slate-500 whitespace-nowrap">
                {c.name}
                <span className={`ml-1 px-1 rounded text-xs ${c.type === 'number' ? 'bg-blue-50 text-blue-500' : 'bg-slate-100 text-slate-400'}`}>{c.type}</span>
              </th>
            ))}
            {cols.length > 7 && <th className="px-2.5 py-1.5 text-slate-400">+{cols.length - 7} more</th>}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 4).map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
              {displayCols.map(c => (
                <td key={c.name} className="px-2.5 py-1.5 text-slate-600 whitespace-nowrap max-w-[120px] truncate">{String(row[c.name] ?? '')}</td>
              ))}
              {cols.length > 7 && <td />}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-400 text-center py-1 border-t border-slate-100">{rows.length} total rows · showing 4</p>
    </div>
  )
}

// ─── Alert Modal ──────────────────────────────────────────────────────────────
interface ModalProps {
  existing?: Alert
  onClose: () => void
  onSave: (a: Alert) => void
  dataSources: DataSource[]
  userEmail: string
}

function AlertModal({ existing, onClose, onSave, dataSources, userEmail }: ModalProps) {
  const [name, setName] = useState(existing?.name ?? '')

  const hasCustom = !!existing?.sheetUrl
  const [useUrl, setUseUrl] = useState(hasCustom)
  const [dsId, setDsId] = useState(existing?.dataSourceId ?? dataSources[0]?.id ?? '')
  const [sheetUrl, setSheetUrl] = useState(existing?.sheetUrl ?? '')
  const [loadingSheet, setLoadingSheet] = useState(false)
  const [urlError, setUrlError] = useState('')

  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([])
  const [previewCols, setPreviewCols] = useState<ColumnInfo[]>([])
  const [subSheets, setSubSheets] = useState<SubSheetData[]>([])
  const [activeTab, setActiveTab] = useState<string>(existing?.subSheetName ?? 'primary')
  const [discoveringSheets, setDiscoveringSheets] = useState(false)

  const [columnRules, setColumnRules] = useState<AlertColumnRule[]>(existing?.columnRules ?? [])
  const [manualSheetName, setManualSheetName] = useState('')
  const [loadingManual, setLoadingManual] = useState(false)
  const [manualError, setManualError] = useState('')

  const [schedule, setSchedule] = useState<NotificationSchedule>(existing?.schedule ?? 'immediate')
  const [customDay, setCustomDay] = useState(existing?.customDay ?? 'Mon')
  const [checkInterval, setCheckInterval] = useState(existing?.checkInterval ?? '5m')
  const [emailBody, setEmailBody] = useState(existing?.emailBody ?? '')
  const [emails, setEmails] = useState<string[]>(
    existing?.notificationEmails?.length ? existing.notificationEmails : (userEmail ? [userEmail] : [])
  )
  const [error, setError] = useState('')

  // Populate preview from imported DS when dsId changes
  useEffect(() => {
    if (useUrl) return
    const ds = dataSources.find(d => d.id === dsId)
    if (!ds) return
    setPreviewRows(ds.data)
    setPreviewCols(ds.columns)
    setSubSheets(ds.subSheets ?? [])
    setActiveTab(existing?.subSheetName ?? 'primary')
    if (!existing) setColumnRules([])
  }, [dsId, useUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-load sheet when editing existing alert with URL
  useEffect(() => {
    if (useUrl && sheetUrl && existing) {
      handleLoadSheet(true)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const activeSub = subSheets.find(s => s.name === activeTab)
  const displayRows = activeTab === 'primary' ? previewRows : (activeSub?.data ?? [])
  const displayCols = activeTab === 'primary' ? previewCols : (activeSub?.columns ?? [])
  const numericCols = displayCols.filter(c => c.type === 'number')

  const currentSpreadsheetId = useUrl
    ? extractSpreadsheetId(sheetUrl)
    : (dataSources.find(d => d.id === dsId)?.url ? extractSpreadsheetId(dataSources.find(d => d.id === dsId)!.url!) : null)

  function toggleCol(colName: string) {
    setColumnRules(prev => {
      const exists = prev.some(r => r.column === colName)
      if (exists) return prev.filter(r => r.column !== colName)
      return [...prev, { column: colName, condition: 'above', threshold: 0 }]
    })
  }

  function updateRule(colName: string, field: 'condition' | 'threshold', value: AlertCondition | number) {
    setColumnRules(prev => prev.map(r => r.column === colName ? { ...r, [field]: value } : r))
  }

  async function handleAddSheetByName() {
    const tabName = manualSheetName.trim()
    if (!tabName || !currentSpreadsheetId) return
    setLoadingManual(true); setManualError('')
    try {
      const sub = await fetchSheetByName(currentSpreadsheetId, tabName)
      if (!sub) { setManualError(`Tab "${tabName}" not found or is empty.`); return }
      setSubSheets(prev => prev.some(s => s.name === sub.name) ? prev : [...prev, sub])
      setActiveTab(sub.name)
      setColumnRules([])
      setManualSheetName('')
    } catch {
      setManualError(`Could not load tab "${tabName}".`)
    } finally {
      setLoadingManual(false)
    }
  }

  async function handleLoadSheet(preserveRules = false) {
    const url = sheetUrl.trim()
    if (!url.includes('docs.google.com/spreadsheets')) {
      setUrlError("That doesn't look like a Google Sheets URL."); return
    }
    setLoadingSheet(true); setUrlError('')
    setPreviewRows([]); setPreviewCols([])
    setSubSheets([]); setActiveTab('primary')
    if (!preserveRules) setColumnRules([])
    try {
      const ds = await connectGoogleSheet(url)
      setPreviewRows(ds.data)
      setPreviewCols(ds.columns)
      if (ds.columns.filter(c => c.type === 'number').length === 0) {
        setUrlError('No numeric columns found in this sheet.')
      }
      const sid = extractSpreadsheetId(url)
      if (sid) {
        setDiscoveringSheets(true)
        discoverSubSheets(sid, JSON.stringify(ds.data[0]))
          .then(found => setSubSheets(found))
          .catch(() => {})
          .finally(() => setDiscoveringSheets(false))
      }
    } catch {
      setUrlError('Could not load sheet. Make sure it is shared publicly.')
    } finally {
      setLoadingSheet(false)
    }
  }

  function handleSave() {
    if (!name.trim()) { setError('Alert name is required.'); return }
    if (useUrl) {
      if (!sheetUrl.trim()) { setError('Enter a Google Sheet URL.'); return }
      if (previewCols.length === 0) { setError('Load the sheet first.'); return }
    } else {
      if (!dsId) { setError('Select a data source.'); return }
    }
    if (columnRules.length === 0) { setError('Select at least one column to monitor.'); return }
    if (emails.length === 0) { setError('Add at least one notification email.'); return }

    onSave({
      id: existing?.id ?? `alert_${Date.now()}`,
      name: name.trim(),
      dataSourceId: useUrl ? '' : dsId,
      sheetUrl: useUrl ? sheetUrl.trim() : undefined,
      subSheetName: activeTab !== 'primary' ? activeTab : undefined,
      columnRules,
      schedule,
      customDay: schedule === 'custom' ? customDay : undefined,
      checkInterval,
      emailBody: emailBody.trim() || undefined,
      notificationEmails: emails,
      enabled: existing?.enabled ?? true,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    })
  }

  const sheetLoaded = previewCols.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-800">{existing ? 'Edit Alert' : 'Create Alert'}</h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-3 py-2 rounded-lg flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" /> {error}
            </div>
          )}

          {/* Alert name */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Alert Name</label>
            <input
              value={name}
              onChange={e => { setName(e.target.value); setError('') }}
              placeholder="e.g., Low Revenue Alert"
              className="w-full border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          {/* Data source toggle */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Data Source</label>
            <div className="flex rounded-lg overflow-hidden border border-slate-200 mb-3">
              <button type="button" onClick={() => { setUseUrl(false); setColumnRules([]) }}
                className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${!useUrl ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                From imported data
              </button>
              <button type="button" onClick={() => { setUseUrl(true); setPreviewRows([]); setPreviewCols([]); setSubSheets([]); setColumnRules([]) }}
                className={`flex-1 px-3 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${useUrl ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                <Link size={11} /> Google Sheet URL
              </button>
            </div>

            {!useUrl ? (
              <select value={dsId} onChange={e => { setDsId(e.target.value); setColumnRules([]) }}
                className="w-full border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white">
                {dataSources.length === 0 && <option value="">No data sources imported</option>}
                {dataSources.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input value={sheetUrl} onChange={e => { setSheetUrl(e.target.value); setUrlError('') }}
                    placeholder="https://docs.google.com/spreadsheets/d/…"
                    className="flex-1 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                  <button type="button" onClick={() => handleLoadSheet()} disabled={loadingSheet || !sheetUrl.trim()}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap">
                    {loadingSheet ? <RefreshCw size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    {loadingSheet ? 'Loading…' : 'Load'}
                  </button>
                </div>
                {urlError && <p className="text-xs text-red-500">{urlError}</p>}
                <p className="text-xs text-slate-400">Sheet must be shared publicly. Won't appear in Import Data.</p>
              </div>
            )}
          </div>

          {/* Sheet preview + sub-sheet tabs */}
          {sheetLoaded && (
            <div className="space-y-2">
              <div className="flex items-center gap-1 flex-wrap">
                <button onClick={() => { setActiveTab('primary'); setColumnRules([]) }}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${activeTab === 'primary' ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500 hover:border-indigo-300'}`}>
                  <Database size={10} /> Primary
                </button>
                {subSheets.map(s => (
                  <button key={s.name} onClick={() => { setActiveTab(s.name); setColumnRules([]) }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${activeTab === s.name ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500 hover:border-indigo-300'}`}>
                    {s.name}
                  </button>
                ))}
                {discoveringSheets && (
                  <span className="flex items-center gap-1 text-xs text-slate-400 px-2">
                    <RefreshCw size={10} className="animate-spin" /> finding sheets…
                  </span>
                )}
              </div>

              {currentSpreadsheetId && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <input
                      value={manualSheetName}
                      onChange={e => { setManualSheetName(e.target.value); setManualError('') }}
                      onKeyDown={e => { if (e.key === 'Enter') handleAddSheetByName() }}
                      placeholder="Tab not listed? Type exact name (e.g. 30th March to 5th April)"
                      className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 placeholder-slate-400"
                    />
                    <button type="button" onClick={handleAddSheetByName} disabled={loadingManual || !manualSheetName.trim()}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap">
                      {loadingManual ? <RefreshCw size={10} className="animate-spin" /> : null}
                      Add tab
                    </button>
                  </div>
                  {manualError && <p className="text-xs text-red-500">{manualError}</p>}
                </div>
              )}

              <PreviewTable rows={displayRows} cols={displayCols} />

              {numericCols.length > 0 ? (
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">Select columns to monitor</p>
                  <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto p-1">
                    {numericCols.map(c => {
                      const checked = columnRules.some(r => r.column === c.name)
                      return (
                        <label key={c.name} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-xs transition-colors ${checked ? 'border-indigo-400 bg-indigo-50 text-indigo-700 font-medium' : 'border-slate-200 text-slate-600 hover:border-indigo-200'}`}>
                          <input type="checkbox" checked={checked} onChange={() => toggleCol(c.name)} className="accent-indigo-600 shrink-0" />
                          <span className="truncate">{c.name}</span>
                        </label>
                      )
                    })}
                  </div>

                  {columnRules.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Alert conditions per column</p>
                      {columnRules.map(rule => (
                        <div key={rule.column} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                          <span className="text-xs font-semibold text-indigo-700 w-28 truncate shrink-0" title={rule.column}>{rule.column}</span>
                          <select
                            value={rule.condition}
                            onChange={e => updateRule(rule.column, 'condition', e.target.value as AlertCondition)}
                            className="flex-1 border border-slate-200 rounded-md px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
                          >
                            <option value="above">goes above</option>
                            <option value="below">falls below</option>
                            <option value="equals">equals exactly</option>
                            <option value="change_pct">changes % by more than</option>
                          </select>
                          <input
                            type="number"
                            value={rule.threshold}
                            onChange={e => updateRule(rule.column, 'threshold', Number(e.target.value))}
                            className="w-20 border border-slate-200 rounded-md px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
                            placeholder="0"
                          />
                          <button type="button" onClick={() => setColumnRules(prev => prev.filter(r => r.column !== rule.column))}
                            className="text-slate-400 hover:text-red-500 transition-colors shrink-0">
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-amber-600 flex items-center gap-1"><AlertCircle size={12} /> No numeric columns in this sheet tab.</p>
              )}
            </div>
          )}

          {/* Check interval */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Check Interval
              <span className="ml-2 text-xs font-normal text-slate-400">— how often to re-fetch &amp; check while app is open</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {CHECK_INTERVALS.map(opt => (
                <button key={opt.value} type="button" onClick={() => setCheckInterval(opt.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${checkInterval === opt.value ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Schedule */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Notification Schedule</label>
            <div className="space-y-2">
              {([
                { value: 'immediate', label: 'Immediate',       desc: 'Alert sent as soon as breach is detected' },
                { value: 'weekly',    label: 'Weekly (Monday)', desc: 'Summary of breaches sent every Monday' },
                { value: 'custom',   label: 'Custom day',      desc: 'Choose a specific day of the week' },
              ] as const).map(opt => (
                <label key={opt.value} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${schedule === opt.value ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <input type="radio" name="schedule" value={opt.value} checked={schedule === opt.value} onChange={() => setSchedule(opt.value)} className="mt-0.5 accent-indigo-600" />
                  <div>
                    <p className="text-sm font-medium text-slate-700">{opt.label}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
            {schedule === 'custom' && (
              <div className="mt-3 flex gap-2">
                {DAYS.map(d => (
                  <button key={d} type="button" onClick={() => setCustomDay(d)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${customDay === d ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-indigo-50'}`}>
                    {d}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Email body template */}
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
              <Mail size={13} /> Alert Email Message
              <span className="text-xs font-normal text-slate-400 ml-1">— optional custom intro</span>
            </label>
            <textarea
              value={emailBody}
              onChange={e => setEmailBody(e.target.value)}
              rows={3}
              placeholder={`e.g. "Hi team, a data threshold has been breached. Please review and take corrective action immediately."`}
              className="w-full border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none placeholder-slate-400 mt-1.5"
            />
            <p className="text-xs text-slate-400 mt-1">This appears at the top of every alert email. Breach details are appended automatically.</p>
          </div>

          {/* Notification emails */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Notification Emails
              <span className="ml-2 text-xs font-normal text-slate-400">— type email and press Enter to add</span>
            </label>
            <EmailChips emails={emails} onChange={setEmails} />
            {emails.length > 0 && (
              <p className="text-xs text-slate-400 mt-1.5">{emails.length} recipient{emails.length > 1 ? 's' : ''} — all will receive the alert</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
          <button onClick={handleSave} className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm">
            {existing ? 'Update Alert' : 'Save Alert'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Alerts() {
  const { state, dispatch } = useApp()
  const { toasts, show } = useToast()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingAlert, setEditingAlert] = useState<Alert | undefined>(undefined)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const totalAlerts = state.alerts.length
  const activeAlerts = state.alerts.filter(a => a.enabled).length

  // ── Local prefs ──
  const [notifSchedule, setNotifSchedule] = useState<NotificationSchedule>('immediate')
  const [notifCustomDay, setNotifCustomDay] = useState('Mon')
  const [includeTable, setIncludeTable] = useState(true)
  const [reportFormat, setReportFormat] = useState<'pdf' | 'csv' | 'both'>('pdf')
  const [testing, setTesting] = useState(false)

  // ── Live alert checking ──────────────────────────────────────────────────────
  const stateRef = useRef(state)
  stateRef.current = state
  // Full snapshot of rows at last check — used to detect value changes vs new rows
  const baselineDataRef = useRef<Record<string, Record<string, unknown>[]>>({})
  const showRef = useRef(show)
  showRef.current = show

  useEffect(() => {
    const enabled = state.alerts.filter(a => a.enabled && a.columnRules.length > 0)
    if (enabled.length === 0) return
    const timers: ReturnType<typeof setInterval>[] = []

    for (const alert of enabled) {
      const ms = parseInterval(alert.checkInterval ?? '5m')
      const alertId = alert.id

      timers.push(setInterval(async () => {
        const cur = stateRef.current.alerts.find(a => a.id === alertId)
        if (!cur || !cur.enabled) return

        try {
          let rows: Record<string, unknown>[]
          if (cur.sheetUrl) {
            const ds = await connectGoogleSheet(cur.sheetUrl)
            if (cur.subSheetName) {
              const sid = extractSpreadsheetId(cur.sheetUrl)
              const sub = sid ? await fetchSheetByName(sid, cur.subSheetName) : null
              rows = sub?.data ?? ds.data
            } else {
              rows = ds.data
            }
          } else {
            const ds = stateRef.current.dataSources.find(d => d.id === cur.dataSourceId)
            if (!ds) return
            rows = cur.subSheetName
              ? (ds.subSheets?.find(s => s.name === cur.subSheetName)?.data ?? ds.data)
              : ds.data
          }

          // ── First fetch: store full snapshot, fire nothing ─────────────────
          if (!baselineDataRef.current[alertId]) {
            baselineDataRef.current[alertId] = rows.map(r => ({ ...r }))
            return
          }

          const snapshot = baselineDataRef.current[alertId]

          // ── Detect updated rows (value changed in a monitored column) ───────
          type Breach = { rule: AlertColumnRule; value: number; row: Record<string, unknown>; kind: 'updated' | 'new' }
          const breaches: Breach[] = []

          const existingCount = Math.min(rows.length, snapshot.length)
          for (let i = 0; i < existingCount; i++) {
            const curRow = rows[i]
            const oldRow = snapshot[i]
            for (const rule of cur.columnRules) {
              const oldVal = Number(oldRow[rule.column])
              const newVal = Number(curRow[rule.column])
              if (isNaN(newVal) || oldVal === newVal) continue   // no change, skip
              let hit = false
              if      (rule.condition === 'above')      hit = newVal > rule.threshold
              else if (rule.condition === 'below')      hit = newVal < rule.threshold
              else if (rule.condition === 'equals')     hit = newVal === rule.threshold
              else if (rule.condition === 'change_pct') hit = !isNaN(oldVal) && oldVal !== 0 && Math.abs((newVal - oldVal) / oldVal) * 100 > rule.threshold
              if (hit) { breaches.push({ rule, value: newVal, row: curRow, kind: 'updated' }); break }
            }
          }

          // ── Detect new rows appended after snapshot ─────────────────────────
          const newRows = rows.length > snapshot.length ? rows.slice(snapshot.length) : []
          for (const row of newRows) {
            for (const rule of cur.columnRules) {
              const v = Number(row[rule.column])
              if (isNaN(v)) continue
              let hit = false
              if      (rule.condition === 'above')  hit = v > rule.threshold
              else if (rule.condition === 'below')  hit = v < rule.threshold
              else if (rule.condition === 'equals') hit = v === rule.threshold
              // change_pct requires a prior value — not applicable to new rows
              if (hit) { breaches.push({ rule, value: v, row, kind: 'new' }); break }
            }
          }

          // ── Always roll the snapshot forward ────────────────────────────────
          baselineDataRef.current[alertId] = rows.map(r => ({ ...r }))

          if (breaches.length === 0) return

          const cfg = stateRef.current.emailjsConfig
          if (!cfg) return

          const conditionLines = breaches.map(b => {
            const label = b.kind === 'new' ? '[New row]' : '[Updated row]'
            const rowEntries = Object.entries(b.row)
              .filter(([, v]) => v !== null && v !== undefined && v !== '')
              .map(([k, v]) => `    ${k}: ${v}`)
              .join('\n')
            return [
              `${label} ${b.rule.column}: ${b.value.toLocaleString()} (${conditionLabel(b.rule.condition, b.rule.column, b.rule.threshold)})`,
              `  Row data:`,
              rowEntries,
            ].join('\n')
          }).join('\n\n')

          const emailMsg = [
            cur.emailBody ? `${cur.emailBody}\n\n---` : '',
            `Alert: ${cur.name}`,
            `Triggered: ${new Date().toLocaleString()}`,
            '',
            'Breached conditions:',
            conditionLines,
          ].filter(Boolean).join('\n')

          for (const email of cur.notificationEmails) {
            await emailjs.send(cfg.serviceId, cfg.templateId, {
              to_email:         email,
              from_name:        'Rsend Alerts',
              reply_to:         stateRef.current.user?.email ?? email,
              subject:          `Alert triggered: ${cur.name}`,
              message:          emailMsg,
              attachments_info: '',
              cc_email:         '',
            }, cfg.publicKey)
          }

          showRef.current(`Alert "${cur.name}" triggered! Email sent.`, 'success')
        } catch (err) {
          console.error('Alert check failed:', err)
        }
      }, ms))
    }

    return () => timers.forEach(clearInterval)
  }, [state.alerts, state.emailjsConfig]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleTestConnection() {
    setTesting(true)
    await new Promise(r => setTimeout(r, 1100))
    setTesting(false)
    show('Connection successful!')
  }

  function openCreate() { setEditingAlert(undefined); setModalOpen(true) }
  function openEdit(a: Alert) { setEditingAlert(a); setModalOpen(true) }

  function handleSave(a: Alert) {
    if (editingAlert) {
      dispatch({ type: 'UPDATE_ALERT', payload: a })
      show('Alert updated!')
    } else {
      dispatch({ type: 'ADD_ALERT', payload: a })
      show('Alert created!')
    }
    setModalOpen(false)
  }

  function handleDelete(id: string) {
    dispatch({ type: 'REMOVE_ALERT', payload: id })
    setDeleteConfirm(null)
    show('Alert deleted.')
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <ToastContainer toasts={toasts} />

      <div className="flex items-start justify-between mb-8 pb-6 border-b border-slate-200/70">
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Monitoring</p>
          <h1 className="text-2xl font-bold text-slate-800">Threshold Alerts</h1>
          <p className="text-slate-500 text-sm mt-1">Get notified when your data crosses critical thresholds.</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors mt-1">
          <BellPlus size={14} /> Create Alert
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8">
        {[
          { label: 'Total Alerts',  value: totalAlerts,  icon: <Bell size={16} className="text-indigo-500" />,        bg: 'bg-indigo-50'  },
          { label: 'Active Alerts', value: activeAlerts, icon: <CheckCircle size={16} className="text-emerald-500" />, bg: 'bg-emerald-50' },
        ].map(stat => (
          <div key={stat.label} className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-5">
            <div className={`w-8 h-8 rounded-lg ${stat.bg} flex items-center justify-center mb-3`}>{stat.icon}</div>
            <p className="text-2xl font-bold text-slate-800 leading-none mb-1">{stat.value}</p>
            <p className="text-xs text-slate-400 font-medium">{stat.label}</p>
          </div>
        ))}
      </div>

      {state.alerts.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-slate-200">
          <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mx-auto mb-4">
            <Bell size={28} className="text-slate-300" />
          </div>
          <p className="text-slate-600 font-semibold">No alerts configured</p>
          <p className="text-slate-400 text-sm mt-1">Create your first alert to monitor data thresholds.</p>
          <button onClick={openCreate} className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors shadow-sm">
            <BellPlus size={14} /> Create Alert
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {state.alerts.map(alert => {
            const ds = state.dataSources.find(d => d.id === alert.dataSourceId)
            const isDeleting = deleteConfirm === alert.id
            return (
              <div key={alert.id} className={`bg-white rounded-2xl shadow-sm border transition-all ${alert.enabled ? 'border-slate-200/80' : 'border-slate-200/80 opacity-60'}`}>
                <div className="flex items-start gap-4 p-5">
                  <button
                    onClick={() => dispatch({ type: 'TOGGLE_ALERT', payload: alert.id })}
                    className={`mt-0.5 flex-shrink-0 transition-colors ${alert.enabled ? 'text-indigo-600' : 'text-slate-300'}`}
                    title={alert.enabled ? 'Disable' : 'Enable'}
                  >
                    {alert.enabled ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="font-semibold text-slate-800 text-sm">{alert.name}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${scheduleColors[alert.schedule]}`}>
                        {alert.schedule === 'custom' ? alert.customDay : alert.schedule}
                      </span>
                      {alert.checkInterval && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-500">
                          every {alert.checkInterval}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500">
                      {alert.columnRules.length > 0
                        ? alert.columnRules.map(r => conditionLabel(r.condition, r.column, r.threshold)).join(' · ')
                        : '—'}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      {alert.sheetUrl
                        ? <span className="flex items-center gap-1"><Link size={10} /> Custom sheet (alert-only)</span>
                        : `Source: ${ds?.name ?? 'Unknown'}`}
                    </p>
                    {alert.notificationEmails?.length > 0 && (
                      <p className="text-xs text-slate-400 mt-0.5">Notify: {alert.notificationEmails.join(', ')}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isDeleting ? (
                      <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                        <p className="text-xs text-red-600 font-medium">Delete?</p>
                        <button onClick={() => handleDelete(alert.id)} className="text-xs text-red-600 font-semibold hover:text-red-700">Yes</button>
                        <button onClick={() => setDeleteConfirm(null)} className="text-xs text-slate-500 hover:text-slate-700">No</button>
                      </div>
                    ) : (
                      <>
                        <button onClick={() => openEdit(alert)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Edit"><Pencil size={14} /></button>
                        <button onClick={() => setDeleteConfirm(alert.id)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Delete"><Trash2 size={14} /></button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Notification & Sync Settings */}
      <div className="mt-10 bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <Settings2 size={16} className="text-indigo-500" />
          <h2 className="font-semibold text-slate-800 text-sm">Notification & Sync Settings</h2>
        </div>
        <div className="px-6 py-5 space-y-6">
          <div>
            <p className="text-sm font-medium text-slate-700 mb-3">Default notification schedule</p>
            <div className="space-y-2">
              {([
                { value: 'immediate', label: 'Immediate', desc: 'Notify as soon as breach is detected' },
                { value: 'weekly',    label: 'Weekly',    desc: 'Send weekly summary every Monday' },
                { value: 'custom',   label: 'Custom',    desc: 'Choose your preferred day' },
              ] as const).map(opt => (
                <label key={opt.value} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${notifSchedule === opt.value ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <input type="radio" name="notifSchedule" value={opt.value} checked={notifSchedule === opt.value} onChange={() => { setNotifSchedule(opt.value); show('Preference saved.') }} className="accent-indigo-600" />
                  <div>
                    <p className="text-sm font-medium text-slate-700">{opt.label}</p>
                    <p className="text-xs text-slate-400">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
            {notifSchedule === 'custom' && (
              <div className="mt-3 flex gap-2">
                {DAYS.map(d => (
                  <button key={d} type="button" onClick={() => setNotifCustomDay(d)}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${notifCustomDay === d ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-indigo-50'}`}>
                    {d}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 pt-5">
            <div>
              <p className="text-sm font-medium text-slate-700">Include data table in email</p>
              <p className="text-xs text-slate-400 mt-0.5">Attach a summary table alongside the alert report</p>
            </div>
            <Toggle checked={includeTable} onChange={v => { setIncludeTable(v); show('Preference saved.') }} />
          </div>

          <div className="border-t border-slate-100 pt-5">
            <p className="text-sm font-medium text-slate-700 mb-2">Report format</p>
            <div className="flex gap-2">
              {(['pdf', 'csv', 'both'] as const).map(f => (
                <button key={f} onClick={() => { setReportFormat(f); show('Format preference saved.') }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${reportFormat === f ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-100 pt-5">
            <button onClick={handleTestConnection} disabled={testing}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors disabled:opacity-60">
              <RefreshCw size={14} className={testing ? 'animate-spin' : ''} />
              {testing ? 'Testing…' : 'Test Connection'}
            </button>
          </div>
        </div>
      </div>

      {modalOpen && (
        <AlertModal
          existing={editingAlert}
          onClose={() => setModalOpen(false)}
          onSave={handleSave}
          dataSources={state.dataSources}
          userEmail={state.user?.email ?? ''}
        />
      )}
    </div>
  )
}
