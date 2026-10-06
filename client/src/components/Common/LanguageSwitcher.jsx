// src/components/Common/LanguageSwitcher.jsx
// Sélecteur de langue — les langues proviennent des fichiers src/locales/*.json
import React from 'react';
import { Globe } from 'lucide-react';
import { useTranslation } from '../../i18n';

/**
 * variant « pills » : boutons FR | EN (fond sombre ou clair selon `dark`)
 * variant « select » : liste déroulante (utile au-delà de 3 langues)
 */
export default function LanguageSwitcher({ variant = 'pills', dark = false, className = '' }) {
  const { t, lang, setLang, languages } = useTranslation();

  if (variant === 'select' || languages.length > 3) {
    return (
      <label className={`inline-flex items-center gap-1.5 text-sm ${dark ? 'text-blue-100' : 'text-gray-600'} ${className}`}>
        <Globe size={16} aria-hidden="true" />
        <span className="sr-only">{t('common.language')}</span>
        <select
          value={lang}
          onChange={e => setLang(e.target.value)}
          className={`rounded-md border px-2 py-1 text-sm ${dark ? 'bg-transparent border-white/20 text-white' : 'border-gray-300 bg-white'}`}
          data-testid="language-select"
        >
          {languages.map(l => <option key={l.code} value={l.code} className="text-gray-900">{l.name}</option>)}
        </select>
      </label>
    );
  }

  return (
    <div
      role="group"
      aria-label={t('common.language')}
      className={`inline-flex items-center rounded-full border p-0.5 text-xs font-semibold ${dark ? 'border-white/20' : 'border-gray-300'} ${className}`}
    >
      <Globe className={`w-3.5 h-3.5 mx-1.5 ${dark ? 'text-blue-200' : 'text-gray-500'}`} aria-hidden="true" />
      {languages.map(l => (
        <button
          key={l.code}
          type="button"
          onClick={() => setLang(l.code)}
          aria-pressed={lang === l.code}
          title={l.name}
          data-testid={`lang-${l.code}`}
          className={`px-2.5 py-1 rounded-full uppercase transition ${lang === l.code
            ? (dark ? 'bg-white text-slate-900' : 'bg-blue-600 text-white')
            : (dark ? 'text-blue-100 hover:text-white' : 'text-gray-600 hover:text-gray-900')}`}
        >
          {l.code}
        </button>
      ))}
    </div>
  );
}
