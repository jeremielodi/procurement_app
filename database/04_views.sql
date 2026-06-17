
-- Vue des statistiques par mois
CREATE OR REPLACE VIEW monthly_stats AS
SELECT 
    TO_CHAR(created_at, 'YYYY-MM') as month,
    COUNT(*) as total_requisitions,
    SUM(estimated_amount) as total_amount,
    COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) as approved_count,
    COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as completed_count
FROM requisitions
GROUP BY TO_CHAR(created_at, 'YYYY-MM')
ORDER BY month DESC;

-- Vue des statistiques par département
CREATE OR REPLACE VIEW department_stats AS
SELECT 
    r.department_id,
    d.code as department_code,
    d.name as department_name,
    COUNT(r.*) as requisition_count,
    SUM(r.estimated_amount) as total_amount,
    AVG(r.estimated_amount) as avg_amount
FROM requisitions r
JOIN departments d ON d.id = r.department_id
WHERE r.department_id IS NOT NULL
GROUP BY r.department_id, d.code, d.name
ORDER BY total_amount DESC;
