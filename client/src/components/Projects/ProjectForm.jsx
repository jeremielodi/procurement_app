// src/components/Projects/ProjectForm.jsx
import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { projectService } from '../../services/projectService';
import toast from 'react-hot-toast';
import { t } from '../../i18n';
import SearchSelect from '../Common/SearchSelect';

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
        toast.success(t('projects.updated'));
      } else {
        await projectService.create(formData);
        toast.success(t('projects.created'));
      }
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.message || t('common.error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">{t('projects.codeRequired')}</label>
          <input
            type="text"
            value={formData.code}
            onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            required
            placeholder={t('projects.codePlaceholder')}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t('projects.nameRequired')}</label>
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
        <label className="block text-sm font-medium mb-1">{t('common.description')}</label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          rows="3"
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        
        <div>
          <label className="block text-sm font-medium mb-1">{t('projects.projectManager')}</label>
          <SearchSelect
            value={formData.projectManagerId}
            onChange={(e) => setFormData({ ...formData, projectManagerId: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t('projects.select')}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.first_name} {user.last_name}
              </option>
            ))}
          </SearchSelect>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">{t('projects.startDate')}</label>
          <input
            type="date"
            value={formData.startDate}
            onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t('projects.endDate')}</label>
          <input
            type="date"
            value={formData.endDate}
            onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">{t('common.status')}</label>
        <SearchSelect
          value={formData.status}
          onChange={(e) => setFormData({ ...formData, status: e.target.value })}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
        >
          {['ACTIVE', 'COMPLETED', 'ON_HOLD', 'CANCELLED'].map(s => <option key={s} value={s}>{t(`projects.status.${s}`)}</option>)}
        </SearchSelect>
      </div>

      <div className="flex justify-end gap-3 pt-4">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 border rounded-lg hover:bg-gray-50"
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? t('supplierForm.saving') : (project ? t('supplierForm.update') : t('common.create'))}
        </button>
      </div>
    </form>
  );
}