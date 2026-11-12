// src/components/Stock/PartnerList.jsx
// Partenaires de l'entreprise (ex. zones de santé) : destinataires des transferts de stock « vers un partenaire ».
// Chaque partenaire : code unique, type, localisation, responsable (son compte de l'espace partenaire se crée avec la
// fiche si son mot de passe est saisi, sinon plus tard depuis la fiche). Gestion : MANAGE_PARTNERS ; lecture : gestion du stock.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HeartHandshake as Handshake, Plus, Pencil, RefreshCw, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import SearchSelect from '../Common/SearchSelect';
import { partnerService } from '../../services/stockService';
import { locationService } from '../../services/referenceService';
import { usePermissions } from '../../hooks/usePermissions';
import { t, getLang } from '../../i18n';
import PartnerPasswordField from './PartnerPasswordField';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
// Filtres : largeur naturelle, sur une seule ligne (comme « État du stock »)
const filterCls = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
export const PARTNER_TYPES = ['HEALTH_ZONE', 'HEALTH_FACILITY', 'NGO', 'GOVERNMENT', 'OTHER'];
const EMPTY = { code: '', name: '', partnerType: 'HEALTH_ZONE', locationId: '', address: '', contactName: '', contactTitle: '', email: '', phone: '', notes: '' };
const ERROR_CODES = ['PARTNER_CODE_REQUIRED', 'PARTNER_CODE_INVALID', 'PARTNER_CODE_EXISTS', 'PARTNER_NAME_REQUIRED', 'PARTNER_TYPE_INVALID',
  'LOCATION_REQUIRED', 'LOCATION_INVALID', 'EMAIL_INVALID', 'MANAGER_NAME_REQUIRED', 'MANAGER_EMAIL_REQUIRED', 'PASSWORD_TOO_SHORT',
  'EMAIL_IN_USE', 'MANAGER_HAS_ACCOUNT', 'PARTNER_INACTIVE'];

/** Message après la création du compte du responsable (identifiants envoyés par email ou à communiquer soi-même) */
export function accountCreatedToast(account) {
  if (!account) return;
  if (account.emailed) toast.success(t('partners.accountCreatedEmailed', { email: account.email }));
  else toast(t('partners.accountCreatedNoEmail', { email: account.email }), { icon: '⚠️', duration: 10_000 });
}

export function partnerErrorMessage(err) {
  const d = err?.response?.data || {};
  return ERROR_CODES.includes(d.code) ? t(`partners.err.${d.code}`) : (d.message || t('common.errorOccurred'));
}

/** Pastille du type de partenaire */
export function PartnerTypeBadge({ type }) {
  const color = { HEALTH_ZONE: 'bg-rose-50 text-rose-800', HEALTH_FACILITY: 'bg-pink-50 text-pink-800', NGO: 'bg-emerald-50 text-emerald-800',
    GOVERNMENT: 'bg-sky-50 text-sky-800', OTHER: 'bg-gray-100 text-gray-700' }[type || 'OTHER'];
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${color}`}>{t(`partners.types.${type || 'OTHER'}`)}</span>;
}

/**
 * Fenêtre de création / modification d'un partenaire ; partner = fiche existante (modification).
 * Mot de passe du responsable (facultatif) : renseigné, son compte de l'espace partenaire est créé avec la fiche
 * (proposé en modification tant que le responsable n'a pas de compte).
 */
export function PartnerFormModal({ partner, onClose, onSaved }) {
  const [form, setForm] = useState(() => (partner ? {
    code: partner.code, name: partner.name, partnerType: partner.partner_type, locationId: String(partner.location_id),
    address: partner.address || '', contactName: partner.contact_name || '', contactTitle: partner.contact_title || '',
    email: partner.email || '', phone: partner.phone || '', notes: partner.notes || '',
  } : { ...EMPTY }));
  const [managerPassword, setManagerPassword] = useState('');
  const [locations, setLocations] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { locationService.listPublic().then(r => setLocations(r.data || [])).catch(() => {}); }, []);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  // Le responsable a déjà un compte : plus de mot de passe ici (gestion des comptes sur la fiche)
  const managerHasAccount = !!partner && (partner.accounts
    ? partner.accounts.some(a => a.email === String(partner.email || '').toLowerCase())
    : Number(partner.account_count) > 0);

  const save = async () => {
    if (!form.code.trim() || !form.name.trim() || !form.locationId) { toast.error(t('partners.required')); return; }
    if (managerPassword) {
      if (!form.contactName.trim()) { toast.error(t('partners.err.MANAGER_NAME_REQUIRED')); return; }
      if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) { toast.error(t('partners.err.MANAGER_EMAIL_REQUIRED')); return; }
      if (managerPassword.length < 8) { toast.error(t('partners.err.PASSWORD_TOO_SHORT')); return; }
    }
    setSaving(true);
    try {
      const payload = { ...form, locationId: Number(form.locationId), ...(managerPassword ? { managerPassword, managerLanguage: getLang() } : {}) };
      const res = partner ? await partnerService.update(partner.id, payload) : await partnerService.create(payload);
      toast.success(t(partner ? 'partners.updated' : 'partners.created'));
      accountCreatedToast(res.account);
      onSaved(res.data);
    } catch (err) { toast.error(partnerErrorMessage(err)); } finally { setSaving(false); }
  };

  const field = (key, label, props = {}) => (
    <label className="text-sm">
      <span className="mb-1 block font-medium text-gray-700">{label}</span>
      <input value={form[key]} onChange={set(key)} className={inputCls} data-testid={`partner-${key}`} {...props} />
    </label>
  );
  return (
    <Modal isOpen onClose={() => !saving && onClose()} title={partner ? t('partners.editTitle', { name: partner.name }) : t('partners.newTitle')}
      size="lg" confirmText={t('common.save')} onConfirm={save} isLoading={saving}>
      <div className="grid gap-3 sm:grid-cols-2">
        {field('code', `${t('partners.code')} *`, { maxLength: 30, placeholder: 'ZS-KARISIMBI' })}
        {field('name', `${t('partners.name')} *`, { maxLength: 200 })}
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">{t('partners.type')} *</span>
          <SearchSelect value={form.partnerType} onChange={set('partnerType')} className={inputCls} data-testid="partner-partnerType">
            {PARTNER_TYPES.map(k => <option key={k} value={k}>{t(`partners.types.${k}`)}</option>)}
          </SearchSelect>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">{t('partners.location')} *</span>
          <SearchSelect value={form.locationId} onChange={set('locationId')} className={inputCls} data-testid="partner-locationId">
            <option value="">{t('partners.chooseLocation')}</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </SearchSelect>
        </label>
        <div className="sm:col-span-2">{field('address', t('partners.address'), { maxLength: 2000 })}</div>
        <div className="sm:col-span-2 mt-1 border-t border-gray-100 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('partners.manager')}</div>
        {field('contactName', t('partners.managerName'), { maxLength: 150, placeholder: t('partners.managerNamePlaceholder') })}
        {field('contactTitle', t('partners.managerTitle'), { maxLength: 150, placeholder: t('partners.managerTitlePlaceholder') })}
        {field('email', t('partners.managerEmail'), { type: 'email', maxLength: 150 })}
        {field('phone', t('partners.managerPhone'), { maxLength: 50 })}
        {!managerHasAccount && (
          <div className="sm:col-span-2">
            <PartnerPasswordField value={managerPassword} onChange={setManagerPassword} label={t('partners.managerPassword')}
              hint={t('partners.managerPasswordHint')} testId="partner-managerPassword" />
          </div>
        )}
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-gray-700">{t('partners.notes')}</span>
          <textarea rows={2} value={form.notes} onChange={set('notes')} maxLength={2000} className={inputCls} />
        </label>
      </div>
    </Modal>
  );
}

export default function PartnerList() {
  const { hasPermission } = usePermissions();
  const canManage = hasPermission('MANAGE_PARTNERS');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState([]);
  const [filters, setFilters] = useState({ search: '', partnerType: '', locationId: '', status: 'active' });
  const [editing, setEditing] = useState(null); // {} = nouveau, fiche = modification

  const load = async () => {
    setLoading(true);
    try {
      const res = await partnerService.list({ ...filters, search: filters.search.trim() || undefined, limit: 500 });
      setRows(res.data || []);
      setTotal(res.pagination?.total || 0);
    } catch { /* toast api */ } finally { setLoading(false); }
  };
  useEffect(() => { locationService.listPublic().then(r => setLocations(r.data || [])).catch(() => {}); }, []);
  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h); }, [filters]);
  const setFilter = (k) => (e) => setFilters(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><Handshake /> {t('partners.title')}</h1>
          <p className="text-sm text-gray-500">{t('partners.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="rounded-lg border border-gray-300 p-2 hover:bg-gray-50" title={t('common.refresh')}><RefreshCw size={16} /></button>
          {canManage && (
            <button onClick={() => setEditing({})} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700" data-testid="partner-new">
              <Plus size={16} /> {t('partners.new')}
            </button>
          )}
        </div>
      </div>

      {/* Filtres sur une seule ligne */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={filters.search} onChange={setFilter('search')} placeholder={t('partners.search')} className={`${inputCls} pl-9`} data-testid="partner-search" />
        </div>
        <SearchSelect value={filters.partnerType} onChange={setFilter('partnerType')} className={filterCls} aria-label={t('partners.type')}>
          <option value="">{t('partners.allTypes')}</option>
          {PARTNER_TYPES.map(k => <option key={k} value={k}>{t(`partners.types.${k}`)}</option>)}
        </SearchSelect>
        <SearchSelect value={filters.locationId} onChange={setFilter('locationId')} className={filterCls} aria-label={t('partners.location')}>
          <option value="">{t('partners.allLocations')}</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </SearchSelect>
        <SearchSelect value={filters.status} onChange={setFilter('status')} className={filterCls} aria-label={t('common.status')}>
          <option value="active">{t('partners.active')}</option>
          <option value="inactive">{t('partners.inactive')}</option>
          <option value="">{t('common.all')}</option>
        </SearchSelect>
        <span className="text-xs text-gray-500">{t('partners.count', { count: total })}</span>
      </div>

      {loading ? (
        <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">{t('partners.none')}</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2">{t('partners.code')}</th>
                <th className="px-4 py-2">{t('partners.name')}</th>
                <th className="px-4 py-2">{t('partners.type')}</th>
                <th className="px-4 py-2">{t('partners.location')}</th>
                <th className="px-4 py-2">{t('partners.manager')}</th>
                <th className="px-4 py-2 text-right">{t('partners.accounts')}</th>
                <th className="px-4 py-2 text-right">{t('partners.pending')}</th>
                <th className="px-4 py-2 text-right">{t('partners.units')}</th>
                <th className="px-4 py-2">{t('common.status')}</th>
                {canManage && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(p => (
                <tr key={p.id} className={p.is_active ? '' : 'text-gray-400'} data-testid="partner-row">
                  <td className="px-4 py-2 font-mono font-semibold">{p.code}</td>
                  <td className="px-4 py-2"><Link to={`/stock/partners/${p.id}`} className="font-medium text-blue-600 hover:underline">{p.name}</Link></td>
                  <td className="px-4 py-2"><PartnerTypeBadge type={p.partner_type} /></td>
                  <td className="px-4 py-2">{p.location_name}</td>
                  <td className="px-4 py-2">{p.contact_name || '—'}{p.contact_title && <div className="text-xs text-gray-500">{p.contact_title}</div>}</td>
                  <td className="px-4 py-2 text-right">{p.active_account_count}</td>
                  <td className={`px-4 py-2 text-right ${p.pending_count ? 'font-medium text-amber-700' : ''}`}>{p.pending_count}</td>
                  <td className="px-4 py-2 text-right">{p.unit_count}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${p.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{p.is_active ? t('partners.active') : t('partners.inactive')}</span>
                  </td>
                  {canManage && (
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => setEditing(p)} className="rounded p-1.5 text-gray-600 hover:bg-gray-100" title={t('common.edit')}><Pencil size={15} /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <PartnerFormModal partner={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}
