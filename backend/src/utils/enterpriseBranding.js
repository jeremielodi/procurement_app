// backend/src/utils/enterpriseBranding.js
// Identité de l'entreprise (nom, coordonnées, logo en data URI) pour les documents PDF / emails.
// Repli sur « procureApp » si l'entreprise est inconnue.
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const tenant = require('./tenant');

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const APP_NAME = 'procureApp';

function logoDataUri(relPath) {
  if (!relPath) return null;
  const base = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));
  const file = path.resolve(base, relPath);
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!mime || !file.startsWith(base) || !fs.existsSync(file)) return null;
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

/** @param {string} [enterpriseId] défaut : entreprise de la requête courante */
async function getBranding(enterpriseId) {
  const id = enterpriseId || tenant.enterpriseId();
  const e = id
    ? await db.one('SELECT name, code, logo_path, address, phone, email, website FROM enterprise WHERE id = $1', [id])
    : null;
  return {
    appName: APP_NAME,
    name: e?.name || APP_NAME,
    code: e?.code || null,
    address: e?.address || null,
    phone: e?.phone || null,
    email: e?.email || null,
    website: e?.website || null,
    logo: logoDataUri(e?.logo_path),
  };
}

module.exports = { getBranding, APP_NAME };
