#!/usr/bin/env node
// Migration des fichiers uploadés : disque (UPLOAD_DIR) → MinIO.
// Les clés MinIO = chemins relatifs déjà enregistrés en base (attachments.file_path,
// suppliers.logo_path, enterprise.logo_path) : aucune mise à jour de la base n'est nécessaire.
//
// Usage (dans le conteneur) :  docker exec wwf_app node scripts/migrate-uploads-to-minio.js [--dry-run]
// Idempotent : les fichiers déjà présents dans MinIO (même taille) sont ignorés.
require('../env');
const fs = require('fs');
const path = require('path');
const db = require('../src/config/database');
const storage = require('../src/services/StorageService');

const DRY_RUN = process.argv.includes('--dry-run');
const MIME = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip', '.rar': 'application/vnd.rar', '.7z': 'application/x-7z-compressed',
};

function walk(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

(async () => {
  if (storage.driver !== 'minio') {
    console.error('❌ STORAGE_DRIVER doit être « minio » (MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY)');
    process.exit(1);
  }
  const base = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../uploads'));
  await storage.init();
  const files = walk(base);
  console.log(`📂 ${files.length} fichier(s) dans ${base} → bucket « ${storage.bucket} »${DRY_RUN ? ' (simulation)' : ''}`);

  let copied = 0, skipped = 0, failed = 0;
  for (const key of files) {
    const local = path.join(base, key);
    try {
      if (await storage.exists(key)) { skipped++; continue; }
      if (!DRY_RUN) {
        await storage.put(key, fs.readFileSync(local), MIME[path.extname(key).toLowerCase()] || 'application/octet-stream');
      }
      copied++;
      console.log(`  ✔ ${key}`);
    } catch (e) {
      failed++;
      console.error(`  ✘ ${key} : ${e.message}`);
    }
  }

  // Vérification : chaque fichier référencé en base est bien présent dans MinIO
  const refs = await db.select(`
    SELECT 'attachments' AS src, file_path AS key FROM attachments WHERE file_path IS NOT NULL
    UNION ALL SELECT 'suppliers', logo_path FROM suppliers WHERE logo_path IS NOT NULL
    UNION ALL SELECT 'enterprise', logo_path FROM enterprise WHERE logo_path IS NOT NULL`, []);
  const missing = [];
  for (const r of refs) if (!(await storage.exists(r.key))) missing.push(`${r.src}: ${r.key}`);

  console.log(`\n✅ Copiés : ${copied} · déjà présents : ${skipped} · erreurs : ${failed}`);
  console.log(`🔎 Références en base : ${refs.length} · manquantes dans MinIO : ${missing.length}`);
  missing.forEach(m => console.log(`   ⚠ ${m}`));
  if (!DRY_RUN && failed === 0 && missing.length === 0) {
    console.log('\nLes fichiers sont dans MinIO. Le volume disque (wwf_uploads_data) peut être conservé comme copie de sécurité.');
  }
  process.exit(failed || missing.length ? 2 : 0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
