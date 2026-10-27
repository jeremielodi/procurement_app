// src/components/Budget/BudgetDetail.jsx
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Trash2, DollarSign, Calendar, FileText, ShoppingCart } from 'lucide-react';
import { budgetService } from '../../services/budgetService';
import { useCurrency } from '../../contexts/EnterpriseContext';
import requisitionService from '../../services/requisitionService';
import { purchaseOrderService } from '../../services/purchaseOrderService';
import Modal from '../Common/Modal';
import toast from 'react-hot-toast';
import { t, getLocale } from '../../i18n';
import { usePermissions } from '../../hooks/usePermissions';
import SearchSelect from '../Common/SearchSelect';

export default function BudgetDetail({ budget: row, onClose }) {
  const { formatAmount } = useCurrency();
  // Fiche complète (bons de commande qui consomment la ligne, dépenses) ; la ligne de la liste s'affiche en attendant
  const { data: detail } = useQuery({
    queryKey: ['budget', row.id],
    queryFn: () => budgetService.getById(row.id)
  });
  const budget = detail?.data || row;
  const queryClient = useQueryClient();
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const canManage = usePermissions().hasPermission('MANAGE_BUDGET'); // auditeur : consultation seule
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
      queryClient.invalidateQueries(['budget', row.id]);
      queryClient.invalidateQueries(['budget-summary']);
      toast.success(t('budget.expenseAdded'));
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
            <p className="text-xs text-gray-500">{t('budget.entityCode')}</p>
            <p className="font-semibold">{budget.entity_code}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">{t('budget.location')}</p>
            <p className="font-semibold">{budget.loc || '-'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">{t('budget.source')}</p>
            <p className="font-semibold">{budget.funding_source || '-'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">{t('budget.subProject')}</p>
            <p className="font-semibold">{budget.sub_project || '-'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">{t('budget.functionCode')}</p>
            <p className="font-semibold">{budget.function_code || '-'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">{t('budget.activityCode')}</p>
            <p className="font-semibold">{budget.activity_code || '-'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">{t('budget.project')}</p>
            <p className="font-semibold">{budget.project_name || '-'}</p>
          </div>
        </div>
        {budget.description && (
          <div className="mt-3 pt-3 border-t">
            <p className="text-xs text-gray-500">{t('common.description')}</p>
            <p className="text-sm">{budget.description}</p>
          </div>
        )}
      </div>

      {/* Indicateurs */}
      <div className="grid grid-cols-3 gap-4">
        <div className="text-center p-3 bg-green-50 rounded-lg">
          <p className="text-sm text-gray-600">{t('budget.allocated')}</p>
          <p className="text-xl font-bold text-green-600">{formatCurrency(budget.allocated_amount)}</p>
        </div>
        <div className="text-center p-3 bg-orange-50 rounded-lg">
          <p className="text-sm text-gray-600">{t('budget.utilized')}</p>
          <p className="text-xl font-bold text-orange-600">{formatCurrency(budget.utilized_amount)}</p>
        </div>
        <div className="text-center p-3 bg-purple-50 rounded-lg">
          <p className="text-sm text-gray-600">{t('budget.remaining')}</p>
          <p className="text-xl font-bold text-purple-600">{formatCurrency(budget.remaining_amount)}</p>
        </div>
      </div>

      {/* Barre de progression */}
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span>{t('budget.utilization')}</span>
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

      {/* Bons de commande qui consomment la ligne (= montant utilisé, avec les dépenses ci-dessous) */}
      <div data-testid="budget-commitments">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2 mb-1">
          <ShoppingCart size={18} />
          {t('budget.commitments')}
        </h3>
        <p className="text-xs text-gray-500 mb-3">{t('budget.commitmentsHint')}</p>
        {!budget.commitments ? null : budget.commitments.length === 0 ? (
          <p className="text-center text-gray-500 py-4">{t('budget.noCommitment')}</p>
        ) : (
          <div className="border rounded-lg overflow-hidden max-h-72 overflow-y-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('budget.commitmentPo')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('budget.commitmentRequisition')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('budget.commitmentSupplier')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('common.status')}</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">{t('budget.commitmentAmount')}</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {budget.commitments.map((po) => (
                  <tr key={po.id} data-testid="budget-commitment">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link to={`/purchase-orders/${po.id}`} className="text-blue-600 hover:underline">{po.po_number}</Link>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {po.requisition_id ? <Link to={`/requisitions/${po.requisition_id}`} className="text-blue-600 hover:underline">{po.requisition_number}</Link> : '-'}
                    </td>
                    <td className="px-3 py-2">{po.supplier_name || '-'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {t(`badge.${po.status}`)}
                      {po.delivery_closed_at && <span className="ml-1 text-xs text-gray-500">({t('budget.commitmentClosed')})</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-right font-medium">{formatCurrency(po.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Dépenses */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2">
            <DollarSign size={18} />
            {t('budget.expenses')}
          </h3>
          {canManage && (
            <button
              onClick={() => setShowExpenseModal(true)}
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
            >
              <Plus size={16} />
              {t('budget.addExpense')}
            </button>
          )}
        </div>

        {!budget.expenses ? null : budget.expenses.length === 0 ? (
          <p className="text-center text-gray-500 py-4">{t('budget.noExpense')}</p>
        ) : (
          <div className="space-y-2">
            {budget.expenses?.map((expense) => (
              <div key={expense.id} className="bg-gray-50 rounded-lg p-3 flex justify-between items-center">
                <div>
                  <p className="font-medium">{formatCurrency(expense.amount)}</p>
                  <p className="text-sm text-gray-500">{expense.description}</p>
                  <div className="flex gap-3 mt-1 text-xs text-gray-400">
                    <span className="flex items-center gap-1"><Calendar size={12} />{new Date(expense.expense_date).toLocaleDateString(getLocale())}</span>
                    {expense.requisition_number && (
                      <span className="flex items-center gap-1"><FileText size={12} />{t('budget.reqRef', { number: expense.requisition_number })}</span>
                    )}
                    {expense.po_number && (
                      <span className="flex items-center gap-1"><FileText size={12} />{t('budget.poRef', { number: expense.po_number })}</span>
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
        title={t('budget.addExpense')}
        size="md"
        confirmText={t('common.add')}
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
            <label className="block text-sm font-medium mb-1">{t('budget.amountRequired')}</label>
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
            <label className="block text-sm font-medium mb-1">{t('common.description')}</label>
            <textarea
              value={expenseForm.description}
              onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })}
              rows="3"
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('budget.linkedRequisition')}</label>
            <SearchSelect
              value={expenseForm.requisitionId}
              onChange={(e) => setExpenseForm({ ...expenseForm, requisitionId: e.target.value, purchaseOrderId: '' })}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="">{t('budget.none_f')}</option>
              {requisitionsData?.data?.map((req) => (
                <option key={req.id} value={req.id}>{req.requisition_number} - {req.title}</option>
              ))}
            </SearchSelect>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('budget.linkedOrder')}</label>
            <SearchSelect
              value={expenseForm.purchaseOrderId}
              onChange={(e) => setExpenseForm({ ...expenseForm, purchaseOrderId: e.target.value, requisitionId: '' })}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="">{t('budget.none_f')}</option>
              {purchaseOrdersData?.data?.map((po) => (
                <option key={po.id} value={po.id}>{po.po_number} - {po.supplier_name}</option>
              ))}
            </SearchSelect>
          </div>
        </div>
      </Modal>
    </div>
  );
}