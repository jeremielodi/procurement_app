// src/components/Common/SignaturePicker.jsx
// Signature image de l'utilisateur connecté (GET / PUT / DELETE /auth/signature) : dessinée à la souris / au doigt
// ou importée (PNG / JPG / WEBP). L'image est rognée autour du tracé, réduite (600 px de large au plus) et envoyée en
// PNG (fond transparent conservé). Reprise dans les PDF des documents que l'utilisateur établit ou valide.
import React, { useEffect, useRef, useState } from 'react'
import { PenLine, Upload, Trash2, Loader2, Eraser } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import Modal from './Modal'
import { t } from '../../i18n'

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp']
const MAX_WIDTH = 600
const PAD_WIDTH = 560
const PAD_HEIGHT = 200

/** Zone non transparente (et non blanche) d'un canvas → { x, y, w, h } ou null si vide */
function contentBox(canvas) {
  const { width, height } = canvas
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const ink = data[i + 3] > 16 && (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235)
      if (ink) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  const m = 6
  const x = Math.max(0, minX - m), y = Math.max(0, minY - m)
  return { x, y, w: Math.min(width, maxX + m + 1) - x, h: Math.min(height, maxY + m + 1) - y }
}

/** Canvas → PNG rogné autour du tracé et réduit ; null si rien n'est dessiné */
function trimmedPng(source) {
  const box = contentBox(source)
  if (!box) return Promise.resolve(null)
  const scale = Math.min(1, MAX_WIDTH / box.w)
  const out = document.createElement('canvas')
  out.width = Math.round(box.w * scale)
  out.height = Math.round(box.h * scale)
  out.getContext('2d').drawImage(source, box.x, box.y, box.w, box.h, 0, 0, out.width, out.height)
  return new Promise(resolve => out.toBlob(resolve, 'image/png'))
}

/** Fenêtre de dessin */
function SignaturePad({ onCancel, onSave, busy }) {
  const canvas = useRef(null)
  const drawing = useRef(false)
  const [empty, setEmpty] = useState(true)

  useEffect(() => {
    const ctx = canvas.current.getContext('2d')
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0f172a'
  }, [])

  const point = (e) => {
    const r = canvas.current.getBoundingClientRect()
    return [(e.clientX - r.left) * (PAD_WIDTH / r.width), (e.clientY - r.top) * (PAD_HEIGHT / r.height)]
  }
  const down = (e) => {
    e.preventDefault()
    canvas.current.setPointerCapture(e.pointerId)
    drawing.current = true
    const ctx = canvas.current.getContext('2d')
    const [x, y] = point(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + 0.1, y + 0.1)
    ctx.stroke()
    setEmpty(false)
  }
  const move = (e) => {
    if (!drawing.current) return
    const ctx = canvas.current.getContext('2d')
    const [x, y] = point(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }
  const up = () => { drawing.current = false }
  const clear = () => {
    canvas.current.getContext('2d').clearRect(0, 0, PAD_WIDTH, PAD_HEIGHT)
    setEmpty(true)
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">{t('signature.drawHint')}</p>
      <canvas
        ref={canvas}
        width={PAD_WIDTH}
        height={PAD_HEIGHT}
        data-testid="signature-pad"
        className="w-full rounded-lg border-2 border-dashed border-gray-300 bg-white cursor-crosshair"
        style={{ touchAction: 'none', aspectRatio: `${PAD_WIDTH} / ${PAD_HEIGHT}` }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      <div className="flex flex-wrap justify-between gap-2">
        <button type="button" onClick={clear} disabled={busy || empty} className="inline-flex items-center gap-1 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50">
          <Eraser size={16} /> {t('signature.clear')}
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">{t('common.cancel')}</button>
          <button type="button" onClick={() => onSave(canvas.current)} disabled={busy || empty} data-testid="signature-pad-save"
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {busy ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * @param version   signatureVersion actuelle (null : pas de signature)
 * @param onChange  (newVersion | null) → mise à jour de l'appelant (AuthContext)
 */
export default function SignaturePicker({ version, onChange }) {
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  const [drawOpen, setDrawOpen] = useState(false)
  const [preview, setPreview] = useState(null)

  // Aperçu : la signature n'est jamais publique, elle est lue avec le jeton de l'utilisateur
  useEffect(() => {
    if (!version) { setPreview(null); return undefined }
    let url = null
    let cancelled = false
    api.get('/auth/signature', { params: { v: version }, responseType: 'blob', skipErrorToast: true })
      .then(res => { if (!cancelled) { url = URL.createObjectURL(res.data); setPreview(url) } })
      .catch(() => { if (!cancelled) setPreview(null) })
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [version])

  const send = async (blob) => {
    if (!blob) { toast.error(t('signature.err.SIGNATURE_REQUIRED')); return false }
    setBusy(true)
    try {
      const form = new FormData()
      form.append('signature', blob, 'signature.png')
      const res = await api.put('/auth/signature', form, { headers: { 'Content-Type': 'multipart/form-data' }, skipErrorToast: true })
      onChange?.(res.data.data.signatureVersion)
      toast.success(t('signature.saved'))
      return true
    } catch (error) {
      const code = error.response?.data?.code
      toast.error(t(`signature.err.${code}`, { defaultValue: '' }) || t('signature.err.generic'))
      return false
    } finally {
      setBusy(false)
    }
  }

  const saveDrawing = async (canvas) => {
    if (await send(await trimmedPng(canvas))) setDrawOpen(false)
  }

  const importFile = async (file) => {
    if (input.current) input.current.value = ''
    if (!file) return
    if (!ACCEPT.includes(file.type)) { toast.error(t('signature.err.SIGNATURE_TYPE')); return }
    if (file.size > 10 * 1024 * 1024) { toast.error(t('signature.err.SIGNATURE_TOO_LARGE')); return }
    const bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d').drawImage(bitmap, 0, 0)
    await send(await trimmedPng(canvas))
  }

  const remove = async () => {
    setBusy(true)
    try {
      await api.delete('/auth/signature')
      onChange?.(null)
      toast.success(t('signature.removed'))
    } catch { /* toast api */ } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4" data-testid="signature-picker">
      <div className="relative flex h-28 max-w-md items-center justify-center rounded-lg border border-gray-200 bg-gray-50 px-4">
        {preview
          ? <img src={preview} alt={t('signature.title')} className="max-h-24 max-w-full object-contain" data-testid="signature-preview" />
          : <span className="text-sm text-gray-400">{t('signature.none')}</span>}
        {busy && <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/60"><Loader2 className="animate-spin text-blue-600" /></span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setDrawOpen(true)} disabled={busy} data-testid="signature-draw"
          className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
          <PenLine size={16} /> {t('signature.draw')}
        </button>
        <button type="button" onClick={() => input.current?.click()} disabled={busy}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50">
          <Upload size={16} /> {t('signature.import')}
        </button>
        {version && (
          <button type="button" onClick={remove} disabled={busy} data-testid="signature-remove"
            className="inline-flex items-center gap-2 px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50">
            <Trash2 size={16} /> {t('signature.remove')}
          </button>
        )}
        <input ref={input} type="file" accept={ACCEPT.join(',')} className="hidden" data-testid="signature-file"
          onChange={(e) => importFile(e.target.files?.[0])} />
      </div>
      <p className="text-xs text-gray-500">{t('signature.usage')}</p>

      {drawOpen && (
        <Modal isOpen={drawOpen} onClose={() => !busy && setDrawOpen(false)} title={t('signature.drawTitle')} size="lg">
          <SignaturePad busy={busy} onCancel={() => setDrawOpen(false)} onSave={saveDrawing} />
        </Modal>
      )}
    </div>
  )
}
