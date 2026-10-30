// src/components/Stock/StockEntryForm.jsx
// Nouveau bon d'entrée en stock hors bon de commande : type (don, achat hors système, retour, autre), dépôt (accès de
// l'utilisateur), provenance, remis par, référence, projet de financement et motif (obligatoire pour « autre »), articles
// du catalogue (stockables) avec quantité, coût unitaire facultatif, lot / péremption et n° de série selon l'article.
// Le bon part en validation : le stock n'augmente qu'une fois validé par une autre personne.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, PackagePlus, Plus, Trash2, Send, Warehouse, Gift, ShoppingBag, Undo2, FilePlus2 } from 'lucide-react';
import toast from 'react-hot-toast';
import CatalogAutocomplete from './CatalogAutocomplete';
import FundingProjectSelect from './FundingProjectSelect';
import SerialNumbersHelp from './SerialNumbersHelp';
import { warehouseService, stockEntryService } from '../../services/stockService';
import { useCurrency } from '../../contexts/EnterpriseContext';
import { t, getLocale } from '../../i18n';
import SearchSelect from '../Common/SearchSelect';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const today = () => new Date().toISOString().slice(0, 10);
const parseNum = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
const newLine = () => ({ key: Math.random().toString(36).slice(2), text: '', item: null, quantity: '', unitCost: '', lotNumber: '', expiryDate: '', serialsText: '' });
const serialList = (text) => String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
export const ENTRY_ERROR_CODES = ['INVALID_ENTRY_TYPE', 'REASON_REQUIRED', 'NO_LINES', 'WAREHOUSE_REQUIRED', 'WAREHOUSE_FORBIDDEN', 'ITEM_NOT_FOUND',
  'ITEM_NOT_STOCKABLE', 'INVALID_QUANTITY', 'INVALID_COST', 'EXPIRY_INVALID', 'LOT_REQUIRED', 'EXPIRY_REQUIRED', 'LOT_EXPIRED', 'LOT_EXPIRY_MISMATCH',
  'SERIAL_INTEGER', 'SERIALS_REQUIRED', 'SERIAL_DUPLICATE', 'SERIAL_EXISTS', 'PROJECT_NOT_FOUND', 'CURRENCY_INVALID',
  'NOT_PENDING', 'SELF_VALIDATION', 'NOT_AUTHOR', 'NOT_CANCELLABLE', 'ENTRY_USED'];

/** Message d'erreur traduit (code métier du serveur) + détail */
export const entryErrorMessage = (err) => {
  const d = err.response?.data || {};
  return ENTRY_ERROR_CODES.includes(d.code) ? `${t(`stock.entry.err.${d.code}`)}${d.message ? ` — ${d.message}` : ''}` : (d.message || t('common.errorOccurred'));
};

// Types d'entrée (ordre d'affichage) et leurs icônes
export const ENTRY_TYPES = [['DONATION', Gift], ['OFF_SYSTEM_PURCHASE', ShoppingBag], ['RETURN', Undo2], ['OTHER', FilePlus2]];

export default function StockEntryForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { currency } = useCurrency();
  const [warehouses, setWarehouses] = useState(null);
  const [warehouseId, setWarehouseId] = useState(params.get('warehouseId') || '');
  const [type, setType] = useState(ENTRY_TYPES.some(([k]) => k === params.get('type')) ? params.get('type') : 'DONATION');
  const [origin, setOrigin] = useState('');
  const [deliveredBy, setDeliveredBy] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [projectId, setProjectId] = useState('');
  const [lines, setLines] = useState([newLine()]);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    warehouseService.mine().then(r => {
      const list = r.data || [];
      setWarehouses(list);
      if (list.length === 1) setWarehouseId(list[0].id);
      else if (warehouseId && !list.some(w => String(w.id) === String(warehouseId))) setWarehouseId('');
    }).catch(() => setWarehouses([]));
  }, []);

  const updateLine = (key, patch) => setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));

  // Contrôles par ligne (mêmes règles que le serveur)
  const computed = useMemo(() => lines.map(l => {
    const errors = [];
    if (!l.item) return { errors, qty: 0 };
    const qty = parseNum(l.quantity);
    if (l.item.is_stockable === false) errors.push(t('stock.issue.err.notStockable'));
    if (!(qty > 0)) errors.push(t('stock.entry.err.quantity'));
    if (String(l.unitCost).trim() !== '' && !(parseNum(l.unitCost) >= 0)) errors.push(t('stock.entry.err.cost'));
    if (l.item.track_lots && !l.lotNumber.trim()) errors.push(t('stock.entry.err.lot'));
    if (l.item.track_expiry && !l.expiryDate) errors.push(t('stock.entry.err.expiry'));
    if (l.expiryDate && l.expiryDate < today()) errors.push(t('stock.entry.err.expired'));
    if (l.item.track_serials) {
      if (qty > 0 && !Number.isInteger(qty)) errors.push(t('stock.entry.err.integer'));
      else if (qty > 0 && serialList(l.serialsText).length !== qty) errors.push(t('stock.entry.err.serials', { expected: qty, count: serialList(l.serialsText).length }));
    }
    return { errors, qty };
  }), [lines]);

  const filled = lines.filter(l => l.item);
  const hasErrors = computed.some((c, i) => lines[i].item && c.errors.length);
  const total = filled.every(l => String(l.unitCost).trim() !== '' && parseNum(l.unitCost) >= 0) && filled.length
    ? filled.reduce((s, l) => s + parseNum(l.quantity || 0) * parseNum(l.unitCost), 0) : null;

  const submit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (!warehouseId) { toast.error(t('stock.issue.err.warehouse')); return; }
    if (type === 'OTHER' && !reason.trim()) { toast.error(t('stock.entry.err.REASON_REQUIRED')); return; }
    if (!filled.length) { toast.error(t('stock.issue.err.noLines')); return; }
    if (hasErrors) { toast.error(t('grn.err.fixLines')); return; }
    setSaving(true);
    try {
      const res = await stockEntryService.create({
        entryType: type, warehouseId, origin, deliveredBy, reference, reason, projectId: projectId || undefined,
        lines: filled.map(l => ({
          stockItemId: l.item.id, quantity: parseNum(l.quantity),
          unitCost: String(l.unitCost).trim() === '' ? undefined : parseNum(l.unitCost),
          lotNumber: l.item.track_lots ? l.lotNumber.trim() : undefined,
          expiryDate: (l.item.track_lots || l.item.track_expiry) && l.expiryDate ? l.expiryDate : undefined,
          serials: l.item.track_serials ? serialList(l.serialsText) : undefined,
        })),
      });
      toast.success(t('stock.entry.created', { number: res.data.entryNumber }));
      navigate(`/stock/entries/${res.data.id}`);
    } catch (err) {
      toast.error(entryErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 text-sm"><ArrowLeft size={16} /> {t('common.back')}</button>
      <h1 className="mb-1 flex items-center gap-2 text-xl font-bold text-gray-900"><PackagePlus className="text-emerald-600" /> {t('stock.entry.newTitle')}</h1>
      <p className="mb-6 text-sm text-gray-500">{t('stock.entry.newSubtitle')}</p>

      <form onSubmit={submit} className="space-y-6" noValidate>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-gray-700">{t('stock.entry.typeLabel')} *</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup">
            {ENTRY_TYPES.map(([key, Icon]) => (
              <button key={key} type="button" role="radio" aria-checked={type === key} onClick={() => setType(key)} data-testid={`entry-type-${key}`}
                className={`rounded-xl border-2 p-3 text-left transition ${type === key ? 'border-emerald-600 bg-emerald-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                <span className={`flex items-center gap-2 text-sm font-semibold ${type === key ? 'text-emerald-800' : 'text-gray-800'}`}><Icon size={18} /> {t(`stock.entry.types.${key}`)}</span>
                <span className="mt-1 block text-xs text-gray-500">{t(`stock.entry.typeHelp.${key}`)}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 flex items-center gap-2 font-medium text-gray-700"><Warehouse size={15} /> {t('stock.warehouse')} *</span>
            {warehouses && warehouses.length === 0 ? (
              <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-700">{t('grn.err.NO_WAREHOUSE_ACCESS')}</p>
            ) : (
              <SearchSelect value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className={`${inputCls} ${submitted && !warehouseId ? 'border-red-400' : ''}`} data-testid="entry-warehouse">
                {(warehouses || []).length !== 1 && <option value="">{t('grn.chooseWarehouse')}</option>}
                {(warehouses || []).map(w => <option key={w.id} value={w.id}>{w.location_name} — {w.name} ({w.code})</option>)}
              </SearchSelect>
            )}
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-700">{t(`stock.entry.originLabel.${type}`)}</span>
            <input value={origin} onChange={e => setOrigin(e.target.value)} maxLength={255} placeholder={t(`stock.entry.originPlaceholder.${type}`)} className={inputCls} data-testid="entry-origin" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-700">{t('stock.entry.deliveredBy')}</span>
            <input value={deliveredBy} onChange={e => setDeliveredBy(e.target.value)} maxLength={255} placeholder={t('stock.entry.deliveredByPlaceholder')} className={inputCls} data-testid="entry-delivered-by" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-700">{t('stock.entry.reference')}</span>
            <input value={reference} onChange={e => setReference(e.target.value)} maxLength={100} placeholder={t('stock.entry.referencePlaceholder')} className={inputCls} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-700">{t('stock.entry.project')}</span>
            <FundingProjectSelect value={projectId} onChange={setProjectId} className={inputCls} />
            <span className="mt-1 block text-xs text-gray-500">{t('stock.entry.projectHint')}</span>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-700">{t('stock.entry.reason')}{type === 'OTHER' && ' *'}</span>
            <textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} maxLength={2000} placeholder={t('stock.entry.reasonPlaceholder')} data-testid="entry-reason"
              className={`${inputCls} ${submitted && type === 'OTHER' && !reason.trim() ? 'border-red-400' : ''}`} />
          </label>
        </div>

        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-4 py-3">
            <h2 className="font-medium text-gray-700">{t('stock.issue.items')}</h2>
            <span className="text-xs text-gray-500">{t('stock.entry.costHint', { currency: currency.code })}</span>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 min-w-[16rem]">{t('stock.item')}</th>
                <th className="px-3 py-2">{t('stock.quantity')} *</th>
                <th className="px-3 py-2">{t('stock.entry.unitCost', { currency: currency.code })}</th>
                <th className="px-3 py-2 min-w-[14rem]">{t('stock.entry.tracking')}</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((l, i) => {
                const c = computed[i];
                const tracked = l.item && (l.item.track_lots || l.item.track_expiry || l.item.track_serials);
                return (
                  <tr key={l.key} className={submitted && c.errors.length ? 'bg-red-50/60' : ''} data-testid="entry-line">
                    <td className="px-3 py-2 align-top">
                      <CatalogAutocomplete
                        linked={l.item}
                        onLink={(item) => updateLine(l.key, { item, text: item ? item.name : '', lotNumber: '', expiryDate: '', serialsText: '' })}
                        onTextChange={(text) => updateLine(l.key, { text })}
                        placeholder={t('stock.issue.itemSearch')}
                        className={inputCls}
                        minChars={1}
                        inputProps={{ value: l.text, readOnly: !!l.item, 'data-testid': 'entry-item' }}
                      />
                      {(submitted || c.errors.some(er => er !== t('stock.entry.err.quantity'))) && c.errors.map(er => <div key={er} className="mt-1 text-xs text-red-600">{er}</div>)}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input type="number" min="0" step={l.item?.track_serials ? '1' : 'any'} value={l.quantity} disabled={!l.item} aria-label={t('stock.quantity')} data-testid="entry-quantity"
                        onChange={e => updateLine(l.key, { quantity: e.target.value })} className={`${inputCls} w-28`} />
                      {l.item && <div className="mt-1 text-xs text-gray-400">{l.item.unit}</div>}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input type="number" min="0" step="any" value={l.unitCost} disabled={!l.item} aria-label={t('stock.entry.unitCost', { currency: currency.code })} data-testid="entry-cost"
                        onChange={e => updateLine(l.key, { unitCost: e.target.value })} placeholder={t('stock.entry.optional')} className={`${inputCls} w-32`} />
                    </td>
                    <td className="px-3 py-2 align-top">
                      {!tracked ? <span className="text-gray-400">—</span> : (
                        <div className="space-y-2">
                          {l.item.track_lots && (
                            <input value={l.lotNumber} onChange={e => updateLine(l.key, { lotNumber: e.target.value })} maxLength={100}
                              placeholder={`${t('stock.lot')} *`} aria-label={t('stock.lot')} className={inputCls} data-testid="entry-lot" />
                          )}
                          {(l.item.track_lots || l.item.track_expiry) && (
                            <label className="block text-xs text-gray-500">{t('stock.expiry')}{l.item.track_expiry && ' *'}
                              <input type="date" min={today()} value={l.expiryDate} onChange={e => updateLine(l.key, { expiryDate: e.target.value })} className={inputCls} data-testid="entry-expiry" />
                            </label>
                          )}
                          {l.item.track_serials && (
                            <>
                              <textarea rows={3} value={l.serialsText} onChange={e => updateLine(l.key, { serialsText: e.target.value })}
                                placeholder={t('grn.serialsPlaceholder')} aria-label={t('grn.serials')} className={`${inputCls} font-mono`} data-testid="entry-serials" />
                              <SerialNumbersHelp text={l.serialsText} expected={Number.isInteger(c.qty) ? c.qty : undefined} />
                            </>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 align-top">
                      {lines.length > 1 && <button type="button" onClick={() => setLines(prev => prev.filter(x => x.key !== l.key))} className="rounded p-2 text-red-600 hover:bg-red-50" aria-label={t('common.delete')}><Trash2 size={16} /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-4 py-2">
            <button type="button" onClick={() => setLines(prev => [...prev, newLine()])} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800">
              <Plus size={14} /> {t('stock.issue.addLine')}
            </button>
            {total !== null && <span className="text-sm text-gray-700">{t('stock.entry.totalValue')} : <b>{total.toLocaleString(getLocale(), { maximumFractionDigits: 2 })} {currency.code}</b></span>}
          </div>
        </div>

        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t('stock.entry.validationNotice')}</p>

        <div className="flex gap-3">
          <button type="button" onClick={() => navigate(-1)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">{t('common.cancel')}</button>
          <button type="submit" disabled={saving || !warehouseId} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50" data-testid="entry-submit">
            <Send size={16} /> {saving ? t('po.saving') : t('stock.entry.submit')}
          </button>
        </div>
      </form>
    </div>
  );
}
