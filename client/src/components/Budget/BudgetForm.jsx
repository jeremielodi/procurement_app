// src/components/Budget/BudgetForm.jsx
import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { budgetService } from '../../services/budgetService';
import { projectService } from '../../services/projectService';
import toast from 'react-hot-toast';

export default function BudgetForm({ budget, onClose }) {
  const [formData, setFormData] = useState({
    entityCode: '',
    loc: '',
    fundingSource: '',
    subProject: '',
    functionCode: '',
    description: '',
    allocatedAmount: '',
    projectId: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Charger les projets actifs
  const { data: projectsData, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects', { is_active: true }],
    queryFn: () => projectService.getAll({ status: 'all', limit: 100 })
  });

  const projects = projectsData?.data || [];

  // Charger les sources de financement distinctes (optionnel)
  const { data: fundingSourcesData } = useQuery({
    queryKey: ['budget-funding-sources'],
    queryFn: async () => {
      const response = await budgetService.getAll({ limit: 100 });
      const sources = [...new Set(response.data?.map(b => b.funding_source).filter(Boolean))];
      return { data: sources };
    }
  });

  const fundingSources = fundingSourcesData?.data || [];

  useEffect(() => {
    if (budget) {
      setFormData({
        entityCode: budget.entity_code || '',
        loc: budget.loc || '',
        fundingSource: budget.funding_source || '',
        subProject: budget.sub_project || '',
        functionCode: budget.function_code || '',
        description: budget.description || '',
        allocatedAmount: budget.allocated_amount || '',
        projectId: budget.project_id || ''
      });
    }
  }, [budget]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validation
    if (!formData.entityCode) {
      toast.error('Le code entité est requis');
      return;
    }
    if (!formData.allocatedAmount || parseFloat(formData.allocatedAmount) <= 0) {
      toast.error('Le montant alloué doit être supérieur à 0');
      return;
    }
    
    setIsSubmitting(true);
    try {
      if (budget) {
        await budgetService.update(budget.id, formData);
        toast.success('Budget modifié avec succès');
      } else {
        await budgetService.create(formData);
        toast.success('Budget créé avec succès');
      }
      onClose();
    } catch (error) {
      console.error('Error saving budget:', error);
      toast.error(error.response?.data?.message || 'Erreur lors de l\'enregistrement');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Code entité <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={formData.entityCode}
            onChange={(e) => setFormData({ ...formData, entityCode: e.target.value.toUpperCase() })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            required
            placeholder="Ex: A"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Loc
          </label>
          <input
            type="text"
            value={formData.loc}
            onChange={(e) => setFormData({ ...formData, loc: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Ex: 61001"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Source de financement
          </label>
          <select
            value={formData.fundingSource}
            onChange={(e) => setFormData({ ...formData, fundingSource: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Sélectionner une source</option>
            <option value="WWF">WWF</option>
            <option value="UE">Union Européenne</option>
            <option value="PNUD">PNUD</option>
            <option value="Banque Mondiale">Banque Mondiale</option>
            <option value="USAID">USAID</option>
            <option value="GEF">GEF</option>
            <option value="FFEM">FFEM</option>
            <option value="KfW">KfW</option>
            <option value="AFD">AFD</option>
            {fundingSources.map(source => (
              !['WWF', 'UE', 'PNUD', 'Banque Mondiale', 'USAID', 'GEF', 'FFEM', 'KfW', 'AFD'].includes(source) && (
                <option key={source} value={source}>{source}</option>
              )
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Sous-projet
          </label>
          <input
            type="text"
            value={formData.subProject}
            onChange={(e) => setFormData({ ...formData, subProject: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Ex: CONS-001, EDU-001..."
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Code fonction
          </label>
          <input
            type="text"
            value={formData.functionCode}
            onChange={(e) => setFormData({ ...formData, functionCode: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Ex: FUNC-01"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Projet associé
          </label>
          <select
            value={formData.projectId}
            onChange={(e) => setFormData({ ...formData, projectId: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            disabled={projectsLoading}
          >
            <option value="">-- Aucun projet associé --</option>
            {projectsLoading ? (
              <option disabled>Chargement des projets...</option>
            ) : (
              projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} - {project.name}
                </option>
              ))
            )}
          </select>
          {!projectsLoading && projects.length === 0 && (
            <p className="text-xs text-amber-600 mt-1">
              Aucun projet actif. <a href="/projects" className="text-blue-600 hover:underline">Créez un projet</a> d'abord.
            </p>
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Description
        </label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          rows="3"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="Description détaillée du budget..."
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Montant alloué <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
          <input
            type="number"
            step="0.01"
            value={formData.allocatedAmount}
            onChange={(e) => setFormData({ ...formData, allocatedAmount: parseFloat(e.target.value) || '' })}
            className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            required
            placeholder="0.00"
            min="0"
          />
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
        >
          {isSubmitting ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              Enregistrement...
            </>
          ) : (
            budget ? 'Mettre à jour' : 'Créer'
          )}
        </button>
      </div>
    </form>
  );
}