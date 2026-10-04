// src/components/Auth/SupplierRegister.jsx
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Upload, AlertCircle, UserPlus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supplierPortalService } from '../../services/supplierPortalService';

const FIELDS = [
  { name: 'name', label: "Nom de l'entreprise *", placeholder: 'ACME SARL', full: true },
  { name: 'contactName', label: 'Nom du contact *', placeholder: 'Prénom Nom' },
  { name: 'phone', label: 'Téléphone', placeholder: '+243 …' },
  { name: 'email', label: 'Email *', type: 'email', placeholder: 'contact@entreprise.com' },
  { name: 'website', label: 'Site web', placeholder: 'https://…' },
  { name: 'registrationNumber', label: 'RCCM / N° registre' },
  { name: 'taxId', label: 'N° impôt / NIF' },
  { name: 'address', label: 'Adresse', full: true, textarea: true },
  { name: 'password', label: 'Mot de passe * (8 caractères min.)', type: 'password' },
  { name: 'confirmPassword', label: 'Confirmer le mot de passe *', type: 'password' },
];

export default function SupplierRegister() {
  const [form, setForm] = useState({});
  const [logo, setLogo] = useState(null);
  const [preview, setPreview] = useState(null);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const set = (name, value) => {
    setForm(f => ({ ...f, [name]: value }));
    if (errors[name]) setErrors(e => ({ ...e, [name]: '' }));
  };

  const onLogo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error('Logo : PNG, JPG ou WEBP uniquement');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Logo trop volumineux (2 Mo maximum)');
      return;
    }
    setLogo(file);
    setPreview(URL.createObjectURL(file));
  };

  const validate = () => {
    const e = {};
    if (!form.name?.trim()) e.name = 'Requis';
    if (!form.contactName?.trim()) e.contactName = 'Requis';
    if (!/^\S+@\S+\.\S+$/.test(form.email || '')) e.email = 'Email invalide';
    if (!form.password || form.password.length < 8) e.password = '8 caractères minimum';
    if (form.password !== form.confirmPassword) e.confirmPassword = 'Les mots de passe ne correspondent pas';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => k !== 'confirmPassword' && v && fd.append(k, v));
      if (logo) fd.append('logo', logo);
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

  return (
    <div className="min-h-screen login-bg-color flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-white rounded-lg shadow-xl overflow-hidden">
        <div className="p-6 text-center login-card-header-bg">
          <center><img src="/images/procureapp-logo.svg" style={{ height: 52 }} alt="procureApp" /></center>
          <h1 className="text-2xl font-bold text-white">procureApp — Portail fournisseur</h1>
          <p className="text-blue-100 mt-2">Un seul compte pour répondre aux appels d'offres de toutes les entreprises de la plateforme</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Logo */}
          <div className="flex items-center gap-4">
            <div className="w-24 h-24 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center bg-gray-50 overflow-hidden">
              {preview
                ? <img src={preview} alt="Logo" className="max-w-full max-h-full object-contain" />
                : <Building2 size={32} className="text-gray-300" />}
            </div>
            <div>
              <label className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm cursor-pointer hover:bg-gray-50">
                <Upload size={16} /> {logo ? 'Changer le logo' : "Logo de l'entreprise"}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onLogo} data-testid="logo-input" />
              </label>
              {logo && (
                <button type="button" onClick={() => { setLogo(null); setPreview(null); }}
                  className="ml-2 text-sm text-red-600 inline-flex items-center gap-1">
                  <X size={14} /> Retirer
                </button>
              )}
              <p className="text-xs text-gray-500 mt-1">PNG, JPG ou WEBP — 2 Mo max. Il apparaîtra sur vos offres PDF.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {FIELDS.map(f => (
              <div key={f.name} className={f.full ? 'md:col-span-2' : ''}>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor={`f-${f.name}`}>{f.label}</label>
                {f.textarea ? (
                  <textarea id={`f-${f.name}`} rows={2} value={form[f.name] || ''} onChange={e => set(f.name, e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
                ) : (
                  <input id={`f-${f.name}`} name={f.name} type={f.type || 'text'} placeholder={f.placeholder}
                    value={form[f.name] || ''} onChange={e => set(f.name, e.target.value)}
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${errors[f.name] ? 'border-red-500' : 'border-gray-300'}`} />
                )}
                {errors[f.name] && (
                  <p className="mt-1 text-sm text-red-500 flex items-center gap-1"><AlertCircle size={14} />{errors[f.name]}</p>
                )}
              </div>
            ))}
          </div>

          <button type="submit" disabled={submitting}
            className="w-full btn-primary flex items-center justify-center gap-2 py-2 px-4 text-white rounded-lg disabled:opacity-50">
            {submitting
              ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
              : <UserPlus size={18} />}
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
