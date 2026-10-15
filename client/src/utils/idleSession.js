// src/utils/idleSession.js
// Déconnexion après inactivité : heure de la dernière activité de l'utilisateur, partagée entre les onglets
// (localStorage) — tant qu'un onglet est utilisé, aucun onglet n'est déconnecté. Les requêtes automatiques
// (rafraîchissements, WebSocket) ne comptent pas : seules les actions de l'utilisateur (souris, clavier, toucher).

const KEY = 'app_last_activity';
const REASON_KEY = 'app_logout_reason';

/** Délai d'inactivité avant déconnexion (VITE_IDLE_TIMEOUT_MINUTES, défaut 60 minutes) */
export const IDLE_TIMEOUT_MS = (Number(import.meta.env.VITE_IDLE_TIMEOUT_MINUTES) || 60) * 60 * 1000;
/** Avertissement affiché avant la déconnexion */
export const IDLE_WARNING_MS = Math.min(2 * 60 * 1000, IDLE_TIMEOUT_MS / 2);

const read = (storage, key) => { try { return storage.getItem(key); } catch { return null; } };
const write = (storage, key, value) => { try { storage.setItem(key, value); } catch { /* stockage indisponible */ } };
const remove = (storage, key) => { try { storage.removeItem(key); } catch { /* stockage indisponible */ } };

export function lastActivity() {
  const v = Number(read(localStorage, KEY));
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function markActivity(at = Date.now()) {
  write(localStorage, KEY, String(at));
}

export function clearActivity() {
  remove(localStorage, KEY);
}

/** Temps restant avant la déconnexion (ms) ; null si aucune activité enregistrée */
export function idleRemaining(now = Date.now()) {
  const last = lastActivity();
  return last === null ? null : last + IDLE_TIMEOUT_MS - now;
}

/** Motif affiché par l'écran de connexion après une déconnexion automatique (onglet courant) */
export function setLogoutReason(reason) {
  write(sessionStorage, REASON_KEY, reason);
}

export function getLogoutReason() {
  return read(sessionStorage, REASON_KEY);
}

/** Effacé une fois affiché (le message n'apparaît qu'une fois) */
export function clearLogoutReason() {
  remove(sessionStorage, REASON_KEY);
}

export const ACTIVITY_KEY = KEY;
