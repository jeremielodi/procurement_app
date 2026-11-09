// backend/src/services/StockUnitImportService.js
// Import du parc existant (biens déjà achetés) depuis un fichier Excel (.xlsx) ou CSV : une ligne par bien.
//
//  - Article suivi par n° de série : une ligne = un équipement (n° de série obligatoire, n° d'inventaire facultatif —
//    attribué automatiquement s'il est vide —, état Bon / Endommagé) → unité « en stock » + mouvement OPENING (comme
//    « Enregistrer le parc existant » : n° de série unique par article, n° d'inventaire unique dans l'entreprise).
//  - Article sans n° de série : Quantité (1 par défaut) ; les lignes d'un même article × dépôt × projet × coût sont
//    additionnées en un mouvement. Refusé si l'article a déjà des mouvements dans ce dépôt (OPENING_EXISTS : un second
//    import ne double pas le stock — même règle que le stock initial de l'import du catalogue).
//  - Articles suivis par lot : non pris en charge ici (stock initial de l'import du catalogue).
//  - Dépôt : accès de l'utilisateur obligatoire ; projet de financement, coût unitaire / devise, notes : facultatifs.
//  - preview() valide sans rien écrire ; apply() relit le fichier et écrit les lignes valides en UNE transaction
//    (une seule opération de stock MVG-…).
// Erreurs par ligne : { line, code, params } (traduites côté client, stock.unitImport.err.<code>).
const ExcelJS = require('exceljs');
const db = require('../config/database');
const tenant = require('../utils/tenant');
const i18n = require('../i18n');
const stockModel = require('../models/StockModel');
const warehouseModel = require('../models/WarehouseModel');
const { cellText, parseNumber, readRows, isBlankRow, dropLeadingBlankRows, mapHeader, normalize } = require('../utils/tabularImport');
const { parseDate } = require('./StockItemImportService');
const { SEGMENT_RE } = require('../utils/assetTags');

const MAX_ROWS = 3000;
const EPS = 1e-9;

// Ordre des colonnes du modèle
const FIELDS = [
  { key: 'item', required: true }, { key: 'serial' }, { key: 'assetTag' }, { key: 'warehouse', required: true },
  { key: 'quantity' }, { key: 'project' }, { key: 'tagProject' }, { key: 'acquisitionDate' }, { key: 'condition' }, { key: 'unitCost' }, { key: 'currency' }, { key: 'notes' },
];

// En-têtes acceptés en plus de ceux du modèle (toutes langues : stockUnitImport.headers.*)
const ALIASES = {
  item: ['code article', 'article', 'code', 'item code', 'item', 'sku'],
  serial: ['n° de serie', 'numero de serie', 'no de serie', 'serie', 'serial', 'serial number', 'sn'],
  assetTag: ["n° d'inventaire", "numero d'inventaire", 'inventaire', 'asset tag', 'tag', 'n° inventaire'],
  warehouse: ['code depot', 'depot', 'warehouse', 'warehouse code'],
  quantity: ['quantite', 'qte', 'quantity', 'qty'],
  project: ['code projet', 'projet', 'projet de financement', 'project code', 'project', 'funding project'],
  // Codification des n° d'inventaire (migration 57)
  tagProject: ['segment projet', 'segment projet (tag)', 'projet tag', 'code projet tag', 'tag project', 'tag project code'],
  acquisitionDate: ["date d'acquisition", 'acquisition', "annee d'acquisition", 'acquis le', 'acquisition date', 'acquisition year', 'acquired'],
  condition: ['etat', 'condition', 'state'],
  unitCost: ['cout unitaire', 'cout', 'prix unitaire', 'cout us$', 'unit cost', 'cost'],
  currency: ['devise', 'currency'],
  notes: ['notes', 'note', 'commentaire', 'commentaires', 'comment', 'comments'],
};
const columnAliases = () => {
  const out = {};
  for (const { key } of FIELDS) {
    const fromLocales = i18n.LANGS.map(l => normalize(i18n.translator(l)(`stockUnitImport.headers.${key}`)));
    out[key] = [...new Set([...fromLocales, ...ALIASES[key]])];
  }
  return out;
};

const GOOD = ['bon', 'bon etat', 'good', 'ok', 'neuf', 'new', 'tres bon', 'moyen', ''];
const DAMAGED = ['endommage', 'mauvais', 'damaged', 'broken', 'en panne', 'hs', 'defectueux'];

function fail(line, code, params = {}) { return { line, code, params }; }

/** Date d'acquisition : AAAA-MM-JJ, JJ/MM/AAAA, date Excel ou année seule (→ 1er janvier) ; null si vide, undefined si invalide */
function acquisitionDateOf(raw) {
  const s = cellText(raw).trim();
  if (!s && typeof raw !== 'number') return null;
  if (/^(19|20)\d{2}$/.test(s)) return `${s}-01-01`;
  return parseDate(typeof raw === 'number' ? raw : s) || undefined;
}

async function loadContext(userId, codes) {
  const enterpriseId = tenant.enterpriseId();
  const params = [codes];
  const items = await db.select(
    `SELECT si.id, si.code, si.name, si.unit, si.is_active, si.is_stockable, si.track_lots, si.track_serials
     FROM stock_items si WHERE UPPER(si.code) = ANY($1::text[])${tenant.filter('si.enterprise_id', params)}`,
    params
  );
  const ids = items.map(i => i.id);
  const pParams = [];
  const [moved, serials, accessible, allWarehouses, currencies, projects] = await Promise.all([
    ids.length ? db.select('SELECT DISTINCT stock_item_id, warehouse_id FROM stock_movements WHERE stock_item_id = ANY($1::uuid[])', [ids]) : [],
    ids.length ? db.select(`SELECT stock_item_id, UPPER(serial_number) AS serial FROM stock_units WHERE stock_item_id = ANY($1::uuid[]) AND status <> 'VOID'`, [ids]) : [],
    warehouseModel.accessibleFor(userId),
    warehouseModel.list({ activeOnly: true }),
    db.select('SELECT id, format_key FROM currency'),
    db.select(`SELECT p.id, p.code, p.name FROM projects p WHERE 1=1${tenant.filter('p.enterprise_id', pParams)}`, pParams),
  ]);
  const ent = (enterpriseId && await db.one('SELECT id, currency_id FROM enterprise WHERE id = $1', [enterpriseId])) || { id: enterpriseId, currency_id: null };
  return {
    enterpriseId: ent.id,
    defaultCurrencyId: ent.currency_id,
    itemsByCode: new Map(items.map(i => [i.code.toUpperCase(), i])),
    movedPairs: new Set(moved.map(m => `${m.stock_item_id}|${m.warehouse_id}`)),
    knownSerials: new Set(serials.map(s => `${s.stock_item_id}|${s.serial}`)),
    accessibleBy: new Map(accessible.map(w => [w.code.toUpperCase(), w])),
    warehouseBy: new Map(allWarehouses.map(w => [w.code.toUpperCase(), w])),
    currencyBy: new Map(currencies.map(c => [c.format_key.toUpperCase(), c])),
    currencyById: new Map(currencies.map(c => [c.id, c])),
    projectBy: new Map(projects.map(p => [String(p.code).toUpperCase(), p])),
  };
}

/**
 * Lit et valide le fichier → { enterpriseId, units, openings, errors, totalLines }
 *   units : équipements à n° de série [{ line, item, serial, assetTag, warehouse, project, condition, unitCost, currencyId, notes }]
 *   openings : articles sans n° de série regroupés [{ lines, item, warehouse, project, quantity, unitCost, currencyId }]
 */
async function analyze(file, { userId }) {
  let rows;
  try {
    rows = await readRows(file);
  } catch (e) {
    const err = new Error('Fichier illisible : vérifiez qu\'il s\'agit bien d\'un .xlsx ou .csv');
    err.status = 400; err.code = 'UNREADABLE';
    throw err;
  }
  dropLeadingBlankRows(rows);
  if (rows.length < 2) { const e = new Error('Le fichier ne contient aucun bien'); e.status = 400; e.code = 'EMPTY'; throw e; }
  const col = mapHeader(rows[0], columnAliases());
  const missing = FIELDS.filter(f => f.required && col[f.key] === undefined).map(f => f.key);
  if (missing.length) {
    const e = new Error('Colonnes « Code article » et « Code dépôt » obligatoires : utilisez le modèle proposé dans la fenêtre d\'import');
    e.status = 400; e.code = 'MISSING_COLUMNS'; e.details = { missing };
    throw e;
  }
  const dataRows = rows.slice(1).map((r, i) => ({ r, line: i + 2 })).filter(({ r }) => !isBlankRow(r));
  if (dataRows.length > MAX_ROWS) {
    const e = new Error(`Maximum ${MAX_ROWS} lignes par import`); e.status = 400; e.code = 'TOO_MANY_ROWS'; e.details = { max: MAX_ROWS };
    throw e;
  }
  const raw = (r, key) => (col[key] === undefined ? '' : r[col[key]]);
  const text = (r, key) => cellText(raw(r, key)).trim();
  const codes = [...new Set(dataRows.map(({ r }) => text(r, 'item').toUpperCase()).filter(Boolean))];
  const ctx = await loadContext(userId, codes);

  const units = [];
  const errors = [];
  const fileSerials = new Map(); // article|n° de série → ligne
  const fileTags = new Map();    // n° d'inventaire → ligne
  const groups = new Map();      // article|dépôt|projet|coût|devise → ouverture
  const pending = [];            // lignes à n° d'inventaire, contrôlées en base ensuite

  for (const { r, line } of dataRows) {
    const problems = [];
    const code = text(r, 'item').toUpperCase();
    const item = code ? ctx.itemsByCode.get(code) : null;
    if (!code) problems.push(fail(line, 'ITEM_REQUIRED'));
    else if (!item) problems.push(fail(line, 'ITEM_UNKNOWN', { value: code }));
    else if (!item.is_active) problems.push(fail(line, 'ITEM_INACTIVE', { value: code }));
    else if (!item.is_stockable) problems.push(fail(line, 'ITEM_NOT_STOCKABLE', { value: code }));
    else if (item.track_lots) problems.push(fail(line, 'ITEM_LOTS', { value: code }));

    const whCode = text(r, 'warehouse').toUpperCase();
    let warehouse = null;
    if (!whCode) problems.push(fail(line, 'WAREHOUSE_REQUIRED'));
    else if (!ctx.warehouseBy.has(whCode)) problems.push(fail(line, 'WAREHOUSE_UNKNOWN', { value: whCode }));
    else if (!(warehouse = ctx.accessibleBy.get(whCode))) problems.push(fail(line, 'WAREHOUSE_FORBIDDEN', { value: whCode }));

    let project = null;
    const projectCode = text(r, 'project').toUpperCase();
    if (projectCode && !(project = ctx.projectBy.get(projectCode))) problems.push(fail(line, 'PROJECT_UNKNOWN', { value: projectCode }));

    let unitCost = null;
    if (text(r, 'unitCost')) {
      unitCost = parseNumber(raw(r, 'unitCost'));
      if (!(unitCost >= 0)) problems.push(fail(line, 'COST_INVALID', { value: text(r, 'unitCost') }));
    }
    let currencyId = null;
    const currencyCode = text(r, 'currency').toUpperCase();
    if (currencyCode) {
      currencyId = ctx.currencyBy.get(currencyCode)?.id || null;
      if (!currencyId) problems.push(fail(line, 'CURRENCY_UNKNOWN', { value: currencyCode }));
    } else if (unitCost !== null) currencyId = ctx.defaultCurrencyId;

    const conditionRaw = normalize(text(r, 'condition'));
    let condition = 'GOOD';
    if (DAMAGED.includes(conditionRaw)) condition = 'DAMAGED';
    else if (!GOOD.includes(conditionRaw)) problems.push(fail(line, 'CONDITION_INVALID', { value: text(r, 'condition') }));

    const tagProject = text(r, 'tagProject').toUpperCase().slice(0, 20) || null;
    if (tagProject && !SEGMENT_RE.test(tagProject)) problems.push(fail(line, 'TAG_PROJECT_INVALID', { value: tagProject }));
    const acquisitionDate = acquisitionDateOf(raw(r, 'acquisitionDate'));
    if (acquisitionDate === undefined) problems.push(fail(line, 'DATE_INVALID', { value: text(r, 'acquisitionDate') }));

    const serial = text(r, 'serial').slice(0, 100);
    const assetTag = text(r, 'assetTag').slice(0, 100);
    const notes = text(r, 'notes').slice(0, 2000) || null;
    const quantityText = text(r, 'quantity');

    if (item && item.track_serials && !item.track_lots) {
      if (!serial) problems.push(fail(line, 'SERIAL_REQUIRED', { value: code }));
      if (quantityText && Number(parseNumber(raw(r, 'quantity'))) !== 1) problems.push(fail(line, 'QUANTITY_SERIAL', { value: quantityText }));
      if (serial) {
        const key = `${item.id}|${serial.toUpperCase()}`;
        if (fileSerials.has(key)) problems.push(fail(line, 'SERIAL_DUPLICATE', { value: serial, other: fileSerials.get(key) }));
        else if (ctx.knownSerials.has(key)) problems.push(fail(line, 'SERIAL_EXISTS', { value: serial }));
      }
      if (assetTag) {
        const key = assetTag.toUpperCase();
        if (fileTags.has(key)) problems.push(fail(line, 'TAG_DUPLICATE', { value: assetTag, other: fileTags.get(key) }));
      }
      if (problems.length) { errors.push(...problems); continue; }
      fileSerials.set(`${item.id}|${serial.toUpperCase()}`, line);
      if (assetTag) fileTags.set(assetTag.toUpperCase(), line);
      const unit = { line, item, serial, assetTag: assetTag || null, warehouse, project, condition, unitCost, currencyId, notes, tagProject, acquisitionDate };
      units.push(unit);
      if (assetTag) pending.push(unit);
      continue;
    }

    if (item && !item.track_serials) {
      if (serial) problems.push(fail(line, 'SERIAL_NOT_TRACKED', { value: code }));
      if (assetTag) problems.push(fail(line, 'TAG_NOT_TRACKED', { value: code }));
    }
    const quantity = quantityText ? parseNumber(raw(r, 'quantity')) : 1;
    if (!(quantity > EPS)) problems.push(fail(line, 'QUANTITY_INVALID', { value: quantityText }));
    if (item && warehouse && ctx.movedPairs.has(`${item.id}|${warehouse.id}`)) problems.push(fail(line, 'OPENING_EXISTS', { value: code, warehouse: warehouse.code }));
    if (problems.length) { errors.push(...problems); continue; }
    const key = [item.id, warehouse.id, project?.id || '', unitCost ?? '', currencyId || ''].join('|');
    if (!groups.has(key)) groups.set(key, { lines: [], item, warehouse, project, quantity: 0, unitCost, currencyId, notes: [] });
    const g = groups.get(key);
    g.lines.push(line);
    g.quantity += quantity;
    if (notes) g.notes.push(notes);
  }

  // N° d'inventaire déjà attribués dans l'entreprise
  if (pending.length && ctx.enterpriseId) {
    const known = new Set((await db.select(
      `SELECT UPPER(asset_tag) AS tag FROM stock_units WHERE enterprise_id = $1 AND status <> 'VOID' AND UPPER(asset_tag) = ANY($2::text[])`,
      [ctx.enterpriseId, pending.map(u => u.assetTag.toUpperCase())]
    )).map(k => k.tag));
    for (const u of pending.filter(x => known.has(x.assetTag.toUpperCase()))) {
      errors.push(fail(u.line, 'TAG_EXISTS', { value: u.assetTag }));
      units.splice(units.indexOf(u), 1);
    }
  }

  errors.sort((a, b) => a.line - b.line);
  return { enterpriseId: ctx.enterpriseId, ctx, units, openings: [...groups.values()], errors, totalLines: dataRows.length };
}

const currencyCode = (ctx, id) => ctx.currencyById.get(id)?.format_key || null;

/** Aperçu sans écriture */
async function preview(file, { userId }) {
  const { ctx, units, openings, errors, totalLines } = await analyze(file, { userId });
  const ref = (w) => w && { code: w.code, name: w.name };
  return {
    units: units.map(u => ({
      line: u.line, code: u.item.code, name: u.item.name, serial: u.serial, assetTag: u.assetTag, warehouse: ref(u.warehouse),
      project: u.project && { code: u.project.code, name: u.project.name }, condition: u.condition,
      tagProject: u.tagProject, acquisitionDate: u.acquisitionDate, unitCost: u.unitCost, currency: u.unitCost !== null ? currencyCode(ctx, u.currencyId) : null,
    })),
    openings: openings.map(o => ({
      lines: o.lines, code: o.item.code, name: o.item.name, unit: o.item.unit, warehouse: ref(o.warehouse),
      project: o.project && { code: o.project.code, name: o.project.name }, quantity: o.quantity,
      unitCost: o.unitCost, currency: o.unitCost !== null ? currencyCode(ctx, o.currencyId) : null,
    })),
    errors,
    summary: {
      totalLines, units: units.length, openings: openings.length,
      openingQuantity: openings.reduce((s, o) => s + o.quantity, 0), errors: errors.length,
      damaged: units.filter(u => u.condition === 'DAMAGED').length, autoTags: units.filter(u => !u.assetTag).length,
    },
  };
}

/** Écrit les lignes valides en une transaction (une seule opération de stock) */
async function apply(file, { userId }) {
  const { enterpriseId, units, openings, errors, totalLines } = await analyze(file, { userId });
  if (!enterpriseId) { const e = new Error('Réservé aux utilisateurs d\'une entreprise'); e.status = 403; throw e; }
  if (!units.length && !openings.length) {
    const e = new Error('Aucune ligne valide à importer'); e.status = 400; e.code = 'NOTHING_TO_IMPORT'; e.details = { errors };
    throw e;
  }
  const result = await db.withTransaction(async (tx) => {
    for (const u of units) {
      const row = await tx.one(
        `INSERT INTO stock_units (enterprise_id, stock_item_id, serial_number, asset_tag, status, condition, warehouse_id, created_by, project_id, notes,
                                  acquisition_date, tag_project_code)
         VALUES ($1, $2, $3, $4, 'IN_STOCK', $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [enterpriseId, u.item.id, u.serial, u.assetTag, u.condition, u.warehouse.id, userId, u.project?.id || null, u.notes, u.acquisitionDate, u.tagProject]
      );
      await stockModel.addMovement(tx, {
        enterpriseId, stockItemId: u.item.id, warehouseId: u.warehouse.id, unitId: row.id, type: 'OPENING', quantity: 1,
        unitCost: u.unitCost, currencyId: u.unitCost !== null ? u.currencyId : null,
        sourceType: 'IMPORT', comment: 'Parc existant (import)', performedBy: userId, projectId: u.project?.id || null,
      });
    }
    let quantity = 0;
    for (const o of openings) {
      await stockModel.addMovement(tx, {
        enterpriseId, stockItemId: o.item.id, warehouseId: o.warehouse.id, type: 'OPENING', quantity: o.quantity,
        unitCost: o.unitCost, currencyId: o.unitCost !== null ? o.currencyId : null, sourceType: 'IMPORT',
        comment: ['Parc existant (import)', ...new Set(o.notes)].join(' — ').slice(0, 1000), performedBy: userId, projectId: o.project?.id || null,
      });
      quantity += o.quantity;
    }
    const group = await tx.one(`SELECT current_setting('app.stock_movement_group', true) AS id`);
    const number = group?.id ? (await tx.one('SELECT group_number FROM stock_movement_groups WHERE id::text = $1', [group.id]))?.group_number : null;
    return { units: units.length, openings: openings.length, openingQuantity: quantity, damaged: units.filter(u => u.condition === 'DAMAGED').length, groupNumber: number || null };
  });
  return { ...result, totalLines, skipped: errors.length, errors };
}

/** Modèle à remplir (.xlsx avec référentiels et mode d'emploi, ou .csv « ; » + BOM) dans la langue demandée */
async function template({ userId, lang, format = 'xlsx' }) {
  const T = i18n.translator(lang);
  const iParams = [];
  const pParams = [];
  const [items, warehouses, projects] = await Promise.all([
    db.select(`SELECT si.code, si.name, si.track_serials FROM stock_items si
               WHERE si.is_active AND si.is_stockable AND NOT si.track_lots${tenant.filter('si.enterprise_id', iParams)} ORDER BY si.code`, iParams),
    warehouseModel.accessibleFor(userId),
    db.select(`SELECT p.code, p.name FROM projects p WHERE p.is_active${tenant.filter('p.enterprise_id', pParams)} ORDER BY p.code`, pParams),
  ]);
  const headers = FIELDS.map(f => T(`stockUnitImport.headers.${f.key}`));
  const serialItem = items.find(i => i.track_serials)?.code || 'EX-LAPTOP';
  const plainItem = items.find(i => !i.track_serials)?.code || 'EX-CHAIR';
  const wh = warehouses[0]?.code || 'DEP-01';
  const prj = projects[0]?.code || '';
  const good = T('stockUnitImport.good'), damaged = T('stockUnitImport.damaged');
  const examples = [
    [serialItem, '5CG1403NX4', 'INV-0001', wh, '', prj, '', '2022-03-15', good, 1450, 'USD', T('stockUnitImport.example.note')],
    [serialItem, '5CG1403P4M', '', wh, '', prj, 'MIHR', '2021', damaged, '', '', ''],
    [plainItem, '', '', wh, 12, prj, '', '', '', 45, 'USD', ''],
  ];
  if (format === 'csv') {
    const esc = (v) => { const s = String(v ?? ''); return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [headers, ...examples].map(r => r.map(esc).join(';')).join('\r\n');
    return { buffer: Buffer.from(`﻿${csv}\r\n`, 'utf8'), filename: `${T('stockUnitImport.fileName')}.csv`, contentType: 'text/csv; charset=utf-8' };
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = 'procureApp';
  const ws = wb.addWorksheet(T('stockUnitImport.sheets.units'), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = FIELDS.map((f, i) => ({ header: headers[i], key: f.key, width: Math.max(14, headers[i].length + 4) }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 32;
  FIELDS.forEach((f, i) => {
    head.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f.required ? 'FF1D4ED8' : 'FF475569' } };
    head.getCell(i + 1).note = T(`stockUnitImport.help.${f.key}`);
  });
  examples.forEach(r => { ws.addRow(r).font = { italic: true, color: { argb: 'FF6B7280' } }; });

  const ref = wb.addWorksheet(T('stockUnitImport.sheets.references'));
  ref.columns = [
    { header: T('stockUnitImport.ref.itemCode'), width: 30 }, { header: T('stockUnitImport.ref.itemName'), width: 50 },
    { header: T('stockUnitImport.ref.serials'), width: 16 }, { width: 4 },
    { header: T('stockUnitImport.ref.warehouseCode'), width: 18 }, { header: T('stockUnitImport.ref.warehouseName'), width: 36 }, { width: 4 },
    { header: T('stockUnitImport.ref.projectCode'), width: 18 }, { header: T('stockUnitImport.ref.projectName'), width: 40 }, { width: 4 },
    { header: T('stockUnitImport.ref.condition'), width: 16 },
  ];
  ref.getRow(1).font = { bold: true };
  const count = Math.max(items.length, warehouses.length, projects.length, 2);
  for (let i = 0; i < count; i++) {
    const it = items[i], w = warehouses[i], p = projects[i];
    ref.addRow([it?.code || null, it?.name || null, it ? T(it.track_serials ? 'stockUnitImport.yes' : 'stockUnitImport.no') : null, null,
      w?.code || null, w ? `${w.name} (${w.location_name})` : null, null, p?.code || null, p?.name || null, null, [good, damaged][i] ?? null]);
  }
  const sheetRef = `'${T('stockUnitImport.sheets.references').replace(/'/g, "''")}'`;
  const listOf = (column, n) => (n ? [`${sheetRef}!$${column}$2:$${column}$${n + 1}`] : null);
  const validations = { item: listOf('A', items.length), warehouse: listOf('E', warehouses.length), project: listOf('H', projects.length), condition: listOf('K', 2) };
  FIELDS.forEach((f, i) => {
    const formulae = validations[f.key];
    if (!formulae) return;
    const letter = ws.getColumn(i + 1).letter;
    ws.dataValidations.add(`${letter}2:${letter}${MAX_ROWS + 1}`, { type: 'list', allowBlank: true, showErrorMessage: false, formulae });
  });

  const help = wb.addWorksheet(T('stockUnitImport.sheets.help'));
  help.columns = [{ header: T('stockUnitImport.ref.column'), width: 30 }, { header: T('stockUnitImport.ref.required'), width: 18 }, { header: T('stockUnitImport.ref.description'), width: 100 }];
  help.getRow(1).font = { bold: true };
  FIELDS.forEach((f, i) => {
    help.addRow([headers[i], T(f.required ? 'stockUnitImport.required' : 'stockUnitImport.optional'), T(`stockUnitImport.help.${f.key}`)]).alignment = { wrapText: true, vertical: 'top' };
  });
  help.addRow([]);
  for (const key of ['rules1', 'rules2', 'rules3', 'rules4']) help.addRow([T(`stockUnitImport.${key}`)]).font = { italic: true };
  return {
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    filename: `${T('stockUnitImport.fileName')}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

// ============================================================================
// Recodification des n° d'inventaire (migration 57) : une ligne par équipement existant (Code article + N° de série),
// avec la date d'acquisition et le segment projet du TAG. À la confirmation, le n° est recalculé par le trigger
// (ORGANISATION-PROJET-CATÉGORIE-ANNÉE-NNN, dans l'ordre du fichier) et l'ancien est ajouté aux notes de l'équipement.
// Exige le préfixe d'organisation (409 ASSET_TAG_ORG_REQUIRED) et le code catégorie de chaque article.
// ============================================================================
const RETAG_FIELDS = [{ key: 'item', required: true }, { key: 'serial', required: true }, { key: 'acquisitionDate' }, { key: 'tagProject' }];

async function retagAnalyze(file) {
  let rows;
  try {
    rows = await readRows(file);
  } catch (e) {
    const err = new Error('Fichier illisible : vérifiez qu\'il s\'agit bien d\'un .xlsx ou .csv'); err.status = 400; err.code = 'UNREADABLE';
    throw err;
  }
  dropLeadingBlankRows(rows);
  if (rows.length < 2) { const e = new Error('Le fichier ne contient aucun équipement'); e.status = 400; e.code = 'EMPTY'; throw e; }
  const aliases = columnAliases();
  const col = mapHeader(rows[0], Object.fromEntries(RETAG_FIELDS.map(f => [f.key, aliases[f.key]])));
  const missing = RETAG_FIELDS.filter(f => f.required && col[f.key] === undefined).map(f => f.key);
  if (missing.length) {
    const e = new Error('Colonnes « Code article » et « N° de série » obligatoires'); e.status = 400; e.code = 'MISSING_COLUMNS'; e.details = { missing };
    throw e;
  }
  const dataRows = rows.slice(1).map((r, i) => ({ r, line: i + 2 })).filter(({ r }) => !isBlankRow(r));
  if (dataRows.length > MAX_ROWS) {
    const e = new Error(`Maximum ${MAX_ROWS} lignes par import`); e.status = 400; e.code = 'TOO_MANY_ROWS'; e.details = { max: MAX_ROWS };
    throw e;
  }
  const enterpriseId = tenant.enterpriseId();
  const org = enterpriseId ? (await db.one('SELECT asset_tag_org FROM enterprise WHERE id = $1', [enterpriseId]))?.asset_tag_org : null;
  if (!org) {
    const e = new Error('Renseignez d\'abord le préfixe d\'organisation des n° d\'inventaire (« Mon entreprise »)');
    e.status = 409; e.code = 'ASSET_TAG_ORG_REQUIRED';
    throw e;
  }
  const raw = (r, key) => (col[key] === undefined ? '' : r[col[key]]);
  const text = (r, key) => cellText(raw(r, key)).trim();
  const params = [[...new Set(dataRows.map(({ r }) => text(r, 'item').toUpperCase()).filter(Boolean))]];
  const units = await db.select(
    `SELECT un.id, un.serial_number, un.asset_tag, un.status, un.acquisition_date, un.tag_project_code,
            si.code AS item_code, si.name AS item_name, si.asset_category
     FROM stock_units un JOIN stock_items si ON si.id = un.stock_item_id
     WHERE un.status <> 'VOID' AND UPPER(si.code) = ANY($1::text[])${tenant.filter('un.enterprise_id', params)}`,
    params
  );
  const unitBy = new Map(units.map(u => [`${u.item_code.toUpperCase()}|${u.serial_number.toUpperCase()}`, u]));
  const seen = new Map();
  const errors = [];
  const lines = [];
  for (const { r, line } of dataRows) {
    const problems = [];
    const code = text(r, 'item').toUpperCase();
    const serial = text(r, 'serial');
    const key = `${code}|${serial.toUpperCase()}`;
    const unit = unitBy.get(key);
    if (!code || !serial) problems.push(fail(line, 'UNIT_REQUIRED'));
    else if (!unit) problems.push(fail(line, 'UNIT_NOT_FOUND', { value: serial, item: code }));
    else if (!unit.asset_category) problems.push(fail(line, 'ITEM_CATEGORY_MISSING', { value: code }));
    if (seen.has(key)) problems.push(fail(line, 'SERIAL_DUPLICATE', { value: serial, other: seen.get(key) }));
    const tagProject = text(r, 'tagProject').toUpperCase().slice(0, 20) || null;
    if (tagProject && !SEGMENT_RE.test(tagProject)) problems.push(fail(line, 'TAG_PROJECT_INVALID', { value: tagProject }));
    const acquisitionDate = acquisitionDateOf(raw(r, 'acquisitionDate'));
    if (acquisitionDate === undefined) problems.push(fail(line, 'DATE_INVALID', { value: text(r, 'acquisitionDate') }));
    if (problems.length) { errors.push(...problems); continue; }
    seen.set(key, line);
    lines.push({ line, unit, tagProject, acquisitionDate });
  }
  return { enterpriseId, org, lines, errors, totalLines: dataRows.length };
}

/** Aperçu : équipements trouvés, ancien n°, éléments du nouveau (le n° exact est attribué à la confirmation) */
async function retagPreview(file) {
  const { org, lines, errors, totalLines } = await retagAnalyze(file);
  return {
    org,
    units: lines.map(l => ({
      line: l.line, code: l.unit.item_code, name: l.unit.item_name, serial: l.unit.serial_number, oldTag: l.unit.asset_tag,
      pattern: `${org}-${l.tagProject || l.unit.tag_project_code || '…'}-${l.unit.asset_category}-${(l.acquisitionDate || '').slice(0, 4) || new Date().getFullYear()}-NNN`,
    })),
    errors,
    summary: { totalLines, units: lines.length, errors: errors.length },
  };
}

/** Recodification en une transaction ; → correspondance ancien / nouveau n° (marquage physique) */
async function retagApply(file) {
  const { enterpriseId, lines, errors, totalLines } = await retagAnalyze(file);
  if (!lines.length) {
    const e = new Error('Aucune ligne valide'); e.status = 400; e.code = 'NOTHING_TO_IMPORT'; e.details = { errors };
    throw e;
  }
  const changes = await db.withTransaction(async (tx) => {
    const out = [];
    for (const l of lines) {
      // Ancien n° conservé dans les notes (traçabilité de l'ancien marquage)
      const note = l.unit.asset_tag ? `Ancien n° d'inventaire : ${l.unit.asset_tag}` : null;
      const row = await tx.one(
        `UPDATE stock_units SET acquisition_date = COALESCE($2::date, acquisition_date), tag_project_code = COALESCE($3, tag_project_code),
                notes = CASE WHEN $4::text IS NULL OR COALESCE(notes, '') LIKE '%' || $4 || '%' THEN notes
                             ELSE NULLIF(CONCAT_WS(' — ', NULLIF(notes, ''), $4), '') END,
                asset_tag = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND enterprise_id = $5 RETURNING asset_tag`,
        [l.unit.id, l.acquisitionDate, l.tagProject, note, enterpriseId]
      );
      out.push({ line: l.line, code: l.unit.item_code, name: l.unit.item_name, serial: l.unit.serial_number, oldTag: l.unit.asset_tag, newTag: row.asset_tag });
    }
    return out;
  });
  return { units: changes.length, changes, totalLines, skipped: errors.length, errors };
}

module.exports = { preview, apply, template, retagPreview, retagApply, MAX_ROWS };
