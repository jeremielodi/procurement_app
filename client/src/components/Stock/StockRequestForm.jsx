// src/components/Stock/StockRequestForm.jsx
// Nouvelle demande au magasin (tout utilisateur de l'entreprise) : dépôt, pour moi ou pour un département, projet
// (facultatif : son chef de projet valide si l'entreprise exige une validation), date souhaitée, motif, articles stockables
// avec la quantité disponible dans le dépôt (indicative : le magasinier sert selon le stock du moment).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ClipboardList, Plus, Trash2, Send, User, Building2, Warehouse } from 'lucide-react';
import toast from 'react-hot-toast';
import { stockRequestService } from '../../services/stockRequestService';
import { t, getLocale } from '../../i18n';
import SearchSelect from '../Common/SearchSelect';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);
const newLine = () => ({ key: Math.random().toString(36).slice(2), item: null, quantity: '' });
export const REQUEST_ERRORS = ['PURPOSE_REQUIRED', 'WAREHOUSE_REQUIRED', 'WAREHOUSE_INVALID', 'NO_LINES', 'INVALID_QUANTITY', 'ITEM_NOT_FOUND', 'ITEM_NOT_STOCKABLE',
  'ITEM_TWICE', 'DEPARTMENT_REQUIRED', 'DEPARTMENT_INVALID', 'PROJECT_INVALID', 'NEEDED_BY_INVALID', 'SELF_APPROVAL', 'NOT_VALIDATOR', 'NOT_PENDING',
  'NOTHING_VALIDATED', 'REASON_REQUIRED', 'NOT_REQUESTER', 'NOT_CANCELLABLE', 'NOT_OPEN', 'WAREHOUSE_FORBIDDEN'];
export const requestError = (err) => {
  const d = err.response?.data || {};
  return REQUEST_ERRORS.includes(d.code) ? t(`stockRequests.err.${d.code}`) : (d.message || t('common.errorOccurred'));
};

/** Article stockable du dépôt (recherche) avec la quantité disponible.
 *  Liste en portail (position fixe, comme SearchSelect) : jamais coupée par le cadre du tableau des articles,
 *  ouverte vers le haut si la place manque en bas, au moins 28rem de large pour les désignations longues. */
function ItemPicker({ warehouseId, value, onChange, exclude }) {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const inputRef = useRef(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const place = useCallback(() => {
    const r = inputRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const up = below < 240 && r.top > below;
    const width = Math.min(Math.max(r.width, 448), window.innerWidth - 16);
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width,
      top: up ? undefined : r.bottom + 4, bottom: up ? window.innerHeight - r.top + 4 : undefined,
      maxHeight: Math.min(384, (up ? r.top : below) - 12),
    });
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, place]);
  const search = (text) => {
    setQ(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { setOptions((await stockRequestService.items(warehouseId, text)).data || []); setOpen(true); } catch { /* toast api */ }
    }, 250);
  };
  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
        <span><b>{value.name}</b> <span className="font-mono text-xs text-gray-500">{value.code}</span></span>
        <button type="button" onClick={() => onChange(null)} className="text-xs text-blue-700 hover:underline">{t('stockRequests.changeItem')}</button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input ref={inputRef} value={q} onChange={e => search(e.target.value)} onFocus={() => search(q)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        disabled={!warehouseId} placeholder={t('stockRequests.itemSearch')} className={inputCls} data-testid="request-item-search" />
      {open && pos && createPortal(
        <ul className="fixed z-[1000] overflow-auto rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg" data-testid="request-item-options"
          style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}>
          {options.filter(o => !exclude.includes(o.id)).length === 0 && <li className="px-3 py-2 text-gray-500">{t('refs.none')}</li>}
          {options.filter(o => !exclude.includes(o.id)).map(o => (
            <li key={o.id} onMouseDown={(e) => { e.preventDefault(); onChange(o); setOpen(false); setQ(''); }} className="flex cursor-pointer items-start justify-between gap-3 px-3 py-2 hover:bg-blue-50">
              <span className="min-w-0"><b>{o.name}</b> <span className="font-mono text-xs text-gray-500">{o.code}</span></span>
              <span className={`whitespace-nowrap text-xs ${o.available > 0 ? 'text-green-700' : 'text-red-600'}`}>{t('stockRequests.availableShort', { qty: fmtQty(o.available), unit: o.unit })}</span>
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  );
}

export default function StockRequestForm() {
  const navigate = useNavigate();
  const [options, setOptions] = useState(null);
  const [form, setForm] = useState({ warehouseId: '', destinationType: 'USER', departmentId: '', projectId: '', neededBy: '', purpose: '' });
  const [lines, setLines] = useState([newLine()]);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    stockRequestService.options().then(r => {
      setOptions(r.data);
      if (r.data.warehouses.length === 1) setForm(f => ({ ...f, warehouseId: r.data.warehouses[0].id }));
    }).catch(() => setOptions({ warehouses: [], departments: [], projects: [], validationRequired: false }));
  }, []);
  // Autre dépôt : les articles (et leur disponible) sont à choisir de nouveau
  useEffect(() => { setLines([newLine()]); }, [form.warehouseId]);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const updateLine = (key, patch) => setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const filled = lines.filter(l => l.item);
  const qtyOf = (l) => parseFloat(String(l.quantity).replace(',', '.')) || 0;

  const submit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (!form.warehouseId) { toast.error(t('stockRequests.err.WAREHOUSE_REQUIRED')); return; }
    if (form.destinationType === 'DEPARTMENT' && !form.departmentId) { toast.error(t('stockRequests.err.DEPARTMENT_REQUIRED')); return; }
    if (!form.purpose.trim()) { toast.error(t('stockRequests.err.PURPOSE_REQUIRED')); return; }
    if (!filled.length) { toast.error(t('stockRequests.err.NO_LINES')); return; }
    if (filled.some(l => !(qtyOf(l) > 0))) { toast.error(t('stockRequests.err.INVALID_QUANTITY')); return; }
    setSaving(true);
    try {
      const res = await stockRequestService.create({
        ...form,
        departmentId: form.destinationType === 'DEPARTMENT' ? form.departmentId : undefined,
        projectId: form.projectId || undefined, neededBy: form.neededBy || undefined,
        lines: filled.map(l => ({ stockItemId: l.item.id, quantity: qtyOf(l) })),
      });
      toast.success(t(res.data.status === 'PENDING_VALIDATION' ? 'stockRequests.sentForValidation' : 'stockRequests.sent', { number: res.data.requestNumber }));
      navigate(`/stock/requests/${res.data.id}`);
    } catch (err) {
      toast.error(requestError(err));
    } finally {
      setSaving(false);
    }
  };

  if (!options) return <div className="p-6 text-gray-500">{t('common.loading')}</div>;
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button onClick={() => navigate(-1)} className="mb-6 flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft size={16} /> {t('common.back')}</button>
      <h1 className="mb-1 flex items-center gap-2 text-xl font-bold text-gray-900"><ClipboardList className="text-blue-600" /> {t('stockRequests.newTitle')}</h1>
      <p className="mb-6 text-sm text-gray-500">{t(options.validationRequired ? 'stockRequests.newSubtitleValidation' : 'stockRequests.newSubtitle')}</p>

      <form onSubmit={submit} className="space-y-6" noValidate>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 flex items-center gap-2 font-medium text-gray-700"><Warehouse size={15} /> {t('stock.warehouse')} *</span>
            <SearchSelect value={form.warehouseId} onChange={set('warehouseId')} className={`${inputCls} ${submitted && !form.warehouseId ? 'border-red-400' : ''}`} data-testid="request-warehouse">
              <option value="">{t('grn.chooseWarehouse')}</option>
              {options.warehouses.map(w => <option key={w.id} value={w.id}>{w.location_name} — {w.name} ({w.code})</option>)}
            </SearchSelect>
          </label>
          <fieldset className="text-sm">
            <legend className="mb-1 font-medium text-gray-700">{t('stockRequests.forWhom')} *</legend>
            <div className="flex gap-2" role="radiogroup">
              {[['USER', User], ['DEPARTMENT', Building2]].map(([key, Icon]) => (
                <button key={key} type="button" role="radio" aria-checked={form.destinationType === key} data-testid={`request-destination-${key}`}
                  onClick={() => setForm(f => ({ ...f, destinationType: key }))}
                  className={`flex flex-1 items-center gap-2 rounded-lg border-2 px-3 py-2 ${form.destinationType === key ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-gray-200 text-gray-700'}`}>
                  <Icon size={16} /> {t(`stockRequests.destination.${key}`)}
                </button>
              ))}
            </div>
          </fieldset>
          {form.destinationType === 'DEPARTMENT' && (
            <label className="text-sm">
              <span className="mb-1 block font-medium text-gray-700">{t('stock.issue.department')} *</span>
              <SearchSelect value={form.departmentId} onChange={set('departmentId')} className={`${inputCls} ${submitted && !form.departmentId ? 'border-red-400' : ''}`} data-testid="request-department">
                <option value="">{t('stock.issue.chooseDepartment')}</option>
                {options.departments.map(d => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
              </SearchSelect>
            </label>
          )}
          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-700">{t('stock.issue.project')}</span>
            <SearchSelect value={form.projectId} onChange={set('projectId')} className={inputCls} data-testid="request-project">
              <option value="">—</option>
              {options.projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </SearchSelect>
            {options.validationRequired && <span className="mt-1 block text-xs text-gray-500">{t('stockRequests.validatorHint')}</span>}
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-700">{t('stockRequests.neededBy')}</span>
            <input type="date" value={form.neededBy} onChange={set('neededBy')} min={new Date().toISOString().slice(0, 10)} className={inputCls} />
          </label>
          <label className="text-sm md:col-span-2">
            <span className="mb-1 block font-medium text-gray-700">{t('stockRequests.purpose')} *</span>
            <input value={form.purpose} onChange={set('purpose')} maxLength={2000} placeholder={t('stockRequests.purposePlaceholder')} data-testid="request-purpose"
              className={`${inputCls} ${submitted && !form.purpose.trim() ? 'border-red-400' : ''}`} />
          </label>
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
            <h2 className="font-medium text-gray-700">{t('stockRequests.items')}</h2>
            <p className="text-xs text-gray-500">{t('stockRequests.availableHint')}</p>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 min-w-[18rem]">{t('stock.item')}</th>
                <th className="px-3 py-2 text-right">{t('stock.issue.available')}</th>
                <th className="px-3 py-2">{t('stockRequests.quantity')}</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map(l => (
                <tr key={l.key}>
                  <td className="px-3 py-2 align-top">
                    <ItemPicker warehouseId={form.warehouseId} value={l.item} onChange={(item) => updateLine(l.key, { item })}
                      exclude={lines.filter(x => x.key !== l.key && x.item).map(x => x.item.id)} />
                  </td>
                  <td className="px-3 py-2 text-right align-top">{l.item ? `${fmtQty(l.item.available)} ${l.item.unit}` : '—'}</td>
                  <td className="px-3 py-2 align-top">
                    <input type="number" min="0" step={l.item?.track_serials ? 1 : 'any'} value={l.quantity} disabled={!l.item} aria-label={t('stockRequests.quantity')}
                      onChange={e => updateLine(l.key, { quantity: e.target.value })} className={`${inputCls} w-28`} data-testid="request-quantity" />
                    {l.item && qtyOf(l) > l.item.available && <div className="mt-1 text-xs text-amber-700">{t('stockRequests.moreThanAvailable')}</div>}
                  </td>
                  <td className="px-2 py-2 align-top">
                    {lines.length > 1 && <button type="button" onClick={() => setLines(prev => prev.filter(x => x.key !== l.key))} className="rounded p-2 text-red-600 hover:bg-red-50" aria-label={t('common.delete')}><Trash2 size={16} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-gray-100 px-4 py-2">
            <button type="button" onClick={() => setLines(prev => [...prev, newLine()])} disabled={!form.warehouseId} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 disabled:opacity-40">
              <Plus size={14} /> {t('stock.issue.addLine')}
            </button>
          </div>
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={() => navigate(-1)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">{t('common.cancel')}</button>
          <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50" data-testid="request-submit">
            <Send size={16} /> {saving ? t('po.saving') : t('stockRequests.send')}
          </button>
        </div>
      </form>
    </div>
  );
}
