// src/components/Stock/StockIssueForm.jsx
// Nouvelle sortie de stock vers un utilisateur : dépôt (accès de l'utilisateur), bénéficiaire, projet (facultatif),
// motif, articles. Lots : FEFO automatique (péremption la plus proche d'abord) ou lot imposé.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, PackageMinus, Plus, Trash2, Save, User, X, Warehouse } from 'lucide-react';
import toast from 'react-hot-toast';
import CatalogAutocomplete from './CatalogAutocomplete';
import { warehouseService, stockService, stockIssueService, equipmentService } from '../../services/stockService';
import { projectService } from '../../services/projectService';
import { t, getLocale } from '../../i18n';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(getLocale()) : '');
const today = () => new Date().toISOString().slice(0, 10);
const newLine = () => ({ key: Math.random().toString(36).slice(2), text: '', item: null, lotId: '', quantity: '', balances: null, units: null, unitIds: [] });
const ERROR_CODES = ['STOCK_INSUFFICIENT', 'WAREHOUSE_FORBIDDEN', 'RECIPIENT_INVALID', 'LOT_EXPIRED', 'ITEM_NOT_STOCKABLE', 'NO_LINES', 'INVALID_QUANTITY', 'UNITS_REQUIRED', 'UNIT_UNAVAILABLE'];

/** Recherche d'un bénéficiaire (utilisateurs actifs de l'entreprise) */
export function RecipientPicker({ value, onChange }) {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const search = (text) => {
    setQ(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { setOptions((await stockIssueService.recipients(text)).data || []); setOpen(true); } catch { /* toast api */ }
    }, 250);
  };
  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
        <span className="flex items-center gap-2"><User size={16} className="text-blue-600" /><b>{value.first_name} {value.last_name}</b> <span className="text-gray-500">{value.email}</span></span>
        <button type="button" onClick={() => onChange(null)} className="rounded p-1 hover:bg-blue-100" aria-label={t('stock.issue.changeRecipient')}><X size={14} /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input value={q} onChange={e => search(e.target.value)} onFocus={() => search(q)} placeholder={t('stock.issue.recipientSearch')} className={inputCls} data-testid="issue-recipient" />
      {open && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg">
          {options.length === 0 && <li className="px-3 py-2 text-gray-500">{t('refs.none')}</li>}
          {options.map(u => (
            <li key={u.id} onMouseDown={(e) => { e.preventDefault(); onChange(u); setOpen(false); }} className="cursor-pointer px-3 py-1.5 hover:bg-blue-50">
              <b>{u.first_name} {u.last_name}</b> <span className="text-gray-500">{u.email}</span>
              {(u.department || u.position) && <div className="text-xs text-gray-400">{[u.position, u.department].filter(Boolean).join(' · ')}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function StockIssueForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [warehouses, setWarehouses] = useState(null);
  const [warehouseId, setWarehouseId] = useState(params.get('warehouseId') || '');
  const [projects, setProjects] = useState([]);
  const [recipient, setRecipient] = useState(null);
  const [projectId, setProjectId] = useState('');
  const [purpose, setPurpose] = useState('');
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
    projectService.getAll().then(r => setProjects(r.data || [])).catch(() => {});
  }, []);

  // Disponible par article dans le dépôt choisi (rechargé si le dépôt change)
  const loadBalances = async (key, item, whId = warehouseId) => {
    if (!item || !whId) return;
    try {
      const [res, units] = await Promise.all([
        stockService.balances({ warehouseId: whId, stockItemId: item.id }),
        item.track_serials ? equipmentService.units({ stockItemId: item.id, warehouseId: whId, status: 'IN_STOCK', limit: 500 }) : null,
      ]);
      setLines(prev => prev.map(l => (l.key === key ? { ...l, balances: res.data || [], units: units ? units.data || [] : null, unitIds: [] } : l)));
    } catch { /* toast api */ }
  };
  useEffect(() => {
    setLines(prev => prev.map(l => ({ ...l, balances: null, units: null, unitIds: [], lotId: '' })));
    lines.forEach(l => l.item && loadBalances(l.key, l.item, warehouseId));
  }, [warehouseId]);

  const updateLine = (key, patch) => setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));

  // Disponible : non périmé (FEFO) ou lot imposé ; cumul des lignes du même article
  const computed = useMemo(() => {
    const requestedByItem = new Map();
    return lines.map(l => {
      const qty = l.item?.track_serials ? l.unitIds.length : parseFloat(String(l.quantity).replace(',', '.')) || 0;
      const rows = l.balances || [];
      const usable = rows.filter(b => (l.lotId ? b.lot_id === l.lotId : !b.expiry_date || String(b.expiry_date).slice(0, 10) >= today()));
      const available = usable.reduce((s, b) => s + Number(b.quantity), 0);
      const key = `${l.item?.id}|${l.lotId}`;
      const already = requestedByItem.get(key) || 0;
      requestedByItem.set(key, already + qty);
      const errors = [];
      if (l.item && !(qty > 0)) errors.push(l.item.track_serials ? t('stock.issue.err.units') : t('stock.issue.err.quantity'));
      if (l.item && l.balances && already + qty - available > 1e-9) errors.push(t('stock.issue.err.available', { qty: fmtQty(Math.max(available - already, 0)), unit: l.item.unit }));
      if (l.item && l.item.is_stockable === false) errors.push(t('stock.issue.err.notStockable'));
      return { qty, available, errors, expiredStock: rows.some(b => b.expiry_date && String(b.expiry_date).slice(0, 10) < today()) };
    });
  }, [lines]);

  const filledLines = lines.filter(l => l.item);
  const hasErrors = computed.some((c, i) => lines[i].item && c.errors.length);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (!warehouseId) { toast.error(t('stock.issue.err.warehouse')); return; }
    if (!recipient) { toast.error(t('stock.issue.err.recipient')); return; }
    if (!filledLines.length) { toast.error(t('stock.issue.err.noLines')); return; }
    if (hasErrors) { toast.error(t('grn.err.fixLines')); return; }
    setSaving(true);
    try {
      const res = await stockIssueService.create({
        warehouseId, recipientId: recipient.id, projectId: projectId || undefined, purpose,
        lines: lines.map((l, i) => ({ l, c: computed[i] })).filter(({ l }) => l.item)
          .map(({ l, c }) => (l.item.track_serials
            ? { stockItemId: l.item.id, unitIds: l.unitIds }
            : { stockItemId: l.item.id, lotId: l.lotId || undefined, quantity: c.qty })),
      });
      toast.success(t('stock.issue.created', { number: res.data.issueNumber }));
      navigate(`/stock/issues/${res.data.id}`);
    } catch (err) {
      const d = err.response?.data || {};
      toast.error(ERROR_CODES.includes(d.code) ? `${t(`stock.issue.err.${d.code}`)}${d.message ? ` — ${d.message}` : ''}` : (d.message || t('common.errorOccurred')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 text-sm"><ArrowLeft size={16} /> {t('common.back')}</button>
      <h1 className="mb-1 flex items-center gap-2 text-xl font-bold text-gray-900"><PackageMinus className="text-blue-600" /> {t('stock.issue.newTitle')}</h1>
      <p className="mb-6 text-sm text-gray-500">{t('stock.issue.newSubtitle')}</p>

      <form onSubmit={submit} className="space-y-6" noValidate>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 flex items-center gap-2 font-medium text-gray-700"><Warehouse size={15} /> {t('stock.warehouse')} *</span>
            {warehouses && warehouses.length === 0 ? (
              <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-700">{t('grn.err.NO_WAREHOUSE_ACCESS')}</p>
            ) : (
              <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className={`${inputCls} ${submitted && !warehouseId ? 'border-red-400' : ''}`} data-testid="issue-warehouse">
                {(warehouses || []).length !== 1 && <option value="">{t('grn.chooseWarehouse')}</option>}
                {(warehouses || []).map(w => <option key={w.id} value={w.id}>{w.location_name} — {w.name} ({w.code})</option>)}
              </select>
            )}
          </label>
          <div className="text-sm">
            <span className="mb-1 flex items-center gap-2 font-medium text-gray-700"><User size={15} /> {t('stock.issue.recipient')} *</span>
            <RecipientPicker value={recipient} onChange={setRecipient} />
          </div>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-700">{t('stock.issue.project')}</span>
            <select value={projectId} onChange={e => setProjectId(e.target.value)} className={inputCls}>
              <option value="">—</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-700">{t('stock.issue.purpose')}</span>
            <input value={purpose} onChange={e => setPurpose(e.target.value)} maxLength={2000} placeholder={t('stock.issue.purposePlaceholder')} className={inputCls} />
          </label>
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3">
            <h2 className="font-medium text-gray-700">{t('stock.issue.items')}</h2>
            <span className="text-xs text-gray-500">{t('stock.issue.fefoHint')}</span>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 min-w-[18rem]">{t('stock.item')}</th>
                <th className="px-3 py-2 text-right">{t('stock.issue.available')}</th>
                <th className="px-3 py-2">{t('stock.lot')}</th>
                <th className="px-3 py-2">{t('stock.quantity')}</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((l, i) => {
                const c = computed[i];
                const lots = (l.balances || []).filter(b => b.lot_id);
                return (
                  <tr key={l.key} className={submitted && c.errors.length ? 'bg-red-50/60' : ''}>
                    <td className="px-3 py-2 align-top">
                      <CatalogAutocomplete
                        linked={l.item}
                        onLink={(item) => { updateLine(l.key, { item, text: item ? item.name : '', lotId: '', balances: null }); if (item) loadBalances(l.key, item); }}
                        onTextChange={(text) => updateLine(l.key, { text })}
                        placeholder={t('stock.issue.itemSearch')}
                        className={`${inputCls}`}
                        minChars={1}
                        disabled={!warehouseId}
                        inputProps={{ value: l.text, readOnly: !!l.item }}
                      />
                      {(submitted || c.errors.some(er => er !== t('stock.issue.err.quantity'))) && c.errors.map(er => <div key={er} className="mt-1 text-xs text-red-600">{er}</div>)}
                      {c.expiredStock && <div className="mt-1 text-xs text-amber-700">{t('stock.issue.expiredExcluded')}</div>}
                    </td>
                    <td className="px-3 py-2 text-right align-top font-medium">{l.item ? (l.balances ? `${fmtQty(c.available)} ${l.item.unit}` : '…') : '—'}</td>
                    <td className="px-3 py-2 align-top">
                      {l.item?.track_lots ? (
                        <select value={l.lotId} onChange={e => updateLine(l.key, { lotId: e.target.value })} className={inputCls} aria-label={t('stock.lot')}>
                          <option value="">{t('stock.issue.autoLot')}</option>
                          {lots.map(b => {
                            const expired = b.expiry_date && String(b.expiry_date).slice(0, 10) < today();
                            return <option key={b.lot_id} value={b.lot_id} disabled={expired}>{b.lot_number} — {fmtQty(b.quantity)}{b.expiry_date ? ` · ${fmtDate(b.expiry_date)}` : ''}{expired ? ` (${t('stock.expired')})` : ''}</option>;
                          })}
                        </select>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {l.item?.track_serials ? (
                        <div className="w-64">
                          {l.units === null ? <span className="text-gray-400">…</span> : l.units.length === 0 ? (
                            <span className="text-xs text-gray-500">{t('stock.issue.noUnits')}</span>
                          ) : (
                            <ul className="max-h-40 overflow-auto rounded-lg border border-gray-200 text-xs" aria-label={t('stock.issue.chooseUnits')}>
                              {l.units.map(u => (
                                <li key={u.id}>
                                  <label className={`flex items-center gap-2 px-2 py-1 ${u.condition === 'GOOD' ? 'cursor-pointer hover:bg-gray-50' : 'opacity-50'}`}>
                                    <input type="checkbox" disabled={u.condition !== 'GOOD'} checked={l.unitIds.includes(u.id)}
                                      onChange={e => updateLine(l.key, { unitIds: e.target.checked ? [...l.unitIds, u.id] : l.unitIds.filter(x => x !== u.id) })} />
                                    <span className="font-mono">{u.serial_number}</span>
                                    {u.asset_tag && <span className="text-gray-400">{u.asset_tag}</span>}
                                    {u.condition !== 'GOOD' && <span className="text-red-600">{t('stock.equipment.condition.DAMAGED')}</span>}
                                  </label>
                                </li>
                              ))}
                            </ul>
                          )}
                          <div className="mt-1 text-xs text-gray-500">{t('stock.issue.selectedUnits', { count: l.unitIds.length })}</div>
                        </div>
                      ) : (
                        <input type="number" min="0" step="any" value={l.quantity} disabled={!l.item} aria-label={t('stock.quantity')}
                          onChange={e => updateLine(l.key, { quantity: e.target.value })} className={`${inputCls} w-28`} />
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
          <div className="border-t border-gray-100 px-4 py-2">
            <button type="button" onClick={() => setLines(prev => [...prev, newLine()])} disabled={!warehouseId} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 disabled:opacity-40">
              <Plus size={14} /> {t('stock.issue.addLine')}
            </button>
          </div>
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={() => navigate(-1)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">{t('common.cancel')}</button>
          <button type="submit" disabled={saving || !warehouseId} className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            <Save size={16} /> {saving ? t('po.saving') : t('stock.issue.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
