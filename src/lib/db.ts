import { supabase } from './supabase'
import type { DataSource, Alert, Report, EmailJSConfig, CloudinaryConfig } from '../types'

export interface UserData {
  emailjsConfig: EmailJSConfig | null
  cloudinaryConfig: CloudinaryConfig | null
  dataSources: DataSource[]
  activeDataSourceId: string | null
  alerts: Alert[]
  reports: Report[]
}

// ─── Password hashing (SHA-256 via Web Crypto — no external packages) ─────────
async function hashPassword(password: string, email: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + email.toLowerCase())
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export async function signUpUser(
  email: string,
  name: string,
  password: string,
): Promise<'ok' | 'exists'> {
  const { data: existing } = await supabase
    .from('user_profiles')
    .select('email')
    .eq('email', email.toLowerCase())
    .maybeSingle()

  if (existing) return 'exists'

  const hash = await hashPassword(password, email)
  await supabase.from('user_profiles').insert({
    email: email.toLowerCase(),
    name,
    password_hash: hash,
    updated_at: new Date().toISOString(),
  })
  return 'ok'
}

export async function signInUser(
  email: string,
  password: string,
): Promise<{ name: string } | null> {
  const { data } = await supabase
    .from('user_profiles')
    .select('name, password_hash')
    .eq('email', email.toLowerCase())
    .maybeSingle()

  if (!data) return null

  const hash = await hashPassword(password, email)
  if (hash !== data.password_hash) return null

  return { name: data.name }
}

// ─── User data ────────────────────────────────────────────────────────────────
export async function loadUserDataByEmail(email: string): Promise<UserData> {
  const [profileRes, sourcesRes, alertsRes, reportsRes] = await Promise.all([
    supabase.from('user_profiles').select('emailjs_config, cloudinary_config').eq('email', email.toLowerCase()).maybeSingle(),
    supabase.from('data_sources').select('*').eq('user_email', email.toLowerCase()).order('created_at', { ascending: true }),
    supabase.from('alerts').select('*').eq('user_email', email.toLowerCase()).order('created_at', { ascending: true }),
    supabase.from('reports').select('*').eq('user_email', email.toLowerCase()).order('created_at', { ascending: true }),
  ])

  const dataSources: DataSource[] = (sourcesRes.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    url: row.url ?? undefined,
    data: row.data ?? [],
    columns: row.columns ?? [],
    sheets: row.sheets ?? [],
    activeSheet: row.active_sheet ?? '',
    lastSync: row.last_sync ?? undefined,
    subSheets: row.sub_sheets ?? [],
  }))

  const alerts: Alert[] = (alertsRes.data ?? []).map((row) => {
    // column_name stores everything as JSON (v3) | just rules (v2) | pipe-separated names (v1)
    const raw: string = row.column_name ?? ''
    let columnRules: Alert['columnRules'] = []
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
    } else {
      const cols = raw.split('|').filter(Boolean)
      const cond  = row.condition ?? 'above'
      const thresh = row.threshold ?? 0
      columnRules = cols.map((col: string) => ({ column: col, condition: cond, threshold: thresh }))
    }

    // Fall back to dedicated DB columns for records written before v3
    if (!sheetUrl)            sheetUrl            = row.sheet_url        ?? undefined
    if (!subSheetName)        subSheetName        = row.sub_sheet_name   ?? undefined
    if (!notificationEmails.length) notificationEmails = row.notification_emails ?? []

    return {
      id: row.id,
      name: row.name,
      dataSourceId: row.data_source_id ?? '',
      sheetUrl,
      subSheetName,
      columnRules,
      schedule: row.schedule,
      customDay: row.custom_day ?? undefined,
      checkInterval,
      emailBody,
      notificationEmails,
      enabled: row.enabled,
      createdAt: row.created_at,
    }
  })

  const reports: Report[] = (reportsRes.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    prompt: row.prompt ?? undefined,
    charts: row.charts ?? [],
    dataSourceId: row.data_source_id,
    createdAt: row.created_at,
  }))

  return {
    emailjsConfig: profileRes.data?.emailjs_config ?? null,
    cloudinaryConfig: profileRes.data?.cloudinary_config ?? null,
    dataSources,
    activeDataSourceId: dataSources.length > 0 ? dataSources[dataSources.length - 1].id : null,
    alerts,
    reports,
  }
}

export async function saveUserConfig(
  email: string,
  _name: string,
  emailjsConfig: EmailJSConfig | null,
  cloudinaryConfig: CloudinaryConfig | null,
) {
  await supabase.from('user_profiles').update({
    emailjs_config: emailjsConfig,
    cloudinary_config: cloudinaryConfig,
    updated_at: new Date().toISOString(),
  }).eq('email', email.toLowerCase())
}

export async function upsertDataSource(userEmail: string, ds: DataSource) {
  await supabase.from('data_sources').upsert(
    {
      id: ds.id,
      user_email: userEmail.toLowerCase(),
      name: ds.name,
      type: ds.type,
      url: ds.url ?? null,
      data: ds.data,
      columns: ds.columns,
      sheets: ds.sheets,
      active_sheet: ds.activeSheet,
      last_sync: ds.lastSync ?? null,
      sub_sheets: ds.subSheets ?? [],
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  )
}

export async function deleteDataSource(id: string) {
  await supabase.from('data_sources').delete().eq('id', id)
}

export async function upsertAlert(userEmail: string, alert: Alert) {
  // Everything stored in column_name JSON — no optional columns needed
  const columnNameJson = JSON.stringify({
    rules:              alert.columnRules,
    checkInterval:      alert.checkInterval,
    emailBody:          alert.emailBody ?? '',
    sheetUrl:           alert.sheetUrl ?? '',
    subSheetName:       alert.subSheetName ?? '',
    notificationEmails: alert.notificationEmails,
  })
  await supabase.from('alerts').upsert(
    {
      id:             alert.id,
      user_email:     userEmail.toLowerCase(),
      name:           alert.name,
      data_source_id: alert.dataSourceId,
      column_name:    columnNameJson,
      condition:      alert.columnRules[0]?.condition ?? 'above',
      threshold:      alert.columnRules[0]?.threshold ?? 0,
      schedule:       alert.schedule,
      custom_day:     alert.customDay ?? null,
      enabled:        alert.enabled,
      created_at:     alert.createdAt,
    },
    { onConflict: 'id' },
  )
}

export async function deleteAlert(id: string) {
  await supabase.from('alerts').delete().eq('id', id)
}

export async function upsertReport(userEmail: string, report: Report) {
  await supabase.from('reports').upsert(
    {
      id: report.id,
      user_email: userEmail.toLowerCase(),
      name: report.name,
      prompt: report.prompt ?? null,
      charts: report.charts,
      data_source_id: report.dataSourceId,
      created_at: report.createdAt,
    },
    { onConflict: 'id' },
  )
}

export async function deleteReport(id: string) {
  await supabase.from('reports').delete().eq('id', id)
}
