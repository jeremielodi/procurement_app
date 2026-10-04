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
- User tasks : complétées via `POST /tasks/{taskId}/complete`

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

## Stockage des fichiers (MinIO)

- `services/StorageService.js` : `put / getBuffer / exists / remove / send` ; driver `STORAGE_DRIVER=minio` (docker compose) ou `local` (UPLOAD_DIR, dev sans Docker). **Tout nouveau code qui stocke un fichier passe par ce service** (jamais `fs` directement)
- Bucket MinIO **privé et versionné** (créé au démarrage par `server.js > initStorage`, avec plusieurs tentatives) : un fichier écrasé/supprimé reste récupérable
- Les fichiers ne sont **jamais servis en statique** : pièces jointes via `GET /api/upload/download/file/:id` (authentifié + contrôle entreprise, y compris à l'upload multipart via `attachmentEntityAllowed`), logos via `/api/public/{suppliers,enterprises}/:id/logo` ; logos embarqués dans les PDF par `utils/logoUpload.logoDataUri`
- Clés = chemins déjà enregistrés en base (`attachments.file_path`, `suppliers.logo_path`, `enterprise.logo_path`) : `YYYY/MM/<ts>_<uuid>.<ext>`, `supplier-logos/…`, `enterprise-logos/…`
- Docker : service `minio` (image `cgr.dev/chainguard/minio` — MinIO ne publie plus d'images communautaires sur Docker Hub/Quay), volume `wwf_minio_data`, ports liés à 127.0.0.1 (9000 API, 9001 console). Identifiants `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` / `MINIO_BUCKET` dans **`backend/.env`** (lu par le service `minio` et par l'app via `env_file`, comme PostgreSQL — pas d'interpolation `${…}` dans docker-compose)
- Migration disque → MinIO : `docker exec wwf_app node scripts/migrate-uploads-to-minio.js [--dry-run]` (idempotente, vérifie toutes les références en base)
- Tests : `tests/api/attachments.spec.js`

## Déploiement HTTP / HTTPS

- `server.js` : en-têtes HTTPS stricts de helmet (`upgrade-insecure-requests`, HSTS, COOP, Origin-Agent-Cluster) **seulement si `APP_URL` commence par `https://`**. En HTTP (ex. `http://domaine:5000`) ils provoquaient le chargement des JS/CSS en https → `ERR_SSL_PROTOCOL_ERROR`, page blanche
- Client : Socket.io se connecte à `window.location.origin` (ou `VITE_WS_URL`) — jamais `localhost` en dur
- Production recommandée : reverse proxy HTTPS (Caddy / Nginx + Let's Encrypt) devant le port 5000, puis `APP_URL=https://…`

## Emails de tâche GoFlow

- `task_listner.handleTaskCreated` : à chaque TASK_CREATED, email aux utilisateurs **actifs**, ayant le **profil de la tâche** (`prof_<candidateGroup>`), **membres du projet** de la réquisition et de la **même entreprise** (`getTaskEmailRecipients`) + notification in-app
- Rôle déduit de `TASK_CANDIDATE_GROUPS` si l'événement n'a pas de `candidateGroup` ; clé lue en `taskDefinitionKey` ou `TaskDefinitionKey` ; notifications et emails indépendants (l'échec de l'un n'empêche pas l'autre) ; bilan « 📧 … email(s) envoyé(s) » ou « aucun membre du projet avec le profil » dans les logs
- Liens des emails : `APP_URL` (défaut `http://localhost:5000`) — à définir avec l'adresse publique

## Tableau de bord — « Qui bloque ? »

- `GET /dashboard/pending-tasks[?projectId=]` → `DashboardModel.getPendingTasksByProfile` : tâches GoFlow en attente (TASK_CREATED sans TASK_COMPLETED dans `workflow_history`, processus non terminé, réquisition ni annulée/rejetée/terminée), regroupées par profil via `TASK_CANDIDATE_GROUPS` (`utils/workflowLabels.js`). Fonctionne même si GoFlow est injoignable ; cloisonné par entreprise (`scopedDb`), projet contrôlé par `tenantGuard`
- Composant `Dashboard/PendingTasksByProfile.jsx` (rafraîchi toutes les 5 min) : barres horizontales (série unique), ancienneté en texte + statut (orange ≥ 3 j, rouge « bloqué » ≥ 7 j), alerte si aucun utilisateur n'a le profil, détail dépliable (réquisition, projet, tâche, pris en charge par), filtre par projet

## Traductions des documents (FR / EN)

- `backend/src/i18n/index.js` : dictionnaires `fr` / `en` (statuts de réquisition y compris `CLASSIFIED_*`, avancement, priorités, libellés du PDF). `i18n.translator(lang)` → `t('status.APPROVED')` ; `i18n.locale(lang)` pour les dates/montants ; langue inconnue → `fr`
- PDF de réquisition : `GET /requisitions/:id/export/pdf?lang=fr|en` — en-tête avec l'identité de l'entreprise (logo, nom, adresse, contact, NIF/RCCM via `getBranding`), badges « Étape » (statut) et « Avancement » (progress_status). Le viewer (`RequisitionViewer`) a un sélecteur FR/EN
- Piège Handlebars : une clé de données portant le même nom qu'un helper enregistré (ex. `priorityLabel`) est masquée par le helper → nommer autrement
- Nouveau document à traduire : ajouter ses libellés dans les deux dictionnaires et passer `L` (libellés) + valeurs déjà formatées au template

## Génération PDF

### Pattern commun (Puppeteer + Handlebars)
Tous les PDFs suivent le même pattern :
1. Template HTML avec expressions Handlebars compilées à l'exécution (pas de fichiers `.hbs`)
2. `puppeteer.launch(getBrowserOptions())` → `page.setContent(html)` → `page.pdf({ format: 'A4' })`
3. Réponse : `res.set('Content-Type', 'application/pdf')` + `res.end(pdfBuffer)`
4. Frontend : `api.get(url, { responseType: 'blob' })` → `URL.createObjectURL(blob)` → **`<iframe key={blobUrl}>`** (jamais `<embed>` : la CSP helmet `object-src 'none'` le bloque en production). Composant générique : `Common/BlobPdfViewer.jsx`

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
npx playwright test tests/api/      # Tests API backend (86 pass, 3 skip Camunda absent)
npx playwright test tests/e2e/      # Tests navigateur (61 pass)
npx playwright test                 # Suite complète (147 pass, 3 skip)
```
- Variables d'env pour e2e : `APP_URL=http://localhost:3000` (le frontend doit tourner)
- Les 3 tests skippés sont normaux : ils attendent des tâches GoFlow que Camunda ne génère pas sans être démarré
