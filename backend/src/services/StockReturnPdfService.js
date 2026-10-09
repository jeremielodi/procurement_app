// backend/src/services/StockReturnPdfService.js
// Bon de retour en stock (PDF, FR/EN) : identité de l'entreprise, personne ou département qui rend, dépôt de retour,
// articles / lots / n° de série, état au retour, signatures (magasinier, personne qui rend). Helpers « sret_ ».
const Handlebars = require('handlebars');
const { renderPdf } = require('../utils/pdfRenderer');
const { getBranding } = require('../utils/enterpriseBranding');
const { pdfContext, rootLocale, rootLabels } = require('../utils/pdfI18n');
const equipmentModel = require('../models/StockEquipmentModel');

const safe = (name, fn) => { if (!Handlebars.helpers[name]) Handlebars.registerHelper(name, fn); };
safe('sret_datetime', (d, options) => (d ? new Date(d).toLocaleString(rootLocale(options), { dateStyle: 'short', timeStyle: 'short' }) : '—'));
safe('sret_qty', (n, options) => new Intl.NumberFormat(rootLocale(options), { maximumFractionDigits: 4 }).format(Number(n) || 0));
safe('sret_index1', (i) => i + 1);
safe('sret_condition', (c, options) => rootLabels(options)?.[`condition${c}`] || c);

const TEMPLATE = `<!doctype html>
<html lang="{{lang}}"><head><meta charset="utf-8"><title>{{ret.return_number}}</title>
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
  .GOOD { color: #065F46; } .DAMAGED { color: #92400E; } .LOST { color: #B91C1C; font-weight: bold; }
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
      <h1>{{L.title}}</h1>
      <div class="num">{{ret.return_number}}</div>
      <div>{{L.date}} : <b>{{sret_datetime ret.received_at}}</b></div>
    </div>
  </div>

  <div class="grid">
    <div class="box">
      <h3>{{L.returnedBy}}</h3>
      {{#if ret.department_name}}
      <div class="row"><span>{{L.department}}</span><b>{{ret.department_code}} — {{ret.department_name}}</b></div>
      {{else}}
      <div class="row"><span>{{L.name}}</span><b>{{ret.returned_by_name}}</b></div>
      <div class="row"><span>{{L.email}}</span><span>{{ret.returned_by_email}}</span></div>
      {{/if}}
    </div>
    <div class="box">
      <h3>{{L.warehouse}}</h3>
      <div class="row"><span>{{L.warehouse}}</span><b>{{ret.warehouse_name}} ({{ret.warehouse_code}})</b></div>
      <div class="row"><span>{{L.receivedBy}}</span><span>{{ret.received_by_name}}</span></div>
    </div>
  </div>
  {{#if ret.comment}}<div class="box" style="margin-bottom:12px"><h3>{{L.comment}}</h3>{{ret.comment}}</div>{{/if}}

  <table>
    <thead><tr><th style="width:26px">{{L.no}}</th><th>{{L.code}}</th><th>{{L.item}}</th><th>{{L.lotOrSerial}}</th><th>{{L.issue}}</th><th class="n">{{L.quantity}}</th><th>{{L.condition}}</th></tr></thead>
    <tbody>
      {{#each ret.lines}}
      <tr>
        <td>{{sret_index1 @index}}</td>
        <td><b>{{this.item_code}}</b></td>
        <td>{{this.item_name}}<div class="muted">{{this.movement_number}}</div></td>
        <td>{{#if this.serial_number}}{{this.serial_number}}{{#if this.asset_tag}}<div class="muted">{{this.asset_tag}}</div>{{/if}}{{else}}{{#if this.lot_number}}{{this.lot_number}}{{else}}—{{/if}}{{/if}}</td>
        <td>{{this.issue_number}}</td>
        <td class="n">{{sret_qty this.quantity}} {{this.unit}}</td>
        <td class="{{this.condition}}">{{sret_condition this.condition}}</td>
      </tr>
      {{/each}}
    </tbody>
  </table>

  <div class="signatures">
    <div class="sig">{{L.storekeeper}}<b>{{ret.received_by_name}}</b>{{L.signature}}</div>
    <div class="sig">{{L.returnerSignature}}<b>{{#if ret.department_name}}{{ret.department_name}}{{else}}{{ret.returned_by_name}}{{/if}}</b>{{L.signature}}</div>
  </div>
</body></html>`;

class StockReturnPdfService {
  /** @returns {{ pdf: Buffer, ret: object } | null} */
  async generate(id, { lang } = {}) {
    const ret = await equipmentModel.getReturn(id);
    if (!ret) return null;
    const ctx = pdfContext(lang, 'stockReturn');
    const brand = await getBranding(ret.enterprise_id);
    const html = Handlebars.compile(TEMPLATE)({ ret, brand, ...ctx });
    const esc = (v) => String(v ?? '').replace(/[<>&]/g, '');
    const pdf = await renderPdf(html, {
      displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: `
        <div style="width:100%;font-size:9px;color:#9CA3AF;padding:0 15mm;display:flex;justify-content:space-between">
          <span>${esc(ret.return_number)} — ${esc(brand.name)}</span>
          <span>${ctx.L.page} <span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>`,
      margin: { top: '15mm', bottom: '18mm', left: '15mm', right: '15mm' },
    });
    return { pdf, ret };
  }
}

module.exports = new StockReturnPdfService();
