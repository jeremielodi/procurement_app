-- ============================================================================
-- 35_asset_tag_auto.sql — N° d'inventaire attribué automatiquement aux équipements (idempotente)
-- ----------------------------------------------------------------------------
-- Toute unité (équipement suivi par n° de série) reçoit un n° d'inventaire INV-AAAA-NNNNN à sa création si aucun
-- n'est saisi : réception (GRN), entrée en stock après la réception, parc existant. Un n° saisi (étiquette déjà
-- collée) est conservé. Numérotation par entreprise et par année, sans trou (compteur verrouillé pendant la
-- transaction), en sautant les n° déjà pris par une saisie manuelle. Vider le n° d'une unité en attribue un nouveau.
-- Les unités existantes sans n° (hors VOID) en reçoivent un, dans l'ordre de création.
-- ============================================================================

CREATE TABLE IF NOT EXISTS stock_unit_tag_counters (
    enterprise_id UUID NOT NULL REFERENCES enterprise(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    last_value INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (enterprise_id, year)
);

CREATE OR REPLACE FUNCTION stock_unit_asset_tag() RETURNS trigger AS $$
DECLARE
  y INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
  n INTEGER;
  tag TEXT;
BEGIN
  IF NEW.asset_tag IS NOT NULL AND BTRIM(NEW.asset_tag) <> '' THEN
    NEW.asset_tag := BTRIM(NEW.asset_tag);
    RETURN NEW;
  END IF;
  NEW.asset_tag := NULL;
  IF NEW.status = 'VOID' THEN RETURN NEW; END IF;
  LOOP
    INSERT INTO stock_unit_tag_counters (enterprise_id, year, last_value) VALUES (NEW.enterprise_id, y, 1)
    ON CONFLICT (enterprise_id, year) DO UPDATE SET last_value = stock_unit_tag_counters.last_value + 1
    RETURNING last_value INTO n;
    tag := 'INV-' || y || '-' || LPAD(n::TEXT, 5, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM stock_units
      WHERE enterprise_id = NEW.enterprise_id AND status <> 'VOID' AND UPPER(asset_tag) = tag AND id <> NEW.id
    );
  END LOOP;
  NEW.asset_tag := tag;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_unit_asset_tag ON stock_units;
CREATE TRIGGER trg_stock_unit_asset_tag BEFORE INSERT OR UPDATE OF asset_tag ON stock_units
  FOR EACH ROW EXECUTE FUNCTION stock_unit_asset_tag();

-- Unités existantes sans n° d'inventaire
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM stock_units WHERE asset_tag IS NULL AND status <> 'VOID' ORDER BY created_at, id LOOP
    UPDATE stock_units SET asset_tag = NULL WHERE id = r.id;
  END LOOP;
END $$;
