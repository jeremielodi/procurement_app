// backend/src/utils/initDatabase.js
require('dotenv').config(); // Load env first

const db = require('../config/database');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const debug = require('debug');
const logInfo = debug('init-db:info');
const logWarn = debug('init-db:warn');
const logError = debug('init-db:error');
const logSuccess = debug('init-db:success');
const logDebug = debug('init-db:debug');

class DatabaseInitializer {
  async init() {
    logInfo('========================================');
    logInfo('🔧 Database initialization');
    logInfo('========================================');
    
    await this.ensureTablesExist();
    await this.assignPermissionsToAdminProfile();
    await this.createSuperUser();
    
    logInfo('========================================');
  }

  async ensureTablesExist() {
    logInfo('📝 Checking database tables...');
    
    const tables = [
      'users', 'profiles', 'user_profiles', 'permissions', 'profile_permissions',
      'departments', 'projects', 'project_members'
    ];
    
    for (const table of tables) {
      const exists = await this.tableExists(table);
      if (!exists) {
        logWarn('⚠️ Table %s does not exist! Please run the SQL schema first.', table);
      } else {
        logSuccess('✅ Table %s exists', table);
      }
    }
  }

  async tableExists(table) {
    const result = await db.one(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = $1
      ) as exists`,
      [table]
    );
    return result.exists;
  }

  async columnExists(table, column) {
    const result = await db.one(
      `SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = $1 AND column_name = $2
      ) as exists`,
      [table, column]
    );
    return result.exists;
  }

  async isTableEmpty(table) {
    const result = await db.one(`SELECT COUNT(*) as count FROM ${table}`);
    return parseInt(result.count) === 0;
  }

  async getExistingIds(table, idColumn = 'id') {
    const rows = await db.select(`SELECT ${idColumn} FROM ${table}`);
    return new Set(rows.map(row => row[idColumn]));
  }

  async getExistingNames(table, nameColumn = 'name') {
    const rows = await db.select(`SELECT ${nameColumn} FROM ${table}`);
    return new Set(rows.map(row => row[nameColumn]));
  }

  async batchInsert(table, records, idField = 'id', nameField = 'name') {
    if (records.length === 0) return { inserted: 0, skipped: 0 };
    
    const existingIds = await this.getExistingIds(table, idField);
    const existingNames = await this.getExistingNames(table, nameField);
    
    let inserted = 0;
    let skipped = 0;
    
    for (const record of records) {
      if (existingIds.has(record[idField]) || existingNames.has(record[nameField])) {
        skipped++;
        continue;
      }
      
      const cleanRecord = {};
      for (const [key, value] of Object.entries(record)) {
        const columnExists = await this.columnExists(table, key);
        if (columnExists) {
          cleanRecord[key] = value;
        }
      }
      
      await db.insert(table, cleanRecord);
      inserted++;
      existingIds.add(record[idField]);
      existingNames.add(record[nameField]);
    }
    
    logDebug('Batch insert into %s: %d inserted, %d skipped', table, inserted, skipped);
    return { inserted, skipped };
  }

  
  async createDefaultPermissions() {
    logInfo('📝 Creating default permissions...');
    
    const tableExists = await this.tableExists('permissions');
    if (!tableExists) {
      logError('❌ Permissions table does not exist, skipping...');
      return;
    }
    
    const hasId = await this.columnExists('permissions', 'id');
    const hasName = await this.columnExists('permissions', 'name');
    
    if (!hasId || !hasName) {
      logError('❌ Permissions table missing required columns, skipping...');
      return;
    }
    
     }

  async assignPermissionsToAdminProfile() {
    logInfo('📝 Assigning permissions to admin profile...');
    
    const profilesExist = await this.tableExists('profiles');
    const permissionsExist = await this.tableExists('permissions');
    const profilePermissionsExist = await this.tableExists('profile_permissions');
    
    if (!profilesExist || !permissionsExist || !profilePermissionsExist) {
      logError('❌ Required tables missing, skipping permission assignment');
      return;
    }
    
    const adminProfile = await db.one("SELECT id FROM profiles WHERE name = 'Administrateur'");
    
    if (!adminProfile) {
      logWarn('⚠️ Admin profile not found, skipping');
      return;
    }
    
    const existingAssignments = await db.one(
      "SELECT COUNT(*) as count FROM profile_permissions WHERE profile_id = $1",
      [adminProfile.id]
    );
    
    if (parseInt(existingAssignments.count) > 0) {
      logInfo('✅ Permissions already assigned to admin profile, skipping...');
      return;
    }
    
    const allPermissions = await db.select("SELECT id FROM permissions");
    
    if (allPermissions.length === 0) {
      logWarn('⚠️ No permissions found, skipping');
      return;
    }
    
    let inserted = 0;
    for (const perm of allPermissions) {
      await db.insert('profile_permissions', {
        profile_id: adminProfile.id,
        permission_id: perm.id
      });
      inserted++;
    }
    
    logSuccess('✅ Admin profile: %d permissions assigned', inserted);
  }

  async createSuperUser() {
    logInfo('📝 Creating superuser...');
    
    const usersExist = await this.tableExists('users');
    const profilesExist = await this.tableExists('profiles');
    const userProfilesExist = await this.tableExists('user_profiles');
    
    if (!usersExist) {
      logError('❌ Users table does not exist, skipping superuser creation');
      return;
    }
    
    const userCount = await db.one('SELECT COUNT(*) as count FROM users');
    
    if (parseInt(userCount.count) > 0) {
      logInfo('✅ %d user(s) already exist, skipping superuser creation', userCount.count);
      return;
    }
    
    const enterprise = await db.one('SELECT id FROM enterprise');

    if(!enterprise){
       logInfo('No enterprise defined');
       return;
    }
    const userId = uuidv4();
    const defaultPassword = 'Admin123!';
    const passwordHash = await bcrypt.hash(defaultPassword, 10);
    

    const userRecord = {
      id: userId,
      username: 'superadmin',
      email: 'admin@procurement.com',
      password_hash: passwordHash,
      first_name: 'Super',
      last_name: 'Admin',
      is_active: true,
      enterprise_id: enterprise.id
    };
 
    
    if (await this.columnExists('users', 'position')) {
      userRecord.position = 'System Administrator';
    }
    if (await this.columnExists('users', 'created_at')) {
      userRecord.created_at = new Date();
    }
    if (await this.columnExists('users', 'updated_at')) {
      userRecord.updated_at = new Date();
    }
    
    await db.insert('users', userRecord);
    
    if (profilesExist && userProfilesExist) {
      const adminProfile = await db.one("SELECT id FROM profiles WHERE name = 'Administrateur'");
      
      if (adminProfile) {
        await db.insert('user_profiles', {
          user_id: userId,
          profile_id: adminProfile.id,
          assigned_at: new Date(),
          assigned_by: userId
        });
      }
    }
    
    logSuccess('✅ Superuser created successfully!');
    logInfo('📧 Email: admin@procurement.com');
    logWarn('🔑 Password: %s', defaultPassword);
    logWarn('⚠️ Please change this password after first login!');
  }
}

module.exports = new DatabaseInitializer();