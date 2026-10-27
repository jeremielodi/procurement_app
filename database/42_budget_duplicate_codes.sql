-- ============================================================================
-- 42_budget_duplicate_codes.sql — Codes de ligne budgétaire non uniques (idempotente)
-- ----------------------------------------------------------------------------
-- Plusieurs lignes budgétaires d'un même projet peuvent porter le même code (code entité / code ligne) :
-- suppression de la contrainte UNIQUE(entity_code, project_id). Les lignes restent identifiées par leur id
-- (l'import du registre utilise la colonne « ID » de l'export pour mettre à jour une ligne existante).
-- ============================================================================

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'budget_allocations'::regclass
      AND con.contype = 'u'
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
           FROM unnest(con.conkey) k JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k)
          = ARRAY['entity_code', 'project_id']
  LOOP
    EXECUTE format('ALTER TABLE budget_allocations DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_budget_allocations_project_code ON budget_allocations (project_id, entity_code);
