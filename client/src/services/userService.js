// src/services/userService.js
import api from './api'

export const userService = {
  // Récupérer tous les utilisateurs
  getAll: async () => {
    const response = await api.get('/users')
    return response.data
  },

  // Récupérer un utilisateur par ID
  getById: async (id) => {
    const response = await api.get(`/users/${id}`)
    return response.data
  },

  // Récupérer le profil de l'utilisateur connecté
  getProfile: async () => {
    const response = await api.get('/users/profile')
    return response.data
  },

  // Mettre à jour le profil
  updateProfile: async (data) => {
    const response = await api.put('/users/profile', data)
    return response.data
  },

  // Changer le mot de passe
  changePassword: async (oldPassword, newPassword) => {
    const response = await api.post('/users/change-password', { oldPassword, newPassword })
    return response.data
  },

  // Récupérer les utilisateurs par rôle
  getByRole: async (role) => {
    const response = await api.get(`/users/role/${role}`)
    return response.data
  }
}