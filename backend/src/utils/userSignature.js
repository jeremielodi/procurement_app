// backend/src/utils/userSignature.js
// Signature image de l'utilisateur (migration 41_user_signatures.sql) : PNG / JPG / WEBP ≤ 1 Mo, déposée ou dessinée
// par l'utilisateur lui-même, stockée via StorageService sous user-signatures/, jamais servie en statique.
// Reprise dans les PDF (signatureDataUri) uniquement pour la personne qui a réellement établi / validé le document.
const path = require('path');
const multer = require('multer');
const db = require('../config/database');
const storage = require('../services/StorageService');
const { TYPES } = require('./logoUpload');
const { sniff } = require('./userAvatar');

const MAX_SIZE = 1024 * 1024;
const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

/** Middleware Express : champ multipart « signature » → req.file */
function signatureMiddleware(req, res, next) {
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_SIZE },
    fileFilter: (r, file, cb) => (TYPES[file.mimetype] ? cb(null, true) : cb(fail(400, 'SIGNATURE_TYPE', 'Signature : formats acceptés PNG, JPG ou WEBP'))),
  }).single('signature')(req, res, (err) => {
    if (err) {
      const tooLarge = err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({ success: false, code: tooLarge ? 'SIGNATURE_TOO_LARGE' : err.code || 'SIGNATURE_TYPE', message: tooLarge ? 'Signature trop volumineuse (1 Mo maximum)' : err.message });
    }
    next();
  });
}

/** Remplace la signature de l'utilisateur ; l'ancien fichier est supprimé (le bucket est versionné). → { signatureVersion } */
async function setSignature(userId, file) {
  if (!file) throw fail(400, 'SIGNATURE_REQUIRED', 'Choisissez ou dessinez une signature');
  const type = sniff(file.buffer);
  if (!type) throw fail(400, 'SIGNATURE_TYPE', 'Signature : formats acceptés PNG, JPG ou WEBP');
  const user = await db.one('SELECT id, signature_path FROM users WHERE id = $1', [userId]);
  if (!user) throw fail(404, 'NOT_FOUND', 'Utilisateur introuvable');
  const key = await storage.put(path.posix.join('user-signatures', `${user.id}_${Date.now()}${TYPES[type]}`), file.buffer, type);
  const row = await db.one(
    'UPDATE users SET signature_path = $2, signature_updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING signature_updated_at',
    [user.id, key]
  );
  if (user.signature_path && user.signature_path !== key) await storage.remove(user.signature_path).catch(() => {});
  return { signatureVersion: row.signature_updated_at };
}

async function removeSignature(userId) {
  const user = await db.one('SELECT signature_path FROM users WHERE id = $1', [userId]);
  if (!user) throw fail(404, 'NOT_FOUND', 'Utilisateur introuvable');
  await db.exec('UPDATE users SET signature_path = NULL, signature_updated_at = NULL WHERE id = $1', [userId]);
  if (user.signature_path) await storage.remove(user.signature_path).catch(() => {});
  return { signatureVersion: null };
}

/** Envoie la signature ; 404 si absente */
async function sendSignature(res, userId) {
  const user = await db.one('SELECT signature_path FROM users WHERE id = $1', [userId]);
  const key = user?.signature_path;
  const sent = key && await storage.send(res, key, {
    contentType: MIME_BY_EXT[path.extname(key).toLowerCase()],
    cacheControl: 'private, max-age=86400',
  });
  if (!sent) res.status(404).json({ success: false, code: 'NO_SIGNATURE', message: 'Aucune signature' });
}

/** Signature en data URI pour un PDF (null si l'utilisateur n'en a pas ou si le fichier est illisible) */
async function signatureDataUri(userId) {
  if (!userId) return null;
  try {
    const user = await db.one('SELECT signature_path FROM users WHERE id = $1', [userId]);
    const key = user?.signature_path;
    const mime = key && MIME_BY_EXT[path.extname(key).toLowerCase()];
    if (!mime) return null;
    const buffer = await storage.getBuffer(key);
    return buffer ? `data:${mime};base64,${buffer.toString('base64')}` : null;
  } catch (error) {
    console.error('Signature (PDF) :', error.message);
    return null;
  }
}

/** Plusieurs signatures d'un coup : { [userId]: dataUri | null } */
async function signatureDataUris(userIds) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))];
  const uris = await Promise.all(ids.map(signatureDataUri));
  return Object.fromEntries(ids.map((id, i) => [id, uris[i]]));
}

module.exports = { signatureMiddleware, setSignature, removeSignature, sendSignature, signatureDataUri, signatureDataUris };
