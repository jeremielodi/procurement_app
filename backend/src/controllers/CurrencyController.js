// backend/src/controllers/CurrencyController.js
const currencyModel = require('../models/CurrencyModel');

class CurrencyController {
  /**
   * Récupérer toutes les devises
   * GET /api/currencies
   */
  async list(req, res) {
    try {
      const currencies = await currencyModel.findAll();
      res.json({ success: true, data: currencies });
    } catch (error) {
      console.error('Error listing currencies:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Récupérer une devise par ID
   * GET /api/currencies/:id
   */
  async getOne(req, res) {
    try {
      const { id } = req.params;
      const currency = await currencyModel.findById(id);
      
      if (!currency) {
        return res.status(404).json({ success: false, message: 'Devise non trouvée' });
      }
      
      res.json({ success: true, data: currency });
    } catch (error) {
      console.error('Error getting currency:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Créer une devise
   * POST /api/currencies
   */
  async create(req, res) {
    try {
      const { id, name, formatKey, symbol, intelNumberFormat, note, minMonetaryUnit } = req.body;
      
      // Validation
      if (!id || !name || !formatKey || !symbol) {
        return res.status(400).json({
          success: false,
          message: 'id, name, formatKey et symbol sont requis'
        });
      }
      
      const result = await currencyModel.create({
        id,
        name,
        formatKey,
        symbol,
        intelNumberFormat,
        note,
        minMonetaryUnit
      });
      
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      console.error('Error creating currency:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Mettre à jour une devise
   * PUT /api/currencies/:id
   */
  async update(req, res) {
    try {
      const { id } = req.params;
      const { name, formatKey, symbol, intelNumberFormat, note, minMonetaryUnit } = req.body;
      
      const existing = await currencyModel.findById(id);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Devise non trouvée' });
      }
      
      await currencyModel.update(id, {
        name,
        formatKey,
        symbol,
        intelNumberFormat,
        note,
        minMonetaryUnit
      });
      
      res.json({ success: true, message: 'Devise mise à jour' });
    } catch (error) {
      console.error('Error updating currency:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Supprimer une devise
   * DELETE /api/currencies/:id
   */
  async delete(req, res) {
    try {
      const { id } = req.params;
      
      const existing = await currencyModel.findById(id);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Devise non trouvée' });
      }
      
      // Vérifier si la devise est utilisée
      const usage = await currencyModel.isUsed(id);
      if (usage.used) {
        return res.status(400).json({
          success: false,
          message: 'Cette devise est utilisée et ne peut pas être supprimée',
          data: usage
        });
      }
      
      await currencyModel.delete(id);
      
      res.json({ success: true, message: 'Devise supprimée' });
    } catch (error) {
      console.error('Error deleting currency:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Récupérer la devise par défaut
   * GET /api/currencies/default
   */
  async getDefault(req, res) {
    try {
      const currency = await currencyModel.getDefault();
      res.json({ success: true, data: currency });
    } catch (error) {
      console.error('Error getting default currency:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Récupérer les devises actives
   * GET /api/currencies/active
   */
  async getActive(req, res) {
    try {
      const currencies = await currencyModel.getActiveCurrencies();
      res.json({ success: true, data: currencies });
    } catch (error) {
      console.error('Error getting active currencies:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new CurrencyController();