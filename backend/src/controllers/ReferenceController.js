// backend/src/controllers/ReferenceController.js
// Localisations et catégories de marché (référentiels de la plateforme).
// Lecture : publique (formulaire d'inscription fournisseur) ; écriture : super admin.
const referenceModel = require('../models/ReferenceModel');

const LABELS = {
  locations: { one: 'Localisation', nameRequired: 'Nom de la localisation requis' },
  market_categories: { one: 'Catégorie', nameRequired: 'Nom de la catégorie requis' },
};

/** Code saisi : format et unicité (le code identifie la donnée dans toutes les bases) */
async function checkCode(table, body, exceptId = null) {
  const code = body.code === undefined || body.code === null ? '' : String(body.code).trim().toUpperCase();
  if (!code) return null;
  if (!/^[A-Z0-9_-]{1,50}$/.test(code)) return { status: 400, message: 'Code invalide (lettres, chiffres, - et _)' };
  if (await referenceModel.findByCode(table, code, exceptId)) return { status: 409, message: `Le code ${code} est déjà utilisé` };
  body.code = code;
  return null;
}

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
        const codeError = await checkCode(table, req.body);
        if (codeError) return res.status(codeError.status).json({ success: false, message: codeError.message });
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
        if (req.body.code !== undefined) {
          const codeError = await checkCode(table, req.body, id);
          if (codeError) return res.status(codeError.status).json({ success: false, message: codeError.message });
          if (!req.body.code) delete req.body.code; // code vide : inchangé
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
