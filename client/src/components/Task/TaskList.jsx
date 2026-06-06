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
import Modal from '../Common/Modal';
import LoadingSpinner from '../Common/LoadingSpinner';
import toast from 'react-hot-toast';

const TaskList = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
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
    mutationFn: ({ taskId, variables }) => taskService.completeTask(taskId, variables),
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
    setSelectedTask(task);
    formDataRef.current = {};
    forceUpdate({});
  };
  
  const handleSubmitTask = async () => {
    setSubmitting(true);
    try {
      await completeMutation.mutateAsync({ 
        taskId: selectedTask.id, 
        variables: formDataRef.current 
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
  
  const getTaskIcon = (taskName) => {
    if (!taskName) return <User size={20} className="text-purple-500" />;
    if (taskName.includes('Validation') || taskName.includes('Approbation')) {
      return <CheckCircle size={20} className="text-blue-500" />;
    }
    if (taskName.includes('Budget')) {
      return <DollarSign size={20} className="text-yellow-500" />;
    }
    if (taskName.includes('Purchase') || taskName.includes('Commande')) {
      return <Package size={20} className="text-green-500" />;
    }
    return <User size={20} className="text-purple-500" />;
  };
  
  const getTaskColor = (taskName) => {
    if (!taskName) return 'border-gray-200';
    if (taskName.includes('Validation')) return 'border-blue-200 bg-blue-50';
    if (taskName.includes('Budget')) return 'border-yellow-200 bg-yellow-50';
    if (taskName.includes('Purchase')) return 'border-green-200 bg-green-50';
    return 'border-gray-200 bg-gray-50';
  };
  
  const getTaskName = (task) => {
    return task.name || task.taskName || task.activityName || 'Tâche sans nom';
  };
  
  // Compter les tâches par état
  const pendingCount = tasks.filter(t => t.state !== 'completed').length;
  const completedCount = tasks.filter(t => t.state === 'completed').length;
  
  const TaskForm = ({ task, onChange }) => {
    const taskName = getTaskName(task);
    const variables = task.variables || {};
    
    return (
      <div className="space-y-4">
        <div className="bg-blue-50 p-4 rounded-lg">
          <h4 className="font-medium text-blue-800 mb-2">Informations de la réquisition</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="text-gray-600 flex items-center gap-1">
              <Hash size={14} />
              Numéro:
            </div>
            <div className="font-medium">{variables.requisitionNumber || '-'}</div>
            
            <div className="text-gray-600 flex items-center gap-1">
              <ShoppingCart size={14} />
              Titre:
            </div>
            <div className="font-medium">{variables.title || '-'}</div>
            
            <div className="text-gray-600 flex items-center gap-1">
              <DollarSign size={14} />
              Montant:
            </div>
            <div className="font-medium">{variables.estimatedAmount?.toLocaleString()} {variables.currency || 'USD'}</div>
            
            <div className="text-gray-600 flex items-center gap-1">
              <Building2 size={14} />
              Département:
            </div>
            <div className="font-medium">{variables.department || '-'}</div>
            
            <div className="text-gray-600 flex items-center gap-1">
              <User size={14} />
              Demandeur:
            </div>
            <div className="font-medium">{variables.requester || '-'}</div>
            
            <div className="text-gray-600 flex items-center gap-1">
              <Package size={14} />
              Projet:
            </div>
            <div className="font-medium">{variables.projectName || variables.projectCode || '-'}</div>
          </div>
        </div>
        
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
                        Quantité: {item.quantity} | Fréquence: {item.frequency} | Prix: {item.unitPrice} | Total: {item.total}
                      </div>
                      {item.budgetLineCode && (
                        <div className="text-xs text-blue-600 mt-1">
                          Budget: {item.budgetLineCode} - {item.budgetLineDescription}
                        </div>
                      )}
                    </div>
                  ));
                } catch (e) {
                  return <div className="p-3 text-sm text-gray-500">Erreur de chargement</div>;
                }
              })()}
            </div>
          </div>
        )}
        
        {(taskName.includes('Validation') || 
          taskName.includes('Hierarchical') ||
          taskName.includes('Approbation')) && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Décision *
              </label>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Commentaire
              </label>
              <textarea
                defaultValue=""
                onBlur={(e) => onChange('comment', e.target.value)}
                rows="4"
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="Ajoutez un commentaire..."
              />
            </div>
          </>
        )}

        {(taskName.includes('Determine') || 
          taskName.includes('Procurement')) && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Méthode d'achat *
            </label>
            <select
              defaultValue=""
              onChange={(e) => onChange('procurementMethod', e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">Sélectionner...</option>
              <option value="DIRECT_PURCHASE">Achat direct</option>
              <option value="MULTIPLE_QUOTATIONS">Multiples devis</option>
              <option value="RFP">Appel d'offres</option>
              <option value="SOLE_SOURCE">Source unique</option>
            </select>
          </div>
        )}

        {taskName.includes('Budget Adjustment') && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nouveau montant proposé *
            </label>
            <input
              type="number"
              step="0.01"
              defaultValue=""
              onBlur={(e) => onChange('newBudgetAmount', parseFloat(e.target.value))}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Montant proposé"
            />
            <div className="mt-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Justification de l'ajustement
              </label>
              <textarea
                defaultValue=""
                onBlur={(e) => onChange('adjustmentJustification', e.target.value)}
                rows="3"
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="Expliquez pourquoi un ajustement budgétaire est nécessaire..."
              />
            </div>
          </div>
        )}

        {!taskName.includes('Validation') &&
         !taskName.includes('Hierarchical') &&
         !taskName.includes('Approbation') &&
         !taskName.includes('Determine') &&
         !taskName.includes('Procurement') &&
         !taskName.includes('Budget Adjustment') && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Commentaire
            </label>
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
                className={`bg-white rounded-lg shadow border-l-4 ${getTaskColor(task.name)} p-4 hover:shadow-md transition-shadow ${!isCompleted ? 'cursor-pointer' : ''}`}
                onClick={() => !isCompleted && handleCompleteTask(task)}
              >
                <div className="flex flex-wrap justify-between items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      {getTaskIcon(task.name)}
                      <h3 className="font-semibold text-gray-800">{task.name}</h3>
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
                      <div className="font-medium">{variables.estimatedAmount?.toLocaleString()} {variables.currency || 'USD'}</div>
                      
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
                            Traiter
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