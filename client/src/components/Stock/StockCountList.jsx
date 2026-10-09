// src/components/Stock/StockCountList.jsx
// Inventaires physiques : liste (avancement du comptage, écarts) et ouverture d'un inventaire (COUNT_STOCK) —
// dépôt parmi ses accès, catégorie facultative (inventaire partiel).
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipboardCheck, Plus, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import SearchSelect from '../Common/SearchSelect';
import { stockCountService, warehouseService } from '../../services/stockService';
import { usePermissions } from '../../hooks/usePermissions';
import { t, getLocale } from '../../i18n';
import api from '../../services/api';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export function CountStatusBadge({ status }) {
  const cls = { OPEN: 'bg-amber-100 text-amber-800', VALIDATED: 'bg-green-100 text-green-800', CANCELLED: 'bg-gray-200 text-gray-600' }[status];
  return <span className={`rounded-full px-2 py-0.5 text-xs ${cls}`}>{t(`stock.count.status.${status}`)}</span>;
}

export default function StockCountList() {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [warehouses, setWarehouses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({ warehouseId: '', categoryId: '', comment: '' });
  const [busy, setBusy] = useState(false);

  const load = () => { setLoading(true); stockCountService.list({ limit: 100 }).then(r => setRows(r.data || [])).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  const openDialog = async () => {
    setOpen(true);
    try {
      const [w, c] = await Promise.all([warehouseService.mine(), api.get('/public/market-categories')]);
      const list = w.data || [];
      setWarehouses(list);
      setCategories((c.data?.data || []).filter(x => x.is_stockable !== false));
      setForm({ warehouseId: list.length === 1 ? list[0].id : '', categoryId: '', comment: '' });
    } catch { /* toast api */ }
  };

  const submit = async () => {
    if (!form.warehouseId) { toast.error(t('stock.issue.err.warehouse')); return; }
    setBusy(true);
    try {
      const res = await stockCountService.open({ warehouseId: form.warehouseId, categoryId: form.categoryId || undefined, comment: form.comment || undefined });
      toast.success(t('stock.count.opened', { number: res.data.countNumber, count: res.data.lines }));
      navigate(`/stock/counts/${res.data.id}`);
    } catch (err) {
      const d = err.response?.data || {};
      toast.error(d.code === 'COUNT_ALREADY_OPEN' ? t('stock.count.err.COUNT_ALREADY_OPEN') : (d.message || t('common.errorOccurred')));
    } finally { setBusy(false); }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><ClipboardCheck /> {t('stock.count.title')}</h1>
          <p className="text-sm text-gray-500">{t('stock.count.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="rounded-lg border border-gray-300 p-2 hover:bg-gray-50" aria-label={t('common.refresh')}><RefreshCw size={16} /></button>
          {hasPermission('COUNT_STOCK') && (
            <button onClick={openDialog} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700" data-testid="count-new">
              <Plus size={16} /> {t('stock.count.new')}
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        {loading ? <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>
          : rows.length === 0 ? <div className="p-10 text-center text-gray-500">{t('stock.count.none')}</div>
          : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2">{t('stock.count.number')}</th>
                  <th className="px-4 py-2">{t('stock.warehouse')}</th>
                  <th className="px-4 py-2">{t('stock.count.scope')}</th>
                  <th className="px-4 py-2">{t('stock.count.progress')}</th>
                  <th className="px-4 py-2 text-right">{t('stock.count.differences')}</th>
                  <th className="px-4 py-2">{t('stock.mv.date')}</th>
                  <th className="px-4 py-2">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map(c => (
                  <tr key={c.id}>
                    <td className="px-4 py-2"><Link to={`/stock/counts/${c.id}`} className="font-mono font-semibold text-blue-600 hover:underline">{c.count_number}</Link></td>
                    <td className="px-4 py-2">{c.warehouse_name}</td>
                    <td className="px-4 py-2">{c.category_name || t('stock.count.wholeWarehouse')}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 rounded-full bg-gray-100"><div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${c.line_count ? Math.round((c.counted_count / c.line_count) * 100) : 0}%` }} /></div>
                        <span className="text-xs text-gray-500">{c.counted_count}/{c.line_count}</span>
                      </div>
                    </td>
                    <td className={`px-4 py-2 text-right ${c.difference_count ? 'font-semibold text-orange-700' : 'text-gray-400'}`}>{c.difference_count}</td>
                    <td className="whitespace-nowrap px-4 py-2">{new Date(c.created_at).toLocaleDateString(getLocale())}</td>
                    <td className="px-4 py-2"><CountStatusBadge status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      <Modal isOpen={open} onClose={() => !busy && setOpen(false)} title={t('stock.count.new')} size="md" confirmText={t('stock.count.openAction')} onConfirm={submit} isLoading={busy}>
        <div className="space-y-4 text-sm">
          <label className="block">
            <span className="mb-1 block font-medium text-gray-700">{t('stock.warehouse')} *</span>
            <SearchSelect value={form.warehouseId} onChange={e => setForm(f => ({ ...f, warehouseId: e.target.value }))} className={inputCls} data-testid="count-warehouse">
              <option value="">{t('grn.chooseWarehouse')}</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.location_name} — {w.name} ({w.code})</option>)}
            </SearchSelect>
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-gray-700">{t('stock.count.scope')}</span>
            <SearchSelect value={form.categoryId} onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))} className={inputCls}>
              <option value="">{t('stock.count.wholeWarehouse')}</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </SearchSelect>
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-gray-700">{t('stock.return.comment')}</span>
            <input value={form.comment} onChange={e => setForm(f => ({ ...f, comment: e.target.value }))} maxLength={2000} className={inputCls} placeholder={t('stock.count.commentPlaceholder')} />
          </label>
          <p className="text-xs text-gray-500">{t('stock.count.openHint')}</p>
        </div>
      </Modal>
    </div>
  );
}
