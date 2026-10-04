// backend/src/utils/enterpriseBranding.js
// Identité de l'entreprise (nom, coordonnées, logo en data URI) pour les documents PDF / emails.
// Repli sur « procureApp » si l'entreprise est inconnue.
const db = require('../config/database');
const tenant = require('./tenant');
const { logoDataUri } = require('./logoUpload');

const APP_NAME = 'procureApp';

/** @param {string} [enterpriseId] défaut : entreprise de la requête courante */
async function getBranding(enterpriseId) {
  const id = enterpriseId || tenant.enterpriseId();
  const e = id
    ? await db.one('SELECT name, code, logo_path, address, phone, email, website, tax_id, registration_number FROM enterprise WHERE id = $1', [id])
    : null;
  return {
    appName: APP_NAME,
    name: e?.name || APP_NAME,
    code: e?.code || null,
    address: e?.address || null,
    phone: e?.phone || null,
    email: e?.email || null,
    website: e?.website || null,
    taxId: e?.tax_id || null,
    registrationNumber: e?.registration_number || null,
    logo: await logoDataUri(e?.logo_path),
  };
}

module.exports = { getBranding, APP_NAME };
