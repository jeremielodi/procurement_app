-- ============================================================================
-- 50_inventory_prefix.sql — Code initial des n° d'inventaire par projet (idempotente)
-- ----------------------------------------------------------------------------
-- Les n° d'inventaire automatiques (migration 35) commençaient par INV-, comme les factures (INV-AAAA-NNNN).
-- projects.inventory_prefix = code initial des équipements financés par ce projet (ex. INVT-MSH) ; vide → INVT.
-- N° attribué : <code initial>-AAAA-NNNNN, numérotation par entreprise × code initial × année, sans trou.
-- Le code initial est celui du projet de financement de l'unité (stock_units.project_id) à sa création.
-- Les n° déjà attribués (INV-…, étiquettes déjà collées) ne sont pas modifiés.
-- ============================================================================

ALTER TABLE projects ADD COLUMN IF NOT EXISTS inventory_prefix VARCHAR(20);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_inventory_prefix_check') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_inventory_prefix_check
      CHECK (inventory_prefix IS NULL OR inventory_prefix ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$');
  END IF;
END $$;

-- Compteur par code initial (les compteurs existants sont ceux de l'ancien préfixe INV)
ALTER TABLE stock_unit_tag_counters ADD COLUMN IF NOT EXISTS prefix VARCHAR(20) NOT NULL DEFAULT 'INV';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_unit_tag_counters_pkey'
               AND array_length(conkey, 1) = 2) THEN
    ALTER TABLE stock_unit_tag_counters DROP CONSTRAINT stock_unit_tag_counters_pkey;
    ALTER TABLE stock_unit_tag_counters ADD PRIMARY KEY (enterprise_id, prefix, year);
  END IF;
END $$;
ALTER TABLE stock_unit_tag_counters ALTER COLUMN prefix DROP DEFAULT;

CREATE OR REPLACE FUNCTION stock_unit_asset_tag() RETURNS trigger AS $$
DECLARE
  y INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
  n INTEGER;
  pfx TEXT;
  tag TEXT;
BEGIN
  IF NEW.asset_tag IS NOT NULL AND BTRIM(NEW.asset_tag) <> '' THEN
    NEW.asset_tag := BTRIM(NEW.asset_tag);
    RETURN NEW;
  END IF;
  NEW.asset_tag := NULL;
  IF NEW.status = 'VOID' THEN RETURN NEW; END IF;
  SELECT NULLIF(BTRIM(p.inventory_prefix), '') INTO pfx FROM projects p WHERE p.id = NEW.project_id;
  pfx := COALESCE(pfx, 'INVT');
  LOOP
    INSERT INTO stock_unit_tag_counters (enterprise_id, prefix, year, last_value) VALUES (NEW.enterprise_id, pfx, y, 1)
    ON CONFLICT (enterprise_id, prefix, year) DO UPDATE SET last_value = stock_unit_tag_counters.last_value + 1
    RETURNING last_value INTO n;
    tag := pfx || '-' || y || '-' || LPAD(n::TEXT, 5, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM stock_units
      WHERE enterprise_id = NEW.enterprise_id AND status <> 'VOID' AND UPPER(asset_tag) = tag AND id <> NEW.id
    );
  END LOOP;
  NEW.asset_tag := tag;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
