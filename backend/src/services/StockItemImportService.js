// backend/src/services/StockItemImportService.js
// Import du catalogue d'articles depuis un fichier Excel (.xlsx) ou CSV, avec stock initial facultatif.
//
//  - Une ligne = un article (code) : créé s'il n'existe pas dans l'entreprise, sinon mis à jour avec les seules
//    cellules remplies (une cellule vide ne change rien). Propriétés figées d'un article déjà mouvementé
//    (unité, stockable, suivi par lot / n° de série) : même règle que la fiche article.
//  - Stock initial (colonnes Code dépôt + Quantité initiale, coût / devise / lot / péremption facultatifs) :
//    mouvement OPENING dans un dépôt auquel l'utilisateur a accès. Refusé si l'article a déjà des mouvements
//    dans ce dépôt (un second import ne double pas le stock : inventaire ou ajustement pour corriger).
//    Équipements suivis par n° de série : « Parc existant » (une ligne par unité), pas par l'import.
//  - Un même code peut figurer sur plusieurs lignes (plusieurs dépôts / lots) : la fiche article est lue sur la
//    première, les suivantes ne peuvent pas la contredire.
//  - preview() valide sans rien écrire ; apply() relit le fichier et écrit les lignes valides en une transaction.
// Erreurs par ligne : { line, code, params } (traduites côté client, stock.import.err.<code>).
const ExcelJS = require('exceljs');
const db = require('../config/database');
const tenant = require('../utils/tenant');
const i18n = require('../i18n');
const stockModel = require('../models/StockModel');
const warehouseModel = require('../models/WarehouseModel');
const { cellText, parseNumber, readRows, isBlankRow, dropLeadingBlankRows, mapHeader, normalize } = require('../utils/tabularImport');

const MAX_ROWS = 2000;

// Ordre des colonnes du modèle ; required = obligatoire pour un nouvel article
const FIELDS = [
  { key: 'code', required: true }, { key: 'name', required: true }, { key: 'unit', required: true },
  { key: 'category' }, { key: 'description' }, { key: 'stockable', bool: true }, { key: 'trackLots', bool: true },
  { key: 'trackExpiry', bool: true }, { key: 'trackSerials', bool: true }, { key: 'minQuantity' }, { key: 'reorderQuantity' },
  { key: 'warehouse', opening: true }, { key: 'openingQuantity', opening: true }, { key: 'unitCost', opening: true },
  { key: 'currency', opening: true }, { key: 'lotNumber', opening: true }, { key: 'expiryDate', opening: true },
];

// En-têtes acceptés en plus de ceux du modèle (toutes langues : stockImport.headers.*)
const ALIASES = {
  code: ['code', 'code article', 'item code', 'sku', 'reference', 'ref'],
  name: ['designation', 'nom', 'libelle', 'article', 'name', 'item name', 'item'],
  unit: ['unite', 'unit', 'uom', 'unite de mesure'],
  category: ['categorie', 'category', 'code categorie', 'category code'],
  description: ['description', 'details'],
  stockable: ['stockable', 'stocke'],
  trackLots: ['suivi par lot', 'suivi lot', 'lots', 'track lots', 'lot tracking'],
  trackExpiry: ['suivi de peremption', 'suivi peremption', 'peremption suivie', 'track expiry', 'expiry tracking'],
  trackSerials: ['suivi par n° de serie', 'n° de serie', 'numeros de serie', 'track serials', 'serial tracking', 'serial numbers'],
  minQuantity: ['stock minimum', 'minimum', 'stock min', 'min', 'minimum stock', 'min quantity'],
  reorderQuantity: ['quantite de reapprovisionnement', 'qte reappro', 'reapprovisionnement', 'reorder quantity', 'reorder qty'],
  warehouse: ['code depot', 'depot', 'warehouse', 'warehouse code'],
  openingQuantity: ['quantite initiale', 'stock initial', 'quantite en stock', 'qte initiale', 'opening quantity', 'initial quantity', 'opening stock'],
  unitCost: ['cout unitaire', 'cout', 'prix unitaire', 'unit cost', 'cost'],
  currency: ['devise', 'currency'],
  lotNumber: ['n° de lot', 'numero de lot', 'lot', 'lot number'],
  expiryDate: ['date de peremption', 'peremption', 'expiry date', 'expiry', 'expiration date'],
};

const columnAliases = () => {
  const out = {};
  for (const { key } of FIELDS) {
    const fromLocales = i18n.LANGS.map(l => normalize(i18n.translator(l)(`stockImport.headers.${key}`)));
    out[key] = [...new Set([...fromLocales, ...ALIASES[key]])];
  }
  return out;
};

const TRUE = ['oui', 'o', 'yes', 'y', 'x', '1', 'vrai', 'true'];
const FALSE = ['non', 'n', 'no', '0', 'faux', 'false', '-'];
const CODE_RE = /^[A-Z0-9_.-]{1,50}$/;

function fail(line, code, params = {}) { return { line, code, params }; }

/** Date : AAAA-MM-JJ, JJ/MM/AAAA, JJ-MM-AAAA ou numéro de série Excel → 'AAAA-MM-JJ' (null si invalide) */
function parseDate(raw) {
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {
    return new Date(Math.round((raw - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const s = String(raw ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let y, mo, d;
  if (m) [, y, mo, d] = m;
  else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [, d, mo, y] = m;
  else return null;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** Données de référence de l'entreprise courante, chargées une fois par import */
async function loadContext(userId, codes) {
  const enterpriseId = tenant.enterpriseId();
  const params = [];
  const scope = tenant.filter('si.enterprise_id', params);
  params.push(codes);
  const items = await db.select(
    `SELECT si.id, si.code, si.name, si.unit, si.description, si.category_id, si.is_stockable, si.track_lots,
            si.track_expiry, si.track_serials, si.min_quantity::float8 AS min_quantity,
            si.reorder_quantity::float8 AS reorder_quantity, si.enterprise_id
     FROM stock_items si WHERE 1=1${scope} AND UPPER(si.code) = ANY($${params.length}::text[])`,
    params
  );
  const ids = items.map(i => i.id);
  const [moved, lots, categories, accessible, allWarehouses, currencies] = await Promise.all([
    ids.length ? db.select('SELECT DISTINCT stock_item_id, warehouse_id FROM stock_movements WHERE stock_item_id = ANY($1::uuid[])', [ids]) : [],
    ids.length ? db.select(`SELECT stock_item_id, UPPER(lot_number) AS lot, to_char(expiry_date, 'YYYY-MM-DD') AS expiry
                            FROM stock_lots WHERE stock_item_id = ANY($1::uuid[])`, [ids]) : [],
    db.select('SELECT id, code, name, translations, is_stockable FROM market_categories WHERE is_active'),
    warehouseModel.accessibleFor(userId),
    warehouseModel.list({ activeOnly: true }),
    db.select('SELECT id, format_key FROM currency'),
  ]);
  const ent = (enterpriseId && await db.one('SELECT id, currency_id FROM enterprise WHERE id = $1', [enterpriseId]))
    || { id: enterpriseId, currency_id: null };

  const categoryBy = new Map();
  for (const c of categories) {
    const keys = [c.code, c.name, ...Object.values(c.translations || {}).map(tr => tr?.name)].filter(Boolean);
    for (const k of keys) if (!categoryBy.has(normalize(k))) categoryBy.set(normalize(k), c);
  }
  return {
    enterpriseId: ent.id,
    defaultCurrencyId: ent.currency_id,
    itemsByCode: new Map(items.map(i => [i.code.toUpperCase(), i])),
    movedItems: new Set(moved.map(m => m.stock_item_id)),
    movedPairs: new Set(moved.map(m => `${m.stock_item_id}|${m.warehouse_id}`)),
    lotExpiry: new Map(lots.map(l => [`${l.stock_item_id}|${l.lot}`, l.expiry])),
    categoryBy,
    accessibleBy: new Map(accessible.map(w => [w.code.toUpperCase(), w])),
    warehouseBy: new Map(allWarehouses.map(w => [w.code.toUpperCase(), w])),
    currencyBy: new Map(currencies.map(c => [c.format_key.toUpperCase(), c])),
    currencyById: new Map(currencies.map(c => [c.id, c])),
  };
}

/**
 * Lit et valide le fichier. Renvoie { items, openings, errors, totalLines } :
 *   items : [{ line, code, action: CREATE | UPDATE | UNCHANGED, fields (colonnes SQL), name, unit, … }]
 *   openings : [{ line, code, name, unit, warehouse, quantity, unitCost, currency, lotNumber, expiryDate }]
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
  if (rows.length < 2) { const e = new Error('Le fichier ne contient aucun article'); e.status = 400; e.code = 'EMPTY'; throw e; }
  const col = mapHeader(rows[0], columnAliases());
  const missing = ['code'].filter(k => col[k] === undefined);
  if (missing.length) {
    const e = new Error('Colonne « Code » introuvable : utilisez le modèle proposé dans la fenêtre d\'import');
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
  const codes = [...new Set(dataRows.map(({ r }) => text(r, 'code').toUpperCase()).filter(Boolean))];
  const ctx = await loadContext(userId, codes);

  const items = [];          // une entrée par code
  const itemByCode = new Map();
  const openings = [];
  const errors = [];
  const openingKeys = new Map(); // article|dépôt|lot → ligne
  const fileLots = new Map();    // article|lot → péremption

  for (const { r, line } of dataRows) {
    const code = text(r, 'code').toUpperCase();
    if (!code) { errors.push(fail(line, 'CODE_REQUIRED')); continue; }
    if (!CODE_RE.test(code)) { errors.push(fail(line, 'CODE_INVALID', { value: code })); continue; }

    // ---- Valeurs de la fiche article présentes sur la ligne
    const problems = [];
    const given = {};
    const name = text(r, 'name').slice(0, 200);
    if (name) given.name = name;
    const unit = text(r, 'unit').slice(0, 30);
    if (unit) given.unit = unit;
    const description = text(r, 'description').slice(0, 2000);
    if (description) given.description = description;
    const categoryRaw = text(r, 'category');
    if (categoryRaw) {
      const category = ctx.categoryBy.get(normalize(categoryRaw));
      if (!category) problems.push(fail(line, 'CATEGORY_UNKNOWN', { value: categoryRaw }));
      else given.category = category;
    }
    for (const key of ['stockable', 'trackLots', 'trackExpiry', 'trackSerials']) {
      const v = normalize(text(r, key));
      if (!v) continue;
      if (TRUE.includes(v)) given[key] = true;
      else if (FALSE.includes(v)) given[key] = false;
      else problems.push(fail(line, 'BOOL_INVALID', { column: key, value: text(r, key) }));
    }
    for (const key of ['minQuantity', 'reorderQuantity']) {
      if (!text(r, key)) continue;
      const n = parseNumber(raw(r, key));
      if (key === 'minQuantity' ? !(n >= 0) : !(n > 0)) problems.push(fail(line, key === 'minQuantity' ? 'MIN_INVALID' : 'REORDER_INVALID', { value: text(r, key) }));
      else given[key] = n;
    }

    // ---- Fiche article : première ligne du code, ou cohérence avec elle
    let entry = itemByCode.get(code);
    if (entry) {
      for (const [key, value] of Object.entries(given)) {
        const known = entry.given[key];
        const same = key === 'category' ? known?.id === value.id : known === value;
        if (known !== undefined && !same) problems.push(fail(line, 'CONFLICTING_VALUES', { column: key, line: entry.line }));
      }
      if (problems.length) { errors.push(...problems); continue; }
      if (entry.invalid) { errors.push(fail(line, 'ITEM_INVALID', { line: entry.line })); continue; }
    } else {
      const existing = ctx.itemsByCode.get(code) || null;
      entry = { line, code, existing, given, invalid: false };
      itemByCode.set(code, entry);
      if (!existing && !given.name) problems.push(fail(line, 'NAME_REQUIRED'));
      if (!existing && !given.unit) problems.push(fail(line, 'UNIT_REQUIRED'));

      // Règles de suivi (même logique que la fiche article)
      const base = existing || { is_stockable: given.category ? !!given.category.is_stockable : true, track_lots: false, track_expiry: false, track_serials: false };
      if (!existing && given.stockable === undefined && given.category) given.stockable = !!given.category.is_stockable;
      const stockable = given.stockable ?? base.is_stockable;
      const lots = given.trackLots ?? base.track_lots;
      const expiry = given.trackExpiry ?? base.track_expiry;
      const serials = given.trackSerials ?? base.track_serials;
      if (expiry && !lots) problems.push(fail(line, 'EXPIRY_NEEDS_LOTS'));
      if (lots && !stockable) problems.push(fail(line, 'LOTS_NEED_STOCKABLE'));
      if (serials && (!stockable || lots)) problems.push(fail(line, 'SERIALS_INVALID'));
      if (existing && ctx.movedItems.has(existing.id)
        && ((given.stockable !== undefined && given.stockable !== existing.is_stockable)
          || (given.trackLots !== undefined && given.trackLots !== existing.track_lots)
          || (given.trackSerials !== undefined && given.trackSerials !== existing.track_serials)
          || (given.unit !== undefined && given.unit !== existing.unit))) {
        problems.push(fail(line, 'LOCKED_FIELDS'));
      }
      entry.rules = { stockable, lots, expiry, serials };
      entry.unit = given.unit ?? existing?.unit;
      entry.name = given.name ?? existing?.name;

      if (problems.length) { entry.invalid = true; errors.push(...problems); continue; }

      // Champs SQL à écrire (création : toutes les valeurs ; mise à jour : seulement celles qui changent)
      const target = {
        name: given.name, unit: given.unit, description: given.description, category_id: given.category?.id,
        is_stockable: given.stockable, track_lots: given.trackLots, track_expiry: given.trackExpiry, track_serials: given.trackSerials,
        min_quantity: given.minQuantity, reorder_quantity: given.reorderQuantity,
      };
      const fields = {};
      for (const [k, v] of Object.entries(target)) {
        if (v === undefined) continue;
        if (!existing || (existing[k] ?? null) !== v) fields[k] = v;
      }
      // Suivi par lot retiré → péremption retirée aussi (contrainte stock_items_expiry_needs_lots)
      if (existing && fields.track_lots === false && existing.track_expiry && given.trackExpiry === undefined) fields.track_expiry = false;
      items.push({
        line, code, action: !existing ? 'CREATE' : Object.keys(fields).length ? 'UPDATE' : 'UNCHANGED',
        id: existing?.id || null, fields, changed: Object.keys(fields),
        name: entry.name, unit: entry.unit, category: (given.category || null) && { code: given.category.code, name: given.category.name },
        stockable, trackLots: lots, trackExpiry: expiry, trackSerials: serials,
      });
    }

    // ---- Stock initial (facultatif)
    const hasOpening = ['warehouse', 'openingQuantity', 'unitCost', 'currency', 'lotNumber', 'expiryDate'].some(k => text(r, k));
    if (!hasOpening) continue;
    const opening = [];
    const whCode = text(r, 'warehouse').toUpperCase();
    const quantity = parseNumber(raw(r, 'openingQuantity'));
    if (!whCode) opening.push(fail(line, 'OPENING_WAREHOUSE_REQUIRED'));
    if (!(quantity > 0)) opening.push(fail(line, 'OPENING_QUANTITY_INVALID', { value: text(r, 'openingQuantity') }));
    let warehouse = null;
    if (whCode) {
      warehouse = ctx.accessibleBy.get(whCode) || null;
      if (!warehouse) opening.push(fail(line, ctx.warehouseBy.has(whCode) ? 'WAREHOUSE_FORBIDDEN' : 'WAREHOUSE_UNKNOWN', { value: whCode }));
    }
    const { rules } = entry;
    if (!rules.stockable) opening.push(fail(line, 'NOT_STOCKABLE'));
    else if (rules.serials) opening.push(fail(line, 'SERIAL_ITEM'));
    const lotNumber = text(r, 'lotNumber').slice(0, 100);
    const expiryRaw = raw(r, 'expiryDate');
    const expiryDate = text(r, 'expiryDate') ? parseDate(typeof expiryRaw === 'number' ? expiryRaw : cellText(expiryRaw)) : null;
    if (text(r, 'expiryDate') && !expiryDate) opening.push(fail(line, 'DATE_INVALID', { value: text(r, 'expiryDate') }));
    if (rules.stockable && !rules.serials) {
      if (rules.lots && !lotNumber) opening.push(fail(line, 'LOT_REQUIRED'));
      if (!rules.lots && lotNumber) opening.push(fail(line, 'LOT_NOT_TRACKED'));
      if (rules.expiry && !text(r, 'expiryDate')) opening.push(fail(line, 'EXPIRY_REQUIRED'));
    }
    let unitCost = null;
    if (text(r, 'unitCost')) {
      unitCost = parseNumber(raw(r, 'unitCost'));
      if (!(unitCost >= 0)) opening.push(fail(line, 'COST_INVALID', { value: text(r, 'unitCost') }));
    }
    let currency = null;
    const currencyCode = text(r, 'currency').toUpperCase();
    if (currencyCode) {
      currency = ctx.currencyBy.get(currencyCode) || null;
      if (!currency) opening.push(fail(line, 'CURRENCY_UNKNOWN', { value: currencyCode }));
    } else if (unitCost !== null) {
      currency = ctx.currencyById.get(ctx.defaultCurrencyId) || null;
    }
    if (entry.existing && warehouse && ctx.movedPairs.has(`${entry.existing.id}|${warehouse.id}`)) {
      opening.push(fail(line, 'OPENING_EXISTS', { warehouse: warehouse.code }));
    }
    if (warehouse && rules.lots && lotNumber) {
      const lotKey = `${code}|${lotNumber.toUpperCase()}`;
      const known = (entry.existing && ctx.lotExpiry.get(`${entry.existing.id}|${lotNumber.toUpperCase()}`)) ?? fileLots.get(lotKey);
      if (known !== undefined && known !== null && expiryDate && known !== expiryDate) {
        opening.push(fail(line, 'LOT_EXPIRY_MISMATCH', { lot: lotNumber, expiry: known }));
      }
      if (expiryDate && !fileLots.has(lotKey)) fileLots.set(lotKey, expiryDate);
    }
    const key = `${code}|${whCode}|${lotNumber.toUpperCase()}`;
    if (openingKeys.has(key)) opening.push(fail(line, 'DUPLICATE_OPENING', { line: openingKeys.get(key) }));
    if (opening.length) { errors.push(...opening); continue; }
    openingKeys.set(key, line);
    openings.push({
      line, code, name: entry.name, unit: entry.unit, warehouse: { id: warehouse.id, code: warehouse.code, name: warehouse.name },
      quantity, unitCost, currency: currency?.format_key || null, currencyId: currency?.id || null,
      lotNumber: rules.lots ? lotNumber : null, expiryDate: rules.lots ? expiryDate : null,
    });
  }

  errors.sort((a, b) => a.line - b.line);
  return { enterpriseId: ctx.enterpriseId, items, openings, errors, totalLines: dataRows.length };
}

/** Aperçu sans écriture */
async function preview(file, { userId }) {
  const { items, openings, errors, totalLines } = await analyze(file, { userId });
  const count = (a) => items.filter(i => i.action === a).length;
  return {
    items: items.map(({ fields, id, ...rest }) => rest),
    openings: openings.map(({ currencyId, warehouse, ...rest }) => ({ ...rest, warehouse: { code: warehouse.code, name: warehouse.name } })),
    errors,
    summary: { totalLines, create: count('CREATE'), update: count('UPDATE'), unchanged: count('UNCHANGED'), openings: openings.length, errors: errors.length },
  };
}

/** Écrit les lignes valides (articles puis stock initial) en une transaction */
async function apply(file, { userId }) {
  const { enterpriseId, items, openings, errors, totalLines } = await analyze(file, { userId });
  if (!enterpriseId) { const e = new Error('Réservé aux utilisateurs d\'une entreprise'); e.status = 403; throw e; }
  if (!items.length && !openings.length) {
    const e = new Error('Aucune ligne valide à importer'); e.status = 400; e.code = 'NOTHING_TO_IMPORT'; e.details = { errors };
    throw e;
  }
  const result = await db.withTransaction(async (tx) => {
    const ids = new Map();
    let created = 0, updated = 0;
    for (const it of items) {
      if (it.action === 'CREATE') {
        const fields = { ...it.fields, code: it.code, enterprise_id: enterpriseId, created_by: userId };
        const cols = Object.keys(fields);
        const row = await tx.one(
          `INSERT INTO stock_items (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
          cols.map(c => fields[c])
        );
        ids.set(it.code, row.id);
        created++;
      } else {
        ids.set(it.code, it.id);
        if (it.action === 'UPDATE') {
          const cols = Object.keys(it.fields);
          await tx.exec(
            `UPDATE stock_items SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1`,
            [it.id, ...cols.map(c => it.fields[c])]
          );
          updated++;
        }
      }
    }
    let quantity = 0;
    for (const o of openings) {
      const stockItemId = ids.get(o.code);
      const lotId = o.lotNumber
        ? await stockModel.findOrCreateLot(tx, { enterpriseId, stockItemId, lotNumber: o.lotNumber, expiryDate: o.expiryDate, createdBy: userId })
        : null;
      await stockModel.addMovement(tx, {
        enterpriseId, stockItemId, warehouseId: o.warehouse.id, lotId, type: 'OPENING', quantity: o.quantity,
        unitCost: o.unitCost, currencyId: o.unitCost !== null ? o.currencyId : null,
        sourceType: 'IMPORT', comment: 'Stock initial (import)', performedBy: userId,
      });
      quantity += o.quantity;
    }
    return { created, updated, unchanged: items.length - created - updated, openings: openings.length, openingQuantity: quantity };
  });
  return { ...result, totalLines, skipped: errors.length, errors };
}

/**
 * Modèle à remplir, dans la langue demandée : .xlsx (feuille Articles avec exemples et listes déroulantes,
 * feuille Mode d'emploi, feuille Référentiels : catégories et dépôts accessibles) ou .csv (« ; » + BOM UTF-8)
 */
async function template({ userId, lang, format = 'xlsx' }) {
  const T = i18n.translator(lang);
  const [categories, warehouses] = await Promise.all([
    db.select('SELECT code, name, translations, is_stockable FROM market_categories WHERE is_active ORDER BY name'),
    warehouseModel.accessibleFor(userId),
  ]);
  const catName = (c) => (lang !== 'fr' && c.translations?.[lang]?.name) || c.name;
  const stockCat = categories.find(c => c.is_stockable) || categories[0];
  const wh = warehouses[0]?.code || 'DEP-01';
  const yes = T('stockImport.yes'), no = T('stockImport.no');
  const headers = FIELDS.map(f => T(`stockImport.headers.${f.key}`));
  // Exemples : consommable avec stock initial, médicament suivi par lot / péremption, équipement (sans stock initial)
  const examples = [
    ['EX-PAPER-A4', T('stockImport.example.paper'), T('stockImport.example.paperUnit'), stockCat?.code || '', '', yes, no, no, no, 20, 50, wh, 120, 4.5, '', '', ''],
    ['EX-PARACETAMOL', T('stockImport.example.drug'), T('stockImport.example.drugUnit'), stockCat?.code || '', '', yes, yes, yes, no, 10, 40, wh, 30, 2.1, '', 'L2026-01', '2027-06-30'],
    ['EX-LAPTOP', T('stockImport.example.laptop'), T('stockImport.example.laptopUnit'), stockCat?.code || '', T('stockImport.example.laptopDesc'), yes, no, no, yes, '', '', '', '', '', '', '', ''],
  ];

  if (format === 'csv') {
    const esc = (v) => { const s = String(v ?? ''); return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [headers, ...examples].map(r => r.map(esc).join(';')).join('\r\n');
    return { buffer: Buffer.from(`﻿${csv}\r\n`, 'utf8'), filename: `${T('stockImport.fileName')}.csv`, contentType: 'text/csv; charset=utf-8' };
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'procureApp';
  const ws = wb.addWorksheet(T('stockImport.sheets.items'), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = FIELDS.map((f, i) => ({ header: headers[i], key: f.key, width: Math.max(14, headers[i].length + 4) }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 32;
  FIELDS.forEach((f, i) => {
    head.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f.required ? 'FF1D4ED8' : f.opening ? 'FF047857' : 'FF475569' } };
    head.getCell(i + 1).note = T(`stockImport.help.${f.key}`);
  });
  examples.forEach(r => ws.addRow(r).font = { italic: true, color: { argb: 'FF6B7280' } });

  // Référentiels (listes déroulantes)
  const ref = wb.addWorksheet(T('stockImport.sheets.references'));
  ref.columns = [
    { header: T('stockImport.ref.categoryCode'), width: 18 }, { header: T('stockImport.ref.categoryName'), width: 40 }, { width: 4 },
    { header: T('stockImport.ref.warehouseCode'), width: 18 }, { header: T('stockImport.ref.warehouseName'), width: 36 }, { width: 4 },
    { header: T('stockImport.ref.yesNo'), width: 10 },
  ];
  ref.getRow(1).font = { bold: true };
  const rowsCount = Math.max(categories.length, warehouses.length, 2);
  for (let i = 0; i < rowsCount; i++) {
    const c = categories[i], w = warehouses[i];
    ref.addRow([c?.code || null, c ? catName(c) : null, null, w?.code || null, w ? `${w.name} (${w.location_name})` : null, null, [yes, no][i] ?? null]);
  }
  const sheetRef = `'${T('stockImport.sheets.references').replace(/'/g, "''")}'`;
  const listOf = (column, count) => (count ? [`${sheetRef}!$${column}$2:$${column}$${count + 1}`] : null);
  const validations = {
    category: listOf('A', categories.length), warehouse: listOf('D', warehouses.length),
    stockable: listOf('G', 2), trackLots: listOf('G', 2), trackExpiry: listOf('G', 2), trackSerials: listOf('G', 2),
  };
  FIELDS.forEach((f, i) => {
    const formulae = validations[f.key];
    if (!formulae) return;
    const letter = ws.getColumn(i + 1).letter;
    // Liste proposée, autre valeur acceptée (catégorie saisie par son nom…) : contrôle à l'import
    ws.dataValidations.add(`${letter}2:${letter}${MAX_ROWS + 1}`, { type: 'list', allowBlank: true, showErrorMessage: false, formulae });
  });

  // Mode d'emploi
  const help = wb.addWorksheet(T('stockImport.sheets.help'));
  help.columns = [{ header: T('stockImport.ref.column'), width: 30 }, { header: T('stockImport.ref.required'), width: 18 }, { header: T('stockImport.ref.description'), width: 100 }];
  help.getRow(1).font = { bold: true };
  FIELDS.forEach((f, i) => {
    const row = help.addRow([headers[i], T(f.required ? 'stockImport.requiredNew' : f.opening ? 'stockImport.openingColumn' : 'stockImport.optional'), T(`stockImport.help.${f.key}`)]);
    row.alignment = { wrapText: true, vertical: 'top' };
  });
  help.addRow([]);
  for (const key of ['rules1', 'rules2', 'rules3', 'rules4', 'rules5']) help.addRow([T(`stockImport.${key}`)]).font = { italic: true };

  return {
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    filename: `${T('stockImport.fileName')}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

module.exports = { preview, apply, template, parseDate, MAX_ROWS };
