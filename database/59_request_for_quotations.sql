-- ============================================================================
-- 59_request_for_quotations.sql — Demande de cotations traitée comme un appel d'offres (idempotente)
-- ----------------------------------------------------------------------------
-- Choix de l'utilisateur (2026-11-10) :
--   * méthode « Devis multiples » (Activity_RequestQuotations) : les achats publient une demande de cotations (RFQ)
--     avec le module des appels d'offres (fournisseurs ciblés ou tous, offres scellées, questions, comparatif,
--     attribution unique ou par article) ; l'attribution termine l'étape, comme pour l'appel d'offres (RFP) ;
--   * toutes les méthodes d'achat sont ouvertes quel que soit le montant : les achats décident (plus de refus
--     METHOD_BELOW_THRESHOLD).
-- Aucun changement du BPMN : les deux étapes mènent déjà à Task_AnalyzeOffers.
-- ============================================================================

ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tender_type VARCHAR(3) NOT NULL DEFAULT 'RFP';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenders_tender_type_check') THEN
    ALTER TABLE tenders ADD CONSTRAINT tenders_tender_type_check CHECK (tender_type IN ('RFP', 'RFQ'));
  END IF;
END $$;
