-- ============================================
-- JOURNAL D'AUDIT (audit_logs) : événements de sécurité des comptes
-- Connexion (réussie / échouée), déconnexion, changement / réinitialisation de mot de passe,
-- inscription fournisseur, gestion des utilisateurs par un admin… — écrit par utils/auditLog.js
-- - user_id : auteur de l'action (null : visiteur non identifié) ; user_email : copie conservée
--   même si le compte est supprimé ; entity_id : compte concerné
-- - enterprise_id : entreprise de l'auteur ou du compte concerné (consultation par entreprise)
-- Idempotent : peut être rejoué sur une base existante.
-- ============================================

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_email VARCHAR(255);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS enterprise_id UUID;

-- La suppression d'un utilisateur ne doit pas être bloquée par son historique : l'auteur devient NULL,
-- l'email reste dans user_email
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_enterprise_id_fkey') THEN
    ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_enterprise_id_fkey
        FOREIGN KEY (enterprise_id) REFERENCES enterprise(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_enterprise ON audit_logs(enterprise_id, created_at);
