-- ============================================================================
-- 33_direct_purchase_selection.sql — Achat direct : fournisseur désigné + pro-forma (idempotente)
-- ----------------------------------------------------------------------------
-- L'étape « Achat direct » (Activity_DirectPurchase) se terminait avec un simple commentaire. Elle exige désormais
-- le fournisseur retenu et sa facture pro-forma (pièce jointe de la réquisition) : une ligne par étape terminée
-- (une réquisition peut repasser par l'étape : la plus récente fait foi). Le bon de commande propose d'office ce
-- fournisseur. Aucun changement du BPMN.
-- ============================================================================

CREATE TABLE IF NOT EXISTS direct_purchase_selections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requisition_id UUID NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
    enterprise_id UUID REFERENCES enterprise(id),
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    proforma_attachment_id UUID REFERENCES attachments(id) ON DELETE SET NULL,
    proforma_number VARCHAR(100),
    proforma_date DATE,
    proforma_amount DECIMAL(15,2),
    currency VARCHAR(3),
    comment TEXT,
    task_id VARCHAR(100),
    selected_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_direct_purchase_requisition ON direct_purchase_selections (requisition_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_direct_purchase_enterprise ON direct_purchase_selections (enterprise_id);

-- Entreprise reprise de la réquisition (fonction propre : fill_enterprise_id n'est pas redéfinie ici)
CREATE OR REPLACE FUNCTION fill_enterprise_from_requisition() RETURNS trigger AS $$
BEGIN
  IF NEW.enterprise_id IS NULL THEN
    SELECT enterprise_id INTO NEW.enterprise_id FROM requisitions WHERE id = NEW.requisition_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fill_enterprise ON direct_purchase_selections;
CREATE TRIGGER trg_fill_enterprise BEFORE INSERT ON direct_purchase_selections
  FOR EACH ROW EXECUTE FUNCTION fill_enterprise_from_requisition();
