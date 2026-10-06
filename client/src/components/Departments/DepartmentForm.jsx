// src/components/Departments/DepartmentForm.jsx
import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { departmentService } from '../../services/departmentService';
import { AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { t } from '../../i18n';

export default function DepartmentForm({ department, onClose }) {
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    description: '',
    managerId: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => departmentService.getUsers()
  });

  const users = usersData?.data || [];

  useEffect(() => {
    if (department) {
      setFormData({
        code: department.code || '',
        name: department.name || '',
        description: department.description || '',
        managerId: department.manager_id || ''
      });
    }
  }, [department]);

  const validate = () => {
    const newErrors = {};
    
    if (!formData.code.trim()) {
      newErrors.code = t('departments.codeRequired');
    }
    
    if (!formData.name.trim()) {
      newErrors.name = t('departments.nameRequired');
    }
    
    if (!formData.managerId) {
      newErrors.managerId = t('departments.managerRequired');
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validate()) {
      toast.error(t('departments.fixErrors'));
      return;
    }
    
    setIsSubmitting(true);
    try {
      if (department) {
        await departmentService.update(department.id, formData);
        toast.success(t('departments.updated'));
      } else {
        await departmentService.create(formData);
        toast.success(t('departments.created'));
      }
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.message || t('budget.saveError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Effacer l'erreur du champ
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Code */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('common.code')} <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={formData.code}
          onChange={(e) => handleChange('code', e.target.value.toUpperCase())}
          className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
            errors.code ? 'border-red-500' : 'border-gray-300'
          }`}
          required
          placeholder={t('departments.codePlaceholder')}
        />
        {errors.code && (
          <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
            <AlertCircle size={14} />
            {errors.code}
          </p>
        )}
      </div>

      {/* Nom */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('common.name')} <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => handleChange('name', e.target.value)}
          className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
            errors.name ? 'border-red-500' : 'border-gray-300'
          }`}
          required
          placeholder={t('departments.namePlaceholder')}
        />
        {errors.name && (
          <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
            <AlertCircle size={14} />
            {errors.name}
          </p>
        )}
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('common.description')}
        </label>
        <textarea
          value={formData.description}
          onChange={(e) => handleChange('description', e.target.value)}
          rows="3"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          placeholder={t('departments.descriptionPlaceholder')}
        />
      </div>

      {/* Manager (requis) */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('departments.manager')} <span className="text-red-500">*</span>
        </label>
        <select
          value={formData.managerId}
          onChange={(e) => handleChange('managerId', e.target.value)}
          className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
            errors.managerId ? 'border-red-500' : 'border-gray-300'
          }`}
          required
        >
          <option value="">{t('departments.selectManager')}</option>
          {usersLoading ? (
            <option disabled>{t('departments.loadingUsers')}</option>
          ) : (
            users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.first_name} {user.last_name} ({user.email})
              </option>
            ))
          )}
        </select>
        {errors.managerId && (
          <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
            <AlertCircle size={14} />
            {errors.managerId}
          </p>
        )}
        {users.length === 0 && !usersLoading && (
          <p className="mt-1 text-sm text-amber-600">
            {t('departments.noUsers')}
          </p>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={isSubmitting || usersLoading || users.length === 0}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {isSubmitting ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              {t('supplierForm.saving')}
            </>
          ) : (
            department ? t('supplierForm.update') : t('common.create')
          )}
        </button>
      </div>
    </form>
  );
}