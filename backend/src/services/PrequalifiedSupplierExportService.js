// backend/src/services/PrequalifiedSupplierExportService.js
// Liste Excel des fournisseurs préqualifiés de l'entreprise (une ligne par fournisseur × catégorie).
const ExcelJS = require('exceljs');

const BLUE = 'FF1E40AF';
const thin = { style: 'thin', color: { argb: 'FFD1D5DB' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

const fmtDate = (d) => (d
  ? new Date(d).toLocaleDateString('fr-FR', { timeZone: process.env.APP_TIMEZONE || 'Africa/Kinshasa' })
  : '');

async function generatePrequalifiedWorkbook(rows, { enterpriseName, filtersLabel } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'procureApp';
  wb.created = new Date();
  const ws = wb.addWorksheet('Préqualifiés', { views: [{ state: 'frozen', ySplit: 4 }] });

  const columns = [
    ['Catégorie', 'category_name', 32], ['Code', 'supplier_code', 15], ['Fournisseur', 'name', 32],
    ['Type', 'type_label', 16], ['Contact', 'contact_name', 22], ['Téléphone', 'phone', 16], ['Email', 'email', 28],
    ['Adresse', 'address', 30], ['Localisations', 'locations', 30], ['RCCM', 'registration_number', 18],
    ['N° impôt', 'tax_id', 16], ['ID Nat', 'id_nat', 16], ['Banque', 'bank_name', 18], ['N° de compte', 'bank_account', 22],
    ['Préqualifié le', 'decided', 14],
  ];

  ws.mergeCells(1, 1, 1, columns.length);
  const title = ws.getCell(1, 1);
  title.value = `Fournisseurs préqualifiés${enterpriseName ? ` — ${enterpriseName}` : ''}`;
  title.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
  ws.mergeCells(2, 1, 2, columns.length);
  ws.getCell(2, 1).value = `${filtersLabel || 'Toutes catégories, toutes localisations'} · ${rows.length} ligne(s) · édité le ${fmtDate(new Date())}`;
  ws.getCell(2, 1).font = { italic: true, color: { argb: 'FF6B7280' } };

  const header = ws.getRow(4);
  columns.forEach(([label, , width], i) => {
    const cell = header.getCell(i + 1);
    cell.value = label;
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
    cell.border = border;
    ws.getColumn(i + 1).width = width;
  });

  rows.forEach((r, idx) => {
    const data = {
      ...r,
      type_label: r.supplier_type === 'INDIVIDUAL' ? 'Personne physique' : 'Entreprise',
      locations: (r.location_names || []).join(', '),
      decided: fmtDate(r.decided_at),
    };
    const row = ws.getRow(5 + idx);
    columns.forEach(([, key], i) => {
      const cell = row.getCell(i + 1);
      cell.value = data[key] ?? '';
      cell.border = border;
      cell.alignment = { vertical: 'top', wrapText: true };
    });
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + Math.max(rows.length, 1), column: columns.length } };

  return wb.xlsx.writeBuffer();
}

module.exports = { generatePrequalifiedWorkbook };
