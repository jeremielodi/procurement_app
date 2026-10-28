// src/components/Requisitions/RequisitionTasks.jsx
// Onglet tâches d'une réquisition : SEUL endroit où une tâche BpmnGo est prise en charge et traitée (« Mes tâches »
// renvoie ici avec ?task=<id>, mis en évidence). « Traiter » ouvre le formulaire dédié avec le document de CETTE
// réquisition (resolveTaskTarget : bon de commande selon son statut, dernière réception, facture non payée), ou un
// message clair s'il manque — jamais de document orphelin ni de tâche terminée sans son document.
import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
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
import ClaimTaskConfirm from '../Task/ClaimTaskConfirm';
import { UserMinus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useCurrency } from '../../contexts/EnterpriseContext';
import { purchaseOrderService } from '../../services/purchaseOrderService';
import { grnService } from '../../services/grnService';
import { invoiceService } from '../../services/invoiceService';
import { t, getLocale } from '../../i18n';
import { TASK_LABELS } from '../../utils/taskLabels';
import RevisionChanges from './RevisionChanges';
import SearchSelect from '../Common/SearchSelect';
import { supplierService } from '../../services/supplierService';
import { uploadService } from '../../services/uploadService';

// Statuts de bon de commande par étape
const PO_PENDING = ['PO_PENDING', 'DRAFT'];
const PO_TO_CONFIRM = ['PO_SENT', 'PO_APPROVED'];
const PO_ACTIVE = ['PO_APPROVED', 'PO_SENT', 'PO_CONFIRMED', 'PO_RECEIVED', 'PO_COMPLETE', 'APPROVED', 'SENT', 'COMPLETED'];

// Formulaire de la fenêtre de décision par étape BPMN (les autres étapes : commentaire)
const TASK_FORMS = {
  Activity_ValidationN1_Manager: 'approval',
  Activity_ValidationN2_Finance: 'approval',
  Activity_ValidationN3_DG: 'approval',
  Activity_DetermineType: 'method',
  Activity_DirectPurchase: 'directPurchase',
  Activity_AllocateSuppliers: 'allocation', // page dédiée (répartition des articles entre fournisseurs)
  Activity_BudgetAdjustment: 'budget',
};

// Achat direct : pro-forma du fournisseur (PDF / JPG / PNG, 10 Mo comme les autres pièces jointes)
const PROFORMA_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
const PROFORMA_MAX = 10 * 1024 * 1024;
const DIRECT_PURCHASE_ERRORS = ['SUPPLIER_REQUIRED', 'SUPPLIER_NOT_FOUND', 'SUPPLIER_INACTIVE', 'PROFORMA_REQUIRED', 'PROFORMA_NOT_FOUND', 'PROFORMA_TYPE', 'PROFORMA_AMOUNT_INVALID', 'PROFORMA_DATE_INVALID'];

// Méthode d'achat minimale selon le montant (même règle que RequisitionModel.requiredProcurementMethod) ;
// la source unique (justifiée) reste toujours possible
const METHOD_RIGOR = { DIRECT_PURCHASE: 1, MULTIPLE_QUOTATIONS: 2, RFP: 3 };
// Processus démarré avec le BPMN « Corriger la réquisition » (variable posée au démarrage)
const revisionSupported = (task) => task?.variables?.revisionSupported === true || task?.variables?.revisionSupported === 'true';

const methodBelowThreshold = (method, amount) => {
  if (!METHOD_RIGOR[method]) return false;
  const value = parseFloat(amount) || 0;
  const required = value <= 5000 ? 1 : value <= 25000 ? 2 : 3;
  return METHOD_RIGOR[method] < required;
};

export default function RequisitionTasks() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('task'); // tâche ouverte depuis « Mes tâches »
  const highlightRef = useRef(null);
  const [opening, setOpening] = useState(null);
  const { user } = useAuth();
  const userEmail = user?.email;
  const { formatAmount, currency } = useCurrency();
  const [suppliers, setSuppliers] = useState([]); // achat direct : fournisseurs actifs, préqualifiés en tête

  const [tasks, setTasks] = useState([]);
  const [requisition, setRequisition] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState(null);
  const [revisionInfo, setRevisionInfo] = useState(null); // dernière version (corrigée) : changements à montrer à l'approbateur
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [claimingTaskId, setClaimingTaskId] = useState(null);
  const [taskToClaim, setTaskToClaim] = useState(null); // confirmation avant prise en charge
  const [taskToRelease, setTaskToRelease] = useState(null); // confirmation avant libération
  const [releasing, setReleasing] = useState(false);

  // États pour le formulaire
  const [formData, setFormData] = useState({
    approved: '',
    comment: '',
    procurementMethod: '',
    justification: '',
    newBudgetAmount: '',
    adjustmentJustification: '',
    supplierId: '',
    proformaFile: null,
    proformaNumber: '',
    proformaDate: '',
    proformaAmount: ''
  });

  useEffect(() => {
    loadData();
  }, [id]);

  // Tâche ouverte depuis « Mes tâches » : amenée à l'écran une fois la liste chargée
  useEffect(() => {
    if (!loading && highlightRef.current) highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [loading, highlightId, tasks.length]);

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

  const handleUnclaimTask = async (taskId) => {
    setReleasing(true);
    try {
      await taskService.unclaimTask(taskId);
      toast.success(t('taskList.unclaimed'));
      setTaskToRelease(null);
      await loadData();
    } catch (error) {
      toast.error(error.response?.data?.message || t('taskList.unclaimError'));
    } finally {
      setReleasing(false);
    }
  };

  const handleClaimTask = async (taskId) => {
    setClaimingTaskId(taskId);
    try {
      await taskService.claimTask(taskId, userEmail);
      toast.success(t('reqTasks.claimed'));
      setTaskToClaim(null);
      await loadData(); // Recharger les tâches
    } catch (error) {
      console.error('Error claiming task:', error);
      toast.error(error.response?.data?.message || t('taskList.claimError'));
    } finally {
      setClaimingTaskId(null);
    }
  };

  /**
   * Formulaire dédié d'une tâche, avec les documents de CETTE réquisition (lus en base ; les variables BpmnGo ne
   * servent qu'à départager). Renvoie { url } ou { missing: <code> } (document manquant), null = fenêtre générique.
   */
  const resolveTaskTarget = async (task) => {
    const key = task.taskDefinitionKey;
    const q = (to) => `${to}${to.includes('?') ? '&' : '?'}taskId=${encodeURIComponent(task.id)}`;
    // Réquisition répartie : bon de commande de la part de cette tâche (fournisseur et articles imposés)
    if (key === 'Activity_CreatePO') return { url: `/purchase-orders/${id}/${task.id}${task.lot ? `?supplierLotId=${task.lot.id}` : ''}` };
    if (key === 'Activity_AllocateSuppliers') return { url: q(`/requisitions/${id}/allocation`) };
    if (key === 'Activity_RFPProcess') return { url: `/tenders/new?taskId=${encodeURIComponent(task.id)}&requisitionId=${id}` };
    if (key === 'Activity_BudgetAdjustment') return { url: `/requisitions/${id}` };
    // Correction demandée par l'approbateur (ou retrait) : formulaire de modification, puis nouvelle soumission
    if (key === 'Activity_ReviseRequisition') return { url: `/requisitions/${id}/edit` };
    const DOC_TASKS = ['Activity_POApproval', 'Activity_SupplierConfirmation', 'Activity_GoodsReceipt',
      'Activity_ServiceAcceptance', 'Activity_EnterInvoice', 'Activity_ProcessPayment'];
    if (!DOC_TASKS.includes(key)) return null;

    const vars = (await requisitionService.getProcessVariables(requisition.process_instance_id).catch(() => null))?.data || {};
    const pos = (await purchaseOrderService.getAll({ requisitionId: id }).catch(() => null))?.data || [];
    const poFor = (statuses) => {
      // Réquisition répartie : le bon de commande de la part de la tâche (fourni par le serveur)
      if (task.lot?.poId) return pos.find(p => String(p.id) === String(task.lot.poId) && statuses.includes(p.status)) || null;
      const fromVars = pos.find(p => String(p.id) === String(vars.poId) && statuses.includes(p.status));
      return fromVars || pos.find(p => statuses.includes(p.status)) || null;
    };

    if (key === 'Activity_POApproval') {
      const po = poFor(PO_PENDING);
      return po ? { url: q(`/purchase-orders/${po.id}`) } : { missing: 'poPending' };
    }
    if (key === 'Activity_SupplierConfirmation') {
      const po = poFor(PO_TO_CONFIRM);
      return po ? { url: q(`/purchase-orders/${po.id}?confirm=1`) } : { missing: 'poToConfirm' };
    }
    const po = poFor(PO_ACTIVE);
    if (!po) return { missing: 'poActive' };
    if (key === 'Activity_GoodsReceipt') return { url: q(`/goods-receipts/new?poId=${po.id}`) };
    if (key === 'Activity_ServiceAcceptance') return { url: q(`/service-acceptance-notes/new?poId=${po.id}`) };
    if (key === 'Activity_EnterInvoice') {
      const grns = ((await grnService.getByPO(po.id).catch(() => null))?.data || []).filter(g => g.status !== 'CANCELLED');
      const grn = grns.find(g => String(g.id) === String(vars.grnId)) || grns.sort((a, b) => b.id - a.id)[0];
      return { url: q(`/invoices/new?poId=${po.id}${grn ? `&grnId=${grn.id}` : ''}`) };
    }
    // Activity_ProcessPayment : facture non payée de cette réquisition (de la part de la tâche si elle est répartie)
    const invoices = [];
    for (const p of pos.filter(x => PO_ACTIVE.includes(x.status) && (!task.lot?.poId || String(x.id) === String(task.lot.poId)))) {
      invoices.push(...(((await invoiceService.getAll({ poId: p.id }).catch(() => null))?.data) || []));
    }
    const payable = invoices.filter(i => !['PAID', 'REJECTED', 'CANCELLED'].includes(i.status));
    const invoice = payable.find(i => String(i.id) === String(vars.invoiceId)) || payable.sort((a, b) => b.id - a.id)[0];
    return invoice ? { url: q(`/payments/new?invoiceId=${invoice.id}`) } : { missing: 'invoice' };
  };

  const handleCompleteTask = async (task) => {
    setOpening(task.id);
    let target;
    try { target = await resolveTaskTarget(task); } finally { setOpening(null); }
    if (target?.url) { navigate(target.url); return; }
    if (target?.missing) { toast.error(t(`reqTasks.missing.${target.missing}`), { duration: 7000 }); return; }
    // Autres tâches (approbations, méthode d'achat…) : fenêtre de décision
    setSelectedTask(task);
    // Réquisition corrigée (version ≥ 2) : l'approbateur voit ce qui a changé depuis la version précédente
    setRevisionInfo(null);
    if (TASK_FORMS[task.taskDefinitionKey] === 'approval' && (requisition?.version || 1) > 1) {
      requisitionService.getVersions(id).then(r => setRevisionInfo(r.data?.versions?.[0] || null)).catch(() => setRevisionInfo(null));
    }
    setFormData({
      approved: '',
      comment: '',
      procurementMethod: '',
      justification: '',
      multiSupplier: false,
      newBudgetAmount: '',
      adjustmentJustification: ''
    });
    if (TASK_FORMS[task.taskDefinitionKey] === 'directPurchase') {
      supplierService.getForPurchaseOrder(id)
        .then(r => setSuppliers(r.data || r || []))
        .catch(() => toast.error(t('po.loadSuppliersError')));
    }
    setShowTaskModal(true);
  };

  const handleSubmitTask = async () => {
    // Méthode d'achat : la classification suivante reprend ce choix (contrôlé aussi par le serveur)
    if (isMethodTask(selectedTask)) {
      if (!formData.procurementMethod) { toast.error(t('reqTasks.methodRequired')); return; }
      if (formData.procurementMethod === 'SOLE_SOURCE' && !formData.justification.trim()) {
        toast.error(t('reqTasks.soleJustificationRequired'));
        return;
      }
    }
    // Approbation : décision obligatoire ; renvoi pour correction = motif obligatoire (ce qui doit être corrigé)
    if (taskForm(selectedTask) === 'approval') {
      if (!formData.approved) { toast.error(t('revision.decisionRequired')); return; }
      if (formData.approved === 'return' && !formData.comment.trim()) { toast.error(t('revision.returnReasonRequired')); return; }
    }
    // Achat direct : fournisseur retenu + pro-forma obligatoires (contrôlés aussi par le serveur)
    if (taskForm(selectedTask) === 'directPurchase') {
      if (!formData.supplierId) { toast.error(t('reqTasks.direct.err.SUPPLIER_REQUIRED')); return; }
      if (!formData.proformaFile) { toast.error(t('reqTasks.direct.err.PROFORMA_REQUIRED')); return; }
    }
    setSubmitting(true);
    let proformaId = null; // pro-forma déposée pour cette tentative : retirée si l'étape est refusée
    try {
      const variables = {};
      if (taskForm(selectedTask) === 'directPurchase') {
        const uploaded = await uploadService.uploadFile(formData.proformaFile, 'requisition', id);
        proformaId = uploaded.data?.id;
        Object.assign(variables, {
          supplierId: Number(formData.supplierId),
          proformaAttachmentId: proformaId,
          proformaNumber: formData.proformaNumber.trim(),
          proformaDate: formData.proformaDate,
          proformaAmount: formData.proformaAmount === '' ? '' : Number(formData.proformaAmount),
          currency: currency?.code,
        });
      }

      if (formData.approved === 'return') {
        variables.approved = false;
        variables.returnedForCorrection = true;
      } else if (formData.approved !== '') variables.approved = formData.approved === 'true';
      if (formData.comment) variables.comment = formData.comment;
      if (formData.procurementMethod) variables.procurementMethod = formData.procurementMethod;
      if (formData.justification) variables.justification = formData.justification;
      if (isMethodTask(selectedTask)) variables.multiSupplier = !!formData.multiSupplier && formData.procurementMethod !== 'RFP';
      if (formData.newBudgetAmount) variables.newBudgetAmount = parseFloat(formData.newBudgetAmount);
      if (formData.adjustmentJustification) variables.adjustmentJustification = formData.adjustmentJustification;

      await taskService.completeTask(selectedTask.id, variables);
      toast.success(formData.approved === 'return' ? t('revision.returnedToast') : t('taskList.completed'));
      setShowTaskModal(false);
      setSelectedTask(null);
      loadData();
    } catch (error) {
      console.error('Error completing task:', error);
      if (proformaId) uploadService.deleteFile(proformaId).catch(() => {});
      const code = error.response?.data?.code;
      if (code && DIRECT_PURCHASE_ERRORS.includes(code)) { toast.error(t(`reqTasks.direct.err.${code}`)); return; }
      toast.error(code && ['METHOD_BELOW_THRESHOLD', 'PROCUREMENT_METHOD_REQUIRED', 'JUSTIFICATION_REQUIRED', 'SPLIT_NOT_AVAILABLE_FOR_RFP', 'SPLIT_NEEDS_TWO_ITEMS'].includes(code)
        ? t(`reqTasks.err.${code}`)
        : code && ['RETURN_REASON_REQUIRED', 'DECISION_REQUIRED', 'RETURN_NOT_SUPPORTED'].includes(code)
          ? t(`revision.err.${code}`)
          : (error.response?.data?.message || t('reqTasks.completeError')));
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
  // Formulaire de la fenêtre de décision : d'après la clé BPMN (le nom dépend du BPMN déployé, FR ou EN —
  // avec le BPMN français, « Déterminer la méthode d'achat » n'affichait pas le choix de la méthode)
  const taskForm = (task) => {
    const key = task?.taskDefinitionKey;
    if (TASK_FORMS[key]) return TASK_FORMS[key];
    const name = getTaskName(task);
    if (/Validation|Hierarchical|Approval|Approbation/.test(name)) return 'approval';
    if (/Determine|Procurement/.test(name)) return 'method';
    if (/Budget Adjustment|Ajustement budg/.test(name)) return 'budget';
    return 'comment';
  };
  const isMethodTask = (task) => taskForm(task) === 'method';
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
                <div
                  key={task.id}
                  ref={task.id === highlightId ? highlightRef : undefined}
                  className={`p-6 hover:bg-gray-50 transition-colors ${getTaskColor(task.name)} ${task.id === highlightId ? 'ring-2 ring-inset ring-blue-500 bg-blue-50/40' : ''}`}
                  data-testid={task.id === highlightId ? 'task-highlighted' : undefined}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex gap-3 flex-1">
                      {getTaskIcon(getTaskName(task))}
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-800">{displayName(task)}</h3>
                        {task.lot && (
                          <p className="text-sm text-indigo-700 mt-0.5" data-testid="task-lot">
                            {t('split.lotLabel', { number: task.lot.number, supplier: task.lot.supplierName })}
                            {task.lot.poNumber ? ` — ${task.lot.poNumber}` : ''}
                          </p>
                        )}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 mt-2 text-sm">
                          <div className="text-gray-500">{t('reqTasks.requisitionLabel')}</div>
                          <div className="font-medium text-blue-600">{task.variables?.requisitionNumber || requisition?.requisition_number || '-'}</div>

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
                          {task.blockedReason === 'SELF_APPROVAL' && (
                            <span className="inline-flex items-center gap-1 text-amber-700 ml-3">
                              <AlertCircle size={14} />
                              {t('taskList.selfApproval')}
                            </span>
                          )}
                          {/* Profil détenu, mais pas sur le projet de la réquisition (profils BPMN liés au projet) */}
                          {task.blockedReason === 'NOT_ON_PROJECT' && (
                            <span className="inline-flex items-center gap-1 text-amber-700 ml-3" data-testid="task-not-on-project">
                              <AlertCircle size={14} />
                              {t('taskList.notOnProject')}
                            </span>
                          )}
                          {isUnassigned && !canClaim && !task.blockedReason && task.candidateGroup && (
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
                          onClick={() => setTaskToClaim(task)}
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
                      {task.canUnclaim && (
                        <button
                          onClick={() => setTaskToRelease(task)}
                          disabled={releasing}
                          title={t('taskList.unclaimHint')}
                          className="px-4 py-2 border border-amber-300 text-amber-700 bg-white rounded-lg hover:bg-amber-50 flex items-center gap-2 disabled:opacity-50"
                        >
                          <UserMinus size={16} />
                          {t('taskList.unclaim')}
                        </button>
                      )}
                      {canProcess && (
                        <button
                          onClick={() => handleCompleteTask(task)}
                          disabled={opening === task.id}
                          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2 disabled:opacity-60"
                          data-testid="task-process"
                        >
                          {opening === task.id
                            ? <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                            : <Send size={16} />}
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
                  <div className="font-medium text-blue-700">{selectedTask.variables?.requisitionNumber || requisition?.requisition_number || '-'}</div>
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


            {/* Réquisition corrigée : changements depuis la version précédente */}
            {taskForm(selectedTask) === 'approval' && revisionInfo?.changes && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4" data-testid="approval-revision-changes">
                <h4 className="font-medium text-amber-900 mb-1">{t('revision.approverTitle', { version: revisionInfo.version })}</h4>
                {revisionInfo.comment && <p className="text-sm text-amber-800 mb-2">{t('revision.submitComment', { value: revisionInfo.comment })}</p>}
                <RevisionChanges changes={revisionInfo.changes} currency={revisionInfo.currency} />
              </div>
            )}

            {/* Formulaire Validation */}
            {taskForm(selectedTask) === 'approval' && (
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
                      {/* Renvoyer pour correction : le demandeur corrige puis soumet à nouveau (nouveau circuit) — seulement
                          pour les processus démarrés avec le BPMN qui connaît « Corriger la réquisition » */}
                      {revisionSupported(selectedTask) && (
                      <label className="flex items-center gap-2 cursor-pointer p-3 border rounded-lg flex-1 hover:bg-amber-50 transition-colors">
                        <input
                          type="radio"
                          name="approved"
                          value="return"
                          data-testid="decision-return"
                          checked={formData.approved === 'return'}
                          onChange={(e) => handleInputChange('approved', e.target.value)}
                          className="w-4 h-4 text-amber-600"
                        />
                        <span className="text-amber-700">{t('revision.returnDecision')}</span>
                      </label>
                      )}
                    </div>
                    {!revisionSupported(selectedTask) && (
                      <p className="mt-2 text-xs text-gray-500">{t('revision.returnNotSupported')}</p>
                    )}
                    {formData.approved === 'return' && (
                      <p className="mt-2 text-xs text-amber-700">{t('revision.returnDecisionHint')}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {formData.approved === 'return' ? t('revision.returnReasonLabel') : t('common.comment')}
                    </label>
                    <textarea
                      value={formData.comment}
                      onChange={(e) => handleInputChange('comment', e.target.value)}
                      rows="4"
                      data-testid="approval-comment"
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder={formData.approved === 'return' ? t('revision.returnReasonPlaceholder') : t('taskList.commentPlaceholder')}
                    />
                  </div>
                </>
              )}

            {/* Formulaire Détermination méthode d'achat */}
            {isMethodTask(selectedTask) && (
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
                      ].map(option => {
                        const notAllowed = methodBelowThreshold(option.value, requisition?.estimated_amount ?? selectedTask.variables?.estimatedAmount);
                        return (
                          <label key={option.value} className={`flex items-start gap-3 p-3 border rounded-lg transition-colors ${notAllowed ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}>
                            <input
                              type="radio"
                              name="procurementMethod"
                              value={option.value}
                              disabled={notAllowed}
                              checked={formData.procurementMethod === option.value}
                              onChange={(e) => handleInputChange('procurementMethod', e.target.value)}
                              className="w-4 h-4 text-blue-600 mt-0.5"
                            />
                            <div>
                              <span className="font-medium">{option.label}</span>
                              <p className="text-xs text-gray-500">{option.desc}</p>
                              {notAllowed && <p className="text-xs text-orange-600">{t('reqTasks.methodBelowThreshold')}</p>}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  {/* Répartition entre plusieurs fournisseurs : même méthode (calculée sur le total), une commande par fournisseur */}
                  <label className={`flex items-start gap-3 p-3 border rounded-lg ${formData.procurementMethod === 'RFP' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}>
                    <input
                      type="checkbox"
                      data-testid="method-multi-supplier"
                      disabled={formData.procurementMethod === 'RFP'}
                      checked={!!formData.multiSupplier && formData.procurementMethod !== 'RFP'}
                      onChange={(e) => handleInputChange('multiSupplier', e.target.checked)}
                      className="w-4 h-4 text-blue-600 mt-0.5"
                    />
                    <div>
                      <span className="font-medium">{t('split.methodOption')}</span>
                      <p className="text-xs text-gray-500">
                        {formData.procurementMethod === 'RFP' ? t('split.notForRfp') : t('split.methodOptionHelp')}
                      </p>
                    </div>
                  </label>
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

            {/* Formulaire Achat direct : fournisseur retenu + pro-forma */}
            {taskForm(selectedTask) === 'directPurchase' && (
              <>
                <p className="text-sm text-gray-600">{t('reqTasks.direct.intro')}</p>
                <div>
                  <label htmlFor="dp-supplier" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('reqTasks.direct.supplier')} <span className="text-red-500">*</span>
                  </label>
                  <SearchSelect
                    id="dp-supplier"
                    data-testid="direct-purchase-supplier"
                    value={formData.supplierId}
                    onChange={(e) => handleInputChange('supplierId', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">{t('reqTasks.direct.chooseSupplier')}</option>
                    {suppliers.some(s => s.is_prequalified) && (
                      <optgroup label={t('reqTasks.direct.prequalified')}>
                        {suppliers.filter(s => s.is_prequalified).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </optgroup>
                    )}
                    {suppliers.some(s => !s.is_prequalified) && (
                      <optgroup label={t('reqTasks.direct.notPrequalifiedGroup')}>
                        {suppliers.filter(s => !s.is_prequalified).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </optgroup>
                    )}
                  </SearchSelect>
                  {formData.supplierId && !suppliers.find(s => String(s.id) === String(formData.supplierId))?.is_prequalified && (
                    <p className="text-xs text-orange-600 mt-1">{t('reqTasks.direct.notPrequalified')}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="dp-proforma" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('reqTasks.direct.proforma')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="dp-proforma"
                    data-testid="direct-purchase-proforma"
                    type="file"
                    accept={PROFORMA_ACCEPT}
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      if (file && file.size > PROFORMA_MAX) { toast.error(t('reqTasks.direct.tooLarge')); e.target.value = ''; return; }
                      handleInputChange('proformaFile', file);
                    }}
                    className="w-full text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-1">{t('reqTasks.direct.proformaHint')}</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="dp-number" className="block text-sm font-medium text-gray-700 mb-1">{t('reqTasks.direct.number')}</label>
                    <input id="dp-number" type="text" maxLength={100} value={formData.proformaNumber}
                      onChange={(e) => handleInputChange('proformaNumber', e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label htmlFor="dp-date" className="block text-sm font-medium text-gray-700 mb-1">{t('reqTasks.direct.date')}</label>
                    <input id="dp-date" type="date" value={formData.proformaDate}
                      onChange={(e) => handleInputChange('proformaDate', e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label htmlFor="dp-amount" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('reqTasks.direct.amount', { currency: currency?.code || '' })}
                    </label>
                    <input id="dp-amount" type="number" min="0" step="0.01" value={formData.proformaAmount}
                      onChange={(e) => handleInputChange('proformaAmount', e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.comment')}</label>
                  <textarea
                    value={formData.comment}
                    onChange={(e) => handleInputChange('comment', e.target.value)}
                    rows="2"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder={t('taskList.commentPlaceholder')}
                  />
                </div>
              </>
            )}

            {/* Formulaire Ajustement budgétaire */}
            {taskForm(selectedTask) === 'budget' && (
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
            {taskForm(selectedTask) === 'comment' && (
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

      <ClaimTaskConfirm
        task={taskToClaim}
        onCancel={() => !claimingTaskId && setTaskToClaim(null)}
        onConfirm={() => handleClaimTask(taskToClaim.id)}
        isLoading={!!claimingTaskId}
      />

      <ClaimTaskConfirm
        mode="unclaim"
        task={taskToRelease}
        currentUserEmail={userEmail}
        onCancel={() => !releasing && setTaskToRelease(null)}
        onConfirm={() => handleUnclaimTask(taskToRelease.id)}
        isLoading={releasing}
      />
    </div>
  );
}