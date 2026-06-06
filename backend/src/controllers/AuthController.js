// backend/src/controllers/AuthController.js
const userModel = require('../models/UserModel');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

class AuthController {
  async login(req, res) {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email et mot de passe requis' });
      }
      
      const result = await userModel.authenticate(email, password);
      
      if (!result.success) {
        return res.status(401).json({ success: false, message: result.message });
      }
      
      // Générer le token JWT
      const token = jwt.sign(
        { 
          id: result.user.id, 
          email: result.user.email, 
          username: result.user.username 
        },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      
      res.json({ 
        success: true, 
        data: { 
          token, 
          user: result.user 
        } 
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getProfile(req, res) {
    try {
      const user = await userModel.findById(req.user.id);
      const permissions = await userModel.getUserPermissions(req.user.id);
      const profiles = await userModel.getUserProfiles(req.user.id);
      
      res.json({ 
        success: true, 
        data: { 
          ...user, 
          permissions,
          profiles 
        } 
      });
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new AuthController();