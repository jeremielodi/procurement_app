-- ============================================
-- PRÉQUALIFICATION DES FOURNISSEURS
--  - Localisations (bureaux) et catégories de marché : référentiels de la PLATEFORME (super admin),
--    partagés comme les fournisseurs
--  - Fournisseur : type Entreprise / Personne physique, localisations desservies, catégories fournies,
--    documents (pièce d'identité, RCCM, attestation fiscale, ID Nat, RIB)
--  - Préqualification : propre à chaque entreprise, par catégorie (la localité vient des localisations
--    déclarées par le fournisseur)
--  - Appel d'offres : catégorie, localisation et diffusion (tous / préqualifiés seulement)
-- Idempotent : peut être rejoué sur une base existante.
-- ============================================

-- 1. Référentiels de la plateforme
CREATE TABLE IF NOT EXISTS locations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    province VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_name ON locations (LOWER(name));

CREATE TABLE IF NOT EXISTS market_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_categories_name ON market_categories (LOWER(name));

-- Valeurs initiales (modifiables par le super admin)
INSERT INTO locations (name, province)
SELECT v.name, v.province FROM (VALUES
    ('Bunia', 'Ituri'), ('Mambasa', 'Ituri'), ('Isiro', 'Haut-Uélé'), ('Goma', 'Nord-Kivu'),
    ('Beni', 'Nord-Kivu'), ('Butembo', 'Nord-Kivu'), ('Kisangani', 'Tshopo'), ('Wamba', 'Haut-Uélé'),
    ('Makiso', 'Tshopo')
) AS v(name, province)
WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE LOWER(l.name) = LOWER(v.name));

INSERT INTO market_categories (name)
SELECT v.name FROM (VALUES
    ('Construction et réhabilitation WASH'), ('Fournitures de bureau'), ('Équipements de bureau'),
    ('Hôtellerie'), ('Restauration et location de salle de formation'),
    ('Location de véhicule de transport de personnes'), ('Location de véhicule de transport de marchandises'),
    ('Matériel IT et de communication'), ('Visibilité et imprimerie'), ('Matériel WASH / PCI'),
    ('Matériel de construction'), ('Carburant')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM market_categories c WHERE LOWER(c.name) = LOWER(v.name));

-- 2. Fournisseur : type, identifiants, localisations, catégories
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supplier_type VARCHAR(20) NOT NULL DEFAULT 'COMPANY';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS id_nat VARCHAR(100);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS id_document_number VARCHAR(100);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_type_check') THEN
    ALTER TABLE suppliers ADD CONSTRAINT suppliers_type_check CHECK (supplier_type IN ('COMPANY', 'INDIVIDUAL'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS supplier_locations (
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    PRIMARY KEY (supplier_id, location_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_locations_location ON supplier_locations(location_id);

CREATE TABLE IF NOT EXISTS supplier_categories (
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES market_categories(id) ON DELETE CASCADE,
    PRIMARY KEY (supplier_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_categories_category ON supplier_categories(category_id);

-- 3. Documents du fournisseur (un fichier courant par type ; l'historique reste dans le bucket versionné)
CREATE TABLE IF NOT EXISTS supplier_documents (
    id SERIAL PRIMARY KEY,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    doc_type VARCHAR(20) NOT NULL CHECK (doc_type IN ('ID_CARD', 'RCCM', 'TAX', 'ID_NAT', 'RIB')),
    file_path VARCHAR(500) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100),
    file_size INTEGER,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (supplier_id, doc_type)
);

-- 4. Préqualification : par entreprise et par catégorie (absence de ligne = en attente)
CREATE TABLE IF NOT EXISTS supplier_prequalifications (
    id SERIAL PRIMARY KEY,
    enterprise_id UUID NOT NULL REFERENCES enterprise(id) ON DELETE CASCADE,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES market_categories(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('APPROVED', 'REJECTED')),
    comment TEXT,
    decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (enterprise_id, supplier_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_preq_lookup ON supplier_prequalifications(enterprise_id, category_id, status);

-- 5. Appel d'offres : catégorie, localisation, diffusion
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES market_categories(id);
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id);
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS audience VARCHAR(20) NOT NULL DEFAULT 'ALL';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenders_audience_check') THEN
    ALTER TABLE tenders ADD CONSTRAINT tenders_audience_check CHECK (audience IN ('ALL', 'PREQUALIFIED'));
  END IF;
END $$;

-- 6. Éligibilité d'un fournisseur à un appel d'offres
CREATE OR REPLACE FUNCTION supplier_eligible_for_tender(p_supplier_id INTEGER, p_tender_id INTEGER)
RETURNS BOOLEAN AS $$
  SELECT CASE
    WHEN t.audience = 'ALL' THEN TRUE
    ELSE EXISTS (
           SELECT 1 FROM supplier_prequalifications sp
           WHERE sp.enterprise_id = t.enterprise_id AND sp.supplier_id = p_supplier_id
             AND sp.category_id = t.category_id AND sp.status = 'APPROVED')
         AND (t.location_id IS NULL OR EXISTS (
           SELECT 1 FROM supplier_locations sl
           WHERE sl.supplier_id = p_supplier_id AND sl.location_id = t.location_id))
  END
  FROM tenders t WHERE t.id = p_tender_id;
$$ LANGUAGE sql STABLE;
