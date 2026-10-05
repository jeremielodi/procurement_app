// src/components/Admin/ReferenceData.jsx — super admin : localisations (bureaux) et catégories de marché
import React, { useEffect, useState } from 'react';
import { MapPin, Tags, Plus, Pencil, Trash2, Check, X, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { locationService, categoryService } from '../../services/referenceService';

const TABS = {
  locations: {
    label: 'Localisations', icon: MapPin, service: locationService,
    intro: 'Bureaux et zones de livraison. Les fournisseurs choisissent à l\'inscription les localisations qu\'ils desservent ; un appel d\'offres peut être limité à une localisation.',
    extra: { key: 'province', label: 'Province' },
  },
  categories: {
    label: 'Catégories de marché', icon: Tags, service: categoryService,
    intro: 'Les fournisseurs déclarent les catégories qu\'ils fournissent ; chaque entreprise les préqualifie catégorie par catégorie.',
    extra: { key: 'description', label: 'Description' },
  },
};

const inputCls = 'w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function ReferenceData() {
  const [tab, setTab] = useState('locations');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ name: '', extra: '' });
  const [editing, setEditing] = useState(null); // { id, name, extra }
  const cfg = TABS[tab];

  const load = async () => {
    setLoading(true);
    try {
      setRows((await cfg.service.list(true)).data || []);
    } catch (_) { /* toast */ } finally {
      setLoading(false);
    }
  };
  useEffect(() => { setEditing(null); setDraft({ name: '', extra: '' }); load(); }, [tab]);

  const add = async (e) => {
    e.preventDefault();
    if (!draft.name.trim()) return;
    try {
      await cfg.service.create({ name: draft.name, [cfg.extra.key]: draft.extra });
      toast.success(`${draft.name} ajouté(e)`);
      setDraft({ name: '', extra: '' });
      load();
    } catch (_) { /* toast */ }
  };

  const saveEdit = async () => {
    try {
      await cfg.service.update(editing.id, { name: editing.name, [cfg.extra.key]: editing.extra });
      setEditing(null);
      load();
    } catch (_) { /* toast */ }
  };

  const toggle = async (row) => {
    try {
      await cfg.service.update(row.id, { isActive: !row.is_active });
      load();
    } catch (_) { /* toast */ }
  };

  const remove = async (row) => {
    if (!window.confirm(`Supprimer « ${row.name} » ?`)) return;
    try {
      await cfg.service.remove(row.id);
      toast.success('Supprimé');
      load();
    } catch (_) { /* toast : utilisé → désactiver */ }
  };

  return (
    <div className="p-6 max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Référentiels de la plateforme</h1>
        <p className="text-sm text-gray-500">Communs à toutes les entreprises et à tous les fournisseurs</p>
      </div>

      <div className="flex gap-2 border-b">
        {Object.entries(TABS).map(([k, t]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-gray-600">{cfg.intro}</p>

      <form onSubmit={add} className="flex flex-wrap gap-2 bg-white border border-gray-200 rounded-lg p-3">
        <input className={`${inputCls} flex-1 min-w-[200px]`} placeholder="Nom" value={draft.name}
          onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} data-testid="ref-name" />
        <input className={`${inputCls} flex-1 min-w-[160px]`} placeholder={cfg.extra.label} value={draft.extra}
          onChange={e => setDraft(d => ({ ...d, extra: e.target.value }))} />
        <button type="submit" disabled={!draft.name.trim()}
          className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded text-sm disabled:opacity-50">
          <Plus size={16} /> Ajouter
        </button>
      </form>

      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        {loading ? (
          <div className="flex justify-center p-8"><RefreshCw className="animate-spin text-blue-500" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-left">
              <tr>
                <th className="px-4 py-2">Nom</th>
                <th className="px-4 py-2">{cfg.extra.label}</th>
                <th className="px-4 py-2 text-right">Fournisseurs</th>
                <th className="px-4 py-2">Statut</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(row => editing?.id === row.id ? (
                <tr key={row.id} className="bg-blue-50">
                  <td className="px-4 py-2"><input className={inputCls} value={editing.name} onChange={e => setEditing(x => ({ ...x, name: e.target.value }))} /></td>
                  <td className="px-4 py-2"><input className={inputCls} value={editing.extra} onChange={e => setEditing(x => ({ ...x, extra: e.target.value }))} /></td>
                  <td className="px-4 py-2 text-right">{row.supplier_count}</td>
                  <td />
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button onClick={saveEdit} className="p-1.5 text-green-700 hover:bg-green-100 rounded" title="Enregistrer"><Check size={16} /></button>
                    <button onClick={() => setEditing(null)} className="p-1.5 text-gray-600 hover:bg-gray-100 rounded" title="Annuler"><X size={16} /></button>
                  </td>
                </tr>
              ) : (
                <tr key={row.id} className={row.is_active ? '' : 'text-gray-400'}>
                  <td className="px-4 py-2 font-medium">{row.name}</td>
                  <td className="px-4 py-2">{row[cfg.extra.key] || '—'}</td>
                  <td className="px-4 py-2 text-right">{row.supplier_count}</td>
                  <td className="px-4 py-2">
                    <button onClick={() => toggle(row)}
                      className={`px-2 py-0.5 rounded-full text-xs ${row.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}
                      title={row.is_active ? 'Désactiver (masqué à l\'inscription)' : 'Réactiver'}>
                      {row.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button onClick={() => setEditing({ id: row.id, name: row.name, extra: row[cfg.extra.key] || '' })}
                      className="p-1.5 text-gray-600 hover:bg-gray-100 rounded" title="Modifier"><Pencil size={16} /></button>
                    <button onClick={() => remove(row)} className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                      title="Supprimer (uniquement si jamais utilisé)"><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">Aucun élément</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
