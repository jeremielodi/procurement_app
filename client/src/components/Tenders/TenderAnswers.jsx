// src/components/Tenders/TenderAnswers.jsx
// Fiche d'un appel d'offres : questions posées aux fournisseurs ; après la clôture, tableau questions × offres
// (réponses, documents, points des listes de choix) et note technique de chaque offre.
import { HelpCircle, Paperclip, Lock } from 'lucide-react';
import { tenderService } from '../../services/tenderService';
import { answerText, maxScore } from '../../utils/tenderQuestions';
import { t, getLocale } from '../../i18n';

async function openFile(tenderId, fileId, fileName) {
  try {
    const blob = await tenderService.getAnswerFile(tenderId, fileId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    if (!/^(application\/pdf|image\/)/.test(blob.type)) a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (_) { /* toast via intercepteur */ }
}

export default function TenderAnswers({ tender }) {
  const questions = tender.questions || [];
  if (!questions.length) return null;
  const subs = tender.submissions || [];
  const scored = questions.some(q => maxScore(q) > 0);
  const scores = subs.map(s => (s.technical_score === null || s.technical_score === undefined ? null : parseFloat(s.technical_score)));
  const bestScore = scores.filter(v => v !== null).length > 1 ? Math.max(...scores.filter(v => v !== null)) : null;

  // Avant la clôture (ou sans offre) : les questions seulement
  if (tender.sealed || !subs.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5" data-testid="tender-questions-list">
        <h2 className="font-semibold text-gray-800 flex items-center gap-2 mb-1"><HelpCircle size={18} /> {t('tenders.questions.titleCount', { count: questions.length })}</h2>
        {tender.sealed && subs.length > 0 && (
          <p className="text-xs text-gray-500 mb-2 flex items-center gap-1"><Lock size={12} /> {t('tenders.questions.sealedHint')}</p>
        )}
        <ol className="list-decimal pl-5 space-y-1 text-sm text-gray-700">
          {questions.map(q => (
            <li key={q.id}>
              {q.label}
              <span className="text-xs text-gray-500">
                {' '}— {t(`tenders.questions.types.${q.answer_type}`)}
                {q.answer_type === 'CHOICE' && ` (${q.options.map(o => `${o.label} : ${o.score} pt`).join(', ')})`}
                {q.required ? '' : ` · ${t('tenders.questions.optional')}`}
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
      <div className="px-4 py-3 border-b border-gray-200 font-semibold text-gray-800 flex items-center gap-2">
        <HelpCircle size={18} /> {t('tenders.questions.answersTitle')}
      </div>
      <table className="w-full text-sm" data-testid="answers-table">
        <thead className="bg-gray-50">
          <tr>
            <th className="text-left px-3 py-2 font-medium text-gray-600 min-w-[240px]">{t('tenders.questions.question')}</th>
            {subs.map(s => <th key={s.id} className="text-left px-3 py-2 font-medium text-gray-700 min-w-[180px]">{s.supplier_name}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {questions.map((q, idx) => {
            const max = maxScore(q);
            return (
              <tr key={q.id}>
                <td className="px-3 py-2 align-top">
                  <span className="text-gray-400 mr-1">{idx + 1}.</span>{q.label}
                  {max > 0 && <div className="text-xs text-gray-500">{t('tenders.questions.maxPoints', { points: max })}</div>}
                </td>
                {subs.map(s => {
                  const a = (s.answers || []).find(x => String(x.question_id) === String(q.id));
                  const text = answerText(q, a);
                  const full = max > 0 && a && Number(a.score) === max;
                  return (
                    <td key={s.id} className={`px-3 py-2 align-top ${full ? 'bg-green-50' : ''}`} data-testid="answer-cell">
                      {!a ? <span className="text-gray-400">{t('tenders.questions.noAnswer')}</span>
                        : q.answer_type === 'FILE' ? (
                          <button type="button" onClick={() => openFile(tender.id, a.file_id, a.file_name)}
                            className="text-blue-600 hover:underline inline-flex items-center gap-1 text-left">
                            <Paperclip size={13} /> {text}
                          </button>
                        ) : <span className="whitespace-pre-line">{text}</span>}
                      {max > 0 && a && <div className="text-xs text-gray-500">{t('tenders.questions.pointsOf', { points: a.score ?? 0, max })}</div>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        {scored && (
          <tfoot className="bg-gray-50 border-t-2 border-gray-200">
            <tr>
              <td className="px-3 py-2 font-semibold">
                {t('tenders.questions.technicalScore')}
                <div className="text-xs font-normal text-gray-500">{t('tenders.questions.technicalScoreHint')}</div>
              </td>
              {subs.map((s, i) => (
                <td key={s.id} className={`px-3 py-2 font-bold ${bestScore !== null && scores[i] === bestScore ? 'text-green-700' : ''}`} data-testid="technical-score">
                  {scores[i] === null ? '—' : `${scores[i].toLocaleString(getLocale(), { maximumFractionDigits: 2 })} %`}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
