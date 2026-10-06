// src/components/Auth/ResetPasswordConfirm.jsx
// Page publique ouverte depuis l'email « mot de passe oublié » : le mot de passe n'est remplacé
// qu'au clic sur « Confirmer » (POST, jamais au simple chargement de la page).
import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { KeyRound, AlertCircle, CheckCircle } from 'lucide-react';
import api from '../../services/api';
import { t } from '../../i18n';
import LanguageSwitcher from '../Common/LanguageSwitcher';

export default function ResetPasswordConfirm() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [state, setState] = useState(token ? 'idle' : 'missing'); // idle | loading | done | invalid | emailFailed | error | missing

  const handleConfirm = async () => {
    setState('loading');
    try {
      await api.post('/auth/reset-password/confirm', { token });
      setState('done');
    } catch (err) {
      const code = err.response?.data?.code;
      setState(code === 'INVALID_LINK' ? 'invalid' : code === 'EMAIL_FAILED' ? 'emailFailed' : 'error');
    }
  };

  const errorText = {
    invalid: t('auth.reset.invalid'),
    emailFailed: t('auth.reset.emailFailed'),
    error: t('auth.forgot.genericError'),
    missing: t('auth.reset.missingToken'),
  }[state];

  return (
    <div className="min-h-screen login-bg-color flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-xl overflow-hidden">
        <div className="p-6 text-center login-card-header-bg">
          <div className="flex justify-end -mt-2 -mr-2 mb-1"><LanguageSwitcher dark /></div>
          <center><img src='/images/procureapp-logo.svg' alt='procureApp' style={{ height: 52 }} /></center>
          <h1 className="text-2xl font-bold text-white">{t('auth.reset.title')}</h1>
          <p className="text-blue-100 mt-2">{t('auth.reset.subtitle')}</p>
        </div>

        <div className="p-6 space-y-5">
          {state === 'done' ? (
            <>
              <div className="flex gap-3 p-4 rounded-lg bg-green-50 text-green-800">
                <CheckCircle size={20} className="shrink-0 mt-0.5" />
                <div className="text-sm space-y-2">
                  <p>{t('auth.reset.done')}</p>
                  <p>{t('auth.reset.doneHint')}</p>
                </div>
              </div>
              <Link to="/login" className="w-full btn-primary flex items-center justify-center gap-2 py-2 px-4 text-white rounded-lg">
                {t('auth.forgot.backToLogin')}
              </Link>
            </>
          ) : errorText ? (
            <>
              <div className="flex gap-3 p-4 rounded-lg bg-red-50 text-red-800">
                <AlertCircle size={20} className="shrink-0 mt-0.5" />
                <p className="text-sm">{errorText}</p>
              </div>
              {state === 'error' || state === 'emailFailed' ? (
                <button onClick={handleConfirm} className="w-full btn-primary py-2 px-4 text-white rounded-lg">
                  {t('auth.reset.confirm')}
                </button>
              ) : (
                <Link to="/forgot-password" className="w-full btn-primary flex items-center justify-center py-2 px-4 text-white rounded-lg">
                  {t('auth.reset.newRequest')}
                </Link>
              )}
              <Link to="/login" className="block text-center text-sm text-blue-600 hover:text-blue-800">
                {t('auth.forgot.backToLogin')}
              </Link>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600">{t('auth.reset.intro')}</p>
              <button
                onClick={handleConfirm}
                disabled={state === 'loading'}
                className="w-full btn-primary flex items-center justify-center gap-2 py-2 px-4 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {state === 'loading'
                  ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  : <KeyRound size={18} />}
                {state === 'loading' ? t('auth.reset.confirming') : t('auth.reset.confirm')}
              </button>
              <Link to="/login" className="block text-center text-sm text-blue-600 hover:text-blue-800">
                {t('auth.reset.notMe')}
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
