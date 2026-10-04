// backend/src/utils/tenant.js
// Contexte « entreprise courante » de la requête HTTP (multi-entreprise procureApp).
// Les modèles lisent l'entreprise ici pour filtrer leurs listes, sans changer leurs signatures.
//  - Requête d'un utilisateur d'entreprise : store = { enterpriseId: '<uuid>' }
//  - Hors requête HTTP (workers Camunda, scripts) : pas de store → pas de filtre
//  - Requête sans entreprise (ne devrait pas arriver, bloquée en amont) : filtre « aucune ligne »
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

function run(store, fn) {
  return als.run(store, fn);
}

function current() {
  return als.getStore() || null;
}

function enterpriseId() {
  return current()?.enterpriseId || null;
}

/**
 * Fragment SQL « AND <alias>.enterprise_id = $n » ajouté aux requêtes de liste.
 * @param {string} column  ex. 'r.enterprise_id'
 * @param {Array}  params  tableau des paramètres (le paramètre est ajouté)
 */
function filter(column, params) {
  const store = current();
  if (!store) return '';                       // worker / script : pas de cloisonnement
  if (!store.enterpriseId) return ' AND FALSE'; // requête HTTP sans entreprise : rien
  params.push(store.enterpriseId);
  return ` AND ${column} = $${params.length}`;
}

module.exports = { run, current, enterpriseId, filter };
