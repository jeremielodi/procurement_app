import { test, expect } from '@playwright/test';

// Formulaire de contact du site vitrine — n'envoie jamais d'email réel :
// uniquement des requêtes refusées (400) ou piégées (champ « website » rempli → succès sans envoi)
test.describe('API › Formulaire de contact (public)', () => {
  test('POST /api/public/contact — champs invalides → 400 avec codes par champ', async ({ request }) => {
    const res = await request.post('/api/public/contact', { data: { name: '', email: 'pas-un-email', message: 'court' } });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.errors).toEqual({ name: 'required', email: 'invalid', message: 'tooShort' });
  });

  test('POST /api/public/contact — message trop long → 400 tooLong', async ({ request }) => {
    const res = await request.post('/api/public/contact', {
      data: { name: 'Test', email: 'test@nowhere.test', message: 'x'.repeat(5001), website: 'robot' },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).errors.message).toBe('tooLong');
  });

  test('POST /api/public/contact — champ piège rempli → 200 sans envoi, sans authentification', async ({ request }) => {
    const res = await request.post('/api/public/contact', {
      data: { name: 'Robot', email: 'robot@nowhere.test', message: 'Message de robot pour test', website: 'http://spam.test' },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).success).toBe(true);
  });
});
