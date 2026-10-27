// backend/src/models/ProjectModel.js
const db = require('../config/database');
const tenant = require('../utils/tenant');
const { v4: uuidv4 } = require('uuid');

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

class ProjectModel {
  /**
   * Code de projet normalisé (majuscules, sans espaces autour), unique par entreprise sans tenir compte de la casse.
   * 400 PROJECT_CODE_REQUIRED / PROJECT_CODE_TOO_LONG, 409 PROJECT_CODE_EXISTS. excludeId : projet modifié.
   */
  async checkCode(code, { excludeId = null, enterpriseId = null } = {}) {
    const value = String(code ?? '').trim().toUpperCase();
    if (!value) throw fail(400, 'PROJECT_CODE_REQUIRED', 'Le code du projet est obligatoire');
    if (value.length > 20) throw fail(400, 'PROJECT_CODE_TOO_LONG', 'Code du projet : 20 caractères maximum');
    const params = [value, excludeId];
    let sql = 'SELECT id FROM projects p WHERE UPPER(p.code) = $1 AND ($2::uuid IS NULL OR p.id <> $2::uuid)';
    if (enterpriseId) { params.push(enterpriseId); sql += ` AND p.enterprise_id = $${params.length}`; } else sql += tenant.filter('p.enterprise_id', params);
    if (await db.one(sql, params)) throw fail(409, 'PROJECT_CODE_EXISTS', `Le code ${value} est déjà utilisé par un autre projet`);
    return value;
  }

  async create(data) {
    const { name, description, projectManagerId, startDate, endDate, createdBy } = data;
    const code = await this.checkCode(data.code);
    const id = uuidv4();
    
    await db.insert('projects', {
      id,
      code,
      name,
      description,
      project_manager_id: projectManagerId || null,
      status: 'ACTIVE',
      start_date: startDate,
      end_date: endDate,
      is_active: true,
      created_by: createdBy,
      created_at: new Date(),
      updated_at: new Date()
    });
    
    return { success: true, id, code, name };
  }

  async findAll(filters = {}) {
    let sql = `
      SELECT p.*, 
             u.first_name as manager_first_name, u.last_name as manager_last_name,
             u.email as manager_email
      FROM projects p
      LEFT JOIN users u ON p.project_manager_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;
    // Multi-entreprise : uniquement les données de l'entreprise courante
    sql += tenant.filter('p.enterprise_id', params);
    paramCount = params.length + 1;
    
 
    if (filters.status && filters.status !== 'all') {
      sql += ` AND p.status = $${paramCount}`;
      params.push(filters.status);
      paramCount++;
    }
    
    if (filters.is_active !== undefined && filters.is_active !== 'all') {
      sql += ` AND p.is_active = $${paramCount}`;
      params.push(filters.is_active === 'true');
      paramCount++;
    }
    
    // Formulaire de réquisition : projets où l'utilisateur peut créer une réquisition (profils BPMN liés au projet)
    if (['1', 'true', true].includes(filters.forRequisition) && filters.userId) {
      sql += ` AND user_has_project_permission($${paramCount}, p.id, 'CREATE_REQUISITIONS')`;
      params.push(filters.userId);
      paramCount++;
    }

    if (filters.search) {
      sql += ` AND (p.code ILIKE $${paramCount} OR p.name ILIKE $${paramCount})`;
      params.push(`%${filters.search}%`);
      paramCount++;
    }
    
    sql += ` ORDER BY p.name ASC`;
    
    return await db.select(sql, params);
  }

  async findById(id) {
    const project = await db.one(`
      SELECT p.*, 
             u.first_name as manager_first_name, u.last_name as manager_last_name,
             u.email as manager_email
      FROM projects p
      LEFT JOIN users u ON p.project_manager_id = u.id
      WHERE p.id = $1
    `, [id]);
    
    if (!project) return null;
    
    // Membres du projet et leurs profils de workflow sur ce projet
    const members = await this.getProjectMembers(id);

    return { ...project, members };
  }

  /** code : absent = inchangé ; sinon contrôlé comme à la création (unique dans l'entreprise du projet) */
  async update(id, data) {
    const { name, description, projectManagerId, status, startDate, endDate, isActive } = data;
    let code;
    if (data.code !== undefined) {
      const current = await db.one('SELECT enterprise_id FROM projects WHERE id = $1', [id]);
      if (!current) throw fail(404, 'NOT_FOUND', 'Projet introuvable');
      code = await this.checkCode(data.code, { excludeId: id, enterpriseId: current.enterprise_id });
    }
    
    await db.update('projects', {
      ...(code !== undefined && { code }),
      name,
      description,
      project_manager_id: projectManagerId,
      status,
      start_date: startDate,
      end_date: endDate,
      is_active: isActive,
      updated_at: new Date()
    }, 'id', id);
    
    return { success: true };
  }

  async delete(id) {
    return await db.delete('projects', 'id', id);
  }

  /**
   * Profils de workflow de l'utilisateur (profiles.project_scoped) : ceux qu'on peut lui attribuer sur un projet.
   * all_projects = déjà exercé sur tous les projets (case de la fiche utilisateur)
   */
  async scopedProfilesOf(userId) {
    return db.select(
      `SELECT up.profile_id AS id, p.name, up.all_projects
       FROM user_profiles up JOIN profiles p ON p.id = up.profile_id
       WHERE up.user_id = $1 AND p.project_scoped ORDER BY p.name`,
      [userId]
    );
  }

  /**
   * Ajouter un membre. profileIds : profils de workflow exercés sur ce projet (défaut : tous ses profils de workflow
   * qui ne sont pas déjà « tous les projets »). Membre déjà présent : 409 ALREADY_MEMBER.
   */
  async addMember(projectId, userId, role, assignedBy, profileIds) {
    return db.withTransaction(async (tx) => {
      const existing = await tx.one('SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
      if (existing) throw Object.assign(new Error('Cet utilisateur est déjà membre du projet'), { status: 409, code: 'ALREADY_MEMBER' });
      await tx.exec(
        `INSERT INTO project_members (project_id, user_id, role, assigned_at, assigned_by) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)`,
        [projectId, userId, role || 'MEMBER', assignedBy]
      );
      const available = await tx.select(
        `SELECT up.profile_id, up.all_projects FROM user_profiles up JOIN profiles p ON p.id = up.profile_id
         WHERE up.user_id = $1 AND p.project_scoped`,
        [userId]
      );
      const wanted = Array.isArray(profileIds)
        ? available.filter(a => profileIds.includes(a.profile_id))
        : available.filter(a => !a.all_projects);
      for (const a of wanted) {
        await tx.exec(
          `INSERT INTO project_member_profiles (project_id, user_id, profile_id, assigned_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [projectId, userId, a.profile_id, assignedBy]
        );
      }
      return { success: true, profileIds: wanted.map(a => a.profile_id) };
    });
  }

  async removeMember(projectId, userId) {
    // project_member_profiles : supprimés en cascade
    await db.delete('project_members', { project_id: projectId, user_id: userId });
    return { success: true };
  }

  /**
   * Profils de workflow d'un membre sur ce projet (remplace l'attribution). Seuls ses profils globaux de workflow
   * sont acceptés (400 INVALID_PROFILE). → { before, after }
   */
  async setMemberProfiles(projectId, userId, profileIds, assignedBy) {
    return db.withTransaction(async (tx) => {
      const member = await tx.one('SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
      if (!member) throw Object.assign(new Error("Cet utilisateur n'est pas membre du projet"), { status: 404, code: 'NOT_MEMBER' });
      const available = (await tx.select(
        `SELECT up.profile_id FROM user_profiles up JOIN profiles p ON p.id = up.profile_id WHERE up.user_id = $1 AND p.project_scoped`,
        [userId]
      )).map(r => r.profile_id);
      const wanted = [...new Set((profileIds || []).map(String))];
      const invalid = wanted.filter(p => !available.includes(p));
      if (invalid.length) {
        throw Object.assign(new Error("Profil non détenu par l'utilisateur (à ajouter d'abord sur sa fiche)"), { status: 400, code: 'INVALID_PROFILE', details: { invalid } });
      }
      const before = (await tx.select(
        'SELECT profile_id FROM project_member_profiles WHERE project_id = $1 AND user_id = $2 ORDER BY profile_id', [projectId, userId]
      )).map(r => r.profile_id);
      await tx.exec('DELETE FROM project_member_profiles WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
      for (const profileId of wanted) {
        await tx.exec(
          'INSERT INTO project_member_profiles (project_id, user_id, profile_id, assigned_by) VALUES ($1, $2, $3, $4)',
          [projectId, userId, profileId, assignedBy]
        );
      }
      return { before, after: wanted.sort() };
    });
  }

  /** Membres + leurs profils de workflow : { id, name, allProjects, assigned } (assigned = exercé sur ce projet) */
  async getProjectMembers(projectId) {
    const [members, profiles] = await Promise.all([
      db.select(`
        SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.is_active, u.avatar_updated_at, pm.role
        FROM project_members pm
        JOIN users u ON pm.user_id = u.id
        WHERE pm.project_id = $1
        ORDER BY u.first_name, u.last_name
      `, [projectId]),
      db.select(`
        SELECT pm.user_id, up.profile_id, p.name, up.all_projects,
               EXISTS (SELECT 1 FROM project_member_profiles pmp
                       WHERE pmp.project_id = pm.project_id AND pmp.user_id = pm.user_id AND pmp.profile_id = up.profile_id) AS assigned
        FROM project_members pm
        JOIN user_profiles up ON up.user_id = pm.user_id
        JOIN profiles p ON p.id = up.profile_id AND p.project_scoped
        WHERE pm.project_id = $1
        ORDER BY p.name
      `, [projectId]),
    ]);
    const byUser = new Map();
    for (const p of profiles) {
      if (!byUser.has(p.user_id)) byUser.set(p.user_id, []);
      byUser.get(p.user_id).push({ id: p.profile_id, name: p.name, allProjects: p.all_projects, assigned: p.assigned });
    }
    return members.map(m => ({ ...m, profiles: byUser.get(m.id) || [] }));
  }

  async getAvailableUsers() {
    const p = [];
    return await db.select(`
      SELECT id, username, email, first_name, last_name, department
      FROM users 
      WHERE is_active = true ${tenant.filter('enterprise_id', p)}
      ORDER BY first_name, last_name
    `, p);
  }
}

module.exports = new ProjectModel();