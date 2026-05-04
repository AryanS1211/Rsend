import React, { createContext, useContext, useReducer, useEffect, useRef, useCallback } from 'react'
import type { AppState, User, DataSource, Report, Alert, EmailJSConfig, CloudinaryConfig, CapturedVisual } from '../types'
import * as db from '../lib/db'

type Action =
  | { type: 'LOGIN'; payload: User }
  | { type: 'LOGOUT' }
  | { type: 'ADD_DATA_SOURCE'; payload: DataSource }
  | { type: 'REMOVE_DATA_SOURCE'; payload: string }
  | { type: 'SET_ACTIVE_DATA_SOURCE'; payload: string }
  | { type: 'UPDATE_DATA_SOURCE'; payload: DataSource }
  | { type: 'ADD_REPORT'; payload: Report }
  | { type: 'UPDATE_REPORT'; payload: Report }
  | { type: 'REMOVE_REPORT'; payload: string }
  | { type: 'ADD_ALERT'; payload: Alert }
  | { type: 'UPDATE_ALERT'; payload: Alert }
  | { type: 'REMOVE_ALERT'; payload: string }
  | { type: 'TOGGLE_ALERT'; payload: string }
  | { type: 'SET_EMAILJS_CONFIG'; payload: EmailJSConfig | null }
  | { type: 'SET_CLOUDINARY_CONFIG'; payload: CloudinaryConfig | null }
  | { type: 'ADD_CAPTURED_VISUAL'; payload: CapturedVisual }
  | { type: 'REMOVE_CAPTURED_VISUAL'; payload: string }
  | { type: 'LOAD_STATE'; payload: Partial<AppState> }

const initialState: AppState = {
  user: null,
  dataSources: [],
  activeDataSourceId: null,
  reports: [],
  alerts: [],
  emailjsConfig: null,
  cloudinaryConfig: null,
  capturedVisuals: [],
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'LOGIN':
      return { ...initialState, user: action.payload }
    case 'LOGOUT':
      return { ...initialState }
    case 'ADD_DATA_SOURCE':
      return { ...state, dataSources: [...state.dataSources, action.payload], activeDataSourceId: action.payload.id }
    case 'REMOVE_DATA_SOURCE':
      return {
        ...state,
        dataSources: state.dataSources.filter(ds => ds.id !== action.payload),
        activeDataSourceId:
          state.activeDataSourceId === action.payload
            ? state.dataSources.find(ds => ds.id !== action.payload)?.id ?? null
            : state.activeDataSourceId,
      }
    case 'SET_ACTIVE_DATA_SOURCE':
      return { ...state, activeDataSourceId: action.payload }
    case 'UPDATE_DATA_SOURCE':
      return { ...state, dataSources: state.dataSources.map(ds => ds.id === action.payload.id ? action.payload : ds) }
    case 'ADD_REPORT':
      return { ...state, reports: [...state.reports, action.payload] }
    case 'UPDATE_REPORT':
      return { ...state, reports: state.reports.map(r => r.id === action.payload.id ? action.payload : r) }
    case 'REMOVE_REPORT':
      return { ...state, reports: state.reports.filter(r => r.id !== action.payload) }
    case 'ADD_ALERT':
      return { ...state, alerts: [...state.alerts, action.payload] }
    case 'UPDATE_ALERT':
      return { ...state, alerts: state.alerts.map(a => a.id === action.payload.id ? action.payload : a) }
    case 'REMOVE_ALERT':
      return { ...state, alerts: state.alerts.filter(a => a.id !== action.payload) }
    case 'TOGGLE_ALERT':
      return { ...state, alerts: state.alerts.map(a => a.id === action.payload ? { ...a, enabled: !a.enabled } : a) }
    case 'SET_EMAILJS_CONFIG':
      return { ...state, emailjsConfig: action.payload }
    case 'SET_CLOUDINARY_CONFIG':
      return { ...state, cloudinaryConfig: action.payload }
    case 'ADD_CAPTURED_VISUAL':
      return { ...state, capturedVisuals: [...state.capturedVisuals, action.payload] }
    case 'REMOVE_CAPTURED_VISUAL':
      return { ...state, capturedVisuals: state.capturedVisuals.filter(v => v.id !== action.payload) }
    case 'LOAD_STATE':
      return { ...initialState, ...action.payload }
    default:
      return state
  }
}

interface AppContextType {
  state: AppState
  dispatch: React.Dispatch<Action>
  authReady: boolean
}

const AppContext = createContext<AppContextType | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, baseDispatch] = useReducer(reducer, initialState)
  const [authReady, setAuthReady] = React.useState(false)
  const stateRef = useRef(state)
  const loadedEmailRef = useRef<string | null>(null)

  useEffect(() => { stateRef.current = state }, [state])

  // Restore session from localStorage on mount
  // emailjsConfig and cloudinaryConfig are always loaded fresh from Supabase — never from cache
  useEffect(() => {
    const saved = localStorage.getItem('rsend_state')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        parsed.emailjsConfig = null
        parsed.cloudinaryConfig = null
        parsed.capturedVisuals = [] // loaded separately below
        baseDispatch({ type: 'LOAD_STATE', payload: parsed })
      }
      catch { /* ignore corrupt state */ }
    }
    // Load captured visuals (stored separately because imageDataUrl can be large)
    try {
      const vis = localStorage.getItem('rsend_visuals')
      if (vis) {
        const arr = JSON.parse(vis)
        if (Array.isArray(arr)) {
          arr.forEach((v: unknown) => baseDispatch({ type: 'ADD_CAPTURED_VISUAL', payload: v as import('../types').CapturedVisual }))
        }
      }
    } catch { /* ignore */ }
    // Signal that auth state has been restored from localStorage — routes can now render
    setAuthReady(true)
  }, [])

  // Persist to localStorage on every change
  // Strip heavy row data — Supabase is the source of truth; metadata is enough for session restore
  // Captured visuals (with imageDataUrl) are saved to a separate key to avoid quota issues
  useEffect(() => {
    try {
      const slim = {
        ...state,
        dataSources: state.dataSources.map(ds => ({ ...ds, data: [], subSheets: [] })),
        capturedVisuals: [], // stored separately
      }
      localStorage.setItem('rsend_state', JSON.stringify(slim))
    } catch {
      // Quota exceeded — silently ignore; Supabase will reload data on next login
    }
    try {
      localStorage.setItem('rsend_visuals', JSON.stringify(state.capturedVisuals))
    } catch { /* quota exceeded — visuals won't persist */ }
  }, [state])

  // Load full data from Supabase when user logs in (once per email)
  useEffect(() => {
    const email = state.user?.email
    if (!email || loadedEmailRef.current === email) return
    loadedEmailRef.current = email

    db.loadUserDataByEmail(email)
      .then(userData => {
        // Merge: keep any locally-cached alerts that didn't make it to DB
        // (e.g. created while a DB column was missing — now fixed)
        const localAlerts = stateRef.current.alerts ?? []
        const dbAlerts = userData.alerts ?? []
        const dbIds = new Set(dbAlerts.map(a => a.id))
        const localOnly = localAlerts.filter(a => !dbIds.has(a.id))

        baseDispatch({
          type: 'LOAD_STATE',
          payload: {
            ...userData,
            user: state.user!,
            alerts: [...dbAlerts, ...localOnly],
            // capturedVisuals are never stored in Supabase (imageDataUrl is too large).
            // Preserve whatever was loaded from localStorage so re-login doesn't wipe them.
            capturedVisuals: stateRef.current.capturedVisuals,
          },
        })

        // Re-save any recovered local-only alerts to DB now that saving is fixed
        localOnly.forEach(alert => db.upsertAlert(email, alert).catch(console.error))
      })
      .catch(console.error)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.user?.email])

  // Wrapped dispatch: updates local state + syncs to Supabase
  const dispatch = useCallback((action: Action) => {
    baseDispatch(action)
    const user = stateRef.current.user
    if (!user) return
    const { email, name } = user

    switch (action.type) {
      case 'ADD_DATA_SOURCE':
      case 'UPDATE_DATA_SOURCE':
        db.upsertDataSource(email, action.payload).catch(console.error)
        break
      case 'REMOVE_DATA_SOURCE':
        db.deleteDataSource(action.payload).catch(console.error)
        break
      case 'ADD_ALERT':
      case 'UPDATE_ALERT':
        db.upsertAlert(email, action.payload).catch(console.error)
        break
      case 'TOGGLE_ALERT': {
        const alert = stateRef.current.alerts.find(a => a.id === action.payload)
        if (alert) db.upsertAlert(email, { ...alert, enabled: !alert.enabled }).catch(console.error)
        break
      }
      case 'REMOVE_ALERT':
        db.deleteAlert(action.payload).catch(console.error)
        break
      case 'ADD_REPORT':
      case 'UPDATE_REPORT':
        db.upsertReport(email, action.payload).catch(console.error)
        break
      case 'REMOVE_REPORT':
        db.deleteReport(action.payload).catch(console.error)
        break
      case 'SET_EMAILJS_CONFIG': {
        const cloudinary = stateRef.current.cloudinaryConfig
        db.saveUserConfig(email, name, action.payload, cloudinary).catch(console.error)
        break
      }
      case 'SET_CLOUDINARY_CONFIG': {
        const emailjs = stateRef.current.emailjsConfig
        db.saveUserConfig(email, name, emailjs, action.payload).catch(console.error)
        break
      }
      case 'LOGOUT':
        loadedEmailRef.current = null
        localStorage.removeItem('rsend_state')
        localStorage.removeItem('rsend_visuals')
        break
      default:
        break
    }
  }, [])

  return (
    <AppContext.Provider value={{ state, dispatch, authReady }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be inside AppProvider')
  return ctx
}
