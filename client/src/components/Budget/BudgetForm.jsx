// src/components/Budget/BudgetForm.jsx
import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { budgetService } from '../../services/budgetService';
import { projectService } from '../../services/projectService';
import toast from 'react-hot-toast';
import { t } from '../../i18n';
import SearchSelect from '../Common/SearchSelect';

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
        isActive: budget.is_active,
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
      toast.error(t('budget.entityRequired'));
      return;
    }
    if (!formData.allocatedAmount || parseFloat(formData.allocatedAmount) <= 0) {
      toast.error(t('budget.amountPositive'));
      return;
    }
    
    setIsSubmitting(true);
    try {
      if (budget) {
        await budgetService.update(budget.id, formData);
        toast.success(t('budget.updated'));
      } else {
        await budgetService.create(formData);
        toast.success(t('budget.created'));
      }
      onClose();
    } catch (error) {
      console.error('Error saving budget:', error);
      toast.error(error.response?.data?.message || t('budget.saveError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('budget.entityCode')} <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={formData.entityCode}
            onChange={(e) => setFormData({ ...formData, entityCode: e.target.value.toUpperCase() })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            required
            placeholder={t('budget.entityPlaceholder')}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('budget.loc')}
          </label>
          <input
            type="text"
            value={formData.loc}
            onChange={(e) => setFormData({ ...formData, loc: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder={t('budget.locPlaceholder')}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('budget.fundingSource')}
          </label>
          <SearchSelect
            value={formData.fundingSource}
            onChange={(e) => setFormData({ ...formData, fundingSource: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">{t('budget.selectSource')}</option>
            <option value="WWF">WWF</option>
            <option value="UE">{t('budget.euFull')}</option>
            <option value="PNUD">{t('budget.undp')}</option>
            <option value="Banque Mondiale">{t('budget.worldBank')}</option>
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
          </SearchSelect>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('budget.subProject')}
          </label>
          <input
            type="text"
            value={formData.subProject}
            onChange={(e) => setFormData({ ...formData, subProject: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder={t('budget.subProjectPlaceholder')}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('budget.functionCode')}
          </label>
          <input
            type="text"
            value={formData.functionCode}
            onChange={(e) => setFormData({ ...formData, functionCode: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder={t('budget.functionPlaceholder')}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('budget.linkedProject')}
          </label>
          <SearchSelect
            value={formData.projectId}
            onChange={(e) => setFormData({ ...formData, projectId: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            disabled={projectsLoading}
          >
            <option value="">{t('budget.noProject')}</option>
            {projectsLoading ? (
              <option disabled>{t('budget.loadingProjects')}</option>
            ) : (
              projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} - {project.name}
                </option>
              ))
            )}
          </SearchSelect>
          {!projectsLoading && projects.length === 0 && (
            <p className="text-xs text-amber-600 mt-1">
              {t('budget.noActiveProject')} <a href="/projects" className="text-blue-600 hover:underline">{t('budget.createProject')}</a> {t('budget.first')}
            </p>
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('common.description')}
        </label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          rows="3"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder={t('budget.descriptionPlaceholder')}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('budget.allocatedAmount')} <span className="text-red-500">*</span>
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
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
        >
          {isSubmitting ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              {t('supplierForm.saving')}
            </>
          ) : (
            budget ? t('supplierForm.update') : t('common.create')
          )}
        </button>
      </div>
    </form>
  );
}