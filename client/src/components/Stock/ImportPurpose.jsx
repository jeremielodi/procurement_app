// src/components/Stock/ImportPurpose.jsx
// Encadré « Pourquoi cet import ? » des fenêtres d'import du stock : à quoi sert l'import, quand l'utiliser, ce qu'il
// enregistre, ce qu'il faut savoir, et l'ordre conseillé (catalogue → parc existant → affectations), étape courante en évidence.
// Textes : stock.importGuide.<kind>.* (why, when[], effects[], cautions[]) et stock.importGuide.steps.*.
import React, { useEffect, useState } from 'react';
import { Info, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle } from 'lucide-react';
import { t } from '../../i18n';

const STEPS = ['catalog', 'units', 'assignments'];

const List = ({ items, icon: Icon, className }) => (
  <ul className="space-y-1">
    {items.map((text, i) => (
      <li key={i} className="flex items-start gap-1.5">
        <Icon size={13} className={`mt-0.5 shrink-0 ${className}`} /> <span>{text}</span>
      </li>
    ))}
  </ul>
);

/** kind : 'catalog' (articles + stock initial) | 'units' (parc existant) ; collapsed : replié (ex. après l'analyse du fichier) */
export default function ImportPurpose({ kind, collapsed = false }) {
  const [open, setOpen] = useState(!collapsed);
  useEffect(() => { setOpen(!collapsed); }, [collapsed]);

  const base = `stock.importGuide.${kind}`;
  const when = t(`${base}.when`, { returnObjects: true });
  const effects = t(`${base}.effects`, { returnObjects: true });
  const cautions = t(`${base}.cautions`, { returnObjects: true });

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 text-sm text-blue-950" data-testid={`import-purpose-${kind}`}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium">
        <Info size={16} className="shrink-0 text-blue-600" />
        <span className="flex-1">{t(`${base}.title`)}</span>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {open && (
        <div className="space-y-3 border-t border-blue-200 px-3 pb-3 pt-2 text-xs leading-relaxed">
          <p className="text-sm">{t(`${base}.why`)}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 font-semibold">{t('stock.importGuide.whenTitle')}</div>
              <List items={Array.isArray(when) ? when : []} icon={CheckCircle2} className="text-blue-600" />
            </div>
            <div>
              <div className="mb-1 font-semibold">{t('stock.importGuide.effectsTitle')}</div>
              <List items={Array.isArray(effects) ? effects : []} icon={CheckCircle2} className="text-green-600" />
            </div>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">
            <div className="mb-1 font-semibold">{t('stock.importGuide.cautionsTitle')}</div>
            <List items={Array.isArray(cautions) ? cautions : []} icon={AlertTriangle} className="text-amber-600" />
          </div>
          <div>
            <div className="mb-1 font-semibold">{t('stock.importGuide.stepsTitle')}</div>
            <ol className="grid gap-1.5 sm:grid-cols-3">
              {STEPS.map((step, i) => (
                <li key={step} className={`rounded-md border p-2 ${step === kind ? 'border-blue-500 bg-white shadow-sm' : 'border-blue-100 bg-blue-50/60 text-blue-900/70'}`}>
                  <div className="font-semibold">{i + 1}. {t(`stock.importGuide.steps.${step}.title`)}{step === kind && <span className="ml-1 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-medium text-white">{t('stock.importGuide.current')}</span>}</div>
                  <div>{t(`stock.importGuide.steps.${step}.text`)}</div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
