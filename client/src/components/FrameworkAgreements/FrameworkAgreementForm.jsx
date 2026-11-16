// src/components/FrameworkAgreements/FrameworkAgreementForm.jsx
// Saisie / modification d'un accord-cadre en brouillon (migration 69) : contrat (titre, référence, fournisseur, période,
// plafond, devise), projets autorisés (aucun = toute l'entreprise), bordereau de prix (article du catalogue ou texte
// libre, unité, prix unitaire, quantité maximale facultative), articles hors bordereau autorisés ou non, contrat signé.
// ?tenderId= : fournisseur et bordereau repris d'un appel d'offres attribué (attribution par article : choix de
// l'attributaire). Après l'enregistrement : fiche du contrat (soumission à validation depuis la fiche).
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, FileSignature, Plus, Trash2, Save, RefreshCw, Paperclip, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { frameworkAgreementService } from '../../services/frameworkAgreementService';
import { supplierService } from '../../services/supplierService';
import { projectService } from '../../services/projectService';
import { unitService } from '../../services/referenceService';
import { uploadService } from '../../services/uploadService';
import CatalogAutocomplete from '../Stock/CatalogAutocomplete';
import SearchSelect from '../Common/SearchSelect';
import { agreementError } from './FrameworkAgreementList';
import { t, useTranslation } from '../../i18n';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const labelCls = 'mb-1 block text-sm font-medium text-gray-700';
const emptyItem = () => ({ key: Math.random().toString(36).slice(2), stockItem: null, description: '', unitId: '', unitPrice: '', maxQuantity: '', requisitionItemId: null });
const year = new Date().getFullYear();

export default function FrameworkAgreementForm() {
  const { id } = useParams();
  const editing = !!id;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { lang } = useTranslation();
  const [loading, setLoading] = useState(editing || !!params.get('tenderId'));
  const [saving, setSaving] = useState(false);
  const [suppliers, setSuppliers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [units, setUnits] = useState([]);
  const [awardees, setAwardees] = useState([]);
  const [tender, setTender] = useState(null);
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({
    title: '', contractReference: '', description: '', supplierId: '', tenderId: params.get('tenderId') || '',
    startDate: `${year}-01-01`, endDate: `${year}-12-31`, ceilingAmount: '', currencyId: '', allowOffList: false,
    projectIds: [], items: [emptyItem()],
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setItem = (key, patch) => setForm(f => ({ ...f, items: f.items.map(i => (i.key === key ? { ...i, ...patch } : i)) }));

  useEffect(() => {
    supplierService.getForPurchaseOrder().then(r => setSuppliers(r.data || [])).catch(() => {});
    projectService.getAll({ limit: 1000 }).then(r => setProjects((r.data || []).filter(p => p.is_active !== false))).catch(() => {});
    api.get('/currencies').then(r => setCurrencies(r.data?.data || [])).catch(() => {});
  }, []);
  useEffect(() => { unitService.list().then(r => setUnits(r.data || [])).catch(() => {}); }, [lang]);

  // Reprise d'un appel d'offres attribué (création) ; supplierId : attributaire choisi (attribution par article)
  const applyTender = async (supplierId) => {
    setLoading(true);
    try {
      const res = await frameworkAgreementService.tenderPrefill(params.get('tenderId'), supplierId);
      const d = res.data;
      setTender(d.tender);
      setAwardees(d.awardees || []);
      setForm(f => ({
        ...f,
        tenderId: d.tender.id,
        title: f.title || d.tender.title,
        contractReference: f.contractReference || d.tender.tender_number,
        supplierId: d.supplier?.id || '',
        items: d.items?.length
          ? d.items.map(i => ({ ...emptyItem(), stockItem: i.stock_item_id ? { id: i.stock_item_id, code: '', unit: '' } : null, description: i.description, unitId: i.unit_id || '', unitPrice: i.unit_price, requisitionItemId: i.requisition_item_id }))
          : f.items,
      }));
    } catch (err) {
      toast.error(agreementError(err));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { if (!editing && params.get('tenderId')) applyTender(params.get('supplierId') || undefined); }, []);

  // Modification d'un brouillon
  useEffect(() => {
    if (!editing) return;
    frameworkAgreementService.get(id).then(res => {
      const a = res.data;
      if (!a.can_edit) { navigate(`/framework-agreements/${id}`, { replace: true }); return; }
      if (a.tender_id) setTender({ id: a.tender_id, tender_number: a.tender_number, title: a.tender_title });
      setForm({
        title: a.title, contractReference: a.contract_reference || '', description: a.description || '', supplierId: a.supplier_id,
        tenderId: a.tender_id || '', startDate: a.start_date, endDate: a.end_date, ceilingAmount: a.ceiling_amount,
        currencyId: a.currency_id, allowOffList: a.allow_off_list, projectIds: a.projects.map(p => p.id),
        items: a.items.length ? a.items.map(i => ({
          key: i.id, stockItem: i.stock_item_id ? { id: i.stock_item_id, code: i.stock_item_code, unit: i.unit_abbr } : null,
          description: i.description, unitId: i.unit_id, unitPrice: i.unit_price, maxQuantity: i.max_quantity ?? '', requisitionItemId: i.requisition_item_id,
        })) : [emptyItem()],
      });
    }).catch(() => navigate('/framework-agreements', { replace: true })).finally(() => setLoading(false));
  }, [id]);

  const supplierGroups = useMemo(() => ({
    pre: suppliers.filter(s => s.is_prequalified), other: suppliers.filter(s => !s.is_prequalified),
  }), [suppliers]);
  const projectOptions = projects.filter(p => !form.projectIds.includes(p.id));
  const itemsTotal = form.items.reduce((s, i) => s + (Number(i.unitPrice) || 0) * (Number(i.maxQuantity) || 0), 0);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const items = form.items.filter(i => i.description.trim() || i.unitPrice !== '');
    const payload = {
      title: form.title, contractReference: form.contractReference, description: form.description,
      supplierId: form.supplierId || null, tenderId: form.tenderId || null, startDate: form.startDate, endDate: form.endDate,
      ceilingAmount: form.ceilingAmount, currencyId: form.currencyId || null, allowOffList: form.allowOffList, projectIds: form.projectIds,
      items: items.map(i => ({
        stockItemId: i.stockItem?.id || null, description: i.description, unitId: i.unitId || null, unitPrice: i.unitPrice,
        maxQuantity: i.maxQuantity === '' ? null : i.maxQuantity, requisitionItemId: i.requisitionItemId || null,
      })),
    };
    try {
      const res = editing ? await frameworkAgreementService.update(id, payload) : await frameworkAgreementService.create(payload);
      const agreementId = editing ? id : res.data.id;
      if (file) {
        try { await uploadService.uploadFile(file, 'framework_agreement', agreementId); } catch { toast.error(t('frameworkAgreements.form.uploadFailed')); }
      }
      toast.success(t(editing ? 'frameworkAgreements.form.updated' : 'frameworkAgreements.form.created'));
      navigate(`/framework-agreements/${agreementId}`);
    } catch (err) {
      toast.error(agreementError(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>;

  return (
    <form onSubmit={save} className="max-w-6xl space-y-5 p-6" data-testid="agreement-form">
      <button type="button" onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft size={16} /> {t('common.back')}</button>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><FileSignature /> {t(editing ? 'frameworkAgreements.form.editTitle' : 'frameworkAgreements.form.newTitle')}</h1>
        <p className="text-sm text-gray-500">{t('frameworkAgreements.form.hint')}</p>
      </div>

      {tender && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900" data-testid="agreement-from-tender">
          {t('frameworkAgreements.form.fromTender', { number: tender.tender_number, title: tender.title })}
          {!editing && awardees.length > 1 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span>{t('frameworkAgreements.form.chooseAwardee')}</span>
              <SearchSelect value={form.supplierId} onChange={e => applyTender(e.target.value)} className="px-3 py-1.5 border border-blue-300 rounded-lg text-sm bg-white" data-testid="agreement-awardee">
                <option value="">—</option>
                {awardees.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </SearchSelect>
            </div>
          )}
        </div>
      )}

      <section className="grid gap-4 rounded-lg border border-gray-200 bg-white p-5 md:grid-cols-2">
        <label className="md:col-span-2">
          <span className={labelCls}>{t('frameworkAgreements.form.title')} *</span>
          <input value={form.title} onChange={e => set('title', e.target.value)} className={inputCls} required maxLength={255} data-testid="agreement-title" />
        </label>
        <label>
          <span className={labelCls}>{t('frameworkAgreements.supplier')} *</span>
          <SearchSelect value={form.supplierId} onChange={e => set('supplierId', e.target.value)} className={inputCls} required disabled={!!tender} data-testid="agreement-supplier">
            <option value="">—</option>
            {supplierGroups.pre.length > 0 && <optgroup label={t('frameworkAgreements.form.prequalified')}>{supplierGroups.pre.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>}
            {supplierGroups.other.length > 0 && <optgroup label={t('frameworkAgreements.form.notPrequalified')}>{supplierGroups.other.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>}
          </SearchSelect>
        </label>
        <label>
          <span className={labelCls}>{t('frameworkAgreements.form.reference')}</span>
          <input value={form.contractReference} onChange={e => set('contractReference', e.target.value)} className={inputCls} maxLength={100} placeholder={t('frameworkAgreements.form.referencePlaceholder')} data-testid="agreement-reference" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className={labelCls}>{t('frameworkAgreements.form.startDate')} *</span>
            <input type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} className={inputCls} required data-testid="agreement-start" />
          </label>
          <label>
            <span className={labelCls}>{t('frameworkAgreements.form.endDate')} *</span>
            <input type="date" value={form.endDate} min={form.startDate} onChange={e => set('endDate', e.target.value)} className={inputCls} required data-testid="agreement-end" />
          </label>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <label>
            <span className={labelCls}>{t('frameworkAgreements.ceiling')} *</span>
            <input type="number" min="0" step="0.01" value={form.ceilingAmount} onChange={e => set('ceilingAmount', e.target.value)} className={inputCls} required data-testid="agreement-ceiling" />
          </label>
          <label>
            <span className={labelCls}>{t('frameworkAgreements.form.currency')}</span>
            <SearchSelect value={form.currencyId} onChange={e => set('currencyId', e.target.value)} className={inputCls} data-testid="agreement-currency">
              <option value="">{t('frameworkAgreements.form.enterpriseCurrency')}</option>
              {currencies.map(c => <option key={c.id} value={c.id}>{c.format_key}</option>)}
            </SearchSelect>
          </label>
        </div>
        <label className="md:col-span-2">
          <span className={labelCls}>{t('frameworkAgreements.form.description')}</span>
          <textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)} className={inputCls} />
        </label>
      </section>

      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-5">
        <div>
          <h2 className="font-semibold text-gray-900">{t('frameworkAgreements.projects')}</h2>
          <p className="text-xs text-gray-500">{t('frameworkAgreements.form.projectsHint')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2" data-testid="agreement-projects">
          {form.projectIds.length === 0 && <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">{t('frameworkAgreements.allProjects')}</span>}
          {form.projectIds.map(pid => {
            const p = projects.find(x => x.id === pid);
            return (
              <span key={pid} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-800">
                {p ? `${p.code} — ${p.name}` : pid}
                <button type="button" onClick={() => set('projectIds', form.projectIds.filter(x => x !== pid))} aria-label={t('common.remove')}><X size={12} /></button>
              </span>
            );
          })}
          <SearchSelect value="" onChange={e => e.target.value && set('projectIds', [...form.projectIds, e.target.value])} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" data-testid="agreement-project-add">
            <option value="">{t('frameworkAgreements.form.addProject')}</option>
            {projectOptions.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
          </SearchSelect>
        </div>
        {form.projectIds.length > 0 && <p className="text-xs text-gray-500">{t('frameworkAgreements.form.validationProjects')}</p>}
        {form.projectIds.length === 0 && <p className="text-xs text-gray-500">{t('frameworkAgreements.form.validationDgOnly')}</p>}
      </section>

      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-900">{t('frameworkAgreements.priceList')}</h2>
            <p className="text-xs text-gray-500">{t('frameworkAgreements.form.priceListHint')}</p>
          </div>
          <button type="button" onClick={() => set('items', [...form.items, emptyItem()])} className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50" data-testid="agreement-item-add">
            <Plus size={14} /> {t('frameworkAgreements.form.addItem')}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                <th className="py-2 pr-2">{t('frameworkAgreements.item')}</th>
                <th className="w-40 py-2 pr-2">{t('frameworkAgreements.unit')}</th>
                <th className="w-32 py-2 pr-2">{t('frameworkAgreements.unitPrice')}</th>
                <th className="w-32 py-2 pr-2">{t('frameworkAgreements.maxQuantity')}</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {form.items.map(i => (
                <tr key={i.key} className="align-top" data-testid="agreement-item">
                  <td className="py-1 pr-2">
                    <CatalogAutocomplete
                      className={inputCls}
                      inputProps={{ value: i.description, onChange: e => setItem(i.key, { description: e.target.value }), 'data-testid': 'agreement-item-description' }}
                      linked={i.stockItem?.code ? i.stockItem : null}
                      onLink={(item) => setItem(i.key, item ? { stockItem: item, description: i.description || item.name, unitId: item.unit_id || i.unitId } : { stockItem: null })}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <SearchSelect value={i.unitId} onChange={e => setItem(i.key, { unitId: e.target.value })} className={inputCls} data-testid="agreement-item-unit">
                      <option value="">{t('frameworkAgreements.form.defaultUnit')}</option>
                      {units.map(u => <option key={u.id} value={u.id}>{u.name} ({u.abbr})</option>)}
                    </SearchSelect>
                  </td>
                  <td className="py-1 pr-2"><input type="number" min="0" step="0.0001" value={i.unitPrice} onChange={e => setItem(i.key, { unitPrice: e.target.value })} className={inputCls} data-testid="agreement-item-price" /></td>
                  <td className="py-1 pr-2"><input type="number" min="0" step="0.0001" value={i.maxQuantity} onChange={e => setItem(i.key, { maxQuantity: e.target.value })} className={inputCls} placeholder={t('frameworkAgreements.form.unlimited')} data-testid="agreement-item-max" /></td>
                  <td className="py-1">
                    <button type="button" onClick={() => set('items', form.items.filter(x => x.key !== i.key))} className="rounded p-2 text-red-600 hover:bg-red-50" aria-label={t('common.delete')}><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {itemsTotal > 0 && Number(form.ceilingAmount) > 0 && itemsTotal > Number(form.ceilingAmount) && (
          <p className="text-xs text-orange-700">{t('frameworkAgreements.form.maxAboveCeiling')}</p>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={form.allowOffList} onChange={e => set('allowOffList', e.target.checked)} className="mt-0.5" data-testid="agreement-off-list" />
          <span>{t('frameworkAgreements.form.allowOffList')}<span className="block text-xs text-gray-500">{t('frameworkAgreements.form.allowOffListHint')}</span></span>
        </label>
      </section>

      <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="font-semibold text-gray-900">{t('frameworkAgreements.signedContract')}</h2>
        <p className="text-xs text-gray-500">{t(tender ? 'frameworkAgreements.form.contractOptional' : 'frameworkAgreements.form.contractRequired')}</p>
        {editing ? <p className="text-xs text-gray-500">{t('frameworkAgreements.form.contractOnDetail')}</p> : (
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">
            <Paperclip size={16} /> {file ? file.name : t('frameworkAgreements.form.chooseFile')}
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} data-testid="agreement-file" />
          </label>
        )}
      </section>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => navigate(-1)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">{t('common.cancel')}</button>
        <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50" data-testid="agreement-save">
          <Save size={16} /> {t('frameworkAgreements.form.saveDraft')}
        </button>
      </div>
    </form>
  );
}
