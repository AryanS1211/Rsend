import { useState, useRef, useMemo, useEffect } from 'react'
import {
  Mail as MailIcon, Paperclip, BarChart2, TableProperties,
  FileText, Send, Check, RefreshCw, X,
  Plus, Sparkles, Eye, EyeOff, Users, AtSign, AlertCircle,
  Settings as SettingsIcon, Upload, Cloud, Link, Trash2, Pencil, Image,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import emailjs from '@emailjs/browser'
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend,
} from 'recharts'
import html2canvas from 'html2canvas'
import { useApp } from '../context/AppContext'
import type { ChartConfig, DataSource, CloudinaryConfig, ColumnInfo } from '../types'

// ─── File size constants ──────────────────────────────────────────────────────
const MB = 1024 * 1024
const HARD_LIMIT_MB = 100        // reject above this
const CLOUD_THRESHOLD_MB = 25    // must use cloud above this

// ─── User file record ─────────────────────────────────────────────────────────
interface UserFile {
  id: string
  file: File
  status: 'pending' | 'uploading' | 'done' | 'error' | 'oversized'
  progress: number   // 0-100
  url?: string
  errorMsg?: string
}

// ─── Cloudinary upload (XHR for progress) ────────────────────────────────────
// Use raw/upload for non-image files so Cloudinary stores them verbatim
// (auto/upload can transform or misidentify Excel/PDF/etc. and strip formatting)
function uploadToCloudinary(
  file: File,
  config: CloudinaryConfig,
  onProgress: (pct: number) => void,
): Promise<string> {
  const resourceType = file.type.startsWith('image/') ? 'image' : 'raw'
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const fd = new FormData()
    fd.append('file', file)
    fd.append('upload_preset', config.uploadPreset)
    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    })
    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        resolve((JSON.parse(xhr.responseText) as { secure_url: string }).secure_url)
      } else {
        const body = xhr.responseText
        try {
          const err = JSON.parse(body) as { error?: { message?: string } }
          reject(new Error(err.error?.message ?? `HTTP ${xhr.status}`))
        } catch {
          reject(new Error(`HTTP ${xhr.status}`))
        }
      }
    })
    xhr.addEventListener('error', () => reject(new Error('Network error')))
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${config.cloudName}/${resourceType}/upload`)
    xhr.send(fd)
  })
}

// ─── Upload a raw blob to Cloudinary (no progress needed) ────────────────────
async function uploadBlobToCloudinary(
  blob: Blob,
  filename: string,
  config: CloudinaryConfig,
): Promise<string> {
  const fd = new FormData()
  fd.append('file', blob, filename)
  fd.append('upload_preset', config.uploadPreset)
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloudName}/raw/upload`,
    { method: 'POST', body: fd },
  )
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? `HTTP ${res.status}`)
  }
  return ((await res.json()) as { secure_url: string }).secure_url
}

// ─── Generate CSV text from rows + columns ────────────────────────────────────
function toCSV(data: Record<string, unknown>[], columns: ColumnInfo[]): string {
  const header = columns.map(c => `"${String(c.name).replace(/"/g, '""')}"`).join(',')
  const rows = data.map(row =>
    columns.map(c => {
      const v = row[c.name]
      if (v === null || v === undefined) return ''
      const s = String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }).join(',')
  )
  return [header, ...rows].join('\n')
}

// ─── Capture any DOM element as PNG blob via html2canvas ─────────────────────
async function captureElementAsPng(el: HTMLElement): Promise<Blob> {
  const canvas = await html2canvas(el, {
    backgroundColor: '#ffffff',
    scale: 2,
    useCORS: true,
    logging: false,
    width:  el.offsetWidth  || 800,
    height: el.offsetHeight || 420,
  })
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      b => b ? resolve(b) : reject(new Error('canvas.toBlob returned null')),
      'image/png',
      0.95,
    )
  })
}

// ─── Process chart data (group + aggregate for rendering) ─────────────────────
const PALETTE = ['#6366f1','#8b5cf6','#06b6d4','#f59e0b','#ef4444','#10b981','#f97316','#ec4899']

function processChartData(chart: ChartConfig, ds: DataSource | null): Record<string, unknown>[] {
  if (chart.cachedData && chart.cachedData.length > 0) return chart.cachedData.slice(0, 30)
  if (chart.subSheetName && ds?.subSheets) {
    const sub = ds.subSheets.find(s => s.name === chart.subSheetName)
    if (sub && sub.data.length > 0) return sub.data.slice(0, 30)
  }
  if (!ds || !chart.xAxis || ds.data.length === 0) return []
  const grouped: Record<string, Record<string, number>> = {}
  for (const row of ds.data) {
    const key = String(row[chart.xAxis] ?? '')
    if (!grouped[key]) grouped[key] = {}
    for (const y of chart.yAxes) {
      grouped[key][y] = (grouped[key][y] ?? 0) + (Number(row[y]) || 0)
    }
  }
  return Object.entries(grouped).slice(0, 30).map(([key, vals]) => ({
    [chart.xAxis!]: key,
    ...vals,
  }))
}

// ─── Heatmap grid renderer (HTML table → captured by html2canvas) ─────────────
function HeatmapGrid({ chart, ds }: { chart: ChartConfig; ds: DataSource | null }) {
  if (!ds || !chart.xAxis || chart.yAxes.length === 0) return null
  const rows = ds.data.slice(0, 20)
  const cols = chart.yAxes.slice(0, 8)
  const allVals = rows.flatMap(r => cols.map(c => Number(r[c]) || 0))
  const min = Math.min(...allVals)
  const max = Math.max(...allVals)
  const cell = (v: number) => {
    const t = max === min ? 0.5 : (v - min) / (max - min)
    return `hsl(${Math.round(240 - t * 240)},70%,${Math.round(65 - t * 30)}%)`
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
        <thead>
          <tr>
            <th style={{ padding: '5px 10px', background: '#f1f5f9', border: '1px solid #e2e8f0', textAlign: 'left' }}>{chart.xAxis}</th>
            {cols.map(c => <th key={c} style={{ padding: '5px 10px', background: '#f1f5f9', border: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td style={{ padding: '5px 10px', border: '1px solid #e2e8f0', fontWeight: 600, whiteSpace: 'nowrap' }}>{String(row[chart.xAxis!] ?? '')}</td>
              {cols.map(c => {
                const v = Number(row[c]) || 0
                return (
                  <td key={c} style={{ padding: '5px 10px', border: '1px solid #e2e8f0', background: cell(v), textAlign: 'right', color: '#fff', fontWeight: 500 }}>
                    {v.toLocaleString()}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Hidden chart renderer (off-screen, captured by html2canvas) ───────────────
interface HiddenChartProps {
  chart: ChartConfig
  ds:    DataSource | null
  divRef: (el: HTMLDivElement | null) => void
}
function HiddenChart({ chart, ds, divRef }: HiddenChartProps) {
  const data = processChartData(chart, ds)
  const W = 800
  const H = 380
  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey={chart.xAxis} tick={{ fontSize: 11 }} />
      <YAxis tick={{ fontSize: 11 }} />
      <Tooltip />
      <Legend />
    </>
  )
  return (
    <div
      ref={divRef}
      style={{ position: 'fixed', left: -9999, top: 0, width: W, background: '#fff', padding: '16px', fontFamily: 'sans-serif', zIndex: -1 }}
    >
      <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: '#1e293b' }}>{chart.title}</p>
      {chart.type === 'bar' && (
        <BarChart width={W - 32} height={H} data={data}>
          {axes}
          {chart.yAxes.map((y, i) => <Bar key={y} dataKey={y} fill={PALETTE[i % PALETTE.length]} />)}
        </BarChart>
      )}
      {chart.type === 'line' && (
        <LineChart width={W - 32} height={H} data={data}>
          {axes}
          {chart.yAxes.map((y, i) => <Line key={y} dataKey={y} stroke={PALETTE[i % PALETTE.length]} dot={false} />)}
        </LineChart>
      )}
      {chart.type === 'area' && (
        <AreaChart width={W - 32} height={H} data={data}>
          {axes}
          {chart.yAxes.map((y, i) => (
            <Area key={y} dataKey={y} stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length] + '33'} />
          ))}
        </AreaChart>
      )}
      {chart.type === 'pie' && (
        <PieChart width={W - 32} height={H}>
          <Pie data={data} dataKey={chart.yAxes[0] ?? ''} nameKey={chart.xAxis} cx="50%" cy="50%" outerRadius={140}>
            {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          </Pie>
          <Tooltip /><Legend />
        </PieChart>
      )}
      {chart.type === 'heatmap' && <HeatmapGrid chart={chart} ds={ds} />}
      {chart.type === 'table' && (
        <div style={{ fontSize: 11, color: '#64748b' }}>Table data exported as CSV.</div>
      )}
    </div>
  )
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface Attachment {
  id: string
  label: string
  sublabel: string
  kind: 'chart' | 'table' | 'pivot' | 'csv'
  checked: boolean
  dsId: string
  dsName: string
}

const kindMeta: Record<Attachment['kind'], {
  icon: React.ReactNode; badge: string
  checkedBg: string; iconBg: string; badgeClass: string
}> = {
  chart: {
    icon: <BarChart2 size={14} />, badge: 'IMAGE',
    checkedBg: 'border-indigo-200 bg-indigo-50/50',
    iconBg: 'bg-indigo-100 text-indigo-600',
    badgeClass: 'bg-indigo-50 text-indigo-600',
  },
  table: {
    icon: <TableProperties size={14} />, badge: 'TABLE',
    checkedBg: 'border-slate-200 bg-slate-50',
    iconBg: 'bg-slate-100 text-slate-600',
    badgeClass: 'bg-slate-100 text-slate-600',
  },
  pivot: {
    icon: <TableProperties size={14} />, badge: 'PIVOT',
    checkedBg: 'border-purple-200 bg-purple-50/40',
    iconBg: 'bg-purple-100 text-purple-600',
    badgeClass: 'bg-purple-50 text-purple-600',
  },
  csv: {
    icon: <FileText size={14} />, badge: 'CSV',
    checkedBg: 'border-emerald-200 bg-emerald-50/40',
    iconBg: 'bg-emerald-100 text-emerald-600',
    badgeClass: 'bg-emerald-50 text-emerald-600',
  },
}

// ─── Detect email addresses from data columns ─────────────────────────────────
function detectEmailsFromData(dsList: DataSource[]): string[] {
  const all: string[] = []
  for (const ds of dsList) {
    const emailCol = ds.columns.find(c =>
      ['email', 'email address', 'recipient', 'e-mail', 'to', 'contact email'].includes(
        c.name.toLowerCase()
      )
    )
    if (!emailCol) continue
    ds.data
      .map(row => String(row[emailCol.name] ?? '').trim())
      .filter(v => v.includes('@') && v.includes('.'))
      .forEach(e => all.push(e))
  }
  return [...new Set(all)].slice(0, 5)
}

// ─── Auto-generate subject ─────────────────────────────────────────────────────
function generateSubject(dsList: DataSource[], reportName: string, hasAlerts: boolean): string {
  if (dsList.length === 0) return 'Report from Rsend'
  if (hasAlerts) return `⚠ Alert: Threshold Breach — ${reportName}`
  if (dsList.length === 1) return `${reportName} — Analytics Report`
  return `Multi-Source Report — ${dsList.map(d => d.name).join(', ')}`
}

// ─── AI email expansion ────────────────────────────────────────────────────────
function expandWithAI(summary: string): string {

  // ── Step 1: Strip surrounding quotes the user may have typed ─────────────
  let text = summary.replace(/^[\s"'""'']+|[\s"'""'']+$/g, '').trim()

  // ── Step 2: Fix common spelling mistakes ──────────────────────────────────
  const TYPOS: [RegExp, string][] = [
    [/\bmanger\b/gi, 'manager'],
    [/\bthershold\b/gi, 'threshold'], [/\btreshhold\b/gi, 'threshold'], [/\btreshold\b/gi, 'threshold'],
    [/\brecieved\b/gi, 'received'],   [/\boccured\b/gi, 'occurred'],
    [/\battension\b/gi, 'attention'], [/\bimidiate\b/gi, 'immediate'], [/\bimmidiate\b/gi, 'immediate'],
    [/\bsignificently\b/gi, 'significantly'], [/\bperfroming\b/gi, 'performing'],
    [/\bappriciate\b/gi, 'appreciate'], [/\breccomend\b/gi, 'recommend'],
    [/\baddtional\b/gi, 'additional'], [/\banalasis\b/gi, 'analysis'],
    [/\bdont\b/gi, "don't"], [/\bcant\b/gi, "can't"], [/\bwont\b/gi, "won't"],
    [/\bnot performing well\b/gi, 'underperforming'],
    [/\bnot performing\b/gi, 'underperforming'],
    [/\bvery low\b/gi, 'significantly below expectations'],
    [/\bsome store\b/gi, 'certain stores'], [/\bsome stores\b/gi, 'certain stores'],
    [/\bi am sharing you\b/gi, 'I am sharing with you'],
    [/\bsharing you\b/gi, 'sharing with you'],
    [/\bplease see\b/gi, 'please review'],
    [/\bhave a look\b/gi, 'review'],
    [/\btake a look\b/gi, 'review'],
    [/\bi need help\b/gi, 'I would appreciate your guidance'],
    [/\bneed help\b/gi, 'require assistance'],
    [/\blet me know how to proceed\b/gi, 'please advise on the next steps'],
    [/\blet me know\b/gi, 'please let me know'],
    [/\bi\b/g, 'I'], [/\bim\b/gi, 'I am'], [/\bu\b/g, 'you'],
  ]
  TYPOS.forEach(([p, r]) => { text = text.replace(p, r) })

  // ── Step 3: Extract recipient name from greeting ──────────────────────────
  const nameMatch = text.match(/^(?:hi|hello|hey|dear|to|greetings)[,.\s]+([a-zA-Z]+)[,.]?\s*/i)
  const recipientName = nameMatch
    ? nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1).toLowerCase()
    : null
  if (nameMatch) text = text.slice(nameMatch[0].length).trim()

  const lower = text.toLowerCase()

  // ── Step 4: Detect audience ───────────────────────────────────────────────
  const isManager = !recipientName && (
    /\bmanager\b/.test(lower) || /\bmanagement\b/.test(lower) ||
    /\bdirector\b/.test(lower) || /\bsupervisor\b/.test(lower) || /\bboss\b/.test(lower)
  )
  const greeting = recipientName
    ? `Dear ${recipientName},`
    : isManager ? 'Dear Manager,' : 'Dear Team,'

  // ── Step 5: Detect intents ────────────────────────────────────────────────
  const intent = {
    sharing:        /\bshar(e|ing)\b/.test(lower) || /\battach(ed|ing)?\b/.test(lower) || /\bsend(ing)?\b/.test(lower),
    underperform:   /\bunderperform/.test(lower) || /\bnot performing\b/.test(lower) || /\bpoor(ly)?\b/.test(lower),
    badNumbers:     /\bnumbers?\b/.test(lower) && (/\bnot (look|great|good)\b/.test(lower) || /\bdon't look good\b/.test(lower) || /\bbad\b/.test(lower) || /\bconcern\b/.test(lower)),
    needsAttention: /\bneed(s)? attention\b/.test(lower) || /\brequire(s)? attention\b/.test(lower) || /\bimmediate\b/.test(lower),
    lowOrders:      /\border/.test(lower) && (/\blow\b/.test(lower) || /\bless\b/.test(lower) || /\bbelow\b/.test(lower)),
    lowSales:       /\bsales?\b/.test(lower) && (/\blow\b/.test(lower) || /\bdecline\b/.test(lower) || /\bdrop\b/.test(lower)),
    wantsGuidance:  /\badvise\b/.test(lower) || /\bguidance\b/.test(lower) || /\bhow to proceed\b/.test(lower) || /\bappreciate\b/.test(lower) || /\bnext steps?\b/.test(lower) || /\brecommend\b/.test(lower),
    storeIssue:     /\bstore/.test(lower) || /\bbranch\b/.test(lower),
    deptIssue:      /\bdepartment/.test(lower) || /\bdept\b/.test(lower) || /\bteam\b/.test(lower),
    distanceIssue:  /\bdistanc/.test(lower) || /\blong from\b/.test(lower),
    threshold:      /\bthreshold\b/.test(lower) || /\bbelow (the )?(expected|target)\b/.test(lower),
    report:         /\breport\b/.test(lower) || /\banalysis\b/.test(lower) || /\bresult\b/.test(lower) || /\bdata\b/.test(lower) || /\bnumbers?\b/.test(lower),
    quarterly:      /\bquarter(ly)?\b/.test(lower) || /\bmonthly\b/.test(lower) || /\bannual\b/.test(lower) || /\bweekly\b/.test(lower),
  }

  // ── Step 6: Build paragraphs ──────────────────────────────────────────────
  const paragraphs: string[] = []

  // Opening sentence — what the email is about
  if (intent.sharing && intent.quarterly && intent.report) {
    paragraphs.push(`I am writing to share the ${lower.includes('quarterly') ? 'quarterly' : lower.includes('monthly') ? 'monthly' : lower.includes('annual') ? 'annual' : 'weekly'} report for your review and consideration.`)
  } else if (intent.sharing && intent.report) {
    paragraphs.push('I am writing to share the attached report for your review and consideration.')
  } else if (intent.report) {
    paragraphs.push('I am reaching out to bring the following findings from our latest analysis to your attention.')
  } else {
    paragraphs.push('I am writing to bring the following matters to your attention.')
  }

  // Core issue paragraph — built from detected signals, combined naturally
  const issues: string[] = []

  if (intent.badNumbers && intent.deptIssue) {
    issues.push('the numbers for certain departments are not looking favourable and require a closer look')
  } else if (intent.badNumbers) {
    issues.push('some of the key metrics are not looking as expected and may warrant further investigation')
  }
  if (intent.underperform && intent.storeIssue) {
    issues.push('a number of stores appear to be underperforming and are not meeting their expected targets')
  } else if (intent.underperform && intent.deptIssue) {
    issues.push('certain departments are underperforming relative to expectations')
  } else if (intent.underperform) {
    issues.push('certain performance metrics are not meeting the expected targets')
  }
  if (intent.needsAttention && intent.storeIssue && !intent.underperform) {
    issues.push('several stores require immediate attention')
  }
  if (intent.lowOrders && intent.storeIssue) {
    issues.push('the order volumes for a number of stores are significantly lower than expected')
  } else if (intent.lowOrders) {
    issues.push('order volumes are considerably below the expected levels')
  }
  if (intent.lowSales) {
    issues.push('sales figures are showing a notable decline that warrants prompt attention')
  }
  if (intent.distanceIssue && intent.storeIssue) {
    issues.push('several store locations are at considerable distances from the main hub, which may be affecting operational efficiency')
  }
  if (intent.threshold && !intent.lowOrders && !intent.badNumbers) {
    issues.push('certain key metrics are currently falling below the defined threshold')
  }

  if (issues.length === 1) {
    paragraphs.push(
      `Upon reviewing the data, it has been noted that ${issues[0]}. This warrants a thorough review and timely action to prevent any further impact on performance.`
    )
  } else if (issues.length >= 2) {
    const last = issues.pop()!
    paragraphs.push(
      `Upon reviewing the data, it has been noted that ${issues.join(', ')}. Additionally, ${last}. These matters require prompt attention to avoid further impact on overall performance.`
    )
  } else if (!intent.sharing && !intent.report) {
    // Pure fallback — reformat the user's cleaned text as-is
    const cleaned = text
      .split(/(?<=[.!?])\s+|\n+/)
      .map(s => s.trim()).filter(s => s.length > 3)
      .map(s => s.charAt(0).toUpperCase() + s.slice(1))
      .map(s => /[.!?]$/.test(s) ? s : s + '.')
      .join(' ')
    if (cleaned) paragraphs.push(cleaned)
  }

  // Guidance / next steps paragraph
  if (intent.wantsGuidance) {
    paragraphs.push(
      'I would greatly appreciate your insights and recommendations on the best course of action to address these concerns. Please advise on the next steps at your earliest convenience.'
    )
  }

  // ── Step 7: Closing ───────────────────────────────────────────────────────
  const hasUrgent = intent.needsAttention || intent.underperform || intent.lowOrders || intent.lowSales || intent.badNumbers
  const closing = hasUrgent
    ? 'Please find the attached report for further details. Do not hesitate to reach out should you require any clarification or additional analysis.'
    : 'Please find the attached report for your reference and feel free to reach out if you have any questions.'

  return `${greeting}

I hope this message finds you well.

${paragraphs.join('\n\n')}

${closing}

Best regards,
Rsend Analytics`
}

// ─── Build attachment list ─────────────────────────────────────────────────────
function buildAttachments(ds: DataSource, charts: ChartConfig[]): Attachment[] {
  const items: Attachment[] = []
  charts.forEach(c => {
    items.push({
      id: `${ds.id}__${c.id}`,
      label: c.title,
      sublabel: c.type === 'table'
        ? 'Data table — uploaded as CSV via Cloudinary'
        : `${c.type} chart — link included in email`,
      kind: c.type === 'table' ? 'table' : 'chart',
      checked: true,
      dsId: ds.id,
      dsName: ds.name,
    })
  })
  ds.subSheets?.forEach(s => {
    items.push({
      id: `${ds.id}__sub_${s.name}`,
      label: s.name,
      sublabel: `${s.data.length} rows — uploaded as CSV via Cloudinary`,
      kind: 'pivot',
      checked: true,
      dsId: ds.id,
      dsName: ds.name,
    })
  })
  if (ds.data.length > 0) {
    items.push({
      id: `${ds.id}__raw_csv`,
      label: `${ds.name} — Raw Data`,
      sublabel: `${ds.data.length} rows · ${ds.columns.length} columns — uploaded as CSV via Cloudinary`,
      kind: 'csv',
      checked: false,
      dsId: ds.id,
      dsName: ds.name,
    })
  }
  return items
}

// ─── Recipient chips input ────────────────────────────────────────────────────
interface RecipientInputProps {
  label: string
  recipients: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  highlight?: boolean
}

function RecipientInput({ label, recipients, onChange, placeholder, highlight }: RecipientInputProps) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function addEmail(raw: string) {
    const email = raw.trim().toLowerCase()
    if (!email) return
    if (!email.includes('@') || !email.includes('.')) {
      setError(`"${email}" doesn't look like a valid email.`)
      setTimeout(() => setError(''), 3000)
      return
    }
    if (recipients.includes(email)) { setInput(''); return }
    onChange([...recipients, email])
    setInput('')
    setError('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addEmail(input)
    } else if (e.key === 'Backspace' && !input && recipients.length > 0) {
      onChange(recipients.slice(0, -1))
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</label>
        {highlight && recipients.length === 0 && (
          <span className="text-xs text-amber-500 flex items-center gap-1">
            <AlertCircle size={11} /> Required
          </span>
        )}
      </div>
      <div
        onClick={() => inputRef.current?.focus()}
        className={`flex flex-wrap gap-1.5 px-3 py-2 border rounded-lg cursor-text min-h-[42px] transition-colors focus-within:ring-2 focus-within:ring-indigo-400 focus-within:border-transparent ${
          error ? 'border-red-300' : 'border-slate-200'
        }`}
      >
        {recipients.map(email => (
          <span
            key={email}
            className="flex items-center gap-1 px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-xs font-medium max-w-[200px]"
          >
            <span className="truncate">{email}</span>
            <button
              onClick={e => { e.stopPropagation(); onChange(recipients.filter(r => r !== email)) }}
              className="text-indigo-400 hover:text-indigo-700 ml-0.5 shrink-0"
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (input.trim()) addEmail(input) }}
          placeholder={recipients.length === 0 ? (placeholder ?? 'Add email…') : ''}
          className="flex-1 min-w-[140px] text-sm text-slate-700 placeholder-slate-400 outline-none bg-transparent"
        />
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

// ─── Toast ────────────────────────────────────────────────────────────────────
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
          {t.kind === 'success' ? <Check size={15} className="mt-0.5 shrink-0" /> : <AlertCircle size={15} className="mt-0.5 shrink-0" />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
type SendState = 'idle' | 'sending' | 'sent'

export default function Mail() {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()
  const user = state.user
  const { toasts, show: showToast } = useToast()

  // ── Draft persistence ──
  const draftKey = `rsend_mail_draft_${user?.email ?? 'guest'}`
  function readDraft(): Record<string, unknown> {
    try { return JSON.parse(localStorage.getItem(draftKey) ?? '{}') } catch { return {} }
  }
  function clearDraft() { try { localStorage.removeItem(draftKey) } catch { } }

  // ── Data sources (multi-select) ──
  const [selectedDsIds, setSelectedDsIds] = useState<Set<string>>(() => {
    const d = readDraft()
    const arr = d.selectedDsIds as string[] | undefined
    if (Array.isArray(arr) && arr.length > 0) {
      const valid = arr.filter(id => state.dataSources.some(ds => ds.id === id))
      if (valid.length > 0) return new Set(valid)
    }
    const defaultId = state.activeDataSourceId ?? state.dataSources[0]?.id ?? ''
    return defaultId ? new Set([defaultId]) : new Set()
  })

  function toggleDs(id: string) {
    setSelectedDsIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        if (next.size === 1) return prev  // must keep at least one selected
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const allSelectedDs = useMemo(
    () => state.dataSources.filter(d => selectedDsIds.has(d.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.dataSources, [...selectedDsIds].join(',')]
  )

  const allCharts = useMemo(() => {
    return allSelectedDs.flatMap(ds => {
      const lastReport = state.reports
        .filter(r => r.dataSourceId === ds.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
      return lastReport?.charts ?? []
    })
  }, [allSelectedDs, state.reports])

  // For subject auto-generate and single-source display info
  const primaryDs = allSelectedDs[0] ?? null
  const primaryLastReport = useMemo(
    () => primaryDs
      ? state.reports
          .filter(r => r.dataSourceId === primaryDs.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
      : null,
    [state.reports, primaryDs]
  )

  const hasAlerts = state.alerts.some(a => a.enabled && selectedDsIds.has(a.dataSourceId))

  // ── Recipients ──
  const detectedEmails = useMemo(() => detectEmailsFromData(allSelectedDs), [allSelectedDs])
  const [toList, setToList] = useState<string[]>(() => {
    const d = readDraft(); return Array.isArray(d.toList) ? d.toList as string[] : (user?.email ? [user.email] : [])
  })
  const [ccList, setCcList] = useState<string[]>(() => {
    const d = readDraft(); return Array.isArray(d.ccList) ? d.ccList as string[] : []
  })
  const [bccList, setBccList] = useState<string[]>(() => {
    const d = readDraft(); return Array.isArray(d.bccList) ? d.bccList as string[] : []
  })
  const [showCc, setShowCc] = useState<boolean>(() => { const d = readDraft(); return Boolean(d.showCc) })
  const [showBcc, setShowBcc] = useState<boolean>(() => { const d = readDraft(); return Boolean(d.showBcc) })

  // ── Subject ──
  const [subject, setSubject] = useState<string>(() => { const d = readDraft(); return (d.subject as string) ?? '' })

  // ── Body ──
  const [summary, setSummary] = useState<string>(() => { const d = readDraft(); return (d.summary as string) ?? '' })
  const [fullBody, setFullBody] = useState<string>(() => { const d = readDraft(); return (d.fullBody as string) ?? '' })
  const [expandState, setExpandState] = useState<'idle' | 'loading' | 'done'>('idle')
  const [showPreview, setShowPreview] = useState(false)

  // ── Attachments ──
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [editingAttId, setEditingAttId]   = useState<string | null>(null)
  const [editingLabel, setEditingLabel]   = useState('')

  // refs to hidden chart divs (keyed by chart id) for PNG capture
  const chartDivRefs = useRef<Record<string, HTMLDivElement | null>>({})

  function commitRename(id: string) {
    const label = editingLabel.trim()
    if (label) setAttachments(prev => prev.map(a => a.id === id ? { ...a, label } : a))
    setEditingAttId(null)
  }

  // ── Captured visuals for all selected data sources ──
  const dsCaptures = state.capturedVisuals.filter(v => selectedDsIds.has(v.dataSourceId))
  const [selectedVisualIds, setSelectedVisualIds] = useState<Set<string>>(() => {
    const d = readDraft(); return new Set(Array.isArray(d.selectedVisualIds) ? d.selectedVisualIds as string[] : [])
  })

  // ── Persist draft on every relevant change ──
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const selectedDsKey = [...selectedDsIds].sort().join(',')
  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({
        selectedDsIds: [...selectedDsIds], toList, ccList, bccList, showCc, showBcc,
        subject, summary, fullBody,
        selectedVisualIds: [...selectedVisualIds],
      }))
    } catch { }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDsKey, toList, ccList, bccList, showCc, showBcc, subject, summary, fullBody, selectedVisualIds])

  function toggleVisual(id: string) {
    setSelectedVisualIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── User file attachments ──
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [userFiles, setUserFiles] = useState<UserFile[]>(() => {
    const d = readDraft()
    const persisted = d.uploadedFiles as { id: string; name: string; url: string }[] | undefined
    if (!Array.isArray(persisted) || persisted.length === 0) return []
    // Restore previously-uploaded files as pre-done entries (no re-upload needed)
    return persisted.map(f => ({
      id: f.id,
      file: new File([], f.name, { type: 'application/octet-stream' }),
      status: 'done' as const,
      progress: 100,
      url: f.url,
    }))
  })

  // Persist uploaded files separately (File objects can't be in the main draft effect)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey)
      const draft: Record<string, unknown> = raw ? JSON.parse(raw) : {}
      draft.uploadedFiles = userFiles
        .filter(f => f.status === 'done' && f.url)
        .map(f => ({ id: f.id, name: f.file.name, url: f.url! }))
      localStorage.setItem(draftKey, JSON.stringify(draft))
    } catch { }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userFiles])

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    setUserFiles(prev => {
      const existingNames = new Set(prev.map(f => f.file.name))
      const next = picked
        .filter(f => !existingNames.has(f.name))
        .map(f => ({
          id: `${f.name}_${f.size}`,
          file: f,
          status: f.size > HARD_LIMIT_MB * MB
            ? ('oversized' as const)
            : ('pending' as const),
          progress: 0,
        }))
      return [...prev, ...next]
    })
  }

  function removeUserFile(id: string) {
    setUserFiles(prev => prev.filter(f => f.id !== id))
  }

  function updateFile(id: string, patch: Partial<UserFile>) {
    setUserFiles(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f))
  }

  async function uploadAllFiles(): Promise<{ name: string; url: string }[]> {
    const config = state.cloudinaryConfig
    const results: { name: string; url: string }[] = []

    for (const uf of userFiles) {
      if (uf.status === 'oversized') continue
      if (uf.status === 'done' && uf.url) {
        results.push({ name: uf.file.name, url: uf.url })
        continue
      }
      if (!config) {
        if (uf.file.size > CLOUD_THRESHOLD_MB * MB) {
          updateFile(uf.id, { status: 'error', errorMsg: 'Cloudinary required for files >25 MB' })
          continue
        }
        continue
      }
      updateFile(uf.id, { status: 'uploading', progress: 0 })
      try {
        const url = await uploadToCloudinary(uf.file, config, pct =>
          updateFile(uf.id, { progress: pct })
        )
        updateFile(uf.id, { status: 'done', url, progress: 100 })
        results.push({ name: uf.file.name, url })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        updateFile(uf.id, { status: 'error', errorMsg: msg })
      }
    }
    return results
  }

  // ── Send ──
  const [sendState, setSendState] = useState<SendState>('idle')
  const [sendError, setSendError] = useState('')
  const [showValidation, setShowValidation] = useState(false)

  // Rebuild attachments when selected sources or reports change
  useEffect(() => {
    setAttachments(
      allSelectedDs.flatMap(ds => {
        const lastReport = state.reports
          .filter(r => r.dataSourceId === ds.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
        return buildAttachments(ds, lastReport?.charts ?? [])
      })
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDsKey, state.reports])

  function addDetectedEmail(email: string) {
    if (!toList.includes(email)) setToList(prev => [...prev, email])
  }

  // ── AI Expand ──
  function handleExpand() {
    if (!summary.trim()) return
    setExpandState('loading')
    setTimeout(() => {
      try {
        const expanded = expandWithAI(summary)
        setFullBody(expanded)
        setExpandState('done')
      } catch {
        setExpandState('idle')
      }
    }, 1600)
  }

  // ── Attachments toggle ──
  function toggleAttachment(id: string) {
    setAttachments(prev => prev.map(a => a.id === id ? { ...a, checked: !a.checked } : a))
  }

  const selectedAttachments = attachments.filter(a => a.checked)
  const canSend = (
    sendState === 'idle' &&
    toList.length > 0 &&
    subject.trim().length > 0 &&
    (fullBody.trim().length > 0 || summary.trim().length > 0)
  )

  async function handleSend() {
    if (!canSend) { setShowValidation(true); return }
    if (!state.emailjsConfig) {
      setSendError('EmailJS is not configured. Go to Settings → Email Integration to set it up.')
      return
    }
    setSendError('')
    setSendState('sending')

    // 1. Upload user-picked files
    let uploadedLinks: { name: string; url: string }[] = []
    try {
      uploadedLinks = await uploadAllFiles()
    } catch {
      // non-fatal
    }

    // 2. Generate + upload checked report attachments
    const reportLinks: { name: string; url: string }[] = []
    if (state.cloudinaryConfig) {
      for (const att of selectedAttachments) {
        const slug = att.label.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_.-]/g, '')
        try {
          let blob: Blob | null = null
          let filename = ''

          const attDs = allSelectedDs.find(d => d.id === att.dsId) ?? null
          if (att.kind === 'chart') {
            const el = chartDivRefs.current[att.id]
            if (el) {
              blob = await captureElementAsPng(el)
              filename = `${slug}.png`
            }
          } else if (att.kind === 'csv' && attDs) {
            blob = new Blob([toCSV(attDs.data, attDs.columns)], { type: 'text/csv' })
            filename = `${slug}_raw_data.csv`
          } else if (att.kind === 'pivot' && attDs) {
            const sheetName = att.id.replace(/^.*?sub_/, '')
            const sub = attDs.subSheets?.find(s => s.name === sheetName)
            if (sub) {
              blob = new Blob([toCSV(sub.data, sub.columns)], { type: 'text/csv' })
              filename = `${slug}.csv`
            }
          } else if (att.kind === 'table' && attDs) {
            blob = new Blob([toCSV(attDs.data, attDs.columns)], { type: 'text/csv' })
            filename = `${slug}.csv`
          }

          if (blob && filename) {
            const url = await uploadBlobToCloudinary(blob, filename, state.cloudinaryConfig)
            reportLinks.push({ name: att.label, url })
          }
        } catch {
          // skip failed upload, don't block the send
        }
      }
    }

    // 2b. Upload selected captured visuals to Cloudinary
    const visualImgTags: string[] = []
    if (state.cloudinaryConfig && selectedVisualIds.size > 0) {
      for (const v of dsCaptures.filter(v => selectedVisualIds.has(v.id))) {
        try {
          const res = await fetch(v.imageDataUrl)
          const blob = await res.blob()
          const slug = v.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_.-]/g, '')
          const url = await uploadBlobToCloudinary(blob, `${slug}.png`, state.cloudinaryConfig)
          visualImgTags.push(
            `<div style="margin:12px 0"><p style="font-family:sans-serif;font-size:13px;font-weight:600;margin:0 0 6px">${v.name}</p>`
            + `<img src="${url}" alt="${v.name}" style="max-width:100%;border-radius:8px;border:1px solid #e2e8f0" /></div>`
          )
        } catch { /* skip failed visual */ }
      }
    }

    // 3. Build body + clickable attachment links (sent as HTML via attachments_info)
    const allLinks = [...reportLinks, ...uploadedLinks]
    const visualsHtml = visualImgTags.length > 0
      ? '<p style="margin:16px 0 6px;font-family:sans-serif;font-size:14px"><strong>Charts & Visuals:</strong></p>'
        + visualImgTags.join('')
      : ''
    const attachmentsHtml = allLinks.length > 0
      ? '<p style="margin:16px 0 6px;font-family:sans-serif;font-size:14px"><strong>Downloadable Files:</strong></p>'
        + '<ul style="margin:0;padding-left:20px;font-family:sans-serif;font-size:14px">'
        + allLinks.map(f =>
            `<li style="margin:5px 0"><a href="${f.url}" style="color:#4f46e5;text-decoration:underline">${f.name}</a></li>`
          ).join('')
        + '</ul>'
      : ''

    const body = fullBody.trim() || summary.trim()

    try {
      for (const recipient of toList) {
        await emailjs.send(
          state.emailjsConfig.serviceId,
          state.emailjsConfig.templateId,
          {
            to_email: recipient,
            from_name: user?.name ?? 'Rsend',
            reply_to: user?.email ?? recipient,
            subject,
            message: body,
            attachments_info: visualsHtml + attachmentsHtml,
            cc_email: ccList.join(', '),
            bcc_email: bccList.join(', '),
          },
          state.emailjsConfig.publicKey,
        )
      }
      setSendState('sent')
      clearDraft()
      setUserFiles([])
      showToast(`Email sent to ${toList.join(', ')}!`)
      setTimeout(() => setSendState('idle'), 4000)
    } catch (err: unknown) {
      setSendState('idle')
      const msg = err instanceof Error ? err.message : String(err)
      setSendError(`Send failed: ${msg}. Check your EmailJS config in Settings.`)
    }
  }

  // ── No sources ──
  if (state.dataSources.length === 0) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Send Mail</h1>
        <p className="text-slate-500 text-sm mb-8">Compose and send reports directly to any email address.</p>
        <div className="flex flex-col items-center justify-center py-24 bg-white rounded-2xl border border-dashed border-slate-200">
          <MailIcon size={40} className="text-slate-200 mb-4" />
          <p className="text-slate-500 font-medium">No data sources connected</p>
          <p className="text-slate-400 text-sm mt-1">Go to <strong>Import Data</strong> first, then come back to send reports.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-6xl mx-auto pb-12">
      <ToastContainer toasts={toasts} />

      {/* Header */}
      <div className="mb-7 pb-6 border-b border-slate-200/70">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Delivery</p>
        <h1 className="text-2xl font-bold text-slate-800">Send Mail</h1>
        <p className="text-slate-500 text-sm mt-1">
          Compose a professional report email with AI-expanded body, chart images, and data attachments.
        </p>
      </div>

      {/* EmailJS not configured warning */}
      {!state.emailjsConfig && (
        <div className="flex items-center gap-3 px-5 py-4 bg-amber-50 border border-amber-200 rounded-2xl mb-6">
          <AlertCircle size={18} className="text-amber-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">Email delivery not configured</p>
            <p className="text-xs text-amber-600 mt-0.5">
              Set up EmailJS in Settings to actually deliver emails to inboxes. Without it, sending will fail.
            </p>
          </div>
          <button
            onClick={() => navigate('/settings')}
            className="flex items-center gap-1.5 px-3 py-2 bg-amber-100 hover:bg-amber-200 text-amber-800 text-xs font-semibold rounded-lg transition-colors shrink-0"
          >
            <SettingsIcon size={12} />
            Go to Settings
          </button>
        </div>
      )}

      <div className="grid grid-cols-5 gap-6 items-start">

        {/* ── LEFT: Compose ── */}
        <div className="col-span-3 space-y-4">

          {/* ── Card 1: Recipients ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-5 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Users size={15} className="text-indigo-500" />
              <h2 className="text-sm font-semibold text-slate-700">Recipients</h2>
            </div>

            <RecipientInput
              label="To"
              recipients={toList}
              onChange={setToList}
              placeholder="Type email and press Enter"
              highlight={showValidation}
            />

            {/* Detected emails suggestion */}
            {detectedEmails.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-slate-400 shrink-0">Auto-detected from data:</p>
                {detectedEmails.map(email => (
                  <button
                    key={email}
                    onClick={() => addDetectedEmail(email)}
                    disabled={toList.includes(email)}
                    className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border transition-colors disabled:opacity-40 disabled:cursor-default border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                  >
                    <Plus size={10} />
                    {email}
                  </button>
                ))}
              </div>
            )}

            {/* CC / BCC toggles */}
            <div className="flex gap-2">
              <button
                onClick={() => setShowCc(v => !v)}
                className={`text-xs px-2.5 py-1 rounded-lg font-medium border transition-colors ${
                  showCc ? 'border-indigo-200 bg-indigo-50 text-indigo-600' : 'border-slate-200 text-slate-500 hover:border-indigo-200'
                }`}
              >
                {showCc ? 'Hide CC' : '+ CC'}
              </button>
              <button
                onClick={() => setShowBcc(v => !v)}
                className={`text-xs px-2.5 py-1 rounded-lg font-medium border transition-colors ${
                  showBcc ? 'border-indigo-200 bg-indigo-50 text-indigo-600' : 'border-slate-200 text-slate-500 hover:border-indigo-200'
                }`}
              >
                {showBcc ? 'Hide BCC' : '+ BCC'}
              </button>
            </div>

            {showCc && (
              <RecipientInput
                label="CC"
                recipients={ccList}
                onChange={setCcList}
                placeholder="Add CC recipients…"
              />
            )}
            {showBcc && (
              <RecipientInput
                label="BCC"
                recipients={bccList}
                onChange={setBccList}
                placeholder="Add BCC recipients…"
              />
            )}
          </div>

          {/* ── Card 2: Data Source + Subject ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <AtSign size={15} className="text-indigo-500" />
              <h2 className="text-sm font-semibold text-slate-700">Subject & Source</h2>
            </div>

            {/* Data source multi-select */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Data Sources
                </label>
                <span className="text-xs text-slate-400">{selectedDsIds.size} selected · {allCharts.length} charts</span>
              </div>
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {state.dataSources.map(d => {
                  const checked = selectedDsIds.has(d.id)
                  const dsLastReport = state.reports
                    .filter(r => r.dataSourceId === d.id)
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
                  const dsChartCount = (dsLastReport?.charts ?? d.charts ?? []).length
                  return (
                    <label
                      key={d.id}
                      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                        checked ? 'border-indigo-200 bg-indigo-50/60' : 'border-slate-100 hover:border-indigo-100 bg-white'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDs(d.id)}
                        className="rounded accent-indigo-600 shrink-0"
                      />
                      <span className="text-sm text-slate-700 font-medium flex-1 truncate">{d.name}</span>
                      <span className="text-xs text-slate-400 shrink-0">
                        {dsChartCount > 0
                          ? `${dsChartCount} chart${dsChartCount > 1 ? 's' : ''}`
                          : `${d.data.length.toLocaleString()} rows`}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>

            {/* Subject */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Subject</label>
                <button
                  onClick={() => setSubject(generateSubject(allSelectedDs, primaryLastReport?.name ?? 'Report', hasAlerts))}
                  className="text-xs text-indigo-500 hover:text-indigo-700 flex items-center gap-1"
                >
                  <RefreshCw size={10} /> Auto-generate
                </button>
              </div>
              <input
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="e.g. Weekly Sales Report: Threshold Alert"
                className="w-full border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              {hasAlerts && (
                <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                  <AlertCircle size={11} /> Alert detected — subject updated to reflect threshold breach.
                </p>
              )}
            </div>
          </div>

          {/* ── Card 3: Body Composition ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-5 space-y-4">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="text-indigo-500" />
                <h2 className="text-sm font-semibold text-slate-700">Email Body</h2>
              </div>
              {fullBody && (
                <button
                  onClick={() => setShowPreview(v => !v)}
                  className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-indigo-600 transition-colors"
                >
                  {showPreview ? <EyeOff size={13} /> : <Eye size={13} />}
                  {showPreview ? 'Hide preview' : 'Preview email'}
                </button>
              )}
            </div>

            {/* Step 1: Short summary */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Step 1 — Write a short summary <span className="text-slate-400 font-normal normal-case">(1–3 sentences)</span>
              </label>
              <textarea
                value={summary}
                onChange={e => setSummary(e.target.value)}
                placeholder="e.g. Sales have dropped by 15% this week compared to last month. The electronics category is the most affected with a 20% decline."
                rows={3}
                className="w-full border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
              />
              <div className="flex items-center gap-2 mt-2.5">
                <button
                  onClick={handleExpand}
                  disabled={!summary.trim() || expandState === 'loading'}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-all shadow-sm"
                >
                  {expandState === 'loading' ? (
                    <><RefreshCw size={12} className="animate-spin" /> Expanding…</>
                  ) : (
                    <><Sparkles size={12} /> {expandState === 'done' ? 'Re-expand with AI' : 'Expand with AI'}</>
                  )}
                </button>
                <p className="text-xs text-slate-400">
                  AI will expand your summary into a professional email
                </p>
              </div>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-slate-100" />
              <span className="text-xs text-slate-400">or write the full body directly</span>
              <div className="flex-1 h-px bg-slate-100" />
            </div>

            {/* Step 2: Full body (pre-filled by AI or manual) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Step 2 — Full Email Body
                  {expandState === 'done' && (
                    <span className="ml-2 text-xs font-normal text-indigo-500 normal-case">✓ AI-generated — edit freely</span>
                  )}
                </label>
              </div>
              <textarea
                value={fullBody}
                onChange={e => setFullBody(e.target.value)}
                placeholder="Write your full email body here, or use 'Expand with AI' above to generate it from your summary."
                rows={10}
                className={`w-full border rounded-lg px-3.5 py-3 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none transition-colors ${
                  expandState === 'done' ? 'border-indigo-200 bg-indigo-50/20' : 'border-slate-200'
                }`}
              />
            </div>

            {/* Email preview panel */}
            {showPreview && fullBody && (
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                  <p className="text-xs font-semibold text-slate-500">Email Preview</p>
                </div>
                <div className="p-4 bg-white">
                  <p className="text-xs text-slate-400 mb-1">To: <span className="text-slate-600 font-medium">{toList.join(', ') || '—'}</span></p>
                  {ccList.length > 0 && <p className="text-xs text-slate-400 mb-1">CC: <span className="text-slate-600 font-medium">{ccList.join(', ')}</span></p>}
                  <p className="text-xs text-slate-400 mb-3">Subject: <span className="text-slate-700 font-semibold">{subject}</span></p>
                  <div className="border-t border-slate-100 pt-3">
                    <pre className="text-xs text-slate-600 whitespace-pre-wrap font-sans leading-relaxed">{fullBody}</pre>
                  </div>
                  {selectedAttachments.length > 0 && (
                    <div className="border-t border-slate-100 mt-3 pt-3 flex flex-wrap gap-2">
                      {selectedAttachments.map(a => (
                        <span key={a.id} className="flex items-center gap-1 text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded-lg">
                          <Paperclip size={10} />
                          {a.label.slice(0, 25)}{a.label.length > 25 ? '…' : ''} ({kindMeta[a.kind].badge})
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Send button ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-5">
            {sendError && (
              <div className="flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg mb-4 text-xs text-red-700">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <p>{sendError}</p>
              </div>
            )}
            {showValidation && !canSend && (
              <div className="flex items-start gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg mb-4 text-xs text-amber-700">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Cannot send yet:</p>
                  <ul className="mt-1 space-y-0.5 list-disc list-inside">
                    {toList.length === 0 && <li>Add at least one recipient</li>}
                    {!subject.trim() && <li>Subject line is required</li>}
                    {!fullBody.trim() && !summary.trim() && <li>Write a message body or summary</li>}
                  </ul>
                </div>
              </div>
            )}
            <button
              onClick={handleSend}
              disabled={sendState !== 'idle'}
              className="flex items-center justify-center gap-2.5 w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
            >
              {sendState === 'sending' ? (
                <><RefreshCw size={16} className="animate-spin" /> Sending email…</>
              ) : sendState === 'sent' ? (
                <><Check size={16} /> Email Sent!</>
              ) : (
                <>
                  <Send size={16} />
                  Send to {toList.length > 0 ? toList.slice(0, 2).join(', ') + (toList.length > 2 ? ` +${toList.length - 2}` : '') : 'recipients'}
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── RIGHT: Attachments ── */}
        <div className="col-span-2">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Paperclip size={14} className="text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-700">Attachments</h2>
              <span className="ml-auto text-xs text-slate-400">
                {selectedAttachments.length} of {attachments.length} selected
              </span>
            </div>

            {/* Cloud storage warning */}
            {attachments.length > 0 && !state.cloudinaryConfig && (
              <div className="flex items-start gap-2 px-3 py-2.5 mb-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
                <AlertCircle size={13} className="shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Cloud storage not configured</p>
                  <p className="mt-0.5">Files won't be uploaded. <button onClick={() => navigate('/settings')} className="underline font-medium">Set up Cloudinary →</button></p>
                </div>
              </div>
            )}

            {attachments.length === 0 ? (
              <div className="text-center py-10">
                <BarChart2 size={28} className="mx-auto text-slate-200 mb-2" />
                <p className="text-sm text-slate-500">No attachments available.</p>
                <p className="text-xs text-slate-400 mt-1">Generate a report first in <strong>Reports</strong>.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {attachments.map(att => {
                  const meta = kindMeta[att.kind]
                  const isEditing = editingAttId === att.id
                  return (
                    <div
                      key={att.id}
                      className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                        att.checked ? meta.checkedBg : 'border-slate-100 bg-white'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={att.checked}
                        onChange={() => toggleAttachment(att.id)}
                        className="rounded accent-indigo-600 mt-1 shrink-0 cursor-pointer"
                      />
                      <span className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${meta.iconBg}`}>
                        {meta.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <input
                            autoFocus
                            value={editingLabel}
                            onChange={e => setEditingLabel(e.target.value)}
                            onBlur={() => commitRename(att.id)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') commitRename(att.id)
                              if (e.key === 'Escape') setEditingAttId(null)
                            }}
                            className="w-full text-xs font-semibold text-slate-700 border border-indigo-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                          />
                        ) : (
                          <div className="flex items-center gap-1 group">
                            <p className="text-xs font-semibold text-slate-700 truncate">{att.label}</p>
                            <button
                              onClick={() => { setEditingAttId(att.id); setEditingLabel(att.label) }}
                              className="text-slate-300 hover:text-indigo-500 shrink-0"
                              title="Rename"
                            >
                              <Pencil size={10} />
                            </button>
                          </div>
                        )}
                        <p className="text-xs text-slate-400 leading-tight mt-0.5">{att.sublabel}</p>
                        {selectedDsIds.size > 1 && (
                          <p className="text-[10px] text-indigo-400 mt-0.5 truncate">from {att.dsName}</p>
                        )}
                      </div>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-bold shrink-0 ${meta.badgeClass}`}>
                        {meta.badge}
                      </span>
                    </div>
                  )
                })}
              </div>

            )}

            {selectedAttachments.length > 0 && (
              <div className="mt-4 px-3 py-2.5 bg-indigo-50 rounded-xl">
                <p className="text-xs font-semibold text-indigo-700 mb-1.5">Email will include:</p>
                <div className="space-y-1">
                  {selectedAttachments.map(a => (
                    <div key={a.id} className="flex items-center gap-1.5">
                      <Check size={10} className="text-indigo-500 shrink-0" />
                      <span className="text-xs text-indigo-600 truncate">{a.label}</span>
                      <span className={`text-xs px-1 rounded font-bold ml-auto ${kindMeta[a.kind].badgeClass}`}>
                        {kindMeta[a.kind].badge}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          {/* Hidden off-screen chart renderers — captured as PNG on send */}
          {attachments.filter(a => a.kind === 'chart' && a.checked).map(att => {
            // att.id is `${dsId}__${chartId}` — strip the prefix using the known dsId length
            const chartOriginalId = att.id.slice(att.dsId.length + 2)
            const chart = allCharts.find(c => c.id === chartOriginalId)
            const chartDs = allSelectedDs.find(d => d.id === att.dsId) ?? null
            if (!chart) return null
            return (
              <HiddenChart
                key={att.id}
                chart={chart}
                ds={chartDs}
                divRef={el => { chartDivRefs.current[att.id] = el }}
              />
            )
          })}
          </div>

          {/* ── Captured Visuals Card ── */}
          {dsCaptures.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-5 mt-4">
              <div className="flex items-center gap-2 mb-3">
                <Image size={14} className="text-purple-500" />
                <h2 className="text-sm font-semibold text-slate-700">Captured Visuals</h2>
                <span className="text-xs text-slate-400 font-normal">— select to embed in email</span>
                {selectedDsIds.size > 1 && (
                  <span className="text-xs text-indigo-400 font-normal">({selectedDsIds.size} sources)</span>
                )}
                {!state.cloudinaryConfig && (
                  <span className="ml-auto text-xs text-amber-500">Cloudinary required to send</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {dsCaptures.map(v => {
                  const selected = selectedVisualIds.has(v.id)
                  return (
                    <div
                      key={v.id}
                      onClick={() => toggleVisual(v.id)}
                      className={`relative rounded-lg overflow-hidden border-2 cursor-pointer transition-all ${
                        selected ? 'border-indigo-500 shadow-md' : 'border-slate-200 hover:border-indigo-200'
                      }`}
                    >
                      <img src={v.imageDataUrl} alt={v.name} className="w-full h-28 object-cover" />
                      {selected && (
                        <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-indigo-600 rounded-full flex items-center justify-center">
                          <Check size={11} className="text-white" />
                        </div>
                      )}
                      <div className="px-2 py-1.5">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs text-slate-600 font-medium truncate">{v.name}</span>
                          <button
                            onClick={e => { e.stopPropagation(); dispatch({ type: 'REMOVE_CAPTURED_VISUAL', payload: v.id }) }}
                            className="shrink-0 text-slate-300 hover:text-red-500 transition-colors"
                            title="Delete visual"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                        {selectedDsIds.size > 1 && (
                          <p className="text-[10px] text-slate-400 truncate mt-0.5">
                            {state.dataSources.find(d => d.id === v.dataSourceId)?.name ?? ''}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              {selectedVisualIds.size > 0 && (
                <p className="text-xs text-indigo-600 mt-2">
                  {selectedVisualIds.size} visual{selectedVisualIds.size > 1 ? 's' : ''} will be embedded as images in the email
                </p>
              )}
            </div>
          )}

          {/* ── File Upload Card ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-5 mt-4">
            <div className="flex items-center gap-2 mb-3">
              <Upload size={14} className="text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-700">Add Files</h2>
              <span className="text-xs text-slate-400 font-normal">— charts, visuals & additional files</span>
              {state.cloudinaryConfig ? (
                <span className="ml-auto flex items-center gap-1 text-xs text-emerald-600">
                  <Cloud size={11} /> Cloud ready
                </span>
              ) : (
                <span className="ml-auto text-xs text-amber-500">No cloud — max 25 MB</span>
              )}
            </div>

            {/* Drop zone / picker */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 rounded-xl py-5 flex flex-col items-center gap-2 text-slate-400 hover:text-indigo-500 transition-colors"
            >
              <Upload size={20} />
              <p className="text-xs font-medium">Click to select files</p>
              <p className="text-xs text-slate-300">
                {state.cloudinaryConfig ? 'Up to 100 MB per file' : 'Up to 25 MB per file'}
              </p>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />

            {/* File list */}
            {userFiles.length > 0 && (
              <div className="mt-3 space-y-2">
                {userFiles.map(uf => {
                  const sizeMB = (uf.file.size / MB).toFixed(1)
                  const isOversized = uf.status === 'oversized'
                  const needsCloud = !isOversized && uf.file.size > CLOUD_THRESHOLD_MB * MB && !state.cloudinaryConfig

                  return (
                    <div
                      key={uf.id}
                      className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs ${
                        isOversized ? 'border-red-200 bg-red-50' :
                        needsCloud ? 'border-amber-200 bg-amber-50' :
                        uf.status === 'error' ? 'border-red-200 bg-red-50' :
                        uf.status === 'done' ? 'border-emerald-200 bg-emerald-50/50' :
                        'border-slate-100 bg-slate-50'
                      }`}
                    >
                      {/* Icon */}
                      <div className={`mt-0.5 shrink-0 ${
                        isOversized || uf.status === 'error' ? 'text-red-400' :
                        uf.status === 'done' ? 'text-emerald-500' :
                        needsCloud ? 'text-amber-500' : 'text-slate-400'
                      }`}>
                        {uf.status === 'done'
                          ? <Link size={13} />
                          : isOversized || uf.status === 'error'
                          ? <AlertCircle size={13} />
                          : <FileText size={13} />}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-700 truncate">{uf.file.name}</p>
                        <p className="text-slate-400 mt-0.5">{sizeMB} MB</p>

                        {isOversized && (
                          <p className="text-red-500 mt-1">
                            Exceeds {HARD_LIMIT_MB} MB limit. Please compress or split the file.
                          </p>
                        )}
                        {needsCloud && (
                          <p className="text-amber-600 mt-1">
                            &gt;25 MB — configure Cloudinary in Settings to send this file.
                          </p>
                        )}
                        {uf.status === 'uploading' && (
                          <div className="mt-1.5">
                            <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-indigo-500 rounded-full transition-all"
                                style={{ width: `${uf.progress}%` }}
                              />
                            </div>
                            <p className="text-indigo-500 mt-1">Uploading… {uf.progress}%</p>
                          </div>
                        )}
                        {uf.status === 'done' && uf.url && (
                          <a
                            href={uf.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-emerald-600 underline mt-1 block truncate"
                          >
                            {uf.url.slice(0, 40)}…
                          </a>
                        )}
                        {uf.status === 'error' && (
                          <p className="text-red-500 mt-1">{uf.errorMsg}</p>
                        )}
                      </div>

                      {/* Size badge */}
                      <span className={`shrink-0 px-1.5 py-0.5 rounded font-bold ${
                        uf.file.size > CLOUD_THRESHOLD_MB * MB
                          ? 'bg-amber-100 text-amber-600'
                          : 'bg-slate-100 text-slate-500'
                      }`}>
                        {sizeMB} MB
                      </span>

                      {/* Remove */}
                      <button
                        onClick={() => removeUserFile(uf.id)}
                        className="text-slate-300 hover:text-red-400 shrink-0 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Legend */}
            <div className="mt-3 space-y-1 text-xs text-slate-400">
              <div className="flex items-center gap-1.5">
                <Cloud size={11} className="text-indigo-400" />
                Files are uploaded to Cloudinary — recipients get a secure download link.
              </div>
              <div className="flex items-center gap-1.5 text-slate-400">
                <span className="text-indigo-400">📊</span>
                Upload screenshots of charts or visuals here to include them in your email.
              </div>
              {!state.cloudinaryConfig && (
                <button
                  onClick={() => navigate('/settings')}
                  className="flex items-center gap-1 text-indigo-500 hover:text-indigo-700"
                >
                  <SettingsIcon size={11} /> Configure Cloudinary to enable files &gt;25 MB
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
