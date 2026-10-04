// backend/src/services/GoodsReceiptExportService.js
// PDF du bon de réception (GRN) — Puppeteer + Handlebars, helpers préfixés grn_
const puppeteer = require('puppeteer');
const Handlebars = require('handlebars');
const db = require('../config/database');
const { getBrowserOptions } = require('../config/puppeteer');

const STATUS = {
  DRAFT:    { label: 'Brouillon',   color: '#374151', bg: '#F3F4F6' },
  PENDING:  { label: 'En attente',  color: '#92400E', bg: '#FEF3C7' },
  PARTIAL:  { label: 'Partielle',   color: '#9A3412', bg: '#FFEDD5' },
  COMPLETE: { label: 'Complète',    color: '#065F46', bg: '#D1FAE5' },
};

class GoodsReceiptExportService {
  constructor() {
    const safe = (name, fn) => {
      if (!Handlebars.helpers[name]) Handlebars.registerHelper(name, fn);
    };
    safe('grn_formatDate', (d) => d
      ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '—');
    safe('grn_num', (n) => (n === null || n === undefined || n === '') ? '—' : new Intl.NumberFormat('fr-FR').format(n));
    safe('grn_index1', (i) => i + 1);
    safe('grn_statusLabel', (s) => (STATUS[s] || { label: s }).label);
    safe('grn_statusColor', (s) => (STATUS[s] || STATUS.DRAFT).color);
    safe('grn_statusBg', (s) => (STATUS[s] || STATUS.DRAFT).bg);
  }

  /** Données complètes du GRN : en-tête, commande, fournisseur, réquisition, articles */
  async getData(id) {
    const grn = await db.one(
      `SELECT grn.*,
              po.po_number, po.order_date, po.delivery_date,
              r.requisition_number, r.title AS requisition_title,
              s.name AS supplier_name, s.supplier_code, s.phone AS supplier_phone,
              s.email AS supplier_email, s.address AS supplier_address,
              u.first_name || ' ' || u.last_name AS received_by_name,
              COALESCE(e.name, (SELECT name FROM enterprise ORDER BY created_at LIMIT 1)) AS enterprise_name
       FROM goods_receipt_notes grn
       LEFT JOIN purchase_orders po ON po.id = grn.po_id
       LEFT JOIN requisitions r     ON r.id = po.requisition_id
       LEFT JOIN suppliers s        ON s.id = po.supplier_id
       LEFT JOIN users u            ON u.id = grn.received_by
       LEFT JOIN enterprise e       ON e.id = u.enterprise_id
       WHERE grn.id = $1`,
      [id]
    );
    if (!grn) return null;
    const items = await db.select('SELECT * FROM goods_receipt_items WHERE grn_id = $1 ORDER BY id', [id]);
    const totals = items.reduce((t, i) => ({
      received: t.received + (parseInt(i.quantity_received) || 0),
      accepted: t.accepted + (parseInt(i.quantity_accepted) || 0),
      rejected: t.rejected + (parseInt(i.quantity_rejected) || 0),
    }), { received: 0, accepted: 0, rejected: 0 });
    return { ...grn, items, totals };
  }

  getTemplate() {
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>{{grn.grn_number}}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111827; margin: 0; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1E3A5F; padding-bottom: 12px; }
  .org { font-size: 10px; color: #6B7280; text-transform: uppercase; letter-spacing: .5px; }
  h1 { margin: 4px 0; font-size: 22px; color: #1E3A5F; }
  .num { font-size: 15px; font-weight: bold; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 10px; font-weight: bold; }
  .meta { text-align: right; color: #4B5563; line-height: 1.7; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 16px 0; }
  .box { border: 1px solid #E5E7EB; border-radius: 6px; padding: 10px; }
  .box h3 { margin: 0 0 6px; font-size: 10px; color: #6B7280; text-transform: uppercase; }
  .row { display: flex; justify-content: space-between; padding: 2px 0; }
  .row span:first-child { color: #6B7280; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #1E3A5F; color: #fff; padding: 7px 6px; text-align: left; font-size: 10px; }
  td { padding: 6px; border-bottom: 1px solid #E5E7EB; vertical-align: top; }
  tr:nth-child(even) td { background: #F9FAFB; }
  .n { text-align: right; white-space: nowrap; }
  .rej { color: #B91C1C; font-weight: bold; }
  .reason { color: #B91C1C; font-size: 9px; margin-top: 2px; }
  tfoot td { font-weight: bold; background: #E0E7FF !important; }
  .obs { margin-top: 12px; white-space: pre-line; }
  .signatures { display: flex; gap: 12px; margin-top: 28px; page-break-inside: avoid; }
  .sig { flex: 1; border: 1px dashed #9CA3AF; border-radius: 6px; height: 110px; padding: 8px; color: #6B7280; font-size: 10px; }
  .sig b { color: #111827; display: block; margin-top: 4px; }
</style></head>
<body>
  <div class="header">
    <div>
      <div class="org">{{#if grn.enterprise_name}}{{grn.enterprise_name}} — {{/if}}procureApp</div>
      <h1>BON DE RÉCEPTION</h1>
      <div class="num">{{grn.grn_number}}</div>
    </div>
    <div class="meta">
      <span class="badge" style="color:{{grn_statusColor grn.status}};background:{{grn_statusBg grn.status}}">{{grn_statusLabel grn.status}}</span><br>
      Date de réception : <b>{{grn_formatDate grn.receipt_date}}</b><br>
      Commande : <b>{{grn.po_number}}</b><br>
      {{#if grn.requisition_number}}Réquisition : {{grn.requisition_number}}{{/if}}
    </div>
  </div>

  <div class="grid">
    <div class="box">
      <h3>Fournisseur</h3>
      <div><b>{{grn.supplier_name}}</b>{{#if grn.supplier_code}} ({{grn.supplier_code}}){{/if}}</div>
      {{#if grn.supplier_address}}<div>{{grn.supplier_address}}</div>{{/if}}
      <div>{{#if grn.supplier_phone}}{{grn.supplier_phone}}{{/if}}{{#if grn.supplier_email}} · {{grn.supplier_email}}{{/if}}</div>
    </div>
    <div class="box">
      <h3>Commande</h3>
      <div class="row"><span>Date de commande</span><span>{{grn_formatDate grn.order_date}}</span></div>
      <div class="row"><span>Livraison prévue</span><span>{{grn_formatDate grn.delivery_date}}</span></div>
      {{#if grn.requisition_title}}<div class="row"><span>Objet</span><span>{{grn.requisition_title}}</span></div>{{/if}}
    </div>
  </div>

  <table>
    <thead><tr>
      <th style="width:28px">N°</th><th>Désignation</th>
      <th class="n">Qté reçue</th><th class="n">Qté acceptée</th><th class="n">Qté rejetée</th>
    </tr></thead>
    <tbody>
      {{#each items}}
      <tr>
        <td>{{grn_index1 @index}}</td>
        <td>{{this.item_description}}{{#if this.rejection_reason}}<div class="reason">Motif de rejet : {{this.rejection_reason}}</div>{{/if}}</td>
        <td class="n">{{grn_num this.quantity_received}}</td>
        <td class="n">{{grn_num this.quantity_accepted}}</td>
        <td class="n {{#if this.quantity_rejected}}rej{{/if}}">{{grn_num this.quantity_rejected}}</td>
      </tr>
      {{else}}
      <tr><td colspan="5" style="text-align:center;color:#9CA3AF">Aucun article</td></tr>
      {{/each}}
    </tbody>
    <tfoot><tr>
      <td colspan="2" class="n">TOTAL</td>
      <td class="n">{{grn_num totals.received}}</td>
      <td class="n">{{grn_num totals.accepted}}</td>
      <td class="n">{{grn_num totals.rejected}}</td>
    </tr></tfoot>
  </table>

  {{#if grn.observations}}
  <div class="box obs"><h3>Observations</h3>{{grn.observations}}</div>
  {{/if}}

  <div class="signatures">
    <div class="sig">Réceptionné par<b>{{grn.received_by_name}}</b><br>Signature :</div>
    <div class="sig">Livreur (fournisseur)<br><br>Nom et signature :</div>
    <div class="sig">Visa logistique / magasin<br><br>Signature et cachet :</div>
  </div>
</body></html>`;
  }

  async generatePDF(id) {
    const grn = await this.getData(id);
    if (!grn) return null;
    const html = Handlebars.compile(this.getTemplate())({ grn, items: grn.items, totals: grn.totals });

    const browser = await puppeteer.launch(getBrowserOptions());
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `
          <div style="width:100%;font-size:9px;color:#9CA3AF;padding:0 15mm;display:flex;justify-content:space-between">
            <span>${String(grn.grn_number).replace(/[<>&]/g, '')}</span>
            <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
          </div>`,
        margin: { top: '15mm', bottom: '18mm', left: '15mm', right: '15mm' },
      });
      return { pdf, grn };
    } finally {
      await browser.close();
    }
  }
}

module.exports = new GoodsReceiptExportService();
