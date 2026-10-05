// src/contexts/AuthContext.jsx
import React, { createContext, useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../services/api';
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
      
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(userData));
      
      setUser(userData);
      setIsAuthenticated(true);
      connectRealtime(token);
      
      return { success: true, user: userData };
    } catch (error) {
      return { 
        success: false, 
        message: error.response?.data?.message || 'Erreur de connexion' 
      };
    }
  };

  /**
   * Déconnexion : ferme le WebSocket, arrête les requêtes en cours / rafraîchissements
   * et vide le cache (aucune donnée de l'ancien compte ne reste en mémoire).
   * Les réponses 401 des requêtes encore en vol sont ignorées par api.js (plus de token).
   */
  const logout = useCallback(() => {
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
