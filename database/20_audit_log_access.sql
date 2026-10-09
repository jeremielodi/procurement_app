-- ============================================
-- CONSULTATION DU JOURNAL D'AUDIT
-- - Permission VIEW_AUDIT_LOGS : admin d'entreprise (journal de SON entreprise) et super admin plateforme
--   (tout le journal, y compris les événements sans entreprise : email inconnu, inscription fournisseur…)
-- - Index pour les filtres de l'écran (auteur, compte concerné)
-- Idempotent : peut être rejoué sur une base existante (après 12_audit_logs.sql).
-- ============================================

INSERT INTO permissions (id, name, description, resource, action)
SELECT 'perm_view_audit_logs', 'VIEW_AUDIT_LOGS', 'Consulter et exporter le journal d''audit', 'audit', 'view'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'VIEW_AUDIT_LOGS');

INSERT INTO profile_permissions (profile_id, permission_id)
SELECT pr.profile, p.id FROM (VALUES ('prof_admin'), ('prof_superadmin')) AS pr(profile)
JOIN permissions p ON p.name = 'VIEW_AUDIT_LOGS'
WHERE EXISTS (SELECT 1 FROM profiles WHERE id = pr.profile)
  AND NOT EXISTS (SELECT 1 FROM profile_permissions pp WHERE pp.profile_id = pr.profile AND pp.permission_id = p.id);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_id, id);
