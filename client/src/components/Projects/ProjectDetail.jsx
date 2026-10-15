// src/components/Projects/ProjectDetail.jsx
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, UserMinus, Users, Calendar, Building2, User, Check, Globe, Info, ShieldCheck } from 'lucide-react';
import { projectService } from '../../services/projectService';
import toast from 'react-hot-toast';
import { t, getLocale } from '../../i18n';
import SearchSelect from '../Common/SearchSelect';
import { policySummary } from '../../utils/approvalPolicy';
import UserAvatar from '../Common/UserAvatar';

const apiError = (error) => {
  const code = error?.response?.data?.code;
  const key = code && `projects.err.${code}`;
  const translated = key && t(key);
  return translated && translated !== key ? translated : (error?.response?.data?.message || t('common.errorOccurred'));
};

/**
 * Profils de workflow d'un membre sur ce projet (profils BPMN liés au projet) : un clic active / retire le profil ;
 * « Tous les projets » (fiche de l'utilisateur) : affiché, non modifiable ici
 */
function MemberProfiles({ member, pending, onToggle }) {
  if (!member.profiles?.length) {
    return <p className="text-xs text-gray-400 italic mt-1">{t('projects.noWorkflowProfile')}</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5 mt-2" data-testid="member-profiles" role="group" aria-label={t('projects.workflowProfiles')}>
      {member.profiles.map(p => p.allProjects ? (
        <span key={p.id} title={t('projects.allProjectsTitle')}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200">
          <Globe size={12} /> {p.name} · {t('projects.allProjects')}
        </span>
      ) : (
        <button key={p.id} type="button" disabled={pending} onClick={() => onToggle(p)}
          aria-pressed={p.assigned} data-testid={`member-profile-${p.id}`}
          title={t(p.assigned ? 'projects.profileOn' : 'projects.profileOff', { profile: p.name })}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors disabled:opacity-50 ${
            p.assigned ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-600 ring-1 ring-gray-200 hover:bg-gray-200'
          }`}>
          {p.assigned && <Check size={12} />} {p.name}
        </button>
      ))}
    </div>
  );
}

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

  // Seuils d'approbation effectifs du projet (propres, sinon de l'entreprise, sinon par défaut)
  const { data: policyData } = useQuery({
    queryKey: ['project-approval-policy', project?.id],
    queryFn: () => projectService.getApprovalPolicy(project.id),
    enabled: !!project?.id
  });
  const approvalPolicy = policyData?.data || null;

  const { data: usersData } = useQuery({
    queryKey: ['available-users'],
    queryFn: () => projectService.getUsers()
  });

  const addMemberMutation = useMutation({
    mutationFn: ({ projectId, userId, role }) => projectService.addMember(projectId, userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries(['project-members', project?.id]);
      toast.success(t('projects.memberAdded'));
      setShowAddMember(false);
      setSelectedUser('');
    },
    onError: (error) => toast.error(apiError(error))
  });

  const profilesMutation = useMutation({
    mutationFn: ({ userId, profileIds }) => projectService.setMemberProfiles(project.id, userId, profileIds),
    onSuccess: () => {
      queryClient.invalidateQueries(['project-members', project?.id]);
      toast.success(t('projects.profilesUpdated'));
    },
    onError: (error) => toast.error(apiError(error))
  });

  const toggleProfile = (member, profile) => {
    const current = member.profiles.filter(p => p.assigned && !p.allProjects).map(p => p.id);
    const profileIds = profile.assigned ? current.filter(id => id !== profile.id) : [...current, profile.id];
    profilesMutation.mutate({ userId: member.id, profileIds });
  };

  const removeMemberMutation = useMutation({
    mutationFn: ({ projectId, userId }) => projectService.removeMember(projectId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries(['project-members', project?.id]);
      toast.success(t('projects.memberRemoved'));
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
            <span>{t('projects.department', { name: project?.department_name || '' })}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-500">
            <User size={14} />
            <span>{t('projects.manager', { name: `${project?.manager_first_name || ''} ${project?.manager_last_name || ''}`.trim() })}</span>
          </div>
          {approvalPolicy && (
            <div className="flex items-start gap-2 text-gray-500 col-span-2" data-testid="project-approval-policy-summary">
              <ShieldCheck size={14} className="mt-0.5" />
              <span>{t('approvalPolicy.projectLine', { summary: policySummary(approvalPolicy), source: t(`approvalPolicy.source.${approvalPolicy.source}`) })}</span>
            </div>
          )}
          {(project?.start_date || project?.end_date) && (
            <div className="flex items-center gap-2 text-gray-500 col-span-2">
              <Calendar size={14} />
              <span>
                {t('projects.period', { start: project?.start_date ? new Date(project.start_date).toLocaleDateString(getLocale()) : t('common.na') })}
                {project?.end_date && ` → ${new Date(project.end_date).toLocaleDateString(getLocale())}`}
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
            {t('projects.members', { count: members.length })}
          </h4>
          <button
            onClick={() => setShowAddMember(!showAddMember)}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
          >
            <UserPlus size={16} />
            {t('common.add')}
          </button>
        </div>

        <p className="text-xs text-gray-500 mb-3 flex gap-1.5"><Info size={14} className="shrink-0 mt-0.5" /> {t('projects.workflowProfilesHint')}</p>

        {showAddMember && (
          <div className="bg-gray-50 rounded-lg p-4 mb-4 flex flex-wrap gap-3">
            <SearchSelect
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="flex-1 px-3 py-2 border rounded-lg"
            >
              <option value="">{t('projects.selectUser')}</option>
              {availableUsers
                .filter(u => !existingMemberIds.includes(u.id))
                .map(user => (
                  <option key={user.id} value={user.id}>
                    {user.first_name} {user.last_name} ({user.email})
                  </option>
                ))}
            </SearchSelect>
            <SearchSelect
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="w-32 px-3 py-2 border rounded-lg"
            >
              {['MEMBER', 'CONTRIBUTOR', 'OBSERVER'].map(r => <option key={r} value={r}>{t(`projects.roles.${r}`)}</option>)}
            </SearchSelect>
            <button
              onClick={() => addMemberMutation.mutate({ projectId: project.id, userId: selectedUser, role: selectedRole })}
              disabled={!selectedUser || addMemberMutation.isPending}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {t('common.add')}
            </button>
            <p className="w-full text-xs text-gray-500">{t('projects.addProfilesHint')}</p>
          </div>
        )}

        <div className="space-y-2">
          {members.map((member) => (
            <div key={member.id} className="flex justify-between items-start gap-3 p-3 bg-gray-50 rounded-lg" data-testid="project-member">
              <UserAvatar userId={member.id} version={member.avatar_updated_at} firstName={member.first_name} lastName={member.last_name} size={40} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{member.first_name} {member.last_name}</p>
                <p className="text-sm text-gray-500">{member.email}</p>
                <span className="text-xs text-blue-600">{t(`projects.roles.${member.role}`, { defaultValue: member.role })}</span>
                <MemberProfiles member={member} pending={profilesMutation.isPending} onToggle={(p) => toggleProfile(member, p)} />
              </div>
              <button
                onClick={() => {
                  if (confirm(t('projects.confirmRemove', { name: `${member.first_name} ${member.last_name}` }))) {
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
            <p className="text-center text-gray-500 py-4">{t('projects.noMembers')}</p>
          )}
        </div>
      </div>
    </div>
  );
}