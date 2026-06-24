// src/pages/Dashboard/Dashboard.jsx
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardService } from '../../services/dashboardService';
import StatsCards from './StatsCards';
import ChartsSection from './ChartsSection';
import RecentRequisitions from './RecentRequisitions';
import RecentActivities from './RecentActivities';
import AlertsSection from './AlertsSection';
import KpiCards from './KpiCards';
import LoadingSpinner from '../../components/Common/LoadingSpinner';
import ErrorBoundary from '../../components/Common/ErrorBoundary';

export default function Dashboard() {
  const [period, setPeriod] = useState('month');
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', period],
    queryFn: () => dashboardService.getDashboardData(period),
    refetchInterval: 30000,
    staleTime: 10000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <LoadingSpinner size="lg" text="Chargement du tableau de bord..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          <h3 className="font-semibold">Erreur de chargement</h3>
          <p>Impossible de charger les données du tableau de bord. Veuillez réessayer.</p>
          <button 
            onClick={() => refetch()} 
            className="mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  const dashboardData = data?.data || {};

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex flex-wrap items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Tableau de bord
              </h1>
              <p className="text-sm text-gray-500">
                Vue d'ensemble de l'activité d'achats
              </p>
            </div>
            
            {/* Controls */}
            <div className="flex items-center space-x-4">
              {/* Période selector */}
              <div className="flex rounded-md shadow-sm">
                <button
                  onClick={() => setPeriod('week')}
                  className={`px-3 py-1 text-sm font-medium rounded-l-md border ${
                    period === 'week'
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  Semaine
                </button>
                <button
                  onClick={() => setPeriod('month')}
                  className={`px-3 py-1 text-sm font-medium border-t border-b ${
                    period === 'month'
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  Mois
                </button>
                <button
                  onClick={() => setPeriod('year')}
                  className={`px-3 py-1 text-sm font-medium rounded-r-md border ${
                    period === 'year'
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  Année
                </button>
              </div>

              {/* Refresh button */}
              <button
                onClick={() => refetch()}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                title="Actualiser"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="p-6 space-y-6">
          {/* KPI Cards */}
          <KpiCards kpis={dashboardData.kpis} />

          {/* Alertes */}
          {dashboardData.alerts && (
            <AlertsSection alerts={dashboardData.alerts} />
          )}

          {/* Stats Cards */}
          <StatsCards stats={dashboardData.stats} />

          {/* Charts */}
          <ChartsSection 
            chartData={dashboardData.chartData}
            period={period}
          />

          {/* Recent Requisitions & Activities */}
          {/* <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RecentRequisitions requisitions={dashboardData.recentRequisitions} />
            <RecentActivities activities={dashboardData.recentActivities} />
          </div> */}

          {/* Department & Supplier Summary */}
          {/* <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <DepartmentSummary departments={dashboardData.departmentSummary} />
            <SupplierSummary suppliers={dashboardData.supplierSummary} />
          </div> */}

          {/* Project Stats */}
          {/* <ProjectStats projects={dashboardData.projectStats} /> */}
        </div>
      </div>
    </ErrorBoundary>
  );
}