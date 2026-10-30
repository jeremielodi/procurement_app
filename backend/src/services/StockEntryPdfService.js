// backend/src/services/StockEntryPdfService.js
// Bon d'entrée en stock (PDF, FR/EN) : identité de l'entreprise, type et provenance, dépôt, articles / lots / n° de série,
// coûts (si saisis), signatures (magasinier qui l'a saisi, valideur, personne qui a remis les articles).
// Helpers Handlebars préfixés « sen_ ».
const Handlebars = require('handlebars');
const { renderPdf } = require('../utils/pdfRenderer');
const { signatureDataUri } = require('../utils/userSignature');
const { getBranding } = require('../utils/enterpriseBranding');
const { pdfContext, rootLocale } = require('../utils/pdfI18n');
const stockEntryModel = require('../models/StockEntryModel');

const safe = (name, fn) => { if (!Handlebars.helpers[name]) Handlebars.registerHelper(name, fn); };
safe('sen_date', (d, options) => (d ? new Date(d).toLocaleDateString(rootLocale(options), { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'));
safe('sen_datetime', (d, options) => (d ? new Date(d).toLocaleString(rootLocale(options), { dateStyle: 'short', timeStyle: 'short' }) : '—'));
safe('sen_qty', (n, options) => new Intl.NumberFormat(rootLocale(options), { maximumFractionDigits: 4 }).format(Number(n) || 0));
safe('sen_money', (n, options) => (n === null || n === undefined ? '—'
  : new Intl.NumberFormat(rootLocale(options), { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(n))));
safe('sen_total', (q, c, options) => (c === null || c === undefined ? '—'
  : new Intl.NumberFormat(rootLocale(options), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(q) * Number(c))));
safe('sen_index1', (i) => i + 1);

const TEMPLATE = `<!doctype html>
<html lang="{{lang}}"><head><meta charset="utf-8"><title>{{entry.entry_number}}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111827; margin: 0; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #047857; padding-bottom: 10px; }
  .brand { display: flex; gap: 12px; align-items: center; }
  .brand img { max-height: 56px; max-width: 150px; object-fit: contain; }
  .brand h2 { margin: 0; font-size: 15px; color: #047857; }
  .brand div { color: #4B5563; line-height: 1.4; }
  .title { text-align: right; }
  .title h1 { margin: 0; font-size: 17px; letter-spacing: .5px; }
  .title .num { font-size: 13px; color: #047857; font-weight: bold; margin-top: 3px; }
  .badge { display: inline-block; margin-top: 4px; padding: 2px 8px; border-radius: 10px; font-weight: bold; }
  .badge.PENDING { background: #FEF3C7; color: #92400E; }
  .badge.REJECTED, .badge.CANCELLED { background: #FEE2E2; color: #B91C1C; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 14px 0; }
  .box { border: 1px solid #E5E7EB; border-radius: 6px; padding: 10px; }
  .box h3 { margin: 0 0 6px; font-size: 10px; color: #6B7280; text-transform: uppercase; }
  .row { display: flex; justify-content: space-between; padding: 2px 0; gap: 8px; }
  .row span:first-child { color: #6B7280; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #047857; color: #fff; padding: 7px 6px; text-align: left; font-size: 10px; }
  td { padding: 6px; border-bottom: 1px solid #E5E7EB; vertical-align: top; }
  tfoot td { font-weight: bold; border-bottom: none; }
  .n { text-align: right; white-space: nowrap; }
  .muted { color: #6B7280; font-size: 9px; }
  .serials { font-family: monospace; font-size: 9px; color: #3730A3; }
  .note { margin-top: 12px; padding: 8px 10px; border-radius: 6px; background: #ECFDF5; color: #065F46; }
  .note.bad { background: #FEF2F2; color: #991B1B; }
  .note.wait { background: #FFFBEB; color: #92400E; }
  .signatures { display: flex; justify-content: space-between; gap: 12px; margin-top: 28px; page-break-inside: avoid; }
  .sig { flex: 1; border: 1px dashed #9CA3AF; border-radius: 6px; height: 115px; padding: 8px; color: #6B7280; }
  .sig b { display: block; color: #111827; margin: 4px 0 0; }
  .sig i { display: block; font-style: normal; font-size: 9px; margin-bottom: 4px; }
  .sig img { display: block; max-height: 46px; max-width: 160px; object-fit: contain; margin-bottom: 4px; }
</style></head>
<body>
  <div class="header">
    <div class="brand">
      {{#if brand.logo}}<img src="{{brand.logo}}" alt="">{{/if}}
      <div><h2>{{brand.name}}</h2><div>{{#if brand.address}}{{brand.address}}<br>{{/if}}{{#if brand.phone}}{{brand.phone}}{{/if}}{{#if brand.email}} · {{brand.email}}{{/if}}</div></div>
    </div>
    <div class="title">
      <h1>{{L.title}}</h1>
      <div class="num">{{entry.entry_number}}</div>
      <div>{{L.date}} : <b>{{sen_datetime entry.created_at}}</b></div>
      {{#if T.statusBadge}}<div class="badge {{entry.status}}">{{T.statusBadge}}</div>{{/if}}
    </div>
  </div>

  <div class="grid">
    <div class="box">
      <h3>{{L.origin}}</h3>
      <div class="row"><span>{{L.entryType}}</span><b>{{T.entryType}}</b></div>
      {{#if entry.origin}}<div class="row"><span>{{T.originLabel}}</span><b>{{entry.origin}}</b></div>{{/if}}
      {{#if entry.reference}}<div class="row"><span>{{L.reference}}</span><span>{{entry.reference}}</span></div>{{/if}}
      {{#if entry.delivered_by}}<div class="row"><span>{{L.deliveredBy}}</span><span>{{entry.delivered_by}}</span></div>{{/if}}
      {{#if entry.project_name}}<div class="row"><span>{{L.project}}</span><span>{{entry.project_code}} — {{entry.project_name}}</span></div>{{/if}}
    </div>
    <div class="box">
      <h3>{{L.warehouse}}</h3>
      <div class="row"><span>{{L.warehouse}}</span><b>{{entry.warehouse_name}} ({{entry.warehouse_code}})</b></div>
      <div class="row"><span>{{L.location}}</span><span>{{entry.warehouse_location}}</span></div>
      <div class="row"><span>{{L.recordedBy}}</span><span>{{entry.created_by_name}}</span></div>
      {{#if entry.validated_at}}<div class="row"><span>{{L.validatedBy}}</span><span>{{entry.validated_by_name}} — {{sen_datetime entry.validated_at}}</span></div>{{/if}}
    </div>
  </div>
  {{#if entry.reason}}<div class="box" style="margin-bottom:12px"><h3>{{L.reason}}</h3>{{entry.reason}}</div>{{/if}}

  <table>
    <thead><tr>
      <th style="width:26px">{{L.no}}</th><th>{{L.code}}</th><th>{{L.item}}</th><th>{{L.lot}}</th><th class="n">{{L.quantity}}</th><th>{{L.unit}}</th>
      {{#if hasCost}}<th class="n">{{L.unitCost}}</th><th class="n">{{L.total}}</th>{{/if}}
    </tr></thead>
    <tbody>
      {{#each entry.lines}}
      <tr>
        <td>{{sen_index1 @index}}</td>
        <td><b>{{this.item_code}}</b></td>
        <td>{{this.item_name}}{{#if this.movement_number}}<div class="muted">{{this.movement_number}}</div>{{/if}}
          {{#if this.serialText}}<div class="serials">{{this.serialText}}</div>{{/if}}</td>
        <td>{{#if this.lot_number}}{{this.lot_number}}{{#if this.expiry_date}}<div class="muted">{{@root.L.expiry}} {{sen_date this.expiry_date}}</div>{{/if}}{{else}}{{#if this.expiry_date}}<span class="muted">{{@root.L.expiry}} {{sen_date this.expiry_date}}</span>{{else}}—{{/if}}{{/if}}</td>
        <td class="n">{{sen_qty this.quantity}}</td>
        <td>{{this.unit}}</td>
        {{#if @root.hasCost}}<td class="n">{{sen_money this.unit_cost}}</td><td class="n">{{sen_total this.quantity this.unit_cost}}</td>{{/if}}
      </tr>
      {{/each}}
    </tbody>
    {{#if entry.total_value}}
    <tfoot><tr><td colspan="7" class="n">{{L.totalValue}}{{#if entry.currency_code}} ({{entry.currency_code}}){{/if}}</td><td class="n">{{sen_money entry.total_value}}</td></tr></tfoot>
    {{/if}}
  </table>

  {{#if T.note}}<div class="note {{T.noteClass}}">{{T.note}}</div>{{/if}}

  <div class="signatures">
    <div class="sig">{{L.deliveredSignature}}<b>{{#if entry.delivered_by}}{{entry.delivered_by}}{{else}}&nbsp;{{/if}}</b><i>&nbsp;</i>{{L.signature}}</div>
    <div class="sig">{{L.storekeeper}}<b>{{entry.created_by_name}}</b><i>{{#if entry.created_by_position}}{{entry.created_by_position}}{{else}}&nbsp;{{/if}}</i>{{#if sig.creator}}<img src="{{sig.creator}}" alt="">{{/if}}{{L.signature}}</div>
    <div class="sig">{{L.validator}}<b>{{#if entry.validated_by_name}}{{entry.validated_by_name}}{{else}}&nbsp;{{/if}}</b><i>{{#if entry.validated_by_position}}{{entry.validated_by_position}}{{else}}&nbsp;{{/if}}</i>{{#if sig.validator}}<img src="{{sig.validator}}" alt="">{{/if}}{{L.signature}}</div>
  </div>
</body></html>`;

class StockEntryPdfService {
  /** @returns {{ pdf: Buffer, entry: object } | null} */
  async generate(id, { lang } = {}) {
    const entry = await stockEntryModel.getById(id);
    if (!entry) return null;
    const ctx = pdfContext(lang, 'stockEntry');
    const brand = await getBranding(entry.enterprise_id);
    const dt = (d) => new Date(d).toLocaleString(ctx.locale, { dateStyle: 'short', timeStyle: 'short' });
    // N° de série : ceux des équipements créés (avec n° d'inventaire) une fois validé, sinon ceux saisis
    for (const l of entry.lines) {
      l.serialText = (l.units || []).length
        ? l.units.map(u => (u.asset_tag ? `${u.serial_number} (${u.asset_tag})` : u.serial_number)).join(', ')
        : (l.serials || []).join(', ');
    }
    const notes = {
      PENDING: [ctx.t('pdf.stockEntry.pendingNote'), 'wait'],
      REJECTED: [ctx.t('pdf.stockEntry.rejectedOn', { name: entry.rejected_by_name || '—', date: entry.rejected_at ? dt(entry.rejected_at) : '—', reason: entry.reject_reason || '—' }), 'bad'],
      CANCELLED: [ctx.t(entry.validated_at ? 'pdf.stockEntry.cancelledAfterValidationOn' : 'pdf.stockEntry.cancelledOn',
        { name: entry.cancelled_by_name || '—', date: entry.cancelled_at ? dt(entry.cancelled_at) : '—', reason: entry.cancel_reason || '—' }), 'bad'],
    }[entry.status];
    const T = {
      entryType: ctx.t(`pdf.stockEntry.type${entry.entry_type}`),
      originLabel: ctx.t(`pdf.stockEntry.originLabel${entry.entry_type}`),
      statusBadge: entry.status === 'VALIDATED' ? '' : ctx.t(`pdf.stockEntry.status${entry.status}`),
      note: notes?.[0] || '',
      noteClass: notes?.[1] || '',
    };
    // Signatures images : seulement des personnes qui ont réellement agi dans l'application
    const sig = {
      creator: await signatureDataUri(entry.created_by),
      validator: entry.validated_at ? await signatureDataUri(entry.validated_by) : null,
    };
    const hasCost = entry.lines.some(l => l.unit_cost !== null);
    const html = Handlebars.compile(TEMPLATE)({ entry, brand, hasCost, T, sig, ...ctx });
    const pdf = await renderPdf(html, {
      format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: `
        <div style="width:100%;font-size:9px;color:#9CA3AF;padding:0 15mm;display:flex;justify-content:space-between">
          <span>${String(entry.entry_number).replace(/[<>&]/g, '')} — ${String(brand.name).replace(/[<>&]/g, '')}</span>
          <span>${ctx.L.page} <span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>`,
      margin: { top: '15mm', bottom: '18mm', left: '15mm', right: '15mm' },
    });
    return { pdf, entry };
  }
}

module.exports = new StockEntryPdfService();
