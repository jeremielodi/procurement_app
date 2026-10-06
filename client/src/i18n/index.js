// src/i18n/index.js
// Traductions de l'interface : un fichier JSON par langue dans src/locales/<code>.json
// (chargés automatiquement — ajouter une langue = ajouter son fichier, avec un bloc "_meta").
//
//   const { t, lang, setLang } = useTranslation();
//   t('common.save')                      → « Enregistrer »
//   t('requisitions.count', { count: 3 }) → clé « count_one » / « count_other » selon count
//   t('tenders.closesIn', { time })       → « … {{time}} … »
//   t('landing.features.items', { returnObjects: true }) → tableau / objet brut
//
// Hors composant (utils, services) : importer `t` / `getLocale` directement — la langue
// courante est lue au moment de l'appel. `App` s'abonne à la langue, donc tout l'arbre
// se ré-affiche quand elle change.
import { useSyncExternalStore } from 'react';

const DEFAULT_LANG = 'fr';
const STORAGE_KEY = 'app_lang';

const files = import.meta.glob('../locales/*.json', { eager: true });
const DICTS = {};
for (const [path, mod] of Object.entries(files)) {
  const code = path.match(/([\w-]+)\.json$/)[1];
  DICTS[code] = mod.default || mod;
}

/** Langues disponibles : [{ code, name, locale }] (ordre : langue par défaut d'abord) */
export const LANGUAGES = Object.keys(DICTS)
  .sort((a, b) => (a === DEFAULT_LANG ? -1 : b === DEFAULT_LANG ? 1 : a.localeCompare(b)))
  .map(code => ({ code, name: DICTS[code]._meta?.name || code, locale: DICTS[code]._meta?.locale || code }));

function readSaved() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && DICTS[saved]) return saved;
  } catch { /* stockage indisponible */ }
  return DEFAULT_LANG;
}

let current = readSaved();
const listeners = new Set();

function applyDocumentLang() {
  if (typeof document !== 'undefined') document.documentElement.lang = current;
}
applyDocumentLang();

export const getLang = () => current;

/** Locale Intl de la langue courante (ex. fr-FR, en-US) — pour dates et montants */
export const getLocale = (lang = current) => DICTS[lang]?._meta?.locale || lang;

export function setLang(lang) {
  if (!DICTS[lang] || lang === current) return;
  current = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
  applyDocumentLang();
  listeners.forEach(l => l());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Écoute les changements de langue (ex. enregistrement dans le compte) ; retourne la fonction de désabonnement */
export const onLangChange = (listener) => subscribe(() => listener(current));

function lookup(dict, key) {
  let node = dict;
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

function resolve(key, count) {
  const tryLang = (lang) => {
    const dict = DICTS[lang];
    if (!dict) return undefined;
    if (count !== undefined) {
      const plural = lookup(dict, `${key}_${count === 1 ? 'one' : 'other'}`);
      if (plural !== undefined) return plural;
    }
    return lookup(dict, key);
  };
  const value = tryLang(current);
  return value !== undefined ? value : tryLang(DEFAULT_LANG);
}

/**
 * Traduit une clé. Clé absente dans la langue courante → langue par défaut → `defaultValue` → la clé.
 * Paramètres interpolés : {{nom}}.
 */
export function t(key, params = {}) {
  if (!key) return '';
  const value = resolve(key, params.count);
  if (value === undefined) return params.defaultValue ?? key;
  if (params.returnObjects) return value;
  if (typeof value !== 'string') return key;
  return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name) =>
    params[name] !== undefined && params[name] !== null ? String(params[name]) : '');
}

/**
 * Table de libellés traduits à la lecture : labelMap('supplierType', ['COMPANY', …]).COMPANY
 * → t('supplierType.COMPANY'). Compatible avec Object.entries / map[clé].
 */
export const labelMap = (prefix, keys) => keys.reduce((map, k) =>
  Object.defineProperty(map, k, { get: () => t(`${prefix}.${k}`), enumerable: true }), {});

/**
 * Ajoute un `label` traduit à chaque entrée d'une table de configuration :
 * withLabel('tenderStatus', { OPEN: { cls: '…' } }).OPEN.label → t('tenderStatus.OPEN')
 */
export const withLabel = (prefix, entries) => Object.fromEntries(Object.entries(entries).map(([k, v]) => [k,
  Object.defineProperty({ ...v }, 'label', { get: () => t(`${prefix}.${k}`), enumerable: true })]));

/** Vrai si la clé existe (langue courante ou par défaut) */
export const hasKey = (key) => resolve(key) !== undefined;

export function useTranslation() {
  const lang = useSyncExternalStore(subscribe, getLang, getLang);
  return { t, lang, setLang, locale: getLocale(lang), languages: LANGUAGES };
}
