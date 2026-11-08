// src/components/Tenders/QuestionTemplateList.jsx
// Bibliothèque de questions de l'entreprise (/tenders/question-templates) : questions réutilisables, reprises
// (copiées) à la création d'un appel d'offres. Modifier une question ne change pas les AO déjà publiés.
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Library, Plus, Pencil, Trash2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import QuestionFields from './QuestionFields';
import { tenderService } from '../../services/tenderService';
import { emptyQuestion, toEditable, questionErrorMessage } from '../../utils/tenderQuestions';
import { t } from '../../i18n';

export default function QuestionTemplateList() {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);  // { id?, question, isActive }
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const res = await tenderService.getQuestionTemplates(true);
      setRows(res.data || []);
    } catch (_) { setRows([]); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true);
    try {
      const payload = { ...editing.question, isActive: editing.isActive };
      const res = editing.id
        ? await tenderService.updateQuestionTemplate(editing.id, payload)
        : await tenderService.createQuestionTemplate(payload);
      toast.success(res.message);
      setEditing(null);
      await load();
    } catch (error) {
      toast.error(questionErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await tenderService.deleteQuestionTemplate(toDelete.id);
      toast.success(res.message);
      setToDelete(null);
      await load();
    } catch (_) { /* toast via intercepteur */ } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/tenders')} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft size={20} /></button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Library size={22} /> {t('tenders.questions.libraryTitle')}</h1>
            <p className="text-gray-500 text-sm">{t('tenders.questions.libraryHint')}</p>
          </div>
        </div>
        <button onClick={() => setEditing({ question: emptyQuestion(), isActive: true })} data-testid="new-template"
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          <Plus size={16} /> {t('tenders.questions.newTemplate')}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {rows === null ? (
          <div className="flex justify-center p-8"><RefreshCw className="animate-spin text-blue-500" /></div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('tenders.questions.libraryEmpty')}</div>
        ) : (
          <table className="w-full text-sm" data-testid="templates-table">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-gray-600">{t('tenders.questions.label')}</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">{t('tenders.questions.type')}</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">{t('tenders.questions.optionsAndPoints')}</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">{t('tenders.questions.required')}</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">{t('tenders.questions.status')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => (
                <tr key={r.id} className={r.is_active ? '' : 'text-gray-400'}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.label}</div>
                    {r.help_text && <div className="text-xs text-gray-500">{r.help_text}</div>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{t(`tenders.questions.types.${r.answer_type}`)}</td>
                  <td className="px-3 py-2 text-xs">{r.answer_type === 'CHOICE' ? r.options.map(o => `${o.label} (${o.score} pt)`).join(' · ') : '—'}</td>
                  <td className="px-3 py-2">{r.required ? t('common.yes') : t('common.no')}</td>
                  <td className="px-3 py-2">{r.is_active ? t('tenders.questions.active') : t('tenders.questions.inactive')}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    <button onClick={() => setEditing({ id: r.id, question: toEditable(r), isActive: r.is_active })}
                      className="p-1.5 text-gray-500 hover:text-blue-600" title={t('common.edit')}><Pencil size={16} /></button>
                    <button onClick={() => setToDelete(r)} className="p-1.5 text-gray-500 hover:text-red-600" title={t('common.delete')}><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal isOpen={!!editing} onClose={() => setEditing(null)} size="lg" isLoading={busy} onConfirm={save}
        title={editing?.id ? t('tenders.questions.editTemplate') : t('tenders.questions.newTemplate')} confirmText={t('common.save')}>
        {editing && (
          <div className="space-y-3">
            <QuestionFields value={editing.question} onChange={(question) => setEditing(e => ({ ...e, question }))} />
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={editing.isActive} onChange={e => setEditing(x => ({ ...x, isActive: e.target.checked }))} />
              {t('tenders.questions.activeHint')}
            </label>
          </div>
        )}
      </Modal>

      <Modal isOpen={!!toDelete} onClose={() => setToDelete(null)} type="danger" isLoading={busy} onConfirm={remove}
        title={t('tenders.questions.deleteTitle')} confirmText={t('common.delete')}>
        <p className="text-sm text-gray-700">{t('tenders.questions.deleteHint', { label: toDelete?.label || '' })}</p>
      </Modal>
    </div>
  );
}
