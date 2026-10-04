// backend/src/controllers/SupplierPortalController.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const userModel = require('../models/UserModel');
const notificationModel = require('../models/NotificationModel');
const { logoMiddleware, saveLogo, removeLogo, sendLogo } = require('../utils/logoUpload');

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

class SupplierPortalController {
  constructor() {
    this.handleLogoUpload = logoMiddleware;
  }

  /**
   * POST /api/auth/register-supplier (public, multipart/form-data)
   * Crée : users + user_profiles (prof_supplier) + suppliers, puis renvoie un token.
   */
  async register(req, res) {
    try {
      const b = req.body;
      const email = (b.email || '').trim().toLowerCase();
      const errors = [];
      if (!b.name?.trim()) errors.push("Nom de l'entreprise requis");
      if (!b.contactName?.trim()) errors.push('Nom du contact requis');
      if (!/^\S+@\S+\.\S+$/.test(email)) errors.push('Email invalide');
      if (!b.password || b.password.length < 8) errors.push('Mot de passe : 8 caractères minimum');
      if (errors.length) return res.status(400).json({ success: false, message: errors.join(' · ') });

      const exists = await db.one('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
      if (exists) return res.status(409).json({ success: false, message: 'Un compte existe déjà avec cet email' });

      const userId = uuidv4();
      const supplierCode = await generateSupplierCode();
      const passwordHash = await bcrypt.hash(b.password, 10);
      const username = `${email.split('@')[0].slice(0, 40)}_${userId.slice(0, 6)}`;
      const [firstName, ...rest] = b.contactName.trim().split(/\s+/);
      const logoPath = req.file ? await saveLogo(req.file, LOGO_DIR, supplierCode) : null;

      const transaction = db.transaction();
      transaction.addInsertQuery('users', {
        id: userId,
        username,
        email,
        password_hash: passwordHash,
        first_name: firstName,
        last_name: rest.join(' ') || null,
        position: 'Fournisseur',
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
        name: b.name.trim(),
        contact_name: b.contactName.trim(),
        registration_number: b.registrationNumber || null,
        tax_id: b.taxId || null,
        email,
        phone: b.phone || null,
        address: b.address || null,
        website: b.website || null,
        status: 'ACTIVE',
        prequalified: false,
        due_diligence_completed: false,
        user_id: userId,
        logo_path: logoPath,
        self_registered: true
      });
      try {
        await transaction.execute();
      } catch (e) {
        await removeLogo(logoPath);
        throw e;
      }

      // Prévenir les agents d'achat
      const buyers = await db.select(
        `SELECT DISTINCT up.user_id FROM user_profiles up WHERE up.profile_id = 'prof_procurement'`, []
      );
      for (const buyer of buyers) {
        await notificationModel.create({
          userId: buyer.user_id,
          title: 'Nouveau fournisseur inscrit',
          message: `${b.name.trim()} (${supplierCode}) s'est inscrit sur le portail fournisseur`,
          type: 'INFO',
          link: '/suppliers'
        });
        req.io?.to(`user-${buyer.user_id}`).emit('notification', {
          title: 'Nouveau fournisseur inscrit', message: `${b.name.trim()} s'est inscrit`, type: 'INFO', link: '/suppliers'
        });
      }

      // Connexion directe
      const auth = await userModel.authenticate(email, b.password);
      const token = jwt.sign(
        { id: auth.user.id, email: auth.user.email, username: auth.user.username },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      res.status(201).json({ success: true, data: { token, user: auth.user, supplierCode } });
    } catch (error) {
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

  /** GET /api/supplier-portal/me */
  async getMe(req, res) {
    try {
      const supplier = await getSupplierByUser(req.user.id);
      if (!supplier) return res.status(404).json({ success: false, message: 'Aucun fournisseur lié à ce compte' });
      res.json({ success: true, data: supplier });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /** PUT /api/supplier-portal/me (multipart, logo optionnel) */
  async updateMe(req, res) {
    try {
      const supplier = await getSupplierByUser(req.user.id);
      if (!supplier) return res.status(404).json({ success: false, message: 'Aucun fournisseur lié à ce compte' });
      const b = req.body;
      if (b.name !== undefined && !b.name.trim()) {
        return res.status(400).json({ success: false, message: "Nom de l'entreprise requis" });
      }
      const fields = { updated_at: new Date() };
      for (const [key, col] of [['name', 'name'], ['contactName', 'contact_name'], ['phone', 'phone'],
        ['address', 'address'], ['website', 'website'], ['taxId', 'tax_id'], ['registrationNumber', 'registration_number'],
        ['bankName', 'bank_name'], ['bankAccount', 'bank_account'], ['bankIban', 'bank_iban'], ['bankSwift', 'bank_swift']]) {
        if (b[key] !== undefined) fields[col] = b[key] === '' ? null : b[key];
      }
      if (req.file) {
        fields.logo_path = await saveLogo(req.file, LOGO_DIR, supplier.supplier_code);
        await removeLogo(supplier.logo_path);
      }
      await db.update('suppliers', fields, 'id', supplier.id);
      res.json({ success: true, data: await getSupplierByUser(req.user.id) });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new SupplierPortalController();
module.exports.getSupplierByUser = getSupplierByUser;
