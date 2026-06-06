// src/components/Departments/DepartmentForm.jsx
import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { departmentService } from '../../services/departmentService';
import toast from 'react-hot-toast';

export default function DepartmentForm({ department, onClose }) {
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    description: '',
    managerId: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: usersData } = useQuery({
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (department) {
        await departmentService.update(department.id, formData);
        toast.success('Département modifié');
      } else {
        await departmentService.create(formData);
        toast.success('Département créé');
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
      <div>
        <label className="block text-sm font-medium mb-1">Code *</label>
        <input
          type="text"
          value={formData.code}
          onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          required
          placeholder="EX: IT"
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
          placeholder="Informatique"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Description</label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          rows="3"
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          placeholder="Description du département..."
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Manager</label>
        <select
          value={formData.managerId}
          onChange={(e) => setFormData({ ...formData, managerId: e.target.value })}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Sélectionner un manager</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.first_name} {user.last_name} ({user.email})
            </option>
          ))}
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
          {isSubmitting ? 'Enregistrement...' : (department ? 'Mettre à jour' : 'Créer')}
        </button>
      </div>
    </form>
  );
}