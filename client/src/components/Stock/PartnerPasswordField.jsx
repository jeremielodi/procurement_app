// src/components/Stock/PartnerPasswordField.jsx
// Mot de passe d'un compte de l'espace partenaire, saisi par l'administrateur : « Générer » (12 caractères sans
// caractères ambigus) et afficher / masquer. Utilisé par la fiche partenaire (compte du responsable) et « Autre compte ».
import React, { useState } from 'react';
import { Eye, EyeOff, Wand2 } from 'lucide-react';
import { t } from '../../i18n';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

/** Mot de passe proposé : 12 caractères sans caractères ambigus (0/O, 1/l/I) */
export function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint32Array(12);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

export default function PartnerPasswordField({ value, onChange, label, hint, required = false, testId = 'account-password' }) {
  const [show, setShow] = useState(false);
  return (
    <div className="text-sm">
      <span className="mb-1 block font-medium text-gray-700">{label}{required && ' *'}</span>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} minLength={8} required={required}
            autoComplete="new-password" placeholder={t('partners.passwordPlaceholder')} className={`${inputCls} pr-9 font-mono`} data-testid={testId} />
          <button type="button" onClick={() => setShow(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-800"
            aria-label={show ? t('partners.hidePassword') : t('partners.showPassword')}>
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <button type="button" onClick={() => { onChange(generatePassword()); setShow(true); }}
          className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 text-sm hover:bg-gray-50" data-testid={`${testId}-generate`}>
          <Wand2 size={15} /> {t('partners.generatePassword')}
        </button>
      </div>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
