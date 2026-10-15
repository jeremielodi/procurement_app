// src/components/Common/UserAvatar.jsx
// Photo de profil d'un utilisateur, ou ses initiales sur une couleur stable. La photo n'est jamais publique : elle est
// lue avec le jeton de l'utilisateur connecté (GET /users/:id/avatar, ou /auth/avatar pour soi-même) puis gardée en
// mémoire par utilisateur × version (avatarVersion = date de la dernière photo : une nouvelle photo change l'URL).
import React, { useEffect, useState } from 'react'
import { Popover } from 'antd'
import api from '../../services/api'

const cache = new Map() // `${url}|${version}` → Promise<objectURL | null>

function loadAvatar(url, version) {
  const key = `${url}|${version}`
  if (!cache.has(key)) {
    cache.set(key, api.get(url, { params: { v: version }, responseType: 'blob', skipErrorToast: true })
      .then(res => URL.createObjectURL(res.data))
      .catch(() => null))
  }
  return cache.get(key)
}

/** Oublie les photos en mémoire d'un utilisateur (après un changement de photo) */
export function forgetAvatar(userId) {
  for (const key of [...cache.keys()]) if (key.includes(`/${userId}/`) || (userId === 'self' && key.startsWith('/auth/avatar'))) cache.delete(key)
}

const COLORS = ['bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-violet-500', 'bg-cyan-600', 'bg-orange-500', 'bg-teal-600']
const colorOf = (seed) => COLORS[[...String(seed || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length]

export const initialsOf = (firstName, lastName, fallback) =>
  ((firstName?.[0] || '') + (lastName?.[0] || '')).toUpperCase() || String(fallback || '?')[0].toUpperCase()

/**
 * @param userId        id de l'utilisateur (absent + self : utilisateur connecté)
 * @param self          true : photo de l'utilisateur connecté (/auth/avatar, aussi pour les fournisseurs)
 * @param version       avatarVersion / avatar_updated_at — absente : pas de photo, initiales
 * @param firstName, lastName, name  pour les initiales et le texte alternatif
 * @param size          taille en px (défaut 32)
 * @param preview       photo en grand au survol (défaut : oui pour les petites pastilles, < 64 px)
 */
export default function UserAvatar({ userId, self = false, version, firstName, lastName, name, size = 32, className = '', title, preview = size < 64 }) {
  const [src, setSrc] = useState(null)
  const url = self ? '/auth/avatar' : userId ? `/users/${userId}/avatar` : null
  useEffect(() => {
    let alive = true
    setSrc(null)
    if (url && version) loadAvatar(url, version).then(objectUrl => { if (alive) setSrc(objectUrl) })
    return () => { alive = false }
  }, [url, version])

  const label = title || name || [firstName, lastName].filter(Boolean).join(' ')
  const [first, ...rest] = String(name || '').trim().split(/\s+/)
  const initials = initialsOf(firstName ?? first, lastName ?? rest.join(' '), label)
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.4)) }
  if (src) {
    const photo = <img src={src} alt={label} title={preview ? undefined : label} style={style} className={`shrink-0 rounded-full object-cover ${preview ? 'cursor-zoom-in' : ''} ${className}`} data-testid="user-avatar-photo" />
    if (!preview) return photo
    // Survol : la photo en grand (240 px) avec le nom
    return (
      <Popover mouseEnterDelay={0.15} placement="right" arrow={false} styles={{ body: { padding: 8 } }}
        content={(
          <div className="text-center" data-testid="user-avatar-preview">
            <img src={src} alt={label} className="h-60 w-60 rounded-lg object-cover" />
            {label && <div className="mt-2 text-sm font-medium text-gray-800">{label}</div>}
          </div>
        )}>
        {photo}
      </Popover>
    )
  }
  return (
    <span title={label} style={style} data-testid="user-avatar-initials"
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white ${colorOf(userId || label)} ${className}`}>
      {initials}
    </span>
  )
}
