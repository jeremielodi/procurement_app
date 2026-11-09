-- ============================================================================
-- 57_asset_tag_codification.sql — Codification des n° d'inventaire (TAG) des équipements (idempotente)
-- ----------------------------------------------------------------------------
-- Demande de l'utilisateur (2026-11-09, marquage physique IMA) : ORGANISATION – PROJET – CATÉGORIE – ANNÉE – N°
--   ex. IMA-MIHR-LAP-2026-001
--  - ORGANISATION : enterprise.asset_tag_org (vide = ancienne codification <code initial du projet>-AAAA-NNNNN) ;
--  - PROJET : stock_units.tag_project_code (financeur d'origine d'un bien du parc existant), sinon code initial
--    inventaire du projet de financement (projects.inventory_prefix), sinon code du projet, sinon SP (sans projet) ;
--  - CATÉGORIE : stock_items.asset_category (3 lettres : LAP, TAB, VEH…), sinon AST ;
--  - ANNÉE : année d'acquisition (stock_units.acquisition_date), sinon année d'enregistrement ;
--  - N° : séquence sur 3 chiffres par entreprise × organisation-projet-catégorie × année (sans trou, plus de 3 chiffres
--    au-delà de 999).
-- Un n° saisi reste tel quel ; remettre le n° à vide en recalcule un (recodification).
-- ============================================================================

ALTER TABLE enterprise ADD COLUMN IF NOT EXISTS asset_tag_org VARCHAR(10);
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS asset_category VARCHAR(5);
ALTER TABLE stock_units ADD COLUMN IF NOT EXISTS acquisition_date DATE;
ALTER TABLE stock_units ADD COLUMN IF NOT EXISTS tag_project_code VARCHAR(20);
ALTER TABLE stock_unit_tag_counters ALTER COLUMN prefix TYPE VARCHAR(60);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enterprise_asset_tag_org_check') THEN
    ALTER TABLE enterprise ADD CONSTRAINT enterprise_asset_tag_org_check CHECK (asset_tag_org IS NULL OR asset_tag_org ~ '^[A-Z0-9]{2,10}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_items_asset_category_check') THEN
    ALTER TABLE stock_items ADD CONSTRAINT stock_items_asset_category_check CHECK (asset_category IS NULL OR asset_category ~ '^[A-Z0-9]{2,5}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_units_tag_project_code_check') THEN
    ALTER TABLE stock_units ADD CONSTRAINT stock_units_tag_project_code_check
      CHECK (tag_project_code IS NULL OR tag_project_code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION stock_unit_asset_tag() RETURNS trigger AS $$
DECLARE
  y INTEGER;
  n INTEGER;
  org TEXT;
  seg TEXT;
  cat TEXT;
  pfx TEXT;
  tag TEXT;
  width INTEGER;
BEGIN
  IF NEW.asset_tag IS NOT NULL AND BTRIM(NEW.asset_tag) <> '' THEN
    NEW.asset_tag := BTRIM(NEW.asset_tag);
    RETURN NEW;
  END IF;
  NEW.asset_tag := NULL;
  IF NEW.status = 'VOID' THEN RETURN NEW; END IF;
  SELECT NULLIF(BTRIM(e.asset_tag_org), '') INTO org FROM enterprise e WHERE e.id = NEW.enterprise_id;
  IF org IS NULL THEN
    -- Ancienne codification : <code initial inventaire du projet | INVT>-AAAA-NNNNN (année d'enregistrement)
    y := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
    SELECT NULLIF(BTRIM(p.inventory_prefix), '') INTO pfx FROM projects p WHERE p.id = NEW.project_id;
    pfx := COALESCE(pfx, 'INVT');
    width := 5;
  ELSE
    y := EXTRACT(YEAR FROM COALESCE(NEW.acquisition_date, CURRENT_DATE))::INTEGER;
    SELECT COALESCE(NULLIF(BTRIM(p.inventory_prefix), ''), NULLIF(REGEXP_REPLACE(UPPER(p.code), '[^A-Z0-9]+', '', 'g'), ''))
      INTO seg FROM projects p WHERE p.id = NEW.project_id;
    seg := COALESCE(NULLIF(BTRIM(NEW.tag_project_code), ''), seg, 'SP');
    SELECT NULLIF(BTRIM(si.asset_category), '') INTO cat FROM stock_items si WHERE si.id = NEW.stock_item_id;
    cat := COALESCE(cat, 'AST');
    pfx := org || '-' || seg || '-' || cat;
    width := 3;
  END IF;
  LOOP
    INSERT INTO stock_unit_tag_counters (enterprise_id, prefix, year, last_value) VALUES (NEW.enterprise_id, pfx, y, 1)
    ON CONFLICT (enterprise_id, prefix, year) DO UPDATE SET last_value = stock_unit_tag_counters.last_value + 1
    RETURNING last_value INTO n;
    tag := CASE WHEN width = 5 THEN pfx || '-' || y || '-' || LPAD(n::TEXT, 5, '0')
                ELSE pfx || '-' || y || '-' || LPAD(n::TEXT, 3, '0') END;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM stock_units
      WHERE enterprise_id = NEW.enterprise_id AND status <> 'VOID' AND UPPER(asset_tag) = tag AND id <> NEW.id
    );
  END LOOP;
  NEW.asset_tag := tag;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
