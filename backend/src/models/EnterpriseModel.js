// backend/src/models/EnterpriseModel.js
const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class EnterpriseModel {
  /**
   * Récupérer toutes les entreprises
   */
  async findAll(filters = {}) {
    let sql = `
      SELECT 
        e.id,
        e.name,
        e.code,
        e.currency_id,
        c.name as currency_name,
        c.symbol as currency_symbol,
        c.format_key as currency_code,
        e.created_at,
        e.last_update
      FROM enterprise e
      LEFT JOIN currency c ON e.currency_id = c.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;
    
    if (filters.search) {
      sql += ` AND (e.name ILIKE $${paramCount} OR e.code ILIKE $${paramCount})`;
      params.push(`%${filters.search}%`);
      paramCount++;
    }
    
    if (filters.currency_id) {
      sql += ` AND e.currency_id = $${paramCount}`;
      params.push(filters.currency_id);
      paramCount++;
    }
    
    sql += ` ORDER BY e.name ASC`;
    
    if (filters.limit) {
      sql += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
      params.push(filters.limit, filters.offset || 0);
    }
    
    return await db.select(sql, params);
  }

  /**
   * Récupérer une entreprise par son ID
   */
  async findById(id) {
    const enterprise = await db.one(`
      SELECT 
        e.id,
        e.name,
        e.code,
        e.currency_id,
        c.name as currency_name,
        c.symbol as currency_symbol,
        c.format_key as currency_code,
        c.intel_number_format,
        e.created_at,
        e.last_update
      FROM enterprise e
      LEFT JOIN currency c ON e.currency_id = c.id
      WHERE e.id = $1
    `, [id]);
    
    if (!enterprise) return null;
    
    return enterprise;
  }

  /**
   * Récupérer une entreprise par son code
   */
  async findByCode(code) {
    const enterprise = await db.one(`
      SELECT 
        e.id,
        e.name,
        e.code,
        e.currency_id,
        c.name as currency_name,
        c.symbol as currency_symbol,
        c.format_key as currency_code,
        e.created_at,
        e.last_update
      FROM enterprise e
      LEFT JOIN currency c ON e.currency_id = c.id
      WHERE e.code = $1
    `, [code]);
    
    if (!enterprise) return null;
    
    return enterprise;
  }

  /**
   * Récupérer une entreprise par son nom
   */
  async findByName(name) {
    const enterprise = await db.one(`
      SELECT 
        e.id,
        e.name,
        e.code,
        e.currency_id,
        c.name as currency_name,
        c.symbol as currency_symbol,
        c.format_key as currency_code,
        e.created_at,
        e.last_update
      FROM enterprise e
      LEFT JOIN currency c ON e.currency_id = c.id
      WHERE e.name = $1
    `, [name]);
    
    if (!enterprise) return null;
    
    return enterprise;
  }

  /**
   * Créer une nouvelle entreprise
   */
  async create(data) {
    const { name, code, currencyId } = data;
    const uuid = uuidv4();
    
    // Vérifier que la devise existe
    const currency = await db.one('SELECT id FROM currency WHERE id = $1', [currencyId]);
    if (!currency) {
      throw new Error('Devise non trouvée');
    }
    
    await db.insert('enterprise', {
      id: uuid,
      name,
      code,
      currency_id: currencyId,
      created_at: new Date(),
      last_update: new Date()
    });
    
    return {
      success: true,
      id: uuid,
      name,
      code,
      currency_id: currencyId
    };
  }

  /**
   * Mettre à jour une entreprise
   */
  async update(id, data) {
    const { name, code, currencyId } = data;
    
    // Vérifier que l'entreprise existe
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error('Entreprise non trouvée');
    }
    
    // Vérifier que la devise existe si elle est fournie
    if (currencyId) {
      const currency = await db.one('SELECT id FROM currency WHERE id = $1', [currencyId]);
      if (!currency) {
        throw new Error('Devise non trouvée');
      }
    }
    
    const updateData = {
      name: name || existing.name,
      code: code || existing.code,
      currency_id: currencyId || existing.currency_id,
      last_update: new Date()
    };
    
    await db.update('enterprise', updateData, 'id', uuid);
    
    return { success: true };
  }

  /**
   * Supprimer une entreprise
   */
  async delete(id) {
    // Vérifier que l'entreprise existe
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error('Entreprise non trouvée');
    }
    
    // Vérifier si l'entreprise est utilisée (par exemple dans des réquisitions)
    // À adapter selon votre schéma
    const usageCount = await db.one(`
      SELECT COUNT(*) as count FROM requisitions WHERE enterprise_id = $1
    `, [id]);
    
    if (parseInt(usageCount.count) > 0) {
      throw new Error('Cette entreprise est utilisée et ne peut pas être supprimée');
    }
    
    await db.delete('enterprise', 'id', id);
    
    return { success: true };
  }

  /**
   * Récupérer l'entreprise par défaut (la première)
   */
  async getDefault() {
    const enterprise = await db.one(`
      SELECT 
        e.id,
        e.name,
        e.code,
        e.currency_id,
        c.name as currency_name,
        c.symbol as currency_symbol,
        c.format_key as currency_code,
        e.created_at,
        e.last_update
      FROM enterprise e
      LEFT JOIN currency c ON e.currency_id = c.id
      ORDER BY e.created_at ASC
      LIMIT 1
    `);
    
    return enterprise || null;
  }

  /**
   * Compter les entreprises
   */
  async count(filters = {}) {
    let sql = `SELECT COUNT(*) as count FROM enterprise WHERE 1=1`;
    const params = [];
    let paramCount = 1;
    
    if (filters.search) {
      sql += ` AND (name ILIKE $${paramCount} OR code ILIKE $${paramCount})`;
      params.push(`%${filters.search}%`);
      paramCount++;
    }
    
    if (filters.currency_id) {
      sql += ` AND currency_id = $${paramCount}`;
      params.push(filters.currency_id);
      paramCount++;
    }
    
    const result = await db.one(sql, params);
    return parseInt(result.count);
  }

  /**
   * Mettre à jour le timestamp de dernière modification
   */
  async updateTimestamp(id) {
    await db.update('enterprise', {
      last_update: new Date()
    }, 'id', id);
    
    return { success: true };
  }
}

module.exports = new EnterpriseModel();