// @ts-ignore npm specifier
import { unzipSync } from 'npm:fflate@0.8.2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const C_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'

type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'heatmap' | 'table'

interface ChartConfig {
  id: string
  type: ChartType
  title: string
  xAxis: string
  yAxes: string[]
  cachedData?: Record<string, unknown>[]
}

function ptValues(cacheEl: Element): string[] {
  const ptCount = parseInt(cacheEl.getElementsByTagNameNS(C_NS, 'ptCount')[0]?.getAttribute('v') ?? '0')
  const out = new Array<string>(ptCount).fill('')
  const pts = cacheEl.getElementsByTagNameNS(C_NS, 'pt')
  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i]
    const idx = parseInt(pt.getAttribute('idx') ?? '0')
    const v = pt.getElementsByTagNameNS(C_NS, 'v')[0]?.textContent ?? ''
    if (idx < ptCount) out[idx] = v
  }
  return out
}

function parseOneChart(xml: string, idx: number): ChartConfig | null {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml')
  } catch { return null }

  // ── Chart type ──────────────────────────────────────────────────────────────
  const TYPE_MAP: Record<string, ChartType> = {
    barChart: 'bar', bar3DChart: 'bar', lineChart: 'line', line3DChart: 'line',
    areaChart: 'area', area3DChart: 'area', pieChart: 'pie', pie3DChart: 'pie',
    doughnutChart: 'pie', scatterChart: 'bar', bubbleChart: 'bar', radarChart: 'bar',
  }
  let type: ChartType = 'bar'
  for (const [tag, t] of Object.entries(TYPE_MAP)) {
    if (doc.getElementsByTagNameNS(C_NS, tag).length > 0) { type = t; break }
  }

  // ── Title ───────────────────────────────────────────────────────────────────
  const titleEl = doc.getElementsByTagNameNS(C_NS, 'title')[0]
  let title = `Chart ${idx + 1}`
  if (titleEl) {
    const tEls = titleEl.getElementsByTagNameNS(A_NS, 't')
    const parts: string[] = []
    for (let i = 0; i < tEls.length; i++) parts.push(tEls[i].textContent ?? '')
    if (parts.join('').trim()) title = parts.join('').trim()
  }

  // ── Series ──────────────────────────────────────────────────────────────────
  const serEls = doc.getElementsByTagNameNS(C_NS, 'ser')
  if (serEls.length === 0) {
    console.log(`[chart ${idx + 1}] No series elements found`)
    return null
  }

  let xValues: string[] = []
  const series: { name: string; values: string[] }[] = []

  for (let si = 0; si < serEls.length; si++) {
    const ser = serEls[si]

    // Series name
    const txEl = ser.getElementsByTagNameNS(C_NS, 'tx')[0]
    let serName = `Series ${si + 1}`
    if (txEl) {
      const vEl = txEl.getElementsByTagNameNS(C_NS, 'v')[0]
      if (vEl?.textContent) serName = vEl.textContent.trim()
    }

    // X categories (from first series only)
    if (xValues.length === 0) {
      const catEl = ser.getElementsByTagNameNS(C_NS, 'cat')[0]
      if (catEl) {
        const strCache = catEl.getElementsByTagNameNS(C_NS, 'strCache')[0]
        const numCache = catEl.getElementsByTagNameNS(C_NS, 'numCache')[0]
        const cache = strCache || numCache
        if (cache) xValues = ptValues(cache)
      }
    }

    // Y values
    const valEl = ser.getElementsByTagNameNS(C_NS, 'val')[0]
    const numCache = valEl?.getElementsByTagNameNS(C_NS, 'numCache')[0]
    const yVals = numCache ? ptValues(numCache) : []

    series.push({ name: serName, values: yVals })
  }

  console.log(`[chart ${idx + 1}] title="${title}" type=${type} series=${series.length} xLen=${xValues.length}`)

  if (series.length === 0) return null

  // ── Build cachedData if we have cached values ────────────────────────────
  const hasCache = xValues.length > 0 || series.some(s => s.values.length > 0)
  if (!hasCache) {
    console.log(`[chart ${idx + 1}] No cached data found`)
    return null
  }

  const xAxisKey = '_x'
  const rowCount = Math.max(xValues.length, ...series.map(s => s.values.length))
  const cachedData: Record<string, unknown>[] = Array.from({ length: rowCount }, (_, i) => {
    const row: Record<string, unknown> = { [xAxisKey]: xValues[i] ?? String(i + 1) }
    for (const s of series) {
      const v = parseFloat(s.values[i] ?? '')
      row[s.name] = isNaN(v) ? null : v
    }
    return row
  })

  return {
    id: `gs_chart_${idx + 1}_${Date.now()}`,
    type,
    title,
    xAxis: xAxisKey,
    yAxes: series.map(s => s.name),
    cachedData,
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { spreadsheetId } = await req.json() as { spreadsheetId: string }
    if (!spreadsheetId) {
      return new Response(JSON.stringify({ charts: [], error: 'Missing spreadsheetId' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Download XLSX
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*',
      },
    })

    if (!res.ok) {
      console.error('[fetch-gs-charts] Google returned', res.status)
      return new Response(JSON.stringify({ charts: [], error: `Google ${res.status}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const buf = await res.arrayBuffer()
    const magic = new Uint8Array(buf, 0, 4)
    if (magic[0] !== 0x50 || magic[1] !== 0x4B) {
      return new Response(JSON.stringify({ charts: [], error: 'Not a ZIP' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Unzip and find chart XMLs
    const files = unzipSync(new Uint8Array(buf))
    const dec = new TextDecoder()
    const allXlFiles = Object.keys(files).filter((n: string) => n.startsWith('xl/'))
    console.log('[fetch-gs-charts] xl/ entries:', allXlFiles.join(' | '))

    const chartXMLs: { name: string; xml: string }[] = []
    for (const [name, data] of Object.entries(files) as [string, Uint8Array][]) {
      if (/^xl\/(charts|chartsheets)\/.+\.xml$/i.test(name)) {
        chartXMLs.push({ name, xml: dec.decode(data) })
        console.log('[fetch-gs-charts] Found chart file:', name, 'size:', data.length)
      }
    }

    console.log('[fetch-gs-charts] Chart XMLs found:', chartXMLs.length)

    // Parse each chart XML server-side using DOMParser
    const charts: ChartConfig[] = []
    for (let i = 0; i < chartXMLs.length; i++) {
      const result = parseOneChart(chartXMLs[i].xml, i)
      if (result) charts.push(result)
    }

    console.log('[fetch-gs-charts] Parsed charts:', charts.length)

    return new Response(JSON.stringify({ charts, xlFileCount: allXlFiles.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[fetch-gs-charts] Error:', err)
    return new Response(JSON.stringify({ charts: [], error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
