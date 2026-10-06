// src/components/Admin/ProfileList.jsx
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit, Trash2, Shield, Users, Key, Eye } from 'lucide-react';
import { profileService } from '../../services/profileService';
import Modal from '../Common/Modal';
import ProfileForm from './ProfileForm';
import ProfilePermissions from './ProfilePermissions';
import toast from 'react-hot-toast';
import { useAuth } from '../../hooks/useAuth';
import { isSuperAdminUser } from '../../utils/accountType';
import { t } from '../../i18n';

export default function ProfileList() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState(null);
  // Rôles partagés par toutes les entreprises : seul le super admin procureApp les modifie
  const { user } = useAuth();
  const canEdit = isSuperAdminUser(user);

  const { data, isLoading } = useQuery({
    queryKey: ['profiles'],
    queryFn: () => profileService.getAll()
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => profileService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['profiles']);
      toast.success(t('profiles.deleted'));
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || t('requisitions.deleteError'));
    }
  });

  const profiles = data?.data || [];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{t('profiles.title')}</h1>
          <p className="text-gray-500 mt-1">{canEdit ? t('profiles.subtitleEdit') : t('profiles.subtitleRead')}</p>
        </div>
        {canEdit && <button
          onClick={() => {
            setSelectedProfile(null);
            setShowModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus size={18} />
          {t('profiles.new')}
        </button>}
      </div>

      {!canEdit && (
        <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800" data-testid="profiles-readonly">
          {t('profiles.readonly')}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg shadow p-6 animate-pulse">
              <div className="h-6 bg-gray-200 rounded w-3/4 mb-4"></div>
              <div className="h-4 bg-gray-200 rounded w-full mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-2/3"></div>
            </div>
          ))
        ) : profiles.length === 0 ? (
          <div className="col-span-full text-center py-12 bg-white rounded-lg shadow">
            <Shield size={48} className="mx-auto text-gray-400 mb-3" />
            <p className="text-gray-500">{t('profiles.none')}</p>
            {canEdit && <button
              onClick={() => setShowModal(true)}
              className="mt-2 text-blue-600 hover:text-blue-800"
            >
              {t('profiles.createFirst')}
            </button>}
          </div>
        ) : (
          profiles.map((profile) => (
            <div key={profile.id} className="bg-white rounded-lg shadow hover:shadow-md transition-shadow">
              <div className="p-6">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <Shield size={20} className="text-blue-500" />
                    <h3 className="text-lg font-semibold text-gray-800">{profile.name}</h3>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setSelectedProfile(profile);
                        setShowPermissionsModal(true);
                      }}
                      className="text-purple-600 hover:text-purple-800"
                      title={canEdit ? t('profiles.managePermissions') : t('profiles.viewPermissions')}
                    >
                      <Key size={18} />
                    </button>
                    {canEdit && <button
                      onClick={() => {
                        setSelectedProfile(profile);
                        setShowModal(true);
                      }}
                      className="text-blue-600 hover:text-blue-800"
                      title={t('common.edit')}
                    >
                      <Edit size={18} />
                    </button>}
                    {canEdit && profile.id !== 'prof_admin' && (
                      <button
                        onClick={() => {
                          if (confirm(t('profiles.confirmDelete', { name: profile.name }))) {
                            deleteMutation.mutate(profile.id);
                          }
                        }}
                        className="text-red-600 hover:text-red-800"
                        title={t('common.delete')}
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                </div>
                
                <p className="text-sm text-gray-600 mt-2">{profile.description}</p>
                
                <div className="mt-4 pt-4 border-t flex justify-between text-sm">
                  <div className="flex items-center gap-1 text-gray-500">
                    <Users size={14} />
                    <span>{t('profiles.users', { count: profile.user_count || 0 })}</span>
                  </div>
                  <div className="flex items-center gap-1 text-gray-500">
                    <Key size={14} />
                    <span>{t('profiles.permissions', { count: profile.permission_count || 0 })}</span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={selectedProfile ? t('profiles.edit') : t('profiles.new')}
        size="md"
        showFooter={false}
      >
        <ProfileForm
          profile={selectedProfile}
          onClose={() => {
            setShowModal(false);
            queryClient.invalidateQueries(['profiles']);
          }}
        />
      </Modal>

      <Modal
        isOpen={showPermissionsModal}
        onClose={() => setShowPermissionsModal(false)}
        title={t('profiles.permissionsTitle', { name: selectedProfile?.name })}
        size="xl"
        showFooter={false}
      >
        <ProfilePermissions
          profile={selectedProfile}
          readOnly={!canEdit}
          onClose={() => setShowPermissionsModal(false)}
        />
      </Modal>
    </div>
  );
}