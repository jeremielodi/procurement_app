-- ============================================
-- LIVRAISONS PARTIELLES : RELIQUAT SOLDÉ
-- Workflow (BPMN) : pour chaque livraison, SAN (demandeur) puis GRN (logistique) ; tant qu'il reste à livrer,
-- une nouvelle SAN puis un nouveau GRN sont demandés. Quand le fournisseur ne livrera pas le reste, la
-- logistique « solde le reliquat » (motif obligatoire) : la livraison est alors considérée complète et la
-- facture est demandée. Plus aucune réception n'est acceptée sur un PO soldé.
-- delivery_status calculé : CLOSED_SHORT = soldé avant la livraison complète (PurchaseOrderModel)
-- Idempotent : peut être rejoué sur une base existante (après 22_daily_requisition_report.sql).
-- ============================================

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS delivery_closed_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS delivery_closed_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS delivery_close_reason TEXT;
