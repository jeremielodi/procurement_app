// Régénère toute la documentation « cas concret » : jeu de données → cycle d'achat → stock → pages HTML
// Usage : npm run doc:cas-concret  (voir README.md pour les variables d'environnement)
import { dataset } from './1-dataset.mjs';
import { workflow } from './2-workflow.mjs';
import { tender } from './2b-appel-offres.mjs';
import { stock } from './3-stock.mjs';

const only = process.argv[2]; // workflow | tender | stock | pages

try {
  if (only !== 'pages') { console.log('▶ 1/4 Jeu de données'); await dataset(); }
  if (!only || only === 'workflow') { console.log('▶ 2/4 Cycle d\'achat complet'); await workflow(); }
  if (!only || only === 'tender') { console.log("▶ 2b/4 Appel d'offres"); await tender(); }
  if (!only || only === 'stock') { console.log('▶ 3/4 Gestion de stock'); await stock(); }
  console.log('▶ 4/4 Pages HTML');
  await import('./4-pages.mjs');
} catch (e) {
  console.error('❌', e.message);
  process.exit(1);
}
