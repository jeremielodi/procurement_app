# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests\api\workflow-extended.spec.js >> Scénario 7 — Invoice mismatch 3-way (montant +5% > PO → UNMATCHED) >> S7-3 · Créer et approuver le PO (100 000 XAF)
- Location: tests\api\workflow-extended.spec.js:948:3

# Error details

```
Error: PO submit to PO_PENDING failed (400)
```

# Test source

```ts
  54  |       if (task) return task;
  55  |     }
  56  |     await new Promise(r => setTimeout(r, POLL_INTERVAL));
  57  |   }
  58  |   return null;
  59  | }
  60  | 
  61  | /**
  62  |  * Attend que la réquisition ait un des statuts attendus.
  63  |  * Retourne le dernier body.data ou null si timeout.
  64  |  */
  65  | async function waitForRequisitionStatus(request, token, reqId, expectedStatuses, timeout = STATUS_POLL_TIMEOUT) {
  66  |   const start = Date.now();
  67  |   while (Date.now() - start < timeout) {
  68  |     const res = await request.get(`/api/requisitions/${reqId}`, { headers: auth(token) });
  69  |     if (res.ok()) {
  70  |       const body = await res.json();
  71  |       if (expectedStatuses.includes(body.data?.status)) return body.data;
  72  |     }
  73  |     await new Promise(r => setTimeout(r, POLL_INTERVAL));
  74  |   }
  75  |   return null;
  76  | }
  77  | 
  78  | /**
  79  |  * Crée une réquisition standard avec les paramètres fournis.
  80  |  * Retourne le body.data ou lance une erreur.
  81  |  */
  82  | async function createRequisition(request, token, { title, amount, budgetLineId, dept, project }) {
  83  |   const itemData = {
  84  |     description: `Article test ${title}`,
  85  |     quantity:    1,
  86  |     frequency:   1,
  87  |     unitPrice:   amount,
  88  |   };
  89  |   if (budgetLineId) itemData.budgetLineId = budgetLineId;
  90  | 
  91  |   const res = await request.post('/api/requisitions', {
  92  |     headers: auth(token),
  93  |     data: {
  94  |       title:           `[TEST EXT] ${title} — ${Date.now()}`,
  95  |       description:     `Test automatisé Playwright — ${title}`,
  96  |       departmentId:    dept.id,
  97  |       projectId:       project?.id,
  98  |       estimatedAmount: amount,
  99  |       currencyId:      1,
  100 |       currencyCode:    'USD',
  101 |       priority:        'MEDIUM',
  102 |       justification:   `Test automatisé — ${title}`,
  103 |       items: [itemData],
  104 |     },
  105 |   });
  106 |   const body = await res.json();
  107 |   if (!res.ok() || !body.success) {
  108 |     throw new Error(`Réquisition creation failed (${res.status()}): ${JSON.stringify(body)}`);
  109 |   }
  110 |   return body.data;
  111 | }
  112 | 
  113 | /**
  114 |  * Crée un PO simple lié à une réquisition.
  115 |  */
  116 | async function createPO(request, token, { requisitionId, supplierId, amount }) {
  117 |   const res = await request.post('/api/purchase-orders', {
  118 |     headers: auth(token),
  119 |     data: {
  120 |       requisitionId,
  121 |       supplierId,
  122 |       totalAmount:     amount,
  123 |       currency:        'USD',
  124 |       orderDate:       '2026-06-24',
  125 |       deliveryDate:    '2026-08-01',
  126 |       shippingAddress: 'WWF HQ — Test étendu',
  127 |       items: [
  128 |         {
  129 |           description: 'Article test étendu',
  130 |           quantity:    10,
  131 |           unitPrice:   amount / 10,
  132 |         },
  133 |       ],
  134 |     },
  135 |   });
  136 |   const body = await res.json();
  137 |   if (!res.ok() || !body.success) {
  138 |     throw new Error(`PO creation failed (${res.status()}): ${JSON.stringify(body)}`);
  139 |   }
  140 |   return body.data;
  141 | }
  142 | 
  143 | /**
  144 |  * Soumet un PO au statut PO_PENDING puis l'approuve.
  145 |  * Retourne le PO mis à jour (statut PO_APPROVED).
  146 |  */
  147 | async function submitAndApprovePO(request, token, poId) {
  148 |   // DRAFT → PO_PENDING
  149 |   const pendRes = await request.put(`/api/purchase-orders/${poId}`, {
  150 |     headers: auth(token),
  151 |     data: { status: 'PO_PENDING' },
  152 |   });
  153 |   if (!pendRes.ok()) {
> 154 |     throw new Error(`PO submit to PO_PENDING failed (${pendRes.status()})`);
      |           ^ Error: PO submit to PO_PENDING failed (400)
  155 |   }
  156 | 
  157 |   // PO_PENDING → PO_APPROVED
  158 |   const appRes = await request.post(`/api/purchase-orders/${poId}/approve`, {
  159 |     headers: auth(token),
  160 |     data: { notes: 'Approuvé par test Playwright étendu' },
  161 |   });
  162 |   if (!appRes.ok()) {
  163 |     throw new Error(`PO approve failed (${appRes.status()})`);
  164 |   }
  165 | 
  166 |   const poRes  = await request.get(`/api/purchase-orders/${poId}`, { headers: auth(token) });
  167 |   const poBody = await poRes.json();
  168 |   return poBody.data;
  169 | }
  170 | 
  171 | // ── Setup global ──────────────────────────────────────────────────────────────
  172 | 
  173 | test.beforeAll(async ({ request }) => {
  174 |   // Auth
  175 |   sharedToken = await getToken(request);
  176 |   expect(sharedToken).toBeTruthy();
  177 | 
  178 |   // Charger les données de référence
  179 |   const [deptRes, suppRes, projRes] = await Promise.all([
  180 |     request.get('/api/departments', { headers: auth(sharedToken) }),
  181 |     request.get('/api/suppliers',   { headers: auth(sharedToken) }),
  182 |     request.get('/api/projects',    { headers: auth(sharedToken) }),
  183 |   ]);
  184 | 
  185 |   const deptBody = await deptRes.json();
  186 |   const suppBody = await suppRes.json();
  187 |   const projBody = await projRes.json();
  188 | 
  189 |   sharedDept     = deptBody.data?.[0] ?? null;
  190 |   sharedSupplier = suppBody.data?.[0] ?? null;
  191 |   sharedProject  = projBody.data?.[0] ?? null;
  192 | 
  193 |   if (!sharedDept)    console.warn('⚠️  Aucun département — scénarios de réquisition seront skippés');
  194 |   if (!sharedSupplier) console.warn('⚠️  Aucun fournisseur — scénarios PO/GRN/Invoice seront skippés');
  195 |   if (!sharedProject) console.warn('⚠️  Aucun projet — budget line ne sera pas chargée');
  196 | 
  197 |   // Créer un fournisseur de test s'il n'en existe pas
  198 |   if (!sharedSupplier) {
  199 |     const createRes = await request.post('/api/suppliers', {
  200 |       headers: auth(sharedToken),
  201 |       data: {
  202 |         name:         'Fournisseur Test Playwright Extended',
  203 |         code:         'TEST-SUPP-PW-EXT',
  204 |         email:        'test-supplier-ext@playwright.test',
  205 |         phone:        '+237600000001',
  206 |         address:      'Yaoundé, Cameroun',
  207 |         country:      'Cameroun',
  208 |         prequalified: true,
  209 |       },
  210 |     });
  211 |     if (createRes.ok()) {
  212 |       const listRes  = await request.get('/api/suppliers', { headers: auth(sharedToken) });
  213 |       const listBody = await listRes.json();
  214 |       sharedSupplier = listBody.data?.[0] ?? null;
  215 |       console.log(`✅ Fournisseur créé: ${sharedSupplier?.name} (id: ${sharedSupplier?.id})`);
  216 |     } else {
  217 |       console.warn('⚠️  Impossible de créer un fournisseur');
  218 |     }
  219 |   }
  220 | 
  221 |   // Charger ou créer une ligne budgétaire suffisante
  222 |   if (sharedProject) {
  223 |     const budgetRes = await request.get(`/api/budget/by-project/${sharedProject.id}`, { headers: auth(sharedToken) });
  224 |     const budgetBody = budgetRes.ok() ? await budgetRes.json() : { data: [] };
  225 |     sharedBudgetLine = budgetBody.data?.[0] ?? null;
  226 | 
  227 |     if (!sharedBudgetLine) {
  228 |       const createBudget = await request.post('/api/budget', {
  229 |         headers: auth(sharedToken),
  230 |         data: {
  231 |           entityCode:      'TEST-BL-EXT',
  232 |           description:     'Ligne budget test Playwright Extended',
  233 |           allocatedAmount: 5_000_000,
  234 |           projectId:       sharedProject.id,
  235 |         },
  236 |       });
  237 |       if (createBudget.ok()) {
  238 |         const bb = await createBudget.json();
  239 |         sharedBudgetLine = bb.data ?? null;
  240 |         console.log(`✅ Ligne budgétaire créée: ${sharedBudgetLine?.id}`);
  241 |       } else {
  242 |         console.warn('⚠️  Impossible de créer une ligne budgétaire');
  243 |       }
  244 |     } else {
  245 |       console.log(`✅ Ligne budgétaire existante: ${sharedBudgetLine.id}`);
  246 |     }
  247 |   }
  248 | });
  249 | 
  250 | // ═══════════════════════════════════════════════════════════════════════════════
  251 | // SCÉNARIO 1 — Approbation N2 Finance (50 000 XAF)
  252 | // Circuit : create → check_budget → classify_procurement → ValidationN2_Finance
  253 | // ═══════════════════════════════════════════════════════════════════════════════
  254 | 
```