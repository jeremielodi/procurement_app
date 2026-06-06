
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
        const { sql, params } = this.queries[i];
        const resI = await this.db.exec(sql, params);
        results.push(resI);
        this.sleep(200);
      }
      await this.db.exec('COMMIT');
      // this.//db.done();
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
    this.queries.push({ sql, params });
  }


  /**
   * 
   * @param {*} tableName the name of the table to update
   * @param {*} jsonData the differents column to apply the change for
   * @param {*} idKey the specific column used as the primary key of the table
   * @param {*} idValue the value of @idKey
   */
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
    this.queries.push({ sql, params });
  }

  addDeleteQuery(tableName, idKey, idValue) {
    const sql = `DELETE FROM ${tableName} WHERE ${idKey}=$1`;
    this.queries.push({ sql, params : [idValue] });
  }

  SelectQuery(sqlQuery, params) {
    let sql = sqlQuery;
    let i = 1;
    while (sql.indexOf('?') !== -1) {
      sql = sql.replace('?', `$${i}`);
      i++;
    }
    this.queries.push({ sql, params });
  }

  addQuery(sql, params) {
    this.queries.push({ sql, params });
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = Transaction;
