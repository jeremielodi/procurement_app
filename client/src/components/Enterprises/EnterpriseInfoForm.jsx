// src/components/Enterprises/EnterpriseInfoForm.jsx
// Informations d'une entreprise (+ logo). Utilisé par le super admin et par l'admin de l'entreprise.
import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Upload, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { currencyService } from '../../services/currencyService';
import { enterpriseLogoUrl } from '../../contexts/EnterpriseContext';
import { t, LANGUAGES } from '../../i18n';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500';

// [clé du formulaire, colonne] — libellé : enterprises.fields.<clé>
const FIELDS = [
  ['name', 'name'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['website', 'website'],
  ['registrationNumber', 'registration_number'],
  ['taxId', 'tax_id'],
  ['address', 'address'],
];

export default function EnterpriseInfoForm({ enterprise, onSubmit, submitting, canEditCode = false, withAdmin = false, submitLabel = t('common.save') }) {
  const [form, setForm] = useState({});
  const [logo, setLogo] = useState(null);
  const [preview, setPreview] = useState(null);

  const { data: currencies } = useQuery({ queryKey: ['currencies-all'], queryFn: () => currencyService.getAll() });

  useEffect(() => {
    const init = { code: enterprise?.code || '', currencyId: enterprise?.currency_id || '' };
    FIELDS.forEach(([k, col]) => { init[k] = enterprise?.[col] || ''; });
    setForm(init);
    setLogo(null);
    setPreview(null);
  }, [enterprise]);
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const onLogo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return toast.error(t('auth.register.logoType'));
    if (file.size > 2 * 1024 * 1024) return toast.error(t('auth.register.logoSize'));
    setLogo(file);
    setPreview(URL.createObjectURL(file));
  };

  const submit = (e) => {
    e.preventDefault();
    if (!form.name?.trim()) return toast.error(t('enterprises.nameRequired'));
    if (canEditCode && !/^[A-Za-z0-9_-]{2,20}$/.test(form.code || '')) return toast.error(t('enterprises.codeInvalid'));
    if (!form.currencyId) return toast.error(t('enterprises.chooseCurrency'));
    if (withAdmin && form.adminEmail && (form.adminPassword || '').length < 8) return toast.error(t('enterprises.adminPasswordMin'));
    const data = { ...form };
    if (!canEditCode) delete data.code;
    onSubmit(data, logo);
  };

  const logoSrc = preview || enterpriseLogoUrl(enterprise);
  const currencyList = currencies?.data || [];

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="flex items-center gap-5">
        <div className="w-24 h-24 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden">
          {logoSrc ? <img src={logoSrc} alt="Logo" className="max-w-full max-h-full object-contain" /> : <Building2 size={32} className="text-gray-300" />}
        </div>
        <div>
          <label className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm cursor-pointer hover:bg-gray-50">
            <Upload size={16} /> {logoSrc ? t('enterprises.changeLogo') : t('enterprises.addLogo')}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onLogo} data-testid="enterprise-logo-input" />
          </label>
          <p className="text-xs text-gray-500 mt-1">{t('enterprises.logoHint')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="ent-code">{t('enterprises.code')}</label>
          <input id="ent-code" className={`${inputCls} uppercase`} value={form.code || ''} disabled={!canEditCode}
            maxLength={20} onChange={e => set('code', e.target.value.toUpperCase())} placeholder={t('enterprises.codePlaceholder')} />
          {!canEditCode && <p className="text-xs text-gray-400 mt-1">{t('enterprises.codeFixed')}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="ent-currency">{t('enterprises.currency')}</label>
          <select id="ent-currency" className={inputCls} value={form.currencyId || ''} onChange={e => set('currencyId', e.target.value)}>
            <option value="">{t('enterprises.choose')}</option>
            {currencyList.map(c => <option key={c.id} value={c.id}>{c.format_key} — {c.name}</option>)}
          </select>
        </div>
        {FIELDS.map(([k]) => (
          <div key={k} className={k === 'name' || k === 'address' ? 'md:col-span-2' : ''}>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor={`ent-${k}`}>{t(`enterprises.fields.${k}`)}</label>
            <input id={`ent-${k}`} className={inputCls} value={form[k] || ''} onChange={e => set(k, e.target.value)} />
          </div>
        ))}
      </div>

      {withAdmin && (
        <div className="p-4 rounded-lg border border-blue-200 bg-blue-50 space-y-3">
          <div className="text-sm font-medium text-blue-900">{t('enterprises.firstAdmin')}</div>
          <p className="text-xs text-blue-800">{t('enterprises.firstAdminHint')}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className={inputCls} placeholder={t('enterprises.firstName')} value={form.adminFirstName || ''} onChange={e => set('adminFirstName', e.target.value)} />
            <input className={inputCls} placeholder={t('enterprises.lastName')} value={form.adminLastName || ''} onChange={e => set('adminLastName', e.target.value)} />
            <input className={inputCls} type="email" placeholder={t('enterprises.loginEmail')} aria-label={t('enterprises.adminEmail')} value={form.adminEmail || ''} onChange={e => set('adminEmail', e.target.value)} />
            <input className={inputCls} type="password" placeholder={t('enterprises.password')} aria-label={t('enterprises.adminPassword')} value={form.adminPassword || ''} onChange={e => set('adminPassword', e.target.value)} />
            <select className={inputCls} aria-label={t('users.language')} value={form.adminLanguage || LANGUAGES[0].code} onChange={e => set('adminLanguage', e.target.value)}>
              {LANGUAGES.map(l => <option key={l.code} value={l.code}>{t('users.language')} : {l.name}</option>)}
            </select>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={submitting}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
          <Save size={16} /> {submitting ? t('po.saving') : submitLabel}
        </button>
      </div>
    </form>
  );
}
