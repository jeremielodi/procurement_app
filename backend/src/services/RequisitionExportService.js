// backend/src/services/RequisitionExportService.js
const Handlebars = require('handlebars');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { getEnterpriseCurrencyCode } = require('../utils/enterpriseCurrency');
const { getBranding, brandContact } = require('../utils/enterpriseBranding');
const i18n = require('../i18n');
const { renderPdf } = require('../utils/pdfRenderer');
const { pdfContext, labels, rootLocale } = require('../utils/pdfI18n');
const db = require('../config/database');
const { signatureDataUri } = require('../utils/userSignature');

// Étapes d'approbation de la réquisition (signataires du formulaire de demande d'achat)
const APPROVAL_TASKS = ['Activity_ValidationN1_Manager', 'Activity_ValidationN2_Finance', 'Activity_ValidationN3_DG'];

// Formulaire de demande d'achat (modèle de l'entreprise) — libellés : pdf.prf des locales (data.L), valeurs déjà formatées.
// Sections : 1. demandeur / approbateurs, 2. livraison, 3. articles + codage budgétaire, déclaration, informations supplémentaires.
const REQUISITION_DETAIL_TEMPLATE = `<!DOCTYPE html>
<html lang="{{lang}}">
<head>
<meta charset="UTF-8">
<title>{{L.title}} {{r.requisition_number}}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 9.5px; color: #111; line-height: 1.3; }
  .brand { display: flex; align-items: center; gap: 12px; padding-bottom: 6px; margin-bottom: 8px; border-bottom: 2px solid #000; }
  .brand img { max-height: 48px; max-width: 140px; object-fit: contain; }
  .brand .name { font-size: 15px; font-weight: 700; }
  .brand .info { font-size: 8.5px; color: #333; margin-top: 1px; }
  table { width: 100%; border-collapse: collapse; }
  td, th { border: 1px solid #000; padding: 3px 5px; vertical-align: top; }
  .head td { height: 38px; }
  .doc-title { font-size: 17px; font-weight: 700; vertical-align: middle; }
  .doc-title .ref { display: block; font-size: 9px; font-weight: 400; color: #444; margin-top: 2px; }
  .lbl { font-weight: 400; }
  .val { font-weight: 700; }
  .section { font-weight: 700; margin: 9px 0 2px; }
  .sig { height: 34px; }
  .sig img { max-height: 30px; max-width: 150px; display: block; margin-top: 2px; }
  .items th { background: #fff; font-weight: 700; text-align: center; vertical-align: middle; }
  .items td { vertical-align: middle; }
  .items td.c { text-align: center; }
  .items td.money { white-space: nowrap; }
  .items td.money span { float: left; }
  .items td.money b, .items td.money i { float: right; font-style: normal; }
  .items .spec { color: #444; font-size: 8.5px; }
  .warn { color: #C00000; font-weight: 700; text-align: center; font-size: 9px; }
  .total td { border: none; }
  .total td.box { border: 1px solid #000; font-weight: 700; }
  .coding th { font-weight: 700; text-align: center; vertical-align: middle; font-size: 9px; }
  .coding td { height: 16px; }
  .coding td.r { text-align: right; white-space: nowrap; }
  .box { border: 1px solid #000; padding: 5px 7px; margin-top: 10px; min-height: 46px; }
  .box .t { text-align: center; }
  .box .red { color: #C00000; text-align: center; margin-top: 3px; white-space: pre-wrap; }
  .box .txt { margin-top: 3px; white-space: pre-wrap; }
  .notes { color: #C00000; font-style: italic; font-weight: 700; font-size: 8.5px; margin-top: 8px; }
  .notes u { text-decoration: underline; }
  .notes p { margin-top: 4px; }
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

  <table class="head">
    <tr>
      <td class="doc-title" style="width:34%">
        {{L.title}}
        <span class="ref">{{r.requisition_number}}</span>
      </td>
      <td style="width:33%"><b>{{L.instructions}}</b><br>{{L.instructionsText}}</td>
      <td>{{L.submittedOn}} {{submittedAt}}</td>
    </tr>
  </table>

  <div class="section">{{L.s1}}</div>
  <table>
    <tr>
      <td style="width:22%" class="sig"><span class="lbl">{{L.requesterName}}</span> <span class="val">{{requester.name}}</span>{{#if requester.title}}<br>{{requester.title}}{{/if}}</td>
      <td style="width:40%" colspan="2"><span class="lbl">{{L.service}}</span> <span class="val">{{service}}</span></td>
      <td><span class="lbl">{{L.requesterSignature}}</span> {{submittedAt}}{{#if requester.signature}}<img src="{{requester.signature}}" alt="">{{/if}}</td>
    </tr>
    <tr>
      <td class="sig"><span class="lbl">{{L.approverName}}</span> <span class="val">{{approver.name}}</span>{{#if approver.title}}<br>{{approver.title}}{{/if}}</td>
      <td style="width:20%"><span class="lbl">{{L.approverSignature}}</span> {{approver.date}}{{#if approver.signature}}<img src="{{approver.signature}}" alt="">{{/if}}</td>
      <td style="width:20%"><span class="lbl">{{L.secondApproverName}}</span> <span class="val">{{secondApprover.name}}</span>{{#if secondApprover.title}}<br>{{secondApprover.title}}{{/if}}</td>
      <td><span class="lbl">{{L.secondApproverSignature}}</span> {{secondApprover.date}}{{#if secondApprover.signature}}<img src="{{secondApprover.signature}}" alt="">{{/if}}</td>
    </tr>
  </table>

  <div class="section">{{L.s2}}</div>
  <table>
    <tr>
      <td style="width:22%"><span class="lbl">{{L.deliveryAddress}}</span> <span class="val">{{r.delivery_address}}</span></td>
      <td style="width:16%"><span class="lbl">{{L.neededBy}}</span> {{neededBy}}</td>
      <td style="width:26%"><span class="lbl">{{L.recipient}}</span> {{r.delivery_recipient}}</td>
      <td><span class="lbl">{{L.contact}}</span> {{r.delivery_contact}}</td>
    </tr>
  </table>

  <div class="section">{{L.s3}}</div>
  <table class="items">
    <thead>
      <tr>
        <th style="width:6%">{{L.lineNo}}</th>
        <th>{{L.itemDescription}}</th>
        <th style="width:11%">{{L.unit}}</th>
        <th style="width:9%">{{L.quantity}}</th>
        <th style="width:15%">{{L.unitPrice}}</th>
        <th style="width:13%">{{L.total}}</th>
      </tr>
    </thead>
    <tbody>
      {{#each items}}
      <tr>
        <td class="c">{{this.no}}</td>
        <td>{{this.item_description}}{{#if this.specifications}}<div class="spec">{{this.specifications}}</div>{{/if}}</td>
        <td class="c">{{this.unitLabel}}</td>
        <td class="c">{{this.qtyLabel}}</td>
        <td class="money"><span>{{@root.symbol}}</span><i>{{this.unitPrice}}</i></td>
        <td class="money"><span>{{@root.symbol}}</span><b>{{this.totalAmount}}</b></td>
      </tr>
      {{/each}}
      <tr><td colspan="6" class="warn">{{L.statement}}</td></tr>
    </tbody>
  </table>
  <table class="total">
    <tr>
      <td style="width:72%"></td>
      <td class="box" style="text-align:right;width:15%">{{L.grandTotal}} {{symbol}}</td>
      <td class="box" style="text-align:right">{{grandTotal}}</td>
    </tr>
  </table>

  <table class="coding" style="margin-top:10px">
    <thead>
      <tr>
        <th style="width:7%">{{L.entityCode}}</th>
        <th style="width:12%">{{L.expenseCode}}</th>
        <th style="width:11%">{{L.fundingSource}}</th>
        <th style="width:15%">{{L.projectCode}}</th>
        <th style="width:9%">{{L.reportingOffice}}</th>
        <th style="width:10%">{{L.subProject}}</th>
        <th style="width:8%">{{L.functionCode}}</th>
        <th style="width:11%">{{L.activityCode}}</th>
        <th style="width:9%">{{L.amount}}</th>
        <th>{{L.lineRefs}}</th>
      </tr>
    </thead>
    <tbody>
      {{#each coding}}
      <tr>
        <td>{{this.entity_code}}</td>
        <td>{{this.loc}}</td>
        <td>{{this.funding_source}}</td>
        <td>{{this.project}}</td>
        <td></td>
        <td>{{this.sub_project}}</td>
        <td>{{this.function_code}}</td>
        <td>{{this.activity_code}}</td>
        <td class="r">{{this.amount}}</td>
        <td>{{this.lines}}</td>
      </tr>
      {{/each}}
      <tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
    </tbody>
  </table>

  <div class="box">
    <div class="t">{{L.declaration}}</div>
    <div class="red">{{r.justification}}</div>
  </div>

  <div class="box">
    <div class="t"><b>{{L.additionalInfo}}</b></div>
    <div class="txt">{{r.description}}</div>
  </div>

  <div class="notes">
    <p><u>{{L.note1Title}}</u> {{L.note1}}</p>
    <p>{{L.note2}}</p>
  </div>
</body>
</html>`;

class RequisitionExportService {
  constructor() {
    // Enregistrer les helpers Handlebars
    this.registerHelpers();
  }

  // Langue : racine du template (locale, S = statuts, P = priorités) — voir utils/pdfI18n
  registerHelpers() {
    // Helper pour formater les dates
    Handlebars.registerHelper('formatDate', (date, options) => {
      if (!date) return '-';
      return new Date(date).toLocaleDateString(rootLocale(options), {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    });

    // Helper pour formater l'heure
    Handlebars.registerHelper('formatTime', (date, options) => {
      if (!date) return '-';
      return new Date(date).toLocaleTimeString(rootLocale(options), { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
    });

    // Helper pour formater les nombres
    Handlebars.registerHelper('formatNumber', (number, options) => {
      if (number === null || number === undefined || number === '') return '0';
      return Number(number).toLocaleString(rootLocale(options));
    });

    // Helper pour formater les montants
    Handlebars.registerHelper('formatCurrency', (amount, currency, options) => {
      if (typeof currency !== 'string' || !currency) { options = options || currency; currency = 'USD'; }
      if (amount === null || amount === undefined || amount === '') return '0 ' + currency;
      return new Intl.NumberFormat(rootLocale(options), { style: 'currency', currency }).format(amount);
    });

    // Helper pour les conditions
    Handlebars.registerHelper('eq', (a, b) => a === b);
    Handlebars.registerHelper('neq', (a, b) => a !== b);
    Handlebars.registerHelper('gt', (a, b) => a > b);
    Handlebars.registerHelper('lt', (a, b) => a < b);

    // Helper pour le statut avec couleur
    Handlebars.registerHelper('statusColor', (status) => {
      const colors = {
        'DRAFT': '#6B7280',
        'PENDING': '#F59E0B',
        'BUDGET_CHECKED': '#3B82F6',
        'APPROVED': '#10B981',
        'REJECTED': '#EF4444',
        'IN_PROGRESS': '#8B5CF6',
        'COMPLETED': '#10B981',
        'CANCELLED': '#6B7280'
      };
      return colors[status] || '#6B7280';
    });

    // Statut / priorité traduits (dictionnaires status.* / priority.* des locales)
    Handlebars.registerHelper('statusLabel', (status, options) => options?.data?.root?.S?.[status] || status);
    Handlebars.registerHelper('priorityLabel', (priority, options) => options?.data?.root?.P?.[priority] || priority);
  }

  /**
   * Générer le template HTML pour l'export PDF
   */
  generateHTML(requisitions, title = null, brand = null, { lang } = {}) {
    // Validation
    if (!Array.isArray(requisitions)) {
      throw new Error('requisitions must be an array');
    }

    const template = `
      <!DOCTYPE html>
      <html lang="{{lang}}">
        <head>
          <meta charset="UTF-8">
          <title>{{title}}</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              font-family: 'Helvetica', 'Arial', sans-serif;
              padding: 40px;
              color: #1F2937;
            }
            .header {
              text-align: center;
              margin-bottom: 30px;
              border-bottom: 2px solid #2563EB;
              padding-bottom: 20px;
            }
            .header h1 {
              font-size: 24px;
              color: #2563EB;
              font-weight: 700;
            }
            .header .subtitle {
              font-size: 12px;
              color: #6B7280;
              margin-top: 5px;
            }
            .summary {
              display: flex;
              justify-content: space-between;
              margin-bottom: 20px;
              padding: 15px;
              background: #F3F4F6;
              border-radius: 8px;
            }
            .summary-item {
              text-align: center;
            }
            .summary-item .number {
              font-size: 20px;
              font-weight: 700;
              color: #2563EB;
            }
            .summary-item .label {
              font-size: 12px;
              color: #6B7280;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 20px;
              font-size: 12px;
            }
            table thead {
              background: #2563EB;
              color: white;
            }
            table th {
              padding: 10px 12px;
              text-align: left;
              font-weight: 600;
              font-size: 11px;
              text-transform: uppercase;
            }
            table td {
              padding: 8px 12px;
              border-bottom: 1px solid #E5E7EB;
            }
            table tbody tr:nth-child(even) {
              background: #F9FAFB;
            }
            table tbody tr:hover {
              background: #EFF6FF;
            }
            .status-badge {
              display: inline-block;
              padding: 3px 10px;
              border-radius: 9999px;
              font-size: 10px;
              font-weight: 600;
            }
            .priority-badge {
              display: inline-block;
              padding: 3px 8px;
              border-radius: 4px;
              font-size: 10px;
              font-weight: 600;
            }
            .priority-LOW { background: #E5E7EB; color: #374151; }
            .priority-MEDIUM { background: #FEF3C7; color: #92400E; }
            .priority-HIGH { background: #FDE68A; color: #78350F; }
            .priority-URGENT { background: #FECACA; color: #991B1B; }
            .footer {
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #E5E7EB;
              text-align: center;
              font-size: 11px;
              color: #6B7280;
            }
            .page-break {
              page-break-after: always;
            }
            .text-right { text-align: right; }
            .text-center { text-align: center; }
            .font-bold { font-weight: 700; }
            .text-blue { color: #2563EB; }
            .text-green { color: #10B981; }
            .text-red { color: #EF4444; }
            .text-yellow { color: #F59E0B; }
            .mt-4 { margin-top: 16px; }
            .mb-4 { margin-bottom: 16px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>{{title}}</h1>
            <div class="subtitle">
              {{T.generatedOn}}
            </div>
          </div>

          <div class="summary">
            <div class="summary-item">
              <div class="number">{{totalRequisitions}}</div>
              <div class="label">{{L.total}}</div>
            </div>
            <div class="summary-item">
              <div class="number">{{formatNumber totalAmount}} USD</div>
              <div class="label">{{L.totalAmount}}</div>
            </div>
            <div class="summary-item">
              <div class="number">{{pendingCount}}</div>
              <div class="label">{{L.pending}}</div>
            </div>
            <div class="summary-item">
              <div class="number">{{approvedCount}}</div>
              <div class="label">{{L.approved}}</div>
            </div>
          </div>

          {{#if requisitions.length}}
          <table>
            <thead>
              <tr>
                <th>{{L.no}}</th>
                <th>{{L.reqTitle}}</th>
                <th>{{L.department}}</th>
                <th>{{L.amount}}</th>
                <th>{{L.status}}</th>
                <th>{{L.priority}}</th>
                <th>{{L.date}}</th>
              </tr>
            </thead>
            <tbody>
              {{#each requisitions}}
              <tr>
                <td><strong>{{this.requisition_number}}</strong></td>
                <td>{{this.title}}</td>
                <td>{{this.department_name}}</td>
                <td class="text-right">{{formatCurrency this.estimated_amount this.currency}}</td>
                <td>
                  <span class="status-badge" style="background: {{statusColor this.status}}; color: white;">
                    {{statusLabel this.status}}
                  </span>
                </td>
                <td>
                  <span class="priority-badge priority-{{this.priority}}">
                    {{priorityLabel this.priority}}
                  </span>
                </td>
                <td>{{formatDate this.created_at}}</td>
              </tr>
              {{/each}}
            </tbody>
          </table>
          {{else}}
          <div class="text-center" style="padding: 40px; color: #6B7280;">
            {{L.empty}}
          </div>
          {{/if}}

          <div class="footer">
            <p>{{T.footer}}</p>
          </div>
        </body>
      </html>
    `;

    // Compiler le template
    const compiledTemplate = Handlebars.compile(template);

    // Calculer les statistiques
    const totalAmount = requisitions.reduce((sum, r) => sum + (r.estimated_amount || 0), 0);
    const pendingCount = requisitions.filter(r => r.status === 'PENDING').length;
    const approvedCount = requisitions.filter(r => r.status === 'APPROVED' || r.status === 'COMPLETED').length;

    // Données pour le template
    const ctx = pdfContext(lang, 'requisitionList');
    const now = new Date();
    const data = {
      ...ctx,
      S: labels(ctx.lang, 'status'),
      P: labels(ctx.lang, 'priority'),
      T: {
        generatedOn: ctx.t('requisition.generatedOn', {
          date: now.toLocaleDateString(ctx.locale, { day: '2-digit', month: '2-digit', year: 'numeric' }),
          time: now.toLocaleTimeString(ctx.locale, { hour: '2-digit', minute: '2-digit' }),
        }),
        footer: ctx.t('pdf.requisitionList.footer', { enterprise: brand?.name || '', app: brand?.appName || 'procureApp' }),
      },
      brand,
      title: title || ctx.L.title,
      requisitions,
      totalRequisitions: requisitions.length,
      totalAmount,
      pendingCount,
      approvedCount,
      generatedAt: new Date()
    };

    return compiledTemplate(data);
  }

  /**
   * Générer le PDF pour une ou plusieurs réquisitions
   */
  /** lang : langue du document ('fr' par défaut) ; title absent → titre traduit */
  async generatePDF(requisitions, title = null, { lang } = {}) {
    try {
      const html = this.generateHTML(requisitions, title, await getBranding(), { lang });

      // PDF via le navigateur partagé (utils/pdfRenderer)
      const pdfBuffer = await renderPdf(html, {
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20px',
          bottom: '20px',
          left: '20px',
          right: '20px'
        },
        displayHeaderFooter: true,
        headerTemplate: '<div style="font-size: 10px; color: #6B7280; padding-left: 20px; padding-top: 10px;">procureApp</div>',
        footerTemplate: '<div style="font-size: 10px; color: #6B7280; padding-right: 20px; padding-bottom: 10px; text-align: right;">' + i18n.translator(lang)('pdf.common.page') + ' <span class="pageNumber"></span> / <span class="totalPages"></span></div>'
      });

      return pdfBuffer;

    } catch (error) {
      console.error('Error generating PDF:', error);
      throw error;
    }
  }

  /**
   * Générer le PDF pour une réquisition spécifique (détail)
   */
  /**
   * PDF détaillé d'une réquisition, en français ou en anglais.
   * En-tête : identité de l'entreprise (logo, nom, coordonnées) ; statuts traduits (i18n).
   * @param {object} requisition  réquisition complète (RequisitionModel.findById)
   * @param {object} [options]    { lang: 'fr' | 'en' }
   */
  async generateRequisitionDetailPDF(requisition, { lang = 'fr' } = {}) {
    if (!requisition) throw new Error('requisition is required');

    const ctx = pdfContext(lang, 'prf');
    const { locale } = ctx;
    const currencyRow = requisition.currency_id
      ? await db.one('SELECT format_key FROM currency WHERE id = $1', [requisition.currency_id])
      : null;
    const currency = currencyRow?.format_key || await getEnterpriseCurrencyCode();
    // Montants en colonnes « symbole | nombre » comme le formulaire papier
    const symbol = (() => {
      try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find(p => p.type === 'currency')?.value || currency;
      } catch { return currency; }
    })();
    const amount = (n) => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(n) || 0);
    const num = (n) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(parseFloat(n) || 0);
    const date = (d) => (d ? new Date(d).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
    const brand = await getBranding(requisition.enterprise_id);

    const requester = requisition.requester_id
      ? await db.one('SELECT first_name, last_name, position FROM users WHERE id = $1', [requisition.requester_id])
      : null;
    const approvers = await this.requisitionApprovers(requisition.id);
    const person = async (a) => (a ? {
      name: [a.first_name, a.last_name].filter(Boolean).join(' '),
      title: a.position || '',
      date: date(a.performed_at),
      signature: await signatureDataUri(a.performed_by),
    } : {});

    const items = (requisition.items || []).map((i, index) => {
      const frequency = parseFloat(i.frequency) || 1;
      return {
        ...i,
        no: index + 1,
        unitLabel: i.item_unit || i.unit || '',
        // Fréquence (ex. nombre de mois) : quantité × fréquence, comme le total de la ligne
        qtyLabel: frequency !== 1 ? `${num(i.quantity)} × ${num(frequency)}` : num(i.quantity),
        unitPrice: amount(i.unit_price),
        totalAmount: amount(i.total_amount),
      };
    });

    // Codage du grand livre : une ligne par ligne budgétaire, montant et n° des articles de la section 3
    const lineIds = [...new Set((requisition.items || []).map(i => i.budget_line_id).filter(Boolean))];
    const budgetLines = lineIds.length
      ? await db.select(
        `SELECT b.id, b.entity_code, b.loc, b.funding_source, b.sub_project, b.function_code, b.activity_code,
                p.code AS project_code, p.name AS project_name
         FROM budget_allocations b LEFT JOIN projects p ON p.id = b.project_id
         WHERE b.id = ANY($1::uuid[])`,
        [lineIds]
      )
      : [];
    const coding = budgetLines.map(b => {
      const own = items.filter(i => String(i.budget_line_id) === String(b.id));
      return {
        ...b,
        project: [b.project_code || requisition.project_code, b.project_name || requisition.project_name].filter(Boolean).join(' – '),
        amount: amount(own.reduce((s, i) => s + (parseFloat(i.total_amount) || 0), 0)),
        lines: own.map(i => i.no).join(', '),
      };
    });

    const submitted = requisition.submitted_at || requisition.created_at;
    const data = {
      ...ctx,
      brand,
      brandContact: brandContact(brand),
      r: requisition,
      symbol,
      submittedAt: date(submitted),
      neededBy: date(requisition.needed_by),
      service: [requisition.department_name, requisition.project_name].filter(Boolean).join(' — '),
      requester: requester ? {
        name: [requester.first_name, requester.last_name].filter(Boolean).join(' '),
        title: requester.position || '',
        signature: await signatureDataUri(requisition.requester_id),
      } : {},
      approver: await person(approvers[0]),
      secondApprover: await person(approvers[1]),
      items,
      coding,
      grandTotal: amount(requisition.estimated_amount),
    };

    const html = Handlebars.compile(REQUISITION_DETAIL_TEMPLATE)(data);

    try {
      return await renderPdf(html, {
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `<div style="width:100%;font-size:8px;color:#555;text-align:center"><span class="pageNumber"></span></div>`,
        margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' },
      });
    } catch (error) {
      console.error('Error generating requisition detail PDF:', error);
      throw error;
    }
  }

  /**
   * Personnes ayant approuvé la réquisition (étapes N1 / N2 / N3 terminées avec approved = true), de la première à la
   * dernière — seule la dernière soumission compte (une version renvoyée pour correction est ré-approuvée).
   */
  async requisitionApprovers(requisitionId) {
    const rows = await db.select(
      `SELECT h.performed_by, h.performed_at, h.comments, h.action, u.first_name, u.last_name, u.position
       FROM workflow_history h LEFT JOIN users u ON u.id = h.performed_by
       WHERE h.entity_type = 'requisition' AND h.entity_id = $1
         AND (h.action = 'RESUBMITTED' OR (h.action = 'TASK_COMPLETED' AND h.task_definition_id = ANY($2)))
       ORDER BY h.performed_at`,
      [requisitionId, APPROVAL_TASKS]
    );
    let approvers = [];
    for (const row of rows) {
      if (row.action === 'RESUBMITTED') { approvers = []; continue; }
      let vars = {};
      try { vars = JSON.parse(row.comments || '{}').user_vars || {}; } catch { /* commentaire libre */ }
      if ((vars.approved === true || vars.approved === 'true') && row.performed_by) approvers.push(row);
    }
    return approvers;
  }


  
  /**
   * Sauvegarder le PDF sur le serveur
   */
  async savePDFToServer(pdfBuffer, filename) {
    try {
      const filePath = path.join(__dirname, filename);
      
      // Sauvegarder le fichier
      fs.writeFileSync(filePath, pdfBuffer);
      
      console.log(`✅ PDF sauvegardé: ${filePath}`);
      console.log(`📄 Taille: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);
      
      return filePath;
    } catch (error) {
      console.error('❌ Erreur lors de la sauvegarde du PDF:', error);
      return null;
    }
  }

  /**
   * Exporter en Excel
   */
  async exportToExcel(requisitions) {
    // Validation
    if (!Array.isArray(requisitions)) {
      throw new Error('requisitions must be an array');
    }

    const enterpriseCurrency = await getEnterpriseCurrencyCode();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'procureApp';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Réquisitions', {
      properties: { tabColor: { argb: 'FF2563EB' } },
      pageSetup: { orientation: 'landscape', fitToPage: true }
    });

    // Style de base
    const headerFont = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };

    // Labels de statut pour Excel
    const statusLabels = {
      'DRAFT': 'Brouillon',
      'PENDING': 'En attente',
      'BUDGET_CHECKED': 'Budget vérifié',
      'APPROVED': 'Approuvé',
      'REJECTED': 'Rejeté',
      'IN_PROGRESS': 'En cours',
      'COMPLETED': 'Terminé',
      'CANCELLED': 'Annulé'
    };

    // Couleurs de statut pour Excel
    const statusColors = {
      'DRAFT': 'FF9CA3AF',
      'PENDING': 'FFF59E0B',
      'BUDGET_CHECKED': 'FF3B82F6',
      'APPROVED': 'FF10B981',
      'REJECTED': 'FFEF4444',
      'IN_PROGRESS': 'FF8B5CF6',
      'COMPLETED': 'FF10B981',
      'CANCELLED': 'FF6B7280'
    };

    // Colonnes
    worksheet.columns = [
      { header: 'N° Réquisition', key: 'number', width: 20 },
      { header: 'Titre', key: 'title', width: 35 },
      { header: 'Département', key: 'department', width: 25 },
      { header: 'Projet', key: 'project', width: 25 },
      { header: 'Montant', key: 'amount', width: 15 },
      { header: 'Devise', key: 'currency', width: 10 },
      { header: 'Statut', key: 'status', width: 20 },
      { header: 'Priorité', key: 'priority', width: 15 },
      { header: 'Demandeur', key: 'requester', width: 25 },
      { header: 'Date création', key: 'created_at', width: 20 }
    ];

    // Style d'en-tête
    worksheet.getRow(1).font = headerFont;
    worksheet.getRow(1).fill = headerFill;
    worksheet.getRow(1).height = 25;
    worksheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };

    // Données
    requisitions.forEach((req, index) => {
      const row = worksheet.addRow({
        number: req.requisition_number || '-',
        title: req.title || '-',
        department: req.department_name || '-',
        project: req.project_name || '-',
        amount: req.estimated_amount || 0,
        currency: req.currency || enterpriseCurrency,
        status: statusLabels[req.status] || req.status || '-',
        priority: req.priority || '-',
        requester: req.first_name && req.last_name ? `${req.first_name} ${req.last_name}` : (req.email || '-'),
        created_at: req.created_at ? new Date(req.created_at).toLocaleString('fr-FR') : '-'
      });

      row.getCell('amount').numFmt = '#,##0.00';
      row.getCell('amount').alignment = { horizontal: 'right' };

      // Couleur du statut
      const statusCell = row.getCell('status');
      if (statusColors[req.status]) {
        statusCell.font = { color: { argb: statusColors[req.status] }, bold: true };
      }

      // Alternance des couleurs
      if (index % 2 === 0) {
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        });
      }

      row.height = 20;
      row.alignment = { vertical: 'middle' };
    });

    // Total
    const totalRow = worksheet.addRow({
      number: 'TOTAL',
      amount: requisitions.reduce((sum, r) => sum + (r.estimated_amount || 0), 0)
    });
    totalRow.getCell('number').font = { bold: true };
    totalRow.getCell('amount').font = { bold: true };
    totalRow.getCell('amount').numFmt = '#,##0.00';
    totalRow.getCell('amount').alignment = { horizontal: 'right' };
    totalRow.height = 25;

    // Bordures
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        };
      });
    });

    return await workbook.xlsx.writeBuffer();
  }
}

module.exports = new RequisitionExportService();