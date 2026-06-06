// backend/src/controllers/ProfileController.js
const profileModel = require('../models/ProfileModel');

class ProfileController {
  async list(req, res) {
    try {
      const profiles = await profileModel.findAll();
      res.json({ success: true, data: profiles });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getOne(req, res) {
    try {
      const profile = await profileModel.findById(req.params.id);
      if (!profile) {
        return res.status(404).json({ success: false, message: 'Profil non trouvé' });
      }
      res.json({ success: true, data: profile });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async create(req, res) {
    try {
      const { name, description } = req.body;
      const result = await profileModel.create({ name, description });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      const { name, description } = req.body;
      await profileModel.update(id, { name, description });
      res.json({ success: true, message: 'Profil mis à jour' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async delete(req, res) {
    try {
      await profileModel.delete(req.params.id);
      res.json({ success: true, message: 'Profil supprimé' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getPermissions(req, res) {
    try {
      const permissions = await profileModel.getPermissions();
      res.json({ success: true, data: permissions });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async assignPermission(req, res) {
    try {
      const { profileId, permissionId } = req.params;
      await profileModel.assignPermission(profileId, permissionId);
      res.json({ success: true, message: 'Permission assignée' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async removePermission(req, res) {
    try {
      const { profileId, permissionId } = req.params;
      await profileModel.removePermission(profileId, permissionId);
      res.json({ success: true, message: 'Permission retirée' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getProfilePermissions(req, res) {
    try {
      const permissions = await profileModel.getProfilePermissions(req.params.profileId);
      res.json({ success: true, data: permissions });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new ProfileController();