// backend/src/models/UserModel.js
const db = require('../config/database');
const tenant = require('../utils/tenant');
const bcrypt = require('bcrypt');
// Empreinte fictive (mot de passe aléatoire) : un email inconnu coûte une comparaison bcrypt comme un vrai compte
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(require('crypto').randomBytes(24).toString('hex'), 10);
const { v4: uuidv4 } = require('uuid');
const i18n = require('../i18n');

class UserModel {
  /**
   * Créer un nouvel utilisateur
   */
  async create(userData) {
    const { username, email, password, firstName, lastName, department, position, enterpriseId, language, profileIds = [], allProjectsProfileIds = [] } = userData;
    
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    const userId = uuidv4();
    
    const transaction = db.transaction();
    
    try {
      transaction.addInsertQuery('users', {
        id: userId,
        username,
        email,
        password_hash: passwordHash,
        first_name: firstName,
        last_name: lastName,
        department,
        position,
        // Langue de l'interface et des emails (code d'un fichier de langue, 'fr' par défaut)
        language: i18n.normalizeLang(language),
        is_active: true,
        enterprise_id: enterpriseId,
        created_at: new Date(),
        updated_at: new Date()
      });
      
      await transaction.execute();
      
      if (profileIds.length > 0) {
        const profileTransaction = db.transaction();
        for (const profileId of profileIds) {
          profileTransaction.addInsertQuery('user_profiles', {
            user_id: userId,
            profile_id: profileId,
            // Profil de workflow exercé sur tous les projets (sinon : projets où il est attribué au membre)
            all_projects: allProjectsProfileIds.includes(profileId),
            assigned_at: new Date(),
            assigned_by: userId
          });
        }
        await profileTransaction.execute();
      }
      
      return {
        success: true,
        id: userId,
        username,
        email
      };
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }

  /**
   * Récupérer tous les utilisateurs
   */
  async findAll(filters = {}) {
    let sql = `
      SELECT u.id, u.username, u.email, u.first_name, u.last_name, 
             u.department, u.position, u.is_active, u.language,
             u.enterprise_id,
             u.last_login, u.created_at,
             array_agg(DISTINCT p.id) as profile_ids,
             array_agg(DISTINCT p.name) as profile_names,
             COALESCE(array_agg(DISTINCT p.id) FILTER (WHERE up.all_projects), '{}') as all_projects_profile_ids
      FROM users u
      LEFT JOIN user_profiles up ON u.id = up.user_id
      LEFT JOIN profiles p ON up.profile_id = p.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;
    // Multi-entreprise : uniquement les données de l'entreprise courante
    sql += tenant.filter('u.enterprise_id', params);
    paramCount = params.length + 1;
    
    if (filters.search) {
      sql += ` AND (u.username ILIKE $${paramCount} OR u.email ILIKE $${paramCount} OR u.first_name ILIKE $${paramCount} OR u.last_name ILIKE $${paramCount})`;
      params.push(`%${filters.search}%`);
      paramCount++;
    }
    
    if (filters.is_active !== undefined && filters.is_active !== 'all') {
      sql += ` AND u.is_active = $${paramCount}`;
      params.push(filters.is_active === 'true');
      paramCount++;
    }
    
    if (filters.department && filters.department !== 'all') {
      sql += ` AND u.department = $${paramCount}`;
      params.push(filters.department);
      paramCount++;
    }

     if (filters.profileId) {
      sql += ` AND ( p.id =$${paramCount} OR p.id=$${paramCount+1}   )`;
      params.push(filters.profileId);
      params.push(`prof_${filters.profileId}`);
      paramCount = params.length + 1;
    }
    
    sql += ` GROUP BY u.id ORDER BY u.created_at DESC`;
    
    if (filters.limit) {
      sql += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
      params.push(filters.limit, filters.offset || 0);
    }
    
    return await db.select(sql, params);
  }

  /**
   * Compter les utilisateurs
   */
  async count(filters = {}) {
    let sql = `SELECT COUNT(*) as count FROM users WHERE 1=1`;
    const params = [];
    let paramCount = 1;
    // Multi-entreprise : uniquement les données de l'entreprise courante
    sql += tenant.filter('enterprise_id', params);
    paramCount = params.length + 1;
    
    if (filters.search) {
      sql += ` AND (username ILIKE $${paramCount} OR email ILIKE $${paramCount})`;
      params.push(`%${filters.search}%`);
      paramCount++;
    }
    
    if (filters.is_active !== undefined && filters.is_active !== 'all') {
      sql += ` AND is_active = $${paramCount}`;
      params.push(filters.is_active === 'true');
      paramCount++;
    }
    
    const result = await db.one(sql, params);
    return parseInt(result.count);
  }

  /**
   * Récupérer un utilisateur par ID
   */
  async findById(id) {
    const user = await db.one(
      `SELECT u.id,
          u.username,
          u.email,
          u.first_name, 
          u.last_name, 
          u.department, 
          u.position, 
          u.enterprise_id,
          u.language,
          u.is_active, 
          u.last_login,
          u.created_at
       FROM users u
       WHERE u.id = $1`,
      [id]
    );
    
    if (!user) return null;
    
    const profiles = await db.select(`
      SELECT p.id, p.name, p.description, p.project_scoped, up.all_projects
      FROM user_profiles up
      JOIN profiles p ON up.profile_id = p.id
      WHERE up.user_id = $1
    `, [id]);
    
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      department: user.department,
      position: user.position,
      enterpriseId: user.enterprise_id,
      language: user.language,
      isActive: user.is_active,
      lastLogin: user.last_login,
      createdAt: user.created_at,
      profiles
    };
  }

  /**
   * Récupérer un utilisateur par email
   */
  async findByEmail(email) {
    const user = await db.one(
      `SELECT u.id, u.username, u.email,
          u.first_name, u.last_name, 
          u.department, u.position,
          u.enterprise_id, u.language,
          u.is_active, u.last_login,
          u.created_at
       FROM users u
       WHERE u.email = $1`,
      [email]
    );
    
    if (!user) return null;
    
    const profiles = await db.select(`
      SELECT p.id, p.name, p.description
      FROM user_profiles up
      JOIN profiles p ON up.profile_id = p.id
      WHERE up.user_id = $1
    `, [user.id]);
    
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      department: user.department,
      position: user.position,
      isActive: user.is_active,
      enterpriseId: user.enterprise_id,
      lastLogin: user.last_login,
      createdAt: user.created_at,
      profiles
    };
  }

  /**
   * Mettre à jour un utilisateur
   */
  async update(id, userData) {
    const { firstName, lastName, department, position, language, profileIds = [], allProjectsProfileIds } = userData;
    
    const transaction = db.transaction();
    
    transaction.addUpdateQuery('users', {
      first_name: firstName,
      last_name: lastName,
      department,
      position,
      ...(language ? { language: i18n.normalizeLang(language) } : {}),
      updated_at: new Date()
    }, 'id', id);
    
    await transaction.execute();
    
    // Mettre à jour les profils — « Tous les projets » : valeur envoyée, sinon celle d'avant
    const previous = await db.select('SELECT profile_id, all_projects FROM user_profiles WHERE user_id = $1', [id]);
    const everywhere = new Set(Array.isArray(allProjectsProfileIds)
      ? allProjectsProfileIds
      : previous.filter(p => p.all_projects).map(p => p.profile_id));
    await db.delete('user_profiles', 'user_id', id);
    
    if (profileIds.length > 0) {
      const profileTransaction = db.transaction();
      for (const profileId of profileIds) {
        profileTransaction.addInsertQuery('user_profiles', {
          user_id: id,
          profile_id: profileId,
          all_projects: everywhere.has(profileId),
          assigned_at: new Date(),
          assigned_by: id
        });
      }
      await profileTransaction.execute();
    }
    // Profil retiré : retiré aussi de tous les projets
    await db.exec('DELETE FROM project_member_profiles WHERE user_id = $1 AND NOT (profile_id = ANY($2::varchar[]))', [id, profileIds]);
    
    return { success: true };
  }

  /**
   * Bloquer/Débloquer un utilisateur
   */
  async toggleActive(id, isActive) {
    return await db.update('users', { 
      is_active: isActive,
      updated_at: new Date()
    }, 'id', id);
  }

  /**
   * Supprimer un utilisateur
   */
  async delete(id) {
    return await db.delete('users', 'id', id);
  }

  /**
   * Langue préférée (interface + emails)
   */
  async setLanguage(id, language) {
    return await db.update('users', { language: i18n.normalizeLang(language), updated_at: new Date() }, 'id', id);
  }

  /**
   * Mettre à jour la dernière connexion
   */
  async updateLastLogin(id) {
    return await db.update('users', { 
      last_login: new Date(),
      updated_at: new Date()
    }, 'id', id);
  }

  /**
   * Utilisateur actif par email (insensible à la casse) — mot de passe oublié
   */
  async findActiveByEmail(email) {
    return await db.one(
      `SELECT id, email, first_name, last_name, language, password_hash FROM users
       WHERE LOWER(email) = LOWER($1) AND is_active = true`,
      [email]
    );
  }

  /** Utilisateur actif par id, avec le hash du mot de passe (lien de réinitialisation) */
  async findActiveForReset(id) {
    return await db.one(
      `SELECT id, email, first_name, last_name, language, password_hash FROM users
       WHERE id = $1 AND is_active = true`,
      [id]
    );
  }

  /**
   * Réinitialiser le mot de passe
   */
  async resetPassword(id, newPassword) {
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);
    
    return await db.update('users', {
      password_hash: passwordHash,
      updated_at: new Date()
    }, 'id', id);
  }

  /**
   * Changer le mot de passe
   */
  async changePassword(id, oldPassword, newPassword) {
    const user = await db.one('SELECT password_hash FROM users WHERE id = $1', [id]);
    
    const isValid = await bcrypt.compare(oldPassword, user.password_hash);
    if (!isValid) {
      return { success: false, message: 'Mot de passe actuel incorrect' };
    }
    
    const saltRounds = 10;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);
    
    await db.update('users', { password_hash: newPasswordHash }, 'id', id);
    
    return { success: true };
  }

  /**
   * Profils par projet saisis sur la fiche utilisateur : [{ projectId, profileIds }] (profils BPMN liés au projet).
   * Contrôle avant écriture : chaque profil doit être un profil de workflow coché sur la fiche (profileIds),
   * chaque projet cité une seule fois → code d'erreur ou null.
   */
  async checkProjectProfiles(assignments, profileIds) {
    if (!Array.isArray(assignments)) return 'INVALID_PROJECT_PROFILES';
    const scoped = new Set((await db.select('SELECT id FROM profiles WHERE project_scoped')).map(p => p.id));
    const held = new Set((profileIds || []).filter(p => scoped.has(p)));
    const seen = new Set();
    for (const a of assignments) {
      if (!a || !a.projectId || !Array.isArray(a.profileIds) || seen.has(String(a.projectId))) return 'INVALID_PROJECT_PROFILES';
      seen.add(String(a.projectId));
      if (a.profileIds.some(p => !held.has(p))) return 'INVALID_PROFILE';
    }
    const ids = [...seen];
    if (ids.length) {
      const found = await db.select('SELECT id FROM projects WHERE id::text = ANY($1)', [ids]);
      if (found.length !== ids.length) return 'PROJECT_NOT_FOUND';
    }
    return null;
  }

  /**
   * Remplace les projets de l'utilisateur et ses profils sur chacun : projet absent de la liste = membre retiré
   * (ses profils avec), nouveau projet = membre ajouté (rôle MEMBER). → { before, after } pour le journal d'audit
   */
  async setProjectProfiles(userId, assignments, assignedBy) {
    return db.withTransaction(async (tx) => {
      const snapshot = async () => (await tx.select(
        `SELECT pm.project_id::text AS "projectId",
                COALESCE(array_agg(pmp.profile_id ORDER BY pmp.profile_id) FILTER (WHERE pmp.profile_id IS NOT NULL), '{}') AS "profileIds"
         FROM project_members pm
         LEFT JOIN project_member_profiles pmp ON pmp.project_id = pm.project_id AND pmp.user_id = pm.user_id
         WHERE pm.user_id = $1 GROUP BY pm.project_id ORDER BY pm.project_id`,
        [userId]
      ));
      const before = await snapshot();
      const wanted = assignments.map(a => String(a.projectId));
      await tx.exec('DELETE FROM project_members WHERE user_id = $1 AND NOT (project_id::text = ANY($2))', [userId, wanted]);
      await tx.exec('DELETE FROM project_member_profiles WHERE user_id = $1', [userId]);
      for (const a of assignments) {
        await tx.exec(
          `INSERT INTO project_members (project_id, user_id, role, assigned_at, assigned_by)
           VALUES ($1, $2, 'MEMBER', CURRENT_TIMESTAMP, $3) ON CONFLICT (project_id, user_id) DO NOTHING`,
          [a.projectId, userId, assignedBy]
        );
        for (const profileId of [...new Set(a.profileIds)]) {
          await tx.exec(
            'INSERT INTO project_member_profiles (project_id, user_id, profile_id, assigned_by) VALUES ($1, $2, $3, $4)',
            [a.projectId, userId, profileId, assignedBy]
          );
        }
      }
      return { before, after: await snapshot() };
    });
  }

  /** Projets dont l'utilisateur est membre, avec ses profils de workflow exercés sur chacun (fiche utilisateur) */
  async getProjectAssignments(userId) {
    return db.select(
      `SELECT p.id, p.code, p.name, pm.role,
              COALESCE(array_agg(pmp.profile_id ORDER BY pmp.profile_id) FILTER (WHERE pmp.profile_id IS NOT NULL), '{}') AS profile_ids
       FROM project_members pm
       JOIN projects p ON p.id = pm.project_id
       LEFT JOIN project_member_profiles pmp ON pmp.project_id = pm.project_id AND pmp.user_id = pm.user_id
       WHERE pm.user_id = $1
       GROUP BY p.id, p.code, p.name, pm.role
       ORDER BY p.code`,
      [userId]
    );
  }

  /**
   * Récupérer les profils d'un utilisateur
   */
  async getUserProfiles(userId) {
    return await db.select(`
      SELECT p.id, p.name, p.description
      FROM user_profiles up
      JOIN profiles p ON up.profile_id = p.id
      WHERE up.user_id = $1
    `, [userId]);
  }

  /**
   * Vérifier si un utilisateur a une permission spécifique (via ses profils)
   */
  async hasPermission(userId, permissionName) {
    try {
      // Vérifier si l'utilisateur a le profil admin (qui a toutes les permissions)
      const adminCheck = await db.one(`
        SELECT COUNT(*) as count
        FROM user_profiles up
        WHERE up.user_id = $1 AND up.profile_id = 'prof_admin'
      `, [userId]);
      
      if (parseInt(adminCheck.count) > 0) {
        return true;
      }
      
      // Vérifier la permission via les profils
      const result = await db.one(`
        SELECT COUNT(*) as count
        FROM user_profiles up
        JOIN profile_permissions pp ON up.profile_id = pp.profile_id
        JOIN permissions p ON pp.permission_id = p.id
        WHERE up.user_id = $1 AND p.name = $2
      `, [userId, permissionName]);
      
      return parseInt(result.count) > 0;
    } catch (error) {
      console.error('Error checking permission:', error);
      return false;
    }
  }

  /**
   * Vérifier si un utilisateur a plusieurs permissions
   */
  async hasAllPermissions(userId, permissionNames) {
    for (const perm of permissionNames) {
      if (!(await this.hasPermission(userId, perm))) {
        return false;
      }
    }
    return true;
  }

  /**
   * Vérifier si un utilisateur a au moins une permission
   */
  async hasAnyPermission(userId, permissionNames) {
    for (const perm of permissionNames) {
      if (await this.hasPermission(userId, perm)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Récupérer toutes les permissions d'un utilisateur
   */
  async getUserPermissions(userId) {
    try {
      // Vérifier si l'utilisateur a le profil admin
      const adminCheck = await db.one(`
        SELECT COUNT(*) as count
        FROM user_profiles up
        WHERE up.user_id = $1 AND up.profile_id = 'prof_admin'
      `, [userId]);
      
      if (parseInt(adminCheck.count) > 0) {
        // Admin a toutes les permissions
        const allPermissions = await db.select('SELECT name FROM permissions');
        return allPermissions.map(p => p.name);
      }
      
      // Récupérer les permissions via les profils
      const permissions = await db.select(`
        SELECT DISTINCT p.name
        FROM user_profiles up
        JOIN profile_permissions pp ON up.profile_id = pp.profile_id
        JOIN permissions p ON pp.permission_id = p.id
        WHERE up.user_id = $1
      `, [userId]);
      
      return permissions.map(p => p.name);
    } catch (error) {
      console.error('Error getting user permissions:', error);
      return [];
    }
  }

  /**
   * Obtenir tous les profils disponibles
   */
  async getAllProfiles() {
    return await db.select('SELECT * FROM profiles ORDER BY name');
  }

  /**
   * Obtenir un profil par son ID
   */
  async getProfileById(profileId) {
    return await db.one('SELECT * FROM profiles WHERE id = $1', [profileId]);
  }

  /**
   * Vérifier si l'utilisateur est admin
   */
  async isAdmin(userId) {
    const result = await db.one(`
      SELECT COUNT(*) as count
      FROM user_profiles up
      WHERE up.user_id = $1 AND up.profile_id = 'prof_admin'
    `, [userId]);
    
    return parseInt(result.count) > 0;
  }





  /**
   * Authentifier un utilisateur.
   * Échec : message UNIQUE et même durée de traitement (comparaison bcrypt fictive si le compte n'existe pas),
   * pour ne pas révéler quels emails ont un compte (le motif précis est seulement écrit dans le journal d'audit).
   */
async authenticate(email, password) {
  const user = await db.one(
    `SELECT id, username, email, password_hash, first_name, last_name,
            department, position, is_active, enterprise_id, language
     FROM users WHERE email = $1 AND is_active = true`,
    [email]
  );

  const isValidPassword = await bcrypt.compare(String(password), user ? user.password_hash : DUMMY_PASSWORD_HASH);

  if (!user || !isValidPassword) {
    return { success: false, message: 'Email ou mot de passe incorrect' };
  }
  
  await this.updateLastLogin(user.id);
  
  const profiles = await this.getUserProfiles(user.id);
  const permissions = await this.getUserPermissions(user.id);
  
  // Retourner l'utilisateur SANS token (le token est généré par AuthController)
  return {
    success: true,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      department: user.department,
      position: user.position,
      language: user.language,
      isActive: user.is_active,
      enterpriseId: user.enterprise_id,
      profiles,
      permissions
    }
  };
}
}

module.exports = new UserModel();