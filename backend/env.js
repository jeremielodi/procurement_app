
const dotEnv = require('dotenv');
const path = require('path');
/**
 * @function configureEnvironmentVariables
 *
 * @description
 * Uses dotenv to add environmental variables from the .env.* file to the
 * process object.  If the NODE_ENV system variable is not set, the function
 * defaults to 'production'
 */
function configureEnvironmentVariables() {
    // if the process NODE_ENV is not set, default to production.
    process.env.NODE_ENV = process.env.NODE_ENV || 'production';
  
    // decode the file path for the environmental variables.
    const dotfile = path.resolve(__dirname, './.env');
    // load the environmental variables into process using the dotenv module
    dotEnv.config({ path: dotfile });
}

configureEnvironmentVariables();
