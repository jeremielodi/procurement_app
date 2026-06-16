const ExcelJS = require('exceljs');
const RequisitionModel = require('../../models/RequisitionModel');

 /**
   * Exporter les réquisitions en Excel
   */
  async function exportToExcel(filters = {}) {
    const requisitions = await RequisitionModel.findAll(filters);
    
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Procurement System';
    workbook.created = new Date();
    
    const worksheet = workbook.addWorksheet('Réquisitions', {
      properties: { tabColor: { argb: 'FF2563EB' } },
      pageSetup: { orientation: 'landscape', fitToPage: true }
    });

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
      { header: 'Date création', key: 'created_at', width: 20 },
      { header: 'Date approbation', key: 'approved_at', width: 20 },
      { header: 'Date soumission', key: 'submitted_at', width: 20 }
    ];

    // Style d'en-tête
    worksheet.getRow(1).font = { 
      bold: true, 
      size: 11,
      color: { argb: 'FFFFFFFF' }
    };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF2563EB' }
    };
    worksheet.getRow(1).alignment = { 
      horizontal: 'center',
      vertical: 'middle'
    };
    worksheet.getRow(1).height = 25;

    // Remplir les données
    requisitions.forEach((req, index) => {
      const row = worksheet.addRow({
        number: req.requisition_number || '-',
        title: req.title || '-',
        department: req.department_name || '-',
        project: req.project_name || '-',
        amount: req.estimated_amount || 0,
        currency: req.currency || 'USD',
        status: req.status || '-',
        priority: req.priority || '-',
        requester: req.first_name && req.last_name ? `${req.first_name} ${req.last_name}` : (req.email || '-'),
        created_at: req.created_at ? new Date(req.created_at).toLocaleString('fr-FR') : '-',
        approved_at: req.approved_at ? new Date(req.approved_at).toLocaleString('fr-FR') : '-',
        submitted_at: req.submitted_at ? new Date(req.submitted_at).toLocaleString('fr-FR') : '-'
      });

      // Style pour les montants
      row.getCell('amount').numFmt = '#,##0.00';
      row.getCell('amount').alignment = { horizontal: 'right' };
      
      // Couleur selon le statut
      const statusColors = {
        'DRAFT': 'FF9CA3AF',
        'PENDING': 'FFF59E0B',
        'APPROVED': 'FF10B981',
        'REJECTED': 'FFEF4444',
        'COMPLETED': 'FF10B981',
        'CANCELLED': 'FF6B7280'
      };
      
      const statusCell = row.getCell('status');
      if (statusColors[req.status]) {
        statusCell.font = { color: { argb: statusColors[req.status] } };
      }

      // Alternance des couleurs de lignes
      if (index % 2 === 0) {
        row.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8FAFC' }
          };
        });
      }
    });

    // Ajuster la hauteur des lignes
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        row.height = 20;
        row.alignment = { vertical: 'middle' };
      }
    });

    // Ajouter des bordures
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

    // Ajouter un résumé en bas
    const summaryRow = worksheet.addRow({
      number: 'TOTAL',
      amount: requisitions.reduce((sum, r) => sum + (r.estimated_amount || 0), 0)
    });
    summaryRow.getCell('number').font = { bold: true };
    summaryRow.getCell('amount').font = { bold: true };
    summaryRow.getCell('amount').numFmt = '#,##0.00';
    summaryRow.getCell('amount').alignment = { horizontal: 'right' };

    // Fusionner la cellule de titre
    worksheet.mergeCells(`A${summaryRow.number},B${summaryRow.number}`);
    
    // Ajouter un footer
    const footerRow = worksheet.addRow(['']);
    footerRow.getCell(1).value = `Exporté le ${new Date().toLocaleString('fr-FR')}`;
    footerRow.getCell(1).font = { size: 9, color: { argb: 'FF6B7280' } };
    footerRow.getCell(1).alignment = { horizontal: 'right' };
    worksheet.mergeCells(`A${footerRow.number},L${footerRow.number}`);

    // Générer le buffer Excel
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }
