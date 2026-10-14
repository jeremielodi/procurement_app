// backend/src/controllers/ProjectController.js
const projectModel = require('../models/ProjectModel');
const db = require('../config/database');
const { audit, AUDIT } = require('../utils/auditLog');
const approvalPolicy = require('../utils/approvalPolicy');

const sendError = (res, error) => (error.status
  ? res.status(error.status).json({ success: false, code: error.code, message: error.message, details: error.details })
  : res.status(500).json({ success: false, message: error.message }));

/**
 * Seuils d'approbation envoyés avec le projet (approvalN1Max / approvalN2Max, vides = politique de l'entreprise) :
 * enregistrés et tracés s'ils changent. Absents de la requête : inchangés.
 */
async function saveApprovalPolicy(req, projectId) {
  if (!('approvalN1Max' in (req.body || {})) && !('approvalN2Max' in (req.body || {}))) return;
  const policy = approvalPolicy.parsePolicy(req.body.approvalN1Max, req.body.approvalN2Max);
  const before = await db.one('SELECT code, name, approval_n1_max, approval_n2_max FROM projects WHERE id = $1', [projectId]);
  const old = { n1Max: before?.approval_n1_max != null ? Number(before.approval_n1_max) : null, n2Max: before?.approval_n2_max != null ? Number(before.approval_n2_max) : null };
  if (old.n1Max === policy.n1Max && old.n2Max === policy.n2Max) return;
  await db.exec('UPDATE projects SET approval_n1_max = $2, approval_n2_max = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [projectId, policy.n1Max, policy.n2Max]);
  await audit(req, AUDIT.APPROVAL_POLICY_CHANGED, {
    entity: { type: 'project', id: projectId, label: before ? `${before.code} — ${before.name}` : null },
    oldValue: old, details: policy,
  });
}

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
      // Politique d'approbation effective (projet, sinon entreprise, sinon défaut)
      res.json({ success: true, data: { ...project, effective_approval_policy: await approvalPolicy.projectPolicy(project.id, project.enterprise_id) } });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async create(req, res) {
    try {
      const { code, name, description, projectManagerId, startDate, endDate } = req.body;
      const createdBy = req.user.id;
      
      // Seuils contrôlés avant la création (400 APPROVAL_POLICY_INVALID)
      if ('approvalN1Max' in req.body || 'approvalN2Max' in req.body) approvalPolicy.parsePolicy(req.body.approvalN1Max, req.body.approvalN2Max);
      const result = await projectModel.create({
        code, name, description, projectManagerId, startDate, endDate, createdBy
      });
      await saveApprovalPolicy(req, result.id);

      res.status(201).json({ success: true, data: result });
    } catch (error) {
      sendError(res, error);
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      const { name, description, projectManagerId, status, startDate, endDate, isActive } = req.body;
      
      if ('approvalN1Max' in req.body || 'approvalN2Max' in req.body) approvalPolicy.parsePolicy(req.body.approvalN1Max, req.body.approvalN2Max);
      await projectModel.update(id, { name, description, projectManagerId, status, startDate, endDate, isActive });
      await saveApprovalPolicy(req, id);
      res.json({ success: true, message: 'Projet mis à jour' });
    } catch (error) {
      sendError(res, error);
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

  /** GET /projects/:id/approval-policy — politique effective (formulaire de réquisition : niveau prévu) */
  async getApprovalPolicy(req, res) {
    try {
      const project = await db.one('SELECT id, enterprise_id FROM projects WHERE id = $1', [req.params.id]);
      if (!project) return res.status(404).json({ success: false, message: 'Projet non trouvé' });
      res.json({ success: true, data: await approvalPolicy.projectPolicy(project.id, project.enterprise_id) });
    } catch (error) {
      sendError(res, error);
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