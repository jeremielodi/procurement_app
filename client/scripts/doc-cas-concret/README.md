# Documentation « Cas concret »

Pages HTML ouvertes dans un nouvel onglet depuis le centre d'aide (bouton « ? » → bas du sommaire → « Cas concrets ») :

- `client/public/docs/cas-concret/workflow.html` — cycle d'achat complet, de la réquisition au paiement
- `client/public/docs/cas-concret/stock.html` — gestion de stock au quotidien

Les captures et les PDF sont produits par un **vrai déroulé** dans l'application, avec un utilisateur par profil.
Pour mettre la documentation à jour après une évolution de l'interface, on relance tout :

```bash
cd client
DOC_API_URL=http://localhost:5000/api DOC_APP_URL=http://localhost:3000 npm run doc:cas-concret
```

## Prérequis

- Backend démarré **avec BpmnGo** (le BPMN `ProcurementProcess` déployé) et les workers actifs
- Frontend démarré (Vite ou build servi par le backend) — `DOC_APP_URL`
- `backend/.env` : `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` (création de l'entreprise de démonstration, une seule fois)

## Étapes

| Script | Rôle |
|---|---|
| `1-dataset.mjs` | Jeu de données : entreprise « Démo procureApp » (code `DOC_ENTERPRISE_CODE`, défaut `DEMO`), 10 comptes (un par profil, mot de passe `DOC_PASSWORD`, défaut `Demo1234!`), projet EAU-GOMA et son chef de projet, ligne budgétaire EAU-01, dépôts MAG-GOMA / MAG-NORD, 4 articles, fournisseur inscrit sur le portail. **Réutilisable** : ce qui existe est repris, le reste est créé |
| `2-workflow.mjs` | Cycle d'achat (réquisition de 1 200 USD → paiement) + rendu des 5 PDF |
| `3-stock.mjs` | Bon d'entrée (don), demande au magasin, sortie, affectation / retour d'ordinateur, transfert, inventaire, rapports |
| `4-pages.mjs` | Captures PNG → WebP dans `client/public/docs/cas-concret/img/`, puis génération des deux pages (**les textes sont dans ce fichier**) |

Lancer une partie seulement : `node scripts/doc-cas-concret/run-all.mjs workflow` (ou `stock`, ou `pages` pour ne régénérer que les pages à partir des captures existantes).

Captures brutes et état (ids créés) : `scripts/doc-cas-concret/.captures/` (ignoré par git, `DOC_CAPTURES_DIR` pour un autre dossier).

## Bon à savoir

- Chaque passage ajoute une nouvelle réquisition, de nouveaux mouvements de stock… dans l'entreprise de démonstration : les listes s'allongent. Pour des listes « propres », utiliser une base neuve, ou une autre entreprise : `DOC_ENTERPRISE_CODE=DEMO2 DOC_EMAIL_DOMAIN=demo2-procureapp.org` (les emails apparaissent sur les captures).
- Les PDF sont rendus avec pdf.js (`pdfjs-dist`) : le visualiseur PDF du navigateur ne s'affiche pas en mode headless.
- Écran modifié (libellé de bouton, `data-testid`) : ajuster le script de l'étape, puis le texte correspondant dans `4-pages.mjs`.
- Les pages sont en français ; le lien du centre d'aide est traduit (`help.cases.*`).
