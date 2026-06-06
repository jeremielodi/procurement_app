// src/components/Notifications/NotificationList.jsx
import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Bell, 
  Check, 
  Trash2, 
  CheckCheck, 
  ShoppingCart, 
  FileText, 
  CheckCircle, 
  XCircle, 
  AlertCircle,
  Clock,
  RefreshCw,
  Filter
} from 'lucide-react';
import { notificationService } from '../../services/notificationService';
import { useAuth } from '../../hooks/useAuth';
import { formatDistanceToNow, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { useWebSocket } from '../../hooks/useWebSocket';

const getNotificationIcon = (type) => {
  switch (type) {
    case 'REQUISITION_CREATED':
      return <ShoppingCart size={18} className="text-blue-500" />;
    case 'REQUISITION_APPROVED':
      return <CheckCircle size={18} className="text-green-500" />;
    case 'REQUISITION_REJECTED':
      return <XCircle size={18} className="text-red-500" />;
    case 'BUDGET_CHECKED':
      return <AlertCircle size={18} className="text-yellow-500" />;
    case 'PO_CREATED':
      return <FileText size={18} className="text-purple-500" />;
    case 'SUCCESS':
      return <CheckCircle size={18} className="text-green-500" />;
    case 'ERROR':
      return <XCircle size={18} className="text-red-500" />;
    case 'WARNING':
      return <AlertCircle size={18} className="text-yellow-500" />;
    case 'INFO':
      return <Bell size={18} className="text-blue-500" />;
    default:
      return <Bell size={18} className="text-gray-500" />;
  }
};

const getNotificationColor = (type) => {
  switch (type) {
    case 'REQUISITION_CREATED':
      return 'border-l-blue-500';
    case 'REQUISITION_APPROVED':
      return 'border-l-green-500';
    case 'REQUISITION_REJECTED':
      return 'border-l-red-500';
    case 'BUDGET_CHECKED':
      return 'border-l-yellow-500';
    case 'PO_CREATED':
      return 'border-l-purple-500';
    case 'SUCCESS':
      return 'border-l-green-500';
    case 'ERROR':
      return 'border-l-red-500';
    case 'WARNING':
      return 'border-l-yellow-500';
    default:
      return 'border-l-gray-500';
  }
};

export default function NotificationList() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { socket, isConnected } = useWebSocket();
  const [filter, setFilter] = useState('all'); // all, unread
  const [typeFilter, setTypeFilter] = useState('all');

  // Récupérer les notifications
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['notifications', user?.id, filter],
    queryFn: () => notificationService.getUserNotifications(user?.id, filter === 'unread'),
    enabled: !!user?.id
  });

  // Écouter les nouvelles notifications via WebSocket
  useEffect(() => {
    if (!socket || !isConnected) return;

    const handleNewNotification = (data) => {
      console.log('🔔 New notification received:', data);
      refetch();
      toast.custom((t) => (
        <div className="max-w-md w-full bg-white shadow-lg rounded-lg pointer-events-auto flex ring-1 ring-black ring-opacity-5">
          <div className="flex-1 w-0 p-4">
            <div className="flex items-start">
              <div className="flex-shrink-0 pt-0.5">
                {getNotificationIcon(data.type)}
              </div>
              <div className="ml-3 flex-1">
                <p className="text-sm font-medium text-gray-900">{data.title}</p>
                <p className="mt-1 text-sm text-gray-500">{data.message}</p>
              </div>
            </div>
          </div>
          <div className="flex border-l border-gray-200">
            <button
              onClick={() => {
                toast.dismiss(t.id);
                if (data.link) window.location.href = data.link;
              }}
              className="w-full border border-transparent rounded-none rounded-r-lg p-4 flex items-center justify-center text-sm font-medium text-blue-600 hover:text-blue-500"
            >
              Voir
            </button>
          </div>
        </div>
      ), { duration: 5000, position: 'top-right' });
    };

    socket.on('notification', handleNewNotification);
    return () => socket.off('notification', handleNewNotification);
  }, [socket, isConnected, refetch]);

  // Mutations
  const markAsReadMutation = useMutation({
    mutationFn: (id) => notificationService.markAsRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['notifications', user?.id]);
    }
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: () => notificationService.markAllAsRead(user?.id),
    onSuccess: () => {
      queryClient.invalidateQueries(['notifications', user?.id]);
      toast.success('Toutes les notifications ont été marquées comme lues');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => notificationService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['notifications', user?.id]);
      toast.success('Notification supprimée');
    }
  });

  const deleteAllMutation = useMutation({
    mutationFn: () => notificationService.deleteAll(user?.id),
    onSuccess: () => {
      queryClient.invalidateQueries(['notifications', user?.id]);
      toast.success('Toutes les notifications ont été supprimées');
    }
  });

  const notifications = data?.data || [];
  
  // Filtrer par type
  const filteredNotifications = typeFilter === 'all' 
    ? notifications 
    : notifications.filter(n => n.type === typeFilter);

  const unreadCount = notifications.filter(n => !n.read).length;
  const notificationTypes = [...new Set(notifications.map(n => n.type))];

  const handleMarkAsRead = async (id) => {
    await markAsReadMutation.mutateAsync(id);
  };

  const handleDelete = async (id) => {
    if (confirm('Supprimer cette notification ?')) {
      await deleteMutation.mutateAsync(id);
    }
  };

  const handleNotificationClick = (notification) => {
    if (!notification.read) {
      markAsReadMutation.mutate(notification.id);
    }
    if (notification.link) {
      window.location.href = notification.link;
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* En-tête */}
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Bell size={24} />
            Notifications
          </h1>
          <p className="text-gray-500 mt-1">
            {unreadCount} notification{unreadCount > 1 ? 's' : ''} non lue{unreadCount > 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          {unreadCount > 0 && (
            <button
              onClick={() => markAllAsReadMutation.mutate()}
              className="flex items-center gap-2 px-3 py-2 text-sm text-blue-600 border border-blue-600 rounded-lg hover:bg-blue-50"
            >
              <CheckCheck size={16} />
              Tout marquer comme lu
            </button>
          )}
          <button
            onClick={() => deleteAllMutation.mutate()}
            className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 border border-red-600 rounded-lg hover:bg-red-50"
          >
            <Trash2 size={16} />
            Tout supprimer
          </button>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <RefreshCw size={16} />
            Rafraîchir
          </button>
        </div>
      </div>

      {/* Indicateur WebSocket */}
      {!isConnected && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-center">
          <p className="text-sm text-yellow-700 flex items-center justify-center gap-2">
            <AlertCircle size={16} />
            Connexion temps réel instable. Les notifications peuvent être retardées.
          </p>
        </div>
      )}

      {/* Filtres */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-wrap gap-4">
          <div className="flex gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                filter === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Toutes
            </button>
            <button
              onClick={() => setFilter('unread')}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                filter === 'unread'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Non lues {unreadCount > 0 && `(${unreadCount})`}
            </button>
          </div>
          
          <div className="flex items-center gap-2 ml-auto">
            <Filter size={16} className="text-gray-400" />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Tous les types</option>
              {notificationTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Liste des notifications */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {filteredNotifications.length === 0 ? (
          <div className="text-center py-12">
            <Bell size={48} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500">Aucune notification</p>
            <p className="text-sm text-gray-400 mt-1">
              Vous serez notifié des activités importantes
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filteredNotifications.map((notification) => (
              <div
                key={notification.id}
                onClick={() => handleNotificationClick(notification)}
                className={`p-4 hover:bg-gray-50 transition-colors cursor-pointer border-l-4 ${getNotificationColor(notification.type)} ${
                  !notification.read ? 'bg-blue-50/30' : ''
                }`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex gap-3 flex-1">
                    <div className="flex-shrink-0 mt-0.5">
                      {getNotificationIcon(notification.type)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className={`font-medium ${!notification.read ? 'text-gray-900' : 'text-gray-700'}`}>
                          {notification.title}
                        </h3>
                        {!notification.read && (
                          <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">
                            Nouveau
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mt-1">
                        {notification.message}
                      </p>
                      <div className="flex items-center gap-3 mt-2">
                        <div className="flex items-center gap-1 text-xs text-gray-400">
                          <Clock size={12} />
                          {formatDistanceToNow(new Date(notification.created_at), {
                            addSuffix: true,
                            locale: fr
                          })}
                        </div>
                        <div className="text-xs text-gray-400">
                          {format(new Date(notification.created_at), 'dd/MM/yyyy HH:mm')}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4">
                    {!notification.read && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMarkAsRead(notification.id);
                        }}
                        className="p-1 text-green-600 hover:bg-green-50 rounded"
                        title="Marquer comme lu"
                      >
                        <Check size={16} />
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(notification.id);
                      }}
                      className="p-1 text-red-600 hover:bg-red-50 rounded"
                      title="Supprimer"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Statistiques */}
      {notifications.length > 0 && (
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-gray-800">{notifications.length}</p>
              <p className="text-xs text-gray-500">Total</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-green-600">{notifications.filter(n => n.read).length}</p>
              <p className="text-xs text-gray-500">Lues</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-yellow-600">{unreadCount}</p>
              <p className="text-xs text-gray-500">Non lues</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-blue-600">
                {notifications.filter(n => {
                  const dts = new Date();
                  dts.setDate(dts.getDate() - 7);
                  return new Date(n.created_at) >= dts;
                }).length}
              </p>
              <p className="text-xs text-gray-500">7 derniers jours</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}