// @ts-ignore npm specifier
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function parseIntervalMs(s: string): number {
  const n = parseInt(s)
  if (s.endsWith('s')) return n * 1_000
  if (s.endsWith('m')) return n * 60_000
  if (s.endsWith('h')) return n * 3_600_000
  return 300_000
}

function extractSpreadsheetId(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  return m ? m[1] : null
}

function extractGid(url: string): string | null {
  const m = url.match(/[?&#]gid=(\d+)/)
  return m ? m[1] : null
}

async function fetchSheetRows(spreadsheetId: string, sheetName?: string, gid?: string): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({ tqx: 'out:csv' })
  if (gid) params.set('gid', gid)
  if (sheetName) params.set('sheet', sheetName)
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?${params}`
  const res = await fetch(url, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  if (text.trim().startsWith('{') && text.includes('"status":"error"')) throw new Error('ACCESS_DENIED')
  return parseCSV(text)
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim()); current = ''
    } else { current += ch }
  }
  result.push(current.trim())
  return result
}

function parseCSV(csv: string): Record<string, unknown>[] {
  const lines = csv.split('\n').map(l => l.trimEnd()).filter(Boolean)
  if (lines.length < 2) return []
  const headers = parseCSVLine(lines[0])
  const rows: Record<string, unknown>[] = []
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i])
    const row: Record<string, unknown> = {}
    for (let j = 0; j < headers.length; j++) {
      const v = vals[j] ?? ''
      const n = Number(v)
      row[headers[j]] = v !== '' && !isNaN(n) ? n : v
    }
    if (Object.values(row).some(v => v !== '')) rows.push(row)
  }
  return rows
}

interface EmailJSConfig { serviceId: string; templateId: string; publicKey: string }

async function sendEmail(cfg: EmailJSConfig, params: Record<string, string>): Promise<void> {
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: cfg.serviceId,
      template_id: cfg.templateId,
      user_id: cfg.publicKey,
      template_params: params,
    }),
  })
  if (!res.ok) throw new Error(`EmailJS ${res.status}: ${await res.text()}`)
}

interface AlertRule { column: string; condition: string; threshold: number }

function conditionLabel(condition: string, column: string, threshold: number): string {
  const map: Record<string, string> = {
    above:      `${column} goes above ${threshold.toLocaleString()}`,
    below:      `${column} falls below ${threshold.toLocaleString()}`,
    equals:     `${column} equals exactly ${threshold.toLocaleString()}`,
    change_pct: `${column} changes by more than ${threshold}%`,
  }
  return map[condition] ?? condition
}

// Returns true when `val` is in a breaching state for the given rule.
// For change_pct, `refVal` (the previous value) is required.
function isBreaching(val: number, rule: AlertRule, refVal?: number): boolean {
  if (isNaN(val)) return false
  switch (rule.condition) {
    case 'above':      return val > rule.threshold
    case 'below':      return val < rule.threshold
    case 'equals':     return val === rule.threshold
    case 'change_pct':
      if (refVal === undefined || isNaN(refVal) || refVal === 0 || refVal === val) return false
      return Math.abs((val - refVal) / refVal) * 100 > rule.threshold
    default: return false
  }
}

interface ParsedAlert {
  columnRules: AlertRule[]
  checkInterval: string
  emailBody?: string
  sheetUrl?: string
  subSheetName?: string
  notificationEmails: string[]
}

function parseAlertRow(row: Record<string, unknown>): ParsedAlert {
  const raw = String(row.column_name ?? '')
  let columnRules: AlertRule[] = []
  let checkInterval = '5m'
  let emailBody: string | undefined
  let sheetUrl: string | undefined
  let subSheetName: string | undefined
  let notificationEmails: string[] = []

  if (raw.startsWith('{')) {
    try {
      const p = JSON.parse(raw)
      columnRules        = p.rules ?? []
      checkInterval      = p.checkInterval ?? '5m'
      emailBody          = p.emailBody || undefined
      sheetUrl           = p.sheetUrl || undefined
      subSheetName       = p.subSheetName || undefined
      notificationEmails = p.notificationEmails ?? []
    } catch { /* keep defaults */ }
  } else if (raw.startsWith('[')) {
    try { columnRules = JSON.parse(raw) } catch { /* keep defaults */ }
    notificationEmails = (row.notification_emails as string[]) ?? []
  } else {
    const cols = raw.split('|').filter(Boolean)
    columnRules = cols.map(col => ({
      column: col,
      condition: String(row.condition ?? 'above'),
      threshold: Number(row.threshold ?? 0),
    }))
    notificationEmails = (row.notification_emails as string[]) ?? []
  }

  if (!sheetUrl)     sheetUrl     = String(row.sheet_url ?? '') || undefined
  if (!subSheetName) subSheetName = String(row.sub_sheet_name ?? '') || undefined
  if (!notificationEmails.length) notificationEmails = (row.notification_emails as string[]) ?? []

  return { columnRules, checkInterval, emailBody, sheetUrl, subSheetName, notificationEmails }
}

type Breach = { rule: AlertRule; value: number; row: Record<string, unknown>; kind: 'current' | 'updated' | 'new' }

// ─── Send alert email ─────────────────────────────────────────────────────────
async function fireAlert(
  alertName: string,
  userEmail: string,
  notificationEmails: string[],
  emailBody: string | undefined,
  breaches: Breach[],
  ejsCfg: EmailJSConfig,
  now: Date,
): Promise<void> {
  const conditionLines = breaches.map(b => {
    const kindLabel = b.kind === 'current' ? '[Currently breaching]' : b.kind === 'new' ? '[New row]' : '[Updated row]'
    const rowEntries = Object.entries(b.row)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `    ${k}: ${v}`)
      .join('\n')
    return [
      `${kindLabel} ${b.rule.column}: ${b.value.toLocaleString()} (${conditionLabel(b.rule.condition, b.rule.column, b.rule.threshold)})`,
      `  Row data:`,
      rowEntries,
    ].join('\n')
  }).join('\n\n')

  const emailMsg = [
    emailBody ? `${emailBody}\n\n---` : '',
    `Alert: ${alertName}`,
    `Triggered: ${now.toUTCString()}`,
    '',
    'Breached conditions:',
    conditionLines,
  ].filter(Boolean).join('\n')

  for (const email of notificationEmails) {
    await sendEmail(ejsCfg, {
      to_email:         email,
      from_name:        'Rsend Alerts',
      reply_to:         userEmail,
      subject:          `Alert triggered: ${alertName}`,
      message:          emailMsg,
      attachments_info: '',
      cc_email:         '',
    })
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    const { data: alertRows, error: alertsErr } = await supabase
      .from('alerts').select('*').eq('enabled', true)

    if (alertsErr) throw alertsErr
    if (!alertRows || alertRows.length === 0) {
      return new Response(JSON.stringify({ checked: 0, triggered: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const emails  = [...new Set(alertRows.map((r: Record<string, unknown>) => r.user_email as string))]
    const alertIds = alertRows.map((r: Record<string, unknown>) => r.id as string)

    const [profilesRes, sourcesRes, baselinesRes] = await Promise.all([
      supabase.from('user_profiles').select('email, emailjs_config').in('email', emails),
      supabase.from('data_sources').select('id, url, type').in('user_email', emails),
      supabase.from('alert_baselines').select('*').in('alert_id', alertIds),
    ])

    const profiles    = new Map<string, EmailJSConfig | null>(
      (profilesRes.data ?? []).map((p: Record<string, unknown>) => [p.email as string, p.emailjs_config as EmailJSConfig | null])
    )
    const dataSources = new Map<string, Record<string, unknown>>(
      (sourcesRes.data ?? []).map((ds: Record<string, unknown>) => [ds.id as string, ds])
    )
    const baselines   = new Map<string, Record<string, unknown>>(
      (baselinesRes.data ?? []).map((b: Record<string, unknown>) => [b.alert_id as string, b])
    )

    const now = new Date()
    const todayName = DAY_NAMES[now.getUTCDay()]
    let checked = 0, triggered = 0

    for (const row of alertRows as Record<string, unknown>[]) {
      const alertId = row.id as string
      try {
        const parsed = parseAlertRow(row)
        const { columnRules, checkInterval, emailBody, sheetUrl, subSheetName, notificationEmails } = parsed

        if (columnRules.length === 0 || notificationEmails.length === 0) continue

        // Respect check interval (10s tolerance absorbs cron jitter)
        const baseline = baselines.get(alertId)
        if (baseline?.last_checked_at) {
          const minMs  = Math.max(parseIntervalMs(checkInterval), 60_000)
          const elapsed = now.getTime() - new Date(baseline.last_checked_at as string).getTime()
          if (elapsed < minMs - 10_000) continue
        }

        // Resolve Google Sheets URL
        let spreadsheetId: string | null = null
        let gid: string | undefined
        const tabName: string | undefined = subSheetName

        if (sheetUrl) {
          spreadsheetId = extractSpreadsheetId(sheetUrl)
          gid = extractGid(sheetUrl) ?? undefined
        } else if (row.data_source_id) {
          const ds = dataSources.get(row.data_source_id as string)
          if (!ds || ds.type !== 'google_sheets' || !ds.url) continue
          spreadsheetId = extractSpreadsheetId(ds.url as string)
          gid = extractGid(ds.url as string) ?? undefined
        }
        if (!spreadsheetId) continue

        checked++
        const currentRows = await fetchSheetRows(spreadsheetId, tabName, gid)

        // ── Check schedule ─────────────────────────────────────────────────────
        const schedule = String(row.schedule ?? 'immediate')
        const canFireToday = !(schedule === 'weekly' && todayName !== 'Mon')
                          && !(schedule === 'custom' && row.custom_day && todayName !== String(row.custom_day))

        // ── Get EmailJS config ─────────────────────────────────────────────────
        const ejsCfg = profiles.get(row.user_email as string)
        const hasEmailConfig = !!(ejsCfg?.serviceId && ejsCfg?.templateId && ejsCfg?.publicKey)

        // ─────────────────────────────────────────────────────────────────────
        // FIRST-TIME: capture baseline, nothing to compare yet.
        // ─────────────────────────────────────────────────────────────────────
        if (!baseline) {
          await supabase.from('alert_baselines').upsert({
            alert_id: alertId,
            user_email: row.user_email,
            baseline_data: currentRows,
            last_checked_at: now.toISOString(),
          }, { onConflict: 'alert_id' })
          console.log(`[check-alerts] "${row.name}" baseline captured (${currentRows.length} rows)`)
          continue
        }

        // ─────────────────────────────────────────────────────────────────────
        // SUBSEQUENT CHECKS:
        // • Existing row: fire if value CHANGED and the NEW value meets condition.
        //   Rows where the value didn't change are ignored (prevents spam).
        // • New row appended since last check: fire if condition is met.
        // ─────────────────────────────────────────────────────────────────────
        const snapshot = (baseline.baseline_data ?? []) as Record<string, unknown>[]
        const breaches: Breach[] = []

        const compareCount = Math.min(currentRows.length, snapshot.length)
        for (let i = 0; i < compareCount; i++) {
          const curRow = currentRows[i]
          const oldRow = snapshot[i]
          for (const rule of columnRules) {
            const oldVal = Number(oldRow[rule.column])
            const newVal = Number(curRow[rule.column])
            if (isNaN(newVal) || oldVal === newVal) continue  // no change — skip
            if (isBreaching(newVal, rule, oldVal)) {
              breaches.push({ rule, value: newVal, row: curRow, kind: 'updated' })
              break
            }
          }
        }

        // Brand-new rows appended since last check
        for (const newRow of currentRows.slice(snapshot.length)) {
          for (const rule of columnRules) {
            const v = Number(newRow[rule.column])
            if (!isNaN(v) && isBreaching(v, rule)) {
              breaches.push({ rule, value: v, row: newRow, kind: 'new' })
              break
            }
          }
        }

        // Always roll baseline forward
        await supabase.from('alert_baselines').upsert({
          alert_id: alertId,
          user_email: row.user_email,
          baseline_data: currentRows,
          last_checked_at: now.toISOString(),
        }, { onConflict: 'alert_id' })

        console.log(`[check-alerts] "${row.name}" — ${breaches.length} breach(es) detected`)

        if (breaches.length === 0 || !canFireToday || !hasEmailConfig) {
          if (breaches.length > 0 && !hasEmailConfig) {
            console.warn(`[check-alerts] No EmailJS config for ${row.user_email}`)
          }
          continue
        }

        await fireAlert(String(row.name), row.user_email as string, notificationEmails, emailBody, breaches, ejsCfg!, now)
        triggered++
        console.log(`[check-alerts] Fired "${row.name}" → ${notificationEmails.join(', ')}`)

      } catch (err) {
        console.error(`[check-alerts] Error on alert ${alertId}:`, err)
      }
    }

    console.log(`[check-alerts] Done — checked: ${checked}, triggered: ${triggered}`)
    return new Response(JSON.stringify({ checked, triggered }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('[check-alerts] Fatal:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
