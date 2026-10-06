// src/components/Task/ClaimTaskConfirm.jsx
// Confirmation avant de prendre en charge une tâche GoFlow (évite une prise en charge par erreur :
// la tâche est alors assignée à l'utilisateur et retirée des autres membres de son groupe)
// ou avant de la libérer (mode="unclaim" : elle redevient disponible pour le groupe).
import React from 'react';
import { UserCheck, UserMinus } from 'lucide-react';
import Modal from '../Common/Modal';
import { getTaskLabel } from '../../utils/taskLabels';
import { t } from '../../i18n';

export default function ClaimTaskConfirm({ task, mode = 'claim', onCancel, onConfirm, isLoading = false, currentUserEmail }) {
  const vars = task?.variables || {};
  const release = mode === 'unclaim';
  const Icon = release ? UserMinus : UserCheck;
  // Libération par un admin de la tâche d'un collègue : on rappelle qui l'avait prise
  const otherAssignee = release && task?.assignee && task.assignee !== currentUserEmail ? task.assignee : null;
  return (
    <Modal
      isOpen={!!task}
      onClose={onCancel}
      title={t(release ? 'taskList.unclaimConfirmTitle' : 'taskList.claimConfirmTitle')}
      type={release ? 'warning' : 'info'}
      size="sm"
      confirmText={t(release ? 'taskList.unclaim' : 'taskList.claim')}
      cancelText={t('common.cancel')}
      onConfirm={onConfirm}
      isLoading={isLoading}
      loadingText={t(release ? 'taskList.releasing' : 'reqTasks.claiming')}
    >
      {task && (
        <div className="space-y-3 text-sm text-gray-700">
          <div className={`flex items-start gap-3 rounded-lg p-3 ${release ? 'bg-amber-50' : 'bg-blue-50'}`}>
            <Icon size={18} className={`mt-0.5 shrink-0 ${release ? 'text-amber-600' : 'text-blue-600'}`} />
            <div>
              <div className="font-semibold text-gray-900">{getTaskLabel(task)}</div>
              {(vars.requisitionNumber || vars.title) && (
                <div className="text-gray-600">
                  {vars.requisitionNumber}{vars.requisitionNumber && vars.title ? ' — ' : ''}{vars.title}
                </div>
              )}
            </div>
          </div>
          {otherAssignee && <p className="font-medium">{t('taskList.unclaimOtherAssignee', { assignee: otherAssignee })}</p>}
          <p>{t(!release ? 'taskList.claimConfirmText' : otherAssignee ? 'taskList.unclaimConfirmTextOther' : 'taskList.unclaimConfirmText')}</p>
        </div>
      )}
    </Modal>
  );
}
