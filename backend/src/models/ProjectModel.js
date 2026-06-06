// backend/src/models/ProjectModel.js
const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class ProjectModel {
  async create(data) {
    const { code, name, description, projectManagerId, startDate, endDate, createdBy } = data;
    const id = uuidv4();
    
    await db.insert('projects', {
      id,
      code,
      name,
      description,
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
    
    // Récupérer les membres du projet
    const members = await db.select(`
      SELECT pm.*, u.first_name, u.last_name, u.email, u.username
      FROM project_members pm
      JOIN users u ON pm.user_id = u.id
      WHERE pm.project_id = $1
    `, [id]);
    
    return { ...project, members };
  }

  async update(id, data) {
    const { name, description, projectManagerId, status, startDate, endDate, isActive } = data;
    
    await db.update('projects', {
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

  async addMember(projectId, userId, role, assignedBy) {
    await db.insert('project_members', {
      project_id: projectId,
      user_id: userId,
      role,
      assigned_at: new Date(),
      assigned_by: assignedBy
    });
    
    return { success: true };
  }

  async removeMember(projectId, userId) {
    await db.delete('project_members', { project_id: projectId, user_id: userId });
    return { success: true };
  }

  async getProjectMembers(projectId) {
    return await db.select(`
      SELECT u.id, u.username, u.email, u.first_name, u.last_name, pm.role
      FROM project_members pm
      JOIN users u ON pm.user_id = u.id
      WHERE pm.project_id = $1
    `, [projectId]);
  }

  async getAvailableUsers() {
    return await db.select(`
      SELECT id, username, email, first_name, last_name, department
      FROM users 
      WHERE is_active = true 
      ORDER BY first_name, last_name
    `);
  }
}

module.exports = new ProjectModel();