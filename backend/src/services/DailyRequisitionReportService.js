// backend/src/services/DailyRequisitionReportService.js
// Rapport quotidien des réquisitions par email (migration 22_daily_requisition_report.sql).
//  - Option par entreprise : enterprise.daily_report_enabled (« Mon entreprise », administrateur)
//  - Chaque nuit à minuit (fuseau APP_TIMEZONE) : un email à chaque administrateur (prof_admin) et manager (prof_manager)
//    actif de l'entreprise, dans SA langue (users.language) ; administrateur = tous les projets, manager = les projets
//    dont il est membre ou responsable
//  - Projet par projet : synthèse + les 20 dernières réquisitions (statut, avancement, étape GoFlow en cours et
//    ancienneté — « bloqué » à partir de 7 jours)
//  - Un seul envoi par entreprise et par jour (daily_report_runs) ; nuit manquée (serveur arrêté) rattrapée avant 6 h
//  - sendTest : exemple immédiat pour l'administrateur qui le demande (hors daily_report_runs)
const db = require('../config/database');
const i18n = require('../i18n');
const emailService = require('./EmailNotificationService');
const { taskLabel } = require('../utils/workflowLabels');
const { appLink } = require('../utils/appUrl');

const LATEST_PER_PROJECT = 20;
const BLOCKED_DAYS = 7;
const CATCH_UP_UNTIL_HOUR = 6; // rattrapage d'une nuit manquée : jusqu'à 6 h
const TZ = () => process.env.APP_TIMEZONE || 'Africa/Kinshasa';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Date (AAAA-MM-JJ) et heure dans le fuseau de l'application */
function localNow(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(p => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: parseInt(parts.hour, 10) };
}

// Avancement : même règle que la colonne « Avancement » de la liste des réquisitions
const { PROGRESS_STATUS_SQL: PROGRESS_SQL } = require('../models/RequisitionModel');

class DailyRequisitionReportService {
  /** Destinataires : administrateurs et managers actifs (option : un utilisateur précis pour l'exemple) */
  async recipients(enterpriseId, onlyUserId = null) {
    const params = [enterpriseId];
    let extra = '';
    if (onlyUserId) { params.push(onlyUserId); extra = ` AND u.id = $${params.length}`; }
    return db.select(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.language,
              BOOL_OR(up.profile_id = 'prof_admin') AS is_admin
       FROM users u JOIN user_profiles up ON up.user_id = u.id AND up.profile_id IN ('prof_admin', 'prof_manager')
       WHERE u.enterprise_id = $1 AND u.is_active AND u.email IS NOT NULL${extra}
       GROUP BY u.id ORDER BY u.email`,
      params
    );
  }

  /** Projets visibles par le destinataire, avec au moins une réquisition */
  async projectsFor(enterpriseId, user) {
    const params = [enterpriseId];
    let scope = '';
    if (!user.is_admin) {
      params.push(user.id);
      scope = ` AND (p.project_manager_id = $2 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $2))`;
    }
    return db.select(
      `SELECT p.id, p.code, p.name,
              COUNT(r.id)::int AS total,
              COUNT(r.id) FILTER (WHERE r.created_at >= NOW() - INTERVAL '1 day')::int AS created_today
       FROM projects p JOIN requisitions r ON r.project_id = p.id AND r.enterprise_id = $1
       WHERE p.enterprise_id = $1${scope}
       GROUP BY p.id ORDER BY p.code`,
      params
    );
  }

  /** 20 dernières réquisitions d'un projet, avec l'étape GoFlow en cours (tâche créée non terminée) */
  async latestRequisitions(projectId) {
    return db.select(
      `WITH latest AS (
         SELECT r.* FROM requisitions r WHERE r.project_id = $1 ORDER BY r.created_at DESC LIMIT ${LATEST_PER_PROJECT}
       ),
       pending AS (
         SELECT DISTINCT ON (c.entity_id) c.entity_id, COALESCE(c.task_definition_id, c.task_name) AS task_key, c.performed_at AS since
         FROM workflow_history c
         WHERE c.action = 'TASK_CREATED' AND c.task_id IS NOT NULL AND c.entity_id IN (SELECT id FROM latest)
           AND NOT EXISTS (SELECT 1 FROM workflow_history d WHERE d.action = 'TASK_COMPLETED' AND d.task_id = c.task_id)
         ORDER BY c.entity_id, c.performed_at DESC
       )
       SELECT r.id, r.requisition_number, r.title, r.status, r.created_at, r.estimated_amount::float8 AS amount,
              cur.format_key AS currency,
              NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS requester,
              ${PROGRESS_SQL} AS progress,
              pd.task_key, pd.since
       FROM latest r
       LEFT JOIN users u ON u.id = r.requester_id
       LEFT JOIN currency cur ON cur.id = r.currency_id
       LEFT JOIN pending pd ON pd.entity_id = r.id
       ORDER BY r.created_at DESC`,
      [projectId]
    );
  }

  /** Contenu HTML du rapport d'un destinataire (null : aucune réquisition dans ses projets) */
  async buildFor(enterprise, user, now = new Date()) {
    const projects = await this.projectsFor(enterprise.id, user);
    if (!projects.length) return null;
    const lang = user.language;
    const T = i18n.translator(lang);
    const locale = i18n.locale(lang);
    const fmtDate = (d) => new Date(d).toLocaleDateString(locale, { timeZone: TZ(), day: '2-digit', month: 'short', year: 'numeric' });
    const fmtAmount = (n, cur) => `${Number(n || 0).toLocaleString(locale, { maximumFractionDigits: 2 })} ${cur || ''}`.trim();
    const label = (prefix, code) => { const k = `${prefix}.${code}`; const v = T(k); return v === k ? code : v; };

    const sections = [];
    let totalShown = 0, totalBlocked = 0;
    for (const p of projects) {
      const rows = await this.latestRequisitions(p.id);
      totalShown += rows.length;
      const ageDays = (since) => (since ? Math.floor((now - new Date(since)) / 86400000) : null);
      const blocked = rows.filter(r => r.task_key && ageDays(r.since) >= BLOCKED_DAYS).length;
      totalBlocked += blocked;
      const counts = rows.reduce((acc, r) => ({ ...acc, [r.progress]: (acc[r.progress] || 0) + 1 }), {});
      const chips = ['IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED', 'DRAFT']
        .filter(k => counts[k])
        .map(k => `<span style="display:inline-block;margin:0 6px 4px 0;padding:2px 8px;border-radius:10px;background:#eef2ff;color:#3730a3;font-size:12px;">${esc(label('progress', k))} : ${counts[k]}</span>`)
        .join('') + (blocked ? `<span style="display:inline-block;margin:0 6px 4px 0;padding:2px 8px;border-radius:10px;background:#fee2e2;color:#991b1b;font-size:12px;">${esc(T('email.dailyReport.blocked', { count: blocked }))}</span>` : '');
      const body = rows.map(r => {
        const age = ageDays(r.since);
        const step = r.task_key
          ? `${esc(taskLabel(r.task_key, lang) || r.task_key)}<br><span style="color:${age >= BLOCKED_DAYS ? '#b91c1c;font-weight:bold' : age >= 3 ? '#c2410c' : '#6b7280'};font-size:11px;">${esc(T('email.dailyReport.since', { count: age }))}</span>`
          : '<span style="color:#9ca3af;">—</span>';
        return `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;white-space:nowrap;"><a href="${appLink(`/requisitions/${r.id}`)}" style="color:#1d4ed8;text-decoration:none;font-weight:bold;">${esc(r.requisition_number)}</a><br><span style="color:#9ca3af;font-size:11px;">${fmtDate(r.created_at)}</span></td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${esc(r.title || '—')}<br><span style="color:#6b7280;font-size:11px;">${esc(r.requester || '—')}</span></td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap;">${esc(fmtAmount(r.amount, r.currency))}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${esc(label('status', r.status))}<br><span style="color:#6b7280;font-size:11px;">${esc(label('progress', r.progress))}</span></td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${step}</td>
        </tr>`;
      }).join('');
      sections.push(`
        <h3 style="margin:24px 0 4px;color:#111827;font-size:16px;">${esc(p.code)} — ${esc(p.name)}</h3>
        <p style="margin:0 0 8px;color:#6b7280;font-size:12px;">${esc(T('email.dailyReport.projectSummary', { total: p.total, shown: rows.length, today: p.created_today }))}</p>
        <div>${chips}</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:6px;">
          <thead><tr style="background:#f3f4f6;color:#374151;text-align:left;">
            <th style="padding:6px 8px;">${esc(T('email.dailyReport.col.number'))}</th>
            <th style="padding:6px 8px;">${esc(T('email.dailyReport.col.title'))}</th>
            <th style="padding:6px 8px;text-align:right;">${esc(T('email.dailyReport.col.amount'))}</th>
            <th style="padding:6px 8px;">${esc(T('email.dailyReport.col.status'))}</th>
            <th style="padding:6px 8px;">${esc(T('email.dailyReport.col.step'))}</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>`);
    }

    const dateLabel = now.toLocaleDateString(locale, { timeZone: TZ(), weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const subject = T('email.dailyReport.subject', { enterprise: enterprise.name, date: localNow(now).day });
    const html = `
      <div style="font-family:Arial,sans-serif;color:#1f2937;max-width:900px;">
        <div style="background:#0d1838;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0;">
          <div style="font-size:12px;color:#93c5fd;text-transform:uppercase;letter-spacing:1px;">${esc(enterprise.name)}</div>
          <div style="font-size:20px;font-weight:bold;margin-top:4px;">${esc(T('email.dailyReport.title'))}</div>
          <div style="font-size:13px;color:#cbd5e1;margin-top:2px;">${esc(T('email.dailyReport.asOf', { date: dateLabel }))}</div>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:0;padding:16px 20px;border-radius:0 0 8px 8px;">
          <p>${T('email.hello', { name: esc(user.first_name || user.email) })}</p>
          <p>${esc(T(user.is_admin ? 'email.dailyReport.introAdmin' : 'email.dailyReport.introManager', { projects: projects.length, count: LATEST_PER_PROJECT }))}</p>
          ${totalBlocked ? `<p style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:8px 12px;border-radius:6px;">${esc(T('email.dailyReport.blockedIntro', { count: totalBlocked, days: BLOCKED_DAYS }))}</p>` : ''}
          ${sections.join('')}
          <p style="margin-top:24px;"><a href="${appLink('/requisitions')}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">${esc(T('email.dailyReport.open'))}</a></p>
          <p style="font-size:12px;color:#9ca3af;">${esc(T('email.dailyReport.why'))}<br>${esc(T('email.footer'))}</p>
        </div>
      </div>`;
    return { subject, html, projects: projects.length, requisitions: totalShown };
  }

  /** Envoie le rapport d'une entreprise ; renvoie { recipients, sent, failed, skipped } */
  async sendForEnterprise(enterpriseId, { onlyUserId = null, now = new Date() } = {}) {
    const enterprise = await db.one('SELECT id, name FROM enterprise WHERE id = $1', [enterpriseId]);
    if (!enterprise) return { recipients: 0, sent: 0, failed: 0, skipped: 0 };
    const users = await this.recipients(enterpriseId, onlyUserId);
    let sent = 0, failed = 0, skipped = 0;
    for (const user of users) {
      try {
        const report = await this.buildFor(enterprise, user, now);
        if (!report) { skipped++; continue; } // aucune réquisition dans ses projets
        const result = await emailService.sendEmail(user.email, report.subject, report.html);
        if (result?.success) sent++; else failed++;
      } catch (error) {
        failed++;
        console.error('Rapport quotidien (%s) : %s', user.email, error.message);
      }
    }
    return { recipients: users.length, sent, failed, skipped };
  }

  /** Exemple immédiat pour l'utilisateur connecté (administrateur), sans toucher au suivi des envois */
  async sendTest(enterpriseId, userId) {
    const result = await this.sendForEnterprise(enterpriseId, { onlyUserId: userId });
    if (!result.recipients) {
      return { ...result, reason: 'NOT_A_RECIPIENT' };
    }
    if (result.skipped) return { ...result, reason: 'NO_REQUISITIONS' };
    return result;
  }

  /**
   * Passage du planificateur : à partir de minuit (et jusqu'à 6 h en rattrapage), un envoi par entreprise activée
   * et par jour. La ligne daily_report_runs est réservée AVANT l'envoi (INSERT … ON CONFLICT DO NOTHING) :
   * deux instances ou deux passages ne peuvent pas envoyer deux fois.
   */
  async tick(date = new Date()) {
    const { day, hour } = localNow(date);
    if (hour >= CATCH_UP_UNTIL_HOUR) return [];
    const enterprises = await db.select('SELECT id, name FROM enterprise WHERE daily_report_enabled AND is_active', []);
    const results = [];
    for (const e of enterprises) {
      const claimed = await db.one(
        `INSERT INTO daily_report_runs (enterprise_id, report_date) VALUES ($1, $2::date)
         ON CONFLICT DO NOTHING RETURNING enterprise_id`,
        [e.id, day]
      );
      if (!claimed) continue;
      try {
        const r = await this.sendForEnterprise(e.id, { now: date });
        await db.exec(
          `UPDATE daily_report_runs SET finished_at = CURRENT_TIMESTAMP, recipients = $3, sent = $4, failed = $5
           WHERE enterprise_id = $1 AND report_date = $2::date`,
          [e.id, day, r.recipients, r.sent, r.failed]
        );
        console.log(`📧 Rapport quotidien ${e.name} (${day}) : ${r.sent} email(s) envoyé(s)${r.failed ? `, ${r.failed} échec(s)` : ''}`);
        results.push({ enterpriseId: e.id, ...r });
      } catch (error) {
        await db.exec('UPDATE daily_report_runs SET finished_at = CURRENT_TIMESTAMP, error = $3 WHERE enterprise_id = $1 AND report_date = $2::date',
          [e.id, day, String(error.message).slice(0, 1000)]);
        console.error('Rapport quotidien %s : %s', e.name, error.message);
      }
    }
    return results;
  }

  /** Démarre le planificateur (une vérification par minute) ; DAILY_REPORT_DISABLED=1 le désactive */
  start() {
    if (['1', 'true'].includes(String(process.env.DAILY_REPORT_DISABLED || '').toLowerCase())) return null;
    const run = () => this.tick().catch(error => console.error('Rapport quotidien :', error.message));
    const timer = setInterval(run, 60 * 1000);
    timer.unref?.();
    setTimeout(run, 15 * 1000).unref?.(); // rattrapage au démarrage
    return timer;
  }

  /** État pour l'écran « Mon entreprise » */
  async status(enterpriseId) {
    const [enterprise, lastRun, recipients] = await Promise.all([
      db.one('SELECT daily_report_enabled FROM enterprise WHERE id = $1', [enterpriseId]),
      db.one('SELECT report_date, started_at, finished_at, recipients, sent, failed, error FROM daily_report_runs WHERE enterprise_id = $1 ORDER BY report_date DESC LIMIT 1', [enterpriseId]),
      this.recipients(enterpriseId),
    ]);
    return {
      enabled: !!enterprise?.daily_report_enabled,
      lastRun: lastRun || null,
      recipients: recipients.map(r => ({ email: r.email, name: [r.first_name, r.last_name].filter(Boolean).join(' '), role: r.is_admin ? 'ADMIN' : 'MANAGER', language: r.language || 'fr' })),
      timezone: TZ(),
      latestPerProject: LATEST_PER_PROJECT,
    };
  }
}

module.exports = new DailyRequisitionReportService();
module.exports.localNow = localNow;
