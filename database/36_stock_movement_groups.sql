-- ============================================================================
-- 36_stock_movement_groups.sql — Groupes de mouvements de stock (« opérations ») (idempotente)
-- ----------------------------------------------------------------------------
-- Le journal garde un mouvement par article × lot, et un par unité pour les équipements (n° de série / n°
-- d'inventaire). Tous les mouvements écrits par une même opération (réception, entrée en stock après coup,
-- annulation, bon de sortie, réception de transfert, retour, inventaire validé, ajustement, import, parc existant)
-- sont rattachés à un GROUPE (MVG-AAAA-NNNNNN) : on sait ce qui est entré / sorti d'un seul coup, et le groupe se
-- télécharge. Règle : une transaction PostgreSQL = un groupe (chaque opération écrit ses mouvements dans une seule
-- transaction) ; le trigger crée le groupe au premier mouvement et le retient pour la transaction
-- (set_config local `app.stock_movement_group`).
-- Reprise : les mouvements existants sont regroupés par transaction d'origine (même entreprise, même auteur,
-- même horodatage performed_at = début de la transaction).
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS stock_movement_group_seq;

CREATE TABLE IF NOT EXISTS stock_movement_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_number VARCHAR(30) NOT NULL UNIQUE
        DEFAULT ('MVG-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(NEXTVAL('stock_movement_group_seq')::TEXT, 6, '0')),
    enterprise_id UUID NOT NULL REFERENCES enterprise(id),
    source_type VARCHAR(30),              -- source du premier mouvement (GRN, ISSUE, RETURN, COUNT, ADJUSTMENT, IMPORT, OPENING…)
    source_id VARCHAR(64),
    performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_stock_movement_groups_enterprise ON stock_movement_groups (enterprise_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movement_groups_source ON stock_movement_groups (source_type, source_id);

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES stock_movement_groups(id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_group ON stock_movements (group_id);

CREATE OR REPLACE FUNCTION stock_movement_group() RETURNS trigger AS $$
DECLARE
  gid TEXT;
BEGIN
  IF NEW.group_id IS NOT NULL THEN RETURN NEW; END IF;
  gid := NULLIF(current_setting('app.stock_movement_group', true), '');
  IF gid IS NOT NULL AND EXISTS (
    SELECT 1 FROM stock_movement_groups WHERE id = gid::uuid AND enterprise_id = NEW.enterprise_id
  ) THEN
    NEW.group_id := gid::uuid;
    RETURN NEW;
  END IF;
  INSERT INTO stock_movement_groups (enterprise_id, source_type, source_id, performed_by)
  VALUES (NEW.enterprise_id, NEW.source_type, NEW.source_id, NEW.performed_by)
  RETURNING id INTO NEW.group_id;
  PERFORM set_config('app.stock_movement_group', NEW.group_id::text, true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_movement_group ON stock_movements;
CREATE TRIGGER trg_stock_movement_group BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION stock_movement_group();

-- Reprise des mouvements existants (journal immuable : trigger suspendu le temps de la mise à jour)
DO $$
DECLARE
  r RECORD;
  gid UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM stock_movements WHERE group_id IS NULL) THEN RETURN; END IF;
  ALTER TABLE stock_movements DISABLE TRIGGER trg_stock_movement_immutable;
  FOR r IN
    SELECT enterprise_id, performed_by, performed_at,
           (ARRAY_AGG(source_type ORDER BY movement_number))[1] AS source_type,
           (ARRAY_AGG(source_id ORDER BY movement_number))[1] AS source_id
    FROM stock_movements
    WHERE group_id IS NULL
    GROUP BY enterprise_id, performed_by, performed_at
    ORDER BY performed_at
  LOOP
    INSERT INTO stock_movement_groups (group_number, enterprise_id, source_type, source_id, performed_by, created_at)
    VALUES ('MVG-' || TO_CHAR(r.performed_at, 'YYYY') || '-' || LPAD(NEXTVAL('stock_movement_group_seq')::TEXT, 6, '0'),
            r.enterprise_id, r.source_type, r.source_id, r.performed_by, r.performed_at)
    RETURNING id INTO gid;
    UPDATE stock_movements SET group_id = gid
    WHERE group_id IS NULL AND enterprise_id = r.enterprise_id
      AND performed_by IS NOT DISTINCT FROM r.performed_by AND performed_at = r.performed_at;
  END LOOP;
  ALTER TABLE stock_movements ENABLE TRIGGER trg_stock_movement_immutable;
END $$;
