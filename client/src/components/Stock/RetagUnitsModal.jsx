// src/components/Stock/RetagUnitsModal.jsx
// Recodification des n° d'inventaire (ORGANISATION-PROJET-CATÉGORIE-ANNÉE-NNN) depuis un fichier Excel / CSV :
// Code article + N° de série (+ date d'acquisition, segment projet du TAG). Aperçu → confirmation → correspondance
// ancien / nouveau n° à télécharger pour le marquage physique. Exige le préfixe d'organisation (« Mon entreprise »).
import React, { useState } from 'react';
import { Upload, AlertTriangle, CheckCircle, Download, Tag } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import { equipmentService } from '../../services/stockService';
import { t } from '../../i18n';

const FILE_ERRORS = ['UNREADABLE', 'EMPTY', 'MISSING_COLUMNS', 'TOO_MANY_ROWS', 'NOTHING_TO_IMPORT', 'NO_FILE', 'ASSET_TAG_ORG_REQUIRED'];
const fileError = (error) => {
  const body = error.response?.data || {};
  if (FILE_ERRORS.includes(body.code)) return t(`stock.retag.fileErr.${body.code}`, body.details || {});
  return body.message || t('stock.unitImport.failed');
};
const lineMessage = ({ code, params = {} }) => t(`stock.unitImport.err.${code}`, params);

/** Correspondance ancien / nouveau n° (CSV « ; » + BOM) pour l'impression des étiquettes */
function downloadChanges(changes) {
  const esc = (v) => { const s = String(v ?? ''); return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [[t('stock.retag.csv.item'), t('stock.retag.csv.name'), t('stock.retag.csv.serial'), t('stock.retag.csv.oldTag'), t('stock.retag.csv.newTag')],
    ...changes.map(c => [c.code, c.name, c.serial, c.oldTag || '', c.newTag])];
  const blob = new Blob([`﻿${rows.map(r => r.map(esc).join(';')).join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${t('stock.retag.csv.file')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function RetagUnitsModal({ isOpen, onClose, onDone }) {
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
      setPreview((await equipmentService.retagFile(f)).data);
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
      const r = (await equipmentService.retagFile(file, { confirm: true })).data;
      setResult(r);
      setPreview(null);
      toast.success(t('stock.retag.done', { count: r.units }), { duration: 6000 });
      onDone?.();
    } catch (e) {
      setError(fileError(e));
    } finally { setLoading(false); }
  };

  const s = preview?.summary;
  return (
    <Modal isOpen={isOpen} onClose={close} title={t('stock.retag.title')} size="xl" onConfirm={confirm} isLoading={loading}
      confirmText={result ? t('common.close') : s?.units ? t('stock.retag.confirmN', { count: s.units }) : t('stock.retag.confirm')}
      confirmDisabled={!result && !s?.units} loadingText={preview ? t('stock.retag.working') : t('stock.unitImport.analyzing')}>
      <div className="space-y-4">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 space-y-1">
          <p className="flex items-center gap-2 font-medium text-gray-800"><Tag size={14} /> {t('stock.retag.format')}</p>
          <p>{t('stock.retag.hint')}</p>
        </div>

        {!result && (
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-blue-300 px-4 py-4 text-sm text-blue-700 hover:bg-blue-50">
            <Upload size={18} />
            {file ? file.name : t('stock.import.chooseFile')}
            <input type="file" accept=".xlsx,.csv" className="hidden" data-testid="retag-file"
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
            <div className="flex flex-wrap gap-2 text-xs" data-testid="retag-summary">
              <span className="rounded-full bg-green-100 px-3 py-1 font-medium text-green-800">{t('stock.unitImport.sumUnits', { count: s.units })}</span>
              {s.errors > 0 && <span className="rounded-full bg-red-100 px-3 py-1 font-medium text-red-800">{t('stock.import.sumErrors', { count: s.errors })}</span>}
            </div>
            {preview.errors.length > 0 && (
              <ul className="max-h-32 list-disc overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-3 pl-8 text-sm text-red-700" data-testid="retag-errors">
                {preview.errors.map((e, i) => <li key={`${e.line}-${i}`}>{t('stock.import.lineError', { line: e.line, message: lineMessage(e) })}</li>)}
              </ul>
            )}
            {s.units > 0 && (
              <div className="max-h-72 overflow-auto rounded-lg border border-gray-200">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
                    <tr><th className="px-2 py-2">{t('stock.import.line')}</th><th className="px-2 py-2">{t('stock.item')}</th><th className="px-2 py-2">{t('stock.retag.csv.serial')}</th><th className="px-2 py-2">{t('stock.retag.csv.oldTag')}</th><th className="px-2 py-2">{t('stock.retag.newPattern')}</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {preview.units.map(u => (
                      <tr key={u.line}>
                        <td className="px-2 py-1 text-gray-400">{u.line}</td>
                        <td className="px-2 py-1"><span className="mr-1 font-mono text-xs font-semibold">{u.code}</span>{u.name}</td>
                        <td className="px-2 py-1 font-mono text-xs">{u.serial}</td>
                        <td className="px-2 py-1 font-mono text-xs text-gray-500">{u.oldTag || '—'}</td>
                        <td className="px-2 py-1 font-mono text-xs font-semibold">{u.pattern}</td>
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
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              <span className="flex items-center gap-2"><CheckCircle size={16} /> {t('stock.retag.done', { count: result.units })}</span>
              <button type="button" onClick={() => downloadChanges(result.changes)} data-testid="retag-download"
                className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700">
                <Download size={14} /> {t('stock.retag.download')}
              </button>
            </div>
            <div className="max-h-72 overflow-auto rounded-lg border border-gray-200">
              <table className="min-w-full text-sm" data-testid="retag-result">
                <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
                  <tr><th className="px-2 py-2">{t('stock.item')}</th><th className="px-2 py-2">{t('stock.retag.csv.serial')}</th><th className="px-2 py-2">{t('stock.retag.csv.oldTag')}</th><th className="px-2 py-2">{t('stock.retag.csv.newTag')}</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {result.changes.map(c => (
                    <tr key={c.line}>
                      <td className="px-2 py-1">{c.name}</td>
                      <td className="px-2 py-1 font-mono text-xs">{c.serial}</td>
                      <td className="px-2 py-1 font-mono text-xs text-gray-500">{c.oldTag || '—'}</td>
                      <td className="px-2 py-1 font-mono text-xs font-semibold">{c.newTag}</td>
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
