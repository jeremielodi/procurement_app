-- ============================================
-- IDENTIFIANTS DE TÂCHE BPMNGO EN TEXTE
-- - Depuis sa mise à jour (2026-11), BpmnGo renvoie des identifiants de tâche numériques
--   (ex. « 110901629003235328 ») et non plus des UUID ; les instances de processus restent des UUID.
-- - purchase_orders.task_id était la seule colonne de tâche en UUID : toute création de bon de commande
--   depuis la tâche Activity_CreatePO échouait (« invalid input syntax for type uuid »).
-- - Les autres colonnes de tâche (workflow_history, tenders, invoices, payments, lots…) sont déjà en texte.
-- Idempotent : peut être rejoué sur une base existante.
-- ============================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'purchase_orders'
                 AND column_name = 'task_id' AND data_type = 'uuid') THEN
        ALTER TABLE purchase_orders ALTER COLUMN task_id TYPE VARCHAR(64) USING task_id::TEXT;
    END IF;
END $$;
