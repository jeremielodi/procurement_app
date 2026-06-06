// src/components/Projects/ProjectDetail.jsx
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, UserMinus, Users, Calendar, Building2, User } from 'lucide-react';
import { projectService } from '../../services/projectService';
import toast from 'react-hot-toast';

export default function ProjectDetail({ project, onClose }) {
  const queryClient = useQueryClient();
  const [showAddMember, setShowAddMember] = useState(false);
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedRole, setSelectedRole] = useState('MEMBER');

  const { data: membersData } = useQuery({
    queryKey: ['project-members', project?.id],
    queryFn: () => projectService.getMembers(project?.id),
    enabled: !!project?.id
  });

  const { data: usersData } = useQuery({
    queryKey: ['available-users'],
    queryFn: () => projectService.getUsers()
  });

  const addMemberMutation = useMutation({
    mutationFn: ({ projectId, userId, role }) => projectService.addMember(projectId, userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries(['project-members', project?.id]);
      toast.success('Membre ajouté');
      setShowAddMember(false);
      setSelectedUser('');
    }
  });

  const removeMemberMutation = useMutation({
    mutationFn: ({ projectId, userId }) => projectService.removeMember(projectId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries(['project-members', project?.id]);
      toast.success('Membre retiré');
    }
  });

  const members = membersData?.data || [];
  const availableUsers = usersData?.data || [];
  const existingMemberIds = members.map(m => m.id);

  return (
    <div className="space-y-6">
      {/* Infos projet */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h3 className="font-semibold text-gray-800 mb-2">{project?.name}</h3>
        <p className="text-sm text-gray-600">{project?.description}</p>
        <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
          <div className="flex items-center gap-2 text-gray-500">
            <Building2 size={14} />
            <span>Département: {project?.department_name}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-500">
            <User size={14} />
            <span>Chef de projet: {project?.manager_first_name} {project?.manager_last_name}</span>
          </div>
          {(project?.start_date || project?.end_date) && (
            <div className="flex items-center gap-2 text-gray-500 col-span-2">
              <Calendar size={14} />
              <span>
                Période: {project?.start_date ? new Date(project.start_date).toLocaleDateString('fr-FR') : 'N/A'}
                {project?.end_date && ` → ${new Date(project.end_date).toLocaleDateString('fr-FR')}`}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Gestion des membres */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h4 className="font-semibold text-gray-800 flex items-center gap-2">
            <Users size={18} />
            Membres du projet ({members.length})
          </h4>
          <button
            onClick={() => setShowAddMember(!showAddMember)}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
          >
            <UserPlus size={16} />
            Ajouter
          </button>
        </div>

        {showAddMember && (
          <div className="bg-gray-50 rounded-lg p-4 mb-4 flex gap-3">
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="flex-1 px-3 py-2 border rounded-lg"
            >
              <option value="">Sélectionner un utilisateur</option>
              {availableUsers
                .filter(u => !existingMemberIds.includes(u.id))
                .map(user => (
                  <option key={user.id} value={user.id}>
                    {user.first_name} {user.last_name} ({user.email})
                  </option>
                ))}
            </select>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="w-32 px-3 py-2 border rounded-lg"
            >
              <option value="MEMBER">Membre</option>
              <option value="CONTRIBUTOR">Contributeur</option>
              <option value="OBSERVER">Observateur</option>
            </select>
            <button
              onClick={() => addMemberMutation.mutate({ projectId: project.id, userId: selectedUser, role: selectedRole })}
              disabled={!selectedUser || addMemberMutation.isPending}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              Ajouter
            </button>
          </div>
        )}

        <div className="space-y-2">
          {members.map((member) => (
            <div key={member.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <div>
                <p className="font-medium">{member.first_name} {member.last_name}</p>
                <p className="text-sm text-gray-500">{member.email}</p>
                <span className="text-xs text-blue-600">{member.role}</span>
              </div>
              <button
                onClick={() => {
                  if (confirm(`Retirer ${member.first_name} ${member.last_name} du projet ?`)) {
                    removeMemberMutation.mutate({ projectId: project.id, userId: member.id });
                  }
                }}
                className="text-red-500 hover:text-red-700"
              >
                <UserMinus size={18} />
              </button>
            </div>
          ))}
          {members.length === 0 && (
            <p className="text-center text-gray-500 py-4">Aucun membre dans ce projet</p>
          )}
        </div>
      </div>
    </div>
  );
}