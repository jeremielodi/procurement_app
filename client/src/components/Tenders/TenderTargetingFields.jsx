// Diffusion d'un appel d'offres : tous les fournisseurs ou préqualifiés seulement (catégorie + localisation)
import { useEffect, useState } from 'react';
import { Globe, BadgeCheck, Users } from 'lucide-react';
import { locationService, categoryService } from '../../services/referenceService';
import { tenderService } from '../../services/tenderService';

const selectCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';

export const AUDIENCE_LABELS = {
  ALL: 'Ouvert à tous les fournisseurs',
  PREQUALIFIED: 'Réservé aux fournisseurs préqualifiés',
};

/** value = { audience, categoryId, locationId } */
export default function TenderTargetingFields({ value, onChange }) {
  const [refs, setRefs] = useState({ locations: [], categories: [] });
  const [count, setCount] = useState(null);
  const set = (k, v) => onChange({ ...value, [k]: v });

  useEffect(() => {
    Promise.all([locationService.list(), categoryService.list()])
      .then(([l, c]) => setRefs({ locations: l.data || [], categories: c.data || [] }))
      .catch(() => {});
  }, []);

  // Nombre de fournisseurs qui verront l'AO (et seront notifiés)
  useEffect(() => {
    if (value.audience === 'PREQUALIFIED' && !value.categoryId) { setCount(null); return; }
    const t = setTimeout(() => {
      tenderService.eligibleCount(value).then(r => setCount(r.data.count)).catch(() => setCount(null));
    }, 250);
    return () => clearTimeout(t);
  }, [value.audience, value.categoryId, value.locationId]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3" role="radiogroup" aria-label="Diffusion">
        {[['ALL', Globe, 'Toutes les entreprises intéressées peuvent consulter et soumettre'],
          ['PREQUALIFIED', BadgeCheck, 'Seuls les fournisseurs préqualifiés dans la catégorie (et la localisation) le voient']].map(([v, Icon, hint]) => (
          <button key={v} type="button" role="radio" aria-checked={value.audience === v} onClick={() => set('audience', v)}
            className={`flex items-start gap-3 p-3 border-2 rounded-lg text-left ${value.audience === v ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
            <Icon size={20} className={`mt-0.5 ${value.audience === v ? 'text-blue-600' : 'text-gray-400'}`} />
            <span><span className="block text-sm font-medium text-gray-900">{AUDIENCE_LABELS[v]}</span><span className="block text-xs text-gray-500">{hint}</span></span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="categoryId">
            Catégorie de marché {value.audience === 'PREQUALIFIED' && '*'}
          </label>
          <select id="categoryId" className={selectCls} value={value.categoryId || ''} onChange={e => set('categoryId', e.target.value)}>
            <option value="">— Aucune —</option>
            {refs.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="locationId">Localisation (livraison)</label>
          <select id="locationId" className={selectCls} value={value.locationId || ''} onChange={e => set('locationId', e.target.value)}>
            <option value="">— Toutes —</option>
            {refs.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      </div>
      {count !== null && (
        <p className={`text-sm flex items-center gap-1 ${count === 0 ? 'text-orange-600' : 'text-gray-600'}`}>
          <Users size={14} />
          {count === 0
            ? 'Aucun fournisseur ne correspond : personne ne pourra soumettre.'
            : `${count} fournisseur(s) pourront voir cet appel d'offres et seront notifiés.`}
        </p>
      )}
    </div>
  );
}
