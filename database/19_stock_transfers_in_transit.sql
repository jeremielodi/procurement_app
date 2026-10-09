-- ============================================
-- TRANSFERTS « EN TRANSIT » (réception différée au dépôt de destination)
-- - Expédition : TRANSFER_OUT au dépôt source ; l'équipement passe « IN_TRANSIT » (ni dépôt, ni détenteur)
-- - Réception par le dépôt de destination : quantité reçue par ligne → TRANSFER_IN ; le manque = perte en transit
--   (équipement non reçu → LOST) ; annulation avant réception = retour au dépôt source
-- Les transferts déjà réceptionnés (anciens transferts immédiats) ne changent pas.
-- Idempotent : peut être rejoué sur une base existante (après 18_stock_counts.sql).
-- ============================================

ALTER TABLE stock_units DROP CONSTRAINT IF EXISTS stock_units_status_check;
ALTER TABLE stock_units ADD CONSTRAINT stock_units_status_check CHECK (status IN ('IN_STOCK', 'ASSIGNED', 'IN_TRANSIT', 'LOST', 'RETIRED', 'VOID'));
ALTER TABLE stock_units DROP CONSTRAINT IF EXISTS stock_units_location_check;
ALTER TABLE stock_units ADD CONSTRAINT stock_units_location_check CHECK (
    (status = 'IN_STOCK' AND warehouse_id IS NOT NULL AND holder_id IS NULL AND department_id IS NULL)
 OR (status = 'ASSIGNED' AND warehouse_id IS NULL AND (holder_id IS NOT NULL) <> (department_id IS NOT NULL))
 OR (status IN ('IN_TRANSIT', 'LOST', 'RETIRED', 'VOID') AND warehouse_id IS NULL AND holder_id IS NULL AND department_id IS NULL));

-- Quantité réellement reçue au dépôt de destination (NULL = pas encore réceptionné)
ALTER TABLE stock_issue_lines ADD COLUMN IF NOT EXISTS received_quantity DECIMAL(19,4);
ALTER TABLE stock_issue_lines DROP CONSTRAINT IF EXISTS stock_issue_lines_received_check;
ALTER TABLE stock_issue_lines ADD CONSTRAINT stock_issue_lines_received_check CHECK (received_quantity IS NULL OR (received_quantity >= 0 AND received_quantity <= quantity));

-- Transferts déjà entrés au dépôt de destination (anciens transferts immédiats) : tout est reçu
UPDATE stock_issue_lines il SET received_quantity = il.quantity
  FROM stock_issues si
 WHERE si.id = il.issue_id AND si.destination_type = 'WAREHOUSE' AND il.transfer_in_movement_id IS NOT NULL AND il.received_quantity IS NULL;

-- Transferts en transit (à réceptionner)
CREATE INDEX IF NOT EXISTS idx_stock_issues_in_transit ON stock_issues (destination_warehouse_id)
  WHERE destination_type = 'WAREHOUSE' AND status = 'ISSUED' AND acknowledged_at IS NULL;
