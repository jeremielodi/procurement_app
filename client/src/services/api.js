// src/services/api.js
import axios from 'axios'
import toast from 'react-hot-toast'
import { t, getLang } from '../i18n'

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
})

// Intercepteur pour ajouter le token à chaque requête
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    // Langue de l'interface (messages / documents du backend)
    config.headers['Accept-Language'] = getLang()
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Intercepteur pour les erreurs
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isCancel(error)) return Promise.reject(error)

    // Requête partie avec un token qui n'est plus le token courant (déconnexion / changement de compte) :
    // réponse obsolète, ni message ni redirection
    const sentAuth = error.config?.headers?.Authorization
    const currentToken = localStorage.getItem('token')
    if (sentAuth && sentAuth !== `Bearer ${currentToken}`) return Promise.reject(error)

    // Si erreur 401 (non autorisé), rediriger vers login
    if (error.response?.status === 401) {
      // Pas de session (déjà déconnecté, ex. login / mot de passe oublié) : l'appelant gère l'erreur
      if (!currentToken) return Promise.reject(error)
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
      toast.error(t('services.sessionExpired'))
      return Promise.reject(error)
    }
    
    // L'appelant affiche lui-même un message adapté (ex. erreurs métier traduites du bon de réception)
    if (error.config?.skipErrorToast) return Promise.reject(error)

    const message = error.response?.data?.message || t('common.errorOccurred')
    toast.error(message)
    return Promise.reject(error)
  }
)

export default api