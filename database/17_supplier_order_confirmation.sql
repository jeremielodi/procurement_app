-- ============================================
-- CONFIRMATION DE COMMANDE PAR LE FOURNISSEUR (étape GoFlow Activity_SupplierConfirmation)
-- - Le fournisseur confirme (date de livraison promise, sa référence) ou décline (motif) depuis son portail ;
--   les achats peuvent aussi enregistrer la confirmation reçue par téléphone / email (source PROCUREMENT)
-- - Confirmation → PO_CONFIRMED + tâche GoFlow complétée ; refus → tâche laissée ouverte, achats prévenus
-- Idempotent : peut être rejoué sur une base existante.
-- ============================================

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_response VARCHAR(20);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_responded_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_responded_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_response_source VARCHAR(20);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS confirmed_delivery_date DATE;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_reference VARCHAR(100);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_comment TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_supplier_response_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_supplier_response_check CHECK (
    (supplier_response IS NULL AND supplier_responded_at IS NULL)
 OR (supplier_response IN ('CONFIRMED', 'DECLINED') AND supplier_responded_at IS NOT NULL
     AND supplier_response_source IN ('PORTAL', 'PROCUREMENT')));

-- Commandes attendant la réponse du fournisseur (portail, relances)
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_status ON purchase_orders (supplier_id, status);

-- Historique : les commandes déjà réceptionnées ont, de fait, été confirmées
UPDATE purchase_orders po
   SET supplier_response = 'CONFIRMED', supplier_responded_at = COALESCE(po.approved_at, po.updated_at, po.created_at),
       supplier_response_source = 'PROCUREMENT'
 WHERE po.supplier_response IS NULL
   AND EXISTS (SELECT 1 FROM goods_receipt_notes g WHERE g.po_id = po.id);
