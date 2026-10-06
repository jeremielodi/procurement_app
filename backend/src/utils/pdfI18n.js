// backend/src/utils/pdfI18n.js
// Traduction des PDF (Handlebars) : libellés L (section pdf.<doc> des locales) + locale Intl.
// Les helpers lisent la langue sur la racine du template (options.data.root.locale / .lang),
// les appels {{helper valeur}} restent donc inchangés dans les templates.
const i18n = require('../i18n');

/** Contexte de langue d'un PDF : { lang, locale, t, L } (L = libellés pdf.<section> + pdf.common) */
function pdfContext(lang, section) {
  const code = i18n.normalizeLang(lang);
  const t = i18n.translator(code);
  return { lang: code, locale: i18n.locale(code), t, L: { ...labels(code, 'pdf.common'), ...labels(code, `pdf.${section}`) } };
}

/** Objet de libellés d'une section (clés absentes → langue par défaut) */
function labels(lang, prefix) {
  const t = i18n.translator(lang);
  const ref = i18n.section(i18n.DEFAULT_LANG, prefix) || {};
  const out = {};
  const walk = (obj, path, target) => {
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object') walk(v, `${path}.${k}`, (target[k] = {}));
      else target[k] = t(`${path}.${k}`);
    }
  };
  walk(ref, prefix, out);
  return out;
}

/** Locale Intl du template courant (dernier argument d'un helper Handlebars) */
const rootLocale = (options) => options?.data?.root?.locale || i18n.locale(i18n.DEFAULT_LANG);
const rootLabels = (options) => options?.data?.root?.L || {};

module.exports = { pdfContext, labels, rootLocale, rootLabels };
