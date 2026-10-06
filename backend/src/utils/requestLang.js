// backend/src/utils/requestLang.js
// Langue de la requête HTTP courante, lisible par les modèles sans changer leurs signatures
// (même principe que utils/tenant.js). Hors requête (workers, scripts) : langue par défaut (fr).
const { AsyncLocalStorage } = require('async_hooks');
const i18n = require('../i18n');

const als = new AsyncLocalStorage();

/** Middleware Express : ?lang= puis Accept-Language (i18n.fromRequest) */
function requestLanguage(req, res, next) {
  als.run({ lang: i18n.fromRequest(req) }, next);
}

const currentLang = () => als.getStore()?.lang || i18n.DEFAULT_LANG;

/**
 * Expression SQL d'un champ traduisible d'un référentiel (colonne JSONB `translations`) :
 * traduction de la langue courante si renseignée, sinon la colonne (français).
 * Ex. localizedSql('c') → COALESCE(NULLIF(c.translations->'en'->>'name', ''), c.name)
 */
function localizedSql(alias, field = 'name', lang = currentLang()) {
  const code = i18n.normalizeLang(lang); // code connu uniquement → sûr à insérer dans le SQL
  if (code === i18n.DEFAULT_LANG) return `${alias}.${field}`;
  return `COALESCE(NULLIF(${alias}.translations->'${code}'->>'${field}', ''), ${alias}.${field})`;
}

module.exports = { requestLanguage, currentLang, localizedSql };
