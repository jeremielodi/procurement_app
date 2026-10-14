-- ============================================================================
-- 25_requisition_revisions.sql — Renvoi pour correction, retrait et versions des réquisitions (idempotente)
-- ----------------------------------------------------------------------------
-- Pendant l'approbation (N1 / N2 / N3), l'approbateur peut renvoyer la réquisition pour correction (motif
-- obligatoire) ; le demandeur peut aussi la retirer tant que personne n'a pris l'approbation en charge. La
-- réquisition passe « À corriger » (status RETURNED) : seul le demandeur la modifie, puis la soumet à nouveau
-- (nouvelle version, nouvelle vérification du budget et nouveau circuit d'approbation) ou l'abandonne (annulée).
-- Chaque soumission est conservée (photo complète) : l'approbateur voit ce qui a changé.
-- BPMN : Activity_ReviseRequisition (assignee ${requester}) → Gateway_ReviseDecision (resubmitted) — à redéployer.
-- ============================================================================

ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS requisition_versions (
    id SERIAL PRIMARY KEY,
    requisition_id UUID NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    -- Photo de la réquisition soumise : champs, montant, articles (id, désignation, quantités, prix, ligne budgétaire)
    snapshot JSONB NOT NULL,
    submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    submit_comment TEXT,
    -- Fin de cette version : renvoyée par un approbateur ou retirée par le demandeur
    return_kind VARCHAR(20) CHECK (return_kind IN ('RETURNED', 'WITHDRAWN')),
    return_reason TEXT,
    returned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    returned_at TIMESTAMP,
    returned_task VARCHAR(100),
    UNIQUE (requisition_id, version)
);
CREATE INDEX IF NOT EXISTS idx_requisition_versions_requisition ON requisition_versions(requisition_id);
