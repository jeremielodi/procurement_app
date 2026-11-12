-- ============================================================================
-- 65_stock_project_scope.sql — Stock cloisonné par projet (idempotente)
-- ----------------------------------------------------------------------------
-- Choix de l'utilisateur (2026-11-11) : « même dans le stock, il faut limiter les permissions par entreprise et projet »
-- → profils de stock LIÉS AU PROJET, comme les profils du workflow (migration 24) : un profil de stock lié au projet
-- ne s'exerce que sur les projets où il est attribué au membre (project_member_profiles) ou partout avec « Tous les
-- projets » (user_profiles.all_projects). Un utilisateur dont TOUS les profils de stock sont limités ne voit et ne gère
-- que le stock financé par ces projets (projet de financement des soldes, mouvements, équipements, documents — migrations
-- 28 / 29) ET le stock sans projet. Un profil de stock global (administrateur, auditeur…) ou « Tous les projets » : tout
-- le stock de l'entreprise. Calcul : backend/src/utils/stockProject.js.
-- Profils de stock rendus liés au projet : gestionnaire des équipements, gestionnaire des consommables, magasinier
-- (logistique, achats, finance, direction le sont déjà). Reprise : leurs attributions existantes → « Tous les projets »
-- (aucun changement visible ; l'administrateur restreint ensuite projet par projet sur la fiche utilisateur).
-- ============================================================================

DO $$
DECLARE
  p TEXT;
BEGIN
  FOREACH p IN ARRAY ARRAY['prof_equipment_manager', 'prof_consumables_manager', 'prof_store_keeper'] LOOP
    IF EXISTS (SELECT 1 FROM profiles WHERE id = p AND NOT COALESCE(project_scoped, false)) THEN
      UPDATE user_profiles SET all_projects = true WHERE profile_id = p;
      UPDATE profiles SET project_scoped = true WHERE id = p;
    END IF;
  END LOOP;
END $$;
