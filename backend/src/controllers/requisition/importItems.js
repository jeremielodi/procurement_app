// backend/src/controllers/requisition/importItems.js
// Import des articles d'une réquisition depuis un fichier Excel (.xlsx) ou CSV.
// Le fichier n'est pas stocké : on renvoie un aperçu que le formulaire ajoute aux articles.
const ExcelJS = require('exceljs');
const db = require('../../config/database');
const tenant = require('../../utils/tenant');
const i18n = require('../../i18n');
const stockItemModel = require('../../models/StockItemModel');
const { activeUnits, unitMatcher } = require('../../utils/units');
const { uploadHandler, cellText, parseNumber, parseCsv, readRows, isBlankRow, dropLeadingBlankRows, mapHeader } = require('../../utils/tabularImport');

const MAX_ROWS = 500;

// En-têtes acceptés (comparaison sans accents ni casse)
const COLUMNS = {
  description: ['description', 'article', 'designation', 'libelle', 'item'],
  quantity: ['quantite', 'qte', 'quantity', 'qty'],
  frequency: ['frequence', 'frequency', 'freq', 'frequence (x/mois)'],
  // Facultative : unité de mesure (abréviation, code ou nom — « pce », « Pièce », « Piece »)
  unit: ['unite', 'unit', 'unite de mesure', 'unit of measure', 'uom'],
  unitPrice: ['prix unitaire', 'pu', 'prix', 'unit price', 'unit_price', 'prix unitaire (usd)'],
  // Facultative : article du catalogue (gestion de stock) ; vide = texte libre
  itemCode: ['code article', 'code', 'item code', 'article code', 'code produit', 'sku'],
};

const handleUpload = uploadHandler({ maxMb: 2 });

/** POST /api/requisitions/import-items (multipart: file) → { items, errors } */
async function importItems(req, res) {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Aucun fichier reçu' });

    let rows;
    try {
      rows = await readRows(req.file);
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Fichier illisible : vérifiez qu\'il s\'agit bien d\'un .xlsx ou .csv' });
    }
    // En-tête = première ligne non vide
    dropLeadingBlankRows(rows);
    if (rows.length < 2) return res.status(400).json({ success: false, message: 'Le fichier ne contient aucun article' });

    const col = mapHeader(rows[0], COLUMNS);
    const missing = ['description', 'quantity', 'unitPrice'].filter(k => col[k] === undefined);
    if (missing.length) {
      const labels = { description: 'Description', quantity: 'Quantité', unitPrice: 'Prix unitaire' };
      return res.status(400).json({
        success: false,
        message: `Colonnes manquantes : ${missing.map(k => labels[k]).join(', ')}. Utilisez le modèle proposé dans la fenêtre d'import.`
      });
    }

    // Codes article cités → articles actifs de l'entreprise (une seule requête)
    const catalog = new Map();
    if (col.itemCode !== undefined) {
      const codes = rows.slice(1).map(r => cellText(r[col.itemCode]).trim()).filter(Boolean);
      for (const it of await stockItemModel.findByCodes(codes)) catalog.set(it.code.toUpperCase(), it);
    }

    const units = await activeUnits();
    const findUnit = unitMatcher(units);
    const unitsById = new Map(units.map(u => [u.id, u]));

    const items = [];
    const errors = [];
    rows.slice(1).forEach((r, i) => {
      const line = i + 2; // numéro de ligne dans le fichier
      if (isBlankRow(r)) return;
      const description = cellText(r[col.description]).trim();
      const quantity = parseNumber(r[col.quantity]);
      const freqRaw = col.frequency !== undefined ? r[col.frequency] : '';
      const frequency = String(freqRaw ?? '').trim() === '' ? 1 : parseNumber(freqRaw);
      const unitPrice = parseNumber(r[col.unitPrice]);

      const itemCode = col.itemCode !== undefined ? cellText(r[col.itemCode]).trim() : '';
      const article = itemCode ? catalog.get(itemCode.toUpperCase()) : null;

      const unitText = col.unit !== undefined ? cellText(r[col.unit]).trim() : '';
      // Unité : colonne du fichier, sinon celle de l'article du catalogue (unité du référentiel, migration 49)
      const unit = unitText ? findUnit(unitText) : (article ? unitsById.get(article.unit_id) || null : null);

      const problems = [];
      if (unitText && !unit) problems.push(`unité ${unitText} inconnue`);
      if (itemCode && !article) problems.push(`code article ${itemCode} inconnu`);
      else if (article && !article.is_active) problems.push(`article ${itemCode} désactivé`);
      if (!description && !article) problems.push('description vide');
      if (!(quantity > 0)) problems.push('quantité invalide');
      if (!(frequency > 0)) problems.push('fréquence invalide');
      if (!(unitPrice >= 0)) problems.push('prix unitaire invalide');
      if (problems.length) errors.push({ line, message: problems.join(', ') });
      else items.push({
        line, description: description || article?.name, quantity, frequency, unitPrice,
        ...(unit ? { unitId: unit.id, unitAbbr: unit.abbr } : {}),
        ...(article ? { stockItemId: article.id, itemCode: article.code, itemName: article.name, unit: article.unit, unit_id: article.unit_id } : {}),
      });
    });

    if (items.length > MAX_ROWS) {
      return res.status(400).json({ success: false, message: `Maximum ${MAX_ROWS} articles par import` });
    }
    res.json({ success: true, data: { items, errors } });
  } catch (error) {
    console.error('Import items error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

// Colonnes du modèle (même ordre que importItems.templateHeaders côté client) ; liste = liste déroulante
const TEMPLATE_FIELDS = [
  { key: 'description', required: true, width: 45 },
  { key: 'quantity', required: true, width: 12 },
  { key: 'unit', width: 12, list: 'units' },
  { key: 'frequency', width: 12 },
  { key: 'unitPrice', required: true, width: 16 },
  { key: 'itemCode', width: 20, list: 'catalog' },
];

/**
 * GET /api/requisitions/import-items/template?lang= — modèle .xlsx dans la langue demandée :
 * feuille Articles (exemples, aide en commentaire des en-têtes, listes déroulantes Unité / Code article),
 * Unités de mesure, Catalogue (articles actifs de l'entreprise), Mode d'emploi.
 */
async function template(req, res) {
  try {
    const lang = i18n.fromRequest(req);
    const T = i18n.translator(lang);
    const params = [];
    const [units, catalog] = await Promise.all([
      activeUnits(),
      db.select(
        `SELECT si.code, si.name, si.unit FROM stock_items si
         WHERE si.is_active${tenant.filter('si.enterprise_id', params)} ORDER BY si.code LIMIT 5000`, params),
    ]);
    const unitName = (u) => (lang !== 'fr' && u.translations?.[lang]?.name) || u.name;
    const headers = TEMPLATE_FIELDS.map(f => T(`requisitionImport.headers.${f.key}`));

    const wb = new ExcelJS.Workbook();
    wb.creator = 'procureApp';
    const ws = wb.addWorksheet(T('requisitionImport.sheets.items'), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = TEMPLATE_FIELDS.map((f, i) => ({ header: headers[i], key: f.key, width: Math.max(f.width, headers[i].length + 4) }));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.alignment = { vertical: 'middle', wrapText: true };
    head.height = 28;
    TEMPLATE_FIELDS.forEach((f, i) => {
      head.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f.required ? 'FF1D4ED8' : 'FF475569' } };
      head.getCell(i + 1).note = T(`requisitionImport.help.${f.key}`);
    });
    // Exemples à remplacer : [description, unité, quantité, fréquence, prix unitaire] (nombres)
    const examples = i18n.section(lang, 'requisitionImport.examples') || i18n.section('fr', 'requisitionImport.examples');
    for (const [description, unit, quantity, frequency, unitPrice] of Array.isArray(examples) ? examples : []) {
      ws.addRow([description, quantity, unit, frequency, unitPrice, '']).font = { italic: true, color: { argb: 'FF6B7280' } };
    }
    ws.getColumn(5).numFmt = '#,##0.00';

    // Unités de mesure
    const unitSheet = wb.addWorksheet(T('requisitionImport.sheets.units'));
    unitSheet.columns = [{ header: T('requisitionImport.ref.unitAbbr'), width: 14 }, { header: T('requisitionImport.ref.unitName'), width: 34 }];
    unitSheet.getRow(1).font = { bold: true };
    units.forEach(u => unitSheet.addRow([u.abbr, unitName(u)]));

    // Catalogue de stock de l'entreprise (colonne « Code article »)
    const catSheet = wb.addWorksheet(T('requisitionImport.sheets.catalog'));
    catSheet.columns = [
      { header: T('requisitionImport.ref.itemCode'), width: 20 },
      { header: T('requisitionImport.ref.itemName'), width: 50 },
      { header: T('requisitionImport.ref.itemUnit'), width: 12 },
    ];
    catSheet.getRow(1).font = { bold: true };
    catalog.forEach(it => catSheet.addRow([it.code, it.name, it.unit]));

    // Listes déroulantes : autre valeur acceptée (contrôlée à l'import)
    const listOf = (sheet, count) => (count ? [`'${sheet.name.replace(/'/g, "''")}'!$A$2:$A$${count + 1}`] : null);
    const lists = { units: listOf(unitSheet, units.length), catalog: listOf(catSheet, catalog.length) };
    TEMPLATE_FIELDS.forEach((f, i) => {
      const formulae = f.list && lists[f.list];
      if (!formulae) return;
      const letter = ws.getColumn(i + 1).letter;
      ws.dataValidations.add(`${letter}2:${letter}${MAX_ROWS + 1}`, { type: 'list', allowBlank: true, showErrorMessage: false, formulae });
    });

    // Mode d'emploi
    const help = wb.addWorksheet(T('requisitionImport.sheets.help'));
    help.columns = [
      { header: T('requisitionImport.ref.column'), width: 22 },
      { header: T('requisitionImport.ref.required'), width: 14 },
      { header: T('requisitionImport.ref.description'), width: 100 },
    ];
    help.getRow(1).font = { bold: true };
    TEMPLATE_FIELDS.forEach((f, i) => {
      const row = help.addRow([headers[i], T(f.required ? 'requisitionImport.required' : 'requisitionImport.optional'), T(`requisitionImport.help.${f.key}`)]);
      row.alignment = { wrapText: true, vertical: 'top' };
    });
    help.addRow([]);
    const rules = i18n.section(lang, 'requisitionImport.rules') || i18n.section('fr', 'requisitionImport.rules');
    for (const rule of Array.isArray(rules) ? rules : []) help.addRow([rule]).font = { italic: true };

    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(T('requisitionImport.fileName'))}.xlsx"`);
    res.end(Buffer.from(await wb.xlsx.writeBuffer()));
  } catch (error) {
    console.error('Import items template error:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la génération du modèle' });
  }
}

module.exports = { handleUpload, importItems, template, parseCsv, parseNumber };
