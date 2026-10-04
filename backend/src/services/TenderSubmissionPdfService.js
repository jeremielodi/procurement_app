// backend/src/services/TenderSubmissionPdfService.js
// PDF de l'offre d'un fournisseur (à imprimer, cacheter, signer et renvoyer)
const puppeteer = require('puppeteer');
const Handlebars = require('handlebars');
const { getBrowserOptions } = require('../config/puppeteer');
const { logoDataUri } = require('../utils/logoUpload');

class TenderSubmissionPdfService {
  constructor() {
    const safe = (name, fn) => {
      if (!Handlebars.helpers[name]) Handlebars.registerHelper(name, fn);
    };
    safe('tsub_formatDate', (d) => d
      ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: process.env.APP_TIMEZONE || 'Africa/Kinshasa' })
      : '—');
    safe('tsub_money', (n) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      .format(parseFloat(n) || 0));
    safe('tsub_qty', (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(parseFloat(n) || 0));
    safe('tsub_index1', (i) => i + 1);
  }

  getTemplate() {
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>Offre {{tender.tender_number}} — {{supplier.name}}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111827; margin: 0; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1E40AF; padding-bottom: 12px; }
  .company { display: flex; gap: 14px; align-items: center; }
  .company img { max-height: 70px; max-width: 160px; object-fit: contain; }
  .company h1 { margin: 0 0 4px; font-size: 18px; color: #1E40AF; }
  .company div.info { color: #4B5563; line-height: 1.5; }
  .doc-title { text-align: right; }
  .doc-title h2 { margin: 0; font-size: 16px; text-transform: uppercase; letter-spacing: .5px; }
  .doc-title .num { font-size: 13px; color: #1E40AF; font-weight: bold; margin-top: 4px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 16px 0; }
  .box { border: 1px solid #E5E7EB; border-radius: 6px; padding: 10px; }
  .box h3 { margin: 0 0 6px; font-size: 11px; color: #6B7280; text-transform: uppercase; }
  .row { display: flex; justify-content: space-between; padding: 2px 0; }
  .row span:first-child { color: #6B7280; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #1E40AF; color: #fff; padding: 7px 6px; text-align: left; font-size: 10px; }
  td { padding: 6px; border-bottom: 1px solid #E5E7EB; vertical-align: top; }
  tr:nth-child(even) td { background: #F9FAFB; }
  .num-col { text-align: right; white-space: nowrap; }
  .comment { color: #6B7280; font-size: 9px; margin-top: 2px; }
  tfoot td { font-weight: bold; background: #DBEAFE !important; font-size: 12px; }
  .notes { margin-top: 12px; }
  .declaration { margin-top: 18px; color: #374151; line-height: 1.5; }
  .signature { display: flex; justify-content: space-between; margin-top: 24px; page-break-inside: avoid; }
  .sig-box { width: 48%; border: 1px dashed #9CA3AF; border-radius: 6px; height: 120px; padding: 8px; color: #6B7280; }
</style></head>
<body>
  <div class="header">
    <div class="company">
      {{#if logo}}<img src="{{logo}}" alt="logo">{{/if}}
      <div>
        <h1>{{supplier.name}}</h1>
        <div class="info">
          {{#if supplier.address}}{{supplier.address}}<br>{{/if}}
          {{#if supplier.phone}}Tél : {{supplier.phone}}{{/if}}{{#if supplier.email}} · {{supplier.email}}{{/if}}<br>
          {{#if supplier.registration_number}}RCCM : {{supplier.registration_number}}{{/if}}
          {{#if supplier.tax_id}} · N° impôt : {{supplier.tax_id}}{{/if}}
          {{#if supplier.website}}<br>{{supplier.website}}{{/if}}
        </div>
      </div>
    </div>
    <div class="doc-title">
      <h2>Offre de prix</h2>
      <div class="num">Appel d'offres N° {{tender.tender_number}}</div>
      {{#if tender.enterprise_name}}<div style="margin-top:4px">Acheteur : <b>{{tender.enterprise_name}}</b></div>{{/if}}
      <div style="margin-top:4px;color:#6B7280">Code fournisseur : {{supplier.supplier_code}}</div>
    </div>
  </div>

  <div class="grid">
    <div class="box">
      <h3>Appel d'offres</h3>
      <div class="row"><span>Objet</span><span>{{tender.title}}</span></div>
      <div class="row"><span>Clôture des soumissions</span><span>{{tsub_formatDate tender.end_date}}</span></div>
      <div class="row"><span>Délai de livraison maximum</span><span>{{tender.max_delivery_days}} jours</span></div>
    </div>
    <div class="box">
      <h3>Notre offre</h3>
      <div class="row"><span>Montant total</span><span><b>{{tsub_money submission.total_amount}} {{currency}}</b></span></div>
      <div class="row"><span>Délai de livraison proposé</span><span><b>{{submission.delivery_days}} jours</b></span></div>
      <div class="row"><span>Soumis / modifié le</span><span>{{tsub_formatDate submission.updated_at}}</span></div>
    </div>
  </div>

  <table>
    <thead><tr>
      <th style="width:28px">N°</th><th>Désignation</th>
      <th class="num-col">Quantité</th><th class="num-col">Prix unitaire ({{currency}})</th><th class="num-col">Total ({{currency}})</th>
    </tr></thead>
    <tbody>
      {{#each lines}}
      <tr>
        <td>{{tsub_index1 @index}}</td>
        <td>{{this.description}}{{#if this.comment}}<div class="comment">{{this.comment}}</div>{{/if}}</td>
        <td class="num-col">{{tsub_qty this.quantity}}</td>
        <td class="num-col">{{#if this.priced}}{{tsub_money this.unit_price}}{{else}}—{{/if}}</td>
        <td class="num-col">{{#if this.priced}}{{tsub_money this.total_price}}{{else}}Non chiffré{{/if}}</td>
      </tr>
      {{/each}}
    </tbody>
    <tfoot><tr>
      <td colspan="4" class="num-col">TOTAL GÉNÉRAL ({{currency}})</td>
      <td class="num-col">{{tsub_money submission.total_amount}}</td>
    </tr></tfoot>
  </table>

  {{#if submission.notes}}
  <div class="box notes"><h3>Remarques</h3>{{submission.notes}}</div>
  {{/if}}

  <p class="declaration">
    Nous, soussignés, <b>{{supplier.name}}</b>, nous engageons à livrer les biens/services décrits ci-dessus
    aux prix indiqués, dans un délai de <b>{{submission.delivery_days}} jours</b> à compter de la réception du bon de commande.
  </p>

  <div class="signature">
    <div class="sig-box">Nom, fonction et signature du représentant</div>
    <div class="sig-box">Cachet de l'entreprise</div>
  </div>
</body></html>`;
  }

  async generate({ tender, supplier, submission, items }) {
    const priced = new Map(submission.items.map(i => [String(i.requisition_item_id), i]));
    const lines = items.map(item => {
      const p = priced.get(String(item.id));
      return {
        description: item.item_description,
        quantity: parseFloat(item.quantity) * parseFloat(item.frequency || 1),
        priced: !!p,
        unit_price: p?.unit_price,
        total_price: p?.total_price,
        comment: p?.comment
      };
    });
    const html = Handlebars.compile(this.getTemplate())({
      tender, supplier, submission, lines,
      currency: tender.currency_code || '',
      logo: await logoDataUri(supplier.logo_path) // data URI : pas de requête réseau depuis Chromium
    });

    const browser = await puppeteer.launch(getBrowserOptions());
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      return await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `
          <div style="width:100%;font-size:9px;color:#9CA3AF;padding:0 15mm;display:flex;justify-content:space-between">
            <span>${tender.tender_number} — ${String(supplier.name).replace(/[<>&]/g, '')}</span>
            <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
          </div>`,
        margin: { top: '15mm', bottom: '18mm', left: '15mm', right: '15mm' },
      });
    } finally {
      await browser.close();
    }
  }
}

module.exports = new TenderSubmissionPdfService();
