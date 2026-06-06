// src/hooks/usePermissions.js
import { useAuth } from './useAuth';

export const usePermissions = () => {
  const { user } = useAuth();
  
  const hasPermission = (permissionName) => {
    if (!user) return false;
    // L'admin a toutes les permissions (via le profil prof_admin)
    if (user.profiles?.some(p => p.id === 'prof_admin')) return true;
    // Vérifier si l'utilisateur a la permission
    console.log(user.permissions, permissionName);
    return user.permissions?.includes(permissionName) || false;
  };
  
  const hasAnyPermission = (...permissionNames) => {
    return permissionNames.some(perm => hasPermission(perm));
  };
  
  const hasAllPermissions = (...permissionNames) => {
    return permissionNames.every(perm => hasPermission(perm));
  };
  
  const isAdmin = () => {
    return user?.profiles?.some(p => p.id === 'prof_admin') || false;
  };
  
  const getUserProfiles = () => {
    return user?.profiles || [];
  };
  
  const getMainProfile = () => {
    const profiles = user?.profiles || [];
    if (profiles.length === 0) return null;
    // Priorité au profil admin
    const adminProfile = profiles.find(p => p.id === 'prof_admin');
    if (adminProfile) return adminProfile;
    return profiles[0];
  };
  
  return {
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    isAdmin,
    getUserProfiles,
    getMainProfile
  };
};