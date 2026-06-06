-- database/complete_schema.sql

-- UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ============================================
-- TABLE DES DÉPARTEMENTS
-- ============================================
CREATE TABLE IF NOT EXISTS departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    manager_id UUID REFERENCES users(id),
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLE DES PROJETS
-- ============================================
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    project_manager_id UUID REFERENCES users(id),
    status VARCHAR(50) DEFAULT 'ACTIVE',
    start_date DATE,
    end_date DATE,
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLE DES MEMBRES DE PROJET
-- ============================================
CREATE TABLE IF NOT EXISTS project_members (
    id SERIAL PRIMARY KEY,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    role VARCHAR(50),
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    assigned_by UUID REFERENCES users(id),
    UNIQUE(project_id, user_id)
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_departments_code ON departments(code);
CREATE INDEX IF NOT EXISTS idx_departments_manager ON departments(manager_id);
CREATE INDEX IF NOT EXISTS idx_projects_code ON projects(code);
CREATE INDEX IF NOT EXISTS idx_projects_department ON projects(department_id);
CREATE INDEX IF NOT EXISTS idx_projects_manager ON projects(project_manager_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);

-- ============================================
-- 1. TABLE DES UTILISATEURS
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(50),
    last_name VARCHAR(50),
    department VARCHAR(100),
    position VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 2. TABLE DES PROFILS
-- ============================================
CREATE TABLE IF NOT EXISTS profiles (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 3. TABLE USER_PROFILES (liaison utilisateur - profil)
-- ============================================
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    profile_id VARCHAR(50) REFERENCES profiles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    assigned_by UUID REFERENCES users(id),
    PRIMARY KEY (user_id, profile_id)
);

-- ============================================
-- 4. TABLE DES PERMISSIONS
-- ============================================
CREATE TABLE IF NOT EXISTS permissions (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    resource VARCHAR(50),
    action VARCHAR(50)
);

-- ============================================
-- 5. TABLE PROFILE_PERMISSIONS (liaison profil - permission)
-- ============================================
CREATE TABLE IF NOT EXISTS profile_permissions (
    profile_id VARCHAR(50) REFERENCES profiles(id) ON DELETE CASCADE,
    permission_id VARCHAR(50) REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (profile_id, permission_id)
);

-- ============================================
-- 6. TABLE DES RÉQUISITIONS
-- ============================================
CREATE TABLE IF NOT EXISTS requisitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requisition_number VARCHAR(20) UNIQUE NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    department VARCHAR(100),
    project_code VARCHAR(50),
    budget_line VARCHAR(100),
    estimated_amount DECIMAL(15,2),
    currency VARCHAR(3) DEFAULT 'USD',
    requester_id UUID REFERENCES users(id),
    status VARCHAR(50) DEFAULT 'DRAFT',
    priority VARCHAR(20),
    justification TEXT,
    process_instance_id VARCHAR(50),
    completed_at TIMESTAMP,
    submitted_at TIMESTAMP,
    approved_at TIMESTAMP,
    rejected_at TIMESTAMP,
    rejected_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 7. TABLE DES ARTICLES DE RÉQUISITION
-- ============================================
CREATE TABLE IF NOT EXISTS requisition_items (
    id SERIAL PRIMARY KEY,
    requisition_id UUID REFERENCES requisitions(id) ON DELETE CASCADE,
    item_description TEXT NOT NULL,
    quantity  DECIMAL(15,2) NOT NULL,
    frequency  frequency  DECIMAL(15,2) NOT NULL default 1,
    unit_price DECIMAL(15,2),
    total_amount DECIMAL(15,2),
    budget_line_code VARCHAR(50),
    budget_line_id UUID,
    specifications TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_requisition_items_budget_line ON requisition_items(budget_line_id);
-- ============================================
-- 8. TABLE DES FOURNISSEURS
-- ============================================
CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY,
    supplier_code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    registration_number VARCHAR(100),
    tax_id VARCHAR(100),
    email VARCHAR(100),
    phone VARCHAR(20),
    address TEXT,
    website VARCHAR(200),
    status VARCHAR(50) DEFAULT 'ACTIVE',
    prequalified BOOLEAN DEFAULT FALSE,
    due_diligence_completed BOOLEAN DEFAULT FALSE,
    due_diligence_date DATE,
    rating DECIMAL(3,2),
    payment_terms VARCHAR(50),
    delivery_terms VARCHAR(50),
    bank_name VARCHAR(100),
    bank_account VARCHAR(100),
    bank_iban VARCHAR(100),
    bank_swift VARCHAR(50),
    notes TEXT,
    total_spent DECIMAL(15,2) DEFAULT 0,
    order_count INTEGER DEFAULT 0,
    last_evaluation_date DATE,
    evaluation_comments TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 9. TABLE DES COMMANDES D'ACHAT
-- ============================================
CREATE TABLE IF NOT EXISTS purchase_orders (
    id SERIAL PRIMARY KEY,
    po_number VARCHAR(20) UNIQUE NOT NULL,
    requisition_id UUID REFERENCES requisitions(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    order_date DATE,
    delivery_date DATE,
    shipping_address TEXT,
    total_amount DECIMAL(15,2),
    currency VARCHAR(3) DEFAULT 'USD',
    status VARCHAR(50) DEFAULT 'DRAFT',
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP,
    completed_at TIMESTAMP,
    shipped_at TIMESTAMP,
    tracking_number VARCHAR(100),
    created_by UUID REFERENCES users(id),
    process_instance_id VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 10. TABLE DES ARTICLES DE COMMANDE
-- ============================================
CREATE TABLE IF NOT EXISTS purchase_order_items (
    id SERIAL PRIMARY KEY,
    purchase_order_id INTEGER REFERENCES purchase_orders(id) ON DELETE CASCADE,
    item_description TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(15,2),
    total_amount DECIMAL(15,2),
    specifications TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 11. TABLE DES ALLOCATIONS BUDGÉTAIRES
-- ============================================
CREATE TABLE IF NOT EXISTS budget_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_code VARCHAR(50) NOT NULL,
    loc VARCHAR(100),
    funding_source VARCHAR(100),
    sub_project VARCHAR(100),
    function_code VARCHAR(50),
    description TEXT,
    allocated_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    utilized_amount DECIMAL(15,2) DEFAULT 0,
    remaining_amount DECIMAL(15,2) GENERATED ALWAYS AS (allocated_amount - utilized_amount) STORED,
    project_id UUID REFERENCES projects(id),
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(entity_code, project_id)
);


-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_budget_allocations_entity ON budget_allocations(entity_code);
CREATE INDEX IF NOT EXISTS idx_budget_allocations_project ON budget_allocations(project_id);
CREATE INDEX IF NOT EXISTS idx_budget_allocations_funding ON budget_allocations(funding_source);
CREATE INDEX IF NOT EXISTS idx_budget_expenses_budget ON budget_expenses(budget_id);
CREATE INDEX IF NOT EXISTS idx_budget_expenses_requisition ON budget_expenses(requisition_id);

-- ============================================
-- TABLE DES DÉPENSES
-- ============================================
CREATE TABLE IF NOT EXISTS budget_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_id UUID REFERENCES budget_allocations(id) ON DELETE CASCADE,
    requisition_id UUID REFERENCES requisitions(id),
    purchase_order_id INTEGER REFERENCES purchase_orders(id),
    amount DECIMAL(15,2) NOT NULL,
    description TEXT,
    expense_date DATE DEFAULT CURRENT_DATE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- ============================================
-- 12. TABLE DES JUSTIFICATIONS SOURCE UNIQUE
-- ============================================
CREATE TABLE IF NOT EXISTS sole_source_justifications (
    id SERIAL PRIMARY KEY,
    requisition_id UUID REFERENCES requisitions(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    justification TEXT NOT NULL,
    approved BOOLEAN DEFAULT FALSE,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 13. TABLE DES BONS DE RÉCEPTION
-- ============================================
CREATE TABLE IF NOT EXISTS goods_receipt_notes (
    id SERIAL PRIMARY KEY,
    grn_number VARCHAR(20) UNIQUE NOT NULL,
    po_id INTEGER REFERENCES purchase_orders(id),
    receipt_date DATE,
    received_by UUID REFERENCES users(id),
    status VARCHAR(50) DEFAULT 'DRAFT',
    observations TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 14. TABLE DES ARTICLES REÇUS
-- ============================================
CREATE TABLE IF NOT EXISTS goods_receipt_items (
    id SERIAL PRIMARY KEY,
    grn_id INTEGER REFERENCES goods_receipt_notes(id) ON DELETE CASCADE,
    item_description TEXT NOT NULL,
    quantity_received INTEGER NOT NULL,
    quantity_accepted INTEGER,
    quantity_rejected INTEGER,
    rejection_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 15. TABLE DES NOTES D'ACCEPTATION DE SERVICE
-- ============================================
CREATE TABLE IF NOT EXISTS service_acceptance_notes (
    id SERIAL PRIMARY KEY,
    san_number VARCHAR(20) UNIQUE NOT NULL,
    po_id INTEGER REFERENCES purchase_orders(id),
    acceptance_date DATE,
    accepted_by UUID REFERENCES users(id),
    status VARCHAR(50) DEFAULT 'DRAFT',
    comments TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 16. TABLE DES PIÈCES JOINTES
-- ============================================
CREATE TABLE IF NOT EXISTS attachments (
    id SERIAL PRIMARY KEY,
    entity_type VARCHAR(50),
    entity_id UUID,
    file_name VARCHAR(255),
    file_path VARCHAR(500),
    file_size INTEGER,
    mime_type VARCHAR(100),
    uploaded_by UUID REFERENCES users(id),
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 17. TABLE DE L'HISTORIQUE DU WORKFLOW
-- ============================================
CREATE TABLE IF NOT EXISTS workflow_history (
    id SERIAL PRIMARY KEY,
    process_instance_id VARCHAR(50),
    entity_type VARCHAR(50),
    entity_id UUID,
    task_id VARCHAR(50),
    task_name VARCHAR(100),
    action VARCHAR(50),
    comments TEXT,
    performed_by UUID REFERENCES users(id),
    performed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 18. TABLE DES NOTIFICATIONS
-- ============================================
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) DEFAULT 'INFO',
    link VARCHAR(500),
    read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 19. TABLE DES LOGS D'AUDIT
-- ============================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    action VARCHAR(100),
    entity_type VARCHAR(50),
    entity_id UUID,
    old_value JSONB,
    new_value JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 20. TABLE DES ÉVALUATIONS FOURNISSEURS
-- ============================================
CREATE TABLE IF NOT EXISTS supplier_evaluations (
    id SERIAL PRIMARY KEY,
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE CASCADE,
    evaluator_id UUID REFERENCES users(id),
    rating DECIMAL(3,2) NOT NULL,
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 21. TABLE DES LIVRAISONS
-- ============================================
CREATE TABLE IF NOT EXISTS deliveries (
    id SERIAL PRIMARY KEY,
    po_id INTEGER REFERENCES purchase_orders(id),
    delivery_date DATE,
    tracking_number VARCHAR(100),
    quantity_delivered INTEGER,
    status VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 22. TABLE DES APPROBATIONS
-- ============================================
CREATE TABLE IF NOT EXISTS approvals (
    id SERIAL PRIMARY KEY,
    entity_type VARCHAR(50),
    entity_id UUID,
    approver_id UUID REFERENCES users(id),
    status VARCHAR(50),
    comments TEXT,
    approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- INDEXES POUR LES PERFORMANCES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_requisitions_number ON requisitions(requisition_number);
CREATE INDEX IF NOT EXISTS idx_requisitions_status ON requisitions(status);
CREATE INDEX IF NOT EXISTS idx_requisitions_requester ON requisitions(requester_id);
CREATE INDEX IF NOT EXISTS idx_requisitions_process ON requisitions(process_instance_id);
CREATE INDEX IF NOT EXISTS idx_requisitions_created ON requisitions(created_at);
CREATE INDEX IF NOT EXISTS idx_requisitions_department ON requisitions(department);
CREATE INDEX IF NOT EXISTS idx_requisitions_budget_line ON requisitions(budget_line);

CREATE INDEX IF NOT EXISTS idx_po_number ON purchase_orders(po_number);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_requisition ON purchase_orders(requisition_id);
CREATE INDEX IF NOT EXISTS idx_po_created_by ON purchase_orders(created_by);
CREATE INDEX IF NOT EXISTS idx_po_approved_by ON purchase_orders(approved_by);

CREATE INDEX IF NOT EXISTS idx_supplier_status ON suppliers(status);
CREATE INDEX IF NOT EXISTS idx_supplier_prequalified ON suppliers(prequalified);
CREATE INDEX IF NOT EXISTS idx_supplier_code ON suppliers(supplier_code);
CREATE INDEX IF NOT EXISTS idx_supplier_rating ON suppliers(rating);

CREATE INDEX IF NOT EXISTS idx_budget_allocations_line ON budget_allocations(budget_line);
CREATE INDEX IF NOT EXISTS idx_budget_allocations_dept ON budget_allocations(department);
CREATE INDEX IF NOT EXISTS idx_budget_allocations_year ON budget_allocations(fiscal_year);

CREATE INDEX IF NOT EXISTS idx_workflow_process ON workflow_history(process_instance_id);
CREATE INDEX IF NOT EXISTS idx_workflow_entity ON workflow_history(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_workflow_performed ON workflow_history(performed_at);
CREATE INDEX IF NOT EXISTS idx_workflow_performed_by ON workflow_history(performed_by);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_attachments_uploaded_by ON attachments(uploaded_by);

CREATE INDEX IF NOT EXISTS idx_supplier_evaluations_supplier ON supplier_evaluations(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_evaluations_evaluator ON supplier_evaluations(evaluator_id);

CREATE INDEX IF NOT EXISTS idx_deliveries_po ON deliveries(po_id);
CREATE INDEX IF NOT EXISTS idx_approvals_entity ON approvals(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_approvals_approver ON approvals(approver_id);
CREATE INDEX IF NOT EXISTS idx_sole_source_requisition ON sole_source_justifications(requisition_id);
CREATE INDEX IF NOT EXISTS idx_sole_source_supplier ON sole_source_justifications(supplier_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_po ON goods_receipt_notes(po_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_received_by ON goods_receipt_notes(received_by);
CREATE INDEX IF NOT EXISTS idx_service_acceptance_po ON service_acceptance_notes(po_id);
CREATE INDEX IF NOT EXISTS idx_service_acceptance_accepted_by ON service_acceptance_notes(accepted_by);

-- ============================================
-- FONCTIONS ET TRIGGERS
-- ============================================

-- Fonction pour mettre à jour updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers pour updated_at
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_requisitions_updated_at
    BEFORE UPDATE ON requisitions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_suppliers_updated_at
    BEFORE UPDATE ON suppliers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_purchase_orders_updated_at
    BEFORE UPDATE ON purchase_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_budget_allocations_updated_at
    BEFORE UPDATE ON budget_allocations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_notifications_updated_at
    BEFORE UPDATE ON notifications
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

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

DROP TRIGGER IF EXISTS trigger_update_completed_at ON requisitions;
CREATE TRIGGER trigger_update_completed_at
    BEFORE UPDATE ON requisitions
    FOR EACH ROW
    EXECUTE FUNCTION update_completed_at();

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

-- ============================================
-- VUES POUR LE DASHBOARD
-- ============================================

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
    department,
    COUNT(*) as requisition_count,
    SUM(estimated_amount) as total_amount,
    AVG(estimated_amount) as avg_amount
FROM requisitions
WHERE department IS NOT NULL
GROUP BY department
ORDER BY total_amount DESC;
