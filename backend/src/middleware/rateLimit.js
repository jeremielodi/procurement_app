// backend/src/middleware/rateLimit.js
// Limitation du débit de l'API (express-rate-limit, compteurs en mémoire — une instance).
// Compteur par utilisateur connecté (jeton valide), sinon par IP (clientIp : X-Forwarded-For seulement
// depuis un proxy local/privé) — un bureau sort souvent par une seule IP publique, les comptes ne se gênent pas.
// Les échecs de connexion ont leur propre limite (utils/loginThrottle.js).
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { clientIp } = require('../utils/auditLog');

const num = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const DISABLED = process.env.RATE_LIMIT_DISABLED === '1';
const WINDOW_MS = num('RATE_LIMIT_WINDOW_MINUTES', 1) * 60 * 1000;

/** Utilisateur du jeton (signature vérifiée : un id inventé ne choisit pas son compteur), sinon IP */
function clientKey(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    try {
      const { id } = jwt.verify(header.slice(7), process.env.JWT_SECRET);
      if (id) return `user:${id}`;
    } catch { /* jeton absent / invalide : compteur de l'IP */ }
  }
  return `ip:${clientIp(req) || 'unknown'}`;
}

function limitReached(req, res) {
  const resetTime = req.rateLimit?.resetTime;
  const retryAfter = Math.max(1, Math.ceil(((resetTime ? resetTime.getTime() : Date.now() + WINDOW_MS) - Date.now()) / 1000));
  res.set('Retry-After', String(retryAfter));
  res.status(429).json({
    success: false,
    code: 'RATE_LIMITED',
    retryAfter,
    message: 'Trop de requêtes. Réessayez dans quelques instants.',
  });
}

function limiter({ windowMs = WINDOW_MS, max, keyGenerator = clientKey, skip }) {
  return rateLimit({
    windowMs,
    max,
    keyGenerator,
    skip: (req) => DISABLED || (skip ? skip(req) : false),
    standardHeaders: true, // RateLimit-Limit / -Remaining / -Reset
    legacyHeaders: false,
    handler: limitReached,
  });
}

const MAX_PER_USER = num('RATE_LIMIT_MAX_PER_USER', 600);
const MAX_PER_IP = num('RATE_LIMIT_MAX_PER_IP', 300);

// Toute l'API : plafond plus haut pour un compte connecté que pour un visiteur
const apiLimiter = limiter({
  max: (req) => (clientKey(req).startsWith('user:') ? MAX_PER_USER : MAX_PER_IP),
});

// PDF (Chrome), exports Excel, imports : coûteux pour le serveur
const HEAVY_PATH = /(^|\/)(pdf|export|import|import-items)(\/|$)/;
const heavyLimiter = limiter({
  max: num('RATE_LIMIT_MAX_HEAVY', 30),
  skip: (req) => !HEAVY_PATH.test(req.path),
});

// Inscription fournisseur publique (création de compte + fichiers) : par IP, sur une heure
const supplierRegisterLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  max: num('RATE_LIMIT_MAX_SUPPLIER_REGISTER_PER_HOUR', 30),
  keyGenerator: (req) => `ip:${clientIp(req) || 'unknown'}`,
});

module.exports = { apiLimiter, heavyLimiter, supplierRegisterLimiter, HEAVY_PATH };
