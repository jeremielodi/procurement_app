// Profils BPMN liés au projet : depuis la fiche utilisateur, « Profils par projet » —
// Manager sur un projet, Demandeur sur un autre ; retrouvés à la réouverture de la fiche.
import { test, expect } from '@playwright/test';

test('Fiche utilisateur : Manager sur un projet, Demandeur sur un autre', async ({ page }) => {
  const stamp = Date.now().toString(36);
  const email = `e2e.pp.${stamp}@nowhere.test`;
  await page.goto('/users');
  await page.getByRole('button', { name: 'Nouvel utilisateur' }).click();

  const form = page.locator('form').filter({ has: page.getByTestId('project-profiles') });
  await form.locator('input[name="username"]').fill(`e2epp${stamp}`);
  await form.locator('input[name="email"]').fill(email);
  await form.locator('input[name="password"]').fill('Secret123');
  await form.locator('input[name="firstName"]').fill('E2E');
  await form.locator('input[name="lastName"]').fill(`Projet ${stamp}`);
  await form.getByRole('button', { name: 'Manager', exact: true }).click();
  await form.getByRole('button', { name: 'Demandeur', exact: true }).click();

  // Ligne 1 : premier projet, Manager seulement ; ligne 2 : projet suivant, Demandeur seulement
  const rows = form.getByTestId('project-row');
  await form.getByTestId('add-project-row').click();
  const first = rows.nth(0);
  const firstOptions = await first.locator('select[data-testid="project-row-project"] option').evaluateAll(os => os.map(o => o.value).filter(Boolean));
  test.skip(firstOptions.length < 2, 'Au moins deux projets actifs requis');
  await first.locator('select[data-testid="project-row-project"]').selectOption(firstOptions[0]);
  await first.getByTestId('project-row-profile-prof_requester').click();
  await expect(first.getByTestId('project-row-profile-prof_manager')).toHaveAttribute('aria-pressed', 'true');
  await expect(first.getByTestId('project-row-profile-prof_requester')).toHaveAttribute('aria-pressed', 'false');

  await form.getByTestId('add-project-row').click();
  const second = rows.nth(1);
  // Le projet déjà choisi n'est plus proposé
  const secondOptions = await second.locator('select[data-testid="project-row-project"] option').evaluateAll(os => os.map(o => o.value).filter(Boolean));
  expect(secondOptions).not.toContain(firstOptions[0]);
  await second.locator('select[data-testid="project-row-project"]').selectOption(secondOptions[0]);
  await second.getByTestId('project-row-profile-prof_manager').click();

  await form.getByRole('button', { name: 'Créer' }).click();
  await expect(page.getByText('Utilisateur créé')).toBeVisible();

  // Réouverture : les profils par projet sont relus
  await page.getByPlaceholder(/Rechercher/).first().fill(email);
  const line = page.locator('tr', { hasText: email });
  await line.getByTitle('Modifier').click();
  const reopened = page.getByTestId('project-row');
  await expect(reopened).toHaveCount(2);
  const state = await reopened.evaluateAll(rs => rs.map(r => ({
    project: r.querySelector('select[data-testid="project-row-project"]').value,
    on: [...r.querySelectorAll('[aria-pressed="true"]')].map(b => b.dataset.testid.replace('project-row-profile-', '')),
  })));
  expect(state).toEqual(expect.arrayContaining([
    { project: firstOptions[0], on: ['prof_manager'] },
    { project: secondOptions[0], on: ['prof_requester'] },
  ]));
});
