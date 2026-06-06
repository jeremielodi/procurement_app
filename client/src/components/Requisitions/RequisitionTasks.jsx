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
  FileText
} from 'lucide-react';
import { requisitionService } from '../../services/requisitionService';
import { taskService } from '../../services/taskService';
import StatusBadge from '../Common/StatusBadge';
import LoadingSpinner from '../Common/LoadingSpinner';
import Modal from '../Common/Modal';
import toast from 'react-hot-toast';

export default function RequisitionTasks() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [requisition, setRequisition] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
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
      toast.error('Erreur lors du chargement des données');
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteTask = (task) => {
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
      toast.success('Tâche complétée avec succès');
      setShowTaskModal(false);
      setSelectedTask(null);
      loadData();
    } catch (error) {
      console.error('Error completing task:', error);
      toast.error('Erreur lors de la complétion de la tâche');
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

  const getTaskName = (task) => {
    return task.name || task.taskName || task.activityName || 'Tâche sans nom';
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD' }).format(amount || 0);
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Date inconnue';
    return new Date(dateString).toLocaleString('fr-FR');
  };

  const getProgress = () => {
    const total = tasks.length;
    const completed = tasks.filter(t => t.status === 'COMPLETED').length;
    return total > 0 ? (completed / total) * 100 : 0;
  };

  if (loading) {
    return <LoadingSpinner text="Chargement des tâches..." />;
  }

  const progress = getProgress();
  const pendingTasks = tasks.filter(t => t.status === 'PENDING');
  const completedTasks = tasks.filter(t => t.status === 'COMPLETED');

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
          <h1 className="text-2xl font-bold text-gray-800">Tâches du workflow</h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-gray-500">Réquisition: {requisition?.requisition_number}</p>
            <StatusBadge status={requisition?.status} size="sm" />
          </div>
        </div>
      </div>

      {/* Barre de progression */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-gray-700">Progression du workflow</span>
          <span className="text-sm font-medium text-blue-600">{Math.round(progress)}%</span>
        </div>
        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-blue-600 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-500">
          <span>📋 {completedTasks.length} terminée(s)</span>
          <span>⏳ {pendingTasks.length} en attente</span>
          <span>📊 {tasks.length} totale(s)</span>
        </div>
      </div>

      {/* Statistiques */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <div className="text-2xl font-bold text-blue-600">{tasks.length}</div>
          <div className="text-sm text-gray-500">Tâches totales</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <div className="text-2xl font-bold text-yellow-600">{pendingTasks.length}</div>
          <div className="text-sm text-gray-500">En attente</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <div className="text-2xl font-bold text-green-600">{completedTasks.length}</div>
          <div className="text-sm text-gray-500">Terminées</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <div className="text-2xl font-bold text-purple-600">
            {formatCurrency(requisition?.estimated_amount)}
          </div>
          <div className="text-sm text-gray-500">Montant total</div>
        </div>
      </div>

      {/* Tâches en attente */}
      {pendingTasks.length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Clock size={20} className="text-yellow-500" />
              Tâches en attente ({pendingTasks.length})
            </h2>
          </div>
          <div className="divide-y divide-gray-200">
            {pendingTasks.map((task) => (
              <div key={task.id} className={`p-6 hover:bg-gray-50 transition-colors ${getTaskColor(task.name)}`}>
                <div className="flex justify-between items-start">
                  <div className="flex gap-3 flex-1">
                    {getTaskIcon(getTaskName(task))}
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-800">{getTaskName(task)}</h3>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 mt-2 text-sm">
                        <div className="text-gray-500">Réquisition:</div>
                        <div className="font-medium text-blue-600">{task.variables?.requisitionNumber || '-'}</div>
                        <div className="text-gray-500">Montant:</div>
                        <div>{formatCurrency(task.variables?.estimatedAmount)}</div>
                        <div className="text-gray-500">Projet:</div>
                        <div>{task.variables?.projectName || task.variables?.projectCode || '-'}</div>
                        <div className="text-gray-500">Créée le:</div>
                        <div>{formatDate(task.created)}</div>
                      </div>
                      <p className="text-sm text-gray-500 mt-2">
                        Assignée à: {task.assignee || 'Non assignée'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleCompleteTask(task)}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2"
                  >
                    <Send size={16} />
                    Traiter
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tâches terminées */}
      {completedTasks.length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <CheckCircle size={20} className="text-green-500" />
              Tâches terminées ({completedTasks.length})
            </h2>
          </div>
          <div className="divide-y divide-gray-200">
            {completedTasks.map((task) => (
              <div key={task.id} className="p-6 bg-gray-50">
                <div className="flex gap-3">
                  <CheckCircle size={20} className="text-green-500 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-gray-800">{getTaskName(task)}</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Complétée le: {task.completedAt ? formatDate(task.completedAt) : formatDate(task.updated)}
                    </p>
                    {task.assignee && (
                      <p className="text-xs text-gray-400 mt-1">Par: {task.assignee}</p>
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
          <p className="text-gray-500">Aucune tâche trouvée pour ce processus</p>
        </div>
      )}

      {/* Modal de traitement de tâche */}
      <Modal
        isOpen={showTaskModal}
        onClose={() => {
          setShowTaskModal(false);
          setSelectedTask(null);
        }}
        title={selectedTask ? getTaskName(selectedTask) : 'Traitement de la tâche'}
        confirmText="Valider"
        cancelText="Annuler"
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
                  Informations de la réquisition
                </h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="text-gray-600">Numéro:</div>
                  <div className="font-medium text-blue-700">{selectedTask.variables.requisitionNumber || '-'}</div>
                  <div className="text-gray-600">Titre:</div>
                  <div className="font-medium">{selectedTask.variables.title || '-'}</div>
                  <div className="text-gray-600">Montant:</div>
                  <div className="font-medium">{formatCurrency(selectedTask.variables.estimatedAmount)}</div>
                  <div className="text-gray-600">Département:</div>
                  <div className="font-medium">{selectedTask.variables.department || '-'}</div>
                  <div className="text-gray-600">Demandeur:</div>
                  <div className="font-medium">{selectedTask.variables.requester || selectedTask.variables.requesterUsername || '-'}</div>
                  <div className="text-gray-600">Projet:</div>
                  <div className="font-medium">{selectedTask.variables.projectName || selectedTask.variables.projectCode || '-'}</div>
                  <div className="text-gray-600">Créée le:</div>
                  <div className="font-medium">{formatDate(selectedTask.variables.createdAt)}</div>
                </div>
              </div>
            )}
            
            {/* Formulaire Validation */}
            {(getTaskName(selectedTask).includes('Validation') || 
              getTaskName(selectedTask).includes('Hierarchical') ||
              getTaskName(selectedTask).includes('Approbation')) && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Décision *
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
                      <span className="text-green-700">✅ Approuver</span>
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
                      <span className="text-red-700">❌ Rejeter</span>
                    </label>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Commentaire
                  </label>
                  <textarea
                    value={formData.comment}
                    onChange={(e) => handleInputChange('comment', e.target.value)}
                    rows="4"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Ajoutez un commentaire..."
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
                    Méthode d'achat *
                  </label>
                  <div className="space-y-2">
                    {[
                      { value: 'DIRECT_PURCHASE', label: 'Achat direct', desc: 'Pour les achats < 5 000 USD' },
                      { value: 'MULTIPLE_QUOTATIONS', label: 'Multiples devis', desc: 'Entre 5 000 et 25 000 USD' },
                      { value: 'RFP', label: 'Appel d\'offres (RFP)', desc: 'Pour les achats > 25 000 USD' },
                      { value: 'SOLE_SOURCE', label: 'Source unique', desc: 'Avec justification approuvée' }
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
                    Justification
                  </label>
                  <textarea
                    value={formData.justification}
                    onChange={(e) => handleInputChange('justification', e.target.value)}
                    rows="3"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Justifiez votre choix..."
                  />
                </div>
              </>
            )}

            {/* Formulaire Ajustement budgétaire */}
            {getTaskName(selectedTask).includes('Budget Adjustment') && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nouveau montant proposé *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.newBudgetAmount}
                    onChange={(e) => handleInputChange('newBudgetAmount', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Montant proposé"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Justification de l'ajustement
                  </label>
                  <textarea
                    value={formData.adjustmentJustification}
                    onChange={(e) => handleInputChange('adjustmentJustification', e.target.value)}
                    rows="3"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Expliquez pourquoi un ajustement budgétaire est nécessaire..."
                  />
                </div>
              </>
            )}

            {/* Formulaire commentaire générique */}
            {!getTaskName(selectedTask).includes('Validation') &&
             !getTaskName(selectedTask).includes('Hierarchical') &&
             !getTaskName(selectedTask).includes('Approbation') &&
             !getTaskName(selectedTask).includes('Determine') &&
             !getTaskName(selectedTask).includes('Procurement') &&
             !getTaskName(selectedTask).includes('Budget Adjustment') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Commentaire
                </label>
                <textarea
                  value={formData.comment}
                  onChange={(e) => handleInputChange('comment', e.target.value)}
                  rows="4"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Ajoutez un commentaire..."
                />
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}