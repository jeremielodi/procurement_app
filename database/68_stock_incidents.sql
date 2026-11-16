-- ============================================================================
-- 68_stock_incidents.sql — Rapports d'incident sur les articles détenus (idempotente)
-- ----------------------------------------------------------------------------
-- Choix de l'utilisateur (2026-11-16) :
--  - un employé qui perd, se fait voler ou abîme un article qu'il détient (bon de sortie « vers un employé ») fait un
--    RAPPORT D'INCIDENT ; le magasin peut aussi le saisir pour le compte de l'employé ;
--  - types : LOST (perte), STOLEN (vol), DAMAGED (dommage — équipements à n° de série seulement) ;
--  - validation par le CHEF DU PROJET du stock (ou son intérimaire du jour) ; article sans projet, projet sans chef actif,
--    ou chef qui est lui-même le détenteur / le déclarant → ADMINISTRATEUR de l'entreprise. Jamais le détenteur ni le
--    déclarant ;
--  - à la validation, le chef se prononce sur la RESPONSABILITÉ de l'employé (imputable oui / non + commentaire) ;
--  - effet de la validation : perte / vol → l'article sort des détentions de l'employé (quantité reportée dans
--    stock_issue_lines.returned_quantity, comme un retour « perdu » ; équipement → LOST) — aucun mouvement de stock
--    (l'article était déjà sorti) ; dommage → l'équipement reste détenu, état « Endommagé ».
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS stock_incident_seq;

CREATE TABLE IF NOT EXISTS stock_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_number VARCHAR(30) NOT NULL UNIQUE
        DEFAULT ('INC-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(NEXTVAL('stock_incident_seq')::TEXT, 5, '0')),
    enterprise_id UUID NOT NULL REFERENCES enterprise(id),
    holder_id UUID NOT NULL REFERENCES users(id),           -- employé qui détenait les articles
    holder_position VARCHAR(255),                            -- fonction figée à la déclaration (trigger)
    project_id UUID REFERENCES projects(id),                 -- projet du stock (validateur = son chef)
    incident_type VARCHAR(20) NOT NULL,
    incident_date DATE NOT NULL,
    incident_place TEXT,
    circumstances TEXT NOT NULL,
    police_reference TEXT,                                   -- n° de plainte / déclaration de vol (facultatif)
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    reported_by UUID NOT NULL REFERENCES users(id),          -- détenteur, ou magasinier pour son compte
    reported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    validated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    validated_by_position VARCHAR(255),                      -- fonction figée à la décision (trigger)
    validated_at TIMESTAMPTZ,
    on_behalf_of UUID REFERENCES users(id) ON DELETE SET NULL, -- chef de projet remplacé (intérim)
    employee_liable BOOLEAN,                                 -- responsabilité de l'employé (décision du validateur)
    decision_comment TEXT,
    rejected_by UUID REFERENCES users(id) ON DELETE SET NULL,
    rejected_at TIMESTAMPTZ,
    reject_reason TEXT,
    cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT stock_incidents_type_check CHECK (incident_type IN ('LOST', 'STOLEN', 'DAMAGED')),
    CONSTRAINT stock_incidents_status_check CHECK (status IN ('PENDING', 'VALIDATED', 'REJECTED', 'CANCELLED')),
    CONSTRAINT stock_incidents_liability_check CHECK (status <> 'VALIDATED' OR employee_liable IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_stock_incidents_enterprise ON stock_incidents (enterprise_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_incidents_holder ON stock_incidents (holder_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_incidents_status ON stock_incidents (enterprise_id, status);
CREATE INDEX IF NOT EXISTS idx_stock_incidents_project ON stock_incidents (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS trgm_stock_incidents_number ON stock_incidents USING gin (incident_number gin_trgm_ops);

CREATE TABLE IF NOT EXISTS stock_incident_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES stock_incidents(id) ON DELETE CASCADE,
    issue_line_id UUID NOT NULL REFERENCES stock_issue_lines(id),
    stock_item_id UUID NOT NULL REFERENCES stock_items(id),
    unit_id UUID REFERENCES stock_units(id),
    quantity DECIMAL(19,4) NOT NULL,
    CONSTRAINT stock_incident_lines_qty_check CHECK (quantity > 0 AND (unit_id IS NULL OR quantity = 1))
);
CREATE INDEX IF NOT EXISTS idx_stock_incident_lines_incident ON stock_incident_lines (incident_id);
CREATE INDEX IF NOT EXISTS idx_stock_incident_lines_issue_line ON stock_incident_lines (issue_line_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_incident_lines_line ON stock_incident_lines (incident_id, issue_line_id);

-- Cohérence d'entreprise + fonctions figées (détenteur à la déclaration, validateur à la décision)
CREATE OR REPLACE FUNCTION stock_incident_check() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (SELECT enterprise_id FROM users WHERE id = NEW.holder_id) IS DISTINCT FROM NEW.enterprise_id
       OR (NEW.project_id IS NOT NULL AND (SELECT enterprise_id FROM projects WHERE id = NEW.project_id) IS DISTINCT FROM NEW.enterprise_id) THEN
      RAISE EXCEPTION 'Rapport d''incident : données d''une autre entreprise' USING ERRCODE = 'check_violation';
    END IF;
    NEW.holder_position := (SELECT position FROM users WHERE id = NEW.holder_id);
  END IF;
  IF NEW.validated_by IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.validated_by IS DISTINCT FROM OLD.validated_by) THEN
    NEW.validated_by_position := (SELECT position FROM users WHERE id = NEW.validated_by);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_stock_incident_check ON stock_incidents;
CREATE TRIGGER trg_stock_incident_check BEFORE INSERT OR UPDATE ON stock_incidents FOR EACH ROW EXECUTE FUNCTION stock_incident_check();

CREATE OR REPLACE FUNCTION stock_incident_line_check() RETURNS trigger AS $$
BEGIN
  IF (SELECT si.enterprise_id FROM stock_issue_lines il JOIN stock_issues si ON si.id = il.issue_id WHERE il.id = NEW.issue_line_id)
     IS DISTINCT FROM (SELECT enterprise_id FROM stock_incidents WHERE id = NEW.incident_id) THEN
    RAISE EXCEPTION 'Rapport d''incident : article d''une autre entreprise' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_stock_incident_line_check ON stock_incident_lines;
CREATE TRIGGER trg_stock_incident_line_check BEFORE INSERT ON stock_incident_lines FOR EACH ROW EXECUTE FUNCTION stock_incident_line_check();

-- L'utilisateur peut valider le rapport : jamais le détenteur ni le déclarant ; chef du projet (ou intérimaire du jour)
-- s'il est actif et n'est ni le détenteur ni le déclarant, sinon administrateur actif de l'entreprise
CREATE OR REPLACE FUNCTION user_can_validate_stock_incident(p_user UUID, p_incident UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM stock_incidents i
    LEFT JOIN projects p ON p.id = i.project_id
    LEFT JOIN users pm ON pm.id = p.project_manager_id AND pm.is_active
    WHERE i.id = p_incident AND i.holder_id <> p_user AND i.reported_by <> p_user
      AND CASE
            WHEN pm.id IS NOT NULL AND pm.id <> i.holder_id AND pm.id <> i.reported_by THEN user_manages_project(p_user, i.project_id)
            ELSE EXISTS (SELECT 1 FROM users u JOIN user_profiles up ON up.user_id = u.id AND up.profile_id = 'prof_admin'
                         WHERE u.id = p_user AND u.is_active AND u.enterprise_id = i.enterprise_id)
          END
  )
$$ LANGUAGE sql STABLE;
