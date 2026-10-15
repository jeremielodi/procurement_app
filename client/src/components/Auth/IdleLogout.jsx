// src/components/Auth/IdleLogout.jsx
// Déconnexion automatique après 1 h sans activité (IDLE_TIMEOUT_MS, utils/idleSession) :
//  - activité = souris, clavier, défilement, toucher, retour sur l'onglet ; partagée entre les onglets (localStorage)
//  - avertissement 2 minutes avant, avec compte à rebours : « Rester connecté » / « Se déconnecter »
//  - au-delà : logout('IDLE') (tracé dans le journal d'audit), puis écran de connexion avec un message
//  - ordinateur en veille / onglet en arrière-plan : vérifié dès le retour (comparaison d'horodatages, pas de minuterie)
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, LogOut } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { loginPathFor } from '../../utils/loginRedirect';
import {
  IDLE_WARNING_MS, ACTIVITY_KEY, lastActivity, markActivity, idleRemaining, setLogoutReason,
} from '../../utils/idleSession';
import { t } from '../../i18n';

const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'wheel', 'scroll', 'touchstart'];
const WRITE_EVERY_MS = 10 * 1000; // enregistrement de l'activité au plus toutes les 10 s
const CHECK_EVERY_MS = 1000;

const fmtCountdown = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function IdleLogout() {
  const { isAuthenticated, logout } = useAuth();
  const [remaining, setRemaining] = useState(null); // ms restantes pendant l'avertissement, sinon null
  const lastWrite = useRef(0);
  const done = useRef(false);

  // Délai écoulé : déconnexion « inactivité » (message sur l'écran de connexion, retour à la page après reconnexion)
  const expire = useCallback(() => {
    if (done.current) return;
    done.current = true;
    setRemaining(null);
    setLogoutReason('idle');
    const target = loginPathFor(window.location);
    logout('IDLE');
    window.location.assign(target);
  }, [logout]);

  // « Se déconnecter » dans l'avertissement : déconnexion ordinaire
  const leave = () => {
    done.current = true;
    setRemaining(null);
    logout();
  };

  const touch = useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - lastWrite.current < WRITE_EVERY_MS) return;
    lastWrite.current = now;
    markActivity(now);
  }, []);

  const check = useCallback(() => {
    const left = idleRemaining();
    if (left === null) { touch(true); return; }
    if (left <= 0) expire();
    else setRemaining(left <= IDLE_WARNING_MS ? left : null);
  }, [expire, touch]);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    done.current = false;
    // Session rouverte (rechargement, nouvel onglet) : expirée si l'inactivité dépasse déjà le délai
    if (lastActivity() === null) touch(true);
    check();

    // Pendant l'avertissement, un simple mouvement de souris ne suffit pas : il faut cliquer « Rester connecté »
    // (ou toute action réelle : clic, touche) — sinon l'avertissement disparaîtrait sans être lu
    const onActivity = (e) => {
      if (idleRemaining() <= IDLE_WARNING_MS && (e.type === 'mousemove' || e.type === 'scroll' || e.type === 'wheel')) return;
      touch();
    };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    // Activité dans un autre onglet : l'avertissement de celui-ci disparaît
    const onStorage = (e) => { if (e.key === ACTIVITY_KEY) check(); };

    ACTIVITY_EVENTS.forEach(ev => window.addEventListener(ev, onActivity, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('storage', onStorage);
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => {
      ACTIVITY_EVENTS.forEach(ev => window.removeEventListener(ev, onActivity, { capture: true }));
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('storage', onStorage);
      clearInterval(timer);
      setRemaining(null);
    };
  }, [isAuthenticated, check, touch]);

  if (!isAuthenticated || remaining === null) return null;

  const stay = () => { touch(true); setRemaining(null); };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4" data-testid="idle-warning">
      <div role="alertdialog" aria-modal="true" aria-labelledby="idle-title" aria-describedby="idle-desc"
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-amber-100 p-2 text-amber-700"><Clock size={22} aria-hidden="true" /></div>
          <div>
            <h2 id="idle-title" className="text-lg font-semibold text-gray-900">{t('auth.idle.title')}</h2>
            <p id="idle-desc" className="mt-1 text-sm text-gray-600">{t('auth.idle.message')}</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums text-gray-900" aria-live="polite" data-testid="idle-countdown">
              {fmtCountdown(remaining)}
            </p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={leave}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <LogOut size={16} /> {t('auth.idle.logout')}
          </button>
          <button type="button" onClick={stay} autoFocus data-testid="idle-stay"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            {t('auth.idle.stay')}
          </button>
        </div>
      </div>
    </div>
  );
}
