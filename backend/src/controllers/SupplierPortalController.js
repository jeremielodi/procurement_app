// backend/src/controllers/SupplierPortalController.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const i18n = require('../i18n');
const userModel = require('../models/UserModel');
const { audit, AUDIT } = require('../utils/auditLog');
const supplierModel = require('../models/SupplierModel');
const referenceModel = require('../models/ReferenceModel');
const notificationModel = require('../models/NotificationModel');
const storage = require('../services/StorageService');
const supplierBankService = require('../services/SupplierBankService');
const { saveLogo, removeLogo, sendLogo } = require('../utils/logoUpload');
const {
  supplierFilesMiddleware, documentsFromRequest, storeDocument,
} = require('../utils/supplierDocuments');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const LOGO_DIR = 'supplier-logos';

async function generateSupplierCode() {
  const year = new Date().getFullYear();
  const row = await db.one(
    `SELECT COALESCE(MAX(CAST(SPLIT_PART(supplier_code, '-', 3) AS INTEGER)), 0) AS max_seq
     FROM suppliers WHERE supplier_code ~ $1`,
    [`^SUP-${year}-[0-9]+$`]
  );
  return `SUP-${year}-${String(parseInt(row.max_seq) + 1).padStart(4, '0')}`;
}

async function getSupplierByUser(userId) {
  return db.one('SELECT * FROM suppliers WHERE user_id = $1', [userId]);
}

/** Liste d'ids envoyée en multipart : "[1,2]", "1,2", ou champ répété */
function parseIdList(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap(parseIdList);
  const s = String(value).trim();
  if (s.startsWith('[')) {
    try { return JSON.parse(s).map(Number).filter(Number.isInteger); } catch { return []; }
  }
  return s.split(',').map(v => parseInt(v.trim())).filter(Number.isInteger);
}

const blank = (v) => !String(v ?? '').trim();
const typeOf = (v) => (v === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'COMPANY');

/**
 * Champs texte obligatoires selon le type :
 *  - Entreprise : raison sociale, contact, RCCM, n° impôt, ID Nat, téléphone, adresse, banque + n° de compte
 *  - Personne physique : nom complet, adresse, banque + n° de compte
 */
function identityErrors(b, type) {
  const errors = [];
  if (type === 'COMPANY') {
    if (blank(b.name)) errors.push("Raison sociale requise");
    if (blank(b.contactName)) errors.push('Nom du contact requis');
    if (blank(b.registrationNumber)) errors.push('N° RCCM requis');
    if (blank(b.taxId)) errors.push("N° d'impôt requis");
    if (blank(b.idNat)) errors.push('N° ID Nat requis');
    if (blank(b.phone)) errors.push('Téléphone requis');
  } else if (blank(b.name)) {
    errors.push('Nom complet requis');
  }
  if (blank(b.address)) errors.push('Adresse requise');
  if (blank(b.bankName)) errors.push('Banque (RIB) requise');
  if (blank(b.bankAccount)) errors.push('N° de compte bancaire (RIB) requis');
  return errors;
}

async function notifyBuyers(io, title, message) {
  const buyers = await db.select(`SELECT DISTINCT up.user_id FROM user_profiles up WHERE up.profile_id = 'prof_procurement'`, []);
  for (const buyer of buyers) {
    await notificationModel.create({ userId: buyer.user_id, title, message, type: 'INFO', link: '/suppliers' });
    io?.to(`user-${buyer.user_id}`).emit('notification', { title, message, type: 'INFO', link: '/suppliers' });
  }
}

class SupplierPortalController {
  constructor() {
    // Logo + documents (doc_ID_CARD, doc_RCCM, doc_TAX, doc_ID_NAT, doc_RIB)
    this.handleLogoUpload = supplierFilesMiddleware;
    this.handleFiles = supplierFilesMiddleware;
  }

  /**
   * POST /api/auth/register-supplier (public, multipart/form-data)
   * Crée : users + user_profiles (prof_supplier) + suppliers + localisations + catégories + documents (facultatifs),
   * puis renvoie un token.
   */
  async register(req, res) {
    const storedKeys = [];
    try {
      const b = req.body;
      const type = typeOf(b.supplierType);
      const email = (b.email || '').trim().toLowerCase();
      if (email && await db.one('SELECT id FROM users WHERE LOWER(email) = $1', [email])) {
        return res.status(409).json({ success: false, message: 'Un compte existe déjà avec cet email' });
      }
      const errors = identityErrors(b, type);
      if (!/^\S+@\S+\.\S+$/.test(email)) errors.push('Email invalide');
      if (!b.password || b.password.length < 8) errors.push('Mot de passe : 8 caractères minimum');

      const locationIds = await referenceModel.validActiveIds('locations', parseIdList(b.locationIds));
      const categoryIds = await referenceModel.validActiveIds('market_categories', parseIdList(b.categoryIds));
      if (!locationIds.length) errors.push('Sélectionnez au moins une localisation');
      if (!categoryIds.length) errors.push('Sélectionnez au moins une catégorie de marché');

      // Documents facultatifs : le fournisseur peut en compléter ou en ajouter plus tard depuis son profil
      const files = documentsFromRequest(req);
      if (errors.length) return res.status(400).json({ success: false, message: errors.join(' · ') });

      const userId = uuidv4();
      const supplierCode = await generateSupplierCode();
      const passwordHash = await bcrypt.hash(b.password, 10);
      const username = `${email.split('@')[0].slice(0, 40)}_${userId.slice(0, 6)}`;
      const contactName = (type === 'INDIVIDUAL' ? b.name : b.contactName).trim();
      const [firstName, ...rest] = contactName.split(/\s+/);

      // Fichiers d'abord (supprimés si l'enregistrement en base échoue)
      const logoPath = req.file ? await saveLogo(req.file, LOGO_DIR, supplierCode) : null;
      if (logoPath) storedKeys.push(logoPath);
      const documents = [];
      for (const [docType, file] of Object.entries(files)) {
        const doc = await storeDocument(file, supplierCode, docType);
        storedKeys.push(doc.file_path);
        documents.push(doc);
      }

      const transaction = db.transaction();
      transaction.addInsertQuery('users', {
        id: userId,
        username,
        email,
        password_hash: passwordHash,
        first_name: firstName,
        last_name: rest.join(' ') || null,
        position: 'Fournisseur',
        // Langue choisie sur la page d'inscription (en-tête Accept-Language envoyé par le client)
        language: i18n.fromRequest(req),
        is_active: true,
        enterprise_id: null, // fournisseur partagé entre toutes les entreprises
        created_at: new Date(),
        updated_at: new Date()
      });
      transaction.addInsertQuery('user_profiles', {
        user_id: userId,
        profile_id: 'prof_supplier',
        assigned_at: new Date(),
        assigned_by: userId
      });
      transaction.addInsertQuery('suppliers', {
        supplier_code: supplierCode,
        supplier_type: type,
        name: b.name.trim(),
        contact_name: contactName,
        registration_number: type === 'COMPANY' ? b.registrationNumber.trim() : null,
        tax_id: type === 'COMPANY' ? b.taxId.trim() : null,
        id_nat: type === 'COMPANY' ? b.idNat.trim() : null,
        id_document_number: b.idDocumentNumber?.trim() || null,
        email,
        phone: b.phone?.trim() || null,
        address: b.address.trim(),
        website: b.website?.trim() || null,
        bank_name: b.bankName.trim(),
        bank_account: b.bankAccount.trim(),
        bank_iban: b.bankIban?.trim() || null,
        bank_swift: b.bankSwift?.trim() || null,
        status: 'ACTIVE',
        prequalified: false,
        due_diligence_completed: false,
        user_id: userId,
        logo_path: logoPath,
        self_registered: true
      });
      await transaction.execute();

      const supplier = await getSupplierByUser(userId);
      await supplierModel.setLocations(supplier.id, locationIds);
      await supplierModel.setCategories(supplier.id, categoryIds);
      for (const doc of documents) await supplierModel.saveDocument(supplier.id, doc, userId);
      storedKeys.length = 0; // tout est référencé en base

      await notifyBuyers(req.io, 'Nouveau fournisseur inscrit',
        `${b.name.trim()} (${supplierCode}) s'est inscrit : dossier de préqualification à examiner`);

      // Connexion directe
      const auth = await userModel.authenticate(email, b.password);
      const token = jwt.sign(
        { id: auth.user.id, email: auth.user.email, username: auth.user.username },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      const registered = { id: auth.user.id, email: auth.user.email };
      await audit(req, AUDIT.SUPPLIER_REGISTERED, { actor: registered, target: registered, details: { supplierCode, name: b.name } });
      res.status(201).json({ success: true, data: { token, user: auth.user, supplierCode } });
    } catch (error) {
      for (const key of storedKeys) await storage.remove(key).catch(() => {});
      console.error('Supplier registration error:', error);
      res.status(500).json({ success: false, message: "Erreur lors de l'inscription", error: error.message });
    }
  }

  /** GET /api/public/suppliers/:id/logo (public — utilisé dans <img>) */
  async getLogo(req, res) {
    try {
      const supplier = await db.one('SELECT logo_path FROM suppliers WHERE id = $1', [req.params.id]);
      return sendLogo(res, supplier?.logo_path);
    } catch (error) {
      res.status(500).end();
    }
  }

  /** GET /api/supplier-portal/me — fiche complète (localisations, catégories, documents) */
  async getMe(req, res) {
    try {
      const supplier = await getSupplierByUser(req.user.id);
      if (!supplier) return res.status(404).json({ success: false, message: 'Aucun fournisseur lié à ce compte' });
      res.json({ success: true, data: await supplierModel.getFullProfile(supplier.id) });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /** PUT /api/supplier-portal/me (multipart : logo et documents optionnels) */
  async updateMe(req, res) {
    const storedKeys = [];
    try {
      const supplier = await getSupplierByUser(req.user.id);
      if (!supplier) return res.status(404).json({ success: false, message: 'Aucun fournisseur lié à ce compte' });
      const b = req.body;
      if (b.name !== undefined && blank(b.name)) {
        return res.status(400).json({ success: false, message: 'Nom requis' });
      }
      const fields = { updated_at: new Date() };
      for (const [key, col] of [['name', 'name'], ['contactName', 'contact_name'], ['phone', 'phone'],
        ['address', 'address'], ['website', 'website'], ['taxId', 'tax_id'], ['registrationNumber', 'registration_number'],
        ['idNat', 'id_nat'], ['idDocumentNumber', 'id_document_number'],
        ['bankName', 'bank_name'], ['bankAccount', 'bank_account'], ['bankIban', 'bank_iban'], ['bankSwift', 'bank_swift']]) {
        if (b[key] !== undefined) fields[col] = String(b[key]).trim() === '' ? null : String(b[key]).trim();
      }
      if (b.supplierType !== undefined) fields.supplier_type = typeOf(b.supplierType);

      let locationIds, categoryIds;
      if (b.locationIds !== undefined) {
        locationIds = await referenceModel.validActiveIds('locations', parseIdList(b.locationIds));
        if (!locationIds.length) return res.status(400).json({ success: false, message: 'Sélectionnez au moins une localisation' });
      }
      if (b.categoryIds !== undefined) {
        categoryIds = await referenceModel.validActiveIds('market_categories', parseIdList(b.categoryIds));
        if (!categoryIds.length) return res.status(400).json({ success: false, message: 'Sélectionnez au moins une catégorie de marché' });
      }

      if (req.file) {
        fields.logo_path = await saveLogo(req.file, LOGO_DIR, supplier.supplier_code);
        storedKeys.push(fields.logo_path);
      }
      const documents = [];
      for (const [docType, file] of Object.entries(documentsFromRequest(req))) {
        const doc = await storeDocument(file, supplier.supplier_code, docType);
        storedKeys.push(doc.file_path);
        documents.push(doc);
      }

      await db.update('suppliers', fields, 'id', supplier.id);
      // Changement de coordonnées bancaires : historisé, à vérifier par chaque entreprise avant tout paiement
      await supplierBankService.recordChange(req, supplier, fields, 'PORTAL');
      if (locationIds) await supplierModel.setLocations(supplier.id, locationIds);
      if (categoryIds) await supplierModel.setCategories(supplier.id, categoryIds);
      for (const doc of documents) {
        const old = await supplierModel.saveDocument(supplier.id, doc, req.user.id);
        if (old) await storage.remove(old).catch(() => {});
      }
      storedKeys.length = 0;
      if (fields.logo_path) await removeLogo(supplier.logo_path);

      res.json({ success: true, data: await supplierModel.getFullProfile(supplier.id) });
    } catch (error) {
      for (const key of storedKeys) await storage.remove(key).catch(() => {});
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /** GET /api/supplier-portal/me/documents/:documentId/file — un de ses propres documents */
  async getMyDocument(req, res) {
    try {
      const supplier = await getSupplierByUser(req.user.id);
      if (!supplier) return res.status(404).json({ success: false, message: 'Aucun fournisseur lié à ce compte' });
      return sendDocument(res, await supplierModel.getDocument(supplier.id, req.params.documentId));
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

/** Envoie un document fournisseur (affiché dans le navigateur) ; 404 si absent */
async function sendDocument(res, doc) {
  if (!doc) return res.status(404).json({ success: false, message: 'Document introuvable' });
  const sent = await storage.send(res, doc.file_path, { fileName: doc.file_name, contentType: doc.mime_type, inline: true });
  if (!sent && !res.headersSent) res.status(404).json({ success: false, message: 'Fichier introuvable dans le stockage' });
}

module.exports = new SupplierPortalController();
module.exports.getSupplierByUser = getSupplierByUser;
module.exports.parseIdList = parseIdList;
module.exports.sendDocument = sendDocument;
