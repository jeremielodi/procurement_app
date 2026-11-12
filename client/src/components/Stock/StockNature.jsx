// src/components/Stock/StockNature.jsx
// Nature des articles du catalogue (migration 63) : Équipement (bien durable) / Consommable.
// Module Stock seulement (la réquisition garde tout le catalogue) : VIEW_EQUIPMENT / VIEW_CONSUMABLES = voir,
// MANAGE_EQUIPMENT / MANAGE_CONSUMABLES = gérer (fiche article, entrées, sorties, inventaires…) — « gérer » vaut « voir ».
// Le serveur filtre et contrôle ; ces briques adaptent l'affichage.
import React from 'react';
import { Armchair, Package, EyeOff } from 'lucide-react';
import { usePermissions } from '../../hooks/usePermissions';
import { t } from '../../i18n';

export const NATURES = ['EQUIPMENT', 'CONSUMABLE'];
const VIEW = { EQUIPMENT: 'VIEW_EQUIPMENT', CONSUMABLE: 'VIEW_CONSUMABLES' };
const MANAGE = { EQUIPMENT: 'MANAGE_EQUIPMENT', CONSUMABLE: 'MANAGE_CONSUMABLES' };

/**
 * Natures de l'utilisateur connecté : allowed = visibles, manage = gérées (canManage(n)) ; both / manageBoth = les deux
 */
export function useStockNatures() {
  const { hasPermission } = usePermissions();
  const manage = NATURES.filter(n => hasPermission(MANAGE[n]));
  const allowed = NATURES.filter(n => hasPermission(VIEW[n]) || manage.includes(n));
  return {
    allowed, manage, both: allowed.length === NATURES.length, manageBoth: manage.length === NATURES.length,
    can: (n) => allowed.includes(n), canManage: (n) => manage.includes(n),
  };
}

const STYLES = {
  EQUIPMENT: { cls: 'bg-indigo-50 text-indigo-700 border-indigo-200', Icon: Armchair },
  CONSUMABLE: { cls: 'bg-teal-50 text-teal-700 border-teal-200', Icon: Package },
};

export function NatureBadge({ nature, className = '' }) {
  const s = STYLES[nature];
  if (!s) return null;
  const { Icon } = s;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${s.cls} ${className}`} data-testid="nature-badge" data-nature={nature}>
      <Icon size={12} /> {t(`stock.nature.${nature}`)}
    </span>
  );
}

/** Bandeau d'un document mixte : lignes d'une nature non autorisée masquées */
export function HiddenLinesNotice({ count }) {
  if (!count) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700" data-testid="hidden-lines">
      <EyeOff size={16} className="mt-0.5 shrink-0 text-gray-500" />
      <span>{t('stock.nature.hiddenLines', { count })}</span>
    </div>
  );
}

/** Choix de la nature (fiche article, ouverture d'un inventaire) : boutons ; natures non gérées désactivées */
export function NaturePicker({ value, onChange, disabledNatures = [], allowAll = false, testId = 'nature-picker' }) {
  const { canManage: can } = useStockNatures();
  const options = allowAll ? ['', ...NATURES] : NATURES;
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" data-testid={testId}>
      {options.map(n => {
        const disabled = (n && !can(n)) || disabledNatures.includes(n);
        const active = (value || '') === n;
        const Icon = n ? STYLES[n].Icon : null;
        return (
          <button key={n || 'ALL'} type="button" role="radio" aria-checked={active} disabled={disabled} data-value={n || 'ALL'}
            onClick={() => onChange(n)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${active ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'} disabled:cursor-not-allowed disabled:opacity-40`}>
            {Icon && <Icon size={14} />}
            {n ? t(`stock.nature.${n}`) : t('stock.nature.all')}
          </button>
        );
      })}
    </div>
  );
}
