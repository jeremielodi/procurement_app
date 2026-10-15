-- ============================================================================
-- 31_user_avatars.sql — Photo de profil des utilisateurs (idempotente)
-- ----------------------------------------------------------------------------
-- avatar_path : clé du fichier dans le stockage (StorageService : user-avatars/<id>_<horodatage>.<ext>), jamais servi
-- en statique (GET /api/users/:id/avatar, authentifié, même entreprise) ; avatar_updated_at : version de la photo
-- (le client la passe en paramètre pour invalider son cache).
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_path VARCHAR(500);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_updated_at TIMESTAMPTZ;
