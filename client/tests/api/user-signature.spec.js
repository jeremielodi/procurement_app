import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Signature image (migration 41_user_signatures.sql) : GET / PUT / DELETE /auth/signature — l'utilisateur seul
// (aucune route pour la signature d'un autre) ; version renvoyée par le profil (signatureVersion) ; trace USER_UPDATED.
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

  test('Personnelle : aucun accès à la signature d\'un autre, même pour l\'administrateur', async ({ request }) => {
    expect((await request.put('/api/auth/signature', { headers: auth(userToken), multipart: file(PNG) })).status()).toBe(200);
    // La signature lue avec le jeton de l'administrateur est la sienne, jamais celle de l'utilisateur
    for (const method of ['get', 'put', 'delete']) {
      const res = await request[method](`/api/users/${user.id}/signature`, { headers: auth(admin), ...(method === 'put' ? { multipart: file(PNG) } : {}) });
      // Route inexistante (le serveur renvoie alors la page de l'application) : jamais l'image de l'utilisateur
      expect(res.headers()['content-type'] || '', `${method} /users/:id/signature`).not.toContain('image/');
    }
    // Signature toujours en place après les tentatives de l'administrateur
    expect((await request.get('/api/auth/signature', { headers: auth(userToken) })).status()).toBe(200);
  });
});
