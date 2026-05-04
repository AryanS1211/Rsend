import { useState, useRef } from 'react'
import { X, Camera, RotateCcw, Loader2 } from 'lucide-react'
import type { CapturedVisual } from '../types'

interface Props {
  dataSourceId: string
  dataSourceName: string
  initialScreenshotUrl: string
  onSave: (visual: CapturedVisual) => void
  onClose: () => void
}

type Step = 'drawing' | 'naming' | 'recapturing'
interface Rect { x: number; y: number; w: number; h: number }

// Grabs a single frame from a MediaStream and returns a PNG data URL.
// Tries ImageCapture first (Chrome/Edge), falls back to video element.
export async function captureFrameFromStream(stream: MediaStream): Promise<string> {
  const track = stream.getVideoTracks()[0]

  if (typeof (window as { ImageCapture?: unknown }).ImageCapture !== 'undefined') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ic = new (window as any).ImageCapture(track)
      await new Promise(r => setTimeout(r, 200))
      const bitmap: ImageBitmap = await ic.grabFrame()
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
      bitmap.close()
      stream.getTracks().forEach(t => t.stop())
      return canvas.toDataURL('image/png')
    } catch {
      // fall through to video element
    }
  }

  // Video element fallback
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  await video.play()

  await new Promise<void>((resolve, reject) => {
    let n = 0
    function tick() {
      if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 3) resolve()
      else if (n++ > 50) reject(new Error('timeout'))
      else setTimeout(tick, 150)
    }
    tick()
  })

  await new Promise(r => setTimeout(r, 300))

  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  canvas.getContext('2d')!.drawImage(video, 0, 0)
  video.srcObject = null
  stream.getTracks().forEach(t => t.stop())
  return canvas.toDataURL('image/png')
}

export default function ChartCaptureModal({ dataSourceId, dataSourceName, initialScreenshotUrl, onSave, onClose }: Props) {
  const [step, setStep] = useState<Step>('drawing')
  const [screenshotUrl, setScreenshotUrl] = useState(initialScreenshotUrl)
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null)
  const [name, setName] = useState('')

  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [startPos, setStartPos] = useState({ x: 0, y: 0 })
  const [selRect, setSelRect] = useState<Rect | null>(null)

  // Recapture — must be triggered by a user gesture so getDisplayMedia is allowed
  async function recapture() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      setStep('recapturing')
      const url = await captureFrameFromStream(stream)
      setScreenshotUrl(url)
      setSelRect(null)
      setStep('drawing')
    } catch {
      // User cancelled or capture failed — stay on current step
      setStep('drawing')
    }
  }

  // ── Mouse selection ───────────────────────────────────────────────────────────
  function getPos(e: React.MouseEvent<HTMLDivElement>): { x: number; y: number } {
    const r = e.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(e.clientX - r.left, r.width)),
      y: Math.max(0, Math.min(e.clientY - r.top, r.height)),
    }
  }

  function onMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault()
    const pos = getPos(e)
    setStartPos(pos); setSelRect(null); setIsDrawing(true)
  }

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!isDrawing) return
    const pos = getPos(e)
    setSelRect({
      x: Math.min(startPos.x, pos.x), y: Math.min(startPos.y, pos.y),
      w: Math.abs(pos.x - startPos.x), h: Math.abs(pos.y - startPos.y),
    })
  }

  function onMouseUp(e: React.MouseEvent<HTMLDivElement>) {
    if (!isDrawing) return
    setIsDrawing(false)
    const pos = getPos(e)
    const rect: Rect = {
      x: Math.min(startPos.x, pos.x), y: Math.min(startPos.y, pos.y),
      w: Math.abs(pos.x - startPos.x), h: Math.abs(pos.y - startPos.y),
    }
    if (rect.w < 10 || rect.h < 10) { setSelRect(null); return }
    cropRegion(rect)
  }

  function cropRegion(rect: Rect) {
    const img = imgRef.current
    const container = containerRef.current
    if (!img || !container) return

    const cW = container.clientWidth
    const cH = container.clientHeight
    const iW = img.naturalWidth
    const iH = img.naturalHeight

    const iAspect = iW / iH
    const cAspect = cW / cH
    let displayW: number, displayH: number, offsetX: number, offsetY: number
    if (iAspect > cAspect) {
      displayW = cW; displayH = cW / iAspect
      offsetX = 0; offsetY = (cH - displayH) / 2
    } else {
      displayH = cH; displayW = cH * iAspect
      offsetX = (cW - displayW) / 2; offsetY = 0
    }

    const sx = (rect.x - offsetX) / displayW * iW
    const sy = (rect.y - offsetY) / displayH * iH
    const sw = rect.w / displayW * iW
    const sh = rect.h / displayH * iH

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(sw))
    canvas.height = Math.max(1, Math.round(sh))
    canvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)

    setCapturedDataUrl(canvas.toDataURL('image/png'))
    setSelRect(null)
    setStep('naming')
  }

  function handleSave() {
    if (!name.trim() || !capturedDataUrl) return
    onSave({
      id: `vis_${Date.now()}`,
      name: name.trim(),
      dataSourceId,
      imageDataUrl: capturedDataUrl,
      createdAt: new Date().toISOString(),
    })
    onClose()
  }

  // ── Recapturing spinner ───────────────────────────────────────────────────────
  if (step === 'recapturing') {
    return (
      <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col items-center justify-center gap-4">
        <Loader2 size={36} className="text-indigo-400 animate-spin" />
        <p className="text-white text-sm font-semibold">Capturing screen…</p>
        <button onClick={onClose} className="mt-6 text-xs text-gray-600 hover:text-gray-400 transition-colors">
          Cancel
        </button>
      </div>
    )
  }

  // ── Drawing — fullscreen screenshot with selection tool ───────────────────────
  if (step === 'drawing') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-black select-none">
        {/* Instruction bar */}
        <div className="flex items-center justify-between px-5 py-3 bg-gray-900 border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-2 text-white text-sm">
            <Camera size={14} className="text-indigo-400" />
            <span className="font-semibold">Draw a rectangle around the chart</span>
            <span className="text-gray-400 text-xs ml-2">· click &amp; drag · release to crop</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={recapture}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
            >
              <RotateCcw size={11} /> Recapture
            </button>
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
            >
              <X size={12} /> Cancel
            </button>
          </div>
        </div>

        {/* Screenshot + selection overlay */}
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden"
          style={{ cursor: 'crosshair' }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={e => { if (isDrawing) onMouseUp(e) }}
        >
          <img
            ref={imgRef}
            src={screenshotUrl}
            alt="Screen capture"
            className="w-full h-full object-contain pointer-events-none"
            draggable={false}
          />

          {selRect && selRect.w > 2 && selRect.h > 2 && (
            <>
              <div className="absolute inset-0 pointer-events-none" style={{ backgroundColor: 'rgba(0,0,0,0.42)' }} />
              <div
                className="absolute pointer-events-none"
                style={{
                  left: selRect.x, top: selRect.y,
                  width: selRect.w, height: selRect.h,
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.42)',
                  border: '2.5px solid #6366f1',
                  backgroundColor: 'transparent',
                }}
              />
              <div
                className="absolute pointer-events-none text-xs text-white bg-indigo-600 px-2 py-0.5 rounded font-medium"
                style={{ left: selRect.x, top: Math.max(0, selRect.y - 24) }}
              >
                {Math.round(selRect.w)} × {Math.round(selRect.h)}
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  // ── Naming modal ──────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Camera size={15} className="text-indigo-500" />
            <h2 className="font-semibold text-slate-800 text-sm">Name &amp; Save Visual</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
            <img src={capturedDataUrl!} alt="Captured chart" className="w-full object-contain max-h-64" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Visual Name</label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="e.g. Weekly Sales Trend"
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={!name.trim()}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg transition-colors"
            >
              Save Visual
            </button>
            <button
              onClick={recapture}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <RotateCcw size={13} /> Recapture
            </button>
          </div>
          <p className="text-xs text-slate-400">
            Source: <span className="font-medium text-slate-500">{dataSourceName}</span>
          </p>
        </div>
      </div>
    </div>
  )
}
