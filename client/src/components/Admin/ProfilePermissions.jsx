// src/components/Admin/ProfilePermissions.jsx
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, Search, Shield, Lock, Unlock } from 'lucide-react';
import { profileService } from '../../services/profileService';
import toast from 'react-hot-toast';

export default function ProfilePermissions({ profile, onClose }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedResource, setSelectedResource] = useState('all');

  const { data: permissionsData } = useQuery({
    queryKey: ['permissions'],
    queryFn: () => profileService.getPermissions()
  });

  const { data: profilePermissionsData } = useQuery({
    queryKey: ['profile-permissions', profile?.id],
    queryFn: () => profileService.getProfilePermissions(profile?.id),
    enabled: !!profile?.id
  });

  const assignMutation = useMutation({
    mutationFn: ({ permissionId }) => profileService.assignPermission(profile.id, permissionId),
    onSuccess: () => {
      queryClient.invalidateQueries(['profile-permissions', profile.id]);
      queryClient.invalidateQueries(['profiles']);
      toast.success('Permission ajoutée');
    }
  });

  const removeMutation = useMutation({
    mutationFn: ({ permissionId }) => profileService.removePermission(profile.id, permissionId),
    onSuccess: () => {
      queryClient.invalidateQueries(['profile-permissions', profile.id]);
      queryClient.invalidateQueries(['profiles']);
      toast.success('Permission retirée');
    }
  });

  const allPermissions = permissionsData?.data || [];
  const profilePermissions = profilePermissionsData?.data || [];
  const profilePermissionIds = new Set(profilePermissions.map(p => p.id));

  // Grouper les permissions par resource
  const permissionsByResource = allPermissions.reduce((acc, perm) => {
    const resource = perm.resource || 'Autres';
    if (!acc[resource]) acc[resource] = [];
    acc[resource].push(perm);
    return acc;
  }, {});

  const resources = Object.keys(permissionsByResource);

  const filteredPermissions = allPermissions.filter(perm => {
    const matchesSearch = perm.name.toLowerCase().includes(search.toLowerCase()) ||
                          perm.description.toLowerCase().includes(search.toLowerCase());
    const matchesResource = selectedResource === 'all' || perm.resource === selectedResource;
    return matchesSearch && matchesResource;
  });

  const togglePermission = (permissionId) => {
    if (profilePermissionIds.has(permissionId)) {
      removeMutation.mutate({ permissionId });
    } else {
      assignMutation.mutate({ permissionId });
    }
  };

  if (profile?.id === 'prof_admin') {
    return (
      <div className="text-center py-8">
        <Shield size={48} className="mx-auto text-gray-400 mb-3" />
        <p className="text-gray-500">Le profil Administrateur a automatiquement toutes les permissions.</p>
        <p className="text-sm text-gray-400 mt-1">Il n'est pas possible de modifier ses permissions.</p>
        <button
          onClick={onClose}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Fermer
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filtres */}
      <div className="flex flex-wrap gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Rechercher une permission..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <select
          value={selectedResource}
          onChange={(e) => setSelectedResource(e.target.value)}
          className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">Toutes les ressources</option>
          {resources.map(resource => (
            <option key={resource} value={resource}>{resource}</option>
          ))}
        </select>
      </div>

      {/* Résumé */}
      <div className="bg-gray-50 rounded-lg p-3 flex justify-between items-center">
        <div>
          <span className="text-sm text-gray-600">Permissions assignées: </span>
          <span className="font-semibold text-blue-600">{profilePermissionIds.size}</span>
          <span className="text-sm text-gray-600"> / {allPermissions.length}</span>
        </div>
        <div className="text-xs text-gray-400">
          Cliquez sur une permission pour l'activer/désactiver
        </div>
      </div>

      {/* Liste des permissions par ressource */}
      <div className="max-h-96 overflow-y-auto border rounded-lg">
        {filteredPermissions.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            Aucune permission trouvée
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {selectedResource === 'all' ? (
              resources.map(resource => {
                const perms = permissionsByResource[resource].filter(p => 
                  p.name.toLowerCase().includes(search.toLowerCase()) ||
                  p.description.toLowerCase().includes(search.toLowerCase())
                );
                if (perms.length === 0) return null;
                return (
                  <div key={resource}>
                    <div className="bg-gray-50 px-4 py-2 font-medium text-gray-700 capitalize">
                      {resource}
                    </div>
                    {perms.map(permission => (
                      <PermissionItem
                        key={permission.id}
                        permission={permission}
                        isAssigned={profilePermissionIds.has(permission.id)}
                        onToggle={() => togglePermission(permission.id)}
                        isLoading={assignMutation.isPending || removeMutation.isPending}
                      />
                    ))}
                  </div>
                );
              })
            ) : (
              permissionsByResource[selectedResource]?.map(permission => (
                <PermissionItem
                  key={permission.id}
                  permission={permission}
                  isAssigned={profilePermissionIds.has(permission.id)}
                  onToggle={() => togglePermission(permission.id)}
                  isLoading={assignMutation.isPending || removeMutation.isPending}
                />
              ))
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end pt-4">
        <button
          onClick={onClose}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Fermer
        </button>
      </div>
    </div>
  );
}

// Composant pour un élément de permission
function PermissionItem({ permission, isAssigned, onToggle, isLoading }) {
  return (
    <div
      onClick={() => !isLoading && onToggle()}
      className={`flex items-center justify-between p-3 hover:bg-gray-50 transition-colors cursor-pointer ${
        isAssigned ? 'bg-green-50/30' : ''
      }`}
    >
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${isAssigned ? 'text-green-700' : 'text-gray-700'}`}>
            {permission.name}
          </span>
          {isAssigned && (
            <span className="px-1.5 py-0.5 text-xs bg-green-100 text-green-700 rounded-full">
              Activée
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{permission.description}</p>
        {permission.resource && (
          <p className="text-xs text-gray-400 mt-0.5">
            Resource: {permission.resource} / Action: {permission.action}
          </p>
        )}
      </div>
      <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
        isAssigned ? 'bg-green-500' : 'bg-gray-300'
      }`}>
        {isAssigned ? <Check size={14} className="text-white" /> : <X size={14} className="text-white" />}
      </div>
    </div>
  );
}