// Photo de profil depuis « Mon profil » : recadrée dans le navigateur, affichée dans l'en-tête à la place des initiales,
// puis retirée (retour aux initiales — l'utilisateur des tests reste sans photo).
import { test, expect } from '@playwright/test';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('Mon profil : ajouter puis retirer sa photo', async ({ page }) => {
  await page.goto('/profile');
  const header = page.locator('header');
  await expect(page.getByRole('heading', { name: 'Photo de profil' })).toBeVisible();
  await page.getByTestId('avatar-file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('Photo enregistrée')).toBeVisible();
  await expect(header.getByTestId('user-avatar-photo')).toBeVisible();
  await expect(page.getByTestId('avatar-picker').getByTestId('user-avatar-photo')).toBeVisible();

  await page.getByTestId('avatar-remove').click();
  await expect(page.getByText('Photo retirée')).toBeVisible();
  await expect(header.getByTestId('user-avatar-initials')).toBeVisible();
});
