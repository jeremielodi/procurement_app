// src/components/Admin/UserForm.jsx
import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { t, LANGUAGES } from '../../i18n';
import SearchSelect from '../Common/SearchSelect';

export default function UserForm({ user, onClose }) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    department: '',
    position: '',
    language: LANGUAGES[0].code,
    profileIds: [],
    // Profils de workflow exercés sur tous les projets (sinon : projets où ils sont attribués au membre)
    allProjectsProfileIds: []
  });

  const { data: profilesData } = useQuery({
    queryKey: ['profiles'],
    queryFn: () => api.get('/users/profiles')
  });

  let profiles = profilesData?.data || [];

  if(profiles.data) {
    profiles = profiles.data;
  }
  const profileName = new Map(profiles.map(p => [p.id, p.name]));
  const selectedScoped = profiles.filter(p => p.project_scoped && formData.profileIds.includes(p.id));

  // Fiche existante : projets et profils de workflow exercés sur chacun (lecture seule, modifiés sur la fiche du projet)
  const { data: detailData } = useQuery({
    queryKey: ['user-detail', user?.id],
    queryFn: () => api.get(`/users/${user.id}`),
    enabled: !!user?.id
  });
  const userProjects = detailData?.data?.data?.projects || [];
  useEffect(() => {
    if (user) {
      setFormData({
        username: user.username || '',
        email: user.email || '',
        password: '',
        firstName: user.first_name || '',
        lastName: user.last_name || '',
        department: user.department || '',
        position: user.position || '',
        language: user.language || LANGUAGES[0].code,
        profileIds: user.profile_ids?.filter(id => id) || [],
        allProjectsProfileIds: user.all_projects_profile_ids?.filter(id => id) || []
      });
    }
  }, [user]);

  const createMutation = useMutation({
    mutationFn: (data) => api.post('/users', data),
    onSuccess: () => {
      queryClient.invalidateQueries(['users']);
      toast.success(t('users.created'));
      onClose();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.put(`/users/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['users']);
      toast.success(t('users.updated'));
      onClose();
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (user) {
      updateMutation.mutate({ id: user.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const toggleProfile = (profileId) => {
    setFormData(prev => {
      const removing = prev.profileIds.includes(profileId);
      return {
        ...prev,
        profileIds: removing ? prev.profileIds.filter(id => id !== profileId) : [...prev.profileIds, profileId],
        allProjectsProfileIds: removing ? prev.allProjectsProfileIds.filter(id => id !== profileId) : prev.allProjectsProfileIds
      };
    });
  };

  const toggleAllProjects = (profileId) => {
    setFormData(prev => ({
      ...prev,
      allProjectsProfileIds: prev.allProjectsProfileIds.includes(profileId)
        ? prev.allProjectsProfileIds.filter(id => id !== profileId)
        : [...prev.allProjectsProfileIds, profileId]
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">{t('users.username')}</label>
          <input
            type="text"
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg"
            required
            disabled={!!user}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t('users.emailRequired')}</label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg"
            required
            disabled={!!user}
          />
        </div>
        {!user && (
          <div>
            <label className="block text-sm font-medium mb-1">{t('users.passwordRequired')}</label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
              required
              minLength={6}
            />
          </div>
        )}
        <div>
          <label className="block text-sm font-medium mb-1">{t('profile.firstName')}</label>
          <input
            type="text"
            value={formData.firstName}
            onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t('profile.lastName')}</label>
          <input
            type="text"
            value={formData.lastName}
            onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t('common.department')}</label>
          <input
            type="text"
            value={formData.department}
            onChange={(e) => setFormData({ ...formData, department: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t('profile.position')}</label>
          <input
            type="text"
            value={formData.position}
            onChange={(e) => setFormData({ ...formData, position: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t('users.language')}</label>
          <SearchSelect value={formData.language} onChange={(e) => setFormData({ ...formData, language: e.target.value })} className="w-full px-3 py-2 border rounded-lg">
            {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
          </SearchSelect>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">{t('users.bpmnProfiles')}</label>
        <div className="flex flex-wrap gap-2">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              onClick={() => toggleProfile(profile.id)}
              className={`px-3 py-1 rounded-full text-sm transition-colors ${
                formData.profileIds.includes(profile.id)
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              {profile.name}
            </button>
          ))}
        </div>

        {selectedScoped.length > 0 && (
          <div className="mt-3 rounded-lg border border-gray-200 p-3" data-testid="all-projects-options">
            <p className="text-xs text-gray-500 mb-2">{t('users.allProjectsHint')}</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {selectedScoped.map(profile => (
                <label key={profile.id} className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    data-testid={`all-projects-${profile.id}`}
                    checked={formData.allProjectsProfileIds.includes(profile.id)}
                    onChange={() => toggleAllProjects(profile.id)}
                  />
                  {profile.name} — {t('users.allProjects')}
                </label>
              ))}
            </div>
          </div>
        )}

        {user && (
          <div className="mt-3">
            <p className="text-sm font-medium mb-1">{t('users.projectsTitle')}</p>
            {userProjects.length === 0 ? (
              <p className="text-xs text-gray-500">{t('users.noProjects')}</p>
            ) : (
              <ul className="text-xs text-gray-700 space-y-1" data-testid="user-projects">
                {userProjects.map(p => (
                  <li key={p.id}>
                    <span className="font-medium">{p.code}</span> — {p.name} :{' '}
                    {p.profile_ids.length
                      ? p.profile_ids.map(id => profileName.get(id) || id).join(', ')
                      : <span className="italic text-gray-500">{t('users.noProjectProfile')}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-4">
        <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
          {t('common.cancel')}
        </button>
        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          {user ? t('supplierForm.update') : t('common.create')}
        </button>
      </div>
    </form>
  );
}