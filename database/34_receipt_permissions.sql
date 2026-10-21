-- ============================================================================
-- 34_receipt_permissions.sql — Permissions de réception (idempotente)
-- ----------------------------------------------------------------------------
-- Réattribue, si elles ont été retirées depuis la migration 21 : RECORD_GOODS_RECEIPT (logistique) et
-- RECORD_SERVICE_ACCEPTANCE (demandeur). Le demandeur n'a PAS RECORD_GOODS_RECEIPT. Profils de workflow liés au
-- projet : ces permissions ne s'exercent que sur les projets où le profil est attribué au membre (onProject).
-- ============================================================================

INSERT INTO profile_permissions (profile_id, permission_id)
SELECT pr.profile, p.id FROM (VALUES
  ('prof_requester', 'RECORD_SERVICE_ACCEPTANCE'),
  ('prof_logistic', 'RECORD_GOODS_RECEIPT')
) AS pr(profile, perm)
JOIN permissions p ON p.name = pr.perm
WHERE EXISTS (SELECT 1 FROM profiles WHERE id = pr.profile)
  AND NOT EXISTS (SELECT 1 FROM profile_permissions pp WHERE pp.profile_id = pr.profile AND pp.permission_id = p.id);
