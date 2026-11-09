// backend/src/controllers/StockEquipmentController.js
// Équipements (n° de série), détentions par utilisateur et retours en stock.
const equipmentModel = require('../models/StockEquipmentModel');
const notificationModel = require('../models/NotificationModel');
const userModel = require('../models/UserModel');
const stockModel = require('../models/StockModel');
const i18n = require('../i18n');
const ExcelJS = require('exceljs');
const db = require('../config/database');
const stockReturnPdfService = require('../services/StockReturnPdfService');
const unitImportService = require('../services/StockUnitImportService');
const { audit, AUDIT } = require('../utils/auditLog');

function sendError(res, error, fallback) {
  if (error.status) return res.status(error.status).json({ success: false, code: error.code, message: error.message, line: error.line, remaining: error.remaining });
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback, error: error.message });
}

const page = (req, max = 200) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, max);
  const p = Math.max(parseInt(req.query.page) || 1, 1);
  return { limit, page: p, offset: (p - 1) * limit };
};

module.exports = {
  /** GET /stock-holdings?userId= | ?departmentId= — ce que détient un employé ou un département (VIEW_STOCK) */
  async holdings(req, res) {
    try {
      if (req.query.departmentId) {
        const department = await db.one('SELECT id, code, name FROM departments WHERE id::text = $1', [String(req.query.departmentId)]);
        if (!department) return res.status(404).json({ success: false, message: 'Département introuvable' });
        return res.json({ success: true, data: await equipmentModel.holdings(null, { departmentId: department.id }), department });
      }
      if (!req.query.userId) return res.status(400).json({ success: false, message: 'userId ou departmentId requis' });
      const user = await userModel.findById(req.query.userId);
      if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
      res.json({
        success: true,
        data: await equipmentModel.holdings(req.query.userId),
        user: { id: user.id, first_name: user.firstName, last_name: user.lastName, email: user.email, is_active: user.isActive },
      });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement des détentions'); }
  },

  /** GET /stock-holdings/mine — ce que je détiens (tout utilisateur) */
  async myHoldings(req, res) {
    try {
      res.json({ success: true, data: await equipmentModel.holdings(req.user.id) });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement des détentions'); }
  },

  /** POST /stock-returns { warehouseId, returnedBy | departmentId, lines: [{ issueLineId, quantity, condition }], comment } */
  async createReturn(req, res) {
    try {
      const b = req.body || {};
      if (!b.warehouseId || (!b.returnedBy && !b.departmentId)) {
        return res.status(400).json({ success: false, code: 'REQUIRED', message: 'Dépôt et employé (ou département) requis' });
      }
      const result = await equipmentModel.createReturn(
        { warehouseId: b.warehouseId, returnedBy: b.departmentId ? null : b.returnedBy, departmentId: b.departmentId || null, lines: b.lines, comment: b.comment },
        { userId: req.user.id }
      );
      if (!b.departmentId && String(b.returnedBy) !== String(req.user.id)) {
        try {
          const user = await userModel.findById(b.returnedBy);
          const T = i18n.translator(user?.language);
          const title = T('notification.stockReturn.title', { number: result.returnNumber });
          const message = T('notification.stockReturn.message', { number: result.returnNumber, count: result.lines });
          await notificationModel.create({ userId: b.returnedBy, title, message, type: 'INFO', link: '/my-items' });
          req.io?.to(`user-${b.returnedBy}`).emit('notification', { title, message, type: 'INFO', link: '/my-items', timestamp: new Date().toISOString() });
        } catch (e) { console.error('Notification retour :', e.message); }
      }
      res.status(201).json({ success: true, data: result, message: 'Retour enregistré' });
    } catch (error) { return sendError(res, error, 'Erreur lors de l\'enregistrement du retour'); }
  },

  async listReturns(req, res) {
    try {
      const { limit, page: p, offset } = page(req);
      const { rows, total } = await equipmentModel.listReturns({ ...req.query, limit, offset });
      res.json({ success: true, data: rows, pagination: { page: p, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement des retours'); }
  },

  async getReturn(req, res) {
    try {
      const ret = await equipmentModel.getReturn(req.params.id);
      if (!ret) return res.status(404).json({ success: false, message: 'Bon de retour introuvable' });
      res.json({ success: true, data: ret });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement du retour'); }
  },

  /** GET /stock-returns/:id/pdf?lang= — bon de retour à imprimer et signer */
  async returnPdf(req, res) {
    try {
      const result = await stockReturnPdfService.generate(req.params.id, { lang: i18n.fromRequest(req) });
      if (!result) return res.status(404).json({ success: false, message: 'Bon de retour introuvable' });
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `inline; filename="${String(result.ret.return_number).replace(/[^\w.-]+/g, '_')}.pdf"`);
      res.end(result.pdf);
    } catch (error) { return sendError(res, error, 'Erreur lors de la génération du PDF'); }
  },

  /** GET /stock-units?status=&stockItemId=&warehouseId=&holderId=&search= */
  async units(req, res) {
    try {
      const { limit, page: p, offset } = page(req, 500);
      const { rows, total } = await equipmentModel.units({ ...req.query, limit, offset });
      res.json({ success: true, data: rows, pagination: { page: p, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement des équipements'); }
  },

  /** GET /stock-units/:id — fiche et historique (mouvements de l'unité) */
  async getUnit(req, res) {
    try {
      const unit = await equipmentModel.getUnit(req.params.id);
      if (!unit || unit.status === 'VOID') return res.status(404).json({ success: false, message: 'Équipement introuvable' });
      const history = await stockModel.movements({ unitId: req.params.id, limit: 200 });
      res.json({ success: true, data: { ...unit, history: history.rows } });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement de l\'équipement'); }
  },

  /** POST /stock-units/register { stockItemId, warehouseId, units: [{ serialNumber, assetTag }] } — parc existant */
  async registerUnits(req, res) {
    try {
      const b = req.body || {};
      const result = await equipmentModel.registerUnits({ stockItemId: b.stockItemId, warehouseId: b.warehouseId, units: b.units || [], projectId: b.projectId || null }, { userId: req.user.id });
      res.status(201).json({ success: true, data: result, message: 'Équipements enregistrés' });
    } catch (error) { return sendError(res, error, 'Erreur lors de l\'enregistrement des équipements'); }
  },

  /**
   * GET /stock-units/export?status=&stockItemId=&search=&lang= — registre des équipements (Excel), mêmes filtres que la liste ;
   * « Ancien n° d'inventaire » = dernier relevé dans les notes par la recodification
   */
  async exportUnits(req, res) {
    try {
      const lang = i18n.fromRequest(req);
      const T = i18n.translator(lang);
      const { rows } = await equipmentModel.units({ ...req.query, exportAll: true });
      const wb = new ExcelJS.Workbook();
      wb.creator = 'procureApp';
      const ws = wb.addWorksheet(T('equipmentExport.sheet'));
      const cols = [['assetTag', 24], ['oldTag', 24], ['itemCode', 22], ['item', 40], ['assetCategory', 12], ['serial', 24], ['status', 14],
        ['condition', 12], ['warehouse', 24], ['holder', 28], ['since', 12], ['project', 30], ['acquisitionDate', 14], ['tagProject', 14],
        ['unitCost', 12], ['currency', 9], ['registeredAt', 12], ['notes', 60]];
      ws.columns = cols.map(([key, width]) => ({ header: T(`equipmentExport.${key}`), key, width }));
      const dateOf = (v) => (v ? new Date(v) : null);
      for (const u of rows) {
        const old = [...String(u.notes || '').matchAll(/Ancien n° d'inventaire : ([^\s—;]+)/g)].pop();
        ws.addRow({
          assetTag: u.asset_tag || '', oldTag: old ? old[1] : '', itemCode: u.item_code, item: u.item_name, assetCategory: u.asset_category || '',
          serial: u.serial_number, status: T(`equipmentExport.statuses.${u.status}`), condition: T(`equipmentExport.conditions.${u.condition}`),
          warehouse: u.warehouse_name || '', holder: u.holder_name || u.department_name || '', since: dateOf(u.assigned_at),
          project: u.project_id ? `${u.project_code} — ${u.project_name}` : '', acquisitionDate: dateOf(u.acquisition_date),
          tagProject: u.tag_project_code || '', unitCost: u.unit_cost, currency: u.unit_cost !== null ? u.currency_code || '' : '',
          registeredAt: dateOf(u.created_at), notes: u.notes || '',
        });
      }
      for (const key of ['since', 'acquisitionDate', 'registeredAt']) ws.getColumn(key).numFmt = 'dd/mm/yyyy';
      ws.getColumn('unitCost').numFmt = '#,##0.00';
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
      const name = `${T('equipmentExport.file')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"` });
      await wb.xlsx.write(res);
      res.end();
    } catch (error) { return sendError(res, error, "Erreur lors de l'export des équipements"); }
  },

  /** GET /stock-units/retag/template?format=xlsx|csv&lang= — modèle de recodification, pré-rempli avec les équipements */
  async retagTemplate(req, res) {
    try {
      const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
      const file = await unitImportService.retagTemplate({ lang: i18n.fromRequest(req), format });
      res.set('Content-Type', file.contentType);
      res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
      res.end(file.buffer);
    } catch (error) { return sendError(res, error, 'Erreur lors de la génération du modèle'); }
  },

  /** GET /stock-units/import/template?format=xlsx|csv&lang= — modèle d'import du parc existant (articles, dépôts accessibles, projets) */
  async importTemplate(req, res) {
    try {
      const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
      const file = await unitImportService.template({ userId: req.user.id, lang: i18n.fromRequest(req), format });
      res.set('Content-Type', file.contentType);
      res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
      res.end(file.buffer);
    } catch (error) { return sendError(res, error, 'Erreur lors de la génération du modèle'); }
  },

  /**
   * POST /stock-units/import (multipart : file ; confirm=1 pour écrire) — parc existant depuis Excel / CSV :
   * sans confirm = aperçu { units, openings, errors, summary } ; avec confirm = lignes valides écrites en une transaction
   */
  async importUnits(req, res) {
    try {
      if (!req.enterpriseId) return res.status(403).json({ success: false, message: 'Réservé aux utilisateurs d\'une entreprise' });
      if (!req.file) return res.status(400).json({ success: false, code: 'NO_FILE', message: 'Aucun fichier reçu' });
      if (!['1', 'true'].includes(String(req.body?.confirm ?? req.query.confirm))) {
        return res.json({ success: true, data: await unitImportService.preview(req.file, { userId: req.user.id }) });
      }
      const result = await unitImportService.apply(req.file, { userId: req.user.id });
      await audit(req, AUDIT.STOCK_UNITS_IMPORTED, {
        entity: { type: 'stock_units', id: null, label: req.file.originalname },
        details: { file: req.file.originalname, units: result.units, openings: result.openings, openingQuantity: result.openingQuantity,
          damaged: result.damaged, operation: result.groupNumber, skippedLines: result.skipped },
        enterpriseId: req.enterpriseId,
      });
      res.json({ success: true, data: result, message: 'Import terminé' });
    } catch (error) {
      if (error.status && error.status < 500) {
        return res.status(error.status).json({ success: false, code: error.code, message: error.message, details: error.details });
      }
      return sendError(res, error, 'Erreur lors de l\'import du parc existant');
    }
  },

  /**
   * POST /stock-units/retag (multipart : file ; confirm=1 pour écrire) — recodification des n° d'inventaire (migration 57) :
   * sans confirm = aperçu ; avec confirm = nouveaux n° (ORGANISATION-PROJET-CATÉGORIE-ANNÉE-NNN) en une transaction
   */
  async retagUnits(req, res) {
    try {
      if (!req.enterpriseId) return res.status(403).json({ success: false, message: 'Réservé aux utilisateurs d\'une entreprise' });
      if (!req.file) return res.status(400).json({ success: false, code: 'NO_FILE', message: 'Aucun fichier reçu' });
      if (!['1', 'true'].includes(String(req.body?.confirm ?? req.query.confirm))) {
        return res.json({ success: true, data: await unitImportService.retagPreview(req.file) });
      }
      const result = await unitImportService.retagApply(req.file);
      await audit(req, AUDIT.STOCK_UNITS_RETAGGED, {
        entity: { type: 'stock_units', id: null, label: req.file.originalname },
        details: { file: req.file.originalname, units: result.units, skippedLines: result.skipped,
          sample: result.changes.slice(0, 20).map(c => ({ serial: c.serial, from: c.oldTag, to: c.newTag })) },
        enterpriseId: req.enterpriseId,
      });
      res.json({ success: true, data: result, message: 'N° d\'inventaire recalculés' });
    } catch (error) {
      if (error.status && error.status < 500) {
        return res.status(error.status).json({ success: false, code: error.code, message: error.message, details: error.details });
      }
      return sendError(res, error, 'Erreur lors de la recodification');
    }
  },

  /** PUT /stock-units/:id { assetTag, notes, condition, retire, reason, acquisitionDate, tagProjectCode } */
  async updateUnit(req, res) {
    try {
      const b = req.body || {};
      await equipmentModel.updateUnit(req.params.id, {
        assetTag: b.assetTag, notes: b.notes, condition: b.condition, retire: b.retire === true, reason: b.reason,
        acquisitionDate: b.acquisitionDate, tagProjectCode: b.tagProjectCode,
      }, { userId: req.user.id });
      res.json({ success: true, data: await equipmentModel.getUnit(req.params.id), message: 'Équipement mis à jour' });
    } catch (error) { return sendError(res, error, 'Erreur lors de la mise à jour de l\'équipement'); }
  },
};
