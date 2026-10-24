// backend/src/controllers/TenderController.js
const db = require('../config/database');
const tenderModel = require('../models/TenderModel');
const notificationModel = require('../models/NotificationModel');
const camundaService = require('../services/CamundaService');
const emailService = require('../services/EmailNotificationService');
const { generateComparisonWorkbook } = require('../services/TenderExportService');
const submissionPdfService = require('../services/TenderSubmissionPdfService');
const { getSupplierByUser, parseIdList } = require('./SupplierPortalController');
const referenceModel = require('../models/ReferenceModel');
const supplierModel = require('../models/SupplierModel');
const i18n = require('../i18n');
const allocationService = require('../services/SupplierAllocationService');

const { appLink } = require('../utils/appUrl');

const EDITABLE = ['OPEN', 'UPCOMING'];

// Les prix restent scellés tant que les soumissions sont ouvertes (ou pas encore ouvertes)
const isSealed = (tender) => EDITABLE.includes(tender.effective_status);

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(d, lang) {
  return new Date(d).toLocaleString(i18n.locale(lang), {
    dateStyle: 'long', timeStyle: 'short', timeZone: process.env.APP_TIMEZONE || 'Africa/Kinshasa'
  });
}

function validateTenderPayload(b, { requireNumber }) {
  const errors = [];
  if (requireNumber && !b.tenderNumber?.trim()) errors.push("Numéro de l'appel d'offres requis");
  if (requireNumber && b.tenderNumber && b.tenderNumber.trim().length > 50) errors.push('Numéro : 50 caractères maximum');
  if (!b.title?.trim()) errors.push('Titre requis');
  const start = new Date(b.startDate);
  const end = new Date(b.endDate);
  if (isNaN(start)) errors.push('Date de début invalide');
  if (isNaN(end)) errors.push('Date de fin invalide');
  if (!isNaN(start) && !isNaN(end) && end <= start) errors.push('La date de fin doit être après la date de début');
  if (!isNaN(end) && end <= new Date()) errors.push('La date de fin doit être dans le futur');
  const days = parseInt(b.maxDeliveryDays);
  if (!Number.isInteger(days) || days <= 0) errors.push('Nombre de jours de livraison invalide');
  if (b.audience !== undefined && !AUDIENCES.includes(b.audience)) errors.push('Type de diffusion invalide');
  if (b.awardMode !== undefined && !AWARD_MODES.includes(b.awardMode)) errors.push('Mode d\x27attribution invalide');
  if (b.audience === 'PREQUALIFIED' && !parseInt(b.categoryId)) {
    errors.push('Catégorie de marché requise pour un appel d\'offres réservé aux fournisseurs préqualifiés');
  }
  return errors;
}

const AUDIENCES = ['ALL', 'PREQUALIFIED'];
// Mode d'attribution annoncé à la publication (migration 39) : un seul attributaire, ou article par article
const AWARD_MODES = ['SINGLE', 'PER_ITEM'];

/**
 * AO réservé : fournisseurs sélectionnés, tous parmi les candidats (préqualifiés de la catégorie et de la
 * localisation). allowed = ids acceptés en plus (déjà invités ayant soumis, conservés de toute façon).
 */
async function selectedSuppliers(body, target, allowed = new Set()) {
  const ids = [...new Set(parseIdList(body.supplierIds))];
  if (!ids.length) {
    throw Object.assign(new Error('Sélectionnez au moins un fournisseur préqualifié à inviter'), { status: 400 });
  }
  const candidates = new Set((await tenderModel.getCandidates(target)).map(c => c.id));
  const invalid = ids.filter(id => !candidates.has(id) && !allowed.has(id));
  if (invalid.length) {
    throw Object.assign(new Error('Certains fournisseurs sélectionnés ne sont pas préqualifiés dans cette catégorie / localisation'), { status: 400 });
  }
  return ids;
}

/** Diffusion, catégorie et localisation validées (catégorie / localisation existantes) */
async function targeting(b) {
  const categoryId = parseInt(b.categoryId) || null;
  const locationId = parseInt(b.locationId) || null;
  if (categoryId && !(await referenceModel.getById('market_categories', categoryId))) {
    throw Object.assign(new Error('Catégorie de marché inconnue'), { status: 400 });
  }
  if (locationId && !(await referenceModel.getById('locations', locationId))) {
    throw Object.assign(new Error('Localisation inconnue'), { status: 400 });
  }
  return { audience: AUDIENCES.includes(b.audience) ? b.audience : 'ALL', categoryId, locationId };
}

async function notifyUser(io, userId, title, message, type, link) {
  await notificationModel.create({ userId, title, message, type, link });
  io?.to(`user-${userId}`).emit('notification', { title, message, type, link, timestamp: new Date().toISOString() });
}

/**
 * Notifie (in-app + email) tous les fournisseurs inscrits, chacun dans sa langue. Ne lève pas d'erreur.
 * kind : 'published' | 'invitation' | 'updated' (textes email.tender.<kind>.title / intro)
 */
async function notifySuppliers(io, tender, kind, { only, exclude } = {}) {
  try {
    const recipients = (await tenderModel.getRegisteredSupplierRecipients(tender.id))
      .filter(r => (!only || only.has(r.id)) && (!exclude || !exclude.has(r.id)));
    const link = `/supplier/tenders/${tender.id}`;
    for (const r of recipients) {
      const T = i18n.translator(r.language);
      const title = T(`email.tender.${kind}.title`);
      await notifyUser(io, r.user_id, title, `${tender.tender_number} — ${tender.title}`, 'INFO', link);
      const html = `
        <p>${T('email.hello', { name: escapeHtml(r.name) })}</p>
        <p>${T(`email.tender.${kind}.intro`)}</p>
        <table cellpadding="4">
          <tr><td><b>${T('email.tender.number')}</b></td><td>${escapeHtml(tender.tender_number)}</td></tr>
          <tr><td><b>${T('email.tender.object')}</b></td><td>${escapeHtml(tender.title)}</td></tr>
          <tr><td><b>${T('email.tender.opening')}</b></td><td>${fmtDate(tender.start_date, r.language)}</td></tr>
          <tr><td><b>${T('email.tender.closing')}</b></td><td>${fmtDate(tender.end_date, r.language)}</td></tr>
          <tr><td><b>${T('email.tender.maxDelivery')}</b></td><td>${T('email.tender.days', { n: tender.max_delivery_days })}</td></tr>
        </table>
        <p><a href="${appLink(link)}">${T('email.tender.link')}</a></p>`;
      // Pas d'await : l'envoi SMTP ne doit pas bloquer la réponse
      emailService.sendEmail(r.user_email || r.supplier_email, `${title} — ${tender.tender_number}`, html);
    }
    return recipients.length;
  } catch (e) {
    console.error('[Tender] notifySuppliers (non-fatal):', e.message);
    return 0;
  }
}

const err = (status, code, message, details) => Object.assign(new Error(message), { status, code, details });

/**
 * Attribution article par article (AO en mode PER_ITEM) : body.items = [{ requisitionItemId, supplierId }].
 * Chaque article chiffré par au moins une offre est attribué à une offre qui l'a chiffré ; un article sans offre
 * n'est pas commandé. Un seul attributaire : chemin habituel (awarded_supplier_id). Plusieurs : une part par
 * fournisseur (requisition_supplier_lots), et l'étape Activity_RFPProcess se termine avec supplierLots = [parts] —
 * le sous-processus de commande du BPMN est répété par part. Écritures et complétion GoFlow dans une transaction.
 */
async function awardPerItem(req, res, tender, submissions) {
  try {
    if (tender.award_mode !== 'PER_ITEM') {
      throw err(400, 'AWARD_MODE_SINGLE', 'Cet appel d\'offres a été publié pour un attributaire unique');
    }
    const reqItems = await tenderModel.getItems(tender.requisition_id);
    const itemById = new Map(reqItems.map(i => [String(i.id), i]));
    // Offre de chaque fournisseur pour chaque article chiffré
    const quote = (supplierId, itemId) => {
      const sub = submissions.find(s => String(s.supplier_id) === String(supplierId));
      const line = sub?.items.find(i => String(i.requisition_item_id) === String(itemId));
      return line ? { sub, line } : null;
    };
    const quoted = new Set(submissions.flatMap(s => s.items.map(i => String(i.requisition_item_id))));

    const awards = [];
    const seen = new Set();
    for (const a of req.body.items) {
      const itemId = String(a?.requisitionItemId || '');
      if (!itemById.has(itemId)) throw err(400, 'ITEM_NOT_FOUND', 'Article absent de la réquisition', { itemId });
      if (seen.has(itemId)) throw err(400, 'ITEM_AWARDED_TWICE', 'Un article ne peut être attribué qu\'une fois', { itemId });
      seen.add(itemId);
      const q = quote(a.supplierId, itemId);
      if (!q) throw err(400, 'ITEM_NOT_QUOTED', 'Ce fournisseur n\'a pas chiffré cet article', { itemId, supplierId: a.supplierId });
      awards.push({ itemId: Number(itemId), supplierId: q.sub.supplier_id, supplierName: q.sub.supplier_name, submissionId: q.sub.id,
        unitPrice: parseFloat(q.line.unit_price), totalPrice: parseFloat(q.line.total_price) });
    }
    const notAwarded = [...quoted].filter(id => !seen.has(id));
    if (notAwarded.length) throw err(400, 'ITEM_NOT_AWARDED', 'Attribuez chaque article ayant reçu une offre', { itemIds: notAwarded.map(Number) });
    if (!awards.length) throw err(400, 'AWARD_REQUIRED', 'Aucun article attribué');

    // Une part par fournisseur, dans l'ordre des articles
    const bySupplier = new Map();
    for (const a of [...awards].sort((x, y) => x.itemId - y.itemId)) {
      if (!bySupplier.has(a.supplierId)) bySupplier.set(a.supplierId, { supplierId: a.supplierId, supplierName: a.supplierName, itemIds: [], amount: 0 });
      const lot = bySupplier.get(a.supplierId);
      lot.itemIds.push(a.itemId);
      lot.amount += a.totalPrice;
    }
    const winners = [...bySupplier.values()];
    const split = winners.length > 1;

    // Étape GoFlow « Appel d'offres » ouverte ; un processus démarré avant la répartition ne sait pas la traiter
    let rfpTask = null;
    if (tender.process_instance_id) {
      rfpTask = ((await camundaService.getProcessTasks(tender.process_instance_id)) || [])
        .find(t => t.taskDefinitionKey === 'Activity_RFPProcess') || null;
      if (split && rfpTask) {
        const vars = await camundaService.getProcessVariables(tender.process_instance_id);
        if (vars.supplierLots === undefined) {
          throw err(409, 'SPLIT_NOT_SUPPORTED', 'Processus démarré avant la répartition par fournisseur : attribuez tous les articles à un seul fournisseur');
        }
      }
    }

    const result = await db.withTransaction(async (tx) => {
      for (const a of awards) {
        await tx.exec(
          `INSERT INTO tender_awards (tender_id, requisition_item_id, submission_id, supplier_id, unit_price, total_price, awarded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [tender.id, a.itemId, a.submissionId, a.supplierId, a.unitPrice, a.totalPrice, req.user.id]
        );
      }
      await tx.exec(
        `UPDATE tenders SET status = 'AWARDED', awarded_supplier_id = $2, awarded_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [tender.id, split ? null : winners[0].supplierId]
      );
      const lotIds = split
        ? await allocationService.insertLots(tx, tender.requisition_id, winners.map(w => ({
          supplierId: w.supplierId, itemIds: w.itemIds, amount: Math.round(w.amount * 100) / 100,
        })), { userId: req.user.id, taskId: rfpTask?.id || null, tenderId: tender.id })
        : null;
      if (rfpTask) {
        const vars = {
          tenderId: tender.id,
          tenderNumber: tender.tender_number,
          offers: JSON.stringify(winners.map(w => ({ supplierId: w.supplierId, supplierName: w.supplierName, amount: w.amount }))),
          allOffers: JSON.stringify(submissions.map(s => ({
            supplierId: s.supplier_id, supplierName: s.supplier_name, amount: parseFloat(s.total_amount), deliveryDays: s.delivery_days,
          }))),
          ...(lotIds ? { supplierLots: lotIds } : {}),
          ...(req.body.comment ? { comment: req.body.comment } : {}),
        };
        // GoFlow en dernier : en cas de refus, l'attribution est annulée avec la transaction
        const done = await camundaService.completeTask(rfpTask.id, vars);
        if (!done?.success) throw err(502, 'GOFLOW_ERROR', done?.error || 'GoFlow n\'a pas accepté la fin de l\'étape');
      }
      return { lotIds };
    });

    const summary = winners.map(w => `${w.supplierName} (${w.itemIds.length})`).join(', ');
    await db.insert('workflow_history', {
      entity_type: 'requisition',
      entity_id: tender.requisition_id,
      task_id: rfpTask?.id || tender.task_id || null,
      task_name: 'Activity_RFPProcess',
      action: 'TENDER_AWARDED',
      comments: `${tender.tender_number} attribué par article : ${summary}${req.body.comment ? ' — ' + req.body.comment : ''}`,
      performed_by: req.user.id,
      performed_at: new Date()
    });

    // Soumissionnaires : chacun apprend s'il a remporté des articles (et combien), jamais ceux des autres
    const owners = await db.select(
      `SELECT s.id, s.user_id, u.language FROM suppliers s
       JOIN tender_submissions ts ON ts.supplier_id = s.id
       JOIN users u ON u.id = s.user_id
       WHERE ts.tender_id = $1`,
      [tender.id]
    );
    for (const o of owners) {
      const won = bySupplier.get(o.id);
      const T = i18n.translator(o.language);
      await notifyUser(req.io, o.user_id,
        T(won ? 'notification.tender.wonTitle' : 'notification.tender.lostTitle'),
        won ? T('notification.tender.wonItemsMessage', { number: tender.tender_number, count: won.itemIds.length })
          : T('notification.tender.lostMessage', { number: tender.tender_number }),
        won ? 'SUCCESS' : 'INFO',
        `/supplier/tenders/${tender.id}`);
    }

    res.json({
      success: true, camundaTaskCompleted: !!rfpTask, split, lotIds: result.lotIds || [],
      winners: winners.map(w => ({ supplierId: w.supplierId, supplierName: w.supplierName, itemIds: w.itemIds, amount: w.amount })),
      message: `Attribué par article : ${summary}`,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, code: error.code, message: error.message, details: error.details });
    console.error('Error awarding tender per item:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

class TenderController {

  // =================== PROCUREMENT ===================

  async list(req, res) {
    try {
      const data = await tenderModel.getAll({ status: req.query.status, search: req.query.search });
      res.json({ success: true, data, registeredSuppliers: await tenderModel.countRegisteredSuppliers() });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /** GET /tenders/candidates?categoryId=&locationId= — préqualifiés que l'acheteur peut inviter */
  async candidates(req, res) {
    try {
      const { categoryId, locationId } = await targeting(req.query);
      if (!categoryId) return res.status(400).json({ success: false, message: 'categoryId est requis' });
      res.json({ success: true, data: await tenderModel.getCandidates({ categoryId, locationId }) });
    } catch (error) {
      res.status(error.status || 500).json({ success: false, message: error.message });
    }
  }

  /** GET /tenders/eligible-count?audience=&categoryId=&locationId= — fournisseurs qui verront l'AO (diffusion « tous ») */
  async eligibleCount(req, res) {
    try {
      const { audience, categoryId, locationId } = await targeting(req.query);
      const r = await db.one(
        `SELECT COUNT(*)::int AS count FROM suppliers s
         JOIN users u ON u.id = s.user_id
         WHERE u.is_active = true AND s.status = 'ACTIVE'
           AND ($1 = 'ALL' OR (
             EXISTS (SELECT 1 FROM supplier_prequalifications sp
                     WHERE sp.supplier_id = s.id AND sp.enterprise_id = $2 AND sp.category_id = $3 AND sp.status = 'APPROVED')
             AND ($4::int IS NULL OR EXISTS (SELECT 1 FROM supplier_locations sl WHERE sl.supplier_id = s.id AND sl.location_id = $4))))`,
        [audience, req.enterpriseId, categoryId, locationId]
      );
      res.json({ success: true, data: { count: r.count } });
    } catch (error) {
      res.status(error.status || 500).json({ success: false, message: error.message });
    }
  }

  async getByRequisition(req, res) {
    try {
      const tender = await tenderModel.getByRequisition(req.params.requisitionId);
      res.json({ success: true, data: tender || null });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getOne(req, res) {
    try {
      const tender = await tenderModel.getById(req.params.id);
      if (!tender) return res.status(404).json({ success: false, message: 'Appel d\'offres introuvable' });
      const [items, allSubmissions, registeredSuppliers] = await Promise.all([
        tenderModel.getItems(tender.requisition_id),
        tenderModel.getSubmissions(tender.id),
        tenderModel.countRegisteredSuppliers(tender.id)
      ]);
      // Offres scellées : avant la clôture, seuls le nom du soumissionnaire et la date sont visibles
      const sealed = isSealed(tender);
      const submissions = sealed
        ? allSubmissions
          .map(s => ({
            id: s.id, supplier_id: s.supplier_id, supplier_name: s.supplier_name, supplier_code: s.supplier_code,
            logo_path: s.logo_path, submitted_at: s.submitted_at, updated_at: s.updated_at
          }))
          .sort((a, b) => a.supplier_name.localeCompare(b.supplier_name))
        : allSubmissions;
      const invitations = tender.audience === 'PREQUALIFIED' ? await tenderModel.getInvitations(tender.id) : [];
      const awards = tender.status === 'AWARDED' ? await tenderModel.getAwards(tender.id) : [];
      res.json({ success: true, data: { ...tender, items, submissions, registeredSuppliers, sealed, invitations, awards } });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async create(req, res) {
    try {
      const b = req.body;
      if (!b.requisitionId) return res.status(400).json({ success: false, message: 'requisitionId est requis' });
      const errors = validateTenderPayload(b, { requireNumber: true });
      if (errors.length) return res.status(400).json({ success: false, message: errors.join(' · ') });

      const requisition = await db.one('SELECT id, requisition_number FROM requisitions WHERE id = $1', [b.requisitionId]);
      if (!requisition) return res.status(404).json({ success: false, message: 'Réquisition introuvable' });

      const items = await tenderModel.getItems(b.requisitionId);
      if (items.length === 0) {
        return res.status(400).json({ success: false, message: 'La réquisition ne contient aucun item' });
      }
      if (await tenderModel.getByNumber(b.tenderNumber.trim())) {
        return res.status(409).json({ success: false, message: `Le numéro ${b.tenderNumber.trim()} est déjà utilisé` });
      }
      const existing = await tenderModel.getByRequisition(b.requisitionId);
      if (existing) {
        return res.status(409).json({
          success: false,
          message: `Un appel d'offres (${existing.tender_number}) existe déjà pour cette réquisition`,
          data: { id: existing.id }
        });
      }

      const target = await targeting(b);
      const invited = target.audience === 'PREQUALIFIED' ? await selectedSuppliers(b, target) : [];
      const tender = await tenderModel.create({
        ...target,
        tenderNumber: b.tenderNumber.trim(),
        requisitionId: b.requisitionId,
        taskId: b.taskId,
        title: b.title.trim(),
        description: b.description,
        startDate: new Date(b.startDate),
        endDate: new Date(b.endDate),
        maxDeliveryDays: parseInt(b.maxDeliveryDays),
        awardMode: AWARD_MODES.includes(b.awardMode) ? b.awardMode : 'SINGLE',
        createdBy: req.user.id
      });

      await db.insert('workflow_history', {
        entity_type: 'requisition',
        entity_id: b.requisitionId,
        task_id: b.taskId || null,
        task_name: 'Activity_RFPProcess',
        action: 'TENDER_PUBLISHED',
        comments: `Appel d'offres ${tender.tender_number} publié${invited.length ? ` (${invited.length} fournisseur(s) invité(s))` : ''}`,
        performed_by: req.user.id,
        performed_at: new Date()
      });
      if (invited.length) await tenderModel.setInvitations(tender.id, invited, req.user.id);

      const notified = await notifySuppliers(req.io, tender, invited.length ? 'invitation' : 'published');

      res.status(201).json({ success: true, data: tender, notifiedSuppliers: notified, message: 'Appel d\'offres publié' });
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({ success: false, message: 'Ce numéro d\'appel d\'offres est déjà utilisé' });
      }
      if (error.status) return res.status(error.status).json({ success: false, message: error.message });
      console.error('Error creating tender:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async update(req, res) {
    try {
      const tender = await tenderModel.getById(req.params.id);
      if (!tender) return res.status(404).json({ success: false, message: 'Appel d\'offres introuvable' });
      if (!EDITABLE.includes(tender.effective_status) && tender.effective_status !== 'CLOSED') {
        return res.status(400).json({ success: false, message: 'Cet appel d\'offres ne peut plus être modifié' });
      }
      // Après clôture, les prix ont été dévoilés : rouvrir les soumissions casserait le secret des offres
      if (tender.effective_status === 'CLOSED' && (await tenderModel.getSubmissions(tender.id)).length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Des offres ont déjà été ouvertes : l\'appel d\'offres ne peut plus être prolongé'
        });
      }
      const errors = validateTenderPayload(req.body, { requireNumber: false });
      if (errors.length) return res.status(400).json({ success: false, message: errors.join(' · ') });
      // Mode d'attribution : annoncé aux fournisseurs, il ne change plus une fois une offre déposée
      const awardMode = AWARD_MODES.includes(req.body.awardMode) ? req.body.awardMode : null;
      if (awardMode && awardMode !== tender.award_mode && (await tenderModel.getSubmissions(tender.id)).length) {
        return res.status(409).json({ success: false, code: 'AWARD_MODE_LOCKED', message: 'Des offres ont déjà été déposées : le mode d\x27attribution ne peut plus changer' });
      }

      const target = await targeting({ audience: tender.audience, categoryId: tender.category_id, locationId: tender.location_id, ...req.body });
      let invitedChange = null;
      let invited = null;
      if (target.audience === 'PREQUALIFIED' && (req.body.supplierIds !== undefined || tender.audience !== 'PREQUALIFIED')) {
        const submittedIds = new Set((await tenderModel.getInvitations(tender.id)).filter(i => i.submitted).map(i => i.supplier_id));
        invited = await selectedSuppliers(req.body, target, submittedIds);
      }
      await tenderModel.update(tender.id, {
        ...target,
        title: req.body.title.trim(),
        description: req.body.description,
        startDate: new Date(req.body.startDate),
        endDate: new Date(req.body.endDate),
        maxDeliveryDays: parseInt(req.body.maxDeliveryDays),
        awardMode
      });
      if (invited) invitedChange = await tenderModel.setInvitations(tender.id, invited, req.user.id);
      const updated = await tenderModel.getById(tender.id);
      const newlyInvited = new Set(invitedChange?.added || []);
      if (newlyInvited.size) {
        await notifySuppliers(req.io, updated, 'invitation', { only: newlyInvited });
      }
      await notifySuppliers(req.io, updated, 'updated', { exclude: newlyInvited });
      res.json({ success: true, data: updated, invitations: invitedChange });
    } catch (error) {
      res.status(error.status || 500).json({ success: false, message: error.message });
    }
  }

  /** Clôture anticipée (ex : tous les fournisseurs ont soumis) */
  async close(req, res) {
    try {
      const tender = await tenderModel.getById(req.params.id);
      if (!tender) return res.status(404).json({ success: false, message: 'Appel d\'offres introuvable' });
      if (tender.effective_status !== 'OPEN') {
        return res.status(400).json({ success: false, message: 'Seul un appel d\'offres ouvert peut être clôturé' });
      }
      await db.exec('UPDATE tenders SET end_date = NOW(), updated_at = NOW() WHERE id = $1', [tender.id]);
      res.json({ success: true, message: 'Appel d\'offres clôturé' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async cancel(req, res) {
    try {
      const tender = await tenderModel.getById(req.params.id);
      if (!tender) return res.status(404).json({ success: false, message: 'Appel d\'offres introuvable' });
      if (tender.status !== 'OPEN') {
        return res.status(400).json({ success: false, message: 'Cet appel d\'offres ne peut plus être annulé' });
      }
      await tenderModel.setStatus(tender.id, { status: 'CANCELLED' });
      res.json({ success: true, message: 'Appel d\'offres annulé' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async exportExcel(req, res) {
    try {
      const tender = await tenderModel.getById(req.params.id);
      if (!tender) return res.status(404).json({ success: false, message: 'Appel d\'offres introuvable' });
      if (isSealed(tender)) {
        return res.status(400).json({
          success: false,
          message: 'Offres scellées : le tableau comparatif sera disponible après la clôture des soumissions'
        });
      }
      const [items, submissions] = await Promise.all([
        tenderModel.getItems(tender.requisition_id),
        tenderModel.getSubmissions(tender.id)
      ]);
      const buffer = await generateComparisonWorkbook(tender, items, submissions);
      const fileName = `comparatif_${tender.tender_number.replace(/[^\w.-]+/g, '_')}.xlsx`;
      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.set('Content-Disposition', `attachment; filename="${fileName}"`);
      res.end(Buffer.from(buffer));
    } catch (error) {
      console.error('Error exporting tender comparison:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Attribution : complète la tâche Camunda Activity_RFPProcess.
   * `offers` ne contient que l'offre retenue pour que le worker analyze_offers
   * reprenne la décision du procurement (et pas seulement le prix le plus bas).
   */
  async award(req, res) {
    try {
      const { supplierId, comment } = req.body;
      const tender = await tenderModel.getById(req.params.id);
      if (!tender) return res.status(404).json({ success: false, message: 'Appel d\'offres introuvable' });
      if (tender.effective_status !== 'CLOSED') {
        return res.status(400).json({
          success: false,
          message: tender.effective_status === 'AWARDED'
            ? 'Cet appel d\'offres est déjà attribué'
            : 'L\'attribution n\'est possible qu\'après la clôture des soumissions'
        });
      }
      const submissions = await tenderModel.getSubmissions(tender.id);
      // Attribution article par article (AO publié en mode PER_ITEM)
      if (Array.isArray(req.body.items)) return awardPerItem(req, res, tender, submissions);
      const winner = submissions.find(s => String(s.supplier_id) === String(supplierId));
      if (!winner) return res.status(400).json({ success: false, message: 'Ce fournisseur n\'a pas soumis d\'offre' });

      await tenderModel.setStatus(tender.id, {
        status: 'AWARDED', awarded_supplier_id: winner.supplier_id, awarded_at: new Date()
      });

      const completionVars = {
        tenderId: tender.id,
        tenderNumber: tender.tender_number,
        selectedSupplierId: winner.supplier_id,
        selectedAmount: parseFloat(winner.total_amount),
        offers: JSON.stringify([{
          supplierId: winner.supplier_id, supplierName: winner.supplier_name, amount: parseFloat(winner.total_amount)
        }]),
        allOffers: JSON.stringify(submissions.map(s => ({
          supplierId: s.supplier_id, supplierName: s.supplier_name,
          amount: parseFloat(s.total_amount), deliveryDays: s.delivery_days
        })))
      };
      if (comment) completionVars.comment = comment;

      let camundaTaskCompleted = false;
      try {
        let taskId = tender.task_id;
        if (tender.process_instance_id) {
          const tasks = await camundaService.getProcessTasks(tender.process_instance_id);
          const rfpTask = (tasks || []).find(t => t.taskDefinitionKey === 'Activity_RFPProcess');
          taskId = rfpTask?.id || null;
        }
        if (taskId) {
          const result = await camundaService.completeTask(taskId, completionVars);
          camundaTaskCompleted = !!result.success;
        }
      } catch (e) {
        console.error('[Tender] Camunda completeTask (non-fatal):', e.message);
      }

      await db.insert('workflow_history', {
        entity_type: 'requisition',
        entity_id: tender.requisition_id,
        task_id: tender.task_id || null,
        task_name: 'Activity_RFPProcess',
        action: 'TENDER_AWARDED',
        comments: `${tender.tender_number} attribué à ${winner.supplier_name} (${winner.total_amount})${comment ? ' — ' + comment : ''}`,
        performed_by: req.user.id,
        performed_at: new Date()
      });

      // Informer les soumissionnaires
      const owners = await db.select(
        `SELECT s.id, s.user_id, u.language FROM suppliers s
         JOIN tender_submissions ts ON ts.supplier_id = s.id
         JOIN users u ON u.id = s.user_id
         WHERE ts.tender_id = $1`,
        [tender.id]
      );
      for (const o of owners) {
        const won = String(o.id) === String(winner.supplier_id);
        const T = i18n.translator(o.language);
        await notifyUser(req.io, o.user_id,
          T(won ? 'notification.tender.wonTitle' : 'notification.tender.lostTitle'),
          T(won ? 'notification.tender.wonMessage' : 'notification.tender.lostMessage', { number: tender.tender_number }),
          won ? 'SUCCESS' : 'INFO',
          `/supplier/tenders/${tender.id}`);
      }

      res.json({ success: true, camundaTaskCompleted, message: `Attribué à ${winner.supplier_name}` });
    } catch (error) {
      console.error('Error awarding tender:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // =================== FOURNISSEUR ===================

  async supplierList(req, res) {
    try {
      const supplier = await getSupplierByUser(req.user.id);
      if (!supplier) return res.status(403).json({ success: false, message: 'Compte non lié à un fournisseur' });
      res.json({ success: true, data: await tenderModel.getForSupplier(supplier.id) });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /** Tableau de bord du fournisseur : uniquement ses propres données */
  async supplierDashboard(req, res) {
    try {
      const supplier = await getSupplierByUser(req.user.id);
      if (!supplier) return res.status(403).json({ success: false, message: 'Compte non lié à un fournisseur' });
      const tenders = await tenderModel.getForSupplier(supplier.id);

      const open = tenders.filter(t => t.effective_status === 'OPEN');
      const upcoming = tenders.filter(t => t.effective_status === 'UPCOMING');
      const submitted = tenders.filter(t => t.my_submission_id);
      const won = submitted.filter(t => t.is_awarded_to_me);
      const decided = submitted.filter(t => t.effective_status === 'AWARDED');

      // À traiter : AO ouverts, échéance la plus proche d'abord
      const toDo = [...open]
        .sort((a, b) => new Date(a.end_date) - new Date(b.end_date))
        .map(t => ({
          id: t.id, tender_number: t.tender_number, title: t.title, end_date: t.end_date, enterprise_name: t.enterprise_name,
          max_delivery_days: t.max_delivery_days, submitted: !!t.my_submission_id,
          my_total: t.my_total, currency_code: t.currency_code
        }));

      // Résultats de mes soumissions clôturées
      const results = submitted
        .filter(t => ['CLOSED', 'AWARDED'].includes(t.effective_status))
        .slice(0, 10)
        .map(t => ({
          id: t.id, tender_number: t.tender_number, title: t.title, end_date: t.end_date, enterprise_name: t.enterprise_name,
          my_total: t.my_total, currency_code: t.currency_code,
          result: t.effective_status === 'CLOSED' ? 'PENDING' : (t.is_awarded_to_me ? 'WON' : 'LOST')
        }));

      // Bons de commande en attente de ma confirmation
      const ordersToConfirm = (await db.one(
        `SELECT COUNT(*)::int AS n FROM purchase_orders
         WHERE supplier_id = $1 AND status IN ('PO_APPROVED', 'PO_SENT') AND COALESCE(supplier_response, '') = ''`,
        [supplier.id]
      )).n;

      // Dossier de préqualification : champs, documents, catégories et localisations manquants
      const full = await supplierModel.getFullProfile(supplier.id);
      // Libellés dans la langue de la requête (supplierProfile.* des locales)
      const T = i18n.translator(i18n.fromRequest(req));
      const profileFields = full.supplier_type === 'INDIVIDUAL'
        ? ['address', 'bank_name', 'bank_account']
        : ['logo_path', 'phone', 'address', 'registration_number', 'tax_id', 'id_nat', 'bank_name', 'bank_account'];
      const missingProfile = [
        ...profileFields.filter(col => !full[col]).map(col => T(`supplierProfile.${col}`)),
        ...full.missing_documents.map(doc => T(`supplierProfile.docs.${doc}`)),
        ...(full.categories.length ? [] : [T('supplierProfile.categories')]),
        ...(full.locations.length ? [] : [T('supplierProfile.locations')]),
      ];

      res.json({
        success: true,
        data: {
          supplier: {
            id: supplier.id, name: supplier.name, supplier_code: supplier.supplier_code,
            logo_path: supplier.logo_path, contact_name: supplier.contact_name
          },
          stats: {
            openTenders: open.length,
            toSubmit: open.filter(t => !t.my_submission_id).length,
            upcomingTenders: upcoming.length,
            submissions: submitted.length,
            won: won.length,
            winRate: decided.length ? Math.round((won.length / decided.length) * 100) : null,
            ordersToConfirm
          },
          toDo,
          upcoming: upcoming.map(t => ({ id: t.id, tender_number: t.tender_number, title: t.title, start_date: t.start_date, end_date: t.end_date })),
          results,
          missingProfile
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async supplierGetOne(req, res) {
    try {
      const supplier = await getSupplierByUser(req.user.id);
      if (!supplier) return res.status(403).json({ success: false, message: 'Compte non lié à un fournisseur' });
      const tender = await tenderModel.getById(req.params.id);
      if (!tender || tender.status === 'CANCELLED') {
        return res.status(404).json({ success: false, message: 'Appel d\'offres introuvable' });
      }
      const [items, mySubmission, eligible] = await Promise.all([
        tenderModel.getItems(tender.requisition_id),
        tenderModel.getSubmission(tender.id, supplier.id),
        tenderModel.isSupplierEligible(supplier.id, tender.id)
      ]);
      if (!eligible && !mySubmission) {
        return res.status(404).json({ success: false, message: 'Appel d\'offres introuvable' });
      }
      // Attribution par article : uniquement SES articles (jamais ceux des autres attributaires)
      const myAwardedItemIds = (await tenderModel.getAwards(tender.id))
        .filter(a => String(a.supplier_id) === String(supplier.id)).map(a => a.requisition_item_id);
      // Uniquement les infos publiques : pas de montant estimé, ni d'offres concurrentes
      res.json({
        success: true,
        data: {
          id: tender.id,
          tender_number: tender.tender_number,
          title: tender.title,
          description: tender.description,
          start_date: tender.start_date,
          end_date: tender.end_date,
          max_delivery_days: tender.max_delivery_days,
          effective_status: tender.effective_status,
          audience: tender.audience,
          category_name: tender.category_name,
          location_name: tender.location_name,
          eligible,
          currency_code: tender.currency_code,
          enterprise_id: tender.enterprise_id,
          enterprise_name: tender.enterprise_name,
          enterprise_logo_path: tender.enterprise_logo_path,
          is_awarded_to_me: String(tender.awarded_supplier_id) === String(supplier.id) || myAwardedItemIds.length > 0,
          award_mode: tender.award_mode,
          my_awarded_item_ids: myAwardedItemIds,
          items,
          mySubmission
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async supplierSubmit(req, res) {
    try {
      const supplier = await getSupplierByUser(req.user.id);
      if (!supplier) return res.status(403).json({ success: false, message: 'Compte non lié à un fournisseur' });
      if (supplier.status !== 'ACTIVE') {
        return res.status(403).json({ success: false, message: 'Votre compte fournisseur n\'est pas actif' });
      }
      const tender = await tenderModel.getById(req.params.id);
      if (!tender || tender.status === 'CANCELLED') {
        return res.status(404).json({ success: false, message: 'Appel d\'offres introuvable' });
      }
      if (!(await tenderModel.isSupplierEligible(supplier.id, tender.id))) {
        return res.status(403).json({
          success: false,
          message: 'Cet appel d\'offres est réservé aux fournisseurs préqualifiés dans sa catégorie et sa localisation'
        });
      }
      if (tender.effective_status !== 'OPEN') {
        return res.status(400).json({
          success: false,
          message: tender.effective_status === 'UPCOMING'
            ? 'Les soumissions ne sont pas encore ouvertes'
            : 'La date limite de soumission est dépassée'
        });
      }

      const { deliveryDays, notes, items = [] } = req.body;
      const days = parseInt(deliveryDays);
      if (!Number.isInteger(days) || days <= 0) {
        return res.status(400).json({ success: false, message: 'Délai de livraison invalide' });
      }
      if (days > tender.max_delivery_days) {
        return res.status(400).json({
          success: false, message: `Le délai de livraison ne peut pas dépasser ${tender.max_delivery_days} jours`
        });
      }

      const reqItems = await tenderModel.getItems(tender.requisition_id);
      const validIds = new Set(reqItems.map(i => String(i.id)));
      const priced = items.filter(i => i.unitPrice !== '' && i.unitPrice !== null && i.unitPrice !== undefined);
      if (priced.length === 0) {
        return res.status(400).json({ success: false, message: 'Saisissez le prix d\'au moins un item' });
      }
      const seen = new Set();
      for (const i of priced) {
        const p = parseFloat(i.unitPrice);
        if (!validIds.has(String(i.requisitionItemId))) {
          return res.status(400).json({ success: false, message: 'Item inconnu dans la soumission' });
        }
        if (seen.has(String(i.requisitionItemId))) {
          return res.status(400).json({ success: false, message: 'Item en double dans la soumission' });
        }
        seen.add(String(i.requisitionItemId));
        if (isNaN(p) || p < 0) return res.status(400).json({ success: false, message: 'Prix unitaire invalide' });
      }

      const result = await tenderModel.upsertSubmission(tender.id, supplier.id, { deliveryDays: days, notes, items: priced }, reqItems);

      // Informer le créateur de l'appel d'offres
      if (tender.created_by) {
        const creator = await db.one('SELECT language FROM users WHERE id = $1', [tender.created_by]);
        const T = i18n.translator(creator?.language);
        await notifyUser(req.io, tender.created_by,
          T(result.updated ? 'notification.tender.updatedSubmission' : 'notification.tender.newSubmission'),
          T(result.updated ? 'notification.tender.resubmitted' : 'notification.tender.submitted', { supplier: supplier.name, number: tender.tender_number }),
          'INFO', `/tenders/${tender.id}`);
      }

      res.json({
        success: true,
        data: await tenderModel.getSubmission(tender.id, supplier.id),
        message: result.updated ? 'Soumission mise à jour' : 'Soumission enregistrée'
      });
    } catch (error) {
      console.error('Error submitting tender offer:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /** PDF de l'offre du fournisseur connecté (logo + entreprise), à cacheter et renvoyer */
  async supplierSubmissionPdf(req, res) {
    try {
      const supplier = await getSupplierByUser(req.user.id);
      if (!supplier) return res.status(403).json({ success: false, message: 'Compte non lié à un fournisseur' });
      const tender = await tenderModel.getById(req.params.id);
      if (!tender) return res.status(404).json({ success: false, message: 'Appel d\'offres introuvable' });
      const submission = await tenderModel.getSubmission(tender.id, supplier.id);
      if (!submission) return res.status(404).json({ success: false, message: 'Aucune soumission pour cet appel d\'offres' });
      const items = await tenderModel.getItems(tender.requisition_id);

      const pdf = await submissionPdfService.generate({ tender, supplier, submission, items, lang: i18n.fromRequest(req) });
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition',
        `inline; filename="offre_${tender.tender_number.replace(/[^\w.-]+/g, '_')}_${supplier.supplier_code}.pdf"`);
      res.end(pdf);
    } catch (error) {
      console.error('Error generating submission PDF:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new TenderController();
