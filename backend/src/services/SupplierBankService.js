// backend/src/services/SupplierBankService.js
// Coordonnées bancaires des fournisseurs (contrôle anti-fraude) — migration 21_internal_control.sql
//  - recordChange : tout changement de banque / compte / IBAN / SWIFT (fournisseur sur son portail ou acheteur)
//    est historisé (supplier_bank_changes : avant / après, auteur), tracé dans le journal d'audit et signalé aux
//    personnes VERIFY_SUPPLIER_BANK des entreprises qui travaillent avec ce fournisseur
//  - review : chaque entreprise vérifie (VERIFIED) ou rejette (REJECTED, motif) le DERNIER changement, après contre-appel
//    du fournisseur à un numéro connu ; la personne qui a fait le changement ne peut pas le vérifier
//  - assertPayable : un paiement (saisie, approbation, passage « payé ») est refusé tant que le dernier changement
//    n'est pas vérifié par l'entreprise courante (409 BANK_CHANGE_UNVERIFIED / BANK_CHANGE_REJECTED)
// Les fournisseurs sont communs à la plateforme ; la vérification, elle, est propre à chaque entreprise.
const db = require('../config/database');
const tenant = require('../utils/tenant');
const i18n = require('../i18n');
const notificationModel = require('../models/NotificationModel');
const { audit, AUDIT } = require('../utils/auditLog');
const { sodError } = require('../utils/segregation');

const BANK_FIELDS = ['bank_name', 'bank_account', 'bank_iban', 'bank_swift'];
const norm = (v) => (v === undefined || v === null ? null : String(v).trim().replace(/\s+/g, ' ') || null);
const fail = (status, code, message, details) => Object.assign(new Error(message), { status, code, details });

/** Masque un n° de compte pour le journal d'audit (4 derniers caractères) */
const mask = (v) => (v ? `•••${String(v).replace(/\s+/g, '').slice(-4)}` : null);
const masked = (values) => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, k === 'bank_name' ? v : mask(v)]));

class SupplierBankService {
  pick(row) {
    return Object.fromEntries(BANK_FIELDS.map(f => [f, norm(row?.[f])]));
  }

  /** Les champs bancaires changent-ils ? (seuls les champs présents dans `fields` comptent) */
  changedValues(before, fields) {
    const old = this.pick(before);
    const next = { ...old };
    for (const f of BANK_FIELDS) if (fields[f] !== undefined) next[f] = norm(fields[f]);
    return BANK_FIELDS.some(f => old[f] !== next[f]) ? { old, next } : null;
  }

  /**
   * Historise un changement (à appeler APRÈS l'enregistrement du fournisseur).
   * @param {object} req
   * @param {object} supplier ligne AVANT modification (id, name, supplier_code…)
   * @param {object} fields   champs écrits
   * @param {'PORTAL'|'BUYER'} source
   */
  async recordChange(req, supplier, fields, source) {
    const diff = this.changedValues(supplier, fields);
    if (!diff) return null;
    const enterpriseId = source === 'BUYER' ? tenant.enterpriseId() : null;
    const change = await db.one(
      `INSERT INTO supplier_bank_changes (supplier_id, old_values, new_values, source, changed_by, changed_by_email, enterprise_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
      [supplier.id, JSON.stringify(diff.old), JSON.stringify(diff.next), source, req.user?.id || null, req.user?.email || null, enterpriseId]
    );
    await audit(req, AUDIT.SUPPLIER_BANK_CHANGED, {
      entity: { type: 'supplier', id: supplier.id, label: supplier.name },
      oldValue: masked(diff.old), details: { ...masked(diff.next), source, changeId: change.id },
    });
    await this.notifyVerifiers(req, supplier, enterpriseId);
    return change;
  }

  /** Personnes VERIFY_SUPPLIER_BANK des entreprises qui ont des commandes avec ce fournisseur (+ celle de l'acheteur) */
  async notifyVerifiers(req, supplier, buyerEnterpriseId) {
    try {
      const users = await db.select(
        `SELECT DISTINCT u.id, u.language FROM users u
         JOIN user_profiles up ON up.user_id = u.id
         JOIN profile_permissions pp ON pp.profile_id = up.profile_id
         JOIN permissions p ON p.id = pp.permission_id AND p.name = 'VERIFY_SUPPLIER_BANK'
         WHERE u.is_active AND u.enterprise_id IS NOT NULL
           AND (u.enterprise_id = $2::uuid
                OR u.enterprise_id IN (SELECT DISTINCT enterprise_id FROM purchase_orders WHERE supplier_id = $1 AND enterprise_id IS NOT NULL))`,
        [supplier.id, buyerEnterpriseId]
      );
      for (const u of users) {
        if (String(u.id) === String(req.user?.id)) continue;
        const T = i18n.translator(u.language);
        const vars = { supplier: supplier.name };
        const title = T('notification.supplierBank.changedTitle', vars);
        const message = T('notification.supplierBank.changedMessage', vars);
        const link = `/suppliers/${supplier.id}?tab=bank`;
        await notificationModel.create({ userId: u.id, title, message, type: 'WARNING', link });
        req.io?.to(`user-${u.id}`).emit('notification', { title, message, type: 'WARNING', link, timestamp: new Date().toISOString() });
      }
    } catch (error) {
      console.error('Notification changement bancaire :', error.message);
    }
  }

  /** Dernier changement et sa vérification par l'entreprise courante */
  async status(supplierId, enterpriseId = tenant.enterpriseId()) {
    const change = await db.one(
      `SELECT c.id, c.created_at, c.source FROM supplier_bank_changes c WHERE c.supplier_id = $1 ORDER BY c.id DESC LIMIT 1`,
      [supplierId]
    );
    if (!change) return { state: 'NONE', change: null, review: null };
    const review = enterpriseId
      ? await db.one('SELECT status, reason, reviewed_at FROM supplier_bank_reviews WHERE enterprise_id = $1 AND change_id = $2', [enterpriseId, change.id])
      : null;
    return { state: review?.status || 'PENDING', change, review };
  }

  /** Historique (le plus récent d'abord) avec la décision de l'entreprise courante */
  async history(supplierId) {
    const params = [supplierId];
    const enterpriseId = tenant.enterpriseId();
    params.push(enterpriseId);
    return db.select(
      `SELECT c.id, c.old_values, c.new_values, c.source, c.created_at, c.changed_by,
              COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), c.changed_by_email) AS changed_by_name,
              r.status AS review_status, r.reason AS review_reason, r.reviewed_at,
              NULLIF(TRIM(COALESCE(ru.first_name, '') || ' ' || COALESCE(ru.last_name, '')), '') AS reviewed_by_name,
              (c.id = (SELECT MAX(id) FROM supplier_bank_changes WHERE supplier_id = c.supplier_id)) AS is_latest
       FROM supplier_bank_changes c
       LEFT JOIN users u ON u.id = c.changed_by
       LEFT JOIN supplier_bank_reviews r ON r.change_id = c.id AND r.enterprise_id = $2::uuid
       LEFT JOIN users ru ON ru.id = r.reviewed_by
       WHERE c.supplier_id = $1 ORDER BY c.id DESC`,
      params
    );
  }

  /** Décision de l'entreprise courante sur le dernier changement */
  async review(req, supplierId, changeId, { status, reason }) {
    const enterpriseId = tenant.enterpriseId();
    if (!enterpriseId) throw fail(403, 'FORBIDDEN', 'Réservé aux entreprises');
    if (!['VERIFIED', 'REJECTED'].includes(status)) throw fail(400, 'INVALID_STATUS', 'Décision invalide');
    const motive = String(reason || '').trim();
    if (status === 'REJECTED' && !motive) throw fail(400, 'REASON_REQUIRED', 'Motif obligatoire');
    const change = await db.one(
      `SELECT c.*, s.name AS supplier_name, s.user_id AS supplier_user_id,
              (c.id = (SELECT MAX(id) FROM supplier_bank_changes WHERE supplier_id = c.supplier_id)) AS is_latest
       FROM supplier_bank_changes c JOIN suppliers s ON s.id = c.supplier_id WHERE c.id = $1 AND c.supplier_id = $2`,
      [changeId, supplierId]
    );
    if (!change) throw fail(404, 'NOT_FOUND', 'Changement introuvable');
    if (!change.is_latest) throw fail(409, 'SUPERSEDED', 'Un changement plus récent attend votre vérification');
    if (change.changed_by && String(change.changed_by) === String(req.user.id)) {
      await audit(req, AUDIT.SOD_VIOLATION_BLOCKED, {
        entity: { type: 'supplier', id: supplierId, label: change.supplier_name },
        details: { rule: 'SELF_VERIFICATION', changeId: change.id },
      });
      throw sodError('SELF_VERIFICATION', 'Séparation des tâches : une autre personne doit vérifier les coordonnées bancaires que vous avez saisies');
    }
    await db.exec(
      `INSERT INTO supplier_bank_reviews (enterprise_id, change_id, status, reason, reviewed_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (enterprise_id, change_id) DO UPDATE SET status = EXCLUDED.status, reason = EXCLUDED.reason,
         reviewed_by = EXCLUDED.reviewed_by, reviewed_at = CURRENT_TIMESTAMP`,
      [enterpriseId, change.id, status, motive || null, req.user.id]
    );
    await audit(req, status === 'VERIFIED' ? AUDIT.SUPPLIER_BANK_VERIFIED : AUDIT.SUPPLIER_BANK_REJECTED, {
      entity: { type: 'supplier', id: supplierId, label: change.supplier_name },
      details: { changeId: change.id, reason: motive || null, ...masked(change.new_values) },
    });
    // Rejet : le fournisseur inscrit est prévenu (dans sa langue)
    if (status === 'REJECTED' && change.supplier_user_id) {
      try {
        const user = await db.one('SELECT language FROM users WHERE id = $1', [change.supplier_user_id]);
        const T = i18n.translator(user?.language);
        const title = T('notification.supplierBank.rejectedTitle');
        const message = T('notification.supplierBank.rejectedMessage', { reason: motive });
        await notificationModel.create({ userId: change.supplier_user_id, title, message, type: 'WARNING', link: '/supplier/profile' });
        req.io?.to(`user-${change.supplier_user_id}`).emit('notification', { title, message, type: 'WARNING', link: '/supplier/profile' });
      } catch (error) {
        console.error('Notification rejet bancaire :', error.message);
      }
    }
    return this.status(supplierId, enterpriseId);
  }

  /** Fournisseur d'une facture ou d'un bon de commande */
  async supplierOf({ invoiceId, poId }) {
    if (invoiceId) {
      const row = await db.one(
        `SELECT COALESCE(i.supplier_id, po.supplier_id) AS supplier_id FROM invoices i
         LEFT JOIN purchase_orders po ON po.id = i.po_id WHERE i.id = $1`, [invoiceId]);
      if (row?.supplier_id) return row.supplier_id;
    }
    if (poId) return (await db.one('SELECT supplier_id FROM purchase_orders WHERE id = $1', [poId]))?.supplier_id || null;
    return null;
  }

  /** Refuse un paiement tant que le dernier changement bancaire du fournisseur n'est pas vérifié par l'entreprise */
  async assertPayable(req, { invoiceId, poId, paymentLabel = null }) {
    const enterpriseId = tenant.enterpriseId();
    if (!enterpriseId) return; // hors requête d'entreprise (worker, script)
    const supplierId = await this.supplierOf({ invoiceId, poId });
    if (!supplierId) return;
    const st = await this.status(supplierId, enterpriseId);
    if (st.state === 'NONE' || st.state === 'VERIFIED') return;
    const supplier = await db.one('SELECT id, name FROM suppliers WHERE id = $1', [supplierId]);
    await audit(req, AUDIT.PAYMENT_BLOCKED, {
      entity: { type: 'supplier', id: supplierId, label: supplier?.name },
      details: { reason: st.state === 'REJECTED' ? 'BANK_CHANGE_REJECTED' : 'BANK_CHANGE_UNVERIFIED', changeId: st.change.id, payment: paymentLabel, invoiceId: invoiceId || null },
    });
    throw fail(409, st.state === 'REJECTED' ? 'BANK_CHANGE_REJECTED' : 'BANK_CHANGE_UNVERIFIED',
      st.state === 'REJECTED'
        ? `Paiement bloqué : les nouvelles coordonnées bancaires de ${supplier?.name} ont été rejetées`
        : `Paiement bloqué : les coordonnées bancaires de ${supplier?.name} ont changé et doivent être vérifiées`,
      { supplierId, supplierName: supplier?.name, changedAt: st.change.created_at });
  }
}

module.exports = new SupplierBankService();
module.exports.BANK_FIELDS = BANK_FIELDS;
