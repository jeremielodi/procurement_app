-- ============================================
-- CONTRÔLE INTERNE
-- 1. Permissions d'écriture dédiées (avant : VIEW_PURCHASE_ORDERS suffisait pour saisir réception, SAN, facture, paiement)
--      RECORD_GOODS_RECEIPT      : réception (GRN)            — admin, logistique, magasinier
--      RECORD_SERVICE_ACCEPTANCE : acceptation de service     — admin, demandeur, managers
--      MANAGE_INVOICES           : saisie / validation facture — admin, finance
--      MANAGE_PAYMENTS           : saisie d'un paiement       — admin, finance
--      APPROVE_PAYMENTS          : approbation d'un paiement  — admin, finance, DG, management
--      VERIFY_SUPPLIER_BANK      : vérifier un changement de coordonnées bancaires — admin, finance
--      AUDIT_ACCESS              : consultation des modules réservés (budget) par l'auditeur
-- 2. Profil « Auditeur » (prof_auditor) : lecture seule, journal d'audit, aucune tâche GoFlow
-- 3. Coordonnées bancaires des fournisseurs : historique des changements (supplier_bank_changes) et vérification
--    PAR ENTREPRISE (supplier_bank_reviews) — un paiement est bloqué tant que le dernier changement n'est pas vérifié
-- 4. Factures : n° de facture du fournisseur distinct du n° interne INV-… ; doublon refusé (entreprise × fournisseur × n°)
-- 5. Journal d'audit : référence d'objet non-UUID (entity_ref) pour tracer budget, rôles, fournisseurs, documents…
-- Idempotent : peut être rejoué sur une base existante (après 20_audit_log_access.sql).
-- ============================================

-- 1. Permissions
INSERT INTO permissions (id, name, description, resource, action)
SELECT v.id, v.name, v.description, v.resource, v.action FROM (VALUES
  ('perm_record_goods_receipt', 'RECORD_GOODS_RECEIPT', 'Enregistrer une réception de marchandises (GRN)', 'goods_receipt', 'create'),
  ('perm_record_service_acceptance', 'RECORD_SERVICE_ACCEPTANCE', 'Enregistrer une acceptation de service (SAN)', 'service_acceptance', 'create'),
  ('perm_manage_invoices', 'MANAGE_INVOICES', 'Saisir, rapprocher, valider ou rejeter une facture', 'invoice', 'manage'),
  ('perm_manage_payments', 'MANAGE_PAYMENTS', 'Saisir un paiement', 'payment', 'create'),
  ('perm_approve_payments', 'APPROVE_PAYMENTS', 'Approuver un paiement ou changer son statut', 'payment', 'approve'),
  ('perm_verify_supplier_bank', 'VERIFY_SUPPLIER_BANK', 'Vérifier un changement de coordonnées bancaires d''un fournisseur', 'supplier', 'verify_bank'),
  ('perm_audit_access', 'AUDIT_ACCESS', 'Consulter en lecture les modules réservés (budget) pour un audit', 'audit', 'read')
) AS v(id, name, description, resource, action)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.name = v.name);

-- 2. Profil Auditeur
INSERT INTO profiles (id, name, description)
SELECT 'prof_auditor', 'Auditeur', 'Lecture seule : dossiers d''achat, stock, fournisseurs, budget, journal d''audit — aucune saisie ni tâche'
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'prof_auditor');

INSERT INTO profile_permissions (profile_id, permission_id)
SELECT pr.profile, p.id FROM (VALUES
  ('prof_admin', 'RECORD_GOODS_RECEIPT'), ('prof_logistic', 'RECORD_GOODS_RECEIPT'), ('prof_store_keeper', 'RECORD_GOODS_RECEIPT'),
  ('prof_admin', 'RECORD_SERVICE_ACCEPTANCE'), ('prof_requester', 'RECORD_SERVICE_ACCEPTANCE'),
  ('prof_manager', 'RECORD_SERVICE_ACCEPTANCE'), ('prof_manager_n2', 'RECORD_SERVICE_ACCEPTANCE'),
  ('prof_admin', 'MANAGE_INVOICES'), ('prof_finance', 'MANAGE_INVOICES'),
  ('prof_admin', 'MANAGE_PAYMENTS'), ('prof_finance', 'MANAGE_PAYMENTS'),
  ('prof_admin', 'APPROVE_PAYMENTS'), ('prof_finance', 'APPROVE_PAYMENTS'), ('prof_dg', 'APPROVE_PAYMENTS'), ('prof_management', 'APPROVE_PAYMENTS'),
  ('prof_admin', 'VERIFY_SUPPLIER_BANK'), ('prof_finance', 'VERIFY_SUPPLIER_BANK'),
  ('prof_auditor', 'VIEW_DASHBOARD'), ('prof_auditor', 'VIEW_REQUISITIONS'), ('prof_auditor', 'VIEW_PURCHASE_ORDERS'),
  ('prof_auditor', 'VIEW_SUPPLIERS'), ('prof_auditor', 'VIEW_PROJECTS'), ('prof_auditor', 'VIEW_DEPARTMENTS'),
  ('prof_auditor', 'VIEW_BUDGET'), ('prof_auditor', 'VIEW_STOCK'), ('prof_auditor', 'VIEW_AUDIT_LOGS'), ('prof_auditor', 'AUDIT_ACCESS')
) AS pr(profile, perm)
JOIN permissions p ON p.name = pr.perm
WHERE EXISTS (SELECT 1 FROM profiles WHERE id = pr.profile)
  AND NOT EXISTS (SELECT 1 FROM profile_permissions pp WHERE pp.profile_id = pr.profile AND pp.permission_id = p.id);

-- 3. Coordonnées bancaires des fournisseurs
CREATE TABLE IF NOT EXISTS supplier_bank_changes (
    id SERIAL PRIMARY KEY,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    old_values JSONB NOT NULL,
    new_values JSONB NOT NULL,
    source VARCHAR(20) NOT NULL CHECK (source IN ('PORTAL', 'BUYER')),
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    changed_by_email VARCHAR(255),
    enterprise_id UUID REFERENCES enterprise(id) ON DELETE SET NULL, -- entreprise de l'acheteur (source BUYER)
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_supplier_bank_changes_supplier ON supplier_bank_changes(supplier_id, id DESC);

CREATE TABLE IF NOT EXISTS supplier_bank_reviews (
    id SERIAL PRIMARY KEY,
    enterprise_id UUID NOT NULL REFERENCES enterprise(id) ON DELETE CASCADE,
    change_id INTEGER NOT NULL REFERENCES supplier_bank_changes(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('VERIFIED', 'REJECTED')),
    reason TEXT,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (enterprise_id, change_id),
    CHECK (status = 'VERIFIED' OR NULLIF(TRIM(reason), '') IS NOT NULL)
);

-- 4. Factures : n° du fournisseur
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS supplier_invoice_number VARCHAR(100);
-- Factures existantes : le formulaire écrivait le n° du fournisseur dans invoice_number
UPDATE invoices SET supplier_invoice_number = invoice_number
WHERE supplier_invoice_number IS NULL AND invoice_number !~ '^INV-[0-9]{4}-[0-9]+$';
-- Fournisseur de la facture = celui du bon de commande
UPDATE invoices i SET supplier_id = po.supplier_id
FROM purchase_orders po WHERE po.id = i.po_id AND i.supplier_id IS NULL AND po.supplier_id IS NOT NULL;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM invoices
    WHERE supplier_invoice_number IS NOT NULL AND status NOT IN ('REJECTED', 'CANCELLED')
    GROUP BY enterprise_id, supplier_id, LOWER(TRIM(supplier_invoice_number)) HAVING COUNT(*) > 1
  ) THEN
    RAISE NOTICE 'Factures en double déjà présentes : index unique non créé (contrôle applicatif seulement). Voir la requête de contrôle dans readme.md.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_supplier_number
      ON invoices (enterprise_id, supplier_id, LOWER(TRIM(supplier_invoice_number)))
      WHERE supplier_invoice_number IS NOT NULL AND status NOT IN ('REJECTED', 'CANCELLED');
  END IF;
END $$;

-- 5. Journal d'audit : objet concerné autre qu'un compte
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_ref VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_audit_entity_ref ON audit_logs(entity_type, entity_ref);
