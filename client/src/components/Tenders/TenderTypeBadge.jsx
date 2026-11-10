// src/components/Tenders/TenderTypeBadge.jsx
// Appel d'offres (RFP) ou demande de cotations (RFQ, méthode « Devis multiples ») : même module (migration 59)
import { t } from '../../i18n';

const STYLES = { RFP: 'bg-indigo-100 text-indigo-800', RFQ: 'bg-teal-100 text-teal-800' };

export default function TenderTypeBadge({ type, className = '' }) {
  const value = type === 'RFQ' ? 'RFQ' : 'RFP';
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STYLES[value]} ${className}`} data-testid="tender-type">
      {t(`tenders.type.${value}`)}
    </span>
  );
}
