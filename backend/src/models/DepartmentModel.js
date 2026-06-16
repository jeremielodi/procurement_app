// backend/src/models/DepartmentModel.js
const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class DepartmentModel {
  async create(data) {
    const { code, name, description, managerId, createdBy } = data;
    const id = uuidv4();
    
    await db.insert('departments', {
      id,
      code,
      name,
      description,
      manager_id: managerId,
      is_active: true,
      created_by: createdBy,
      created_at: new Date(),
      updated_at: new Date()
    });
    
    return { success: true, id, code, name };
  }

  async findAll(filters = {}) {
    let sql = `
      SELECT d.*, u.first_name as manager_first_name, u.last_name as manager_last_name,
             u.email as manager_email
      FROM departments d
      LEFT JOIN users u ON d.manager_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;
    
    if (filters.is_active !== undefined && filters.is_active !== 'all') {
      sql += ` AND d.is_active = $${paramCount}`;
      params.push(filters.is_active === 'true');
      paramCount++;
    }
    
    if (filters.search) {
      sql += ` AND (d.code ILIKE $${paramCount} OR d.name ILIKE $${paramCount})`;
      params.push(`%${filters.search}%`);
      paramCount++;
    }
    
    sql += ` ORDER BY d.name ASC`;
    
    return await db.select(sql, params);
  }

  async findById(id) {
    const department = await db.one(`
      SELECT d.*, u.first_name as manager_first_name, u.last_name as manager_last_name,
             u.email as manager_email
      FROM departments d
      LEFT JOIN users u ON d.manager_id = u.id
      WHERE d.id = $1
    `, [id]);
    return department;
  }

  async update(id, data) {
    const { name, description, managerId, isActive } = data;
    
    await db.update('departments', {
      name,
      description,
      manager_id: managerId,
      is_active: isActive,
      updated_at: new Date()
    }, 'id', id);
    
    return { success: true };
  }

  async delete(id) {
    return await db.delete('departments', 'id', id);
  }

  async getUsers() {
    return await db.select(`
      SELECT id, username, email, first_name, last_name, department
      FROM users 
      WHERE is_active = true 
      ORDER BY first_name, last_name
    `);
  }
}

module.exports = new DepartmentModel();