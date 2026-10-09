
var q = require('q');
const fs = require('fs');
const { uuid } = require('./util');
const { Pool, Sql, types } = require('pg')
const Transaction = require('./transaction');

// Colonnes DATE (livraison, péremption, facture…) : renvoyées telles quelles « AAAA-MM-JJ ». Par défaut pg en fait
// un Date à minuit LOCAL, sérialisé en UTC → la veille quand le serveur est en avance sur UTC (ex. 2026-10-08T23:00Z).
types.setTypeParser(types.builtins.DATE, (value) => value);

/**
 * @class DatabaseConnector
 *
 * @description
 * The database connector forms a layer between HTTP controllers and the postgreSql
 * database.  The connector is mainly responsible for setting up the initial
 * connection based on parameters in the environment variables, and then wrapping
 * all database queries in promise calls.
 *
 * @requires q
 * @requires pg
 * @requires Transaction
 */
class Database {
  pool = null;
  client = null;
  connectionParams = null;

  constructor() {
    const params  ={
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT,
      connectionTimeoutMillis: 120000,
      min: 0,
      max : 1800,
    };

    this.connectionParams = params;
    this.pool = new Pool(params);
    
  }
 
  async connect() {
    const deferred = q.defer();
    if(this.client) {
      if(this.client._connected) return;
    }
    this.pool.connect((err, client, done) => {
      if(err) {
        return deferred.reject(err);
      }
      this.client = client;
      this.done = done;
      return deferred.resolve(true);
    });

    return deferred.promise;
  }

  /**
   * @function exec execute sql query
   * @param {*} sql @string the query to execute
   * @param {*} params @array parameters
   */
  async exec(sql, params) {
    await this.connect();
    const deferred = q.defer();
    this.client.query(sql, params, (err, res) => {
      if (err) {
        console.log(sql);
        return deferred.reject(err);
      } else {
        // this.done();
        return deferred.resolve(res.rows);
      }

    });
    return deferred.promise;
  }

  /**
   * 
   * @param {*} tableName the table name to inserte into
   * @param {*} jsonData defferent values to insert
   */
  insert(tableName, jsonData) {
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
    return this.exec(sql, params);
  }


  /**
   * 
   * @param {*} tableName the name of the table to update
   * @param {*} jsonData the differents column to apply the change for
   * @param {*} idKey the specific column used as the primary key of the table
   * @param {*} idValue the value of @idKey
   */
  update(tableName, jsonData, idKey, idValue) {
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
    return this.exec(sql, params);
  }


  /**
 * Supprimer un enregistrement d'une table avec support des opérateurs
 * @param {string} tableName - le nom de la table
 * @param {string|object} idKey - la colonne clé ou objet de conditions
 * @param {any} idValue - la valeur (ignoré si idKey est un objet)
 * @param {object} options - options supplémentaires
 * @returns {Promise} - résultat de la suppression
 */
delete(tableName, idKey, idValue, options = {}) {
  let sql = `DELETE FROM ${tableName} WHERE `;
  let params = [];
  
  // Cas 1: idKey est un objet avec plusieurs conditions
  if (typeof idKey === 'object' && idKey !== null) {
    const conditions = [];
    let i = 1;
    for (const [key, value] of Object.entries(idKey)) {
      // Support des opérateurs (ex: { "age >": 18 })
      if (key.includes('>') || key.includes('<') || key.includes('>=') || key.includes('<=') || key.includes('!=') || key.includes('LIKE')) {
        conditions.push(`${key} $${i}`);
      } else {
        conditions.push(`${key} = $${i}`);
      }
      params.push(value);
      i++;
    }
    sql += conditions.join(` ${options.joinOperator || 'AND'} `);
  } 
  // Cas 2: idKey est une string (une seule condition)
  else if (typeof idKey === 'string') {
    sql += `${idKey} = $1`;
    params.push(idValue);
  }
  // Cas 3: erreur
  else {
    return Promise.reject(new Error('idKey must be a string or an object'));
  }
  
  // Ajouter RETURNING si demandé
  if (options.returning) {
    sql += ` RETURNING ${options.returning}`;
  }
  
  return this.exec(sql, params);
}

  select(sqlQuery, params) {
    const [sql] = this.formatQuery(sqlQuery, params);
    return this.exec(sql, params);
  }

  formatQuery(sqlQuery, params) {
    let sql = sqlQuery;
    let i = 1;
    while (sql.indexOf('?') !== -1) {
      sql = sql.replace('?', `$${i}`);
      i++;
    }
    return [sql, params];
  }
  async one(sqlQuery, params) {
    const rows = await this.select(sqlQuery, params);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Vraie transaction sur une connexion DÉDIÉE du pool (les autres méthodes partagent une seule
   * connexion : un BEGIN dessus engloberait les requêtes concurrentes des autres utilisateurs).
   * fn(tx) reçoit { select, one, exec } ; COMMIT si fn réussit, ROLLBACK sinon (erreur relancée).
   * Usage : await db.withTransaction(async (tx) => { await tx.one('INSERT … RETURNING id', [...]); });
   */
  async withTransaction(fn) {
    const client = await this.pool.connect();
    const run = async (sql, params) => (await client.query(this.formatQuery(sql, params)[0], params)).rows;
    const tx = {
      exec: run,
      select: run,
      one: async (sql, params) => (await run(sql, params))[0] || null,
    };
    try {
      await client.query('BEGIN');
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  release() {
    this.client.release(true);
  }
  transaction() {
    return new Transaction(this);
  }
 
  /**
   * @function uuid
   * generates a uuid(buffer)
   */
  uuid() {
    return this.bid(uuid());
  }

  /**
   * @function uuidString
   * generates a uuid string
   */
  uuidString() {
    return uuid();
  }

  async processSQLFile(fileName) {
    let batch = [];
    // Extract SQL queries from files. Assumes no ';' in the fileNames
    var queries = fs.readFileSync(fileName).toString()
      .replace(/(\r\n|\n|\r)/gm, " ") // remove newlines
      .replace(/\s+/g, ' ') // excess white space
      .split(";") // split into all statements
      .map(Function.prototype.call, String.prototype.trim)
      .filter(function (el) { return el.length != 0 }); // remove any empty ones
    const transaction = this.transaction();

    for(let i=0; i < queries.length; i++) {
      const query = queries[i];
      console.log(query);
      await this.exec(queries[i], []);
    }
    
  }
}

module.exports = new Database();
