// backend/src/utils/userAvatar.js
// Photo de profil (migration 31_user_avatars.sql) : PNG / JPG / WEBP ≤ 2 Mo (le navigateur la recadre en carré
// 256 px avant l'envoi), stockée via StorageService sous user-avatars/, jamais servie en statique.
const path = require('path');
const multer = require('multer');
const db = require('../config/database');
const storage = require('../services/StorageService');
const { TYPES } = require('./logoUpload');

const MAX_SIZE = 2 * 1024 * 1024;
const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

// Signature réelle du fichier (le type annoncé par le navigateur ne suffit pas)
function sniff(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

/** Middleware Express : champ multipart « avatar » obligatoire → req.file */
function avatarMiddleware(req, res, next) {
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_SIZE },
    fileFilter: (r, file, cb) => (TYPES[file.mimetype] ? cb(null, true) : cb(fail(400, 'AVATAR_TYPE', 'Photo : formats acceptés PNG, JPG ou WEBP'))),
  }).single('avatar')(req, res, (err) => {
    if (err) {
      const tooLarge = err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({ success: false, code: tooLarge ? 'AVATAR_TOO_LARGE' : err.code || 'AVATAR_TYPE', message: tooLarge ? 'Photo trop volumineuse (2 Mo maximum)' : err.message });
    }
    next();
  });
}

/** Remplace la photo de l'utilisateur ; l'ancien fichier est supprimé (le bucket est versionné). → { avatarVersion } */
async function setAvatar(userId, file) {
  if (!file) throw fail(400, 'AVATAR_REQUIRED', 'Choisissez une photo');
  const type = sniff(file.buffer);
  if (!type) throw fail(400, 'AVATAR_TYPE', 'Photo : formats acceptés PNG, JPG ou WEBP');
  const user = await db.one('SELECT id, avatar_path FROM users WHERE id = $1', [userId]);
  if (!user) throw fail(404, 'NOT_FOUND', 'Utilisateur introuvable');
  const key = await storage.put(path.posix.join('user-avatars', `${user.id}_${Date.now()}${TYPES[type]}`), file.buffer, type);
  const row = await db.one(
    'UPDATE users SET avatar_path = $2, avatar_updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING avatar_updated_at',
    [user.id, key]
  );
  if (user.avatar_path && user.avatar_path !== key) await storage.remove(user.avatar_path).catch(() => {});
  return { avatarVersion: row.avatar_updated_at };
}

/** Retire la photo (retour aux initiales) */
async function removeAvatar(userId) {
  const user = await db.one('SELECT avatar_path FROM users WHERE id = $1', [userId]);
  if (!user) throw fail(404, 'NOT_FOUND', 'Utilisateur introuvable');
  await db.exec('UPDATE users SET avatar_path = NULL, avatar_updated_at = NULL WHERE id = $1', [userId]);
  if (user.avatar_path) await storage.remove(user.avatar_path).catch(() => {});
  return { avatarVersion: null };
}

/** Envoie la photo ; 404 si absente. Cache privé : l'URL du client change avec la version (?v=) */
async function sendAvatar(res, userId) {
  const user = await db.one('SELECT avatar_path FROM users WHERE id = $1', [userId]);
  const key = user?.avatar_path;
  const sent = key && await storage.send(res, key, {
    contentType: MIME_BY_EXT[path.extname(key).toLowerCase()],
    cacheControl: 'private, max-age=86400',
  });
  if (!sent) res.status(404).json({ success: false, code: 'NO_AVATAR', message: 'Aucune photo' });
}

module.exports = { avatarMiddleware, setAvatar, removeAvatar, sendAvatar, sniff };
