-- ============================================================================
-- 41_user_signatures.sql — Signature image des utilisateurs (idempotente)
-- ----------------------------------------------------------------------------
-- users.signature_path : clé StorageService (user-signatures/<id>_<horodatage>.<ext>), jamais servie en statique.
-- Déposée ou dessinée par l'utilisateur lui-même (Mon profil), reprise dans les PDF des documents qu'il a
-- lui-même établis ou validés (bon de commande, réception, facture, bons de sortie / de retour).
-- signature_updated_at = version (cache du client).
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_path VARCHAR(500);
ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_updated_at TIMESTAMP;
