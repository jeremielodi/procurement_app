// src/components/Stock/EquipmentList.jsx
// Parc d'équipements suivis par n° de série : où est chaque unité (dépôt) ou qui la détient,
// enregistrement du parc existant, fiche (historique, état, réforme).
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Laptop, Plus, RefreshCw, Search, History } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import { equipmentService, stockItemService, warehouseService } from '../../services/stockService';
import { usePermissions } from '../../hooks/usePermissions';
import { MovementTable } from './StockMovements';
import { t, getLocale } from '../../i18n';
import SearchSelect from '../Common/SearchSelect';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const STATUS_CLS = { IN_STOCK: 'bg-green-100 text-green-800', ASSIGNED: 'bg-blue-100 text-blue-800', IN_TRANSIT: 'bg-violet-100 text-violet-800', LOST: 'bg-red-100 text-red-700', RETIRED: 'bg-gray-200 text-gray-600' };
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(getLocale()) : '—');

export function UnitStatusBadge({ status }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLS[status] || 'bg-gray-100'}`}>{t(`stock.equipment.status.${status}`)}</span>;
}

export default function EquipmentList() {
  const { hasPermission } = usePermissions();
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({});
  const [serialItems, setSerialItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [filters, setFilters] = useState({ search: '', status: '', stockItemId: '' });
  const [debounced, setDebounced] = useState(filters);
  const [loading, setLoading] = useState(true);
  const [register, setRegister] = useState(null);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    stockItemService.list({ limit: 1000 }).then(r => setSerialItems((r.data || []).filter(i => i.track_serials))).catch(() => {});
    warehouseService.mine().then(r => setWarehouses(r.data || [])).catch(() => {});
  }, []);
  useEffect(() => { const id = setTimeout(() => setDebounced(filters), 300); return () => clearTimeout(id); }, [filters]);

  const load = async () => {
    setLoading(true);
    try {
      const clean = Object.fromEntries(Object.entries(debounced).filter(([, v]) => v));
      const res = await equipmentService.units({ ...clean, limit: 500 });
      setRows(res.data || []);
      setPagination(res.pagination || {});
    } catch { /* toast api */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [debounced]);
  const set = (k) => (e) => setFilters(f => ({ ...f, [k]: e.target.value }));

  const saveRegister = async () => {
    const units = register.text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      .map(s => { const [serialNumber, assetTag] = s.split(';').map(x => x.trim()); return { serialNumber, assetTag: assetTag || undefined }; });
    if (!register.stockItemId || !register.warehouseId || !units.length) { toast.error(t('stock.equipment.registerRequired')); return; }
    setSaving(true);
    try {
      const res = await equipmentService.register({ stockItemId: register.stockItemId, warehouseId: register.warehouseId, units });
      toast.success(t('stock.equipment.registered', { count: res.data.created }));
      setRegister(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || t('common.errorOccurred'));
    } finally { setSaving(false); }
  };

  const openDetail = async (id) => {
    try { setDetail((await equipmentService.unit(id)).data); } catch { /* toast api */ }
  };
  const updateUnit = async (payload, message) => {
    try {
      await equipmentService.updateUnit(detail.id, payload);
      toast.success(message);
      await openDetail(detail.id);
      load();
    } catch { /* toast api */ }
  };

  const counts = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><Laptop /> {t('stock.equipment.title')}</h1>
          <p className="text-sm text-gray-500">{t('stock.equipment.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="rounded-lg border border-gray-300 p-2 hover:bg-gray-50" title={t('common.refresh')} aria-label={t('common.refresh')}><RefreshCw size={16} /></button>
          {hasPermission('MANAGE_STOCK_ITEMS') && (
            <button onClick={() => setRegister({ stockItemId: '', warehouseId: warehouses.length === 1 ? warehouses[0].id : '', text: '' })} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700" data-testid="register-units">
              <Plus size={16} /> {t('stock.equipment.register')}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {['IN_STOCK', 'ASSIGNED', 'IN_TRANSIT', 'LOST', 'RETIRED'].map(s => (
          <button key={s} onClick={() => setFilters(f => ({ ...f, status: f.status === s ? '' : s }))}
            className={`rounded-full px-3 py-1 ${filters.status === s ? 'ring-2 ring-blue-400 ' : ''}${STATUS_CLS[s]}`}>
            {t(`stock.equipment.status.${s}`)}{!filters.status && counts[s] ? ` · ${counts[s]}` : ''}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={filters.search} onChange={set('search')} placeholder={t('stock.equipment.search')} className={`${inputCls} pl-9`} />
        </div>
        <SearchSelect value={filters.stockItemId} onChange={set('stockItemId')} className={`${inputCls} w-auto`} aria-label={t('stock.item')}>
          <option value="">{t('stock.equipment.allItems')}</option>
          {serialItems.map(i => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
        </SearchSelect>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        {loading ? <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>
          : rows.length === 0 ? <div className="p-10 text-center text-gray-500">{t('stock.equipment.none')}</div>
          : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2">{t('stock.equipment.serial')}</th>
                  <th className="px-4 py-2">{t('stock.equipment.assetTag')}</th>
                  <th className="px-4 py-2">{t('stock.item')}</th>
                  <th className="px-4 py-2">{t('common.status')}</th>
                  <th className="px-4 py-2">{t('stock.equipment.where')}</th>
                  <th className="px-4 py-2">{t('stock.equipment.since')}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map(u => (
                  <tr key={u.id}>
                    <td className="px-4 py-2 font-mono font-semibold">{u.serial_number}</td>
                    <td className="px-4 py-2 font-mono text-xs">{u.asset_tag || '—'}</td>
                    <td className="px-4 py-2">{u.item_name}</td>
                    <td className="px-4 py-2"><UnitStatusBadge status={u.status} />{u.condition === 'DAMAGED' && <span className="ml-1 text-xs text-amber-700">{t('stock.equipment.condition.DAMAGED')}</span>}</td>
                    <td className="px-4 py-2">
                      {u.status === 'ASSIGNED' && u.department_id ? (
                        <>
                          <b>{t('stock.equipment.departmentHolder', { name: u.department_name })}</b>
                          {hasPermission('ISSUE_STOCK') && <Link to={`/stock/returns/new?departmentId=${u.department_id}`} className="ml-2 text-xs text-blue-600 hover:underline">{t('stock.equipment.recover')}</Link>}
                        </>
                      ) : u.status === 'ASSIGNED' ? (
                        <>
                          <b>{u.holder_name}</b>{u.holder_active === false && <span className="ml-1 rounded bg-red-50 px-1 text-xs text-red-700">{t('stock.equipment.holderInactive')}</span>}
                          {hasPermission('ISSUE_STOCK') && <Link to={`/stock/returns/new?userId=${u.holder_id}`} className="ml-2 text-xs text-blue-600 hover:underline">{t('stock.equipment.recover')}</Link>}
                        </>
                      ) : (u.warehouse_name || '—')}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">{u.status === 'ASSIGNED' ? fmtDate(u.assigned_at) : fmtDate(u.updated_at)}</td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => openDetail(u.id)} className="rounded p-1.5 text-gray-600 hover:bg-gray-100" title={t('stock.equipment.history')} aria-label={t('stock.equipment.history')}><History size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
      {pagination.total > rows.length && <p className="text-xs text-gray-500">{t('stock.equipment.truncated', { shown: rows.length, total: pagination.total })}</p>}

      <Modal isOpen={!!register} onClose={() => !saving && setRegister(null)} title={t('stock.equipment.register')} confirmText={t('common.save')} onConfirm={saveRegister} isLoading={saving} size="lg">
        {register && (
          <div className="space-y-3 text-sm">
            <p className="text-gray-600">{t('stock.equipment.registerHint')}</p>
            <SearchSelect value={register.stockItemId} onChange={e => setRegister({ ...register, stockItemId: e.target.value })} className={inputCls} aria-label={t('stock.item')}>
              <option value="">{t('stock.equipment.chooseItem')}</option>
              {serialItems.map(i => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
            </SearchSelect>
            {serialItems.length === 0 && <p className="text-xs text-amber-700">{t('stock.equipment.noSerialItems')}</p>}
            <SearchSelect value={register.warehouseId} onChange={e => setRegister({ ...register, warehouseId: e.target.value })} className={inputCls} aria-label={t('stock.warehouse')}>
              <option value="">{t('grn.chooseWarehouse')}</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.location_name} — {w.name}</option>)}
            </SearchSelect>
            <textarea rows={8} value={register.text} onChange={e => setRegister({ ...register, text: e.target.value })}
              placeholder={t('grn.serialsPlaceholder')} aria-label={t('grn.serials')} className={`${inputCls} font-mono`} />
            <p className="text-xs text-gray-500">{t('stock.equipment.lineCount', { count: register.text.split(/\r?\n/).filter(s => s.trim()).length })}</p>
          </div>
        )}
      </Modal>

      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={detail ? `${detail.item_name} — ${detail.serial_number}` : ''} showFooter={false} size="xl">
        {detail && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <UnitStatusBadge status={detail.status} />
              <span>{t(`stock.equipment.condition.${detail.condition}`)}</span>
              {detail.asset_tag && <span className="font-mono text-gray-500">{detail.asset_tag}</span>}
              <span className="text-gray-500">{detail.status === 'ASSIGNED' ? t('stock.equipment.heldBy', { name: detail.department_name ? t('stock.equipment.departmentHolder', { name: detail.department_name }) : detail.holder_name }) : detail.warehouse_name}</span>
            </div>
            {detail.notes && <p className="rounded bg-gray-50 p-2 text-gray-700">{detail.notes}</p>}
            {detail.status === 'IN_STOCK' && hasPermission('ISSUE_STOCK') && (
              <div className="flex flex-wrap gap-2">
                {detail.condition === 'GOOD'
                  ? <button onClick={() => updateUnit({ condition: 'DAMAGED' }, t('stock.equipment.updated'))} className="rounded-lg border border-amber-300 px-3 py-1.5 text-amber-700 hover:bg-amber-50">{t('stock.equipment.markDamaged')}</button>
                  : <button onClick={() => updateUnit({ condition: 'GOOD' }, t('stock.equipment.updated'))} className="rounded-lg border border-green-300 px-3 py-1.5 text-green-700 hover:bg-green-50">{t('stock.equipment.markRepaired')}</button>}
                <button onClick={() => { const reason = window.prompt(t('stock.equipment.retireReason')); if (reason !== null) updateUnit({ retire: true, reason }, t('stock.equipment.retired')); }}
                  className="rounded-lg border border-red-300 px-3 py-1.5 text-red-700 hover:bg-red-50">{t('stock.equipment.retire')}</button>
              </div>
            )}
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <MovementTable rows={detail.history || []} showItem={false} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
