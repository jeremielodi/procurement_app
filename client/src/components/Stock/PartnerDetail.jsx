// src/components/Stock/PartnerDetail.jsx
// Fiche d'un partenaire : identité (type, localisation, responsable), comptes de l'espace partenaire (compte du
// responsable créé depuis la fiche, autres comptes, activation), envois reçus, matériel détenu (retour possible).
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, HeartHandshake as Handshake, Pencil, RefreshCw, UserPlus, PackageMinus, Undo2, MapPin, Phone, Mail, KeyRound, Eye, EyeOff, Wand2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import SearchSelect from '../Common/SearchSelect';
import { partnerService, stockIssueService, equipmentService } from '../../services/stockService';
import { usePermissions } from '../../hooks/usePermissions';
import { t, getLocale, getLang } from '../../i18n';
import { PartnerFormModal, PartnerTypeBadge } from './PartnerList';
import { IssueStatusBadge } from './StockIssueDetail';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(getLocale()) : '—');
const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);
const ACCOUNT_ERRORS = ['EMAIL_REQUIRED', 'NAME_REQUIRED', 'PASSWORD_REQUIRED', 'PASSWORD_TOO_SHORT', 'PARTNER_INACTIVE', 'EMAIL_IN_USE'];

/** Mot de passe proposé : 12 caractères sans caractères ambigus (0/O, 1/l/I) */
function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint32Array(12);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

/**
 * Création d'un compte de l'espace partenaire — manager : compte du responsable (fiche).
 * Mot de passe obligatoire, saisi (ou généré) par l'administrateur : le compte ne dépend pas de l'envoi d'un email ;
 * les identifiants sont envoyés par email si possible, sinon l'administrateur les communique lui-même.
 */
function AccountModal({ partner, manager, onClose, onCreated }) {
  const [form, setForm] = useState({ email: '', firstName: '', lastName: '', position: '', language: getLang(), password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    if (!form.password) { toast.error(t('partners.err.PASSWORD_REQUIRED')); return; }
    if (form.password.length < 8) { toast.error(t('partners.err.PASSWORD_TOO_SHORT')); return; }
    setSaving(true);
    try {
      const payload = manager ? { language: form.language, password: form.password } : { ...form };
      const res = await partnerService.createAccount(partner.id, payload);
      if (res.data?.emailed) toast.success(t('partners.accountCreatedEmailed', { email: res.data.email }));
      else toast(t('partners.accountCreatedNoEmail', { email: res.data?.email }), { icon: '⚠️', duration: 10_000 });
      onCreated();
    } catch (err) {
      const d = err.response?.data || {};
      toast.error(ACCOUNT_ERRORS.includes(d.code) ? t(`partners.err.${d.code}`) : (d.message || t('common.errorOccurred')));
    } finally { setSaving(false); }
  };
  return (
    <Modal isOpen onClose={() => !saving && onClose()} title={manager ? t('partners.managerAccountTitle') : t('partners.accountTitle')}
      size="md" confirmText={t('partners.createAccount')} onConfirm={save} isLoading={saving}>
      <div className="space-y-3 text-sm">
        {manager ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <b>{partner.contact_name}</b>{partner.contact_title && <span className="text-gray-500"> — {partner.contact_title}</span>}
            <div className="text-gray-600">{partner.email}</div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span className="mb-1 block font-medium text-gray-700">{t('partners.firstName')} *</span><input value={form.firstName} onChange={set('firstName')} className={inputCls} data-testid="account-firstName" /></label>
            <label><span className="mb-1 block font-medium text-gray-700">{t('partners.lastName')}</span><input value={form.lastName} onChange={set('lastName')} className={inputCls} /></label>
            <label className="sm:col-span-2"><span className="mb-1 block font-medium text-gray-700">{t('partners.managerEmail')} *</span><input type="email" value={form.email} onChange={set('email')} className={inputCls} data-testid="account-email" /></label>
            <label className="sm:col-span-2"><span className="mb-1 block font-medium text-gray-700">{t('partners.managerTitle')}</span><input value={form.position} onChange={set('position')} className={inputCls} /></label>
          </div>
        )}
        <label className="block">
          <span className="mb-1 block font-medium text-gray-700">{t('partners.accountLanguage')}</span>
          <SearchSelect value={form.language} onChange={set('language')} className={inputCls}>
            <option value="fr">Français</option>
            <option value="en">English</option>
          </SearchSelect>
        </label>
        <div>
          <span className="mb-1 block font-medium text-gray-700">{t('partners.password')} *</span>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input type={showPassword ? 'text' : 'password'} value={form.password} onChange={set('password')} minLength={8} required autoComplete="new-password"
                placeholder={t('partners.passwordPlaceholder')} className={`${inputCls} pr-9 font-mono`} data-testid="account-password" />
              <button type="button" onClick={() => setShowPassword(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-800"
                aria-label={showPassword ? t('partners.hidePassword') : t('partners.showPassword')}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <button type="button" onClick={() => { setForm(f => ({ ...f, password: generatePassword() })); setShowPassword(true); }}
              className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 text-sm hover:bg-gray-50" data-testid="account-generate-password">
              <Wand2 size={15} /> {t('partners.generatePassword')}
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-500">{t('partners.passwordHint')}</p>
        </div>
      </div>
    </Modal>
  );
}

export default function PartnerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission('MANAGE_PARTNERS');
  const canIssue = hasPermission('ISSUE_STOCK');
  const [partner, setPartner] = useState(null);
  const [loading, setLoading] = useState(true);
  const [issues, setIssues] = useState([]);
  const [holdings, setHoldings] = useState([]);
  const [editing, setEditing] = useState(false);
  const [accountModal, setAccountModal] = useState(null); // 'manager' | 'other'

  const load = async () => {
    try {
      const [p, i, h] = await Promise.all([
        partnerService.get(id),
        stockIssueService.list({ partnerId: id, destinationType: 'PARTNER', limit: 100 }).catch(() => ({ data: [] })),
        equipmentService.partnerHoldings(id).catch(() => ({ data: [] })),
      ]);
      setPartner(p.data);
      setIssues(i.data || []);
      setHoldings(h.data || []);
    } catch { setPartner(null); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [id]);

  const toggleAccount = async (acc) => {
    try {
      await partnerService.setAccountActive(partner.id, acc.id, !acc.is_active);
      toast.success(acc.is_active ? t('partners.accountDeactivated') : t('partners.accountActivated'));
      load();
    } catch { /* toast api */ }
  };

  if (loading) return <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>;
  if (!partner) return <div className="p-6 text-gray-500">{t('partners.notFound')}</div>;

  const managerHasAccount = partner.email && partner.accounts.some(a => a.email === String(partner.email).toLowerCase());
  const canCreateManager = canManage && partner.is_active && partner.contact_name && partner.email && !managerHasAccount;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft size={16} /> {t('common.back')}</button>
        <div className="flex flex-wrap gap-2">
          {canIssue && partner.is_active && (
            <Link to={`/stock/issues/new?type=PARTNER&partnerId=${partner.id}`} className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700" data-testid="partner-send">
              <PackageMinus size={16} /> {t('partners.send')}
            </Link>
          )}
          {canManage && (
            <button onClick={() => setEditing(true)} className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50" data-testid="partner-edit">
              <Pencil size={16} /> {t('common.edit')}
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900"><Handshake className="text-blue-600" /> {partner.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
              <span className="font-mono font-semibold text-gray-700">{partner.code}</span>
              <PartnerTypeBadge type={partner.partner_type} />
              <span className="flex items-center gap-1"><MapPin size={13} /> {partner.location_name}</span>
              {!partner.is_active && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{t('partners.inactive')}</span>}
            </p>
            {partner.address && <p className="mt-1 text-sm text-gray-600">{partner.address}</p>}
          </div>
          <div className="min-w-[16rem] rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('partners.manager')}</div>
            {partner.contact_name ? (
              <>
                <b>{partner.contact_name}</b>{partner.contact_title && <div className="text-gray-600">{partner.contact_title}</div>}
                {partner.email && <div className="flex items-center gap-1 text-gray-600"><Mail size={13} /> {partner.email}</div>}
                {partner.phone && <div className="flex items-center gap-1 text-gray-600"><Phone size={13} /> {partner.phone}</div>}
              </>
            ) : <span className="text-gray-500">{t('partners.noManager')}</span>}
          </div>
        </div>
        {partner.notes && <p className="mt-3 whitespace-pre-line text-sm text-gray-600">{partner.notes}</p>}
      </div>

      {/* Comptes de l'espace partenaire */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
          <h2 className="flex items-center gap-2 font-medium text-gray-800"><KeyRound size={16} /> {t('partners.accountsTitle')}</h2>
          {canManage && partner.is_active && (
            <div className="flex gap-2">
              {canCreateManager && (
                <button onClick={() => setAccountModal('manager')} className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700" data-testid="partner-manager-account">
                  <UserPlus size={15} /> {t('partners.createManagerAccount')}
                </button>
              )}
              <button onClick={() => setAccountModal('other')} className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50" data-testid="partner-other-account">
                <UserPlus size={15} /> {t('partners.addAccount')}
              </button>
            </div>
          )}
        </div>
        {canManage && !partner.accounts.length && !canCreateManager && partner.is_active && (
          <p className="px-4 pt-3 text-xs text-amber-700">{t('partners.managerIncomplete')}</p>
        )}
        {partner.accounts.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">{t('partners.noAccount')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2">{t('partners.accountName')}</th>
                <th className="px-4 py-2">{t('partners.managerEmail')}</th>
                <th className="px-4 py-2">{t('partners.lastLogin')}</th>
                <th className="px-4 py-2">{t('common.status')}</th>
                {canManage && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {partner.accounts.map(a => (
                <tr key={a.id} className={a.is_active ? '' : 'text-gray-400'} data-testid="partner-account">
                  <td className="px-4 py-2">{a.first_name} {a.last_name}{a.position && <div className="text-xs text-gray-500">{a.position}</div>}</td>
                  <td className="px-4 py-2">{a.email}</td>
                  <td className="px-4 py-2">{fmtDate(a.last_login)}</td>
                  <td className="px-4 py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${a.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{a.is_active ? t('partners.active') : t('partners.inactive')}</span></td>
                  {canManage && (
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => toggleAccount(a)} className="text-xs text-blue-600 hover:underline">{a.is_active ? t('partners.deactivate') : t('partners.reactivate')}</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Matériel détenu */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="font-medium text-gray-800">{t('partners.holdingsTitle')}</h2>
          {canIssue && holdings.length > 0 && (
            <Link to={`/stock/returns/new?partnerId=${partner.id}`} className="flex items-center gap-1 rounded-lg border border-blue-300 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50" data-testid="partner-return">
              <Undo2 size={15} /> {t('stock.return.record')}
            </Link>
          )}
        </div>
        {holdings.length === 0 ? <p className="p-4 text-sm text-gray-500">{t('partners.noHoldings')}</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr><th className="px-4 py-2">{t('stock.item')}</th><th className="px-4 py-2">{t('stock.return.issue')}</th><th className="px-4 py-2 text-right">{t('stock.return.held')}</th></tr>
            </thead>
            <tbody className="divide-y">
              {holdings.map(h => (
                <tr key={h.issue_line_id}>
                  <td className="px-4 py-2"><span className="mr-1 font-mono font-semibold">{h.item_code}</span>{h.item_name}
                    {h.serial_number && <div className="font-mono text-xs text-indigo-700">{t('stock.equipment.serialLabel', { serial: h.serial_number })}{h.asset_tag && ` · ${h.asset_tag}`}</div>}
                  </td>
                  <td className="px-4 py-2 text-xs"><Link to={`/stock/issues/${h.issue_id}`} className="text-blue-600 hover:underline">{h.issue_number}</Link></td>
                  <td className="px-4 py-2 text-right">{fmtQty(h.remaining)} <span className="text-xs text-gray-400">{h.unit}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Envois */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <h2 className="border-b border-gray-200 px-4 py-3 font-medium text-gray-800">{t('partners.shipmentsTitle')}</h2>
        {issues.length === 0 ? <p className="p-4 text-sm text-gray-500">{t('partners.noShipment')}</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr><th className="px-4 py-2">{t('stock.issue.number')}</th><th className="px-4 py-2">{t('common.date')}</th><th className="px-4 py-2">{t('stock.warehouse')}</th><th className="px-4 py-2">{t('stock.issue.items')}</th><th className="px-4 py-2">{t('common.status')}</th></tr>
            </thead>
            <tbody className="divide-y">
              {issues.map(i => (
                <tr key={i.id}>
                  <td className="px-4 py-2 font-mono"><Link to={`/stock/issues/${i.id}`} className="text-blue-600 hover:underline">{i.issue_number}</Link></td>
                  <td className="px-4 py-2">{fmtDate(i.issued_at)}</td>
                  <td className="px-4 py-2">{i.warehouse_name}</td>
                  <td className="px-4 py-2 text-xs text-gray-600">{i.items}</td>
                  <td className="px-4 py-2"><IssueStatusBadge issue={i} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {editing && <PartnerFormModal partner={partner} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />}
      {accountModal && (
        <AccountModal partner={partner} manager={accountModal === 'manager'} onClose={() => setAccountModal(null)} onCreated={() => { setAccountModal(null); load(); }} />
      )}
    </div>
  );
}
