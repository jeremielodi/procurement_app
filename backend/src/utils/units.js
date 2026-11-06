// backend/src/utils/units.js
// Unités de mesure (référentiel de la plateforme, migration 46) : contrôle d'une unité choisie, correspondance d'un
// texte (« pce », « Pièce », « Piece », « PIECE ») avec une unité — import d'articles, unité d'un article du catalogue.
const db = require('../config/database');

const fail = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });

/** Texte comparable : sans accents, minuscules, espaces réduits */
const norm = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const activeUnits = () => db.select('SELECT id, code, abbr, name, translations FROM units WHERE is_active ORDER BY id');

/** Abréviations usuelles → code d'unité (mêmes alias que la fonction SQL find_unit_id, migration 49) */
const UNIT_ALIASES = {
  l: 'LITER', lt: 'LITER', litres: 'LITER', liter: 'LITER', liters: 'LITER',
  kg: 'KG', kgs: 'KG', m: 'METER', metres: 'METER', meter: 'METER',
  pc: 'PIECE', pcs: 'PIECE', pieces: 'PIECE', u: 'UNIT', unites: 'UNIT', units: 'UNIT',
  boite: 'BOX', boites: 'BOX', bte: 'BOX', sacs: 'BAGS', paquets: 'PACKAGE', pqt: 'PACKAGE',
  cartons: 'CARTON', rames: 'REAM', tonnes: 'TONNE', m2: 'SQ_METER', m3: 'CU_METER',
  kits: 'KIT', paires: 'PAIR', rouleaux: 'ROLLS', flacons: 'BOTTLE2', bouteilles: 'BOTTLE',
};

/** Fonction texte → unité (ou null) : abréviation, code, nom français ou nom traduit, puis abréviations usuelles */
function unitMatcher(units) {
  const index = new Map();
  // Abréviations d'abord : une abréviation l'emporte sur le nom d'une autre unité
  for (const u of units) if (norm(u.abbr)) index.set(norm(u.abbr), u);
  for (const u of units) {
    const keys = [u.code, u.name, ...Object.values(u.translations || {}).map(tr => tr?.name)];
    for (const k of keys) if (norm(k) && !index.has(norm(k))) index.set(norm(k), u);
  }
  const byCode = new Map(units.map(u => [String(u.code).toUpperCase(), u]));
  return (text) => index.get(norm(text)) || byCode.get(UNIT_ALIASES[norm(text)]) || null;
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

/**
 * Unité d'un article du catalogue de stock : `unitId` (id), sinon `unit` (texte : abréviation, nom… — anciens
 * clients, scripts). undefined si aucun des deux n'est fourni ; inconnue / désactivée → 400 UNIT_INVALID.
 */
async function resolveItemUnit({ unitId, unit } = {}, { tx = db } = {}) {
  if (unitId !== undefined && unitId !== null && unitId !== '') return resolveUnitId(unitId, { tx });
  if (unit === undefined || unit === null) return undefined;
  const found = String(unit).trim() ? unitMatcher(await tx.select('SELECT id, code, abbr, name, translations FROM units WHERE is_active'))(unit) : null;
  if (!found) throw fail(400, 'UNIT_INVALID', `Unité de mesure inconnue ou désactivée : ${String(unit).trim() || '—'}`);
  return found.id;
}

module.exports = { activeUnits, unitMatcher, resolveUnitId, resolveItemUnit, normUnit: norm, UNIT_ALIASES };
