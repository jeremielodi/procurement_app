import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Photo de profil (migration 31_user_avatars.sql) : PUT / DELETE /auth/avatar (soi-même), PUT / DELETE /users/:id/avatar
// (MANAGE_USERS), lecture GET /auth/avatar et GET /users/:id/avatar (authentifiée, même entreprise) ; version renvoyée
// par le profil (avatarVersion) et la liste des utilisateurs (avatar_updated_at).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const file = (buffer, name = 'photo.png', mimeType = 'image/png') => ({ avatar: { name, mimeType, buffer } });

test.describe.serial('API › Photo de profil', () => {
  const stamp = Date.now().toString(36);
  let admin, user, userToken;
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    user = { email: `avatar.${stamp}@nowhere.test`, password: 'Secret123' };
    const res = await request.post('/api/users', { headers: auth(admin), data: {
      username: `avatar${stamp}`, email: user.email, password: user.password, firstName: 'Photo', lastName: stamp, profileIds: ['prof_requester'],
    } });
    expect(res.status(), await res.text()).toBe(201);
    user.id = (await res.json()).data.id;
    userToken = (await (await request.post('/api/auth/login', { data: user })).json()).data.token;
  });

  test('Sa propre photo : envoi, version dans le profil, lecture par un collègue, faux fichier refusé', async ({ request }) => {
    expect((await request.get('/api/auth/avatar', { headers: auth(userToken) })).status()).toBe(404);
    const fake = await json(await request.put('/api/auth/avatar', { headers: auth(userToken), multipart: file(Buffer.from('pas une image, juste du texte')) }));
    expect([fake.status, fake.body.code]).toEqual([400, 'AVATAR_TYPE']);
    const pdf = await json(await request.put('/api/auth/avatar', { headers: auth(userToken), multipart: file(Buffer.from('%PDF-1.4'), 'x.pdf', 'application/pdf') }));
    expect([pdf.status, pdf.body.code]).toEqual([400, 'AVATAR_TYPE']);

    const saved = await json(await request.put('/api/auth/avatar', { headers: auth(userToken), multipart: file(PNG) }));
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.data.avatarVersion).toBeTruthy();
    const profile = (await (await request.get('/api/auth/profile', { headers: auth(userToken) })).json()).data;
    expect(profile.avatarVersion).toBeTruthy();

    const mine = await request.get('/api/auth/avatar', { headers: auth(userToken) });
    expect([mine.status(), mine.headers()['content-type']]).toEqual([200, 'image/png']);
    expect(Buffer.compare(await mine.body(), PNG)).toBe(0);
    // Un collègue (ici l'admin) voit la photo ; la liste des utilisateurs donne la version
    expect((await request.get(`/api/users/${user.id}/avatar`, { headers: auth(admin) })).status()).toBe(200);
    const listed = (await (await request.get(`/api/users?search=avatar${stamp}`, { headers: auth(admin) })).json()).data.find(u => u.id === user.id);
    expect(listed?.avatar_updated_at).toBeTruthy();
    // Sans authentification : refusé
    expect((await request.get(`/api/users/${user.id}/avatar`)).status()).toBe(401);
  });

  test('Photo d\'un autre : réservée à l\'administrateur ; retrait → initiales', async ({ request }) => {
    const adminId = (await (await request.get('/api/auth/profile', { headers: auth(admin) })).json()).data.id;
    expect((await request.put(`/api/users/${adminId}/avatar`, { headers: auth(userToken), multipart: file(PNG) })).status()).toBe(403);
    const byAdmin = await json(await request.put(`/api/users/${user.id}/avatar`, { headers: auth(admin), multipart: file(PNG) }));
    expect(byAdmin.status, JSON.stringify(byAdmin.body)).toBe(200);

    expect((await request.delete('/api/auth/avatar', { headers: auth(userToken) })).status()).toBe(200);
    expect((await request.get(`/api/users/${user.id}/avatar`, { headers: auth(admin) })).status()).toBe(404);
    const profile = (await (await request.get('/api/auth/profile', { headers: auth(userToken) })).json()).data;
    expect(profile.avatarVersion).toBeNull();
  });
});
