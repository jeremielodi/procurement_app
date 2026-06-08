// backend/src/routes/upload.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');

// Configuration multer avec année et mois
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    
    // Créer le chemin avec année et mois: uploads/2026/06/
    const baseUploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
    const uploadDir = path.join(baseUploadDir, String(year), month);
    
    // Créer le répertoire s'il n'existe pas
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Générer un nom unique avec timestamp
    const timestamp = Date.now();
    const uniqueName = `${timestamp}_${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /pdf|doc|docx|xls|xlsx|jpg|jpeg|png|zip|rar|7z/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  
  if (mimetype && extname) {
    cb(null, true);
  } else {
    cb(new Error('Type de fichier non supporté. Types acceptés: PDF, DOC, DOCX, XLS, XLSX, JPG, JPEG, PNG, ZIP, RAR, 7Z'));
  }
};

const upload = multer({
  storage: storage,
  limits: { 
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: fileFilter
});

// Upload d'un fichier
router.post('/', upload.single('file'), async (req, res) => {
  try {
    const { entity_type, entity_id } = req.body;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ success: false, message: 'Aucun fichier' });
    }
    
    // Extraire le chemin relatif (sans le répertoire de base)
    const relativePath = path.relative(
      process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'),
      file.path
    );
    
    const result = await db.insert('attachments', {
      entity_type,
      entity_id,
      file_name: file.originalname,
      file_path: relativePath,
      file_size: file.size,
      mime_type: file.mimetype,
      uploaded_by: req.user.id,
      uploaded_at: new Date()
    });
    
    res.json({
      success: true,
      data: {
        id: result.id,
        file_name: file.originalname,
        file_size: file.size,
        mime_type: file.mimetype,
        file_path: relativePath,
        uploaded_at: new Date()
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Upload multiple fichiers
router.post('/multiple', upload.array('files', 10), async (req, res) => {
  try {
    const { entity_type, entity_id } = req.body;
    const files = req.files;
    
    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, message: 'Aucun fichier' });
    }
  
    const results = [];
    for (const file of files) {
      const relativePath = path.relative(
        process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'),
        file.path
      );
      
      const result = await db.insert('attachments', {
        id: uuidv4(),
        entity_type,
        entity_id,
        file_name: file.originalname,
        file_path: relativePath,
        file_size: file.size,
        mime_type: file.mimetype,
        uploaded_by: req.user.id,
        uploaded_at: new Date()
      });
      results.push(result);
    }
    
    res.json({
      success: true,
      data: results.map(r => ({
        id: r.id,
        file_name: r.file_name,
        file_size: r.file_size,
        mime_type: r.mime_type
      }))
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

// Télécharger un fichier
router.get('/download/file/:id', async (req, res) => {
  try {
   
    const file = await db.one('SELECT * FROM attachments WHERE id = $1', [req.params.id]);
    if (!file) {
      return res.status(404).json({ success: false, message: 'Fichier non trouvé' });
    }
    
    
    const baseUploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
    const filePath = path.join(baseUploadDir, file.file_path);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Fichier non trouvé sur le disque' });
    }
    
    res.download(filePath, file.file_name);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Supprimer un fichier
router.delete('/:id', async (req, res) => {
  try {
    const file = await db.one('SELECT * FROM attachments WHERE id = $1', [req.params.id]);
    if (!file) {
      return res.status(404).json({ success: false, message: 'Fichier non trouvé' });
    }
    
    // Supprimer le fichier physique
    const baseUploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
    const filePath = path.join(baseUploadDir, file.file_path);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    // Supprimer la base de données
    await db.delete('attachments', 'id', file.id);
    
    res.json({ success: true, message: 'Fichier supprimé' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;