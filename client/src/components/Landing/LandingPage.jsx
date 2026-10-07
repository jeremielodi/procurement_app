// src/components/Landing/LandingPage.jsx
// Page vitrine publique — affichée sur « / » pour un visiteur non connecté (textes : landing.* des locales)
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ShoppingCart, CheckCircle2, Building2, ShieldCheck, Truck, Receipt, CreditCard,
  Workflow, BarChart3, Bell, Lock, FileSpreadsheet, Gavel, ArrowRight, Menu, X,
  ClipboardCheck, PackageCheck, LogIn, Store, FileText, Warehouse, Layers, Laptop, History, Sparkles,
} from 'lucide-react';
import { t as tr, useTranslation } from '../../i18n';
import LanguageSwitcher from '../Common/LanguageSwitcher';
import ContactForm from './ContactForm';

const OWNER = 'Digitales Solutions';

// Icônes des listes (dans l'ordre des tableaux de landing.* dans src/locales/*.json)
const FEATURE_ICONS = [ShoppingCart, Workflow, Gavel, FileText, Receipt, BarChart3, Bell, FileSpreadsheet];
const STEP_ICONS = [ClipboardCheck, CheckCircle2, Gavel, FileText, PackageCheck, Receipt, CreditCard];
const STOCK_ICONS = [Warehouse, PackageCheck, Truck, Layers, Laptop, History];
const SECURITY_ICONS = [Building2, Lock, ShieldCheck];

// Textes de la page (landing.*) mis en forme pour le rendu
function landingText() {
  const get = (k) => tr(`landing.${k}`, { returnObjects: true });
  const hero = get('hero');
  const features = get('features');
  const cycle = get('cycle');
  const security = get('security');
  const stock = get('stock');
  return {
    nav: get('nav'),
    hero: { ...hero, stats: hero.stats.map(s => [s.value, s.label]) },
    features: { ...features, items: features.items.map((it, i) => [FEATURE_ICONS[i], it.title, it.desc]) },
    cycle: { ...cycle, steps: cycle.steps.map((label, i) => [STEP_ICONS[i], label]) },
    stock: { ...stock, items: stock.items.map((it, i) => [STOCK_ICONS[i], it.title, it.desc]) },
    suppliers: get('suppliers'),
    security: { ...security, items: security.items.map((it, i) => [SECURITY_ICONS[i], it.title, it.desc]) },
    contact: get('contact'),
    cta: get('cta'),
    footer: get('footer'),
  };
}

export default function LandingPage() {
  const { lang } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const t = landingText();

  useEffect(() => {
    document.title = tr('landing.pageTitle');
  }, [lang]);

  const navLinks = [
    ['#features', t.nav.features],
    ['#cycle', t.nav.cycle],
    ['#stock', t.nav.stock],
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
            <LanguageSwitcher dark />
            <Link to="/login" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
              <LogIn className="w-4 h-4" /> {t.nav.login}
            </Link>
          </div>

          <button
            type="button"
            className="md:hidden text-white p-2"
            onClick={() => setMenuOpen(o => !o)}
            aria-label={t.nav.menu}
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
              <LanguageSwitcher dark />
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

      {/* Gestion de stock */}
      <section id="stock" className="py-20 bg-[#090f23] text-white scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 px-3 py-1 text-xs font-semibold text-emerald-300">
              <Sparkles className="w-3.5 h-3.5" /> {t.stock.badge}
            </span>
            <h2 className="mt-4 text-3xl font-bold">{t.stock.title}</h2>
            <p className="mt-3 text-blue-100/90 leading-relaxed">{t.stock.subtitle}</p>
          </div>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {t.stock.items.map(([Icon, title, desc]) => (
              <div key={title} className="rounded-xl bg-white/5 border border-white/10 p-6 hover:bg-white/10 transition">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-500/20 text-blue-200">
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-blue-100/80 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
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
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold text-slate-900">{t.contact.title}</h2>
          <p className="mt-3 text-slate-600">{t.contact.subtitle}</p>
          <ContactForm />
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
            <LanguageSwitcher dark />
            <span>© {new Date().getFullYear()} {OWNER}. {t.footer.rights}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
