// src/pages/Dashboard/components/RecentActivities.jsx
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Activity, 
  Clock, 
  CheckCircle, 
  XCircle, 
  FileText,
  User,
  Calendar,
  ChevronRight,
  Eye,
  RefreshCw,
  Filter,
  Download,
  AlertCircle,
  ShoppingCart,
  Users,
  DollarSign,
  Building,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  Edit,
  Trash2,
  Send,
  Archive,
  AlertTriangle
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Link } from 'react-router-dom';

export default function RecentActivities({ activities = [], limit = 5 }) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Limiter le nombre d'éléments affichés
  const displayActivities = expanded ? activities : activities.slice(0, limit);
  
  // Filtrer les activités
  const filteredActivities = displayActivities.filter(activity => {
    if (filter !== 'all' && activity.action !== filter) return false;
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return (
        activity.requisition_number?.toLowerCase().includes(search) ||
        activity.requisition_title?.toLowerCase().includes(search) ||
        activity.first_name?.toLowerCase().includes(search) ||
        activity.last_name?.toLowerCase().includes(search) ||
        activity.action?.toLowerCase().includes(search) ||
        activity.task_name?.toLowerCase().includes(search)
      );
    }
    return true;
  });

  // Vérifier si nous avons des données
  if (!activities || activities.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800 flex items-center">
            <Activity className="w-5 h-5 mr-2 text-indigo-500" />
            Activités récentes
          </h3>
        </div>
        <div className="text-center py-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
            <Activity className="w-8 h-8 text-gray-400" />
          </div>
          <p className="text-gray-500">Aucune activité récente</p>
          <p className="text-sm text-gray-400 mt-1">Les activités apparaîtront ici</p>
        </div>
      </div>
    );
  }

  // Fonction pour obtenir l'icône et la couleur de l'action
  const getActionConfig = (action, taskName) => {
    const configs = {
      'CREATED': { 
        icon: FileText, 
        color: 'blue', 
        label: 'Création' 
      },
      'SUBMITTED': { 
        icon: Send, 
        color: 'indigo', 
        label: 'Soumission' 
      },
      'APPROVED': { 
        icon: ThumbsUp, 
        color: 'green', 
        label: 'Approbation' 
      },
      'REJECTED': { 
        icon: ThumbsDown, 
        color: 'red', 
        label: 'Rejet' 
      },
      'MODIFIED': { 
        icon: Edit, 
        color: 'yellow', 
        label: 'Modification' 
      },
      'DELETED': { 
        icon: Trash2, 
        color: 'red', 
        label: 'Suppression' 
      },
      'ARCHIVED': { 
        icon: Archive, 
        color: 'gray', 
        label: 'Archivage' 
      },
      'COMMENTED': { 
        icon: MessageSquare, 
        color: 'purple', 
        label: 'Commentaire' 
      },
      'PENDING': { 
        icon: Clock, 
        color: 'yellow', 
        label: 'En attente' 
      },
      'BUDGET_CHECKED': { 
        icon: DollarSign, 
        color: 'blue', 
        label: 'Vérification budget' 
      },
      'COMPLETED': { 
        icon: CheckCircle, 
        color: 'green', 
        label: 'Terminé' 
      },
      'CANCELLED': { 
        icon: XCircle, 
        color: 'gray', 
        label: 'Annulé' 
      },
      'ORDER_CREATED': { 
        icon: ShoppingCart, 
        color: 'purple', 
        label: 'Commande créée' 
      },
      'SUPPLIER_SELECTED': { 
        icon: Users, 
        color: 'indigo', 
        label: 'Fournisseur sélectionné' 
      },
      'RECEIVED': { 
        icon: CheckCircle, 
        color: 'green', 
        label: 'Réception' 
      },
      'IN_PROGRESS': { 
        icon: RefreshCw, 
        color: 'purple', 
        label: 'En cours' 
      },
      'ESCALATED': { 
        icon: AlertTriangle, 
        color: 'orange', 
        label: 'Escaladé' 
      }
    };

    // Chercher par action ou par taskName
    let config = configs[action];
    if (!config && taskName) {
      // Essayer de trouver une correspondance dans les clés
      const key = Object.keys(configs).find(k => 
        taskName.toUpperCase().includes(k) || 
        k.includes(taskName.toUpperCase())
      );
      config = configs[key];
    }

    // Config par défaut
    if (!config) {
      config = { 
        icon: Activity, 
        color: 'gray', 
        label: action || taskName || 'Action' 
      };
    }

    const Icon = config.icon;
    const colorClasses = {
      blue: 'bg-blue-100 text-blue-600 border-blue-200',
      indigo: 'bg-indigo-100 text-indigo-600 border-indigo-200',
      green: 'bg-green-100 text-green-600 border-green-200',
      red: 'bg-red-100 text-red-600 border-red-200',
      yellow: 'bg-yellow-100 text-yellow-600 border-yellow-200',
      purple: 'bg-purple-100 text-purple-600 border-purple-200',
      gray: 'bg-gray-100 text-gray-600 border-gray-200',
      orange: 'bg-orange-100 text-orange-600 border-orange-200',
      pink: 'bg-pink-100 text-pink-600 border-pink-200',
    };

    return {
      ...config,
      icon: Icon,
      className: colorClasses[config.color] || colorClasses.gray,
    };
  };

  // Fonction pour obtenir le temps écoulé
  const getTimeAgo = (date) => {
    if (!date) return '';
    const diff = Math.floor((new Date() - new Date(date)) / 1000);
    
    if (diff < 60) return 'À l\'instant';
    if (diff < 3600) return `Il y a ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `Il y a ${Math.floor(diff / 3600)} h`;
    if (diff < 604800) return `Il y a ${Math.floor(diff / 86400)} j`;
    return format(new Date(date), 'dd MMM yyyy à HH:mm', { locale: fr });
  };

  // Obtenir les actions uniques pour le filtre
  const uniqueActions = ['all', ...new Set(activities.map(a => a.action).filter(Boolean))];

  // Fonction pour obtenir le libellé de l'action
  const getActionLabel = (action) => {
    const config = getActionConfig(action);
    return config.label;
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center">
            <Activity className="w-5 h-5 text-indigo-500 mr-2" />
            <h3 className="text-lg font-semibold text-gray-800">
              Activités récentes
            </h3>
            <span className="ml-3 bg-indigo-100 text-indigo-800 text-xs font-medium px-2.5 py-0.5 rounded-full">
              {activities.length}
            </span>
          </div>
          
          {/* Filtres et recherche */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Filtre par action */}
            <div className="relative">
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="appearance-none pl-3 pr-8 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                {uniqueActions.map(action => (
                  <option key={action} value={action}>
                    {action === 'all' ? 'Toutes les actions' : getActionLabel(action)}
                  </option>
                ))}
              </select>
              <Filter className="w-4 h-4 text-gray-400 absolute right-2 top-1/2 transform -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Recherche */}
            <div className="relative">
              <input
                type="text"
                placeholder="Rechercher..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 w-40 sm:w-48"
              />
              <Search className="w-4 h-4 text-gray-400 absolute left-2 top-1/2 transform -translate-y-1/2" />
            </div>

            {/* Bouton d'export */}
            <button
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="Exporter les activités"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Liste des activités */}
      <div className="divide-y divide-gray-100">
        {filteredActivities.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <p className="text-gray-500">Aucune activité ne correspond aux filtres</p>
            <button
              onClick={() => { setFilter('all'); setSearchTerm(''); }}
              className="mt-2 text-sm text-indigo-600 hover:text-indigo-800"
            >
              Réinitialiser les filtres
            </button>
          </div>
        ) : (
          filteredActivities.map((activity, index) => {
            const actionConfig = getActionConfig(activity.action, activity.task_name);
            const Icon = actionConfig.icon;
            const isRequisition = activity.entity_type === 'requisition';
            
            return (
              <motion.div
                key={activity.id || index}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="px-6 py-4 hover:bg-gray-50 transition-colors duration-150 group"
              >
                <div className="flex items-start space-x-4">
                  {/* Icône d'action */}
                  <div className={`flex-shrink-0 p-2 rounded-lg border ${actionConfig.className}`}>
                    <Icon className="w-4 h-4" />
                  </div>

                  {/* Contenu */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-900">
                            {activity.first_name} {activity.last_name || 'Utilisateur'}
                          </span>
                          <span className="text-xs text-gray-400">•</span>
                          <span className="text-sm text-gray-600">
                            {actionConfig.label}
                          </span>
                          {isRequisition && activity.requisition_number && (
                            <>
                              <span className="text-xs text-gray-400">•</span>
                              <Link
                                to={`/requisitions/${activity.entity_id}`}
                                className="text-sm font-mono text-indigo-600 hover:text-indigo-800 hover:underline"
                              >
                                #{activity.requisition_number}
                              </Link>
                            </>
                          )}
                        </div>
                        
                        {/* Description de l'activité */}
                        {activity.requisition_title && (
                          <p className="mt-1 text-sm text-gray-600 truncate">
                            {activity.requisition_title}
                          </p>
                        )}
                        
                        {/* Commentaires */}
                        {activity.comments && (
                          <div className="mt-1 text-sm text-gray-500 bg-gray-50 p-2 rounded border border-gray-100">
                            <span className="italic">"{activity.comments}"</span>
                          </div>
                        )}

                        {/* Détails supplémentaires */}
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-400">
                          <span className="flex items-center">
                            <Calendar className="w-3 h-3 mr-1" />
                            {getTimeAgo(activity.performed_at)}
                          </span>
                          {activity.task_name && (
                            <>
                              <span className="text-gray-300">|</span>
                              <span className="flex items-center">
                                <Activity className="w-3 h-3 mr-1" />
                                {activity.task_name}
                              </span>
                            </>
                          )}
                          {activity.entity_type && (
                            <>
                              <span className="text-gray-300">|</span>
                              <span className="flex items-center">
                                <FileText className="w-3 h-3 mr-1" />
                                {activity.entity_type}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center space-x-1 flex-shrink-0">
                        {isRequisition && activity.entity_id && (
                          <Link
                            to={`/requisitions/${activity.entity_id}`}
                            className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                            title="Voir la réquisition"
                          >
                            <Eye className="w-4 h-4" />
                          </Link>
                        )}
                        <button
                          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                          title="Plus d'informations"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Footer */}
      {activities.length > limit && (
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
                <span>Voir plus ({activities.length - limit} supplémentaires)</span>
                <ChevronRight className="w-4 h-4 ml-1" />
              </>
            )}
          </button>
        </div>
      )}
    </motion.div>
  );
}

// Composant Search (icône)
const Search = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

// Composant d'export des activités (version simplifiée)
export function ActivityExporter({ activities }) {
  const handleExport = () => {
    if (!activities || activities.length === 0) {
      alert('Aucune activité à exporter');
      return;
    }

    // Formatage des données pour CSV
    const headers = ['Date', 'Utilisateur', 'Action', 'Réquisition', 'Commentaire', 'Type'];
    const rows = activities.map(a => [
      format(new Date(a.performed_at), 'dd/MM/yyyy HH:mm', { locale: fr }),
      `${a.first_name || ''} ${a.last_name || ''}`.trim() || 'N/A',
      a.action || 'N/A',
      a.requisition_number || 'N/A',
      a.comments || '',
      a.entity_type || 'N/A'
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    // Téléchargement
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `activites_${format(new Date(), 'yyyy-MM-dd', { locale: fr })}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  };

  return (
    <button
      onClick={handleExport}
      className="text-sm text-gray-500 hover:text-gray-700 flex items-center"
    >
      <Download className="w-4 h-4 mr-1" />
      Exporter
    </button>
  );
}