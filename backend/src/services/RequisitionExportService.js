// backend/src/services/RequisitionExportService.js
const puppeteer = require('puppeteer');
const Handlebars = require('handlebars');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { getEnterpriseCurrencyCode } = require('../utils/enterpriseCurrency');
const { getBranding } = require('../utils/enterpriseBranding');
const i18n = require('../i18n');
const { getBrowserOptions } = require('../config/puppeteer');
const db = require('../config/database');

// Couleurs des badges (étape = statut technique, avancement = cycle complet)
const STATUS_COLORS = {
  DRAFT: '#6B7280', PENDING: '#F59E0B', PENDING_APPROVAL: '#F59E0B', BUDGET_CHECKED: '#3B82F6',
  BUDGET_INSUFFICIENT: '#F97316', APPROVED: '#10B981', REJECTED: '#EF4444', IN_PROGRESS: '#8B5CF6',
  COMPLETED: '#10B981', CANCELLED: '#6B7280',
  CLASSIFIED_DIRECT_PURCHASE: '#2563EB', CLASSIFIED_MULTIPLE_QUOTATIONS: '#2563EB',
  CLASSIFIED_RFP: '#2563EB', CLASSIFIED_SOLE_SOURCE: '#2563EB',
};
const PROGRESS_COLORS = { DRAFT: '#6B7280', IN_PROGRESS: '#2563EB', COMPLETED: '#059669', REJECTED: '#DC2626', CANCELLED: '#6B7280' };

// PDF détaillé d'une réquisition — libellés fournis par i18n (data.L), valeurs déjà formatées
const REQUISITION_DETAIL_TEMPLATE = `<!DOCTYPE html>
<html lang="{{lang}}">
<head>
  <meta charset="UTF-8">
  <title>{{L.docTitle}} {{r.requisition_number}}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica', 'Arial', sans-serif; padding: 36px; color: #1F2937; font-size: 12px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px;
              border-bottom: 3px solid #2563EB; padding-bottom: 16px; margin-bottom: 24px; }
    .company { display: flex; gap: 14px; align-items: center; }
    .company img { max-height: 60px; max-width: 140px; object-fit: contain; }
    .company .name { font-size: 17px; font-weight: 700; color: #1E3A8A; }
    .company .info { color: #4B5563; font-size: 11px; line-height: 1.5; margin-top: 2px; }
    .doc { text-align: right; }
    .doc .title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: #374151; }
    .doc .number { font-size: 20px; font-weight: 700; color: #2563EB; margin-top: 2px; }
    .doc .generated { font-size: 10px; color: #6B7280; margin-top: 4px; }
    .badges { margin-top: 8px; display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 9999px; font-size: 10px; font-weight: 700; color: #fff; }
    .badge small { font-weight: 400; opacity: .85; margin-right: 4px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; margin-bottom: 24px; padding: 16px;
                 background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; }
    .info-item .label { font-size: 10px; color: #6B7280; font-weight: 600; text-transform: uppercase; }
    .info-item .value { font-size: 13px; font-weight: 500; margin-top: 2px; }
    .full { grid-column: span 2; }
    .priority-LOW { color: #374151; } .priority-MEDIUM { color: #92400E; } .priority-HIGH { color: #78350F; } .priority-URGENT { color: #991B1B; font-weight: 700; }
    .section-title { font-size: 14px; font-weight: 700; margin: 18px 0 8px; padding-bottom: 6px; border-bottom: 1px solid #E5E7EB; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th { background: #1E3A8A; color: #fff; padding: 7px 8px; text-align: left; font-size: 10px; text-transform: uppercase; }
    td { padding: 7px 8px; border-bottom: 1px solid #E5E7EB; vertical-align: top; }
    tr:nth-child(even) td { background: #F9FAFB; }
    .num { text-align: right; white-space: nowrap; }
    .muted { color: #6B7280; font-size: 10px; }
    tfoot td { font-weight: 700; background: #DBEAFE !important; font-size: 12px; }
    .attachments { padding: 12px; background: #F9FAFB; border-radius: 8px; }
    .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #E5E7EB; text-align: center; font-size: 10px; color: #6B7280; }
  </style>
</head>
<body>
  <div class="header">
    <div class="company">
      {{#if brand.logo}}<img src="{{brand.logo}}" alt="{{brand.name}}">{{/if}}
      <div>
        <div class="name">{{brand.name}}</div>
        <div class="info">
          {{#if brand.address}}{{brand.address}}<br>{{/if}}
          {{#if brand.phone}}{{brand.phone}}{{/if}}{{#if brand.email}}{{#if brand.phone}} · {{/if}}{{brand.email}}{{/if}}
          {{#if brand.website}}<br>{{brand.website}}{{/if}}
          {{#if brand.taxId}}<br>{{L.taxId}} : {{brand.taxId}}{{/if}}{{#if brand.registrationNumber}}{{#if brand.taxId}} · {{else}}<br>{{/if}}{{L.registration}} : {{brand.registrationNumber}}{{/if}}
        </div>
      </div>
    </div>
    <div class="doc">
      <div class="title">{{L.docTitle}}</div>
      <div class="number">{{r.requisition_number}}</div>
      <div class="generated">{{L.generatedOn}}</div>
      <div class="badges">
        <span class="badge" style="background: {{stepColor}}"><small>{{L.step}}</small>{{stepLabel}}</span>
        {{#if progressLabel}}<span class="badge" style="background: {{progressColor}}"><small>{{L.progress}}</small>{{progressLabel}}</span>{{/if}}
      </div>
    </div>
  </div>

  <div class="info-grid">
    <div class="info-item full"><div class="label">{{L.title}}</div><div class="value">{{r.title}}</div></div>
    <div class="info-item"><div class="label">{{L.department}}</div><div class="value">{{r.department_name}}</div></div>
    <div class="info-item"><div class="label">{{L.project}}</div><div class="value">{{r.project_name}}</div></div>
    <div class="info-item"><div class="label">{{L.requester}}</div><div class="value">{{r.first_name}} {{r.last_name}}</div></div>
    <div class="info-item"><div class="label">{{L.createdAt}}</div><div class="value">{{createdAt}}</div></div>
    <div class="info-item"><div class="label">{{L.estimatedAmount}}</div><div class="value">{{estimated}}</div></div>
    <div class="info-item"><div class="label">{{L.priority}}</div><div class="value priority-{{r.priority}}">{{priorityText}}</div></div>
    {{#if r.description}}<div class="info-item full"><div class="label">{{L.description}}</div><div class="value">{{r.description}}</div></div>{{/if}}
    {{#if r.justification}}<div class="info-item full"><div class="label">{{L.justification}}</div><div class="value">{{r.justification}}</div></div>{{/if}}
  </div>

  {{#if items.length}}
  <div class="section-title">{{L.items}}</div>
  <table>
    <thead><tr>
      <th>{{L.itemDescription}}</th><th>{{L.budgetLine}}</th>
      <th class="num">{{L.quantity}}</th><th class="num">{{L.frequency}}</th>
      <th class="num">{{L.unitPrice}}</th><th class="num">{{L.total}}</th>
    </tr></thead>
    <tbody>
      {{#each items}}
      <tr>
        <td>{{this.item_description}}{{#if this.specifications}}<div class="muted">{{this.specifications}}</div>{{/if}}</td>
        <td>{{#if this.budgetLine}}{{this.budgetLine}}{{else}}—{{/if}}</td>
        <td class="num">{{this.qty}}</td>
        <td class="num">{{this.freq}}</td>
        <td class="num">{{this.unitPrice}}</td>
        <td class="num">{{this.totalAmount}}</td>
      </tr>
      {{/each}}
    </tbody>
    <tfoot><tr><td colspan="5" class="num">{{L.grandTotal}}</td><td class="num">{{estimated}}</td></tr></tfoot>
  </table>
  {{/if}}

  {{#if attachments.length}}
  <div class="section-title">{{L.attachments}}</div>
  <div class="attachments">
    {{#each attachments}}<div>📎 {{this.file_name}} <span class="muted">({{this.file_size}} {{../L.bytes}})</span></div>{{/each}}
  </div>
  {{/if}}

  <div class="footer">{{L.footer}}</div>
</body>
</html>`;

class RequisitionExportService {
  constructor() {
    // Enregistrer les helpers Handlebars
    this.registerHelpers();
  }

  registerHelpers() {
    // Helper pour formater les dates
    Handlebars.registerHelper('formatDate', (date) => {
      if (!date) return '-';
      return new Date(date).toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    });

    // Helper pour formater l'heure
    Handlebars.registerHelper('formatTime', (date) => {
      if (!date) return '-';
      return new Date(date).toLocaleTimeString('fr-FR', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
    });

    // Helper pour formater les nombres
    Handlebars.registerHelper('formatNumber', (number) => {
      if (number === null || number === undefined || number === '') return '0';
      return Number(number).toLocaleString('fr-FR');
    });

    // Helper pour formater les montants
    Handlebars.registerHelper('formatCurrency', (amount, currency = 'USD') => {
      if (amount === null || amount === undefined || amount === '') return '0 ' + currency;
      return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(amount);
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

    // Helper pour le statut en français
    Handlebars.registerHelper('statusLabel', (status) => {
      const labels = {
        'DRAFT': 'Brouillon',
        'PENDING': 'En attente',
        'BUDGET_CHECKED': 'Budget vérifié',
        'APPROVED': 'Approuvé',
        'REJECTED': 'Rejeté',
        'IN_PROGRESS': 'En cours',
        'COMPLETED': 'Terminé',
        'CANCELLED': 'Annulé'
      };
      return labels[status] || status;
    });

    // Helper pour les priorités
    Handlebars.registerHelper('priorityLabel', (priority) => {
      const labels = {
        'LOW': 'Basse',
        'MEDIUM': 'Moyenne',
        'HIGH': 'Haute',
        'URGENT': 'Urgente'
      };
      return labels[priority] || priority;
    });
  }

  /**
   * Générer le template HTML pour l'export PDF
   */
  generateHTML(requisitions, title = 'Liste des réquisitions', brand = null) {
    // Validation
    if (!Array.isArray(requisitions)) {
      throw new Error('requisitions must be an array');
    }

    const template = `
      <!DOCTYPE html>
      <html>
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
              Généré le {{formatDate generatedAt}} à {{formatTime generatedAt}}
            </div>
          </div>

          <div class="summary">
            <div class="summary-item">
              <div class="number">{{totalRequisitions}}</div>
              <div class="label">Total réquisitions</div>
            </div>
            <div class="summary-item">
              <div class="number">{{formatNumber totalAmount}} USD</div>
              <div class="label">Montant total</div>
            </div>
            <div class="summary-item">
              <div class="number">{{pendingCount}}</div>
              <div class="label">En attente</div>
            </div>
            <div class="summary-item">
              <div class="number">{{approvedCount}}</div>
              <div class="label">Approuvées</div>
            </div>
          </div>

          {{#if requisitions.length}}
          <table>
            <thead>
              <tr>
                <th>N°</th>
                <th>Titre</th>
                <th>Département</th>
                <th>Montant</th>
                <th>Statut</th>
                <th>Priorité</th>
                <th>Date</th>
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
            Aucune réquisition trouvée
          </div>
          {{/if}}

          <div class="footer">
            <p>{{brand.name}} — document généré automatiquement par {{brand.appName}}</p>
            <p>Page <span class="font-bold"></span> / <span class="font-bold"></span></p>
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
    const data = {
      brand,
      title,
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
  async generatePDF(requisitions, title = 'Liste des réquisitions') {
    let browser = null;
    
    try {
      // Lancer le navigateur
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu'
        ]
      });

      const page = await browser.newPage();

      // Générer le HTML
      const html = this.generateHTML(requisitions, title, await getBranding());

      // Charger le HTML
      await page.setContent(html, {
        waitUntil: 'networkidle0'
      });

      // Générer le PDF
      const pdfBuffer = await page.pdf({
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
        footerTemplate: '<div style="font-size: 10px; color: #6B7280; padding-right: 20px; padding-bottom: 10px; text-align: right;">Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>'
      });

      return pdfBuffer;

    } catch (error) {
      console.error('Error generating PDF:', error);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
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

    const t = i18n.translator(lang);
    const locale = i18n.locale(lang);
    const currencyRow = requisition.currency_id
      ? await db.one('SELECT format_key FROM currency WHERE id = $1', [requisition.currency_id])
      : null;
    const currency = currencyRow?.format_key || await getEnterpriseCurrencyCode();
    const money = (n) => {
      try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(parseFloat(n) || 0);
      } catch {
        return `${parseFloat(n) || 0} ${currency}`;
      }
    };
    const num = (n) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(parseFloat(n) || 0);
    const date = (d) => (d ? new Date(d).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
    const now = new Date();
    const brand = await getBranding(requisition.enterprise_id);
    const progress = requisition.progress_status;

    const data = {
      L: {
        docTitle: t('requisition.docTitle'),
        generatedOn: t('requisition.generatedOn', {
          date: date(now),
          time: now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
        }),
        title: t('requisition.title'), step: t('requisition.step'), progress: t('requisition.progress'),
        department: t('requisition.department'), project: t('requisition.project'),
        estimatedAmount: t('requisition.estimatedAmount'), priority: t('requisition.priority'),
        requester: t('requisition.requester'), createdAt: t('requisition.createdAt'),
        description: t('requisition.description'), justification: t('requisition.justification'),
        items: t('requisition.items'), itemDescription: t('requisition.itemDescription'),
        quantity: t('requisition.quantity'), frequency: t('requisition.frequency'),
        unitPrice: t('requisition.unitPrice'), total: t('requisition.total'), grandTotal: t('requisition.grandTotal'),
        budgetLine: t('requisition.budgetLine'), attachments: t('requisition.attachments'), bytes: t('requisition.bytes'),
        taxId: t('requisition.taxId'), registration: t('requisition.registration'),
        footer: t('requisition.footer', { enterprise: brand.name, app: brand.appName }),
      },
      lang: i18n.normalizeLang(lang),
      brand,
      r: requisition,
      stepLabel: t(`status.${requisition.status}`),
      stepColor: STATUS_COLORS[requisition.status] || '#6B7280',
      progressLabel: progress ? t(`progress.${progress}`) : null,
      progressColor: PROGRESS_COLORS[progress] || '#6B7280',
      // (nom distinct du helper Handlebars « priorityLabel »)
      priorityText: requisition.priority ? t(`priority.${requisition.priority}`) : '—',
      createdAt: date(requisition.created_at),
      estimated: money(requisition.estimated_amount),
      items: (requisition.items || []).map(i => ({
        ...i,
        qty: num(i.quantity),
        freq: num(i.frequency),
        unitPrice: money(i.unit_price),
        totalAmount: money(i.total_amount),
        budgetLine: i.budget_line_code || null,
      })),
      attachments: requisition.attachments || [],
    };

    const html = Handlebars.compile(REQUISITION_DETAIL_TEMPLATE)(data);

    let browser = null;
    try {
      browser = await puppeteer.launch(getBrowserOptions());
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      return await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' },
      });
    } catch (error) {
      console.error('Error generating requisition detail PDF:', error);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
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