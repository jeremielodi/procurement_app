// backend/src/services/InvoiceExportService.js
// PDF de la facture fournisseur — Puppeteer + Handlebars, helpers préfixés inv_
// Même présentation que le bon de commande (PurchaseOrderExportService) : identité de l'entreprise, cartes, tableau, signatures.
const Handlebars = require('handlebars');
const db = require('../config/database');
const { renderPdf } = require('../utils/pdfRenderer');
const { signatureDataUri } = require('../utils/userSignature');
const { getBranding } = require('../utils/enterpriseBranding');
const { pdfContext, rootLocale, rootLabels } = require('../utils/pdfI18n');

// Libellés : pdf.invoice.status.<statut> / pdf.invoice.match.<statut> des locales
const STATUS = {
  DRAFT:          { color: '#6B7280', bg: '#F3F4F6' },
  SUBMITTED:      { color: '#D97706', bg: '#FEF3C7' },
  APPROVED:       { color: '#059669', bg: '#ECFDF5' },
  REJECTED:       { color: '#DC2626', bg: '#FEF2F2' },
  CANCELLED:      { color: '#DC2626', bg: '#FEF2F2' },
  PARTIALLY_PAID: { color: '#7C3AED', bg: '#F5F3FF' },
  PAID:           { color: '#065F46', bg: '#F0FDF4' },
};
const MATCH = {
  MATCHED:        { color: '#065F46', bg: '#ECFDF5', border: '#6EE7B7' },
  PENDING:        { color: '#92400E', bg: '#FFFBEB', border: '#FDE68A' },
  GRN_PARTIAL:    { color: '#9A3412', bg: '#FFF7ED', border: '#FDBA74' },
  PRICE_MISMATCH: { color: '#991B1B', bg: '#FEF2F2', border: '#FCA5A5' },
  NO_GRN:         { color: '#991B1B', bg: '#FEF2F2', border: '#FCA5A5' },
  MISMATCH:       { color: '#991B1B', bg: '#FEF2F2', border: '#FCA5A5' },
};

/** n° de compte masqué (•••1234) : le PDF circule, les coordonnées complètes restent dans l'application */
const maskAccount = (v) => {
  const s = String(v || '').replace(/\s+/g, '');
  return s ? `•••${s.slice(-4)}` : null;
};

class InvoiceExportService {
  constructor() {
    const safe = (name, fn) => {
      if (!Handlebars.helpers[name]) Handlebars.registerHelper(name, fn);
    };
    // Langue : racine du template (locale, L) — voir utils/pdfI18n
    safe('inv_formatDate', (d, options) => d
      ? new Date(d).toLocaleDateString(rootLocale(options), { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '—');
    safe('inv_formatCurrency', (amount, currency, options) => {
      const cur = typeof currency === 'string' && currency ? currency : 'USD';
      const n = parseFloat(amount) || 0;
      try {
        return new Intl.NumberFormat(rootLocale(options), { style: 'currency', currency: cur, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
      } catch {
        return `${n.toFixed(2)} ${cur}`;
      }
    });
    safe('inv_num', (n, options) => (n === null || n === undefined || n === '') ? '—' : new Intl.NumberFormat(rootLocale(options)).format(n));
    safe('inv_index1', (i) => i + 1);
    safe('inv_statusLabel', (s, options) => rootLabels(options).status?.[s] || s || '—');
    safe('inv_statusColor', (s) => (STATUS[s] || STATUS.DRAFT).color);
    safe('inv_statusBg', (s) => (STATUS[s] || STATUS.DRAFT).bg);
    safe('inv_matchLabel', (s, options) => rootLabels(options).match?.[s] || s || '—');
    safe('inv_matchColor', (s) => (MATCH[s] || MATCH.PENDING).color);
    safe('inv_matchBg', (s) => (MATCH[s] || MATCH.PENDING).bg);
    safe('inv_matchBorder', (s) => (MATCH[s] || MATCH.PENDING).border);
    safe('inv_payStatus', (s, options) => rootLabels(options).paymentStatus?.[s] || s || '—');
    safe('inv_payMethod', (s, options) => rootLabels(options).methods?.[s] || s || '—');
  }

  /** Facture + commande, réquisition, projet, fournisseur, réception, articles de la commande et paiements */
  async getData(id) {
    const inv = await db.one(
      `SELECT inv.*,
              po.po_number, po.order_date, po.total_amount AS po_amount, pc.format_key AS po_currency,
              r.requisition_number, r.title AS requisition_title,
              p.code AS project_code, p.name AS project_name,
              grn.grn_number, grn.receipt_date AS grn_date,
              s.name AS supplier_name, s.supplier_code, s.email AS supplier_email, s.phone AS supplier_phone,
              s.address AS supplier_address, s.tax_id AS supplier_tax_id, s.registration_number AS supplier_rccm,
              s.bank_name AS supplier_bank_name, s.bank_account AS supplier_bank_account,
              TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS created_by_name
       FROM invoices inv
       LEFT JOIN purchase_orders     po  ON po.id = inv.po_id
       LEFT JOIN currency            pc  ON pc.id = po.currency_id
       LEFT JOIN requisitions        r   ON r.id = po.requisition_id
       LEFT JOIN projects            p   ON p.id = r.project_id
       LEFT JOIN goods_receipt_notes grn ON grn.id = inv.grn_id
       LEFT JOIN suppliers           s   ON s.id = inv.supplier_id
       LEFT JOIN users               u   ON u.id = inv.created_by
       WHERE inv.id = $1`,
      [id]
    );
    if (!inv) return null;

    const items = inv.po_id ? await db.select(
      `SELECT pi.item_description, pi.specifications, pi.quantity::float8 AS quantity, pi.unit_price, pi.total_amount,
              d.quantity_accepted::float8 AS quantity_accepted, si.code AS item_code, si.unit
       FROM purchase_order_items pi
       LEFT JOIN v_po_item_delivery d ON d.po_item_id = pi.id
       LEFT JOIN stock_items si ON si.id = pi.stock_item_id
       WHERE pi.purchase_order_id = $1 ORDER BY pi.id`,
      [inv.po_id]
    ) : [];

    const payments = await db.select(
      `SELECT payment_number, payment_date, amount, currency, payment_method, reference, status
       FROM payments WHERE invoice_id = $1 AND status <> 'CANCELLED' ORDER BY payment_date NULLS LAST, id`,
      [id]
    );

    let match = inv.match_details;
    if (typeof match === 'string') { try { match = JSON.parse(match); } catch { match = null; } }

    const total = parseFloat(inv.total_amount) || 0;
    const paid = payments.filter((p) => p.status === 'PAID').reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
    return {
      ...inv,
      supplier_bank_account: maskAccount(inv.supplier_bank_account),
      items,
      payments,
      checks: match?.checks || [],
      paid,
      balance: Math.max(0, Math.round((total - paid) * 100) / 100),
    };
  }

  /** Texte d'un contrôle du rapprochement, dans la langue du document (le message stocké en base est en français) */
  checkText(c, inv, ctx) {
    const money = (v) => {
      try {
        return new Intl.NumberFormat(ctx.locale, { style: 'currency', currency: inv.currency || 'USD' }).format(parseFloat(v) || 0);
      } catch { return String(v); }
    };
    const key = `pdf.invoice.checks.${c.check}_${c.passed ? 'ok' : 'ko'}`;
    const text = ctx.t(key, {
      invoice: money(c.invoice_amount), po: money(c.po_amount), tolerance: c.tolerance_pct,
      status: c.po_status || c.grn_status || '—',
    });
    return text === key ? (c.message || c.check) : text;
  }

  getTemplate() {
    return `<!DOCTYPE html>
<html lang="{{lang}}">
<head>
  <meta charset="UTF-8">
  <title>{{T.title}}</title>
  <style>
    *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 12px; color: #1F2937; line-height: 1.5; }

    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1E3A5F; padding-bottom: 16px; margin-bottom: 20px; }
    .header-logo { display: flex; align-items: flex-start; gap: 12px; }
    .header-logo img { height: 44px; }
    .header-org { font-size: 10px; color: #6B7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }
    .header-org-info { font-size: 9px; color: #9CA3AF; margin-top: 1px; }
    .header-doc { font-size: 24px; font-weight: 800; color: #1E3A5F; letter-spacing: -0.01em; margin-top: 4px; }
    .header-num { font-size: 18px; font-weight: 800; color: #374151; }
    .header-ref { font-size: 11px; color: #6B7280; margin-top: 3px; }
    .header-right { text-align: right; }
    .badge { display: inline-block; padding: 5px 16px; border-radius: 99px; font-size: 11px; font-weight: 700; border: 1.5px solid; }
    .header-dates { font-size: 11px; color: #6B7280; margin-top: 8px; line-height: 1.8; }

    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 20px; }
    .card { background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 14px 16px; }
    .card-title { font-size: 9px; font-weight: 700; color: #9CA3AF; text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1px solid #E5E7EB; padding-bottom: 6px; margin-bottom: 10px; }
    .card-row { margin-bottom: 5px; }
    .card-label { font-size: 9px; color: #9CA3AF; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .card-value { font-size: 12px; font-weight: 500; color: #111827; margin-top: 1px; }
    .card-value.large { font-size: 15px; font-weight: 700; }

    .section-title { font-size: 11px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: 0.05em; border-left: 3px solid #1E3A5F; padding-left: 8px; margin: 20px 0 10px; }

    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    thead tr { background: #1E3A5F; }
    thead th { padding: 9px 11px; text-align: left; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: white; }
    thead th.r { text-align: right; }
    tbody tr:nth-child(even) { background: #F9FAFB; }
    tbody td { padding: 8px 11px; border-bottom: 1px solid #E5E7EB; vertical-align: top; }
    td.r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    td.muted { color: #6B7280; }
    .hint { font-size: 10px; color: #6B7280; margin-top: 4px; }

    .totals { display: flex; justify-content: flex-end; margin-top: 14px; page-break-inside: avoid; }
    .totals table { width: 300px; }
    .totals td { padding: 6px 11px; border-bottom: 1px solid #E5E7EB; }
    .totals tr.grand td { background: #EFF6FF; border-top: 2px solid #1E3A5F; font-weight: 800; font-size: 15px; color: #1E3A5F; }
    .totals tr.sub td { font-size: 10px; color: #6B7280; }
    .warn { color: #B91C1C; font-weight: 700; }

    .match { border: 1px solid; border-radius: 8px; padding: 12px 14px; margin-top: 4px; page-break-inside: avoid; }
    .match-title { font-weight: 700; font-size: 12px; margin-bottom: 6px; }
    .check { display: flex; gap: 8px; font-size: 11px; padding: 2px 0; color: #1F2937; }
    .check .ok { color: #059669; font-weight: 700; }
    .check .ko { color: #DC2626; font-weight: 700; }

    .pill { display: inline-block; padding: 2px 10px; border-radius: 99px; font-size: 10px; font-weight: 700; }

    .notes-box { background: #FFFBEB; border: 1px solid #FDE68A; border-left: 4px solid #F59E0B; border-radius: 6px; padding: 12px 14px; margin-top: 16px; font-size: 11px; color: #78350F; white-space: pre-line; }
    .reject-box { background: #FEF2F2; border: 1px solid #FCA5A5; border-left: 4px solid #DC2626; border-radius: 6px; padding: 12px 14px; margin-top: 16px; font-size: 11px; color: #991B1B; white-space: pre-line; }
    .notes-title { font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }

    .sig-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 28px; margin-top: 36px; page-break-inside: avoid; }
    .sig-box { border-top: 1.5px solid #D1D5DB; padding-top: 8px; text-align: center; font-size: 10px; color: #6B7280; }
    .sig-box .sig-line { height: 44px; display: flex; align-items: flex-end; justify-content: center; }
    .sig-box .sig-line img { max-height: 44px; max-width: 170px; object-fit: contain; }
    .sig-box .sig-label { font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; font-size: 9px; }

    .doc-footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #E5E7EB; display: flex; justify-content: space-between; font-size: 9px; color: #9CA3AF; }
  </style>
</head>
<body>

<div class="header">
  <div class="header-logo">
    {{#if brand.logo}}<img src="{{brand.logo}}" alt="{{brand.name}}" />{{/if}}
    <div>
      <div class="header-org">{{brand.name}}</div>
      {{#if brand.address}}<div class="header-org-info">{{brand.address}}</div>{{/if}}
      {{#if T.brandIds}}<div class="header-org-info">{{T.brandIds}}</div>{{/if}}
      <div class="header-doc">{{L.heading}}</div>
      <div class="header-num">{{inv.invoice_number}}</div>
      {{#if inv.supplier_invoice_number}}<div class="header-ref">{{T.supplierNumber}}</div>{{/if}}
    </div>
  </div>
  <div class="header-right">
    <span class="badge" style="color:{{inv_statusColor inv.status}};background:{{inv_statusBg inv.status}};border-color:{{inv_statusColor inv.status}}">{{inv_statusLabel inv.status}}</span>
    <div class="header-dates">
      <div>📅 {{T.invoiceDate}}</div>
      {{#if inv.due_date}}<div>⏳ {{T.dueDate}}</div>{{/if}}
      {{#if inv.created_by_name}}<div>👤 {{T.enteredBy}}</div>{{/if}}
    </div>
  </div>
</div>

<div class="info-grid">
  <div class="card">
    <div class="card-title">🏢 {{L.supplier}}</div>
    <div class="card-row"><div class="card-value large">{{inv.supplier_name}}</div></div>
    {{#if inv.supplier_code}}<div class="card-row"><div class="card-label">{{L.supplierCode}}</div><div class="card-value">{{inv.supplier_code}}</div></div>{{/if}}
    {{#if inv.supplier_tax_id}}<div class="card-row"><div class="card-label">{{L.taxId}}</div><div class="card-value">{{inv.supplier_tax_id}}</div></div>{{/if}}
    {{#if inv.supplier_rccm}}<div class="card-row"><div class="card-label">{{L.rccm}}</div><div class="card-value">{{inv.supplier_rccm}}</div></div>{{/if}}
    {{#if inv.supplier_email}}<div class="card-row"><div class="card-label">{{L.email}}</div><div class="card-value">{{inv.supplier_email}}</div></div>{{/if}}
    {{#if inv.supplier_phone}}<div class="card-row"><div class="card-label">{{L.phone}}</div><div class="card-value">{{inv.supplier_phone}}</div></div>{{/if}}
    {{#if inv.supplier_address}}<div class="card-row"><div class="card-label">{{L.address}}</div><div class="card-value">{{inv.supplier_address}}</div></div>{{/if}}
    {{#if inv.supplier_bank_name}}<div class="card-row"><div class="card-label">{{L.bank}}</div><div class="card-value">{{inv.supplier_bank_name}}{{#if inv.supplier_bank_account}} · {{inv.supplier_bank_account}}{{/if}}</div></div>{{/if}}
  </div>

  <div class="card">
    <div class="card-title">📋 {{L.references}}</div>
    {{#if inv.po_number}}<div class="card-row"><div class="card-label">{{L.order}}</div><div class="card-value">{{inv.po_number}}{{#if inv.order_date}} — {{inv_formatDate inv.order_date}}{{/if}}</div></div>{{/if}}
    {{#if inv.grn_number}}<div class="card-row"><div class="card-label">{{L.receipt}}</div><div class="card-value">{{inv.grn_number}}{{#if inv.grn_date}} — {{inv_formatDate inv.grn_date}}{{/if}}</div></div>{{/if}}
    {{#if inv.requisition_number}}<div class="card-row"><div class="card-label">{{L.requisition}}</div><div class="card-value">{{inv.requisition_number}}{{#if inv.requisition_title}} — {{inv.requisition_title}}{{/if}}</div></div>{{/if}}
    {{#if inv.project_code}}<div class="card-row"><div class="card-label">{{L.project}}</div><div class="card-value">{{inv.project_code}} — {{inv.project_name}}</div></div>{{/if}}
    <div class="card-row"><div class="card-label">{{L.currency}}</div><div class="card-value">{{inv.currency}}</div></div>
    <div class="card-row"><div class="card-label">{{L.totalAmount}}</div><div class="card-value large" style="color:#1E3A5F">{{inv_formatCurrency inv.total_amount inv.currency}}</div></div>
  </div>
</div>

{{#if items.length}}
<div class="section-title">{{L.orderItems}}</div>
<table>
  <thead><tr>
    <th style="width:30px">#</th>
    <th>{{L.description}}</th>
    <th class="r" style="width:65px">{{L.qtyOrdered}}</th>
    <th class="r" style="width:65px">{{L.qtyAccepted}}</th>
    <th class="r" style="width:100px">{{L.unitPrice}}</th>
    <th class="r" style="width:110px">{{L.amount}}</th>
  </tr></thead>
  <tbody>
    {{#each items}}
    <tr>
      <td class="muted">{{inv_index1 @index}}</td>
      <td>
        <div style="font-weight:600">{{#if this.item_code}}{{this.item_code}} — {{/if}}{{this.item_description}}</div>
        {{#if this.specifications}}<div style="font-size:10px;color:#6B7280;margin-top:2px">{{this.specifications}}</div>{{/if}}
      </td>
      <td class="r">{{inv_num this.quantity}}{{#if this.unit}} {{this.unit}}{{/if}}</td>
      <td class="r">{{inv_num this.quantity_accepted}}</td>
      <td class="r">{{inv_formatCurrency this.unit_price @root.poCurrency}}</td>
      <td class="r" style="font-weight:600">{{inv_formatCurrency this.total_amount @root.poCurrency}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
<div class="hint">{{L.orderItemsHint}}</div>
{{/if}}

<div class="totals">
  <table>
    <tr><td>{{L.subtotal}}</td><td class="r">{{inv_formatCurrency inv.subtotal inv.currency}}</td></tr>
    <tr><td>{{L.tax}}</td><td class="r">{{inv_formatCurrency inv.tax_amount inv.currency}}</td></tr>
    <tr class="grand"><td>{{L.total}}</td><td class="r">{{inv_formatCurrency inv.total_amount inv.currency}}</td></tr>
    {{#if inv.po_number}}
    <tr class="sub"><td>{{L.poAmount}}</td><td class="r">{{inv_formatCurrency inv.po_amount poCurrency}}</td></tr>
    {{#if T.difference}}<tr class="sub"><td>{{L.difference}}</td><td class="r {{#if overPo}}warn{{/if}}">{{T.difference}}</td></tr>{{/if}}
    {{/if}}
    {{#if payments.length}}
    <tr class="sub"><td>{{L.paid}}</td><td class="r">{{inv_formatCurrency inv.paid inv.currency}}</td></tr>
    <tr class="sub"><td><b>{{L.balance}}</b></td><td class="r"><b>{{inv_formatCurrency inv.balance inv.currency}}</b></td></tr>
    {{/if}}
  </table>
</div>

<div class="section-title">{{L.matchSection}}</div>
<div class="match" style="color:{{inv_matchColor inv.match_status}};background:{{inv_matchBg inv.match_status}};border-color:{{inv_matchBorder inv.match_status}}">
  <div class="match-title">{{inv_matchLabel inv.match_status}}{{#if inv.matched_at}} <span style="font-weight:400;font-size:10px">— {{inv_formatDate inv.matched_at}}</span>{{/if}}</div>
  {{#each checks}}
  <div class="check">{{#if this.passed}}<span class="ok">✓</span>{{else}}<span class="ko">✗</span>{{/if}}<span>{{this.text}}</span></div>
  {{/each}}
</div>

{{#if payments.length}}
<div class="section-title">{{L.payments}}</div>
<table>
  <thead><tr>
    <th>{{L.paymentNumber}}</th><th>{{L.date}}</th><th>{{L.method}}</th><th>{{L.reference}}</th><th>{{L.statusCol}}</th><th class="r">{{L.amount}}</th>
  </tr></thead>
  <tbody>
    {{#each payments}}
    <tr>
      <td style="font-weight:600">{{this.payment_number}}</td>
      <td class="muted">{{inv_formatDate this.payment_date}}</td>
      <td>{{inv_payMethod this.payment_method}}</td>
      <td class="muted">{{this.reference}}</td>
      <td>{{inv_payStatus this.status}}</td>
      <td class="r" style="font-weight:600">{{inv_formatCurrency this.amount this.currency}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{/if}}

{{#if inv.rejection_reason}}
<div class="reject-box"><div class="notes-title">{{L.rejectionReason}}</div>{{inv.rejection_reason}}</div>
{{/if}}

{{#if inv.notes}}
<div class="notes-box"><div class="notes-title">{{L.notes}}</div>{{inv.notes}}</div>
{{/if}}

<div class="sig-grid">
  <div class="sig-box">
    <div class="sig-line">{{#if enteredBySignature}}<img src="{{enteredBySignature}}" alt="">{{/if}}</div>
    <div class="sig-label">{{L.sigEnteredBy}}</div>
    <div style="margin-top:4px;color:#9CA3AF">{{#if inv.created_by_name}}{{inv.created_by_name}}{{else}}{{L.nameSignature}}{{/if}}</div>
  </div>
  <div class="sig-box">
    <div class="sig-line"></div>
    <div class="sig-label">{{L.sigApprovedBy}}</div>
    <div style="margin-top:4px;color:#9CA3AF">{{L.nameSignature}}</div>
  </div>
  <div class="sig-box">
    <div class="sig-line"></div>
    <div class="sig-label">{{T.sigFinance}}</div>
    <div style="margin-top:4px;color:#9CA3AF">{{L.signatureStamp}}</div>
  </div>
</div>

<div class="doc-footer">
  <span>{{T.generatedWith}}</span>
  <span>{{T.generatedOn}}</span>
</div>

</body>
</html>`;
  }

  /** lang : langue du document ('fr' par défaut) → { pdf, invoice } ou null si la facture n'existe pas */
  async generatePDF(id, { lang } = {}) {
    const inv = await this.getData(id);
    if (!inv) return null;

    const ctx = pdfContext(lang, 'invoice');
    const brand = await getBranding(inv.enterprise_id);
    const currency = inv.currency || inv.po_currency || 'USD';
    const poCurrency = inv.po_currency || currency;
    const fmtDay = (d) => (d ? new Date(d).toLocaleDateString(ctx.locale, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
    const money = (v, cur) => {
      try { return new Intl.NumberFormat(ctx.locale, { style: 'currency', currency: cur, signDisplay: 'exceptZero' }).format(v); }
      catch { return `${v} ${cur}`; }
    };

    // Écart facture − commande (seulement si même devise)
    const diff = inv.po_number && poCurrency === currency
      ? Math.round(((parseFloat(inv.total_amount) || 0) - (parseFloat(inv.po_amount) || 0)) * 100) / 100
      : null;
    const brandIds = [brand.taxId && `${ctx.L.taxId} ${brand.taxId}`, brand.registrationNumber && `${ctx.L.rccm} ${brand.registrationNumber}`]
      .filter(Boolean).join(' · ');

    // Signature image de la personne qui a saisi la facture
    const enteredBySignature = await signatureDataUri(inv.created_by);
    const html = Handlebars.compile(this.getTemplate())({
      enteredBySignature,
      inv: { ...inv, currency },
      items: inv.items,
      payments: inv.payments,
      checks: inv.checks.map((c) => ({ passed: !!c.passed, text: this.checkText(c, { currency }, ctx) })),
      poCurrency,
      overPo: diff != null && diff > 0,
      brand,
      ...ctx,
      T: {
        title: ctx.t('pdf.invoice.title', { number: inv.invoice_number }),
        supplierNumber: ctx.t('pdf.invoice.supplierNumber', { number: inv.supplier_invoice_number }),
        invoiceDate: ctx.t('pdf.invoice.invoiceDate', { date: fmtDay(inv.invoice_date) }),
        dueDate: ctx.t('pdf.invoice.dueDate', { date: fmtDay(inv.due_date) }),
        enteredBy: ctx.t('pdf.invoice.enteredBy', { name: inv.created_by_name }),
        difference: diff ? money(diff, currency) : null,
        brandIds,
        sigFinance: ctx.t('pdf.invoice.sigFinance', { enterprise: brand.name }),
        generatedWith: ctx.t('pdf.common.generatedWith', { enterprise: brand.name, app: brand.appName }),
        generatedOn: ctx.t('pdf.common.generatedOn', { date: fmtDay(new Date()) }),
      },
    });

    const pdf = await renderPdf(html, {
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `
        <div style="width:100%;font-size:9px;color:#9CA3AF;padding:0 15mm;display:flex;justify-content:space-between">
          <span>${String(inv.invoice_number).replace(/[<>&]/g, '')}</span>
          <span>${ctx.L.page} <span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>`,
      margin: { top: '15mm', bottom: '18mm', left: '15mm', right: '15mm' },
    });
    return { pdf, invoice: inv };
  }
}

module.exports = new InvoiceExportService();
