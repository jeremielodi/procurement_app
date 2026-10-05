#!/usr/bin/env node
// Copie des fichiers : MinIO local → MinIO distant (même bucket, mêmes clés).
// Les clés sont celles enregistrées en base (attachments.file_path, logos…) : aucune mise à jour
// de la base n'est nécessaire côté serveur distant.
//
// Usage (depuis backend/scripts, ou node scripts/… depuis backend) :
//   node copy-minio-to-remote.js              # copie
//   node copy-minio-to-remote.js --dry-run    # liste ce qui serait copié, sans rien envoyer
//
// Configuration (backend/.env) :
//   MINIO_ROOT_USER / MINIO_ROOT_PASSWORD (ou MINIO_ACCESS_KEY / MINIO_SECRET_KEY), MINIO_BUCKET
//   Source  : MINIO_ENDPOINT / MINIO_PORT                 (défaut localhost:9000)
//   Cible   : REMOTE_MINIO_ENDPOINT / REMOTE_MINIO_PORT   (défaut 159.223.104.250:9000)
//             REMOTE_MINIO_USE_SSL, REMOTE_MINIO_ACCESS_KEY / REMOTE_MINIO_SECRET_KEY (défaut : mêmes identifiants)
//
// Idempotent : un objet déjà présent sur la cible avec la même taille est ignoré. Ne supprime rien.
const path = require('path');
require(path.join(__dirname, '..', 'env'));
const Minio = require('minio');

const DRY_RUN = process.argv.slice(2).includes('--dry-run');
const BUCKET = process.env.MINIO_BUCKET || 'procureapp';
const ACCESS = process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER;
const SECRET = process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD;

// Hors Docker, « minio » (nom du service compose) ne se résout pas : on vise localhost
const srcHost = !process.env.MINIO_ENDPOINT || process.env.MINIO_ENDPOINT === 'minio' ? 'localhost' : process.env.MINIO_ENDPOINT;
const source = {
  endPoint: srcHost,
  port: parseInt(process.env.MINIO_PORT || '9000', 10),
  useSSL: String(process.env.MINIO_USE_SSL || 'false') === 'true',
  accessKey: ACCESS,
  secretKey: SECRET,
};
const target = {
  endPoint: process.env.REMOTE_MINIO_ENDPOINT || '159.223.104.250',
  port: parseInt(process.env.REMOTE_MINIO_PORT || '9000', 10),
  useSSL: String(process.env.REMOTE_MINIO_USE_SSL || 'false') === 'true',
  accessKey: process.env.REMOTE_MINIO_ACCESS_KEY || ACCESS,
  secretKey: process.env.REMOTE_MINIO_SECRET_KEY || SECRET,
};

const isNotFound = (e) => ['NoSuchKey', 'NotFound'].includes(e?.code);
const label = (c) => `${c.useSSL ? 'https' : 'http'}://${c.endPoint}:${c.port}`;

function listAll(client, bucket) {
  return new Promise((resolve, reject) => {
    const out = [];
    const stream = client.listObjectsV2(bucket, '', true);
    stream.on('data', (o) => { if (o.name) out.push(o); });
    stream.on('error', reject);
    stream.on('end', () => resolve(out));
  });
}

(async () => {
  if (!ACCESS || !SECRET) {
    console.error('❌ Identifiants MinIO manquants : MINIO_ROOT_USER / MINIO_ROOT_PASSWORD dans backend/.env');
    process.exit(1);
  }
  const src = new Minio.Client(source);
  const dst = new Minio.Client(target);

  console.log(`📤 Source : ${label(source)}  bucket « ${BUCKET} »`);
  console.log(`📥 Cible  : ${label(target)}  bucket « ${BUCKET} »${DRY_RUN ? '   (simulation)' : ''}`);

  try {
    if (!(await src.bucketExists(BUCKET))) {
      console.error(`❌ Le bucket « ${BUCKET} » n'existe pas sur la source`);
      process.exit(1);
    }
  } catch (e) {
    console.error(`❌ MinIO source injoignable (${label(source)}) : ${e.message}`);
    process.exit(1);
  }

  let targetBucketExists = false;
  try {
    targetBucketExists = await dst.bucketExists(BUCKET);
    if (!targetBucketExists) {
      if (DRY_RUN) console.log(`   (le bucket « ${BUCKET} » serait créé sur la cible)`);
      else {
        await dst.makeBucket(BUCKET);
        targetBucketExists = true;
        console.log(`   Bucket « ${BUCKET} » créé sur la cible`);
      }
    }
    if (!DRY_RUN) {
      try { await dst.setBucketVersioning(BUCKET, { Status: 'Enabled' }); }
      catch (e) { console.warn(`⚠ Versioning non activé sur la cible : ${e.message}`); }
    }
  } catch (e) {
    console.error(`❌ MinIO cible injoignable ou identifiants refusés (${label(target)}) : ${e.message}`);
    process.exit(1);
  }

  const objects = await listAll(src, BUCKET);
  console.log(`   ${objects.length} objet(s) sur la source\n`);

  let copied = 0, skipped = 0, failed = 0, bytes = 0;
  for (const obj of objects) {
    const key = obj.name;
    try {
      if (targetBucketExists) {
        try {
          const remote = await dst.statObject(BUCKET, key);
          if (remote.size === obj.size) { skipped++; continue; }
        } catch (e) {
          if (!isNotFound(e)) throw e;
        }
      }
      if (!DRY_RUN) {
        const stat = await src.statObject(BUCKET, key);
        const stream = await src.getObject(BUCKET, key);
        await dst.putObject(BUCKET, key, stream, stat.size, {
          'Content-Type': stat.metaData?.['content-type'] || 'application/octet-stream',
        });
      }
      copied++;
      bytes += obj.size;
      console.log(`  ${DRY_RUN ? '→' : '✔'} ${key} (${obj.size} octets)`);
    } catch (e) {
      failed++;
      console.error(`  ✘ ${key} : ${e.message}`);
    }
  }

  console.log(`\n${DRY_RUN ? '📝 À copier' : '✅ Copiés'} : ${copied} (${(bytes / 1024).toFixed(1)} Ko) · déjà présents : ${skipped} · erreurs : ${failed}`);
  process.exit(failed ? 2 : 0);
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
