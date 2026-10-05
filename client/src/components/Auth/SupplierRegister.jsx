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

// Champs par type ; req = obligatoire
const IDENTITY = {
  COMPANY: [
    { name: 'name', label: 'Raison sociale', req: true, full: true, placeholder: 'ACME SARL' },
    { name: 'contactName', label: 'Nom du contact (représentant)', req: true, placeholder: 'Prénom Nom' },
    { name: 'phone', label: 'Téléphone', req: true, placeholder: '+243 …' },
    { name: 'registrationNumber', label: 'N° RCCM', req: true },
    { name: 'taxId', label: "N° d'impôt (NIF)", req: true },
    { name: 'idNat', label: 'N° ID Nat', req: true },
    { name: 'idDocumentNumber', label: "N° pièce d'identité du représentant" },
    { name: 'website', label: 'Site web', placeholder: 'https://…' },
    { name: 'address', label: 'Adresse', req: true, full: true, textarea: true },
  ],
  INDIVIDUAL: [
    { name: 'name', label: 'Nom complet', req: true, full: true, placeholder: 'Prénom Nom' },
    { name: 'phone', label: 'Téléphone', placeholder: '+243 …' },
    { name: 'idDocumentNumber', label: "N° pièce d'identité" },
    { name: 'address', label: 'Adresse', req: true, full: true, textarea: true },
  ],
};
const BANK = [
  { name: 'bankName', label: 'Banque', req: true },
  { name: 'bankAccount', label: 'N° de compte', req: true },
  { name: 'bankIban', label: 'IBAN' },
  { name: 'bankSwift', label: 'Code SWIFT' },
];
const ACCOUNT = [
  { name: 'email', label: 'Email (identifiant de connexion)', req: true, type: 'email', full: true, placeholder: 'contact@entreprise.com' },
  { name: 'password', label: 'Mot de passe (8 caractères min.)', req: true, type: 'password' },
  { name: 'confirmPassword', label: 'Confirmer le mot de passe', req: true, type: 'password' },
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

  useEffect(() => {
    Promise.all([locationService.listPublic(), categoryService.listPublic()])
      .then(([l, c]) => setRefs({ locations: l.data || [], categories: c.data || [] }))
      .catch(() => {});
  }, []);
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const set = (name, value) => {
    setForm(f => ({ ...f, [name]: value }));
    if (errors[name]) setErrors(e => ({ ...e, [name]: '' }));
  };

  const onLogo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return toast.error('Logo : PNG, JPG ou WEBP uniquement');
    if (file.size > 2 * 1024 * 1024) return toast.error('Logo trop volumineux (2 Mo maximum)');
    setLogo(file);
    setPreview(URL.createObjectURL(file));
  };

  const validate = () => {
    const e = {};
    for (const f of [...IDENTITY[type], ...BANK, ...ACCOUNT]) {
      if (f.req && !String(form[f.name] || '').trim()) e[f.name] = 'Requis';
    }
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) e.email = 'Email invalide';
    if (form.password && form.password.length < 8) e.password = '8 caractères minimum';
    if (form.password !== form.confirmPassword) e.confirmPassword = 'Les mots de passe ne correspondent pas';
    if (!locationIds.length) e.locations = 'Sélectionnez au moins une localisation';
    if (!categoryIds.length) e.categories = 'Sélectionnez au moins une catégorie';
    setErrors(e);
    if (Object.keys(e).length) toast.error('Formulaire incomplet : vérifiez les champs en rouge');
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
      for (const t of EXPECTED_DOCS[type]) if (docs[t]) fd.append(`doc_${t}`, docs[t]);
      if (logo && type === 'COMPANY') fd.append('logo', logo);
      const res = await supplierPortalService.register(fd);
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      toast.success(`Compte créé — code fournisseur ${res.data.supplierCode}`);
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
        {f.label}{f.req && <span className="text-red-500"> *</span>}
      </label>
      {f.textarea ? (
        <textarea id={`f-${f.name}`} rows={2} value={form[f.name] || ''} onChange={e => set(f.name, e.target.value)}
          className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${errors[f.name] ? 'border-red-500' : 'border-gray-300'}`} />
      ) : (
        <input id={`f-${f.name}`} name={f.name} type={f.type || 'text'} placeholder={f.placeholder}
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
          <center><img src="/images/procureapp-logo.svg" style={{ height: 52 }} alt="procureApp" /></center>
          <h1 className="text-2xl font-bold text-white">procureApp — Portail fournisseur</h1>
          <p className="text-blue-100 mt-2">Un seul compte pour répondre aux demandes de toutes les entreprises de la plateforme</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6" noValidate>
          {/* Type de fournisseur */}
          <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Type de fournisseur">
            {[['COMPANY', Building2, 'Entreprise', 'Société, ONG, établissement'], ['INDIVIDUAL', User, 'Personne physique', 'Prestataire individuel']].map(([v, Icon, label, hint]) => (
              <button key={v} type="button" role="radio" aria-checked={type === v} onClick={() => { setType(v); setErrors({}); }}
                className={`flex items-center gap-3 p-3 border-2 rounded-lg text-left ${type === v ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <Icon size={24} className={type === v ? 'text-blue-600' : 'text-gray-400'} />
                <span><span className="block font-medium text-gray-900">{label}</span><span className="block text-xs text-gray-500">{hint}</span></span>
              </button>
            ))}
          </div>

          <Section icon={type === 'COMPANY' ? Building2 : User} title={type === 'COMPANY' ? "Identité de l'entreprise" : 'Identité'}>
            {type === 'COMPANY' && (
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center bg-gray-50 overflow-hidden">
                  {preview ? <img src={preview} alt="Logo" className="max-w-full max-h-full object-contain" /> : <Building2 size={28} className="text-gray-300" />}
                </div>
                <div>
                  <label className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm cursor-pointer hover:bg-gray-50">
                    <Upload size={16} /> {logo ? 'Changer le logo' : 'Logo (facultatif)'}
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onLogo} data-testid="logo-input" />
                  </label>
                  {logo && (
                    <button type="button" onClick={() => { setLogo(null); setPreview(null); }} className="ml-2 text-sm text-red-600 inline-flex items-center gap-1">
                      <X size={14} /> Retirer
                    </button>
                  )}
                  <p className="text-xs text-gray-500 mt-1">PNG, JPG ou WEBP — 2 Mo max. Il apparaîtra sur vos offres PDF.</p>
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{IDENTITY[type].map(field)}</div>
          </Section>

          <Section icon={FileText} title="Coordonnées bancaires (RIB)">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{BANK.map(field)}</div>
          </Section>

          <Section icon={MapPin} title="Localisations" hint="Où vous pouvez livrer ou avez des bureaux">
            <MultiCheckList options={refs.locations} value={locationIds} error={errors.locations} testId="locations"
              onChange={(v) => { setLocationIds(v); setErrors(e => ({ ...e, locations: '' })); }} />
          </Section>

          <Section icon={Tags} title="Catégories de marché" hint="Ce que vous fournissez — vous serez préqualifié catégorie par catégorie">
            <MultiCheckList options={refs.categories} value={categoryIds} error={errors.categories} testId="categories"
              onChange={(v) => { setCategoryIds(v); setErrors(e => ({ ...e, categories: '' })); }} />
          </Section>

          <Section icon={FileText} title="Documents de préqualification"
            hint={`Facultatifs, mais ils facilitent votre préqualification — vous pourrez les ajouter plus tard depuis votre profil. ${type === 'COMPANY' ? "PDF (pièce d'identité : PDF, JPG ou PNG)" : "Pièce d'identité : PDF, JPG ou PNG ; RIB : PDF"} — 5 Mo max. chacun`}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {EXPECTED_DOCS[type].map(t => (
                <DocumentField key={t} type={t} file={docs[t]} onFile={(dt, f) => setDocs(d => ({ ...d, [dt]: f }))} />
              ))}
            </div>
          </Section>

          <Section icon={UserPlus} title="Compte">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{ACCOUNT.map(field)}</div>
          </Section>

          <button type="submit" disabled={submitting}
            className="w-full btn-primary flex items-center justify-center gap-2 py-2 px-4 text-white rounded-lg disabled:opacity-50">
            {submitting ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" /> : <UserPlus size={18} />}
            {submitting ? 'Création…' : 'Créer mon compte fournisseur'}
          </button>
          <p className="text-center text-sm text-gray-600">
            Déjà inscrit ? <Link to="/login" className="text-blue-600 hover:text-blue-800">Se connecter</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
