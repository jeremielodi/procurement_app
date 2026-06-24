// src/components/Tasks/TaskList.jsx
import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  CheckCircle, 
  Clock, 
  User, 
  AlertCircle, 
  ShoppingCart, 
  Package, 
  Eye,
  Send,
  X,
  RefreshCw,
  Filter,
  DollarSign,
  Building2,
  Hash
} from 'lucide-react';
import { taskService } from '../../services/taskService';
import { useAuth } from '../../hooks/useAuth';
import { getTaskLabel } from '../../utils/taskLabels';
import Modal from '../Common/Modal';
import LoadingSpinner from '../Common/LoadingSpinner';
import toast from 'react-hot-toast';
import { useCurrency } from '../../contexts/EnterpriseContext';

const TaskList = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { currency } = useCurrency();
  const userEmail = user?.email;
  
  const [selectedTask, setSelectedTask] = useState(null);
  const [filter, setFilter] = useState('pending'); // 'all', 'pending', 'completed'
  const [submitting, setSubmitting] = useState(false);
  
  const formDataRef = useRef({});
  const [, forceUpdate] = useState({});
  
  const { data: tasksData, isLoading, refetch } = useQuery({
    queryKey: ['user-tasks', userEmail, filter],
    queryFn: () => taskService.getUserTasks(userEmail),
    enabled: !!userEmail
  });
  
  const claimMutation = useMutation({
    mutationFn: (taskId) => taskService.claimTask(taskId, userEmail),
    onSuccess: () => {
      queryClient.invalidateQueries(['user-tasks', userEmail]);
      toast.success('Tâche prise en charge');
    },
    onError: (error) => {
      toast.error(error.message || 'Erreur lors de la prise en charge');
    }
  });
  
  const completeMutation = useMutation({
    mutationFn: ({ taskId, variables, taskDefinitionKey, requisitionId, estimatedAmount }) =>
      taskService.completeTask(taskId, { variables, taskDefinitionKey, requisitionId, estimatedAmount }),
    onSuccess: () => {
      queryClient.invalidateQueries(['user-tasks', userEmail]);
      toast.success('Tâche complétée avec succès');
      setSelectedTask(null);
      formDataRef.current = {};
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || 'Erreur lors de la complétion');
      setSubmitting(false);
    }
  });
  
  const tasks = tasksData?.data || [];
  
  // Filtrer les tâches par état (state === 'completed' = terminé)
  const filteredTasks = tasks.filter(task => {
    // Si la tâche est terminée, on ne l'affiche que dans l'onglet 'completed'
    const isCompleted = task.state === 'completed';
    
    if (filter === 'pending') return !isCompleted;
    if (filter === 'completed') return isCompleted;
    return true; // 'all'
  });
  
  const handleClaim = async (taskId) => {
    await claimMutation.mutateAsync(taskId);
  };
  
  const handleCompleteTask = (task) => {
    const route = getFormRoute(task);
    if (route) {
      navigate(route);
      return;
    }
    setSelectedTask(task);
    formDataRef.current = {};
    forceUpdate({});
  };
  
  const handleSubmitTask = async () => {
    setSubmitting(true);
    try {
      await completeMutation.mutateAsync({
        taskId: selectedTask.id,
        variables: formDataRef.current,
        taskDefinitionKey: selectedTask.taskDefinitionKey,
        requisitionId: selectedTask.variables?.requisitionId,
        estimatedAmount: selectedTask.variables?.estimatedAmount
      });
    } finally {
      setSubmitting(false);
    }
  };
  
  const updateFormData = (key, value) => {
    formDataRef.current[key] = value;
    forceUpdate({});
  };
  
  const handleViewRequisition = (requisitionId) => {
    if (requisitionId) {
      navigate(`/requisitions/${requisitionId}`);
    }
  };
  
  const getTaskIcon = (task) => {
    const key = task?.taskDefinitionKey || '';
    if (key.includes('Validation') || key.includes('Approval') || key.includes('Approbation')) {
      return <CheckCircle size={20} className="text-blue-500" />;
    }
    if (key.includes('Budget')) {
      return <DollarSign size={20} className="text-yellow-500" />;
    }
    if (key.includes('PO') || key.includes('Purchase') || key.includes('CreatePO')) {
      return <Package size={20} className="text-green-500" />;
    }
    return <User size={20} className="text-purple-500" />;
  };

  const getTaskColor = (task) => {
    const key = task?.taskDefinitionKey || '';
    if (key.includes('Validation') || key.includes('Approval')) return 'border-blue-200 bg-blue-50';
    if (key.includes('Budget')) return 'border-yellow-200 bg-yellow-50';
    if (key.includes('PO') || key.includes('Purchase') || key.includes('CreatePO')) return 'border-green-200 bg-green-50';
    return 'border-gray-200 bg-gray-50';
  };

  const getTaskName = (task) => getTaskLabel(task);
  
  // Compter les tâches par état
  const pendingCount = tasks.filter(t => t.state !== 'completed').length;
  const completedCount = tasks.filter(t => t.state === 'completed').length;
  
  // Task definition keys that approve/reject a requisition (variable: approved)
  const REQUISITION_APPROVAL_KEYS = [
    'Activity_ManagerApproval',
    'Activity_FinanceApproval',
    'Activity_DGApproval'
  ];

  const isRequisitionApproval = (task) =>
    REQUISITION_APPROVAL_KEYS.includes(task.taskDefinitionKey) ||
    ['Validation', 'Hierarchical', 'Approbation Réquisition', 'Hierarchical Approval'].some(k =>
      (task.name || '').includes(k)
    );

  const isPOApproval = (task) =>
    task.taskDefinitionKey === 'Activity_POApproval' ||
    (task.name || '').includes('Approbation Commande') ||
    (task.name || '').includes('PO Approval');

  // Tâches qui ont un formulaire dédié → redirection au lieu de la modale
  const FORM_TASKS = {
    'Activity_GoodsReceipt':      (t) => `/goods-receipts/new?taskId=${t.id}&poId=${t.variables?.poId || ''}`,
    'Activity_ServiceAcceptance': (t) => `/service-acceptance-notes/new?taskId=${t.id}&poId=${t.variables?.poId || ''}`,
    'Activity_EnterInvoice':      (t) => `/invoices/new?taskId=${t.id}&poId=${t.variables?.poId || ''}`,
    'Activity_ProcessPayment':    (t) => `/payments/new?taskId=${t.id}&poId=${t.variables?.poId || ''}`,
  };

  const getFormRoute = (task) => {
    const fn = FORM_TASKS[task.taskDefinitionKey];
    return fn ? fn(task) : null;
  };

  const TaskForm = ({ task, onChange }) => {
    const isDetermineType = task.taskDefinitionKey === 'Activity_DetermineType';
    const variables = task.variables || {};

    return (
      <div className="space-y-4">
        {/* Requisition summary */}
        <div className="bg-blue-50 p-4 rounded-lg">
          <h4 className="font-medium text-blue-800 mb-2">Informations de la réquisition</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="text-gray-600 flex items-center gap-1"><Hash size={14} />Numéro:</div>
            <div className="font-medium">{variables.requisitionNumber || '-'}</div>

            <div className="text-gray-600 flex items-center gap-1"><ShoppingCart size={14} />Titre:</div>
            <div className="font-medium">{variables.title || '-'}</div>

            <div className="text-gray-600 flex items-center gap-1"><DollarSign size={14} />Montant:</div>
            <div className="font-medium">
              {variables.estimatedAmount?.toLocaleString()} {variables.currency || currency.code}
            </div>

            <div className="text-gray-600 flex items-center gap-1"><Building2 size={14} />Département:</div>
            <div className="font-medium">{variables.departementCode || variables.department || '-'}</div>

            <div className="text-gray-600 flex items-center gap-1"><User size={14} />Demandeur:</div>
            <div className="font-medium">{variables.requesterUsername || variables.requester || '-'}</div>

            <div className="text-gray-600 flex items-center gap-1"><Package size={14} />Projet:</div>
            <div className="font-medium">{variables.projectName || variables.projectCode || '-'}</div>
          </div>
        </div>

        {/* Items list */}
        {variables.items && (
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 font-medium text-sm">Articles</div>
            <div className="divide-y divide-gray-200 max-h-48 overflow-y-auto">
              {(() => {
                try {
                  const items = JSON.parse(variables.items);
                  return items.map((item, idx) => (
                    <div key={idx} className="p-3 text-sm">
                      <div className="font-medium">{item.description}</div>
                      <div className="text-gray-500 text-xs mt-1">
                        Qté: {item.quantity} × Fréq: {item.frequency} × Prix: {item.unitPrice} = {item.total}
                      </div>
                      {item.budgetLineCode && (
                        <div className="text-xs text-blue-600 mt-1">
                          Budget: {item.budgetLineCode} – {item.budgetLineDescription}
                        </div>
                      )}
                    </div>
                  ));
                } catch (e) {
                  return <div className="p-3 text-sm text-gray-500">Erreur de chargement des articles</div>;
                }
              })()}
            </div>
          </div>
        )}

        {/* Requisition approval (N1 / N2 / N3) — variable: approved */}
        {isRequisitionApproval(task) && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Décision *</label>
              <select
                defaultValue=""
                onChange={(e) => onChange('approved', e.target.value === 'true')}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="">Sélectionner...</option>
                <option value="true">✅ Approuver</option>
                <option value="false">❌ Rejeter</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Commentaire</label>
              <textarea
                defaultValue=""
                onBlur={(e) => onChange('comment', e.target.value)}
                rows="3"
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="Ajoutez un commentaire..."
              />
            </div>
          </>
        )}

        {/* PO Approval — variable: poApproved */}
        {isPOApproval(task) && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Décision sur le bon de commande *</label>
              <select
                defaultValue=""
                onChange={(e) => onChange('poApproved', e.target.value === 'true')}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="">Sélectionner...</option>
                <option value="true">✅ Approuver le bon de commande</option>
                <option value="false">❌ Rejeter le bon de commande</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Commentaire</label>
              <textarea
                defaultValue=""
                onBlur={(e) => onChange('comment', e.target.value)}
                rows="3"
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="Ajoutez un commentaire..."
              />
            </div>
          </>
        )}

        {/* Procurement method selection */}
        {isDetermineType && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Méthode d'achat *</label>
            <select
              defaultValue=""
              onChange={(e) => onChange('procurementMethod', e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">Sélectionner...</option>
              <option value="DIRECT_PURCHASE">Achat direct (&lt; 5 000)</option>
              <option value="MULTIPLE_QUOTATIONS">Multiples devis (5 000 – 25 000)</option>
              <option value="RFP">Appel d'offres (&gt; 25 000)</option>
              <option value="SOLE_SOURCE">Source unique (justifiée)</option>
            </select>
          </div>
        )}

        {/* Generic comment for all other tasks */}
        {!isRequisitionApproval(task) && !isPOApproval(task) && !isDetermineType && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Commentaire</label>
            <textarea
              defaultValue=""
              onBlur={(e) => onChange('comment', e.target.value)}
              rows="4"
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Ajoutez un commentaire..."
            />
          </div>
        )}
      </div>
    );
  };
  
  if (!userEmail) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded-lg">
        <AlertCircle className="mx-auto h-12 w-12 text-yellow-500 mb-3" />
        <p className="text-gray-500">Veuillez vous connecter pour voir vos tâches</p>
      </div>
    );
  }
  
  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-12">
        <LoadingSpinner text="Chargement des tâches..." />
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Mes tâches</h2>
          <p className="text-sm text-gray-500 mt-1">
            Gérez vos tâches d'approbation et de traitement
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50"
        >
          <RefreshCw size={16} />
          Rafraîchir
        </button>
      </div>
      
      {/* Filtres */}
      <div className="flex gap-2 border-b pb-2">
        <button
          onClick={() => setFilter('pending')}
          className={`px-3 py-1 text-sm rounded-full transition-colors ${
            filter === 'pending' 
              ? 'bg-yellow-600 text-white' 
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          En attente ({pendingCount})
        </button>
        <button
          onClick={() => setFilter('completed')}
          className={`px-3 py-1 text-sm rounded-full transition-colors ${
            filter === 'completed' 
              ? 'bg-green-600 text-white' 
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          Terminées ({completedCount})
        </button>
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1 text-sm rounded-full transition-colors ${
            filter === 'all' 
              ? 'bg-blue-600 text-white' 
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          Toutes ({tasks.length})
        </button>
      </div>
      
      {/* Liste des tâches */}
      {filteredTasks.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <CheckCircle className="mx-auto h-12 w-12 text-green-500 mb-3" />
          <p className="text-gray-500">
            {filter === 'pending' ? 'Aucune tâche en attente' : 
             filter === 'completed' ? 'Aucune tâche terminée' : 
             'Aucune tâche trouvée'}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            Les tâches qui vous sont assignées apparaîtront ici
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredTasks.map(task => {
            const variables = task.variables || {};
            const isCompleted = task.state === 'completed';
            
            return (
              <div 
                key={task.id} 
                className={`bg-white rounded-lg shadow border-l-4 ${getTaskColor(task)} p-4 hover:shadow-md transition-shadow ${!isCompleted ? 'cursor-pointer' : ''}`}
                onClick={() => !isCompleted && handleCompleteTask(task)}
              >
                <div className="flex flex-wrap justify-between items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      {getTaskIcon(task)}
                      <h3 className="font-semibold text-gray-800">{getTaskLabel(task)}</h3>
                      {isCompleted && (
                        <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full">
                          Terminée
                        </span>
                      )}
                    </div>
                    
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <div className="text-gray-500">Réquisition:</div>
                      <div className="font-medium text-blue-600">{variables.requisitionNumber || '-'}</div>
                      
                      <div className="text-gray-500">Titre:</div>
                      <div className="font-medium truncate">{variables.title || '-'}</div>
                      
                      <div className="text-gray-500">Montant:</div>
                      <div className="font-medium">{variables.estimatedAmount?.toLocaleString()} {variables.currency || currency.code}</div>
                      
                      <div className="text-gray-500">Projet:</div>
                      <div className="font-medium">{variables.projectName || variables.projectCode || '-'}</div>
                    </div>
                    
                    <p className="text-xs text-gray-400 mt-2">
                      Créée le: {variables.createdAt ? new Date(variables.createdAt).toLocaleString() : 'Date inconnue'}
                    </p>
                    {task.assignee && (
                      <p className="text-xs text-gray-400 mt-1">
                        Assignée à: {task.assignee}
                      </p>
                    )}
                  </div>
                  
                  <div className="flex gap-2">
                    {variables.requisitionId && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewRequisition(variables.requisitionId);
                        }}
                        className="p-2 text-gray-500 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                        title="Voir la réquisition"
                      >
                        <Eye size={18} />
                      </button>
                    )}
                    
                    {!isCompleted && task.status !== 'COMPLETED' && (
                      <>
                        {task.status === 'UNASSIGNED' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleClaim(task.id);
                            }}
                            disabled={claimMutation.isPending}
                            className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                          >
                            <User size={16} />
                            Prendre en charge
                          </button>
                        )}
                        
                        {task.assignee === userEmail && task.status !== 'COMPLETED' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCompleteTask(task);
                            }}
                            className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
                          >
                            <Send size={16} />
                            {getFormRoute(task) ? 'Ouvrir le formulaire' : 'Traiter'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      
      <Modal
        isOpen={!!selectedTask}
        onClose={() => {
          setSelectedTask(null);
          formDataRef.current = {};
        }}
        title={selectedTask ? getTaskName(selectedTask) : 'Traitement de la tâche'}
        confirmText="Valider"
        cancelText="Annuler"
        onConfirm={handleSubmitTask}
        isLoading={submitting}
        size="lg"
      >
        {selectedTask && (
          <TaskForm 
            task={selectedTask} 
            onChange={updateFormData}
          />
        )}
      </Modal>
    </div>
  );
};

export default TaskList;