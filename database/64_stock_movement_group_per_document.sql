-- ============================================================================
-- 64_stock_movement_group_per_document.sql — Une opération (MVG) = un document (idempotente)
-- ----------------------------------------------------------------------------
-- Choix de l'utilisateur (2026-11-11) : « un bon de sortie concerne un mouvement de sortie ; dans un mouvement de
-- sortie on peut sélectionner plusieurs articles ». Avant (migration 36) : une transaction = un groupe, si bien qu'une
-- opération écrivant plusieurs documents dans une transaction (import des affectations : un bon par détenteur) mettait
-- tous les bons dans le même MVG — « Mes articles reçus » montrait alors un mouvement partagé avec d'autres personnes.
-- Désormais : dans une transaction, un groupe par source (source_type + source_id : bon de sortie, GRN, bon d'entrée,
-- retour, inventaire, ajustement ; import = source_id vide → un seul groupe). Les groupes de la transaction sont
-- retenus dans le réglage local app.stock_movement_groups (liste d'UUID).
-- Reprise : chaque groupe existant qui contient plusieurs sources est séparé (un nouveau MVG par source en plus, même
-- date, même auteur) — trigger d'immuabilité suspendu le temps de la mise à jour.
-- ============================================================================

CREATE OR REPLACE FUNCTION stock_movement_group() RETURNS trigger AS $$
DECLARE
  gid UUID;
  list TEXT;
BEGIN
  IF NEW.group_id IS NOT NULL THEN RETURN NEW; END IF;
  list := NULLIF(current_setting('app.stock_movement_groups', true), '');
  IF list IS NOT NULL THEN
    SELECT g.id INTO gid FROM stock_movement_groups g
    WHERE g.id = ANY(string_to_array(list, ',')::uuid[])
      AND g.enterprise_id = NEW.enterprise_id
      AND g.source_type IS NOT DISTINCT FROM NEW.source_type
      AND g.source_id IS NOT DISTINCT FROM NEW.source_id
    LIMIT 1;
    IF gid IS NOT NULL THEN
      NEW.group_id := gid;
      RETURN NEW;
    END IF;
  END IF;
  INSERT INTO stock_movement_groups (enterprise_id, source_type, source_id, performed_by)
  VALUES (NEW.enterprise_id, NEW.source_type, NEW.source_id, NEW.performed_by)
  RETURNING id INTO gid;
  NEW.group_id := gid;
  PERFORM set_config('app.stock_movement_groups', COALESCE(list || ',', '') || gid::text, true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Reprise : un groupe par source
DO $$
DECLARE
  r RECORD;
  gid UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM stock_movements m JOIN stock_movement_groups g ON g.id = m.group_id
    WHERE m.source_type IS DISTINCT FROM g.source_type OR m.source_id IS DISTINCT FROM g.source_id
  ) THEN RETURN; END IF;
  ALTER TABLE stock_movements DISABLE TRIGGER trg_stock_movement_immutable;
  FOR r IN
    SELECT m.group_id, m.source_type, m.source_id, g.enterprise_id, g.created_at,
           (ARRAY_AGG(m.performed_by ORDER BY m.movement_number))[1] AS performed_by
    FROM stock_movements m JOIN stock_movement_groups g ON g.id = m.group_id
    WHERE m.source_type IS DISTINCT FROM g.source_type OR m.source_id IS DISTINCT FROM g.source_id
    GROUP BY m.group_id, m.source_type, m.source_id, g.enterprise_id, g.created_at
    ORDER BY g.created_at, MIN(m.movement_number)
  LOOP
    INSERT INTO stock_movement_groups (group_number, enterprise_id, source_type, source_id, performed_by, created_at)
    VALUES ('MVG-' || TO_CHAR(r.created_at, 'YYYY') || '-' || LPAD(NEXTVAL('stock_movement_group_seq')::TEXT, 6, '0'),
            r.enterprise_id, r.source_type, r.source_id, r.performed_by, r.created_at)
    RETURNING id INTO gid;
    UPDATE stock_movements SET group_id = gid
    WHERE group_id = r.group_id AND source_type IS NOT DISTINCT FROM r.source_type AND source_id IS NOT DISTINCT FROM r.source_id;
  END LOOP;
  ALTER TABLE stock_movements ENABLE TRIGGER trg_stock_movement_immutable;
END $$;
