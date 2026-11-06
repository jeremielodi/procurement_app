-- ============================================================================
-- 53_manager_delegations.sql — Intérim du chef de projet pendant son absence (idempotente)
-- ----------------------------------------------------------------------------
-- Choix de l'utilisateur (2026-11-06) : délégation PAR PERSONNE (couvre tous les projets dont l'absent est chef),
-- datée, déclarée par le chef lui-même ou par l'administrateur d'entreprise. Pendant la période, l'intérimaire ET le
-- titulaire valident les réquisitions (Activity_ProjectManagerApproval) ; l'intérimaire voit aussi les réquisitions de
-- ces projets. Fin automatique à la date de fin, ou plus tôt (ended_at). La séparation des tâches s'applique toujours.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_delegations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enterprise_id UUID REFERENCES enterprise(id),
    delegator_id UUID NOT NULL REFERENCES users(id),   -- chef de projet absent
    delegate_id UUID NOT NULL REFERENCES users(id),    -- intérimaire
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP,                                -- fin anticipée
    ended_by UUID REFERENCES users(id),
    CONSTRAINT user_delegations_dates_check CHECK (end_date >= start_date),
    CONSTRAINT user_delegations_self_check CHECK (delegator_id <> delegate_id)
);
CREATE INDEX IF NOT EXISTS idx_user_delegations_delegate ON user_delegations(delegate_id, start_date, end_date) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_delegations_delegator ON user_delegations(delegator_id, start_date, end_date);

-- Délégation en cours aujourd'hui (fuseau de la session PostgreSQL)
CREATE OR REPLACE FUNCTION delegation_active(d user_delegations) RETURNS BOOLEAN AS $$
  SELECT d.ended_at IS NULL AND CURRENT_DATE BETWEEN d.start_date AND d.end_date
$$ LANGUAGE sql STABLE;

-- L'utilisateur est chef du projet, ou son intérimaire aujourd'hui
CREATE OR REPLACE FUNCTION user_manages_project(p_user UUID, p_project UUID) RETURNS BOOLEAN AS $$
  SELECT p_project IS NOT NULL AND EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = p_project
      AND (p.project_manager_id = p_user
           OR EXISTS (SELECT 1 FROM user_delegations d
                      WHERE d.delegator_id = p.project_manager_id AND d.delegate_id = p_user AND delegation_active(d)))
  )
$$ LANGUAGE sql STABLE;

-- Visibilité des réquisitions (migration 30) : le chef de projet ET son intérimaire voient celles du projet
CREATE OR REPLACE FUNCTION user_sees_project_requisitions(p_user UUID, p_project UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
      SELECT 1 FROM user_project_profiles(p_user, p_project) x
      WHERE x.profile_id <> ALL (requisition_own_only_profiles())
    )
    OR user_manages_project(p_user, p_project)
$$ LANGUAGE sql STABLE;

-- Validation faite par intérim : chef de projet remplacé
ALTER TABLE workflow_history ADD COLUMN IF NOT EXISTS on_behalf_of UUID REFERENCES users(id);
