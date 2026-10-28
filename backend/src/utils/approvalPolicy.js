// backend/src/utils/approvalPolicy.js
// Seuils d'approbation N1 / N2 / N3 (migration 26_approval_policies.sql) : politique du projet, sinon de l'entreprise,
// sinon valeurs par défaut. Le niveau est calculé ici (jamais dans le BPMN) : check_budget le transmet à BpmnGo
// (variable approvalLevel) et l'enregistre sur la réquisition avec la politique appliquée.
const db = require('../config/database');

const DEFAULT_POLICY = { n1Max: 25000, n2Max: 100000 };
const LEVELS = ['N1', 'N2', 'N3'];
// Étape BpmnGo de chaque niveau (approbation directe : une seule étape selon le montant)
const LEVEL_TASKS = { N1: 'Activity_ValidationN1_Manager', N2: 'Activity_ValidationN2_Finance', N3: 'Activity_ValidationN3_DG' };

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * Seuils saisis → { n1Max, n2Max } (null, null = politique héritée) ou erreur { status 400, code APPROVAL_POLICY_INVALID }
 * Règles : les deux ensemble, positifs, N2 ≥ N1 (N1 = N2 : pas de niveau N2)
 */
function parsePolicy(n1, n2) {
  const n1Max = num(n1);
  const n2Max = num(n2);
  if (n1Max === null && n2Max === null) return { n1Max: null, n2Max: null };
  const invalid = (message) => Object.assign(new Error(message), { status: 400, code: 'APPROVAL_POLICY_INVALID' });
  if (n1Max === null || n2Max === null) throw invalid('Indiquez les deux seuils (N1 et N2), ou aucun pour reprendre la politique par défaut');
  if (!Number.isFinite(n1Max) || !Number.isFinite(n2Max) || n1Max <= 0) throw invalid('Les seuils doivent être des montants positifs');
  if (n2Max < n1Max) throw invalid('Le seuil N2 doit être supérieur ou égal au seuil N1');
  return { n1Max, n2Max };
}

/** Politique de l'entreprise (ou défaut) → { n1Max, n2Max, source: 'ENTERPRISE' | 'DEFAULT' } */
async function enterprisePolicy(enterpriseId) {
  const e = enterpriseId ? await db.one('SELECT approval_n1_max, approval_n2_max FROM enterprise WHERE id = $1', [enterpriseId]) : null;
  if (e?.approval_n1_max != null) return { n1Max: Number(e.approval_n1_max), n2Max: Number(e.approval_n2_max), source: 'ENTERPRISE' };
  return { ...DEFAULT_POLICY, source: 'DEFAULT' };
}

/** Politique effective d'un projet → { n1Max, n2Max, source: 'PROJECT' | 'ENTERPRISE' | 'DEFAULT' } */
async function projectPolicy(projectId, enterpriseId = null) {
  const p = projectId ? await db.one('SELECT enterprise_id, approval_n1_max, approval_n2_max FROM projects WHERE id = $1', [projectId]) : null;
  if (p?.approval_n1_max != null) return { n1Max: Number(p.approval_n1_max), n2Max: Number(p.approval_n2_max), source: 'PROJECT' };
  return enterprisePolicy(p?.enterprise_id || enterpriseId);
}

/** Niveau d'approbation d'un montant selon une politique */
function levelFor(amount, policy = DEFAULT_POLICY) {
  const value = Number(amount) || 0;
  if (value < policy.n1Max) return 'N1';
  if (value < policy.n2Max) return 'N2';
  return 'N3';
}

/**
 * Niveau d'une réquisition (montant recalculé depuis ses articles), enregistré avec la politique appliquée
 * → { level, amount, policy }
 */
async function assignRequisitionLevel(requisitionId) {
  const r = await db.one(
    `SELECT r.id, r.project_id, r.enterprise_id,
            COALESCE((SELECT SUM(COALESCE(ri.total_amount, ri.quantity * COALESCE(ri.frequency, 1) * ri.unit_price))
                      FROM requisition_items ri WHERE ri.requisition_id = r.id), r.estimated_amount, 0)::float8 AS amount
     FROM requisitions r WHERE r.id = $1`,
    [requisitionId]
  );
  if (!r) return null;
  const policy = await projectPolicy(r.project_id, r.enterprise_id);
  const level = levelFor(r.amount, policy);
  await db.exec(
    'UPDATE requisitions SET approval_level = $2, approval_policy = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
    [r.id, level, JSON.stringify(policy)]
  );
  return { level, amount: r.amount, policy };
}

module.exports = { DEFAULT_POLICY, LEVELS, LEVEL_TASKS, parsePolicy, enterprisePolicy, projectPolicy, levelFor, assignRequisitionLevel };
