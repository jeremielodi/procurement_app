import { test, expect } from '@playwright/test';
import { getToken, auth, supplierRegistration, firstReferenceIds, PDF_BUFFER } from './helpers.js';

// Questions aux fournisseurs dans un appel d'offres (migration 54) : bibliothèque de l'entreprise, questions de l'AO,
// réponses du fournisseur (contrôles, documents), offres scellées, note technique des listes de choix, gel après offre
test.describe.serial('API › Appels d\'offres — questions aux fournisseurs', () => {
  const stamp = Date.now();
  let adminToken, supplierToken, requisitionId, items, tenderId, templateId;
  let questions = [];   // questions de l'AO (vue acheteur)
  let firstFileId, secondFileId;

  const QUESTIONS = [
    { label: 'Décrivez votre expérience sur des marchés similaires', answerType: 'TEXT', required: true },
    { label: 'Êtes-vous en règle avec le fisc ?', answerType: 'YES_NO', required: true },
    { label: 'Nombre de techniciens disponibles', answerType: 'NUMBER', required: false },
    {
      label: 'Garantie proposée', answerType: 'CHOICE', required: true,
      options: [{ label: '24 mois', score: 10 }, { label: '12 mois', score: 5 }, { label: 'Aucune', score: 0 }],
    },
    { label: 'Service après-vente sur place', answerType: 'CHOICE', options: [{ label: 'Oui', score: 4 }, { label: 'Non', score: 0 }] },
    { label: 'Attestation fiscale', answerType: 'FILE', required: true, helpText: 'PDF de moins de 3 mois' },
  ];
  const q = (type, n = 0) => questions.filter(x => x.answer_type === type)[n];

  test.beforeAll(async ({ request }) => {
    adminToken = await getToken(request);
    const { locationId, categoryId } = await firstReferenceIds(request);
    const reg = await request.post('/api/auth/register-supplier', {
      multipart: supplierRegistration({
        name: `Fournisseur Questions ${stamp}`, email: `supplier.q.${stamp}@example.com`,
        locationIds: [locationId], categoryIds: [categoryId],
      }),
    });
    expect(reg.status()).toBe(201);
    supplierToken = (await reg.json()).data.token;

    const list = await (await request.get('/api/requisitions?limit=100', { headers: auth(adminToken) })).json();
    for (const r of list.data) {
      const existing = await (await request.get(`/api/tenders/by-requisition/${r.id}`, { headers: auth(adminToken) })).json();
      if (existing.data) continue;
      const detail = await (await request.get(`/api/requisitions/${r.id}`, { headers: auth(adminToken) })).json();
      if (detail.data.items?.length) { requisitionId = r.id; items = detail.data.items; break; }
    }
  });

  test('Bibliothèque : création, contrôles, modification', async ({ request }) => {
    const bad = await request.post('/api/tender-question-templates', {
      headers: auth(adminToken), data: { label: 'Délai', answerType: 'CHOICE', options: [{ label: 'Seule' }] },
    });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).code).toBe('CHOICE_OPTIONS_REQUIRED');

    const dupOpt = await request.post('/api/tender-question-templates', {
      headers: auth(adminToken), data: { label: 'Délai', answerType: 'CHOICE', options: [{ label: 'A' }, { label: 'a' }] },
    });
    expect((await dupOpt.json()).code).toBe('CHOICE_OPTION_DUPLICATE');

    const res = await request.post('/api/tender-question-templates', {
      headers: auth(adminToken),
      data: { label: `Certification ISO ${stamp}`, answerType: 'CHOICE', options: [{ label: 'ISO 9001', score: 5 }, { label: 'Aucune', score: 0 }] },
    });
    expect(res.status()).toBe(201);
    const created = (await res.json()).data;
    templateId = created.id;
    expect(created.options).toEqual([{ label: 'ISO 9001', score: 5 }, { label: 'Aucune', score: 0 }]);

    const upd = await request.put(`/api/tender-question-templates/${templateId}`, {
      headers: auth(adminToken),
      data: { label: `Certification ISO ${stamp}`, answerType: 'CHOICE', required: false, isActive: false,
        options: [{ label: 'ISO 9001', score: 6 }, { label: 'Aucune', score: 0 }] },
    });
    expect(upd.status()).toBe(200);
    expect((await upd.json()).data).toMatchObject({ required: false, is_active: false });

    const active = (await (await request.get('/api/tender-question-templates', { headers: auth(adminToken) })).json()).data;
    expect(active.some(x => x.id === templateId)).toBe(false);
    const all = (await (await request.get('/api/tender-question-templates?all=1', { headers: auth(adminToken) })).json()).data;
    expect(all.some(x => x.id === templateId)).toBe(true);
  });

  test('Création de l\'AO : question invalide = rien n\'est publié ; sinon questions enregistrées', async ({ request }) => {
    test.skip(!requisitionId, 'Aucune réquisition libre avec des items');
    const payload = {
      requisitionId, title: 'AO questions', tenderNumber: `AO-Q-${stamp}`,
      startDate: new Date(Date.now() - 60_000).toISOString(), endDate: new Date(Date.now() + 3_600_000).toISOString(),
      maxDeliveryDays: 30,
    };
    const bad = await request.post('/api/tenders', {
      headers: auth(adminToken), data: { ...payload, questions: [...QUESTIONS, { label: 'X', answerType: 'DATE' }] },
    });
    expect(bad.status()).toBe(400);
    expect((await bad.json())).toMatchObject({ code: 'QUESTION_TYPE_INVALID', details: { index: QUESTIONS.length } });
    const none = await (await request.get(`/api/tenders/by-requisition/${requisitionId}`, { headers: auth(adminToken) })).json();
    expect(none.data).toBeNull();

    const res = await request.post('/api/tenders', {
      headers: auth(adminToken), data: { ...payload, questions: [...QUESTIONS, { label: 'Certification', answerType: 'TEXT', templateId }] },
    });
    expect(res.status()).toBe(201);
    tenderId = (await res.json()).data.id;

    const detail = (await (await request.get(`/api/tenders/${tenderId}`, { headers: auth(adminToken) })).json()).data;
    questions = detail.questions;
    expect(questions.map(x => x.answer_type)).toEqual(['TEXT', 'YES_NO', 'NUMBER', 'CHOICE', 'CHOICE', 'FILE', 'TEXT']);
    expect(q('CHOICE').options[0]).toEqual({ label: '24 mois', score: 10 });
    expect(q('CHOICE', 1).required).toBe(true); // obligatoire par défaut
    expect(q('FILE').help_text).toBe('PDF de moins de 3 mois');
    expect(questions[6].template_id).toBe(templateId);
  });

  test('Fournisseur : voit les questions sans le barème', async ({ request }) => {
    test.skip(!tenderId);
    const body = (await (await request.get(`/api/supplier-portal/tenders/${tenderId}`, { headers: auth(supplierToken) })).json()).data;
    expect(body.questions).toHaveLength(7);
    expect(body.questions[3].options).toEqual([{ label: '24 mois' }, { label: '12 mois' }, { label: 'Aucune' }]);
  });

  test('Documents de réponse : question non « document », format refusé, dépôt', async ({ request }) => {
    test.skip(!tenderId);
    const url = (qid) => `/api/supplier-portal/tenders/${tenderId}/questions/${qid}/file`;
    const pdf = { name: 'attestation.pdf', mimeType: 'application/pdf', buffer: PDF_BUFFER };

    const wrong = await request.post(url(q('TEXT').id), { headers: auth(supplierToken), multipart: { file: pdf } });
    expect((await wrong.json()).code).toBe('QUESTION_NOT_FILE');

    const exe = await request.post(url(q('FILE').id), {
      headers: auth(supplierToken), multipart: { file: { name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') } },
    });
    expect(exe.status()).toBe(400);
    expect((await exe.json()).code).toBe('ANSWER_FILE_TYPE');

    const ok = await request.post(url(q('FILE').id), { headers: auth(supplierToken), multipart: { file: pdf } });
    expect(ok.status()).toBe(201);
    firstFileId = (await ok.json()).data.id;

    // Un autre compte (acheteur) ne passe pas par le portail fournisseur
    const buyer = await request.post(url(q('FILE').id), { headers: auth(adminToken), multipart: { file: pdf } });
    expect(buyer.status()).toBe(403);
  });

  const lines = () => items.map(i => ({ requisitionItemId: i.id, unitPrice: 10 }));
  const answers = (fileId, overrides = {}) => [
    { questionId: q('TEXT').id, value: 'Trois marchés similaires en 2025' },
    { questionId: q('YES_NO').id, value: 'YES' },
    { questionId: q('CHOICE').id, value: 1 },          // 12 mois → 5 points
    { questionId: q('CHOICE', 1).id, value: 0 },       // Oui → 4 points
    { questionId: q('FILE').id, fileId },
    { questionId: questions[6].id, value: 'ISO 9001' },
  ].map(a => ({ ...a, ...(overrides[a.questionId] || {}) }));

  test('Offre : réponses obligatoires, format, document d\'un autre', async ({ request }) => {
    test.skip(!tenderId);
    const submit = (data) => request.put(`/api/supplier-portal/tenders/${tenderId}/submission`, {
      headers: auth(supplierToken), data: { deliveryDays: 10, items: lines(), ...data },
    });

    const missing = await submit({ answers: [] });
    expect(missing.status()).toBe(400);
    expect((await missing.json())).toMatchObject({ code: 'ANSWER_REQUIRED', details: { questionId: q('TEXT').id } });

    const badChoice = await submit({ answers: answers(firstFileId, { [q('CHOICE').id]: { value: 7 } }) });
    expect((await badChoice.json()).code).toBe('ANSWER_INVALID');

    const badYesNo = await submit({ answers: answers(firstFileId, { [q('YES_NO').id]: { value: 'PEUT-ÊTRE' } }) });
    expect((await badYesNo.json()).code).toBe('ANSWER_INVALID');

    const badNumber = await submit({ answers: [...answers(firstFileId), { questionId: q('NUMBER').id, value: 'beaucoup' }] });
    expect((await badNumber.json()).code).toBe('ANSWER_INVALID');

    const badFile = await submit({ answers: answers(999999) });
    expect((await badFile.json()).code).toBe('ANSWER_FILE_INVALID');

    const unknown = await submit({ answers: [...answers(firstFileId), { questionId: 999999, value: 'x' }] });
    expect((await unknown.json()).code).toBe('ANSWER_UNKNOWN_QUESTION');

    const ok = await submit({ answers: [...answers(firstFileId), { questionId: q('NUMBER').id, value: '4' }] });
    expect(ok.status()).toBe(200);
    const saved = (await ok.json()).data;
    expect(saved.technical_score).toBeUndefined();
    expect(saved.answers).toHaveLength(7);
    expect(saved.answers.every(a => a.score === undefined)).toBe(true);
    expect(saved.answers.find(a => a.question_id === q('FILE').id).file_name).toBe('attestation.pdf');
  });

  test('Document remplacé : l\'ancien est supprimé à l\'envoi de l\'offre', async ({ request }) => {
    test.skip(!tenderId);
    const up = await request.post(`/api/supplier-portal/tenders/${tenderId}/questions/${q('FILE').id}/file`, {
      headers: auth(supplierToken), multipart: { file: { name: 'attestation-2.pdf', mimeType: 'application/pdf', buffer: PDF_BUFFER } },
    });
    secondFileId = (await up.json()).data.id;
    const res = await request.put(`/api/supplier-portal/tenders/${tenderId}/submission`, {
      headers: auth(supplierToken), data: { deliveryDays: 10, items: lines(), answers: answers(secondFileId) },
    });
    expect(res.status()).toBe(200);

    const old = await request.get(`/api/supplier-portal/tenders/${tenderId}/answer-files/${firstFileId}`, { headers: auth(supplierToken) });
    expect(old.status()).toBe(404);
    const current = await request.get(`/api/supplier-portal/tenders/${tenderId}/answer-files/${secondFileId}`, { headers: auth(supplierToken) });
    expect(current.status()).toBe(200);

    const pdf = await request.get(`/api/supplier-portal/tenders/${tenderId}/submission/pdf`, { headers: auth(supplierToken) });
    expect(pdf.status()).toBe(200);
  });

  test('Questions figées après la première offre ; même questionnaire accepté', async ({ request }) => {
    test.skip(!tenderId);
    const base = {
      title: 'AO questions', startDate: new Date(Date.now() - 60_000).toISOString(),
      endDate: new Date(Date.now() + 3_600_000).toISOString(), maxDeliveryDays: 30,
    };
    const same = questions.map(x => ({ label: x.label, helpText: x.help_text, answerType: x.answer_type, options: x.options, required: x.required }));
    const changed = await request.put(`/api/tenders/${tenderId}`, {
      headers: auth(adminToken), data: { ...base, questions: [...same, { label: 'Nouvelle', answerType: 'TEXT' }] },
    });
    expect(changed.status()).toBe(409);
    expect((await changed.json()).code).toBe('QUESTIONS_LOCKED');

    const unchanged = await request.put(`/api/tenders/${tenderId}`, { headers: auth(adminToken), data: { ...base, questions: same } });
    expect(unchanged.status()).toBe(200);
  });

  test('Scellé : ni réponses ni documents avant la clôture', async ({ request }) => {
    test.skip(!tenderId);
    const body = (await (await request.get(`/api/tenders/${tenderId}`, { headers: auth(adminToken) })).json()).data;
    expect(body.submissions[0].answers).toBeUndefined();
    expect(body.submissions[0].technical_score).toBeUndefined();
    const file = await request.get(`/api/tenders/${tenderId}/answer-files/${secondFileId}`, { headers: auth(adminToken) });
    expect(file.status()).toBe(403);
    expect((await file.json()).code).toBe('ANSWERS_SEALED');
  });

  test('Après la clôture : réponses, note technique, document et Excel', async ({ request }) => {
    test.skip(!tenderId);
    expect((await request.post(`/api/tenders/${tenderId}/close`, { headers: auth(adminToken) })).status()).toBe(200);

    const body = (await (await request.get(`/api/tenders/${tenderId}`, { headers: auth(adminToken) })).json()).data;
    const sub = body.submissions[0];
    // (5 + 4) / (10 + 4) × 100
    expect(parseFloat(sub.technical_score)).toBeCloseTo(64.29, 2);
    expect(sub.answers.find(a => a.question_id === q('CHOICE').id)).toMatchObject({ value: '1', score: 5 });
    expect(sub.answers.find(a => a.question_id === q('NUMBER').id)).toBeUndefined(); // facultative, non renvoyée la 2e fois

    const file = await request.get(`/api/tenders/${tenderId}/answer-files/${secondFileId}`, { headers: auth(adminToken) });
    expect(file.status()).toBe(200);
    expect(file.headers()['content-type']).toContain('application/pdf');

    const xlsx = await request.get(`/api/tenders/${tenderId}/export/excel`, { headers: auth(adminToken) });
    expect(xlsx.status()).toBe(200);
  });

  test.afterAll(async ({ request }) => {
    if (tenderId) await request.post(`/api/tenders/${tenderId}/cancel`, { headers: auth(adminToken) });
    if (templateId) await request.delete(`/api/tender-question-templates/${templateId}`, { headers: auth(adminToken) });
  });
});
