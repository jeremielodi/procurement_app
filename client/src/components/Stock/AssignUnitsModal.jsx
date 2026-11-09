// src/components/Stock/AssignUnitsModal.jsx
// Import des affectations existantes (registre des biens) : Code article + N° de série (ou N° d'inventaire) + Email du
// détenteur. Aperçu → confirmation : un bon de sortie par dépôt × détenteur (une seule opération), détenteurs notifiés.
// Modèle pré-rempli avec les équipements en stock et le détenteur relevé dans leurs notes.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, AlertTriangle, CheckCircle, Download, UserCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import { equipmentService } from '../../services/stockService';
import { t } from '../../i18n';

const FILE_ERRORS = ['UNREADABLE', 'EMPTY', 'MISSING_COLUMNS', 'TOO_MANY_ROWS', 'NOTHING_TO_IMPORT', 'NO_FILE'];
const fileError = (error) => {
  const body = error.response?.data || {};
  if (FILE_ERRORS.includes(body.code)) return t(`stock.assignImport.fileErr.${body.code}`, body.details || {});
  return body.message || t('stock.assignImport.failed');
};
const lineMessage = ({ code, params = {} }) => t(`stock.assignImport.err.${code}`, params);

async function downloadTemplate(format) {
  try {
    const blob = await equipmentService.assignmentTemplate(format);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${t('stock.assignImport.templateFile')}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { toast.error(t('stock.retag.templateFailed')); }
}

export default function AssignUnitsModal({ isOpen, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const reset = () => { setFile(null); setPreview(null); setResult(null); setError(null); };
  const close = () => { if (loading) return; reset(); onClose(); };

  const analyze = async (f) => {
    reset();
    if (!f) return;
    setFile(f);
    setLoading(true);
    try {
      setPreview((await equipmentService.importAssignments(f)).data);
    } catch (e) {
      setError(fileError(e));
      setFile(null);
    } finally { setLoading(false); }
  };

  const confirm = async () => {
    if (result) { close(); return; }
    if (!file || !preview?.summary.units) return;
    setLoading(true);
    try {
      const r = (await equipmentService.importAssignments(file, { confirm: true })).data;
      setResult(r);
      setPreview(null);
      toast.success(t('stock.assignImport.done', { count: r.units }), { duration: 6000 });
      onDone?.();
    } catch (e) {
      setError(fileError(e));
    } finally { setLoading(false); }
  };

  const s = preview?.summary;
  return (
    <Modal isOpen={isOpen} onClose={close} title={t('stock.assignImport.title')} size="xl" onConfirm={confirm} isLoading={loading}
      confirmText={result ? t('common.close') : s?.units ? t('stock.assignImport.confirmN', { count: s.units }) : t('stock.assignImport.confirm')}
      confirmDisabled={!result && !s?.units} loadingText={preview ? t('stock.assignImport.working') : t('stock.unitImport.analyzing')}>
      <div className="space-y-4">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 space-y-1">
          <p className="flex items-center gap-2 font-medium text-gray-800"><UserCheck size={14} /> {t('stock.assignImport.format')}</p>
          <p>{t('stock.assignImport.hint')}</p>
        </div>

        {!result && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 p-3">
            <div className="min-w-0 flex-1 text-sm text-green-900">
              <div className="font-medium">{t('stock.retag.templateTitle')}</div>
              <div className="text-xs text-green-800">{t('stock.assignImport.templateHint')}</div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => downloadTemplate('xlsx')} data-testid="assign-template-xlsx"
                className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700">
                <Download size={16} /> {t('stock.import.templateXlsx')}
              </button>
              <button type="button" onClick={() => downloadTemplate('csv')}
                className="inline-flex items-center gap-2 rounded-lg border border-green-600 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100">
                <Download size={16} /> {t('stock.import.templateCsv')}
              </button>
            </div>
          </div>
        )}

        {!result && (
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-blue-300 px-4 py-4 text-sm text-blue-700 hover:bg-blue-50">
            <Upload size={18} />
            {file ? file.name : t('stock.import.chooseFile')}
            <input type="file" accept=".xlsx,.csv" className="hidden" data-testid="assign-file"
              onChange={(e) => { analyze(e.target.files?.[0] || null); e.target.value = ''; }} />
          </label>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        {preview && (
          <>
            <div className="flex flex-wrap gap-2 text-xs" data-testid="assign-summary">
              <span className="rounded-full bg-green-100 px-3 py-1 font-medium text-green-800">{t('stock.assignImport.sumUnits', { count: s.units })}</span>
              <span className="rounded-full bg-blue-100 px-3 py-1 font-medium text-blue-800">{t('stock.assignImport.sumHolders', { count: s.holders })}</span>
              <span className="rounded-full bg-blue-100 px-3 py-1 font-medium text-blue-800">{t('stock.assignImport.sumIssues', { count: s.issues })}</span>
              {s.skipped > 0 && <span className="rounded-full bg-gray-100 px-3 py-1 font-medium text-gray-700">{t('stock.assignImport.sumSkipped', { count: s.skipped })}</span>}
              {s.errors > 0 && <span className="rounded-full bg-red-100 px-3 py-1 font-medium text-red-800">{t('stock.import.sumErrors', { count: s.errors })}</span>}
            </div>
            {preview.errors.length > 0 && (
              <ul className="max-h-32 list-disc overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-3 pl-8 text-sm text-red-700" data-testid="assign-errors">
                {preview.errors.map((e, i) => <li key={`${e.line}-${i}`}>{t('stock.import.lineError', { line: e.line, message: lineMessage(e) })}</li>)}
              </ul>
            )}
            {s.units > 0 && (
              <div className="max-h-72 overflow-auto rounded-lg border border-gray-200">
                <table className="min-w-full text-sm [&_th]:whitespace-nowrap">
                  <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
                    <tr><th className="px-2 py-2">{t('stock.import.line')}</th><th className="px-2 py-2">{t('stock.item')}</th><th className="px-2 py-2">{t('stock.retag.csv.serial')}</th><th className="px-2 py-2">{t('stock.warehouse')}</th><th className="px-2 py-2">{t('stock.assignImport.holder')}</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {preview.units.map(u => (
                      <tr key={u.line}>
                        <td className="px-2 py-1 text-gray-400">{u.line}</td>
                        <td className="px-2 py-1"><span className="mr-1 font-mono text-xs font-semibold">{u.code}</span>{u.name}
                          {u.condition === 'DAMAGED' && <span className="ml-1 rounded bg-amber-100 px-1.5 text-xs text-amber-800">{t('stock.assignImport.damaged')}</span>}</td>
                        <td className="px-2 py-1 font-mono text-xs whitespace-nowrap">{u.serial}<div className="text-gray-400">{u.assetTag}</div></td>
                        <td className="px-2 py-1 text-xs whitespace-nowrap">{u.warehouse}</td>
                        <td className="px-2 py-1 text-xs">{u.holderName}<div className="text-gray-400">{u.holderEmail}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {result && (
          <>
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              <CheckCircle size={16} /> {t('stock.assignImport.doneIssues', { count: result.issues.length, units: result.units })}
            </div>
            <div className="max-h-72 overflow-auto rounded-lg border border-gray-200">
              <table className="min-w-full text-sm [&_th]:whitespace-nowrap" data-testid="assign-result">
                <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
                  <tr><th className="px-2 py-2">{t('stock.assignImport.issue')}</th><th className="px-2 py-2">{t('stock.assignImport.holder')}</th><th className="px-2 py-2">{t('stock.warehouse')}</th><th className="px-2 py-2 text-right">{t('stock.assignImport.units')}</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {result.issues.map(i => (
                    <tr key={i.id}>
                      <td className="px-2 py-1 font-mono text-xs whitespace-nowrap"><Link to={`/stock/issues/${i.id}`} className="text-blue-600 hover:underline">{i.issueNumber}</Link></td>
                      <td className="px-2 py-1 text-xs">{i.holderName}<div className="text-gray-400">{i.holderEmail}</div></td>
                      <td className="px-2 py-1 text-xs whitespace-nowrap">{i.warehouse}</td>
                      <td className="px-2 py-1 text-right">{i.units}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
