// backend/src/utils/units.js
// Unités de mesure (référentiel de la plateforme, migration 46) : contrôle d'une unité choisie, correspondance d'un
// texte (« pce », « Pièce », « Piece », « PIECE ») avec une unité — import d'articles, unité d'un article du catalogue.
const db = require('../config/database');

const fail = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });

/** Texte comparable : sans accents, minuscules, espaces réduits */
const norm = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const activeUnits = () => db.select('SELECT id, code, abbr, name, translations FROM units WHERE is_active ORDER BY id');

/** Fonction texte → unité (ou null) : abréviation, code, nom français ou nom traduit */
function unitMatcher(units) {
  const index = new Map();
  for (const u of units) {
    const keys = [u.abbr, u.code, u.name, ...Object.values(u.translations || {}).map(tr => tr?.name)];
    for (const k of keys) if (norm(k) && !index.has(norm(k))) index.set(norm(k), u);
  }
  return (text) => index.get(norm(text)) || null;
}

/**
 * Unité choisie sur une ligne (id) : null si absente ; sinon unité active obligatoire
 * → 400 UNIT_INVALID ({ line } si fourni). `cache` : Map id → résultat pour plusieurs lignes.
 */
async function resolveUnitId(value, { line, tx = db, cache } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  if (cache?.has(id)) return cache.get(id);
  const row = Number.isInteger(id) && id > 0 ? await tx.one('SELECT id FROM units WHERE id = $1 AND is_active', [id]) : null;
  if (!row) throw fail(400, 'UNIT_INVALID', 'Unité de mesure inconnue ou désactivée', line !== undefined ? { line } : {});
  cache?.set(id, row.id);
  return row.id;
}

module.exports = { activeUnits, unitMatcher, resolveUnitId, normUnit: norm };
