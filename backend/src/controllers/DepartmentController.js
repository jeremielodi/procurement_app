// backend/src/controllers/DepartmentController.js
const departmentModel = require('../models/DepartmentModel');
const { v4: uuidv4 } = require('uuid');

class DepartmentController {
  async list(req, res) {
    try {
      const departments = await departmentModel.findAll(req.query);
      res.json({ success: true, data: departments });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getOne(req, res) {
    try {
      const department = await departmentModel.findById(req.params.id);
      if (!department) {
        return res.status(404).json({ success: false, message: 'Département non trouvé' });
      }
      res.json({ success: true, data: department });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async create(req, res) {
    try {
      const { id, code, name, description, managerId } = req.body;
      const createdBy = req.user.id;

      const result = await departmentModel.create({
        id: id || uuidv4(),
        code, name, description, managerId, createdBy
      });

      res.status(201).json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      const { name, description, managerId, isActive } = req.body;

      await departmentModel.update(id, { name, description, managerId, isActive });
      res.json({ success: true, message: 'Département mis à jour' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async delete(req, res) {
    try {
      await departmentModel.delete(req.params.id);
      res.json({ success: true, message: 'Département supprimé' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getUsers(req, res) {
    try {
      const users = await departmentModel.getUsers();
      res.json({ success: true, data: users });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new DepartmentController();