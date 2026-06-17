
-- Trigger pour mettre à jour completed_at automatiquement
CREATE OR REPLACE FUNCTION update_completed_at()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'COMPLETED' AND OLD.status != 'COMPLETED' THEN
        NEW.completed_at = CURRENT_TIMESTAMP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger pour mettre à jour les statistiques des fournisseurs
CREATE OR REPLACE FUNCTION update_supplier_stats()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE suppliers
    SET 
        total_spent = (
            SELECT COALESCE(SUM(total_amount), 0)
            FROM purchase_orders
            WHERE supplier_id = NEW.supplier_id AND status = 'COMPLETED'
        ),
        order_count = (
            SELECT COUNT(*)
            FROM purchase_orders
            WHERE supplier_id = NEW.supplier_id
        )
    WHERE id = NEW.supplier_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_supplier_stats ON purchase_orders;
CREATE TRIGGER trigger_update_supplier_stats
    AFTER INSERT OR UPDATE ON purchase_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_supplier_stats();
