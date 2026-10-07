// src/components/Help/HelpCenter.jsx
// Centre d'aide : bouton « ? » de l'en-tête + panneau latéral « Guide d'utilisation ».
// Contenu dans les fichiers de langue (help.sections.*), ici seulement l'ordre, les profils et les écrans liés.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import {
  HelpCircle, X, Search, ChevronLeft, ChevronRight, Lightbulb, AlertTriangle, ArrowRight, BookOpen,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useAuth } from '../../hooks/useAuth'

// Ordre des rubriques ; roles = profils pour lesquels la rubrique est mise en avant ('*' = tous les comptes internes)
const SECTIONS = [
  { id: 'overview', roles: ['*'] },
  { id: 'roles', roles: ['*'] },
  { id: 'tasks', roles: ['*'] },
  { id: 'requisitions', roles: ['requester'] },
  { id: 'approval', roles: ['manager', 'finance', 'dg', 'requester'] },
  { id: 'sourcing', roles: ['procurement'] },
  { id: 'tenders', roles: ['procurement'] },
  { id: 'suppliers', roles: ['procurement'] },
  { id: 'purchaseOrders', roles: ['procurement', 'management'] },
  { id: 'receiving', roles: ['logistic'] },
  { id: 'services', roles: ['requester'] },
  { id: 'invoices', roles: ['finance'] },
  { id: 'payments', roles: ['finance'] },
  { id: 'stock', roles: ['logistic'] },
  { id: 'issues', roles: ['logistic', 'requester'] },
  { id: 'equipment', roles: ['logistic'] },
  { id: 'dashboard', roles: ['*'] },
  { id: 'budget', roles: ['finance'] },
  { id: 'admin', roles: ['superadmin'] },
  { id: 'account', roles: ['*'] },
  { id: 'faq', roles: ['*'] },
]
const SUPPLIER_SECTIONS = ['supplierPortal', 'account']
const SUPERADMIN_SECTIONS = ['overview', 'roles', 'admin', 'account']
// Écrans accessibles à un compte fournisseur (cf. ProtectedRoute) : les autres liens sont masqués
const SUPPLIER_LINK = (to) => to.startsWith('/supplier/') || to === '/notifications'

// Écran courant → rubrique ouverte par défaut (préfixe le plus long d'abord)
const ROUTE_SECTIONS = [
  ['/stock/issues', 'issues'], ['/my-items', 'issues'],
  ['/stock/equipment', 'equipment'], ['/stock/returns', 'equipment'],
  ['/stock', 'stock'],
  ['/requisitions', 'requisitions'], ['/tasks', 'tasks'],
  ['/purchase-orders', 'purchaseOrders'], ['/goods-receipts', 'receiving'],
  ['/service-acceptance-notes', 'services'], ['/invoices', 'invoices'], ['/payments', 'payments'],
  ['/tenders', 'tenders'], ['/suppliers', 'suppliers'], ['/budget', 'budget'], ['/dashboard', 'dashboard'],
  ['/users', 'admin'], ['/projects', 'admin'], ['/departments', 'admin'], ['/settings', 'admin'], ['/admin', 'admin'],
  ['/profile', 'account'], ['/notifications', 'account'],
  ['/supplier', 'supplierPortal'],
]

const normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Texte brut d'une rubrique (recherche) */
function sectionText(sec) {
  const parts = [sec.title, sec.summary]
  for (const b of sec.blocks || []) {
    if (b.text) parts.push(b.text)
    if (b.items) parts.push(...b.items)
    if (b.rows) b.rows.forEach(r => parts.push(...r))
    if (b.links) b.links.forEach(l => parts.push(l.label))
  }
  for (const f of sec.faq || []) parts.push(f.q, f.a)
  return parts.join(' \n ')
}

/** Extrait autour de la première occurrence */
function snippet(text, q) {
  const n = normalize(text)
  const i = n.indexOf(q)
  if (i < 0) return ''
  const start = Math.max(0, i - 60)
  const end = Math.min(text.length, i + q.length + 90)
  return (start > 0 ? '… ' : '') + text.slice(start, end).replace(/\s*\n\s*/g, ' ') + (end < text.length ? ' …' : '')
}

function Block({ block, t, onNavigate, linkFilter }) {
  switch (block.type) {
    case 'h':
      return <h3 className="text-base font-semibold text-gray-900 mt-6 mb-2">{block.text}</h3>
    case 'p':
      return <p className="text-sm text-gray-700 leading-relaxed mb-3">{block.text}</p>
    case 'steps':
      return (
        <ol className="space-y-2 mb-4">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3 text-sm text-gray-700 leading-relaxed">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold flex items-center justify-center mt-0.5">{i + 1}</span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      )
    case 'list':
      return (
        <ul className="list-disc pl-5 space-y-1.5 mb-4 text-sm text-gray-700 leading-relaxed marker:text-blue-500">
          {block.items.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      )
    case 'table': {
      const [head, ...rows] = block.rows
      return (
        <div className="overflow-x-auto mb-4 border border-gray-200 rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>{head.map((h, i) => <th key={i} className="text-left px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => <td key={j} className={`px-3 py-2 align-top ${j === 0 ? 'font-medium text-gray-900 whitespace-nowrap' : 'text-gray-700'}`}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    case 'tip':
    case 'warn': {
      const warn = block.type === 'warn'
      const Icon = warn ? AlertTriangle : Lightbulb
      return (
        <div className={`flex gap-3 p-3 mb-4 rounded-lg border text-sm leading-relaxed ${warn ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-blue-50 border-blue-200 text-blue-900'}`}>
          <Icon size={18} className="flex-shrink-0 mt-0.5" />
          <div><span className="font-semibold">{warn ? t('help.warning') : t('help.tip')} : </span>{block.text}</div>
        </div>
      )
    }
    case 'links': {
      const links = block.links.filter(l => linkFilter(l.to))
      if (!links.length) return null
      return (
        <div className="mt-5 mb-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{t('help.quickLinks')}</div>
          <div className="flex flex-wrap gap-2">
            {links.map(l => (
              <Link key={l.to} to={l.to} onClick={onNavigate}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-full border border-blue-200 text-blue-700 hover:bg-blue-50">
                {l.label} <ArrowRight size={14} />
              </Link>
            ))}
          </div>
        </div>
      )
    }
    default:
      return null
  }
}

function HelpPanel({ onClose, initialSection, availableIds, highlighted, currentSection, linkFilter }) {
  const { t } = useTranslation()
  const sections = t('help.sections', { returnObjects: true }) || {}
  const [activeId, setActiveId] = useState(initialSection)
  const [query, setQuery] = useState('')
  const bodyRef = useRef(null)

  useEffect(() => { bodyRef.current?.scrollTo(0, 0) }, [activeId])

  const ids = availableIds.filter(id => sections[id])
  const q = normalize(query.trim())
  const results = useMemo(() => {
    if (q.length < 2) return null
    return ids
      .map(id => ({ id, text: sectionText(sections[id]) }))
      .filter(r => normalize(r.text).includes(q))
      .map(r => ({ id: r.id, snippet: snippet(r.text, q) }))
  }, [q, ids.join(), sections])

  const active = activeId && sections[activeId]
  const index = ids.indexOf(activeId)
  const prevId = index > 0 ? ids[index - 1] : null
  const nextId = index >= 0 && index < ids.length - 1 ? ids[index + 1] : null

  const open = (id) => { setActiveId(id); setQuery('') }

  const SectionButton = ({ id, extra }) => (
    <button onClick={() => open(id)}
      className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-gray-50 border border-transparent hover:border-gray-200 group">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-900 group-hover:text-blue-700">{sections[id].title}</span>
        <span className="flex items-center gap-2">
          {id === currentSection && <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-green-100 text-green-700">{t('help.thisPage')}</span>}
          <ChevronRight size={16} className="text-gray-400" />
        </span>
      </div>
      <div className="text-xs text-gray-500 mt-0.5">{extra || sections[id].summary}</div>
    </button>
  )

  const mine = ids.filter(id => highlighted.has(id))
  const others = ids.filter(id => !highlighted.has(id))

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={t('help.title')}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative w-full max-w-2xl h-full bg-white shadow-xl flex flex-col">
        {/* En-tête du panneau */}
        <div className="px-5 py-4 border-b border-gray-200">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center"><BookOpen size={18} /></div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{t('help.title')}</h2>
                <p className="text-xs text-gray-500">{t('help.subtitle')}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100" aria-label={t('help.close')}><X size={20} className="text-gray-600" /></button>
          </div>
          <div className="relative mt-3">
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('help.search')}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          </div>
        </div>

        {/* Corps */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto px-5 py-4">
          {results ? (
            <div>
              <div className="text-xs text-gray-500 mb-2">
                {results.length ? t('help.results', { count: results.length }) : t('help.noResult', { q: query.trim() })}
              </div>
              <div className="space-y-1">{results.map(r => <SectionButton key={r.id} id={r.id} extra={r.snippet} />)}</div>
            </div>
          ) : active ? (
            <article>
              <button onClick={() => setActiveId(null)} className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline mb-3">
                <ChevronLeft size={16} /> {t('help.back')}
              </button>
              <h2 className="text-xl font-bold text-gray-900">{active.title}</h2>
              <p className="text-sm text-gray-500 mt-1 mb-4">{active.summary}</p>
              {(active.blocks || []).map((b, i) => <Block key={i} block={b} t={t} onNavigate={onClose} linkFilter={linkFilter} />)}
              {active.faq && (
                <div className="space-y-2">
                  {active.faq.map((f, i) => (
                    <details key={i} className="group border border-gray-200 rounded-lg">
                      <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium text-gray-900 flex items-center justify-between gap-2">
                        {f.q}<ChevronRight size={16} className="text-gray-400 transition-transform group-open:rotate-90 flex-shrink-0" />
                      </summary>
                      <p className="px-3 pb-3 text-sm text-gray-700 leading-relaxed">{f.a}</p>
                    </details>
                  ))}
                </div>
              )}
              <div className="flex justify-between gap-3 mt-8 pt-4 border-t border-gray-100">
                {prevId ? (
                  <button onClick={() => open(prevId)} className="text-left text-sm text-gray-600 hover:text-blue-700">
                    <div className="text-xs text-gray-400 flex items-center gap-1"><ChevronLeft size={14} />{t('help.previous')}</div>
                    {sections[prevId].title}
                  </button>
                ) : <span />}
                {nextId && (
                  <button onClick={() => open(nextId)} className="text-right text-sm text-gray-600 hover:text-blue-700">
                    <div className="text-xs text-gray-400 flex items-center gap-1 justify-end">{t('help.next')}<ChevronRight size={14} /></div>
                    {sections[nextId].title}
                  </button>
                )}
              </div>
            </article>
          ) : (
            <div>
              {mine.length > 0 && others.length > 0 && (
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{t('help.forYou')}</div>
              )}
              {mine.length === 0 && <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{t('help.contents')}</div>}
              <div className="space-y-1">{(mine.length ? mine : others).map(id => <SectionButton key={id} id={id} />)}</div>
              {mine.length > 0 && others.length > 0 && (
                <>
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mt-5 mb-1">{t('help.others')}</div>
                  <div className="space-y-1">{others.map(id => <SectionButton key={id} id={id} />)}</div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 text-xs text-gray-500">{t('help.footer')}</div>
      </aside>
    </div>
  )
}

export default function HelpCenter() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const location = useLocation()
  const [isOpen, setIsOpen] = useState(false)

  const profileIds = (user?.profiles || []).map(p => p.id)
  const isSupplier = profileIds.includes('prof_supplier') && profileIds.length === 1
  const isSuperAdmin = profileIds.includes('prof_superadmin')
  const isAdmin = profileIds.includes('prof_admin')
  const roles = new Set(profileIds.map(id => id.replace(/^prof_/, '')))

  const availableIds = isSupplier ? SUPPLIER_SECTIONS
    : isSuperAdmin ? SUPERADMIN_SECTIONS
    : SECTIONS.map(s => s.id)

  // Rubriques mises en avant : celles des profils de l'utilisateur (tout pour un admin d'entreprise)
  const highlighted = new Set(isSupplier || isAdmin || isSuperAdmin ? availableIds
    : SECTIONS.filter(s => s.roles.includes('*') || s.roles.some(r => roles.has(r))).map(s => s.id))

  const currentSection = ROUTE_SECTIONS.find(([prefix]) =>
    location.pathname === prefix || location.pathname.startsWith(prefix + '/'))?.[1]
  const initialSection = availableIds.includes(currentSection) ? currentSection : null

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => { if (e.key === 'Escape') setIsOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen])

  return (
    <>
      <button onClick={() => setIsOpen(true)} className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
        aria-label={t('help.button')} title={t('help.button')}>
        <HelpCircle size={20} className="text-gray-600" />
      </button>
      {isOpen && createPortal(
        <HelpPanel onClose={() => setIsOpen(false)} initialSection={initialSection} availableIds={availableIds}
          highlighted={highlighted} currentSection={initialSection}
          linkFilter={isSupplier ? SUPPLIER_LINK : () => true} />,
        document.body)}
    </>
  )
}
