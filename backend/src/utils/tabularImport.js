// backend/src/utils/tabularImport.js
// Lecture d'un fichier Excel (.xlsx) ou CSV envoyé en multipart (champ « file »), sans stockage :
// import des articles d'une réquisition, import du catalogue de stock.
const ExcelJS = require('exceljs');
const multer = require('multer');
const path = require('path');

/** Middleware multer (mémoire) : .xlsx / .csv, taille maximale en Mo → 400 lisible */
function uploadHandler({ maxMb = 2 } = {}) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext === '.xlsx' || ext === '.csv') return cb(null, true);
      cb(new Error('Format non supporté : utilisez un fichier .xlsx ou .csv'));
    }
  }).single('file');

  return (req, res, next) => {
    upload(req, res, (err) => {
      if (err) {
        const message = err.code === 'LIMIT_FILE_SIZE' ? `Fichier trop volumineux (${maxMb} Mo maximum)` : err.message;
        return res.status(400).json({ success: false, message });
      }
      next();
    });
  };
}

/** Comparaison d'en-têtes : sans accents, sans casse, espaces réduits */
const normalize = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value.richText) return value.richText.map(r => r.text).join('');
    if (value.result !== undefined) return cellText(value.result);   // formule
    if (value.text !== undefined) return String(value.text);         // lien
    if (value instanceof Date) return value.toISOString().slice(0, 10);
  }
  return String(value);
}

// « 1 234,50 » / « 1,234.50 » / « 12,5 » → nombre
function parseNumber(raw) {
  if (typeof raw === 'number') return raw;
  let s = String(raw ?? '').replace(/[\s ]/g, '').replace(/[^\d,.-]/g, '');
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  return parseFloat(s);
}

// CSV : séparateur ; ou , (détecté), guillemets, BOM
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Lignes du fichier (première feuille pour un .xlsx) ; les cellules numériques restent des nombres */
async function readRows(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.csv') return parseCsv(file.buffer.toString('utf8'));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file.buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows = [];
  ws.eachRow({ includeEmpty: true }, (r) => {
    const values = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      const v = r.getCell(c).value;
      values.push(typeof v === 'number' ? v : cellText(v));
    }
    rows.push(values);
  });
  return rows;
}

const isBlankRow = (r) => r.every(v => String(v ?? '').trim() === '');

/** Retire les lignes vides du début : la première ligne restante est l'en-tête */
function dropLeadingBlankRows(rows) {
  while (rows.length && isBlankRow(rows[0])) rows.shift();
  return rows;
}

/** En-tête → { clé: index de colonne } d'après les alias normalisés de chaque clé */
function mapHeader(headerRow, columns) {
  const map = {};
  headerRow.forEach((h, idx) => {
    const n = normalize(h);
    for (const [key, aliases] of Object.entries(columns)) {
      if (map[key] === undefined && aliases.includes(n)) map[key] = idx;
    }
  });
  return map;
}

module.exports = { uploadHandler, normalize, cellText, parseNumber, parseCsv, readRows, isBlankRow, dropLeadingBlankRows, mapHeader };
