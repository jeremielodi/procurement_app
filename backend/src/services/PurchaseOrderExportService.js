// backend/src/services/PurchaseOrderExportService.js
const puppeteer = require('puppeteer');
const Handlebars = require('handlebars');
const { getEnterpriseCurrencyCode } = require('../utils/enterpriseCurrency');
const { getBrowserOptions } = require('../config/puppeteer');

class PurchaseOrderExportService {
  constructor() {
    this.registerHelpers();
  }

  registerHelpers() {
    const safe = (name, fn) => {
      if (!Handlebars.helpers[name]) Handlebars.registerHelper(name, fn);
    };

    safe('po_formatDate', (date) => {
      if (!date) return '—';
      return new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    });

    safe('po_formatCurrency', (amount, currency) => {
      const cur = typeof currency === 'string' && currency ? currency : 'USD';
      if (amount == null) return '0 ' + cur;
      try {
        return new Intl.NumberFormat('fr-FR', {
          style: 'currency', currency: cur,
          minimumFractionDigits: 0, maximumFractionDigits: 0
        }).format(parseFloat(amount) || 0);
      } catch {
        return `${parseFloat(amount) || 0} ${cur}`;
      }
    });

    safe('po_statusLabel', (status) => {
      const map = {
        DRAFT: 'Brouillon', PENDING: 'En attente', PO_PENDING: 'Soumis pour approbation',
        PO_APPROVED: 'Approuvé', PO_REJECTED: 'Rejeté',
        PO_SENT: 'Envoyé au fournisseur', PO_RECEIVED: 'Reçu', PO_COMPLETE: 'Terminé'
      };
      return map[status] || status || '—';
    });

    safe('po_statusColor', (status) => {
      const map = {
        DRAFT: '#6B7280', PENDING: '#D97706', PO_PENDING: '#D97706',
        PO_APPROVED: '#059669', PO_REJECTED: '#DC2626',
        PO_SENT: '#2563EB', PO_RECEIVED: '#7C3AED', PO_COMPLETE: '#065F46'
      };
      return map[status] || '#6B7280';
    });

    safe('po_statusBg', (status) => {
      const map = {
        DRAFT: '#F3F4F6', PENDING: '#FEF3C7', PO_PENDING: '#FEF3C7',
        PO_APPROVED: '#ECFDF5', PO_REJECTED: '#FEF2F2',
        PO_SENT: '#EFF6FF', PO_RECEIVED: '#F5F3FF', PO_COMPLETE: '#F0FDF4'
      };
      return map[status] || '#F3F4F6';
    });

    safe('po_add',      (a, b) => (Number(a) || 0) + (Number(b) || 0));
    safe('po_multiply', (a, b) => (parseFloat(a) || 0) * (parseFloat(b) || 0));
    safe('po_eq',       (a, b) => a === b);
    safe('po_index1',   (i)    => i + 1);
  }

  getTemplate() {
    const logoUrl = (process.env.FRONTEND_URL || 'http://localhost:5173') + '/images/logo_wwf1.png';
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Bon de Commande {{po.po_number}}</title>
  <style>
    *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
    @page { size: A4; margin: 15mm 15mm 20mm 15mm; }

    body {
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      font-size: 12px;
      color: #1F2937;
      line-height: 1.5;
    }

    /* ── HEADER ── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 3px solid #1E3A5F;
      padding-bottom: 16px;
      margin-bottom: 20px;
    }
    .header-logo { display: flex; align-items: center; gap: 12px; }
    .header-logo img { height: 44px; }
    .header-org { font-size: 10px; color: #6B7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }
    .header-doc { font-size: 24px; font-weight: 800; color: #1E3A5F; letter-spacing: -0.01em; margin-top: 2px; }
    .header-ref { font-size: 11px; color: #6B7280; margin-top: 3px; }

    .header-right { text-align: right; }
    .status-badge {
      display: inline-block;
      padding: 5px 16px;
      border-radius: 99px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: {{po_statusColor po.status}};
      background: {{po_statusBg po.status}};
      border: 1.5px solid {{po_statusColor po.status}};
    }
    .header-dates { font-size: 11px; color: #6B7280; margin-top: 8px; line-height: 1.8; }

    /* ── TWO-COLUMN INFO ── */
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 22px;
    }
    .card {
      background: #F9FAFB;
      border: 1px solid #E5E7EB;
      border-radius: 8px;
      padding: 14px 16px;
    }
    .card-title {
      font-size: 9px;
      font-weight: 700;
      color: #9CA3AF;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      border-bottom: 1px solid #E5E7EB;
      padding-bottom: 6px;
      margin-bottom: 10px;
    }
    .card-row { margin-bottom: 5px; }
    .card-label { font-size: 9px; color: #9CA3AF; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .card-value { font-size: 12px; font-weight: 500; color: #111827; margin-top: 1px; }
    .card-value.large { font-size: 15px; font-weight: 700; }

    /* ── SECTION TITLE ── */
    .section-title {
      font-size: 11px;
      font-weight: 700;
      color: #374151;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-left: 3px solid #1E3A5F;
      padding-left: 8px;
      margin: 20px 0 10px;
    }

    /* ── ITEMS TABLE ── */
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    thead tr { background: #1E3A5F; }
    thead th {
      padding: 9px 11px;
      text-align: left;
      font-weight: 600;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: white;
    }
    thead th.r { text-align: right; }
    tbody tr:nth-child(even) { background: #F9FAFB; }
    tbody tr:hover { background: #EFF6FF; }
    tbody td { padding: 9px 11px; border-bottom: 1px solid #E5E7EB; vertical-align: top; }
    tbody td.r { text-align: right; font-variant-numeric: tabular-nums; }
    tbody td.muted { color: #6B7280; }

    tfoot tr { background: #EFF6FF; }
    tfoot td {
      padding: 11px;
      font-weight: 700;
      border-top: 2px solid #1E3A5F;
    }
    tfoot td.r { text-align: right; font-size: 15px; color: #1E3A5F; }

    /* ── NOTES ── */
    .notes-box {
      background: #FFFBEB;
      border: 1px solid #FDE68A;
      border-left: 4px solid #F59E0B;
      border-radius: 6px;
      padding: 12px 14px;
      margin-top: 16px;
      font-size: 11px;
      color: #78350F;
    }
    .notes-title { font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }

    /* ── APPROVALS ── */
    .approval-table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .approval-table th { background: #F3F4F6; padding: 7px 10px; text-align: left; font-size: 10px; color: #6B7280; font-weight: 600; text-transform: uppercase; }
    .approval-table td { padding: 8px 10px; border-bottom: 1px solid #F3F4F6; }
    .pill-approved { display: inline-block; padding: 2px 10px; border-radius: 99px; background: #ECFDF5; color: #059669; font-size: 10px; font-weight: 700; }
    .pill-rejected { display: inline-block; padding: 2px 10px; border-radius: 99px; background: #FEF2F2; color: #DC2626; font-size: 10px; font-weight: 700; }

    /* ── SIGNATURES ── */
    .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 36px; }
    .sig-box {
      border-top: 1.5px solid #D1D5DB;
      padding-top: 8px;
      text-align: center;
      font-size: 10px;
      color: #6B7280;
    }
    .sig-box .sig-line { height: 44px; }
    .sig-box .sig-label { font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; font-size: 9px; }

    /* ── FOOTER ── */
    .doc-footer {
      margin-top: 32px;
      padding-top: 12px;
      border-top: 1px solid #E5E7EB;
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: #9CA3AF;
    }
  </style>
</head>
<body>

<!-- HEADER -->
<div class="header">
  <div class="header-logo">
    <img src="${logoUrl}" alt="WWF" onerror="this.style.display='none'" />
    <div>
      <div class="header-org">WWF — Procurement System</div>
      <div class="header-doc">BON DE COMMANDE</div>
      <div class="header-doc" style="font-size:18px;color:#374151">{{po.po_number}}</div>
      {{#if po.requisition_number}}
      <div class="header-ref">Réf. réquisition : {{po.requisition_number}}</div>
      {{/if}}
    </div>
  </div>
  <div class="header-right">
    <span class="status-badge">{{po_statusLabel po.status}}</span>
    <div class="header-dates">
      <div>📅 Émis le {{po_formatDate po.order_date}}</div>
      {{#if po.delivery_date}}
      <div>🚚 Livraison : {{po_formatDate po.delivery_date}}</div>
      {{/if}}
      {{#if po.created_by_name}}
      <div>👤 Créé par : {{po.created_by_name}}</div>
      {{/if}}
    </div>
  </div>
</div>

<!-- INFO CARDS -->
<div class="info-grid">
  <div class="card">
    <div class="card-title">🏢 Fournisseur</div>
    <div class="card-row">
      <div class="card-value large">{{po.supplier_name}}</div>
    </div>
    {{#if po.supplier_code}}
    <div class="card-row">
      <div class="card-label">Code fournisseur</div>
      <div class="card-value">{{po.supplier_code}}</div>
    </div>
    {{/if}}
    {{#if po.supplier_email}}
    <div class="card-row">
      <div class="card-label">Email</div>
      <div class="card-value">{{po.supplier_email}}</div>
    </div>
    {{/if}}
    {{#if po.supplier_phone}}
    <div class="card-row">
      <div class="card-label">Téléphone</div>
      <div class="card-value">{{po.supplier_phone}}</div>
    </div>
    {{/if}}
    {{#if po.supplier_address}}
    <div class="card-row">
      <div class="card-label">Adresse</div>
      <div class="card-value">{{po.supplier_address}}</div>
    </div>
    {{/if}}
  </div>

  <div class="card">
    <div class="card-title">📋 Informations commande</div>
    {{#if po.requisition_title}}
    <div class="card-row">
      <div class="card-label">Réquisition objet</div>
      <div class="card-value">{{po.requisition_title}}</div>
    </div>
    {{/if}}
    {{#if po.shipping_address}}
    <div class="card-row">
      <div class="card-label">Adresse de livraison</div>
      <div class="card-value">{{po.shipping_address}}</div>
    </div>
    {{/if}}
    <div class="card-row">
      <div class="card-label">Devise</div>
      <div class="card-value">{{po.currency}}</div>
    </div>
    <div class="card-row">
      <div class="card-label">Montant total</div>
      <div class="card-value large" style="color:#1E3A5F">{{po_formatCurrency po.total_amount po.currency}}</div>
    </div>
  </div>
</div>

<!-- ITEMS TABLE -->
{{#if items.length}}
<div class="section-title">Articles commandés</div>
<table>
  <thead>
    <tr>
      <th style="width:30px">#</th>
      <th>Description</th>
      <th class="r" style="width:60px">Qté</th>
      <th class="r" style="width:100px">Prix unitaire</th>
      <th class="r" style="width:110px">Montant</th>
    </tr>
  </thead>
  <tbody>
    {{#each items}}
    <tr>
      <td class="muted">{{po_index1 @index}}</td>
      <td>
        <div style="font-weight:600">{{this.item_description}}</div>
        {{#if this.specifications}}
        <div style="font-size:10px;color:#6B7280;margin-top:2px">{{this.specifications}}</div>
        {{/if}}
      </td>
      <td class="r">{{this.quantity}}</td>
      <td class="r">{{po_formatCurrency this.unit_price ../po.currency}}</td>
      <td class="r" style="font-weight:600">{{po_formatCurrency this.total_amount ../po.currency}}</td>
    </tr>
    {{/each}}
  </tbody>
  <tfoot>
    <tr>
      <td colspan="4" style="text-align:right;padding-right:11px;font-size:11px;color:#374151">
        MONTANT TOTAL TTC
      </td>
      <td class="r">{{po_formatCurrency po.total_amount po.currency}}</td>
    </tr>
  </tfoot>
</table>

{{else}}
<!-- No items — show total only -->
<div class="section-title">Montant</div>
<div class="card" style="display:flex;justify-content:space-between;align-items:center;padding:18px 20px">
  <span style="font-size:13px;color:#6B7280;font-weight:600">Montant total de la commande</span>
  <span style="font-size:22px;font-weight:800;color:#1E3A5F">{{po_formatCurrency po.total_amount po.currency}}</span>
</div>
{{/if}}

<!-- NOTES -->
{{#if po.notes}}
<div class="notes-box">
  <div class="notes-title">Notes / Conditions</div>
  {{po.notes}}
</div>
{{/if}}

<!-- APPROVALS -->
{{#if approvals.length}}
<div class="section-title">Historique des approbations</div>
<table class="approval-table">
  <thead>
    <tr>
      <th>Approbateur</th>
      <th>Décision</th>
      <th>Date</th>
      <th>Commentaire</th>
    </tr>
  </thead>
  <tbody>
    {{#each approvals}}
    <tr>
      <td style="font-weight:600">{{this.first_name}} {{this.last_name}}</td>
      <td>
        {{#if (po_eq this.status 'APPROVED')}}
          <span class="pill-approved">✓ Approuvé</span>
        {{else}}
          <span class="pill-rejected">✗ Rejeté</span>
        {{/if}}
      </td>
      <td style="color:#6B7280">{{po_formatDate this.approved_at}}</td>
      <td style="color:#6B7280;font-style:italic">{{this.comments}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{/if}}

<!-- SIGNATURES -->
<div class="sig-grid">
  <div class="sig-box">
    <div class="sig-line"></div>
    <div class="sig-label">Responsable achats — WWF</div>
    <div style="margin-top:4px;color:#9CA3AF">Nom &amp; signature</div>
  </div>
  <div class="sig-box">
    <div class="sig-line"></div>
    <div class="sig-label">Fournisseur — Cachet &amp; signature</div>
    <div style="margin-top:4px;color:#9CA3AF">{{po.supplier_name}}</div>
  </div>
</div>

<!-- FOOTER -->
<div class="doc-footer">
  <span>WWF — Système de gestion des achats électroniques</span>
  <span>Généré le {{po_formatDate generatedAt}}</span>
</div>

</body>
</html>`;
  }

  async generatePDF(po) {
    if (!po) throw new Error('Purchase order data is required');

    const currency = po.currency || await getEnterpriseCurrencyCode();
    const template = Handlebars.compile(this.getTemplate());
    const html = template({
      po:          { ...po, currency },
      items:       po.items       || [],
      approvals:   po.approvals   || [],
      generatedAt: new Date(),
    });

    const browser = await puppeteer.launch(getBrowserOptions());
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      return await page.pdf({
        format:          'A4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `
          <div style="width:100%;font-size:9px;color:#9CA3AF;padding:0 15mm;display:flex;justify-content:flex-end">
            Page <span class="pageNumber" style="margin:0 3px"></span> / <span class="totalPages"></span>
          </div>`,
        margin: { top: '15mm', bottom: '18mm', left: '15mm', right: '15mm' },
      });
    } finally {
      await browser.close();
    }
  }
}

module.exports = new PurchaseOrderExportService();
