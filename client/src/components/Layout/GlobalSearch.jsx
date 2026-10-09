// src/components/Layout/GlobalSearch.jsx
// Recherche globale de l'en-tête (GET /search?q=) : réquisitions, commandes, réceptions, factures, fournisseurs,
// appels d'offres, articles — selon les permissions de l'utilisateur. 2 caractères minimum, résultats groupés,
// clavier (↑ ↓ Entrée Échap), clic → fiche.
import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Loader2 } from 'lucide-react'
import api from '../../services/api'
import { t, hasKey } from '../../i18n'

export default function GlobalSearch({ className = '', inputClassName = '' }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [groups, setGroups] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef(null)
  const seq = useRef(0)

  const flat = groups.flatMap(g => g.items.map(it => ({ ...it, group: g.group })))

  // Recherche différée (300 ms) ; seule la dernière réponse est affichée
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setGroups([]); setLoading(false); return }
    setLoading(true)
    const id = ++seq.current
    const timer = setTimeout(async () => {
      try {
        const res = await api.get('/search', { params: { q }, skipErrorToast: true })
        if (id === seq.current) { setGroups(res.data?.data || []); setActive(0); setOpen(true) }
      } catch {
        if (id === seq.current) setGroups([])
      } finally {
        if (id === seq.current) setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const onDown = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const go = (item) => {
    if (!item) return
    setOpen(false)
    setQuery('')
    navigate(item.link)
  }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); return }
    if (!flat.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(i => (i + 1) % flat.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + flat.length) % flat.length) }
    else if (e.key === 'Enter') { e.preventDefault(); go(flat[active]) }
  }

  const q = query.trim()
  let index = -1

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => flat.length && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={t('header.searchPlaceholder')}
        aria-label={t('header.searchPlaceholder')}
        role="combobox"
        aria-expanded={open}
        data-testid="global-search"
        className={`pl-10 pr-9 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none ${inputClassName}`}
      />
      <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      {loading && <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}

      {open && q.length >= 2 && !loading && (
        <div className="absolute left-0 right-0 mt-1 max-h-[70vh] overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg z-50" role="listbox">
          {groups.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-500">{t('search.none', { q })}</p>
          ) : groups.map(g => (
            <div key={g.group} className="py-1">
              <div className="px-4 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{t(`search.groups.${g.group}`)}</div>
              {g.items.map(it => {
                index += 1
                const i = index
                return (
                  <button key={`${g.group}-${it.id}`} type="button" role="option" aria-selected={i === active}
                    onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => go(it)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm ${i === active ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                    <span className="min-w-0">
                      <span className="font-medium text-gray-900">{it.label}</span>
                      {it.sublabel && <span className="ml-2 truncate text-gray-500">{it.sublabel}</span>}
                    </span>
                    {it.status && <span className="flex-shrink-0 text-xs text-gray-400">{hasKey(`badge.${it.status}`) ? t(`badge.${it.status}`) : it.status}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
