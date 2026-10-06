// backend/src/i18n/index.js
// Traductions FR / EN du backend (documents PDF/Excel, suivi du workflow, libellés renvoyés à l'interface).
// Un fichier JSON par langue dans ./locales/<code>.json (chargés automatiquement — ajouter une langue = ajouter son fichier).
// Usage : const t = i18n.translator(lang);  t('status.APPROVED')  →  « Approuvée » / « Approved »
//         i18n.normalizeLang('en-US') → 'en'   (défaut : 'fr')
//         i18n.fromRequest(req) → langue de la requête (?lang=, puis en-tête Accept-Language)
const fs = require('fs');
const path = require('path');

const DEFAULT_LANG = 'fr';
const DIR = path.join(__dirname, 'locales');

const DICTS = Object.fromEntries(
  fs.readdirSync(DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => [f.replace('.json', ''), JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))])
);

function normalizeLang(lang) {
  const l = String(lang || '').toLowerCase().slice(0, 2);
  return DICTS[l] ? l : DEFAULT_LANG;
}

/** Langue d'une requête HTTP : ?lang= prioritaire, sinon première langue connue d'Accept-Language */
function fromRequest(req) {
  if (req?.query?.lang) return normalizeLang(req.query.lang);
  const header = req?.headers?.['accept-language'] || '';
  const known = header.split(',').map(p => p.trim().slice(0, 2).toLowerCase()).find(l => DICTS[l]);
  return known || DEFAULT_LANG;
}

const lookup = (dict, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), dict);

/**
 * t('status.APPROVED', { var: … }) ; clé absente → langue par défaut → dernière partie de la clé (ex. le code du statut).
 * Variables : {var}
 */
function translator(lang) {
  const dict = DICTS[normalizeLang(lang)];
  return (key, vars = {}) => {
    let value = lookup(dict, key);
    if (typeof value !== 'string') value = lookup(DICTS[DEFAULT_LANG], key);
    const text = typeof value === 'string' ? value : key.split('.').pop();
    return text.replace(/\{(\w+)\}/g, (m, v) => (vars[v] !== undefined && vars[v] !== null ? vars[v] : m));
  };
}

/** Vrai si la clé existe (langue demandée ou par défaut) */
function has(lang, key) {
  return typeof lookup(DICTS[normalizeLang(lang)], key) === 'string' || typeof lookup(DICTS[DEFAULT_LANG], key) === 'string';
}

/** Bloc brut d'une langue (ex. section('fr', 'pdf.po')) — utilisé pour construire les libellés des PDF */
const section = (lang, key) => lookup(DICTS[normalizeLang(lang)], key);

const locale = (lang) => DICTS[normalizeLang(lang)]._meta?.locale || 'fr-FR';

module.exports = { normalizeLang, fromRequest, translator, has, section, locale, LANGS: Object.keys(DICTS), DEFAULT_LANG };
