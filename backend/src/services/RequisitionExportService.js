// backend/src/services/RequisitionExportService.js
const puppeteer = require('puppeteer');
const Handlebars = require('handlebars');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

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
  generateHTML(requisitions, title = 'Liste des réquisitions') {
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
            <p>Document généré automatiquement par Procurement System</p>
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
      const html = this.generateHTML(requisitions, title);

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
        headerTemplate: '<div style="font-size: 10px; color: #6B7280; padding-left: 20px; padding-top: 10px;">Procurement System</div>',
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
  async generateRequisitionDetailPDF(requisition) {
    // Validation et défauts
    if (!requisition) {
      throw new Error('requisition is required');
    }
    
    // Assurer que items et attachments sont des tableaux
    const safeRequisition = {
      ...requisition,
      items: requisition.items || [],
      attachments: requisition.attachments || []
    };

    const template = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Détail Réquisition {{requisition.requisition_number}}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: 'Helvetica', 'Arial', sans-serif;
              padding: 40px;
              color: #1F2937;
            }
            .header {
              border-bottom: 2px solid #2563EB;
              padding-bottom: 20px;
              margin-bottom: 30px;
            }
            .header .title {
              font-size: 22px;
              font-weight: 700;
              color: #2563EB;
            }
            .header .subtitle {
              font-size: 12px;
              color: #6B7280;
              margin-top: 5px;
            }
            .info-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 15px;
              margin-bottom: 30px;
              padding: 20px;
              background: #F9FAFB;
              border-radius: 8px;
            }
            .info-item {
              display: flex;
              flex-direction: column;
            }
            .info-item .label {
              font-size: 11px;
              color: #6B7280;
              font-weight: 600;
              text-transform: uppercase;
            }
            .info-item .value {
              font-size: 14px;
              font-weight: 500;
              margin-top: 3px;
            }
            .section-title {
              font-size: 16px;
              font-weight: 700;
              color: #1F2937;
              margin: 20px 0 15px 0;
              padding-bottom: 10px;
              border-bottom: 1px solid #E5E7EB;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 10px;
              font-size: 12px;
            }
            table thead {
              background: #F3F4F6;
            }
            table th {
              padding: 8px 12px;
              text-align: left;
              font-weight: 600;
              font-size: 11px;
              text-transform: uppercase;
            }
            table td {
              padding: 8px 12px;
              border-bottom: 1px solid #E5E7EB;
            }
            table tfoot td {
              font-weight: 700;
              border-top: 2px solid #1F2937;
              padding-top: 10px;
            }
            .text-right { text-align: right; }
            .status-badge {
              display: inline-block;
              padding: 4px 12px;
              border-radius: 9999px;
              font-size: 11px;
              font-weight: 600;
              color: white;
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
            .attachments {
              margin-top: 20px;
              padding: 15px;
              background: #F9FAFB;
              border-radius: 8px;
            }
            .attachments .attachment-item {
              padding: 5px 0;
              font-size: 12px;
            }
            .footer {
              margin-top: 40px;
              padding-top: 20px;
              border-top: 1px solid #E5E7EB;
              text-align: center;
              font-size: 11px;
              color: #6B7280;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <img src='${process.env.FRONTEND_URL}/images/logo_wwf1.png' height='30'/>
            <div class="title">Réquisition {{requisition.requisition_number}}</div>
            <div class="subtitle">Généré le {{formatDate generatedAt}} à {{formatTime generatedAt}}</div>
          </div>

          <div class="info-grid">
            <div class="info-item">
              <span class="label">Titre</span>
              <span class="value">{{requisition.title}}</span>
            </div>
            <div class="info-item">
              <span class="label">Statut</span>
              <span class="value">
                <span class="status-badge" style="background: {{statusColor requisition.status}};">
                  {{statusLabel requisition.status}}
                </span>
              </span>
            </div>
            <div class="info-item">
              <span class="label">Département</span>
              <span class="value">{{requisition.department_name}}</span>
            </div>
            <div class="info-item">
              <span class="label">Projet</span>
              <span class="value">{{requisition.project_name}}</span>
            </div>
            <div class="info-item">
              <span class="label">Montant estimé</span>
              <span class="value">{{formatCurrency requisition.estimated_amount requisition.currency}}</span>
            </div>
            <div class="info-item">
              <span class="label">Priorité</span>
              <span class="value">
                <span class="priority-badge priority-{{requisition.priority}}">
                  {{priorityLabel requisition.priority}}
                </span>
              </span>
            </div>
            <div class="info-item">
              <span class="label">Demandeur</span>
              <span class="value">{{requisition.first_name}} {{requisition.last_name}}</span>
            </div>
            <div class="info-item">
              <span class="label">Date création</span>
              <span class="value">{{formatDate requisition.created_at}}</span>
            </div>
            {{#if requisition.description}}
            <div class="info-item" style="grid-column: span 2;">
              <span class="label">Description</span>
              <span class="value">{{requisition.description}}</span>
            </div>
            {{/if}}
            {{#if requisition.justification}}
            <div class="info-item" style="grid-column: span 2;">
              <span class="label">Justification</span>
              <span class="value">{{requisition.justification}}</span>
            </div>
            {{/if}}
          </div>

          {{#if requisition.items.length}}
          <div class="section-title">Articles</div>
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th class="text-right">Quantité</th>
                <th class="text-right">Fréquence</th>
                <th class="text-right">Prix unitaire</th>
                <th class="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {{#each requisition.items}}
              <tr>
                <td>{{this.item_description}}</td>
                <td class="text-right">{{this.quantity}}</td>
                <td class="text-right">{{this.frequency}}</td>
                <td class="text-right">{{formatCurrency this.unit_price ../requisition.currency}}</td>
                <td class="text-right">{{formatCurrency this.total_amount ../requisition.currency}}</td>
              </tr>
              {{/each}}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="4" class="text-right">Total général</td>
                <td class="text-right">{{formatCurrency requisition.estimated_amount requisition.currency}}</td>
              </tr>
            </tfoot>
          </table>
          {{/if}}

          {{#if requisition.attachments.length}}
          <div class="section-title">Pièces jointes</div>
          <div class="attachments">
            {{#each requisition.attachments}}
            <div class="attachment-item">📎 {{this.file_name}} - {{this.file_size}} octets</div>
            {{/each}}
          </div>
          {{/if}}

          <div class="footer">
            <p>Document généré automatiquement par Procurement System</p>
          </div>
        </body>
      </html>
    `;

    const compiledTemplate = Handlebars.compile(template);
    
    const data = {
      requisition: safeRequisition,
      generatedAt: new Date()
    };

    const html = compiledTemplate(data);

    let browser = null;
    try {
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
      await page.setContent(html);

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20px',
          bottom: '20px',
          left: '20px',
          right: '20px'
        }
      });

      return pdfBuffer;

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

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Procurement System';
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
        currency: req.currency || 'USD',
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