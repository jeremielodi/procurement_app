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
import { t } from '../../i18n';

export default function KpiCards({ kpis }) {
  if (!kpis) return null;

  const items = [
    {
      label: t('dashboard.kpi.approvalRate'),
      value: `${kpis.approvalRate || 0}%`,
      icon: CheckCircle,
      color: 'green',
      subtitle: t('dashboard.kpi.approvalRateSub', { rate: kpis.approvalRate || 0 }),
    },
    {
      label: t('dashboard.kpi.conversionRate'),
      value: `${kpis.conversionRate || 0}%`,
      icon: TrendingUp,
      color: 'blue',
      subtitle: t('dashboard.kpi.conversionRateSub'),
    },
    {
      label: t('dashboard.kpi.approvalDelay'),
      value: t('dashboard.kpi.days', { count: kpis.avgApprovalDays || 0 }),
      icon: Clock,
      color: 'yellow',
      subtitle: t('dashboard.kpi.approvalDelaySub'),
    },
    {
      label: t('dashboard.kpi.supplierSatisfaction'),
      value: `${kpis.supplierSatisfaction || 0}/5`,
      icon: Users,
      color: 'purple',
      subtitle: t('dashboard.kpi.evaluations', { count: kpis.totalSupplierEvaluations || 0 }),
    },
    {
      label: t('dashboard.kpi.onTime'),
      value: `${kpis.onTimeDelivery || 0}%`,
      icon: Award,
      color: 'green',
      subtitle: t('dashboard.kpi.onTimeSub'),
    },
    {
      label: t('dashboard.kpi.budgetCompliance'),
      value: `${kpis.budgetCompliance || 0}%`,
      icon: DollarSign,
      color: 'indigo',
      subtitle: t('dashboard.kpi.budgetComplianceSub'),
    },
  ];

  // Croissance annuelle
  if (kpis.yearOverYear) {
    const growth = kpis.yearOverYear.requisitions.growth;
    items.push({
      label: t('dashboard.kpi.growth'),
      value: `${growth}%`,
      icon: growth > 0 ? TrendingUp : TrendingDown,
      color: growth > 0 ? 'green' : 'red',
      subtitle: t('dashboard.kpi.growthSub', { current: kpis.yearOverYear.requisitions.current, previous: kpis.yearOverYear.requisitions.previous }),
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