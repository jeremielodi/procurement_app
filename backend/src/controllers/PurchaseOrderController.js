// backend/src/controllers/PurchaseOrderController.js
const purchaseOrderModel = require('../models/PurchaseOrderModel');

class PurchaseOrderController {
  /**
   * Créer une commande
   */
  async create(req, res) {
    try {
      const {
        requisitionId,
        supplierId,
        orderDate,
        deliveryDate,
        shippingAddress,
        totalAmount,
        currency,
        items,
        createdBy
      } = req.body;
      
      // Validation
      if (!requisitionId || !supplierId || !totalAmount) {
        return res.status(400).json({
          success: false,
          message: 'requisitionId, supplierId et totalAmount sont requis'
        });
      }
      
      const result = await purchaseOrderModel.create({
        requisitionId,
        supplierId,
        orderDate,
        deliveryDate,
        shippingAddress,
        totalAmount,
        currency,
        items: items || [],
        createdBy: createdBy || req.user?.id || 1
      });
      
      res.status(201).json({
        success: true,
        data: result,
        message: 'Commande créée avec succès'
      });
    } catch (error) {
      console.error('Error creating purchase order:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la création de la commande',
        error: error.message
      });
    }
  }

  /**
   * Récupérer toutes les commandes
   */
  async getAll(req, res) {
    try {
      const {
        status,
        supplierId,
        requisitionId,
        search,
        fromDate,
        toDate,
        page = 1,
        limit = 20
      } = req.query;
      
      const offset = (parseInt(page) - 1) * parseInt(limit);
      
      const purchaseOrders = await purchaseOrderModel.findAll({
        status,
        supplierId,
        requisitionId,
        search,
        fromDate,
        toDate,
        limit: parseInt(limit),
        offset
      });
      
      const total = await purchaseOrderModel.count({ status, supplierId });
      
      res.json({
        success: true,
        data: purchaseOrders,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (error) {
      console.error('Error getting purchase orders:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des commandes',
        error: error.message
      });
    }
  }

  /**
   * Récupérer une commande par ID
   */
  async getById(req, res) {
    try {
      const { id } = req.params;
      const purchaseOrder = await purchaseOrderModel.findById(id);
      
      if (!purchaseOrder) {
        return res.status(404).json({
          success: false,
          message: 'Commande non trouvée'
        });
      }
      
      res.json({
        success: true,
        data: purchaseOrder
      });
    } catch (error) {
      console.error('Error getting purchase order:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération de la commande',
        error: error.message
      });
    }
  }

  /**
   * Mettre à jour une commande
   */
  async update(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      
      const existing = await purchaseOrderModel.findById(id);
      if (!existing) {
        return res.status(404).json({
          success: false,
          message: 'Commande non trouvée'
        });
      }
      
      // Ne pas modifier les commandes déjà approuvées ou envoyées
      if (existing.status !== 'DRAFT') {
        return res.status(400).json({
          success: false,
          message: 'Seules les commandes en brouillon peuvent être modifiées'
        });
      }
      
      const result = await purchaseOrderModel.update(id, updateData);
      
      res.json({
        success: true,
        data: result,
        message: 'Commande mise à jour avec succès'
      });
    } catch (error) {
      console.error('Error updating purchase order:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la mise à jour de la commande',
        error: error.message
      });
    }
  }

  /**
   * Approuver une commande
   */
  async approve(req, res) {
    try {
      const { id } = req.params;
      const { approverId, comments } = req.body;
      
      const existing = await purchaseOrderModel.findById(id);
      if (!existing) {
        return res.status(404).json({
          success: false,
          message: 'Commande non trouvée'
        });
      }
      
      if (existing.status !== 'PO_PENDING') {
        return res.status(400).json({
          success: false,
          message: 'Seules les commandes en attente peuvent être approuvées'
        });
      }
      
      const result = await purchaseOrderModel.approve(id, approverId, comments);
      
      // Notifier via WebSocket si disponible
      if (req.io) {
        req.io.to(`user-${existing.created_by}`).emit('notification', {
          title: 'Commande approuvée',
          message: `La commande ${existing.po_number} a été approuvée`,
          type: 'SUCCESS'
        });
      }
      
      res.json({
        success: true,
        data: result,
        message: 'Commande approuvée avec succès'
      });
    } catch (error) {
      console.error('Error approving purchase order:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de l\'approbation de la commande',
        error: error.message
      });
    }
  }

  /**
   * Rejeter une commande
   */
  async reject(req, res) {
    try {
      const { id } = req.params;
      const { approverId, reason } = req.body;
      
      if (!reason) {
        return res.status(400).json({
          success: false,
          message: 'La raison du rejet est requise'
        });
      }
      
      const existing = await purchaseOrderModel.findById(id);
      if (!existing) {
        return res.status(404).json({
          success: false,
          message: 'Commande non trouvée'
        });
      }
      
      if (existing.status !== 'PO_PENDING') {
        return res.status(400).json({
          success: false,
          message: 'Seules les commandes en attente peuvent être rejetées'
        });
      }
      
      const result = await purchaseOrderModel.reject(id, approverId, reason);
      
      res.json({
        success: true,
        data: result,
        message: 'Commande rejetée'
      });
    } catch (error) {
      console.error('Error rejecting purchase order:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors du rejet de la commande',
        error: error.message
      });
    }
  }

  /**
   * Envoyer la commande au fournisseur
   */
  async send(req, res) {
    try {
      const { id } = req.params;
      
      const existing = await purchaseOrderModel.findById(id);
      if (!existing) {
        return res.status(404).json({
          success: false,
          message: 'Commande non trouvée'
        });
      }
      
      if (existing.status !== 'PO_APPROVED') {
        return res.status(400).json({
          success: false,
          message: 'Seules les commandes approuvées peuvent être envoyées'
        });
      }
      
      const result = await purchaseOrderModel.send(id);
      
      res.json({
        success: true,
        data: result,
        message: 'Commande envoyée au fournisseur'
      });
    } catch (error) {
      console.error('Error sending purchase order:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de l\'envoi de la commande',
        error: error.message
      });
    }
  }

  /**
   * Supprimer une commande
   */
  async delete(req, res) {
    try {
      const { id } = req.params;
      
      const existing = await purchaseOrderModel.findById(id);
      if (!existing) {
        return res.status(404).json({
          success: false,
          message: 'Commande non trouvée'
        });
      }
      
      if (existing.status !== 'DRAFT') {
        return res.status(400).json({
          success: false,
          message: 'Seules les commandes en brouillon peuvent être supprimées'
        });
      }
      
      await purchaseOrderModel.delete(id);
      
      res.json({
        success: true,
        message: 'Commande supprimée avec succès'
      });
    } catch (error) {
      console.error('Error deleting purchase order:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la suppression de la commande',
        error: error.message
      });
    }
  }

  /**
   * Récupérer les statistiques
   */
  async getStats(req, res) {
    try {
      const stats = await purchaseOrderModel.getStats();
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Error getting stats:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des statistiques',
        error: error.message
      });
    }
  }

  /**
   * Générer le PDF d'une commande
   */
  async generatePDF(req, res) {
    try {
      const { id } = req.params;
      const pdfData = await purchaseOrderModel.generatePDF(id);
      
      // Pour l'instant, retourner les données JSON
      // À implémenter avec une vraie génération PDF
      res.json({
        success: true,
        data: pdfData,
        message: 'Données de la commande pour génération PDF'
      });
    } catch (error) {
      console.error('Error generating PDF:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la génération du PDF',
        error: error.message
      });
    }
  }
}

module.exports = new PurchaseOrderController();