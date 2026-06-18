// backend/src/models/UserModel.js
const db = require('../config/database');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

class UserModel {
  /**
   * Créer un nouvel utilisateur
   */
  async create(userData) {
    const { username, email, password, firstName, lastName, department, position, enterpriseId, profileIds = [] } = userData;
    
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
             u.department, u.position, u.is_active,
             u.enterprise_id,
             u.last_login, u.created_at,
             array_agg(DISTINCT p.id) as profile_ids,
             array_agg(DISTINCT p.name) as profile_names
      FROM users u
      LEFT JOIN user_profiles up ON u.id = up.user_id
      LEFT JOIN profiles p ON up.profile_id = p.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;
    
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
          u.is_active, 
          u.last_login,
          u.created_at
       FROM users u
       WHERE u.id = $1`,
      [id]
    );
    
    if (!user) return null;
    
    const profiles = await db.select(`
      SELECT p.id, p.name, p.description
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
          u.enterprise_id,
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
      lastLogin: user.last_login,
      createdAt: user.created_at,
      profiles
    };
  }

  /**
   * Mettre à jour un utilisateur
   */
  async update(id, userData) {
    const { firstName, lastName, department, position, profileIds = [] } = userData;
    
    const transaction = db.transaction();
    
    transaction.addUpdateQuery('users', {
      first_name: firstName,
      last_name: lastName,
      department,
      position,
      updated_at: new Date()
    }, 'id', id);
    
    await transaction.execute();
    
    // Mettre à jour les profils
    await db.delete('user_profiles', 'user_id', id);
    
    if (profileIds.length > 0) {
      const profileTransaction = db.transaction();
      for (const profileId of profileIds) {
        profileTransaction.addInsertQuery('user_profiles', {
          user_id: id,
          profile_id: profileId,
          assigned_at: new Date(),
          assigned_by: id
        });
      }
      await profileTransaction.execute();
    }
    
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
   * Mettre à jour la dernière connexion
   */
  async updateLastLogin(id) {
    return await db.update('users', { 
      last_login: new Date(),
      updated_at: new Date()
    }, 'id', id);
  }

  /**
   * Authentifier un utilisateur
   */
  async authenticate(email, password) {
    const user = await db.one(
      `SELECT id, username, email, password_hash, first_name, last_name, 
              department, position, is_active 
       FROM users WHERE email = $1 AND is_active = true`,
      [email]
    );
    
    if (!user) {
      return { success: false, message: 'Utilisateur non trouvé' };
    }
    
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!isValidPassword) {
      return { success: false, message: 'Mot de passe incorrect' };
    }
    
    await this.updateLastLogin(user.id);
    
    const profiles = await this.getUserProfiles(user.id);
    const permissions = await this.getUserPermissions(user.id);
    
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
        isActive: user.is_active,
        profiles,
        permissions
      }
    };
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





  // backend/src/models/UserModel.js (extrait authenticate)
async authenticate(email, password) {
  const user = await db.one(
    `SELECT id, username, email, password_hash, first_name, last_name, 
            department, position, is_active, enterprise_id
     FROM users WHERE email = $1 AND is_active = true`,
    [email]
  );
  
  if (!user) {
    return { success: false, message: 'Utilisateur non trouvé' };
  }
  
  const isValidPassword = await bcrypt.compare(password, user.password_hash);
  
  if (!isValidPassword) {
    return { success: false, message: 'Mot de passe incorrect' };
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
      isActive: user.is_active,
      profiles,
      permissions
    }
  };
}
}

module.exports = new UserModel();