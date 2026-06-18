-- database/currency_data.sql
INSERT INTO currency (id, name, format_key, symbol, intel_number_format, note, min_monentary_unit) VALUES
(1, 'Dollar Américain', 'USD', '$', 'en-US', 'Monnaie de référence', 0.01),
(2, 'Euro', 'EUR', '€', 'fr-FR', 'Monnaie européenne', 0.01),
(3, 'Franc Congolais', 'CDF', 'FC', 'fr-CD', 'Monnaie locale RDC', 1.00),
(4, 'Livre Sterling', 'GBP', '£', 'en-GB', NULL, 0.01),
(5, 'Franc Suisse', 'CHF', 'CHF', 'fr-CH', NULL, 0.01),
(6, 'Yen Japonais', 'JPY', '¥', 'ja-JP', NULL, 1.00),
(7, 'Dollar Canadien', 'CAD', 'C$', 'en-CA', NULL, 0.01),
(8, 'Dollar Australien', 'AUD', 'A$', 'en-AU', NULL, 0.01),
(9, 'Real Brésilien', 'BRL', 'R$', 'pt-BR', NULL, 0.01),
(10, 'Roupie Indienne', 'INR', '₹', 'en-IN', NULL, 0.01)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  format_key = EXCLUDED.format_key,
  symbol = EXCLUDED.symbol,
  intel_number_format = EXCLUDED.intel_number_format,
  note = EXCLUDED.note,
  min_monentary_unit = EXCLUDED.min_monentary_unit;


INSERT INTO enterprise(name,code, currency_id)VALUES
('World Wide Fund for Nature', 'WWF', 1);

INSERT INTO permissions (id, name, description, resource, action)
SELECT * FROM (VALUES
    ('perm_view_requisitions', 'VIEW_REQUISITIONS', 'Voir les réquisitions', 'requisition', 'read'),
    ('perm_create_requisitions', 'CREATE_REQUISITIONS', 'Créer des réquisitions', 'requisition', 'create'),
    ('perm_edit_requisitions', 'EDIT_REQUISITIONS', 'Modifier les réquisitions', 'requisition', 'update'),
    ('perm_delete_requisitions', 'DELETE_REQUISITIONS', 'Supprimer les réquisitions', 'requisition', 'delete'),
    ('perm_approve_requisitions', 'APPROVE_REQUISITIONS', 'Approuver les réquisitions', 'requisition', 'approve'),
    ('perm_view_suppliers', 'VIEW_SUPPLIERS', 'Voir les fournisseurs', 'supplier', 'read'),
    ('perm_manage_suppliers', 'MANAGE_SUPPLIERS', 'Gérer les fournisseurs', 'supplier', 'write'),
    ('perm_view_orders', 'VIEW_PURCHASE_ORDERS', 'Voir les commandes', 'purchase_order', 'read'),
    ('perm_create_orders', 'CREATE_PURCHASE_ORDERS', 'Créer des commandes', 'purchase_order', 'create'),
    ('perm_edit_orders', 'EDIT_PURCHASE_ORDERS', 'Modifier les commandes', 'purchase_order', 'update'),
    ('perm_delete_orders', 'DELETE_PURCHASE_ORDERS', 'Supprimer les commandes', 'purchase_order', 'delete'),
    ('perm_approve_orders', 'APPROVE_PURCHASE_ORDERS', 'Approuver les commandes', 'purchase_order', 'approve'),
    ('perm_view_dashboard', 'VIEW_DASHBOARD', 'Voir le tableau de bord', 'dashboard', 'read'),
    ('perm_manage_users', 'MANAGE_USERS', 'Gérer les utilisateurs', 'user', 'write'),
    ('perm_manage_workflow', 'MANAGE_WORKFLOW', 'Gérer les workflows', 'workflow', 'write'),
    ('perm_view_departments', 'VIEW_DEPARTMENTS', 'Voir les départements', 'department', 'read'),
    ('perm_manage_departments', 'MANAGE_DEPARTMENTS', 'Gérer les départements', 'department', 'write'),
    ('perm_view_projects', 'VIEW_PROJECTS', 'Voir les projets', 'project', 'read'),
    ('perm_manage_projects', 'MANAGE_PROJECTS', 'Gérer les projets', 'project', 'write'),
    ('perm_manage_enterprises', 'MANAGE_ENTERPRISES', 'Gérer les entreprises', 'enterprise', 'write'),
    ('perm_manage_currencies', 'MANAGE_CURRENCIES', 'Gérer les devises', 'currency', 'write'),
    ('perm_view_budget', 'VIEW_BUDGET', 'Voir les budgets', 'budget', 'read'),
    ('perm_manage_budget', 'MANAGE_BUDGET', 'Gérer les budgets', 'budget', 'write')
) AS tmp(id, name, description, resource, action)
WHERE NOT EXISTS (
    SELECT 1 FROM permissions WHERE name = tmp.name
);


INSERT INTO profiles (id, name, description)
SELECT * FROM (VALUES
    ('prof_admin', 'Administrateur', 'Accès complet au système'),
    ('prof_manager', 'Manager', 'Gestion et approbation'),
    ('prof_manager_n2', 'Manager N2', 'Gestion et approbation de plus 10.000'),
    ('prof_user', 'Utilisateur', 'Utilisateur standard'),
    ('prof_requester', 'Demandeur', 'Peut créer des réquisitions'),
    ('prof_approver', 'Approbateur', 'Peut approuver les réquisitions'),
    ('prof_procurement', 'Agent d''achat', 'Gère les achats'),
    ('prof_finance', 'Finance', 'Gère les aspects financiers'),
    ('prof_store_keeper', 'Magasinier', 'Gère les stocks')
) AS tmp(id, name, description)
WHERE NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = tmp.id
);


INSERT INTO profile_permissions (profile_id, permission_id)
SELECT 
    'prof_admin' AS profile_id,
    p.id AS permission_id
FROM permissions p
WHERE NOT EXISTS (
    SELECT 1 
    FROM profile_permissions pp 
    WHERE pp.profile_id = 'prof_admin' 
    AND pp.permission_id = p.id
);

-- 2. MANAGER - Management and approval permissions
INSERT INTO profile_permissions (profile_id, permission_id)
SELECT 
    'prof_manager' AS profile_id,
    p.id AS permission_id
FROM permissions p
WHERE p.name IN (
    'VIEW_REQUISITIONS',
    'CREATE_REQUISITIONS',
    'EDIT_REQUISITIONS',
    'DELETE_REQUISITIONS',
    'APPROVE_REQUISITIONS',
    'VIEW_SUPPLIERS',
    'VIEW_PURCHASE_ORDERS',
    'CREATE_PURCHASE_ORDERS',
    'EDIT_PURCHASE_ORDERS',
    'APPROVE_PURCHASE_ORDERS',
    'VIEW_DASHBOARD',
    'VIEW_DEPARTMENTS',
    'VIEW_PROJECTS',
    'VIEW_BUDGET'
)
AND NOT EXISTS (
    SELECT 1 
    FROM profile_permissions pp 
    WHERE pp.profile_id = 'prof_manager' 
    AND pp.permission_id = p.id
);

-- 3. MANAGER N2 - Same as Manager + can approve higher amounts (>10,000)
INSERT INTO profile_permissions (profile_id, permission_id)
SELECT 
    'prof_manager_n2' AS profile_id,
    p.id AS permission_id
FROM permissions p
WHERE p.name IN (
    'VIEW_REQUISITIONS',
    'CREATE_REQUISITIONS',
    'EDIT_REQUISITIONS',
    'DELETE_REQUISITIONS',
    'APPROVE_REQUISITIONS',
    'VIEW_SUPPLIERS',
    'VIEW_PURCHASE_ORDERS',
    'CREATE_PURCHASE_ORDERS',
    'EDIT_PURCHASE_ORDERS',
    'APPROVE_PURCHASE_ORDERS',
    'VIEW_DASHBOARD',
    'VIEW_DEPARTMENTS',
    'VIEW_PROJECTS',
    'VIEW_BUDGET'
)
AND NOT EXISTS (
    SELECT 1 
    FROM profile_permissions pp 
    WHERE pp.profile_id = 'prof_manager_n2' 
    AND pp.permission_id = p.id
);

-- 4. UTILISATEUR - Basic read-only access
INSERT INTO profile_permissions (profile_id, permission_id)
SELECT 
    'prof_user' AS profile_id,
    p.id AS permission_id
FROM permissions p
WHERE p.name IN (
    'VIEW_REQUISITIONS',
    'VIEW_SUPPLIERS',
    'VIEW_PURCHASE_ORDERS',
    'VIEW_DASHBOARD',
    'VIEW_DEPARTMENTS',
    'VIEW_PROJECTS',
    'VIEW_BUDGET'
)
AND NOT EXISTS (
    SELECT 1 
    FROM profile_permissions pp 
    WHERE pp.profile_id = 'prof_user' 
    AND pp.permission_id = p.id
);

-- 5. DEMANDEUR - Can create and manage their own requisitions
INSERT INTO profile_permissions (profile_id, permission_id)
SELECT 
    'prof_requester' AS profile_id,
    p.id AS permission_id
FROM permissions p
WHERE p.name IN (
    'VIEW_REQUISITIONS',
    'CREATE_REQUISITIONS',
    'EDIT_REQUISITIONS',
    'DELETE_REQUISITIONS',
    'VIEW_SUPPLIERS',
    'VIEW_PURCHASE_ORDERS',
    'VIEW_DASHBOARD',
    'VIEW_PROJECTS',
    'VIEW_DEPARTMENTS',
    'VIEW_BUDGET'
)
AND NOT EXISTS (
    SELECT 1 
    FROM profile_permissions pp 
    WHERE pp.profile_id = 'prof_requester' 
    AND pp.permission_id = p.id
);

-- 6. APPROBATEUR - Can approve requisitions
INSERT INTO profile_permissions (profile_id, permission_id)
SELECT 
    'prof_approver' AS profile_id,
    p.id AS permission_id
FROM permissions p
WHERE p.name IN (
    'VIEW_REQUISITIONS',
    'APPROVE_REQUISITIONS',
    'VIEW_SUPPLIERS',
    'VIEW_PURCHASE_ORDERS',
    'VIEW_DASHBOARD',
    'VIEW_DEPARTMENTS',
    'VIEW_PROJECTS',
    'VIEW_BUDGET'
)
AND NOT EXISTS (
    SELECT 1 
    FROM profile_permissions pp 
    WHERE pp.profile_id = 'prof_approver' 
    AND pp.permission_id = p.id
);

-- 7. AGENT D'ACHAT - Full procurement management
INSERT INTO profile_permissions (profile_id, permission_id)
SELECT 
    'prof_procurement' AS profile_id,
    p.id AS permission_id
FROM permissions p
WHERE p.name IN (
    'VIEW_REQUISITIONS',
    'VIEW_SUPPLIERS',
    'MANAGE_SUPPLIERS',
    'VIEW_PURCHASE_ORDERS',
    'CREATE_PURCHASE_ORDERS',
    'EDIT_PURCHASE_ORDERS',
    'DELETE_PURCHASE_ORDERS',
    'APPROVE_PURCHASE_ORDERS',
    'VIEW_DASHBOARD',
    'VIEW_DEPARTMENTS',
    'VIEW_PROJECTS',
    'VIEW_BUDGET'
)
AND NOT EXISTS (
    SELECT 1 
    FROM profile_permissions pp 
    WHERE pp.profile_id = 'prof_procurement' 
    AND pp.permission_id = p.id
);

-- 8. FINANCE - Financial oversight
INSERT INTO profile_permissions (profile_id, permission_id)
SELECT 
    'prof_finance' AS profile_id,
    p.id AS permission_id
FROM permissions p
WHERE p.name IN (
    'VIEW_REQUISITIONS',
    'APPROVE_REQUISITIONS',
    'VIEW_SUPPLIERS',
    'VIEW_PURCHASE_ORDERS',
    'APPROVE_PURCHASE_ORDERS',
    'VIEW_DASHBOARD',
    'VIEW_DEPARTMENTS',
    'VIEW_PROJECTS',
    'VIEW_BUDGET',
    'MANAGE_BUDGET'
)
AND NOT EXISTS (
    SELECT 1 
    FROM profile_permissions pp 
    WHERE pp.profile_id = 'prof_finance' 
    AND pp.permission_id = p.id
);

-- 9. MAGASINIER - Store/Inventory management
INSERT INTO profile_permissions (profile_id, permission_id)
SELECT 
    'prof_store_keeper' AS profile_id,
    p.id AS permission_id
FROM permissions p
WHERE p.name IN (
    'VIEW_REQUISITIONS',
    'VIEW_SUPPLIERS',
    'VIEW_PURCHASE_ORDERS',
    'VIEW_DASHBOARD',
    'VIEW_DEPARTMENTS',
    'VIEW_PROJECTS',
    'VIEW_DEPARTMENTS'
)
AND NOT EXISTS (
    SELECT 1 
    FROM profile_permissions pp 
    WHERE pp.profile_id = 'prof_store_keeper' 
    AND pp.permission_id = p.id
);