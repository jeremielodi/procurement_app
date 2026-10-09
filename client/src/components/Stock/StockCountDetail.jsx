// src/components/Stock/StockCountDetail.jsx
// Un inventaire : saisie des quantités comptées (équipements : présent / absent), comptage à l'aveugle (masque
// l'attendu et l'écart), stock trouvé non attendu, validation des écarts (ADJUST_STOCK) ou annulation.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ClipboardCheck, RefreshCw, Save, Plus, CheckCircle2, Ban, EyeOff, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import CatalogAutocomplete from './CatalogAutocomplete';
import { CountStatusBadge } from './StockCountList';
import { stockCountService } from '../../services/stockService';
import { usePermissions } from '../../hooks/usePermissions';
import { t, getLocale } from '../../i18n';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const ERROR_CODES = ['NOT_COMPLETE', 'BALANCE_CHANGED', 'COUNT_CLOSED', 'LINE_EXISTS', 'SERIAL_ITEM', 'EXPIRY_REQUIRED', 'LOT_REQUIRED',
  'INVALID_QUANTITY', 'INVALID_UNIT_COUNT', 'WAREHOUSE_FORBIDDEN', 'ITEM_NOT_STOCKABLE'];

export default function StockCountDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const [count, setCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({}); // lineId → { counted, note } modifiés, pas encore enregistrés
  const [blind, setBlind] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null); // 'validate' | 'cancel' | 'add'
  const [reason, setReason] = useState('');
  const [found, setFound] = useState({ item: null, text: '', lotNumber: '', expiryDate: '', quantity: '', note: '' });
  const [filter, setFilter] = useState('');

  const load = () => stockCountService.get(id).then(r => { setCount(r.data); setDraft({}); }).catch(() => setCount(null)).finally(() => setLoading(false));
  useEffect(() => { load(); }, [id]);

  const showError = (err) => {
    const d = err.response?.data || {};
    toast.error(ERROR_CODES.includes(d.code) ? `${t(`stock.count.err.${d.code}`, { count: d.pending })}${d.code === 'BALANCE_CHANGED' && d.message ? ` — ${d.message}` : ''}` : (d.message || t('common.errorOccurred')));
  };

  const lines = useMemo(() => (count?.lines || []).map(l => {
    const d = draft[l.id];
    const counted = d ? (d.counted === '' ? null : Number(String(d.counted).replace(',', '.'))) : l.counted_quantity;
    return { ...l, counted, note: d?.note ?? l.note, dirty: !!d, difference: counted === null || counted === undefined ? null : counted - l.expected_quantity };
  }), [count, draft]);

  if (loading) return <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>;
  if (!count) return <div className="p-6 text-gray-500">{t('stock.count.notFound')}</div>;

  const editable = count.status === 'OPEN' && hasPermission('COUNT_STOCK');
  const counted = lines.filter(l => l.counted !== null && l.counted !== undefined).length;
  const withDiff = lines.filter(l => l.difference !== null && Math.abs(l.difference) > 1e-9);
  const dirty = Object.keys(draft).length;
  const q = filter.trim().toLowerCase();
  const shown = q ? lines.filter(l => [l.item_code, l.item_name, l.lot_number, l.serial_number].filter(Boolean).some(v => v.toLowerCase().includes(q))) : lines;

  const setLine = (l, patch) => setDraft(d => ({ ...d, [l.id]: { counted: d[l.id]?.counted ?? (l.counted_quantity ?? ''), note: d[l.id]?.note ?? (l.note || ''), ...patch } }));
  const fillExpected = () => setDraft(Object.fromEntries(lines.filter(l => l.counted === null || l.counted === undefined).map(l => [l.id, { counted: String(l.expected_quantity), note: l.note || '' }])));

  const save = async () => {
    setBusy(true);
    try {
      await stockCountService.record(count.id, Object.entries(draft).map(([lineId, v]) => ({
        lineId, countedQuantity: v.counted === '' ? null : Number(String(v.counted).replace(',', '.')), note: v.note || null,
      })));
      toast.success(t('stock.count.saved', { count: dirty }));
      await load();
    } catch (err) { showError(err); } finally { setBusy(false); }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      if (dialog === 'validate') {
        const res = await stockCountService.validate(count.id);
        toast.success(t('stock.count.validated', { count: res.data.adjustedLines }));
      } else if (dialog === 'cancel') {
        await stockCountService.cancel(count.id, reason.trim() || undefined);
        toast.success(t('stock.count.cancelled'));
      } else {
        if (!found.item) { toast.error(t('stock.count.err.chooseItem')); setBusy(false); return; }
        await stockCountService.addLine(count.id, {
          stockItemId: found.item.id, lotNumber: found.lotNumber || undefined, expiryDate: found.expiryDate || undefined,
          countedQuantity: Number(String(found.quantity).replace(',', '.')), note: found.note || undefined,
        });
        toast.success(t('stock.count.lineAdded'));
        setFound({ item: null, text: '', lotNumber: '', expiryDate: '', quantity: '', note: '' });
      }
      setDialog(null);
      await load();
    } catch (err) { showError(err); } finally { setBusy(false); }
  };

  return (
    <div className="p-6 space-y-5 max-w-6xl mx-auto">
      <button onClick={() => navigate('/stock/counts')} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft size={16} /> {t('stock.count.title')}</button>

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-gray-200 bg-white p-5">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900"><ClipboardCheck className="text-blue-600" /> {count.count_number}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {count.warehouse_location} — {count.warehouse_name} · {count.category_name || t('stock.count.wholeWarehouse')} · {t('stock.count.openedBy', { name: count.created_by_name || '—', date: fmtDateTime(count.created_at) })}
          </p>
          {count.comment && <p className="mt-1 text-sm text-gray-700">{count.comment}</p>}
        </div>
        <CountStatusBadge status={count.status} />
      </div>

      {count.status === 'VALIDATED' && <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{t('stock.count.validatedOn', { name: count.validated_by_name || '—', date: fmtDateTime(count.validated_at) })}</div>}
      {count.status === 'CANCELLED' && <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">{t('stock.count.cancelledOn', { name: count.cancelled_by_name || '—', date: fmtDateTime(count.cancelled_at), reason: count.cancel_reason || '—' })}</div>}

      <div className="grid gap-3 sm:grid-cols-3">
        {[[t('stock.count.progress'), `${counted} / ${lines.length}`], [t('stock.count.differences'), blind && count.status === 'OPEN' ? '—' : withDiff.length], [t('stock.count.unsaved'), dirty]].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-gray-200 bg-white p-3"><div className="text-xs text-gray-500">{label}</div><div className="text-xl font-bold text-gray-900">{value}</div></div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder={t('stock.count.filter')} className={`${inputCls} max-w-xs`} />
        {count.status === 'OPEN' && (
          <button onClick={() => setBlind(b => !b)} className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50" data-testid="count-blind">
            {blind ? <Eye size={16} /> : <EyeOff size={16} />} {blind ? t('stock.count.showExpected') : t('stock.count.blind')}
          </button>
        )}
        <div className="flex-1" />
        {editable && <button onClick={fillExpected} className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50" title={t('stock.count.fillExpectedHint')}>{t('stock.count.fillExpected')}</button>}
        {editable && <button onClick={() => setDialog('add')} className="flex items-center gap-2 rounded-lg border border-blue-300 px-3 py-2 text-sm text-blue-700 hover:bg-blue-50" data-testid="count-add"><Plus size={16} /> {t('stock.count.addFound')}</button>}
        {editable && <button onClick={save} disabled={!dirty || busy} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50" data-testid="count-save"><Save size={16} /> {t('stock.count.save')}</button>}
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2">{t('stock.item')}</th>
              <th className="px-3 py-2">{t('stock.count.lotOrSerial')}</th>
              {!(blind && count.status === 'OPEN') && <th className="px-3 py-2 text-right">{t('stock.count.expected')}</th>}
              <th className="px-3 py-2">{t('stock.count.counted')}</th>
              {!(blind && count.status === 'OPEN') && <th className="px-3 py-2 text-right">{t('stock.count.difference')}</th>}
              <th className="px-3 py-2">{t('stock.count.note')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map(l => (
              <tr key={l.id} className={l.dirty ? 'bg-blue-50/50' : ''}>
                <td className="px-3 py-2"><span className="mr-1 font-mono font-semibold">{l.item_code}</span>{l.item_name}
                  {l.added_during_count && <span className="ml-2 rounded bg-indigo-50 px-1 text-xs text-indigo-700">{t('stock.count.foundBadge')}</span>}
                </td>
                <td className="px-3 py-2 text-xs">{l.serial_number ? <span className="font-mono text-indigo-700">{l.serial_number}{l.asset_tag && ` · ${l.asset_tag}`}</span> : l.lot_number || '—'}</td>
                {!(blind && count.status === 'OPEN') && <td className="px-3 py-2 text-right">{fmtQty(l.expected_quantity)} <span className="text-xs text-gray-400">{l.unit}</span></td>}
                <td className="px-3 py-2">
                  {!editable ? <span className="font-medium">{l.counted === null || l.counted === undefined ? '—' : fmtQty(l.counted)}</span>
                    : l.unit_id ? (
                      <div className="inline-flex rounded-lg border border-gray-300 p-0.5 text-xs" role="radiogroup">
                        {[[1, t('stock.count.present')], [0, t('stock.count.missing')]].map(([v, label]) => (
                          <button key={v} type="button" role="radio" aria-checked={l.counted === v} onClick={() => setLine(l, { counted: String(v) })}
                            className={`rounded-md px-2 py-1 ${l.counted === v ? (v ? 'bg-green-600 text-white' : 'bg-red-600 text-white') : 'text-gray-600 hover:bg-gray-100'}`}>{label}</button>
                        ))}
                      </div>
                    ) : (
                      <input type="number" min="0" step="any" value={draft[l.id]?.counted ?? (l.counted_quantity ?? '')} aria-label={t('stock.count.counted')}
                        onChange={e => setLine(l, { counted: e.target.value })} className={`${inputCls} w-28`} data-testid="count-input" />
                    )}
                </td>
                {!(blind && count.status === 'OPEN') && (
                  <td className={`px-3 py-2 text-right font-medium ${l.difference === null ? 'text-gray-300' : l.difference > 1e-9 ? 'text-green-700' : l.difference < -1e-9 ? 'text-red-700' : 'text-gray-400'}`}>
                    {l.difference === null ? '—' : `${l.difference > 0 ? '+' : ''}${fmtQty(l.difference)}`}
                    {l.movement_number && <div className="font-mono text-xs font-normal text-gray-400">{l.movement_number}</div>}
                  </td>
                )}
                <td className="px-3 py-2">
                  {editable
                    ? <input value={draft[l.id]?.note ?? (l.note || '')} onChange={e => setLine(l, { note: e.target.value })} maxLength={1000} className={`${inputCls} min-w-[10rem]`} aria-label={t('stock.count.note')} />
                    : <span className="text-xs text-gray-600">{l.note || ''}</span>}
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-gray-500">{t('stock.count.noLines')}</td></tr>}
          </tbody>
        </table>
      </div>

      {count.status === 'OPEN' && (
        <div className="flex flex-wrap gap-2">
          {hasPermission('ADJUST_STOCK') && (
            <button onClick={() => setDialog('validate')} disabled={dirty > 0}
              title={dirty ? t('stock.count.saveFirst') : undefined}
              className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50" data-testid="count-validate">
              <CheckCircle2 size={16} /> {t('stock.count.validate')}
            </button>
          )}
          {hasPermission('COUNT_STOCK') && (
            <button onClick={() => { setDialog('cancel'); setReason(''); }} className="flex items-center gap-2 rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50">
              <Ban size={16} /> {t('stock.count.cancel')}
            </button>
          )}
          {!hasPermission('ADJUST_STOCK') && <p className="self-center text-xs text-gray-500">{t('stock.count.validationByAdmin')}</p>}
        </div>
      )}

      <Modal isOpen={!!dialog} onClose={() => !busy && setDialog(null)} isLoading={busy} onConfirm={confirm} size={dialog === 'add' ? 'md' : 'sm'}
        type={dialog === 'cancel' ? 'danger' : dialog === 'validate' ? 'success' : 'info'}
        title={dialog === 'validate' ? t('stock.count.validateTitle') : dialog === 'cancel' ? t('stock.count.cancelTitle') : t('stock.count.addFound')}
        confirmText={dialog === 'validate' ? t('stock.count.validate') : dialog === 'cancel' ? t('stock.count.cancel') : t('common.add')}>
        {dialog === 'validate' && (
          <div className="space-y-2 text-sm text-gray-700">
            <p>{t('stock.count.validateText', { count: withDiff.length })}</p>
            {withDiff.length > 0 && (
              <ul className="max-h-48 overflow-auto rounded border border-gray-200 text-xs">
                {withDiff.map(l => (
                  <li key={l.id} className="flex justify-between gap-2 px-2 py-1">
                    <span>{l.item_code} {l.serial_number || l.lot_number || ''}</span>
                    <span className={l.difference > 0 ? 'text-green-700' : 'text-red-700'}>{l.difference > 0 ? '+' : ''}{fmtQty(l.difference)} {l.unit}</span>
                  </li>
                ))}
              </ul>
            )}
            {counted < lines.length && <p className="text-red-700">{t('stock.count.err.NOT_COMPLETE', { count: lines.length - counted })}</p>}
          </div>
        )}
        {dialog === 'cancel' && (
          <div className="space-y-2 text-sm text-gray-700">
            <p>{t('stock.count.cancelText')}</p>
            <input value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} className={inputCls} placeholder={t('stock.issue.cancelReason')} />
          </div>
        )}
        {dialog === 'add' && (
          <div className="space-y-3 text-sm">
            <p className="text-gray-600">{t('stock.count.addFoundHint')}</p>
            <CatalogAutocomplete linked={found.item} onLink={(item) => setFound(f => ({ ...f, item, text: item ? item.name : '' }))}
              onTextChange={(text) => setFound(f => ({ ...f, text }))} placeholder={t('stock.issue.itemSearch')} className={inputCls} minChars={1}
              inputProps={{ value: found.text, readOnly: !!found.item }} />
            {found.item?.track_lots && (
              <div className="grid gap-3 sm:grid-cols-2">
                <input value={found.lotNumber} onChange={e => setFound(f => ({ ...f, lotNumber: e.target.value }))} placeholder={t('stock.lot')} className={inputCls} />
                {found.item?.track_expiry && <input type="date" value={found.expiryDate} onChange={e => setFound(f => ({ ...f, expiryDate: e.target.value }))} className={inputCls} aria-label={t('grn.expiryDate')} />}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <input type="number" min="0" step="any" value={found.quantity} onChange={e => setFound(f => ({ ...f, quantity: e.target.value }))} placeholder={t('stock.quantity')} className={inputCls} />
              <input value={found.note} onChange={e => setFound(f => ({ ...f, note: e.target.value }))} placeholder={t('stock.count.note')} className={inputCls} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
