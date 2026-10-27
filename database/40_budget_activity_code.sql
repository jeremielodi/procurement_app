-- ============================================================================
-- 40_budget_activity_code.sql — Code activité des lignes budgétaires (idempotente)
-- ----------------------------------------------------------------------------
-- budget_allocations.activity_code : code de l'activité financée par la ligne (facultatif),
-- à côté du code fonction. Saisi dans le formulaire, l'import / export du registre budgétaire.
-- ============================================================================

ALTER TABLE budget_allocations ADD COLUMN IF NOT EXISTS activity_code VARCHAR(50);
