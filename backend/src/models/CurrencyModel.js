// backend/src/models/CurrencyModel.js
const db = require('../config/database');

class CurrencyModel {
  /**
   * Récupérer toutes les devises
   */
  async findAll() {
    return await db.select(`
      SELECT 
        id,
        name,
        format_key,
        symbol,
        intel_number_format,
        note,
        min_monentary_unit
      FROM currency
      ORDER BY name
    `);
  }

  /**
   * Récupérer une devise par son ID
   */
  async findById(id) {
    return await db.one(`
      SELECT 
        id,
        name,
        format_key,
        symbol,
        intel_number_format,
        note,
        min_monentary_unit
      FROM currency
      WHERE id = $1
    `, [id]);
  }

  /**
   * Récupérer une devise par son code (format_key)
   */
  async findByCode(code) {
    return await db.one(`
      SELECT 
        id,
        name,
        format_key,
        symbol,
        intel_number_format,
        note,
        min_monentary_unit
      FROM currency
      WHERE format_key = $1
    `, [code]);
  }

  /**
   * Créer une nouvelle devise
   */
  async create(data) {
    const { id, name, formatKey, symbol, intelNumberFormat, note, minMonetaryUnit } = data;
    
    await db.insert('currency', {
      id,
      name,
      format_key: formatKey,
      symbol,
      intel_number_format: intelNumberFormat || 'en-US',
      note: note || null,
      min_monentary_unit: minMonetaryUnit || 0.01
    });
    
    return { success: true, id };
  }

  /**
   * Mettre à jour une devise
   */
  async update(id, data) {
    const { name, formatKey, symbol, intelNumberFormat, note, minMonetaryUnit } = data;
    
    const updateData = {
      name,
      format_key: formatKey,
      symbol,
      intel_number_format: intelNumberFormat || 'en-US',
      note: note || null,
      min_monentary_unit: minMonetaryUnit || 0.01
    };
    
    return await db.update('currency', updateData, 'id', id);
  }

  /**
   * Supprimer une devise
   */
  async delete(id) {
    return await db.delete('currency', 'id', id);
  }

  /**
   * Vérifier si une devise est utilisée
   */
  async isUsed(id) {
    // Vérifier si la devise est utilisée dans les réquisitions
    const requisitionCount = await db.one(`
      SELECT COUNT(*) as count FROM requisitions WHERE currency = $1
    `, [id]);
    
    if (parseInt(requisitionCount.count) > 0) {
      return { used: true, tables: ['requisitions'] };
    }
    
    // Vérifier si la devise est utilisée dans les commandes
    const orderCount = await db.one(`
      SELECT COUNT(*) as count FROM purchase_orders WHERE currency = $1
    `, [id]);
    
    if (parseInt(orderCount.count) > 0) {
      return { used: true, tables: ['purchase_orders'] };
    }
    
    return { used: false };
  }

  /**
   * Récupérer la devise par défaut (USD)
   */
  async getDefault() {
    return await db.one(`
      SELECT 
        id,
        name,
        format_key,
        symbol,
        intel_number_format,
        note,
        min_monentary_unit
      FROM currency
      WHERE format_key = 'USD'
    `);
  }

  /**
   * Formatter un montant selon la devise
   */
  formatAmount(amount, currencyCode = 'USD', locale = 'fr-FR') {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(amount);
    } catch (error) {
      console.error('Error formatting amount:', error);
      return `${amount} ${currencyCode}`;
    }
  }

  /**
   * Obtenir le symbole d'une devise
   */
  async getSymbol(currencyCode) {
    const currency = await this.findByCode(currencyCode);
    return currency?.symbol || currencyCode;
  }

  /**
   * Obtenir les devises actives (utilisées)
   */
  async getActiveCurrencies() {
    return await db.select(`
      SELECT DISTINCT c.*
      FROM currency c
      WHERE c.id IN (
        SELECT DISTINCT currency_id FROM requisitions WHERE currency_id IS NOT NULL
        UNION
        SELECT DISTINCT currency_id FROM purchase_orders WHERE currency_id IS NOT NULL
      )
      ORDER BY c.name
    `);
  }
}

module.exports = new CurrencyModel();