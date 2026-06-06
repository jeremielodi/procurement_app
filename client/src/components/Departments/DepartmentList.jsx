// src/components/Departments/DepartmentList.jsx
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit, Trash2, Building2, User, Search } from 'lucide-react';
import { departmentService } from '../../services/departmentService';
import Modal from '../Common/Modal';
import DepartmentForm from './DepartmentForm';
import toast from 'react-hot-toast';

export default function DepartmentList() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['departments', { search }],
    queryFn: () => departmentService.getAll({ search })
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => departmentService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['departments']);
      toast.success('Département supprimé');
    }
  });

  const departments = data?.data || [];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800">Départements</h1>
        <button
          onClick={() => {
            setSelectedDepartment(null);
            setShowModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus size={18} />
          Nouveau département
        </button>
      </div>

      {/* Recherche */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
        <input
          type="text"
          placeholder="Rechercher un département..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
        />
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
        ) : departments.length === 0 ? (
          <div className="col-span-full text-center py-12 bg-white rounded-lg shadow">
            <Building2 size={48} className="mx-auto text-gray-400 mb-3" />
            <p className="text-gray-500">Aucun département</p>
            <button
              onClick={() => setShowModal(true)}
              className="mt-2 text-blue-600 hover:text-blue-800"
            >
              Créer le premier département
            </button>
          </div>
        ) : (
          departments.map((dept) => (
            <div key={dept.id} className="bg-white rounded-lg shadow hover:shadow-md transition-shadow">
              <div className="p-6">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800">{dept.name}</h3>
                    <p className="text-sm text-gray-500">{dept.code}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setSelectedDepartment(dept);
                        setShowModal(true);
                      }}
                      className="text-blue-600 hover:text-blue-800"
                      title="Modifier"
                    >
                      <Edit size={18} />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('Supprimer ce département ?')) {
                          deleteMutation.mutate(dept.id);
                        }
                      }}
                      className="text-red-600 hover:text-red-800"
                      title="Supprimer"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
                {dept.description && (
                  <p className="text-sm text-gray-600 mt-2 line-clamp-2">{dept.description}</p>
                )}
                <div className="mt-4 pt-4 border-t flex items-center gap-2 text-sm text-gray-500">
                  <User size={14} />
                  <span>Manager: {dept.manager_first_name ? `${dept.manager_first_name} ${dept.manager_last_name}` : 'Non assigné'}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={selectedDepartment ? 'Modifier le département' : 'Nouveau département'}
        size="lg"
        showFooter={false}
      >
        <DepartmentForm
          department={selectedDepartment}
          onClose={() => {
            setShowModal(false);
            queryClient.invalidateQueries(['departments']);
          }}
        />
      </Modal>
    </div>
  );
}