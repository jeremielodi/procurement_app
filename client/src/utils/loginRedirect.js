// src/utils/loginRedirect.js
// Retour à la page demandée après connexion (ex. lien d'un email vers /requisitions/…/tasks) :
// ProtectedRoute et la session expirée envoient vers /login?redirect=<page>, la connexion y renvoie ensuite.
// Seuls les chemins internes sont acceptés (jamais une autre adresse : pas de redirection ouverte).
import { homePathFor } from './accountType';

// Pages publiques : inutile (ou en boucle) d'y revenir après connexion
const PUBLIC_PATHS = ['/login', '/supplier-register', '/forgot-password', '/reset-password'];

/** Chemin interne sûr (« /… » mais pas « //… » ni « /\… », sans schéma), sinon null */
export function safeRedirect(target) {
  if (typeof target !== 'string') return null;
  const path = target.trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return null;
  if (/[\u0000-\u001f]/.test(path) || /^\/[^/?#]*:/.test(path)) return null;
  const pathname = path.split(/[?#]/)[0];
  if (pathname === '/' || PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`))) return null;
  return path;
}

/** Adresse de la page de connexion qui ramènera à la page courante (location de react-router ou window.location) */
export function loginPathFor(location) {
  const current = `${location?.pathname || ''}${location?.search || ''}${location?.hash || ''}`;
  const target = safeRedirect(current);
  return target ? `/login?redirect=${encodeURIComponent(target)}` : '/login';
}

/** Destination après connexion : la page demandée si elle est sûre, sinon l'accueil du compte
 *  (ProtectedRoute renvoie ensuite un fournisseur ou le super admin vers ses propres pages si besoin) */
export function afterLoginPath(redirectParam, user) {
  return safeRedirect(redirectParam) || homePathFor(user);
}
