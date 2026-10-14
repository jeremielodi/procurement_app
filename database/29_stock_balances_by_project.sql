-- ============================================================================
-- 29_stock_balances_by_project.sql — État du stock par projet (idempotente)
-- ----------------------------------------------------------------------------
-- Le solde devient article × dépôt × lot × projet (projet qui a financé le stock ; NULL = stock sans projet).
-- Chaque mouvement porte le projet du solde qu'il touche :
--   - entrées : projet de financement (migration 28) ;
--   - sorties / transferts / retours : projet de la quantité prise (lignes de bon de sortie : stock_issue_lines.project_id) ;
--   - équipements (n° de série) : projet de l'unité, repris automatiquement par le trigger.
-- Reprise du stock existant : chaque solde est réparti entre les projets des entrées les plus récentes (on suppose
-- que le stock le plus ancien est sorti en premier) ; équipements : projet des unités en stock ; reste = sans projet.
-- ============================================================================

ALTER TABLE stock_issue_lines ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id);
UPDATE stock_issue_lines il SET project_id = un.project_id
FROM stock_units un WHERE il.unit_id = un.id AND il.project_id IS NULL AND un.project_id IS NOT NULL;

DO $$
DECLARE
  zero CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
  b RECORD; e RECORD;
  remaining NUMERIC; take NUMERIC; alloc JSONB; units_total NUMERIC; k TEXT; v TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'stock_balances' AND column_name = 'project_id') THEN
    RETURN; -- déjà migré
  END IF;
  ALTER TABLE stock_balances ADD COLUMN project_id UUID REFERENCES projects(id);
  DROP INDEX IF EXISTS idx_stock_balances_key;
  CREATE UNIQUE INDEX idx_stock_balances_key ON stock_balances
    (stock_item_id, warehouse_id, COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::UUID), COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::UUID));

  FOR b IN
    SELECT sb.id, sb.enterprise_id, sb.stock_item_id, sb.warehouse_id, sb.lot_id, sb.quantity, si.track_serials
    FROM stock_balances sb JOIN stock_items si ON si.id = sb.stock_item_id
    WHERE sb.quantity > 0
  LOOP
    alloc := '{}'::jsonb;
    remaining := b.quantity;
    IF b.track_serials THEN
      SELECT COUNT(*) INTO units_total FROM stock_units
      WHERE stock_item_id = b.stock_item_id AND warehouse_id = b.warehouse_id AND status = 'IN_STOCK';
    END IF;
    IF b.track_serials AND units_total = b.quantity THEN
      -- Équipements : le projet de chaque unité en stock
      FOR e IN
        SELECT COALESCE(project_id::text, '') AS p, COUNT(*)::numeric AS q FROM stock_units
        WHERE stock_item_id = b.stock_item_id AND warehouse_id = b.warehouse_id AND status = 'IN_STOCK' GROUP BY 1
      LOOP
        alloc := alloc || jsonb_build_object(e.p, e.q);
      END LOOP;
      remaining := 0;
    ELSE
      -- Quantités : entrées les plus récentes d'abord
      FOR e IN
        SELECT COALESCE(project_id::text, '') AS p, quantity AS q FROM stock_movements
        WHERE stock_item_id = b.stock_item_id AND warehouse_id = b.warehouse_id
          AND COALESCE(lot_id, zero) = COALESCE(b.lot_id, zero) AND quantity > 0
        ORDER BY performed_at DESC, movement_number DESC
      LOOP
        take := LEAST(remaining, e.q);
        alloc := alloc || jsonb_build_object(e.p, COALESCE((alloc ->> e.p)::numeric, 0) + take);
        remaining := remaining - take;
        EXIT WHEN remaining <= 0;
      END LOOP;
    END IF;
    IF remaining > 0 THEN
      alloc := alloc || jsonb_build_object('', COALESCE((alloc ->> '')::numeric, 0) + remaining);
    END IF;
    -- Uniquement du stock sans projet : rien à changer
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM jsonb_object_keys(alloc) x WHERE x <> '');
    DELETE FROM stock_balances WHERE id = b.id;
    FOR k, v IN SELECT key, value FROM jsonb_each_text(alloc) LOOP
      IF v::numeric > 0 THEN
        INSERT INTO stock_balances (enterprise_id, stock_item_id, warehouse_id, lot_id, project_id, quantity, updated_at)
        VALUES (b.enterprise_id, b.stock_item_id, b.warehouse_id, b.lot_id, NULLIF(k, '')::uuid, v::numeric, CURRENT_TIMESTAMP);
      END IF;
    END LOOP;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_stock_balances_project ON stock_balances (project_id) WHERE project_id IS NOT NULL;

-- Solde par article × dépôt × lot × projet
CREATE OR REPLACE FUNCTION stock_movement_apply() RETURNS trigger AS $$
BEGIN
  INSERT INTO stock_balances (enterprise_id, stock_item_id, warehouse_id, lot_id, project_id, quantity, updated_at)
  VALUES (NEW.enterprise_id, NEW.stock_item_id, NEW.warehouse_id, NEW.lot_id, NEW.project_id, 0, CURRENT_TIMESTAMP)
  ON CONFLICT (stock_item_id, warehouse_id, COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::UUID),
               COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::UUID)) DO NOTHING;
  UPDATE stock_balances
  SET quantity = quantity + NEW.quantity, updated_at = CURRENT_TIMESTAMP
  WHERE stock_item_id = NEW.stock_item_id AND warehouse_id = NEW.warehouse_id
    AND COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::UUID) = COALESCE(NEW.lot_id, '00000000-0000-0000-0000-000000000000'::UUID)
    AND COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::UUID) = COALESCE(NEW.project_id, '00000000-0000-0000-0000-000000000000'::UUID);
  RETURN NEW;
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'STOCK_INSUFFICIENT : stock insuffisant pour ce mouvement' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

-- Équipement : le mouvement porte toujours le projet de l'unité ; projet de la même entreprise
CREATE OR REPLACE FUNCTION stock_project_check() RETURNS trigger AS $$
BEGIN
  -- IF imbriqués : stock_units n'a pas de colonne unit_id (pas d'évaluation court-circuitée en PL/pgSQL)
  IF TG_TABLE_NAME = 'stock_movements' THEN
    IF NEW.project_id IS NULL AND NEW.unit_id IS NOT NULL THEN
      SELECT project_id INTO NEW.project_id FROM stock_units WHERE id = NEW.unit_id;
    END IF;
  END IF;
  IF NEW.project_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.enterprise_id = NEW.enterprise_id) THEN
    RAISE EXCEPTION '%: le projet de financement doit appartenir à la même entreprise', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
