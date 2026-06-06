// src/components/Budget/BudgetList.jsx
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit, Trash2, Eye, DollarSign, TrendingUp, TrendingDown, Search, Filter } from 'lucide-react';
import { budgetService } from '../../services/budgetService';
import { projectService } from '../../services/projectService';
import Modal from '../Common/Modal';
import BudgetForm from './BudgetForm';
import BudgetDetail from './BudgetDetail';
import toast from 'react-hot-toast';

export default function BudgetList() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [fundingSource, setFundingSource] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedBudget, setSelectedBudget] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['budgets', { search, fundingSource }],
    queryFn: () => budgetService.getAll({ entityCode: search, fundingSource: fundingSource !== 'all' ? fundingSource : undefined })
  });

  const { data: summaryData } = useQuery({
    queryKey: ['budget-summary'],
    queryFn: () => budgetService.getSummary()
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => budgetService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['budgets']);
      queryClient.invalidateQueries(['budget-summary']);
      toast.success('Budget supprimé');
    }
  });

  const budgets = data?.data || [];
  let summaryInfo = summaryData?.data;
  const summary = (summaryInfo || {}).summary;

  const formatCurrency = (amount) => {
    if(!amount) {
        amount = 0;
    }
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const getUtilizationRate = (allocated, utilized) => {
    if (allocated === 0) return 0;
    return (utilized / allocated) * 100;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Gestion Budgétaire</h1>
          <p className="text-gray-500 mt-1">Suivi des allocations et dépenses</p>
        </div>
        <button
          onClick={() => {
            setSelectedBudget(null);
            setShowModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus size={18} />
          Nouveau budget
        </button>
      </div>

      {/* Cartes de synthèse */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total budgets</p>
                <p className="text-2xl font-bold text-gray-800">{summary.total_budgets}</p>
              </div>
              <DollarSign size={32} className="text-blue-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Alloué total</p>
                <p className="text-2xl font-bold text-green-600">{formatCurrency(summary.total_allocated)}</p>
              </div>
              <TrendingUp size={32} className="text-green-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Utilisé total</p>
                <p className="text-2xl font-bold text-orange-600">{formatCurrency(summary.total_utilized)}</p>
              </div>
              <TrendingDown size={32} className="text-orange-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Restant total</p>
                <p className="text-2xl font-bold text-purple-600">{formatCurrency(summary.total_remaining)}</p>
              </div>
              <DollarSign size={32} className="text-purple-500" />
            </div>
          </div>
        </div>
      )}

      {/* Filtres */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Rechercher par code entité..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <select
            value={fundingSource}
            onChange={(e) => setFundingSource(e.target.value)}
            className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Toutes sources</option>
            <option value="WWF">WWF</option>
            <option value="UE">UE</option>
            <option value="PNUD">PNUD</option>
            <option value="Banque Mondiale">Banque Mondiale</option>
          </select>
        </div>
      </div>

      {/* Tableau des budgets */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Code entité</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Loc</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Projet</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Alloué</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Utilisé</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Restant</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Utilisation</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td colSpan={9} className="px-6 py-4"><div className="h-4 bg-gray-200 rounded"></div></td>
                </tr>
              ))
            ) : budgets.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-12 text-center text-gray-500">
                  Aucun budget trouvé
                </td>
              </tr>
            ) : (
              budgets.map((budget) => {
                const utilizationRate = getUtilizationRate(budget.allocated_amount, budget.utilized_amount);
                const isOverBudget = utilizationRate > 100;
                
                return (
                  <tr key={budget.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">{budget.entity_code}</td>
                    <td className="px-6 py-4 text-gray-600">{budget.loc || '-'}</td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-700">
                        {budget.funding_source || '-'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{budget.project_name || '-'}</td>
                    <td className="px-6 py-4 text-right font-medium text-green-600">
                      {formatCurrency(budget.allocated_amount)}
                    </td>
                    <td className="px-6 py-4 text-right font-medium text-orange-600">
                      {formatCurrency(budget.utilized_amount)}
                    </td>
                    <td className="px-6 py-4 text-right font-medium text-purple-600">
                      {formatCurrency(budget.remaining_amount)}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div 
                            className={`h-full ${isOverBudget ? 'bg-red-500' : 'bg-green-500'} rounded-full`}
                            style={{ width: `${Math.min(utilizationRate, 100)}%` }}
                          />
                        </div>
                        <span className={`text-xs font-medium ${isOverBudget ? 'text-red-600' : 'text-green-600'}`}>
                          {utilizationRate.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => {
                          setSelectedBudget(budget);
                          setShowDetailModal(true);
                        }}
                        className="text-blue-600 hover:text-blue-800"
                        title="Voir détails"
                      >
                        <Eye size={18} />
                      </button>
                      <button
                        onClick={() => {
                          setSelectedBudget(budget);
                          setShowModal(true);
                        }}
                        className="text-green-600 hover:text-green-800"
                        title="Modifier"
                      >
                        <Edit size={18} />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Supprimer ce budget ?')) {
                            deleteMutation.mutate(budget.id);
                          }
                        }}
                        className="text-red-600 hover:text-red-800"
                        title="Supprimer"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={selectedBudget ? 'Modifier le budget' : 'Nouveau budget'}
        size="lg"
        showFooter={false}
      >
        <BudgetForm
          budget={selectedBudget}
          onClose={() => {
            setShowModal(false);
            queryClient.invalidateQueries(['budgets']);
            queryClient.invalidateQueries(['budget-summary']);
          }}
        />
      </Modal>

      <Modal
        isOpen={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        title={`Budget - ${selectedBudget?.entity_code}`}
        size="xl"
        showFooter={false}
      >
        <BudgetDetail budget={selectedBudget} onClose={() => setShowDetailModal(false)} />
      </Modal>
    </div>
  );
}