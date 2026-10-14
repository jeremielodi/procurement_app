// src/components/Stock/FundingProjectSelect.jsx
// Projet qui a financé une entrée en stock (stock initial, parc existant, ajustement d'entrée) : facultatif.
// Les réceptions (GRN) reprennent automatiquement le projet de la réquisition du bon de commande.
import React, { useEffect, useState } from 'react'
import SearchSelect from '../Common/SearchSelect'
import { projectService } from '../../services/projectService'
import { t } from '../../i18n'

export default function FundingProjectSelect({ value, onChange, className = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm', id, name = 'projectId' }) {
  const [projects, setProjects] = useState([])
  useEffect(() => { projectService.getAll({ is_active: true }).then(r => setProjects(r.data || [])).catch(() => setProjects([])) }, [])
  return (
    <SearchSelect id={id} name={name} value={value || ''} onChange={(e) => onChange(e.target.value)} className={className} data-testid="funding-project">
      <option value="">{t('stock.funding.none')}</option>
      {projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
    </SearchSelect>
  )
}
