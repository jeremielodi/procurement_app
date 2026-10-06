// src/contexts/AuthContext.jsx
import React, { createContext, useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../services/api';
import { t, setLang, onLangChange } from '../i18n';
import { connectRealtime, disconnectRealtime } from '../services/realtime';

export const AuthContext = createContext(null);

const clearStoredSession = () => {
  for (const storage of [localStorage, sessionStorage]) {
    storage.removeItem('token');
    storage.removeItem('user');
  }
};

export const AuthProvider = ({ children }) => {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Charger l'utilisateur à partir du token stocké
  useEffect(() => {
    const loadUser = async () => {
      const token = localStorage.getItem('token');

      if (!token) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await api.get('/auth/profile');
        const userData = response.data.data;
        // Langue du compte (interface + emails)
        if (userData.language) setLang(userData.language);
        setUser(userData);
        setIsAuthenticated(true);
        localStorage.setItem('user', JSON.stringify(userData));
        connectRealtime(token);
      } catch (error) {
        console.error('Error loading user:', error);
        clearStoredSession();
        setUser(null);
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadUser();
  }, []);

  const login = async (email, password) => {
    try {
      const response = await api.post('/auth/login', { email, password });
      const { token, user: userData } = response.data.data;
      
      // Une fois connecté, l'interface passe dans la langue du compte
      if (userData.language) setLang(userData.language);
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(userData));
      
      setUser(userData);
      setIsAuthenticated(true);
      connectRealtime(token);
      
      return { success: true, user: userData };
    } catch (error) {
      return { 
        success: false, 
        message: error.response?.data?.message || t('services.loginError') 
      };
    }
  };

  /**
   * Déconnexion : ferme le WebSocket, arrête les requêtes en cours / rafraîchissements
   * et vide le cache (aucune donnée de l'ancien compte ne reste en mémoire).
   * Les réponses 401 des requêtes encore en vol sont ignorées par api.js (plus de token).
   */
  const logout = useCallback(() => {
    // Trace côté serveur (journal d'audit) : token passé explicitement, la session locale est vidée juste après
    const token = localStorage.getItem('token');
    if (token) api.post('/auth/logout', {}, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    clearStoredSession();
    disconnectRealtime();
    queryClient.cancelQueries();
    queryClient.clear();
    toast.dismiss();
    setUser(null);
    setIsAuthenticated(false);
  }, [queryClient]);

  const updateUser = useCallback((updatedUser) => {
    setUser(updatedUser);
    localStorage.setItem('user', JSON.stringify(updatedUser));
  }, []);

  // Changement de langue (sélecteur) pendant la session : enregistré dans le compte,
  // pour la prochaine connexion et pour les emails envoyés à l'utilisateur
  useEffect(() => onLangChange(async (lang) => {
    // language absent : backend sans la colonne users.language (migration 10 non appliquée)
    if (!isAuthenticated || !user || user.language === undefined || user.language === lang) return;
    try {
      await api.put('/auth/language', { language: lang });
      updateUser({ ...user, language: lang });
    } catch (_) { /* toast via l'intercepteur ; la langue reste appliquée localement */ }
  }), [isAuthenticated, user, updateUser]);

  const value = {
    user,
    isLoading,
    isAuthenticated,
    login,
    logout,
    updateUser
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
