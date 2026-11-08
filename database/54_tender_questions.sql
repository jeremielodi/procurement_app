-- ============================================================================
-- 54_tender_questions.sql — Questions posées aux fournisseurs dans un appel d'offres (idempotente)
-- ----------------------------------------------------------------------------
-- L'acheteur joint à l'appel d'offres des questions (texte, oui / non, nombre, liste de choix, document à joindre),
-- saisies ou reprises de la bibliothèque de l'entreprise. Le fournisseur y répond avec son offre ; les réponses
-- restent scellées comme les prix jusqu'à la clôture.
-- Notation : chaque option d'une liste de choix porte des points ; note technique d'une offre =
-- points obtenus / points maximum des listes notées × 100 (NULL si aucune question notée).
-- Les questions sont figées dès la première offre reçue.
-- ============================================================================

-- Bibliothèque de questions de l'entreprise (reprises à la création d'un AO, copiées dans l'AO)
CREATE TABLE IF NOT EXISTS tender_question_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enterprise_id UUID NOT NULL REFERENCES enterprise(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    help_text TEXT,
    answer_type VARCHAR(10) NOT NULL,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,   -- liste de choix : [{ "label": "...", "score": 0 }]
    required BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tender_question_templates_type_check CHECK (answer_type IN ('TEXT', 'YES_NO', 'NUMBER', 'CHOICE', 'FILE'))
);
CREATE INDEX IF NOT EXISTS idx_tender_question_templates_enterprise ON tender_question_templates (enterprise_id);

-- Questions d'un appel d'offres (copie : modifier la bibliothèque ne change pas un AO publié)
CREATE TABLE IF NOT EXISTS tender_questions (
    id SERIAL PRIMARY KEY,
    tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    label TEXT NOT NULL,
    help_text TEXT,
    answer_type VARCHAR(10) NOT NULL,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    required BOOLEAN NOT NULL DEFAULT TRUE,
    template_id UUID REFERENCES tender_question_templates(id) ON DELETE SET NULL,
    CONSTRAINT tender_questions_type_check CHECK (answer_type IN ('TEXT', 'YES_NO', 'NUMBER', 'CHOICE', 'FILE'))
);
CREATE INDEX IF NOT EXISTS idx_tender_questions_tender ON tender_questions (tender_id, position);

-- Documents joints par un fournisseur en réponse à une question (déposés avant l'envoi de l'offre)
CREATE TABLE IF NOT EXISTS tender_answer_files (
    id SERIAL PRIMARY KEY,
    tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL REFERENCES tender_questions(id) ON DELETE CASCADE,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type VARCHAR(100),
    file_size INTEGER,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tender_answer_files_supplier ON tender_answer_files (tender_id, supplier_id);

-- Réponses d'une offre : value = texte, YES / NO, nombre, ou indice de l'option choisie ; file_id = document
CREATE TABLE IF NOT EXISTS tender_submission_answers (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL REFERENCES tender_submissions(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL REFERENCES tender_questions(id) ON DELETE CASCADE,
    value TEXT,
    file_id INTEGER REFERENCES tender_answer_files(id) ON DELETE SET NULL,
    score NUMERIC(10,2),
    CONSTRAINT uq_tender_submission_answer UNIQUE (submission_id, question_id)
);

ALTER TABLE tender_submissions ADD COLUMN IF NOT EXISTS technical_score NUMERIC(6,2);
