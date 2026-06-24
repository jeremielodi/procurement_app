# WWF Procure — Contexte Projet

## Ce que fait l'application
Système de gestion des achats électroniques (e-procurement) couvrant le cycle complet :
Réquisition → Approbation → PO → GRN → SAN → Facture → Paiement

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
| `Activity_RFPProcess` | Call for Tenders / RFP | `procurement` | Modale TaskList |
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

## Génération PDF

### Pattern commun (Puppeteer + Handlebars)
Tous les PDFs suivent le même pattern :
1. Template HTML avec expressions Handlebars compilées à l'exécution (pas de fichiers `.hbs`)
2. `puppeteer.launch(getBrowserOptions())` → `page.setContent(html)` → `page.pdf({ format: 'A4' })`
3. Réponse : `res.set('Content-Type', 'application/pdf')` + `res.end(pdfBuffer)`
4. Frontend : `api.get(url, { responseType: 'blob' })` → `URL.createObjectURL(blob)` → `<embed key={blobUrl}>`

### Services PDF existants
| Module | Fichier service | Entrée |
|---|---|---|
| Réquisition (liste) | `RequisitionExportService.js` | tableau de réquisitions |
| Réquisition (détail) | `RequisitionExportService.generateRequisitionDetailPDF()` | réquisition unique |
| Purchase Order | `PurchaseOrderExportService.js` | objet PO avec items + approvals |
| Paiement | inline dans `PaymentController.generatePDF()` | objet paiement |

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
| `prof_finance` | `finance` | Approbation N2 (25k–100k) + Factures |
| `prof_dg` | `dg` | Approbation N3 (≥ 100 000) |
| `prof_management` | `management` | Approbation PO |
| `prof_procurement` | `procurement` | Création PO, méthode d'achat |
| `prof_logistic` | `logistic` | Réception marchandises (GRN) |
| `prof_requester` | `requester` | Création réquisition, SAN |

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
