// src/components/SupplierPortal/SupplierProfile.jsx
// Profil du fournisseur connecté : identité, RIB, localisations, catégories et documents de préqualification.
import { useState, useEffect } from 'react';
import { Building2, User, Upload, Save, RefreshCw, MapPin, Tags, FileText, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { supplierPortalService, supplierLogoUrl } from '../../services/supplierPortalService';
import { locationService, categoryService } from '../../services/referenceService';
import { EXPECTED_DOCS, DOC_LABELS, SUPPLIER_TYPE_LABELS, openDocument } from '../../utils/supplierDocs';
import MultiCheckList from '../Suppliers/prequal/MultiCheckList';
import DocumentField from '../Suppliers/prequal/DocumentField';
import { t, useTranslation } from '../../i18n';

// [clé API, libellé (clé de traduction), colonne, types concernés]
const FIELDS = [
  ['name', 'supplierFields.nameOrFull', 'name', ['COMPANY', 'INDIVIDUAL']],
  ['contactName', 'supplierFields.contactName', 'contact_name', ['COMPANY']],
  ['phone', 'supplierFields.phone', 'phone', ['COMPANY', 'INDIVIDUAL']],
  ['website', 'supplierFields.website', 'website', ['COMPANY']],
  ['registrationNumber', 'supplierFields.registrationNumber', 'registration_number', ['COMPANY']],
  ['taxId', 'supplierFields.taxId', 'tax_id', ['COMPANY']],
  ['idNat', 'supplierFields.idNat', 'id_nat', ['COMPANY']],
  ['idDocumentNumber', 'supplierFields.idDocumentNumber', 'id_document_number', ['COMPANY', 'INDIVIDUAL']],
  ['address', 'supplierFields.address', 'address', ['COMPANY', 'INDIVIDUAL']],
  ['bankName', 'supplierFields.bankName', 'bank_name', ['COMPANY', 'INDIVIDUAL']],
  ['bankAccount', 'supplierFields.bankAccount', 'bank_account', ['COMPANY', 'INDIVIDUAL']],
  ['bankIban', 'supplierFields.bankIban', 'bank_iban', ['COMPANY', 'INDIVIDUAL']],
  ['bankSwift', 'supplierFields.swift', 'bank_swift', ['COMPANY', 'INDIVIDUAL']],
];

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const Card = ({ icon: Icon, title, hint, children }) => (
  <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
    <div>
      <h2 className="font-semibold text-gray-800 flex items-center gap-2"><Icon size={18} className="text-blue-600" />{title}</h2>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
    {children}
  </div>
);

export default function SupplierProfile() {
  const [supplier, setSupplier] = useState(null);
  const [type, setType] = useState('COMPANY');
  const [form, setForm] = useState({});
  const [locationIds, setLocationIds] = useState([]);
  const [categoryIds, setCategoryIds] = useState([]);
  const [newDocs, setNewDocs] = useState({});
  const [refs, setRefs] = useState({ locations: [], categories: [] });
  const [logo, setLogo] = useState(null);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);

  const hydrate = (s) => {
    setSupplier(s);
    setType(s.supplier_type || 'COMPANY');
    setForm(Object.fromEntries(FIELDS.map(([k, , col]) => [k, s[col] || ''])));
    setLocationIds((s.locations || []).map(l => l.id));
    setCategoryIds((s.categories || []).map(c => c.id));
    setNewDocs({});
    setLogo(null);
    setPreview(null);
  };

  const { lang } = useTranslation();
  useEffect(() => {
    supplierPortalService.getMe().then(r => hydrate(r.data)).catch(() => {});
  }, []);
  // Catégories traduites par le serveur : rechargées au changement de langue (sans toucher au formulaire)
  useEffect(() => {
    Promise.all([locationService.listPublic(), categoryService.listPublic()])
      .then(([l, c]) => setRefs({ locations: l.data || [], categories: c.data || [] }))
      .catch(() => {});
  }, [lang]);
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  if (!supplier) return <div className="flex justify-center items-center h-64"><RefreshCw className="animate-spin text-blue-500" /></div>;

  const onLogo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return toast.error(t('portal.logoFormat'));
    if (file.size > 2 * 1024 * 1024) return toast.error(t('auth.register.logoSize'));
    setLogo(file);
    setPreview(URL.createObjectURL(file));
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error(t('portal.nameRequired'));
    if (!locationIds.length) return toast.error(t('auth.register.selectLocation'));
    if (!categoryIds.length) return toast.error(t('portal.selectCategory'));
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('supplierType', type);
      FIELDS.filter(([, , , types]) => types.includes(type)).forEach(([k]) => fd.append(k, form[k] ?? ''));
      fd.append('locationIds', JSON.stringify(locationIds));
      fd.append('categoryIds', JSON.stringify(categoryIds));
      Object.entries(newDocs).forEach(([dt, f]) => fd.append(`doc_${dt}`, f));
      if (logo) fd.append('logo', logo);
      const res = await supplierPortalService.updateMe(fd);
      hydrate(res.data);
      toast.success(t('portal.updated'));
    } catch (_) { /* toast */ } finally {
      setSaving(false);
    }
  };

  const logoSrc = preview || supplierLogoUrl(supplier);
  const docsByType = Object.fromEntries((supplier.documents || []).map(d => [d.doc_type, d]));
  const stillMissing = EXPECTED_DOCS[type].filter(dt => !docsByType[dt] && !newDocs[dt]);

  return (
    <form onSubmit={save} className="p-6 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('portal.profileTitle')}</h1>
        <p className="text-gray-500 text-sm">{t('portal.codeLine')} <span className="font-mono">{supplier.supplier_code}</span> · {supplier.email}</p>
      </div>

      {stillMissing.length > 0 && (
        <div className="flex gap-3 p-4 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <p>{t('portal.docsMissing')}{' '}
            <b>{stillMissing.map(dt => DOC_LABELS[dt]).join(', ')}</b>.</p>
        </div>
      )}

      <Card icon={type === 'COMPANY' ? Building2 : User} title={t('portal.identity')}>
        <div className="flex gap-2">
          {['COMPANY', 'INDIVIDUAL'].map(v => (
            <button key={v} type="button" onClick={() => setType(v)}
              className={`px-3 py-1.5 rounded-lg text-sm border ${type === v ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600'}`}>
              {SUPPLIER_TYPE_LABELS[v]}
            </button>
          ))}
        </div>
        {type === 'COMPANY' && (
          <div className="flex items-center gap-5">
            <div className="w-24 h-24 rounded-lg border border-gray-200 flex items-center justify-center bg-gray-50 overflow-hidden">
              {logoSrc ? <img src={logoSrc} alt="Logo" className="max-w-full max-h-full object-contain" /> : <Building2 size={32} className="text-gray-300" />}
            </div>
            <div>
              <label className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm cursor-pointer hover:bg-gray-50">
                <Upload size={16} /> {t('portal.changeLogo')}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onLogo} />
              </label>
              <p className="text-xs text-gray-500 mt-1">{t('portal.logoHint')}</p>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {FIELDS.filter(([, , , types]) => types.includes(type)).map(([k, label]) => (
            <div key={k} className={k === 'address' ? 'md:col-span-2' : ''}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t(label)}</label>
              <input className={inputCls} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
            </div>
          ))}
        </div>
      </Card>

      <Card icon={MapPin} title={t('auth.register.locations')} hint={t('auth.register.locationsHint')}>
        <MultiCheckList options={refs.locations} value={locationIds} onChange={setLocationIds} />
      </Card>

      <Card icon={Tags} title={t('auth.register.categories')} hint={t('portal.categoriesHint')}>
        <MultiCheckList options={refs.categories} value={categoryIds} onChange={setCategoryIds} />
      </Card>

      <Card icon={FileText} title={t('auth.register.documents')} hint={t('portal.docsHint')}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {EXPECTED_DOCS[type].map(dt => (
            <DocumentField key={dt} type={dt} file={newDocs[dt]} existing={docsByType[dt]}
              onFile={(dt, f) => setNewDocs(d => ({ ...d, [dt]: f }))}
              onView={(doc) => openDocument(() => supplierPortalService.getMyDocumentBlob(doc.id))} />
          ))}
        </div>
      </Card>

      <div className="flex justify-end">
        <button type="submit" disabled={saving}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
          <Save size={16} /> {saving ? t('po.saving') : t('common.save')}
        </button>
      </div>
    </form>
  );
}
