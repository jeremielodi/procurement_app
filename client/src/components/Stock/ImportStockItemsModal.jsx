// src/components/Stock/ImportStockItemsModal.jsx
// Import du catalogue d'articles depuis un fichier Excel (.xlsx) ou CSV, avec stock initial facultatif :
// modèle à télécharger (xlsx avec listes et mode d'emploi, ou csv) → fichier → aperçu (rien n'est écrit) → confirmation.
// Le même fichier est renvoyé à la confirmation : le serveur le revalide avant d'écrire.
import React, { useState } from 'react';
import { Upload, FileSpreadsheet, Download, AlertTriangle, CheckCircle, PackagePlus, Pencil, Minus } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import { stockItemService } from '../../services/stockService';
import { t, getLocale } from '../../i18n';

const ITEM_COLUMNS = ['code', 'name', 'unit', 'category', 'description', 'stockable', 'trackLots', 'trackExpiry', 'trackSerials', 'minQuantity', 'reorderQuantity'];
const OPENING_COLUMNS = ['warehouse', 'openingQuantity', 'unitCost', 'currency', 'lotNumber', 'expiryDate'];
const REQUIRED = ['code', 'name', 'unit'];
// Champs SQL modifiés → colonne du modèle
const FIELD_COLUMN = {
  name: 'name', unit: 'unit', description: 'description', category_id: 'category', is_stockable: 'stockable', track_lots: 'trackLots',
  track_expiry: 'trackExpiry', track_serials: 'trackSerials', min_quantity: 'minQuantity', reorder_quantity: 'reorderQuantity',
};
const ACTION_STYLE = {
  CREATE: 'bg-green-100 text-green-800', UPDATE: 'bg-blue-100 text-blue-800', UNCHANGED: 'bg-gray-100 text-gray-600',
};

const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);
const column = (key) => t(`stock.import.columns.${key}`);

/** Message d'une ligne en erreur (code + paramètres renvoyés par le serveur) */
const lineMessage = ({ code, params = {} }) =>
  t(`stock.import.err.${code}`, { ...params, column: params.column ? column(params.column) : '' });

/** Erreur globale (fichier) : message traduit d'après le code, sinon celui du serveur */
const fileError = (error) => {
  const body = error.response?.data || {};
  if (body.code && ['UNREADABLE', 'EMPTY', 'MISSING_COLUMNS', 'TOO_MANY_ROWS', 'NOTHING_TO_IMPORT', 'NO_FILE'].includes(body.code)) {
    return t(`stock.import.fileErr.${body.code}`, body.details || {});
  }
  return body.message || t('stock.import.failed');
};

async function downloadTemplate(format) {
  try {
    const blob = await stockItemService.importTemplate(format);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${t('stock.import.templateFile')}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { toast.error(t('stock.import.templateFailed')); }
}

export default function ImportStockItemsModal({ isOpen, onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null); // { items, openings, errors, summary }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('items');

  const reset = () => { setFile(null); setPreview(null); setError(null); setTab('items'); };
  const close = () => { if (loading) return; reset(); onClose(); };

  const analyze = async (f) => {
    reset();
    if (!f) return;
    setFile(f);
    setLoading(true);
    try {
      const res = await stockItemService.importFile(f);
      setPreview(res.data);
      if (!res.data.items.length && res.data.openings.length) setTab('openings');
    } catch (e) {
      setError(fileError(e));
      setFile(null);
    } finally {
      setLoading(false);
    }
  };

  const toImport = preview ? preview.summary.create + preview.summary.update + preview.summary.openings : 0;

  const confirm = async () => {
    if (!file || !toImport) return;
    setLoading(true);
    try {
      const res = await stockItemService.importFile(file, { confirm: true });
      const r = res.data;
      toast.success(t('stock.import.done', { created: r.created, updated: r.updated, openings: r.openings }), { duration: 6000 });
      if (r.skipped) toast(t('stock.import.doneSkipped', { count: r.skipped }), { icon: '⚠️', duration: 6000 });
      reset();
      onImported?.();
      onClose();
    } catch (e) {
      setError(fileError(e));
    } finally {
      setLoading(false);
    }
  };

  const s = preview?.summary;
  const tracking = (i) => (!i.stockable ? t('stock.notStockable')
    : i.trackSerials ? t('stock.items.serials')
    : i.trackExpiry ? t('stock.items.lotsExpiry') : i.trackLots ? t('stock.items.lots') : t('stock.items.quantityOnly'));

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={t('stock.import.title')}
      size="xl"
      onConfirm={confirm}
      confirmText={toImport ? t('stock.import.confirmN', { count: toImport }) : t('stock.import.confirm')}
      confirmDisabled={!toImport}
      isLoading={loading}
      loadingText={preview ? t('stock.import.importing') : t('stock.import.analyzing')}
    >
      <div className="space-y-4">
        {/* Modèle */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 p-3">
          <div className="text-sm text-green-900">
            <div className="font-medium">{t('stock.import.templateTitle')}</div>
            <div className="text-xs text-green-800">{t('stock.import.templateHint')}</div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => downloadTemplate('xlsx')} data-testid="stock-import-template-xlsx"
              className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700">
              <Download size={16} /> {t('stock.import.templateXlsx')}
            </button>
            <button type="button" onClick={() => downloadTemplate('csv')} data-testid="stock-import-template-csv"
              className="inline-flex items-center gap-2 rounded-lg border border-green-600 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100">
              <Download size={16} /> {t('stock.import.templateCsv')}
            </button>
          </div>
        </div>

        {/* Colonnes attendues */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 space-y-1.5">
          <div>
            <span className="font-semibold text-gray-700">{t('stock.import.itemColumns')} </span>
            {ITEM_COLUMNS.map((k, i) => (
              <span key={k}>{i > 0 && ', '}<span className={REQUIRED.includes(k) ? 'font-semibold text-gray-800' : ''}>{column(k)}{REQUIRED.includes(k) && ' *'}</span></span>
            ))}
          </div>
          <div>
            <span className="font-semibold text-gray-700">{t('stock.import.openingColumns')} </span>
            {OPENING_COLUMNS.map(column).join(', ')}
          </div>
          <p>{t('stock.import.rules')}</p>
        </div>

        {/* Fichier */}
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-blue-300 px-4 py-4 text-sm text-blue-700 hover:bg-blue-50">
          <Upload size={18} />
          {file ? file.name : t('stock.import.chooseFile')}
          <input type="file" accept=".xlsx,.csv" className="hidden" data-testid="stock-import-file"
            onChange={(e) => { analyze(e.target.files?.[0] || null); e.target.value = ''; }} />
        </label>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        {preview && (
          <>
            <div className="flex flex-wrap gap-2 text-xs" data-testid="stock-import-summary">
              <span className="rounded-full bg-green-100 px-3 py-1 font-medium text-green-800">{t('stock.import.sumCreate', { count: s.create })}</span>
              <span className="rounded-full bg-blue-100 px-3 py-1 font-medium text-blue-800">{t('stock.import.sumUpdate', { count: s.update })}</span>
              {s.unchanged > 0 && <span className="rounded-full bg-gray-100 px-3 py-1 font-medium text-gray-700">{t('stock.import.sumUnchanged', { count: s.unchanged })}</span>}
              <span className="rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-800">{t('stock.import.sumOpenings', { count: s.openings })}</span>
              {s.errors > 0 && <span className="rounded-full bg-red-100 px-3 py-1 font-medium text-red-800">{t('stock.import.sumErrors', { count: s.errors })}</span>}
            </div>

            {preview.errors.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <div className="mb-1 flex items-center gap-2 font-medium">
                  <AlertTriangle size={16} /> {t('stock.import.errorsTitle', { count: preview.errors.length })}
                </div>
                <ul className="max-h-32 list-disc overflow-y-auto pl-6" data-testid="stock-import-errors">
                  {preview.errors.map((e, i) => <li key={`${e.line}-${i}`}>{t('stock.import.lineError', { line: e.line, message: lineMessage(e) })}</li>)}
                </ul>
              </div>
            )}

            {toImport > 0 ? (
              <>
                <div className="flex items-center gap-2 text-sm text-green-700">
                  <CheckCircle size={16} /> {t('stock.import.ready')}
                </div>
                <div className="flex gap-1 border-b border-gray-200 text-sm">
                  {[['items', t('stock.import.tabItems', { count: preview.items.length })], ['openings', t('stock.import.tabOpenings', { count: preview.openings.length })]].map(([k, label]) => (
                    <button key={k} type="button" onClick={() => setTab(k)}
                      className={`-mb-px border-b-2 px-3 py-2 ${tab === k ? 'border-blue-600 font-medium text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="max-h-72 overflow-auto rounded-lg border border-gray-200">
                  {tab === 'items' ? (
                    <table className="min-w-full text-sm" data-testid="stock-import-items">
                      <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
                        <tr>
                          <th className="px-2 py-2">{t('stock.import.line')}</th>
                          <th className="px-2 py-2">{t('stock.code')}</th>
                          <th className="px-2 py-2">{t('stock.item')}</th>
                          <th className="px-2 py-2">{t('stock.unit')}</th>
                          <th className="px-2 py-2">{t('stock.items.tracking')}</th>
                          <th className="px-2 py-2">{t('stock.import.action')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {preview.items.map(i => (
                          <tr key={i.code}>
                            <td className="px-2 py-1 text-gray-400">{i.line}</td>
                            <td className="px-2 py-1 font-mono text-xs font-semibold">{i.code}</td>
                            <td className="px-2 py-1">{i.name}{i.category && <span className="block text-xs text-gray-500">{i.category.name}</span>}</td>
                            <td className="px-2 py-1">{i.unit}</td>
                            <td className="px-2 py-1 text-xs">{tracking(i)}</td>
                            <td className="px-2 py-1">
                              <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${ACTION_STYLE[i.action]}`}>
                                {i.action === 'CREATE' ? <PackagePlus size={12} /> : i.action === 'UPDATE' ? <Pencil size={12} /> : <Minus size={12} />}
                                {t(`stock.import.actions.${i.action}`)}
                              </span>
                              {i.action === 'UPDATE' && (
                                <span className="block text-xs text-gray-500">{i.changed.map(f => column(FIELD_COLUMN[f] || f)).join(', ')}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                        {preview.items.length === 0 && <tr><td colSpan={6} className="px-2 py-4 text-center text-gray-500">{t('stock.import.noItems')}</td></tr>}
                      </tbody>
                    </table>
                  ) : (
                    <table className="min-w-full text-sm" data-testid="stock-import-openings">
                      <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
                        <tr>
                          <th className="px-2 py-2">{t('stock.import.line')}</th>
                          <th className="px-2 py-2">{t('stock.item')}</th>
                          <th className="px-2 py-2">{column('warehouse')}</th>
                          <th className="px-2 py-2 text-right">{column('openingQuantity')}</th>
                          <th className="px-2 py-2 text-right">{column('unitCost')}</th>
                          <th className="px-2 py-2">{column('lotNumber')}</th>
                          <th className="px-2 py-2">{column('expiryDate')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {preview.openings.map(o => (
                          <tr key={o.line}>
                            <td className="px-2 py-1 text-gray-400">{o.line}</td>
                            <td className="px-2 py-1"><span className="mr-1 font-mono text-xs font-semibold">{o.code}</span>{o.name}</td>
                            <td className="px-2 py-1">{o.warehouse.code}<span className="block text-xs text-gray-500">{o.warehouse.name}</span></td>
                            <td className="px-2 py-1 text-right font-medium">{fmtQty(o.quantity)} {o.unit}</td>
                            <td className="px-2 py-1 text-right">{o.unitCost !== null ? `${fmtQty(o.unitCost)} ${o.currency || ''}` : '—'}</td>
                            <td className="px-2 py-1">{o.lotNumber || '—'}</td>
                            <td className="px-2 py-1">{o.expiryDate ? new Date(`${o.expiryDate}T00:00:00Z`).toLocaleDateString(getLocale(), { timeZone: 'UTC' }) : '—'}</td>
                          </tr>
                        ))}
                        {preview.openings.length === 0 && <tr><td colSpan={7} className="px-2 py-4 text-center text-gray-500">{t('stock.import.noOpenings')}</td></tr>}
                      </tbody>
                    </table>
                  )}
                </div>
                {preview.openings.length > 0 && <p className="text-xs text-amber-700">{t('stock.import.openingWarning')}</p>}
              </>
            ) : (
              <p className="flex items-center gap-2 text-sm text-gray-500"><FileSpreadsheet size={16} /> {t('stock.import.nothing')}</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
