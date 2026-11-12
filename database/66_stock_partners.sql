-- ============================================
-- PARTENAIRES ET TRANSFERTS DE STOCK VERS UN PARTENAIRE (2026-11-12)
-- Choix de l'utilisateur :
--   - partenaires PAR ENTREPRISE (comme les dépôts), rattachés à une localisation de la plateforme, code unique par entreprise
--   - comptes de l'espace partenaire créés par l'entreprise depuis la fiche (un ou plusieurs par partenaire,
--     mot de passe envoyé par email) — profil prof_partner, sans entreprise (comme un fournisseur), users.partner_id
--   - bon de sortie de type PARTNER : le stock SORT à l'expédition (mouvement ISSUE) ; le partenaire confirme la réception
--     ligne par ligne (quantité reçue, manque = perte en transit ; équipement non reçu → LOST) depuis son espace
--     (ou le magasinier l'enregistre pour lui, réception signée sur papier : acknowledgement_source = STORE)
--   - équipements à n° de série : « chez le partenaire » (statut AT_PARTNER), récupérables par un bon de retour
-- Idempotent : peut être rejoué.
-- ============================================

-- 1. Partenaires
CREATE TABLE IF NOT EXISTS partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enterprise_id UUID NOT NULL REFERENCES enterprise(id),
    location_id INTEGER NOT NULL REFERENCES locations(id),
    code VARCHAR(30) NOT NULL,
    name VARCHAR(200) NOT NULL,
    address TEXT,
    contact_name VARCHAR(150),
    contact_title VARCHAR(150),
    phone VARCHAR(50),
    email VARCHAR(150),
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Type de partenaire (ex. zone de santé) ; contact_* = responsable du partenaire (son compte se crée depuis la fiche)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS partner_type VARCHAR(30) NOT NULL DEFAULT 'OTHER';
ALTER TABLE partners DROP CONSTRAINT IF EXISTS partners_type_check;
ALTER TABLE partners ADD CONSTRAINT partners_type_check CHECK (partner_type IN ('HEALTH_ZONE', 'HEALTH_FACILITY', 'NGO', 'GOVERNMENT', 'OTHER'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_partners_enterprise_code ON partners (enterprise_id, UPPER(code));
CREATE INDEX IF NOT EXISTS idx_partners_location ON partners (location_id);
CREATE INDEX IF NOT EXISTS idx_partners_enterprise_name ON partners (enterprise_id, name);
CREATE INDEX IF NOT EXISTS trgm_partners_name ON partners USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_partners_code ON partners USING gin (code gin_trgm_ops);

-- 2. Comptes de l'espace partenaire (users.enterprise_id reste NULL : ces comptes n'apparaissent dans aucune liste
--    d'utilisateurs de l'entreprise ; l'entreprise est celle du partenaire)
ALTER TABLE users ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES partners(id);
CREATE INDEX IF NOT EXISTS idx_users_partner ON users (partner_id) WHERE partner_id IS NOT NULL;

-- 3. Bons de sortie vers un partenaire
ALTER TABLE stock_issues ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES partners(id);
-- Réception confirmée par le partenaire dans son espace (PORTAL) ou enregistrée par le magasin (STORE, papier signé)
ALTER TABLE stock_issues ADD COLUMN IF NOT EXISTS acknowledgement_source VARCHAR(20);
CREATE INDEX IF NOT EXISTS idx_stock_issues_partner ON stock_issues (partner_id, issued_at DESC) WHERE partner_id IS NOT NULL;

ALTER TABLE stock_issues DROP CONSTRAINT IF EXISTS stock_issues_destination_check;
ALTER TABLE stock_issues ADD CONSTRAINT stock_issues_destination_check CHECK (
    (destination_type = 'USER' AND recipient_id IS NOT NULL AND destination_warehouse_id IS NULL AND department_id IS NULL AND partner_id IS NULL)
 OR (destination_type = 'WAREHOUSE' AND destination_warehouse_id IS NOT NULL AND destination_warehouse_id <> warehouse_id
     AND recipient_id IS NULL AND department_id IS NULL AND partner_id IS NULL)
 OR (destination_type = 'DEPARTMENT' AND department_id IS NOT NULL AND destination_warehouse_id IS NULL AND partner_id IS NULL)
 OR (destination_type = 'PARTNER' AND partner_id IS NOT NULL AND recipient_id IS NULL AND destination_warehouse_id IS NULL AND department_id IS NULL));

ALTER TABLE stock_issues DROP CONSTRAINT IF EXISTS stock_issues_ack_source_check;
ALTER TABLE stock_issues ADD CONSTRAINT stock_issues_ack_source_check CHECK (acknowledgement_source IS NULL OR acknowledgement_source IN ('PORTAL', 'STORE'));

-- Cohérence : dépôts, bénéficiaire, département, partenaire et projet de la même entreprise que le bon
CREATE OR REPLACE FUNCTION stock_issue_check() RETURNS trigger AS $$
BEGIN
  IF (SELECT enterprise_id FROM warehouses WHERE id = NEW.warehouse_id) IS DISTINCT FROM NEW.enterprise_id
     OR (NEW.recipient_id IS NOT NULL AND (SELECT enterprise_id FROM users WHERE id = NEW.recipient_id) IS DISTINCT FROM NEW.enterprise_id)
     OR (NEW.destination_warehouse_id IS NOT NULL AND (SELECT enterprise_id FROM warehouses WHERE id = NEW.destination_warehouse_id) IS DISTINCT FROM NEW.enterprise_id)
     OR (NEW.department_id IS NOT NULL AND (SELECT enterprise_id FROM departments WHERE id = NEW.department_id) IS DISTINCT FROM NEW.enterprise_id)
     OR (NEW.partner_id IS NOT NULL AND (SELECT enterprise_id FROM partners WHERE id = NEW.partner_id) IS DISTINCT FROM NEW.enterprise_id)
     OR (NEW.project_id IS NOT NULL AND (SELECT enterprise_id FROM projects WHERE id = NEW.project_id) IS DISTINCT FROM NEW.enterprise_id) THEN
    RAISE EXCEPTION 'stock_issues : dépôts, bénéficiaire, département, partenaire et projet doivent appartenir à l''entreprise du bon';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Équipements chez un partenaire (AT_PARTNER) ; en transit vers un partenaire : IN_TRANSIT + partner_id
ALTER TABLE stock_units ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES partners(id);
CREATE INDEX IF NOT EXISTS idx_stock_units_partner ON stock_units (partner_id) WHERE partner_id IS NOT NULL;
ALTER TABLE stock_units DROP CONSTRAINT IF EXISTS stock_units_status_check;
ALTER TABLE stock_units ADD CONSTRAINT stock_units_status_check CHECK (status IN ('IN_STOCK', 'ASSIGNED', 'IN_TRANSIT', 'AT_PARTNER', 'LOST', 'RETIRED', 'VOID'));
ALTER TABLE stock_units DROP CONSTRAINT IF EXISTS stock_units_location_check;
ALTER TABLE stock_units ADD CONSTRAINT stock_units_location_check CHECK (
    (status = 'IN_STOCK' AND warehouse_id IS NOT NULL AND holder_id IS NULL AND department_id IS NULL AND partner_id IS NULL)
 OR (status = 'ASSIGNED' AND warehouse_id IS NULL AND (holder_id IS NOT NULL) <> (department_id IS NOT NULL) AND partner_id IS NULL)
 OR (status = 'AT_PARTNER' AND warehouse_id IS NULL AND holder_id IS NULL AND department_id IS NULL AND partner_id IS NOT NULL)
 OR (status = 'IN_TRANSIT' AND warehouse_id IS NULL AND holder_id IS NULL AND department_id IS NULL)
 OR (status IN ('LOST', 'RETIRED', 'VOID') AND warehouse_id IS NULL AND holder_id IS NULL AND department_id IS NULL AND partner_id IS NULL));

-- 5. Retours depuis un partenaire (exactement un détenteur : employé, département ou partenaire)
ALTER TABLE stock_returns ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES partners(id);
CREATE INDEX IF NOT EXISTS idx_stock_returns_partner ON stock_returns (partner_id) WHERE partner_id IS NOT NULL;
ALTER TABLE stock_returns DROP CONSTRAINT IF EXISTS stock_returns_source_check;
ALTER TABLE stock_returns ADD CONSTRAINT stock_returns_source_check CHECK (num_nonnulls(returned_by, department_id, partner_id) = 1);

-- 6. Profil et permissions
INSERT INTO profiles (id, name, description)
SELECT 'prof_partner', 'Partenaire', 'Compte d''un partenaire : confirme dans son espace la réception des articles qui lui sont transférés'
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'prof_partner');

INSERT INTO permissions (id, name, description, resource, action)
SELECT 'perm_partner_portal', 'PARTNER_PORTAL', 'Espace partenaire : transferts reçus et confirmation de leur réception', 'partner_portal', 'access'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'PARTNER_PORTAL');
INSERT INTO permissions (id, name, description, resource, action)
SELECT 'perm_manage_partners', 'MANAGE_PARTNERS', 'Enregistrer les partenaires et leur donner accès à l''espace partenaire', 'stock', 'manage_partners'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'MANAGE_PARTNERS');

INSERT INTO profile_permissions (profile_id, permission_id)
SELECT pr.id, p.id FROM (VALUES ('prof_partner', 'PARTNER_PORTAL'), ('prof_admin', 'MANAGE_PARTNERS'), ('prof_logistic', 'MANAGE_PARTNERS')) AS pr(id, perm)
JOIN permissions p ON p.name = pr.perm
WHERE EXISTS (SELECT 1 FROM profiles WHERE id = pr.id)
  AND NOT EXISTS (SELECT 1 FROM profile_permissions pp WHERE pp.profile_id = pr.id AND pp.permission_id = p.id);
