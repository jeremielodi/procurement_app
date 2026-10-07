-- ============================================
-- GESTION DE STOCK : dépôts, catalogue d'articles, lots, mouvements, suivi des livraisons
--
-- Principes
-- - Dépôts (warehouses) PAR ENTREPRISE, rattachés à une localisation de la plateforme
--   (une localisation peut avoir plusieurs dépôts) ; accès accordé utilisateur par utilisateur (warehouse_users)
-- - Catalogue d'articles (stock_items) PAR ENTREPRISE ; une ligne de réquisition / PO / GRN peut citer
--   un article (sinon texte libre, jamais stocké) — l'article stockable entre en stock à la réception
-- - Journal des mouvements (stock_movements) IMMUABLE (ni UPDATE ni DELETE) ; soldes (stock_balances)
--   tenus par trigger, par article × dépôt × lot, jamais négatifs
-- - Lots (stock_lots) : n° de lot + péremption, par article
-- - Suivi des livraisons : chaque ligne de GRN cite sa ligne de PO (po_item_id) → vue v_po_item_delivery
--   (commandé / reçu / accepté / rejeté / reste à livrer)
-- - Référentiels de la plateforme : `code` stable sur les catégories de marché et les localisations
--   (identique dans toutes les bases ; l'id reste la clé technique)
--
-- Idempotent : peut être rejoué sur une base existante.
-- ============================================

-- --------------------------------------------
-- 1. Référentiels : codes stables + catégories stockables
-- --------------------------------------------
ALTER TABLE market_categories ADD COLUMN IF NOT EXISTS code VARCHAR(50);
ALTER TABLE market_categories ADD COLUMN IF NOT EXISTS is_stockable BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS code VARCHAR(50);

WITH v(name, code, stockable) AS (VALUES
    ('Construction et réhabilitation WASH', 'WASH_WORKS', FALSE),
    ('Fournitures de bureau', 'OFFICE_SUPPLIES', TRUE),
    ('Équipements de bureau', 'OFFICE_EQUIPMENT', TRUE),
    ('Hôtellerie', 'HOTEL', FALSE),
    ('Restauration et location de salle de formation', 'CATERING_VENUE', FALSE),
    ('Location de véhicule de transport de personnes', 'PASSENGER_VEHICLE_RENTAL', FALSE),
    ('Location de véhicule de transport de marchandises', 'GOODS_VEHICLE_RENTAL', FALSE),
    ('Matériel IT et de communication', 'IT_EQUIPMENT', TRUE),
    ('Visibilité et imprimerie', 'VISIBILITY_PRINTING', TRUE),
    ('Matériel WASH / PCI', 'WASH_IPC_SUPPLIES', TRUE),
    ('Matériel de construction', 'CONSTRUCTION_MATERIALS', TRUE),
    ('Carburant', 'FUEL', TRUE),
    ('Mobilier de bureau', 'OFFICE_FURNITURE', TRUE),
    ('Logiciels et licences', 'SOFTWARE_LICENCES', FALSE),
    ('Services de télécommunication et internet', 'TELECOM_SERVICES', FALSE),
    ('Énergie solaire et équipements électriques', 'SOLAR_ELECTRICAL', TRUE),
    ('Groupes électrogènes et maintenance', 'GENERATORS', TRUE),
    ('Achat de véhicules et motos', 'VEHICLES', FALSE),
    ('Entretien, réparation et pièces de véhicules', 'VEHICLE_MAINTENANCE_PARTS', TRUE),
    ('Transport et logistique (fret)', 'FREIGHT', FALSE),
    ('Transport fluvial et location de bateaux', 'RIVER_TRANSPORT', FALSE),
    ('Billetterie et agence de voyage', 'TRAVEL', FALSE),
    ('Location de bureaux et de logements', 'PREMISES_RENTAL', FALSE),
    ('Travaux de génie civil et routes', 'CIVIL_WORKS', FALSE),
    ('Entretien et réparation des bâtiments', 'BUILDING_MAINTENANCE', FALSE),
    ('Gardiennage et sécurité', 'SECURITY_SERVICES', FALSE),
    ('Nettoyage et entretien des locaux', 'CLEANING_SERVICES', FALSE),
    ('Matériel médical et produits pharmaceutiques', 'MEDICAL_SUPPLIES', TRUE),
    ('Équipements de terrain et de camping', 'FIELD_EQUIPMENT', TRUE),
    ('Uniformes et équipements de protection', 'UNIFORMS_PPE', TRUE),
    ('Intrants agricoles et semences', 'AGRI_INPUTS', TRUE),
    ('Plants et matériel de reboisement', 'REFORESTATION', TRUE),
    ('Vivres et produits alimentaires', 'FOOD', TRUE),
    ('Consultance et études', 'CONSULTANCY', FALSE),
    ('Formation et renforcement des capacités', 'TRAINING', FALSE),
    ('Audit et services comptables', 'AUDIT', FALSE),
    ('Services juridiques', 'LEGAL', FALSE),
    ('Assurances', 'INSURANCE', FALSE),
    ('Services financiers et transfert d''argent', 'FINANCIAL_SERVICES', FALSE),
    ('Production audiovisuelle et communication', 'AUDIOVISUAL', FALSE),
    ('Organisation d''événements', 'EVENTS', FALSE)
)
UPDATE market_categories c SET code = v.code, is_stockable = v.stockable
FROM v WHERE LOWER(c.name) = LOWER(v.name) AND c.code IS NULL;

-- Catégories ajoutées par le super admin : code dérivé de l'id (modifiable ensuite)
UPDATE market_categories SET code = 'CAT_' || id WHERE code IS NULL;

-- Localisations : code = nom en majuscules sans accents ni espaces (ex. MBANZA-NGUNGU)
UPDATE locations
SET code = UPPER(REGEXP_REPLACE(
      TRANSLATE(name, 'ÀÁÂÄÃÇÈÉÊËÌÍÎÏÑÒÓÔÖÕÙÚÛÜàáâäãçèéêëìíîïñòóôöõùúûü', 'AAAAACEEEEIIIINOOOOOUUUUaaaaaceeeeiiiinooooouuuu'),
      '[^A-Za-z0-9-]+', '_', 'g'))
WHERE code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_market_categories_code ON market_categories (UPPER(code));
CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_code ON locations (UPPER(code));
ALTER TABLE market_categories ALTER COLUMN code SET NOT NULL;
ALTER TABLE locations ALTER COLUMN code SET NOT NULL;

-- --------------------------------------------
-- 2. Quantités décimales (carburant en litres, ciment en tonnes…)
-- --------------------------------------------
-- Seulement si encore en INTEGER (au 2e passage, la vue v_po_item_delivery dépend déjà de ces colonnes)
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN SELECT table_name, column_name FROM information_schema.columns
           WHERE (table_name, column_name) IN (('purchase_order_items', 'quantity'),
                                               ('goods_receipt_items', 'quantity_received'),
                                               ('goods_receipt_items', 'quantity_accepted'),
                                               ('goods_receipt_items', 'quantity_rejected'))
             AND data_type = 'integer'
  LOOP
    EXECUTE format('DROP VIEW IF EXISTS v_po_item_delivery');
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE DECIMAL(19,4)', c.table_name, c.column_name);
  END LOOP;
END $$;

-- --------------------------------------------
-- 3. Dépôts et accès
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enterprise_id UUID NOT NULL REFERENCES enterprise(id),
    location_id INTEGER NOT NULL REFERENCES locations(id),
    code VARCHAR(30) NOT NULL,
    name VARCHAR(150) NOT NULL,
    address TEXT,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_enterprise_code ON warehouses (enterprise_id, UPPER(code));
CREATE INDEX IF NOT EXISTS idx_warehouses_location ON warehouses (location_id);

CREATE TABLE IF NOT EXISTS warehouse_users (
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (warehouse_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_warehouse_users_user ON warehouse_users (user_id);

-- --------------------------------------------
-- 4. Catalogue d'articles et lots
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS stock_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enterprise_id UUID NOT NULL REFERENCES enterprise(id),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    unit VARCHAR(30) NOT NULL DEFAULT 'pce',
    category_id INTEGER REFERENCES market_categories(id),
    is_stockable BOOLEAN NOT NULL DEFAULT TRUE,
    track_lots BOOLEAN NOT NULL DEFAULT FALSE,
    track_expiry BOOLEAN NOT NULL DEFAULT FALSE,
    min_quantity DECIMAL(19,4),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT stock_items_expiry_needs_lots CHECK (NOT track_expiry OR track_lots),
    CONSTRAINT stock_items_lots_need_stock CHECK (is_stockable OR NOT track_lots)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_items_enterprise_code ON stock_items (enterprise_id, UPPER(code));
CREATE INDEX IF NOT EXISTS idx_stock_items_category ON stock_items (category_id);
CREATE INDEX IF NOT EXISTS idx_stock_items_name ON stock_items (enterprise_id, LOWER(name));

CREATE TABLE IF NOT EXISTS stock_lots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enterprise_id UUID NOT NULL REFERENCES enterprise(id),
    stock_item_id UUID NOT NULL REFERENCES stock_items(id),
    lot_number VARCHAR(100) NOT NULL,
    expiry_date DATE,
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_lots_item_number ON stock_lots (stock_item_id, UPPER(lot_number));
CREATE INDEX IF NOT EXISTS idx_stock_lots_expiry ON stock_lots (enterprise_id, expiry_date);

-- --------------------------------------------
-- 5. Mouvements (journal immuable) et soldes
-- --------------------------------------------
CREATE SEQUENCE IF NOT EXISTS stock_movement_seq;

CREATE TABLE IF NOT EXISTS stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movement_number VARCHAR(30) NOT NULL UNIQUE
        DEFAULT ('MVT-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(NEXTVAL('stock_movement_seq')::TEXT, 6, '0')),
    enterprise_id UUID NOT NULL REFERENCES enterprise(id),
    stock_item_id UUID NOT NULL REFERENCES stock_items(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    lot_id UUID REFERENCES stock_lots(id),
    movement_type VARCHAR(30) NOT NULL,
    quantity DECIMAL(19,4) NOT NULL,          -- signée : + entrée, - sortie
    unit_cost DECIMAL(19,4),
    currency_id INTEGER REFERENCES currency(id),
    source_type VARCHAR(30),                  -- 'GRN', …
    source_id VARCHAR(64),
    source_line_id VARCHAR(64),
    comment TEXT,
    performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    performed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT stock_movements_type_check CHECK (movement_type IN
        ('OPENING', 'RECEIPT', 'RECEIPT_REVERSAL', 'ISSUE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT')),
    CONSTRAINT stock_movements_sign_check CHECK (
        (movement_type IN ('OPENING', 'RECEIPT', 'TRANSFER_IN', 'ADJUSTMENT_IN') AND quantity > 0)
     OR (movement_type IN ('RECEIPT_REVERSAL', 'ISSUE', 'TRANSFER_OUT', 'ADJUSTMENT_OUT') AND quantity < 0))
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements (stock_item_id, performed_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_warehouse ON stock_movements (warehouse_id, performed_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_source ON stock_movements (source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_enterprise ON stock_movements (enterprise_id, performed_at);

CREATE TABLE IF NOT EXISTS stock_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enterprise_id UUID NOT NULL REFERENCES enterprise(id),
    stock_item_id UUID NOT NULL REFERENCES stock_items(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    lot_id UUID REFERENCES stock_lots(id),
    quantity DECIMAL(19,4) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT stock_balances_non_negative CHECK (quantity >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_balances_key
    ON stock_balances (stock_item_id, warehouse_id, COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::UUID));
CREATE INDEX IF NOT EXISTS idx_stock_balances_warehouse ON stock_balances (warehouse_id);

-- Contrôles d'un mouvement : même entreprise partout, article stockable, lot de l'article, lot obligatoire si suivi
CREATE OR REPLACE FUNCTION stock_movement_check() RETURNS trigger AS $$
DECLARE
  wh RECORD; it RECORD; lt RECORD;
BEGIN
  SELECT enterprise_id INTO wh FROM warehouses WHERE id = NEW.warehouse_id;
  SELECT enterprise_id, is_stockable, track_lots INTO it FROM stock_items WHERE id = NEW.stock_item_id;
  IF NEW.enterprise_id IS NULL THEN NEW.enterprise_id := wh.enterprise_id; END IF;
  IF wh.enterprise_id IS DISTINCT FROM NEW.enterprise_id OR it.enterprise_id IS DISTINCT FROM NEW.enterprise_id THEN
    RAISE EXCEPTION 'stock_movements : dépôt, article et mouvement doivent appartenir à la même entreprise';
  END IF;
  IF NOT it.is_stockable THEN
    RAISE EXCEPTION 'stock_movements : article non stockable';
  END IF;
  IF it.track_lots AND NEW.lot_id IS NULL THEN
    RAISE EXCEPTION 'stock_movements : n° de lot obligatoire pour cet article';
  END IF;
  IF NEW.lot_id IS NOT NULL THEN
    SELECT stock_item_id INTO lt FROM stock_lots WHERE id = NEW.lot_id;
    IF lt.stock_item_id IS DISTINCT FROM NEW.stock_item_id THEN
      RAISE EXCEPTION 'stock_movements : le lot n''appartient pas à cet article';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Solde par article × dépôt × lot (verrou de ligne : mouvements concurrents sérialisés ; jamais négatif).
-- Ligne de solde créée à 0 si absente, PUIS mise à jour : la contrainte quantity >= 0 porte sur le solde
-- obtenu (un INSERT … ON CONFLICT vérifierait la ligne proposée, négative pour une sortie).
CREATE OR REPLACE FUNCTION stock_movement_apply() RETURNS trigger AS $$
BEGIN
  INSERT INTO stock_balances (enterprise_id, stock_item_id, warehouse_id, lot_id, quantity, updated_at)
  VALUES (NEW.enterprise_id, NEW.stock_item_id, NEW.warehouse_id, NEW.lot_id, 0, CURRENT_TIMESTAMP)
  ON CONFLICT (stock_item_id, warehouse_id, COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::UUID)) DO NOTHING;
  UPDATE stock_balances
  SET quantity = quantity + NEW.quantity, updated_at = CURRENT_TIMESTAMP
  WHERE stock_item_id = NEW.stock_item_id AND warehouse_id = NEW.warehouse_id
    AND COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::UUID) = COALESCE(NEW.lot_id, '00000000-0000-0000-0000-000000000000'::UUID);
  RETURN NEW;
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'STOCK_INSUFFICIENT : stock insuffisant pour ce mouvement' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stock_movement_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements est un journal immuable : passer une écriture inverse';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_movement_check ON stock_movements;
CREATE TRIGGER trg_stock_movement_check BEFORE INSERT ON stock_movements
    FOR EACH ROW EXECUTE FUNCTION stock_movement_check();
DROP TRIGGER IF EXISTS trg_stock_movement_apply ON stock_movements;
CREATE TRIGGER trg_stock_movement_apply AFTER INSERT ON stock_movements
    FOR EACH ROW EXECUTE FUNCTION stock_movement_apply();
DROP TRIGGER IF EXISTS trg_stock_movement_immutable ON stock_movements;
CREATE TRIGGER trg_stock_movement_immutable BEFORE UPDATE OR DELETE ON stock_movements
    FOR EACH ROW EXECUTE FUNCTION stock_movement_immutable();

-- --------------------------------------------
-- 6. Lien des documents d'achat au catalogue et suivi des livraisons
-- --------------------------------------------
ALTER TABLE requisition_items ADD COLUMN IF NOT EXISTS stock_item_id UUID REFERENCES stock_items(id) ON DELETE SET NULL;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS stock_item_id UUID REFERENCES stock_items(id) ON DELETE SET NULL;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS requisition_item_id INTEGER REFERENCES requisition_items(id) ON DELETE SET NULL;
ALTER TABLE goods_receipt_notes ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id);
ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS po_item_id INTEGER REFERENCES purchase_order_items(id) ON DELETE SET NULL;
ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS stock_item_id UUID REFERENCES stock_items(id) ON DELETE SET NULL;
ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES stock_lots(id);
ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS stock_movement_id UUID REFERENCES stock_movements(id);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_items_po_item ON goods_receipt_items (po_item_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_stock_item ON purchase_order_items (stock_item_id);
CREATE INDEX IF NOT EXISTS idx_requisition_items_stock_item ON requisition_items (stock_item_id);

-- Reprise : lignes de GRN existantes rattachées à LEUR ligne de PO quand la désignation est sans ambiguïté
UPDATE goods_receipt_items gi
SET po_item_id = (
    SELECT pi.id FROM purchase_order_items pi
    WHERE pi.purchase_order_id = g.po_id AND LOWER(TRIM(pi.item_description)) = LOWER(TRIM(gi.item_description)))
FROM goods_receipt_notes g
WHERE g.id = gi.grn_id AND gi.po_item_id IS NULL
  AND (SELECT COUNT(*) FROM purchase_order_items pi
       WHERE pi.purchase_order_id = g.po_id AND LOWER(TRIM(pi.item_description)) = LOWER(TRIM(gi.item_description))) = 1;

-- Suivi des livraisons par ligne de PO : reste à livrer = commandé - accepté (le rejeté reste dû)
CREATE OR REPLACE VIEW v_po_item_delivery AS
SELECT pi.id AS po_item_id,
       pi.purchase_order_id,
       pi.quantity AS quantity_ordered,
       COALESCE(SUM(gi.quantity_received) FILTER (WHERE g.status IS DISTINCT FROM 'CANCELLED'), 0) AS quantity_received,
       COALESCE(SUM(gi.quantity_accepted) FILTER (WHERE g.status IS DISTINCT FROM 'CANCELLED'), 0) AS quantity_accepted,
       COALESCE(SUM(gi.quantity_rejected) FILTER (WHERE g.status IS DISTINCT FROM 'CANCELLED'), 0) AS quantity_rejected,
       GREATEST(pi.quantity - COALESCE(SUM(gi.quantity_accepted) FILTER (WHERE g.status IS DISTINCT FROM 'CANCELLED'), 0), 0) AS quantity_remaining,
       COUNT(DISTINCT g.id) FILTER (WHERE g.status IS DISTINCT FROM 'CANCELLED') AS receipt_count,
       MAX(g.receipt_date) FILTER (WHERE g.status IS DISTINCT FROM 'CANCELLED') AS last_receipt_date
FROM purchase_order_items pi
LEFT JOIN goods_receipt_items gi ON gi.po_item_id = pi.id
LEFT JOIN goods_receipt_notes g ON g.id = gi.grn_id
GROUP BY pi.id, pi.purchase_order_id, pi.quantity;

-- --------------------------------------------
-- 7. Multi-entreprise : enterprise_id rempli depuis le parent (fonction de 07, complétée)
-- --------------------------------------------
CREATE OR REPLACE FUNCTION fill_enterprise_id() RETURNS trigger AS $$
BEGIN
  IF NEW.enterprise_id IS NOT NULL THEN RETURN NEW; END IF;
  CASE TG_TABLE_NAME
    WHEN 'departments' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM users WHERE id = NEW.created_by;
    WHEN 'projects' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM users WHERE id = NEW.created_by;
    WHEN 'budget_allocations' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM projects WHERE id = NEW.project_id;
    WHEN 'requisitions' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM projects WHERE id = NEW.project_id;
      IF NEW.enterprise_id IS NULL THEN
        SELECT enterprise_id INTO NEW.enterprise_id FROM users WHERE id = NEW.requester_id;
      END IF;
    WHEN 'purchase_orders' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM requisitions WHERE id = NEW.requisition_id;
      IF NEW.enterprise_id IS NULL THEN
        SELECT enterprise_id INTO NEW.enterprise_id FROM users WHERE id = NEW.created_by;
      END IF;
    WHEN 'goods_receipt_notes', 'service_acceptance_notes', 'invoices' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM purchase_orders WHERE id = NEW.po_id;
    WHEN 'payments' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM invoices WHERE id = NEW.invoice_id;
      IF NEW.enterprise_id IS NULL THEN
        SELECT enterprise_id INTO NEW.enterprise_id FROM purchase_orders WHERE id = NEW.po_id;
      END IF;
    WHEN 'tenders' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM requisitions WHERE id = NEW.requisition_id;
    WHEN 'supplier_evaluations' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM users WHERE id = NEW.evaluator_id;
    WHEN 'warehouses', 'stock_items' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM users WHERE id = NEW.created_by;
    WHEN 'stock_lots' THEN
      SELECT enterprise_id INTO NEW.enterprise_id FROM stock_items WHERE id = NEW.stock_item_id;
    ELSE NULL;
  END CASE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['warehouses', 'stock_items', 'stock_lots']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_fill_enterprise ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_fill_enterprise BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION fill_enterprise_id()', t);
  END LOOP;
END $$;

-- --------------------------------------------
-- 8. Permissions
-- --------------------------------------------
INSERT INTO permissions (id, name, description, resource, action)
SELECT * FROM (VALUES
    ('perm_manage_warehouses', 'MANAGE_WAREHOUSES', 'Gérer les dépôts et leurs accès', 'stock', 'admin'),
    ('perm_manage_stock_items', 'MANAGE_STOCK_ITEMS', 'Gérer le catalogue d''articles', 'stock', 'write'),
    ('perm_view_stock', 'VIEW_STOCK', 'Consulter le stock et les mouvements', 'stock', 'read')
) AS tmp(id, name, description, resource, action)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.name = tmp.name);

INSERT INTO profile_permissions (profile_id, permission_id)
SELECT pr.id, p.id
FROM (VALUES
    ('prof_admin', 'MANAGE_WAREHOUSES'), ('prof_admin', 'MANAGE_STOCK_ITEMS'), ('prof_admin', 'VIEW_STOCK'),
    ('prof_logistic', 'MANAGE_STOCK_ITEMS'), ('prof_logistic', 'VIEW_STOCK'),
    ('prof_procurement', 'MANAGE_STOCK_ITEMS'), ('prof_procurement', 'VIEW_STOCK'),
    ('prof_finance', 'VIEW_STOCK'), ('prof_management', 'VIEW_STOCK')
) AS pr(id, perm)
JOIN permissions p ON p.name = pr.perm
WHERE EXISTS (SELECT 1 FROM profiles WHERE id = pr.id)
  AND NOT EXISTS (SELECT 1 FROM profile_permissions pp WHERE pp.profile_id = pr.id AND pp.permission_id = p.id);
