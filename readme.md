docker compose up --build --force-recreate --no-deps -d --remove-orphans



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