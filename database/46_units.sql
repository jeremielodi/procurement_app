-- 46_units.sql (idempotente)
-- Unités de mesure : référentiel de la PLATEFORME (géré par le super admin, comme les catégories de marché).
-- code = identifiant stable (identique dans toutes les bases), abbr = abréviation, name = libellé français,
-- translations = autres langues ({ "en": { "name": "…" } } : ajouter une langue ne demande pas de migration).
-- Utilisées par les lignes de réquisition (requisition_items.unit_id), reprises par le bon de commande et les PDF.

CREATE TABLE IF NOT EXISTS units (
  id           SERIAL PRIMARY KEY,
  code         VARCHAR(50)  NOT NULL,
  abbr         VARCHAR(20)  NOT NULL,
  name         VARCHAR(100) NOT NULL,
  translations JSONB        NOT NULL DEFAULT '{}'::jsonb,
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_units_code ON units (UPPER(code));
CREATE UNIQUE INDEX IF NOT EXISTS uq_units_abbr ON units (LOWER(abbr));
CREATE UNIQUE INDEX IF NOT EXISTS uq_units_name ON units (LOWER(name));

-- Valeurs initiales (inventory_unit) — une unité déjà présente (même code) n'est pas modifiée
INSERT INTO units (code, abbr, name, translations) VALUES
  ('ACT',     'Act',  'Acte',        '{"en": {"name": "Act"}}'),
  ('PALLET',  'Pal',  'Palette',     '{"en": {"name": "Pallet"}}'),
  ('PILL',    'Pill', 'Pilule',      '{"en": {"name": "Pill"}}'),
  ('BOX',     'Box',  'Boîte',       '{"en": {"name": "Box"}}'),
  ('LOT',     'Lot',  'Lot',         '{"en": {"name": "Lot"}}'),
  ('AMPOULE', 'amp',  'Ampoule',     '{"en": {"name": "Ampoule"}}'),
  ('BAGS',    'bags', 'Sac',         '{"en": {"name": "Bag"}}'),
  ('BOTTLE',  'btl',  'Bouteille',   '{"en": {"name": "Bottle"}}'),
  ('CAPSULE', 'cap',  'Gélule',      '{"en": {"name": "Capsule"}}'),
  ('BOTTLE2', 'flc',  'Flacon',      '{"en": {"name": "Flask"}}'),
  ('JAR',     'jar',  'Bocal',       '{"en": {"name": "Jar"}}'),
  ('LITER',   'ltr',  'Litre',       '{"en": {"name": "Litre"}}'),
  ('PIECE',   'pce',  'Pièce',       '{"en": {"name": "Piece"}}'),
  ('BAG',     'sch',  'Sachet',      '{"en": {"name": "Sachet"}}'),
  ('TABLET',  'tab',  'Comprimé',    '{"en": {"name": "Tablet"}}'),
  ('TUBE',    'tub',  'Tube',        '{"en": {"name": "Tube"}}'),
  ('VIAL',    'vial', 'Fiole',       '{"en": {"name": "Vial"}}'),
  ('UNIT',    'unit', 'Unité',       '{"en": {"name": "Unit"}}'),
  ('PACKAGE', 'pack', 'Paquet',      '{"en": {"name": "Package"}}'),
  ('KG',      'kilo', 'Kilogramme',  '{"en": {"name": "Kilogram"}}'),
  ('ART',     'art',  'Article',     '{"en": {"name": "Item"}}'),
  ('PERS',    'pers', 'Personne',    '{"en": {"name": "Person"}}'),
  ('ROLLS',   'roll', 'Rouleau',     '{"en": {"name": "Roll"}}'),
  ('METER',   'met',  'Mètre',       '{"en": {"name": "Metre"}}')
ON CONFLICT DO NOTHING;

-- Ligne de réquisition : unité choisie dans le référentiel
ALTER TABLE requisition_items ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES units(id);
CREATE INDEX IF NOT EXISTS idx_requisition_items_unit ON requisition_items (unit_id);

-- Ancienne unité en texte libre (migration 44, jamais déployée) : reprise par abréviation, code, nom ou traduction,
-- puis colonne supprimée
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition_items' AND column_name = 'unit') THEN
    UPDATE requisition_items ri SET unit_id = u.id
      FROM units u
     WHERE ri.unit_id IS NULL AND ri.unit IS NOT NULL
       AND LOWER(TRIM(ri.unit)) IN (LOWER(u.abbr), LOWER(u.code), LOWER(u.name), LOWER(u.translations->'en'->>'name'));
    ALTER TABLE requisition_items DROP COLUMN unit;
  END IF;
END $$;

-- Unité obligatoire sur toute ligne de réquisition, « Pièce » par défaut : lignes existantes sans unité → Pièce,
-- trigger pour tout chemin d'écriture qui n'en donne pas (import, anciens clients, scripts), puis NOT NULL
CREATE OR REPLACE FUNCTION default_requisition_item_unit() RETURNS trigger AS $$
BEGIN
  IF NEW.unit_id IS NULL THEN
    SELECT id INTO NEW.unit_id FROM units WHERE UPPER(code) = 'PIECE';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_default_requisition_item_unit ON requisition_items;
CREATE TRIGGER trg_default_requisition_item_unit BEFORE INSERT OR UPDATE OF unit_id ON requisition_items
  FOR EACH ROW EXECUTE FUNCTION default_requisition_item_unit();

BEGIN;
SET LOCAL session_replication_role = replica; -- reprise sans déclencher les triggers de budget
UPDATE requisition_items SET unit_id = (SELECT id FROM units WHERE UPPER(code) = 'PIECE') WHERE unit_id IS NULL;
COMMIT;
ALTER TABLE requisition_items ALTER COLUMN unit_id SET NOT NULL;
