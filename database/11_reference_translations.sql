-- ============================================
-- RÉFÉRENTIELS : TRADUCTION DES CATÉGORIES DE MARCHÉ + COMPLÉMENTS
-- - market_categories.translations : { "<langue>": { "name": "…", "description": "…" } }
--   (le nom/la description en colonnes restent la version française, langue par défaut ;
--    ajouter une langue ne demande aucune migration)
-- - Traduction anglaise des catégories initiales, catégories manquantes, grandes villes de la RDC
-- Idempotent : peut être rejoué sur une base existante (ne remplace jamais une traduction saisie).
-- ============================================

ALTER TABLE market_categories ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 1. Catégories (nom FR, nom EN) : ajout si absente, traduction EN si non encore renseignée
WITH v(name, name_en) AS (VALUES
    -- Catégories initiales (08_supplier_prequalification.sql)
    ('Construction et réhabilitation WASH', 'WASH construction and rehabilitation'),
    ('Fournitures de bureau', 'Office supplies'),
    ('Équipements de bureau', 'Office equipment'),
    ('Hôtellerie', 'Hotel accommodation'),
    ('Restauration et location de salle de formation', 'Catering and training venue rental'),
    ('Location de véhicule de transport de personnes', 'Passenger vehicle rental'),
    ('Location de véhicule de transport de marchandises', 'Goods vehicle rental'),
    ('Matériel IT et de communication', 'IT and communication equipment'),
    ('Visibilité et imprimerie', 'Visibility and printing'),
    ('Matériel WASH / PCI', 'WASH / IPC supplies'),
    ('Matériel de construction', 'Construction materials'),
    ('Carburant', 'Fuel'),
    -- Catégories ajoutées
    ('Mobilier de bureau', 'Office furniture'),
    ('Logiciels et licences', 'Software and licences'),
    ('Services de télécommunication et internet', 'Telecommunication and internet services'),
    ('Énergie solaire et équipements électriques', 'Solar energy and electrical equipment'),
    ('Groupes électrogènes et maintenance', 'Generators and maintenance'),
    ('Achat de véhicules et motos', 'Vehicle and motorcycle purchase'),
    ('Entretien, réparation et pièces de véhicules', 'Vehicle maintenance, repair and spare parts'),
    ('Transport et logistique (fret)', 'Transport and logistics (freight)'),
    ('Transport fluvial et location de bateaux', 'River transport and boat rental'),
    ('Billetterie et agence de voyage', 'Ticketing and travel agency'),
    ('Location de bureaux et de logements', 'Office and housing rental'),
    ('Travaux de génie civil et routes', 'Civil works and roads'),
    ('Entretien et réparation des bâtiments', 'Building maintenance and repair'),
    ('Gardiennage et sécurité', 'Security and guarding services'),
    ('Nettoyage et entretien des locaux', 'Cleaning and facility maintenance'),
    ('Matériel médical et produits pharmaceutiques', 'Medical supplies and pharmaceuticals'),
    ('Équipements de terrain et de camping', 'Field and camping equipment'),
    ('Uniformes et équipements de protection', 'Uniforms and protective equipment'),
    ('Intrants agricoles et semences', 'Agricultural inputs and seeds'),
    ('Plants et matériel de reboisement', 'Seedlings and reforestation supplies'),
    ('Vivres et produits alimentaires', 'Food supplies'),
    ('Consultance et études', 'Consultancy and studies'),
    ('Formation et renforcement des capacités', 'Training and capacity building'),
    ('Audit et services comptables', 'Audit and accounting services'),
    ('Services juridiques', 'Legal services'),
    ('Assurances', 'Insurance'),
    ('Services financiers et transfert d''argent', 'Financial services and money transfer'),
    ('Production audiovisuelle et communication', 'Audiovisual production and communication'),
    ('Organisation d''événements', 'Event management')
),
ins AS (
    INSERT INTO market_categories (name, translations)
    SELECT v.name, jsonb_build_object('en', jsonb_build_object('name', v.name_en)) FROM v
    WHERE NOT EXISTS (SELECT 1 FROM market_categories c WHERE LOWER(c.name) = LOWER(v.name))
    RETURNING id
)
UPDATE market_categories c
SET translations = jsonb_set(c.translations, '{en}', COALESCE(c.translations->'en', '{}'::jsonb) || jsonb_build_object('name', v.name_en)),
    updated_at = CURRENT_TIMESTAMP
FROM v
WHERE LOWER(c.name) = LOWER(v.name)
  AND COALESCE(c.translations->'en'->>'name', '') = '';

-- 2. Grandes villes de la RDC (chefs-lieux des 26 provinces + principaux centres urbains)
INSERT INTO locations (name, province)
SELECT v.name, v.province FROM (VALUES
    ('Kinshasa', 'Kinshasa'),
    ('Matadi', 'Kongo-Central'), ('Boma', 'Kongo-Central'), ('Muanda', 'Kongo-Central'), ('Mbanza-Ngungu', 'Kongo-Central'),
    ('Kenge', 'Kwango'),
    ('Bandundu', 'Kwilu'), ('Kikwit', 'Kwilu'),
    ('Inongo', 'Maï-Ndombe'),
    ('Mbandaka', 'Équateur'),
    ('Gemena', 'Sud-Ubangi'), ('Zongo', 'Sud-Ubangi'),
    ('Gbadolite', 'Nord-Ubangi'),
    ('Lisala', 'Mongala'), ('Bumba', 'Mongala'),
    ('Boende', 'Tshuapa'),
    ('Kisangani', 'Tshopo'),
    ('Buta', 'Bas-Uélé'),
    ('Isiro', 'Haut-Uélé'), ('Watsa', 'Haut-Uélé'),
    ('Bunia', 'Ituri'), ('Aru', 'Ituri'), ('Mahagi', 'Ituri'),
    ('Goma', 'Nord-Kivu'), ('Butembo', 'Nord-Kivu'), ('Beni', 'Nord-Kivu'),
    ('Bukavu', 'Sud-Kivu'), ('Uvira', 'Sud-Kivu'),
    ('Kindu', 'Maniema'), ('Kasongo', 'Maniema'),
    ('Kalemie', 'Tanganyika'),
    ('Lubumbashi', 'Haut-Katanga'), ('Likasi', 'Haut-Katanga'), ('Kipushi', 'Haut-Katanga'),
    ('Kolwezi', 'Lualaba'),
    ('Kamina', 'Haut-Lomami'),
    ('Kabinda', 'Lomami'), ('Mwene-Ditu', 'Lomami'),
    ('Lusambo', 'Sankuru'), ('Lodja', 'Sankuru'),
    ('Mbuji-Mayi', 'Kasaï-Oriental'),
    ('Kananga', 'Kasaï-Central'),
    ('Tshikapa', 'Kasaï')
) AS v(name, province)
WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE LOWER(l.name) = LOWER(v.name));
