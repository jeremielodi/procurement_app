// Livraisons partielles — écrans (rien n'est enregistré) :
//  - formulaire de réception : quantité inférieure au reste → encadré « il restera … à livrer » + case « solder le reliquat »
//  - fiche du PO livré partiellement : bouton « Solder le reliquat » → fenêtre avec motif obligatoire
//  - centre d'aide : rubrique « Livraisons partielles »
import { test, expect } from '@playwright/test';

async function purchaseOrders(page) {
  await page.goto('/purchase-orders');
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const res = await page.request.get('/api/purchase-orders?limit=200', { headers: { Authorization: `Bearer ${token}` } });
  return (await res.json()).data || [];
}

test('Réception : reste à livrer et option « solder le reliquat »', async ({ page }) => {
  const pos = await purchaseOrders(page);
  const po = pos.find(p => ['PO_APPROVED', 'PO_SENT', 'PO_CONFIRMED'].includes(p.status) && p.delivery_status === 'NOT_DELIVERED');
  test.skip(!po, 'Aucun bon de commande approuvé non livré');

  await page.goto(`/goods-receipts/new?poId=${po.id}`);
  const qty = page.locator('input[type="number"]').first();
  await expect(qty).toBeVisible();
  const remaining = Number(await qty.inputValue());
  test.skip(!(remaining > 1), 'Quantité trop faible pour une livraison partielle');

  await expect(page.getByTestId('grn-remaining')).toHaveCount(0); // tout reçu par défaut
  await qty.fill('1');
  const box = page.getByTestId('grn-remaining');
  await expect(box).toContainText('il restera');
  await expect(box).toContainText('nouvelle acceptation (SAN)');
  await expect(page.getByLabel('Motif du solde du reliquat')).toHaveCount(0);
  await page.getByTestId('grn-close-remaining').check();
  await expect(page.getByLabel('Motif du solde du reliquat')).toBeVisible();
});

test('Bon de commande livré partiellement : « Solder le reliquat » demande un motif', async ({ page }) => {
  const pos = await purchaseOrders(page);
  const po = pos.find(p => p.delivery_status === 'PARTIALLY_DELIVERED');
  test.skip(!po, 'Aucun bon de commande livré partiellement');

  await page.goto(`/purchase-orders/${po.id}`);
  await expect(page.getByTestId('po-delivery')).toContainText('Livraison partielle : pour chaque nouvelle livraison');
  await page.getByTestId('close-remaining').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Si le fournisseur ne livrera pas ce reste');
  await expect(dialog.getByRole('button', { name: 'Solder', exact: true })).toBeDisabled();
  await dialog.getByRole('textbox').fill('Test e2e (non enregistré)');
  await expect(dialog.getByRole('button', { name: 'Solder', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.getByTestId('delivery-closure')).toHaveCount(0);
});

test('Centre d\'aide : rubrique livraisons partielles', async ({ page }) => {
  await page.goto('/goods-receipts');
  await page.getByRole('button', { name: /aide|guide/i }).first().click();
  await expect(page.getByRole('heading', { name: 'Livraisons partielles (en plusieurs fois)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Solder le reliquat (le reste ne sera jamais livré)' })).toBeVisible();
});
