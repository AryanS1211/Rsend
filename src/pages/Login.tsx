import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Eye, EyeOff } from 'lucide-react'
import { useApp } from '../context/AppContext'
import * as db from '../lib/db'

const features = [
  'Send reports directly from Google Sheets & files',
  'Auto-generate charts and schedule email delivery',
  'Threshold alerts when your data changes',
]

export default function Login() {
  const { dispatch } = useApp()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
        if (result === 'exists') {
          setError('An account with this email already exists. Please sign in.')
          return
        }
        dispatch({ type: 'LOGIN', payload: { name: name.trim(), email: email.trim().toLowerCase() } })
        navigate('/import')
      } else {
        const user = await db.signInUser(email.trim(), password)
        if (!user) {
          setError('Incorrect email or password. Please try again.')
          return
        }
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
    <div className="min-h-screen bg-[#F1F5F9] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo mark */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg mb-4">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-white">
              <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Rsend</h1>
          <p className="text-slate-500 text-sm mt-1">Email delivery from your Sheets & Files</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-7">

          {/* Features */}
          <div className="mb-6 space-y-2">
            {features.map((f) => (
              <div key={f} className="flex items-center gap-2.5">
                <span className="flex-shrink-0 w-4 h-4 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                  <Check size={9} className="text-indigo-600" strokeWidth={3} />
                </span>
                <span className="text-sm text-slate-500">{f}</span>
              </div>
            ))}
          </div>

          {/* Mode toggle */}
          <div className="flex rounded-xl border border-slate-200 p-1 mb-5 bg-slate-50">
            <button type="button"
              onClick={() => { setMode('signin'); setError('') }}
              className={`flex-1 text-sm py-1.5 rounded-lg font-medium transition-all ${mode === 'signin' ? 'bg-white shadow-sm text-slate-800 border border-slate-200/80' : 'text-slate-400 hover:text-slate-600'}`}
            >Sign In</button>
            <button type="button"
              onClick={() => { setMode('signup'); setError('') }}
              className={`flex-1 text-sm py-1.5 rounded-lg font-medium transition-all ${mode === 'signup' ? 'bg-white shadow-sm text-slate-800 border border-slate-200/80' : 'text-slate-400 hover:text-slate-600'}`}
            >Create Account</button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-100 text-red-600 text-sm px-3 py-2.5 rounded-xl">
                {error}
              </div>
            )}

            {mode === 'signup' && (
              <div>
                <label htmlFor="name" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Full Name</label>
                <input id="name" type="text" required value={name}
                  onChange={e => { setName(e.target.value); setError('') }}
                  placeholder="Sarah Johnson"
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent transition bg-white"
                />
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Email Address</label>
              <input id="email" type="email" required value={email}
                onChange={e => { setEmail(e.target.value); setError('') }}
                placeholder="sarah@company.com"
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent transition bg-white"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Password</label>
              <div className="relative">
                <input id="password" type={showPassword ? 'text' : 'password'} required value={password}
                  onChange={e => { setPassword(e.target.value); setError('') }}
                  placeholder="Min. 6 characters"
                  className="w-full px-3.5 py-2.5 pr-10 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent transition bg-white"
                />
                <button type="button" onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors duration-150 shadow-sm mt-1"
            >
              {loading ? 'Please wait…' : mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-400 mt-5">
          Secure · Private · No credit card required
        </p>
      </div>
    </div>
  )
}
