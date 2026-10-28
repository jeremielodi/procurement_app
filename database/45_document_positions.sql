-- 45_document_positions.sql (idempotente)
-- Fonction (users.position) figée au moment où la personne agit : un document déjà émis garde la fonction de
-- l'époque, même si le poste de la personne change ensuite (réquisition, bon de commande, approbations).
-- Remplie par des triggers : tout chemin d'écriture (contrôleurs, workers GoFlow) est couvert sans changer le code.

ALTER TABLE requisitions     ADD COLUMN IF NOT EXISTS requester_position    VARCHAR(100);
ALTER TABLE workflow_history ADD COLUMN IF NOT EXISTS performed_by_position VARCHAR(100);
ALTER TABLE purchase_orders  ADD COLUMN IF NOT EXISTS created_by_position   VARCHAR(100);
ALTER TABLE purchase_orders  ADD COLUMN IF NOT EXISTS approved_by_position  VARCHAR(100);
ALTER TABLE approvals        ADD COLUMN IF NOT EXISTS approver_position     VARCHAR(100);

-- Réquisition : fonction du demandeur à la création (le demandeur ne change pas ensuite)
CREATE OR REPLACE FUNCTION snapshot_requisition_position() RETURNS trigger AS $$
BEGIN
  IF NEW.requester_position IS NULL AND NEW.requester_id IS NOT NULL THEN
    SELECT position INTO NEW.requester_position FROM users WHERE id = NEW.requester_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_snapshot_requisition_position ON requisitions;
CREATE TRIGGER trg_snapshot_requisition_position BEFORE INSERT ON requisitions
  FOR EACH ROW EXECUTE FUNCTION snapshot_requisition_position();

-- Historique du workflow (approbations N1 / N2 / N3…) : fonction de la personne au moment de l'action
CREATE OR REPLACE FUNCTION snapshot_history_position() RETURNS trigger AS $$
BEGIN
  IF NEW.performed_by_position IS NULL AND NEW.performed_by IS NOT NULL THEN
    SELECT position INTO NEW.performed_by_position FROM users WHERE id = NEW.performed_by;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_snapshot_history_position ON workflow_history;
CREATE TRIGGER trg_snapshot_history_position BEFORE INSERT ON workflow_history
  FOR EACH ROW EXECUTE FUNCTION snapshot_history_position();

-- Bon de commande : fonction du créateur à la création, de l'approbateur quand approved_by est renseigné
CREATE OR REPLACE FUNCTION snapshot_po_positions() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.created_by_position IS NULL AND NEW.created_by IS NOT NULL THEN
    SELECT position INTO NEW.created_by_position FROM users WHERE id = NEW.created_by;
  END IF;
  IF NEW.approved_by IS NULL THEN
    NEW.approved_by_position := NULL;
  ELSIF TG_OP = 'INSERT' OR NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
    SELECT position INTO NEW.approved_by_position FROM users WHERE id = NEW.approved_by;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_snapshot_po_positions ON purchase_orders;
CREATE TRIGGER trg_snapshot_po_positions BEFORE INSERT OR UPDATE OF approved_by ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION snapshot_po_positions();

-- Décisions d'approbation des bons de commande
CREATE OR REPLACE FUNCTION snapshot_approval_position() RETURNS trigger AS $$
BEGIN
  IF NEW.approver_position IS NULL AND NEW.approver_id IS NOT NULL THEN
    SELECT position INTO NEW.approver_position FROM users WHERE id = NEW.approver_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_snapshot_approval_position ON approvals;
CREATE TRIGGER trg_snapshot_approval_position BEFORE INSERT ON approvals
  FOR EACH ROW EXECUTE FUNCTION snapshot_approval_position();

-- Reprise des documents existants : la fonction de l'époque n'a pas été conservée → fonction actuelle, figée dès
-- maintenant (seulement là où rien n'est encore enregistré : relancer la migration ne change rien)
-- Triggers désactivés le temps de la reprise : updated_at et budget des bons de commande inchangés
BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE requisitions r SET requester_position = u.position
  FROM users u WHERE u.id = r.requester_id AND r.requester_position IS NULL AND u.position IS NOT NULL;
UPDATE workflow_history h SET performed_by_position = u.position
  FROM users u WHERE u.id = h.performed_by AND h.performed_by_position IS NULL AND u.position IS NOT NULL;
UPDATE purchase_orders po SET created_by_position = u.position
  FROM users u WHERE u.id = po.created_by AND po.created_by_position IS NULL AND u.position IS NOT NULL;
UPDATE purchase_orders po SET approved_by_position = u.position
  FROM users u WHERE u.id = po.approved_by AND po.approved_by_position IS NULL AND u.position IS NOT NULL;
UPDATE approvals a SET approver_position = u.position
  FROM users u WHERE u.id = a.approver_id AND a.approver_position IS NULL AND u.position IS NOT NULL;
COMMIT;
