// backend/src/utils/tenderQuestions.js
// Questions posées aux fournisseurs dans un appel d'offres (migration 54) : contrôle des questions saisies par
// l'acheteur (AO et bibliothèque), contrôle des réponses du fournisseur, note technique.
// Notation : seules les listes de choix sont notées — chaque option porte des points ; note technique =
// points obtenus / points maximum des listes notées × 100 (null sans question notée).

const ANSWER_TYPES = ['TEXT', 'YES_NO', 'NUMBER', 'CHOICE', 'FILE'];
const MAX_QUESTIONS = 50;
const MAX_LABEL = 500;
const MAX_HELP = 1000;
const MAX_OPTIONS = 20;
const MAX_SCORE = 1000;
const MAX_TEXT_ANSWER = 4000;

const fail = (status, code, message, details) => Object.assign(new Error(message), { status, code, details });
const blank = (v) => v === undefined || v === null || String(v).trim() === '';

/**
 * Question saisie par l'acheteur → { label, helpText, answerType, options, required, templateId }.
 * index : position dans la liste (renvoyée dans les erreurs pour situer la question).
 */
function normalizeQuestion(q, index = 0) {
  const details = { index };
  const label = String(q?.label ?? '').trim();
  if (!label) throw fail(400, 'QUESTION_LABEL_REQUIRED', 'Saisissez le libellé de chaque question', details);
  if (label.length > MAX_LABEL) throw fail(400, 'QUESTION_LABEL_TOO_LONG', `Question : ${MAX_LABEL} caractères maximum`, details);
  const answerType = String(q?.answerType ?? q?.answer_type ?? '').toUpperCase();
  if (!ANSWER_TYPES.includes(answerType)) throw fail(400, 'QUESTION_TYPE_INVALID', 'Type de réponse inconnu', details);
  const helpText = String(q?.helpText ?? q?.help_text ?? '').trim() || null;
  if (helpText && helpText.length > MAX_HELP) throw fail(400, 'QUESTION_HELP_TOO_LONG', `Aide : ${MAX_HELP} caractères maximum`, details);

  let options = [];
  if (answerType === 'CHOICE') {
    const raw = Array.isArray(q?.options) ? q.options : [];
    if (raw.length < 2 || raw.length > MAX_OPTIONS) {
      throw fail(400, 'CHOICE_OPTIONS_REQUIRED', `Une liste de choix compte de 2 à ${MAX_OPTIONS} options`, details);
    }
    const seen = new Set();
    options = raw.map((o) => {
      const optLabel = String(o?.label ?? '').trim();
      if (!optLabel || optLabel.length > 200) throw fail(400, 'CHOICE_OPTION_INVALID', 'Chaque option doit avoir un libellé (200 caractères maximum)', details);
      const key = optLabel.toLowerCase();
      if (seen.has(key)) throw fail(400, 'CHOICE_OPTION_DUPLICATE', 'Deux options portent le même libellé', { ...details, option: optLabel });
      seen.add(key);
      const score = blank(o?.score) ? 0 : Number(o.score);
      if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE) {
        throw fail(400, 'CHOICE_SCORE_INVALID', `Points d'une option : nombre de 0 à ${MAX_SCORE}`, { ...details, option: optLabel });
      }
      return { label: optLabel, score: Math.round(score * 100) / 100 };
    });
  }
  const templateId = q?.templateId ?? q?.template_id ?? null;
  return { label, helpText, answerType, options, required: q?.required !== false, templateId: templateId ? String(templateId) : null };
}

/** Liste de questions d'un AO ; undefined = non fournie (inchangée en modification) */
function normalizeQuestions(list) {
  if (list === undefined) return undefined;
  if (list === null) return [];
  if (!Array.isArray(list)) throw fail(400, 'QUESTIONS_INVALID', 'Liste de questions invalide');
  if (list.length > MAX_QUESTIONS) throw fail(400, 'TOO_MANY_QUESTIONS', `${MAX_QUESTIONS} questions maximum`);
  return list.map(normalizeQuestion);
}

/** Même questionnaire (ordre, libellés, types, options, points, obligatoire) — pour refuser un changement après une offre */
function sameQuestions(a, b) {
  const core = (list) => JSON.stringify((list || []).map((q) => {
    const n = normalizeQuestion(q);
    return [n.label, n.helpText, n.answerType, n.options, n.required];
  }));
  return core(a) === core(b);
}

const maxScore = (q) => (q.answer_type === 'CHOICE' ? Math.max(0, ...(q.options || []).map((o) => Number(o.score) || 0)) : 0);
const isScored = (q) => maxScore(q) > 0;

/** Question telle que vue par le fournisseur : jamais les points des options (barème interne) */
function forSupplier(q) {
  return { ...q, options: (q.options || []).map((o) => ({ label: o.label })) };
}

/**
 * Réponses envoyées par le fournisseur : [{ questionId, value, fileId }].
 * fileIdsByQuestion : Map questionId → Set des documents qu'IL a déposés pour cette question.
 * → { rows: [{ questionId, value, fileId, score }], technicalScore }
 */
function checkAnswers(questions, answers, fileIdsByQuestion = new Map()) {
  if (answers !== undefined && answers !== null && !Array.isArray(answers)) throw fail(400, 'ANSWERS_INVALID', 'Réponses invalides');
  const byId = new Map(questions.map((q) => [String(q.id), q]));
  const given = new Map();
  for (const a of answers || []) {
    const qid = String(a?.questionId ?? '');
    if (!byId.has(qid)) throw fail(400, 'ANSWER_UNKNOWN_QUESTION', 'Réponse à une question inconnue', { questionId: a?.questionId });
    if (given.has(qid)) throw fail(400, 'ANSWER_DUPLICATE', 'Deux réponses à la même question', { questionId: Number(qid) });
    given.set(qid, a);
  }

  const rows = [];
  let obtained = 0;
  let possible = 0;
  for (const q of questions) {
    const a = given.get(String(q.id));
    const details = { questionId: q.id, label: q.label };
    const empty = q.answer_type === 'FILE' ? blank(a?.fileId) : blank(a?.value);
    if (isScored(q)) possible += maxScore(q);
    if (empty) {
      if (q.required) throw fail(400, 'ANSWER_REQUIRED', `Répondez à la question « ${q.label} »`, details);
      continue;
    }
    let value = null;
    let fileId = null;
    let score = null;
    switch (q.answer_type) {
      case 'TEXT':
        value = String(a.value).trim();
        if (value.length > MAX_TEXT_ANSWER) throw fail(400, 'ANSWER_TOO_LONG', `Réponse : ${MAX_TEXT_ANSWER} caractères maximum`, details);
        break;
      case 'YES_NO':
        value = String(a.value).toUpperCase();
        if (!['YES', 'NO'].includes(value)) throw fail(400, 'ANSWER_INVALID', 'Répondez par oui ou par non', details);
        break;
      case 'NUMBER': {
        const n = Number(String(a.value).replace(',', '.'));
        if (!Number.isFinite(n)) throw fail(400, 'ANSWER_INVALID', 'Nombre attendu', details);
        value = String(n);
        break;
      }
      case 'CHOICE': {
        const idx = Number(a.value);
        if (!Number.isInteger(idx) || idx < 0 || idx >= (q.options || []).length) throw fail(400, 'ANSWER_INVALID', 'Choisissez une option de la liste', details);
        value = String(idx);
        if (isScored(q)) {
          score = Number(q.options[idx].score) || 0;
          obtained += score;
        }
        break;
      }
      case 'FILE':
        fileId = Number(a.fileId);
        if (!fileIdsByQuestion.get(String(q.id))?.has(fileId)) throw fail(400, 'ANSWER_FILE_INVALID', 'Document introuvable : déposez-le à nouveau', details);
        break;
      default:
        break;
    }
    rows.push({ questionId: q.id, value, fileId, score });
  }
  const technicalScore = possible > 0 ? Math.round((obtained / possible) * 10000) / 100 : null;
  return { rows, technicalScore };
}

module.exports = {
  ANSWER_TYPES, MAX_QUESTIONS, normalizeQuestion, normalizeQuestions, sameQuestions,
  maxScore, isScored, forSupplier, checkAnswers,
};
