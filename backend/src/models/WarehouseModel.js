// backend/src/models/WarehouseModel.js
// Dépôts (magasins) d'une entreprise, rattachés à une localisation de la plateforme, et accès des utilisateurs.
// Un admin d'entreprise accède à tous les dépôts actifs de son entreprise ; les autres utilisateurs
// uniquement aux dépôts qui leur ont été accordés (warehouse_users).
const db = require('../config/database');
const tenant = require('../utils/tenant');

const SELECT = `
  SELECT w.*, l.name AS location_name, l.code AS location_code, l.province AS location_province,
         (SELECT COUNT(*) FROM warehouse_users wu WHERE wu.warehouse_id = w.id)::int AS user_count,
         (SELECT COUNT(*) FROM stock_balances b WHERE b.warehouse_id = w.id AND b.quantity > 0)::int AS stocked_lines
  FROM warehouses w
  JOIN locations l ON l.id = w.location_id`;

class WarehouseModel {
  async list({ activeOnly = false, locationId, search } = {}) {
    const params = [];
    let sql = `${SELECT} WHERE 1=1${tenant.filter('w.enterprise_id', params)}`;
    if (activeOnly) sql += ' AND w.is_active';
    if (locationId) { params.push(locationId); sql += ` AND w.location_id = $${params.length}`; }
    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (w.name ILIKE $${params.length} OR w.code ILIKE $${params.length} OR l.name ILIKE $${params.length})`;
    }
    return db.select(`${sql} ORDER BY l.name, w.name`, params);
  }

  async getById(id) {
    return db.one(`${SELECT} WHERE w.id = $1`, [id]);
  }

  async findByCode(enterpriseId, code, exceptId = null) {
    return db.one(
      `SELECT id FROM warehouses WHERE enterprise_id = $1 AND UPPER(code) = UPPER($2) AND ($3::uuid IS NULL OR id <> $3)`,
      [enterpriseId, code, exceptId]
    );
  }

  async create(data) {
    return db.one(
      `INSERT INTO warehouses (enterprise_id, location_id, code, name, address, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [data.enterpriseId, data.locationId, data.code, data.name, data.address || null, data.description || null, data.createdBy]
    );
  }

  async update(id, data) {
    const fields = {};
    for (const [key, col] of [['locationId', 'location_id'], ['code', 'code'], ['name', 'name'], ['address', 'address'], ['description', 'description'], ['isActive', 'is_active']]) {
      if (data[key] !== undefined) fields[col] = data[key];
    }
    if (!Object.keys(fields).length) return;
    await db.update('warehouses', { ...fields, updated_at: new Date() }, 'id', id);
  }

  /** Utilisateurs ayant accès au dépôt */
  async getUsers(warehouseId) {
    return db.select(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.is_active, wu.granted_at,
              ARRAY(SELECT up.profile_id FROM user_profiles up WHERE up.user_id = u.id) AS profile_ids
       FROM warehouse_users wu JOIN users u ON u.id = wu.user_id
       WHERE wu.warehouse_id = $1 ORDER BY u.first_name, u.last_name`,
      [warehouseId]
    );
  }

  /** Remplace la liste des utilisateurs autorisés (utilisateurs de la même entreprise uniquement) */
  async setUsers(warehouseId, enterpriseId, userIds, grantedBy) {
    const ids = [...new Set((userIds || []).map(String))];
    return db.withTransaction(async (tx) => {
      const valid = ids.length
        ? (await tx.select('SELECT id FROM users WHERE enterprise_id = $1 AND id::text = ANY($2::text[])', [enterpriseId, ids])).map(r => r.id)
        : [];
      if (valid.length !== ids.length) {
        const err = new Error('Utilisateur inconnu ou d\'une autre entreprise');
        err.status = 400;
        throw err;
      }
      await tx.exec('DELETE FROM warehouse_users WHERE warehouse_id = $1 AND NOT (user_id::text = ANY($2::text[]))', [warehouseId, ids]);
      for (const userId of valid) {
        await tx.exec(
          `INSERT INTO warehouse_users (warehouse_id, user_id, granted_by) VALUES ($1, $2, $3)
           ON CONFLICT (warehouse_id, user_id) DO NOTHING`,
          [warehouseId, userId, grantedBy]
        );
      }
      return valid.length;
    });
  }

  async isEnterpriseAdmin(userId) {
    const row = await db.one(`SELECT 1 AS ok FROM user_profiles WHERE user_id = $1 AND profile_id = 'prof_admin'`, [userId]);
    return !!row;
  }

  /** Dépôts ACTIFS où l'utilisateur peut réceptionner / mouvementer du stock */
  async accessibleFor(userId) {
    const params = [];
    const scope = tenant.filter('w.enterprise_id', params);
    if (await this.isEnterpriseAdmin(userId)) {
      return db.select(`${SELECT} WHERE w.is_active${scope} ORDER BY l.name, w.name`, params);
    }
    params.push(userId);
    return db.select(
      `${SELECT} WHERE w.is_active${scope}
         AND EXISTS (SELECT 1 FROM warehouse_users wu WHERE wu.warehouse_id = w.id AND wu.user_id = $${params.length})
       ORDER BY l.name, w.name`,
      params
    );
  }

  async canOperate(userId, warehouseId) {
    return (await this.accessibleFor(userId)).some(w => String(w.id) === String(warehouseId));
  }
}

module.exports = new WarehouseModel();
