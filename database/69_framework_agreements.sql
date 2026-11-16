-- ============================================================================
-- 69_framework_agreements.sql — Contrats / accords-cadres (idempotente)
-- ----------------------------------------------------------------------------
-- Choix de l'utilisateur (2026-11-16) :
--  - un accord-cadre = UN fournisseur, une période de validité, un PLAFOND (montant maximum, devise) et un BORDEREAU
--    de prix (articles à prix unitaire fixé, quantité maximale facultative) ; articles hors bordereau autorisés ou non ;
--  - origine : appel d'offres / demande de cotations attribué (fournisseur et prix repris) ou saisie manuelle avec le
--    contrat signé en pièce jointe (attachments, entity_type 'framework_agreement') ;
--  - projets facultatifs : aucun projet = utilisable par toute l'entreprise, sinon seulement les projets listés ;
--  - validation : chaque CHEF DES PROJETS listés (ou son intérimaire du jour) d'abord, puis le DIRECTEUR GÉNÉRAL
--    (profil prof_dg) en dernier, qui active le contrat ; contrat ouvert à toute l'entreprise : le DG seul ; jamais
--    l'auteur (un chef de projet auteur du contrat : son étape est sautée, le DG reste le dernier contrôle) ;
--  - rejet à n'importe quelle étape : retour en brouillon (motif), nouvelle soumission = nouveau tour de validation ;
--  - commandes : nouvelle méthode d'achat « Commande sur accord-cadre » (phase 2) ; montant consommé = bons de
--    commande actifs liés au contrat (même règle que le budget).
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS framework_agreement_seq;

CREATE TABLE IF NOT EXISTS framework_agreements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agreement_number VARCHAR(30) NOT NULL UNIQUE
        DEFAULT ('AC-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(NEXTVAL('framework_agreement_seq')::TEXT, 5, '0')),
    enterprise_id UUID NOT NULL REFERENCES enterprise(id),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    contract_reference VARCHAR(100),                 -- n° du contrat signé / du marché (facultatif)
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    tender_id INTEGER REFERENCES tenders(id) ON DELETE SET NULL, -- appel d'offres / demande de cotations d'origine
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    ceiling_amount DECIMAL(19,4) NOT NULL,
    currency_id SMALLINT NOT NULL REFERENCES currency(id),
    allow_off_list BOOLEAN NOT NULL DEFAULT false,   -- articles hors bordereau autorisés sur les commandes
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    submission_round INTEGER NOT NULL DEFAULT 0,      -- tour de validation (incrémenté à chaque soumission)
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    submitted_at TIMESTAMPTZ,
    activated_by UUID REFERENCES users(id) ON DELETE SET NULL, -- directeur général
    activated_by_position VARCHAR(255),
    activated_at TIMESTAMPTZ,
    last_reject_reason TEXT,
    last_rejected_by UUID REFERENCES users(id) ON DELETE SET NULL,
    last_rejected_at TIMESTAMPTZ,
    suspended_by UUID REFERENCES users(id) ON DELETE SET NULL,
    suspended_at TIMESTAMPTZ,
    suspend_reason TEXT,
    closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    closed_at TIMESTAMPTZ,
    close_reason TEXT,
    CONSTRAINT framework_agreements_status_check CHECK (status IN ('DRAFT', 'PENDING_VALIDATION', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'CANCELLED')),
    CONSTRAINT framework_agreements_dates_check CHECK (end_date >= start_date),
    CONSTRAINT framework_agreements_ceiling_check CHECK (ceiling_amount > 0)
);
CREATE INDEX IF NOT EXISTS idx_framework_agreements_enterprise ON framework_agreements (enterprise_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_framework_agreements_status ON framework_agreements (enterprise_id, status);
CREATE INDEX IF NOT EXISTS idx_framework_agreements_supplier ON framework_agreements (supplier_id);
CREATE INDEX IF NOT EXISTS idx_framework_agreements_tender ON framework_agreements (tender_id) WHERE tender_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS trgm_framework_agreements_number ON framework_agreements USING gin (agreement_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_framework_agreements_title ON framework_agreements USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_framework_agreements_reference ON framework_agreements USING gin (contract_reference gin_trgm_ops);

-- Projets autorisés à commander (aucune ligne = toute l'entreprise)
CREATE TABLE IF NOT EXISTS framework_agreement_projects (
    agreement_id UUID NOT NULL REFERENCES framework_agreements(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id),
    PRIMARY KEY (agreement_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_framework_agreement_projects_project ON framework_agreement_projects (project_id);

-- Bordereau de prix
CREATE TABLE IF NOT EXISTS framework_agreement_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agreement_id UUID NOT NULL REFERENCES framework_agreements(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    stock_item_id UUID REFERENCES stock_items(id),   -- article du catalogue (facultatif)
    description VARCHAR(500) NOT NULL,
    unit_id INTEGER NOT NULL REFERENCES units(id),
    unit_price DECIMAL(19,4) NOT NULL CHECK (unit_price >= 0),
    max_quantity DECIMAL(19,4) CHECK (max_quantity IS NULL OR max_quantity > 0),
    requisition_item_id INTEGER REFERENCES requisition_items(id) ON DELETE SET NULL -- ligne de l'AO d'origine
);
CREATE INDEX IF NOT EXISTS idx_framework_agreement_items_agreement ON framework_agreement_items (agreement_id, position);
CREATE INDEX IF NOT EXISTS idx_framework_agreement_items_stock_item ON framework_agreement_items (stock_item_id) WHERE stock_item_id IS NOT NULL;

-- Décisions de validation (une ligne par étape et par tour) : PROJECT_MANAGER (un par projet) puis DG
CREATE TABLE IF NOT EXISTS framework_agreement_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agreement_id UUID NOT NULL REFERENCES framework_agreements(id) ON DELETE CASCADE,
    round INTEGER NOT NULL,
    step VARCHAR(20) NOT NULL,
    project_id UUID REFERENCES projects(id),
    decision VARCHAR(20) NOT NULL,
    decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_by_position VARCHAR(255),                -- fonction figée (trigger)
    on_behalf_of UUID REFERENCES users(id) ON DELETE SET NULL, -- chef de projet remplacé (intérim)
    comment TEXT,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT framework_agreement_approvals_step_check CHECK (step IN ('PROJECT_MANAGER', 'DG')),
    CONSTRAINT framework_agreement_approvals_decision_check CHECK (decision IN ('APPROVED', 'REJECTED')),
    CONSTRAINT framework_agreement_approvals_project_check CHECK ((step = 'PROJECT_MANAGER') = (project_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_framework_agreement_approvals_agreement ON framework_agreement_approvals (agreement_id, round);

-- Commandes passées sur un accord-cadre (phase 2 : méthode d'achat FRAMEWORK_AGREEMENT)
ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS framework_agreement_id UUID REFERENCES framework_agreements(id);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS framework_agreement_id UUID REFERENCES framework_agreements(id);
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS framework_item_id UUID REFERENCES framework_agreement_items(id);
CREATE INDEX IF NOT EXISTS idx_requisitions_framework_agreement ON requisitions (framework_agreement_id) WHERE framework_agreement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_orders_framework_agreement ON purchase_orders (framework_agreement_id) WHERE framework_agreement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_framework_item ON purchase_order_items (framework_item_id) WHERE framework_item_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Cohérence d'entreprise et fonctions figées
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION framework_agreement_check() RETURNS trigger AS $$
BEGIN
  IF NEW.activated_by IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.activated_by IS DISTINCT FROM OLD.activated_by) THEN
    NEW.activated_by_position := (SELECT position FROM users WHERE id = NEW.activated_by);
  END IF;
  IF NEW.tender_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.tender_id IS DISTINCT FROM OLD.tender_id)
     AND (SELECT r.enterprise_id FROM tenders t JOIN requisitions r ON r.id = t.requisition_id WHERE t.id = NEW.tender_id)
         IS DISTINCT FROM NEW.enterprise_id THEN
    RAISE EXCEPTION 'Accord-cadre : appel d''offres d''une autre entreprise' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_framework_agreement_check ON framework_agreements;
CREATE TRIGGER trg_framework_agreement_check BEFORE INSERT OR UPDATE ON framework_agreements
  FOR EACH ROW EXECUTE FUNCTION framework_agreement_check();

CREATE OR REPLACE FUNCTION framework_agreement_project_check() RETURNS trigger AS $$
BEGIN
  IF (SELECT enterprise_id FROM projects WHERE id = NEW.project_id)
     IS DISTINCT FROM (SELECT enterprise_id FROM framework_agreements WHERE id = NEW.agreement_id) THEN
    RAISE EXCEPTION 'Accord-cadre : projet d''une autre entreprise' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_framework_agreement_project_check ON framework_agreement_projects;
CREATE TRIGGER trg_framework_agreement_project_check BEFORE INSERT OR UPDATE ON framework_agreement_projects
  FOR EACH ROW EXECUTE FUNCTION framework_agreement_project_check();

CREATE OR REPLACE FUNCTION framework_agreement_item_check() RETURNS trigger AS $$
BEGIN
  IF NEW.stock_item_id IS NOT NULL AND (SELECT enterprise_id FROM stock_items WHERE id = NEW.stock_item_id)
     IS DISTINCT FROM (SELECT enterprise_id FROM framework_agreements WHERE id = NEW.agreement_id) THEN
    RAISE EXCEPTION 'Accord-cadre : article d''une autre entreprise' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_framework_agreement_item_check ON framework_agreement_items;
CREATE TRIGGER trg_framework_agreement_item_check BEFORE INSERT OR UPDATE ON framework_agreement_items
  FOR EACH ROW EXECUTE FUNCTION framework_agreement_item_check();

CREATE OR REPLACE FUNCTION framework_agreement_approval_position() RETURNS trigger AS $$
BEGIN
  NEW.decided_by_position := (SELECT position FROM users WHERE id = NEW.decided_by);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_framework_agreement_approval_position ON framework_agreement_approvals;
CREATE TRIGGER trg_framework_agreement_approval_position BEFORE INSERT ON framework_agreement_approvals
  FOR EACH ROW EXECUTE FUNCTION framework_agreement_approval_position();

-- ----------------------------------------------------------------------------
-- Validation
-- ----------------------------------------------------------------------------
-- Projets dont le chef doit encore valider (tour en cours) : projets listés ayant un chef actif qui n'est pas l'auteur,
-- sans décision APPROVED dans ce tour
CREATE OR REPLACE FUNCTION framework_agreement_pending_projects(p_agreement UUID) RETURNS SETOF UUID AS $$
  SELECT fp.project_id
  FROM framework_agreements a
  JOIN framework_agreement_projects fp ON fp.agreement_id = a.id
  JOIN projects p ON p.id = fp.project_id
  JOIN users pm ON pm.id = p.project_manager_id AND pm.is_active
  WHERE a.id = p_agreement AND pm.id IS DISTINCT FROM a.created_by
    AND NOT EXISTS (SELECT 1 FROM framework_agreement_approvals ap
                    WHERE ap.agreement_id = a.id AND ap.round = a.submission_round AND ap.step = 'PROJECT_MANAGER'
                      AND ap.project_id = fp.project_id AND ap.decision = 'APPROVED')
$$ LANGUAGE sql STABLE;

-- L'utilisateur peut décider maintenant : contrat en attente, jamais l'auteur ; étape chef de projet tant qu'un projet
-- attend (chef ou intérimaire de ce projet), puis directeur général (prof_dg actif de l'entreprise)
CREATE OR REPLACE FUNCTION user_can_validate_framework_agreement(p_user UUID, p_agreement UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM framework_agreements a
    WHERE a.id = p_agreement AND a.status = 'PENDING_VALIDATION' AND a.created_by IS DISTINCT FROM p_user
      AND CASE
            WHEN EXISTS (SELECT 1 FROM framework_agreement_pending_projects(a.id))
              THEN EXISTS (SELECT 1 FROM framework_agreement_pending_projects(a.id) x(project_id) WHERE user_manages_project(p_user, x.project_id))
            ELSE EXISTS (SELECT 1 FROM users u JOIN user_profiles up ON up.user_id = u.id AND up.profile_id = 'prof_dg'
                         WHERE u.id = p_user AND u.is_active AND u.enterprise_id = a.enterprise_id)
          END
  )
$$ LANGUAGE sql STABLE;

-- ----------------------------------------------------------------------------
-- Consommation : bons de commande actifs liés au contrat (rejetés / annulés exclus ; reliquat soldé = quantité
-- acceptée × prix), par ligne du bordereau et au total
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_framework_agreement_po_lines AS
  SELECT po.framework_agreement_id AS agreement_id, po.id AS purchase_order_id, poi.id AS po_item_id, poi.framework_item_id,
         COALESCE(poi.quantity, 0) AS quantity,
         CASE WHEN po.delivery_closed_at IS NOT NULL
              THEN COALESCE((SELECT d.quantity_accepted FROM v_po_item_delivery d WHERE d.po_item_id = poi.id), 0) * COALESCE(poi.unit_price, 0)
              ELSE COALESCE(poi.total_amount, poi.quantity * COALESCE(poi.unit_price, 0)) END AS amount
  FROM purchase_orders po
  JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
  WHERE po.framework_agreement_id IS NOT NULL
    AND po.status NOT IN ('PO_REJECTED', 'PO_CANCELLED', 'CANCELLED', 'REJECTED');

CREATE OR REPLACE FUNCTION framework_agreement_consumed(p_agreement UUID) RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(amount), 0) FROM v_framework_agreement_po_lines WHERE agreement_id = p_agreement
$$ LANGUAGE sql STABLE;

-- ----------------------------------------------------------------------------
-- Permissions : gérer (achats, admin) ; consulter (finance, direction, DG, managers, réviseur, auditeur)
-- La validation ne dépend pas d'une permission : chef du projet (ou intérimaire) puis profil prof_dg
-- ----------------------------------------------------------------------------
INSERT INTO permissions (id, name, description, resource, action)
SELECT 'perm_manage_framework_agreements', 'MANAGE_FRAMEWORK_AGREEMENTS', 'Saisir, soumettre, suspendre et clôturer les accords-cadres', 'framework_agreements', 'manage'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'MANAGE_FRAMEWORK_AGREEMENTS');
INSERT INTO permissions (id, name, description, resource, action)
SELECT 'perm_view_framework_agreements', 'VIEW_FRAMEWORK_AGREEMENTS', 'Consulter les accords-cadres et leur consommation', 'framework_agreements', 'view'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'VIEW_FRAMEWORK_AGREEMENTS');

INSERT INTO profile_permissions (profile_id, permission_id) SELECT pr.id, p.id FROM (VALUES ('prof_admin', 'MANAGE_FRAMEWORK_AGREEMENTS'), ('prof_procurement', 'MANAGE_FRAMEWORK_AGREEMENTS'), ('prof_admin', 'VIEW_FRAMEWORK_AGREEMENTS'), ('prof_procurement', 'VIEW_FRAMEWORK_AGREEMENTS'), ('prof_finance', 'VIEW_FRAMEWORK_AGREEMENTS'), ('prof_dg', 'VIEW_FRAMEWORK_AGREEMENTS'), ('prof_management', 'VIEW_FRAMEWORK_AGREEMENTS'), ('prof_manager', 'VIEW_FRAMEWORK_AGREEMENTS'), ('prof_manager_n2', 'VIEW_FRAMEWORK_AGREEMENTS'), ('prof_manager_n3', 'VIEW_FRAMEWORK_AGREEMENTS'), ('prof_po_reviewer', 'VIEW_FRAMEWORK_AGREEMENTS'), ('prof_auditor', 'VIEW_FRAMEWORK_AGREEMENTS')) AS pr(id, perm) JOIN permissions p ON p.name = pr.perm WHERE EXISTS (SELECT 1 FROM profiles WHERE id = pr.id) AND NOT EXISTS (SELECT 1 FROM profile_permissions pp WHERE pp.profile_id = pr.id AND pp.permission_id = p.id);

-- ----------------------------------------------------------------------------
-- Alertes (une seule fois par contrat) : 80 % du plafond consommé, 30 jours avant l'échéance
-- ----------------------------------------------------------------------------
ALTER TABLE framework_agreements ADD COLUMN IF NOT EXISTS ceiling_alert_sent_at TIMESTAMPTZ;
ALTER TABLE framework_agreements ADD COLUMN IF NOT EXISTS expiry_alert_sent_at TIMESTAMPTZ;
