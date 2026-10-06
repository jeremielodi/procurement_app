// src/components/Requisitions/RequisitionTasks.jsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  User,
  Send,
  DollarSign,
  Package,
  Building2,
  Hash,
  Calendar,
  AlertCircle,
  Eye,
  FileText,
  UserPlus
} from 'lucide-react';
import requisitionService from '../../services/requisitionService';
import { taskService } from '../../services/taskService';
import { useAuth } from '../../hooks/useAuth';
import StatusBadge from '../Common/StatusBadge';
import LoadingSpinner from '../Common/LoadingSpinner';
import Modal from '../Common/Modal';
import toast from 'react-hot-toast';
import { useCurrency } from '../../contexts/EnterpriseContext';
import { purchaseOrderService } from '../../services/purchaseOrderService';
import { grnService } from '../../services/grnService';
import { t, getLocale } from '../../i18n';
import { TASK_LABELS } from '../../utils/taskLabels';

export default function RequisitionTasks() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const userEmail = user?.email;
  const { formatAmount } = useCurrency();

  const [tasks, setTasks] = useState([]);
  const [requisition, setRequisition] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [claimingTaskId, setClaimingTaskId] = useState(null);

  // États pour le formulaire
  const [formData, setFormData] = useState({
    approved: '',
    comment: '',
    procurementMethod: '',
    justification: '',
    newBudgetAmount: '',
    adjustmentJustification: ''
  });

  useEffect(() => {
    loadData();
  }, [id]);

  const loadData = async () => {
    try {
      setLoading(true);
      const reqData = await requisitionService.getById(id);
      setRequisition(reqData.data);

      const tasksData = await taskService.getTasksByProcess(reqData.data.process_instance_id);
      const tasksList = tasksData.data || [];

      const enrichedTasks = await Promise.all(
        tasksList.map(async (task) => {
          try {
            const variablesData = await taskService.getTaskVariables(task.id);
            return {
              ...task,
              variables: variablesData.data || {}
            };
          } catch (e) {
            return { ...task, variables: {} };
          }
        })
      );

      setTasks(enrichedTasks);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error(t('reqTasks.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const handleClaimTask = async (taskId) => {
    setClaimingTaskId(taskId);
    try {
      await taskService.claimTask(taskId, userEmail);
      toast.success(t('reqTasks.claimed'));
      await loadData(); // Recharger les tâches
    } catch (error) {
      console.error('Error claiming task:', error);
      toast.error(error.response?.data?.message || t('taskList.claimError'));
    } finally {
      setClaimingTaskId(null);
    }
  };

  const handleCompleteTask = async (task) => {

    const processVariables = await requisitionService.getProcessVariables(requisition.process_instance_id);

    if (task.taskDefinitionKey == "Activity_CreatePO") {
      // Navigate to purchase orders route
      navigate(`/purchase-orders/${id}/${task.id}`);
      return; // Exit early since we're navigating away
    }
    else if (task.taskDefinitionKey == 'Activity_POApproval') {

      const purchases = await purchaseOrderService.getAll({ requisitionId: id });
      if (purchases.success && purchases.data.length) {
        navigate(`/purchase-orders/${purchases.data[0].id}`);
      }
      return;
    } else if (task.taskDefinitionKey == 'Activity_GoodsReceipt') {
      const purchases = await purchaseOrderService.getAll({ requisitionId: id });
      if (purchases.success && purchases.data.length) {
        navigate(`/goods-receipts/new?poId=${purchases.data[0].id}&taskId=${task.id}`);
      }
    }

    else if (task.taskDefinitionKey == 'Activity_ServiceAcceptance') {
      const purchases = await purchaseOrderService.getAll({ requisitionId: id });
      if (purchases.success && purchases.data.length) {
        navigate(`/service-acceptance-notes/new?poId=${purchases.data[0].id}&taskId=${task.id}`);
      }
    }
    else if (task.taskDefinitionKey == 'Activity_EnterInvoice') {
      const purchases = await purchaseOrderService.getAll({ requisitionId: id });

      // grnId
      if (purchases.success && purchases.data.length) {
        const poId = purchases.data[0].id;
        const grnId = processVariables.data.grnId;
        navigate(`/invoices/new?poId=${poId}&taskId=${task.id}&grnId=${grnId}`);
      }
    }
    else if (task.taskDefinitionKey == 'Activity_ProcessPayment') {
      const { invoiceId, poId } = processVariables.data;
      navigate(`/payments/new?taskId=${task.id}&invoiceId=${invoiceId}&poId=${poId}`);
    }
    else {
      setSelectedTask(task);
      setFormData({
        approved: '',
        comment: '',
        procurementMethod: '',
        justification: '',
        newBudgetAmount: '',
        adjustmentJustification: ''
      });
      setShowTaskModal(true);
    }
  };

  const handleSubmitTask = async () => {
    setSubmitting(true);
    try {
      const variables = {};

      if (formData.approved !== '') variables.approved = formData.approved === 'true';
      if (formData.comment) variables.comment = formData.comment;
      if (formData.procurementMethod) variables.procurementMethod = formData.procurementMethod;
      if (formData.justification) variables.justification = formData.justification;
      if (formData.newBudgetAmount) variables.newBudgetAmount = parseFloat(formData.newBudgetAmount);
      if (formData.adjustmentJustification) variables.adjustmentJustification = formData.adjustmentJustification;

      await taskService.completeTask(selectedTask.id, variables);
      toast.success(t('taskList.completed'));
      setShowTaskModal(false);
      setSelectedTask(null);
      loadData();
    } catch (error) {
      console.error('Error completing task:', error);
      toast.error(t('reqTasks.completeError'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const getTaskIcon = (taskName) => {
    if (!taskName) return <User size={20} className="text-purple-500" />;
    if (taskName.includes('Validation') || taskName.includes('Approbation')) {
      return <CheckCircle size={20} className="text-blue-500" />;
    }
    if (taskName.includes('Budget')) {
      return <DollarSign size={20} className="text-yellow-500" />;
    }
    if (taskName.includes('Create')) {
      return <FileText size={20} className="text-green-500" />;
    }
    return <User size={20} className="text-purple-500" />;
  };

  const getTaskColor = (taskName) => {
    if (!taskName) return 'border-gray-200';
    if (taskName.includes('Validation')) return 'border-blue-200 bg-blue-50';
    if (taskName.includes('Budget')) return 'border-yellow-200 bg-yellow-50';
    if (taskName.includes('Create')) return 'border-green-200 bg-green-50';
    return 'border-gray-200 bg-gray-50';
  };

  // Nom brut (BPMN) : sert à choisir le formulaire ; displayName : libellé traduit affiché
  const getTaskName = (task) => {
    return (task.name || task.taskName || task.activityName || t('common.unnamedTask'));
  };
  const displayName = (task) => TASK_LABELS[task.taskDefinitionKey] || getTaskName(task);

  const formatCurrency = (amount) => formatAmount(amount || 0);

  const formatDate = (dateString) => {
    if (!dateString) return t('taskList.unknownDate');
    return new Date(dateString).toLocaleString(getLocale());
  };

  const getProgress = () => {
    const total = tasks.length;
    const completed = tasks.filter(tk => tk.status === 'COMPLETED').length;
    return total > 0 ? (completed / total) * 100 : 0;
  };

  if (loading) {
    return <LoadingSpinner text={t('taskList.loading')} />;
  }

  const progress = getProgress();
  const pendingTasks = tasks.filter(tk => tk.status === 'PENDING');
  const completedTasks = tasks.filter(tk => tk.status === 'COMPLETED');

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* En-tête */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate(`/requisitions/${id}`)}
          className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-800">{t('reqTasks.title')}</h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-gray-500">{t('reqTasks.requisition', { number: requisition?.requisition_number })}</p>
            <StatusBadge status={requisition?.status} size="sm" />
          </div>
        </div>
      </div>

      {/* Barre de progression */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-gray-700">{t('reqTasks.progress')}</span>
          <span className="text-sm font-medium text-blue-600">{Math.round(progress)}%</span>
        </div>
        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-blue-600 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-500">
          <span>{t('reqTasks.doneCount', { count: completedTasks.length })}</span>
          <span>{t('reqTasks.pendingCount', { count: pendingTasks.length })}</span>
          <span>{t('reqTasks.totalCount', { count: tasks.length })}</span>
        </div>
      </div>

      {/* Statistiques */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <div className="text-2xl font-bold text-blue-600">{tasks.length}</div>
          <div className="text-sm text-gray-500">{t('reqTasks.total')}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <div className="text-2xl font-bold text-yellow-600">{pendingTasks.length}</div>
          <div className="text-sm text-gray-500">{t('reqTasks.pending')}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <div className="text-2xl font-bold text-green-600">{completedTasks.length}</div>
          <div className="text-sm text-gray-500">{t('reqTasks.done')}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <div className="text-2xl font-bold text-purple-600">
            {formatCurrency(requisition?.estimated_amount)}
          </div>
          <div className="text-sm text-gray-500">{t('reqTasks.totalAmount')}</div>
        </div>
      </div>

      {/* Tâches en attente */}
      {pendingTasks.length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Clock size={20} className="text-yellow-500" />
              {t('reqTasks.pendingTitle', { count: pendingTasks.length })}
            </h2>
          </div>
          <div className="divide-y divide-gray-200">
            {pendingTasks.map((task) => {
              // Droits calculés par le backend selon les groupes Camunda de l'utilisateur
              const isAssignedToMe = task.isMine;
              const isUnassigned = !task.assignee;
              const canClaim = task.canClaim;
              const canProcess = task.canComplete;

              return (
                <div key={task.id} className={`p-6 hover:bg-gray-50 transition-colors ${getTaskColor(task.name)}`}>
                  <div className="flex justify-between items-start">
                    <div className="flex gap-3 flex-1">
                      {getTaskIcon(getTaskName(task))}
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-800">{displayName(task)}</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 mt-2 text-sm">
                          <div className="text-gray-500">{t('reqTasks.requisitionLabel')}</div>
                          <div className="font-medium text-blue-600">{task.variables?.requisitionNumber || '-'}</div>

                          <div className="text-gray-500">{t('reqTasks.createdOn')}</div>
                          <div>{formatDate(task.created)}</div>
                        </div>
                        <p className="text-sm text-gray-500 mt-2">
                          {isAssignedToMe && (
                            <span className="inline-flex items-center gap-1 text-green-600">
                              <CheckCircle size={14} />
                              {t('reqTasks.assignedToYou')}
                            </span>
                          )}
                          {isUnassigned && (
                            <span className="inline-flex items-center gap-1 text-yellow-600">
                              <Clock size={14} />
                              {t('reqTasks.unassigned')}
                            </span>
                          )}
                          {task.assignee && !isAssignedToMe && (
                            <span className="inline-flex items-center gap-1 text-gray-500">
                              <User size={14} />
                              {t('reqTasks.assignedTo', { user: task.assignee })}
                            </span>
                          )}
                          {isUnassigned && !canClaim && task.candidateGroup && (
                            <span className="inline-flex items-center gap-1 text-gray-500 ml-3">
                              <AlertCircle size={14} />
                              {t('reqTasks.reservedFor', { group: task.candidateGroup })}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {canClaim && (
                        <button
                          onClick={() => handleClaimTask(task.id)}
                          disabled={claimingTaskId === task.id}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50"
                        >
                          {claimingTaskId === task.id ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          ) : (
                            <UserPlus size={16} />
                          )}
                          {claimingTaskId === task.id ? t('reqTasks.claiming') : t('taskList.claim')}
                        </button>
                      )}
                      {canProcess && (
                        <button
                          onClick={() => handleCompleteTask(task)}
                          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2"
                        >
                          <Send size={16} />
                          {t('reqTasks.process')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tâches terminées */}
      {completedTasks.length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <CheckCircle size={20} className="text-green-500" />
              {t('reqTasks.doneTitle', { count: completedTasks.length })}
            </h2>
          </div>
          <div className="divide-y divide-gray-200">
            {completedTasks.map((task) => (
              <div key={task.id} className="p-6 bg-gray-50">
                <div className="flex gap-3">
                  <CheckCircle size={20} className="text-green-500 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-gray-800">{displayName(task)}</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      {t('reqTasks.completedOn', { date: task.completedAt ? formatDate(task.completedAt) : formatDate(task.updated) })}
                    </p>
                    {task.assignee && (
                      <p className="text-xs text-gray-400 mt-1">{t('reqTasks.by', { user: task.assignee })}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tasks.length === 0 && (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <CheckCircle size={48} className="mx-auto text-green-500 mb-3" />
          <p className="text-gray-500">{t('reqTasks.none')}</p>
        </div>
      )}

      {/* Modal de traitement de tâche */}
      <Modal
        isOpen={showTaskModal}
        onClose={() => {
          setShowTaskModal(false);
          setSelectedTask(null);
        }}
        title={selectedTask ? displayName(selectedTask) : t('taskList.processTask')}
        confirmText={t('taskList.validate')}
        cancelText={t('common.cancel')}
        onConfirm={handleSubmitTask}
        isLoading={submitting}
        size="lg"
      >
        {selectedTask && (
          <div className="space-y-4">
            {/* Informations de la réquisition */}
            {selectedTask.variables && Object.keys(selectedTask.variables).length > 0 && (
              <div className="bg-blue-50 p-4 rounded-lg">
                <h4 className="font-medium text-blue-800 mb-3 flex items-center gap-2">
                  <FileText size={16} />
                  {t('taskList.requisitionInfo')}
                </h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="text-gray-600">{t('taskList.number')}</div>
                  <div className="font-medium text-blue-700">{selectedTask.variables.requisitionNumber || '-'}</div>
                  <div className="text-gray-600">{t('taskList.title')}</div>
                  <div className="font-medium">{selectedTask.variables.title || '-'}</div>
                  <div className="text-gray-600">{t('taskList.amount')}</div>
                  <div className="font-medium">{formatCurrency(selectedTask.variables.estimatedAmount)}</div>
                  <div className="text-gray-600">{t('taskList.department')}</div>
                  <div className="font-medium">{selectedTask.variables.department || '-'}</div>
                  <div className="text-gray-600">{t('taskList.requester')}</div>
                  <div className="font-medium">{selectedTask.variables.requester || selectedTask.variables.requesterUsername || '-'}</div>
                  <div className="text-gray-600">{t('taskList.project')}</div>
                  <div className="font-medium">{selectedTask.variables.projectName || selectedTask.variables.projectCode || '-'}</div>
                  <div className="text-gray-600">{t('reqTasks.createdOn')}</div>
                  <div className="font-medium">{formatDate(selectedTask.variables.createdAt)}</div>
                </div>
              </div>
            )}


            {/* Formulaire Validation */}
            {(getTaskName(selectedTask).includes('Validation') ||
              getTaskName(selectedTask).includes('Hierarchical') ||
              (getTaskName(selectedTask).includes('Approval')) ||
              getTaskName(selectedTask).includes('Approbation')) && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {t('taskList.decision')}
                    </label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer p-3 border rounded-lg flex-1 hover:bg-green-50 transition-colors">
                        <input
                          type="radio"
                          name="approved"
                          value="true"
                          checked={formData.approved === 'true'}
                          onChange={(e) => handleInputChange('approved', e.target.value)}
                          className="w-4 h-4 text-green-600"
                        />
                        <span className="text-green-700">{t('taskList.approve')}</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer p-3 border rounded-lg flex-1 hover:bg-red-50 transition-colors">
                        <input
                          type="radio"
                          name="approved"
                          value="false"
                          checked={formData.approved === 'false'}
                          onChange={(e) => handleInputChange('approved', e.target.value)}
                          className="w-4 h-4 text-red-600"
                        />
                        <span className="text-red-700">{t('taskList.reject')}</span>
                      </label>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('common.comment')}
                    </label>
                    <textarea
                      value={formData.comment}
                      onChange={(e) => handleInputChange('comment', e.target.value)}
                      rows="4"
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder={t('taskList.commentPlaceholder')}
                    />
                  </div>
                </>
              )}

            {/* Formulaire Détermination méthode d'achat */}
            {(getTaskName(selectedTask).includes('Determine') ||
              getTaskName(selectedTask).includes('Procurement')) && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {t('reqTasks.method')}
                    </label>
                    <div className="space-y-2">
                      {[
                        { value: 'DIRECT_PURCHASE', label: t('procurementMethod.DIRECT_PURCHASE'), desc: t('reqTasks.directDesc') },
                        { value: 'MULTIPLE_QUOTATIONS', label: t('procurementMethod.MULTIPLE_QUOTATIONS'), desc: t('reqTasks.quotesDesc') },
                        { value: 'RFP', label: t('reqTasks.rfpLabel'), desc: t('reqTasks.rfpDesc') },
                        { value: 'SOLE_SOURCE', label: t('procurementMethod.SOLE_SOURCE'), desc: t('reqTasks.soleDesc') }
                      ].map(option => (
                        <label key={option.value} className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                          <input
                            type="radio"
                            name="procurementMethod"
                            value={option.value}
                            checked={formData.procurementMethod === option.value}
                            onChange={(e) => handleInputChange('procurementMethod', e.target.value)}
                            className="w-4 h-4 text-blue-600 mt-0.5"
                          />
                          <div>
                            <span className="font-medium">{option.label}</span>
                            <p className="text-xs text-gray-500">{option.desc}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('reqForm.justification')}
                    </label>
                    <textarea
                      value={formData.justification}
                      onChange={(e) => handleInputChange('justification', e.target.value)}
                      rows="3"
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder={t('reqTasks.justifyPlaceholder')}
                    />
                  </div>
                </>
              )}

            {/* Formulaire Ajustement budgétaire */}
            {getTaskName(selectedTask).includes('Budget Adjustment') && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('reqTasks.newAmount')}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.newBudgetAmount}
                    onChange={(e) => handleInputChange('newBudgetAmount', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder={t('reqTasks.newAmountPlaceholder')}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('reqTasks.adjustmentJustification')}
                  </label>
                  <textarea
                    value={formData.adjustmentJustification}
                    onChange={(e) => handleInputChange('adjustmentJustification', e.target.value)}
                    rows="3"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder={t('reqTasks.adjustmentPlaceholder')}
                  />
                </div>
              </>
            )}

            {/* Formulaire commentaire générique */}
            {!getTaskName(selectedTask).includes('Validation') &&
              !getTaskName(selectedTask).includes('Hierarchical') &&
              !getTaskName(selectedTask).includes('Approbation') &&
              !getTaskName(selectedTask).includes('Approval') &&
              !getTaskName(selectedTask).includes('Determine') &&
              !getTaskName(selectedTask).includes('Procurement') &&
              !getTaskName(selectedTask).includes('Budget Adjustment') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('common.comment')}
                  </label>
                  <textarea
                    value={formData.comment}
                    onChange={(e) => handleInputChange('comment', e.target.value)}
                    rows="4"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder={t('taskList.commentPlaceholder')}
                  />
                </div>
              )}
          </div>
        )}
      </Modal>
    </div>
  );
}