-- ============================================================================
-- 56_stock_requests.sql — Demandes internes au magasin (idempotente)
-- ----------------------------------------------------------------------------
-- Choix de l'utilisateur (2026-11-09, idée reprise du module de stock de BHIMA) :
--  - tout utilisateur de l'entreprise demande des articles stockables à un dépôt, pour lui-même ou pour un département ;
--  - validation : OPTION de l'entreprise (enterprise.stock_request_validation, désactivée par défaut). Validateur : chef du
--    projet indiqué (ou son intérimaire), sinon responsable du département, sinon administrateur de l'entreprise ; jamais
--    le demandeur. Il peut réduire les quantités ;
--  - le magasinier (ISSUE_STOCK + accès au dépôt) sert la demande par un BON DE SORTIE classique (stock_issues.request_id,
--    stock_issue_lines.request_line_id), en une ou plusieurs fois, sans dépasser la quantité validée ; il peut solder le
--    reste avec un motif (CLOSED). La quantité servie est CALCULÉE à partir des bons de sortie non annulés : annuler un
--    bon de sortie rouvre la demande.
-- ============================================================================

ALTER TABLE enterprise ADD COLUMN IF NOT EXISTS stock_request_validation BOOLEAN NOT NULL DEFAULT FALSE;

CREATE SEQUENCE IF NOT EXISTS stock_request_seq;

CREATE TABLE IF NOT EXISTS stock_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_number VARCHAR(30) NOT NULL UNIQUE
        DEFAULT ('DEM-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(NEXTVAL('stock_request_seq')::TEXT, 5, '0')),
    enterprise_id UUID NOT NULL REFERENCES enterprise(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    requester_id UUID NOT NULL REFERENCES users(id),
    destination_type VARCHAR(20) NOT NULL DEFAULT 'USER',   -- USER : pour le demandeur ; DEPARTMENT : pour un département
    department_id UUID REFERENCES departments(id),
    project_id UUID REFERENCES projects(id),
    purpose TEXT NOT NULL,
    needed_by DATE,
    status VARCHAR(30) NOT NULL DEFAULT 'TO_SERVE',
    validated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    validated_at TIMESTAMPTZ,
    validation_comment TEXT,
    rejected_by UUID REFERENCES users(id) ON DELETE SET NULL,
    rejected_at TIMESTAMPTZ,
    reject_reason TEXT,
    closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    closed_at TIMESTAMPTZ,
    close_reason TEXT,
    cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT stock_requests_status_check CHECK (status IN
        ('PENDING_VALIDATION', 'TO_SERVE', 'PARTIALLY_SERVED', 'SERVED', 'REJECTED', 'CANCELLED', 'CLOSED')),
    CONSTRAINT stock_requests_destination_check CHECK (
        (destination_type = 'USER') OR (destination_type = 'DEPARTMENT' AND department_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_stock_requests_enterprise ON stock_requests (enterprise_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_requests_requester ON stock_requests (requester_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_requests_warehouse_status ON stock_requests (warehouse_id, status);

CREATE TABLE IF NOT EXISTS stock_request_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES stock_requests(id) ON DELETE CASCADE,
    stock_item_id UUID NOT NULL REFERENCES stock_items(id),
    requested_quantity DECIMAL(19,4) NOT NULL,
    validated_quantity DECIMAL(19,4),        -- NULL tant que la demande attend sa validation
    comment TEXT,
    CONSTRAINT stock_request_lines_qty_check CHECK (requested_quantity > 0 AND (validated_quantity IS NULL OR validated_quantity >= 0)
        AND (validated_quantity IS NULL OR validated_quantity <= requested_quantity))
);
CREATE INDEX IF NOT EXISTS idx_stock_request_lines_request ON stock_request_lines (request_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_request_lines_item ON stock_request_lines (request_id, stock_item_id);

-- Bon de sortie qui sert une demande
ALTER TABLE stock_issues ADD COLUMN IF NOT EXISTS request_id UUID REFERENCES stock_requests(id);
ALTER TABLE stock_issue_lines ADD COLUMN IF NOT EXISTS request_line_id UUID REFERENCES stock_request_lines(id);
CREATE INDEX IF NOT EXISTS idx_stock_issues_request ON stock_issues (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_issue_lines_request_line ON stock_issue_lines (request_line_id) WHERE request_line_id IS NOT NULL;

-- Cohérence d'entreprise : entreprise = celle du dépôt ; demandeur, département, projet et articles de la même entreprise
CREATE OR REPLACE FUNCTION stock_request_check() RETURNS trigger AS $$
DECLARE
  v_enterprise UUID;
BEGIN
  SELECT enterprise_id INTO v_enterprise FROM warehouses WHERE id = NEW.warehouse_id;
  IF NEW.enterprise_id IS NULL THEN NEW.enterprise_id := v_enterprise; END IF;
  IF NEW.enterprise_id IS DISTINCT FROM v_enterprise
     OR (SELECT enterprise_id FROM users WHERE id = NEW.requester_id) IS DISTINCT FROM v_enterprise
     OR (NEW.department_id IS NOT NULL AND (SELECT enterprise_id FROM departments WHERE id = NEW.department_id) IS DISTINCT FROM v_enterprise)
     OR (NEW.project_id IS NOT NULL AND (SELECT enterprise_id FROM projects WHERE id = NEW.project_id) IS DISTINCT FROM v_enterprise) THEN
    RAISE EXCEPTION 'Demande au magasin : données d''une autre entreprise' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_stock_request_check ON stock_requests;
CREATE TRIGGER trg_stock_request_check BEFORE INSERT ON stock_requests FOR EACH ROW EXECUTE FUNCTION stock_request_check();

CREATE OR REPLACE FUNCTION stock_request_line_check() RETURNS trigger AS $$
BEGIN
  IF (SELECT enterprise_id FROM stock_items WHERE id = NEW.stock_item_id)
     IS DISTINCT FROM (SELECT enterprise_id FROM stock_requests WHERE id = NEW.request_id) THEN
    RAISE EXCEPTION 'Demande au magasin : article d''une autre entreprise' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_stock_request_line_check ON stock_request_lines;
CREATE TRIGGER trg_stock_request_line_check BEFORE INSERT ON stock_request_lines FOR EACH ROW EXECUTE FUNCTION stock_request_line_check();

-- L'utilisateur peut valider la demande : jamais le demandeur ; chef du projet ou intérimaire du jour (projet indiqué),
-- sinon responsable actif du département, sinon administrateur de l'entreprise
CREATE OR REPLACE FUNCTION user_can_validate_stock_request(p_user UUID, p_request UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM stock_requests r
    LEFT JOIN projects p ON p.id = r.project_id
    LEFT JOIN users pm ON pm.id = p.project_manager_id AND pm.is_active
    LEFT JOIN departments d ON d.id = r.department_id
    LEFT JOIN users dm ON dm.id = d.manager_id AND dm.is_active
    WHERE r.id = p_request AND r.requester_id <> p_user
      AND CASE
            WHEN pm.id IS NOT NULL THEN user_manages_project(p_user, r.project_id)
            WHEN dm.id IS NOT NULL THEN dm.id = p_user
            ELSE EXISTS (SELECT 1 FROM users u JOIN user_profiles up ON up.user_id = u.id AND up.profile_id = 'prof_admin'
                         WHERE u.id = p_user AND u.is_active AND u.enterprise_id = r.enterprise_id)
          END
  )
$$ LANGUAGE sql STABLE;
