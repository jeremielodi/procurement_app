// Étape 1 — jeu de données de démonstration : entreprise, utilisateurs (un par profil), projet, budget, dépôts,
// articles, fournisseur inscrit sur le portail. Réutilisable : ce qui existe déjà est repris, le reste est créé.
import { CFG, call, tokenFor, superAdminCreds, saveState, loadState, pdfBlob } from './lib.mjs';

const D = CFG.domain;
const ADMIN = { email: `admin@${D}`, firstName: 'Alice', lastName: 'Admin' };
// clé, prénom, nom, fonction, profils, profils « tous les projets »
const PEOPLE = [
  ['requester', 'Marie', 'Bahati', 'Chargée de programme', ['prof_requester'], ['prof_requester']],
  ['pm', 'Jean', 'Mukendi', 'Chef de projet Eau potable', ['prof_user'], []],
  ['procurement', 'Paul', 'Kasongo', 'Agent achats', ['prof_procurement'], ['prof_procurement']],
  ['reviewer', 'Grace', 'Nsimba', 'Réviseuse des bons de commande', ['prof_po_reviewer'], ['prof_po_reviewer']],
  ['manager', 'David', 'Lukusa', 'Responsable des opérations (N1)', ['prof_manager'], ['prof_manager']],
  ['logistic', 'Sarah', 'Amani', 'Logisticienne', ['prof_logistic'], ['prof_logistic']],
  // Le profil Magasinier seul ne donne ni la consultation du stock ni les sorties : Logistique en plus
  ['storekeeper', 'Joseph', 'Mbala', 'Magasinier', ['prof_store_keeper', 'prof_logistic'], ['prof_logistic']],
  ['finance', 'Esther', 'Ilunga', 'Comptable', ['prof_finance'], ['prof_finance']],
  ['dg', 'Patrick', 'Tshibanda', 'Directeur général', ['prof_dg'], ['prof_dg']],
];
const SUPPLIER = { name: 'Bureautique Kivu SARL', email: `ventes@bureautique-kivu.${D}` };

const list = (x) => (Array.isArray(x) ? x : x?.rows || x?.data || x?.items || []);

export async function dataset() {
  const state = loadState();
  let admin;
  try { admin = await tokenFor(ADMIN.email); } catch { admin = null; }

  if (!admin) {
    console.log('• Création de l\'entreprise', CFG.enterpriseCode);
    const sa = superAdminCreds();
    const saToken = await tokenFor(sa.email, sa.password);
    const fd = new FormData();
    Object.entries({
      name: 'Démo procureApp', code: CFG.enterpriseCode, currencyId: '1', address: 'Avenue de la Paix 12, Goma', phone: '+243 990 000 001',
      email: `contact@${D}`, website: `https://${D}`, taxId: 'A0000000D', registrationNumber: 'CD/GOM/RCCM/26-B-0001',
      adminEmail: ADMIN.email, adminPassword: CFG.password, adminFirstName: ADMIN.firstName, adminLastName: ADMIN.lastName, adminLanguage: 'fr',
    }).forEach(([k, v]) => fd.append(k, v));
    await call('POST', '/enterprises', saToken, fd);
    admin = await tokenFor(ADMIN.email);
  } else console.log('• Entreprise de démonstration existante : reprise');

  // Départements
  const depts = list(await call('GET', '/departments', admin));
  const dept = depts.find(d => d.code === 'PROG') || await call('POST', '/departments', admin, { code: 'PROG', name: 'Programmes' });
  if (!depts.some(d => d.code === 'LOG')) await call('POST', '/departments', admin, { code: 'LOG', name: 'Logistique' });

  // Utilisateurs
  const users = { admin: { email: ADMIN.email, name: `${ADMIN.firstName} ${ADMIN.lastName}` } };
  for (const [key, first, last, position, profileIds, allProjectsProfileIds] of PEOPLE) {
    const email = `${first}.${last}@${D}`.toLowerCase();
    // Compte existant (passage précédent) : repris tel quel
    let id = await call('POST', '/auth/login', null, { email, password: CFG.password }).then(r => r.user.id, () => null);
    if (!id) {
      id = (await call('POST', '/users', admin, {
        username: `${first}.${last}.${CFG.enterpriseCode}`.toLowerCase(), email, password: CFG.password, firstName: first, lastName: last,
        position, language: 'fr', department: dept.id, profileIds, allProjectsProfileIds,
      })).id;
    }
    users[key] = { id, email, name: `${first} ${last}`, position };
  }

  // Projet (chef de projet = Jean) et ligne budgétaire
  const projects = list(await call('GET', '/projects', admin));
  const project = projects.find(p => p.code === 'EAU-GOMA') || await call('POST', '/projects', admin, {
    code: 'EAU-GOMA', name: 'Eau potable Goma', description: 'Accès à l\'eau potable dans les quartiers nord de Goma',
    projectManagerId: users.pm.id, startDate: '2026-01-01', endDate: '2027-12-31', inventoryPrefix: 'EAU',
  });
  const lines = list(await call('GET', `/budget?projectId=${project.id}`, admin));
  const budget = lines.find(l => l.entity_code === 'EAU-01') || await call('POST', '/budget', admin, {
    entityCode: 'EAU-01', description: 'Fournitures et équipements de bureau', allocatedAmount: 50000, projectId: project.id,
    fundingSource: 'Bailleur A', functionCode: 'F100', activityCode: 'A1.2',
  });

  // Dépôts et accès
  const locations = await call('GET', '/public/locations');
  const goma = locations.find(l => l.code === 'GOMA') || locations[0];
  const whs = list(await call('GET', '/warehouses', admin));
  const wh = whs.find(w => w.code === 'MAG-GOMA') || await call('POST', '/warehouses', admin, { code: 'MAG-GOMA', name: 'Magasin central Goma', locationId: goma.id });
  const wh2 = whs.find(w => w.code === 'MAG-NORD') || await call('POST', '/warehouses', admin, { code: 'MAG-NORD', name: 'Magasin antenne Nord', locationId: goma.id });
  for (const w of [wh, wh2]) await call('PUT', `/warehouses/${w.id}/users`, admin, { userIds: [users.logistic.id, users.storekeeper.id] });

  // Articles du catalogue
  const cats = await call('GET', '/public/market-categories');
  const office = cats.find(c => c.code === 'OFFICE_SUPPLIES') || cats.find(c => c.is_stockable);
  const units = await call('GET', '/units', admin);
  const unit = (code) => units.find(u => u.code === code)?.id;
  const existing = list(await call('GET', '/stock-items?limit=200', admin));
  const items = {};
  for (const [k, code, name, u, extra] of [
    ['paper', 'PAP-A4', 'Ramette papier A4 80 g', 'REAM', { minQuantity: 20 }],
    ['toner', 'TON-HP', 'Cartouche toner HP 85A', 'PIECE', { minQuantity: 5 }],
    ['soap', 'SAV-01', 'Savon en barre (kit hygiène)', 'CARTON', { minQuantity: 10, trackLots: true, trackExpiry: true }],
    ['laptop', 'LAP-14', 'Ordinateur portable 14"', 'PIECE', { trackSerials: true, assetCategory: 'LAP' }],
  ]) {
    items[k] = existing.find(i => i.code === code)
      || await call('POST', '/stock-items', admin, { code, name, unitId: unit(u), categoryId: office.id, isStockable: true, ...extra });
  }
  items.units = { REAM: unit('REAM'), PIECE: unit('PIECE') };

  // Fournisseur inscrit sur le portail (il confirme la commande lui-même)
  try {
    await call('POST', '/auth/login', null, { email: SUPPLIER.email, password: CFG.password });
  } catch {
    const reg = new FormData();
    Object.entries({
      supplierType: 'COMPANY', name: SUPPLIER.name, email: SUPPLIER.email, password: CFG.password,
      address: 'Boulevard Kanyamuhanga 45, Goma', bankName: 'Banque Démo', bankAccount: '00011-22233-44', contactName: 'Claude Habimana',
      contactTitle: 'Directeur commercial', phone: '+243 990 000 777', registrationNumber: 'CD/GOM/RCCM/22-B-0457', taxId: 'A2233445K', idNat: '01-93-N55555K',
      locationIds: JSON.stringify([goma.id]), categoryIds: JSON.stringify([office.id]), language: 'fr',
    }).forEach(([k, v]) => reg.append(k, v));
    for (const d of ['ID_CARD', 'RIB', 'RCCM', 'TAX', 'ID_NAT']) reg.append(`doc_${d}`, pdfBlob(), `${d}.pdf`);
    await call('POST', '/auth/register-supplier', null, reg);
  }

  const data = { users, supplier: SUPPLIER, dept: { id: dept.id }, project: { id: project.id, code: project.code }, budget: { id: budget.id },
    wh: { id: wh.id }, wh2: { id: wh2.id }, items: Object.fromEntries(Object.entries(items).map(([k, v]) => [k, k === 'units' ? v : { id: v.id, name: v.name, code: v.code }])) };
  saveState({ ...state, dataset: data });
  console.log('✅ Jeu de données prêt :', Object.keys(users).length, 'comptes, projet', project.code);
  return data;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('1-dataset.mjs')) {
  dataset().catch(e => { console.error('❌', e.message); process.exit(1); });
}
