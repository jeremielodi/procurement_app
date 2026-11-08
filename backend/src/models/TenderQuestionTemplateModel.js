// backend/src/models/TenderQuestionTemplateModel.js
// Bibliothèque de questions de l'entreprise (migration 54) : reprises (copiées) dans un appel d'offres
const db = require('../config/database');
const tenant = require('../utils/tenant');

const COLUMNS = `qt.id, qt.label, qt.help_text, qt.answer_type, qt.options, qt.required, qt.is_active,
                 qt.created_at, qt.updated_at, u.first_name || ' ' || u.last_name AS created_by_name`;

class TenderQuestionTemplateModel {

  /** all = aussi les questions désactivées (écran de gestion) */
  async list({ all = false } = {}) {
    const params = [];
    let sql = `SELECT ${COLUMNS} FROM tender_question_templates qt LEFT JOIN users u ON u.id = qt.created_by WHERE 1=1`;
    sql += tenant.filter('qt.enterprise_id', params);
    if (!all) sql += ' AND qt.is_active';
    return db.select(`${sql} ORDER BY LOWER(qt.label)`, params);
  }

  async getById(id) {
    return db.one(
      `SELECT ${COLUMNS}, qt.enterprise_id FROM tender_question_templates qt LEFT JOIN users u ON u.id = qt.created_by
       WHERE qt.id::text = $1`,
      [String(id)]
    );
  }

  /** q : question normalisée (utils/tenderQuestions.normalizeQuestion) */
  async create(q, { enterpriseId, userId }) {
    return db.one(
      `INSERT INTO tender_question_templates (enterprise_id, label, help_text, answer_type, options, required, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7) RETURNING id`,
      [enterpriseId, q.label, q.helpText, q.answerType, JSON.stringify(q.options), q.required, userId]
    );
  }

  async update(id, q, isActive) {
    await db.exec(
      `UPDATE tender_question_templates
       SET label = $2, help_text = $3, answer_type = $4, options = $5::jsonb, required = $6,
           is_active = COALESCE($7, is_active), updated_at = NOW()
       WHERE id::text = $1`,
      [String(id), q.label, q.helpText, q.answerType, JSON.stringify(q.options), q.required, isActive]
    );
  }

  /** Les AO qui l'ont reprise gardent leur copie (template_id → NULL) */
  async remove(id) {
    await db.exec('DELETE FROM tender_question_templates WHERE id::text = $1', [String(id)]);
  }
}

module.exports = new TenderQuestionTemplateModel();
