-- ============================================================================
-- 24_project_profiles.sql — Profils BPMN liés au projet (idempotente)
-- ----------------------------------------------------------------------------
-- Un profil « de workflow » (manager, finance, dg, management, procurement, logistic, requester) ne s'exerce
-- plus sur toute l'entreprise : il s'exerce sur les projets où il est attribué au membre
-- (project_member_profiles), ou sur tous les projets si l'utilisateur a la case « Tous les projets »
-- (user_profiles.all_projects). Le profil global (user_profiles) reste le plafond : un profil attribué sur un
-- projet sans le profil global ne donne rien. Les autres profils (admin, magasinier, auditeur…) restent globaux.
--
-- Contrôles : tâches GoFlow (liste, prise en charge, complétion), formulaires qui les terminent (PO, GRN, SAN,
-- facture, paiement, AO, ajustement budgétaire), création de réquisition, destinataires des emails de tâche.
-- Réquisition sans projet : profils globaux (pas de cloisonnement possible).
-- ============================================================================

-- 1. Profils soumis au projet
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS project_scoped BOOLEAN NOT NULL DEFAULT false;
UPDATE profiles SET project_scoped = true
WHERE id IN ('prof_manager', 'prof_finance', 'prof_dg', 'prof_management', 'prof_procurement', 'prof_logistic', 'prof_requester')
  AND project_scoped = false;

-- 2. Profils attribués par projet (le membre doit exister : retirer le membre retire ses profils)
CREATE TABLE IF NOT EXISTS project_member_profiles (
    project_id UUID NOT NULL,
    user_id UUID NOT NULL,
    profile_id VARCHAR(50) NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (project_id, user_id, profile_id),
    FOREIGN KEY (project_id, user_id) REFERENCES project_members(project_id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_project_member_profiles_user ON project_member_profiles(user_id);

-- 3. « Tous les projets » + reprise des données (une seule fois : à l'ajout de la colonne)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_profiles' AND column_name = 'all_projects') THEN
    ALTER TABLE user_profiles ADD COLUMN all_projects BOOLEAN NOT NULL DEFAULT false;

    -- Membres actuels : leurs profils de workflow s'appliquent à leurs projets (même règle que les emails de tâche)
    INSERT INTO project_member_profiles (project_id, user_id, profile_id, assigned_at)
    SELECT pm.project_id, pm.user_id, up.profile_id, CURRENT_TIMESTAMP
    FROM project_members pm
    JOIN user_profiles up ON up.user_id = pm.user_id
    JOIN profiles pr ON pr.id = up.profile_id AND pr.project_scoped
    WHERE pm.project_id IS NOT NULL AND pm.user_id IS NOT NULL
    ON CONFLICT DO NOTHING;

    -- Équipes transverses (finance, DG, management, achats, logistique) : tous les projets, comme avant —
    -- aucun circuit en cours ne se retrouve sans approbateur. L'administrateur restreint ensuite au besoin.
    UPDATE user_profiles SET all_projects = true
    WHERE profile_id IN ('prof_finance', 'prof_dg', 'prof_management', 'prof_procurement', 'prof_logistic');

    -- Manager / demandeur membre d'aucun projet : tous les projets (sinon il perdrait tout accès)
    UPDATE user_profiles up SET all_projects = true
    WHERE up.profile_id IN ('prof_manager', 'prof_requester')
      AND NOT EXISTS (SELECT 1 FROM project_members pm WHERE pm.user_id = up.user_id);
  END IF;
END $$;

-- 4. Fonctions de contrôle (utilisées par le serveur et dans les requêtes de destinataires)
-- Profils effectifs d'un utilisateur sur un projet (projet NULL : profils globaux)
CREATE OR REPLACE FUNCTION user_project_profiles(p_user UUID, p_project UUID)
RETURNS TABLE (profile_id VARCHAR) AS $$
  SELECT up.profile_id
  FROM user_profiles up
  JOIN profiles pr ON pr.id = up.profile_id
  WHERE up.user_id = p_user
    AND (NOT pr.project_scoped OR up.all_projects OR p_project IS NULL
         OR EXISTS (SELECT 1 FROM project_member_profiles pmp
                    WHERE pmp.project_id = p_project AND pmp.user_id = p_user AND pmp.profile_id = up.profile_id))
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION user_has_project_profile(p_user UUID, p_profile VARCHAR, p_project UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM user_project_profiles(p_user, p_project) x WHERE x.profile_id = p_profile)
$$ LANGUAGE sql STABLE;

-- Permission accordée par un des profils effectifs sur le projet (l'administrateur a toutes les permissions)
CREATE OR REPLACE FUNCTION user_has_project_permission(p_user UUID, p_project UUID, p_permission VARCHAR)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_project_profiles(p_user, p_project) x
    WHERE x.profile_id = 'prof_admin'
       OR EXISTS (SELECT 1 FROM profile_permissions pp JOIN permissions pe ON pe.id = pp.permission_id
                  WHERE pp.profile_id = x.profile_id AND pe.name = p_permission)
  )
$$ LANGUAGE sql STABLE;
