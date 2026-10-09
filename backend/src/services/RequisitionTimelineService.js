// backend/src/services/RequisitionTimelineService.js
// Suivi lisible d'une réquisition :
//  - steps  : le workflow complet procure-to-pay, étape par étape (fait / en cours / à venir / échec)
//  - events : ce qui s'est réellement passé, une ligne par action
// Textes dans la langue demandée (src/i18n/locales : workflow.*, timeline.*)
const db = require('../config/database');
const i18n = require('../i18n');
const {
  TASK_CANDIDATE_GROUPS, taskKey, taskLabel: rawTaskLabel, groupLabel, methodLabel, reasonLabel, matchLabel,
} = require('../utils/workflowLabels');

const APPROVAL_KEYS = ['Activity_ValidationN1_Manager', 'Activity_ValidationN2_Finance', 'Activity_ValidationN3_DG'];
const SOURCING_KEYS = ['Activity_DirectPurchase', 'Activity_RequestQuotations', 'Activity_RFPProcess', 'Activity_SoleSource'];
const PO_APPROVED = ['PO_APPROVED', 'PO_SENT', 'PO_CONFIRMED', 'PO_RECEIVED', 'PO_COMPLETE', 'APPROVED', 'SENT', 'COMPLETED'];
const PO_REJECTED = ['PO_REJECTED', 'REJECTED', 'CANCELLED'];
// Événements « document créé depuis une tâche » (TaskController.logDocumentEvent) et écran du document
const DOCUMENT_ACTIONS = ['GRN_COMPLETE', 'GRN_PARTIAL', 'SERVICE_ACCEPTED', 'SERVICE_REJECTED', 'INVOICE_MATCHED', 'INVOICE_MISMATCH', 'PAYMENT_RECORDED'];
const DOC_ROUTES = { grn: '/goods-receipts', invoice: '/invoices', payment: '/payments' };

// Tâche en attente → étape du workflow
const TASK_STEP = {
  Activity_ValidationN1_Manager: 'approval', Activity_ValidationN2_Finance: 'approval', Activity_ValidationN3_DG: 'approval',
  Activity_DetermineType: 'method',
  Activity_DirectPurchase: 'sourcing', Activity_RequestQuotations: 'sourcing', Activity_RFPProcess: 'sourcing', Activity_SoleSource: 'sourcing',
  Activity_CreatePO: 'po', Activity_POApproval: 'po_approval', Activity_SupplierConfirmation: 'supplier_confirmation',
  Activity_GoodsReceipt: 'grn', Activity_ServiceAcceptance: 'san', Activity_EnterInvoice: 'invoice', Activity_ProcessPayment: 'payment',
};

const fmtNum = (n, lang) => new Intl.NumberFormat(i18n.locale(lang), { maximumFractionDigits: 2 }).format(parseFloat(n) || 0);

function parseJson(s) {
  if (!s || typeof s !== 'string' || !s.trim().startsWith('{')) return null;
  try { return JSON.parse(s); } catch (_) { return null; }
}

function duration(from, to, T) {
  const ms = new Date(to) - new Date(from);
  if (!(ms > 0)) return null;
  const min = Math.round(ms / 60000);
  if (min < 1) return T('timeline.lessThanMinute');
  if (min < 60) return T('timeline.minutes', { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? T('timeline.hoursMinutes', { h, m: min % 60 }) : T('timeline.hours', { h });
  const d = Math.floor(h / 24);
  return h % 24 ? T('timeline.daysHours', { d, h: h % 24 }) : T('timeline.days', { d });
}

/** Détails lisibles à partir des variables saisies à la complétion d'une tâche */
function describeVars(vars = {}, links, T, lang) {
  const details = [];
  let decision = null;
  const approved = vars.approved ?? vars.poApproved;
  if (approved === true || approved === 'true') decision = 'APPROVED';
  if (approved === false || approved === 'false') decision = 'REJECTED';
  if (vars.procurementMethod) details.push(T('timeline.method', { value: methodLabel(vars.procurementMethod, lang) }));
  if (vars.poNumber) {
    details.push(T('timeline.po', { value: vars.poNumber }));
    if (vars.poId) links.push({ label: vars.poNumber, to: `/purchase-orders/${vars.poId}` });
  }
  if (vars.grnNumber) details.push(T('timeline.grn', { value: vars.grnNumber }));
  if (vars.grnCompliant !== undefined) details.push(T('timeline.grnCompliant', { value: T(vars.grnCompliant === true || vars.grnCompliant === 'true' ? 'timeline.yes' : 'timeline.no') }));
  if (vars.sanNumber) details.push(T('timeline.san', { value: vars.sanNumber }));
  if (vars.invoiceNumber) details.push(T('timeline.invoice', { value: vars.invoiceNumber }));
  if (vars.invoiceAmount) details.push(T('timeline.invoiceAmount', { value: fmtNum(vars.invoiceAmount, lang) }));
  if (vars.paymentNumber) details.push(T('timeline.payment', { value: vars.paymentNumber }));
  if (vars.paymentAmount) details.push(T('timeline.paymentAmount', { value: fmtNum(vars.paymentAmount, lang) }));
  if (vars.tenderNumber) details.push(T('timeline.tender', { value: vars.tenderNumber }));
  const comment = vars.comment || vars.comments || vars.rejectionReason;
  if (comment) details.push(T('timeline.comment', { value: comment }));
  return { details, decision };
}

class RequisitionTimelineService {

  async build(requisitionId, lang = i18n.DEFAULT_LANG) {
    const T = i18n.translator(lang);
    const taskLabel = (k) => rawTaskLabel(k, lang);
    const role = (k) => groupLabel(k, lang);
    const req = await db.one(
      `SELECT r.id, r.requisition_number, r.title, r.status, r.estimated_amount, r.created_at,
              r.process_instance_id, r.rejected_reason,
              u.first_name || ' ' || u.last_name AS requester_name
       FROM requisitions r LEFT JOIN users u ON u.id = r.requester_id WHERE r.id = $1`,
      [requisitionId]
    );
    if (!req) return null;

    const [rows, users, pos, tender] = await Promise.all([
      db.select(
        `SELECT * FROM workflow_history
         WHERE entity_id::text = $1 OR ($2::text IS NOT NULL AND process_instance_id = $2)
         ORDER BY performed_at, id`,
        [String(req.id), req.process_instance_id]
      ),
      db.select(`SELECT id, email, first_name || ' ' || last_name AS name FROM users`, []),
      db.select(
        `SELECT id, po_number, status, approved_at, approved_by, created_at, supplier_response, supplier_responded_at FROM purchase_orders WHERE requisition_id = $1 ORDER BY id`,
        [req.id]
      ),
      db.one(`SELECT id, tender_number, status FROM tenders WHERE requisition_id = $1 AND status <> 'CANCELLED' ORDER BY id DESC LIMIT 1`, [req.id])
        .catch(() => null), // table absente sur une base non migrée
    ]);
    const poIds = pos.map(p => p.id);
    const [grns, sans, invoices] = poIds.length ? await Promise.all([
      db.select('SELECT id, grn_number, status, receipt_date, created_at FROM goods_receipt_notes WHERE po_id = ANY($1) ORDER BY id', [poIds]),
      db.select('SELECT id, san_number, status, acceptance_date, created_at FROM service_acceptance_notes WHERE po_id = ANY($1) ORDER BY id', [poIds]),
      db.select('SELECT id, po_id, invoice_number, status, match_status, created_at FROM invoices WHERE po_id = ANY($1) ORDER BY id', [poIds]),
    ]) : [[], [], []];
    // Les paiements sont liés à la facture (po_id souvent vide)
    const invoiceIds = invoices.map(i => i.id);
    const payments = poIds.length ? await db.select(
      `SELECT id, payment_number, status, amount, created_by, approved_by, created_at FROM payments
       WHERE po_id = ANY($1) OR invoice_id = ANY($2) ORDER BY id`,
      [poIds, invoiceIds.length ? invoiceIds : [0]]
    ) : [];

    const nameById = new Map(users.map(u => [u.id, u.name?.trim() || u.email]));
    const nameByEmail = new Map(users.map(u => [String(u.email).toLowerCase(), u.name?.trim() || u.email]));
    const who = (row) => (row.performed_by && nameById.get(row.performed_by)) || null;

    // ---------------- Événements ----------------
    const events = [];
    const tasks = new Map();         // task_id → état de la tâche
    const budgetLines = [];
    let budget = null;               // { ok, date }
    let classification = null;      // { method, date }

    for (const row of rows) {
      const key = taskKey(row);
      const action = row.action || '';
      const json = parseJson(row.comments);

      if (action === 'TASK_CREATED') {
        tasks.set(row.task_id, { key, label: taskLabel(key || row.task_name), createdAt: row.performed_at });
        continue;
      }
      if (action === 'TASK_CLAIMED') {
        const t = tasks.get(row.task_id) || { key, label: taskLabel(key || row.task_name), createdAt: row.performed_at };
        const email = String(json?.assignee || '').toLowerCase();
        t.claimedBy = nameByEmail.get(email) || json?.assignee || who(row);
        t.claimedAt = row.performed_at;
        tasks.set(row.task_id, t);
        continue;
      }
      if (action === 'TASK_UNCLAIMED') {
        const t = tasks.get(row.task_id) || { key, label: taskLabel(key || row.task_name), createdAt: row.performed_at };
        events.push({
          date: row.performed_at, kind: 'info', title: T('timeline.released', { task: t.label }), actor: who(row),
          details: t.claimedBy ? [T('timeline.releasedFrom', { name: t.claimedBy })] : [], links: [],
        });
        delete t.claimedBy;
        delete t.claimedAt;
        tasks.set(row.task_id, t);
        continue;
      }
      if (action === 'TASK_COMPLETED') {
        const t = tasks.get(row.task_id) || { key, label: taskLabel(key || row.task_name), createdAt: null };
        t.completedAt = row.performed_at;
        const links = [];
        const { details, decision } = describeVars(json?.user_vars || {}, links, T, lang);
        // Tâches complétées via leur formulaire : l'auteur est sur le document
        const docActor = key === 'Activity_POApproval' ? nameById.get(pos.find(p => p.approved_by)?.approved_by)
          : key === 'Activity_ProcessPayment' ? nameById.get(payments[0]?.created_by || payments[0]?.approved_by)
          : null;
        // Auteur inconnu (données antérieures) : on indique le rôle attendu plutôt que « Système »
        const actor = who(row) || t.claimedBy || docActor || (role(key) ? T('timeline.role', { role: role(key) }) : T('timeline.system'));
        const took = t.createdAt ? duration(t.createdAt, row.performed_at, T) : null;
        if (took) details.push(T('timeline.tookTime', { time: took }));
        t.decision = decision;
        t.event = {
          date: row.performed_at,
          kind: decision === 'REJECTED' ? 'danger' : 'success',
          title: `${t.label}${T(decision === 'APPROVED' ? 'timeline.approved' : decision === 'REJECTED' ? 'timeline.rejected' : 'timeline.completed')}`,
          actor,
          details,
          links,
        };
        events.push(t.event);
        tasks.set(row.task_id, t);
        continue;
      }
      // Décision enregistrée par TaskController (doublon de TASK_COMPLETED : on complète l'événement)
      if ((action === 'APPROVED' || action === 'REJECTED') && TASK_CANDIDATE_GROUPS[row.task_name]) {
        const t = tasks.get(row.task_id);
        if (t?.event) {
          if (row.comments && !t.event.details.some(d => d.startsWith(T('timeline.commentPrefix')))) {
            t.event.details.unshift(T('timeline.comment', { value: row.comments }));
          }
        } else {
          events.push({
            date: row.performed_at, kind: action === 'REJECTED' ? 'danger' : 'success',
            title: `${taskLabel(row.task_name)} — ${T(action === 'REJECTED' ? 'timeline.rejectedWord' : 'timeline.approvedWord')}`,
            actor: who(row) || T('timeline.system'), details: row.comments ? [T('timeline.comment', { value: row.comments })] : [], links: [],
          });
        }
        continue;
      }

      // Document créé depuis une tâche (TaskController.logDocumentEvent) : complète l'événement de la tâche
      if (DOCUMENT_ACTIONS.includes(action)) {
        const info = json || {};
        const details = [T(`timeline.doc.${action}`)];
        if (info.comment) details.push(T('timeline.comment', { value: info.comment }));
        const links = [];
        if (info.document?.id && DOC_ROUTES[info.document.type]) links.push({ label: info.document.number, to: `${DOC_ROUTES[info.document.type]}/${info.document.id}` });
        if (info.poId && info.poNumber) links.push({ label: info.poNumber, to: `/purchase-orders/${info.poId}` });
        const t = tasks.get(row.task_id);
        if (t?.event) {
          t.event.details.unshift(...details);
          for (const l of links) if (!t.event.links.some(x => x.to === l.to)) t.event.links.push(l);
          if (['GRN_PARTIAL', 'SERVICE_REJECTED', 'INVOICE_MISMATCH'].includes(action)) t.event.kind = 'warning';
        } else {
          events.push({
            date: row.performed_at, kind: ['GRN_PARTIAL', 'SERVICE_REJECTED', 'INVOICE_MISMATCH'].includes(action) ? 'warning' : 'success',
            title: taskLabel(row.task_name) || action, actor: who(row) || T('timeline.system'), details, links,
          });
        }
        continue;
      }

      const name = row.task_name || '';
      if (action === 'NOTIFICATION_SENT' || action.startsWith('CLASSIFIED_')) continue; // bruit / doublon

      if (action === 'CREATED') {
        events.push({ date: row.performed_at, kind: 'info', title: T('timeline.created'), actor: who(row) || req.requester_name, details: [], links: [] });
      } else if (action === 'PROCESS_STARTED') {
        events.push({ date: row.performed_at, kind: 'info', title: T('timeline.processStarted'), actor: T('timeline.system'), details: [], links: [] });
      } else if (action === 'PROCESS_START_FAILED') {
        const reason = (row.comments || '').split(':').slice(1).join(':').trim();
        events.push({ date: row.performed_at, kind: 'danger', title: T('timeline.processStartFailed'), actor: T('timeline.system'), details: reason ? [reason] : [T('timeline.engineNoResponse')], links: [] });
      } else if (name.startsWith('Budget Check - ')) {
        const m = /Available:\s*([\d.]+).*Requested:\s*([\d.]+)/i.exec(row.comments || '');
        budgetLines.push(T('timeline.budgetLine', { line: name.replace('Budget Check - ', ''), requested: m ? fmtNum(m[2], lang) : '?', available: m ? fmtNum(m[1], lang) : '?' }) + (action === 'Budget Available' ? '' : T('timeline.insufficientSuffix')));
      } else if (name === 'Budget Check Summary') {
        const ok = action === 'All Budgets Available';
        budget = { ok, date: row.performed_at };
        events.push({ date: row.performed_at, kind: ok ? 'success' : 'danger', title: ok ? T('timeline.budgetOk') : T('timeline.budgetKo'), actor: T('timeline.system'), details: [...budgetLines], links: [] });
      } else if (name === 'Procurement Classification') {
        classification = { method: action, date: row.performed_at };
        events.push({
          date: row.performed_at, kind: 'info', title: T('timeline.methodTitle', { method: methodLabel(action, lang) }), actor: T('timeline.system'),
          details: row.comments ? [T('timeline.reason', { reason: reasonLabel(row.comments, lang) })] : [], links: [],
        });
      } else if (name === 'Offer Analysis') {
        events.push({ date: row.performed_at, kind: 'info', title: T('timeline.offerAnalysis'), actor: T('timeline.system'), details: [], links: [] });
      } else if (name === 'Send PO Notification') {
        events.push({ date: row.performed_at, kind: 'info', title: T('timeline.poSent'), actor: T('timeline.system'), details: [], links: [] });
      } else if (name === 'Invoice 3-Way Match') {
        events.push({
          date: row.performed_at, kind: action === 'MATCHED' ? 'success' : 'warning',
          title: T('timeline.matching', { status: matchLabel(action, lang) }), actor: T('timeline.system'),
          details: row.comments ? [row.comments] : [], links: [],
        });
      } else if (action === 'BUDGET_RECHECK_REQUESTED' || action === 'BUDGET_ADJUSTMENT_ABANDONED') {
        const retry = action === 'BUDGET_RECHECK_REQUESTED';
        events.push({
          date: row.performed_at, kind: retry ? 'info' : 'danger',
          title: T(retry ? 'timeline.budgetRecheck' : 'timeline.budgetAbandoned'), actor: who(row) || T('timeline.system'),
          details: row.comments ? [T('timeline.comment', { value: row.comments })] : [], links: [],
        });
      } else if (action === 'SUPPLIER_CONFIRMED' || action === 'SUPPLIER_DECLINED') {
        const confirmed = action === 'SUPPLIER_CONFIRMED';
        const info = json || {};
        const details = [T(info.source === 'PORTAL' ? 'timeline.viaPortal' : 'timeline.viaProcurement')];
        if (info.deliveryDate) details.push(T('timeline.promisedDelivery', { date: new Date(info.deliveryDate).toLocaleDateString(i18n.locale(lang)) }));
        if (info.reference) details.push(T('timeline.supplierReference', { value: info.reference }));
        if (info.comment) details.push(confirmed ? T('timeline.comment', { value: info.comment }) : T('timeline.reason', { reason: info.comment }));
        events.push({
          date: row.performed_at, kind: confirmed ? 'success' : 'danger',
          title: T(confirmed ? 'timeline.supplierConfirmed' : 'timeline.supplierDeclined', { number: info.poNumber || '' }),
          actor: who(row) || T('timeline.system'), details,
          links: info.poId ? [{ label: info.poNumber, to: `/purchase-orders/${info.poId}` }] : [],
        });
      } else if (action === 'TENDER_PUBLISHED' || action === 'TENDER_AWARDED') {
        events.push({
          date: row.performed_at, kind: action === 'TENDER_AWARDED' ? 'success' : 'info',
          title: action === 'TENDER_AWARDED' ? T('timeline.awarded') : T('timeline.tenderPublished'), actor: who(row) || T('timeline.system'),
          details: row.comments ? [row.comments] : [], links: tender ? [{ label: tender.tender_number, to: `/tenders/${tender.id}` }] : [],
        });
      } else {
        events.push({
          date: row.performed_at, kind: 'info', title: taskLabel(key || name) || action, actor: who(row) || T('timeline.system'),
          details: [action, json ? null : row.comments].filter(Boolean), links: [],
        });
      }
    }

    // Tâches en attente
    const pending = [...tasks.values()].filter(t => !t.completedAt);
    for (const t of pending) {
      const details = [T('timeline.expectedRole', { role: role(t.key) || '—' })];
      if (t.claimedBy) details.push(T('timeline.claimedBy', { name: t.claimedBy }));
      if (t.createdAt) details.push(T('timeline.waitingFor', { time: duration(t.createdAt, new Date(), T) || T('timeline.fewMoments') }));
      events.push({ date: t.createdAt, kind: 'warning', title: T('timeline.pendingTitle', { task: t.label }), actor: null, details, links: [], pending: true });
    }
    events.sort((a, b) => new Date(a.date) - new Date(b.date));

    // ---------------- Étapes du workflow complet ----------------
    const done = (key) => [...tasks.values()].find(t => t.key === key && t.completedAt);
    const approvals = [...tasks.values()].filter(t => APPROVAL_KEYS.includes(t.key) && t.completedAt);
    const approvalRejected = approvals.some(t => t.decision === 'REJECTED') || req.status === 'REJECTED';
    const sourcingDone = SOURCING_KEYS.map(done).find(Boolean);
    const activePos = pos.filter(p => !PO_REJECTED.includes(p.status));
    const paid = payments.some(p => ['PAID', 'COMPLETED'].includes(p.status)) || invoices.some(i => i.status === 'PAID');
    // Même règle que la colonne « Avancement » (RequisitionModel) : la fin du processus GoFlow fait foi
    const endedAt = (endEvent) => rows.some(r => r.action === 'TASK_COMPLETED' && (r.comments || '').includes(`"next_element":"${endEvent}"`));
    const processCompleted = endedAt('Event_Completed');
    // Hors workflow : terminée quand TOUS les PO actifs ont une facture payée (même règle que la colonne « Avancement »)
    const allPosPaid = activePos.length > 0
      && activePos.every(po => invoices.some(i => String(i.po_id) === String(po.id) && i.status === 'PAID'));
    const finished = req.status === 'COMPLETED' || processCompleted || (!req.process_instance_id && allPosPaid);
    const links = (list, numberKey, base) => list.map(d => ({ label: d[numberKey], to: `${base}/${d.id}` }));

    const steps = [
      { key: 'created', label: T('timeline.steps.created'), status: 'done', date: req.created_at, info: req.requester_name },
      { key: 'budget', label: T('timeline.steps.budget'), status: budget ? (budget.ok ? 'done' : 'failed') : 'pending', date: budget?.date },
      {
        key: 'approval', label: T('timeline.steps.approval'),
        status: approvalRejected ? 'failed' : approvals.length ? 'done' : 'pending',
        date: approvals.at(-1)?.completedAt,
        info: approvals.map(t => T('timeline.approvalInfo', { task: T('workflow.approvalPrefix') ? t.label.replace(T('workflow.approvalPrefix'), '') : t.label, decision: T(t.decision === 'REJECTED' ? 'timeline.rejectedWord' : 'timeline.approvedWord') })).join(' · ') || null,
      },
      { key: 'method', label: T('timeline.steps.method'), status: classification ? 'done' : 'pending', date: classification?.date, info: classification ? methodLabel(classification.method, lang) : null },
      {
        key: 'sourcing', label: T('timeline.steps.sourcing'), status: sourcingDone || activePos.length ? 'done' : 'pending',
        date: sourcingDone?.completedAt, info: sourcingDone?.label || null,
        links: tender ? [{ label: tender.tender_number, to: `/tenders/${tender.id}` }] : [],
      },
      { key: 'po', label: T('timeline.steps.po'), status: activePos.length ? 'done' : pos.length ? 'failed' : 'pending', date: activePos[0]?.created_at, links: links(pos, 'po_number', '/purchase-orders') },
      {
        key: 'po_approval', label: T('timeline.steps.po_approval'),
        status: activePos.some(p => PO_APPROVED.includes(p.status)) ? 'done' : pos.some(p => PO_REJECTED.includes(p.status)) && !activePos.length ? 'failed' : 'pending',
        date: activePos.find(p => p.approved_at)?.approved_at,
        info: nameById.get(activePos.find(p => p.approved_by)?.approved_by) ? T('timeline.approvedBy', { name: nameById.get(activePos.find(p => p.approved_by).approved_by) }) : null,
      },
      { key: 'supplier_confirmation', label: T('timeline.steps.supplier_confirmation'), status: done('Activity_SupplierConfirmation') || grns.length || activePos.some(p => p.supplier_response === 'CONFIRMED') ? 'done'
          : activePos.some(p => p.supplier_response === 'DECLINED') ? 'failed' : 'pending',
        date: done('Activity_SupplierConfirmation')?.completedAt || activePos.find(p => p.supplier_response)?.supplier_responded_at },
      { key: 'grn', label: T('timeline.steps.grn'), status: grns.length ? 'done' : 'pending', date: grns[0]?.receipt_date || grns[0]?.created_at, links: links(grns, 'grn_number', '/goods-receipts') },
      { key: 'san', label: T('timeline.steps.san'), status: sans.length ? 'done' : 'pending', date: sans[0]?.acceptance_date || sans[0]?.created_at, links: links(sans, 'san_number', '/service-acceptance-notes') },
      {
        key: 'invoice', label: T('timeline.steps.invoice'), status: invoices.length ? 'done' : 'pending', date: invoices[0]?.created_at,
        info: invoices[0]?.match_status ? T('timeline.matchingInfo', { status: matchLabel(invoices[0].match_status, lang) }) : null,
        links: links(invoices, 'invoice_number', '/invoices'),
      },
      {
        key: 'payment', label: T('timeline.steps.payment'), status: paid ? 'done' : 'pending', date: payments[0]?.created_at,
        info: payments.length ? T('timeline.paidAmount', { amount: fmtNum(payments.reduce((s, p) => s + parseFloat(p.amount || 0), 0), lang) }) : null,
        links: links(payments, 'payment_number', '/payments'),
      },
    ];

    // Étape en cours : celle de la tâche en attente, sinon la première non faite
    const stopped = ['REJECTED', 'CANCELLED'].includes(req.status) || endedAt('Event_Rejected') || steps.some(s => s.status === 'failed');
    const pendingStep = pending.map(t => TASK_STEP[t.key]).find(Boolean);
    if (!stopped && !finished) {
      const current = steps.find(s => s.key === pendingStep && s.status !== 'done') || steps.find(s => s.status === 'pending');
      if (current) {
        current.status = 'current';
        const t = pending.find(p => TASK_STEP[p.key] === current.key);
        if (t) {
          const who = t.claimedBy ? T('timeline.claimedByLower', { name: t.claimedBy }) : T('timeline.roleLower', { role: role(t.key) || T('timeline.undefinedRole') });
          // Libellé de tâche répété seulement s'il diffère de l'étape (ex. « Achat direct » dans « Sélection du fournisseur »)
          const task = t.label === current.label ? '' : ` : ${t.label}`;
          current.info = [current.info, T('timeline.waitingInfo', { task, who })].filter(Boolean).join(' · ');
        }
      }
    }
    if (stopped) {
      const failedIdx = steps.findIndex(s => s.status === 'failed');
      steps.forEach((s, i) => { if (s.status === 'pending' && (failedIdx < 0 || i > failedIdx)) s.status = 'skipped'; });
      if (req.status === 'CANCELLED') {
        events.push({ date: null, kind: 'danger', title: T('timeline.cancelled'), actor: null, details: req.rejected_reason ? [req.rejected_reason] : [], links: [] });
      }
    }

    const completedSteps = steps.filter(s => s.status === 'done').length;
    return {
      requisition: {
        id: req.id, requisition_number: req.requisition_number, title: req.title, status: req.status,
        estimated_amount: req.estimated_amount,
      },
      progress: { done: completedSteps, total: steps.length, finished, stopped },
      steps,
      events,
    };
  }
}

module.exports = new RequisitionTimelineService();
