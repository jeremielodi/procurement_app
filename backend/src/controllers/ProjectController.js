// backend/src/controllers/ProjectController.js
const projectModel = require('../models/ProjectModel');
const db = require('../config/database');
const { audit, AUDIT } = require('../utils/auditLog');

const sendError = (res, error) => (error.status
  ? res.status(error.status).json({ success: false, code: error.code, message: error.message, details: error.details })
  : res.status(500).json({ success: false, message: error.message }));

/** Libellés pour le journal d'audit : « CODE — Nom » du projet, email du membre */
async function auditLabels(projectId, userId) {
  const [project, user] = await Promise.all([
    db.one('SELECT code, name FROM projects WHERE id = $1', [projectId]),
    db.one('SELECT email FROM users WHERE id = $1', [userId]),
  ]);
  return { label: project ? `${project.code} — ${project.name}` : null, email: user?.email || null };
}

class ProjectController {
  async list(req, res) {
    try {
      const projects = await projectModel.findAll({ ...req.query, userId: req.user.id });
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
      const { code, name, description, projectManagerId, startDate, endDate } = req.body;
      const createdBy = req.user.id;
      
      const result = await projectModel.create({
        code, name, description, projectManagerId, startDate, endDate, createdBy
      });
      
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      const { name, description, projectManagerId, status, startDate, endDate, isActive } = req.body;
      
      await projectModel.update(id, { name, description, projectManagerId, status, startDate, endDate, isActive });
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

  /** POST /projects/members { projectId, userId, role, profileIds? } — profils de workflow exercés sur ce projet */
  async addMember(req, res) {
    try {
      const { projectId, userId, role, profileIds } = req.body;
      if (!projectId || !userId) return res.status(400).json({ success: false, message: 'projectId et userId sont requis' });
      const result = await projectModel.addMember(projectId, userId, role, req.user.id, profileIds);
      const { label, email } = await auditLabels(projectId, userId);
      await audit(req, AUDIT.PROJECT_MEMBER_ADDED, {
        entity: { type: 'project', id: projectId, label },
        details: { userId, email, role: role || 'MEMBER', profileIds: result.profileIds },
      });
      res.json({ success: true, message: 'Membre ajouté', data: result });
    } catch (error) {
      sendError(res, error);
    }
  }

  async removeMember(req, res) {
    try {
      const { projectId, userId } = req.params;
      const { label, email } = await auditLabels(projectId, userId);
      await projectModel.removeMember(projectId, userId);
      await audit(req, AUDIT.PROJECT_MEMBER_REMOVED, { entity: { type: 'project', id: projectId, label }, details: { userId, email } });
      res.json({ success: true, message: 'Membre retiré' });
    } catch (error) {
      sendError(res, error);
    }
  }

  /** PUT /projects/:projectId/members/:userId/profiles { profileIds } — profils de workflow du membre sur ce projet */
  async setMemberProfiles(req, res) {
    try {
      const { projectId, userId } = req.params;
      if (!Array.isArray(req.body?.profileIds)) return res.status(400).json({ success: false, message: 'profileIds (tableau) est requis' });
      const { before, after } = await projectModel.setMemberProfiles(projectId, userId, req.body.profileIds, req.user.id);
      const { label, email } = await auditLabels(projectId, userId);
      await audit(req, AUDIT.PROJECT_MEMBER_PROFILES_CHANGED, {
        entity: { type: 'project', id: projectId, label },
        oldValue: { userId, email, profileIds: before },
        details: { userId, email, profileIds: after },
      });
      res.json({ success: true, message: 'Profils du membre mis à jour', data: { profileIds: after } });
    } catch (error) {
      sendError(res, error);
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