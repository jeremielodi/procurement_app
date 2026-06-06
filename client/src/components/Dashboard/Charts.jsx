// src/components/Dashboard/Charts.jsx
import React, { useState, useEffect } from 'react'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ComposedChart,
  Scatter
} from 'recharts'
import { Calendar, TrendingUp, TrendingDown, DollarSign, Package, Users } from 'lucide-react'
import { dashboardService } from '../../services/dashboardService'
import { formatCurrency, formatNumber } from '../../utils/formatters'

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16']

export default function Charts({ data: requisitionsData }) {
  const [timeRange, setTimeRange] = useState('month')
  const [chartData, setChartData] = useState({
    monthlyTrend: [],
    statusDistribution: [],
    departmentData: [],
    budgetUtilization: [],
    topSuppliers: [],
    procurementMethods: [],
    performanceMetrics: []
  })
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    loadChartData()
  }, [timeRange])

  const loadChartData = async () => {
    setIsLoading(true)
    try {
      const result = await dashboardService.getChartData(timeRange)
      setChartData(result.data || generateMockData())
    } catch (error) {
      console.error('Error loading chart data:', error)
      setChartData(generateMockData())
    } finally {
      setIsLoading(false)
    }
  }

  const generateMockData = () => {
    // Données mensuelles
    const months = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']
    const monthlyTrend = months.slice(0, 6).map((month, i) => ({
      month,
      requisitions: Math.floor(Math.random() * 50) + 20,
      amount: Math.floor(Math.random() * 100000) + 50000,
      approved: Math.floor(Math.random() * 40) + 10,
      completed: Math.floor(Math.random() * 30) + 5
    }))

    // Distribution des statuts
    const statusDistribution = [
      { name: 'En attente', value: 25, color: '#F59E0B' },
      { name: 'Approuvées', value: 35, color: '#10B981' },
      { name: 'En cours', value: 20, color: '#3B82F6' },
      { name: 'Rejetées', value: 10, color: '#EF4444' },
      { name: 'Terminées', value: 10, color: '#8B5CF6' }
    ]

    // Données par département
    const departmentData = [
      { department: 'IT', amount: 250000, count: 45, budget: 300000 },
      { department: 'Administration', amount: 180000, count: 32, budget: 200000 },
      { department: 'Operations', amount: 320000, count: 58, budget: 400000 },
      { department: 'Finance', amount: 95000, count: 18, budget: 120000 },
      { department: 'HR', amount: 75000, count: 15, budget: 100000 }
    ]

    // Utilisation budgétaire
    const budgetUtilization = departmentData.map(dept => ({
      ...dept,
      utilization: (dept.amount / dept.budget) * 100
    }))

    // Top fournisseurs
    const topSuppliers = [
      { name: 'Fournisseur A', amount: 125000, orders: 12, rating: 4.8 },
      { name: 'Fournisseur B', amount: 98000, orders: 8, rating: 4.5 },
      { name: 'Fournisseur C', amount: 87000, orders: 10, rating: 4.2 },
      { name: 'Fournisseur D', amount: 65000, orders: 6, rating: 4.9 },
      { name: 'Fournisseur E', amount: 54000, orders: 7, rating: 4.3 }
    ]

    // Méthodes d'achat
    const procurementMethods = [
      { name: 'Achat direct', value: 45, amount: 180000 },
      { name: 'Multiples devis', value: 30, amount: 250000 },
      { name: 'Appel d\'offres', value: 15, amount: 320000 },
      { name: 'Source unique', value: 10, amount: 95000 }
    ]

    // Métriques de performance
    const performanceMetrics = {
      averageProcessingTime: 12.5,
      onTimeDelivery: 92,
      budgetCompliance: 88,
      supplierSatisfaction: 4.5
    }

    return {
      monthlyTrend,
      statusDistribution,
      departmentData,
      budgetUtilization,
      topSuppliers,
      procurementMethods,
      performanceMetrics
    }
  }

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 shadow-lg rounded-lg border border-gray-200">
          <p className="font-semibold text-gray-800">{label}</p>
          {payload.map((entry, index) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {entry.name}: {entry.name.includes('amount') || entry.name.includes('budget') 
                ? formatCurrency(entry.value) 
                : formatNumber(entry.value)}
            </p>
          ))}
        </div>
      )
    }
    return null
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Filtres de temps */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-800">Analyses et Statistiques</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setTimeRange('week')}
            className={`px-3 py-1 text-sm rounded-lg transition-colors ${
              timeRange === 'week' 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Semaine
          </button>
          <button
            onClick={() => setTimeRange('month')}
            className={`px-3 py-1 text-sm rounded-lg transition-colors ${
              timeRange === 'month' 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Mois
          </button>
          <button
            onClick={() => setTimeRange('year')}
            className={`px-3 py-1 text-sm rounded-lg transition-colors ${
              timeRange === 'year' 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Année
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Graphique linéaire - Tendances mensuelles */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Tendance des Achats</h3>
            <TrendingUp size={20} className="text-green-500" />
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData.monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="requisitions"
                stroke="#3B82F6"
                name="Nombre de réquisitions"
                strokeWidth={2}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="amount"
                stroke="#10B981"
                name="Montant (USD)"
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Graphique circulaire - Distribution des statuts */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Distribution par Statut</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={chartData.statusDistribution}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {chartData.statusDistribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color || COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Graphique à barres - Par département */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Achats par Département</h3>
            <Package size={20} className="text-blue-500" />
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData.departmentData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="department" />
              <YAxis />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Bar dataKey="amount" name="Montant (USD)" fill="#3B82F6" />
              <Bar dataKey="count" name="Nombre" fill="#10B981" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Graphique en aires - Utilisation budgétaire */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Utilisation Budgétaire</h3>
            <DollarSign size={20} className="text-yellow-500" />
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData.budgetUtilization}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="department" />
              <YAxis />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Area
                type="monotone"
                dataKey="utilization"
                name="Utilisation (%)"
                stroke="#F59E0B"
                fill="#F59E0B"
                fillOpacity={0.3}
              />
              <Area
                type="monotone"
                dataKey="budget"
                name="Budget (USD)"
                stroke="#3B82F6"
                fill="#3B82F6"
                fillOpacity={0.1}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Top fournisseurs */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Top Fournisseurs</h3>
            <Users size={20} className="text-purple-500" />
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={chartData.topSuppliers}
              layout="vertical"
              margin={{ top: 5, right: 30, left: 80, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Bar dataKey="amount" name="Montant (USD)" fill="#8B5CF6" />
              <Bar dataKey="orders" name="Nombre de commandes" fill="#EC4899" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Méthodes d'achat */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Méthodes d'Achat</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={chartData.procurementMethods}
                cx="50%"
                cy="50%"
                labelLine={true}
                label={({ name, value }) => `${name}: ${value}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {chartData.procurementMethods.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Métriques de performance */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Indicateurs de Performance</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">
              {chartData.performanceMetrics?.averageProcessingTime || 0} jours
            </div>
            <div className="text-sm text-gray-500 mt-1">Délai moyen de traitement</div>
            <div className="flex items-center justify-center mt-2">
              <TrendingDown size={16} className="text-green-500 mr-1" />
              <span className="text-xs text-green-600">-2.5% vs mois dernier</span>
            </div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">
              {chartData.performanceMetrics?.onTimeDelivery || 0}%
            </div>
            <div className="text-sm text-gray-500 mt-1">Livraison à temps</div>
            <div className="flex items-center justify-center mt-2">
              <TrendingUp size={16} className="text-green-500 mr-1" />
              <span className="text-xs text-green-600">+5.2% vs mois dernier</span>
            </div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-yellow-600">
              {chartData.performanceMetrics?.budgetCompliance || 0}%
            </div>
            <div className="text-sm text-gray-500 mt-1">Conformité budgétaire</div>
            <div className="flex items-center justify-center mt-2">
              <TrendingUp size={16} className="text-green-500 mr-1" />
              <span className="text-xs text-green-600">+3.1% vs mois dernier</span>
            </div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-600">
              {chartData.performanceMetrics?.supplierSatisfaction || 0}/5
            </div>
            <div className="text-sm text-gray-500 mt-1">Satisfaction fournisseurs</div>
            <div className="flex items-center justify-center mt-2">
              <TrendingUp size={16} className="text-green-500 mr-1" />
              <span className="text-xs text-green-600">+0.3 vs mois dernier</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}