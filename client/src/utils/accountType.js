// Types de compte procureApp
export const isSupplierUser = (user) => user?.profiles?.some(p => p.id === 'prof_supplier');
export const isSuperAdminUser = (user) => user?.profiles?.some(p => p.id === 'prof_superadmin');
// Compte de l'espace partenaire (migration 66) : uniquement le profil prof_partner
export const isPartnerUser = (user) => !!user?.profiles?.length && user.profiles.every(p => p.id === 'prof_partner');

// Page d'accueil selon le type de compte
export const homePathFor = (user) =>
  isSuperAdminUser(user) ? '/admin/enterprises' : isSupplierUser(user) ? '/supplier/dashboard'
    : isPartnerUser(user) ? '/partner/transfers' : '/dashboard';
