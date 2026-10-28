-- ============================================================================
-- 27_manager_approval_levels.sql — Approbation des réquisitions par trois niveaux de Manager (idempotente)
-- ----------------------------------------------------------------------------
-- Une seule approbation, au niveau donné par le montant (seuils du projet, sinon de l'entreprise, sinon par défaut) :
--   N1 → « Manager niveau 1 » (prof_manager, groupe BpmnGo manager)
--   N2 → « Manager niveau 2 » (prof_manager_n2, groupe manager_n2)     — avant : Finance
--   N3 → « Manager niveau 3 » (prof_manager_n3, groupe manager_n3)     — avant : DG
-- Finance garde ses autres rôles (factures, paiements, budget) ; le profil DG n'approuve plus les réquisitions.
-- BPMN (candidateGroups des étapes N2 / N3) à redéployer. Attribuer les profils Manager niveau 2 / 3 aux
-- approbateurs concernés (et sur leurs projets) : les réquisitions déjà en attente gardent l'ancien groupe.
-- ============================================================================

INSERT INTO profiles (id, name, description)
SELECT 'prof_manager_n3', 'Manager niveau 3', 'Approbation des réquisitions de niveau N3'
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'prof_manager_n3');

UPDATE profiles SET name = 'Manager niveau 1', description = 'Approbation des réquisitions de niveau N1' WHERE id = 'prof_manager';
UPDATE profiles SET name = 'Manager niveau 2', description = 'Approbation des réquisitions de niveau N2' WHERE id = 'prof_manager_n2';
UPDATE profiles SET description = 'Factures, paiements et budget' WHERE id = 'prof_finance';
UPDATE profiles SET description = 'Direction générale (approbation des paiements)' WHERE id = 'prof_dg';

-- Profils de workflow liés au projet (migration 24)
UPDATE profiles SET project_scoped = true WHERE id IN ('prof_manager_n2', 'prof_manager_n3') AND project_scoped = false;

-- Mêmes permissions que le Manager niveau 1 pour les niveaux 2 et 3
INSERT INTO profile_permissions (profile_id, permission_id)
SELECT lvl.id, pp.permission_id
FROM (VALUES ('prof_manager_n2'), ('prof_manager_n3')) AS lvl(id)
JOIN profile_permissions pp ON pp.profile_id = 'prof_manager'
WHERE NOT EXISTS (SELECT 1 FROM profile_permissions x WHERE x.profile_id = lvl.id AND x.permission_id = pp.permission_id);
