// Sélection multiple par cases à cocher (localisations, catégories de marché), avec recherche
import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { t } from '../../../i18n';

export default function MultiCheckList({ options = [], value = [], onChange, error, columns = 2, testId }) {
  const [q, setQ] = useState('');
  const selected = new Set(value.map(Number));
  const shown = options.filter(o => !q || o.name.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange([...next]);
  };

  return (
    <div data-testid={testId}>
      {options.length > 8 && (
        <div className="relative mb-2">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('prequal.filter')}
            className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
      )}
      <div className={`grid grid-cols-1 ${columns > 1 ? 'sm:grid-cols-2' : ''} gap-1 border rounded-lg p-2 max-h-56 overflow-y-auto ${error ? 'border-red-500' : 'border-gray-200'}`}>
        {shown.map(o => (
          <label key={o.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 text-sm cursor-pointer">
            <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)}
              className="rounded border-gray-300 text-blue-600" />
            <span>{o.name}{o.province ? <span className="text-gray-400"> · {o.province}</span> : null}</span>
          </label>
        ))}
        {shown.length === 0 && <p className="text-sm text-gray-500 px-2 py-1">{t('common.noResults')}</p>}
      </div>
      <p className={`text-xs mt-1 ${error ? 'text-red-500' : 'text-gray-500'}`}>
        {error || t('prequal.selectedCount', { count: selected.size })}
      </p>
    </div>
  );
}
