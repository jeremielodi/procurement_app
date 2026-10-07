import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Save, PackageCheck, Warehouse, AlertTriangle, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { grnService } from '../../services/grnService';
import { warehouseService } from '../../services/stockService';
import api from '../../services/api';
import CatalogAutocomplete from '../Stock/CatalogAutocomplete';
import { t, getLocale } from '../../i18n';

const EPS = 1e-9;
const toNum = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);
const today = () => new Date().toISOString().slice(0, 10);

// Codes d'erreur du serveur → messages traduits (sinon message du serveur)
const ERROR_KEYS = ['OVER_DELIVERY', 'WAREHOUSE_REQUIRED', 'WAREHOUSE_FORBIDDEN', 'NO_WAREHOUSE_ACCESS', 'LOT_REQUIRED',
  'EXPIRY_REQUIRED', 'LOT_EXPIRED', 'LOT_EXPIRY_MISMATCH', 'INVALID_QUANTITY', 'SERIALS_REQUIRED', 'SERIAL_DUPLICATE', 'SERIAL_EXISTS', 'SERIAL_INTEGER', 'ASSET_TAG_EXISTS', 'ASSET_TAG_DUPLICATE'];

export default function GRNForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const poId   = searchParams.get('poId');
  const taskId = searchParams.get('taskId');

  const [po, setPO] = useState(null);
  const [lines, setLines] = useState([]);
  const [warehouses, setWarehouses] = useState(null); // null = en cours de chargement
  const [warehouseId, setWarehouseId] = useState('');
  const [observations, setObservations] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingPO, setLoadingPO] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (poId) fetchPO(poId);
  }, [poId]);

  useEffect(() => {
    warehouseService.mine()
      .then(r => {
        const list = r.data || [];
        setWarehouses(list);
        if (list.length === 1) setWarehouseId(list[0].id);
      })
      .catch(() => setWarehouses([]));
  }, []);

  async function fetchPO(id) {
    setLoadingPO(true);
    try {
      const res = await api.get(`/purchase-orders/${id}`);
      const data = res.data?.data;
      setPO(data);
      setLines((data?.items || []).map(it => {
        const remaining = Number(it.quantity_remaining ?? it.quantity) || 0;
        return {
          poItemId: it.id,
          item_description: it.item_description || it.description || '',
          ordered: Number(it.quantity) || 0,
          alreadyAccepted: Number(it.delivered_accepted) || 0,
          remaining,
          // Article : celui de la ligne de PO, sinon rattachement possible à la réception
          poLinked: !!it.stock_item_id,
          stockItem: it.stock_item_id
            ? { id: it.stock_item_id, code: it.item_code, name: it.item_name, unit: it.unit, is_stockable: it.is_stockable, track_lots: it.track_lots, track_expiry: it.track_expiry, track_serials: it.track_serials }
            : null,
          quantity_received: remaining,
          quantity_rejected: 0,
          rejection_reason: '',
          lotNumber: '',
          expiryDate: '',
          serialsText: '',
        };
      }));
    } catch {
      toast.error(t('grn.loadPoError'));
    } finally {
      setLoadingPO(false);
    }
  }

  function updateLine(index, patch) {
    setLines(prev => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  // Quantité acceptée = reçue − rejetée ; contrôles par ligne
  const computed = useMemo(() => lines.map(l => {
    const received = toNum(l.quantity_received);
    const rejected = toNum(l.quantity_rejected);
    const accepted = Math.max(received - rejected, 0);
    const toStock = !!(l.stockItem?.is_stockable && accepted > EPS);
    const errors = [];
    if (received < 0 || rejected < 0) errors.push(t('grn.err.negative'));
    if (rejected - received > EPS) errors.push(t('grn.err.rejectedAboveReceived'));
    if (accepted - l.remaining > EPS) errors.push(t('grn.err.overDelivery', { remaining: fmtQty(l.remaining) }));
    if (rejected > EPS && !String(l.rejection_reason).trim()) errors.push(t('grn.reasonRequired'));
    if (toStock && l.stockItem.track_lots && !String(l.lotNumber).trim()) errors.push(t('grn.err.lotRequired'));
    if (toStock && l.stockItem.track_expiry && !l.expiryDate) errors.push(t('grn.err.expiryRequired'));
    if (toStock && l.expiryDate && l.expiryDate < today()) errors.push(t('grn.err.lotExpired'));
    const deferred = [t('grn.err.lotRequired'), t('grn.err.expiryRequired')]; // affichées après tentative d'enregistrement
    // Équipements : une ligne « n° de série ; n° d'inventaire » par unité acceptée
    const serials = String(l.serialsText || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      .map(s => { const [serialNumber, assetTag] = s.split(';').map(x => x.trim()); return { serialNumber, assetTag: assetTag || undefined }; });
    if (toStock && l.stockItem.track_serials) {
      if (!Number.isInteger(accepted)) errors.push(t('grn.err.serialInteger'));
      else if (serials.length !== accepted) { const msg = t('grn.err.serialCount', { expected: accepted, count: serials.length }); errors.push(msg); deferred.push(msg); }
      const keys = serials.map(s => s.serialNumber.toUpperCase());
      if (new Set(keys).size !== keys.length) errors.push(t('grn.err.serialDuplicate'));
    }
    return { received, rejected, accepted, toStock, errors, serials, deferred };
  }), [lines]);

  const needsWarehouse = computed.some(c => c.toStock);
  const hasLineErrors = computed.some(c => c.errors.length);
  const nothingReceived = computed.every(c => c.received <= EPS);
  const warehouseMissing = needsWarehouse && !warehouseId;
  const noWarehouseAccess = needsWarehouse && warehouses !== null && warehouses.length === 0;
  const fullyDelivered = lines.length > 0 && lines.every(l => l.remaining <= EPS);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitted(true);
    if (!poId) { toast.error(t('grn.noPo')); return; }
    if (hasLineErrors) { toast.error(t('grn.err.fixLines')); return; }
    if (nothingReceived) { toast.error(t('grn.err.nothingReceived')); return; }
    if (noWarehouseAccess) { toast.error(t('grn.err.NO_WAREHOUSE_ACCESS')); return; }
    if (warehouseMissing) { toast.error(t('grn.err.WAREHOUSE_REQUIRED')); return; }

    const grnItems = lines
      .map((l, i) => ({ l, c: computed[i] }))
      .filter(({ c }) => c.received > EPS)
      .map(({ l, c }) => ({
        poItemId: l.poItemId,
        item_description: l.item_description,
        quantity_received: c.received,
        quantity_accepted: c.accepted,
        quantity_rejected: c.rejected,
        rejection_reason: l.rejection_reason || null,
        ...(l.stockItem && !l.poLinked ? { stockItemId: l.stockItem.id } : {}),
        ...(c.toStock && l.stockItem.track_lots ? { lotNumber: l.lotNumber.trim(), expiryDate: l.expiryDate || null } : {}),
        ...(c.toStock && l.stockItem.track_serials ? { serials: c.serials } : {}),
      }));

    setLoading(true);
    try {
      const res = await grnService.create({
        poId, grnItems, observations, taskId: taskId || undefined,
        warehouseId: needsWarehouse ? warehouseId : undefined,
      });
      if (res.success) {
        toast.success(t('grn.created', { number: res.data.grnNumber, status: t(`grnStatus.${res.data.status}`, { defaultValue: res.data.status }) }));
        if (res.data.stockMovements) toast.success(t('grn.stockPosted', { count: res.data.stockMovements }));
        navigate(`/goods-receipts/${res.data.id}`);
      } else {
        toast.error(res.message || t('grn.createError'));
      }
    } catch (err) {
      const data = err.response?.data || {};
      toast.error(ERROR_KEYS.includes(data.code) ? `${t(`grn.err.${data.code}`)}${data.message ? ` — ${data.message}` : ''}` : (data.message || t('grn.createError')));
    } finally {
      setLoading(false);
    }
  }

  const inputCls = 'border border-gray-200 rounded px-2 py-1 text-sm';

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 text-sm">
        <ArrowLeft size={16} /> {t('common.back')}
      </button>

      <div className="flex items-center gap-3 mb-6">
        <PackageCheck size={28} className="text-blue-600" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t('grn.newTitle')}</h1>
          {po && <p className="text-gray-500 text-sm">{t('grn.poRef', { number: po.po_number, supplier: po.supplier_name })}</p>}
        </div>
      </div>

      {!poId && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 text-sm text-yellow-800">
          {t('grn.fromPoHint')}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        {po && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
              <div className="grid grid-cols-3 gap-4">
                <div><span className="font-medium text-blue-700">{t('grn.order')}</span><br /><span>{po.po_number}</span></div>
                <div><span className="font-medium text-blue-700">{t('common.supplier')}</span><br /><span>{po.supplier_name}</span></div>
                <div><span className="font-medium text-blue-700">{t('grn.poAmount')}</span><br /><span>{Number(po.total_amount || 0).toLocaleString(getLocale())} {po.currency}</span></div>
              </div>
            </div>

            {/* Dépôt de destination (articles stockables) */}
            <div className={`rounded-lg border p-4 text-sm ${noWarehouseAccess || (submitted && warehouseMissing) ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'}`}>
              <label htmlFor="grn-warehouse" className="mb-1 flex items-center gap-2 font-medium text-gray-700">
                <Warehouse size={16} className="text-gray-500" /> {t('grn.warehouse')}
              </label>
              {!needsWarehouse ? (
                <p className="text-gray-500">{t('grn.noStockableLines')}</p>
              ) : warehouses === null ? (
                <p className="text-gray-500">{t('common.loading')}</p>
              ) : warehouses.length === 0 ? (
                <p className="flex items-start gap-2 text-red-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" /> {t('grn.err.NO_WAREHOUSE_ACCESS')}</p>
              ) : (
                <>
                  <select id="grn-warehouse" value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    data-testid="grn-warehouse">
                    {warehouses.length > 1 && <option value="">{t('grn.chooseWarehouse')}</option>}
                    {warehouses.map(w => (
                      <option key={w.id} value={w.id}>{w.location_name} — {w.name} ({w.code})</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    {warehouses.length > 1 ? t('grn.warehouseChoiceHint') : t('grn.warehouseSingleHint')}
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {fullyDelivered && (
          <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
            <CheckCircle2 size={18} /> {t('grn.alreadyDelivered')}
          </div>
        )}

        {/* Articles */}
        {loadingPO ? (
          <div className="text-center text-gray-500 py-8">{t('grn.loadingItems')}</div>
        ) : lines.length > 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-medium text-gray-700">{t('grn.itemsToReceive')}</h2>
              <span className="text-xs text-gray-500">{t('grn.remainingHint')}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-600">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium min-w-[16rem]">{t('grn.col.item')}</th>
                    <th className="text-right px-3 py-2 font-medium">{t('grn.col.ordered')}</th>
                    <th className="text-right px-3 py-2 font-medium">{t('grn.col.alreadyAccepted')}</th>
                    <th className="text-right px-3 py-2 font-medium">{t('grn.col.remaining')}</th>
                    <th className="text-center px-3 py-2 font-medium">{t('grn.col.received')}</th>
                    <th className="text-center px-3 py-2 font-medium">{t('grn.col.rejected')}</th>
                    <th className="text-center px-3 py-2 font-medium">{t('grn.col.accepted')}</th>
                    <th className="text-left px-3 py-2 font-medium min-w-[12rem]">{t('grn.col.reasonLot')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lines.map((l, i) => {
                    const c = computed[i];
                    const done = l.remaining <= EPS;
                    const showErrors = submitted || c.errors.some(e => !c.deferred.includes(e));
                    return (
                      <tr key={l.poItemId} className={done ? 'bg-gray-50 text-gray-400' : c.errors.length && showErrors ? 'bg-red-50/60' : ''}>
                        <td className="px-3 py-2 align-top">
                          <div className="font-medium text-gray-800">{l.item_description}</div>
                          {l.poLinked ? (
                            <div className="mt-1 inline-flex items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700">
                              <span className="font-semibold">{l.stockItem.code}</span> · {l.stockItem.unit}
                              {!l.stockItem.is_stockable && <span className="text-gray-500"> · {t('stock.notStockable')}</span>}
                            </div>
                          ) : !done && (
                            <div className="mt-1 max-w-xs">
                              <CatalogAutocomplete
                                linked={l.stockItem}
                                onLink={(stockItem) => updateLine(i, { stockItem })}
                                placeholder={t('grn.linkItem')}
                                className={`${inputCls} w-full text-xs`}
                                minChars={1}
                              />
                            </div>
                          )}
                          {c.toStock && <div className="mt-1 text-xs text-green-700">{t('grn.willEnterStock', { qty: fmtQty(c.accepted), unit: l.stockItem.unit })}</div>}
                          {showErrors && c.errors.map(err => <div key={err} className="mt-1 text-xs text-red-600">{err}</div>)}
                        </td>
                        <td className="px-3 py-2 text-right align-top">{fmtQty(l.ordered)}</td>
                        <td className="px-3 py-2 text-right align-top">{fmtQty(l.alreadyAccepted)}</td>
                        <td className="px-3 py-2 text-right align-top font-semibold">{done ? t('grn.delivered') : fmtQty(l.remaining)}</td>
                        <td className="px-3 py-2 text-center align-top">
                          <input type="number" min="0" step="any" disabled={done}
                            aria-label={t('grn.col.received')}
                            className={`${inputCls} w-24 text-center`}
                            value={l.quantity_received}
                            onChange={e => updateLine(i, { quantity_received: e.target.value })} />
                        </td>
                        <td className="px-3 py-2 text-center align-top">
                          <input type="number" min="0" step="any" disabled={done}
                            aria-label={t('grn.col.rejected')}
                            className={`${inputCls} w-24 text-center`}
                            value={l.quantity_rejected}
                            onChange={e => updateLine(i, { quantity_rejected: e.target.value })} />
                        </td>
                        <td className="px-3 py-2 text-center align-top">
                          <span className="inline-block w-24 rounded border border-blue-200 bg-blue-50 px-2 py-1 font-medium">{fmtQty(c.accepted)}</span>
                        </td>
                        <td className="px-3 py-2 align-top space-y-1">
                          {c.rejected > EPS && (
                            <input className={`${inputCls} w-full`} placeholder={t('grn.reasonRequired')}
                              value={l.rejection_reason} onChange={e => updateLine(i, { rejection_reason: e.target.value })} />
                          )}
                          {c.toStock && l.stockItem.track_serials && (
                            <textarea rows={Math.min(Math.max(c.accepted, 2), 6)} className={`${inputCls} w-full font-mono text-xs`}
                              placeholder={t('grn.serialsPlaceholder')} aria-label={t('grn.serials')} title={t('grn.serialsHint')}
                              value={l.serialsText} onChange={e => updateLine(i, { serialsText: e.target.value })} />
                          )}
                          {c.toStock && l.stockItem.track_lots && (
                            <div className="grid gap-1">
                              <input className={`${inputCls} w-full`} placeholder={t('grn.lotNumber')} aria-label={t('grn.lotNumber')}
                                value={l.lotNumber} onChange={e => updateLine(i, { lotNumber: e.target.value })} />
                              <input type="date" className={`${inputCls} w-full`} min={today()} aria-label={t('grn.expiryDate')}
                                title={l.stockItem.track_expiry ? t('grn.expiryDate') : t('grn.expiryOptional')}
                                value={l.expiryDate} onChange={e => updateLine(i, { expiryDate: e.target.value })} />
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : poId && !loadingPO ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-500 text-center">
            {t('grn.noItems')}
          </div>
        ) : null}

        {/* Observations */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('grn.observations')}</label>
          <textarea
            rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t('grn.observationsPlaceholder')}
            value={observations}
            onChange={e => setObservations(e.target.value)}
          />
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={() => navigate(-1)}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={loading || !poId || fullyDelivered}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? t('po.saving') : <><Save size={16} /> {t('grn.save')}</>}
          </button>
        </div>
      </form>
    </div>
  );
}
