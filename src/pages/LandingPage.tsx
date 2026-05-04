import { useState, type FormEvent, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Database, BarChart2, Bell, Mail, Eye, EyeOff, Check,
  ArrowRight, Zap, Camera, ChevronDown,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import * as db from '../lib/db'

// ─── Paper plane icon (matches app brand) ─────────────────────────────────────
function PlaneSVG({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="text-white">
      <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// ─── Auth Modal ────────────────────────────────────────────────────────────────
function AuthModal({ initialMode, onClose }: { initialMode: 'signin' | 'signup'; onClose: () => void }) {
  const { dispatch } = useApp()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!email.trim() || !email.includes('@')) { setError('Enter a valid email.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (mode === 'signup' && !name.trim()) { setError('Enter your full name.'); return }

    setLoading(true)
    try {
      if (mode === 'signup') {
        const result = await db.signUpUser(email.trim(), name.trim(), password)
        if (result === 'exists') { setError('An account with this email already exists. Please sign in.'); return }
        dispatch({ type: 'LOGIN', payload: { name: name.trim(), email: email.trim().toLowerCase() } })
        navigate('/import')
      } else {
        const user = await db.signInUser(email.trim(), password)
        if (!user) { setError('Incorrect email or password.'); return }
        dispatch({ type: 'LOGIN', payload: { name: user.name, email: email.trim().toLowerCase() } })
        navigate('/import')
      }
    } catch {
      setError('Connection error. Check your internet and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Card */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-7 border border-slate-200/80">
        {/* Close */}
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-300 hover:text-slate-500 transition-colors text-xl leading-none">&times;</button>

        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-6">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-sm">
            <PlaneSVG size={15} />
          </div>
          <span className="text-slate-800 font-bold text-lg tracking-tight">Rsend</span>
        </div>

        {/* Mode toggle */}
        <div className="flex rounded-xl border border-slate-200 p-1 mb-5 bg-slate-50">
          <button type="button" onClick={() => { setMode('signin'); setError('') }}
            className={`flex-1 text-sm py-1.5 rounded-lg font-medium transition-all ${mode === 'signin' ? 'bg-white shadow-sm text-slate-800 border border-slate-200/80' : 'text-slate-400 hover:text-slate-600'}`}>
            Sign In
          </button>
          <button type="button" onClick={() => { setMode('signup'); setError('') }}
            className={`flex-1 text-sm py-1.5 rounded-lg font-medium transition-all ${mode === 'signup' ? 'bg-white shadow-sm text-slate-800 border border-slate-200/80' : 'text-slate-400 hover:text-slate-600'}`}>
            Create Account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 text-sm px-3 py-2.5 rounded-xl">{error}</div>
          )}

          {mode === 'signup' && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Full Name</label>
              <input type="text" required value={name} onChange={e => { setName(e.target.value); setError('') }}
                placeholder="Sarah Johnson"
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent bg-white" />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Email Address</label>
            <input type="email" required value={email} onChange={e => { setEmail(e.target.value); setError('') }}
              placeholder="sarah@company.com"
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent bg-white" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Password</label>
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} required value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                placeholder="Min. 6 characters"
                className="w-full px-3.5 py-2.5 pr-10 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent bg-white" />
              <button type="button" onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors shadow-sm mt-1">
            {loading ? 'Please wait…' : mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <p className="text-center text-xs text-slate-400 mt-5">Secure · Private · No credit card required</p>
      </div>
    </div>
  )
}

// ─── Features data ─────────────────────────────────────────────────────────────
const features = [
  {
    icon: <Database size={20} className="text-indigo-600" />,
    bg: 'bg-indigo-50',
    title: 'Connect Any Data Source',
    desc: 'Import from Google Sheets, CSV, or Excel files instantly. No setup scripts, no API keys — just paste a link or upload a file.',
  },
  {
    icon: <BarChart2 size={20} className="text-violet-600" />,
    bg: 'bg-violet-50',
    title: 'AI-Generated Reports',
    desc: 'Describe what you need in plain English and watch charts generate themselves — bar, line, pie, area, and more.',
  },
  {
    icon: <Mail size={20} className="text-sky-600" />,
    bg: 'bg-sky-50',
    title: 'Automated Email Delivery',
    desc: 'Send polished reports with chart attachments to any recipients. Schedule once, deliver forever.',
  },
  {
    icon: <Bell size={20} className="text-amber-600" />,
    bg: 'bg-amber-50',
    title: 'Threshold Alerts',
    desc: 'Set triggers on any numeric column. When your data crosses a threshold, an email fires — instantly or on a schedule.',
  },
  {
    icon: <Camera size={20} className="text-rose-600" />,
    bg: 'bg-rose-50',
    title: 'Visual Chart Capture',
    desc: 'Screenshot any chart from your browser — Google Sheets, dashboards, anywhere — and attach it directly to emails.',
  },
]

// ─── Steps ─────────────────────────────────────────────────────────────────────
const steps = [
  {
    num: '01',
    title: 'Connect your data',
    desc: 'Paste a Google Sheets link or upload a CSV/Excel file. Rsend reads your columns and rows automatically.',
    color: 'from-indigo-500 to-violet-600',
  },
  {
    num: '02',
    title: 'Build your report',
    desc: 'Use AI to generate charts, or choose manually. Pick chart types, configure axes, preview live.',
    color: 'from-violet-500 to-purple-600',
  },
  {
    num: '03',
    title: 'Send or automate',
    desc: 'Send one-off emails with attachments, or set threshold alerts that notify you the moment your data changes.',
    color: 'from-purple-500 to-pink-600',
  },
]

// ─── Stats ─────────────────────────────────────────────────────────────────────
const stats = [
  { value: '3', label: 'Data source types supported' },
  { value: '0', label: 'Lines of code required' },
  { value: '< 1m', label: 'Time to first report' },
  { value: '100%', label: 'Browser-based, no installs' },
]

// ─── Main Landing Page ─────────────────────────────────────────────────────────
export default function LandingPage() {
  const { state } = useApp()
  const navigate = useNavigate()
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signup')
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    if (state.user) { navigate('/import', { replace: true }); return }
  }, [state.user, navigate])

  useEffect(() => {
    function onScroll() { setScrolled(window.scrollY > 20) }
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function openSignUp() { setAuthMode('signup'); setAuthOpen(true) }
  function openSignIn() { setAuthMode('signin'); setAuthOpen(true) }

  return (
    <div className="min-h-screen bg-[#F1F5F9] font-sans">

      {/* ── Navbar ─────────────────────────────────────────────────────────── */}
      <header className={`fixed top-0 inset-x-0 z-40 transition-all duration-200 ${scrolled ? 'bg-white/90 backdrop-blur-md shadow-sm border-b border-slate-200/60' : 'bg-transparent'}`}>
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-sm">
              <PlaneSVG size={14} />
            </div>
            <span className="text-slate-800 font-bold text-lg tracking-tight">Rsend</span>
          </div>

          {/* Nav links */}
          <nav className="hidden md:flex items-center gap-7">
            <a href="#features" className="text-sm text-slate-500 hover:text-slate-800 font-medium transition-colors">Features</a>
            <a href="#how-it-works" className="text-sm text-slate-500 hover:text-slate-800 font-medium transition-colors">How it works</a>
          </nav>

          {/* CTAs */}
          <div className="flex items-center gap-3">
            <button onClick={openSignIn}
              className="text-sm font-semibold text-slate-600 hover:text-indigo-600 transition-colors hidden sm:block">
              Sign In
            </button>
            <button onClick={openSignUp}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors">
              Get Started
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className="relative pt-32 pb-24 px-6 overflow-hidden">
        {/* Background blobs */}
        <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-gradient-to-r from-indigo-200/40 via-purple-200/40 to-pink-200/40 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-20 left-20 w-72 h-72 bg-indigo-300/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-10 right-20 w-64 h-64 bg-purple-300/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-4xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-white border border-indigo-100 text-indigo-600 text-xs font-semibold px-4 py-1.5 rounded-full shadow-sm mb-8">
            <Zap size={11} className="fill-indigo-500 text-indigo-500" />
            Automated data reporting, done right
          </div>

          {/* Headline */}
          <h1 className="text-5xl sm:text-6xl font-extrabold text-slate-800 tracking-tight leading-tight mb-6">
            Send smarter.<br />
            <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 bg-clip-text text-transparent">
              Act faster.
            </span>
          </h1>

          {/* Sub */}
          <p className="text-xl text-slate-500 max-w-2xl mx-auto leading-relaxed mb-10">
            Connect Google Sheets, CSV, or Excel — then generate charts, schedule email reports,
            and get threshold alerts the moment your data changes.
          </p>

          {/* CTA row */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-16">
            <button onClick={openSignUp}
              className="flex items-center gap-2 px-7 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl shadow-lg shadow-indigo-200 transition-all hover:shadow-indigo-300 hover:-translate-y-0.5 text-base">
              Get started free
              <ArrowRight size={17} />
            </button>
            <a href="#how-it-works"
              className="flex items-center gap-1.5 px-6 py-3.5 text-slate-600 hover:text-indigo-600 font-semibold rounded-2xl border border-slate-200 bg-white/80 hover:border-indigo-200 transition-all text-base">
              See how it works
              <ChevronDown size={16} />
            </a>
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap justify-center gap-3">
            {[
              { icon: <Check size={11} strokeWidth={3} />, text: 'No code required' },
              { icon: <Check size={11} strokeWidth={3} />, text: 'Works with Google Sheets' },
              { icon: <Check size={11} strokeWidth={3} />, text: 'Threshold alerts on your data' },
              { icon: <Check size={11} strokeWidth={3} />, text: 'No credit card needed' },
            ].map(p => (
              <span key={p.text} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200/80 rounded-full text-xs font-medium text-slate-500 shadow-sm">
                <span className="text-emerald-500">{p.icon}</span>
                {p.text}
              </span>
            ))}
          </div>
        </div>

        {/* App preview card */}
        <div className="relative max-w-5xl mx-auto mt-20">
          <div className="bg-white rounded-2xl shadow-2xl shadow-slate-200/80 border border-slate-200/60 overflow-hidden">
            {/* Fake browser bar */}
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100 bg-slate-50/80">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-400/80" />
                <div className="w-3 h-3 rounded-full bg-amber-400/80" />
                <div className="w-3 h-3 rounded-full bg-emerald-400/80" />
              </div>
              <div className="flex-1 flex justify-center">
                <div className="bg-white rounded-md border border-slate-200 px-4 py-1 text-xs text-slate-400 font-medium min-w-[200px] text-center">
                  app.rsend.io
                </div>
              </div>
            </div>
            {/* Fake UI panels */}
            <div className="flex h-64 sm:h-80">
              {/* Sidebar */}
              <div className="w-48 bg-[#F8FAFC] border-r border-slate-200/60 p-3 hidden sm:block flex-shrink-0">
                <div className="flex items-center gap-2 mb-5 px-2 pt-1">
                  <div className="w-6 h-6 rounded-md bg-gradient-to-br from-indigo-500 to-purple-600" />
                  <div className="h-3 w-12 bg-slate-200 rounded-full" />
                </div>
                {['Import Data', 'Reports', 'Send Mail', 'Alerts', 'Settings'].map((label, i) => (
                  <div key={label} className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-0.5 ${i === 1 ? 'bg-white shadow-sm border border-slate-200/80' : ''}`}>
                    <div className={`w-3.5 h-3.5 rounded ${i === 1 ? 'bg-indigo-400' : 'bg-slate-200'}`} />
                    <div className={`h-2.5 rounded-full ${i === 1 ? 'bg-indigo-200 w-16' : 'bg-slate-200 w-14'}`} />
                  </div>
                ))}
              </div>
              {/* Main area */}
              <div className="flex-1 p-5 sm:p-7 overflow-hidden">
                <div className="flex items-center gap-3 mb-5">
                  <div className="h-4 w-32 bg-slate-200 rounded-full" />
                  <div className="h-7 w-24 bg-indigo-100 rounded-lg ml-auto" />
                </div>
                {/* Fake charts */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Bar chart fake */}
                  <div className="bg-slate-50/80 border border-slate-200/60 rounded-xl p-3">
                    <div className="h-2.5 w-20 bg-slate-200 rounded-full mb-3" />
                    <div className="flex items-end gap-1.5 h-16">
                      {[60, 85, 45, 90, 70, 55, 80].map((h, i) => (
                        <div key={i} className="flex-1 rounded-t-sm bg-gradient-to-t from-indigo-500 to-indigo-400 opacity-80" style={{ height: `${h}%` }} />
                      ))}
                    </div>
                  </div>
                  {/* Line chart fake */}
                  <div className="bg-slate-50/80 border border-slate-200/60 rounded-xl p-3">
                    <div className="h-2.5 w-24 bg-slate-200 rounded-full mb-3" />
                    <svg viewBox="0 0 100 55" className="w-full h-16" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="lgrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.25" />
                          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <path d="M0 45 C15 38, 20 20, 35 25 S55 10, 70 18 S85 30, 100 12" fill="none" stroke="#8b5cf6" strokeWidth="2.5" strokeLinecap="round"/>
                      <path d="M0 45 C15 38, 20 20, 35 25 S55 10, 70 18 S85 30, 100 12 L100 55 L0 55Z" fill="url(#lgrad)"/>
                    </svg>
                  </div>
                  {/* Pie fake */}
                  <div className="bg-slate-50/80 border border-slate-200/60 rounded-xl p-3 flex items-center gap-3">
                    <svg viewBox="0 0 36 36" className="w-12 h-12 flex-shrink-0">
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e0e7ff" strokeWidth="3.8"/>
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="#6366f1" strokeWidth="3.8" strokeDasharray="60 40" strokeDashoffset="25" />
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="#8b5cf6" strokeWidth="3.8" strokeDasharray="25 75" strokeDashoffset="-35" />
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="#a78bfa" strokeWidth="3.8" strokeDasharray="15 85" strokeDashoffset="-60" />
                    </svg>
                    <div className="space-y-1.5">
                      {[['bg-indigo-500','60%'],['bg-violet-500','25%'],['bg-purple-300','15%']].map(([c,v]) => (
                        <div key={v} className="flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full ${c}`} />
                          <div className="h-2 w-8 bg-slate-200 rounded-full" />
                          <span className="text-xs text-slate-400 font-medium">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Stats fake */}
                  <div className="bg-slate-50/80 border border-slate-200/60 rounded-xl p-3">
                    <div className="h-2.5 w-16 bg-slate-200 rounded-full mb-3" />
                    <div className="space-y-2">
                      {[75,45,90].map((w,i) => (
                        <div key={i} className="flex items-center gap-2">
                          <div className="h-2 bg-slate-200 rounded-full" style={{width:`${w}%`}}>
                            <div className="h-full bg-gradient-to-r from-indigo-400 to-violet-500 rounded-full" style={{width:`${w}%`}} />
                          </div>
                          <span className="text-xs text-slate-400">{w}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* Shadow glow under card */}
          <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-3/4 h-8 bg-indigo-300/20 blur-2xl rounded-full" />
        </div>
      </section>

      {/* ── Stats bar ──────────────────────────────────────────────────────── */}
      <section className="py-12 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm grid grid-cols-2 sm:grid-cols-4 divide-x divide-slate-100">
            {stats.map(s => (
              <div key={s.label} className="py-7 px-6 text-center">
                <p className="text-3xl font-extrabold text-slate-800 tracking-tight">{s.value}</p>
                <p className="text-xs text-slate-400 font-medium mt-1 leading-tight">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────────────────── */}
      <section id="features" className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          {/* Header */}
          <div className="text-center mb-14">
            <p className="text-xs font-bold text-indigo-600 uppercase tracking-widest mb-3">Everything you need</p>
            <h2 className="text-4xl font-extrabold text-slate-800 tracking-tight">Built for data-driven teams</h2>
            <p className="text-slate-500 mt-3 text-lg max-w-xl mx-auto">
              From raw spreadsheet to polished email report in minutes — no engineering help needed.
            </p>
          </div>

          {/* Grid — 2 cards on top row, 3 on bottom */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-5">
            {features.slice(0, 2).map(f => (
              <div key={f.title} className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-7 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                <div className={`w-11 h-11 rounded-xl ${f.bg} flex items-center justify-center mb-4`}>
                  {f.icon}
                </div>
                <h3 className="font-bold text-slate-800 mb-2 text-[15px]">{f.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {features.slice(2).map(f => (
              <div key={f.title} className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                <div className={`w-10 h-10 rounded-xl ${f.bg} flex items-center justify-center mb-4`}>
                  {f.icon}
                </div>
                <h3 className="font-bold text-slate-800 mb-2">{f.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-20 px-6 bg-white">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-14">
            <p className="text-xs font-bold text-indigo-600 uppercase tracking-widest mb-3">Simple by design</p>
            <h2 className="text-4xl font-extrabold text-slate-800 tracking-tight">Up and running in 3 steps</h2>
          </div>

          {/* Steps */}
          <div className="relative">
            {/* Connector line */}
            <div className="hidden md:block absolute top-10 left-[calc(50%-1px)] w-0.5 h-[calc(100%-80px)] bg-gradient-to-b from-indigo-200 via-violet-200 to-purple-200" />

            <div className="space-y-12">
              {steps.map((step, i) => (
                <div key={step.num} className={`flex flex-col md:flex-row items-center gap-8 ${i % 2 === 1 ? 'md:flex-row-reverse' : ''}`}>
                  {/* Text side */}
                  <div className="flex-1 md:max-w-xs">
                    <p className="text-xs font-bold text-indigo-500 uppercase tracking-widest mb-2">{step.num}</p>
                    <h3 className="text-2xl font-extrabold text-slate-800 mb-3">{step.title}</h3>
                    <p className="text-slate-500 leading-relaxed">{step.desc}</p>
                  </div>

                  {/* Circle */}
                  <div className="relative z-10 flex-shrink-0">
                    <div className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${step.color} flex items-center justify-center shadow-lg`}>
                      <span className="text-white font-black text-2xl">{step.num.replace('0','')}</span>
                    </div>
                  </div>

                  {/* Right side (empty spacer on even steps) */}
                  <div className="flex-1 md:max-w-xs hidden md:block" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Data sources compatibility ──────────────────────────────────────── */}
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-8">Works with your existing tools</p>
          <div className="flex flex-wrap justify-center gap-4">
            {[
              { label: 'Google Sheets', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-100' },
              { label: 'CSV Files', color: 'text-blue-600', bg: 'bg-blue-50 border-blue-100' },
              { label: 'Excel (.xlsx)', color: 'text-green-700', bg: 'bg-green-50 border-green-100' },
              { label: 'EmailJS', color: 'text-orange-600', bg: 'bg-orange-50 border-orange-100' },
              { label: 'Cloudinary', color: 'text-sky-600', bg: 'bg-sky-50 border-sky-100' },
            ].map(t => (
              <span key={t.label} className={`flex items-center gap-2 px-4 py-2 rounded-xl border ${t.bg} text-sm font-semibold ${t.color}`}>
                <span className="w-2 h-2 rounded-full bg-current opacity-60" />
                {t.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA banner ─────────────────────────────────────────────────────── */}
      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto">
          <div className="relative bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 rounded-3xl p-12 text-center overflow-hidden shadow-2xl shadow-indigo-200">
            {/* Orbs */}
            <div className="absolute top-0 left-0 w-64 h-64 bg-white/10 rounded-full -translate-x-1/2 -translate-y-1/2 blur-2xl" />
            <div className="absolute bottom-0 right-0 w-48 h-48 bg-white/10 rounded-full translate-x-1/2 translate-y-1/2 blur-2xl" />

            <div className="relative">
              <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center mx-auto mb-6 shadow-lg">
                <PlaneSVG size={22} />
              </div>
              <h2 className="text-4xl font-extrabold text-white tracking-tight mb-4">
                Ready to send smarter?
              </h2>
              <p className="text-indigo-200 text-lg mb-8 max-w-md mx-auto">
                Join teams who automate their data reporting with Rsend. Free to start, no credit card required.
              </p>
              <div className="flex flex-col sm:flex-row justify-center gap-3">
                <button onClick={openSignUp}
                  className="flex items-center justify-center gap-2 px-7 py-3.5 bg-white text-indigo-700 font-bold rounded-2xl shadow-lg hover:bg-indigo-50 transition-colors text-base">
                  Get started free
                  <ArrowRight size={17} />
                </button>
                <button onClick={openSignIn}
                  className="flex items-center justify-center gap-2 px-7 py-3.5 border border-white/30 text-white font-semibold rounded-2xl hover:bg-white/10 transition-colors text-base">
                  Sign in
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="py-10 px-6 border-t border-slate-200/60">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-sm">
              <PlaneSVG size={12} />
            </div>
            <span className="text-slate-700 font-bold tracking-tight">Rsend</span>
            <span className="text-slate-300 text-sm">·</span>
            <span className="text-slate-400 text-sm">Email delivery from your Sheets & Files</span>
          </div>
          <div className="flex items-center gap-5">
            <button onClick={openSignIn} className="text-sm text-slate-400 hover:text-slate-600 font-medium transition-colors">Sign In</button>
            <button onClick={openSignUp} className="text-sm text-slate-400 hover:text-slate-600 font-medium transition-colors">Create Account</button>
            <span className="text-slate-300 text-sm hidden sm:block">·</span>
            <span className="text-slate-400 text-sm hidden sm:block">© {new Date().getFullYear()} Rsend</span>
          </div>
        </div>
      </footer>

      {/* ── Auth Modal ─────────────────────────────────────────────────────── */}
      {authOpen && (
        <AuthModal
          initialMode={authMode}
          onClose={() => setAuthOpen(false)}
        />
      )}
    </div>
  )
}
