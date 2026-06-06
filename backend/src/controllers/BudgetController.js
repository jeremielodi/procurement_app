// backend/src/controllers/BudgetController.js
const budgetModel = require('../models/BudgetModel');

class BudgetController {
  async list(req, res) {
    try {
      const budgets = await budgetModel.findAll(req.query);
      res.json({ success: true, data: budgets });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getOne(req, res) {
    try {
      const budget = await budgetModel.findById(req.params.id);
      if (!budget) {
        return res.status(404).json({ success: false, message: 'Budget non trouvé' });
      }
      res.json({ success: true, data: budget });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async create(req, res) {
    try {
      const result = await budgetModel.create({
        ...req.body,
        createdBy: req.user.id
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async update(req, res) {
    try {
      await budgetModel.update(req.params.id, req.body);
      res.json({ success: true, message: 'Budget mis à jour' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async delete(req, res) {
    try {
      await budgetModel.delete(req.params.id);
      res.json({ success: true, message: 'Budget supprimé' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async search(req, res) {
  try {
    const { projectId } = req.query;
    if(!projectId || `${projectId}`.length < 5) {
        return res.status(400).json({ success: false, message: "projet non defini" });
    }

    const budgetLines = await budgetModel.searchBudgetLines(req.query);
    res.json({ success: true, data: budgetLines });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async getByProject(req, res) {
  try {
    const budgetLines = await budgetModel.getBudgetLinesByProject(req.params.projectId);
    res.json({ success: true, data: budgetLines });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

  async addExpense(req, res) {
    try {
      const result = await budgetModel.addExpense({
        ...req.body,
        createdBy: req.user.id
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getSummary(req, res) {
    try {
      const summary = await budgetModel.getSummary();
      res.json({ success: true, data: summary });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new BudgetController();