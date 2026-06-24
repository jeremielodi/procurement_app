// Caches the enterprise currency to avoid a DB round-trip on every invoice/payment creation.
const db = require('../config/database');

let cached = null;
let fetchedAt = 0;
const TTL = 60_000; // 1 minute

async function getEnterpriseCurrencyCode() {
  if (cached && Date.now() - fetchedAt < TTL) return cached;
  try {
    const row = await db.one(`
      SELECT c.format_key
      FROM enterprise e
      JOIN currency c ON c.id = e.currency_id
      ORDER BY e.created_at ASC LIMIT 1
    `);
    cached = row?.format_key || 'USD';
    fetchedAt = Date.now();
  } catch {
    cached = cached || 'USD';
  }
  return cached;
}

module.exports = { getEnterpriseCurrencyCode };
