// backend/src/controllers/BudgetController.js
const budgetModel = require('../models/BudgetModel');
const { audit, AUDIT } = require('../utils/auditLog');
const register = require('../services/BudgetRegisterService');
const i18n = require('../i18n');

// Journal d'audit : libellé d'une ligne budgétaire et valeurs suivies
const BUDGET_FIELDS = ['entity_code', 'loc', 'funding_source', 'sub_project', 'function_code', 'activity_code', 'description', 'allocated_amount', 'project_id', 'is_active'];
const budgetLabel = (b) => [b?.entity_code, b?.funding_source, b?.function_code, b?.activity_code].filter(Boolean).join(' / ') || b?.description || b?.id;
const budgetValues = (b) => Object.fromEntries(BUDGET_FIELDS.filter(f => b && b[f] !== undefined).map(f => [f, b[f]]));

class BudgetController {
  /**
   * GET /budget — avec ?page= : registre paginé et filtré (search, fundingSource, projectId, withoutProject, status,
   * sort, order) → { data, pagination, totals } ; sans page : toutes les lignes (formulaire de réquisition…)
   */
  async list(req, res) {
    try {
      if (req.query.page) {
        const { rows, pagination, totals } = await register.list(req.query);
        return res.json({ success: true, data: rows, pagination, totals });
      }
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

  /** GET /budget/funding-sources — sources de financement utilisées (filtre du registre) */
  async fundingSources(req, res) {
    try {
      res.json({ success: true, data: await register.fundingSources() });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /** GET /budget/export — registre au format Excel (mêmes filtres que la liste), réimportable */
  async exportExcel(req, res) {
    try {
      const file = await register.exportXlsx(req.query, { lang: i18n.fromRequest(req) });
      res.set('Content-Type', file.contentType);
      res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
      res.end(file.buffer);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /** GET /budget/import/template?format=xlsx|csv — modèle à remplir */
  async importTemplate(req, res) {
    try {
      const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
      const file = await register.template({ lang: i18n.fromRequest(req), format });
      res.set('Content-Type', file.contentType);
      res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
      res.end(file.buffer);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * POST /budget/import (multipart : file ; confirm=1 pour écrire) — sans confirm : aperçu { lines, errors, summary } ;
   * avec confirm : lignes valides écrites en une transaction, tracé BUDGET_LINES_IMPORTED (détail par ligne)
   */
  async importLines(req, res) {
    try {
      if (!req.enterpriseId) return res.status(403).json({ success: false, message: "Réservé aux utilisateurs d'une entreprise" });
      if (!req.file) return res.status(400).json({ success: false, code: 'NO_FILE', message: 'Aucun fichier reçu' });
      if (!['1', 'true'].includes(String(req.body?.confirm ?? req.query.confirm))) {
        return res.json({ success: true, data: await register.preview(req.file) });
      }
      const { changes, ...result } = await register.apply(req.file, { userId: req.user.id });
      await audit(req, AUDIT.BUDGET_LINES_IMPORTED, {
        entity: { type: 'budget_lines', id: null, label: req.file.originalname },
        details: {
          file: req.file.originalname, created: result.created, updated: result.updated, skippedLines: result.skipped,
          allocatedChange: result.allocatedChange, lines: changes.slice(0, 200),
        },
        enterpriseId: req.enterpriseId,
      });
      res.json({ success: true, data: result, message: 'Import terminé' });
    } catch (error) {
      if (error.status && error.status < 500) {
        return res.status(error.status).json({ success: false, code: error.code, message: error.message, details: error.details });
      }
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