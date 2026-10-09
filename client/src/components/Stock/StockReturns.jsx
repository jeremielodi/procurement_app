// src/components/Stock/StockReturns.jsx
// Bons de retour : liste (/stock/returns) et fiche (/stock/returns/:id).
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Undo2, Plus, RefreshCw, Search, ArrowLeft, Eye } from 'lucide-react';
import BlobPdfViewer from '../Common/BlobPdfViewer';
import { stockReturnService } from '../../services/stockService';
import { usePermissions } from '../../hooks/usePermissions';
import { t, getLocale } from '../../i18n';

const inputCls = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const CONDITION_CLS = { GOOD: 'bg-green-100 text-green-800', DAMAGED: 'bg-amber-100 text-amber-800', LOST: 'bg-red-100 text-red-700' };

export function ConditionBadge({ condition }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs ${CONDITION_CLS[condition] || 'bg-gray-100'}`}>{t(`stock.return.conditions.${condition}`)}</span>;
}

export function StockReturnList() {
  const { hasPermission } = usePermissions();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => { const id = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(id); }, [search]);
  const load = async () => {
    setLoading(true);
    try { setRows((await stockReturnService.list({ search: debounced || undefined, limit: 100 })).data || []); } catch { /* toast api */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [debounced]);

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><Undo2 /> {t('stock.return.title')}</h1>
          <p className="text-sm text-gray-500">{t('stock.return.subtitle')}</p>
        </div>
        {hasPermission('ISSUE_STOCK') && (
          <Link to="/stock/returns/new" className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"><Plus size={16} /> {t('stock.return.new')}</Link>
        )}
      </div>
      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('stock.return.search')} className={`${inputCls} w-full pl-9`} />
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        {loading ? <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>
          : rows.length === 0 ? <div className="p-10 text-center text-gray-500">{t('stock.return.none')}</div>
          : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2">{t('stock.return.number')}</th>
                  <th className="px-4 py-2">{t('stock.mv.date')}</th>
                  <th className="px-4 py-2">{t('stock.return.holderType')}</th>
                  <th className="px-4 py-2">{t('stock.return.destination')}</th>
                  <th className="px-4 py-2">{t('stock.issue.items')}</th>
                  <th className="px-4 py-2">{t('stock.return.receivedBy')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className="px-4 py-2"><Link to={`/stock/returns/${r.id}`} className="font-mono font-semibold text-blue-600 hover:underline">{r.return_number}</Link></td>
                    <td className="whitespace-nowrap px-4 py-2">{new Date(r.received_at).toLocaleDateString(getLocale())}</td>
                    <td className="px-4 py-2">{r.department_name ? t('stock.equipment.departmentHolder', { name: r.department_name }) : r.returned_by_name}</td>
                    <td className="px-4 py-2">{r.warehouse_name}</td>
                    <td className="px-4 py-2">{t('stock.issue.lineCount', { count: r.line_count })}{r.lost_count > 0 && <span className="ml-2 text-xs text-red-600">{t('stock.return.lostCount', { count: r.lost_count })}</span>}</td>
                    <td className="px-4 py-2 text-gray-500">{r.received_by_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  );
}

export function StockReturnDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [ret, setRet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPdf, setShowPdf] = useState(false);
  useEffect(() => { stockReturnService.get(id).then(r => setRet(r.data)).catch(() => {}).finally(() => setLoading(false)); }, [id]);
  if (loading) return <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>;
  if (!ret) return <div className="p-6 text-gray-500">{t('stock.return.notFound')}</div>;
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft size={16} /> {t('common.back')}</button>
        <button onClick={() => setShowPdf(true)} className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50" data-testid="return-pdf"><Eye size={16} /> {t('stock.return.pdf')}</button>
      </div>
      {showPdf && <BlobPdfViewer title={ret.return_number} fileName={`${ret.return_number}.pdf`} fetchPdf={() => stockReturnService.pdf(ret.id)} onClose={() => setShowPdf(false)} />}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900"><Undo2 className="text-blue-600" /> {ret.return_number}</h1>
        <p className="mt-1 text-sm text-gray-500">{fmtDateTime(ret.received_at)} · {t('stock.return.receivedByLine', { name: ret.received_by_name || '—', warehouse: ret.warehouse_name })}</p>
        <p className="mt-2 text-sm"><span className="text-gray-500">{t('stock.return.holderType')} :</span> <b>{ret.department_name ? t('stock.equipment.departmentHolder', { name: ret.department_name }) : ret.returned_by_name}</b> <span className="text-gray-500">{ret.returned_by_email}</span></p>
        {ret.comment && <p className="mt-2 text-sm text-gray-700">{ret.comment}</p>}
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">{t('stock.item')}</th>
              <th className="px-4 py-2">{t('stock.return.issue')}</th>
              <th className="px-4 py-2 text-right">{t('stock.quantity')}</th>
              <th className="px-4 py-2">{t('stock.return.condition')}</th>
              <th className="px-4 py-2">{t('stock.issue.movements')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {ret.lines.map(l => (
              <tr key={l.id}>
                <td className="px-4 py-2"><span className="mr-1 font-mono font-semibold">{l.item_code}</span>{l.item_name}
                  {l.serial_number && <div className="font-mono text-xs text-indigo-700">{t('stock.equipment.serialLabel', { serial: l.serial_number })}</div>}
                </td>
                <td className="px-4 py-2"><Link to={`/stock/issues/${l.issue_id}`} className="text-blue-600 hover:underline">{l.issue_number}</Link></td>
                <td className="px-4 py-2 text-right">{fmtQty(l.quantity)} <span className="text-xs text-gray-400">{l.unit}</span></td>
                <td className="px-4 py-2"><ConditionBadge condition={l.condition} /></td>
                <td className="px-4 py-2 font-mono text-xs text-gray-500">{l.movement_number || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
