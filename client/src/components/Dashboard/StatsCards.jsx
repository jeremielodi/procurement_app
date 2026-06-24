// src/pages/Dashboard/components/StatsCards.jsx
import React from 'react';
import { motion } from 'framer-motion';
import {
  FileText,
  Clock,
  Users,
  ShoppingCart,
  Package,
  FileCheck,
  CreditCard,
} from 'lucide-react';
import { useCurrency } from '../../contexts/EnterpriseContext';

export default function StatsCards({ stats }) {
  const { formatAmount } = useCurrency();
  if (!stats) return null;

  const cards = [
    {
      title: 'Réquisitions',
      value: stats.requisitions?.total || 0,
      icon: FileText,
      color: 'blue',
      subtitle: `${stats.requisitions?.pendingApprovals || 0} en cours · ${stats.requisitions?.approvedThisMonth || 0} approuvées ce mois`,
    },
    {
      title: 'En attente d\'approbation',
      value: stats.requisitions?.pendingApprovals || 0,
      icon: Clock,
      color: 'yellow',
      subtitle: 'À traiter',
    },
    {
      title: 'Commandes (PO)',
      value: stats.orders?.total || 0,
      icon: ShoppingCart,
      color: 'indigo',
      subtitle: stats.amount?.ordersTotal ? `Total: ${formatAmount(stats.amount.ordersTotal)}` : 'Commandes passées',
    },
    {
      title: 'Bons de réception (GRN)',
      value: stats.grn?.total || 0,
      icon: Package,
      color: 'green',
      subtitle: `${stats.grn?.complete || 0} complets · ${stats.grn?.partial || 0} partiels`,
    },
    {
      title: 'Factures',
      value: stats.invoices?.total || 0,
      icon: FileCheck,
      color: 'purple',
      subtitle: `${stats.invoices?.matched || 0} rapprochées · ${stats.invoices?.mismatch || 0} écarts`,
    },
    {
      title: 'Paiements',
      value: stats.payments?.total || 0,
      icon: CreditCard,
      color: 'pink',
      subtitle: `${stats.payments?.pending || 0} en attente · ${formatAmount(stats.payments?.paidAmount || 0)} payés`,
    },
    {
      title: 'Fournisseurs actifs',
      value: stats.suppliers?.active || 0,
      icon: Users,
      color: 'indigo',
      subtitle: 'Partenaires enregistrés',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {cards.map((card, index) => {
        const Icon = card.icon;
        const colorClasses = {
          blue:   'bg-blue-50 text-blue-600',
          green:  'bg-green-50 text-green-600',
          yellow: 'bg-yellow-50 text-yellow-600',
          purple: 'bg-purple-50 text-purple-600',
          indigo: 'bg-indigo-50 text-indigo-600',
          pink:   'bg-pink-50 text-pink-600',
        };

        return (
          <motion.div
            key={card.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow duration-200"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">{card.title}</p>
                <p className="mt-2 text-2xl font-bold text-gray-900">
                  {typeof card.value === 'number' && card.value > 999
                    ? formatAmount(card.value)
                    : card.value}
                </p>
                {card.subtitle && (
                  <p className="mt-1 text-xs text-gray-500">{card.subtitle}</p>
                )}
              </div>
              <div className={`p-3 rounded-xl ${colorClasses[card.color] || 'bg-gray-50 text-gray-600'}`}>
                <Icon className="w-6 h-6" />
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

