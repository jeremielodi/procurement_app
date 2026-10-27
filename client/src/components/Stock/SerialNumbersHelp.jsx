// src/components/Stock/SerialNumbersHelp.jsx
// Aide à la saisie des n° de série (réception GRN, parc existant) : format, exemple et compteur.
// text : contenu saisi (une unité par ligne) ; expected : nombre d'unités attendu (quantité acceptée), facultatif.
// withAssetTag : « n° de série ; n° d'inventaire » accepté (parc existant seulement) ; sinon (réception) n° de série seul,
// le n° d'inventaire étant toujours attribué automatiquement.
import React from 'react';
import { Info } from 'lucide-react';
import { t } from '../../i18n';

export const countSerialLines = (text) => String(text || '').split(/\r?\n/).filter(s => s.trim()).length;

export default function SerialNumbersHelp({ text = '', expected, withAssetTag = false, className = '' }) {
  const count = countSerialLines(text);
  const hasExpected = Number.isInteger(expected) && expected > 0;
  const complete = hasExpected && count === expected;
  return (
    <div className={`rounded-md border border-blue-100 bg-blue-50 px-2 py-1.5 text-xs text-blue-900 ${className}`} data-testid="serials-help">
      <div className="flex items-center gap-1 font-medium"><Info size={12} className="shrink-0" /> {t('serialsHelp.title')}</div>
      <ul className="mt-0.5 list-disc pl-4 space-y-0.5">
        <li>{t('serialsHelp.onePerLine')}</li>
        <li>{withAssetTag ? t('serialsHelp.format') : t('serialsHelp.autoTag')}</li>
        <li>{withAssetTag ? t('serialsHelp.unique') : t('serialsHelp.uniqueSerial')}</li>
      </ul>
      <pre className="mt-1 rounded bg-white px-1.5 py-1 font-mono text-[11px] leading-4 text-gray-700">{withAssetTag ? t('serialsHelp.example') : t('serialsHelp.exampleSerials')}</pre>
      {hasExpected ? (
        <div className={`mt-1 font-medium ${complete ? 'text-green-700' : 'text-amber-700'}`} data-testid="serials-count">
          {t('serialsHelp.counter', { count, expected })}
        </div>
      ) : count > 0 && (
        <div className="mt-1 font-medium text-gray-700" data-testid="serials-count">{t('serialsHelp.entered', { count })}</div>
      )}
    </div>
  );
}
