# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests\api\flow.spec.js >> 🔄 BPMN Procurement Flow — end to end >> 6 · Soumettre le PO pour approbation (DRAFT → PO_PENDING)
- Location: tests\api\flow.spec.js:268:3

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected value: 400
Received array: [200, 201]
```

# Test source

```ts
  178 |     const body = await res.json();
  179 | 
  180 |     expect(res.status()).toBe(200);
  181 |     expect(body.data.id).toBe(requisition.id);
  182 |     // Status depends on Camunda: DRAFT/IN_PROGRESS (initial), or further along the workflow
  183 |     const VALID_STATUSES = ['DRAFT', 'IN_PROGRESS', 'PENDING', 'BUDGET_INSUFFICIENT', 'BUDGET_ADJUSTMENT', 'APPROVED'];
  184 |     expect(VALID_STATUSES).toContain(body.data.status);
  185 |     requisition = body.data;
  186 |   });
  187 | 
  188 |   // ── 3. Camunda : attendre la tâche d'approbation N1 ───────────────────────
  189 |   test('3 · [Camunda] Attendre la tâche Activity_ValidationN1_Manager', async ({ request }) => {
  190 |     if (!requisition?.process_instance_id) {
  191 |       test.skip('Camunda non disponible (process_instance_id absent)');
  192 |       return;
  193 |     }
  194 |     // If budget check failed, the process is at BudgetAdjustment — not at the approval task
  195 |     if (requisition.status === 'BUDGET_INSUFFICIENT' || requisition.status === 'BUDGET_ADJUSTMENT') {
  196 |       test.skip('Budget insuffisant — le workflow est en attente d\'ajustement budgétaire, pas d\'approbation N1');
  197 |       return;
  198 |     }
  199 | 
  200 |     approvalTask = await waitForTask(
  201 |       request,
  202 |       requisition.process_instance_id,
  203 |       'Activity_ValidationN1_Manager'
  204 |     );
  205 |     console.log(`✅  Tâche approbation trouvée: ${approvalTask.id}`);
  206 |     expect(approvalTask.taskDefinitionKey).toBe('Activity_ValidationN1_Manager');
  207 |   });
  208 | 
  209 |   // ── 4. Camunda : compléter l'approbation Manager N1 ──────────────────────
  210 |   test('4 · [Camunda] Approuver la réquisition (Manager N1)', async ({ request }) => {
  211 |     if (!approvalTask) test.skip('Tâche approbation non trouvée (step 3 skipped)');
  212 | 
  213 |     const res  = await request.post(`/api/tasks/${approvalTask.id}/complete`, {
  214 |       headers: auth(token),
  215 |       data: {
  216 |         variables: { approved: true },
  217 |         taskDefinitionKey: 'Activity_ValidationN1_Manager',
  218 |         requisitionId:     requisition.id,
  219 |         estimatedAmount:   FLOW_AMOUNT,
  220 |       }
  221 |     });
  222 |     const body = await res.json();
  223 |     expect(res.status()).toBe(200);
  224 |     expect(body.success).toBe(true);
  225 | 
  226 |     // Attendre mise à jour DB
  227 |     await new Promise(r => setTimeout(r, 2000));
  228 | 
  229 |     const reqRes  = await request.get(`/api/requisitions/${requisition.id}`, { headers: auth(token) });
  230 |     const reqBody = await reqRes.json();
  231 |     expect(reqBody.data.status).toBe('APPROVED');
  232 |     console.log(`✅  Réquisition APPROVED`);
  233 |   });
  234 | 
  235 |   // ── 5. Créer un bon de commande ────────────────────────────────────────────
  236 |   test('5 · Créer un Purchase Order', async ({ request }) => {
  237 |     if (!requisition) test.skip('Réquisition non disponible');
  238 |     if (!supplier)    test.skip('Pas de fournisseur dans la DB');
  239 | 
  240 |     const res  = await request.post('/api/purchase-orders', {
  241 |       headers: auth(token),
  242 |       data: {
  243 |         requisitionId:   requisition.id,
  244 |         supplierId:      supplier.id,
  245 |         totalAmount:     FLOW_AMOUNT,
  246 |         currency:        'USD',
  247 |         orderDate:       '2026-06-23',
  248 |         deliveryDate:    '2026-08-01',
  249 |         shippingAddress: 'WWF HQ — Test',
  250 |         items: [
  251 |           {
  252 |             description: 'Article test Playwright',
  253 |             quantity:    1,
  254 |             unitPrice:   FLOW_AMOUNT,
  255 |           }
  256 |         ]
  257 |       }
  258 |     });
  259 |     const body = await res.json();
  260 | 
  261 |     expect([200, 201], `PO create (${res.status()}): ${JSON.stringify(body)}`).toContain(res.status());
  262 |     expect(body.success, `PO create: ${JSON.stringify(body)}`).toBe(true);
  263 |     purchaseOrder = body.data;
  264 |     console.log(`✅  PO ${purchaseOrder.poNumber || purchaseOrder.po_number} créé`);
  265 |   });
  266 | 
  267 |   // ── 6. Soumettre le PO pour approbation (DRAFT → PO_PENDING) ─────────────
  268 |   test('6 · Soumettre le PO pour approbation (DRAFT → PO_PENDING)', async ({ request }) => {
  269 |     if (!purchaseOrder) test.skip('PO non créé');
  270 | 
  271 |     // Le PO est créé en DRAFT — il faut le passer en PO_PENDING avant approbation
  272 |     const res  = await request.put(`/api/purchase-orders/${purchaseOrder.id}`, {
  273 |       headers: auth(token),
  274 |       data: { status: 'PO_PENDING' }
  275 |     });
  276 |     const body = await res.json();
  277 | 
> 278 |     expect([200, 201]).toContain(res.status());
      |                        ^ Error: expect(received).toContain(expected) // indexOf
  279 |     console.log(`✅  PO soumis — statut: ${body.data?.status ?? 'PO_PENDING'}`);
  280 |   });
  281 | 
  282 |   // ── 7. Approuver le bon de commande (PO_PENDING → PO_APPROVED) ────────────
  283 |   test('7 · Approuver le Purchase Order (PO_PENDING → PO_APPROVED)', async ({ request }) => {
  284 |     if (!purchaseOrder) test.skip('PO non créé');
  285 | 
  286 |     const res  = await request.post(`/api/purchase-orders/${purchaseOrder.id}/approve`, {
  287 |       headers: auth(token),
  288 |       data: { notes: 'Approuvé par test Playwright' }
  289 |     });
  290 |     const body = await res.json();
  291 |     expect([200, 201]).toContain(res.status());
  292 | 
  293 |     // Recharger le PO pour vérifier le statut
  294 |     const poRes  = await request.get(`/api/purchase-orders/${purchaseOrder.id}`, { headers: auth(token) });
  295 |     const poBody = await poRes.json();
  296 |     console.log(`✅  PO statut final: ${poBody.data?.status}`);
  297 |     expect(poBody.data?.status).toBe('PO_APPROVED');
  298 |     purchaseOrder = poBody.data;
  299 |   });
  300 | 
  301 |   // ── 8. Créer un bon de réception (GRN) ────────────────────────────────────
  302 |   test('8 · Créer un GRN (tous les articles reçus)', async ({ request }) => {
  303 |     if (!purchaseOrder) test.skip('PO non disponible');
  304 | 
  305 |     const res  = await request.post('/api/goods-receipts', {
  306 |       headers: auth(token),
  307 |       data: {
  308 |         poId: purchaseOrder.id,
  309 |         observations: 'Tous les articles reçus en bon état — test Playwright',
  310 |         grnItems: [
  311 |           {
  312 |             item_description:  'Article test Playwright',
  313 |             quantity_ordered:  1,
  314 |             quantity_received: 1,
  315 |             quantity_accepted: 1,
  316 |             quantity_rejected: 0,
  317 |             rejection_reason:  '',
  318 |           }
  319 |         ]
  320 |       }
  321 |     });
  322 |     const body = await res.json();
  323 | 
  324 |     expect([200, 201]).toContain(res.status());
  325 |     expect(body.success, `GRN create: ${JSON.stringify(body)}`).toBe(true);
  326 |     grn = body.data;
  327 | 
  328 |     console.log(`✅  GRN ${grn.grnNumber} créé — statut: ${grn.status} | conforme: ${grn.grnCompliant}`);
  329 |     expect(grn.status).toBe('COMPLETE');
  330 |     expect(grn.grnCompliant).toBe(true);
  331 |   });
  332 | 
  333 |   // ── 9. Créer une facture (déclenche le rapprochement 3 voies) ─────────────
  334 |   test('9 · Créer une facture et vérifier le rapprochement 3 voies', async ({ request }) => {
  335 |     if (!purchaseOrder || !grn) test.skip('PO ou GRN manquant');
  336 | 
  337 |     const res  = await request.post('/api/invoices', {
  338 |       headers: auth(token),
  339 |       data: {
  340 |         poId:        purchaseOrder.id,
  341 |         grnId:       grn.id,
  342 |         invoiceDate: '2026-06-23',
  343 |         dueDate:     '2026-07-23',
  344 |         subtotal:    FLOW_AMOUNT,
  345 |         taxAmount:   0,
  346 |         totalAmount: FLOW_AMOUNT,
  347 |         currency:    'USD',
  348 |         notes:       'Facture test Playwright',
  349 |       }
  350 |     });
  351 |     const body = await res.json();
  352 | 
  353 |     expect([200, 201]).toContain(res.status());
  354 |     expect(body.success, `Invoice create: ${JSON.stringify(body)}`).toBe(true);
  355 |     invoice = body.data;
  356 | 
  357 |     console.log(`✅  Facture ${invoice.invoiceNumber} créée`);
  358 |     console.log(`    Rapprochement 3 voies: ${invoice.match_status}`);
  359 | 
  360 |     // Le rapprochement doit être MATCHED :
  361 |     //   Check 1 — montant facture ≤ PO × 1.02 ✓ (10 000 ≤ 10 200)
  362 |     //   Check 2 — GRN status = COMPLETE ✓
  363 |     expect(invoice.match_status).toBe('MATCHED');
  364 |   });
  365 | 
  366 |   // ── 10. Vérifier les détails de la facture ─────────────────────────────────
  367 |   test('10 · GET /api/invoices/:id — match_details contient les 2 checks', async ({ request }) => {
  368 |     if (!invoice) test.skip('Facture non créée');
  369 | 
  370 |     const res  = await request.get(`/api/invoices/${invoice.id}`, { headers: auth(token) });
  371 |     const body = await res.json();
  372 | 
  373 |     expect(res.status()).toBe(200);
  374 |     const data = body.data;
  375 |     expect(data.match_status).toBe('MATCHED');
  376 | 
  377 |     const checks = data.match_details?.checks;
  378 |     expect(Array.isArray(checks)).toBe(true);
```