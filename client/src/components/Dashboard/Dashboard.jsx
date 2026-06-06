// src/components/Dashboard/Dashboard.jsx
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { requisitionService } from '../../services/requisitionService'
import StatsCards from './StatsCards'
import Charts from './Charts'
import LoadingSpinner from '../Common/LoadingSpinner'
import TaskList from '../Task/TaskList'

export default function Dashboard() {
  const { data: requisitions, isLoading } = useQuery({
    queryKey: ['requisitions', { limit: 100 }],
    queryFn: () => requisitionService.getAll({ limit: 100 }),
  })

  if (isLoading) return <LoadingSpinner />

  const stats = {
    total: requisitions?.data?.length || 0,
    pending: requisitions?.data?.filter(r => r.status === 'PENDING').length || 0,
    approved: requisitions?.data?.filter(r => r.status === 'APPROVED').length || 0,
    rejected: requisitions?.data?.filter(r => r.status === 'REJECTED').length || 0,
    totalAmount: requisitions?.data?.reduce((sum, r) => sum + (r.estimated_amount || 0), 0) || 0,
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Tableau de bord</h1>
        <p className="text-gray-500">Bienvenue dans votre espace de gestion d'achats</p>
      </div>


      <StatsCards stats={stats} />
      <Charts data={requisitions?.data || []} />
    </div>
  )
}