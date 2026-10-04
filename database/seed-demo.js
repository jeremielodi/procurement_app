// Données de démonstration (FR) — créées via l'API pour passer par les mêmes validations que l'UI.
// Usage : node database/seed-demo.js   (API_URL, ADMIN_EMAIL, ADMIN_PASSWORD, DEMO_PASSWORD optionnels)
// Idempotent : les éléments déjà présents (email, code) sont ignorés.

const API = process.env.API_URL || 'http://localhost:5000/api';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@procurement.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin123!';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo123!';

let token;

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(`${method} ${path} → ${res.status} ${json.message || json.error || ''}`);
  }
  return json.data;
}

// Un utilisateur par profil (email : jeremielodi+<key>@gmail.com)
const USERS = [
  { key: 'admin',       firstName: 'Christian', lastName: 'Mutombo',  department: 'DIR',  position: 'Administrateur système',        profileIds: ['prof_admin'] },
  { key: 'utilisateur', firstName: 'Ruth',      lastName: 'Kalala',   department: 'CONS', position: 'Assistante de projet',          profileIds: ['prof_user'] },
  { key: 'demandeur',   firstName: 'Amani',     lastName: 'Kabila',   department: 'CONS', position: 'Chargée de programme',          profileIds: ['prof_requester'] },
  { key: 'approbateur', firstName: 'Joël',      lastName: 'Kayembe',  department: 'CONS', position: 'Coordinateur de programme',     profileIds: ['prof_approver'] },
  { key: 'manager',     firstName: 'Patrick',   lastName: 'Mukendi',  department: 'CONS', position: 'Responsable Conservation',      profileIds: ['prof_manager'] },
  { key: 'managern2',   firstName: 'Nadine',    lastName: 'Mwamba',   department: 'CONS', position: 'Directrice des Programmes',     profileIds: ['prof_manager_n2'] },
  { key: 'finance',    firstName: 'Grâce',     lastName: 'Ilunga',   department: 'FIN',  position: 'Directrice Financière',         profileIds: ['prof_finance'] },
  { key: 'dg',         firstName: 'Jean-Marc', lastName: 'Lukusa',   department: 'DIR',  position: 'Directeur Général',             profileIds: ['prof_dg'] },
  { key: 'achat',      firstName: 'Sarah',     lastName: 'Mbuyi',    department: 'ACH',  position: 'Responsable des Achats',        profileIds: ['prof_procurement'] },
  { key: 'direction',  firstName: 'Olivier',   lastName: 'Tshibanda',department: 'DIR',  position: 'Directeur des Opérations',      profileIds: ['prof_management'] },
  { key: 'logistique', firstName: 'David',     lastName: 'Kasongo',  department: 'LOG',  position: 'Responsable Logistique',        profileIds: ['prof_logistic'] },
  { key: 'magasinier', firstName: 'Esther',    lastName: 'Ngalula',  department: 'LOG',  position: 'Magasinière',                   profileIds: ['prof_store_keeper'] },
];

const DEPARTMENTS = [
  { code: 'DIR',  name: 'Direction Générale',        description: 'Direction et pilotage stratégique',              manager: 'dg' },
  { code: 'CONS', name: 'Conservation',              description: 'Programmes de conservation de la biodiversité',  manager: 'manager' },
  { code: 'FIN',  name: 'Finance et Comptabilité',   description: 'Gestion financière, budgets et paiements',       manager: 'finance' },
  { code: 'ACH',  name: 'Achats et Approvisionnement', description: 'Passation des marchés et relations fournisseurs', manager: 'achat' },
  { code: 'LOG',  name: 'Logistique',                description: 'Réception, stockage et transport',               manager: 'logistique' },
];

const PROJECTS = [
  { code: 'PRJ-SALONGA', name: 'Protection du Parc National de la Salonga', description: 'Lutte anti-braconnage et suivi des bonobos', manager: 'manager',
    budgets: [
      { entityCode: 'SAL-EQP', loc: 'Mbandaka',  fundingSource: 'Union Européenne', subProject: 'Équipement des écogardes', functionCode: 'EQP', description: 'Équipements terrain (GPS, uniformes, tentes)', allocatedAmount: 150000 },
      { entityCode: 'SAL-FOR', loc: 'Monkoto',   fundingSource: 'Union Européenne', subProject: 'Formation',                functionCode: 'FOR', description: 'Formation des écogardes et des communautés',  allocatedAmount: 60000 },
    ] },
  { code: 'PRJ-VIRUNGA', name: 'Restauration forestière des Virunga', description: 'Reboisement et agroforesterie communautaire', manager: 'manager',
    budgets: [
      { entityCode: 'VIR-PEP', loc: 'Goma',      fundingSource: 'USAID',            subProject: 'Pépinières',               functionCode: 'PEP', description: 'Semences, plants et matériel de pépinière',    allocatedAmount: 80000 },
      { entityCode: 'VIR-VEH', loc: 'Goma',      fundingSource: 'USAID',            subProject: 'Transport',                functionCode: 'VEH', description: 'Véhicules et carburant',                        allocatedAmount: 250000 },
    ] },
  { code: 'PRJ-KIN-ADM', name: 'Fonctionnement du bureau de Kinshasa', description: 'Frais de fonctionnement et équipements de bureau', manager: 'dg',
    budgets: [
      { entityCode: 'KIN-INF', loc: 'Kinshasa',  fundingSource: 'Fonds propres WWF', subProject: 'Informatique',            functionCode: 'INF', description: 'Ordinateurs, imprimantes et licences',        allocatedAmount: 50000 },
      { entityCode: 'KIN-FOU', loc: 'Kinshasa',  fundingSource: 'Fonds propres WWF', subProject: 'Fournitures',             functionCode: 'FOU', description: 'Fournitures de bureau et consommables',       allocatedAmount: 20000 },
    ] },
];

const SUPPLIERS = [
  { name: 'Congo Équipements SARL',     registrationNumber: 'CD/KIN/RCCM/21-B-01452', taxId: 'A1234567K', email: 'jeremielodi+fournisseur1@gmail.com', phone: '+243 81 234 5678', address: '45, avenue du Commerce, Gombe, Kinshasa', website: 'https://congo-equipements.cd' },
  { name: 'Bureautique Plus',           registrationNumber: 'CD/KIN/RCCM/19-A-08831', taxId: 'A7654321B', email: 'jeremielodi+fournisseur2@gmail.com', phone: '+243 99 876 5432', address: '12, boulevard du 30 Juin, Kinshasa', website: 'https://bureautiqueplus.cd' },
  { name: 'Kivu Motors',                registrationNumber: 'CD/GOM/RCCM/18-B-00317', taxId: 'A2468013G', email: 'jeremielodi+fournisseur3@gmail.com', phone: '+243 97 112 2334', address: '8, avenue de la Paix, Goma', website: null },
  { name: 'Agro-Semences du Kivu',      registrationNumber: 'CD/GOM/RCCM/20-A-00902', taxId: 'A1357924S', email: 'jeremielodi+fournisseur4@gmail.com', phone: '+243 85 445 6677', address: 'Route de Sake, Goma', website: null },
  { name: 'Formation & Conseil Afrique', registrationNumber: 'CD/KIN/RCCM/22-B-02211', taxId: 'A9081726F', email: 'jeremielodi+fournisseur5@gmail.com', phone: '+243 82 998 1122', address: '3, avenue Kasa-Vubu, Kinshasa', website: 'https://fca-afrique.cd' },
];

async function main() {
  token = (await call('POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).token;
  console.log('✔ Connecté en tant que', ADMIN_EMAIL);

  // Utilisateurs
  const existingUsers = await call('GET', '/users?limit=1000');
  const userIds = {};
  for (const u of USERS) {
    const email = `jeremielodi+${u.key}@gmail.com`;
    const found = existingUsers.find(x => x.email === email);
    if (found) { userIds[u.key] = found.id; console.log('• utilisateur existant', email); continue; }
    const created = await call('POST', '/users', {
      username: u.key, email, password: DEMO_PASSWORD,
      firstName: u.firstName, lastName: u.lastName, department: u.department, position: u.position, profileIds: u.profileIds,
    });
    userIds[u.key] = created.id;
    console.log('✔ utilisateur', email, u.profileIds.join(','));
  }

  // Départements
  const existingDeps = await call('GET', '/departments');
  for (const d of DEPARTMENTS) {
    if (existingDeps.some(x => x.code === d.code)) { console.log('• département existant', d.code); continue; }
    await call('POST', '/departments', { code: d.code, name: d.name, description: d.description, managerId: userIds[d.manager] });
    console.log('✔ département', d.code);
  }

  // Projets, membres et lignes budgétaires
  const existingProjects = await call('GET', '/projects');
  const existingBudgets = await call('GET', '/budget');
  for (const p of PROJECTS) {
    let projectId = existingProjects.find(x => x.code === p.code)?.id;
    if (!projectId) {
      const start = '2026-01-01', end = '2027-12-31';
      projectId = (await call('POST', '/projects/', { code: p.code, name: p.name, description: p.description, startDate: start, endDate: end })).id;
      await call('PUT', `/projects/${projectId}`, { name: p.name, description: p.description, projectManagerId: userIds[p.manager], status: 'ACTIVE', startDate: start, endDate: end, isActive: true });
      console.log('✔ projet', p.code);
    } else {
      console.log('• projet existant', p.code);
    }
    for (const key of Object.keys(userIds)) {
      await call('POST', '/projects/members', { projectId, userId: userIds[key], role: key === p.manager ? 'MANAGER' : 'MEMBER' })
        .catch(() => {}); // déjà membre
    }
    for (const b of p.budgets) {
      if (existingBudgets.some(x => x.entity_code === b.entityCode && x.project_id === projectId)) { console.log('  • ligne existante', b.entityCode); continue; }
      await call('POST', '/budget', { ...b, projectId });
      console.log('  ✔ ligne budgétaire', b.entityCode, b.allocatedAmount);
    }
  }

  // Fournisseurs (préqualifiés pour apparaître dans les listes)
  const existingSuppliers = await call('GET', '/suppliers');
  for (const s of SUPPLIERS) {
    if (existingSuppliers.some(x => x.name === s.name)) { console.log('• fournisseur existant', s.name); continue; }
    await call('POST', '/suppliers', { ...s, prequalified: true });
    console.log('✔ fournisseur', s.name);
  }

  console.log(`\nTerminé. Mot de passe des comptes de démo : ${DEMO_PASSWORD}`);
}

main().catch(err => { console.error('✘', err.message); process.exit(1); });
