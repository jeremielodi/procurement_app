-- ============================================================================
-- 61_grn_store_confirmation.sql — Confirmation de l'entrée en magasin d'une réception (GRN) (idempotente)
-- ----------------------------------------------------------------------------
-- Choix de l'utilisateur (2026-11-11) : le magasinier signe aussi le bon de réception. Une personne ayant accès au
-- dépôt de la réception, AUTRE que celle qui a enregistré le GRN, confirme l'entrée en magasin : son nom, sa fonction
-- (figée au moment de la confirmation), la date et sa signature sont imprimés dans le cadre « Dépôt » du PDF.
-- Contrôle supplémentaire : la confirmation ne bloque ni le workflow BpmnGo ni la facture.
-- ============================================================================

ALTER TABLE goods_receipt_notes ADD COLUMN IF NOT EXISTS store_confirmed_by          UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE goods_receipt_notes ADD COLUMN IF NOT EXISTS store_confirmed_at          TIMESTAMPTZ;
ALTER TABLE goods_receipt_notes ADD COLUMN IF NOT EXISTS store_confirmed_by_position VARCHAR(100);
ALTER TABLE goods_receipt_notes ADD COLUMN IF NOT EXISTS store_confirmation_comment  TEXT;

-- Fonction de la personne figée au moment de la confirmation (comme les autres documents, migration 45)
CREATE OR REPLACE FUNCTION snapshot_grn_store_position() RETURNS trigger AS $$
BEGIN
  IF NEW.store_confirmed_by IS NULL THEN
    NEW.store_confirmed_by_position := NULL;
  ELSIF TG_OP = 'INSERT' OR NEW.store_confirmed_by IS DISTINCT FROM OLD.store_confirmed_by THEN
    SELECT position INTO NEW.store_confirmed_by_position FROM users WHERE id = NEW.store_confirmed_by;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_snapshot_grn_store_position ON goods_receipt_notes;
CREATE TRIGGER trg_snapshot_grn_store_position BEFORE INSERT OR UPDATE OF store_confirmed_by ON goods_receipt_notes
  FOR EACH ROW EXECUTE FUNCTION snapshot_grn_store_position();

-- Réceptions à confirmer d'un dépôt
CREATE INDEX IF NOT EXISTS idx_grn_store_pending ON goods_receipt_notes (warehouse_id) WHERE store_confirmed_at IS NULL;
