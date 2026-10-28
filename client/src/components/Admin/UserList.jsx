// src/components/Admin/UserList.jsx
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit, Trash2, Ban, CheckCircle, Key, Search, Filter, Laptop } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import Modal from '../Common/Modal';
import UserForm from './UserForm';
import UserAvatar from '../Common/UserAvatar';
import toast from 'react-hot-toast';
import { t } from '../../i18n';
import SearchSelect from '../Common/SearchSelect';
import { Table } from 'antd';

const PAGE_SIZE = 20;

export default function UserList() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({ search: '', is_active: 'all', page: 1, limit: PAGE_SIZE });
  const [showModal, setShowModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  // Départ : équipements encore détenus (409 HOLDS_EQUIPMENT) → récupérer ou désactiver quand même
  const [heldEquipment, setHeldEquipment] = useState(null); // { user, units }

  const { data, isLoading } = useQuery({
    queryKey: ['users', filters],
    queryFn: () => api.get('/users', { params: filters })
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive, force }) => api.patch(`/users/${id}/toggle-active`, { isActive, force }, { skipErrorToast: true }),
    onSuccess: () => {
      queryClient.invalidateQueries(['users']);
      setHeldEquipment(null);
      toast.success(t('users.statusChanged'));
    },
    onError: (error, variables) => {
      const data = error.response?.data;
      if (data?.code === 'HOLDS_EQUIPMENT') setHeldEquipment({ user: variables.user, units: data.data || [] });
      else toast.error(data?.message || t('common.errorOccurred'));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries(['users']);
      toast.success(t('users.deleted'));
    }
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({ id, password }) => api.post(`/users/${id}/reset-password`, { newPassword: password }),
    onSuccess: () => {
      toast.success(t('users.passwordReset'));
      setShowResetModal(false);
      setNewPassword('');
    }
  });

  let users = data?.data || [];
  const pagination = data?.pagination;
  if(users.data) {
    users = users.data;
  }

  // Colonnes du tableau antd (pagination côté serveur : page / limit envoyés à GET /users)
  const columns = [
    {
      title: t('users.user'),
      key: 'user',
      render: (_, user) => (
        <div className="flex items-center gap-3">
          <UserAvatar userId={user.id} version={user.avatar_updated_at} firstName={user.first_name} lastName={user.last_name} size={36} />
          <div>
            <div className="font-medium text-gray-900">{user.first_name} {user.last_name}</div>
            <div className="text-sm text-gray-500">@{user.username}</div>
          </div>
        </div>
      ),
    },
    { title: t('common.email'), dataIndex: 'email', key: 'email', render: (v) => <span className="text-gray-600">{v}</span> },
    { title: t('common.department'), dataIndex: 'department', key: 'department', render: (v) => <span className="text-gray-600">{v || '-'}</span> },
    // Poste = fonction imprimée sur les réquisitions et bons de commande (« Nom et titre », « Title »)
    { title: t('profile.position'), dataIndex: 'position', key: 'position', render: (v) => <span className="text-gray-600" data-testid="user-position-cell">{v || '-'}</span> },
    {
      title: t('users.profiles'),
      key: 'profiles',
      render: (_, user) => (
        <div className="flex flex-wrap gap-1">
          {user.profile_names?.filter(n => n).map((profile, idx) => (
            <span key={idx} className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-full">{profile}</span>
          ))}
        </div>
      ),
    },
    {
      title: t('common.status'),
      dataIndex: 'is_active',
      key: 'status',
      render: (active) => (
        <span className={`px-2 py-1 text-xs rounded-full ${active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {active ? t('users.activeOne') : t('users.blockedOne')}
        </span>
      ),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      align: 'right',
      render: (_, user) => (
        <div className="flex justify-end gap-2">
          <button
            onClick={() => {
              setSelectedUser(user);
              setShowModal(true);
            }}
            className="text-blue-600 hover:text-blue-800"
            title={t('common.edit')}
          >
            <Edit size={18} />
          </button>
          <button
            onClick={() => {
              setSelectedUser(user);
              setShowResetModal(true);
            }}
            className="text-yellow-600 hover:text-yellow-800"
            title={t('users.resetPassword')}
          >
            <Key size={18} />
          </button>
          <button
            onClick={() => toggleActiveMutation.mutate({ id: user.id, isActive: !user.is_active, user })}
            className={user.is_active ? 'text-red-600 hover:text-red-800' : 'text-green-600 hover:text-green-800'}
            title={user.is_active ? t('users.block') : t('users.unblock')}
          >
            {user.is_active ? <Ban size={18} /> : <CheckCircle size={18} />}
          </button>
          <button
            onClick={() => {
              if (confirm(t('users.confirmDelete'))) {
                deleteMutation.mutate(user.id);
              }
            }}
            className="text-red-600 hover:text-red-800"
            title={t('common.delete')}
          >
            <Trash2 size={18} />
          </button>
        </div>
      ),
    },
  ];
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800">{t('users.title')}</h1>
        <button
          onClick={() => {
            setSelectedUser(null);
            setShowModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus size={18} />
          {t('users.new')}
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
                placeholder={t('common.searchPlaceholder')}
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value, page: 1 })}
                className="w-full pl-10 pr-4 py-2 border rounded-lg"
              />
            </div>
          </div>
          <SearchSelect
            value={filters.is_active}
            onChange={(e) => setFilters({ ...filters, is_active: e.target.value, page: 1 })}
            className="px-3 py-2 border rounded-lg"
          >
            <option value="all">{t('users.all')}</option>
            <option value="true">{t('users.active')}</option>
            <option value="false">{t('users.blocked')}</option>
          </SearchSelect>
        </div>
      </div>

      {/* Tableau */}
      <div className="bg-white rounded-lg shadow overflow-hidden" data-testid="users-table">
        <Table
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={users}
          loading={isLoading}
          scroll={{ x: 'max-content' }}
          pagination={{
            current: filters.page,
            pageSize: filters.limit,
            total: pagination?.total || users.length,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total) => t('users.total', { count: total }),
            onChange: (page, limit) => setFilters(prev => ({ ...prev, page: limit !== prev.limit ? 1 : page, limit })),
          }}
        />
      </div>

      {/* Modal Création/Modification */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={selectedUser ? t('users.edit') : t('users.new')}
        size="lg"
        showFooter={false}
      >
        <UserForm user={selectedUser} onClose={() => setShowModal(false)} />
      </Modal>

      {/* Modal réinitialisation mot de passe */}
      <Modal
        isOpen={showResetModal}
        onClose={() => setShowResetModal(false)}
        title={t('users.resetTitle')}
        confirmText={t('users.reset')}
        onConfirm={() => resetPasswordMutation.mutate({ id: selectedUser?.id, password: newPassword })}
        isLoading={resetPasswordMutation.isPending}
      >
        <div>
          <label className="block text-sm font-medium mb-1">{t('users.newPassword')}</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg"
            placeholder={t('users.min6')}
          />
        </div>
      </Modal>

      <Modal
        isOpen={!!heldEquipment}
        onClose={() => setHeldEquipment(null)}
        title={t('users.holdsEquipmentTitle', { name: heldEquipment ? `${heldEquipment.user?.first_name || ''} ${heldEquipment.user?.last_name || ''}` : '' })}
        type="warning"
        confirmText={t('users.deactivateAnyway')}
        onConfirm={() => toggleActiveMutation.mutate({ id: heldEquipment.user.id, isActive: false, force: true, user: heldEquipment.user })}
        isLoading={toggleActiveMutation.isPending}
      >
        {heldEquipment && (
          <div className="space-y-3 text-sm text-gray-700">
            <p>{t('users.holdsEquipmentText', { count: heldEquipment.units.length })}</p>
            <ul className="max-h-48 overflow-auto rounded-lg border border-gray-200 divide-y">
              {heldEquipment.units.map(u => (
                <li key={u.id} className="flex items-center gap-2 px-3 py-1.5"><Laptop size={14} className="text-gray-400" /> {u.item_name} <span className="font-mono text-xs text-gray-500">{u.serial_number}</span></li>
              ))}
            </ul>
            <Link to={`/stock/returns/new?userId=${heldEquipment.user.id}`} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
              {t('users.recoverEquipment')}
            </Link>
            <p className="text-xs text-gray-500">{t('users.deactivateAnywayHint')}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}