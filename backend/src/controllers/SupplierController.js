// backend/src/controllers/SupplierController.js
// Fournisseurs (partagés entre les entreprises) : liste, fiche, création, modification,
// suppression, préqualification et évaluations (propres à chaque entreprise).
const supplierModel = require('../models/SupplierModel');

const fail = (res, error) => res.status(error.status || 500).json({ success: false, message: error.message });

class SupplierController {
  /** GET /suppliers — ?all=1 : tous ; sinon préqualifiés actifs (choix dans les bons de commande) */
  async list(req, res) {
    try {
      const all = ['1', 'true'].includes(String(req.query.all));
      res.json({ success: true, data: all ? await supplierModel.getAll() : await supplierModel.getPrequalifiedSuppliers() });
    } catch (error) { fail(res, error); }
  }

  async getOne(req, res) {
    try {
      const supplier = await supplierModel.getById(req.params.id);
      if (!supplier) return res.status(404).json({ success: false, message: 'Fournisseur introuvable' });
      res.json({ success: true, data: supplier });
    } catch (error) { fail(res, error); }
  }

  async create(req, res) {
    try {
      const supplier = await supplierModel.create(req.body);
      res.status(201).json({ success: true, data: supplier, message: 'Fournisseur créé' });
    } catch (error) { fail(res, error); }
  }

  async update(req, res) {
    try {
      const result = await supplierModel.update(req.params.id, req.body);
      if (!result) return res.status(404).json({ success: false, message: 'Fournisseur introuvable' });
      res.json({
        success: true,
        data: result.supplier,
        message: result.ignoredIdentity
          ? 'Mis à jour (statut, conditions, notes). Les coordonnées sont gérées par le fournisseur depuis son portail.'
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

  /** POST /suppliers/:id/prequalify  body { prequalified = true } */
  async prequalify(req, res) {
    try {
      if (!(await supplierModel.getById(req.params.id))) return res.status(404).json({ success: false, message: 'Fournisseur introuvable' });
      const value = req.body?.prequalified === undefined ? true : req.body.prequalified === true || req.body.prequalified === 'true';
      const supplier = await supplierModel.updatePrequalification(req.params.id, value);
      res.json({ success: true, data: supplier, message: value ? 'Fournisseur préqualifié' : 'Préqualification retirée' });
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
