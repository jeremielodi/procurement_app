// src/components/Admin/UserForm.jsx
import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Check, FolderKanban } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AvatarPicker from '../Common/AvatarPicker';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { t, LANGUAGES } from '../../i18n';
import SearchSelect from '../Common/SearchSelect';
import { projectService } from '../../services/projectService';

export default function UserForm({ user, onClose }) {
  const queryClient = useQueryClient();
  const [avatarVersion, setAvatarVersion] = useState(user?.avatar_updated_at || null);
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
  const selectedScoped = profiles.filter(p => p.project_scoped && formData.profileIds.includes(p.id));
  // Profils à attribuer projet par projet : profils de workflow cochés, sans « Tous les projets »
  const perProjectProfiles = selectedScoped.filter(p => !formData.allProjectsProfileIds.includes(p.id));

  // Profils par projet (profils BPMN liés au projet) : [{ projectId, profileIds }] — null tant que la fiche
  // existante n'est pas chargée (rien n'est alors envoyé : inchangé côté serveur)
  const [projectRows, setProjectRows] = useState(user ? null : []);
  const { data: detailData } = useQuery({
    queryKey: ['user-detail', user?.id],
    queryFn: () => api.get(`/users/${user.id}`),
    enabled: !!user?.id
  });
  useEffect(() => {
    const projects = detailData?.data?.data?.projects;
    if (projects && projectRows === null) {
      setProjectRows(projects.map(p => ({ projectId: p.id, profileIds: p.profile_ids || [] })));
    }
  }, [detailData, projectRows]);
  const { data: projectsData } = useQuery({
    queryKey: ['projects-for-user-form'],
    queryFn: () => projectService.getAll({ is_active: true })
  });
  const allProjects = projectsData?.data || [];

  const setRow = (index, patch) => setProjectRows(rows => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const toggleRowProfile = (index, profileId) => setProjectRows(rows => rows.map((r, i) => (i !== index ? r : {
    ...r,
    profileIds: r.profileIds.includes(profileId) ? r.profileIds.filter(id => id !== profileId) : [...r.profileIds, profileId]
  })));
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
    // Profils par projet : seulement les profils encore cochés sur la fiche ; lignes sans projet ignorées
    const data = projectRows === null ? formData : {
      ...formData,
      projectProfiles: projectRows.filter(r => r.projectId).map(r => ({
        projectId: r.projectId,
        profileIds: r.profileIds.filter(id => formData.profileIds.includes(id))
      }))
    };
    if (user) {
      updateMutation.mutate({ id: user.id, data });
    } else {
      createMutation.mutate(data);
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
      {/* Photo de profil (modification seulement : enregistrée tout de suite, indépendamment du formulaire) */}
      {user && (
        <AvatarPicker userId={user.id} version={avatarVersion} firstName={user.first_name} lastName={user.last_name} size={64}
          onChange={(v) => { setAvatarVersion(v); queryClient.invalidateQueries({ queryKey: ['users'] }); }} />
      )}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">{t('users.username')}</label>
          <input
            type="text"
            name="username"
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
            name="email"
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
              name="password"
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
            name="firstName"
            value={formData.firstName}
            onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t('profile.lastName')}</label>
          <input
            type="text"
            name="lastName"
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

        {/* Profils par projet : ex. Manager sur le projet A, Demandeur sur le projet B */}
        <div className="mt-3 rounded-lg border border-gray-200 p-3" data-testid="project-profiles">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-sm font-medium flex items-center gap-1.5"><FolderKanban size={15} /> {t('users.projectsTitle')}</p>
            <button
              type="button"
              disabled={projectRows === null}
              onClick={() => setProjectRows(rows => [...rows, { projectId: '', profileIds: perProjectProfiles.map(p => p.id) }])}
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
              data-testid="add-project-row"
            >
              <Plus size={15} /> {t('users.addProject')}
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-2">{t('users.projectProfilesHint')}</p>

          {projectRows === null ? (
            <p className="text-xs text-gray-400">{t('users.loadingProjects')}</p>
          ) : projectRows.length === 0 ? (
            <p className="text-xs text-gray-500">{t('users.noProjects')}</p>
          ) : (
            <ul className="space-y-2">
              {projectRows.map((row, index) => (
                <li key={index} className="rounded-lg bg-gray-50 p-2" data-testid="project-row">
                  <div className="flex items-center gap-2">
                    <SearchSelect
                      value={row.projectId}
                      onChange={(e) => setRow(index, { projectId: e.target.value })}
                      className="flex-1 px-3 py-1.5 border rounded-lg text-sm"
                      data-testid="project-row-project"
                    >
                      <option value="">{t('users.selectProject')}</option>
                      {allProjects
                        .filter(p => p.id === row.projectId || !projectRows.some(r => r.projectId === p.id))
                        .map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                    </SearchSelect>
                    <button type="button" onClick={() => setProjectRows(rows => rows.filter((_, i) => i !== index))}
                      className="p-1.5 text-red-500 hover:text-red-700" title={t('users.removeProject')} aria-label={t('users.removeProject')}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {perProjectProfiles.length === 0 ? (
                      <span className="text-xs text-gray-500 italic">{t('users.noProjectProfile')}</span>
                    ) : perProjectProfiles.map(p => {
                      const on = row.profileIds.includes(p.id);
                      return (
                        <button key={p.id} type="button" onClick={() => toggleRowProfile(index, p.id)} aria-pressed={on}
                          data-testid={`project-row-profile-${p.id}`}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors ${
                            on ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-white text-gray-600 ring-1 ring-gray-300 hover:bg-gray-100'
                          }`}>
                          {on && <Check size={12} />} {p.name}
                        </button>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
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