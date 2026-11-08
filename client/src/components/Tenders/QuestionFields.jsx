// src/components/Tenders/QuestionFields.jsx
// Saisie d'une question posée aux fournisseurs (AO ou bibliothèque) : libellé, type de réponse, obligatoire, aide,
// et pour une liste de choix les options avec leurs points (barème interne, jamais montré au fournisseur).
import { Plus, Trash2 } from 'lucide-react';
import SearchSelect from '../Common/SearchSelect';
import { ANSWER_TYPES } from '../../utils/tenderQuestions';
import { t } from '../../i18n';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50';

export default function QuestionFields({ value, onChange, disabled = false }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  const options = value.options || [];
  const setOption = (i, k, v) => set('options', options.map((o, j) => (j === i ? { ...o, [k]: v } : o)));

  const changeType = (answerType) => onChange({
    ...value,
    answerType,
    // Liste de choix : deux options vides pour commencer
    options: answerType === 'CHOICE' ? (options.length ? options : [{ label: '', score: 0 }, { label: '', score: 0 }]) : [],
  });

  return (
    <div className="space-y-3" data-testid="question-fields">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">{t('tenders.questions.label')}</label>
          <input className={inputCls} value={value.label} maxLength={500} disabled={disabled} data-testid="question-label"
            placeholder={t('tenders.questions.labelPlaceholder')} onChange={e => set('label', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">{t('tenders.questions.type')}</label>
          <SearchSelect value={value.answerType} disabled={disabled} className={inputCls} data-testid="question-type"
            onChange={e => changeType(e.target.value)}>
            {ANSWER_TYPES.map(type => <option key={type} value={type}>{t(`tenders.questions.types.${type}`)}</option>)}
          </SearchSelect>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">{t('tenders.questions.help')}</label>
          <input className={inputCls} value={value.helpText || ''} maxLength={1000} disabled={disabled}
            placeholder={t('tenders.questions.helpPlaceholder')} onChange={e => set('helpText', e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 pb-2">
          <input type="checkbox" checked={value.required !== false} disabled={disabled} data-testid="question-required"
            onChange={e => set('required', e.target.checked)} />
          {t('tenders.questions.required')}
        </label>
      </div>

      {value.answerType === 'CHOICE' && (
        <div className="bg-gray-50 rounded-lg p-3 space-y-2" data-testid="question-options">
          <div className="flex justify-between text-xs text-gray-600">
            <span>{t('tenders.questions.options')}</span>
            <span>{t('tenders.questions.points')}</span>
          </div>
          {options.map((o, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input className={inputCls} value={o.label} maxLength={200} disabled={disabled} data-testid="option-label"
                placeholder={t('tenders.questions.optionPlaceholder', { n: i + 1 })} onChange={e => setOption(i, 'label', e.target.value)} />
              <input type="number" min="0" max="1000" step="any" className={`${inputCls.replace('w-full ', '')} w-24 shrink-0 text-right`} disabled={disabled}
                data-testid="option-score" aria-label={t('tenders.questions.points')}
                value={o.score ?? 0} onChange={e => setOption(i, 'score', e.target.value)} />
              {!disabled && options.length > 2 && (
                <button type="button" onClick={() => set('options', options.filter((_, j) => j !== i))}
                  className="p-2 text-gray-400 hover:text-red-600" title={t('common.delete')}><Trash2 size={16} /></button>
              )}
            </div>
          ))}
          {!disabled && options.length < 20 && (
            <button type="button" onClick={() => set('options', [...options, { label: '', score: 0 }])}
              className="text-sm text-blue-600 hover:underline flex items-center gap-1" data-testid="add-option">
              <Plus size={14} /> {t('tenders.questions.addOption')}
            </button>
          )}
          <p className="text-xs text-gray-500">{t('tenders.questions.pointsHint')}</p>
        </div>
      )}
    </div>
  );
}
