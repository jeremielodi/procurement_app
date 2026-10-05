// src/components/Landing/LandingPage.jsx
// Page vitrine publique (FR / EN) — affichée sur « / » pour un visiteur non connecté
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ShoppingCart, CheckCircle2, Building2, ShieldCheck, Truck, Receipt, CreditCard,
  Workflow, BarChart3, Bell, Lock, FileSpreadsheet, Gavel, ArrowRight, Menu, X,
  ClipboardCheck, PackageCheck, LogIn, Store, FileText, Globe, Mail, Phone,
} from 'lucide-react';

const OWNER = 'Digitales Solutions';
const CONTACT_EMAIL = 'jeremielodi@gmail.com';
const CONTACT_PHONE = '+243812537702';
const CONTACT_PHONE_DISPLAY = '+243 812 537 702';
const LANG_KEY = 'landing_lang';

const TEXT = {
  fr: {
    nav: { features: 'Fonctionnalités', cycle: 'Cycle d\'achat', suppliers: 'Fournisseurs', security: 'Sécurité', contact: 'Contact', login: 'Se connecter' },
    hero: {
      badge: 'Plateforme e-procurement multi-entreprise',
      title: 'Vos achats, de la réquisition au paiement.',
      subtitle: 'procureApp digitalise tout le cycle procure-to-pay : demandes, approbations, appels d\'offres, bons de commande, réceptions, factures et paiements — dans un seul outil traçable.',
      cta: 'Accéder à mon espace',
      ctaSupplier: 'Inscription fournisseur',
      stats: [['13', 'étapes automatisées'], ['3', 'niveaux d\'approbation'], ['100 %', 'traçabilité']],
    },
    features: {
      title: 'Tout ce qu\'il faut pour piloter vos achats',
      subtitle: 'Des outils pensés pour les équipes achats, finance, logistique et direction.',
      items: [
        [ShoppingCart, 'Réquisitions', 'Création des demandes avec articles, lignes budgétaires et import Excel/CSV.'],
        [Workflow, 'Circuits d\'approbation', 'Validation multi-niveaux selon le montant : manager, finance, direction générale.'],
        [Gavel, 'Appels d\'offres', 'Publication, offres scellées jusqu\'à la clôture, comparatif et attribution.'],
        [FileText, 'Bons de commande', 'PO générés, approuvés et envoyés automatiquement au fournisseur en PDF.'],
        [Receipt, 'Rapprochement 3 voies', 'Contrôle automatique bon de commande + réception + facture avant paiement.'],
        [BarChart3, 'Tableaux de bord', 'Suivi budgétaire, avancement des demandes et tâches en attente par profil.'],
        [Bell, 'Notifications temps réel', 'Alertes dans l\'application et par email à chaque étape du workflow.'],
        [FileSpreadsheet, 'Exports PDF & Excel', 'Documents officiels à vos couleurs, en français ou en anglais.'],
      ],
    },
    cycle: {
      title: 'Un cycle procure-to-pay complet',
      subtitle: 'Chaque étape est orchestrée par un moteur de workflow : impossible de payer une facture avant la réception.',
      steps: [
        [ClipboardCheck, 'Réquisition'], [CheckCircle2, 'Approbation'], [Gavel, 'Sélection fournisseur'],
        [FileText, 'Bon de commande'], [PackageCheck, 'Réception'], [Receipt, 'Facture'], [CreditCard, 'Paiement'],
      ],
    },
    suppliers: {
      title: 'Un portail dédié aux fournisseurs',
      subtitle: 'Les fournisseurs s\'inscrivent en ligne, déposent leurs documents et répondent aux appels d\'offres de toutes les entreprises de la plateforme.',
      points: [
        'Inscription libre et profil complet (localisations, catégories, documents)',
        'Préqualification par entreprise et par catégorie de marché',
        'Consultation des appels d\'offres ouverts et soumission en ligne',
        'Suivi des offres et des marchés remportés',
      ],
      cta: 'Devenir fournisseur',
    },
    security: {
      title: 'Multi-entreprise et sécurisé',
      items: [
        [Building2, 'Données cloisonnées', 'Chaque entreprise dispose de son espace, ses utilisateurs, ses projets et son budget.'],
        [Lock, 'Contrôle des accès', 'Profils et permissions par rôle ; chaque action est historisée.'],
        [ShieldCheck, 'Fichiers protégés', 'Documents stockés de façon privée et versionnée, jamais exposés publiquement.'],
      ],
    },
    cta: { title: 'Prêt à moderniser vos achats ?', subtitle: 'Connectez-vous à votre espace ou inscrivez-vous comme fournisseur.', login: 'Se connecter' },
    contact: {
      title: 'Contactez-nous',
      subtitle: 'Une démonstration, un déploiement pour votre entreprise ou une question ? L\'équipe Digitales Solutions vous répond.',
      email: 'Email', phone: 'Téléphone / WhatsApp', mailSubject: 'Demande d\'information procureApp',
    },
    footer: { by: 'Une solution éditée par', rights: 'Tous droits réservés.' },
  },
  en: {
    nav: { features: 'Features', cycle: 'Procurement cycle', suppliers: 'Suppliers', security: 'Security', contact: 'Contact', login: 'Sign in' },
    hero: {
      badge: 'Multi-company e-procurement platform',
      title: 'Your purchasing, from requisition to payment.',
      subtitle: 'procureApp digitizes the entire procure-to-pay cycle: requests, approvals, tenders, purchase orders, receipts, invoices and payments — in one fully traceable tool.',
      cta: 'Go to my workspace',
      ctaSupplier: 'Supplier registration',
      stats: [['13', 'automated steps'], ['3', 'approval levels'], ['100%', 'traceability']],
    },
    features: {
      title: 'Everything you need to run procurement',
      subtitle: 'Built for procurement, finance, logistics and management teams.',
      items: [
        [ShoppingCart, 'Requisitions', 'Create requests with items, budget lines and Excel/CSV import.'],
        [Workflow, 'Approval workflows', 'Multi-level approval based on amount: manager, finance, general management.'],
        [Gavel, 'Tenders', 'Publishing, sealed bids until closing, comparison and award.'],
        [FileText, 'Purchase orders', 'POs generated, approved and automatically sent to suppliers as PDF.'],
        [Receipt, '3-way matching', 'Automatic check of purchase order + goods receipt + invoice before payment.'],
        [BarChart3, 'Dashboards', 'Budget tracking, request progress and pending tasks by role.'],
        [Bell, 'Real-time notifications', 'In-app and email alerts at every workflow step.'],
        [FileSpreadsheet, 'PDF & Excel exports', 'Official documents with your branding, in French or English.'],
      ],
    },
    cycle: {
      title: 'A complete procure-to-pay cycle',
      subtitle: 'Every step is orchestrated by a workflow engine: an invoice cannot be paid before goods are received.',
      steps: [
        [ClipboardCheck, 'Requisition'], [CheckCircle2, 'Approval'], [Gavel, 'Supplier selection'],
        [FileText, 'Purchase order'], [PackageCheck, 'Goods receipt'], [Receipt, 'Invoice'], [CreditCard, 'Payment'],
      ],
    },
    suppliers: {
      title: 'A dedicated supplier portal',
      subtitle: 'Suppliers register online, upload their documents and respond to tenders from every company on the platform.',
      points: [
        'Open registration and complete profile (locations, categories, documents)',
        'Prequalification per company and per market category',
        'Browse open tenders and submit bids online',
        'Track bids and awarded contracts',
      ],
      cta: 'Become a supplier',
    },
    security: {
      title: 'Multi-company and secure',
      items: [
        [Building2, 'Isolated data', 'Each company has its own workspace, users, projects and budget.'],
        [Lock, 'Access control', 'Role-based profiles and permissions; every action is logged.'],
        [ShieldCheck, 'Protected files', 'Documents stored privately with versioning, never publicly exposed.'],
      ],
    },
    cta: { title: 'Ready to modernize your procurement?', subtitle: 'Sign in to your workspace or register as a supplier.', login: 'Sign in' },
    contact: {
      title: 'Contact us',
      subtitle: 'A demo, a deployment for your company or a question? The Digitales Solutions team is here to help.',
      email: 'Email', phone: 'Phone / WhatsApp', mailSubject: 'procureApp information request',
    },
    footer: { by: 'A solution by', rights: 'All rights reserved.' },
  },
};

function initialLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'fr' || saved === 'en') return saved;
  } catch { /* stockage indisponible */ }
  return (navigator.language || 'fr').toLowerCase().startsWith('en') ? 'en' : 'fr';
}

function LangSwitch({ lang, setLang, className = '' }) {
  return (
    <div className={`inline-flex items-center rounded-full border border-white/20 p-0.5 text-xs font-semibold ${className}`}>
      <Globe className="w-3.5 h-3.5 mx-1.5 text-blue-200" aria-hidden="true" />
      {['fr', 'en'].map(l => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={`px-2.5 py-1 rounded-full uppercase transition ${lang === l ? 'bg-white text-slate-900' : 'text-blue-100 hover:text-white'}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export default function LandingPage() {
  const [lang, setLangState] = useState(initialLang);
  const [menuOpen, setMenuOpen] = useState(false);
  const t = TEXT[lang];

  const setLang = (l) => {
    setLangState(l);
    try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ }
  };

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = lang === 'en' ? 'procureApp — Procurement management' : 'procureApp — Gestion des achats';
  }, [lang]);

  const navLinks = [
    ['#features', t.nav.features],
    ['#cycle', t.nav.cycle],
    ['#suppliers', t.nav.suppliers],
    ['#security', t.nav.security],
    ['#contact', t.nav.contact],
  ];

  return (
    <div className="min-h-screen bg-white text-slate-800 scroll-smooth">
      {/* Navigation */}
      <header className="sticky top-0 z-30 bg-[#090f23]/95 backdrop-blur border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <a href="#top" className="flex items-center gap-2">
            <img src="/images/procureapp-logo.svg" alt="" className="h-9 w-9" />
            <span className="text-lg font-bold text-white">procureApp</span>
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm text-blue-100">
            {navLinks.map(([href, label]) => (
              <a key={href} href={href} className="hover:text-white">{label}</a>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <LangSwitch lang={lang} setLang={setLang} />
            <Link to="/login" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
              <LogIn className="w-4 h-4" /> {t.nav.login}
            </Link>
          </div>

          <button
            type="button"
            className="md:hidden text-white p-2"
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Menu"
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t border-white/10 px-4 py-4 space-y-3">
            {navLinks.map(([href, label]) => (
              <a key={href} href={href} onClick={() => setMenuOpen(false)} className="block text-blue-100 hover:text-white">{label}</a>
            ))}
            <div className="flex items-center justify-between pt-2">
              <LangSwitch lang={lang} setLang={setLang} />
              <Link to="/login" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">
                <LogIn className="w-4 h-4" /> {t.nav.login}
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* Hero */}
      <section id="top" className="relative overflow-hidden bg-[#090f23] text-white">
        <div className="absolute inset-0 opacity-20 bg-[url('/images/app_bg.jpg')] bg-cover bg-center" aria-hidden="true" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#090f23]/40 to-[#090f23]" aria-hidden="true" />
        <div className="relative max-w-6xl mx-auto px-4 py-20 md:py-28 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <span className="inline-block rounded-full bg-blue-500/15 border border-blue-400/30 px-3 py-1 text-xs font-medium text-blue-200">
              {t.hero.badge}
            </span>
            <h1 className="mt-5 text-4xl md:text-5xl font-extrabold leading-tight">{t.hero.title}</h1>
            <p className="mt-5 text-lg text-blue-100/90 leading-relaxed">{t.hero.subtitle}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/login" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:opacity-90">
                {t.hero.cta} <ArrowRight className="w-4 h-4" />
              </Link>
              <Link to="/supplier-register" className="inline-flex items-center gap-2 rounded-lg border border-white/30 px-6 py-3 font-semibold text-white hover:bg-white/10">
                <Store className="w-4 h-4" /> {t.hero.ctaSupplier}
              </Link>
            </div>
            <dl className="mt-10 grid grid-cols-3 gap-4 max-w-md">
              {t.hero.stats.map(([value, label]) => (
                <div key={label}>
                  <dt className="sr-only">{label}</dt>
                  <dd className="text-2xl font-bold text-white">{value}</dd>
                  <dd className="text-xs text-blue-200">{label}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Aperçu stylisé du workflow */}
          <div className="hidden md:block">
            <div className="rounded-2xl bg-white/5 border border-white/10 p-6 shadow-2xl">
              {t.cycle.steps.map(([Icon, label], i) => (
                <div key={label} className="flex items-center gap-4 py-2.5">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${i < 4 ? 'bg-emerald-500/20 text-emerald-300' : i === 4 ? 'bg-blue-500/25 text-blue-200' : 'bg-white/10 text-blue-200/60'}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{label}</div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-white/10">
                      <div className={`h-1.5 rounded-full ${i < 4 ? 'bg-emerald-400 w-full' : i === 4 ? 'bg-blue-400 w-1/2' : 'w-0'}`} />
                    </div>
                  </div>
                  {i < 4 && <CheckCircle2 className="w-4 h-4 text-emerald-300" />}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Fonctionnalités */}
      <section id="features" className="py-20 bg-slate-50 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-3xl font-bold text-slate-900">{t.features.title}</h2>
            <p className="mt-3 text-slate-600">{t.features.subtitle}</p>
          </div>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {t.features.items.map(([Icon, title, desc]) => (
              <div key={title} className="rounded-xl bg-white border border-slate-200 p-6 hover:shadow-md transition">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="mt-4 font-semibold text-slate-900">{title}</h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cycle d'achat */}
      <section id="cycle" className="py-20 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-3xl font-bold text-slate-900">{t.cycle.title}</h2>
            <p className="mt-3 text-slate-600">{t.cycle.subtitle}</p>
          </div>
          <ol className="mt-12 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
            {t.cycle.steps.map(([Icon, label], i) => (
              <li key={label} className="relative flex flex-col items-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-md">
                  <Icon className="w-6 h-6" />
                </div>
                <span className="mt-2 text-xs font-semibold text-blue-700">{String(i + 1).padStart(2, '0')}</span>
                <span className="mt-1 text-sm font-medium text-slate-800">{label}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Fournisseurs */}
      <section id="suppliers" className="py-20 bg-slate-50 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white">
              <Truck className="w-6 h-6" />
            </div>
            <h2 className="mt-5 text-3xl font-bold text-slate-900">{t.suppliers.title}</h2>
            <p className="mt-3 text-slate-600 leading-relaxed">{t.suppliers.subtitle}</p>
            <Link to="/supplier-register" className="mt-8 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:opacity-90">
              {t.suppliers.cta} <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <ul className="space-y-4">
            {t.suppliers.points.map(p => (
              <li key={p} className="flex gap-3 rounded-xl bg-white border border-slate-200 p-4">
                <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 mt-0.5" />
                <span className="text-slate-700">{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Sécurité */}
      <section id="security" className="py-20 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-slate-900 text-center">{t.security.title}</h2>
          <div className="mt-12 grid md:grid-cols-3 gap-6">
            {t.security.items.map(([Icon, title, desc]) => (
              <div key={title} className="rounded-xl border border-slate-200 p-6">
                <Icon className="w-7 h-7 text-blue-700" />
                <h3 className="mt-4 font-semibold text-slate-900">{title}</h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="py-20 bg-slate-50 scroll-mt-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold text-slate-900">{t.contact.title}</h2>
          <p className="mt-3 text-slate-600">{t.contact.subtitle}</p>
          <div className="mt-10 grid sm:grid-cols-2 gap-6 text-left">
            <a
              href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t.contact.mailSubject)}`}
              className="flex items-center gap-4 rounded-xl bg-white border border-slate-200 p-5 hover:shadow-md transition"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                <Mail className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm text-slate-500">{t.contact.email}</div>
                <div className="font-semibold text-slate-900 break-all">{CONTACT_EMAIL}</div>
              </div>
            </a>
            <a
              href={`tel:${CONTACT_PHONE}`}
              className="flex items-center gap-4 rounded-xl bg-white border border-slate-200 p-5 hover:shadow-md transition"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                <Phone className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm text-slate-500">{t.contact.phone}</div>
                <div className="font-semibold text-slate-900">{CONTACT_PHONE_DISPLAY}</div>
              </div>
            </a>
          </div>
        </div>
      </section>

      {/* Appel à l'action */}
      <section className="bg-[#090f23] text-white py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold">{t.cta.title}</h2>
          <p className="mt-3 text-blue-100">{t.cta.subtitle}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/login" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:opacity-90">
              <LogIn className="w-4 h-4" /> {t.cta.login}
            </Link>
            <Link to="/supplier-register" className="inline-flex items-center gap-2 rounded-lg border border-white/30 px-6 py-3 font-semibold text-white hover:bg-white/10">
              <Store className="w-4 h-4" /> {t.hero.ctaSupplier}
            </Link>
          </div>
        </div>
      </section>

      {/* Pied de page */}
      <footer className="bg-[#060a18] text-blue-200/80 py-8">
        <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4 text-sm">
          <div className="flex items-center gap-2">
            <img src="/images/procureapp-logo.svg" alt="" className="h-6 w-6" />
            <span className="font-semibold text-white">procureApp</span>
            <span>— {t.footer.by} <strong className="text-white">{OWNER}</strong></span>
          </div>
          <div className="flex items-center gap-4">
            <LangSwitch lang={lang} setLang={setLang} />
            <span>© {new Date().getFullYear()} {OWNER}. {t.footer.rights}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
