-- ============================================================================
-- 63_stock_item_nature.sql — Nature des articles (équipement / consommable) et permissions par nature (idempotente)
-- ----------------------------------------------------------------------------
-- Choix de l'utilisateur (2026-11-11) :
--  - champ « Nature » distinct du suivi par n° de série : EQUIPMENT (bien durable, même sans n° de série :
--    chaise, table…) / CONSUMABLE ; le suivi par n° de série impose EQUIPMENT ;
--  - module Stock seulement (la réquisition garde tout le catalogue) ; deux niveaux par nature :
--    VIEW_EQUIPMENT / VIEW_CONSUMABLES = consultation (logistique, finance, auditeur, direction…) ;
--    MANAGE_EQUIPMENT / MANAGE_CONSUMABLES = opérations (fiche article, réception en stock, entrée, sortie, retour,
--    inventaire, ajustement) ; « gérer » vaut aussi « voir » ; un document mixte n'affiche que les lignes visibles ;
--  - profils ayant une permission de stock : VIEW des deux natures ; profils ayant une opération de stock : MANAGE
--    des deux natures (aucun changement visible) ; deux nouveaux profils dédiés (une seule nature, VIEW + MANAGE).
-- Reprise : article suivi par n° de série → EQUIPMENT, sinon CONSUMABLE.
-- ============================================================================

ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS nature VARCHAR(20);
UPDATE stock_items SET nature = CASE WHEN track_serials THEN 'EQUIPMENT' ELSE 'CONSUMABLE' END WHERE nature IS NULL;
ALTER TABLE stock_items ALTER COLUMN nature SET DEFAULT 'CONSUMABLE';
ALTER TABLE stock_items ALTER COLUMN nature SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_items_nature_check') THEN
    ALTER TABLE stock_items ADD CONSTRAINT stock_items_nature_check
      CHECK (nature IN ('EQUIPMENT', 'CONSUMABLE') AND (NOT track_serials OR nature = 'EQUIPMENT'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_stock_items_nature ON stock_items (enterprise_id, nature);

INSERT INTO permissions (id, name, description, resource, action)
SELECT 'perm_view_equipment', 'VIEW_EQUIPMENT', 'Voir les articles de nature « Équipement » dans le stock (catalogue, état du stock, mouvements, documents)', 'stock', 'view_equipment'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'VIEW_EQUIPMENT');
INSERT INTO permissions (id, name, description, resource, action)
SELECT 'perm_view_consumables', 'VIEW_CONSUMABLES', 'Voir les articles de nature « Consommable » dans le stock (catalogue, état du stock, mouvements, documents)', 'stock', 'view_consumables'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'VIEW_CONSUMABLES');
INSERT INTO permissions (id, name, description, resource, action)
SELECT 'perm_manage_equipment', 'MANAGE_EQUIPMENT', 'Gérer les articles de nature « Équipement » dans le stock (fiche article, entrées, sorties, affectations, retours, inventaires, ajustements)', 'stock', 'manage_equipment'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'MANAGE_EQUIPMENT');
INSERT INTO permissions (id, name, description, resource, action)
SELECT 'perm_manage_consumables', 'MANAGE_CONSUMABLES', 'Gérer les articles de nature « Consommable » dans le stock (fiche article, entrées, sorties, demandes au magasin, inventaires, ajustements)', 'stock', 'manage_consumables'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'MANAGE_CONSUMABLES');
UPDATE permissions SET description = 'Voir les articles de nature « Équipement » dans le stock (catalogue, état du stock, mouvements, documents)', action = 'view_equipment' WHERE name = 'VIEW_EQUIPMENT';
UPDATE permissions SET description = 'Voir les articles de nature « Consommable » dans le stock (catalogue, état du stock, mouvements, documents)', action = 'view_consumables' WHERE name = 'VIEW_CONSUMABLES';

-- Profils qui consultent le stock : voir les deux natures ; profils qui y font des opérations : gérer les deux natures
-- (aucun changement visible)
INSERT INTO profile_permissions (profile_id, permission_id)
SELECT DISTINCT pp.profile_id, n.id FROM profile_permissions pp
JOIN permissions p ON p.id = pp.permission_id
  AND p.name IN ('VIEW_STOCK', 'MANAGE_STOCK_ITEMS', 'ISSUE_STOCK', 'COUNT_STOCK', 'ADJUST_STOCK', 'RECORD_STOCK_ENTRIES', 'VALIDATE_STOCK_ENTRIES', 'RECORD_GOODS_RECEIPT')
JOIN permissions n ON n.name IN ('VIEW_EQUIPMENT', 'VIEW_CONSUMABLES')
WHERE pp.profile_id NOT IN ('prof_equipment_manager', 'prof_consumables_manager')
  AND NOT EXISTS (SELECT 1 FROM profile_permissions x WHERE x.profile_id = pp.profile_id AND x.permission_id = n.id);
INSERT INTO profile_permissions (profile_id, permission_id)
SELECT DISTINCT pp.profile_id, n.id FROM profile_permissions pp
JOIN permissions p ON p.id = pp.permission_id
  AND p.name IN ('MANAGE_STOCK_ITEMS', 'ISSUE_STOCK', 'COUNT_STOCK', 'ADJUST_STOCK', 'RECORD_STOCK_ENTRIES', 'VALIDATE_STOCK_ENTRIES', 'RECORD_GOODS_RECEIPT')
JOIN permissions n ON n.name IN ('MANAGE_EQUIPMENT', 'MANAGE_CONSUMABLES')
WHERE pp.profile_id NOT IN ('prof_equipment_manager', 'prof_consumables_manager')
  AND NOT EXISTS (SELECT 1 FROM profile_permissions x WHERE x.profile_id = pp.profile_id AND x.permission_id = n.id);
INSERT INTO profile_permissions (profile_id, permission_id)
SELECT 'prof_admin', p.id FROM permissions p
WHERE p.name IN ('VIEW_EQUIPMENT', 'VIEW_CONSUMABLES', 'MANAGE_EQUIPMENT', 'MANAGE_CONSUMABLES') AND EXISTS (SELECT 1 FROM profiles WHERE id = 'prof_admin')
  AND NOT EXISTS (SELECT 1 FROM profile_permissions x WHERE x.profile_id = 'prof_admin' AND x.permission_id = p.id);

-- Profils dédiés, liés au projet (migration 65 : stock du projet de financement ; « Tous les projets » possible)
INSERT INTO profiles (id, name, description, project_scoped)
SELECT 'prof_equipment_manager', 'Gestionnaire des équipements', 'Gère les équipements (biens durables) : catalogue, stock, affectations, retours, inventaires — ne voit pas les consommables', true
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'prof_equipment_manager');
INSERT INTO profiles (id, name, description, project_scoped)
SELECT 'prof_consumables_manager', 'Gestionnaire des consommables', 'Gère les consommables : catalogue, stock, sorties, demandes au magasin, inventaires — ne voit pas les équipements', true
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'prof_consumables_manager');

INSERT INTO profile_permissions (profile_id, permission_id)
SELECT pr.id, p.id FROM (VALUES
  ('prof_equipment_manager', 'VIEW_EQUIPMENT'), ('prof_equipment_manager', 'MANAGE_EQUIPMENT'), ('prof_equipment_manager', 'VIEW_STOCK'), ('prof_equipment_manager', 'MANAGE_STOCK_ITEMS'),
  ('prof_equipment_manager', 'ISSUE_STOCK'), ('prof_equipment_manager', 'COUNT_STOCK'), ('prof_equipment_manager', 'RECORD_STOCK_ENTRIES'),
  ('prof_equipment_manager', 'VIEW_DASHBOARD'),
  ('prof_consumables_manager', 'VIEW_CONSUMABLES'), ('prof_consumables_manager', 'MANAGE_CONSUMABLES'), ('prof_consumables_manager', 'VIEW_STOCK'), ('prof_consumables_manager', 'MANAGE_STOCK_ITEMS'),
  ('prof_consumables_manager', 'ISSUE_STOCK'), ('prof_consumables_manager', 'COUNT_STOCK'), ('prof_consumables_manager', 'RECORD_STOCK_ENTRIES'),
  ('prof_consumables_manager', 'VIEW_DASHBOARD')) AS pr(id, perm)
JOIN permissions p ON p.name = pr.perm
WHERE EXISTS (SELECT 1 FROM profiles WHERE id = pr.id)
  AND NOT EXISTS (SELECT 1 FROM profile_permissions pp WHERE pp.profile_id = pr.id AND pp.permission_id = p.id);

-- Inventaire limité à une nature (NULL = tout le dépôt) : un gestionnaire des consommables compte les consommables,
-- un gestionnaire des équipements les équipements, en même temps dans le même dépôt. Un seul inventaire ouvert par
-- dépôt × nature ; le chevauchement (« tout » + une nature) est refusé par StockCountModel.open (dépôt verrouillé).
ALTER TABLE stock_counts ADD COLUMN IF NOT EXISTS nature VARCHAR(20);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_counts_nature_check') THEN
    ALTER TABLE stock_counts ADD CONSTRAINT stock_counts_nature_check CHECK (nature IS NULL OR nature IN ('EQUIPMENT', 'CONSUMABLE'));
  END IF;
END $$;
DROP INDEX IF EXISTS idx_stock_counts_open_warehouse;
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_counts_open_warehouse_nature ON stock_counts (warehouse_id, COALESCE(nature, 'ALL')) WHERE status = 'OPEN';
