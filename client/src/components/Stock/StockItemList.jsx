// src/components/Stock/StockItemList.jsx
// Catalogue d'articles de l'entreprise : code, désignation, unité, catégorie, stockable, suivi par lot / péremption,
// stock minimum et quantité de réapprovisionnement. Création / modification : MANAGE_STOCK_ITEMS (logistique, achats, admin).
// « Réapprovisionner » : articles sous le minimum → formulaire de réquisition pré-rempli (articles du catalogue).
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Boxes, Plus, Pencil, RefreshCw, Search, AlertTriangle, ShoppingCart } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import { stockItemService } from '../../services/stockService';
import { categoryService } from '../../services/referenceService';
import { usePermissions } from '../../hooks/usePermissions';
import { t, getLocale, useTranslation } from '../../i18n';
import SearchSelect from '../Common/SearchSelect';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const UNITS = ['pce', 'boîte', 'carton', 'paquet', 'rame', 'L', 'kg', 't', 'm', 'm²', 'm³', 'sac', 'lot', 'kit', 'paire'];
const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);
/** Quantité proposée : quantité de réapprovisionnement de l'article, sinon de quoi remonter à 2 × le minimum */
export const suggestedRestock = (it) => {
  const stock = Number(it.stock_quantity) || 0;
  const min = Number(it.min_quantity) || 0;
  const qty = it.reorder_quantity ? Number(it.reorder_quantity) : Math.max(2 * min - stock, min - stock);
  return Math.max(1, Math.ceil(qty));
};

const EMPTY = { code: '', name: '', description: '', unit: 'pce', categoryId: '', isStockable: true, trackLots: false, trackExpiry: false, trackSerials: false, minQuantity: '', reorderQuantity: '' };

export default function StockItemList() {
  const { lang } = useTranslation();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission('MANAGE_STOCK_ITEMS');
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const belowMinRows = rows.filter(it => it.is_active && it.is_stockable && it.min_quantity !== null && Number(it.stock_quantity) < Number(it.min_quantity));
  const restock = async () => {
    try {
      const res = await stockItemService.list({ belowMin: 1, limit: 200 });
      const items = (res.data || []).filter(it => it.is_active && it.is_stockable);
      if (!items.length) { toast(t('stock.items.nothingToRestock')); return; }
      navigate('/requisitions/new', { state: { prefill: {
        title: t('stock.items.restockTitle', { date: new Date().toLocaleDateString(getLocale()) }),
        justification: t('stock.items.restockJustification', { list: items.map(it => `${it.code} (${fmtQty(it.stock_quantity)} / ${fmtQty(it.min_quantity)} ${it.unit})`).join(', ') }),
        items: items.map(it => ({ quantity: suggestedRestock(it), stockItem: { id: it.id, code: it.code, name: it.name, unit: it.unit, is_stockable: it.is_stockable, track_lots: it.track_lots, track_serials: it.track_serials } })),
      } } });
    } catch { /* toast api */ }
  };
  const [pagination, setPagination] = useState({});
  const [categories, setCategories] = useState([]);
  const [params] = useSearchParams();
  const [filters, setFilters] = useState({ search: '', categoryId: '', stockable: '', belowMin: params.get('belowMin') === '1', all: false });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { categoryService.listPublic().then(r => setCategories(r.data || [])).catch(() => {}); }, [lang]);

  // Recherche différée (pas de requête à chaque lettre)
  const [debounced, setDebounced] = useState(filters);
  useEffect(() => { const id = setTimeout(() => { setDebounced(filters); setPage(1); }, 300); return () => clearTimeout(id); }, [filters]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await stockItemService.list({
        search: debounced.search || undefined, categoryId: debounced.categoryId || undefined,
        stockable: debounced.stockable || undefined, belowMin: debounced.belowMin ? 1 : undefined,
        all: debounced.all ? 1 : undefined, page, limit: 50,
      });
      setRows(res.data || []);
      setPagination(res.pagination || {});
    } catch { /* toast api */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [debounced, page, lang]);

  const openEdit = (it) => setEditing({
    id: it.id, code: it.code, name: it.name, description: it.description || '', unit: it.unit, categoryId: it.category_id ? String(it.category_id) : '',
    isStockable: it.is_stockable, trackLots: it.track_lots, trackExpiry: it.track_expiry, trackSerials: it.track_serials,
    minQuantity: it.min_quantity !== null && it.min_quantity !== undefined ? String(Number(it.min_quantity)) : '',
    reorderQuantity: it.reorder_quantity !== null && it.reorder_quantity !== undefined ? String(Number(it.reorder_quantity)) : '',
    isActive: it.is_active, hasStock: Number(it.stock_quantity) > 0,
  });

  // Catégorie choisie à la création : « stockable » suit la catégorie
  const onCategory = (categoryId) => {
    const cat = categories.find(c => String(c.id) === String(categoryId));
    setEditing(e => ({ ...e, categoryId, ...(!e.id && cat ? { isStockable: !!cat.is_stockable, ...(cat.is_stockable ? {} : { trackLots: false, trackExpiry: false }) } : {}) }));
  };

  const save = async () => {
    if (!editing.code.trim() || !editing.name.trim() || !editing.unit.trim()) { toast.error(t('stock.items.required')); return; }
    setSaving(true);
    try {
      const payload = {
        code: editing.code.trim(), name: editing.name.trim(), description: editing.description, unit: editing.unit.trim(),
        categoryId: editing.categoryId ? Number(editing.categoryId) : null,
        isStockable: editing.isStockable, trackLots: editing.isStockable && editing.trackLots,
        trackExpiry: editing.isStockable && editing.trackLots && editing.trackExpiry,
        trackSerials: editing.isStockable && !editing.trackLots && editing.trackSerials,
        minQuantity: editing.minQuantity === '' ? null : Number(editing.minQuantity),
        reorderQuantity: editing.reorderQuantity === '' ? null : Number(editing.reorderQuantity),
        ...(editing.id ? { isActive: editing.isActive } : {}),
      };
      if (editing.id) await stockItemService.update(editing.id, payload);
      else await stockItemService.create(payload);
      toast.success(editing.id ? t('stock.items.updated') : t('stock.items.created'));
      setEditing(null);
      load();
    } catch { /* toast api */ } finally { setSaving(false); }
  };

  const set = (k) => (e) => setFilters(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Boxes /> {t('stock.items.title')}</h1>
          <p className="text-sm text-gray-500">{t('stock.items.subtitle')}</p>
        </div>
        {belowMinRows.length > 0 && (
          <button onClick={restock} className="flex items-center gap-2 border border-orange-300 text-orange-800 bg-orange-50 hover:bg-orange-100 px-4 py-2 rounded-lg text-sm" data-testid="restock">
            <ShoppingCart size={16} /> {t('stock.items.restock', { count: belowMinRows.length })}
          </button>
        )}
        {canManage && (
          <button onClick={() => setEditing({ ...EMPTY })} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm" data-testid="item-new">
            <Plus size={16} /> {t('stock.items.new')}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-white border border-gray-200 rounded-lg p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={filters.search} onChange={set('search')} placeholder={t('stock.items.search')} className={`${inputCls} pl-9`} />
        </div>
        <SearchSelect value={filters.categoryId} onChange={set('categoryId')} className={`${inputCls} w-auto`} aria-label={t('stock.category')}>
          <option value="">{t('stock.allCategories')}</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SearchSelect>
        <SearchSelect value={filters.stockable} onChange={set('stockable')} className={`${inputCls} w-auto`} aria-label={t('stock.items.stockable')}>
          <option value="">{t('stock.items.allTypes')}</option>
          <option value="true">{t('stock.items.stockableOnly')}</option>
          <option value="false">{t('stock.notStockable')}</option>
        </SearchSelect>
        <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={filters.belowMin} onChange={set('belowMin')} /> {t('stock.items.belowMin')}</label>
        <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={filters.all} onChange={set('all')} /> {t('stock.items.showInactive')}</label>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        {loading ? (
          <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2">{t('stock.code')}</th>
                <th className="px-4 py-2">{t('stock.item')}</th>
                <th className="px-4 py-2">{t('stock.category')}</th>
                <th className="px-4 py-2">{t('stock.unit')}</th>
                <th className="px-4 py-2">{t('stock.items.tracking')}</th>
                <th className="px-4 py-2 text-right">{t('stock.inStock')}</th>
                <th className="px-4 py-2 text-right">{t('stock.minimum')}</th>
                <th className="px-4 py-2 text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(it => {
                const low = it.min_quantity !== null && Number(it.stock_quantity) < Number(it.min_quantity);
                return (
                  <tr key={it.id} className={it.is_active ? '' : 'text-gray-400'}>
                    <td className="px-4 py-2 font-mono font-semibold">{it.code}</td>
                    <td className="px-4 py-2"><Link to={`/stock/items/${it.id}`} className="text-blue-600 hover:underline">{it.name}</Link></td>
                    <td className="px-4 py-2">{it.category_name || '—'}</td>
                    <td className="px-4 py-2">{it.unit}</td>
                    <td className="px-4 py-2 text-xs">
                      {!it.is_stockable ? <span className="text-gray-500">{t('stock.notStockable')}</span>
                        : it.track_serials ? <span className="text-indigo-700">{t('stock.items.serials')}</span>
                        : it.track_expiry ? t('stock.items.lotsExpiry') : it.track_lots ? t('stock.items.lots') : t('stock.items.quantityOnly')}
                    </td>
                    <td className={`px-4 py-2 text-right font-medium ${low ? 'text-red-600' : ''}`}>
                      {it.is_stockable ? <>{low && <AlertTriangle size={12} className="mr-1 inline" />}{fmtQty(it.stock_quantity)}</> : '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500">{it.min_quantity !== null ? fmtQty(it.min_quantity) : '—'}</td>
                    <td className="px-4 py-2 text-right">
                      {canManage && <button onClick={() => openEdit(it)} className="p-1.5 text-gray-600 hover:bg-gray-100 rounded" title={t('common.edit')} aria-label={t('common.edit')}><Pencil size={16} /></button>}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">{t('stock.items.none')}</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {pagination.pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 border rounded disabled:opacity-40">‹</button>
          <span>{t('common.pageOf', { page, pages: pagination.pages })}</span>
          <button disabled={page >= pagination.pages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 border rounded disabled:opacity-40">›</button>
        </div>
      )}

      <Modal isOpen={!!editing} onClose={() => !saving && setEditing(null)} title={editing?.id ? t('stock.items.editTitle') : t('stock.items.new')}
        confirmText={t('common.save')} onConfirm={save} isLoading={saving} size="lg">
        {editing && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-gray-700">{t('stock.code')} *</span>
              <input className={`${inputCls} font-mono uppercase`} maxLength={50} value={editing.code} onChange={e => setEditing({ ...editing, code: e.target.value.toUpperCase() })} placeholder="FUEL-DSL" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-gray-700">{t('stock.category')}</span>
              <SearchSelect className={inputCls} value={editing.categoryId} onChange={e => onCategory(e.target.value)}>
                <option value="">—</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </SearchSelect>
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block font-medium text-gray-700">{t('stock.items.name')} *</span>
              <input className={inputCls} maxLength={200} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-gray-700">{t('stock.unit')} *</span>
              <input className={inputCls} list="stock-units" maxLength={30} value={editing.unit} disabled={editing.hasStock}
                onChange={e => setEditing({ ...editing, unit: e.target.value })} />
              <datalist id="stock-units">{UNITS.map(u => <option key={u} value={u} />)}</datalist>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-gray-700">{t('stock.minimum')}</span>
              <input type="number" min="0" step="any" className={inputCls} value={editing.minQuantity} onChange={e => setEditing({ ...editing, minQuantity: e.target.value })} placeholder={t('stock.items.minHint')} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-gray-700">{t('stock.items.reorderQuantity')}</span>
              <input type="number" min="0" step="any" className={inputCls} value={editing.reorderQuantity} onChange={e => setEditing({ ...editing, reorderQuantity: e.target.value })} placeholder={t('stock.items.reorderHint')} />
            </label>
            <fieldset className="sm:col-span-2 rounded-lg border border-gray-200 p-3 text-sm space-y-2" disabled={editing.hasStock}>
              <legend className="px-1 font-medium text-gray-700">{t('stock.items.tracking')}</legend>
              <label className="flex items-center gap-2"><input type="checkbox" checked={editing.isStockable}
                onChange={e => setEditing({ ...editing, isStockable: e.target.checked, ...(e.target.checked ? {} : { trackLots: false, trackExpiry: false, trackSerials: false }) })} /> {t('stock.items.stockableLabel')}</label>
              <label className={`flex items-center gap-2 ${editing.isStockable && !editing.trackLots ? '' : 'opacity-40'}`}><input type="checkbox" disabled={!editing.isStockable || editing.trackLots} checked={editing.trackSerials}
                onChange={e => setEditing({ ...editing, trackSerials: e.target.checked })} /> {t('stock.items.trackSerialsLabel')}</label>
              <label className={`flex items-center gap-2 ${editing.isStockable && !editing.trackSerials ? '' : 'opacity-40'}`}><input type="checkbox" disabled={!editing.isStockable || editing.trackSerials} checked={editing.trackLots}
                onChange={e => setEditing({ ...editing, trackLots: e.target.checked, ...(e.target.checked ? {} : { trackExpiry: false }) })} /> {t('stock.items.trackLotsLabel')}</label>
              <label className={`flex items-center gap-2 ${editing.trackLots ? '' : 'opacity-40'}`}><input type="checkbox" disabled={!editing.trackLots} checked={editing.trackExpiry}
                onChange={e => setEditing({ ...editing, trackExpiry: e.target.checked })} /> {t('stock.items.trackExpiryLabel')}</label>
              {editing.hasStock && <p className="text-xs text-amber-700">{t('stock.items.lockedHint')}</p>}
            </fieldset>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block font-medium text-gray-700">{t('common.description')}</span>
              <textarea rows={2} className={inputCls} value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} />
            </label>
            {editing.id && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.isActive} onChange={e => setEditing({ ...editing, isActive: e.target.checked })} /> {t('stock.items.activeLabel')}</label>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
