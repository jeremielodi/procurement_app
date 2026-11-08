// src/utils/tenderQuestions.js
// Questions posées aux fournisseurs dans un appel d'offres : types de réponse, texte d'une réponse, erreurs traduites.
// Mêmes règles que backend/src/utils/tenderQuestions.js (seules les listes de choix sont notées).
import { t } from '../i18n';

export const ANSWER_TYPES = ['TEXT', 'YES_NO', 'NUMBER', 'CHOICE', 'FILE'];

export const emptyQuestion = () => ({ label: '', helpText: '', answerType: 'TEXT', required: true, options: [] });

/** Question renvoyée par l'API (snake_case) → forme éditable (camelCase) */
export const toEditable = (q) => ({
  label: q.label,
  helpText: q.help_text || '',
  answerType: q.answer_type,
  required: q.required !== false,
  options: (q.options || []).map(o => ({ label: o.label, score: o.score ?? 0 })),
  templateId: q.template_id || q.templateId || null,
});

export const maxScore = (q) => ((q.answer_type || q.answerType) === 'CHOICE'
  ? Math.max(0, ...(q.options || []).map(o => Number(o.score) || 0)) : 0);

/** Réponse en texte lisible (document : nom du fichier) */
export function answerText(q, a) {
  if (!a) return null;
  switch (q.answer_type) {
    case 'YES_NO': return a.value === 'YES' ? t('common.yes') : t('common.no');
    case 'CHOICE': return q.options?.[Number(a.value)]?.label ?? null;
    case 'FILE': return a.file_name || null;
    default: return a.value ?? null;
  }
}

/**
 * Message d'une erreur de l'API : code connu → texte traduit (question n° …), sinon message du serveur.
 */
export function questionErrorMessage(error, fallbackKey = 'tenders.questions.err.default') {
  const data = error?.response?.data || {};
  if (!data.code) return data.message || t(fallbackKey);
  const params = {
    n: data.details?.index !== undefined ? data.details.index + 1 : '',
    label: data.details?.label || '',
    option: data.details?.option || '',
  };
  return t(`tenders.questions.err.${data.code}`, { ...params, defaultValue: data.message || t(fallbackKey) });
}
