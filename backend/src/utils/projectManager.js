// backend/src/utils/projectManager.js
// Chef du projet (budget holder, projects.project_manager_id) : il valide seul les réquisitions de son projet
// (BPMN du 2026-11-06, étape Activity_ProjectManagerApproval, groupe « project_manager » accordé par
// utils/projectAccess au chef du projet ACTUEL — pas d'assignation figée dans BpmnGo).
// Une réquisition doit donc avoir un projet, ce projet un chef de projet actif, et le demandeur ne peut pas être
// ce chef de projet (séparation des tâches : il ne valide pas sa propre demande).
const db = require('../config/database');

const fail = (status, code, message, details) => Object.assign(new Error(message), { status, code, details });

/** Chef de projet actif → { id, email, firstName, lastName } ou null */
async function ofProject(projectId) {
  if (!projectId) return null;
  const row = await db.one(
    `SELECT u.id, u.email, u.first_name, u.last_name FROM projects p
     JOIN users u ON u.id = p.project_manager_id AND u.is_active = true
     WHERE p.id = $1`,
    [projectId]
  );
  return row ? { id: row.id, email: row.email, firstName: row.first_name, lastName: row.last_name } : null;
}

/**
 * Contrôle d'une réquisition soumise (création, nouvelle soumission) → chef de projet.
 * 400 PROJECT_REQUIRED, 409 PROJECT_MANAGER_MISSING (projet sans chef de projet actif),
 * 409 REQUESTER_IS_PROJECT_MANAGER (le chef de projet ne peut pas valider sa propre réquisition).
 */
async function forRequisition(projectId, requesterId) {
  if (!projectId) throw fail(400, 'PROJECT_REQUIRED', 'Choisissez le projet : la réquisition est validée par son chef de projet');
  const manager = await ofProject(projectId);
  if (!manager) {
    const project = await db.one('SELECT code FROM projects WHERE id = $1', [projectId]);
    throw fail(409, 'PROJECT_MANAGER_MISSING',
      `Le projet ${project?.code || ''} n'a pas de chef de projet actif : demandez à l'administrateur de le désigner`.replace('  ', ' '),
      { project: project?.code || null });
  }
  if (String(manager.id) === String(requesterId)) {
    throw fail(409, 'REQUESTER_IS_PROJECT_MANAGER',
      'Vous êtes le chef de ce projet : vous ne pouvez pas valider votre propre réquisition — elle doit être faite par un autre membre du projet');
  }
  return manager;
}

module.exports = { ofProject, forRequisition };
