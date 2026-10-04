// backend/src/utils/logoUpload.js
// Upload de logo (PNG/JPG/WEBP ≤ 2 Mo) : multer en mémoire, écriture sur disque après validation.
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

function baseDir() {
  return path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));
}

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

/** Écrit le logo dans UPLOAD_DIR/<dir>/ et renvoie le chemin relatif */
function saveLogo(file, dir, prefix) {
  const target = path.join(baseDir(), dir);
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
  const name = `${String(prefix).replace(/[^\w-]+/g, '_')}_${Date.now()}${TYPES[file.mimetype]}`;
  fs.writeFileSync(path.join(target, name), file.buffer);
  return path.posix.join(dir, name);
}

function removeLogo(relPath) {
  if (!relPath) return;
  const file = path.resolve(baseDir(), relPath);
  if (file.startsWith(baseDir())) fs.rmSync(file, { force: true });
}

/** Envoie le logo (route publique) ; 404 si absent */
function sendLogo(res, relPath) {
  if (!relPath) return res.status(404).end();
  const file = path.resolve(baseDir(), relPath);
  if (!file.startsWith(baseDir()) || !fs.existsSync(file)) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=300');
  return res.sendFile(file);
}

module.exports = { logoMiddleware, saveLogo, removeLogo, sendLogo };
