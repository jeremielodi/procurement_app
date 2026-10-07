// backend/src/services/StockIssuePdfService.js
// Bon de sortie de stock (PDF, FR/EN) : identité de l'entreprise, bénéficiaire, dépôt, articles / lots,
// signatures (magasinier, bénéficiaire). Helpers Handlebars préfixés « sis_ ».
const puppeteer = require('puppeteer');
const Handlebars = require('handlebars');
const { getBrowserOptions } = require('../config/puppeteer');
const { getBranding } = require('../utils/enterpriseBranding');
const { pdfContext, rootLocale } = require('../utils/pdfI18n');
const stockIssueModel = require('../models/StockIssueModel');

const safe = (name, fn) => { if (!Handlebars.helpers[name]) Handlebars.registerHelper(name, fn); };
safe('sis_date', (d, options) => (d ? new Date(d).toLocaleDateString(rootLocale(options), { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'));
safe('sis_datetime', (d, options) => (d ? new Date(d).toLocaleString(rootLocale(options), { dateStyle: 'short', timeStyle: 'short' }) : '—'));
safe('sis_qty', (n, options) => new Intl.NumberFormat(rootLocale(options), { maximumFractionDigits: 4 }).format(Number(n) || 0));
safe('sis_index1', (i) => i + 1);

const TEMPLATE = `<!doctype html>
<html lang="{{lang}}"><head><meta charset="utf-8"><title>{{issue.issue_number}}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111827; margin: 0; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1E40AF; padding-bottom: 10px; }
  .brand { display: flex; gap: 12px; align-items: center; }
  .brand img { max-height: 56px; max-width: 150px; object-fit: contain; }
  .brand h2 { margin: 0; font-size: 15px; color: #1E40AF; }
  .brand div { color: #4B5563; line-height: 1.4; }
  .title { text-align: right; }
  .title h1 { margin: 0; font-size: 17px; letter-spacing: .5px; }
  .title .num { font-size: 13px; color: #1E40AF; font-weight: bold; margin-top: 3px; }
  .cancelled { display: inline-block; margin-top: 4px; padding: 2px 8px; border-radius: 10px; background: #FEE2E2; color: #B91C1C; font-weight: bold; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 14px 0; }
  .box { border: 1px solid #E5E7EB; border-radius: 6px; padding: 10px; }
  .box h3 { margin: 0 0 6px; font-size: 10px; color: #6B7280; text-transform: uppercase; }
  .row { display: flex; justify-content: space-between; padding: 2px 0; gap: 8px; }
  .row span:first-child { color: #6B7280; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #1E40AF; color: #fff; padding: 7px 6px; text-align: left; font-size: 10px; }
  td { padding: 6px; border-bottom: 1px solid #E5E7EB; vertical-align: top; }
  .n { text-align: right; white-space: nowrap; }
  .muted { color: #6B7280; font-size: 9px; }
  .ack { margin-top: 12px; padding: 8px 10px; border-radius: 6px; background: #ECFDF5; color: #065F46; }
  .signatures { display: flex; justify-content: space-between; gap: 16px; margin-top: 28px; page-break-inside: avoid; }
  .sig { flex: 1; border: 1px dashed #9CA3AF; border-radius: 6px; height: 110px; padding: 8px; color: #6B7280; }
  .sig b { display: block; color: #111827; margin: 4px 0; }
</style></head>
<body>
  <div class="header">
    <div class="brand">
      {{#if brand.logo}}<img src="{{brand.logo}}" alt="">{{/if}}
      <div><h2>{{brand.name}}</h2><div>{{#if brand.address}}{{brand.address}}<br>{{/if}}{{#if brand.phone}}{{brand.phone}}{{/if}}{{#if brand.email}} · {{brand.email}}{{/if}}</div></div>
    </div>
    <div class="title">
      <h1>{{#if transfer}}{{L.transferTitle}}{{else}}{{L.title}}{{/if}}</h1>
      <div class="num">{{issue.issue_number}}</div>
      <div>{{L.date}} : <b>{{sis_datetime issue.issued_at}}</b></div>
      {{#if cancelled}}<div class="cancelled">{{L.cancelled}}</div>{{/if}}
    </div>
  </div>

  <div class="grid">
    <div class="box">
      <h3>{{L.destination}}</h3>
      <div class="row"><span>{{L.destinationType}}</span><b>{{T.destinationType}}</b></div>
      {{#if transfer}}
      <div class="row"><span>{{L.destinationWarehouse}}</span><b>{{issue.destination_warehouse_name}} ({{issue.destination_warehouse_code}})</b></div>
      <div class="row"><span>{{L.location}}</span><span>{{issue.destination_warehouse_location}}</span></div>
      {{else}}{{#if department}}
      <div class="row"><span>{{L.department}}</span><b>{{issue.department_code}} — {{issue.department_name}}</b></div>
      {{#if issue.recipient_id}}<div class="row"><span>{{L.collectedBy}}</span><span>{{issue.recipient_name}}</span></div>{{/if}}
      {{else}}
      <div class="row"><span>{{L.name}}</span><b>{{issue.recipient_name}}</b></div>
      <div class="row"><span>{{L.email}}</span><span>{{issue.recipient_email}}</span></div>
      {{/if}}{{/if}}
      {{#if issue.project_name}}<div class="row"><span>{{L.project}}</span><span>{{issue.project_code}} — {{issue.project_name}}</span></div>{{/if}}
    </div>
    <div class="box">
      <h3>{{#if transfer}}{{L.sourceWarehouse}}{{else}}{{L.warehouse}}{{/if}}</h3>
      <div class="row"><span>{{L.warehouse}}</span><b>{{issue.warehouse_name}} ({{issue.warehouse_code}})</b></div>
      <div class="row"><span>{{L.location}}</span><span>{{issue.warehouse_location}}</span></div>
      <div class="row"><span>{{L.issuedBy}}</span><span>{{issue.issued_by_name}}</span></div>
    </div>
  </div>
  {{#if issue.purpose}}<div class="box" style="margin-bottom:12px"><h3>{{L.purpose}}</h3>{{issue.purpose}}</div>{{/if}}

  <table>
    <thead><tr><th style="width:26px">{{L.no}}</th><th>{{L.code}}</th><th>{{L.item}}</th><th>{{L.lot}}</th><th class="n">{{L.quantity}}</th><th>{{L.unit}}</th></tr></thead>
    <tbody>
      {{#each issue.lines}}
      <tr>
        <td>{{sis_index1 @index}}</td>
        <td><b>{{this.item_code}}</b></td>
        <td>{{this.item_name}}<div class="muted">{{this.movement_number}}</div></td>
        <td>{{#if this.lot_number}}{{this.lot_number}}{{#if this.expiry_date}}<div class="muted">{{@root.L.expiry}} {{sis_date this.expiry_date}}</div>{{/if}}{{else}}—{{/if}}</td>
        <td class="n">{{sis_qty this.quantity}}</td>
        <td>{{this.unit}}</td>
      </tr>
      {{/each}}
    </tbody>
  </table>

  {{#if issue.acknowledged_at}}
  <div class="ack">{{T.acknowledged}}{{#if issue.acknowledgement_comment}} — « {{issue.acknowledgement_comment}} »{{/if}}</div>
  {{/if}}
  {{#if cancelled}}
  <div class="ack" style="background:#FEF2F2;color:#991B1B">{{T.cancelled}}</div>
  {{/if}}

  <div class="signatures">
    <div class="sig">{{L.storekeeper}}<b>{{issue.issued_by_name}}</b>{{L.signature}}</div>
    <div class="sig">{{#if transfer}}{{L.receiverSignature}}<b>{{issue.destination_warehouse_name}}</b>{{else}}{{L.recipientSignature}}<b>{{T.receiverName}}</b>{{/if}}{{L.signature}}</div>
  </div>
</body></html>`;

class StockIssuePdfService {
  /** @returns {{ pdf: Buffer, issue: object } | null} */
  async generate(id, { lang } = {}) {
    const issue = await stockIssueModel.getById(id);
    if (!issue) return null;
    const ctx = pdfContext(lang, 'stockIssue');
    const brand = await getBranding(issue.enterprise_id);
    const dt = (d) => new Date(d).toLocaleString(ctx.locale, { dateStyle: 'short', timeStyle: 'short' });
    const transfer = issue.destination_type === 'WAREHOUSE';
    const department = issue.destination_type === 'DEPARTMENT';
    const T = {
      destinationType: ctx.t(`pdf.stockIssue.type${issue.destination_type || 'USER'}`),
      receiverName: department && !issue.recipient_id ? issue.department_name : issue.recipient_name,
      acknowledged: issue.acknowledged_at
        ? ctx.t('pdf.stockIssue.acknowledgedOn', { name: issue.acknowledged_by_name || issue.recipient_name || '—', date: dt(issue.acknowledged_at) }) : '',
      cancelled: issue.status === 'CANCELLED'
        ? ctx.t(transfer ? 'pdf.stockIssue.transferCancelledOn' : 'pdf.stockIssue.cancelledOn',
          { name: issue.cancelled_by_name || '—', date: dt(issue.cancelled_at), reason: issue.cancel_reason || '—' }) : '',
    };
    const html = Handlebars.compile(TEMPLATE)({ issue, brand, cancelled: issue.status === 'CANCELLED', transfer, department, T, ...ctx });
    const browser = await puppeteer.launch(getBrowserOptions());
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
        footerTemplate: `
          <div style="width:100%;font-size:9px;color:#9CA3AF;padding:0 15mm;display:flex;justify-content:space-between">
            <span>${String(issue.issue_number).replace(/[<>&]/g, '')} — ${String(brand.name).replace(/[<>&]/g, '')}</span>
            <span>${ctx.L.page} <span class="pageNumber"></span> / <span class="totalPages"></span></span>
          </div>`,
        margin: { top: '15mm', bottom: '18mm', left: '15mm', right: '15mm' },
      });
      return { pdf, issue };
    } finally {
      await browser.close();
    }
  }
}

module.exports = new StockIssuePdfService();
