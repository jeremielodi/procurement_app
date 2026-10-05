#!/usr/bin/env node
// Migration des fichiers uploadés : dossier local (UPLOAD_DIR) → MinIO.
// Les clés MinIO = chemins relatifs au dossier (ex. « 2026/06/1780…_uuid.pdf »), c'est-à-dire les
// valeurs déjà enregistrées en base (attachments.file_path, suppliers.logo_path, enterprise.logo_path) :
// aucune mise à jour de la base n'est nécessaire.
//
// Usage :
//   node migrate-uploads-to-minio.js                 # depuis backend/scripts (ou node scripts/… depuis backend)
//   node migrate-uploads-to-minio.js --dry-run       # liste ce qui serait copié, sans rien envoyer
//   node migrate-uploads-to-minio.js --dir="D:\autre\dossier"
//   node migrate-uploads-to-minio.js --skip-db-check # ne pas vérifier les références en base
//   docker exec wwf_app node scripts/migrate-uploads-to-minio.js   # depuis le conteneur
//
// Configuration (backend/.env) :
//   UPLOAD_DIR                          dossier source
//   MINIO_ROOT_USER / MINIO_ROOT_PASSWORD (ou MINIO_ACCESS_KEY / MINIO_SECRET_KEY), MINIO_BUCKET
//   MINIO_ENDPOINT / MINIO_PORT         facultatifs : localhost:9000 par défaut (hors Docker)
//
// Idempotent : un fichier déjà présent dans MinIO avec la même taille est ignoré. Ne supprime rien.
const path = require('path');
require(path.join(__dirname, '..', 'env'));
const fs = require('fs');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_DB = args.includes('--skip-db-check');
const dirArg = args.find(a => a.startsWith('--dir='));

// Ce script écrit toujours dans MinIO (le driver « local » n'a pas de sens ici)
process.env.STORAGE_DRIVER = 'minio';
if (!process.env.MINIO_ENDPOINT) process.env.MINIO_ENDPOINT = 'localhost';
if (!process.env.MINIO_PORT) process.env.MINIO_PORT = '9000';
const storage = require('../src/services/StorageService');

const MIME = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip', '.rar': 'application/vnd.rar', '.7z': 'application/x-7z-compressed',
};

/** Fichiers du dossier (récursif), en chemins relatifs avec « / » */
function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/** Vérifie que chaque fichier référencé en base est présent dans MinIO (facultatif) */
async function checkDatabaseReferences() {
  const db = require('../src/config/database');
  const refs = await db.select(`
    SELECT 'pièce jointe' AS src, file_path AS key FROM attachments WHERE file_path IS NOT NULL
    UNION ALL SELECT 'logo fournisseur', logo_path FROM suppliers WHERE logo_path IS NOT NULL
    UNION ALL SELECT 'logo entreprise', logo_path FROM enterprise WHERE logo_path IS NOT NULL`, []);
  const missing = [];
  for (const r of refs) if (!(await storage.exists(r.key))) missing.push(`${r.src} : ${r.key}`);
  return { total: refs.length, missing };
}

(async () => {
  const source = path.resolve(dirArg ? dirArg.slice('--dir='.length).replace(/^["']|["']$/g, '')
    : (process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads')));
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    console.error(`❌ Dossier source introuvable : ${source}\n   Définir UPLOAD_DIR dans backend/.env ou utiliser --dir="chemin"`);
    process.exit(1);
  }
  if (!(process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER) || !(process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD)) {
    console.error('❌ Identifiants MinIO manquants : MINIO_ROOT_USER / MINIO_ROOT_PASSWORD dans backend/.env');
    process.exit(1);
  }

  console.log(`📂 Source : ${source}`);
  console.log(`🪣 Cible  : MinIO ${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT}, bucket « ${storage.bucket} »${DRY_RUN ? '   (simulation)' : ''}`);
  try {
    await storage.init(); // crée le bucket (privé, versionné) s'il n'existe pas
  } catch (e) {
    console.error(`❌ MinIO injoignable (${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT}) : ${e.message}`);
    console.error('   Le conteneur minio tourne-t-il ? (docker compose up -d minio)');
    process.exit(1);
  }

  const files = walk(source);
  console.log(`   ${files.length} fichier(s) trouvé(s)\n`);

  let copied = 0, skipped = 0, failed = 0;
  for (const key of files) {
    const local = path.join(source, ...key.split('/'));
    try {
      const size = fs.statSync(local).size;
      if (await storage.exists(key)) { skipped++; continue; }
      if (!DRY_RUN) {
        await storage.put(key, fs.readFileSync(local), MIME[path.extname(key).toLowerCase()] || 'application/octet-stream');
      }
      copied++;
      console.log(`  ${DRY_RUN ? '→' : '✔'} ${key} (${size} octets)`);
    } catch (e) {
      failed++;
      console.error(`  ✘ ${key} : ${e.message}`);
    }
  }
  console.log(`\n${DRY_RUN ? '📝 À copier' : '✅ Copiés'} : ${copied} · déjà présents : ${skipped} · erreurs : ${failed}`);

  let missing = [];
  if (!SKIP_DB && !DRY_RUN) {
    try {
      const check = await checkDatabaseReferences();
      missing = check.missing;
      console.log(`🔎 Références en base : ${check.total} · absentes de MinIO : ${missing.length}`);
      missing.forEach(m => console.log(`   ⚠ ${m}`));
    } catch (e) {
      console.warn(`⚠ Vérification en base ignorée (base injoignable avec la configuration actuelle : ${e.message})`);
    }
  }
  process.exit(failed ? 2 : 0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
