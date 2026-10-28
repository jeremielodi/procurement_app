// backend/src/controllers/ReferenceController.js
// Localisations, catégories de marché et unités de mesure (référentiels de la plateforme).
// Lecture : publique (formulaire d'inscription fournisseur) ; écriture : super admin.
const referenceModel = require('../models/ReferenceModel');

const LABELS = {
  locations: { one: 'Localisation', nameRequired: 'Nom de la localisation requis' },
  market_categories: { one: 'Catégorie', nameRequired: 'Nom de la catégorie requis' },
  units: { one: 'Unité', nameRequired: 'Nom de l\x27unité requis', inUse: 'utilisée par des réquisitions' },
};

// Unité par défaut des lignes de réquisition (trigger default_requisition_item_unit, migration 46) : toujours active
const DEFAULT_UNIT_CODE = 'PIECE';
const lockedDefault = (table, row) => table === 'units' && String(row?.code || '').toUpperCase() === DEFAULT_UNIT_CODE;
const DEFAULT_LOCKED = { success: false, code: 'UNIT_DEFAULT_LOCKED', message: '« Pièce » est l\x27unité par défaut des réquisitions : elle ne peut être ni supprimée, ni désactivée, ni recodée' };

/** Colonnes obligatoires et uniques (ex. abréviation d'une unité) : null si correct, sinon { status, message } */
async function checkUnique(table, body, { creating, exceptId = null } = {}) {
  for (const column of referenceModel.TABLES[table].unique || []) {
    if (body[column] === undefined && !creating) continue;
    const value = String(body[column] ?? '').trim();
    if (!value) return { status: 400, code: `${column.toUpperCase()}_REQUIRED`, message: `${column} requis` };
    if (value.length > 20) return { status: 400, code: `${column.toUpperCase()}_TOO_LONG`, message: `${column} : 20 caractères maximum` };
    if (await referenceModel.findByColumn(table, column, value, exceptId)) {
      return { status: 409, code: `${column.toUpperCase()}_EXISTS`, message: `« ${value} » est déjà utilisé` };
    }
    body[column] = value;
  }
  return null;
}

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
        const uniqueError = await checkUnique(table, req.body, { creating: true });
        if (uniqueError) return res.status(uniqueError.status).json({ success: false, code: uniqueError.code, message: uniqueError.message });
        const row = await referenceModel.create(table, { ...req.body, name });
        res.status(201).json({ success: true, data: row, message: `${label.one} créée` });
      } catch (error) {
        res.status(500).json({ success: false, message: error.message });
      }
    },

    async update(req, res) {
      try {
        const id = parseInt(req.params.id);
        const current = await referenceModel.getById(table, id);
        if (!current) {
          return res.status(404).json({ success: false, message: `${label.one} introuvable` });
        }
        if (lockedDefault(table, current) && ((req.body.isActive !== undefined && !(req.body.isActive === true || req.body.isActive === 'true'))
          || (req.body.code && String(req.body.code).trim().toUpperCase() !== DEFAULT_UNIT_CODE))) {
          return res.status(400).json(DEFAULT_LOCKED);
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
        const uniqueError = await checkUnique(table, req.body, { exceptId: id });
        if (uniqueError) return res.status(uniqueError.status).json({ success: false, code: uniqueError.code, message: uniqueError.message });
        res.json({ success: true, data: await referenceModel.update(table, id, req.body), message: `${label.one} mise à jour` });
      } catch (error) {
        res.status(500).json({ success: false, message: error.message });
      }
    },

    async delete(req, res) {
      try {
        const id = parseInt(req.params.id);
        const current = await referenceModel.getById(table, id);
        if (!current) {
          return res.status(404).json({ success: false, message: `${label.one} introuvable` });
        }
        if (lockedDefault(table, current)) return res.status(400).json(DEFAULT_LOCKED);
        const r = await referenceModel.delete(table, id);
        if (!r.deleted) {
          return res.status(400).json({
            success: false,
            message: `${label.one} ${label.inUse || 'utilisée par des fournisseurs ou des appels d\x27offres'} : désactivez-la au lieu de la supprimer`,
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
  units: controllerFor('units'),
};
