// Devise de l'entreprise courante (multi-entreprise), mise en cache par entreprise.
// Hors requête HTTP (workers), on retombe sur la première entreprise créée.
const db = require('../config/database');
const tenant = require('./tenant');

const cache = new Map(); // enterpriseId | '__first__' → { code, at }
const TTL = 60_000; // 1 minute

async function getEnterpriseCurrencyCode() {
  const enterpriseId = tenant.enterpriseId();
  const key = enterpriseId || '__first__';
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.code;
  try {
    const row = enterpriseId
      ? await db.one(
          'SELECT c.format_key FROM enterprise e JOIN currency c ON c.id = e.currency_id WHERE e.id = $1',
          [enterpriseId]
        )
      : await db.one(
          'SELECT c.format_key FROM enterprise e JOIN currency c ON c.id = e.currency_id ORDER BY e.created_at ASC LIMIT 1'
        );
    const code = row?.format_key || 'USD';
    cache.set(key, { code, at: Date.now() });
    return code;
  } catch {
    return hit?.code || 'USD';
  }
}

module.exports = { getEnterpriseCurrencyCode };
