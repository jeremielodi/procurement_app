// backend/src/middleware/auth.js
const jwt = require('jsonwebtoken');
const userModel = require('../models/UserModel');

const JWT_SECRET = process.env.JWT_SECRET;

const authorizationPaths = [
  'auth/login',
  'auth/logout'
];
async function authenticate(req, res, next) {
  try {
    if(authorizationPaths.includes(req.path)) {
      next();
      return;
    }
    const authHeader = req.headers.Authorization || req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token manquant' });
    }
    
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);

    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Token invalide' });
  }
}

function hasPermission(permissionName) {
  return async (req, res, next) => {
    if(!req.user || !req.user.id) {
    return res.status(401).json({ 
        success: false, 
        message: `Authentification requise`,
      });
    }
    const hasPerm = await userModel.hasPermission(req.user.id, permissionName);
    if (!hasPerm) {
      return res.status(403).json({ 
        success: false, 
        message: `Permission ${permissionName} requise` 
      });
    }

    next();
  };
}

function hasAnyPermission(...permissionNames) {
  return async (req, res, next) => {
    for (const perm of permissionNames) {
      if (await userModel.hasPermission(req.user.id, perm)) {
        return next();
      }
    }
    return res.status(403).json({ 
      success: false, 
      message: `Au moins une de ces permissions est requise: ${permissionNames.join(', ')}` 
    });
  };
}

function hasAllPermissions(...permissionNames) {
  return async (req, res, next) => {
    for (const perm of permissionNames) {
      if (!(await userModel.hasPermission(req.user.id, perm))) {
        return res.status(403).json({ 
          success: false, 
          message: `Toutes ces permissions sont requises: ${permissionNames.join(', ')}` 
        });
      }
    }
    next();
  };
}

module.exports = { 
  authenticate, 
  hasPermission, 
  hasAnyPermission,
  hasAllPermissions 
};