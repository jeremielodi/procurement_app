-- ============================================
-- BONS D'ENTRÉE EN STOCK (hors bon de commande)
-- - Don / dotation, achat hors système, retour hors bon de sortie, autre (motif obligatoire)
-- - Saisi par le magasinier (PENDING), validé par une AUTRE personne (séparation des tâches) :
--   le stock n'augmente qu'à la validation (mouvements ENTRY, coût facultatif, projet de financement facultatif)
-- - Refus (REJECTED) ou retrait par son auteur (CANCELLED) avant validation : aucun mouvement
-- - Annulation après validation = écritures inverses ENTRY_REVERSAL (refusée si le stock a déjà été utilisé)
-- Idempotent : peut être rejoué sur une base existante (après 36_stock_movement_groups.sql).
-- ============================================

-- 1. Types de mouvement : entrée par bon d'entrée et son annulation
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check CHECK (movement_type IN
    ('OPENING', 'RECEIPT', 'RECEIPT_REVERSAL', 'ISSUE', 'ISSUE_REVERSAL', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT',
     'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'ENTRY', 'ENTRY_REVERSAL'));
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_sign_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_sign_check CHECK (
    (movement_type IN ('OPENING', 'RECEIPT', 'ISSUE_REVERSAL', 'RETURN', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'ENTRY') AND quantity > 0)
 OR (movement_type IN ('RECEIPT_REVERSAL', 'ISSUE', 'TRANSFER_OUT', 'ADJUSTMENT_OUT', 'ENTRY_REVERSAL') AND quantity < 0));

-- 2. Bons d'entrée
CREATE SEQUENCE IF NOT EXISTS stock_entry_seq;

CREATE TABLE IF NOT EXISTS stock_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_number VARCHAR(30) NOT NULL UNIQUE
        DEFAULT ('ENT-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(NEXTVAL('stock_entry_seq')::TEXT, 5, '0')),
    enterprise_id UUID NOT NULL REFERENCES enterprise(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    entry_type VARCHAR(30) NOT NULL,
    origin VARCHAR(255),                  -- donateur, vendeur, personne qui rend le matériel… (texte libre)
    delivered_by VARCHAR(255),            -- personne qui a remis les articles (signature du bon)
    reference VARCHAR(100),               -- n° de la lettre de don, du reçu…
    reason TEXT,                          -- motif (obligatoire pour OTHER)
    project_id UUID REFERENCES projects(id),
    currency_id INTEGER REFERENCES currency(id),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    validated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    validated_at TIMESTAMPTZ,
    validation_comment TEXT,
    rejected_by UUID REFERENCES users(id) ON DELETE SET NULL,
    rejected_at TIMESTAMPTZ,
    reject_reason TEXT,
    cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    CONSTRAINT stock_entries_type_check CHECK (entry_type IN ('DONATION', 'OFF_SYSTEM_PURCHASE', 'RETURN', 'OTHER')),
    CONSTRAINT stock_entries_status_check CHECK (status IN ('PENDING', 'VALIDATED', 'REJECTED', 'CANCELLED')),
    CONSTRAINT stock_entries_reason_check CHECK (entry_type <> 'OTHER' OR NULLIF(TRIM(reason), '') IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_stock_entries_enterprise ON stock_entries (enterprise_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_entries_warehouse ON stock_entries (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_entries_status ON stock_entries (enterprise_id, status);

CREATE TABLE IF NOT EXISTS stock_entry_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES stock_entries(id) ON DELETE CASCADE,
    stock_item_id UUID NOT NULL REFERENCES stock_items(id),
    quantity DECIMAL(19,4) NOT NULL CHECK (quantity > 0),
    unit_cost DECIMAL(19,4) CHECK (unit_cost IS NULL OR unit_cost >= 0),
    lot_number VARCHAR(100),
    expiry_date DATE,
    serials JSONB NOT NULL DEFAULT '[]'::jsonb,   -- n° de série saisis (équipements), une unité chacun à la validation
    lot_id UUID REFERENCES stock_lots(id),       -- renseigné à la validation
    stock_movement_id UUID REFERENCES stock_movements(id)
);
CREATE INDEX IF NOT EXISTS idx_stock_entry_lines_entry ON stock_entry_lines (entry_id);
CREATE INDEX IF NOT EXISTS idx_stock_entry_lines_item ON stock_entry_lines (stock_item_id);

-- 3. Multi-entreprise : entreprise du bon = celle du dépôt ; dépôt, projet et articles de la même entreprise
CREATE OR REPLACE FUNCTION stock_entry_check() RETURNS trigger AS $$
BEGIN
  IF NEW.enterprise_id IS NULL THEN
    SELECT enterprise_id INTO NEW.enterprise_id FROM warehouses WHERE id = NEW.warehouse_id;
  END IF;
  IF (SELECT enterprise_id FROM warehouses WHERE id = NEW.warehouse_id) IS DISTINCT FROM NEW.enterprise_id
     OR (NEW.project_id IS NOT NULL AND (SELECT enterprise_id FROM projects WHERE id = NEW.project_id) IS DISTINCT FROM NEW.enterprise_id) THEN
    RAISE EXCEPTION 'stock_entries : dépôt et projet doivent appartenir à l''entreprise du bon';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_entry_check ON stock_entries;
CREATE TRIGGER trg_stock_entry_check BEFORE INSERT OR UPDATE OF warehouse_id, project_id, enterprise_id ON stock_entries
  FOR EACH ROW EXECUTE FUNCTION stock_entry_check();

CREATE OR REPLACE FUNCTION stock_entry_line_check() RETURNS trigger AS $$
BEGIN
  IF (SELECT enterprise_id FROM stock_items WHERE id = NEW.stock_item_id)
     IS DISTINCT FROM (SELECT enterprise_id FROM stock_entries WHERE id = NEW.entry_id) THEN
    RAISE EXCEPTION 'stock_entry_lines : article d''une autre entreprise';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_entry_line_check ON stock_entry_lines;
CREATE TRIGGER trg_stock_entry_line_check BEFORE INSERT OR UPDATE OF stock_item_id, entry_id ON stock_entry_lines
  FOR EACH ROW EXECUTE FUNCTION stock_entry_line_check();

-- 4. Permissions : saisir un bon d'entrée (logistique, magasinier, admin) ; le valider (logistique, admin)
INSERT INTO permissions (id, name, description, resource, action)
SELECT 'perm_record_stock_entries', 'RECORD_STOCK_ENTRIES', 'Saisir un bon d''entrée en stock (don, achat hors système, retour…)', 'stock', 'entry'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'RECORD_STOCK_ENTRIES');
INSERT INTO permissions (id, name, description, resource, action)
SELECT 'perm_validate_stock_entries', 'VALIDATE_STOCK_ENTRIES', 'Valider, refuser ou annuler un bon d''entrée en stock', 'stock', 'validate_entry'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'VALIDATE_STOCK_ENTRIES');

INSERT INTO profile_permissions (profile_id, permission_id)
SELECT pr.id, p.id FROM (VALUES ('prof_admin', 'RECORD_STOCK_ENTRIES'), ('prof_logistic', 'RECORD_STOCK_ENTRIES'), ('prof_store_keeper', 'RECORD_STOCK_ENTRIES'),
                                ('prof_admin', 'VALIDATE_STOCK_ENTRIES'), ('prof_logistic', 'VALIDATE_STOCK_ENTRIES')) AS pr(id, perm)
JOIN permissions p ON p.name = pr.perm
WHERE EXISTS (SELECT 1 FROM profiles WHERE id = pr.id)
  AND NOT EXISTS (SELECT 1 FROM profile_permissions pp WHERE pp.profile_id = pr.id AND pp.permission_id = p.id);
