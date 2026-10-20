# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests\api\workflow-extended.spec.js >> Scénario 7 — Invoice mismatch 3-way (montant +5% > PO → UNMATCHED) >> S7-1 · Créer la réquisition (100 000 XAF)
- Location: tests\api\workflow-extended.spec.js:903:3

# Error details

```
"beforeAll" hook timeout of 30000ms exceeded.
```

# Test source

```ts
  106 |     if (res.ok()) {
  107 |       const body = await res.json();
  108 |       if (expectedStatuses.includes(body.data?.status)) return body.data;
  109 |     }
  110 |     await new Promise(r => setTimeout(r, POLL_INTERVAL));
  111 |   }
  112 |   return null;
  113 | }
  114 | 
  115 | /**
  116 |  * Crée une réquisition standard avec les paramètres fournis.
  117 |  * Retourne le body.data ou lance une erreur.
  118 |  */
  119 | async function createRequisition(request, token, { title, amount, budgetLineId, dept, project }) {
  120 |   const itemData = {
  121 |     description: `Article test ${title}`,
  122 |     quantity:    1,
  123 |     frequency:   1,
  124 |     unitPrice:   amount,
  125 |   };
  126 |   if (budgetLineId) itemData.budgetLineId = budgetLineId;
  127 | 
  128 |   const res = await request.post('/api/requisitions', {
  129 |     headers: auth(token),
  130 |     data: {
  131 |       title:           `[TEST EXT] ${title} — ${Date.now()}`,
  132 |       description:     `Test automatisé Playwright — ${title}`,
  133 |       departmentId:    dept.id,
  134 |       projectId:       project?.id,
  135 |       estimatedAmount: amount,
  136 |       currencyId:      1,
  137 |       currencyCode:    'USD',
  138 |       priority:        'MEDIUM',
  139 |       justification:   `Test automatisé — ${title}`,
  140 |       items: [itemData],
  141 |     },
  142 |   });
  143 |   const body = await res.json();
  144 |   if (!res.ok() || !body.success) {
  145 |     throw new Error(`Réquisition creation failed (${res.status()}): ${JSON.stringify(body)}`);
  146 |   }
  147 |   return body.data;
  148 | }
  149 | 
  150 | /**
  151 |  * Crée un PO simple lié à une réquisition.
  152 |  */
  153 | async function createPO(request, token, { requisitionId, supplierId, amount }) {
  154 |   const res = await request.post('/api/purchase-orders', {
  155 |     headers: auth(token),
  156 |     data: {
  157 |       requisitionId,
  158 |       supplierId,
  159 |       totalAmount:     amount,
  160 |       currency:        'USD',
  161 |       orderDate:       '2026-06-24',
  162 |       deliveryDate:    '2026-08-01',
  163 |       shippingAddress: 'WWF HQ — Test étendu',
  164 |       items: [
  165 |         {
  166 |           description: 'Article test étendu',
  167 |           quantity:    10,
  168 |           unitPrice:   amount / 10,
  169 |         },
  170 |       ],
  171 |     },
  172 |   });
  173 |   const body = await res.json();
  174 |   if (!res.ok() || !body.success) {
  175 |     throw new Error(`PO creation failed (${res.status()}): ${JSON.stringify(body)}`);
  176 |   }
  177 |   return body.data;
  178 | }
  179 | 
  180 | /**
  181 |  * Approuve un PO (créé directement en PO_PENDING : pas d'étape brouillon).
  182 |  * Retourne le PO mis à jour (statut PO_APPROVED).
  183 |  */
  184 | async function submitAndApprovePO(request, token, poId) {
  185 |   const current = (await (await request.get(`/api/purchase-orders/${poId}`, { headers: auth(token) })).json()).data;
  186 |   if (current?.status !== 'PO_PENDING') {
  187 |     throw new Error(`PO attendu en PO_PENDING, statut : ${current?.status}`);
  188 |   }
  189 | 
  190 |   // PO_PENDING → PO_APPROVED
  191 |   const appRes = await request.post(`/api/purchase-orders/${poId}/approve`, {
  192 |     headers: auth(approverToken),
  193 |     data: { notes: 'Approuvé par test Playwright étendu' },
  194 |   });
  195 |   if (!appRes.ok()) {
  196 |     throw new Error(`PO approve failed (${appRes.status()})`);
  197 |   }
  198 | 
  199 |   const poRes  = await request.get(`/api/purchase-orders/${poId}`, { headers: auth(token) });
  200 |   const poBody = await poRes.json();
  201 |   return poBody.data;
  202 | }
  203 | 
  204 | // ── Setup global ──────────────────────────────────────────────────────────────
  205 | 
> 206 | test.beforeAll(async ({ request }) => {
      |      ^ "beforeAll" hook timeout of 30000ms exceeded.
  207 |   // Auth
  208 |   sharedToken = await getToken(request);
  209 |   expect(sharedToken).toBeTruthy();
  210 |   approverToken = await getApproverToken(request);
  211 | 
  212 |   // Charger les données de référence
  213 |   const [deptRes, suppRes, projRes] = await Promise.all([
  214 |     request.get('/api/departments', { headers: auth(sharedToken) }),
  215 |     request.get('/api/suppliers',   { headers: auth(sharedToken) }),
  216 |     request.get('/api/projects',    { headers: auth(sharedToken) }),
  217 |   ]);
  218 | 
  219 |   const deptBody = await deptRes.json();
  220 |   const suppBody = await suppRes.json();
  221 |   const projBody = await projRes.json();
  222 | 
  223 |   sharedDept     = deptBody.data?.[0] ?? null;
  224 |   sharedSupplier = suppBody.data?.[0] ?? null;
  225 |   sharedProject  = projBody.data?.[0] ?? null;
  226 | 
  227 |   if (!sharedDept)    console.warn('⚠️  Aucun département — scénarios de réquisition seront skippés');
  228 |   if (!sharedSupplier) console.warn('⚠️  Aucun fournisseur — scénarios PO/GRN/Invoice seront skippés');
  229 |   if (!sharedProject) console.warn('⚠️  Aucun projet — budget line ne sera pas chargée');
  230 | 
  231 |   // Créer un fournisseur de test s'il n'en existe pas
  232 |   if (!sharedSupplier) {
  233 |     const createRes = await request.post('/api/suppliers', {
  234 |       headers: auth(sharedToken),
  235 |       data: {
  236 |         name:         'Fournisseur Test Playwright Extended',
  237 |         code:         'TEST-SUPP-PW-EXT',
  238 |         email:        'test-supplier-ext@playwright.test',
  239 |         phone:        '+237600000001',
  240 |         address:      'Yaoundé, Cameroun',
  241 |         country:      'Cameroun',
  242 |         prequalified: true,
  243 |       },
  244 |     });
  245 |     if (createRes.ok()) {
  246 |       const listRes  = await request.get('/api/suppliers', { headers: auth(sharedToken) });
  247 |       const listBody = await listRes.json();
  248 |       sharedSupplier = listBody.data?.[0] ?? null;
  249 |       console.log(`✅ Fournisseur créé: ${sharedSupplier?.name} (id: ${sharedSupplier?.id})`);
  250 |     } else {
  251 |       console.warn('⚠️  Impossible de créer un fournisseur');
  252 |     }
  253 |   }
  254 | 
  255 |   // Ligne budgétaire NEUVE à chaque passage : chaque exécution consomme du budget, une ligne réutilisée
  256 |   // finirait « insuffisante » et le circuit d'approbation ne démarrerait plus
  257 |   if (sharedProject) {
  258 |     const budgetRes = await request.get(`/api/budget/by-project/${sharedProject.id}`, { headers: auth(sharedToken) });
  259 |     const budgetBody = budgetRes.ok() ? await budgetRes.json() : { data: [] };
  260 |     sharedBudgetLine = null;
  261 |     const fallbackLine = budgetBody.data?.[0] ?? null;
  262 | 
  263 |     if (!sharedBudgetLine) {
  264 |       const createBudget = await request.post('/api/budget', {
  265 |         headers: auth(sharedToken),
  266 |         data: {
  267 |           entityCode:      `TEST-BL-EXT-${Date.now().toString(36)}`,
  268 |           description:     'Ligne budget test Playwright Extended',
  269 |           allocatedAmount: 5_000_000,
  270 |           projectId:       sharedProject.id,
  271 |         },
  272 |       });
  273 |       if (createBudget.ok()) {
  274 |         const bb = await createBudget.json();
  275 |         sharedBudgetLine = bb.data ?? null;
  276 |         console.log(`✅ Ligne budgétaire créée: ${sharedBudgetLine?.id}`);
  277 |       } else {
  278 |         sharedBudgetLine = fallbackLine;
  279 |         console.warn('⚠️  Impossible de créer une ligne budgétaire — ligne existante utilisée');
  280 |       }
  281 |     } else {
  282 |       console.log(`✅ Ligne budgétaire existante: ${sharedBudgetLine.id}`);
  283 |     }
  284 |   }
  285 | });
  286 | 
  287 | // ═══════════════════════════════════════════════════════════════════════════════
  288 | // SCÉNARIO 1 — Approbation N2 Finance (50 000 XAF)
  289 | // Circuit : create → check_budget → classify_procurement → ValidationN2_Finance
  290 | // ═══════════════════════════════════════════════════════════════════════════════
  291 | 
  292 | test.describe.serial('Scénario 1 — Approbation N2 Finance (50 000 XAF)', () => {
  293 |   const AMOUNT = 50_000;  // 25 000 ≤ 50 000 < 100 000 → Finance N2
  294 |   test.setTimeout(120_000); // circuit GoFlow réel (attente de tâche jusqu'à 30 s)
  295 | 
  296 |   let req          = null;
  297 |   let approvalTask = null;
  298 | 
  299 |   test('S1-1 · Créer la réquisition (50 000 XAF)', async ({ request }) => {
  300 |     if (!sharedDept) test.skip('Pas de département disponible');
  301 | 
  302 |     req = await createRequisition(request, sharedToken, {
  303 |       title:        'N2 Finance Approval Test',
  304 |       amount:       AMOUNT,
  305 |       budgetLineId: sharedBudgetLine?.id,
  306 |       dept:         sharedDept,
```