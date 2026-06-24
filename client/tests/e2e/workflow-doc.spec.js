/**
 * tests/e2e/workflow-doc.spec.js
 *
 * Visual documentation test suite — captures screenshots of the full
 * procure-to-pay workflow so they can be used as living documentation.
 *
 * Run after global-setup:
 *   npx playwright test --project=e2e workflow-doc.spec.js
 *
 * Screenshots land in: tests/docs/screenshots/
 */

import { test, expect } from '@playwright/test';
import { mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE  = join(__dirname, '.auth/user.json');
const DOCS_DIR   = join(__dirname, '../docs/screenshots');

mkdirSync(DOCS_DIR, { recursive: true });

/** Returns the absolute path for a numbered screenshot */
const ss = (name) => join(DOCS_DIR, name);

/** API base URL — matches Vite proxy config */
const API = 'http://127.0.0.1:5000/api';

/** Shared state passed between serial tests via module-level variables */
let requisitionId   = null;
let processInstance = null;
let poId            = null;
let grnId           = null;
let invoiceId       = null;
let paymentId       = null;

// ---------------------------------------------------------------------------
// Auth: reuse session saved by global-setup
// ---------------------------------------------------------------------------
test.use({
  storageState: existsSync(AUTH_FILE) ? AUTH_FILE : undefined,
});

// ---------------------------------------------------------------------------
// Helper: run an authenticated fetch inside the browser context (so the
// localStorage token is available). Used for fast API setup steps.
// ---------------------------------------------------------------------------
async function apiFetch(page, path, options = {}) {
  return page.evaluate(
    async ({ url, opts }) => {
      const token = localStorage.getItem('token');
      const res = await fetch(url, {
        ...opts,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(opts.headers || {}),
        },
      });
      return res.json();
    },
    { url: `${API}${path}`, opts: options }
  );
}

/** Wait for page paint and animations to settle before shooting */
async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
}

// ===========================================================================
// SUITE
// ===========================================================================
test.describe.serial('Workflow documentation screenshots', () => {

  // -------------------------------------------------------------------------
  // 01 · Login page
  // -------------------------------------------------------------------------
  test('01 - Login page', async ({ page }) => {
    await test.step('Navigate to login and capture', async () => {
      // Force the login page by going there directly (storageState won't auto-redirect here)
      await page.goto('/login');
      await settle(page);
      await page.screenshot({ path: ss('01-login.png'), fullPage: true });
    });
  });

  // -------------------------------------------------------------------------
  // 02 · Dashboard
  // -------------------------------------------------------------------------
  test('02 - Dashboard', async ({ page }) => {
    await test.step('Navigate to dashboard', async () => {
      await page.goto('/dashboard');
      await settle(page);
      await page.screenshot({ path: ss('02-dashboard.png'), fullPage: true });
    });
  });

  // -------------------------------------------------------------------------
  // 03 · Requisition list (existing data)
  // -------------------------------------------------------------------------
  test('03 - Requisition list', async ({ page }) => {
    await test.step('Navigate to requisitions', async () => {
      await page.goto('/requisitions');
      await settle(page);
      await page.screenshot({ path: ss('03-requisitions-list.png'), fullPage: true });
    });
  });

  // -------------------------------------------------------------------------
  // 04 · Create a new requisition (filled form screenshot + actual creation)
  // -------------------------------------------------------------------------
  test('04 - Requisition create form', async ({ page }) => {
    await test.step('Open new requisition form', async () => {
      await page.goto('/requisitions/new');
      await settle(page);
    });

    await test.step('Fill in realistic form data', async () => {
      // Title
      const titleInput = page.locator('input[name="title"], input[placeholder*="titre" i]').first();
      await titleInput.waitFor({ timeout: 8_000 });
      await titleInput.fill('[DOC] Fournitures de bureau Q3 2026');

      // Justification
      const justif = page.locator('textarea[name="justification"], textarea[placeholder*="justification" i]').first();
      if (await justif.isVisible()) {
        await justif.fill('Réapprovisionnement trimestriel des fournitures consommables pour le bureau de Yaoundé.');
      }

      // Priority
      const prioritySelect = page.locator('select[name="priority"]');
      if (await prioritySelect.isVisible()) {
        await prioritySelect.selectOption('MEDIUM');
      }

      // Project — pick first available option if select is present
      const projectSelect = page.locator('select[name="projectId"]');
      if (await projectSelect.isVisible()) {
        const options = await projectSelect.locator('option').all();
        if (options.length > 1) await projectSelect.selectOption({ index: 1 });
      }

      // Department
      const deptSelect = page.locator('select[name="departmentId"]');
      if (await deptSelect.isVisible()) {
        const opts = await deptSelect.locator('option').all();
        if (opts.length > 1) await deptSelect.selectOption({ index: 1 });
      }

      await page.waitForTimeout(300);
    });

    await test.step('Fill first line item', async () => {
      const descInput = page.locator('input[placeholder*="description" i], input[name*="description"]').first();
      if (await descInput.isVisible()) {
        await descInput.fill('Ramettes de papier A4 (boîte de 5)');
      }

      const qtyInput = page.locator('input[name*="quantity"], input[placeholder*="quantité" i]').first();
      if (await qtyInput.isVisible()) {
        await qtyInput.fill('10');
      }

      const priceInput = page.locator('input[name*="unitPrice"], input[name*="price"], input[placeholder*="prix" i]').first();
      if (await priceInput.isVisible()) {
        await priceInput.fill('3500');
      }

      await page.waitForTimeout(300);
    });

    await test.step('Screenshot of filled form', async () => {
      await page.screenshot({ path: ss('04-requisition-create.png'), fullPage: true });
    });

    await test.step('Submit form and record created requisition ID', async () => {
      const submitBtn = page.locator('button[type="submit"]');
      if (await submitBtn.isEnabled()) {
        const responsePromise = page.waitForResponse(
          (r) => r.url().includes('/api/requisitions') && r.request().method() === 'POST',
          { timeout: 15_000 }
        ).catch(() => null);

        await submitBtn.click();

        const response = await responsePromise;
        if (response) {
          try {
            const body = await response.json();
            if (body?.data?.id) {
              requisitionId   = body.data.id;
              processInstance = body.data.process_instance_id || null;
            }
          } catch { /* ignore JSON parse errors */ }
        }

        // Fallback: read ID from URL after navigation
        await page.waitForTimeout(1_500);
        const url = page.url();
        const match = url.match(/\/requisitions\/([^/?#]+)/);
        if (match && match[1] !== 'new') requisitionId = match[1];
      }
    });
  });

  // -------------------------------------------------------------------------
  // 05 · Task list — pending approvals
  // -------------------------------------------------------------------------
  test('05 - Task list (pending)', async ({ page }) => {
    await test.step('Navigate to task list', async () => {
      await page.goto('/tasks');
      await settle(page);
      await page.screenshot({ path: ss('05-task-list.png'), fullPage: true });
    });
  });

  // -------------------------------------------------------------------------
  // 06 · Task approval modal
  // -------------------------------------------------------------------------
  test('06 - Task approval modal', async ({ page }) => {
    await test.step('Open a pending approval task', async () => {
      await page.goto('/tasks');
      await settle(page);

      // Click the first task card that contains an approval-related keyword
      const taskCard = page
        .locator('div.cursor-pointer, div[class*="cursor-pointer"]')
        .filter({ hasText: /Validation|Hierarchical|Approbation/i })
        .first();

      const isVisible = await taskCard.isVisible().catch(() => false);
      if (isVisible) {
        await taskCard.click();
        await page.waitForTimeout(600);
        await page.screenshot({ path: ss('06-task-approve.png'), fullPage: true });

        // Close without submitting
        const cancelBtn = page.locator('button').filter({ hasText: /Annuler|Cancel/i }).first();
        if (await cancelBtn.isVisible().catch(() => false)) {
          await cancelBtn.click();
        }
      } else {
        // No approval task visible — screenshot current state as fallback
        await page.screenshot({ path: ss('06-task-approve.png'), fullPage: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // 07 · Requisition detail
  // -------------------------------------------------------------------------
  test('07 - Requisition detail', async ({ page }) => {
    await test.step('Navigate to requisition detail', async () => {
      // Use the requisition created in test 04, or fall back to the first in the list
      if (requisitionId) {
        await page.goto(`/requisitions/${requisitionId}`);
      } else {
        await page.goto('/requisitions');
        await settle(page);
        const firstLink = page.locator('a[href*="/requisitions/"]').first();
        if (await firstLink.isVisible().catch(() => false)) {
          await firstLink.click();
        }
      }
      await settle(page);
      await page.screenshot({ path: ss('07-requisition-approved.png'), fullPage: true });
    });
  });

  // -------------------------------------------------------------------------
  // 08 · Purchase Orders list
  // -------------------------------------------------------------------------
  test('08 - Purchase orders list', async ({ page }) => {
    await test.step('Navigate to PO list', async () => {
      await page.goto('/purchase-orders');
      await settle(page);
      await page.screenshot({ path: ss('08-po-list.png'), fullPage: true });
    });
  });

  // -------------------------------------------------------------------------
  // 09 · PO create / list with create button
  // -------------------------------------------------------------------------
  test('09 - PO create form', async ({ page }) => {
    await test.step('Look up an APPROVED requisition for context', async () => {
      try {
        const result = await apiFetch(page, '/requisitions?status=APPROVED&limit=1');
        const rows = result?.data?.data || result?.data || [];
        if (rows.length > 0) {
          requisitionId   = rows[0].id;
          processInstance = rows[0].process_instance_id || null;
        }
      } catch { /* ignore */ }
    });

    await test.step('Show PO list or creation entry point', async () => {
      await page.goto('/purchase-orders');
      await settle(page);

      // Try clicking "Nouvelle commande" if available
      const newPoBtn = page
        .locator('button, a')
        .filter({ hasText: /nouvelle commande|new.*order|créer.*commande/i })
        .first();

      if (await newPoBtn.isVisible().catch(() => false)) {
        await newPoBtn.click();
        await settle(page);
      }

      await page.screenshot({ path: ss('09-po-create.png'), fullPage: true });
    });
  });

  // -------------------------------------------------------------------------
  // 10 · PO detail
  // -------------------------------------------------------------------------
  test('10 - PO detail', async ({ page }) => {
    await test.step('Find and open a PO', async () => {
      try {
        const result = await apiFetch(page, '/purchase-orders?limit=5');
        const rows = result?.data?.data || result?.data || [];
        if (rows.length > 0) poId = rows[0].id;
      } catch { /* ignore */ }

      if (poId) {
        await page.goto(`/purchase-orders/${poId}`);
      } else {
        await page.goto('/purchase-orders');
        await settle(page);
        const firstLink = page.locator('a[href*="/purchase-orders/"]').first();
        if (await firstLink.isVisible().catch(() => false)) {
          await firstLink.click();
        }
      }

      await settle(page);
      await page.screenshot({ path: ss('10-po-detail.png'), fullPage: true });
    });
  });

  // -------------------------------------------------------------------------
  // 11 · GRN list
  // -------------------------------------------------------------------------
  test('11 - GRN list', async ({ page }) => {
    await test.step('Navigate to goods receipts list', async () => {
      await page.goto('/goods-receipts');
      await settle(page);
      await page.screenshot({ path: ss('11-grn-list.png'), fullPage: true });
    });
  });

  // -------------------------------------------------------------------------
  // 12 · GRN create form
  // -------------------------------------------------------------------------
  test('12 - GRN create form', async ({ page }) => {
    await test.step('Open GRN form with PO context', async () => {
      // Resolve a usable PO id if not already set
      if (!poId) {
        try {
          const result = await apiFetch(page, '/purchase-orders?limit=5');
          const rows = result?.data?.data || result?.data || [];
          if (rows.length > 0) poId = rows[0].id;
        } catch { /* ignore */ }
      }

      const grnUrl = poId
        ? `/goods-receipts/new?poId=${poId}`
        : '/goods-receipts/new';

      await page.goto(grnUrl);
      await settle(page);

      // Fill observations
      const obsField = page
        .locator('textarea[name*="observations"], textarea[placeholder*="observation" i]')
        .first();
      if (await obsField.isVisible().catch(() => false)) {
        await obsField.fill('Livraison conforme au bon de commande. Emballages en bon état. Réception effectuée le 24/06/2026.');
      }

      await page.waitForTimeout(300);
      await page.screenshot({ path: ss('12-grn-create.png'), fullPage: true });
    });
  });

  // -------------------------------------------------------------------------
  // 13 · Invoice list
  // -------------------------------------------------------------------------
  test('13 - Invoice list', async ({ page }) => {
    await test.step('Navigate to invoice list', async () => {
      await page.goto('/invoices');
      await settle(page);
      await page.screenshot({ path: ss('13-invoice-list.png'), fullPage: true });
    });
  });

  // -------------------------------------------------------------------------
  // 14 · Invoice detail (or create form showing 3-way match fields)
  // -------------------------------------------------------------------------
  test('14 - Invoice detail', async ({ page }) => {
    await test.step('Find existing invoice or show invoice form', async () => {
      try {
        const result = await apiFetch(page, '/invoices?limit=5');
        const rows = result?.data?.data || result?.data || [];
        if (rows.length > 0) invoiceId = rows[0].id;
      } catch { /* ignore */ }

      if (invoiceId) {
        await page.goto(`/invoices/${invoiceId}`);
      } else {
        // Show the invoice creation form pre-filled as a fallback
        const invoiceUrl = poId
          ? `/invoices/new?poId=${poId}`
          : '/invoices/new';
        await page.goto(invoiceUrl);
        await settle(page);

        const invNumField = page
          .locator('input[name*="invoiceNumber"], input[placeholder*="numéro" i]')
          .first();
        if (await invNumField.isVisible().catch(() => false)) {
          await invNumField.fill('FACT-2026-DOC-001');
        }

        const subtotalField = page
          .locator('input[name*="subtotal"], input[placeholder*="sous-total" i]')
          .first();
        if (await subtotalField.isVisible().catch(() => false)) {
          await subtotalField.fill('150000');
        }
      }

      await settle(page);
      await page.screenshot({ path: ss('14-invoice-detail.png'), fullPage: true });
    });
  });

  // -------------------------------------------------------------------------
  // 15 · Payment form
  // -------------------------------------------------------------------------
  test('15 - Payment form', async ({ page }) => {
    await test.step('Open payment creation form', async () => {
      const payUrl = invoiceId
        ? `/payments/new?invoiceId=${invoiceId}`
        : '/payments/new';

      await page.goto(payUrl);
      await settle(page);

      // Fill amount if empty
      const amountField = page
        .locator('input[name*="amount"], input[placeholder*="montant" i]')
        .first();
      if (await amountField.isVisible().catch(() => false)) {
        const current = await amountField.inputValue();
        if (!current) await amountField.fill('150000');
      }

      // Reference
      const refField = page
        .locator('input[name*="reference"], input[placeholder*="référence" i]')
        .first();
      if (await refField.isVisible().catch(() => false)) {
        await refField.fill('VIR-2026-DOC-001');
      }

      // Bank account
      const bankField = page
        .locator('input[name*="bankAccount"], input[placeholder*="compte" i]')
        .first();
      if (await bankField.isVisible().catch(() => false)) {
        await bankField.fill('BSCA XA 0012 3456 7890');
      }

      // Notes
      const notesField = page
        .locator('textarea[name*="notes"], textarea[placeholder*="notes" i]')
        .first();
      if (await notesField.isVisible().catch(() => false)) {
        await notesField.fill('Paiement fournisseur — facture rapprochée et approuvée par la direction financière.');
      }

      // Payment method
      const methodSelect = page.locator('select[name*="paymentMethod"]');
      if (await methodSelect.isVisible().catch(() => false)) {
        await methodSelect.selectOption('BANK_TRANSFER');
      }

      await page.waitForTimeout(300);
      await page.screenshot({ path: ss('15-payment-form.png'), fullPage: true });
    });
  });

  // -------------------------------------------------------------------------
  // 16 · Payments list
  // -------------------------------------------------------------------------
  test('16 - Payments list', async ({ page }) => {
    await test.step('Navigate to payments list', async () => {
      await page.goto('/payments');
      await settle(page);
      await page.screenshot({ path: ss('16-payments-list.png'), fullPage: true });
    });
  });

  // -------------------------------------------------------------------------
  // 17 · SAN list
  // -------------------------------------------------------------------------
  test('17 - SAN list', async ({ page }) => {
    await test.step('Navigate to service acceptance notes list', async () => {
      await page.goto('/service-acceptance-notes');
      await settle(page);
      await page.screenshot({ path: ss('17-san-list.png'), fullPage: true });
    });
  });

  // -------------------------------------------------------------------------
  // 18 · SAN form (via poId param — simule redirect GoFlow)
  // -------------------------------------------------------------------------
  test('18 - SAN form', async ({ page }) => {
    await test.step('Open SAN form with PO context', async () => {
      if (!poId) {
        try {
          const result = await apiFetch(page, '/purchase-orders?limit=5');
          const rows = result?.data?.data || result?.data || [];
          if (rows.length > 0) poId = rows[0].id;
        } catch { /* ignore */ }
      }

      const sanUrl = poId
        ? `/service-acceptance-notes/new?poId=${poId}`
        : '/service-acceptance-notes/new';

      await page.goto(sanUrl);
      await settle(page);
      await page.screenshot({ path: ss('18-san-form.png'), fullPage: true });
    });
  });

  // -------------------------------------------------------------------------
  // 19 · PO detail — Flux P2P panel (read-only)
  // -------------------------------------------------------------------------
  test('19 - PO detail Flux P2P', async ({ page }) => {
    await test.step('Open PO detail and capture Flux P2P panel', async () => {
      try {
        // Look for an approved/sent PO to show the P2P panel
        const result = await apiFetch(page, '/purchase-orders?limit=10');
        const rows = result?.data?.data || result?.data || [];
        const approvedPO = rows.find(r =>
          ['PO_APPROVED','PO_SENT','PO_RECEIVED','PO_COMPLETE'].includes(r.status)
        );
        if (approvedPO) poId = approvedPO.id;
      } catch { /* ignore */ }

      if (poId) {
        await page.goto(`/purchase-orders/${poId}`);
        await settle(page);
        await page.screenshot({ path: ss('19-po-detail-p2p.png'), fullPage: true });
      } else {
        // Fallback: PO list
        await page.goto('/purchase-orders');
        await settle(page);
        await page.screenshot({ path: ss('19-po-detail-p2p.png'), fullPage: true });
      }
    });
  });

});
