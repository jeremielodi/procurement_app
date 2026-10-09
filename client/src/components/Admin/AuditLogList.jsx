// src/components/Admin/AuditLogList.jsx
// Journal d'audit (VIEW_AUDIT_LOGS) : admin d'entreprise = son entreprise ; super admin = toute la plateforme (filtre
// par entreprise). Filtres : groupe d'événements, action, recherche (email / nom / IP), période ; synthèse par action ;
// détail dépliable (avant / après, navigateur) ; export Excel des filtres courants (tracé dans le journal).
import React, { Fragment, useEffect, useState } from 'react';
import { ScrollText, Search, Download, RefreshCw, ChevronDown, ChevronRight, ShieldAlert, ChevronLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import SearchSelect from '../Common/SearchSelect';
import api from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import { isSuperAdminUser } from '../../utils/accountType';
import { t, getLang, getLocale } from '../../i18n';

const inputCls = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

// Groupes d'événements (onglets) → actions
export const AUDIT_GROUPS = {
  all: null,
  auth: ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGIN_BLOCKED', 'LOGOUT'],
  password: ['PASSWORD_CHANGED', 'PASSWORD_CHANGE_FAILED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_CONFIRMED', 'PASSWORD_RESET_INVALID_LINK', 'PASSWORD_RESET_BY_ADMIN'],
  users: ['USER_CREATED', 'USER_UPDATED', 'USER_ACTIVATED', 'USER_DEACTIVATED', 'USER_DELETED', 'SUPPLIER_REGISTERED'],
  access: ['WAREHOUSE_ACCESS_CHANGED', 'AUDIT_LOG_EXPORTED'],
  // Contrôle interne : séparation des tâches, coordonnées bancaires, doublons
  controls: ['SOD_VIOLATION_BLOCKED', 'TASK_COMPLETION_DENIED', 'PAYMENT_BLOCKED', 'INVOICE_DUPLICATE_BLOCKED',
    'SUPPLIER_BANK_CHANGED', 'SUPPLIER_BANK_VERIFIED', 'SUPPLIER_BANK_REJECTED'],
  // Données sensibles : budget, rôles, entreprise, fournisseurs
  data: ['BUDGET_LINE_CREATED', 'BUDGET_LINE_UPDATED', 'BUDGET_LINE_DELETED', 'ROLE_CREATED', 'ROLE_UPDATED', 'ROLE_DELETED',
    'ROLE_PERMISSION_ADDED', 'ROLE_PERMISSION_REMOVED', 'ENTERPRISE_CREATED', 'ENTERPRISE_UPDATED', 'ENTERPRISE_ACTIVATED',
    'ENTERPRISE_DEACTIVATED', 'SUPPLIER_UPDATED', 'SUPPLIER_PREQUALIFICATION_DECIDED', 'SUPPLIER_DOCUMENT_REVIEWED'],
  // Annulations, rejets, paiements et ajustements
  operations: ['REQUISITION_DELETED', 'PURCHASE_ORDER_REJECTED', 'PURCHASE_ORDER_DELETED', 'GOODS_RECEIPT_CANCELLED', 'INVOICE_REJECTED',
    'PAYMENT_APPROVED', 'PAYMENT_STATUS_CHANGED', 'STOCK_ISSUE_CANCELLED', 'STOCK_ADJUSTED', 'STOCK_COUNT_VALIDATED'],
  failures: null, // failuresOnly
};
const FAILURES = ['LOGIN_FAILED', 'LOGIN_BLOCKED', 'PASSWORD_CHANGE_FAILED', 'PASSWORD_RESET_INVALID_LINK',
  'SOD_VIOLATION_BLOCKED', 'TASK_COMPLETION_DENIED', 'PAYMENT_BLOCKED', 'INVOICE_DUPLICATE_BLOCKED'];
const SENSITIVE = ['USER_DELETED', 'USER_DEACTIVATED', 'PASSWORD_RESET_BY_ADMIN', 'AUDIT_LOG_EXPORTED', 'SUPPLIER_BANK_CHANGED',
  'SUPPLIER_BANK_REJECTED', 'BUDGET_LINE_UPDATED', 'BUDGET_LINE_DELETED', 'ROLE_PERMISSION_ADDED', 'ROLE_PERMISSION_REMOVED',
  'REQUISITION_DELETED', 'PURCHASE_ORDER_DELETED', 'GOODS_RECEIPT_CANCELLED', 'STOCK_ADJUSTED'];
const label = (prefix, code) => { const k = `${prefix}.${code}`; const v = t(k); return v === k ? code : v; };

const actionLabel = (a) => { const k = `audit.actions.${a}`; const v = t(k); return v === k ? a : v; };
const actionCls = (a) => (FAILURES.includes(a) ? 'bg-red-100 text-red-800'
  : SENSITIVE.includes(a) ? 'bg-amber-100 text-amber-800'
  : a === 'LOGIN_SUCCESS' || a === 'LOGOUT' ? 'bg-gray-100 text-gray-700' : 'bg-blue-50 text-blue-800');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'medium' }) : '—');

/** Résumé d'une ligne : motif d'échec, email saisi, champs modifiés… */
function summaryOf(r) {
  const v = r.new_value || {};
  const parts = [];
  if (v.rule) parts.push(label('audit.rule', v.rule));
  if (v.reason) parts.push(label('audit.reason', v.reason));
  if (v.permission) parts.push(v.permission);
  if (v.status && r.action !== 'USER_UPDATED') parts.push(label('audit.status', v.status));
  if (v.scope) parts.push(t(`audit.scope.${v.scope}`));
  if (!r.user_id && v.email) parts.push(v.email);
  if (r.action === 'USER_UPDATED' && r.old_value) parts.push(Object.keys(r.old_value).join(', '));
  if (r.action === 'AUDIT_LOG_EXPORTED' && v.rows !== undefined) parts.push(`${v.rows}`);
  return parts.join(' · ');
}

function JsonBlock({ title, value }) {
  if (!value || (typeof value === 'object' && !Object.keys(value).length)) return null;
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 text-xs font-semibold text-gray-500">{title}</div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-2 text-xs text-gray-700 ring-1 ring-gray-200">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

export default function AuditLogList() {
  const { user } = useAuth();
  const superAdmin = isSuperAdminUser(user);
  const [group, setGroup] = useState('all');
  const [filters, setFilters] = useState({ q: '', action: '', from: '', to: '', enterpriseId: '' });
  const [debounced, setDebounced] = useState(filters);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ data: [], summary: [], pagination: {}, enterprises: [] });
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { const id = setTimeout(() => { setDebounced(filters); setPage(1); }, 300); return () => clearTimeout(id); }, [filters]);

  const params = () => {
    const p = Object.fromEntries(Object.entries(debounced).filter(([, v]) => v));
    if (group === 'failures') p.failuresOnly = 1;
    else if (AUDIT_GROUPS[group] && !p.action) p.actions = AUDIT_GROUPS[group].join(',');
    return p;
  };
  const load = async () => {
    setLoading(true);
    try {
      const res = (await api.get('/audit-logs', { params: { ...params(), page, limit: 50 } })).data;
      setResult({ data: res.data || [], summary: res.summary || [], pagination: res.pagination || {}, enterprises: res.enterprises || [] });
    } catch { /* toast api */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [debounced, page, group]);

  const set = (k) => (e) => setFilters(f => ({ ...f, [k]: e.target.value }));
  const exportXlsx = async () => {
    setExporting(true);
    try {
      const blob = (await api.get('/audit-logs/export', { params: { ...params(), lang: getLang() }, responseType: 'blob' })).data;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `audit_${new Date().toISOString().slice(0, 10)}.xlsx`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(t('audit.exported'));
    } catch { /* toast api */ } finally { setExporting(false); }
  };

  const groupActions = AUDIT_GROUPS[group] || (group === 'failures' ? FAILURES : null);
  const actionOptions = (groupActions || Object.keys(AUDIT_GROUPS).flatMap(g => AUDIT_GROUPS[g] || [])).filter((a, i, arr) => arr.indexOf(a) === i);
  const countOf = (a) => result.summary.find(s => s.action === a)?.count || 0;
  const groupCount = (g) => (g === 'all' ? result.summary.reduce((n, s) => n + s.count, 0)
    : (AUDIT_GROUPS[g] || FAILURES).reduce((n, a) => n + countOf(a), 0));
  const { pagination } = result;
  const cols = superAdmin ? 7 : 6;

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><ScrollText /> {t('audit.title')}</h1>
          <p className="text-sm text-gray-500">{superAdmin ? t('audit.subtitleSuper') : t('audit.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="rounded-lg border border-gray-300 p-2 hover:bg-gray-50" aria-label="refresh"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          <button onClick={exportXlsx} disabled={exporting} title={t('audit.exportLimit')} className="flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50" data-testid="audit-export">
            <Download size={16} /> {t('audit.export')}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist">
        {Object.keys(AUDIT_GROUPS).map(g => (
          <button key={g} role="tab" aria-selected={group === g} onClick={() => { setGroup(g); setFilters(f => ({ ...f, action: '' })); setPage(1); }}
            className={`flex items-center gap-1 rounded-full px-3 py-1 text-sm ${group === g ? (g === 'failures' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white') : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50'}`}>
            {g === 'failures' && <ShieldAlert size={14} />}{t(`audit.groups.${g}`)}
            <span className={`ml-1 rounded-full px-1.5 text-xs ${group === g ? 'bg-white/20' : 'bg-gray-100'}`}>{groupCount(g)}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
          <input value={filters.q} onChange={set('q')} placeholder={t('audit.search')} className={`${inputCls} w-full pl-9`} data-testid="audit-search" />
        </div>
        <SearchSelect value={filters.action} onChange={set('action')} className={inputCls} aria-label={t('audit.col.action')} data-testid="audit-action">
          <option value="">{t('audit.allActions')}</option>
          {actionOptions.map(a => <option key={a} value={a}>{actionLabel(a)}{countOf(a) ? ` (${countOf(a)})` : ''}</option>)}
        </SearchSelect>
        {superAdmin && (
          <SearchSelect value={filters.enterpriseId} onChange={set('enterpriseId')} className={inputCls} aria-label={t('audit.col.enterprise')}>
            <option value="">{t('audit.allEnterprises')}</option>
            <option value="none">{t('audit.noEnterprise')}</option>
            {result.enterprises.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </SearchSelect>
        )}
        <label className="flex items-center gap-1 text-sm text-gray-600">{t('audit.from')}
          <input type="date" value={filters.from} onChange={set('from')} className={inputCls} aria-label={t('audit.from')} />
        </label>
        <label className="flex items-center gap-1 text-sm text-gray-600">{t('audit.to')}
          <input type="date" value={filters.to} onChange={set('to')} className={inputCls} aria-label={t('audit.to')} />
        </label>
        {(filters.q || filters.action || filters.from || filters.to || filters.enterpriseId) && (
          <button onClick={() => setFilters({ q: '', action: '', from: '', to: '', enterpriseId: '' })} className="text-sm text-blue-600 hover:underline">{t('audit.reset')}</button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm" data-testid="audit-table">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="w-8" />
              <th className="px-3 py-2">{t('audit.col.date')}</th>
              <th className="px-3 py-2">{t('audit.col.action')}</th>
              {superAdmin && <th className="px-3 py-2">{t('audit.col.enterprise')}</th>}
              <th className="px-3 py-2">{t('audit.col.actor')}</th>
              <th className="px-3 py-2">{t('audit.col.target')}</th>
              <th className="px-3 py-2">{t('audit.col.ip')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {!loading && !result.data.length && (
              <tr><td colSpan={cols} className="px-4 py-10 text-center text-gray-500">{t('audit.empty')}</td></tr>
            )}
            {result.data.map(r => {
              const expanded = open === r.id;
              const extra = summaryOf(r);
              return (
                <Fragment key={r.id}>
                  <tr className={`cursor-pointer hover:bg-gray-50 ${expanded ? 'bg-gray-50' : ''}`} onClick={() => setOpen(expanded ? null : r.id)}>
                    <td className="pl-3 text-gray-400" aria-label={expanded ? t('audit.hideDetails') : t('audit.showDetails')}>{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{fmtDateTime(r.created_at)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${actionCls(r.action)}`}>{actionLabel(r.action)}</span>
                      {extra && <div className="mt-0.5 text-xs text-gray-500">{extra}</div>}
                    </td>
                    {superAdmin && <td className="px-3 py-2 text-xs text-gray-600">{r.enterprise_name || '—'}</td>}
                    <td className="px-3 py-2">
                      {r.user_id || r.user_email
                        ? <><div className="font-medium text-gray-900">{r.actor_name || r.user_email}</div>{r.actor_name && <div className="text-xs text-gray-500">{r.user_email}</div>}</>
                        : <span className="text-xs italic text-gray-400">{t('audit.visitor')}</span>}
                    </td>
                    <td className="px-3 py-2">
                      {r.entity_id && (r.target_name || r.target_email)
                        ? <><div className="text-gray-900">{r.target_name || r.target_email}</div>{r.target_name && <div className="text-xs text-gray-500">{r.target_email}</div>}</>
                        : r.entity_type && r.entity_type !== 'user' && (r.entity_label || r.entity_ref)
                          ? <><div className="text-gray-900">{r.entity_label || r.entity_ref}</div><div className="text-xs text-gray-500">{label('audit.entities', r.entity_type)}</div></>
                          : '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600">{r.ip_address || '—'}</td>
                  </tr>
                  {expanded && (
                    <tr className="bg-gray-50">
                      <td colSpan={cols} className="px-6 pb-4 pt-1">
                        <div className="flex flex-col gap-3 md:flex-row">
                          <JsonBlock title={r.old_value ? t('audit.after') : t('audit.details')} value={r.new_value} />
                          <JsonBlock title={t('audit.before')} value={r.old_value} />
                        </div>
                        {r.user_agent && <p className="mt-2 break-all text-xs text-gray-500"><b>{t('audit.userAgent')} :</b> {r.user_agent}</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>{t('audit.total', { count: pagination.total || 0 })}</span>
        {pagination.pages > 1 && (
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded border p-1 disabled:opacity-40" aria-label="previous"><ChevronLeft size={16} /></button>
            <span>{page} / {pagination.pages}</span>
            <button disabled={page >= pagination.pages} onClick={() => setPage(p => p + 1)} className="rounded border p-1 disabled:opacity-40" aria-label="next"><ChevronRight size={16} /></button>
          </div>
        )}
      </div>
    </div>
  );
}
