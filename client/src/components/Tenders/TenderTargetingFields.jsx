// Diffusion d'un appel d'offres :
//  - ouvert à tous les fournisseurs
//  - réservé : l'acheteur SÉLECTIONNE les fournisseurs invités parmi les préqualifiés de la catégorie
//    (et de la localisation) ; seuls eux sont notifiés et voient l'AO dans leur portail
import { useEffect, useState } from 'react';
import { Globe, BadgeCheck, Users, Building2, User, Lock } from 'lucide-react';
import { locationService, categoryService } from '../../services/referenceService';
import { tenderService } from '../../services/tenderService';
import { t, labelMap, useTranslation } from '../../i18n';
import SearchSelect from '../Common/SearchSelect';

const selectCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';

export const AUDIENCE_LABELS = labelMap('tenders.audience', ['ALL', 'PREQUALIFIED']);

/**
 * value = { audience, categoryId, locationId, supplierIds }
 * lockedIds : invités qui ont déjà soumis (ne peuvent plus être retirés)
 */
export default function TenderTargetingFields({ value, onChange, lockedIds = [] }) {
  const [refs, setRefs] = useState({ locations: [], categories: [] });
  const [count, setCount] = useState(null);
  const [candidates, setCandidates] = useState(null);
  const set = (patch) => onChange({ ...value, ...patch });
  const reserved = value.audience === 'PREQUALIFIED';
  const selected = new Set((value.supplierIds || []).map(Number));
  const locked = new Set(lockedIds.map(Number));

  const { lang } = useTranslation();
  useEffect(() => {
    Promise.all([locationService.list(), categoryService.list()])
      .then(([l, c]) => setRefs({ locations: l.data || [], categories: c.data || [] }))
      .catch(() => {});
  }, [lang]);

  // Diffusion « tous » : nombre de fournisseurs notifiés
  useEffect(() => {
    if (reserved) { setCount(null); return; }
    tenderService.eligibleCount({ audience: 'ALL' }).then(r => setCount(r.data.count)).catch(() => setCount(null));
  }, [reserved]);

  // Diffusion réservée : préqualifiés invitables ; la sélection est limitée aux candidats (+ invités verrouillés)
  useEffect(() => {
    if (!reserved || !value.categoryId) { setCandidates(null); return; }
    tenderService.getCandidates({ categoryId: value.categoryId, locationId: value.locationId })
      .then(r => {
        const list = r.data || [];
        setCandidates(list);
        const allowed = new Set([...list.map(c => c.id), ...locked]);
        const kept = (value.supplierIds || []).map(Number).filter(id => allowed.has(id));
        if (kept.length !== (value.supplierIds || []).length) set({ supplierIds: kept });
      })
      .catch(() => setCandidates([]));
  }, [reserved, value.categoryId, value.locationId]);

  const toggle = (id) => {
    if (locked.has(id)) return;
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    set({ supplierIds: [...next] });
  };
  const selectable = (candidates || []).filter(c => c.has_account);
  const allSelected = selectable.length > 0 && selectable.every(c => selected.has(c.id));
  const toggleAll = () => set({
    supplierIds: allSelected ? [...locked] : [...new Set([...locked, ...selectable.map(c => c.id)])],
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3" role="radiogroup" aria-label={t('tenders.diffusion')}>
        {[['ALL', Globe, t('tenders.audienceHint.ALL')],
          ['PREQUALIFIED', BadgeCheck, t('tenders.audienceHint.PREQUALIFIED')]].map(([v, Icon, hint]) => (
          <button key={v} type="button" role="radio" aria-checked={value.audience === v} onClick={() => set({ audience: v })}
            className={`flex items-start gap-3 p-3 border-2 rounded-lg text-left ${value.audience === v ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
            <Icon size={20} className={`mt-0.5 ${value.audience === v ? 'text-blue-600' : 'text-gray-400'}`} />
            <span><span className="block text-sm font-medium text-gray-900">{AUDIENCE_LABELS[v]}</span><span className="block text-xs text-gray-500">{hint}</span></span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="categoryId">
            {t('tenders.category')} {reserved && '*'}
          </label>
          <SearchSelect id="categoryId" className={selectCls} value={value.categoryId || ''} onChange={e => set({ categoryId: e.target.value })}>
            <option value="">{t('tenders.none_option')}</option>
            {refs.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SearchSelect>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="locationId">{t('tenders.location')}</label>
          <SearchSelect id="locationId" className={selectCls} value={value.locationId || ''} onChange={e => set({ locationId: e.target.value })}>
            <option value="">{t('tenders.all_option')}</option>
            {refs.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </SearchSelect>
        </div>
      </div>

      {!reserved && count !== null && (
        <p className="text-sm flex items-center gap-1 text-gray-600">
          <Users size={14} /> {t('tenders.willNotify', { count })}
        </p>
      )}

      {reserved && !value.categoryId && (
        <p className="text-sm text-gray-500">{t('tenders.chooseCategory')}</p>
      )}

      {reserved && candidates && (
        <div data-testid="tender-candidates">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-700">
              {t('tenders.invited')} <span className="font-normal text-gray-500">{t('tenders.selectedOf', { selected: selected.size, total: candidates.length })}</span>
            </p>
            {selectable.length > 1 && (
              <button type="button" onClick={toggleAll} className="text-sm text-blue-600 hover:underline">
                {allSelected ? t('tenders.unselectAll') : t('tenders.selectAll')}
              </button>
            )}
          </div>
          {candidates.length === 0 ? (
            <p className="text-sm text-orange-600 border border-orange-200 bg-orange-50 rounded-lg p-3">
              {t(value.locationId ? 'tenders.noCandidatesLoc' : 'tenders.noCandidates')}{' '}
              {t('tenders.noCandidatesHint')}
            </p>
          ) : (
            <div className="border border-gray-200 rounded-lg divide-y max-h-72 overflow-y-auto">
              {candidates.map(c => {
                const isLocked = locked.has(c.id);
                const disabled = isLocked || !c.has_account;
                return (
                  <label key={c.id} className={`flex items-center gap-3 px-3 py-2 text-sm ${disabled ? 'opacity-70' : 'cursor-pointer hover:bg-gray-50'}`}>
                    <input type="checkbox" checked={selected.has(c.id)} disabled={disabled} onChange={() => toggle(c.id)}
                      className="rounded border-gray-300 text-blue-600" />
                    {c.supplier_type === 'INDIVIDUAL' ? <User size={14} className="text-gray-400" /> : <Building2 size={14} className="text-gray-400" />}
                    <span className="flex-1 min-w-0">
                      <span className="font-medium text-gray-900">{c.name}</span>
                      <span className="text-gray-400 font-mono text-xs ml-2">{c.supplier_code}</span>
                      <span className="block text-xs text-gray-500 truncate">{(c.location_names || []).join(', ')}</span>
                    </span>
                    {isLocked && <span className="text-xs text-green-700 flex items-center gap-1"><Lock size={12} /> {t('tenders.submitted')}</span>}
                    {!c.has_account && <span className="text-xs text-gray-500">{t('tenders.noAccount')}</span>}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
