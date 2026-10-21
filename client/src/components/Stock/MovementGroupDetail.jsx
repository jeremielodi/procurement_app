// src/components/Stock/MovementGroupDetail.jsx
// Fiche d'une opération de stock (groupe de mouvements écrits d'un seul coup, migration 36) :
// en-tête, tous ses mouvements (un par article × lot, un par équipement avec n° de série / n° d'inventaire), export Excel.
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Layers, RefreshCw } from 'lucide-react';
import { stockService } from '../../services/stockService';
import { t, getLocale } from '../../i18n';
import { MovementTable, SourceDocument, downloadGroup, groupLabel } from './StockMovements';

const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);

export default function MovementGroupDetail() {
  const { id } = useParams();
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    stockService.movementGroup(id)
      .then(r => setGroup(r.data))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  const download = async () => {
    setDownloading(true);
    try { await downloadGroup(group); } catch { /* toast api */ } finally { setDownloading(false); }
  };

  if (loading) return <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>;
  if (notFound || !group) {
    return (
      <div className="p-6 space-y-3">
        <Link to="/stock/movements" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"><ArrowLeft size={14} /> {t('stock.mv.title')}</Link>
        <p className="text-gray-500">{t('stock.mvGroup.notFound')}</p>
      </div>
    );
  }

  const fields = [
    [t('stock.mv.date'), new Date(group.created_at).toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'short' })],
    [t('stock.mvGroup.operation'), <>{groupLabel(group)} <span className="text-sm"><SourceDocument m={group} /></span></>],
    [t('stock.mv.by'), group.performed_by_name || '—'],
    [t('stock.warehouse'), group.warehouses || '—'],
    [t('stock.mvGroup.content'), <>
      {t('stock.mvGroup.contentText', { items: group.item_count, movements: group.movement_count })}
      {group.unit_count > 0 && <span className="text-indigo-700"> · {t('stock.mvGroup.units', { count: group.unit_count })}</span>}
    </>],
    [t('stock.mvGroup.quantities'), <>
      {group.quantity_in > 0 && <span className="text-green-700">{t('stock.mvGroup.in')} : +{fmtQty(group.quantity_in)}</span>}
      {group.quantity_in > 0 && group.quantity_out > 0 && ' · '}
      {group.quantity_out > 0 && <span className="text-red-600">{t('stock.mvGroup.out')} : −{fmtQty(group.quantity_out)}</span>}
    </>],
  ];

  return (
    <div className="p-6 space-y-5">
      <Link to="/stock/movements" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"><ArrowLeft size={14} /> {t('stock.mv.title')}</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <Layers /> <span className="font-mono" data-testid="movement-group-number">{group.group_number}</span>
          </h1>
          <p className="text-sm text-gray-500">{t('stock.mvGroup.detailSubtitle')}</p>
        </div>
        <button type="button" onClick={download} disabled={downloading} data-testid="movement-group-export"
          className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {downloading ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />} {t('stock.mvGroup.download')}
        </button>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-gray-500">{label}</dt>
            <dd className="text-sm text-gray-900">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <MovementTable rows={group.movements || []} showGroup={false} />
      </div>
    </div>
  );
}
