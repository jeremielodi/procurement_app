// src/components/Enterprises/EnterpriseList.jsx — super admin : entreprises de la plateforme
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Search, RefreshCw, Users, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import EnterpriseInfoForm from './EnterpriseInfoForm';
import { enterpriseService } from '../../services/enterpriseService';
import { enterpriseLogoUrl } from '../../contexts/EnterpriseContext';

export default function EnterpriseList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['enterprises', search],
    queryFn: () => enterpriseService.getAll({ search: search || undefined }),
  });
  const enterprises = data?.data || [];

  const create = async (form, logo) => {
    setSaving(true);
    try {
      const res = await enterpriseService.create(form, logo);
      toast.success(res.data.admin ? `Entreprise créée — administrateur ${res.data.admin.email}` : 'Entreprise créée');
      setCreating(false);
      queryClient.invalidateQueries(['enterprises']);
      navigate(`/admin/enterprises/${res.data.id}`);
    } catch (_) { /* toast via intercepteur */ } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Entreprises</h1>
          <p className="text-gray-500 text-sm">Entreprises clientes de la plateforme procureApp. Chaque entreprise ne voit que ses propres données.</p>
        </div>
        <button onClick={() => setCreating(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          <Plus size={16} /> Nouvelle entreprise
        </button>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Nom ou code…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button onClick={() => refetch()} className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50">
          <RefreshCw size={16} className={isFetching ? 'animate-spin text-blue-500' : 'text-gray-500'} />
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center items-center h-40"><RefreshCw className="animate-spin text-blue-500" /></div>
        ) : enterprises.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-gray-400"><Building2 size={36} className="mb-2 opacity-40" />Aucune entreprise</div>
        ) : (
          <table className="w-full text-sm" data-testid="enterprise-table">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Entreprise', 'Code', 'Devise', 'Utilisateurs', 'Réquisitions', 'Statut'].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {enterprises.map(e => {
                const logo = enterpriseLogoUrl(e);
                return (
                  <tr key={e.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/admin/enterprises/${e.id}`)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded border border-gray-200 bg-white flex items-center justify-center overflow-hidden">
                          {logo ? <img src={logo} alt="" className="max-w-full max-h-full object-contain" /> : <Building2 size={18} className="text-gray-300" />}
                        </div>
                        <div>
                          <div className="font-medium text-gray-900">{e.name}</div>
                          {e.email && <div className="text-xs text-gray-500">{e.email}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-700">{e.code}</td>
                    <td className="px-4 py-3 text-gray-600">{e.currency_code}</td>
                    <td className="px-4 py-3 text-gray-700"><span className="inline-flex items-center gap-1"><Users size={14} /> {e.user_count}</span></td>
                    <td className="px-4 py-3 text-gray-700"><span className="inline-flex items-center gap-1"><FileText size={14} /> {e.requisition_count}</span></td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${e.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {e.is_active ? 'Active' : 'Suspendue'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal isOpen={creating} onClose={() => setCreating(false)} title="Nouvelle entreprise" size="xl" showFooter={false}>
        <div className="max-h-[70vh] overflow-y-auto pr-1">
          <EnterpriseInfoForm enterprise={null} canEditCode withAdmin submitting={saving} onSubmit={create} submitLabel="Créer l'entreprise" />
        </div>
      </Modal>
    </div>
  );
}
