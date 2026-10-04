// backend/src/controllers/requisition/importItems.js
// Import des articles d'une réquisition depuis un fichier Excel (.xlsx) ou CSV.
// Le fichier n'est pas stocké : on renvoie un aperçu que le formulaire ajoute aux articles.
const ExcelJS = require('exceljs');
const multer = require('multer');
const path = require('path');

const MAX_ROWS = 500;

// En-têtes acceptés (comparaison sans accents ni casse)
const COLUMNS = {
  description: ['description', 'article', 'designation', 'libelle', 'item'],
  quantity: ['quantite', 'qte', 'quantity', 'qty'],
  frequency: ['frequence', 'frequency', 'freq', 'frequence (x/mois)'],
  unitPrice: ['prix unitaire', 'pu', 'prix', 'unit price', 'unit_price', 'prix unitaire (usd)'],
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.csv') return cb(null, true);
    cb(new Error('Format non supporté : utilisez un fichier .xlsx ou .csv'));
  }
}).single('file');

function handleUpload(req, res, next) {
  upload(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux (2 Mo maximum)' : err.message;
      return res.status(400).json({ success: false, message });
    }
    next();
  });
}

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
  let s = String(raw ?? '').replace(/[\s ]/g, '').replace(/[^\d,.-]/g, '');
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

function mapHeader(headerRow) {
  const map = {};
  headerRow.forEach((h, idx) => {
    const n = normalize(h);
    for (const [key, aliases] of Object.entries(COLUMNS)) {
      if (map[key] === undefined && aliases.includes(n)) map[key] = idx;
    }
  });
  return map;
}

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
    while (rows.length && rows[0].every(v => String(v ?? '').trim() === '')) rows.shift();
    if (rows.length < 2) return res.status(400).json({ success: false, message: 'Le fichier ne contient aucun article' });

    const col = mapHeader(rows[0]);
    const missing = ['description', 'quantity', 'unitPrice'].filter(k => col[k] === undefined);
    if (missing.length) {
      const labels = { description: 'Description', quantity: 'Quantité', unitPrice: 'Prix unitaire' };
      return res.status(400).json({
        success: false,
        message: `Colonnes manquantes : ${missing.map(k => labels[k]).join(', ')}. Utilisez le modèle proposé dans la fenêtre d'import.`
      });
    }

    const items = [];
    const errors = [];
    rows.slice(1).forEach((r, i) => {
      const line = i + 2; // numéro de ligne dans le fichier
      if (r.every(v => String(v ?? '').trim() === '')) return;
      const description = cellText(r[col.description]).trim();
      const quantity = parseNumber(r[col.quantity]);
      const freqRaw = col.frequency !== undefined ? r[col.frequency] : '';
      const frequency = String(freqRaw ?? '').trim() === '' ? 1 : parseNumber(freqRaw);
      const unitPrice = parseNumber(r[col.unitPrice]);

      const problems = [];
      if (!description) problems.push('description vide');
      if (!(quantity > 0)) problems.push('quantité invalide');
      if (!(frequency > 0)) problems.push('fréquence invalide');
      if (!(unitPrice >= 0)) problems.push('prix unitaire invalide');
      if (problems.length) errors.push({ line, message: problems.join(', ') });
      else items.push({ line, description, quantity, frequency, unitPrice });
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

module.exports = { handleUpload, importItems, parseCsv, parseNumber };
