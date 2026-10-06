// src/components/Auth/SupplierRegister.jsx
// Inscription fournisseur : type (entreprise / personne physique), identité, RIB, localisations desservies,
// catégories de marché et documents de préqualification.
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Building2, User, Upload, AlertCircle, UserPlus, X, MapPin, Tags, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import { supplierPortalService } from '../../services/supplierPortalService';
import { locationService, categoryService } from '../../services/referenceService';
import { EXPECTED_DOCS } from '../../utils/supplierDocs';
import MultiCheckList from '../Suppliers/prequal/MultiCheckList';
import DocumentField from '../Suppliers/prequal/DocumentField';
import { t, useTranslation } from '../../i18n';
import LanguageSwitcher from '../Common/LanguageSwitcher';

// Champs par type ; req = obligatoire ; label / placeholder = clés de traduction (supplierFields.*)
const IDENTITY = {
  COMPANY: [
    { name: 'name', label: 'supplierFields.companyName', req: true, full: true, rawPlaceholder: 'ACME SARL' },
    { name: 'contactName', label: 'supplierFields.contactName', req: true, placeholder: 'supplierFields.firstLastName' },
    { name: 'phone', label: 'supplierFields.phone', req: true, rawPlaceholder: '+243 …' },
    { name: 'registrationNumber', label: 'supplierFields.registrationNumber', req: true },
    { name: 'taxId', label: 'supplierFields.taxId', req: true },
    { name: 'idNat', label: 'supplierFields.idNat', req: true },
    { name: 'idDocumentNumber', label: 'supplierFields.repIdDocumentNumber' },
    { name: 'website', label: 'supplierFields.website', rawPlaceholder: 'https://…' },
    { name: 'address', label: 'supplierFields.address', req: true, full: true, textarea: true },
  ],
  INDIVIDUAL: [
    { name: 'name', label: 'supplierFields.fullName', req: true, full: true, placeholder: 'supplierFields.firstLastName' },
    { name: 'phone', label: 'supplierFields.phone', rawPlaceholder: '+243 …' },
    { name: 'idDocumentNumber', label: 'supplierFields.idDocumentNumber' },
    { name: 'address', label: 'supplierFields.address', req: true, full: true, textarea: true },
  ],
};
const BANK = [
  { name: 'bankName', label: 'supplierFields.bankName', req: true },
  { name: 'bankAccount', label: 'supplierFields.bankAccount', req: true },
  { name: 'bankIban', label: 'supplierFields.bankIban' },
  { name: 'bankSwift', label: 'supplierFields.bankSwift' },
];
const ACCOUNT = [
  { name: 'email', label: 'supplierFields.loginEmail', req: true, type: 'email', full: true, placeholder: 'supplierFields.emailPlaceholder' },
  { name: 'password', label: 'supplierFields.password', req: true, type: 'password' },
  { name: 'confirmPassword', label: 'supplierFields.confirmPassword', req: true, type: 'password' },
];

function Section({ icon: Icon, title, children, hint }) {
  return (
    <section className="space-y-3">
      <div className="border-b pb-1">
        <h2 className="font-semibold text-gray-800 flex items-center gap-2"><Icon size={18} className="text-blue-600" />{title}</h2>
        {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export default function SupplierRegister() {
  const [type, setType] = useState('COMPANY');
  const [form, setForm] = useState({});
  const [locationIds, setLocationIds] = useState([]);
  const [categoryIds, setCategoryIds] = useState([]);
  const [docs, setDocs] = useState({});
  const [refs, setRefs] = useState({ locations: [], categories: [] });
  const [logo, setLogo] = useState(null);
  const [preview, setPreview] = useState(null);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  // Catégories traduites par le serveur : rechargées au changement de langue
  const { lang } = useTranslation();
  useEffect(() => {
    Promise.all([locationService.listPublic(), categoryService.listPublic()])
      .then(([l, c]) => setRefs({ locations: l.data || [], categories: c.data || [] }))
      .catch(() => {});
  }, [lang]);
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const set = (name, value) => {
    setForm(f => ({ ...f, [name]: value }));
    if (errors[name]) setErrors(e => ({ ...e, [name]: '' }));
  };

  const onLogo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return toast.error(t('auth.register.logoType'));
    if (file.size > 2 * 1024 * 1024) return toast.error(t('auth.register.logoSize'));
    setLogo(file);
    setPreview(URL.createObjectURL(file));
  };

  const validate = () => {
    const e = {};
    for (const f of [...IDENTITY[type], ...BANK, ...ACCOUNT]) {
      if (f.req && !String(form[f.name] || '').trim()) e[f.name] = t('auth.register.required');
    }
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) e.email = t('auth.emailInvalid');
    if (form.password && form.password.length < 8) e.password = t('auth.register.passwordMin');
    if (form.password !== form.confirmPassword) e.confirmPassword = t('auth.register.passwordMismatch');
    if (!locationIds.length) e.locations = t('auth.register.selectLocation');
    if (!categoryIds.length) e.categories = t('auth.register.selectCategory');
    setErrors(e);
    if (Object.keys(e).length) toast.error(t('auth.register.incomplete'));
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('supplierType', type);
      const allowed = new Set([...IDENTITY[type], ...BANK, ...ACCOUNT].map(f => f.name));
      Object.entries(form).forEach(([k, v]) => allowed.has(k) && k !== 'confirmPassword' && v && fd.append(k, v));
      fd.append('locationIds', JSON.stringify(locationIds));
      fd.append('categoryIds', JSON.stringify(categoryIds));
      for (const dt of EXPECTED_DOCS[type]) if (docs[dt]) fd.append(`doc_${dt}`, docs[dt]);
      if (logo && type === 'COMPANY') fd.append('logo', logo);
      const res = await supplierPortalService.register(fd);
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      toast.success(t('auth.register.created', { code: res.data.supplierCode }));
      // Rechargement complet pour que AuthContext charge le profil
      window.location.href = '/supplier/dashboard';
    } catch (_) {
      // message déjà affiché par l'intercepteur axios
    } finally {
      setSubmitting(false);
    }
  };

  const field = (f) => (
    <div key={f.name} className={f.full ? 'md:col-span-2' : ''}>
      <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor={`f-${f.name}`}>
        {t(f.label)}{f.req && <span className="text-red-500"> *</span>}
      </label>
      {f.textarea ? (
        <textarea id={`f-${f.name}`} rows={2} value={form[f.name] || ''} onChange={e => set(f.name, e.target.value)}
          className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${errors[f.name] ? 'border-red-500' : 'border-gray-300'}`} />
      ) : (
        <input id={`f-${f.name}`} name={f.name} type={f.type || 'text'} placeholder={f.placeholder ? t(f.placeholder) : f.rawPlaceholder}
          value={form[f.name] || ''} onChange={e => set(f.name, e.target.value)}
          className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${errors[f.name] ? 'border-red-500' : 'border-gray-300'}`} />
      )}
      {errors[f.name] && <p className="mt-1 text-sm text-red-500 flex items-center gap-1"><AlertCircle size={14} />{errors[f.name]}</p>}
    </div>
  );

  return (
    <div className="min-h-screen login-bg-color flex items-center justify-center p-4">
      <div className="max-w-3xl w-full bg-white rounded-lg shadow-xl overflow-hidden">
        <div className="p-6 text-center login-card-header-bg">
          <div className="flex justify-end -mt-2 -mr-2 mb-1"><LanguageSwitcher dark /></div>
          <center><img src="/images/procureapp-logo.svg" style={{ height: 52 }} alt="procureApp" /></center>
          <h1 className="text-2xl font-bold text-white">{t('auth.register.title')}</h1>
          <p className="text-blue-100 mt-2">{t('auth.register.subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6" noValidate>
          {/* Type de fournisseur */}
          <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label={t('auth.register.supplierType')}>
            {[['COMPANY', Building2, t('supplierType.COMPANY'), t('auth.register.companyHint')], ['INDIVIDUAL', User, t('supplierType.INDIVIDUAL'), t('auth.register.individualHint')]].map(([v, Icon, label, hint]) => (
              <button key={v} type="button" role="radio" aria-checked={type === v} onClick={() => { setType(v); setErrors({}); }}
                className={`flex items-center gap-3 p-3 border-2 rounded-lg text-left ${type === v ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <Icon size={24} className={type === v ? 'text-blue-600' : 'text-gray-400'} />
                <span><span className="block font-medium text-gray-900">{label}</span><span className="block text-xs text-gray-500">{hint}</span></span>
              </button>
            ))}
          </div>

          <Section icon={type === 'COMPANY' ? Building2 : User} title={type === 'COMPANY' ? t('auth.register.companyIdentity') : t('auth.register.identity')}>
            {type === 'COMPANY' && (
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center bg-gray-50 overflow-hidden">
                  {preview ? <img src={preview} alt="Logo" className="max-w-full max-h-full object-contain" /> : <Building2 size={28} className="text-gray-300" />}
                </div>
                <div>
                  <label className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm cursor-pointer hover:bg-gray-50">
                    <Upload size={16} /> {logo ? t('auth.register.changeLogo') : t('auth.register.logoOptional')}
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onLogo} data-testid="logo-input" />
                  </label>
                  {logo && (
                    <button type="button" onClick={() => { setLogo(null); setPreview(null); }} className="ml-2 text-sm text-red-600 inline-flex items-center gap-1">
                      <X size={14} /> {t('common.remove')}
                    </button>
                  )}
                  <p className="text-xs text-gray-500 mt-1">{t('auth.register.logoHint')}</p>
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{IDENTITY[type].map(field)}</div>
          </Section>

          <Section icon={FileText} title={t('auth.register.bank')}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{BANK.map(field)}</div>
          </Section>

          <Section icon={MapPin} title={t('auth.register.locations')} hint={t('auth.register.locationsHint')}>
            <MultiCheckList options={refs.locations} value={locationIds} error={errors.locations} testId="locations"
              onChange={(v) => { setLocationIds(v); setErrors(e => ({ ...e, locations: '' })); }} />
          </Section>

          <Section icon={Tags} title={t('auth.register.categories')} hint={t('auth.register.categoriesHint')}>
            <MultiCheckList options={refs.categories} value={categoryIds} error={errors.categories} testId="categories"
              onChange={(v) => { setCategoryIds(v); setErrors(e => ({ ...e, categories: '' })); }} />
          </Section>

          <Section icon={FileText} title={t('auth.register.documents')}
            hint={t('auth.register.documentsHint', { formats: t(type === 'COMPANY' ? 'auth.register.formatsCompany' : 'auth.register.formatsIndividual') })}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {EXPECTED_DOCS[type].map(dt => (
                <DocumentField key={dt} type={dt} file={docs[dt]} onFile={(dt, f) => setDocs(d => ({ ...d, [dt]: f }))} />
              ))}
            </div>
          </Section>

          <Section icon={UserPlus} title={t('auth.register.account')}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{ACCOUNT.map(field)}</div>
          </Section>

          <button type="submit" disabled={submitting}
            className="w-full btn-primary flex items-center justify-center gap-2 py-2 px-4 text-white rounded-lg disabled:opacity-50">
            {submitting ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" /> : <UserPlus size={18} />}
            {submitting ? t('auth.register.creating') : t('auth.register.submit')}
          </button>
          <p className="text-center text-sm text-gray-600">
            {t('auth.register.alreadyRegistered')} <Link to="/login" className="text-blue-600 hover:text-blue-800">{t('auth.login')}</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
