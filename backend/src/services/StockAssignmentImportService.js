// backend/src/services/StockAssignmentImportService.js
// Import des affectations d'équipements déjà remis (registre des biens) depuis un fichier Excel (.xlsx) ou CSV :
// une ligne par équipement — Code article + N° de série (ou N° d'inventaire seul) + Email du détenteur.
//
//  - Équipement « en stock » dans un dépôt accessible à l'utilisateur ; détenteur = utilisateur actif de l'entreprise
//    (hors fournisseurs) ; ligne sans email = équipement laissé au dépôt (comptée, pas une erreur).
//  - Le matériel endommagé est accepté (affectation existante, enregistrée après coup).
//  - Confirmation : un bon de sortie (type USER) par dépôt × détenteur, tous écrits en UNE transaction
//    (une seule opération de stock MVG-…) ; chaque détenteur est notifié et confirme la réception comme d'habitude.
//  - Modèle pré-rempli avec les équipements en stock ; le détenteur relevé dans les notes (« Détenteur : … ») est
//    affiché, et son email proposé quand un seul utilisateur porte ce prénom et ce nom.
// Erreurs par ligne : { line, code, params } (traduites côté client, stock.assignImport.err.<code>).
const ExcelJS = require('exceljs');
const db = require('../config/database');
const tenant = require('../utils/tenant');
const i18n = require('../i18n');
const warehouseModel = require('../models/WarehouseModel');
const stockIssueModel = require('../models/StockIssueModel');
const { cellText, readRows, isBlankRow, dropLeadingBlankRows, mapHeader, normalize } = require('../utils/tabularImport');

const MAX_ROWS = 3000;

const FIELDS = [{ key: 'item' }, { key: 'serial' }, { key: 'assetTag' }, { key: 'email', required: true }, { key: 'purpose' }];
const ALIASES = {
  item: ['code article', 'article', 'code', 'item code', 'item', 'sku'],
  serial: ['n° de serie', 'numero de serie', 'no de serie', 'serie', 'serial', 'serial number', 'sn'],
  assetTag: ["n° d'inventaire", "numero d'inventaire", 'inventaire', 'asset tag', 'tag', 'n° inventaire'],
  email: ['email', 'e-mail', 'email du detenteur', 'email detenteur', 'detenteur (email)', 'holder email', 'holder e-mail'],
  purpose: ['motif', 'objet', 'commentaire', 'purpose', 'reason', 'comment'],
};
const columnAliases = () => Object.fromEntries(FIELDS.map(({ key }) => [key, [...new Set([
  ...i18n.LANGS.map(l => normalize(i18n.translator(l)(`stockAssignmentImport.headers.${key}`))), ...ALIASES[key],
])]]));

const fail = (line, code, params = {}) => ({ line, code, params });
const fileError = (status, code, message, details) => Object.assign(new Error(message), { status, code, details });
const fullName = (u) => [u.first_name, u.last_name].filter(Boolean).join(' ');

/** Détenteur relevé dans les notes de l'équipement (import du registre : « Détenteur : X — … ») */
const holderFromNotes = (notes) => (String(notes || '').match(/(?:Détenteur|Holder)\s*:\s*([^—;\n]+)/i)?.[1] || '').trim();

async function analyze(file, { userId }) {
  let rows;
  try {
    rows = await readRows(file);
  } catch {
    throw fileError(400, 'UNREADABLE', 'Fichier illisible : vérifiez qu\'il s\'agit bien d\'un .xlsx ou .csv');
  }
  dropLeadingBlankRows(rows);
  if (rows.length < 2) throw fileError(400, 'EMPTY', 'Le fichier ne contient aucun équipement');
  const col = mapHeader(rows[0], columnAliases());
  const missing = [];
  if (col.email === undefined) missing.push('email');
  if (col.assetTag === undefined && (col.item === undefined || col.serial === undefined)) missing.push('serial');
  if (missing.length) throw fileError(400, 'MISSING_COLUMNS', 'Colonnes « Code article », « N° de série » et « Email du détenteur » obligatoires', { missing });
  const dataRows = rows.slice(1).map((r, i) => ({ r, line: i + 2 })).filter(({ r }) => !isBlankRow(r));
  if (dataRows.length > MAX_ROWS) throw fileError(400, 'TOO_MANY_ROWS', `Maximum ${MAX_ROWS} lignes par import`, { max: MAX_ROWS });

  const text = (r, key) => (col[key] === undefined ? '' : cellText(r[col[key]]).trim());
  const enterpriseId = tenant.enterpriseId();
  const accessible = new Set((await warehouseModel.accessibleFor(userId)).map(w => String(w.id)));

  // Équipements cités (par article + n° de série, ou par n° d'inventaire)
  const serials = [...new Set(dataRows.map(({ r }) => text(r, 'serial').toUpperCase()).filter(Boolean))];
  const tags = [...new Set(dataRows.map(({ r }) => text(r, 'assetTag').toUpperCase()).filter(Boolean))];
  const params = [serials, tags];
  const units = await db.select(
    `SELECT un.id, un.serial_number, un.asset_tag, un.status, un.condition, un.warehouse_id, un.holder_id,
            si.id AS item_id, si.code AS item_code, si.name AS item_name, w.code AS warehouse_code,
            TRIM(COALESCE(h.first_name, '') || ' ' || COALESCE(h.last_name, '')) AS holder_name
     FROM stock_units un JOIN stock_items si ON si.id = un.stock_item_id
     LEFT JOIN warehouses w ON w.id = un.warehouse_id LEFT JOIN users h ON h.id = un.holder_id
     WHERE un.status <> 'VOID' AND (UPPER(un.serial_number) = ANY($1::text[]) OR UPPER(un.asset_tag) = ANY($2::text[]))
       ${tenant.filter('un.enterprise_id', params)}`,
    params
  );
  const bySerial = new Map(units.map(u => [`${u.item_code.toUpperCase()}|${u.serial_number.toUpperCase()}`, u]));
  const byTag = new Map(units.filter(u => u.asset_tag).map(u => [u.asset_tag.toUpperCase(), u]));

  const emails = [...new Set(dataRows.map(({ r }) => text(r, 'email').toLowerCase()).filter(Boolean))];
  const userParams = [emails];
  const users = emails.length ? await db.select(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.is_active,
            EXISTS (SELECT 1 FROM user_profiles up WHERE up.user_id = u.id AND up.profile_id = 'prof_supplier') AS is_supplier
     FROM users u WHERE LOWER(u.email) = ANY($1::text[])${tenant.filter('u.enterprise_id', userParams)}`,
    userParams
  ) : [];
  const userBy = new Map(users.map(u => [u.email.toLowerCase(), u]));

  const seen = new Map();
  const errors = [];
  const lines = [];
  let skipped = 0;
  for (const { r, line } of dataRows) {
    const code = text(r, 'item').toUpperCase();
    const serial = text(r, 'serial');
    const tag = text(r, 'assetTag');
    const email = text(r, 'email').toLowerCase();
    const problems = [];
    let unit = null;
    if (serial && code) unit = bySerial.get(`${code}|${serial.toUpperCase()}`);
    else if (tag) unit = byTag.get(tag.toUpperCase());
    if (!email) { skipped += 1; continue; } // laissé au dépôt
    if (!(serial && code) && !tag) problems.push(fail(line, 'UNIT_REQUIRED'));
    else if (!unit) problems.push(fail(line, 'UNIT_NOT_FOUND', { value: serial || tag, item: code }));
    else if (unit.status === 'ASSIGNED') problems.push(fail(line, 'UNIT_ASSIGNED', { value: unit.serial_number, name: unit.holder_name || '—' }));
    else if (unit.status !== 'IN_STOCK') problems.push(fail(line, 'UNIT_NOT_IN_STOCK', { value: unit.serial_number, status: unit.status }));
    else if (!accessible.has(String(unit.warehouse_id))) problems.push(fail(line, 'WAREHOUSE_FORBIDDEN', { value: unit.warehouse_code }));
    const holder = userBy.get(email);
    if (!holder) problems.push(fail(line, 'HOLDER_UNKNOWN', { value: email }));
    else if (!holder.is_active || holder.is_supplier) problems.push(fail(line, 'HOLDER_INACTIVE', { value: email }));
    if (unit && seen.has(unit.id)) problems.push(fail(line, 'UNIT_DUPLICATE', { value: unit.serial_number, other: seen.get(unit.id) }));
    if (problems.length) { errors.push(...problems); continue; }
    seen.set(unit.id, line);
    lines.push({ line, unit, holder, purpose: text(r, 'purpose').slice(0, 500) || null });
  }
  return { enterpriseId, lines, errors, skipped, totalLines: dataRows.length };
}

/** Bons à créer : un par dépôt × détenteur (équipements dans l'ordre du fichier) */
function groupLines(lines) {
  const groups = new Map();
  for (const l of lines) {
    const key = `${l.unit.warehouse_id}|${l.holder.id}`;
    if (!groups.has(key)) groups.set(key, { warehouseId: l.unit.warehouse_id, warehouseCode: l.unit.warehouse_code, holder: l.holder, purpose: l.purpose, lines: [] });
    groups.get(key).lines.push(l);
  }
  return [...groups.values()];
}

const unitView = (l) => ({
  line: l.line, code: l.unit.item_code, name: l.unit.item_name, serial: l.unit.serial_number, assetTag: l.unit.asset_tag,
  condition: l.unit.condition, warehouse: l.unit.warehouse_code, holderName: fullName(l.holder), holderEmail: l.holder.email,
});

async function preview(file, { userId }) {
  const { lines, errors, skipped, totalLines } = await analyze(file, { userId });
  return {
    units: lines.map(unitView),
    errors,
    summary: { totalLines, units: lines.length, issues: groupLines(lines).length, holders: new Set(lines.map(l => l.holder.id)).size, skipped, errors: errors.length },
  };
}

/** Bons de sortie écrits en une transaction ; → [{ id, issueNumber, holder, warehouse, units }] */
async function apply(file, { userId, lang }) {
  const { lines, errors, skipped, totalLines } = await analyze(file, { userId });
  if (!lines.length) throw fileError(400, 'NOTHING_TO_IMPORT', 'Aucune ligne valide', { errors });
  const T = i18n.translator(lang);
  const groups = groupLines(lines);
  const issues = await db.withTransaction(async (tx) => {
    const out = [];
    for (const g of groups) {
      const byItem = new Map();
      for (const l of g.lines) {
        if (!byItem.has(l.unit.item_id)) byItem.set(l.unit.item_id, []);
        byItem.get(l.unit.item_id).push(l.unit.id);
      }
      const result = await stockIssueModel.create({
        destinationType: 'USER', warehouseId: g.warehouseId, recipientId: g.holder.id,
        purpose: g.purpose || T('stockAssignmentImport.purpose'),
        lines: [...byItem].map(([stockItemId, unitIds]) => ({ stockItemId, unitIds })),
      }, { userId, tx, allowDamaged: true });
      out.push({ id: result.id, issueNumber: result.issueNumber, holderName: fullName(g.holder), holderEmail: g.holder.email, warehouse: g.warehouseCode, units: g.lines.length });
    }
    return out;
  });
  return { units: lines.length, issues, totalLines, skipped, errors };
}

/**
 * Modèle pré-rempli avec les équipements en stock (sinon des exemples). Colonnes lues : Code article, N° de série,
 * N° d'inventaire, Email du détenteur, Motif ; les autres (désignation, dépôt, état, détenteur relevé, notes) sont
 * informatives et ignorées à l'import (en-têtes absents des alias).
 */
async function template({ userId, lang, format = 'xlsx' }) {
  const T = i18n.translator(lang);
  const accessible = (await warehouseModel.accessibleFor(userId)).map(w => String(w.id));
  const params = [accessible];
  const units = await db.select(
    `SELECT it.code, un.serial_number, un.asset_tag, un.condition, un.notes, it.name, w.code AS warehouse_code
     FROM stock_units un JOIN stock_items it ON it.id = un.stock_item_id JOIN warehouses w ON w.id = un.warehouse_id
     WHERE un.status = 'IN_STOCK' AND un.warehouse_id::text = ANY($1::text[])${tenant.filter('un.enterprise_id', params)}
     ORDER BY w.code, it.code, un.serial_number
     LIMIT ${MAX_ROWS}`,
    params
  );
  // Email proposé : un seul utilisateur actif dont le prénom ET le nom figurent dans le détenteur relevé
  const userParams = [];
  const users = units.length ? await db.select(
    `SELECT u.email, u.first_name, u.last_name FROM users u
     WHERE u.is_active AND COALESCE(u.first_name, '') <> '' AND COALESCE(u.last_name, '') <> ''
       AND NOT EXISTS (SELECT 1 FROM user_profiles up WHERE up.user_id = u.id AND up.profile_id = 'prof_supplier')
       ${tenant.filter('u.enterprise_id', userParams)}`,
    userParams
  ) : [];
  const words = (s) => new Set(normalize(s).split(/[^a-z0-9]+/).filter(w => w.length > 1));
  const people = users.map(u => ({ email: u.email, first: [...words(u.first_name)], last: [...words(u.last_name)] }));
  const suggest = (holder) => {
    if (!holder) return '';
    const w = words(holder);
    const found = people.filter(p => p.first.length && p.last.length && p.first.every(x => w.has(x)) && p.last.every(x => w.has(x)));
    return found.length === 1 ? found[0].email : '';
  };

  const keys = ['item', 'serial', 'assetTag', 'email', 'purpose', 'name', 'warehouse', 'condition', 'holder', 'notes'];
  const headers = keys.map(k => T(`stockAssignmentImport.headers.${k}`));
  const conditionLabel = (c) => T(`stockAssignmentImport.conditions.${c}`);
  const rows = units.length
    ? units.map(u => {
      const holder = holderFromNotes(u.notes);
      return [u.code, u.serial_number, u.asset_tag || '', suggest(holder), '', u.name, u.warehouse_code, conditionLabel(u.condition), holder, u.notes || ''];
    })
    : [['EX-LAPTOP', '5CG1403NX4', '', 'jean.dupont@example.org', '', T('stockAssignmentImport.exampleName'), 'GOM-01', conditionLabel('GOOD'), 'Jean Dupont', ''],
      ['', '', 'IMA-MIHR-LAP-2022-001', 'marie.kabila@example.org', '', T('stockAssignmentImport.exampleName'), 'GOM-01', conditionLabel('GOOD'), '', '']];
  const fileName = T('stockAssignmentImport.fileName');
  if (format === 'csv') {
    const esc = (v) => { const x = String(v ?? ''); return /[";\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
    const csv = [headers, ...rows].map(r => r.map(esc).join(';')).join('\r\n');
    return { buffer: Buffer.from(`﻿${csv}\r\n`, 'utf8'), filename: `${fileName}.csv`, contentType: 'text/csv; charset=utf-8' };
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = 'procureApp';
  const ws = wb.addWorksheet(T('stockAssignmentImport.sheet'), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = keys.map((k, i) => ({ header: headers[i], key: k, width: [24, 22, 24, 30, 24, 36, 14, 12, 28, 50][i] }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 32;
  // Bleu = obligatoire (équipement, détenteur), ardoise = facultatif, gris = information (ignorée à l'import)
  const kind = (i) => (i < 4 && i !== 2 ? 'required' : i < 5 ? 'optional' : 'info');
  keys.forEach((k, i) => {
    head.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: { required: 'FF1D4ED8', optional: 'FF475569', info: 'FF9CA3AF' }[kind(i)] } };
    head.getCell(i + 1).note = T(`stockAssignmentImport.help.${k}`);
  });
  for (const r of rows) {
    const row = ws.addRow(r);
    if (!units.length) row.font = { italic: true, color: { argb: 'FF6B7280' } };
    for (let c = 6; c <= keys.length; c++) row.getCell(c).font = { color: { argb: 'FF6B7280' } };
  }
  const help = wb.addWorksheet(T('stockAssignmentImport.helpSheet'));
  help.columns = [{ header: T('stockUnitImport.ref.column'), width: 30 }, { header: T('stockUnitImport.ref.required'), width: 18 }, { header: T('stockUnitImport.ref.description'), width: 100 }];
  help.getRow(1).font = { bold: true };
  keys.forEach((k, i) => {
    const status = { required: 'stockUnitImport.required', optional: 'stockUnitImport.optional', info: 'stockUnitImport.retag.ignored' }[kind(i)];
    help.addRow([headers[i], T(status), T(`stockAssignmentImport.help.${k}`)]).alignment = { wrapText: true, vertical: 'top' };
  });
  help.addRow([]);
  for (const key of ['rules1', 'rules2', 'rules3', 'rules4']) help.addRow([T(`stockAssignmentImport.${key}`)]).font = { italic: true };
  return {
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    filename: `${fileName}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

module.exports = { preview, apply, template, holderFromNotes, MAX_ROWS };
