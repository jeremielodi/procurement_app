// src/components/Common/SearchSelect.jsx
// Remplaçant de <select> avec recherche : mêmes props et mêmes <option> enfants.
// Un vrai <select> invisible reste en place (même id / name / ref / required / data-testid / onChange) :
// react-hook-form, la validation du navigateur, les <label htmlFor> et les tests (selectOption) fonctionnent
// sans changement. Le choix dans la liste écrit dans ce <select> et déclenche son événement « change ».
import React, { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search, Check } from 'lucide-react'
import { t } from '../../i18n'

const normalize = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Texte d'un nœud React (enfants d'une <option>) */
function nodeText(node) {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (React.isValidElement(node)) return nodeText(node.props.children)
  return ''
}

/** Liste à plat des <option> (fragments, tableaux, conditions, <optgroup>) */
function collectOptions(children, group = null, out = []) {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    if (child.type === React.Fragment) return collectOptions(child.props.children, group, out)
    if (child.type === 'optgroup') return collectOptions(child.props.children, child.props.label, out)
    if (child.type === 'option') {
      const label = nodeText(child.props.children)
      out.push({
        value: child.props.value !== undefined ? String(child.props.value) : label,
        label,
        disabled: !!child.props.disabled,
        group,
      })
    }
  })
  return out
}

const SearchSelect = forwardRef(function SearchSelect(
  { children, className = '', disabled, searchThreshold = 6, ...selectProps },
  forwardedRef,
) {
  const selectRef = useRef(null)
  const buttonRef = useRef(null)
  const listRef = useRef(null)
  const searchRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const [current, setCurrent] = useState('')
  const [pos, setPos] = useState(null)

  const options = useMemo(() => collectOptions(children), [children])
  const searchable = options.length >= searchThreshold

  const setRefs = useCallback((el) => {
    selectRef.current = el
    if (typeof forwardedRef === 'function') forwardedRef(el)
    else if (forwardedRef) forwardedRef.current = el
  }, [forwardedRef])

  // Valeur affichée = valeur réelle du <select> (contrôlé, react-hook-form, reset, test…)
  useLayoutEffect(() => {
    const v = selectRef.current?.value ?? ''
    if (v !== current) setCurrent(v)
  })
  useEffect(() => {
    const el = selectRef.current
    if (!el) return
    const sync = () => setCurrent(el.value)
    el.addEventListener('change', sync)
    return () => el.removeEventListener('change', sync)
  }, [])

  const selected = options.find(o => o.value === current)
  const q = normalize(query.trim())
  const filtered = q ? options.filter(o => normalize(o.label).includes(q) || normalize(o.group).includes(q)) : options

  const place = useCallback(() => {
    const r = buttonRef.current?.getBoundingClientRect()
    if (!r) return
    const below = window.innerHeight - r.bottom
    const maxHeight = 320
    const up = below < Math.min(maxHeight, 200) && r.top > below
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 240) - 8)),
      width: Math.max(r.width, 240),
      top: up ? undefined : r.bottom + 4,
      bottom: up ? window.innerHeight - r.top + 4 : undefined,
      maxHeight: Math.min(maxHeight, (up ? r.top : below) - 12),
    })
  }, [])

  const openList = () => {
    if (disabled) return
    place()
    setQuery('')
    setActive(Math.max(0, options.findIndex(o => o.value === current)))
    setOpen(true)
  }
  const close = (focusButton = true) => {
    setOpen(false)
    if (focusButton) buttonRef.current?.focus()
  }

  const choose = (opt) => {
    if (!opt || opt.disabled) return
    const el = selectRef.current
    if (el && el.value !== opt.value) {
      el.value = opt.value
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    setCurrent(opt.value)
    close()
  }

  // Fermeture : clic extérieur, défilement de la page, redimensionnement
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (listRef.current?.contains(e.target) || buttonRef.current?.contains(e.target)) return
      close(false)
    }
    const onScroll = (e) => { if (!listRef.current?.contains(e.target)) place() }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  useEffect(() => { if (open && searchable) searchRef.current?.focus() }, [open, searchable])
  useEffect(() => { setActive(filtered.length ? 0 : -1) }, [query]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open && active >= 0) listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const move = (delta) => {
    if (!filtered.length) return
    let i = active
    for (let n = 0; n < filtered.length; n++) {
      i = (i + delta + filtered.length) % filtered.length
      if (!filtered[i].disabled) break
    }
    setActive(i)
  }

  const onKeyDown = (e) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openList() }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(filtered[active]) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'Tab') close(false)
  }

  const label = selected ? selected.label : (options[0]?.value === '' ? options[0].label : '')
  const isPlaceholder = !selected || selected.value === ''

  // Classes de mise en page (largeur, marges, flex, grille) → conteneur ; apparence → bouton
  const { outerCls, innerCls } = useMemo(() => {
    const outer = [], inner = []
    for (const c of className.split(/\s+/).filter(Boolean)) {
      (/^(?:[a-z0-9]+:)*(?:w-|min-w-|max-w-|flex-|grow|shrink|basis-|-?m[trblxy]?-|col-|row-|self-|justify-self-|order-)/.test(c) ? outer : inner).push(c)
    }
    if (!outer.some(c => /(^|:)w-/.test(c))) outer.push('min-w-[9rem]')
    return { outerCls: outer.join(' '), innerCls: inner.join(' ') }
  }, [className])

  return (
    <div className={`relative inline-block align-middle ${outerCls}`}>
      <select
        {...selectProps}
        ref={setRefs}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        onFocus={(e) => { buttonRef.current?.focus(); selectProps.onFocus?.(e) }}
        className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
      >
        {children}
      </select>
      <button
        type="button"
        ref={buttonRef}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={selectProps['aria-label']}
        title={label}
        className={`${innerCls} w-full flex items-center justify-between gap-2 text-left bg-white disabled:bg-gray-100 disabled:cursor-not-allowed`}
      >
        <span className={`truncate ${isPlaceholder ? 'text-gray-500' : ''}`}>{label || ' '}</span>
        <ChevronDown size={16} className={`flex-shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && pos && createPortal(
        <div
          ref={listRef}
          onKeyDown={onKeyDown}
          className="fixed z-[1000] bg-white border border-gray-200 rounded-lg shadow-lg flex flex-col overflow-hidden"
          style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
        >
          {searchable && (
            <div className="relative p-2 border-b border-gray-100">
              <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('common.searchInList')}
                aria-label={t('common.searchInList')}
                className="w-full pl-8 pr-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          )}
          <ul role="listbox" className="overflow-y-auto py-1 text-sm" tabIndex={-1}>
            {filtered.length === 0 && <li className="px-3 py-2 text-gray-500">{t('common.noMatch')}</li>}
            {filtered.map((o, i) => {
              const showGroup = o.group && (i === 0 || filtered[i - 1].group !== o.group)
              return (
                <React.Fragment key={`${o.value}-${i}`}>
                  {showGroup && <li className="px-3 pt-2 pb-1 text-xs font-semibold uppercase text-gray-400">{o.group}</li>}
                  <li
                    role="option"
                    data-index={i}
                    aria-selected={o.value === current}
                    aria-disabled={o.disabled}
                    onMouseEnter={() => !o.disabled && setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(o)}
                    className={`px-3 py-2 flex items-center justify-between gap-2 ${o.disabled ? 'text-gray-400 cursor-default' : 'cursor-pointer'} ${i === active && !o.disabled ? 'bg-blue-50 text-blue-800' : ''} ${o.value === '' ? 'text-gray-500' : ''}`}
                  >
                    <span className="break-words">{o.label || ' '}</span>
                    {o.value === current && <Check size={15} className="flex-shrink-0 text-blue-600" />}
                  </li>
                </React.Fragment>
              )
            })}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  )
})

export default SearchSelect
