// backend/src/controllers/SupplierController.js
// Fournisseurs (partagés entre les entreprises) : liste, fiche, création, modification,
// suppression, documents, préqualification et évaluations (propres à chaque entreprise).
const db = require('../config/database');
const supplierModel = require('../models/SupplierModel');
const referenceModel = require('../models/ReferenceModel');
const storage = require('../services/StorageService');
const { storeDocument, DOC_LABELS } = require('../utils/supplierDocuments');
const { parseIdList, sendDocument } = require('./SupplierPortalController');
const { generatePrequalifiedWorkbook } = require('../services/PrequalifiedSupplierExportService');

const fail = (res, error) => res.status(error.status || 500).json({ success: false, message: error.message });
const PREQ_STATUSES = ['APPROVED', 'REJECTED'];

/** Localisations / catégories envoyées par un acheteur (fournisseurs saisis à la main uniquement) */
async function applyLinks(supplier, body) {
  if (supplier.self_registered) return;
  if (body.locationIds !== undefined) {
    await supplierModel.setLocations(supplier.id, await referenceModel.validActiveIds('locations', parseIdList(body.locationIds)));
  }
  if (body.categoryIds !== undefined) {
    await supplierModel.setCategories(supplier.id, await referenceModel.validActiveIds('market_categories', parseIdList(body.categoryIds)));
  }
}

function prequalifiedFilters(query) {
  return {
    categoryId: parseInt(query.categoryId) || null,
    locationId: parseInt(query.locationId) || null,
    supplierType: ['COMPANY', 'INDIVIDUAL'].includes(query.supplierType) ? query.supplierType : null,
    search: query.search?.trim() || null,
  };
}

class SupplierController {
  /** GET /suppliers — ?all=1 : tous ; sinon préqualifiés actifs (choix dans les bons de commande) */
  async list(req, res) {
    try {
      const all = ['1', 'true'].includes(String(req.query.all));
      res.json({ success: true, data: all ? await supplierModel.getAll() : await supplierModel.getPrequalifiedSuppliers() });
    } catch (error) { fail(res, error); }
  }

  /** GET /suppliers/:id — fiche complète (localisations, catégories, documents, préqualification de l'entreprise) */
  async getOne(req, res) {
    try {
      const supplier = await supplierModel.getFullProfile(req.params.id);
      if (!supplier) return res.status(404).json({ success: false, message: 'Fournisseur introuvable' });
      supplier.prequalification = await supplierModel.getPrequalification(supplier.id);
      res.json({ success: true, data: supplier });
    } catch (error) { fail(res, error); }
  }

  async create(req, res) {
    try {
      const supplier = await supplierModel.create(req.body);
      await applyLinks(supplier, req.body);
      res.status(201).json({ success: true, data: supplier, message: 'Fournisseur créé' });
    } catch (error) { fail(res, error); }
  }

  async update(req, res) {
    try {
      const result = await supplierModel.update(req.params.id, req.body);
      if (!result) return res.status(404).json({ success: false, message: 'Fournisseur introuvable' });
      await applyLinks(result.supplier, req.body);
      res.json({
        success: true,
        data: result.supplier,
        message: result.ignoredIdentity
          ? 'Mis à jour (statut, conditions, notes). Les coordonnées, documents, catégories et localisations sont gérés par le fournisseur depuis son portail.'
          : 'Fournisseur mis à jour',
      });
    } catch (error) { fail(res, error); }
  }

  async delete(req, res) {
    try {
      const r = await supplierModel.delete(req.params.id);
      const messages = {
        NOT_FOUND: [404, 'Fournisseur introuvable'],
        HAS_ACCOUNT: [400, 'Ce fournisseur a un compte sur le portail : désactivez-le (statut Inactif) au lieu de le supprimer'],
        IN_USE: [400, 'Ce fournisseur a des commandes, factures ou offres : désactivez-le (statut Inactif) au lieu de le supprimer'],
      };
      if (!r.deleted) {
        const [status, message] = messages[r.reason];
        return res.status(status).json({ success: false, message });
      }
      res.json({ success: true, message: 'Fournisseur supprimé' });
    } catch (error) { fail(res, error); }
  }

  /** POST /suppliers/:id/prequalify  body { prequalified = true } — ancienne case globale */
  async prequalify(req, res) {
    try {
      if (!(await supplierModel.getById(req.params.id))) return res.status(404).json({ success: false, message: 'Fournisseur introuvable' });
      const value = req.body?.prequalified === undefined ? true : req.body.prequalified === true || req.body.prequalified === 'true';
      const supplier = await supplierModel.updatePrequalification(req.params.id, value);
      res.json({ success: true, data: supplier, message: value ? 'Fournisseur préqualifié' : 'Préqualification retirée' });
    } catch (error) { fail(res, error); }
  }

  // ---------------- Documents ----------------

  /** GET /suppliers/:id/documents/:documentId/file */
  async getDocument(req, res) {
    try {
      return sendDocument(res, await supplierModel.getDocument(req.params.id, req.params.documentId));
    } catch (error) { fail(res, error); }
  }

  /** PUT /suppliers/:id/documents/:type (multipart « file ») — fournisseurs saisis par un acheteur uniquement */
  async uploadDocument(req, res) {
    try {
      const supplier = await supplierModel.getById(req.params.id);
      if (!supplier) return res.status(404).json({ success: false, message: 'Fournisseur introuvable' });
      if (supplier.self_registered) {
        return res.status(403).json({ success: false, message: 'Ce fournisseur gère ses documents depuis son portail' });
      }
      const doc = await storeDocument(req.file, supplier.supplier_code, req.params.type);
      let old;
      try {
        old = await supplierModel.saveDocument(supplier.id, doc, req.user.id);
      } catch (e) {
        await storage.remove(doc.file_path).catch(() => {});
        throw e;
      }
      if (old) await storage.remove(old).catch(() => {});
      res.json({ success: true, data: await supplierModel.getDocuments(supplier.id), message: `${DOC_LABELS[doc.doc_type]} enregistré` });
    } catch (error) { fail(res, error); }
  }

  // ---------------- Préqualification (entreprise courante, par catégorie) ----------------

  /** GET /suppliers/:id/prequalification */
  async getPrequalification(req, res) {
    try {
      const supplier = await supplierModel.getById(req.params.id);
      if (!supplier) return res.status(404).json({ success: false, message: 'Fournisseur introuvable' });
      res.json({
        success: true,
        data: {
          categories: await supplierModel.getPrequalification(supplier.id),
          missing_documents: await supplierModel.getMissingDocuments(supplier),
        },
      });
    } catch (error) { fail(res, error); }
  }

  /**
   * PUT /suppliers/:id/prequalification  body { categoryId, status: 'APPROVED' | 'REJECTED' | null, comment }
   * Approbation : catégorie déclarée par le fournisseur, fournisseur actif. Les documents manquants
   * n'empêchent pas la décision (l'acheteur les voit sur la fiche).
   */
  async setPrequalification(req, res) {
    try {
      if (!req.enterpriseId) return res.status(403).json({ success: false, message: 'Réservé aux utilisateurs d\'une entreprise' });
      const supplier = await supplierModel.getById(req.params.id);
      if (!supplier) return res.status(404).json({ success: false, message: 'Fournisseur introuvable' });

      const categoryId = parseInt(req.body.categoryId);
      const status = req.body.status || null;
      if (status && !PREQ_STATUSES.includes(status)) return res.status(400).json({ success: false, message: 'Statut invalide' });
      const declared = await db.one(
        'SELECT 1 FROM supplier_categories WHERE supplier_id = $1 AND category_id = $2', [supplier.id, categoryId]
      );
      if (!declared) return res.status(400).json({ success: false, message: 'Ce fournisseur n\'a pas déclaré cette catégorie' });

      if (status === 'APPROVED') {
        if (supplier.status !== 'ACTIVE') return res.status(400).json({ success: false, message: 'Fournisseur inactif' });
      }
      if (status === 'REJECTED' && !req.body.comment?.trim()) {
        return res.status(400).json({ success: false, message: 'Indiquez le motif du rejet' });
      }

      await supplierModel.setPrequalification(req.enterpriseId, supplier.id, categoryId, status, req.body.comment?.trim(), req.user.id);
      res.json({
        success: true,
        data: await supplierModel.getPrequalification(supplier.id),
        message: { APPROVED: 'Catégorie préqualifiée', REJECTED: 'Préqualification rejetée' }[status] || 'Remis en attente',
      });
    } catch (error) { fail(res, error); }
  }

  /** GET /suppliers/prequalified?categoryId=&locationId=&supplierType=&search= */
  async listPrequalified(req, res) {
    try {
      res.json({ success: true, data: await supplierModel.getPrequalifiedList(prequalifiedFilters(req.query)) });
    } catch (error) { fail(res, error); }
  }

  /** GET /suppliers/prequalified/export — Excel avec les mêmes filtres */
  async exportPrequalified(req, res) {
    try {
      const filters = prequalifiedFilters(req.query);
      const rows = await supplierModel.getPrequalifiedList(filters);
      const [category, location, enterprise] = await Promise.all([
        filters.categoryId ? referenceModel.getById('market_categories', filters.categoryId) : null,
        filters.locationId ? referenceModel.getById('locations', filters.locationId) : null,
        req.enterpriseId ? db.one('SELECT name FROM enterprise WHERE id = $1', [req.enterpriseId]) : null,
      ]);
      const filtersLabel = [
        category ? `Catégorie : ${category.name}` : 'Toutes catégories',
        location ? `Localisation : ${location.name}` : 'toutes localisations',
        filters.supplierType ? (filters.supplierType === 'INDIVIDUAL' ? 'personnes physiques' : 'entreprises') : null,
      ].filter(Boolean).join(' · ');
      const buffer = await generatePrequalifiedWorkbook(rows, { enterpriseName: enterprise?.name, filtersLabel });
      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.set('Content-Disposition', `attachment; filename="fournisseurs_prequalifies_${new Date().toISOString().slice(0, 10)}.xlsx"`);
      res.end(Buffer.from(buffer));
    } catch (error) { fail(res, error); }
  }

  /** GET /suppliers/:id/evaluations — évaluations faites par l'entreprise courante */
  async getEvaluations(req, res) {
    try {
      if (!(await supplierModel.getById(req.params.id))) return res.status(404).json({ success: false, message: 'Fournisseur introuvable' });
      res.json({ success: true, data: await supplierModel.getEvaluations(req.params.id) });
    } catch (error) { fail(res, error); }
  }

  /** POST /suppliers/:id/evaluations  body { rating 1-5, comment } */
  async addEvaluation(req, res) {
    try {
      if (!(await supplierModel.getById(req.params.id))) return res.status(404).json({ success: false, message: 'Fournisseur introuvable' });
      const supplier = await supplierModel.addEvaluation(req.params.id, req.user.id, req.body.rating, req.body.comment);
      res.status(201).json({ success: true, data: supplier, message: 'Évaluation enregistrée' });
    } catch (error) { fail(res, error); }
  }
}

module.exports = new SupplierController();
