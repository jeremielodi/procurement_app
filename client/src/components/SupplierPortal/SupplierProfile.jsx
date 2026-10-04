// src/components/SupplierPortal/SupplierProfile.jsx
import { useState, useEffect } from 'react';
import { Building2, Upload, Save, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { supplierPortalService, supplierLogoUrl } from '../../services/supplierPortalService';

const FIELDS = [
  ['name', "Nom de l'entreprise", 'name'],
  ['contactName', 'Nom du contact', 'contact_name'],
  ['phone', 'Téléphone', 'phone'],
  ['website', 'Site web', 'website'],
  ['registrationNumber', 'RCCM / N° registre', 'registration_number'],
  ['taxId', 'N° impôt / NIF', 'tax_id'],
  ['address', 'Adresse', 'address'],
  ['bankName', 'Banque', 'bank_name'],
  ['bankAccount', 'N° de compte', 'bank_account'],
  ['bankIban', 'IBAN', 'bank_iban'],
  ['bankSwift', 'SWIFT', 'bank_swift'],
];

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function SupplierProfile() {
  const [supplier, setSupplier] = useState(null);
  const [form, setForm] = useState({});
  const [logo, setLogo] = useState(null);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);

  const hydrate = (s) => {
    setSupplier(s);
    setForm(Object.fromEntries(FIELDS.map(([k, , col]) => [k, s[col] || ''])));
    setLogo(null);
    setPreview(null);
  };

  useEffect(() => { supplierPortalService.getMe().then(r => hydrate(r.data)).catch(() => {}); }, []);
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  if (!supplier) return <div className="flex justify-center items-center h-64"><RefreshCw className="animate-spin text-blue-500" /></div>;

  const onLogo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return toast.error('PNG, JPG ou WEBP uniquement');
    if (file.size > 2 * 1024 * 1024) return toast.error('Logo trop volumineux (2 Mo maximum)');
    setLogo(file);
    setPreview(URL.createObjectURL(file));
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Nom de l'entreprise requis");
    setSaving(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v ?? ''));
      if (logo) fd.append('logo', logo);
      const res = await supplierPortalService.updateMe(fd);
      hydrate(res.data);
      toast.success('Profil mis à jour');
    } catch (_) { /* toast */ } finally {
      setSaving(false);
    }
  };

  const logoSrc = preview || supplierLogoUrl(supplier);

  return (
    <form onSubmit={save} className="p-6 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Profil de l'entreprise</h1>
        <p className="text-gray-500 text-sm">Code fournisseur : <span className="font-mono">{supplier.supplier_code}</span> · {supplier.email}</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-5">
        <div className="w-28 h-28 rounded-lg border border-gray-200 flex items-center justify-center bg-gray-50 overflow-hidden">
          {logoSrc ? <img src={logoSrc} alt="Logo" className="max-w-full max-h-full object-contain" /> : <Building2 size={36} className="text-gray-300" />}
        </div>
        <div>
          <label className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm cursor-pointer hover:bg-gray-50">
            <Upload size={16} /> Changer le logo
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onLogo} />
          </label>
          <p className="text-xs text-gray-500 mt-1">Affiché sur vos offres PDF. PNG, JPG ou WEBP — 2 Mo max.</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        {FIELDS.map(([k, label]) => (
          <div key={k} className={k === 'address' ? 'md:col-span-2' : ''}>
            <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
            <input className={inputCls} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={saving}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
          <Save size={16} /> {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </form>
  );
}
