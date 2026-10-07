// src/components/Layout/Header.jsx
import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Menu, Search, User, LogOut, Settings, Bell, ChevronDown } from 'lucide-react'
import NotificationBell from '../Notifications/NotificationBell'
import { useAuth } from '../../hooks/useAuth'
import { useTranslation } from '../../i18n'
import LanguageSwitcher from '../Common/LanguageSwitcher'
import HelpCenter from '../Help/HelpCenter'

export default function Header({ toggleSidebar }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const { user, logout } = useAuth()
  const isSupplier = user?.profiles?.some(p => p.id === 'prof_supplier')

  const handleSearch = (e) => {
    e.preventDefault()
    console.log('Searching for:', searchQuery)
    // Implémenter la recherche
  }

  const handleNavigateToProfile = () => {
    setIsProfileOpen(false)
    navigate('/profile')
  }

  const handleNavigateToSettings = () => {
    setIsProfileOpen(false)
    navigate('/settings')
  }

  const handleLogout = () => {
    setIsProfileOpen(false)
    logout() // session, WebSocket, requêtes et cache
    navigate('/login', { replace: true })
  }

  return (
    <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-10">
      <div className="flex items-center justify-between px-6 py-3">
        {/* Left section - Menu button */}
        <div className="flex items-center gap-4">
          <button
            onClick={toggleSidebar}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label={t('header.toggleSidebar')}
          >
            <Menu size={20} className="text-gray-600" />
          </button>

          {/* Search bar */}
          {!isSupplier && <form onSubmit={handleSearch} className="hidden md:block">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('header.searchPlaceholder')}
                className="w-96 pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <Search size={18} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            </div>
          </form>}
        </div>

        {/* Right section - Notifications & User */}
        <div className="flex items-center gap-4">
          <LanguageSwitcher />

          {/* Aide : guide d'utilisation */}
          <HelpCenter />

          {/* Notifications */}
          <NotificationBell userId={user?.id || 1} />

          {/* User profile dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsProfileOpen(!isProfileOpen)}
              className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-r from-blue-500 to-blue-600 flex items-center justify-center text-white font-semibold">
                {user?.firstName?.[0] || user?.username?.[0] || 'U'}
              </div>
              <div className="hidden md:block text-left">
                <p className="text-sm font-medium text-gray-700">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-xs text-gray-500">{isSupplier ? t('common.supplier') : (user?.role || t('common.user'))}</p>
              </div>
              <ChevronDown size={16} className="text-gray-500" />
            </button>

            {/* Dropdown menu */}
            {isProfileOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setIsProfileOpen(false)} />
                <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-20">
                  <div className="p-4 border-b border-gray-200">
                    <p className="font-semibold text-gray-800">
                      {user?.firstName} {user?.lastName}
                    </p>
                    <p className="text-sm text-gray-500">{user?.email}</p>
                  </div>
                  <div className="py-2">
                    <Link
                      to={isSupplier ? '/supplier/profile' : '/profile'}
                      onClick={() => setIsProfileOpen(false)}
                      className="w-full flex items-center gap-3 px-4 py-2 text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <User size={18} />
                      <span>{t('nav.myProfile')}</span>
                    </Link>
                    {!isSupplier && <Link
                      to="/settings"
                      onClick={() => setIsProfileOpen(false)}
                      className="w-full flex items-center gap-3 px-4 py-2 text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <Settings size={18} />
                      <span>{t('nav.settings')}</span>
                    </Link>}
                    <hr className="my-1" />
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-3 px-4 py-2 text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <LogOut size={18} />
                      <span>{t('nav.logout')}</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mobile search bar */}
      {!isSupplier && <div className="md:hidden px-4 pb-3">
        <form onSubmit={handleSearch}>
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('common.searchPlaceholder')}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
            <Search size={18} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          </div>
        </form>
      </div>}
    </header>
  )
}