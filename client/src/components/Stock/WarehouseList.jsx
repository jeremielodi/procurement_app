// src/components/Stock/WarehouseList.jsx
// Dépôts de l'entreprise (admin d'entreprise : MANAGE_WAREHOUSES) — une localisation peut avoir plusieurs dépôts.
// Accès : l'admin choisit les utilisateurs (logistique…) autorisés à réceptionner dans chaque dépôt.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Warehouse, Plus, Pencil, Users, RefreshCw, MapPin, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import { warehouseService } from '../../services/stockService';
import { locationService } from '../../services/referenceService';
import { userService } from '../../services/userService';
import { usePermissions } from '../../hooks/usePermissions';
import { t } from '../../i18n';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const EMPTY = { code: '', name: '', locationId: '', address: '', description: '' };

export default function WarehouseList() {
  const { hasPermission } = usePermissions();
  const canManage = hasPermission('MANAGE_WAREHOUSES');
  const [rows, setRows] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // { ...form, id? }
  const [saving, setSaving] = useState(false);
  const [access, setAccess] = useState(null); // dépôt dont on gère les accès

  const load = async () => {
    setLoading(true);
    try {
      setRows((await warehouseService.list({ all: 1 })).data || []);
    } catch { /* toast api */ } finally { setLoading(false); }
  };
  useEffect(() => {
    load();
    locationService.listPublic().then(r => setLocations(r.data || [])).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter(w => [w.code, w.name, w.location_name].some(v => String(v || '').toLowerCase().includes(q))) : rows;
  }, [rows, search]);

  // Regroupement par localisation (une ville peut avoir plusieurs dépôts)
  const byLocation = useMemo(() => {
    const map = new Map();
    for (const w of filtered) {
      if (!map.has(w.location_name)) map.set(w.location_name, []);
      map.get(w.location_name).push(w);
    }
    return [...map.entries()];
  }, [filtered]);

  const save = async () => {
    if (!editing.code.trim() || !editing.name.trim() || !editing.locationId) {
      toast.error(t('stock.wh.required'));
      return;
    }
    setSaving(true);
    try {
      const payload = { code: editing.code.trim(), name: editing.name.trim(), locationId: Number(editing.locationId), address: editing.address, description: editing.description };
      if (editing.id) await warehouseService.update(editing.id, payload);
      else await warehouseService.create(payload);
      toast.success(editing.id ? t('stock.wh.updated') : t('stock.wh.created'));
      setEditing(null);
      load();
    } catch { /* toast api */ } finally { setSaving(false); }
  };

  const toggleActive = async (w) => {
    try {
      await warehouseService.update(w.id, { isActive: !w.is_active });
      load();
    } catch { /* toast api */ }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Warehouse /> {t('stock.wh.title')}</h1>
          <p className="text-sm text-gray-500">{t('stock.wh.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50" title={t('common.refresh')}><RefreshCw size={16} /></button>
          {canManage && (
            <button onClick={() => setEditing({ ...EMPTY })} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm" data-testid="wh-new">
              <Plus size={16} /> {t('stock.wh.new')}
            </button>
          )}
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('stock.wh.search')} className={`${inputCls} pl-9`} />
      </div>

      {loading ? (
        <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>
      ) : byLocation.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">{t('stock.wh.none')}</div>
      ) : byLocation.map(([location, list]) => (
        <div key={location} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-gray-50 border-b text-sm font-semibold text-gray-700 flex items-center gap-2">
            <MapPin size={14} /> {location} <span className="font-normal text-gray-500">· {t('stock.wh.count', { count: list.length })}</span>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2">{t('stock.code')}</th>
                <th className="px-4 py-2">{t('stock.wh.name')}</th>
                <th className="px-4 py-2">{t('stock.wh.address')}</th>
                <th className="px-4 py-2 text-right">{t('stock.wh.users')}</th>
                <th className="px-4 py-2 text-right">{t('stock.wh.stockedLines')}</th>
                <th className="px-4 py-2">{t('common.status')}</th>
                <th className="px-4 py-2 text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.map(w => (
                <tr key={w.id} className={w.is_active ? '' : 'text-gray-400'}>
                  <td className="px-4 py-2 font-mono font-semibold">{w.code}</td>
                  <td className="px-4 py-2">
                    <Link to={`/stock?warehouseId=${w.id}`} className="text-blue-600 hover:underline">{w.name}</Link>
                  </td>
                  <td className="px-4 py-2">{w.address || '—'}</td>
                  <td className="px-4 py-2 text-right">{w.user_count}</td>
                  <td className="px-4 py-2 text-right">{w.stocked_lines}</td>
                  <td className="px-4 py-2">
                    <button disabled={!canManage} onClick={() => toggleActive(w)}
                      className={`px-2 py-0.5 rounded-full text-xs ${w.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}
                      title={canManage ? (w.is_active ? t('stock.wh.deactivate') : t('stock.wh.reactivate')) : undefined}>
                      {w.is_active ? t('refs.active') : t('refs.inactive')}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {canManage && (
                      <>
                        <button onClick={() => setAccess(w)} className="p-1.5 text-gray-600 hover:bg-gray-100 rounded" title={t('stock.wh.manageAccess')} aria-label={t('stock.wh.manageAccess')}><Users size={16} /></button>
                        <button onClick={() => setEditing({ id: w.id, code: w.code, name: w.name, locationId: String(w.location_id), address: w.address || '', description: w.description || '' })}
                          className="p-1.5 text-gray-600 hover:bg-gray-100 rounded" title={t('common.edit')} aria-label={t('common.edit')}><Pencil size={16} /></button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <Modal
        isOpen={!!editing}
        onClose={() => !saving && setEditing(null)}
        title={editing?.id ? t('stock.wh.editTitle') : t('stock.wh.new')}
        confirmText={t('common.save')}
        onConfirm={save}
        isLoading={saving}
      >
        {editing && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-gray-700">{t('stock.code')} *</span>
              <input className={`${inputCls} font-mono uppercase`} maxLength={30} value={editing.code} onChange={e => setEditing({ ...editing, code: e.target.value.toUpperCase() })} placeholder="GOM-01" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-gray-700">{t('stock.wh.location')} *</span>
              <select className={inputCls} value={editing.locationId} onChange={e => setEditing({ ...editing, locationId: e.target.value })}>
                <option value="">{t('common.select')}</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}{l.province ? ` (${l.province})` : ''}</option>)}
              </select>
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block font-medium text-gray-700">{t('stock.wh.name')} *</span>
              <input className={inputCls} maxLength={150} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder={t('stock.wh.namePlaceholder')} />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block font-medium text-gray-700">{t('stock.wh.address')}</span>
              <input className={inputCls} value={editing.address} onChange={e => setEditing({ ...editing, address: e.target.value })} />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block font-medium text-gray-700">{t('common.description')}</span>
              <textarea rows={2} className={inputCls} value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} />
            </label>
          </div>
        )}
      </Modal>

      {access && <WarehouseAccessModal warehouse={access} onClose={(changed) => { setAccess(null); if (changed) load(); }} />}
    </div>
  );
}

/** Accès au dépôt : utilisateurs actifs de l'entreprise (profil logistique mis en avant) */
function WarehouseAccessModal({ warehouse, onClose }) {
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([userService.getAll(), warehouseService.get(warehouse.id)])
      .then(([u, w]) => {
        const list = (u.data || []).filter(x => x.is_active && !(x.profile_ids || []).includes('prof_supplier'));
        const isLogistic = (x) => (x.profile_ids || []).includes('prof_logistic');
        list.sort((a, b) => (isLogistic(b) - isLogistic(a)) || `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`));
        setUsers(list);
        setSelected(new Set((w.data?.users || []).map(x => String(x.id))));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [warehouse.id]);

  const visible = users.filter(u => !filter.trim()
    || `${u.first_name} ${u.last_name} ${u.email}`.toLowerCase().includes(filter.trim().toLowerCase()));

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const save = async () => {
    setSaving(true);
    try {
      await warehouseService.setUsers(warehouse.id, [...selected]);
      toast.success(t('stock.wh.accessSaved'));
      onClose(true);
    } catch { /* toast api */ } finally { setSaving(false); }
  };

  return (
    <Modal isOpen onClose={() => !saving && onClose(false)} title={t('stock.wh.accessTitle', { name: warehouse.name })}
      confirmText={t('common.save')} onConfirm={save} isLoading={saving} size="lg">
      <p className="mb-3 text-sm text-gray-600">{t('stock.wh.accessHint')}</p>
      <input value={filter} onChange={e => setFilter(e.target.value)} placeholder={t('common.search')} className={`${inputCls} mb-3`} />
      {loading ? (
        <div className="flex justify-center p-6"><RefreshCw className="animate-spin text-blue-500" /></div>
      ) : (
        <ul className="max-h-80 divide-y overflow-auto rounded-lg border border-gray-200">
          {visible.map(u => {
            const id = String(u.id);
            const logistic = (u.profile_ids || []).includes('prof_logistic');
            return (
              <li key={id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50">
                  <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} className="rounded border-gray-300 text-blue-600" />
                  <span className="flex-1">
                    <span className="font-medium text-gray-900">{u.first_name} {u.last_name}</span>
                    <span className="block text-xs text-gray-500">{u.email}</span>
                  </span>
                  {logistic && <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{t('stock.wh.logistic')}</span>}
                </label>
              </li>
            );
          })}
          {visible.length === 0 && <li className="px-3 py-4 text-center text-sm text-gray-500">{t('refs.none')}</li>}
        </ul>
      )}
      <p className="mt-2 text-xs text-gray-500">{t('stock.wh.selectedCount', { count: selected.size })}</p>
    </Modal>
  );
}
