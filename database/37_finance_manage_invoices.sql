-- ============================================================================
-- 37_finance_manage_invoices.sql — Le profil Finance gère les factures (idempotente)
-- ----------------------------------------------------------------------------
-- MANAGE_INVOICES (création, rapprochement, validation, rejet des factures — migration 21) : réattribuée au profil
-- Finance (prof_finance) si elle a été retirée. Profil de workflow lié au projet : la permission ne s'exerce que
-- sur les projets où le profil Finance est attribué au membre (ou « Tous les projets »).
-- ============================================================================

INSERT INTO profile_permissions (profile_id, permission_id)
SELECT 'prof_finance', p.id
FROM permissions p
WHERE p.name = 'MANAGE_INVOICES'
  AND EXISTS (SELECT 1 FROM profiles WHERE id = 'prof_finance')
  AND NOT EXISTS (SELECT 1 FROM profile_permissions pp WHERE pp.profile_id = 'prof_finance' AND pp.permission_id = p.id);
