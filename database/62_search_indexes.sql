-- ============================================================================
-- 62_search_indexes.sql — Index pour accélérer les recherches, les listes et les fiches (idempotente)
-- ----------------------------------------------------------------------------
-- 1. Clés étrangères utilisées dans les jointures mais sans index (lignes d'une réquisition, d'un bon de commande,
--    d'une réception… chargées par chaque fiche, PDF, contrôle de quantité et trigger budgétaire)
-- 2. Recherches texte « contient » (ILIKE '%…%') : un index B-tree ne sert à rien → extension pg_trgm et index
--    GIN par trigrammes sur les colonnes cherchées (n° de documents, noms, emails, codes, n° de série…)
-- 3. Listes cloisonnées par entreprise et triées par date de création (index composites)
-- Index créés sans CONCURRENTLY (comme les autres migrations) : verrou d'écriture le temps de la création, court
-- pour les volumes de l'application. pg_trgm est fourni avec PostgreSQL (« trusted » depuis la v13).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- 1. Clés étrangères des jointures fréquentes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_requisition_items_requisition   ON requisition_items (requisition_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po          ON purchase_order_items (purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_req_item    ON purchase_order_items (requisition_item_id) WHERE requisition_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_goods_receipt_items_grn          ON goods_receipt_items (grn_id);
CREATE INDEX IF NOT EXISTS idx_payments_po                      ON payments (po_id);
CREATE INDEX IF NOT EXISTS idx_invoices_supplier                ON invoices (supplier_id);
CREATE INDEX IF NOT EXISTS idx_users_enterprise                 ON users (enterprise_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_profile            ON user_profiles (profile_id);
CREATE INDEX IF NOT EXISTS idx_supplier_preq_supplier           ON supplier_prequalifications (supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_doc_reviews_document    ON supplier_document_reviews (document_id);
CREATE INDEX IF NOT EXISTS idx_tender_submission_items_req_item ON tender_submission_items (requisition_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_units_grn_item             ON stock_units (grn_item_id) WHERE grn_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_movements_lot              ON stock_movements (lot_id) WHERE lot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_balances_lot               ON stock_balances (lot_id) WHERE lot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_warehouse      ON stock_adjustments (warehouse_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_returns_warehouse          ON stock_returns (warehouse_id);

-- Historique du workflow : tâche créée sans tâche terminée (« Qui bloque ? », tableau de bord, rapport quotidien)
CREATE INDEX IF NOT EXISTS idx_workflow_task_action ON workflow_history (task_id, action) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_action_date ON workflow_history (action, performed_at);

-- ---------------------------------------------------------------------------
-- 2. Recherches « contient » (ILIKE '%…%') — index trigrammes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS trgm_requisitions_number   ON requisitions        USING gin (requisition_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_requisitions_title    ON requisitions        USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_purchase_orders_number ON purchase_orders    USING gin (po_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_grn_number            ON goods_receipt_notes USING gin (grn_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_invoices_number       ON invoices            USING gin (invoice_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_tenders_number        ON tenders             USING gin (tender_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_tenders_title         ON tenders             USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_suppliers_name        ON suppliers           USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_suppliers_code        ON suppliers           USING gin (supplier_code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_suppliers_email       ON suppliers           USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_users_first_name      ON users               USING gin (first_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_users_last_name       ON users               USING gin (last_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_users_email           ON users               USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_budget_entity_code    ON budget_allocations  USING gin (entity_code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_budget_description    ON budget_allocations  USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_stock_items_code      ON stock_items         USING gin (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_stock_items_name      ON stock_items         USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_stock_units_serial    ON stock_units         USING gin (serial_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_stock_units_asset_tag ON stock_units         USING gin (asset_tag gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_stock_lots_number     ON stock_lots          USING gin (lot_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_stock_movements_number ON stock_movements    USING gin (movement_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_stock_issues_number   ON stock_issues        USING gin (issue_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_stock_entries_number  ON stock_entries       USING gin (entry_number gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 3. Listes : entreprise + tri par date de création (la plus récente d'abord)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_requisitions_enterprise_created    ON requisitions             (enterprise_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_enterprise_created ON purchase_orders          (enterprise_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_grn_enterprise_created             ON goods_receipt_notes      (enterprise_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_san_enterprise_created             ON service_acceptance_notes (enterprise_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_enterprise_created        ON invoices                 (enterprise_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_enterprise_created        ON payments                 (enterprise_id, created_at DESC);

-- Statistiques à jour pour que le planificateur choisisse les nouveaux index
ANALYZE requisitions, requisition_items, purchase_orders, purchase_order_items, goods_receipt_notes, goods_receipt_items,
        service_acceptance_notes, invoices, payments, users, user_profiles, suppliers, tenders, budget_allocations,
        stock_items, stock_units, stock_lots, stock_movements, stock_balances, stock_issues, stock_entries, workflow_history;
