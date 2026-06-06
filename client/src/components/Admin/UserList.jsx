// src/components/Admin/UserList.jsx
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit, Trash2, Ban, CheckCircle, Key, Search, Filter } from 'lucide-react';
import api from '../../services/api';
import Modal from '../Common/Modal';
import UserForm from './UserForm';
import toast from 'react-hot-toast';

export default function UserList() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({ search: '', is_active: 'all', page: 1 });
  const [showModal, setShowModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['users', filters],
    queryFn: () => api.get('/users', { params: filters })
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }) => api.patch(`/users/${id}/toggle-active`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries(['users']);
      toast.success('Statut modifié');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries(['users']);
      toast.success('Utilisateur supprimé');
    }
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({ id, password }) => api.post(`/users/${id}/reset-password`, { newPassword: password }),
    onSuccess: () => {
      toast.success('Mot de passe réinitialisé');
      setShowResetModal(false);
      setNewPassword('');
    }
  });

  let users = data?.data || [];
  const pagination = data?.pagination;
  if(users.data) {
    users = users.data;
  }
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800">Gestion des utilisateurs</h1>
        <button
          onClick={() => {
            setSelectedUser(null);
            setShowModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus size={18} />
          Nouvel utilisateur
        </button>
      </div>

      {/* Filtres */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Rechercher..."
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value, page: 1 })}
                className="w-full pl-10 pr-4 py-2 border rounded-lg"
              />
            </div>
          </div>
          <select
            value={filters.is_active}
            onChange={(e) => setFilters({ ...filters, is_active: e.target.value, page: 1 })}
            className="px-3 py-2 border rounded-lg"
          >
            <option value="all">Tous</option>
            <option value="true">Actifs</option>
            <option value="false">Bloqués</option>
          </select>
        </div>
      </div>

      {/* Tableau */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500">Utilisateur</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500">Email</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500">Département</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500">Profils</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500">Statut</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <div className="font-medium text-gray-900">{user.first_name} {user.last_name}</div>
                  <div className="text-sm text-gray-500">@{user.username}</div>
                </td>
                <td className="px-6 py-4 text-gray-600">{user.email}</td>
                <td className="px-6 py-4 text-gray-600">{user.department || '-'}</td>
                <td className="px-6 py-4">
                  <div className="flex flex-wrap gap-1">
                    {user.profile_names?.filter(n => n).map((profile, idx) => (
                      <span key={idx} className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-full">
                        {profile}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 text-xs rounded-full ${user.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {user.is_active ? 'Actif' : 'Bloqué'}
                  </span>
                </td>
                <td className="px-6 py-4 text-right space-x-2">
                  <button
                    onClick={() => {
                      setSelectedUser(user);
                      setShowModal(true);
                    }}
                    className="text-blue-600 hover:text-blue-800"
                    title="Modifier"
                  >
                    <Edit size={18} />
                  </button>
                  <button
                    onClick={() => {
                      setSelectedUser(user);
                      setShowResetModal(true);
                    }}
                    className="text-yellow-600 hover:text-yellow-800"
                    title="Réinitialiser mot de passe"
                  >
                    <Key size={18} />
                  </button>
                  <button
                    onClick={() => toggleActiveMutation.mutate({ id: user.id, isActive: !user.is_active })}
                    className={user.is_active ? 'text-red-600 hover:text-red-800' : 'text-green-600 hover:text-green-800'}
                    title={user.is_active ? 'Bloquer' : 'Débloquer'}
                  >
                    {user.is_active ? <Ban size={18} /> : <CheckCircle size={18} />}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Supprimer cet utilisateur ?')) {
                        deleteMutation.mutate(user.id);
                      }
                    }}
                    className="text-red-600 hover:text-red-800"
                    title="Supprimer"
                  >
                    <Trash2 size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && pagination.pages > 1 && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: pagination.pages }, (_, i) => (
            <button
              key={i}
              onClick={() => setFilters({ ...filters, page: i + 1 })}
              className={`px-3 py-1 rounded ${filters.page === i + 1 ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}

      {/* Modal Création/Modification */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={selectedUser ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'}
        size="lg"
        showFooter={false}
      >
        <UserForm user={selectedUser} onClose={() => setShowModal(false)} />
      </Modal>

      {/* Modal réinitialisation mot de passe */}
      <Modal
        isOpen={showResetModal}
        onClose={() => setShowResetModal(false)}
        title="Réinitialiser le mot de passe"
        confirmText="Réinitialiser"
        onConfirm={() => resetPasswordMutation.mutate({ id: selectedUser?.id, password: newPassword })}
        isLoading={resetPasswordMutation.isPending}
      >
        <div>
          <label className="block text-sm font-medium mb-1">Nouveau mot de passe</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg"
            placeholder="Au moins 6 caractères"
          />
        </div>
      </Modal>
    </div>
  );
}