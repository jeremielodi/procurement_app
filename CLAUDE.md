# procureApp — Contexte Projet

## Ce que fait l'application
**procureApp** (anciennement « WWF Procure ») : plateforme **multi-entreprise** de gestion des achats électroniques (e-procurement) couvrant le cycle complet :
Réquisition → Approbation → PO → GRN → SAN → Facture → Paiement.
WWF n'est plus la marque de l'application : c'est la première entreprise cliente (données existantes rattachées).

## Multi-entreprise — règles à respecter pour TOUT nouveau code
- Migration : `database/07_multi_enterprise.sql` (idempotente). `enterprise_id` sur departments, projects, budget_allocations, requisitions, purchase_orders, goods_receipt_notes, service_acceptance_notes, invoices, payments, tenders, supplier_evaluations. Infos entreprise : logo_path, adresse, téléphone, email, site, NIF, RCCM, is_active
- **Insertion** : le trigger `fill_enterprise_id()` remplit `enterprise_id` depuis le parent (projet → réquisition → PO → GRN/SAN/facture → paiement ; département/projet ← `created_by`). Une nouvelle table métier doit avoir la colonne + le trigger
- **Contexte** : `middleware/tenant.js` → `tenantContext` (type de compte + `AsyncLocalStorage` via `utils/tenant.js`) puis `tenantGuard` (tout id dans l'URL / la query / le body doit appartenir à l'entreprise, sinon 404 — tables dans `PATH_RESOURCES` / `KEY_TABLES`). Nouvelle route `/xxx/:id` sur une table métier → l'ajouter à `PATH_RESOURCES`
- **Listes** : toute requête de liste/compte doit appeler `tenant.filter('<alias>.enterprise_id', params)` (hors requête HTTP — workers — le filtre est vide). Requêtes d'agrégation : `scopedDb` (`utils/tenantSql.js`, utilisé par `DashboardModel`) qui restreint chaque FROM/JOIN
- **GoFlow** : tâches filtrées par l'entreprise de la réquisition (`TaskController`), `CamundaService.completeTask` refuse une tâche d'une autre entreprise pendant une requête HTTP, notifications de tâches limitées à l'entreprise (`task_listner.getUsersByProfile`)
- **Comptes** :
  - Super admin plateforme (`prof_superadmin`, aucune entreprise ; `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD`, créé par `initDatabase.createPlatformSuperAdmin`) : entreprises (`/admin/enterprises`), rôles et permissions — aucun accès aux achats
  - Admin d'entreprise (`prof_admin`) : utilisateurs/projets/budgets de SON entreprise, « Mon entreprise » (`PUT /enterprises/current`) ; rôles en lecture seule ; ne peut pas attribuer `prof_superadmin` / `prof_supplier`
  - Fournisseurs : partagés (aucune entreprise), voient les AO de toutes les entreprises actives avec le nom de l'acheteur
- Codes département/projet et n° d'appel d'offres uniques **par entreprise** ; numéros REQ/PO/GRN/… restent uniques sur la plateforme
- Branding : `utils/enterpriseBranding.getBranding(enterpriseId)` (nom + logo data URI) dans les PDF ; front : `EnterpriseContext` (`useEnterprise`, `enterpriseLogoUrl`), logo plateforme `client/public/images/procureapp-logo.svg`
- Tests : `tests/api/multi-enterprise.spec.js`

## Stack technique
- **Frontend** : React 18 + Vite + Tailwind CSS + Recharts/ECharts
- **Backend** : Node.js + Express + PostgreSQL
- **Workflow** : Camunda GoFlow (instance personnalisée, pas le Camunda standard)
- **Temps réel** : Socket.io
- **PDF** : Puppeteer + Handlebars (templates inline, pas de fichiers .hbs)
- **Excel** : ExcelJS
- **Autres** : JWT auth, Docker

## API Camunda (GoFlow)
Le fichier `backend/src/services/CamundaService.js` montre comment appeler GoFlow.
- Base URL : `process.env.CAMUNDA_REST_URL` (défaut: `http://localhost:8080/engine-rest`)
- Auth : Bearer token ou Basic auth
- Start process : `POST /engine-rest/v2/process-definitions/{processKey}/start`
- External tasks : `POST /external-task/fetchAndLock` → workers en polling toutes les 5s
- User tasks : complétées via `POST /tasks/{taskId}/complete`, prises via `POST /tasks/{taskId}/claim { assignee }`, libérées via `POST /tasks/{taskId}/unclaim` (sans corps ; événement `TASK_UNCLAIMED`)
- Prise en charge / libération côté app : `POST /api/tasks/:taskId/claim|unclaim` (`TaskController`). Permissions calculées (`getTaskPermissions`) : `canClaim` (groupe, non assignée), `canUnclaim` (**la personne qui l'a prise ou un admin**), `canComplete`. Les deux actions passent par une **confirmation** (`Task/ClaimTaskConfirm`, `mode="claim"|"unclaim"`) dans « Mes tâches » et l'onglet tâches de la réquisition. « Qui bloque ? » et le suivi du workflow prennent la **dernière** action TASK_CLAIMED / TASK_UNCLAIMED (tâche libérée = sans responsable, événement « libérée »)

## Cycle procure-to-pay (objectif)
1. **Réquisition** — employé crée une demande avec items + lignes budgétaires
2. **Vérification budget** — automatique (Camunda service task `check_budget`)
3. **Circuit d'approbation** — multi-niveaux selon le montant :
   - < 25 000 → Manager (N1)
   - 25 000–99 999 → Finance (N2)
   - ≥ 100 000 → DG (N3)
4. **Classification méthode d'achat** — automatique (`classify_procurement`) :
   - ≤ 5 000 : Achat direct
   - ≤ 25 000 : Devis multiples
   - > 25 000 : Appel d'offres (RFP)
   - Source unique : justification approuvée
5. **Sélection fournisseur** — devis / RFP / source unique / achat direct
6. **Purchase Order** — créé par Procurement, approuvé par management
7. **Envoi PO fournisseur** — email automatique (`send_po_notification`)
8. **Confirmation fournisseur** — userTask d'attente de l'accusé de réception
9. **Goods Receipt Note (GRN)** — logistique enregistre la réception physique
10. **Service Acceptance Note (SAN)** — requester valide la prestation reçue
11. **Saisie facture** — Finance enregistre la facture fournisseur
12. **Rapprochement 3 voies** — automatique (`process_invoice`) : PO + GRN + Facture
13. **Paiement** — Finance ordonne le paiement

## État d'implémentation

### ✅ Fait
- Réquisition : création, items, budget lines, statuts, PDF (Puppeteer+Handlebars), Excel
- Budget check : worker Camunda `check_budget` fonctionnel
- Classify procurement : worker `classify_procurement` fonctionnel
- Analyze offers : worker `analyze_offers` (basique)
- Purchase Order : CRUD, approbation, rejet, envoi email, **PDF (Puppeteer+Handlebars)**
- Send PO notification : worker `send_po_notification` fonctionnel
- Notifications temps réel (Socket.io)
- Dashboard, Users, Departments, Projects, Budget, Suppliers
- GRN (Goods Receipt Note) : model, controller, routes, UI (GRNList/GRNForm/GRNDetail), tests API + e2e
- SAN (Service Acceptance Note) : model, controller, routes, UI (SANList/SANForm/SANDetail), tests API + e2e — complète `Activity_ServiceAcceptance`
- Invoices (Factures) : table, model, controller, routes, UI, 3-way matching (PO + GRN + Facture)
- Payments (Paiements) : table, model, controller, routes, UI, PDF
- **TaskList → redirect vers formulaires dédiés** (GRN/SAN/Facture/Paiement via GoFlow)
- **Portail fournisseur & appels d'offres** (2026-10-04) — voir section dédiée ci-dessous

### ⚠️ Manquant — à implémenter
| Module | DB | Model | Controller | Routes | Frontend | Worker |
|--------|-----|-------|-----------|--------|---------|--------|
| Confirmation fournisseur | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### ⚠️ Problèmes connus
- `database.js` partage UNE connexion pour toutes les requêtes : `db.transaction()` (BEGIN/COMMIT dessus) peut englober des requêtes concurrentes d'autres utilisateurs — tout nouveau code transactionnel utilise `db.withTransaction(fn)` (connexion dédiée du pool)
- Le worker `goods_receipt` ne crée pas de GRN en base (incohérence BPMN : déclaré external task mais `Activity_GoodsReceipt` est un userTask)
- `Activity_1x2n3lq` = nom auto-généré (Validation N2), à corriger dans le BPMN

## BPMN
Fichier : `backend/src/bpmn/procurement-workflow.bpmn`
Process ID : `ProcurementProcess`

### Topics Camunda (external tasks — workers)
- `check_budget` — vérifie disponibilité budget
- `classify_procurement` — détermine méthode d'achat
- `analyze_offers` — sélectionne meilleure offre
- `send_po_notification` — envoie PO par email au fournisseur
- `process_invoice` — rapprochement 3-way (PO + GRN + Invoice) ✅

### User Tasks Camunda (actions humaines)
| taskDefinitionKey | Nom | candidateGroups | Formulaire frontend |
|---|---|---|---|
| `Activity_ValidationN1_Manager` | Manager Approval (N1) | `manager` | Modale TaskList |
| `Activity_ValidationN2_Finance` | Finance Approval (N2) | `finance` | Modale TaskList |
| `Activity_ValidationN3_DG` | DG Approval (N3) | `dg` | Modale TaskList |
| `Activity_DetermineType` | Determine Procurement Type | `procurement` | Modale TaskList |
| `Activity_DirectPurchase` | Direct Purchase | `procurement` | Modale TaskList |
| `Activity_RequestQuotations` | Request Multiple Quotations | `procurement` | Modale TaskList |
| `Activity_RFPProcess` | Call for Tenders / RFP | `procurement` | **→ `/tenders/new?taskId=&requisitionId=`** (complétée à l'attribution) |
| `Activity_SoleSource` | Sole Source Justification | `procurement` | Modale TaskList |
| `Activity_CreatePO` | Create Purchase Order | `procurement` | Modale TaskList |
| `Activity_POApproval` | Approve Purchase Order | `management` | Modale TaskList |
| `Activity_SupplierConfirmation` | Supplier Order Confirmation | `procurement` | Modale TaskList |
| `Activity_GoodsReceipt` | Goods Receipt Note (GRN) | `logistic` | **→ `/goods-receipts/new?taskId=&poId=`** |
| `Activity_ServiceAcceptance` | Service Acceptance Note (SAN) | `requester` | **→ `/service-acceptance-notes/new?taskId=&poId=`** |
| `Activity_EnterInvoice` | Enter Supplier Invoice | `finance` | **→ `/invoices/new?taskId=&poId=`** |
| `Activity_ProcessPayment` | Process Payment | `finance` | **→ `/payments/new?taskId=`** |

## Architecture GoFlow — Principe clé (Option B)

**Les formulaires GRN, SAN, Facture et Paiement ne sont accessibles en création QUE via la TaskList.**

- GoFlow gère l'ordre des étapes : impossible de créer une facture avant le GRN, etc.
- Le **PODetail** affiche uniquement les documents P2P déjà créés (lecture seule) avec un bandeau info.
- Les **listes** (GRNList, InvoiceList, etc.) conservent un bouton "Nouveau" pour usage hors-workflow (admin, correction).
- La TaskList détecte le `taskDefinitionKey` : si c'est une tâche à formulaire dédié → `navigate(route)` ; sinon → modale générique.

### Code du redirect dans TaskList
```js
// client/src/components/Task/TaskList.jsx
const FORM_TASKS = {
  'Activity_GoodsReceipt':      (t) => `/goods-receipts/new?taskId=${t.id}&poId=${t.variables?.poId || ''}`,
  'Activity_ServiceAcceptance': (t) => `/service-acceptance-notes/new?taskId=${t.id}&poId=${t.variables?.poId || ''}`,
  'Activity_EnterInvoice':      (t) => `/invoices/new?taskId=${t.id}&poId=${t.variables?.poId || ''}`,
  'Activity_ProcessPayment':    (t) => `/payments/new?taskId=${t.id}&poId=${t.variables?.poId || ''}`,
};
```

### Complétion de la tâche Camunda depuis les formulaires
Chaque formulaire lit `taskId` depuis `useSearchParams()` et le passe au backend via le service.
Le backend tente de compléter la tâche Camunda ; si `taskId` absent, il cherche via `process_instance_id` de la réquisition liée.

## Réquisitions — import & avancement

- Import d'articles : `POST /requisitions/import-items` (multipart `.xlsx`/`.csv`, ≤ 2 Mo, ≤ 500 lignes) → aperçu `{ items, errors }` sans stockage (`controllers/requisition/importItems.js`). Colonnes : Description, Quantité, Fréquence, Prix unitaire — **pas de ligne budgétaire** (assignée ensuite dans le formulaire). Le modèle est généré côté navigateur dans `ImportItemsModal` (CSV `;` + BOM UTF-8, ouvrable dans Excel)
- Sélection multiple d'articles dans `RequisitionForm` → assignation d'une ligne budgétaire / suppression en une fois
- Colonne « Avancement » de la liste : `progress_status` calculé en SQL (`PROGRESS_STATUS_SQL` dans `RequisitionModel`) — Brouillon / En cours / Terminé (tous les PO non rejetés ont une facture `PAID`) / Rejeté / Annulé ; filtre `?progress=`

## Suivi du workflow (historique lisible)

- `GET /requisitions/:id/timeline` → `RequisitionTimelineService` : `steps` (12 étapes du cycle complet : création → paiement, statut done/current/pending/failed/skipped + liens vers PO/GRN/SAN/facture/paiement/AO) et `events` (une ligne par action réelle, en français : décision, auteur, commentaire, délai de traitement, tâches en attente)
- Traductions côté backend : `src/utils/workflowLabels.js` (tâches, rôles, méthodes d'achat, messages des workers ; mêmes libellés que `client/src/utils/taskLabels.js`). Les événements techniques (TASK_CREATED/CLAIMED, NOTIFICATION_SENT, doublons CLASSIFIED_*) sont fusionnés ou masqués
- Frontend : `RequisitionTimeline` (onglet « Suivi du workflow » de la fiche) et `WorkflowTrackerModal` (bouton « Voir le workflow » de la fiche + icône dans la colonne Actions de la liste)

## Accès au budget

- Module Budget (menu, `/budget`, `GET /budget/summary`, `GET /budget/:id`, édition) : `MANAGE_BUDGET` = Finance + admin uniquement. Résumé budgétaire du dashboard (`getChartData(..., { includeBudget })`) et onglet « Budget » : idem
- `VIEW_BUDGET` sert seulement au choix d'une ligne budgétaire par projet dans le formulaire de réquisition : `GET /budget` exige `?projectId=` sans `MANAGE_BUDGET`
- Le profil Achats (`prof_procurement`) n'a plus aucun droit budget (`database/06_budget_access.sql`)

## Portail fournisseur & appels d'offres

- Migration : `database/05_supplier_portal.sql` (idempotente) — colonnes `suppliers.user_id/logo_path/contact_name/self_registered`, tables `tenders`, `tender_submissions`, `tender_submission_items`, permissions `MANAGE_TENDERS` (procurement, admin) et `SUPPLIER_PORTAL` (profil `prof_supplier`)
- Inscription publique : `POST /api/auth/register-supplier` (multipart, logo PNG/JPG/WEBP ≤ 2 Mo stocké dans `UPLOAD_DIR/supplier-logos/`), logo servi par `GET /api/public/suppliers/:id/logo`
- Un AO est lié à **une** réquisition (un seul AO non annulé par réquisition) ; les items à chiffrer = `requisition_items`. Le **numéro d'AO est saisi** par le procurement (unique, insensible à la casse)
- Statut calculé (`effective_status`) : `UPCOMING` / `OPEN` / `CLOSED` selon `start_date`/`end_date` (TIMESTAMPTZ), sinon `AWARDED` / `CANCELLED`
- Publication → notification in-app + email à tous les fournisseurs inscrits actifs
- Fournisseur : soumet/modifie tant que `OPEN`, délai ≤ `max_delivery_days`, ne voit jamais les offres concurrentes ; PDF de son offre (logo, entreprise, zone cachet/signature) via `TenderSubmissionPdfService` (helpers `tsub_`)
- **Offres scellées** : tant que l'AO est `OPEN`/`UPCOMING`, `GET /tenders/:id` ne renvoie que le nom du soumissionnaire et la date (pas de prix, `sealed: true`) et l'export Excel répond 400. Après clôture avec des offres, l'AO ne peut plus être prolongé
- Comptes fournisseurs actifs dès l'inscription (pas de validation procurement) ; dates affichées en `APP_TIMEZONE` (défaut `Africa/Kinshasa`)
- Procurement : `TenderController` — comparatif Excel (`TenderExportService` : croisé items × fournisseurs, détail plat, fournisseurs), clôture anticipée, attribution après clôture → complète `Activity_RFPProcess` avec `offers` = offre retenue (repris par `analyze_offers`) + `allOffers`
- **Isolation des comptes fournisseurs** : middleware `restrictSupplierAccounts` (après `authenticate`) — un compte n'ayant que `prof_supplier` n'accède qu'à `/auth/profile`, `/supplier-portal/*` et à ses propres notifications (403 sinon). Côté client, `ProtectedRoute` redirige tout le reste vers `/supplier/dashboard` ; pas d'appel `/enterprises/default`, ni recherche globale
- Tableau de bord fournisseur : `GET /supplier-portal/dashboard` (AO ouverts/à venir, offres, marchés remportés, résultats, profil incomplet)
- Frontend : `Tenders/` (TenderList/Form/Detail), `SupplierPortal/` (SupplierDashboard, SupplierTenderList/Detail, SupplierProfile), `Auth/SupplierRegister` ; un fournisseur arrive sur `/supplier/dashboard` à la connexion
- CSP (`server.js`) : `img-src` autorise `blob:` (aperçu du logo avant upload) ; le PDF fournisseur s'affiche dans une `<iframe>` (`frame-src blob:`), `object-src 'none'` bloquant `<embed>`
- Tests : `tests/api/tenders.spec.js`

## Préqualification des fournisseurs (localisations, catégories, documents)

- Migration : `database/08_supplier_prequalification.sql` (idempotente) — tables `locations`, `market_categories` (référentiels **de la plateforme**, valeurs initiales : 9 bureaux RDC, 12 catégories), `supplier_locations`, `supplier_categories`, `supplier_documents` (un fichier courant par type), `supplier_prequalifications` (**par entreprise × fournisseur × catégorie**, `APPROVED`/`REJECTED`, absence = en attente) ; `suppliers.supplier_type` (`COMPANY`/`INDIVIDUAL`), `id_nat`, `id_document_number` ; `tenders.audience` (`ALL`/`PREQUALIFIED`), `category_id`, `location_id` ; fonction SQL `supplier_eligible_for_tender(supplier, tender)`
- Migration `11_reference_translations.sql` (idempotente) : `market_categories.translations` JSONB `{ "en": { "name", "description" } }` (colonnes `name`/`description` = français ; ajouter une langue ne demande pas de migration), traduction EN des catégories, **41 catégories** (ajout des catégories manquantes : consultance, sécurité, billetterie, véhicules, énergie, médical, reboisement…), **grandes villes de la RDC** (chefs-lieux des 26 provinces + principaux centres urbains)
- **Catégories traduites** : `utils/requestLang.js` — middleware `requestLanguage` (`server.js`, AsyncLocalStorage, `?lang=` puis `Accept-Language`) et `localizedSql(alias, field)` → traduction de la langue courante sinon français ; utilisé partout où un nom de catégorie est lu (`SupplierModel`, `TenderModel`, `ReferenceModel.list` des listes actives). L'admin (`?all=1`) reçoit les valeurs françaises brutes + `translations` ; écriture : `translations` fusionnée par langue, valeur vide = repli sur le français (`ReferenceModel.cleanTranslations`). Écran `Admin/ReferenceData` : colonne « Nom (EN) » par langue autre que `fr`. Côté client, les listes de sélection se rechargent au changement de langue (`lang` dans les dépendances) et `index.jsx` invalide les requêtes React Query (`onLangChange`). Les localisations (noms propres) ne sont pas traduites
- Référentiels : `ReferenceModel` / `ReferenceController` — lecture publique `GET /public/locations|market-categories` (actifs), écriture super admin `/locations`, `/market-categories` (ajoutés à `SUPERADMIN_PATHS`) ; suppression refusée si utilisé → désactiver. Écran `Admin/ReferenceData` (`/admin/references`, autorisé dans `ProtectedRoute`)
- Documents : `utils/supplierDocuments.js` — `ID_CARD` (PDF/JPG/PNG), `RCCM`, `TAX`, `ID_NAT`, `RIB` (PDF), 5 Mo, stockés via StorageService sous `supplier-documents/<code>/…`. **Facultatifs à l'inscription** (`EXPECTED_DOCS` = documents attendus selon le type), mais **tous requis et vérifiés pour la préqualification**. Champs texte obligatoires : entreprise = n° RCCM / impôt / ID Nat / téléphone / adresse / banque ; personne physique = nom / adresse / banque. Multipart : champs `doc_<TYPE>` (+ `logo`), listes `locationIds` / `categoryIds` en JSON
- Inscription (`POST /auth/register-supplier`) et profil (`PUT /supplier-portal/me`) gèrent type, identifiants, localisations, catégories, documents ; `GET /supplier-portal/me` = fiche complète (`getFullProfile`). Un fournisseur inscrit gère seul identité/documents/catégories ; un acheteur ne peut déposer des documents (`PUT /suppliers/:id/documents/:type`) que pour un fournisseur saisi à la main
- Vérification des documents (migration `09_tender_invitations.sql`) : table `supplier_document_reviews` **par entreprise**, liée à la version du fichier (`file_path`) — un document remplacé redevient « à vérifier ». `PUT /suppliers/:id/documents/:documentId/review` (`VERIFIED` / `REJECTED` + motif, notifié au fournisseur / null). `dossier = { missing, toVerify, rejected, complete }` (`SupplierModel.dossierStatus`) dans la fiche
- Préqualification : `GET|PUT /suppliers/:id/prequalification` — permission **`PREQUALIFY_SUPPLIERS`** (profil admin d'entreprise ; vérification des documents idem) ; approbation = catégorie déclarée + fournisseur actif + **dossier complet** (tous déposés et vérifiés) ; motif obligatoire au rejet ; liste `GET /suppliers/prequalified[/export]` (filtres catégorie / localisation / type, Excel `PrequalifiedSupplierExportService`) ; écran `Suppliers/PrequalifiedSupplierList`, onglet `prequal/SupplierPrequalificationPanel` de la fiche (`?tab=prequalification`). Les PO proposent les fournisseurs préqualifiés par l'entreprise (ou l'ancienne case globale `prequalified`)
- AO réservé (`audience=PREQUALIFIED`, catégorie obligatoire) : l'acheteur **sélectionne les invités** (`supplierIds`, ≥ 1) parmi les candidats `GET /tenders/candidates?categoryId=&locationId=` (préqualifiés de la catégorie desservant la localisation) → table `tender_invitations`. Seuls les invités (toujours préqualifiés) sont notifiés, voient l'AO et peuvent soumettre (`supplier_eligible_for_tender`). En modification : ajout d'invités (notifiés « Invitation »), retrait impossible pour ceux qui ont soumis. Fiche : `invitations`. UI : `Tenders/TenderTargetingFields` ; diffusion « tous » : `GET /tenders/eligible-count`
- Tests : `tests/api/prequalification.spec.js` ; helpers `supplierRegistration` / `firstReferenceIds` (`tests/api/helpers.js`)

## Stockage des fichiers (MinIO)

- `services/StorageService.js` : `put / getBuffer / exists / remove / send` ; driver `STORAGE_DRIVER=minio` (docker compose) ou `local` (UPLOAD_DIR, dev sans Docker). **Tout nouveau code qui stocke un fichier passe par ce service** (jamais `fs` directement)
- Bucket MinIO **privé et versionné** (créé au démarrage par `server.js > initStorage`, avec plusieurs tentatives) : un fichier écrasé/supprimé reste récupérable
- Les fichiers ne sont **jamais servis en statique** : pièces jointes via `GET /api/upload/download/file/:id` (authentifié + contrôle entreprise, y compris à l'upload multipart via `attachmentEntityAllowed`), logos via `/api/public/{suppliers,enterprises}/:id/logo` ; logos embarqués dans les PDF par `utils/logoUpload.logoDataUri`
- Clés = chemins déjà enregistrés en base (`attachments.file_path`, `suppliers.logo_path`, `enterprise.logo_path`) : `YYYY/MM/<ts>_<uuid>.<ext>`, `supplier-logos/…`, `enterprise-logos/…`
- Docker : service `minio` (image `cgr.dev/chainguard/minio` — MinIO ne publie plus d'images communautaires sur Docker Hub/Quay), volume `wwf_minio_data`, ports liés à 127.0.0.1 (9000 API, 9001 console). Identifiants `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` / `MINIO_BUCKET` dans **`backend/.env`** (lu par le service `minio` et par l'app via `env_file`, comme PostgreSQL : `POSTGRES_DB/USER/PASSWORD` = `DB_NAME/USER/PASSWORD` — pas d'interpolation `${…}` dans docker-compose, `backend/.env` jamais copié dans l'image). Doc d'installation Docker et de chaque variable : `readme.md`
- Migration disque → MinIO : `docker exec wwf_app node scripts/migrate-uploads-to-minio.js [--dry-run]` (idempotente, vérifie toutes les références en base)
- Tests : `tests/api/attachments.spec.js`

## Déploiement HTTP / HTTPS

- `server.js` : en-têtes HTTPS stricts de helmet (`upgrade-insecure-requests`, HSTS, COOP, Origin-Agent-Cluster) **seulement si `APP_URL` commence par `https://`**. En HTTP (ex. `http://domaine:5000`) ils provoquaient le chargement des JS/CSS en https → `ERR_SSL_PROTOCOL_ERROR`, page blanche
- Client : Socket.io se connecte à `window.location.origin` (ou `VITE_WS_URL`) — jamais `localhost` en dur
- Production recommandée : reverse proxy HTTPS (Caddy / Nginx + Let's Encrypt) devant le port 5000, puis `APP_URL=https://…`

## Emails de tâche GoFlow

- `task_listner.handleTaskCreated` : à chaque TASK_CREATED, email aux utilisateurs **actifs**, ayant le **profil de la tâche** (`prof_<candidateGroup>`), **membres du projet** de la réquisition et de la **même entreprise** (`getTaskEmailRecipients`) + notification in-app
- Rôle déduit de `TASK_CANDIDATE_GROUPS` si l'événement n'a pas de `candidateGroup` ; clé lue en `taskDefinitionKey` ou `TaskDefinitionKey` ; notifications et emails indépendants (l'échec de l'un n'empêche pas l'autre) ; bilan « 📧 … email(s) envoyé(s) » ou « aucun membre du projet avec le profil » dans les logs
- Liens des emails (tâches GoFlow et appels d'offres) : `utils/appUrl.js` (`APP_URL`, `appLink(path)`) — `APP_URL` à définir dans `backend/.env` avec l'adresse publique (défaut `http://localhost:5000`, avertissement au démarrage en production)

## Centre d'aide (« ? » de l'en-tête)

- `components/Help/HelpCenter.jsx` (monté dans `Layout/Header.jsx`, entre le sélecteur de langue et la cloche) : panneau latéral « Guide d'utilisation » — sommaire, recherche (sans accents), précédent / suivant, FAQ dépliable, liens rapides (ferment le panneau), Échap
- **Contenu dans les locales client** `help.sections.<id>` (`title`, `summary`, `blocks[]`, `faq[]`) ; blocs `h` / `p` / `tip` / `warn` (`text`), `steps` / `list` (`items`), `table` (`rows`, 1re ligne = en-tête), `links` (`{ to, label }`). Toute modification se fait **dans fr.json ET en.json** (même structure)
- Dans le composant : ordre des rubriques et profils mis en avant (`SECTIONS`), rubrique ouverte selon l'écran (`ROUTE_SECTIONS`), fournisseur = `supplierPortal` + `account` (liens limités aux écrans fournisseur), super admin = `overview` / `roles` / `admin` / `account`
- **Nouvelle fonctionnalité visible → mettre à jour la rubrique d'aide correspondante** (règles, seuils, libellés de boutons identiques à l'interface)

## Site vitrine (FR / EN)

- `client/src/components/Landing/LandingPage.jsx` : page unique publique sur `/` (visiteur non connecté ; connecté → `HomeRedirect`, via `Home` dans `App.jsx`). Éditeur : **Digitales Solutions**
- Textes dans `landing.*` des fichiers de langue (voir « Interface multilingue ») ; listes = tableaux JSON, icônes dans le composant (`FEATURE_ICONS`…, même ordre). Liens : `/login`, `/supplier-register`
- **Formulaire de contact** (`Landing/ContactForm.jsx`, aucune adresse ni téléphone affichés) → `POST /public/contact { name, email, company?, phone?, message, website }` (`ContactController`) : email à **`CONTACT_EMAIL`** (`backend/.env`, défaut jeremielodi@gmail.com) via le SMTP de l'app, **Reply-To = visiteur** (`sendEmail(..., { replyTo })`). Validation (erreurs par champ en codes `required`/`invalid`/`tooShort`/`tooLong`, traduites côté client), champ piège `website` (robot → succès sans envoi), 5 messages / IP / heure (429), 502 si l'email n'est pas parti. Tests : `tests/api/contact.spec.js` (n'envoie jamais d'email réel)

## Interface multilingue (FR / EN)

- **Un fichier JSON par langue** : `client/src/locales/<code>.json` (interface) et `backend/src/i18n/locales/<code>.json` (PDF, suivi du workflow, libellés renvoyés par l'API). Chargés automatiquement : **ajouter une langue = ajouter les deux fichiers** (bloc `_meta: { name, locale }`) ; côté client, ajouter aussi sa locale date-fns dans `src/i18n/dateFns.js`. Clé absente → français
- Moteur client `src/i18n/index.js` (sans dépendance) : `t('clé', { var })` (`{{var}}`, pluriels `clé_one` / `clé_other` via `count`, `returnObjects` pour tableaux), `getLocale()` pour `Intl`/`toLocale*`, `withLabel(prefix, table)` / `labelMap(prefix, codes)` = tables de statuts dont le `label` est traduit à la lecture
- Composants : `import { t } from '../../i18n'` suffit (App s'abonne à la langue → tout l'arbre se ré-affiche). `useTranslation()` (→ `{ t, lang, setLang }`) seulement si un `useMemo`/`useEffect`/`queryKey` dépend de la langue. **Ne jamais nommer `t` une variable de boucle** (masque la fonction : utiliser `tn`, `tk`, `dt`…)
- Langue : choix mémorisé (`localStorage.app_lang`), **français par défaut** (pas de détection navigateur : les e2e tournent en en-US et vérifient des textes FR). Sélecteur `Common/LanguageSwitcher` (en-tête, login/inscription/mot de passe oublié, site vitrine, « Mon profil »)
- `api.js` envoie `Accept-Language` ; backend : `i18n.fromRequest(req)` (`?lang=` puis en-tête), `translator(lang)` (`{var}`), `workflowLabels.taskLabel(key, lang)` / `groupLabel` / `methodLabel`… Localisés : suivi du workflow (`RequisitionTimelineService.build(id, lang)`), « Qui bloque ? » (noms de profils = donnée FR, rôle traduit sinon), « profil incomplet » du portail fournisseur. Les données renvoyées par le backend avec un code (`rawStatus`, `rawMethod`) sont traduites côté client
- **Langue du compte** (migration `10_user_language.sql`, `users.language`, défaut `fr`) : renvoyée au login / `GET /auth/profile` et appliquée par `AuthContext` ; changement via le sélecteur → `PUT /auth/language` (avant `tenantContext`, ouvert à tous les comptes). Saisie à la création (UserForm, admin d'entreprise) ; fournisseur = langue de la page d'inscription
- **Emails et notifications dans la langue du destinataire** (`email.*`, `notification.*` des locales backend) : mot de passe oublié, tâche GoFlow (email + in-app), appels d'offres, attribution, nouvelle soumission, envoi du PO au fournisseur (langue de son compte portail)
- Restent en français : messages d'erreur/succès de l'API, notifications déjà stockées, données saisies (départements, profils…)
- Contrôle : `npm run i18n:check` (client) — mêmes clés dans chaque langue (client et backend) + toute clé `t('…')` du code existe

## Gestion de stock (dépôts, catalogue, lots, réceptions, suivi des livraisons)

- Migration `13_stock_management.sql` (idempotente) — tables en **UUID** : `warehouses` (par entreprise, rattachés à une `location` ; plusieurs dépôts par localisation ; code unique par entreprise), `warehouse_users` (accès), `stock_items` (catalogue par entreprise : code, unité, catégorie, `is_stockable`, `track_lots`, `track_expiry`, `min_quantity`), `stock_lots` (n° unique par article, péremption), `stock_movements` (**journal immuable** : trigger refuse UPDATE/DELETE ; types OPENING / RECEIPT / RECEIPT_REVERSAL / ISSUE / TRANSFER_* / ADJUSTMENT_*, signe contrôlé, n° `MVT-AAAA-NNNNNN`), `stock_balances` (soldes article × dépôt × lot tenus par trigger, **jamais négatifs**, verrou de ligne → mouvements concurrents sérialisés). Trigger `stock_movement_check` : dépôt / article / lot de la même entreprise, article stockable, lot obligatoire si suivi. `fill_enterprise_id` étendu (warehouses, stock_items, stock_lots)
- Liens : `requisition_items.stock_item_id` → `purchase_order_items.stock_item_id` + `requisition_item_id` → `goods_receipt_items.po_item_id` / `stock_item_id` / `lot_id` / `stock_movement_id`, `goods_receipt_notes.warehouse_id`. Quantités PO / GRN en **DECIMAL(19,4)** (litres…) : relire avec `::float8` (pg renvoie les DECIMAL en chaînes)
- Référentiels : `market_categories.code` / `locations.code` **stables** (identiques dans toutes les bases, l'id reste la clé technique ; générés depuis le nom si absents — `ReferenceModel.uniqueCode`) ; `market_categories.is_stockable` = défaut des nouveaux articles
- **Option C (hybride)** : une ligne de réquisition / PO cite un article du catalogue (`Stock/CatalogAutocomplete`, `GET /stock-items/search` ouvert à tous les utilisateurs de l'entreprise) ou reste en texte libre (jamais stockée) ; la logistique peut rattacher une ligne libre à un article à la réception (le lien est alors reporté sur la ligne de PO). Import de réquisition : colonne facultative « Code article »
- **Réception** (`GoodsReceiptModel.create`, **une transaction `db.withTransaction`** sur connexion dédiée, PO verrouillé `FOR UPDATE`) : ligne rattachée à sa ligne de PO (`poItemId`, sinon désignation identique sans ambiguïté) ; reçu = accepté + rejeté ; **cumul accepté ≤ commandé** (`OVER_DELIVERY`) ; quantité **acceptée** des articles stockables → mouvement RECEIPT (coût = prix du PO, devise du PO) ; dépôt : choisi d'office si l'utilisateur n'a accès qu'à un dépôt, **obligatoire s'il en a plusieurs** (`WAREHOUSE_REQUIRED`), refusé hors de ses accès (`WAREHOUSE_FORBIDDEN` / `NO_WAREHOUSE_ACCESS`) — admin d'entreprise : tous les dépôts actifs ; lot / péremption obligatoires selon l'article, lot périmé refusé, lot existant avec une autre date refusé. Erreurs métier : `{ status, code }` → `sendError` du contrôleur (le client affiche un message traduit `grn.err.<CODE>`, `skipErrorToast`). Même logique pour `TaskController` (variable `warehouseId`) et le worker (dépôt obligatoire, pas de contrôle d'accès)
- **Annulation d'un GRN** : `POST /goods-receipts/:id/cancel` (et `PATCH …/status` CANCELLED) → écritures RECEIPT_REVERSAL, refusée si le stock reçu a déjà été sorti (409 `STOCK_INSUFFICIENT`) ; GRN annulé = statut figé, exclu du suivi des livraisons
- **Suivi des livraisons** : vue `v_po_item_delivery` (commandé / reçu / accepté / rejeté / **reste = commandé − accepté**, le rejeté reste dû) ; `delivery_status` du PO (DELIVERED / PARTIALLY_DELIVERED / NOT_DELIVERED) dans la liste et la fiche ; `GET /purchase-orders/:id/delivery` (lignes + réceptions) → `PurchaseOrders/PODeliveryTracking` ; le formulaire GRN propose le reste à livrer. Les GRN antérieurs ont été rattachés à leur ligne de PO par la migration
- API : `/warehouses` (+ `/mine` = dépôts où l'utilisateur peut réceptionner, `PUT /:id/users` = accès, audit `WAREHOUSE_ACCESS_CHANGED`), `/stock-items` (+ `/search`), `/stock/summary`, `/stock/balances` (+ `/export` Excel 2 feuilles), `/stock/movements`. Permissions : `VIEW_STOCK` (logistique, achats, finance, management), `MANAGE_STOCK_ITEMS` (logistique, achats), `MANAGE_WAREHOUSES` (admin d'entreprise). `PATH_RESOURCES` / `KEY_TABLES` : warehouses, stock_items, stock_lots
- Frontend : menu « Stock » — `Stock/StockOverview` (`/stock`, synthèse + soldes + péremptions + export), `StockItemList` / `StockItemDetail` (`/stock/items[/:id]`), `StockMovements` (`/stock/movements`), `WarehouseList` (`/stock/warehouses`, accès) ; `GRN/GRNForm` (dépôt, reste, lots), `GRNDetail` (dépôt, lot, n° de mouvement, annulation) ; bon de réception PDF : dépôt, code article, lot
- **Sorties vers un utilisateur (bons de sortie)** — migration `14_stock_issues.sql` : `stock_issues` (`SOR-AAAA-NNNNN`, dépôt, bénéficiaire = utilisateur actif de l'entreprise, projet facultatif, motif, `ISSUED` / `CANCELLED`, accusé `acknowledged_at`), `stock_issue_lines` (article, lot, quantité, mouvement + mouvement inverse), type de mouvement `ISSUE_REVERSAL`, trigger de cohérence d'entreprise, permission `ISSUE_STOCK` (logistique, admin). `StockIssueModel.create` (transaction, soldes `FOR UPDATE`) : accès au dépôt obligatoire, **lots FEFO** (péremption la plus proche d'abord, lots périmés exclus) ou lot imposé, cumul des lignes d'un même article, `STOCK_INSUFFICIENT` avec `available`. Bénéficiaire notifié (in-app, sa langue) → `/my-items` (« Mes articles reçus », tout utilisateur) → `POST /stock-issues/:id/acknowledge` (lui seul ; le magasinier est notifié). Annulation `POST /stock-issues/:id/cancel` (motif obligatoire) = écritures `ISSUE_REVERSAL` (retour en stock). Consultation : `VIEW_STOCK` ou bénéficiaire (sans `VIEW_STOCK`, `GET /stock-issues` ne renvoie que ses bons). Bon PDF à signer : `StockIssuePdfService` (helpers `sis_`, `pdf.stockIssue.*`). Front : `Stock/StockIssueList` (`/stock/issues`, `/my-items`), `StockIssueForm` (`/stock/issues/new`), `StockIssueDetail` (`/stock/issues/:id`, `/my-items/:id`). Tests : `tests/api/stock-issues.spec.js`
- **Équipements affectés et retours** — migration `15_stock_equipment.sql` : `stock_items.track_serials` (exclusif du suivi par lot), `stock_units` (une ligne par unité : n° de série unique par article, n° d'inventaire unique par entreprise, statut `IN_STOCK` / `ASSIGNED` / `LOST` / `RETIRED` / `VOID`, état `GOOD` / `DAMAGED`, `warehouse_id` XOR `holder_id` imposé par contrainte), `stock_movements.unit_id`, type `RETURN`, `stock_issue_lines.unit_id` + `returned_quantity`, `stock_returns` (`RET-AAAA-NNNNN`) / `stock_return_lines` (`GOOD` / `DAMAGED` / `LOST`). Réception : `serials` [{ serialNumber, assetTag }] = un par unité acceptée (une unité + un mouvement par n° ; annulation du GRN refusée si une unité n'est plus en stock, unités → VOID). Parc existant : `POST /stock-units/register` (OPENING). Affectation : bon de sortie avec `unitIds` (unités en stock, bon état, du dépôt ; `UNITS_REQUIRED` / `UNIT_UNAVAILABLE`) → unité `ASSIGNED` au bénéficiaire. Retour : `POST /stock-returns { warehouseId, returnedBy, lines: [{ issueLineId, quantity, condition }] }` (`StockEquipmentModel.createReturn` : lignes du même détenteur, ≤ reste détenu, dépôt de destination au choix ; perdu = aucun mouvement, unité `LOST`) ; consommables aussi. Annulation d'un bon de sortie refusée après un retour (`HAS_RETURNS`). `GET /stock-holdings?userId=` (+ `user`) / `/mine`, `GET /stock-units` (+ `/:id` avec historique), `PUT /stock-units/:id` (état, réforme = ADJUSTMENT_OUT). **Départ** : `PATCH /users/:id/toggle-active` → 409 `HOLDS_EQUIPMENT` (liste) si l'utilisateur détient des unités, sauf `force: true` (tracé dans l'audit). Front : `Stock/EquipmentList` (`/stock/equipment`), `StockReturnForm` (`/stock/returns/new?userId=`, « Tout récupérer »), `StockReturns` (`/stock/returns[/:id]`), « En ma possession » dans `/my-items`, fenêtre « détient du matériel » dans `Admin/UserList`. Tests : `tests/api/stock-equipment.spec.js`
- À venir (non implémenté) : transferts entre dépôts, inventaire et ajustements, valorisation (CMUP), seuils → réquisition automatique, bon de retour PDF
- Tests : `tests/api/stock.spec.js` (dépôts, accès, catalogue, import, réceptions partielles, lots, sur-livraison, choix du dépôt, annulation, export, cloisonnement)

## Journal d'audit (audit_logs)

- Migration `12_audit_logs.sql` (idempotente) : colonnes `user_email` (copie conservée si le compte est supprimé) et `enterprise_id`, FK `user_id` **ON DELETE SET NULL** (sinon un utilisateur ayant un historique ne pouvait plus être supprimé), index `(action, created_at)` / `(enterprise_id, created_at)`
- `utils/auditLog.js` : `audit(req, AUDIT.X, { actor, target, details, oldValue })` — ne lève jamais d'erreur, **jamais de mot de passe ni de token**. `user_id` = auteur (défaut `req.user`, `null` pour un visiteur), `entity_id` = compte concerné, `new_value` = détails, `old_value` = valeurs avant modification, IP (`X-Forwarded-For` retenu **seulement** si la connexion vient d'un proxy local/privé) + user-agent ; entreprise de l'auteur/du compte (lue en base si absente du contexte)
- Actions : `LOGIN_SUCCESS`, `LOGIN_FAILED` (motif `UNKNOWN_EMAIL` / `WRONG_PASSWORD` / `INACTIVE_ACCOUNT`, la réponse au client ne change pas), `LOGOUT` (`POST /auth/logout`, appelé par `AuthContext.logout` avec le token en en-tête et un corps `{}` — `null` est refusé par express.json), `PASSWORD_CHANGED` / `PASSWORD_CHANGE_FAILED`, `PASSWORD_RESET_REQUESTED` (compte trouvé ou non, `throttled`, `rateLimited`), `PASSWORD_RESET_CONFIRMED`, `PASSWORD_RESET_INVALID_LINK`, `PASSWORD_RESET_BY_ADMIN`, `SUPPLIER_REGISTERED`, `USER_CREATED` / `USER_UPDATED` (avant/après) / `USER_ACTIVATED` / `USER_DEACTIVATED` / `USER_DELETED`
- Toute nouvelle action sensible sur un compte → ajouter une constante `AUDIT` et un appel `audit()`. `created_at` est un TIMESTAMP sans fuseau : filtrer par `id` dans les scripts. Tests : `tests/api/audit.spec.js`

## Mot de passe oublié / changement

- **En deux étapes** (une demande faite par un tiers ne modifie rien) :
  1. `POST /auth/forgot-password { email }` (public, `AuthController.forgotPassword`) : réponse **générique identique** que le compte existe ou non ; après la réponse, email à l'utilisateur **actif** avec un **lien public de confirmation** `APP_URL/reset-password?token=…` — **le mot de passe n'est pas modifié**. Limites en mémoire : 1 lien / email / 5 min, 5 demandes / IP / 15 min (429)
  2. Page publique `Auth/ResetPasswordConfirm` (`/reset-password`) → bouton « Confirmer » → `POST /auth/reset-password/confirm { token }` (POST et non GET : les antivirus qui pré-ouvrent les liens ne déclenchent rien) : génère un mot de passe (`utils/passwordGenerator.js`, 12 car.), l'envoie par email, ne le remplace que si l'email est parti. Erreurs : 400 `INVALID_LINK`, 502 `EMAIL_FAILED`, 409 double clic
  - Lien = JWT `purpose: 'password-reset'`, valable 1 h, **à usage unique** : il contient une empreinte du hash du mot de passe actuel, tout changement de mot de passe invalide les liens déjà émis
- `POST /auth/change-password { oldPassword, newPassword }` (authentifié, déclaré avant `tenantContext` → ouvert aux fournisseurs et au super admin) : ancien mot de passe faux → **400** (un 401 déconnecterait le client), ≥ 8 caractères
- Frontend : `Auth/ForgotPassword` (`/forgot-password`, lien depuis le login), `Auth/ResetPasswordConfirm` (`/reset-password`) ; changement depuis `Auth/Profile`
- Tests : `client/tests/api/password.spec.js` (n'utilise jamais un vrai email pour forgot-password)

## Session, déconnexion et WebSocket

- **Un seul socket** : `client/src/services/realtime.js` (`connectRealtime(token)` / `disconnectRealtime()`), ouvert par `AuthContext` à la connexion, fermé au `logout`. Composants : `useWebSocket()` → `{ socket, isConnected }` (n'ouvre jamais de connexion). Ne pas créer d'autre `io(...)`
- `logout()` (`AuthContext`) : vide le stockage, ferme le socket, `queryClient.cancelQueries()` + `clear()`, ferme les toasts. Un seul `AuthProvider` (dans `index.jsx`)
- `api.js` : une réponse à une requête partie avec un autre token que le token courant (déconnexion) est ignorée ; 401 sans token → pas de « Session expirée »
- Serveur (`server.js`) : `io.use` vérifie le JWT du handshake (`auth.token`) et place le socket dans `user-<id>` ; le `join` d'une autre room utilisateur est refusé

## Tableau de bord — « Qui bloque ? »

- `GET /dashboard/pending-tasks[?projectId=]` → `DashboardModel.getPendingTasksByProfile` : tâches GoFlow en attente (TASK_CREATED sans TASK_COMPLETED dans `workflow_history`, processus non terminé, réquisition ni annulée/rejetée/terminée), regroupées par profil via `TASK_CANDIDATE_GROUPS` (`utils/workflowLabels.js`). Fonctionne même si GoFlow est injoignable ; cloisonné par entreprise (`scopedDb`), projet contrôlé par `tenantGuard`
- Composant `Dashboard/PendingTasksByProfile.jsx` (rafraîchi toutes les 5 min) : barres horizontales (série unique), ancienneté en texte + statut (orange ≥ 3 j, rouge « bloqué » ≥ 7 j), alerte si aucun utilisateur n'a le profil, détail dépliable (réquisition, projet, tâche, pris en charge par), filtre par projet

## Traductions des documents (FR / EN)

- `backend/src/i18n/index.js` + `locales/fr.json` / `en.json` (statuts de réquisition y compris `CLASSIFIED_*`, avancement, priorités, libellés du PDF, `workflow.*`, `timeline.*`, `supplierProfile.*`). `i18n.translator(lang)` → `t('status.APPROVED')` ; `i18n.locale(lang)` pour les dates/montants ; langue inconnue → `fr`
- PDF de réquisition : `GET /requisitions/:id/export/pdf?lang=fr|en` — en-tête avec l'identité de l'entreprise (logo, nom, adresse, contact, NIF/RCCM via `getBranding`), badges « Étape » (statut) et « Avancement » (progress_status). Le viewer (`RequisitionViewer`) a un sélecteur FR/EN, initialisé sur la langue de l'interface
- Piège Handlebars : une clé de données portant le même nom qu'un helper enregistré (ex. `priorityLabel`) est masquée par le helper → nommer autrement
- **Tous les PDF sont traduits** (réquisition détail/liste, PO, GRN, paiement, offre fournisseur) : le client envoie `?lang=<getLang()>` sur chaque requête PDF ; le backend lit `i18n.fromRequest(req)` (`?lang=`, puis `Accept-Language`, défaut `fr`)
- Nouveau document à traduire : section `pdf.<doc>` dans `fr.json` / `en.json`, puis `pdfContext(lang, '<doc>')` (`utils/pdfI18n.js`) → `{ lang, locale, t, L }` passé au template (`L` = `pdf.common` + `pdf.<doc>`). Helpers Handlebars : dernier argument `options` → `rootLocale(options)` / `rootLabels(options)` ; dans un `#each` : `{{@root.L.x}}` ; phrases avec valeurs pré-formatées dans un objet `T` (HTML : échapper les valeurs avec `Handlebars.escapeExpression` puis `{{{T.x}}}`) ; pied de page Puppeteer : `ctx.L.page`

## Génération PDF

### Pattern commun (Puppeteer + Handlebars)
Tous les PDFs suivent le même pattern :
1. Template HTML avec expressions Handlebars compilées à l'exécution (pas de fichiers `.hbs`)
2. `puppeteer.launch(getBrowserOptions())` → `page.setContent(html)` → `page.pdf({ format: 'A4' })`
3. Réponse : `res.set('Content-Type', 'application/pdf')` + `res.end(pdfBuffer)`
4. Frontend : `api.get(url, { params: { lang: getLang() }, responseType: 'blob' })` → `URL.createObjectURL(blob)` → **`<iframe key={blobUrl}>`** (jamais `<embed>` : la CSP helmet `object-src 'none'` le bloque en production). Composant générique : `Common/BlobPdfViewer.jsx`

### Services PDF existants
| Module | Fichier service | Entrée |
|---|---|---|
| Réquisition (liste) | `RequisitionExportService.js` | tableau de réquisitions |
| Réquisition (détail) | `RequisitionExportService.generateRequisitionDetailPDF()` | réquisition unique |
| Purchase Order | `PurchaseOrderExportService.js` | objet PO avec items + approvals |
| Paiement | inline dans `PaymentController.generatePDF()` | objet paiement |
| GRN (bon de réception) | `GoodsReceiptExportService.js` (helpers `grn_`) — `GET /goods-receipts/:id/pdf` | id du GRN |
| Offre fournisseur (AO) | `TenderSubmissionPdfService.js` | AO + fournisseur + soumission + items |

### PurchaseOrderExportService — helpers Handlebars
Tous préfixés `po_` pour éviter les conflits avec les helpers de `RequisitionExportService` :
`po_formatDate`, `po_formatCurrency`, `po_statusLabel`, `po_statusColor`, `po_statusBg`, `po_add`, `po_multiply`, `po_eq`, `po_index1`

## Priorité de travail

1. ✅ **BPMN** — corrigé, complet, s'affiche dans Camunda Modeler
2. ✅ **Circuit d'approbation Camunda** (2026-06-23) :
   - `database/data.sql` : ajout profils `prof_dg` (`dg`), `prof_logistic` (`logistic`), `prof_management` (`management`)
   - `TaskController.completeTask()` : met à jour statut réquisition/PO selon la tâche et la décision
   - `TaskList.jsx` : distingue `approved` (réquisitions) vs `poApproved` (PO)
3. ✅ **GRN** : `GoodsReceiptModel`, `GoodsReceiptController`, routes, `GRNList/GRNForm/GRNDetail`, tests
4. ✅ **SAN** : `ServiceAcceptanceModel`, `ServiceAcceptanceController`, routes, `SANList/SANForm/SANDetail`, tests
5. ✅ **Invoices** : table, model, controller, routes, `InvoiceList/InvoiceForm/InvoiceDetail`
6. ✅ **3-way matching** : `process_invoice` worker — vérifie PO + GRN + Facture
7. ✅ **Paiements** : table, model, controller, routes, `PaymentList/PaymentForm/PaymentDetail`, PDF
8. ✅ **PO PDF** : `PurchaseOrderExportService.js` — Puppeteer + Handlebars, template A4 complet
9. ✅ **TaskList → formulaires GoFlow** (2026-06-24) :
   - `TaskList.jsx` : `FORM_TASKS` map → redirect vers formulaire dédié si `taskDefinitionKey` reconnu
   - `PODetail.jsx` : suppression des liens de création directs (Option B), section P2P en lecture seule
   - Tests e2e ajoutés dans `tasklist.spec.js` pour valider les 4 redirects + absence de liens directs
10. **Confirmation fournisseur** (`Activity_SupplierConfirmation`) — non implémentée

## Profils → candidateGroups Camunda
| Profile DB | candidateGroup BPMN | Rôle |
|------------|--------------------|----|
| `prof_manager` | `manager` | Approbation N1 (< 25 000) |
| `prof_finance` | `finance` | Approbation N2 (25k–100k) + Factures + **seul profil avec le module Budget** (`MANAGE_BUDGET`) |
| `prof_dg` | `dg` | Approbation N3 (≥ 100 000) |
| `prof_management` | `management` | Approbation PO |
| `prof_procurement` | `procurement` | Création PO, méthode d'achat |
| `prof_logistic` | `logistic` | Réception marchandises (GRN) |
| `prof_requester` | `requester` | Création réquisition, SAN |
| `prof_supplier` | — | Fournisseur externe : portail AO uniquement |

## Conventions de code
- Backend : CommonJS (require/module.exports), classes pour les models
- Modèles : singleton exporté (`module.exports = new XxxModel()`)
- Transactions DB : `db.transaction()` avec `addInsertQuery` / `addUpdateQuery`
- Auth middleware : `authenticate`, `hasPermission('PERMISSION_NAME')`
- Numérotation : REQ-YYYY-NNNN pour réquisitions, PO-YYYY-NNNN pour POs, GRN-YYYY-NNNN, SAN-YYYY-NNNN, INV-YYYY-NNNN, PAY-YYYY-NNNN

## Tests
```
npx playwright test tests/api/      # Tests API backend — avec GoFlow : 187 pass ; sans GoFlow : 178 pass, 9 skip
npx playwright test tests/e2e/      # Tests navigateur — 64 pass avec GoFlow (le filtre de « Mes tâches » attend des tâches réelles)
```
- Variables d'env : `API_URL` (backend), `APP_URL` (frontend, qui doit tourner ; le port 3000 est parfois pris par le frontend GoFlow)
- **GoFlow local** : conteneur `goflow-app` sur `http://localhost:8080` (`CAMUNDA_URL` / `CAMUNDA_REST_URL`). Sans GoFlow, les tests qui attendent des tâches s'ignorent (skip) au lieu d'échouer
- Un **PO est créé directement en `PO_PENDING`** (pas d'étape brouillon : il part aussitôt en approbation `Activity_POApproval`) et n'est plus modifiable par `PUT` — les tests vérifient ce statut, ils ne « soumettent » plus le PO
- Aiguillage d'approbation **direct selon le montant** (BPMN) : < 25 000 → N1 Manager, < 100 000 → N2 Finance, sinon N3 DG. Le `process_instance_id` arrive juste après la création : relire la réquisition (`refreshProcess`) avant d'attendre une tâche ; `waitForTaskOrStop` s'arrête si le budget est insuffisant. `workflow-extended.spec.js` crée une ligne budgétaire neuve à chaque passage (une ligne réutilisée finit épuisée)
