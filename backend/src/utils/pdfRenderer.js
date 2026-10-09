// backend/src/utils/pdfRenderer.js
// Génération des PDF avec UN navigateur Chrome partagé (une page par document) au lieu d'un puppeteer.launch par PDF :
//  - beaucoup plus rapide (pas de démarrage de Chrome à chaque document)
//  - plus de profil Chrome temporaire par document : deux PDF simultanés ne se gênent plus (sous Windows, la suppression
//    du profil pouvait échouer — EBUSY non intercepté — et arrêter le serveur)
//  - navigateur relancé automatiquement s'il s'est arrêté ; une génération interrompue par la fermeture du navigateur
//    est retentée une fois
const puppeteer = require('puppeteer');
const { getBrowserOptions } = require('../config/puppeteer');

let browserPromise = null;

async function getBrowser() {
  if (browserPromise) {
    const browser = await browserPromise.catch(() => null);
    // Puppeteer récent : propriété « connected » (isConnected() n'existe plus)
    const connected = browser && (typeof browser.connected === 'boolean' ? browser.connected : browser.isConnected?.());
    if (connected) return browser;
    browserPromise = null;
  }
  browserPromise = puppeteer.launch(getBrowserOptions()).then((browser) => {
    browser.on('disconnected', () => { browserPromise = null; });
    return browser;
  });
  return browserPromise;
}

const closedError = (error) => /Target closed|Session closed|Protocol error|browser has disconnected|Connection closed/i.test(String(error?.message));

/**
 * @param {string} html     document complet
 * @param {object} options  options de page.pdf (format, marges, en-tête / pied de page…)
 * @returns {Promise<Buffer>}
 */
async function renderPdf(html, options = {}, attempt = 1) {
  const browser = await getBrowser();
  let page;
  try {
    page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf({ format: 'A4', printBackground: true, ...options });
  } catch (error) {
    if (attempt === 1 && closedError(error)) {
      browserPromise = null;
      return renderPdf(html, options, 2);
    }
    throw error;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

/** Arrêt propre (fin du processus) */
async function closeBrowser() {
  const browser = await browserPromise?.catch(() => null);
  browserPromise = null;
  if (browser) await browser.close().catch(() => {});
}

module.exports = { renderPdf, closeBrowser };
