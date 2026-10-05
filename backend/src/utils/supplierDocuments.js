// backend/src/utils/supplierDocuments.js
// Documents de préqualification des fournisseurs, stockés via StorageService (supplier-documents/…).
// Tous FACULTATIFS : un fournisseur peut ne pas fournir un document ; l'acheteur voit ce qui manque.
//  - Attendus pour une entreprise : pièce d'identité (du représentant), RCCM, attestation fiscale, ID Nat, RIB
//  - Attendus pour une personne physique : pièce d'identité, RIB
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const storage = require('../services/StorageService');
const { TYPES: LOGO_TYPES } = require('./logoUpload');

const MAX_SIZE = 5 * 1024 * 1024;
const DOC_DIR = 'supplier-documents';

const DOC_LABELS = {
  ID_CARD: "Pièce d'identité",
  RCCM: 'RCCM',
  TAX: 'Attestation fiscale (n° impôt)',
  ID_NAT: 'Identification nationale (ID Nat)',
  RIB: 'RIB (relevé d\'identité bancaire)',
};
const DOC_TYPES = Object.keys(DOC_LABELS);

const EXPECTED_DOCS = {
  COMPANY: ['ID_CARD', 'RCCM', 'TAX', 'ID_NAT', 'RIB'],
  INDIVIDUAL: ['ID_CARD', 'RIB'],
};

// PDF pour tous les documents ; la pièce d'identité peut aussi être une photo
const PDF = { 'application/pdf': '.pdf' };
const IMAGES = { 'image/jpeg': '.jpg', 'image/png': '.png' };
const allowedTypes = (docType) => (docType === 'ID_CARD' ? { ...PDF, ...IMAGES } : PDF);

const FIELD_PREFIX = 'doc_';

/**
 * Middleware multipart : champ « logo » (image) + champs « doc_<TYPE> » → req.files = { logo:[…], doc_RCCM:[…] }
 * Les erreurs de format / taille répondent 400.
 */
function supplierFilesMiddleware(req, res, next) {
  const fields = [{ name: 'logo', maxCount: 1 }, ...DOC_TYPES.map(t => ({ name: FIELD_PREFIX + t, maxCount: 1 }))];
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_SIZE },
    fileFilter: (r, file, cb) => {
      if (file.fieldname === 'logo') {
        return LOGO_TYPES[file.mimetype] ? cb(null, true) : cb(new Error('Logo : formats acceptés PNG, JPG ou WEBP'));
      }
      const docType = file.fieldname.slice(FIELD_PREFIX.length);
      if (allowedTypes(docType)[file.mimetype]) return cb(null, true);
      cb(new Error(`${DOC_LABELS[docType] || 'Document'} : ${docType === 'ID_CARD' ? 'PDF, JPG ou PNG' : 'fichier PDF'} attendu`));
    },
  }).fields(fields)(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux (5 Mo maximum par document, 2 Mo pour le logo)' : err.message;
      return res.status(400).json({ success: false, message });
    }
    // Le logo garde sa limite historique de 2 Mo
    const logo = req.files?.logo?.[0];
    if (logo && logo.size > 2 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'Logo trop volumineux (2 Mo maximum)' });
    }
    req.file = logo; // compatibilité saveLogo(req.file, …)
    next();
  });
}

/** Middleware : un seul fichier « file » (remplacement d'un document) ; le type est dans req.params.type */
function singleDocumentMiddleware(req, res, next) {
  const docType = String(req.params.type || '').toUpperCase();
  if (!DOC_TYPES.includes(docType)) return res.status(400).json({ success: false, message: 'Type de document inconnu' });
  req.params.type = docType;
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_SIZE },
    fileFilter: (r, file, cb) => (allowedTypes(docType)[file.mimetype]
      ? cb(null, true)
      : cb(new Error(`${DOC_LABELS[docType]} : ${docType === 'ID_CARD' ? 'PDF, JPG ou PNG' : 'fichier PDF'} attendu`))),
  }).single('file')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux (5 Mo maximum)' : err.message;
      return res.status(400).json({ success: false, message });
    }
    if (!req.file) return res.status(400).json({ success: false, message: 'Aucun fichier reçu' });
    next();
  });
}

/** Fichiers de documents reçus par supplierFilesMiddleware : { RCCM: file, … } */
function documentsFromRequest(req) {
  const out = {};
  for (const t of DOC_TYPES) {
    const f = req.files?.[FIELD_PREFIX + t]?.[0];
    if (f) out[t] = f;
  }
  return out;
}

/** Enregistre le fichier dans le stockage ; renvoie les colonnes de supplier_documents (hors supplier_id) */
async function storeDocument(file, supplierCode, docType) {
  const ext = allowedTypes(docType)[file.mimetype] || path.extname(file.originalname || '').toLowerCase();
  const key = path.posix.join(DOC_DIR, String(supplierCode).replace(/[^\w-]+/g, '_'),
    `${docType}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}${ext}`);
  await storage.put(key, file.buffer, file.mimetype);
  return {
    doc_type: docType,
    file_path: key,
    file_name: String(file.originalname || `${docType}${ext}`).slice(0, 255),
    mime_type: file.mimetype,
    file_size: file.size,
  };
}

/** Documents attendus non fournis pour ce type de fournisseur (types) — information, jamais bloquant */
function missingDocuments(supplierType, presentTypes) {
  const have = new Set(presentTypes);
  return (EXPECTED_DOCS[supplierType] || EXPECTED_DOCS.COMPANY).filter(t => !have.has(t));
}

module.exports = {
  DOC_TYPES, DOC_LABELS, EXPECTED_DOCS,
  supplierFilesMiddleware, singleDocumentMiddleware, documentsFromRequest, storeDocument, missingDocuments,
};
