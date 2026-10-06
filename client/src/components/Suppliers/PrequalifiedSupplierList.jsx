// src/components/Suppliers/PrequalifiedSupplierList.jsx
// Fournisseurs préqualifiés par mon entreprise : une ligne par fournisseur × catégorie, filtres et export Excel.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Download, Search, RefreshCw, Building2, User } from 'lucide-react';
import { supplierService } from '../../services/supplierService';
import { locationService, categoryService } from '../../services/referenceService';
import { SUPPLIER_TYPE_LABELS, downloadBlob } from '../../utils/supplierDocs';
import { t, getLocale, useTranslation } from '../../i18n';

const selectCls = 'px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white';

export default function PrequalifiedSupplierList() {
  const [filters, setFilters] = useState({ categoryId: '', locationId: '', supplierType: '', search: '' });
  const [search, setSearch] = useState('');
  const [refs, setRefs] = useState({ locations: [], categories: [] });
  const [exporting, setExporting] = useState(false);

  const { lang } = useTranslation();
  useEffect(() => {
    Promise.all([locationService.list(), categoryService.list()])
      .then(([l, c]) => setRefs({ locations: l.data || [], categories: c.data || [] }))
      .catch(() => {});
  }, [lang]);
  // Recherche appliquée après une courte pause de saisie
  useEffect(() => {
    const timer = setTimeout(() => setFilters(f => ({ ...f, search })), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  const { data, isLoading } = useQuery({
    queryKey: ['suppliers-prequalified', params],
    queryFn: () => supplierService.listPrequalified(params),
  });
  const rows = data?.data || [];
  const supplierCount = new Set(rows.map(r => r.id)).size;

  const exportExcel = async () => {
    setExporting(true);
    try {
      downloadBlob(await supplierService.exportPrequalified(params), `${t('prequal.exportFile')}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (_) { /* toast */ } finally {
      setExporting(false);
    }
  };

  const set = (k) => (e) => setFilters(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><BadgeCheck className="text-green-600" /> {t('prequal.listTitle')}</h1>
          <p className="text-sm text-gray-500">
            {t('prequal.listHint')}
          </p>
        </div>
        <button onClick={exportExcel} disabled={exporting || rows.length === 0}
          className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
          <Download size={16} /> {exporting ? t('prequal.exporting') : t('prequal.exportExcel')}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 bg-white border border-gray-200 rounded-lg p-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('prequal.searchPlaceholder')}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <select className={selectCls} value={filters.categoryId} onChange={set('categoryId')} aria-label={t('prequal.category')}>
          <option value="">{t('prequal.allCategories')}</option>
          {refs.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className={selectCls} value={filters.locationId} onChange={set('locationId')} aria-label={t('prequal.location')}>
          <option value="">{t('prequal.allLocations')}</option>
          {refs.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select className={selectCls} value={filters.supplierType} onChange={set('supplierType')} aria-label={t('prequal.type_')}>
          <option value="">{t('prequal.allTypes')}</option>
          <option value="COMPANY">{t('prequal.companies')}</option>
          <option value="INDIVIDUAL">{t('prequal.individuals')}</option>
        </select>
      </div>

      <p className="text-sm text-gray-600">{t('prequal.counts', { suppliers: supplierCount, rows: rows.length })}</p>

      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        {isLoading ? (
          <div className="flex justify-center p-8"><RefreshCw className="animate-spin text-blue-500" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-left">
              <tr>
                {t('prequal.cols', { returnObjects: true }).map(h => <th key={h} className="px-4 py-2">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(r => (
                <tr key={`${r.id}-${r.category_id}`} className="hover:bg-gray-50">
                  <td className="px-4 py-2">{r.category_name}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.supplier_code}</td>
                  <td className="px-4 py-2">
                    <Link to={`/suppliers/${r.id}`} className="font-medium text-blue-700 hover:underline">{r.name}</Link>
                    <span className="ml-2 inline-flex items-center gap-1 text-xs text-gray-500">
                      {r.supplier_type === 'INDIVIDUAL' ? <User size={12} /> : <Building2 size={12} />}
                      {SUPPLIER_TYPE_LABELS[r.supplier_type]}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-600">{(r.location_names || []).join(', ') || '—'}</td>
                  <td className="px-4 py-2 text-gray-600">
                    <div>{r.contact_name || '—'}</div>
                    <div className="text-xs">{[r.phone, r.email].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="px-4 py-2 text-gray-600">{r.decided_at ? new Date(r.decided_at).toLocaleDateString(getLocale()) : ''}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">{t('prequal.none')}</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
