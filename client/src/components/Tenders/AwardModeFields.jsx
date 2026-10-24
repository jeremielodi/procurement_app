// src/components/Tenders/AwardModeFields.jsx
// Mode d'attribution d'un appel d'offres, annoncé aux fournisseurs dès la publication :
//   SINGLE   : un seul attributaire pour tous les articles
//   PER_ITEM : chaque article attribué à la meilleure offre pour cet article (plusieurs fournisseurs possibles,
//              une commande par fournisseur). Ne change plus une fois une offre déposée.
import { t } from '../../i18n';

export const AWARD_MODES = ['SINGLE', 'PER_ITEM'];

export default function AwardModeFields({ value, onChange, locked = false }) {
  return (
    <div className="space-y-2" data-testid="award-mode">
      <div className="text-sm font-medium text-gray-700">{t('tenders.awardMode.label')}</div>
      {AWARD_MODES.map(mode => (
        <label key={mode} className={`flex items-start gap-3 p-3 border rounded-lg ${locked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'} ${value === mode ? 'border-blue-400 bg-blue-50/40' : ''}`}>
          <input
            type="radio"
            name="awardMode"
            value={mode}
            data-testid={`award-mode-${mode}`}
            disabled={locked}
            checked={value === mode}
            onChange={() => onChange(mode)}
            className="mt-0.5"
          />
          <div>
            <span className="font-medium text-sm">{t(`tenders.awardMode.${mode}`)}</span>
            <p className="text-xs text-gray-500">{t(`tenders.awardMode.${mode}_help`)}</p>
          </div>
        </label>
      ))}
      {locked && <p className="text-xs text-amber-700">{t('tenders.awardMode.locked')}</p>}
    </div>
  );
}
