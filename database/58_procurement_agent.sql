-- ============================================================================
-- 58_procurement_agent.sql — Agent achats désigné à la validation de la réquisition (idempotente)
-- ----------------------------------------------------------------------------
-- Choix de l'utilisateur (2026-11-10) : en approuvant la réquisition, le chef de projet (budget holder) choisit
-- l'agent achats qui la traitera — un utilisateur actif ayant le profil Achats (prof_procurement) SUR LE PROJET de la
-- réquisition. Toutes les étapes achats de la réquisition (méthode d'achat, achat direct, devis, source unique,
-- répartition, appel d'offres, bon de commande, confirmation fournisseur) lui sont alors réservées (l'administrateur
-- garde la main). Le chef de projet (ou son intérimaire) et l'administrateur peuvent le remplacer ensuite.
-- Aucun changement du BPMN : la règle est appliquée par l'application (TaskController, routes PO / AO).
-- ============================================================================

ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS procurement_agent_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS procurement_agent_assigned_at TIMESTAMPTZ;
ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS procurement_agent_assigned_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_requisitions_procurement_agent ON requisitions(procurement_agent_id);

-- Peut être désigné agent achats de la réquisition : utilisateur actif de la même entreprise, profil Achats sur le
-- projet de la réquisition (attribué sur ce projet ou « tous les projets »)
CREATE OR REPLACE FUNCTION user_can_be_procurement_agent(p_user UUID, p_requisition UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM requisitions r JOIN users u ON u.id = p_user
    WHERE r.id = p_requisition AND u.is_active = true AND u.enterprise_id = r.enterprise_id
      AND user_has_project_profile(u.id, 'prof_procurement', r.project_id)
  )
$$ LANGUAGE sql STABLE;
