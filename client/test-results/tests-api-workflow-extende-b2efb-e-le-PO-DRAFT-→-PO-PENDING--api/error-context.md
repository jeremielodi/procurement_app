# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests\api\workflow-extended.spec.js >> Scénario 4 — Rejet PO (PO_PENDING → PO_REJECTED) >> S4-4 · Soumettre le PO (DRAFT → PO_PENDING)
- Location: tests\api\workflow-extended.spec.js:598:3

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected value: 400
Received array: [200, 201]
```

# Test source

```ts
  507 | 
  508 |     // Attendre mise à jour DB
  509 |     await new Promise(r => setTimeout(r, 2000));
  510 | 
  511 |     const reqRes  = await request.get(`/api/requisitions/${req.id}`, { headers: auth(sharedToken) });
  512 |     const reqBody = await reqRes.json();
  513 | 
  514 |     expect(reqBody.data.status).toBe('REJECTED');
  515 |     console.log(`✅ S3: Réquisition correctement REJECTED après rejet N1`);
  516 |   });
  517 | });
  518 | 
  519 | // ═══════════════════════════════════════════════════════════════════════════════
  520 | // SCÉNARIO 4 — Rejet PO
  521 | // Circuit : create req → (skip approval if no Camunda) → create PO →
  522 | //           PO_PENDING → POST /reject → PO_REJECTED
  523 | // ═══════════════════════════════════════════════════════════════════════════════
  524 | 
  525 | test.describe.serial('Scénario 4 — Rejet PO (PO_PENDING → PO_REJECTED)', () => {
  526 |   const AMOUNT = 10_000;
  527 | 
  528 |   let req = null;
  529 |   let po  = null;
  530 | 
  531 |   test('S4-1 · Créer la réquisition', async ({ request }) => {
  532 |     if (!sharedDept) test.skip('Pas de département disponible');
  533 | 
  534 |     req = await createRequisition(request, sharedToken, {
  535 |       title:        'PO Rejection Test',
  536 |       amount:       AMOUNT,
  537 |       budgetLineId: sharedBudgetLine?.id,
  538 |       dept:         sharedDept,
  539 |       project:      sharedProject,
  540 |     });
  541 | 
  542 |     console.log(`✅ S4: Réquisition ${req.requisition_number} créée`);
  543 |     expect(req.id).toBeTruthy();
  544 |   });
  545 | 
  546 |   test('S4-2 · [Camunda] Approbation N1 automatique ou skip si Camunda absent', async ({ request }) => {
  547 |     if (!req?.process_instance_id) {
  548 |       // Pas de Camunda — on continue quand même : on peut créer un PO
  549 |       // même si la réquisition n'est pas APPROVED (selon la config backend)
  550 |       console.log('   Camunda absent — skip approbation N1, poursuite du scénario PO');
  551 |       return;
  552 |     }
  553 |     if (req.status === 'BUDGET_INSUFFICIENT' || req.status === 'BUDGET_ADJUSTMENT') {
  554 |       test.skip('Budget insuffisant — non pertinent pour ce scénario PO');
  555 |       return;
  556 |     }
  557 | 
  558 |     const task = await waitForTask(
  559 |       request,
  560 |       sharedToken,
  561 |       req.process_instance_id,
  562 |       'Activity_ValidationN1_Manager'
  563 |     );
  564 | 
  565 |     if (!task) {
  566 |       console.log('   Tâche N1 non apparue dans le délai — poursuite sans approbation Camunda');
  567 |       return;
  568 |     }
  569 | 
  570 |     const completeRes = await request.post(`/api/tasks/${task.id}/complete`, {
  571 |       headers: auth(sharedToken),
  572 |       data: {
  573 |         variables:         { approved: true },
  574 |         taskDefinitionKey: 'Activity_ValidationN1_Manager',
  575 |         requisitionId:     req.id,
  576 |         estimatedAmount:   AMOUNT,
  577 |       },
  578 |     });
  579 |     expect(completeRes.status()).toBe(200);
  580 |     await new Promise(r => setTimeout(r, 2000));
  581 |     console.log(`✅ S4: Réquisition approuvée N1`);
  582 |   });
  583 | 
  584 |   test('S4-3 · Créer le PO', async ({ request }) => {
  585 |     if (!req)           test.skip('Réquisition S4 non créée');
  586 |     if (!sharedSupplier) test.skip('Pas de fournisseur disponible');
  587 | 
  588 |     po = await createPO(request, sharedToken, {
  589 |       requisitionId: req.id,
  590 |       supplierId:    sharedSupplier.id,
  591 |       amount:        AMOUNT,
  592 |     });
  593 | 
  594 |     console.log(`✅ S4: PO ${po.poNumber || po.po_number} créé`);
  595 |     expect(po.id).toBeTruthy();
  596 |   });
  597 | 
  598 |   test('S4-4 · Soumettre le PO (DRAFT → PO_PENDING)', async ({ request }) => {
  599 |     if (!po) test.skip('PO S4 non créé');
  600 | 
  601 |     const res  = await request.put(`/api/purchase-orders/${po.id}`, {
  602 |       headers: auth(sharedToken),
  603 |       data: { status: 'PO_PENDING' },
  604 |     });
  605 |     const body = await res.json();
  606 | 
> 607 |     expect([200, 201]).toContain(res.status());
      |                        ^ Error: expect(received).toContain(expected) // indexOf
  608 |     console.log(`✅ S4: PO soumis — statut: ${body.data?.status ?? 'PO_PENDING'}`);
  609 |   });
  610 | 
  611 |   test('S4-5 · Rejeter le PO (POST /reject → PO_REJECTED)', async ({ request }) => {
  612 |     if (!po) test.skip('PO S4 non créé');
  613 | 
  614 |     const res  = await request.post(`/api/purchase-orders/${po.id}/reject`, {
  615 |       headers: auth(sharedToken),
  616 |       data: { reason: 'Rejeté par test Playwright — scénario 4' },
  617 |     });
  618 |     const body = await res.json();
  619 | 
  620 |     expect([200, 201], `PO reject: ${JSON.stringify(body)}`).toContain(res.status());
  621 |     expect(body.success, `PO reject success: ${JSON.stringify(body)}`).toBe(true);
  622 | 
  623 |     // Recharger le PO pour vérifier le statut
  624 |     const poRes  = await request.get(`/api/purchase-orders/${po.id}`, { headers: auth(sharedToken) });
  625 |     const poBody = await poRes.json();
  626 | 
  627 |     expect(poBody.data?.status).toBe('PO_REJECTED');
  628 |     console.log(`✅ S4: PO correctement PO_REJECTED`);
  629 |   });
  630 | });
  631 | 
  632 | // ═══════════════════════════════════════════════════════════════════════════════
  633 | // SCÉNARIO 5 — Budget insuffisant
  634 | // Circuit : create req SANS budgetLineId → Camunda check_budget échoue →
  635 | //           statut BUDGET_INSUFFICIENT
  636 | // ═══════════════════════════════════════════════════════════════════════════════
  637 | 
  638 | test.describe.serial('Scénario 5 — Budget insuffisant (item sans budgetLineId)', () => {
  639 |   const AMOUNT = 20_000;
  640 | 
  641 |   let req = null;
  642 | 
  643 |   test('S5-1 · Créer la réquisition SANS budgetLineId', async ({ request }) => {
  644 |     if (!sharedDept) test.skip('Pas de département disponible');
  645 | 
  646 |     // Création délibérément sans budgetLineId pour déclencher BUDGET_INSUFFICIENT
  647 |     const res = await request.post('/api/requisitions', {
  648 |       headers: auth(sharedToken),
  649 |       data: {
  650 |         title:           `[TEST EXT] Budget Insufficient Test — ${Date.now()}`,
  651 |         description:     'Test automatisé — budget insuffisant',
  652 |         departmentId:    sharedDept.id,
  653 |         projectId:       sharedProject?.id,
  654 |         estimatedAmount: AMOUNT,
  655 |         currencyId:      1,
  656 |         currencyCode:    'USD',
  657 |         priority:        'MEDIUM',
  658 |         justification:   'Test budget insuffisant',
  659 |         items: [
  660 |           {
  661 |             description: 'Article sans ligne budgétaire',
  662 |             quantity:    1,
  663 |             frequency:   1,
  664 |             unitPrice:   AMOUNT,
  665 |             // budgetLineId intentionnellement absent
  666 |           },
  667 |         ],
  668 |       },
  669 |     });
  670 |     const body = await res.json();
  671 | 
  672 |     expect(res.status(), `Réquisition create: ${JSON.stringify(body)}`).toBe(201);
  673 |     expect(body.success).toBe(true);
  674 |     req = body.data;
  675 | 
  676 |     console.log(`✅ S5: Réquisition ${req.requisition_number} créée sans budgetLineId`);
  677 |     console.log(`   process_instance_id: ${req.process_instance_id ?? '—'}`);
  678 |     expect(req.id).toBeTruthy();
  679 |   });
  680 | 
  681 |   test('S5-2 · [Camunda] Attendre le statut BUDGET_INSUFFICIENT (max 15 s)', async ({ request }) => {
  682 |     if (!req) test.skip('Réquisition S5 non créée');
  683 |     if (!req.process_instance_id) {
  684 |       // Sans Camunda, vérifier si le backend met directement le statut
  685 |       const res  = await request.get(`/api/requisitions/${req.id}`, { headers: auth(sharedToken) });
  686 |       const body = await res.json();
  687 |       // Si la validation est synchrone, le statut pourrait déjà être BUDGET_INSUFFICIENT
  688 |       if (body.data?.status === 'BUDGET_INSUFFICIENT') {
  689 |         console.log(`✅ S5: Statut BUDGET_INSUFFICIENT confirmé (validation synchrone)`);
  690 |         return;
  691 |       }
  692 |       test.skip('Camunda non disponible — impossible de vérifier BUDGET_INSUFFICIENT via worker');
  693 |       return;
  694 |     }
  695 | 
  696 |     const updated = await waitForRequisitionStatus(
  697 |       request,
  698 |       sharedToken,
  699 |       req.id,
  700 |       ['BUDGET_INSUFFICIENT', 'BUDGET_ADJUSTMENT'],
  701 |       STATUS_POLL_TIMEOUT
  702 |     );
  703 | 
  704 |     if (!updated) {
  705 |       // Peut arriver si le worker check_budget n'a pas encore tourné
  706 |       const res  = await request.get(`/api/requisitions/${req.id}`, { headers: auth(sharedToken) });
  707 |       const body = await res.json();
```