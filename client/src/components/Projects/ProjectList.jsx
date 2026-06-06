// src/components/Projects/ProjectList.jsx
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit, Building2, Trash2, FolderOpen, Calendar, User, Users, Search } from 'lucide-react';
import { projectService } from '../../services/projectService';
import { departmentService } from '../../services/departmentService';
import Modal from '../Common/Modal';
import ProjectForm from './ProjectForm';
import ProjectDetail from './ProjectDetail';
import toast from 'react-hot-toast';

export default function ProjectList() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);

  const { data: projectsData, isLoading } = useQuery({
    queryKey: ['projects', { search, status }],
    queryFn: () => projectService.getAll({ search, status })
  });

  const { data: departmentsData } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentService.getAll()
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => projectService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['projects']);
      toast.success('Projet supprimé');
    }
  });

  let projects = projectsData?.data || [];
  const departments = departmentsData?.data || [];

  if(projects.data) {
    projects = projects.data;
  }
  const getDepartmentName = (deptId) => {
    const dept = departments.find(d => d.id === deptId);
    return dept?.name || '-';
  };

  const statusColors = {
    ACTIVE: 'bg-green-100 text-green-700',
    COMPLETED: 'bg-blue-100 text-blue-700',
    ON_HOLD: 'bg-yellow-100 text-yellow-700',
    CANCELLED: 'bg-red-100 text-red-700'
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800">Projets</h1>
        <button
          onClick={() => {
            setSelectedProject(null);
            setShowModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus size={18} />
          Nouveau projet
        </button>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-4">
        <div className="flex-1 max-w-md">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Rechercher un projet..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">Tous les statuts</option>
          <option value="ACTIVE">Actif</option>
          <option value="COMPLETED">Terminé</option>
          <option value="ON_HOLD">En pause</option>
          <option value="CANCELLED">Annulé</option>
        </select>
      </div>

      {/* Liste */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg shadow p-6 animate-pulse">
              <div className="h-6 bg-gray-200 rounded w-3/4 mb-4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-2/3"></div>
            </div>
          ))
        ) : projects.length === 0 ? (
          <div className="col-span-full text-center py-12 bg-white rounded-lg shadow">
            <FolderOpen size={48} className="mx-auto text-gray-400 mb-3" />
            <p className="text-gray-500">Aucun projet</p>
            <button
              onClick={() => setShowModal(true)}
              className="mt-2 text-blue-600 hover:text-blue-800"
            >
              Créer le premier projet
            </button>
          </div>
        ) : (
          (projects || []).map((project) => (
            <div key={project.id} className="bg-white rounded-lg shadow hover:shadow-md transition-shadow cursor-pointer"
                 onClick={() => {
                   setSelectedProject(project);
                   setShowDetailModal(true);
                 }}>
              <div className="p-6">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-800">{project.name}</h3>
                    <p className="text-sm text-gray-500">{project.code}</p>
                  </div>
                  <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => {
                        setSelectedProject(project);
                        setShowModal(true);
                      }}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      <Edit size={18} />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('Supprimer ce projet ?')) {
                          deleteMutation.mutate(project.id);
                        }
                      }}
                      className="text-red-600 hover:text-red-800"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
                
                <p className="text-sm text-gray-600 mt-2 line-clamp-2">{project.description}</p>
                
                <div className="mt-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Building2 size={14} />
                    <span>{getDepartmentName(project.department_id)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <User size={14} />
                    <span>Chef: {project.manager_first_name ? `${project.manager_first_name} ${project.manager_last_name}` : 'Non assigné'}</span>
                  </div>
                  {(project.start_date || project.end_date) && (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <Calendar size={14} />
                      <span>
                        {project.start_date && new Date(project.start_date).toLocaleDateString('fr-FR')}
                        {project.end_date && ` → ${new Date(project.end_date).toLocaleDateString('fr-FR')}`}
                      </span>
                    </div>
                  )}
                </div>
                
                <div className="mt-4 pt-4 border-t flex justify-between items-center">
                  <span className={`px-2 py-1 text-xs rounded-full ${statusColors[project.status] || 'bg-gray-100 text-gray-700'}`}>
                    {project.status === 'ACTIVE' ? 'Actif' : 
                     project.status === 'COMPLETED' ? 'Terminé' :
                     project.status === 'ON_HOLD' ? 'En pause' : 'Annulé'}
                  </span>
                  {project.member_count > 0 && (
                    <div className="flex items-center gap-1 text-sm text-gray-500">
                      <Users size={14} />
                      <span>{project.member_count} membre(s)</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={selectedProject ? 'Modifier le projet' : 'Nouveau projet'}
        size="lg"
        showFooter={false}
      >
        <ProjectForm
          project={selectedProject}
          onClose={() => {
            setShowModal(false);
            queryClient.invalidateQueries(['projects']);
          }}
        />
      </Modal>

      <Modal
        isOpen={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        title="Détails du projet"
        size="xl"
        showFooter={false}
      >
        <ProjectDetail project={selectedProject} onClose={() => setShowDetailModal(false)} />
      </Modal>
    </div>
  );
}