// Étape 4 — pages « Cas concret » : captures converties en WebP dans client/public/docs/cas-concret/img/ puis
// génération de workflow.html et stock.html (textes ci-dessous, en français). Ouvertes depuis le centre d'aide.
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { CFG } from './lib.mjs';

const DIR = CFG.site;

/** Captures PNG (CFG.captures/<workflow|stock>) → WebP (img/<workflow|stock>), anciennes images retirées */
async function convertCaptures() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let total = 0, count = 0;
  for (const dir of ['workflow', 'tender', 'stock']) {
    const src = path.join(CFG.captures, dir);
    if (!fs.existsSync(src)) { console.log('  (pas de captures', dir, ': images existantes conservées)'); continue; }
    const dst = path.join(DIR, 'img', dir);
    fs.rmSync(dst, { recursive: true, force: true });
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src).filter(f => f.endsWith('.png')).sort()) {
      const b64 = await page.evaluate(async (data) => {
        const img = new Image(); img.src = data; await img.decode();
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        return c.toDataURL('image/webp', 0.82).split(',')[1];
      }, 'data:image/png;base64,' + fs.readFileSync(path.join(src, f)).toString('base64'));
      const buf = Buffer.from(b64, 'base64');
      fs.writeFileSync(path.join(dst, f.replace(/\.png$/, '.webp')), buf);
      total += buf.length; count += 1;
    }
  }
  await browser.close();
  console.log(`• ${count} images WebP (${Math.round(total / 1024)} Ko)`);
}
await convertCaptures();
const missing = [];
// Les cas concrets (ordre de la navigation)
const PAGES = [
  { file: 'workflow.html', label: "Cycle d'achat complet" },
  { file: 'appel-offres.html', label: "Appel d'offres" },
  { file: 'stock.html', label: 'Gestion de stock' },
];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// **gras** dans les textes
const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

const PROFILES = {
  'Demandeur': 'p-req', 'Chef de projet': 'p-pm', 'Agent achats': 'p-proc', 'Réviseur des bons de commande': 'p-rev',
  'Manager niveau 1': 'p-mgr', 'Manager niveau 2': 'p-mgr', 'Fournisseur': 'p-sup', 'Logistique': 'p-log', 'Magasinier': 'p-store', 'Finance': 'p-fin',
  'Directeur général': 'p-dg', 'Administrateur': 'p-admin', 'Document': 'p-doc', 'Tous': 'p-doc',
};

function page({ file, imgDir = 'workflow', title, subtitle, intro, cast, phases, rules, other }) {
  let n = 0;
  const toc = phases.map((ph, i) => `<li><a href="#phase-${i + 1}">${esc(ph.title)}</a></li>`).join('');
  const body = phases.map((ph, i) => `
  <section class="phase" id="phase-${i + 1}">
    <h2><span class="phase-num">${i + 1}</span>${esc(ph.title)}</h2>
    ${ph.intro ? `<p class="phase-intro">${rich(ph.intro)}</p>` : ''}
    ${ph.steps.map(s => {
      n += 1;
      const img = `img/${s.dir || imgDir}/${s.img}.webp`;
      if (!fs.existsSync(path.join(DIR, img))) missing.push(img);
      return `
    <article class="step" id="etape-${n}">
      <header>
        <span class="step-num">${n}</span>
        <div>
          <h3>${esc(s.title)}</h3>
          <div class="who"><span class="badge ${PROFILES[s.profile] || 'p-doc'}">${esc(s.profile)}</span>${s.user ? `<span class="user">${esc(s.user)}</span>` : ''}</div>
        </div>
      </header>
      <div class="step-body">
        <div class="text">
          ${(s.text || []).map(p => `<p>${rich(p)}</p>`).join('')}
          ${s.points ? `<ul>${s.points.map(p => `<li>${rich(p)}</li>`).join('')}</ul>` : ''}
          ${s.note ? `<p class="note">${rich(s.note)}</p>` : ''}
        </div>
        <a class="shot${s.doc ? ' doc' : ''}" href="${img}" target="_blank" rel="noopener" title="Agrandir la capture">
          <img src="${img}" alt="${esc(s.title)}" loading="lazy">
        </a>
      </div>
    </article>`;
    }).join('')}
  </section>`).join('');

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — procureApp</title>
<link rel="icon" href="/images/procureapp-logo.svg">
<link rel="stylesheet" href="cas-concret.css">
</head>
<body>
<header class="top">
  <div class="wrap top-inner">
    <a class="brand" href="/"><img src="/images/procureapp-logo.svg" alt="">procureApp</a>
    <nav>${PAGES.map(p => `<a href="${p.file}"${p.file === file ? ' aria-current="page"' : ''}>${esc(p.label)}</a>`).join('')}</nav>
  </div>
</header>
<main class="wrap">
  <div class="hero">
    <p class="kicker">Cas concret</p>
    <h1>${esc(title)}</h1>
    <p class="subtitle">${rich(subtitle)}</p>
  </div>
  <div class="layout">
    <aside class="toc">
      <div class="toc-title">Sommaire</div>
      <ol>
        <li><a href="#scenario">Le scénario</a></li>
        ${toc}
        ${rules ? '<li><a href="#regles">Règles à retenir</a></li>' : ''}
      </ol>
      <div class="toc-other">Autres cas concrets :${PAGES.filter(p => p.file !== file).map(p => `<a href="${p.file}">${esc(p.label)} →</a>`).join('')}</div>
    </aside>
    <div class="content">
      <section id="scenario" class="scenario">
        <h2>Le scénario</h2>
        ${intro.map(p => `<p>${rich(p)}</p>`).join('')}
        <table class="cast">
          <thead><tr><th>Personne</th><th>Profil</th><th>Ce qu'elle fait dans ce cas</th></tr></thead>
          <tbody>${cast.map(([who, profile, does]) => `<tr><td><strong>${esc(who)}</strong></td><td><span class="badge ${PROFILES[profile] || 'p-doc'}">${esc(profile)}</span></td><td>${rich(does)}</td></tr>`).join('')}</tbody>
        </table>
        <p class="hint">Cliquez sur une capture pour l'ouvrir en grand. Données de démonstration (entreprise « Démo procureApp »).</p>
      </section>
      ${body}
      ${rules ? `<section id="regles" class="phase rules"><h2>Règles à retenir</h2>
        <table class="cast"><thead><tr><th>Règle</th><th>Ce que fait procureApp</th></tr></thead>
        <tbody>${rules.map(([r, d]) => `<tr><td><strong>${esc(r)}</strong></td><td>${rich(d)}</td></tr>`).join('')}</tbody></table></section>` : ''}
      <footer class="end">procureApp — documentation « cas concret ». Pour l'aide détaillée de chaque écran, utilisez le bouton « ? » de l'application.</footer>
    </div>
  </div>
</main>
</body>
</html>
`;
  fs.writeFileSync(path.join(DIR, file), html);
  console.log('•', file, n, 'étapes');
}

// ─────────────────────────────────────────────────────────────────────────────
// Cycle d'achat complet
// ─────────────────────────────────────────────────────────────────────────────
page({
  file: 'workflow.html',
  title: 'Cycle d\'achat complet, de la réquisition au paiement',
  subtitle: 'Une demande de fournitures de bureau de **1 200 USD** suivie de bout en bout : chaque personne, son profil, l\'écran qu\'elle utilise et l\'action qu\'elle fait.',
  other: { href: 'stock.html', label: 'Voir le cas concret « Gestion de stock »' },
  intro: [
    'Marie Bahati travaille sur le projet **Eau potable Goma (EAU-GOMA)**. Le bureau du projet manque de papier et de toner : elle demande **50 rames de papier A4** (6 USD la rame) et **10 cartouches de toner** (90 USD l\'une), soit **1 200 USD** imputés sur la ligne budgétaire **EAU-01**.',
    'La demande traverse tout le cycle : réquisition → validation du chef de projet → méthode d\'achat → bon de commande → révision → approbation → confirmation du fournisseur → acceptation de la livraison (SAN) → réception (GRN) → facture et rapprochement → paiement. Le moteur de workflow **BpmnGo** crée chaque tâche au bon moment et prévient la bonne personne (notification et email).',
    'Principe à retenir : **une tâche se traite depuis l\'onglet « Tâches » de sa réquisition**. « Mes tâches » donne la vue d\'ensemble et y renvoie ; les formulaires (SAN, réception, facture, paiement) ne s\'ouvrent que depuis la tâche correspondante.',
  ],
  cast: [
    ['Marie Bahati', 'Demandeur', 'Crée la réquisition, puis accepte la livraison (SAN).'],
    ['Jean Mukendi', 'Chef de projet', 'Chef du projet EAU-GOMA (budget holder) : valide la réquisition et **désigne l\'agent achats**.'],
    ['Paul Kasongo', 'Agent achats', 'Choisit la méthode d\'achat, retient le fournisseur, crée le bon de commande.'],
    ['Grace Nsimba', 'Réviseur des bons de commande', 'Vérifie le bon de commande avant son approbation.'],
    ['David Lukusa', 'Manager niveau 1', 'Approuve le bon de commande (montant < 25 000).'],
    ['Bureautique Kivu SARL', 'Fournisseur', 'Confirme la commande sur son portail.'],
    ['Sarah Amani', 'Logistique', 'Enregistre la réception (GRN) et l\'entrée en stock.'],
    ['Joseph Mbala', 'Magasinier', 'Confirme l\'entrée en magasin : il signe le bon de réception.'],
    ['Esther Ilunga', 'Finance', 'Saisit la facture et l\'ordre de paiement.'],
    ['Patrick Tshibanda', 'Directeur général', 'Approuve le paiement.'],
    ['Alice Admin', 'Administrateur', 'Suit l\'activité (tableau de bord, liste des réquisitions).'],
  ],
  phases: [
    { title: 'La demande (réquisition)', steps: [
      { img: '01_connexion', profile: 'Tous', title: 'Se connecter', text: [
        'Chaque personne se connecte avec son email et son mot de passe. La langue (FR / EN) se choisit en haut de la carte et reste mémorisée sur le compte.',
      ], points: ['Après 5 échecs en 15 minutes, la connexion est bloquée temporairement.', 'Après 1 h sans activité, la session se ferme automatiquement (avertissement 2 minutes avant).'] },
      { img: '02_demandeur_tableau-de-bord', profile: 'Demandeur', user: 'Marie Bahati', title: 'Tableau de bord du demandeur', text: [
        'Le tableau de bord montre à chacun ce qui le concerne : ses tâches en attente, ses réquisitions et leur avancement. Le menu de gauche n\'affiche que les modules autorisés par ses profils (encadré « Mes profils BPMN »).',
      ] },
      { img: '03_demandeur_formulaire-requisition', profile: 'Demandeur', user: 'Marie Bahati', title: 'Remplir la réquisition', text: [
        'Menu **Réquisitions → Nouvelle réquisition**. Marie saisit le titre, choisit le **projet** (obligatoire) et, si elle le souhaite, le département, la description, la justification et l\'adresse de livraison.',
        'Dans **Articles**, chaque ligne porte une désignation (le catalogue est proposé pendant la saisie), une **unité** (Rame, Pièce…), une quantité, une fréquence, un prix unitaire et une **ligne budgétaire** du projet (EAU-01).',
      ], points: [
        'En haut à droite : **« Validation : Jean Mukendi (chef de projet) »** — dès le choix du projet, on sait qui validera.',
        '« Formulaire complet 2/2 articles complets » : le bouton « Créer la réquisition » s\'active quand tout est renseigné.',
        'Les articles peuvent aussi être importés depuis Excel / CSV (bouton « Importer »).',
      ], note: 'Seuls les profils Demandeur et Administrateur voient le bouton « Nouvelle réquisition ». Le chef de projet ne peut pas valider sa propre demande.' },
      { img: '04_demandeur_fiche-requisition', profile: 'Demandeur', user: 'Marie Bahati', title: 'Réquisition soumise : vérification du budget', text: [
        'À la création, BpmnGo démarre le circuit. Une étape automatique **vérifie le budget** (disponible sur la ligne EAU-01) puis crée la tâche « Validation du chef de projet ». La fiche affiche le statut, les articles, l\'historique et les boutons **Tâches**, **PDF** et **Voir le workflow**.',
      ], points: ['Tant que personne n\'a pris la tâche en charge, Marie peut **« Retirer pour corriger »** sa demande.', 'Budget insuffisant → tâche « Ajustement budgétaire » pour le demandeur.'] },
      { img: 'P1_pdf_formulaire-demande-achat', doc: true, profile: 'Document', title: 'PDF : formulaire de demande d\'achat', text: [
        'Le bouton **PDF** produit le formulaire de demande d\'achat officiel : identité de l\'entreprise, demandeur et sa fonction, **approbateur (Jean Mukendi, chef de projet)**, livraison, articles, codage budgétaire (code d\'entité, source de financement, projet, fonction, activité) et justification. Les valeurs saisies apparaissent en bleu, comme écrites au stylo ; les signatures enregistrées sont reprises.',
      ] },
    ] },
    { title: 'La validation par le chef de projet', intro: 'La réquisition est validée par **le seul chef du projet** (budget holder), quel que soit le montant. En cas d\'absence, il peut déclarer un intérimaire.', steps: [
      { img: '06_chef-projet_mes-taches', profile: 'Chef de projet', user: 'Jean Mukendi', title: '« Mes tâches » : une validation en attente', text: [
        'Jean reçoit une notification et un email. Dans **Mes tâches**, la carte indique la réquisition concernée ; un clic l\'emmène à l\'onglet **Tâches** de cette réquisition, là où la tâche se traite.',
      ] },
      { img: '07_chef-projet_onglet-taches', profile: 'Chef de projet', user: 'Jean Mukendi', title: 'Onglet « Tâches » de la réquisition', text: [
        'L\'onglet montre la progression du workflow, le montant et les tâches en attente. La tâche « Validation du chef de projet » est **non assignée** : Jean clique sur **« Prendre en charge »**.',
      ] },
      { img: '07b_chef-projet_prendre-en-charge', profile: 'Chef de projet', user: 'Jean Mukendi', title: 'Prendre la tâche en charge', text: [
        'Une confirmation explique l\'effet : la tâche lui est assignée, il est seul à pouvoir la traiter et elle disparaît de la liste des autres membres du groupe. Il pourra la **« Libérer »** s\'il ne peut pas la traiter.',
      ] },
      { img: '08_chef-projet_validation-agent-achats', profile: 'Chef de projet', user: 'Jean Mukendi', title: 'Approuver et désigner l\'agent achats', text: [
        'Après « Prendre en charge », le bouton **« Traiter »** ouvre la fenêtre de décision. Jean coche **Approuver**, puis choisit dans la liste **« Agent achats qui traitera la réquisition »** la personne des achats qui s\'en occupera : **Paul Kasongo**. Il ajoute un commentaire et clique **Valider**.',
      ], points: [
        'Le choix de l\'agent achats est **obligatoire** pour approuver. La liste ne propose que les utilisateurs actifs ayant le profil Achats **sur ce projet**.',
        'Toutes les étapes achats de cette réquisition (méthode, achat direct, devis, appel d\'offres, bon de commande, confirmation fournisseur) sont ensuite **réservées à Paul** ; l\'administrateur garde la main.',
        'Paul est prévenu par notification et par email. Le chef de projet peut changer d\'agent plus tard depuis la fiche (carte « Agent achats »).',
        '**Rejeter** demande un motif ; **Renvoyer pour correction** rend la réquisition modifiable au demandeur.',
      ] },
    ] },
    { title: 'Les achats : méthode, fournisseur, bon de commande', steps: [
      { img: '09_agent-achats_mes-taches', profile: 'Agent achats', user: 'Paul Kasongo', title: 'L\'agent achats reçoit la réquisition', text: [
        'Paul voit dans **Mes tâches** l\'étape « Déterminer la méthode d\'achat ». Un autre agent achats ne la voit pas : elle lui est réservée.',
      ] },
      { img: '10_agent-achats_methode-achat', profile: 'Agent achats', user: 'Paul Kasongo', title: 'Choisir la méthode d\'achat', text: [
        'Après prise en charge, Paul choisit la méthode adaptée. **Toutes les méthodes sont possibles quel que soit le montant** : achat direct, multiples devis (demande de cotations publiée aux fournisseurs), appel d\'offres (RFP) ou source unique (justification obligatoire). Ici : **Achat direct**.',
      ], points: ['La case « Répartir entre plusieurs fournisseurs » permet d\'attribuer chaque article à un fournisseur différent (un bon de commande par fournisseur).'] },
      { img: '11_agent-achats_achat-direct-proforma', profile: 'Agent achats', user: 'Paul Kasongo', title: 'Achat direct : fournisseur retenu + pro-forma', text: [
        'Pour un achat direct, Paul désigne le **fournisseur retenu** (Bureautique Kivu SARL) et joint obligatoirement sa **facture pro-forma** (PDF, JPG ou PNG). Numéro, date et montant de la pro-forma sont facultatifs.',
      ] },
      { img: '12_agent-achats_formulaire-bon-commande', profile: 'Agent achats', user: 'Paul Kasongo', title: 'Créer le bon de commande', text: [
        'L\'étape « Créer le bon de commande » ouvre le formulaire pré-rempli : le **fournisseur désigné à l\'étape « Achat direct »** est choisi d\'office et les articles de la réquisition sont repris (quantité × fréquence, même prix). Paul complète la date de livraison prévue, les **conditions de paiement**, les **conditions de livraison** et les instructions spéciales.',
      ], points: ['Un avertissement signale un fournisseur pas encore préqualifié par l\'entreprise (lien vers sa préqualification).', 'On ne peut pas commander plus que la quantité demandée.'] },
      { img: 'P2_pdf_bon-de-commande', doc: true, profile: 'Document', title: 'PDF : bon de commande', text: [
        'Le bon de commande PDF reprend l\'en-tête de l\'entreprise, le fournisseur et son contact, la livraison, les articles avec unités, les conditions, « Demandé par » (créateur) et « Approuvé par » avec signatures, ainsi que les conditions générales d\'achat de l\'entreprise si elles sont renseignées dans « Mon entreprise ».',
      ] },
    ] },
    { title: 'Révision et approbation du bon de commande', intro: 'Chaque bon de commande est d\'abord **révisé**, puis **approuvé à un seul niveau selon son montant** : < 25 000 → Manager niveau 1, 25 000 à 99 999 → Manager niveau 2, ≥ 100 000 → Manager niveau 3 (seuils réglables par projet).', steps: [
      { img: '14_reviseur_fiche-bon-commande', profile: 'Réviseur des bons de commande', user: 'Grace Nsimba', title: 'Bon de commande à réviser', text: [
        'Grace ouvre la fiche du bon : articles, fournisseur, livraison, conditions et suivi des livraisons. La pastille indique déjà le niveau d\'approbation qui suivra : **N1 (Manager niveau 1)**.',
      ] },
      { img: '15_reviseur_approuver-revision', profile: 'Réviseur des bons de commande', user: 'Grace Nsimba', title: 'Approuver la révision', text: [
        'Elle clique **« Approuver la révision »** et laisse un commentaire (prix conformes à la pro-forma). Un **rejet** exige un motif et arrête ce bon de commande.',
      ], note: 'Séparation des tâches : ni le créateur du bon ni le demandeur ne peuvent le réviser ou l\'approuver.' },
      { img: '16_manager-n1_mes-taches', profile: 'Manager niveau 1', user: 'David Lukusa', title: 'Le manager N1 reçoit l\'approbation', text: [
        'Le montant (1 200 USD) étant inférieur à 25 000, c\'est le **Manager niveau 1** du projet qui reçoit la tâche « Approbation du bon de commande ».',
      ] },
      { img: '17_manager-n1_approbation-bon-commande', profile: 'Manager niveau 1', user: 'David Lukusa', title: 'Approuver le bon de commande', text: [
        'Depuis la fiche du bon, David clique **Approuver** (commentaire facultatif) ou **Rejeter**. Une fois approuvé, le bon est envoyé automatiquement par email au fournisseur.',
      ] },
    ] },
    { title: 'Confirmation par le fournisseur', steps: [
      { img: '18_fournisseur_mes-commandes', profile: 'Fournisseur', user: 'Claude Habimana — Bureautique Kivu SARL', title: 'Portail fournisseur : « Mes commandes »', text: [
        'Le fournisseur inscrit sur le portail reçoit l\'email avec un lien. Dans **Mes commandes**, la commande apparaît « À confirmer ». Il peut ouvrir le bon de commande en PDF.',
      ] },
      { img: '19_fournisseur_confirmation-commande', profile: 'Fournisseur', user: 'Claude Habimana — Bureautique Kivu SARL', title: 'Confirmer la commande', text: [
        'Il indique la **date de livraison prévue**, sa référence et un commentaire, puis **« Confirmer la commande »**. Il peut aussi la refuser en donnant un motif (les achats sont prévenus).',
      ], note: 'Si le fournisseur n\'utilise pas le portail, l\'agent achats saisit sa réponse depuis la fiche du bon de commande.' },
    ] },
    { title: 'Livraison : acceptation (SAN) puis réception (GRN)', intro: 'À **chaque livraison**, le demandeur accepte d\'abord la livraison (SAN), puis la logistique enregistre la réception (GRN). S\'il reste à livrer, le cycle SAN → GRN recommence ; si le fournisseur ne livrera pas le reste, on **solde le reliquat** avec un motif.', steps: [
      { img: '20_demandeur_tache-san', profile: 'Demandeur', user: 'Marie Bahati', title: 'Tâche : acceptation de la livraison', text: [
        'Dans l\'onglet **Tâches** de sa réquisition, Marie trouve « Acceptation de service (SAN) ». Le bouton **Traiter** ouvre directement le formulaire, rattaché à ce bon de commande.',
      ] },
      { img: '21_demandeur_formulaire-san', profile: 'Demandeur', user: 'Marie Bahati', title: 'Bon d\'acceptation (SAN)', text: [
        'Marie confirme que la livraison correspond à ce qui a été demandé (ou la refuse en expliquant pourquoi) et ajoute ses observations.',
      ] },
      { img: '22_logistique_formulaire-reception', profile: 'Logistique', user: 'Sarah Amani', title: 'Bon de réception (GRN)', text: [
        'Sarah enregistre la réception physique : quantités **reçues, rejetées et acceptées** par ligne (le formulaire propose le reste à livrer) et le **dépôt de destination** (obligatoire quand elle a accès à plusieurs dépôts).',
      ], points: [
        'Les articles du catalogue marqués stockables **entrent automatiquement en stock** (« → entrée en stock : 50 rame »), au prix du bon de commande et pour le projet de la réquisition.',
        'Livraison partielle : seule la quantité reçue est enregistrée ; une nouvelle SAN puis un nouveau GRN seront demandés pour le reste.',
        'Case « Le fournisseur ne livrera pas le reste » : solde le reliquat (motif obligatoire).',
      ] },
      { img: '23_logistique_fiche-reception', profile: 'Logistique', user: 'Sarah Amani', title: 'Réception enregistrée', text: [
        'La fiche du GRN indique le dépôt, les quantités et le **numéro de mouvement de stock** de chaque ligne. Une réception peut être annulée tant que le stock reçu n\'a pas été consommé (écritures inverses).',
        'Le bandeau du dépôt affiche **« Entrée en magasin à confirmer »** : les personnes ayant accès au Magasin central sont prévenues.',
      ] },
      { img: '23b_magasinier_confirmer-entree-magasin', profile: 'Magasinier', user: 'Joseph Mbala', title: 'Le magasinier confirme l\'entrée en magasin', text: [
        'Joseph, magasinier du dépôt, vérifie que les articles sont rangés et clique **« Confirmer l\'entrée en magasin »** (commentaire facultatif). Son nom, sa fonction, la date et sa signature figureront dans le cadre « Dépôt » du bon de réception ; Sarah est prévenue.',
      ], note: 'Séparation des tâches : la personne qui a enregistré la réception ne peut pas confirmer elle-même l\'entrée en magasin. La confirmation ne bloque ni le workflow ni la facture.' },
      { img: 'P3_pdf_bon-de-reception', doc: true, profile: 'Document', title: 'PDF : bon de réception', text: [
        'Le bon de réception PDF sert de pièce justificative : dépôt, codes articles, quantités, puis trois cadres de signature — **réceptionné par** (Sarah, signature reprise de son profil), **livreur** (à la main) et **dépôt** (Joseph, magasinier : nom, fonction, date et signature après sa confirmation).',
      ] },
    ] },
    { title: 'Facture, rapprochement et paiement', steps: [
      { img: '24_finance_formulaire-facture', profile: 'Finance', user: 'Esther Ilunga', title: 'Saisir la facture du fournisseur', text: [
        'Depuis la tâche « Saisie de la facture », Esther enregistre la facture : **n° de facture du fournisseur** (obligatoire), dates, montants HT / taxes / TTC. procureApp attribue son propre numéro INV-….',
      ], note: 'Une même facture d\'un fournisseur ne peut pas être saisie deux fois (doublon refusé et tracé dans l\'audit).' },
      { img: '25_finance_fiche-facture-rapprochement', profile: 'Finance', user: 'Esther Ilunga', title: 'Rapprochement à 3 voies', text: [
        'Le **rapprochement à 3 voies** est automatique : montant facturé ≤ bon de commande (+ tolérance de 2 %), **commande approuvée**, **réception complète sans rejet**. Ici : « Rapprochement réussi ». Le paiement se saisit ensuite uniquement depuis la tâche de la réquisition.',
      ] },
      { img: 'P4_pdf_facture', doc: true, profile: 'Document', title: 'PDF : facture et rapprochement', text: [
        'Le PDF de la facture reprend les références (bon de commande, réception, réquisition, projet), les lignes avec quantités acceptées, l\'écart avec le bon de commande et le résultat de chaque contrôle du rapprochement.',
      ] },
      { img: '26_finance_formulaire-paiement', profile: 'Finance', user: 'Esther Ilunga', title: 'Ordre de paiement', text: [
        'Depuis la tâche « Traitement du paiement », Esther saisit le paiement : montant, mode (virement), date, référence et compte. Le paiement reste **en attente d\'approbation**.',
      ], note: 'Si les coordonnées bancaires du fournisseur ont changé et n\'ont pas encore été vérifiées par l\'entreprise, le paiement est bloqué.' },
      { img: '27_dg_approbation-paiement', profile: 'Directeur général', user: 'Patrick Tshibanda', title: 'Approuver le paiement', text: [
        'Patrick ouvre le paiement et l\'**approuve**. La personne qui a saisi le paiement ne peut jamais l\'approuver elle-même (séparation des tâches).',
      ] },
      { img: '28_dg_paiement-paye', profile: 'Directeur général', user: 'Patrick Tshibanda', title: 'Paiement effectué', text: [
        'Le paiement passe à **Payé**, la facture aussi. La dernière étape automatique clôture la réquisition : statut **Terminée**.',
      ] },
      { img: 'P5_pdf_paiement', doc: true, profile: 'Document', title: 'PDF : ordre de paiement', text: [
        'L\'ordre de paiement PDF récapitule le bénéficiaire, la facture, le montant et les références bancaires.',
      ] },
    ] },
    { title: 'Suivre et piloter', steps: [
      { img: '29_demandeur_suivi-workflow', profile: 'Demandeur', user: 'Marie Bahati', title: 'Suivi du workflow', text: [
        'L\'onglet **Suivi du workflow** de la réquisition raconte tout le parcours : à gauche les **13 étapes** (toutes « Terminé »), à droite chaque action réelle avec la personne, sa photo, son commentaire, le délai de traitement et les liens vers les documents (PO, SAN, GRN, facture, paiement).',
      ], points: ['On y voit notamment « Agent achats désigné : Paul Kasongo » par Jean Mukendi.', 'Le même suivi s\'ouvre par le bouton « Voir le workflow ».'] },
      { img: '30_admin_tableau-de-bord', profile: 'Administrateur', user: 'Alice Admin', title: 'Tableau de bord de pilotage', text: [
        'L\'administrateur (et la direction) voit les indicateurs de la période : réquisitions, retards (≥ 2 jours dans une étape), durée du cycle, budget consommé, et **« Qui bloque ? »** : les tâches en attente regroupées par profil.',
      ] },
      { img: '31_admin_liste-requisitions', profile: 'Administrateur', user: 'Alice Admin', title: 'Liste des réquisitions', text: [
        'La liste montre le demandeur, l\'étape et l\'**avancement** (Brouillon / En cours / Terminé / Rejeté / Annulé), avec filtres, exports PDF / Excel et accès direct au workflow de chaque ligne.',
      ] },
    ] },
  ],
  rules: [
    ['Où traiter une tâche ?', 'Toujours dans l\'onglet **Tâches** de la réquisition (« Mes tâches » y renvoie). D\'abord **Prendre en charge**, puis **Traiter**. **Libérer** la rend aux autres.'],
    ['Qui valide la réquisition ?', 'Le **chef du projet** seul (ou son intérimaire déclaré). Il ne valide jamais sa propre demande.'],
    ['Qui traite les achats ?', 'L\'**agent achats désigné** par le chef de projet à la validation ; l\'administrateur peut aussi intervenir.'],
    ['Qui approuve le bon de commande ?', 'Après révision : **N1** (< 25 000), **N2** (25 000 – 99 999) ou **N3** (≥ 100 000), seuils du projet ou de l\'entreprise.'],
    ['Séparation des tâches', 'Personne n\'approuve ce qu\'il a demandé, créé ou saisi : bon de commande, facture, paiement ; l\'entrée en magasin est confirmée par une autre personne que celle qui a enregistré la réception. Toute tentative est bloquée et tracée dans le journal d\'audit.'],
    ['Documents rattachés', 'Une SAN, un GRN, une facture ou un paiement ne peut exister que rattaché à son bon de commande et à sa réquisition, et seulement à l\'étape prévue.'],
    ['Livraisons partielles', 'SAN puis GRN à **chaque** livraison, jusqu\'à livraison complète ou reliquat soldé.'],
  ],
});

// ─────────────────────────────────────────────────────────────────────────────
// Appel d'offres
// ─────────────────────────────────────────────────────────────────────────────
page({
  file: 'appel-offres.html',
  imgDir: 'tender',
  title: "Appel d'offres : mise en concurrence des fournisseurs",
  subtitle: "Un achat de **27 900 USD** (15 ordinateurs portables et leurs licences) attribué par appel d'offres : publication sur le portail, offres scellées, comparatif des prix et de la note technique, attribution, puis bon de commande approuvé au niveau **N2**.",
  intro: [
    "Le projet **Eau potable Goma** renouvelle les ordinateurs de son équipe de terrain : Marie Bahati demande **15 ordinateurs portables** et **15 licences bureautiques**. Après la validation du chef de projet (comme dans le cas « Cycle d'achat complet »), l'agent achats choisit la méthode **Appel d'offres (RFP)**.",
    "L'appel d'offres est publié sur le **portail fournisseurs** avec un questionnaire. Trois fournisseurs répondent ; leurs prix restent **scellés** jusqu'à la clôture. L'agent achats compare ensuite les prix et la **note technique** calculée à partir des réponses, puis attribue le marché. Le fournisseur retenu et ses prix sont repris dans le bon de commande.",
    "La suite — confirmation du fournisseur, acceptation de la livraison (SAN), réception (GRN), facture et paiement — est identique au cas « Cycle d'achat complet ».",
  ],
  cast: [
    ['Marie Bahati', 'Demandeur', "Demande les ordinateurs."],
    ['Jean Mukendi', 'Chef de projet', "Valide la réquisition et désigne l'agent achats."],
    ['Paul Kasongo', 'Agent achats', "Choisit l'appel d'offres, le publie, le clôture, compare les offres, attribue le marché, crée le bon de commande."],
    ['Kivu Tech Solutions SARL', 'Fournisseur', "Répond à l'appel d'offres et remporte le marché."],
    ['Bureautique Kivu SARL, Grands Lacs Informatique SARL', 'Fournisseur', "Répondent aussi à l'appel d'offres."],
    ['Grace Nsimba', 'Réviseur des bons de commande', "Révise le bon de commande."],
    ['Ruth Kahindo', 'Manager niveau 2', "Approuve le bon de commande (montant entre 25 000 et 99 999)."],
  ],
  phases: [
    { title: "Le choix de l'appel d'offres", steps: [
      { img: '01_demandeur_requisition-ordinateurs', profile: 'Demandeur', user: 'Marie Bahati', title: 'La réquisition', text: [
        "Marie crée la réquisition comme dans le cas « Cycle d'achat complet » : 15 ordinateurs (article du catalogue) et 15 licences, estimés à 28 800 USD sur la ligne budgétaire EAU-01. Jean Mukendi, chef de projet, la valide et désigne **Paul Kasongo** comme agent achats.",
      ] },
      { img: '02_agent-achats_methode-appel-offres', profile: 'Agent achats', user: 'Paul Kasongo', title: "Choisir « Appel d'offres (RFP) »", text: [
        "Dans l'onglet **Tâches** de la réquisition, Paul prend en charge « Déterminer la méthode d'achat », choisit **Appel d'offres (RFP)** et justifie son choix. Toutes les méthodes sont possibles quel que soit le montant ; ici, la mise en concurrence ouverte s'impose.",
      ], note: "Avec « Multiples devis », le même module sert à une demande de cotations (RFQ) : les étapes sont identiques." },
    ] },
    { title: 'Publication sur le portail fournisseurs', steps: [
      { img: '03_agent-achats_formulaire-appel-offres', profile: 'Agent achats', user: 'Paul Kasongo', title: "Préparer l'appel d'offres", text: [
        "L'étape « Appel d'offres » ouvre directement le formulaire, lié à la réquisition : les articles à chiffrer sont repris. Paul saisit le **n° d'appel d'offres**, l'objet, la description, l'**ouverture**, la **date limite** et le **délai de livraison maximal** (30 jours).",
      ], points: [
        "**Diffusion** : à tous les fournisseurs inscrits, ou réservée à des fournisseurs préqualifiés invités (par catégorie et localisation).",
        "**Attribution** : à un seul fournisseur, ou par article (un fournisseur différent par article).",
        "**Questionnaire** : ici « Garantie proposée » (36 mois = 10 points, 24 mois = 6, 12 mois = 2), « Service après-vente à Goma ? » (Oui = 5 points) et « Références de marchés similaires ». Seules les listes de choix sont notées ; la bibliothèque de questions de l'entreprise évite de les ressaisir.",
      ] },
      { img: '04_agent-achats_appel-offres-publie', profile: 'Agent achats', user: 'Paul Kasongo', title: "Appel d'offres publié", text: [
        "À la publication, les fournisseurs concernés reçoivent une notification et un email. La fiche montre l'état (ouvert), les dates, les articles et le questionnaire.",
      ] },
    ] },
    { title: 'Les offres des fournisseurs', steps: [
      { img: '05_fournisseur_appels-offres-ouverts', profile: 'Fournisseur', user: 'Aline Mapendo — Kivu Tech Solutions SARL', title: "Le fournisseur voit l'appel d'offres", text: [
        "Sur son portail, le fournisseur voit les appels d'offres ouverts, avec le nom de l'acheteur et la date limite.",
      ] },
      { img: '06_fournisseur_formulaire-offre', profile: 'Fournisseur', user: 'Aline Mapendo — Kivu Tech Solutions SARL', title: 'Soumettre son offre', text: [
        "Il saisit un **prix unitaire par article**, son **délai de livraison** (au plus le délai maximal) et répond au **questionnaire** (il ne voit jamais les points). Il peut modifier son offre tant que l'appel d'offres est ouvert, et télécharger son offre en PDF.",
      ], points: [
        "Kivu Tech Solutions : 1 750 USD l'ordinateur, 110 USD la licence, 14 jours, garantie 36 mois, SAV à Goma.",
        "Bureautique Kivu : 1 820 / 115 USD, 21 jours, garantie 24 mois, SAV à Goma.",
        "Grands Lacs Informatique : 1 690 / 130 USD, 30 jours, garantie 12 mois, pas de SAV à Goma.",
      ] },
      { img: 'P1_pdf_offre-fournisseur', doc: true, profile: 'Document', title: "PDF : offre du fournisseur", text: [
        "L'offre PDF reprend l'identité du fournisseur, l'appel d'offres, les prix par article, le délai, les réponses au questionnaire et un cadre pour le cachet et la signature.",
      ] },
      { img: '07_agent-achats_offres-scellees', profile: 'Agent achats', user: 'Paul Kasongo', title: 'Offres scellées', text: [
        "Tant que l'appel d'offres est ouvert, l'acheteur voit **qui** a soumis et **quand**, mais **ni les prix ni les réponses** : les offres sont scellées. L'export Excel du comparatif est refusé.",
      ] },
    ] },
    { title: 'Clôture, comparatif et attribution', steps: [
      { img: '08_agent-achats_cloture-anticipee', profile: 'Agent achats', user: 'Paul Kasongo', title: "Clôturer l'appel d'offres", text: [
        "L'appel d'offres se clôture automatiquement à la date limite. Ici, les trois fournisseurs ayant répondu, Paul clique **« Clôturer maintenant »**. Après la clôture, plus aucune offre ne peut être déposée ni modifiée, et l'appel d'offres ne peut plus être prolongé.",
      ] },
      { img: '09_agent-achats_comparatif-offres', profile: 'Agent achats', user: 'Paul Kasongo', title: 'Comparer les offres', text: [
        "Les prix sont dévoilés : le **comparatif** croise les articles et les fournisseurs, avec le total, le délai et la **note technique** (points obtenus / points possibles). Les réponses au questionnaire sont consultables, et le comparatif s'exporte en Excel.",
      ], note: "Le moins cher (Grands Lacs Informatique) n'est pas forcément retenu : sa garantie est de 12 mois, sans service après-vente à Goma, et sa note technique est la plus basse." },
      { img: '10_agent-achats_attribution', profile: 'Agent achats', user: 'Paul Kasongo', title: 'Attribuer le marché', text: [
        "Paul clique **« Attribuer »** sur l'offre de Kivu Tech Solutions. Ce n'est pas l'offre la moins chère : la fenêtre le signale et demande de **justifier le choix**. Paul indique le meilleur rapport qualité / prix (garantie 36 mois, SAV à Goma, livraison en 14 jours). L'attribution termine l'étape « Appel d'offres » du workflow.",
      ] },
      { img: '11_agent-achats_appel-offres-attribue', profile: 'Agent achats', user: 'Paul Kasongo', title: "Appel d'offres attribué", text: [
        "La fiche indique l'attributaire et le commentaire. Le fournisseur retenu est prévenu ; les autres voient le résultat sur leur portail.",
      ] },
      { img: '12_fournisseur_marche-remporte', profile: 'Fournisseur', user: 'Aline Mapendo — Kivu Tech Solutions SARL', title: 'Le fournisseur retenu', text: [
        "Sur son portail, Kivu Tech Solutions voit que le marché lui est attribué. Il recevra le bon de commande une fois celui-ci approuvé et le confirmera depuis « Mes commandes ».",
      ] },
    ] },
    { title: 'Bon de commande et approbation N2', steps: [
      { img: '13_agent-achats_bon-commande-attributaire', profile: 'Agent achats', user: 'Paul Kasongo', title: 'Bon de commande pré-rempli', text: [
        "L'étape « Créer le bon de commande » ouvre le formulaire avec **l'attributaire de l'appel d'offres choisi d'office**, les articles de la réquisition et **les prix unitaires de son offre** (27 900 USD au total, au lieu des 28 800 USD estimés). Paul complète les conditions de paiement et de livraison.",
      ] },
      { img: '14_manager-n2_mes-taches', profile: 'Manager niveau 2', user: 'Ruth Kahindo', title: 'Approbation au niveau N2', text: [
        "Après la révision par Grace Nsimba, le montant (27 900 USD, entre 25 000 et 99 999) envoie l'approbation au **Manager niveau 2** : Ruth Kahindo reçoit la tâche.",
      ] },
      { img: '15_manager-n2_approbation-bon-commande', profile: 'Manager niveau 2', user: 'Ruth Kahindo', title: 'Approuver le bon de commande', text: [
        "La fiche indique « Approbation : niveau N2 ». Ruth approuve ; le bon de commande part par email au fournisseur, qui le confirme sur son portail. La suite est celle du cas « Cycle d'achat complet ».",
      ] },
      { img: 'P2_pdf_bon-de-commande', doc: true, profile: 'Document', title: 'PDF : bon de commande', text: [
        "Le bon de commande reprend le fournisseur attributaire, les prix de son offre, les conditions et la référence de l'appel d'offres, avec les signatures du créateur et de l'approbatrice.",
      ] },
      { img: '16_demandeur_suivi-workflow', profile: 'Demandeur', user: 'Marie Bahati', title: 'Suivi du workflow', text: [
        "Le suivi de la réquisition montre l'appel d'offres publié puis attribué avec le fournisseur retenu, le bon de commande et son approbation au niveau N2.",
      ] },
    ] },
  ],
  rules: [
    ['Offres scellées', "Ni prix ni réponses visibles par l'acheteur avant la clôture ; pas d'export avant la clôture."],
    ['Après la clôture', "Plus aucune offre déposée ou modifiée ; l'appel d'offres ne peut plus être prolongé."],
    ['Note technique', "Calculée sur les questions à choix notées ; les fournisseurs ne voient jamais le barème."],
    ['Attribution', "Termine l'étape du workflow ; l'attributaire est proposé d'office dans le bon de commande (préqualifié ou non)."],
    ["Niveau d'approbation", "Fixé par le montant du bon de commande : N1 (< 25 000), N2 (25 000 – 99 999), N3 (≥ 100 000)."],
  ],
});

// ─────────────────────────────────────────────────────────────────────────────
// Gestion de stock
// ─────────────────────────────────────────────────────────────────────────────
const S = (steps) => steps.map(s => ({ ...s }));
page({
  file: 'stock.html',
  imgDir: 'stock',
  title: 'Gestion de stock au quotidien',
  subtitle: 'Les magasins du projet Eau potable Goma : entrées, demandes au magasin, sorties, équipements, transferts, inventaire et rapports — qui fait quoi, et sur quel écran.',
  other: { href: 'workflow.html', label: 'Voir le cas concret « Cycle d\'achat complet »' },
  intro: [
    'L\'entreprise a deux dépôts à Goma : le **Magasin central Goma (MAG-GOMA)** et le **Magasin antenne Nord (MAG-NORD)**. Le stock du magasin central vient d\'être alimenté par la réception de la commande du cas « Cycle d\'achat complet » (50 rames, 10 toners, entrées automatiquement en stock).',
    'Dans ce cas, le magasin reçoit un **don** (savon, ordinateurs, papier), sert une **demande** d\'une employée, **affecte un ordinateur** puis le récupère, **transfère** du stock vers l\'antenne Nord (avec une perte en transit) et fait son **inventaire** de fin de trimestre.',
    'Chaque opération écrit des **mouvements de stock** dans un journal non modifiable ; les soldes ne peuvent jamais devenir négatifs, et chaque entrée garde le **projet qui l\'a financée**.',
  ],
  cast: [
    ['Sarah Amani', 'Logistique', 'Responsable logistique : valide les entrées, affecte et récupère le matériel, transfère, fait l\'inventaire.'],
    ['Joseph Mbala', 'Magasinier', 'Saisit les bons d\'entrée, sert les demandes, réceptionne les transferts. (Dans la démo, il a aussi le profil Logistique : voir la remarque à l\'étape 4.)'],
    ['Marie Bahati', 'Demandeur', 'Demande des articles au magasin et accuse réception.'],
    ['David Lukusa', 'Manager niveau 1', 'Reçoit un ordinateur portable en dotation, puis le rend.'],
    ['Alice Admin', 'Administrateur', 'Crée les dépôts et leurs accès, valide les écarts d\'inventaire, suit la valorisation.'],
  ],
  phases: [
    { title: 'Organisation du stock', steps: S([
      { img: '01_logistique_vue-ensemble-stock', profile: 'Logistique', user: 'Sarah Amani', title: 'État du stock', text: [
        'Menu **Stock → État du stock** : synthèse (articles, valeur, alertes), soldes par article × dépôt × lot × projet, péremptions proches et export Excel. Les filtres permettent de voir un dépôt ou le stock d\'un projet.',
      ] },
      { img: '02_logistique_catalogue-articles', profile: 'Logistique', user: 'Sarah Amani', title: 'Catalogue des articles', text: [
        'Chaque article a un code, une **unité de mesure**, une catégorie et ses règles de suivi : **stockable**, **suivi par lot / date de péremption** (savon), **suivi par n° de série** (ordinateurs), stock minimum, délai d\'approvisionnement.',
      ], points: ['Le catalogue s\'importe depuis Excel / CSV, avec un stock initial par dépôt.', 'Les réquisitions et bons de commande citent ces articles : la réception les fait entrer en stock automatiquement.'] },
      { img: '03_admin_depots-et-acces', profile: 'Administrateur', user: 'Alice Admin', title: 'Dépôts et accès', text: [
        'L\'administrateur crée les dépôts (rattachés à une localisation) et désigne **qui y a accès**. Une personne ne peut réceptionner, sortir ou compter que dans ses dépôts.',
      ] },
    ]) },
    { title: 'Entrée hors bon de commande (don)', intro: 'Les achats avec bon de commande entrent par la réception (GRN). Tout le reste — don, achat payé hors procureApp, retour, autre — passe par un **bon d\'entrée**, saisi par une personne et **validé par une autre**.', steps: S([
      { img: '04_magasinier_nouveau-bon-entree', dir: 'stock', profile: 'Magasinier', user: 'Joseph Mbala', title: 'Saisir un bon d\'entrée', text: [
        'Menu **Stock → Bons d\'entrée → Nouveau**. Joseph choisit le type **Don / dotation**, le dépôt, le donateur (Fondation Partenaire Kivu), la personne qui remet les articles, la référence du bordereau et le projet de financement.',
        'Lignes : 40 cartons de savon (**lot SAV-2026-07** et date de péremption), 3 ordinateurs (**un n° de série par unité**), 20 rames de papier ; le coût unitaire est facultatif mais sert à la valorisation.',
      ], note: 'Remarque : le profil « Magasinier » seul permet de saisir un bon d\'entrée mais pas de consulter le stock ni de servir une demande (permissions « Consulter le stock » et « Sortir du stock »). Dans la démo, Joseph a aussi le profil Logistique.' },
      { img: '06_logistique_validation-bon-entree', dir: 'stock', profile: 'Logistique', user: 'Sarah Amani', title: 'Valider le bon (par une autre personne)', text: [
        'Le bon part « En attente de validation » : **le stock n\'augmente qu\'à la validation**. Sarah vérifie les articles reçus puis clique **Valider** (ou **Refuser** avec un motif). L\'auteur d\'un bon ne peut jamais le valider lui-même.',
      ] },
      { img: '07_logistique_bon-entree-valide', dir: 'stock', profile: 'Logistique', user: 'Sarah Amani', title: 'Bon validé : les articles sont en stock', text: [
        'Chaque ligne reçoit son **mouvement de stock** (type Entrée), le lot est créé et chaque ordinateur devient une unité suivie. Le bon s\'imprime en PDF pour signature (remis par / magasinier / valideur).',
      ] },
      { img: 'P1_pdf_bon-entree', doc: true, profile: 'Document', title: "PDF : bon d'entrée", text: [
        "Le bon d'entrée PDF reprend le dépôt, le donateur, la référence, chaque article avec lot, péremption et n° de série, les coûts, et les cadres de signature : **remis par**, **magasinier** (auteur) et **valideur**.",
      ] },
      { img: '08_logistique_equipements-numeros-inventaire', dir: 'stock', profile: 'Logistique', user: 'Sarah Amani', title: 'Équipements et n° d\'inventaire', text: [
        'Menu **Équipements** : chaque ordinateur a son n° de série et un **n° d\'inventaire attribué automatiquement** (EAU-2026-00001 : code initial du projet, année, compteur). Statuts : en stock, affecté, en transit, perdu, réformé.',
      ], points: ['Imports possibles : parc existant, affectations existantes, recodification des étiquettes.'] },
    ]) },
    { title: 'Demande au magasin et sortie', intro: 'Tout utilisateur peut demander des articles stockables à un dépôt. La validation de la demande (par le chef de projet ou le responsable) est une **option de l\'entreprise** — désactivée ici : la demande part directement « À servir ».', steps: S([
      { img: '09_demandeur_nouvelle-demande-magasin', dir: 'stock', profile: 'Demandeur', user: 'Marie Bahati', title: 'Demander des articles au magasin', text: [
        'Menu **Demandes au magasin → Nouvelle demande** : Marie choisit le dépôt, la destination (pour elle-même ou pour un département), le projet, le motif (sensibilisation hygiène), la date souhaitée et les articles — le disponible du dépôt est affiché.',
      ] },
      { img: '10_demandeur_demande-a-servir', dir: 'stock', profile: 'Demandeur', user: 'Marie Bahati', title: 'Demande enregistrée, à servir', text: [
        'La demande reçoit un numéro DEM-… et le statut **À servir**. Les magasiniers du dépôt sont prévenus. Marie peut la retirer tant que rien n\'a été servi.',
      ] },
      { img: '11_magasinier_demandes-a-servir', dir: 'stock', profile: 'Magasinier', user: 'Joseph Mbala', title: 'Les demandes à servir', text: [
        'Joseph voit les demandes de ses dépôts dans l\'onglet **À servir**.',
      ] },
      { img: '12_magasinier_servir-la-demande', dir: 'stock', profile: 'Magasinier', user: 'Joseph Mbala', title: 'Servir la demande', text: [
        '**Servir** ouvre un bon de sortie pré-rempli et verrouillé (dépôt, bénéficiaire, projet, motif, articles) avec le **reste à servir** sous chaque quantité. Joseph peut servir moins (le reste restera à servir).',
      ], points: ['Lots : **la péremption la plus proche sort en premier** (FEFO) ; les lots périmés ne sortent pas.', 'Le stock du projet est pris en priorité, puis le stock sans projet — jamais celui d\'un autre projet.'] },
      { img: '13_magasinier_bon-de-sortie', dir: 'stock', profile: 'Magasinier', user: 'Joseph Mbala', title: 'Bon de sortie', text: [
        'Le bon de sortie SOR-… indique les lots sortis et les mouvements. Il s\'imprime en PDF pour signature. Le stock du dépôt diminue immédiatement.',
      ] },
      { img: 'P2_pdf_bon-de-sortie', doc: true, profile: 'Document', title: 'PDF : bon de sortie', text: [
        "Le bon de sortie à signer : dépôt, bénéficiaire, projet, motif, articles et lots sortis. Après l'accusé de réception, la signature du bénéficiaire y figure.",
      ] },
      { img: '14_demandeur_accuse-reception', dir: 'stock', profile: 'Demandeur', user: 'Marie Bahati', title: 'Accuser réception', text: [
        'Marie est notifiée. Dans **Mes articles reçus**, elle ouvre le bon et **confirme la réception** ; le magasinier est prévenu.',
      ] },
      { img: '15_demandeur_mes-articles-recus', dir: 'stock', profile: 'Demandeur', user: 'Marie Bahati', title: '« Mes articles reçus »', text: [
        'Chaque utilisateur retrouve les articles qui lui ont été remis et le matériel **en sa possession**.',
      ] },
    ]) },
    { title: 'Matériel affecté et retour', steps: S([
      { img: '16_logistique_affectation-ordinateur', dir: 'stock', profile: 'Logistique', user: 'Sarah Amani', title: 'Affecter un ordinateur à un employé', text: [
        'Un bon de sortie **Vers un employé** avec l\'unité choisie (n° de série) : l\'ordinateur passe au statut **Affecté** à David Lukusa, qui accuse réception.',
      ], note: 'Un utilisateur qui détient du matériel ne peut pas être désactivé sans le confirmer explicitement (liste du matériel affichée).' },
      { img: '20_logistique_retour-equipement', dir: 'stock', profile: 'Logistique', user: 'Sarah Amani', title: 'Récupérer le matériel', text: [
        'Menu **Retours → Nouveau** : on choisit l\'employé (ou le département) ; ce qu\'il détient s\'affiche. Pour chaque article : quantité rendue et état **Bon / Endommagé / Perdu**, et le dépôt qui reprend le matériel. « Tout récupérer » remplit tout d\'un coup.',
      ] },
      { img: '21_logistique_bon-de-retour', dir: 'stock', profile: 'Logistique', user: 'Sarah Amani', title: 'Bon de retour', text: [
        'L\'ordinateur revient **En stock**. Le bon de retour RET-… s\'imprime en PDF.',
      ] },
      { img: 'P4_pdf_bon-de-retour', doc: true, profile: 'Document', title: 'PDF : bon de retour', text: [
        'Le bon de retour récapitule le matériel rendu, son état (bon, endommagé, perdu), le dépôt qui le reprend et la signature du magasinier.',
      ] },
    ]) },
    { title: 'Transfert entre dépôts', steps: S([
      { img: '17_logistique_liste-des-sorties', dir: 'stock', profile: 'Logistique', user: 'Sarah Amani', title: 'Liste des sorties', text: [
        'Menu **Sorties** : toutes les sorties avec leur type (vers un employé, vers un département, **vers un dépôt**), leur destination et leur statut (réception confirmée, en transit, réceptionné, annulé). Sarah a créé un transfert de 15 rames et 3 toners vers l\'antenne Nord : le stock quitte le magasin central et reste **en transit**.',
      ] },
      { img: '18_magasinier_reception-transfert', dir: 'stock', profile: 'Magasinier', user: 'Joseph Mbala', title: 'Réceptionner le transfert', text: [
        'À l\'arrivée, une personne ayant accès au dépôt de destination clique **Réceptionner** et saisit, ligne par ligne, la quantité **effectivement arrivée**.',
      ] },
      { img: '19_magasinier_transfert-receptionne-avec-manque', dir: 'stock', profile: 'Magasinier', user: 'Joseph Mbala', title: 'Réceptionné avec un manque', text: [
        'Une rame est arrivée mouillée : 14 reçues sur 15. Le transfert est « **Réceptionné avec manque** » ; la différence est enregistrée comme **perte en transit**.',
      ] },
      { img: 'P3_pdf_bon-de-transfert', doc: true, profile: 'Document', title: 'PDF : bon de transfert', text: [
        "Pour un transfert, le même document devient un **bon de transfert** : dépôt d'origine, dépôt de destination, quantités expédiées, puis la mention de la réception (personne, date, commentaire) et les signatures du magasinier et du réceptionnaire.",
      ] },
    ]) },
    { title: 'Inventaire et ajustements', steps: S([
      { img: '22_logistique_inventaire-comptage', dir: 'stock', profile: 'Logistique', user: 'Sarah Amani', title: 'Ouvrir un inventaire', text: [
        'Menu **Inventaires → Nouvel inventaire** (dépôt entier ou une catégorie). Les quantités attendues sont figées à l\'ouverture ; le **comptage à l\'aveugle** les masque pour ne pas influencer les compteurs. Les équipements se pointent « Présent / Absent ».',
      ] },
      { img: '23_logistique_inventaire-ecarts', dir: 'stock', profile: 'Logistique', user: 'Sarah Amani', title: 'Saisir le comptage : écarts', text: [
        'Sarah compte 48 rames au lieu de 50 : **écart −2** avec la remarque « 2 rames abîmées retirées ». « Stock trouvé » permet d\'ajouter un article ou un lot non prévu.',
      ] },
      { img: '23b_admin_validation-inventaire', dir: 'stock', profile: 'Administrateur', user: 'Alice Admin', title: 'Valider les écarts (administrateur)', text: [
        'La validation d\'un inventaire est **réservée à l\'administrateur** : elle transforme les écarts en ajustements de stock.',
      ] },
      { img: '23c_logistique_inventaire-valide', dir: 'stock', profile: 'Logistique', user: 'Sarah Amani', title: 'Inventaire validé', text: [
        'L\'inventaire est clos ; chaque écart a produit un mouvement d\'ajustement (un équipement absent passerait « Perdu »).',
      ] },
      { img: '24_logistique_ajustements', dir: 'stock', profile: 'Logistique', user: 'Sarah Amani', title: 'Ajustements', text: [
        'Menu **Ajustements** : les corrections de stock avec leur motif (casse, perte, vol, péremption, trouvé, correction…). Un ajustement manuel est réservé à l\'administrateur.',
      ] },
    ]) },
    { title: 'Suivi, prévision et valorisation', steps: S([
      { img: '25_logistique_journal-operations', dir: 'stock', profile: 'Logistique', user: 'Sarah Amani', title: 'Journal des mouvements (par opération)', text: [
        'Menu **Mouvements** : chaque opération (réception, bon d\'entrée, sortie, transfert, inventaire…) regroupe ses mouvements sous un n° MVG-…. Vue « Détail » : un mouvement par ligne, filtrable par article, dépôt, projet, type.',
      ] },
      { img: '26_logistique_detail-operation', dir: 'stock', profile: 'Logistique', user: 'Sarah Amani', title: 'Détail d\'une opération', text: [
        'Tous les mouvements d\'une opération, avec lots, n° de série, projets et document d\'origine ; téléchargeable en Excel.',
      ] },
      { img: '27_logistique_fiche-article', dir: 'stock', profile: 'Logistique', user: 'Sarah Amani', title: 'Fiche d\'un article', text: [
        'Soldes par dépôt et lot, historique des mouvements et prévision de l\'article.',
      ] },
      { img: '28_logistique_prevision-reapprovisionnement', dir: 'stock', profile: 'Logistique', user: 'Sarah Amani', title: 'Prévision du réapprovisionnement', text: [
        'Pour chaque article × dépôt : **consommation moyenne mensuelle** (sorties, hors jours de rupture), mois de stock, stock de sécurité / minimum / maximum, en commande, demandé et **quantité à commander**. États : rupture, sous la sécurité, à commander, surstock, suffisant.',
      ], points: ['« Réapprovisionner » crée une réquisition pré-remplie avec les quantités à commander.', 'Paramètres (mois de consommation, sécurité, délai, fréquence) dans « Mon entreprise ».'] },
      { img: '29_admin_valorisation-cmup', dir: 'stock', profile: 'Administrateur', user: 'Alice Admin', title: 'Valorisation (CMUP)', text: [
        'Valeur du stock au **coût moyen unitaire pondéré**, calculé à partir du journal (réceptions au prix du bon de commande, entrées au coût saisi). Peut être calculée à une date passée et exportée en Excel.',
      ] },
      { img: '30_admin_rapprochement-receptions-stock', dir: 'stock', profile: 'Administrateur', user: 'Alice Admin', title: 'Rapprochement réceptions ↔ stock', text: [
        'Contrôle d\'audit : chaque ligne de réception (GRN) est comparée à ce qui est réellement entré en stock (quantité, dépôt, lot, coût, n° de série). Les anomalies sont signalées.',
      ] },
      { img: '31_logistique_vue-ensemble-finale', dir: 'stock', profile: 'Logistique', user: 'Sarah Amani', title: 'État du stock en fin de scénario', text: [
        'Après toutes ces opérations, les soldes des deux dépôts reflètent exactement le journal : entrées, sorties, transfert (moins la perte en transit), retour et ajustement d\'inventaire.',
      ] },
    ]) },
  ],
  rules: [
    ['Deux personnes pour une entrée', 'Un bon d\'entrée est saisi par une personne et validé par une autre ; le stock n\'augmente qu\'à la validation.'],
    ['Accès aux dépôts', 'On ne réceptionne, ne sort et ne compte que dans les dépôts auxquels on a accès.'],
    ['Lots et péremption', 'Sortie automatique du lot qui périme le plus tôt (FEFO) ; lot périmé refusé.'],
    ['Projet de financement', 'Chaque entrée garde son projet ; une sortie pour un projet ne prend jamais le stock d\'un autre projet.'],
    ['Journal immuable', 'Un mouvement ne se modifie ni ne se supprime : on corrige par une écriture inverse (annulation, ajustement).'],
    ['Inventaire', 'Écarts validés par l\'administrateur uniquement.'],
  ],
});

if (missing.length) console.log('⚠️ Captures manquantes :', missing.join(', '));
else console.log('✅ Pages générées dans', DIR);
