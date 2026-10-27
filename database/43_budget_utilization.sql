-- ============================================================================
-- 43_budget_utilization.sql — Montant « utilisé » des lignes budgétaires (idempotente)
-- ----------------------------------------------------------------------------
-- Avant : budget_allocations.utilized_amount n'était alimenté que par la saisie manuelle d'une dépense
-- (POST /budget/expenses) → toujours 0, et la vérification budgétaire ne voyait jamais rien de consommé.
--
-- Règle (choix de l'utilisateur, 2026-10-27) : utilisé = bons de commande ACTIFS (tout statut sauf rejeté /
-- annulé, en attente d'approbation compris) + dépenses manuelles non rattachées à un bon de commande.
--   - Montant d'une ligne de PO = son total ; reliquat soldé (delivery_closed_at) = quantité acceptée × prix.
--   - Ligne budgétaire d'une ligne de PO : celle de sa ligne de réquisition (requisition_item_id) ; à défaut,
--     la ligne de réquisition de même désignation (sans ambiguïté) ; à défaut, répartie entre les lignes
--     budgétaires de la réquisition au prorata de leurs montants.
-- Tenu à jour par triggers (PO, lignes de PO, réceptions, lignes de réquisition, dépenses) : aucun appelant
-- applicatif à modifier. Les lignes budgétaires sont verrouillées avant le recalcul (pas de mise à jour perdue
-- quand deux bons de commande touchent la même ligne en même temps).
-- ============================================================================

-- Utilisation par ligne de PO × ligne budgétaire, limitée aux lignes budgétaires demandées
CREATE OR REPLACE FUNCTION budget_po_usage(p_lines uuid[])
RETURNS TABLE (po_item_id integer, purchase_order_id integer, budget_line_id uuid, amount numeric)
LANGUAGE sql STABLE AS $$
  WITH po_lines AS (
    SELECT poi.id AS po_item_id, po.id AS purchase_order_id, po.requisition_id, poi.requisition_item_id,
           lower(btrim(poi.item_description)) AS descr,
           CASE WHEN po.delivery_closed_at IS NOT NULL
                THEN COALESCE((SELECT d.quantity_accepted FROM v_po_item_delivery d WHERE d.po_item_id = poi.id), 0)
                     * COALESCE(poi.unit_price, 0)
                ELSE COALESCE(poi.total_amount, poi.quantity * COALESCE(poi.unit_price, 0)) END AS amount
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.purchase_order_id
    WHERE po.status NOT IN ('PO_REJECTED', 'PO_CANCELLED', 'CANCELLED', 'REJECTED')
      -- un PO ne consomme que les lignes budgétaires de sa réquisition
      AND po.requisition_id IN (SELECT ri.requisition_id FROM requisition_items ri WHERE ri.budget_line_id = ANY(p_lines))
  ),
  matched AS (
    SELECT pl.*, COALESCE(
      (SELECT ri.budget_line_id FROM requisition_items ri WHERE ri.id = pl.requisition_item_id),
      (SELECT (array_agg(DISTINCT ri.budget_line_id))[1] FROM requisition_items ri
        WHERE ri.requisition_id = pl.requisition_id AND ri.budget_line_id IS NOT NULL
          AND lower(btrim(ri.item_description)) = pl.descr
       HAVING count(DISTINCT ri.budget_line_id) = 1)
    ) AS line_id
    FROM po_lines pl
  ),
  shares AS (
    SELECT ri.requisition_id, ri.budget_line_id,
           SUM(COALESCE(ri.total_amount, ri.quantity * COALESCE(ri.frequency, 1) * COALESCE(ri.unit_price, 0)))
             / NULLIF(SUM(SUM(COALESCE(ri.total_amount, ri.quantity * COALESCE(ri.frequency, 1) * COALESCE(ri.unit_price, 0))))
                      OVER (PARTITION BY ri.requisition_id), 0) AS share
    FROM requisition_items ri
    WHERE ri.budget_line_id IS NOT NULL
      AND ri.requisition_id IN (SELECT m.requisition_id FROM matched m WHERE m.line_id IS NULL)
    GROUP BY ri.requisition_id, ri.budget_line_id
  ),
  usage AS (
    SELECT m.po_item_id, m.purchase_order_id, m.line_id AS budget_line_id, m.amount
    FROM matched m WHERE m.line_id IS NOT NULL
    UNION ALL
    SELECT m.po_item_id, m.purchase_order_id, s.budget_line_id, m.amount * s.share
    FROM matched m JOIN shares s ON s.requisition_id = m.requisition_id
    WHERE m.line_id IS NULL AND s.share IS NOT NULL
  )
  SELECT u.po_item_id, u.purchase_order_id, u.budget_line_id, u.amount
  FROM usage u WHERE u.budget_line_id = ANY(p_lines) AND u.amount <> 0
$$;

-- Recalcul du montant utilisé des lignes données
CREATE OR REPLACE FUNCTION refresh_budget_utilization(p_lines uuid[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_lines uuid[];
BEGIN
  SELECT array_agg(DISTINCT x) INTO v_lines FROM unnest(p_lines) x WHERE x IS NOT NULL;
  IF v_lines IS NULL THEN RETURN; END IF;
  -- Verrou d'abord (ordre stable) : l'instruction suivante prend un nouvel instantané et voit les bons de
  -- commande validés par une transaction concurrente qui tenait ces lignes
  PERFORM 1 FROM budget_allocations WHERE id = ANY(v_lines) ORDER BY id FOR UPDATE;
  UPDATE budget_allocations b
     SET utilized_amount = n.utilized
    FROM (
      SELECT l.id,
             COALESCE((SELECT SUM(u.amount) FROM budget_po_usage(v_lines) u WHERE u.budget_line_id = l.id), 0)
           + COALESCE((SELECT SUM(e.amount) FROM budget_expenses e WHERE e.budget_id = l.id AND e.purchase_order_id IS NULL), 0)
             AS utilized
      FROM unnest(v_lines) AS l(id)
    ) n
   WHERE b.id = n.id AND b.utilized_amount IS DISTINCT FROM ROUND(n.utilized, 4);
END;
$$;

-- Lignes budgétaires d'une réquisition (+ lignes supplémentaires : ancienne ligne d'un article modifié)
CREATE OR REPLACE FUNCTION refresh_requisition_budget(p_requisition uuid, p_extra uuid[] DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refresh_budget_utilization(
    COALESCE((SELECT array_agg(DISTINCT ri.budget_line_id) FROM requisition_items ri
               WHERE ri.requisition_id = p_requisition AND ri.budget_line_id IS NOT NULL), '{}'::uuid[])
    || COALESCE(p_extra, '{}'::uuid[]));
END;
$$;

-- Bons de commande : création, statut (rejet…), solde du reliquat, suppression
CREATE OR REPLACE FUNCTION trg_budget_from_po() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.requisition_id IS NOT NULL THEN
    PERFORM refresh_requisition_budget(OLD.requisition_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.requisition_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.requisition_id IS DISTINCT FROM OLD.requisition_id) THEN
    PERFORM refresh_requisition_budget(NEW.requisition_id);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_budget_from_po ON purchase_orders;
CREATE TRIGGER trg_budget_from_po
  AFTER INSERT OR DELETE OR UPDATE OF status, delivery_closed_at, requisition_id ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION trg_budget_from_po();

-- Lignes de bon de commande
CREATE OR REPLACE FUNCTION trg_budget_from_po_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_req uuid;
BEGIN
  SELECT requisition_id INTO v_req FROM purchase_orders
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.purchase_order_id ELSE NEW.purchase_order_id END;
  IF v_req IS NOT NULL THEN PERFORM refresh_requisition_budget(v_req); END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_budget_from_po_item ON purchase_order_items;
CREATE TRIGGER trg_budget_from_po_item
  AFTER INSERT OR DELETE OR UPDATE OF quantity, unit_price, total_amount, requisition_item_id, item_description
  ON purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION trg_budget_from_po_item();

-- Réceptions : ne comptent que pour un bon de commande dont le reliquat est soldé (quantité acceptée)
CREATE OR REPLACE FUNCTION trg_budget_from_grn_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_req uuid;
BEGIN
  SELECT po.requisition_id INTO v_req
    FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.purchase_order_id
   WHERE poi.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.po_item_id ELSE NEW.po_item_id END
     AND po.delivery_closed_at IS NOT NULL;
  IF v_req IS NOT NULL THEN PERFORM refresh_requisition_budget(v_req); END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_budget_from_grn_item ON goods_receipt_items;
CREATE TRIGGER trg_budget_from_grn_item
  AFTER INSERT OR DELETE OR UPDATE OF quantity_accepted, po_item_id ON goods_receipt_items
  FOR EACH ROW EXECUTE FUNCTION trg_budget_from_grn_item();

CREATE OR REPLACE FUNCTION trg_budget_from_grn() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_req uuid;
BEGIN
  SELECT po.requisition_id INTO v_req FROM purchase_orders po
   WHERE po.id = NEW.po_id AND po.delivery_closed_at IS NOT NULL;
  IF v_req IS NOT NULL THEN PERFORM refresh_requisition_budget(v_req); END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_budget_from_grn ON goods_receipt_notes;
CREATE TRIGGER trg_budget_from_grn
  AFTER UPDATE OF status ON goods_receipt_notes
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_budget_from_grn();

-- Lignes de réquisition : changement de ligne budgétaire (ajustement budgétaire, correction) ou de montant
CREATE OR REPLACE FUNCTION trg_budget_from_requisition_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_req uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.requisition_id ELSE NEW.requisition_id END;
BEGIN
  -- Sans bon de commande, la réquisition ne consomme rien
  IF EXISTS (SELECT 1 FROM purchase_orders WHERE requisition_id = v_req) THEN
    PERFORM refresh_requisition_budget(v_req,
      CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN ARRAY[OLD.budget_line_id] ELSE NULL END);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_budget_from_requisition_item ON requisition_items;
CREATE TRIGGER trg_budget_from_requisition_item
  AFTER INSERT OR DELETE OR UPDATE OF budget_line_id, total_amount, quantity, frequency, unit_price, item_description
  ON requisition_items
  FOR EACH ROW EXECUTE FUNCTION trg_budget_from_requisition_item();

-- Dépenses saisies à la main (POST /budget/expenses) : comptées si elles ne sont pas rattachées à un PO
CREATE OR REPLACE FUNCTION trg_budget_from_expense() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refresh_budget_utilization(ARRAY[
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.budget_id END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.budget_id END]);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_budget_from_expense ON budget_expenses;
CREATE TRIGGER trg_budget_from_expense
  AFTER INSERT OR DELETE OR UPDATE ON budget_expenses
  FOR EACH ROW EXECUTE FUNCTION trg_budget_from_expense();

-- Reprise : recalcul de toutes les lignes existantes
SELECT refresh_budget_utilization(array_agg(id)) FROM budget_allocations;
