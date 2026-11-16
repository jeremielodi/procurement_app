// backend/src/services/StockIncidentPdfService.js
// Rapport d'incident (PDF, FR/EN) : identité de l'entreprise, employé détenteur (fonction figée), type / date / lieu,
// circonstances, articles concernés (n° de série, n° d'inventaire, lot, bon de sortie), décision du chef de projet
// (responsabilité de l'employé, commentaire, intérim) et signatures (employé, déclarant si différent, validateur).
// Helpers « sinc_ ». Valeurs saisies en encre bleue (classe ink), comme les autres formulaires.
const Handlebars = require('handlebars');
const { renderPdf } = require('../utils/pdfRenderer');
const { signatureDataUri } = require('../utils/userSignature');
const { getBranding, brandContact } = require('../utils/enterpriseBranding');
const { pdfContext, rootLocale } = require('../utils/pdfI18n');
const stockIncidentModel = require('../models/StockIncidentModel');

const safe = (name, fn) => { if (!Handlebars.helpers[name]) Handlebars.registerHelper(name, fn); };
safe('sinc_date', (d, options) => (d ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d}T00:00:00` : d)
  .toLocaleDateString(rootLocale(options), { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'));
safe('sinc_datetime', (d, options) => (d ? new Date(d).toLocaleString(rootLocale(options), { dateStyle: 'short', timeStyle: 'short' }) : '—'));
safe('sinc_qty', (n, options) => new Intl.NumberFormat(rootLocale(options), { maximumFractionDigits: 4 }).format(Number(n) || 0));
safe('sinc_index1', (i) => i + 1);

const TEMPLATE = `<!doctype html>
<html lang="{{lang}}"><head><meta charset="utf-8"><title>{{inc.incident_number}}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111827; margin: 0; }
  .ink { color: #1E3FA8; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #B91C1C; padding-bottom: 10px; }
  .brand { display: flex; gap: 12px; align-items: center; }
  .brand img { max-height: 56px; max-width: 150px; object-fit: contain; }
  .brand h2 { margin: 0; font-size: 15px; color: #111827; }
  .brand div { color: #4B5563; line-height: 1.4; }
  .title { text-align: right; }
  .title h1 { margin: 0; font-size: 17px; letter-spacing: .5px; color: #B91C1C; }
  .title .num { font-size: 13px; font-weight: bold; margin-top: 3px; }
  .status { display: inline-block; margin-top: 4px; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: bold; }
  .st-PENDING { background: #FEF3C7; color: #92400E; } .st-VALIDATED { background: #D1FAE5; color: #065F46; }
  .st-REJECTED { background: #FEE2E2; color: #991B1B; } .st-CANCELLED { background: #E5E7EB; color: #374151; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 14px 0; }
  .box { border: 1px solid #E5E7EB; border-radius: 6px; padding: 10px; margin-bottom: 10px; }
  .box h3 { margin: 0 0 6px; font-size: 10px; color: #6B7280; text-transform: uppercase; }
  .row { display: flex; justify-content: space-between; padding: 2px 0; gap: 8px; }
  .row span:first-child { color: #6B7280; }
  .text { white-space: pre-wrap; line-height: 1.45; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #374151; color: #fff; padding: 7px 6px; text-align: left; font-size: 10px; }
  td { padding: 6px; border-bottom: 1px solid #E5E7EB; vertical-align: top; }
  .n { text-align: right; white-space: nowrap; }
  .muted { color: #6B7280; font-size: 9px; }
  .liable { font-weight: bold; } .liable.yes { color: #B91C1C; } .liable.no { color: #065F46; }
  .signatures { display: flex; justify-content: space-between; gap: 12px; margin-top: 24px; page-break-inside: avoid; }
  .sig { flex: 1; border: 1px dashed #9CA3AF; border-radius: 6px; min-height: 115px; padding: 8px; color: #6B7280; }
  .sig b { display: block; margin: 4px 0 2px; }
  .sig img { display: block; max-height: 46px; max-width: 160px; object-fit: contain; margin: 4px 0; }
</style></head>
<body>
  <div class="header">
    <div class="brand">
      {{#if brand.logo}}<img src="{{brand.logo}}" alt="">{{/if}}
      <div><h2>{{brand.name}}</h2><div>{{#if brand.address}}{{brand.address}}<br>{{/if}}{{contact}}</div></div>
    </div>
    <div class="title">
      <h1>{{L.title}}</h1>
      <div class="num">{{inc.incident_number}}</div>
      <div>{{L.reportedOn}} : <b class="ink">{{sinc_datetime inc.reported_at}}</b></div>
      <span class="status st-{{inc.status}}">{{incStatusText}}</span>
    </div>
  </div>

  <div class="grid">
    <div class="box">
      <h3>{{L.holder}}</h3>
      <div class="row"><span>{{L.name}}</span><b class="ink">{{inc.holder_name}}</b></div>
      <div class="row"><span>{{L.position}}</span><span class="ink">{{#if inc.holder_position}}{{inc.holder_position}}{{else}}—{{/if}}</span></div>
      <div class="row"><span>{{L.email}}</span><span class="ink">{{inc.holder_email}}</span></div>
      {{#if reportedByOther}}<div class="row"><span>{{L.reportedBy}}</span><span class="ink">{{inc.reported_by_name}}</span></div>{{/if}}
    </div>
    <div class="box">
      <h3>{{L.incident}}</h3>
      <div class="row"><span>{{L.type}}</span><b class="ink">{{typeLabel}}</b></div>
      <div class="row"><span>{{L.date}}</span><span class="ink">{{sinc_date inc.incident_date}}</span></div>
      <div class="row"><span>{{L.place}}</span><span class="ink">{{#if inc.incident_place}}{{inc.incident_place}}{{else}}—{{/if}}</span></div>
      {{#if inc.police_reference}}<div class="row"><span>{{L.policeReference}}</span><span class="ink">{{inc.police_reference}}</span></div>{{/if}}
      <div class="row"><span>{{L.project}}</span><span class="ink">{{#if inc.project_code}}{{inc.project_code}} — {{inc.project_name}}{{else}}—{{/if}}</span></div>
    </div>
  </div>

  <div class="box"><h3>{{L.circumstances}}</h3><div class="text ink">{{inc.circumstances}}</div></div>

  <table>
    <thead><tr><th style="width:26px">{{L.no}}</th><th>{{L.code}}</th><th>{{L.item}}</th><th>{{L.serial}}</th><th>{{L.issue}}</th><th class="n">{{L.quantity}}</th></tr></thead>
    <tbody>
      {{#each inc.lines}}
      <tr>
        <td>{{sinc_index1 @index}}</td>
        <td class="ink"><b>{{this.item_code}}</b></td>
        <td class="ink">{{this.item_name}}</td>
        <td class="ink">{{#if this.serial_number}}{{this.serial_number}}{{#if this.asset_tag}}<div class="muted">{{this.asset_tag}}</div>{{/if}}{{else}}{{#if this.lot_number}}{{this.lot_number}}{{else}}—{{/if}}{{/if}}</td>
        <td class="ink">{{this.issue_number}}<div class="muted">{{sinc_date this.issued_at}} · {{this.warehouse_name}}</div></td>
        <td class="n ink">{{sinc_qty this.quantity}} {{this.unit}}</td>
      </tr>
      {{/each}}
    </tbody>
  </table>

  <div class="box" style="margin-top:14px">
    <h3>{{L.decision}}</h3>
    {{#if decided}}
      <div class="row"><span>{{L.decisionLabel}}</span><b class="ink">{{incStatusText}}</b></div>
      <div class="row"><span>{{L.decidedBy}}</span><span class="ink">{{decidedBy}}</span></div>
      {{#if inc.employee_liable_set}}<div class="row"><span>{{L.liability}}</span><span class="liable {{#if inc.employee_liable}}yes{{else}}no{{/if}}">{{liabilityLabel}}</span></div>{{/if}}
      {{#if decisionText}}<div class="text ink" style="margin-top:4px">{{decisionText}}</div>{{/if}}
    {{else}}
      <div class="muted">{{L.pending}}</div>
    {{/if}}
  </div>

  <div class="signatures">
    <div class="sig">{{L.holderSignature}}<b class="ink">{{inc.holder_name}}</b>{{#if holderSignature}}<img src="{{holderSignature}}" alt="">{{/if}}<span class="ink">{{sinc_date inc.reported_at}}</span></div>
    {{#if reportedByOther}}<div class="sig">{{L.reporterSignature}}<b class="ink">{{inc.reported_by_name}}</b>{{#if reporterSignature}}<img src="{{reporterSignature}}" alt="">{{/if}}<span class="ink">{{sinc_date inc.reported_at}}</span></div>{{/if}}
    <div class="sig">{{L.validatorSignature}}{{#if inc.validated_by}}<b class="ink">{{validatorLine}}</b>{{#if validatorSignature}}<img src="{{validatorSignature}}" alt="">{{/if}}<span class="ink">{{sinc_date inc.validated_at}}</span>{{/if}}</div>
  </div>
</body></html>`;

class StockIncidentPdfService {
  /** @returns {{ pdf: Buffer, inc: object } | null} */
  async generate(id, { lang, lines } = {}) {
    const inc = await stockIncidentModel.getById(id);
    if (!inc) return null;
    if (Array.isArray(lines)) inc.lines = lines;
    const ctx = pdfContext(lang, 'stockIncident');
    const { L } = ctx;
    const brand = await getBranding(inc.enterprise_id);
    const reportedByOther = String(inc.reported_by) !== String(inc.holder_id);
    const decided = ['VALIDATED', 'REJECTED', 'CANCELLED'].includes(inc.status);
    inc.employee_liable_set = inc.status === 'VALIDATED' && inc.employee_liable !== null;
    const validatorLine = inc.validated_by
      ? [inc.validated_by_name, inc.validated_by_position].filter(Boolean).join(' — ') + (inc.on_behalf_of_name ? ` (${L.onBehalfOf.replace('{name}', inc.on_behalf_of_name)})` : '')
      : '';
    const decidedBy = inc.status === 'VALIDATED' ? validatorLine
      : inc.status === 'REJECTED' ? inc.rejected_by_name : inc.cancelled_by_name;
    const html = Handlebars.compile(TEMPLATE)({
      ...ctx, inc, brand, contact: brandContact ? brandContact(brand) : '',
      reportedByOther, decided, decidedBy, validatorLine,
      typeLabel: L[`type${inc.incident_type}`] || inc.incident_type,
      incStatusText: L[`status${inc.status}`] || inc.status,
      liabilityLabel: inc.employee_liable ? L.liableYes : L.liableNo,
      decisionText: inc.status === 'VALIDATED' ? inc.decision_comment : inc.status === 'REJECTED' ? inc.reject_reason : inc.cancel_reason,
      holderSignature: await signatureDataUri(inc.holder_id),
      reporterSignature: reportedByOther ? await signatureDataUri(inc.reported_by) : null,
      validatorSignature: inc.validated_by ? await signatureDataUri(inc.validated_by) : null,
    });
    const esc = (v) => String(v ?? '').replace(/[<>&]/g, '');
    const pdf = await renderPdf(html, {
      displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: `
        <div style="width:100%;font-size:9px;color:#9CA3AF;padding:0 15mm;display:flex;justify-content:space-between">
          <span>${esc(inc.incident_number)} — ${esc(brand.name)}</span>
          <span>${L.page} <span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>`,
      margin: { top: '15mm', bottom: '18mm', left: '15mm', right: '15mm' },
    });
    return { pdf, inc };
  }
}

module.exports = new StockIncidentPdfService();
