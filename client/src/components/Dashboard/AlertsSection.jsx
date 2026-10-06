// src/pages/Dashboard/components/AlertsSection.jsx
import React from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Clock, DollarSign, Users, Bell } from 'lucide-react';
import { useCurrency } from '../../contexts/EnterpriseContext';
import { t } from '../../i18n';

export default function AlertsSection({ alerts }) {
  const { formatAmount } = useCurrency();
  if (!alerts) return null;

  const hasAlerts = 
    (alerts.pendingOverdue?.length > 0) ||
    (alerts.budgetAlerts?.length > 0) ||
    (alerts.supplierAlerts?.length > 0);

  if (!hasAlerts) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-green-700 flex items-center">
        <CheckCircle className="w-5 h-5 mr-2" />
        <span>{t('dashboard.alerts.allGood')}</span>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-xl shadow-sm border border-gray-200 p-6"
    >
      <div className="flex items-center mb-4">
        <Bell className="w-5 h-5 text-yellow-500 mr-2" />
        <h3 className="text-lg font-semibold text-gray-800">{t('dashboard.alerts.title')}</h3>
        <span className="ml-3 bg-red-100 text-red-800 text-xs font-medium px-2.5 py-0.5 rounded-full">
          {(alerts.pendingOverdue?.length || 0) + (alerts.budgetAlerts?.length || 0) + (alerts.supplierAlerts?.length || 0)}
        </span>
      </div>

      <div className="space-y-4">
        {/* Réquisitions en retard */}
        {alerts.pendingOverdue?.length > 0 && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded">
            <div className="flex items-start">
              <Clock className="w-5 h-5 text-red-500 mr-2 mt-0.5" />
              <div>
                <h4 className="font-medium text-red-800">{t('dashboard.alerts.pendingTitle')}</h4>
                <p className="text-sm text-red-700">
                  {t('dashboard.alerts.pending', { count: alerts.pendingOverdue.length })}
                </p>
                <div className="mt-2 space-y-1">
                  {alerts.pendingOverdue.slice(0, 3).map(item => (
                    <div key={item.id} className="text-sm text-red-600">
                      {t('dashboard.alerts.pendingItem', { number: item.requisition_number, title: item.title, days: item.days_pending })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Alertes budgétaires */}
        {alerts.budgetAlerts?.length > 0 && (
          <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4 rounded">
            <div className="flex items-start">
              <DollarSign className="w-5 h-5 text-yellow-500 mr-2 mt-0.5" />
              <div>
                <h4 className="font-medium text-yellow-800">{t('dashboard.alerts.budgetTitle')}</h4>
                <p className="text-sm text-yellow-700">
                  {t('dashboard.alerts.budget', { count: alerts.budgetAlerts.length })}
                </p>
                <div className="mt-2 space-y-1">
                  {alerts.budgetAlerts.slice(0, 3).map(item => (
                    <div key={item.id} className="text-sm text-yellow-600">
                      {t('dashboard.alerts.budgetItem', { code: item.entity_code, rate: item.utilization_rate, remaining: formatAmount(item.remaining_amount) })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Alertes fournisseurs */}
        {alerts.supplierAlerts?.length > 0 && (
          <div className="bg-orange-50 border-l-4 border-orange-500 p-4 rounded">
            <div className="flex items-start">
              <Users className="w-5 h-5 text-orange-500 mr-2 mt-0.5" />
              <div>
                <h4 className="font-medium text-orange-800">{t('dashboard.alerts.supplierTitle')}</h4>
                <p className="text-sm text-orange-700">
                  {t('dashboard.alerts.supplier', { count: alerts.supplierAlerts.length })}
                </p>
                <div className="mt-2 space-y-1">
                  {alerts.supplierAlerts.slice(0, 3).map(item => (
                    <div key={item.id} className="text-sm text-orange-600">
                      {t('dashboard.alerts.supplierItem', { name: item.name, rating: item.avg_rating, orders: item.order_count })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}


const CheckCircle = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);