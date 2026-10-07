// src/components/Stock/StockReturnForm.jsx
// Retour en stock : la logistique récupère auprès d'un employé (départ, fin de mission…) ou d'un département ce qu'il
// détient — équipements (n° de série) et consommables non utilisés — dans un dépôt de son choix.
// État : bon (remis en stock), endommagé (en stock, non réaffectable), perdu (aucune entrée en stock).
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Undo2, Save, Warehouse, CheckSquare, User, Building2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { RecipientPicker } from './StockIssueForm';
import { warehouseService, equipmentService, stockReturnService, stockIssueService } from '../../services/stockService';
import { t, getLocale } from '../../i18n';
import SearchSelect from '../Common/SearchSelect';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);
const ERROR_CODES = ['OVER_RETURN', 'NOT_HOLDER', 'ISSUE_CANCELLED', 'WAREHOUSE_FORBIDDEN', 'NO_LINES', 'HOLDER_REQUIRED'];

export default function StockReturnForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [holderType, setHolderType] = useState(params.get('departmentId') ? 'DEPARTMENT' : 'USER');
  const [departments, setDepartments] = useState([]);
  const [department, setDepartment] = useState(null);
  const [user, setUser] = useState(null);
  const [holdings, setHoldings] = useState(null);
  const [selection, setSelection] = useState({}); // issueLineId → { checked, quantity, condition }
  const [warehouses, setWarehouses] = useState(null);
  const [warehouseId, setWarehouseId] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    warehouseService.mine().then(r => {
      const list = r.data || [];
      setWarehouses(list);
      if (list.length === 1) setWarehouseId(list[0].id);
    }).catch(() => setWarehouses([]));
  }, []);

  const loadHoldings = async (userId) => {
    setHoldings(null);
    setSelection({});
    try {
      const res = await equipmentService.holdings(userId);
      setHoldings(res.data || []);
      if (res.user) setUser(res.user);
    } catch { setHoldings([]); }
  };
  const loadDepartmentHoldings = async (departmentId) => {
    setHoldings(null);
    setSelection({});
    try {
      const res = await equipmentService.departmentHoldings(departmentId);
      setHoldings(res.data || []);
      if (res.department) setDepartment(res.department);
    } catch { setHoldings([]); }
  };
  useEffect(() => {
    stockIssueService.destinations().then(r => setDepartments(r.data?.departments || [])).catch(() => {});
    if (params.get('departmentId')) loadDepartmentHoldings(params.get('departmentId'));
    else if (params.get('userId')) loadHoldings(params.get('userId'));
  }, []);

  const pickUser = (u) => {
    setUser(u);
    if (u) loadHoldings(u.id); else { setHoldings(null); setSelection({}); }
  };
  const pickDepartment = (id) => {
    const d = departments.find(x => String(x.id) === String(id)) || null;
    setDepartment(d);
    if (d) loadDepartmentHoldings(d.id); else { setHoldings(null); setSelection({}); }
  };
  const switchHolder = (type) => {
    if (type === holderType) return;
    setHolderType(type);
    setUser(null);
    setDepartment(null);
    setHoldings(null);
    setSelection({});
  };
  const holder = holderType === 'DEPARTMENT' ? department : user;
  const holderName = holderType === 'DEPARTMENT' ? department?.name : user && `${user.first_name} ${user.last_name}`;

  const sel = (h) => selection[h.issue_line_id] || { checked: false, quantity: h.remaining, condition: 'GOOD' };
  const setSel = (h, patch) => setSelection(prev => ({ ...prev, [h.issue_line_id]: { ...sel(h), ...patch } }));
  const selectAll = () => setSelection(Object.fromEntries((holdings || []).map(h => [h.issue_line_id, { ...sel(h), checked: true }])));

  const chosen = useMemo(() => (holdings || []).filter(h => sel(h).checked), [holdings, selection]);
  const invalid = chosen.some(h => !h.track_serials && !(Number(sel(h).quantity) > 0 && Number(sel(h).quantity) <= h.remaining));

  const submit = async (e) => {
    e.preventDefault();
    if (!holder) { toast.error(holderType === 'DEPARTMENT' ? t('stock.return.err.department') : t('stock.return.err.user')); return; }
    if (!chosen.length) { toast.error(t('stock.return.err.noLines')); return; }
    if (!warehouseId && chosen.some(h => sel(h).condition !== 'LOST')) { toast.error(t('stock.issue.err.warehouse')); return; }
    if (invalid) { toast.error(t('grn.err.fixLines')); return; }
    setSaving(true);
    try {
      const res = await stockReturnService.create({
        warehouseId: warehouseId || (warehouses || [])[0]?.id, comment,
        ...(holderType === 'DEPARTMENT' ? { departmentId: department.id } : { returnedBy: user.id }),
        lines: chosen.map(h => ({ issueLineId: h.issue_line_id, condition: sel(h).condition, ...(h.track_serials ? {} : { quantity: Number(sel(h).quantity) }) })),
      });
      toast.success(t('stock.return.created', { number: res.data.returnNumber }));
      navigate(`/stock/returns/${res.data.id}`);
    } catch (err) {
      const d = err.response?.data || {};
      toast.error(ERROR_CODES.includes(d.code) ? `${t(`stock.return.err.${d.code}`)}${d.message ? ` — ${d.message}` : ''}` : (d.message || t('common.errorOccurred')));
    } finally { setSaving(false); }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <button onClick={() => navigate(-1)} className="mb-6 flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft size={16} /> {t('common.back')}</button>
      <h1 className="mb-1 flex items-center gap-2 text-xl font-bold text-gray-900"><Undo2 className="text-blue-600" /> {t('stock.return.newTitle')}</h1>
      <p className="mb-6 text-sm text-gray-500">{t('stock.return.newSubtitle')}</p>

      <form onSubmit={submit} className="space-y-6" noValidate>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="text-sm">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-medium text-gray-700">{t('stock.return.holderType')} *</span>
              <div className="inline-flex rounded-lg border border-gray-300 p-0.5 text-xs" role="radiogroup">
                {[['USER', User], ['DEPARTMENT', Building2]].map(([key, Icon]) => (
                  <button key={key} type="button" role="radio" aria-checked={holderType === key} onClick={() => switchHolder(key)} data-testid={`return-holder-${key}`}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 ${holderType === key ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                    <Icon size={13} /> {t(`stock.return.holderTypes.${key}`)}
                  </button>
                ))}
              </div>
            </div>
            {holderType === 'USER' ? (
              <>
                <RecipientPicker value={user} onChange={pickUser} />
                {user && user.is_active === false && <p className="mt-1 text-xs text-amber-700">{t('stock.return.inactiveUser')}</p>}
              </>
            ) : (
              <SearchSelect value={department?.id || ''} onChange={e => pickDepartment(e.target.value)} className={inputCls} data-testid="return-department">
                <option value="">{t('stock.return.chooseDepartment')}</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
              </SearchSelect>
            )}
          </div>
          <label className="text-sm">
            <span className="mb-1 flex items-center gap-2 font-medium text-gray-700"><Warehouse size={15} /> {t('stock.return.destination')} *</span>
            {warehouses && warehouses.length === 0 ? (
              <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-700">{t('grn.err.NO_WAREHOUSE_ACCESS')}</p>
            ) : (
              <SearchSelect value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className={inputCls} data-testid="return-warehouse">
                {(warehouses || []).length !== 1 && <option value="">{t('grn.chooseWarehouse')}</option>}
                {(warehouses || []).map(w => <option key={w.id} value={w.id}>{w.location_name} — {w.name} ({w.code})</option>)}
              </SearchSelect>
            )}
          </label>
        </div>

        {holder && (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3">
              <h2 className="font-medium text-gray-700">{t('stock.return.heldBy', { name: holderName })}</h2>
              {holdings?.length > 0 && (
                <button type="button" onClick={selectAll} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800" data-testid="return-all">
                  <CheckSquare size={14} /> {t('stock.return.selectAll')}
                </button>
              )}
            </div>
            {holdings === null ? <p className="p-4 text-sm text-gray-500">{t('common.loading')}</p>
              : holdings.length === 0 ? <p className="p-6 text-center text-sm text-green-700">{t('stock.return.nothingHeld')}</p>
              : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-gray-500">
                    <tr>
                      <th className="w-8 px-3 py-2" />
                      <th className="px-3 py-2">{t('stock.item')}</th>
                      <th className="px-3 py-2">{t('stock.return.issue')}</th>
                      <th className="px-3 py-2 text-right">{t('stock.return.held')}</th>
                      <th className="px-3 py-2">{t('stock.return.returnedQty')}</th>
                      <th className="px-3 py-2">{t('stock.return.condition')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {holdings.map(h => {
                      const s = sel(h);
                      const bad = s.checked && !h.track_serials && !(Number(s.quantity) > 0 && Number(s.quantity) <= h.remaining);
                      return (
                        <tr key={h.issue_line_id} className={s.checked ? 'bg-blue-50/50' : ''}>
                          <td className="px-3 py-2"><input type="checkbox" checked={s.checked} onChange={e => setSel(h, { checked: e.target.checked })} aria-label={h.item_name} /></td>
                          <td className="px-3 py-2">
                            <span className="mr-1 font-mono font-semibold">{h.item_code}</span>{h.item_name}
                            {h.serial_number && <div className="font-mono text-xs text-indigo-700">{t('stock.equipment.serialLabel', { serial: h.serial_number })}{h.asset_tag && ` · ${h.asset_tag}`}</div>}
                            {h.lot_number && <div className="text-xs text-gray-500">{t('grn.lotLabel', { lot: h.lot_number })}</div>}
                          </td>
                          <td className="px-3 py-2 text-xs">{h.issue_number}<div className="text-gray-400">{new Date(h.issued_at).toLocaleDateString(getLocale())}</div></td>
                          <td className="px-3 py-2 text-right">{fmtQty(h.remaining)} <span className="text-xs text-gray-400">{h.unit}</span></td>
                          <td className="px-3 py-2">
                            {h.track_serials ? <span className="text-gray-500">1</span> : (
                              <input type="number" min="0" step="any" max={h.remaining} disabled={!s.checked} value={s.quantity}
                                onChange={e => setSel(h, { quantity: e.target.value })} aria-label={t('stock.return.returnedQty')}
                                className={`${inputCls} w-24 ${bad ? 'border-red-400' : ''}`} />
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <SearchSelect disabled={!s.checked} value={s.condition} onChange={e => setSel(h, { condition: e.target.value })} className={inputCls} aria-label={t('stock.return.condition')}>
                              {['GOOD', 'DAMAGED', 'LOST'].map(c => <option key={c} value={c}>{t(`stock.return.conditions.${c}`)}</option>)}
                            </SearchSelect>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
          </div>
        )}

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">{t('stock.return.comment')}</span>
          <input value={comment} onChange={e => setComment(e.target.value)} maxLength={2000} placeholder={t('stock.return.commentPlaceholder')} className={inputCls} />
        </label>

        <div className="flex gap-3">
          <button type="button" onClick={() => navigate(-1)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">{t('common.cancel')}</button>
          <button type="submit" disabled={saving || !chosen.length} className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            <Save size={16} /> {saving ? t('po.saving') : t('stock.return.save', { count: chosen.length })}
          </button>
        </div>
      </form>
    </div>
  );
}
