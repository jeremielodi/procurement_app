-- ============================================================================
-- 38_supplier_split.sql — Réquisition répartie entre plusieurs fournisseurs (idempotente)
-- ----------------------------------------------------------------------------
-- Les achats peuvent répartir les articles d'une réquisition entre plusieurs fournisseurs (étape GoFlow
-- Activity_AllocateSuppliers) : une « part » par fournisseur, chaque article dans une seule part. Chaque part suit
-- ensuite son propre cycle de commande (sous-processus SubProcess_SupplierOrder du BPMN, répété par part :
-- bon de commande → approbation → envoi → confirmation → SAN / GRN → facture → paiement).
-- La méthode d'achat et le niveau d'approbation restent ceux du montant TOTAL de la réquisition.
-- ============================================================================

CREATE TABLE IF NOT EXISTS requisition_supplier_lots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requisition_id UUID NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
    enterprise_id UUID REFERENCES enterprise(id),
    lot_number INTEGER NOT NULL,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    attachment_id UUID REFERENCES attachments(id) ON DELETE SET NULL,
    amount DECIMAL(15,2),
    justification TEXT,
    po_id INTEGER REFERENCES purchase_orders(id) ON DELETE SET NULL,
    task_id VARCHAR(100),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_supplier_lot_number UNIQUE (requisition_id, lot_number),
    CONSTRAINT uq_supplier_lot_supplier UNIQUE (requisition_id, supplier_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_lots_requisition ON requisition_supplier_lots (requisition_id);
CREATE INDEX IF NOT EXISTS idx_supplier_lots_enterprise ON requisition_supplier_lots (enterprise_id);
CREATE INDEX IF NOT EXISTS idx_supplier_lots_po ON requisition_supplier_lots (po_id);

-- Une ligne de réquisition dans une seule part
CREATE TABLE IF NOT EXISTS requisition_supplier_lot_items (
    lot_id UUID NOT NULL REFERENCES requisition_supplier_lots(id) ON DELETE CASCADE,
    requisition_item_id INTEGER NOT NULL REFERENCES requisition_items(id) ON DELETE CASCADE,
    PRIMARY KEY (lot_id, requisition_item_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_lot_item ON requisition_supplier_lot_items (requisition_item_id);

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_lot_id UUID REFERENCES requisition_supplier_lots(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_lot ON purchase_orders (supplier_lot_id);

-- Entreprise reprise de la réquisition (fonction créée par 33_direct_purchase_selection.sql, redéfinie à l'identique)
CREATE OR REPLACE FUNCTION fill_enterprise_from_requisition() RETURNS trigger AS $$
BEGIN
  IF NEW.enterprise_id IS NULL THEN
    SELECT enterprise_id INTO NEW.enterprise_id FROM requisitions WHERE id = NEW.requisition_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fill_enterprise ON requisition_supplier_lots;
CREATE TRIGGER trg_fill_enterprise BEFORE INSERT ON requisition_supplier_lots
  FOR EACH ROW EXECUTE FUNCTION fill_enterprise_from_requisition();
