// src/components/Budget/BudgetDetail.jsx
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, DollarSign, Calendar, FileText } from 'lucide-react';
import { budgetService } from '../../services/budgetService';
import { useCurrency } from '../../contexts/EnterpriseContext';
import { requisitionService } from '../../services/requisitionService';
import { purchaseOrderService } from '../../services/purchaseOrderService';
import Modal from '../Common/Modal';
import toast from 'react-hot-toast';

export default function BudgetDetail({ budget, onClose }) {
  const { formatAmount } = useCurrency();
  const queryClient = useQueryClient();
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    amount: '',
    description: '',
    requisitionId: '',
    purchaseOrderId: ''
  });

  const { data: requisitionsData } = useQuery({
    queryKey: ['requisitions', { status: 'APPROVED' }],
    queryFn: () => requisitionService.getAll({ status: 'APPROVED', limit: 100 })
  });

  const { data: purchaseOrdersData } = useQuery({
    queryKey: ['purchase-orders', { status: 'APPROVED' }],
    queryFn: () => purchaseOrderService.getAll({ status: 'APPROVED', limit: 100 })
  });

  const addExpenseMutation = useMutation({
    mutationFn: (data) => budgetService.addExpense(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['budgets']);
      queryClient.invalidateQueries(['budget-summary']);
      toast.success('Dépense ajoutée');
      setShowExpenseModal(false);
      setExpenseForm({ amount: '', description: '', requisitionId: '', purchaseOrderId: '' });
    }
  });

  const formatCurrency = (amount) => formatAmount(amount || 0);

  const utilizationRate = ((budget.utilized_amount / budget.allocated_amount) * 100).toFixed(1);

  return (
    <div className="space-y-6">
      {/* Infos budget */}
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-500">Code entité</p>
            <p className="font-semibold">{budget.entity_code}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Localisation</p>
            <p className="font-semibold">{budget.loc || '-'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Source</p>
            <p className="font-semibold">{budget.funding_source || '-'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Sous-projet</p>
            <p className="font-semibold">{budget.sub_project || '-'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Code fonction</p>
            <p className="font-semibold">{budget.function_code || '-'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Projet</p>
            <p className="font-semibold">{budget.project_name || '-'}</p>
          </div>
        </div>
        {budget.description && (
          <div className="mt-3 pt-3 border-t">
            <p className="text-xs text-gray-500">Description</p>
            <p className="text-sm">{budget.description}</p>
          </div>
        )}
      </div>

      {/* Indicateurs */}
      <div className="grid grid-cols-3 gap-4">
        <div className="text-center p-3 bg-green-50 rounded-lg">
          <p className="text-sm text-gray-600">Alloué</p>
          <p className="text-xl font-bold text-green-600">{formatCurrency(budget.allocated_amount)}</p>
        </div>
        <div className="text-center p-3 bg-orange-50 rounded-lg">
          <p className="text-sm text-gray-600">Utilisé</p>
          <p className="text-xl font-bold text-orange-600">{formatCurrency(budget.utilized_amount)}</p>
        </div>
        <div className="text-center p-3 bg-purple-50 rounded-lg">
          <p className="text-sm text-gray-600">Restant</p>
          <p className="text-xl font-bold text-purple-600">{formatCurrency(budget.remaining_amount)}</p>
        </div>
      </div>

      {/* Barre de progression */}
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span>Utilisation</span>
          <span className={utilizationRate > 100 ? 'text-red-600' : 'text-green-600'}>
            {utilizationRate}%
          </span>
        </div>
        <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
          <div 
            className={`h-full ${utilizationRate > 100 ? 'bg-red-500' : 'bg-green-500'} rounded-full`}
            style={{ width: `${Math.min(utilizationRate, 100)}%` }}
          />
        </div>
      </div>

      {/* Dépenses */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2">
            <DollarSign size={18} />
            Dépenses
          </h3>
          <button
            onClick={() => setShowExpenseModal(true)}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
          >
            <Plus size={16} />
            Ajouter une dépense
          </button>
        </div>

        {budget.expenses?.length === 0 ? (
          <p className="text-center text-gray-500 py-4">Aucune dépense enregistrée</p>
        ) : (
          <div className="space-y-2">
            {budget.expenses?.map((expense) => (
              <div key={expense.id} className="bg-gray-50 rounded-lg p-3 flex justify-between items-center">
                <div>
                  <p className="font-medium">{formatCurrency(expense.amount)}</p>
                  <p className="text-sm text-gray-500">{expense.description}</p>
                  <div className="flex gap-3 mt-1 text-xs text-gray-400">
                    <span className="flex items-center gap-1"><Calendar size={12} />{new Date(expense.expense_date).toLocaleDateString('fr-FR')}</span>
                    {expense.requisition_number && (
                      <span className="flex items-center gap-1"><FileText size={12} />Réq: {expense.requisition_number}</span>
                    )}
                    {expense.po_number && (
                      <span className="flex items-center gap-1"><FileText size={12} />PO: {expense.po_number}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal ajout dépense */}
      <Modal
        isOpen={showExpenseModal}
        onClose={() => setShowExpenseModal(false)}
        title="Ajouter une dépense"
        size="md"
        confirmText="Ajouter"
        onConfirm={() => addExpenseMutation.mutate({
          budgetId: budget.id,
          amount: parseFloat(expenseForm.amount),
          description: expenseForm.description,
          requisitionId: expenseForm.requisitionId || null,
          purchaseOrderId: expenseForm.purchaseOrderId || null
        })}
        isLoading={addExpenseMutation.isPending}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Montant *</label>
            <input
              type="number"
              step="0.01"
              value={expenseForm.amount}
              onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={expenseForm.description}
              onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })}
              rows="3"
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Réquisition associée</label>
            <select
              value={expenseForm.requisitionId}
              onChange={(e) => setExpenseForm({ ...expenseForm, requisitionId: e.target.value, purchaseOrderId: '' })}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="">Aucune</option>
              {requisitionsData?.data?.map((req) => (
                <option key={req.id} value={req.id}>{req.requisition_number} - {req.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Commande associée</label>
            <select
              value={expenseForm.purchaseOrderId}
              onChange={(e) => setExpenseForm({ ...expenseForm, purchaseOrderId: e.target.value, requisitionId: '' })}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="">Aucune</option>
              {purchaseOrdersData?.data?.map((po) => (
                <option key={po.id} value={po.id}>{po.po_number} - {po.supplier_name}</option>
              ))}
            </select>
          </div>
        </div>
      </Modal>
    </div>
  );
}