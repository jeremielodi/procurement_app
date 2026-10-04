// backend/src/models/SupplierModel.js
// Fournisseurs — PARTAGÉS entre toutes les entreprises de procureApp.
// Les évaluations, elles, sont propres à chaque entreprise (supplier_evaluations.enterprise_id).
const db = require('../config/database');
const tenant = require('../utils/tenant');

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
};
// Identité d'un fournisseur inscrit sur le portail : gérée par le fournisseur lui-même
const SELF_MANAGED = ['name', 'registration_number', 'tax_id', 'email', 'phone', 'address', 'website',
  'bank_name', 'bank_account', 'bank_iban', 'bank_swift'];

function pickFields(data, { exclude = [] } = {}) {
  const out = {};
  for (const [key, col] of Object.entries(FIELDS)) {
    if (data[key] === undefined || exclude.includes(col)) continue;
    let v = data[key];
    if (col === 'prequalified') v = v === true || v === 'true';
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

  async getAll() {
    return db.select('SELECT * FROM suppliers ORDER BY name', []);
  }

  async getPrequalifiedSuppliers() {
    return db.select("SELECT * FROM suppliers WHERE prequalified = true AND status = 'ACTIVE' ORDER BY name", []);
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
