-- ============================================================================
-- 55_stock_planning.sql — Prévision du réapprovisionnement (idempotente)
-- ----------------------------------------------------------------------------
-- Choix de l'utilisateur (2026-11-09, idée reprise du module de stock de BHIMA) :
--  - calcul par article × dépôt (+ total de l'entreprise) ;
--  - consommation = sorties vers un employé / un département (ISSUE), moins leurs annulations et les retours ;
--    pertes, ajustements et transferts n'en font pas partie ;
--  - consommation moyenne mensuelle (CMM) hors jours de rupture, sur une période réglable (6 mois par défaut) ;
--  - minimum = CMM × (stock de sécurité + délai de livraison), maximum = minimum + CMM × fréquence de commande,
--    à commander = maximum − (stock + en commande + demandé) quand cette position atteint le minimum.
-- Le calcul est fait à la demande (services/StockPlanningService) : aucune table de cumul.
-- ============================================================================

-- Paramètres de l'entreprise (valeurs par défaut des dépôts et des articles)
ALTER TABLE enterprise ADD COLUMN IF NOT EXISTS stock_amc_months SMALLINT NOT NULL DEFAULT 6;
ALTER TABLE enterprise ADD COLUMN IF NOT EXISTS stock_safety_months NUMERIC(6,2) NOT NULL DEFAULT 2;
ALTER TABLE enterprise ADD COLUMN IF NOT EXISTS stock_order_interval_months NUMERIC(6,2) NOT NULL DEFAULT 1;
ALTER TABLE enterprise ADD COLUMN IF NOT EXISTS stock_lead_time_days INTEGER NOT NULL DEFAULT 30;

ALTER TABLE enterprise DROP CONSTRAINT IF EXISTS enterprise_stock_planning_check;
ALTER TABLE enterprise ADD CONSTRAINT enterprise_stock_planning_check CHECK (
  stock_amc_months BETWEEN 1 AND 24
  AND stock_safety_months BETWEEN 0 AND 24
  AND stock_order_interval_months BETWEEN 0 AND 24
  AND stock_lead_time_days BETWEEN 0 AND 365);

-- Stock de sécurité propre à un dépôt (mois de consommation ; vide = valeur de l'entreprise)
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS safety_stock_months NUMERIC(6,2);
ALTER TABLE warehouses DROP CONSTRAINT IF EXISTS warehouses_safety_stock_check;
ALTER TABLE warehouses ADD CONSTRAINT warehouses_safety_stock_check CHECK (safety_stock_months IS NULL OR safety_stock_months BETWEEN 0 AND 24);

-- Délai de livraison propre à un article (jours entre la commande et la réception ; vide = valeur de l'entreprise)
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS lead_time_days INTEGER;
ALTER TABLE stock_items DROP CONSTRAINT IF EXISTS stock_items_lead_time_check;
ALTER TABLE stock_items ADD CONSTRAINT stock_items_lead_time_check CHECK (lead_time_days IS NULL OR lead_time_days BETWEEN 0 AND 365);

-- Dépôt où arrivera l'article commandé (réquisition de réapprovisionnement) : la ligne de bon de commande est
-- rattachée à sa ligne de réquisition (requisition_item_id), la quantité en commande est donc connue par dépôt
ALTER TABLE requisition_items ADD COLUMN IF NOT EXISTS destination_warehouse_id UUID REFERENCES warehouses(id);
CREATE INDEX IF NOT EXISTS idx_requisition_items_destination ON requisition_items (destination_warehouse_id) WHERE destination_warehouse_id IS NOT NULL;

-- Garde-fou : dépôt de la même entreprise que la réquisition, ligne citant un article du catalogue
CREATE OR REPLACE FUNCTION requisition_item_destination_check() RETURNS trigger AS $$
DECLARE
  v_req_enterprise UUID;
  v_wh_enterprise UUID;
BEGIN
  IF NEW.destination_warehouse_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.stock_item_id IS NULL THEN
    RAISE EXCEPTION 'Dépôt de destination sans article du catalogue' USING ERRCODE = 'check_violation';
  END IF;
  SELECT enterprise_id INTO v_req_enterprise FROM requisitions WHERE id = NEW.requisition_id;
  SELECT enterprise_id INTO v_wh_enterprise FROM warehouses WHERE id = NEW.destination_warehouse_id;
  IF v_req_enterprise IS DISTINCT FROM v_wh_enterprise THEN
    RAISE EXCEPTION 'Dépôt de destination d''une autre entreprise' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_requisition_item_destination ON requisition_items;
CREATE TRIGGER trg_requisition_item_destination
  BEFORE INSERT OR UPDATE OF destination_warehouse_id, stock_item_id ON requisition_items
  FOR EACH ROW EXECUTE FUNCTION requisition_item_destination_check();

-- Lecture des sorties par article × dépôt × date (calcul de la consommation)
CREATE INDEX IF NOT EXISTS idx_stock_movements_item_wh_date ON stock_movements (stock_item_id, warehouse_id, performed_at);
