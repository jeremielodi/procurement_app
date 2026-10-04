// backend/src/services/RequisitionTimelineService.js
// Suivi lisible d'une réquisition :
//  - steps  : le workflow complet procure-to-pay, étape par étape (fait / en cours / à venir / échec)
//  - events : ce qui s'est réellement passé, en français, une ligne par action
const db = require('../config/database');
const {
  TASK_GROUPS, METHOD_LABELS, REASON_LABELS, MATCH_LABELS, taskKey, taskLabel,
} = require('../utils/workflowLabels');

const APPROVAL_KEYS = ['Activity_ValidationN1_Manager', 'Activity_ValidationN2_Finance', 'Activity_ValidationN3_DG'];
const SOURCING_KEYS = ['Activity_DirectPurchase', 'Activity_RequestQuotations', 'Activity_RFPProcess', 'Activity_SoleSource'];
const PO_APPROVED = ['PO_APPROVED', 'PO_SENT', 'PO_RECEIVED', 'PO_COMPLETE', 'APPROVED', 'SENT', 'COMPLETED'];
const PO_REJECTED = ['PO_REJECTED', 'REJECTED', 'CANCELLED'];

// Tâche en attente → étape du workflow
const TASK_STEP = {
  Activity_ValidationN1_Manager: 'approval', Activity_ValidationN2_Finance: 'approval', Activity_ValidationN3_DG: 'approval',
  Activity_DetermineType: 'method',
  Activity_DirectPurchase: 'sourcing', Activity_RequestQuotations: 'sourcing', Activity_RFPProcess: 'sourcing', Activity_SoleSource: 'sourcing',
  Activity_CreatePO: 'po', Activity_POApproval: 'po_approval', Activity_SupplierConfirmation: 'supplier_confirmation',
  Activity_GoodsReceipt: 'grn', Activity_ServiceAcceptance: 'san', Activity_EnterInvoice: 'invoice', Activity_ProcessPayment: 'payment',
};

const fmtNum = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(parseFloat(n) || 0);

function parseJson(s) {
  if (!s || typeof s !== 'string' || !s.trim().startsWith('{')) return null;
  try { return JSON.parse(s); } catch (_) { return null; }
}

function duration(from, to) {
  const ms = new Date(to) - new Date(from);
  if (!(ms > 0)) return null;
  const min = Math.round(ms / 60000);
  if (min < 1) return 'moins d\'une minute';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${min % 60 ? `${min % 60} min` : ''}`.trim();
  const d = Math.floor(h / 24);
  return `${d} j ${h % 24 ? `${h % 24} h` : ''}`.trim();
}

/** Détails lisibles à partir des variables saisies à la complétion d'une tâche */
function describeVars(vars = {}, links) {
  const details = [];
  let decision = null;
  const approved = vars.approved ?? vars.poApproved;
  if (approved === true || approved === 'true') decision = 'APPROVED';
  if (approved === false || approved === 'false') decision = 'REJECTED';
  if (vars.procurementMethod) details.push(`Méthode retenue : ${METHOD_LABELS[vars.procurementMethod] || vars.procurementMethod}`);
  if (vars.poNumber) {
    details.push(`Bon de commande : ${vars.poNumber}`);
    if (vars.poId) links.push({ label: vars.poNumber, to: `/purchase-orders/${vars.poId}` });
  }
  if (vars.grnNumber) details.push(`Bon de réception : ${vars.grnNumber}`);
  if (vars.grnCompliant !== undefined) details.push(`Réception conforme : ${vars.grnCompliant === true || vars.grnCompliant === 'true' ? 'oui' : 'non'}`);
  if (vars.sanNumber) details.push(`Acceptation de service : ${vars.sanNumber}`);
  if (vars.invoiceNumber) details.push(`Facture : ${vars.invoiceNumber}`);
  if (vars.invoiceAmount) details.push(`Montant facturé : ${fmtNum(vars.invoiceAmount)}`);
  if (vars.paymentNumber) details.push(`Paiement : ${vars.paymentNumber}`);
  if (vars.paymentAmount) details.push(`Montant payé : ${fmtNum(vars.paymentAmount)}`);
  if (vars.tenderNumber) details.push(`Appel d'offres : ${vars.tenderNumber}`);
  const comment = vars.comment || vars.comments || vars.rejectionReason;
  if (comment) details.push(`Commentaire : « ${comment} »`);
  return { details, decision };
}

class RequisitionTimelineService {

  async build(requisitionId) {
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
        `SELECT id, po_number, status, approved_at, approved_by, created_at FROM purchase_orders WHERE requisition_id = $1 ORDER BY id`,
        [req.id]
      ),
      db.one(`SELECT id, tender_number, status FROM tenders WHERE requisition_id = $1 AND status <> 'CANCELLED' ORDER BY id DESC LIMIT 1`, [req.id])
        .catch(() => null), // table absente sur une base non migrée
    ]);
    const poIds = pos.map(p => p.id);
    const [grns, sans, invoices] = poIds.length ? await Promise.all([
      db.select('SELECT id, grn_number, status, receipt_date, created_at FROM goods_receipt_notes WHERE po_id = ANY($1) ORDER BY id', [poIds]),
      db.select('SELECT id, san_number, status, acceptance_date, created_at FROM service_acceptance_notes WHERE po_id = ANY($1) ORDER BY id', [poIds]),
      db.select('SELECT id, invoice_number, status, match_status, created_at FROM invoices WHERE po_id = ANY($1) ORDER BY id', [poIds]),
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
      if (action === 'TASK_COMPLETED') {
        const t = tasks.get(row.task_id) || { key, label: taskLabel(key || row.task_name), createdAt: null };
        t.completedAt = row.performed_at;
        const links = [];
        const { details, decision } = describeVars(json?.user_vars || {}, links);
        // Tâches complétées via leur formulaire : l'auteur est sur le document
        const docActor = key === 'Activity_POApproval' ? nameById.get(pos.find(p => p.approved_by)?.approved_by)
          : key === 'Activity_ProcessPayment' ? nameById.get(payments[0]?.created_by || payments[0]?.approved_by)
          : null;
        // Auteur inconnu (données antérieures) : on indique le rôle attendu plutôt que « Système »
        const actor = who(row) || t.claimedBy || docActor || (TASK_GROUPS[key] ? `Rôle : ${TASK_GROUPS[key]}` : 'Système');
        const took = t.createdAt ? duration(t.createdAt, row.performed_at) : null;
        if (took) details.push(`Traitée en ${took}`);
        t.decision = decision;
        t.event = {
          date: row.performed_at,
          kind: decision === 'REJECTED' ? 'danger' : 'success',
          title: `${t.label}${decision === 'APPROVED' ? ' — approuvée' : decision === 'REJECTED' ? ' — rejetée' : ' — terminée'}`,
          actor,
          details,
          links,
        };
        events.push(t.event);
        tasks.set(row.task_id, t);
        continue;
      }
      // Décision enregistrée par TaskController (doublon de TASK_COMPLETED : on complète l'événement)
      if ((action === 'APPROVED' || action === 'REJECTED') && TASK_GROUPS[row.task_name]) {
        const t = tasks.get(row.task_id);
        if (t?.event) {
          if (row.comments && !t.event.details.some(d => d.startsWith('Commentaire'))) {
            t.event.details.unshift(`Commentaire : « ${row.comments} »`);
          }
        } else {
          events.push({
            date: row.performed_at, kind: action === 'REJECTED' ? 'danger' : 'success',
            title: `${taskLabel(row.task_name)} — ${action === 'REJECTED' ? 'rejetée' : 'approuvée'}`,
            actor: who(row) || 'Système', details: row.comments ? [`Commentaire : « ${row.comments} »`] : [], links: [],
          });
        }
        continue;
      }

      const name = row.task_name || '';
      if (action === 'NOTIFICATION_SENT' || action.startsWith('CLASSIFIED_')) continue; // bruit / doublon

      if (action === 'CREATED') {
        events.push({ date: row.performed_at, kind: 'info', title: 'Réquisition créée', actor: who(row) || req.requester_name, details: [], links: [] });
      } else if (action === 'PROCESS_STARTED') {
        events.push({ date: row.performed_at, kind: 'info', title: 'Circuit de validation démarré', actor: 'Système', details: [], links: [] });
      } else if (action === 'PROCESS_START_FAILED') {
        const reason = (row.comments || '').split(':').slice(1).join(':').trim();
        events.push({ date: row.performed_at, kind: 'danger', title: 'Échec du démarrage du circuit de validation', actor: 'Système', details: reason ? [reason] : ['Le moteur de workflow n\'a pas répondu'], links: [] });
      } else if (name.startsWith('Budget Check - ')) {
        const m = /Available:\s*([\d.]+).*Requested:\s*([\d.]+)/i.exec(row.comments || '');
        budgetLines.push(`${name.replace('Budget Check - ', '')} : demandé ${m ? fmtNum(m[2]) : '?'} / disponible ${m ? fmtNum(m[1]) : '?'}${action === 'Budget Available' ? '' : ' — insuffisant'}`);
      } else if (name === 'Budget Check Summary') {
        const ok = action === 'All Budgets Available';
        budget = { ok, date: row.performed_at };
        events.push({ date: row.performed_at, kind: ok ? 'success' : 'danger', title: ok ? 'Budget vérifié — disponible' : 'Budget vérifié — insuffisant', actor: 'Système', details: [...budgetLines], links: [] });
      } else if (name === 'Procurement Classification') {
        classification = { method: action, date: row.performed_at };
        events.push({
          date: row.performed_at, kind: 'info', title: `Méthode d'achat : ${METHOD_LABELS[action] || action}`, actor: 'Système',
          details: row.comments ? [`Motif : ${REASON_LABELS[row.comments] || row.comments}`] : [], links: [],
        });
      } else if (name === 'Offer Analysis') {
        events.push({ date: row.performed_at, kind: 'info', title: 'Analyse des offres terminée', actor: 'Système', details: [], links: [] });
      } else if (name === 'Send PO Notification') {
        events.push({ date: row.performed_at, kind: 'info', title: 'Bon de commande envoyé au fournisseur par email', actor: 'Système', details: [], links: [] });
      } else if (name === 'Invoice 3-Way Match') {
        events.push({
          date: row.performed_at, kind: action === 'MATCHED' ? 'success' : 'warning',
          title: `Rapprochement commande / réception / facture : ${MATCH_LABELS[action] || action}`, actor: 'Système',
          details: row.comments ? [row.comments] : [], links: [],
        });
      } else if (action === 'TENDER_PUBLISHED' || action === 'TENDER_AWARDED') {
        events.push({
          date: row.performed_at, kind: action === 'TENDER_AWARDED' ? 'success' : 'info',
          title: action === 'TENDER_AWARDED' ? 'Marché attribué' : 'Appel d\'offres publié', actor: who(row) || 'Système',
          details: row.comments ? [row.comments] : [], links: tender ? [{ label: tender.tender_number, to: `/tenders/${tender.id}` }] : [],
        });
      } else {
        events.push({
          date: row.performed_at, kind: 'info', title: taskLabel(key || name) || action, actor: who(row) || 'Système',
          details: [action, json ? null : row.comments].filter(Boolean), links: [],
        });
      }
    }

    // Tâches en attente
    const pending = [...tasks.values()].filter(t => !t.completedAt);
    for (const t of pending) {
      const details = [`Rôle attendu : ${TASK_GROUPS[t.key] || '—'}`];
      if (t.claimedBy) details.push(`Prise en charge par ${t.claimedBy}`);
      if (t.createdAt) details.push(`En attente depuis ${duration(t.createdAt, new Date()) || 'quelques instants'}`);
      events.push({ date: t.createdAt, kind: 'warning', title: `En attente : ${t.label}`, actor: null, details, links: [], pending: true });
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
    const finished = req.status === 'COMPLETED' || processCompleted || (!req.process_instance_id && paid);
    const links = (list, numberKey, base) => list.map(d => ({ label: d[numberKey], to: `${base}/${d.id}` }));

    const steps = [
      { key: 'created', label: 'Création', status: 'done', date: req.created_at, info: req.requester_name },
      { key: 'budget', label: 'Vérification budgétaire', status: budget ? (budget.ok ? 'done' : 'failed') : 'pending', date: budget?.date },
      {
        key: 'approval', label: 'Approbation hiérarchique',
        status: approvalRejected ? 'failed' : approvals.length ? 'done' : 'pending',
        date: approvals.at(-1)?.completedAt,
        info: approvals.map(t => `${t.label.replace('Approbation hiérarchique ', '')} : ${t.decision === 'REJECTED' ? 'rejetée' : 'approuvée'}`).join(' · ') || null,
      },
      { key: 'method', label: 'Méthode d\'achat', status: classification ? 'done' : 'pending', date: classification?.date, info: classification ? METHOD_LABELS[classification.method] || classification.method : null },
      {
        key: 'sourcing', label: 'Sélection du fournisseur', status: sourcingDone || activePos.length ? 'done' : 'pending',
        date: sourcingDone?.completedAt, info: sourcingDone?.label || null,
        links: tender ? [{ label: tender.tender_number, to: `/tenders/${tender.id}` }] : [],
      },
      { key: 'po', label: 'Bon de commande', status: activePos.length ? 'done' : pos.length ? 'failed' : 'pending', date: activePos[0]?.created_at, links: links(pos, 'po_number', '/purchase-orders') },
      {
        key: 'po_approval', label: 'Approbation du bon de commande',
        status: activePos.some(p => PO_APPROVED.includes(p.status)) ? 'done' : pos.some(p => PO_REJECTED.includes(p.status)) && !activePos.length ? 'failed' : 'pending',
        date: activePos.find(p => p.approved_at)?.approved_at,
        info: nameById.get(activePos.find(p => p.approved_by)?.approved_by) ? `Approuvé par ${nameById.get(activePos.find(p => p.approved_by).approved_by)}` : null,
      },
      { key: 'supplier_confirmation', label: 'Confirmation fournisseur', status: done('Activity_SupplierConfirmation') || grns.length ? 'done' : 'pending', date: done('Activity_SupplierConfirmation')?.completedAt },
      { key: 'grn', label: 'Réception (GRN)', status: grns.length ? 'done' : 'pending', date: grns[0]?.receipt_date || grns[0]?.created_at, links: links(grns, 'grn_number', '/goods-receipts') },
      { key: 'san', label: 'Acceptation de service (SAN)', status: sans.length ? 'done' : 'pending', date: sans[0]?.acceptance_date || sans[0]?.created_at, links: links(sans, 'san_number', '/service-acceptance-notes') },
      {
        key: 'invoice', label: 'Facture & rapprochement', status: invoices.length ? 'done' : 'pending', date: invoices[0]?.created_at,
        info: invoices[0]?.match_status ? `Rapprochement : ${MATCH_LABELS[invoices[0].match_status] || invoices[0].match_status}` : null,
        links: links(invoices, 'invoice_number', '/invoices'),
      },
      {
        key: 'payment', label: 'Paiement', status: paid ? 'done' : 'pending', date: payments[0]?.created_at,
        info: payments.length ? `Montant payé : ${fmtNum(payments.reduce((s, p) => s + parseFloat(p.amount || 0), 0))}` : null,
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
          const who = t.claimedBy ? `pris en charge par ${t.claimedBy}` : `rôle ${TASK_GROUPS[t.key] || 'non défini'}`;
          // Libellé de tâche répété seulement s'il diffère de l'étape (ex. « Achat direct » dans « Sélection du fournisseur »)
          const task = t.label === current.label ? '' : ` : ${t.label}`;
          current.info = [current.info, `En attente${task} — ${who}`].filter(Boolean).join(' · ');
        }
      }
    }
    if (stopped) {
      const failedIdx = steps.findIndex(s => s.status === 'failed');
      steps.forEach((s, i) => { if (s.status === 'pending' && (failedIdx < 0 || i > failedIdx)) s.status = 'skipped'; });
      if (req.status === 'CANCELLED') {
        events.push({ date: null, kind: 'danger', title: 'Réquisition annulée', actor: null, details: req.rejected_reason ? [req.rejected_reason] : [], links: [] });
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
