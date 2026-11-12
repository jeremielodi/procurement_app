// src/components/Auth/ProtectedRoute.jsx
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { usePermissions } from '../../hooks/usePermissions';
import LoadingSpinner from '../Common/LoadingSpinner';
import { isSupplierUser, isSuperAdminUser, isPartnerUser } from '../../utils/accountType';
import { loginPathFor } from '../../utils/loginRedirect';
import { t } from '../../i18n';

// Pages accessibles à un compte fournisseur / au super admin de la plateforme
const SUPPLIER_PATHS = ['/supplier/', '/notifications'];
// Compte partenaire : son espace, ses notifications, son profil (mot de passe, langue, photo)
const PARTNER_PATHS = ['/partner/', '/notifications', '/profile'];
const SUPERADMIN_PATHS = ['/admin/enterprises', '/admin/profiles', '/admin/references', '/admin/audit', '/notifications'];

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
  
  // Non authentifié : connexion, puis retour à la page demandée (ex. lien reçu par email)
  if (!isAuthenticated) {
    return <Navigate to={loginPathFor(location)} replace />;
  }
  
  // Un fournisseur ne voit que son portail
  if (isSupplierUser(user) && !SUPPLIER_PATHS.some(p => location.pathname.startsWith(p))) {
    return <Navigate to="/supplier/dashboard" replace />;
  }
  // Un partenaire ne voit que son espace
  if (isPartnerUser(user) && !PARTNER_PATHS.some(p => location.pathname.startsWith(p))) {
    return <Navigate to="/partner/transfers" replace />;
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