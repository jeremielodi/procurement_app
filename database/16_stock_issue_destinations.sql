-- ============================================
-- TYPES DE SORTIE DE STOCK (destination du bon de sortie)
-- - USER        : remise à un employé (existant) — mouvement ISSUE, accusé par le bénéficiaire
-- - WAREHOUSE   : transfert vers un autre dépôt de l'entreprise — TRANSFER_OUT (dépôt source)
--                 + TRANSFER_IN (dépôt destination), mêmes lots / mêmes n° de série ; réception confirmée
--                 par un utilisateur ayant accès au dépôt de destination
-- - DEPARTMENT  : sortie vers un département (consommation ou matériel du service) — mouvement ISSUE,
--                 personne qui a retiré les articles facultative ; un équipement reste « affecté au département »
-- Retours : depuis un employé OU depuis un département.
-- Idempotent : peut être rejoué sur une base existante (après 15_stock_equipment.sql).
-- ============================================

-- 1. Bons de sortie : type de destination
ALTER TABLE stock_issues ADD COLUMN IF NOT EXISTS destination_type VARCHAR(20) NOT NULL DEFAULT 'USER';
ALTER TABLE stock_issues ADD COLUMN IF NOT EXISTS destination_warehouse_id UUID REFERENCES warehouses(id);
ALTER TABLE stock_issues ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id);
ALTER TABLE stock_issues ADD COLUMN IF NOT EXISTS acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE stock_issues ALTER COLUMN recipient_id DROP NOT NULL;

-- Accusés antérieurs : faits par le bénéficiaire
UPDATE stock_issues SET acknowledged_by = recipient_id WHERE acknowledged_at IS NOT NULL AND acknowledged_by IS NULL;

ALTER TABLE stock_issues DROP CONSTRAINT IF EXISTS stock_issues_destination_check;
ALTER TABLE stock_issues ADD CONSTRAINT stock_issues_destination_check CHECK (
    (destination_type = 'USER' AND recipient_id IS NOT NULL AND destination_warehouse_id IS NULL AND department_id IS NULL)
 OR (destination_type = 'WAREHOUSE' AND destination_warehouse_id IS NOT NULL AND destination_warehouse_id <> warehouse_id
     AND recipient_id IS NULL AND department_id IS NULL)
 OR (destination_type = 'DEPARTMENT' AND department_id IS NOT NULL AND destination_warehouse_id IS NULL));

CREATE INDEX IF NOT EXISTS idx_stock_issues_destination_wh ON stock_issues (destination_warehouse_id) WHERE destination_warehouse_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_issues_department ON stock_issues (department_id) WHERE department_id IS NOT NULL;

-- Lignes : mouvement d'entrée au dépôt de destination (transfert) et sortie inverse à l'annulation
ALTER TABLE stock_issue_lines ADD COLUMN IF NOT EXISTS transfer_in_movement_id UUID REFERENCES stock_movements(id);
ALTER TABLE stock_issue_lines ADD COLUMN IF NOT EXISTS reversal_out_movement_id UUID REFERENCES stock_movements(id);

-- Cohérence : dépôts, bénéficiaire, département et projet de la même entreprise que le bon
CREATE OR REPLACE FUNCTION stock_issue_check() RETURNS trigger AS $$
BEGIN
  IF (SELECT enterprise_id FROM warehouses WHERE id = NEW.warehouse_id) IS DISTINCT FROM NEW.enterprise_id
     OR (NEW.recipient_id IS NOT NULL AND (SELECT enterprise_id FROM users WHERE id = NEW.recipient_id) IS DISTINCT FROM NEW.enterprise_id)
     OR (NEW.destination_warehouse_id IS NOT NULL AND (SELECT enterprise_id FROM warehouses WHERE id = NEW.destination_warehouse_id) IS DISTINCT FROM NEW.enterprise_id)
     OR (NEW.department_id IS NOT NULL AND (SELECT enterprise_id FROM departments WHERE id = NEW.department_id) IS DISTINCT FROM NEW.enterprise_id)
     OR (NEW.project_id IS NOT NULL AND (SELECT enterprise_id FROM projects WHERE id = NEW.project_id) IS DISTINCT FROM NEW.enterprise_id) THEN
    RAISE EXCEPTION 'stock_issues : dépôts, bénéficiaire, département et projet doivent appartenir à l''entreprise du bon';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Équipements affectés à un département
ALTER TABLE stock_units ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id);
CREATE INDEX IF NOT EXISTS idx_stock_units_department ON stock_units (department_id) WHERE department_id IS NOT NULL;
ALTER TABLE stock_units DROP CONSTRAINT IF EXISTS stock_units_location_check;
ALTER TABLE stock_units ADD CONSTRAINT stock_units_location_check CHECK (
    (status = 'IN_STOCK' AND warehouse_id IS NOT NULL AND holder_id IS NULL AND department_id IS NULL)
 OR (status = 'ASSIGNED' AND warehouse_id IS NULL AND (holder_id IS NOT NULL) <> (department_id IS NOT NULL))
 OR (status IN ('LOST', 'RETIRED', 'VOID') AND warehouse_id IS NULL AND holder_id IS NULL AND department_id IS NULL));

-- 3. Retours depuis un département
ALTER TABLE stock_returns ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id);
ALTER TABLE stock_returns ALTER COLUMN returned_by DROP NOT NULL;
ALTER TABLE stock_returns DROP CONSTRAINT IF EXISTS stock_returns_source_check;
ALTER TABLE stock_returns ADD CONSTRAINT stock_returns_source_check CHECK ((returned_by IS NOT NULL) <> (department_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_stock_returns_department ON stock_returns (department_id) WHERE department_id IS NOT NULL;
