// backend/src/controllers/StockController.js
// Gestion de stock : dépôts (et accès), catalogue d'articles, soldes, mouvements, lots, export Excel.
// Toutes les données sont celles de l'entreprise courante (tenant) ; les routes /warehouses/:id,
// /stock-items/:id sont contrôlées par tenantGuard (PATH_RESOURCES).
const ExcelJS = require('exceljs');
const warehouseModel = require('../models/WarehouseModel');
const stockItemModel = require('../models/StockItemModel');
const stockModel = require('../models/StockModel');
const referenceModel = require('../models/ReferenceModel');
const i18n = require('../i18n');
const { audit, AUDIT } = require('../utils/auditLog');

const bad = (res, message, code) => res.status(400).json({ success: false, code, message });
const str = (v, max) => (v === undefined || v === null ? undefined : String(v).trim().slice(0, max));
const bool = (v) => (v === undefined ? undefined : v === true || v === 'true' || v === 1 || v === '1');
const numOrNull = (v) => (v === undefined ? undefined : v === null || v === '' ? null : Number(v));

function serverError(res, error, message) {
  console.error(message, error);
  return res.status(error.status || 500).json({ success: false, code: error.code, message: error.status ? error.message : message, error: error.message });
}

// ============================================================
// Dépôts
// ============================================================
const warehouses = {
  /** GET /warehouses — ?all=1 : y compris inactifs */
  async list(req, res) {
    try {
      const activeOnly = !['1', 'true'].includes(String(req.query.all));
      res.json({ success: true, data: await warehouseModel.list({ activeOnly, locationId: req.query.locationId, search: req.query.search }) });
    } catch (error) { return serverError(res, error, 'Erreur lors du chargement des dépôts'); }
  },

  /** GET /warehouses/mine — dépôts où l'utilisateur peut réceptionner (choix du dépôt d'un GRN) */
  async mine(req, res) {
    try {
      res.json({ success: true, data: await warehouseModel.accessibleFor(req.user.id) });
    } catch (error) { return serverError(res, error, 'Erreur lors du chargement des dépôts'); }
  },

  async get(req, res) {
    try {
      const warehouse = await warehouseModel.getById(req.params.id);
      if (!warehouse) return res.status(404).json({ success: false, message: 'Dépôt introuvable' });
      res.json({ success: true, data: { ...warehouse, users: await warehouseModel.getUsers(req.params.id) } });
    } catch (error) { return serverError(res, error, 'Erreur lors du chargement du dépôt'); }
  },

  async validate(req, body, exceptId = null) {
    const code = str(body.code, 30);
    const name = str(body.name, 150);
    if (code !== undefined && !/^[A-Za-z0-9_-]{1,30}$/.test(code)) return 'Code invalide (lettres, chiffres, - et _ ; 30 caractères max)';
    if (name !== undefined && !name) return 'Nom du dépôt requis';
    if (body.locationId !== undefined) {
      const location = await referenceModel.getById('locations', body.locationId);
      if (!location || !location.is_active) return 'Localisation introuvable ou inactive';
    }
    if (code && await warehouseModel.findByCode(req.enterpriseId, code, exceptId)) return `Le code ${code} est déjà utilisé`;
    return null;
  },

  async create(req, res) {
    try {
      if (!req.enterpriseId) return res.status(403).json({ success: false, message: 'Réservé aux utilisateurs d\'une entreprise' });
      const body = req.body || {};
      if (!str(body.code, 30) || !str(body.name, 150) || !body.locationId) return bad(res, 'Code, nom et localisation requis');
      const error = await warehouses.validate(req, body);
      if (error) return bad(res, error);
      const row = await warehouseModel.create({
        enterpriseId: req.enterpriseId, locationId: body.locationId, code: str(body.code, 30).toUpperCase(), name: str(body.name, 150),
        address: str(body.address, 500), description: str(body.description, 1000), createdBy: req.user.id,
      });
      res.status(201).json({ success: true, data: await warehouseModel.getById(row.id), message: 'Dépôt créé' });
    } catch (error) { return serverError(res, error, 'Erreur lors de la création du dépôt'); }
  },

  async update(req, res) {
    try {
      const existing = await warehouseModel.getById(req.params.id);
      if (!existing) return res.status(404).json({ success: false, message: 'Dépôt introuvable' });
      const body = req.body || {};
      const error = await warehouses.validate(req, body, req.params.id);
      if (error) return bad(res, error);
      await warehouseModel.update(req.params.id, {
        locationId: body.locationId, code: str(body.code, 30)?.toUpperCase(), name: str(body.name, 150),
        address: str(body.address, 500), description: str(body.description, 1000), isActive: bool(body.isActive),
      });
      res.json({ success: true, data: await warehouseModel.getById(req.params.id), message: 'Dépôt mis à jour' });
    } catch (error) { return serverError(res, error, 'Erreur lors de la mise à jour du dépôt'); }
  },

  /** PUT /warehouses/:id/users { userIds } — accès des utilisateurs (logistique…) au dépôt */
  async setUsers(req, res) {
    try {
      const existing = await warehouseModel.getById(req.params.id);
      if (!existing) return res.status(404).json({ success: false, message: 'Dépôt introuvable' });
      if (!Array.isArray(req.body?.userIds)) return bad(res, 'userIds (liste) requis');
      const before = (await warehouseModel.getUsers(req.params.id)).map(u => u.id);
      await warehouseModel.setUsers(req.params.id, existing.enterprise_id, req.body.userIds, req.user.id);
      const users = await warehouseModel.getUsers(req.params.id);
      await audit(req, AUDIT.WAREHOUSE_ACCESS_CHANGED, {
        oldValue: { warehouse: existing.code, userIds: before },
        details: { warehouse: existing.code, userIds: users.map(u => u.id) },
      });
      res.json({ success: true, data: users, message: 'Accès mis à jour' });
    } catch (error) { return serverError(res, error, 'Erreur lors de la mise à jour des accès'); }
  },
};

// ============================================================
// Catalogue d'articles
// ============================================================
function itemFields(body) {
  return {
    code: str(body.code, 50)?.toUpperCase(),
    name: str(body.name, 200),
    description: str(body.description, 2000),
    unit: str(body.unit, 30),
    categoryId: body.categoryId === undefined ? undefined : (body.categoryId || null),
    isStockable: bool(body.isStockable),
    trackLots: bool(body.trackLots),
    trackExpiry: bool(body.trackExpiry),
    trackSerials: bool(body.trackSerials),
    minQuantity: numOrNull(body.minQuantity),
    isActive: bool(body.isActive),
  };
}

async function validateItem(req, fields, existing = null) {
  if (fields.code !== undefined && !/^[A-Z0-9_.-]{1,50}$/.test(fields.code)) return 'Code invalide (lettres, chiffres, . - _ ; 50 caractères max)';
  if (fields.name !== undefined && !fields.name) return 'Désignation requise';
  if (fields.unit !== undefined && !fields.unit) return 'Unité requise';
  if (fields.minQuantity !== undefined && fields.minQuantity !== null && !(fields.minQuantity >= 0)) return 'Stock minimum invalide';
  if (fields.categoryId) {
    const category = await referenceModel.getById('market_categories', fields.categoryId);
    if (!category) return 'Catégorie introuvable';
  }
  const merged = { is_stockable: true, track_lots: false, track_expiry: false, track_serials: false, ...(existing || {}) };
  const stockable = fields.isStockable ?? merged.is_stockable;
  const lots = fields.trackLots ?? merged.track_lots;
  const expiry = fields.trackExpiry ?? merged.track_expiry;
  const serials = fields.trackSerials ?? merged.track_serials;
  if (expiry && !lots) return 'Le suivi de péremption nécessite le suivi par lot';
  if (lots && !stockable) return 'Un article non stockable ne peut pas être suivi par lot';
  if (serials && (!stockable || lots)) return 'Un équipement suivi par n° de série doit être stockable et sans suivi par lot';
  if (existing && await stockItemModel.hasMovements(existing.id)) {
    // Le stock existant a été enregistré avec ces règles : les changer fausserait l'historique
    if ((fields.isStockable !== undefined && fields.isStockable !== existing.is_stockable)
      || (fields.trackLots !== undefined && fields.trackLots !== existing.track_lots)
      || (fields.trackSerials !== undefined && fields.trackSerials !== existing.track_serials)
      || (fields.unit !== undefined && fields.unit !== existing.unit)) {
      return 'Article déjà mouvementé : unité, « stockable » et suivi par lot ne sont plus modifiables';
    }
  }
  if (fields.code && await stockItemModel.findByCode(req.enterpriseId || existing?.enterprise_id, fields.code, existing?.id || null)) {
    return `Le code ${fields.code} est déjà utilisé`;
  }
  return null;
}

const items = {
  /** GET /stock-items?search=&categoryId=&stockable=&all=1&belowMin=1&page=&limit= */
  async list(req, res) {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 1000);
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const { rows, total } = await stockItemModel.list({
        search: req.query.search, categoryId: req.query.categoryId, stockable: req.query.stockable,
        activeOnly: !['1', 'true'].includes(String(req.query.all)), belowMin: ['1', 'true'].includes(String(req.query.belowMin)),
        limit, offset: (page - 1) * limit,
      });
      res.json({ success: true, data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) { return serverError(res, error, 'Erreur lors du chargement des articles'); }
  },

  /** GET /stock-items/search?q= — autocomplétion (réquisition, réception) */
  async search(req, res) {
    try {
      res.json({ success: true, data: await stockItemModel.search(req.query.q, req.query.limit) });
    } catch (error) { return serverError(res, error, 'Erreur lors de la recherche d\'articles'); }
  },

  async get(req, res) {
    try {
      const item = await stockItemModel.getById(req.params.id);
      if (!item) return res.status(404).json({ success: false, message: 'Article introuvable' });
      const [balances, lots] = await Promise.all([
        stockModel.balances({ stockItemId: req.params.id }),
        stockModel.lots(req.params.id),
      ]);
      res.json({ success: true, data: { ...item, balances, lots } });
    } catch (error) { return serverError(res, error, 'Erreur lors du chargement de l\'article'); }
  },

  async create(req, res) {
    try {
      if (!req.enterpriseId) return res.status(403).json({ success: false, message: 'Réservé aux utilisateurs d\'une entreprise' });
      const fields = itemFields(req.body || {});
      if (!fields.code || !fields.name) return bad(res, 'Code et désignation requis');
      if (fields.isStockable === undefined && fields.categoryId) {
        // Par défaut : stockable selon la catégorie de marché
        fields.isStockable = !!(await referenceModel.getById('market_categories', fields.categoryId))?.is_stockable;
      }
      const error = await validateItem(req, fields);
      if (error) return bad(res, error);
      const row = await stockItemModel.create(fields, { enterpriseId: req.enterpriseId, createdBy: req.user.id });
      res.status(201).json({ success: true, data: await stockItemModel.getById(row.id), message: 'Article créé' });
    } catch (error) { return serverError(res, error, 'Erreur lors de la création de l\'article'); }
  },

  async update(req, res) {
    try {
      const existing = await stockItemModel.getById(req.params.id);
      if (!existing) return res.status(404).json({ success: false, message: 'Article introuvable' });
      const fields = itemFields(req.body || {});
      const error = await validateItem(req, fields, existing);
      if (error) return bad(res, error);
      await stockItemModel.update(req.params.id, fields);
      res.json({ success: true, data: await stockItemModel.getById(req.params.id), message: 'Article mis à jour' });
    } catch (error) { return serverError(res, error, 'Erreur lors de la mise à jour de l\'article'); }
  },
};

// ============================================================
// Stock : soldes, mouvements, synthèse, export
// ============================================================
const stock = {
  /** GET /stock/balances?warehouseId=&stockItemId=&categoryId=&locationId=&search=&expiringWithinDays= */
  async balances(req, res) {
    try {
      res.json({ success: true, data: await stockModel.balances({ ...req.query, includeEmpty: ['1', 'true'].includes(String(req.query.includeEmpty)) }) });
    } catch (error) { return serverError(res, error, 'Erreur lors du chargement du stock'); }
  },

  async movements(req, res) {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 500);
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const { rows, total } = await stockModel.movements({ ...req.query, limit, offset: (page - 1) * limit });
      res.json({ success: true, data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) { return serverError(res, error, 'Erreur lors du chargement des mouvements'); }
  },

  async summary(req, res) {
    try {
      res.json({ success: true, data: await stockModel.summary() });
    } catch (error) { return serverError(res, error, 'Erreur lors du chargement de la synthèse'); }
  },

  /** GET /stock/balances/export — Excel (feuille « Stock » détaillée par lot + « Par article ») */
  async exportBalances(req, res) {
    try {
      const T = i18n.translator(i18n.fromRequest(req));
      const locale = i18n.locale(i18n.fromRequest(req));
      const rows = await stockModel.balances({ ...req.query, includeEmpty: false });
      const wb = new ExcelJS.Workbook();
      wb.creator = 'procureApp';
      const header = (ws) => {
        ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
      };

      const detail = wb.addWorksheet(T('stockExport.sheetDetail'));
      detail.columns = [
        { header: T('stockExport.code'), key: 'item_code', width: 16 },
        { header: T('stockExport.item'), key: 'item_name', width: 40 },
        { header: T('stockExport.category'), key: 'category_name', width: 28 },
        { header: T('stockExport.location'), key: 'location_name', width: 18 },
        { header: T('stockExport.warehouse'), key: 'warehouse_name', width: 28 },
        { header: T('stockExport.lot'), key: 'lot_number', width: 16 },
        { header: T('stockExport.expiry'), key: 'expiry_date', width: 14, style: { numFmt: 'dd/mm/yyyy' } },
        { header: T('stockExport.quantity'), key: 'quantity', width: 14, style: { numFmt: '#,##0.####' } },
        { header: T('stockExport.unit'), key: 'unit', width: 10 },
      ];
      for (const r of rows) {
        detail.addRow({ ...r, quantity: Number(r.quantity), expiry_date: r.expiry_date ? new Date(r.expiry_date) : null, lot_number: r.lot_number || '' });
      }
      header(detail);

      const byItem = new Map();
      for (const r of rows) {
        const key = r.stock_item_id;
        const agg = byItem.get(key) || { item_code: r.item_code, item_name: r.item_name, category_name: r.category_name, unit: r.unit, quantity: 0, min_quantity: r.min_quantity, warehouses: new Set() };
        agg.quantity += Number(r.quantity);
        agg.warehouses.add(r.warehouse_name);
        byItem.set(key, agg);
      }
      const summary = wb.addWorksheet(T('stockExport.sheetSummary'));
      summary.columns = [
        { header: T('stockExport.code'), key: 'item_code', width: 16 },
        { header: T('stockExport.item'), key: 'item_name', width: 40 },
        { header: T('stockExport.category'), key: 'category_name', width: 28 },
        { header: T('stockExport.quantity'), key: 'quantity', width: 14, style: { numFmt: '#,##0.####' } },
        { header: T('stockExport.unit'), key: 'unit', width: 10 },
        { header: T('stockExport.minimum'), key: 'min_quantity', width: 14, style: { numFmt: '#,##0.####' } },
        { header: T('stockExport.warehouses'), key: 'warehouses', width: 50 },
      ];
      for (const a of byItem.values()) {
        const row = summary.addRow({ ...a, min_quantity: a.min_quantity !== null ? Number(a.min_quantity) : null, warehouses: [...a.warehouses].join(', ') });
        if (a.min_quantity !== null && a.quantity < Number(a.min_quantity)) row.getCell('quantity').font = { color: { argb: 'FFDC2626' }, bold: true };
      }
      header(summary);

      const stamp = new Date().toLocaleDateString(locale).replace(/\//g, '-');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="stock_${stamp}.xlsx"`);
      await wb.xlsx.write(res);
      res.end();
    } catch (error) { return serverError(res, error, 'Erreur lors de l\'export du stock'); }
  },
};

module.exports = { warehouses, items, stock };
