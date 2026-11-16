// backend/src/models/FrameworkAgreementModel.js
// Contrats / accords-cadres (migration 69) : un fournisseur, une période de validité, un plafond (devise) et un
// bordereau de prix ; projets facultatifs (aucun = toute l'entreprise). Origine : appel d'offres / demande de cotations
// attribué (fournisseur et prix repris) ou saisie manuelle avec le contrat signé en pièce jointe.
// Cycle : DRAFT (modifiable) → soumis (PENDING_VALIDATION) → chef de chaque projet listé (ou son intérimaire) puis
// directeur général (prof_dg) qui l'active (ACTIVE) ; rejet = retour en brouillon (motif), nouvelle soumission =
// nouveau tour. ACTIVE ⇄ SUSPENDED, puis CLOSED ; brouillon / en attente retiré = CANCELLED. Expiré = calculé (date de fin
// passée). Droits de décision : fonction SQL user_can_validate_framework_agreement (jamais l'auteur).
// Consommation = bons de commande actifs liés au contrat (vue v_framework_agreement_po_lines).
const db = require('../config/database');
const tenant = require('../utils/tenant');
const { resolveUnitId } = require('../utils/units');

const STATUSES = ['DRAFT', 'PENDING_VALIDATION', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'CANCELLED'];
const EFFECTIVE_STATUSES = [...STATUSES, 'EXPIRED'];
const ATTACHMENT_TYPE = 'framework_agreement';
const fail = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });
const text = (v, max = 4000) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const num = (v) => {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(String(v)));
const name = (alias) => `NULLIF(TRIM(COALESCE(${alias}.first_name, '') || ' ' || COALESCE(${alias}.last_name, '')), '')`;

// Statut affiché : un contrat actif dont la date de fin est passée est « expiré »
const EFFECTIVE_SQL = `CASE WHEN a.status = 'ACTIVE' AND a.end_date < CURRENT_DATE THEN 'EXPIRED' ELSE a.status END`;

const HEADER_SQL = `
  SELECT a.*, ${EFFECTIVE_SQL} AS effective_status,
         s.name AS supplier_name, s.supplier_code, s.status AS supplier_status,
         c.format_key AS currency_code, c.symbol AS currency_symbol,
         t.tender_number, t.title AS tender_title, t.tender_type,
         ${name('cb')} AS created_by_name, ${name('sb')} AS submitted_by_name, ${name('ab')} AS activated_by_name,
         ${name('rb')} AS last_rejected_by_name, ${name('xb')} AS suspended_by_name, ${name('kb')} AS closed_by_name,
         framework_agreement_consumed(a.id)::float8 AS consumed_amount,
         (a.end_date - CURRENT_DATE)::int AS days_left,
         (SELECT COUNT(*)::int FROM framework_agreement_items i WHERE i.agreement_id = a.id) AS item_count,
         (SELECT COALESCE(JSON_AGG(JSON_BUILD_OBJECT('id', p.id, 'code', p.code, 'name', p.name) ORDER BY p.code), '[]'::json)
            FROM framework_agreement_projects fp JOIN projects p ON p.id = fp.project_id WHERE fp.agreement_id = a.id) AS projects
  FROM framework_agreements a
  JOIN suppliers s ON s.id = a.supplier_id
  LEFT JOIN currency c ON c.id = a.currency_id
  LEFT JOIN tenders t ON t.id = a.tender_id
  LEFT JOIN users cb ON cb.id = a.created_by
  LEFT JOIN users sb ON sb.id = a.submitted_by
  LEFT JOIN users ab ON ab.id = a.activated_by
  LEFT JOIN users rb ON rb.id = a.last_rejected_by
  LEFT JOIN users xb ON xb.id = a.suspended_by
  LEFT JOIN users kb ON kb.id = a.closed_by`;

function withAmounts(row) {
  if (!row) return row;
  row.ceiling_amount = parseFloat(row.ceiling_amount);
  row.consumed_amount = Math.round((row.consumed_amount || 0) * 1e4) / 1e4;
  row.remaining_amount = Math.round((row.ceiling_amount - row.consumed_amount) * 1e4) / 1e4;
  row.consumed_percent = row.ceiling_amount > 0 ? Math.round((row.consumed_amount / row.ceiling_amount) * 1000) / 10 : 0;
  return row;
}

class FrameworkAgreementModel {
  /**
   * Liste. scope : all (VIEW_FRAMEWORK_AGREEMENTS, contrôlé par l'appelant) | toValidate (décisions attendues de
   * l'utilisateur) | involved (contrats dont l'utilisateur est validateur ou a décidé). Filtres : status (statuts
   * affichés, séparés par des virgules, EXPIRED compris), supplierId, projectId (contrats utilisables par ce projet),
   * search (n°, titre, référence, fournisseur).
   */
  async list({ scope = 'all', userId, status, supplierId, projectId, search, limit = 50, offset = 0 } = {}) {
    const params = [];
    let where = `WHERE 1=1${tenant.filter('a.enterprise_id', params)}`;
    if (scope === 'toValidate') {
      params.push(userId);
      where += ` AND a.status = 'PENDING_VALIDATION' AND user_can_validate_framework_agreement($${params.length}, a.id)`;
    }
    if (scope === 'involved') {
      params.push(userId);
      const p = `$${params.length}`;
      where += ` AND (a.created_by = ${p} OR user_can_validate_framework_agreement(${p}, a.id)
                 OR EXISTS (SELECT 1 FROM framework_agreement_approvals ap WHERE ap.agreement_id = a.id AND (ap.decided_by = ${p} OR ap.on_behalf_of = ${p})))`;
    }
    const statuses = status ? String(status).split(',').filter(s => EFFECTIVE_STATUSES.includes(s)) : [];
    if (statuses.length) { params.push(statuses); where += ` AND (${EFFECTIVE_SQL}) = ANY($${params.length}::text[])`; }
    if (supplierId) { params.push(String(supplierId)); where += ` AND a.supplier_id::text = $${params.length}`; }
    if (projectId) {
      params.push(String(projectId));
      where += ` AND (NOT EXISTS (SELECT 1 FROM framework_agreement_projects fp WHERE fp.agreement_id = a.id)
                 OR EXISTS (SELECT 1 FROM framework_agreement_projects fp WHERE fp.agreement_id = a.id AND fp.project_id::text = $${params.length}))`;
    }
    if (search) {
      params.push(`%${String(search).trim()}%`);
      const p = `$${params.length}`;
      where += ` AND (a.agreement_number ILIKE ${p} OR a.title ILIKE ${p} OR a.contract_reference ILIKE ${p} OR s.name ILIKE ${p})`;
    }
    const total = (await db.one(`SELECT COUNT(*)::int AS n FROM framework_agreements a JOIN suppliers s ON s.id = a.supplier_id ${where}`, params)).n;
    params.push(Math.min(parseInt(limit) || 50, 200), parseInt(offset) || 0);
    const rows = await db.select(`${HEADER_SQL} ${where} ORDER BY a.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { rows: rows.map(withAmounts), total };
  }

  async countToValidate(userId) {
    return (await this.list({ scope: 'toValidate', userId, limit: 1 })).total;
  }

  async getHeader(id) {
    return withAmounts(await db.one(`${HEADER_SQL} WHERE a.id::text = $1`, [String(id)]));
  }

  /** Fiche complète : bordereau (avec quantités commandées), validations, étapes en attente, pièces jointes, bons de commande */
  async getById(id) {
    const a = await this.getHeader(id);
    if (!a) return null;
    a.items = await db.select(
      `SELECT i.id, i.position, i.stock_item_id, i.description, i.unit_id, i.unit_price::float8 AS unit_price,
              i.max_quantity::float8 AS max_quantity, i.requisition_item_id,
              u.abbr AS unit_abbr, u.name AS unit_name, it.code AS stock_item_code, it.name AS stock_item_name,
              COALESCE(SUM(l.quantity), 0)::float8 AS ordered_quantity, COALESCE(SUM(l.amount), 0)::float8 AS ordered_amount
       FROM framework_agreement_items i
       JOIN units u ON u.id = i.unit_id
       LEFT JOIN stock_items it ON it.id = i.stock_item_id
       LEFT JOIN v_framework_agreement_po_lines l ON l.framework_item_id = i.id
       WHERE i.agreement_id = $1
       GROUP BY i.id, u.abbr, u.name, it.code, it.name
       ORDER BY i.position, i.description`,
      [a.id]
    );
    a.approvals = await db.select(
      `SELECT ap.id, ap.round, ap.step, ap.project_id, ap.decision, ap.comment, ap.decided_at, ap.decided_by, ap.decided_by_position,
              ${name('u')} AS decided_by_name, ${name('ob')} AS on_behalf_of_name, p.code AS project_code, p.name AS project_name
       FROM framework_agreement_approvals ap
       LEFT JOIN users u ON u.id = ap.decided_by
       LEFT JOIN users ob ON ob.id = ap.on_behalf_of
       LEFT JOIN projects p ON p.id = ap.project_id
       WHERE ap.agreement_id = $1 ORDER BY ap.decided_at`,
      [a.id]
    );
    // Étapes du tour en cours : chef de chaque projet (fait / en attente / sauté), puis DG
    a.steps = a.status === 'PENDING_VALIDATION' ? await this.steps(a) : [];
    a.attachments = await db.select(
      `SELECT at.id, at.file_name, at.file_size, at.mime_type, at.uploaded_at, ${name('u')} AS uploaded_by_name
       FROM attachments at LEFT JOIN users u ON u.id = at.uploaded_by
       WHERE at.entity_type = $1 AND at.entity_id = $2 ORDER BY at.uploaded_at`,
      [ATTACHMENT_TYPE, a.id]
    );
    a.purchase_orders = await db.select(
      `SELECT po.id, po.po_number, po.status, po.order_date, po.total_amount::float8 AS total_amount, po.created_at,
              r.id AS requisition_id, r.requisition_number, p.code AS project_code,
              COALESCE((SELECT SUM(l.amount) FROM v_framework_agreement_po_lines l WHERE l.purchase_order_id = po.id), 0)::float8 AS consumed_amount
       FROM purchase_orders po
       LEFT JOIN requisitions r ON r.id = po.requisition_id
       LEFT JOIN projects p ON p.id = r.project_id
       WHERE po.framework_agreement_id = $1 ORDER BY po.created_at DESC`,
      [a.id]
    );
    return a;
  }

  /** Étapes de validation du tour en cours */
  async steps(a) {
    const projects = await db.select(
      `SELECT p.id, p.code, p.name, pm.id AS manager_id, ${name('pm')} AS manager_name, pm.is_active AS manager_active,
              ap.decided_at, ${name('du')} AS decided_by_name
       FROM framework_agreement_projects fp
       JOIN projects p ON p.id = fp.project_id
       LEFT JOIN users pm ON pm.id = p.project_manager_id
       LEFT JOIN framework_agreement_approvals ap ON ap.agreement_id = fp.agreement_id AND ap.round = $2
            AND ap.step = 'PROJECT_MANAGER' AND ap.project_id = p.id AND ap.decision = 'APPROVED'
       LEFT JOIN users du ON du.id = ap.decided_by
       WHERE fp.agreement_id = $1 ORDER BY p.code`,
      [a.id, a.submission_round]
    );
    const steps = projects.map(p => ({
      step: 'PROJECT_MANAGER', projectId: p.id, projectCode: p.code, projectName: p.name, managerName: p.manager_name,
      state: p.decided_at ? 'DONE' : (!p.manager_active || String(p.manager_id) === String(a.created_by)) ? 'SKIPPED' : 'PENDING',
      decidedAt: p.decided_at, decidedByName: p.decided_by_name,
    }));
    const pmPending = steps.some(s => s.state === 'PENDING');
    steps.push({ step: 'DG', state: pmPending ? 'WAITING' : 'PENDING' });
    return steps;
  }

  async canValidate(id, userId) {
    return !!(await db.one('SELECT user_can_validate_framework_agreement($1, $2) AS ok', [userId, id]))?.ok;
  }

  /** Personnes qui peuvent décider maintenant (notifications, « en attente de ») */
  async validators(id) {
    return db.select(
      `SELECT u.id, ${name('u')} AS name FROM users u JOIN framework_agreements a ON a.id = $1
       WHERE u.is_active AND u.enterprise_id = a.enterprise_id AND user_can_validate_framework_agreement(u.id, a.id) ORDER BY 2`,
      [id]
    );
  }

  /** Utilisateur ayant eu (ou ayant) un rôle dans la validation : consultation de la fiche sans la permission de lecture */
  async isInvolved(id, userId) {
    return !!(await db.one(
      `SELECT (user_can_validate_framework_agreement($2, a.id)
               OR EXISTS (SELECT 1 FROM framework_agreement_approvals ap WHERE ap.agreement_id = a.id AND (ap.decided_by = $2 OR ap.on_behalf_of = $2))
               OR EXISTS (SELECT 1 FROM framework_agreement_projects fp WHERE fp.agreement_id = a.id AND user_manages_project($2, fp.project_id))) AS ok
       FROM framework_agreements a WHERE a.id::text = $1`,
      [String(id), userId]
    ))?.ok;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Saisie
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Contrôle des champs (création et modification). `current` = contrat existant (modification : champs absents = inchangés).
   * Renvoie { fields, projectIds, items } prêts à écrire (projectIds / items undefined = inchangés).
   */
  async checkData(tx, data, { enterpriseId, current = null }) {
    const has = (k) => data[k] !== undefined;
    const pick = (k, col) => (has(k) ? data[k] : current?.[col]);
    const fields = {};

    const title = text(pick('title', 'title'), 255);
    if (!title) throw fail(400, 'TITLE_REQUIRED', 'Titre du contrat obligatoire');
    fields.title = title;
    fields.description = text(pick('description', 'description'), 4000) || null;
    fields.contract_reference = text(pick('contractReference', 'contract_reference'), 100) || null;

    const supplierId = pick('supplierId', 'supplier_id');
    if (!supplierId) throw fail(400, 'SUPPLIER_REQUIRED', 'Fournisseur obligatoire');
    const supplier = await tx.one('SELECT id, name, status FROM suppliers WHERE id::text = $1', [String(supplierId)]);
    if (!supplier) throw fail(400, 'SUPPLIER_NOT_FOUND', 'Fournisseur introuvable');
    if (supplier.status !== 'ACTIVE' && (!current || String(current.supplier_id) !== String(supplier.id))) {
      throw fail(400, 'SUPPLIER_INACTIVE', 'Ce fournisseur n\'est pas actif');
    }
    fields.supplier_id = supplier.id;

    const startDate = String(pick('startDate', 'start_date') || '').slice(0, 10);
    const endDate = String(pick('endDate', 'end_date') || '').slice(0, 10);
    if (!isDate(startDate) || !isDate(endDate)) throw fail(400, 'DATES_REQUIRED', 'Dates de début et de fin obligatoires');
    if (endDate < startDate) throw fail(400, 'DATES_INVALID', 'La date de fin doit suivre la date de début');
    fields.start_date = startDate;
    fields.end_date = endDate;

    const ceiling = num(pick('ceilingAmount', 'ceiling_amount'));
    if (!(ceiling > 0)) throw fail(400, 'CEILING_INVALID', 'Plafond invalide (montant supérieur à 0)');
    fields.ceiling_amount = ceiling;

    let currencyId = pick('currencyId', 'currency_id');
    if (!currencyId) currencyId = (await tx.one('SELECT currency_id FROM enterprise WHERE id = $1', [enterpriseId]))?.currency_id;
    const currency = currencyId ? await tx.one('SELECT id FROM currency WHERE id::text = $1', [String(currencyId)]) : null;
    if (!currency) throw fail(400, 'CURRENCY_INVALID', 'Devise inconnue');
    fields.currency_id = currency.id;

    const allow = pick('allowOffList', 'allow_off_list');
    fields.allow_off_list = allow === true || allow === 'true';

    // Appel d'offres d'origine : attribué, de l'entreprise, fournisseur attributaire
    const tenderId = pick('tenderId', 'tender_id');
    fields.tender_id = null;
    if (tenderId) {
      const tender = await this.awardedTender(tx, tenderId, enterpriseId);
      if (!(await this.isAwardee(tx, tender.id, supplier.id))) {
        throw fail(400, 'TENDER_SUPPLIER_MISMATCH', 'Ce fournisseur n\'est pas attributaire de cet appel d\'offres');
      }
      fields.tender_id = tender.id;
    }

    let projectIds;
    if (has('projectIds')) {
      const ids = [...new Set((Array.isArray(data.projectIds) ? data.projectIds : []).filter(Boolean).map(String))];
      for (const pid of ids) {
        const p = await tx.one('SELECT id FROM projects WHERE id::text = $1 AND enterprise_id = $2', [pid, enterpriseId]);
        if (!p) throw fail(400, 'PROJECT_NOT_FOUND', 'Projet introuvable');
      }
      projectIds = ids;
    }

    let items;
    if (has('items')) {
      if (!Array.isArray(data.items)) throw fail(400, 'ITEMS_INVALID', 'Bordereau invalide');
      const pieceId = (await tx.one(`SELECT id FROM units WHERE code = 'PIECE'`))?.id;
      const unitCache = new Map();
      items = [];
      for (const [index, raw] of data.items.entries()) {
        let stockItem = null;
        if (raw.stockItemId) {
          stockItem = await tx.one('SELECT id, name, unit_id FROM stock_items WHERE id::text = $1 AND enterprise_id = $2', [String(raw.stockItemId), enterpriseId]);
          if (!stockItem) throw fail(400, 'ITEM_NOT_FOUND', 'Article du catalogue introuvable', { line: index });
        }
        const description = text(raw.description, 500) || stockItem?.name || '';
        if (!description) throw fail(400, 'ITEM_DESCRIPTION_REQUIRED', 'Désignation obligatoire', { line: index });
        const unitId = (await resolveUnitId(raw.unitId, { line: index, tx, cache: unitCache })) || stockItem?.unit_id || pieceId;
        const unitPrice = num(raw.unitPrice);
        if (unitPrice === null || !(unitPrice >= 0)) throw fail(400, 'PRICE_INVALID', `${description} : prix unitaire invalide`, { line: index });
        const maxQuantity = num(raw.maxQuantity);
        if (maxQuantity !== null && !(maxQuantity > 0)) throw fail(400, 'MAX_QUANTITY_INVALID', `${description} : quantité maximale invalide`, { line: index });
        let requisitionItemId = null;
        if (raw.requisitionItemId && fields.tender_id) {
          const ri = await tx.one(
            'SELECT ri.id FROM requisition_items ri JOIN tenders t ON t.requisition_id = ri.requisition_id WHERE t.id = $1 AND ri.id::text = $2',
            [fields.tender_id, String(raw.requisitionItemId)]
          );
          requisitionItemId = ri?.id || null;
        }
        items.push({ stockItemId: stockItem?.id || null, description, unitId, unitPrice, maxQuantity, requisitionItemId });
      }
    }
    return { fields, projectIds, items };
  }

  async awardedTender(tx, tenderId, enterpriseId) {
    const tender = await tx.one(
      `SELECT t.id, t.status, t.title, t.tender_number, t.awarded_supplier_id, r.enterprise_id
       FROM tenders t JOIN requisitions r ON r.id = t.requisition_id WHERE t.id::text = $1`,
      [String(tenderId)]
    );
    if (!tender || String(tender.enterprise_id) !== String(enterpriseId)) throw fail(404, 'TENDER_NOT_FOUND', 'Appel d\'offres introuvable');
    if (tender.status !== 'AWARDED') throw fail(409, 'TENDER_NOT_AWARDED', 'L\'appel d\'offres n\'est pas attribué');
    return tender;
  }

  async isAwardee(tx, tenderId, supplierId) {
    return !!(await tx.one(
      `SELECT 1 AS ok FROM tenders t WHERE t.id = $1 AND (t.awarded_supplier_id = $2
         OR EXISTS (SELECT 1 FROM tender_awards ta WHERE ta.tender_id = t.id AND ta.supplier_id = $2))`,
      [tenderId, supplierId]
    ));
  }

  async writeChildren(tx, agreementId, { projectIds, items }) {
    if (projectIds !== undefined) {
      await tx.exec('DELETE FROM framework_agreement_projects WHERE agreement_id = $1', [agreementId]);
      for (const pid of projectIds) {
        await tx.exec('INSERT INTO framework_agreement_projects (agreement_id, project_id) VALUES ($1, $2)', [agreementId, pid]);
      }
    }
    if (items !== undefined) {
      await tx.exec('DELETE FROM framework_agreement_items WHERE agreement_id = $1', [agreementId]);
      for (const [position, i] of items.entries()) {
        await tx.exec(
          `INSERT INTO framework_agreement_items (agreement_id, position, stock_item_id, description, unit_id, unit_price, max_quantity, requisition_item_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [agreementId, position, i.stockItemId, i.description, i.unitId, i.unitPrice, i.maxQuantity, i.requisitionItemId]
        );
      }
    }
  }

  /** Création (brouillon) */
  async create(data, { userId, enterpriseId }) {
    if (!enterpriseId) throw fail(403, 'ENTERPRISE_REQUIRED', 'Réservé aux utilisateurs d\'une entreprise');
    return db.withTransaction(async (tx) => {
      const { fields, projectIds, items } = await this.checkData(tx, { projectIds: [], items: [], ...data }, { enterpriseId });
      const cols = Object.keys(fields);
      const row = await tx.one(
        `INSERT INTO framework_agreements (enterprise_id, created_by, ${cols.join(', ')})
         VALUES ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING id, agreement_number`,
        [enterpriseId, userId, ...cols.map(c => fields[c])]
      );
      await this.writeChildren(tx, row.id, { projectIds, items });
      return { id: row.id, agreementNumber: row.agreement_number };
    });
  }

  /** Modification d'un brouillon (champs absents = inchangés ; projectIds / items fournis = remplacés) */
  async update(id, data, { enterpriseId }) {
    return db.withTransaction(async (tx) => {
      const current = await tx.one('SELECT * FROM framework_agreements WHERE id::text = $1 FOR UPDATE', [String(id)]);
      if (!current) throw fail(404, 'NOT_FOUND', 'Accord-cadre introuvable');
      if (current.status !== 'DRAFT') throw fail(409, 'NOT_EDITABLE', 'Seul un brouillon est modifiable');
      const before = await this.snapshot(tx, current.id);
      const { fields, projectIds, items } = await this.checkData(tx, data, { enterpriseId: current.enterprise_id, current });
      const cols = Object.keys(fields);
      await tx.exec(
        `UPDATE framework_agreements SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [current.id, ...cols.map(c => fields[c])]
      );
      await this.writeChildren(tx, current.id, { projectIds, items });
      return { id: current.id, before, after: await this.snapshot(tx, current.id) };
    });
  }

  /** Photo pour l'audit (avant / après) */
  async snapshot(tx, id) {
    const a = await tx.one(
      `SELECT title, contract_reference, supplier_id, tender_id, start_date, end_date, ceiling_amount::float8 AS ceiling_amount,
              currency_id, allow_off_list FROM framework_agreements WHERE id = $1`,
      [id]
    );
    a.projects = (await tx.select('SELECT project_id FROM framework_agreement_projects WHERE agreement_id = $1 ORDER BY project_id', [id])).map(r => r.project_id);
    a.items = await tx.select(
      `SELECT description, unit_id, unit_price::float8 AS unit_price, max_quantity::float8 AS max_quantity
       FROM framework_agreement_items WHERE agreement_id = $1 ORDER BY position`,
      [id]
    );
    return a;
  }

  /**
   * Bordereau proposé depuis un appel d'offres attribué, pour un fournisseur attributaire : articles de la réquisition
   * attribués à ce fournisseur (attribution par article) ou tous les articles chiffrés (attribution unique), au prix de
   * son offre.
   */
  async prefillFromTender(tenderId, supplierId, { enterpriseId }) {
    const tender = await this.awardedTender(db, tenderId, enterpriseId);
    const supplier = await db.one('SELECT id, name FROM suppliers WHERE id::text = $1', [String(supplierId || tender.awarded_supplier_id || '')]);
    const awardees = await db.select(
      `SELECT DISTINCT s.id, s.name FROM suppliers s
       WHERE s.id = (SELECT awarded_supplier_id FROM tenders WHERE id = $1)
          OR s.id IN (SELECT supplier_id FROM tender_awards WHERE tender_id = $1) ORDER BY s.name`,
      [tender.id]
    );
    if (!supplier || !awardees.some(s => String(s.id) === String(supplier.id))) {
      return { tender, awardees, supplier: null, items: [] };
    }
    const perItem = !!(await db.one('SELECT 1 AS ok FROM tender_awards WHERE tender_id = $1 LIMIT 1', [tender.id]));
    const items = await db.select(
      perItem
        ? `SELECT ri.id AS requisition_item_id, ri.item_description AS description, ri.unit_id, ri.stock_item_id, ta.unit_price::float8 AS unit_price
           FROM tender_awards ta JOIN requisition_items ri ON ri.id = ta.requisition_item_id
           WHERE ta.tender_id = $1 AND ta.supplier_id = $2 ORDER BY ri.id`
        : `SELECT ri.id AS requisition_item_id, ri.item_description AS description, ri.unit_id, ri.stock_item_id, si.unit_price::float8 AS unit_price
           FROM tender_submissions ts JOIN tender_submission_items si ON si.submission_id = ts.id
           JOIN requisition_items ri ON ri.id = si.requisition_item_id
           WHERE ts.tender_id = $1 AND ts.supplier_id = $2 ORDER BY ri.id`,
      [tender.id, supplier.id]
    );
    return { tender, awardees, supplier, items };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Soumission d'un brouillon : bordereau (ou articles hors bordereau autorisés), contrat signé joint si saisi à la main,
   * chef actif pour chaque projet listé, au moins un directeur général actif. Nouveau tour de validation.
   */
  async submit(id, { userId }) {
    return db.withTransaction(async (tx) => {
      const a = await tx.one('SELECT * FROM framework_agreements WHERE id::text = $1 FOR UPDATE', [String(id)]);
      if (!a) throw fail(404, 'NOT_FOUND', 'Accord-cadre introuvable');
      if (a.status !== 'DRAFT') throw fail(409, 'NOT_DRAFT', 'Seul un brouillon peut être soumis');
      const itemCount = (await tx.one('SELECT COUNT(*)::int AS n FROM framework_agreement_items WHERE agreement_id = $1', [a.id])).n;
      if (!itemCount && !a.allow_off_list) throw fail(400, 'ITEMS_REQUIRED', 'Ajoutez au moins un article au bordereau (ou autorisez les articles hors bordereau)');
      if (!a.tender_id) {
        const attached = await tx.one('SELECT 1 AS ok FROM attachments WHERE entity_type = $1 AND entity_id = $2 LIMIT 1', [ATTACHMENT_TYPE, a.id]);
        if (!attached) throw fail(400, 'CONTRACT_REQUIRED', 'Joignez le contrat signé avant de soumettre');
      }
      const missing = await tx.select(
        `SELECT p.code FROM framework_agreement_projects fp JOIN projects p ON p.id = fp.project_id
         LEFT JOIN users pm ON pm.id = p.project_manager_id AND pm.is_active
         WHERE fp.agreement_id = $1 AND pm.id IS NULL ORDER BY p.code`,
        [a.id]
      );
      if (missing.length) {
        throw fail(409, 'PROJECT_MANAGER_MISSING', `Projet sans chef de projet actif : ${missing.map(m => m.code).join(', ')}`, { details: { projects: missing.map(m => m.code) } });
      }
      const dg = await tx.one(
        `SELECT 1 AS ok FROM users u JOIN user_profiles up ON up.user_id = u.id AND up.profile_id = 'prof_dg'
         WHERE u.is_active AND u.enterprise_id = $1 AND u.id IS DISTINCT FROM $2 LIMIT 1`,
        [a.enterprise_id, a.created_by]
      );
      if (!dg) throw fail(409, 'DG_MISSING', 'Aucun directeur général actif (profil « Directeur Général ») dans l\'entreprise pour valider le contrat');
      await tx.exec(
        `UPDATE framework_agreements SET status = 'PENDING_VALIDATION', submission_round = submission_round + 1,
                submitted_by = $2, submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [a.id, userId]
      );
      return { id: a.id };
    });
  }

  /**
   * Décision : { decision: APPROVE | REJECT, comment } — étape chef de projet (une ligne par projet en attente que
   * l'utilisateur gère, intérim noté) ou DG (dernier : active le contrat). Rejet : retour en brouillon, motif obligatoire.
   */
  async decide(id, { userId, decision, comment }) {
    const d = String(decision || '').toUpperCase();
    if (!['APPROVE', 'REJECT'].includes(d)) throw fail(400, 'DECISION_REQUIRED', 'Décision obligatoire (approuver ou rejeter)');
    const reason = text(comment, 2000);
    if (d === 'REJECT' && !reason) throw fail(400, 'REASON_REQUIRED', 'Motif obligatoire pour un rejet');
    return db.withTransaction(async (tx) => {
      const a = await tx.one('SELECT * FROM framework_agreements WHERE id::text = $1 FOR UPDATE', [String(id)]);
      if (!a) throw fail(404, 'NOT_FOUND', 'Accord-cadre introuvable');
      if (a.status !== 'PENDING_VALIDATION') throw fail(409, 'NOT_PENDING', 'Le contrat n\'attend pas de validation');
      if (String(a.created_by) === String(userId)) throw fail(403, 'SELF_APPROVAL', 'Le contrat doit être validé par une autre personne que son auteur');
      if (!(await tx.one('SELECT user_can_validate_framework_agreement($1, $2) AS ok', [userId, a.id]))?.ok) {
        throw fail(403, 'NOT_VALIDATOR', 'Validation réservée au chef de projet concerné, puis au directeur général');
      }
      const pending = await tx.select(
        `SELECT x.project_id, p.project_manager_id FROM framework_agreement_pending_projects($1) x(project_id)
         JOIN projects p ON p.id = x.project_id WHERE user_manages_project($2, x.project_id)`,
        [a.id, userId]
      );
      const step = pending.length ? 'PROJECT_MANAGER' : 'DG';
      const decisionValue = d === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      if (step === 'PROJECT_MANAGER') {
        for (const p of pending) {
          await tx.exec(
            `INSERT INTO framework_agreement_approvals (agreement_id, round, step, project_id, decision, decided_by, on_behalf_of, comment)
             VALUES ($1, $2, 'PROJECT_MANAGER', $3, $4, $5, $6, $7)`,
            [a.id, a.submission_round, p.project_id, decisionValue, userId,
             String(p.project_manager_id) !== String(userId) ? p.project_manager_id : null, reason || null]
          );
        }
      } else {
        await tx.exec(
          `INSERT INTO framework_agreement_approvals (agreement_id, round, step, decision, decided_by, comment)
           VALUES ($1, $2, 'DG', $3, $4, $5)`,
          [a.id, a.submission_round, decisionValue, userId, reason || null]
        );
      }
      let status = 'PENDING_VALIDATION';
      if (d === 'REJECT') {
        status = 'DRAFT';
        await tx.exec(
          `UPDATE framework_agreements SET status = 'DRAFT', last_reject_reason = $2, last_rejected_by = $3, last_rejected_at = CURRENT_TIMESTAMP,
                  updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [a.id, reason, userId]
        );
      } else if (step === 'DG') {
        status = 'ACTIVE';
        await tx.exec(
          `UPDATE framework_agreements SET status = 'ACTIVE', activated_by = $2, activated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [a.id, userId]
        );
      }
      return { id: a.id, step, decision: decisionValue, status, projects: pending.map(p => p.project_id) };
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Commandes sur accord-cadre (méthode d'achat FRAMEWORK_AGREEMENT)
  // ---------------------------------------------------------------------------------------------------------------

  /** Contrats utilisables pour une réquisition : actifs, en cours de validité, ouverts à son projet, reste disponible > 0 */
  async usableFor(requisitionId) {
    const r = await db.one('SELECT id, project_id, enterprise_id FROM requisitions WHERE id::text = $1', [String(requisitionId)]);
    if (!r) return [];
    const rows = await db.select(
      `${HEADER_SQL}
       WHERE a.enterprise_id = $1 AND a.status = 'ACTIVE' AND CURRENT_DATE BETWEEN a.start_date AND a.end_date AND s.status = 'ACTIVE'
         AND (NOT EXISTS (SELECT 1 FROM framework_agreement_projects fp WHERE fp.agreement_id = a.id)
              OR EXISTS (SELECT 1 FROM framework_agreement_projects fp WHERE fp.agreement_id = a.id AND fp.project_id = $2))
       ORDER BY s.name, a.end_date`,
      [r.enterprise_id, r.project_id]
    );
    return rows.map(withAmounts).filter(a => a.remaining_amount > 0);
  }

  /**
   * Contrat retenu pour une réquisition (méthode FRAMEWORK_AGREEMENT) : contrôlé à la complétion de l'étape « Méthode
   * d'achat ». 400 AGREEMENT_REQUIRED / AGREEMENT_NOT_FOUND ; 409 AGREEMENT_NOT_ACTIVE / AGREEMENT_NOT_STARTED /
   * AGREEMENT_EXPIRED / AGREEMENT_PROJECT / AGREEMENT_SUPPLIER_INACTIVE / AGREEMENT_CEILING_REACHED
   */
  async checkUsable(agreementId, requisitionId) {
    if (!agreementId) throw fail(400, 'AGREEMENT_REQUIRED', 'Choisissez l\'accord-cadre sur lequel commander');
    const r = await db.one('SELECT id, project_id, enterprise_id FROM requisitions WHERE id::text = $1', [String(requisitionId)]);
    const a = r && await this.getHeader(agreementId);
    if (!a || String(a.enterprise_id) !== String(r.enterprise_id)) throw fail(400, 'AGREEMENT_NOT_FOUND', 'Accord-cadre introuvable');
    this.assertOrderable(a, null);
    if (a.projects.length && !a.projects.some(p => String(p.id) === String(r.project_id))) {
      throw fail(409, 'AGREEMENT_PROJECT', `L'accord-cadre ${a.agreement_number} n'est pas ouvert au projet de cette réquisition`);
    }
    if (a.supplier_status !== 'ACTIVE') throw fail(409, 'AGREEMENT_SUPPLIER_INACTIVE', 'Le fournisseur de l\'accord-cadre n\'est plus actif');
    if (!(a.remaining_amount > 0)) throw fail(409, 'AGREEMENT_CEILING_REACHED', `Le plafond de l'accord-cadre ${a.agreement_number} est atteint`);
    return a;
  }

  /** Contrat actif à la date de commande (AAAA-MM-JJ, défaut : aujourd'hui) */
  assertOrderable(a, orderDate) {
    if (a.status !== 'ACTIVE') throw fail(409, 'AGREEMENT_NOT_ACTIVE', `L'accord-cadre ${a.agreement_number} n'est pas actif (${a.status})`);
    const day = orderDate ? String(orderDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
    if (day < String(a.start_date)) throw fail(409, 'AGREEMENT_NOT_STARTED', `L'accord-cadre ${a.agreement_number} commence le ${a.start_date}`, { details: { startDate: a.start_date } });
    if (day > String(a.end_date)) throw fail(409, 'AGREEMENT_EXPIRED', `L'accord-cadre ${a.agreement_number} a expiré le ${a.end_date}`, { details: { endDate: a.end_date } });
  }

  /** Contrat d'une réquisition (bon de commande) : en-tête + bordereau avec quantités déjà commandées */
  async forRequisition(requisitionId) {
    const r = await db.one('SELECT framework_agreement_id FROM requisitions WHERE id::text = $1', [String(requisitionId)]);
    if (!r?.framework_agreement_id) return null;
    const a = await this.getById(r.framework_agreement_id);
    if (a) delete a.attachments;
    return a;
  }

  /**
   * Contrôles d'un bon de commande passé sur le contrat, DANS la transaction de création (contrat verrouillé : deux
   * commandes simultanées ne dépassent pas le plafond). Renvoie les lignes avec frameworkItemId.
   * - contrat actif à la date de commande, même fournisseur, même devise ;
   * - ligne du bordereau (frameworkItemId, sinon même ligne de réquisition / article du catalogue / désignation) au prix
   *   du bordereau, quantité maximale respectée ; hors bordereau seulement si le contrat l'autorise ;
   * - montant cumulé (bons actifs + celui-ci) ≤ plafond.
   */
  async checkOrder(tx, { agreementId, supplierId, currencyId, orderDate, items }) {
    const a = await tx.one('SELECT * FROM framework_agreements WHERE id = $1 FOR UPDATE', [agreementId]);
    if (!a) throw fail(409, 'AGREEMENT_NOT_FOUND', 'Accord-cadre introuvable');
    this.assertOrderable(a, orderDate);
    if (String(a.supplier_id) !== String(supplierId)) {
      throw fail(409, 'AGREEMENT_SUPPLIER_MISMATCH', 'Le bon de commande doit être passé au fournisseur de l\'accord-cadre');
    }
    if (currencyId && String(a.currency_id) !== String(currencyId)) {
      throw fail(409, 'AGREEMENT_CURRENCY_MISMATCH', 'Le bon de commande doit être dans la devise de l\'accord-cadre');
    }
    const priceList = await tx.select(
      `SELECT i.id, i.description, i.stock_item_id, i.requisition_item_id, i.unit_price::float8 AS unit_price, i.max_quantity::float8 AS max_quantity,
              COALESCE((SELECT SUM(l.quantity) FROM v_framework_agreement_po_lines l WHERE l.framework_item_id = i.id), 0)::float8 AS ordered
       FROM framework_agreement_items i WHERE i.agreement_id = $1`,
      [a.id]
    );
    const norm = (s) => String(s || '').trim().toLowerCase();
    const unique = (list) => (list.length === 1 ? list[0] : null);
    const wanted = new Map();
    const out = [];
    let total = 0;
    for (const [index, item] of (items || []).entries()) {
      const quantity = Number(item.quantity) || 0;
      const unitPrice = Number(item.unitPrice) || 0;
      let line = null;
      if (item.frameworkItemId) {
        line = priceList.find(p => String(p.id) === String(item.frameworkItemId));
        if (!line) throw fail(400, 'AGREEMENT_ITEM_INVALID', 'Ligne absente du bordereau de l\'accord-cadre', { line: index });
      } else {
        line = (item.requisitionItemId && unique(priceList.filter(p => p.requisition_item_id && String(p.requisition_item_id) === String(item.requisitionItemId))))
          || (item.stockItemId && unique(priceList.filter(p => p.stock_item_id && String(p.stock_item_id) === String(item.stockItemId))))
          || unique(priceList.filter(p => norm(p.description) === norm(item.description)));
      }
      if (!line) {
        if (!a.allow_off_list) {
          throw fail(400, 'AGREEMENT_ITEM_OFF_LIST', `« ${item.description} » n'est pas au bordereau de l'accord-cadre (articles hors bordereau refusés)`, { line: index, details: { description: item.description } });
        }
      } else {
        if (Math.abs(unitPrice - line.unit_price) > 0.00005) {
          throw fail(400, 'AGREEMENT_PRICE_MISMATCH', `« ${line.description} » : prix du bordereau ${line.unit_price}`, { line: index, details: { description: line.description, expected: line.unit_price } });
        }
        wanted.set(line.id, (wanted.get(line.id) || 0) + quantity);
      }
      total += quantity * unitPrice;
      out.push({ ...item, frameworkItemId: line?.id || null });
    }
    for (const [lineId, quantity] of wanted) {
      const line = priceList.find(p => p.id === lineId);
      if (line.max_quantity && line.ordered + quantity > line.max_quantity + 0.0001) {
        const remaining = Math.max(0, Math.round((line.max_quantity - line.ordered) * 1e4) / 1e4);
        throw fail(400, 'AGREEMENT_QUANTITY_EXCEEDED', `« ${line.description} » : ${quantity} commandé(s), ${remaining} au plus (quantité maximale du contrat)`,
          { details: { description: line.description, max: line.max_quantity, ordered: line.ordered, remaining, quantity } });
      }
    }
    const consumed = Number((await tx.one('SELECT framework_agreement_consumed($1)::float8 AS n', [a.id])).n) || 0;
    const ceiling = Number(a.ceiling_amount);
    if (consumed + total > ceiling + 0.005) {
      const remaining = Math.max(0, Math.round((ceiling - consumed) * 100) / 100);
      throw fail(409, 'AGREEMENT_CEILING_EXCEEDED', `Plafond de l'accord-cadre dépassé : ${Math.round(total * 100) / 100} commandé(s), ${remaining} disponible(s)`,
        { details: { ceiling, consumed, remaining, amount: Math.round(total * 100) / 100 } });
    }
    return { items: out, agreement: a, consumedAfter: consumed + total };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Vie du contrat
  // ---------------------------------------------------------------------------------------------------------------

  /** action : suspend (ACTIVE → SUSPENDED, motif), reactivate (SUSPENDED → ACTIVE), close (ACTIVE / SUSPENDED → CLOSED, motif),
   *  cancel (DRAFT / PENDING_VALIDATION → CANCELLED) */
  async changeStatus(id, action, { userId, reason }) {
    const rules = {
      suspend: { from: ['ACTIVE'], to: 'SUSPENDED', reasonRequired: true },
      reactivate: { from: ['SUSPENDED'], to: 'ACTIVE' },
      close: { from: ['ACTIVE', 'SUSPENDED'], to: 'CLOSED', reasonRequired: true },
      cancel: { from: ['DRAFT', 'PENDING_VALIDATION'], to: 'CANCELLED' },
    };
    const rule = rules[action];
    if (!rule) throw fail(400, 'ACTION_INVALID', 'Action inconnue');
    const why = text(reason, 2000);
    if (rule.reasonRequired && !why) throw fail(400, 'REASON_REQUIRED', 'Motif obligatoire');
    return db.withTransaction(async (tx) => {
      const a = await tx.one('SELECT id, status, end_date FROM framework_agreements WHERE id::text = $1 FOR UPDATE', [String(id)]);
      if (!a) throw fail(404, 'NOT_FOUND', 'Accord-cadre introuvable');
      if (!rule.from.includes(a.status)) throw fail(409, 'STATUS_INVALID', 'Action impossible dans l\'état actuel du contrat');
      const set = {
        suspend: 'suspended_by = $2, suspended_at = CURRENT_TIMESTAMP, suspend_reason = $3',
        reactivate: 'suspended_by = NULL, suspended_at = NULL, suspend_reason = NULL',
        close: 'closed_by = $2, closed_at = CURRENT_TIMESTAMP, close_reason = $3',
        cancel: 'closed_by = $2, closed_at = CURRENT_TIMESTAMP, close_reason = $3',
      }[action];
      const params = action === 'reactivate' ? [a.id, rule.to] : [a.id, userId, why || null, rule.to];
      await tx.exec(
        `UPDATE framework_agreements SET ${set}, status = $${params.length}, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        params
      );
      return { id: a.id, from: a.status, to: rule.to };
    });
  }
}

module.exports = new FrameworkAgreementModel();
module.exports.STATUSES = STATUSES;
module.exports.ATTACHMENT_TYPE = ATTACHMENT_TYPE;
