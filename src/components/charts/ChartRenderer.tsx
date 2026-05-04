import type { ChartType } from '../../types'
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

const COLORS = ['#6366F1', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899']

interface ChartRendererProps {
  type: ChartType
  data: Record<string, unknown>[]
  xAxis: string
  yAxes: string[]
  height?: number
}

function toNum(val: unknown): number {
  const n = Number(val)
  return isNaN(n) ? 0 : n
}

// ── Heatmap ──────────────────────────────────────────────────────────────────
function HeatmapChart({ data, xAxis, yAxes, height }: Omit<ChartRendererProps, 'type'>) {
  const valueKey = yAxes[0] ?? ''
  const rows = data.slice(0, 30)
  const values = rows.map(r => toNum(r[valueKey]))
  const minVal = Math.min(...values)
  const maxVal = Math.max(...values)
  const range = maxVal - minVal || 1

  function cellColor(val: number): string {
    const t = (val - minVal) / range
    // Indigo scale: light indigo → deep indigo
    const r = Math.round(238 - t * (238 - 67))
    const g = Math.round(242 - t * (242 - 56))
    const b = Math.round(255 - t * (255 - 202))
    return `rgb(${r},${g},${b})`
  }

  function textColor(val: number): string {
    const t = (val - minVal) / range
    return t > 0.55 ? '#ffffff' : '#1e293b'
  }

  return (
    <div style={{ height: height ?? 300 }} className="overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="text-left px-2 py-1 text-slate-500 font-medium w-32">{xAxis}</th>
            {yAxes.map(y => (
              <th key={y} className="px-2 py-1 text-slate-500 font-medium text-center">{y}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td className="px-2 py-1 text-slate-600 font-medium truncate max-w-[8rem]">
                {String(row[xAxis] ?? '')}
              </td>
              {yAxes.map(y => {
                const v = toNum(row[y])
                const bg = yAxes.length === 1 ? cellColor(v) : COLORS[yAxes.indexOf(y) % COLORS.length] + '33'
                const fg = yAxes.length === 1 ? textColor(v) : '#1e293b'
                return (
                  <td
                    key={y}
                    className="px-2 py-1 text-center rounded"
                    style={{ backgroundColor: bg, color: fg }}
                  >
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

// ── Table ────────────────────────────────────────────────────────────────────
function TableChart({ data, height }: Omit<ChartRendererProps, 'type'>) {
  const rows = data.slice(0, 50)
  if (rows.length === 0) return <p className="text-slate-400 text-sm text-center py-8">No data</p>
  const headers = Object.keys(rows[0])

  return (
    <div className="overflow-x-auto" style={{ maxHeight: height ?? 300 }}>
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 z-10">
          <tr>
            {headers.map(h => (
              <th
                key={h}
                className="px-3 py-2 text-left text-white text-xs font-semibold"
                style={{ backgroundColor: '#6366F1' }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
              {headers.map(h => (
                <td key={h} className="px-3 py-2 text-slate-600 whitespace-nowrap">
                  {String(row[h] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Bar / Line / Area aggregation ────────────────────────────────────────────
// Groups rows by xAxis, sums numeric yAxes, counts rows for non-numeric yAxes
function aggregateData(
  data: Record<string, unknown>[],
  xAxis: string,
  yAxes: string[],
): Record<string, unknown>[] {
  const grouped: Record<string, Record<string, number>> = {}
  for (const row of data) {
    const key = String(row[xAxis] ?? '')
    if (!grouped[key]) grouped[key] = {}
    for (const y of yAxes) {
      const num = Number(row[y])
      grouped[key][y] = (grouped[key][y] ?? 0) + (isNaN(num) ? 1 : num)
    }
  }
  return Object.entries(grouped)
    .slice(0, 50)
    .map(([key, vals]) => ({ [xAxis]: key, ...vals }))
}

// ── Pie aggregation ──────────────────────────────────────────────────────────
function buildPieData(data: Record<string, unknown>[], xAxis: string, valueKey: string) {
  const agg: Record<string, number> = {}
  data.forEach(row => {
    const key = String(row[xAxis] ?? 'Other')
    agg[key] = (agg[key] ?? 0) + toNum(row[valueKey])
  })
  return Object.entries(agg)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ChartRenderer({ type, data, xAxis, yAxes, height = 300 }: ChartRendererProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center text-slate-400 text-sm" style={{ height }}>
        No data available
      </div>
    )
  }

  if (type === 'heatmap') {
    return <HeatmapChart data={data} xAxis={xAxis} yAxes={yAxes} height={height} />
  }

  if (type === 'table') {
    return <TableChart data={data} xAxis={xAxis} yAxes={yAxes} height={height} />
  }

  if (type === 'pie') {
    const pieKey = yAxes[0] ?? ''
    const pieData = buildPieData(data, xAxis, pieKey)
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={height / 2.8}
            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
            labelLine={false}
          >
            {pieData.map((_entry, index) => (
              <Cell key={index} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(v: number) => v.toLocaleString()} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    )
  }

  // Bar / Line / Area — aggregate rows by xAxis (groups + counts/sums yAxes)
  const chartData = aggregateData(data, xAxis, yAxes)

  if (type === 'bar') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey={xAxis} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={60} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
          <Tooltip formatter={(v: number) => v.toLocaleString()} />
          <Legend />
          {yAxes.map((y, i) => (
            <Bar key={y} dataKey={y} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} maxBarSize={48} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    )
  }

  if (type === 'line') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey={xAxis} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={60} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
          <Tooltip formatter={(v: number) => v.toLocaleString()} />
          <Legend />
          {yAxes.map((y, i) => (
            <Line key={y} type="monotone" dataKey={y} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    )
  }

  if (type === 'area') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <defs>
            {yAxes.map((y, i) => (
              <linearGradient key={y} id={`grad_${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.3} />
                <stop offset="95%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey={xAxis} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={60} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
          <Tooltip formatter={(v: number) => v.toLocaleString()} />
          <Legend />
          {yAxes.map((y, i) => (
            <Area
              key={y}
              type="monotone"
              dataKey={y}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              fill={`url(#grad_${i})`}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    )
  }

  return null
}
