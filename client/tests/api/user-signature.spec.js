import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Signature image (migration 41_user_signatures.sql) : GET / PUT / DELETE /auth/signature (soi-même) et, pour aider un
// utilisateur, /users/:id/signature (administrateur, MANAGE_USERS — 2026-11-10) ; version renvoyée par le profil
// (signatureVersion) ; trace USER_UPDATED (byAdmin), utilisateur prévenu.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const file = (buffer, name = 'signature.png', mimeType = 'image/png') => ({ signature: { name, mimeType, buffer } });

test.describe.serial('API › Signature des utilisateurs', () => {
  const stamp = Date.now().toString(36);
  let admin, user, userToken;
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    user = { email: `signature.${stamp}@nowhere.test`, password: 'Secret123' };
    const res = await request.post('/api/users', { headers: auth(admin), data: {
      username: `signature${stamp}`, email: user.email, password: user.password, firstName: 'Signature', lastName: stamp, profileIds: ['prof_requester'],
    } });
    expect(res.status(), await res.text()).toBe(201);
    user.id = (await res.json()).data.id;
    userToken = (await (await request.post('/api/auth/login', { data: user })).json()).data.token;
  });

  test('Sa signature : envoi, version dans le profil, lecture, faux fichier refusé, retrait', async ({ request }) => {
    expect((await request.get('/api/auth/signature', { headers: auth(userToken) })).status()).toBe(404);

    const fake = await json(await request.put('/api/auth/signature', { headers: auth(userToken), multipart: file(Buffer.from('pas une image')) }));
    expect([fake.status, fake.body.code]).toEqual([400, 'SIGNATURE_TYPE']);
    const pdf = await json(await request.put('/api/auth/signature', { headers: auth(userToken), multipart: file(Buffer.from('%PDF-1.4'), 'x.pdf', 'application/pdf') }));
    expect([pdf.status, pdf.body.code]).toEqual([400, 'SIGNATURE_TYPE']);
    const none = await json(await request.put('/api/auth/signature', { headers: auth(userToken), multipart: { other: 'x' } }));
    expect([none.status, none.body.code]).toEqual([400, 'SIGNATURE_REQUIRED']);

    const ok = await json(await request.put('/api/auth/signature', { headers: auth(userToken), multipart: file(PNG) }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.signatureVersion).toBeTruthy();

    const profile = (await (await request.get('/api/auth/profile', { headers: auth(userToken) })).json()).data;
    expect(profile.signatureVersion).toBeTruthy();
    const login = (await (await request.post('/api/auth/login', { data: user })).json()).data.user;
    expect(login.signatureVersion).toBeTruthy();

    const img = await request.get('/api/auth/signature', { headers: auth(userToken) });
    expect(img.status()).toBe(200);
    expect(img.headers()['content-type']).toContain('image/png');
    expect((await img.body()).equals(PNG)).toBe(true);

    const logs = await (await request.get(`/api/audit-logs?action=USER_UPDATED&userId=${user.id}&limit=5`, { headers: auth(admin) })).json();
    expect(logs.data.some(l => l.new_value?.signature === 'CHANGED')).toBe(true);

    const removed = await json(await request.delete('/api/auth/signature', { headers: auth(userToken) }));
    expect([removed.status, removed.body.data.signatureVersion]).toEqual([200, null]);
    expect((await request.get('/api/auth/signature', { headers: auth(userToken) })).status()).toBe(404);
  });

  test('Administrateur : dépose et retire la signature d\'un utilisateur, qui est prévenu ; un simple utilisateur ne le peut pas', async ({ request }) => {
    const url = `/api/users/${user.id}/signature`;
    // Un utilisateur sans MANAGE_USERS ne gère pas la signature d'un autre
    expect((await request.put(url, { headers: auth(userToken), multipart: file(PNG) })).status()).toBe(403);

    const saved = await json(await request.put(url, { headers: auth(admin), multipart: file(PNG) }));
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.data.signatureVersion).toBeTruthy();
    const fake = await json(await request.put(url, { headers: auth(admin), multipart: file(Buffer.from('pas une image')) }));
    expect([fake.status, fake.body.code]).toEqual([400, 'SIGNATURE_TYPE']);

    // Aperçu pour l'administrateur ; l'utilisateur retrouve la même signature dans son profil
    const img = await request.get(url, { headers: auth(admin) });
    expect([img.status(), (await img.body()).equals(PNG)]).toEqual([200, true]);
    expect((await (await request.get('/api/auth/profile', { headers: auth(userToken) })).json()).data.signatureVersion).toBeTruthy();
    const listed = (await (await request.get('/api/users', { headers: auth(admin) })).json()).data.find(u => u.id === user.id);
    expect(listed.signature_updated_at).toBeTruthy();

    // Trace « par l'administrateur » et utilisateur prévenu
    const logs = await (await request.get(`/api/audit-logs?action=USER_UPDATED&limit=20`, { headers: auth(admin) })).json();
    expect(logs.data.some(l => l.entity_id === user.id && l.new_value?.signature === 'CHANGED' && l.new_value?.byAdmin === true)).toBe(true);
    const notes = (await (await request.get(`/api/notifications/${user.id}`, { headers: auth(userToken) })).json()).data || [];
    expect((notes.notifications || notes).some(n => n.title === 'Votre signature a été enregistrée')).toBe(true);

    const removed = await json(await request.delete(url, { headers: auth(admin) }));
    expect([removed.status, removed.body.data.signatureVersion]).toEqual([200, null]);
    expect((await request.get('/api/auth/signature', { headers: auth(userToken) })).status()).toBe(404);
  });
});
