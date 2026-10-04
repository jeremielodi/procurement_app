// backend/src/utils/logoUpload.js
// Logos (entreprises, fournisseurs) : PNG/JPG/WEBP ≤ 2 Mo, stockés via StorageService (MinIO ou disque).
const path = require('path');
const multer = require('multer');
const storage = require('../services/StorageService');

const TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/** Middleware Express : champ multipart « logo » optionnel → req.file */
function logoMiddleware(req, res, next) {
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (r, file, cb) => (TYPES[file.mimetype] ? cb(null, true) : cb(new Error('Logo : formats acceptés PNG, JPG ou WEBP'))),
  }).single('logo')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'Logo trop volumineux (2 Mo maximum)' : err.message;
      return res.status(400).json({ success: false, message });
    }
    next();
  });
}

/** Enregistre le logo sous <dir>/<prefix>_<horodatage>.<ext> ; renvoie la clé */
async function saveLogo(file, dir, prefix) {
  const name = `${String(prefix).replace(/[^\w-]+/g, '_')}_${Date.now()}${TYPES[file.mimetype]}`;
  return storage.put(path.posix.join(dir, name), file.buffer, file.mimetype);
}

async function removeLogo(key) {
  if (key) await storage.remove(key);
}

/** Envoie le logo (route publique) ; 404 si absent */
async function sendLogo(res, key) {
  const sent = key && await storage.send(res, key, {
    contentType: MIME_BY_EXT[path.extname(key).toLowerCase()],
    cacheControl: 'public, max-age=300',
  });
  if (!sent) res.status(404).end();
}

/** Logo en data URI (embarqué dans les PDF générés par Puppeteer) ; null si absent */
async function logoDataUri(key) {
  if (!key) return null;
  const mime = MIME_BY_EXT[path.extname(key).toLowerCase()];
  if (!mime) return null;
  const buffer = await storage.getBuffer(key);
  return buffer ? `data:${mime};base64,${buffer.toString('base64')}` : null;
}

module.exports = { logoMiddleware, saveLogo, removeLogo, sendLogo, logoDataUri };
