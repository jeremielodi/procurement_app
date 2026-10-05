// backend/src/controllers/TenderController.js
const db = require('../config/database');
const tenderModel = require('../models/TenderModel');
const notificationModel = require('../models/NotificationModel');
const camundaService = require('../services/CamundaService');
const emailService = require('../services/EmailNotificationService');
const { generateComparisonWorkbook } = require('../services/TenderExportService');
const submissionPdfService = require('../services/TenderSubmissionPdfService');
const { getSupplierByUser } = require('./SupplierPortalController');

const { appLink } = require('../utils/appUrl');

const EDITABLE = ['OPEN', 'UPCOMING'];

// Les prix restent scellés tant que les soumissions sont ouvertes (ou pas encore ouvertes)
const isSealed = (tender) => EDITABLE.includes(tender.effective_status);

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(d) {
  return new Date(d).toLocaleString('fr-FR', {
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
  return errors;
}

async function notifyUser(io, userId, title, message, type, link) {
  await notificationModel.create({ userId, title, message, type, link });
  io?.to(`user-${userId}`).emit('notification', { title, message, type, link, timestamp: new Date().toISOString() });
}

/** Notifie (in-app + email) tous les fournisseurs inscrits. Ne lève pas d'erreur. */
async function notifySuppliers(io, tender, { title, intro }) {
  try {
    const recipients = await tenderModel.getRegisteredSupplierRecipients();
    const link = `/supplier/tenders/${tender.id}`;
    for (const r of recipients) {
      await notifyUser(io, r.user_id, title, `${tender.tender_number} — ${tender.title}`, 'INFO', link);
      const html = `
        <p>Bonjour ${escapeHtml(r.name)},</p>
        <p>${escapeHtml(intro)}</p>
        <table cellpadding="4">
          <tr><td><b>N°</b></td><td>${escapeHtml(tender.tender_number)}</td></tr>
          <tr><td><b>Objet</b></td><td>${escapeHtml(tender.title)}</td></tr>
          <tr><td><b>Ouverture</b></td><td>${fmtDate(tender.start_date)}</td></tr>
          <tr><td><b>Clôture</b></td><td>${fmtDate(tender.end_date)}</td></tr>
          <tr><td><b>Délai de livraison max</b></td><td>${tender.max_delivery_days} jours</td></tr>
        </table>
        <p><a href="${appLink(link)}">Consulter l'appel d'offres et soumettre vos prix</a></p>`;
      // Pas d'await : l'envoi SMTP ne doit pas bloquer la réponse
      emailService.sendEmail(r.user_email || r.supplier_email, `${title} — ${tender.tender_number}`, html);
    }
    return recipients.length;
  } catch (e) {
    console.error('[Tender] notifySuppliers (non-fatal):', e.message);
    return 0;
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
        tenderModel.countRegisteredSuppliers()
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
      res.json({ success: true, data: { ...tender, items, submissions, registeredSuppliers, sealed } });
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

      const tender = await tenderModel.create({
        tenderNumber: b.tenderNumber.trim(),
        requisitionId: b.requisitionId,
        taskId: b.taskId,
        title: b.title.trim(),
        description: b.description,
        startDate: new Date(b.startDate),
        endDate: new Date(b.endDate),
        maxDeliveryDays: parseInt(b.maxDeliveryDays),
        createdBy: req.user.id
      });

      await db.insert('workflow_history', {
        entity_type: 'requisition',
        entity_id: b.requisitionId,
        task_id: b.taskId || null,
        task_name: 'Activity_RFPProcess',
        action: 'TENDER_PUBLISHED',
        comments: `Appel d'offres ${tender.tender_number} publié`,
        performed_by: req.user.id,
        performed_at: new Date()
      });

      const notified = await notifySuppliers(req.io, tender, {
        title: 'Nouvel appel d\'offres',
        intro: 'Un nouvel appel d\'offres est ouvert. Vous pouvez saisir vos prix sur le portail fournisseur.'
      });

      res.status(201).json({ success: true, data: tender, notifiedSuppliers: notified, message: 'Appel d\'offres publié' });
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({ success: false, message: 'Ce numéro d\'appel d\'offres est déjà utilisé' });
      }
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

      await tenderModel.update(tender.id, {
        title: req.body.title.trim(),
        description: req.body.description,
        startDate: new Date(req.body.startDate),
        endDate: new Date(req.body.endDate),
        maxDeliveryDays: parseInt(req.body.maxDeliveryDays)
      });
      const updated = await tenderModel.getById(tender.id);
      await notifySuppliers(req.io, updated, {
        title: 'Appel d\'offres modifié',
        intro: 'Les conditions de cet appel d\'offres ont été modifiées. Merci de vérifier les nouvelles dates et le délai de livraison.'
      });
      res.json({ success: true, data: updated });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
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
        `SELECT s.id, s.user_id FROM suppliers s
         JOIN tender_submissions ts ON ts.supplier_id = s.id
         WHERE ts.tender_id = $1 AND s.user_id IS NOT NULL`,
        [tender.id]
      );
      for (const o of owners) {
        const won = String(o.id) === String(winner.supplier_id);
        await notifyUser(req.io, o.user_id,
          won ? 'Offre retenue 🎉' : 'Résultat de l\'appel d\'offres',
          won ? `Votre offre pour ${tender.tender_number} a été retenue`
              : `Votre offre pour ${tender.tender_number} n'a pas été retenue`,
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

      const profileFields = [
        ['logo_path', 'Logo'], ['phone', 'Téléphone'], ['address', 'Adresse'],
        ['registration_number', 'RCCM'], ['tax_id', 'N° impôt'], ['bank_name', 'Banque'], ['bank_account', 'N° de compte']
      ];
      const missingProfile = profileFields.filter(([col]) => !supplier[col]).map(([, label]) => label);

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
            winRate: decided.length ? Math.round((won.length / decided.length) * 100) : null
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
      const [items, mySubmission] = await Promise.all([
        tenderModel.getItems(tender.requisition_id),
        tenderModel.getSubmission(tender.id, supplier.id)
      ]);
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
          currency_code: tender.currency_code,
          enterprise_id: tender.enterprise_id,
          enterprise_name: tender.enterprise_name,
          enterprise_logo_path: tender.enterprise_logo_path,
          is_awarded_to_me: String(tender.awarded_supplier_id) === String(supplier.id),
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
        await notifyUser(req.io, tender.created_by,
          result.updated ? 'Soumission modifiée' : 'Nouvelle soumission',
          `${supplier.name} a ${result.updated ? 'modifié' : 'soumis'} son offre pour ${tender.tender_number}`,
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

      const pdf = await submissionPdfService.generate({ tender, supplier, submission, items });
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
