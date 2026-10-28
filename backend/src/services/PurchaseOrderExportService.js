// backend/src/services/PurchaseOrderExportService.js
const Handlebars = require('handlebars');
const { getEnterpriseCurrencyCode } = require('../utils/enterpriseCurrency');
const { renderPdf } = require('../utils/pdfRenderer');
const db = require('../config/database');
const { getBranding, brandContact } = require('../utils/enterpriseBranding');
const { signatureDataUri } = require('../utils/userSignature');
const { pdfContext, rootLocale, rootLabels } = require('../utils/pdfI18n');

class PurchaseOrderExportService {
  constructor() {
    this.registerHelpers();
  }

  registerHelpers() {
    const safe = (name, fn) => {
      if (!Handlebars.helpers[name]) Handlebars.registerHelper(name, fn);
    };

    // Langue : racine du template (locale, L) — voir utils/pdfI18n
    safe('po_formatDate', (date, options) => {
      if (!date) return '—';
      return new Date(date).toLocaleDateString(rootLocale(options), { day: '2-digit', month: '2-digit', year: 'numeric' });
    });

    safe('po_formatCurrency', (amount, currency, options) => {
      const cur = typeof currency === 'string' && currency ? currency : 'USD';
      if (amount == null) return '0 ' + cur;
      try {
        return new Intl.NumberFormat(rootLocale(options), {
          style: 'currency', currency: cur,
          minimumFractionDigits: 0, maximumFractionDigits: 0
        }).format(parseFloat(amount) || 0);
      } catch {
        return `${parseFloat(amount) || 0} ${cur}`;
      }
    });

    safe('po_statusLabel', (status, options) => rootLabels(options).status?.[status] || status || '—');

    safe('po_statusColor', (status) => {
      const map = {
        DRAFT: '#6B7280', PENDING: '#D97706', PO_PENDING: '#D97706',
        PO_APPROVED: '#059669', PO_REJECTED: '#DC2626',
        PO_SENT: '#2563EB', PO_CONFIRMED: '#0F766E', PO_RECEIVED: '#7C3AED', PO_COMPLETE: '#065F46'
      };
      return map[status] || '#6B7280';
    });

    safe('po_statusBg', (status) => {
      const map = {
        DRAFT: '#F3F4F6', PENDING: '#FEF3C7', PO_PENDING: '#FEF3C7',
        PO_APPROVED: '#ECFDF5', PO_REJECTED: '#FEF2F2',
        PO_SENT: '#EFF6FF', PO_CONFIRMED: '#F0FDFA', PO_RECEIVED: '#F5F3FF', PO_COMPLETE: '#F0FDF4'
      };
      return map[status] || '#F3F4F6';
    });

    safe('po_add',      (a, b) => (Number(a) || 0) + (Number(b) || 0));
    safe('po_multiply', (a, b) => (parseFloat(a) || 0) * (parseFloat(b) || 0));
    safe('po_eq',       (a, b) => a === b);
    safe('po_index1',   (i)    => i + 1);
  }

  // Modèle de bon de commande de l'entreprise : champs soulignés, tableau des articles, signatures (demandeur,
  // approbateurs, fournisseur), conditions générales de l'entreprise en dernière page (enterprise.po_terms)
  getTemplate() {
    return `<!DOCTYPE html>
<html lang="{{lang}}">
<head>
  <meta charset="UTF-8">
  <title>{{T.title}}</title>
  <style>
    *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 10px; color: #000; line-height: 1.35; }

    .brand { display: flex; align-items: center; gap: 12px; padding-bottom: 6px; margin-bottom: 8px; border-bottom: 2px solid #000; }
    .brand img { max-height: 48px; max-width: 140px; object-fit: contain; }
    .brand .name { font-size: 15px; font-weight: 700; }
    .brand .info { font-size: 8.5px; color: #333; margin-top: 1px; }
    h1 { text-align: center; font-size: 20px; font-weight: 700; margin: 4px 0 12px; }

    .rows { width: 100%; border-collapse: collapse; }
    .rows td { padding: 4px 4px 1px; vertical-align: bottom; }
    .rows .k { font-weight: 700; text-align: right; white-space: nowrap; width: 1%; padding-right: 6px; }
    .rows .v { border-bottom: 1px solid #000; text-align: center; font-weight: 700; }
    .rows .v.l { text-align: left; }
    .rows .v a { color: #0563C1; }
    .multi { white-space: pre-wrap; }

    .items { width: 100%; border-collapse: collapse; margin-top: 16px; }
    .items th { border: 1px solid #000; font-weight: 700; padding: 3px 5px; text-align: center; }
    .items td { border: 1px solid #000; padding: 6px 5px; vertical-align: middle; }
    .items td.c { text-align: center; }
    .items td.r { text-align: right; white-space: nowrap; }
    .items td.money { white-space: nowrap; }
    .items td.money span { float: left; }
    .items td.money b { float: right; }
    .items .spec { color: #333; font-size: 9px; margin-top: 2px; }
    .items tr.total td { border: none; }
    .items tr.total td.box { border: 1.5px solid #000; font-weight: 700; }

    .terms { margin-top: 18px; width: 62%; }

    .sig { width: 100%; border-collapse: collapse; margin-top: 26px; }
    .sig td { padding: 0 8px; vertical-align: bottom; text-align: center; }
    .sig .line { border-bottom: 1px solid #000; font-weight: 700; height: 34px; vertical-align: bottom; }
    .sig .line img { max-height: 32px; max-width: 150px; object-fit: contain; display: block; margin: 0 auto; }
    .sig .cap { font-weight: 700; padding-top: 1px; padding-bottom: 10px; }
    .sig .cap.i { font-style: italic; }

    .vendor { margin-top: 28px; }
    .vendor .rows .v { height: 22px; }

    .page-break { page-break-before: always; }
    .tc h2 { text-align: center; font-size: 12px; font-weight: 700; margin-bottom: 10px; }
    .tc .body { font-size: 8.5px; white-space: pre-wrap; line-height: 1.45; }
  </style>
</head>
<body>

<div class="brand">
  {{#if brand.logo}}<img src="{{brand.logo}}" alt="{{brand.name}}">{{/if}}
  <div>
    <div class="name">{{brand.name}}</div>
    {{#if brand.address}}<div class="info">{{brand.address}}</div>{{/if}}
    {{#if brandContact}}<div class="info">{{brandContact}}</div>{{/if}}
  </div>
</div>
<h1>{{L.heading}}</h1>

<table class="rows">
  <tr>
    <td class="k">{{L.poNo}}</td><td class="v" style="width:26%">{{po.po_number}}</td>
    <td class="k">{{L.referenceNo}}</td><td class="v" style="width:26%">{{po.requisition_number}}</td>
    <td class="k">{{L.date}}:</td><td class="v">{{orderDate}}</td>
  </tr>
</table>
<table class="rows">
  <tr><td class="k" style="width:150px">{{L.vendor}}</td><td class="v">{{po.supplier_name}}</td></tr>
  <tr><td class="k">{{L.address}}</td><td class="v multi">{{po.supplier_address}}</td></tr>
</table>
<table class="rows">
  <tr>
    <td class="k" style="width:150px">{{L.phone}}</td><td class="v" style="width:36%">{{po.supplier_phone}}</td>
    <td class="k">{{L.email}}</td><td class="v">{{#if po.supplier_email}}<a>{{po.supplier_email}}</a>{{/if}}</td>
  </tr>
  <tr>
    <td class="k">{{L.contactPerson}}</td><td class="v">{{po.supplier_contact_name}}</td>
    <td class="k">{{L.supplierCode}}</td><td class="v">{{po.supplier_code}}</td>
  </tr>
  <tr>
    <td class="k">{{L.deliveryLocation}}</td><td class="v multi">{{deliveryLocation}}</td>
    <td class="k">{{L.deliveryDate}}</td><td class="v">{{deliveryDate}}</td>
  </tr>
</table>
<table class="rows">
  <tr><td class="k" style="width:150px">{{L.deliveryTerms}}</td><td class="v multi">{{deliveryTerms}}</td></tr>
  <tr><td class="k">{{L.specialInstructions}}</td><td class="v multi">{{po.special_instructions}}</td></tr>
</table>

<table class="items">
  <thead>
    <tr>
      <th style="width:5%">{{L.no}}</th>
      <th style="width:7%">{{L.qty}}</th>
      <th style="width:9%">{{L.unit}}</th>
      <th>{{L.description}}</th>
      <th style="width:7%">{{L.currency}}</th>
      <th style="width:12%">{{L.unitPrice}}</th>
      <th style="width:14%">{{L.total}}</th>
    </tr>
  </thead>
  <tbody>
    {{#each items}}
    <tr>
      <td class="c">{{this.no}}</td>
      <td class="c">{{this.qty}}</td>
      <td class="c">{{this.unitLabel}}</td>
      <td>{{this.item_description}}{{#if this.specifications}}<div class="spec">{{this.specifications}}</div>{{/if}}</td>
      <td class="c">{{@root.po.currency}}</td>
      <td class="r">{{this.unitPrice}}</td>
      <td class="money"><span>{{@root.symbol}}</span><b>{{this.total}}</b></td>
    </tr>
    {{/each}}
    <tr class="total">
      <td colspan="5"></td>
      <td class="box" style="text-align:center">{{L.grandTotal}}</td>
      <td class="box money"><span>{{symbol}}</span><b>{{total}}</b></td>
    </tr>
  </tbody>
</table>

<table class="rows terms">
  <tr><td class="k">{{L.paymentTerms}}</td><td class="v multi">{{paymentTerms}}</td></tr>
</table>

<table class="sig">
  <tr>
    <td class="line" style="width:22%">{{requestedBy.name}}</td>
    <td class="line" style="width:26%">{{#if requestedBy.signature}}<img src="{{requestedBy.signature}}" alt="">{{/if}}</td>
    <td style="width:26%"></td><td></td>
  </tr>
  <tr><td class="cap">{{L.requestedBy}}</td><td class="cap">{{L.signature}}</td><td></td><td></td></tr>
  <tr>
    <td class="line">{{requestedBy.title}}</td>
    <td class="line" style="font-style:italic;text-decoration:underline">{{requestedBy.date}}</td>
    <td></td><td></td>
  </tr>
  <tr><td class="cap">{{L.titleCap}}</td><td class="cap i">{{L.date}}</td><td></td><td></td></tr>

  <tr>
    <td class="line">{{approvedBy.name}}</td>
    <td class="line">{{#if approvedBy.signature}}<img src="{{approvedBy.signature}}" alt="">{{/if}}</td>
    <td class="line">{{secondApproval.name}}</td>
    <td class="line">{{#if secondApproval.signature}}<img src="{{secondApproval.signature}}" alt="">{{/if}}</td>
  </tr>
  <tr><td class="cap">{{L.approvedBy}}</td><td class="cap">{{L.signature}}</td><td class="cap">{{L.secondApproval}}</td><td class="cap">{{L.signature}}</td></tr>
  <tr>
    <td class="line">{{approvedBy.title}}</td><td class="line">{{approvedBy.date}}</td>
    <td class="line">{{secondApproval.title}}</td><td class="line">{{secondApproval.date}}</td>
  </tr>
  <tr><td class="cap">{{L.titleCap}}</td><td class="cap i">{{L.date}}</td><td class="cap">{{L.titleCap}}</td><td class="cap i">{{L.date}}</td></tr>
</table>

<div class="vendor">
  <div style="font-weight:700">{{L.vendorMustSign}}</div>
  <table class="rows" style="margin-top:10px">
    <tr>
      <td class="k">{{L.signature}}:</td><td class="v" style="width:30%"></td>
      <td class="k">{{L.name}}</td><td class="v" style="width:24%"></td>
      <td class="k">{{L.titleCap}}:</td><td class="v"></td>
    </tr>
    <tr>
      <td></td><td style="text-align:center;font-weight:700;padding-top:2px">{{L.vendorRepresentative}}</td>
      <td class="k">{{L.date}}:</td><td class="v"></td><td></td><td></td>
    </tr>
  </table>
</div>

{{#if brand.poTerms}}
<div class="page-break tc">
  <h2>{{L.termsTitle}}</h2>
  <div class="body">{{brand.poTerms}}</div>
</div>
{{/if}}

</body>
</html>`;
  }

  /** lang : 'fr' (défaut) | 'en' … — langue du document */
  async generatePDF(po, { lang } = {}) {
    if (!po) throw new Error('Purchase order data is required');

    const currency = po.currency || await getEnterpriseCurrencyCode();
    const ctx = pdfContext(lang, 'po');
    const brand = await getBranding(po.enterprise_id);
    const fmtDay = (d) => (d ? new Date(d).toLocaleDateString(ctx.locale, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
    const amount = (n) => new Intl.NumberFormat(ctx.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(n) || 0);
    const qty = (n) => new Intl.NumberFormat(ctx.locale, { maximumFractionDigits: 4 }).format(parseFloat(n) || 0);
    let symbol = currency;
    try {
      symbol = new Intl.NumberFormat(ctx.locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find(p => p.type === 'currency')?.value || currency;
    } catch { /* code devise inconnu d'Intl : code affiché */ }

    // Signataires : la personne qui a créé le bon (« Demandé par ») et celles qui l'ont approuvé (dernières décisions
    // APPROVED, de la plus ancienne à la plus récente) — signature image seulement pour qui a réellement agi
    const fullName = (...parts) => parts.filter(Boolean).join(' ');
    const approved = (po.approvals || []).filter(a => a.status === 'APPROVED')
      .sort((a, b) => new Date(a.approved_at) - new Date(b.approved_at));
    // Pas d'historique (approbation antérieure à la migration 44) : approbateur enregistré sur le bon
    if (!approved.length && po.approved_by) {
      const u = await db.one('SELECT first_name, last_name, position FROM users WHERE id = $1', [po.approved_by]);
      if (u) approved.push({ ...u, approver_id: po.approved_by, approved_at: po.approved_at });
    }
    const approver = async (a) => (a ? {
      name: fullName(a.first_name, a.last_name),
      title: a.position || '',
      date: fmtDay(a.approved_at),
      signature: await signatureDataUri(a.approver_id),
    } : {});
    const items = (po.items || []).map((it, index) => ({
      ...it,
      no: index + 1,
      qty: qty(it.quantity),
      unitLabel: it.item_unit || it.unit || '',
      unitPrice: amount(it.unit_price),
      total: amount(it.total_amount ?? (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0)),
    }));

    const template = Handlebars.compile(this.getTemplate());
    const html = template({
      po:          { ...po, currency },
      items,
      brand,
      brandContact: brandContact(brand),
      symbol,
      total: amount(po.total_amount),
      orderDate: fmtDay(po.order_date),
      deliveryDate: po.delivery_date ? fmtDay(po.delivery_date) : ctx.L.afterReceipt,
      deliveryLocation: po.shipping_address || po.requisition_delivery_address || '',
      // Conditions du bon, sinon celles de la fiche fournisseur
      paymentTerms: po.payment_terms || po.supplier_payment_terms || '',
      deliveryTerms: po.delivery_terms || po.supplier_delivery_terms || '',
      requestedBy: {
        name: fullName(po.created_by_name, po.created_by_last_name),
        title: po.created_by_position || '',
        date: fmtDay(po.created_at || po.order_date),
        signature: po.created_by ? await signatureDataUri(po.created_by) : null,
      },
      approvedBy: await approver(approved[0]),
      secondApproval: await approver(approved[1]),
      ...ctx,
      T: { title: ctx.t('pdf.po.title', { number: po.po_number }) },
    });

    return await renderPdf(html, {
      format:          'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `
        <div style="width:100%;font-size:8px;color:#555;padding:0 12mm;display:flex;justify-content:space-between">
          <span>${Handlebars.escapeExpression(po.po_number || '')}</span>
          <span>${ctx.L.page} <span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>`,
      margin: { top: '12mm', bottom: '14mm', left: '12mm', right: '12mm' },
    });
  }
}

module.exports = new PurchaseOrderExportService();
