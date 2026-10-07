-- ============================================
-- SORTIES DE STOCK VERS UN UTILISATEUR (bons de sortie)
-- - La logistique remet des articles d'un dépôt (auquel elle a accès) à un utilisateur de l'entreprise,
--   éventuellement pour un projet ; le stock diminue immédiatement (mouvements ISSUE, lots FEFO)
-- - Le bénéficiaire confirme la réception (accusé) ; annulation = écritures inverses ISSUE_REVERSAL
-- Idempotent : peut être rejoué sur une base existante (après 13_stock_management.sql).
-- ============================================

-- 1. Nouveau type de mouvement : annulation d'une sortie (entrée)
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check CHECK (movement_type IN
    ('OPENING', 'RECEIPT', 'RECEIPT_REVERSAL', 'ISSUE', 'ISSUE_REVERSAL', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT'));
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_sign_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_sign_check CHECK (
    (movement_type IN ('OPENING', 'RECEIPT', 'ISSUE_REVERSAL', 'TRANSFER_IN', 'ADJUSTMENT_IN') AND quantity > 0)
 OR (movement_type IN ('RECEIPT_REVERSAL', 'ISSUE', 'TRANSFER_OUT', 'ADJUSTMENT_OUT') AND quantity < 0));

-- 2. Bons de sortie
CREATE SEQUENCE IF NOT EXISTS stock_issue_seq;

CREATE TABLE IF NOT EXISTS stock_issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_number VARCHAR(30) NOT NULL UNIQUE
        DEFAULT ('SOR-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(NEXTVAL('stock_issue_seq')::TEXT, 5, '0')),
    enterprise_id UUID NOT NULL REFERENCES enterprise(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    recipient_id UUID NOT NULL REFERENCES users(id),
    project_id UUID REFERENCES projects(id),
    purpose TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'ISSUED',
    issued_by UUID REFERENCES users(id) ON DELETE SET NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at TIMESTAMPTZ,
    acknowledgement_comment TEXT,
    cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    CONSTRAINT stock_issues_status_check CHECK (status IN ('ISSUED', 'CANCELLED'))
);
CREATE INDEX IF NOT EXISTS idx_stock_issues_enterprise ON stock_issues (enterprise_id, issued_at);
CREATE INDEX IF NOT EXISTS idx_stock_issues_recipient ON stock_issues (recipient_id, issued_at);
CREATE INDEX IF NOT EXISTS idx_stock_issues_warehouse ON stock_issues (warehouse_id);

CREATE TABLE IF NOT EXISTS stock_issue_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id UUID NOT NULL REFERENCES stock_issues(id) ON DELETE CASCADE,
    stock_item_id UUID NOT NULL REFERENCES stock_items(id),
    lot_id UUID REFERENCES stock_lots(id),
    quantity DECIMAL(19,4) NOT NULL CHECK (quantity > 0),
    stock_movement_id UUID REFERENCES stock_movements(id),
    reversal_movement_id UUID REFERENCES stock_movements(id)
);
CREATE INDEX IF NOT EXISTS idx_stock_issue_lines_issue ON stock_issue_lines (issue_id);
CREATE INDEX IF NOT EXISTS idx_stock_issue_lines_item ON stock_issue_lines (stock_item_id);

-- 3. Multi-entreprise : enterprise_id du bon = celui du dépôt
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
    WHEN 'warehouses', 'stock_items' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM users WHERE id = NEW.created_by;
    WHEN 'stock_lots' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM stock_items WHERE id = NEW.stock_item_id;
    WHEN 'stock_issues' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM warehouses WHERE id = NEW.warehouse_id;
    ELSE NULL;
  END CASE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fill_enterprise ON stock_issues;
CREATE TRIGGER trg_fill_enterprise BEFORE INSERT ON stock_issues FOR EACH ROW EXECUTE FUNCTION fill_enterprise_id();

-- Cohérence : dépôt, bénéficiaire et projet de la même entreprise que le bon
CREATE OR REPLACE FUNCTION stock_issue_check() RETURNS trigger AS $$
BEGIN
  IF (SELECT enterprise_id FROM warehouses WHERE id = NEW.warehouse_id) IS DISTINCT FROM NEW.enterprise_id
     OR (SELECT enterprise_id FROM users WHERE id = NEW.recipient_id) IS DISTINCT FROM NEW.enterprise_id
     OR (NEW.project_id IS NOT NULL AND (SELECT enterprise_id FROM projects WHERE id = NEW.project_id) IS DISTINCT FROM NEW.enterprise_id) THEN
    RAISE EXCEPTION 'stock_issues : dépôt, bénéficiaire et projet doivent appartenir à l''entreprise du bon';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_issue_check ON stock_issues;
CREATE TRIGGER trg_stock_issue_check BEFORE INSERT ON stock_issues FOR EACH ROW EXECUTE FUNCTION stock_issue_check();

-- 4. Permission : établir / annuler une sortie (logistique, admin d'entreprise)
INSERT INTO permissions (id, name, description, resource, action)
SELECT 'perm_issue_stock', 'ISSUE_STOCK', 'Sortir des articles du stock vers un utilisateur', 'stock', 'issue'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ISSUE_STOCK');

INSERT INTO profile_permissions (profile_id, permission_id)
SELECT pr.id, p.id FROM (VALUES ('prof_admin'), ('prof_logistic')) AS pr(id)
JOIN permissions p ON p.name = 'ISSUE_STOCK'
WHERE EXISTS (SELECT 1 FROM profiles WHERE id = pr.id)
  AND NOT EXISTS (SELECT 1 FROM profile_permissions pp WHERE pp.profile_id = pr.id AND pp.permission_id = p.id);
