import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Component, type ReactNode } from 'react'
import { AppProvider, useApp } from './context/AppContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import LandingPage from './pages/LandingPage'
import DataImport from './pages/DataImport'
import ReportGeneration from './pages/ReportGeneration'
import Mail from './pages/Mail'
import Alerts from './pages/Alerts'
import Settings from './pages/Settings'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
          <div className="bg-white rounded-xl border border-red-200 shadow-sm p-8 max-w-xl w-full">
            <p className="text-red-600 font-bold text-lg mb-2">Something went wrong</p>
            <pre className="text-xs text-slate-600 bg-slate-50 rounded-lg p-4 overflow-auto border border-slate-200 whitespace-pre-wrap">
              {(this.state.error as Error).message}
            </pre>
            <button
              onClick={() => { localStorage.removeItem('rsend_state'); window.location.href = '/login' }}
              className="mt-5 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700"
            >
              Clear data &amp; go to login
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function PrivateRoutes() {
  const { state } = useApp()
  if (!state.user) return <Navigate to="/login" replace />
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/import" replace />} />
        <Route path="import" element={<DataImport />} />
        <Route path="reports" element={<ReportGeneration />} />
        <Route path="mail" element={<Mail />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}

function AppRoutes() {
  const { state, authReady } = useApp()

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/" element={state.user ? <Navigate to="/import" replace /> : <LandingPage />} />
      <Route path="/login" element={state.user ? <Navigate to="/import" replace /> : <Login />} />
      <Route path="/*" element={<PrivateRoutes />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AppProvider>
    </ErrorBoundary>
  )
}
