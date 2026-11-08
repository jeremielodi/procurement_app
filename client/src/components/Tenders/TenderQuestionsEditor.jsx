// src/components/Tenders/TenderQuestionsEditor.jsx
// Questions posées aux fournisseurs dans un appel d'offres : ajout, reprise depuis la bibliothèque de l'entreprise
// (copie), ordre, enregistrement d'une question dans la bibliothèque. Figées dès la première offre (locked).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Library, ArrowUp, ArrowDown, Trash2, BookmarkPlus, HelpCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import QuestionFields from './QuestionFields';
import { tenderService } from '../../services/tenderService';
import { emptyQuestion, toEditable, questionErrorMessage, maxScore } from '../../utils/tenderQuestions';
import { t } from '../../i18n';

export default function TenderQuestionsEditor({ value, onChange, locked = false }) {
  const [library, setLibrary] = useState(null); // modèles proposés (fenêtre ouverte)
  const [picked, setPicked] = useState([]);

  const update = (i, q) => onChange(value.map((x, j) => (j === i ? q : x)));
  const move = (i, d) => {
    const next = [...value];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };

  const openLibrary = async () => {
    try {
      const res = await tenderService.getQuestionTemplates();
      setPicked([]);
      setLibrary(res.data || []);
    } catch (_) { /* toast via intercepteur */ }
  };

  const addFromLibrary = () => {
    const chosen = library.filter(tpl => picked.includes(tpl.id)).map(tpl => ({ ...toEditable(tpl), templateId: tpl.id }));
    onChange([...value, ...chosen]);
    setLibrary(null);
  };

  const saveToLibrary = async (q, i) => {
    try {
      const res = await tenderService.createQuestionTemplate(q);
      update(i, { ...q, templateId: res.data.id });
      toast.success(t('tenders.questions.savedToLibrary'));
    } catch (error) {
      toast.error(questionErrorMessage(error));
    }
  };

  const totalPoints = value.reduce((s, q) => s + maxScore(q), 0);

  return (
    <div className="space-y-3" data-testid="tender-questions">
      <div className="flex flex-wrap justify-between items-start gap-3">
        <div>
          <h2 className="font-semibold text-gray-800 flex items-center gap-2"><HelpCircle size={18} /> {t('tenders.questions.title')}</h2>
          <p className="text-xs text-gray-500">{t('tenders.questions.hint')}</p>
        </div>
        {!locked && (
          <div className="flex gap-2">
            <button type="button" onClick={openLibrary} data-testid="questions-from-library"
              className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
              <Library size={15} /> {t('tenders.questions.fromLibrary')}
            </button>
            <button type="button" onClick={() => onChange([...value, emptyQuestion()])} data-testid="add-question"
              className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm">
              <Plus size={15} /> {t('tenders.questions.add')}
            </button>
          </div>
        )}
      </div>
      {locked && <p className="text-xs text-amber-700" data-testid="questions-locked">{t('tenders.questions.locked')}</p>}

      {value.length === 0 && <p className="text-sm text-gray-400">{t('tenders.questions.none')}</p>}
      {value.map((q, i) => (
        <div key={i} className="border border-gray-200 rounded-lg p-3" data-testid="question-card">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-semibold text-gray-500 uppercase">
              {t('tenders.questions.number', { n: i + 1 })}
              {q.templateId && <span className="ml-2 normal-case font-normal text-blue-600">{t('tenders.questions.fromLibraryBadge')}</span>}
            </span>
            {!locked && (
              <div className="flex gap-1 text-gray-400">
                <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="p-1 hover:text-gray-700 disabled:opacity-30" title={t('tenders.questions.up')}><ArrowUp size={15} /></button>
                <button type="button" disabled={i === value.length - 1} onClick={() => move(i, 1)} className="p-1 hover:text-gray-700 disabled:opacity-30" title={t('tenders.questions.down')}><ArrowDown size={15} /></button>
                {!q.templateId && (
                  <button type="button" onClick={() => saveToLibrary(q, i)} className="p-1 hover:text-blue-600" title={t('tenders.questions.saveToLibrary')} data-testid="save-to-library"><BookmarkPlus size={15} /></button>
                )}
                <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="p-1 hover:text-red-600" title={t('common.delete')} data-testid="remove-question"><Trash2 size={15} /></button>
              </div>
            )}
          </div>
          <QuestionFields value={q} disabled={locked} onChange={(next) => update(i, next)} />
        </div>
      ))}
      {totalPoints > 0 && (
        <p className="text-xs text-gray-600" data-testid="questions-total-points">{t('tenders.questions.totalPoints', { points: totalPoints })}</p>
      )}

      <Modal isOpen={!!library} onClose={() => setLibrary(null)} title={t('tenders.questions.libraryTitle')} size="lg"
        onConfirm={addFromLibrary} confirmText={t('tenders.questions.addSelected', { count: picked.length })}>
        {library && (library.length === 0 ? (
          <p className="text-sm text-gray-500">
            {t('tenders.questions.libraryEmpty')}{' '}
            <Link to="/tenders/question-templates" className="text-blue-600 hover:underline">{t('tenders.questions.manageLibrary')}</Link>
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 border rounded-lg max-h-[60vh] overflow-y-auto" data-testid="library-list">
            {library.map(tpl => (
              <li key={tpl.id}>
                <label className="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" className="mt-1" checked={picked.includes(tpl.id)}
                    onChange={e => setPicked(p => (e.target.checked ? [...p, tpl.id] : p.filter(x => x !== tpl.id)))} />
                  <span className="text-sm">
                    <span className="font-medium text-gray-800">{tpl.label}</span>
                    <span className="block text-xs text-gray-500">
                      {t(`tenders.questions.types.${tpl.answer_type}`)}
                      {tpl.answer_type === 'CHOICE' && ` · ${tpl.options.map(o => `${o.label} (${o.score} pt)`).join(', ')}`}
                      {tpl.required ? ` · ${t('tenders.questions.required')}` : ''}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ))}
      </Modal>
    </div>
  );
}
