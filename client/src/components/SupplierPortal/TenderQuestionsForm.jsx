// src/components/SupplierPortal/TenderQuestionsForm.jsx
// Réponses du fournisseur aux questions de l'acheteur, envoyées avec son offre.
// value : { [questionId]: { value, fileId, fileName } } ; un document est déposé dès qu'il est choisi.
import { useState } from 'react';
import { Paperclip, Upload, HelpCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import SearchSelect from '../Common/SearchSelect';
import { supplierPortalService } from '../../services/supplierPortalService';
import { questionErrorMessage } from '../../utils/tenderQuestions';
import { t } from '../../i18n';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50';

export default function TenderQuestionsForm({ tenderId, questions, value, onChange, disabled = false }) {
  const [uploading, setUploading] = useState(null);
  if (!questions?.length) return null;

  const set = (qid, patch) => onChange({ ...value, [qid]: { ...(value[qid] || {}), ...patch } });

  const upload = async (q, file) => {
    if (!file) return;
    setUploading(q.id);
    try {
      const res = await supplierPortalService.uploadAnswerFile(tenderId, q.id, file);
      set(q.id, { fileId: res.data.id, fileName: res.data.file_name });
    } catch (error) {
      toast.error(questionErrorMessage(error));
    } finally {
      setUploading(null);
    }
  };

  const openFile = async (fileId) => {
    try {
      const blob = await supplierPortalService.getMyAnswerFile(tenderId, fileId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (_) { /* toast via intercepteur */ }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4" data-testid="supplier-questions">
      <div>
        <h2 className="font-semibold text-gray-800 flex items-center gap-2"><HelpCircle size={18} /> {t('portal.questions.title')}</h2>
        <p className="text-xs text-gray-500">{t('portal.questions.hint')}</p>
      </div>
      {questions.map((q, idx) => {
        const a = value[q.id] || {};
        const id = `question-${q.id}`;
        return (
          <div key={q.id} className="space-y-1" data-testid="supplier-question">
            <label htmlFor={id} className="block text-sm font-medium text-gray-700">
              {idx + 1}. {q.label} {q.required ? <span className="text-red-600">*</span> : <span className="text-gray-400 font-normal">{t('portal.questions.optional')}</span>}
            </label>
            {q.help_text && <p className="text-xs text-gray-500">{q.help_text}</p>}

            {q.answer_type === 'TEXT' && (
              <textarea id={id} rows={2} maxLength={4000} disabled={disabled} className={inputCls}
                value={a.value ?? ''} onChange={e => set(q.id, { value: e.target.value })} />
            )}
            {q.answer_type === 'NUMBER' && (
              <input id={id} type="number" step="any" disabled={disabled} className={`${inputCls} max-w-xs`}
                value={a.value ?? ''} onChange={e => set(q.id, { value: e.target.value })} />
            )}
            {q.answer_type === 'YES_NO' && (
              <div className="flex gap-4 text-sm">
                {['YES', 'NO'].map(v => (
                  <label key={v} className="flex items-center gap-1.5">
                    <input type="radio" name={id} value={v} disabled={disabled} checked={a.value === v}
                      onChange={() => set(q.id, { value: v })} />
                    {v === 'YES' ? t('common.yes') : t('common.no')}
                  </label>
                ))}
              </div>
            )}
            {q.answer_type === 'CHOICE' && (
              <SearchSelect id={id} disabled={disabled} className={`${inputCls} max-w-md`}
                value={a.value ?? ''} onChange={e => set(q.id, { value: e.target.value })}>
                <option value="">{t('portal.questions.choose')}</option>
                {q.options.map((o, i) => <option key={i} value={String(i)}>{o.label}</option>)}
              </SearchSelect>
            )}
            {q.answer_type === 'FILE' && (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                {a.fileId && (
                  <button type="button" onClick={() => openFile(a.fileId)} className="text-blue-600 hover:underline inline-flex items-center gap-1">
                    <Paperclip size={14} /> {a.fileName}
                  </button>
                )}
                {!disabled && (
                  <label className="inline-flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                    <Upload size={14} />
                    {uploading === q.id ? t('portal.questions.uploading') : (a.fileId ? t('portal.questions.replaceFile') : t('portal.questions.chooseFile'))}
                    <input id={id} type="file" className="hidden" disabled={uploading === q.id}
                      accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                      onChange={e => { upload(q, e.target.files?.[0]); e.target.value = ''; }} />
                  </label>
                )}
                <span className="text-xs text-gray-500">{t('portal.questions.fileFormats')}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
