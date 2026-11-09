// src/components/Stock/ImportStockUnitsModal.jsx
// Import du parc existant (biens déjà achetés) depuis un fichier Excel (.xlsx) ou CSV : une ligne par bien —
// équipement à n° de série (n° de série, n° d'inventaire facultatif, état) ou quantité d'un article sans n° de série.
// Modèle à télécharger → fichier → aperçu (rien n'est écrit) → confirmation (le serveur revalide le même fichier).
import React, { useState } from 'react';
import { Upload, FileSpreadsheet, Download, AlertTriangle, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import { equipmentService } from '../../services/stockService';
import { t, getLocale } from '../../i18n';

const COLUMNS = ['item', 'serial', 'assetTag', 'warehouse', 'quantity', 'project', 'tagProject', 'acquisitionDate', 'condition', 'unitCost', 'currency', 'notes'];
const REQUIRED = ['item', 'warehouse'];
const FILE_ERRORS = ['UNREADABLE', 'EMPTY', 'MISSING_COLUMNS', 'TOO_MANY_ROWS', 'NOTHING_TO_IMPORT', 'NO_FILE'];

const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);
const column = (key) => t(`stock.unitImport.columns.${key}`);
const lineMessage = ({ code, params = {} }) => t(`stock.unitImport.err.${code}`, params);
const fileError = (error) => {
  const body = error.response?.data || {};
  if (FILE_ERRORS.includes(body.code)) return t(`stock.unitImport.fileErr.${body.code}`, body.details || {});
  return body.message || t('stock.unitImport.failed');
};

async function downloadTemplate(format) {
  try {
    const blob = await equipmentService.importTemplate(format);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${t('stock.unitImport.templateFile')}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { toast.error(t('stock.unitImport.templateFailed')); }
}

export default function ImportStockUnitsModal({ isOpen, onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null); // { units, openings, errors, summary }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('units');

  const reset = () => { setFile(null); setPreview(null); setError(null); setTab('units'); };
  const close = () => { if (loading) return; reset(); onClose(); };

  const analyze = async (f) => {
    reset();
    if (!f) return;
    setFile(f);
    setLoading(true);
    try {
      const res = await equipmentService.importFile(f);
      setPreview(res.data);
      if (!res.data.units.length && res.data.openings.length) setTab('openings');
    } catch (e) {
      setError(fileError(e));
      setFile(null);
    } finally {
      setLoading(false);
    }
  };

  const toImport = preview ? preview.summary.units + preview.summary.openings : 0;
  const confirm = async () => {
    if (!file || !toImport) return;
    setLoading(true);
    try {
      const r = (await equipmentService.importFile(file, { confirm: true })).data;
      toast.success(t('stock.unitImport.done', { units: r.units, quantity: fmtQty(r.openingQuantity), operation: r.groupNumber || '' }), { duration: 7000 });
      if (r.skipped) toast(t('stock.unitImport.doneSkipped', { count: r.skipped }), { icon: '⚠️', duration: 6000 });
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
  return (
    <Modal isOpen={isOpen} onClose={close} title={t('stock.unitImport.title')} size="xl" onConfirm={confirm}
      confirmText={toImport ? t('stock.unitImport.confirmN', { count: s.units + s.openingQuantity }) : t('stock.unitImport.confirm')}
      confirmDisabled={!toImport} isLoading={loading} loadingText={preview ? t('stock.unitImport.importing') : t('stock.unitImport.analyzing')}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 p-3">
          <div className="text-sm text-green-900">
            <div className="font-medium">{t('stock.unitImport.templateTitle')}</div>
            <div className="text-xs text-green-800">{t('stock.unitImport.templateHint')}</div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => downloadTemplate('xlsx')} data-testid="unit-import-template-xlsx"
              className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700">
              <Download size={16} /> {t('stock.import.templateXlsx')}
            </button>
            <button type="button" onClick={() => downloadTemplate('csv')}
              className="inline-flex items-center gap-2 rounded-lg border border-green-600 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100">
              <Download size={16} /> {t('stock.import.templateCsv')}
            </button>
          </div>
        </div>

        <div className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
          <div>
            <span className="font-semibold text-gray-700">{t('stock.unitImport.columnsLabel')} </span>
            {COLUMNS.map((k, i) => (
              <span key={k}>{i > 0 && ', '}<span className={REQUIRED.includes(k) ? 'font-semibold text-gray-800' : ''}>{column(k)}{REQUIRED.includes(k) && ' *'}</span></span>
            ))}
          </div>
          <p>{t('stock.unitImport.rules')}</p>
        </div>

        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-blue-300 px-4 py-4 text-sm text-blue-700 hover:bg-blue-50">
          <Upload size={18} />
          {file ? file.name : t('stock.import.chooseFile')}
          <input type="file" accept=".xlsx,.csv" className="hidden" data-testid="unit-import-file"
            onChange={(e) => { analyze(e.target.files?.[0] || null); e.target.value = ''; }} />
        </label>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        {preview && (
          <>
            <div className="flex flex-wrap gap-2 text-xs" data-testid="unit-import-summary">
              <span className="rounded-full bg-green-100 px-3 py-1 font-medium text-green-800">{t('stock.unitImport.sumUnits', { count: s.units })}</span>
              <span className="rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-800">{t('stock.unitImport.sumQuantity', { count: s.openings, quantity: fmtQty(s.openingQuantity) })}</span>
              {s.damaged > 0 && <span className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-800">{t('stock.unitImport.sumDamaged', { count: s.damaged })}</span>}
              {s.autoTags > 0 && <span className="rounded-full bg-gray-100 px-3 py-1 font-medium text-gray-700">{t('stock.unitImport.sumAutoTags', { count: s.autoTags })}</span>}
              {s.errors > 0 && <span className="rounded-full bg-red-100 px-3 py-1 font-medium text-red-800">{t('stock.import.sumErrors', { count: s.errors })}</span>}
            </div>

            {preview.errors.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <div className="mb-1 flex items-center gap-2 font-medium"><AlertTriangle size={16} /> {t('stock.import.errorsTitle', { count: preview.errors.length })}</div>
                <ul className="max-h-32 list-disc overflow-y-auto pl-6" data-testid="unit-import-errors">
                  {preview.errors.map((e, i) => <li key={`${e.line}-${i}`}>{t('stock.import.lineError', { line: e.line, message: lineMessage(e) })}</li>)}
                </ul>
              </div>
            )}

            {toImport > 0 ? (
              <>
                <div className="flex items-center gap-2 text-sm text-green-700"><CheckCircle size={16} /> {t('stock.unitImport.ready')}</div>
                <div className="flex gap-1 border-b border-gray-200 text-sm">
                  {[['units', t('stock.unitImport.tabUnits', { count: preview.units.length })], ['openings', t('stock.unitImport.tabQuantities', { count: preview.openings.length })]].map(([k, label]) => (
                    <button key={k} type="button" onClick={() => setTab(k)}
                      className={`-mb-px border-b-2 px-3 py-2 ${tab === k ? 'border-blue-600 font-medium text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{label}</button>
                  ))}
                </div>
                <div className="max-h-72 overflow-auto rounded-lg border border-gray-200">
                  {tab === 'units' ? (
                    <table className="min-w-full text-sm" data-testid="unit-import-units">
                      <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
                        <tr>
                          <th className="px-2 py-2">{t('stock.import.line')}</th>
                          <th className="px-2 py-2">{t('stock.item')}</th>
                          <th className="px-2 py-2">{column('serial')}</th>
                          <th className="px-2 py-2">{column('assetTag')}</th>
                          <th className="px-2 py-2">{column('warehouse')}</th>
                          <th className="px-2 py-2">{column('project')}</th>
                          <th className="px-2 py-2">{column('condition')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {preview.units.map(u => (
                          <tr key={u.line}>
                            <td className="px-2 py-1 text-gray-400">{u.line}</td>
                            <td className="px-2 py-1"><span className="mr-1 font-mono text-xs font-semibold">{u.code}</span>{u.name}</td>
                            <td className="px-2 py-1 font-mono text-xs">{u.serial}</td>
                            <td className="px-2 py-1 font-mono text-xs">{u.assetTag || <span className="font-sans text-gray-400">{t('stock.unitImport.autoTag')}</span>}</td>
                            <td className="px-2 py-1">{u.warehouse.code}</td>
                            <td className="px-2 py-1" title={u.project?.name}>{u.project?.code || '—'}</td>
                            <td className="px-2 py-1">{t(`stock.equipment.condition.${u.condition}`)}</td>
                          </tr>
                        ))}
                        {preview.units.length === 0 && <tr><td colSpan={7} className="px-2 py-4 text-center text-gray-500">{t('stock.unitImport.noUnits')}</td></tr>}
                      </tbody>
                    </table>
                  ) : (
                    <table className="min-w-full text-sm" data-testid="unit-import-openings">
                      <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
                        <tr>
                          <th className="px-2 py-2">{t('stock.unitImport.lines')}</th>
                          <th className="px-2 py-2">{t('stock.item')}</th>
                          <th className="px-2 py-2">{column('warehouse')}</th>
                          <th className="px-2 py-2 text-right">{column('quantity')}</th>
                          <th className="px-2 py-2 text-right">{column('unitCost')}</th>
                          <th className="px-2 py-2">{column('project')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {preview.openings.map(o => (
                          <tr key={o.lines.join('-')}>
                            <td className="px-2 py-1 text-xs text-gray-400">{o.lines.join(', ')}</td>
                            <td className="px-2 py-1"><span className="mr-1 font-mono text-xs font-semibold">{o.code}</span>{o.name}</td>
                            <td className="px-2 py-1">{o.warehouse.code}</td>
                            <td className="px-2 py-1 text-right font-medium">{fmtQty(o.quantity)} {o.unit}</td>
                            <td className="px-2 py-1 text-right">{o.unitCost !== null ? `${fmtQty(o.unitCost)} ${o.currency || ''}` : '—'}</td>
                            <td className="px-2 py-1" title={o.project?.name}>{o.project?.code || '—'}</td>
                          </tr>
                        ))}
                        {preview.openings.length === 0 && <tr><td colSpan={6} className="px-2 py-4 text-center text-gray-500">{t('stock.unitImport.noQuantities')}</td></tr>}
                      </tbody>
                    </table>
                  )}
                </div>
                <p className="text-xs text-amber-700">{t('stock.unitImport.warning')}</p>
              </>
            ) : (
              <p className="flex items-center gap-2 text-sm text-gray-500"><FileSpreadsheet size={16} /> {t('stock.unitImport.nothing')}</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
