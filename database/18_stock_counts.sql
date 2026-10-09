-- ============================================
-- INVENTAIRE PHYSIQUE ET AJUSTEMENTS DE STOCK
-- - stock_counts (CNT-AAAA-NNNNN) : comptage d'un dépôt — photo du stock attendu à l'ouverture (article × lot,
--   et une ligne par équipement suivi par n° de série), saisie des quantités comptées, validation → mouvements
--   ADJUSTMENT_IN / ADJUSTMENT_OUT pour les écarts (équipement non retrouvé → « perdu »)
-- - stock_adjustments (AJU-AAAA-NNNNN) : ajustement ponctuel motivé (casse, perte, péremption, correction…)
-- - Séparation des tâches : COUNT_STOCK (compter : logistique, admin) / ADJUST_STOCK (valider les écarts,
--   ajuster : admin d'entreprise)
-- - stock_items.reorder_quantity : quantité de réapprovisionnement proposée sous le seuil minimum
-- Idempotent : peut être rejoué sur une base existante (après 17_supplier_order_confirmation.sql).
-- ============================================

-- 1. Inventaires
CREATE SEQUENCE IF NOT EXISTS stock_count_seq;
CREATE TABLE IF NOT EXISTS stock_counts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    count_number VARCHAR(30) NOT NULL UNIQUE
        DEFAULT ('CNT-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(NEXTVAL('stock_count_seq')::TEXT, 5, '0')),
    enterprise_id UUID NOT NULL REFERENCES enterprise(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    category_id INTEGER REFERENCES market_categories(id),          -- inventaire partiel (une catégorie) ; NULL = tout le dépôt
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    comment TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    validated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    validated_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    CONSTRAINT stock_counts_status_check CHECK (status IN ('OPEN', 'VALIDATED', 'CANCELLED'))
);
-- Un seul inventaire ouvert par dépôt
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_counts_open_warehouse ON stock_counts (warehouse_id) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_stock_counts_enterprise ON stock_counts (enterprise_id, created_at);

CREATE TABLE IF NOT EXISTS stock_count_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    count_id UUID NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
    stock_item_id UUID NOT NULL REFERENCES stock_items(id),
    lot_id UUID REFERENCES stock_lots(id),
    unit_id UUID REFERENCES stock_units(id),
    expected_quantity DECIMAL(19,4) NOT NULL DEFAULT 0,             -- photo à l'ouverture
    counted_quantity DECIMAL(19,4),                                  -- NULL = pas encore compté
    added_during_count BOOLEAN NOT NULL DEFAULT FALSE,              -- stock trouvé non attendu
    note TEXT,
    counted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    counted_at TIMESTAMPTZ,
    adjustment_movement_id UUID REFERENCES stock_movements(id),
    CONSTRAINT stock_count_lines_counted_check CHECK (counted_quantity IS NULL OR counted_quantity >= 0),
    CONSTRAINT stock_count_lines_unit_check CHECK (unit_id IS NULL OR counted_quantity IS NULL OR counted_quantity IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_stock_count_lines_count ON stock_count_lines (count_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_count_lines_unique ON stock_count_lines
    (count_id, stock_item_id, COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(unit_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 2. Ajustements ponctuels
CREATE SEQUENCE IF NOT EXISTS stock_adjustment_seq;
CREATE TABLE IF NOT EXISTS stock_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    adjustment_number VARCHAR(30) NOT NULL UNIQUE
        DEFAULT ('AJU-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(NEXTVAL('stock_adjustment_seq')::TEXT, 5, '0')),
    enterprise_id UUID NOT NULL REFERENCES enterprise(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    stock_item_id UUID NOT NULL REFERENCES stock_items(id),
    lot_id UUID REFERENCES stock_lots(id),
    unit_id UUID REFERENCES stock_units(id),
    quantity DECIMAL(19,4) NOT NULL CHECK (quantity <> 0),          -- signée : + trouvé, - perdu / cassé…
    reason VARCHAR(30) NOT NULL,
    comment TEXT NOT NULL,
    stock_movement_id UUID REFERENCES stock_movements(id),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT stock_adjustments_reason_check CHECK (reason IN ('DAMAGE', 'LOSS', 'THEFT', 'EXPIRED', 'FOUND', 'CORRECTION', 'OTHER'))
);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_enterprise ON stock_adjustments (enterprise_id, created_at);

-- 3. Réapprovisionnement
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS reorder_quantity DECIMAL(19,4);
ALTER TABLE stock_items DROP CONSTRAINT IF EXISTS stock_items_reorder_check;
ALTER TABLE stock_items ADD CONSTRAINT stock_items_reorder_check CHECK (reorder_quantity IS NULL OR reorder_quantity > 0);

-- 4. Multi-entreprise : enterprise_id depuis le dépôt
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
    WHEN 'stock_issues', 'stock_returns', 'stock_counts', 'stock_adjustments' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM warehouses WHERE id = NEW.warehouse_id;
    ELSE NULL;
  END CASE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_counts', 'stock_adjustments']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_fill_enterprise ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_fill_enterprise BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION fill_enterprise_id()', t);
  END LOOP;
END $$;

-- 5. Permissions
INSERT INTO permissions (id, name, description, resource, action)
SELECT 'perm_count_stock', 'COUNT_STOCK', 'Ouvrir un inventaire et saisir les quantités comptées', 'stock', 'count'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'COUNT_STOCK');
INSERT INTO permissions (id, name, description, resource, action)
SELECT 'perm_adjust_stock', 'ADJUST_STOCK', 'Valider les écarts d''inventaire et ajuster le stock', 'stock', 'adjust'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ADJUST_STOCK');

INSERT INTO profile_permissions (profile_id, permission_id)
SELECT pr.profile, p.id FROM (VALUES ('prof_admin', 'COUNT_STOCK'), ('prof_logistic', 'COUNT_STOCK'), ('prof_admin', 'ADJUST_STOCK')) AS pr(profile, perm)
JOIN permissions p ON p.name = pr.perm
WHERE EXISTS (SELECT 1 FROM profiles WHERE id = pr.profile)
  AND NOT EXISTS (SELECT 1 FROM profile_permissions pp WHERE pp.profile_id = pr.profile AND pp.permission_id = p.id);
