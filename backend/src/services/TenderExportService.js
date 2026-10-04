// backend/src/services/TenderExportService.js
const ExcelJS = require('exceljs');

const BLUE = 'FF1E40AF';
const LIGHT_BLUE = 'FFDBEAFE';
const GREEN = 'FFD1FAE5';
const RED = 'FFFEE2E2';
const GREY = 'FFF3F4F6';
const MONEY = '#,##0.00';

const thin = { style: 'thin', color: { argb: 'FFD1D5DB' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

function fmtDate(d) {
  return d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: process.env.APP_TIMEZONE || 'Africa/Kinshasa' }) : '';
}

/**
 * Classeur comparatif des offres d'un appel d'offres :
 *  - "Comparatif" : tableau croisé items × fournisseurs (PU + total), meilleur prix en vert
 *  - "Détail"     : une ligne par (fournisseur, item) — prêt pour un tableau croisé dynamique
 *  - "Fournisseurs" : coordonnées et délais
 */
async function generateComparisonWorkbook(tender, items, submissions) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'procureApp';
  wb.created = new Date();
  const currency = tender.currency_code || '';

  // ---------------- Feuille 1 : Comparatif ----------------
  const ws = wb.addWorksheet('Comparatif', { views: [{ state: 'frozen', xSplit: 3, ySplit: 9 }] });
  const nSup = submissions.length;
  const lastCol = 3 + nSup * 2 + 2;

  ws.mergeCells(1, 1, 1, Math.max(lastCol, 6));
  const title = ws.getCell(1, 1);
  title.value = `Tableau comparatif des offres — ${tender.tender_number}`;
  title.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
  title.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 24;

  const meta = [
    ['Objet', tender.title],
    ['Réquisition', `${tender.requisition_number} — ${tender.requisition_title || ''}`],
    ['Période de soumission', `${fmtDate(tender.start_date)} → ${fmtDate(tender.end_date)}`],
    ['Délai de livraison max', `${tender.max_delivery_days} jours`],
    ['Devise', currency],
    ['Statut', `${tender.effective_status === 'AWARDED' ? `Attribué à ${tender.awarded_supplier_name}` : 'Clôturé'} — ${nSup} soumission(s)`],
  ];
  meta.forEach(([k, v], i) => {
    const r = ws.getRow(2 + i);
    r.getCell(1).value = k;
    r.getCell(1).font = { bold: true };
    r.getCell(2).value = v;
  });

  // En-têtes (2 lignes : fournisseur puis PU / Total)
  const h1 = ws.getRow(8);
  const h2 = ws.getRow(9);
  ['N°', 'Description', 'Quantité'].forEach((label, i) => {
    ws.mergeCells(8, i + 1, 9, i + 1);
    h1.getCell(i + 1).value = label;
  });
  submissions.forEach((s, idx) => {
    const c = 4 + idx * 2;
    ws.mergeCells(8, c, 8, c + 1);
    h1.getCell(c).value = `${s.supplier_name} (${s.supplier_code})`;
    h2.getCell(c).value = `PU (${currency})`;
    h2.getCell(c + 1).value = `Total (${currency})`;
  });
  const bestCol = 4 + nSup * 2;
  ws.mergeCells(8, bestCol, 9, bestCol);
  ws.mergeCells(8, bestCol + 1, 9, bestCol + 1);
  h1.getCell(bestCol).value = `Meilleur PU (${currency})`;
  h1.getCell(bestCol + 1).value = 'Moins-disant';

  [h1, h2].forEach(row => {
    for (let c = 1; c <= lastCol; c++) {
      const cell = row.getCell(c);
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = border;
    }
  });
  h1.height = 30;

  // Lignes items
  let rowIdx = 10;
  items.forEach((item, i) => {
    const qty = parseFloat(item.quantity) * parseFloat(item.frequency || 1);
    const row = ws.getRow(rowIdx++);
    row.getCell(1).value = i + 1;
    row.getCell(2).value = item.item_description;
    row.getCell(3).value = qty;

    const prices = submissions.map(s => {
      const line = s.items.find(l => String(l.requisition_item_id) === String(item.id));
      return line ? parseFloat(line.unit_price) : null;
    });
    const valid = prices.filter(p => p !== null);
    const best = valid.length ? Math.min(...valid) : null;

    submissions.forEach((s, idx) => {
      const c = 4 + idx * 2;
      const p = prices[idx];
      if (p === null) {
        row.getCell(c).value = '—';
        row.getCell(c + 1).value = '—';
        row.getCell(c).alignment = row.getCell(c + 1).alignment = { horizontal: 'center' };
      } else {
        row.getCell(c).value = p;
        row.getCell(c + 1).value = p * qty;
        row.getCell(c).numFmt = row.getCell(c + 1).numFmt = MONEY;
        if (valid.length > 1 && p === best) {
          row.getCell(c).fill = row.getCell(c + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
          row.getCell(c).font = { bold: true };
        }
      }
    });
    if (best !== null) {
      row.getCell(bestCol).value = best;
      row.getCell(bestCol).numFmt = MONEY;
      row.getCell(bestCol + 1).value = submissions
        .filter((_, idx) => prices[idx] === best).map(s => s.supplier_name).join(', ');
    }
    for (let c = 1; c <= lastCol; c++) row.getCell(c).border = border;
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  });

  // Synthèse par fournisseur
  // Classement prix uniquement entre offres complètes (tous les items chiffrés)
  const totals = submissions.map(s => parseFloat(s.total_amount) || 0);
  const complete = submissions.map(s => s.items.length >= items.length);
  const completeTotals = totals.filter((_, i) => complete[i]);
  const bestTotal = completeTotals.length ? Math.min(...completeTotals) : null;
  const ranks = totals.map((t, i) => complete[i] ? completeTotals.filter(o => o < t).length + 1 : 'Incomplète');
  const summary = [
    ['TOTAL OFFRE', (s, idx) => ({ value: totals[idx], numFmt: MONEY, best: complete[idx] && completeTotals.length > 1 && totals[idx] === bestTotal })],
    ['Rang (offres complètes)', (s, idx) => ({ value: ranks[idx], fill: complete[idx] ? null : RED })],
    ['Délai de livraison (jours)', s => ({ value: s.delivery_days })],
    ['Respecte le délai max', s => {
      const ok = s.delivery_days <= tender.max_delivery_days;
      return { value: ok ? 'Oui' : 'Non', fill: ok ? GREEN : RED };
    }],
    ['Items chiffrés', s => ({ value: `${s.items.length} / ${items.length}`, fill: s.items.length < items.length ? RED : null })],
    ['Dernière soumission', s => ({ value: fmtDate(s.updated_at || s.submitted_at) })],
    ['Remarques', s => ({ value: s.notes || '' })],
  ];
  rowIdx++;
  summary.forEach(([label, fn]) => {
    const row = ws.getRow(rowIdx++);
    ws.mergeCells(row.number, 1, row.number, 3);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true };
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BLUE } };
    submissions.forEach((s, idx) => {
      const c = 4 + idx * 2;
      ws.mergeCells(row.number, c, row.number, c + 1);
      const v = fn(s, idx);
      const cell = row.getCell(c);
      cell.value = v.value;
      if (v.numFmt) cell.numFmt = v.numFmt;
      cell.alignment = { horizontal: 'center', wrapText: true };
      if (v.best) { cell.font = { bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }; }
      else if (v.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: v.fill } };
      else if (label === 'TOTAL OFFRE') cell.font = { bold: true };
    });
    for (let c = 1; c <= lastCol; c++) row.getCell(c).border = border;
  });

  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 40;
  ws.getColumn(3).width = 11;
  for (let idx = 0; idx < nSup; idx++) {
    ws.getColumn(4 + idx * 2).width = 15;
    ws.getColumn(5 + idx * 2).width = 17;
  }
  ws.getColumn(bestCol).width = 16;
  ws.getColumn(bestCol + 1).width = 26;

  if (nSup === 0) {
    ws.getCell(rowIdx + 1, 1).value = 'Aucune soumission reçue pour le moment.';
    ws.getCell(rowIdx + 1, 1).font = { italic: true, color: { argb: 'FF6B7280' } };
  }

  // ---------------- Feuille 2 : Détail (format plat) ----------------
  const wd = wb.addWorksheet('Détail');
  wd.columns = [
    { header: 'Fournisseur', key: 'supplier', width: 30 },
    { header: 'Code', key: 'code', width: 14 },
    { header: 'N° item', key: 'n', width: 8 },
    { header: 'Item', key: 'item', width: 40 },
    { header: 'Quantité', key: 'qty', width: 10 },
    { header: `PU (${currency})`, key: 'pu', width: 15, style: { numFmt: MONEY } },
    { header: `Total (${currency})`, key: 'total', width: 17, style: { numFmt: MONEY } },
    { header: 'Meilleur PU ?', key: 'best', width: 13 },
    { header: 'Délai livraison (j)', key: 'delay', width: 16 },
    { header: 'Commentaire', key: 'comment', width: 35 },
  ];
  items.forEach((item, i) => {
    const qty = parseFloat(item.quantity) * parseFloat(item.frequency || 1);
    const lines = submissions.map(s => ({ s, l: s.items.find(l => String(l.requisition_item_id) === String(item.id)) }))
      .filter(x => x.l);
    const best = lines.length ? Math.min(...lines.map(x => parseFloat(x.l.unit_price))) : null;
    lines.forEach(({ s, l }) => {
      wd.addRow({
        supplier: s.supplier_name, code: s.supplier_code, n: i + 1, item: item.item_description, qty,
        pu: parseFloat(l.unit_price), total: parseFloat(l.total_price),
        best: parseFloat(l.unit_price) === best ? 'Oui' : 'Non',
        delay: s.delivery_days, comment: l.comment || ''
      });
    });
  });
  styleHeader(wd);
  wd.autoFilter = { from: 'A1', to: 'J1' };

  // ---------------- Feuille 3 : Fournisseurs ----------------
  const wf = wb.addWorksheet('Fournisseurs');
  wf.columns = [
    { header: 'Fournisseur', key: 'name', width: 30 },
    { header: 'Code', key: 'code', width: 14 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Téléphone', key: 'phone', width: 16 },
    { header: `Total offre (${currency})`, key: 'total', width: 18, style: { numFmt: MONEY } },
    { header: 'Délai livraison (j)', key: 'delay', width: 16 },
    { header: 'Soumis le', key: 'submitted', width: 18 },
    { header: 'Modifié le', key: 'updated', width: 18 },
  ];
  submissions.forEach(s => wf.addRow({
    name: s.supplier_name, code: s.supplier_code, email: s.supplier_email, phone: s.supplier_phone,
    total: parseFloat(s.total_amount), delay: s.delivery_days,
    submitted: fmtDate(s.submitted_at), updated: fmtDate(s.updated_at)
  }));
  styleHeader(wf);

  return wb.xlsx.writeBuffer();
}

function styleHeader(sheet) {
  const row = sheet.getRow(1);
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    cell.border = border;
  });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.eachRow((r, n) => {
    if (n > 1 && n % 2 === 0) r.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } }; });
  });
}

module.exports = { generateComparisonWorkbook };
