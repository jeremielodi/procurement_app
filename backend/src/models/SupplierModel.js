// backend/src/models/SupplierModel.js
const db = require('../config/database');

class SupplierModel {
  /**
   * Créer un fournisseur
   */
  async create(supplierData) {
    const year = new Date().getFullYear();
    const countResult = await db.select(
      "SELECT COUNT(*) as count FROM suppliers",
      []
    );
    const supplierCode = `SUP-${year}-${String(parseInt(countResult[0].count) + 1).padStart(4, '0')}`;
    
    return await db.insert('suppliers', {
      supplier_code: supplierCode,
      name: supplierData.name,
      registration_number: supplierData.registrationNumber,
      tax_id: supplierData.taxId,
      email: supplierData.email,
      phone: supplierData.phone,
      address: supplierData.address,
      website: supplierData.website,
      status: 'ACTIVE',
      prequalified: supplierData.prequalified || false,
      due_diligence_completed: false
    });
  }

  /**
   * Mettre à jour la préqualification
   */
  async updatePrequalification(id, prequalified, dueDiligenceCompleted = true) {
    return await db.update('suppliers', {
      prequalified,
      due_diligence_completed: dueDiligenceCompleted,
      due_diligence_date: new Date()
    }, 'id', id);
  }

  /**
   * Récupérer tous les fournisseurs préqualifiés
   */
  async getById(id) {
    const results = await db.select('SELECT * FROM suppliers WHERE id = $1', [id]);
    return results[0] || null;
  }

  async getAll() {
    return db.select('SELECT * FROM suppliers ORDER BY name', []);
  }

  async getPrequalifiedSuppliers() {
    return await db.select(
      "SELECT * FROM suppliers WHERE prequalified = true AND status = 'ACTIVE' ORDER BY name",
      []
    );
  }

  /**
   * Rechercher des fournisseurs
   */
  async search(searchTerm) {
    return await db.select(
      `SELECT * FROM suppliers 
       WHERE name ILIKE ? OR supplier_code ILIKE ? OR email ILIKE ?
       ORDER BY name`,
      [`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`]
    );
  }

  /**
   * Évaluer un fournisseur
   */
  async rateSupplier(id, rating, comments) {
    return await db.update('suppliers', {
      rating,
      last_evaluation_date: new Date(),
      evaluation_comments: comments
    }, 'id', id);
  }
}

module.exports = new SupplierModel();