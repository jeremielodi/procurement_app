# procureApp

Plateforme multi-entreprise de gestion des achats (e-procurement) : réquisition → approbation → bon de commande → réception (GRN / SAN) → facture → paiement, avec portail fournisseur et appels d'offres. Le circuit d'approbation est piloté par un moteur de workflow **GoFlow** (Camunda).

- [Installation avec Docker](#installation-avec-docker)
- [Variables d'environnement](#variables-denvironnement-backendenv)
- [Mise en production (HTTPS)](#mise-en-production-https)
- [Mise à jour](#mise-à-jour)
- [Sauvegarde et restauration](#sauvegarde-et-restauration)
- [Commandes utiles](#commandes-utiles)
- [Dépannage](#dépannage)
- [Le cycle procure-to-pay](#le-cycle-procure-to-pay)

---

## Installation avec Docker

### Ce que contient le déploiement

`docker compose` démarre trois conteneurs sur le réseau `wwf_network` :

| Conteneur | Image | Rôle | Port exposé | Volume (données persistantes) |
|---|---|---|---|---|
| `wwf_app` | construite depuis `dockerfile` | API Node.js + interface React (servie par le même serveur) | `5000` | `wwf_uploads_data`, `wwf_logs_data` |
| `wwf_postgres` | `postgres:16` | Base de données | `5435` → 5432 | `wwf_postgres_data` |
| `wwf_minio` | `cgr.dev/chainguard/minio` | Stockage des fichiers (pièces jointes, logos), bucket privé et versionné | `127.0.0.1:9000` (API), `127.0.0.1:9001` (console) | `wwf_minio_data` |

Le moteur de workflow **GoFlow n'est pas inclus** : l'application se connecte à une instance GoFlow existante (variables `CAMUNDA_*`).

Toute la configuration est dans **un seul fichier : `backend/.env`**. Il est lu par les trois conteneurs (`env_file`), n'est jamais copié dans l'image et n'est pas versionné dans git.

### Prérequis

- Docker Engine 24+ avec le plugin **Docker Compose v2** (`docker compose version`)
- 2 Go de RAM minimum (Chromium génère les PDF), 10 Go de disque
- Une instance **GoFlow** accessible depuis le serveur, avec le processus `backend/src/bpmn/procurement-workflow.bpmn` déployé (clé `ProcurementProcess`)
- Un compte **SMTP** pour l'envoi des emails (Gmail avec mot de passe d'application, ou serveur SMTP de l'entreprise)
- En production : un nom de domaine pointant vers le serveur (pour le HTTPS)

### 1. Récupérer le code

```bash
git clone <url-du-depot> procureapp
cd procureapp
```

### 2. Créer le fichier de configuration

```bash
cp backend/.env_sample backend/.env
```

Puis modifier `backend/.env` : au minimum les variables marquées **À changer** dans les tableaux ci-dessous (mots de passe, `JWT_SECRET`, `APP_URL`, SMTP, GoFlow).

Pour générer des secrets aléatoires :

```bash
openssl rand -base64 48        # JWT_SECRET
openssl rand -hex 24           # mots de passe PostgreSQL / MinIO / super admin
```

> Évitez les caractères `#`, `$`, espaces et guillemets dans les valeurs générées à la main : ils sont interprétés différemment selon les outils. Si une valeur contient un espace, entourez-la de guillemets simples (`SMTP_PASS='abcd efgh ijkl mnop'`).

### 3. Construire et démarrer

```bash
docker compose up -d --build
```

Le premier démarrage prend quelques minutes (construction du client React, installation de Chromium). Au **premier lancement uniquement** (volume PostgreSQL vide) :

1. PostgreSQL exécute les scripts du dossier `database/` par ordre alphabétique : schéma, fonctions, triggers, vues, migrations `05` à `09` (dont les localisations et catégories de marché initiales), puis les données de référence (`data.sql` : profils, permissions, devise, première entreprise « World Wide Fund for Nature »).
2. L'application crée le bucket MinIO, puis deux comptes s'ils n'existent pas :
   - **Administrateur de la première entreprise** : `admin@procurement.com` / `Admin123!`
   - **Super administrateur de la plateforme** : `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`

### 4. Vérifier

```bash
docker compose ps                      # les 3 conteneurs « Up », wwf_app « healthy » après ~40 s
curl http://localhost:5000/health      # {"status":"OK",...}
docker compose logs -f app             # suivre le démarrage
```

Ouvrir `http://<serveur>:5000` (ou l'adresse définie dans `APP_URL`).

### 5. Premiers pas après l'installation

1. **Changer immédiatement les mots de passe par défaut** : se connecter avec `admin@procurement.com` / `Admin123!`, puis *Mon profil → Changer le mot de passe*. Faire de même avec le super admin.
2. Avec le **super admin** : créer les entreprises clientes et leur premier administrateur (*Entreprises*).
3. Avec l'**administrateur d'une entreprise** : renseigner *Mon entreprise* (logo, adresse, NIF, RCCM), créer les départements, projets, budgets et utilisateurs, attribuer les profils (manager, finance, dg, procurement, logistic, requester, management).
4. Tester l'envoi d'emails avec *Mot de passe oublié* sur un compte de test.

Données de démonstration (facultatif, **installation de test uniquement**) — le script passe par l'API, depuis un poste avec Node 18+ :

```bash
API_URL=http://<serveur>:5000/api ADMIN_EMAIL=admin@procurement.com ADMIN_PASSWORD='<mot de passe admin>' node database/seed-demo.js
```

---

## Variables d'environnement (`backend/.env`)

Légende : **À changer** = valeur à personnaliser avant toute mise en production · *Optionnel* = la valeur par défaut convient en général.

### Base de données

| Variable | Statut | Exemple / défaut | Description |
|---|---|---|---|
| `POSTGRES_DB` | Optionnel | `wwf_procurement` | Nom de la base créée par le conteneur PostgreSQL au premier démarrage. |
| `POSTGRES_USER` | Optionnel | `camunda` | Utilisateur PostgreSQL créé au premier démarrage. |
| `POSTGRES_PASSWORD` | **À changer** | `camunda` | Mot de passe de cet utilisateur. |
| `DB_NAME` | Optionnel | `wwf_procurement` | Base utilisée par l'application. **Doit être égal à `POSTGRES_DB`.** |
| `DB_USER` | Optionnel | `camunda` | **Doit être égal à `POSTGRES_USER`.** |
| `DB_PASSWORD` | **À changer** | — | **Doit être égal à `POSTGRES_PASSWORD`.** |
| `DB_HOST`, `DB_PORT` | Ignorées sous Docker | `localhost`, `5432` | Forcées à `postgres` / `5432` par `docker-compose.yml`. Servent seulement à lancer le backend hors Docker. |

> ⚠️ Les variables `POSTGRES_*` ne sont prises en compte **qu'à la création du volume**. Pour changer le mot de passe d'une base existante : `docker exec -it wwf_postgres psql -U <user> -d <base> -c "ALTER USER <user> PASSWORD '<nouveau>';"`, puis mettre à jour `POSTGRES_PASSWORD` **et** `DB_PASSWORD`, et `docker compose up -d`.

### Serveur et sécurité

| Variable | Statut | Exemple / défaut | Description |
|---|---|---|---|
| `APP_URL` | **À changer** | `https://procure.mondomaine.com` | Adresse publique de l'application, sans `/` final. Utilisée dans **tous les liens des emails** (tâches à traiter, appels d'offres, mot de passe oublié). Si elle commence par `https://`, les en-têtes de sécurité HTTPS (HSTS, `upgrade-insecure-requests`) sont activés — **ne mettre `https://` que si un reverse proxy HTTPS est réellement en place**, sinon page blanche. Défaut : `http://localhost:5000`. |
| `JWT_SECRET` | **À changer** | chaîne aléatoire de 48+ caractères | Clé de signature des sessions. Quiconque la connaît peut se connecter sous n'importe quel compte. La changer déconnecte tous les utilisateurs. |
| `FRONTEND_URL` | Optionnel | `http://localhost:3000` | Origine autorisée (CORS) pour le serveur de développement Vite. Sans effet en production (interface et API sur la même adresse). |
| `APP_TIMEZONE` | Optionnel | `Africa/Kinshasa` | Fuseau horaire des dates dans les emails et PDF (ouverture / clôture des appels d'offres…). |
| `PORT`, `NODE_ENV` | Ignorées sous Docker | `5000`, `production` | Forcées par `docker-compose.yml`. Pour exposer un autre port, modifier `ports:` (`"8080:5000"`). |
| `DEBUG` | Optionnel | `none` | Logs détaillés (bibliothèque `debug`) : `task-listener:*`, `*`… |

### Super administrateur de la plateforme

| Variable | Statut | Exemple / défaut | Description |
|---|---|---|---|
| `SUPERADMIN_EMAIL` | **À changer** | `superadmin@procureapp.com` | Compte qui gère les entreprises, rôles et permissions (aucun accès aux achats). |
| `SUPERADMIN_PASSWORD` | **À changer** | défaut : `SuperAdmin123!` | Mot de passe initial. |

> Ces deux variables ne servent qu'à la **création** du compte au premier démarrage. Les modifier ensuite ne change pas le compte existant : utiliser *Mon profil → Changer le mot de passe*.

### Emails (SMTP)

| Variable | Statut | Exemple / défaut | Description |
|---|---|---|---|
| `SMTP_HOST` | **À changer** | `smtp.gmail.com` | Serveur SMTP. |
| `SMTP_PORT` | Optionnel | `587` | `587` (STARTTLS) ou `465` (TLS direct, activé automatiquement). |
| `SMTP_USER` | **À changer** | `notifications@mondomaine.com` | Identifiant SMTP. |
| `SMTP_PASS` | **À changer** | `'abcd efgh ijkl mnop'` | Mot de passe SMTP. Pour Gmail : un **mot de passe d'application** (compte Google → Sécurité → Validation en deux étapes → Mots de passe des applications) ; les espaces sont acceptés. |
| `SMTP_FROM` | **À changer** | `notifications@mondomaine.com` | Adresse d'expédition. Avec Gmail, elle doit être celle du compte (ou un alias vérifié). |
| `CONTACT_EMAIL` | Optionnel | `jeremielodi@gmail.com` | Destinataire des messages du formulaire de contact du site vitrine (réponse directe au visiteur grâce au Reply-To). |

### Workflow GoFlow (Camunda)

| Variable | Statut | Exemple / défaut | Description |
|---|---|---|---|
| `CAMUNDA_URL` | **À changer** | `http://goflow.mondomaine.com:8081` | Adresse de base de GoFlow (flux d'événements des tâches, santé). |
| `CAMUNDA_REST_URL` | **À changer** | `http://goflow.mondomaine.com:8081/engine-rest` | API REST du moteur (démarrage des processus, tâches, workers). En général `CAMUNDA_URL` + `/engine-rest`. |
| `CAMUNDA_USERNAME` | **À changer** | `admin@goflow.com` | Compte GoFlow utilisé par l'application. |
| `CAMUNDA_PASSWORD` | **À changer** | — | Mot de passe de ce compte. |
| `CAMUNDA_BEARER_TOKEN` | *Optionnel* | — | Jeton d'accès, si GoFlow est configuré pour l'authentification par jeton plutôt que par identifiant / mot de passe. |
| `PROCUREMENT_BPMN_PROCESS` | Optionnel | `ProcurementProcess` | Clé du processus BPMN déployé dans GoFlow. |

> Depuis un conteneur, `localhost` désigne le conteneur lui-même : si GoFlow tourne sur le même serveur, utiliser l'IP du serveur, ou `http://host.docker.internal:8081` (Docker Desktop).

### Stockage des fichiers (MinIO)

| Variable | Statut | Exemple / défaut | Description |
|---|---|---|---|
| `MINIO_ROOT_USER` | Optionnel | `procureapp` | Identifiant administrateur de MinIO, utilisé aussi par l'application. |
| `MINIO_ROOT_PASSWORD` | **À changer** | 32 caractères aléatoires | Mot de passe MinIO (8 caractères minimum). Comme pour PostgreSQL, il est fixé à la **première** initialisation du volume `wwf_minio_data`. |
| `MINIO_BUCKET` | Optionnel | `procureapp` | Bucket créé au démarrage (privé, versionné). |
| `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` | *Optionnel* | — | Identifiants dédiés à l'application, si vous ne voulez pas qu'elle utilise le compte root. |
| `STORAGE_DRIVER`, `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_USE_SSL` | Ignorées sous Docker | `local`, `localhost`, `9000`, `false` | Forcées à `minio` / `minio` / `9000` / `false` par `docker-compose.yml`. Servent hors Docker (`local` = disque, dossier `UPLOAD_DIR`). |
| `UPLOAD_DIR` | Ignorée sous Docker | `/app/uploads` | Ancien stockage disque, conservé pour la migration vers MinIO (`scripts/migrate-uploads-to-minio.js`). |

### Récapitulatif : le minimum à modifier

```dotenv
POSTGRES_PASSWORD=<secret>          # et DB_PASSWORD identique
DB_PASSWORD=<secret>
JWT_SECRET=<secret-long>
APP_URL=https://procure.mondomaine.com
SUPERADMIN_EMAIL=admin.plateforme@mondomaine.com
SUPERADMIN_PASSWORD=<secret>
SMTP_HOST=… SMTP_USER=… SMTP_PASS=… SMTP_FROM=…
CAMUNDA_URL=… CAMUNDA_REST_URL=… CAMUNDA_USERNAME=… CAMUNDA_PASSWORD=…
MINIO_ROOT_PASSWORD=<secret>
```

Après toute modification de `backend/.env` : `docker compose up -d` (recrée les conteneurs concernés ; un simple `docker compose restart` **ne relit pas** le fichier).

---

## Mise en production (HTTPS)

Placer un reverse proxy HTTPS devant le port 5000. Exemple avec **Caddy** (certificat Let's Encrypt automatique), `/etc/caddy/Caddyfile` :

```
procure.mondomaine.com {
    reverse_proxy 127.0.0.1:5000
}
```

Caddy gère aussi les WebSockets (notifications temps réel). Avec **Nginx**, ne pas oublier les en-têtes `Upgrade` / `Connection` pour `/socket.io/`.

Puis :

1. `APP_URL=https://procure.mondomaine.com` dans `backend/.env`, puis `docker compose up -d`.
2. Fermer l'accès direct au port 5000 depuis l'extérieur (pare-feu), ou le lier à la boucle locale dans `docker-compose.yml` : `"127.0.0.1:5000:5000"`.
3. De même pour PostgreSQL (`"127.0.0.1:5435:5432"`) si la base n'a pas à être joignable depuis l'extérieur. MinIO est déjà limité à `127.0.0.1`.

---

## Mise à jour

```bash
git pull
docker compose up -d --build
```

Les scripts SQL de `database/` ne sont exécutés automatiquement **qu'à la création de la base**. Sur une base existante, appliquer les nouvelles migrations à la main (elles sont idempotentes, on peut les relancer) :

```bash
for f in 05_supplier_portal 06_budget_access 07_multi_enterprise 08_supplier_prequalification 09_tender_invitations 10_user_language 11_reference_translations 12_audit_logs 13_stock_management 14_stock_issues 15_stock_equipment; do
  docker exec -i wwf_postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < database/$f.sql
done
```

> `08_supplier_prequalification.sql` et `09_tender_invitations.sql` ajoutent la préqualification des fournisseurs, la vérification des documents et les appels d'offres sur invitation : à appliquer **avant** de démarrer la nouvelle version de l'application.

---

## Sauvegarde et restauration

**Base de données**

```bash
# Sauvegarde
docker exec wwf_postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > procureapp_$(date +%F).dump
# Restauration (base existante écrasée)
docker exec -i wwf_postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < procureapp_2026-10-05.dump
```

**Fichiers (MinIO)** : sauvegarder le volume `wwf_minio_data` :

```bash
docker run --rm -v wwf_minio_data:/data -v "$PWD":/backup alpine tar czf /backup/minio_$(date +%F).tar.gz -C /data .
```

Conserver aussi une copie de `backend/.env` en lieu sûr (il contient les secrets).

> `docker compose down -v` **supprime les volumes, donc toutes les données**. Pour arrêter sans rien perdre : `docker compose down` (sans `-v`).

---

## Commandes utiles

```bash
docker compose ps                         # état des conteneurs
docker compose logs -f app                # logs de l'application
docker compose restart app                # redémarrer l'application (sans relire .env)
docker compose up -d                      # appliquer une modification de backend/.env
docker exec -it wwf_postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'   # console SQL
docker exec wwf_app node scripts/migrate-uploads-to-minio.js --dry-run              # migration disque → MinIO
```

Console MinIO : `http://127.0.0.1:9001` depuis le serveur (ou tunnel SSH : `ssh -L 9001:127.0.0.1:9001 user@serveur`), identifiants `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`.

---

## Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| Page blanche, `ERR_SSL_PROTOCOL_ERROR` dans la console du navigateur | `APP_URL` commence par `https://` alors que le site est servi en `http://` | Mettre l'adresse réelle dans `APP_URL` (ou installer le reverse proxy HTTPS), puis `docker compose up -d`. |
| Les liens des emails pointent vers `localhost` | `APP_URL` absent ou non relu | Définir `APP_URL`, puis `docker compose up -d` (pas `restart`). Un avertissement apparaît au démarrage dans `docker compose logs app`. |
| `wwf_app` redémarre en boucle, `password authentication failed` | `DB_PASSWORD` ≠ mot de passe réel de la base | Aligner `DB_*` sur `POSTGRES_*` ; si le volume existait déjà avec un autre mot de passe, voir la note de la section *Base de données*. |
| Aucun email envoyé (`EmailNotification : Error occurred` dans les logs) | Identifiants SMTP refusés | Pour Gmail : mot de passe d'application (pas le mot de passe du compte), `SMTP_FROM` = adresse du compte. |
| « Compte non rattaché à une entreprise » à la connexion | Utilisateur sans entreprise | Le recréer depuis un administrateur d'entreprise, ou relancer `07_multi_enterprise.sql` (rattache les comptes orphelins à la première entreprise). |
| Les tâches n'apparaissent pas / réquisition bloquée après soumission | GoFlow injoignable ou processus non déployé | Vérifier `CAMUNDA_*` (`curl $CAMUNDA_URL/health` depuis le serveur), et que `ProcurementProcess` est déployé dans GoFlow. |
| Erreur sur les pièces jointes au démarrage (`MinIO`) | MinIO pas encore prêt ou mot de passe différent de celui du volume | L'application réessaie plusieurs fois ; sinon vérifier `docker compose logs minio` et `MINIO_ROOT_*`. |
| PDF non générés | Chromium manquant / mémoire insuffisante | Image construite avec le `dockerfile` fourni ; prévoir 2 Go de RAM. |

---

## Le cycle procure-to-pay

1. La Demande d'Achat : La Requisition (ou Purchase Requisition)
Tout commence lorsqu'un employé ou un département (par exemple, la maintenance, le marketing ou l'informatique) exprime un besoin (ex: des ordinateurs, des matières premières, une prestation de conseil).

Création de la Requisition : L'employé remplit un formulaire électronique (souvent dans un logiciel ERP comme SAP, Oracle ou Coupa) détaillant la nature du produit, la quantité, l'estimation du prix et le projet ou budget associé.

Le Circuit d'Approbation : C'est une étape clé. La demande n'est pas directement envoyée au fournisseur. Elle suit un workflow interne de validation :

Le manager direct valide le besoin.

Le département financier vérifie que le budget est disponible.

Si le montant est très élevé, la direction générale peut être sollicitée.

2. Le Bon de Commande : Le Purchase Order (PO)
Une fois la requisition officiellement approuvée en interne, elle est transmise au département des Achats (Procurement).

Transformation en PO : Les acheteurs vérifient si un contrat existe déjà avec un fournisseur privilégié. Si c'est le cas, la demande d'achat est automatiquement convertie en Purchase Order (PO).

Envoi au Fournisseur : Le PO est un document juridique officiel envoyé au fournisseur. Il l'engage à livrer les biens ou services aux conditions indiquées (prix, délais, incoterms). Le fournisseur doit généralement envoyer une "confirmation de commande" pour valider l'accord.

3. La Réception des Biens ou Services : Le Goods Receipt (GR)
Lorsque le fournisseur livre la marchandise ou réalise la prestation :

Le contrôle : Le quai de déchargement ou l'employé demandeur vérifie que ce qui est livré correspond exactement à ce qui a été commandé (quantité correcte, absence de dommages).

L'enregistrement (GR) : On saisit un Goods Receipt (Bon de réception) dans le système. C'est la preuve informatique que l'entreprise a bien reçu la commande.

4. La Facturation et le "Rapprochement à 3 voies" (3-Way Matching)
Le fournisseur envoie ensuite sa facture (Invoice) au service comptabilité. Avant de payer, le système ou le comptable effectue une vérification cruciale appelée le rapprochement à 3 voies :

Pour que la facture soit validée pour le paiement, ces trois documents doivent parfaitement concorder :

Le Purchase Order (PO) : Ce que l'on avait dit qu'on achèterait (et à quel prix).

Le Goods Receipt (GR) : Ce que l'on a réellement reçu.

L'Invoice : Ce que le fournisseur nous facture.

Si les montants ou les quantités diffèrent (ex: facturé pour 100 unités mais seulement 80 reçues), la facture est bloquée pour litige. Si tout est correct, la facture est approuvée.

5. Le Paiement (Payment)
Dernière étape du cycle : le département de la comptabilité fournisseurs ordonne le paiement (par virement bancaire, la plupart du temps) selon les conditions de paiement négociées (ex: à 30 jours, 45 jours fin de mois, etc.).

En résumé : Pourquoi ce processus est-il si strict ?
Bien que ce flux puisse sembler lourd, il est essentiel pour les entreprises afin de :

Contrôler les coûts : Éviter que les employés achètent tout et n'importe quoi sans l'accord du management.

Lutter contre la fraude : S'assurer qu'on ne paie que des factures correspondant à des biens réellement commandés et reçus.

Négocier : Permettre aux acheteurs de regrouper les commandes auprès de fournisseurs partenaires pour obtenir de meilleurs tarifs.