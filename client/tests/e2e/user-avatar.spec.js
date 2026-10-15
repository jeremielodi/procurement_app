// Photo de profil depuis « Mon profil » : recadrée dans le navigateur, affichée dans l'en-tête à la place des initiales,
// en grand au survol dans les listes, puis retirée (retour aux initiales — l'utilisateur des tests reste sans photo).
import { test, expect } from '@playwright/test';
import { getToken, auth } from '../api/helpers.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('Mon profil : ajouter sa photo, la voir en grand au survol, la retirer', async ({ page, request }) => {
  const me = (await (await request.get('/api/auth/profile', { headers: auth(await getToken(request)) })).json()).data;
  await page.goto('/profile');
  const header = page.locator('header');
  await expect(page.getByRole('heading', { name: 'Photo de profil' })).toBeVisible();
  await page.getByTestId('avatar-file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('Photo enregistrée')).toBeVisible();
  await expect(header.getByTestId('user-avatar-photo')).toBeVisible();
  await expect(page.getByTestId('avatar-picker').getByTestId('user-avatar-photo')).toBeVisible();

  // Liste des utilisateurs : survol de la photo → photo en grand avec le nom
  await page.goto('/users');
  await page.getByPlaceholder('Rechercher...', { exact: true }).fill(me.email);
  const row = page.getByRole('row').filter({ hasText: me.email });
  await row.getByTestId('user-avatar-photo').hover();
  const preview = page.getByTestId('user-avatar-preview');
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.locator('img').evaluate(img => img.naturalWidth)).toBe(256); // photo recadrée à 256 px

  await page.goto('/profile');
  await page.getByTestId('avatar-remove').click();
  await expect(page.getByText('Photo retirée')).toBeVisible();
  await expect(header.getByTestId('user-avatar-initials')).toBeVisible();
});
