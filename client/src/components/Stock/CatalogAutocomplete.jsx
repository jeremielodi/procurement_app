// src/components/Stock/CatalogAutocomplete.jsx
// Champ texte avec suggestions du catalogue d'articles (gestion de stock).
// - Le texte libre reste toujours possible (ligne non liée → jamais stockée)
// - Choisir une suggestion lie la ligne à l'article (pastille code · unité, × pour délier)
// inputProps : props d'un <input> (ex. register(...) de react-hook-form) ; onChange y est chaîné.
// La liste des suggestions est affichée en portail (position fixe) : jamais coupée par un tableau à défilement
// horizontal ni par une fenêtre ; elle s'ouvre vers le haut s'il manque de place en dessous.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Package, X } from 'lucide-react';
import { stockItemService } from '../../services/stockService';
import { t } from '../../i18n';

export default function CatalogAutocomplete({
  linked, onLink, onTextChange, inputProps = {}, placeholder, className = '', minChars = 2, disabled = false,
  allowUnlink = true,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState(null);
  const timer = useRef(null);
  const box = useRef(null);
  const list = useRef(null);

  // Position de la liste sous le champ (ou au-dessus s'il manque de place)
  const place = useCallback(() => {
    const r = box.current?.querySelector('input')?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const up = below < 260 && r.top > below;
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 288) - 8)),
      width: Math.max(r.width, 288),
      top: up ? undefined : r.bottom + 4,
      bottom: up ? window.innerHeight - r.top + 4 : undefined,
      maxHeight: Math.min(320, (up ? r.top : below) - 12),
    });
  }, []);

  // Fermeture au clic extérieur (le champ et la liste, affichée hors du composant, ne ferment pas)
  useEffect(() => {
    const close = (e) => {
      if (box.current?.contains(e.target) || list.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Liste ouverte : suit le champ au défilement (page, tableau, fenêtre) et au redimensionnement
  useEffect(() => {
    if (!open) return;
    place();
    const onScroll = (e) => { if (!list.current?.contains(e.target)) place(); };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  const search = (text) => {
    clearTimeout(timer.current);
    if (String(text || '').trim().length < minChars) { setSuggestions([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      try {
        const res = await stockItemService.search(text.trim(), 8);
        setSuggestions(res.data || []);
        setActive(-1);
        setOpen(true);
      } catch { setSuggestions([]); }
    }, 250);
  };

  const choose = (item) => {
    onLink?.(item);
    setOpen(false);
    setSuggestions([]);
  };

  const onKeyDown = (e) => {
    if (!open || !suggestions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(suggestions[active]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <input
        {...inputProps}
        disabled={disabled}
        autoComplete="off"
        placeholder={placeholder}
        className={className}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          inputProps.onChange?.(e);
          onTextChange?.(e.target.value);
          if (!linked) search(e.target.value);
        }}
        onFocus={(e) => { inputProps.onFocus?.(e); if (!linked && suggestions.length) setOpen(true); }}
      />
      {linked && (
        <div className="mt-1 inline-flex items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700" title={t('stock.picker.linkedHint')}>
          <Package size={12} />
          <span className="font-semibold">{linked.code}</span>
          <span>· {linked.unit}</span>
          {linked.is_stockable === false && <span className="text-gray-500">· {t('stock.notStockable')}</span>}
          {allowUnlink && !disabled && (
            <button type="button" onClick={() => onLink?.(null)} className="ml-0.5 rounded p-0.5 hover:bg-indigo-100" aria-label={t('stock.picker.unlink')} title={t('stock.picker.unlink')}>
              <X size={11} />
            </button>
          )}
        </div>
      )}
      {open && !linked && pos && createPortal(
        <ul
          ref={list}
          role="listbox"
          className="fixed z-[1000] overflow-auto rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg"
          style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
        >
          {suggestions.length === 0 && <li className="px-3 py-2 text-gray-500">{t('stock.picker.noMatch')}</li>}
          {suggestions.map((s, i) => (
            <li
              key={s.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); choose(s); }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-1.5 ${i === active ? 'bg-blue-50' : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span><span className="font-semibold text-gray-900">{s.code}</span> — {s.name}</span>
                <span className="shrink-0 text-xs text-gray-500">{s.unit}</span>
              </div>
              {(s.category_name || !s.is_stockable) && (
                <div className="text-xs text-gray-400">
                  {s.category_name}{!s.is_stockable && ` · ${t('stock.notStockable')}`}
                </div>
              )}
            </li>
          ))}
          <li className="border-t border-gray-100 px-3 py-1.5 text-xs text-gray-400">{t('stock.picker.freeTextHint')}</li>
        </ul>,
        document.body,
      )}
    </div>
  );
}
