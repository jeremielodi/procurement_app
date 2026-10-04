// Types de compte procureApp
export const isSupplierUser = (user) => user?.profiles?.some(p => p.id === 'prof_supplier');
export const isSuperAdminUser = (user) => user?.profiles?.some(p => p.id === 'prof_superadmin');

// Page d'accueil selon le type de compte
export const homePathFor = (user) =>
  isSuperAdminUser(user) ? '/admin/enterprises' : isSupplierUser(user) ? '/supplier/dashboard' : '/dashboard';
