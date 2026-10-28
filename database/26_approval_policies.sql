-- ============================================================================
-- 26_approval_policies.sql — Seuils d'approbation N1 / N2 / N3 par projet (idempotente)
-- ----------------------------------------------------------------------------
-- Politique effective d'une réquisition : celle de son projet, sinon celle de l'entreprise, sinon 25 000 / 100 000.
--   montant < n1_max           → N1 (Manager)
--   n1_max ≤ montant < n2_max  → N2 (Finance)      — n1_max = n2_max : pas de niveau N2
--   montant ≥ n2_max           → N3 (DG)
-- Le niveau est calculé par le serveur à la vérification du budget (worker check_budget) et transmis à BpmnGo
-- (variable approvalLevel, lue par Gateway_AmountDecision) : changer une politique ne demande aucun redéploiement.
-- Une réquisition déjà en attente d'approbation garde son niveau ; la politique appliquée est conservée.
-- ============================================================================

ALTER TABLE projects ADD COLUMN IF NOT EXISTS approval_n1_max NUMERIC(19,4);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS approval_n2_max NUMERIC(19,4);
ALTER TABLE enterprise ADD COLUMN IF NOT EXISTS approval_n1_max NUMERIC(19,4);
ALTER TABLE enterprise ADD COLUMN IF NOT EXISTS approval_n2_max NUMERIC(19,4);

-- Les deux seuils ensemble (ou aucun : politique héritée), positifs et croissants
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_approval_policy_check') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_approval_policy_check CHECK (
      (approval_n1_max IS NULL AND approval_n2_max IS NULL)
      OR (approval_n1_max > 0 AND approval_n2_max >= approval_n1_max));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enterprise_approval_policy_check') THEN
    ALTER TABLE enterprise ADD CONSTRAINT enterprise_approval_policy_check CHECK (
      (approval_n1_max IS NULL AND approval_n2_max IS NULL)
      OR (approval_n1_max > 0 AND approval_n2_max >= approval_n1_max));
  END IF;
END $$;

-- Niveau retenu pour la réquisition et politique appliquée ({ n1Max, n2Max, source: PROJECT | ENTERPRISE | DEFAULT })
ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS approval_level VARCHAR(2) CHECK (approval_level IN ('N1', 'N2', 'N3'));
ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS approval_policy JSONB;
