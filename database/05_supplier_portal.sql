-- ============================================
-- PORTAIL FOURNISSEUR & APPELS D'OFFRES
-- Idempotent : peut être rejoué sur une base existante.
-- ============================================

-- Compte fournisseur (auto-inscription) + logo
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS logo_path VARCHAR(500);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_name VARCHAR(150);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS self_registered BOOLEAN DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_user ON suppliers(user_id) WHERE user_id IS NOT NULL;

-- Appel d'offres (un par réquisition classée RFP)
-- tender_number est saisi par l'agent procurement à la création
CREATE TABLE IF NOT EXISTS tenders (
    id SERIAL PRIMARY KEY,
    tender_number VARCHAR(50) UNIQUE NOT NULL,
    requisition_id UUID NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
    task_id VARCHAR(64),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    max_delivery_days INTEGER NOT NULL CHECK (max_delivery_days > 0),
    status VARCHAR(30) DEFAULT 'OPEN',            -- OPEN, AWARDED, CANCELLED
    awarded_supplier_id INTEGER REFERENCES suppliers(id),
    awarded_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT tenders_dates_check CHECK (end_date > start_date)
);

-- Soumission d'un fournisseur (modifiable jusqu'à end_date)
CREATE TABLE IF NOT EXISTS tender_submissions (
    id SERIAL PRIMARY KEY,
    tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    delivery_days INTEGER NOT NULL CHECK (delivery_days > 0),
    total_amount DECIMAL(19,4) DEFAULT 0,
    notes TEXT,
    submitted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tender_id, supplier_id)
);

-- Prix par item de la réquisition
CREATE TABLE IF NOT EXISTS tender_submission_items (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL REFERENCES tender_submissions(id) ON DELETE CASCADE,
    requisition_item_id INTEGER NOT NULL REFERENCES requisition_items(id) ON DELETE CASCADE,
    unit_price DECIMAL(19,4) NOT NULL CHECK (unit_price >= 0),
    total_price DECIMAL(19,4) NOT NULL,
    comment TEXT,
    UNIQUE (submission_id, requisition_item_id)
);

-- Bases créées avant le passage en TIMESTAMPTZ
ALTER TABLE tenders ALTER COLUMN start_date TYPE TIMESTAMPTZ, ALTER COLUMN end_date TYPE TIMESTAMPTZ,
    ALTER COLUMN awarded_at TYPE TIMESTAMPTZ, ALTER COLUMN created_at TYPE TIMESTAMPTZ, ALTER COLUMN updated_at TYPE TIMESTAMPTZ;
ALTER TABLE tender_submissions ALTER COLUMN submitted_at TYPE TIMESTAMPTZ, ALTER COLUMN updated_at TYPE TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tenders_requisition ON tenders(requisition_id);
CREATE INDEX IF NOT EXISTS idx_tenders_dates ON tenders(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_tender_submissions_tender ON tender_submissions(tender_id);
CREATE INDEX IF NOT EXISTS idx_tender_submissions_supplier ON tender_submissions(supplier_id);

-- Permissions & profil fournisseur
INSERT INTO permissions (id, name, description, resource, action)
SELECT * FROM (VALUES
    ('perm_manage_tenders', 'MANAGE_TENDERS', 'Gérer les appels d''offres', 'tender', 'write'),
    ('perm_supplier_portal', 'SUPPLIER_PORTAL', 'Accès au portail fournisseur', 'tender', 'submit')
) AS tmp(id, name, description, resource, action)
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = tmp.name);

INSERT INTO profiles (id, name, description)
SELECT 'prof_supplier', 'Fournisseur', 'Fournisseur inscrit : répond aux appels d''offres'
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'prof_supplier');

INSERT INTO profile_permissions (profile_id, permission_id)
SELECT 'prof_supplier', p.id FROM permissions p
WHERE p.name = 'SUPPLIER_PORTAL'
AND NOT EXISTS (SELECT 1 FROM profile_permissions pp WHERE pp.profile_id = 'prof_supplier' AND pp.permission_id = p.id);

INSERT INTO profile_permissions (profile_id, permission_id)
SELECT pr.id, p.id FROM permissions p
CROSS JOIN (VALUES ('prof_procurement'), ('prof_admin')) AS pr(id)
WHERE p.name = 'MANAGE_TENDERS'
AND EXISTS (SELECT 1 FROM profiles WHERE id = pr.id)
AND NOT EXISTS (SELECT 1 FROM profile_permissions pp WHERE pp.profile_id = pr.id AND pp.permission_id = p.id);
