// src/components/Admin/ReferenceData.jsx — super admin : localisations (bureaux) et catégories de marché
import React, { useEffect, useState } from 'react';
import { MapPin, Tags, Plus, Pencil, Trash2, Check, X, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { locationService, categoryService } from '../../services/referenceService';
import { t, LANGUAGES } from '../../i18n';

// Langues traduites des référentiels (colonne translations) : toutes sauf le français (colonnes de base)
const OTHER_LANGS = LANGUAGES.map(l => l.code).filter(code => code !== 'fr');
const trName = (row, lang) => row.translations?.[lang]?.name || '';

// label / intro / extra.label : clés de traduction
const TABS = {
  locations: {
    label: 'refs.locations', icon: MapPin, service: locationService,
    intro: 'refs.locationsIntro',
    extra: { key: 'province', label: 'refs.province' },
  },
  categories: {
    label: 'refs.categories', icon: Tags, service: categoryService,
    intro: 'refs.categoriesIntro',
    extra: { key: 'description', label: 'common.description' },
    translated: true,
    stockable: true,
  },
};

const inputCls = 'w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function ReferenceData() {
  const [tab, setTab] = useState('locations');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ name: '', code: '', extra: '', tr: {} });
  const [editing, setEditing] = useState(null); // { id, name, extra }
  const cfg = TABS[tab];

  const load = async () => {
    setLoading(true);
    try {
      setRows((await cfg.service.list(true)).data || []);
    } catch (_) { /* toast */ } finally {
      setLoading(false);
    }
  };
  useEffect(() => { setEditing(null); setDraft({ name: '', code: '', extra: '', tr: {} }); load(); }, [tab]);

  // { en: 'Office supplies' } → { en: { name: 'Office supplies' } }
  const translationsPayload = (tr) => cfg.translated
    ? { translations: Object.fromEntries(OTHER_LANGS.map(l => [l, { name: tr?.[l] || '' }])) }
    : {};

  const add = async (e) => {
    e.preventDefault();
    if (!draft.name.trim()) return;
    try {
      await cfg.service.create({ name: draft.name, code: draft.code || undefined, [cfg.extra.key]: draft.extra, ...translationsPayload(draft.tr) });
      toast.success(t('refs.added', { name: draft.name }));
      setDraft({ name: '', code: '', extra: '', tr: {} });
      load();
    } catch (_) { /* toast */ }
  };

  const saveEdit = async () => {
    try {
      await cfg.service.update(editing.id, { name: editing.name, code: editing.code, [cfg.extra.key]: editing.extra, ...translationsPayload(editing.tr) });
      setEditing(null);
      load();
    } catch (_) { /* toast */ }
  };

  // Catégorie stockable : les articles de cette catégorie sont stockables par défaut (gestion de stock)
  const toggleStockable = async (row) => {
    try {
      await cfg.service.update(row.id, { is_stockable: !row.is_stockable });
      load();
    } catch (_) { /* toast */ }
  };

  const toggle = async (row) => {
    try {
      await cfg.service.update(row.id, { isActive: !row.is_active });
      load();
    } catch (_) { /* toast */ }
  };

  const remove = async (row) => {
    if (!window.confirm(t('refs.confirmDelete', { name: row.name }))) return;
    try {
      await cfg.service.remove(row.id);
      toast.success(t('refs.deleted'));
      load();
    } catch (_) { /* toast : utilisé → désactiver */ }
  };

  return (
    <div className="p-6 max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('refs.title')}</h1>
        <p className="text-sm text-gray-500">{t('refs.subtitle')}</p>
      </div>

      <div className="flex gap-2 border-b">
        {Object.entries(TABS).map(([k, tb]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <tb.icon size={16} /> {t(tb.label)}
          </button>
        ))}
      </div>
      <p className="text-sm text-gray-600">{t(cfg.intro)}{cfg.translated && <span className="block text-gray-500">{t('refs.translationHint')}</span>}</p>

      <form onSubmit={add} className="flex flex-wrap gap-2 bg-white border border-gray-200 rounded-lg p-3">
        <input className={`${inputCls} w-36 font-mono uppercase`} placeholder={t('refs.codeAuto')} value={draft.code} maxLength={50}
          onChange={e => setDraft(d => ({ ...d, code: e.target.value.toUpperCase() }))} title={t('refs.codeHint')} />
        <input className={`${inputCls} flex-1 min-w-[200px]`} placeholder={t('refs.name')} value={draft.name}
          onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} data-testid="ref-name" />
        {cfg.translated && OTHER_LANGS.map(l => (
          <input key={l} className={`${inputCls} flex-1 min-w-[200px]`} placeholder={t('refs.nameIn', { lang: l.toUpperCase() })}
            value={draft.tr[l] || ''} onChange={e => setDraft(d => ({ ...d, tr: { ...d.tr, [l]: e.target.value } }))} data-testid={`ref-name-${l}`} />
        ))}
        <input className={`${inputCls} flex-1 min-w-[160px]`} placeholder={t(cfg.extra.label)} value={draft.extra}
          onChange={e => setDraft(d => ({ ...d, extra: e.target.value }))} />
        <button type="submit" disabled={!draft.name.trim()}
          className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded text-sm disabled:opacity-50">
          <Plus size={16} /> {t('common.add')}
        </button>
      </form>

      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        {loading ? (
          <div className="flex justify-center p-8"><RefreshCw className="animate-spin text-blue-500" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-left">
              <tr>
                <th className="px-4 py-2">{t('refs.code')}</th>
                <th className="px-4 py-2">{t('refs.name')}</th>
                {cfg.translated && OTHER_LANGS.map(l => <th key={l} className="px-4 py-2">{t('refs.nameIn', { lang: l.toUpperCase() })}</th>)}
                <th className="px-4 py-2">{t(cfg.extra.label)}</th>
                {cfg.stockable && <th className="px-4 py-2">{t('refs.stockable')}</th>}
                <th className="px-4 py-2 text-right">{t('refs.suppliers')}</th>
                <th className="px-4 py-2">{t('common.status')}</th>
                <th className="px-4 py-2 text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(row => editing?.id === row.id ? (
                <tr key={row.id} className="bg-blue-50">
                  <td className="px-4 py-2"><input className={`${inputCls} font-mono uppercase`} value={editing.code} onChange={e => setEditing(x => ({ ...x, code: e.target.value.toUpperCase() }))} /></td>
                  <td className="px-4 py-2"><input className={inputCls} value={editing.name} onChange={e => setEditing(x => ({ ...x, name: e.target.value }))} /></td>
                  {cfg.translated && OTHER_LANGS.map(l => (
                    <td key={l} className="px-4 py-2"><input className={inputCls} value={editing.tr[l] || ''} onChange={e => setEditing(x => ({ ...x, tr: { ...x.tr, [l]: e.target.value } }))} /></td>
                  ))}
                  <td className="px-4 py-2"><input className={inputCls} value={editing.extra} onChange={e => setEditing(x => ({ ...x, extra: e.target.value }))} /></td>
                  {cfg.stockable && <td />}
                  <td className="px-4 py-2 text-right">{row.supplier_count}</td>
                  <td />
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button onClick={saveEdit} className="p-1.5 text-green-700 hover:bg-green-100 rounded" title={t('common.save')}><Check size={16} /></button>
                    <button onClick={() => setEditing(null)} className="p-1.5 text-gray-600 hover:bg-gray-100 rounded" title={t('common.cancel')}><X size={16} /></button>
                  </td>
                </tr>
              ) : (
                <tr key={row.id} className={row.is_active ? '' : 'text-gray-400'}>
                  <td className="px-4 py-2 font-mono text-xs">{row.code}</td>
                  <td className="px-4 py-2 font-medium">{row.name}</td>
                  {cfg.translated && OTHER_LANGS.map(l => <td key={l} className="px-4 py-2">{trName(row, l) || <span className="text-amber-600 text-xs">—</span>}</td>)}
                  <td className="px-4 py-2">{row[cfg.extra.key] || '—'}</td>
                  {cfg.stockable && (
                    <td className="px-4 py-2">
                      <input type="checkbox" checked={!!row.is_stockable} onChange={() => toggleStockable(row)} aria-label={t('refs.stockable')} title={t('refs.stockableHint')} />
                    </td>
                  )}
                  <td className="px-4 py-2 text-right">{row.supplier_count}</td>
                  <td className="px-4 py-2">
                    <button onClick={() => toggle(row)}
                      className={`px-2 py-0.5 rounded-full text-xs ${row.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}
                      title={row.is_active ? t('refs.deactivate') : t('refs.reactivate')}>
                      {row.is_active ? t('refs.active') : t('refs.inactive')}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button onClick={() => setEditing({ id: row.id, code: row.code || '', name: row.name, extra: row[cfg.extra.key] || '', tr: Object.fromEntries(OTHER_LANGS.map(l => [l, trName(row, l)])) })}
                      className="p-1.5 text-gray-600 hover:bg-gray-100 rounded" title={t('common.edit')}><Pencil size={16} /></button>
                    <button onClick={() => remove(row)} className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                      title={t('refs.deleteHint')}><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6 + (cfg.translated ? OTHER_LANGS.length : 0) + (cfg.stockable ? 1 : 0)} className="px-4 py-6 text-center text-gray-500">{t('refs.none')}</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
