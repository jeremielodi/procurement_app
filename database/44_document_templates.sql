-- 44_document_templates.sql (idempotente)
-- Modèles de documents de l'entreprise : formulaire de demande d'achat (réquisition) et bon de commande.
-- Données affichées par ces modèles qui n'étaient pas encore saisies dans l'application.

-- Réquisition — « 2. Informations de livraison »
ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS delivery_address   TEXT;
ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS needed_by          DATE;
ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS delivery_recipient VARCHAR(200);
ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS delivery_contact   VARCHAR(255);

-- Article de réquisition — unité de mesure (jour, pièce, boîte…) ; défaut : unité de l'article du catalogue
ALTER TABLE requisition_items ADD COLUMN IF NOT EXISTS unit VARCHAR(50);

-- Bon de commande — conditions de paiement / de livraison, instructions au fournisseur
-- (le champ « notes » du formulaire était envoyé mais jamais enregistré)
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS payment_terms        TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS delivery_terms       TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS special_instructions TEXT;

-- Entreprise — conditions générales imprimées en dernière page du bon de commande (vide = pas de page)
ALTER TABLE enterprise ADD COLUMN IF NOT EXISTS po_terms TEXT;
