// backend/src/utils/stockPlanning.js
// Règles de la prévision du réapprovisionnement (migration 55) — fonctions pures, sans base de données.
//  - consommation = sorties ISSUE (employé / département), moins leurs annulations (ISSUE_REVERSAL) et les retours (RETURN)
//  - CMM (consommation moyenne mensuelle) = consommation ÷ jours où l'article était disponible × 30,4 — les jours de rupture
//    (solde ≤ 0 dans le dépôt) ne comptent pas ; au moins 30 jours au dénominateur (un article arrivé hier ne donne pas
//    une consommation mensuelle de 30 fois celle d'un jour)
//  - stock de sécurité = CMM × mois de sécurité ; minimum = CMM × (sécurité + délai de livraison) ;
//    maximum = minimum + CMM × fréquence de commande
//  - position = stock + en commande + demandé (réquisitions en cours) ; à commander = maximum − position quand position ≤ minimum
const DAYS_PER_MONTH = 30.4;
const MIN_DAYS = 30;
const DAY_MS = 86400000;
const EPS = 1e-9;

const STATUSES = ['STOCKOUT', 'BELOW_SAFETY', 'TO_ORDER', 'OVERSTOCK', 'OK', 'NO_CONSUMPTION'];
const CONSUMPTION_SIGN = { ISSUE: -1, ISSUE_REVERSAL: -1, RETURN: -1 };

const round = (n, d = 2) => Math.round((Number(n) || 0) * 10 ** d) / 10 ** d;

/** Quantité consommée par un mouvement (ISSUE = −q, donc +|q| ; annulation / retour = −q) ; 0 pour les autres types */
function consumedBy(type, quantity) {
  return CONSUMPTION_SIGN[type] ? CONSUMPTION_SIGN[type] * Number(quantity) : 0;
}

/**
 * Consommation et jours de rupture d'un article dans un dépôt sur [periodStart, now].
 * @param {object} p
 * @param {number} p.openingBalance  solde du dépôt au début de la période (tous lots / projets)
 * @param {boolean} p.hasHistoryBefore  des mouvements existent avant la période
 * @param {Array<{ at: Date|string, type: string, quantity: number, consumed?: number }>} p.movements  mouvements de la période
 * @param {Date} p.periodStart
 * @param {Date} [p.now]
 */
function consumptionStats({ openingBalance = 0, hasHistoryBefore = false, movements = [], periodStart, now = new Date() }) {
  const end = new Date(now).getTime();
  const sorted = [...movements].sort((a, b) => new Date(a.at) - new Date(b.at));
  if (!hasHistoryBefore && !sorted.length) {
    return { consumption: 0, observedDays: 0, stockoutDays: 0, availableDays: 0, amc: 0 };
  }
  // Observation : depuis le début de la période, ou depuis le premier mouvement si l'article est arrivé ensuite
  let cursor = hasHistoryBefore ? new Date(periodStart).getTime() : new Date(sorted[0].at).getTime();
  const start = cursor;
  let balance = hasHistoryBefore ? Number(openingBalance) || 0 : 0;
  let stockoutMs = 0;
  let consumption = 0;
  for (const m of sorted) {
    const at = Math.min(Math.max(new Date(m.at).getTime(), cursor), end);
    if (balance <= EPS) stockoutMs += at - cursor;
    balance += Number(m.quantity) || 0;
    // consumed : consommation imposée (retour rendu dans un autre dépôt que celui de la sortie — voir StockPlanningService)
    consumption += m.consumed ?? consumedBy(m.type, m.quantity);
    cursor = at;
  }
  if (balance <= EPS) stockoutMs += end - cursor;
  const observedDays = Math.max(end - start, 0) / DAY_MS;
  const stockoutDays = Math.min(stockoutMs / DAY_MS, observedDays);
  const availableDays = Math.max(observedDays - stockoutDays, 0);
  consumption = Math.max(consumption, 0);
  const amc = consumption > EPS ? consumption / Math.max(availableDays, MIN_DAYS) * DAYS_PER_MONTH : 0;
  return {
    consumption: round(consumption, 4), observedDays: round(observedDays, 1), stockoutDays: round(stockoutDays, 1),
    availableDays: round(availableDays, 1), amc: round(amc, 2),
  };
}

/** Quantité à commander, état et mois de stock à partir des seuils (dépôt ou total de l'entreprise) */
function classify({ amc, stock, safetyStock, minStock, maxStock, position }) {
  const toOrder = amc > EPS && position <= minStock + EPS ? Math.max(Math.ceil(maxStock - position - EPS), 0) : 0;
  let status;
  if (amc <= EPS) status = 'NO_CONSUMPTION';
  else if (stock <= EPS) status = 'STOCKOUT';
  else if (stock < safetyStock - EPS) status = 'BELOW_SAFETY';
  else if (toOrder > 0) status = 'TO_ORDER';
  else if (stock > maxStock + EPS) status = 'OVERSTOCK';
  else status = 'OK';
  return {
    safetyStock: round(safetyStock), minStock: round(minStock), maxStock: round(maxStock), position: round(position, 4),
    toOrder, status, monthsOfStock: amc > EPS ? round(stock / amc, 1) : null,
  };
}

/**
 * Seuils, quantité à commander et état d'un article dans un dépôt.
 * @param {object} p { amc, stock, onOrder, requested, safetyMonths, leadTimeDays, intervalMonths }
 */
function planRow({ amc, stock, onOrder = 0, requested = 0, safetyMonths, leadTimeDays, intervalMonths }) {
  const safety = Number(safetyMonths) || 0;
  const minStock = amc * (safety + (Number(leadTimeDays) || 0) / DAYS_PER_MONTH);
  return classify({
    amc, stock: Number(stock) || 0, safetyStock: amc * safety, minStock, maxStock: minStock + amc * (Number(intervalMonths) || 0),
    position: (Number(stock) || 0) + (Number(onOrder) || 0) + (Number(requested) || 0),
  });
}

/**
 * Article sans consommation connue (total de l'entreprise) : repli sur le stock minimum du catalogue.
 * À commander = quantité de réapprovisionnement, sinon de quoi remonter à 2 × le minimum (comme l'ancien bouton).
 */
function fallbackRow({ stock, onOrder = 0, requested = 0, minQuantity, reorderQuantity }) {
  const min = Number(minQuantity);
  const position = (Number(stock) || 0) + (Number(onOrder) || 0) + (Number(requested) || 0);
  if (minQuantity === null || minQuantity === undefined || !(min > 0)) return null;
  const toOrder = position < min - EPS
    ? Math.max(Math.ceil(reorderQuantity ? Number(reorderQuantity) : 2 * min - position), 1)
    : 0;
  const status = stock <= EPS ? 'STOCKOUT' : toOrder > 0 ? 'TO_ORDER' : 'OK';
  return { safetyStock: null, minStock: round(min), maxStock: null, position: round(position, 4), toOrder, status, monthsOfStock: null };
}

/**
 * Total de l'entreprise pour un article : seuils = somme des seuils de ses dépôts (chacun avec son stock de sécurité),
 * position = tout le stock + tout ce qui est en commande ou demandé (même sans dépôt de destination).
 */
function aggregateRow(rows, { stock, onOrder = 0, requested = 0 }) {
  const sum = (k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const amc = sum('amc');
  return {
    amc: round(amc),
    ...classify({
      amc, stock: Number(stock) || 0, safetyStock: sum('safetyStock'), minStock: sum('minStock'), maxStock: sum('maxStock'),
      position: (Number(stock) || 0) + (Number(onOrder) || 0) + (Number(requested) || 0),
    }),
  };
}

/** Paramètres valides (PUT /enterprises/current/stock-planning) — 400 STOCK_PLANNING_INVALID sinon */
function parseSettings(body = {}) {
  const fields = [
    ['amcMonths', 1, 24, true], ['safetyMonths', 0, 24, false], ['orderIntervalMonths', 0, 24, false], ['leadTimeDays', 0, 365, true],
  ];
  const out = {};
  for (const [key, min, max, integer] of fields) {
    const v = Number(body[key]);
    if (body[key] === undefined || body[key] === null || body[key] === '' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
      const err = new Error(`Paramètre invalide : ${key} (${min} à ${max})`);
      err.status = 400;
      err.code = 'STOCK_PLANNING_INVALID';
      err.details = { field: key, min, max };
      throw err;
    }
    out[key] = v;
  }
  return out;
}

module.exports = { DAYS_PER_MONTH, MIN_DAYS, STATUSES, consumedBy, consumptionStats, planRow, aggregateRow, fallbackRow, parseSettings, round };
