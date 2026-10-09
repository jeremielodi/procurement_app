// backend/src/controllers/AuditLogController.js
// Journal d'audit : liste filtrée + synthèse par action, export Excel (tracé lui-même dans le journal).
// Permission VIEW_AUDIT_LOGS (admin d'entreprise : son entreprise ; super admin : toute la plateforme).
const ExcelJS = require('exceljs');
const auditLogModel = require('../models/AuditLogModel');
const { audit, AUDIT } = require('../utils/auditLog');
const i18n = require('../i18n');

const FILTER_KEYS = ['action', 'actions', 'q', 'userId', 'from', 'to', 'enterpriseId', 'failuresOnly', 'entityType', 'entityRef'];
const pick = (query) => Object.fromEntries(FILTER_KEYS.filter(k => query[k] !== undefined && query[k] !== '').map(k => [k, query[k]]));

/** Détails lisibles d'une ligne : « clé : valeur » (objets JSON aplatis ; _label = libellé de l'objet, affiché à part) */
function detailsText(value) {
  if (!value || typeof value !== 'object') return '';
  return Object.entries(value).filter(([k]) => k !== '_label')
    .map(([k, v]) => `${k}: ${v !== null && typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' · ');
}

module.exports = {
  /** GET /audit-logs?action=&actions=&q=&userId=&from=&to=&enterpriseId=&failuresOnly=&page=&limit= */
  async list(req, res) {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const filters = pick(req.query);
      const [{ rows, total }, summary] = await Promise.all([
        auditLogModel.list(filters, { limit, offset: (page - 1) * limit }),
        auditLogModel.summary(filters),
      ]);
      res.json({
        success: true, data: rows, summary, actions: Object.values(AUDIT),
        enterprises: req.isSuperAdmin ? await auditLogModel.enterprises() : undefined,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch (error) {
      console.error('Journal d\'audit :', error);
      res.status(500).json({ success: false, message: 'Erreur lors du chargement du journal d\'audit' });
    }
  },

  /** GET /audit-logs/export — Excel (mêmes filtres, 20 000 lignes au plus) */
  async export(req, res) {
    try {
      const lang = i18n.fromRequest(req);
      const T = i18n.translator(lang);
      const locale = i18n.locale(lang);
      const filters = pick(req.query);
      const rows = await auditLogModel.exportRows(filters);
      const tz = process.env.APP_TIMEZONE || 'Africa/Kinshasa';

      const wb = new ExcelJS.Workbook();
      wb.creator = 'procureApp';
      wb.created = new Date();
      const ws = wb.addWorksheet(T('auditExport.sheet'), { views: [{ state: 'frozen', ySplit: 1 }] });
      const columns = [
        ['date', 20], ['action', 30], ['actor', 30], ['target', 30], ['details', 60], ['before', 40], ['ip', 16], ['userAgent', 40],
      ];
      if (req.isSuperAdmin) columns.splice(2, 0, ['enterprise', 24]);
      ws.columns = columns.map(([key, width]) => ({ header: T(`auditExport.col.${key}`), key, width }));
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
      for (const r of rows) {
        ws.addRow({
          date: new Date(r.created_at).toLocaleString(locale, { timeZone: tz }),
          action: T(`auditActions.${r.action}`) === `auditActions.${r.action}` ? r.action : T(`auditActions.${r.action}`),
          enterprise: r.enterprise_name || '',
          actor: [r.actor_name, r.user_email].filter(Boolean).join(' — '),
          target: r.entity_type === 'user' || r.target_email
            ? [r.target_name, r.target_email].filter(Boolean).join(' — ')
            : [r.entity_type ? T(`auditEntities.${r.entity_type}`) : null, r.entity_label || r.entity_ref].filter(Boolean).join(' — '),
          details: detailsText(r.new_value),
          before: detailsText(r.old_value),
          ip: r.ip_address || '',
          userAgent: r.user_agent || '',
        });
      }
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
      ws.eachRow(row => { row.alignment = { vertical: 'top', wrapText: true }; });

      await audit(req, AUDIT.AUDIT_LOG_EXPORTED, { details: { filters, rows: rows.length } });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="audit_${new Date().toISOString().slice(0, 10)}.xlsx"`);
      await wb.xlsx.write(res);
      res.end();
    } catch (error) {
      console.error('Export du journal d\'audit :', error);
      res.status(500).json({ success: false, message: 'Erreur lors de l\'export du journal d\'audit' });
    }
  },
};
