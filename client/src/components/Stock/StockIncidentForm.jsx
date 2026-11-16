// src/components/Stock/StockIncidentForm.jsx
// Déclaration d'un rapport d'incident (migration 68) : l'employé déclare une perte, un vol ou un dommage sur des articles
// qu'il détient (« Mes articles reçus ») ; le magasin (ISSUE_STOCK) peut le faire pour le compte d'un employé.
// Paramètres : ?lineId= (article présélectionné), ?holderId= (déclaration pour un employé). Un rapport = un projet
// (validé par son chef). Dommage : équipements à n° de série seulement.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ShieldAlert, Send, SearchX, Siren, Wrench, User, Store } from 'lucide-react';
import toast from 'react-hot-toast';
import { equipmentService } from '../../services/stockService';
import { stockIncidentService } from '../../services/stockIncidentService';
import { usePermissions } from '../../hooks/usePermissions';
import { RecipientPicker } from './StockIssueForm';
import { t, getLocale } from '../../i18n';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);
const round = (n) => Math.round(n * 1e4) / 1e4;
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const TYPES = [['LOST', SearchX], ['STOLEN', Siren], ['DAMAGED', Wrench]];

/** Message traduit d'une erreur de l'API (code), sinon le message du serveur */
export function incidentError(err) {
  const body = err?.response?.data || {};
  const key = body.code ? `stockIncidents.err.${body.code}` : null;
  const text = key ? t(key, { available: body.available ?? '' }) : null;
  return text && text !== key ? text : body.message || t('stockIncidents.err.generic');
}

export default function StockIncidentForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { hasPermission } = usePermissions();
  const canForOthers = hasPermission('ISSUE_STOCK');
  const [mode, setMode] = useState(params.get('holderId') && canForOthers ? 'other' : 'self');
  const [holder, setHolder] = useState(null);
  const [holdings, setHoldings] = useState(null);
  const [selection, setSelection] = useState({}); // issueLineId → { checked, quantity }
  const [form, setForm] = useState({ incidentType: 'LOST', incidentDate: todayIso(), incidentPlace: '', circumstances: '', policeReference: '' });
  const [saving, setSaving] = useState(false);

  const preselect = (rows) => {
    const lineId = params.get('lineId');
    const row = lineId && rows.find(h => String(h.issue_line_id) === lineId);
    if (row) setSelection({ [row.issue_line_id]: { checked: true, quantity: String(row.unit_id ? 1 : round(row.remaining - row.incident_pending_quantity)) } });
  };
  // N° du dernier chargement : une réponse arrivée après un changement de mode / d'employé est ignorée
  const loadSeq = useRef(0);
  const loadHoldings = (fetcher) => {
    const seq = ++loadSeq.current;
    setHoldings(null); setSelection({});
    if (!fetcher) return;
    fetcher().then(r => {
      if (seq !== loadSeq.current) return;
      setHoldings(r.data || []);
      if (r.user) setHolder(r.user);
      preselect(r.data || []);
    }).catch(() => { if (seq === loadSeq.current) setHoldings([]); });
  };
  const loadFor = (userId) => loadHoldings(() => equipmentService.holdings(userId));
  useEffect(() => {
    if (mode === 'self') loadHoldings(() => equipmentService.myHoldings());
    else if (params.get('holderId')) loadFor(params.get('holderId'));
    else { setHolder(null); loadHoldings(null); }
  }, [mode]);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const damaged = form.incidentType === 'DAMAGED';
  // Disponible pour une nouvelle déclaration : détenu moins déjà déclaré perdu / volé en attente ; équipement : aucun rapport en attente
  const availableOf = (h) => (h.unit_id ? (h.incident_pending_count > 0 ? 0 : 1) : round(h.remaining - (h.incident_pending_quantity || 0)));
  const eligible = (h) => availableOf(h) > 0 && (!damaged || (h.unit_id && h.condition !== 'DAMAGED'));
  const rows = holdings || [];
  const chosen = rows.filter(h => selection[h.issue_line_id]?.checked && eligible(h));
  const projects = useMemo(() => [...new Set(chosen.map(h => h.project_code || ''))], [chosen]);
  const mixed = projects.length > 1;
  const quantityError = chosen.some(h => !h.unit_id && !(Number(selection[h.issue_line_id]?.quantity) > 0 && Number(selection[h.issue_line_id]?.quantity) <= availableOf(h)));
  const canSubmit = chosen.length > 0 && !mixed && !quantityError && form.circumstances.trim().length >= 10 && form.incidentDate && (mode === 'self' || holder);

  const toggle = (h) => setSelection(s => {
    const cur = s[h.issue_line_id];
    return { ...s, [h.issue_line_id]: { checked: !cur?.checked, quantity: cur?.quantity ?? String(availableOf(h)) } };
  });

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const res = await stockIncidentService.create({
        ...form,
        holderId: mode === 'other' ? holder.id : undefined,
        lines: chosen.map(h => ({ issueLineId: h.issue_line_id, quantity: h.unit_id ? 1 : Number(selection[h.issue_line_id].quantity) })),
      });
      toast.success(t('stockIncidents.created', { number: res.data.incidentNumber }));
      navigate(`/stock/incidents/${res.data.id}`);
    } catch (err) {
      toast.error(incidentError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-5xl space-y-5 p-6">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft size={16} /> {t('common.back')}</button>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><ShieldAlert className="text-red-600" /> {t('stockIncidents.formTitle')}</h1>
        <p className="text-sm text-gray-500">{t('stockIncidents.formSubtitle')}</p>
      </div>

      {canForOthers && (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('stockIncidents.forWhom')}>
          {[['self', User], ['other', Store]].map(([k, Icon]) => (
            <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)} data-testid={`incident-mode-${k}`}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm ${mode === k ? 'border-blue-600 bg-blue-50 font-medium text-blue-800' : 'border-gray-300 hover:bg-gray-50'}`}>
              <Icon size={16} /> {t(`stockIncidents.mode.${k}`)}
            </button>
          ))}
        </div>
      )}
      {mode === 'other' && (
        <div className="max-w-md">
          <label className="mb-1 block text-sm font-medium text-gray-700">{t('stockIncidents.holder')} *</label>
          <RecipientPicker value={holder} onChange={(u) => { setHolder(u); if (u) loadFor(u.id); else loadHoldings(null); }} testId="incident-holder" />
          <p className="mt-1 text-xs text-gray-500">{t('stockIncidents.otherHint')}</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label={t('stockIncidents.type')}>
        {TYPES.map(([k, Icon]) => (
          <button key={k} type="button" role="radio" aria-checked={form.incidentType === k} data-testid={`incident-type-${k}`}
            onClick={() => setForm(f => ({ ...f, incidentType: k }))}
            className={`rounded-lg border p-3 text-left ${form.incidentType === k ? 'border-red-500 bg-red-50 ring-1 ring-red-500' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
            <div className="flex items-center gap-2 font-medium text-gray-900"><Icon size={18} className="text-red-600" /> {t(`stockIncidents.types.${k}`)}</div>
            <p className="mt-1 text-xs text-gray-600">{t(`stockIncidents.typeHints.${k}`)}</p>
          </button>
        ))}
      </div>

      <div className="grid gap-4 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">{t('stockIncidents.incidentDate')} *</span>
          <input type="date" max={todayIso()} value={form.incidentDate} onChange={set('incidentDate')} className={inputCls} data-testid="incident-date" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">{t('stockIncidents.place')}</span>
          <input value={form.incidentPlace} onChange={set('incidentPlace')} maxLength={500} placeholder={t('stockIncidents.placePlaceholder')} className={inputCls} data-testid="incident-place" />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-gray-700">{t('stockIncidents.circumstances')} *</span>
          <textarea rows={4} value={form.circumstances} onChange={set('circumstances')} placeholder={t('stockIncidents.circumstancesPlaceholder')} className={inputCls} data-testid="incident-circumstances" />
          {form.circumstances.trim().length > 0 && form.circumstances.trim().length < 10 && <span className="text-xs text-amber-700">{t('stockIncidents.circumstancesShort')}</span>}
        </label>
        {form.incidentType === 'STOLEN' && (
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block font-medium text-gray-700">{t('stockIncidents.policeReference')}</span>
            <input value={form.policeReference} onChange={set('policeReference')} maxLength={200} className={inputCls} data-testid="incident-police" />
            <span className="text-xs text-gray-500">{t('stockIncidents.policeHint')}</span>
          </label>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <h2 className="border-b px-4 py-3 font-semibold text-gray-800">{t('stockIncidents.itemsTitle')}</h2>
        {holdings === null ? (
          <p className="p-4 text-sm text-gray-500">{mode === 'other' && !holder ? t('stockIncidents.chooseHolder') : t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-sm text-gray-500" data-testid="incident-no-holdings">{t('stockIncidents.noHoldings')}</p>
        ) : (
          <table className="w-full text-sm" data-testid="incident-holdings">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="w-8 px-4 py-2" />
                <th className="px-4 py-2">{t('stock.item')}</th>
                <th className="px-4 py-2">{t('stockIncidents.issue')}</th>
                <th className="px-4 py-2">{t('stockIncidents.project')}</th>
                <th className="px-4 py-2 text-right">{t('stockIncidents.held')}</th>
                <th className="px-4 py-2 text-right">{t('stockIncidents.declared')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(h => {
                const ok = eligible(h);
                const sel = selection[h.issue_line_id];
                const pending = h.incident_pending_count > 0;
                return (
                  <tr key={h.issue_line_id} className={ok ? '' : 'text-gray-400'} data-testid="incident-holding">
                    <td className="px-4 py-2"><input type="checkbox" disabled={!ok} checked={!!sel?.checked && ok} onChange={() => toggle(h)} aria-label={h.item_name} /></td>
                    <td className="px-4 py-2">
                      <span className="mr-1 font-mono text-xs font-semibold">{h.item_code}</span>{h.item_name}
                      {h.serial_number && <div className="font-mono text-xs text-indigo-700">{t('stock.equipment.serialLabel', { serial: h.serial_number })}{h.asset_tag ? ` · ${h.asset_tag}` : ''}</div>}
                      {h.lot_number && <div className="text-xs text-gray-500">{t('stockIncidents.lot', { lot: h.lot_number })}</div>}
                      {pending && <div className="text-xs text-amber-700" data-testid="incident-pending">{t('stockIncidents.pendingOnLine')}</div>}
                      {damaged && !h.unit_id && <div className="text-xs text-gray-500">{t('stockIncidents.damageEquipmentOnly')}</div>}
                      {damaged && h.condition === 'DAMAGED' && <div className="text-xs text-gray-500">{t('stockIncidents.alreadyDamaged')}</div>}
                    </td>
                    <td className="px-4 py-2 text-xs">{h.issue_number}<div className="text-gray-500">{new Date(h.issued_at).toLocaleDateString(getLocale())}</div></td>
                    <td className="px-4 py-2 text-xs">{h.project_code || t('stockIncidents.noProject')}</td>
                    <td className="px-4 py-2 text-right">{fmtQty(h.remaining)} <span className="text-xs text-gray-400">{h.unit}</span></td>
                    <td className="px-4 py-2 text-right">
                      {h.unit_id ? (sel?.checked && ok ? '1' : '—') : (
                        <input type="number" min="0" step="any" max={availableOf(h)} disabled={!sel?.checked || !ok} value={sel?.quantity ?? ''} aria-label={h.item_name}
                          onChange={e => setSelection(s => ({ ...s, [h.issue_line_id]: { ...s[h.issue_line_id], quantity: e.target.value } }))}
                          className={`${inputCls} w-24 text-right`} data-testid="incident-quantity" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {mixed && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" data-testid="incident-mixed">{t('stockIncidents.mixedProjects')}</div>}
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">{t('stockIncidents.afterSubmit')}</div>

      <div className="flex justify-end">
        <button onClick={submit} disabled={!canSubmit || saving} data-testid="incident-submit"
          className="flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
          <Send size={16} /> {saving ? t('common.saving') : t('stockIncidents.submit')}
        </button>
      </div>
    </div>
  );
}
