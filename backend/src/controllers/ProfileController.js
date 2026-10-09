// backend/src/controllers/ProfileController.js
const profileModel = require('../models/ProfileModel');
const db = require('../config/database');
const { audit, AUDIT } = require('../utils/auditLog');

const permissionName = async (id) => (await db.one('SELECT name FROM permissions WHERE id = $1 OR name = $1', [id]))?.name || id;

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
      await audit(req, AUDIT.ROLE_CREATED, { entity: { type: 'role', id: result?.id || name, label: name }, details: { name, description } });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      const { name, description } = req.body;
      const before = await profileModel.findById(id);
      await profileModel.update(id, { name, description });
      await audit(req, AUDIT.ROLE_UPDATED, {
        entity: { type: 'role', id, label: name || before?.name },
        oldValue: { name: before?.name, description: before?.description }, details: { name, description },
      });
      res.json({ success: true, message: 'Profil mis à jour' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async delete(req, res) {
    try {
      const before = await profileModel.findById(req.params.id);
      await profileModel.delete(req.params.id);
      await audit(req, AUDIT.ROLE_DELETED, { entity: { type: 'role', id: req.params.id, label: before?.name }, oldValue: { name: before?.name } });
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
      await audit(req, AUDIT.ROLE_PERMISSION_ADDED, { entity: { type: 'role', id: profileId, label: profileId }, details: { permission: await permissionName(permissionId) } });
      res.json({ success: true, message: 'Permission assignée' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async removePermission(req, res) {
    try {
      const { profileId, permissionId } = req.params;
      await profileModel.removePermission(profileId, permissionId);
      await audit(req, AUDIT.ROLE_PERMISSION_REMOVED, { entity: { type: 'role', id: profileId, label: profileId }, details: { permission: await permissionName(permissionId) } });
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