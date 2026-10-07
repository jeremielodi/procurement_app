// src/components/Requisitions/ImportItemsModal.jsx
// Import des articles depuis un fichier Excel (.xlsx) ou CSV : fichier → aperçu → ajout au formulaire.
// Pas de ligne budgétaire dans le fichier : elle s'assigne ensuite dans le formulaire (sélection multiple).
import React, { useState } from 'react';
import { Upload, FileSpreadsheet, Download, AlertTriangle, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import requisitionService from '../../services/requisitionService';
import { t } from '../../i18n';

// Modèle généré dans le navigateur : CSV « ; » + BOM UTF-8 → s'ouvre directement dans Excel (accents corrects)
// En-têtes dans la langue de l'interface (le backend accepte les noms FR et EN)
const templateRows = () => [
  t('importItems.templateHeaders', { returnObjects: true }),
  ...t('importItems.templateRows', { returnObjects: true }),
];

function downloadTemplate() {
  const csv = templateRows()
    .map(row => row.map(v => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(';'))
    .join('\r\n');
  const blob = new Blob(['﻿' + csv + '\r\n'], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = t('importItems.templateFile');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ImportItemsModal({ isOpen, onClose, onImport, formatCurrency }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null); // { items, errors }
  const [loading, setLoading] = useState(false);
  const [replace, setReplace] = useState(false);

  const reset = () => { setFile(null); setPreview(null); setReplace(false); };
  const close = () => { reset(); onClose(); };

  const analyze = async (f) => {
    setFile(f);
    setPreview(null);
    if (!f) return;
    setLoading(true);
    try {
      const res = await requisitionService.importItems(f);
      setPreview(res.data);
    } catch (_) {
      // toast via intercepteur
      setFile(null);
    } finally {
      setLoading(false);
    }
  };

  const confirm = () => {
    if (!preview?.items.length) return;
    onImport(preview.items.map(i => ({
      description: i.description,
      quantity: i.quantity,
      frequency: i.frequency,
      unitPrice: i.unitPrice,
      budgetLineId: '',
      budgetLineInfo: null,
      // Colonne « Code article » reconnue : ligne liée à l'article du catalogue
      stockItem: i.stockItemId ? { id: i.stockItemId, code: i.itemCode, name: i.itemName, unit: i.unit } : null,
    })), { replace });
    toast.success(t('importItems.imported', { count: preview.items.length }));
    close();
  };

  const total = (preview?.items || []).reduce((s, i) => s + i.quantity * i.frequency * i.unitPrice, 0);

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={t('importItems.title')}
      size="xl"
      onConfirm={confirm}
      confirmText={preview?.items.length ? t('importItems.addN', { count: preview.items.length }) : t('importItems.add')}
      confirmDisabled={!preview?.items.length}
      isLoading={loading}
      loadingText={t('importItems.analyzing')}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 px-4 py-2 border-2 border-dashed border-blue-300 rounded-lg text-sm text-blue-700 cursor-pointer hover:bg-blue-50">
            <Upload size={16} />
            {file ? file.name : t('importItems.chooseFile')}
            <input
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              data-testid="import-file"
              onChange={(e) => { analyze(e.target.files?.[0] || null); e.target.value = ''; }}
            />
          </label>
          <button type="button" onClick={downloadTemplate}
            className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium">
            <Download size={16} /> {t('importItems.downloadTemplate')}
          </button>
        </div>

        <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-600">
          <div className="font-medium text-gray-700 mb-1">{t('importItems.expected')}</div>
          <table className="w-full">
            <tbody>
              {t('importItems.templateHeaders', { returnObjects: true }).map((h, i) => (
                <tr key={h}>
                  <td className="pr-3 font-semibold">{h}</td>
                  <td className="pr-3">{t(i === 2 ? 'importItems.optional' : 'importItems.required')}</td>
                  <td>{t(['importItems.descHint', 'importItems.qtyHint', 'importItems.freqHint', 'importItems.priceHint'][i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2">{t('importItems.saveAs')} <b>.xlsx</b> {t('importItems.or')} <b>.csv</b>. {t('importItems.afterImport')}</p>
        </div>

        {preview && (
          <>
            {preview.errors.length > 0 && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                <div className="flex items-center gap-2 font-medium mb-1">
                  <AlertTriangle size={16} /> {t('importItems.ignored', { count: preview.errors.length })}
                </div>
                <ul className="list-disc pl-6 max-h-24 overflow-y-auto">
                  {preview.errors.map(e => <li key={e.line}>{t('importItems.lineError', { line: e.line, message: e.message })}</li>)}
                </ul>
              </div>
            )}

            {preview.items.length > 0 ? (
              <>
                <div className="flex items-center gap-2 text-sm text-green-700">
                  <CheckCircle size={16} /> {t('importItems.ready', { count: preview.items.length, total: formatCurrency(total) })}
                </div>
                <div className="max-h-72 overflow-y-auto border border-gray-200 rounded-lg">
                  <table className="min-w-full text-sm" data-testid="import-preview">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-2 text-left text-xs text-gray-500">{t('importItems.line')}</th>
                        <th className="px-2 py-2 text-left text-xs text-gray-500">{t('common.description')}</th>
                        <th className="px-2 py-2 text-right text-xs text-gray-500">{t('importItems.qty')}</th>
                        <th className="px-2 py-2 text-right text-xs text-gray-500">{t('importItems.freq')}</th>
                        <th className="px-2 py-2 text-right text-xs text-gray-500">{t('importItems.unitPrice')}</th>
                        <th className="px-2 py-2 text-right text-xs text-gray-500">{t('common.total')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {preview.items.map(i => (
                        <tr key={i.line}>
                          <td className="px-2 py-1 text-gray-400">{i.line}</td>
                          <td className="px-2 py-1">{i.itemCode && <span className="mr-1 rounded bg-indigo-50 px-1 text-xs font-semibold text-indigo-700">{i.itemCode}</span>}{i.description}</td>
                          <td className="px-2 py-1 text-right">{i.quantity}</td>
                          <td className="px-2 py-1 text-right">{i.frequency}</td>
                          <td className="px-2 py-1 text-right">{formatCurrency(i.unitPrice)}</td>
                          <td className="px-2 py-1 text-right">{formatCurrency(i.quantity * i.frequency * i.unitPrice)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />
                  {t('importItems.replace')}
                </label>
              </>
            ) : (
              <p className="text-sm text-gray-500 flex items-center gap-2"><FileSpreadsheet size={16} /> {t('importItems.noValid')}</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
