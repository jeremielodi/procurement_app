// backend/src/routes/upload.js
// Pièces jointes : fichiers stockés via StorageService (MinIO ou disque), métadonnées dans « attachments ».
// Les fichiers ne sont jamais servis directement : téléchargement par l'API (authentifié, cloisonné par entreprise).
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const storage = require('../services/StorageService');
const { attachmentEntityAllowed } = require('../middleware/tenant');

const ALLOWED = /pdf|doc|docx|xls|xlsx|jpg|jpeg|png|zip|rar|7z/;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 Mo
  fileFilter: (req, file, cb) => {
    const extOk = ALLOWED.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = ALLOWED.test(file.mimetype);
    if (extOk && mimeOk) return cb(null, true);
    cb(new Error('Type de fichier non supporté. Types acceptés: PDF, DOC, DOCX, XLS, XLSX, JPG, JPEG, PNG, ZIP, RAR, 7Z'));
  }
});

// Erreurs multer (taille, type) → 400 lisible
const handle = (mw) => (req, res, next) => mw(req, res, (err) => {
  if (!err) return next();
  const message = err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux (10 Mo maximum)' : err.message;
  return res.status(400).json({ success: false, message });
});

// Clé de stockage : année/mois/horodatage_uuid.ext (même format que l'ancien stockage disque)
function storageKey(originalName) {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}/${month}/${Date.now()}_${uuidv4()}${path.extname(originalName).toLowerCase()}`;
}

async function storeAttachment(file, { entity_type, entity_id }, userId) {
  const key = await storage.put(storageKey(file.originalname), file.buffer, file.mimetype);
  const id = uuidv4(); // attachments.id n'a pas de valeur par défaut
  try {
    await db.insert('attachments', {
      id,
      entity_type,
      entity_id,
      file_name: file.originalname,
      file_path: key,
      file_size: file.size,
      mime_type: file.mimetype,
      uploaded_by: userId,
      uploaded_at: new Date()
    });
  } catch (e) {
    await storage.remove(key); // pas de fichier orphelin si l'enregistrement échoue
    throw e;
  }
  return db.one('SELECT * FROM attachments WHERE id = $1', [id]);
}

async function checkEntity(req, res) {
  const { entity_type, entity_id } = req.body;
  if (!(await attachmentEntityAllowed(req, entity_type, entity_id))) {
    res.status(404).json({ success: false, message: 'Ressource introuvable' });
    return false;
  }
  return true;
}

// Upload d'un fichier
router.post('/', handle(upload.single('file')), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Aucun fichier' });
    if (!(await checkEntity(req, res))) return;
    const row = await storeAttachment(req.file, req.body, req.user.id);
    res.json({
      success: true,
      data: {
        id: row.id,
        file_name: row.file_name,
        file_size: row.file_size,
        mime_type: row.mime_type,
        file_path: row.file_path,
        uploaded_at: row.uploaded_at
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Upload multiple fichiers
router.post('/multiple', handle(upload.array('files', 10)), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ success: false, message: 'Aucun fichier' });
    if (!(await checkEntity(req, res))) return;
    const results = [];
    for (const file of req.files) {
      results.push(await storeAttachment(file, req.body, req.user.id));
    }
    res.json({
      success: true,
      data: results.map(r => ({ id: r.id, file_name: r.file_name, file_size: r.file_size, mime_type: r.mime_type }))
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Récupérer les fichiers d'une entité
router.get('/:entity_type/:entity_id', async (req, res) => {
  try {
    const { entity_type, entity_id } = req.params;
    const files = await db.select(
      'SELECT * FROM attachments WHERE entity_type = $1 AND entity_id = $2 ORDER BY uploaded_at DESC',
      [entity_type, entity_id]
    );
    res.json({ success: true, data: files });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Télécharger un fichier (flux depuis le stockage)
router.get('/download/file/:id', async (req, res) => {
  try {
    const file = await db.one('SELECT * FROM attachments WHERE id = $1', [req.params.id]);
    if (!file) return res.status(404).json({ success: false, message: 'Fichier non trouvé' });
    const sent = await storage.send(res, file.file_path, { fileName: file.file_name, contentType: file.mime_type });
    if (!sent) res.status(404).json({ success: false, message: 'Fichier non trouvé dans le stockage' });
  } catch (error) {
    console.error('Download error:', error);
    if (!res.headersSent) res.status(500).json({ success: false, message: error.message });
  }
});

// Supprimer un fichier
router.delete('/:id', async (req, res) => {
  try {
    const file = await db.one('SELECT * FROM attachments WHERE id = $1', [req.params.id]);
    if (!file) return res.status(404).json({ success: false, message: 'Fichier non trouvé' });
    await storage.remove(file.file_path);
    await db.delete('attachments', 'id', file.id);
    res.json({ success: true, message: 'Fichier supprimé' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
