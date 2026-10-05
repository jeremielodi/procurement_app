// URL publique de l'application (servie par le backend), utilisée dans les liens des emails.
// À définir dans backend/.env : APP_URL=https://procure.mondomaine.com (ou http://IP:5000)
require('dotenv').config();

const APP_URL = (process.env.APP_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, '');

if (/\/\/(localhost|127\.0\.0\.1)([:/]|$)/i.test(APP_URL) && process.env.NODE_ENV === 'production') {
  console.warn(`⚠️  APP_URL = ${APP_URL} : les liens des emails pointeront vers localhost. ` +
    'Définissez APP_URL avec l\'adresse publique dans backend/.env puis redémarrez.');
}

/** Lien absolu vers une page de l'application, ex. appLink('/tenders/3') */
const appLink = (path = '/') => `${APP_URL}${path.startsWith('/') ? '' : '/'}${path}`;

module.exports = { APP_URL, appLink };
