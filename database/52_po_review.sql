-- ============================================================================
-- 52_po_review.sql — Révision du bon de commande avant son approbation N1 / N2 / N3 (idempotente)
-- ----------------------------------------------------------------------------
-- BPMN (EN + FR, à redéployer dans BpmnGo) : Activity_CreatePO → Activity_POReview (groupe po_reviewer) →
-- Gateway_POReviewDecision : ${poReviewed == true} → Gateway_POApprovalLevel (N1 / N2 / N3) ;
-- ${poReviewed == false} → Event_POCancelled (bon rejeté, la part s'arrête).
-- Profil « Réviseur des bons de commande » (prof_po_reviewer), profil de workflow lié au projet (project_scoped),
-- permission REVIEW_PURCHASE_ORDERS. Les processus démarrés avant n'ont pas cette étape.
-- ============================================================================

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS review_decision VARCHAR(10);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS review_comment TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_review_decision_check') THEN
    ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_review_decision_check
      CHECK (review_decision IS NULL OR review_decision IN ('APPROVED', 'REJECTED'));
  END IF;
END $$;

INSERT INTO permissions (id, name, description, resource, action)
SELECT 'perm_review_orders', 'REVIEW_PURCHASE_ORDERS', 'Réviser les bons de commande (avant leur approbation N1 / N2 / N3)', 'purchase_order', 'review'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'REVIEW_PURCHASE_ORDERS');

INSERT INTO profiles (id, name, description, project_scoped)
SELECT 'prof_po_reviewer', 'Réviseur des bons de commande', 'Révise chaque bon de commande (approuver ou rejeter) avant son approbation N1 / N2 / N3', true
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'prof_po_reviewer');

INSERT INTO profile_permissions (profile_id, permission_id)
SELECT pr.id, p.id FROM (VALUES ('prof_po_reviewer', 'REVIEW_PURCHASE_ORDERS'), ('prof_admin', 'REVIEW_PURCHASE_ORDERS'),
                                ('prof_po_reviewer', 'VIEW_PURCHASE_ORDERS'), ('prof_po_reviewer', 'VIEW_REQUISITIONS'),
                                ('prof_po_reviewer', 'VIEW_SUPPLIERS'), ('prof_po_reviewer', 'VIEW_DASHBOARD'),
                                ('prof_po_reviewer', 'VIEW_PROJECTS')) AS pr(id, perm)
JOIN permissions p ON p.name = pr.perm
WHERE EXISTS (SELECT 1 FROM profiles WHERE id = pr.id)
  AND NOT EXISTS (SELECT 1 FROM profile_permissions pp WHERE pp.profile_id = pr.id AND pp.permission_id = p.id);
