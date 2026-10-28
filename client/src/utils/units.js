// src/utils/units.js — unités de mesure (référentiel de la plateforme, GET /units)

const norm = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Unité correspondant à un texte (« pce », « Pièce », « Piece », « PIECE ») — ex. unité d'un article du catalogue —
 * ou null. Même règle que le serveur (utils/units.unitMatcher) : abréviation, code, nom, nom traduit.
 */
export function findUnit(units, text) {
  const key = norm(text);
  if (!key) return null;
  return (units || []).find(u =>
    [u.abbr, u.code, u.name, ...Object.values(u.translations || {}).map(tr => tr?.name)].some(v => norm(v) === key)
  ) || null;
}

/** Libellé d'une unité dans une liste : « Pièce (pce) » (nom déjà traduit par le serveur) */
export const unitLabel = (u) => (u ? `${u.name} (${u.abbr})` : '');
