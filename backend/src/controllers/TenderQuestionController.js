// backend/src/controllers/TenderQuestionController.js
// Questions aux fournisseurs (migration 54) : bibliothèque de l'entreprise, documents joints aux réponses
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const templateModel = require('../models/TenderQuestionTemplateModel');
const tenderModel = require('../models/TenderModel');
const storage = require('../services/StorageService');
const { normalizeQuestion } = require('../utils/tenderQuestions');
const { getSupplierByUser } = require('./SupplierPortalController');

const MAX_FILE_SIZE = 10 * 1024 * 1024;
// Document de réponse : PDF, image, Word, Excel
const FILE_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx', '.xls', '.xlsx'];

const fail = (status, code, message, details) => Object.assign(new Error(message), { status, code, details });

function sendError(res, error) {
  if (error.status) return res.status(error.status).json({ success: false, code: error.code, message: error.message, details: error.details });
  console.error('[TenderQuestion]', error);
  return res.status(500).json({ success: false, message: error.message });
}

/** Middleware : un fichier « file » (document de réponse) */
function answerFileMiddleware(req, res, next) {
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (r, file, cb) => (FILE_EXTENSIONS.includes(path.extname(file.originalname || '').toLowerCase())
      ? cb(null, true)
      : cb(fail(400, 'ANSWER_FILE_TYPE', 'Formats acceptés : PDF, JPG, PNG, Word ou Excel'))),
  }).single('file')(req, res, (err) => {
    if (!err) return next();
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    res.status(400).json({
      success: false,
      code: tooLarge ? 'ANSWER_FILE_TOO_LARGE' : (err.code || 'ANSWER_FILE_TYPE'),
      message: tooLarge ? 'Document trop volumineux (10 Mo maximum)' : err.message,
    });
  });
}

/** Les réponses restent scellées comme les prix tant que les soumissions sont ouvertes */
const sealed = (tender) => ['OPEN', 'UPCOMING'].includes(tender.effective_status);

class TenderQuestionController {
  constructor() {
    this.handleAnswerFile = answerFileMiddleware;
  }

  // ---------- Bibliothèque de l'entreprise (MANAGE_TENDERS) ----------

  /** GET /tender-question-templates[?all=1] */
  async listTemplates(req, res) {
    try {
      res.json({ success: true, data: await templateModel.list({ all: req.query.all === '1' }) });
    } catch (error) {
      sendError(res, error);
    }
  }

  /** POST /tender-question-templates { label, helpText, answerType, options, required } */
  async createTemplate(req, res) {
    try {
      const q = normalizeQuestion(req.body);
      const { id } = await templateModel.create(q, { enterpriseId: req.enterpriseId, userId: req.user.id });
      res.status(201).json({ success: true, data: await templateModel.getById(id), message: 'Question ajoutée à la bibliothèque' });
    } catch (error) {
      sendError(res, error);
    }
  }

  /** PUT /tender-question-templates/:id { …, isActive } */
  async updateTemplate(req, res) {
    try {
      const existing = await templateModel.getById(req.params.id);
      if (!existing) throw fail(404, 'NOT_FOUND', 'Question introuvable');
      const q = normalizeQuestion(req.body);
      const isActive = typeof req.body.isActive === 'boolean' ? req.body.isActive : null;
      await templateModel.update(existing.id, q, isActive);
      res.json({ success: true, data: await templateModel.getById(existing.id), message: 'Question mise à jour' });
    } catch (error) {
      sendError(res, error);
    }
  }

  /** DELETE /tender-question-templates/:id — les AO qui l'ont reprise gardent leur copie */
  async deleteTemplate(req, res) {
    try {
      const existing = await templateModel.getById(req.params.id);
      if (!existing) throw fail(404, 'NOT_FOUND', 'Question introuvable');
      await templateModel.remove(existing.id);
      res.json({ success: true, message: 'Question supprimée de la bibliothèque' });
    } catch (error) {
      sendError(res, error);
    }
  }

  // ---------- Documents de réponse ----------

  /**
   * POST /supplier-portal/tenders/:id/questions/:questionId/file (multipart « file »)
   * Le document est déposé avant l'envoi de l'offre, puis cité par son id dans les réponses (fileId).
   */
  async uploadAnswerFile(req, res) {
    try {
      const supplier = await getSupplierByUser(req.user.id);
      if (!supplier) throw fail(403, 'NOT_A_SUPPLIER', 'Compte non lié à un fournisseur');
      if (supplier.status !== 'ACTIVE') throw fail(403, 'SUPPLIER_INACTIVE', 'Votre compte fournisseur n\'est pas actif');
      const tender = await tenderModel.getById(req.params.id);
      if (!tender || tender.status === 'CANCELLED' || !(await tenderModel.isSupplierEligible(supplier.id, tender.id))) {
        throw fail(404, 'NOT_FOUND', 'Appel d\'offres introuvable');
      }
      if (tender.effective_status !== 'OPEN') throw fail(400, 'TENDER_NOT_OPEN', 'Les soumissions ne sont pas ouvertes');
      const question = (await tenderModel.getQuestions(tender.id)).find(q => String(q.id) === String(req.params.questionId));
      if (!question || question.answer_type !== 'FILE') throw fail(400, 'QUESTION_NOT_FILE', 'Cette question n\'attend pas de document');
      if (!req.file) throw fail(400, 'ANSWER_FILE_REQUIRED', 'Choisissez un document');

      const ext = path.extname(req.file.originalname).toLowerCase();
      const key = await storage.put(
        path.posix.join('tender-answers', String(tender.id), `${Date.now()}_${crypto.randomUUID()}${ext}`),
        req.file.buffer, req.file.mimetype
      );
      const row = await tenderModel.addAnswerFile({
        tenderId: tender.id, questionId: question.id, supplierId: supplier.id, filePath: key,
        fileName: req.file.originalname, mimeType: req.file.mimetype, fileSize: req.file.size, userId: req.user.id,
      });
      res.status(201).json({ success: true, data: row });
    } catch (error) {
      sendError(res, error);
    }
  }

  /** GET /supplier-portal/tenders/:id/answer-files/:fileId — un de ses propres documents */
  async getMyAnswerFile(req, res) {
    try {
      const supplier = await getSupplierByUser(req.user.id);
      if (!supplier) throw fail(403, 'NOT_A_SUPPLIER', 'Compte non lié à un fournisseur');
      const file = await tenderModel.getAnswerFile(req.params.id, req.params.fileId);
      if (!file || file.supplier_id !== supplier.id) throw fail(404, 'NOT_FOUND', 'Document introuvable');
      await this.send(res, file);
    } catch (error) {
      sendError(res, error);
    }
  }

  /** GET /tenders/:id/answer-files/:fileId — acheteur, après la clôture seulement */
  async getAnswerFile(req, res) {
    try {
      const tender = await tenderModel.getById(req.params.id);
      if (!tender) throw fail(404, 'NOT_FOUND', 'Appel d\'offres introuvable');
      if (sealed(tender)) throw fail(403, 'ANSWERS_SEALED', 'Offres scellées : les réponses seront visibles après la clôture');
      const file = await tenderModel.getAnswerFile(tender.id, req.params.fileId);
      if (!file) throw fail(404, 'NOT_FOUND', 'Document introuvable');
      await this.send(res, file);
    } catch (error) {
      sendError(res, error);
    }
  }

  async send(res, file) {
    const sent = await storage.send(res, file.file_path, { fileName: file.file_name, contentType: file.mime_type, inline: true });
    if (!sent && !res.headersSent) res.status(404).json({ success: false, message: 'Fichier introuvable dans le stockage' });
  }
}

module.exports = new TenderQuestionController();
