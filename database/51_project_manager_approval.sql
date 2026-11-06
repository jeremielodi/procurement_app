-- ============================================================================
-- 51_project_manager_approval.sql — Validation par le chef de projet, N1 / N2 / N3 sur la commande (idempotente)
-- ----------------------------------------------------------------------------
-- Nouveau circuit (BPMN du 2026-11-06, EN + FR à redéployer dans BpmnGo) :
--   * la réquisition est validée par le seul chef du projet (budget holder, projects.project_manager_id) —
--     étape Activity_ProjectManagerApproval ; projet et chef de projet obligatoires pour toute nouvelle réquisition ;
--   * les approbations N1 / N2 / N3 portent sur le bon de commande, au niveau donné par son montant et les seuils du
--     projet (sinon de l'entreprise, sinon 25 000 / 100 000) — étapes Activity_POApprovalN1 / N2 / N3, qui
--     remplacent l'approbation du bon de commande par la Direction (Activity_POApproval).
-- Les processus démarrés avant gardent l'ancien circuit (approbation N1 / N2 / N3 de la réquisition, Direction
-- pour le bon de commande) : requisitions.approval_level reste renseigné pour eux.
-- ============================================================================

-- Niveau d'approbation du bon de commande et politique appliquée { n1Max, n2Max, source }
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approval_level VARCHAR(2);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approval_policy JSONB;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_approval_level_check') THEN
    ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_approval_level_check
      CHECK (approval_level IS NULL OR approval_level IN ('N1', 'N2', 'N3'));
  END IF;
END $$;

-- Rôle des profils (base existante ; une base neuve reçoit ces libellés par data.sql)
UPDATE profiles SET description = 'Approbation des bons de commande de niveau N1' WHERE id = 'prof_manager';
UPDATE profiles SET description = 'Approbation des bons de commande de niveau N2' WHERE id = 'prof_manager_n2';
UPDATE profiles SET description = 'Approbation des bons de commande de niveau N3' WHERE id = 'prof_manager_n3';
UPDATE profiles SET description = 'Direction (pilotage) ; approuvait les bons de commande avant le circuit N1 / N2 / N3'
WHERE id = 'prof_management';

-- Projets actifs sans chef de projet : aucune réquisition ne pourra y être soumise tant qu'il n'est pas désigné
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM projects WHERE project_manager_id IS NULL AND COALESCE(is_active, true);
  IF n > 0 THEN
    RAISE NOTICE '% projet(s) actif(s) sans chef de projet : à désigner avant de nouvelles réquisitions', n;
  END IF;
END $$;
