-- ============================================
-- APPELS D'OFFRES RÉSERVÉS (fournisseurs invités) & VÉRIFICATION DES DOCUMENTS
-- Un AO « PREQUALIFIED » n'est visible, notifié et ouvert qu'aux fournisseurs SÉLECTIONNÉS par l'acheteur
-- parmi les préqualifiés de sa catégorie (et de sa localisation).
-- Idempotent : peut être rejoué sur une base existante.
-- ============================================

CREATE TABLE IF NOT EXISTS tender_invitations (
    tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    invited_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tender_id, supplier_id)
);
CREATE INDEX IF NOT EXISTS idx_tender_invitations_supplier ON tender_invitations(supplier_id);

-- Éligibilité : AO ouvert à tous, ou fournisseur invité ET toujours préqualifié dans la catégorie
CREATE OR REPLACE FUNCTION supplier_eligible_for_tender(p_supplier_id INTEGER, p_tender_id INTEGER)
RETURNS BOOLEAN AS $$
  SELECT CASE
    WHEN t.audience = 'ALL' THEN TRUE
    ELSE EXISTS (
           SELECT 1 FROM tender_invitations ti
           WHERE ti.tender_id = t.id AND ti.supplier_id = p_supplier_id)
         AND EXISTS (
           SELECT 1 FROM supplier_prequalifications sp
           WHERE sp.enterprise_id = t.enterprise_id AND sp.supplier_id = p_supplier_id
             AND sp.category_id = t.category_id AND sp.status = 'APPROVED')
  END
  FROM tenders t WHERE t.id = p_tender_id;
$$ LANGUAGE sql STABLE;

-- ============================================
-- VÉRIFICATION DES DOCUMENTS PAR L'ENTREPRISE
-- Un fournisseur n'est préqualifiable que si TOUS ses documents attendus sont déposés ET vérifiés
-- par l'entreprise. La vérification porte sur une version précise du fichier (file_path) :
-- un document remplacé par le fournisseur doit être revérifié.
-- ============================================
CREATE TABLE IF NOT EXISTS supplier_document_reviews (
    id SERIAL PRIMARY KEY,
    enterprise_id UUID NOT NULL REFERENCES enterprise(id) ON DELETE CASCADE,
    document_id INTEGER NOT NULL REFERENCES supplier_documents(id) ON DELETE CASCADE,
    file_path VARCHAR(500) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('VERIFIED', 'REJECTED')),
    comment TEXT,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (enterprise_id, document_id)
);

-- Vérification des documents et décision de préqualification : administrateur d'entreprise
INSERT INTO permissions (id, name, description, resource, action)
SELECT 'perm_prequalify_suppliers', 'PREQUALIFY_SUPPLIERS', 'Vérifier les documents et préqualifier les fournisseurs', 'supplier', 'approve'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'PREQUALIFY_SUPPLIERS');

INSERT INTO profile_permissions (profile_id, permission_id)
SELECT 'prof_admin', p.id FROM permissions p
WHERE p.name = 'PREQUALIFY_SUPPLIERS' AND EXISTS (SELECT 1 FROM profiles WHERE id = 'prof_admin')
AND NOT EXISTS (SELECT 1 FROM profile_permissions pp WHERE pp.profile_id = 'prof_admin' AND pp.permission_id = p.id);
