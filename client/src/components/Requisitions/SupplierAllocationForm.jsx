// src/components/Requisitions/SupplierAllocationForm.jsx
// Étape BpmnGo « Répartition par fournisseur » (Activity_AllocateSuppliers) : les achats attribuent chaque article
// de la réquisition à un fournisseur. Une part par fournisseur, chaque article dans une seule part, tous les articles
// répartis, au moins deux fournisseurs. Achat direct : pro-forma obligatoire par fournisseur ; source unique :
// justification obligatoire. Chaque part suit ensuite son propre cycle (bon de commande → paiement).
// Ouverte uniquement depuis l'onglet tâches de la réquisition (?taskId=).
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Split, Info, Paperclip } from 'lucide-react';
import toast from 'react-hot-toast';
import requisitionService from '../../services/requisitionService';
import { supplierService } from '../../services/supplierService';
import { uploadService } from '../../services/uploadService';
import { taskService } from '../../services/taskService';
import { useCurrency } from '../../contexts/EnterpriseContext';
import SearchSelect from '../Common/SearchSelect';
import LoadingSpinner from '../Common/LoadingSpinner';
import WorkflowOnlyPage from '../Common/WorkflowOnlyPage';
import { t, getLocale } from '../../i18n';

const PROFORMA_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
const PROFORMA_MAX = 10 * 1024 * 1024;
const ERRORS = ['ALLOCATION_REQUIRED', 'SUPPLIER_REQUIRED', 'SUPPLIER_TWICE', 'SUPPLIER_NOT_FOUND', 'SUPPLIER_INACTIVE',
  'LOT_EMPTY', 'ITEM_NOT_FOUND', 'ITEM_ALLOCATED_TWICE', 'ITEM_NOT_ALLOCATED', 'SPLIT_MIN_SUPPLIERS', 'PROFORMA_REQUIRED',
  'PROFORMA_NOT_FOUND', 'PROFORMA_TYPE', 'PROFORMA_AMOUNT_INVALID', 'JUSTIFICATION_REQUIRED', 'ALLOCATION_LOCKED'];

export default function SupplierAllocationForm() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const taskId = searchParams.get('taskId');
  const navigate = useNavigate();
  const { formatAmount, currency } = useCurrency();

  const [loading, setLoading] = useState(true);
  const [requisition, setRequisition] = useState(null);
  const [method, setMethod] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [assignments, setAssignments] = useState({}); // id d'article → id de fournisseur
  const [lotInfo, setLotInfo] = useState({});         // id de fournisseur → { file, amount, justification }
  const [selected, setSelected] = useState([]);       // articles cochés (attribution groupée)
  const [bulkSupplier, setBulkSupplier] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!taskId) return;
    (async () => {
      try {
        const [reqRes, supRes] = await Promise.all([
          requisitionService.getById(id),
          supplierService.getForPurchaseOrder(id),
        ]);
        const req = reqRes.data || reqRes;
        setRequisition(req);
        setSuppliers(supRes.data || supRes || []);
        // Méthode choisie à l'étape précédente (variable BpmnGo, sinon statut CLASSIFIED_*)
        const vars = req.process_instance_id
          ? (await requisitionService.getProcessVariables(req.process_instance_id).catch(() => null))?.data || {}
          : {};
        setMethod(vars.procurementMethod || (String(req.status || '').startsWith('CLASSIFIED_') ? req.status.slice(11) : null));
      } catch {
        toast.error(t('split.loadError'));
      } finally {
        setLoading(false);
      }
    })();
  }, [id, taskId]);

  const items = requisition?.items || [];
  const supplierName = (sid) => suppliers.find(s => String(s.id) === String(sid))?.name || '—';

  // Parts dans l'ordre d'apparition des fournisseurs
  const lots = useMemo(() => {
    const order = [];
    for (const item of items) {
      const sid = assignments[item.id];
      if (sid && !order.includes(String(sid))) order.push(String(sid));
    }
    return order.map(sid => {
      const own = items.filter(i => String(assignments[i.id]) === sid);
      return { supplierId: sid, items: own, total: own.reduce((sum, i) => sum + (parseFloat(i.total_amount) || 0), 0) };
    });
  }, [items, assignments]);

  const unassigned = items.filter(i => !assignments[i.id]);
  const proformaRequired = method === 'DIRECT_PURCHASE';
  const justificationRequired = method === 'SOLE_SOURCE';

  if (!taskId) return <WorkflowOnlyPage title={t('split.title')} icon={Split} doc="allocation" />;
  if (loading) return <LoadingSpinner text={t('split.loading')} />;

  const assign = (itemId, supplierId) => setAssignments(prev => ({ ...prev, [itemId]: supplierId }));
  const setInfo = (sid, field, value) => setLotInfo(prev => ({ ...prev, [sid]: { ...(prev[sid] || {}), [field]: value } }));
  const toggle = (itemId) => setSelected(prev => (prev.includes(itemId) ? prev.filter(x => x !== itemId) : [...prev, itemId]));
  const applyBulk = () => {
    if (!bulkSupplier || !selected.length) return;
    setAssignments(prev => Object.fromEntries([...Object.entries(prev), ...selected.map(itemId => [itemId, bulkSupplier])]));
    setSelected([]);
  };

  const submit = async () => {
    if (unassigned.length) { toast.error(t('split.err.ITEM_NOT_ALLOCATED')); return; }
    if (lots.length < 2) { toast.error(t('split.err.SPLIT_MIN_SUPPLIERS')); return; }
    for (const lot of lots) {
      const info = lotInfo[lot.supplierId] || {};
      if (proformaRequired && !info.file) { toast.error(t('split.err.proformaFor', { supplier: supplierName(lot.supplierId) })); return; }
      if (justificationRequired && !String(info.justification || '').trim()) {
        toast.error(t('split.err.justificationFor', { supplier: supplierName(lot.supplierId) }));
        return;
      }
    }
    setSubmitting(true);
    const uploaded = []; // pièces déposées pour cette tentative : retirées si l'étape est refusée
    try {
      const payload = [];
      for (const lot of lots) {
        const info = lotInfo[lot.supplierId] || {};
        let attachmentId = null;
        if (info.file) {
          attachmentId = (await uploadService.uploadFile(info.file, 'requisition', id)).data?.id || null;
          if (attachmentId) uploaded.push(attachmentId);
        }
        payload.push({
          supplierId: Number(lot.supplierId),
          itemIds: lot.items.map(i => i.id),
          attachmentId,
          amount: info.amount === undefined || info.amount === '' ? null : Number(info.amount),
          justification: String(info.justification || '').trim() || null,
        });
      }
      await taskService.completeTask(taskId, { lots: payload });
      toast.success(t('split.done', { count: payload.length }));
      navigate(`/requisitions/${id}/tasks`);
    } catch (error) {
      for (const fileId of uploaded) uploadService.deleteFile(fileId).catch(() => {});
      const code = error.response?.data?.code;
      toast.error(code && ERRORS.includes(code) ? t(`split.err.${code}`) : (error.response?.data?.message || t('reqTasks.completeError')));
    } finally {
      setSubmitting(false);
    }
  };

  const supplierOptions = (
    <>
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
    </>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(`/requisitions/${id}/tasks`)} className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><Split size={24} className="text-indigo-600" /> {t('split.title')}</h1>
          <p className="text-gray-500 mt-1">
            {t('reqTasks.requisition', { number: requisition?.requisition_number })}
            {method ? ` · ${t(`procurementMethod.${method}`)}` : ''}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900 flex gap-2">
        <Info size={18} className="shrink-0 mt-0.5" />
        <div>
          <p>{t('split.intro')}</p>
          <p className="mt-1 text-indigo-800">{t('split.rules')}</p>
        </div>
      </div>

      {/* Articles : un fournisseur par article */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b border-gray-200 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold flex-1">{t('split.itemsTitle', { count: items.length })}</h2>
          <span className="text-sm text-gray-500">{t('split.selectedCount', { count: selected.length })}</span>
          <SearchSelect
            id="split-bulk-supplier"
            data-testid="split-bulk-supplier"
            value={bulkSupplier}
            onChange={(e) => setBulkSupplier(e.target.value)}
            className="w-64 px-3 py-2 border rounded-lg text-sm"
          >
            <option value="">{t('split.chooseSupplier')}</option>
            {supplierOptions}
          </SearchSelect>
          <button
            type="button"
            data-testid="split-bulk-apply"
            onClick={applyBulk}
            disabled={!bulkSupplier || !selected.length}
            className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {t('split.assignSelected')}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-2 w-8">
                  <input
                    type="checkbox"
                    aria-label={t('split.selectAll')}
                    checked={items.length > 0 && selected.length === items.length}
                    onChange={(e) => setSelected(e.target.checked ? items.map(i => i.id) : [])}
                  />
                </th>
                <th className="px-4 py-2 text-left">{t('split.colDescription')}</th>
                <th className="px-4 py-2 text-right">{t('split.colQuantity')}</th>
                <th className="px-4 py-2 text-right">{t('split.colTotal')}</th>
                <th className="px-4 py-2 text-left">{t('split.supplier')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map(item => (
                <tr key={item.id} data-testid="split-item-row" className={assignments[item.id] ? '' : 'bg-amber-50/50'}>
                  <td className="px-4 py-2">
                    <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} aria-label={item.item_description} />
                  </td>
                  <td className="px-4 py-2">{item.item_description}</td>
                  <td className="px-4 py-2 text-right">{Number(item.quantity).toLocaleString(getLocale())}</td>
                  <td className="px-4 py-2 text-right">{formatAmount(item.total_amount)}</td>
                  <td className="px-4 py-2 min-w-[16rem]">
                    <SearchSelect
                      data-testid="split-item-supplier"
                      value={assignments[item.id] || ''}
                      onChange={(e) => assign(item.id, e.target.value)}
                      className="w-full px-3 py-1.5 border rounded-lg"
                    >
                      <option value="">{t('split.chooseSupplier')}</option>
                      {supplierOptions}
                    </SearchSelect>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {unassigned.length > 0 && (
          <p className="px-4 py-2 text-sm text-amber-700" data-testid="split-unassigned">{t('split.unassigned', { count: unassigned.length })}</p>
        )}
      </div>

      {/* Une part par fournisseur */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{t('split.lotsTitle', { count: lots.length })}</h2>
        {lots.length === 0 && <p className="text-sm text-gray-500">{t('split.noLot')}</p>}
        {lots.map((lot, index) => {
          const info = lotInfo[lot.supplierId] || {};
          const supplier = suppliers.find(s => String(s.id) === lot.supplierId);
          return (
            <div key={lot.supplierId} className="bg-white rounded-lg shadow p-4" data-testid="split-lot">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold text-gray-800">
                  {t('split.lotLabel', { number: index + 1, supplier: supplier?.name || '—' })}
                </h3>
                <span className="text-sm text-gray-600">
                  {t('split.lotSummary', { count: lot.items.length, amount: formatAmount(lot.total) })}
                </span>
              </div>
              {supplier && !supplier.is_prequalified && (
                <p className="text-xs text-orange-600 mt-1">{t('reqTasks.direct.notPrequalified')}</p>
              )}
              <ul className="mt-2 text-sm text-gray-600 list-disc pl-5">
                {lot.items.map(i => <li key={i.id}>{i.item_description}</li>)}
              </ul>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <Paperclip size={14} className="inline mr-1" />
                    {t('split.proforma')} {proformaRequired && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type="file"
                    data-testid="split-lot-proforma"
                    accept={PROFORMA_ACCEPT}
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      if (file && file.size > PROFORMA_MAX) { toast.error(t('reqTasks.direct.tooLarge')); e.target.value = ''; return; }
                      setInfo(lot.supplierId, 'file', file);
                    }}
                    className="w-full text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('reqTasks.direct.amount', { currency: currency?.code || '' })}</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={info.amount ?? ''}
                    onChange={(e) => setInfo(lot.supplierId, 'amount', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('split.justification')} {justificationRequired && <span className="text-red-500">*</span>}
                  </label>
                  <textarea
                    rows="2"
                    data-testid="split-lot-justification"
                    value={info.justification || ''}
                    onChange={(e) => setInfo(lot.supplierId, 'justification', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end gap-3">
        <button onClick={() => navigate(`/requisitions/${id}/tasks`)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
          {t('common.cancel')}
        </button>
        <button
          data-testid="split-submit"
          onClick={submit}
          disabled={submitting}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? t('split.submitting') : t('split.submit', { count: lots.length })}
        </button>
      </div>
    </div>
  );
}
