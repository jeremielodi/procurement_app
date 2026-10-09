// backend/src/controllers/BudgetController.js
const budgetModel = require('../models/BudgetModel');
const { audit, AUDIT } = require('../utils/auditLog');

// Journal d'audit : libellé d'une ligne budgétaire et valeurs suivies
const BUDGET_FIELDS = ['entity_code', 'loc', 'funding_source', 'sub_project', 'function_code', 'description', 'allocated_amount', 'project_id', 'is_active'];
const budgetLabel = (b) => [b?.entity_code, b?.funding_source, b?.function_code].filter(Boolean).join(' / ') || b?.description || b?.id;
const budgetValues = (b) => Object.fromEntries(BUDGET_FIELDS.filter(f => b && b[f] !== undefined).map(f => [f, b[f]]));

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
      const created = result?.id ? await budgetModel.findById(result.id).catch(() => null) : null;
      await audit(req, AUDIT.BUDGET_LINE_CREATED, {
        entity: { type: 'budget_line', id: created?.id || result?.id, label: budgetLabel(created || req.body) },
        details: budgetValues(created || {}),
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async update(req, res) {
    try {
      const before = await budgetModel.findById(req.params.id);
      await budgetModel.update(req.params.id, req.body);
      const after = await budgetModel.findById(req.params.id);
      const changed = BUDGET_FIELDS.filter(f => String(before?.[f] ?? '') !== String(after?.[f] ?? ''));
      if (changed.length) {
        await audit(req, AUDIT.BUDGET_LINE_UPDATED, {
          entity: { type: 'budget_line', id: req.params.id, label: budgetLabel(after || before) },
          oldValue: Object.fromEntries(changed.map(f => [f, before?.[f] ?? null])),
          details: Object.fromEntries(changed.map(f => [f, after?.[f] ?? null])),
        });
      }
      res.json({ success: true, message: 'Budget mis à jour' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async delete(req, res) {
    try {
      const before = await budgetModel.findById(req.params.id);
      await budgetModel.delete(req.params.id);
      await audit(req, AUDIT.BUDGET_LINE_DELETED, {
        entity: { type: 'budget_line', id: req.params.id, label: budgetLabel(before) },
        oldValue: budgetValues(before),
      });
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
    const budgetLines = await budgetModel.findAll({ projectId: req.params.projectId });
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