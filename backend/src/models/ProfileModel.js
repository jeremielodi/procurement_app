// backend/src/models/ProfileModel.js
const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class ProfileModel {
  async create(data) {
    const { name, description } = data;
    const id = `prof_${name.toLowerCase().replace(/\s/g, '_')}`;
    
    await db.insert('profiles', {
      id,
      name,
      description,
      created_at: new Date()
    });
    
    return { success: true, id, name };
  }

  async findAll() {
    const profiles = await db.select(`
      SELECT p.*, 
             COUNT(DISTINCT up.user_id) as user_count,
             COUNT(DISTINCT pp.permission_id) as permission_count
      FROM profiles p
      LEFT JOIN user_profiles up ON p.id = up.profile_id
      LEFT JOIN profile_permissions pp ON p.id = pp.profile_id
      GROUP BY p.id
      ORDER BY p.name
    `);
    
    return profiles;
  }

  async findById(id) {
    const profile = await db.one(`
      SELECT p.*, 
             COUNT(DISTINCT up.user_id) as user_count,
             COUNT(DISTINCT pp.permission_id) as permission_count
      FROM profiles p
      LEFT JOIN user_profiles up ON p.id = up.profile_id
      LEFT JOIN profile_permissions pp ON p.id = pp.profile_id
      WHERE p.id = $1
      GROUP BY p.id
    `, [id]);
    
    if (!profile) return null;
    
    const permissions = await db.select(`
      SELECT p.*
      FROM permissions p
      JOIN profile_permissions pp ON p.id = pp.permission_id
      WHERE pp.profile_id = $1
      ORDER BY p.name
    `, [id]);
    
    const users = await db.select(`
      SELECT u.id, u.username, u.email, u.first_name, u.last_name
      FROM users u
      JOIN user_profiles up ON u.id = up.user_id
      WHERE up.profile_id = $1
    `, [id]);
    
    return { ...profile, permissions, users };
  }

  async update(id, data) {
    const { name, description } = data;
    
    await db.update('profiles', {
      name,
      description
    }, 'id', id);
    
    return { success: true };
  }

  async delete(id) {
    // Vérifier si le profil est utilisé
    const userCount = await db.one(
      'SELECT COUNT(*) as count FROM user_profiles WHERE profile_id = $1',
      [id]
    );
    
    if (parseInt(userCount.count) > 0) {
      throw new Error('Ce profil est utilisé par des utilisateurs');
    }
    
    await db.delete('profiles', 'id', id);
    return { success: true };
  }

  async getPermissions() {
    return await db.select('SELECT * FROM permissions ORDER BY resource, name');
  }

  async assignPermission(profileId, permissionId) {
    await db.insert('profile_permissions', {
      profile_id: profileId,
      permission_id: permissionId
    });
    return { success: true };
  }

  async removePermission(profileId, permissionId) {
    const persmissions = await this.getProfilePermissions(profileId);
    const permission = persmissions.filter(p => p.id == permissionId)[0] || {}

    if(permission.id) {

    }
    await db.delete('profile_permissions', {
      profile_id: profileId,
      permission_id: permissionId
    });
    return { success: true };
  }

  async getProfilePermissions(profileId) {
    return await db.select(`
      SELECT p.*
      FROM permissions p
      JOIN profile_permissions pp ON p.id = pp.permission_id
      WHERE pp.profile_id = $1
      ORDER BY p.resource, p.name
    `, [profileId]);
  }
}

module.exports = new ProfileModel();