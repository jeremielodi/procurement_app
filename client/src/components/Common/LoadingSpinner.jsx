// src/components/Common/LoadingSpinner.jsx
import React from 'react'

export function LoadingSpinner({ size = 'md', color = 'blue', fullScreen = false, text = 'Chargement...' }) {
  const sizes = {
    sm: 'w-5 h-5',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
    xl: 'w-16 h-16'
  }

  const colors = {
    blue: 'border-blue-600',
    green: 'border-green-600',
    red: 'border-red-600',
    yellow: 'border-yellow-600',
    purple: 'border-purple-600',
    gray: 'border-gray-600',
    white: 'border-white'
  }

  const spinnerSize = sizes[size] || sizes.md
  const spinnerColor = colors[color] || colors.blue

  const SpinnerContent = () => (
    <div className="flex flex-col items-center justify-center">
      <div className={`${spinnerSize} animate-spin rounded-full border-4 border-t-transparent ${spinnerColor}`} />
      {text && (
        <p className={`mt-3 text-sm ${color === 'white' ? 'text-white' : 'text-gray-500'}`}>
          {text}
        </p>
      )}
    </div>
  )

  if (fullScreen) {
    return (
      <div className="fixed inset-0 bg-white bg-opacity-90 z-50 flex items-center justify-center">
        <SpinnerContent />
      </div>
    )
  }

  return <SpinnerContent />
}

// Variante pour les boutons
export const ButtonSpinner = ({ size = 'sm' }) => {
  const sizes = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6'
  }

  return (
    <div className={`${sizes[size]} animate-spin rounded-full border-2 border-white border-t-transparent`} />
  )
}

// Variante pour les cartes
export const CardSpinner = () => {
  return (
    <div className="flex justify-center items-center py-12">
      <div className="w-10 h-10 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
    </div>
  )
}

// Variante pour les tableaux
export const TableSpinner = ({ colSpan }) => {
  return (
    <tr>
      <td colSpan={colSpan || 10} className="text-center py-12">
        <div className="flex flex-col items-center justify-center">
          <div className="w-10 h-10 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          <p className="mt-3 text-sm text-gray-500">Chargement des données...</p>
        </div>
      </td>
    </tr>
  )
}

// Variante pour les pages (squelette)
export const SkeletonLoader = ({ type = 'card', count = 3 }) => {
  if (type === 'card') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[...Array(count)].map((_, i) => (
          <div key={i} className="bg-white rounded-lg shadow p-6 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
            <div className="h-3 bg-gray-200 rounded w-1/2 mb-2"></div>
            <div className="h-3 bg-gray-200 rounded w-full mb-2"></div>
            <div className="h-3 bg-gray-200 rounded w-2/3"></div>
          </div>
        ))}
      </div>
    )
  }

  if (type === 'table') {
    return (
      <div className="bg-white rounded-lg shadow overflow-hidden animate-pulse">
        <div className="p-4 border-b border-gray-200">
          <div className="h-6 bg-gray-200 rounded w-1/4"></div>
        </div>
        {[...Array(count)].map((_, i) => (
          <div key={i} className="p-4 border-b border-gray-200">
            <div className="h-4 bg-gray-200 rounded w-full mb-2"></div>
            <div className="h-3 bg-gray-200 rounded w-3/4"></div>
          </div>
        ))}
      </div>
    )
  }

  if (type === 'form') {
    return (
      <div className="space-y-4 animate-pulse">
        <div>
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-2"></div>
          <div className="h-10 bg-gray-200 rounded w-full"></div>
        </div>
        <div>
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-2"></div>
          <div className="h-10 bg-gray-200 rounded w-full"></div>
        </div>
        <div>
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-2"></div>
          <div className="h-24 bg-gray-200 rounded w-full"></div>
        </div>
      </div>
    )
  }

  return null
}

// Variante pour les graphiques
export const ChartSpinner = () => {
  return (
    <div className="flex justify-center items-center h-96">
      <div className="text-center">
        <div className="w-12 h-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent mx-auto" />
        <p className="mt-3 text-gray-500">Chargement des graphiques...</p>
      </div>
    </div>
  )
}

// Variante pour les détails
export const DetailSkeleton = () => {
  return (
    <div className="bg-white rounded-lg shadow p-6 animate-pulse">
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="h-8 bg-gray-200 rounded w-48 mb-2"></div>
          <div className="h-4 bg-gray-200 rounded w-32"></div>
        </div>
        <div className="h-8 bg-gray-200 rounded w-24"></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div className="h-4 bg-gray-200 rounded w-1/3 mb-2"></div>
          <div className="h-6 bg-gray-200 rounded w-full mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/3 mb-2"></div>
          <div className="h-6 bg-gray-200 rounded w-full"></div>
        </div>
        <div>
          <div className="h-4 bg-gray-200 rounded w-1/3 mb-2"></div>
          <div className="h-6 bg-gray-200 rounded w-full mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/3 mb-2"></div>
          <div className="h-6 bg-gray-200 rounded w-full"></div>
        </div>
      </div>
    </div>
  )
}

// Export par défaut
export default LoadingSpinner