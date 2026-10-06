// backend/src/controllers/UserController.js
const userModel = require('../models/UserModel');
const { audit, AUDIT } = require('../utils/auditLog');

// Profils non attribuables par un administrateur d'entreprise
const RESERVED_PROFILES = ['prof_superadmin', 'prof_supplier'];
const hasReservedProfile = (ids) => Array.isArray(ids) && ids.some(p => RESERVED_PROFILES.includes(p));

class UserController {
  /**
   * Lister les utilisateurs
   */
  async list(req, res) {
    try {
      const { search, is_active, department, page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;
      
      const users = await userModel.findAll({
        search,
        is_active,
        department,
        limit: parseInt(limit),
        offset: parseInt(offset)
      });
      
      const total = await userModel.count({ search, is_active });
      
      res.json({
        success: true,
        data: users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Error listing users:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Créer un utilisateur
   */
  async create(req, res) {
    try {
      const { username, email, password, firstName, lastName, department, position, language, profileIds } = req.body;
      if (hasReservedProfile(profileIds)) {
        return res.status(403).json({ success: false, message: 'Profil réservé à la plateforme (super admin / fournisseur)' });
      }
      
      // Validation
      if (!username || !email || !password) {
        return res.status(400).json({ success: false, message: 'Username, email et password requis' });
      }
      
      // Entreprise de l'administrateur connecté (fixée par tenantContext) : jamais d'utilisateur orphelin
      if (!req.enterpriseId) {
        return res.status(403).json({ success: false, message: 'Seul un administrateur d\'entreprise peut créer des utilisateurs' });
      }
      const result = await userModel.create({
        username,
        email,
        password,
        firstName,
        lastName,
        department,
        position,
        language,
        profileIds: profileIds || [],
        enterpriseId: req.enterpriseId,
      });
      
      await audit(req, AUDIT.USER_CREATED, {
        target: { id: result.id, email: result.email, enterprise_id: req.enterpriseId },
        details: { username, email, firstName, lastName, language, profileIds: profileIds || [] },
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      console.error('Error creating user:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Récupérer un utilisateur
   */
  async getOne(req, res) {
    try {
      const { id } = req.params;
      const user = await userModel.findById(id);
      
      if (!user) {
        return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
      }
      
      res.json({ success: true, data: user });
    } catch (error) {
      console.error('Error getting user:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Mettre à jour un utilisateur
   */
  async update(req, res) {
    try {
      const { id } = req.params;
      const { firstName, lastName, department, position, language, profileIds } = req.body;
      if (hasReservedProfile(profileIds)) {
        return res.status(403).json({ success: false, message: 'Profil réservé à la plateforme (super admin / fournisseur)' });
      }
      
      const existing = await userModel.findById(id);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
      }
      
      await userModel.update(id, {
        firstName,
        lastName,
        department,
        position,
        language,
        profileIds: profileIds || []
      });
      await audit(req, AUDIT.USER_UPDATED, {
        target: { id, email: existing.email, enterprise_id: existing.enterpriseId },
        oldValue: { firstName: existing.firstName, lastName: existing.lastName, department: existing.department, position: existing.position, language: existing.language, profileIds: (existing.profiles || []).map(p => p.id) },
        details: { firstName, lastName, department, position, language, profileIds: profileIds || [] },
      });
      
      res.json({ success: true, message: 'Utilisateur mis à jour' });
    } catch (error) {
      console.error('Error updating user:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Bloquer/Débloquer un utilisateur
   */
  async toggleActive(req, res) {
    try {
      const { id } = req.params;
      const { isActive } = req.body;
      
      const existing = await userModel.findById(id);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
      }
      
      await userModel.toggleActive(id, isActive);
      await audit(req, isActive ? AUDIT.USER_ACTIVATED : AUDIT.USER_DEACTIVATED, {
        target: { id, email: existing.email, enterprise_id: existing.enterpriseId },
      });
      
      res.json({
        success: true,
        message: isActive ? 'Utilisateur activé' : 'Utilisateur bloqué'
      });
    } catch (error) {
      console.error('Error toggling user:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Supprimer un utilisateur
   */
  async delete(req, res) {
    try {
      const { id } = req.params;
      
      const existing = await userModel.findById(id);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
      }
      
      await userModel.delete(id);
      await audit(req, AUDIT.USER_DELETED, {
        target: { id, email: existing.email, enterprise_id: existing.enterpriseId },
        oldValue: { username: existing.username, email: existing.email, firstName: existing.firstName, lastName: existing.lastName },
      });
      
      res.json({ success: true, message: 'Utilisateur supprimé' });
    } catch (error) {
      console.error('Error deleting user:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Réinitialiser le mot de passe
   */
  async resetPassword(req, res) {
    try {
      const { id } = req.params;
      const { newPassword } = req.body;
      
      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'Le mot de passe doit contenir au moins 6 caractères' });
      }
      
      const existing = await userModel.findById(id);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
      }
      
      await userModel.resetPassword(id, newPassword);
      await audit(req, AUDIT.PASSWORD_RESET_BY_ADMIN, { target: { id, email: existing.email, enterprise_id: existing.enterpriseId } });
      
      res.json({ success: true, message: 'Mot de passe réinitialisé' });
    } catch (error) {
      console.error('Error resetting password:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Obtenir tous les profils
   */
  async getProfiles(req, res) {
    try {
      const profiles = (await userModel.getAllProfiles()).filter(p => !RESERVED_PROFILES.includes(p.id));
      res.json({ success: true, data: profiles });
    } catch (error) {
      console.error('Error getting profiles:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new UserController();