// backend/src/services/StorageService.js
// Stockage des fichiers uploadés (pièces jointes, logos).
//
//  - STORAGE_DRIVER=minio (défaut si MINIO_ENDPOINT est défini) : bucket MinIO PRIVÉ et VERSIONNÉ
//    (un fichier écrasé ou supprimé reste récupérable). Les fichiers ne sont servis que par l'API,
//    après authentification et contrôle de l'entreprise.
//  - STORAGE_DRIVER=local : disque (UPLOAD_DIR) — repli pour le développement sans Docker.
//
// Les clés sont les chemins relatifs déjà enregistrés en base (ex. « 2026/10/171…_uuid.pdf »,
// « enterprise-logos/ACME_171….png ») : la migration disque → MinIO garde les mêmes clés.
const fs = require('fs');
const path = require('path');
const debug = require('debug');

const log = debug('storage:info');
const logError = debug('storage:error');

const DRIVER = (process.env.STORAGE_DRIVER || (process.env.MINIO_ENDPOINT ? 'minio' : 'local')).toLowerCase();
const BUCKET = process.env.MINIO_BUCKET || 'procureapp';

let minio = null;
function minioClient() {
  if (!minio) {
    const Minio = require('minio');
    minio = new Minio.Client({
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT || '9000', 10),
      useSSL: String(process.env.MINIO_USE_SSL || 'false') === 'true',
      // Identifiants dédiés si fournis, sinon ceux du serveur MinIO (backend/.env, partagé avec le service minio)
      accessKey: process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER,
      secretKey: process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD,
    });
  }
  return minio;
}

function localBase() {
  return path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));
}

/** Clé normalisée (séparateurs « / », pas de remontée de dossier) */
function normalizeKey(key) {
  const k = String(key || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!k || k.split('/').some(part => part === '..')) throw new Error(`Clé de fichier invalide : ${key}`);
  return k;
}

function localPath(key) {
  const base = localBase();
  const file = path.resolve(base, normalizeKey(key));
  if (!file.startsWith(base)) throw new Error('Chemin hors du dossier de stockage');
  return file;
}

const isNotFound = (e) => ['NoSuchKey', 'NotFound', 'ENOENT'].includes(e?.code);

class StorageService {
  get driver() { return DRIVER; }
  get bucket() { return BUCKET; }

  /** Au démarrage : crée le bucket (privé, versionné) ou le dossier local */
  async init() {
    if (DRIVER === 'minio') {
      const c = minioClient();
      if (!(await c.bucketExists(BUCKET))) {
        await c.makeBucket(BUCKET);
        log('Bucket %s créé', BUCKET);
      }
      try {
        await c.setBucketVersioning(BUCKET, { Status: 'Enabled' });
      } catch (e) {
        logError('Versioning non activé sur %s : %s', BUCKET, e.message);
      }
      log('Stockage MinIO prêt : bucket %s (%s:%s)', BUCKET, process.env.MINIO_ENDPOINT, process.env.MINIO_PORT || 9000);
    } else {
      fs.mkdirSync(localBase(), { recursive: true });
      log('Stockage local : %s', localBase());
    }
  }

  /** Enregistre un fichier ; renvoie la clé */
  async put(key, buffer, contentType = 'application/octet-stream') {
    const k = normalizeKey(key);
    if (DRIVER === 'minio') {
      await minioClient().putObject(BUCKET, k, buffer, buffer.length, { 'Content-Type': contentType });
    } else {
      const file = localPath(k);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buffer);
    }
    return k;
  }

  /** Contenu complet (null si absent) — ex. logo embarqué dans un PDF */
  async getBuffer(key) {
    if (!key) return null;
    try {
      if (DRIVER === 'minio') {
        const stream = await minioClient().getObject(BUCKET, normalizeKey(key));
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        return Buffer.concat(chunks);
      }
      const file = localPath(key);
      return fs.existsSync(file) ? fs.readFileSync(file) : null;
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async exists(key) {
    if (!key) return false;
    try {
      if (DRIVER === 'minio') {
        await minioClient().statObject(BUCKET, normalizeKey(key));
        return true;
      }
      return fs.existsSync(localPath(key));
    } catch (e) {
      if (isNotFound(e)) return false;
      throw e;
    }
  }

  /** Suppression (sans erreur si absent). Avec le versioning MinIO, la version précédente reste récupérable. */
  async remove(key) {
    if (!key) return;
    try {
      if (DRIVER === 'minio') await minioClient().removeObject(BUCKET, normalizeKey(key));
      else fs.rmSync(localPath(key), { force: true });
    } catch (e) {
      if (!isNotFound(e)) logError('Suppression de %s : %s', key, e.message);
    }
  }

  /**
   * Envoie le fichier dans la réponse HTTP (flux, sans tout charger en mémoire).
   * @returns {Promise<boolean>} false si le fichier n'existe pas (la réponse n'est alors pas envoyée)
   */
  async send(res, key, { fileName, contentType, inline = false, cacheControl } = {}) {
    if (!key) return false;
    let stream;
    let size;
    let type = contentType;
    try {
      if (DRIVER === 'minio') {
        const k = normalizeKey(key);
        const stat = await minioClient().statObject(BUCKET, k);
        size = stat.size;
        type = type || stat.metaData?.['content-type'];
        stream = await minioClient().getObject(BUCKET, k);
      } else {
        const file = localPath(key);
        if (!fs.existsSync(file)) return false;
        size = fs.statSync(file).size;
        stream = fs.createReadStream(file);
      }
    } catch (e) {
      if (isNotFound(e)) return false;
      throw e;
    }
    res.set('Content-Type', type || 'application/octet-stream');
    if (size !== undefined) res.set('Content-Length', String(size));
    if (cacheControl) res.set('Cache-Control', cacheControl);
    if (fileName) {
      const ascii = String(fileName).replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
      res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    }
    await new Promise((resolve, reject) => {
      stream.on('error', reject);
      res.on('finish', resolve);
      res.on('close', resolve);
      stream.pipe(res);
    });
    return true;
  }
}

module.exports = new StorageService();
