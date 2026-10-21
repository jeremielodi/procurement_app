-- ============================================================================
-- 37_finance_permissions.sql — Le profil Finance gère factures et paiements (idempotente)
-- ----------------------------------------------------------------------------
-- MANAGE_INVOICES (création, rapprochement, validation, rejet des factures) et MANAGE_PAYMENTS (saisie des
-- paiements) — migration 21 : réattribuées au profil Finance (prof_finance) si elles ont été retirées. Profil de
-- workflow lié au projet : ces permissions ne s'exercent que sur les projets où le profil Finance est attribué au
-- membre (ou « Tous les projets »).
-- ============================================================================

INSERT INTO profile_permissions (profile_id, permission_id)
SELECT 'prof_finance', p.id
FROM permissions p
WHERE p.name IN ('MANAGE_INVOICES', 'MANAGE_PAYMENTS')
  AND EXISTS (SELECT 1 FROM profiles WHERE id = 'prof_finance')
  AND NOT EXISTS (SELECT 1 FROM profile_permissions pp WHERE pp.profile_id = 'prof_finance' AND pp.permission_id = p.id);
