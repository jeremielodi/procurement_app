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
  ClipboardList,
  SlidersHorizontal,
  Coins,
  Gavel,
  Briefcase,
  MapPin,
  BadgeCheck,
  Warehouse,
  Boxes,
  History,
  PackageMinus,
  Inbox,
  Laptop,
  Undo2,
  ScrollText
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { usePermissions } from '../../hooks/usePermissions'
import api from '../../services/api'
import { useTranslation } from '../../i18n'
import { useEnterprise, enterpriseLogoUrl } from '../../contexts/EnterpriseContext'

// Définition des groupes de menu (label = clé de traduction)
const menuGroups = [
  {
    id: 'platform',
    label: 'nav.groups.platform',
    icon: Briefcase,
    superAdminOnly: true,
    items: [
      { path: '/admin/enterprises', icon: Building2, label: 'nav.enterprises', permission: null },
      { path: '/admin/references', icon: MapPin, label: 'nav.references', permission: null },
      { path: '/admin/profiles', icon: Shield, label: 'nav.rolesPermissions', permission: null },
      { path: '/admin/audit', icon: ScrollText, label: 'nav.auditLog', permission: null }
    ]
  },
  {
    id: 'main',
    label: 'nav.groups.main',
    icon: BarChart,
    items: [
      { 
        path: '/dashboard', 
        icon: LayoutDashboard, 
        label: 'nav.dashboard',
        permission: 'VIEW_DASHBOARD'
      },
       { 
        path: '/tasks', 
        icon: CheckSquare, 
        label: 'nav.myTasks',
        permission: null,
        hideForSupplier: true
      },
      {
        path: '/my-items',
        icon: Inbox,
        label: 'nav.myItems',
        permission: null,
        hideForSupplier: true
      }
    ]
  },
  {
    id: 'procurement',
    label: 'nav.groups.procurement',
    icon: ShoppingCart,
    items: [
      { 
        path: '/requisitions', 
        icon: ShoppingCart, 
        label: 'nav.requisitions',
        permission: 'VIEW_REQUISITIONS'
      },
      { 
        path: '/purchase-orders', 
        icon: Package, 
        label: 'nav.purchaseOrders',
        permission: 'VIEW_PURCHASE_ORDERS'
      },
      {
        path: '/suppliers',
        icon: Truck,
        label: 'nav.suppliers',
        permission: 'VIEW_SUPPLIERS'
      },
      {
        path: '/suppliers/prequalified',
        icon: BadgeCheck,
        label: 'nav.prequalifiedSuppliers',
        permission: 'VIEW_SUPPLIERS'
      },
      {
        path: '/tenders',
        icon: Gavel,
        label: 'nav.tenders',
        permission: 'MANAGE_TENDERS'
      },
      {
        path: '/goods-receipts',
        icon: PackageCheck,
        label: 'nav.goodsReceipts',
        permission: 'VIEW_PURCHASE_ORDERS'
      },
      {
        path: '/service-acceptance-notes',
        icon: ClipboardCheck,
        label: 'nav.serviceAcceptance',
        permission: 'VIEW_PURCHASE_ORDERS'
      }
    ]
  },
  {
    id: 'supplier-portal',
    label: 'nav.groups.supplierPortal',
    icon: Gavel,
    supplierOnly: true,
    items: [
      {
        path: '/supplier/dashboard',
        icon: LayoutDashboard,
        label: 'nav.supplierDashboard',
        permission: 'SUPPLIER_PORTAL'
      },
      {
        path: '/supplier/tenders',
        icon: Gavel,
        label: 'nav.tenders',
        permission: 'SUPPLIER_PORTAL'
      },
      {
        path: '/supplier/orders',
        icon: ClipboardList,
        label: 'nav.supplierOrders',
        permission: 'SUPPLIER_PORTAL'
      },
      {
        path: '/supplier/profile',
        icon: Building2,
        label: 'nav.myCompany',
        permission: 'SUPPLIER_PORTAL'
      }
    ]
  },
  {
    id: 'stock',
    label: 'nav.groups.stock',
    icon: Warehouse,
    items: [
      { path: '/stock', icon: Package, label: 'nav.stock', permission: 'VIEW_STOCK' },
      { path: '/stock/items', icon: Boxes, label: 'nav.stockItems', permission: 'VIEW_STOCK' },
      { path: '/stock/issues', icon: PackageMinus, label: 'nav.stockIssues', permission: 'VIEW_STOCK' },
      { path: '/stock/returns', icon: Undo2, label: 'nav.stockReturns', permission: 'VIEW_STOCK' },
      { path: '/stock/equipment', icon: Laptop, label: 'nav.equipment', permission: 'VIEW_STOCK' },
      { path: '/stock/valuation', icon: Coins, label: 'nav.stockValuation', permission: 'VIEW_STOCK' },
      { path: '/stock/counts', icon: ClipboardCheck, label: 'nav.stockCounts', permission: 'VIEW_STOCK' },
      { path: '/stock/adjustments', icon: SlidersHorizontal, label: 'nav.stockAdjustments', permission: 'VIEW_STOCK' },
      { path: '/stock/movements', icon: History, label: 'nav.stockMovements', permission: 'VIEW_STOCK' },
      { path: '/stock/warehouses', icon: Warehouse, label: 'nav.warehouses', permission: 'VIEW_STOCK' }
    ]
  },
  {
    id: 'finance',
    label: 'nav.groups.finance',
    icon: DollarSign,
    items: [
      {
        path: '/invoices',
        icon: FileText,
        label: 'nav.invoices',
        permission: 'VIEW_PURCHASE_ORDERS'
      },
      {
        path: '/payments',
        icon: CreditCard,
        label: 'nav.payments',
        permission: 'VIEW_PURCHASE_ORDERS'
      }
    ]
  },
  {
    id: 'organization',
    label: 'nav.groups.organization',
    icon: Building2,
    items: [
      { 
        path: '/departments', 
        icon: Building2, 
        label: 'nav.departments',
        permission: 'VIEW_DEPARTMENTS'
      },
      { 
        path: '/projects', 
        icon: FolderOpen, 
        label: 'nav.projects',
        permission: 'VIEW_PROJECTS'
      }
    ]
  },
  {
    id: 'administration',
    label: 'nav.groups.administration',
    icon: Shield,
    adminOnly: true,
    items: [
      { 
        path: '/users', 
        icon: Users, 
        label: 'nav.users',
        permission: 'MANAGE_USERS'
      },
      { 
        path: '/admin/profiles', 
        icon: Shield, 
        label: 'nav.bpmnProfiles',
        permission: 'MANAGE_USERS'
      },
      {
        path: '/settings/enterprise',
        icon: Building2,
        label: 'nav.myCompany',
        permission: 'MANAGE_USERS'
      },
      {
        path: '/admin/audit',
        icon: ScrollText,
        label: 'nav.auditLog',
        permission: 'VIEW_AUDIT_LOGS'
      }
    ]
  },
  {
    id: 'system',
    label: 'nav.groups.system',
    icon: Database,
    items: [
      { 
        path: '/notifications', 
        icon: Bell, 
        label: 'nav.notifications',
        permission: null
      }
    ]
  },
  {
  id: 'budget',
  label: 'nav.groups.budget',
  icon: DollarSign,
  items: [
    { 
      path: '/budget', 
      icon: DollarSign, 
      label: 'nav.budgetManagement',
      permission: ['MANAGE_BUDGET', 'AUDIT_ACCESS'] // auditeur : consultation
    }
  ]
}
]

export default function Sidebar({ isOpen, setIsOpen }) {
  const { t } = useTranslation()
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
      if (group.items.some(item => currentPath === item.path || currentPath.startsWith(item.path + '/'))) {
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
      if (group.items.some(item => currentPath === item.path || currentPath.startsWith(item.path + '/'))) {
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
    return user?.username || t('common.user')
  }

  // Obtenir le rôle principal
  const getMainRole = () => {
    if (isAdmin()) return t('common.administrator')
    if (userProfiles.length > 0) {
      return userProfiles[0].name
    }
    return t('common.user')
  }

  const handleLogout = () => {
    logout() // session, WebSocket, requêtes et cache
    navigate('/login', { replace: true })
  }

  // Lien actif : le chemin du menu le plus long qui préfixe l'URL (ex. /purchase-orders/12 → « Bons de commande »,
  // /stock/items → « Articles » et non « État du stock »)
  const allPaths = menuGroups.flatMap(g => g.items.map(i => i.path))
  const activePath = allPaths
    .filter(p => location.pathname === p || location.pathname.startsWith(p + '/'))
    .sort((a, b) => b.length - a.length)[0]
  const isLinkActive = (path) => path === activePath

  const roleLabel = getMainRole()

  return (
    <aside
      className={`fixed left-0 top-0 z-20 flex h-full flex-col bg-gradient-to-b from-[#0d1838] via-[#0a1330] to-[#070d22] text-slate-300 shadow-xl transition-all duration-300
        ${isOpen ? 'w-64' : 'w-20'}`}
    >
      {/* Marque : logo et nom de l'entreprise de l'utilisateur ; procureApp sinon (super admin, fournisseur) */}
      <div className={`flex h-16 items-center border-b border-white/10 ${isOpen ? 'justify-between px-4' : 'justify-center px-2'}`}>
        {isOpen && (
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white p-1 shadow-sm">
              <img src={enterpriseLogo || '/images/procureapp-logo.svg'} alt="" className="max-h-full max-w-full object-contain" />
            </span>
            <div className="min-w-0" data-testid="sidebar-brand">
              <div className="truncate text-sm font-semibold text-white" title={enterprise?.name || 'procureApp'}>{enterprise?.name || 'procureApp'}</div>
              {enterprise && <div className="text-[10px] uppercase tracking-wider text-blue-300/70">procureApp</div>}
            </div>
          </div>
        )}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          aria-label={isOpen ? t('nav.collapse') : t('nav.expand')}
        >
          {isOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>

      {/* Navigation : groupes repliables */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 [scrollbar-color:rgba(255,255,255,.15)_transparent] [scrollbar-width:thin]">
        {menuGroups.filter(isGroupVisible).map((group) => {
          const visibleItems = group.items.filter(canSeeMenuItem)
          if (visibleItems.length === 0) return null

          const isGroupOpen = openGroups[group.id] || !isOpen
          const GroupIcon = group.icon
          const hasActive = visibleItems.some(item => isLinkActive(item.path))

          return (
            <div key={group.id} className="mb-1">
              {/* En-tête du groupe (barre repliée : simple séparateur) */}
              {isOpen ? (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className={`flex w-full items-center justify-between px-5 py-2 text-[11px] font-semibold uppercase tracking-wider transition-colors
                    ${hasActive ? 'text-blue-300' : 'text-slate-500 hover:text-slate-300'}`}
                  aria-expanded={!!openGroups[group.id]}
                >
                  <span className="flex items-center gap-2">
                    <GroupIcon size={14} />
                    {t(group.label)}
                  </span>
                  <ChevronDown size={14} className={`transition-transform duration-200 ${openGroups[group.id] ? 'rotate-180' : ''}`} />
                </button>
              ) : (
                <div className="mx-5 my-2 border-t border-white/10" />
              )}

              {/* Éléments du groupe : ouverture animée */}
              <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${isGroupOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                <div className="overflow-hidden">
                  <div className="space-y-0.5 pb-1">
                    {visibleItems.map((item) => {
                      const isActive = isLinkActive(item.path)
                      const Icon = item.icon
                      return (
                        <Link
                          key={item.path}
                          to={item.path}
                          tabIndex={isGroupOpen ? 0 : -1}
                          className={`relative mx-3 flex items-center rounded-lg py-2 text-sm transition-all duration-150
                            ${isOpen ? 'px-3' : 'justify-center px-0'}
                            ${isActive
                              ? 'bg-gradient-to-r from-blue-500/25 to-blue-500/5 font-medium text-white shadow-inner'
                              : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}
                          title={!isOpen ? t(item.label) : undefined}
                          aria-current={isActive ? 'page' : undefined}
                        >
                          {isActive && <span className="absolute -left-3 top-1.5 bottom-1.5 w-1 rounded-r-full bg-blue-400" aria-hidden="true" />}
                          <Icon size={18} className={`shrink-0 ${isActive ? 'text-blue-300' : 'text-slate-400'}`} />
                          {isOpen && <span className="ml-3 truncate">{t(item.label)}</span>}
                        </Link>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        {/* Profils BPMN de l'utilisateur */}
        {userProfiles.length > 0 && isOpen && !isSupplier && !isSuperAdmin && (
          <div className="mx-5 mt-5 border-t border-white/10 pt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('nav.myBpmnProfiles')}</p>
            <div className="flex flex-wrap gap-1.5">
              {userProfiles.map((profile) => (
                <span key={profile.id} className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] text-blue-200 ring-1 ring-blue-400/20">
                  <Shield size={10} /> {profile.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* Compte : carte utilisateur, menu au-dessus */}
      <div className="relative border-t border-white/10 p-3">
        {showProfileMenu && (
          <div className={`absolute bottom-full z-30 mb-2 rounded-xl bg-[#121d42] p-1.5 shadow-2xl ring-1 ring-white/10
            ${isOpen ? 'left-3 right-3' : 'left-3 w-52'}`}>
            <Link
              to={isSupplier ? '/supplier/profile' : '/profile'}
              onClick={() => setShowProfileMenu(false)}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
            >
              <User size={16} /> <span>{t('nav.myProfile')}</span>
            </Link>
            {!isSupplier && (
              <Link
                to="/settings"
                onClick={() => setShowProfileMenu(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
              >
                <Settings size={16} /> <span>{t('nav.settings')}</span>
              </Link>
            )}
            <div className="my-1 border-t border-white/10" />
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-red-300 hover:bg-red-500/15 hover:text-red-200"
            >
              <LogOut size={16} /> <span>{t('nav.logout')}</span>
            </button>
          </div>
        )}
        <button
          onClick={() => setShowProfileMenu(!showProfileMenu)}
          className={`flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-white/5 ${showProfileMenu ? 'bg-white/5' : ''} ${!isOpen ? 'justify-center' : ''}`}
          aria-expanded={showProfileMenu}
          title={!isOpen ? getFullName() : undefined}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-semibold text-white ring-2 ring-white/10">
            {getInitials()}
          </span>
          {isOpen && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-white">{getFullName()}</span>
                <span className="block truncate text-xs text-slate-400">{t('nav.myAccount')} · {roleLabel}</span>
              </span>
              <ChevronUp size={16} className={`shrink-0 text-slate-400 transition-transform duration-200 ${showProfileMenu ? '' : 'rotate-180'}`} />
            </>
          )}
        </button>
      </div>
    </aside>
  )
}
