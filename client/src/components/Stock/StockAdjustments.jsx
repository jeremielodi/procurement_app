// src/components/Stock/StockAdjustments.jsx
// Ajustements ponctuels du stock (AJU-…) : liste, et saisie (ADJUST_STOCK) — dépôt, article, lot ou équipement,
// entrée / sortie, motif (casse, perte, vol, périmé, trouvé, correction, autre) et explication obligatoires.
import React, { useEffect, useState } from 'react';
import { SlidersHorizontal, Plus, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import SearchSelect from '../Common/SearchSelect';
import CatalogAutocomplete from './CatalogAutocomplete';
import { stockAdjustmentService, stockService, equipmentService, warehouseService } from '../../services/stockService';
import { usePermissions } from '../../hooks/usePermissions';
import { t, getLocale } from '../../i18n';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const REASONS = ['DAMAGE', 'LOSS', 'THEFT', 'EXPIRED', 'FOUND', 'CORRECTION', 'OTHER'];
const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);
const ERROR_CODES = ['STOCK_INSUFFICIENT', 'COMMENT_REQUIRED', 'INVALID_REASON', 'LOT_REQUIRED', 'UNIT_REQUIRED', 'UNIT_UNAVAILABLE', 'INVALID_QUANTITY', 'WAREHOUSE_FORBIDDEN', 'ITEM_NOT_STOCKABLE'];
const empty = { warehouseId: '', item: null, text: '', lotId: '', unitId: '', direction: 'OUT', quantity: '', reason: 'DAMAGE', comment: '' };

export default function StockAdjustments() {
  const { hasPermission } = usePermissions();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [warehouses, setWarehouses] = useState([]);
  const [form, setForm] = useState(empty);
  const [lots, setLots] = useState([]);
  const [units, setUnits] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = () => { setLoading(true); stockAdjustmentService.list({ limit: 100 }).then(r => setRows(r.data || [])).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  // Lots / équipements disponibles pour l'article choisi dans le dépôt choisi
  useEffect(() => {
    setLots([]); setUnits([]);
    if (!form.item || !form.warehouseId) return;
    if (form.item.track_serials) {
      equipmentService.units({ stockItemId: form.item.id, warehouseId: form.warehouseId, status: 'IN_STOCK', limit: 500 }).then(r => setUnits(r.data || [])).catch(() => {});
    } else if (form.item.track_lots) {
      stockService.balances({ warehouseId: form.warehouseId, stockItemId: form.item.id }).then(r => setLots((r.data || []).filter(b => b.lot_id))).catch(() => {});
    }
  }, [form.item, form.warehouseId]);

  const openDialog = async () => {
    setForm(empty);
    setOpen(true);
    try {
      const list = (await warehouseService.mine()).data || [];
      setWarehouses(list);
      if (list.length === 1) setForm(f => ({ ...f, warehouseId: list[0].id }));
    } catch { /* toast api */ }
  };
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.warehouseId) { toast.error(t('stock.issue.err.warehouse')); return; }
    if (!form.item) { toast.error(t('stock.count.err.chooseItem')); return; }
    if (!form.comment.trim()) { toast.error(t('stock.adjust.err.COMMENT_REQUIRED')); return; }
    const qty = form.item.track_serials ? -1 : Number(String(form.quantity).replace(',', '.')) * (form.direction === 'OUT' ? -1 : 1);
    setBusy(true);
    try {
      const res = await stockAdjustmentService.create({
        warehouseId: form.warehouseId, stockItemId: form.item.id, lotId: form.lotId || undefined, unitId: form.unitId || undefined,
        quantity: qty, reason: form.reason, comment: form.comment.trim(),
      });
      toast.success(t('stock.adjust.created', { number: res.data.adjustmentNumber }));
      setOpen(false);
      load();
    } catch (err) {
      const d = err.response?.data || {};
      toast.error(ERROR_CODES.includes(d.code) ? `${t(`stock.adjust.err.${d.code}`)}${d.code === 'STOCK_INSUFFICIENT' && d.message ? ` — ${d.message}` : ''}` : (d.message || t('common.errorOccurred')));
    } finally { setBusy(false); }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><SlidersHorizontal /> {t('stock.adjust.title')}</h1>
          <p className="text-sm text-gray-500">{t('stock.adjust.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="rounded-lg border border-gray-300 p-2 hover:bg-gray-50" aria-label={t('common.refresh')}><RefreshCw size={16} /></button>
          {hasPermission('ADJUST_STOCK') && (
            <button onClick={openDialog} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700" data-testid="adjust-new">
              <Plus size={16} /> {t('stock.adjust.new')}
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        {loading ? <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>
          : rows.length === 0 ? <div className="p-10 text-center text-gray-500">{t('stock.adjust.none')}</div>
          : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2">{t('stock.adjust.number')}</th>
                  <th className="px-4 py-2">{t('stock.mv.date')}</th>
                  <th className="px-4 py-2">{t('stock.warehouse')}</th>
                  <th className="px-4 py-2">{t('stock.item')}</th>
                  <th className="px-4 py-2 text-right">{t('stock.quantity')}</th>
                  <th className="px-4 py-2">{t('stock.adjust.reason')}</th>
                  <th className="px-4 py-2">{t('stock.adjust.by')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map(a => (
                  <tr key={a.id}>
                    <td className="px-4 py-2 font-mono font-semibold">{a.adjustment_number}<div className="text-xs font-normal text-gray-400">{a.movement_number}</div></td>
                    <td className="whitespace-nowrap px-4 py-2">{new Date(a.created_at).toLocaleDateString(getLocale())}</td>
                    <td className="px-4 py-2">{a.warehouse_name}</td>
                    <td className="px-4 py-2"><span className="mr-1 font-mono">{a.item_code}</span>{a.item_name}
                      {(a.lot_number || a.serial_number) && <div className="text-xs text-gray-500">{a.serial_number || a.lot_number}</div>}
                    </td>
                    <td className={`px-4 py-2 text-right font-medium ${a.quantity > 0 ? 'text-green-700' : 'text-red-700'}`}>{a.quantity > 0 ? '+' : ''}{fmtQty(a.quantity)} <span className="text-xs text-gray-400">{a.unit}</span></td>
                    <td className="px-4 py-2">{t(`stock.adjust.reasons.${a.reason}`)}<div className="max-w-xs truncate text-xs text-gray-500" title={a.comment}>{a.comment}</div></td>
                    <td className="px-4 py-2 text-xs text-gray-500">{a.created_by_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      <Modal isOpen={open} onClose={() => !busy && setOpen(false)} title={t('stock.adjust.new')} size="md" confirmText={t('common.save')} onConfirm={submit} isLoading={busy}>
        <div className="space-y-4 text-sm">
          <SearchSelect value={form.warehouseId} onChange={set('warehouseId')} className={inputCls} aria-label={t('stock.warehouse')}>
            <option value="">{t('grn.chooseWarehouse')}</option>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.location_name} — {w.name} ({w.code})</option>)}
          </SearchSelect>
          <CatalogAutocomplete linked={form.item} onLink={(item) => setForm(f => ({ ...f, item, text: item ? item.name : '', lotId: '', unitId: '' }))}
            onTextChange={(text) => setForm(f => ({ ...f, text }))} placeholder={t('stock.issue.itemSearch')} className={inputCls} minChars={1}
            inputProps={{ value: form.text, readOnly: !!form.item }} />
          {form.item?.track_serials ? (
            <SearchSelect value={form.unitId} onChange={set('unitId')} className={inputCls} aria-label={t('stock.adjust.unit')}>
              <option value="">{t('stock.adjust.chooseUnit')}</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.serial_number}{u.asset_tag ? ` · ${u.asset_tag}` : ''}</option>)}
            </SearchSelect>
          ) : (
            <>
              {form.item?.track_lots && (
                <SearchSelect value={form.lotId} onChange={set('lotId')} className={inputCls} aria-label={t('stock.lot')}>
                  <option value="">{t('stock.adjust.chooseLot')}</option>
                  {lots.map(b => <option key={b.lot_id} value={b.lot_id}>{b.lot_number} — {fmtQty(b.quantity)}</option>)}
                </SearchSelect>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="inline-flex rounded-lg border border-gray-300 p-0.5" role="radiogroup">
                  {['OUT', 'IN'].map(d => (
                    <button key={d} type="button" role="radio" aria-checked={form.direction === d} onClick={() => setForm(f => ({ ...f, direction: d, reason: d === 'IN' ? 'FOUND' : 'DAMAGE' }))}
                      className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium ${form.direction === d ? (d === 'OUT' ? 'bg-red-600 text-white' : 'bg-green-600 text-white') : 'text-gray-600'}`}>
                      {t(`stock.adjust.direction.${d}`)}
                    </button>
                  ))}
                </div>
                <input type="number" min="0" step="any" value={form.quantity} onChange={set('quantity')} placeholder={t('stock.quantity')} className={inputCls} aria-label={t('stock.quantity')} />
              </div>
            </>
          )}
          <SearchSelect value={form.reason} onChange={set('reason')} className={inputCls} aria-label={t('stock.adjust.reason')}>
            {REASONS.map(r => <option key={r} value={r}>{t(`stock.adjust.reasons.${r}`)}</option>)}
          </SearchSelect>
          <textarea rows={2} value={form.comment} onChange={set('comment')} maxLength={2000} className={inputCls} placeholder={t('stock.adjust.commentPlaceholder')} aria-label={t('stock.adjust.commentPlaceholder')} />
          <p className="text-xs text-gray-500">{form.item?.track_serials ? t('stock.adjust.serialHint') : t('stock.adjust.hint')}</p>
        </div>
      </Modal>
    </div>
  );
}
