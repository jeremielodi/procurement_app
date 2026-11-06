-- 49_stock_item_units.sql (idempotente)
-- Catalogue de stock : unité de mesure choisie dans le référentiel de la plateforme (units, migration 46).
-- stock_items.unit_id = l'unité (obligatoire) ; stock_items.unit (ancien texte libre) est CONSERVÉ mais tenu par
-- trigger = abréviation de l'unité — les lectures existantes (soldes, journal, PDF, exports) restent valables.
-- Ne jamais écrire stock_items.unit depuis le code : écrire unit_id.

-- 1. Unités utilisées par l'ancienne liste du catalogue (et unités courantes : nuitée, jour, dose) absentes du référentiel
INSERT INTO units (code, abbr, name, translations) VALUES
  ('CARTON',   'ctn',   'Carton',       '{"en": {"name": "Carton"}}'),
  ('REAM',     'rame',  'Rame',         '{"en": {"name": "Ream"}}'),
  ('TONNE',    't',     'Tonne',        '{"en": {"name": "Tonne"}}'),
  ('SQ_METER', 'm²',    'Mètre carré',  '{"en": {"name": "Square metre"}}'),
  ('CU_METER', 'm³',    'Mètre cube',   '{"en": {"name": "Cubic metre"}}'),
  ('KIT',      'kit',   'Kit',          '{"en": {"name": "Kit"}}'),
  ('PAIR',     'paire', 'Paire',        '{"en": {"name": "Pair"}}'),
  ('NIGHT',    'nuit',  'Nuitée',       '{"en": {"name": "Night"}}'),
  ('JERRYCAN', 'bidon', 'Bidon',        '{"en": {"name": "Jerrycan"}}'),
  ('DAY',      'jour',  'Jour',         '{"en": {"name": "Day"}}'),
  ('DOSE',     'dose',  'Dose',         '{"en": {"name": "Dose"}}')
ON CONFLICT DO NOTHING;

-- 2. Texte → unité : abréviation, code, nom, nom traduit (sans casse ni accents), puis abréviations usuelles.
--    Mêmes alias que backend/src/utils/units.js (UNIT_ALIASES).
CREATE OR REPLACE FUNCTION unit_text_key(t TEXT) RETURNS TEXT AS $$
  SELECT regexp_replace(translate(LOWER(TRIM(COALESCE(t, ''))), 'àâäáéèêëíîïóôöòúùûüç', 'aaaaeeeeiiiioooouuuuc'), '\s+', ' ', 'g')
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION find_unit_id(t TEXT) RETURNS INTEGER AS $$
DECLARE
  k TEXT := unit_text_key(t);
  found INTEGER;
BEGIN
  IF k = '' THEN RETURN NULL; END IF;
  SELECT u.id INTO found FROM units u
   WHERE k IN (unit_text_key(u.abbr), unit_text_key(u.code), unit_text_key(u.name))
      OR EXISTS (SELECT 1 FROM jsonb_each(u.translations) tr WHERE unit_text_key(tr.value->>'name') = k)
   ORDER BY (unit_text_key(u.abbr) = k) DESC, u.is_active DESC, u.id LIMIT 1;
  IF found IS NOT NULL THEN RETURN found; END IF;
  SELECT u.id INTO found FROM units u
    JOIN (VALUES ('l', 'LITER'), ('lt', 'LITER'), ('litres', 'LITER'), ('liter', 'LITER'), ('liters', 'LITER'),
                 ('kg', 'KG'), ('kgs', 'KG'), ('m', 'METER'), ('metres', 'METER'), ('meter', 'METER'),
                 ('pc', 'PIECE'), ('pcs', 'PIECE'), ('pieces', 'PIECE'), ('u', 'UNIT'), ('unites', 'UNIT'), ('units', 'UNIT'),
                 ('boite', 'BOX'), ('boites', 'BOX'), ('bte', 'BOX'), ('sacs', 'BAGS'), ('paquets', 'PACKAGE'), ('pqt', 'PACKAGE'),
                 ('cartons', 'CARTON'), ('rames', 'REAM'), ('tonnes', 'TONNE'), ('m2', 'SQ_METER'), ('m3', 'CU_METER'),
                 ('kits', 'KIT'), ('paires', 'PAIR'), ('rouleaux', 'ROLLS'), ('flacons', 'BOTTLE2'), ('bouteilles', 'BOTTLE'))
         AS a(alias, code) ON UPPER(u.code) = a.code
   WHERE a.alias = k LIMIT 1;
  RETURN found;
END $$ LANGUAGE plpgsql STABLE;

-- 3. Colonne + reprise des articles existants
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES units(id);
CREATE INDEX IF NOT EXISTS idx_stock_items_unit ON stock_items (unit_id);

DO $$
DECLARE r RECORD; new_id INTEGER;
BEGIN
  UPDATE stock_items SET unit_id = find_unit_id(unit) WHERE unit_id IS NULL;
  -- Texte sans équivalent : nouvelle unité du référentiel (le super admin pourra la renommer / traduire)
  FOR r IN SELECT DISTINCT TRIM(unit) AS txt FROM stock_items WHERE unit_id IS NULL AND TRIM(COALESCE(unit, '')) <> '' LOOP
    INSERT INTO units (code, abbr, name)
    VALUES ('U_' || UPPER(LEFT(md5(unit_text_key(r.txt)), 8)), LEFT(r.txt, 20), LEFT(r.txt, 100))
    ON CONFLICT DO NOTHING RETURNING id INTO new_id;
    RAISE NOTICE 'Unité « % » ajoutée au référentiel pour le catalogue de stock', r.txt;
  END LOOP;
  UPDATE stock_items SET unit_id = find_unit_id(unit) WHERE unit_id IS NULL;
  -- Aucun texte (ou conflit improbable) : Pièce
  UPDATE stock_items SET unit_id = (SELECT id FROM units WHERE UPPER(code) = 'PIECE') WHERE unit_id IS NULL;
END $$;

-- 4. Trigger : unit_id résolu depuis le texte pour un ancien chemin d'écriture qui ne donne que `unit`
--    (texte inconnu → erreur, jamais d'unité inventée ; rien du tout → Pièce), puis unit = abréviation
CREATE OR REPLACE FUNCTION stock_item_unit_sync() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.unit_id IS NOT DISTINCT FROM OLD.unit_id AND NEW.unit IS DISTINCT FROM OLD.unit THEN
    NEW.unit_id := NULL; -- seul le texte a changé : on le résout
  END IF;
  IF NEW.unit_id IS NULL THEN
    IF TRIM(COALESCE(NEW.unit, '')) = '' THEN
      SELECT id INTO NEW.unit_id FROM units WHERE UPPER(code) = 'PIECE';
    ELSE
      NEW.unit_id := find_unit_id(NEW.unit);
      IF NEW.unit_id IS NULL THEN
        RAISE EXCEPTION 'Unité de mesure inconnue : %', NEW.unit USING ERRCODE = '23503';
      END IF;
    END IF;
  END IF;
  SELECT abbr INTO NEW.unit FROM units WHERE id = NEW.unit_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_stock_item_unit_sync ON stock_items;
CREATE TRIGGER trg_stock_item_unit_sync BEFORE INSERT OR UPDATE OF unit_id, unit ON stock_items
  FOR EACH ROW EXECUTE FUNCTION stock_item_unit_sync();

-- Abréviation modifiée dans le référentiel → reportée sur les articles
CREATE OR REPLACE FUNCTION units_abbr_to_stock_items() RETURNS trigger AS $$
BEGIN
  UPDATE stock_items SET unit = NEW.abbr WHERE unit_id = NEW.id AND unit IS DISTINCT FROM NEW.abbr;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_units_abbr_to_stock_items ON units;
CREATE TRIGGER trg_units_abbr_to_stock_items AFTER UPDATE OF abbr ON units
  FOR EACH ROW EXECUTE FUNCTION units_abbr_to_stock_items();

-- Reprise du texte = abréviation pour les articles existants (passe par le trigger)
UPDATE stock_items si SET unit = u.abbr FROM units u WHERE u.id = si.unit_id AND si.unit IS DISTINCT FROM u.abbr;

ALTER TABLE stock_items ALTER COLUMN unit_id SET NOT NULL;
