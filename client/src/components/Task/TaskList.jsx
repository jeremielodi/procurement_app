// src/components/Task/TaskList.jsx
// « Mes tâches » : vue d'ensemble des tâches GoFlow de mes groupes (en attente / terminées).
// Une tâche se prend en charge et se traite UNIQUEMENT depuis l'onglet tâches de sa réquisition
// (/requisitions/:id/tasks) : c'est là que la commande, la réception, la facture ou le paiement sont rattachés à la
// bonne réquisition et au bon bon de commande. Ici, chaque tâche renvoie vers cet onglet (?task= la met en évidence).
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle, AlertCircle, Package, RefreshCw, DollarSign, User, UserCheck, Clock, ShieldAlert, ArrowRight, Info,
} from 'lucide-react';
import { taskService } from '../../services/taskService';
import { useAuth } from '../../hooks/useAuth';
import { getTaskLabel } from '../../utils/taskLabels';
import LoadingSpinner from '../Common/LoadingSpinner';
import { useCurrency } from '../../contexts/EnterpriseContext';
import { t, getLocale } from '../../i18n';

/** Lien vers l'onglet tâches de la réquisition, tâche mise en évidence */
export const requisitionTasksLink = (task) =>
  task.requisitionId ? `/requisitions/${task.requisitionId}/tasks?task=${encodeURIComponent(task.id)}` : null;

const getTaskIcon = (task) => {
  const key = task?.taskDefinitionKey || '';
  if (key.includes('Validation') || key.includes('Approval')) return <CheckCircle size={20} className="text-blue-500" />;
  if (key.includes('Budget')) return <DollarSign size={20} className="text-yellow-500" />;
  if (key.includes('PO') || key.includes('Purchase')) return <Package size={20} className="text-green-500" />;
  return <User size={20} className="text-purple-500" />;
};

const getTaskColor = (task) => {
  const key = task?.taskDefinitionKey || '';
  if (key.includes('Validation') || key.includes('Approval')) return 'border-blue-200 bg-blue-50';
  if (key.includes('Budget')) return 'border-yellow-200 bg-yellow-50';
  if (key.includes('PO') || key.includes('Purchase')) return 'border-green-200 bg-green-50';
  return 'border-gray-200 bg-gray-50';
};

/** État de prise en charge d'une tâche en attente */
function ClaimState({ task, userEmail }) {
  if (task.blockedReason === 'SELF_APPROVAL') {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800 ring-1 ring-amber-200" data-testid="task-self-approval">
        <ShieldAlert size={14} /> {t('taskList.selfApproval')}
      </span>
    );
  }
  if (task.assignee && (task.isMine || task.assignee === userEmail)) {
    return <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs text-green-800"><UserCheck size={13} /> {t('taskList.claimedByMe')}</span>;
  }
  if (task.assignee) {
    return <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700"><User size={13} /> {t('taskList.assignedTo', { user: task.assignee })}</span>;
  }
  return <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-1 text-xs text-yellow-800"><Clock size={13} /> {t('taskList.toClaim')}</span>;
}

const TaskList = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currency } = useCurrency();
  const userEmail = user?.email;
  const [filter, setFilter] = useState('pending'); // 'all', 'pending', 'completed'

  const { data: tasksData, isLoading, refetch } = useQuery({
    queryKey: ['user-tasks', userEmail, filter],
    queryFn: () => taskService.getUserTasks(userEmail),
    enabled: !!userEmail
  });

  const tasks = tasksData?.data || [];
  const filteredTasks = tasks.filter(task => {
    const isCompleted = task.state === 'completed';
    if (filter === 'pending') return !isCompleted;
    if (filter === 'completed') return isCompleted;
    return true;
  });
  const pendingCount = tasks.filter(tk => tk.state !== 'completed').length;
  const completedCount = tasks.filter(tk => tk.state === 'completed').length;

  const openInRequisition = (task) => {
    const link = requisitionTasksLink(task);
    if (link) navigate(link);
  };

  if (!userEmail) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded-lg">
        <AlertCircle className="mx-auto h-12 w-12 text-yellow-500 mb-3" />
        <p className="text-gray-500">{t('taskList.loginRequired')}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-12">
        <LoadingSpinner text={t('taskList.loading')} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-gray-800">{t('nav.myTasks')}</h2>
          <p className="text-sm text-gray-500 mt-1">{t('taskList.subtitle')}</p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50"
        >
          <RefreshCw size={16} />
          {t('common.refresh')}
        </button>
      </div>

      {/* Où traiter une tâche */}
      <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900" data-testid="task-where-hint">
        <Info size={16} className="mt-0.5 shrink-0" />
        <span>{t('taskList.processInRequisition')}</span>
      </div>

      {/* Filtres */}
      <div className="flex gap-2 border-b pb-2">
        {[
          ['pending', t('taskList.pending', { count: pendingCount }), 'bg-yellow-600'],
          ['completed', t('taskList.completedTab', { count: completedCount }), 'bg-green-600'],
          ['all', t('taskList.allTab', { count: tasks.length }), 'bg-blue-600'],
        ].map(([key, label, active]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1 text-sm rounded-full transition-colors ${filter === key ? `${active} text-white` : 'text-gray-600 hover:bg-gray-100'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Liste des tâches */}
      {filteredTasks.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <CheckCircle className="mx-auto h-12 w-12 text-green-500 mb-3" />
          <p className="text-gray-500">
            {filter === 'pending' ? t('taskList.noPending') : filter === 'completed' ? t('taskList.noCompleted') : t('taskList.noTask')}
          </p>
          <p className="text-sm text-gray-400 mt-1">{t('taskList.emptyHint')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredTasks.map(task => {
            const variables = task.variables || {};
            const isCompleted = task.state === 'completed';
            const link = requisitionTasksLink(task);
            const amount = variables.estimatedAmount;

            return (
              <div
                key={task.id}
                className={`bg-white rounded-lg shadow border-l-4 ${getTaskColor(task)} p-4 transition-shadow ${link ? 'cursor-pointer hover:shadow-md' : ''}`}
                onClick={() => link && openInRequisition(task)}
                data-testid="task-card"
              >
                <div className="flex flex-wrap justify-between items-start gap-4">
                  <div className="flex-1 min-w-[16rem]">
                    <div className="flex items-center gap-2 mb-2">
                      {getTaskIcon(task)}
                      <h3 className="font-semibold text-gray-800">{getTaskLabel(task)}</h3>
                      {isCompleted && (
                        <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full">{t('taskList.done')}</span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <div className="text-gray-500">{t('taskList.requisition')}</div>
                      <div className="font-medium text-blue-600">{task.requisitionNumber || variables.requisitionNumber || '-'}</div>

                      <div className="text-gray-500">{t('taskList.title')}</div>
                      <div className="font-medium truncate">{task.requisitionTitle || variables.title || '-'}</div>

                      <div className="text-gray-500">{t('taskList.amount')}</div>
                      <div className="font-medium">{amount != null ? `${Number(amount).toLocaleString(getLocale())} ${variables.currency || currency.code}` : '-'}</div>

                      <div className="text-gray-500">{t('taskList.project')}</div>
                      <div className="font-medium">{variables.projectName || variables.projectCode || '-'}</div>
                    </div>

                    <p className="text-xs text-gray-400 mt-2">
                      {variables.createdAt ? t('taskList.createdOn', { date: new Date(variables.createdAt).toLocaleString(getLocale()) }) : t('taskList.unknownDate')}
                    </p>
                    {isCompleted && task.completedAt && (
                      <p className="text-xs text-gray-400 mt-1">
                        {t('taskList.completedOn', { date: new Date(task.completedAt).toLocaleString(getLocale()) })}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    {!isCompleted && <ClaimState task={task} userEmail={userEmail} />}
                    {link ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); openInRequisition(task); }}
                        className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors ${isCompleted
                          ? 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                          : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                        data-testid="task-open-requisition"
                      >
                        {isCompleted ? t('taskList.viewInRequisition') : t('taskList.openInRequisition')}
                        <ArrowRight size={16} />
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">{t('taskList.noRequisition')}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TaskList;
