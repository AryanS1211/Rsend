import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  User, AlertTriangle, CheckCircle,
  LogOut, Mail, ExternalLink, Eye, EyeOff, Trash2, Cloud, Upload, Pencil,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import emailjs from '@emailjs/browser'

// ─── Toast ────────────────────────────────────────────────────────────────────
interface Toast { id: number; text: string; kind: 'success' | 'error' }
function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])
  function show(text: string, kind: 'success' | 'error' = 'success') {
    const id = Date.now()
    setToasts(prev => [...prev, { id, kind, text }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
  }
  return { toasts, show }
}

function ToastContainer({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed top-5 right-5 z-50 space-y-2">
      {toasts.map(t => (
        <div key={t.id} className={`flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${t.kind === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          <CheckCircle size={14} />
          {t.text}
        </div>
      ))}
    </div>
  )
}

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
        <span className="text-indigo-500">{icon}</span>
        <h2 className="font-semibold text-slate-700 text-sm">{title}</h2>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  )
}

export default function Settings() {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()
  const { toasts, show } = useToast()
  const user = state.user

  // EmailJS config
  const saved = state.emailjsConfig
  const ejConfigured = !!(saved?.serviceId && saved?.templateId && saved?.publicKey)
  const [ejEditing, setEjEditing] = useState(!ejConfigured)
  const [ejServiceId, setEjServiceId] = useState(ejConfigured ? saved!.serviceId : '')
  const [ejTemplateId, setEjTemplateId] = useState(ejConfigured ? saved!.templateId : '')
  const [ejPublicKey, setEjPublicKey] = useState(ejConfigured ? saved!.publicKey : '')
  const [showKey, setShowKey] = useState(false)
  const [testingEmail, setTestingEmail] = useState(false)

  // Cloudinary config
  const savedCloud = state.cloudinaryConfig
  const cloudConfigured = !!(savedCloud?.cloudName && savedCloud?.uploadPreset)
  const [cloudEditing, setCloudEditing] = useState(!cloudConfigured)
  const [cloudName, setCloudName] = useState(cloudConfigured ? savedCloud!.cloudName : '')
  const [uploadPreset, setUploadPreset] = useState(cloudConfigured ? savedCloud!.uploadPreset : '')
  const [testingCloud, setTestingCloud] = useState(false)

  // Sync form fields when Supabase data loads — only populate when config is complete
  useEffect(() => {
    const cfg = state.emailjsConfig
    const complete = !!(cfg?.serviceId && cfg?.templateId && cfg?.publicKey)
    if (complete) {
      setEjServiceId(cfg!.serviceId)
      setEjTemplateId(cfg!.templateId)
      setEjPublicKey(cfg!.publicKey)
      setEjEditing(false)
    } else {
      setEjServiceId('')
      setEjTemplateId('')
      setEjPublicKey('')
      setEjEditing(true)
      // Wipe any partial/corrupt config from Supabase
      if (cfg !== null) dispatch({ type: 'SET_EMAILJS_CONFIG', payload: null })
    }
  }, [state.emailjsConfig])

  useEffect(() => {
    const cfg = state.cloudinaryConfig
    const complete = !!(cfg?.cloudName && cfg?.uploadPreset)
    if (complete) {
      setCloudName(cfg!.cloudName)
      setUploadPreset(cfg!.uploadPreset)
      setCloudEditing(false)
    } else {
      setCloudName('')
      setUploadPreset('')
      setCloudEditing(true)
    }
  }, [state.cloudinaryConfig])

  // Danger zone
  const [clearConfirm, setClearConfirm] = useState(false)

  function handleSaveEmailJS() {
    if (!ejServiceId.trim() || !ejTemplateId.trim() || !ejPublicKey.trim()) {
      show('All three EmailJS fields are required.', 'error')
      return
    }
    dispatch({
      type: 'SET_EMAILJS_CONFIG',
      payload: {
        serviceId: ejServiceId.trim(),
        templateId: ejTemplateId.trim(),
        publicKey: ejPublicKey.trim(),
      },
    })
    setEjEditing(false)
    show('EmailJS configuration saved!')
  }

  async function handleTestEmailJS() {
    if (!ejServiceId.trim() || !ejTemplateId.trim() || !ejPublicKey.trim()) {
      show('Save your EmailJS config first.', 'error')
      return
    }
    setTestingEmail(true)
    try {
      await emailjs.send(
        ejServiceId.trim(),
        ejTemplateId.trim(),
        {
          to_email: user?.email ?? '',
          from_name: 'Rsend',
          reply_to: user?.email ?? '',
          subject: 'Rsend — EmailJS Test',
          message: 'Your EmailJS integration is working correctly. You can now send reports from Rsend.',
          attachments_info: '(no attachments — this is a test)',
        },
        ejPublicKey.trim(),
      )
      show('Test email sent! Check your inbox.')
    } catch {
      show('Failed to send. Double-check your Service ID, Template ID, and Public Key.', 'error')
    } finally {
      setTestingEmail(false)
    }
  }

  function handleRemoveEmailJS() {
    dispatch({ type: 'SET_EMAILJS_CONFIG', payload: null })
    setEjServiceId('')
    setEjTemplateId('')
    setEjPublicKey('')
    setEjEditing(true)
    show('EmailJS configuration removed.')
  }

  function handleSaveCloudinary() {
    if (!cloudName.trim() || !uploadPreset.trim()) {
      show('Both Cloud Name and Upload Preset are required.', 'error')
      return
    }
    dispatch({
      type: 'SET_CLOUDINARY_CONFIG',
      payload: { cloudName: cloudName.trim(), uploadPreset: uploadPreset.trim() },
    })
    setCloudEditing(false)
    show('Cloudinary configuration saved!')
  }

  async function handleTestCloudinary() {
    if (!cloudName.trim() || !uploadPreset.trim()) {
      show('Save your Cloudinary config first.', 'error')
      return
    }
    setTestingCloud(true)
    try {
      // Upload a tiny 1×1 PNG as a smoke test
      const tiny = await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')
      const blob = await tiny.blob()
      const fd = new FormData()
      fd.append('file', blob, 'test.png')
      fd.append('upload_preset', uploadPreset.trim())
      const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName.trim()}/image/upload`, {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      show('Cloudinary connected! Test upload successful.')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      show(`Cloudinary test failed: ${msg}`, 'error')
    } finally {
      setTestingCloud(false)
    }
  }

  function handleRemoveCloudinary() {
    dispatch({ type: 'SET_CLOUDINARY_CONFIG', payload: null })
    setCloudName('')
    setUploadPreset('')
    setCloudEditing(true)
    show('Cloudinary configuration removed.')
  }

  function handleClearDataSources() {
    if (!clearConfirm) { setClearConfirm(true); return }
    state.dataSources.forEach(ds => dispatch({ type: 'REMOVE_DATA_SOURCE', payload: ds.id }))
    setClearConfirm(false)
    show('All data sources cleared.')
  }

  function handleLogout() {
    dispatch({ type: 'LOGOUT' })
    navigate('/login')
  }

  const initials = user?.name?.trim().charAt(0).toUpperCase() ?? '?'

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <ToastContainer toasts={toasts} />

      {/* Page header */}
      <div className="mb-6 pb-6 border-b border-slate-200/70">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Account</p>
        <h1 className="text-2xl font-bold text-slate-800">Settings</h1>
        <p className="text-slate-500 text-sm mt-1">Manage your preferences and account settings.</p>
      </div>

      {/* ── Profile ── */}
      <Section icon={<User size={16} />} title="Profile">
        <div className="flex items-center gap-5">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-md">
            <span className="text-white text-2xl font-bold">{initials}</span>
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-1">Logged in as</p>
            <p className="text-lg font-semibold text-slate-800">{user?.name}</p>
            <p className="text-sm text-slate-500">{user?.email}</p>
          </div>
        </div>
        <p className="text-xs text-slate-400 mt-4 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
          Your email is used for all report deliveries and alert notifications.
        </p>
      </Section>

      {/* ── Email Integration (EmailJS) ── */}
      <Section icon={<Mail size={16} />} title="Email Integration">
        <div className="space-y-4">
          {/* Status banner */}
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm ${
            ejConfigured
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-amber-50 border-amber-200 text-amber-700'
          }`}>
            {ejConfigured ? <CheckCircle size={15} /> : <AlertTriangle size={15} />}
            <div className="flex-1">
              {ejConfigured
                ? <><span className="font-semibold">EmailJS connected.</span> Emails will be delivered to real inboxes.</>
                : <><span className="font-semibold">Not configured.</span> Set up EmailJS below to send real emails.</>
              }
            </div>
          </div>

          {/* Setup instructions */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 text-xs text-slate-600 space-y-2">
            <p className="font-semibold text-slate-700">Quick setup (free, 200 emails/month):</p>
            <ol className="list-decimal list-inside space-y-1 leading-relaxed">
              <li>Create a free account at <a href="https://www.emailjs.com" target="_blank" rel="noreferrer" className="text-indigo-600 underline inline-flex items-center gap-0.5">emailjs.com <ExternalLink size={10} /></a></li>
              <li>Add an <strong>Email Service</strong> (Gmail, Outlook, etc.) → copy the <strong>Service ID</strong></li>
              <li>Create an <strong>Email Template</strong> with variables below → copy the <strong>Template ID</strong></li>
              <li>Go to <strong>Account → API Keys</strong> → copy the <strong>Public Key</strong></li>
            </ol>
            <div className="mt-3 border-t border-slate-200 pt-3">
              <p className="font-semibold text-slate-700 mb-1">Required template variables:</p>
              <div className="font-mono bg-white rounded-lg border border-slate-200 px-3 py-2 space-y-0.5">
                {['{{to_email}}', '{{from_name}}', '{{reply_to}}', '{{subject}}', '{{message}}', '{{{attachments_info}}}'].map(v => (
                  <div key={v} className="text-indigo-600">{v}</div>
                ))}
              </div>
            </div>
          </div>

          {/* Saved view */}
          {ejConfigured && !ejEditing ? (
            <div className="space-y-3">
              <div className="bg-slate-50 rounded-xl border border-slate-200 divide-y divide-slate-200">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">Service ID</span>
                  <span className="text-sm text-slate-800 font-mono flex-1">{saved?.serviceId}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">Template ID</span>
                  <span className="text-sm text-slate-800 font-mono flex-1">{saved?.templateId}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">Public Key</span>
                  <span className="text-sm text-slate-800 font-mono flex-1">{'•'.repeat(20)}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={() => setEjEditing(true)}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                >
                  <Pencil size={14} /> Edit
                </button>
                <button
                  onClick={handleTestEmailJS}
                  disabled={testingEmail}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors disabled:opacity-60"
                >
                  <Mail size={14} className={testingEmail ? 'animate-pulse' : ''} />
                  {testingEmail ? 'Sending test…' : 'Send Test Email'}
                </button>
                <button
                  onClick={handleRemoveEmailJS}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                >
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Edit / Add form */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Service ID</label>
                  <input
                    value={ejServiceId}
                    onChange={e => setEjServiceId(e.target.value)}
                    placeholder="service_xxxxxxx"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Template ID</label>
                  <input
                    value={ejTemplateId}
                    onChange={e => setEjTemplateId(e.target.value)}
                    placeholder="template_xxxxxxx"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Public Key</label>
                <div className="relative">
                  <input
                    value={ejPublicKey}
                    onChange={e => setEjPublicKey(e.target.value)}
                    type={showKey ? 'text' : 'password'}
                    placeholder="xxxxxxxxxxxxxxxxxxxx"
                    className="w-full border border-slate-200 rounded-lg pl-3 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  <button type="button" onClick={() => setShowKey(v => !v)} className="absolute right-3 top-3 text-slate-400 hover:text-slate-600">
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button onClick={handleSaveEmailJS} className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors">
                  Save Configuration
                </button>
                {ejConfigured && (
                  <button onClick={() => setEjEditing(false)} className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                    Cancel
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </Section>

      {/* ── Cloud Storage (Cloudinary) ── */}
      <Section icon={<Cloud size={16} />} title="Cloud Storage — File Attachments">
        <div className="space-y-4">
          {/* Status */}
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm ${
            cloudConfigured
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-slate-50 border-slate-200 text-slate-600'
          }`}>
            {cloudConfigured ? <CheckCircle size={15} /> : <Cloud size={15} className="text-slate-400" />}
            <div className="flex-1">
              {cloudConfigured
                ? <><span className="font-semibold">Cloudinary connected.</span> Files up to 100 MB can be attached to emails via cloud links.</>
                : <><span className="font-semibold">Not configured.</span> Without this, files &gt;25 MB cannot be sent. Small files will be listed as text in the email.</>
              }
            </div>
          </div>

          {/* How it works */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 text-xs text-slate-600 space-y-2">
            <p className="font-semibold text-slate-700">How it works:</p>
            <ul className="list-disc list-inside space-y-1 leading-relaxed">
              <li>Files &lt; 25 MB — uploaded to Cloudinary, secure link sent in email</li>
              <li>Files &gt; 25 MB — same, Cloudinary handles large files up to 100 MB (free plan)</li>
              <li>Recipients click the link to download — no size issues in email</li>
            </ul>
            <div className="border-t border-slate-200 pt-3 mt-2">
              <p className="font-semibold text-slate-700 mb-1">Setup (free, 25 GB storage):</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Create account at <a href="https://cloudinary.com" target="_blank" rel="noreferrer" className="text-indigo-600 underline inline-flex items-center gap-0.5">cloudinary.com <ExternalLink size={10} /></a></li>
                <li>Dashboard → copy your <strong>Cloud Name</strong></li>
                <li>Settings → Upload → Add upload preset → set to <strong>Unsigned</strong> → copy preset name</li>
              </ol>
            </div>
          </div>

          {/* Saved view */}
          {cloudConfigured && !cloudEditing ? (
            <div className="space-y-3">
              <div className="bg-slate-50 rounded-xl border border-slate-200 divide-y divide-slate-200">
                <div className="flex items-center px-4 py-3">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider w-36">Cloud Name</span>
                  <span className="text-sm text-slate-800 font-mono flex-1">{savedCloud?.cloudName}</span>
                </div>
                <div className="flex items-center px-4 py-3">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider w-36">Upload Preset</span>
                  <span className="text-sm text-slate-800 font-mono flex-1">{savedCloud?.uploadPreset}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={() => setCloudEditing(true)}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                >
                  <Pencil size={14} /> Edit
                </button>
                <button
                  onClick={handleTestCloudinary}
                  disabled={testingCloud}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors disabled:opacity-60"
                >
                  <Upload size={14} className={testingCloud ? 'animate-bounce' : ''} />
                  {testingCloud ? 'Testing upload…' : 'Test Upload'}
                </button>
                <button
                  onClick={handleRemoveCloudinary}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                >
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Cloud Name</label>
                  <input
                    value={cloudName}
                    onChange={e => setCloudName(e.target.value)}
                    placeholder="e.g. my-cloud-name"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Upload Preset (Unsigned)</label>
                  <input
                    value={uploadPreset}
                    onChange={e => setUploadPreset(e.target.value)}
                    placeholder="e.g. rsend_uploads"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button onClick={handleSaveCloudinary} className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors">
                  Save Configuration
                </button>
                {cloudConfigured && (
                  <button onClick={() => setCloudEditing(false)} className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                    Cancel
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </Section>

      {/* ── Danger Zone ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-red-100 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-red-100">
          <AlertTriangle size={16} className="text-red-500" />
          <h2 className="font-semibold text-red-700 text-sm">Danger Zone</h2>
        </div>
        <div className="px-6 py-5 space-y-3">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium text-slate-700">Clear All Data Sources</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Permanently remove all connected sheets and CSV files.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {clearConfirm && (
                <button
                  onClick={() => setClearConfirm(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={handleClearDataSources}
                disabled={state.dataSources.length === 0}
                className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  clearConfirm
                    ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                    : 'text-red-600 border-red-300 hover:bg-red-50'
                }`}
              >
                {clearConfirm ? 'Confirm Clear' : 'Clear All Data Sources'}
              </button>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3 flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium text-slate-700">Sign Out</p>
              <p className="text-xs text-slate-400 mt-0.5">You will be redirected to the login page.</p>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 border border-red-300 hover:bg-red-50 rounded-lg transition-colors"
            >
              <LogOut size={14} />
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
