// backend/src/controllers/ReferenceController.js
// Localisations et catégories de marché (référentiels de la plateforme).
// Lecture : publique (formulaire d'inscription fournisseur) ; écriture : super admin.
const referenceModel = require('../models/ReferenceModel');

const LABELS = {
  locations: { one: 'Localisation', nameRequired: 'Nom de la localisation requis' },
  market_categories: { one: 'Catégorie', nameRequired: 'Nom de la catégorie requis' },
};

function controllerFor(table) {
  const label = LABELS[table];
  return {
    /** GET — ?all=1 : y compris inactives (écran d'administration) */
    async list(req, res) {
      try {
        const activeOnly = !['1', 'true'].includes(String(req.query.all));
        res.json({ success: true, data: await referenceModel.list(table, { activeOnly }) });
      } catch (error) {
        res.status(500).json({ success: false, message: error.message });
      }
    },

    async create(req, res) {
      try {
        const name = String(req.body.name || '').trim();
        if (!name) return res.status(400).json({ success: false, message: label.nameRequired });
        if (await referenceModel.findByName(table, name)) {
          return res.status(409).json({ success: false, message: `${label.one} « ${name} » existe déjà` });
        }
        const row = await referenceModel.create(table, { ...req.body, name });
        res.status(201).json({ success: true, data: row, message: `${label.one} créée` });
      } catch (error) {
        res.status(500).json({ success: false, message: error.message });
      }
    },

    async update(req, res) {
      try {
        const id = parseInt(req.params.id);
        if (!(await referenceModel.getById(table, id))) {
          return res.status(404).json({ success: false, message: `${label.one} introuvable` });
        }
        if (req.body.name !== undefined) {
          const name = String(req.body.name).trim();
          if (!name) return res.status(400).json({ success: false, message: label.nameRequired });
          if (await referenceModel.findByName(table, name, id)) {
            return res.status(409).json({ success: false, message: `${label.one} « ${name} » existe déjà` });
          }
          req.body.name = name;
        }
        res.json({ success: true, data: await referenceModel.update(table, id, req.body), message: `${label.one} mise à jour` });
      } catch (error) {
        res.status(500).json({ success: false, message: error.message });
      }
    },

    async delete(req, res) {
      try {
        const id = parseInt(req.params.id);
        if (!(await referenceModel.getById(table, id))) {
          return res.status(404).json({ success: false, message: `${label.one} introuvable` });
        }
        const r = await referenceModel.delete(table, id);
        if (!r.deleted) {
          return res.status(400).json({
            success: false,
            message: `${label.one} utilisée par des fournisseurs ou des appels d'offres : désactivez-la au lieu de la supprimer`,
          });
        }
        res.json({ success: true, message: `${label.one} supprimée` });
      } catch (error) {
        res.status(500).json({ success: false, message: error.message });
      }
    },
  };
}

module.exports = {
  locations: controllerFor('locations'),
  categories: controllerFor('market_categories'),
};
