-- ============================================
-- ÉQUIPEMENTS AFFECTÉS AUX EMPLOYÉS (n° de série) ET RETOURS EN STOCK
-- - stock_items.track_serials : article suivi unité par unité (ordinateur, GPS, téléphone…)
-- - stock_units : une ligne par unité (n° de série, n° d'inventaire), statut IN_STOCK / ASSIGNED / LOST /
--   RETIRED / VOID, état GOOD / DAMAGED, dépôt (en stock) ou détenteur (affecté)
-- - Affectation = bon de sortie (stock_issue_lines.unit_id) ; retour = bon de retour (stock_returns) :
--   l'unité revient en stock (bon état / endommagée) ou est déclarée perdue ; marche aussi pour les consommables
-- - Départ d'un employé : désactivation refusée tant qu'il détient du matériel (sauf forçage explicite)
-- Idempotent : peut être rejoué sur une base existante (après 14_stock_issues.sql).
-- ============================================

-- 1. Articles suivis par n° de série (exclusif du suivi par lot)
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS track_serials BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE stock_items DROP CONSTRAINT IF EXISTS stock_items_serials_check;
ALTER TABLE stock_items ADD CONSTRAINT stock_items_serials_check CHECK (NOT track_serials OR (is_stockable AND NOT track_lots));

-- 2. Unités
CREATE TABLE IF NOT EXISTS stock_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enterprise_id UUID NOT NULL REFERENCES enterprise(id),
    stock_item_id UUID NOT NULL REFERENCES stock_items(id),
    serial_number VARCHAR(100) NOT NULL,
    asset_tag VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'IN_STOCK',
    condition VARCHAR(20) NOT NULL DEFAULT 'GOOD',
    warehouse_id UUID REFERENCES warehouses(id),
    holder_id UUID REFERENCES users(id),
    grn_item_id INTEGER REFERENCES goods_receipt_items(id) ON DELETE SET NULL,
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT stock_units_status_check CHECK (status IN ('IN_STOCK', 'ASSIGNED', 'LOST', 'RETIRED', 'VOID')),
    CONSTRAINT stock_units_condition_check CHECK (condition IN ('GOOD', 'DAMAGED')),
    -- En stock : dans un dépôt, sans détenteur ; affectée : un détenteur, hors dépôt
    CONSTRAINT stock_units_location_check CHECK (
        (status = 'IN_STOCK' AND warehouse_id IS NOT NULL AND holder_id IS NULL)
     OR (status = 'ASSIGNED' AND holder_id IS NOT NULL AND warehouse_id IS NULL)
     OR (status IN ('LOST', 'RETIRED', 'VOID') AND warehouse_id IS NULL AND holder_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_units_serial ON stock_units (stock_item_id, UPPER(serial_number)) WHERE status <> 'VOID';
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_units_asset_tag ON stock_units (enterprise_id, UPPER(asset_tag)) WHERE asset_tag IS NOT NULL AND status <> 'VOID';
CREATE INDEX IF NOT EXISTS idx_stock_units_holder ON stock_units (holder_id) WHERE holder_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_units_item ON stock_units (stock_item_id, status);
CREATE INDEX IF NOT EXISTS idx_stock_units_warehouse ON stock_units (warehouse_id) WHERE warehouse_id IS NOT NULL;

-- 3. Mouvements : unité concernée + type RETURN (retour en stock)
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES stock_units(id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_unit ON stock_movements (unit_id) WHERE unit_id IS NOT NULL;
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check CHECK (movement_type IN
    ('OPENING', 'RECEIPT', 'RECEIPT_REVERSAL', 'ISSUE', 'ISSUE_REVERSAL', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT'));
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_sign_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_sign_check CHECK (
    (movement_type IN ('OPENING', 'RECEIPT', 'ISSUE_REVERSAL', 'RETURN', 'TRANSFER_IN', 'ADJUSTMENT_IN') AND quantity > 0)
 OR (movement_type IN ('RECEIPT_REVERSAL', 'ISSUE', 'TRANSFER_OUT', 'ADJUSTMENT_OUT') AND quantity < 0));

-- 4. Lignes de sortie : unité affectée, quantité déjà rendue
ALTER TABLE stock_issue_lines ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES stock_units(id);
ALTER TABLE stock_issue_lines ADD COLUMN IF NOT EXISTS returned_quantity DECIMAL(19,4) NOT NULL DEFAULT 0;
ALTER TABLE stock_issue_lines DROP CONSTRAINT IF EXISTS stock_issue_lines_returned_check;
ALTER TABLE stock_issue_lines ADD CONSTRAINT stock_issue_lines_returned_check CHECK (returned_quantity >= 0 AND returned_quantity <= quantity);
CREATE INDEX IF NOT EXISTS idx_stock_issue_lines_unit ON stock_issue_lines (unit_id) WHERE unit_id IS NOT NULL;

-- 5. Bons de retour
CREATE SEQUENCE IF NOT EXISTS stock_return_seq;

CREATE TABLE IF NOT EXISTS stock_returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_number VARCHAR(30) NOT NULL UNIQUE
        DEFAULT ('RET-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(NEXTVAL('stock_return_seq')::TEXT, 5, '0')),
    enterprise_id UUID NOT NULL REFERENCES enterprise(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    returned_by UUID NOT NULL REFERENCES users(id),
    received_by UUID REFERENCES users(id) ON DELETE SET NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    comment TEXT
);
CREATE INDEX IF NOT EXISTS idx_stock_returns_enterprise ON stock_returns (enterprise_id, received_at);
CREATE INDEX IF NOT EXISTS idx_stock_returns_user ON stock_returns (returned_by);

CREATE TABLE IF NOT EXISTS stock_return_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id UUID NOT NULL REFERENCES stock_returns(id) ON DELETE CASCADE,
    issue_line_id UUID NOT NULL REFERENCES stock_issue_lines(id),
    quantity DECIMAL(19,4) NOT NULL CHECK (quantity > 0),
    condition VARCHAR(20) NOT NULL,
    stock_movement_id UUID REFERENCES stock_movements(id),
    CONSTRAINT stock_return_lines_condition_check CHECK (condition IN ('GOOD', 'DAMAGED', 'LOST'))
);
CREATE INDEX IF NOT EXISTS idx_stock_return_lines_return ON stock_return_lines (return_id);
CREATE INDEX IF NOT EXISTS idx_stock_return_lines_issue_line ON stock_return_lines (issue_line_id);

-- 6. Multi-entreprise
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
    WHEN 'stock_lots', 'stock_units' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM stock_items WHERE id = NEW.stock_item_id;
    WHEN 'stock_issues', 'stock_returns' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM warehouses WHERE id = NEW.warehouse_id;
    ELSE NULL;
  END CASE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_units', 'stock_returns']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_fill_enterprise ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_fill_enterprise BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION fill_enterprise_id()', t);
  END LOOP;
END $$;
