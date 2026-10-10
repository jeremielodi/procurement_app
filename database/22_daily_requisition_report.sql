-- ============================================
-- RAPPORT QUOTIDIEN DES RÉQUISITIONS (email chaque nuit)
-- - enterprise.daily_report_enabled : option activée par l'administrateur de l'entreprise (« Mon entreprise »)
-- - daily_report_runs : un envoi par entreprise et par jour (fuseau APP_TIMEZONE) — empêche les doublons
--   (plusieurs instances, redémarrage) et permet le rattrapage d'une nuit manquée
-- Destinataires : administrateurs et managers actifs, chacun dans sa langue ; contenu projet par projet
-- (20 dernières réquisitions). Service : backend/src/services/DailyRequisitionReportService.js
-- Idempotent : peut être rejoué sur une base existante (après 21_internal_control.sql).
-- ============================================

ALTER TABLE enterprise ADD COLUMN IF NOT EXISTS daily_report_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS daily_report_runs (
    enterprise_id UUID NOT NULL REFERENCES enterprise(id) ON DELETE CASCADE,
    report_date DATE NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMPTZ,
    recipients INTEGER NOT NULL DEFAULT 0,
    sent INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    PRIMARY KEY (enterprise_id, report_date)
);
