// src/components/Requisitions/ProcurementAgentPanel.jsx
// Agent achats désigné par le chef de projet à la validation (migration 58) : les étapes achats de la réquisition lui
// sont réservées. Le chef de projet (ou son intérimaire) et l'administrateur peuvent le remplacer tant que la
// réquisition est en cours. Rien n'est affiché tant qu'aucun agent n'est désigné.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShoppingBag, AlertTriangle, UserCog } from 'lucide-react';
import toast from 'react-hot-toast';
import requisitionService from '../../services/requisitionService';
import Modal from '../Common/Modal';
import SearchSelect from '../Common/SearchSelect';
import UserAvatar from '../Common/UserAvatar';
import { t, getLocale } from '../../i18n';

const ERRORS = ['PROCUREMENT_AGENT_REQUIRED', 'PROCUREMENT_AGENT_INVALID', 'PROCUREMENT_AGENT_LOCKED', 'NOT_ALLOWED'];
const fullName = (u) => `${u?.first_name || ''} ${u?.last_name || ''}`.trim() || u?.email || '';

export default function ProcurementAgentPanel({ requisitionId, onChanged }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState('');
  const [saving, setSaving] = useState(false);
  const { data } = useQuery({
    queryKey: ['requisition-procurement-agent', requisitionId],
    queryFn: () => requisitionService.getProcurementAgent(requisitionId),
    enabled: !!requisitionId,
  });
  const state = data?.data;
  if (!state?.agent) return null;
  const { agent, assignedBy, assignedAt, canChange, eligible, candidates = [] } = state;

  const save = async () => {
    if (!agentId) { toast.error(t('procurementAgent.required')); return; }
    setSaving(true);
    try {
      await requisitionService.changeProcurementAgent(requisitionId, agentId);
      toast.success(t('procurementAgent.changed'));
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ['requisition-procurement-agent', requisitionId] });
      onChanged?.();
    } catch (error) {
      const code = error.response?.data?.code;
      toast.error(ERRORS.includes(code) ? t(`procurementAgent.err.${code}`) : (error.response?.data?.message || t('common.error')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-4" data-testid="procurement-agent-panel">
      <div className="flex flex-wrap items-center gap-3">
        <ShoppingBag size={20} className="text-indigo-600" />
        <h2 className="text-lg font-semibold">{t('procurementAgent.panelTitle')}</h2>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <UserAvatar userId={agent.id} version={agent.avatar_updated_at} firstName={agent.first_name} lastName={agent.last_name} size={28} />
          <div className="min-w-0">
            <p className="font-medium text-gray-800 truncate" data-testid="procurement-agent-name">{fullName(agent)}</p>
            {assignedBy && assignedAt && (
              <p className="text-xs text-gray-500">
                {t('procurementAgent.assignedBy', { name: fullName(assignedBy), date: new Date(assignedAt).toLocaleDateString(getLocale()) })}
              </p>
            )}
          </div>
        </div>
        {canChange && (
          <button
            type="button"
            onClick={() => { setAgentId(''); setOpen(true); }}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-1"
            data-testid="procurement-agent-change"
          >
            <UserCog size={16} /> {t('procurementAgent.change')}
          </button>
        )}
      </div>
      {!eligible && (
        <p className="mt-3 text-sm text-amber-800 bg-amber-50 rounded-lg p-2 flex items-center gap-2" data-testid="procurement-agent-not-eligible">
          <AlertTriangle size={16} /> {t('procurementAgent.notEligible')}
        </p>
      )}

      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={t('procurementAgent.changeTitle')}
        confirmText={t('procurementAgent.save')}
        onConfirm={save}
        isLoading={saving}
      >
        <div className="space-y-3">
          <SearchSelect
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="w-full"
            data-testid="procurement-agent-select"
          >
            <option value="">{t('procurementAgent.choosePlaceholder')}</option>
            {candidates.filter(c => String(c.id) !== String(agent.id)).map(c => (
              <option key={c.id} value={c.id} data-search={c.email}>
                {fullName(c)}{c.position ? ` — ${c.position}` : ''}
              </option>
            ))}
          </SearchSelect>
          <p className="text-xs text-gray-500">{t('procurementAgent.changeHint')}</p>
        </div>
      </Modal>
    </div>
  );
}
