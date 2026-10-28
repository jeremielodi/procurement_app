// src/services/DirectPurchaseService.js
// Achat direct (migration 33_direct_purchase_selection.sql) : l'étape Activity_DirectPurchase exige le fournisseur
// retenu et sa facture pro-forma (pièce jointe de la réquisition, déposée juste avant par le formulaire de la tâche).
// La sélection est enregistrée dans la même transaction que la complétion BpmnGo : refus de BpmnGo = rien d'écrit.
// Le bon de commande propose ensuite ce fournisseur d'office (SupplierModel.getForPurchaseOrder → direct_purchase).
const db = require('../config/database');

const TASK_KEY = 'Activity_DirectPurchase';
const PROFORMA_MIME = /^(application\/pdf|image\/(jpeg|png))$/;

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const text = (v, max = 2000) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));

class DirectPurchaseService {
  get TASK_KEY() { return TASK_KEY; }

  /**
   * Contrôle des données de l'étape (avant toute écriture) → sélection normalisée.
   * variables : supplierId, proformaAttachmentId, proformaNumber?, proformaDate?, proformaAmount?, currency?
   */
  async validate(requisitionId, variables = {}) {
    if (!requisitionId) throw fail(400, 'REQUISITION_REQUIRED', 'Réquisition introuvable pour cette étape');
    const supplierId = parseInt(variables.supplierId, 10);
    if (!supplierId) throw fail(400, 'SUPPLIER_REQUIRED', 'Désignez le fournisseur retenu');
    const supplier = await db.one('SELECT id, name, status FROM suppliers WHERE id = $1', [supplierId]);
    if (!supplier) throw fail(400, 'SUPPLIER_NOT_FOUND', 'Fournisseur introuvable');
    if (supplier.status !== 'ACTIVE') throw fail(400, 'SUPPLIER_INACTIVE', 'Ce fournisseur n\'est pas actif');

    const attachmentId = text(variables.proformaAttachmentId, 36);
    if (!attachmentId) throw fail(400, 'PROFORMA_REQUIRED', 'Joignez la facture pro-forma du fournisseur');
    const attachment = /^[0-9a-f-]{36}$/i.test(attachmentId)
      ? await db.one(
        `SELECT id, file_name, mime_type FROM attachments
         WHERE id = $1 AND entity_type = 'requisition' AND entity_id = $2`,
        [attachmentId, requisitionId]
      )
      : null;
    if (!attachment) throw fail(400, 'PROFORMA_NOT_FOUND', 'Pro-forma introuvable (le fichier doit être joint à cette réquisition)');
    if (!PROFORMA_MIME.test(attachment.mime_type || '')) throw fail(400, 'PROFORMA_TYPE', 'La pro-forma doit être un PDF, un JPG ou un PNG');

    let amount = null;
    if (variables.proformaAmount !== undefined && variables.proformaAmount !== null && variables.proformaAmount !== '') {
      amount = Number(variables.proformaAmount);
      if (!Number.isFinite(amount) || amount < 0) throw fail(400, 'PROFORMA_AMOUNT_INVALID', 'Montant de la pro-forma invalide');
    }
    const date = text(variables.proformaDate, 10);
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw fail(400, 'PROFORMA_DATE_INVALID', 'Date de la pro-forma invalide');
    const currency = text(variables.currency, 3).toUpperCase();

    return {
      supplier, attachment,
      proformaNumber: text(variables.proformaNumber, 100) || null,
      proformaDate: date || null,
      proformaAmount: amount,
      currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
      comment: text(variables.comment) || null,
    };
  }

  /** Enregistre la sélection puis termine l'étape BpmnGo (complete) dans la même transaction */
  async recordAndComplete({ requisitionId, selection, userId, taskId }, complete) {
    return db.withTransaction(async (tx) => {
      await tx.exec(
        `INSERT INTO direct_purchase_selections
           (requisition_id, supplier_id, proforma_attachment_id, proforma_number, proforma_date, proforma_amount,
            currency, comment, task_id, selected_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [requisitionId, selection.supplier.id, selection.attachment.id, selection.proformaNumber, selection.proformaDate,
          selection.proformaAmount, selection.currency, selection.comment, taskId, userId]
      );
      // BpmnGo en dernier : en cas de refus, la sélection est annulée avec la transaction
      const result = await complete();
      if (!result?.success) throw fail(502, 'BPMNGO_ERROR', result?.error || 'BpmnGo n\'a pas accepté la fin de l\'étape');
      return result;
    });
  }

  /** Dernière sélection de la réquisition (fournisseur, pro-forma, auteur) ou null */
  async latest(requisitionId) {
    return db.one(
      `SELECT d.id, d.supplier_id, s.name AS supplier_name, d.proforma_attachment_id, a.file_name AS proforma_file_name,
              d.proforma_number, d.proforma_date, d.proforma_amount::float8 AS proforma_amount, d.currency, d.comment,
              d.selected_by, u.first_name || ' ' || u.last_name AS selected_by_name, d.created_at
       FROM direct_purchase_selections d
       JOIN suppliers s ON s.id = d.supplier_id
       LEFT JOIN attachments a ON a.id = d.proforma_attachment_id
       LEFT JOIN users u ON u.id = d.selected_by
       WHERE d.requisition_id = $1
       ORDER BY d.created_at DESC LIMIT 1`,
      [requisitionId]
    );
  }
}

module.exports = new DirectPurchaseService();
