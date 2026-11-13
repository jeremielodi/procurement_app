-- 67_requisition_drafts.sql (2026-11-13) — Réquisition créée en brouillon
-- Choix de l'utilisateur : une réquisition est d'abord un BROUILLON (DRAFT), modifiable par le demandeur, et n'entre
-- dans le circuit BpmnGo qu'à sa soumission (POST /requisitions/:id/submit). Un brouillon n'est visible que de son
-- demandeur et des administrateurs de l'entreprise (pas encore des approbateurs ni des autres membres du projet).
-- Idempotente.

-- Date de soumission (colonne de 01_schema.sql, jamais renseignée jusqu'ici) : écrite à la soumission
ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP;

-- Réquisitions déjà entrées dans le circuit : date de soumission = date de création
UPDATE requisitions SET submitted_at = created_at
WHERE submitted_at IS NULL AND process_instance_id IS NOT NULL;

-- Administrateur d'entreprise (voit aussi les brouillons des autres, pour les supprimer au besoin)
CREATE OR REPLACE FUNCTION user_is_enterprise_admin(p_user UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM user_profiles up WHERE up.user_id = p_user AND up.profile_id = 'prof_admin')
$$ LANGUAGE sql STABLE;

-- L'utilisateur peut consulter cette réquisition : la sienne ; sinon celles de son projet selon ses profils, sauf un
-- brouillon (réservé à son demandeur et aux administrateurs)
CREATE OR REPLACE FUNCTION user_can_view_requisition(p_user UUID, p_requisition UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM requisitions r
    WHERE r.id = p_requisition
      AND (r.requester_id = p_user
           OR ((r.status <> 'DRAFT' OR user_is_enterprise_admin(p_user))
               AND user_sees_project_requisitions(p_user, r.project_id)))
  )
$$ LANGUAGE sql STABLE;
