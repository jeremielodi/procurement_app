// backend/src/utils/loginThrottle.js
// Limitation des tentatives de connexion (anti force brute), en mémoire — seuls les ÉCHECS comptent :
//   - compte + IP : LOGIN_MAX_FAILURES_PER_ACCOUNT (5) échecs → ce compte est bloqué depuis cette IP
//     (clé compte + IP : un tiers ne peut pas bloquer le compte de quelqu'un depuis ailleurs)
//   - IP : LOGIN_MAX_FAILURES_PER_IP (100) échecs, tous comptes confondus (attaque par pulvérisation) —
//     seuil élevé car un bureau entier sort souvent par une seule IP publique
//   - compte : LOGIN_MAX_FAILURES_PER_ACCOUNT_GLOBAL (50) échecs, toutes IP confondues (attaque distribuée)
// Fenêtre glissante LOGIN_WINDOW_MINUTES (15). Une connexion réussie efface les échecs compte + IP.
// Une seule instance de l'application : compteurs en mémoire (comme les limites du mot de passe oublié).
const num = (v, fallback) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const config = () => ({
  windowMs: num(process.env.LOGIN_WINDOW_MINUTES, 15) * 60 * 1000,
  perAccountIp: num(process.env.LOGIN_MAX_FAILURES_PER_ACCOUNT, 5),
  perIp: num(process.env.LOGIN_MAX_FAILURES_PER_IP, 100),
  perAccount: num(process.env.LOGIN_MAX_FAILURES_PER_ACCOUNT_GLOBAL, 50),
});

const failures = new Map(); // clé → horodatages des échecs (ms), du plus ancien au plus récent
const MAX_KEYS = 50000;

const normalizeEmail = (email) => String(email || '').trim().toLowerCase().slice(0, 255);
const keys = (email, ip) => ({
  accountIp: `a+ip:${normalizeEmail(email)}|${ip}`,
  ip: `ip:${ip}`,
  account: `a:${normalizeEmail(email)}`,
});

function recent(key, now, windowMs) {
  const list = (failures.get(key) || []).filter(ts => now - ts < windowMs);
  if (list.length) failures.set(key, list); else failures.delete(key);
  return list;
}

/** Nettoyage : entrées expirées, et plafond mémoire (les plus anciennes clés partent d'abord) */
function prune(now, windowMs) {
  for (const [key, list] of failures) {
    if (!list.length || now - list[list.length - 1] >= windowMs) failures.delete(key);
  }
  while (failures.size > MAX_KEYS) failures.delete(failures.keys().next().value);
}

/**
 * Tentative autorisée ? → { blocked: false } ou { blocked: true, scope: 'ACCOUNT' | 'IP', retryAfter (s) }
 */
function check(email, ip, now = Date.now()) {
  const c = config();
  const k = keys(email, ip);
  for (const [scope, key, max] of [['ACCOUNT', k.accountIp, c.perAccountIp], ['IP', k.ip, c.perIp], ['ACCOUNT', k.account, c.perAccount]]) {
    const list = recent(key, now, c.windowMs);
    if (list.length >= max) {
      // Débloqué quand l'échec le plus ancien parmi les « max » derniers sort de la fenêtre
      const unlockAt = list[list.length - max] + c.windowMs;
      return { blocked: true, scope, retryAfter: Math.max(1, Math.ceil((unlockAt - now) / 1000)) };
    }
  }
  return { blocked: false };
}

function recordFailure(email, ip, now = Date.now()) {
  const c = config();
  prune(now, c.windowMs);
  for (const key of Object.values(keys(email, ip))) {
    failures.set(key, [...recent(key, now, c.windowMs), now]);
  }
}

function recordSuccess(email, ip) {
  failures.delete(keys(email, ip).accountIp);
}

/** Tests unitaires / redémarrage logique */
function reset() {
  failures.clear();
}

module.exports = { check, recordFailure, recordSuccess, reset, config };
