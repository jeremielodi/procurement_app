// Vérifie les traductions : npm run i18n:check
//  - chaque langue de src/locales a les mêmes clés que fr.json (référence)
//  - chaque t('clé') littéral du code existe dans fr.json
//  - backend : chaque langue de backend/src/i18n/locales a les mêmes clés que fr.json
// Code de sortie 1 en cas d'écart.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localesDir = path.join(root, 'src', 'locales');
const REF = 'fr';

const flatten = (obj, prefix = '', out = {}) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
};

const locales = Object.fromEntries(
  fs.readdirSync(localesDir).filter(f => f.endsWith('.json')).map(f => [
    f.replace('.json', ''),
    flatten(JSON.parse(fs.readFileSync(path.join(localesDir, f), 'utf8'))),
  ]),
);
const ref = locales[REF];
let problems = 0;

for (const [code, keys] of Object.entries(locales)) {
  if (code === REF) continue;
  const missing = Object.keys(ref).filter(k => !(k in keys));
  const extra = Object.keys(keys).filter(k => !(k in ref));
  if (missing.length) { problems += missing.length; console.log(`\n[${code}] ${missing.length} clé(s) manquante(s) :\n  ${missing.join('\n  ')}`); }
  if (extra.length) { problems += extra.length; console.log(`\n[${code}] ${extra.length} clé(s) absente(s) de ${REF}.json :\n  ${extra.join('\n  ')}`); }
}

// Clés utilisées dans le code
const exists = (k) => k in ref || `${k}_one` in ref || `${k}_other` in ref
  || Object.keys(ref).some(r => r.startsWith(`${k}.`)); // returnObjects sur un bloc
const used = new Map();
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'i18n') walk(p); } // i18n/ : exemples en commentaire
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
      const src = fs.readFileSync(p, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*['"]([\w.-]+)['"]/g)) {
        if (!used.has(m[1])) used.set(m[1], path.relative(root, p));
      }
    }
  }
};
walk(path.join(root, 'src'));
const unknown = [...used].filter(([k]) => !exists(k));
if (unknown.length) {
  problems += unknown.length;
  console.log(`\n${unknown.length} clé(s) utilisée(s) mais absente(s) de ${REF}.json :`);
  unknown.forEach(([k, f]) => console.log(`  ${k}  (${f})`));
}

// Backend : mêmes clés dans chaque langue
const backendDir = path.join(root, '..', 'backend', 'src', 'i18n', 'locales');
if (fs.existsSync(backendDir)) {
  const be = Object.fromEntries(fs.readdirSync(backendDir).filter(f => f.endsWith('.json')).map(f => [
    f.replace('.json', ''), flatten(JSON.parse(fs.readFileSync(path.join(backendDir, f), 'utf8'))),
  ]));
  for (const [code, keys] of Object.entries(be)) {
    if (code === REF || !be[REF]) continue;
    const missing = Object.keys(be[REF]).filter(k => !(k in keys));
    const extra = Object.keys(keys).filter(k => !(k in be[REF]));
    if (missing.length) { problems += missing.length; console.log(`\n[backend ${code}] ${missing.length} clé(s) manquante(s) :\n  ${missing.join('\n  ')}`); }
    if (extra.length) { problems += extra.length; console.log(`\n[backend ${code}] ${extra.length} clé(s) absente(s) de ${REF}.json :\n  ${extra.join('\n  ')}`); }
  }
}

console.log(problems ? `\n✗ ${problems} problème(s)` : `✓ ${Object.keys(locales).length} langue(s), ${Object.keys(ref).length} clés, ${used.size} clés utilisées — OK`);
process.exit(problems ? 1 : 0);
