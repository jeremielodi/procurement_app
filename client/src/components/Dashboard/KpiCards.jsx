// src/pages/Dashboard/components/KpiCards.jsx
import React from 'react';
import { motion } from 'framer-motion';
import { 
  TrendingUp, 
  TrendingDown, 
  CheckCircle, 
  Clock, 
  DollarSign,
  Users,
  Calendar,
  Award
} from 'lucide-react';

export default function KpiCards({ kpis }) {
  if (!kpis) return null;

  const items = [
    {
      label: 'Taux d\'approbation',
      value: `${kpis.approvalRate || 0}%`,
      icon: CheckCircle,
      color: 'green',
      subtitle: `${kpis.approvalRate || 0}% des réquisitions approuvées`,
    },
    {
      label: 'Taux de conversion',
      value: `${kpis.conversionRate || 0}%`,
      icon: TrendingUp,
      color: 'blue',
      subtitle: 'Réquisitions → Commandes',
    },
    {
      label: 'Délai approbation',
      value: `${kpis.avgApprovalDays || 0} jours`,
      icon: Clock,
      color: 'yellow',
      subtitle: 'Temps moyen d\'approbation',
    },
    {
      label: 'Satisfaction fournisseurs',
      value: `${kpis.supplierSatisfaction || 0}/5`,
      icon: Users,
      color: 'purple',
      subtitle: `${kpis.totalSupplierEvaluations || 0} évaluations`,
    },
    {
      label: 'Livraison à temps',
      value: `${kpis.onTimeDelivery || 0}%`,
      icon: Award,
      color: 'green',
      subtitle: 'Commandes livrées dans les délais',
    },
    {
      label: 'Conformité budgétaire',
      value: `${kpis.budgetCompliance || 0}%`,
      icon: DollarSign,
      color: 'indigo',
      subtitle: 'Respect des budgets',
    },
  ];

  // Croissance annuelle
  if (kpis.yearOverYear) {
    const growth = kpis.yearOverYear.requisitions.growth;
    items.push({
      label: 'Croissance annuelle',
      value: `${growth}%`,
      icon: growth > 0 ? TrendingUp : TrendingDown,
      color: growth > 0 ? 'green' : 'red',
      subtitle: `${kpis.yearOverYear.requisitions.current} vs ${kpis.yearOverYear.requisitions.previous} réquisitions`,
    });
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {items.map((item, index) => {
        const Icon = item.icon;
        const colorClasses = {
          green: 'bg-green-50 text-green-600',
          blue: 'bg-blue-50 text-blue-600',
          yellow: 'bg-yellow-50 text-yellow-600',
          purple: 'bg-purple-50 text-purple-600',
          indigo: 'bg-indigo-50 text-indigo-600',
          red: 'bg-red-50 text-red-600',
        };

        return (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.05 }}
            className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {item.label}
                </p>
                <p className="mt-1 text-xl font-bold text-gray-900">
                  {item.value}
                </p>
                <p className="mt-1 text-xs text-gray-500 truncate">
                  {item.subtitle}
                </p>
              </div>
              <div className={`p-2 rounded-lg ${colorClasses[item.color] || 'bg-gray-50 text-gray-600'}`}>
                <Icon className="w-4 h-4" />
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}