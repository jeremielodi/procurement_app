// src/components/Requisitions/RequisitionWorkflow.jsx
import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  ArrowLeft,
  RefreshCw,
  User,
  Calendar,
  MessageSquare,
  Send,
  Eye,
  FileText,
  TrendingUp,
  TrendingDown,
  Activity,
  Zap,
  Shield,
  Users,
  Building2,
  DollarSign,
  Package,
  Truck,
  FileCheck,
  ThumbsUp,
  ThumbsDown,
  Play,
  Pause,
  StopCircle,
  RotateCcw,
  ChevronRight,
  ChevronDown,
  MoreVertical
} from 'lucide-react'
import requisitionService from '../../services/requisitionService'
import { workflowService } from '../../services/workflowService'
import StatusBadge from '../Common/StatusBadge'
import LoadingSpinner from '../Common/LoadingSpinner'
import ErrorAlert from '../Common/ErrorAlert'
import Modal from '../Common/Modal'
import { formatDateTime } from '../../utils/formatters'
import toast from 'react-hot-toast'

export default function RequisitionWorkflow() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [selectedTask, setSelectedTask] = useState(null)
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [taskComment, setTaskComment] = useState('')
  const [taskVariables, setTaskVariables] = useState({})
  const [expandedSteps, setExpandedSteps] = useState(new Set())
  const [autoRefresh, setAutoRefresh] = useState(true)

  // Récupérer les détails de la réquisition
  const { data: requisitionData, isLoading: requisitionLoading } = useQuery({
    queryKey: ['requisition', id],
    queryFn: () => requisitionService.getById(id),
    enabled: !!id
  })

  // Récupérer le statut du processus
  const { data: processStatus, isLoading: processLoading, refetch: refetchProcess } = useQuery({
    queryKey: ['process-status', requisitionData?.data?.process_instance_id],
    queryFn: () => workflowService.getProcessStatus(requisitionData?.data?.process_instance_id),
    enabled: !!requisitionData?.data?.process_instance_id,
    refetchInterval: autoRefresh ? 5000 : false
  })

  // Récupérer les tâches du processus
  const { data: processTasks, isLoading: tasksLoading, refetch: refetchTasks } = useQuery({
    queryKey: ['process-tasks', requisitionData?.data?.process_instance_id],
    queryFn: () => workflowService.getProcessTasks(requisitionData?.data?.process_instance_id),
    enabled: !!requisitionData?.data?.process_instance_id,
    refetchInterval: autoRefresh ? 5000 : false
  })

  // Récupérer l'historique du workflow
  const { data: workflowHistory, refetch: refetchHistory } = useQuery({
    queryKey: ['workflow-history', requisitionData?.data?.process_instance_id],
    queryFn: () => workflowService.getProcessHistory(requisitionData?.data?.process_instance_id),
    enabled: !!requisitionData?.data?.process_instance_id
  })

  const requisition = requisitionData?.data
  const process = processStatus?.data
  const tasks = processTasks?.data || []
  const history = workflowHistory?.data || []

  // Mutation pour compléter une tâche
  const completeTaskMutation = useMutation({
    mutationFn: (data) => workflowService.completeTask(data.taskId, data.variables),
    onSuccess: () => {
      refetchProcess()
      refetchTasks()
      refetchHistory()
      toast.success('Tâche complétée avec succès')
      setShowTaskModal(false)
      setSelectedTask(null)
      setTaskComment('')
      setTaskVariables({})
    },
    onError: (error) => {
      toast.error(error.message || 'Erreur lors de la complétion de la tâche')
    }
  })

  // Mutation pour suspendre le processus
  const suspendProcessMutation = useMutation({
    mutationFn: () => workflowService.suspendProcess(requisition?.process_instance_id),
    onSuccess: () => {
      refetchProcess()
      toast.success('Processus suspendu')
    },
    onError: (error) => {
      toast.error(error.message || 'Erreur lors de la suspension')
    }
  })

  // Mutation pour reprendre le processus
  const resumeProcessMutation = useMutation({
    mutationFn: () => workflowService.resumeProcess(requisition?.process_instance_id),
    onSuccess: () => {
      refetchProcess()
      toast.success('Processus repris')
    },
    onError: (error) => {
      toast.error(error.message || 'Erreur lors de la reprise')
    }
  })

  const handleCompleteTask = (task) => {
    setSelectedTask(task)
    setShowTaskModal(true)
  }

  const handleSubmitTask = () => {
    const variables = {
      ...taskVariables,
      comment: taskComment
    }
    completeTaskMutation.mutate({
      taskId: selectedTask.id,
      variables
    })
  }

  const toggleStepExpanded = (stepId) => {
    const newExpanded = new Set(expandedSteps)
    if (newExpanded.has(stepId)) {
      newExpanded.delete(stepId)
    } else {
      newExpanded.add(stepId)
    }
    setExpandedSteps(newExpanded)
  }

  const getStepStatusIcon = (status) => {
    switch (status) {
      case 'COMPLETED':
        return <CheckCircle className="h-5 w-5 text-green-500" />
      case 'ACTIVE':
        return <Activity className="h-5 w-5 text-blue-500 animate-pulse" />
      case 'SUSPENDED':
        return <Pause className="h-5 w-5 text-yellow-500" />
      case 'FAILED':
        return <AlertCircle className="h-5 w-5 text-red-500" />
      default:
        return <Clock className="h-5 w-5 text-gray-400" />
    }
  }

  const getStepStatusColor = (status) => {
    switch (status) {
      case 'COMPLETED':
        return 'border-green-500 bg-green-50'
      case 'ACTIVE':
        return 'border-blue-500 bg-blue-50'
      case 'SUSPENDED':
        return 'border-yellow-500 bg-yellow-50'
      case 'FAILED':
        return 'border-red-500 bg-red-50'
      default:
        return 'border-gray-300 bg-gray-50'
    }
  }

  if (requisitionLoading || processLoading || tasksLoading) {
    return (
      <div className="flex justify-center items-center h-96">
        <LoadingSpinner size="lg" text="Chargement du workflow..." />
      </div>
    )
  }

  if (!requisition || !process) {
    return (
      <div className="p-6 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-900">Workflow non trouvé</h3>
        <p className="mt-1 text-gray-500">Aucun processus n'est associé à cette réquisition.</p>
        <button
          onClick={() => navigate(`/requisitions/${id}`)}
          className="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <ArrowLeft size={18} className="mr-2" />
          Retour à la réquisition
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(`/requisitions/${id}`)}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">
              Workflow - {requisition.requisition_number}
            </h1>
            <div className="flex items-center gap-3 mt-1">
              <StatusBadge status={process.status} size="sm" />
              <span className="text-sm text-gray-500">
                Instance: {process.id}
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setAutoRefresh(!autoRefresh)
              if (!autoRefresh) {
                refetchProcess()
                refetchTasks()
                refetchHistory()
              }
            }}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
              autoRefresh 
                ? 'bg-green-100 text-green-700' 
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            <RefreshCw size={16} className={autoRefresh ? 'animate-spin' : ''} />
            Auto-refresh {autoRefresh ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={() => {
              refetchProcess()
              refetchTasks()
              refetchHistory()
            }}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <RefreshCw size={16} />
            Rafraîchir
          </button>
          {process.status === 'ACTIVE' ? (
            <button
              onClick={() => suspendProcessMutation.mutate()}
              className="flex items-center gap-2 px-3 py-2 border border-yellow-500 text-yellow-600 rounded-lg hover:bg-yellow-50"
            >
              <Pause size={16} />
              Suspendre
            </button>
          ) : process.status === 'SUSPENDED' ? (
            <button
              onClick={() => resumeProcessMutation.mutate()}
              className="flex items-center gap-2 px-3 py-2 border border-green-500 text-green-600 rounded-lg hover:bg-green-50"
            >
              <Play size={16} />
              Reprendre
            </button>
          ) : null}
        </div>
      </div>

      {/* Métriques du processus */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Durée totale</p>
              <p className="text-2xl font-bold text-gray-800">
                {process.duration || 'En cours'}
              </p>
            </div>
            <Clock className="h-8 w-8 text-blue-500" />
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Tâches complétées</p>
              <p className="text-2xl font-bold text-green-600">
                {history.filter(h => h.status === 'COMPLETED').length}
              </p>
            </div>
            <CheckCircle className="h-8 w-8 text-green-500" />
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Tâches actives</p>
              <p className="text-2xl font-bold text-blue-600">
                {tasks.length}
              </p>
            </div>
            <Activity className="h-8 w-8 text-blue-500" />
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Progression</p>
              <p className="text-2xl font-bold text-purple-600">
                {Math.round((history.filter(h => h.status === 'COMPLETED').length / 
                  (history.length || 1)) * 100)}%
              </p>
            </div>
            <TrendingUp className="h-8 w-8 text-purple-500" />
          </div>
        </div>
      </div>

      {/* Vue du processus - Timeline */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <Activity size={20} />
            Timeline du processus
          </h2>
        </div>
        <div className="p-6">
          <div className="flow-root">
            <ul className="-mb-8">
              {history.map((step, index) => (
                <li key={step.id || index} className="relative pb-8">
                  {index < history.length - 1 && (
                    <span
                      className="absolute top-5 left-5 -ml-px h-full w-0.5 bg-gray-200"
                      aria-hidden="true"
                    />
                  )}
                  <div className="relative flex items-start space-x-3">
                    <div className="relative">
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center ring-8 ring-white ${getStepStatusColor(step.status)}`}>
                        {getStepStatusIcon(step.status)}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {step.task_name || step.activity_name}
                          </p>
                          {step.assignee && (
                            <div className="flex items-center gap-1 mt-1">
                              <User size={12} className="text-gray-400" />
                              <span className="text-xs text-gray-500">
                                Assigné à: {step.assignee}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {step.completed_at && (
                            <span className="text-xs text-gray-400">
                              {formatDateTime(step.completed_at)}
                            </span>
                          )}
                          {step.status === 'ACTIVE' && (
                            <button
                              onClick={() => {
                                const activeTask = tasks.find(t => t.name === step.task_name)
                                if (activeTask) handleCompleteTask(activeTask)
                              }}
                              className="flex items-center gap-1 px-2 py-1 text-xs bg-green-100 text-green-700 rounded-lg hover:bg-green-200"
                            >
                              <Send size={12} />
                              Compléter
                            </button>
                          )}
                          {step.comments && (
                            <button
                              onClick={() => toggleStepExpanded(step.id)}
                              className="p-1 text-gray-400 hover:text-gray-600"
                            >
                              {expandedSteps.has(step.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          )}
                        </div>
                      </div>
                      {expandedSteps.has(step.id) && step.comments && (
                        <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                          <p className="text-sm text-gray-600">{step.comments}</p>
                          {step.variables && (
                            <pre className="mt-2 text-xs text-gray-500 overflow-x-auto">
                              {JSON.stringify(step.variables, null, 2)}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Tâches actives */}
      {tasks.length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <Zap size={20} />
              Tâches en attente ({tasks.length})
            </h2>
          </div>
          <div className="divide-y divide-gray-200">
            {tasks.map((task) => (
              <div key={task.id} className="p-6 hover:bg-gray-50 transition-colors">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-gray-900">{task.name}</h3>
                      <StatusBadge status="PENDING" size="sm" />
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      Assignée à: {task.assignee || 'Non assignée'}
                    </p>
                    {task.created && (
                      <p className="text-xs text-gray-400 mt-1">
                        Créée le: {formatDateTime(task.created)}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleCompleteTask(task)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    <CheckCircle size={16} />
                    Compléter
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Variables du processus */}
      {process.variables && Object.keys(process.variables).length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <FileText size={20} />
              Variables du processus
            </h2>
          </div>
          <div className="p-6">
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(process.variables).map(([key, value]) => (
                <div key={key} className="border-b border-gray-100 pb-2">
                  <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {key}
                  </dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}

      {/* Modal de complétion de tâche */}
      <Modal
        isOpen={showTaskModal}
        onClose={() => {
          setShowTaskModal(false)
          setSelectedTask(null)
          setTaskComment('')
          setTaskVariables({})
        }}
        title={`Compléter: ${selectedTask?.name}`}
        confirmText="Valider"
        cancelText="Annuler"
        onConfirm={handleSubmitTask}
        isLoading={completeTaskMutation.isPending}
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Commentaire
            </label>
            <textarea
              value={taskComment}
              onChange={(e) => setTaskComment(e.target.value)}
              rows="3"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Ajoutez un commentaire (optionnel)..."
            />
          </div>
          
          {selectedTask?.formVariables && Object.keys(selectedTask.formVariables).length > 0 && (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700">
                Variables du formulaire
              </label>
              {Object.entries(selectedTask.formVariables).map(([key, config]) => (
                <div key={key}>
                  <label className="block text-sm text-gray-600 mb-1">
                    {config.label || key}
                  </label>
                  {config.type === 'boolean' ? (
                    <select
                      value={taskVariables[key] || ''}
                      onChange={(e) => setTaskVariables({...taskVariables, [key]: e.target.value === 'true'})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    >
                      <option value="">Sélectionner</option>
                      <option value="true">Oui</option>
                      <option value="false">Non</option>
                    </select>
                  ) : config.type === 'number' ? (
                    <input
                      type="number"
                      value={taskVariables[key] || ''}
                      onChange={(e) => setTaskVariables({...taskVariables, [key]: parseFloat(e.target.value)})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    />
                  ) : (
                    <input
                      type="text"
                      value={taskVariables[key] || ''}
                      onChange={(e) => setTaskVariables({...taskVariables, [key]: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      placeholder={config.description}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}