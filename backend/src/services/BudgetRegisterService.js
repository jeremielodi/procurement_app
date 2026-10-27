// backend/src/services/BudgetRegisterService.js
// Registre budgétaire (lignes budget_allocations de l'entreprise) : liste paginée et filtrée, export Excel,
// modèle d'import (.xlsx / .csv) et import depuis Excel / CSV.
//
// Import :
//  - Plusieurs lignes peuvent porter le même code (migration 42) : une ligne existante est identifiée par la colonne
//    « ID » de l'export. Ligne du fichier AVEC ID = mise à jour de cette ligne (ID inconnu : LINE_ID_UNKNOWN) ;
//    SANS ID = toujours une nouvelle ligne, même si le code existe déjà. Projet vide = ligne sans projet.
//    Codes de ligne en majuscules (comme le formulaire).
//  - Ligne existante : mise à jour des seules cellules remplies (une cellule vide ne change rien, code et projet
//    compris) ; nouvelle ligne : « Code ligne » et « Montant alloué » obligatoires. Le montant utilisé n'est jamais importé (il est calculé par l'application) :
//    un montant alloué inférieur au montant déjà utilisé est refusé (ALLOCATED_BELOW_UTILIZED).
//  - Les colonnes de l'export (Utilisé, Disponible, Taux…) sont ignorées : un export modifié se réimporte tel quel.
//  - preview() valide sans rien écrire ; apply() relit le fichier et écrit les lignes valides en une transaction.
// Erreurs par ligne : { line, code, params } (traduites côté client, budget.import.err.<code>).
const ExcelJS = require('exceljs');
const db = require('../config/database');
const tenant = require('../utils/tenant');
const i18n = require('../i18n');
const { cellText, parseNumber, readRows, isBlankRow, dropLeadingBlankRows, mapHeader, normalize } = require('../utils/tabularImport');

const MAX_ROWS = 2000;
const CODE_RE = /^[A-Z0-9_.\-/]{1,50}$/;

// Colonnes du modèle (ordre) ; required = obligatoire pour une nouvelle ligne
const FIELDS = [
  { key: 'project', column: 'project_id' },
  { key: 'entityCode', required: true, column: 'entity_code' },
  { key: 'description', column: 'description', max: 2000 },
  { key: 'loc', column: 'loc', max: 100 },
  { key: 'fundingSource', column: 'funding_source', max: 100 },
  { key: 'subProject', column: 'sub_project', max: 100 },
  { key: 'functionCode', column: 'function_code', max: 50 },
  { key: 'activityCode', column: 'activity_code', max: 50 },
  { key: 'allocated', required: true, column: 'allocated_amount' },
  { key: 'active', column: 'is_active' },
];
// Colonnes en lecture seule ajoutées à l'export (ignorées à l'import)
const EXPORT_ONLY = ['projectName', 'utilized', 'remaining', 'rate'];
// Identifiant technique de la ligne : première colonne de l'export, relu à l'import (mise à jour de CETTE ligne)
const ID_KEY = 'id';
const ID_ALIASES = ['id', 'identifiant', 'line id', 'id ligne'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// En-têtes acceptés en plus de ceux du modèle (toutes langues : budgetImport.headers.*)
const ALIASES = {
  project: ['code projet', 'projet', 'project code', 'project'],
  entityCode: ['code ligne', 'code', 'code budgetaire', 'ligne budgetaire', 'entity code', 'budget code', 'budget line', 'line code'],
  description: ['description', 'libelle', 'intitule', 'label'],
  loc: ['loc', 'localisation', 'location', 'lieu'],
  fundingSource: ['source de financement', 'source', 'bailleur', 'funding source', 'donor'],
  subProject: ['sous-projet', 'sous projet', 'sub-project', 'sub project'],
  functionCode: ['code fonction', 'fonction', 'function code', 'function'],
  activityCode: ['code activite', 'activite', 'activity code', 'activity'],
  allocated: ['montant alloue', 'alloue', 'budget alloue', 'budget', 'montant', 'allocated amount', 'allocated', 'amount'],
  active: ['active', 'actif', 'statut', 'active line', 'is active'],
};
const TRUE = ['oui', 'o', 'yes', 'y', 'x', '1', 'vrai', 'true', 'active', 'actif'];
const FALSE = ['non', 'n', 'no', '0', 'faux', 'false', 'inactive', 'inactif', '-'];

const columnAliases = () => {
  const out = {};
  for (const { key } of FIELDS) {
    const fromLocales = i18n.LANGS.map(l => normalize(i18n.translator(l)(`budgetImport.headers.${key}`)));
    out[key] = [...new Set([...fromLocales, ...ALIASES[key]])];
  }
  const fromLocales = i18n.LANGS.map(l => normalize(i18n.translator(l)(`budgetImport.headers.${ID_KEY}`)));
  out[ID_KEY] = [...new Set([...fromLocales, ...ID_ALIASES])];
  return out;
};

const fail = (line, code, params = {}) => ({ line, code, params });
const httpError = (status, code, message, details) => Object.assign(new Error(message), { status, code, details });
const num = (v) => (v === null || v === undefined ? null : Number(v));

// ───────────────────────────── Liste ─────────────────────────────

/**
 * Filtres : search (code, description, LOC, sous-projet, fonction, projet), fundingSource, projectId, withoutProject=1,
 * status (active | inactive | all — défaut all), sort (code | project | allocated | utilized | remaining | rate), order
 */
function listWhere(filters, params) {
  let where = 'WHERE 1=1' + tenant.filter('b.enterprise_id', params);
  if (filters.search) {
    params.push(`%${String(filters.search).trim()}%`);
    const p = `$${params.length}`;
    where += ` AND (b.entity_code ILIKE ${p} OR b.description ILIKE ${p} OR b.loc ILIKE ${p} OR b.sub_project ILIKE ${p}
               OR b.function_code ILIKE ${p} OR b.activity_code ILIKE ${p} OR p.code ILIKE ${p} OR p.name ILIKE ${p})`;
  }
  if (filters.fundingSource && filters.fundingSource !== 'all') {
    params.push(filters.fundingSource);
    where += ` AND b.funding_source = $${params.length}`;
  }
  if (['1', 'true'].includes(String(filters.withoutProject))) where += ' AND b.project_id IS NULL';
  else if (filters.projectId) { params.push(filters.projectId); where += ` AND b.project_id = $${params.length}`; }
  if (filters.status === 'active') where += ' AND b.is_active = true';
  else if (filters.status === 'inactive') where += ' AND b.is_active = false';
  return where;
}

const SORTS = {
  code: 'b.entity_code', project: 'p.code', allocated: 'b.allocated_amount', utilized: 'b.utilized_amount',
  remaining: 'b.remaining_amount', rate: '(b.utilized_amount / NULLIF(b.allocated_amount, 0))', created: 'b.created_at',
};

const SELECT = `
  SELECT b.id, b.entity_code, b.loc, b.funding_source, b.sub_project, b.function_code, b.activity_code, b.description,
         b.allocated_amount::float8 AS allocated_amount, b.utilized_amount::float8 AS utilized_amount,
         b.remaining_amount::float8 AS remaining_amount, b.project_id, b.is_active, b.created_at, b.updated_at,
         p.code AS project_code, p.name AS project_name
  FROM budget_allocations b
  LEFT JOIN projects p ON p.id = b.project_id`;

async function list(filters = {}) {
  const params = [];
  const where = listWhere(filters, params);
  const sort = SORTS[filters.sort] || SORTS.code;
  const order = String(filters.order).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 20, 1), 200);
  const page = Math.max(parseInt(filters.page, 10) || 1, 1);
  const [rows, total] = await Promise.all([
    db.select(`${SELECT} ${where} ORDER BY ${sort} ${order} NULLS LAST, b.entity_code ASC, b.id
               LIMIT ${limit} OFFSET ${(page - 1) * limit}`, params),
    db.one(`SELECT COUNT(*)::int AS n,
                   COALESCE(SUM(b.allocated_amount), 0)::float8 AS allocated,
                   COALESCE(SUM(b.utilized_amount), 0)::float8 AS utilized,
                   COALESCE(SUM(b.remaining_amount), 0)::float8 AS remaining
            FROM budget_allocations b LEFT JOIN projects p ON p.id = b.project_id ${where}`, params),
  ]);
  return {
    rows,
    pagination: { page, limit, total: total.n, pages: Math.ceil(total.n / limit) },
    totals: { allocated: total.allocated, utilized: total.utilized, remaining: total.remaining },
  };
}

/** Sources de financement utilisées par l'entreprise (filtre de la liste) */
async function fundingSources() {
  const params = [];
  const rows = await db.select(
    `SELECT DISTINCT b.funding_source FROM budget_allocations b
     WHERE b.funding_source IS NOT NULL AND b.funding_source <> ''${tenant.filter('b.enterprise_id', params)}
     ORDER BY b.funding_source`, params);
  return rows.map(r => r.funding_source);
}

// ───────────────────────────── Export ─────────────────────────────

/** Excel du registre (mêmes filtres que la liste, toutes les lignes) — réimportable tel quel */
async function exportXlsx(filters, { lang }) {
  const T = i18n.translator(lang);
  const params = [];
  const where = listWhere(filters, params);
  const rows = await db.select(`${SELECT} ${where} ORDER BY p.code NULLS FIRST, b.entity_code`, params);
  const yes = T('budgetImport.yes'), no = T('budgetImport.no');

  const wb = new ExcelJS.Workbook();
  wb.creator = 'procureApp';
  const ws = wb.addWorksheet(T('budgetImport.sheets.lines'), { views: [{ state: 'frozen', ySplit: 1 }] });
  const keys = [ID_KEY, ...FIELDS.map(f => f.key), ...EXPORT_ONLY];
  ws.columns = keys.map(k => ({
    header: T(`budgetImport.headers.${k}`), key: k,
    width: k === ID_KEY ? 38 : ['description', 'projectName'].includes(k) ? 40 : ['allocated', 'utilized', 'remaining'].includes(k) ? 18 : 16,
  }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 30;
  keys.forEach((k, i) => {
    head.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXPORT_ONLY.includes(k) || k === ID_KEY ? 'FF64748B' : 'FF1D4ED8' } };
    if (k === ID_KEY) head.getCell(i + 1).note = T('budgetImport.help.id');
  });
  for (const r of rows) {
    const allocated = num(r.allocated_amount) || 0;
    const utilized = num(r.utilized_amount) || 0;
    ws.addRow({
      id: r.id,
      project: r.project_code || '', entityCode: r.entity_code, description: r.description || '', loc: r.loc || '',
      fundingSource: r.funding_source || '', subProject: r.sub_project || '', functionCode: r.function_code || '', activityCode: r.activity_code || '',
      allocated, active: r.is_active ? yes : no,
      projectName: r.project_name || '', utilized, remaining: num(r.remaining_amount) || 0,
      rate: allocated > 0 ? utilized / allocated : null,
    });
  }
  for (const k of ['allocated', 'utilized', 'remaining']) ws.getColumn(k).numFmt = '#,##0.00';
  ws.getColumn('rate').numFmt = '0.0%';
  if (rows.length) {
    const total = ws.addRow({
      entityCode: T('budgetImport.total'),
      allocated: rows.reduce((s, r) => s + (num(r.allocated_amount) || 0), 0),
      utilized: rows.reduce((s, r) => s + (num(r.utilized_amount) || 0), 0),
      remaining: rows.reduce((s, r) => s + (num(r.remaining_amount) || 0), 0),
    });
    total.font = { bold: true };
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: keys.length } };

  const info = wb.addWorksheet(T('budgetImport.sheets.help'));
  info.columns = [{ width: 110 }];
  for (const key of ['exportNote1', 'exportNote2']) info.addRow([T(`budgetImport.${key}`)]).alignment = { wrapText: true };

  const stamp = new Date().toISOString().slice(0, 10);
  return {
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    filename: `${T('budgetImport.exportFileName')}_${stamp}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    count: rows.length,
  };
}

// ───────────────────────────── Import ─────────────────────────────

async function loadContext() {
  const enterpriseId = tenant.enterpriseId();
  const pParams = [];
  const bParams = [];
  const [projects, lines] = await Promise.all([
    db.select(`SELECT p.id, p.code, p.name FROM projects p WHERE 1=1${tenant.filter('p.enterprise_id', pParams)}`, pParams),
    db.select(`SELECT b.id, b.entity_code, b.project_id, b.loc, b.funding_source, b.sub_project, b.function_code, b.activity_code, b.description,
                      b.allocated_amount::float8 AS allocated_amount, b.utilized_amount::float8 AS utilized_amount, b.is_active
               FROM budget_allocations b WHERE 1=1${tenant.filter('b.enterprise_id', bParams)}`, bParams),
  ]);
  return {
    enterpriseId,
    projectBy: new Map(projects.map(p => [String(p.code).toUpperCase(), p])),
    projectById: new Map(projects.map(p => [p.id, p])),
    lineById: new Map(lines.map(l => [String(l.id).toLowerCase(), l])),
  };
}

/** Lit et valide le fichier → { lines: [{ line, action, id, fields, … }], errors, totalLines } */
async function analyze(file) {
  let rows;
  try {
    rows = await readRows(file);
  } catch (e) {
    throw httpError(400, 'UNREADABLE', 'Fichier illisible : vérifiez qu\'il s\'agit bien d\'un .xlsx ou .csv');
  }
  dropLeadingBlankRows(rows);
  if (rows.length < 2) throw httpError(400, 'EMPTY', 'Le fichier ne contient aucune ligne budgétaire');
  const col = mapHeader(rows[0], columnAliases());
  // « Code ligne » obligatoire, sauf fichier de mise à jour (colonne ID) : le code est alors facultatif
  const missing = col[ID_KEY] === undefined ? ['entityCode'].filter(k => col[k] === undefined) : [];
  if (missing.length) {
    throw httpError(400, 'MISSING_COLUMNS', 'Colonne « Code ligne » introuvable : utilisez le modèle proposé dans la fenêtre d\'import', { missing });
  }
  const dataRows = rows.slice(1).map((r, i) => ({ r, line: i + 2 })).filter(({ r }) => !isBlankRow(r));
  // Ligne « Total » d'un export : ignorée
  const totalLabels = i18n.LANGS.map(l => normalize(i18n.translator(l)('budgetImport.total')));
  const usable = dataRows.filter(({ r }) => col.entityCode === undefined || !totalLabels.includes(normalize(cellText(r[col.entityCode]))));
  if (usable.length > MAX_ROWS) throw httpError(400, 'TOO_MANY_ROWS', `Maximum ${MAX_ROWS} lignes par import`, { max: MAX_ROWS });

  const ctx = await loadContext();
  const raw = (r, key) => (col[key] === undefined ? '' : r[col[key]]);
  const text = (r, key) => cellText(raw(r, key)).trim();
  const lines = [];
  const errors = [];
  const seen = new Map();

  for (const { r, line } of usable) {
    const problems = [];
    // Ligne existante : seulement par son ID (le code n'est pas unique)
    const idText = text(r, ID_KEY).toLowerCase();
    let existing = null;
    if (idText) {
      existing = UUID_RE.test(idText) ? ctx.lineById.get(idText) || null : null;
      if (!existing) { errors.push(fail(line, 'LINE_ID_UNKNOWN', { value: text(r, ID_KEY) })); continue; }
      if (seen.has(idText)) { errors.push(fail(line, 'DUPLICATE_ID', { line: seen.get(idText) })); continue; }
      seen.set(idText, line);
    }

    const codeCell = text(r, 'entityCode').toUpperCase();
    if (!codeCell && !existing) { errors.push(fail(line, 'CODE_REQUIRED')); continue; }
    if (codeCell && !CODE_RE.test(codeCell)) { errors.push(fail(line, 'CODE_INVALID', { value: codeCell })); continue; }
    const code = codeCell || existing.entity_code;

    // Projet : cellule vide = sans projet pour une nouvelle ligne, inchangé pour une ligne existante
    let project = existing?.project_id ? ctx.projectById.get(existing.project_id) || null : null;
    const projectCode = text(r, 'project').toUpperCase();
    if (projectCode) {
      project = ctx.projectBy.get(projectCode) || null;
      if (!project) { errors.push(fail(line, 'PROJECT_UNKNOWN', { value: projectCode })); continue; }
    }

    const given = {};
    if (codeCell) given.entity_code = codeCell;
    if (projectCode) given.project_id = project.id;
    for (const f of FIELDS.filter(x => x.max)) {
      const v = text(r, f.key);
      if (!v) continue;
      if (v.length > f.max) problems.push(fail(line, 'TOO_LONG', { column: f.key, max: f.max }));
      else given[f.column] = v;
    }
    if (text(r, 'allocated')) {
      const n = parseNumber(raw(r, 'allocated'));
      if (!(n >= 0) || !Number.isFinite(n)) problems.push(fail(line, 'AMOUNT_INVALID', { value: text(r, 'allocated') }));
      else {
        given.allocated_amount = Math.round(n * 100) / 100;
        if (existing && given.allocated_amount < (existing.utilized_amount || 0) - 0.005) {
          problems.push(fail(line, 'ALLOCATED_BELOW_UTILIZED', { utilized: existing.utilized_amount }));
        }
      }
    } else if (!existing) problems.push(fail(line, 'AMOUNT_REQUIRED'));
    const activeRaw = normalize(text(r, 'active'));
    if (activeRaw) {
      if (TRUE.includes(activeRaw)) given.is_active = true;
      else if (FALSE.includes(activeRaw)) given.is_active = false;
      else problems.push(fail(line, 'BOOL_INVALID', { column: 'active', value: text(r, 'active') }));
    }
    if (problems.length) { errors.push(...problems); continue; }

    const fields = {};
    for (const [k, v] of Object.entries(given)) {
      const before = existing?.[k];
      const same = k === 'allocated_amount' ? Math.abs((before ?? NaN) - v) < 0.005 : (before ?? null) === v;
      if (!existing || !same) fields[k] = v;
    }
    if (!existing) { delete fields.entity_code; delete fields.project_id; } // écrits à part à la création
    lines.push({
      line, id: existing?.id || null,
      action: !existing ? 'CREATE' : Object.keys(fields).length ? 'UPDATE' : 'UNCHANGED',
      fields, changed: Object.keys(fields),
      projectId: project?.id || null,
      project: project ? { code: project.code, name: project.name } : null,
      entityCode: code,
      description: given.description ?? existing?.description ?? null,
      fundingSource: given.funding_source ?? existing?.funding_source ?? null,
      allocated: given.allocated_amount ?? existing?.allocated_amount ?? null,
      previousAllocated: existing ? existing.allocated_amount : null,
      utilized: existing?.utilized_amount ?? 0,
      active: given.is_active ?? existing?.is_active ?? true,
    });
  }
  errors.sort((a, b) => a.line - b.line);
  return { enterpriseId: ctx.enterpriseId, lines, errors, totalLines: usable.length };
}

const summarize = (lines, errors, totalLines) => {
  const count = (a) => lines.filter(l => l.action === a).length;
  const created = lines.filter(l => l.action === 'CREATE').reduce((s, l) => s + (l.allocated || 0), 0);
  const delta = lines.filter(l => l.action === 'UPDATE' && l.fields.allocated_amount !== undefined)
    .reduce((s, l) => s + (l.fields.allocated_amount - (l.previousAllocated || 0)), 0);
  return {
    totalLines, create: count('CREATE'), update: count('UPDATE'), unchanged: count('UNCHANGED'), errors: errors.length,
    allocatedChange: Math.round((created + delta) * 100) / 100,
  };
};

async function preview(file) {
  const { lines, errors, totalLines } = await analyze(file);
  return {
    lines: lines.map(({ fields, id, projectId, ...rest }) => rest),
    errors,
    summary: summarize(lines, errors, totalLines),
  };
}

/** Écrit les lignes valides en une transaction → { created, updated, unchanged, skipped, changes } */
async function apply(file, { userId }) {
  const { enterpriseId, lines, errors, totalLines } = await analyze(file);
  if (!enterpriseId) throw httpError(403, 'FORBIDDEN', 'Réservé aux utilisateurs d\'une entreprise');
  const toWrite = lines.filter(l => l.action !== 'UNCHANGED');
  if (!toWrite.length) throw httpError(400, 'NOTHING_TO_IMPORT', 'Aucune ligne à créer ou à modifier', { errors });

  const changes = [];
  await db.withTransaction(async (tx) => {
    for (const l of toWrite) {
      if (l.action === 'CREATE') {
        const fields = {
          is_active: true, ...l.fields, entity_code: l.entityCode, project_id: l.projectId,
          utilized_amount: 0, enterprise_id: enterpriseId, created_by: userId,
        };
        const cols = Object.keys(fields);
        const row = await tx.one(
          `INSERT INTO budget_allocations (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
          cols.map(c => fields[c])
        );
        changes.push({ action: 'CREATE', id: row.id, code: l.entityCode, project: l.project?.code || null, allocated: l.allocated });
      } else {
        const cols = Object.keys(l.fields);
        // Montant utilisé relu sous verrou : il a pu augmenter depuis l'analyse
        const current = await tx.one('SELECT utilized_amount::float8 AS utilized FROM budget_allocations WHERE id = $1 FOR UPDATE', [l.id]);
        if (l.fields.allocated_amount !== undefined && l.fields.allocated_amount < (current?.utilized || 0) - 0.005) {
          throw httpError(409, 'ALLOCATED_BELOW_UTILIZED', `Ligne ${l.line} : montant alloué inférieur au montant déjà utilisé`, { line: l.line, utilized: current.utilized });
        }
        await tx.exec(
          `UPDATE budget_allocations SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1`,
          [l.id, ...cols.map(c => l.fields[c])]
        );
        changes.push({ action: 'UPDATE', id: l.id, code: l.entityCode, project: l.project?.code || null, changed: l.fields, previousAllocated: l.previousAllocated });
      }
    }
  });
  const s = summarize(lines, errors, totalLines);
  return { created: s.create, updated: s.update, unchanged: s.unchanged, skipped: errors.length, allocatedChange: s.allocatedChange, totalLines, errors, changes };
}

/** Modèle à remplir (.xlsx : exemples, liste des projets, mode d'emploi ; .csv : « ; » + BOM) */
async function template({ lang, format = 'xlsx' }) {
  const T = i18n.translator(lang);
  const params = [];
  const projects = await db.select(`SELECT p.code, p.name FROM projects p WHERE p.is_active${tenant.filter('p.enterprise_id', params)} ORDER BY p.code`, params);
  const prj = projects[0]?.code || 'PRJ-01';
  const yes = T('budgetImport.yes');
  const headers = FIELDS.map(f => T(`budgetImport.headers.${f.key}`));
  const examples = [
    [prj, 'EX-6110', T('budgetImport.example.travel'), 'KIN', 'EU', 'SP-01', 'F100', 'A1.1', 25000, yes],
    [prj, 'EX-6230', T('budgetImport.example.equipment'), 'GOMA', 'USAID', '', 'F200', 'A2.3', 120000, yes],
  ];

  if (format === 'csv') {
    const esc = (v) => { const s = String(v ?? ''); return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [headers, ...examples].map(r => r.map(esc).join(';')).join('\r\n');
    return { buffer: Buffer.from(`﻿${csv}\r\n`, 'utf8'), filename: `${T('budgetImport.fileName')}.csv`, contentType: 'text/csv; charset=utf-8' };
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'procureApp';
  const ws = wb.addWorksheet(T('budgetImport.sheets.lines'), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = FIELDS.map((f, i) => ({ header: headers[i], key: f.key, width: f.key === 'description' ? 40 : Math.max(16, headers[i].length + 4) }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 30;
  FIELDS.forEach((f, i) => {
    head.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f.required ? 'FF1D4ED8' : 'FF475569' } };
    head.getCell(i + 1).note = T(`budgetImport.help.${f.key}`);
  });
  examples.forEach(r => { ws.addRow(r).font = { italic: true, color: { argb: 'FF6B7280' } }; });
  ws.getColumn('allocated').numFmt = '#,##0.00';

  const ref = wb.addWorksheet(T('budgetImport.sheets.projects'));
  ref.columns = [{ header: T('budgetImport.headers.project'), width: 18 }, { header: T('budgetImport.headers.projectName'), width: 50 }, { width: 4 }, { header: T('budgetImport.headers.active'), width: 10 }];
  ref.getRow(1).font = { bold: true };
  const rowsCount = Math.max(projects.length, 2);
  for (let i = 0; i < rowsCount; i++) {
    ref.addRow([projects[i]?.code || null, projects[i]?.name || null, null, [yes, T('budgetImport.no')][i] ?? null]);
  }
  const sheetRef = `'${T('budgetImport.sheets.projects').replace(/'/g, "''")}'`;
  const colLetter = (key) => ws.getColumn(FIELDS.findIndex(f => f.key === key) + 1).letter;
  if (projects.length) {
    ws.dataValidations.add(`${colLetter('project')}2:${colLetter('project')}${MAX_ROWS + 1}`,
      { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [`${sheetRef}!$A$2:$A$${projects.length + 1}`] });
  }
  ws.dataValidations.add(`${colLetter('active')}2:${colLetter('active')}${MAX_ROWS + 1}`,
    { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [`${sheetRef}!$D$2:$D$3`] });

  const help = wb.addWorksheet(T('budgetImport.sheets.help'));
  help.columns = [{ header: T('budgetImport.ref.column'), width: 26 }, { header: T('budgetImport.ref.required'), width: 22 }, { header: T('budgetImport.ref.description'), width: 100 }];
  help.getRow(1).font = { bold: true };
  FIELDS.forEach((f, i) => {
    help.addRow([headers[i], T(f.required ? 'budgetImport.requiredNew' : 'budgetImport.optional'), T(`budgetImport.help.${f.key}`)]).alignment = { wrapText: true, vertical: 'top' };
  });
  help.addRow([]);
  for (const key of ['rules1', 'rules2', 'rules3', 'rules4']) help.addRow([T(`budgetImport.${key}`)]).font = { italic: true };

  return {
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    filename: `${T('budgetImport.fileName')}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

module.exports = { list, fundingSources, exportXlsx, preview, apply, template, MAX_ROWS };
