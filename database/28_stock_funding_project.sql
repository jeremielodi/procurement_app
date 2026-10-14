-- ============================================================================
-- 28_stock_funding_project.sql — Projet qui a financé chaque entrée en stock (idempotente)
-- ----------------------------------------------------------------------------
-- stock_movements.project_id : projet ayant payé l'article entré en stock
--   - réception (GRN) : projet de la réquisition du bon de commande, repris automatiquement (et par son annulation)
--   - stock initial (import, parc existant) et ajustement d'entrée : projet saisi, facultatif (vide = non attribué)
-- stock_units.project_id : projet ayant financé l'équipement (même règle).
-- Les autres mouvements (sorties, transferts, retours) déplacent du stock existant : pas de projet.
-- ============================================================================

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id);
ALTER TABLE stock_units ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_project ON stock_movements (project_id, performed_at) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_units_project ON stock_units (project_id) WHERE project_id IS NOT NULL;

-- Projet de la même entreprise que le mouvement / l'équipement
CREATE OR REPLACE FUNCTION stock_project_check() RETURNS trigger AS $$
BEGIN
  IF NEW.project_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.enterprise_id = NEW.enterprise_id) THEN
    RAISE EXCEPTION '%: le projet de financement doit appartenir à la même entreprise', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_movement_project_check ON stock_movements;
CREATE TRIGGER trg_stock_movement_project_check BEFORE INSERT ON stock_movements
    FOR EACH ROW EXECUTE FUNCTION stock_project_check();
DROP TRIGGER IF EXISTS trg_stock_unit_project_check ON stock_units;
CREATE TRIGGER trg_stock_unit_project_check BEFORE INSERT OR UPDATE OF project_id ON stock_units
    FOR EACH ROW EXECUTE FUNCTION stock_project_check();

-- Reprise des réceptions existantes : projet de la réquisition du bon de commande
-- (journal immuable : son trigger est suspendu le temps de cette seule mise à jour)
ALTER TABLE stock_movements DISABLE TRIGGER trg_stock_movement_immutable;
UPDATE stock_movements m SET project_id = r.project_id
FROM goods_receipt_notes g
JOIN purchase_orders po ON po.id = g.po_id
JOIN requisitions r ON r.id = po.requisition_id
WHERE m.source_type = 'GRN' AND m.source_id = g.id::text
  AND m.movement_type IN ('RECEIPT', 'RECEIPT_REVERSAL')
  AND m.project_id IS NULL AND r.project_id IS NOT NULL;
ALTER TABLE stock_movements ENABLE TRIGGER trg_stock_movement_immutable;

UPDATE stock_units u SET project_id = r.project_id
FROM goods_receipt_items gi
JOIN goods_receipt_notes g ON g.id = gi.grn_id
JOIN purchase_orders po ON po.id = g.po_id
JOIN requisitions r ON r.id = po.requisition_id
WHERE u.grn_item_id = gi.id AND u.project_id IS NULL AND r.project_id IS NOT NULL;
