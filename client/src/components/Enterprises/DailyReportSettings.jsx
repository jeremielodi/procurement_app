// src/components/Enterprises/DailyReportSettings.jsx
// « Mon entreprise » : rapport quotidien des réquisitions par email (chaque nuit à minuit) aux administrateurs et
// managers, chacun dans sa langue, projet par projet (20 dernières réquisitions). Activation, destinataires, dernier
// envoi, état du planificateur de ce serveur (diagnostic d'un envoi manquant), exemple à soi-même, envoi immédiat à tous.
import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Mail, Send, RefreshCw, Users, CheckCircle2, AlertTriangle, Clock, Users2 } from 'lucide-react';
import { enterpriseService } from '../../services/enterpriseService';
import { t, getLocale } from '../../i18n';

const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export default function DailyReportSettings() {
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);

  const load = () => enterpriseService.getDailyReport().then(r => setData(r.data)).catch(() => setData(null));
  useEffect(() => { load(); }, []);

  const toggle = async () => {
    setSaving(true);
    try {
      const r = await enterpriseService.setDailyReport(!data.enabled);
      setData(r.data);
      toast.success(r.data.enabled ? t('dailyReport.enabledToast') : t('dailyReport.disabledToast'));
    } catch { /* toast via intercepteur */ } finally { setSaving(false); }
  };

  const sendTest = async () => {
    setSending(true);
    try {
      await enterpriseService.sendDailyReportTest();
      toast.success(t('dailyReport.testSent'));
    } catch (err) {
      const code = err.response?.data?.code;
      toast.error(code ? t(`dailyReport.err.${code}`) : t('common.error'));
    } finally { setSending(false); }
  };

  const sendAll = async () => {
    if (!window.confirm(t('dailyReport.sendAllConfirm', { count: data.recipients.length }))) return;
    setSendingAll(true);
    try {
      const r = await enterpriseService.sendDailyReportNow();
      setData(r.data.status);
      toast.success(t('dailyReport.sendAllDone', { sent: r.data.sent, failed: r.data.failed }));
    } catch (err) {
      const code = err.response?.data?.code;
      toast.error(code ? t(`dailyReport.err.${code}`) : t('common.error'));
    } finally { setSendingAll(false); }
  };

  if (!data) return null;
  const run = data.lastRun;
  const sch = data.scheduler || {};
  // Planificateur : actif, désactivé sur le serveur, ou en erreur
  const schState = sch.disabled ? 'disabled' : !sch.running ? 'stopped' : sch.lastTickError ? 'error' : 'ok';
  const fmtDay = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(getLocale(), { dateStyle: 'medium' }) : '—');

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4" data-testid="daily-report-settings">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Mail size={20} /></span>
          <div>
            <h2 className="font-semibold text-gray-900">{t('dailyReport.title')}</h2>
            <p className="mt-1 text-sm text-gray-500">{t('dailyReport.description', { count: data.latestPerProject, timezone: data.timezone })}</p>
          </div>
        </div>
        {/* Interrupteur */}
        <button
          type="button"
          role="switch"
          aria-checked={data.enabled}
          aria-label={t('dailyReport.title')}
          onClick={toggle}
          disabled={saving}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${data.enabled ? 'bg-blue-600' : 'bg-gray-300'}`}
          data-testid="daily-report-toggle"
        >
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${data.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg bg-gray-50 p-3 text-sm">
          <div className="mb-2 flex items-center gap-2 font-medium text-gray-700"><Users size={16} /> {t('dailyReport.recipients', { count: data.recipients.length })}</div>
          {data.recipients.length ? (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {data.recipients.map(r => (
                <li key={r.email} className="flex items-center justify-between gap-2">
                  <span className="truncate text-gray-800" title={r.email}>{r.name || r.email}</span>
                  <span className="shrink-0 text-xs text-gray-500">{t(`dailyReport.role.${r.role}`)} · {r.language.toUpperCase()}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-gray-500">{t('dailyReport.noRecipients')}</p>}
        </div>
        <div className="rounded-lg bg-gray-50 p-3 text-sm">
          <div className="mb-2 font-medium text-gray-700">{t('dailyReport.lastRun')}</div>
          {run ? (
            <p className={`flex items-start gap-2 ${run.failed || run.error ? 'text-amber-800' : 'text-gray-700'}`}>
              {run.failed || run.error ? <AlertTriangle size={16} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-green-600" />}
              <span>{t('dailyReport.lastRunText', { date: fmtDateTime(run.finished_at || run.started_at), sent: run.sent, failed: run.failed })}</span>
            </p>
          ) : <p className="text-gray-500">{t('dailyReport.neverSent')}</p>}
          <button
            onClick={sendAll}
            disabled={sendingAll || !data.recipients.length}
            className="mt-3 mr-2 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            data-testid="daily-report-send-all"
          >
            {sendingAll ? <RefreshCw size={14} className="animate-spin" /> : <Users2 size={14} />} {t('dailyReport.sendAll')}
          </button>
          <button
            onClick={sendTest}
            disabled={sending}
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-50"
            data-testid="daily-report-test"
          >
            {sending ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />} {t('dailyReport.sendTest')}
          </button>
        </div>
      </div>

      {/* Planificateur sur ce serveur : s'il n'est pas actif (ou en erreur), aucun envoi automatique à minuit */}
      <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${schState === 'ok' ? 'border-green-200 bg-green-50 text-green-900' : 'border-red-200 bg-red-50 text-red-900'}`} data-testid="daily-report-scheduler">
        {schState === 'ok' ? <Clock size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
        <div>
          <p className="font-medium">{t(`dailyReport.scheduler.${schState}`)}</p>
          <p className="mt-0.5 text-xs opacity-90">
            {t('dailyReport.scheduler.details', {
              time: fmtDateTime(sch.serverTime), timezone: data.timezone,
              next: data.enabled ? fmtDay(sch.nextRunDay) : t('dailyReport.scheduler.optionOff'),
              tick: fmtDateTime(sch.lastTickAt),
            })}
          </p>
          {sch.timezoneConfigured && !sch.timezoneValid && (
            <p className="mt-1 text-xs">{t('dailyReport.scheduler.badTimezone', { value: sch.timezoneConfigured, timezone: data.timezone })}</p>
          )}
          {sch.lastTickError && <p className="mt-1 font-mono text-xs">{sch.lastTickError}</p>}
        </div>
      </div>
    </div>
  );
}
