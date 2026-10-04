// Statuts calculés côté backend (effective_status)
export const TENDER_STATUS = {
  UPCOMING:  { label: 'À venir',   cls: 'bg-gray-100 text-gray-700' },
  OPEN:      { label: 'Ouvert',    cls: 'bg-green-100 text-green-700' },
  CLOSED:    { label: 'Clôturé',   cls: 'bg-yellow-100 text-yellow-800' },
  AWARDED:   { label: 'Attribué',  cls: 'bg-blue-100 text-blue-700' },
  CANCELLED: { label: 'Annulé',    cls: 'bg-red-100 text-red-700' },
};

export { isSupplierUser } from './accountType';

export const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const fmtMoney = (n, currency = '') =>
  `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(n) || 0)}${currency ? ' ' + currency : ''}`;

// Temps restant avant la clôture, ex. « 2 j 4 h »
export const timeLeft = (end) => {
  const ms = new Date(end) - new Date();
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return d > 0 ? `${d} j ${h} h` : h > 0 ? `${h} h ${m} min` : `${m} min`;
};

// <input type="datetime-local"> ↔ ISO
export const toLocalInput = (d) => {
  if (!d) return '';
  const date = new Date(d);
  const off = date.getTimezoneOffset();
  return new Date(date.getTime() - off * 60000).toISOString().slice(0, 16);
};
