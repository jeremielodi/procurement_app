// backend/src/utils/assetTags.js
// Codification des n° d'inventaire des équipements (migration 57) : ORGANISATION-PROJET-CATÉGORIE-ANNÉE-NNN,
// ex. IMA-MIHR-LAP-2026-001. Le n° est calculé par le trigger stock_unit_asset_tag (base de données) ; ce module
// porte les formats acceptés et la liste des catégories proposées (le code reste libre : 2 à 5 lettres / chiffres).
const ORG_RE = /^[A-Z0-9]{2,10}$/;
const CATEGORY_RE = /^[A-Z0-9]{2,5}$/;
const SEGMENT_RE = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;

// Catégories de la note de codification IMA (2026-11-09), puis catégories complémentaires proposées
const CATEGORIES = [
  'VEH', 'MOT', 'TAB', 'LAP', 'MON', 'IMP', 'PRO', 'GEN', 'REF', 'CLM', 'COM', 'UPS', 'CAM', 'TEL', 'SCO',
  'DSK', 'DSQ', 'AUD', 'TVS', 'ELM',
];
const PROPOSED = ['DSK', 'DSQ', 'AUD', 'TVS', 'ELM'];

const fail = (code, message) => Object.assign(new Error(message), { status: 400, code });

/** Préfixe d'organisation : vide = ancienne codification ; sinon 2 à 10 lettres / chiffres (400 ASSET_TAG_ORG_INVALID) */
function parseOrg(value) {
  const v = String(value ?? '').trim().toUpperCase();
  if (!v) return null;
  if (!ORG_RE.test(v)) throw fail('ASSET_TAG_ORG_INVALID', 'Préfixe d\'organisation invalide (2 à 10 lettres ou chiffres)');
  return v;
}

/** Exemple affiché dans les réglages */
const example = (org) => (org ? `${org}-MIHR-LAP-${new Date().getFullYear()}-001` : `INVT-${new Date().getFullYear()}-00001`);

module.exports = { ORG_RE, CATEGORY_RE, SEGMENT_RE, CATEGORIES, PROPOSED, parseOrg, example };
