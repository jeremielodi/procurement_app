// src/components/Layout/Sidebar.jsx
import React, { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  CheckSquare,
  ShoppingCart,
  Package,
  PackageCheck,
  Truck,
  FolderOpen,
  DollarSign,
  Building2,
  Bell,
  Settings,
  ChevronLeft,
  ChevronRight,
  Users,
  Shield,
  User,
  LogOut,
  ChevronDown,
  ChevronUp,
  BarChart,
  Database,
  FileText,
  CreditCard,
  ClipboardCheck,
  Gavel,
  Briefcase
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { usePermissions } from '../../hooks/usePermissions'
import api from '../../services/api'
import { useEnterprise, enterpriseLogoUrl } from '../../contexts/EnterpriseContext'

// Définition des groupes de menu
const menuGroups = [
  {
    id: 'platform',
    label: 'Plateforme procureApp',
    icon: Briefcase,
    superAdminOnly: true,
    items: [
      { path: '/admin/enterprises', icon: Building2, label: 'Entreprises', permission: null },
      { path: '/admin/profiles', icon: Shield, label: 'Rôles et permissions', permission: null }
    ]
  },
  {
    id: 'main',
    label: 'Principal',
    icon: BarChart,
    items: [
      { 
        path: '/dashboard', 
        icon: LayoutDashboard, 
        label: 'Dashboard',
        permission: 'VIEW_DASHBOARD'
      },
       { 
        path: '/tasks', 
        icon: CheckSquare, 
        label: 'Mes tâches',
        permission: null,
        hideForSupplier: true
      }
    ]
  },
  {
    id: 'procurement',
    label: 'Achats',
    icon: ShoppingCart,
    items: [
      { 
        path: '/requisitions', 
        icon: ShoppingCart, 
        label: 'Réquisitions',
        permission: 'VIEW_REQUISITIONS'
      },
      { 
        path: '/purchase-orders', 
        icon: Package, 
        label: 'Commandes',
        permission: 'VIEW_PURCHASE_ORDERS'
      },
      {
        path: '/suppliers',
        icon: Truck,
        label: 'Fournisseurs',
        permission: 'VIEW_SUPPLIERS'
      },
      {
        path: '/tenders',
        icon: Gavel,
        label: "Appels d'offres",
        permission: 'MANAGE_TENDERS'
      },
      {
        path: '/goods-receipts',
        icon: PackageCheck,
        label: 'Réceptions GRN',
        permission: 'VIEW_PURCHASE_ORDERS'
      },
      {
        path: '/service-acceptance-notes',
        icon: ClipboardCheck,
        label: 'Acceptation Service (SAN)',
        permission: 'VIEW_PURCHASE_ORDERS'
      }
    ]
  },
  {
    id: 'supplier-portal',
    label: 'Portail fournisseur',
    icon: Gavel,
    supplierOnly: true,
    items: [
      {
        path: '/supplier/dashboard',
        icon: LayoutDashboard,
        label: 'Tableau de bord',
        permission: 'SUPPLIER_PORTAL'
      },
      {
        path: '/supplier/tenders',
        icon: Gavel,
        label: "Appels d'offres",
        permission: 'SUPPLIER_PORTAL'
      },
      {
        path: '/supplier/profile',
        icon: Building2,
        label: 'Mon entreprise',
        permission: 'SUPPLIER_PORTAL'
      }
    ]
  },
  {
    id: 'finance',
    label: 'Finance',
    icon: DollarSign,
    items: [
      {
        path: '/invoices',
        icon: FileText,
        label: 'Factures',
        permission: 'VIEW_PURCHASE_ORDERS'
      },
      {
        path: '/payments',
        icon: CreditCard,
        label: 'Paiements',
        permission: 'VIEW_PURCHASE_ORDERS'
      }
    ]
  },
  {
    id: 'organization',
    label: 'Organisation',
    icon: Building2,
    items: [
      { 
        path: '/departments', 
        icon: Building2, 
        label: 'Départements',
        permission: 'VIEW_DEPARTMENTS'
      },
      { 
        path: '/projects', 
        icon: FolderOpen, 
        label: 'Projets',
        permission: 'VIEW_PROJECTS'
      }
    ]
  },
  {
    id: 'administration',
    label: 'Administration',
    icon: Shield,
    adminOnly: true,
    items: [
      { 
        path: '/users', 
        icon: Users, 
        label: 'Utilisateurs',
        permission: 'MANAGE_USERS'
      },
      { 
        path: '/admin/profiles', 
        icon: Shield, 
        label: 'Profils BPMN',
        permission: 'MANAGE_USERS'
      },
      {
        path: '/settings/enterprise',
        icon: Building2,
        label: 'Mon entreprise',
        permission: 'MANAGE_USERS'
      }
    ]
  },
  {
    id: 'system',
    label: 'Système',
    icon: Database,
    items: [
      { 
        path: '/notifications', 
        icon: Bell, 
        label: 'Notifications',
        permission: null
      }
    ]
  },
  {
  id: 'budget',
  label: 'Budget',
  icon: DollarSign,
  items: [
    { 
      path: '/budget', 
      icon: DollarSign, 
      label: 'Gestion budgétaire',
      permission: 'MANAGE_BUDGET'
    }
  ]
}
]

export default function Sidebar({ isOpen, setIsOpen }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const { hasPermission, isAdmin } = usePermissions()
  const [userProfiles, setUserProfiles] = useState([])
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  
  // État des groupes ouverts/fermés
  const [openGroups, setOpenGroups] = useState(() => {
    // Initialiser tous les groupes fermés
    const initial = {}
    menuGroups.forEach(group => {
      initial[group.id] = false
    })
    
    // Ouvrir le groupe du module actif si trouvé
    const currentPath = window.location.pathname
    for (const group of menuGroups) {
      if (group.items.some(item => item.path === currentPath)) {
        initial[group.id] = true
        break
      }
    }
    return initial
  })

  // Sauvegarder l'état des groupes dans sessionStorage
  useEffect(() => {
    sessionStorage.setItem('sidebarGroups', JSON.stringify(openGroups))
  }, [openGroups])

  // Ouvrir automatiquement le groupe du module actif quand la route change
  useEffect(() => {
    const currentPath = location.pathname
    let groupToOpen = null
    
    for (const group of menuGroups) {
      if (group.items.some(item => item.path === currentPath)) {
        groupToOpen = group.id
        break
      }
    }
    
    if (groupToOpen && !openGroups[groupToOpen]) {
      setOpenGroups(prev => ({ ...prev, [groupToOpen]: true }))
    }
  }, [location.pathname])

  // Charger les profils de l'utilisateur
  useEffect(() => {
    loadUserProfiles()
  }, [])

  const loadUserProfiles = async () => {
    try {
      const response = await api.get('/auth/profile')
      setUserProfiles(response.data.data?.profiles || [])
    } catch (error) {
      console.error('Error loading user profiles:', error)
    }
  }

  // Vérifier si l'utilisateur peut voir un élément du menu
  const isSupplier = user?.profiles?.some(p => p.id === 'prof_supplier')
  const isSuperAdmin = user?.profiles?.some(p => p.id === 'prof_superadmin')
  const { enterprise } = useEnterprise()
  const enterpriseLogo = enterpriseLogoUrl(enterprise)

  const canSeeMenuItem = (item) => {
    if (item.hideForSupplier && (isSupplier || isSuperAdmin)) return false
    if (isSuperAdmin) return true
    if (item.permission && !hasPermission(item.permission)) return false
    return true
  }

  // Vérifier si un groupe est visible
  const isGroupVisible = (group) => {
    // Super admin : uniquement la gestion de la plateforme (+ notifications)
    if (isSuperAdmin) return group.superAdminOnly || group.id === 'system'
    if (group.superAdminOnly) return false
    if (group.adminOnly && !isAdmin()) return false
    if (group.supplierOnly && !isSupplier) return false
    return group.items.some(item => canSeeMenuItem(item))
  }

  // Toggle groupe ouvert/fermé
  const toggleGroup = (groupId) => {
    setOpenGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }))
  }

  // Obtenir les initiales de l'utilisateur
  const getInitials = () => {
    const firstName = user?.firstName || ''
    const lastName = user?.lastName || ''
    if (firstName && lastName) {
      return `${firstName[0]}${lastName[0]}`.toUpperCase()
    }
    return user?.username?.[0]?.toUpperCase() || 'U'
  }

  // Obtenir le nom complet
  const getFullName = () => {
    if (user?.firstName && user?.lastName) {
      return `${user.firstName} ${user.lastName}`
    }
    return user?.username || 'Utilisateur'
  }

  // Obtenir le rôle principal
  const getMainRole = () => {
    if (isAdmin()) return 'Administrateur'
    if (userProfiles.length > 0) {
      return userProfiles[0].name
    }
    return 'Utilisateur'
  }

  const handleLogout = () => {
    logout() // session, WebSocket, requêtes et cache
    navigate('/login', { replace: true })
  }

  // Vérifier si un lien est actif
  const isLinkActive = (path) => {
    return location.pathname === path
  }

  return (
    <div
      className={`fixed left-0 top-0 h-full bg-white shadow-lg transition-all duration-300 z-20 flex flex-col
        ${isOpen ? 'w-64' : 'w-20'}`}
    >
      {/* Logo */}
      <div className="flex items-center justify-between p-4 border-b">
        {isOpen && (
          <>
            {/* Logo et nom de l'entreprise de l'utilisateur ; procureApp sinon (super admin, fournisseur) */}
            <img src={enterpriseLogo || '/images/procureapp-logo.svg'} alt="" style={{ height: 30, maxWidth: 40, objectFit: 'contain' }} />
            <div className="flex-1 min-w-0 ml-2" data-testid="sidebar-brand">
              <div className="text-base font-bold text-blue-600 truncate" title={enterprise?.name || 'procureApp'}>{enterprise?.name || 'procureApp'}</div>
              {enterprise && <div className="text-[10px] text-gray-400 leading-none">procureApp</div>}
            </div>
          </>
         
        )}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="p-1 rounded-lg hover:bg-gray-100"
        >
          {isOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
        </button>
      </div>

    

      {/* Navigation principale avec groupes extensibles */}
      <nav className="flex-1 overflow-y-auto py-4">
        {menuGroups.filter(isGroupVisible).map((group) => {
          const visibleItems = group.items.filter(canSeeMenuItem)
          if (visibleItems.length === 0) return null
          
          const isGroupOpen = openGroups[group.id]
          const GroupIcon = group.icon
          
          return (
            <div key={group.id} className="mb-2">
              {/* En-tête du groupe - cliquable pour ouvrir/fermer */}
              <div
                onClick={() => isOpen && toggleGroup(group.id)}
                className={`flex items-center justify-between px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-600 transition-colors ${
                  !isOpen ? 'justify-center' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <GroupIcon size={16} />
                  {isOpen && <span>{group.label}</span>}
                </div>
                {isOpen && (
                  <button className="p-1">
                    {isGroupOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                )}
              </div>
              
              {/* Items du groupe - affichés seulement si ouvert */}
              {(isGroupOpen || !isOpen) && (
                <div className="space-y-1">
                  {visibleItems.map((item) => {
                    const isActive = isLinkActive(item.path)
                    const Icon = item.icon
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        className={`flex items-center px-4 py-3 transition-colors group
                          ${isActive 
                            ? 'bg-blue-50 text-blue-600 border-r-4 border-blue-600' 
                            : 'text-gray-600 hover:bg-gray-50'
                          }`}
                        title={!isOpen ? item.label : ''}
                      >
                        <Icon size={20} />
                        {isOpen && <span className="ml-3 text-sm">{item.label}</span>}
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {/* Profils BPMN de l'utilisateur */}
        {userProfiles.length > 0 && isOpen && !isSupplier && !isSuperAdmin && (
          <div className="mt-6 px-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Mes profils BPMN
            </p>
            <div className="space-y-1">
              {userProfiles.map((profile) => (
                <div key={profile.id} className="flex items-center gap-2 px-2 py-1">
                  <Shield size={12} className="text-blue-500" />
                  <span className="text-xs text-gray-600">{profile.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* Footer avec actions */}
      <div className="border-t p-4">
        <button
          onClick={() => setShowProfileMenu(!showProfileMenu)}
          className="w-full flex items-center gap-3 text-gray-600 hover:text-gray-800"
        >
          <User size={20} />
          {isOpen && (
            <div className="flex-1 text-left">
              <span className="text-sm">Mon compte</span>
            </div>
          )}
          {isOpen && (showProfileMenu ? <ChevronUp size={16} /> : <ChevronDown size={16} />)}
        </button>
        
        {showProfileMenu && isOpen && (
          <div className="mt-2 space-y-2">
            <Link
              to={isSupplier ? '/supplier/profile' : '/profile'}
              className="flex items-center gap-3 px-2 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg"
            >
              <User size={16} />
              <span>Mon profil</span>
            </Link>
            {!isSupplier && <Link
              to="/settings"
              className="flex items-center gap-3 px-2 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg"
            >
              <Settings size={16} />
              <span>Paramètres</span>
            </Link>}
            <hr className="my-1" />
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-2 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg"
            >
              <LogOut size={16} />
              <span>Déconnexion</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}