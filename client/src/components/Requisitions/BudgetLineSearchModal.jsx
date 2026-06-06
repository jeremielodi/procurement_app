// src/components/Requisitions/BudgetLineSearchModal.jsx
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, MapPin, Building2, FileText, DollarSign, Filter, ChevronDown } from 'lucide-react';
import { budgetService } from '../../services/budgetService';
import Modal from '../Common/Modal';
import LoadingSpinner from '../Common/LoadingSpinner';

export default function BudgetLineSearchModal({ isOpen, onClose, onSelect, projectId }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({
    search: '',
    fundingSource: 'all'
  });
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['budget-lines-search', filters, projectId],
    queryFn: () => budgetService.getByProject(projectId),
    enabled: isOpen
  });

  const budgetLines = data?.data || [];

  const handleSearch = () => {
    setFilters({ ...filters, search: searchTerm });
    refetch();
  };

  const handleReset = () => {
    setSearchTerm('');
    setFilters({ search: '', fundingSource: 'all' });
    refetch();
  };

  const handleSelect = (budgetLine) => {
    onSelect(budgetLine);
    onClose();
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const getUsagePercent = (allocated, utilized) => {
    if (allocated === 0) return 0;
    return (utilized / allocated) * 100;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Rechercher une ligne budgétaire"
      size="xl"
      showFooter={false}
    >
      <div className="space-y-4">
        {/* Barre de recherche */}
        <div className="flex flex-wrap gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Rechercher par code, description, localisation, sous-projet..."
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 px-3 py-2 border rounded-lg hover:bg-gray-50"
          >
            <Filter size={16} />
            Filtres
            {filters.fundingSource !== 'all' && (
              <span className="w-2 h-2 bg-blue-600 rounded-full" />
            )}
          </button>
          <button
            onClick={handleSearch}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Rechercher
          </button>
          <button
            onClick={handleReset}
            className="px-4 py-2 text-gray-600 border rounded-lg hover:bg-gray-50"
          >
            Réinitialiser
          </button>
        </div>

        {/* Filtres avancés */}
        {showFilters && (
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Source de financement</label>
                <select
                  value={filters.fundingSource}
                  onChange={(e) => setFilters({ ...filters, fundingSource: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">Toutes</option>
                  <option value="WWF">WWF</option>
                  <option value="UE">Union Européenne</option>
                  <option value="PNUD">PNUD</option>
                  <option value="Banque Mondiale">Banque Mondiale</option>
                  <option value="USAID">USAID</option>
                  <option value="GEF">GEF</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Tableau des résultats */}
        {isLoading ? (
          <div className="flex justify-center py-8">
            <LoadingSpinner />
          </div>
        ) : budgetLines.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            Aucune ligne budgétaire trouvée
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entité</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Loc</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sous-projet</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Code fonction</th>
                    {/* <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Alloué</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Utilisé</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Restant</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Utilisation</th> */}
                     </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {budgetLines.map((line) => {
                    const usagePercent = getUsagePercent(line.allocated_amount, line.utilized_amount);
                    const isOverBudget = usagePercent > 100;
                    
                    return (
                      <tr 
                        key={line.id} 
                        className="hover:bg-blue-50 transition-colors cursor-pointer"
                        onClick={() => handleSelect(line)}
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="font-medium text-blue-600">{line.entity_code}</span>
                          {line.project_code && (
                            <div className="text-xs text-gray-400">{line.project_code}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="max-w-xs">
                            <p className="text-sm text-gray-800 truncate" title={line.description}>
                              {line.description || '-'}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1 text-sm text-gray-600">
                            <MapPin size={14} />
                            {line.loc || '-'}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-700">
                            {line.funding_source || '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                          {line.sub_project || '-'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                          {line.function_code || '-'}
                        </td>
                        {/* <td className="px-4 py-3 whitespace-nowrap text-right">
                          <span className="text-sm font-medium text-green-600">
                            {formatCurrency(line.allocated_amount)}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right">
                          <span className="text-sm text-orange-600">
                            {formatCurrency(line.utilized_amount)}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right">
                          <span className="text-sm font-semibold text-purple-600">
                            {formatCurrency(line.remaining_amount)}
                          </span>
                        </td> */}
                        <td className="px-4 py-3 whitespace-nowrap text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelect(line);
                            }}
                            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                          >
                            Sélectionner
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Résumé des résultats */}
        {budgetLines.length > 0 && (
          <div className="text-sm text-gray-500 text-right">
            {budgetLines.length} ligne(s) budgétaire(s) trouvée(s)
          </div>
        )}
      </div>
    </Modal>
  );
}