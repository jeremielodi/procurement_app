/* eslint-disable global-require */
const uuid = require('uuid/v4');
const fs = require('fs');
const _ = require('lodash');
const {formidable} = require('formidable');
const path = require('path');
const moment = require('moment');
const fsp = require('fs').promises;

const uploadPath = '../upload/';
const imageTypes = ['jpg', 'png', 'gif', 'jpeg', 'PNG', 'JPG', 'BMP'];

function unLinkFile(fileName, specificFolder) {
  if (!fileName) return;
  const folder = specificFolder ? `${specificFolder}/` : '';
  const path1 = `${uploadPath}${folder}${fileName}`;
  fs.unlinkSync(path.resolve(__dirname, path1));
}

function formatDate(_date, format) {
  if (_date) {
    let dateTime = new Date(_date);
    // eslint-disable-next-line no-undef
    dateTime = moment(dateTime).format(format || 'YYYY-MM-DD HH:mm:ss');
    return dateTime;
  }
  return null;
}


function uid() {
  return uuid().toUpperCase().replace(/-/g, '');
}

/**
 * @function loadDictionary
 *
 * @description
 * Either returns a cached version of the dictionary, or loads the dictionary
 * into the cache and returns it.
 *
 * @param {String} key - either 'fr' or 'en'
 */
function loadDictionary(key, dictionaries = {}) {
  const dictionary = dictionaries[key];
  if (dictionary) { return dictionary; }

  // eslint-disable-next-line import/no-dynamic-require
  dictionaries[key] = require(`../../client/i18n/${key}.json`);
  return dictionaries[key];
}

/**
 * @method requireModuleIfExists
 * @description load a module if it exists
 */
function requireModuleIfExists(moduleName) {
  try {
    // eslint-disable-next-line import/no-dynamic-require
    // eslint-disable-next-line global-require
    // eslint-disable-next-line import/no-dynamic-require
    require(moduleName);
    // eslint-disable-next-line no-undef
    debug(`Dynamically loaded ${moduleName}.`);
  } catch (err) {
    return false;
  }
  return true;
}

function translate(lang = 'fr', word) {
  const dictionary = loadDictionary(lang);
  const translation = _.get(dictionary, word);
  return translation || word;
}

/*
 * rename an object's keys
 */

function renameKeys(objs, newKeys) {
  const formatedKeys = _.isString(newKeys) ? JSON.parse(newKeys) : newKeys;
  if (_.isArray(objs)) {
    _.forEach(objs, (obj, index) => {
      objs[index] = renameObjectKeys(obj, formatedKeys);
    });
    return objs;
  }
  return renameObjectKeys(objs, formatedKeys);
}

function renameObjectKeys(obj, newKeys) {
  const keyValues = Object.keys(obj).map(key => {
    const newKey = newKeys[key] || key;
    return { [newKey] : obj[key] };
  });
  return Object.assign({}, ...keyValues);
}

// retreive all columns that should be hidden(use in report, tree.js)
function removableColumns(columns, columnsToDisplay, columnFrom) {
  let newHeaders = _.clone(columns);
  newHeaders = newHeaders.filter(key => {
    return (columns.indexOf(key) >= columns.indexOf(columnFrom));
  });
  const ar = newHeaders.filter(key => {
    return !columnsToDisplay.includes(key) && (newHeaders.indexOf(key) > newHeaders.indexOf(columnFrom));
  }).map(key => {
    return newHeaders.indexOf(key);
  });

  // order arry desc
  for (let i = 0; i < ar.length - 1; i++) {
    for (let j = i + 1; j < ar.length; j++) {
      if (ar[j] > ar[i]) {
        const temp = _.clone(ar[i]);
        ar[i] = _.clone(ar[j]);
        ar[j] = temp;
      }
    }
  }
  return ar.map(k => {
    return {
      index : k,
      col : newHeaders[k],
    };
  });
}

function hideColumns(rmColumns, results) {
  // some columns can be hidden
  rmColumns.forEach(col => {
    const cols1 = _.clone(results[col.index]);
    const nextIndex = results[col.index + 1] || null;
    const previousIndex = results[col.index - 1] || null;
    delete results[col.index];

    if (nextIndex) {
      cols1.forEach(c1 => {
        nextIndex.forEach(c2 => {
          if (c2.parent === c1.uuid) {
            c2.parent = c1.parent;
          }
        });
      });
    } else if (previousIndex) {
      previousIndex.forEach(p => {
        cols1.forEach(c1 => {
          if (c1.parent === p.uuid) {
            // eslint-disable-next-line no-undef
            bulkSum(c1, p);
          }
        });
      });

    }
    // eslint-disable-next-line no-param-reassign
    results = results.filter((r, i) => {
      return col.index !== i;
    });
  });
}

function toMap(data, key) {
  let obj = {};
  data.forEach(row => {
    obj[row[key]] = row;
  });

  return obj;
}

function toCSV(obj, showHeader) {
  let values = '';
  let headers = '';
  const keys =  Object.keys(obj);
  keys.forEach((key, i) => {
    values +=`${obj[key]}`;
    headers +=`${key}`;
    if(i < keys.length - 1) {
      values +=', ';
      headers +=', ';
    }
  });
  headers+='\n';
  values+='\n';

  return showHeader ? headers + values :  values;
}

function parseMulipartUpload(req) {
  const form = formidable({ multiples: true });

  return new Promise((successCallback, failureCallback) => {
   
    form.parse(req, (err, fields, files) => {
     
      if (err) {
       
        return failureCallback(err);
      }
      return successCallback({ fields, files });
    });
  });
}

async function moveFile(oldPath, newPath) {
  const { dir } = path.parse(newPath);
  if (dir) {
    await fsp.mkdir(dir, { recursive: true });
  }

  await fsp.copyFile(oldPath, newPath);
  return true;
}

function formatPDFname(file) {
  let newFile = file.split('_');
  let txt = '';
  newFile.forEach(f => {
      txt+= f.substring(0, 1).toUpperCase() + f.substring(1, f.length);
  });
  return txt;
}

function stringify(data) {
  return typeof (data) == 'string' ? JSON.parse(data) : data;
}

function parseJSON(data) {
  try {
    data =  JSON.parse(data);
  } catch (error) {
    
  }
  return data;
}


function isValidVariableDeclaration(variable){
  // Regular expression to check for valid variable names
  const variableNamePattern = /^[a-zA-Z_$][0-9a-zA-Z_$]*$/;

  // Check if the input string matches the pattern
  return variableNamePattern.test(variable);
}

function generate3DigitText() {
  return Math.floor(Math.random() * 1000).toString().padStart(3, '0');
}
/**
 * @function uuid
 *
 * @description
 * A replacement for the uuid/v4 function that renders UUIDs in the same format
 * as the BUID() MySQL function.
 *
 * @returns {String} - a version 4 UUID
 */
module.exports.uuid = uid;
module.exports.generate3DigitText = generate3DigitText;
module.exports.unLinkFile = unLinkFile;
module.exports.loadDictionary = loadDictionary;
module.exports.loadModuleIfExists = requireModuleIfExists;
module.exports.translate = translate;
module.exports.renameKeys = renameKeys;
module.exports.removableColumns = removableColumns;
module.exports.hideColumns = hideColumns;
module.exports.formatDate = formatDate;
module.exports.parseMulipartUpload = parseMulipartUpload;
module.exports.moveFile = moveFile;
module.exports.formatPDFname = formatPDFname;
module.exports.stringify = stringify;
module.exports.toMap = toMap;
module.exports.toCSV = toCSV;
module.exports.parseJSON = parseJSON;
module.exports.isValidVariableDeclaration = isValidVariableDeclaration;
