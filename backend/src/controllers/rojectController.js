// backend/src/controllers/ProjectController.js
const projectModel = require('../models/ProjectModel');

class ProjectController {
  async list(req, res) {
    try {
      const projects = await projectModel.findAll(req.query);
      res.json({ success: true, data: projects });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getOne(req, res) {
    try {
      const project = await projectModel.findById(req.params.id);
      if (!project) {
        return res.status(404).json({ success: false, message: 'Projet non trouvé' });
      }
      res.json({ success: true, data: project });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async create(req, res) {
    try {
      const { code, name, description, departmentId, projectManagerId, startDate, endDate } = req.body;
      const createdBy = req.user.id;
      
      const result = await projectModel.create({
        code, name, description, departmentId, projectManagerId, startDate, endDate, createdBy
      });
      
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      const { name, description, departmentId, projectManagerId, status, startDate, endDate, isActive } = req.body;
      
      await projectModel.update(id, { name, description, departmentId, projectManagerId, status, startDate, endDate, isActive });
      res.json({ success: true, message: 'Projet mis à jour' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async delete(req, res) {
    try {
      await projectModel.delete(req.params.id);
      res.json({ success: true, message: 'Projet supprimé' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async addMember(req, res) {
    try {
      const { projectId, userId, role } = req.body;
      const assignedBy = req.user.id;
      
      await projectModel.addMember(projectId, userId, role, assignedBy);
      res.json({ success: true, message: 'Membre ajouté' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async removeMember(req, res) {
    try {
      const { projectId, userId } = req.params;
      await projectModel.removeMember(projectId, userId);
      res.json({ success: true, message: 'Membre retiré' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getMembers(req, res) {
    try {
      const members = await projectModel.getProjectMembers(req.params.projectId);
      res.json({ success: true, data: members });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getAvailableUsers(req, res) {
    try {
      const users = await projectModel.getAvailableUsers();
      res.json({ success: true, data: users });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new ProjectController();