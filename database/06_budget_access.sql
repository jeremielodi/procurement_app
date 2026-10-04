-- ============================================
-- ACCÈS AU BUDGET : module réservé à la Finance
-- Le profil Achats (procurement) ne consulte plus le budget.
-- (MANAGE_BUDGET = Finance + admin ; VIEW_BUDGET sert uniquement au choix
--  d'une ligne budgétaire du projet lors de la création d'une réquisition)
-- Idempotent.
-- ============================================
DELETE FROM profile_permissions
WHERE profile_id = 'prof_procurement'
  AND permission_id IN (SELECT id FROM permissions WHERE name = 'VIEW_BUDGET');
