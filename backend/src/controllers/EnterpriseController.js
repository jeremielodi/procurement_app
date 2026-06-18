// backend/src/controllers/EnterpriseController.js
const enterpriseModel = require('../models/EnterpriseModel');
const currencyModel = require('../models/CurrencyModel');

class EnterpriseController {
  /**
   * Récupérer toutes les entreprises
   * GET /api/enterprises
   */
  async list(req, res) {
    try {
      const { search, currency_id, page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;
      
      const enterprises = await enterpriseModel.findAll({
        search,
        currency_id,
        limit: parseInt(limit),
        offset: parseInt(offset)
      });
      
      const total = await enterpriseModel.count({ search, currency_id });
      
      res.json({
        success: true,
        data: enterprises,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Error listing enterprises:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Récupérer une entreprise par ID
   * GET /api/enterprises/:id
   */
  async getOne(req, res) {
    try {
      const { id } = req.params;
      const enterprise = await enterpriseModel.findById(id);
      
      if (!enterprise) {
        return res.status(404).json({ success: false, message: 'Entreprise non trouvée' });
      }
      
      res.json({ success: true, data: enterprise });
    } catch (error) {
      console.error('Error getting enterprise:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Récupérer une entreprise par code
   * GET /api/enterprises/code/:code
   */
  async getByCode(req, res) {
    try {
      const { code } = req.params;
      const enterprise = await enterpriseModel.findByCode(code);
      
      if (!enterprise) {
        return res.status(404).json({ success: false, message: 'Entreprise non trouvée' });
      }
      
      res.json({ success: true, data: enterprise });
    } catch (error) {
      console.error('Error getting enterprise by code:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Créer une entreprise
   * POST /api/enterprises
   */
  async create(req, res) {
    try {
      const { name, code, currencyId } = req.body;
      
      // Validation
      if (!name || !code || !currencyId) {
        return res.status(400).json({
          success: false,
          message: 'name, code et currencyId sont requis'
        });
      }
      
      // Vérifier que le nom n'existe pas déjà
      const existingName = await enterpriseModel.findByName(name);
      if (existingName) {
        return res.status(400).json({
          success: false,
          message: 'Une entreprise avec ce nom existe déjà'
        });
      }
      
      // Vérifier que le code n'existe pas déjà
      const existingCode = await enterpriseModel.findByCode(code);
      if (existingCode) {
        return res.status(400).json({
          success: false,
          message: 'Une entreprise avec ce code existe déjà'
        });
      }
      
      const result = await enterpriseModel.create({
        name,
        code,
        currencyId
      });
      
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      console.error('Error creating enterprise:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Mettre à jour une entreprise
   * PUT /api/enterprises/:id
   */
  async update(req, res) {
    try {
      const { id } = req.params;
      const { name, code, currencyId } = req.body;
      
      const existing = await enterpriseModel.findById(id);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Entreprise non trouvée' });
      }
      
      // Vérifier que le nom n'est pas déjà utilisé par une autre entreprise
      if (name && name !== existing.name) {
        const nameExists = await enterpriseModel.findByName(name);
        if (nameExists && nameExists.id !== id) {
          return res.status(400).json({
            success: false,
            message: 'Une entreprise avec ce nom existe déjà'
          });
        }
      }
      
      // Vérifier que le code n'est pas déjà utilisé par une autre entreprise
      if (code && code !== existing.code) {
        const codeExists = await enterpriseModel.findByCode(code);
        if (codeExists && codeExists.id !== id) {
          return res.status(400).json({
            success: false,
            message: 'Une entreprise avec ce code existe déjà'
          });
        }
      }
      
      await enterpriseModel.update(id, { name, code, currencyId });
      
      res.json({ success: true, message: 'Entreprise mise à jour' });
    } catch (error) {
      console.error('Error updating enterprise:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Supprimer une entreprise
   * DELETE /api/enterprises/:id
   */
  async delete(req, res) {
    try {
      const { id } = req.params;
      
      const existing = await enterpriseModel.findById(id);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Entreprise non trouvée' });
      }
      
      await enterpriseModel.delete(id);
      
      res.json({ success: true, message: 'Entreprise supprimée' });
    } catch (error) {
      console.error('Error deleting enterprise:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Récupérer l'entreprise par défaut
   * GET /api/enterprises/default
   */
  async getDefault(req, res) {
    try {
      const enterprise = await enterpriseModel.getDefault();
      
      if (!enterprise) {
        return res.status(404).json({
          success: false,
          message: 'Aucune entreprise trouvée'
        });
      }
      
      res.json({ success: true, data: enterprise });
    } catch (error) {
      console.error('Error getting default enterprise:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new EnterpriseController();