// backend/src/models/SupplierModel.js
// Fournisseurs — PARTAGÉS entre toutes les entreprises de procureApp.
// Les évaluations, elles, sont propres à chaque entreprise (supplier_evaluations.enterprise_id).
const db = require('../config/database');
const tenant = require('../utils/tenant');
const { localizedSql } = require('../utils/requestLang');
const { missingDocuments, EXPECTED_DOCS } = require('../utils/supplierDocuments');

// Champs modifiables par un acheteur : clé API (camelCase ou snake_case) → colonne
const FIELDS = {
  name: 'name',
  registration_number: 'registration_number', registrationNumber: 'registration_number',
  tax_id: 'tax_id', taxId: 'tax_id',
  email: 'email', phone: 'phone', address: 'address', website: 'website',
  status: 'status',
  prequalified: 'prequalified',
  payment_terms: 'payment_terms', paymentTerms: 'payment_terms',
  delivery_terms: 'delivery_terms', deliveryTerms: 'delivery_terms',
  bank_name: 'bank_name', bankName: 'bank_name',
  bank_account: 'bank_account', bankAccount: 'bank_account',
  bank_iban: 'bank_iban', bankIban: 'bank_iban',
  bank_swift: 'bank_swift', bankSwift: 'bank_swift',
  notes: 'notes',
  supplier_type: 'supplier_type', supplierType: 'supplier_type',
  id_nat: 'id_nat', idNat: 'id_nat',
  id_document_number: 'id_document_number', idDocumentNumber: 'id_document_number',
  contact_name: 'contact_name', contactName: 'contact_name',
};
// Identité d'un fournisseur inscrit sur le portail : gérée par le fournisseur lui-même
const SELF_MANAGED = ['name', 'registration_number', 'tax_id', 'email', 'phone', 'address', 'website',
  'bank_name', 'bank_account', 'bank_iban', 'bank_swift', 'supplier_type', 'id_nat', 'id_document_number', 'contact_name'];

function pickFields(data, { exclude = [] } = {}) {
  const out = {};
  for (const [key, col] of Object.entries(FIELDS)) {
    if (data[key] === undefined || exclude.includes(col)) continue;
    let v = data[key];
    if (col === 'prequalified') v = v === true || v === 'true';
    else if (col === 'supplier_type') v = v === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'COMPANY';
    else if (typeof v === 'string') v = v.trim() === '' ? null : v.trim();
    out[col] = v;
  }
  return out;
}

class SupplierModel {
  async generateCode() {
    const year = new Date().getFullYear();
    const row = await db.one(
      `SELECT COALESCE(MAX(CAST(SPLIT_PART(supplier_code, '-', 3) AS INTEGER)), 0) AS max_seq
       FROM suppliers WHERE supplier_code ~ $1`,
      [`^SUP-${year}-[0-9]+$`]
    );
    return `SUP-${year}-${String(parseInt(row.max_seq) + 1).padStart(4, '0')}`;
  }

  /** Créer un fournisseur (accepte camelCase ou snake_case) ; renvoie la ligne créée */
  async create(data) {
    const fields = pickFields(data);
    if (!fields.name) throw Object.assign(new Error('Le nom du fournisseur est requis'), { status: 400 });
    const row = {
      supplier_code: await this.generateCode(),
      status: 'ACTIVE',
      prequalified: false,
      due_diligence_completed: false,
      ...fields,
    };
    const cols = Object.keys(row);
    const created = await db.one(
      `INSERT INTO suppliers (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      cols.map(c => row[c])
    );
    return created;
  }

  /**
   * Modifier un fournisseur. Pour un fournisseur inscrit sur le portail, son identité (nom, coordonnées,
   * banque) n'est modifiable que par lui : seuls statut, préqualification, conditions et notes changent.
   */
  async update(id, data) {
    const existing = await this.getById(id);
    if (!existing) return null;
    const fields = pickFields(data, { exclude: existing.self_registered ? SELF_MANAGED : [] });
    if (fields.name === null) throw Object.assign(new Error('Le nom du fournisseur est requis'), { status: 400 });
    if (Object.keys(fields).length) {
      fields.updated_at = new Date();
      await db.update('suppliers', fields, 'id', id);
    }
    return { supplier: await this.getById(id), ignoredIdentity: existing.self_registered };
  }

  async updatePrequalification(id, prequalified, dueDiligenceCompleted = true) {
    await db.update('suppliers', {
      prequalified,
      due_diligence_completed: dueDiligenceCompleted,
      due_diligence_date: new Date(),
      updated_at: new Date(),
    }, 'id', id);
    return this.getById(id);
  }

  async getById(id) {
    if (!/^\d+$/.test(String(id))) return null;
    return db.one('SELECT * FROM suppliers WHERE id = $1', [id]);
  }

  /** Tous les fournisseurs + catégories / localisations déclarées et nombre de catégories préqualifiées (entreprise courante) */
  async getAll() {
    const params = [];
    const preqFilter = tenant.filter('sp.enterprise_id', params);
    return db.select(
      `SELECT s.*,
              ARRAY(SELECT ${localizedSql('c')} FROM supplier_categories sc JOIN market_categories c ON c.id = sc.category_id
                    WHERE sc.supplier_id = s.id ORDER BY 1) AS category_names,
              ARRAY(SELECT l.name FROM supplier_locations sl JOIN locations l ON l.id = sl.location_id
                    WHERE sl.supplier_id = s.id ORDER BY l.name) AS location_names,
              (SELECT COUNT(*) FROM supplier_prequalifications sp
                WHERE sp.supplier_id = s.id AND sp.status = 'APPROVED'${preqFilter})::int AS approved_category_count
       FROM suppliers s ORDER BY s.name`,
      params
    );
  }

  /**
   * Fournisseurs actifs utilisables dans un bon de commande : préqualifiés par l'entreprise courante
   * (au moins une catégorie approuvée) ou marqués préqualifiés (ancienne case globale).
   */
  async getPrequalifiedSuppliers() {
    const params = [];
    const preqFilter = tenant.filter('sp.enterprise_id', params);
    return db.select(
      `SELECT s.* FROM suppliers s
       WHERE s.status = 'ACTIVE'
         AND (s.prequalified = true OR EXISTS (
               SELECT 1 FROM supplier_prequalifications sp
               WHERE sp.supplier_id = s.id AND sp.status = 'APPROVED'${preqFilter}))
       ORDER BY s.name`,
      params
    );
  }

  // ---------------- Localisations / catégories déclarées ----------------

  async getLocations(supplierId) {
    return db.select(
      `SELECT l.id, l.name, l.province, l.is_active FROM supplier_locations sl
       JOIN locations l ON l.id = sl.location_id WHERE sl.supplier_id = $1 ORDER BY l.name`,
      [supplierId]
    );
  }

  async getCategories(supplierId) {
    return db.select(
      `SELECT c.id, ${localizedSql('c')} AS name, c.is_active FROM supplier_categories sc
       JOIN market_categories c ON c.id = sc.category_id WHERE sc.supplier_id = $1 ORDER BY 2`,
      [supplierId]
    );
  }

  /** Remplace la liste (ids déjà validés) */
  async setLinks(table, column, supplierId, ids) {
    const t = db.transaction();
    t.addDeleteQuery(table, 'supplier_id', supplierId);
    for (const id of ids) t.addInsertQuery(table, { supplier_id: supplierId, [column]: id });
    await t.execute();
  }

  async setLocations(supplierId, ids) { return this.setLinks('supplier_locations', 'location_id', supplierId, ids); }
  async setCategories(supplierId, ids) { return this.setLinks('supplier_categories', 'category_id', supplierId, ids); }

  // ---------------- Documents ----------------

  /**
   * Documents du fournisseur + vérification par l'entreprise courante (review_status VERIFIED / REJECTED / null).
   * Une vérification ne vaut que pour la version vérifiée du fichier : remplacé → à revérifier.
   */
  async getDocuments(supplierId) {
    const params = [supplierId];
    const reviewFilter = tenant.filter('r.enterprise_id', params);
    return db.select(
      `SELECT d.id, d.doc_type, d.file_name, d.mime_type, d.file_size, d.uploaded_at,
              TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS uploaded_by_name,
              r.status AS review_status, r.comment AS review_comment, r.reviewed_at,
              TRIM(COALESCE(ru.first_name, '') || ' ' || COALESCE(ru.last_name, '')) AS reviewed_by_name
       FROM supplier_documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
       LEFT JOIN supplier_document_reviews r ON r.document_id = d.id AND r.file_path = d.file_path${reviewFilter}
       LEFT JOIN users ru ON ru.id = r.reviewed_by
       WHERE d.supplier_id = $1 ORDER BY d.doc_type`,
      params
    );
  }

  /** status : VERIFIED | REJECTED | null (annule la vérification) — porte sur la version courante du fichier */
  async reviewDocument(enterpriseId, document, status, comment, userId) {
    if (!status) {
      await db.exec('DELETE FROM supplier_document_reviews WHERE enterprise_id = $1 AND document_id = $2', [enterpriseId, document.id]);
      return;
    }
    await db.exec(
      `INSERT INTO supplier_document_reviews (enterprise_id, document_id, file_path, status, comment, reviewed_by, reviewed_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (enterprise_id, document_id) DO UPDATE SET
         file_path = EXCLUDED.file_path, status = EXCLUDED.status, comment = EXCLUDED.comment,
         reviewed_by = EXCLUDED.reviewed_by, reviewed_at = NOW()`,
      [enterpriseId, document.id, document.file_path, status, comment || null, userId]
    );
  }

  /**
   * État du dossier pour l'entreprise courante : complet = tous les documents attendus déposés ET vérifiés.
   * { missing, toVerify, rejected, complete } (types de documents)
   */
  dossierStatus(supplierType, documents) {
    const byType = Object.fromEntries(documents.map(d => [d.doc_type, d]));
    const expected = EXPECTED_DOCS[supplierType] || EXPECTED_DOCS.COMPANY;
    const missing = expected.filter(t => !byType[t]);
    const rejected = expected.filter(t => byType[t]?.review_status === 'REJECTED');
    const toVerify = expected.filter(t => byType[t] && !byType[t].review_status);
    return { missing, toVerify, rejected, complete: !missing.length && !rejected.length && !toVerify.length };
  }

  async getDossierStatus(supplier) {
    return this.dossierStatus(supplier.supplier_type, await this.getDocuments(supplier.id));
  }

  async getDocument(supplierId, documentId) {
    if (!/^\d+$/.test(String(documentId))) return null;
    return db.one('SELECT * FROM supplier_documents WHERE id = $1 AND supplier_id = $2', [documentId, supplierId]);
  }

  /** Crée ou remplace le document de ce type ; renvoie la clé de l'ancien fichier (à supprimer) */
  async saveDocument(supplierId, doc, uploadedBy) {
    const previous = await db.one(
      'SELECT file_path FROM supplier_documents WHERE supplier_id = $1 AND doc_type = $2',
      [supplierId, doc.doc_type]
    );
    await db.exec(
      `INSERT INTO supplier_documents (supplier_id, doc_type, file_path, file_name, mime_type, file_size, uploaded_by, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (supplier_id, doc_type) DO UPDATE SET
         file_path = EXCLUDED.file_path, file_name = EXCLUDED.file_name, mime_type = EXCLUDED.mime_type,
         file_size = EXCLUDED.file_size, uploaded_by = EXCLUDED.uploaded_by, uploaded_at = NOW()`,
      [supplierId, doc.doc_type, doc.file_path, doc.file_name, doc.mime_type, doc.file_size, uploadedBy || null]
    );
    return previous?.file_path || null;
  }

  /** Types de documents obligatoires manquants */
  async getMissingDocuments(supplier) {
    const docs = await db.select('SELECT doc_type FROM supplier_documents WHERE supplier_id = $1', [supplier.id]);
    return missingDocuments(supplier.supplier_type, docs.map(d => d.doc_type));
  }

  /** Fiche complète : fournisseur + localisations + catégories + documents + documents manquants */
  async getFullProfile(id) {
    const supplier = await this.getById(id);
    if (!supplier) return null;
    const [locations, categories, documents] = await Promise.all([
      this.getLocations(id), this.getCategories(id), this.getDocuments(id),
    ]);
    return {
      ...supplier, locations, categories, documents,
      missing_documents: missingDocuments(supplier.supplier_type, documents.map(d => d.doc_type)),
      dossier: this.dossierStatus(supplier.supplier_type, documents),
    };
  }

  // ---------------- Préqualification (par entreprise et par catégorie) ----------------

  /** Catégories déclarées par le fournisseur + décision de l'entreprise courante (status null = en attente) */
  async getPrequalification(supplierId) {
    const params = [supplierId];
    const preqFilter = tenant.filter('sp.enterprise_id', params);
    return db.select(
      `SELECT c.id AS category_id, ${localizedSql('c')} AS category_name, c.is_active,
              sp.status, sp.comment, sp.decided_at,
              TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS decided_by_name
       FROM supplier_categories sc
       JOIN market_categories c ON c.id = sc.category_id
       LEFT JOIN supplier_prequalifications sp
              ON sp.supplier_id = sc.supplier_id AND sp.category_id = sc.category_id${preqFilter}
       LEFT JOIN users u ON u.id = sp.decided_by
       WHERE sc.supplier_id = $1
       ORDER BY c.name`,
      params
    );
  }

  /** status : APPROVED | REJECTED | null (remise en attente) */
  async setPrequalification(enterpriseId, supplierId, categoryId, status, comment, userId) {
    if (!status) {
      await db.exec(
        'DELETE FROM supplier_prequalifications WHERE enterprise_id = $1 AND supplier_id = $2 AND category_id = $3',
        [enterpriseId, supplierId, categoryId]
      );
      return;
    }
    await db.exec(
      `INSERT INTO supplier_prequalifications (enterprise_id, supplier_id, category_id, status, comment, decided_by, decided_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (enterprise_id, supplier_id, category_id) DO UPDATE SET
         status = EXCLUDED.status, comment = EXCLUDED.comment, decided_by = EXCLUDED.decided_by, decided_at = NOW()`,
      [enterpriseId, supplierId, categoryId, status, comment || null, userId]
    );
  }

  /**
   * Fournisseurs préqualifiés par l'entreprise courante : une ligne par fournisseur × catégorie approuvée.
   * Filtres : categoryId, locationId (localisation desservie), supplierType, search.
   */
  async getPrequalifiedList({ categoryId, locationId, supplierType, search } = {}) {
    const params = [];
    let sql = `
      SELECT s.id, s.supplier_code, s.name, s.supplier_type, s.contact_name, s.email, s.phone, s.address,
             s.registration_number, s.tax_id, s.id_nat, s.bank_name, s.bank_account, s.status,
             c.id AS category_id, ${localizedSql('c')} AS category_name, sp.decided_at, sp.comment,
             ARRAY(SELECT l.name FROM supplier_locations sl JOIN locations l ON l.id = sl.location_id
                   WHERE sl.supplier_id = s.id ORDER BY l.name) AS location_names
      FROM supplier_prequalifications sp
      JOIN suppliers s ON s.id = sp.supplier_id
      JOIN market_categories c ON c.id = sp.category_id
      WHERE sp.status = 'APPROVED' AND s.status = 'ACTIVE'`;
    sql += tenant.filter('sp.enterprise_id', params);
    if (categoryId) { params.push(categoryId); sql += ` AND sp.category_id = $${params.length}`; }
    if (locationId) {
      params.push(locationId);
      sql += ` AND EXISTS (SELECT 1 FROM supplier_locations sl WHERE sl.supplier_id = s.id AND sl.location_id = $${params.length})`;
    }
    if (supplierType) { params.push(supplierType); sql += ` AND s.supplier_type = $${params.length}`; }
    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (s.name ILIKE $${params.length} OR s.supplier_code ILIKE $${params.length} OR s.email ILIKE $${params.length})`;
    }
    sql += ' ORDER BY c.name, s.name';
    return db.select(sql, params);
  }

  async search(searchTerm) {
    const like = `%${searchTerm}%`;
    return db.select(
      'SELECT * FROM suppliers WHERE name ILIKE $1 OR supplier_code ILIKE $1 OR email ILIKE $1 ORDER BY name',
      [like]
    );
  }

  /**
   * Suppression uniquement d'un fournisseur sans historique (commandes, offres, factures)
   * et sans compte portail ; sinon il faut le désactiver (statut INACTIVE).
   */
  async delete(id) {
    const s = await this.getById(id);
    if (!s) return { deleted: false, reason: 'NOT_FOUND' };
    if (s.user_id) return { deleted: false, reason: 'HAS_ACCOUNT' };
    const used = await db.one(
      `SELECT (SELECT COUNT(*) FROM purchase_orders WHERE supplier_id = $1)
            + (SELECT COUNT(*) FROM invoices WHERE supplier_id = $1)
            + (SELECT COUNT(*) FROM tender_submissions WHERE supplier_id = $1) AS n`,
      [id]
    );
    if (parseInt(used.n) > 0) return { deleted: false, reason: 'IN_USE' };
    await db.delete('suppliers', 'id', id);
    return { deleted: true };
  }

  // ---------------- Évaluations (par entreprise) ----------------

  /** Évaluations du fournisseur par l'entreprise courante */
  async getEvaluations(supplierId) {
    const params = [supplierId];
    return db.select(
      `SELECT se.id, se.rating, se.comment, se.created_at,
              TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS evaluator_name
       FROM supplier_evaluations se
       LEFT JOIN users u ON u.id = se.evaluator_id
       WHERE se.supplier_id = $1${tenant.filter('se.enterprise_id', params)}
       ORDER BY se.created_at DESC`,
      params
    );
  }

  /** Ajoute une évaluation (entreprise remplie par trigger) et met à jour la note moyenne */
  async addEvaluation(supplierId, evaluatorId, rating, comment) {
    const r = parseFloat(rating);
    if (!(r >= 1 && r <= 5)) throw Object.assign(new Error('La note doit être comprise entre 1 et 5'), { status: 400 });
    await db.exec(
      'INSERT INTO supplier_evaluations (supplier_id, evaluator_id, rating, comment) VALUES ($1, $2, $3, $4)',
      [supplierId, evaluatorId, r, comment || null]
    );
    // Note affichée = moyenne de toutes les évaluations (réputation sur la plateforme)
    await db.exec(
      `UPDATE suppliers SET
         rating = (SELECT ROUND(AVG(rating)::numeric, 2) FROM supplier_evaluations WHERE supplier_id = $1),
         last_evaluation_date = CURRENT_DATE, evaluation_comments = $2, updated_at = NOW()
       WHERE id = $1`,
      [supplierId, comment || null]
    );
    return this.getById(supplierId);
  }

  /** Ancien nom conservé */
  async rateSupplier(id, rating, comments, evaluatorId = null) {
    return this.addEvaluation(id, evaluatorId, rating, comments);
  }
}

module.exports = new SupplierModel();
