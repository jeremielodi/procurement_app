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
  - Auditeur (`prof_auditor`, migration 21) : lecture seule (achats, stock, fournisseurs, budget via `AUDIT_ACCESS`, journal d'audit), aucune saisie ni tâche GoFlow
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
- **Onglet tâches de la réquisition → formulaires dédiés** (GRN/SAN/Facture/Paiement via GoFlow) ; « Mes tâches » renvoie vers cet onglet
- **Portail fournisseur & appels d'offres** (2026-10-04) — voir section dédiée ci-dessous
- **Confirmation fournisseur**, **ajustement budgétaire avec nouvelle vérification**, **recherche globale** (2026-10-09) — voir « Cycle achats — compléments »
- **Stock** : inventaires, ajustements, réapprovisionnement, valorisation CMUP, transferts en transit, bon de retour PDF (2026-10-09) — voir « Gestion de stock »
- **Exploitation** : écran du journal d'audit, PDF avec navigateur partagé, scripts de sauvegarde (2026-10-09)

### ⚠️ Problèmes connus
- ✅ Corrigé (2026-10-09) : `database.js` partage UNE connexion pour les requêtes simples, mais **toute transaction passe désormais par une connexion dédiée du pool** — `db.withTransaction(fn)` et `db.transaction().execute()` (`config/transaction.js`, utilisé par réquisitions, utilisateurs, PO, budget, fournisseurs, AO, entreprise). Avant, `execute()` faisait BEGIN/COMMIT sur la connexion partagée : la transaction englobait les requêtes concurrentes des autres utilisateurs (un ROLLBACK pouvait les annuler). Nouveau code : de préférence `db.withTransaction` (lecture des résultats au fil de l'eau)
- ✅ Corrigé (2026-10-09) : PDF simultanés sous Windows (`EBUSY` sur le profil Chrome temporaire, arrêt du serveur) → `utils/pdfRenderer.js` (un Chrome partagé, une page par document)
- ✅ Corrigé (2026-10-09) : les événements GRN / SAN / facture / paiement créés depuis une tâche (`TaskController.logDocumentEvent`) sont rattachés à la réquisition (avant : id entier du PO dans `entity_id` UUID → échec silencieux) ; le suivi du workflow les ajoute à l'étape (`timeline.doc.*`, liens vers le document et le PO)
- ✅ Corrigé (2026-10-09) : colonnes `DATE` renvoyées en texte `AAAA-MM-JJ` (`types.setTypeParser` dans `config/database.js`) — avant, minuit local sérialisé en UTC donnait la veille quand le serveur est en avance sur UTC. Ne pas appeler de méthode `Date` directement sur ces valeurs : `new Date(v)` (minuit UTC) ou comparer les chaînes
- ✅ Supprimé (2026-10-09) : `routes/requisitions.js`, jamais chargé (code mort)
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
| `Activity_ValidationN1_Manager` | Manager Approval (N1) | `manager` | Fenêtre (onglet tâches de la réquisition) |
| `Activity_ValidationN2_Finance` | Finance Approval (N2) | `finance` | Fenêtre (onglet tâches de la réquisition) |
| `Activity_ValidationN3_DG` | DG Approval (N3) | `dg` | Fenêtre (onglet tâches de la réquisition) |
| `Activity_DetermineType` | Determine Procurement Type | `procurement` | Fenêtre (onglet tâches de la réquisition) |
| `Activity_DirectPurchase` | Direct Purchase | `procurement` | Fenêtre (onglet tâches de la réquisition) |
| `Activity_RequestQuotations` | Request Multiple Quotations | `procurement` | Fenêtre (onglet tâches de la réquisition) |
| `Activity_RFPProcess` | Call for Tenders / RFP | `procurement` | **→ `/tenders/new?taskId=&requisitionId=`** (complétée à l'attribution) |
| `Activity_SoleSource` | Sole Source Justification | `procurement` | Fenêtre (onglet tâches de la réquisition) |
| `Activity_CreatePO` | Create Purchase Order | `procurement` | Fenêtre (onglet tâches de la réquisition) |
| `Activity_POApproval` | Approve Purchase Order | `management` | Fenêtre (onglet tâches de la réquisition) |
| `Activity_BudgetAdjustment` | Request Budget Adjustment | `requester` (assignee `${requester}`) | **→ fiche de la réquisition** (`BudgetAdjustmentPanel`) |
| `Activity_SupplierConfirmation` | Supplier Order Confirmation | `procurement` | **→ fiche du PO `?confirm=1`** (`SupplierConfirmationPanel`) ; complétée aussi par la réponse du fournisseur sur son portail |
| `Activity_GoodsReceipt` | Goods Receipt Note (GRN) | `logistic` | **→ `/goods-receipts/new?taskId=&poId=`** |
| `Activity_ServiceAcceptance` | Service Acceptance Note (SAN) | `requester` | **→ `/service-acceptance-notes/new?taskId=&poId=`** |
| `Activity_EnterInvoice` | Enter Supplier Invoice | `finance` | **→ `/invoices/new?taskId=&poId=`** |
| `Activity_ProcessPayment` | Process Payment | `finance` | **→ `/payments/new?taskId=`** |

## Architecture GoFlow — Principe clé (Option B)

**Une tâche se prend en charge et se traite UNIQUEMENT depuis l'onglet tâches de sa réquisition (`/requisitions/:id/tasks`, `RequisitionTasks`).** « Mes tâches » (`Task/TaskList`) est une vue d'ensemble : chaque carte (réquisition lue en base par `GET /tasks/user` : `requisitionId`, `requisitionNumber`, `requisitionTitle`) renvoie vers `/requisitions/:id/tasks?task=<id>` (tâche mise en évidence). `RequisitionTasks.resolveTaskTarget` ouvre le formulaire avec les documents de CETTE réquisition, lus en base (variables GoFlow seulement pour départager) : PO en attente (`Activity_POApproval`), PO envoyé (`Activity_SupplierConfirmation`, `?confirm=1`), PO actif (GRN / SAN / facture, dernière réception non annulée), facture non payée (paiement) ; document manquant → message `reqTasks.missing.*`, jamais de formulaire orphelin ni d'étape terminée sans son document.

**Chaîne de rattachement imposée par le serveur** : commande → réquisition existante et active (400 `REQUISITION_REQUIRED`, 409 `REQUISITION_NOT_ACTIVE` si DRAFT / REJECTED / CANCELLED ; `created_by` = utilisateur connecté, jamais le corps ; seule l'étape `Activity_CreatePO` de cette réquisition est terminée, le `taskId` du client n'est retenu que s'il correspond) ; réception / SAN → bon de commande (`poId` requis) ; facture → bon de commande approuvé (400 `PO_REQUIRED`, 409 `PO_NOT_INVOICEABLE`) ; paiement → facture (400 `INVOICE_REQUIRED`, 409 `INVOICE_NOT_PAYABLE`, bon de commande déduit de la facture). Côté client : pas de bouton « Nouveau » dans les listes GRN / SAN / factures / paiements (lien « Mes tâches ») ; `GRNForm` / `SANForm` / `InvoiceForm` sans `poId`, `PaymentForm` sans `invoiceId` → `Common/WorkflowOnlyPage` (explication, aucun formulaire)

**Les formulaires GRN, SAN, Facture et Paiement ne sont accessibles en création QUE via la tâche de la réquisition.**

- GoFlow gère l'ordre des étapes : impossible de créer une facture avant le GRN, etc.
- Le **PODetail** affiche uniquement les documents P2P déjà créés (lecture seule) avec un bandeau info.
- Les **listes** (GRNList, InvoiceList, etc.) n'ont plus de bouton « Nouveau » (création uniquement depuis la tâche de la réquisition).
- `RequisitionTasks` détecte le `taskDefinitionKey` : tâche à formulaire dédié → `navigate(route)` ; sinon → fenêtre de décision.

### Complétion de la tâche Camunda depuis les formulaires
Chaque formulaire lit `taskId` depuis `useSearchParams()` et le passe au backend via le service.
Le backend tente de compléter la tâche Camunda ; si `taskId` absent, il cherche via `process_instance_id` de la réquisition liée.

## Cycle achats — compléments (2026-10-09)

- **Confirmation fournisseur** — migration `17_supplier_order_confirmation.sql` : colonnes PO `supplier_response` (`CONFIRMED` / `DECLINED`), `supplier_responded_at/by`, `supplier_response_source` (`PORTAL` / `PROCUREMENT`), `confirmed_delivery_date`, `supplier_reference`, `supplier_comment`, `sent_at` ; statut `PO_CONFIRMED`. Le worker `send_po_notification` passe le PO en `PO_SENT` (+ `sent_at`) ; l'email contient le lien du portail (fournisseur inscrit) ou demande une réponse. `SupplierConfirmationService.respond` : CONFIRMED → `PO_CONFIRMED` + tâche GoFlow complétée (`tenant.run` avec l'entreprise du PO, la réponse venant d'un compte fournisseur) ; DECLINED → motif obligatoire, tâche ouverte, achats notifiés ; un refus peut être suivi d'une confirmation, une confirmation est définitive. API : `GET /supplier-portal/orders[/:id][/pdf]`, `POST /supplier-portal/orders/:id/confirm|decline` ; `POST /purchase-orders/:id/supplier-response` (`CREATE_PURCHASE_ORDERS`, source PROCUREMENT). Événements du suivi : SUPPLIER_CONFIRMED / SUPPLIER_DECLINED. Front : `PurchaseOrders/SupplierConfirmationPanel`, `SupplierPortal/SupplierOrderList|SupplierOrderDetail` (`/supplier/orders[/:id]`, menu « Mes commandes », bandeau du tableau de bord `stats.ordersToConfirm`). Tests : `tests/api/supplier-confirmation.spec.js`
- **Ajustement budgétaire → nouvelle vérification** (BPMN, EN déployé + FR synchronisé) : `Activity_BudgetAdjustment` → `Gateway_BudgetAdjustmentDecision` : `${budgetAdjusted == true}` → retour à `Task_CheckBudget` (même réquisition), sinon fin (réquisition annulée). Le worker `check_budget` relit les articles en base, ne termine plus le processus (renvoie `budgetAvailable: false`) et remet la réquisition `IN_PROGRESS` lors d'une nouvelle vérification. `BudgetAdjustmentService` : `GET /requisitions/:id/budget-adjustment` (besoin / disponible par ligne), `PATCH /requisitions/:id/budget-lines` (autres lignes du projet), `POST /requisitions/:id/budget-adjustment { decision: RETRY | ABANDON }` (RETRY refusé tant qu'une ligne est insuffisante : `STILL_INSUFFICIENT`) ; acteurs : demandeur, admin, `MANAGE_BUDGET`. Compléter la tâche depuis « Mes tâches » sans décision = `budgetAdjusted=false` (annulation). Front : `Requisitions/BudgetAdjustmentPanel`. Tests : `tests/api/budget-adjustment.spec.js` (GoFlow requis). **Production : redéployer `procurement-workflow.bpmn` dans GoFlow** (`CamundaService.deployProcess`, champ multipart `file`)
- **Recherche globale** : `GET /search?q=` (`GlobalSearchService`) — réquisitions, PO, réceptions, factures, fournisseurs, AO, articles ; chaque groupe seulement avec la permission de la liste correspondante, cloisonné par entreprise. Front : `Layout/GlobalSearch` dans l'en-tête (pas pour fournisseur ni super admin). Tests : `tests/api/global-search.spec.js`

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

## Sauvegardes (PostgreSQL + MinIO)

- `deploy/backup.sh` (serveur Linux Docker, cron quotidien) : `pg_dump -Fc` via `docker exec wwf_postgres` (vérifié par `pg_restore --list`), archive en lecture seule des volumes `wwf_minio_data` / `wwf_uploads_data` (conteneur `alpine`), `SHA256SUMS`, rétention `BACKUP_RETENTION_DAYS` (14), copie hors serveur `BACKUP_REMOTE` (rsync ou rclone). Réglages dans `deploy/backup.env` (ignoré par git, modèle `backup.env.example`) ; aucun secret lu
- `deploy/restore.sh <dossier> [--db-only|--files-only] [--yes]` : vérifie les empreintes, arrête `app`, `pg_restore --clean --single-transaction`, remplace le volume MinIO (MinIO arrêté, propriétaire 65532), redémarre. Documentation : `readme.md` › « Sauvegarde et restauration »
- `.gitattributes` : `*.sh` toujours en LF

## Rapport quotidien des réquisitions (email à minuit) — migration `22_daily_requisition_report.sql`

- Option par entreprise `enterprise.daily_report_enabled` (défaut désactivée) : carte `Enterprises/DailyReportSettings` dans « Mon entreprise » ; `GET|PUT /enterprises/current/daily-report` (`MANAGE_USERS`, changement tracé `ENTERPRISE_UPDATED`), `POST /enterprises/current/daily-report/test` = exemple immédiat à l'administrateur connecté (409 `NOT_A_RECIPIENT` / `NO_REQUISITIONS`, 502 `EMAIL_FAILED`)
- `DailyRequisitionReportService` : destinataires = utilisateurs actifs `prof_admin` (tous les projets) et `prof_manager` (projets dont ils sont membres ou responsables), email dans `users.language` (`email.dailyReport.*`) ; projet par projet : synthèse + **20 dernières réquisitions** (statut, avancement `PROGRESS_STATUS_SQL` exporté par `RequisitionModel`, étape GoFlow en cours = TASK_CREATED sans TASK_COMPLETED dans `workflow_history`, ancienneté, « bloquée » ≥ 7 j). Destinataire sans réquisition dans ses projets : pas d'email
- Planificateur `start()` (`server.js`) : vérification chaque minute, envoi entre 0 h et 6 h (rattrapage d'une nuit manquée) dans le fuseau `APP_TIMEZONE` ; `daily_report_runs` (entreprise × jour) réservée avant l'envoi → un seul envoi par jour, même avec plusieurs instances. `DAILY_REPORT_DISABLED=1` coupe le planificateur
- Tests : `tests/api/daily-report.spec.js`

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
- Textes dans `landing.*` des fichiers de langue (voir « Interface multilingue ») ; listes = tableaux JSON, icônes dans le composant (`FEATURE_ICONS`, `STOCK_ICONS`…, même ordre). Sections : fonctionnalités, cycle, **stock** (`#stock`, badge « Nouveau », 9 cartes `landing.stock.items` : dont transferts en transit, inventaires, valorisation CMUP), **audit & contrôle** (`#audit`, `landing.audit` : 6 cartes `AUDIT_ICONS` + liste « Ce que l'auditeur obtient », argumentaire pour auditeurs et contrôle interne), fournisseurs, sécurité, contact. Menu replié sous 1024 px (`lg:`, 7 liens). **Toute nouvelle fonctionnalité visible → mettre à jour le site** (FR + EN). Liens : `/login`, `/supplier-register`
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
- **Types de sortie** — migration `16_stock_issue_destinations.sql` : `stock_issues.destination_type` = `USER` (vers un employé, `recipient_id` obligatoire) / `WAREHOUSE` (transfert, `destination_warehouse_id` ≠ dépôt source) / `DEPARTMENT` (`department_id`, `recipient_id` facultatif = personne qui retire) — contrainte `stock_issues_destination_check` ; `acknowledged_by` ; lignes `transfer_in_movement_id` / `reversal_out_movement_id`. `StockIssueModel.create({ destinationType, … })` : USER / DEPARTMENT → mouvement `ISSUE` (équipement `ASSIGNED` à la personne ou au département : `stock_units.department_id`, contrainte holder XOR département) ; WAREHOUSE → `TRANSFER_OUT` (source) à la création, `TRANSFER_IN` à la réception (voir « Transferts en transit »), mêmes lots / n° de série ; un transfert accepte le matériel endommagé et un lot périmé **imposé**. Accusé (`canAcknowledge`) : bénéficiaire ; département sans bénéficiaire → `departments.manager_id` ; transfert → utilisateur ayant accès au dépôt de destination (`can_acknowledge` renvoyé par `GET /stock-issues/:id`, qui est aussi consultable par ces personnes). Notifications : bénéficiaire / responsable / utilisateurs du dépôt de destination + admins (`notification.stockIssue.transfer*`, `departmentIssued*`). Annulation d'un transfert réceptionné = `TRANSFER_OUT` au dépôt de destination + `TRANSFER_IN` au dépôt source (quantités reçues), refusée (409 `TRANSFER_USED`) si le stock transféré a été utilisé. `GET /stock-issues/destinations` (dépôts + départements actifs, `ISSUE_STOCK`) ; filtres `destinationType`, `departmentId`, `warehouseId` (source **ou** destination) ; `destination_label`. Détentions d'un employé = sorties `USER` uniquement ; `GET /stock-holdings?departmentId=` ; retour `POST /stock-returns { departmentId | returnedBy }` (`stock_returns.department_id`, XOR). Journal des mouvements : `recipient_name` = destination (transfert : l'autre dépôt). PDF : « Bon de transfert », bloc Destination (`pdf.stockIssue.type*`). Front : cartes de type dans `StockIssueForm` (`ISSUE_TYPES`, `?type=`), `IssueTypeBadge`, filtre de type dans `StockIssueList`, « Un employé / Un département » dans `StockReturnForm` (`?departmentId=`). Tests : `tests/api/stock-destinations.spec.js`
- **Transferts en transit** — migration `19_stock_transfers_in_transit.sql` : statut d'unité `IN_TRANSIT` (ni dépôt ni détenteur), `stock_issue_lines.received_quantity`. Création d'un transfert = `TRANSFER_OUT` seulement (stock « en transit »). `POST /stock-issues/:id/receive { lines: [{ lineId, receivedQuantity }], comment }` (`StockIssueModel.receiveTransfer`, utilisateur ayant accès au dépôt de destination ; `acknowledge` d'un transfert = tout reçu) : `TRANSFER_IN` pour le reçu, manque = perte en transit (équipement non reçu → `LOST`), `linesWithLoss` ; 400 `INVALID_RECEIVED_QUANTITY`, 409 `ALREADY_ACKNOWLEDGED`. Annulation en transit = `TRANSFER_IN` au dépôt source (unités → `IN_STOCK`) ; après réception = reprise des quantités reçues. Filtre `GET /stock-issues?inTransit=1`. Front : dialogue de réception par ligne dans `StockIssueDetail` (« Réceptionner »), badges « En transit » / « Réceptionné » / « Réceptionné avec manque », filtre de statut « En transit », statut d'équipement « En transit »
- **Inventaires et ajustements** — migration `18_stock_counts.sql` : `stock_counts` (`CNT-AAAA-NNNNN`, un seul ouvert par dépôt, périmètre dépôt entier ou catégorie, attendu figé à l'ouverture), `stock_count_lines` (une ligne par article × lot, une par équipement), `stock_adjustments` (`AJU-AAAA-NNNNN`, motifs DAMAGE / LOSS / THEFT / EXPIRED / FOUND / CORRECTION / OTHER), permissions `COUNT_STOCK` (logistique, admin) / `ADJUST_STOCK` (admin). `StockCountModel` : open / recordCounts / addLine (stock trouvé) / validate (écarts → ADJUSTMENT_IN / OUT, équipement absent → `LOST` ; `BALANCE_CHANGED` si le solde ne permet plus la sortie) / cancel / createAdjustment. API : `/stock-counts` (+ `/:id/lines` PUT / POST, `/:id/validate`, `/:id/cancel`), `/stock-adjustments`. Front : `Stock/StockCountList`, `StockCountDetail` (comptage à l'aveugle), `StockAdjustments`. Tests : `tests/api/stock-counts.spec.js`
- **Réapprovisionnement** : `stock_items.reorder_quantity` ; la liste des articles propose « Réapprovisionner » pour les articles sous le minimum (`suggestedRestock`) → `/requisitions/new` pré-rempli (`location.state.prefill` lu par `RequisitionForm`)
- **Valorisation CMUP** : `StockValuationService` recalcule le coût moyen pondéré depuis le journal des mouvements (réception au prix du PO ; annulation de réception à son coût ; autres sorties au CMUP ; transferts sans effet sur la quantité totale ni le coût — le stock en transit compte dans le total de l'entreprise, dans aucun dépôt ; perte en transit sortie au CMUP à la réception). Article reçu dans plusieurs devises ou sans coût connu : non valorisé. `GET /stock/valuation[?asOf=&warehouseId=&categoryId=]` (+ `/export` Excel). Front : `Stock/StockValuation` (`/stock/valuation`). Tests : `tests/api/stock-valuation.spec.js`
- **Bon de retour PDF** : `GET /stock-returns/:id/pdf` (`StockReturnPdfService`, helpers `sret_`, `pdf.stockReturn.*`), bouton dans le détail d'un retour
- À venir (non implémenté) : seuils → réquisition **automatique** (aujourd'hui : bouton « Réapprovisionner »), multi-devises dans la valorisation
- Tests : `tests/api/stock.spec.js` (dépôts, accès, catalogue, import, réceptions partielles, lots, sur-livraison, choix du dépôt, annulation, export, cloisonnement)

## Contrôle interne (séparation des tâches, banque, doublons) — migration `21_internal_control.sql`

- **Permissions d'écriture** (avant : `VIEW_PURCHASE_ORDERS` suffisait) : `RECORD_GOODS_RECEIPT` (POST /goods-receipts : admin, logistique, magasinier), `RECORD_SERVICE_ACCEPTANCE` (SAN : admin, demandeur, managers), `MANAGE_INVOICES` (création, rapprochement, validation, rejet : admin, finance), `MANAGE_PAYMENTS` (saisie : admin, finance), `APPROVE_PAYMENTS` (approve / status : admin, finance, DG, management), `VERIFY_SUPPLIER_BANK` (admin, finance), `AUDIT_ACCESS` (auditeur : GET budget). Côté client, `hasPermission` accepte une liste (au moins une)
- **Séparation des tâches** — `utils/segregation.js` (aucune exception, même admin ; refus = 403 `SELF_APPROVAL` + audit `SOD_VIOLATION_BLOCKED`) : tâches N1/N2/N3 ≠ demandeur ; `Activity_POApproval` et `POST /purchase-orders/:id/approve` ≠ créateur du PO ni demandeur ; facture validée ≠ saisie ; paiement approuvé / passé PAID ≠ saisi. `TaskController.completeTask` contrôle désormais **côté serveur** : groupe de la tâche (`TASK_NOT_IN_GROUP`), prise en charge par un autre (`TASK_CLAIMED_BY_OTHER`), conflit ; la clé de tâche et la réquisition viennent de GoFlow / de la base (plus du corps de la requête). Listes de tâches : `blockedReason: 'SELF_APPROVAL'` (canClaim / canComplete false) ; fiches PO et paiement : `self_approval`. Le `approverId` du corps des approbations PO est ignoré
- **Coordonnées bancaires** — `SupplierBankService` : tout changement de banque / compte / IBAN / SWIFT (`PUT /suppliers/:id` acheteur, `PUT /supplier-portal/me` fournisseur) → `supplier_bank_changes` (avant / après) + audit (n° masqués `•••1234`) + notification aux `VERIFY_SUPPLIER_BANK` des entreprises ayant des PO avec ce fournisseur. Vérification **par entreprise** du dernier changement (`supplier_bank_reviews`, `PUT /suppliers/:id/bank-changes/:changeId/review { status, reason }`, motif obligatoire au rejet, pas par l'auteur du changement `SELF_VERIFICATION`, ancien changement `SUPERSEDED`). `assertPayable` : saisie (formulaire et tâche `Activity_ProcessPayment`, avant de terminer l'étape), approbation et passage PAID refusés (409 `BANK_CHANGE_UNVERIFIED` / `BANK_CHANGE_REJECTED`, audit `PAYMENT_BLOCKED`). Pas de changement enregistré = paiements autorisés (coordonnées saisies à la création non concernées). Front : `Suppliers/SupplierBankPanel` (onglet `?tab=bank`, bandeau d'alerte), `supplier.bank_status`, `payment.bank_status`
- **Factures** : `supplier_invoice_number` (n° du fournisseur, obligatoire dans le formulaire ; l'ancien champ `invoiceNumber` non INV-… est repris), `invoice_number` toujours généré INV-…, `supplier_id` = celui du PO. Doublon (entreprise × fournisseur × n° normalisé, hors REJECTED / CANCELLED) → 409 `DUPLICATE_INVOICE` (+ `details.invoiceNumber`), audit `INVOICE_DUPLICATE_BLOCKED`, index unique partiel `uq_invoices_supplier_number` (non créé si des doublons existent déjà : NOTICE)
- Tests : `tests/api/internal-control.spec.js` ; helper `getApproverToken` (second admin `approver.tests@procurement.com`, créé au besoin) pour toute approbation dans les tests

## Journal d'audit (audit_logs)

- Migration `12_audit_logs.sql` (idempotente) : colonnes `user_email` (copie conservée si le compte est supprimé) et `enterprise_id`, FK `user_id` **ON DELETE SET NULL** (sinon un utilisateur ayant un historique ne pouvait plus être supprimé), index `(action, created_at)` / `(enterprise_id, created_at)`
- `utils/auditLog.js` : `audit(req, AUDIT.X, { actor, target, details, oldValue })` — ne lève jamais d'erreur, **jamais de mot de passe ni de token**. `user_id` = auteur (défaut `req.user`, `null` pour un visiteur), `entity_id` = compte concerné, `new_value` = détails, `old_value` = valeurs avant modification, IP (`clientIp` : `X-Forwarded-For` retenu **seulement** si la connexion vient d'un proxy local/privé, et c'est sa **dernière** adresse — celle ajoutée par notre proxy ; les premières peuvent être écrites par le client) + user-agent ; entreprise de l'auteur/du compte (lue en base si absente du contexte)
- Actions : `LOGIN_SUCCESS`, `LOGIN_FAILED` (motif `UNKNOWN_EMAIL` / `WRONG_PASSWORD` / `INACTIVE_ACCOUNT`, la réponse au client ne change pas), `LOGOUT` (`POST /auth/logout`, appelé par `AuthContext.logout` avec le token en en-tête et un corps `{}` — `null` est refusé par express.json), `PASSWORD_CHANGED` / `PASSWORD_CHANGE_FAILED`, `PASSWORD_RESET_REQUESTED` (compte trouvé ou non, `throttled`, `rateLimited`), `PASSWORD_RESET_CONFIRMED`, `PASSWORD_RESET_INVALID_LINK`, `PASSWORD_RESET_BY_ADMIN`, `SUPPLIER_REGISTERED`, `USER_CREATED` / `USER_UPDATED` (avant/après) / `USER_ACTIVATED` / `USER_DEACTIVATED` / `USER_DELETED`
- Objets autres qu'un compte : `audit(req, AUDIT.X, { entity: { type, id, label }, details, oldValue, enterpriseId })` → `entity_type` / `entity_ref` (migration 21) / `new_value._label` ; filtres `entityType` + `entityRef` (historique d'un objet). Tracés : budget (avant / après), rôles et permissions, entreprise, fournisseur (champs suivis), banque, préqualification, documents, réquisition / PO supprimés, PO rejeté, GRN annulé, facture rejetée, paiement approuvé / statut, sortie annulée, ajustement, inventaire validé, tentatives refusées (`SOD_VIOLATION_BLOCKED`, `TASK_COMPLETION_DENIED`, `PAYMENT_BLOCKED`, `INVOICE_DUPLICATE_BLOCKED`, aussi dans « Échecs et blocages »). Écran : onglets contrôle interne / données sensibles / annulations et paiements, colonne « Objet concerné »
- Toute nouvelle action sensible sur un compte → ajouter une constante `AUDIT` et un appel `audit()` (+ libellés `audit.actions.*` côté client et `auditActions.*` côté backend). `created_at` est un TIMESTAMP sans fuseau, écrit dans le fuseau de la session PostgreSQL : le relire avec `created_at AT TIME ZONE current_setting('TimeZone')` (comme `AuditLogModel`), filtrer par `id` dans les scripts. Tests : `tests/api/audit.spec.js`
- **Écran** (migration `20_audit_log_access.sql`, permission `VIEW_AUDIT_LOGS` : `prof_admin` = son entreprise, `prof_superadmin` = toute la plateforme, `/audit-logs` dans `SUPERADMIN_PATHS`) : `GET /audit-logs` (filtres `action`, `actions`, `q` email/nom/IP, `userId`, `from` / `to` en jours `APP_TIMEZONE`, `failuresOnly`, `enterpriseId` / `none` pour le super admin ; `summary` par action), `GET /audit-logs/export` (Excel, 20 000 lignes, tracé `AUDIT_LOG_EXPORTED`). Front : `Admin/AuditLogList` (`/admin/audit`, onglets par groupe, détail avant / après). Tests : `tests/api/audit-log-screen.spec.js`

## Connexion — anti force brute

- `utils/loginThrottle.js` (en mémoire, **seuls les échecs comptent**, fenêtre glissante `LOGIN_WINDOW_MINUTES` = 15) : compte + IP `LOGIN_MAX_FAILURES_PER_ACCOUNT` (5) ; IP tous comptes `LOGIN_MAX_FAILURES_PER_IP` (100 — un bureau sort souvent par une seule IP publique) ; compte toutes IP `LOGIN_MAX_FAILURES_PER_ACCOUNT_GLOBAL` (50). Clé compte + IP : un tiers ne peut pas bloquer le compte de quelqu'un depuis ailleurs. Connexion réussie → compteur compte + IP remis à zéro. IP = `clientIp` (`utils/auditLog.js`, X-Forwarded-For seulement depuis un proxy local/privé) — jamais `req.ip` (derrière le proxy, tout le monde aurait la même IP)
- Bloqué : le mot de passe n'est pas vérifié → **429** `{ code: 'TOO_MANY_ATTEMPTS', retryAfter }` + en-tête `Retry-After`, audit `LOGIN_BLOCKED` (`scope` ACCOUNT / IP). Client : `login` appelé avec `skipErrorToast`, message traduit `auth.tooManyAttempts` (minutes restantes)
- Échec : message **unique** « Email ou mot de passe incorrect » et même durée (comparaison bcrypt fictive `DUMMY_PASSWORD_HASH` si le compte n'existe pas) — pas d'énumération des comptes ; le motif précis reste dans l'audit `LOGIN_FAILED`
- Tests : `tests/api/login-throttle.spec.js` (comptes jetables) ; un test qui échoue volontairement une connexion doit utiliser un **email unique** (un email fixe finirait bloqué après 5 passages en 15 min)

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

- Contenu de `Dashboard/Dashboard.jsx` : sélecteur de période (semaine / mois / année), `KpiCards`, `PendingTasksByProfile`, `AlertsSection`, `StatsCards`. **La section « Analyse des données » (`ChartsSection` : graphiques par département, tendance, statuts, méthodes, fournisseurs, budget) a été retirée à la demande** — le composant reste dans le dépôt mais n'est plus affiché ; `GET /dashboard` ne calcule plus `chartData` (toujours disponible via `GET /dashboard/charts`)

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
2. `renderPdf(html, options)` (`utils/pdfRenderer.js` : un Chrome partagé, une page par document, relancé s'il s'arrête ; `closeBrowser()` à l'arrêt du serveur) — ne plus appeler `puppeteer.launch` dans un service
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
10. ✅ **Confirmation fournisseur** (`Activity_SupplierConfirmation`, 2026-10-09) — portail fournisseur « Mes commandes » ou saisie par les achats

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

## Listes déroulantes avec recherche

- **Tout `<select>` de l'interface est un `Common/SearchSelect`** (remplaçant direct : mêmes props, mêmes `<option>` / `<optgroup>` enfants). Un vrai `<select>` invisible reste en place sous le bouton (même `id`, `name`, `ref`, `required`, `data-testid`, `onChange`) : react-hook-form (`register`), la validation du navigateur, les `<label htmlFor>` et les tests Playwright (`selectOption`, `select[name=…]`) fonctionnent sans changement. Le choix écrit dans ce `<select>` et déclenche son événement `change`
- Champ de recherche (sans accents) à partir de 6 options (`searchThreshold`), clavier (↑ ↓ Entrée Échap), liste en portail (`position: fixed`, fonctionne dans les modales). Classes de largeur / marge / flex → conteneur, apparence → bouton
- Seule exception : le sélecteur de langue (`LanguageSwitcher`, variante `select`). Nouveau code : utiliser `SearchSelect` plutôt que `<select>`
- Tests e2e : Vite de test **sans proxy WebSocket** (`/socket.io`), sinon des `ECONNABORTED` arrêtent le serveur Vite en cours de campagne

## Conventions de code
- Backend : CommonJS (require/module.exports), classes pour les models
- Modèles : singleton exporté (`module.exports = new XxxModel()`)
- Transactions DB : `db.withTransaction(async (tx) => …)` (de préférence) ou `db.transaction()` avec `addInsertQuery` / `addUpdateQuery` puis `execute()` — les deux sur une connexion dédiée du pool
- Auth middleware : `authenticate`, `hasPermission('PERMISSION_NAME')`
- Numérotation : REQ-YYYY-NNNN pour réquisitions, PO-YYYY-NNNN pour POs, GRN-YYYY-NNNN, SAN-YYYY-NNNN, INV-YYYY-NNNN, PAY-YYYY-NNNN

## Tests
```
npx playwright test tests/api/      # Tests API backend — avec GoFlow : 237 pass + 1 skip GoFlow (2026-10-10, dont contrôle interne, chaîne de rattachement, rapport quotidien)
npx playwright test tests/e2e/      # Tests navigateur — 60 pass avec GoFlow (2026-10-10 ; le filtre de « Mes tâches » attend des tâches réelles)
```
- Variables d'env : `API_URL` (backend), `APP_URL` (frontend, qui doit tourner ; le port 3000 est parfois pris par le frontend GoFlow)
- **GoFlow local** : conteneur `goflow-app` sur `http://localhost:8080` (`CAMUNDA_URL` / `CAMUNDA_REST_URL`). Sans GoFlow, les tests qui attendent des tâches s'ignorent (skip) au lieu d'échouer
- Un **PO est créé directement en `PO_PENDING`** (pas d'étape brouillon : il part aussitôt en approbation `Activity_POApproval`) et n'est plus modifiable par `PUT` — les tests vérifient ce statut, ils ne « soumettent » plus le PO
- Aiguillage d'approbation **direct selon le montant** (BPMN) : < 25 000 → N1 Manager, < 100 000 → N2 Finance, sinon N3 DG. Le `process_instance_id` arrive juste après la création : relire la réquisition (`refreshProcess`) avant d'attendre une tâche ; `waitForTaskOrStop` s'arrête si le budget est insuffisant. `workflow-extended.spec.js` crée une ligne budgétaire neuve à chaque passage (une ligne réutilisée finit épuisée)
