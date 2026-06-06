// src/components/Auth/ProtectedRoute.jsx
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { usePermissions } from '../../hooks/usePermissions';
import LoadingSpinner from '../Common/LoadingSpinner';

export default function ProtectedRoute({ 
  children, 
  requiredRole = null,
  requiredPermission = null 
}) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const { hasPermission, isAdmin } = usePermissions();
  
  // Afficher un spinner pendant le chargement
  if (isLoading) {
    return <LoadingSpinner fullScreen text="Vérification de l'authentification..." />;
  }
  
  // Si non authentifié, rediriger vers login
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  // Vérifier le rôle si requis
  if (requiredRole && user?.role !== requiredRole && !isAdmin()) {
    return <Navigate to="/dashboard" replace />;
  }
  
  // Vérifier la permission si requise
  if (requiredPermission && !hasPermission(requiredPermission) && !isAdmin()) {
    return <Navigate to="/dashboard" replace />;
  }
  
  // Si authentifié, afficher le contenu
  return children;
}