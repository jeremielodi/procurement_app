// src/components/Auth/ForgotPassword.jsx
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft, AlertCircle, CheckCircle } from 'lucide-react';
import api from '../../services/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sentMessage, setSentMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!/\S+@\S+\.\S+/.test(email)) {
      setError('Email invalide');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const { data } = await api.post('/auth/forgot-password', { email: email.trim() });
      setSentMessage(data.message);
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur, veuillez réessayer');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen login-bg-color flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-xl overflow-hidden">
        <div className="p-6 text-center login-card-header-bg">
          <center><img src='/images/procureapp-logo.svg' alt='procureApp' style={{ height: 52 }} /></center>
          <h1 className="text-2xl font-bold text-white">Mot de passe oublié</h1>
          <p className="text-blue-100 mt-2">Recevez un nouveau mot de passe par email</p>
        </div>

        {sentMessage ? (
          <div className="p-6 space-y-5">
            <div className="flex gap-3 p-4 rounded-lg bg-green-50 text-green-800">
              <CheckCircle size={20} className="shrink-0 mt-0.5" />
              <div className="text-sm space-y-2">
                <p>{sentMessage}</p>
                <p>Vérifiez votre boîte de réception (et les spams), puis changez ce mot de passe depuis <b>Mon profil</b> après connexion.</p>
              </div>
            </div>
            <Link to="/login" className="w-full btn-primary flex items-center justify-center gap-2 py-2 px-4 text-white rounded-lg">
              Retour à la connexion
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-5" noValidate>
            <p className="text-sm text-gray-600">
              Saisissez l'email de votre compte. Un nouveau mot de passe sera généré et vous sera envoyé ;
              l'ancien ne fonctionnera plus.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                autoFocus
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${error ? 'border-red-500' : 'border-gray-300'}`}
                placeholder="nom@entreprise.com"
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
              {isLoading ? 'Envoi...' : 'Recevoir un nouveau mot de passe'}
            </button>

            <Link to="/login" className="flex items-center justify-center gap-1 text-sm text-blue-600 hover:text-blue-800">
              <ArrowLeft size={14} /> Retour à la connexion
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
