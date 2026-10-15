// src/components/Common/AvatarPicker.jsx
// Choix de la photo de profil : l'image est recadrée en carré (centre) et réduite à 256 px dans le navigateur, puis
// envoyée (PUT /auth/avatar pour soi-même, PUT /users/:id/avatar pour l'administrateur). « Retirer » = initiales.
import React, { useRef, useState } from 'react'
import { Camera, Trash2, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import UserAvatar, { forgetAvatar } from './UserAvatar'
import { t } from '../../i18n'

const SIZE = 256
const ACCEPT = ['image/png', 'image/jpeg', 'image/webp']

/** Image → carré 256 px (centre), en WEBP (JPEG si le navigateur ne sait pas encoder le WEBP) */
async function squareImage(file) {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, SIZE, SIZE)
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE)
  const toBlob = (type) => new Promise(resolve => canvas.toBlob(resolve, type, 0.88))
  const webp = await toBlob('image/webp')
  return webp?.type === 'image/webp' ? webp : toBlob('image/jpeg')
}

/**
 * @param userId    utilisateur dont on change la photo (absent : utilisateur connecté)
 * @param version   avatarVersion actuelle (null : pas de photo)
 * @param onChange  (newVersion | null) → mise à jour de l'appelant (AuthContext, fiche utilisateur…)
 */
export default function AvatarPicker({ userId, version, firstName, lastName, onChange, size = 96 }) {
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  const self = !userId
  const url = self ? '/auth/avatar' : `/users/${userId}/avatar`

  const done = (newVersion) => {
    forgetAvatar(self ? 'self' : userId)
    onChange?.(newVersion)
  }

  const upload = async (file) => {
    if (!file) return
    if (!ACCEPT.includes(file.type)) { toast.error(t('avatar.err.AVATAR_TYPE')); return }
    if (file.size > 10 * 1024 * 1024) { toast.error(t('avatar.err.AVATAR_TOO_LARGE')); return }
    setBusy(true)
    try {
      const blob = await squareImage(file)
      const form = new FormData()
      form.append('avatar', blob, blob.type === 'image/webp' ? 'avatar.webp' : 'avatar.jpg')
      const res = await api.put(url, form, { headers: { 'Content-Type': 'multipart/form-data' }, skipErrorToast: true })
      done(res.data.data.avatarVersion)
      toast.success(t('avatar.saved'))
    } catch (error) {
      const code = error.response?.data?.code
      toast.error(t(`avatar.err.${code}`, { defaultValue: '' }) || t('avatar.err.generic'))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await api.delete(url)
      done(null)
      toast.success(t('avatar.removed'))
    } catch { /* toast api */ } finally { setBusy(false) }
  }

  return (
    <div className="flex items-center gap-4" data-testid="avatar-picker">
      <div className="relative">
        <UserAvatar self={self} userId={userId} version={version} firstName={firstName} lastName={lastName} size={size} />
        {busy && <span className="absolute inset-0 flex items-center justify-center rounded-full bg-white/60"><Loader2 className="animate-spin text-blue-600" /></span>}
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => input.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50" data-testid="avatar-choose">
            <Camera size={16} /> {version ? t('avatar.change') : t('avatar.add')}
          </button>
          {version && (
            <button type="button" disabled={busy} onClick={remove}
              className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50" data-testid="avatar-remove">
              <Trash2 size={16} /> {t('avatar.remove')}
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500">{t('avatar.hint')}</p>
        <input ref={input} type="file" accept={ACCEPT.join(',')} className="hidden" data-testid="avatar-file" onChange={(e) => upload(e.target.files?.[0])} />
      </div>
    </div>
  )
}
