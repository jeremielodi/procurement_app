// backend/src/transaction.js
var q = require('q');

/**
 * Manage transaction' queries
 */
class Transaction {
  db = null;

  constructor(db) {
    this.db = db;
  }

  queries = [];

  async execute() {
    const deferred = q.defer();
    try {
      let results = [];
      await this.db.exec('BEGIN');
      for (let i = 0; i < this.queries.length; i++) {
        const { sql, params, isRaw } = this.queries[i];
        
        // Si c'est une requête raw, exécuter sans préparation
        if (isRaw) {
          const resI = await this.db.exec(sql);
          results.push(resI);
        } else {
          const resI = await this.db.exec(sql, params);
          results.push(resI);
        }
        
        this.sleep(200);
      }
      await this.db.exec('COMMIT');
      deferred.resolve(results);
    } catch (e) {
      await this.db.exec('ROLLBACK');
      deferred.reject(e);      
    }
    return deferred.promise;
  }

  exec(sql, params) {
    const deferred = q.defer();
    this.db.query(sql, params, (err, res) => {
      if (err) {
        return deferred.reject(err);
      } else {
        return deferred.resolve(res.rows);
      }
    });
    return deferred.promise;
  }

  // create an insert query from a json
  addInsertQuery(tableName, jsonData) {
    let colSql = '';
    let valSql = '';
    const params = [];
    const keys = Object.keys(jsonData);
    keys.forEach((col, index) => {
      colSql += col;
      valSql += `$${index + 1}`;
      let value = jsonData[col];
      params.push(value);
      if (keys.length !== (index + 1)) {
        colSql += ',';
        valSql += ',';
      }
    });

    const sql = `INSERT INTO ${tableName}(${colSql}) values(${valSql})`;
    this.queries.push({ sql, params, isRaw: false });
  }

  /**
   * Ajouter une requête INSERT avec des valeurs brutes (pour les expressions SQL comme NOW(), gen_random_uuid(), etc.)
   */
  addInsertRawQuery(tableName, jsonData, rawFields = []) {
    let colSql = '';
    let valSql = '';
    const params = [];
    const keys = Object.keys(jsonData);
    let paramIndex = 1;
    
    keys.forEach((col) => {
      colSql += col;
      
      // Vérifier si le champ doit être traité comme brut
      if (rawFields.includes(col)) {
        valSql += jsonData[col]; // Valeur brute (ex: 'NOW()', 'gen_random_uuid()')
      } else {
        valSql += `$${paramIndex}`;
        params.push(jsonData[col]);
        paramIndex++;
      }
      
      if (keys.indexOf(col) !== keys.length - 1) {
        colSql += ',';
        valSql += ',';
      }
    });

    const sql = `INSERT INTO ${tableName}(${colSql}) values(${valSql})`;
    this.queries.push({ sql, params, isRaw: false });
  }

  /**
   * Ajouter une requête UPDATE avec des valeurs brutes
   */
  addUpdateRawQuery(tableName, jsonData, idKey, idValue, rawFields = []) {
    let setSql = '';
    const params = [];
    const keys = Object.keys(jsonData);
    let paramIndex = 1;
    
    keys.forEach((col) => {
      if (rawFields.includes(col)) {
        setSql += `${col}=${jsonData[col]}`;
      } else {
        setSql += `${col}=$${paramIndex}`;
        params.push(jsonData[col]);
        paramIndex++;
      }
      
      if (keys.indexOf(col) !== keys.length - 1) {
        setSql += ',';
      }
    });
    
    params.push(idValue);
    const sql = `UPDATE ${tableName} SET ${setSql} WHERE ${idKey}=$${paramIndex}`;
    this.queries.push({ sql, params, isRaw: false });
  }

  /**
   * Ajouter une requête SQL brute directement
   */
  addRawQuery(sql) {
    this.queries.push({ sql, params: [], isRaw: true });
  }

  /**
   * Ajouter une requête avec support des opérateurs
   */
  addWhereQuery(tableName, conditions, operation = 'AND') {
    let sql = `SELECT * FROM ${tableName} WHERE `;
    const params = [];
    const conditionParts = [];
    let paramIndex = 1;
    
    for (const [key, value] of Object.entries(conditions)) {
      if (key.includes('>') || key.includes('<') || key.includes('>=') || key.includes('<=') || key.includes('!=') || key.includes('LIKE')) {
        conditionParts.push(`${key} $${paramIndex}`);
      } else {
        conditionParts.push(`${key} = $${paramIndex}`);
      }
      params.push(value);
      paramIndex++;
    }
    
    sql += conditionParts.join(` ${operation} `);
    this.queries.push({ sql, params, isRaw: false });
  }

  /**
   * Ajouter une requête UPDATE incrémentale (ex: SET count = count + 1)
   */
  addIncrementQuery(tableName, field, idKey, idValue, increment = 1) {
    const sql = `UPDATE ${tableName} SET ${field} = ${field} + $1 WHERE ${idKey} = $2`;
    const params = [increment, idValue];
    this.queries.push({ sql, params, isRaw: false });
  }

  /**
   * Ajouter une requête UPSERT (INSERT ... ON CONFLICT DO UPDATE)
   */
  addUpsertQuery(tableName, jsonData, conflictKey, updateFields = null) {
    let colSql = '';
    let valSql = '';
    const params = [];
    const keys = Object.keys(jsonData);
    
    keys.forEach((col, index) => {
      colSql += col;
      valSql += `$${index + 1}`;
      params.push(jsonData[col]);
      if (keys.length !== (index + 1)) {
        colSql += ',';
        valSql += ',';
      }
    });
    
    let updateSql = '';
    if (updateFields) {
      updateSql = updateFields.map(field => `${field} = EXCLUDED.${field}`).join(', ');
    } else {
      updateSql = keys.map(key => `${key} = EXCLUDED.${key}`).join(', ');
    }
    
    const sql = `INSERT INTO ${tableName}(${colSql}) values(${valSql}) 
                 ON CONFLICT (${conflictKey}) DO UPDATE SET ${updateSql}`;
    this.queries.push({ sql, params, isRaw: false });
  }

  /**
   * Ajouter une requête avec RETURNING
   */
  addInsertReturningQuery(tableName, jsonData, returning = '*') {
    let colSql = '';
    let valSql = '';
    const params = [];
    const keys = Object.keys(jsonData);
    
    keys.forEach((col, index) => {
      colSql += col;
      valSql += `$${index + 1}`;
      params.push(jsonData[col]);
      if (keys.length !== (index + 1)) {
        colSql += ',';
        valSql += ',';
      }
    });
    
    const sql = `INSERT INTO ${tableName}(${colSql}) values(${valSql}) RETURNING ${returning}`;
    this.queries.push({ sql, params, isRaw: false });
  }

  addUpdateQuery(tableName, jsonData, idKey, idValue) {
    let colSql = '';
    let valSql = '';
    let params = [];
    const keys = Object.keys(jsonData);
    let i = 0;
    keys.forEach((col, index) => {
      colSql += `${col}=$${index + 1}`;
      let value = jsonData[col];
      params[i] = value;
      if (keys.length !== (index + 1)) {
        colSql += ',';
        valSql += ',';
      }
      i++;
    });
    params[i] = idValue;
    const sql = `UPDATE ${tableName} SET ${colSql} WHERE ${idKey}=$${i + 1}`;
    this.queries.push({ sql, params, isRaw: false });
  }

  addDeleteQuery(tableName, idKey, idValue) {
    const sql = `DELETE FROM ${tableName} WHERE ${idKey}=$1`;
    this.queries.push({ sql, params: [idValue], isRaw: false });
  }

  /**
   * Supprimer avec plusieurs conditions
   */
  addDeleteWhereQuery(tableName, conditions) {
    let sql = `DELETE FROM ${tableName} WHERE `;
    const params = [];
    const conditionParts = [];
    let paramIndex = 1;
    
    for (const [key, value] of Object.entries(conditions)) {
      conditionParts.push(`${key} = $${paramIndex}`);
      params.push(value);
      paramIndex++;
    }
    
    sql += conditionParts.join(' AND ');
    this.queries.push({ sql, params, isRaw: false });
  }

  SelectQuery(sqlQuery, params) {
    let sql = sqlQuery;
    let i = 1;
    while (sql.indexOf('?') !== -1) {
      sql = sql.replace('?', `$${i}`);
      i++;
    }
    this.queries.push({ sql, params, isRaw: false });
  }

  addQuery(sql, params) {
    this.queries.push({ sql, params, isRaw: false });
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = Transaction;