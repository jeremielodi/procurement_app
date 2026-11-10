// Outils communs des scripts « cas concret » : API, connexions, navigateur, captures, rendu des PDF
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../../..');
const require = createRequire(path.join(ROOT, 'backend/package.json'));

/** Réglages (variables d'environnement, voir README.md) */
export const CFG = {
  api: (process.env.DOC_API_URL || 'http://localhost:5000/api').replace(/\/$/, ''),
  app: (process.env.DOC_APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  enterpriseCode: process.env.DOC_ENTERPRISE_CODE || 'DEMO',
  domain: process.env.DOC_EMAIL_DOMAIN || 'demo-procureapp.org',
  password: process.env.DOC_PASSWORD || 'Demo1234!',
  captures: path.resolve(process.env.DOC_CAPTURES_DIR || path.join(HERE, '.captures')),
  site: path.join(ROOT, 'client/public/docs/cas-concret'),
};
export const STATE_FILE = path.join(CFG.captures, 'state.json');
fs.mkdirSync(CFG.captures, { recursive: true });

/** Identifiants du super admin plateforme (backend/.env), jamais affichés */
export function superAdminCreds() {
  require('dotenv').config({ path: path.join(ROOT, 'backend/.env') });
  const email = process.env.SUPERADMIN_EMAIL, password = process.env.SUPERADMIN_PASSWORD;
  if (!email || !password) throw new Error('SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD absents de backend/.env');
  return { email, password };
}

/** État partagé entre les étapes (jeu de données, documents créés) */
export const loadState = () => (fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {});
export const saveState = (state) => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export const future = (days) => new Date(Date.now() + days * 86400e3).toISOString().slice(0, 10);
export const today = () => new Date().toISOString().slice(0, 10);

/** Appel de l'API ; body FormData = multipart ; raw = Buffer (PDF) */
export async function call(method, url, token, body, { raw = false } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(CFG.api + url, { method, headers, body: payload });
  if (raw) {
    if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`${method} ${url} → ${res.status} ${JSON.stringify(json).slice(0, 400)}`);
    err.status = res.status; err.body = json;
    throw err;
  }
  return json.data ?? json;
}

const tokens = {};
/** Jeton d'un compte (mis en cache) */
export async function tokenFor(email, password = CFG.password) {
  return tokens[email] ||= (await call('POST', '/auth/login', null, { email, password })).token;
}

/** PDF minimal (pièces jointes de démonstration) */
export const pdfBlob = () => new Blob([Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF')], { type: 'application/pdf' });

/**
 * Navigateur des captures : une session (contexte) par compte, connexion par le formulaire.
 * shot(email, chemin, nom, { dir, tall, before, wait }) : fenêtre haute plutôt que fullPage (la barre latérale
 * fixe se décale sur une capture pleine page).
 */
export async function openBrowser() {
  const browser = await chromium.launch();
  const pages = {};

  async function pageFor(email, password = CFG.password) {
    if (pages[email]) return pages[email];
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    const page = await ctx.newPage();
    for (let attempt = 1; ; attempt++) {
      try {
        // Premier chargement de Vite parfois lent (dépendances compilées à la demande)
        await page.goto(CFG.app + '/login', { waitUntil: 'domcontentloaded', timeout: 120_000 });
        await page.fill('input[name="email"]', email, { timeout: 120_000 });
        await page.fill('input[name="password"]', password);
        await page.click('button[type="submit"]');
        await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 });
        break;
      } catch (e) { if (attempt >= 3) throw e; }
    }
    return pages[email] = page;
  }

  async function settle(page, ms = 1500) {
    await page.waitForSelector('main h1, main h2, h1', { timeout: 30_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(ms);
  }

  async function go(email, url, { tall = 900 } = {}) {
    const page = await pageFor(email);
    await page.setViewportSize({ width: 1440, height: tall });
    await page.goto(CFG.app + url, { waitUntil: 'domcontentloaded' });
    await settle(page);
    return page;
  }

  /** Capture de l'écran courant (path null) ou d'un écran (path) ; before(page) prépare l'écran (fenêtre ouverte…) */
  async function shot(email, url, name, { dir, tall = 900, before } = {}) {
    try {
      const page = url ? await go(email, url, { tall }) : await pageFor(email);
      if (!url) await page.setViewportSize({ width: 1440, height: tall });
      if (before) await before(page);
      await page.waitForTimeout(500);
      const file = path.join(CFG.captures, dir, `${name}.png`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await page.screenshot({ path: file });
      console.log('  📸', `${dir}/${name}`);
      return page;
    } catch (e) {
      console.log('  ⚠️ capture', name, e.message.split('\n')[0]);
      return null;
    }
  }

  /**
   * Rendu d'un PDF avec pdf.js (client/node_modules/pdfjs-dist) : une image par page, une fois le rendu terminé.
   * Le visualiseur PDF intégré du navigateur ne s'affiche pas en mode headless.
   */
  async function renderPdf(buffer, dir, name, maxPages = 2) {
    const pdfjs = path.join(ROOT, 'client/node_modules/pdfjs-dist/build');
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 1500 } });
    const page = await ctx.newPage();
    await page.route('http://pdf.local/**', async (route) => {
      const f = new URL(route.request().url()).pathname.slice(1);
      if (f === 'doc.pdf') return route.fulfill({ body: buffer, contentType: 'application/pdf' });
      if (f === 'index.html') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body style="margin:0">
        <div id="out"></div><script type="module">
          import * as pdfjs from '/pdf.mjs';
          pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
          const doc = await pdfjs.getDocument({ url: '/doc.pdf' }).promise;
          const n = Math.min(doc.numPages, ${maxPages});
          for (let i = 1; i <= n; i++) {
            const pg = await doc.getPage(i);
            const vp = pg.getViewport({ scale: 1.6 });
            const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; c.id = 'p' + i;
            c.style.display = 'block'; c.style.background = '#fff';
            document.getElementById('out').appendChild(c);
            await pg.render({ canvasContext: c.getContext('2d'), viewport: vp, canvas: c }).promise;
          }
          window.__pages = n;
        </script></body></html>` });
      return route.fulfill({ path: path.join(pdfjs, f), contentType: 'text/javascript' });
    });
    try {
      await page.goto('http://pdf.local/index.html');
      await page.waitForFunction(() => window.__pages > 0, null, { timeout: 60_000 });
      const n = await page.evaluate(() => window.__pages);
      for (let i = 1; i <= n; i++) {
        const file = path.join(CFG.captures, dir, `${n > 1 ? `${name}-p${i}` : name}.png`);
        await page.locator('#p' + i).screenshot({ path: file });
      }
      console.log('  📄', `${dir}/${name}`, n > 1 ? `(${n} pages)` : '');
    } catch (e) {
      console.log('  ⚠️ PDF', name, e.message.split('\n')[0]);
    } finally { await ctx.close(); }
  }

  return { browser, pageFor, go, settle, shot, renderPdf, close: () => browser.close() };
}

/** Choix dans une liste SearchSelect : écrit dans le <select> caché puis déclenche change (comme l'utilisateur) */
export async function pick(page, selector, value, index = 0) {
  return page.evaluate(({ selector, value, index }) => {
    const el = document.querySelectorAll(selector)[index];
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, String(value));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value === String(value);
  }, { selector, value, index });
}

/** Clic sur un bouton par son libellé (sans échec si absent) */
export async function clickButton(page, name) {
  try { await page.getByRole('button', { name }).first().click({ timeout: 8000 }); await page.waitForTimeout(900); return true; }
  catch { console.log('  (bouton', String(name), 'non trouvé)'); return false; }
}
