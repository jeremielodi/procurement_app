// src/components/Auth/ForgotPassword.jsx
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft, AlertCircle, CheckCircle } from 'lucide-react';
import api from '../../services/api';
import { t } from '../../i18n';
import LanguageSwitcher from '../Common/LanguageSwitcher';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sentMessage, setSentMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!/\S+@\S+\.\S+/.test(email)) {
      setError(t('auth.emailInvalid'));
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setSentMessage(t('auth.forgot.sent'));
    } catch (err) {
      setError(err.response?.data?.message || t('auth.forgot.genericError'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen login-bg-color flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-xl overflow-hidden">
        <div className="p-6 text-center login-card-header-bg">
          <div className="flex justify-end -mt-2 -mr-2 mb-1"><LanguageSwitcher dark /></div>
          <center><img src='/images/procureapp-logo.svg' alt='procureApp' style={{ height: 52 }} /></center>
          <h1 className="text-2xl font-bold text-white">{t('auth.forgot.title')}</h1>
          <p className="text-blue-100 mt-2">{t('auth.forgot.subtitle')}</p>
        </div>

        {sentMessage ? (
          <div className="p-6 space-y-5">
            <div className="flex gap-3 p-4 rounded-lg bg-green-50 text-green-800">
              <CheckCircle size={20} className="shrink-0 mt-0.5" />
              <div className="text-sm space-y-2">
                <p>{sentMessage}</p>
                <p>{t('auth.forgot.sentHint')}</p>
              </div>
            </div>
            <Link to="/login" className="w-full btn-primary flex items-center justify-center gap-2 py-2 px-4 text-white rounded-lg">
              {t('auth.forgot.backToLogin')}
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-5" noValidate>
            <p className="text-sm text-gray-600">
              {t('auth.forgot.intro')}
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.email')}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                autoFocus
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${error ? 'border-red-500' : 'border-gray-300'}`}
                placeholder={t('auth.emailPlaceholder')}
              />
              {error && (
                <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
                  <AlertCircle size={14} />
                  {error}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full btn-primary flex items-center justify-center gap-2 py-2 px-4 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {isLoading
                ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                : <Mail size={18} />}
              {isLoading ? t('auth.forgot.sending') : t('auth.forgot.submit')}
            </button>

            <Link to="/login" className="flex items-center justify-center gap-1 text-sm text-blue-600 hover:text-blue-800">
              <ArrowLeft size={14} /> {t('auth.forgot.backToLogin')}
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
