// src/components/Dashboard/StatsCards.jsx
import React from 'react'
import { ShoppingCart, CheckCircle, XCircle, Clock, DollarSign } from 'lucide-react'

const StatCard = ({ title, value, icon: Icon, color }) => (
  <div className="bg-white rounded-lg shadow p-6">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-gray-500">{title}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
      </div>
      <div className={`p-3 rounded-full ${color}`}>
        <Icon size={24} className="text-white" />
      </div>
    </div>
  </div>
)


/**
 * Formats a numeric amount into a currency string.
 * @param {number} amount - The numeric value to format.
 * @param {string} [currency='USD'] - The ISO 4217 currency code (e.g., 'USD', 'EUR', 'GBP', 'JPY').
 * @param {string} [locale='en-US'] - The BCP 47 language tag (e.g., 'en-US', 'en-GB', 'de-DE').
 * @returns {string} The formatted currency string.
 */
function formatAmount(amount, currency = 'USD', locale = 'en-US') {
  // Handle edge cases where input might be a string number
  const numericAmount = Number(amount);

  // Check if the input is a valid number
  if (isNaN(numericAmount)) {
    return '0.00';
  }

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency,
    // Optional: minimumFractionDigits: 2,
    // Optional: maximumFractionDigits: 2,
  }).format(numericAmount);
}

export default function StatsCards({ stats }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
      <StatCard
        title="Total Réquisitions"
        value={stats.total}
        icon={ShoppingCart}
        color="bg-blue-500"
      />
      <StatCard
        title="En Attente"
        value={stats.pending}
        icon={Clock}
        color="bg-yellow-500"
      />
      <StatCard
        title="Approuvées"
        value={stats.approved}
        icon={CheckCircle}
        color="bg-green-500"
      />
      <StatCard
        title="Rejetées"
        value={stats.rejected}
       icon={XCircle}
        color="bg-red-500"
      />
      <StatCard
        title="Montant Total"
        value={`${formatAmount(stats.totalAmount)}`}
        icon={DollarSign}
        color="bg-purple-500"
      />
    </div>
  )
}