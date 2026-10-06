-- ============================================
-- LANGUE DE L'UTILISATEUR
-- Langue de l'interface (appliquée à la connexion) et des emails envoyés à l'utilisateur.
-- Codes = fichiers de langue (client/src/locales, backend/src/i18n/locales) : 'fr', 'en'…
-- Idempotent : peut être rejoué sur une base existante.
-- ============================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(10) NOT NULL DEFAULT 'fr';
