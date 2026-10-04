-- ============================================
-- procureApp — MULTI-ENTREPRISE
-- Chaque donnée métier appartient à une entreprise (enterprise_id).
-- Les fournisseurs restent partagés entre toutes les entreprises.
-- Idempotent : peut être rejoué.
-- ============================================

-- 1. Informations de l'entreprise
ALTER TABLE enterprise ADD COLUMN IF NOT EXISTS logo_path VARCHAR(500);
ALTER TABLE enterprise ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE enterprise ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE enterprise ADD COLUMN IF NOT EXISTS email VARCHAR(150);
ALTER TABLE enterprise ADD COLUMN IF NOT EXISTS website VARCHAR(200);
ALTER TABLE enterprise ADD COLUMN IF NOT EXISTS tax_id VARCHAR(100);
ALTER TABLE enterprise ADD COLUMN IF NOT EXISTS registration_number VARCHAR(100);
ALTER TABLE enterprise ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_enterprise_code ON enterprise (LOWER(code)) WHERE code IS NOT NULL;

-- 2. Rattachement des données métier
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['departments','projects','budget_allocations','requisitions','purchase_orders',
                           'goods_receipt_notes','service_acceptance_notes','invoices','payments','tenders',
                           'supplier_evaluations']
  LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprise(id)', t);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (enterprise_id)', 'idx_' || t || '_enterprise', t);
    END IF;
  END LOOP;
END $$;

-- 3. Données sans entreprise → première entreprise (WWF). Rappelé à la fin de data.sql.
CREATE OR REPLACE FUNCTION procureapp_assign_orphans() RETURNS void AS $$
DECLARE first_ent UUID;
BEGIN
  SELECT id INTO first_ent FROM enterprise ORDER BY created_at LIMIT 1;
  IF first_ent IS NULL THEN RETURN; END IF;

  -- utilisateurs internes (pas les comptes fournisseurs, partagés)
  UPDATE users u SET enterprise_id = first_ent
  WHERE u.enterprise_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM user_profiles up WHERE up.user_id = u.id AND up.profile_id IN ('prof_supplier', 'prof_superadmin'));

  UPDATE departments SET enterprise_id = first_ent WHERE enterprise_id IS NULL;
  UPDATE projects SET enterprise_id = first_ent WHERE enterprise_id IS NULL;
  UPDATE budget_allocations b SET enterprise_id = COALESCE(p.enterprise_id, first_ent)
    FROM projects p WHERE b.enterprise_id IS NULL AND p.id = b.project_id;
  UPDATE budget_allocations SET enterprise_id = first_ent WHERE enterprise_id IS NULL;
  UPDATE requisitions r SET enterprise_id = COALESCE(p.enterprise_id, first_ent)
    FROM projects p WHERE r.enterprise_id IS NULL AND p.id = r.project_id;
  UPDATE requisitions SET enterprise_id = first_ent WHERE enterprise_id IS NULL;
  UPDATE purchase_orders po SET enterprise_id = r.enterprise_id
    FROM requisitions r WHERE po.enterprise_id IS NULL AND r.id = po.requisition_id;
  UPDATE purchase_orders SET enterprise_id = first_ent WHERE enterprise_id IS NULL;
  UPDATE goods_receipt_notes g SET enterprise_id = po.enterprise_id
    FROM purchase_orders po WHERE g.enterprise_id IS NULL AND po.id = g.po_id;
  UPDATE goods_receipt_notes SET enterprise_id = first_ent WHERE enterprise_id IS NULL;
  UPDATE service_acceptance_notes s SET enterprise_id = po.enterprise_id
    FROM purchase_orders po WHERE s.enterprise_id IS NULL AND po.id = s.po_id;
  UPDATE service_acceptance_notes SET enterprise_id = first_ent WHERE enterprise_id IS NULL;
  UPDATE invoices i SET enterprise_id = po.enterprise_id
    FROM purchase_orders po WHERE i.enterprise_id IS NULL AND po.id = i.po_id;
  UPDATE invoices SET enterprise_id = first_ent WHERE enterprise_id IS NULL;
  UPDATE payments pa SET enterprise_id = i.enterprise_id
    FROM invoices i WHERE pa.enterprise_id IS NULL AND i.id = pa.invoice_id;
  UPDATE payments SET enterprise_id = first_ent WHERE enterprise_id IS NULL;
  IF to_regclass('tenders') IS NOT NULL THEN
    UPDATE tenders t SET enterprise_id = r.enterprise_id
      FROM requisitions r WHERE t.enterprise_id IS NULL AND r.id = t.requisition_id;
  END IF;
  UPDATE supplier_evaluations SET enterprise_id = first_ent WHERE enterprise_id IS NULL;
END;
$$ LANGUAGE plpgsql;

SELECT procureapp_assign_orphans();

-- 4. Remplissage automatique de enterprise_id à l'insertion (depuis le parent)
--    → les chemins de création existants (contrôleurs, workers Camunda) n'ont pas à changer.
CREATE OR REPLACE FUNCTION fill_enterprise_id() RETURNS trigger AS $$
BEGIN
  IF NEW.enterprise_id IS NOT NULL THEN RETURN NEW; END IF;
  CASE TG_TABLE_NAME
    WHEN 'departments' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM users WHERE id = NEW.created_by;
    WHEN 'projects' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM users WHERE id = NEW.created_by;
    WHEN 'budget_allocations' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM projects WHERE id = NEW.project_id;
    WHEN 'requisitions' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM projects WHERE id = NEW.project_id;
      IF NEW.enterprise_id IS NULL THEN
        SELECT enterprise_id INTO NEW.enterprise_id FROM users WHERE id = NEW.requester_id;
      END IF;
    WHEN 'purchase_orders' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM requisitions WHERE id = NEW.requisition_id;
      IF NEW.enterprise_id IS NULL THEN
        SELECT enterprise_id INTO NEW.enterprise_id FROM users WHERE id = NEW.created_by;
      END IF;
    WHEN 'goods_receipt_notes', 'service_acceptance_notes', 'invoices' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM purchase_orders WHERE id = NEW.po_id;
    WHEN 'payments' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM invoices WHERE id = NEW.invoice_id;
      IF NEW.enterprise_id IS NULL THEN
        SELECT enterprise_id INTO NEW.enterprise_id FROM purchase_orders WHERE id = NEW.po_id;
      END IF;
    WHEN 'tenders' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM requisitions WHERE id = NEW.requisition_id;
    WHEN 'supplier_evaluations' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM users WHERE id = NEW.evaluator_id;
    ELSE NULL;
  END CASE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['departments','projects','budget_allocations','requisitions','purchase_orders',
                           'goods_receipt_notes','service_acceptance_notes','invoices','payments','tenders',
                           'supplier_evaluations']
  LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_fill_enterprise ON %I', t);
      EXECUTE format('CREATE TRIGGER trg_fill_enterprise BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION fill_enterprise_id()', t);
    END IF;
  END LOOP;
END $$;

-- 5. Codes de département / projet uniques PAR entreprise (et non plus globalement)
ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_enterprise_code ON departments (enterprise_id, code);
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_enterprise_code ON projects (enterprise_id, code);

-- 6. Super administrateur de la plateforme (gère les entreprises, ne fait pas d'achats)
INSERT INTO profiles (id, name, description)
SELECT 'prof_superadmin', 'Super administrateur procureApp', 'Gère les entreprises de la plateforme'
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'prof_superadmin');

INSERT INTO profile_permissions (profile_id, permission_id)
SELECT 'prof_superadmin', p.id FROM permissions p
WHERE p.name = 'MANAGE_ENTERPRISES'
AND NOT EXISTS (SELECT 1 FROM profile_permissions pp WHERE pp.profile_id = 'prof_superadmin' AND pp.permission_id = p.id);

-- 7. Comptes fournisseurs : partagés, rattachés à aucune entreprise
UPDATE users u SET enterprise_id = NULL
WHERE u.enterprise_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM user_profiles up WHERE up.user_id = u.id AND up.profile_id = 'prof_supplier')
  AND NOT EXISTS (SELECT 1 FROM user_profiles up WHERE up.user_id = u.id AND up.profile_id <> 'prof_supplier');

-- 8. Numéro d'appel d'offres unique PAR entreprise (saisi par le procurement)
ALTER TABLE tenders DROP CONSTRAINT IF EXISTS tenders_tender_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenders_enterprise_number ON tenders (enterprise_id, LOWER(tender_number));
