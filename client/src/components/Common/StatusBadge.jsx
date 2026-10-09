// src/components/Common/StatusBadge.jsx
import React from 'react'
import {
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  FileText,
  ShoppingBag,
  Users,
  Truck,
  Package,
  DollarSign,
  Send,
  Archive,
  Edit,
  Eye,
  ThumbsUp,
  ThumbsDown,
  Hourglass,
  Shield,
  FileCheck,
  FileX,
  FileWarning,
  FilePlus,
  FileMinus,
  FileSearch,
  FileClock,
  FileDiff,
  FileDigit,
  FileStack
} from 'lucide-react'
import { t, hasKey } from '../../i18n'

const statusConfig = {
  // Statuts des réquisitions
  DRAFT: {
    color: 'gray',
    bgColor: 'bg-gray-100',
    textColor: 'text-gray-800',
    borderColor: 'border-gray-200',
    icon: Edit,
    iconColor: 'text-gray-500'
  },
  PENDING: {
    color: 'yellow',
    bgColor: 'bg-yellow-100',
    textColor: 'text-yellow-800',
    borderColor: 'border-yellow-200',
    icon: Clock,
    iconColor: 'text-yellow-500'
  },
  BUDGET_CHECKED: {
    color: 'blue',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-800',
    borderColor: 'border-blue-200',
    icon: DollarSign,
    iconColor: 'text-blue-500'
  },
  BUDGET_INSUFFICIENT: {
    color: 'red',
    bgColor: 'bg-red-100',
    textColor: 'text-red-800',
    borderColor: 'border-red-200',
    icon: AlertCircle,
    iconColor: 'text-red-500'
  },
  APPROVED: {
    color: 'green',
    bgColor: 'bg-green-100',
    textColor: 'text-green-800',
    borderColor: 'border-green-200',
    icon: CheckCircle,
    iconColor: 'text-green-500'
  },
  REJECTED: {
    color: 'red',
    bgColor: 'bg-red-100',
    textColor: 'text-red-800',
    borderColor: 'border-red-200',
    icon: XCircle,
    iconColor: 'text-red-500'
  },
  IN_PROGRESS: {
    color: 'blue',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-800',
    borderColor: 'border-blue-200',
    icon: RefreshCw,
    iconColor: 'text-blue-500'
  },
  COMPLETED: {
    color: 'green',
    bgColor: 'bg-green-100',
    textColor: 'text-green-800',
    borderColor: 'border-green-200',
    icon: CheckCircle,
    iconColor: 'text-green-500'
  },
  CANCELLED: {
    color: 'gray',
    bgColor: 'bg-gray-100',
    textColor: 'text-gray-800',
    borderColor: 'border-gray-200',
    icon: XCircle,
    iconColor: 'text-gray-500'
  },

  // Statuts des commandes d'achat
  PO_DRAFT: {
    color: 'gray',
    bgColor: 'bg-gray-100',
    textColor: 'text-gray-800',
    borderColor: 'border-gray-200',
    icon: FileText,
    iconColor: 'text-gray-500'
  },
  PO_PENDING: {
    color: 'yellow',
    bgColor: 'bg-yellow-100',
    textColor: 'text-yellow-800',
    borderColor: 'border-yellow-200',
    icon: Hourglass,
    iconColor: 'text-yellow-500'
  },
  PO_APPROVED: {
    color: 'green',
    bgColor: 'bg-green-100',
    textColor: 'text-green-800',
    borderColor: 'border-green-200',
    icon: ThumbsUp,
    iconColor: 'text-green-500'
  },
  PO_REJECTED: {
    color: 'red',
    bgColor: 'bg-red-100',
    textColor: 'text-red-800',
    borderColor: 'border-red-200',
    icon: ThumbsDown,
    iconColor: 'text-red-500'
  },
  PO_SENT: {
    color: 'purple',
    bgColor: 'bg-purple-100',
    textColor: 'text-purple-800',
    borderColor: 'border-purple-200',
    icon: Send,
    iconColor: 'text-purple-500'
  },
  PO_CONFIRMED: {
    color: 'teal',
    bgColor: 'bg-teal-100',
    textColor: 'text-teal-800',
    borderColor: 'border-teal-200',
    icon: ThumbsUp,
    iconColor: 'text-teal-500'
  },

  // Statuts des fournisseurs
  SUPPLIER_ACTIVE: {
    color: 'green',
    bgColor: 'bg-green-100',
    textColor: 'text-green-800',
    borderColor: 'border-green-200',
    icon: Users,
    iconColor: 'text-green-500'
  },
  SUPPLIER_INACTIVE: {
    color: 'gray',
    bgColor: 'bg-gray-100',
    textColor: 'text-gray-800',
    borderColor: 'border-gray-200',
    icon: Users,
    iconColor: 'text-gray-500'
  },
  SUPPLIER_PREQUALIFIED: {
    color: 'blue',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-800',
    borderColor: 'border-blue-200',
    icon: Shield,
    iconColor: 'text-blue-500'
  },
  SUPPLIER_PENDING: {
    color: 'yellow',
    bgColor: 'bg-yellow-100',
    textColor: 'text-yellow-800',
    borderColor: 'border-yellow-200',
    icon: Clock,
    iconColor: 'text-yellow-500'
  },

  // Statuts de livraison
  DELIVERY_PENDING: {
    color: 'yellow',
    bgColor: 'bg-yellow-100',
    textColor: 'text-yellow-800',
    borderColor: 'border-yellow-200',
    icon: Truck,
    iconColor: 'text-yellow-500'
  },
  DELIVERY_PARTIAL: {
    color: 'blue',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-800',
    borderColor: 'border-blue-200',
    icon: Package,
    iconColor: 'text-blue-500'
  },
  DELIVERY_COMPLETE: {
    color: 'green',
    bgColor: 'bg-green-100',
    textColor: 'text-green-800',
    borderColor: 'border-green-200',
    icon: CheckCircle,
    iconColor: 'text-green-500'
  },
  DELIVERY_DELAYED: {
    color: 'red',
    bgColor: 'bg-red-100',
    textColor: 'text-red-800',
    borderColor: 'border-red-200',
    icon: AlertCircle,
    iconColor: 'text-red-500'
  },

  // Statuts de réception
  GRN_CREATED: {
    color: 'blue',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-800',
    borderColor: 'border-blue-200',
    icon: FilePlus,
    iconColor: 'text-blue-500'
  },
  GRN_VALIDATED: {
    color: 'green',
    bgColor: 'bg-green-100',
    textColor: 'text-green-800',
    borderColor: 'border-green-200',
    icon: FileCheck,
    iconColor: 'text-green-500'
  },
  SERVICE_ACCEPTED: {
    color: 'green',
    bgColor: 'bg-green-100',
    textColor: 'text-green-800',
    borderColor: 'border-green-200',
    icon: ThumbsUp,
    iconColor: 'text-green-500'
  },
  SERVICE_REJECTED: {
    color: 'red',
    bgColor: 'bg-red-100',
    textColor: 'text-red-800',
    borderColor: 'border-red-200',
    icon: ThumbsDown,
    iconColor: 'text-red-500'
  },

  // Statuts des factures
  INVOICE_RECEIVED: {
    color: 'blue',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-800',
    borderColor: 'border-blue-200',
    icon: FileText,
    iconColor: 'text-blue-500'
  },
  INVOICE_PROCESSING: {
    color: 'yellow',
    bgColor: 'bg-yellow-100',
    textColor: 'text-yellow-800',
    borderColor: 'border-yellow-200',
    icon: RefreshCw,
    iconColor: 'text-yellow-500'
  },
  INVOICE_PAID: {
    color: 'green',
    bgColor: 'bg-green-100',
    textColor: 'text-green-800',
    borderColor: 'border-green-200',
    icon: CheckCircle,
    iconColor: 'text-green-500'
  },

  // Méthodes d'achat
  DIRECT_PURCHASE: {
    color: 'blue',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-800',
    borderColor: 'border-blue-200',
    icon: ShoppingBag,
    iconColor: 'text-blue-500'
  },
  MULTIPLE_QUOTATIONS: {
    color: 'purple',
    bgColor: 'bg-purple-100',
    textColor: 'text-purple-800',
    borderColor: 'border-purple-200',
    icon: FileSearch,
    iconColor: 'text-purple-500'
  },
  RFP: {
    color: 'indigo',
    bgColor: 'bg-indigo-100',
    textColor: 'text-indigo-800',
    borderColor: 'border-indigo-200',
    icon: FileStack,
    iconColor: 'text-indigo-500'
  },
  SOLE_SOURCE: {
    color: 'orange',
    bgColor: 'bg-orange-100',
    textColor: 'text-orange-800',
    borderColor: 'border-orange-200',
    icon: FileDigit,
    iconColor: 'text-orange-500'
  },

  // Priorités
  PRIORITY_LOW: {
    color: 'gray',
    bgColor: 'bg-gray-100',
    textColor: 'text-gray-800',
    borderColor: 'border-gray-200',
    icon: FileMinus,
    iconColor: 'text-gray-500'
  },
  PRIORITY_MEDIUM: {
    color: 'blue',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-800',
    borderColor: 'border-blue-200',
    icon: FileClock,
    iconColor: 'text-blue-500'
  },
  PRIORITY_HIGH: {
    color: 'orange',
    bgColor: 'bg-orange-100',
    textColor: 'text-orange-800',
    borderColor: 'border-orange-200',
    icon: FileWarning,
    iconColor: 'text-orange-500'
  },
  PRIORITY_URGENT: {
    color: 'red',
    bgColor: 'bg-red-100',
    textColor: 'text-red-800',
    borderColor: 'border-red-200',
    icon: AlertCircle,
    iconColor: 'text-red-500'
  },

  // Statuts génériques
  ACTIVE: {
    color: 'green',
    bgColor: 'bg-green-100',
    textColor: 'text-green-800',
    borderColor: 'border-green-200',
    icon: CheckCircle,
    iconColor: 'text-green-500'
  },
  INACTIVE: {
    color: 'gray',
    bgColor: 'bg-gray-100',
    textColor: 'text-gray-800',
    borderColor: 'border-gray-200',
    icon: XCircle,
    iconColor: 'text-gray-500'
  },
  LOCKED: {
    color: 'red',
    bgColor: 'bg-red-100',
    textColor: 'text-red-800',
    borderColor: 'border-red-200',
    icon: Shield,
    iconColor: 'text-red-500'
  },
  ARCHIVED: {
    color: 'gray',
    bgColor: 'bg-gray-100',
    textColor: 'text-gray-800',
    borderColor: 'border-gray-200',
    icon: Archive,
    iconColor: 'text-gray-500'
  }
}

// Fonction utilitaire pour obtenir la configuration d'un statut (libellé traduit : badge.<statut>)
const getStatusConfig = (status) => {
  const label = status && hasKey(`badge.${status}`) ? t(`badge.${status}`) : (status?.replace(/_/g, ' ') || t('common.unknown'))
  if (statusConfig[status]) return { ...statusConfig[status], label }
  return {
    label,
    color: 'gray',
    bgColor: 'bg-gray-100',
    textColor: 'text-gray-800',
    borderColor: 'border-gray-200',
    icon: FileText,
    iconColor: 'text-gray-500'
  }
}

export default function StatusBadge({ 
  status, 
  size = 'md', 
  showIcon = true, 
  showTooltip = false,
  className = '',
  variant = 'default' // 'default', 'outline', 'solid'
}) {
  const config = getStatusConfig(status)
  const IconComponent = config.icon

  const sizes = {
    sm: {
      padding: 'px-2 py-0.5',
      fontSize: 'text-xs',
      iconSize: 12,
      gap: 'gap-1'
    },
    md: {
      padding: 'px-2.5 py-1',
      fontSize: 'text-sm',
      iconSize: 14,
      gap: 'gap-1.5'
    },
    lg: {
      padding: 'px-3 py-1.5',
      fontSize: 'text-base',
      iconSize: 16,
      gap: 'gap-2'
    }
  }

  const sizeStyles = sizes[size] || sizes.md

  const variants = {
    default: {
      bg: config.bgColor,
      text: config.textColor,
      border: config.borderColor
    },
    outline: {
      bg: 'bg-transparent',
      text: config.textColor,
      border: `border ${config.borderColor}`
    },
    solid: {
      bg: config.textColor.replace('text-', 'bg-').replace('800', '600'),
      text: 'text-white',
      border: 'border-transparent'
    }
  }

  const variantStyles = variants[variant] || variants.default

  const badge = (
    <span
      className={`
        inline-flex items-center ${sizeStyles.gap} ${sizeStyles.padding} 
        ${sizeStyles.fontSize} font-medium rounded-full
        ${variantStyles.bg} ${variantStyles.text} ${variantStyles.border}
        ${className}
      `}
      title={showTooltip ? config.label : undefined}
    >
      {showIcon && IconComponent && (
        <IconComponent size={sizeStyles.iconSize} className={variant === 'solid' ? 'text-white' : config.iconColor} />
      )}
      <span>{config.label}</span>
    </span>
  )

  return badge
}

// Version avec indicateur LED
export const StatusBadgeWithLED = ({ status, size = 'md', showIcon = true }) => {
  const config = getStatusConfig(status)
  const ledColors = {
    gray: 'bg-gray-400',
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    red: 'bg-red-500',
    purple: 'bg-purple-500',
    orange: 'bg-orange-500',
    indigo: 'bg-indigo-500'
  }

  const ledColor = ledColors[config.color] || ledColors.gray

  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${ledColor} animate-pulse`} />
      <StatusBadge status={status} size={size} showIcon={showIcon} />
    </div>
  )
}

// Version pour les tableaux (compacte)
export const TableStatusBadge = ({ status }) => {
  return <StatusBadge status={status} size="sm" showIcon={true} />
}

// Version avec compteur
export const StatusBadgeWithCount = ({ status, count, size = 'md' }) => {
  const config = getStatusConfig(status)
  const IconComponent = config.icon

  return (
    <div className="flex items-center gap-2">
      <StatusBadge status={status} size={size} />
      <span className={`text-xs font-semibold ${config.textColor} bg-${config.color}-100 px-2 py-0.5 rounded-full`}>
        {count}
      </span>
    </div>
  )
}

// Groupe de badges
export const StatusBadgeGroup = ({ statuses, size = 'sm', showIcons = true }) => {
  return (
    <div className="flex flex-wrap gap-2">
      {statuses.map((status, index) => (
        <StatusBadge
          key={index}
          status={status}
          size={size}
          showIcon={showIcons}
        />
      ))}
    </div>
  )
}

// Export de la configuration pour utilisation externe
export { statusConfig, getStatusConfig }