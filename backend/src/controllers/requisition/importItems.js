// backend/src/controllers/requisition/importItems.js
// Import des articles d'une réquisition depuis un fichier Excel (.xlsx) ou CSV.
// Le fichier n'est pas stocké : on renvoie un aperçu que le formulaire ajoute aux articles.
const stockItemModel = require('../../models/StockItemModel');
const { uploadHandler, cellText, parseNumber, parseCsv, readRows, isBlankRow, dropLeadingBlankRows, mapHeader } = require('../../utils/tabularImport');

const MAX_ROWS = 500;

// En-têtes acceptés (comparaison sans accents ni casse)
const COLUMNS = {
  description: ['description', 'article', 'designation', 'libelle', 'item'],
  quantity: ['quantite', 'qte', 'quantity', 'qty'],
  frequency: ['frequence', 'frequency', 'freq', 'frequence (x/mois)'],
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

      const problems = [];
      if (itemCode && !article) problems.push(`code article ${itemCode} inconnu`);
      else if (article && !article.is_active) problems.push(`article ${itemCode} désactivé`);
      if (!description && !article) problems.push('description vide');
      if (!(quantity > 0)) problems.push('quantité invalide');
      if (!(frequency > 0)) problems.push('fréquence invalide');
      if (!(unitPrice >= 0)) problems.push('prix unitaire invalide');
      if (problems.length) errors.push({ line, message: problems.join(', ') });
      else items.push({
        line, description: description || article?.name, quantity, frequency, unitPrice,
        ...(article ? { stockItemId: article.id, itemCode: article.code, itemName: article.name, unit: article.unit } : {}),
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

module.exports = { handleUpload, importItems, parseCsv, parseNumber };
