

-- Insertion des allocations budgétaires par défaut
INSERT INTO budget_allocations (budget_line, department, allocated_amount, utilized_amount, fiscal_year)
VALUES 
    ('IT-EQUIP-2026', 'IT', 50000, 0, 2026),
    ('OFFICE-SUP-2026', 'Administration', 30000, 0, 2026),
    ('CONSULT-2026', 'Operations', 100000, 0, 2026),
    ('TRAINING-2026', 'HR', 25000, 0, 2026),
    ('SOFTWARE-2026', 'IT', 75000, 0, 2026),
    ('MAINTENANCE-2026', 'Operations', 40000, 0, 2026),
    ('MARKETING-2026', 'Administration', 35000, 0, 2026)
ON CONFLICT (budget_line, department, fiscal_year) DO NOTHING;