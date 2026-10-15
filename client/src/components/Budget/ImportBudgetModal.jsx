// src/components/Budget/ImportBudgetModal.jsx
// Import du registre budgétaire depuis un fichier Excel (.xlsx) ou CSV : modèle à télécharger (ou export du registre
// modifié) → fichier → aperçu (rien n'est écrit) → confirmation. Le même fichier est renvoyé à la confirmation : le
// serveur le revalide avant d'écrire (BudgetRegisterService).
import React, { useState } from 'react';
import { Upload, FileSpreadsheet, Download, AlertTriangle, CheckCircle, Plus, Pencil, Minus } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import { budgetService } from '../../services/budgetService';
import { useCurrency } from '../../contexts/EnterpriseContext';
import { downloadBlob } from '../../utils/supplierDocs';
import { t } from '../../i18n';

const COLUMNS = ['project', 'entityCode', 'description', 'loc', 'fundingSource', 'subProject', 'functionCode', 'allocated', 'active'];
const REQUIRED = ['entityCode', 'allocated'];
// Champs SQL modifiés → colonne du modèle
const FIELD_COLUMN = {
  description: 'description', loc: 'loc', funding_source: 'fundingSource', sub_project: 'subProject',
  function_code: 'functionCode', allocated_amount: 'allocated', is_active: 'active',
};
const ACTION_STYLE = { CREATE: 'bg-green-100 text-green-800', UPDATE: 'bg-blue-100 text-blue-800', UNCHANGED: 'bg-gray-100 text-gray-600' };
const FILE_ERRORS = ['UNREADABLE', 'EMPTY', 'MISSING_COLUMNS', 'TOO_MANY_ROWS', 'NOTHING_TO_IMPORT', 'NO_FILE', 'ALLOCATED_BELOW_UTILIZED'];

const column = (key) => t(`budget.import.columns.${key}`);
const lineMessage = ({ code, params = {} }) => t(`budget.import.err.${code}`, { ...params, column: params.column ? column(params.column) : '' });
const fileError = (error) => {
  const body = error.response?.data || {};
  if (body.code && FILE_ERRORS.includes(body.code)) return t(`budget.import.fileErr.${body.code}`, body.details || {});
  return body.message || t('budget.import.failed');
};

export default function ImportBudgetModal({ isOpen, onClose, onImported }) {
  const { formatAmount } = useCurrency();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null); // { lines, errors, summary }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const reset = () => { setFile(null); setPreview(null); setError(null); };
  const close = () => { if (loading) return; reset(); onClose(); };

  const downloadTemplate = async (format) => {
    try {
      downloadBlob(await budgetService.importTemplate(format), `${t('budget.import.templateFile')}.${format}`);
    } catch { toast.error(t('budget.import.templateFailed')); }
  };

  const analyze = async (f) => {
    reset();
    if (!f) return;
    setFile(f);
    setLoading(true);
    try {
      setPreview((await budgetService.importFile(f)).data);
    } catch (e) {
      setError(fileError(e));
      setFile(null);
    } finally {
      setLoading(false);
    }
  };

  const toImport = preview ? preview.summary.create + preview.summary.update : 0;

  const confirm = async () => {
    if (!file || !toImport) return;
    setLoading(true);
    try {
      const r = (await budgetService.importFile(file, { confirm: true })).data;
      toast.success(t('budget.import.done', { created: r.created, updated: r.updated }), { duration: 6000 });
      if (r.skipped) toast(t('budget.import.doneSkipped', { count: r.skipped }), { icon: '⚠️', duration: 6000 });
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
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={t('budget.import.title')}
      size="xl"
      onConfirm={confirm}
      confirmText={toImport ? t('budget.import.confirmN', { count: toImport }) : t('budget.import.confirm')}
      confirmDisabled={!toImport}
      isLoading={loading}
      loadingText={preview ? t('budget.import.importing') : t('budget.import.analyzing')}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 p-3">
          <div className="text-sm text-green-900">
            <div className="font-medium">{t('budget.import.templateTitle')}</div>
            <div className="text-xs text-green-800">{t('budget.import.templateHint')}</div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => downloadTemplate('xlsx')} data-testid="budget-import-template-xlsx"
              className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700">
              <Download size={16} /> {t('budget.import.templateXlsx')}
            </button>
            <button type="button" onClick={() => downloadTemplate('csv')} data-testid="budget-import-template-csv"
              className="inline-flex items-center gap-2 rounded-lg border border-green-600 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100">
              <Download size={16} /> {t('budget.import.templateCsv')}
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 space-y-1.5">
          <div>
            <span className="font-semibold text-gray-700">{t('budget.import.columnsTitle')} </span>
            {COLUMNS.map((k, i) => (
              <span key={k}>{i > 0 && ', '}<span className={REQUIRED.includes(k) ? 'font-semibold text-gray-800' : ''}>{column(k)}{REQUIRED.includes(k) && ' *'}</span></span>
            ))}
          </div>
          <p>{t('budget.import.rules')}</p>
        </div>

        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-blue-300 px-4 py-4 text-sm text-blue-700 hover:bg-blue-50">
          <Upload size={18} />
          {file ? file.name : t('budget.import.chooseFile')}
          <input type="file" accept=".xlsx,.csv" className="hidden" data-testid="budget-import-file"
            onChange={(e) => { analyze(e.target.files?.[0] || null); e.target.value = ''; }} />
        </label>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        {preview && (
          <>
            <div className="flex flex-wrap gap-2 text-xs" data-testid="budget-import-summary">
              <span className="rounded-full bg-green-100 px-3 py-1 font-medium text-green-800">{t('budget.import.sumCreate', { count: s.create })}</span>
              <span className="rounded-full bg-blue-100 px-3 py-1 font-medium text-blue-800">{t('budget.import.sumUpdate', { count: s.update })}</span>
              {s.unchanged > 0 && <span className="rounded-full bg-gray-100 px-3 py-1 font-medium text-gray-700">{t('budget.import.sumUnchanged', { count: s.unchanged })}</span>}
              {s.errors > 0 && <span className="rounded-full bg-red-100 px-3 py-1 font-medium text-red-800">{t('budget.import.sumErrors', { count: s.errors })}</span>}
              {toImport > 0 && (
                <span className="rounded-full bg-indigo-100 px-3 py-1 font-medium text-indigo-800">
                  {t('budget.import.sumAllocated', { amount: `${s.allocatedChange > 0 ? '+' : ''}${formatAmount(s.allocatedChange)}` })}
                </span>
              )}
            </div>

            {preview.errors.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <div className="mb-1 flex items-center gap-2 font-medium">
                  <AlertTriangle size={16} /> {t('budget.import.errorsTitle', { count: preview.errors.length })}
                </div>
                <ul className="max-h-32 list-disc overflow-y-auto pl-6" data-testid="budget-import-errors">
                  {preview.errors.map((e, i) => <li key={`${e.line}-${i}`}>{t('budget.import.lineError', { line: e.line, message: lineMessage(e) })}</li>)}
                </ul>
              </div>
            )}

            {toImport > 0 || s.unchanged > 0 ? (
              <>
                {toImport > 0 && (
                  <div className="flex items-center gap-2 text-sm text-green-700">
                    <CheckCircle size={16} /> {t('budget.import.ready')}
                  </div>
                )}
                <div className="max-h-72 overflow-auto rounded-lg border border-gray-200">
                  <table className="min-w-full text-sm" data-testid="budget-import-lines">
                    <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
                      <tr>
                        <th className="px-2 py-2">{t('budget.import.line')}</th>
                        <th className="px-2 py-2">{column('project')}</th>
                        <th className="px-2 py-2">{column('entityCode')}</th>
                        <th className="px-2 py-2">{column('description')}</th>
                        <th className="px-2 py-2 text-right">{column('allocated')}</th>
                        <th className="px-2 py-2">{t('budget.import.action')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {preview.lines.map(l => (
                        <tr key={`${l.project?.code || ''}|${l.entityCode}`}>
                          <td className="px-2 py-1 text-gray-400">{l.line}</td>
                          <td className="px-2 py-1" title={l.project?.name}>{l.project?.code || <span className="text-gray-400">—</span>}</td>
                          <td className="px-2 py-1 font-mono text-xs font-semibold">{l.entityCode}</td>
                          <td className="px-2 py-1">{l.description || '—'}{l.fundingSource && <span className="block text-xs text-gray-500">{l.fundingSource}</span>}</td>
                          <td className="px-2 py-1 text-right whitespace-nowrap">
                            {l.allocated !== null ? formatAmount(l.allocated) : '—'}
                            {l.action === 'UPDATE' && l.changed.includes('allocated_amount') && (
                              <span className="block text-xs text-gray-500">{t('budget.import.before', { amount: formatAmount(l.previousAllocated || 0) })}</span>
                            )}
                          </td>
                          <td className="px-2 py-1">
                            <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${ACTION_STYLE[l.action]}`}>
                              {l.action === 'CREATE' ? <Plus size={12} /> : l.action === 'UPDATE' ? <Pencil size={12} /> : <Minus size={12} />}
                              {t(`budget.import.actions.${l.action}`)}
                            </span>
                            {l.action === 'UPDATE' && (
                              <span className="block text-xs text-gray-500">{l.changed.map(f => column(FIELD_COLUMN[f] || f)).join(', ')}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="flex items-center gap-2 text-sm text-gray-500"><FileSpreadsheet size={16} /> {t('budget.import.nothing')}</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
