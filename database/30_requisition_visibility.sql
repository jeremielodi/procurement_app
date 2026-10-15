-- ============================================================================
-- 30_requisition_visibility.sql — Qui voit les réquisitions d'un projet (idempotente)
-- ----------------------------------------------------------------------------
-- Dans un projet, un utilisateur ne voit que les réquisitions qu'il a lui-même créées, sauf s'il a sur ce projet un
-- profil autre que « Demandeur » / « Utilisateur » (managers N1 à N3, finance, DG, direction, achats, logistique,
-- magasinier, auditeur, administrateur…) ou s'il est le chef du projet.
-- Profils globaux (admin, auditeur, magasinier…) : valables sur tous les projets (voir user_project_profiles).
-- Réquisition sans projet : profils de l'utilisateur sur n'importe quel projet.
-- ============================================================================

-- Profils qui ne donnent accès qu'à ses propres réquisitions
CREATE OR REPLACE FUNCTION requisition_own_only_profiles() RETURNS TEXT[] AS $$
  SELECT ARRAY['prof_requester', 'prof_user', 'prof_supplier', 'prof_superadmin']::TEXT[]
$$ LANGUAGE sql IMMUTABLE;

-- L'utilisateur voit toutes les réquisitions du projet
CREATE OR REPLACE FUNCTION user_sees_project_requisitions(p_user UUID, p_project UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
      SELECT 1 FROM user_project_profiles(p_user, p_project) x
      WHERE x.profile_id <> ALL (requisition_own_only_profiles())
    )
    OR (p_project IS NOT NULL AND EXISTS (SELECT 1 FROM projects p WHERE p.id = p_project AND p.project_manager_id = p_user))
$$ LANGUAGE sql STABLE;

-- L'utilisateur peut consulter cette réquisition (la sienne, ou celles de son projet selon ses profils)
CREATE OR REPLACE FUNCTION user_can_view_requisition(p_user UUID, p_requisition UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM requisitions r
    WHERE r.id = p_requisition
      AND (r.requester_id = p_user OR user_sees_project_requisitions(p_user, r.project_id))
  )
$$ LANGUAGE sql STABLE;
