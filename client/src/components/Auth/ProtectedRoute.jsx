// src/components/Auth/ProtectedRoute.jsx
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { usePermissions } from '../../hooks/usePermissions';
import LoadingSpinner from '../Common/LoadingSpinner';
import { isSupplierUser, isSuperAdminUser } from '../../utils/accountType';
import { t } from '../../i18n';

// Pages accessibles à un compte fournisseur / au super admin de la plateforme
const SUPPLIER_PATHS = ['/supplier/', '/notifications'];
const SUPERADMIN_PATHS = ['/admin/enterprises', '/admin/profiles', '/admin/references', '/notifications'];

export default function ProtectedRoute({ 
  children, 
  requiredRole = null,
  requiredPermission = null,
  superAdminOnly = false
}) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const { hasPermission, isAdmin } = usePermissions();
  const location = useLocation();
  
  // Afficher un spinner pendant le chargement
  if (isLoading) {
    return <LoadingSpinner fullScreen text={t('auth.checkingAuth')} />;
  }
  
  // Si non authentifié, rediriger vers login
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  // Un fournisseur ne voit que son portail
  if (isSupplierUser(user) && !SUPPLIER_PATHS.some(p => location.pathname.startsWith(p))) {
    return <Navigate to="/supplier/dashboard" replace />;
  }

  // Le super admin gère la plateforme (entreprises, rôles), pas les achats
  if (isSuperAdminUser(user) && !SUPERADMIN_PATHS.some(p => location.pathname.startsWith(p))) {
    return <Navigate to="/admin/enterprises" replace />;
  }
  if (superAdminOnly && !isSuperAdminUser(user)) {
    return <Navigate to="/dashboard" replace />;
  }

  // Vérifier le rôle si requis
  if (requiredRole && user?.role !== requiredRole && !isAdmin()) {
    return <Navigate to="/dashboard" replace />;
  }
  
  // Vérifier la permission si requise
  if (requiredPermission && !hasPermission(requiredPermission) && !isAdmin() && !isSuperAdminUser(user)) {
    return <Navigate to="/dashboard" replace />;
  }
  
  // Si authentifié, afficher le contenu
  return children;
}