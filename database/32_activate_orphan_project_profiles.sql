-- ============================================================================
-- 32_activate_orphan_project_profiles.sql — Profils de workflow actifs sur aucun projet (idempotente)
-- ----------------------------------------------------------------------------
-- Un profil de workflow (Manager niveau 1 / 2 / 3, Finance, Achats…) ajouté à un utilisateur déjà membre de projets
-- n'était activé sur aucun d'eux (seul l'ajout d'un membre activait ses profils) : il ne s'exerçait nulle part —
-- ex. un Manager niveau 2 ne voyait aucune réquisition ni aucune tâche. L'application l'active désormais sur les
-- projets de l'utilisateur (UserModel.update, fiche utilisateur) ; cette reprise corrige les comptes existants :
-- profil sans « Tous les projets », actif sur aucun projet → activé sur tous les projets dont l'utilisateur est membre.
-- Un profil déjà actif sur au moins un projet n'est pas touché (choix fait projet par projet).
-- ============================================================================

INSERT INTO project_member_profiles (project_id, user_id, profile_id, assigned_by)
SELECT pm.project_id, up.user_id, up.profile_id, up.user_id
FROM user_profiles up
JOIN profiles pr ON pr.id = up.profile_id AND pr.project_scoped
JOIN project_members pm ON pm.user_id = up.user_id
WHERE NOT up.all_projects
  AND NOT EXISTS (SELECT 1 FROM project_member_profiles x WHERE x.user_id = up.user_id AND x.profile_id = up.profile_id);
