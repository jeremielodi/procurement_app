// src/pages/Dashboard/components/RecentRequisitions.jsx
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  FileText, 
  Clock, 
  CheckCircle, 
  XCircle, 
  AlertCircle,
  Eye,
  MoreVertical,
  TrendingUp,
  Calendar,
  User,
  Building,
  DollarSign,
  ChevronRight
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Link } from 'react-router-dom';

export default function RecentRequisitions({ requisitions = [], limit = 5 }) {
  const [expanded, setExpanded] = useState(false);
  
  // Limiter le nombre d'éléments affichés
  const displayRequisitions = expanded ? requisitions : requisitions.slice(0, limit);
  
  // Vérifier si nous avons des données
  if (!requisitions || requisitions.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800 flex items-center">
            <FileText className="w-5 h-5 mr-2 text-indigo-500" />
            Réquisitions récentes
          </h3>
        </div>
        <div className="text-center py-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
            <FileText className="w-8 h-8 text-gray-400" />
          </div>
          <p className="text-gray-500">Aucune réquisition récente</p>
          <p className="text-sm text-gray-400 mt-1">Les nouvelles réquisitions apparaîtront ici</p>
        </div>
      </div>
    );
  }

  // Fonction pour obtenir le badge de statut
  const getStatusBadge = (status) => {
    const statusConfig = {
      'DRAFT': { 
        label: 'Brouillon', 
        icon: FileText, 
        className: 'bg-gray-100 text-gray-600 border border-gray-200' 
      },
      'PENDING': { 
        label: 'En attente', 
        icon: Clock, 
        className: 'bg-yellow-100 text-yellow-700 border border-yellow-200' 
      },
      'BUDGET_CHECKED': { 
        label: 'Vérifié budget', 
        icon: CheckCircle, 
        className: 'bg-blue-100 text-blue-700 border border-blue-200' 
      },
      'APPROVED': { 
        label: 'Approuvé', 
        icon: CheckCircle, 
        className: 'bg-green-100 text-green-700 border border-green-200' 
      },
      'REJECTED': { 
        label: 'Rejeté', 
        icon: XCircle, 
        className: 'bg-red-100 text-red-700 border border-red-200' 
      },
      'IN_PROGRESS': { 
        label: 'En cours', 
        icon: TrendingUp, 
        className: 'bg-purple-100 text-purple-700 border border-purple-200' 
      },
      'COMPLETED': { 
        label: 'Terminé', 
        icon: CheckCircle, 
        className: 'bg-green-100 text-green-700 border border-green-200' 
      },
      'CANCELLED': { 
        label: 'Annulé', 
        icon: XCircle, 
        className: 'bg-gray-100 text-gray-600 border border-gray-200' 
      },
      'SUBMITTED': { 
        label: 'Soumis', 
        icon: FileText, 
        className: 'bg-indigo-100 text-indigo-700 border border-indigo-200' 
      },
      'PROCESSING': { 
        label: 'En traitement', 
        icon: AlertCircle, 
        className: 'bg-orange-100 text-orange-700 border border-orange-200' 
      }
    };

    const config = statusConfig[status] || { 
      label: status, 
      icon: FileText, 
      className: 'bg-gray-100 text-gray-600 border border-gray-200' 
    };
    
    const Icon = config.icon;
    
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.className}`}>
        <Icon className="w-3 h-3 mr-1" />
        {config.label}
      </span>
    );
  };

  // Fonction pour formater le montant
  const formatCurrency = (amount, currencySymbol = '€') => {
    if (amount === undefined || amount === null) return '0 €';
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Fonction pour obtenir le temps écoulé
  const getTimeAgo = (date) => {
    if (!date) return '';
    const diff = Math.floor((new Date() - new Date(date)) / 1000);
    
    if (diff < 60) return 'À l\'instant';
    if (diff < 3600) return `${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} h`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} j`;
    return format(new Date(date), 'dd MMM yyyy', { locale: fr });
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center">
          <FileText className="w-5 h-5 text-indigo-500 mr-2" />
          <h3 className="text-lg font-semibold text-gray-800">
            Réquisitions récentes
          </h3>
          <span className="ml-3 bg-indigo-100 text-indigo-800 text-xs font-medium px-2.5 py-0.5 rounded-full">
            {requisitions.length}
          </span>
        </div>
        <Link 
          to="/requisitions" 
          className="text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center"
        >
          Voir tout
          <ChevronRight className="w-4 h-4 ml-1" />
        </Link>
      </div>

      {/* Liste des réquisitions */}
      <div className="divide-y divide-gray-100">
        {displayRequisitions.map((requisition, index) => (
          <motion.div
            key={requisition.id || index}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            className="px-6 py-4 hover:bg-gray-50 transition-colors duration-150 group"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              {/* Colonne gauche - Informations principales */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <Link 
                      to={`/requisitions/${requisition.id}`}
                      className="text-sm font-medium text-gray-900 hover:text-indigo-600 truncate block"
                    >
                      {requisition.title || `Réquisition #${requisition.requisition_number}`}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-gray-500 font-mono">
                        #{requisition.requisition_number}
                      </span>
                      <span className="text-gray-300">|</span>
                      <span className="text-xs text-gray-500 flex items-center">
                        <Building className="w-3 h-3 mr-1" />
                        {requisition.department_name || 'Département non spécifié'}
                      </span>
                      {requisition.project_name && (
                        <>
                          <span className="text-gray-300">|</span>
                          <span className="text-xs text-gray-500 flex items-center">
                            <TrendingUp className="w-3 h-3 mr-1" />
                            {requisition.project_name}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="ml-2 flex-shrink-0">
                    {getStatusBadge(requisition.status)}
                  </div>
                </div>

                {/* Détails supplémentaires */}
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                  <span className="flex items-center">
                    <User className="w-3 h-3 mr-1" />
                    {requisition.first_name} {requisition.last_name || 'N/A'}
                  </span>
                  <span className="flex items-center">
                    <Calendar className="w-3 h-3 mr-1" />
                    {format(new Date(requisition.created_at), 'dd MMM yyyy', { locale: fr })}
                  </span>
                  <span className="flex items-center font-medium text-gray-700">
                    <DollarSign className="w-3 h-3 mr-1" />
                    {formatCurrency(requisition.estimated_amount, requisition.currency_symbol)}
                  </span>
                  <span className="text-gray-400">
                    {getTimeAgo(requisition.created_at)}
                  </span>
                </div>
              </div>

              {/* Colonne droite - Actions */}
              <div className="flex items-center space-x-2 sm:ml-4">
                <Link
                  to={`/requisitions/${requisition.id}`}
                  className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors duration-200"
                  title="Voir la réquisition"
                >
                  <Eye className="w-4 h-4" />
                </Link>
                <button
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors duration-200"
                  title="Plus d'options"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Footer */}
      {requisitions.length > limit && (
        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50">
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full text-center text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center justify-center"
          >
            {expanded ? (
              <>
                <span>Voir moins</span>
                <ChevronRight className="w-4 h-4 ml-1 transform rotate-90" />
              </>
            ) : (
              <>
                <span>Voir plus ({requisitions.length - limit} supplémentaires)</span>
                <ChevronRight className="w-4 h-4 ml-1" />
              </>
            )}
          </button>
        </div>
      )}
    </motion.div>
  );
}