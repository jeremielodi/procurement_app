// src/components/Projects/ProjectForm.jsx
import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { projectService } from '../../services/projectService';
import toast from 'react-hot-toast';

export default function ProjectForm({ project, onClose }) {
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    description: '',
    projectManagerId: '',
    startDate: null,
    endDate: null,
    status: 'ACTIVE'
  });
  const [isSubmitting, setIsSubmitting] = useState(false);


  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => projectService.getUsers()
  });

  const users = usersData?.data || [];

  useEffect(() => {
    if (project) {
      setFormData({
        code: project.code || '',
        name: project.name || '',
        description: project.description || '',
        projectManagerId: project.project_manager_id || '',
        startDate: project.start_date,
        endDate: project.end_date,
        isActive: project.is_active,
        status: project.status || 'ACTIVE'
      });
    }
  }, [project]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (project) {
        await projectService.update(project.id, formData);
        toast.success('Projet modifié');
      } else {
        await projectService.create(formData);
        toast.success('Projet créé');
      }
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Erreur');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Code *</label>
          <input
            type="text"
            value={formData.code}
            onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            required
            placeholder="EX: PROJ-001"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Nom *</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Description</label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          rows="3"
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        
        <div>
          <label className="block text-sm font-medium mb-1">Chef de projet</label>
          <select
            value={formData.projectManagerId}
            onChange={(e) => setFormData({ ...formData, projectManagerId: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Sélectionner</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.first_name} {user.last_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Date début</label>
          <input
            type="date"
            value={formData.startDate}
            onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Date fin</label>
          <input
            type="date"
            value={formData.endDate}
            onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Statut</label>
        <select
          value={formData.status}
          onChange={(e) => setFormData({ ...formData, status: e.target.value })}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
        >
          <option value="ACTIVE">Actif</option>
          <option value="COMPLETED">Terminé</option>
          <option value="ON_HOLD">En pause</option>
          <option value="CANCELLED">Annulé</option>
        </select>
      </div>

      <div className="flex justify-end gap-3 pt-4">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 border rounded-lg hover:bg-gray-50"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? 'Enregistrement...' : (project ? 'Mettre à jour' : 'Créer')}
        </button>
      </div>
    </form>
  );
}