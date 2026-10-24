-- ============================================================================
-- 39_tender_per_item_award.sql — Appel d'offres attribué article par article (idempotente)
-- ----------------------------------------------------------------------------
-- Un appel d'offres annonce dès sa publication son mode d'attribution :
--   SINGLE   : un seul attributaire pour tous les articles (comportement d'origine)
--   PER_ITEM : chaque article est attribué à l'offre retenue pour cet article (plusieurs fournisseurs possibles)
-- Attribution par article à plusieurs fournisseurs : une part par fournisseur (requisition_supplier_lots, migration
-- 38), et chaque part suit son propre cycle de commande. tenders.awarded_supplier_id n'est renseigné que s'il n'y a
-- qu'un attributaire.
-- ============================================================================

ALTER TABLE tenders ADD COLUMN IF NOT EXISTS award_mode VARCHAR(10) NOT NULL DEFAULT 'SINGLE';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenders_award_mode_check') THEN
    ALTER TABLE tenders ADD CONSTRAINT tenders_award_mode_check CHECK (award_mode IN ('SINGLE', 'PER_ITEM'));
  END IF;
END $$;

-- Article attribué : à une seule offre (celle du fournisseur retenu pour cet article)
CREATE TABLE IF NOT EXISTS tender_awards (
    id SERIAL PRIMARY KEY,
    tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
    requisition_item_id INTEGER NOT NULL REFERENCES requisition_items(id) ON DELETE CASCADE,
    submission_id INTEGER NOT NULL REFERENCES tender_submissions(id) ON DELETE CASCADE,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    unit_price DECIMAL(19,4) NOT NULL,
    total_price DECIMAL(19,4) NOT NULL,
    awarded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    awarded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tender_award_item UNIQUE (tender_id, requisition_item_id)
);
CREATE INDEX IF NOT EXISTS idx_tender_awards_supplier ON tender_awards (supplier_id);

-- Part d'une réquisition répartie créée par l'attribution d'un appel d'offres
ALTER TABLE requisition_supplier_lots ADD COLUMN IF NOT EXISTS tender_id INTEGER REFERENCES tenders(id) ON DELETE SET NULL;
