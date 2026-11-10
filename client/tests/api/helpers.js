export const TEST_CREDS = {
  email: 'admin@procurement.com',
  password: 'Admin123!',
};

/**
 * Login and return the JWT token.
 * @param {import('@playwright/test').APIRequestContext} request
 */
export async function getToken(request) {
  const res  = await request.post('/api/auth/login', { data: TEST_CREDS });
  const body = await res.json();
  const token = body.data?.token || body.token;
  if (!token) throw new Error(`Login failed: ${JSON.stringify(body)}`);
  // Chaque projet a un chef de projet (l'approbateur des tests) : sans lui, aucune réquisition ne peut être soumise
  if (!ensuringProjectManagers) {
    ensuringProjectManagers = true;
    await ensureProjectManagers(request);
  }
  return token;
}
let ensuringProjectManagers = false;

/**
 * Second administrateur de l'entreprise de test, pour les approbations : la séparation des tâches interdit
 * d'approuver ce qu'on a soi-même demandé, créé ou saisi (réquisition, bon de commande, facture, paiement).
 * Créé au premier appel par l'admin principal, puis réutilisé.
 */
export const APPROVER_CREDS = {
  email: 'approver.tests@procurement.com',
  password: 'Approver123!',
};
export async function getApproverToken(request) {
  const login = async () => (await (await request.post('/api/auth/login', { data: APPROVER_CREDS })).json()).data?.token;
  let token = await login();
  if (token) return token;
  const admin = await getToken(request);
  const res = await request.post('/api/users', {
    headers: auth(admin),
    data: {
      username: 'approver_tests', email: APPROVER_CREDS.email, password: APPROVER_CREDS.password,
      firstName: 'Approbateur', lastName: 'Tests', profileIds: ['prof_admin'],
    },
  });
  if (![200, 201, 409].includes(res.status())) throw new Error(`Création de l'approbateur : ${res.status()} ${await res.text()}`);
  token = await login();
  if (!token) throw new Error('Connexion de l\'approbateur impossible');
  return token;
}

/** Identifiant de l'approbateur des tests (créé au besoin) */
export async function getApproverId(request) {
  await getApproverToken(request);
  const body = await (await request.post('/api/auth/login', { data: APPROVER_CREDS })).json();
  return body.data?.user?.id;
}

/**
 * Agent achats des tests (profil Achats sur tous les projets) : le chef de projet le désigne en approuvant une
 * réquisition (migration 58, obligatoire). Les étapes achats des tests restent faites par l'admin principal, qui
 * garde la main. Créé au premier appel, puis réutilisé.
 */
export const PROCUREMENT_AGENT_CREDS = {
  email: 'procurement.tests@procurement.com',
  password: 'Procure123!',
};
export async function getProcurementAgentToken(request) {
  const login = async () => (await (await request.post('/api/auth/login', { data: PROCUREMENT_AGENT_CREDS })).json()).data;
  let data = await login();
  if (!data?.token) {
    const admin = await getToken(request);
    const res = await request.post('/api/users', {
      headers: auth(admin),
      data: {
        username: 'procurement_tests', email: PROCUREMENT_AGENT_CREDS.email, password: PROCUREMENT_AGENT_CREDS.password,
        firstName: 'Agent', lastName: 'Achats Tests', profileIds: ['prof_procurement'], allProjectsProfileIds: ['prof_procurement'],
      },
    });
    if (![200, 201, 409].includes(res.status())) throw new Error(`Création de l'agent achats : ${res.status()} ${await res.text()}`);
    data = await login();
    if (!data?.token) throw new Error('Connexion de l\'agent achats impossible');
  }
  return data.token;
}
let procurementAgentId = null;
/** Identifiant de l'agent achats des tests (créé au besoin) */
export async function getProcurementAgentId(request) {
  if (!procurementAgentId) {
    await getProcurementAgentToken(request);
    procurementAgentId = (await (await request.post('/api/auth/login', { data: PROCUREMENT_AGENT_CREDS })).json()).data?.user?.id;
  }
  return procurementAgentId;
}
/** Variables d'approbation par le chef de projet : décision + agent achats désigné */
export async function pmApproval(request, variables = {}) {
  return { approved: true, procurementAgentId: await getProcurementAgentId(request), ...variables };
}

/**
 * Validation des réquisitions par le chef du projet (BPMN du 2026-11-06) : projet et chef de projet obligatoires,
 * chef de projet ≠ demandeur. Les tests créent leurs réquisitions avec l'admin principal : l'approbateur des tests
 * devient chef de projet de tout projet qui n'en a pas (ou dont le chef est l'admin principal). Une fois par processus.
 * → id de l'approbateur
 */
let projectManagersReady = null;
export function ensureProjectManagers(request) {
  if (!projectManagersReady) {
    projectManagersReady = (async () => {
      const admin = await getToken(request);
      const adminId = (await (await request.post('/api/auth/login', { data: TEST_CREDS })).json()).data?.user?.id;
      const approverId = await getApproverId(request);
      const projects = (await (await request.get('/api/projects', { headers: auth(admin) })).json()).data || [];
      for (const p of projects.filter(x => !x.project_manager_id || String(x.project_manager_id) === String(adminId))) {
        const res = await request.put(`/api/projects/${p.id}`, { headers: auth(admin), data: {
          name: p.name, description: p.description, status: p.status, startDate: p.start_date, endDate: p.end_date,
          isActive: p.is_active, projectManagerId: approverId,
        } });
        if (!res.ok()) throw new Error(`Chef de projet de ${p.code} : ${res.status()} ${await res.text()}`);
      }
      return approverId;
    })();
  }
  return projectManagersReady;
}

/** Returns the Authorization header object for a given token. */
export function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

// PDF minimal valide pour les documents de préqualification
export const PDF_BUFFER = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const pdf = (name) => ({ name: `${name}.pdf`, mimeType: 'application/pdf', buffer: PDF_BUFFER });

/**
 * Formulaire d'inscription fournisseur complet (multipart).
 * type : COMPANY (5 documents + RCCM / impôt / ID Nat) ou INDIVIDUAL (pièce d'identité + RIB).
 */
/**
 * Étape « Achat direct » (Activity_DirectPurchase) : fournisseur retenu + pro-forma obligatoires.
 * Dépose une pro-forma PDF sur la réquisition et renvoie les variables de complétion de la tâche.
 */
export async function directPurchaseVariables(request, token, requisitionId, supplierId) {
  const upload = await request.post('/api/upload', { headers: auth(token), multipart: {
    file: { name: 'proforma.pdf', mimeType: 'application/pdf', buffer: PDF_BUFFER },
    entity_type: 'requisition', entity_id: requisitionId,
  } });
  if (!upload.ok()) throw new Error('Pro-forma non déposée : ' + upload.status() + ' ' + (await upload.text()));
  return { supplierId, proformaAttachmentId: (await upload.json()).data.id, comment: 'Pro-forma reçue' };
}

export function supplierRegistration({ type = 'COMPANY', name, email, password = 'Secret123', locationIds, categoryIds, extra = {} }) {
  const base = {
    supplierType: type, name, email, password,
    address: 'Avenue de test 1, Goma', bankName: 'Banque Test', bankAccount: '00011-22233-44',
    locationIds: JSON.stringify(locationIds), categoryIds: JSON.stringify(categoryIds),
    doc_ID_CARD: pdf('id'), doc_RIB: pdf('rib'),
  };
  const company = type === 'COMPANY' ? {
    contactName: 'Jean Test', phone: '+243 990 000 000',
    registrationNumber: 'CD/GOM/RCCM/24-B-0001', taxId: 'A1234567X', idNat: '01-93-N12345X',
    doc_RCCM: pdf('rccm'), doc_TAX: pdf('impot'), doc_ID_NAT: pdf('idnat'),
  } : {};
  return { ...base, ...company, ...extra };
}

/** Ids de la première localisation et de la première catégorie actives */
export async function firstReferenceIds(request) {
  const locations = (await (await request.get('/api/public/locations')).json()).data;
  const categories = (await (await request.get('/api/public/market-categories')).json()).data;
  return { locationId: locations[0].id, categoryId: categories[0].id, locations, categories };
}

// ---------------------------------------------------------------------------------------------------------------
// Circuit du 2026-11-06 : validation de la réquisition par le chef de projet, N1 / N2 / N3 sur le bon de commande
// ---------------------------------------------------------------------------------------------------------------
export const PM_APPROVAL = 'Activity_ProjectManagerApproval';
export const PO_REVIEW = 'Activity_POReview';
export const PO_LEVEL_TASKS = { N1: 'Activity_POApprovalN1', N2: 'Activity_POApprovalN2', N3: 'Activity_POApprovalN3' };
export const PO_APPROVAL_KEYS = Object.values(PO_LEVEL_TASKS);

/** Étapes ouvertes du processus (vues par token) */
export async function openProcessTasks(request, token, processInstanceId) {
  const res = await request.get(`/api/tasks/process/${processInstanceId}`, { headers: auth(token) });
  if (!res.ok()) return [];
  return ((await res.json()).data || []).filter(t => t.status !== 'COMPLETED');
}

/** Attend une étape ouverte dont la clé est dans keys (relit la réquisition jusqu'à son process_instance_id) */
export async function waitForProcessTask(request, token, requisitionId, keys, timeout = 60_000) {
  const list = Array.isArray(keys) ? keys : [keys];
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const r = (await (await request.get(`/api/requisitions/${requisitionId}`, { headers: auth(token) })).json()).data;
    if (r?.process_instance_id) {
      const task = (await openProcessTasks(request, token, r.process_instance_id)).find(t => list.includes(t.taskDefinitionKey));
      if (task) return { task, requisition: r };
    }
    await new Promise(res => setTimeout(res, 1500));
  }
  return null;
}

/**
 * Révision du bon de commande (migration 52) : attend l'étape Activity_POReview de ce bon puis l'approuve (ou la rejette)
 * par POST /purchase-orders/:id/review avec token (l'approbateur des tests : ni créateur ni demandeur).
 * → réponse { status, body } ; null si l'étape n'apparaît pas (BpmnGo absent)
 */
export async function reviewPurchaseOrder(request, token, requisitionId, poId, { decision = 'APPROVE', comment = 'Révisé' } = {}) {
  const step = await waitForProcessTask(request, token, requisitionId, PO_REVIEW);
  if (!step) return null;
  const res = await request.post(`/api/purchase-orders/${poId}/review`, { headers: auth(token), data: { decision, comment } });
  return { status: res.status(), body: await res.json().catch(() => ({})), task: step.task };
}

/**
 * Réquisition validée par son chef de projet (l'approbateur des tests), méthode « source unique » justifiée, bon de
 * commande de amount, puis sa révision approuvée (review: false = s'arrêter à la révision)
 * → { po, task (étape ouverte : approbation N1 / N2 / N3 du bon, ou révision), requisition } ou null (BpmnGo absent)
 */
export async function requisitionToPurchaseOrder(request, { admin, approver, requisitionId, amount, review = true }) {
  const pm = await waitForProcessTask(request, admin, requisitionId, PM_APPROVAL);
  if (!pm) return null;
  const ok = await request.post(`/api/tasks/${pm.task.id}/complete`, { headers: auth(approver), data: { variables: await pmApproval(request, { comment: 'OK' }) } });
  if (!ok.ok()) throw new Error(`Validation du chef de projet : ${ok.status()} ${await ok.text()}`);
  const method = await waitForProcessTask(request, admin, requisitionId, 'Activity_DetermineType');
  await request.post(`/api/tasks/${method.task.id}/complete`, { headers: auth(admin), data: { variables: { procurementMethod: 'SOLE_SOURCE', justification: 'Fournisseur unique (test)' } } });
  const sole = await waitForProcessTask(request, admin, requisitionId, 'Activity_SoleSource');
  await request.post(`/api/tasks/${sole.task.id}/complete`, { headers: auth(admin), data: { variables: { comment: 'Justifiée' } } });
  await waitForProcessTask(request, admin, requisitionId, 'Activity_CreatePO');
  const supplier = (await (await request.get('/api/suppliers', { headers: auth(admin), params: { forPurchaseOrder: 1 } })).json()).data[0];
  const created = await request.post('/api/purchase-orders', { headers: auth(admin), data: {
    requisitionId, supplierId: supplier.id, currency: 'USD', totalAmount: amount,
    deliveryDate: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10),
    items: [{ description: 'Article', quantity: 1, unitPrice: amount }],
  } });
  if (!created.ok()) throw new Error(`Bon de commande : ${created.status()} ${await created.text()}`);
  const po = (await created.json()).data;
  if (!review) {
    const reviewStep = await waitForProcessTask(request, admin, requisitionId, PO_REVIEW);
    return { po, task: reviewStep?.task || null, requisition: reviewStep?.requisition || pm.requisition };
  }
  const reviewed = await reviewPurchaseOrder(request, approver, requisitionId, po.id);
  if (reviewed && reviewed.status !== 200) throw new Error(`Révision du bon : ${reviewed.status} ${JSON.stringify(reviewed.body)}`);
  const step = await waitForProcessTask(request, admin, requisitionId, [...PO_APPROVAL_KEYS, 'Activity_POApproval']);
  return { po, task: step?.task || null, requisition: step?.requisition || pm.requisition };
}

/**
 * Bon de commande créé par un test : si sa révision est ouverte (processus d'après la migration 52), l'approuve avec
 * token (l'approbateur des tests) puis attend son étape d'approbation N1 / N2 / N3. Sans révision : ne fait rien.
 */
export async function passReview(request, token, poId) {
  const po = (await (await request.get(`/api/purchase-orders/${poId}`, { headers: auth(token) })).json()).data;
  if (!po?.review_pending) return false;
  const res = await request.post(`/api/purchase-orders/${poId}/review`, { headers: auth(token), data: { decision: 'APPROVE', comment: 'Révisé' } });
  if (!res.ok()) throw new Error(`Révision du bon : ${res.status()} ${await res.text()}`);
  if (po.requisition_id) await waitForProcessTask(request, token, po.requisition_id, [...PO_APPROVAL_KEYS, 'Activity_POApproval'], 30_000);
  return true;
}
